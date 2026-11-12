import type { SpendTotals, TranscriptProgress } from "../types";
import { folderName } from "./paths";
import { costOf, projectNamesOf } from "./transcript-cost";
import type { CallRow } from "./transcript-cost";

export type UseKind = "tool" | "toolFailure" | "skill";

export type UseRow = [kind: UseKind, folder: string, name: string, count: number];

export type Snapshot = {
  v: 1;
  imported: boolean;
  uses: UseRow[];
  limits: unknown;
  spendState: unknown;
};

export type TranscriptWindows = {
  now: number;
  hour: number;
  day: number;
  week: number;
  month: number;
};

export type TranscriptFileRow = {
  path: string;
  size: number;
  mtimeMs: number;
  offset: number;
  start: number;
  cwd: string;
};

export type DirTotals = [
  dir: string,
  today: number,
  week: number,
  month: number,
  lastHour: number,
  session: number,
];

export type TranscriptRaw = {
  dirs: DirTotals[];
  progress: TranscriptProgress | null;
  isIndexed: boolean;
  cwds: [dir: string, cwd: string][];
  slices: [dir: string, session: string, day: string, first: number, usd: number, own: number][];
  activeHours: number;
};

export const IMPORT_MARKER = "importedFromStore";
export const LIMITS_ROW = "usageLimits";

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const WEEK_DAYS = 7;
const MONTH_DAYS = 30;
const BUSY_TIMEOUT_MS = 5000;
const SNAPSHOT_VERSION = 1;
const LEASE_MS = 120_000;
const CALL_CHUNK = 500;
const PRUNE_CALLS_DAYS = 31;
export const LEASE_ROW = "transcriptLease";
export const PRICES_ROW = "transcriptPrices";
export const PROGRESS_ROW = "transcriptIndex";

export const USE_KEYS: Record<UseKind, string> = {
  tool: "toolUses",
  toolFailure: "toolFailures",
  skill: "skillUses",
};

const BATCH_PRELUDE = `.timeout ${BUSY_TIMEOUT_MS}
PRAGMA synchronous=NORMAL;`;

const PRELUDE = `.timeout ${BUSY_TIMEOUT_MS}
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;`;

const SCHEMA = `CREATE TABLE IF NOT EXISTS uses(kind TEXT NOT NULL, folder TEXT NOT NULL, name TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(kind,folder,name)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS spend_state(session_id TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime INTEGER NOT NULL, offset INTEGER NOT NULL, start INTEGER, cwd TEXT) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY, at INTEGER NOT NULL, usd REAL NOT NULL, dir TEXT NOT NULL, session TEXT NOT NULL, is_own INTEGER NOT NULL, start INTEGER NOT NULL, path TEXT NOT NULL) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS calls_window ON calls(at, dir, session, usd);`;

const CREDIT_REPLACED = `(excluded.is_own>is_own OR (excluded.is_own=is_own AND (excluded.start<start OR (excluded.start=start AND excluded.path<path))))`;

const CALL_CONFLICT = `ON CONFLICT(id) DO UPDATE SET usd=max(usd,excluded.usd), at=min(at,excluded.at), ${["dir", "session", "is_own", "start", "path"].map(creditColumn).join(", ")};`;

function creditColumn(column: string): string {
  return `${column}=CASE WHEN ${CREDIT_REPLACED} THEN excluded.${column} ELSE ${column} END`;
}

export function sqlText(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

export function sqlNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : "NULL";
}

export function sqlJson(value: unknown): string {
  return sqlText(JSON.stringify(value));
}

export function dayStart(at: number): number {
  return new Date(at).setHours(0, 0, 0, 0);
}

export function monthStart(now: number): number {
  return now - MONTH_DAYS * MS_PER_DAY;
}

export function initScript(sessionId: string): string {
  return `${PRELUDE}\n${SCHEMA}\n${snapshotQuery(sessionId)}\n`;
}

export function batchScript(writes: readonly string[], reads: readonly string[]): string {
  const transaction = writes.length === 0 ? [] : ["BEGIN IMMEDIATE;", ...writes, "COMMIT;"];
  return [BATCH_PRELUDE, ...transaction, ...reads].join("\n") + "\n";
}

function snapshotQuery(sessionId: string): string {
  return `SELECT json_object('v',${SNAPSHOT_VERSION},
'imported',CASE WHEN EXISTS(SELECT 1 FROM kv WHERE key=${sqlText(IMPORT_MARKER)}) THEN json('true') ELSE json('false') END,
'uses',json((SELECT coalesce(json_group_array(json_array(kind,folder,name,count)),'[]') FROM uses)),
'limits',json((SELECT value FROM kv WHERE key=${sqlText(LIMITS_ROW)})),
'spendState',json((SELECT state FROM spend_state WHERE session_id=${sqlText(sessionId)})));`;
}

export function countStatement(kind: UseKind, folder: string, name: string): string {
  return `INSERT INTO uses VALUES(${sqlText(kind)},${sqlText(folder)},${sqlText(name)},1) ON CONFLICT(kind,folder,name) DO UPDATE SET count=count+1;`;
}

export function clearStatement(folder: string, kinds: readonly UseKind[]): string {
  return `DELETE FROM uses WHERE folder=${sqlText(folder)} AND kind IN (${kinds.map(sqlText).join(",")});`;
}

export function limitsStatement(limits: unknown): string {
  return `INSERT INTO kv VALUES(${sqlText(LIMITS_ROW)},${sqlJson(limits)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value;`;
}

export function spendStateStatement(sessionId: string, state: unknown, now: number): string {
  return `INSERT INTO spend_state VALUES(${sqlText(sessionId)},${sqlJson(state)},${sqlNumber(now)}) ON CONFLICT(session_id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at;`;
}

export function importScript(raw: Readonly<Record<string, unknown>>, now: number): string {
  const inserts = [...useInserts(raw), ...limitsInserts(raw), ...spendStateInserts(raw, now)];
  const marker = `INSERT INTO kv VALUES(${sqlText(IMPORT_MARKER)},${sqlText(String(now))});`;
  return ["BEGIN IMMEDIATE;", marker, ...inserts, "COMMIT;"].join("\n") + "\n";
}

export function importRunScript(
  raw: Readonly<Record<string, unknown>>,
  sessionId: string,
  now: number,
): string {
  return `${BATCH_PRELUDE}\n${importScript(raw, now)}${snapshotQuery(sessionId)}\n`;
}

export function parseSnapshot(stdout: string): Snapshot | undefined {
  const lines = stdout.split("\n").filter((line) => line !== "");
  const parsed = parseLine(lines.at(-1));
  if (parsed?.v !== SNAPSHOT_VERSION) return undefined;
  return {
    ...parsed,
    limits: parsed.limits ?? undefined,
    spendState: parsed.spendState ?? undefined,
  };
}

export function lastLines(stdout: string, count: number): string[] {
  const lines = stdout.split("\n").filter((line) => line !== "");
  return count === 0 ? [] : lines.slice(-count);
}

function parseLine(line: string | undefined): Snapshot | undefined {
  if (line === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null ? (parsed as Snapshot) : undefined;
  } catch {
    return undefined;
  }
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function useInserts(raw: Readonly<Record<string, unknown>>): string[] {
  const inserts: string[] = [];
  for (const [kind, key] of Object.entries(USE_KEYS)) {
    for (const [folder, counts] of Object.entries(recordOf(raw[key]))) {
      for (const [name, count] of Object.entries(recordOf(counts))) {
        if (typeof count !== "number") continue;
        inserts.push(
          `INSERT INTO uses VALUES(${sqlText(kind)},${sqlText(folder)},${sqlText(name)},${sqlNumber(count)}) ON CONFLICT(kind,folder,name) DO UPDATE SET count=count+excluded.count;`,
        );
      }
    }
  }
  return inserts;
}

function limitsInserts(raw: Readonly<Record<string, unknown>>): string[] {
  const limits = raw[LIMITS_ROW];
  if (limits === undefined) return [];
  return [
    `INSERT INTO kv VALUES(${sqlText(LIMITS_ROW)},${sqlJson(limits)}) ON CONFLICT DO NOTHING;`,
  ];
}

function spendStateInserts(raw: Readonly<Record<string, unknown>>, now: number): string[] {
  return Object.entries(recordOf(raw.spendSessions)).map(
    ([sessionId, state]) =>
      `INSERT INTO spend_state VALUES(${sqlText(sessionId)},${sqlJson(state)},${sqlNumber(now)}) ON CONFLICT DO NOTHING;`,
  );
}

export function transcriptWindowsOf(now: number): TranscriptWindows {
  return {
    now,
    hour: now - MS_PER_HOUR,
    day: dayStart(now),
    week: now - WEEK_DAYS * MS_PER_DAY,
    month: monthStart(now),
  };
}

export function transcriptFileStatements(
  session: string,
  now: number,
  file: TranscriptFileRow,
  rows: readonly CallRow[],
): string[] {
  return [...callStatements(rows), fileStatement(file), leaseRenewStatement(session, now)];
}

export function transcriptClaimStatements(session: string, now: number, pricing: string): string[] {
  const id = sqlText(session);
  const key = sqlText(pricing);
  const isOwner = `${leaseOwner()}=${id}`;
  const isStale = `coalesce((SELECT value FROM kv WHERE key=${sqlText(PRICES_ROW)}),'')<>${key}`;
  return [
    `INSERT INTO kv VALUES(${sqlText(LEASE_ROW)},${leaseValue(id, now + LEASE_MS)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(kv.value,'$.until')<${sqlNumber(now)} OR json_extract(kv.value,'$.owner')=${id};`,
    `DELETE FROM calls WHERE ${isOwner} AND ${isStale};`,
    `DELETE FROM files WHERE ${isOwner} AND ${isStale};`,
    `INSERT INTO kv VALUES(${sqlText(PRICES_ROW)},${key}) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE ${isOwner};`,
  ];
}

export function transcriptOwnerQuery(session: string): string {
  return `SELECT coalesce(${leaseOwner()}=${sqlText(session)},0);`;
}

export function transcriptReleaseStatement(session: string): string {
  const id = sqlText(session);
  return `UPDATE kv SET value=${leaseValue(id, 0)} WHERE key=${sqlText(LEASE_ROW)} AND json_extract(value,'$.owner')=${id};`;
}

export function transcriptProgressStatement(progress: TranscriptProgress): string {
  return `INSERT INTO kv VALUES(${sqlText(PROGRESS_ROW)},${sqlJson(progress)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value;`;
}

export function transcriptFilesQuery(): string {
  return `SELECT coalesce(json_group_array(json_array(path,size,mtime,offset,start,cwd)),'[]') FROM files;`;
}

export function transcriptTotalsQuery(
  { now, hour, day, week, month }: TranscriptWindows,
  session: string,
): string {
  const mainTail = `/${session}.jsonl`;
  return `SELECT json_object(
'dirs',json((SELECT coalesce(json_group_array(json_array(dir,today,week,month,lastHour,own)),'[]') FROM (SELECT dir,
sum(usd*(at>=${day})) AS today,
sum(usd*(at>=${week})) AS week,
sum(usd) AS month,
sum(usd*(at>=${hour})) AS lastHour,
sum(usd*(session=${sqlText(session)})) AS own
FROM calls WHERE at BETWEEN ${month} AND ${now} GROUP BY dir))),
'progress',json((SELECT value FROM kv WHERE key=${sqlText(PROGRESS_ROW)})),
'isIndexed',CASE WHEN EXISTS(SELECT 1 FROM files WHERE substr(path,-${mainTail.length})=${sqlText(mainTail)}) THEN json('true') ELSE json('false') END,
'slices',json((SELECT coalesce(json_group_array(json_array(dir,session,day,first,usd,own)),'[]') FROM (SELECT dir,session,date(at/1000,'unixepoch','localtime') AS day,min(at) AS first,sum(usd) AS usd,session=${sqlText(session)} AS own FROM calls WHERE at BETWEEN ${month} AND ${now} GROUP BY dir,session,day))),
'activeHours',(SELECT count(DISTINCT at/${MS_PER_HOUR}) FROM calls WHERE at BETWEEN ${week} AND ${now}),
'cwds',json((SELECT coalesce(json_group_array(json_array(c.dir,f.cwd)),'[]') FROM (SELECT dir,min(path) AS path FROM calls GROUP BY dir) c JOIN files f ON f.path=c.path WHERE f.cwd<>'')));`;
}

export function sessionCallsQuery(session: string, since: number): string {
  return `SELECT coalesce(json_group_array(json_array(at,usd)),'[]') FROM (SELECT at,usd FROM calls WHERE at>=${sqlNumber(since)} AND session=${sqlText(session)} ORDER BY at);`;
}

export function sessionCostsQuery(w: TranscriptWindows, sessions: readonly string[]): string {
  return `SELECT coalesce(json_group_object(session,usd),'{}') FROM (SELECT session,sum(usd) AS usd FROM calls WHERE at BETWEEN ${w.month} AND ${w.now} AND session IN (${sessions.map(sqlText).join(",")}) GROUP BY session);`;
}

export function transcriptPruneStatements(now: number, ownSession: string): string[] {
  return [
    `DELETE FROM calls WHERE at<${sqlNumber(now - PRUNE_CALLS_DAYS * MS_PER_DAY)};`,
    `DELETE FROM files WHERE mtime<${sqlNumber(monthStart(now))};`,
    `DELETE FROM spend_state WHERE session_id<>${sqlText(ownSession)} AND updated_at<${sqlNumber(monthStart(now))};`,
  ];
}

export function spendTotalsOf(
  raw: TranscriptRaw,
  containers: readonly string[],
  at: number,
): SpendTotals {
  const names = projectNamesOf(
    raw.dirs.map(([dir]) => dir),
    containers,
  );
  const folders = new Map(raw.cwds.map(([dir, cwd]) => [dir, folderName(cwd)]));
  const projectOf = (dir: string): string => {
    const root = names.get(dir) ?? dir;
    return folders.get(root) ?? root;
  };
  const projects = new Map<string, number>();
  for (const [dir, , , month] of raw.dirs) {
    const name = projectOf(dir);
    projects.set(name, (projects.get(name) ?? 0) + month);
  }
  return {
    at,
    today: sumColumn(raw.dirs, 1),
    week: sumColumn(raw.dirs, 2),
    month: sumColumn(raw.dirs, 3),
    lastHour: sumColumn(raw.dirs, 4),
    projects: [...projects]
      .map(([name, usd]) => ({ name, usd }))
      .sort((a, b) => b.usd - a.usd || a.name.localeCompare(b.name)),
    session: raw.isIndexed ? sumColumn(raw.dirs, 5) : null,
    progress: raw.progress,
    slices: raw.slices.map(([dir, session, day, first, usd, own]) => ({
      project: projectOf(dir),
      session,
      day,
      at: first,
      usd,
      isOwn: own === 1,
    })),
    activeHours: raw.activeHours,
  };
}

function sumColumn(dirs: readonly DirTotals[], column: 1 | 2 | 3 | 4 | 5): number {
  return dirs.reduce((total, row) => total + row[column], 0);
}

function callStatements(rows: readonly CallRow[]): string[] {
  const statements: string[] = [];
  for (let from = 0; from < rows.length; from += CALL_CHUNK) {
    const values = rows
      .slice(from, from + CALL_CHUNK)
      .map(callValues)
      .join(",");
    statements.push(`INSERT INTO calls VALUES${values} ${CALL_CONFLICT}`);
  }
  return statements;
}

function callValues(row: CallRow): string {
  const { id, at, credit } = row;
  const usd = costOf(row);
  const start = Number.isFinite(credit.start) ? credit.start : Number.MAX_SAFE_INTEGER;
  return `(${sqlText(id)},${sqlNumber(at)},${sqlNumber(usd)},${sqlText(credit.dir)},${sqlText(credit.session)},${credit.isOwnSession ? 1 : 0},${sqlNumber(start)},${sqlText(credit.path)})`;
}

function fileStatement(file: TranscriptFileRow): string {
  return `INSERT INTO files VALUES(${sqlText(file.path)},${sqlNumber(file.size)},${sqlNumber(file.mtimeMs)},${sqlNumber(file.offset)},${sqlNumber(file.start)},${sqlText(file.cwd)}) ON CONFLICT(path) DO UPDATE SET size=excluded.size, mtime=excluded.mtime, offset=excluded.offset, start=excluded.start, cwd=excluded.cwd;`;
}

function leaseRenewStatement(session: string, now: number): string {
  const id = sqlText(session);
  return `UPDATE kv SET value=${leaseValue(id, now + LEASE_MS)} WHERE key=${sqlText(LEASE_ROW)} AND json_extract(value,'$.owner')=${id};`;
}

function leaseValue(quotedSession: string, until: number): string {
  return `json_object('owner',${quotedSession},'until',${sqlNumber(until)})`;
}

function leaseOwner(): string {
  return `(SELECT json_extract(value,'$.owner') FROM kv WHERE key=${sqlText(LEASE_ROW)})`;
}
