import { atom, read, update } from "claude-code";
import type { EngineInterface, On, Timer } from "claude-code";

import type { SessionRow, UsageSnap } from "../types";
import { gitIn } from "./git-run";
import { refreshSessionTails } from "./session-tail";
import { isShownTab } from "./shown-tab";
import { sessionCosts } from "./store-queue";
import { transcriptWindowsOf } from "./store-sql";

const SESSIONS_SUBDIR = ".claude/paneline/sessions";
const SESSION_FILE = /^\d+\.json$/;
const REGISTRY_SUBDIR = ".claude/sessions";
const PROJECTS_SUBDIR = ".claude/projects";
const NON_ALPHANUMERIC = /[^A-Za-z0-9]/g;
const REGISTRY_PATH = /\/\.claude\/sessions\/\d+\.json$/;
export const SESSIONS_TAB_ID = "sessions";
const SYNC_GAP_MS = 1000;
const POLL_MS = 2000;
const INTERACTIVE_KIND = "interactive";
const BUSY_STATUS = "busy";
const IDLE_STATUS = "idle";
const WAITING_STATUS = "waiting";
const KNOWN_STATUSES = [BUSY_STATUS, IDLE_STATUS, WAITING_STATUS];
const SESSION_PATH = /\/paneline\/sessions\/(\d+)\.json$/;
const CLAUDE_COMMAND = "claude";
const ANY_VALUE = /^/;
const WAITING_NOTIFICATIONS = ["permission_prompt", "elicitation_dialog", "elicitation_url_dialog"];

type RegistryStatus = string;
type RegistryEntry = {
  pid: number;
  sessionId: string;
  cwd: string;
  kind: string;
  status: RegistryStatus;
  statusUpdatedAt: number | null;
};

let lastSyncAt = -SYNC_GAP_MS;
let isSyncScheduled = false;
let poller: Timer | undefined;

const sessionsAtom = atom(
  { plugin: "paneline", key: "sessions" } as const,
  {} as Record<string, SessionRow>,
);
const syncedAtom = atom({ plugin: "paneline", key: "sessionsSynced" } as const, false);
const costsAtom = atom(
  { plugin: "paneline", key: "sessionCosts" } as const,
  {} as Record<string, number>,
);
const usageAtom = atom(
  { plugin: "paneline", key: "usage" } as const,
  { context: null, limits: [] } as UsageSnap,
);

export function trackSessions(on: On): void {
  on("classic.SessionStart", async ($, e, next) => {
    const dirs = [await sessionsDir($), await registryDir($)];
    await announce($);
    const started = await next(e);
    return { ...started, watchPaths: [...(started.watchPaths ?? []), ...dirs] };
  });

  on("turn.start", { turnId: ANY_VALUE }, async ($, e, next) => {
    if (e.agentId === undefined) {
      const ctx = await contextOf($);
      const now = await $.clock.now();
      await changeOwn($, (row) => ({ ...stateChange(row, "running", now), ctx }));
    }
    return next(e);
  });

  on("classic.Notification", { notification_type: WAITING_NOTIFICATIONS }, async ($, e, next) => {
    const now = await $.clock.now();
    await changeOwn($, (row) => stateChange(row, "waiting", now));
    return next(e);
  });

  on("classic.PermissionRequest", { tool_name: ANY_VALUE }, async ($, e, next) => {
    const answer = await next(e);
    await resumeFromWaiting($);
    return answer;
  });

  on("classic.UserPromptSubmit", { prompt: ANY_VALUE }, async ($, e, next) => {
    await resumeFromWaiting($);
    return next(e);
  });

  on("classic.PostToolUse", { tool_name: ANY_VALUE }, async ($, e, next) => {
    await resumeFromWaiting($);
    return next(e);
  });

  on("classic.PostToolUseFailure", { tool_name: ANY_VALUE }, async ($, e, next) => {
    await resumeFromWaiting($);
    return next(e);
  });

  on("turn.complete", { turnId: ANY_VALUE }, async ($, e, next) => {
    if (e.agentId !== undefined) return next(e);
    const place = await placeOf($);
    const ctx = await contextOf($);
    const now = await $.clock.now();
    await changeOwn($, (row) => ({ ...stateChange(row, "idle", now), ctx, ...place }));
    return next(e);
  });

  on("session.measure", { changed: ["context", "cost"] }, async ($, e, next) => {
    const ctx = await contextOf($);
    await changeOwn($, (row) => ({ ctx, usd: (e.cost?.usd ?? 0) > 0 ? e.cost?.usd : row.usd }));
    return next(e);
  });

  on("classic.FileChanged", { file_path: REGISTRY_PATH }, async ($, e, next) => {
    if (isShownTab(SESSIONS_TAB_ID)) await syncThrottled($);
    return next(e);
  });

  on("classic.FileChanged", { file_path: SESSION_PATH }, async ($, e, next) => {
    await applyFileChange($, e.file_path, e.event);
    return next(e);
  });

  on("session.end", async ($, e, next) => {
    const own = await ownRow($);
    if (own !== undefined) await $.process.run(["rm", "-f", await fileOf($, own.pid)]);
    return next(e);
  });
}

export function startSessionsPolling($: EngineInterface): void {
  poller ??= $.clock.every(POLL_MS, () => {
    if (isShownTab(SESSIONS_TAB_ID)) return void syncThrottled($);
    poller?.cancel();
    poller = undefined;
  });
}

export async function syncThrottled($: EngineInterface): Promise<void> {
  if (isSyncScheduled) return;
  isSyncScheduled = true;
  const wait = Math.max(0, lastSyncAt + SYNC_GAP_MS - (await $.clock.now()));
  $.clock.after(wait, async () => {
    isSyncScheduled = false;
    lastSyncAt = await $.clock.now();
    await syncSessions($, await ownPid($));
    await refreshSessionTails(
      $,
      Object.values(await read($, sessionsAtom)).map((row) => row.transcriptPath),
    );
    await update($, syncedAtom, () => true);
    $.ui.invalidate("ui.render");
    await refreshCosts($);
    $.ui.invalidate("ui.render");
  });
}

async function refreshCosts($: EngineInterface): Promise<void> {
  const rows = Object.values(await read($, sessionsAtom));
  if (rows.length === 0) return;
  try {
    const windows = transcriptWindowsOf(await $.clock.now());
    const costs = await sessionCosts(
      $,
      windows,
      rows.map((row) => row.sessionId),
    );
    if (costs !== undefined) await update($, costsAtom, () => costs);
  } catch (error) {
    $.ui.log(String(error), { to: "debug" });
  }
}

export async function syncSessions($: EngineInterface, pid: number): Promise<void> {
  const dir = await sessionsDir($);
  const registry = await registryEntries($);
  const stored = await storedRows($, dir);
  const known = await read($, sessionsAtom);
  const previous = new Map([...stored, ...Object.values(known)].map((row) => [row.pid, row]));
  const alive = await alivePids($, [
    ...new Set([...registry.keys(), ...previous.keys()].filter((key) => key !== pid)),
  ]);
  const entries = [...registry.values()].filter((entry) => entry !== null);
  const interactive = entries.filter((entry) => entry.kind === INTERACTIVE_KIND);
  const spares = new Set(entries.filter((e) => e.kind !== INTERACTIVE_KIND).map((e) => e.pid));
  const gone = stored.filter(
    (row) => row.pid !== pid && (!alive.has(row.pid) || spares.has(row.pid)),
  );
  if (gone.length > 0)
    await $.process.run(["rm", "-f", ...gone.map((row) => `${dir}/${row.pid}.json`)]);
  const fresh = await Promise.all(
    interactive
      .filter((entry) => alive.has(entry.pid) || entry.pid === pid)
      .map((entry) => rowOf($, entry, previous.get(entry.pid), pid)),
  );
  const kept = [...previous.values()].filter(
    (row) =>
      (alive.has(row.pid) || row.pid === pid) &&
      !spares.has(row.pid) &&
      !fresh.some((one) => one.pid === row.pid),
  );
  await update($, sessionsAtom, () =>
    Object.fromEntries([...fresh, ...kept].map((row) => [row.pid, row])),
  );
}

export async function ownPid($: EngineInterface): Promise<number> {
  const { stdout } = await $.process.run(["sh", "-c", "echo $PPID"]);
  return Number(stdout.trim());
}

async function sessionsDir($: EngineInterface): Promise<string> {
  return `${await $.env.get("HOME")}/${SESSIONS_SUBDIR}`;
}

async function registryDir($: EngineInterface): Promise<string> {
  return `${await $.env.get("HOME")}/${REGISTRY_SUBDIR}`;
}

async function registryEntries($: EngineInterface): Promise<Map<number, RegistryEntry | null>> {
  const dir = await registryDir($);
  const files = (await $.fs.list(dir)).filter((entry) => SESSION_FILE.test(entry.name));
  const parsed = await Promise.all(
    files.map(
      async (entry) =>
        [
          Number.parseInt(entry.name, 10),
          parseRegistry(await readText($, `${dir}/${entry.name}`)),
        ] as const,
    ),
  );
  return new Map(parsed);
}

async function rowOf(
  $: EngineInterface,
  entry: RegistryEntry,
  base: SessionRow | undefined,
  ownPid: number,
): Promise<SessionRow> {
  const state = stateOf(entry.status);
  const statusWord = KNOWN_STATUSES.includes(entry.status) ? undefined : entry.status;
  const since = entry.statusUpdatedAt;
  const transcriptPath = `${await $.env.get("HOME")}/${PROJECTS_SUBDIR}/${entry.cwd.replace(NON_ALPHANUMERIC, "-")}/${entry.sessionId}.jsonl`;
  if (base !== undefined && (entry.pid === ownPid || base.sessionId === entry.sessionId)) {
    const keepsOwnSince = entry.pid === ownPid && base.state === state && base.since != null;
    return {
      ...base,
      state,
      statusWord,
      since: keepsOwnSince ? base.since : since,
      transcriptPath,
    };
  }
  const branch = await gitIn($, entry.cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return {
    pid: entry.pid,
    sessionId: entry.sessionId,
    state,
    statusWord,
    cwd: entry.cwd,
    branch: branch ?? "",
    ctx: null,
    usd: null,
    since,
    transcriptPath,
  };
}

function stateOf(status: RegistryStatus): SessionRow["state"] {
  if (status === WAITING_STATUS) return "waiting";
  return status === IDLE_STATUS ? "idle" : "running";
}

function stateChange(
  row: SessionRow,
  state: SessionRow["state"],
  now: number,
): Partial<SessionRow> {
  return row.state === state ? { state } : { state, since: now, statusWord: undefined };
}

async function fileOf($: EngineInterface, pid: number): Promise<string> {
  return `${await sessionsDir($)}/${pid}.json`;
}

async function contextOf($: EngineInterface): Promise<number | null> {
  return (await read($, usageAtom)).context;
}

async function placeOf($: EngineInterface): Promise<Pick<SessionRow, "cwd" | "branch">> {
  const cwd = await $.session.cwd();
  const branch = await gitIn($, cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return { cwd, branch: branch ?? "" };
}

async function ownRow($: EngineInterface): Promise<SessionRow | undefined> {
  const id = await $.session.id();
  return Object.values(await read($, sessionsAtom)).find((row) => row.sessionId === id);
}

export async function changeOwn(
  $: EngineInterface,
  patch: (row: SessionRow) => Partial<SessionRow>,
): Promise<void> {
  const own = await ownRow($);
  if (own === undefined) return;
  if (JSON.stringify({ ...own, ...patch(own) }) === JSON.stringify(own)) return;
  await applyOwn($, patch);
}

async function applyOwn(
  $: EngineInterface,
  patch: (row: SessionRow) => Partial<SessionRow>,
): Promise<void> {
  const id = await $.session.id();
  let changed: SessionRow | undefined;
  await update($, sessionsAtom, (known) => {
    changed = undefined;
    const own = Object.values(known).find((row) => row.sessionId === id);
    if (own === undefined) return known;
    changed = { ...own, ...patch(own) };
    return { ...known, [own.pid]: changed };
  });
  if (changed !== undefined) await writeOwnRow($, changed);
}

async function writeOwnRow($: EngineInterface, row: SessionRow): Promise<void> {
  await $.fs.write(await fileOf($, row.pid), JSON.stringify(row));
  const latest = await ownRow($);
  if (latest === undefined || JSON.stringify(latest) === JSON.stringify(row)) return;
  await writeOwnRow($, latest);
}

async function store($: EngineInterface, row: SessionRow): Promise<void> {
  await update($, sessionsAtom, (known) => ({ ...known, [row.pid]: row }));
  await $.fs.write(await fileOf($, row.pid), JSON.stringify(row));
}

async function announce($: EngineInterface): Promise<void> {
  const pid = await ownPid($);
  if (await isBackgroundSpare($, pid)) return;
  const sessionId = await $.session.id();
  const before = (await read($, sessionsAtom))[pid];
  const place = await placeOf($);
  await store(
    $,
    before?.sessionId === sessionId
      ? { ...before, ...place }
      : {
          pid,
          sessionId,
          state: "idle",
          ...place,
          ctx: await contextOf($),
          usd: before?.usd ?? null,
        },
  );
}

async function isBackgroundSpare($: EngineInterface, pid: number): Promise<boolean> {
  const text = await readText($, `${await registryDir($)}/${pid}.json`);
  const entry = parseRegistry(text);
  return entry !== null && entry.kind !== INTERACTIVE_KIND;
}

async function resumeFromWaiting($: EngineInterface): Promise<void> {
  const own = await ownRow($);
  if (own === undefined) return;
  const stored = parseRow(await readText($, await fileOf($, own.pid)));
  if (stored?.state !== "waiting") return;
  const now = await $.clock.now();
  await applyOwn($, (row) => stateChange(row, "running", now));
}

async function storedRows($: EngineInterface, dir: string): Promise<SessionRow[]> {
  const entries = await $.fs.list(dir);
  const rows = await Promise.all(
    entries
      .filter((entry) => SESSION_FILE.test(entry.name))
      .map(async (entry) => parseRow(await readText($, `${dir}/${entry.name}`))),
  );
  return rows.filter((row): row is SessionRow => row !== null);
}

async function alivePids($: EngineInterface, pids: number[]): Promise<Set<number>> {
  if (pids.length === 0) return new Set();
  const { stdout } = await $.process.run(["ps", "-p", pids.join(","), "-o", "pid=,comm="]);
  return new Set(
    stdout.split("\n").flatMap((line) => {
      const [pid = "", ...command] = line.trim().split(/\s+/);
      return command.join(" ").includes(CLAUDE_COMMAND) ? [Number(pid)] : [];
    }),
  );
}

async function applyFileChange(
  $: EngineInterface,
  path: string,
  event: "change" | "add" | "unlink",
): Promise<void> {
  const key = SESSION_PATH.exec(path)?.[1];
  if (key === undefined) return;
  const own = await ownRow($);
  if (String(own?.pid) === key) return;
  if (event === "unlink") {
    await update($, sessionsAtom, (known) =>
      Object.fromEntries(Object.entries(known).filter(([name]) => name !== key)),
    );
    return;
  }
  const row = parseRow(await readText($, path));
  if (row === null) return;
  await update($, sessionsAtom, (known) => ({ ...known, [key]: row }));
}

function readText($: EngineInterface, path: string): Promise<string> {
  return $.fs.read(path).catch(() => "");
}

function parseRow(text: string): SessionRow | null {
  try {
    const row = JSON.parse(text) as Partial<Record<keyof SessionRow, unknown>> | null;
    const isRow =
      typeof row?.pid === "number" &&
      typeof row.sessionId === "string" &&
      typeof row.state === "string" &&
      typeof row.cwd === "string" &&
      typeof row.branch === "string";
    return isRow ? (row as SessionRow) : null;
  } catch {
    return null;
  }
}

function registryStatusOf(value: unknown): RegistryStatus {
  return typeof value === "string" && value !== "" ? value : IDLE_STATUS;
}

function isEpoch(value: unknown): value is number {
  return typeof value === "number";
}

function parseRegistry(text: string): RegistryEntry | null {
  try {
    const entry = JSON.parse(text) as Partial<Record<string, unknown>> | null;
    const isEntry =
      typeof entry?.pid === "number" &&
      typeof entry.sessionId === "string" &&
      typeof entry.cwd === "string" &&
      typeof entry.kind === "string";
    if (!isEntry) return null;
    return {
      ...(entry as Omit<RegistryEntry, "status" | "statusUpdatedAt">),
      status: registryStatusOf(entry.status),
      statusUpdatedAt:
        [entry.statusUpdatedAt, entry.updatedAt, entry.startedAt].find(isEpoch) ?? null,
    };
  } catch {
    return null;
  }
}
