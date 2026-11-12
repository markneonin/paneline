import { describe, expect, test } from "claude-code/testing";
import type { SessionContextBreakdown } from "claude-code";

import { palette } from "../hooks/palette";
import { textOf } from "./draw-tree";
import {
  MS_PER_MINUTE,
  NARROW_COLUMNS,
  OPUS,
  SUBSCRIPTION,
  TURN_MS,
  WIDE_COLUMNS,
  compact,
  lines,
  mainTurn,
  setSessionCost,
  settle,
  spendPane,
  startFreshSession,
  totalsOf,
  worldOf,
} from "./spend-world";
import type { Pane, World } from "./spend-world";

const HOUR_MS = 60 * MS_PER_MINUTE;
const ONE_MINUTE_MS = MS_PER_MINUTE;
const SIZE = 100_000;
const MESSAGES = 80_000;
const BASE = SIZE - MESSAGES;
const SUMMARY_TOKENS = 2_000;
const OPUS_INPUT = 4;
const OPUS_OUTPUT = 20;
const OPUS_WRITE_ONE_HOUR = 8;
const PER_MILLION = 1_000_000;
const SMALL_TURN = { write: 20_000 };
const COLD_ROW = "cache cold · 0 misses · $0.00 lost";
const CHEAPEST = "cheapest";
const CHEAPEST_MARK = `· ${CHEAPEST}`;
const OPTION_ROW = /^ *(keep going|compact|clear)\s+(?:(· cheapest)\s+)?~\$(\d+\.\d{2})\s*$/;
const OPTIONS_CAPTION = "cache cold · 0 misses · $0.00 lost · price of the next turn";
const OPTION_INDENT_CELLS = 2;
const KEEP_GOING = SIZE * OPUS_WRITE_ONE_HOUR;
const COMPACT =
  SIZE * OPUS_INPUT + SUMMARY_TOKENS * OPUS_OUTPUT + (BASE + SUMMARY_TOKENS) * OPUS_WRITE_ONE_HOUR;
const CLEAR = BASE * OPUS_WRITE_ONE_HOUR;
const BREAKDOWN = {
  categories: [
    { name: "System prompt", tokens: BASE, color: "text", kind: "used" },
    { name: "Messages", tokens: MESSAGES, color: "text", kind: "used" },
    { name: "Free space", tokens: 100_000, color: "text", kind: "free" },
  ],
  totalTokens: SIZE,
  maxTokens: 200_000,
  rawMaxTokens: 200_000,
  percentage: 50,
  model: "Opus 5.5",
  gridRows: [],
  memoryFiles: [],
  mcpTools: [],
  agents: [],
  skills: { totalSkills: 0, includedSkills: 0, tokens: 0, skillFrontmatter: [] },
  isAutoCompactEnabled: true,
} as unknown as SessionContextBreakdown;

describe("spend options for the next turn on a cold cache", () => {
  test("C1 a warm cache shows no options, a cold one shows compact, clear and keep going as rows with the prices in one right column, the cheapest marked in the muted ink", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    await sessionWithMainTurn($, world);
    const pane = await spendPane($);
    const warm = await optionRows(pane);
    await world.clock.advance(HOUR_MS + ONE_MINUTE_MS);
    await settle(pane);
    const rows = await optionRows(pane);

    expect(warm).toEqual([]);
    expect(rows.map((row) => OPTION_ROW.exec(row.text)?.slice(1))).toEqual([
      ["compact", undefined, dollars(COMPACT)],
      ["clear", "· cheapest", dollars(CLEAR)],
      ["keep going", undefined, dollars(KEEP_GOING)],
    ]);
    await expectPricesInOneColumn(pane);
    const marked = rows.filter((row) => row.text.includes(CHEAPEST_MARK));
    const markedParts = marked[0]?.parts.filter((part) => textOf(part) === CHEAPEST_MARK) ?? [];
    expect(marked).toHaveLength(1);
    expect(markedParts.map((part) => part.props?.color)).toEqual([palette.muted]);
    expect(markedParts.some((part) => part.props?.weight === "semibold")).toBe(false);
    expect(marked[0]?.parts.some((part) => part.props?.color === palette.ok)).toBe(false);
  });

  test("C2 before any main turn no options show, and right after a compaction none show either", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    await startFreshSession($, world);
    await setSessionCost($, world, 1);
    world.breakdown = BREAKDOWN;
    const pane = await spendPane($);
    const before = await optionRows(pane);
    await sessionWithMainTurn($, world);
    await world.clock.advance(HOUR_MS + ONE_MINUTE_MS);
    await compact($, world);
    await settle(pane);

    expect(before).toEqual([]);
    expect(await optionRows(pane)).toEqual([]);
  });

  test("C3 a cold clock with a main turn running shows no options", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    on("turn.start", (_$, e) => ({ turnId: e.turnId }));
    await sessionWithMainTurn($, world);
    await world.clock.advance(HOUR_MS + ONE_MINUTE_MS);
    const pane = await spendPane($);
    await $.turn.start({ text: "go", turnId: "long-turn" });
    await settle(pane);

    expect(await optionRows(pane)).toEqual([]);
    expect((await lines(pane)).some((line) => line.text === COLD_ROW)).toBe(true);
  });

  test("C4 the pane turns cold and shows the options by itself when the cache lifetime ends", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    await sessionWithMainTurn($, world);
    const pane = await spendPane($);
    await world.clock.advance(HOUR_MS - ONE_MINUTE_MS - TURN_MS);
    const warm = await optionRows(pane);
    await world.clock.advance(ONE_MINUTE_MS + TURN_MS);

    expect(warm).toEqual([]);
    expect((await lines(pane)).some((line) => line.text === OPTIONS_CAPTION)).toBe(true);
    expect(await optionRows(pane)).toHaveLength(3);
  });

  test("C5 at 60 columns the options show their caption, indent two cells, and the three prices end in one column", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    await sessionWithMainTurn($, world);
    await world.clock.advance(HOUR_MS + ONE_MINUTE_MS);

    await expectOptionsLayout(await spendPane($, NARROW_COLUMNS));
  });

  test("C6 at 120 columns the options show their caption, indent two cells, and the three prices end in one column", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    await sessionWithMainTurn($, world);
    await world.clock.advance(HOUR_MS + ONE_MINUTE_MS);

    await expectOptionsLayout(await spendPane($, WIDE_COLUMNS));
  });
});

async function sessionWithMainTurn($: Parameters<typeof startFreshSession>[0], world: World) {
  world.breakdown = BREAKDOWN;
  await startFreshSession($, world);
  await mainTurn($, world, { model: OPUS, tokens: SMALL_TURN, context: SIZE });
  await setSessionCost($, world, 1);
}

async function optionRows(pane: Pane) {
  return (await lines(pane)).filter((line) => OPTION_ROW.test(line.text));
}

async function expectOptionsLayout(pane: Pane): Promise<void> {
  const shown = await lines(pane);
  const rows = shown.filter((line) => OPTION_ROW.test(line.text));
  expect(shown.some((line) => line.text === OPTIONS_CAPTION)).toBe(true);
  const drawn = rows.map((row) => row.parts.map(textOf).join(""));
  expect(drawn.map((text) => /^ */.exec(text)?.[0].length)).toEqual([
    OPTION_INDENT_CELLS,
    OPTION_INDENT_CELLS,
    OPTION_INDENT_CELLS,
  ]);
  await expectPricesInOneColumn(pane);
}

async function expectPricesInOneColumn(pane: Pane): Promise<void> {
  const shown = await lines(pane);
  const rows = shown.filter((line) => OPTION_ROW.test(line.text));
  expect(rows).toHaveLength(3);
  expect(new Set(rows.map((row) => row.edge))).toEqual(new Set([totalsOf(shown)?.values.edge]));
}

function dollars(tokenCosts: number): string {
  return (tokenCosts / PER_MILLION).toFixed(2);
}
