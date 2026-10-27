import { describe, expect, mock, test } from "claude-code/testing";
import type {
  AgentSpawnResult,
  On,
  SessionMeasureInput,
  SessionUsage,
  ToolCallResult,
  TurnStepResult,
  TurnUsage,
} from "claude-code";
import type { Engine, MockClock } from "claude-code/testing";

import type { AgentNode, AgentTree } from "../hooks/agents-model";

const FLUSH_MS = 1_000;
const START = 1_000;
const RESOLVED_MODEL = "claude-resolved-model";
const ENGINE = { plugin: "engine", tier: "core" } as const;
const SUBAGENT = "agent-1";
const SECOND_SUBAGENT = "agent-2";
const STEP_USAGE: TurnUsage = {
  model: "claude-opus-step",
  input_tokens: 100,
  output_tokens: 50,
  cache_read_input_tokens: 1_000,
  cache_creation_input_tokens: 20,
};

describe("subagent tracking", () => {
  test("A1 a started subagent shows up in the tab data 1 s later, in one update, with what the engine chose", async ($, on) => {
    const world = engineBeneath(on);
    world.answerSpawnsWith({ model: RESOLVED_MODEL, agentId: SUBAGENT });

    await world.spawnSubagent($, {
      model: "haiku",
      description: "scan repo",
      subagentType: "Explore",
      name: "scout",
      background: true,
    });

    await world.clock.advance(FLUSH_MS - 1);
    const beforeFlush = world.updatesTo("agents");
    await world.clock.advance(1);

    expect(beforeFlush).toHaveLength(0);
    expect(world.updatesTo("agents")).toHaveLength(1);
    expect(world.agent(SUBAGENT)).toMatchObject({
      id: SUBAGENT,
      type: "Explore",
      description: "scan repo",
      name: "scout",
      background: true,
      model: RESOLVED_MODEL,
      status: "running",
    });
  });

  test("A5 a subagent started by another one keeps its parent", async ($, on) => {
    const world = engineBeneath(on);

    await world.spawnSubagent($);
    await world.spawnSubagent($, { parentAgentId: SUBAGENT });
    await world.clock.advance(FLUSH_MS);

    expect(world.agent(SECOND_SUBAGENT)?.parentId).toBe(SUBAGENT);
  });

  test("A6 a subagent that ends with an error is shown as failed", async ($, on) => {
    const world = engineBeneath(on);
    await world.spawnSubagent($);

    await $.turn.complete(completion(SUBAGENT, "error"));
    await world.clock.advance(FLUSH_MS);

    expect(world.agent(SUBAGENT)?.status).toBe("failed");
  });

  test("A7 after /clear the tab data is empty", async ($, on) => {
    const world = engineBeneath(on);
    await world.spawnSubagent($);
    await world.clock.advance(FLUSH_MS);

    await $.classic.SessionStart({ source: "clear" });
    await world.clock.advance(FLUSH_MS);

    expect(world.tree()).toEqual({});
  });

  test("A8 a command a subagent is running shows its first line, and is gone when it ends", async ($, on) => {
    const world = engineBeneath(on);
    await world.spawnSubagent($);
    const releaseTool = world.holdToolCalls();

    const call = subagentToolCall($, SUBAGENT, { tool: "Bash", command: "npm test\n--silent" });
    await world.clock.advance(FLUSH_MS);
    const whileRunning = world.agent(SUBAGENT)?.running;
    releaseTool();
    await call;
    await world.clock.advance(FLUSH_MS);

    expect(whileRunning).toEqual([
      { callId: expect.any(String), tool: "Bash", target: "npm test" },
    ]);
    expect(world.agent(SUBAGENT)?.running).toEqual([]);
  });

  test("A9 a file a subagent is reading shows as its target", async ($, on) => {
    const world = engineBeneath(on);
    await world.spawnSubagent($);
    const releaseTool = world.holdToolCalls();

    const call = subagentToolCall($, SUBAGENT, { tool: "Read", file_path: "/repo/src/main.ts" });
    await world.clock.advance(FLUSH_MS);
    const whileRunning = world.agent(SUBAGENT)?.running;
    releaseTool();
    await call;

    expect(whileRunning).toEqual([
      { callId: expect.any(String), tool: "Read", target: "/repo/src/main.ts" },
    ]);
  });

  test("A10 a subagent model request shows its model, effort and tokens", async ($, on) => {
    const world = engineBeneath(on);
    await world.spawnSubagent($);
    world.answerStepsWith(STEP_USAGE);

    await runStep($, {
      turnId: "turn-1",
      index: 0,
      model: "claude-opus-step",
      effort: "high",
      messageCount: 3,
      agentId: SUBAGENT,
    });
    await world.clock.advance(FLUSH_MS);

    expect(world.agent(SUBAGENT)).toMatchObject({
      model: "claude-opus-step",
      effort: "high",
      tokensOut: 50,
      ctxTokens: 1_170,
    });
  });

  test("A11 a changed session cost shows as the new dollar amount", async ($, on) => {
    const world = engineBeneath(on);

    await $.session.measure(measurement(0.42));
    await $.session.measure(measurement(0.5));
    await world.clock.advance(FLUSH_MS);

    expect(world.stored("sessionUsd")).toBe(0.5);
  });
});

describe("update batching", () => {
  test("A2 20 subagent tool calls inside 1 s give one update", async ($, on) => {
    const world = engineBeneath(on);
    await world.spawnSubagent($);
    await world.clock.advance(FLUSH_MS);
    world.forgetUpdates();

    await Promise.all(
      range(20).map((i) => subagentToolCall($, SUBAGENT, { tool: "Bash", command: `echo ${i}` })),
    );
    await world.clock.advance(FLUSH_MS);

    expect(world.updatesTo("agents")).toHaveLength(1);
  });

  test("A12 the same session cost reported twice gives one update", async ($, on) => {
    const world = engineBeneath(on);

    await $.session.measure(measurement(0.42));
    await $.session.measure(measurement(0.42));
    await world.clock.advance(FLUSH_MS);

    expect(world.updatesTo("sessionUsd")).toEqual([0.42]);
  });

  test("A13 two subagents started inside 1 s give one update, and later activity gives a new one", async ($, on) => {
    const world = engineBeneath(on);

    await world.spawnSubagent($);
    await world.spawnSubagent($);
    await world.clock.advance(FLUSH_MS);
    const afterBothSpawns = world.updatesTo("agents");
    await subagentToolCall($, SUBAGENT, { tool: "Bash", command: "ls" });
    await world.clock.advance(FLUSH_MS);

    expect(afterBothSpawns).toHaveLength(1);
    expect(Object.keys(afterBothSpawns[0] as AgentTree)).toEqual([SUBAGENT, SECOND_SUBAGENT]);
    expect(world.updatesTo("agents")).toHaveLength(2);
  });

  test("A15 the 61st subagent pushes out the oldest finished one and 60 stay", async ($, on) => {
    const world = engineBeneath(on);
    await Promise.all(range(61).map(() => world.spawnSubagent($)));
    await $.turn.complete(completion("agent-5", "answer"));
    await world.clock.advance(10);
    await $.turn.complete(completion("agent-9", "answer"));

    await world.clock.advance(FLUSH_MS);

    expect(Object.keys(world.tree())).toHaveLength(60);
    expect(world.agent("agent-5")).toBeUndefined();
    expect(world.agent("agent-9")).toMatchObject({ status: "done" });
  });
});

describe("what is left out", () => {
  test("A4 a refused subagent start records nothing", async ($, on) => {
    const world = engineBeneath(on);
    world.answerSpawnsWith({ deny: "not allowed" });

    const refused = await world.spawnSubagent($);
    await world.spawnSubagent($);
    await world.clock.advance(FLUSH_MS);

    expect(refused).toEqual({ deny: "not allowed" });
    expect(Object.keys(world.tree())).toEqual([SUBAGENT]);
    expect(world.updatesTo("agents")).toHaveLength(1);
  });

  test('A3 a main-chat model request never reaches the tracker, even next to a subagent with the id "undefined"', async ($, on) => {
    const world = engineBeneath(on);
    world.answerSpawnsWith({ model: RESOLVED_MODEL, agentId: "undefined" });
    await world.spawnSubagent($);
    await world.clock.advance(FLUSH_MS);
    world.forgetUpdates();
    world.answerStepsWith(STEP_USAGE);

    await runStep($, { turnId: "turn-1", index: 0, model: "claude-opus-step", messageCount: 3 });
    await world.clock.advance(FLUSH_MS);

    expect(world.agent("undefined")?.tokensOut).toBe(0);
    expect(world.updatesTo("agents")).toHaveLength(0);
  });

  test("A14 a main-chat tool call leaves the tab data untouched and gives no update", async ($, on) => {
    const world = engineBeneath(on);
    await world.spawnSubagent($);
    await world.clock.advance(FLUSH_MS);
    world.forgetUpdates();

    await $.tool.call({ tool: "Bash", command: "ls" });
    await world.clock.advance(FLUSH_MS);

    expect(Object.keys(world.tree())).toEqual([SUBAGENT]);
    expect(world.updatesTo("agents")).toHaveLength(0);
  });
});

describe("failing tools", () => {
  test("A16 a command that fails still fails for the caller and is no longer shown as running", async ($, on) => {
    const world = engineBeneath(on);
    await world.spawnSubagent($);
    world.failToolCalls();

    const call = subagentToolCall($, SUBAGENT, { tool: "Bash", command: "false" });
    await expect(call).rejects.toThrow();
    await world.clock.advance(FLUSH_MS);

    expect(world.agent(SUBAGENT)?.running).toEqual([]);
  });
});

type TrackerWorld = {
  clock: MockClock;
  tree: () => AgentTree;
  agent: (id: string) => AgentNode | undefined;
  stored: (key: string) => unknown;
  updatesTo: (key: string) => unknown[];
  forgetUpdates: () => void;
  spawnSubagent: ($: Engine, overrides?: SpawnOverrides) => Promise<AgentSpawnResult>;
  answerSpawnsWith: (...answers: AgentSpawnResult[]) => void;
  answerStepsWith: (usage: TurnUsage) => void;
  holdToolCalls: () => () => void;
  failToolCalls: () => void;
};

type ToolCall = Parameters<Engine["tool"]["call"]>[0];
type SpawnOverrides = Partial<Parameters<Engine["agent"]["spawn"]>[0]>;

function engineBeneath(on: On): TrackerWorld {
  const clock = mock.clock(on, { now: START });
  const values = new Map<string, { value: unknown; version: number }>();
  const updates: { key: string; value: unknown }[] = [];
  const spawnAnswers: AgentSpawnResult[] = [];
  let spawned = 0;
  let stepUsage: TurnUsage | null = null;
  let toolGate: Promise<void> = Promise.resolve();
  let isToolFailing = false;

  on("state.get", (_$, e) => ({
    value: values.get(e.key) ?? { value: undefined, version: 0 },
  }));
  on("state.set", (_$, e) => {
    const key = e.key;
    const version = (values.get(key)?.version ?? 0) + 1;
    values.set(key, { value: e.value, version });
    updates.push({ key, value: e.value });
    return { value: { isSet: true, version } };
  });
  const kept = new Map<string, unknown>();
  on("store.get", (_$, e) => ({ value: kept.get(e.key) }));
  on("store.set", (_$, e) => {
    kept.set(e.key, JSON.parse(JSON.stringify(e.value)));
    return { value: undefined };
  });
  on("session.id", () => ({ value: "session-one" }));
  on("session.usage", () => ({
    value: {
      startedAt: START,
      context: { window: 200_000 },
      rateLimits: [],
    } as unknown as SessionUsage,
  }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on(
    "agent.spawn",
    () => spawnAnswers.shift() ?? { model: RESOLVED_MODEL, agentId: `agent-${++spawned}` },
  );
  on("tool.call", async (_$, e) => {
    await toolGate;
    if (isToolFailing) throw new Error(`tool ${e.tool} failed`);
    return { result: "ok", text: "ok", ref: 1 };
  });
  on("turn.step", async function* (_$, e) {
    return stepResult(e.turnId, e.index, stepUsage);
  });
  on("turn.complete", (_$, e) => ({ text: e.answer }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("classic.SessionStart", () => ({}));

  const tree = () => (values.get("agents")?.value ?? {}) as AgentTree;

  return {
    clock,
    tree,
    agent: (id) => tree()[id],
    stored: (key) => values.get(key)?.value,
    updatesTo: (key) =>
      updates.filter((update) => update.key === key).map((update) => update.value),
    forgetUpdates: () => updates.splice(0),
    spawnSubagent: async ($, overrides = {}) => $.agent.spawn(spawnInput(overrides)),
    answerSpawnsWith: (...answers) => spawnAnswers.push(...answers),
    answerStepsWith: (usage) => {
      stepUsage = usage;
    },
    holdToolCalls: () => {
      let release = () => {};
      toolGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    failToolCalls: () => {
      isToolFailing = true;
    },
  };
}

function spawnInput(overrides: SpawnOverrides = {}): Parameters<Engine["agent"]["spawn"]>[0] {
  return {
    tool_use_id: "spawn-call",
    prompt: "do the work",
    description: "work",
    subagentType: "general-purpose",
    provider: ENGINE,
    parentModel: "claude-parent-model",
    background: false,
    fork: false,
    ...overrides,
  };
}

function completion(agentId: string, reason: "answer" | "error") {
  return {
    answer: "",
    durationMs: 5,
    isAborted: false,
    turnId: "turn-1",
    agentId,
    reason,
  } as const;
}

function measurement(usd: number): SessionMeasureInput {
  return { context: { window: 200_000 }, rateLimits: [], cost: { usd }, changed: ["cost"] };
}

function subagentToolCall($: Engine, agentId: string, call: ToolCall): Promise<ToolCallResult> {
  return ($.tool.call as (e: object) => Promise<ToolCallResult>)({ ...call, agentId });
}

async function runStep(
  $: Engine,
  step: Parameters<Engine["turn"]["step"]>[0],
): Promise<TurnStepResult> {
  const stream = $.turn.step(step);
  for await (const _chunk of stream) continue;
  return stream.result;
}

function stepResult(turnId: string, index: number, usage: TurnUsage | null): TurnStepResult {
  return { turnId, index, answer: "", toolUses: [], stopReason: "end_turn", usage };
}

function range(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i);
}
