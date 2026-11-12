import { describe, expect, test } from "claude-code/testing";

import {
  API_KEY,
  CACHE_TITLE,
  OPUS,
  OTHER_SESSION_ID,
  SESSION_ID,
  SONNET,
  SUBSCRIPTION,
  agentRequest,
  blocks,
  clearSession,
  lines,
  mainTurn,
  missCaptionOf,
  missesOf,
  reloadPlugin,
  setSessionCost,
  spawnAgent,
  spendPane,
  splitOf,
  startFreshSession,
  worldOf,
} from "./spend-world";
import type { Engine } from "claude-code/testing";
import type { Miss, Pane, World } from "./spend-world";

const CONTEXT = 108_283;
const FIRST_INPUT = 1_483;
const FIRST_READ = 106_800;
const BELOW_KNOWN_CAUSE_FLOOR = 1_500;
const AGENT_PROMPT = 60_000;
const IDLE_MINUTES = 72;
const AGENT_SONNET_2_USD = 1_000_000;
const MAIN_OPUS_4_USD = 1_000_000;
const FOUR_DOLLARS = 4;
const EIGHT_DOLLARS = 8;
const SPEND_STATE_PREFIX = "paneline.spend.";
const SPEND_SESSIONS_KEY = "spendSessions";

describe("spend cache misses across a plugin reload", () => {
  test("RM1 a turn, a reload, then a wake-up turn 72 minutes later writing 108,283 and reading 0 shows 1 miss, ~$0.84 lost, after 72m idle 108.3k", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    await startFreshSession($, world);
    await firstTurn($, world);

    await reloadPlugin($, world);
    await wakeUpTurn($, world, { write: CONTEXT });

    await setSessionCost($, world, FOUR_DOLLARS);
    const pane = await spendPane($);
    const block = await cacheIn(pane);
    expect(missCaptionOf(await lines(pane))).toEqual({ misses: "1 miss", lost: "~$0.84" });
    expect(withoutTime(missesOf(block))).toEqual([
      { cause: "after 72m idle", tokens: "108.3k", dollars: "~$0.84" },
    ]);
  });

  test("RM2 a subagent request that rewrites its 60k prompt 72 minutes after the last one, with a reload between, shows 1 miss after 72m idle 60k ~$0.14", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const agentId = await spawnAgent($, world, "implementer");
    await agentRequest($, world, {
      agentId,
      model: SONNET,
      tokens: { write: AGENT_PROMPT },
      index: 0,
    });

    await reloadPlugin($, world);
    await agentRequest($, world, {
      agentId,
      model: SONNET,
      tokens: { write: AGENT_PROMPT },
      index: 1,
      idleMinutes: IDLE_MINUTES,
    });

    await setSessionCost($, world, FOUR_DOLLARS);
    const pane = await spendPane($);
    const block = await cacheIn(pane);
    expect(missCaptionOf(await lines(pane))).toEqual({ misses: "1 miss", lost: "~$0.14" });
    expect(withoutTime(missesOf(block))).toEqual([
      { cause: "after 72m idle", tokens: "60k", dollars: "~$0.14" },
    ]);
  });

  test("RM3 a session returned to after another session was cleared in between, with 72 minutes idle and a full 108,283 rewrite, shows 1 miss, ~$0.84 lost, after 72m idle", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    await startFreshSession($, world);
    await firstTurn($, world);
    await switchToClearedSession($, world);

    await reloadPlugin($, world);
    await wakeUpTurn($, world, { write: CONTEXT });

    await setSessionCost($, world, FOUR_DOLLARS);
    const pane = await spendPane($);
    const block = await cacheIn(pane);
    expect(missCaptionOf(await lines(pane))).toEqual({ misses: "1 miss", lost: "~$0.84" });
    expect(withoutTime(missesOf(block))).toEqual([
      { cause: "after 72m idle", tokens: "108.3k", dollars: "~$0.84" },
    ]);
  });

  test("RM4 a subagent of a session returned to after another session was cleared in between rewrites its 60k prompt after 72 minutes: 1 miss, ~$0.14 lost, after 72m idle", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const agentId = await spawnAgent($, world, "implementer");
    await agentRequest($, world, {
      agentId,
      model: SONNET,
      tokens: { write: AGENT_PROMPT },
      index: 0,
    });
    await switchToClearedSession($, world);

    await reloadPlugin($, world);
    await agentRequest($, world, {
      agentId,
      model: SONNET,
      tokens: { write: AGENT_PROMPT },
      index: 1,
      idleMinutes: IDLE_MINUTES,
    });

    await setSessionCost($, world, FOUR_DOLLARS);
    const pane = await spendPane($);
    const block = await cacheIn(pane);
    expect(missCaptionOf(await lines(pane))).toEqual({ misses: "1 miss", lost: "~$0.14" });
    expect(withoutTime(missesOf(block))).toEqual([
      { cause: "after 72m idle", tokens: "60k", dollars: "~$0.14" },
    ]);
  });

  test("RM5 after a reload and 72 minutes idle a wake-up turn that writes only 1,500 with the context standing still shows 0 misses", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    await startFreshSession($, world);
    await firstTurn($, world);

    await reloadPlugin($, world);
    await wakeUpTurn($, world, {
      read: CONTEXT - BELOW_KNOWN_CAUSE_FLOOR,
      write: BELOW_KNOWN_CAUSE_FLOOR,
    });

    await setSessionCost($, world, FOUR_DOLLARS);
    const pane = await spendPane($);
    const block = await cacheIn(pane);
    expect(missCaptionOf(await lines(pane))).toEqual({ misses: "0 misses", lost: "$0.00" });
    expect(missesOf(block)).toEqual([]);
  });

  test("RM6 /clear after a miss that followed a reload leaves no Cache misses block and no miss part in the caption", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    await startFreshSession($, world);
    await firstTurn($, world);
    await reloadPlugin($, world);
    await wakeUpTurn($, world, { write: CONTEXT });

    await clearSession($, world);

    await setSessionCost($, world, FOUR_DOLLARS);
    const pane = await spendPane($);
    expect(await cacheIn(pane)).toBeUndefined();
    expect(missCaptionOf(await lines(pane))).toBeUndefined();
  });

  test("RM7 with an older plugin's state, a subagent request is still counted and saved: after a reload implementer shows ~$4.00 at 100%", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await startFreshSession($, world);
    const agentId = await spawnAgent($, world, "implementer");
    await agentRequest($, world, {
      agentId,
      model: SONNET,
      tokens: { input: AGENT_SONNET_2_USD },
      index: 0,
    });
    dropMemoryFields(world);

    await agentRequest($, world, {
      agentId,
      model: SONNET,
      tokens: { input: AGENT_SONNET_2_USD },
      index: 1,
    });
    await setSessionCost($, world, FOUR_DOLLARS);

    await reloadPlugin($, world);
    await setSessionCost($, world, FOUR_DOLLARS);
    expect(await splitOf(await spendPane($))).toEqual([["implementer", "~$4.00", "100%"]]);
  });

  test("RM8 with an older plugin's state, a main turn is still counted and saved: after a reload main shows ~$8.00 at 100%", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await startFreshSession($, world);
    await mainTurn($, world, { model: OPUS, tokens: { input: MAIN_OPUS_4_USD } });
    dropMemoryFields(world);

    await mainTurn($, world, { model: OPUS, tokens: { input: MAIN_OPUS_4_USD } });
    await setSessionCost($, world, EIGHT_DOLLARS);

    await reloadPlugin($, world);
    await setSessionCost($, world, EIGHT_DOLLARS);
    expect(await splitOf(await spendPane($))).toEqual([["main · opus 5.5", "~$8.00", "100%"]]);
  });
});

function dropMemoryFields(world: World): void {
  for (const [key, entry] of world.state) {
    if (!key.startsWith(SPEND_STATE_PREFIX)) continue;
    world.state.set(key, { ...entry, value: withoutMemory(entry.value) });
  }
  const saved = world.store.get(SPEND_SESSIONS_KEY) as Record<string, unknown>;
  const stripped = Object.entries(saved).map(([id, state]) => [id, withoutMemory(state)]);
  world.store.set(SPEND_SESSIONS_KEY, Object.fromEntries(stripped));
}

function withoutMemory(state: unknown): unknown {
  const { mainMemory: _main, agentMemories: _agents, ...rest } = state as Record<string, unknown>;
  return rest;
}

async function switchToClearedSession($: Engine, world: World): Promise<void> {
  world.session = OTHER_SESSION_ID;
  await reloadPlugin($, world);
  await clearSession($, world);
  world.session = SESSION_ID;
}

function firstTurn($: Engine, world: World): Promise<number> {
  return mainTurn($, world, {
    model: OPUS,
    tokens: { input: FIRST_INPUT, read: FIRST_READ },
    context: CONTEXT,
  });
}

function wakeUpTurn(
  $: Engine,
  world: World,
  tokens: { read?: number; write: number },
): Promise<number> {
  return mainTurn($, world, {
    model: OPUS,
    tokens,
    context: CONTEXT,
    idleMinutes: IDLE_MINUTES,
  });
}

async function cacheIn(pane: Pane) {
  return (await blocks(pane))[CACHE_TITLE];
}

function withoutTime(misses: Miss[]): Omit<Miss, "time">[] {
  return misses.map(({ cause, tokens, dollars }) => ({ cause, tokens, dollars }));
}
