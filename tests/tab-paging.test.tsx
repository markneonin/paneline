import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";
import { isHeavy } from "./weight";

type Pane = Mounted<"terminal", "Pane">;
type Node = { type: string; props?: Record<string, unknown>; children?: unknown };
type Bar = { tabs: string[]; selected: string; arrows: string[] };

const NOW = 200_000;
const NARROW_COLUMNS = 38;
const WIDE_COLUMNS = 150;
const PANE_ROWS = 40;
const ACTIVE_TAB_TEXT = "clawd_background";
const LEFT_ARROW = "‹";
const RIGHT_ARROW = "›";
const ALL_TABS = [
  "Activity",
  "Files",
  "Agents",
  "Plan",
  "Context",
  "MCP",
  "Skills",
  "Spend",
  "Setup",
  "Shells",
  "History",
  "Review",
  "Sessions",
];
const FIRST_PAGE = ["Activity", "Files", "Agents", "Plan"];
const SECOND_PAGE = ["Context", "MCP", "Skills"];
const THIRD_PAGE = ["Spend", "Setup", "Shells"];
const LAST_PAGE = ["History", "Review", "Sessions"];
const SIXTY_COLUMNS = 60;
const SHOT_COLUMNS = 120;
const FIRST_PAGE_ARROWS = ["9›"];
const SECOND_PAGE_ARROWS = ["‹4", "6›"];
const THIRD_PAGE_ARROWS = ["‹7", "3›"];
const LAST_PAGE_ARROWS = ["‹10"];

describe("tab bar paging", () => {
  test("T1-a no tab has a digit hotkey in a wide pane", async ($, on) => {
    worldOf(on);
    const pane = await mountPane($, WIDE_COLUMNS);

    expect(await digitHotkeysOf(pane)).toEqual([]);
  });

  test("T1-b no tab has a digit hotkey in a narrow pane, off the shown page either", async ($, on) => {
    worldOf(on);
    const pane = await mountPane($, NARROW_COLUMNS);

    expect(await digitHotkeysOf(pane)).toEqual([]);
  });

  test("T2 a tab label carries no digit prefix", async ($, on) => {
    worldOf(on);
    const pane = await mountPane($, WIDE_COLUMNS);

    const bar = await barOf(pane);

    expect(bar.tabs).toEqual(ALL_TABS.slice(0, bar.tabs.length));
    expect(JSON.stringify(await pane.drawn())).not.toMatch(/\\d: /);
  });

  test("P1 a narrow pane opens on Activity with Files, Agents and Plan beside it and only a right arrow", async ($, on) => {
    worldOf(on);

    const pane = await mountPane($, NARROW_COLUMNS);

    expect(await barOf(pane)).toEqual({
      tabs: FIRST_PAGE,
      selected: "Activity",
      arrows: FIRST_PAGE_ARROWS,
    });
  });

  test("P2 pressing the right arrow shows only tabs that were hidden and selects the first of them", async ($, on) => {
    worldOf(on);
    const pane = await mountPane($, NARROW_COLUMNS);
    const before = await barOf(pane);

    await pressArrow(pane, RIGHT_ARROW);

    const after = await barOf(pane);
    expect(after).toEqual({
      tabs: SECOND_PAGE,
      selected: "Context",
      arrows: SECOND_PAGE_ARROWS,
    });
    expect(after.tabs.filter((name) => before.tabs.includes(name))).toEqual([]);
  });

  test("P3 pressing the left arrow on the second page brings the first page back with Activity selected", async ($, on) => {
    worldOf(on);
    const pane = await mountPane($, NARROW_COLUMNS);
    await pressArrow(pane, RIGHT_ARROW);

    await pressArrow(pane, LEFT_ARROW);

    expect(await barOf(pane)).toEqual({
      tabs: FIRST_PAGE,
      selected: "Activity",
      arrows: FIRST_PAGE_ARROWS,
    });
  });

  test("P4 pressing the right arrow twice shows the third page with Spend selected and both arrows", async ($, on) => {
    worldOf(on);
    const pane = await mountPane($, NARROW_COLUMNS);

    await pressArrow(pane, RIGHT_ARROW);
    await pressArrow(pane, RIGHT_ARROW);

    expect(await barOf(pane)).toEqual({
      tabs: THIRD_PAGE,
      selected: "Spend",
      arrows: THIRD_PAGE_ARROWS,
    });
  });

  test("P5 pressing the left arrow on the last page brings the second page back with Context selected", async ($, on) => {
    worldOf(on);
    const pane = await mountPane($, NARROW_COLUMNS);
    await pressArrow(pane, RIGHT_ARROW);
    await pressArrow(pane, RIGHT_ARROW);

    await pressArrow(pane, LEFT_ARROW);

    expect(await barOf(pane)).toEqual({
      tabs: SECOND_PAGE,
      selected: "Context",
      arrows: SECOND_PAGE_ARROWS,
    });
  });

  test("P6 a wide pane shows all thirteen tabs with Activity selected and no arrows", async ($, on) => {
    worldOf(on);

    const pane = await mountPane($, WIDE_COLUMNS);

    expect(await barOf(pane)).toEqual({ tabs: ALL_TABS, selected: "Activity", arrows: [] });
  });

  test("P7 after clicking Agents the right arrow shows the hidden tabs and selects Context", async ($, on) => {
    worldOf(on);
    const pane = await mountPane($, NARROW_COLUMNS);
    await press(pane, "Agents");

    await pressArrow(pane, RIGHT_ARROW);

    expect(await barOf(pane)).toEqual({
      tabs: SECOND_PAGE,
      selected: "Context",
      arrows: SECOND_PAGE_ARROWS,
    });
  });

  test("P8 after going to the second page and clicking MCP the left arrow shows the first page with Activity selected", async ($, on) => {
    worldOf(on);
    const pane = await mountPane($, NARROW_COLUMNS);
    await pressArrow(pane, RIGHT_ARROW);
    await press(pane, "MCP");

    await pressArrow(pane, LEFT_ARROW);

    expect(await barOf(pane)).toEqual({
      tabs: FIRST_PAGE,
      selected: "Activity",
      arrows: FIRST_PAGE_ARROWS,
    });
  });

  test("P9 clicking Agents in a narrow pane selects it and keeps it in the bar", async ($, on) => {
    worldOf(on);
    const pane = await mountPane($, NARROW_COLUMNS);

    await press(pane, "Agents");

    const bar = await barOf(pane);
    expect(bar.selected).toBe("Agents");
    expect(bar.tabs).toContain("Agents");
  });

  test("P10 clicking a tab in a wide pane selects it and the bar still shows all thirteen tabs with no arrows", async ($, on) => {
    worldOf(on);
    const pane = await mountPane($, WIDE_COLUMNS);

    await press(pane, "Skills");

    expect(await barOf(pane)).toEqual({ tabs: ALL_TABS, selected: "Skills", arrows: [] });
  });

  test("P11 on the last page of the narrow pane the left arrow counts the ten tabs before it and there is no right arrow", async ($, on) => {
    worldOf(on);
    const pane = await mountPane($, NARROW_COLUMNS);
    await pressArrow(pane, RIGHT_ARROW);
    await pressArrow(pane, RIGHT_ARROW);

    await pressArrow(pane, RIGHT_ARROW);

    expect(await barOf(pane)).toEqual({
      tabs: LAST_PAGE,
      selected: "History",
      arrows: LAST_PAGE_ARROWS,
    });
  });

  test("P12 at 60 columns the right arrow counts the seven hidden tabs on open and the bar walks to Sessions", async ($, on) => {
    worldOf(on);
    const pane = await mountPane($, SIXTY_COLUMNS);
    const opened = await barOf(pane);

    await pressArrow(pane, RIGHT_ARROW);
    const middle = await barOf(pane);
    await pressArrow(pane, RIGHT_ARROW);
    const last = await barOf(pane);

    expect(opened).toEqual({
      tabs: ["Activity", "Files", "Agents", "Plan", "Context", "MCP"],
      selected: "Activity",
      arrows: ["7›"],
    });
    expect(middle).toEqual({
      tabs: ["Skills", "Spend", "Setup", "Shells", "History", "Review"],
      selected: "Skills",
      arrows: ["‹6", "1›"],
    });
    expect(last).toEqual({ tabs: ["Sessions"], selected: "Sessions", arrows: ["‹12"] });
  });

  test("P13 at 120 columns all thirteen tabs show with no arrows", async ($, on) => {
    worldOf(on);

    const pane = await mountPane($, SHOT_COLUMNS);

    expect(await barOf(pane)).toEqual({ tabs: ALL_TABS, selected: "Activity", arrows: [] });
  });

  test("P14 at 38 columns the first label of every page starts at the column page one starts at", async ($, on) => {
    worldOf(on);
    const pane = await mountPane($, NARROW_COLUMNS);

    expect(await firstLabelColumnsOnEveryPage(pane)).toEqual([1, 1, 1, 1]);
  });

  test("P15 at 60 columns the first label of every page starts at the column page one starts at", async ($, on) => {
    worldOf(on);
    const pane = await mountPane($, SIXTY_COLUMNS);

    expect(await firstLabelColumnsOnEveryPage(pane)).toEqual([1, 1, 1]);
  });

  test("P16 at 120 columns the first label starts at column one", async ($, on) => {
    worldOf(on);
    const pane = await mountPane($, SHOT_COLUMNS);

    expect(await firstLabelColumnsOnEveryPage(pane)).toEqual([1]);
  });
});

function worldOf(on: On): void {
  mock.clock(on, { now: NOW });
  mock.env(on, { HOME: "/h/u" });
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.id", () => ({ value: "s1" }));
  on("session.model", () => ({ value: "opus" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: "/work" }));
  on("agent.list", () => ({ value: [] }));
  on("ui.render", { component: "Pane" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine pane</Text>;
  });
}

function mountPane($: Engine, columns: number): Promise<Pane> {
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
      scroll: { offset: 0, bodyRows: PANE_ROWS },
      view: {},
    },
    viewport: { columns, rows: PANE_ROWS },
  });
}

async function press(pane: Pane, label: string): Promise<void> {
  const button = (await pane.findAll({ type: "Button" })).find(
    (found) => found.props.label === label,
  );
  expect(button, `the tab bar has a ${label} button`).toBeDefined();
  await pane.press({ key: button?.key ?? "" });
}

async function pressArrow(pane: Pane, glyph: string): Promise<void> {
  const button = (await pane.findAll({ type: "Button" })).find((found) =>
    String(found.props.label).includes(glyph),
  );
  expect(button, `the tab bar has a ${glyph} arrow`).toBeDefined();
  await pane.press({ key: button?.key ?? "" });
}

async function firstLabelColumnsOnEveryPage(pane: Pane): Promise<number[]> {
  const columns = [await firstLabelColumn(pane)];
  while ((await barOf(pane)).arrows.some((arrow) => arrow.includes(RIGHT_ARROW))) {
    await pressArrow(pane, RIGHT_ARROW);
    columns.push(await firstLabelColumn(pane));
  }
  return columns;
}

async function firstLabelColumn(pane: Pane): Promise<number> {
  const row = barRow(await pane.drawn()) as Node;
  const gap = " ".repeat(Number(row.props?.columnGap ?? 0));
  const shown = childrenOf(row)
    .filter((item) => item.props?.display !== "none")
    .map((item) => (item.type === "Button" ? String(item.props?.label) : textOf(item)))
    .join(gap);
  return Number(row.props?.paddingLeft ?? 0) + shown.length - shown.trimStart().length;
}

async function digitHotkeysOf(pane: Pane): Promise<string[]> {
  const buttons = await pane.findAll({ type: "Button" });
  return buttons
    .map((button) => button.props.hotkey)
    .filter((hotkey): hotkey is string => typeof hotkey === "string" && /\d/.test(hotkey));
}

async function barOf(pane: Pane): Promise<Bar> {
  const row = barRow(await pane.drawn());
  expect(row, "the tab bar row").toBeDefined();
  const items = childrenOf(row as Node);
  const arrows = items
    .filter((item) => item.type === "Button")
    .map((item) => String(item.props?.label));
  const tabs = items.filter((item) => item.type === "Box" && item.props?.display !== "none");
  return {
    tabs: tabs.map(tabName),
    selected: tabName(tabs.find(isSelectedTab) as Node),
    arrows,
  };
}

function barRow(node: Node): Node | undefined {
  const isRow = node.type === "Box" && node.props?.height === 1 && node.props.overflow === "hidden";
  if (isRow) return node;
  return childrenOf(node)
    .map(barRow)
    .find((found) => found !== undefined);
}

function isSelectedTab(tab: Node): boolean {
  return childrenOf(tab).some(
    (part) => isHeavy(part.props) && part.props?.color === ACTIVE_TAB_TEXT,
  );
}

function tabName(tab: Node): string {
  return childrenOf(tab)
    .map((part) => (part.type === "Button" ? String(part.props?.label) : textOf(part)))
    .join("")
    .trim();
}

function childrenOf(node: Node): Node[] {
  const raw = node.children;
  const list = Array.isArray(raw) ? raw.flat(Infinity) : raw === undefined ? [] : [raw];
  return list.filter((child): child is Node => typeof child === "object" && child !== null);
}

function textOf(node: Node): string {
  const raw = node.children;
  const list = Array.isArray(raw) ? raw.flat(Infinity) : raw === undefined ? [] : [raw];
  return list
    .map((child) => (typeof child === "object" ? textOf(child as Node) : String(child)))
    .join("");
}
