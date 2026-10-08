import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import type { Activity } from "../types";
import { displayWidth } from "../hooks/text-width";

type Pane = Mounted<"terminal", "Pane">;
type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] };
type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] };

const DOCKED_COLUMNS = 57;
const BODY_COLUMNS = DOCKED_COLUMNS - 1;
const DEEP_ROOT = "/home/dev/workspace/clients/acme/services/billing/monorepo/packages/smoke/proj";
const BAND_COLUMNS = 100;
const ONE_ROW = 1;
const ROOMY_ROWS = 10;
const store = new Map<string, { value: unknown; version: number }>();

describe("pane smoke bugs", () => {
  test("W1 when the band has room for one row only, the status chips are that row", async ($, on) => {
    const world = bandWorld(on);
    await $.session.start({ cwd: "/work/proj", surface: "terminal", isInteractive: true });
    await world.settle();

    const rows = await bandRows($, ONE_ROW);

    expect(rows).toHaveLength(ONE_ROW);
    expect(rows[0]).toContain("opus 5.5");
  });

  test("W2 when the band has room, one blank row still opens it above the chips", async ($, on) => {
    const world = bandWorld(on);
    await $.session.start({ cwd: "/work/proj", surface: "terminal", isInteractive: true });
    await world.settle();

    const rows = await bandRows($, ROOMY_ROWS);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.trim()).toBe("");
    expect(rows[1]).toContain("opus 5.5");
  });

  test("W3 a deep root folder is cut at its start with an ellipsis and every file row stays inside the pane", async ($, on) => {
    filesWorld(on);
    const pane = await filesPane($, [
      edit(`${DEEP_ROOT}/src/calc.py`, 1, 1),
      edit(`${DEEP_ROOT}/src/new.py`, 6, 0),
      edit(`${DEEP_ROOT}/my dir/файл ñ.txt`, 2, 0),
    ]);

    const rows = await fileRows(pane);

    const root = rows[0] as string;
    expect(root.startsWith("▾ …")).toBe(true);
    expect(root.endsWith("/proj/")).toBe(true);
    expect(rows.slice(1)).toEqual(
      expect.arrayContaining([
        "├─▾ my dir/",
        "│ └─файл ñ.txt+2 -0",
        "└─▾ src/",
        "  ├─calc.py+1 -1",
      ]),
    );
    expect(rows.map(displayWidth).filter((width) => width > BODY_COLUMNS)).toEqual([]);
  });

  test("W4 a folded deep root keeps its counts at the right edge", async ($, on) => {
    filesWorld(on);
    const pane = await filesPane($, [edit(`${DEEP_ROOT}/src/calc.py`, 7, 1)]);
    await pane.press({ key: String((await foldButtons(pane))[0]?.key) });

    const [root] = await fileRows(pane);

    expect(root?.startsWith("▸ …")).toBe(true);
    expect(root?.endsWith("+7 -1")).toBe(true);
    expect(displayWidth(root as string)).toBeLessThanOrEqual(BODY_COLUMNS);
  });

  test("W5 a subagent report and a question show their full tool name and their text", async ($, on) => {
    activityWorld(on);
    await $.tool.call({
      tool: "SubagentHandback",
      message: "Found 2 .py files\nsecond line",
      tool_use_id: "w5-1",
    } as never);
    await $.tool.call({
      tool: "AskUserQuestion",
      questions: [{ question: "Which colour?", header: "Colour", options: [], multiSelect: false }],
      tool_use_id: "w5-2",
    } as never);
    await $.tool.call({
      tool: "Agent",
      description: "Count .py files",
      prompt: "count",
      tool_use_id: "w5-3",
    } as never);

    const pane = await activityPane($);

    expect(await timelineCells(pane)).toEqual([
      ["✓", "Agent", "Count .py files"],
      ["✓", "AskUserQuestion", "Which colour?"],
      ["✓", "SubagentHandback", "Found 2 .py files"],
    ]);
  });
});

function edit(target: string, added: number, removed: number): Activity {
  return { id: target, tool: "Edit", target, ms: 1, isErrored: false, added, removed };
}

function paneWorld(on: On): void {
  mock.clock(on, { now: 1_000 });
  mock.env(on, { HOME: "/h/u" });
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: "/work" }));
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", () => ({ value: true }));
}

function filesWorld(on: On): void {
  store.clear();
  paneWorld(on);
  on("state.get", (_$, e, next) => {
    const seeded = store.get(e.key);
    return seeded ? { value: seeded } : next(e);
  });
  on("state.set", (_$, e, next) => {
    store.delete(e.key);
    return next(e);
  });
}

function activityWorld(on: On): void {
  paneWorld(on);
  on("tool.call", () => ({ result: "ok", text: "ok" }));
}

function bandWorld(on: On) {
  const clock = mock.clock(on, { now: 1_000 });
  mock.env(on, { HOME: "/h/u" });
  on("session.model", () => ({ value: "claude-opus-5-5" }));
  on("session.cwd", () => ({ value: "/work/proj" }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("command.register", () => ({ value: {} }) as never);
  on("classic.SessionStart", () => ({}));
  on("classic.UserPromptSubmit", () => ({}));
  on("classic.PostModelSwitch", () => ({}));
  on("classic.CwdChanged", () => ({}));
  on("classic.Stop", () => ({}));
  on("classic.PostToolUse", () => ({}));
  on("process.run", () => ({ value: { exitCode: 1, stdout: "", stderr: "" } }) as never);
  on("ui.render", { component: "AbovePrompt" }, ($, e) => {
    const { Box } = $.ui.resolve(e);
    return <Box height={0} />;
  });
  return { settle: () => clock.settle() };
}

async function bandRows($: Engine, maxRows: number): Promise<string[]> {
  const band = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "AbovePrompt",
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows,
      bodyColumns: BAND_COLUMNS,
      scroll: { offset: 0, bodyRows: Math.max(0, maxRows - 1) },
      view: {},
    },
    viewport: { columns: BAND_COLUMNS, rows: 40 },
  });
  const tree = (await band.drawn()) as Drawn;
  return (tree.children ?? [])
    .filter((row) => row !== null && row !== false && (row as Drawn).props?.height !== 0)
    .map((row) => shownText(row));
}

function shownText(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(shownText).join("");
  const drawn = node as Drawn | undefined;
  if (drawn?.type === "Button") return String(drawn.props?.label);
  return (drawn?.children ?? []).map(shownText).join("");
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
      bodyColumns: DOCKED_COLUMNS,
      placement: "dock",
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
    viewport: { columns: DOCKED_COLUMNS, rows: 40 },
  });
}

async function openTab(pane: Pane, label: string): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  await pane.press({ key: buttons.find((button) => button.props.label === label)?.key ?? "" });
}

async function filesPane($: Engine, activity: Activity[]): Promise<Pane> {
  store.set("activity", { value: activity, version: 1 });
  const pane = await mountPane($);
  await openTab(pane, "Files");
  return pane;
}

async function activityPane($: Engine): Promise<Pane> {
  return mountPane($);
}

function foldButtons(pane: Pane) {
  return pane
    .findAll({ type: "Button" })
    .then((buttons) => buttons.filter((button) => /^[▸▾]/.test(String(button.props.label))));
}

async function fileRows(pane: Pane): Promise<string[]> {
  const rows = rowsIn(await pane.drawn());
  const start = rows.findIndex((row) => row.startsWith("▾ ") || row.startsWith("▸ "));
  return rows.slice(start).map((row) => row.trimEnd());
}

async function timelineCells(pane: Pane): Promise<string[][]> {
  const tree = (await pane.drawn()) as unknown as Node;
  return callRowsIn(tree).map((row) => elementsIn(row).slice(0, 3).map(cellText));
}

function callRowsIn(node: Node): Node[] {
  if (isRow(node) && !holdsColumn(node) && buttonKey(node).startsWith("call-")) return [node];
  return elementsIn(node).flatMap(callRowsIn);
}

function buttonKey(node: Node): string {
  if (node.type === "Button") return stringProp(node, "key");
  return elementsIn(node).map(buttonKey).join("");
}

function cellText(node: Node): string {
  if (node.type === "Button") return stringProp(node, "label");
  return (node.children ?? [])
    .map((child) => (typeof child === "string" ? child : cellText(child as Node)))
    .join("");
}

function stringProp(node: Node, name: string): string {
  const value = node.props?.[name];
  return typeof value === "string" ? value : "";
}

function rowsIn(node: Node): string[] {
  if (node.type === "Text") return [cellText(node)];
  if (isRow(node) && !holdsColumn(node)) return [cellText(node)];
  return elementsIn(node).flatMap(rowsIn);
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
