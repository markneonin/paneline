import { describe, expect, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

import type { SpendTotals } from "../types";
import { diskOf } from "./fixtures/transcript-disk";
import type { Disk } from "./fixtures/transcript-disk";
import { assistantLine } from "./fixtures/transcript-oracle";
import { transcriptSqlite } from "./fixtures/transcript-sqlite";
import type { TranscriptSqlite } from "./fixtures/transcript-sqlite";
import { summaryOfOracle } from "./fixtures/transcript-summary";
import {
  NO_HISTORY,
  PROJECTS_TITLE,
  SUBSCRIPTION,
  blocks,
  lines,
  ownersOf,
  spendPane,
  worldOf,
} from "./spend-world";
import type { World as SpendWorld } from "./spend-world";
import { oracleOf, transcriptOf } from "./transcript-oracle";

type World = SpendWorld & {
  disk: Disk;
  db: TranscriptSqlite;
  now: number;
  spawns: string[][];
  runs: string[][];
  totalsWritten: SpendTotals[];
  pendingReads: (() => void)[];
  isHoldingReads: boolean;
  isListingBroken: boolean;
  gitRepos: Set<string>;
};
type FileText = { rel: string; lines: string[]; mtime: number; cwd: string };

const HOME_DIR = "-h-u";
const WORK_CWD = "/h/u/alpha";
const OWN = "own-sess";
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const QUIET_TICKS = 300;
const MICRO = 1_000_000;
const READ_MS = 6_000;
const READING_PATIENCE = 200;
const SETTLE_ROUNDS = 5;
const SLOW_TEST_MS = 30_000;
const SUMMARY_UNITS_PER_MICRO = 100;
const FAR_FUTURE = 10 * MS_PER_DAY;
const OTHER_SESSION = "other-sess";
const SECOND_SESSION = "second-sess";
const STORED_ALPHA_USD = 3.25;
const STORED_BETA_USD = 1.5;
const STORED_USD = STORED_ALPHA_USD + STORED_BETA_USD;

describe("spend index", () => {
  test(
    "I1 the first index fills the totals in growing steps and the first step already holds this session",
    { timeoutMs: SLOW_TEST_MS },
    async ($, on) => {
      const world = worldOf2(on);
      const files = [
        fileOf(world, "-h-u-alpha/own-sess.jsonl", WORK_CWD, [150_000, 250_000], 2 * MS_PER_DAY),
        fileOf(world, "-h-u-beta/b1.jsonl", "/h/u/beta", [300_000], MS_PER_HOUR),
        fileOf(world, "-h-u-gamma/g1.jsonl", "/h/u/gamma", [400_000], 2 * MS_PER_HOUR),
        fileOf(world, "-h-u-delta/d1.jsonl", "/h/u/delta", [500_000], 3 * MS_PER_HOUR),
      ];
      put(world, files);
      holdReads(world);
      await startSessionHeld($);
      await untilReading(world, files.length);
      const pane = await spendPane($);
      await tick();
      const isCountingBeforeFirstRead = (await lines(pane)).some((line) =>
        line.text.includes("counting · 0%"),
      );

      await finishReadsOneByOne(world, files.length);
      await settle();

      const steps = monthSteps(world);
      expect({
        isCountingBeforeFirstRead,
        isGrowing: steps.length > 1 && steps.every((step, at) => at === 0 || step > steps[at - 1]!),
        firstStepHoldsOwnSession: firstSession(world),
        lastStep: steps.at(-1),
      }).toEqual({
        isGrowing: true,
        isCountingBeforeFirstRead: true,
        firstStepHoldsOwnSession: expectedMonth(world, [files[0]!]),
        lastStep: expectedMonth(world, files),
      });
    },
  );

  test("I2 the second run reads only the transcript that grew", async ($, on) => {
    const world = worldOf2(on);
    const own = fileOf(world, "-h-u-alpha/own-sess.jsonl", WORK_CWD, [150_000], 2 * MS_PER_DAY);
    const quiet = fileOf(world, "-h-u-beta/b1.jsonl", "/h/u/beta", [300_000], MS_PER_HOUR);
    put(world, [own, quiet]);
    await startSession($);
    const grown = {
      ...own,
      lines: [...own.lines, ...fileOf(world, own.rel, WORK_CWD, [90_000], MS_PER_HOUR, "g").lines],
      mtime: world.now,
    };
    put(world, [grown]);

    await startSession($);

    expect({
      growingFileReads: world.disk.readsOf(own.rel),
      quietFileReads: world.disk.readsOf(quiet.rel),
      month: lastMonth(world),
    }).toEqual({
      growingFileReads: 2,
      quietFileReads: 1,
      month: expectedMonth(world, [grown, quiet]),
    });
  });

  test("I3 a session that does not hold the index lease reads no transcript and shows the sums the other session stored", async ($, on) => {
    const world = worldOf2(on);
    storeOtherSessionsCalls(world);
    world.db.holdLease(OTHER_SESSION, world.now + FAR_FUTURE);
    put(world, [fileOf(world, "-h-u-alpha/new.jsonl", WORK_CWD, [150_000], MS_PER_HOUR)]);

    await startSession($);

    expect({
      processesReadingTranscripts: world.spawns.length,
      month: lastMonth(world),
      session: world.totalsWritten.at(-1)?.session,
    }).toEqual({ processesReadingTranscripts: 0, month: micro(STORED_USD), session: null });
  });

  test(
    "I4 a tab click and two cost changes during an index run join that run instead of starting more",
    { timeoutMs: SLOW_TEST_MS },
    async ($, on) => {
      const world = worldOf2(on);
      const files = [
        fileOf(world, "-h-u-alpha/own-sess.jsonl", WORK_CWD, [150_000], 2 * MS_PER_DAY),
        fileOf(world, "-h-u-beta/b1.jsonl", "/h/u/beta", [300_000], MS_PER_HOUR),
      ];
      put(world, files);
      holdReads(world);
      await startSessionHeld($);
      await untilReading(world, files.length);
      await spendPane($);
      await changeCost($, world, 1);
      await changeCost($, world, 2);

      releaseReads(world);
      await settle();

      expect({
        listings: spawnsOf(world, "find").length,
        reads: files.map((file) => world.disk.readsOf(file.rel)),
        month: lastMonth(world),
      }).toEqual({
        listings: 1,
        reads: [1, 1],
        month: expectedMonth(world, files),
      });
    },
  );

  test("I5 a folder that is no git repo splits its children into By project rows and one git process serves every run", async ($, on) => {
    const world = worldOf2(on);
    world.gitRepos.add("/h/u/app");
    const files = [
      fileOf(world, "-h-u-work/w0.jsonl", "/h/u/work", [100_000], MS_PER_HOUR),
      fileOf(world, "-h-u-work-api/w1.jsonl", "/h/u/work/api", [200_000], 2 * MS_PER_HOUR),
      fileOf(world, "-h-u-work-web/w2.jsonl", "/h/u/work/web", [300_000], 3 * MS_PER_HOUR),
      fileOf(world, "-h-u-app/a0.jsonl", "/h/u/app", [400_000], 4 * MS_PER_HOUR),
      fileOf(world, "-h-u-app-wt/a1.jsonl", "/h/u/app-wt", [500_000], 5 * MS_PER_HOUR),
    ];
    put(world, files);

    await startSession($);
    await startSession($);

    expect({
      projects: projectsOf(world.totalsWritten.at(-1)),
      gitProcesses: world.runs.filter((argv) => argv.some((part) => part.includes("rev-parse")))
        .length,
    }).toEqual({
      projects: expectedProjects(world, files, [HOME_DIR, "-h-u-work"]),
      gitProcesses: 1,
    });
  });

  test(
    "I6 clicking the Spend tab during an index run starts no process",
    { timeoutMs: SLOW_TEST_MS },
    async ($, on) => {
      const world = worldOf2(on);
      put(world, [
        fileOf(world, "-h-u-alpha/own-sess.jsonl", WORK_CWD, [150_000], 2 * MS_PER_DAY),
        fileOf(world, "-h-u-beta/b1.jsonl", "/h/u/beta", [300_000], MS_PER_HOUR),
      ]);
      holdReads(world);
      await startSessionHeld($);
      await untilReading(world, 2);
      const before = world.runs.length + world.spawns.length;

      await spendPane($);
      await tick();

      expect({
        isIndexing: world.pendingReads.length,
        newProcesses: world.runs.length + world.spawns.length - before,
      }).toEqual({ isIndexing: 2, newProcesses: 0 });
      releaseReads(world);
      await settle();
    },
  );

  test("I7 after a transcript listing that failed the totals still show the stored sums and the next session indexes", async ($, on) => {
    const world = worldOf2(on);
    storeOtherSessionsCalls(world);
    const fresh = fileOf(world, "-h-u-alpha/new.jsonl", WORK_CWD, [150_000], MS_PER_HOUR);
    put(world, [fresh]);
    world.isListingBroken = true;
    await startSession($);
    const afterFailure = lastMonth(world);
    world.isListingBroken = false;
    world.session = SECOND_SESSION;

    await startSession($);

    expect({
      afterFailure,
      afterRecovery: lastMonth(world),
    }).toEqual({
      afterFailure: micro(STORED_USD),
      afterRecovery: micro(STORED_USD) + expectedMonth(world, [fresh]),
    });
  });

  test("I8 the History tab shows the stored sums at once while the first transcript is still being read", async ($, on) => {
    const world = worldOf2(on);
    storeOtherSessionsCalls(world);
    put(world, [fileOf(world, "-h-u-alpha/own-sess.jsonl", WORK_CWD, [150_000], 2 * MS_PER_DAY)]);
    holdReads(world);
    await startSessionHeld($);
    await untilReading(world, 1);

    const pane = await spendPane($);
    await tick();

    expect({
      month: lastMonth(world),
      isNoHistoryShown: (await lines(pane)).some((line) => line.text.includes(NO_HISTORY)),
    }).toEqual({ month: micro(STORED_USD), isNoHistoryShown: false });
    releaseReads(world);
    await settle();
  });

  test("I10 while the first transcript is still being read the History heading says counting with the share done", async ($, on) => {
    const world = worldOf2(on);
    storeOtherSessionsCalls(world);
    put(world, [fileOf(world, "-h-u-alpha/own-sess.jsonl", WORK_CWD, [150_000], 2 * MS_PER_DAY)]);
    holdReads(world);
    await startSessionHeld($);
    await untilReading(world, 1);

    const pane = await spendPane($);
    await tick();

    expect((await lines(pane)).some((line) => line.text.includes("counting · 0%"))).toBe(true);
    releaseReads(world);
    await settle();
  });

  test("I9 By project names each project by its folder and rolls a worktree into its project", async ($, on) => {
    const world = worldOf2(on);
    world.gitRepos.add("/h/u/projects/IT/demo-app");
    world.gitRepos.add("/h/u/projects/IT/battle-game");
    put(world, [
      fileOf(
        world,
        "-h-u-projects-IT-battle-game/b.jsonl",
        "/h/u/projects/IT/battle-game",
        [100_000],
        MS_PER_HOUR,
      ),
      fileOf(
        world,
        "-h-u-projects-IT-demo-app/p.jsonl",
        "/h/u/projects/IT/demo-app",
        [200_000],
        2 * MS_PER_HOUR,
      ),
      fileOf(
        world,
        "-h-u-projects-IT-demo-app-spend-fix/w.jsonl",
        "/h/u/projects/IT/demo-app-spend-fix",
        [300_000],
        3 * MS_PER_HOUR,
      ),
    ]);
    await startSession($);

    const found = await blocks(await spendPane($));

    expect(ownersOf(found[PROJECTS_TITLE]).map((owner) => owner.name)).toEqual([
      "demo-app",
      "battle-game",
    ]);
  });
});

function worldOf2(on: On): World {
  const disk = diskOf("/h/u/.claude");
  const { db, answer } = transcriptSqlite();
  on("process.run", { argv: /sqlite3/ }, (_$, e) => {
    world.runs.push([...e.argv]);
    const stdout = answer(e.init?.stdin ?? "");
    return {
      value: {
        exitCode: 0,
        stdout,
        isStdoutTruncated: false,
        isStderrTruncated: false,
        stderr: "",
      },
    };
  });
  on("process.run", { argv: /rev-parse/ }, (_$, e) => {
    world.runs.push([...e.argv]);
    const outside = e.argv.slice(4).filter((cwd) => !world.gitRepos.has(cwd));
    return {
      value: {
        exitCode: 0,
        stdout: outside.join("\n"),
        isStdoutTruncated: false,
        isStderrTruncated: false,
        stderr: "",
      },
    };
  });
  on("process.spawn", async function* (_$, e) {
    world.spawns.push([...e.argv]);
    if (e.argv[0] === "find" && world.isListingBroken) return { value: { code: 1, signal: null } };
    if (e.argv[0] === "sh" && world.isHoldingReads) {
      await new Promise<void>((resume) => world.pendingReads.push(resume));
    }
    return { value: yield* disk.run({ argv: e.argv }) };
  });
  on("ui.log", () => ({ value: undefined }));
  on("state.set", { key: "spendTotals" }, (_$, e, next) => {
    world.totalsWritten.push(structuredClone(e.value as SpendTotals));
    return next(e);
  });
  const base = worldOf(on, SUBSCRIPTION);
  base.session = OWN;
  const world: World = Object.assign(base, {
    disk,
    db,
    now: base.clock.now(),
    spawns: [],
    runs: [],
    totalsWritten: [],
    pendingReads: [],
    isHoldingReads: false,
    isListingBroken: false,
    gitRepos: new Set<string>(),
  });
  return world;
}

function fileOf(
  world: World,
  rel: string,
  cwd: string,
  outputs: number[],
  age: number,
  idPrefix = "c",
): FileText {
  const lines = outputs.map((output, at) =>
    assistantLine({
      id: `${rel}-${idPrefix}${at}`,
      at: world.now - age,
      output,
      cwd,
      sessionId: rel.split("/").at(-1)?.replace(".jsonl", "") ?? "",
    }),
  );
  return { rel, lines, mtime: world.now - age, cwd };
}

function put(world: World, files: readonly FileText[]): void {
  for (const file of files) world.disk.writeLines(file.rel, file.lines, file.mtime);
}

function storeOtherSessionsCalls(world: World): void {
  const at = world.now - 2 * MS_PER_DAY;
  world.db.addCall("stored-1", {
    at,
    usd: STORED_ALPHA_USD,
    dir: "-h-u-alpha",
    session: OTHER_SESSION,
    path: "-h-u-alpha/other.jsonl",
  });
  world.db.addCall("stored-2", {
    at,
    usd: STORED_BETA_USD,
    dir: "-h-u-beta",
    session: OTHER_SESSION,
    path: "-h-u-beta/other.jsonl",
  });
}

function expectedMonth(world: World, files: readonly FileText[]): number {
  const summary = summaryOfOracle(
    oracleOf(sourcesOf(files), { now: world.now, containers: [HOME_DIR] }),
  );
  return fromSummary(summary.month.usd);
}

function fromSummary(summaryUsd: number): number {
  return Math.round(summaryUsd / SUMMARY_UNITS_PER_MICRO);
}

function expectedProjects(
  world: World,
  files: readonly FileText[],
  containers: readonly string[],
): { name: string; usd: number }[] {
  return summaryOfOracle(oracleOf(sourcesOf(files), { now: world.now, containers }))
    .projects.map(({ name, usd }) => ({ name: folderOfDir(files, name), usd: fromSummary(usd) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function folderOfDir(files: readonly FileText[], dir: string): string {
  const file = files.find((candidate) => candidate.rel.startsWith(`${dir}/`));
  return file === undefined ? dir : file.cwd.slice(file.cwd.lastIndexOf("/") + 1);
}

function sourcesOf(files: readonly FileText[]) {
  return files.map(({ rel, lines }) => ({ path: rel, ...transcriptOf(lines) }));
}

function projectsOf(totals: SpendTotals | undefined): { name: string; usd: number }[] {
  return [...(totals?.projects ?? [])]
    .map(({ name, usd }) => ({ name, usd: micro(usd) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function lastMonth(world: World): number | null {
  const month = world.totalsWritten.at(-1)?.month;
  return month === undefined ? null : micro(month);
}

function firstSession(world: World): number | null {
  const session = world.totalsWritten.find((totals) => (totals.month ?? 0) > 0)?.session;
  return typeof session === "number" ? micro(session) : null;
}

function monthSteps(world: World): number[] {
  const months = world.totalsWritten.flatMap((totals) =>
    typeof totals.month === "number" ? [micro(totals.month)] : [],
  );
  return months.filter((month, at) => at === 0 || month !== months[at - 1]);
}

function spawnsOf(world: World, program: string): string[][] {
  return world.spawns.filter((argv) => argv[0] === program);
}

function micro(usd: number): number {
  return Math.round(usd * MICRO);
}

async function startSession($: Engine): Promise<void> {
  await $.session.start({ cwd: WORK_CWD, surface: "terminal", isInteractive: true });
  await settle();
}

function holdReads(world: World): void {
  world.isHoldingReads = true;
}

function releaseReads(world: World): void {
  world.isHoldingReads = false;
  world.pendingReads.splice(0).forEach((resume) => resume());
}

async function untilReading(world: World, count: number): Promise<void> {
  for (let round = 0; round < READING_PATIENCE && world.pendingReads.length < count; round++) {
    await tick();
  }
}

async function finishReadsOneByOne(world: World, count: number): Promise<void> {
  for (let read = 0; read < count; read++) {
    await world.clock.set(world.clock.now() + READ_MS);
    world.pendingReads.shift()?.();
    await tick();
  }
}

async function startSessionHeld($: Engine): Promise<void> {
  await $.session.start({ cwd: WORK_CWD, surface: "terminal", isInteractive: true });
  await tick();
}

async function changeCost($: Engine, world: World, usd: number): Promise<void> {
  world.costUsd = usd;
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [],
    cost: { usd },
    changed: ["cost"],
  } as never);
  await tick();
}

async function settle(): Promise<void> {
  for (let round = 0; round < SETTLE_ROUNDS; round++) await tick();
}

async function tick(): Promise<void> {
  for (let at = 0; at < QUIET_TICKS; at++) await Promise.resolve();
}
