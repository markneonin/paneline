import { describe, expect, mock, test } from "claude-code/testing";
import type { On, SessionContextBreakdown } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { palette } from "../hooks/palette";
import { collect, textOf } from "./draw-tree";
import { lines, serverEntriesOf } from "./mcp-tree";
import type { Node } from "./draw-tree";
import { isHeavy } from "./weight";

type Pane = Mounted<"terminal", "Pane">;

const COLUMNS = 60;
const PANE_ROWS = 40;
const NOW = 200_000;
const SETTLE_TICKS = 5;
const CWD = "/work";
const HEADINGS = ["Project MCPs", "Local MCPs", "User MCPs", "claude.ai", "Built-in MCPs"];

const SERVER_TOOLS = [
  "user-docs",
  "local-notes",
  "proj-db",
  "plugin_runpod_runpod",
  "claude_ai_Trello",
].map((serverName) => ({ name: `mcp__${serverName}__t`, serverName, tokens: 100, isLoaded: true }));

const CLAUDE_CONFIG = {
  mcpServers: { "user-docs": {} },
  projects: {
    [CWD]: { mcpServers: { "local-notes": {} }, disabledMcpjsonServers: ["proj-off"] },
  },
};
const PROJECT_MCP_FILE = { mcpServers: { "proj-db": {}, "proj-off": {} } };

describe("mcp tab groups", () => {
  test("G1 servers sit under the headings /mcp uses, in its order, each under its own scope", async ($, on) => {
    worldOf(on);

    const pane = await paneOnTab($);

    expect(await groupedLabels(pane)).toEqual([
      "Project MCPs",
      "proj-db",
      "proj-off",
      "Local MCPs",
      "local-notes",
      "User MCPs",
      "user-docs",
      "claude.ai",
      "claude_ai_Trello",
      "Built-in MCPs",
      "plugin:runpod:runpod",
    ]);
  });

  test("G2 a group with no servers has no heading", async ($, on) => {
    worldOf(on, {
      tools: SERVER_TOOLS.slice(0, 1),
      projectMcp: {},
      config: { mcpServers: { "user-docs": {} } },
    });

    const pane = await paneOnTab($);

    expect(await groupedLabels(pane)).toEqual(["User MCPs", "user-docs"]);
  });

  test("G3 a group heading is bold in the plain text colour, not periwinkle", async ($, on) => {
    worldOf(on);

    const pane = await paneOnTab($);

    const headings = collect((await pane.drawn()) as unknown as Node, "Text").filter((node) =>
      HEADINGS.includes(textOf(node)),
    );
    expect(headings).toHaveLength(HEADINGS.length);
    for (const heading of headings) {
      expect(isHeavy(heading.props)).toBe(true);
      expect(heading.props?.color).toBe(palette.text);
    }
  });

  test("G4 each group heading is followed by a rule that fills the rest of its row", async ($, on) => {
    worldOf(on);

    const pane = await paneOnTab($);

    const rules = collect((await pane.drawn()) as unknown as Node, "Text").filter(
      (node) => textOf(node).trim().startsWith("─") && node.props?.color === palette.rule,
    );
    const rowCells = rules.map(
      (node, index) => textOf(node).trim().length + HEADINGS[index]!.length + 1,
    );
    expect(rowCells).toHaveLength(HEADINGS.length);
    expect(new Set(rowCells).size).toBe(1);
  });
});

type WorldOptions = { tools?: unknown[]; config?: object; projectMcp?: object };

function worldOf(on: On, options: WorldOptions = {}): void {
  const { tools = SERVER_TOOLS, config = CLAUDE_CONFIG, projectMcp = PROJECT_MCP_FILE } = options;
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
      mcpTools: tools,
    } as unknown as SessionContextBreakdown;
    const context =
      e.breakdown === undefined ? { window: 200_000 } : { window: 200_000, breakdown: full };
    return { value: { startedAt: 0, context, rateLimits: [] } };
  });
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: CWD }));
  on("fs.read", (_$, e) => ({
    value: JSON.stringify(e.path === `${CWD}/.mcp.json` ? projectMcp : config),
  }));
  on("command.run", { command: "mcp" }, () => ({}));
  on("ui.render", { component: "Pane" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine pane</Text>;
  });
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
  const tab = (await pane.findAll({ type: "Button" })).find(
    (button) => button.props.label === "MCP",
  );
  expect(tab, "an MCP tab button").toBeDefined();
  await pane.press({ key: tab?.key ?? "" });
  for (let tick = 0; tick < SETTLE_TICKS; tick++) await pane.redraw();
  return pane;
}

async function groupedLabels(pane: Pane): Promise<string[]> {
  const shown = await lines(pane);
  return shown.flatMap((line) =>
    HEADINGS.includes(line.text) ? [line.text] : serverEntriesOf([line]).map(([, name]) => name),
  );
}
