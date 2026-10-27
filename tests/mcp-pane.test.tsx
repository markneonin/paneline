import { describe, expect, mock, test } from "claude-code/testing";
import type { On, SessionContextBreakdown } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { palette } from "../hooks/palette";
import {
  bodyOf,
  hollowRowOf,
  lines,
  pressAction,
  pressServer,
  rowOrFail,
  serverEntriesOf,
  summaryOf,
} from "./mcp-tree";
import { isHeavy } from "./weight";

type Pane = Mounted<"terminal", "Pane">;
type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] };
type World = {
  usageCalls: number;
  commands: string[];
  breakdown: { mcpTools: unknown[] };
  configDisabled: string[] | undefined;
  finishCommands: () => void;
};

const COLUMNS = 60;
const PANE_ROWS = 40;
const NOW = 200_000;
const SETTLE_TICKS = 5;

const LINEAR_AND_DOCS = [
  { name: "mcp__linear__a", serverName: "linear", tokens: 700, isLoaded: true },
  { name: "mcp__linear__b", serverName: "linear", tokens: 800, isLoaded: true },
  { name: "mcp__docs__c", serverName: "docs", tokens: 400, isLoaded: false },
];

describe("mcp tab", () => {
  test("M1 the tab opens with a title, the server count, and one closed row per server with its tool count", async ($, on) => {
    worldOf(on);

    const pane = await paneOnTab($, "MCP");

    const shown = await lines(pane);
    const rows = await rowTexts(pane);
    expect(rows).toContain("Manage MCP servers");
    expect(rows).toContain("2 servers");
    expect([summaryOf(shown, "linear"), summaryOf(shown, "docs")]).toEqual([
      { glyph: "▸", tools: "2 tools", uses: "0 uses" },
      { glyph: "▸", tools: "1 tool", uses: "0 uses" },
    ]);
    expect(await buttonLabels(pane)).toEqual(expect.arrayContaining(["linear", "docs"]));
    expect(await colorsOf(pane, "Manage MCP servers")).toEqual([palette.userText]);
  });

  test("M2 the counts column is aligned and a connected server shows a green check", async ($, on) => {
    const world = worldOf(on);
    world.breakdown.mcpTools = [
      ...LINEAR_AND_DOCS,
      ...Array.from({ length: 10 }, (_, i) => ({
        name: `mcp__big__${i}`,
        serverName: "big",
        tokens: 1,
        isLoaded: true,
      })),
    ];

    const pane = await paneOnTab($, "MCP");

    const columns = (await pane.findAll({ type: "Box" })).filter(
      (box) => box.props.justifyContent === "flex-end",
    );
    expect(columns.map((box) => box.props.width)).toEqual([
      "10 tools · 0 uses".length,
      "10 tools · 0 uses".length,
      "10 tools · 0 uses".length,
    ]);
    expect((await colorsOf(pane, "✔")).filter((color) => color !== undefined)).toEqual([
      palette.ok,
      palette.ok,
      palette.ok,
    ]);
  });

  test("M3 clicking a server opens it and shows its actions on one row under it, the other servers stay closed", async ($, on) => {
    worldOf(on);
    const pane = await paneOnTab($, "MCP");
    const labelsBefore = await buttonLabels(pane);

    await pressServer(pane, "docs");

    const shown = await lines(pane);
    expect(labelsBefore).not.toContain("reconnect");
    expect(labelsBefore).not.toContain("disable");
    expect(summaryOf(shown, "docs").glyph).toBe("▾");
    expect(bodyOf(shown, "docs")[0]?.text).toBe("reconnect disable");
    expect(bodyOf(shown, "linear")).toEqual([]);
    expect((await buttonLabels(pane)).filter((label) => label === "reconnect")).toHaveLength(1);
  });

  test("M4 pressing an action runs the mcp command and marks the server queued", async ($, on) => {
    const world = worldOf(on);
    const pane = await paneOnTab($, "MCP");
    await pressServer(pane, "linear");

    await pressAction(pane, "linear", "reconnect");

    expect(world.commands).toEqual(["reconnect linear"]);
    expect((await rowTexts(pane)).some((text) => /✔\s*linear\s*queued$/u.test(text))).toBe(true);
    await finishCommands(world, pane);
    await pane.redraw();
    expect(rowOrFail(await lines(pane), "linear").tools).toBe("2 tools");
  });

  test("M4b a server that left the tool list stays listed with a hollow circle and an enable button when opened", async ($, on) => {
    const world = worldOf(on);
    const pane = await paneOnTab($, "MCP");
    await pressServer(pane, "linear");
    await pressAction(pane, "linear", "disable");
    await finishCommands(world, pane);
    await pressServer(pane, "linear");
    world.breakdown.mcpTools = LINEAR_AND_DOCS.filter((tool) => tool.serverName === "docs");
    await $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: [] });
    await pane.redraw();

    const hollow = hollowRowOf(await lines(pane), "linear");
    await pressServer(pane, "linear");
    const offered = await buttonLabels(pane);
    await pressAction(pane, "linear", "enable");

    expect(hollow).toBeDefined();
    expect(offered).toContain("enable");
    expect(world.commands).toEqual(["disable linear", "enable linear"]);
  });

  test("M4c a long server name shrinks to the room left and its row stays one line", async ($, on) => {
    const world = worldOf(on);
    world.breakdown.mcpTools = [
      {
        name: "x",
        serverName: "a-very-long-server-name-that-cannot-fit-in-the-pane-at-all",
        tokens: 10,
        isLoaded: true,
      },
    ];

    const pane = await paneOnTab($, "MCP");

    const boxes = await pane.findAll({ type: "Box" });
    const row = boxes.find((box) => String(box.props.key).endsWith("-name"));
    const nameCells = boxes.filter((box) => box.props.minWidth === 0);
    expect(row?.props.height).toBe(1);
    expect(nameCells).toHaveLength(1);
    expect(nameCells[0]?.props.flexShrink).toBe(1);
    expect(boxes.find((box) => box.props.justifyContent === "flex-end")?.props.flexShrink).toBe(0);
  });

  test("M4d a plugin server shows and is sent under the name /mcp lists, a plain server stays as it is", async ($, on) => {
    const world = worldOf(on);
    world.breakdown.mcpTools = [
      {
        name: "mcp__plugin_runpod_runpod__list-pods",
        serverName: "plugin_runpod_runpod",
        tokens: 10,
        isLoaded: true,
      },
      {
        name: "mcp__claude-in-chrome__tabs",
        serverName: "claude-in-chrome",
        tokens: 10,
        isLoaded: true,
      },
    ];
    const pane = await paneOnTab($, "MCP");

    expect(serverEntriesOf(await lines(pane)).map(([, name]) => name)).toEqual(
      expect.arrayContaining(["plugin:runpod:runpod", "claude-in-chrome"]),
    );
    await pressServer(pane, "plugin:runpod:runpod");
    await pressAction(pane, "plugin:runpod:runpod", "disable");
    expect(world.commands).toEqual(["disable plugin:runpod:runpod"]);
    await finishCommands(world, pane);
    await pressServer(pane, "claude-in-chrome");
    await pressAction(pane, "claude-in-chrome", "disable");
    expect(world.commands).toEqual(["disable plugin:runpod:runpod", "disable claude-in-chrome"]);
  });

  test("M5 no breakdown is asked for while another tab is shown", async ($, on) => {
    const world = worldOf(on);

    const pane = await mountPane($);
    await $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: ["context"] });
    await pressTab(pane, "Files");
    await $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: ["context"] });

    expect(world.usageCalls).toBe(0);
  });

  test("M6 one blank row sits between the tab row and the content, and there is no rule", async ($, on) => {
    worldOf(on);

    const pane = await paneOnTab($, "MCP");

    const [tabBlock, body] = elementsIn(await pane.drawn());
    const [tabRow, blankRow] = elementsIn(tabBlock as Node);
    expect(elementsIn(tabBlock as Node)).toHaveLength(2);
    expect(tabRow?.props?.height).toBe(1);
    expect(blankRow?.props?.height).toBe(1);
    expect(textOf(blankRow as Node)).toBe("");
    expect(textOf(body as Node)).not.toBe("");
  });

  test("M7 the active tab is a filled block of the session accent with bold dark text, the other tabs are dim buttons", async ($, on) => {
    worldOf(on);

    const pane = await paneOnTab($, "MCP");

    const filled = (await pane.findAll({ type: "Text" })).filter(
      (text) => text.props.backgroundColor === "promptBorder",
    );
    expect(filled.map((text) => text.props.color)).toEqual([
      "clawd_background",
      "clawd_background",
      "clawd_background",
    ]);
    expect(filled.filter((text) => isHeavy(text.props))).toHaveLength(1);
    const dim = (await pane.findAll({ type: "Button" })).filter(
      (button) =>
        button.props.dimColor === true &&
        ["Activity", "Files"].includes(String(button.props.label)),
    );
    expect(dim).toHaveLength(2);
  });

  test("M8 a measure that changes no unit redraws the open MCP tab with the new tool count, with no press or redraw", async ($, on) => {
    const world = worldOf(on);
    const pane = await paneOnTab($, "MCP");
    expect(rowOrFail(await lines(pane), "linear").tools).toBe("2 tools");
    world.breakdown.mcpTools = [
      ...LINEAR_AND_DOCS,
      { name: "mcp__linear__c", serverName: "linear", tokens: 900, isLoaded: true },
    ];

    await $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: [] });

    expect(rowOrFail(await lines(pane), "linear").tools).toBe("3 tools");
  });

  test("M9 after a disable command finishes the queued mark goes and a server the config now disables shows as hollow with enable", async ($, on) => {
    const world = worldOf(on);
    const pane = await paneOnTab($, "MCP");
    await pressServer(pane, "linear");
    await pressAction(pane, "linear", "disable");
    expect((await rowTexts(pane)).some((text) => /✔\s*linear\s*queued$/u.test(text))).toBe(true);
    world.configDisabled = ["docs-extra"];

    await finishCommands(world, pane);

    expect((await rowTexts(pane)).some((text) => text.includes("queued"))).toBe(false);
    expect(hollowRowOf(await lines(pane), "docs-extra")).toBeDefined();
    await pressNth(pane, "docs-extra", 0);
    expect(await buttonLabels(pane)).toContain("enable");
  });
});

async function finishCommands(world: World, pane: Pane): Promise<void> {
  world.finishCommands();
  for (let tick = 0; tick < SETTLE_TICKS; tick++) await pane.redraw();
}

function worldOf(on: On): World {
  let finishCommands: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    finishCommands = resolve;
  });
  const world: World = {
    usageCalls: 0,
    commands: [],
    breakdown: { mcpTools: LINEAR_AND_DOCS },
    configDisabled: undefined,
    finishCommands,
  };
  mock.clock(on, { now: NOW });
  mock.env(on, { HOME: "/h/u" });
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", (_$, e) => {
    if (e.breakdown !== undefined) world.usageCalls++;
    const full = {
      categories: [],
      totalTokens: 0,
      rawMaxTokens: 200_000,
      gridRows: [],
      memoryFiles: [],
      agents: [],
      ...world.breakdown,
    } as unknown as SessionContextBreakdown;
    const context =
      e.breakdown === undefined ? { window: 200_000 } : { window: 200_000, breakdown: full };
    return { value: { startedAt: 0, context, rateLimits: [] } };
  });
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: "/work" }));
  on("fs.read", (_$, e, next) => {
    if (world.configDisabled === undefined || !e.path.endsWith(".claude.json")) return next(e);
    return {
      value: JSON.stringify({
        projects: { "/work": { disabledMcpServers: world.configDisabled } },
      }),
    };
  });
  on("command.run", { command: "mcp" }, async (_$, e) => {
    world.commands.push(e.args);
    await gate;
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
      scroll: { offset: 0, bodyRows: PANE_ROWS },
      view: {},
    },
    viewport: { columns: COLUMNS, rows: PANE_ROWS },
  });
}

async function paneOnTab($: Engine, label: string): Promise<Pane> {
  const pane = await mountPane($);
  await pressTab(pane, label);
  return pane;
}

async function pressTab(pane: Pane, label: string): Promise<void> {
  await pressNth(pane, label, 0);
}

async function pressNth(pane: Pane, label: string, index: number): Promise<void> {
  const target = (await pane.findAll({ type: "Button" })).filter(
    (button) => labelOf(button) === label,
  )[index];
  expect(target, `a ${label} button`).toBeDefined();
  await pane.press({ key: target?.key ?? "" });
}

async function buttonLabels(pane: Pane): Promise<unknown[]> {
  return (await pane.findAll({ type: "Button" })).map(labelOf);
}

async function colorsOf(pane: Pane, text: string): Promise<unknown[]> {
  const found = await pane.findAll({ type: "Text", text });
  return found.map((one) => one.props.color);
}

async function rowTexts(pane: Pane): Promise<string[]> {
  return rowsOf((await pane.drawn()) as unknown as Node)
    .map(textOf)
    .filter((text) => text !== "");
}

function rowsOf(node: Node): Node[] {
  if (node.type === "Text") return [node];
  if (isRow(node) && !holdsColumn(node)) return [node];
  return elementsIn(node).flatMap(rowsOf);
}

function isRow(node: Node): boolean {
  return (
    node.type === "Box" && !["column", "column-reverse"].includes(String(node.props?.flexDirection))
  );
}

function holdsColumn(node: Node): boolean {
  return elementsIn(node).some(
    (child) => (child.type === "Box" && !isRow(child)) || holdsColumn(child),
  );
}

function elementsIn(node: Node): Node[] {
  return (node.children ?? []).filter(
    (child): child is Node => typeof child === "object" && child !== null,
  );
}

function textOf(node: Node): string {
  if (node.type === "Button") return String(node.props?.label);
  return (node.children ?? [])
    .map((child) => (typeof child === "string" ? child : textOf(child as Node)))
    .join("");
}

function labelOf(button: { key?: string; props: Record<string, unknown> }): unknown {
  return ["❯", "›"].includes(String(button.props.label)) ? button.key : button.props.label;
}
