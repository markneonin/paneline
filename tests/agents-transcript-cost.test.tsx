import { describe, expect, mock, test } from "claude-code/testing";
import type { On, SessionMessage } from "claude-code";
import type { Engine, MockClock, Mounted } from "claude-code/testing";

import type { AgentNode } from "../types";
import { linesOf } from "./skills-tree";

type Pane = Mounted<"terminal", "Pane">;
type World = {
  clock: MockClock;
  transcripts: Map<string, SessionMessage[]>;
  reads: string[];
};

const NOW = 200_000;
const COLUMNS = 100;
const ROWS = 40;
const SECOND = 1_000;
const SETTLE_TICKS = 5;
const TICKS = 4;
const LONG_COUNT = 300;
const MIDDLE_OFFSET = 450;
const EVERYTHING_ROWS = 5_000;
const NEAR_SCREENS = 3;
const store = new Map<string, { value: unknown; version: number }>();

describe("agent transcript cost", () => {
  test("K1 with an agent open and nothing new about it, several renders and ticks read its transcript once in total", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go")]);
    const pane = await paneWithAgents($, [runningAgent("a", "alpha")]);

    await openTranscript(pane, "alpha");
    await tick(world, pane);

    expect(world.reads).toEqual(["a"]);
  });

  test("K2 a new message and more tokens for the open agent show up and cost exactly one more read", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go")]);
    const pane = await paneWithAgents($, [runningAgent("a", "alpha")]);
    await openTranscript(pane, "alpha");

    world.transcripts.set("a", [message("user", "go"), message("assistant", "fresh news")]);
    await writeAgents([runningAgent("a", "alpha", { ctxTokens: 500 })]);
    await tick(world, pane);

    expect(world.reads).toEqual(["a", "a"]);
    expect((await rowTexts(pane)).some((row) => row.includes("fresh news"))).toBe(true);
  });

  test("K3 opening another agent reads that agent's transcript and does not read the first one again", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go")]);
    world.transcripts.set("b", [message("user", "other job")]);
    const pane = await paneWithAgents($, [runningAgent("a", "alpha"), runningAgent("b", "bravo")]);
    await openTranscript(pane, "alpha");

    await pressButton(pane, "back");
    await openTranscript(pane, "bravo");
    await tick(world, pane);

    expect(world.reads).toEqual(["a", "b"]);
    expect((await rowTexts(pane)).some((row) => row.includes("other job"))).toBe(true);
  });

  test("K4 when only a different agent changes, the open transcript is not read again", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go")]);
    const pane = await paneWithAgents($, [runningAgent("a", "alpha"), runningAgent("b", "bravo")]);
    await openTranscript(pane, "alpha");

    await writeAgents([runningAgent("a", "alpha"), runningAgent("b", "bravo", { ctxTokens: 900 })]);
    await tick(world, pane);

    expect(world.reads).toEqual(["a"]);
  });

  test("K5 an expanded 300-message transcript scrolled to the middle draws only the rows near the scroll position", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", longTranscript());
    await expandOnly($);

    const rows = await rowsAt($, MIDDLE_OFFSET, ROWS);

    expect(drawnCount(rows)).toBeGreaterThan(0);
    expect(drawnCount(rows)).toBeLessThanOrEqual(NEAR_SCREENS * ROWS);
  });

  test("K6 the rows an expanded 300-message transcript draws in the middle of the scroll are the same text at the same place as the view that draws everything", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", longTranscript());
    await expandOnly($);
    const everything = await rowsAt($, 0, EVERYTHING_ROWS);

    const rows = await rowsAt($, MIDDLE_OFFSET, ROWS);

    expect(rows).toHaveLength(everything.length);
    expect(drawnCount(rows)).toBeLessThan(drawnCount(everything));
    expect(rows.slice(MIDDLE_OFFSET, MIDDLE_OFFSET + ROWS)).toEqual(
      everything.slice(MIDDLE_OFFSET, MIDDLE_OFFSET + ROWS),
    );
  });

  test("K7 the rows an expanded 300-message transcript draws at the bottom of the scroll are the same text at the same place as the view that draws everything", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", longTranscript());
    await expandOnly($);
    const everything = await rowsAt($, 0, EVERYTHING_ROWS);
    const bottom = everything.length - ROWS;

    const rows = await rowsAt($, bottom, ROWS);

    expect(rows).toHaveLength(everything.length);
    expect(drawnCount(rows)).toBeLessThan(drawnCount(everything));
    expect(rows.slice(bottom)).toEqual(everything.slice(bottom));
    expect(rows.some((row) => row.includes(`message ${LONG_COUNT - 1}`))).toBe(true);
  });
});

function worldOf(on: On): World {
  store.clear();
  const world: World = { clock: mock.clock(on, { now: NOW }), transcripts: new Map(), reads: [] };
  mock.env(on, { HOME: "/h/u" });
  on("state.get", (_$, e, next) => {
    const seeded = store.get(e.key);
    return seeded ? { value: seeded } : next(e);
  });
  on("state.set", (_$, e, next) => {
    store.delete(e.key);
    return next(e);
  });
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: "/work" }));
  on("agent.list", () => ({ value: [] }));
  on("session.messages", (_$, e) => {
    const id = String((e as { agentId?: string }).agentId);
    world.reads.push(id);
    const found = world.transcripts.get(id);
    return { value: found === undefined ? { deny: "unknown agent" } : [...found] };
  });
  on("ui.render", { component: "Pane" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine pane</Text>;
  });
  return world;
}

function message(role: "user" | "assistant", text: string): SessionMessage {
  return { role, text, toolUses: [] };
}

function longTranscript(): SessionMessage[] {
  return Array.from({ length: LONG_COUNT }, (_, i) =>
    message(i % 2 === 0 ? "user" : "assistant", `message ${i}`),
  );
}

function runningAgent(id: string, description: string, fields: Partial<AgentNode> = {}): AgentNode {
  return {
    id,
    type: "general-purpose",
    description,
    background: false,
    model: "",
    status: "running",
    startedAt: NOW - 5_000,
    ctxTokens: 0,
    running: [],
    ...fields,
  };
}

async function writeAgents(agents: AgentNode[]): Promise<void> {
  const value = Object.fromEntries(agents.map((one) => [one.id, one]));
  store.set("agents", { value, version: (store.get("agents")?.version ?? 0) + 1 });
}

async function mountBare($: Engine, offset: number, bodyRows: number): Promise<Pane> {
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
      scroll: { offset, bodyRows },
      view: {},
    },
    viewport: { columns: COLUMNS, rows: ROWS },
  });
}

async function paneWithAgents($: Engine, agents: AgentNode[]): Promise<Pane> {
  await writeAgents(agents);
  const pane = await mountBare($, 0, ROWS);
  await pressButton(pane, "Agents");
  return pane;
}

async function expandOnly($: Engine): Promise<void> {
  const pane = await paneWithAgents($, [runningAgent("a", "alpha")]);
  await openTranscript(pane, "alpha");
  const earlier = (await buttonLabels(pane)).find((label) => /^\d+ earlier$/.test(label));
  expect(earlier, "an earlier button").toBeDefined();
  await pressButton(pane, earlier ?? "");
  await pane.unmount();
}

async function rowsAt($: Engine, offset: number, bodyRows: number): Promise<string[]> {
  const pane = await mountBare($, offset, bodyRows);
  await settle(pane);
  const rows = await rowsOf(pane);
  await pane.unmount();
  return rows;
}

async function openTranscript(pane: Pane, title: string): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const target = buttons.find((button) => String(button.props.label).includes(title));
  expect(target, `a title button for ${title}`).toBeDefined();
  await pane.press({ key: target?.key ?? "" });
  await settle(pane);
}

async function pressButton(pane: Pane, label: string): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const target = buttons.find((button) => button.props.label === label);
  expect(target, `a ${label} button`).toBeDefined();
  await pane.press({ key: target?.key ?? "" });
  await settle(pane);
}

async function settle(pane: Pane): Promise<void> {
  for (let step = 0; step < SETTLE_TICKS; step++) await pane.redraw();
}

async function tick(world: World, pane: Pane): Promise<void> {
  for (let step = 0; step < TICKS; step++) {
    await world.clock.advance(SECOND);
    await settle(pane);
  }
}

async function buttonLabels(pane: Pane): Promise<string[]> {
  return (await pane.findAll({ type: "Button" })).map((button) => String(button.props.label));
}

async function rowsOf(pane: Pane): Promise<string[]> {
  return linesOf(await pane.drawn()).map((line) => line.text);
}

function drawnCount(rows: string[]): number {
  return rows.filter((row) => row.trim() !== "").length;
}

async function rowTexts(pane: Pane): Promise<string[]> {
  return (await rowsOf(pane)).filter((text) => text !== "");
}
