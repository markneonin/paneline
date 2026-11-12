import { describe, expect, test } from "claude-code/testing";

import {
  API_KEY,
  mainStep,
  OPUS,
  SESSION_ID,
  TURN_MS,
  releaseHeldStoreWrites,
  startFreshSession,
  usageOf,
  worldOf,
} from "./spend-world";
import type { Engine } from "claude-code/testing";
import type { World } from "./spend-world";

type Sessions = Record<string, { promptTokens: number }>;

const QUIET_TICKS = 1_000;
const DRAIN_ROUNDS = 100;
const SESSIONS_KEY = "spendSessions";
const TURN_COST = 5;
const TURN_TOKENS = { input: 1_000, output: 100 };

describe("store writes at turn end", () => {
  test("ST1 a turn ending in the same moment as a cost reading loses neither write", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await startFreshSession($, world);
    world.isStoreStrict = true;

    await turnEndWithCost($, world, TURN_COST);

    expect(world.rejectedStoreKeys).toEqual([]);
    expect((world.store.get(SESSIONS_KEY) as Sessions)[SESSION_ID]?.promptTokens).toBe(
      TURN_TOKENS.input,
    );
  });
});

async function turnEndWithCost($: Engine, world: World, usd: number): Promise<void> {
  world.costUsd = usd;
  await mainStep($, world, { model: OPUS, tokens: TURN_TOKENS });
  const events = Promise.allSettled([
    $.turn.complete({
      answer: "",
      durationMs: TURN_MS,
      isAborted: false,
      turnId: "turn-overlap",
      reason: "answer",
      usage: usageOf(OPUS, TURN_TOKENS),
    } as never),
    $.session.measure({
      context: { window: 200_000 },
      rateLimits: [],
      cost: { usd },
      changed: ["cost"],
    } as never),
  ]);
  await quietTicks();
  const advancing = world.clock.advance(TURN_MS);
  await releasingWrites(world, Promise.all([events, advancing]));
}

async function releasingWrites(world: World, work: Promise<unknown>): Promise<void> {
  const isDone = { value: false };
  void work.then(() => (isDone.value = true));
  for (let round = 0; round < DRAIN_ROUNDS && !isDone.value; round += 1) {
    await quietTicks();
    releaseHeldStoreWrites(world);
  }
  await work;
}

async function quietTicks(): Promise<void> {
  for (let tick = 0; tick < QUIET_TICKS; tick += 1) await Promise.resolve();
}
