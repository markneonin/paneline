import { describe, expect, mock, test } from "claude-code/testing";
import type { AgentInfo, On, TurnUsage } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import type { AgentNode, AgentTree } from "../hooks/agents-model";
import { collect, textOf } from "./draw-tree";

type Pane = Mounted<"terminal", "Pane">;
type Listing = { id: string; type: string; description: string; status: string };
type World = {
  listing: Listing[];
  advance: (ms: number) => Promise<void>;
  moveToSession: (id: string) => void;
  lastPollAt: () => number;
  elapsed: () => number;
  stateWrites: (key: string) => unknown[];
  storeWrites: (key: string) => unknown[];
  tree: () => AgentTree;
};

const NOW = 200_000;
const POLL_MS = 1_000;
const FLUSH_MS = 1_000;
const BETWEEN_TICKS_MS = 500;
const LATER_START_MS = 500;
const STEP_MS = 100;
const SETTLE_MS = 100;
const COLUMNS = 100;
const ROWS = 40;
const SPEND_SESSIONS_KEY = "spendSessions";
const AGENTS_TICK_KEY = "agentsTick";
const SESSION_ID = "session-one";
const FRESH_SESSION_ID = "session-two";
const UNSEEN_AGENT = "engine-listed-only";
const STEP_USAGE: TurnUsage = {
  model: "claude-opus-step",
  input_tokens: 100,
  output_tokens: 50,
  cache_read_input_tokens: 1_000,
  cache_creation_input_tokens: 20,
};
const RUNNING_AGENT: Listing = {
  id: "listed-run",
  type: "general-purpose",
  description: "running job",
  status: "running",
};
const WAITING_AGENT: Listing = {
  id: "listed-wait",
  type: "general-purpose",
  description: "waiting job",
  status: "waiting",
};

describe("agents tree writes while the Agents tab polls", () => {
  test("P1 poll ticks with the same running and waiting agents write nothing after the first", async ($, on) => {
    const world = await worldOf($, on, [RUNNING_AGENT, WAITING_AGENT]);
    const pane = await mountPane($);
    await showAgentsTab(pane);
    await world.advance(2 * POLL_MS);
    const afterFirstTick = world.stateWrites("agents").length;

    await world.advance(2 * POLL_MS);

    expect(afterFirstTick).toBe(1);
    expect(world.stateWrites("agents")).toHaveLength(1);
  });

  test("P2 an agent the engine now lists as killed shows as killed by the next tick", async ($, on) => {
    const world = await worldOf($, on, [RUNNING_AGENT]);
    const pane = await mountPane($);
    await showAgentsTab(pane);
    await world.advance(POLL_MS);
    await justAfterTick(world);
    world.listing[0] = { ...RUNNING_AGENT, status: "killed" };

    await justAfterTick(world);

    expect(world.tree()[RUNNING_AGENT.id]?.status).toBe("killed");
  });

  test("P3 a new agent shows within one poll tick and the tree is not written between ticks", async ($, on) => {
    const world = await worldOf($, on, []);
    const pane = await mountPane($);
    await spawnAgent($, "alpha");
    await showAgentsTab(pane);
    await justAfterTick(world);
    const writesBefore = world.stateWrites("agents").length;

    await spawnAgent($, "late arrival");
    await world.advance(BETWEEN_TICKS_MS);
    const writesBetweenTicks = world.stateWrites("agents").length - writesBefore;
    await world.advance(POLL_MS);

    expect(writesBetweenTicks).toBe(0);
    expect(descriptionsIn(world.tree())).toContain("late arrival");
  });

  test("P4 leaving the Agents tab right after an agent event still writes that agent", async ($, on) => {
    const world = await worldOf($, on, []);
    const pane = await mountPane($);
    await spawnAgent($, "alpha");
    await showAgentsTab(pane);
    await justAfterTick(world);

    await spawnAgent($, "late arrival");
    await showTab(pane, "Activity");
    await world.advance(POLL_MS + FLUSH_MS + SETTLE_MS);

    expect(descriptionsIn(world.tree())).toContain("late arrival");
  });

  test("P11 a poll tick that finds a subagent the engine now lists writes the agents tree and no agents tick", async ($, on) => {
    const world = await worldOf($, on, [RUNNING_AGENT]);
    const pane = await mountPane($);
    await showAgentsTab(pane);
    await justAfterTick(world);
    world.listing.push(WAITING_AGENT);
    const treeWritesBefore = world.stateWrites("agents").length;
    const tickWritesBefore = world.stateWrites(AGENTS_TICK_KEY).length;

    await justAfterTick(world);

    expect(world.stateWrites("agents").length - treeWritesBefore).toBe(1);
    expect(world.stateWrites(AGENTS_TICK_KEY).length - tickWritesBefore).toBe(0);
    expect(descriptionsIn(world.tree())).toContain(WAITING_AGENT.description);
  });

  test("P13 with Agents open and nothing changing, a running subagent's time counts up with each tick", async ($, on) => {
    const world = await worldOf($, on, []);
    const pane = await mountPane($);
    await spawnAgent($, "alpha");
    await showAgentsTab(pane);
    await justAfterTick(world);
    const shownBefore = await shownTextOf(pane);

    await world.advance(2 * POLL_MS);

    expect(shownBefore).toMatch(/\b1s\b/);
    expect(await shownTextOf(pane)).toMatch(/\b3s\b/);
  });
});

describe("agents tree writes while the Agents tab is not open", () => {
  test("P5 a new agent is written 1 s after it starts", async ($, on) => {
    const world = await worldOf($, on, []);
    await mountPane($);

    await spawnAgent($, "alpha");
    await world.advance(FLUSH_MS - 1);
    const beforeFlush = world.stateWrites("agents").length;
    await world.advance(1);

    expect(beforeFlush).toBe(0);
    expect(descriptionsIn(world.tree())).toEqual(["alpha"]);
  });

  test("P12 with Agents closed, a subagent started half a second after another is in the tab data one second after the first, in one write", async ($, on) => {
    const world = await worldOf($, on, []);
    await mountPane($);

    await spawnAgent($, "alpha");
    await world.advance(LATER_START_MS);
    await spawnAgent($, "late arrival");
    await world.advance(FLUSH_MS - LATER_START_MS - 1);
    const beforeFlush = world.stateWrites("agents").length;
    await world.advance(1);

    expect(beforeFlush).toBe(0);
    expect(world.stateWrites("agents")).toHaveLength(1);
    expect(descriptionsIn(world.tree()).sort()).toEqual(["alpha", "late arrival"]);
  });
});

describe("subagent spend is written with the agents tree", () => {
  test("P9 a step from an agent the engine lists but never spawned reaches the spend state and the store after the flush", async ($, on) => {
    const world = await worldOf($, on, []);
    await mountPane($);

    await runStep($, UNSEEN_AGENT);
    await world.advance(FLUSH_MS + SETTLE_MS);

    expect(world.stateWrites("spend")).toHaveLength(1);
    expect(storedSessions(world.storeWrites(SPEND_SESSIONS_KEY))).toContain(SESSION_ID);
  });

  test("P10 a step just before /clear is not counted in the fresh session's spend", async ($, on) => {
    const world = await worldOf($, on, []);
    await mountPane($);
    const agentId = await spawnAgent($, "alpha");
    await world.advance(FLUSH_MS);

    await runStep($, agentId);
    world.moveToSession(FRESH_SESSION_ID);
    await $.classic.SessionStart({ source: "clear" });
    await world.advance(FLUSH_MS + SETTLE_MS);

    expect(spendMemoriesOf(world.stateWrites("spend").at(-1))).toEqual([]);
    expect(spendMemoriesOf(world.storeWrites(SPEND_SESSIONS_KEY).at(-1), FRESH_SESSION_ID)).toEqual(
      [],
    );
  });

  test("P6 a subagent step writes no spend state and no store entry until the 1 s flush, and both show it after", async ($, on) => {
    const world = await worldOf($, on, []);
    await mountPane($);
    const agentId = await spawnAgent($, "alpha");
    await world.advance(FLUSH_MS);
    const spendBefore = world.stateWrites("spend").length;
    const storeBefore = world.storeWrites(SPEND_SESSIONS_KEY).length;

    await runStep($, agentId);
    await world.advance(FLUSH_MS - 1);
    const spendAtOnce = world.stateWrites("spend").length - spendBefore;
    const storeAtOnce = world.storeWrites(SPEND_SESSIONS_KEY).length - storeBefore;
    await world.advance(1);

    expect(spendAtOnce).toBe(0);
    expect(storeAtOnce).toBe(0);
    expect(world.stateWrites("spend").length - spendBefore).toBe(1);
    expect(storedSessions(world.storeWrites(SPEND_SESSIONS_KEY))).toContain(SESSION_ID);
  });

  test("P7 three subagent steps inside 1 s give one spend write and one store write, made 1 s after the first", async ($, on) => {
    const world = await worldOf($, on, []);
    await mountPane($);
    const agentId = await spawnAgent($, "alpha");
    await world.advance(FLUSH_MS);
    const spendBefore = world.stateWrites("spend").length;
    const storeBefore = world.storeWrites(SPEND_SESSIONS_KEY).length;

    await runStep($, agentId, 0);
    await runStep($, agentId, 1);
    await runStep($, agentId, 2);
    await world.advance(FLUSH_MS - 1);
    const spendBeforeFlush = world.stateWrites("spend").length - spendBefore;
    await world.advance(1);

    expect(spendBeforeFlush).toBe(0);
    expect(world.stateWrites("spend").length - spendBefore).toBe(1);
    expect(world.storeWrites(SPEND_SESSIONS_KEY).length - storeBefore).toBe(1);
  });

  test("P8 with the Agents tab open a subagent step writes spend at the next tick, not between ticks", async ($, on) => {
    const world = await worldOf($, on, []);
    const pane = await mountPane($);
    const agentId = await spawnAgent($, "alpha");
    await showAgentsTab(pane);
    await justAfterTick(world);
    const spendBefore = world.stateWrites("spend").length;

    await runStep($, agentId);
    await world.advance(BETWEEN_TICKS_MS);
    const spendBetweenTicks = world.stateWrites("spend").length - spendBefore;
    await world.advance(POLL_MS);

    expect(spendBetweenTicks).toBe(0);
    expect(world.stateWrites("spend").length - spendBefore).toBe(1);
  });
});

async function worldOf($: Engine, on: On, listing: Listing[]): Promise<World> {
  const clock = mock.clock(on, { now: NOW });
  mock.env(on, { HOME: "/h/u" });
  const store = new Map<string, unknown>();
  const stateLog: { key: string; value: unknown }[] = [];
  const storeLog: { key: string; value: unknown }[] = [];
  let spawned = 0;
  let elapsed = 0;
  let sessionId = SESSION_ID;
  let polledAt = 0;
  const world: World = {
    listing,
    advance: async (ms) => {
      for (let left = ms; left > 0; left -= STEP_MS) {
        const step = Math.min(left, STEP_MS);
        await clock.advance(step);
        elapsed += step;
      }
    },
    moveToSession: (id) => {
      sessionId = id;
    },
    lastPollAt: () => polledAt,
    elapsed: () => elapsed,
    stateWrites: (key) => stateLog.filter((one) => one.key === key).map((one) => one.value),
    storeWrites: (key) => storeLog.filter((one) => one.key === key).map((one) => one.value),
    tree: () => (stateLog.filter((one) => one.key === "agents").at(-1)?.value ?? {}) as AgentTree,
  };
  on("state.set", (_$, e, next) => {
    stateLog.push({ key: e.key, value: e.value });
    return next(e);
  });
  on("store.get", (_$, e) => ({ value: store.get(e.key) }));
  on("store.set", (_$, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)));
    storeLog.push({ key: e.key, value: store.get(e.key) });
    return { value: undefined };
  });
  on("store.delete", (_$, e) => {
    store.delete(e.key);
    return { value: undefined };
  });
  on("store.keys", () => ({ value: [...store.keys()] }));
  on("session.id", () => ({ value: sessionId }));
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: "/work" }));
  on("agent.spawn", () => ({ model: "sonnet", agentId: `spawned-${++spawned}` }));
  on("agent.list", () => {
    polledAt = elapsed;
    return { value: world.listing as unknown as AgentInfo[] };
  });
  on("turn.step", async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: "",
      toolUses: [],
      stopReason: "end_turn",
      usage: STEP_USAGE,
    };
  });
  on("ui.render", { component: "Pane" }, ($e, e) => {
    const { Text } = $e.ui.resolve(e);
    return <Text>engine pane</Text>;
  });
  await $.classic.SessionStart({ source: "clear" });
  await world.advance(FLUSH_MS + SETTLE_MS);
  stateLog.splice(0);
  storeLog.splice(0);
  return world;
}

async function justAfterTick(world: World): Promise<void> {
  await world.advance(world.lastPollAt() + POLL_MS - world.elapsed() + STEP_MS);
}

async function spawnAgent($: Engine, description: string): Promise<string> {
  const spawn = await $.agent.spawn({
    tool_use_id: `call-${description}`,
    prompt: "do the work",
    description,
    subagentType: "general-purpose",
    provider: "anthropic",
    parentModel: "sonnet",
    background: false,
    fork: false,
  } as never);
  return spawn.agentId ?? "";
}

async function runStep($: Engine, agentId: string, index = 0): Promise<void> {
  const stream = $.turn.step({
    turnId: `run-${agentId}`,
    index,
    model: "claude-opus-step",
    effort: "high",
    messageCount: 1,
    agentId,
  } as never);
  for await (const _chunk of stream) continue;
}

function mountPane($: Engine): Promise<Pane> {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: "session",
    props: {
      title: "Session",
      isFocused: false,
      bodyColumns: COLUMNS,
      placement: "dock",
      scroll: { offset: 0, bodyRows: ROWS },
      view: {},
    },
    viewport: { columns: COLUMNS, rows: ROWS },
  });
}

async function shownTextOf(pane: Pane): Promise<string> {
  return collect(await pane.drawn(), "Text")
    .map(textOf)
    .join("\n");
}

function showAgentsTab(pane: Pane): Promise<void> {
  return showTab(pane, "Agents");
}

async function showTab(pane: Pane, label: string): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const tab = buttons.find((button) => button.props.label === label);
  expect(tab, `the tab bar has a ${label} tab`).toBeDefined();
  await pane.press({ key: tab?.key ?? "" });
}

function descriptionsIn(tree: AgentTree): string[] {
  return Object.values(tree).map((node: AgentNode) => node.description);
}

function storedSessions(writes: unknown[]): string[] {
  const last = writes.at(-1) as Record<string, unknown> | undefined;
  return Object.keys(last ?? {});
}

function spendMemoriesOf(written: unknown, sessionId?: string): string[] {
  const state = sessionId === undefined ? written : (written as Record<string, unknown>)[sessionId];
  const memories = (state as { agentMemories?: Record<string, unknown> } | undefined)
    ?.agentMemories;
  return Object.keys(memories ?? {});
}
