import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    const isBare = specifier.startsWith(".") && !/\.\w+$/.test(specifier);
    return isBare ? next(`${specifier}.ts`, context) : next(specifier, context);
  },
});

const sql = await import("../hooks/store-sql.ts");
const { countStatement, importScript, initScript, lastLines } = sql;
const cost = await import("../hooks/transcript-cost.ts");
const oracle = await import("../tests/transcript-oracle.ts");
const summary = await import("../tests/fixtures/transcript-summary.ts");
const fixture = await import("../tests/fixtures/transcript-oracle.ts");
const world = await import("../tests/fixtures/spend-world.ts");

const SQLITE_ARGS = ["-bail", "-batch", "-noheader", "-list"];
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const WORKERS = 18;
const RUNS_PER_WORKER = 20;
const EXPECTED_COUNT = WORKERS * RUNS_PER_WORKER;
const USD_TOLERANCE = 1e-6;
const MICROS_PER_USD = 100_000_000;
const LEASE_MS = 120_000;
const TX_NOW = world.WORLD_NOW;
const USD_PER_OUTPUT_TOKEN = 20 / 1_000_000;
const PRICES_V1 = "prices-v1";
const PRICES_V2 = "prices-v2";
const NOW_HOUR = Date.UTC(2026, 9, 29, 12);
const NOW = NOW_HOUR + 30 * 60_000;
const ALPHA = "/home/dev/alpha";
const BETA = "/home/dev/beta";
const GAMMA = "/home/dev/gamma";
const OWN_SESSION = "sess-state-1";

const failures = [];
const lines = [];

const OLD_STORE = oldStore();

main().then(
  () => finish(),
  (error) => {
    failures.push(`unexpected: ${error instanceof Error ? error.stack : String(error)}`);
    finish();
  },
);

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "paneline-store-"));
  try {
    await parallelCounts(join(dir, "parallel.db"));
    await importedStore(join(dir, "imported.db"));
    await transcriptScenarios(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function parallelCounts(db) {
  await mustRun(db, initScript(OWN_SESSION));
  const started = performance.now();
  const results = await Promise.all(
    Array.from({ length: WORKERS }, () => sequentialIncrements(db)),
  );
  const ms = Math.round(performance.now() - started);
  const failed = results.flat().filter((result) => result.code !== 0);
  const counted = await queryJson(
    db,
    "SELECT json_group_array(count) FROM uses WHERE kind='skill' AND folder='/work' AND name='commit';",
  );
  check(
    "A18",
    `${WORKERS} parallel workers x ${RUNS_PER_WORKER} increments end at ${EXPECTED_COUNT}`,
    failed.length === 0 && same(counted, [EXPECTED_COUNT]),
    `count=${JSON.stringify(counted)} failedRuns=${failed.length} in ${ms} ms`,
  );
}

async function sequentialIncrements(db) {
  const results = [];
  for (let run = 0; run < RUNS_PER_WORKER; run++) {
    results.push(
      await runSqlite(
        db,
        `.timeout 5000\nPRAGMA synchronous=NORMAL;\n${countStatement("skill", "/work", "commit")}\n`,
      ),
    );
  }
  return results;
}

async function importedStore(db) {
  await mustRun(db, initScript(OWN_SESSION));
  const imported = await runSqlite(db, importScript(OLD_STORE, NOW));
  check(
    "A20-run",
    "the import script runs to the end",
    imported.code === 0,
    imported.stderr.trim(),
  );

  const uses = await queryJson(
    db,
    "SELECT json_group_array(json_array(kind,folder,name,count)) FROM uses;",
  );
  const wanted = expectedUses();
  check(
    "A20",
    "folder counts equal the old store's folder maps",
    same(sorted(uses), sorted(wanted)),
    `${uses.length} rows, wanted ${wanted.length}`,
  );

  const flat = uses.filter((row) => ["commit", "review"].includes(row[1]));
  check(
    "A23",
    "flat skill ints do not show up as folders",
    flat.length === 0,
    `${flat.length} flat rows`,
  );

  const limits = await queryJson(
    db,
    "SELECT json_group_array(json(value)) FROM kv WHERE key='usageLimits';",
  );
  const states = await queryJson(
    db,
    "SELECT json_group_object(session_id, json(state)) FROM spend_state;",
  );
  check(
    "A24",
    "saved meters and each session's spend state are in the database as they were",
    same(limits, [OLD_STORE.usageLimits]) && same(states, OLD_STORE.spendSessions),
    `${Object.keys(states).length} states`,
  );

  const before = dumpOf(db);
  await runSqlite(db, importScript(OLD_STORE, NOW + MS_PER_HOUR));
  const after = dumpOf(db);
  check(
    "A26",
    "a second import changes nothing",
    before === after,
    `dump ${before.length} -> ${after.length} chars`,
  );

  const snapshot = await snapshotOf(db);
  check(
    "A27",
    "the next start reports the database imported and returns the same counts and meters",
    snapshot.v === 1 &&
      snapshot.imported === true &&
      same(sorted(snapshot.uses), sorted(wanted)) &&
      same(snapshot.limits, OLD_STORE.usageLimits),
    JSON.stringify({ v: snapshot.v, imported: snapshot.imported, uses: snapshot.uses?.length }),
  );
}

async function transcriptScenarios(dir) {
  let created = 0;
  const freshDb = async () => {
    const db = join(dir, `transcripts-${created++}.db`);
    await mustRun(db, initScript(OWN_SESSION));
    return db;
  };
  await scenario(
    "S1",
    "a call written by two files keeps the larger cost and the earlier time",
    () => duplicateKeepsMaxUsdEarliestAt(freshDb),
  );
  await scenario("S2", "a call written by two files goes to the session that wrote it", () =>
    creditOwnSessionWins(freshDb),
  );
  await scenario(
    "S3",
    "with no writer among the files the call goes to the earlier session, then the smaller path",
    () => creditEarliestStartThenPath(freshDb),
  );
  await scenario("S4", "a second session cannot index while the first one holds the lease", () =>
    leaseHeldBlocksOther(freshDb),
  );
  await scenario("S5", "a second session takes over a lease that ran out", () =>
    leaseExpiredTakenOver(freshDb),
  );
  await scenario("S6", "a second session indexes right after the first one ended its run", () =>
    leaseReleasedAtRunEnd(freshDb),
  );
  await scenario(
    "S7",
    "a changed price table empties the stored calls and files and stores the new key",
    () => priceKeyChangeEmpties(freshDb),
  );
  await scenario(
    "S7b",
    "a session that does not hold the lease cannot empty the stored calls",
    () => priceKeyChangeByNonOwnerKeepsRows(freshDb),
  );
  await scenario(
    "S8",
    "today, 7 days, 30 days and last hour include their edge calls and nothing older",
    () => windowsTodayWeekMonthHour(freshDb),
  );
  await scenario("S9", "calls later than now add to no total", () => futureCallsIgnored(freshDb));
  await scenario(
    "S10",
    "this session adds its subagents and is empty until its own transcript is indexed",
    () => ownSessionSumAndIndexedFlag(freshDb),
  );
  await scenario(
    "S11",
    "the indexing progress is read back as written, empty before the first write",
    () => progressAndFailedRow(freshDb),
  );
  await scenario(
    "S12",
    "today, 7 days, 30 days, By project and this session equal the transcript oracle",
    () => worldEqualsOracle(freshDb),
  );
  await scenario("S13", "saving the same file again, now or in a later run, changes nothing", () =>
    sameFileSavedTwiceNoChange(freshDb),
  );
  await scenario(
    "S14",
    "an index stopped after the first file and rerun by another session gives the same totals",
    () => stoppedAfterFirstFileThenRerun(freshDb),
  );
  await scenario("S15", "last hour counts the 60 minutes before now, not the clock hour", () =>
    lastHourByHand(freshDb),
  );
  await scenario(
    "S16",
    "the cleanup removes calls older than 31 days and files older than 30 days only",
    () => pruneRemovesOldOnly(freshDb),
  );
  await scenario(
    "S17",
    "the cleanup removes spend states of other sessions not updated for 30 days and keeps the own and fresh ones",
    () => pruneSpendStates(freshDb),
  );
  await scenario(
    "S18",
    "By project names each project by its folder, rolls a worktree into its project and keeps the dir name where no folder is known",
    () => projectsNamedByFolder(freshDb),
  );
  await scenario(
    "SDY1",
    "two projects on three local days: the day sums equal the hand sums and add up to the 30 days total",
    () => daySumsEqualHandSums(freshDb),
  );
  await scenario(
    "SDY2",
    "a call at 23:59 yesterday and one at 00:01 today fall on two days, and today's day sum equals the today total",
    () => midnightSplitsDays(freshDb),
  );
  await scenario(
    "SDY3",
    "calls at 09:10, 09:50 and 14:00 inside the last 7 days count as 2 active hours",
    () => activeHoursCountDistinctHours(freshDb),
  );
  await scenario(
    "SDY6",
    "with calls from the indexing session and another session on one day, only the indexing session's slices come back with own = true from real sqlite",
    () => onlyIndexingSessionSlicesAreOwn(freshDb),
  );
}

async function scenario(id, name, run) {
  try {
    const { isOk, detail } = await run();
    check(id, name, isOk, detail);
  } catch (error) {
    check(id, name, false, `threw ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function duplicateKeepsMaxUsdEarliestAt(freshDb) {
  const at = TX_NOW - 2 * MS_PER_HOUR;
  const partial = lineFile("-d1/p.jsonl", at + 5000, [
    fixture.assistantLine({ id: "x", sessionId: "zzz", at: at + 5000, output: 1000 }),
  ]);
  const full = lineFile("-d2/f.jsonl", at, [
    fixture.assistantLine({ id: "x", sessionId: "zzz", at, output: 900_000 }),
  ]);
  const fullUsd = cost.costOf(rowsOfFile(full)[0]);
  const wanted = [["x", at, fullUsd]];
  const partialFirst = await callsAfterSaving(
    await freshDb(),
    [partial, full],
    "json_array(id,at,usd)",
  );
  const fullFirst = await callsAfterSaving(
    await freshDb(),
    [full, partial],
    "json_array(id,at,usd)",
  );
  return {
    isOk: sameRows(partialFirst, wanted) && sameRows(fullFirst, wanted),
    detail: `partial first ${JSON.stringify(partialFirst)}, full first ${JSON.stringify(fullFirst)}, wanted ${JSON.stringify(wanted)}`,
  };
}

async function creditOwnSessionWins(freshDb) {
  const at = TX_NOW - MS_PER_HOUR;
  const copy = lineFile("-d1/copy.jsonl", at - 1000, [
    fixture.assistantLine({ id: "x", sessionId: "mine", at, output: 1000 }),
  ]);
  const mine = lineFile("-d2/mine.jsonl", at + 1000, [
    fixture.assistantLine({ id: "x", sessionId: "mine", at, output: 1000 }),
  ]);
  const column = "json_array(id,session,dir,is_own,path)";
  const wanted = [["x", "mine", "-d2", 1, mine.path]];
  const copyFirst = await callsAfterSaving(await freshDb(), [copy, mine], column);
  const mineFirst = await callsAfterSaving(await freshDb(), [mine, copy], column);
  return {
    isOk: sameRows(copyFirst, wanted) && sameRows(mineFirst, wanted),
    detail: `copy first ${JSON.stringify(copyFirst)}, own first ${JSON.stringify(mineFirst)}`,
  };
}

async function creditEarliestStartThenPath(freshDb) {
  const at = TX_NOW - MS_PER_HOUR;
  const writtenElsewhere = (id) =>
    fixture.assistantLine({ id, sessionId: "zzz", at, output: 1000 });
  const files = [
    lineFile("-d1/s1.jsonl", 100, [writtenElsewhere("u")]),
    lineFile("-d2/s2.jsonl", 200, [writtenElsewhere("u")]),
    lineFile("-d3/t-b.jsonl", 300, [writtenElsewhere("v")]),
    lineFile("-d3/t-a.jsonl", 300, [writtenElsewhere("v")]),
  ];
  const column = "json_array(id,session,dir,path)";
  const wanted = [
    ["u", "s1", "-d1", files[0].path],
    ["v", "t-a", "-d3", files[3].path],
  ];
  const forward = await callsAfterSaving(await freshDb(), files, column);
  const backward = await callsAfterSaving(await freshDb(), [...files].reverse(), column);
  return {
    isOk: sameRows(forward, wanted) && sameRows(backward, wanted),
    detail: `forward ${JSON.stringify(forward)}, backward ${JSON.stringify(backward)}`,
  };
}

async function leaseHeldBlocksOther(freshDb) {
  const db = await freshDb();
  const first = await claim(db, "sess-a", TX_NOW);
  const early = await claim(db, "sess-b", TX_NOW + LEASE_MS - 1);
  const again = await claim(db, "sess-a", TX_NOW + 1000);
  await saveFile(db, "sess-a", TX_NOW + 100_000, lineFile("-d1/a.jsonl", 1, [oneCall("c1")]));
  const renewed = await claim(db, "sess-b", TX_NOW + 200_000);
  return {
    isOk: first && !early && again && !renewed,
    detail: `owns [first, other early, first again, other after renewal] ${JSON.stringify([first, early, again, renewed])}`,
  };
}

async function leaseExpiredTakenOver(freshDb) {
  const db = await freshDb();
  const first = await claim(db, "sess-a", TX_NOW);
  const taken = await claim(db, "sess-b", TX_NOW + LEASE_MS + 1);
  const late = await claim(db, "sess-a", TX_NOW + LEASE_MS + 2);
  return {
    isOk: first && taken && !late,
    detail: `owners ${JSON.stringify([first, taken, late])}`,
  };
}

async function leaseReleasedAtRunEnd(freshDb) {
  const db = await freshDb();
  const first = await claim(db, "sess-a", TX_NOW);
  const blocked = await claim(db, "sess-b", TX_NOW + 1);
  await runInTransaction(db, sql.transcriptReleaseStatement("sess-a"));
  const afterRelease = await claim(db, "sess-b", TX_NOW + 2);
  return {
    isOk: first && !blocked && afterRelease,
    detail: `owners ${JSON.stringify([first, blocked, afterRelease])}`,
  };
}

async function priceKeyChangeEmpties(freshDb) {
  const db = await freshDb();
  await claim(db, "sess-a", TX_NOW, PRICES_V1);
  for (const file of world.worldFiles().slice(0, 2)) await saveFile(db, "sess-a", TX_NOW, file);
  const before = await storedCounts(db);
  await runInTransaction(db, sql.transcriptReleaseStatement("sess-a"));
  const owner = await claim(db, "sess-a", TX_NOW + 1000, PRICES_V2);
  const after = await storedCounts(db);
  return {
    isOk:
      before.calls > 0 &&
      before.files === 2 &&
      owner &&
      after.calls === 0 &&
      after.files === 0 &&
      same(after.prices, [PRICES_V2]),
    detail: `before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`,
  };
}

async function priceKeyChangeByNonOwnerKeepsRows(freshDb) {
  const db = await freshDb();
  await claim(db, "sess-a", TX_NOW, PRICES_V1);
  await saveFile(db, "sess-a", TX_NOW, world.worldFiles()[0]);
  const before = await storedCounts(db);
  const owner = await claim(db, "sess-b", TX_NOW + 1000, PRICES_V2);
  const after = await storedCounts(db);
  return {
    isOk: !owner && same(after, before),
    detail: `owner ${owner}, before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`,
  };
}

async function windowsTodayWeekMonthHour(freshDb) {
  const db = await freshDb();
  const dayStart = new Date(TX_NOW).setHours(0, 0, 0, 0);
  const week = TX_NOW - 7 * MS_PER_DAY;
  const month = TX_NOW - 30 * MS_PER_DAY;
  const hour = TX_NOW - MS_PER_HOUR;
  const edges = [
    [TX_NOW, 1000],
    [hour, 2000],
    [hour - 1, 4000],
    [dayStart, 8000],
    [dayStart - 1, 16_000],
    [week, 32_000],
    [week - 1, 64_000],
    [month, 128_000],
    [month - 1, 256_000],
  ];
  const file = lineFile(
    "-d1/s.jsonl",
    1,
    edges.map(([at, output], index) =>
      fixture.assistantLine({ id: `e${index}`, sessionId: "s", at, output }),
    ),
  );
  await claim(db, "sess-a", TX_NOW);
  await saveFile(db, "sess-a", TX_NOW, file);
  const atom = await atomOf(db, "sess-a", TX_NOW);
  const wanted = {
    lastHour: (1000 + 2000) * USD_PER_OUTPUT_TOKEN,
    today: (1000 + 2000 + 4000 + 8000) * USD_PER_OUTPUT_TOKEN,
    week: (1000 + 2000 + 4000 + 8000 + 16_000 + 32_000) * USD_PER_OUTPUT_TOKEN,
    month: (1000 + 2000 + 4000 + 8000 + 16_000 + 32_000 + 64_000 + 128_000) * USD_PER_OUTPUT_TOKEN,
  };
  return {
    isOk: sameRows(
      [[atom.lastHour, atom.today, atom.week, atom.month]],
      [[wanted.lastHour, wanted.today, wanted.week, wanted.month]],
    ),
    detail: `got ${JSON.stringify([atom.lastHour, atom.today, atom.week, atom.month])}, wanted ${JSON.stringify(wanted)}`,
  };
}

async function futureCallsIgnored(freshDb) {
  const db = await freshDb();
  const file = lineFile("-d1/s.jsonl", 1, [
    fixture.assistantLine({ id: "past", sessionId: "s", at: TX_NOW - MS_PER_HOUR, output: 1000 }),
    fixture.assistantLine({ id: "next-ms", sessionId: "s", at: TX_NOW + 1, output: 10_000_000 }),
    fixture.assistantLine({
      id: "next-hour",
      sessionId: "s",
      at: TX_NOW + MS_PER_HOUR,
      output: 20_000_000,
    }),
  ]);
  await claim(db, "sess-a", TX_NOW);
  await saveFile(db, "sess-a", TX_NOW, file);
  const atom = await atomOf(db, "s", TX_NOW);
  const wanted = 1000 * USD_PER_OUTPUT_TOKEN;
  return {
    isOk: sameRows(
      [[atom.today, atom.week, atom.month, atom.lastHour, atom.session]],
      [[wanted, wanted, wanted, wanted, wanted]],
    ),
    detail: `today ${atom.today}, week ${atom.week}, month ${atom.month}, hour ${atom.lastHour}, session ${atom.session}, wanted ${wanted}`,
  };
}

async function ownSessionSumAndIndexedFlag(freshDb) {
  const db = await freshDb();
  const own = "sess-own";
  const at = TX_NOW - MS_PER_HOUR;
  const line = (id, session, output, when = at) =>
    fixture.assistantLine({ id, sessionId: session, at: when, output });
  const subagent = lineFile(`-d1/${own}/subagents/agent-1.jsonl`, 1, [line("m2", own, 2000)]);
  const other = lineFile("-d1/other.jsonl", 2, [line("o1", "other", 4000)]);
  const main = lineFile(`-d1/${own}.jsonl`, 3, [
    line("m1", own, 1000),
    line("m0", own, 8000, TX_NOW - 31 * MS_PER_DAY),
  ]);
  await claim(db, "sess-a", TX_NOW);
  await saveFile(db, "sess-a", TX_NOW, subagent);
  await saveFile(db, "sess-a", TX_NOW, other);
  const beforeMain = await atomOf(db, own, TX_NOW);
  await saveFile(db, "sess-a", TX_NOW, main);
  const afterMain = await atomOf(db, own, TX_NOW);
  const wanted = (1000 + 2000) * USD_PER_OUTPUT_TOKEN;
  return {
    isOk:
      beforeMain.session === null &&
      afterMain.session !== null &&
      sameRows([[afterMain.session]], [[wanted]]),
    detail: `before main ${beforeMain.session}, after main ${afterMain.session}, wanted ${wanted}`,
  };
}

async function progressAndFailedRow(freshDb) {
  const db = await freshDb();
  const empty = await atomOf(db, "s", TX_NOW);
  const running = { doneBytes: 50, totalBytes: 200, failed: 0 };
  await runInTransaction(db, sql.transcriptProgressStatement(running));
  const midway = await atomOf(db, "s", TX_NOW);
  const finished = { doneBytes: 200, totalBytes: 200, failed: 2 };
  await runInTransaction(db, sql.transcriptProgressStatement(finished));
  const last = await atomOf(db, "s", TX_NOW);
  return {
    isOk:
      empty.progress === null && same(midway.progress, running) && same(last.progress, finished),
    detail: `empty ${JSON.stringify(empty.progress)}, midway ${JSON.stringify(midway.progress)}, last ${JSON.stringify(last.progress)}`,
  };
}

async function worldEqualsOracle(freshDb) {
  const db = await freshDb();
  const files = world.worldFiles();
  await claim(db, "sess-a", TX_NOW);
  for (const file of [...files].reverse()) await saveFile(db, "sess-a", TX_NOW, file);
  const atom = await atomOf(db, world.OWN_SESSION, TX_NOW, world.CONTAINERS);
  const wanted = oracleFigures(files);
  const shown = figuresOfAtom(atom);
  return {
    isOk: wanted.month > 0 && wanted.projects.length > 0 && sameDeep(shown, wanted),
    detail: `atom ${JSON.stringify(shown)}, oracle ${JSON.stringify(wanted)}`,
  };
}

async function sameFileSavedTwiceNoChange(freshDb) {
  const db = await freshDb();
  const [file] = world.worldFiles();
  await claim(db, "sess-a", TX_NOW);
  await saveFile(db, "sess-a", TX_NOW, file);
  const once = await storedRows(db);
  await saveFile(db, "sess-a", TX_NOW, file);
  const twice = await storedRows(db);
  await saveFile(db, "sess-a", TX_NOW + 1000, file);
  const later = await storedRows(db);
  return {
    isOk: once.calls.length > 0 && same(once, twice) && same(once, later),
    detail: `${once.calls.length} calls, ${once.files.length} files; same twice ${same(once, twice)}; same later ${same(once, later)}`,
  };
}

async function stoppedAfterFirstFileThenRerun(freshDb) {
  const files = world.worldFiles();
  const full = await freshDb();
  await claim(full, "sess-a", TX_NOW);
  for (const file of files) await saveFile(full, "sess-a", TX_NOW, file);
  const stopped = await freshDb();
  await claim(stopped, "sess-a", TX_NOW);
  await saveFile(stopped, "sess-a", TX_NOW, files[0]);
  const rerunAt = TX_NOW + LEASE_MS + 1;
  const owner = await claim(stopped, "sess-b", rerunAt);
  for (const file of [...files].reverse()) await saveFile(stopped, "sess-b", rerunAt, file);
  const wanted = figuresOfAtom(await atomOf(full, world.OWN_SESSION, TX_NOW, world.CONTAINERS));
  const shown = figuresOfAtom(await atomOf(stopped, world.OWN_SESSION, TX_NOW, world.CONTAINERS));
  return {
    isOk: owner && wanted.month > 0 && sameDeep(shown, wanted),
    detail: `owner ${owner}, rerun ${JSON.stringify(shown)}, one run ${JSON.stringify(wanted)}`,
  };
}

async function lastHourByHand(freshDb) {
  const db = await freshDb();
  const now = TX_NOW + 20 * 60_000;
  const file = lineFile("-d1/s.jsonl", 1, [
    fixture.assistantLine({ id: "h1", sessionId: "s", at: now - 30 * 60_000, output: 5000 }),
    fixture.assistantLine({ id: "h2", sessionId: "s", at: now - 90 * 60_000, output: 7000 }),
  ]);
  await claim(db, "sess-a", now);
  await saveFile(db, "sess-a", now, file);
  const atom = await atomOf(db, "s", now);
  const wanted = [5000 * USD_PER_OUTPUT_TOKEN, 12_000 * USD_PER_OUTPUT_TOKEN];
  return {
    isOk: sameRows([[atom.lastHour, atom.today]], [wanted]),
    detail: `got ${JSON.stringify([atom.lastHour, atom.today])}, wanted ${JSON.stringify(wanted)}`,
  };
}

async function pruneRemovesOldOnly(freshDb) {
  const db = await freshDb();
  const line = (id, at) => fixture.assistantLine({ id, sessionId: "s", at, output: 1000 });
  const oldFile = lineFile("-d1/old.jsonl", 1, [line("gone", TX_NOW - 32 * MS_PER_DAY)]);
  const newFile = lineFile("-d1/new.jsonl", 2, [line("kept", TX_NOW - 30.5 * MS_PER_DAY)]);
  await claim(db, "sess-a", TX_NOW);
  await saveFile(db, "sess-a", TX_NOW, oldFile, TX_NOW - 31 * MS_PER_DAY);
  await saveFile(db, "sess-a", TX_NOW, newFile, TX_NOW - 29 * MS_PER_DAY);
  await runInTransaction(db, sql.transcriptPruneStatements(TX_NOW, "sess-a"));
  const left = await storedRows(db);
  return {
    isOk:
      same(
        left.calls.map((row) => row[0]),
        ["kept"],
      ) &&
      same(
        left.files.map((row) => row[0]),
        [newFile.path],
      ),
    detail: `calls ${JSON.stringify(left.calls.map((row) => row[0]))}, files ${JSON.stringify(left.files.map((row) => row[0]))}`,
  };
}

async function pruneSpendStates(freshDb) {
  const db = await freshDb();
  const state = { sessionId: "x" };
  const put = (session, at) => sql.spendStateStatement(session, state, at);
  await runInTransaction(db, [
    put("sess-old", TX_NOW - 31 * MS_PER_DAY),
    put("sess-own", TX_NOW - 40 * MS_PER_DAY),
    put("sess-fresh", TX_NOW - 29 * MS_PER_DAY),
  ]);
  await runInTransaction(db, sql.transcriptPruneStatements(TX_NOW, "sess-own"));
  const left = await queryJson(
    db,
    "SELECT json_group_array(session_id) FROM (SELECT session_id FROM spend_state ORDER BY session_id);",
  );
  return {
    isOk: same(left, ["sess-fresh", "sess-own"]),
    detail: `left ${JSON.stringify(left)}`,
  };
}

async function projectsNamedByFolder(freshDb) {
  const db = await freshDb();
  const home = "/home/dev";
  const places = [
    ["-home-dev-projects-IT-battle-game", `${home}/projects/IT/battle-game`, 1000],
    ["-home-dev-projects-IT-demo-app", `${home}/projects/IT/demo-app`, 2000],
    ["-home-dev-projects-IT-demo-app-spend-fix", `${home}/projects/IT/demo-app-spend-fix`, 4000],
    ["-home-dev", home, 8000],
  ];
  await claim(db, "sess-a", TX_NOW);
  for (const [at, [dir, cwd, output]] of places.entries()) {
    const file = {
      ...lineFile(`${dir}/s${at}.jsonl`, at + 1, [
        fixture.assistantLine({
          id: `p${at}`,
          sessionId: `s${at}`,
          at: TX_NOW - MS_PER_HOUR,
          output,
        }),
      ]),
      cwd,
    };
    await saveFile(db, "sess-a", TX_NOW, file);
  }
  const lost = lineFile("-gone-dir/s9.jsonl", 9, [
    fixture.assistantLine({ id: "p9", sessionId: "s9", at: TX_NOW - MS_PER_HOUR, output: 16000 }),
  ]);
  await saveFile(db, "sess-a", TX_NOW, { ...lost, cwd: "" });
  const atom = await atomOf(db, "s", TX_NOW, ["-home-dev"]);
  const shown = [...atom.projects].sort(byName).map((project) => [project.name, project.usd]);
  const wanted = [
    ["-gone-dir", 16000 * USD_PER_OUTPUT_TOKEN],
    ["battle-game", 1000 * USD_PER_OUTPUT_TOKEN],
    ["demo-app", 6000 * USD_PER_OUTPUT_TOKEN],
    ["dev", 8000 * USD_PER_OUTPUT_TOKEN],
  ];
  return {
    isOk: sameRows(shown, wanted),
    detail: `got ${JSON.stringify(shown)}, wanted ${JSON.stringify(wanted)}`,
  };
}

async function daySumsEqualHandSums(freshDb) {
  const dayAt = (daysAgo) => new Date(2026, 9, 29 - daysAgo, 12).getTime();
  const plan = [
    [
      "-d1",
      "/home/dev/alpha",
      "sa",
      [
        [1, 100_000],
        [2, 50_000],
        [4, 25_000],
      ],
    ],
    [
      "-d2",
      "/home/dev/beta",
      "sb",
      [
        [1, 10_000],
        [2, 20_000],
        [4, 40_000],
      ],
    ],
  ];
  const files = plan.map(([dir, cwd, session, calls], index) =>
    projectFile(
      dir,
      cwd,
      session,
      index + 1,
      calls.map(([daysAgo, output], call) => [`${session}${call}`, dayAt(daysAgo), output]),
    ),
  );
  const wanted = new Map();
  for (const [, , , calls] of plan)
    for (const [daysAgo, output] of calls) {
      const day = localDay(dayAt(daysAgo));
      wanted.set(day, (wanted.get(day) ?? 0) + output * USD_PER_OUTPUT_TOKEN);
    }
  const atom = await slicedAtom(await freshDb(), files);
  const shown = dayTotalsOf(atom);
  const total = (atom.slices ?? []).reduce((sum, slice) => sum + slice.usd, 0);
  return {
    isOk: sameRows(shown, [...wanted].sort()) && sameRows([total], [atom.month]),
    detail: `got ${JSON.stringify(shown)} summing ${total}, wanted ${JSON.stringify([...wanted].sort())} summing ${atom.month}`,
  };
}

async function midnightSplitsDays(freshDb) {
  const lateYesterday = new Date(2026, 9, 28, 23, 59).getTime();
  const earlyToday = new Date(2026, 9, 29, 0, 1).getTime();
  const file = projectFile("-d1", "/home/dev/alpha", "sa", 1, [
    ["late", lateYesterday, 100_000],
    ["early", earlyToday, 50_000],
  ]);
  const atom = await slicedAtom(await freshDb(), [file]);
  const shown = dayTotalsOf(atom);
  const wanted = [
    [localDay(lateYesterday), 100_000 * USD_PER_OUTPUT_TOKEN],
    [localDay(earlyToday), 50_000 * USD_PER_OUTPUT_TOKEN],
  ];
  return {
    isOk: sameRows(shown, wanted) && sameRows([shown.at(-1)?.[1]], [atom.today]),
    detail: `got ${JSON.stringify(shown)} with today ${atom.today}, wanted ${JSON.stringify(wanted)}`,
  };
}

async function activeHoursCountDistinctHours(freshDb) {
  const file = projectFile("-d1", "/home/dev/alpha", "sa", 1, [
    ["h1", Date.UTC(2026, 9, 28, 9, 10), 1000],
    ["h2", Date.UTC(2026, 9, 28, 9, 50), 1000],
    ["h3", Date.UTC(2026, 9, 28, 14, 0), 1000],
    ["old", TX_NOW - 8 * MS_PER_DAY, 1000],
  ]);
  const atom = await slicedAtom(await freshDb(), [file]);
  return {
    isOk: atom.activeHours === 2,
    detail: `got ${JSON.stringify(atom.activeHours)}, wanted 2`,
  };
}

async function onlyIndexingSessionSlicesAreOwn(freshDb) {
  const at = Date.UTC(2026, 9, 28, 9, 10);
  const files = [
    projectFile("-d1", "/home/dev/alpha", "sa", 1, [["a1", at, 1000]]),
    projectFile("-d2", "/home/dev/beta", "sb", 2, [["b1", at, 2000]]),
  ];
  const db = await freshDb();
  await claim(db, "sess-a", TX_NOW);
  for (const file of files) await saveFile(db, "sess-a", TX_NOW, file);
  const atom = await atomOf(db, "sa", TX_NOW);
  const shown = atom.slices.map((slice) => [slice.session, slice.isOwn]).sort();
  return {
    isOk: sameRows(shown, [
      ["sa", true],
      ["sb", false],
    ]),
    detail: `got ${JSON.stringify(shown)}`,
  };
}

function projectFile(dir, cwd, session, start, calls) {
  const lines = calls.map(([id, at, output]) =>
    fixture.assistantLine({ id, sessionId: session, at, output }),
  );
  return { ...lineFile(`${dir}/${session}.jsonl`, start, lines), cwd };
}

async function slicedAtom(db, files) {
  await claim(db, "sess-a", TX_NOW);
  for (const file of files) await saveFile(db, "sess-a", TX_NOW, file);
  return atomOf(db, "s", TX_NOW);
}

function dayTotalsOf(atom) {
  const days = new Map();
  for (const slice of atom.slices ?? [])
    days.set(slice.day, (days.get(slice.day) ?? 0) + slice.usd);
  return [...days].sort();
}

function localDay(at) {
  return new Date(at).toLocaleDateString("sv-SE");
}

function lineFile(rel, start, lines) {
  return {
    rel,
    path: `${world.ROOT}/${rel}`,
    cwd: "/home/dev/project",
    lines,
    start,
    size: lines.join("\n").length,
  };
}

function oneCall(id) {
  return fixture.assistantLine({ id, sessionId: "s", at: TX_NOW - MS_PER_HOUR, output: 1000 });
}

function rowsOfFile(file) {
  return cost.callRowsOf(file.lines, { path: file.path, start: file.start });
}

async function claim(db, session, now, pricing = PRICES_V1) {
  const script = sql.batchScript(sql.transcriptClaimStatements(session, now, pricing), [
    sql.transcriptOwnerQuery(session),
  ]);
  const result = await mustRun(db, script);
  return lastLines(result.stdout, 1)[0] === "1";
}

async function saveFile(db, session, now, file, mtimeMs = TX_NOW) {
  const state = {
    path: file.path,
    size: file.size,
    mtimeMs,
    offset: file.size,
    start: file.start,
    cwd: file.cwd,
  };
  await runInTransaction(db, sql.transcriptFileStatements(session, now, state, rowsOfFile(file)));
}

async function callsAfterSaving(db, files, column) {
  await claim(db, "sess-a", TX_NOW);
  for (const file of files) await saveFile(db, "sess-a", TX_NOW, file);
  return queryJson(
    db,
    `SELECT json_group_array(${column}) FROM (SELECT * FROM calls ORDER BY id);`,
  );
}

async function storedCounts(db) {
  const [counts] = await queryJson(
    db,
    "SELECT json_group_array(json_array((SELECT count(*) FROM calls),(SELECT count(*) FROM files)));",
  );
  const prices = await queryJson(
    db,
    "SELECT json_group_array(value) FROM kv WHERE key='transcriptPrices';",
  );
  return { calls: counts[0], files: counts[1], prices };
}

async function storedRows(db) {
  return {
    calls: await queryJson(
      db,
      "SELECT json_group_array(json_array(id,at,usd,dir,session,is_own,start,path)) FROM (SELECT * FROM calls ORDER BY id);",
    ),
    files: await queryJson(
      db,
      "SELECT json_group_array(json_array(path,size,mtime,offset,start,cwd)) FROM (SELECT * FROM files ORDER BY path);",
    ),
  };
}

async function atomOf(db, session, now, containers = ["-home-dev"]) {
  const windows = {
    now,
    day: new Date(now).setHours(0, 0, 0, 0),
    week: now - 7 * MS_PER_DAY,
    month: now - 30 * MS_PER_DAY,
    hour: now - MS_PER_HOUR,
  };
  const result = await mustRun(
    db,
    sql.batchScript([], [sql.transcriptTotalsQuery(windows, session)]),
  );
  return sql.spendTotalsOf(JSON.parse(lastLines(result.stdout, 1)[0]), containers, now);
}

function figuresOfAtom(atom) {
  return {
    today: atom.today,
    week: atom.week,
    month: atom.month,
    projects: [...atom.projects].sort(byName).map((project) => [project.name, project.usd]),
    session: atom.session,
  };
}

function oracleFigures(files) {
  const sources = files.map((file) => ({ path: file.rel, ...oracle.transcriptOf(file.lines) }));
  const wanted = summary.summaryOfOracle(
    oracle.oracleOf(sources, { now: TX_NOW, containers: world.CONTAINERS }),
  );
  const usd = (figures) => figures.usd / MICROS_PER_USD;
  const own = wanted.sessions.find((row) => row.key === `-home-dev-alpha/${world.OWN_SESSION}`);
  return {
    today: usd(wanted.today),
    week: usd(wanted.week),
    month: usd(wanted.month),
    projects: wanted.projects
      .map((project) => [folderOfDir(files, project.name), usd(project)])
      .sort((a, b) => a[0].localeCompare(b[0])),
    session: usd(own.main) + usd(own.subagents),
  };
}

function folderOfDir(files, dir) {
  const file = files.find((candidate) => candidate.rel.startsWith(`${dir}/`));
  return file === undefined ? dir : file.cwd.slice(file.cwd.lastIndexOf("/") + 1);
}

function byName(a, b) {
  return a.name.localeCompare(b.name);
}

function sameRows(left, right) {
  return sameDeep(left, right);
}

function sameDeep(left, right) {
  if (typeof left === "number" && typeof right === "number")
    return Math.abs(left - right) < USD_TOLERANCE;
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length && left.every((item, index) => sameDeep(item, right[index]))
    );
  if (left !== null && right !== null && typeof left === "object" && typeof right === "object") {
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => sameDeep(left[key], right[key]))
    );
  }
  return left === right;
}

async function runInTransaction(db, statements) {
  const body = [].concat(statements).join("\n");
  return mustRun(db, `.timeout 5000\nBEGIN IMMEDIATE;\n${body}\nCOMMIT;\n`);
}

function oldStore() {
  const states = {};
  for (let index = 1; index <= 8; index++) states[`sess-state-${index}`] = stateOf(index);
  return {
    toolUses: {
      [ALPHA]: { mcp__docs__search: 12, mcp__docs__fetch: 5 },
      [BETA]: { mcp__chat__send: 7 },
      [GAMMA]: { mcp__docs__search: 1 },
    },
    toolFailures: { [ALPHA]: { mcp__docs__search: 2 }, [GAMMA]: { mcp__chat__send: 1 } },
    skillUses: {
      commit: 4,
      review: 2,
      [ALPHA]: { commit: 9, deploy: 3 },
      [BETA]: { review: 6 },
    },
    usageLimits: [
      { label: "5h", percent: 40, resetsAt: "2026-10-29T16:00:00.000Z" },
      { label: "7d", percent: 55, resetsAt: "2026-11-02T09:00:00.000Z" },
    ],
    spendSessions: states,
  };
}

function stateOf(index) {
  const memory = {
    model: "claude-opus-5-5",
    endedAt: NOW - index * 1000,
    size: 1000 * index,
    ttl: "5m",
  };
  return {
    owners: {
      main: { weight: 10 * index, pricedTokens: 100 * index, unpricedTokens: 0 },
      "general-purpose": { weight: 5, pricedTokens: 50, unpricedTokens: 0 },
    },
    mainModel: "claude-opus-5-5",
    cacheReadTokens: 1000 * index,
    promptTokens: 2000 * index,
    missCount: index,
    lostUsd: 0.5 * index,
    misses: [{ at: NOW - index * 60_000, cause: "after 5m idle", rebuilt: 10_000, usd: 0.25 }],
    rentTokens: 3000,
    rent: [{ tool: "Read", target: "docs/readme.md", tokens: 1500 }],
    isCompacted: index % 2 === 0,
    growthSum: 100 * index,
    growthCount: index,
    mainCacheTtl: "5m",
    baselineUsd: index,
    mainMemory: memory,
    agentMemories: { "agent-1": memory },
    lastTurn: { durationMs: 5000, usd: 0.5, tokens: 4000, agents: 1, contextTokens: 50_000 },
  };
}

function expectedUses() {
  const rows = [];
  for (const [folder, names] of Object.entries(OLD_STORE.toolUses))
    for (const [name, count] of Object.entries(names)) rows.push(["tool", folder, name, count]);
  for (const [folder, names] of Object.entries(OLD_STORE.toolFailures))
    for (const [name, count] of Object.entries(names))
      rows.push(["toolFailure", folder, name, count]);
  for (const [folder, names] of Object.entries(OLD_STORE.skillUses)) {
    if (typeof names !== "object") continue;
    for (const [name, count] of Object.entries(names)) rows.push(["skill", folder, name, count]);
  }
  return rows;
}

function runSqlite(db, script) {
  return new Promise((resolve) => {
    const child = spawn("sqlite3", [...SQLITE_ARGS, db]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(script);
  });
}

async function mustRun(db, script) {
  const result = await runSqlite(db, script);
  if (result.code !== 0) throw new Error(`sqlite3 exited ${result.code}: ${result.stderr}`);
  return result;
}

async function queryJson(db, statement) {
  const result = await mustRun(db, `${statement}\n`);
  return JSON.parse(lastLines(result.stdout, 1)[0]);
}

async function snapshotOf(db) {
  const result = await mustRun(db, initScript(OWN_SESSION));
  return JSON.parse(lastLines(result.stdout, 1)[0]);
}

function dumpOf(db) {
  return spawnSync("sqlite3", [db, ".dump"], { encoding: "utf8" }).stdout;
}

function sorted(rows) {
  return [...rows]
    .map((row) => JSON.stringify(row))
    .sort()
    .map((text) => JSON.parse(text));
}

function same(left, right) {
  return canonical(left) === canonical(right);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function check(id, name, isOk, detail) {
  lines.push(`${isOk ? "ok  " : "FAIL"} ${id} ${name}: ${detail}`);
  if (!isOk) failures.push(`${id} ${name}`);
}

function finish() {
  for (const line of lines) console.log(line);
  if (failures.length > 0) {
    console.error(`store-real: ${failures.length} failed: ${failures.join("; ")}`);
    process.exit(1);
  }
  console.log(`store-real: ${lines.length} checks passed`);
}
