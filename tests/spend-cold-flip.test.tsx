import { describe, expect, test } from "claude-code/testing";
import type { On, SessionContextBreakdown } from "claude-code";
import type { Engine } from "claude-code/testing";

import {
  MS_PER_MINUTE,
  OPUS,
  SESSION_ID,
  SUBSCRIPTION,
  compact,
  lines,
  mainTurn,
  setSessionCost,
  settle,
  spendPane,
  startFreshSession,
  worldOf,
} from "./spend-world";
import type { Pane, World } from "./spend-world";

const HOUR_MS = 60 * MS_PER_MINUTE;
const ONE_MINUTE_MS = MS_PER_MINUTE;
const ONE_SECOND_MS = 1_000;
const SIZE = 100_000;
const MESSAGES = 80_000;
const MANY_RENDERS = 12;
const WORK = "/work";
const SPEND_SESSIONS_KEY = "spendSessions";
const OPTION_ROW = /^ *(keep going|compact|clear)\s+(?:(· cheapest)\s+)?~\$\d+\.\d{2}\s*$/;
const WARM_CAPTION = /^cache warm until \d{2}:\d{2}$/;
const NO_MISSES = " · 0 misses · $0.00 lost";
const COLD_CAPTION = `cache cold${NO_MISSES}`;
const OPTIONS_CAPTION = "cache cold · price of the next turn";
const COMPACTED_CAPTION = `cache cold · compacted${NO_MISSES}`;
const BREAKDOWN = {
  categories: [
    { name: "System prompt", tokens: SIZE - MESSAGES, color: "text", kind: "used" },
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

describe("spend cold flip and options after a compaction", () => {
  test("D1 a warm Spend restored from a saved session, with no turn finished since the reload, turns cold by itself when the cache lifetime ends", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    const pane = await warmPaneAfterReload($, world);
    await world.clock.advance(HOUR_MS - ONE_MINUTE_MS);
    const warm = await captions(pane);
    await world.clock.advance(ONE_MINUTE_MS + ONE_SECOND_MS);

    expect(warm.some((text) => WARM_CAPTION.test(text))).toBe(true);
    expect(await captions(pane)).toContain(OPTIONS_CAPTION);
    expect(await optionRows(pane)).toHaveLength(3);
  });

  test("D2 a warm Spend redrawn many times asks for exactly one redraw at the deadline, not one per render", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    const redraws = countedRedraws(on);
    const pane = await warmPaneAfterReload($, world);
    for (let render = 0; render < MANY_RENDERS; render++) await settle(pane);
    const before = redraws.count;

    await world.clock.advance(HOUR_MS + ONE_SECOND_MS);

    expect(redraws.count - before).toBe(1);
  });

  test("D3 right after a compaction on a cold cache Spend shows `cache cold · compacted` with its miss part and no option rows", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    await sessionWithMainTurn($, world);
    await world.clock.advance(HOUR_MS + ONE_MINUTE_MS);
    const pane = await spendPane($);

    await compact($, world);
    await settle(pane);

    expect(await captions(pane)).toContain(COMPACTED_CAPTION);
    expect(await optionRows(pane)).toEqual([]);
  });

  test("D4 a cold cache with no context measure keeps the plain `cache cold` caption with its miss part", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    await sessionWithMainTurn($, world);
    world.breakdown = undefined;
    await world.clock.advance(HOUR_MS + ONE_MINUTE_MS);

    const shown = await captions(await spendPane($));

    expect(shown).toContain(COLD_CAPTION);
    expect(shown).not.toContain(COMPACTED_CAPTION);
  });

  test("D5 a cold cache shows the rows in the order compact, clear, keep going", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    await sessionWithMainTurn($, world);
    await world.clock.advance(HOUR_MS + ONE_MINUTE_MS);

    const rows = await optionRows(await spendPane($));

    expect(rows.map((row) => OPTION_ROW.exec(row)?.[1])).toEqual([
      "compact",
      "clear",
      "keep going",
    ]);
  });
});

async function sessionWithMainTurn($: Engine, world: World): Promise<void> {
  world.breakdown = BREAKDOWN;
  await startFreshSession($, world);
  await mainTurn($, world, { model: OPUS, tokens: { write: 20_000 }, context: SIZE });
  await setSessionCost($, world, 1);
}

async function warmPaneAfterReload($: Engine, world: World): Promise<Pane> {
  world.breakdown = BREAKDOWN;
  world.store.set(SPEND_SESSIONS_KEY, {
    [SESSION_ID]: {
      mainMemory: { model: OPUS, endedAt: world.clock.now(), size: SIZE, ttl: "1h" },
      baselineUsd: 0,
      isCompacted: false,
    },
  });
  await $.session.start({ cwd: WORK, surface: "terminal", isInteractive: true });
  await setSessionCost($, world, 1);
  return spendPane($);
}

function countedRedraws(on: On): { count: number } {
  const redraws = { count: 0 };
  on("ui.invalidate", () => {
    redraws.count += 1;
    return { value: undefined };
  });
  return redraws;
}

async function captions(pane: Pane): Promise<string[]> {
  return (await lines(pane)).map((line) => line.text);
}

async function optionRows(pane: Pane): Promise<string[]> {
  return (await captions(pane)).filter((text) => OPTION_ROW.test(text));
}
