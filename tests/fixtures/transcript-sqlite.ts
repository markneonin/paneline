const TEXT = "'((?:[^']|'')*)'";
const NUMBER = "([^,)]+)";
const NUMBER_UNBOUNDED = "(-?\\d+)";
const CALL_TUPLE = new RegExp(
  `\\(${TEXT},${NUMBER},${NUMBER},${TEXT},${TEXT},[01],${NUMBER},${TEXT}\\)`,
  "g",
);
const FILE_ROW = new RegExp(
  `^INSERT INTO files VALUES\\(${TEXT},${NUMBER},${NUMBER},${NUMBER},${NUMBER},${TEXT}\\) ON CONFLICT`,
);
const CLAIM = new RegExp(
  `^INSERT INTO kv VALUES\\('transcriptLease',json_object\\('owner',${TEXT},'until',${NUMBER}\\)\\) ON CONFLICT\\(key\\) DO UPDATE SET value=excluded.value WHERE json_extract\\(kv.value,'\\$.until'\\)<${NUMBER} OR`,
);
const LEASE_UPDATE = new RegExp(
  `^UPDATE kv SET value=json_object\\('owner',${TEXT},'until',${NUMBER}\\) WHERE key='transcriptLease'`,
);
const PROGRESS = new RegExp(`^INSERT INTO kv VALUES\\('transcriptIndex',${TEXT}\\) ON CONFLICT`);
const OWNER_READ = new RegExp(
  `SELECT coalesce\\(\\(SELECT json_extract\\(value,'\\$.owner'\\) FROM kv WHERE key='transcriptLease'\\)=${TEXT},0\\);`,
  "g",
);
const FILES_READ =
  /SELECT coalesce\(json_group_array\(json_array\(path,size,mtime,offset,start,cwd\)\),'\[\]'\) FROM files;/g;
const TOTALS_READ = /SELECT json_object\(\n'dirs',[\s\S]*?f\.cwd<>''\)\)\);/g;
const SESSION_CALLS_READ = new RegExp(
  `SELECT coalesce\\(json_group_array\\(json_array\\(at,usd\\)\\),'\\[\\]'\\) FROM \\(SELECT at,usd FROM calls WHERE at>=${NUMBER_UNBOUNDED} AND session=${TEXT} ORDER BY at\\);`,
  "g",
);
const SESSION_COSTS_READ = /SELECT [^;]*GROUP BY session[^;]*;/g;
const PLAIN_READ = /^SELECT 1;$/gm;
const SNAPSHOT_LINE = JSON.stringify({
  v: 1,
  imported: true,
  uses: [],
  limits: null,
  spendState: null,
  totals: [],
});

type Call = { at: number; usd: number; dir: string; session: string; path: string };
type FileRow = [string, number, number, number, number | null, string];
type Lease = { owner: string; until: number };
type Read = { at: number; answer: () => string };

export type TranscriptSqlite = {
  holdLease: (owner: string, until: number) => void;
  leaseHolder: (now: number) => string | undefined;
  addCall: (id: string, call: Call) => void;
  progressWrites: () => number;
};

export function transcriptSqlite(): {
  db: TranscriptSqlite;
  answer: (stdin: string) => string;
} {
  const calls = new Map<string, Call>();
  const files = new Map<string, FileRow>();
  let lease: Lease | undefined;
  let progress: unknown = null;
  let progressWrites = 0;

  function unquote(text: string): string {
    return text.replaceAll("''", "'");
  }

  function applyWrite(line: string): void {
    const claim = CLAIM.exec(line);
    if (claim !== null) {
      const [, owner = "", until = "", now = ""] = claim;
      if (lease === undefined || lease.until < Number(now) || lease.owner === unquote(owner)) {
        lease = { owner: unquote(owner), until: Number(until) };
      }
      return;
    }
    const update = LEASE_UPDATE.exec(line);
    if (update !== null) {
      const [, owner = "", until = ""] = update;
      if (lease?.owner === unquote(owner)) lease = { owner: lease.owner, until: Number(until) };
      return;
    }
    const written = PROGRESS.exec(line);
    if (written !== null) {
      progressWrites += 1;
      progress = JSON.parse(unquote(written[1] ?? "null"));
      return;
    }
    if (line.startsWith("INSERT INTO calls VALUES")) {
      for (const tuple of line.matchAll(CALL_TUPLE)) {
        const [, id = "", at = "", usd = "", dir = "", session = "", , path = ""] = tuple;
        const seen = calls.get(unquote(id));
        calls.set(unquote(id), {
          at: Math.min(Number(at), seen?.at ?? Number.POSITIVE_INFINITY),
          usd: Math.max(Number(usd), seen?.usd ?? 0),
          dir: seen?.dir ?? unquote(dir),
          session: seen?.session ?? unquote(session),
          path: seen?.path ?? unquote(path),
        });
      }
      return;
    }
    const file = FILE_ROW.exec(line);
    if (file === null) return;
    const [, path = "", size = "", mtime = "", offset = "", start = "", cwd = ""] = file;
    files.set(unquote(path), [
      unquote(path),
      Number(size),
      Number(mtime),
      Number(offset),
      start === "NULL" ? null : Number(start),
      unquote(cwd),
    ]);
  }

  function totalsAnswer(query: string): string {
    const bound = (name: string): number =>
      Number(new RegExp(`at>=(\\d+)\\)\\) AS ${name}`).exec(query)?.[1]);
    const [, month = "", now = ""] = /BETWEEN (-?\d+) AND (\d+)/.exec(query) ?? [];
    const session = unquote(
      /sum\(usd\*\(session='((?:[^']|'')*)'\)\) AS own/.exec(query)?.[1] ?? "",
    );
    const inWindow = [...calls.values()].filter(
      (call) => call.at >= Number(month) && call.at <= Number(now),
    );
    const dirs = [...new Set(inWindow.map((call) => call.dir))].map((dir) => {
      const own = inWindow.filter((call) => call.dir === dir);
      const sum = (since: number, only: (call: Call) => boolean = () => true): number =>
        own.filter((call) => call.at >= since && only(call)).reduce((s, c) => s + c.usd, 0);
      return [
        dir,
        sum(bound("today")),
        sum(bound("week")),
        sum(Number(month)),
        sum(bound("lastHour")),
        sum(0, (call) => call.session === session),
      ];
    });
    const mainTail = `/${session}.jsonl`;
    const firstPathOf = (dir: string): string | undefined =>
      [...calls.values()]
        .filter((call) => call.dir === dir)
        .map((call) => call.path)
        .sort()[0];
    const cwds = [...new Set([...calls.values()].map((call) => call.dir))]
      .map((dir): [string, string] => [dir, files.get(firstPathOf(dir) ?? "")?.[5] ?? ""])
      .filter(([, cwd]) => cwd !== "");
    return JSON.stringify({
      dirs,
      progress,
      isIndexed: [...files.keys()].some((path) => path.endsWith(mainTail)),
      slices: [],
      activeHours: 0,
      cwds,
    });
  }

  function sessionCallsAnswer(since: number, session: string): string {
    const own = [...calls.values()]
      .filter((call) => call.session === session && call.at >= since)
      .sort((a, b) => a.at - b.at);
    return JSON.stringify(own.map((call) => [call.at, call.usd]));
  }

  function sessionCostsAnswer(query: string): string {
    const [, from = "", to = ""] = /BETWEEN (-?\d+) AND (\d+)/.exec(query) ?? [];
    const list = /session IN \(([^)]*)\)/.exec(query)?.[1] ?? "";
    const wanted = [...list.matchAll(/'((?:[^']|'')*)'/g)].map((id) => unquote(id[1] ?? ""));
    const sums: Record<string, number> = {};
    for (const call of calls.values()) {
      const isInside = call.at >= Number(from) && call.at <= Number(to);
      if (isInside && wanted.includes(call.session))
        sums[call.session] = (sums[call.session] ?? 0) + call.usd;
    }
    return JSON.stringify(sums);
  }

  function readsOf(stdin: string): Read[] {
    const reads: Read[] = [];
    for (const match of stdin.matchAll(OWNER_READ)) {
      const asked = unquote(match[1] ?? "");
      reads.push({ at: match.index, answer: () => (lease?.owner === asked ? "1" : "0") });
    }
    for (const match of stdin.matchAll(FILES_READ)) {
      reads.push({ at: match.index, answer: () => JSON.stringify([...files.values()]) });
    }
    for (const match of stdin.matchAll(TOTALS_READ)) {
      reads.push({ at: match.index, answer: () => totalsAnswer(match[0]) });
    }
    for (const match of stdin.matchAll(SESSION_CALLS_READ)) {
      reads.push({
        at: match.index,
        answer: () => sessionCallsAnswer(Number(match[1]), unquote(match[2] ?? "")),
      });
    }
    for (const match of stdin.matchAll(SESSION_COSTS_READ)) {
      reads.push({ at: match.index, answer: () => sessionCostsAnswer(match[0]) });
    }
    for (const match of stdin.matchAll(PLAIN_READ)) {
      reads.push({ at: match.index, answer: () => "1" });
    }
    return reads.sort((a, b) => a.at - b.at);
  }

  function answer(stdin: string): string {
    if (stdin.includes("CREATE TABLE IF NOT EXISTS")) return `wal\n${SNAPSHOT_LINE}\n`;
    for (const line of stdin.split("\n")) applyWrite(line);
    return readsOf(stdin)
      .map((read) => `${read.answer()}\n`)
      .join("");
  }

  const db: TranscriptSqlite = {
    holdLease: (owner, until) => {
      lease = { owner, until };
    },
    leaseHolder: (now) => (lease !== undefined && lease.until >= now ? lease.owner : undefined),
    addCall: (id, call) => {
      calls.set(id, call);
    },
    progressWrites: () => progressWrites,
  };
  return { db, answer };
}
