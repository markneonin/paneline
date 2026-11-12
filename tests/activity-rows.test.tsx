import { describe, expect, mock, test } from "claude-code/testing";
import type { On, Shaped } from "claude-code";
import type { Engine, MockClock } from "claude-code/testing";

import { palette } from "../hooks/palette";
import type { CallRecord } from "../types";
import { colouredPieces, screenRows } from "./band-screen";
import { textOf } from "./draw-tree";
import { lines, paneOnTab } from "./clear-world";
import { keyOf } from "./skills-tree";
import type { Line } from "./skills-tree";

type World = { clock: MockClock; runMs: Map<string, number> };

const SECOND = 1_000;
const STARTED_AT = new Date(2026, 10, 4, 11, 10, 42).getTime();
const START_CLOCK = "11:10";
const CLOCK_CELLS = 5;
const WORK = "/work";
const FAILING_COMMAND = "fail";
const FAILING_REASON = "boom";
const FAILING_RUN_MS = 30 * SECOND;
const FAILING_DURATION = "30s";
const SHORT_COMMAND = "cat nofile";
const LONG_REASON = "No such file or directory: nofile";
const REFUSED_PREFIX = "mkdir /tmp/act3-d";
const REFUSED_NUMBERS = ["1", "2", "3"];
const REFUSAL = "denied by you";
const LS_COMMAND = "ls /nonexistent-dir";
const LS_FAILURE =
  "Exit code 1\nls: /nonexistent-dir: No such file or directory, and then a much longer explanation of why";
const EXIT_CODE_REASON = " · Exit code 1";
const LONG_ROW_COLUMNS = 59;
const TIMELINE_TITLE = "Timeline";
const WHOLE_REASON_COLUMNS = 69;
const NARROW_COLUMNS = 52;
const CUT_TARGET_COLUMNS = 54;
const WIDE_COLUMNS = 100;
const ONE_TWENTY_COLUMNS = 120;
const TWELVE = 12;
const THREE = 3;
const BAR_TOLERANCE = 1;
const ANY_BAR_CELLS = /^[▰█]+$/u;
const NEW_BAR_CELLS = /^▰+$/u;
const OLD_BAR_CELL = "█";
const NEW_BAR_CELL = "▰";
const UNTIMED_FILE = "old.ts";
const TIMED_FILE = "new.ts";

describe("activity call rows", () => {
  test("R1 a call started at 11:10:42 shows 11:10 first on its Timeline row in the muted colour", async ($, on) => {
    const world = worldOf(on);
    await runCall($, world, bashCall("b-0", "ls"), 0);

    const pane = await paneOnTab($, "Activity");

    const row = rowOf(await lines(pane), "call-b-0");
    expect(row?.parts.map(textOf)[0]).toBe(START_CLOCK);
    expect(row?.parts[0]?.props?.color).toBe(palette.muted);
  });

  test("R2 a call with no start time keeps its ✓ in the same column as a timed row's, to the right of the clock", async ($, on) => {
    const world = worldOf(on);
    seedCalls(on, [untimedRead()]);
    await runCall($, world, readCall("r-0", `${WORK}/${TIMED_FILE}`), 0);

    const pane = await paneOnTab($, "Activity", { columns: WIDE_COLUMNS });

    const rows = screenRows(await pane.drawn(), WIDE_COLUMNS);
    const untimed = rows.find((row) => row.includes(UNTIMED_FILE));
    const timed = rows.find((row) => row.includes(TIMED_FILE));
    expect(timed?.indexOf("✓")).toBeGreaterThanOrEqual(CLOCK_CELLS);
    expect(untimed?.indexOf("✓")).toBe(timed?.indexOf("✓"));
  });

  test("R3 a failed Bash row draws Bash in the tool colour and its ✗ in the failed colour", async ($, on) => {
    const world = worldOf(on);
    await runCall($, world, bashCall("f-0", FAILING_COMMAND), 0);

    const pane = await paneOnTab($, "Activity");

    const shown = await lines(pane);
    for (const key of ["failed-f-0", "call-f-0"]) {
      const pieces = colouredPieces(rowOf(shown, key)?.parts);
      expect(pieceColour(pieces, "Bash"), key).toBe(palette.tool);
      expect(pieceColour(pieces, "✗"), key).toBe(palette.failed);
    }
  });

  test("R4 at 52 cells a failed row with clock, ✗, tool, reason and duration stays one row", async ($, on) => {
    const world = worldOf(on);
    await runCall($, world, bashCall("f-0", FAILING_COMMAND), FAILING_RUN_MS);

    const pane = await paneOnTab($, "Activity", { columns: NARROW_COLUMNS });

    const failedRow = screenRows(await pane.drawn(), NARROW_COLUMNS).find((row) =>
      row.includes(FAILING_REASON),
    );
    for (const piece of [START_CLOCK, "✗", "Bash", FAILING_REASON, FAILING_DURATION])
      expect(failedRow, piece).toContain(piece);
  });

  test("R10 at 52 cells three refused Bash calls whose targets differ only at the end show three different full targets in the Timeline", async ($, on) => {
    const world = worldOf(on);
    for (const number of REFUSED_NUMBERS)
      await runCall($, world, bashCall(`d-${number}`, `${REFUSED_PREFIX}${number}`), 0);

    const pane = await paneOnTab($, "Activity", { columns: NARROW_COLUMNS });

    const timeline = timelineRowsOf(screenRows(await pane.drawn(), NARROW_COLUMNS));
    for (const number of REFUSED_NUMBERS)
      expect(
        timeline.filter((row) => row.includes(`${REFUSED_PREFIX}${number}`)),
        number,
      ).toHaveLength(1);
  });

  test("R11 a failed Bash call with a short target and a reason that does not fit shows the full target and no reason, and where it fits shows it whole", async ($, on) => {
    const world = worldOf(on);
    await runCall($, world, bashCall("f-0", SHORT_COMMAND), 0);

    const narrow = await paneOnTab($, "Activity", { columns: NARROW_COLUMNS });
    const narrowRow = timelineRowsOf(screenRows(await narrow.drawn(), NARROW_COLUMNS)).find((row) =>
      row.includes(SHORT_COMMAND),
    );
    await narrow.unmount();
    const wide = await paneOnTab($, "Activity", { columns: WHOLE_REASON_COLUMNS });
    const wideRow = timelineRowsOf(screenRows(await wide.drawn(), WHOLE_REASON_COLUMNS)).find(
      (row) => row.includes(SHORT_COMMAND),
    );

    expect(narrowRow).toContain(SHORT_COMMAND);
    expect(narrowRow).not.toContain(" · ");
    expect(wideRow).toContain(`${SHORT_COMMAND} · ${LONG_REASON}`);
  });

  test("R12 at 52 cells a refused Bash call shows its full target and no half-cut reason, and at 120 cells shows the reason whole", async ($, on) => {
    const world = worldOf(on);
    await runCall($, world, bashCall("d-3", `${REFUSED_PREFIX}3`), 0);
    const target = `${REFUSED_PREFIX}3`;

    const narrow = await paneOnTab($, "Activity", { columns: NARROW_COLUMNS });
    const narrowRow = timelineRowsOf(screenRows(await narrow.drawn(), NARROW_COLUMNS)).find((row) =>
      row.includes(target),
    );
    await narrow.unmount();
    const wide = await paneOnTab($, "Activity", { columns: ONE_TWENTY_COLUMNS });
    const wideRow = timelineRowsOf(screenRows(await wide.drawn(), ONE_TWENTY_COLUMNS)).find((row) =>
      row.includes(target),
    );

    const afterTarget = narrowRow?.slice(narrowRow.indexOf(target) + target.length);
    expect(narrowRow).toContain(target);
    expect(afterTarget).not.toContain(" · ");
    expect(afterTarget).not.toContain("…");
    expect(wideRow).toContain(`${target} · ${REFUSAL}`);
  });

  test("R13 with a TodoWrite call in the Timeline, a failed ls row at the narrowest width that fits shows its full target and Exit code 1", async ($, on) => {
    const world = worldOf(on);
    await runCall($, world, { tool: "TodoWrite", todos: [], tool_use_id: "t-0" }, 0);
    await runCall($, world, bashCall("l-0", LS_COMMAND), 0);

    const pane = await paneOnTab($, "Activity", { columns: LONG_ROW_COLUMNS });

    const row = timelineRowsOf(screenRows(await pane.drawn(), LONG_ROW_COLUMNS)).find((shown) =>
      shown.includes("Bash"),
    );
    expect(row).toContain(`${LS_COMMAND}${EXIT_CODE_REASON}`);
  });

  test("R14 at 54 columns a failed ls row whose error line does not fit shows its full target, no cut and no reason after it", async ($, on) => {
    const world = worldOf(on);
    await runCall($, world, bashCall("l-1", LS_COMMAND), 860);

    const pane = await paneOnTab($, "Activity", { columns: CUT_TARGET_COLUMNS });

    const row = timelineRowsOf(screenRows(await pane.drawn(), CUT_TARGET_COLUMNS)).find((shown) =>
      shown.includes("Bash"),
    );
    const afterTarget = row?.slice(row.indexOf(LS_COMMAND) + LS_COMMAND.length);
    expect(row).toContain(LS_COMMAND);
    expect(afterTarget).not.toContain("…");
    expect(afterTarget).not.toContain(" · ");
  });

  test("R5 twelve Bash calls show the Tool mix legend and no bar row", async ($, on) => {
    const world = worldOf(on);
    for (let i = 0; i < TWELVE; i++) await runCall($, world, bashCall(`b-${i}`, "ls"), 0);

    const pane = await paneOnTab($, "Activity", { columns: WIDE_COLUMNS });

    const rows = screenRows(await pane.drawn(), WIDE_COLUMNS).map((row) => row.trim());
    expect(rows).toContain("● Bash 12");
    expect(rows.filter((row) => ANY_BAR_CELLS.test(row))).toEqual([]);
  });

  test("R6 two Read calls and one Bash call show one ▰-only bar row, Read twice as wide as Bash, and no █ on the tab", async ($, on) => {
    const world = worldOf(on);
    await runCall($, world, readCall("r-0", `${WORK}/a.ts`), 0);
    await runCall($, world, readCall("r-1", `${WORK}/b.ts`), 0);
    await runCall($, world, bashCall("b-0", "ls"), 0);

    const pane = await paneOnTab($, "Activity", { columns: WIDE_COLUMNS });

    const rows = screenRows(await pane.drawn(), WIDE_COLUMNS);
    const barRows = rows.filter((row) => NEW_BAR_CELLS.test(row.trim()));
    expect(barRows).toHaveLength(1);
    expect(rows.join("")).not.toContain(OLD_BAR_CELL);
    const [read, bash] = colouredPieces(await pane.drawn())
      .filter((piece) => piece.text.includes(NEW_BAR_CELL))
      .map((piece) => piece.text.length);
    expect(Math.abs((read ?? 0) - 2 * (bash ?? 0))).toBeLessThanOrEqual(BAR_TOLERANCE);
  });

  test("R7 three failing runs of one command show ✗ in the failed colour on the Stuck row", async ($, on) => {
    const world = worldOf(on);
    for (let i = 0; i < THREE; i++) await runCall($, world, bashCall(`f-${i}`, FAILING_COMMAND), 0);

    const pane = await paneOnTab($, "Activity");

    const pieces = colouredPieces(rowOf(await lines(pane), "stuck-f-2")?.parts);
    expect(pieceColour(pieces, "✗")).toBe(palette.failed);
  });

  test("R8 three reads of one file keep the alert ● on the Stuck row", async ($, on) => {
    const world = worldOf(on);
    for (let i = 0; i < THREE; i++) await runCall($, world, readCall(`r-${i}`, `${WORK}/a.ts`), 0);

    const pane = await paneOnTab($, "Activity");

    const pieces = colouredPieces(rowOf(await lines(pane), "stuck-r-2")?.parts);
    expect(pieces.map((piece) => piece.text.trim()).filter((text) => text !== "")).toContain(
      START_CLOCK,
    );
    expect(pieceColour(pieces, "●")).toBe(palette.alert);
  });
});

function worldOf(on: On): World {
  const clock = mock.clock(on, { now: STARTED_AT });
  mock.env(on, { HOME: "/h/u" });
  const world: World = { clock, runMs: new Map() };
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
  on("tool.call", async (_$, e) => {
    const call = e as unknown as { command?: string; tool_use_id: string };
    const ms = world.runMs.get(call.tool_use_id) ?? 0;
    if (ms > 0) await clock.sleep(ms);
    if (call.command === FAILING_COMMAND)
      return { isError: true, result: FAILING_REASON, text: FAILING_REASON } as never;
    if (call.command === LS_COMMAND)
      return { isError: true, result: LS_FAILURE, text: LS_FAILURE } as never;
    if (call.command === SHORT_COMMAND)
      return { isError: true, result: LONG_REASON, text: LONG_REASON } as never;
    if (call.command?.startsWith(REFUSED_PREFIX) === true) return { deny: REFUSAL };
    return { result: "ok", text: "ok" };
  });
  return world;
}

function seedCalls(on: On, rows: CallRecord[]): void {
  on("state.get", async (_$, e, next) => {
    if (e.key !== "calls") return next(e);
    const { value: stored } = await next(e);
    const kept: Shaped<CallRecord[]> = { shape: "calls-slim", value: rows };
    return { value: { value: stored?.value ?? kept, version: stored?.version ?? 0 } };
  });
}

function untimedRead(): CallRecord {
  return {
    id: "old-0",
    tool: "Read",
    target: `${WORK}/${UNTIMED_FILE}`,
    ms: 1,
    isErrored: false,
    added: 0,
    removed: 0,
  };
}

function bashCall(id: string, command: string): object {
  return { tool: "Bash", command, tool_use_id: id };
}

function readCall(id: string, path: string): object {
  return { tool: "Read", file_path: path, tool_use_id: id };
}

async function runCall($: Engine, world: World, call: object, runMs: number): Promise<void> {
  world.runMs.set((call as { tool_use_id: string }).tool_use_id, runMs);
  const done = ($.tool.call as (e: object) => Promise<unknown>)(call);
  if (runMs > 0) await world.clock.advance(runMs);
  await done;
}

function timelineRowsOf(rows: string[]): string[] {
  const start = rows.findIndex((row) => row.trimStart().startsWith(TIMELINE_TITLE));
  return start < 0 ? [] : rows.slice(start);
}

function rowOf(shown: Line[], key: string): Line | undefined {
  return shown.find((line) => line.parts.some((part) => keyOf(part) === key));
}

function pieceColour(pieces: { text: string; color: unknown }[], text: string): unknown {
  return pieces.find((piece) => piece.text.trim() === text)?.color;
}
