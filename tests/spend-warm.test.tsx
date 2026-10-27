import { describe, expect, test } from "claude-code/testing";

import {
  HIT_LABEL,
  MS_PER_MINUTE,
  OPUS,
  SUBSCRIPTION,
  TURN_MS,
  agentOwner,
  clockText,
  isAllMuted,
  lines,
  mainTurn,
  setSessionCost,
  settle,
  spendPane,
  startFreshSession,
  switchModel,
  totalsOf,
  worldOf,
} from "./spend-world";
import type { Pane, World } from "./spend-world";

const COST = 1;
const HOUR_MS = 60 * MS_PER_MINUTE;
const FIVE_MINUTES_MS = 5 * MS_PER_MINUTE;
const ONE_MINUTE_MS = MS_PER_MINUTE;
const WARM_ROW = /^cache warm until (\d{2}:\d{2})$/;
const COLD_ROW = "cache cold";
const CACHE_ROW = /^cache (?:warm until \d{2}:\d{2}|cold)$/;
const SMALL_TURN = { write: 20_000 };

describe("spend cache label and warm-until row", () => {
  test("W1 the hit tile says it counts all agents: its label reads 'from cache · all agents'", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    await sessionWithMainTurn($, world);

    const totals = totalsOf(await lines(await spendPane($)));

    expect(totals?.labels.text).toBe(`this session ${HIT_LABEL} tool results`);
  });

  test("W2 one minute before the 1 hour cache lifetime ends the totals show 'cache warm until' the turn end plus one hour, in muted 24-hour local time", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    const endedAt = await sessionWithMainTurn($, world);
    await world.clock.advance(HOUR_MS - ONE_MINUTE_MS - TURN_MS);

    const row = await cacheRowOf(await spendPane($));

    expect(row?.text).toBe(`cache warm until ${clockText(endedAt + HOUR_MS)}`);
    expect(isAllMuted(row)).toBe(true);
  });

  test("W3 one minute after the 1 hour cache lifetime ends the totals show 'cache cold' in muted", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    await sessionWithMainTurn($, world);
    await world.clock.advance(HOUR_MS + ONE_MINUTE_MS);

    const row = await cacheRowOf(await spendPane($));

    expect(row?.text).toBe(COLD_ROW);
    expect(isAllMuted(row)).toBe(true);
  });

  test("W4 with a 5 minute cache lifetime the cache is warm until the turn end plus five minutes and cold after ten minutes", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    await switchModel($, world, OPUS, "5m");
    const endedAt = await sessionWithMainTurn($, world);
    await world.clock.advance(ONE_MINUTE_MS);
    const pane = await spendPane($);
    const warm = (await cacheRowOf(pane))?.text;
    await world.clock.advance(FIVE_MINUTES_MS + FIVE_MINUTES_MS);
    await settle(pane);
    const cold = (await cacheRowOf(pane))?.text;

    expect(warm).toBe(`cache warm until ${clockText(endedAt + FIVE_MINUTES_MS)}`);
    expect(cold).toBe(COLD_ROW);
  });

  test("W5 a session with only agent work shows no cache row until the first main turn, then shows it", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    await startFreshSession($, world);
    await agentOwner($, world, "implementer", OPUS, SMALL_TURN);
    await setSessionCost($, world, COST);
    const pane = await spendPane($);
    const before = await cacheRowOf(pane);
    await mainTurn($, world, { model: OPUS, tokens: SMALL_TURN });
    await settle(pane);
    const after = await cacheRowOf(pane);

    expect(before).toBeUndefined();
    expect(after?.text).toMatch(WARM_ROW);
  });
});

async function sessionWithMainTurn($: Parameters<typeof startFreshSession>[0], world: World) {
  await startFreshSession($, world);
  const endedAt = await mainTurn($, world, { model: OPUS, tokens: SMALL_TURN });
  await setSessionCost($, world, COST);
  return endedAt;
}

async function cacheRowOf(pane: Pane) {
  return (await lines(pane)).find((line) => CACHE_ROW.test(line.text));
}
