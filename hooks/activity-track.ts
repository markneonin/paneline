import { atom, memberOf, read, update } from "claude-code";
import type {
  ApiContentBlock,
  BuiltinToolResults,
  EngineInterface,
  On,
  SessionMessage,
  Timer,
  ToolCallInput,
  ToolCallResult,
  ToolCheckResult,
  TurnCompleteInput,
} from "claude-code";

import type { Activity, AgentEdit, CallBody, CallRecord, RunningCall, TurnStats } from "../types";
import {
  EXIT_CODE_LINE,
  agentReportOf,
  callRecord,
  handbackReportOf,
  isHandbackTool,
  launchedAgentOf,
  NO_CALL_COUNTS,
  withCalls,
} from "./activity-calls";
import { watchBash, writtenSince } from "./bash-snapshot";
import type { Watch } from "./bash-snapshot";
import { singleLine } from "./format";
import { recordTurnStats } from "./history-track";
import { afterMainTurn, emptySpend, rentRowOf, withRent } from "./spend-model";
import type { TurnStart } from "./spend-model";
import { isEditTool, isProgressTool, targetOf } from "./tools";
import { enterDetail } from "./pane-tab";
import { saveSessionSpend } from "./store-queue";
import { snapshotTurnStart } from "./spend-track";

const KEPT_CALLS = 400;
const KEPT_ACTIVITY = 400;
const KEPT_AGENT_EDITS = 400;
const AGENT_BATCH_MS = 1000;
const WAIT_TICK_MS = 1000;
export const UNMEASURED_MS = -1;
const CALLS_PER_NOTE = 8;
const FULL_PERCENT = 100;
const ERROR_TAGS = /<\/?tool_use_error>/g;
const PROGRESS_NOTE = "Call the progress tool with your estimated percent of the whole task done.";

const activityAtom = atom({ plugin: "paneline", key: "activity" } as const, []);
const agentEditsAtom = atom({ plugin: "paneline", key: "agentEdits" } as const, [] as AgentEdit[]);
const totalMsAtom = atom({ plugin: "paneline", key: "totalMs" } as const, 0);
const callCountsAtom = atom({ plugin: "paneline", key: "callCounts" } as const, NO_CALL_COUNTS);
const callsAtom = atom({ plugin: "paneline", key: "calls" } as const, [] as CallRecord[], {
  shape: "calls-slim",
});
const openCallAtom = atom({ plugin: "paneline", key: "openCall" } as const, null as string | null);
const callLookupAtom = atom(
  { plugin: "paneline", key: "callLookup" } as const,
  null as { id: string; call: (CallRecord & CallBody) | null } | null,
);
const runningAtom = atom({ plugin: "paneline", key: "running" } as const, [] as RunningCall[]);
const toolMsAtom = atom({ plugin: "paneline", key: "toolMs" } as const, UNMEASURED_MS);
const deniedAtom = atom({ plugin: "paneline", key: "denied" } as const, false);
const turnStatsAtom = atom({ plugin: "paneline", key: "turnStats" } as const, null);

const progressAtom = atom({ plugin: "paneline", key: "progress" } as const, {
  tasks: {},
  percent: null as number | null,
});
const callsSinceNoteAtom = atom({ plugin: "paneline", key: "callsSinceNote" } as const, 0);

const spendAtom = atom({ plugin: "paneline", key: "spend" } as const, emptySpend());
export const mainTurnRunningAtom = atom(
  { plugin: "paneline", key: "mainTurnRunning" } as const,
  false,
);

export type WaitingCall = { callId: string; since: number; isMain: boolean };
type CallSegment = { start: number; waitEnd: number; end: number };
type TimeSplit = { toolsMs: number; youMs: number };

const waitingAtom = atom({ plugin: "paneline", key: "waiting" } as const, [] as WaitingCall[]);
const waitTickAtom = atom({ plugin: "paneline", key: "waitTick" } as const, 0);
const timeSplitAtom = atom({ plugin: "paneline", key: "timeSplit" } as const, {
  modelMs: 0,
  toolsMs: 0,
  youMs: 0,
});

const ANY_TOOL = /./;
const PERSON_DENIAL = "denied by you";
const READ_ONLY_REASON = "read-only tool";
const CLASSIFIER_REASON = "auto mode classifier";
const MODE_REASON = "allowed by mode or tool check";

const verdicts = new Map<string, ToolCheckResult>();
const classifierDenials = new Map<string, string>();
const ranCalls = new Set<string>();
const readOnlyCalls = new Set<string>();

let turnActivity: Activity[] = [];
let turnStart: TurnStart | null = null;
let pendingAgentCalls: CallRecord[] = [];
let pendingAgentEdits: AgentEdit[] = [];
let pendingBatch: Timer | undefined;
let awaitedRowId: string | null = null;
let waitTicker: Timer | undefined;
let turnSegments: CallSegment[] = [];
const asked = new Set<string>();
const dialogOpened = new Set<string>();
const askedCalls: { callId: string; tool: string; input: string; isMain: boolean }[] = [];
const durations = new Map<string, number>();

export function trackActivity(on: On): void {
  on("session.start", { isInteractive: true }, async ($, e, next) => {
    await fillEmptyTargets($);
    return next(e);
  });

  on("turn.start", async ($, e, next) => {
    if (e.agentId !== undefined) return next(e);
    turnActivity = [];
    turnSegments = [];
    turnStart = await snapshotTurnStart($);
    await update($, mainTurnRunningAtom, () => true);
    await dropMainLiveState($);
    return next(e);
  });

  on("classic.PermissionDenied", (_$, e, next) => {
    classifierDenials.set(e.tool_use_id, e.reason);
    return next(e);
  });

  on("tool.call", async ($, e, next) => {
    if (isProgressTool(e.tool) || isHandbackTool(e.tool)) return next(e);
    await $.clock.now();
    const watch = await watchOf($, e);
    const startedAt = await $.clock.now();
    const ran = await (e.agentId === undefined ? runningMainCall($, e, startedAt, next) : next(e))
      .catch(async (error: unknown) => {
        forgetCall(e.tool_use_id);
        await settleEndedCall($);
        throw error;
      })
      .finally(() => endLiveWait($, e.tool_use_id));
    const endedAt = await $.clock.now();
    bookSegment(e.tool_use_id, startedAt, endedAt);
    const files = await bashFilesOf($, e.tool, ran, watch);
    const entry = activityOf(e, ran, endedAt - startedAt, files);
    const permission = takePermission(e.tool_use_id, ran);
    forgetCall(e.tool_use_id);
    const launchedAgentId = launchedAgentOf(e, ran.result);
    const record: CallRecord = {
      ...entry,
      startedAt,
      agentId: e.agentId,
      ...(launchedAgentId === undefined ? {} : { launchedAgentId }),
      ...(permission === undefined ? {} : { permission }),
    };
    if (e.agentId !== undefined) {
      recordAgentCall($, e.agentId, entry, record);
      return ran;
    }
    await Promise.all([
      writeCalls($, record),
      recordMainCall($, e.tool_use_id, entry),
      recordRent($, e, ran),
      recordDenial($, e.tool_use_id, permission),
    ]);
    return withProgressNote($, ran);
  });

  on("session.append", { door: ["tool-result", "queue"] }, async ($, e, next) => {
    const stored = await next(e);
    if (awaitedRowId !== null && namesCall(e.message.content, awaitedRowId)) {
      $.clock.after(0, () => void refreshOpenCall($));
    }
    return stored;
  });

  on("tool.check", async ($, e, next) => {
    if (isProgressTool(e.tool) || isHandbackTool(e.tool)) return next(e);
    const verdict = await next(e);
    recordVerdict(e, verdict);
    if (verdict.decision !== "ask" || e.tool_use_id === undefined || e.approver === "host") {
      return verdict;
    }
    asked.add(e.tool_use_id);
    askedCalls.push({
      callId: e.tool_use_id,
      tool: e.tool,
      input: JSON.stringify(e.input),
      isMain: e.agentId === undefined,
    });
    return verdict;
  });

  on("classic.PermissionRequest", async ($, e, next) => {
    const input = JSON.stringify(e.tool_input);
    const at = askedCalls.findIndex((call) => call.tool === e.tool_name && call.input === input);
    const [call] = at < 0 ? [] : askedCalls.splice(at, 1);
    if (call !== undefined) {
      dialogOpened.add(call.callId);
      await startLiveWait($, call);
    }
    return next(e);
  });

  on("agent.spawn", { tool_use_id: /./ }, async ($, e, next) => {
    await endLiveWait($, e.tool_use_id);
    return next(e);
  });

  on("ui.render", { component: "ToolProgress" }, async ($, e, next) => {
    $.clock.after(0, () => void endLiveWait($, e.props.tool_use_id));
    return next(e);
  });

  on("classic.PostToolUse", { tool_name: ANY_TOOL }, async (_$, e, next) => {
    if (isProgressTool(e.tool_name)) return next(e);
    ranCalls.add(e.tool_use_id);
    rememberDuration(e.tool_use_id, e.duration_ms);
    return next(e);
  });

  on("classic.PostToolUseFailure", { tool_name: ANY_TOOL }, async (_$, e, next) => {
    if (isProgressTool(e.tool_name)) return next(e);
    ranCalls.add(e.tool_use_id);
    rememberDuration(e.tool_use_id, e.duration_ms);
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    if (e.agentId !== undefined) {
      const ended = await next(e);
      await recordAgentReport($, e.agentId, e.durationMs);
      return ended;
    }
    await bookTimeSplit($, e.durationMs);
    await update($, mainTurnRunningAtom, () => false);
    await dropMainLiveState($);
    const stats = turnStats(turnActivity);
    await update($, memberOf(turnStatsAtom, { requestId: String(e.durationMs) }), () => stats);
    await update($, totalMsAtom, (total) => total + e.durationMs);
    await recordMainSpend($, e);
    await completeProgress($, e);
    return next(e);
  });
}

async function startLiveWait(
  $: EngineInterface,
  { callId, isMain }: { callId: string; isMain: boolean },
): Promise<void> {
  const since = await $.clock.now();
  await update($, waitingAtom, (list) => [...list, { callId, since, isMain }]);
  await update($, waitTickAtom, () => since);
  if (isMain) startWaitTicker($);
}

function startWaitTicker($: EngineInterface): void {
  waitTicker ??= $.clock.every(WAIT_TICK_MS, () => void tickWait($));
}

async function dropMainLiveState($: EngineInterface): Promise<void> {
  await update($, runningAtom, (list) => (list.length === 0 ? list : []));
  const left = await update($, waitingAtom, (list) =>
    list.some((call) => call.isMain) ? list.filter((call) => !call.isMain) : list,
  );
  await stopWaitTickerWhenIdle($, left);
}

async function stopWaitTickerWhenIdle($: EngineInterface, waits: WaitingCall[]): Promise<void> {
  if (waits.some((call) => call.isMain)) return;
  if ((await read($, runningAtom)).length > 0) return;
  waitTicker?.cancel();
  waitTicker = undefined;
}

async function tickWait($: EngineInterface): Promise<void> {
  const now = await $.clock.now();
  await update($, waitTickAtom, () => now);
}

async function endLiveWait($: EngineInterface, callId: string): Promise<void> {
  const unasked = askedCalls.findIndex((call) => call.callId === callId);
  if (unasked >= 0) askedCalls.splice(unasked, 1);
  const left = await update($, waitingAtom, (list) =>
    list.some((call) => call.callId === callId)
      ? list.filter((call) => call.callId !== callId)
      : list,
  );
  await stopWaitTickerWhenIdle($, left);
}

function rememberDuration(callId: string, durationMs: number | undefined): void {
  if (typeof durationMs === "number") durations.set(callId, durationMs);
}

export function waitOf(call: {
  dialogOpened: boolean;
  wallMs: number;
  durationMs: number | undefined;
}): number {
  if (!call.dialogOpened) return 0;
  return call.durationMs === undefined ? call.wallMs : Math.max(0, call.wallMs - call.durationMs);
}

function forgetCall(callId: string): void {
  asked.delete(callId);
  dialogOpened.delete(callId);
  durations.delete(callId);
}

function bookSegment(callId: string, start: number, end: number): void {
  const waitMs = waitOf({
    dialogOpened: dialogOpened.has(callId),
    wallMs: end - start,
    durationMs: durations.get(callId),
  });
  turnSegments = [...turnSegments, { start, waitEnd: start + waitMs, end }];
}

async function bookTimeSplit($: EngineInterface, durationMs: number): Promise<void> {
  const end = await $.clock.now();
  const start = turnStart?.at ?? end - durationMs;
  const split = splitTurn(turnSegments, start, end);
  turnSegments = [];
  await update($, timeSplitAtom, (total) => ({
    modelMs: total.modelMs + Math.max(0, end - start - split.toolsMs - split.youMs),
    toolsMs: total.toolsMs + split.toolsMs,
    youMs: total.youMs + split.youMs,
  }));
}

export function splitTurn(segments: CallSegment[], start: number, end: number): TimeSplit {
  const clamp = (at: number): number => Math.min(end, Math.max(start, at));
  const clipped = segments.map((segment) => ({
    start: clamp(segment.start),
    waitEnd: clamp(segment.waitEnd),
    end: clamp(segment.end),
  }));
  const edges = [
    ...new Set([start, end, ...clipped.flatMap((s) => [s.start, s.waitEnd, s.end])]),
  ].sort((a, b) => a - b);
  const split = { toolsMs: 0, youMs: 0 };
  edges.slice(1).forEach((to, index) => {
    const from = edges[index] ?? to;
    if (clipped.some((s) => s.start <= from && to <= s.waitEnd)) split.youMs += to - from;
    else if (clipped.some((s) => s.waitEnd <= from && to <= s.end)) split.toolsMs += to - from;
  });
  return split;
}

function recordVerdict(
  e: { tool_use_id?: string; tool: string; isReadOnly?: boolean },
  verdict: ToolCheckResult,
): void {
  if (e.tool_use_id === undefined || isProgressTool(e.tool)) return;
  verdicts.set(e.tool_use_id, verdict);
  if (e.isReadOnly === true) readOnlyCalls.add(e.tool_use_id);
}

function takePermission(callId: string, ran: ToolCallResult): CallRecord["permission"] {
  const call = {
    verdict: verdicts.get(callId),
    classifierReason: classifierDenials.get(callId),
    hasRun: ranCalls.has(callId),
    isReadOnly: readOnlyCalls.has(callId),
    wasAsked: asked.has(callId),
    dialogOpened: dialogOpened.has(callId),
    ran,
  };
  verdicts.delete(callId);
  readOnlyCalls.delete(callId);
  classifierDenials.delete(callId);
  ranCalls.delete(callId);
  return permissionOf(call);
}

export function permissionOf(call: {
  verdict: ToolCheckResult | undefined;
  classifierReason: string | undefined;
  hasRun: boolean;
  isReadOnly: boolean;
  wasAsked: boolean;
  dialogOpened: boolean;
  ran: ToolCallResult;
}): CallRecord["permission"] {
  const { verdict, ran } = call;
  if (ran.deny !== undefined || verdict?.decision === "deny") {
    const named = verdict?.decision === "deny" ? verdictReason(verdict) : undefined;
    return { kind: "denied", reason: named ?? firstLine(ran.deny ?? ran.text ?? "") };
  }
  if (call.classifierReason !== undefined)
    return { kind: "denied", reason: firstLine(call.classifierReason) };
  if (verdict?.decision === "ask" && ran.isError === true && !call.hasRun)
    return { kind: "denied", reason: PERSON_DENIAL };
  if (verdict?.decision === "ask" && call.hasRun && call.wasAsked && !call.dialogOpened)
    return { kind: "auto-allowed", reason: CLASSIFIER_REASON };
  if (verdict?.decision !== "allow") return undefined;
  return { kind: "auto-allowed", reason: allowReason(verdict, call.isReadOnly) };
}

export function allowReason(verdict: ToolCheckResult, isReadOnly: boolean): string {
  return verdictReason(verdict) ?? (isReadOnly ? READ_ONLY_REASON : MODE_REASON);
}

function firstLine(text: string): string {
  return text.split("\n")[0] ?? "";
}

function verdictReason(verdict: ToolCheckResult): string | undefined {
  return verdict.rule ?? verdict.hook ?? verdict.setting ?? verdict.reason;
}

async function recordAgentReport(
  $: EngineInterface,
  agentId: string,
  durationMs: number,
): Promise<void> {
  const calls = await read($, callsAtom);
  const launchIds = new Set(
    calls.filter((call) => call.launchedAgentId === agentId).map((call) => call.id),
  );
  if (launchIds.size === 0) return;
  await Promise.all([
    update($, callsAtom, (list) =>
      list.map((call) => (launchIds.has(call.id) ? { ...call, ms: durationMs } : call)),
    ),
    update($, activityAtom, (list) =>
      list.map((entry) => (launchIds.has(entry.id) ? { ...entry, ms: durationMs } : entry)),
    ),
  ]);
  const id = await read($, openCallAtom);
  if (id === null || !launchIds.has(id)) return;
  awaitedRowId = id;
  await refreshOpenCall($);
}

async function fillEmptyTargets($: EngineInterface): Promise<void> {
  const [activity, calls] = await Promise.all([read($, activityAtom), read($, callsAtom)]);
  const targets = await targetsFromTranscript($, [...activity, ...calls]);
  const isFillable = (rows: Activity[]): boolean =>
    rows.some((row) => row.target === "" && targets.has(row.id));
  await Promise.all([
    isFillable(activity)
      ? update($, activityAtom, (list) => fillTargets(list, targets))
      : undefined,
    isFillable(calls) ? update($, callsAtom, (list) => fillTargets(list, targets)) : undefined,
  ]);
}

async function targetsFromTranscript(
  $: EngineInterface,
  rows: (Activity & { agentId?: string })[],
): Promise<Map<string, string>> {
  const empty = rows.filter((row) => row.target === "");
  const agentIds = new Set(empty.flatMap((row) => row.agentId ?? []));
  const conversations = await Promise.all([
    empty.some((row) => row.agentId === undefined) ? $.session.messages() : [],
    ...[...agentIds].map((agentId) => $.session.messages({ agentId })),
  ]);
  const messages = conversations.flatMap((found) => (Array.isArray(found) ? found : []));
  return new Map(
    messages
      .flatMap((message) => message.toolUses)
      .flatMap((use) => {
        const target = targetOf({ tool: use.tool, ...use.input });
        return target === "" ? [] : [[use.tool_use_id, target] as const];
      }),
  );
}

function fillTargets<T extends Activity>(rows: T[], targets: Map<string, string>): T[] {
  return rows.map((row) => {
    const target = targets.get(row.id);
    return row.target === "" && target !== undefined ? { ...row, target } : row;
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
    { tool: e.tool, target: targetOf(e), cwd: await $.session.cwd(), callId: e.tool_use_id },
    ran.text,
  );
  await update($, spendAtom, (state) => withRent(state, row));
}

async function recordMainSpend($: EngineInterface, e: TurnCompleteInput): Promise<void> {
  const start = turnStart;
  turnStart = null;
  if (e.usage === undefined) return;
  const [endedAt, usage] = await Promise.all([$.clock.now(), $.session.usage()]);
  const turn = {
    usage: e.usage,
    context: usage.context.tokens,
    startedAt: endedAt - e.durationMs,
    endedAt,
    fallbackTtl: usage.rateLimits.length > 0 ? "1h" : "5m",
  } as const;
  if (start !== null) {
    await recordTurnStats($, {
      tools: turnActivity.length,
      failed: turnActivity.filter((entry) => entry.isErrored).length,
      ms: e.durationMs,
    });
  }
  const state = await update($, spendAtom, (current) => afterMainTurn(current, turn));
  await saveSessionSpend($, state);
}

async function runningMainCall(
  $: EngineInterface,
  e: ToolCallInput,
  startedAt: number,
  next: (e: ToolCallInput) => Promise<ToolCallResult>,
): Promise<ToolCallResult> {
  await update($, runningAtom, (list) => [
    ...list,
    { callId: e.tool_use_id, tool: e.tool, target: targetOf(e), startedAt },
  ]);
  await update($, waitTickAtom, () => startedAt);
  startWaitTicker($);
  return next(e).finally(() =>
    update($, runningAtom, (list) => list.filter((one) => one.callId !== e.tool_use_id)),
  );
}

async function recordMainCall($: EngineInterface, callId: string, entry: Activity): Promise<void> {
  turnActivity = [...turnActivity, entry];
  await Promise.all([
    update($, memberOf(toolMsAtom, { requestId: callId }), () => entry.ms),
    update($, activityAtom, (list) => [...list, entry].slice(-KEPT_ACTIVITY)),
  ]);
}

async function recordDenial(
  $: EngineInterface,
  callId: string,
  permission: CallRecord["permission"],
): Promise<void> {
  if (permission?.kind === "denied")
    await update($, memberOf(deniedAtom, { requestId: callId }), () => true);
}

function recordAgentCall(
  $: EngineInterface,
  agentId: string,
  entry: Activity,
  record: CallRecord,
): void {
  pendingAgentCalls = [...pendingAgentCalls, record];
  if ((isEditTool(entry.tool) || entry.files !== undefined) && !entry.isErrored) {
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

async function writeCalls($: EngineInterface, ...fresh: CallRecord[]): Promise<void> {
  const calls = [...pendingAgentCalls, ...fresh];
  pendingAgentCalls = [];
  await Promise.all([
    update($, callsAtom, (list) => [...list, ...calls].slice(-KEPT_CALLS)),
    update($, callCountsAtom, (counts) => withCalls(counts, calls)),
  ]);
  await settleEndedCall($);
}

export async function showCall($: EngineInterface, id: string | null): Promise<void> {
  awaitedRowId = null;
  if (id !== null) await enterDetail($, "activity");
  await update($, callLookupAtom, () => null);
  await update($, openCallAtom, () => id);
  await settleOpenCall($);
}

async function settleOpenCall($: EngineInterface): Promise<void> {
  const found = await readOpenCall($);
  if (found !== undefined) await update($, callLookupAtom, () => found);
}

async function settleEndedCall($: EngineInterface): Promise<void> {
  const found = await readOpenCall($);
  if (found === undefined) return;
  if (found.call === null) awaitedRowId = found.id;
  else await update($, callLookupAtom, () => found);
}

async function refreshOpenCall($: EngineInterface): Promise<void> {
  await update($, callLookupAtom, () => null);
  await settleEndedCall($);
}

async function readOpenCall(
  $: EngineInterface,
): Promise<{ id: string; call: (CallRecord & CallBody) | null } | undefined> {
  const [id, lookup, calls, running] = await Promise.all([
    read($, openCallAtom),
    read($, callLookupAtom),
    read($, callsAtom),
    read($, runningAtom),
  ]);
  if (id === null || lookup?.id === id) return undefined;
  if (running.some((call) => call.callId === id)) return undefined;
  const found = { id, call: (await callFromTranscript($, id, calls)) ?? null };
  return (await read($, openCallAtom)) === id ? found : undefined;
}

function namesCall(content: ApiContentBlock[], callId: string): boolean {
  return content.some((block) =>
    block.type === "tool_result"
      ? block.tool_use_id === callId
      : typeof block.text === "string" &&
        block.text.includes(`<tool-use-id>${callId}</tool-use-id>`),
  );
}

export async function callFromTranscript(
  $: EngineInterface,
  id: string,
  calls: CallRecord[],
): Promise<(CallRecord & CallBody) | undefined> {
  const kept = calls.find((call) => call.id === id);
  const messages = await messagesOf($, kept?.agentId);
  const use = messages.flatMap((message) => message.toolUses).find((one) => one.tool_use_id === id);
  if (use?.result === undefined && use?.text === undefined) return undefined;
  const call = { tool: use.tool, tool_use_id: id, ...use.input };
  const report =
    use.tool === "Agent"
      ? await reportOf($, id, messages, kept, launchedAgentOf(call, use.result))
      : undefined;
  const outcome = {
    result: use.result,
    text: report ?? use.text,
    ...(use.isError === true ? { isError: true } : {}),
  } as ToolCallResult;
  const seen = callRecord(
    call,
    activityOf(call, outcome, UNMEASURED_MS, undefined),
    outcome,
    undefined,
  );
  return kept === undefined ? seen : { ...seen, ...keptFields(kept) };
}

function keptFields(kept: CallRecord): Partial<CallRecord> {
  return {
    ms: kept.ms,
    agentId: kept.agentId,
    launchedAgentId: kept.launchedAgentId,
    permission: kept.permission,
    startedAt: kept.startedAt,
  };
}

async function reportOf(
  $: EngineInterface,
  id: string,
  messages: SessionMessage[],
  kept: CallRecord | undefined,
  launchedAgentId: string | undefined,
): Promise<string | undefined> {
  const main = kept?.agentId === undefined ? messages : await messagesOf($, undefined);
  const notified = agentReportOf(main, id);
  if (notified === undefined || launchedAgentId === undefined) return notified;
  return handbackReportOf(await messagesOf($, launchedAgentId)) ?? notified;
}

async function messagesOf(
  $: EngineInterface,
  agentId: string | undefined,
): Promise<SessionMessage[]> {
  try {
    const found = await (agentId === undefined
      ? $.session.messages()
      : $.session.messages({ agentId }));
    return Array.isArray(found) ? found : [];
  } catch {
    return [];
  }
}

function activityOf(
  call: { tool: string; tool_use_id: string },
  ran: ToolCallResult,
  ms: number,
  files: Activity["files"],
): Activity {
  const patched = diffstat(ran.result);
  const diff =
    patched.added + patched.removed > 0
      ? patched
      : (createdFileStat(call.tool, Reflect.get(call, "content")) ?? patched);
  const isErrored = ran.deny !== undefined || ran.isError === true;
  const { reason, fallbackReason } = isErrored ? failureReason(ran) : { reason: "" };
  return {
    id: call.tool_use_id,
    tool: call.tool,
    target: targetOf(call),
    ms,
    isErrored,
    ...(reason === "" ? {} : { reason }),
    ...(fallbackReason === undefined ? {} : { fallbackReason }),
    added: diff.added,
    removed: diff.removed,
    ...(files === undefined ? {} : { files }),
  };
}

function watchOf($: EngineInterface, call: ToolCallInput): Promise<Watch> {
  if (call.tool !== "Bash" || call.agentId !== undefined) return Promise.resolve([]);
  return watchBash($, call);
}

async function bashFilesOf(
  $: EngineInterface,
  tool: string,
  ran: ToolCallResult,
  watch: Watch,
): Promise<Activity["files"]> {
  if (tool !== "Bash") return undefined;
  const engine = engineFilesOf(ran.result);
  if (engine !== undefined) return engine;
  if (watch.length === 0 || ran.deny !== undefined || ran.isError === true) return undefined;
  const written = await writtenSince($, watch);
  return written.length === 0
    ? undefined
    : written.map((target) => ({ target, added: 0, removed: 0 }));
}

function engineFilesOf(result: unknown): Activity["files"] {
  const diff = (result as Partial<BuiltinToolResults["Bash"]> | null)?.bashEditDiff;
  const edited = Array.isArray(diff?.files) ? diff.files : [];
  const changed = Array.isArray(diff?.changedFiles) ? diff.changedFiles : [];
  if (edited.length === 0 && changed.length === 0) return undefined;
  const listed = new Set(edited.map((file) => file.filePath));
  return [
    ...edited.map((file) => ({
      target: file.filePath,
      ...diffstat({ structuredPatch: file.hunks }),
    })),
    ...[...new Set(changed)]
      .filter((target) => !listed.has(target))
      .map((target) => ({ target, added: 0, removed: 0 })),
  ];
}

function failureReason(ran: ToolCallResult): { reason: string; fallbackReason?: string } {
  const raw = ran.deny ?? (ran.isError === true ? ran.text : ran.result);
  if (typeof raw !== "string") return { reason: "" };
  const text = raw.replace(ERROR_TAGS, "").trim();
  const match = EXIT_CODE_LINE.exec(text);
  if (match === null) return { reason: singleLine(text) };
  const outputLines = text
    .slice(match[0].length)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const exitCodeLine = singleLine(match[0]);
  const lastLine = outputLines.at(-1);
  if (lastLine === undefined) return { reason: singleLine(text) };
  return { reason: singleLine(lastLine), fallbackReason: exitCodeLine };
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
