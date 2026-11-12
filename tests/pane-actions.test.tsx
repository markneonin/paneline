import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, MockClock, Mounted } from "claude-code/testing";

import { pressAction, pressServer } from "./mcp-tree";

type Pane = Mounted<"terminal", "Pane">;
type World = {
  commands: string[];
  toasts: string[];
  listCalls: number;
  failCommands: boolean;
  clock: MockClock;
};

const COLUMNS = 80;
const POLL_MS = 3_000;
const STORE = new Map<string, { value: unknown; version: number }>();

const SERVERS = [
  { name: "mcp__my-server__a", serverName: "my server", tokens: 10, isLoaded: true },
  { name: "mcp__linear__a", serverName: "linear", tokens: 10, isLoaded: true },
];

const RUNNING_AGENT = {
  id: "a",
  type: "general-purpose",
  description: "scan repo",
  background: false,
  model: "sonnet",
  status: "running",
  startedAt: 0,
  ctxTokens: 0,
  running: [],
};

describe("mcp actions", () => {
  test("X1 a rejected mcp command clears the queued mark and shows a toast", async ($, on) => {
    const world = worldOf(on);
    world.failCommands = true;
    const pane = await paneOnTab($, "MCP");

    await press(pane, "linear", 0);
    await press(pane, "disable", 0);
    for (let tick = 0; tick < 5; tick++) await pane.redraw();

    expect(world.commands).toEqual(["disable linear"]);
    expect(world.toasts).toHaveLength(1);
    expect(world.toasts[0]).toContain("/mcp disable linear failed");
    expect(await buttonLabels(pane)).toContain("disable");
  });

  test("X2 a server name with whitespace is never sent as extra arguments", async ($, on) => {
    const world = worldOf(on);
    const pane = await paneOnTab($, "MCP");

    await pressServer(pane, "my server");
    await pressAction(pane, "my server", "disable");

    expect(world.commands).toEqual([]);
    expect(world.toasts).toHaveLength(1);
    expect(world.toasts[0]).toContain("my server");
  });
});

describe("activity chips", () => {
  test("X4 one tool, one file and one error read in the singular", async ($, on) => {
    worldOf(on);
    on("tool.call", () => ({ isError: true, result: "bad", text: "bad" }));
    await $.tool.call({ tool: "Read", file_path: "/work/a.ts", tool_use_id: "r1" } as never);
    const pane = await mountPane($);

    const drawn = JSON.stringify(await pane.drawn());
    expect(drawn).toContain("1 tool");
    expect(drawn).not.toContain("1 tools");
    expect(drawn).not.toContain("1 files");
    expect(drawn).not.toContain("1 errors");
  });
});

describe("agent polling", () => {
  test("X3 opening the Agents tab polls the engine although no agent was spawned in this run", async ($, on) => {
    const world = worldOf(on);
    STORE.set("agents", { value: { a: RUNNING_AGENT }, version: 1 });

    await paneOnTab($, "Agents");
    await world.clock.advance(POLL_MS);

    expect(world.listCalls).toBeGreaterThan(0);
  });
});

function worldOf(on: On): World {
  STORE.clear();
  const clock = mock.clock(on, { now: 10_000 });
  const world: World = { commands: [], toasts: [], listCalls: 0, failCommands: false, clock };
  mock.env(on, { HOME: "/h/u" });
  on("state.get", (_$, e, next) => {
    const seeded = STORE.get(e.key);
    return seeded ? { value: seeded } : next(e);
  });
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("ui.toast", (_$, e) => {
    world.toasts.push(e.text);
    return { value: undefined };
  });
  on("session.usage", (_$, e) => {
    const full = {
      categories: [],
      totalTokens: 0,
      rawMaxTokens: 200_000,
      gridRows: [],
      memoryFiles: [],
      agents: [],
      mcpTools: SERVERS,
    };
    const context =
      e.breakdown === undefined ? { window: 200_000 } : { window: 200_000, breakdown: full };
    return { value: { startedAt: 0, context, rateLimits: [] } } as never;
  });
  on("session.model", () => ({ value: "opus" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: "/work" }));
  on("agent.list", () => {
    world.listCalls++;
    return { value: [] };
  });
  on("command.run", { command: "mcp" }, (_$, e) => {
    world.commands.push(e.args);
    if (world.failCommands) throw new Error("refused");
    return {};
  });
  on("ui.render", { component: "Pane" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine pane</Text>;
  });
  return world;
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
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
    viewport: { columns: COLUMNS, rows: 40 },
  });
}

async function paneOnTab($: Engine, label: string): Promise<Pane> {
  const pane = await mountPane($);
  await press(pane, label, 0);
  return pane;
}

async function press(pane: Pane, label: string, index: number): Promise<void> {
  const target = (await pane.findAll({ type: "Button" })).filter(
    (button) =>
      (["❯", "›"].includes(String(button.props.label)) ? button.key : button.props.label) === label,
  )[index];
  expect(target, `a ${label} button`).toBeDefined();
  await pane.press({ key: target?.key ?? "" });
}

async function buttonLabels(pane: Pane): Promise<unknown[]> {
  return (await pane.findAll({ type: "Button" })).map((button) => button.props.label);
}
