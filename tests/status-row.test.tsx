import { describe, expect, mock, test } from "claude-code/testing";
import type { ConfigRow, On, SessionContextBreakdown, SessionMessage } from "claude-code";
import type { Engine } from "claude-code/testing";

import { palette } from "../hooks/palette";
import { accentOf, ENGINE_DEFAULT_GREY } from "../hooks/session-color";
import { colouredPieces, screenRows } from "./band-screen";

const HOME = "/Users/dev";
const PROJECT = `${HOME}/workspace/projects/paneline`;
const TRANSCRIPT = "/tmp/session.jsonl";
const SESSION_START = { cwd: PROJECT, surface: "terminal", isInteractive: true } as const;
const PANE_TOGGLE = " ".repeat(5);
const GREY = ENGINE_DEFAULT_GREY;
const RED = accentOf("red");
const NOW = 1_800_000_000_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const THIRTY_SECONDS_MS = 30_000;
const WINDOW = 200_000;
const TOKENS_PER_PERCENT = WINDOW / 100;
const WIDE = 200;
const OWN_PID = 4100;
const MEASURED_PERCENT = 72;
const START_ESTIMATE_PERCENT = 50;
const PRE_COMPACT_PERCENT = 53;
const COMPACT_ESTIMATE_PERCENT = 24;
const COMPACT_MEASURED_PERCENT = 31;
const SUMMARY_MESSAGE: SessionMessage = { role: "user", text: "summary", toolUses: [] };
const SHOT_COLUMNS = 120;
const SIXTY_COLUMNS = 60;
const CHIPS = " opus 5.5  high  ~/workspace/projects/paneline ";
const BAR_CELLS = /[▰▱]+/g;
const COLUMN_TEXTS = /[≡◷▦][^≡◷▦]*?\d+%/g;
const ANY_BAR = /[▰▱]/;
const ANY_METER_CELL = /[≡◷▦▰▱%]/;
const TASK_METER_CELL = /[◆≡◷▦▰▱%]/;
const LEADING_BAR = /^[▰▱]*/;
const TASK_BAR_CELLS = 5;
const OLD_LOOK = /ctx|5h|7d|↺|[▁▂▃▄▅▆▇█]/;

type Progress = {
  tasks: Record<string, { status: "pending" | "in_progress" | "completed"; title: string }>;
  percent: number | null;
  callsSinceNote: number;
};

function task(status: "pending" | "in_progress" | "completed"): Progress["tasks"][string] {
  return { status, title: "a task" };
}

const THREE_OF_FIVE: Progress = {
  tasks: {
    "1": task("completed"),
    "2": task("completed"),
    "3": task("completed"),
    "4": task("in_progress"),
    "5": task("pending"),
  },
  percent: null,
  callsSinceNote: 0,
};
const NO_TASKS: Progress = { tasks: {}, percent: null, callsSinceNote: 0 };
const ONE_OF_TWO: Progress = {
  tasks: { "1": task("completed"), "2": task("pending") },
  percent: null,
  callsSinceNote: 0,
};
const ALL_DONE: Progress = {
  tasks: {
    "1": task("completed"),
    "2": task("completed"),
    "3": task("completed"),
    "4": task("completed"),
    "5": task("completed"),
  },
  percent: null,
  callsSinceNote: 0,
};
const ALL_PENDING: Progress = {
  tasks: {
    "1": task("pending"),
    "2": task("pending"),
    "3": task("pending"),
    "4": task("pending"),
    "5": task("pending"),
  },
  percent: null,
  callsSinceNote: 0,
};

type Limit = { percentUsed: number; resetsInMs?: number };
type Reading = { context?: number; five?: Limit; seven?: Limit };

const MICROTASK_TURNS = 200;
const HALF_WINDOW_TOKENS = WINDOW / 2;
const SAVED_LIMITS: SavedLimit[] = [
  { label: "5h", percent: 48, resetsAt: new Date(NOW + 2 * HOUR_MS).toISOString() },
  { label: "7d", percent: 59, resetsAt: new Date(NOW + 3 * DAY_MS).toISOString() },
];
const FULL_BARS = "▰▰▰▰▱▰▰▰▰▱▱▱▱▰▰▰▰▰▱▱▱";
const FULL_READING: Reading = {
  context: 72,
  five: { percentUsed: 48, resetsInMs: 2 * HOUR_MS },
  seven: { percentUsed: 59, resetsInMs: 3 * DAY_MS },
};
const SCREENSHOT_READING: Reading = {
  context: 72,
  five: { percentUsed: 18, resetsInMs: 4 * HOUR_MS + 18 * MINUTE_MS },
  seven: { percentUsed: 5, resetsInMs: 6 * DAY_MS + 23 * HOUR_MS },
};
const HIGH_BARS = "▰▰▰▰▰▰▰▰▰▰▰▰▱▰▰▰▰▰▰▰▰";
const HIGH_READING: Reading = {
  context: 95,
  five: { percentUsed: 92, resetsInMs: 2 * HOUR_MS },
  seven: { percentUsed: 97, resetsInMs: 3 * DAY_MS },
};

describe("the status row", () => {
  test("R1 two meter rows end at the right edge above the input, the chips stay on the row with the bars", async ($, on) => {
    const rows = await bandOf($, on, FULL_READING, WIDE);

    expect(rows).toHaveLength(4);
    expect(rows[0]?.trim()).toBe("");
    expect(rows[2]).toHaveLength(WIDE);
    expect(rows[2]?.endsWith(`≡ 72%   ◷ 2h 48%   ▦ 3d 59%${PANE_TOGGLE}`)).toBe(true);
    expect(rows[3]).toHaveLength(WIDE);
    expect(rows[3]?.startsWith(CHIPS)).toBe(true);
    expect(rows[3]?.endsWith(`▰▰▰▰▱   ▰▰▰▰▱▱▱▱   ▰▰▰▰▰▱▱▱${PANE_TOGGLE}`)).toBe(true);
  });

  test("R2 each bar starts under the first cell of its column and is as wide as the top text", async ($, on) => {
    const rows = await bandOf(
      $,
      on,
      {
        context: 31,
        five: { percentUsed: 90, resetsInMs: 45 * MINUTE_MS },
        seven: { percentUsed: 12, resetsInMs: 6 * DAY_MS },
      },
      WIDE,
    );

    const columns = [...(rows[2] ?? "").matchAll(COLUMN_TEXTS)];
    const bars = [...(rows[3] ?? "").matchAll(BAR_CELLS)];

    expect(bars.map((bar) => bar[0])).toEqual(["▰▰▱▱▱", "▰▰▰▰▰▰▰▰▱", "▰▱▱▱▱▱▱▱"]);
    expect(bars.map((bar) => [bar.index, bar[0].length])).toEqual(
      columns.map((column) => [column.index, column[0].length]),
    );
  });

  test("R3 a limit with no reset time shows no time and its bar is as wide as the shorter column", async ($, on) => {
    const rows = await bandOf(
      $,
      on,
      { context: 72, five: { percentUsed: 48 }, seven: { percentUsed: 59 } },
      WIDE,
    );

    expect(rows[2]?.endsWith(`≡ 72%   ◷ 48%   ▦ 59%${PANE_TOGGLE}`)).toBe(true);
    expect(rows[3]?.endsWith(`▰▰▰▰▱   ▰▰▱▱▱   ▰▰▰▱▱${PANE_TOGGLE}`)).toBe(true);
  });

  test("R4 a reset time shows the largest unit rounded down", async ($, on) => {
    const rows = await bandOf(
      $,
      on,
      {
        context: 72,
        five: { percentUsed: 48, resetsInMs: 2 * HOUR_MS + 59 * MINUTE_MS },
        seven: { percentUsed: 59, resetsInMs: 3 * DAY_MS + 23 * HOUR_MS },
      },
      WIDE,
    );

    expect(rows[2]?.endsWith(`≡ 72%   ◷ 2h 48%   ▦ 3d 59%${PANE_TOGGLE}`)).toBe(true);
  });

  test("R5 a reset in 45 minutes shows 45m", async ($, on) => {
    const rows = await bandOf(
      $,
      on,
      { ...FULL_READING, five: { percentUsed: 48, resetsInMs: 45 * MINUTE_MS } },
      WIDE,
    );

    expect(rows[2]?.endsWith(`≡ 72%   ◷ 45m 48%   ▦ 3d 59%${PANE_TOGGLE}`)).toBe(true);
  });

  test("R6 at the unit edges 60 minutes shows 1h and 24 hours shows 1d", async ($, on) => {
    const rows = await bandOf(
      $,
      on,
      {
        context: 72,
        five: { percentUsed: 48, resetsInMs: 60 * MINUTE_MS },
        seven: { percentUsed: 59, resetsInMs: 24 * HOUR_MS },
      },
      WIDE,
    );

    expect(rows[2]?.endsWith(`≡ 72%   ◷ 1h 48%   ▦ 1d 59%${PANE_TOGGLE}`)).toBe(true);
  });

  test("R7 the old labels, the reset arrow and the one-character gauge are gone", async ($, on) => {
    const rows = await bandOf($, on, FULL_READING, WIDE);

    expect(rows.join("\n")).toContain("≡ 72%");
    expect(rows.join("\n")).not.toMatch(OLD_LOOK);
  });

  test("R8 by default every piece of the meter block is the grey accent", async ($, on) => {
    const world = worldOf(on);
    await startWith($, world, FULL_READING);

    const shown = await meterPieces($);

    expect(shown.map(({ text }) => text).join("")).toContain("≡ 72%");
    expect(shown.map(({ text }) => text).join("")).toContain("◷ 2h 48%");
    expect(shown.map(({ text }) => text).join("")).toContain("▦ 3d 59%");
    expect(barsOf(shown)).toBe(FULL_BARS);
    expect(new Set(accentPieces(shown).map(({ color }) => color))).toEqual(new Set([GREY]));
  });

  test("R9 after /color red every piece of the meter block is red", async ($, on) => {
    const world = worldOf(on, { colorEntries: ["red"] });
    await startWith($, world, FULL_READING, TRANSCRIPT);

    const shown = await meterPieces($);

    expect(shown.map(({ text }) => text).join("")).toContain("≡ 72%");
    expect(shown.map(({ text }) => text).join("")).toContain("◷ 2h 48%");
    expect(shown.map(({ text }) => text).join("")).toContain("▦ 3d 59%");
    expect(barsOf(shown)).toBe(FULL_BARS);
    expect(new Set(accentPieces(shown).map(({ color }) => color))).toEqual(new Set([RED]));
  });

  test("R19 after /color red at 90% and above the whole meter block stays red", async ($, on) => {
    const world = worldOf(on, { colorEntries: ["red"] });
    await startWith($, world, HIGH_READING, TRANSCRIPT);

    const shown = await meterPieces($);

    expect(shown.map(({ text }) => text).join("")).toContain("≡ 95%");
    expect(shown.map(({ text }) => text).join("")).toContain("◷ 2h 92%");
    expect(shown.map(({ text }) => text).join("")).toContain("▦ 3d 97%");
    expect(barsOf(shown)).toBe(HIGH_BARS);
    expect(new Set(accentPieces(shown).map(({ color }) => color))).toEqual(new Set([RED]));
  });

  test("R20 by default at 90% and above the whole meter block stays grey", async ($, on) => {
    const world = worldOf(on);
    await startWith($, world, HIGH_READING);

    const shown = await meterPieces($);

    expect(shown.map(({ text }) => text).join("")).toContain("≡ 95%");
    expect(shown.map(({ text }) => text).join("")).toContain("◷ 2h 92%");
    expect(shown.map(({ text }) => text).join("")).toContain("▦ 3d 97%");
    expect(barsOf(shown)).toBe(HIGH_BARS);
    expect(new Set(accentPieces(shown).map(({ color }) => color))).toEqual(new Set([GREY]));
  });

  test("R23 a 5h reset time that has passed reads 0% with no time and an empty bar", async ($, on) => {
    const rows = await bandOf(
      $,
      on,
      { ...FULL_READING, five: { percentUsed: 48, resetsInMs: -2 * HOUR_MS } },
      WIDE,
    );

    expect(rows[2]?.endsWith(`≡ 72%   ◷ 0%   ▦ 3d 59%${PANE_TOGGLE}`)).toBe(true);
    expect(rows[3]?.endsWith(`▰▰▰▰▱   ▱▱▱▱   ▰▰▰▰▰▱▱▱${PANE_TOGGLE}`)).toBe(true);
  });

  test("R24 a 7d reset time that passed 30 seconds ago reads 0% with no time and an empty bar", async ($, on) => {
    const rows = await bandOf(
      $,
      on,
      { ...FULL_READING, seven: { percentUsed: 59, resetsInMs: -THIRTY_SECONDS_MS } },
      WIDE,
    );

    expect(rows[2]?.endsWith(`≡ 72%   ◷ 2h 48%   ▦ 0%${PANE_TOGGLE}`)).toBe(true);
    expect(rows[3]?.endsWith(`▰▰▰▰▱   ▰▰▰▰▱▱▱▱   ▱▱▱▱${PANE_TOGGLE}`)).toBe(true);
  });

  test("R25 a reading with no limits keeps the 5h and 7d meters at their last values", async ($, on) => {
    const world = worldOf(on);
    await startWith($, world, FULL_READING);
    await measure($, { context: 40 });

    const rows = screenRows(await mountBand($, WIDE), WIDE);

    expect(rows[2]?.endsWith(`≡ 40%   ◷ 2h 48%   ▦ 3d 59%${PANE_TOGGLE}`)).toBe(true);
  });

  test("R26 a reading with only a new 5h value replaces the 5h meter, keeps the 7d meter and leaves it on the right", async ($, on) => {
    const world = worldOf(on);
    await startWith($, world, FULL_READING);
    await measure($, { context: 72, five: { percentUsed: 30, resetsInMs: 2 * HOUR_MS } });

    const rows = screenRows(await mountBand($, WIDE), WIDE);

    expect(rows[2]?.endsWith(`≡ 72%   ◷ 2h 30%   ▦ 3d 59%${PANE_TOGGLE}`)).toBe(true);
  });

  test("R27 clearing the session keeps the 5h and 7d meters when the refresh reports no limits", async ($, on) => {
    const world = worldOf(on);
    await startWith($, world, FULL_READING);

    await $.classic.SessionStart({ source: "clear" });

    const rows = screenRows(await mountBand($, WIDE), WIDE);

    expect(rows[2]?.endsWith(`◷ 2h 48%   ▦ 3d 59%${PANE_TOGGLE}`)).toBe(true);
  });

  test("R28 a kept 5h meter whose reset time has passed reads 0%", async ($, on) => {
    const world = worldOf(on);
    await startWith($, world, FULL_READING);
    await measure($, { context: 72 });
    await world.clock.advance(3 * HOUR_MS);

    const rows = screenRows(await mountBand($, WIDE), WIDE);

    expect(rows[2]?.endsWith(`≡ 72%   ◷ 0%   ▦ 2d 59%${PANE_TOGGLE}`)).toBe(true);
  });

  test("R32 a fresh session shows the share already taken before any prompt", async ($, on) => {
    const world = worldOf(on, { breakdownTokens: HALF_WINDOW_TOKENS });
    await $.session.start(SESSION_START);
    await world.settle();

    const rows = screenRows(await mountBand($, WIDE), WIDE);

    expect(rows[2]?.endsWith(`≡ 50%${PANE_TOGGLE}`)).toBe(true);
  });

  test("R33 a breakdown that arrives after a measure does not replace the measured share", async ($, on) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const world = worldOf(on, { breakdownTokens: HALF_WINDOW_TOKENS, holdFullBreakdown: held });
    await $.session.start(SESSION_START);
    await measure($, { context: 72 });
    release();
    await world.settle();

    const rows = screenRows(await mountBand($, WIDE), WIDE);

    expect(rows[2]?.endsWith(`≡ 72%${PANE_TOGGLE}`)).toBe(true);
  });

  test("R34 clearing the session refills the share from a new breakdown", async ($, on) => {
    const world = worldOf(on, { breakdownTokens: HALF_WINDOW_TOKENS });
    await startWith($, world, { context: 72 });
    world.setBreakdownTokens(TOKENS_PER_PERCENT * 10);

    await $.classic.SessionStart({ source: "clear" });
    await world.settle();

    const rows = screenRows(await mountBand($, WIDE), WIDE);

    expect(rows[2]?.endsWith(`≡ 10%${PANE_TOGGLE}`)).toBe(true);
  });

  test("R42 a compact refills the share from the breakdown after it, not the share stored before it", async ($, on) => {
    const world = worldOf(on, { breakdownTokens: HALF_WINDOW_TOKENS });
    await $.session.start(SESSION_START);
    await world.settle();
    await measure($, { context: 53 });
    world.setLiveTokens(TOKENS_PER_PERCENT * 53);
    await world.settle();

    await $.session.compact({ trigger: "manual", messages: [SUMMARY_MESSAGE] });
    await $.classic.SessionStart({ source: "compact" });
    await world.settle();
    world.setBreakdownTokens(TOKENS_PER_PERCENT * 24);
    world.setLiveTokens(undefined);
    await mountBand($, WIDE);
    await world.settle();

    const rows = screenRows(await mountBand($, WIDE), WIDE);

    expect(rows[2]?.endsWith(`≡ 24%${PANE_TOGGLE}`)).toBe(true);
  });

  test("R46 a clear right after a compact shows the clear reseed, not the post-compact share", async ($, on) => {
    const world = worldOf(on, { breakdownTokens: HALF_WINDOW_TOKENS });
    await $.session.start(SESSION_START);
    await world.settle();
    await measure($, { context: 53 });
    world.setLiveTokens(TOKENS_PER_PERCENT * 53);
    await world.settle();
    await $.session.compact({ trigger: "manual", messages: [SUMMARY_MESSAGE] });
    await $.classic.SessionStart({ source: "compact" });
    await world.settle();
    world.setBreakdownTokens(TOKENS_PER_PERCENT * 24);
    world.setLiveTokens(undefined);
    await mountBand($, WIDE);
    await world.settle();
    world.setBreakdownTokens(TOKENS_PER_PERCENT * 5);
    await $.classic.SessionStart({ source: "clear" });
    await world.settle();
    await mountBand($, WIDE);
    await world.settle();

    const rows = screenRows(await mountBand($, WIDE), WIDE);

    expect(rows[2]?.endsWith(`≡ 5%${PANE_TOGGLE}`)).toBe(true);
  });

  test("R44 a compact keeps the share stored before it until the engine drops its old reading", async ($, on) => {
    const world = worldOf(on, { breakdownTokens: HALF_WINDOW_TOKENS });
    await $.session.start(SESSION_START);
    await world.settle();
    await measure($, { context: 53 });
    world.setLiveTokens(TOKENS_PER_PERCENT * 53);
    await world.settle();

    await $.session.compact({ trigger: "manual", messages: [SUMMARY_MESSAGE] });
    await $.classic.SessionStart({ source: "compact" });
    await world.settle();
    await mountBand($, WIDE);
    await world.settle();

    const rows = screenRows(await mountBand($, WIDE), WIDE);

    expect(rows[2]?.endsWith(`≡ 53%${PANE_TOGGLE}`)).toBe(true);
  });

  test("R45 the first response after a compact replaces the share read from the breakdown", async ($, on) => {
    const world = worldOf(on, { breakdownTokens: TOKENS_PER_PERCENT * 24 });
    await $.session.start(SESSION_START);
    await world.settle();
    await measure($, { context: 53 });
    await world.settle();
    await $.session.compact({ trigger: "manual", messages: [SUMMARY_MESSAGE] });
    await measure($, { context: 31 });
    await world.settle();
    world.setBreakdownTokens(TOKENS_PER_PERCENT * 60);

    const rows = screenRows(await mountBand($, WIDE), WIDE);

    expect(rows[2]?.endsWith(`≡ 31%${PANE_TOGGLE}`)).toBe(true);
  });

  test("R43 a startup keeps the share stored before it", async ($, on) => {
    const world = worldOf(on, { breakdownTokens: HALF_WINDOW_TOKENS });
    await $.session.start(SESSION_START);
    await world.settle();
    await measure($, { context: 72 });
    await world.settle();
    world.setBreakdownTokens(TOKENS_PER_PERCENT * 10);

    await $.classic.SessionStart({ source: "startup" });
    await world.settle();

    const rows = screenRows(await mountBand($, WIDE), WIDE);

    expect(rows[2]?.endsWith(`≡ 72%${PANE_TOGGLE}`)).toBe(true);
  });

  test("R35 a new process with no engine reading shows the saved 5h and 7d meters", async ($, on) => {
    const world = worldOf(on, { savedLimits: SAVED_LIMITS });
    await $.session.start(SESSION_START);
    await world.settle();

    const rows = screenRows(await mountBand($, WIDE), WIDE);

    expect(rows[2]).toContain("◷ 2h 48%   ▦ 3d 59%");
  });

  test("R36 the first fresh reading replaces the saved 5h and 7d meters", async ($, on) => {
    const world = worldOf(on, { savedLimits: SAVED_LIMITS });
    await $.session.start(SESSION_START);
    await measure($, {
      five: { percentUsed: 30, resetsInMs: HOUR_MS },
      seven: { percentUsed: 61, resetsInMs: DAY_MS },
    });
    await world.settle();

    const rows = screenRows(await mountBand($, WIDE), WIDE);

    expect(rows[2]).toContain("◷ 1h 30%   ▦ 1d 61%");
  });

  test("R37 a changed reading is saved for the next process", async ($, on) => {
    const world = worldOf(on);
    await startWith($, world, FULL_READING);

    expect(world.stored(LIMITS_KEY)).toEqual([
      { label: "5h", percent: 48, resetsAt: new Date(NOW + 2 * HOUR_MS).toISOString() },
      { label: "7d", percent: 59, resetsAt: new Date(NOW + 3 * DAY_MS).toISOString() },
    ]);
  });

  test("R38 a 5h meter at 60% with 3 hours to its reset draws a plain bar with no pace marker", async ($, on) => {
    const rows = await bandOf(
      $,
      on,
      { context: 72, five: { percentUsed: 60, resetsInMs: 3 * HOUR_MS } },
      WIDE,
    );

    expect(rows[2]?.endsWith(`≡ 72%   ◷ 3h 60%${PANE_TOGGLE}`)).toBe(true);
    expect(rows[3]?.endsWith(`▰▰▰▰▱   ▰▰▰▰▰▱▱▱${PANE_TOGGLE}`)).toBe(true);
  });

  test("R39 a 5h meter at 30% with 3 hours to its reset shows no pace mark", async ($, on) => {
    const rows = await bandOf(
      $,
      on,
      { context: 72, five: { percentUsed: 30, resetsInMs: 3 * HOUR_MS } },
      WIDE,
    );

    expect(rows[3]?.endsWith(`▰▰▰▰▱   ▰▰▱▱▱▱▱▱${PANE_TOGGLE}`)).toBe(true);
  });

  test("R40 a 5h meter at 40% with 3 hours to its reset, exactly on pace, shows no pace mark", async ($, on) => {
    const rows = await bandOf(
      $,
      on,
      { context: 72, five: { percentUsed: 40, resetsInMs: 3 * HOUR_MS } },
      WIDE,
    );

    expect(rows[3]?.endsWith(`▰▰▰▰▱   ▰▰▰▱▱▱▱▱${PANE_TOGGLE}`)).toBe(true);
  });

  test("R41 a 7d meter at 50% with 4 days 12 hours to its reset draws a plain bar with no pace marker", async ($, on) => {
    const rows = await bandOf(
      $,
      on,
      { context: 72, seven: { percentUsed: 50, resetsInMs: 4 * DAY_MS + 12 * HOUR_MS } },
      WIDE,
    );

    expect(rows[2]?.endsWith(`≡ 72%   ▦ 4d 50%${PANE_TOGGLE}`)).toBe(true);
    expect(rows[3]?.endsWith(`▰▰▰▰▱   ▰▰▰▰▱▱▱▱${PANE_TOGGLE}`)).toBe(true);
  });

  test("R10 at 0% the context bar has no filled cell", async ($, on) => {
    const rows = await bandOf($, on, { ...FULL_READING, context: 0 }, WIDE);

    expect(firstBar(rows)).toMatch(/^▱{4,5}$/);
  });

  test("R11 at 100% the context bar has no empty cell", async ($, on) => {
    const rows = await bandOf($, on, { ...FULL_READING, context: 100 }, WIDE);

    expect(firstBar(rows)).toMatch(/^▰{5,6}$/);
  });

  test("R12 at 50% the context bar shows three filled cells of five", async ($, on) => {
    const rows = await bandOf($, on, { ...FULL_READING, context: 50 }, WIDE);

    expect(firstBar(rows)).toBe("▰▰▰▱▱");
  });

  test("R13 at 85% the context bar shows four filled cells of five", async ($, on) => {
    const rows = await bandOf($, on, { ...FULL_READING, context: 85 }, WIDE);

    expect(firstBar(rows)).toBe("▰▰▰▰▱");
  });

  test("R14 with only the context known the block is one column", async ($, on) => {
    const rows = await bandOf($, on, { context: 72 }, WIDE);

    expect(rows).toHaveLength(4);
    expect(rows[2]?.endsWith(`≡ 72%${PANE_TOGGLE}`)).toBe(true);
    expect(rows[3]?.endsWith(`▰▰▰▰▱${PANE_TOGGLE}`)).toBe(true);
    expect(rows.join("\n")).not.toMatch(/[◷▦]/);
  });

  test("R15 with only limits known the block is the two limit columns", async ($, on) => {
    const rows = await bandOf($, on, { five: FULL_READING.five, seven: FULL_READING.seven }, WIDE);

    expect(rows[2]?.endsWith(`◷ 2h 48%   ▦ 3d 59%${PANE_TOGGLE}`)).toBe(true);
    expect(rows[3]?.endsWith(`▰▰▰▰▱▱▱▱   ▰▰▰▰▰▱▱▱${PANE_TOGGLE}`)).toBe(true);
    expect(rows.join("\n")).not.toContain("≡");
  });

  test("R16 at 76 columns the bars stay under the context and 5h percents", async ($, on) => {
    const rows = await bandOf($, on, FULL_READING, 76);

    expect(rows.join("\n")).toMatch(ANY_BAR);
    expect(rows.join("\n")).toMatch(/≡ 72%\s+◷ 2h 48%/);
  });

  test("R17 at 28 columns the 7d column is gone, the context percent and its bar stay", async ($, on) => {
    const rows = await bandOf($, on, FULL_READING, 28);

    expect(rows.join("\n")).toContain("≡ 72%");
    expect(rows.join("\n")).not.toContain("▦");
    expect(rows.join("\n")).toMatch(ANY_BAR);
  });

  test("R21 the task meter is the first meter, in the same accent, with 5 cells under it", async ($, on) => {
    const world = worldOf(on, { colorEntries: ["red"], progress: THREE_OF_FIVE });
    await startWith($, world, FULL_READING, TRANSCRIPT);

    const drawn = await mountBand($, WIDE);
    const shown = colouredPieces(drawn).filter(({ text }) => TASK_METER_CELL.test(text));
    const rows = screenRows(drawn, WIDE);

    expect(rows[2]?.endsWith(`◆ 60%    ≡ 72%   ◷ 2h 48%   ▦ 3d 59%${PANE_TOGGLE}`)).toBe(true);
    expect(rows[3]?.endsWith(`▰▰▰▱▱    ▰▰▰▰▱   ▰▰▰▰▱▱▱▱   ▰▰▰▰▰▱▱▱${PANE_TOGGLE}`)).toBe(true);
    expect(new Set(accentPieces(shown).map(({ color }) => color))).toEqual(new Set([RED]));
  });

  test("R22 at 28 columns the task meter and the context stay and the 7d column is gone", async ($, on) => {
    const rows = await bandOf($, on, FULL_READING, 28, { progress: THREE_OF_FIVE });

    expect(rows.join("\n")).toContain("◆ 60%");
    expect(rows.join("\n")).toContain("≡ 72%");
    expect(rows.join("\n")).not.toContain("▦");
  });

  test("R30 three finished tasks of five show 60% over three filled cells of five", async ($, on) => {
    const rows = await bandOf($, on, { context: 72 }, WIDE, {
      progress: { ...THREE_OF_FIVE, percent: 20 },
    });

    expect(rows[2]?.endsWith(`◆ 60%    ≡ 72%${PANE_TOGGLE}`)).toBe(true);
    expect(rows[3]?.endsWith(`▰▰▰▱▱    ▰▰▰▰▱${PANE_TOGGLE}`)).toBe(true);
  });

  test("R31 with no task list a reported 40% shows 40% over two filled cells of five", async ($, on) => {
    const rows = await bandOf($, on, { context: 72 }, WIDE, {
      progress: { ...NO_TASKS, percent: 40 },
    });

    expect(rows[2]?.endsWith(`◆ 40%    ≡ 72%${PANE_TOGGLE}`)).toBe(true);
    expect(rows[3]?.endsWith(`▰▰▱▱▱    ▰▰▰▰▱${PANE_TOGGLE}`)).toBe(true);
  });

  test("R29 once the task list is emptied and no percent is left the task meter disappears", async ($, on) => {
    const world = worldOf(on, { progress: ONE_OF_TWO });
    await startWith($, world, { context: 72 });
    const before = screenRows(await mountBand($, WIDE), WIDE);

    world.setProgress(NO_TASKS);
    const after = screenRows(await mountBand($, WIDE), WIDE);

    expect(before[2]?.endsWith(`◆ 50%    ≡ 72%${PANE_TOGGLE}`)).toBe(true);
    expect(after.join("\n")).not.toContain("◆");
    expect(after[2]?.endsWith(`≡ 72%${PANE_TOGGLE}`)).toBe(true);
  });

  test("R18 a folder name longer than the row is cut from its start and the context percent still shows", async ($, on) => {
    const rows = await bandOf($, on, FULL_READING, 56, { cwd: `${HOME}/${"x".repeat(60)}` });

    expect(Math.max(...rows.map((row) => row.length))).toBe(56);
    expect(rows.join("\n")).toContain("…xxx");
    expect(rows.join("\n")).toContain("≡ 72%");
  });

  test("at 60 columns all three meters stay and only their reset times go", async ($, on) => {
    const rows = await bandOf($, on, FULL_READING, SIXTY_COLUMNS);

    expect(rows[2]).toBe(`${" ".repeat(34)}≡ 72%   ◷ 48%   ▦ 59%${PANE_TOGGLE}`);
    expect(rows[3]).toBe(
      ` opus 5.5  high  …/paneline ${" ".repeat(6)}▰▰▰▰▱   ▰▰▱▱▱   ▰▰▰▱▱${PANE_TOGGLE}`,
    );
  });

  test("at 52 columns the 7d meter goes before the 5h meter and neither shows a reset time", async ($, on) => {
    const rows = await bandOf($, on, FULL_READING, 52);

    expect(rows[2]?.endsWith(`≡ 72%   ◷ 48%${PANE_TOGGLE}`)).toBe(true);
    expect(rows.join("\n")).not.toContain("▦");
    expect(rows.join("\n")).not.toContain("2h");
  });

  test("at 120 columns every meter keeps its reset time and the bars sit under the numbers", async ($, on) => {
    const rows = await bandOf($, on, FULL_READING, SHOT_COLUMNS);

    expect(rows[2]?.endsWith(`≡ 72%   ◷ 2h 48%   ▦ 3d 59%${PANE_TOGGLE}`)).toBe(true);
    expect(rows[3]).toBe(`${CHIPS}${" ".repeat(41)}▰▰▰▰▱   ▰▰▰▰▱▱▱▱   ▰▰▰▰▰▱▱▱${PANE_TOGGLE}`);
  });

  test("at 60 columns a 5h meter ahead of pace keeps its warning colour with the reset time hidden", async ($, on) => {
    const shown = await meterColoursIn(
      $,
      on,
      { ...FULL_READING, five: { percentUsed: 80, resetsInMs: 3 * HOUR_MS } },
      {},
      SIXTY_COLUMNS,
    );

    expect(colourOfPiece(shown, "◷ ")).toBe(GREY);
    expect(colourOfPiece(shown, "80%")).toBe(palette.alert);
  });

  test("R47 the 4h 18% and 6d 5% meters of the screenshot draw plain bars, no pace marker", async ($, on) => {
    const rows = await bandOf(
      $,
      on,
      {
        context: 72,
        five: { percentUsed: 18, resetsInMs: 4 * HOUR_MS + 18 * MINUTE_MS },
        seven: { percentUsed: 5, resetsInMs: 6 * DAY_MS + 23 * HOUR_MS },
      },
      WIDE,
    );

    expect(rows[2]?.endsWith(`≡ 72%   ◷ 4h 18%   ▦ 6d 5%${PANE_TOGGLE}`)).toBe(true);
    expect(rows[3]?.endsWith(`▰▰▰▰▱   ▰▱▱▱▱▱▱▱   ▱▱▱▱▱▱▱${PANE_TOGGLE}`)).toBe(true);
    expect(rows.join("\n")).not.toContain("┃");
  });

  test("R48 in a dark theme meters ahead of pace draw their percents in the warning colour", async ($, on) => {
    const shown = await meterColoursIn($, on, SCREENSHOT_READING, { theme: "dark" });

    expect(colourOfPiece(shown, "18%")).toBe(palette.alert);
    expect(colourOfPiece(shown, "5%")).toBe(palette.alert);
  });

  test("R49 in a light theme a meter ahead of pace draws its percent in the warning colour", async ($, on) => {
    const shown = await meterColoursIn($, on, SCREENSHOT_READING, { theme: "light" });

    expect(colourOfPiece(shown, "18%")).toBe(palette.alert);
    expect(colourOfPiece(shown, "5%")).toBe(palette.alert);
  });

  test("R50 a 5h meter exactly on pace keeps the accent colour for its percent", async ($, on) => {
    const shown = await meterColoursIn(
      $,
      on,
      { context: 72, five: { percentUsed: 40, resetsInMs: 3 * HOUR_MS } },
      {},
    );

    expect(colourOfPiece(shown, "40%")).toBe(GREY);
  });

  test("R51 a measure that lands while the start seed is written shows the measured share", async ($, on) => {
    const world = worldOf(on, { breakdownTokens: HALF_WINDOW_TOKENS });
    const release = world.holdBreakdown();
    await $.session.start(SESSION_START);
    release();
    await measure($, { context: 72 });
    await world.settle();

    const rows = screenRows(await mountBand($, WIDE), WIDE);

    expect(rows[2]?.endsWith(`≡ 72%${PANE_TOGGLE}`)).toBe(true);
  });

  test("R52 a measure that lands while the post-compact reseed waits shows the measured share", async ($, on) => {
    const world = worldOf(on, { breakdownTokens: HALF_WINDOW_TOKENS });
    await $.session.start(SESSION_START);
    await world.settle();
    await measure($, { context: 53 });
    world.setLiveTokens(TOKENS_PER_PERCENT * 53);
    await world.settle();
    await $.session.compact({ trigger: "manual", messages: [SUMMARY_MESSAGE] });
    await $.classic.SessionStart({ source: "compact" });
    await world.settle();
    world.setBreakdownTokens(TOKENS_PER_PERCENT * 24);
    world.setLiveTokens(undefined);
    const release = world.holdBreakdown();
    await mountBand($, WIDE);
    await world.settle();
    await measure($, { context: 31 });
    release();
    await world.settle();

    const rows = screenRows(await mountBand($, WIDE), WIDE);

    expect(rows[2]?.endsWith(`≡ 31%${PANE_TOGGLE}`)).toBe(true);
  });

  test("R53 a measure that lands while the start seed is written keeps the estimate out of the Sessions own row", async ($, on) => {
    const world = worldOf(on, { breakdownTokens: HALF_WINDOW_TOKENS, ownPid: OWN_PID });
    await $.classic.SessionStart({ source: "startup" });
    const release = world.holdBreakdown();
    await $.session.start(SESSION_START);
    release();
    await measure($, { context: MEASURED_PERCENT });
    await world.settle();

    expect(world.ownRowContexts()).toEqual([null, MEASURED_PERCENT]);
  });

  test("R54 a measure that changes only the rate limits leaves the start seed in place", async ($, on) => {
    const world = worldOf(on, { breakdownTokens: HALF_WINDOW_TOKENS });
    const release = world.holdBreakdown();
    await $.session.start(SESSION_START);
    release();
    await $.session.measure({
      context: { window: WINDOW, tokens: 10 * TOKENS_PER_PERCENT, percent: 10 },
      rateLimits: [{ kind: "five_hour", percentUsed: 30 }],
      changed: ["rateLimits"],
    });
    await world.settle();

    const rows = screenRows(await mountBand($, WIDE), WIDE);

    expect(rows[2]?.endsWith(`≡ 50%   ◷ 30%${PANE_TOGGLE}`)).toBe(true);
  });

  test("R55 a real context reading that lands while the start estimate is written stays in the Sessions own row", async ($, on) => {
    const world = worldOf(on, { breakdownTokens: HALF_WINDOW_TOKENS, ownPid: OWN_PID });
    await $.classic.SessionStart({ source: "startup" });
    const release = world.holdOwnRow(START_ESTIMATE_PERCENT);
    await $.session.start(SESSION_START);
    await world.settle();
    await measure($, { context: MEASURED_PERCENT });
    await world.settle();
    release();
    await world.settle();

    expect(world.ownRowContexts().at(-1)).toBe(MEASURED_PERCENT);
  });

  test("R56 a real context reading that lands while the post-compact estimate is written stays in the Sessions own row", async ($, on) => {
    const world = worldOf(on, { breakdownTokens: HALF_WINDOW_TOKENS, ownPid: OWN_PID });
    await $.classic.SessionStart({ source: "startup" });
    await $.session.start(SESSION_START);
    await world.settle();
    await measure($, { context: PRE_COMPACT_PERCENT });
    world.setLiveTokens(TOKENS_PER_PERCENT * PRE_COMPACT_PERCENT);
    await world.settle();
    await $.session.compact({ trigger: "manual", messages: [SUMMARY_MESSAGE] });
    await $.classic.SessionStart({ source: "compact" });
    await world.settle();
    world.setBreakdownTokens(TOKENS_PER_PERCENT * COMPACT_ESTIMATE_PERCENT);
    world.setLiveTokens(undefined);
    const release = world.holdOwnRow(COMPACT_ESTIMATE_PERCENT);
    await mountBand($, WIDE);
    await world.settle();
    await measure($, { context: COMPACT_MEASURED_PERCENT });
    await world.settle();
    release();
    await world.settle();

    expect(world.ownRowContexts().at(-1)).toBe(COMPACT_MEASURED_PERCENT);
  });

  test("PB1 at 0% the task bar is 5 cells under the ◆ text", async ($, on) => {
    const rows = await bandOf($, on, { context: 72 }, WIDE, { progress: ALL_PENDING });

    expect(rows[2]).toContain("◆ 0%");
    expect(barStartingAt(rows, "◆ 0%")).toHaveLength(TASK_BAR_CELLS);
  });

  test("PB1 at 5% the task bar is 5 cells under the ◆ text", async ($, on) => {
    const rows = await bandOf($, on, { context: 72 }, WIDE, {
      progress: { ...NO_TASKS, percent: 5 },
    });

    expect(rows[2]).toContain("◆ 5%");
    expect(barStartingAt(rows, "◆ 5%")).toHaveLength(TASK_BAR_CELLS);
  });

  test("PB1 at 60% the task bar is 5 cells under the ◆ text", async ($, on) => {
    const rows = await bandOf($, on, { context: 72 }, WIDE, { progress: THREE_OF_FIVE });

    expect(rows[2]).toContain("◆ 60%");
    expect(barStartingAt(rows, "◆ 60%")).toHaveLength(TASK_BAR_CELLS);
  });

  test("PB1 at 100% the task bar is 5 cells under the ◆ text", async ($, on) => {
    const rows = await bandOf($, on, { context: 72 }, WIDE, { progress: ALL_DONE });

    expect(rows[2]).toContain("◆ 100%");
    expect(barStartingAt(rows, "◆ 100%")).toHaveLength(TASK_BAR_CELLS);
  });

  test("PB2 at 0% the task bar shows no filled cell", async ($, on) => {
    const rows = await bandOf($, on, { context: 72 }, WIDE, { progress: ALL_PENDING });

    expect(barStartingAt(rows, "◆ 0%")).toBe("▱▱▱▱▱");
  });

  test("PB2 at 60% the task bar shows three filled cells of five", async ($, on) => {
    const rows = await bandOf($, on, { context: 72 }, WIDE, { progress: THREE_OF_FIVE });

    expect(barStartingAt(rows, "◆ 60%")).toBe("▰▰▰▱▱");
  });

  test("PB2 at 100% the task bar has no empty cell", async ($, on) => {
    const rows = await bandOf($, on, { context: 72 }, WIDE, { progress: ALL_DONE });

    expect(barStartingAt(rows, "◆ 100%")).toBe("▰▰▰▰▰");
  });

  test("PB3 at 100% the context, 5h and 7d texts and bars keep their places and widths", async ($, on) => {
    const rows = await bandOf($, on, FULL_READING, WIDE, { progress: ALL_DONE });

    expect(rows[2]?.endsWith(`◆ 100%   ≡ 72%   ◷ 2h 48%   ▦ 3d 59%${PANE_TOGGLE}`)).toBe(true);
    expect(barStartingAt(rows, "≡ 72%")).toBe("▰▰▰▰▱");
    expect(barStartingAt(rows, "◷ 2h 48%")).toBe("▰▰▰▰▱▱▱▱");
    expect(barStartingAt(rows, "▦ 3d 59%")).toBe("▰▰▰▰▰▱▱▱");
  });

  test("PB4 at 28 columns the ◆ meter stays with its percent, next to the context", async ($, on) => {
    const rows = await bandOf($, on, FULL_READING, 28, { progress: ALL_DONE });

    expect(rows[2]).toContain("◆ 100%   ≡ 72%");
  });

  test("PL3 at 5% the status row keeps every piece in its place as at 0%", async ($, on) => {
    const { before, after } = await rowsAtTwoPercents($, on, ALL_PENDING, {
      ...NO_TASKS,
      percent: 5,
    });

    expect(shapeOf(after[3] ?? "")).toBe(shapeOf(before[3] ?? ""));
    expect(after[2]?.indexOf("≡ 72%")).toBe(before[2]?.indexOf("≡ 72%"));
  });

  test("PL3 at 60% the status row keeps every piece in its place as at 0%", async ($, on) => {
    const { before, after } = await rowsAtTwoPercents($, on, ALL_PENDING, THREE_OF_FIVE);

    expect(shapeOf(after[3] ?? "")).toBe(shapeOf(before[3] ?? ""));
    expect(after[2]?.indexOf("≡ 72%")).toBe(before[2]?.indexOf("≡ 72%"));
  });

  test("PL3 at 100% the status row keeps every piece in its place as at 0%", async ($, on) => {
    const { before, after } = await rowsAtTwoPercents($, on, ALL_PENDING, ALL_DONE);

    expect(shapeOf(after[3] ?? "")).toBe(shapeOf(before[3] ?? ""));
    expect(after[2]?.indexOf("≡ 72%")).toBe(before[2]?.indexOf("≡ 72%"));
  });

  test("PL4 at 100% in a 120-column pane the task bar has five filled cells", async ($, on) => {
    const rows = await bandOf($, on, FULL_READING, SHOT_COLUMNS, { progress: ALL_DONE });

    expect(rows[2]).toContain("◆ 100%");
    expect(barStartingAt(rows, "◆ 100%")).toBe("▰▰▰▰▰");
  });

  test("R57 a 5h reset time that passes with no new message reads 0% with no time and an empty bar", async ($, on) => {
    const world = worldOf(on);
    await startWith($, world, {
      ...FULL_READING,
      five: { percentUsed: 85, resetsInMs: 10 * MINUTE_MS },
    });
    const band = await mountKeptBand($, WIDE);

    await world.clock.advance(10 * MINUTE_MS + 1);
    await world.settle();

    const rows = screenRows(await band.drawn(), WIDE);
    expect(rows[2]).toContain("≡ 72%   ◷ 0%   ▦ ");
    expect(rows[2]).not.toContain("◷ 10m");
    expect(rows[3]).toContain("▰▰▰▰▱   ▱▱▱▱   ");
  });

  test("R58 a 7d reset time that passes after the 5h reset reads 0% with no time and an empty bar", async ($, on) => {
    const world = worldOf(on);
    await startWith($, world, {
      context: 72,
      five: { percentUsed: 85, resetsInMs: 10 * MINUTE_MS },
      seven: { percentUsed: 59, resetsInMs: 2 * HOUR_MS },
    });
    const band = await mountKeptBand($, WIDE);

    await world.clock.advance(10 * MINUTE_MS + 1);
    await world.clock.advance(2 * HOUR_MS - 10 * MINUTE_MS);
    await world.settle();

    const rows = screenRows(await band.drawn(), WIDE);
    expect(rows[2]?.endsWith(`≡ 72%   ◷ 0%   ▦ 0%${PANE_TOGGLE}`)).toBe(true);
    expect(rows[3]?.endsWith(`▰▰▰▰▱   ▱▱▱▱   ▱▱▱▱${PANE_TOGGLE}`)).toBe(true);
  });

  test("R59 a 5h reset moved 30 minutes later repaints the row at the new reset time, not at the old one", async ($, on) => {
    const world = worldOf(on);
    const redraws = countedRedraws(on);
    await startWith($, world, {
      ...FULL_READING,
      five: { percentUsed: 85, resetsInMs: 10 * MINUTE_MS },
    });
    await mountKeptBand($, WIDE);
    await measure($, { five: { percentUsed: 85, resetsInMs: 40 * MINUTE_MS } });
    await world.settle();
    const before = redraws.count;

    await world.clock.advance(11 * MINUTE_MS);
    await world.settle();
    const repaintsBeforeNewReset = redraws.count - before;
    await world.clock.advance(30 * MINUTE_MS);
    await world.settle();

    expect(repaintsBeforeNewReset).toBe(0);
    expect(redraws.count - before).toBe(1);
  });

  test("R60 once both resets have passed, a row left open for another hour is not repainted", async ($, on) => {
    const world = worldOf(on);
    const redraws = countedRedraws(on);
    await startWith($, world, {
      context: 72,
      five: { percentUsed: 85, resetsInMs: 10 * MINUTE_MS },
      seven: { percentUsed: 59, resetsInMs: 2 * HOUR_MS },
    });
    await mountKeptBand($, WIDE);
    await world.clock.advance(3 * HOUR_MS);
    for (const context of [70, 71, 72]) {
      await measure($, { context });
      await world.settle();
    }
    const before = redraws.count;

    await world.clock.advance(HOUR_MS);
    await world.settle();

    expect(redraws.count - before).toBe(0);
  });
});

function shapeOf(row: string): string {
  return row.replace(BAR_CELLS, "#");
}

async function rowsAtTwoPercents(
  $: Engine,
  on: On,
  first: Progress,
  second: Progress,
): Promise<{ before: string[]; after: string[] }> {
  const world = worldOf(on, { progress: first });
  await startWith($, world, FULL_READING);
  const before = screenRows(await mountBand($, SHOT_COLUMNS), SHOT_COLUMNS);
  world.setProgress(second);
  const after = screenRows(await mountBand($, SHOT_COLUMNS), SHOT_COLUMNS);
  return { before, after };
}

function barStartingAt(rows: string[], text: string): string {
  const column = (rows[2] ?? "").indexOf(text);
  return LEADING_BAR.exec((rows[3] ?? "").slice(column))?.[0] ?? "";
}

async function bandOf(
  $: Engine,
  on: On,
  reading: Reading,
  columns: number,
  options: WorldOptions = {},
): Promise<string[]> {
  const world = worldOf(on, options);
  await startWith($, world, reading);
  return screenRows(await mountBand($, columns), columns);
}

async function startWith(
  $: Engine,
  world: { settle: () => Promise<void> },
  reading: Reading,
  transcriptPath?: string,
) {
  await $.session.start(SESSION_START);
  await measure($, reading);
  await $.classic.Stop({
    stop_hook_active: false,
    effort: { level: "high" },
    ...(transcriptPath === undefined ? {} : { transcript_path: transcriptPath }),
  });
  await world.settle();
}

function barsOf(pieces: { text: string }[]): string {
  return pieces
    .filter(({ text }) => ANY_BAR.test(text))
    .map(({ text }) => text)
    .join("");
}

function firstBar(rows: string[]): string {
  return (rows.at(-1) ?? "").match(BAR_CELLS)?.[0] ?? "";
}

async function meterColoursIn(
  $: Engine,
  on: On,
  reading: Reading,
  options: WorldOptions,
  columns = WIDE,
): Promise<{ text: string; color: unknown }[]> {
  const world = worldOf(on, options);
  await startWith($, world, reading);
  return meterPieces($, columns);
}

function colourOfPiece(pieces: { text: string; color: unknown }[], text: string): unknown {
  return pieces.find((piece) => piece.text === text)?.color;
}

function accentPieces(
  pieces: { text: string; color: unknown }[],
): { text: string; color: unknown }[] {
  return pieces.filter(({ color }) => color !== palette.alert);
}

async function meterPieces($: Engine, columns = WIDE): Promise<{ text: string; color: unknown }[]> {
  return colouredPieces(await mountBand($, columns)).filter(({ text }) =>
    ANY_METER_CELL.test(text),
  );
}

type WorldOptions = {
  cwd?: string;
  engineRow?: string;
  colorEntries?: string[];
  progress?: Progress;
  breakdownTokens?: number;
  holdFullBreakdown?: Promise<void>;
  savedLimits?: SavedLimit[];
  theme?: "dark" | "light";
  ownPid?: number;
};

type SavedLimit = { label: string; percent: number; resetsAt?: string };
const LIMITS_KEY = "usageLimits";

function themeRowOf(theme: "dark" | "light"): ConfigRow {
  return {
    key: "theme",
    label: "Theme",
    kind: "choice",
    value: theme,
    options: ["dark", "light"],
    provider: { plugin: "claude-code", tier: "builtin" },
    isLocked: false,
  };
}

function worldOf(on: On, options: WorldOptions = {}) {
  const clock = mock.clock(on, { now: NOW });
  const cwd = options.cwd ?? PROJECT;
  const engineRow = options.engineRow ?? "engine row";
  const colorEntries = options.colorEntries ?? [];
  let progress = options.progress ?? NO_TASKS;
  let breakdownTokens = options.breakdownTokens;
  let liveTokens: number | undefined;
  let heldBreakdown: Promise<void> | undefined;
  const stored = new Map<string, unknown>();
  if (options.savedLimits !== undefined) stored.set(LIMITS_KEY, options.savedLimits);
  mock.env(on, { HOME });
  on("session.id", () => ({ value: "s1" }));
  on("session.repo", () => ({ value: null }));
  on("session.root", () => ({ value: "/work" }));
  on("store.keys", () => ({ value: [...stored.keys()] }));
  on("store.delete", (_$, e) => {
    stored.delete(e.key);
    return { value: undefined };
  });
  on("config.list", () => ({
    value: options.theme === undefined ? [] : [themeRowOf(options.theme)],
  }));
  on("store.get", (_$, e) => ({ value: stored.get(e.key) }));
  on("store.set", (_$, e) => {
    stored.set(e.key, e.value);
    return { value: undefined };
  });
  on("state.get", (_$, e, next) =>
    (e.key as string) === "progress" ? { value: { value: progress, version: 1 } } : next(e),
  );
  on("session.model", () => ({ value: "claude-opus-5-5" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: cwd }));
  on("session.usage", async (_$, e) => {
    if (e.breakdown === "full") {
      await options.holdFullBreakdown;
      await heldBreakdown;
    }
    return {
      value: {
        startedAt: 0,
        context: {
          window: WINDOW,
          ...(liveTokens === undefined ? {} : { tokens: liveTokens }),
          breakdown: {
            autoCompactThreshold: WINDOW,
            ...(breakdownTokens === undefined ? {} : { totalTokens: breakdownTokens }),
          } as unknown as SessionContextBreakdown,
        },
        rateLimits: [],
      },
    };
  });
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("fs.list", () => ({ value: [] }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("command.register", () => ({ value: {} }) as never);
  on("classic.SessionStart", () => ({}));
  on("session.compact", () => ({ messages: [SUMMARY_MESSAGE] }));
  on("classic.UserPromptSubmit", () => ({}));
  on("classic.PostModelSwitch", () => ({}));
  on("classic.CwdChanged", () => ({}));
  on("classic.Stop", () => ({}));
  on("classic.PostToolUse", () => ({}));
  on("ui.render", { component: "AbovePrompt" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>{engineRow}</Text>;
  });
  const ownRowWrites: (number | null)[] = [];
  let ownRowHold: { ctx: number; released: Promise<void> } | undefined;
  on("fs.write", async (_$, e) => {
    if (e.path.endsWith(`/${options.ownPid}.json`)) {
      const { ctx } = JSON.parse(e.text) as { ctx: number | null };
      if (ownRowHold?.ctx === ctx) await ownRowHold.released;
      ownRowWrites.push(ctx);
    }
    return { value: undefined };
  });
  on(
    "process.run",
    (_$, e) =>
      ({
        value: {
          exitCode: colorEntries.length === 0 ? 1 : 0,
          stdout:
            options.ownPid !== undefined && e.argv[0] === "sh"
              ? `${options.ownPid}\n`
              : colorEntries
                  .map(
                    (agentColor) =>
                      `{"type":"agent-color","agentColor":"${agentColor}","sessionId":"s"}\n`,
                  )
                  .join(""),
          stderr: "",
        },
      }) as never,
  );
  return {
    clock,
    settle: async () => {
      await clock.settle();
      for (let turn = 0; turn < MICROTASK_TURNS; turn++) await Promise.resolve();
      await clock.settle();
    },
    setProgress: (next: Progress) => {
      progress = next;
    },
    setBreakdownTokens: (tokens: number) => {
      breakdownTokens = tokens;
    },
    holdBreakdown: () => {
      let release: () => void = () => undefined;
      heldBreakdown = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    holdOwnRow: (ctx: number) => {
      let release: () => void = () => undefined;
      ownRowHold = {
        ctx,
        released: new Promise<void>((resolve) => {
          release = resolve;
        }),
      };
      return release;
    },
    setLiveTokens: (tokens: number | undefined) => {
      liveTokens = tokens;
    },
    stored: (key: string) => stored.get(key),
    ownRowContexts: () => ownRowWrites,
  };
}

function measure($: Engine, reading: Reading) {
  const limit = (kind: string, value: Limit | undefined) =>
    value === undefined
      ? []
      : [
          {
            kind,
            percentUsed: value.percentUsed,
            ...(value.resetsInMs === undefined
              ? {}
              : { resetsAt: new Date(NOW + value.resetsInMs).toISOString() }),
          },
        ];
  return $.session.measure({
    context:
      reading.context === undefined
        ? { window: WINDOW }
        : {
            window: WINDOW,
            tokens: reading.context * TOKENS_PER_PERCENT,
            percent: reading.context,
          },
    rateLimits: [...limit("five_hour", reading.five), ...limit("seven_day", reading.seven)],
    changed: ["context", "rateLimits"],
  });
}

async function mountBand($: Engine, columns: number) {
  return (await mountKeptBand($, columns)).drawn();
}

function countedRedraws(on: On): { count: number } {
  const redraws = { count: 0 };
  on("ui.invalidate", () => {
    redraws.count += 1;
    return { value: undefined };
  });
  return redraws;
}

async function mountKeptBand($: Engine, columns: number) {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "AbovePrompt",
    props: {
      hasSurvey: false,
      isCollapsed: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns: columns,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
    viewport: { columns, rows: 40 },
  });
}
