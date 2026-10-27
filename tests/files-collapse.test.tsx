import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import type { Activity } from "../types";

type Pane = Mounted<"terminal", "Pane">;
type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] };
type Row = { text: string; outerTexts: Node[] };

const COLUMNS = 100;
const missing = new Set<string>();
const store = new Map<string, { value: unknown; version: number }>();

describe("files folding", () => {
  test("pressing a folder collapses it into one row with its summed counts and pressing again expands it", async ($, on) => {
    worldOf(on);
    const pane = await paneWith($, [
      read("/work/top.ts"),
      edit("/work/src/a.ts", 3, 1),
      edit("/work/src/lib/b.ts", 4, 2),
      read("/work/src/lib/r.ts"),
    ]);

    await press(pane, "▾ src/");
    const collapsed = await treeOf(pane);
    await press(pane, "▸ src/");
    const expanded = await treeOf(pane);

    expect(collapsed).toEqual(["▾ /work/", "├─▸ src/+7 -3", "└─top.ts"]);
    expect(expanded).toEqual([
      "▾ /work/",
      "├─▾ src/",
      "│ ├─▾ lib/",
      "│ │ ├─b.ts+4 -2",
      "│ │ └─r.ts",
      "│ └─a.ts+3 -1",
      "└─top.ts",
    ]);
  });

  test("collapsing an inner folder keeps the outer one open and collapsing the outer one hides the inner one", async ($, on) => {
    worldOf(on);
    const pane = await paneWith($, [
      read("/work/top.ts"),
      edit("/work/src/a.ts", 3, 1),
      edit("/work/src/lib/b.ts", 4, 2),
    ]);

    await press(pane, "▾ lib/");
    const innerFolded = await treeOf(pane);
    await press(pane, "▾ src/");
    const outerFolded = await treeOf(pane);

    expect(innerFolded).toEqual([
      "▾ /work/",
      "├─▾ src/",
      "│ ├─▸ lib/+4 -2",
      "│ └─a.ts+3 -1",
      "└─top.ts",
    ]);
    expect(outerFolded).toEqual(["▾ /work/", "├─▸ src/+7 -3", "└─top.ts"]);
  });

  test("a checkout header collapses to one row with the branch and the sum of all its files", async ($, on) => {
    worldOf(on);
    store.set("gitBranches", { value: { "/work": "main" }, version: 1 });
    const pane = await paneWith($, [edit("/work/a.ts", 2, 1), edit("/work/src/b.ts", 5, 0)]);

    await press(pane, "▾ /work/");

    expect(await treeOf(pane)).toEqual(["▸ /work/ · main+7 -1"]);
  });

  test("a folded folder stays folded after a redraw and after leaving the tab and coming back", async ($, on) => {
    worldOf(on);
    const pane = await paneWith($, [read("/work/top.ts"), edit("/work/src/a.ts", 3, 1)]);

    await press(pane, "▾ src/");
    await pane.redraw();
    const afterRedraw = await treeOf(pane);
    await press(pane, "Activity");
    await press(pane, "Files");
    const afterTabs = await treeOf(pane);

    expect(afterRedraw).toEqual(["▾ /work/", "├─▸ src/+3 -1", "└─top.ts"]);
    expect(afterTabs).toEqual(afterRedraw);
  });

  test("a tree of more than 60 files starts with folders below the root folded and a press opens one", async ($, on) => {
    worldOf(on);
    const many = Array.from({ length: 61 }, (_, i) => edit(`/work/d${i % 2}/f${i}.ts`, 1, 0));
    const pane = await paneWith($, many);

    const folded = await treeOf(pane);
    await press(pane, "▸ d0/");
    const opened = await treeOf(pane);

    expect(folded).toEqual(["▾ /work/", "├─▸ d0/+31 -0", "└─▸ d1/+30 -0"]);
    expect(opened).toHaveLength(3 + 31);
  });

  test("a tree of 60 files starts fully open", async ($, on) => {
    worldOf(on);
    const many = Array.from({ length: 60 }, (_, i) => edit(`/work/d${i % 2}/f${i}.ts`, 1, 0));
    const pane = await paneWith($, many);

    expect(await treeOf(pane)).toHaveLength(1 + 2 + 60);
  });

  test("the body of the tab sits one space from the left edge while the tab row does not", async ($, on) => {
    worldOf(on);
    const pane = await paneWith($, [edit("/work/a.ts", 1, 0)]);

    const tree = (await pane.drawn()) as Node;
    const padded = boxesIn(tree).filter((box) => box.props?.paddingLeft === 1);

    expect(padded).toHaveLength(1);
    expect(rowsIn(padded[0]!).map((row) => row.text)).toContain("└─a.ts+1 -0");
    expect(
      boxesIn(tree).find((box) => textOf(box).includes("Files"))?.props?.paddingLeft,
    ).toBeUndefined();
  });
});

async function treeOf(pane: Pane): Promise<string[]> {
  const rows = await rowsOf(pane);
  return rows.slice(rows.findIndex((row) => /^[▸▾]/.test(row)));
}

async function press(pane: Pane, label: string): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  await pane.press({ key: buttons.find((button) => button.props.label === label)?.key ?? "" });
}

function read(target: string): Activity {
  return { id: target, tool: "Read", target, ms: 1, isErrored: false, added: 0, removed: 0 };
}

function edit(target: string, added: number, removed: number): Activity {
  return { id: target, tool: "Edit", target, ms: 1, isErrored: false, added, removed };
}

function worldOf(on: On): void {
  store.clear();
  missing.clear();
  mock.clock(on, { now: 1_000 });
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
  on("fs.exists", (_$, e) => (missing.has(e.path) ? { value: false } : { value: true }));
}

async function paneWith($: Engine, activity: Activity[], columns: number = COLUMNS): Promise<Pane> {
  store.set("activity", { value: activity, version: 1 });
  const pane = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: "session",
    props: {
      title: "Session",
      isFocused: false,
      bodyColumns: columns,
      placement: "dock",
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
    viewport: { columns, rows: 40 },
  });
  const buttons = await pane.findAll({ type: "Button" });
  await pane.press({ key: buttons.find((button) => button.props.label === "Files")?.key ?? "" });
  return pane;
}

async function rowsOf(pane: Pane): Promise<string[]> {
  const rows = await bodyRows(pane);
  return rows
    .map((row) => row.text.trimEnd())
    .filter(
      (text) =>
        text.trim() !== "Files" &&
        !text.includes("Activity  Files") &&
        !text.startsWith("Files ─") &&
        !text.startsWith("SESSION"),
    );
}

async function bodyRows(pane: Pane): Promise<Row[]> {
  const rows = rowsIn(await pane.drawn());
  return rows.filter((row) => row.text !== "" && !holdsButton(row));
}

function rowsIn(node: Node): Row[] {
  if (node.type === "Text") return [{ text: textOf(node), outerTexts: [node] }];
  if (isRow(node) && !holdsColumn(node))
    return [{ text: textOf(node), outerTexts: outerTexts(node) }];
  return elementsIn(node).flatMap(rowsIn);
}

function holdsButton(row: Row): boolean {
  return row.text.includes("[ ");
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

function outerTexts(node: Node): Node[] {
  return node.type === "Text" ? [node] : elementsIn(node).flatMap(outerTexts);
}

function elementsIn(node: Node): Node[] {
  return (node.children ?? []).filter(
    (child): child is Node => typeof child === "object" && child !== null,
  );
}

function foldLabel(node: Node): string {
  const label = node.props?.label;
  return typeof label === "string" ? label : "";
}

function textOf(node: Node): string {
  if (node.type === "Button") return foldLabel(node);
  return (node.children ?? [])
    .map((child) => (typeof child === "string" ? child : textOf(child as Node)))
    .join("");
}

function boxesIn(node: Node): Node[] {
  const own = node.type === "Box" ? [node] : [];
  return [...own, ...elementsIn(node).flatMap(boxesIn)];
}
