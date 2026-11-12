import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, MockClock, Mounted } from "claude-code/testing";

import { palette } from "../hooks/palette";
import { screenRows } from "./band-screen";
import { childrenOf, collect, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import { settle } from "./clear-world";
import { feedSession } from "./session-feed";
import type { SessionFeed } from "./session-feed";
import { linesOf } from "./skills-tree";

type Pane = Mounted<"terminal", "Pane">;
type Outcome = Record<string, unknown>;
type Plan = { ms: number; outcome: Outcome };

const COLUMNS = 80;
const PANE_ROWS = 40;
const LIST_ROWS = 20;
const NARROW_COLUMNS = 52;
const WIDE_COLUMNS = 110;
const DETAIL_COMMAND = "ls /nonexistent-gh70";
const RULE_CELL = "─";
const FAILED_RUN_TEXT = "Exit code 3\nout-line\nls: /nonexistent-gh70: No such file or directory";
const SESSION = "session";
const CWD = "/work";
const FILTER_KEY = "filter";
const CALL_PREFIX = "call-";
const OLDER = "older";
const NEWER = "newer";
const BACK = "back";
const START = new Date(2026, 10, 4, 11, 10, 42).getTime();
const START_CLOCK = "11:10";
const RUN_MS = 75_000;
const RUN_TEXT = "1m 15s";
const STEP_COUNT = 30;
const SCROLL_BY = 10;
const OLDEST = "run oldest";
const MIDDLE = "run middle";
const NEWEST = "run newest";
const ALPHA_FIRST = "alpha one";
const ALPHA_SECOND = "alpha two";
const HIDDEN = "beta run";
const FILTER_WORD = "alpha";
const LONG_TOOL = "ToolWithAnExtremelyLongNameThatCertainlyCannotFitFiftyTwoCells";
const LONG_TOOL_START = "ToolWith";
const ELLIPSIS = "…";
const GENERIC_OUTCOME: Outcome = { result: "ok", text: "ok" };

describe("call detail steps", () => {
  test("D1 the back row shows the call's start time after its duration", async ($, on) => {
    worldOf(on, { b1: { ms: RUN_MS, outcome: bashOutcome("first") } });
    await $.tool.call({ tool: "Bash", command: "ls -la", tool_use_id: "b1" } as never);

    const root = await openedDetail($, "b1");

    expect(backRowLeaves(root).slice(-2).map(textOf)).toEqual([RUN_TEXT, START_CLOCK]);
    expect(backRowLeaves(root).at(-1)?.props?.color).toBe(palette.muted);
  });

  test("D2 a Bash detail shows an Output heading above its stdout", async ($, on) => {
    worldOf(on, { b1: { ms: 0, outcome: bashOutcome("first\nsecond") } });
    await $.tool.call({ tool: "Bash", command: "ls -la", tool_use_id: "b1" } as never);

    const root = await openedDetail($, "b1");
    const rows = trimmedRowsOf(root);
    const heading = rows.findIndex((row) => row.startsWith("Output"));

    expect(heading, "an Output heading is drawn").toBeGreaterThanOrEqual(0);
    expect(rows.indexOf("first"), "stdout is drawn below the heading").toBeGreaterThan(heading);
  });

  test("D3 a Bash call with no output shows the Output heading above no output", async ($, on) => {
    worldOf(on, { b1: { ms: 0, outcome: bashOutcome("") } });
    await $.tool.call({ tool: "Bash", command: "true", tool_use_id: "b1" } as never);

    const root = await openedDetail($, "b1");
    const rows = trimmedRowsOf(root);
    const heading = rows.findIndex((row) => row.startsWith("Output"));

    expect(heading, "an Output heading is drawn").toBeGreaterThanOrEqual(0);
    expect(rows.indexOf("no output"), "no output is drawn below the heading").toBeGreaterThan(
      heading,
    );
  });

  test("D4 from the middle of three calls, older opens the oldest and newer opens the newest", async ($, on) => {
    worldOf(on, {});
    await runThreeCalls($);
    const pane = await mountPane($);

    await pane.press({ key: "call-b2" });
    await pressButton(pane, OLDER);
    const oldest = textOf(await detailOf(pane));
    await pane.press({ key: BACK });
    await pane.press({ key: "call-b2" });
    await pressButton(pane, NEWER);
    const newest = textOf(await detailOf(pane));

    expect(oldest).toContain(OLDEST);
    expect(oldest).not.toContain(MIDDLE);
    expect(newest).toContain(NEWEST);
    expect(newest).not.toContain(MIDDLE);
  });

  test("D5 the oldest call has no older button and the newest has no newer button", async ($, on) => {
    worldOf(on, {});
    await runThreeCalls($);
    const pane = await mountPane($);

    await pane.press({ key: "call-b2" });
    const middle = buttonLabelsOf(await detailOf(pane));
    await pane.press({ key: BACK });
    await pane.press({ key: "call-b1" });
    const oldest = buttonLabelsOf(await detailOf(pane));
    await pane.press({ key: BACK });
    await pane.press({ key: "call-b3" });
    const newest = buttonLabelsOf(await detailOf(pane));

    expect(middle).toContain(OLDER);
    expect(middle).toContain(NEWER);
    expect(oldest).not.toContain(OLDER);
    expect(newest).not.toContain(NEWER);
  });

  test("D6 with a filter typed, older skips calls the filter hides", async ($, on) => {
    worldOf(on, {});
    await $.tool.call({ tool: "Bash", command: ALPHA_FIRST, tool_use_id: "a1" } as never);
    await $.tool.call({ tool: "Bash", command: HIDDEN, tool_use_id: "h1" } as never);
    await $.tool.call({ tool: "Bash", command: ALPHA_SECOND, tool_use_id: "a2" } as never);
    const pane = await mountPane($);
    await pane.input({ key: FILTER_KEY, text: FILTER_WORD, kind: "change" });
    await settle(pane);

    await pane.press({ key: "call-a2" });
    await pressButton(pane, OLDER);

    const root = textOf(await detailOf(pane));
    expect(root).toContain(ALPHA_FIRST);
    expect(root).not.toContain(HIDDEN);
  });

  test("D7 back after two steps returns to the list at the offset it had before the first open", async ($, on) => {
    worldOf(on, {});
    for (let index = 1; index <= STEP_COUNT; index++)
      await $.tool.call({
        tool: "Bash",
        command: `step ${index}`,
        tool_use_id: `s${index}`,
      } as never);
    const pane = await mountPane($, LIST_ROWS);
    const top = await screenOf(pane);
    await scrollBy($, pane, SCROLL_BY);
    const scrolled = await screenOf(pane);
    const keys = await callKeysOf(pane);

    expect(scrolled, "the list moved when scrolled").not.toEqual(top);
    await pane.press({ key: keys[Math.floor(keys.length / 2)] ?? "" });
    await pressButton(pane, OLDER);
    await pressButton(pane, NEWER);
    await pane.press({ key: BACK });

    expect(await screenOf(pane)).toEqual(scrolled);
  });

  test("D8 at 52 cells both buttons draw whole and the tool name is cut", async ($, on) => {
    worldOf(on, {
      t1: { ms: 0, outcome: GENERIC_OUTCOME },
      t2: { ms: 0, outcome: GENERIC_OUTCOME },
      t3: { ms: 0, outcome: GENERIC_OUTCOME },
    });
    for (const id of ["t1", "t2", "t3"])
      await $.tool.call({ tool: LONG_TOOL, tool_use_id: id } as never);
    const pane = await mountPane($, PANE_ROWS, NARROW_COLUMNS);

    await pane.press({ key: "call-t2" });
    const labels = buttonLabelsOf(await detailOf(pane));
    const toolRow = screenRows(await pane.drawn(), NARROW_COLUMNS).find((row) =>
      row.includes(LONG_TOOL_START),
    );

    expect(labels.join(" ")).toContain(NEWER);
    expect(labels.join(" ")).toContain(OLDER);
    expect(toolRow, "the tool name row is drawn").toBeDefined();
    expect(toolRow).toMatch(new RegExp(`${LONG_TOOL_START}\\S*${ELLIPSIS}`, "u"));
    expect(toolRow).not.toContain(LONG_TOOL);
  });

  test("D9 at 52 cells the Output heading starts in line with the title and its rule reaches the last cell, with no output row under it", async ($, on) => {
    worldOf(on, { b1: failedBashPlan() });
    await $.tool.call({
      tool: "Bash",
      command: "ls /nonexistent-gh70",
      tool_use_id: "b1",
    } as never);

    const rows = await detailScreenOf($, "b1", NARROW_COLUMNS);

    expectOutputHeadingWhole(rows, NARROW_COLUMNS);
  });

  test("D10 at 110 cells the Output heading starts in line with the title and its rule reaches the last cell, with no output row under it", async ($, on) => {
    worldOf(on, { b1: failedBashPlan() });
    await $.tool.call({
      tool: "Bash",
      command: "ls /nonexistent-gh70",
      tool_use_id: "b1",
    } as never);

    const rows = await detailScreenOf($, "b1", WIDE_COLUMNS);

    expectOutputHeadingWhole(rows, WIDE_COLUMNS);
  });
});

function worldOf(on: On, plans: Record<string, Plan>): MockClock {
  const clock = mock.clock(on, { now: START });
  mock.env(on, { HOME: "/h/u" });
  const feed: SessionFeed = feedSession(on);
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("fs.exists", () => ({ value: true }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: CWD }));
  on("command.register", () => ({ value: {} }) as never);
  on("agent.list", () => ({ value: [] }));
  on("tool.call", async (_$, e) => {
    const id = (e as unknown as { tool_use_id: string }).tool_use_id;
    const plan = plans[id] ?? { ms: 0, outcome: bashOutcome("") };
    await clock.advance(plan.ms);
    return feed.record(e, plan.outcome) as never;
  });
  return clock;
}

function failedBashPlan(): Plan {
  return { ms: 0, outcome: { isError: true, result: FAILED_RUN_TEXT, text: FAILED_RUN_TEXT } };
}

async function detailScreenOf($: Engine, callId: string, columns: number): Promise<string[]> {
  const pane = await mountPane($, PANE_ROWS, columns);
  await pane.press({ key: `${CALL_PREFIX}${callId}` });
  return screenRows(await pane.drawn(), columns);
}

function expectOutputHeadingWhole(rows: string[], columns: number): void {
  const heading = rows.findIndex((row) => row.includes(`Output ${RULE_CELL}`));
  expect(heading, "an Output heading is drawn").toBeGreaterThanOrEqual(0);
  const row = rows[heading] ?? "";
  const title = rows.find((above) => above.includes(DETAIL_COMMAND)) ?? "";
  expect(title, "the command title row is drawn").not.toBe("");
  expect(indentOf(row)).toBe(indentOf(title));
  expect(row.trimEnd()).toHaveLength(columns);
  expect(row.trimEnd().endsWith(RULE_CELL)).toBe(true);
  expect(row).not.toContain(ELLIPSIS);
  expect(rows.slice(heading + 1).map((below) => below.trim())).not.toContain("output");
}

function indentOf(row: string): number {
  return row.length - row.trimStart().length;
}

function bashOutcome(stdout: string): Outcome {
  return { result: { stdout, stderr: "", interrupted: false }, text: stdout };
}

async function runThreeCalls($: Engine): Promise<void> {
  await $.tool.call({ tool: "Bash", command: OLDEST, tool_use_id: "b1" } as never);
  await $.tool.call({ tool: "Bash", command: MIDDLE, tool_use_id: "b2" } as never);
  await $.tool.call({ tool: "Bash", command: NEWEST, tool_use_id: "b3" } as never);
}

function mountPane($: Engine, rows = PANE_ROWS, columns = COLUMNS): Promise<Pane> {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: SESSION,
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

async function openedDetail($: Engine, callId: string): Promise<Node> {
  const pane = await mountPane($);
  await pane.press({ key: `${CALL_PREFIX}${callId}` });
  return detailOf(pane);
}

async function detailOf(pane: Pane): Promise<Node> {
  const tree = (await pane.drawn()) as unknown as Node;
  const root = collect(tree, "Box").find((box) =>
    childrenOf(box).some((row) => childrenOf(row).some((cell) => cell.props?.key === BACK)),
  );
  if (root === undefined) throw new Error("the call detail is not drawn");
  return root;
}

async function pressButton(pane: Pane, word: string): Promise<void> {
  const button = collect(await detailOf(pane), "Button").find((node) =>
    labelOf(node).includes(word),
  );
  if (button === undefined) throw new Error(`no ${word} button is drawn`);
  await pane.press({ key: String(button.props?.key) });
}

function buttonLabelsOf(root: Node): string[] {
  return collect(root, "Button").map(labelOf);
}

function labelOf(node: Node): string {
  const label = node.props?.label;
  return typeof label === "string" ? label : textOf(node);
}

function backRowLeaves(root: Node): Node[] {
  const [backRow] = childrenOf(root);
  return backRow === undefined
    ? []
    : collect(backRow, "Text").filter((text) => childrenOf(text).length === 0);
}

function trimmedRowsOf(root: Node): string[] {
  return rowTexts(root).map((row) => row.trim());
}

function rowTexts(node: Node): string[] {
  if (node.type !== "Box" || node.props?.flexDirection !== "column") return [textOf(node)];
  return childrenOf(node).flatMap(rowTexts);
}

async function screenOf(pane: Pane): Promise<string[]> {
  return linesOf(await pane.drawn())
    .slice(0, LIST_ROWS)
    .map((line) => line.text);
}

async function callKeysOf(pane: Pane): Promise<string[]> {
  return (await pane.findAll({ type: "Button" }))
    .map((button) => String(button.key))
    .filter((key) => key.startsWith(CALL_PREFIX));
}

async function scrollBy($: Engine, pane: Pane, by: number): Promise<void> {
  await $.ui.scroll({
    component: "Pane",
    requestId: SESSION,
    offset: 0,
    by,
    bodyRows: LIST_ROWS,
    contentRows: linesOf(await pane.drawn()).length,
    origin: { kind: "person" },
  });
  await settle(pane);
}
