import type { EngineInterface, On } from "claude-code";

const SUBSTITUTION_OPENER = "$(";
const LIST_TIMEOUT_MS = 5000;
const REMOTE_TIMEOUT_MS = 10000;
const SHOWN_LIMIT = 10;
const SHORT_SHA_LENGTH = 7;
const FLAG_VALUE_WIDTH = 2;
const HEADS_PREFIX = "refs/heads/";
const FOOTER = "paneline guard: confirm to run";
const UNKNOWN_LOSS = "paneline guard: could not work out what would be lost. Confirm to run.";
const SEPARATORS = new Set([";", "|", "&"]);
const PREFIX_WORDS = new Set([
  "command",
  "env",
  "time",
  "nice",
  "exec",
  "!",
  "{",
  "if",
  "then",
  "elif",
  "else",
  "while",
  "until",
  "do",
]);
const NICE_ARGUMENT = /^(-\w+|\d+)$/;
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const HEREDOC_READER = "ssh";
const SHELL_COMMAND_FLAG = /^-[A-Za-z]*c$/;
const REDIRECTION = /^\d*(>>?|<)(.*)$/;
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
const SHELL_EXPANSION = /[$`~{]/;
const GLOB = /[*?[]/;
const RECURSIVE_FLAG = /^-[A-Za-z]*[rR]/;
const FORCE_FLAG = /^-[A-Za-z]*f/;
const HEREDOC_OPENER = /(?<!<)<<(?!<)(-?)[ \t]*(["']?)([^\s"'<>|&;()]+)\2/y;
const SUDO_VALUE_FLAGS = new Set([
  "-C",
  "-D",
  "-g",
  "-h",
  "-p",
  "-R",
  "-r",
  "-t",
  "-T",
  "-U",
  "-u",
  "--chdir",
  "--close-from",
  "--command-timeout",
  "--group",
  "--host",
  "--other-user",
  "--prompt",
  "--role",
  "--type",
  "--user",
]);

type DeleteRisk = { kind: "delete"; dir: string; flags: string[]; targets: string[] };
type PushRisk = { kind: "push"; dir: string; remote: string; refspecs: string[] };
type Risk = DeleteRisk | PushRisk;
type PushTarget = { remote: string; branch: string; local: string };
type Segment = { kind: "command" | "open" | "close"; words: string[] };
type ParsedCommand = { segments: Segment[]; nested: string[] };
type Ran = { exitCode: number; stdout: string };
type Heredoc = { word: string; stripTabs: boolean; expands: boolean };

export function holdRiskyCommands(on: On): void {
  on("classic.PreToolUse", { tool: "Bash" }, async ($, e, next) => {
    const verdict = await next(e);
    if (verdict.deny !== undefined) return verdict;
    const risks = risksOf(e.command, await $.session.cwd());
    if (risks.length === 0) return verdict;
    return { ask: await reasonFor($, risks) };
  }).catch(async (_$, e, next) => {
    const verdict = await next(e);
    if (verdict.deny !== undefined) return verdict;
    if (risksOf(e.command, "").length === 0) return verdict;
    return { ask: UNKNOWN_LOSS };
  });
}

function risksOf(command: string, startDir: string): Risk[] {
  const { segments, nested } = parseCommand(command);
  const scopes: string[] = [];
  const risks: Risk[] = [];
  let dir = startDir;
  for (const { kind, words } of segments) {
    if (kind === "open") scopes.push(dir);
    else if (kind === "close") dir = scopes.pop() ?? dir;
    else {
      const [name = "", ...args] = withoutPrefixes(words);
      if (name === "cd" && args[0] !== undefined && !SHELL_EXPANSION.test(args[0]))
        dir = resolvePath(dir, args[0]);
      else risks.push(...risksOfCall(name, args, dir));
    }
  }
  return [...risks, ...nested.flatMap((inner) => risksOf(inner, dir))];
}

function programOf(name: string): string {
  return name.slice(name.lastIndexOf("/") + 1);
}

function runsScript(segment: Segment): boolean {
  const [name = ""] = withoutPrefixes(segment.words);
  const program = programOf(name);
  return SHELLS.has(program) || program === HEREDOC_READER;
}

function risksOfCall(name: string, args: string[], dir: string): Risk[] {
  const program = programOf(name);
  if (SHELLS.has(program)) return risksOf(shellScript(args), dir);
  const risk =
    program === "rm" ? deleteRisk(args, dir) : program === "git" ? pushRisk(args, dir) : undefined;
  return risk === undefined ? [] : [risk];
}

function shellScript(args: string[]): string {
  const flag = args.findIndex((arg) => SHELL_COMMAND_FLAG.test(arg));
  return flag === -1 ? "" : (args[flag + 1] ?? "");
}

function parseCommand(command: string): ParsedCommand {
  const segments: Segment[] = [];
  const nested: string[] = [];
  let words: string[] = [];
  let word = "";
  let hasWord = false;
  let quote = "";
  let pending: Heredoc[] = [];
  let arithmeticDepth = 0;
  let lineSegment = 0;

  const endWord = (): void => {
    if (hasWord) words.push(word);
    word = "";
    hasWord = false;
  };
  const endSegment = (): void => {
    endWord();
    if (words.length > 0) segments.push({ kind: "command", words });
    words = [];
  };
  const holdNested = (from: number, to: number, mark: string): void => {
    nested.push(command.slice(from, to));
    word += mark;
    hasWord = true;
  };

  for (let index = 0; index < command.length; index++) {
    const char = command.charAt(index);
    const opener =
      quote === "" && arithmeticDepth === 0 ? heredocOpenerAt(command, index) : undefined;
    const isEscape = char === "\\" && quote !== "'" && index + 1 < command.length;
    if (opener !== undefined) {
      pending.push(opener.heredoc);
      word += opener.text;
      hasWord = true;
      index += opener.text.length - 1;
    } else if (isEscape) {
      const escaped = command.charAt(++index);
      if (escaped !== "\n") {
        word += escaped;
        hasWord = true;
      }
    } else if (quote !== "'" && command.startsWith("$(", index)) {
      const end = closingParen(command, index + SUBSTITUTION_OPENER.length);
      holdNested(index + SUBSTITUTION_OPENER.length, end, "$");
      index = end;
    } else if (quote !== "'" && char === "`") {
      const end = indexOrEnd(command, "`", index + 1);
      holdNested(index + 1, end, "`");
      index = end;
    } else if (quote !== "") {
      if (char === quote) quote = "";
      else word += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      hasWord = true;
    } else if (char === "(" || char === ")") {
      if (arithmeticDepth > 0 || command.startsWith("((", index))
        arithmeticDepth += char === "(" ? 1 : -1;
      endSegment();
      segments.push({ kind: char === "(" ? "open" : "close", words: [] });
    } else if (char === "\n") {
      endSegment();
      const end = heredocBodiesEnd(command, index, pending);
      nested.push(
        ...heredocBodyNested(command.slice(index + 1, end), pending, segments.slice(lineSegment)),
      );
      index = end;
      pending = [];
      lineSegment = segments.length;
    } else if (char === "#" && !hasWord) {
      index = indexOrEnd(command, "\n", index) - 1;
    } else if (SEPARATORS.has(char)) {
      endSegment();
    } else if (/\s/.test(char)) {
      endWord();
    } else {
      word += char;
      hasWord = true;
    }
  }
  endSegment();
  return { segments, nested };
}

function closingParen(command: string, from: number): number {
  let depth = 1;
  let pending: Heredoc[] = [];
  for (let index = from; index < command.length; index++) {
    const char = command.charAt(index);
    const opener = heredocOpenerAt(command, index);
    if (opener !== undefined) {
      pending.push(opener.heredoc);
      index += opener.text.length - 1;
    } else if (char === "\n") {
      index = heredocBodiesEnd(command, index, pending);
      pending = [];
    } else if (char === "(") depth++;
    else if (char === ")" && --depth === 0) return index;
  }
  return command.length;
}

function heredocOpenerAt(
  command: string,
  index: number,
): { text: string; heredoc: Heredoc } | undefined {
  HEREDOC_OPENER.lastIndex = index;
  const match = HEREDOC_OPENER.exec(command);
  if (match === null) return undefined;
  const [text = "", stripTabs = "", quote = "", word = ""] = match;
  return { text, heredoc: { word, stripTabs: stripTabs === "-", expands: quote === "" } };
}

function heredocBodiesEnd(command: string, newline: number, pending: Heredoc[]): number {
  let lineStart = newline + 1;
  for (const heredoc of pending) {
    while (lineStart < command.length) {
      const lineEnd = indexOrEnd(command, "\n", lineStart);
      const line = command.slice(lineStart, lineEnd);
      lineStart = lineEnd + 1;
      const body = heredoc.stripTabs ? line.replace(/^\t+/, "") : line;
      if (body === heredoc.word) break;
    }
  }
  return lineStart - 1;
}

function substitutionsIn(text: string): string[] {
  const found: string[] = [];
  for (let index = 0; index < text.length; index++) {
    if (text.startsWith(SUBSTITUTION_OPENER, index)) {
      const start = index + SUBSTITUTION_OPENER.length;
      const end = closingParen(text, start);
      found.push(text.slice(start, end));
      index = end;
    } else if (text.charAt(index) === "`") {
      const end = indexOrEnd(text, "`", index + 1);
      found.push(text.slice(index + 1, end));
      index = end;
    }
  }
  return found;
}

function heredocBodyNested(body: string, pending: Heredoc[], header: Segment[]): string[] {
  if (pending.length === 0) return [];
  if (header.some(runsScript)) return [body];
  return pending.some((heredoc) => heredoc.expands) ? substitutionsIn(body) : [];
}

function indexOrEnd(text: string, search: string, from: number): number {
  const index = text.indexOf(search, from);
  return index === -1 ? text.length : index;
}

function withoutPrefixes(words: string[]): string[] {
  let start = 0;
  let isAfterNice = false;
  while (start < words.length) {
    const word = words[start] ?? "";
    if (isAfterNice && NICE_ARGUMENT.test(word)) {
      start++;
      continue;
    }
    isAfterNice = word === "nice";
    if (word === "sudo") {
      start = sudoOptionsEnd(words, start + 1);
      continue;
    }
    if (!PREFIX_WORDS.has(word) && !ASSIGNMENT.test(word)) break;
    start++;
  }
  return words.slice(start);
}

function sudoOptionsEnd(words: string[], from: number): number {
  let index = from;
  while ((words[index] ?? "").startsWith("-")) {
    index += SUDO_VALUE_FLAGS.has(words[index] ?? "") ? FLAG_VALUE_WIDTH : 1;
  }
  return index;
}

function resolvePath(dir: string, path: string): string {
  const kept: string[] = [];
  for (const part of (path.startsWith("/") ? path : `${dir}/${path}`).split("/")) {
    if (part === "..") kept.pop();
    else if (part !== "" && part !== ".") kept.push(part);
  }
  return `/${kept.join("/")}`;
}

function withoutRedirections(args: string[]): string[] {
  const kept: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const word = args[index] ?? "";
    const redirection = REDIRECTION.exec(word);
    if (redirection === null) kept.push(word);
    else if (redirection[2] === "") index++;
  }
  return kept;
}

function splitArgs(allArgs: string[]): { flags: string[]; operands: string[] } {
  const args = withoutRedirections(allArgs);
  const dashes = args.indexOf("--");
  const head = dashes === -1 ? args : args.slice(0, dashes);
  const tail = dashes === -1 ? [] : args.slice(dashes + 1);
  const isFlag = (word: string): boolean => word.startsWith("-") && word !== "-";
  return {
    flags: head.filter(isFlag),
    operands: [...head.filter((word) => !isFlag(word)), ...tail],
  };
}

function deleteRisk(args: string[], dir: string): DeleteRisk | undefined {
  const { flags, operands } = splitArgs(args);
  const isRecursive = flags.some((flag) => flag === "--recursive" || RECURSIVE_FLAG.test(flag));
  return isRecursive && operands.length > 0
    ? { kind: "delete", dir, flags, targets: operands }
    : undefined;
}

function pushRisk(args: string[], startDir: string): PushRisk | undefined {
  let dir = startDir;
  let index = 0;
  while (args[index]?.startsWith("-")) {
    const option = args[index];
    const value = args[index + 1];
    if ((option === "-C" || option === "-c") && value !== undefined) {
      if (option === "-C") dir = resolvePath(dir, value);
      index += FLAG_VALUE_WIDTH;
    } else {
      index++;
    }
  }
  if (args[index] !== "push") return undefined;
  const { flags, operands } = splitArgs(args.slice(index + 1));
  const [remote = "", ...refspecs] = operands;
  const isForced = flags.some(isForceFlag) || refspecs.some((refspec) => refspec.startsWith("+"));
  return isForced ? { kind: "push", dir, remote, refspecs } : undefined;
}

function isForceFlag(flag: string): boolean {
  return (
    flag === "--force" ||
    flag === "--force-if-includes" ||
    flag.startsWith("--force-with-lease") ||
    FORCE_FLAG.test(flag)
  );
}

async function reasonFor($: EngineInterface, risks: Risk[]): Promise<string> {
  const losses = await Promise.all(
    risks.map((risk) => (risk.kind === "delete" ? deleteLoss($, risk) : pushLoss($, risk))),
  );
  return [...losses.flat(), FOOTER].join("\n");
}

async function deleteLoss($: EngineInterface, risk: DeleteRisk): Promise<string[]> {
  const losses = await Promise.all(risk.targets.map((target) => targetLoss($, risk, target)));
  return losses.flat();
}

async function targetLoss($: EngineInterface, risk: DeleteRisk, target: string): Promise<string[]> {
  if (SHELL_EXPANSION.test(target)) return [`${target}: uses shell expansion, files not listed`];
  const files = await filesUnder($, risk.dir, target);
  if (files === null) return [`could not list ${target} in time`];
  if (files.length === 0) return [`nothing to remove at ${target}`];
  const command = ["rm", ...risk.flags, target].join(" ");
  return [`${command} would remove ${plural(files.length, "file")}:`, ...shown(files)];
}

async function filesUnder(
  $: EngineInterface,
  dir: string,
  target: string,
): Promise<string[] | null> {
  const slash = target.lastIndexOf("/");
  const parent = slash === -1 ? "." : target.slice(0, slash) || "/";
  const pattern = target.slice(slash + 1);
  if (!GLOB.test(pattern)) return findLines($, dir, [target, "-type", "f"]);
  const matches = await findLines($, dir, [
    parent,
    "-mindepth",
    "1",
    "-maxdepth",
    "1",
    "-name",
    pattern,
  ]);
  if (matches === null || matches.length === 0) return matches;
  const listed = await Promise.all(
    matches.map((match) => findLines($, dir, [match, "-type", "f"])),
  );
  return listed.some((files) => files === null) ? null : listed.flatMap((files) => files ?? []);
}

async function findLines(
  $: EngineInterface,
  dir: string,
  args: string[],
): Promise<string[] | null> {
  const ran = await runIn($, dir, ["find", ...args], LIST_TIMEOUT_MS);
  return ran === null ? null : linesOf(ran.stdout);
}

async function pushLoss($: EngineInterface, risk: PushRisk): Promise<string[]> {
  const targets = await pushTargets($, risk);
  if (targets === null) return ["could not work out the upstream branch"];
  const losses = await Promise.all(targets.map((target) => droppedBy($, risk.dir, target)));
  return losses.flat();
}

async function pushTargets($: EngineInterface, risk: PushRisk): Promise<PushTarget[] | null> {
  if (risk.refspecs.length > 0)
    return risk.refspecs.map((refspec) => targetOf(risk.remote, refspec));
  const ran = await runIn(
    $,
    risk.dir,
    ["git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    LIST_TIMEOUT_MS,
  );
  const upstream = ran?.exitCode === 0 ? ran.stdout.trim() : "";
  const slash = upstream.indexOf("/");
  if (slash === -1) return null;
  const remote = risk.remote === "" ? upstream.slice(0, slash) : risk.remote;
  return [{ remote, branch: upstream.slice(slash + 1), local: "HEAD" }];
}

function targetOf(remote: string, refspec: string): PushTarget {
  const [source = "", destination = source] = refspec.replace(/^\+/, "").split(":");
  return {
    remote,
    branch: destination.startsWith(HEADS_PREFIX)
      ? destination.slice(HEADS_PREFIX.length)
      : destination,
    local: source === "" ? "HEAD" : source,
  };
}

async function droppedBy($: EngineInterface, dir: string, target: PushTarget): Promise<string[]> {
  const name = `${target.remote}/${target.branch}`;
  const listed = await runIn(
    $,
    dir,
    ["git", "ls-remote", target.remote, `refs/heads/${target.branch}`],
    REMOTE_TIMEOUT_MS,
  );
  if (listed?.exitCode !== 0) return [`could not read ${name}`];
  const tip = listed.stdout.split(/\s/)[0] ?? "";
  if (tip === "") return [`${name}: new branch: nothing would be dropped`];
  const known = await runIn($, dir, ["git", "cat-file", "-e", tip], LIST_TIMEOUT_MS);
  if (known?.exitCode !== 0) {
    const short = tip.slice(0, SHORT_SHA_LENGTH);
    return [
      `${name}: remote tip ${short} is not fetched here: the commits it would drop are unknown`,
    ];
  }
  const commits = await runIn(
    $,
    dir,
    ["git", "rev-list", "--oneline", `${target.local}..${tip}`],
    LIST_TIMEOUT_MS,
  );
  if (commits?.exitCode !== 0) return [`could not read ${name}`];
  const lines = linesOf(commits.stdout);
  if (lines.length === 0) return [`${name}: nothing would be dropped`];
  return [`${name} would drop ${plural(lines.length, "commit")}:`, ...shown(lines)];
}

async function runIn(
  $: EngineInterface,
  dir: string,
  argv: string[],
  timeoutMs: number,
): Promise<Ran | null> {
  try {
    const { exitCode, stdout } = await $.process.run(argv, { cwd: dir, timeoutMs });
    return { exitCode, stdout };
  } catch {
    return null;
  }
}

function linesOf(text: string): string[] {
  return text.split("\n").filter((line) => line !== "");
}

function shown(lines: string[]): string[] {
  if (lines.length <= SHOWN_LIMIT) return lines;
  return [...lines.slice(0, SHOWN_LIMIT), `+${lines.length - SHOWN_LIMIT} more`];
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
