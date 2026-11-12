const SEPARATORS = new Set([";", "&", "|", "(", ")", "\n"]);
const LEADING_WORDS = new Set(
  "if then else elif fi do done while until case esac ! { } exec command nohup time env".split(" "),
);
const PLUMBING = new Set(
  "[ [[ test true false : echo printf print cat read jq export set unset cd exit return local umask trap sleep zmodload dirname basename tee xargs".split(
    " ",
  ),
);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "fish"]);
const INTERPRETERS = new Set(
  "node nodejs python python3 bun deno ruby perl tsx ts-node sh bash zsh dash".split(" "),
);
const RUNNERS = new Set(["bun", "deno"]);
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
const REDIRECT_START = /^\d*(>>?|<<?|>&|<&|&>)/;
const REDIRECT_ONLY = /^\d*(>>?|<<?|>&|<&|&>)$/;
const COMMAND_FLAG = /^-[A-Za-z]*c[A-Za-z]*$/;
const SCRIPT_LIKE = /\/|\.\w+$/;
const SUBCOMMAND = /^[a-z][a-z0-9-]*$/;
const DEFAULTED_VARIABLE = /^\$\{\w+:?-([^}]*)\}$/;
const BARE_VARIABLE = /^\$\{?(\w+)\}?$/;
const MAX_SUBCOMMANDS = 3;
const HOOK_RUNNER_WORD = "hooks";
const MAX_SCRIPT_DEPTH = 3;
const FALLBACK_NAME = "command";
const NAME_RUN = /^[\w.@+-]+/;

export function hookCommandName(command: string): string {
  return nameOf(command, 0);
}

function nameOf(command: string, depth: number): string {
  let fallback: string | undefined;
  for (const words of simpleCommands(command)) {
    const name = programName(words, depth);
    if (name === undefined) continue;
    if (!PLUMBING.has(name.split(" ")[0] ?? "")) return name;
    fallback ??= name;
  }
  return fallback ?? FALLBACK_NAME;
}

function programName(words: readonly string[], depth: number): string | undefined {
  const [program, ...args] = withoutLeadingWords(withoutRedirections(words));
  if (program === undefined) return undefined;
  const base = baseOf(program);
  if (SHELLS.has(base)) {
    const name = shellScriptName(args, depth);
    if (name !== undefined) return name;
  }
  const scriptIndex = INTERPRETERS.has(base) ? scriptIndexOf(base, args) : -1;
  if (scriptIndex < 0) return withSubcommands(base, args);
  return withSubcommands(baseOf(args[scriptIndex] ?? ""), args.slice(scriptIndex + 1));
}

function shellScriptName(args: readonly string[], depth: number): string | undefined {
  const flagIndex = args.findIndex((word) => COMMAND_FLAG.test(word));
  const script = args[flagIndex + 1];
  if (flagIndex < 0 || script === undefined) return undefined;
  const scriptName = args[flagIndex + 2];
  if (scriptName !== undefined)
    return withPositionalWords(baseOf(scriptName), args.slice(flagIndex + 3));
  return depth < MAX_SCRIPT_DEPTH ? nameOf(script, depth + 1) : undefined;
}

function scriptIndexOf(interpreter: string, args: readonly string[]): number {
  const index = args.findIndex(
    (word) => !word.startsWith("-") && !(RUNNERS.has(interpreter) && word === "run"),
  );
  return SCRIPT_LIKE.test(args[index] ?? "") ? index : -1;
}

function withSubcommands(base: string, args: readonly string[]): string {
  const subcommands: string[] = [];
  for (const word of args) {
    if (!SUBCOMMAND.test(word) || subcommands.length === MAX_SUBCOMMANDS) break;
    subcommands.push(word);
  }
  const [runnerWord, ...hookWords] = subcommands;
  if (runnerWord === HOOK_RUNNER_WORD && hookWords.length > 0)
    return `${base} ${hookWords.at(-1)!}`;
  return [base, ...subcommands].join(" ");
}

function withPositionalWords(base: string, args: readonly string[]): string {
  const words = args.filter((word) => SUBCOMMAND.test(word)).slice(0, MAX_SUBCOMMANDS);
  return [base, ...words].join(" ");
}

function baseOf(word: string): string {
  const resolved = DEFAULTED_VARIABLE.exec(word)?.[1] || BARE_VARIABLE.exec(word)?.[1] || word;
  const base = resolved.slice(resolved.lastIndexOf("/") + 1);
  return NAME_RUN.exec(base)?.[0] ?? base;
}

function withoutRedirections(words: readonly string[]): string[] {
  const kept: string[] = [];
  let skipsNext = false;
  for (const word of words) {
    const skipped = skipsNext || REDIRECT_START.test(word);
    skipsNext = !skipsNext && REDIRECT_ONLY.test(word);
    if (!skipped) kept.push(word);
  }
  return kept;
}

function withoutLeadingWords(words: readonly string[]): string[] {
  let start = 0;
  while (start < words.length && isLeading(words[start]!, words[start - 1])) start += 1;
  return words.slice(start);
}

function isLeading(word: string, previous: string | undefined): boolean {
  if (previous === "env" && word.startsWith("-")) return true;
  return ASSIGNMENT.test(word) || LEADING_WORDS.has(word);
}

function simpleCommands(text: string): string[][] {
  const commands: string[][] = [[]];
  const pending = { text: "", isOpen: false };
  const add = (part: string) => {
    pending.text += part;
    pending.isOpen = true;
  };
  const endWord = () => {
    if (pending.isOpen) commands[commands.length - 1]!.push(pending.text);
    pending.text = "";
    pending.isOpen = false;
  };
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (char === "\\") {
      add(text[index + 1] ?? "");
      index += 2;
    } else if (char === "'" || char === '"') {
      const { value, next } = quoted(text, index);
      add(value);
      index = next;
    } else if (isSubstitution(text, index)) {
      const end = substitutionEnd(text, index);
      add(text.slice(index, end));
      index = end;
    } else {
      if (/\s/.test(char) && char !== "\n") endWord();
      else if (isRedirectAmpersand(char, pending.text, text[index + 1])) add(char);
      else if (SEPARATORS.has(char)) {
        endWord();
        commands.push([]);
      } else add(char);
      index += 1;
    }
  }
  endWord();
  return commands;
}

function isRedirectAmpersand(char: string, word: string, following: string | undefined): boolean {
  return char === "&" && (/[<>]$/.test(word) || following === ">");
}

function quoted(text: string, start: number): { value: string; next: number } {
  const quote = text[start];
  let value = "";
  let index = start + 1;
  while (index < text.length && text[index] !== quote) {
    if (quote === '"' && text[index] === "\\") {
      value += text[index + 1] ?? "";
      index += 2;
    } else if (quote === '"' && isSubstitution(text, index)) {
      const end = substitutionEnd(text, index);
      value += text.slice(index, end);
      index = end;
    } else {
      value += text[index]!;
      index += 1;
    }
  }
  return { value, next: index + 1 };
}

function isSubstitution(text: string, index: number): boolean {
  return text[index] === "$" && (text[index + 1] === "(" || text[index + 1] === "{");
}

function substitutionEnd(text: string, start: number): number {
  const open = text[start + 1]!;
  const close = open === "(" ? ")" : "}";
  let depth = 0;
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === open) depth += 1;
    if (text[index] === close) depth -= 1;
    if (depth === 0) return index + 1;
  }
  return text.length;
}
