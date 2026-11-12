import { describe, expect, mock, test } from "claude-code/testing";
import type { On, SessionContextBreakdown } from "claude-code";
import type { Engine, MockClock, Mounted } from "claude-code/testing";

import { blocksOf, clearButtonOf, keyOf, linesOf } from "./skills-tree";
import type { Block } from "./skills-tree";
import { showTabThroughArrows } from "./spend-world";

type Pane = Mounted<"terminal", "Pane">;
type UseRow = [string, string, string, number];
type SavedLimit = { label: string; percent: number; resetsAt?: string };
type Snapshot = {
  imported: boolean;
  uses: UseRow[];
  limits: SavedLimit[] | null;
};
type Mode = "ok" | "reject" | "missing" | "silent" | "failed" | "otherVersion";
type RunKind = "open" | "import" | "write";
type Run = { kind: RunKind; stdin: string; exitCode: number | undefined };
type WorldOptions = {
  mode?: Mode;
  snapshot?: Partial<Snapshot>;
  oldStore?: Record<string, unknown>;
  importConflict?: Partial<Snapshot>;
};
type World = {
  clock: MockClock;
  runs: Run[];
  logs: string[];
  storeGets: string[];
  storeKeysCalls: () => number;
  stored: (key: string) => unknown;
  state: (key: string) => unknown;
  holdWrites: () => () => void;
  holdOpen: () => () => void;
  failNextWrite: () => void;
  storedKeys: () => string[];
};

const NOW = 1_800_000_000_000;
const FOLDER = "/work";
const OTHER_FOLDER = "/elsewhere";
const SKILL = "commit";
const MCP_TOOL = "mcp__docs__search";
const HOME = "/h/u";
const COLUMNS = 60;
const PANE_ROWS = 40;
const QUIET_TICKS = 300;
const RETRY_WAIT_MS = 10_000;
const BURST = 50;
const REDRAWS = 5;
const MOVED_KEYS = ["toolUses", "toolFailures", "skillUses", "usageLimits"];
const HEADINGS = ["Top used", "User", "Project", "Built-in", "Off"];
const STATE_PREFIX = "paneline";
const SAVED_LIMITS: SavedLimit[] = [
  { label: "5h", percent: 31, resetsAt: "2027-01-15T10:00:00.000Z" },
  { label: "7d", percent: 62, resetsAt: "2027-01-18T10:00:00.000Z" },
];
const OLD_STORE: Record<string, unknown> = {
  toolUses: { [FOLDER]: { [MCP_TOOL]: 2 } },
  toolFailures: { [FOLDER]: { mcp__docs__broken: 1 } },
  skillUses: { [FOLDER]: { [SKILL]: 3 } },
  usageLimits: [{ label: "5h", percent: 31 }],
  spendSessions: { "old-session": { mainModel: "claude-old-model", owners: {} } },
};
const OLD_STORE_TOKENS = [MCP_TOOL, "mcp__docs__broken", SKILL, "old-session", "claude-old-model"];
const WARM: Partial<Snapshot> = { imported: true };
const COST_USD = 4;
const OWN_SESSION = "session-1";
const PRUNE_WRITE = /DELETE\s+FROM\s+calls\b/u;
const FIRST_COST = 0.002;
const STATE_WRITE = /INSERT\s+INTO\s+spend_state\s+VALUES\('session-1'/u;
const FALLBACK_OUTCOME = {
  sqliteRuns: 1,
  skillUses: { [FOLDER]: { [SKILL]: 1 } },
  toolUses: { [FOLDER]: { [MCP_TOOL]: 2 } },
  toolFailures: { [FOLDER]: { [MCP_TOOL]: 1 } },
  usageLimits: [{ label: "5h", percent: 48 }],
};

describe("store with sqlite3 present", () => {
  test("A1 a new session shows the skill, MCP and failure counts the database holds for its folder only", async ($, on) => {
    const world = worldOf(on, {
      snapshot: {
        imported: true,
        uses: [
          ["skill", FOLDER, SKILL, 4],
          ["tool", FOLDER, MCP_TOOL, 3],
          ["toolFailure", FOLDER, MCP_TOOL, 1],
          ["skill", OTHER_FOLDER, "deploy", 9],
        ],
      },
    });

    await startIn($);
    await settle(world);

    expect([
      world.state("skillUses"),
      world.state("toolUses"),
      world.state("toolFailures"),
    ]).toEqual([{ [SKILL]: 4 }, { [MCP_TOOL]: 3 }, { [MCP_TOOL]: 1 }]);
  });

  test("A2 a new session shows the 5h and 7d meters the database holds", async ($, on) => {
    const world = worldOf(on, { snapshot: { imported: true, limits: SAVED_LIMITS } });

    await startIn($);
    await settle(world);

    expect((world.state("usage") as { limits: SavedLimit[] }).limits).toEqual(SAVED_LIMITS);
  });

  test("A3 a skill use costs one sqlite3 process and is saved in the database, not the old store", async ($, on) => {
    const world = worldOf(on, { snapshot: WARM });
    await startIn($);
    await settle(world);
    const before = writesOf(world).length;

    await usePrompt($);
    await settle(world);

    const writes = writesOf(world).slice(before);
    expect([writes.length, occurrences(writes, `'${SKILL}'`), world.stored("skillUses")]).toEqual([
      1,
      1,
      undefined,
    ]);
  });

  test("A4 an MCP call that works costs one sqlite3 process and is saved in the database, not the old store", async ($, on) => {
    const world = worldOf(on, { snapshot: WARM });
    await startIn($);
    await settle(world);
    const before = writesOf(world).length;

    await callTool($);
    await settle(world);

    const writes = writesOf(world).slice(before);
    expect([writes.length, occurrences(writes, `'${MCP_TOOL}'`), world.stored("toolUses")]).toEqual(
      [1, 1, undefined],
    );
  });

  test("A5 an MCP call that fails costs one sqlite3 process that saves the use and the failure", async ($, on) => {
    const world = worldOf(on, { snapshot: WARM });
    await startIn($);
    await settle(world);
    const before = writesOf(world).length;

    await callTool($, true);
    await settle(world);

    const writes = writesOf(world).slice(before);
    expect([
      writes.length,
      occurrences(writes, `'${MCP_TOOL}'`),
      occurrences(writes, "'toolFailure'"),
    ]).toEqual([1, 2, 1]);
  });

  test("A6 a changed usage meter costs one sqlite3 process and is saved in the database, not the old store", async ($, on) => {
    const world = worldOf(on, { snapshot: WARM });
    await startIn($);
    await settle(world);
    const before = writesOf(world).length;

    await measureFiveHour($, 48);
    await settle(world);

    const writes = writesOf(world).slice(before);
    expect([
      writes.length,
      occurrences(writes, "usageLimits"),
      world.stored("usageLimits"),
    ]).toEqual([1, 1, undefined]);
  });

  test("A7 clear on Top used empties it and costs one sqlite3 process that deletes the folder's counts", async ($, on) => {
    const world = worldOf(on, {
      snapshot: { imported: true, uses: [["skill", FOLDER, SKILL, 2]] },
      oldStore: { skillUses: { [FOLDER]: { [SKILL]: 2 } } },
    });
    await startIn($);
    await settle(world);
    const pane = await paneOnSkills($, world);
    const topBefore = (await blocksOn(pane))["Top used"];
    const before = writesOf(world).length;

    await pressNode(pane, world, clearButtonOf(topBefore));

    const writes = writesOf(world).slice(before);
    expect([
      topBefore === undefined,
      (await blocksOn(pane))["Top used"],
      writes.length,
      occurrences(writes, "DELETE FROM uses"),
    ]).toEqual([false, undefined, 1, 1]);
  });

  test("A8 a session start on an imported database costs two sqlite3 processes, the open and the transcript lease claim, and reads no old counters", async ($, on) => {
    const world = worldOf(on, { snapshot: WARM, oldStore: OLD_STORE });

    await startIn($);
    await settle(world);

    expect([
      world.runs.length,
      world.storeGets.filter((key) => MOVED_KEYS.includes(key)),
      world.storeKeysCalls(),
    ]).toEqual([2, [], 0]);
  });
});

describe("store first start and import", () => {
  test("A9 the first start with an old store runs three sqlite3 processes, open, import and the transcript lease claim, and the import holds every old key's value", async ($, on) => {
    const world = worldOf(on, { snapshot: { imported: false }, oldStore: OLD_STORE });

    await startIn($);
    await settle(world);

    const imports = world.runs.filter((run) => run.kind === "import");
    expect({
      runs: world.runs.length,
      imports: imports.length,
      missing: OLD_STORE_TOKENS.filter((token) => !(imports[0]?.stdin ?? "").includes(token)),
    }).toEqual({ runs: 3, imports: 1, missing: [] });
  });

  test("A10 an empty old store still imports once, and the next start imports nothing", async ($, on) => {
    const world = worldOf(on, { snapshot: { imported: false }, oldStore: {} });

    await startIn($);
    await settle(world);
    const first = world.runs.map((run) => run.kind);
    await startIn($);
    await settle(world);

    expect([first, world.runs.slice(first.length).map((run) => run.kind)]).toEqual([
      ["open", "import", "write"],
      ["open"],
    ]);
  });
});

describe("store write batching", () => {
  test("A11 fifty skill prompts while the first save runs return at once, use two sqlite3 processes and save all fifty uses", async ($, on) => {
    const world = worldOf(on, { snapshot: WARM });
    await startIn($);
    await settle(world);
    const before = writesOf(world).length;
    const release = world.holdWrites();

    for (let prompt = 0; prompt < BURST; prompt++) await usePrompt($);
    await settle(world);
    release();
    await settle(world);

    const writes = writesOf(world).slice(before);
    expect([writes.length, occurrences(writes, `'${SKILL}'`), world.state("skillUses")]).toEqual([
      2,
      BURST,
      { [SKILL]: BURST },
    ]);
  });
});

describe("store falls back to the old store", () => {
  test("A12 when the sqlite3 run rejects, uses and meters land in the old store and no sqlite3 process runs after the first", async ($, on) => {
    const world = worldOf(on, { mode: "reject" });

    await useEverything($, world);

    expect(fallbackOutcome(world)).toEqual(FALLBACK_OUTCOME);
  });

  test("A13 when sqlite3 is not installed (exit 127), uses and meters land in the old store and no sqlite3 process runs after the first", async ($, on) => {
    const world = worldOf(on, { mode: "missing" });

    await useEverything($, world);

    expect(fallbackOutcome(world)).toEqual(FALLBACK_OUTCOME);
  });

  test("A14 when the first sqlite3 run exits 0 and prints nothing, uses and meters land in the old store and no sqlite3 process runs after the first", async ($, on) => {
    const world = worldOf(on, { mode: "silent" });

    await useEverything($, world);

    expect(fallbackOutcome(world)).toEqual(FALLBACK_OUTCOME);
  });

  test("A15 when the first sqlite3 run prints a snapshot but exits 1, uses and meters land in the old store and no sqlite3 process runs after the first", async ($, on) => {
    const world = worldOf(on, { mode: "failed" });

    await useEverything($, world);

    expect(fallbackOutcome(world)).toEqual(FALLBACK_OUTCOME);
  });

  test("A16 when the first sqlite3 run prints a snapshot of another version, uses and meters land in the old store and no sqlite3 process runs after the first", async ($, on) => {
    const world = worldOf(on, { mode: "otherVersion" });

    await useEverything($, world);

    expect(fallbackOutcome(world)).toEqual(FALLBACK_OUTCOME);
  });
});

describe("store write failure", () => {
  test("A17 a failed save is reported once, tried again, and each use is counted exactly once", async ($, on) => {
    const world = worldOf(on, { snapshot: WARM });
    await startIn($);
    await settle(world);
    const before = writesOf(world).length;
    world.failNextWrite();

    await usePrompt($);
    await settle(world);
    const reported = world.logs.length;
    await usePrompt($);
    await world.clock.advance(RETRY_WAIT_MS);
    await settle(world);

    const saved = writesOf(world)
      .slice(before)
      .filter((run) => run.exitCode === 0);
    expect([reported, world.logs.length, occurrences(saved, `'${SKILL}'`)]).toEqual([1, 1, 2]);
  });
});

describe("store spend writes", () => {
  test("A28 the first session cost costs one sqlite3 process that saves the session's spend state in the database, not the old store", async ($, on) => {
    const world = worldOf(on, { snapshot: WARM });
    await startedWithoutCost($, world);
    const before = world.runs.length;

    await changeCost($, COST_USD);
    await settle(world);

    const runs = world.runs.slice(before);
    expect([
      runs.length,
      STATE_WRITE.test(runs[0]?.stdin ?? ""),
      world.storedKeys().filter((key) => key.startsWith("spend")),
    ]).toEqual([1, true, []]);
  });

  test("A29 a new cost after the first costs no sqlite3 process", async ($, on) => {
    const world = worldOf(on, { snapshot: WARM });
    await startedWithoutCost($, world);
    await changeCost($, COST_USD);
    await settle(world);
    const before = world.runs.length;

    await changeCost($, COST_USD + 2);
    await settle(world);

    expect(world.runs.length - before).toBe(0);
  });
});

describe("store spend cleanup", () => {
  test("A31 a new session removes transcript spend older than 31 days", async ($, on) => {
    const world = worldOf(on, { snapshot: WARM });
    await startedWithoutCost($, world);
    const before = world.runs.length;

    await beginSession($, world, "startup");

    expect(matching(world.runs.slice(before), PRUNE_WRITE)).toBe(1);
  });

  test("A32 a resumed session removes transcript spend older than 31 days", async ($, on) => {
    const world = worldOf(on, { snapshot: WARM });
    await startedWithoutCost($, world);
    const before = world.runs.length;

    await beginSession($, world, "resume");

    expect(matching(world.runs.slice(before), PRUNE_WRITE)).toBe(1);
  });

  test("A33 a cleared session removes transcript spend older than 31 days", async ($, on) => {
    const world = worldOf(on, { snapshot: WARM });
    await startedWithoutCost($, world);
    const before = world.runs.length;

    await beginSession($, world, "clear");

    expect(matching(world.runs.slice(before), PRUNE_WRITE)).toBe(1);
  });

  test("A34 a forked session removes transcript spend older than 31 days", async ($, on) => {
    const world = worldOf(on, { snapshot: WARM });
    await startedWithoutCost($, world);
    const before = world.runs.length;

    await beginSession($, world, "fork");

    expect(matching(world.runs.slice(before), PRUNE_WRITE)).toBe(1);
  });

  test("A35 a compaction removes no transcript spend where a new session does", async ($, on) => {
    const world = worldOf(on, { snapshot: WARM });
    await startedWithoutCost($, world);
    const beforeStartup = world.runs.length;
    await beginSession($, world, "startup");
    const beforeCompact = world.runs.length;

    await beginSession($, world, "compact");

    expect([
      matching(world.runs.slice(beforeStartup, beforeCompact), PRUNE_WRITE),
      matching(world.runs.slice(beforeCompact), PRUNE_WRITE),
    ]).toEqual([1, 0]);
  });
});

describe("store totals on the Spend tab", () => {
  test("A39 five redraws of the Spend tab run no sqlite3 process and read no old store key", async ($, on) => {
    const world = worldOf(on, { snapshot: WARM });
    await startedWithoutCost($, world);
    const pane = await paneOnSpend($, world);
    await settle(world);
    const runs = world.runs.length;
    const gets = world.storeGets.length;

    await redraw(pane, REDRAWS);

    expect([world.runs.length - runs, world.storeGets.length - gets]).toEqual([0, 0]);
  });
});

describe("store in a headless session", () => {
  test("A49 a headless session opens the database, saves its spend state and meters there and writes no old store key", async ($, on) => {
    const world = worldOf(on, { snapshot: WARM });
    await startHeadless($);
    await settle(world);
    const opened = world.runs.length;

    await changeCost($, COST_USD);
    await changeCost($, COST_USD + 2);
    await measureFiveHour($, 48);
    await settle(world);

    const writes = world.runs.slice(opened);
    expect([
      opened,
      matching(writes, STATE_WRITE) > 0,
      matching(writes, /usageLimits/u) > 0,
      world.storedKeys(),
    ]).toEqual([1, true, true, []]);
  });
});

describe("store concurrent first import", () => {
  const WINNER: Partial<Snapshot> = {
    uses: [
      ["skill", FOLDER, SKILL, 4],
      ["tool", FOLDER, MCP_TOOL, 3],
    ],
    limits: SAVED_LIMITS,
  };

  test("A50 when another session imported first, the session reads the database again and shows its counts and meters", async ($, on) => {
    const world = worldOf(on, { oldStore: OLD_STORE, importConflict: WINNER });

    await startIn($);
    await settle(world);

    expect([
      world.state("skillUses"),
      world.state("toolUses"),
      (world.state("usage") as { limits: SavedLimit[] }).limits,
    ]).toEqual([{ [SKILL]: 4 }, { [MCP_TOOL]: 3 }, SAVED_LIMITS]);
  });

  test("A51 when another session imported first, no saving-failed report appears", async ($, on) => {
    const world = worldOf(on, { oldStore: OLD_STORE, importConflict: WINNER });

    await startIn($);
    await settle(world);

    expect(world.logs.filter((text) => text.includes("saving to the store failed"))).toEqual([]);
  });
});

describe("store ops before the session starts", () => {
  test("B1 a new session whose start op runs before session.start still saves its first spend state in the database", async ($, on) => {
    const world = worldOf(on, { snapshot: WARM });

    await $.classic.SessionStart({ source: "startup" });
    await startIn($);
    await changeCost($, FIRST_COST);
    await settle(world);

    expect(matching(world.runs, STATE_WRITE)).toBe(1);
  });

  test("B2 an op that runs before session.start writes nothing to the old store and runs the old-spend cleanup in the database", async ($, on) => {
    const world = worldOf(on, { snapshot: WARM });

    await $.classic.SessionStart({ source: "startup" });
    await settle(world);

    expect([world.storedKeys(), matching(world.runs, PRUNE_WRITE)]).toEqual([[], 1]);
  });

  test("B3 two ops started together before session.start probe sqlite3 once, and session.start probes no second time", async ($, on) => {
    const world = worldOf(on, { snapshot: WARM });

    await Promise.all([$.classic.SessionStart({ source: "startup" }), usePrompt($)]);
    await settle(world);
    const beforeStart = world.runs.filter((run) => run.kind === "open").length;
    await startIn($);
    await settle(world);

    expect([beforeStart, world.runs.filter((run) => run.kind === "open").length]).toEqual([1, 1]);
  });

  test("B4 without sqlite3 the first cost lands in the old store with one sqlite3 try", async ($, on) => {
    const world = worldOf(on, { mode: "missing" });

    await $.classic.SessionStart({ source: "startup" });
    await startIn($);
    await changeCost($, FIRST_COST);
    await settle(world);

    const saved = world.stored("spendSessions") as Record<string, unknown>;
    expect([world.runs.length, Object.keys(saved)]).toEqual([1, [OWN_SESSION]]);
  });

  test("B6 a new session whose spend state and old-spend cleanup run while the database is still opening saves both in the database and writes nothing to the old store", async ($, on) => {
    const world = worldOf(on, { snapshot: WARM });
    const releaseOpen = world.holdOpen();

    await beginSessionWhileOpening($, world, releaseOpen);

    expect([
      matching(world.runs, STATE_WRITE),
      matching(world.runs, PRUNE_WRITE),
      world.storedKeys(),
    ]).toEqual([1, 1, []]);
  });
});

function fallbackOutcome(world: World): Record<string, unknown> {
  const limits = world.stored("usageLimits") as SavedLimit[] | undefined;
  return {
    sqliteRuns: world.runs.length,
    skillUses: world.stored("skillUses"),
    toolUses: world.stored("toolUses"),
    toolFailures: world.stored("toolFailures"),
    usageLimits: limits?.map(({ label, percent }) => ({ label, percent })),
  };
}

async function useEverything($: Engine, world: World): Promise<void> {
  await startIn($);
  await settle(world);
  await usePrompt($);
  await callTool($);
  await callTool($, true);
  await measureFiveHour($, 48);
  await settle(world);
}

function writesOf(world: World): Run[] {
  return world.runs.filter((run) => run.kind === "write");
}

function occurrences(runs: readonly Run[], text: string): number {
  return runs.reduce((total, run) => total + run.stdin.split(text).length - 1, 0);
}

async function settle(world: World): Promise<void> {
  await world.clock.settle();
  for (let tick = 0; tick < QUIET_TICKS; tick++) await Promise.resolve();
  await world.clock.settle();
}

async function startHeadless($: Engine): Promise<void> {
  await $.session.start({ cwd: FOLDER, surface: "terminal", isInteractive: false });
}

async function startIn($: Engine): Promise<void> {
  await $.session.start({ cwd: FOLDER, surface: "terminal", isInteractive: true });
}

async function usePrompt($: Engine): Promise<unknown> {
  return $.skill.prompt({ skill: SKILL, text: `Run ${SKILL}.` });
}

async function callTool($: Engine, isFailing = false): Promise<unknown> {
  const call = $.tool.call as (event: object) => Promise<unknown>;
  return call({ tool: MCP_TOOL, tool_use_id: `call-${isFailing ? "bad" : "good"}` });
}

function measureFiveHour($: Engine, percentUsed: number): Promise<unknown> {
  return $.session.measure({
    context: { window: 200_000 },
    rateLimits: [{ kind: "five_hour", percentUsed }],
    changed: ["rateLimits"],
  } as never);
}

function mountPane($: Engine): Promise<Pane> {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: "session",
    props: {
      title: "Session",
      isFocused: false,
      bodyColumns: COLUMNS,
      placement: "dock",
      scroll: { offset: 0, bodyRows: PANE_ROWS },
      view: {},
    },
    viewport: { columns: COLUMNS, rows: PANE_ROWS },
  });
}

async function paneOnSkills($: Engine, world: World): Promise<Pane> {
  const pane = await mountPane($);
  await showTabThroughArrows(pane, "Skills");
  await settle(world);
  return pane;
}

async function blocksOn(pane: Pane): Promise<Record<string, Block>> {
  return blocksOf(linesOf(await pane.drawn()), HEADINGS);
}

async function pressNode(
  pane: Pane,
  world: World,
  button: Parameters<typeof keyOf>[0],
): Promise<void> {
  expect(button, "a button to press").toBeDefined();
  await pane.press({ key: keyOf(button) });
  await settle(world);
  for (let tick = 0; tick < REDRAWS; tick++) await pane.redraw();
}

async function startedWithoutCost($: Engine, world: World): Promise<void> {
  await startIn($);
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [],
    changed: ["cost"],
  } as never);
  await settle(world);
}

async function changeCost($: Engine, usd: number): Promise<unknown> {
  return $.session.measure({
    context: { window: 200_000 },
    rateLimits: [],
    cost: { usd },
    changed: ["cost"],
  } as never);
}

async function beginSession(
  $: Engine,
  world: World,
  source: "startup" | "resume" | "clear" | "fork" | "compact",
): Promise<void> {
  await $.classic.SessionStart({ source });
  await settle(world);
}

async function beginSessionWhileOpening(
  $: Engine,
  world: World,
  releaseOpen: () => void,
): Promise<void> {
  const starting = $.classic.SessionStart({ source: "startup" });
  await settle(world);
  releaseOpen();
  await starting;
  await settle(world);
}

function matching(runs: readonly Run[], pattern: RegExp): number {
  return runs.filter((run) => pattern.test(run.stdin)).length;
}

async function paneOnSpend($: Engine, world: World): Promise<Pane> {
  const pane = await mountPane($);
  await showTabThroughArrows(pane, "Spend");
  await settle(world);
  return pane;
}

async function redraw(pane: Pane, times: number): Promise<void> {
  for (let tick = 0; tick < times; tick++) await pane.redraw();
}

function snapshotLine(snapshot: Snapshot, version: number): string {
  return JSON.stringify({
    v: version,
    imported: snapshot.imported,
    uses: snapshot.uses,
    limits: snapshot.limits,
    spendState: null,
  });
}

function kindOf(stdin: string): RunKind {
  if (stdin.includes("CREATE TABLE IF NOT EXISTS")) return "open";
  if (/INSERT\s+INTO\s+kv[^;]*importedFromStore/u.test(stdin)) return "import";
  return "write";
}

function worldOf(on: On, options: WorldOptions = {}): World {
  const mode = options.mode ?? "ok";
  const snapshot: Snapshot = {
    imported: false,
    uses: [],
    limits: null,
    ...options.snapshot,
  };
  const kept = new Map<string, unknown>(Object.entries(options.oldStore ?? {}));
  const states = new Map<string, { value: unknown; version: number }>();
  const runs: Run[] = [];
  const logs: string[] = [];
  const storeGets: string[] = [];
  let keysCalls = 0;
  let gate: Promise<void> | null = null;
  let openGate: Promise<void> = Promise.resolve();
  let isFailingNext = false;
  const clock = mock.clock(on, { now: NOW });
  mock.env(on, { HOME });
  on("store.get", (_$, e) => {
    storeGets.push(e.key);
    return { value: kept.get(e.key) };
  });
  on("store.set", (_$, e) => {
    kept.set(e.key, JSON.parse(JSON.stringify(e.value)));
    return { value: undefined };
  });
  on("store.keys", () => {
    keysCalls += 1;
    return { value: [...kept.keys()] };
  });
  on("store.delete", (_$, e) => {
    kept.delete(e.key);
    return { value: undefined };
  });
  on("state.get", (_$, e) => ({
    value: states.get(stateKey(e)) ?? { value: undefined, version: 0 },
  }));
  on("state.set", (_$, e) => {
    const key = stateKey(e);
    const version = (states.get(key)?.version ?? 0) + 1;
    states.set(key, { value: e.value, version });
    return { value: { isSet: true, version } };
  });
  on("ui.log", (_$, e) => {
    logs.push(e.text);
    return { value: undefined };
  });
  on("process.run", async (_$, e) => {
    if (!e.argv.some((part) => part.includes("sqlite3")))
      return { value: { exitCode: 1, stdout: "", stderr: "" } } as never;
    const stdin = e.init?.stdin ?? "";
    const run: Run = { kind: kindOf(stdin), stdin, exitCode: undefined };
    runs.push(run);
    if (mode === "reject") throw new Error("spawn sqlite3 ENOENT");
    if (mode === "missing") return finish(run, 127, "", "sh: sqlite3: not found");
    if (mode === "silent") return finish(run, 0, "", "");
    if (mode === "failed") return finish(run, 1, `${snapshotLine(snapshot, 1)}\n`, "");
    if (mode === "otherVersion") return finish(run, 0, `${snapshotLine(snapshot, 2)}\n`, "");
    if (run.kind === "open") {
      await openGate;
      return finish(run, 0, `wal\n${snapshotLine(snapshot, 1)}\n`, "");
    }
    if (run.kind === "import" && options.importConflict !== undefined) {
      Object.assign(snapshot, options.importConflict, { imported: true });
      return finish(run, 1, "", "Runtime error: UNIQUE constraint failed: kv.key (19)");
    }
    if (run.kind === "import") {
      snapshot.imported = true;
      return finish(run, 0, `${snapshotLine(snapshot, 1)}\n`, "");
    }
    if (run.stdin.includes("json_object('v'")) {
      return finish(run, 0, `${snapshotLine(snapshot, 1)}\n`, "");
    }
    await gate;
    if (isFailingNext) {
      isFailingNext = false;
      return finish(run, 1, "", "database is locked");
    }
    return finish(run, 0, "", "");
  });
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("session.id", () => ({ value: "session-1" }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: FOLDER }));
  on("session.repo", () => ({ value: null }));
  on("session.root", () => ({ value: FOLDER }));
  on("command.register", () => ({ value: {} }) as never);
  on("agent.list", () => ({ value: [] }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", (_$, e) => {
    const breakdown = {
      categories: [],
      totalTokens: 0,
      rawMaxTokens: 200_000,
      gridRows: [],
      memoryFiles: [],
      agents: [],
      mcpTools: [],
      skills: {
        totalSkills: 1,
        includedSkills: 1,
        tokens: 0,
        skillFrontmatter: [{ name: SKILL, source: "userSettings", tokens: 10 }],
      },
    } as unknown as SessionContextBreakdown;
    const context =
      e.breakdown === undefined ? { window: 200_000 } : { window: 200_000, breakdown };
    return { value: { startedAt: NOW, context, rateLimits: [] } };
  });
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("config.list", () => ({ value: [{ key: "theme", value: "dark" }] }) as never);
  on("settings.read", () => ({ value: {} }));
  on("fs.exists", () => ({ value: false }));
  on("fs.read", (_$, e) => {
    throw new Error(`ENOENT: ${e.path}`);
  });
  on("fs.write", () => ({ value: undefined }));
  on("fs.list", () => ({ value: [] }));
  on("skill.prompt", (_$, e) => ({ text: e.text }));
  on("tool.call", (_$, e) =>
    e.tool_use_id === "call-bad"
      ? { isError: true, result: "boom", text: "boom" }
      : { result: "ok", text: "ok" },
  );
  on("classic.SessionStart", () => ({}));
  on("ui.render", { component: "Pane" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine pane</Text>;
  });
  return {
    clock,
    runs,
    logs,
    storeGets,
    storeKeysCalls: () => keysCalls,
    stored: (key) => kept.get(key),
    state: (key) => states.get(`${STATE_PREFIX}.${key}.`)?.value,
    holdWrites: () => {
      let release = (): void => undefined;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    holdOpen: () => {
      let release = (): void => undefined;
      openGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    failNextWrite: () => {
      isFailingNext = true;
    },
    storedKeys: () => [...kept.keys()],
  };
}

function finish(run: Run, exitCode: number, stdout: string, stderr: string): never {
  run.exitCode = exitCode;
  return { value: { exitCode, stdout, stderr } } as never;
}

function stateKey(address: { plugin: string; key: string; id?: string }): string {
  return `${address.plugin}.${address.key}.${address.id ?? ""}`;
}
