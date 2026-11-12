import type { EngineInterface, On } from "claude-code";

import { restoredSpend, SPEND_SESSIONS_KEY, withSession } from "./spend-model";
import {
  batchScript,
  clearStatement,
  countStatement,
  importRunScript,
  initScript,
  lastLines,
  LIMITS_ROW,
  limitsStatement,
  parseSnapshot,
  sessionCostsQuery,
  spendStateStatement,
  transcriptClaimStatements,
  transcriptFilesQuery,
  transcriptFileStatements,
  transcriptOwnerQuery,
  transcriptProgressStatement,
  transcriptPruneStatements,
  transcriptReleaseStatement,
  sessionCallsQuery,
  transcriptTotalsQuery,
  USE_KEYS,
} from "./store-sql";
import type {
  Snapshot,
  TranscriptFileRow,
  TranscriptRaw,
  TranscriptWindows,
  UseKind,
  UseRow,
} from "./store-sql";
import type { CallRow } from "./transcript-cost";
import { savedUses, withoutFolder, withUse } from "./use-counts";
import type { UseCounts } from "./use-counts";
import type { SpendState, TranscriptProgress } from "../types";

const RETRY_MS = 5_000;
const RUN_TIMEOUT_MS = 20_000;
const OPEN_COMMAND = 'mkdir -p "$1" && exec sqlite3 -bail -batch -noheader -list "$2"';

type Write = { write: string };
type Read = { read: string; answer: (line: string) => void; fail: (error: unknown) => void };
type Item = Write | Read;
type Database = { dir: string; file: string };

type Change = (stored: unknown) => unknown;

const EMPTY_SNAPSHOT: Snapshot = {
  v: 1,
  imported: false,
  uses: [],
  limits: undefined,
  spendState: undefined,
};

const values = new Map<string, unknown>();
const pending = new Map<string, Change[]>();
let tail: Promise<void> = Promise.resolve();
let isFailing = false;
let isRetryScheduled = false;
let isSqlite = false;
let opening: Promise<void> | undefined;
let hasStarted = false;
let database: Database = { dir: "", file: "" };
let snapshot: Snapshot = EMPTY_SNAPSHOT;
let waiting: Item[] = [];
let isRunning = false;
let isFlushQueued = false;
let liveClaims = 0;

export function trackStore(on: On): void {
  on("session.start", { isInteractive: [true, false] }, async ($, e, next) => {
    for (const key of [...values.keys()]) if (!pending.has(key)) values.delete(key);
    if (hasStarted) opening = undefined;
    hasStarted = true;
    await opened($);
    return next(e);
  });
}

export async function storedSnapshot($: EngineInterface): Promise<Snapshot> {
  await opened($);
  return snapshot;
}

export async function storedUses(
  $: EngineInterface,
  kind: UseKind,
  folder: string,
): Promise<Record<string, number>> {
  await opened($);
  return Object.fromEntries(
    snapshot.uses
      .filter((row) => row[0] === kind && row[1] === folder)
      .map((row) => [row[2], row[3]]),
  );
}

export function countUse($: EngineInterface, kind: UseKind, folder: string, name: string): void {
  afterOpen($, () => {
    if (isSqlite) {
      enqueue($, { write: countStatement(kind, folder, name) });
      return;
    }
    changeInBackground($, USE_KEYS[kind], (stored) => withUse(savedUses(stored), folder, name));
  });
}

export function clearUses($: EngineInterface, folder: string, kinds: readonly UseKind[]): void {
  afterOpen($, () => {
    if (isSqlite) {
      enqueue($, { write: clearStatement(folder, kinds) });
      return;
    }
    for (const kind of kinds) {
      changeInBackground($, USE_KEYS[kind], (stored) => withoutFolder(savedUses(stored), folder));
    }
  });
}

export function saveLimits($: EngineInterface, limits: unknown): void {
  afterOpen($, () => {
    if (isSqlite) {
      enqueue($, { write: limitsStatement(limits) });
      return;
    }
    setStored($, LIMITS_ROW, limits);
  });
}

export async function ownSpendState($: EngineInterface): Promise<unknown> {
  await opened($);
  if (isSqlite) return snapshot.spendState;
  return restoredSpend(await storedValue($, SPEND_SESSIONS_KEY), await $.session.id());
}

export async function saveSessionSpend($: EngineInterface, state: SpendState): Promise<void> {
  const [sessionId, now] = await Promise.all([$.session.id(), $.clock.now(), opened($)]);
  if (isSqlite) {
    enqueue($, { write: spendStateStatement(sessionId, state, now) });
    return;
  }
  changeInBackground($, SPEND_SESSIONS_KEY, (saved) => withSession(saved, sessionId, state));
}

export function pruneTranscripts($: EngineInterface): void {
  inBackground($, async () => {
    const [now, session] = await Promise.all([$.clock.now(), $.session.id(), opened($)]);
    if (!isSqlite) return;
    for (const write of transcriptPruneStatements(now, session)) enqueue($, { write });
  });
}

export async function claimTranscripts(
  $: EngineInterface,
  session: string,
  now: number,
  pricing: string,
): Promise<boolean> {
  await opened($);
  if (!isSqlite) return false;
  liveClaims += 1;
  for (const write of transcriptClaimStatements(session, now, pricing)) enqueue($, { write });
  const isHeld = (await readQueued($, transcriptOwnerQuery(session))) === "1";
  if (!isHeld) liveClaims -= 1;
  return isHeld;
}

export async function releaseTranscripts($: EngineInterface, session: string): Promise<void> {
  await opened($);
  if (!isSqlite) return;
  liveClaims -= 1;
  if (liveClaims > 0) return;
  enqueue($, { write: transcriptReleaseStatement(session) });
  await readQueued($, "SELECT 1;");
}

export async function transcriptFiles($: EngineInterface): Promise<TranscriptFileRow[]> {
  await opened($);
  if (!isSqlite) return [];
  const rows = JSON.parse(await readQueued($, transcriptFilesQuery())) as [
    string,
    number,
    number,
    number,
    number | null,
    string | null,
  ][];
  return rows.map(([path, size, mtimeMs, offset, start, cwd]) => ({
    path,
    size,
    mtimeMs,
    offset,
    start: start ?? Number.POSITIVE_INFINITY,
    cwd: cwd ?? "",
  }));
}

export async function saveTranscriptFile(
  $: EngineInterface,
  session: string,
  now: number,
  file: TranscriptFileRow,
  rows: readonly CallRow[],
): Promise<void> {
  await opened($);
  if (!isSqlite) return;
  for (const write of transcriptFileStatements(session, now, file, rows)) enqueue($, { write });
  await readQueued($, "SELECT 1;");
}

export async function saveTranscriptProgress(
  $: EngineInterface,
  progress: TranscriptProgress,
): Promise<void> {
  await opened($);
  if (!isSqlite) return;
  enqueue($, { write: transcriptProgressStatement(progress) });
  await readQueued($, "SELECT 1;");
}

export async function transcriptTotals(
  $: EngineInterface,
  windows: TranscriptWindows,
  session: string,
): Promise<TranscriptRaw | undefined> {
  await opened($);
  if (!isSqlite) return undefined;
  return JSON.parse(await readQueued($, transcriptTotalsQuery(windows, session))) as TranscriptRaw;
}

export async function sessionCalls(
  $: EngineInterface,
  session: string,
  since: number,
): Promise<[at: number, usd: number][] | undefined> {
  await opened($);
  if (!isSqlite) return undefined;
  return JSON.parse(await readQueued($, sessionCallsQuery(session, since))) as [number, number][];
}

export async function sessionCosts(
  $: EngineInterface,
  windows: TranscriptWindows,
  sessions: readonly string[],
): Promise<Record<string, number> | undefined> {
  await opened($);
  if (!isSqlite) return undefined;
  return JSON.parse(await readQueued($, sessionCostsQuery(windows, sessions))) as Record<
    string,
    number
  >;
}

function readQueued($: EngineInterface, sql: string): Promise<string> {
  return new Promise((answer, fail) => {
    enqueue($, { read: sql, answer, fail });
  });
}

async function storedValue($: EngineInterface, key: string): Promise<unknown> {
  if (values.has(key)) return values.get(key);
  const loaded = await $.store.get(key);
  if (!values.has(key)) values.set(key, loaded);
  return values.get(key);
}

async function changeStored($: EngineInterface, key: string, change: Change): Promise<unknown> {
  await storedValue($, key);
  return applyAndPersist($, key, change);
}

function setStored($: EngineInterface, key: string, value: unknown): void {
  applyAndPersist($, key, () => value);
}

function inBackground($: EngineInterface, job: () => Promise<unknown>): void {
  tail = tail.then(job).then(
    () => undefined,
    (error: unknown) => reportFailure($, error),
  );
}

function applyAndPersist($: EngineInterface, key: string, change: Change): unknown {
  const next = change(values.get(key));
  values.set(key, next);
  pending.set(key, [...(pending.get(key) ?? []), change]);
  schedule($);
  return next;
}

function schedule($: EngineInterface): void {
  tail = tail.then(() => flush($));
}

async function flush($: EngineInterface): Promise<void> {
  for (const key of [...pending.keys()]) await flushKey($, key, takeChanges(key));
}

function takeChanges(key: string): Change[] {
  const changes = pending.get(key) ?? [];
  pending.delete(key);
  return changes;
}

async function flushKey($: EngineInterface, key: string, changes: Change[]): Promise<void> {
  try {
    const written = await persist($, key, changes);
    values.set(key, replay(pending.get(key), written));
    isFailing = false;
  } catch (error) {
    pending.set(key, [...changes, ...(pending.get(key) ?? [])]);
    reportFailure($, error);
    retryLater($);
  }
}

async function persist($: EngineInterface, key: string, changes: Change[]): Promise<unknown> {
  const written = replay(changes, await $.store.get(key));
  await $.store.set(key, written);
  return written;
}

function replay(changes: Change[] | undefined, from: unknown): unknown {
  return (changes ?? []).reduce((value, change) => change(value), from);
}

function reportFailure($: EngineInterface, error: unknown): void {
  if (isFailing) return;
  isFailing = true;
  const reason = error instanceof Error ? error.message : String(error);
  $.ui.log(`paneline: saving to the store failed, will try again: ${reason}`);
}

function retryLater($: EngineInterface): void {
  if (isRetryScheduled) return;
  isRetryScheduled = true;
  $.clock.after(RETRY_MS, () => {
    isRetryScheduled = false;
    schedule($);
    scheduleFlush($);
  });
}

function opened($: EngineInterface): Promise<void> {
  opening ??= openStore($);
  return opening;
}

function afterOpen($: EngineInterface, job: () => void): void {
  void opened($).then(job);
}

async function openStore($: EngineInterface): Promise<void> {
  const fromSqlite = await openSqlite($);
  isSqlite = fromSqlite !== undefined;
  snapshot = fromSqlite ?? (await storeSnapshot($));
}

async function openSqlite($: EngineInterface): Promise<Snapshot | undefined> {
  try {
    const sessionId = await $.session.id();
    const now = await $.clock.now();
    database = await locateDatabase($);
    const opened = await readSnapshot($, sessionId);
    if (opened === undefined || opened.imported) return opened;
    return await importOldKeys($, { sessionId, now }, opened);
  } catch {
    return undefined;
  }
}

async function importOldKeys(
  $: EngineInterface,
  request: { sessionId: string; now: number },
  opened: Snapshot,
): Promise<Snapshot> {
  try {
    const script = importRunScript(await rawStoredValues($), request.sessionId, request.now);
    return parseSnapshot(await runSqlite($, script)) ?? opened;
  } catch (error) {
    const reread = await rereadSnapshot($, request.sessionId);
    if (reread?.imported) return reread;
    reportFailure($, error);
    return opened;
  }
}

async function rereadSnapshot(
  $: EngineInterface,
  sessionId: string,
): Promise<Snapshot | undefined> {
  try {
    return await readSnapshot($, sessionId);
  } catch {
    return undefined;
  }
}

async function readSnapshot($: EngineInterface, sessionId: string): Promise<Snapshot | undefined> {
  return parseSnapshot(await runSqlite($, initScript(sessionId)));
}

async function rawStoredValues($: EngineInterface): Promise<Record<string, unknown>> {
  const keys = await $.store.keys();
  const entries = await Promise.all(
    keys.map(async (key) => [key, await $.store.get(key)] as const),
  );
  return Object.fromEntries(entries);
}

async function locateDatabase($: EngineInterface): Promise<Database> {
  const configDir = await $.env.get("CLAUDE_CONFIG_DIR");
  const home = await $.env.get("HOME");
  const dir = `${configDir || `${home ?? ""}/.claude`}/plugins/paneline`;
  return { dir, file: `${dir}/state.db` };
}

async function runSqlite($: EngineInterface, script: string): Promise<string> {
  const run = await $.process.run(["sh", "-c", OPEN_COMMAND, "sh", database.dir, database.file], {
    stdin: script,
    timeoutMs: RUN_TIMEOUT_MS,
  });
  if (run.exitCode !== 0) throw new Error(run.stderr.trim() || `sqlite3 exited ${run.exitCode}`);
  return run.stdout;
}

async function storeSnapshot($: EngineInterface): Promise<Snapshot> {
  try {
    const uses: UseRow[] = [];
    for (const [kind, key] of Object.entries(USE_KEYS) as [UseKind, string][]) {
      uses.push(...useRows(kind, savedUses(await storedValue($, key))));
    }
    const limits = await storedValue($, LIMITS_ROW);
    return { ...EMPTY_SNAPSHOT, uses, limits };
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

function useRows(kind: UseKind, all: UseCounts): UseRow[] {
  return Object.entries(all).flatMap(([folder, counts]) =>
    Object.entries(counts).map(([name, count]): UseRow => [kind, folder, name, count]),
  );
}

function enqueue($: EngineInterface, item: Item): void {
  waiting.push(item);
  scheduleFlush($);
}

function scheduleFlush($: EngineInterface): void {
  if (isRunning || isFlushQueued) return;
  isFlushQueued = true;
  void Promise.resolve().then(() => runWaiting($));
}

async function runWaiting($: EngineInterface): Promise<void> {
  isFlushQueued = false;
  const batch = waiting;
  waiting = [];
  if (batch.length === 0) return;
  isRunning = true;
  const isDone = await attempt($, batch);
  isRunning = false;
  if (isDone && waiting.length > 0) scheduleFlush($);
}

async function attempt($: EngineInterface, batch: Item[]): Promise<boolean> {
  try {
    const writes = batch.filter(isWrite).map((item) => item.write);
    const reads = batch.filter(isRead);
    const stdout = await runSqlite(
      $,
      batchScript(
        writes,
        reads.map((item) => item.read),
      ),
    );
    lastLines(stdout, reads.length).forEach((line, index) => reads[index]?.answer(line));
    isFailing = false;
    return true;
  } catch (error) {
    waiting = [...batch.filter(isWrite), ...waiting];
    for (const item of batch.filter(isRead)) item.fail(error);
    reportFailure($, error);
    retryLater($);
    return false;
  }
}

function isWrite(item: Item): item is Write {
  return "write" in item;
}

function isRead(item: Item): item is Read {
  return "read" in item;
}

function changeInBackground($: EngineInterface, key: string, change: Change): void {
  changeStored($, key, change).catch((error: unknown) => {
    reportFailure($, error);
  });
}
