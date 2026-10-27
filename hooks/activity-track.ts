import { atom, memberOf, read, update } from "claude-code";
import type {
  EngineInterface,
  On,
  Timer,
  ToolCallInput,
  ToolCallResult,
  TurnCompleteInput,
} from "claude-code";

import type { Activity, AgentEdit, CallRecord, RunningCall, TurnStats } from "../types";
import { callRecord } from "./activity-calls";
import {
  afterMainTurn,
  emptySpend,
  rentRowOf,
  SPEND_SESSIONS_KEY,
  withRent,
  withSession,
} from "./spend-model";
import { isEditTool, isProgressTool, targetOf } from "./tools";

const KEPT_CALLS = 50;
const KEPT_ACTIVITY = 400;
const KEPT_AGENT_EDITS = 400;
const AGENT_BATCH_MS = 1000;
export const UNMEASURED_MS = -1;
const CALLS_PER_NOTE = 8;
const FULL_PERCENT = 100;
const PROGRESS_NOTE = "Call the progress tool with your estimated percent of the whole task done.";

const activityAtom = atom({ plugin: "paneline", key: "activity" } as const, []);
const agentEditsAtom = atom({ plugin: "paneline", key: "agentEdits" } as const, [] as AgentEdit[]);
const totalMsAtom = atom({ plugin: "paneline", key: "totalMs" } as const, 0);
const callsAtom = atom({ plugin: "paneline", key: "calls" } as const, [] as CallRecord[]);
const runningAtom = atom({ plugin: "paneline", key: "running" } as const, [] as RunningCall[]);
const toolMsAtom = atom({ plugin: "paneline", key: "toolMs" } as const, UNMEASURED_MS);
const turnStatsAtom = atom({ plugin: "paneline", key: "turnStats" } as const, null);

const progressAtom = atom({ plugin: "paneline", key: "progress" } as const, {
  tasks: {},
  percent: null as number | null,
});
const callsSinceNoteAtom = atom({ plugin: "paneline", key: "callsSinceNote" } as const, 0);

const spendAtom = atom({ plugin: "paneline", key: "spend" } as const, emptySpend());

let turnActivity: Activity[] = [];
let pendingAgentCalls: CallRecord[] = [];
let pendingAgentEdits: AgentEdit[] = [];
let pendingBatch: Timer | undefined;

export function trackActivity(on: On): void {
  on("turn.start", ($, e, next) => {
    turnActivity = [];
    return next(e);
  });

  on("tool.call", async ($, e, next) => {
    if (isProgressTool(e.tool)) return next(e);
    const startedAt = await $.clock.now();
    const ran = await (e.agentId === undefined ? runningMainCall($, e, next) : next(e));
    const entry = activityOf(e, ran, (await $.clock.now()) - startedAt);
    const record = callRecord(e, entry, ran, e.agentId);
    if (e.agentId !== undefined) {
      recordAgentCall($, e.agentId, entry, record);
      return ran;
    }
    await Promise.all([
      writeCalls($, record),
      recordMainCall($, e.tool_use_id, entry),
      recordRent($, e, ran),
    ]);
    return withProgressNote($, ran);
  });

  on("turn.complete", async ($, e, next) => {
    if (e.agentId !== undefined) return next(e);
    const stats = turnStats(turnActivity);
    await update($, memberOf(turnStatsAtom, { requestId: String(e.durationMs) }), () => stats);
    await update($, totalMsAtom, (total) => total + e.durationMs);
    await recordMainSpend($, e);
    await completeProgress($, e);
    return next(e);
  });
}

async function withProgressNote($: EngineInterface, ran: ToolCallResult): Promise<ToolCallResult> {
  const [calls, { tasks }] = await Promise.all([
    update($, callsSinceNoteAtom, (count) => count + 1),
    read($, progressAtom),
  ]);
  const isNoteDue = calls >= CALLS_PER_NOTE && Object.keys(tasks).length === 0;
  if (!isNoteDue || ran.deny !== undefined) return ran;
  await update($, callsSinceNoteAtom, () => 0);
  return { ...ran, context: [...(ran.context ?? []), PROGRESS_NOTE] };
}

async function completeProgress($: EngineInterface, e: TurnCompleteInput): Promise<void> {
  if (e.reason !== "answer") return;
  const listed = await $.agent.list();
  if (listed.some((agent) => agent.status === "running")) return;
  const { percent } = await read($, progressAtom);
  if (percent === null || percent === FULL_PERCENT) return;
  await update($, progressAtom, (current) => ({ ...current, percent: FULL_PERCENT }));
}

async function recordRent(
  $: EngineInterface,
  e: ToolCallInput,
  ran: ToolCallResult,
): Promise<void> {
  if (ran.text === undefined) return;
  const row = rentRowOf(
    { tool: e.tool, target: targetOf(e), cwd: await $.session.cwd() },
    ran.text,
  );
  await update($, spendAtom, (state) => withRent(state, row));
}

async function recordMainSpend($: EngineInterface, e: TurnCompleteInput): Promise<void> {
  if (e.usage === undefined) return;
  const [endedAt, usage] = await Promise.all([$.clock.now(), $.session.usage()]);
  const turn = {
    usage: e.usage,
    context: usage.context.tokens,
    startedAt: endedAt - e.durationMs,
    endedAt,
    fallbackTtl: usage.rateLimits.length > 0 ? "1h" : "5m",
  } as const;
  const state = await update($, spendAtom, (current) => afterMainTurn(current, turn));
  await $.store.set(
    SPEND_SESSIONS_KEY,
    withSession(await $.store.get(SPEND_SESSIONS_KEY), await $.session.id(), state),
  );
}

function runningMainCall(
  $: EngineInterface,
  e: ToolCallInput,
  next: (e: ToolCallInput) => Promise<ToolCallResult>,
): Promise<ToolCallResult> {
  return update($, runningAtom, (list) => [
    ...list,
    { callId: e.tool_use_id, tool: e.tool, target: targetOf(e) },
  ]).then(() =>
    next(e).finally(() =>
      update($, runningAtom, (list) => list.filter((one) => one.callId !== e.tool_use_id)),
    ),
  );
}

async function recordMainCall($: EngineInterface, callId: string, entry: Activity): Promise<void> {
  turnActivity = [...turnActivity, entry];
  await Promise.all([
    update($, memberOf(toolMsAtom, { requestId: callId }), () => entry.ms),
    update($, activityAtom, (list) => [...list, entry].slice(-KEPT_ACTIVITY)),
  ]);
}

function recordAgentCall(
  $: EngineInterface,
  agentId: string,
  entry: Activity,
  record: CallRecord,
): void {
  pendingAgentCalls = [...pendingAgentCalls, record];
  if (isEditTool(entry.tool) && !entry.isErrored) {
    pendingAgentEdits = [...pendingAgentEdits, { ...entry, agentId }];
  }
  scheduleBatch($);
}

function scheduleBatch($: EngineInterface): void {
  if (pendingBatch) return;
  pendingBatch = $.clock.after(AGENT_BATCH_MS, () => {
    pendingBatch = undefined;
    void flushAgentBatch($);
  });
}

async function flushAgentBatch($: EngineInterface): Promise<void> {
  const edits = pendingAgentEdits;
  pendingAgentEdits = [];
  await Promise.all([
    pendingAgentCalls.length > 0 ? writeCalls($) : undefined,
    edits.length > 0
      ? update($, agentEditsAtom, (list) => [...list, ...edits].slice(-KEPT_AGENT_EDITS))
      : undefined,
  ]);
}

function writeCalls($: EngineInterface, ...fresh: CallRecord[]): Promise<unknown> {
  const calls = [...pendingAgentCalls, ...fresh];
  pendingAgentCalls = [];
  return update($, callsAtom, (list) => [...list, ...calls].slice(-KEPT_CALLS));
}

function activityOf(
  call: { tool: string; tool_use_id: string },
  ran: ToolCallResult,
  ms: number,
): Activity {
  const patched = diffstat(ran.result);
  const diff =
    patched.added + patched.removed > 0
      ? patched
      : (createdFileStat(call.tool, Reflect.get(call, "content")) ?? patched);
  return {
    id: call.tool_use_id,
    tool: call.tool,
    target: targetOf(call),
    ms,
    isErrored: ran.deny !== undefined || ran.isError === true,
    added: diff.added,
    removed: diff.removed,
  };
}

function createdFileStat(
  tool: string,
  content: unknown,
): { added: number; removed: number } | null {
  if (tool !== "Write" || typeof content !== "string" || content === "") return null;
  return { added: content.replace(/\n$/, "").split("\n").length, removed: 0 };
}

export function diffstat(result: unknown): { added: number; removed: number } {
  const patch = (result as { structuredPatch?: unknown } | null)?.structuredPatch;
  if (!Array.isArray(patch)) return { added: 0, removed: 0 };
  const lines = patch.flatMap((hunk) => {
    const hunkLines = (hunk as { lines?: unknown } | null)?.lines;
    return Array.isArray(hunkLines)
      ? hunkLines.filter((line): line is string => typeof line === "string")
      : [];
  });
  return {
    added: lines.filter((line) => line.startsWith("+")).length,
    removed: lines.filter((line) => line.startsWith("-")).length,
  };
}

function turnStats(activity: Activity[]): TurnStats {
  return {
    reads: activity.filter((entry) => entry.tool === "Read").length,
    commands: activity.filter((entry) => entry.tool === "Bash").length,
    changedFiles: new Set(
      activity
        .filter((entry) => isEditTool(entry.tool) && !entry.isErrored)
        .map((entry) => entry.target),
    ).size,
  };
}
