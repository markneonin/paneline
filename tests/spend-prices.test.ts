import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";
import type { On } from "claude-code";

import {
  API_KEY,
  OPUS,
  SPLIT_TITLE,
  agentOwner,
  blocks,
  mainTurn,
  ownersOf,
  setSessionCost,
  spendPane,
  startFreshSession,
  worldOf,
} from "./spend-world";
import type { Owner, Tokens } from "./spend-world";

const MILLION = 1_000_000;
const SESSION_USD = 100;
const AGENT_TYPE = "reviewer";
const EXPLORER_TYPE = "explorer";
const ARCHITECT_TYPE = "architect";
const PLANNER_TYPE = "planner";
const TIER_TOKENS = 100_000;
const TIER_TOKENS_PLUS_ONE = TIER_TOKENS + 1;
const HALF_TIER_TOKENS = 50_000;
const HALF_TIER_TOKENS_PLUS_ONE = HALF_TIER_TOKENS + 1;
const CACHED_READS = 10 * MILLION;
const FABLE_TOKENS = 100_000;
const HAIKU_5_5 = "claude-haiku-5-5";
const SONNET_5_5 = "claude-sonnet-5-5";
const SONNET_5 = "claude-sonnet-5";
const SONNET_4_6 = "claude-sonnet-4-6";
const SONNET_4_5 = "claude-sonnet-4-5";
const OPUS_5 = "claude-opus-5";
const OPUS_4_8 = "claude-opus-4-8";
const OPUS_4_7 = "claude-opus-4-7";
const OPUS_4_6 = "claude-opus-4-6";
const OPUS_4_5 = "claude-opus-4-5";
const MYTHOS_5 = "claude-mythos-5";
const MYTHOS_5_1 = "claude-mythos-5-1";
const FABLE_5 = "claude-fable-5";
const FABLE_5_DATED_1M = "claude-fable-5-20260901[1m]";

type Run = { type: string; model: string; tokens: Tokens };

describe("spend prices", () => {
  test("P1 a reviewer agent on Sonnet 5.5 that reads 10M cached tokens shows ~$1.00, not ~$2.00", async ($, on) => {
    const owners = await ownersAfter($, on, [
      { type: AGENT_TYPE, model: SONNET_5_5, tokens: { read: CACHED_READS } },
    ]);

    expect(dollarsOf(owners, AGENT_TYPE)).toBe("~$1.00");
  });

  test("P2 an explorer agent on Haiku 5.5 beside an Opus 5.5 main turn shows its own ~$0.01 for 100k input tokens, not a share of the session average", async ($, on) => {
    const owners = await ownersAfter(
      $,
      on,
      [{ type: EXPLORER_TYPE, model: HAIKU_5_5, tokens: { input: TIER_TOKENS } }],
      { input: MILLION },
    );

    expect(dollarsOf(owners, EXPLORER_TYPE)).toBe("~$0.01");
  });

  test("P3 an architect agent on Opus 5 and a planner agent on Opus 5.5, 1M input tokens each, show ~$5.00 and ~$4.00", async ($, on) => {
    const owners = await ownersAfter($, on, [
      { type: ARCHITECT_TYPE, model: OPUS_5, tokens: { input: MILLION } },
      { type: PLANNER_TYPE, model: OPUS, tokens: { input: MILLION } },
    ]);

    expect(dollarsOf(owners, ARCHITECT_TYPE)).toBe("~$5.00");
    expect(dollarsOf(owners, PLANNER_TYPE)).toBe("~$4.00");
  });

  test("P4 a Fable 5 agent with 100k input and 100k output tokens shows ~$6.00", async ($, on) => {
    const dollars = await agentDollars($, on, FABLE_5, {
      input: FABLE_TOKENS,
      output: FABLE_TOKENS,
    });

    expect(dollars).toBe("~$6.00");
  });

  test("P5 an agent on Opus 5 with 1M input tokens shows ~$5.00", async ($, on) => {
    expect(await agentDollars($, on, OPUS_5, { input: MILLION })).toBe("~$5.00");
  });

  test("P6 an agent on Opus 4.8 with 1M input tokens shows ~$5.00", async ($, on) => {
    expect(await agentDollars($, on, OPUS_4_8, { input: MILLION })).toBe("~$5.00");
  });

  test("P7 an agent on Opus 4.7 with 1M input tokens shows ~$5.00", async ($, on) => {
    expect(await agentDollars($, on, OPUS_4_7, { input: MILLION })).toBe("~$5.00");
  });

  test("P8 an agent on Opus 4.6 with 1M input tokens shows ~$5.00", async ($, on) => {
    expect(await agentDollars($, on, OPUS_4_6, { input: MILLION })).toBe("~$5.00");
  });

  test("P9 an agent on Opus 4.5 with 1M input tokens shows ~$5.00", async ($, on) => {
    expect(await agentDollars($, on, OPUS_4_5, { input: MILLION })).toBe("~$5.00");
  });

  test("P10 an agent on Sonnet 5 with 1M input tokens shows ~$2.00", async ($, on) => {
    expect(await agentDollars($, on, SONNET_5, { input: MILLION })).toBe("~$2.00");
  });

  test("P11 an agent on Sonnet 4.6 with 1M input tokens shows ~$3.00", async ($, on) => {
    expect(await agentDollars($, on, SONNET_4_6, { input: MILLION })).toBe("~$3.00");
  });

  test("P12 an agent on Sonnet 4.5 with 1M input tokens shows ~$3.00", async ($, on) => {
    expect(await agentDollars($, on, SONNET_4_5, { input: MILLION })).toBe("~$3.00");
  });

  test("P13 an agent on Mythos 5 with 1M input tokens shows ~$10.00", async ($, on) => {
    expect(await agentDollars($, on, MYTHOS_5, { input: MILLION })).toBe("~$10.00");
  });

  test("P14 an agent on Mythos 5.1 with 1M input tokens shows ~$10.00", async ($, on) => {
    expect(await agentDollars($, on, MYTHOS_5_1, { input: MILLION })).toBe("~$10.00");
  });

  test("P15 a Haiku 5.5 agent with 100,000 input tokens shows ~$0.01 at the standard price", async ($, on) => {
    expect(await agentDollars($, on, HAIKU_5_5, { input: TIER_TOKENS })).toBe("~$0.01");
  });

  test("P16 a Haiku 5.5 agent with 100,001 input tokens shows ~$0.05, the whole request at the higher price", async ($, on) => {
    expect(await agentDollars($, on, HAIKU_5_5, { input: TIER_TOKENS_PLUS_ONE })).toBe("~$0.05");
  });

  test("P17 a Haiku 5.5 agent with 50,000 input and 50,001 cache-read tokens shows ~$0.03, cache reads counted in the 100k prompt", async ($, on) => {
    const dollars = await agentDollars($, on, HAIKU_5_5, {
      input: HALF_TIER_TOKENS,
      read: HALF_TIER_TOKENS_PLUS_ONE,
    });

    expect(dollars).toBe("~$0.03");
  });

  test("P18 a Fable 5 agent whose model string has a date and a [1m] suffix, 1M input tokens, shows ~$10.00", async ($, on) => {
    expect(await agentDollars($, on, FABLE_5_DATED_1M, { input: MILLION })).toBe("~$10.00");
  });
});

async function ownersAfter($: Engine, on: On, runs: Run[], main?: Tokens): Promise<Owner[]> {
  const world = worldOf(on, API_KEY);
  await startFreshSession($, world);
  if (main !== undefined) await mainTurn($, world, { model: OPUS, tokens: main });
  for (const run of runs) await agentOwner($, world, run.type, run.model, run.tokens);
  await setSessionCost($, world, SESSION_USD);
  return ownersOf((await blocks(await spendPane($)))[SPLIT_TITLE]);
}

async function agentDollars(
  $: Engine,
  on: On,
  model: string,
  tokens: Tokens,
): Promise<string | null | undefined> {
  const owners = await ownersAfter($, on, [{ type: AGENT_TYPE, model, tokens }]);
  return dollarsOf(owners, AGENT_TYPE);
}

function dollarsOf(owners: Owner[], name: string): string | null | undefined {
  return owners.find((owner) => owner.name === name)?.dollars;
}
