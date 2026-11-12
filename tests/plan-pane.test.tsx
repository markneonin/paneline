import { describe, expect, mock, test } from "claude-code/testing";
import type { On, ToolCallResult } from "claude-code";
import type { Engine, MockClock, Mounted } from "claude-code/testing";

import { palette } from "../hooks/palette";
import { paneInk } from "../hooks/pane-ink";
import { screenRows } from "./band-screen";

type Pane = Mounted<"terminal", "Pane">;
type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] };
type TaskStatus = "pending" | "in_progress" | "completed";
type World = { clock: MockClock; created: number; calls: number };

const COLUMNS = 60;
const WIDE_COLUMNS = 80;
const PLAN_WIDE_COLUMNS = 120;
const BAR_THRESHOLD_PANE_COLUMNS = 101;
const SEVEN_TASKS = Array.from({ length: 7 }, (_, index) => `task ${index + 1}`);
const PANE_ROWS = 40;
const NOW = 1_000_000;
const FLUSH_MS = 1_000;
const WORK = "/work";
const FOLDED_ONE = "▸ ✓ 1 done";
const PLAN_HEADING = /^Plan\b.*\d+\/\d+$/u;
const NO_TASKS_TEXT = "no task list yet · Claude's steps show here";
const UNFOLDED_ONE = "▾ ✓ 1 done";
const TODOS = [
  { content: "write the parser", status: "completed", activeForm: "writing" },
  { content: "wire the tab", status: "in_progress", activeForm: "wiring" },
  { content: "check the look", status: "pending", activeForm: "checking" },
];

describe("plan tab", () => {
  test("L1 the tab bar lists Plan between Agents and Context", async ($, on) => {
    await begin($, on);

    const pane = await mountPane($, WIDE_COLUMNS);

    const labels = await tabLabels(pane);
    expect(labels.slice(labels.indexOf("Agents"), labels.indexOf("Agents") + 3)).toEqual([
      "Agents",
      "Plan",
      "Context",
    ]);
  });

  test("S8 with no tasks the Plan tab shows one dim line saying no task list yet and what fills it", async ($, on) => {
    await begin($, on);

    const pane = await planTab($);

    expect((await rowTexts(pane)).filter((text) => text === NO_TASKS_TEXT)).toHaveLength(1);
    expect(await colorsOf(pane, NO_TASKS_TEXT)).toEqual([palette.muted]);
  });

  test("S9 with no tasks at 60 columns the empty hint is drawn whole on the screen", async ($, on) => {
    await begin($, on);

    const pane = await planTab($);

    expect(await shownRows(pane)).toContain(NO_TASKS_TEXT);
  });

  test("F16 with no tasks at 60 columns the Plan heading with its rule stands right above the empty hint", async ($, on) => {
    await begin($, on);

    const pane = await planTab($);

    const rows = await shownRows(pane);
    const hintAt = rows.indexOf(NO_TASKS_TEXT);
    expect(hintAt).toBeGreaterThan(0);
    expect(rows[hintAt - 1]).toMatch(/^Plan ─+$/);
  });

  test("L3 the heading says Plan with done over total at its right", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, ["one", "two", "three", "four"]);
    await setStatus($, world, "1", "completed");
    const pane = await planTab($);

    const heading = (await rowTexts(pane)).find((row) => PLAN_HEADING.test(row));

    expect(heading).toMatch(/^Plan\b.*\b1\/4$/u);
  });

  test("L4 the active task shows with a filled dot and the open ones with a circle", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, ["write the parser", "wire the tab", "check the look"]);
    await setStatus($, world, "2", "in_progress");
    const pane = await planTab($);

    const rows = await shownRows(pane);

    expect(rows).toContain("● wire the tab");
    expect(rows).toContain("○ write the parser");
    expect(rows).toContain("○ check the look");
  });

  test("L5 finished tasks are folded into one done row and their titles are hidden", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, ["write the parser", "wire the tab"]);
    await setStatus($, world, "1", "completed");
    const pane = await planTab($);

    const rows = await rowTexts(pane);

    expect(await buttonLabels(pane)).toContain(FOLDED_ONE);
    expect(await dimOf(pane, FOLDED_ONE)).toBe(true);
    expect(rows).toContain("○ wire the tab");
    expect(rows.filter((row) => row.includes("write the parser"))).toEqual([]);
  });

  test("L6 pressing the done row opens it to one check row per finished task, indented, in muted colour", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, ["write the parser", "wire the tab"]);
    await setStatus($, world, "1", "completed");
    const pane = await planTab($);

    await press(pane, FOLDED_ONE);

    expect(await buttonLabels(pane)).toContain(UNFOLDED_ONE);
    expect(await rowTexts(pane)).toContain("  ✓ write the parser");
    expect(await colorsOf(pane, "  ✓ write the parser")).toEqual([palette.muted]);
  });

  test("L7 pressing the opened done row folds it again", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, ["write the parser", "wire the tab"]);
    await setStatus($, world, "1", "completed");
    const pane = await planTab($);
    await press(pane, FOLDED_ONE);

    await press(pane, UNFOLDED_ONE);

    expect(await buttonLabels(pane)).toContain(FOLDED_ONE);
    expect((await rowTexts(pane)).filter((row) => row.includes("write the parser"))).toEqual([]);
  });

  test("L8 a task moved to in progress and then completed redraws as active and then as done", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, ["write the parser", "wire the tab"]);
    const pane = await planTab($);
    const opened = await shownRows(pane);

    await setStatus($, world, "1", "in_progress");
    await pane.redraw();
    const active = await shownRows(pane);
    await setStatus($, world, "1", "completed");
    await pane.redraw();

    expect(opened).toContain("○ write the parser");
    expect(active).toContain("● write the parser");
    expect(await buttonLabels(pane)).toContain(FOLDED_ONE);
    expect((await rowTexts(pane)).find((row) => PLAN_HEADING.test(row))).toMatch(/\b1\/2$/u);
  });

  test("L9 a todo list shows its texts as the task titles", async ($, on) => {
    const world = await begin($, on);
    await callTool($, world, { tool: "TodoWrite", todos: TODOS });

    const pane = await planTab($);

    const rows = await shownRows(pane);
    expect(rows).toContain("● wire the tab");
    expect(rows).toContain("○ check the look");
    expect(await buttonLabels(pane)).toContain(FOLDED_ONE);
    expect(rows.find((row) => PLAN_HEADING.test(row))).toMatch(/\b1\/3$/u);
  });

  test("L10 when every task is done only the folded done row is left, with the full count", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, ["one", "two"]);
    await setStatus($, world, "1", "completed");
    await setStatus($, world, "2", "completed");

    const pane = await planTab($);

    const rows = await rowTexts(pane);
    expect(await buttonLabels(pane)).toContain("▸ ✓ 2 done");
    expect(rows.filter((row) => /^[▸○] (one|two)$/u.test(row))).toEqual([]);
    expect(rows.find((row) => PLAN_HEADING.test(row))).toMatch(/\b2\/2$/u);
  });

  test("L11 a deleted task leaves the tab and the total drops", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, ["one", "two"]);
    const pane = await planTab($);

    await callTool($, world, { tool: "TaskUpdate", taskId: "1", status: "deleted" });
    await pane.redraw();

    const rows = await rowTexts(pane);
    expect(rows).not.toContain("○ one");
    expect(rows).toContain("○ two");
    expect(rows.find((row) => PLAN_HEADING.test(row))).toMatch(/\b0\/1$/u);
  });

  test("L12 an opened done row stays open after a redraw and after leaving the tab and coming back", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, ["write the parser", "wire the tab"]);
    await setStatus($, world, "1", "completed");
    const pane = await planTab($);
    await press(pane, FOLDED_ONE);

    await pane.redraw();
    await press(pane, "Activity");
    await press(pane, "Plan");

    expect(await buttonLabels(pane)).toContain(UNFOLDED_ONE);
    expect(await rowTexts(pane)).toContain("  ✓ write the parser");
  });

  test("L13 a long title keeps its row to one line by truncating", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, [
      "a very long task title that cannot fit in the pane at sixty columns at all",
    ]);

    const pane = await planTab($);

    const row = (await pane.findAll({ type: "Text" })).find((text) =>
      JSON.stringify(text).includes("a very long task title"),
    );
    expect(row?.props.wrap).toBe("truncate-end");
  });

  test("PL1 with every task done exactly one blank row sits between the heading and the done row", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, ["one", "two", "three"]);
    await setStatus($, world, "1", "completed");
    await setStatus($, world, "2", "completed");
    await setStatus($, world, "3", "completed");

    const pane = await planTab($);

    expect(linesAfterHeading(await planLines(pane))).toEqual(["", "▸ ✓ 3 done"]);
  });

  test("PL2a with every task still open one blank row sits under the heading and the open rows are unchanged", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, ["one", "two"]);

    const pane = await planTab($);

    expect(linesAfterHeading(await planLines(pane))).toEqual(["", "○ one", "○ two"]);
  });

  test("PL2b with some tasks done and some open one blank row sits under the heading and the rows are unchanged", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, ["one", "two", "three"]);
    await setStatus($, world, "1", "completed");
    await setStatus($, world, "2", "in_progress");

    const pane = await planTab($);

    expect(linesAfterHeading(await planLines(pane))).toEqual([
      "",
      "● two",
      "○ three",
      "",
      "▸ ✓ 1 done",
    ]);
  });
});

describe("plan tab progress bar and marks", () => {
  test("A1 with 3 of 7 done at 120 columns the heading shows a 16-cell bar of 7 filled and 9 empty cells, then 3/7 at the right edge", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, SEVEN_TASKS);
    await completeFirst($, world, 3);
    const pane = await planTabAt($, PLAN_WIDE_COLUMNS);

    const heading =
      screenRows(await pane.drawn(), PLAN_WIDE_COLUMNS).find((row) =>
        PLAN_HEADING.test(row.trimStart()),
      ) ?? "";

    expect(heading.trimStart()).toMatch(/^Plan ─+ ▰{7}▱{9} 3\/7$/u);
    expect(heading.trimEnd().length).toBe(PLAN_WIDE_COLUMNS);
  });

  test("A2 the filled bar cells are in the ok colour and 3/7 is bold in the text colour", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, SEVEN_TASKS);
    await completeFirst($, world, 3);
    const pane = await planTabAt($, PLAN_WIDE_COLUMNS);

    const leaves = await textLeaves(pane);

    expect(textPiece(leaves, "▰".repeat(7))?.props?.color).toBe(paneInk().ok);
    expect(textPiece(leaves, "3/7")?.props?.weight).toBe("semibold");
    expect(textPiece(leaves, "3/7")?.props?.color).toBe(paneInk().text);
  });

  test("A3 at 60 columns the bar is 8 cells, 3 filled and 5 empty, before 3/7", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, SEVEN_TASKS);
    await completeFirst($, world, 3);

    const pane = await planTab($);

    const heading = (await shownRows(pane)).find((row) => PLAN_HEADING.test(row)) ?? "";
    expect(heading).toMatch(/^Plan ─+ ▰{3}▱{5} 3\/7$/u);
  });

  test("A4 in a 101-column pane, so the Plan tab is 100 wide, the bar is 16 cells", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, SEVEN_TASKS);
    await completeFirst($, world, 3);

    const pane = await planTabAt($, BAR_THRESHOLD_PANE_COLUMNS);

    const heading =
      (await shownRows(pane, BAR_THRESHOLD_PANE_COLUMNS)).find((row) => PLAN_HEADING.test(row)) ??
      "";
    expect(heading).toMatch(/^Plan ─+ ▰{7}▱{9} 3\/7$/u);
  });

  test("A5 with all 7 done the bar is 16 filled cells with no empty cell, and the count reads 7/7", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, SEVEN_TASKS);
    await completeFirst($, world, 7);

    const pane = await planTabAt($, PLAN_WIDE_COLUMNS);

    const heading =
      (await shownRows(pane, PLAN_WIDE_COLUMNS)).find((row) => PLAN_HEADING.test(row)) ?? "";
    expect(heading).toMatch(/^Plan ─+ ▰{16} 7\/7$/u);
  });

  test("A6 the in-progress task shows a filled dot in the running colour and its title in bold text", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, ["write the parser", "wire the tab"]);
    await setStatus($, world, "2", "in_progress");
    const pane = await planTab($);

    const leaves = await textLeaves(pane);

    expect(await shownRows(pane)).toContain("● wire the tab");
    expect(textPiece(leaves, "●")?.props?.color).toBe(paneInk().tool);
    expect(textPiece(leaves, "wire the tab")?.props?.weight).toBe("semibold");
    expect(textPiece(leaves, "wire the tab")?.props?.color).toBe(paneInk().text);
  });

  test("A7 a pending task shows a hollow circle in muted colour and its title in plain text colour", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, ["write the parser"]);
    const pane = await planTab($);

    const leaves = await textLeaves(pane);

    expect(await shownRows(pane)).toContain("○ write the parser");
    expect(textPiece(leaves, "○")?.props?.color).toBe(paneInk().muted);
    expect(textPiece(leaves, "write the parser")?.props?.color).toBe(paneInk().text);
    expect(textPiece(leaves, "write the parser")?.props?.weight).toBeUndefined();
  });
});

async function planTab($: Engine): Promise<Pane> {
  return planTabAt($, COLUMNS);
}

async function planTabAt($: Engine, columns: number): Promise<Pane> {
  const pane = await mountPane($, columns);
  await press(pane, "Plan");
  return pane;
}

async function completeFirst($: Engine, world: World, count: number): Promise<void> {
  for (const taskId of Array.from({ length: count }, (_, index) => String(index + 1))) {
    await setStatus($, world, taskId, "completed");
  }
}

async function shownRows(pane: Pane, columns = COLUMNS): Promise<string[]> {
  return (await screenLines(pane, columns)).filter((line) => line !== "");
}

async function screenLines(pane: Pane, columns = COLUMNS): Promise<string[]> {
  return screenRows(await pane.drawn(), columns).map((line) => line.trim());
}

async function textLeaves(pane: Pane): Promise<Node[]> {
  const texts = allTexts(await pane.drawn());
  return texts.filter((text) => allTexts(text).length === 1);
}

function allTexts(node: Node): Node[] {
  const inner = elementsIn(node).flatMap(allTexts);
  return node.type === "Text" ? [node, ...inner] : inner;
}

function textPiece(leaves: Node[], text: string): Node | undefined {
  return leaves.find((leaf) => textOf(leaf) === text);
}

async function createTasks($: Engine, world: World, subjects: string[]): Promise<void> {
  for (const subject of subjects) {
    await callTool($, world, { tool: "TaskCreate", subject, description: "x" });
  }
}

async function setStatus(
  $: Engine,
  world: World,
  taskId: string,
  status: TaskStatus | "deleted",
): Promise<void> {
  await callTool($, world, { tool: "TaskUpdate", taskId, status });
}

async function callTool(
  $: Engine,
  world: World,
  input: { tool: string; [field: string]: unknown },
): Promise<ToolCallResult> {
  const reply = await ($.tool.call as (e: object) => Promise<ToolCallResult>)({
    ...input,
    tool_use_id: `call-${++world.calls}`,
  });
  await world.clock.advance(FLUSH_MS);
  return reply;
}

async function begin($: Engine, on: On): Promise<World> {
  const world = worldOf(on);
  await $.session.start({ cwd: WORK, surface: "terminal", isInteractive: true });
  await world.clock.advance(FLUSH_MS);
  return world;
}

function worldOf(on: On): World {
  const store = new Map<string, unknown>();
  const state = new Map<string, { value: unknown; version: number }>();
  const world: World = { clock: mock.clock(on, { now: NOW }), created: 0, calls: 0 };
  mock.env(on, { HOME: "/h/u" });
  on("config.list", () => ({ value: [{ key: "theme", value: "dark" }] }) as never);
  on("command.register", () => ({ value: {} }) as never);
  on("session.id", () => ({ value: "session-one" }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("store.get", (_$, e) => ({ value: store.get(e.key) }));
  on("store.set", (_$, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)));
    return { value: undefined };
  });
  on("state.get", (_$, e) => {
    const entry = state.get(`${e.plugin}.${e.key}.${e.id ?? ""}`);
    return { value: { value: entry?.value, version: entry?.version ?? 0 } };
  });
  on("state.set", (_$, e) => {
    const key = `${e.plugin}.${e.key}.${e.id ?? ""}`;
    const version = (state.get(key)?.version ?? 0) + 1;
    state.set(key, { value: JSON.parse(JSON.stringify(e.value)), version });
    return { value: { isSet: true, version } };
  });
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: WORK }));
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", () => ({ value: true }));
  on("tool.register", (_$, e) => ({ value: { tool: `mcp__paneline__${e.name}` } }));
  on("tool.check", () => ({ decision: "allow" }));
  on("prompt.submit", (_$, e) => ({ text: e.text }));
  on("turn.complete", (_$, e) => ({ text: e.answer }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("process.run", () => ({ value: { exitCode: 0, stdout: "", stderr: "" } }) as never);
  on("ui.render", { component: "Pane" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine pane</Text>;
  });
  on("tool.call", (_$, e) =>
    answerOf(world, e as unknown as { tool: string; [k: string]: unknown }),
  );
  return world;
}

function answerOf(world: World, call: { tool: string; [field: string]: unknown }): ToolCallResult {
  if (call.tool === "TaskCreate") {
    const id = String(++world.created);
    return { result: { task: { id, subject: call.subject } }, text: "created" };
  }
  if (call.tool === "TaskUpdate") {
    return {
      result: { success: true, taskId: call.taskId, updatedFields: ["status"] },
      text: "updated",
    };
  }
  if (call.tool === "TodoWrite") {
    return { result: { oldTodos: [], newTodos: call.todos }, text: "written" };
  }
  return { result: "ok", text: "ok" };
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
  const target = (await pane.findAll({ type: "Button" })).find(
    (button) => button.props.label === label,
  );
  expect(target, `a ${label} button`).toBeDefined();
  await pane.press({ key: target?.key ?? "" });
  await pane.redraw();
}

async function tabLabels(pane: Pane): Promise<string[]> {
  const known = [
    "Activity",
    "Files",
    "Agents",
    "Plan",
    "Context",
    "MCP",
    "Skills",
    "Spend",
    "Review",
    "Sessions",
  ];
  const labels = (await pane.findAll({ type: "Button" })).map((button) =>
    String(button.props.label),
  );
  const bar = labels.filter((label) => known.includes(label));
  return known.filter((label) => bar.includes(label));
}

async function dimOf(pane: Pane, label: string): Promise<unknown> {
  const button = (await pane.findAll({ type: "Button" })).find(
    (found) => found.props.label === label,
  );
  return button?.props.dimColor;
}

async function buttonLabels(pane: Pane): Promise<string[]> {
  return (await pane.findAll({ type: "Button" })).map((button) => String(button.props.label));
}

async function colorsOf(pane: Pane, text: string): Promise<unknown[]> {
  return (await pane.findAll({ type: "Text", text })).map((one) => one.props.color);
}

async function planLines(pane: Pane): Promise<string[]> {
  const column = planColumnOf(await pane.drawn());
  return column === undefined ? [] : elementsIn(column).map(textOf);
}

function planColumnOf(node: Node): Node | undefined {
  const inner = elementsIn(node)
    .map(planColumnOf)
    .find((found) => found !== undefined);
  if (inner !== undefined) return inner;
  return elementsIn(node).some((child) => PLAN_HEADING.test(textOf(child))) ? node : undefined;
}

function linesAfterHeading(lines: string[]): string[] {
  return lines.slice(lines.findIndex((line) => PLAN_HEADING.test(line)) + 1);
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
