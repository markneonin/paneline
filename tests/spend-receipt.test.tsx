import { describe, expect, test } from "claude-code/testing";
import type { On, PromptOrigin } from "claude-code";
import type { Engine } from "claude-code/testing";

import {
  API_KEY,
  NARROW_COLUMNS,
  beginSession,
  OPUS,
  SPLIT_TITLE,
  SONNET,
  SUBSCRIPTION,
  UNPRICED,
  WIDE_COLUMNS,
  agentRequest,
  answerPrompts,
  compact,
  lineStartingWith,
  lines,
  mainTurn,
  runsOf,
  spacingOf,
  setSessionCost,
  settle,
  spawnAgent,
  spendPane,
  startFreshSession,
  submitMetaPrompt,
  submitPrompt,
  totalsOf,
  unwrappedTexts,
  worldOf,
} from "./spend-world";
import { mainTurnOfResponses } from "./fixtures/main-responses";
import type { Line } from "./skills-tree";
import { screenRows } from "./band-screen";
import type { Pane, Plan, Tokens, World } from "./spend-world";

const TITLE_WITH_BILLED_LABEL = "Last turn · tokens billed (cache reads included)";
const NO_TURN = "no turn yet";
const ONE_BLANK_ROW = 1;
const NEXT_MESSAGE = "next message ";
const COST_BEFORE = 1;
const COST_AFTER = 1.42;
const TURN_TOKENS = { input: 30_000, output: 8_200 };
const TURN_MS = 72_000;
const TURN_ROW = "$0.28 · 38.2k tokens · 1m 12s";
const UNPRICED_TURN_ROW = /^\$0\.\d\d · 38\.2k tokens · 1m 12s$/;
const CONTEXT = 150_000;
const CONTEXT_OUTPUT = 50_000;
const NEXT_WARM_ONE_HOUR = "next message $0.04 warm · $1.60 cold";
const NEXT_WARM_FIVE_MINUTES = "next message $0.04 warm · $1.00 cold";
const AGENT_TOKENS = { input: 10_000, output: 5_000 };
const BEFORE_TURN_TOKENS = { input: 20_000 };
const COST_WITH_AGENTS = 2.1;
const RESUMED_COST = 80;
const HAIKU_LONG_TIER = "claude-haiku-5-5";
const NINETY_K_CALL = { input: 10_000, read: 80_000, output: 4_000 };
const AGENT_EIGHT_CENTS = { input: 30_000, output: 2_000 };
const ENGINE_COST_WITH_BACKGROUND = 1.3;
const FIRST_PROMPT: BackgroundPrompt = {
  text: "build it",
  main: { input: 50_000, output: 5_000 },
  agent: { input: 100_000, output: 10_000 },
  result: { input: 25_000, output: 5_000 },
  mainEndsAtMs: 8_000,
  resultEndsAtMs: 26_000,
};
const SECOND_PROMPT: BackgroundPrompt = {
  text: "and test it",
  main: { input: 10_000, output: 2_000 },
  agent: { input: 20_000, output: 1_000 },
  result: { input: 5_000, output: 1_000 },
  mainEndsAtMs: 5_000,
  resultEndsAtMs: 12_000,
};
const COST_AFTER_PROMPTS = 5;
const RUN_COST_AFTER = 1.24;
const RUN_TOKENS = { input: 200_000, output: 25_500 };
const RUN_MS = 12_000;
const AGENT_TYPES = ["implementer", "Explore"];

describe("spend tab last turn receipt", () => {
  test("R1 after a 1m 12s Opus 5.5 turn of 30k input and 8.2k output tokens, Last turn reads $0.28 · 38.2k tokens · 1m 12s", async ($, on) => {
    const world = receiptWorld(on, API_KEY);
    await turnCosting($, world, COST_AFTER);

    const receipt = await receiptOf(await spendPane($));

    expect(receipt.first?.text).toBe(TURN_ROW);
  });

  test("R2 a turn that ran two subagents shows 2 agents and a cost and token count that include them, while an agent started before the turn is not counted", async ($, on) => {
    const world = receiptWorld(on, API_KEY);
    await startFreshSession($, world);
    const earlier = await spawnAgent($, world, "implementer");
    await agentRequest($, world, {
      agentId: earlier,
      model: SONNET,
      tokens: BEFORE_TURN_TOKENS,
      index: 0,
    });
    await setSessionCost($, world, COST_BEFORE);
    await submitPrompt($, world, "go");
    for (const type of ["implementer", "Explore"]) {
      const agentId = await spawnAgent($, world, type);
      await agentRequest($, world, { agentId, model: SONNET, tokens: AGENT_TOKENS, index: 0 });
    }
    await setSessionCost($, world, COST_WITH_AGENTS);
    await mainTurn($, world, {
      model: OPUS,
      tokens: TURN_TOKENS,
      context: CONTEXT,
      durationMs: TURN_MS,
    });

    const receipt = await receiptOf(await spendPane($));

    expect(receipt.first?.text).toBe("$0.42 · 68.2k tokens · 1m 12s · 2 agents");
  });

  test("R2b a turn that ran one subagent says 1 agent, not 1 agents", async ($, on) => {
    const world = receiptWorld(on, API_KEY);
    await startFreshSession($, world);
    await setSessionCost($, world, COST_BEFORE);
    await submitPrompt($, world, "go");
    const agentId = await spawnAgent($, world, "implementer");
    await agentRequest($, world, { agentId, model: SONNET, tokens: AGENT_TOKENS, index: 0 });
    await setSessionCost($, world, COST_AFTER);
    await mainTurn($, world, {
      model: OPUS,
      tokens: TURN_TOKENS,
      context: CONTEXT,
      durationMs: TURN_MS,
    });

    const receipt = await receiptOf(await spendPane($));

    expect(receipt.first?.text).toBe("$0.35 · 53.2k tokens · 1m 12s · 1 agent");
  });

  test("R3 a second turn replaces the first receipt and shows only the second turn's cost, tokens and time", async ($, on) => {
    const world = receiptWorld(on, API_KEY);
    await turnCosting($, world, COST_AFTER);
    await submitPrompt($, world, "again");
    await setSessionCost($, world, 1.5);
    await mainTurn($, world, {
      model: OPUS,
      tokens: { input: 5_000, output: 1_000 },
      context: CONTEXT,
      durationMs: 5_000,
    });

    const receipt = await receiptOf(await spendPane($));

    expect(receipt.first?.text).toBe("$0.04 · 6k tokens · 5s");
  });

  test("R4 before any main turn there is no Last turn block and no next message row", async ($, on) => {
    const world = receiptWorld(on, API_KEY);
    await startFreshSession($, world);
    const agentId = await spawnAgent($, world, "implementer");
    await agentRequest($, world, { agentId, model: SONNET, tokens: AGENT_TOKENS, index: 0 });
    await setSessionCost($, world, COST_AFTER);

    const shown = await lines(await spendPane($));

    expect(texts(shown)).not.toContain(TITLE_WITH_BILLED_LABEL);
    expect(texts(shown)).not.toContain(NO_TURN);
    expect(texts(shown).some((text) => text.startsWith(NEXT_MESSAGE))).toBe(false);
  });

  test("STP16 a session before its first turn shows no Last turn heading and no no turn yet line and no doubled blank row, and after the first turn the Last turn receipt appears", async ($, on) => {
    const world = receiptWorld(on, API_KEY);
    await startFreshSession($, world);
    await setSessionCost($, world, COST_BEFORE);
    const pane = await spendPane($);
    const before = await lines(pane);

    await submitPrompt($, world, "go");
    await setSessionCost($, world, COST_AFTER);
    await mainTurn($, world, {
      model: OPUS,
      tokens: TURN_TOKENS,
      context: CONTEXT,
      durationMs: TURN_MS,
    });
    await settle(pane);
    const after = await lines(pane);

    expect(texts(before)).not.toContain(TITLE_WITH_BILLED_LABEL);
    expect(texts(before)).not.toContain(NO_TURN);
    expect(spacingOf(before).longestBlankRun).toBe(ONE_BLANK_ROW);
    expect(texts(after)).toContain(TITLE_WITH_BILLED_LABEL);
    expect(texts(after)).toContain(TURN_ROW);
  });

  test("R5a on a subscription (1 hour cache) after a turn that left 200k tokens in context, next message reads $0.04 warm · $1.60 cold", async ($, on) => {
    const world = receiptWorld(on, SUBSCRIPTION);
    await turnLeavingContext($, world);

    const receipt = await receiptOf(await spendPane($));

    expect(receipt.next?.text).toBe(NEXT_WARM_ONE_HOUR);
  });

  test("R5b on an API key (5 minute cache) the same context reads $0.04 warm · $1.00 cold", async ($, on) => {
    const world = receiptWorld(on, API_KEY);
    await turnLeavingContext($, world);

    const receipt = await receiptOf(await spendPane($));

    expect(receipt.next?.text).toBe(NEXT_WARM_FIVE_MINUTES);
  });

  test("R6 when the main model has no price the receipt is shown and the next message row is not", async ($, on) => {
    const world = receiptWorld(on, API_KEY);
    await turnCosting($, world, COST_AFTER, UNPRICED);

    const receipt = await receiptOf(await spendPane($));

    expect(receipt.first?.text).toMatch(UNPRICED_TURN_ROW);
    expect(receipt.next).toBeUndefined();
  });

  test("STP7 after a turn with no agent Last turn reads $1.31 · 225.5k tokens · 12s with the numbers in text, the words muted and no 0 agents", async ($, on) => {
    const world = receiptWorld(on, API_KEY);
    await turnWithAgentCount($, world, 0);

    const receipt = await receiptOf(await spendPane($));

    expect(receipt.first?.text).toBe("$1.31 · 225.5k tokens · 12s");
    expect(runsOf(receipt.first)).toEqual([
      ["text", "$1.31"],
      ["muted", "·"],
      ["text", "225.5k"],
      ["muted", "tokens ·"],
      ["text", "12s"],
    ]);
  });

  test("STP8 after a turn with two agents the line ends · 2 agents with 2 in text", async ($, on) => {
    const world = receiptWorld(on, API_KEY);
    await turnWithAgentCount($, world, 2);

    const receipt = await receiptOf(await spendPane($));

    expect(runsOf(receipt.first).slice(-3)).toEqual([
      ["muted", "·"],
      ["text", "2"],
      ["muted", "agents"],
    ]);
  });

  test("STP9 next message reads $0.04 warm · $1.00 cold with both prices in text", async ($, on) => {
    const world = receiptWorld(on, API_KEY);
    await turnLeavingContext($, world);

    const next = lineStartingWith(await lines(await spendPane($)), NEXT_MESSAGE);

    expect(runsOf(next)).toEqual([
      ["muted", "next message"],
      ["text", "$0.04"],
      ["muted", "warm ·"],
      ["text", "$1.00"],
      ["muted", "cold"],
    ]);
  });

  test("R8a at 60 columns no Last turn row wraps and the order is totals, Last turn, Where it went", async ($, on) => {
    const world = receiptWorld(on, API_KEY);
    await turnWithAgents($, world);

    const pane = await spendPane($, NARROW_COLUMNS);

    await expectOrderedAndUnwrapped(pane);
  });

  test("R11 at 60 columns the Last turn heading reads Last turn · tokens billed (cache reads included) in full on one line", async ($, on) => {
    const world = receiptWorld(on, API_KEY);
    await turnWithAgents($, world);

    const pane = await spendPane($, NARROW_COLUMNS);

    const rows = screenRows(await pane.drawn(), NARROW_COLUMNS);
    expect(rows.find((row) => row.includes(TITLE_WITH_BILLED_LABEL)) !== undefined).toBe(true);
  });

  test("R8b at 120 columns no Last turn row wraps and the order is totals, Last turn, Where it went", async ($, on) => {
    const world = receiptWorld(on, API_KEY);
    await turnWithAgents($, world);

    const pane = await spendPane($, WIDE_COLUMNS);

    await expectOrderedAndUnwrapped(pane);
  });

  test("R9 after a compaction the receipt stays and the next message row goes", async ($, on) => {
    const world = receiptWorld(on, API_KEY);
    await turnLeavingContext($, world);
    await compact($, world);

    const receipt = await receiptOf(await spendPane($));

    expect(receipt.first?.text).toMatch(/^\$1\.04 · /);
    expect(receipt.next).toBeUndefined();
  });

  test("R10 when the session cost is unknown at turn start and $80 of earlier spend appears during the turn, there is no Last turn block and no $80.00 receipt", async ($, on) => {
    const world = receiptWorld(on, API_KEY);
    await beginSession($, world, "resume");
    await submitPrompt($, world, "go");
    await setSessionCost($, world, RESUMED_COST);
    await mainTurn($, world, {
      model: OPUS,
      tokens: TURN_TOKENS,
      context: CONTEXT,
      durationMs: TURN_MS,
    });

    const shown = await lines(await spendPane($));

    expect(texts(shown)).not.toContain(TITLE_WITH_BILLED_LABEL);
    expect(texts(shown)).not.toContain(NO_TURN);
  });

  test("P4 a Haiku 5.5 turn of two 90k-token calls and a $0.08 agent run, with $0.30 of engine cost moving, shows Last turn $0.09 and the tokens of those calls", async ($, on) => {
    const world = receiptWorld(on, API_KEY);
    await startFreshSession($, world);
    await setSessionCost($, world, COST_BEFORE);
    await submitPrompt($, world, "go");
    const agentId = await spawnAgent($, world, "general-purpose");
    await agentRequest($, world, { agentId, model: SONNET, tokens: AGENT_EIGHT_CENTS, index: 0 });
    await setSessionCost($, world, ENGINE_COST_WITH_BACKGROUND);
    await mainTurnOfResponses($, world, {
      model: HAIKU_LONG_TIER,
      responses: [NINETY_K_CALL, NINETY_K_CALL],
      context: CONTEXT,
      durationMs: TURN_MS,
    });

    const receipt = await receiptOf(await spendPane($));

    expect(receipt.first?.text).toBe("$0.09 · 220k tokens · 1m 12s · 1 agent");
  });

  test("R12 a typed prompt whose main turn ends after 8s and whose background agent's result turn ends at 26s shows $0.80 · 195k tokens · 26s · 1 agent", async ($, on) => {
    const world = receiptWorld(on, API_KEY);
    await startFreshSession($, world);
    await setSessionCost($, world, COST_BEFORE);

    await promptWithBackgroundAgent($, world, FIRST_PROMPT);

    const receipt = await receiptOf(await spendPane($));
    expect(receipt.first?.text).toBe("$0.80 · 195k tokens · 26s · 1 agent");
  });

  test("R14 a prompt that arrives as a Slack ping and starts a background agent shows $0.80 · 195k tokens · 26s · 1 agent", async ($, on) => {
    const world = receiptWorld(on, API_KEY);
    await startFreshSession($, world);
    await setSessionCost($, world, COST_BEFORE);

    await promptWithBackgroundAgent($, world, { ...FIRST_PROMPT, origin: { kind: "slack-ping" } });

    const receipt = await receiptOf(await spendPane($));
    expect(receipt.first?.text).toBe("$0.80 · 195k tokens · 26s · 1 agent");
  });

  test("R15 a meta prompt arriving before the agent's result turn does not restart the receipt: it still shows $0.80 · 195k tokens · 26s · 1 agent", async ($, on) => {
    const world = receiptWorld(on, API_KEY);
    await startFreshSession($, world);
    await setSessionCost($, world, COST_BEFORE);

    await promptWithBackgroundAgent($, world, { ...FIRST_PROMPT, isMetaBeforeResult: true });

    const receipt = await receiptOf(await spendPane($));
    expect(receipt.first?.text).toBe("$0.80 · 195k tokens · 26s · 1 agent");
  });

  test("R13 a second typed prompt starts a new receipt that shows only its own $0.17 · 39k tokens · 12s · 1 agent", async ($, on) => {
    const world = receiptWorld(on, API_KEY);
    await startFreshSession($, world);
    await setSessionCost($, world, COST_BEFORE);
    await promptWithBackgroundAgent($, world, FIRST_PROMPT);

    await promptWithBackgroundAgent($, world, SECOND_PROMPT);

    const receipt = await receiptOf(await spendPane($));
    expect(receipt.first?.text).toBe("$0.17 · 39k tokens · 12s · 1 agent");
  });
});

type BackgroundPrompt = {
  text: string;
  main: Tokens;
  agent: Tokens;
  result: Tokens;
  mainEndsAtMs: number;
  resultEndsAtMs: number;
  origin?: PromptOrigin;
  isMetaBeforeResult?: boolean;
};

async function promptWithBackgroundAgent(
  $: Engine,
  world: World,
  prompt: BackgroundPrompt,
): Promise<void> {
  await submitPrompt($, world, prompt.text, prompt.origin);
  await mainTurn($, world, {
    model: OPUS,
    tokens: prompt.main,
    context: CONTEXT,
    durationMs: prompt.mainEndsAtMs,
  });
  const agentId = await spawnAgent($, world, "implementer");
  await agentRequest($, world, { agentId, model: SONNET, tokens: prompt.agent, index: 0 });
  if (prompt.isMetaBeforeResult === true) await submitMetaPrompt($, "background note");
  await setSessionCost($, world, COST_AFTER_PROMPTS);
  await mainTurn($, world, {
    model: OPUS,
    tokens: prompt.result,
    context: CONTEXT,
    durationMs: prompt.resultEndsAtMs,
  });
}

function receiptWorld(on: On, plan: Plan): World {
  on("turn.start", (_$, e) => ({ turnId: e.turnId }));
  answerPrompts(on);
  return worldOf(on, plan);
}

async function turnCosting(
  $: Engine,
  world: World,
  costAfter: number,
  model: string = OPUS,
): Promise<void> {
  await startFreshSession($, world);
  await setSessionCost($, world, COST_BEFORE);
  await submitPrompt($, world, "go");
  await setSessionCost($, world, costAfter);
  await mainTurn($, world, { model, tokens: TURN_TOKENS, context: CONTEXT, durationMs: TURN_MS });
}

async function turnWithAgentCount($: Engine, world: World, agents: number): Promise<void> {
  await startFreshSession($, world);
  await setSessionCost($, world, COST_BEFORE);
  await submitPrompt($, world, "go");
  for (const type of AGENT_TYPES.slice(0, agents)) {
    const agentId = await spawnAgent($, world, type);
    await agentRequest($, world, { agentId, model: SONNET, tokens: AGENT_TOKENS, index: 0 });
  }
  await setSessionCost($, world, RUN_COST_AFTER);
  await mainTurn($, world, {
    model: OPUS,
    tokens: RUN_TOKENS,
    context: CONTEXT,
    durationMs: RUN_MS,
  });
}

async function turnLeavingContext($: Engine, world: World): Promise<void> {
  await startFreshSession($, world);
  await setSessionCost($, world, COST_BEFORE);
  await submitPrompt($, world, "go");
  await setSessionCost($, world, COST_AFTER);
  await mainTurn($, world, {
    model: OPUS,
    tokens: { input: 10_000, output: CONTEXT_OUTPUT },
    context: CONTEXT,
    durationMs: TURN_MS,
  });
}

async function turnWithAgents($: Engine, world: World): Promise<void> {
  await startFreshSession($, world);
  await setSessionCost($, world, COST_BEFORE);
  await submitPrompt($, world, "go");
  const agentId = await spawnAgent($, world, "implementer");
  await agentRequest($, world, { agentId, model: SONNET, tokens: AGENT_TOKENS, index: 0 });
  await setSessionCost($, world, COST_WITH_AGENTS);
  await mainTurn($, world, {
    model: OPUS,
    tokens: { input: 900_000, output: 99_000 },
    context: CONTEXT,
    durationMs: TURN_MS,
  });
}

type Receipt = { first: Line | undefined; next: Line | undefined };

async function receiptOf(pane: Pane): Promise<Receipt> {
  const shown = await lines(pane);
  const at = shown.findIndex((line) => line.text === TITLE_WITH_BILLED_LABEL);
  expect(at, `a ${TITLE_WITH_BILLED_LABEL} heading`).toBeGreaterThan(-1);
  const next = shown[at + 3];
  return {
    first: shown[at + 2],
    next: next?.text.startsWith(NEXT_MESSAGE) === true ? next : undefined,
  };
}

async function expectOrderedAndUnwrapped(pane: Pane): Promise<void> {
  const shown = await lines(pane);
  const totalsAt = shown.findIndex((line) => line === totalsOf(shown)?.labels);
  const titleAt = shown.findIndex((line) => line.text === TITLE_WITH_BILLED_LABEL);
  const splitAt = shown.findIndex((line) => line.text === SPLIT_TITLE);
  expect(totalsAt).toBeGreaterThan(-1);
  expect(titleAt).toBeGreaterThan(totalsAt);
  expect(splitAt).toBeGreaterThan(titleAt);
  expect(await unwrappedTexts(pane)).toEqual([]);
}

function texts(shown: Line[]): string[] {
  return shown.map((line) => line.text);
}
