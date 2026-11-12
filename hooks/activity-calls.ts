import type { SessionMessage } from "claude-code";

import type { Activity, CallBody, CallCounts, CallDetail, CallRecord } from "../types";
import { cleanText } from "./markdown";
import { kindOf } from "./tools";

const OUTPUT_LINE_CAP = 400;
const READ_LINE_CAP = 400;

const ENGINE_FIELDS = new Set(["tool", "tool_use_id", "agentId"]);
export const BACKGROUND_TAG = "in background";
export const EXIT_CODE_LINE = /^(?:Error: )?Exit code (\d+)(?:\n|$)/;

const TASK_NOTIFICATION = /<task-notification>([\s\S]*?)<\/task-notification>/g;
const HANDBACK_TOOL = "SubagentHandback";
const NOTIFIED_RESULT = /<result>([\s\S]*?)<\/result>/;

type Outcome = { deny?: string; text?: string; result?: unknown; isError?: boolean };
type Hunk = Extract<CallDetail, { kind: "change" }>["hunks"][number];

export function isDenied(call: CallRecord): boolean {
  return call.permission?.kind === "denied";
}

export function isFailure(call: CallRecord): boolean {
  return call.isErrored && !isDenied(call);
}

export const NO_CALL_COUNTS: CallCounts = { kinds: {}, errors: 0 };

export function withCalls(counts: CallCounts, records: CallRecord[]): CallCounts {
  const kinds = { ...counts.kinds };
  for (const record of records) {
    const kind = kindOf(record.tool);
    kinds[kind] = (kinds[kind] ?? 0) + 1;
  }
  return { kinds, errors: counts.errors + records.filter(isFailure).length };
}

export function withoutCounts(counts: CallCounts, cleared: CallCounts | undefined): CallCounts {
  if (cleared === undefined) return counts;
  const kinds = { ...counts.kinds };
  for (const [kind, count] of Object.entries(cleared.kinds)) {
    kinds[kind] = (kinds[kind] ?? 0) - (count ?? 0);
  }
  return { kinds, errors: counts.errors - cleared.errors };
}

export function totalOf(counts: CallCounts): number {
  return Object.values(counts.kinds).reduce<number>((sum, count) => sum + (count ?? 0), 0);
}

export function isHandbackTool(tool: string): boolean {
  return tool === HANDBACK_TOOL;
}

type BashResult = {
  stdout: string;
  stderr: string;
  interrupted: boolean;
  backgroundTaskId?: unknown;
  returnCodeInterpretation?: string;
};

type ChangeResult = {
  filePath?: unknown;
  structuredPatch?: unknown;
  type?: unknown;
  content?: unknown;
};

type ReadResult = {
  type: string;
  file: {
    filePath: string;
    content: string;
    numLines: number;
    startLine: number;
    totalLines: number;
  };
};

export function callRecord(
  call: object,
  entry: Activity,
  outcome: Outcome,
  agentId: string | undefined,
): CallRecord & CallBody {
  const detail = detailOf(call, outcome);
  const launchedAgentId = launchedAgentOf(call, outcome.result);
  return {
    ...entry,
    agentId,
    ...(launchedAgentId === undefined ? {} : { launchedAgentId }),
    input: cappedLines(inputOf(call)),
    fields: fieldsOf(call),
    output: cappedLines(outputOf(outcome)),
    ...(detail === undefined ? {} : { detail }),
  };
}

export function launchedAgentOf(call: object, result: unknown): string | undefined {
  if (Reflect.get(call, "tool") !== "Agent") return undefined;
  const record = result as { status?: unknown; agentId?: unknown } | null | undefined;
  if (record?.status !== "async_launched") return undefined;
  return typeof record.agentId === "string" ? record.agentId : undefined;
}

export function agentReportOf(messages: SessionMessage[], callId: string): string | undefined {
  const bodies = messages
    .flatMap((message) => [...message.text.matchAll(TASK_NOTIFICATION)])
    .map(([, body = ""]) => body)
    .filter((body) => body.includes(`<tool-use-id>${callId}</tool-use-id>`));
  const body = bodies.at(-1);
  return body === undefined ? undefined : (NOTIFIED_RESULT.exec(body)?.[1] ?? body).trim();
}

export function handbackReportOf(agentMessages: SessionMessage[]): string | undefined {
  const message = agentMessages
    .flatMap((row) => row.toolUses)
    .filter((use) => use.tool === HANDBACK_TOOL)
    .at(-1)?.input.message;
  return typeof message === "string" ? message.trim() : undefined;
}

export function detailOf(call: object, outcome: Outcome): CallDetail | undefined {
  const tool: unknown = Reflect.get(call, "tool");
  if (tool === "Bash") return bashDetail(call, outcome);
  if (tool === "Edit" || tool === "Write") return changeDetail(outcome.result);
  if (tool === "Read") return readDetail(outcome.result);
  return undefined;
}

function bashDetail(call: object, outcome: Outcome): CallDetail | undefined {
  const command = commandOf(call);
  if (outcome.isError === true) {
    const text = bashErrorText(outcome);
    return text === undefined ? undefined : bashFailureDetail(command, text);
  }
  return bashResultDetail(command, outcome.result);
}

function commandOf(call: object): string {
  const command: unknown = Reflect.get(call, "command");
  return typeof command === "string" ? cleanText(command) : "";
}

function bashErrorText(outcome: Outcome): string | undefined {
  if (outcome.text !== undefined) return outcome.text;
  return typeof outcome.result === "string" ? outcome.result : undefined;
}

function bashFailureDetail(command: string, raw: string): CallDetail {
  const text = cleanText(raw);
  const match = EXIT_CODE_LINE.exec(text);
  const merged = keptLines(match === null ? text : text.slice(match[0].length));
  return {
    kind: "bash",
    command,
    stdout: "",
    stderr: merged.text,
    exitCode: match === null ? null : Number(match[1]),
    tag: "",
    droppedLines: merged.dropped,
  };
}

function bashResultDetail(command: string, result: unknown): CallDetail | undefined {
  const record = result as BashResult | null | undefined;
  if (typeof record?.stdout !== "string") return undefined;
  const tag = bashTag(record);
  const stdout = keptLines(record.stdout);
  const stderr = keptLines(record.stderr);
  return {
    kind: "bash",
    command,
    stdout: stdout.text,
    stderr: stderr.text,
    exitCode: tag === "" ? 0 : null,
    tag,
    droppedLines: stdout.dropped + stderr.dropped,
  };
}

function bashTag(record: BashResult): string {
  if (record.interrupted) return "interrupted";
  if (typeof record.backgroundTaskId === "string") return BACKGROUND_TAG;
  return record.returnCodeInterpretation ?? "";
}

function changeDetail(result: unknown): CallDetail | undefined {
  const record = result as ChangeResult | null | undefined;
  if (typeof record?.filePath !== "string" || !Array.isArray(record.structuredPatch)) {
    return undefined;
  }
  const isCreate = record.type === "create";
  return {
    kind: "change",
    filePath: cleanText(record.filePath),
    isCreate,
    hunks: (record.structuredPatch as Hunk[]).map((hunk) => ({
      ...hunk,
      lines: hunk.lines.map((line) => cleanText(line)),
    })),
    content: isCreate && typeof record.content === "string" ? cleanText(record.content) : "",
  };
}

function readDetail(result: unknown): CallDetail | undefined {
  const record = result as ReadResult | null | undefined;
  if (record?.type !== "text") return undefined;
  const { filePath, content, startLine, totalLines } = record.file;
  const text = cleanText(content);
  const numLines = text === "" ? 0 : text.replace(/\n$/, "").split("\n").length;
  const isEndReached = startLine + record.file.numLines - 1 >= totalLines;
  return {
    kind: "read",
    filePath: cleanText(filePath),
    content: firstLines(text),
    startLine,
    numLines,
    totalLines: isEndReached ? startLine + numLines - 1 : totalLines - 1,
  };
}

function firstLines(text: string): string {
  return text.split("\n").slice(0, READ_LINE_CAP).join("\n");
}

function fieldsOf(call: object): { name: string; value: string }[] {
  return inputEntries(call).map(([name, value]) => ({
    name,
    value: cappedLines(typeof value === "string" ? value : JSON.stringify(value)),
  }));
}

function inputEntries(call: object): [string, unknown][] {
  return Object.entries(call).filter(
    ([name, value]) => !ENGINE_FIELDS.has(name) && value !== undefined,
  );
}

function inputOf(call: object): string {
  const fields = inputEntries(call);
  const [only] = fields;
  if (fields.length === 1 && typeof only?.[1] === "string") return only[1];
  return fields
    .map(([name, value]) => `${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join("\n");
}

function outputOf(outcome: Outcome): string {
  if (outcome.deny !== undefined) return outcome.deny;
  if (outcome.text !== undefined) return outcome.text;
  return typeof outcome.result === "string"
    ? outcome.result
    : // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      (JSON.stringify(outcome.result, null, 2) ?? "");
}

function keptLines(text: string): { text: string; dropped: number } {
  const lines = cleanText(text).split("\n");
  return {
    text: lines.slice(0, OUTPUT_LINE_CAP).join("\n"),
    dropped: Math.max(0, lines.length - OUTPUT_LINE_CAP),
  };
}

export function cappedLines(text: string): string {
  const lines = cleanText(text).split("\n");
  if (lines.length <= OUTPUT_LINE_CAP) return lines.join("\n");
  return [
    ...lines.slice(0, OUTPUT_LINE_CAP),
    `… ${lines.length - OUTPUT_LINE_CAP} more lines`,
  ].join("\n");
}
