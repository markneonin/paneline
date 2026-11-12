import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { paneInk } from "../hooks/pane-ink";
import type { Activity } from "../types";
import { collect } from "./draw-tree";
import type { Node } from "./draw-tree";
import { linesOf } from "./skills-tree";

type Pane = Mounted<"terminal", "Pane">;

const COLUMNS = 100;
const NARROW_COLUMNS = 22;
const LIGHT_THEME = "light";
const FILTER_LABEL = "filter";
const missing = new Set<string>();
const store = new Map<string, { value: unknown; version: number }>();

describe("files read at a glance", () => {
  test("V1 a folder row draws its parent folder dim and its last folder in the text colour", async ($, on) => {
    worldOf(on);
    const pane = await paneWith($, [
      read("/h/u/P/IT/paneline/hooks/a.ts"),
      read("/h/u/P/IT/tasks/x.md"),
    ]);

    const folder = await buttonLabelled(pane, "▾ paneline/hooks/");

    expect(colourOfWord(folder, "paneline")).toBe(paneInk().muted);
    expect(colourOfWord(folder, "hooks")).toBe(paneInk().text);
  });

  test("V3a a file with +12 -0 shows +12 green and -0 dim in dark", async ($, on) => {
    worldOf(on);
    const pane = await paneWith($, [edit("/work/m.ts", 12, 0)]);

    const row = await rowContaining(pane, "m.ts");

    expect(colourOfPiece(row, "+12")).toBe(paneInk().ok);
    expect(colourOfPiece(row, "-0")).toBe(paneInk().muted);
  });

  test("V3b a file with +12 -0 shows +12 green and -0 dim in light", async ($, on) => {
    worldOf(on, LIGHT_THEME);
    const pane = await paneWith($, [edit("/work/m.ts", 12, 0)]);

    const row = await rowContaining(pane, "m.ts");

    expect(colourOfPiece(row, "+12")).toBe(paneInk().ok);
    expect(colourOfPiece(row, "-0")).toBe(paneInk().muted);
  });

  test("V4 a folded folder with only additions shows its -0 dim", async ($, on) => {
    worldOf(on);
    const pane = await paneWith($, [
      edit("/work/src/a.ts", 3, 0),
      edit("/work/src/b.ts", 4, 0),
      edit("/work/top.ts", 0, 1),
    ]);

    await press(pane, "▾ src/");

    const row = await rowContaining(pane, "▸ src/");
    expect(colourOfPiece(row, "+7")).toBe(paneInk().ok);
    expect(colourOfPiece(row, "-0")).toBe(paneInk().muted);
  });

  test("V19 a folder name too long for the row is cut from the left and its last folder stays in the text colour", async ($, on) => {
    worldOf(on);
    const pane = await paneWith(
      $,
      [read("/w/aaaaaaaaaa/bbbbbbbbbb/cccccccccc/x.ts"), read("/w/y.ts")],
      NARROW_COLUMNS,
    );

    const folder = await buttonLabelled(pane, "cccccccccc/");

    expect(colourOfWord(folder, "cccccccccc")).toBe(paneInk().text);
  });

  test("V20 a +0 side shows dim while the other side keeps its colour", async ($, on) => {
    worldOf(on);
    const pane = await paneWith($, [edit("/work/m.ts", 0, 5)]);

    const row = await rowContaining(pane, "m.ts");

    expect(colourOfPiece(row, "+0")).toBe(paneInk().muted);
    expect(colourOfPiece(row, "-5")).toBe(paneInk().failed);
  });

  test("V18a the filter label is drawn in the dim colour role and not dimmed in dark", async ($, on) => {
    worldOf(on);
    const pane = await paneWith($, [read("/work/a.ts")]);

    const label = await buttonLabelled(pane, FILTER_LABEL);

    expect(colourOfWord(label, FILTER_LABEL)).toBe(paneInk().muted);
    expect(isDimmed(label)).toBe(false);
  });

  test("V18b the filter label is drawn in the dim colour role and not dimmed in light", async ($, on) => {
    worldOf(on, LIGHT_THEME);
    const pane = await paneWith($, [read("/work/a.ts")]);

    const label = await buttonLabelled(pane, FILTER_LABEL);

    expect(colourOfWord(label, FILTER_LABEL)).toBe(paneInk().muted);
    expect(isDimmed(label)).toBe(false);
  });
});

function isDimmed(button: Node): boolean {
  return [button, ...collect(button, "Text")].some((node) => node.props?.dimColor === true);
}

function colourOfWord(button: Node, word: string): unknown {
  return collect(button, "Text").findLast((text) => ownTextOf(text).includes(word))?.props?.color;
}

function colourOfPiece(parts: Node[], piece: string): unknown {
  return parts.find((part) => leafTextOf(part).trim() === piece)?.props?.color;
}

function ownTextOf(node: Node): string {
  return (
    (node.children as unknown[] | undefined)?.filter((c) => typeof c === "string").join("") ?? ""
  );
}

function leafTextOf(node: Node): string {
  return node.type === "Button" ? String(node.props?.label) : ownTextOf(node);
}

async function rowContaining(pane: Pane, word: string): Promise<Node[]> {
  const line = linesOf(await pane.drawn()).find((one) => one.text.includes(word));
  expect(line, `a row containing ${word}`).toBeDefined();
  return line?.parts ?? [];
}

async function buttonLabelled(pane: Pane, label: string): Promise<Node> {
  const buttons = collect(await pane.drawn(), "Button");
  const found = buttons.find((button) => String(button.props?.label).includes(label));
  expect(found, `a button labelled ${label}`).toBeDefined();
  return found as Node;
}

async function press(pane: Pane, label: string): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const target = buttons.find((button) => button.props.label === label);
  expect(target, `a button labelled ${label}`).toBeDefined();
  await pane.press({ key: target?.key ?? "" });
}

function read(target: string): Activity {
  return { id: target, tool: "Read", target, ms: 1, isErrored: false, added: 0, removed: 0 };
}

function edit(target: string, added: number, removed: number): Activity {
  return { id: target, tool: "Edit", target, ms: 1, isErrored: false, added, removed };
}

function worldOf(on: On, theme = "dark"): void {
  store.clear();
  missing.clear();
  mock.clock(on, { now: 1_000 });
  mock.env(on, { HOME: "/h/u" });
  on("config.list", () => ({ value: [{ key: "theme", value: theme }] }) as never);
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
  on("settings.read", () => ({ value: {} }));
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
  await press(pane, "Files");
  return pane;
}
