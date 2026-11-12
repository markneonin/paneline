import { describe, expect, test } from "claude-code/testing";

import {
  API_KEY,
  BEFORE_TRACKING,
  CACHE_TITLE,
  OPUS,
  OTHER_SESSION_ID,
  SESSION_ID,
  SONNET,
  agentOwner,
  blocks,
  missCaptionOf,
  centsOf,
  clearSession,
  lines,
  mainTurn,
  missesOf,
  ownersOf,
  reloadPlugin,
  setSessionCost,
  spendPane,
  splitOf,
  startFreshSession,
  toCents,
  totalsOf,
  worldOf,
} from "./spend-world";
import type { Engine } from "claude-code/testing";
import type { World } from "./spend-world";

const MAIN_OPUS_4_USD = 1_000_000;
const AGENT_SONNET_2_USD = 1_000_000;
const SIX_DOLLARS = 6;
const TEN_DOLLARS = 10;
const CONTEXT = 100_000;
const REBUILD = 80_000;
const CONTEXT_AFTER_REBUILD = 102_000;
const CONTEXT_AFTER_SECOND_REBUILD = 104_000;
const SPLIT_BEFORE_RELOAD = [
  ["main · opus 5.5", "~$4.00", "67%"],
  ["implementer", "~$2.00", "33%"],
];

describe("spend after a plugin reload", () => {
  test("H1 after a reload and the next cost update the split is the same as before: main ~$4.00 67% and implementer ~$2.00 33%", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sixTrackedDollars($, world);

    await reloadPlugin($, world);
    await setSessionCost($, world, SIX_DOLLARS);

    expect(await splitOf(await spendPane($))).toEqual(SPLIT_BEFORE_RELOAD);
  });

  test("H2 turns after a reload add to the split from before it: main ~$8.00 80% and implementer ~$2.00 20%, adding up to the top $10.00", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sixTrackedDollars($, world);

    await reloadPlugin($, world);
    await mainTurn($, world, { model: OPUS, tokens: { input: MAIN_OPUS_4_USD } });
    await setSessionCost($, world, TEN_DOLLARS);

    const pane = await spendPane($);
    expect(await splitOf(pane)).toEqual([
      ["main · opus 5.5", "~$8.00", "80%"],
      ["implementer", "~$2.00", "20%"],
    ]);
    expect(centsOf(ownersOf((await blocks(pane))["Where it went"]))).toBe(
      toCents(totalsOf(await lines(pane))?.usd ?? null),
    );
  });

  test("H3 cache numbers from before a reload stay: after one more miss the summary says 2 misses and ~$0.75 lost, both are listed and 28% is read from cache", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await startFreshSession($, world);
    await mainTurn($, world, { model: OPUS, tokens: { write: CONTEXT }, context: CONTEXT });
    await mainTurn($, world, {
      model: OPUS,
      tokens: { write: REBUILD },
      context: CONTEXT_AFTER_REBUILD,
    });

    await reloadPlugin($, world);
    await mainTurn($, world, {
      model: OPUS,
      tokens: { read: CONTEXT, write: REBUILD },
      context: CONTEXT_AFTER_SECOND_REBUILD,
    });
    await setSessionCost($, world, SIX_DOLLARS);

    const pane = await spendPane($);
    const cache = (await blocks(pane))[CACHE_TITLE];
    expect(missCaptionOf(await lines(pane))).toEqual({ misses: "2 misses", lost: "~$0.75" });
    expect(missesOf(cache).map((miss) => [miss.cause, miss.tokens])).toEqual([
      ["cache rebuilt", "78k"],
      ["cache rebuilt", "78k"],
    ]);
    expect(totalsOf(await lines(pane))?.hit).toBe("28%");
  });

  test("H4 once turns are tracked the plugin store holds something under the session id", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sixTrackedDollars($, world);

    expect(JSON.stringify([...world.store])).toContain(SESSION_ID);
  });

  test("H5 a different session id after the reload does not get the first session's split: it shows its own $5 as before tracking", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sixTrackedDollars($, world);

    world.session = OTHER_SESSION_ID;
    await reloadPlugin($, world);
    await setSessionCost($, world, 5);

    expect(await splitOf(await spendPane($))).toEqual([[BEFORE_TRACKING, "~$5.00", "100%"]]);
  });

  test("H6 two sessions that took turns still each get their own split back: the first session after returning shows main ~$4.00 and implementer ~$2.00", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sixTrackedDollars($, world);
    world.session = OTHER_SESSION_ID;
    await reloadPlugin($, world);
    await startFreshSession($, world);
    await mainTurn($, world, { model: OPUS, tokens: { input: MAIN_OPUS_4_USD } });

    world.session = SESSION_ID;
    await reloadPlugin($, world);
    await setSessionCost($, world, SIX_DOLLARS);

    expect(await splitOf(await spendPane($))).toEqual(SPLIT_BEFORE_RELOAD);
  });

  test("H7 after /clear a reload brings back only the turns tracked since the clear: main ~$4.00 at 100%, no implementer", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sixTrackedDollars($, world);
    await clearSession($, world);
    await startFreshSession($, world);
    await mainTurn($, world, { model: OPUS, tokens: { input: MAIN_OPUS_4_USD } });

    await reloadPlugin($, world);
    await setSessionCost($, world, 4);

    expect(await splitOf(await spendPane($))).toEqual([["main · opus 5.5", "~$4.00", "100%"]]);
  });

  test("H8 a store entry that cannot be read as a split is ignored at load and does not stop later turns from surviving a reload", async ($, on) => {
    const world = worldOf(on, API_KEY);
    world.isStoreCorruptUntilWritten = true;
    await reloadPlugin($, world);
    await sixTrackedDollars($, world);

    await reloadPlugin($, world);
    await setSessionCost($, world, SIX_DOLLARS);

    expect(await splitOf(await spendPane($))).toEqual(SPLIT_BEFORE_RELOAD);
  });
});

async function sixTrackedDollars($: Engine, world: World): Promise<void> {
  await startFreshSession($, world);
  await mainTurn($, world, { model: OPUS, tokens: { input: MAIN_OPUS_4_USD } });
  await agentOwner($, world, "implementer", SONNET, { input: AGENT_SONNET_2_USD });
  await setSessionCost($, world, SIX_DOLLARS);
}
