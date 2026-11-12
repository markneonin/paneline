import { describe, expect, test } from "claude-code/testing";

import {
  API_KEY,
  CACHE_TITLE,
  HAIKU,
  OPUS,
  SONNET,
  agentRequest,
  blocks,
  lines,
  missCaptionOf,
  setSessionCost,
  mainTurn,
  missesOf,
  spawnAgent,
  spendPane,
  worldOf,
} from "./spend-world";
import type { Miss, Pane } from "./spend-world";

const SESSION_COST = 1;

const CONTEXT = 100_000;
const SEVEN_MINUTES = 7;
const AGENT_PROMPT = 120_000;
const HAIKU_5_5 = "claude-haiku-5-5";
const CALL_TOKENS = 40_000;
const LONG_CALL_TOKENS = 150_000;

describe("spend misses with a known cause", () => {
  test("K1 switching from sonnet to opus when the context grew from 34.4k to 83k with 59.8k written shows a model switch miss of 11.2k and ~$0.05", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: SONNET, tokens: { write: 34_400 }, context: 34_400 });
    await mainTurn($, world, { model: OPUS, tokens: { write: 59_800 }, context: 83_000 });

    const block = await cacheIn(await spendPane($));

    expect(withoutTime(missesOf(block))).toEqual([
      { cause: "model switch", tokens: "11.2k", dollars: "~$0.05" },
    ]);
  });

  test("K2 the same 11.2k rebuild on the same model, with no known cause, is no miss", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { write: 34_400 }, context: 34_400 });
    await mainTurn($, world, { model: OPUS, tokens: { write: 59_800 }, context: 83_000 });

    const block = await cacheIn(await spendPane($));

    expect(missesOf(block)).toEqual([]);
  });

  test("K3 a model switch that rebuilds 1,999 tokens, one under the 2k floor, is no miss", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: SONNET, tokens: { write: CONTEXT }, context: CONTEXT });
    await mainTurn($, world, { model: OPUS, tokens: { write: 1_999 }, context: CONTEXT });

    const block = await cacheIn(await spendPane($));

    expect(missesOf(block)).toEqual([]);
  });

  test("K4 a model switch that rebuilds exactly 2,000 tokens shows model switch, 2k and <$0.01", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: SONNET, tokens: { write: CONTEXT }, context: CONTEXT });
    await mainTurn($, world, { model: OPUS, tokens: { write: 2_000 }, context: CONTEXT });

    const block = await cacheIn(await spendPane($));

    expect(withoutTime(missesOf(block))).toEqual([
      { cause: "model switch", tokens: "2k", dollars: "<$0.01" },
    ]);
  });

  test("K5 a 3k rebuild after 7 minutes idle shows after 7m idle, 3k and ~$0.01", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { write: CONTEXT }, context: CONTEXT });
    await mainTurn($, world, {
      model: OPUS,
      tokens: { write: 3_000 },
      context: CONTEXT,
      idleMinutes: SEVEN_MINUTES,
    });

    const block = await cacheIn(await spendPane($));

    expect(withoutTime(missesOf(block))).toEqual([
      { cause: "after 7m idle", tokens: "3k", dollars: "~$0.01" },
    ]);
  });

  test("K6 an agent request after 7 minutes that reads 100k of a 120k prompt from cache shows after 7m idle, 20k and ~$0.05", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const agentId = await spawnAgent($, world, "implementer");
    await agentRequest($, world, {
      agentId,
      model: SONNET,
      tokens: { write: AGENT_PROMPT },
      index: 0,
    });
    await agentRequest($, world, {
      agentId,
      model: SONNET,
      tokens: { read: 100_000, write: 20_000 },
      index: 1,
      idleMinutes: SEVEN_MINUTES,
    });

    const block = await cacheIn(await spendPane($));

    expect(withoutTime(missesOf(block))).toEqual([
      { cause: "after 7m idle", tokens: "20k", dollars: "~$0.05" },
    ]);
  });

  test("K7 an agent request after 7 minutes that loses only 500 tokens of its prompt is no miss", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const agentId = await spawnAgent($, world, "implementer");
    await agentRequest($, world, {
      agentId,
      model: SONNET,
      tokens: { write: AGENT_PROMPT },
      index: 0,
    });
    await agentRequest($, world, {
      agentId,
      model: SONNET,
      tokens: { read: 119_500, write: 500 },
      index: 1,
      idleMinutes: SEVEN_MINUTES,
    });

    const block = await cacheIn(await spendPane($));

    expect(missesOf(block)).toEqual([]);
  });

  test("K8 an agent that changes from sonnet to haiku and loses 20k of its prompt shows model switch, 20k and ~$0.02", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const agentId = await spawnAgent($, world, "implementer");
    await agentRequest($, world, {
      agentId,
      model: SONNET,
      tokens: { write: AGENT_PROMPT },
      index: 0,
    });
    await agentRequest($, world, {
      agentId,
      model: HAIKU,
      tokens: { read: 100_000, write: 20_000 },
      index: 1,
    });

    const block = await cacheIn(await spendPane($));

    expect(withoutTime(missesOf(block))).toEqual([
      { cause: "model switch", tokens: "20k", dollars: "~$0.02" },
    ]);
  });

  test("K9 a Haiku 5.5 turn of three calls after 7 minutes idle that rebuilds 30k shows the miss at <$0.01 and the summary at <$0.01 lost, not ~$0.02", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, {
      model: HAIKU_5_5,
      tokens: { write: CALL_TOKENS },
      context: CALL_TOKENS,
    });
    await mainTurn($, world, {
      model: HAIKU_5_5,
      tokens: { read: 90_000, write: 30_000 },
      context: CALL_TOKENS,
      idleMinutes: SEVEN_MINUTES,
    });

    await setSessionCost($, world, SESSION_COST);
    const pane = await spendPane($);
    const block = await cacheIn(pane);

    expect(withoutTime(missesOf(block))).toEqual([
      { cause: "after 7m idle", tokens: "30k", dollars: "<$0.01" },
    ]);
    expect(missCaptionOf(await lines(pane))).toEqual({ misses: "1 miss", lost: "<$0.01" });
  });

  test("K10 a single Haiku 5.5 call of 150k after 7 minutes idle that rebuilds 30k shows the miss at ~$0.02 and the summary at ~$0.02 lost", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, {
      model: HAIKU_5_5,
      tokens: { write: CALL_TOKENS },
      context: CALL_TOKENS,
    });
    await mainTurn($, world, {
      model: HAIKU_5_5,
      tokens: { read: 10_000, write: 140_000 },
      context: LONG_CALL_TOKENS,
      idleMinutes: SEVEN_MINUTES,
    });

    await setSessionCost($, world, SESSION_COST);
    const pane = await spendPane($);
    const block = await cacheIn(pane);

    expect(withoutTime(missesOf(block))).toEqual([
      { cause: "after 7m idle", tokens: "30k", dollars: "~$0.02" },
    ]);
    expect(missCaptionOf(await lines(pane))).toEqual({ misses: "1 miss", lost: "~$0.02" });
  });
});

async function cacheIn(pane: Pane) {
  return (await blocks(pane))[CACHE_TITLE];
}

function withoutTime(misses: Miss[]): Omit<Miss, "time">[] {
  return misses.map(({ cause, tokens, dollars }) => ({ cause, tokens, dollars }));
}
