import { describe, expect, mock, test } from "claude-code/testing";
import type { On, ToolCallResult } from "claude-code";
import type { Engine, MockClock } from "claude-code/testing";

import { splitTurn, waitOf } from "../hooks/activity-track";
import { palette } from "../hooks/palette";
import { inkFor, paneInk } from "../hooks/pane-ink";
import { colouredPieces, screenRows } from "./band-screen";
import { clearButtonsOf, finishTurn, headingLineOf, lines, paneOnTab, settle } from "./clear-world";
import type { Pane } from "./clear-world";
import { keyOf } from "./skills-tree";

type Plan = { askMs?: number; answer?: "allow" | "deny"; runMs: number };
type World = { clock: MockClock };
type Piece = { text: string; color: unknown };

const SECOND = 1_000;
const NOW = 200_000;
const HOME = "/Users/dev";
const PROJECT = `${HOME}/workspace/projects/paneline`;
const BAND_COLUMNS = 120;
const DEFAULT_THEME = "dark";
const WAITING_MARK = "● waiting";
const SUMMARY_PREFIX = "model ";
const LIVE_ROWS_ABOVE_TIME = 2;
const PILL = "(ctrl+b to run in background)";
const SUBAGENT = "sub-1";
const CLASSIFIED_WALL_MS = 4 * SECOND;
const RUN_MS = SECOND;
const CLEARED_WALL_MS = 3 * SECOND;
const INSTANT_RUN_MS = 0;
const CALL_START_MS = 2 * SECOND;
const TURN_MS = 7 * SECOND;

describe("permission waits", () => {
  test("W1 a call held by a permission ask shows waiting 5s in the alert colour on the live line above the chip line after 5 s, then keeps counting", async ($, on) => {
    const world = worldOf($, on, {
      sleepy: { askMs: 20 * SECOND, answer: "allow", runMs: SECOND },
    });
    const pane = await paneOnTab($, "Activity");
    const call = startBash($, "sleepy");

    await world.clock.advance(5 * SECOND);
    await settle(pane);

    expect(await liveRowText(pane)).toContain("waiting 5s");
    expect(headingLineOf(await lines(pane), "Now")).toBeUndefined();
    const pieces = colouredPieces(await pane.drawn());
    expect(colourOf(pieces, "waiting 5s")).toBe(palette.alert);
    expect(dotBefore(pieces, "waiting 5s")?.color).toBe(palette.alert);

    await world.clock.advance(3 * SECOND);
    await settle(pane);

    expect(await liveRowText(pane)).toContain("waiting 8s");
    await answerAndFinish(world, call, 20 * SECOND);
  });

  test("W3 a 60 s turn with a 20 s wait and a 4 s run reads model 36s, tools 4s, waiting on you 20s, the 20s in the text colour", async ($, on) => {
    const world = worldOf($, on, {
      build: { askMs: 20 * SECOND, answer: "allow", runMs: 4 * SECOND },
    });
    const pane = await paneOnTab($, "Activity");
    await $.turn.start({ text: "go", turnId: "t1" });
    await world.clock.advance(30 * SECOND);

    await runBash($, world, "build", 24 * SECOND);
    await world.clock.advance(6 * SECOND);
    await finishTurn($, 40 * SECOND);
    await settle(pane);

    expect(await summaryText(pane)).toBe("model 36s · tools 4s · waiting on you 20s");
    expect(colourOf(colouredPieces(await pane.drawn()), "20s")).toBe(palette.text);
  });

  test("W4 a Bash call stops showing waiting once its run-in-background pill is drawn, while the call still runs", async ($, on) => {
    const world = worldOf($, on, {
      slow: { askMs: 3 * SECOND, answer: "allow", runMs: 60 * SECOND },
    });
    const pane = await paneOnTab($, "Activity");
    const call = startBash($, "slow");
    await world.clock.advance(4 * SECOND);
    await settle(pane);
    expect(await liveRowText(pane)).toContain("waiting");
    expect((await bandRows($)).join("\n")).toContain(WAITING_MARK);

    await drawPill($, "slow");
    await world.clock.advance(SECOND);
    await settle(pane);

    const shown = (await lines(pane)).map((line) => line.text);
    expect(shown.some((text) => text.includes("Bash") && text.includes("slow"))).toBe(true);
    expect(await liveRowText(pane)).not.toContain("waiting");
    expect((await bandRows($)).join("\n")).not.toContain(WAITING_MARK);
    await answerAndFinish(world, call, 60 * SECOND);
  });

  test("W4b the pill of another call leaves a call that still waits showing waiting on the live line", async ($, on) => {
    const world = worldOf($, on, {
      first: { askMs: 3 * SECOND, answer: "allow", runMs: 60 * SECOND },
      second: { askMs: 20 * SECOND, answer: "allow", runMs: SECOND },
    });
    const pane = await paneOnTab($, "Activity");
    const firstCall = startBash($, "first");
    const secondCall = startBash($, "second");
    await world.clock.advance(4 * SECOND);

    await drawPill($, "first");
    await world.clock.advance(SECOND);
    await settle(pane);

    expect(await liveRowText(pane)).toContain("waiting");
    expect(await liveRowText(pane)).toContain("second");
    expect(await liveRowText(pane)).not.toContain("first");
    await answerAndFinish(world, firstCall, 60 * SECOND);
    await answerAndFinish(world, secondCall, 20 * SECOND);
  });

  test("W5 an Agent call stops showing waiting once its agent spawns, while the call still runs", async ($, on) => {
    const world = worldOf($, on, {
      scout: { askMs: 3 * SECOND, answer: "allow", runMs: 60 * SECOND },
    });
    const pane = await paneOnTab($, "Activity");
    const call = startAgent($, "scout");
    await world.clock.advance(4 * SECOND);
    await settle(pane);
    expect(await liveRowText(pane)).toContain("waiting");
    expect((await bandRows($)).join("\n")).toContain(WAITING_MARK);

    await spawnAgent($, "scout");
    await world.clock.advance(SECOND);
    await settle(pane);

    const shown = (await lines(pane)).map((line) => line.text);
    expect(shown.some((text) => text.includes("Agent") && text.includes("scout"))).toBe(true);
    expect(await liveRowText(pane)).not.toContain("waiting");
    expect((await bandRows($)).join("\n")).not.toContain(WAITING_MARK);
    await answerAndFinish(world, call, 60 * SECOND);
  });

  test("W6a the first status row draw while a main call waits shows waiting in the alert colour, and the row drawn after the call ends does not", async ($, on) => {
    const world = worldOf($, on, { hold: { askMs: 10 * SECOND, answer: "allow", runMs: SECOND } });
    await $.session.start({ cwd: PROJECT, surface: "terminal", isInteractive: true });
    const call = startBash($, "hold");

    await world.clock.advance(5 * SECOND);
    const duringTree = await mountBand($);
    const during = screenRows(duringTree, BAND_COLUMNS);
    const duringPieces = colouredPieces(duringTree);
    await world.clock.advance(7 * SECOND);
    await call;
    const after = await bandRows($);

    expect(during.join("\n")).toContain(WAITING_MARK);
    expect(duringPieces.find((piece) => piece.text.includes("waiting"))?.color).toBe(
      paneInk().alert,
    );
    expect(after.join("\n")).not.toContain(WAITING_MARK);
  });

  test("W6b the status row shows waiting while a subagent call waits and drops it when that call ends", async ($, on) => {
    const world = worldOf($, on, { hold: { askMs: 10 * SECOND, answer: "allow", runMs: SECOND } });
    await $.session.start({ cwd: PROJECT, surface: "terminal", isInteractive: true });
    const call = startBash($, "hold", SUBAGENT);

    await world.clock.advance(5 * SECOND);
    const during = await bandRows($);
    await world.clock.advance(7 * SECOND);
    await call;
    const after = await bandRows($);

    expect(during.join("\n")).toContain(WAITING_MARK);
    expect(after.join("\n")).not.toContain(WAITING_MARK);
  });

  test("W7 a call never asked books its whole time to tools and the time row has no waiting part", async ($, on) => {
    const world = worldOf($, on, { quick: { runMs: 8 * SECOND } });
    const pane = await paneOnTab($, "Activity");
    await $.turn.start({ text: "go", turnId: "t1" });
    await world.clock.advance(5 * SECOND);

    await runBash($, world, "quick", 8 * SECOND);
    await world.clock.advance(7 * SECOND);
    await finishTurn($, 20 * SECOND);
    await settle(pane);

    expect(await summaryText(pane)).toBe("model 12s · tools 8s");
    expect(await summaryText(pane)).not.toContain("waiting");
  });

  test("W8 a call denied at the prompt books its whole time to you and none to tools", async ($, on) => {
    const world = worldOf($, on, { risky: { askMs: 7 * SECOND, answer: "deny", runMs: 0 } });
    const pane = await paneOnTab($, "Activity");
    await $.turn.start({ text: "go", turnId: "t1" });
    await world.clock.advance(3 * SECOND);

    await runBash($, world, "risky", 7 * SECOND);
    await world.clock.advance(10 * SECOND);
    await finishTurn($, 13 * SECOND);
    await settle(pane);

    expect(await summaryText(pane)).toBe("model 13s · tools 0ms · waiting on you 7s");
  });

  test("S1a two overlapping 10 s calls inside a 20 s turn give tools 10s, not 20s", async ($, on) => {
    const world = worldOf($, on, { left: { runMs: 10 * SECOND }, right: { runMs: 10 * SECOND } });
    const pane = await paneOnTab($, "Activity");
    await $.turn.start({ text: "go", turnId: "t1" });

    const left = startBash($, "left");
    const right = startBash($, "right");
    await world.clock.advance(10 * SECOND);
    await Promise.all([left, right]);
    await world.clock.advance(10 * SECOND);
    await finishTurn($, 20 * SECOND);
    await settle(pane);

    expect(await summaryText(pane)).toBe("model 10s · tools 10s");
  });

  test("S1b a wait that overlaps another call's run counts as you, the run counts only outside it", async ($, on) => {
    const world = worldOf($, on, {
      runner: { runMs: 10 * SECOND },
      asker: { askMs: 6 * SECOND, answer: "allow", runMs: 4 * SECOND },
    });
    const pane = await paneOnTab($, "Activity");
    await $.turn.start({ text: "go", turnId: "t1" });

    const runner = startBash($, "runner");
    const asker = startBash($, "asker");
    await world.clock.advance(6 * SECOND);
    await world.clock.advance(4 * SECOND);
    await Promise.all([runner, asker]);
    await world.clock.advance(10 * SECOND);
    await finishTurn($, 14 * SECOND);
    await settle(pane);

    expect(await summaryText(pane)).toBe("model 10s · tools 4s · waiting on you 6s");
  });

  test("S1c two overlapping 10 s waits in a 12 s turn give you 10s, so tools and you never pass the turn", async ($, on) => {
    const world = worldOf($, on, {
      north: { askMs: 10 * SECOND, answer: "allow", runMs: SECOND },
      south: { askMs: 10 * SECOND, answer: "allow", runMs: SECOND },
    });
    const pane = await paneOnTab($, "Activity");
    await $.turn.start({ text: "go", turnId: "t1" });

    const north = startBash($, "north");
    const south = startBash($, "south");
    await world.clock.advance(10 * SECOND);
    await world.clock.advance(SECOND);
    await Promise.all([north, south]);
    await world.clock.advance(SECOND);
    await finishTurn($, 2 * SECOND);
    await settle(pane);

    expect(await summaryText(pane)).toBe("model 1s · tools 1s · waiting on you 10s");
  });

  test("W10 a main call still held by a permission ask no longer shows waiting once the owner's next turn starts", async ($, on) => {
    const world = worldOf($, on, { held: { askMs: 60 * SECOND, answer: "deny", runMs: 0 } });
    await $.session.start({ cwd: PROJECT, surface: "terminal", isInteractive: true });
    const call = startBash($, "held");
    await world.clock.advance(SECOND);
    expect((await bandRows($)).join("\n")).toContain(WAITING_MARK);

    await $.turn.start({ text: "go", turnId: "t2" });

    expect((await bandRows($)).join("\n")).not.toContain(WAITING_MARK);
    await answerAndFinish(world, call, 60 * SECOND);
  });

  test("W11 a main call still held by a permission ask no longer shows waiting once the turn completes", async ($, on) => {
    const world = worldOf($, on, { held: { askMs: 60 * SECOND, answer: "deny", runMs: 0 } });
    await $.session.start({ cwd: PROJECT, surface: "terminal", isInteractive: true });
    await $.turn.start({ text: "go", turnId: "t1" });
    const call = startBash($, "held");
    await world.clock.advance(SECOND);
    expect((await bandRows($)).join("\n")).toContain(WAITING_MARK);

    await finishTurn($, SECOND);

    expect((await bandRows($)).join("\n")).not.toContain(WAITING_MARK);
    await answerAndFinish(world, call, 60 * SECOND);
  });

  test("W9 pressing Clear resets the split row together with the total", async ($, on) => {
    const world = worldOf($, on, {
      build: { askMs: 20 * SECOND, answer: "allow", runMs: 4 * SECOND },
    });
    const pane = await paneOnTab($, "Activity");
    await $.turn.start({ text: "go", turnId: "t1" });
    await runBash($, world, "build", 24 * SECOND);
    await world.clock.advance(6 * SECOND);
    await finishTurn($, 10 * SECOND);
    await settle(pane);
    expect(await summaryText(pane)).toBe("model 6s · tools 4s · waiting on you 20s");

    const [button] = clearButtonsOf(await lines(pane));
    await pane.press({ key: keyOf(button) });
    await world.clock.advance(SECOND);
    await settle(pane);

    expect(await summaryText(pane)).toBe("model 0ms · tools 0ms");
  });

  test("W14 a turn that never waited on the owner reads model and tools only, with no waiting on you part", async ($, on) => {
    const world = worldOf($, on, {});
    const pane = await paneOnTab($, "Activity");
    await $.turn.start({ text: "go", turnId: "t1" });
    await world.clock.advance(5 * SECOND);
    await finishTurn($, 5 * SECOND);
    await settle(pane);

    expect(await summaryText(pane)).toBe("model 5s · tools 0ms");
  });

  test("W12 an ask cleared without a permission request books its whole time to tools and none to you", () => {
    expect(waitOf({ dialogOpened: false, wallMs: CLASSIFIED_WALL_MS, durationMs: RUN_MS })).toBe(0);
  });

  test("W12b a call that opened a permission dialog books the time before its run to you", () => {
    expect(waitOf({ dialogOpened: true, wallMs: CLASSIFIED_WALL_MS, durationMs: RUN_MS })).toBe(
      3 * SECOND,
    );
  });

  test("W13 two parallel classifier-cleared calls of 3 s in a 7 s turn split into tools 3s and you 0ms", () => {
    const cleared = { dialogOpened: false, wallMs: CLEARED_WALL_MS, durationMs: INSTANT_RUN_MS };
    const call = {
      start: CALL_START_MS,
      waitEnd: CALL_START_MS + waitOf(cleared),
      end: CALL_START_MS + CLEARED_WALL_MS,
    };

    expect(splitTurn([call, call], 0, TURN_MS)).toEqual({ toolsMs: CLEARED_WALL_MS, youMs: 0 });
  });

  test("D5 on light-ansi the waiting mark in the status row is drawn in that theme's alert ink", async ($, on) => {
    const world = worldOf(
      $,
      on,
      { hold: { askMs: 10 * SECOND, answer: "allow", runMs: SECOND } },
      "light-ansi",
    );
    await $.session.start({ cwd: PROJECT, surface: "terminal", isInteractive: true });
    await paneOnTab($, "Activity");
    const call = startBash($, "hold");
    await world.clock.advance(5 * SECOND);

    expect(waitingMarkOf(await mountBand($))?.color).toBe(inkFor("light-ansi").alert);

    await answerAndFinish(world, call, 10 * SECOND);
  });

  test("D6 on auto the waiting mark in the status row is drawn in the terminal's own yellow", async ($, on) => {
    const world = worldOf(
      $,
      on,
      { hold: { askMs: 10 * SECOND, answer: "allow", runMs: SECOND } },
      "auto",
    );
    await $.session.start({ cwd: PROJECT, surface: "terminal", isInteractive: true });
    await paneOnTab($, "Activity");
    const call = startBash($, "hold");
    await world.clock.advance(5 * SECOND);

    expect(waitingMarkOf(await mountBand($))?.color).toBe(inkFor("auto").alert);

    await answerAndFinish(world, call, 10 * SECOND);
  });

  test("D11 with the side pane never drawn, on light-ansi the waiting mark in the status row is drawn in that theme's alert ink", async ($, on) => {
    const world = worldOf(
      $,
      on,
      { hold: { askMs: 10 * SECOND, answer: "allow", runMs: SECOND } },
      "light-ansi",
    );
    await $.session.start({ cwd: PROJECT, surface: "terminal", isInteractive: true });
    const call = startBash($, "hold");
    await world.clock.advance(5 * SECOND);

    expect(waitingMarkOf(await mountBand($))?.color).toBe(inkFor("light-ansi").alert);

    await answerAndFinish(world, call, 10 * SECOND);
  });
});

function worldOf($: Engine, on: On, plans: Record<string, Plan>, theme = DEFAULT_THEME): World {
  const clock = mock.clock(on, { now: NOW });
  mock.env(on, { HOME });
  const kept = new Map<string, unknown>();
  on("store.get", (_$, e) => ({ value: kept.get(e.key) }));
  on("store.set", (_$, e) => {
    kept.set(e.key, e.value);
    return { value: undefined };
  });
  on("session.id", () => ({ value: "s1" }));
  on("config.list", () => ({ value: [{ key: "theme", value: theme }] }) as never);
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
  on("agent.spawn", () => ({ model: "sonnet", agentId: "agent-1" }));
  on("turn.start", (_$, e) => ({ turnId: e.turnId }));
  on("turn.complete", (_$, e) => ({ text: e.answer }));
  on("classic.SessionStart", () => ({}));
  on("classic.UserPromptSubmit", () => ({}));
  on("classic.PostModelSwitch", () => ({}));
  on("classic.CwdChanged", () => ({}));
  on("classic.Stop", () => ({}));
  on("classic.PostToolUse", () => ({}));
  on("ui.render", { component: "AbovePrompt" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine row</Text>;
  });
  on("ui.render", { component: "ToolProgress" }, (inner, e) => {
    const { Text } = inner.ui.resolve(e);
    return <Text>{e.props.hint}</Text>;
  });
  on("process.run", () => ({ value: { exitCode: 1, stdout: "", stderr: "" } }) as never);
  on("tool.check", (_$, e) => ({
    decision: plans[subjectOf(e.input)]?.askMs === undefined ? "allow" : "ask",
  }));
  on("classic.PermissionRequest", async (_$, e) => {
    const plan = plans[subjectOf(e.tool_input)];
    await clock.sleep(plan?.askMs ?? 0);
    const behavior = plan?.answer ?? "allow";
    return { decision: { behavior } };
  });
  on("tool.call", async (_$, e) => {
    const runMs = plans[subjectOf(e)]?.runMs ?? 0;
    await clock.sleep(runMs);
    await $.classic.PostToolUse({
      hook_event_name: "PostToolUse",
      tool_name: e.tool,
      tool_input: e,
      tool_response: "ok",
      tool_use_id: e.tool_use_id,
      duration_ms: runMs,
    } as never);
    return { result: "ok", text: "ok" };
  });
  return { clock };
}

function subjectOf(input: unknown): string {
  const fields = input as { command?: string; description?: string };
  return fields.command ?? fields.description ?? "";
}

function startBash($: Engine, command: string, agentId?: string): Promise<ToolCallResult> {
  return $.tool.call({
    tool: "Bash",
    command,
    tool_use_id: `bash-${command}`,
    ...(agentId === undefined ? {} : { agentId }),
  } as never);
}

function startAgent($: Engine, description: string): Promise<ToolCallResult> {
  return $.tool.call({
    tool: "Agent",
    description,
    prompt: "look around",
    tool_use_id: `agent-${description}`,
  } as never);
}

async function runBash($: Engine, world: World, command: string, totalMs: number): Promise<void> {
  const call = startBash($, command);
  await world.clock.advance(totalMs);
  await call;
}

async function answerAndFinish(
  world: World,
  call: Promise<ToolCallResult>,
  withinMs: number,
): Promise<void> {
  await world.clock.advance(withinMs);
  await call;
}

async function drawPill($: Engine, command: string): Promise<void> {
  await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "ToolProgress",
    props: { tool_use_id: `bash-${command}`, kind: "background_hint", hint: PILL },
    viewport: { columns: BAND_COLUMNS, rows: 24 },
  });
}

async function spawnAgent($: Engine, description: string): Promise<void> {
  await $.agent.spawn({
    tool_use_id: `agent-${description}`,
    prompt: "look around",
    description,
    subagentType: "general-purpose",
    provider: "anthropic",
    parentModel: "sonnet",
    background: false,
    fork: false,
  } as never);
}

async function liveRowText(pane: Pane): Promise<string> {
  const shown = await lines(pane);
  const timeRow = shown.findIndex((line) => line.text.startsWith(SUMMARY_PREFIX));
  return shown[timeRow - LIVE_ROWS_ABOVE_TIME]?.text ?? "";
}

async function summaryText(pane: Pane): Promise<string> {
  const row = (await lines(pane)).find((line) => line.text.startsWith(SUMMARY_PREFIX));
  return row?.text.trim() ?? "";
}

function colourOf(pieces: Piece[], text: string): unknown {
  return pieces.find((piece) => piece.text.trim() === text)?.color;
}

function waitingMarkOf(tree: unknown): Piece | undefined {
  return colouredPieces(tree).find((piece) => piece.text.includes("waiting"));
}

function dotBefore(pieces: Piece[], text: string): Piece | undefined {
  const at = pieces.findIndex((piece) => piece.text.trim() === text);
  return pieces
    .slice(0, Math.max(at, 0))
    .reverse()
    .find((piece) => piece.text.trim() === "●");
}

async function mountBand($: Engine): Promise<unknown> {
  const band = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "AbovePrompt",
    props: {
      hasSurvey: false,
      isCollapsed: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns: BAND_COLUMNS,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
    viewport: { columns: BAND_COLUMNS, rows: 40 },
  });
  return band.drawn();
}

async function bandRows($: Engine): Promise<string[]> {
  return screenRows(await mountBand($), BAND_COLUMNS);
}
