import { describe, expect, test } from "claude-code/testing";

import {
  API_KEY,
  CACHE_TITLE,
  OPUS,
  RENT_TITLE,
  SPLIT_TITLE,
  blocks,
  clearSession,
  compact,
  hasNoSpendNote,
  lines,
  mainTurn,
  missesOf,
  ownersOf,
  readFile,
  rentRowsOf,
  setSessionCost,
  startFreshSession,
  spendPane,
  totalsOf,
  worldOf,
} from "./spend-world";
import type { Engine } from "claude-code/testing";
import type { World } from "./spend-world";

const SUBAGENT = "agent-1";
const CONTEXT = 100_000;
const MAIN_INPUT = 750_000;
const SESSION_COST = 4;

describe("spend after compaction and clear", () => {
  test("X1 after /compact the tool-result list is empty while the top USD and the split rows stay", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await spentSessionWithRead($, world);

    await compact($, world);

    const pane = await spendPane($);
    const found = await blocks(pane);
    expect(found[RENT_TITLE]).toBeUndefined();
    expect(totalsOf(await lines(pane))?.usd).toBe("$4.00");
    expect(ownersOf(found[SPLIT_TITLE]).map((owner) => owner.name)).toEqual([
      "main · opus 5.5",
      "background",
    ]);
  });

  test("X2 after /clear and the engine's reset to $0 there is no spend, no owner rows, no cache data and no tool results", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await spentSessionWithRead($, world);
    await mainTurn($, world, { model: OPUS, tokens: { write: 80_000 }, context: 102_000 });

    await clearSession($, world);
    await setSessionCost($, world, 0);

    const pane = await spendPane($);
    const found = await blocks(pane);
    expect(hasNoSpendNote(await lines(pane))).toBe(true);
    expect(ownersOf(found[SPLIT_TITLE])).toEqual([]);
    expect(found[CACHE_TITLE]).toBeUndefined();
    expect(found[RENT_TITLE]).toBeUndefined();
  });

  test("X3 a compaction a subagent ran on its own leaves the tool-result list unchanged", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await spentSessionWithRead($, world);

    await compact($, world, SUBAGENT);

    const block = (await blocks(await spendPane($)))[RENT_TITLE];
    expect(rentRowsOf(block).map((row) => [row.tool, row.size])).toEqual([["Read", "1k"]]);
  });

  test("X4 after a subagent's own compaction a big main rebuild reads cache rebuilt, not after compaction", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { write: CONTEXT }, context: CONTEXT });
    await compact($, world, SUBAGENT);

    await mainTurn($, world, { model: OPUS, tokens: { write: 80_000 }, context: 102_000 });

    const block = (await blocks(await spendPane($)))[CACHE_TITLE];
    expect(missesOf(block).map((miss) => miss.cause)).toEqual(["cache rebuilt"]);
  });
});

async function spentSessionWithRead($: Engine, world: World): Promise<void> {
  await startFreshSession($, world);
  await mainTurn($, world, { model: OPUS, tokens: { input: MAIN_INPUT }, context: CONTEXT });
  await readFile($, world, "/work/a.ts", 4_000);
  await setSessionCost($, world, SESSION_COST);
}
