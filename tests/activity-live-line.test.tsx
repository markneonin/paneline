import { describe, expect, mock, test } from "claude-code/testing";
import type { On, ToolCheckResult } from "claude-code";
import type { Engine, MockClock } from "claude-code/testing";

import { palette } from "../hooks/palette";
import { colouredPieces, screenRows } from "./band-screen";
import { textOf } from "./draw-tree";
import { headingLineOf, lines, paneOnTab, settle } from "./clear-world";
import type { Pane } from "./clear-world";
import { headingOrder, keyOf } from "./skills-tree";
import type { Line } from "./skills-tree";

type World = {
  clock: MockClock;
  arrivals: Map<string, () => void>;
  runMs: Map<string, number>;
  patches: Map<string, { added: number; removed: number }>;
};
type Found = Awaited<ReturnType<Pane["findAll"]>>[number];
type Started = { arrived: Promise<void>; done: Promise<unknown> };

const SECOND = 1_000;
const STARTED_AT = new Date(2026, 10, 4, 11, 10, 42).getTime();
const WORK = "/work";
const FAILING_COMMAND = "fail";
const LONG_RUN_MS = 5 * SECOND;
const SLEEP_COMMAND = "sleep 5";
const TOLD_APART_MS = 30 * SECOND;
const START_CLOCK = "11:10";
const CLOCK_PREFIX = /^\d\d:\d\d\s*/u;
const SIX = 6;
const SEVEN = 7;
const NINE = 9;
const INDENT_CELLS = 2;
const NARROW_COLUMNS = 52;
const SIXTY_COLUMNS = 60;
const WIDE_TURN_MS = 605_000;
const WIDE_TURN_TEXT = "10m 05s";
const TURN_MS = 42 * SECOND;
const TURN_TEXT = "42s";
const TOTAL_TIME = /^(?:\d+ms|\d+s|\d+m \d{2}s)$/u;
const LONG_COMMAND = `echo ${"x".repeat(120)}`;
const DENY_RULE = "Bash(curl:*)";
const ALLOW_RULE = "Bash(ls:*)";
const DENIED_COMMAND = "curl x";
const ALLOWED_COMMAND = "ls y";
const MORE_FOLDED = "▸ 2 more failed";
const MORE_OPEN = "▾ 2 more failed";
const OLD_MORE_LINE = "… +2 more";
const DENIED_GLYPH = "⊘";
const SECTION_ORDER = ["Stuck", "Failed", "Permissions", "Tool mix", "Timeline"];
const NEWEST_FIVE = ["failed-f-6", "failed-f-5", "failed-f-4", "failed-f-3", "failed-f-2"];
const ALL_SEVEN = [...NEWEST_FIVE, "failed-f-1", "failed-f-0"];

describe("activity live line", () => {
  test("L1 a running Bash call shows its tool, target and 0s on the row above the chip line, and there is no Now heading", async ($, on) => {
    const world = worldOf(on);
    const run = startCall($, world, bashCall("slow", SLEEP_COMMAND), LONG_RUN_MS);
    await run.arrived;

    const pane = await paneOnTab($, "Activity");

    const shown = await lines(pane);
    expect(liveLineOf(shown)?.text).toMatch(/^● Bash +sleep 5 +0s$/);
    expect(colourOf(await pane.drawn(), "0s")).toBe(palette.muted);
    expect(headingLineOf(shown, "Now")).toBeUndefined();
    await finish(world, run, LONG_RUN_MS);
  });

  test("L2 the elapsed time on the live line grows by one second at the next tick", async ($, on) => {
    const world = worldOf(on);
    const run = startCall($, world, bashCall("slow", SLEEP_COMMAND), LONG_RUN_MS);
    await run.arrived;
    const pane = await paneOnTab($, "Activity");

    await world.clock.advance(SECOND);
    await settle(pane);
    const afterOne = liveLineOf(await lines(pane))?.text;
    await world.clock.advance(SECOND);
    await settle(pane);
    const afterTwo = liveLineOf(await lines(pane))?.text;

    expect([afterOne, afterTwo]).toEqual([
      expect.stringMatching(/^● Bash +sleep 5 +1s$/),
      expect.stringMatching(/^● Bash +sleep 5 +2s$/),
    ]);
    await finish(world, run, LONG_RUN_MS - 2 * SECOND);
  });

  test("L3 a running turn with no tool running reads thinking on the live line", async ($, on) => {
    const world = worldOf(on);
    await $.turn.start({ text: "go", turnId: "turn-1" });
    await runCall($, world, bashCall("quick", "echo hi"), SECOND);

    const pane = await paneOnTab($, "Activity");

    expect(liveLineOf(await lines(pane))?.text).toBe("● thinking");
  });

  test("L4 with no turn running the live line reads idle in the muted colour", async ($, on) => {
    const world = worldOf(on);
    await runCall($, world, bashCall("quick", "echo hi"), SECOND);

    const pane = await paneOnTab($, "Activity");

    expect(liveLineOf(await lines(pane))?.text.trim()).toBe("idle");
    expect(colourOf(await pane.drawn(), "idle")).toBe(palette.muted);
  });

  test("L6 two passed Read calls read the total time, 2 tools and 2 files, with no errors part", async ($, on) => {
    const world = worldOf(on);
    await runCall($, world, readCall("read-a", "/work/a.ts"), 0);
    await runCall($, world, readCall("read-b", "/work/b.ts"), 0);

    const pane = await paneOnTab($, "Activity");

    expect(chipLineOf(await lines(pane))?.text).toMatch(/^\S+ · 2 tools · 2 files$/);
  });

  test("L9 a finished main turn with no tool calls reads only its total time on the chip line", async ($, on) => {
    worldOf(on);
    await $.turn.start({ text: "go", turnId: "turn-1" });
    await $.turn.complete({
      answer: "",
      durationMs: TURN_MS,
      isAborted: false,
      turnId: "turn-1",
      reason: "answer",
    } as never);

    const pane = await paneOnTab($, "Activity");

    expect(chipPartsOf(await lines(pane))).toEqual([TURN_TEXT]);
  });

  test("L10 one passed Bash call reads the total time and 1 tool on the chip line, with no files or errors part", async ($, on) => {
    const world = worldOf(on);
    await runCall($, world, bashCall("quick", "echo hi"), 0);

    const pane = await paneOnTab($, "Activity");

    expect(chipPartsOf(await lines(pane))).toEqual([expect.stringMatching(TOTAL_TIME), "1 tool"]);
  });

  test("L8 at 52 and 60 cells the live line and the chip line each stay one row, and the elapsed time stays visible", async ($, on) => {
    const world = worldOf(on);
    await runCall($, world, readCall("read-a", "/work/a.ts"), 0);
    world.patches.set("edit-b", { added: 1200, removed: 450 });
    await runCall($, world, editCall("edit-b", "/work/b.ts"), 0);
    await runCall($, world, bashCall("broken", FAILING_COMMAND), 0);
    await $.turn.complete({
      answer: "",
      durationMs: WIDE_TURN_MS,
      isAborted: false,
      turnId: "turn-wide",
      reason: "answer",
    } as never);
    const run = startCall($, world, bashCall("long", LONG_COMMAND), LONG_RUN_MS);
    await run.arrived;

    for (const columns of [NARROW_COLUMNS, SIXTY_COLUMNS]) {
      const pane = await paneOnTab($, "Activity", { columns });
      const rows = screenRows(await pane.drawn(), columns);
      const time = rows.findIndex((row) => row.trimStart().startsWith("model "));
      expect(rows[time - 3]?.trim(), `${columns} cells: blank row above`).toBe("");
      expect(rows[time - 2]?.trim(), `${columns} cells: live line`).toMatch(/^● Bash .*0s$/);
      expect(rows[time - 1]?.trim(), `${columns} cells: chip line`).toMatch(
        new RegExp(`^${WIDE_TURN_TEXT} · 3 tools`),
      );
      await pane.unmount();
    }
    await finish(world, run, LONG_RUN_MS);
  });
});

describe("activity problem blocks", () => {
  test("P1 one denied call then nine auto-allowed calls show the denied row under Permissions", async ($, on) => {
    const world = worldOf(on, verdicts());
    await runCall($, world, bashCall("denied-0", DENIED_COMMAND), 0);
    for (let i = 0; i < NINE; i++)
      await runCall($, world, bashCall(`allowed-${i}`, ALLOWED_COMMAND), 0);

    const pane = await paneOnTab($, "Activity");

    const rows = permissionRowsOf(await lines(pane));
    expect(rows.map(markOf)).toEqual([DENIED_GLYPH]);
  });

  test("P2 three refused calls, two with one target, all stay listed as denied rows under six later auto-allowed calls", async ($, on) => {
    const world = worldOf(on, verdicts());
    await runCall($, world, bashCall("denied-0", DENIED_COMMAND), 0);
    await runCall($, world, bashCall("denied-1", DENIED_COMMAND), 0);
    await runCall($, world, bashCall("denied-2", "curl y"), 0);
    for (let i = 0; i < SIX; i++)
      await runCall($, world, bashCall(`allowed-${i}`, ALLOWED_COMMAND), 0);

    const pane = await paneOnTab($, "Activity");

    const rows = permissionRowsOf(await lines(pane));
    expect(rows.map(markOf)).toEqual([DENIED_GLYPH, DENIED_GLYPH, DENIED_GLYPH]);
  });

  test("P3 the Stuck, Failed and Permissions headings come before the Tool mix heading", async ($, on) => {
    const world = worldOf(on, verdicts());
    await runCall($, world, bashCall("denied-0", DENIED_COMMAND), 0);
    for (let i = 0; i < 3; i++) await runCall($, world, bashCall(`f-${i}`, FAILING_COMMAND), 0);

    const pane = await paneOnTab($, "Activity");

    expect(headingOrder(await lines(pane), SECTION_ORDER)).toEqual(SECTION_ORDER);
  });

  test("P4 seven failed calls show five rows and ▸ 2 more failed as a dim button", async ($, on) => {
    const world = worldOf(on);
    await failCalls($, world, SEVEN);

    const pane = await paneOnTab($, "Activity");

    expect(await failedRowKeys(pane)).toEqual(NEWEST_FIVE);
    const fold = await foldOf(pane);
    expect(fold?.props.label).toBe(MORE_FOLDED);
    expect(fold?.props.dimColor).toBe(true);
    expect((await lines(pane)).some((line) => line.text === OLD_MORE_LINE)).toBe(false);
  });

  test("P5 pressing it lists all seven failed calls and the row reads ▾ 2 more failed, pressing again folds", async ($, on) => {
    const world = worldOf(on);
    await failCalls($, world, SEVEN);
    const pane = await paneOnTab($, "Activity");

    await pressFold(pane);

    expect(await failedRowKeys(pane)).toEqual(ALL_SEVEN);
    expect((await foldOf(pane))?.props.label).toBe(MORE_OPEN);
    const shown = await lines(pane);
    expect(rowOf(shown, "failed-f-1")?.indent).toBe(
      (rowOf(shown, "failed-f-6")?.indent ?? 0) + INDENT_CELLS,
    );

    await pressFold(pane);

    expect(await failedRowKeys(pane)).toEqual(NEWEST_FIVE);
    expect((await foldOf(pane))?.props.label).toBe(MORE_FOLDED);
  });

  test("P6 the opened fold stays open after opening a failed row and going back", async ($, on) => {
    const world = worldOf(on);
    await failCalls($, world, SEVEN);
    const pane = await paneOnTab($, "Activity");
    await pressFold(pane);

    await pane.press({ key: "failed-f-0" });
    await pane.press({ key: "back" });

    expect(await failedRowKeys(pane)).toEqual(ALL_SEVEN);
    expect((await foldOf(pane))?.props.label).toBe(MORE_OPEN);
  });

  test("P7 a failed call's rows under Failed and Timeline start with the clock time it started, not the time it ended", async ($, on) => {
    const world = worldOf(on);
    await runCall($, world, bashCall("f-0", FAILING_COMMAND), TOLD_APART_MS);

    const pane = await paneOnTab($, "Activity");

    const shown = await lines(pane);
    for (const key of ["failed-f-0", "call-f-0"]) {
      const row = rowOf(shown, key);
      expect(row?.parts.map(textOf)[0], key).toBe(START_CLOCK);
      expect(row?.parts[0]?.props?.color, key).toBe(palette.muted);
    }
  });
});

function worldOf(on: On, verdictOf?: (input: unknown) => ToolCheckResult): World {
  const clock = mock.clock(on, { now: STARTED_AT });
  mock.env(on, { HOME: "/h/u" });
  const world: World = { clock, arrivals: new Map(), runMs: new Map(), patches: new Map() };
  const kept = new Map<string, unknown>();
  on("store.get", (_$, e) => ({ value: kept.get(e.key) }));
  on("store.set", (_$, e) => {
    kept.set(e.key, JSON.parse(JSON.stringify(e.value)));
    return { value: undefined };
  });
  on("session.id", () => ({ value: "session-one" }));
  on("session.repo", () => ({ value: null }));
  on("session.root", () => ({ value: WORK }));
  on("session.cwd", () => ({ value: WORK }));
  on("session.model", () => ({ value: "opus" }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("settings.read", () => ({ value: {} }));
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", () => ({ value: true }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("classic.SessionStart", () => ({}));
  on("turn.start", (_$, e) => ({ turnId: e.turnId }));
  on("turn.complete", (_$, e) => ({ text: e.answer }));
  on("process.run", () => ({ value: { exitCode: 0, stdout: "", stderr: "" } }) as never);
  if (verdictOf !== undefined) on("tool.check", (_$, e) => verdictOf(e.input));
  on("tool.call", async (_$, e) => {
    const call = e as unknown as { tool: string; command?: string; tool_use_id: string };
    world.arrivals.get(call.tool_use_id)?.();
    const ms = world.runMs.get(call.tool_use_id) ?? 0;
    if (ms > 0) await clock.sleep(ms);
    if (call.command?.startsWith(FAILING_COMMAND))
      return { isError: true, result: "boom", text: "boom" } as never;
    const patch = world.patches.get(call.tool_use_id);
    if (patch === undefined) return { result: "ok", text: "ok" };
    const patchLines = [
      ...Array.from({ length: patch.added }, () => "+x"),
      ...Array.from({ length: patch.removed }, () => "-x"),
    ];
    return { result: { structuredPatch: [{ lines: patchLines }] }, text: "edited" };
  });
  return world;
}

function verdicts(): (input: unknown) => ToolCheckResult {
  return (input) => {
    const { command } = input as { command?: string };
    if (command?.startsWith("curl")) return { decision: "deny", rule: DENY_RULE };
    return command === ALLOWED_COMMAND
      ? { decision: "allow", rule: ALLOW_RULE }
      : { decision: "allow" };
  };
}

function bashCall(id: string, command: string): object {
  return { tool: "Bash", command, tool_use_id: id };
}

function readCall(id: string, path: string): object {
  return { tool: "Read", file_path: path, tool_use_id: id };
}

function editCall(id: string, path: string): object {
  return { tool: "Edit", file_path: path, tool_use_id: id };
}

function startCall($: Engine, world: World, call: object, runMs: number): Started {
  const id = (call as { tool_use_id: string }).tool_use_id;
  let arrive: () => void = () => undefined;
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  world.arrivals.set(id, arrive);
  world.runMs.set(id, runMs);
  const done = ($.tool.call as (e: object) => Promise<unknown>)(call);
  return { arrived, done };
}

async function runCall($: Engine, world: World, call: object, runMs: number): Promise<void> {
  if (runMs === 0) {
    await ($.tool.call as (e: object) => Promise<unknown>)(call);
    return;
  }
  const run = startCall($, world, call, runMs);
  await run.arrived;
  await finish(world, run, runMs);
}

async function finish(world: World, run: Started, remainingMs: number): Promise<void> {
  await world.clock.advance(remainingMs);
  await run.done;
}

async function failCalls($: Engine, world: World, count: number): Promise<void> {
  for (let i = 0; i < count; i++)
    await runCall($, world, bashCall(`f-${i}`, `${FAILING_COMMAND} ${i}`), 0);
}

function timeRowIndex(shown: Line[]): number {
  return shown.findIndex((line) => line.text.startsWith("model "));
}

function liveLineOf(shown: Line[]): Line | undefined {
  return shown[timeRowIndex(shown) - 2];
}

function chipLineOf(shown: Line[]): Line | undefined {
  return shown[timeRowIndex(shown) - 1];
}

function chipPartsOf(shown: Line[]): string[] | undefined {
  return chipLineOf(shown)?.text.split(" · ");
}

function rowOf(shown: Line[], key: string): Line | undefined {
  return shown.find((line) => line.parts.some((part) => keyOf(part) === key));
}

function permissionRowsOf(shown: Line[]): Line[] {
  return shown.filter((line) => line.parts.some((part) => keyOf(part).startsWith("permission-")));
}

function markOf(row: Line): string {
  return row.text.replace(CLOCK_PREFIX, "").slice(0, 1);
}

function colourOf(drawn: unknown, text: string): unknown {
  return colouredPieces(drawn).find((piece) => piece.text.trim() === text)?.color;
}

async function failedRowKeys(pane: Pane): Promise<string[]> {
  return (await pane.findAll({ type: "Button" }))
    .map((button) => String(button.key))
    .filter((key) => key.startsWith("failed-"));
}

async function foldOf(pane: Pane): Promise<Found | undefined> {
  return (await pane.findAll({ type: "Button" })).find((button) =>
    /^[▸▾] \d+ more failed$/u.test(String(button.props.label)),
  );
}

async function pressFold(pane: Pane): Promise<void> {
  const fold = await foldOf(pane);
  expect(fold, "a more failed button").toBeDefined();
  await pane.press({ key: String(fold?.key) });
}
