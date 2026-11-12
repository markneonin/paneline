import { describe, expect, test } from "claude-code/testing";

import {
  API_KEY,
  CACHE_TITLE,
  OPUS,
  SONNET,
  SUBSCRIPTION,
  agentOwner,
  agentRequest,
  blocks,
  lines,
  missCaptionOf,
  mainTurn,
  missesOf,
  ownersOf,
  setSessionCost,
  startFreshSession,
  spawnAgent,
  spendPane,
  switchModel,
  worldOf,
} from "./spend-world";
import type { Miss, Owner, Pane } from "./spend-world";

const SPLIT = "Where it went";
const CONTEXT = 100_000;
const OPUS_400K_WRITE = 400_000;
const OPUS_250K_WRITE = 250_000;
const AGENT_400K_WRITE = 400_000;
const HOUR_PRICED_COST = 3.2;
const FIVE_MINUTE_PRICED_COST = 2;
const MIXED_COST = 3;
const API_COST = 4;
const SESSION_COST = 1;
const THIRTY_MINUTES = 30;
const SIXTY_ONE_MINUTES = 61;
const SEVEN_MINUTES = 7;

describe("spend cache write prices by cache lifetime", () => {
  test("P1 on a subscription a main turn writing 400k tokens on opus is priced at the 1 hour write rate, ~$3.20 and 100%, with no background row", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    await mainTurn($, world, { model: OPUS, tokens: { write: OPUS_400K_WRITE } });
    await setSessionCost($, world, HOUR_PRICED_COST);

    const owners = await ownersIn(await spendPane($));

    expect(shown(owners)).toEqual([["main · opus 5.5", "~$3.20", "100%"]]);
  });

  test("P2 with an API key the same main turn is priced at the 5 minute write rate, so main shows ~$2.00 50% and the other ~$2.00 50% stays in background", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await startFreshSession($, world);
    await mainTurn($, world, { model: OPUS, tokens: { write: OPUS_400K_WRITE } });
    await setSessionCost($, world, API_COST);

    const owners = await ownersIn(await spendPane($));

    expect(shown(owners)).toEqual([
      ["main · opus 5.5", "~$2.00", "50%"],
      ["background", "~$2.00", "50%"],
    ]);
  });

  test("P3 with an API key a model switch that reports a 1 hour cache lifetime makes the main turn priced at the 1 hour rate, ~$3.20 and 100%", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await switchModel($, world, OPUS, "1h");
    await mainTurn($, world, { model: OPUS, tokens: { write: OPUS_400K_WRITE } });
    await setSessionCost($, world, HOUR_PRICED_COST);

    const owners = await ownersIn(await spendPane($));

    expect(shown(owners)).toEqual([["main · opus 5.5", "~$3.20", "100%"]]);
  });

  test("P4 on a subscription a model switch that reports a 5 minute cache lifetime makes the main turn priced at the 5 minute rate, ~$2.00 and 100%", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    await switchModel($, world, OPUS, "5m");
    await mainTurn($, world, { model: OPUS, tokens: { write: OPUS_400K_WRITE } });
    await setSessionCost($, world, FIVE_MINUTE_PRICED_COST);

    const owners = await ownersIn(await spendPane($));

    expect(shown(owners)).toEqual([["main · opus 5.5", "~$2.00", "100%"]]);
  });

  test("P5 on a subscription main is priced at the 1 hour rate (~$2.00 for 250k) while an agent writing 400k on sonnet stays at the 5 minute rate (~$1.00), 67% and 33%", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    await mainTurn($, world, { model: OPUS, tokens: { write: OPUS_250K_WRITE } });
    await agentOwner($, world, "implementer", SONNET, { write: AGENT_400K_WRITE });
    await setSessionCost($, world, MIXED_COST);

    const owners = await ownersIn(await spendPane($));

    expect(shown(owners)).toEqual([
      ["main · opus 5.5", "~$2.00", "67%"],
      ["implementer", "~$1.00", "33%"],
    ]);
  });

  test("P6 on a subscription a main turn rebuilding 78k after 30 minutes idle shows cache rebuilt, not idle, priced at the 1 hour rate: 78k and ~$0.61, and ~$0.61 lost", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    await mainTurn($, world, { model: OPUS, tokens: { write: CONTEXT }, context: CONTEXT });
    await mainTurn($, world, {
      model: OPUS,
      tokens: { write: 80_000 },
      context: 102_000,
      idleMinutes: THIRTY_MINUTES,
    });

    await setSessionCost($, world, SESSION_COST);
    const pane = await spendPane($);
    const block = await cacheIn(pane);

    expect(withoutTime(missesOf(block))).toEqual([
      { cause: "cache rebuilt", tokens: "78k", dollars: "~$0.61" },
    ]);
    expect(missCaptionOf(await lines(pane))).toMatchObject({ lost: "~$0.61" });
  });

  test("P7 on a subscription the same rebuild after 61 minutes idle shows after 61m idle, 78k and ~$0.61", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    await mainTurn($, world, { model: OPUS, tokens: { write: CONTEXT }, context: CONTEXT });
    await mainTurn($, world, {
      model: OPUS,
      tokens: { write: 80_000 },
      context: 102_000,
      idleMinutes: SIXTY_ONE_MINUTES,
    });

    const block = await cacheIn(await spendPane($));

    expect(withoutTime(missesOf(block))).toEqual([
      { cause: "after 61m idle", tokens: "78k", dollars: "~$0.61" },
    ]);
  });

  test("P8 on a subscription a model switch from sonnet to opus that rebuilds 95k is priced on opus at the 1 hour rate: model switch, 95k, ~$0.74", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    await mainTurn($, world, { model: SONNET, tokens: { write: CONTEXT }, context: CONTEXT });
    await mainTurn($, world, { model: OPUS, tokens: { write: CONTEXT }, context: 105_000 });

    const block = await cacheIn(await spendPane($));

    expect(withoutTime(missesOf(block))).toEqual([
      { cause: "model switch", tokens: "95k", dollars: "~$0.74" },
    ]);
  });

  test("P9 with an API key a model switch that reports a 1 hour cache lifetime makes a rebuild after 30 minutes read cache rebuilt, 78k, ~$0.61", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await switchModel($, world, OPUS, "1h");
    await mainTurn($, world, { model: OPUS, tokens: { write: CONTEXT }, context: CONTEXT });
    await mainTurn($, world, {
      model: OPUS,
      tokens: { write: 80_000 },
      context: 102_000,
      idleMinutes: THIRTY_MINUTES,
    });

    const block = await cacheIn(await spendPane($));

    expect(withoutTime(missesOf(block))).toEqual([
      { cause: "cache rebuilt", tokens: "78k", dollars: "~$0.61" },
    ]);
  });

  test("P10 on a subscription an agent request after 7 minutes still reads after 7m idle, 60k and ~$0.14 at the 5 minute rate", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
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
});

async function ownersIn(pane: Pane): Promise<Owner[]> {
  return ownersOf((await blocks(pane))[SPLIT]);
}

async function cacheIn(pane: Pane) {
  return (await blocks(pane))[CACHE_TITLE];
}

function shown(owners: Owner[]): (string | null)[][] {
  return owners.map((owner) => [owner.name, owner.dollars, owner.percent]);
}

function withoutTime(misses: Miss[]): Omit<Miss, "time">[] {
  return misses.map(({ cause, tokens, dollars }) => ({ cause, tokens, dollars }));
}
