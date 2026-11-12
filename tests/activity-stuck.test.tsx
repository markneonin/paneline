import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { lines, texts } from "./clear-world";
import { blockOf, textsIn } from "./activity-block";

type Pane = Mounted<"terminal", "Pane">;
type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] };
type CallSpec = { tool: string } & Record<string, unknown>;
type Outcome = "ok" | "fail" | "long";

const WIDE_COLUMNS = 100;
const NARROW_COLUMNS = 60;
const FIRST_RUN = 1;
const ALERT_RUNS = 3;
const BELOW_ALERT_RUNS = 2;
const SUCCESSES_BETWEEN = 2;
const FOURTH_RUN = ALERT_RUNS + 1;
const FIFTH_RUN = BELOW_ALERT_RUNS + SUCCESSES_BETWEEN + 1;
const TEN_READS = 10;
const BUILD_TIMEOUT_MS = 120_000;
const SLOW_TEST_MS = 30_000;
const LONG_CALL_MS = 605_000;
const LONG_DURATION = "10m 05s";
const DURATION_CELLS = 6;
const READ_WINDOW = 100;
const CONTEXT_WINDOW = 200_000;
const BUILD = "npm run build";
const LINT = "npm run lint";
const UNIT = "npm test";
const APP = "/work/src/app.ts";
const UTIL = "/work/src/util.ts";
const BASH_OUTPUT = "first output line\nsecond output line";
const ALERT_COUNT = /\b\d+ (?:fails?|reads?)\b/;
const LS_STUCK = "ls zq-stuck";
const ECHO_ONE = "echo one";
const ECHO_TWO = "echo two";
const ECHO_A = "echo a";
const ECHO_B = "echo b";
const FAILED_GLYPH = "✗";
const FAILED_LIMIT = 5;
const DISTINCT_FAILURES = 7;
const STUCK_OLDEST = 6;
const LATER_CALLS = 16;
const TIMELINE_ROWS = 15;
const OLDER_TEXT = "7 older";
const MORE_LEFT_OUT = "▸ 3 more failed";

describe("Activity stuck detector", () => {
  test("S1 three failing runs of one command show one Stuck row, a fourth failing run reads 4 fails", async ($, on) => {
    worldOf(on, failing(ALERT_RUNS + 1));
    await runBashRuns($, BUILD, ALERT_RUNS);
    const pane = await mountPane($, WIDE_COLUMNS);

    const before = await bodyTexts(pane);
    const alerts = alertRowsOf(await stuckTexts(pane));
    expect(before.some((text) => text.startsWith("Stuck"))).toBe(true);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("Bash");
    expect(alerts[0]).toContain(BUILD);
    expect(alerts[0]).toContain(`${ALERT_RUNS} fails`);

    await runBash($, BUILD, FOURTH_RUN);

    const after = alertRowsOf(await stuckTexts(pane));
    expect(after).toHaveLength(1);
    expect(after[0]).toContain(`${FOURTH_RUN} fails`);
  });

  test("S2a two failing runs of one command show no Stuck section", async ($, on) => {
    worldOf(on, failing(BELOW_ALERT_RUNS));
    await runBashRuns($, BUILD, BELOW_ALERT_RUNS);
    const pane = await mountPane($, WIDE_COLUMNS);

    const texts = await bodyTexts(pane);
    expect(texts.some((text) => text.includes(BUILD))).toBe(true);
    expect(texts.some((text) => text.startsWith("Stuck"))).toBe(false);
    expect(alertRowsOf(await stuckTexts(pane))).toEqual([]);
  });

  test("S2b three failing runs of three different commands show no Stuck section", async ($, on) => {
    worldOf(on, failing(ALERT_RUNS));
    await runBashCommands($, [BUILD, LINT, UNIT]);
    const pane = await mountPane($, WIDE_COLUMNS);

    const texts = await bodyTexts(pane);
    expect(texts.some((text) => text.includes(LINT))).toBe(true);
    expect(texts.some((text) => text.startsWith("Stuck"))).toBe(false);
    expect(alertRowsOf(await stuckTexts(pane))).toEqual([]);
  });

  test("S3 two failures with successful runs between show no Stuck row, a third failure reads 3 fails", async ($, on) => {
    worldOf(on, ["fail", "ok", "fail", "ok", "fail"]);
    await runBashRuns($, BUILD, BELOW_ALERT_RUNS + SUCCESSES_BETWEEN);
    const pane = await mountPane($, WIDE_COLUMNS);

    const before = await bodyTexts(pane);
    expect(before.some((text) => text.startsWith("Stuck"))).toBe(false);
    expect(alertRowsOf(await stuckTexts(pane))).toEqual([]);

    await runBash($, BUILD, FIFTH_RUN);

    const alerts = alertRowsOf(await stuckTexts(pane));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain(BUILD);
    expect(alerts[0]).toContain(`${ALERT_RUNS} fails`);
  });

  test("S4a three reads of one file show a Stuck row with the path relative to the project and 3 reads", async ($, on) => {
    worldOf(on, []);
    await readFileTimes($, APP, ALERT_RUNS);
    const pane = await mountPane($, WIDE_COLUMNS);

    const texts = await bodyTexts(pane);
    const alerts = alertRowsOf(await stuckTexts(pane));
    expect(texts.some((text) => text.startsWith("Stuck"))).toBe(true);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain("Read");
    expect(alerts[0]).toContain("src/app.ts");
    expect(alerts[0]).not.toContain("/work/");
    expect(alerts[0]).toContain(`${ALERT_RUNS} reads`);
  });

  test("S4b two reads each of two files show no Stuck section", async ($, on) => {
    worldOf(on, []);
    await readFileTimes($, APP, BELOW_ALERT_RUNS);
    await readFileTimes($, UTIL, BELOW_ALERT_RUNS);
    const pane = await mountPane($, WIDE_COLUMNS);

    const texts = await bodyTexts(pane);
    expect(texts.some((text) => text.includes("src/util.ts"))).toBe(true);
    expect(texts.some((text) => text.startsWith("Stuck"))).toBe(false);
    expect(alertRowsOf(await stuckTexts(pane))).toEqual([]);
  });

  test("S6 three failing runs of one command with different input fields show one Stuck row, 3 fails", async ($, on) => {
    worldOf(on, failing(ALERT_RUNS));
    await $.tool.call({ tool: "Bash", command: BUILD, tool_use_id: "shape-plain" } as never);
    await $.tool.call({
      tool: "Bash",
      command: BUILD,
      description: "attempt 2",
      tool_use_id: "shape-described",
    } as never);
    await $.tool.call({
      tool: "Bash",
      command: BUILD,
      timeout: BUILD_TIMEOUT_MS,
      tool_use_id: "shape-timed",
    } as never);
    const pane = await mountPane($, WIDE_COLUMNS);

    const alerts = alertRowsOf(await stuckTexts(pane));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain(BUILD);
    expect(alerts[0]).toContain(`${ALERT_RUNS} fails`);
  });

  test("S5 at 60 columns ten reads of one file show 10 reads in full on one row", async ($, on) => {
    worldOf(on, []);
    await readFileTimes($, APP, TEN_READS);
    const pane = await mountPane($, NARROW_COLUMNS);

    const alerts = alertRowsOf(await stuckTexts(pane));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain(`${TEN_READS} reads`);
  });

  test(
    "S7 a Timeline call that took ten minutes keeps its six-cell duration, while a Stuck row still shows 10 reads in full",
    { timeoutMs: SLOW_TEST_MS },
    async ($, on) => {
      worldOf(on, ["long"]);
      await $.tool.call({
        tool: "Bash",
        command: BUILD,
        description: "attempt 1",
        tool_use_id: callId("bash", BUILD, FIRST_RUN),
      } as never);
      await readFileTimes($, APP, TEN_READS);
      const pane = await mountPane($, NARROW_COLUMNS);

      const durationCell = cellHolding(await pane.drawn(), LONG_DURATION);
      expect(durationCell).toBeDefined();
      expect(durationCell?.props?.width).toBe(DURATION_CELLS);
      expect(
        alertRowsOf(await stuckTexts(pane)).some((text) => text.includes(`${TEN_READS} reads`)),
      ).toBe(true);
    },
  );

  test("U1 three failed ls runs in a row and two other calls draw the failed command once in Stuck, Failed and Timeline", async ($, on) => {
    worldOf(on, failing(ALERT_RUNS));
    await runBashRuns($, LS_STUCK, ALERT_RUNS);
    await runBash($, ECHO_ONE, FIRST_RUN);
    await runBash($, ECHO_TWO, FIRST_RUN);
    const pane = await mountPane($, WIDE_COLUMNS);

    const shown = await lines(pane);
    expect(rowsHolding(blockOf(shown, "Stuck"), LS_STUCK)).toHaveLength(1);
    expect(rowsHolding(blockOf(shown, "Failed"), LS_STUCK)).toHaveLength(1);
    expect(rowsHolding(blockOf(shown, "Timeline"), LS_STUCK)).toHaveLength(1);
    for (const title of ["Failed", "Timeline"]) {
      const [row = ""] = rowsHolding(blockOf(shown, title), LS_STUCK);
      expect(row).toContain(`${ALERT_RUNS} fails`);
      expect(row).toContain(FAILED_GLYPH);
    }
  });

  test("U2 a command failing three times with another call between each draws once in Timeline with 3 fails, at its newest run", async ($, on) => {
    worldOf(on, ["fail", "ok", "fail", "ok", "fail"]);
    await runBash($, LS_STUCK, FIRST_RUN);
    await runBash($, ECHO_A, FIRST_RUN);
    await runBash($, LS_STUCK, FIRST_RUN + 1);
    await runBash($, ECHO_B, FIRST_RUN);
    await runBash($, LS_STUCK, FIRST_RUN + 2);
    const pane = await mountPane($, WIDE_COLUMNS);

    const timeline = textsIn(blockOf(await lines(pane), "Timeline"));
    expect(timeline).toHaveLength(3);
    expect(timeline[0]).toContain(LS_STUCK);
    expect(timeline[0]).toContain(`${ALERT_RUNS} fails`);
    expect(timeline[1]).toContain(ECHO_B);
    expect(timeline[2]).toContain(ECHO_A);
  });

  test("U2b a command failing twice with another call between keeps two Timeline rows and draws Failed once with 2 fails", async ($, on) => {
    worldOf(on, ["fail", "ok", "fail"]);
    await runBash($, LS_STUCK, FIRST_RUN);
    await runBash($, ECHO_A, FIRST_RUN);
    await runBash($, LS_STUCK, FIRST_RUN + 1);
    const pane = await mountPane($, WIDE_COLUMNS);

    const shown = await lines(pane);
    expect(rowsHolding(blockOf(shown, "Timeline"), LS_STUCK)).toHaveLength(BELOW_ALERT_RUNS);
    const failed = rowsHolding(blockOf(shown, "Failed"), LS_STUCK);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain(`${BELOW_ALERT_RUNS} fails`);
  });

  test("U3 twenty-two calls whose six oldest are one stuck command show fifteen Timeline rows and 7 older", async ($, on) => {
    worldOf(on, failing(STUCK_OLDEST));
    await runBashRuns($, LS_STUCK, STUCK_OLDEST);
    for (let i = 0; i < LATER_CALLS; i++) await runBash($, `echo row-${i}`, FIRST_RUN);
    const pane = await mountPane($, WIDE_COLUMNS);

    const timeline = textsIn(blockOf(await lines(pane), "Timeline"));
    expect(timeline.filter((text) => text.includes("echo row-"))).toHaveLength(TIMELINE_ROWS);
    expect(timeline.filter((text) => text === OLDER_TEXT)).toEqual([OLDER_TEXT]);
  });

  test("U4 seven distinct failures and three runs of one failing command show five Failed rows and ▸ 3 more failed", async ($, on) => {
    worldOf(on, failing(DISTINCT_FAILURES + ALERT_RUNS));
    for (let i = 1; i <= DISTINCT_FAILURES; i++) await runBash($, `boom ${i}`, FIRST_RUN);
    await runBashRuns($, LS_STUCK, ALERT_RUNS);
    const pane = await mountPane($, WIDE_COLUMNS);

    expect(await failedRowKeysOf(pane)).toHaveLength(FAILED_LIMIT);
    expect(
      textsIn(blockOf(await lines(pane), "Failed")).filter((text) => text === MORE_LEFT_OUT),
    ).toEqual([MORE_LEFT_OUT]);
  });

  test("U5 five distinct failures newer than three failures of one command show ▸ 3 more failed and an errors chip of 8", async ($, on) => {
    worldOf(on, failing(ALERT_RUNS + FAILED_LIMIT));
    await runBashRuns($, LS_STUCK, ALERT_RUNS);
    for (let i = 1; i <= FAILED_LIMIT; i++) await runBash($, `boom ${i}`, FIRST_RUN);
    const pane = await mountPane($, WIDE_COLUMNS);

    const shown = await lines(pane);
    expect(textsIn(blockOf(shown, "Failed")).filter((text) => text === MORE_LEFT_OUT)).toEqual([
      MORE_LEFT_OUT,
    ]);
    expect((await texts(pane)).find((text) => text.includes(" errors"))).toMatch(/· 8 errors$/);
  });

  test("U6 three reads of one file among two other calls show that file once in Stuck and once in Timeline as 3 reads", async ($, on) => {
    worldOf(on, []);
    await readFileTimes($, APP, ALERT_RUNS);
    await runBash($, ECHO_A, FIRST_RUN);
    await runBash($, ECHO_B, FIRST_RUN);
    const pane = await mountPane($, WIDE_COLUMNS);

    const shown = await lines(pane);
    expect(rowsHolding(blockOf(shown, "Stuck"), "src/app.ts")).toHaveLength(1);
    const timeline = rowsHolding(blockOf(shown, "Timeline"), "src/app.ts");
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toContain(`${ALERT_RUNS} reads`);
  });
});

function rowsHolding(block: ReturnType<typeof blockOf>, fragment: string): string[] {
  return textsIn(block).filter((text) => text.includes(fragment));
}

async function stuckTexts(pane: Pane): Promise<string[]> {
  return textsIn(blockOf(await lines(pane), "Stuck"));
}

async function failedRowKeysOf(pane: Pane): Promise<string[]> {
  return (await pane.findAll({ type: "Button" }))
    .map((button) => String(button.key))
    .filter((key) => key.startsWith("failed-"));
}

function worldOf(on: On, bashOutcomes: Outcome[]): void {
  const clock = mock.clock(on);
  mock.env(on, { HOME: "/h/u" });
  const queue = [...bashOutcomes];
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: CONTEXT_WINDOW }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: "/work" }));
  on("agent.list", () => ({ value: [] }));
  on("tool.call", async (_$, e) => {
    const call = e as unknown as CallSpec;
    const outcome = call.tool === "Bash" ? queue.shift() : undefined;
    if (outcome === "long") await clock.advance(LONG_CALL_MS);
    if (outcome === "fail") return { isError: true, result: "boom", text: "boom" } as never;
    return { result: BASH_OUTPUT, text: BASH_OUTPUT };
  });
}

function failing(count: number): Outcome[] {
  return Array.from({ length: count }, (): Outcome => "fail");
}

async function runBashRuns($: Engine, command: string, runs: number): Promise<void> {
  for (let run = FIRST_RUN; run <= runs; run++) await runBash($, command, run);
}

async function runBashCommands($: Engine, commands: string[]): Promise<void> {
  for (const command of commands) await runBash($, command, FIRST_RUN);
}

async function runBash($: Engine, command: string, run: number): Promise<void> {
  await $.tool.call({
    tool: "Bash",
    command,
    description: `attempt ${run}`,
    tool_use_id: callId("bash", command, run),
  } as never);
}

async function readFileTimes($: Engine, file: string, times: number): Promise<void> {
  for (let run = FIRST_RUN; run <= times; run++)
    await $.tool.call({
      tool: "Read",
      file_path: file,
      offset: run * READ_WINDOW,
      limit: READ_WINDOW,
      tool_use_id: callId("read", file, run),
    } as never);
}

function callId(tool: string, subject: string, run: number): string {
  return `${tool}-${subject}-${run}`.replace(/\W+/g, "-");
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
      scroll: { offset: 0, bodyRows: 80 },
      view: {},
    },
    viewport: { columns, rows: 80 },
  });
}

async function bodyTexts(pane: Pane): Promise<string[]> {
  return rowTexts((await pane.drawn()) as unknown as Node).filter((text) => text !== "");
}

function alertRowsOf(texts: string[]): string[] {
  return texts.filter((text) => ALERT_COUNT.test(text));
}

function rowTexts(node: Node): string[] {
  if (node.type === "Text") return [textOf(node)];
  if (isRow(node) && !holdsColumn(node)) return [textOf(node)];
  return elementsIn(node).flatMap(rowTexts);
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

function cellHolding(node: Node, text: string): Node | undefined {
  if (
    node.type === "Box" &&
    elementsIn(node).some((child) => child.type === "Text" && textOf(child) === text)
  )
    return node;
  return elementsIn(node)
    .map((child) => cellHolding(child, text))
    .find((found) => found !== undefined);
}

function elementsIn(node: Node): Node[] {
  return (node.children ?? []).filter(
    (child): child is Node => typeof child === "object" && child !== null,
  );
}

function textOf(node: Node): string {
  const label = node.props?.label;
  const shown = node.type === "Button" && typeof label === "string" ? label : "";
  return [
    shown,
    ...(node.children ?? []).map((child) =>
      typeof child === "string" ? child : textOf(child as Node),
    ),
  ]
    .filter((part) => part !== "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
