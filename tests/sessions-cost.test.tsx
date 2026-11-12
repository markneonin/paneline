import { describe, expect, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

import * as storeSql from "../hooks/store-sql";
import type { SessionRow } from "../types";
import { screenRows } from "./band-screen";
import { diskOf } from "./fixtures/transcript-disk";
import type { Disk } from "./fixtures/transcript-disk";
import { assistantLine } from "./fixtures/transcript-oracle";
import { transcriptSqlite } from "./fixtures/transcript-sqlite";
import type { TranscriptSqlite } from "./fixtures/transcript-sqlite";
import {
  CLOCK_START,
  HOME,
  OWN_PID,
  OWN_SESSION,
  begin,
  putRegistry,
  rowTexts,
  sessionRows,
  sessionsPane,
} from "./sessions-world";
import type { Pane, World } from "./sessions-world";
import { hasNoSpendNote, lines, totalsOf } from "./spend-world";

type CostWorld = {
  settle: () => Promise<void>;
  disk: Disk;
  db: TranscriptSqlite;
  spawns: string[][];
  stdins: string[];
  logs: { to: string | undefined; text: string }[];
  pendingReads: (() => void)[];
  isHoldingReads: boolean;
  isHoldingCostReads: boolean;
  heldCostReads: (() => void)[];
  isFailingCostReads: boolean;
};
type Folder = "alpha" | "beta" | "gamma";

const OUTPUT_FOR_12_34_USD = 617_000;
const OUTPUT_FOR_5_USD = 250_000;
const OUTPUT_FOR_7_USD = 350_000;
const STORED_PART_USD = 3.25;
const STORED_OTHER_PART_USD = 1.5;
const AGE_MS = 60_000;
const COLUMNS = 100;
const MS_PER_DAY = 86_400_000;
const QUIET_TICKS = 300;
const SETTLE_ROUNDS = 5;
const COST_CELL = /\$\d+\.\d{2}|<\$0\.01/u;
const COST_READ = "session IN (";
const QUOTED_ID_LIST = "session IN ('";
const COST_READ_FAILURE = "disk I/O error in the cost read";
const POLL_GAP_MS = 2000;
const SYNC_GAP_MS = 1000;
const NEW_CALL_USD = 1.5;
const ENGINE_USD = 10;
const LIST_HEADER_END = /ctx {4}30d$/u;
const LABEL_LINE = /(^|\n)30d cost /u;
const BARE_COST_LABEL = /(^|\n)cost /u;
const QUERY_NOW = Date.UTC(2026, 10, 4);
const SPEND_TAB = "Spend";
const PREVIOUS_TAB = "‹";
const TAB_PRESSES_LIMIT = 12;
const FOREIGN_SESSION = "session-beta";
const BARE_SESSION = "session-gamma";
const QUOTED_SESSION = "it's-quoted";
const OUTSIDE_USD = 9;

const own: SessionRow = {
  pid: OWN_PID,
  sessionId: OWN_SESSION,
  state: "idle",
  cwd: `${HOME}/code/alpha`,
  branch: "main",
  ctx: 10,
  usd: 10,
};
const beta: SessionRow = {
  pid: 200,
  sessionId: FOREIGN_SESSION,
  state: "idle",
  cwd: `${HOME}/code/beta`,
  branch: "main",
  ctx: 20,
  usd: 3,
};
const gamma: SessionRow = {
  pid: 300,
  sessionId: BARE_SESSION,
  state: "idle",
  cwd: `${HOME}/code/gamma`,
  branch: "main",
  ctx: 30,
  usd: 2,
};

describe("sessions cost", () => {
  test("C1 the own row and the Spend tab both show $12.34 when the transcript sum is 12.34 and the engine measured 10.00", async ($, on) => {
    const cost = costWorldOf(on);
    cost.disk.writeLines(
      "-work/session-one.jsonl",
      [callOf(OWN_SESSION, "own-1", OUTPUT_FOR_12_34_USD, "/work")],
      CLOCK_START - AGE_MS,
    );
    await begin2($, on, cost, [own]);

    const pane = await enterSessions($, cost);
    const inSessions = await costOf(pane, "alpha");
    await showTab(pane, cost, SPEND_TAB);
    await quiet(cost);
    await pane.redraw();

    expect({ inSessions, inSpend: totalsOf(await lines(pane))?.usd }).toEqual({
      inSessions: "$12.34",
      inSpend: "$12.34",
    });
  });

  test("C2 before the own transcript is indexed the own row shows the engine cost while a row with stored calls shows its sum", async ($, on) => {
    const cost = costWorldOf(on);
    storeCalls(cost, FOREIGN_SESSION, [STORED_PART_USD, STORED_OTHER_PART_USD]);
    await begin2($, on, cost, [own, beta]);
    await measuredCost($, cost, ENGINE_USD);

    const pane = await enterSessions($, cost);

    expect(await costsOf(pane, ["alpha", "beta"])).toEqual(["$10.00", "$4.75"]);
  });

  test("C3 entering Sessions counts the new calls once and then shows the cost that includes them", async ($, on) => {
    const cost = costWorldOf(on);
    const first = callOf(FOREIGN_SESSION, "beta-1", OUTPUT_FOR_5_USD, beta.cwd);
    cost.disk.writeLines("-h-u-code-beta/session-beta.jsonl", [first], CLOCK_START - AGE_MS);
    const world = await begin2($, on, cost, [own, beta]);
    cost.disk.writeLines(
      "-h-u-code-beta/session-beta.jsonl",
      [first, callOf(FOREIGN_SESSION, "beta-2", OUTPUT_FOR_7_USD, beta.cwd)],
      CLOCK_START,
    );
    const listingsBefore = listingsOf(cost);

    const pane = await enterSessions($, cost);
    await laterPoll(world, cost, pane);

    expect({
      listingsOnEntry: listingsOf(cost) - listingsBefore,
      betaCost: await costOf(pane, "beta"),
    }).toEqual({ listingsOnEntry: 1, betaCost: "$12.00" });
  });

  test("C4 a row of another session shows the sum of its stored calls, not the usd in its file", async ($, on) => {
    const cost = costWorldOf(on);
    storeCalls(cost, FOREIGN_SESSION, [STORED_PART_USD, STORED_OTHER_PART_USD]);
    await begin2($, on, cost, [own, beta]);

    const pane = await enterSessions($, cost);

    expect(await costOf(pane, "beta")).toBe("$4.75");
  });

  test("C5 a row of another session with no stored calls draws no figure, never the usd from its file", async ($, on) => {
    const cost = costWorldOf(on);
    storeCalls(cost, FOREIGN_SESSION, [STORED_PART_USD, STORED_OTHER_PART_USD]);
    await begin2($, on, cost, [own, beta, gamma]);

    const pane = await enterSessions($, cost);

    expect(await costsOf(pane, ["beta", "gamma"])).toEqual(["$4.75", undefined]);
  });

  test("C6 every cost read is one query that asks for all shown rows", async ($, on) => {
    const cost = costWorldOf(on);
    storeCalls(cost, FOREIGN_SESSION, [STORED_PART_USD]);
    await begin2($, on, cost, [own, beta, gamma]);
    const readsBefore = costReadsOf(cost).length;

    await enterSessions($, cost);

    const reads = costReadsOf(cost).slice(readsBefore);
    expect({
      hasRead: reads.length > 0,
      everyReadAsksForEveryRow: reads.every((read) =>
        [OWN_SESSION, FOREIGN_SESSION, BARE_SESSION].every((id) => read.includes(`'${id}'`)),
      ),
    }).toEqual({ hasRead: true, everyReadAsksForEveryRow: true });
  });

  test("C7 the list header reads 30d and the detail label reads 30d cost", async ($, on) => {
    const cost = costWorldOf(on);
    storeCalls(cost, FOREIGN_SESSION, [STORED_PART_USD]);
    await begin2($, on, cost, [{ ...own, usd: null }, beta]);
    const pane = await enterSessions($, cost);
    const header = (await rawRows(pane)).find((line) => line.includes("ctx")) ?? "";

    await openRow(pane, cost, "beta");

    const detailText = (await rowTexts(pane)).join("\n").replace(/[ \t]+/gu, " ");
    expect({
      listHeaderEnds: LIST_HEADER_END.test(header),
      detailHasLabel: LABEL_LINE.test(detailText),
      detailKeepsBareLabel: BARE_COST_LABEL.test(detailText),
    }).toEqual({ listHeaderEnds: true, detailHasLabel: true, detailKeepsBareLabel: false });
  });

  test("C8 a tab entered before any row exists shows stored sums once the sync has filled the rows, and asks for no empty list", async ($, on) => {
    const cost = costWorldOf(on);
    storeCalls(cost, FOREIGN_SESSION, [STORED_PART_USD, STORED_OTHER_PART_USD]);
    const world = await begin2($, on, cost, []);
    putRegistry(world, beta.pid, { sessionId: FOREIGN_SESSION, cwd: beta.cwd });

    const pane = await enterSessions($, cost);

    expect({
      betaCost: await costOf(pane, "beta"),
      everyReadNamesIds: costReadsOf(cost).every((read) => read.includes(QUOTED_ID_LIST)),
    }).toEqual({ betaCost: "$4.75", everyReadNamesIds: true });
  });

  test("C9 a session that gets new calls while the tab stays open shows the new sum after the next poll", async ($, on) => {
    const cost = costWorldOf(on);
    storeCalls(cost, FOREIGN_SESSION, [STORED_PART_USD]);
    const world = await begin2($, on, cost, [own, beta]);
    const pane = await enterSessions($, cost);
    const before = await costOf(pane, "beta");

    addCall(cost.db, "late-call", FOREIGN_SESSION, NEW_CALL_USD, CLOCK_START - AGE_MS);
    await laterPoll(world, cost, pane);

    expect({ before, after: await costOf(pane, "beta") }).toEqual({
      before: "$3.25",
      after: "$4.75",
    });
  });

  test("C10 a row that appears after the tab was entered shows its stored sum after the next poll", async ($, on) => {
    const cost = costWorldOf(on);
    storeCalls(cost, FOREIGN_SESSION, [STORED_PART_USD]);
    storeCalls(cost, BARE_SESSION, [NEW_CALL_USD]);
    const world = await begin2($, on, cost, [own, beta]);
    const pane = await enterSessions($, cost);

    putRegistry(world, gamma.pid, { sessionId: BARE_SESSION, cwd: gamma.cwd });
    await laterPoll(world, cost, pane);

    expect(await costsOf(pane, ["beta", "gamma"])).toEqual(["$3.25", "$1.50"]);
  });

  test("C11 while the indexing pass is still reading, other rows already show their stored sums", async ($, on) => {
    const cost = costWorldOf(on);
    storeCalls(cost, FOREIGN_SESSION, [STORED_PART_USD, STORED_OTHER_PART_USD]);
    await begin2($, on, cost, [own, beta]);
    cost.disk.writeLines(
      "-h-u-code-gamma/session-gamma.jsonl",
      [callOf(BARE_SESSION, "gamma-1", OUTPUT_FOR_5_USD, gamma.cwd)],
      CLOCK_START - AGE_MS,
    );
    cost.isHoldingReads = true;

    const pane = await enterSessions($, cost);
    const betaCost = await costOf(pane, "beta");
    releaseReads(cost);
    await quiet(cost);

    expect(betaCost).toBe("$4.75");
  });

  test("C15 while the cost read is still pending, a sync that changed a session's state asks the pane to redraw", async ($, on) => {
    const redraws = { count: 0 };
    on("ui.invalidate", () => {
      redraws.count += 1;
      return { value: undefined };
    });
    const cost = costWorldOf(on);
    const world = await begin2($, on, cost, [own, beta]);
    await enterSessions($, cost);
    cost.isHoldingCostReads = true;
    const before = redraws.count;
    putRegistry(world, beta.pid, { status: "busy" });

    await world.advance(POLL_GAP_MS + SYNC_GAP_MS);
    await quiet(cost);
    const redrawsWhileHeld = redraws.count - before;
    cost.isHoldingCostReads = false;
    cost.heldCostReads.splice(0).forEach((resume) => resume());
    await quiet(cost);

    expect(redrawsWhileHeld).toBeGreaterThan(0);
  });

  test("C12 with own calls stored but the main transcript not indexed, the own row shows the engine cost like Spend", async ($, on) => {
    const cost = costWorldOf(on);
    storeCalls(cost, OWN_SESSION, [STORED_PART_USD]);
    await begin2($, on, cost, [own]);
    await measuredCost($, cost, ENGINE_USD);

    const pane = await enterSessions($, cost);
    const inSessions = await costOf(pane, "alpha");
    await showTab(pane, cost, SPEND_TAB);
    await quiet(cost);
    await pane.redraw();

    expect({ inSessions, inSpend: totalsOf(await lines(pane))?.usd }).toEqual({
      inSessions: "$10.00",
      inSpend: "$10.00",
    });
  });

  test("C13 with an own cost of zero and no engine cost, the own row draws no figure and Spend says no spend", async ($, on) => {
    const cost = costWorldOf(on);
    cost.disk.writeLines(
      "-work/session-one.jsonl",
      [callOf(OWN_SESSION, "own-1", 0, "/work")],
      CLOCK_START - AGE_MS,
    );
    await begin2($, on, cost, [{ ...own, usd: null }]);

    const pane = await enterSessions($, cost);
    const inSessions = await costOf(pane, "alpha");
    await showTab(pane, cost, SPEND_TAB);
    await quiet(cost);
    await pane.redraw();

    expect({ inSessions, spendSaysNoSpend: hasNoSpendNote(await lines(pane)) }).toEqual({
      inSessions: undefined,
      spendSaysNoSpend: true,
    });
  });

  test("C14 a cost read that fails is logged to debug and the rows are still drawn", async ($, on) => {
    const cost = costWorldOf(on);
    storeCalls(cost, FOREIGN_SESSION, [STORED_PART_USD]);
    cost.isFailingCostReads = true;
    await begin2($, on, cost, [own, beta]);

    const pane = await enterSessions($, cost);

    expect({
      loggedToDebug: cost.logs.some(
        (line) => line.to === "debug" && line.text.includes(COST_READ_FAILURE),
      ),
      rows: (await sessionRows(pane)).length,
    }).toEqual({ loggedToDebug: true, rows: 2 });
  });

  test("C14b after a cost read that fails, the cells keep their last figures", async ($, on) => {
    const cost = costWorldOf(on);
    storeCalls(cost, FOREIGN_SESSION, [STORED_PART_USD]);
    const world = await begin2($, on, cost, [own, beta]);
    const pane = await enterSessions($, cost);
    const before = await costOf(pane, "beta");

    cost.isFailingCostReads = true;
    addCall(cost.db, "late-call", FOREIGN_SESSION, NEW_CALL_USD, CLOCK_START - AGE_MS);
    await laterPoll(world, cost, pane);

    expect({ before, after: await costOf(pane, "beta") }).toEqual({
      before: "$3.25",
      after: "$3.25",
    });
  });
});

describe("session costs query", () => {
  test("Q1 the query returns the sum per session inside the window and leaves out calls outside it", async () => {
    const { db, answer } = transcriptSqlite();
    const inside = QUERY_NOW - MS_PER_DAY;
    const outside = QUERY_NOW - 40 * MS_PER_DAY;
    addCall(db, "a-1", FOREIGN_SESSION, STORED_PART_USD, inside);
    addCall(db, "a-2", FOREIGN_SESSION, STORED_OTHER_PART_USD, inside - MS_PER_DAY);
    addCall(db, "a-3", FOREIGN_SESSION, OUTSIDE_USD, outside);
    addCall(db, "b-1", BARE_SESSION, OUTSIDE_USD, outside);
    addCall(db, "c-1", "unasked-session", OUTSIDE_USD, inside);
    addCall(db, "d-1", QUOTED_SESSION, STORED_OTHER_PART_USD, inside);
    const ids = [FOREIGN_SESSION, BARE_SESSION, QUOTED_SESSION, "no-calls-session"];

    const sql = storeSql.sessionCostsQuery(storeSql.transcriptWindowsOf(QUERY_NOW), ids);

    expect(JSON.parse(answer(`${sql}\n`))).toEqual({
      [FOREIGN_SESSION]: STORED_PART_USD + STORED_OTHER_PART_USD,
      [QUOTED_SESSION]: STORED_OTHER_PART_USD,
    });
  });
});

function costWorldOf(on: On): CostWorld {
  const disk = diskOf("/h/u/.claude");
  const { db, answer } = transcriptSqlite();
  const cost: CostWorld = {
    settle: async () => {},
    disk,
    db,
    spawns: [],
    stdins: [],
    logs: [],
    pendingReads: [],
    isHoldingReads: false,
    isHoldingCostReads: false,
    heldCostReads: [],
    isFailingCostReads: false,
  };
  on("process.run", { argv: /sqlite3/ }, async (_$, e) => {
    const stdin = e.init?.stdin ?? "";
    cost.stdins.push(stdin);
    if (cost.isHoldingCostReads && stdin.includes(COST_READ))
      await new Promise<void>((resume) => cost.heldCostReads.push(resume));
    if (cost.isFailingCostReads && stdin.includes(COST_READ))
      return {
        value: {
          exitCode: 1,
          stdout: "",
          isStdoutTruncated: false,
          isStderrTruncated: false,
          stderr: COST_READ_FAILURE,
        },
      };
    return {
      value: {
        exitCode: 0,
        stdout: answer(stdin),
        isStdoutTruncated: false,
        isStderrTruncated: false,
        stderr: "",
      },
    };
  });
  on("process.spawn", async function* (_$, e) {
    cost.spawns.push([...e.argv]);
    if (e.argv[0] === "sh" && cost.isHoldingReads)
      await new Promise<void>((resume) => cost.pendingReads.push(resume));
    return { value: yield* disk.run({ argv: e.argv }) };
  });
  on("ui.log", (_$, e) => {
    cost.logs.push({ to: e.to, text: e.text });
    return { value: undefined };
  });
  return cost;
}

async function begin2($: Engine, on: On, cost: CostWorld, rows: SessionRow[]): Promise<World> {
  const world = await begin($, on, rows, null, "dark", false);
  cost.settle = () => world.settle();
  await quiet(cost);
  return world;
}

async function laterPoll(world: World, cost: CostWorld, pane: Pane): Promise<void> {
  await world.advance(POLL_GAP_MS + SYNC_GAP_MS);
  await quiet(cost);
  await pane.redraw();
}

function releaseReads(cost: CostWorld): void {
  cost.isHoldingReads = false;
  cost.pendingReads.splice(0).forEach((resume) => resume());
}

async function measuredCost($: Engine, cost: CostWorld, usd: number): Promise<void> {
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [],
    cost: { usd },
    changed: ["cost"],
  } as never);
  await quiet(cost);
}

function addCall(db: TranscriptSqlite, id: string, session: string, usd: number, at: number): void {
  db.addCall(id, { at, usd, dir: "-h-u-code-beta", session, path: "-h-u-code-beta/x.jsonl" });
}

function storeCalls(cost: CostWorld, session: string, usds: number[]): void {
  usds.forEach((usd, at) =>
    addCall(cost.db, `stored-${session}-${at}`, session, usd, CLOCK_START - AGE_MS),
  );
}

function callOf(session: string, id: string, output: number, cwd: string): string {
  return assistantLine({ id, at: CLOCK_START - AGE_MS, output, cwd, sessionId: session });
}

function listingsOf(cost: CostWorld): number {
  return cost.spawns.filter((argv) => argv[0] === "find").length;
}

function costReadsOf(cost: CostWorld): string[] {
  return cost.stdins.filter((stdin) => stdin.includes(COST_READ));
}

async function enterSessions($: Engine, cost: CostWorld): Promise<Pane> {
  const pane = await sessionsPane($, COLUMNS);
  await quiet(cost);
  await pane.redraw();
  return pane;
}

async function quiet(cost: CostWorld): Promise<void> {
  for (let round = 0; round < SETTLE_ROUNDS; round++) {
    for (let at = 0; at < QUIET_TICKS; at++) await Promise.resolve();
    await cost.settle();
  }
}

async function costsOf(pane: Pane, folders: Folder[]): Promise<(string | undefined)[]> {
  return Promise.all(folders.map((folder) => costOf(pane, folder)));
}

async function costOf(pane: Pane, folder: Folder): Promise<string | undefined> {
  const row = (await sessionRows(pane)).find((text) => text.includes(folder));
  return COST_CELL.exec(row ?? "")?.[0];
}

async function openRow(pane: Pane, cost: CostWorld, folder: Folder): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const row = buttons.find((button) => button.text.includes(folder));
  expect(row, `a clickable row for ${folder}`).toBeDefined();
  await pane.press({ key: row?.key ?? "" });
  await quiet(cost);
  await pane.redraw();
}

async function showTab(pane: Pane, cost: CostWorld, label: string): Promise<void> {
  for (let press = 0; press < TAB_PRESSES_LIMIT; press += 1) {
    const buttons = await pane.findAll({ type: "Button" });
    const tab = buttons.find((button) => button.props.label === label);
    const target =
      tab ?? buttons.find((button) => String(button.props.label).startsWith(PREVIOUS_TAB));
    expect(target, `a ${label} tab button or the ${PREVIOUS_TAB} arrow`).toBeDefined();
    await pane.press({ key: target?.key ?? "" });
    await pane.redraw();
    if (tab !== undefined) return;
  }
  expect(false, `${label} reached through the tab bar`).toBe(true);
}

async function rawRows(pane: Pane): Promise<string[]> {
  return screenRows(await pane.drawn(), COLUMNS).map((line) => line.trimEnd());
}
