import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import type { Activity } from "../types";

type Pane = Mounted<"terminal", "Pane">;
type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] };
type Row = { text: string; outerTexts: Node[] };

const COLUMNS = 100;
const NARROW_COLUMNS = 30;
const NARROW_ROOMS = 22;
const missing = new Set<string>();
const store = new Map<string, { value: unknown; version: number }>();

describe("files tree", () => {
  test("three files in two nested folders show folders then files with an end mark on the last child", async ($, on) => {
    worldOf(on);
    const pane = await paneWith($, [
      read("/work/src/a.ts"),
      read("/work/src/lib/b.ts"),
      read("/work/docs/c.md"),
    ]);

    const rows = await rowsOf(pane);

    expect(rows).toEqual([
      "▾ /work/",
      "├─▾ docs/",
      "│ └─c.md",
      "└─▾ src/",
      "  ├─▾ lib/",
      "  │ └─b.ts",
      "  └─a.ts",
    ]);
  });

  test("a single-child folder chain shows as one compacted row", async ($, on) => {
    worldOf(on);
    const pane = await paneWith($, [read("/work/a/b/c/x.ts"), read("/work/y.ts")]);

    const rows = await rowsOf(pane);

    expect(rows).toEqual(["▾ /work/", "├─▾ a/b/c/", "│ └─x.ts", "└─y.ts"]);
  });

  test("files in two sibling projects hang under their common ancestor shown with home as tilde", async ($, on) => {
    worldOf(on);
    const pane = await paneWith($, [
      read("/h/u/P/IT/paneline/hooks/a.ts"),
      read("/h/u/P/IT/tasks/x.md"),
    ]);

    const rows = await rowsOf(pane);

    expect(rows).toEqual([
      "▾ ~/P/IT/",
      "├─▾ paneline/hooks/",
      "│ └─a.ts",
      "└─▾ tasks/",
      "  └─x.md",
    ]);
  });

  test("files sharing no ancestor below the filesystem root show as separate top-level roots", async ($, on) => {
    worldOf(on);
    const pane = await paneWith($, [read("/a/x.ts"), read("/b/y.ts")]);

    const rows = await rowsOf(pane);

    expect(rows).toEqual(["▾ /a/", "└─x.ts", "▾ /b/", "└─y.ts"]);
  });

  test("at 22 columns a file at depth 4 is indented 2 cells per level, leaves 14 cells for its name and is one truncated line", async ($, on) => {
    worldOf(on);
    const pane = await paneWith(
      $,
      [
        read("/w/a/x.ts"),
        read("/w/a/b/y.ts"),
        read("/w/a/b/c/z.ts"),
        read("/w/a/b/c/d/deepfile-name.ts"),
      ],
      NARROW_ROOMS,
    );

    const lines = await bodyRows(pane);
    const rows = await rowsOf(pane);
    const unwrapped = lines
      .flatMap((line) => line.outerTexts)
      .filter((text) => !String(text.props?.wrap).startsWith("truncate"));

    expect(rows).toEqual([
      "▾ /w/a/",
      "├─▾ b/",
      "│ ├─▾ c/",
      "│ │ ├─▾ d/",
      "│ │ │ └─deepfile-name.ts",
      "│ │ └─z.ts",
      "│ └─y.ts",
      "└─x.ts",
    ]);
    expect(unwrapped).toEqual([]);
  });

  test("only the modified file shows added and removed counts", async ($, on) => {
    worldOf(on);
    const pane = await paneWith($, [read("/work/r.ts"), edit("/work/m.ts", 3, 1)]);

    const rows = await rowsOf(pane);

    expect(rows.find((row) => row.includes("m.ts"))).toMatch(/\+3 -1$/);
    expect(rows.find((row) => row.includes("r.ts"))).not.toMatch(/[+-]\d/);
  });

  test("at 30 columns every row is a single truncated line", async ($, on) => {
    worldOf(on);
    const pane = await paneWith(
      $,
      [edit("/work/some/very/deep/folder/with-a-long-file-name.ts", 12, 4)],
      NARROW_COLUMNS,
    );

    const lines = await bodyRows(pane);
    const unwrapped = lines
      .flatMap((line) => line.outerTexts)
      .filter((text) => !String(text.props?.wrap).startsWith("truncate"));

    expect(lines.some((line) => line.text.includes("with-a-long"))).toBe(true);
    expect(unwrapped).toEqual([]);
  });
});

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
