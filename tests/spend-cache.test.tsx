import { describe, expect, test } from "claude-code/testing";

import {
  API_KEY,
  CACHE_TITLE,
  HAIKU,
  OPUS,
  SONNET,
  UNPRICED,
  agentRequest,
  blocks,
  cacheSummaryOf,
  clockText,
  compact,
  lines,
  mainTurn,
  missesOf,
  setSessionCost,
  spawnAgent,
  spendPane,
  totalsOf,
  worldOf,
} from "./spend-world";
import type { Miss, Pane } from "./spend-world";

const CONTEXT = 100_000;
const SESSION_COST = 10;
const SEVEN_MINUTES = 7;

describe("spend cache summary and misses", () => {
  test("C1 main and an agent reading from cache show 90% from cache in the totals, 0 misses and ~$0.00 lost with no miss rows", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, {
      model: OPUS,
      tokens: { input: 20_000, read: 160_000, write: 20_000 },
      context: 200_000,
    });
    const agentId = await spawnAgent($, world, "implementer");
    await agentRequest($, world, {
      agentId,
      model: SONNET,
      tokens: { read: 380_000, write: 20_000 },
      index: 0,
    });

    await setSessionCost($, world, SESSION_COST);

    const pane = await spendPane($);

    const block = await cacheIn(pane);
    expect(totalsOf(await lines(pane))?.hit).toBe("90%");
    expect(cacheSummaryOf(block)).toEqual({ misses: "0 misses", lost: "~$0.00" });
    expect(missesOf(block)).toEqual([]);
  });

  test("C2 a main turn on a new model that rebuilds 95k tokens shows a model switch miss of 95k and ~$0.23", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { write: CONTEXT }, context: CONTEXT });
    await mainTurn($, world, { model: SONNET, tokens: { write: CONTEXT }, context: 105_000 });

    const block = await cacheIn(await spendPane($));

    expect(withoutTime(missesOf(block))).toEqual([
      { cause: "model switch", tokens: "95k", dollars: "~$0.23" },
    ]);
    expect(cacheSummaryOf(block)).toMatchObject({ misses: "1 miss" });
  });

  test("C3 the same model rebuilding 116k after 7 minutes idle shows after 7m idle, 116k, ~$0.56 and the local time of the turn", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { write: CONTEXT }, context: CONTEXT });
    const completedAt = await mainTurn($, world, {
      model: OPUS,
      tokens: { write: 120_000 },
      context: 104_000,
      idleMinutes: SEVEN_MINUTES,
    });

    const block = await cacheIn(await spendPane($));

    expect(missesOf(block)).toEqual([
      { time: clockText(completedAt), cause: "after 7m idle", tokens: "116k", dollars: "~$0.56" },
    ]);
  });

  test("C4 the first turn after a compaction writing 30k shows an after compaction miss of 30k and ~$0.14", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { write: CONTEXT }, context: CONTEXT });
    await compact($, world);
    await mainTurn($, world, { model: OPUS, tokens: { write: 30_000 } });

    const block = await cacheIn(await spendPane($));

    expect(withoutTime(missesOf(block))).toEqual([
      { cause: "after compaction", tokens: "30k", dollars: "~$0.14" },
    ]);
  });

  test("C5 a big rebuild with no other cause shows cache rebuilt, 78k and ~$0.37", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { write: CONTEXT }, context: CONTEXT });
    await mainTurn($, world, { model: OPUS, tokens: { write: 80_000 }, context: 102_000 });

    const block = await cacheIn(await spendPane($));

    expect(withoutTime(missesOf(block))).toEqual([
      { cause: "cache rebuilt", tokens: "78k", dollars: "~$0.37" },
    ]);
  });

  test("C6 two big Reads writing 50k into the cache while the context grew by 50k are no miss", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { write: CONTEXT }, context: CONTEXT });
    await mainTurn($, world, { model: OPUS, tokens: { write: 50_000 }, context: 150_000 });

    const block = await cacheIn(await spendPane($));

    expect(missesOf(block)).toEqual([]);
    expect(cacheSummaryOf(block)).toMatchObject({ misses: "0 misses" });
  });

  test("C7 a small write of 5k while the context stood still is no miss", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { write: CONTEXT }, context: CONTEXT });
    await mainTurn($, world, { model: OPUS, tokens: { write: 5_000 }, context: CONTEXT });

    const block = await cacheIn(await spendPane($));

    expect(missesOf(block)).toEqual([]);
  });

  test("C8 four misses show the 3 newest first while the summary counts 4 misses and ~$1.44 lost", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { write: CONTEXT }, context: CONTEXT });
    for (const write of [60_000, 70_000, 80_000, 90_000]) {
      await mainTurn($, world, { model: OPUS, tokens: { write }, context: CONTEXT });
    }

    const block = await cacheIn(await spendPane($));

    expect(withoutTime(missesOf(block))).toEqual([
      { cause: "cache rebuilt", tokens: "90k", dollars: "~$0.43" },
      { cause: "cache rebuilt", tokens: "80k", dollars: "~$0.38" },
      { cause: "cache rebuilt", tokens: "70k", dollars: "~$0.34" },
    ]);
    expect(cacheSummaryOf(block)).toMatchObject({ misses: "4 misses", lost: "~$1.44" });
  });

  test("C9 a model switch together with a long idle reads model switch", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { write: CONTEXT }, context: CONTEXT });
    await mainTurn($, world, {
      model: SONNET,
      tokens: { write: CONTEXT },
      context: 105_000,
      idleMinutes: SEVEN_MINUTES,
    });

    const block = await cacheIn(await spendPane($));

    expect(withoutTime(missesOf(block))).toEqual([
      { cause: "model switch", tokens: "95k", dollars: "~$0.23" },
    ]);
  });

  test("C10 an agent whose second request reads 40k of a 120k prompt from cache shows cache rebuilt, 80k and ~$0.19", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const agentId = await spawnAgent($, world, "implementer");
    await agentRequest($, world, { agentId, model: SONNET, tokens: { write: 120_000 }, index: 0 });
    await agentRequest($, world, {
      agentId,
      model: SONNET,
      tokens: { input: 5_000, read: 40_000, write: 80_000 },
      index: 1,
    });

    const block = await cacheIn(await spendPane($));

    expect(withoutTime(missesOf(block))).toEqual([
      { cause: "cache rebuilt", tokens: "80k", dollars: "~$0.19" },
    ]);
    expect(cacheSummaryOf(block)).toMatchObject({ misses: "1 miss" });
  });

  test("C11 an agent whose second request comes after 7 minutes and rebuilds 60k shows after 7m idle, 60k and ~$0.14", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const agentId = await spawnAgent($, world, "implementer");
    await agentRequest($, world, { agentId, model: SONNET, tokens: { write: 60_000 }, index: 0 });
    await agentRequest($, world, {
      agentId,
      model: SONNET,
      tokens: { write: 60_000 },
      index: 1,
      idleMinutes: SEVEN_MINUTES,
    });

    const block = await cacheIn(await spendPane($));

    expect(withoutTime(missesOf(block))).toEqual([
      { cause: "after 7m idle", tokens: "60k", dollars: "~$0.14" },
    ]);
  });

  test("C12 the first main turn of a session is no miss even with a 200k write", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { write: 200_000 }, context: 200_000 });
    await setSessionCost($, world, SESSION_COST);

    const pane = await spendPane($);

    const block = await cacheIn(pane);
    expect(missesOf(block)).toEqual([]);
    expect(totalsOf(await lines(pane))?.hit).toBe("0%");
    expect(cacheSummaryOf(block)).toMatchObject({ misses: "0 misses" });
  });

  test("C13 the first turn after a compaction writing 9,999 tokens, one under the 10k floor, is no miss", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { write: CONTEXT }, context: CONTEXT });
    await compact($, world);
    await mainTurn($, world, { model: OPUS, tokens: { write: 9_999 } });

    const block = await cacheIn(await spendPane($));

    expect(missesOf(block)).toEqual([]);
  });

  test("C14 an agent request at index 0 that rebuilds a whole 120k prompt is no miss, even after an earlier request of that agent", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const agentId = await spawnAgent($, world, "implementer");
    await agentRequest($, world, { agentId, model: HAIKU, tokens: { write: 120_000 }, index: 0 });
    await agentRequest($, world, { agentId, model: HAIKU, tokens: { write: 120_000 }, index: 0 });

    const block = await cacheIn(await spendPane($));

    expect(missesOf(block)).toEqual([]);
    expect(cacheSummaryOf(block)).toMatchObject({ misses: "0 misses" });
  });

  test("C15 an agent's second request writing a 60k tool result on a 20k prefix it read from cache is no miss", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const agentId = await spawnAgent($, world, "implementer");
    await agentRequest($, world, { agentId, model: SONNET, tokens: { write: 20_000 }, index: 0 });
    await agentRequest($, world, {
      agentId,
      model: SONNET,
      tokens: { input: 1_000, read: 20_000, write: 60_000 },
      index: 1,
    });

    const block = await cacheIn(await spendPane($));

    expect(missesOf(block)).toEqual([]);
  });

  test("C16 a miss on a model with no price shows its cause and tokens with no $ and adds nothing to lost", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: UNPRICED, tokens: { write: CONTEXT }, context: CONTEXT });
    await mainTurn($, world, { model: UNPRICED, tokens: { write: 60_000 }, context: CONTEXT });

    const block = await cacheIn(await spendPane($));

    expect(withoutTime(missesOf(block))).toEqual([
      { cause: "cache rebuilt", tokens: "60k", dollars: null },
    ]);
    expect(cacheSummaryOf(block)).toMatchObject({ misses: "1 miss", lost: "~$0.00" });
  });

  test("C17 the first turn after a compaction writing 12k, just over the 10k floor, shows an after compaction miss of 12k and ~$0.06", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { write: CONTEXT }, context: CONTEXT });
    await compact($, world);
    await mainTurn($, world, { model: OPUS, tokens: { write: 12_000 } });

    const block = await cacheIn(await spendPane($));

    expect(withoutTime(missesOf(block))).toEqual([
      { cause: "after compaction", tokens: "12k", dollars: "~$0.06" },
    ]);
  });

  test("C18 a 60k rebuild on a 200k context, under half of it, is no miss", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { write: 200_000 }, context: 200_000 });
    await mainTurn($, world, { model: OPUS, tokens: { write: 60_000 }, context: 200_000 });

    const block = await cacheIn(await spendPane($));

    expect(missesOf(block)).toEqual([]);
  });

  test("C19 a gap of 4 minutes, inside the 5 minute cache life, shows cache rebuilt and not idle", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { write: CONTEXT }, context: CONTEXT });
    await mainTurn($, world, {
      model: OPUS,
      tokens: { write: 80_000 },
      context: 102_000,
      idleMinutes: 4,
    });

    const block = await cacheIn(await spendPane($));

    expect(withoutTime(missesOf(block))).toEqual([
      { cause: "cache rebuilt", tokens: "78k", dollars: "~$0.37" },
    ]);
  });

  test("C20 an agent request that also writes a new 160k tool result counts only the 100k it lost as rebuilt", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const agentId = await spawnAgent($, world, "implementer");
    await agentRequest($, world, { agentId, model: SONNET, tokens: { write: 120_000 }, index: 0 });
    await agentRequest($, world, {
      agentId,
      model: SONNET,
      tokens: { read: 20_000, write: 160_000 },
      index: 1,
    });

    const block = await cacheIn(await spendPane($));

    expect(withoutTime(missesOf(block))).toEqual([
      { cause: "cache rebuilt", tokens: "100k", dollars: "~$0.24" },
    ]);
  });

  test("C21 an agent request that still reads 70k of a 120k prompt from cache, over half, is no miss", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const agentId = await spawnAgent($, world, "implementer");
    await agentRequest($, world, { agentId, model: SONNET, tokens: { write: 120_000 }, index: 0 });
    await agentRequest($, world, {
      agentId,
      model: SONNET,
      tokens: { read: 70_000, write: 55_000 },
      index: 1,
    });

    const block = await cacheIn(await spendPane($));

    expect(missesOf(block)).toEqual([]);
  });

  test("C22 only the first turn after a compaction reads after compaction, the next big rebuild reads cache rebuilt", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { write: CONTEXT }, context: CONTEXT });
    await compact($, world);
    await mainTurn($, world, { model: OPUS, tokens: { write: 5_000 }, context: CONTEXT });
    await mainTurn($, world, { model: OPUS, tokens: { write: 80_000 }, context: 102_000 });

    const block = await cacheIn(await spendPane($));

    expect(withoutTime(missesOf(block))).toEqual([
      { cause: "cache rebuilt", tokens: "78k", dollars: "~$0.37" },
    ]);
  });
});

async function cacheIn(pane: Pane) {
  return (await blocks(pane))[CACHE_TITLE];
}

function withoutTime(misses: Miss[]): Omit<Miss, "time">[] {
  return misses.map(({ cause, tokens, dollars }) => ({ cause, tokens, dollars }));
}
