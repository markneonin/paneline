import { atom, read, update } from "claude-code";
import type { EngineInterface } from "claude-code";

import type { HistoryEntry, PastMatch } from "../types";
import { commandLine } from "./command-line";
import { singleLine } from "./format";
import { CSI_SEQUENCE } from "./markdown";
import { folderName } from "./paths";
import { bundledRipgrep, RIPGREP_ENV, transcriptLines } from "./transcript-lines";
import { isTypedOrigin } from "./typed-origin";

const pastAtom = atom(
  { plugin: "paneline", key: "historyPast" } as const,
  null as PastMatch[] | null,
);

const historyAtom = atom({ plugin: "paneline", key: "history" } as const, [] as HistoryEntry[]);

export const PAST_LIMIT = 50;
const LINE_BREAK = /\r?\n|\r/;
const MARKUP = /<\/?[a-z][^>]*>|\*\*|`/gi;
const LIST_MARK = /^\s*(?:[-*>|]|\d+\.)\s+/;
const SYSTEM_WRAPPER =
  /^\s*(?:<(?:task-notification|local-command-(?:stdout|stderr|caveat)|bash-(?:input|stdout|stderr))>|\[Request interrupted by user)/;

let generation = 0;
let spawned = 0;
let running: ReturnType<EngineInterface["process"]["spawn"]> | undefined;

export async function searchPast($: EngineInterface, text: string): Promise<void> {
  const mine = ++generation;
  void running?.return({ code: null, signal: null });
  await update($, pastAtom, () => null);
  if (text === "") return;
  const [home, entries, session] = await Promise.all([
    $.env.get("HOME"),
    read($, historyAtom),
    $.session.id(),
  ]);
  if (spawned > mine) return;
  spawned = mine;
  void running?.return({ code: null, signal: null });
  const folder = home ?? "";
  const listed = new Set(entries.map((entry) => entry.id));
  const found = new Map<string, PastMatch>();
  let tail = "";
  try {
    running = $.process.spawn({
      argv: [
        bundledRipgrep(folder),
        "--fixed-strings",
        "--ignore-case",
        "--no-messages",
        "--no-filename",
        "--max-depth",
        "2",
        "--glob",
        "*.jsonl",
        "--sortr",
        "modified",
        "--",
        JSON.stringify(text).slice(1, -1),
        `${folder}/.claude/projects`,
      ],
      env: RIPGREP_ENV,
    });
    for await (const piece of running) {
      if (generation !== mine) return;
      if (!("stream" in piece) || piece.stream !== "stdout") continue;
      const lines = `${tail}${piece.text}`.split(LINE_BREAK);
      tail = lines.pop() ?? "";
      for (const line of lines) collect(found, pastMatchOf(line, text, { listed, session }));
      if (found.size >= PAST_LIMIT) break;
    }
  } catch (error) {
    $.ui.toast(`Past session search failed: ${String(error)}`);
    return;
  }
  if (generation !== mine) return;
  collect(found, pastMatchOf(tail, text, { listed, session }));
  await update($, pastAtom, () => [...found.values()].sort(newestFirst));
}

function collect(found: Map<string, PastMatch>, rows: PastMatch[]): void {
  for (const row of rows) {
    if (found.size >= PAST_LIMIT) return;
    const key = [row.project, row.branch, row.line, row.isReply === true].join("\u0000");
    if (!found.has(key)) found.set(key, row);
  }
}

function newestFirst(left: PastMatch, right: PastMatch): number {
  return right.date.localeCompare(left.date);
}

export function readable(line: string): string {
  return singleLine(line.replace(CSI_SEQUENCE, ""))
    .replace(MARKUP, "")
    .replace(LIST_MARK, "")
    .trim();
}

export type TranscriptRow = HistoryEntry & { text: string };

export async function* transcriptRows(
  $: EngineInterface,
  path: string,
): AsyncGenerator<TranscriptRow> {
  for await (const line of transcriptLines($, path)) yield* entryOf(line);
}

export function entryOf(raw: string): TranscriptRow[] {
  const row = parsedRow(raw);
  if (row === null || typeof row.uuid !== "string" || typeof row.timestamp !== "string") return [];
  const body = listedBodyOf(row)?.trim() ?? "";
  if (body === "") return [];
  return [
    {
      kind: row.type === "assistant" ? "reply" : "prompt",
      id: row.uuid,
      at: Date.parse(row.timestamp),
      text: entryTextOf(row, body),
      ...(row.type === "attachment" && { absorbed: true }),
    },
  ];
}

function entryTextOf(row: Row, body: string): string {
  if (row.type === "assistant") return body;
  return commandLine(body) || body;
}

function listedBodyOf(row: Row): string | null {
  if (row.type === "system") return row.subtype === "local_command" ? commandBodyOf(row) : null;
  if (row.type === "attachment") {
    const { attachment } = row;
    if (attachment?.type !== "queued_command" || attachment.commandMode !== "prompt") return null;
    if (attachment.origin?.kind !== undefined && attachment.origin.kind !== "human") return null;
    return promptTextOf(attachment.prompt);
  }
  if (
    row.isMeta === true ||
    row.isCompactSummary === true ||
    row.isSidechain === true ||
    row.promptSource === "system"
  )
    return null;
  const body = textOf(row);
  return isListed(row, body) ? body : null;
}

function commandBodyOf(row: Row): string | null {
  return typeof row.content === "string" && commandLine(row.content) !== "" ? row.content : null;
}

type Own = { listed: Set<string>; session: string };

function pastMatchOf(raw: string, needle: string, { listed, session }: Own): PastMatch[] {
  const row = parsedRow(raw);
  if (row === null || row.sessionId === session) return [];
  if (typeof row.uuid === "string" && listed.has(row.uuid)) return [];
  const body = listedBodyOf(row);
  if (body === null) return [];
  const lowered = needle.toLowerCase();
  const line = body.split(LINE_BREAK).find((one) => one.toLowerCase().includes(lowered));
  if (line === undefined) return [];
  return [
    {
      date: typeof row.timestamp === "string" ? row.timestamp : "",
      project: typeof row.cwd === "string" ? folderName(row.cwd) : "",
      branch: typeof row.gitBranch === "string" ? row.gitBranch : "",
      line: readable(line),
      ...(row.type === "assistant" ? { isReply: true as const } : {}),
      ...(typeof row.sessionId === "string" && typeof row.cwd === "string"
        ? { sessionId: row.sessionId, cwd: row.cwd }
        : {}),
    },
  ];
}

function isListed(row: Row, body: string): boolean {
  if (row.type === "user" && (row.origin !== undefined || row.promptSource !== undefined))
    return isTypedRow(row);
  return !SYSTEM_WRAPPER.test(body);
}

function isTypedRow(row: Row): boolean {
  const kind = typeof row.origin?.kind === "string" ? row.origin.kind : row.promptSource;
  if (typeof kind !== "string") return false;
  return isTypedOrigin({ kind: liveKind(kind), asUser: row.origin?.asUser === true });
}

function liveKind(transcriptKind: string): string {
  return transcriptKind === "human" || transcriptKind === "typed" || transcriptKind === "queued"
    ? "composer"
    : transcriptKind;
}

type Row = {
  type?: string;
  subtype?: unknown;
  content?: unknown;
  message?: { content?: unknown };
  isMeta?: boolean;
  isCompactSummary?: boolean;
  isSidechain?: boolean;
  promptSource?: unknown;
  origin?: { kind?: unknown; asUser?: unknown };
  attachment?: {
    type?: unknown;
    commandMode?: unknown;
    prompt?: unknown;
    origin?: { kind?: unknown };
  };
  uuid?: unknown;
  sessionId?: unknown;
  timestamp?: unknown;
  cwd?: unknown;
  gitBranch?: unknown;
};

function parsedRow(raw: string): Row | null {
  try {
    return JSON.parse(raw) as Row;
  } catch {
    return null;
  }
}

function textOf(row: Row): string {
  const content = row.message?.content;
  if (typeof content === "string") return row.type === "user" ? content : "";
  if (!Array.isArray(content)) return "";
  const blocks = content as { type?: string; text?: unknown }[];
  if (row.type === "user" && blocks.some((block) => block.type === "tool_result")) return "";
  if (row.type !== "user" && row.type !== "assistant") return "";
  return joinedText(blocks);
}

function promptTextOf(prompt: unknown): string | null {
  if (typeof prompt === "string") return prompt;
  return Array.isArray(prompt) ? joinedText(prompt as { type?: string; text?: unknown }[]) : null;
}

function joinedText(blocks: { type?: string; text?: unknown }[]): string {
  return blocks.flatMap((block) => (block.type === "text" ? [String(block.text)] : [])).join("\n");
}
