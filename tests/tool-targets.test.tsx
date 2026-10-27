import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, MockClock, Mounted } from "claude-code/testing";

type Pane = Mounted<"terminal", "Pane">;

const COLUMNS = 80;
const FLUSH_MS = 1_000;
const CONTROL_CHARACTER = /\p{Cc}/u;
const BELL = String.fromCharCode(7);
const ESCAPE = String.fromCharCode(27);

describe("control characters in what a tool call names", () => {
  test("T1 a command holding control characters shows as one clean row in the Activity tab", async ($, on) => {
    worldOf(on);
    await $.tool.call({
      tool: "Bash",
      command: `echo ${BELL}ring${ESCAPE}[31m red\nsecond line`,
      tool_use_id: "bell",
    } as never);

    const pane = await mountPane($);

    const rows = (await pane.findAll({ type: "Button" })).filter((button) =>
      String(button.key).startsWith("call-"),
    );
    expect(rows.map((row) => row.props.label)).toEqual(["echo ring[31m red"]);
    await expectDrawnWithoutControlCharacters(pane);
  });

  test("T2 the running command shown in the Now row is the first line, clean", async ($, on) => {
    const clock = worldOf(on);
    const running = $.tool.call({
      tool: "Bash",
      command: `sleep ${BELL}9\nsecond line`,
      tool_use_id: "slow",
    } as never);
    await clock.advance(1);

    const pane = await mountPane($);

    expect(await texts(pane)).toContain("sleep 9");
    release();
    await running;
  });

  test("T3 a subagent description and a Task target hold no control characters", async ($, on) => {
    const clock = worldOf(on);
    await $.agent.spawn({
      tool_use_id: "call-1",
      prompt: "work",
      description: `scan${BELL} repo\nmore`,
      subagentType: "general-purpose",
      provider: "anthropic",
      parentModel: "sonnet",
      background: false,
      fork: false,
    } as never);
    await clock.advance(FLUSH_MS);
    await $.tool.call({
      tool: "Task",
      description: `explore${BELL} it`,
      prompt: "look",
      tool_use_id: "task-1",
    } as never);

    const pane = await mountPane($);
    await pressTab(pane, "Agents");

    expect(await texts(pane)).toContain("scan repo");
    await pressTab(pane, "Activity");
    expect(await texts(pane)).toContain("Task");
    await expectDrawnWithoutControlCharacters(pane);
  });

  test("T4 an MCP server name holding control characters is a clean button label", async ($, on) => {
    worldOf(on, [{ name: "mcp__bad__a", serverName: `bad${BELL}name`, tokens: 1, isLoaded: true }]);

    const pane = await mountPane($);
    await pressTab(pane, "MCP");

    const labels = (await pane.findAll({ type: "Button" })).map((button) => button.key);
    expect(labels).toContain("badname");
    await expectDrawnWithoutControlCharacters(pane);
  });
});

let release: () => void = () => {};

function worldOf(on: On, mcpTools: unknown[] = []): MockClock {
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const clock = mock.clock(on, { now: 100_000 });
  mock.env(on, { HOME: "/h/u" });
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", (_$, e) => {
    const full = {
      categories: [],
      totalTokens: 0,
      rawMaxTokens: 200_000,
      gridRows: [],
      memoryFiles: [],
      agents: [],
      mcpTools,
    };
    const context =
      e.breakdown === undefined ? { window: 200_000 } : { window: 200_000, breakdown: full };
    return { value: { startedAt: 0, context, rateLimits: [] } } as never;
  });
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: "/work" }));
  on("agent.list", () => ({ value: [] }));
  on("agent.spawn", () => ({ model: "sonnet", agentId: "spawned-1" }));
  on("tool.call", async (_$, e) => {
    if ((e as unknown as { tool_use_id: string }).tool_use_id === "slow") await gate;
    return { result: "done", text: "done" };
  });
  on("ui.render", { component: "Pane" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine pane</Text>;
  });
  return clock;
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

async function pressTab(pane: Pane, label: string): Promise<void> {
  const tab = (await pane.findAll({ type: "Button" })).find(
    (button) => button.props.label === label,
  );
  expect(tab, `a ${label} tab`).toBeDefined();
  await pane.press({ key: tab?.key ?? "" });
}

async function texts(pane: Pane): Promise<string[]> {
  const found = await pane.findAll({ type: "Text" });
  return found.map((one) => collectText(one as unknown as { children?: unknown[] }));
}

function collectText(node: { children?: unknown[] }): string {
  return (node.children ?? [])
    .map((child) => (typeof child === "string" ? child : collectText(child as typeof node)))
    .join("");
}

async function expectDrawnWithoutControlCharacters(pane: Pane): Promise<void> {
  expect(JSON.stringify(await pane.drawn())).not.toMatch(CONTROL_CHARACTER);
  expect(await texts(pane)).not.toContain("engine pane");
}
