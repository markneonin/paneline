import { describe, expect, mock, test } from "claude-code/testing";
import type { On, SessionContextBreakdown } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { pressPagedTab } from "./clear-world";
import { lines, serverEntriesOf } from "./mcp-tree";

type Pane = Mounted<"terminal", "Pane">;

const COLUMNS = 60;
const PANE_ROWS = 40;
const NOW = 200_000;
const SETTLE_TICKS = 5;
const CWD = "/work";

const LINEAR = [{ name: "mcp__linear__a", serverName: "linear", tokens: 700, isLoaded: true }];

describe("mcp tab disabled servers", () => {
  test("D1 servers the project config lists as disabled show as hollow rows in their group", async ($, on) => {
    worldOf(on, {
      disabledMcpServers: ["plugin:runpod:runpod", "claude.ai Trello", "my_server"],
      disabledMcpjsonServers: ["from-mcp-json"],
    });

    const pane = await paneOnTab($);

    expect(serverEntriesOf(await lines(pane))).toEqual([
      ["○", "claude.ai Trello"],
      ["✔", "linear"],
      ["○", "plugin:runpod:runpod"],
      ["○", "my_server"],
      ["○", "from-mcp-json"],
    ]);
    expect(await textCount(pane, "5 servers")).toBe(1);
  });

  test("D2 a disabled server offers enable and pressing it runs the mcp enable command under its listed name", async ($, on) => {
    const world = worldOf(on, { disabledMcpServers: ["plugin:runpod:runpod"] });
    const pane = await paneOnTab($);

    await pressNth(pane, "plugin:runpod:runpod");
    expect(await buttonLabels(pane)).toContain("enable");
    await pressNth(pane, "enable");

    expect(world.commands).toEqual(["enable plugin:runpod:runpod"]);
  });

  test("D3 a listed disabled server that is connected is shown once as connected", async ($, on) => {
    worldOf(on, { disabledMcpServers: ["linear"] });

    const pane = await paneOnTab($);

    expect((await buttonLabels(pane)).filter((label) => label === "linear")).toHaveLength(1);
    expect(await textCount(pane, "1 server")).toBe(1);
  });

  test("D5 a session started in a subfolder of the project lists the project's disabled servers", async ($, on) => {
    worldOf(on, { disabledMcpServers: ["demo-two"] }, `${CWD}/sub/deeper`);

    const pane = await paneOnTab($);

    expect(await buttonLabels(pane)).toContain("demo-two");
  });

  test("D4 a project without a disabled list adds no rows", async ($, on) => {
    worldOf(on, {});

    const pane = await paneOnTab($);

    expect(await textCount(pane, "1 server")).toBe(1);
  });
});

type World = { commands: string[] };

function worldOf(on: On, project: Record<string, string[]>, cwd = CWD): World {
  const world: World = { commands: [] };
  mock.clock(on, { now: NOW });
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
      mcpTools: LINEAR,
    } as unknown as SessionContextBreakdown;
    const context =
      e.breakdown === undefined ? { window: 200_000 } : { window: 200_000, breakdown: full };
    return { value: { startedAt: 0, context, rateLimits: [] } };
  });
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.model", () => ({ value: "opus" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: cwd }));
  on("fs.read", () => {
    return {
      value: JSON.stringify({
        projects: { [CWD]: project, "/other": { disabledMcpServers: ["x"] } },
      }),
    };
  });
  on("command.run", { command: "mcp" }, (_$, e) => {
    world.commands.push(e.args);
    return {};
  });
  on("ui.render", { component: "Pane" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine pane</Text>;
  });
  return world;
}

async function paneOnTab($: Engine): Promise<Pane> {
  const pane = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: "session",
    props: {
      title: "Session",
      isFocused: false,
      bodyColumns: COLUMNS,
      placement: "dock",
      scroll: { offset: 0, bodyRows: PANE_ROWS },
      view: {},
    },
    viewport: { columns: COLUMNS, rows: PANE_ROWS },
  });
  await pressPagedTab(pane, "MCP");
  for (let tick = 0; tick < SETTLE_TICKS; tick++) await pane.redraw();
  return pane;
}

async function pressNth(pane: Pane, label: string): Promise<void> {
  const target = (await pane.findAll({ type: "Button" })).find(
    (button) => labelOf(button) === label,
  );
  expect(target, `a ${label} button`).toBeDefined();
  await pane.press({ key: target?.key ?? "" });
}

async function buttonLabels(pane: Pane): Promise<unknown[]> {
  return (await pane.findAll({ type: "Button" })).map(labelOf);
}

async function textCount(pane: Pane, text: string): Promise<number> {
  return (await pane.findAll({ type: "Text", text })).length;
}

function labelOf(button: { key?: string; props: Record<string, unknown> }): unknown {
  return ["❯", "›"].includes(String(button.props.label)) ? button.key : button.props.label;
}
