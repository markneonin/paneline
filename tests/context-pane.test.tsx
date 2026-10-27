import { describe, expect, mock, test } from "claude-code/testing";
import type { On, SessionContextBreakdown } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { palette } from "../hooks/palette";

type Pane = Mounted<"terminal", "Pane">;
type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] };
type UsageCall = { breakdown?: string; columns?: number };

const COLUMNS = 100;
const NARROW_COLUMNS = 16;
const MID_COLUMNS = 50;
const FULL_GRID_COLUMNS = 80;
const TALL_PANE_ROWS = 60;
const SHORT_PANE_ROWS = 8;
const NOW = 200_000;

const FIXTURE = {
  categories: [
    {
      name: "System prompt",
      tokens: 8_000,
      color: "promptBorder",
      isDeferred: false,
      kind: "used",
    },
    {
      name: "MCP tools (deferred)",
      tokens: 30_000,
      color: "success",
      isDeferred: true,
      kind: "deferred",
    },
    { name: "Messages", tokens: 40_000, color: "permission", isDeferred: false, kind: "used" },
    {
      name: "Autocompact buffer",
      tokens: 40_000,
      color: "inactive",
      isDeferred: false,
      kind: "buffer",
    },
    { name: "Free space", tokens: 112_000, color: "subtle", isDeferred: false, kind: "free" },
  ],
  totalTokens: 48_000,
  maxTokens: 200_000,
  rawMaxTokens: 200_000,
  percentage: 24,
  model: "Opus 5.5",
  gridRows: [
    [
      { color: "promptBorder", categoryName: "System prompt", squareFullness: 1 },
      { color: "permission", categoryName: "Messages", squareFullness: 1 },
      { color: "permission", categoryName: "Messages", squareFullness: 0.4 },
      { color: "subtle", categoryName: "Free space", squareFullness: 1 },
      { color: "inactive", categoryName: "Autocompact buffer", squareFullness: 1 },
    ],
  ],
  memoryFiles: [
    { path: "/home/u/CLAUDE.md", type: "User", tokens: 1_200 },
    { path: "/work/AGENTS.md", type: "Project", tokens: 300 },
  ],
  mcpTools: [
    { name: "mcp__linear__a", serverName: "linear", tokens: 0, isLoaded: false },
    { name: "mcp__linear__b", serverName: "linear", tokens: 0, isLoaded: false },
    { name: "mcp__docs__c", serverName: "docs", tokens: 0, isLoaded: false },
  ],
  agents: [{ agentType: "reviewer", source: "projectSettings", tokens: 900 }],
  skills: { totalSkills: 9, includedSkills: 7, tokens: 2_500, skillFrontmatter: [] },
  autoCompactThreshold: 160_000,
  isAutoCompactEnabled: true,
} as unknown as SessionContextBreakdown;

describe("context tab", () => {
  test("C1 the header shows the model, then used over the window with the engine percent and one decimal of k", async ($, on) => {
    worldOf(on);

    const rows = await rowTexts(await paneOnTab($, "Context"));

    expect(rows).toContain("Opus 5.5");
    expect(rows).toContain("48k/200k tokens (24%)");
  });

  test("C2 the grid is drawn glyph by glyph, the partial square as a small jar, free and buffer as their own glyphs", async ($, on) => {
    worldOf(on);

    const pane = await paneOnTab($, "Context");

    const gridRow = (await pane.findAll({ type: "Text" })).find(
      (found) => textOf(found as Node) === "⛁ ⛁ ⛀ ⛶ ⛝",
    ) as Node | undefined;
    expect(gridRow).toBeDefined();
  });

  test("TH6 every grid square is drawn in the colour the engine gives its category", async ($, on) => {
    worldOf(on);

    const pane = await paneOnTab($, "Context");

    const gridRow = (await pane.findAll({ type: "Text" })).find(
      (found) => textOf(found as Node) === "⛁ ⛁ ⛀ ⛶ ⛝",
    ) as Node;
    expect(elementsIn(gridRow).map((square) => square.props?.color)).toEqual([
      "promptBorder",
      "permission",
      "permission",
      "subtle",
      "inactive",
    ]);
  });

  test("TH6b every legend glyph is drawn in the colour the engine gives its category", async ($, on) => {
    worldOf(on);

    const pane = await paneOnTab($, "Context");

    expect(await legendGlyphColors(pane)).toEqual({
      Messages: "permission",
      "System prompt": "promptBorder",
      "Free space": "subtle",
      "Autocompact buffer": "inactive",
    });
  });

  test("C3 the legend lists non-deferred categories by tokens descending with free space and the buffer last and numbers muted", async ($, on) => {
    worldOf(on);

    const pane = await paneOnTab($, "Context");

    const rows = await rowTexts(pane);
    expect(rows.filter((row) => row.includes(": "))).toEqual([
      "⛁ Messages: 40k tokens (20.0%)",
      "⛁ System prompt: 8k tokens (4.0%)",
      "⛶ Free space: 112k (56.0%)",
      "⛝ Autocompact buffer: 40k tokens (20.0%)",
    ]);
    expect(await colorsOf(pane, "40k tokens (20.0%)")).toContain(palette.muted);
  });

  test("C4 deferred categories stay out of the legend and the grid and get one muted line", async ($, on) => {
    worldOf(on);

    const pane = await paneOnTab($, "Context");

    const rows = await rowTexts(pane);
    expect(rows.some((row) => row.includes("MCP tools (deferred)"))).toBe(false);
    expect(rows).toContain("30k tokens deferred, loaded on demand");
    expect(await colorsOf(pane, "30k tokens deferred, loaded on demand")).toEqual([palette.muted]);
  });

  test("C5 sections give a bold title with a muted hint and an item count with tokens beneath", async ($, on) => {
    worldOf(on);

    const pane = await paneOnTab($, "Context");

    const rows = await rowTexts(pane);
    expect(rows).toEqual(
      expect.arrayContaining([
        "MCP tools · /mcp",
        "└ 3 tools · 0 tokens",
        "Custom agents · .claude/agents/",
        "└ 1 agent · 900 tokens",
        "Memory files · /memory",
        "└ 2 files · 1.5k tokens",
        "Skills · /skills",
        "└ 9 skills · 2.5k tokens",
      ]),
    );
    expect(await colorsOf(pane, "└ 3 tools · 0 tokens")).toEqual([palette.muted]);
  });

  test("C6 a wide pane puts the header and legend beside the grid", async ($, on) => {
    worldOf(on);

    const pane = await paneOnTab($, "Context");

    expect(await besideGridBoxes(pane)).toHaveLength(1);
  });

  test("C6b a pane under 60 columns stacks the header and legend under the grid", async ($, on) => {
    worldOf(on);

    const pane = await mountedOnTab($, "Context", MID_COLUMNS);

    expect(await besideGridBoxes(pane)).toHaveLength(0);
  });

  test("C7 the body opens with content right under the tab bar gap and the sections are separated by blank rows", async ($, on) => {
    worldOf(on);

    const body = await contextBody(await paneOnTab($, "Context"));

    const blanks = elementsIn(body as unknown as Node).map(
      (child) => child.type === "Box" && child.props?.height === 1,
    );
    expect(blanks[0]).toBe(false);
    expect(blanks.filter(Boolean).length).toBeGreaterThanOrEqual(4);
  });

  test("C8 in a short pane the body is cut to the pane height", async ($, on) => {
    worldOf(on);

    const body = await contextBody(await paneOnTab($, "Context", SHORT_PANE_ROWS));

    expect(body.props.height).toBe(SHORT_PANE_ROWS - 2);
  });
});

describe("context tab work", () => {
  test("C10 opening the tab asks once with the pane width, and a measure asks again only while it is shown", async ($, on) => {
    const calls = worldOf(on);

    const pane = await paneOnTab($, "Context");
    const asked = () => calls.filter((call) => call.columns !== undefined).length;
    const afterOpen = asked();
    await $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: ["context"] });
    await pane.redraw();
    const afterMeasure = asked();
    await showTab(pane, "Files");
    await $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: ["context"] });

    expect(calls.find((call) => call.columns !== undefined)).toEqual({
      breakdown: "full",
      columns: COLUMNS - 1,
    });
    expect(afterOpen).toBe(1);
    expect(afterMeasure).toBe(2);
    expect(asked()).toBe(2);
  });

  test("C11 a measure while the tab is open redraws the header with the new usage, with no press or redraw", async ($, on) => {
    const fixture = { ...FIXTURE };
    worldOf(on, fixture);
    const pane = await paneOnTab($, "Context");
    expect(await rowTexts(pane)).toContain("48k/200k tokens (24%)");
    fixture.totalTokens = 96_000;
    fixture.percentage = 48;

    await $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: ["context"] });

    expect(await rowTexts(pane)).toContain("96k/200k tokens (48%)");
  });
});

describe("context tab grid size", () => {
  test("C9 a pane narrower than 80 columns still asks for the full-resolution grid", async ($, on) => {
    const calls = worldOf(on);

    await mountedOnTab($, "Context", MID_COLUMNS);

    expect(calls.find((call) => call.columns !== undefined)?.columns).toBe(FULL_GRID_COLUMNS);
  });
});

describe("tab bar", () => {
  test("T6 in a narrow pane arrows show the hidden tabs, and clicking one moves to the next or previous page", async ($, on) => {
    worldOf(on);

    const pane = await mountPane($, TALL_PANE_ROWS, NARROW_COLUMNS);
    const buttonLabels = async () =>
      (await pane.findAll({ type: "Button" })).map((button) => button.props.label);

    expect(await buttonLabels()).toEqual(["›"]);
    await showTab(pane, "›");
    expect(await buttonLabels()).toEqual(["‹", "›"]);
    await showTab(pane, "‹");
    expect(await buttonLabels()).toEqual(["›"]);
  });
});

function worldOf(on: On, fixture: typeof FIXTURE = FIXTURE): UsageCall[] {
  const calls: UsageCall[] = [];
  mock.clock(on, { now: NOW });
  mock.env(on, { HOME: "/h/u" });
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", (_$, e) => {
    calls.push({ breakdown: e.breakdown, columns: e.columns });
    const context =
      e.breakdown === undefined ? { window: 200_000 } : { window: 200_000, breakdown: fixture };
    return { value: { startedAt: 0, context, rateLimits: [] } };
  });
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: "/work" }));
  on("ui.render", { component: "Pane" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine pane</Text>;
  });
  return calls;
}

function mountPane(
  $: Engine,
  rows: number = TALL_PANE_ROWS,
  columns: number = COLUMNS,
): Promise<Pane> {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: "session",
    props: {
      title: "Session",
      isFocused: false,
      bodyColumns: columns,
      placement: "dock",
      scroll: { offset: 0, bodyRows: rows },
      view: {},
    },
    viewport: { columns, rows },
  });
}

async function paneOnTab($: Engine, label: string, rows: number = TALL_PANE_ROWS): Promise<Pane> {
  const pane = await mountPane($, rows);
  await showTab(pane, label);
  return pane;
}

async function mountedOnTab($: Engine, label: string, columns: number): Promise<Pane> {
  const pane = await mountPane($, TALL_PANE_ROWS, columns);
  await showTab(pane, label);
  return pane;
}

async function contextBody(pane: Pane) {
  const found = (await pane.findAll({ type: "Box" })).find(
    (box) => box.props.overflow === "hidden" && box.props.flexDirection === "column",
  );
  expect(found, "the context body box").toBeDefined();
  return found as NonNullable<typeof found>;
}

async function besideGridBoxes(pane: Pane): Promise<unknown[]> {
  return (await pane.findAll({ type: "Box" })).filter(
    (box) => box.props.flexDirection === "row" && box.props.columnGap === 2,
  );
}

async function showTab(pane: Pane, label: string): Promise<void> {
  const tab = (await pane.findAll({ type: "Button" })).find(
    (button) => button.props.label === label,
  );
  expect(tab, `the tab bar has a ${label} tab`).toBeDefined();
  await pane.press({ key: tab?.key ?? "" });
}

async function colorsOf(pane: Pane, text: string): Promise<unknown[]> {
  const found = await pane.findAll({ type: "Text", text });
  return found.map((one) => one.props.color);
}

async function legendGlyphColors(pane: Pane): Promise<Record<string, unknown>> {
  const legendRows = rowsOf((await pane.drawn()) as unknown as Node).filter(
    (row) => elementsIn(row).length === 3 && textOf(row).includes(": "),
  );
  return Object.fromEntries(
    legendRows.map((row) => {
      const [glyph, name] = elementsIn(row) as [Node, Node];
      return [textOf(name).replace(/: $/, ""), glyph.props?.color];
    }),
  );
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
  return (node.children ?? [])
    .map((child) => (typeof child === "string" ? child : textOf(child as Node)))
    .join("");
}
