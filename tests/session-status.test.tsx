import { describe, expect, mock, test } from "claude-code/testing";
import type { On, ToolCallResult } from "claude-code";
import type { Engine, MockClock } from "claude-code/testing";

import { colouredPieces, screenRows } from "./band-screen";
import { inkFor } from "../hooks/pane-ink";
import { finishTurn, paneOnTab, settle, texts } from "./clear-world";

type Plan = {
  ask?: "auto" | "dialog";
  answer?: "allow" | "deny";
  answerMs?: number;
  runMs: number;
  fails?: boolean;
};
type World = { clock: MockClock };

const SECOND = 1_000;
const NOW = 200_000;
const HOME = "/Users/dev";
const PROJECT = `${HOME}/workspace/projects/paneline`;
const BAND_COLUMNS = 120;
const TURN = { text: "go", turnId: "t1" };
const BUILD = "touch build/out";
const TEST_RUN = "npm test";
const MCP_TOOL = "mcp__plugin_github_pull_request_review_comments_create_inline_thread";
const MCP_RUN = "mcp-probe";
const NARROW_COLUMNS = 80;
const SCAN = "src/scan.ts";
const STATUS_WAITING = "● waiting";
const WAITING = "waiting";
const THINKING = "thinking";
const WORKING_BASH = "working Bash";
const WORKING_READ = "working Read";
const TIMER_FIVE = "waiting 5s";
const MARK_CHARS = /●|thinking|working|waiting/;
const SIXTY_COLUMNS = 60;
const PANE_TOGGLE = " ".repeat(5);
const METER_NUMBERS = "≡ 72%   ◷ 2h 48%   ▦ 3d 59%";
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WINDOW = 200_000;
const TOKENS_AT_72 = 144_000;
const LAST_WIDTH_WITH_MARK_BESIDE_PATH = 73;
const FIRST_WIDTH_WITH_MARK_ABOVE_PATH = 72;

describe("session status", () => {
  test("A1 a Bash call the engine approves on its own never shows waiting, and the status row shows working Bash while it runs", async ($, on) => {
    const world = worldOf($, on, { [BUILD]: { ask: "auto", runMs: 10 * SECOND } });
    await startSession($);
    const pane = await paneOnTab($, "Activity");
    await $.turn.start(TURN);
    const call = startBash($, BUILD);
    await world.clock.advance(2 * SECOND);
    await settle(pane);

    expect(await statusRowText($)).toContain(WORKING_BASH);
    expect(await statusRowText($)).not.toContain(WAITING);
    expect((await texts(pane)).some((text) => text.includes(WAITING))).toBe(false);
    expect((await texts(pane)).some((text) => text.includes(BUILD))).toBe(true);
    await answerAndFinish(world, call, 10 * SECOND);
  });

  test("A2 a Bash call held by a permission dialog shows waiting in the status row and waiting with a timer in the Activity Now row", async ($, on) => {
    const world = worldOf($, on, {
      [BUILD]: { ask: "dialog", answerMs: 20 * SECOND, answer: "allow", runMs: SECOND },
    });
    await startSession($);
    const pane = await paneOnTab($, "Activity");
    await $.turn.start(TURN);
    const call = startBash($, BUILD);
    await world.clock.advance(5 * SECOND);
    await settle(pane);

    expect(await statusRowText($)).toContain(STATUS_WAITING);
    expect((await texts(pane)).some((text) => text.includes(TIMER_FIVE))).toBe(true);
    await answerAndFinish(world, call, 20 * SECOND);
  });

  test("A3 after the person allows the dialog and the command finishes, the status row says thinking and no longer waiting", async ($, on) => {
    const world = worldOf($, on, {
      [BUILD]: { ask: "dialog", answerMs: 20 * SECOND, answer: "allow", runMs: SECOND },
    });
    await startSession($);
    await $.turn.start(TURN);
    const call = startBash($, BUILD);
    await world.clock.advance(5 * SECOND);
    await answerAndFinish(world, call, 20 * SECOND);

    expect(await statusRowText($)).toContain(THINKING);
    expect(await statusRowText($)).not.toContain(WAITING);
  });

  test("A4 a Read call with no dialog shows working Read in the status row while it runs", async ($, on) => {
    const world = worldOf($, on, { [SCAN]: { runMs: 10 * SECOND } });
    await startSession($);
    const pane = await paneOnTab($, "Activity");
    await $.turn.start(TURN);
    const call = startRead($, SCAN);
    await world.clock.advance(2 * SECOND);
    await settle(pane);

    expect(await statusRowText($)).toContain(WORKING_READ);
    await answerAndFinish(world, call, 10 * SECOND);
  });

  test("A5 a running turn with no tool call shows thinking in the status row", async ($, on) => {
    const world = worldOf($, on, {});
    await startSession($);
    await $.turn.start(TURN);
    await world.clock.advance(2 * SECOND);

    expect(await statusRowText($)).toContain(THINKING);
  });

  test("A6 a completed turn leaves no status mark in the status row", async ($, on) => {
    const world = worldOf($, on, {});
    await startSession($);
    await $.turn.start(TURN);
    await world.clock.advance(2 * SECOND);
    await finishTurn($, 5 * SECOND);
    await world.clock.advance(SECOND);

    expect(await statusRowText($)).not.toMatch(MARK_CHARS);
  });

  test("A7 a Read call that ends inside a running turn puts thinking back and no longer names Read", async ($, on) => {
    const world = worldOf($, on, { [SCAN]: { runMs: 3 * SECOND } });
    await startSession($);
    await $.turn.start(TURN);
    const call = startRead($, SCAN);
    await answerAndFinish(world, call, 3 * SECOND);

    expect(await statusRowText($)).toContain(THINKING);
    expect(await statusRowText($)).not.toContain(WORKING_READ);
  });

  test("A8 after the person denies the dialog the status row says thinking, not waiting", async ($, on) => {
    const world = worldOf($, on, {
      [BUILD]: { ask: "dialog", answerMs: 7 * SECOND, answer: "deny", runMs: 0 },
    });
    await startSession($);
    await $.turn.start(TURN);
    const call = startBash($, BUILD);
    await answerAndFinish(world, call, 7 * SECOND);

    expect(await statusRowText($)).toContain(THINKING);
    expect(await statusRowText($)).not.toContain(WAITING);
  });

  test("A9 a Bash call that fails inside a running turn puts thinking back and does not stay on working Bash", async ($, on) => {
    const world = worldOf($, on, { [BUILD]: { runMs: 2 * SECOND, fails: true } });
    await startSession($);
    await $.turn.start(TURN);
    const call = startBash($, BUILD);
    await answerAndFinish(world, call, 2 * SECOND);

    expect(await statusRowText($)).toContain(THINKING);
    expect(await statusRowText($)).not.toContain(WORKING_BASH);
  });

  test("A10 while one Bash dialog is still open, another Bash call ending does not clear waiting, and allowing the last dialog does", async ($, on) => {
    const world = worldOf($, on, {
      [BUILD]: { ask: "dialog", answerMs: 2 * SECOND, answer: "allow", runMs: 5 * SECOND },
      [TEST_RUN]: { ask: "dialog", answerMs: 20 * SECOND, answer: "allow", runMs: SECOND },
    });
    await startSession($);
    await $.turn.start(TURN);
    const first = startBash($, BUILD);
    const second = startBash($, TEST_RUN);
    await world.clock.advance(5 * SECOND);
    expect(await statusRowText($)).toContain(STATUS_WAITING);

    await world.clock.advance(5 * SECOND);
    expect(await statusRowText($)).toContain(STATUS_WAITING);

    await world.clock.advance(11 * SECOND);
    expect(await statusRowText($)).not.toContain(WAITING);
    await Promise.all([first, second]);
  });

  test("A11 in the light theme the waiting mark keeps the warning colour", async ($, on) => {
    await waitingMarkScenario($, on, "light");
  });

  test("A12 in the light-ansi theme the waiting mark keeps the warning colour", async ($, on) => {
    await waitingMarkScenario($, on, "light-ansi");
  });

  test("A13 in the dark-ansi theme the waiting mark keeps the warning colour", async ($, on) => {
    await waitingMarkScenario($, on, "dark-ansi");
  });

  test("A14 at 80 columns a long MCP tool name while working keeps the status row within the width and the height it has when idle", async ($, on) => {
    const world = worldOf($, on, { [MCP_RUN]: { runMs: 10 * SECOND } });
    await startSession($);
    const idle = screenRows(await mountBand($, NARROW_COLUMNS), NARROW_COLUMNS);
    await $.turn.start(TURN);
    const call = startMcp($, MCP_TOOL, MCP_RUN);
    await world.clock.advance(2 * SECOND);
    const working = screenRows(await mountBand($, NARROW_COLUMNS), NARROW_COLUMNS);

    expect(working).toHaveLength(idle.length);
    expect(working.every((row) => row.trimEnd().length <= NARROW_COLUMNS)).toBe(true);
    expect(working.at(-1)).toContain("working");
    await answerAndFinish(world, call, 10 * SECOND);
  });

  test("at 60 columns a long MCP tool name while working keeps all three meters the idle row has and moves the mark above the path", async ($, on) => {
    const world = worldOf($, on, { [MCP_RUN]: { runMs: 10 * SECOND } });
    await startSession($);
    await measureLimits($);
    const idle = screenRows(await mountBand($, SIXTY_COLUMNS), SIXTY_COLUMNS);
    await $.turn.start(TURN);
    const call = startMcp($, MCP_TOOL, MCP_RUN);
    await world.clock.advance(2 * SECOND);
    const working = screenRows(await mountBand($, SIXTY_COLUMNS), SIXTY_COLUMNS);
    await answerAndFinish(world, call, 10 * SECOND);

    expect(idle.at(-2)).toBe(`${" ".repeat(28)}${METER_NUMBERS}${PANE_TOGGLE}`);
    expect(working.at(-2)).toBe(
      ` ● working plugin_githu${" ".repeat(5)}${METER_NUMBERS}${PANE_TOGGLE}`,
    );
  });

  test("at 60 columns the band is as tall while working as while idle with the meters shown", async ($, on) => {
    const world = worldOf($, on, { [MCP_RUN]: { runMs: 10 * SECOND } });
    await startSession($);
    await measureLimits($);
    const idle = screenRows(await mountBand($, SIXTY_COLUMNS), SIXTY_COLUMNS);
    await $.turn.start(TURN);
    const call = startMcp($, MCP_TOOL, MCP_RUN);
    await world.clock.advance(2 * SECOND);
    const working = screenRows(await mountBand($, SIXTY_COLUMNS), SIXTY_COLUMNS);
    await answerAndFinish(world, call, 10 * SECOND);

    expect(working).toHaveLength(idle.length);
  });

  test("at 120 columns while working the mark stays after the path and the row above holds only the meter numbers", async ($, on) => {
    const world = worldOf($, on, { [BUILD]: { runMs: 10 * SECOND } });
    await startSession($);
    await measureLimits($);
    await $.turn.start(TURN);
    const call = startBash($, BUILD);
    await world.clock.advance(2 * SECOND);
    const rows = screenRows(await mountBand($, BAND_COLUMNS), BAND_COLUMNS);
    await answerAndFinish(world, call, 10 * SECOND);

    expect(rows.at(-2)).toBe(`${" ".repeat(88)}${METER_NUMBERS}${PANE_TOGGLE}`);
    expect(rows.at(-1)).toContain("~/workspace/projects/paneline  ● working Bash");
  });

  test("while the mark and every meter fit beside the path the mark stays after the path", async ($, on) => {
    const world = worldOf($, on, { [BUILD]: { runMs: 10 * SECOND } });
    await startSession($);
    await measureLimits($);
    await $.turn.start(TURN);
    const call = startBash($, BUILD);
    await world.clock.advance(2 * SECOND);
    const rows = screenRows(
      await mountBand($, LAST_WIDTH_WITH_MARK_BESIDE_PATH),
      LAST_WIDTH_WITH_MARK_BESIDE_PATH,
    );
    await answerAndFinish(world, call, 10 * SECOND);

    expect(rows.at(-2)?.trim()).toBe(METER_NUMBERS);
    expect(rows.at(-1)).toContain("● working Bash");
  });

  test("at the first width where the mark no longer fits beside the path it moves above the path and the 7d meter stays", async ($, on) => {
    const world = worldOf($, on, { [BUILD]: { runMs: 10 * SECOND } });
    await startSession($);
    await measureLimits($);
    await $.turn.start(TURN);
    const call = startBash($, BUILD);
    await world.clock.advance(2 * SECOND);
    const rows = screenRows(
      await mountBand($, FIRST_WIDTH_WITH_MARK_ABOVE_PATH),
      FIRST_WIDTH_WITH_MARK_ABOVE_PATH,
    );
    await answerAndFinish(world, call, 10 * SECOND);

    expect(rows.at(-2)).toBe(` ● working Bash${" ".repeat(25)}${METER_NUMBERS}${PANE_TOGGLE}`);
    expect(rows.at(-1)).not.toContain("working");
  });

  test("at 60 columns a Bash call held by a permission dialog shows waiting in the warning colour above the path with all three meters", async ($, on) => {
    const world = worldOf($, on, {
      [BUILD]: { ask: "dialog", answerMs: 20 * SECOND, answer: "allow", runMs: SECOND },
    });
    await startSession($);
    await measureLimits($);
    await $.turn.start(TURN);
    const call = startBash($, BUILD);
    await world.clock.advance(5 * SECOND);
    const band = await mountBand($, SIXTY_COLUMNS);
    await answerAndFinish(world, call, 20 * SECOND);

    expect(screenRows(band, SIXTY_COLUMNS).at(-2)).toBe(
      ` ● waiting${" ".repeat(18)}${METER_NUMBERS}${PANE_TOGGLE}`,
    );
    expect(colourOfMark(band)).toBe(inkFor("dark").alert);
  });

  test("in the light theme at 120 columns the working mark after the path keeps the theme working colour after a pane tab has drawn", async ($, on) => {
    expect(await markColour($, on, "light", BAND_COLUMNS, "working")).toBe(inkFor("light").tool);
  });

  test("in the light theme at 60 columns the working mark above the path keeps the theme working colour after a pane tab has drawn", async ($, on) => {
    expect(await markColour($, on, "light", SIXTY_COLUMNS, "working")).toBe(inkFor("light").tool);
  });

  test("in the dark theme at 120 columns the working mark after the path keeps the theme working colour after a pane tab has drawn", async ($, on) => {
    expect(await markColour($, on, "dark", BAND_COLUMNS, "working")).toBe(inkFor("dark").tool);
  });

  test("in the dark theme at 60 columns the working mark above the path keeps the theme working colour after a pane tab has drawn", async ($, on) => {
    expect(await markColour($, on, "dark", SIXTY_COLUMNS, "working")).toBe(inkFor("dark").tool);
  });

  test("in the light theme at 60 columns the waiting mark above the path keeps the warning colour", async ($, on) => {
    expect(await markColour($, on, "light", SIXTY_COLUMNS, "waiting")).toBe(inkFor("light").alert);
  });

  test("in the dark theme at 60 columns the waiting mark above the path keeps the warning colour", async ($, on) => {
    expect(await markColour($, on, "dark", SIXTY_COLUMNS, "waiting")).toBe(inkFor("dark").alert);
  });

  test("in the dark theme at 120 columns the waiting mark after the path keeps the warning colour", async ($, on) => {
    expect(await markColour($, on, "dark", BAND_COLUMNS, "waiting")).toBe(inkFor("dark").alert);
  });
});

async function markColour(
  $: Engine,
  on: On,
  theme: string,
  columns: number,
  state: "working" | "waiting",
): Promise<unknown> {
  const plan =
    state === "waiting"
      ? { ask: "dialog" as const, answerMs: 20 * SECOND, answer: "allow" as const, runMs: SECOND }
      : { runMs: 10 * SECOND };
  const world = worldOf($, on, { [BUILD]: plan }, theme);
  await startSession($);
  await measureLimits($);
  await paneOnTab($, "Activity");
  await $.turn.start(TURN);
  const call = startBash($, BUILD);
  await world.clock.advance(5 * SECOND);
  const band = await mountBand($, columns);
  await answerAndFinish(world, call, 20 * SECOND);
  return colouredPieces(band).find(({ text }) => text.includes(`● ${state}`))?.color;
}

async function measureLimits($: Engine): Promise<void> {
  await $.session.measure({
    context: { window: WINDOW, tokens: TOKENS_AT_72, percent: 72 },
    rateLimits: [
      {
        kind: "five_hour",
        percentUsed: 48,
        resetsAt: new Date(NOW + 2 * HOUR_MS + 10 * MINUTE_MS).toISOString(),
      },
      {
        kind: "seven_day",
        percentUsed: 59,
        resetsAt: new Date(NOW + 3 * DAY_MS + HOUR_MS).toISOString(),
      },
    ],
    changed: ["context", "rateLimits"],
  });
}

async function waitingMarkScenario($: Engine, on: On, theme: string): Promise<void> {
  const world = worldOf(
    $,
    on,
    {
      [BUILD]: { ask: "dialog", answerMs: 20 * SECOND, answer: "allow", runMs: SECOND },
    },
    theme,
  );
  await startSession($);
  await $.turn.start(TURN);
  const call = startBash($, BUILD);
  await world.clock.advance(5 * SECOND);

  expect(await statusRowText($)).toContain(STATUS_WAITING);
  expect(colourOfMark(await mountBand($, BAND_COLUMNS))).toBe(inkFor(theme).alert);
  await answerAndFinish(world, call, 20 * SECOND);
}

function colourOfMark(band: unknown): unknown {
  return colouredPieces(band).find(({ text }) => text.includes(STATUS_WAITING))?.color;
}

function worldOf($: Engine, on: On, plans: Record<string, Plan>, theme?: string): World {
  const clock = mock.clock(on, { now: NOW });
  mock.env(on, { HOME });
  const kept = new Map<string, unknown>();
  on("store.get", (_$, e) => ({ value: kept.get(e.key) }));
  on("store.set", (_$, e) => {
    kept.set(e.key, e.value);
    return { value: undefined };
  });
  on("session.id", () => ({ value: "s1" }));
  on(
    "config.list",
    () =>
      ({
        value: theme === undefined ? [] : [{ key: "theme", value: theme }],
      }) as never,
  );
  on("session.model", () => ({ value: "claude-opus-5-5" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: PROJECT }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("command.register", () => ({ value: {} }) as never);
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", () => ({ value: true }));
  on("turn.start", (_$, e) => ({ turnId: e.turnId }));
  on("turn.complete", (_$, e) => ({ text: e.answer }));
  on("classic.SessionStart", () => ({}));
  on("classic.UserPromptSubmit", () => ({}));
  on("classic.Stop", () => ({}));
  on("classic.PostToolUse", () => ({}));
  on("classic.PostToolUseFailure", () => ({}));
  on("ui.render", { component: "AbovePrompt" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine row</Text>;
  });
  on("process.run", () => ({ value: { exitCode: 1, stdout: "", stderr: "" } }) as never);
  on("tool.check", async (_$, e, next) => {
    const verdict = await next(e);
    return plans[subjectOf(e.input)]?.ask === "auto" ? { decision: "allow" } : verdict;
  });
  on("tool.check", { tool: /./ }, (_$, e) => ({
    decision: plans[subjectOf(e.input)]?.ask === undefined ? "allow" : "ask",
  }));
  on("classic.PermissionRequest", async (_$, e) => {
    const plan = plans[subjectOf(e.tool_input)];
    await clock.sleep(plan?.answerMs ?? 0);
    return { decision: { behavior: plan?.answer ?? "allow" } };
  });
  on("tool.call", async (_$, e) => {
    const plan = plans[subjectOf(e)];
    const runMs = plan?.runMs ?? 0;
    await clock.sleep(runMs);
    const call = { tool_name: e.tool, tool_input: e, tool_use_id: e.tool_use_id };
    if (plan?.fails === true) {
      await $.classic.PostToolUseFailure({
        hook_event_name: "PostToolUseFailure",
        ...call,
        error: "exit 1",
      } as never);
      return { isError: true, result: "exit 1", text: "exit 1" };
    }
    await $.classic.PostToolUse({
      hook_event_name: "PostToolUse",
      ...call,
      tool_response: "ok",
      duration_ms: runMs,
    } as never);
    return { result: "ok", text: "ok" };
  });
  return { clock };
}

function subjectOf(input: unknown): string {
  const fields = input as { command?: string; file_path?: string };
  return fields.command ?? fields.file_path ?? "";
}

async function startSession($: Engine): Promise<void> {
  await $.session.start({ cwd: PROJECT, surface: "terminal", isInteractive: true });
}

function startBash($: Engine, command: string): Promise<ToolCallResult> {
  return $.tool.call({ tool: "Bash", command, tool_use_id: `bash-${command}` } as never);
}

function startRead($: Engine, filePath: string): Promise<ToolCallResult> {
  return $.tool.call({
    tool: "Read",
    file_path: filePath,
    tool_use_id: `read-${filePath}`,
  } as never);
}

function startMcp($: Engine, tool: string, command: string): Promise<ToolCallResult> {
  return $.tool.call({ tool, command, tool_use_id: `mcp-${command}` } as never);
}

async function answerAndFinish(
  world: World,
  call: Promise<ToolCallResult>,
  withinMs: number,
): Promise<void> {
  await world.clock.advance(withinMs);
  await call;
}

async function statusRowText($: Engine): Promise<string> {
  const rows = screenRows(await mountBand($, BAND_COLUMNS), BAND_COLUMNS);
  return rows.at(-1)?.trimEnd() ?? "";
}

async function mountBand($: Engine, columns: number): Promise<unknown> {
  const band = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "AbovePrompt",
    props: {
      hasSurvey: false,
      isCollapsed: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns: columns,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
    viewport: { columns, rows: 40 },
  });
  return band.drawn();
}
