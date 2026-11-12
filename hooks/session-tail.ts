import type { EngineInterface } from "claude-code";

import { singleLine } from "./format";

export type SessionTail = {
  prompt: string | null;
  model: string | null;
  tool: { name: string; since: number } | null;
};

type OpenTool = { name: string; since: number };

type ScanState = {
  offset: number;
  prompt: string | null;
  typedPrompt: string | null;
  model: string | null;
  openTools: Map<string, OpenTool>;
};

type TranscriptBlock = {
  type?: string;
  id?: string;
  name?: string;
  tool_use_id?: string;
  text?: string;
};

type TranscriptRow = {
  type?: string;
  model?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  lastPrompt?: string;
  timestamp?: string;
  message?: { model?: string; content?: TranscriptBlock[] | string };
};

const FIRST_READ_BYTES = 4 * 1024 * 1024;
const CUT_MARK = /…$/u;
const INJECTED_PROMPT =
  /^\s*(<(task-notification|command-|local-command-|system-reminder|bash-)|This session is being continued|\[Request interrupted)/u;
const SYNTHETIC_MODEL = "<synthetic>";
const EMPTY_TAIL: SessionTail = { prompt: null, model: null, tool: null };
const RANGE_SCAN_SCRIPT = String.raw`{ tail -c +"$1" "$2" | head -c "$3"; echo; } | LC_ALL=C awk '{ prev = held; held = $0; $0 = prev }
NR > 1 && $0 !~ /"isSidechain":true/ {
  if ($0 ~ /"type":"assistant"/) {
    if ($0 !~ /<synthetic>/ && match($0, /"model":"[^"]+"/)) model = substr($0, RSTART, RLENGTH)
    stamp = match($0, /"timestamp":"[^"]*"/) ? substr($0, RSTART, RLENGTH) "," : ""
    rest = $0
    while (match(rest, /"type":"tool_use","id":"[^"]*","name":"[^"]*"/)) {
      use = substr(rest, RSTART, RLENGTH)
      rest = substr(rest, RSTART + RLENGTH)
      match(use, /"id":"[^"]*"/)
      id = substr(use, RSTART + 6, RLENGTH - 7)
      uses[++count] = use
      stamps[count] = stamp
      ids[count] = id
      openAt[id] = count
    }
  }
  if ($0 ~ /"type":"user"/) {
    rest = $0
    while (match(rest, /"tool_use_id":"[^"]*"/)) {
      id = substr(rest, RSTART + 15, RLENGTH - 16)
      rest = substr(rest, RSTART + RLENGTH)
      if (id in openAt) delete openAt[id]
      else print "{\"type\":\"user\",\"message\":{\"content\":[{\"type\":\"tool_result\",\"tool_use_id\":\"" id "\"}]}}"
    }
    if ($0 !~ /"isMeta":true/) {
      if (match($0, /"role":"user","content":"([^"\\]|\\.)*"/) && RLENGTH <= 20000) cand = substr($0, RSTART, RLENGTH)
      else if (match($0, /"role":"user","content":\[\{"type":"text","text":"([^"\\]|\\.)*"/) && RLENGTH <= 20000) cand = substr($0, RSTART, RLENGTH) "}]"
      else cand = ""
      if (cand != "" && cand !~ /^"role":"user","content":("|\[\{"type":"text","text":")(\\n|\\t| )*(<(task-notification|command-|local-command-|system-reminder|bash-)|This session is being continued|\[Request interrupted)/) {
        typed = cand
        typedAt = NR
      }
    }
  }
  if ($0 ~ /"type":"last-prompt"/) {
    promptAt = NR
    if (match($0, /"lastPrompt":"([^"\\]|\\.)*"/) && RLENGTH <= 20000) lastPrompt = substr($0, RSTART, RLENGTH)
  }
}
END {
  if (model != "") print "{" model "}"
  if (typed != "" && typedAt < promptAt) print "{\"type\":\"user\",\"message\":{" typed "}}"
  if (lastPrompt != "") print "{\"type\":\"last-prompt\"," lastPrompt "}"
  for (i = 1; i <= count; i++)
    if (openAt[ids[i]] == i) print "{\"type\":\"assistant\"," stamps[i] "\"message\":{\"content\":[{" uses[i] "}]}}"
  if (typed != "" && typedAt > promptAt) print "{\"type\":\"user\",\"message\":{" typed "}}"
  print length(held)
}'`;

const scans = new Map<string, ScanState>();
let queue: Promise<void> = Promise.resolve();

export function sessionTailOf(text: string): SessionTail {
  const scan = freshScan();
  feedScan(scan, text.split("\n"));
  return tailOfScan(scan);
}

export function cachedTail(path: string | null | undefined): SessionTail {
  const scan = path ? scans.get(path) : undefined;
  return scan === undefined ? EMPTY_TAIL : tailOfScan(scan);
}

export function refreshSessionTails(
  $: EngineInterface,
  paths: (string | null | undefined)[],
): Promise<void> {
  const wanted = paths.filter((path): path is string => Boolean(path));
  const run = queue.then(async () => {
    for (const path of scans.keys()) if (!wanted.includes(path)) scans.delete(path);
    await Promise.all(wanted.map((path) => refreshTail($, path)));
  });
  queue = run.catch(() => undefined);
  return run;
}

async function refreshTail($: EngineInterface, path: string): Promise<void> {
  const size = (await $.fs.stat(path).catch(() => undefined))?.size;
  if (size === undefined) {
    scans.delete(path);
    return;
  }
  const known = scans.get(path);
  const isReusable =
    known !== undefined && size >= known.offset && size - known.offset <= FIRST_READ_BYTES;
  const scan = isReusable ? known : freshScan(size);
  scans.set(path, scan);
  if (size === scan.offset) return;
  try {
    const { stdout } = await $.process.run([
      "sh",
      "-c",
      RANGE_SCAN_SCRIPT,
      "sh",
      String(scan.offset + 1),
      path,
      String(size - scan.offset),
    ]);
    const lines = stdout.trimEnd().split("\n");
    const unterminatedBytes = Number(lines.pop());
    feedScan(scan, lines);
    scan.offset = size - unterminatedBytes;
  } catch {
    scans.delete(path);
  }
}

function freshScan(size = 0): ScanState {
  return {
    offset: Math.max(0, size - FIRST_READ_BYTES),
    prompt: null,
    typedPrompt: null,
    model: null,
    openTools: new Map(),
  };
}

function tailOfScan(scan: ScanState): SessionTail {
  return {
    prompt: scan.prompt,
    model: scan.model,
    tool: [...scan.openTools.values()].at(-1) ?? null,
  };
}

function feedScan(scan: ScanState, lines: string[]): void {
  for (const row of rowsOf(lines)) {
    if (row.isSidechain === true) continue;
    if (row.model && row.model !== SYNTHETIC_MODEL) scan.model = row.model;
    const typedText = typedPromptOf(row);
    if (typedText !== undefined) {
      scan.typedPrompt = singleLine(typedText).trim() || null;
      scan.prompt = scan.typedPrompt;
    }
    if (row.type === "last-prompt") feedLastPrompt(scan, singleLine(row.lastPrompt ?? "").trim());
    const message = row.message;
    if (row.type === "assistant" && message?.model && message.model !== SYNTHETIC_MODEL)
      scan.model = message.model;
    const blocks = Array.isArray(message?.content) ? message.content : [];
    for (const block of blocks) {
      if (row.type === "assistant" && block.type === "tool_use" && block.id && block.name)
        scan.openTools.set(block.id, {
          name: block.name,
          since: Date.parse(row.timestamp ?? ""),
        });
      if (row.type === "user" && block.type === "tool_result" && block.tool_use_id)
        scan.openTools.delete(block.tool_use_id);
    }
  }
}

function isInjected(text: string): boolean {
  return INJECTED_PROMPT.test(text);
}

function feedLastPrompt(scan: ScanState, text: string): void {
  const isCutTypedPrompt = scan.typedPrompt?.startsWith(text.replace(CUT_MARK, "")) === true;
  if (isCutTypedPrompt) {
    scan.prompt = scan.typedPrompt;
    return;
  }
  scan.typedPrompt = null;
  scan.prompt = text || null;
}

function typedPromptOf(row: TranscriptRow): string | undefined {
  const content = row.message?.content;
  if (row.type !== "user" || row.isMeta === true || content === undefined) return undefined;
  if (typeof content === "string") return isInjected(content) ? undefined : content;
  if (content.some((block) => block.type === "tool_result")) return undefined;
  const text = content.find((block) => block.type === "text")?.text;
  return text === undefined || isInjected(text) ? undefined : text;
}

function rowsOf(lines: string[]): TranscriptRow[] {
  return lines.flatMap((line) => {
    try {
      return [JSON.parse(line) as TranscriptRow];
    } catch {
      return [];
    }
  });
}
