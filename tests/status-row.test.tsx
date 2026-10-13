import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

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
const WIDE = 200;
const CHIPS = " opus 5.5  high  ~/workspace/projects/paneline ";
const BAR_CELLS = /[▰▱]+/g;
const COLUMN_TEXTS = /[≡◷▦][^≡◷▦]*?\d+%/g;
const ANY_BAR = /[▰▱]/;
const ANY_METER_CELL = /[≡◷▦▰▱%]/;
const OLD_LOOK = /ctx|5h|7d|↺|[▁▂▃▄▅▆▇█]/;

type Limit = { percentUsed: number; resetsInMs?: number };
type Reading = { context?: number; five?: Limit; seven?: Limit };

const FULL_BARS = "▰▰▰▰▱▰▰▰▰▱▱▱▱▰▰▰▰▰▱▱▱";
const FULL_READING: Reading = {
  context: 72,
  five: { percentUsed: 48, resetsInMs: 2 * HOUR_MS },
  seven: { percentUsed: 59, resetsInMs: 3 * DAY_MS },
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
    expect(new Set(shown.map(({ color }) => color))).toEqual(new Set([GREY]));
  });

  test("R9 after /color red every piece of the meter block is red", async ($, on) => {
    const world = worldOf(on, { colorEntries: ["red"] });
    await startWith($, world, FULL_READING, TRANSCRIPT);

    const shown = await meterPieces($);

    expect(shown.map(({ text }) => text).join("")).toContain("≡ 72%");
    expect(shown.map(({ text }) => text).join("")).toContain("◷ 2h 48%");
    expect(shown.map(({ text }) => text).join("")).toContain("▦ 3d 59%");
    expect(barsOf(shown)).toBe(FULL_BARS);
    expect(new Set(shown.map(({ color }) => color))).toEqual(new Set([RED]));
  });

  test("R19 after /color red at 90% and above the whole meter block stays red", async ($, on) => {
    const world = worldOf(on, { colorEntries: ["red"] });
    await startWith($, world, HIGH_READING, TRANSCRIPT);

    const shown = await meterPieces($);

    expect(shown.map(({ text }) => text).join("")).toContain("≡ 95%");
    expect(shown.map(({ text }) => text).join("")).toContain("◷ 2h 92%");
    expect(shown.map(({ text }) => text).join("")).toContain("▦ 3d 97%");
    expect(barsOf(shown)).toBe(HIGH_BARS);
    expect(new Set(shown.map(({ color }) => color))).toEqual(new Set([RED]));
  });

  test("R20 by default at 90% and above the whole meter block stays grey", async ($, on) => {
    const world = worldOf(on);
    await startWith($, world, HIGH_READING);

    const shown = await meterPieces($);

    expect(shown.map(({ text }) => text).join("")).toContain("≡ 95%");
    expect(shown.map(({ text }) => text).join("")).toContain("◷ 2h 92%");
    expect(shown.map(({ text }) => text).join("")).toContain("▦ 3d 97%");
    expect(barsOf(shown)).toBe(HIGH_BARS);
    expect(new Set(shown.map(({ color }) => color))).toEqual(new Set([GREY]));
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

  test("R18 a folder name longer than the row is cut from its start and the context percent still shows", async ($, on) => {
    const rows = await bandOf($, on, FULL_READING, 56, { cwd: `${HOME}/${"x".repeat(60)}` });

    expect(Math.max(...rows.map((row) => row.length))).toBe(56);
    expect(rows.join("\n")).toContain("…xxx");
    expect(rows.join("\n")).toContain("≡ 72%");
  });
});

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

async function meterPieces($: Engine): Promise<{ text: string; color: unknown }[]> {
  return colouredPieces(await mountBand($, WIDE)).filter(({ text }) => ANY_METER_CELL.test(text));
}

type WorldOptions = { cwd?: string; engineRow?: string; colorEntries?: string[] };

function worldOf(on: On, options: WorldOptions = {}) {
  const clock = mock.clock(on, { now: NOW });
  const cwd = options.cwd ?? PROJECT;
  const engineRow = options.engineRow ?? "engine row";
  const colorEntries = options.colorEntries ?? [];
  mock.env(on, { HOME });
  on("session.model", () => ({ value: "claude-opus-5-5" }));
  on("session.cwd", () => ({ value: cwd }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("command.register", () => ({ value: {} }) as never);
  on("classic.SessionStart", () => ({}));
  on("classic.UserPromptSubmit", () => ({}));
  on("classic.PostModelSwitch", () => ({}));
  on("classic.CwdChanged", () => ({}));
  on("classic.Stop", () => ({}));
  on("classic.PostToolUse", () => ({}));
  on("ui.render", { component: "AbovePrompt" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>{engineRow}</Text>;
  });
  on(
    "process.run",
    () =>
      ({
        value: {
          exitCode: colorEntries.length === 0 ? 1 : 0,
          stdout: colorEntries
            .map(
              (agentColor) =>
                `{"type":"agent-color","agentColor":"${agentColor}","sessionId":"s"}\n`,
            )
            .join(""),
          stderr: "",
        },
      }) as never,
  );
  return { settle: () => clock.settle() };
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
        ? { window: 200_000 }
        : { window: 200_000, percent: reading.context },
    rateLimits: [...limit("five_hour", reading.five), ...limit("seven_day", reading.seven)],
    changed: ["context", "rateLimits"],
  });
}

async function mountBand($: Engine, columns: number) {
  const band = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "AbovePrompt",
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns: columns,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
    viewport: { columns, rows: 40 },
  });
  return band.drawn();
}
