import { describe, expect, mock, test } from "claude-code/testing";
import type { On, Shaped } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { palette } from "../hooks/palette";
import { inkFor } from "../hooks/pane-ink";
import type { CallRecord } from "../types";
import { screenRows } from "./band-screen";
import { feedSession } from "./session-feed";

type Pane = Mounted<"terminal", "Pane">;
type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] };
type Line = { text: string; outerTexts: Node[]; hasButton: boolean; labels: string };
type CallSpec = { tool: string } & Record<string, unknown>;

const NARROW_COLUMNS = 30;
const WIDE_COLUMNS = 100;
const SIXTY_COLUMNS = 60;
const EXIT_CODE_FITS_COLUMNS = 65;
const LONG_FILE_NAME = "does-not-exist-here.txt";
const LONG_REASON = "r".repeat(200);
const NOT_FOUND = "String to replace not found in file.";
const DENIED = "Blocked: path is outside the project";
const LONG_COMMAND = `echo ${"x".repeat(200)}`;
const BASH_OUTPUT = "first output line\nsecond output line";
const KEPT = 400;
const TIMELINE = 15;
const ONE_OLDER = "1 older";
const TWO_OLDER = "2 older";
const OLDER_ROW = /^\d+ older$/;
const FILTER_TEXT = "hit";
const FILTER_MATCHES = 17;
const FILTER_MISSES = 3;
const THREE_S = 3_000;
const NINE_S = 9_000;
const TEN_S = 10_000;
const TWELVE_S = 12_000;
const TOTAL_MS = 72_000;
const FAILED_MARKS = 5;
const FAILING_COMMAND = "fail-exit";
const LS_COMMAND = "echo hi; ls ./nonexistent-x";
const LS_FAILURE = "Exit code 1\nhi\nls: ./nonexistent-x: No such file or directory";
const BASH_FAILURES = [
  {
    id: "S1",
    title: "a failed Bash row shows its error line, not the exit code",
    error: "Exit code 1\nrm: /x: No such file or directory",
    reason: "rm: /x: No such file or directory",
    hidden: ["Exit code 1"],
  },
  {
    id: "S2",
    title: "a failed Bash row with only an exit code shows that exit code",
    error: "Exit code 1",
    reason: "Exit code 1",
    hidden: [],
  },
  {
    id: "S3",
    title: "a failed Bash row skips blank lines and shows the error line after them",
    error: "Exit code 2\n\n  \nfoo: bad",
    reason: "foo: bad",
    hidden: ["Exit code 2"],
  },
  {
    id: "S6",
    title: "a failed Bash row shows the error line after stdout, not the stdout line",
    error: "Exit code 3\nout-line\nls: /nonexistent: No such file or directory",
    reason: "ls: /nonexistent: No such file or directory",
    hidden: ["Exit code 3", "out-line"],
  },
];

const LEGEND_LABELS = ["Read 1", "Edit 1", "Bash 10", "Web 1", "Agent 1", "Other 1"];
const WIDE_LEGEND = " ● Read 1  ● Edit 1  ● Bash 10  ● Web 1  ● Agent 1  ● Other 1";
const BASH_RUNS = 10;

describe("Activity rows", () => {
  for (const columns of [NARROW_COLUMNS, WIDE_COLUMNS]) {
    test(`A1 at ${columns} columns every row is one row, even a 200-character command and a failed call`, async ($, on) => {
      worldOf(on);
      await runMixedCalls($);

      const pane = await mountPane($, columns);

      const lines = await bodyLines(pane);
      const unwrapped = lines
        .flatMap((line) => line.outerTexts)
        .filter((text) => !String(text.props?.wrap).startsWith("truncate"));
      expect(lines.some((line) => line.text.includes("Bash"))).toBe(true);
      expect(unwrapped.map(textOf)).toEqual([]);
      expect(lines.filter((line) => line.text.includes("\n"))).toEqual([]);
    });
  }

  test("A2 the timeline and the tool-mix legend show Grep, Edit and Agent calls", async ($, on) => {
    worldOf(on);
    await runMixedCalls($);

    const pane = await mountPane($, WIDE_COLUMNS);

    const lines = await bodyLines(pane);
    for (const tool of ["Grep", "Edit", "Agent"])
      expect(lines.some((line) => line.hasButton && line.text.includes(tool))).toBe(true);
    for (const group of ["Search 1", "Edit 1", "Agent 1"])
      expect(lines.some((line) => line.text.includes(group))).toBe(true);
    const bar = (await pane.findAll({ type: "Text" })).filter((text) =>
      textOf(text as unknown as Node).includes("▰"),
    );
    expect(bar.length).toBeGreaterThanOrEqual(4);
  });

  test("A3 no pane text is drawn in the default color", async ($, on) => {
    worldOf(on);
    await runMixedCalls($);

    const pane = await mountPane($, WIDE_COLUMNS);

    const plain = (await pane.findAll({ type: "Text" })).filter(
      (text) => text.props.color === undefined && ownText(text as unknown as Node) !== "",
    );
    expect(plain.map((text) => ownText(text as unknown as Node))).toEqual([]);
  });

  test("A4 a failed call is listed under Failed in the failed color", async ($, on) => {
    worldOf(on);
    await runMixedCalls($);

    const pane = await mountPane($, WIDE_COLUMNS);
    await openAllowed(pane);

    const lines = await bodyLines(pane);
    expect(lines.some((line) => line.text.startsWith("Failed"))).toBe(true);
    const marks = await pane.findAll({ type: "Text", text: "✗" });
    expect(marks.length).toBe(FAILED_MARKS);
    expect(marks.every((mark) => mark.props.color === palette.failed)).toBe(true);
  });
});

describe("Activity failure reasons", () => {
  test("A8 a failed Edit row shows the reason after its file, tags removed", async ($, on) => {
    worldOf(on);
    await runFailedEdit($);

    const pane = await mountPane($, WIDE_COLUMNS);

    const lines = await bodyLines(pane);
    const row = lines.find((line) => line.text.includes("Edit") && line.labels.includes("file.ts"));
    expect(row?.text).toContain(NOT_FOUND);
    for (const line of lines)
      for (const bad of ["tool_use_error", "<", "String: missing"])
        expect(line.text).not.toContain(bad);
    const reasons = await pane.findAll({ type: "Text", text: `· ${NOT_FOUND}` });
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.every((reason) => reason.props.color === palette.muted)).toBe(true);
    const buttons = await pane.findAll({ type: "Button" });
    expect(buttons.some((button) => String(button.props.label).includes(NOT_FOUND))).toBe(false);
  });

  test("A9 a denied call shows the deny reason on its row", async ($, on) => {
    worldOf(on);
    await $.tool.call({
      tool: "Write",
      file_path: "/work/blocked.ts",
      content: "x",
      tool_use_id: "deny-1",
    } as never);

    const pane = await mountPane($, WIDE_COLUMNS);

    const row = (await bodyLines(pane)).find((line) => line.labels.includes("blocked.ts"));
    expect(row?.text).toContain(DENIED);
    expect(row?.text).toContain("⊘");
  });

  test("A10 at 60 columns a failed row with a long reason stays one line, keeps the file name and shows no cut reason", async ($, on) => {
    worldOf(on);
    editFailure = LONG_REASON;
    await runFailedEdit($);

    const pane = await mountPane($, SIXTY_COLUMNS);

    const rows = (await bodyLines(pane)).filter((line) => line.labels.includes("file.ts"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.text).not.toContain("\n");
      expect(row.outerTexts.every((text) => String(text.props?.wrap).startsWith("truncate"))).toBe(
        true,
      );
    }
    expect(rows.some((row) => row.text.includes("rrrr"))).toBe(false);
  });

  test("A12 at 60 columns a failed row keeps a long file name whole beside its reason", async ($, on) => {
    worldOf(on);
    await $.tool.call({
      tool: "Edit",
      file_path: `/work/src/deep/${LONG_FILE_NAME}`,
      old_string: "missing",
      tool_use_id: "long-name-edit",
    } as never);

    const pane = await mountPane($, SIXTY_COLUMNS);

    const rows = (await bodyLines(pane)).filter((line) => line.labels.includes(LONG_FILE_NAME));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.labels.endsWith(LONG_FILE_NAME))).toBe(true);
    expect(rows.every((row) => !row.text.includes(" · ") || row.text.includes(NOT_FOUND))).toBe(
      true,
    );
  });

  test("A11 successful rows look as before", async ($, on) => {
    worldOf(on);
    await runMixedCalls($);
    await $.tool.call({
      tool: "Edit",
      file_path: "/work/ok.ts",
      old_string: "a",
      tool_use_id: "ok-edit",
    } as never);

    const pane = await mountPane($, WIDE_COLUMNS);

    const lines = await bodyLines(pane);
    for (const tool of ["Grep", "Agent", "Edit"]) {
      const row = lines.find((line) => line.hasButton && line.text.includes(tool));
      expect(row?.text).not.toContain(" · ");
    }
    const edit = activityKept.find((entry) => entry.id === "ok-edit");
    expect(edit).toBeDefined();
    expect(edit && "reason" in edit).toBe(false);
  });

  for (const failure of BASH_FAILURES)
    test(`${failure.id} ${failure.title}`, async ($, on) => {
      worldOf(on);
      bashError = failure.error;
      await $.tool.call({
        tool: "Bash",
        command: FAILING_COMMAND,
        tool_use_id: "bash-fail",
      } as never);

      const pane = await mountPane($, WIDE_COLUMNS);

      expect(activityKept.find((entry) => entry.id === "bash-fail")?.reason).toBe(failure.reason);
      const shown = (await bodyLines(pane))
        .filter((line) => line.labels.includes(FAILING_COMMAND))
        .map((line) => line.text)
        .join("\n");
      expect(shown).toContain(failure.reason);
      expect(failure.hidden.filter((text) => shown.includes(text))).toEqual([]);
    });

  test("S7 at 65 columns a failed Bash row whose error line does not fit shows its full command and the exit code", async ($, on) => {
    worldOf(on);
    bashError = LS_FAILURE;
    await $.tool.call({
      tool: "Bash",
      command: LS_COMMAND,
      tool_use_id: "bash-ls-fail",
    } as never);

    const pane = await mountPane($, EXIT_CODE_FITS_COLUMNS);

    const rows = (await bodyLines(pane)).filter((line) => line.text.includes("✗Bash"));
    expect(rows.length).toBeGreaterThan(0);
    const shown = rows.map((line) => line.text).join("\n");
    expect(shown).toContain(`${LS_COMMAND} · Exit code 1`);
    expect(shown).not.toContain("No such file");
  });
});

describe("call details", () => {
  test("A5 pressing a Bash row shows its command and output, back returns to the list", async ($, on) => {
    worldOf(on);
    await $.tool.call({ tool: "Bash", command: "ls -la", tool_use_id: "bash-1" } as never);
    const pane = await mountPane($, WIDE_COLUMNS);

    await pane.press({ key: "call-bash-1" });
    const details = (await bodyLines(pane)).map((line) => line.text);

    expect(details.some((text) => text.includes("ls -la"))).toBe(true);
    expect(details).toContain("first output line");
    expect(details).toContain("second output line");
    expect(details.some((text) => text.startsWith("Timeline"))).toBe(false);

    await pane.press({ key: "back" });
    const list = (await bodyLines(pane)).map((line) => line.text);
    expect(list.some((text) => text.startsWith("Timeline"))).toBe(true);
  });

  test("A6 four hundred one calls keep only the newest four hundred and the timeline shows fifteen", async ($, on) => {
    worldOf(on);
    seedCalls(on, readRows(KEPT));
    await $.tool.call({
      tool: "Read",
      file_path: `/work/file${KEPT}.ts`,
      tool_use_id: `read-${KEPT}`,
    } as never);
    const pane = await mountPane($, WIDE_COLUMNS);

    const rows = (await pane.findAll({ type: "Button" })).filter((button) =>
      String(button.key).startsWith("call-"),
    );

    expect(rows.length).toBe(TIMELINE);
    expect(rows[0]?.key).toBe(`call-read-${KEPT}`);
    expect(callsKept).toBe(KEPT);
  });

  test("O1 with sixteen calls kept, the Timeline ends with a muted `1 older` row right under its fifteenth call", async ($, on) => {
    worldOf(on);
    seedCalls(on, readRows(TIMELINE + 1));
    const pane = await mountPane($, WIDE_COLUMNS);

    const older = await pane.findAll({ type: "Text", text: ONE_OLDER });
    expect(older.map((node) => node.props.color)).toEqual([palette.muted]);
    const texts = (await bodyLines(pane)).map((line) => line.text);
    expect(texts[texts.indexOf(ONE_OLDER) - 1]).toContain("file1.ts");
  });

  test("O2 with exactly fifteen calls kept, the Timeline shows fifteen call rows and no `N older` row", async ($, on) => {
    worldOf(on);
    seedCalls(on, readRows(TIMELINE));
    const pane = await mountPane($, WIDE_COLUMNS);

    const texts = (await bodyLines(pane)).map((line) => line.text);
    expect(texts.filter((text) => OLDER_ROW.test(text))).toEqual([]);
    expect(await callKeys(pane)).toHaveLength(TIMELINE);
  });

  test("O3 with twenty calls kept and a filter matching seventeen, the Timeline ends with a muted `2 older` row", async ($, on) => {
    worldOf(on);
    seedCalls(on, filterRows());
    const pane = await mountPane($, WIDE_COLUMNS);

    await pane.input({ key: "filter", text: FILTER_TEXT, kind: "change" });

    const older = await pane.findAll({ type: "Text", text: TWO_OLDER });
    expect(older.map((node) => node.props.color)).toEqual([palette.muted]);
    expect(await callKeys(pane)).toHaveLength(TIMELINE);
  });

  test("A7 with a call's details open, /paneline shows the call list again", async ($, on) => {
    worldOf(on);
    await $.tool.call({ tool: "Bash", command: "ls -la", tool_use_id: "bash-1" } as never);
    const pane = await mountPane($, WIDE_COLUMNS);
    await pane.press({ key: "call-bash-1" });

    await $.command.run({
      command: "paneline",
      args: "",
      origin: { kind: "composer" },
      presentation: { isFullscreen: false, columns: WIDE_COLUMNS },
    });

    const list = (await bodyLines(pane)).map((line) => line.text);
    expect(list.some((text) => text.startsWith("Timeline"))).toBe(true);
    expect(list).not.toContain("first output line");
  });
});

describe("Activity slow calls", () => {
  for (const theme of ["dark", "light-ansi"]) {
    test(`A13 under ${theme} a 12 s call's duration in the Timeline is bold and a 3 s call's is plain`, async ($, on) => {
      await startInTheme($, on, theme);
      await runTimed($, "build", TWELVE_S, "slow-12");
      await runTimed($, "lint", THREE_S, "slow-3");

      const pane = await mountPane($, WIDE_COLUMNS);

      const slow = await pane.findAll({ type: "Text", text: "12s" });
      const quick = await pane.findAll({ type: "Text", text: "3s" });
      expect(slow.map((node) => node.props.weight)).toEqual(["semibold"]);
      expect(slow.map((node) => node.props.color)).toEqual([inkFor(theme).muted]);
      expect(quick.map((node) => node.props.weight)).toEqual([undefined]);
    });
  }

  test("A14 the total time chip is bold in the text colour and the tool count chip is plain", async ($, on) => {
    worldOf(on, "dark");
    on("turn.complete", (_$, e) => ({ text: e.answer }));
    await runTimed($, "build", THREE_S, "chip-1");
    await $.turn.complete({
      answer: "",
      durationMs: TOTAL_MS,
      isAborted: false,
      turnId: "turn-1",
      reason: "answer",
    } as never);

    const pane = await mountPane($, WIDE_COLUMNS);

    const total = await chipLeaf(pane, "1m 12s");
    const tools = await chipLeaf(pane, "1 tool");
    expect(total?.props?.weight).toBe("semibold");
    expect(total?.props?.color).toBe(inkFor("dark").text);
    expect(tools?.props?.weight).toBeUndefined();
  });

  test("A15 a call of exactly 10 s is bold in the Timeline and a call of 9 s is plain", async ($, on) => {
    worldOf(on, "dark");
    await runTimed($, "build", TEN_S, "edge-10");
    await runTimed($, "lint", NINE_S, "edge-9");

    const pane = await mountPane($, WIDE_COLUMNS);

    const [ten] = await pane.findAll({ type: "Text", text: "10s" });
    const [nine] = await pane.findAll({ type: "Text", text: "9s" });
    expect(ten?.props.weight).toBe("semibold");
    expect(nine?.props.weight).toBeUndefined();
  });

  test("A16 a failed call that took 12 s is listed under Failed with its duration bold", async ($, on) => {
    worldOf(on, "dark");
    await runTimed($, "fail", TWELVE_S, "slow-fail");

    const pane = await mountPane($, WIDE_COLUMNS);

    expect((await bodyLines(pane)).some((line) => line.text.startsWith("Failed"))).toBe(true);
    const durations = await pane.findAll({ type: "Text", text: "12s" });
    expect(durations.length).toBeGreaterThan(0);
    expect(durations.every((node) => node.props.weight === "semibold")).toBe(true);
  });
});

describe("Activity filter", () => {
  test("T2-c typing bash leaves only Bash calls and clearing the text shows all calls", async ($, on) => {
    worldOf(on);
    await runMixedCalls($);
    const pane = await mountPane($, WIDE_COLUMNS);

    await pane.input({ key: "filter", text: "bash", kind: "change" });

    expect(await callKeys(pane)).toEqual(["call-mixed-0", "call-mixed-4", "call-mixed-5"]);
    await pane.input({ key: "filter", text: "", kind: "change" });
    expect(await callKeys(pane)).toContain("call-mixed-1");
  });

  test("T2-e with no match the field stays and the timeline says no matching calls", async ($, on) => {
    worldOf(on);
    await runMixedCalls($);
    const pane = await mountPane($, WIDE_COLUMNS);

    await pane.input({ key: "filter", text: "zzz-none", kind: "change" });

    const texts = (await bodyLines(pane)).map((line) => line.text);
    expect(texts).toContain("no matching calls");
    expect(await pane.find({ type: "Input", key: "filter" })).toBeDefined();
    expect(texts.some((text) => text.startsWith("Timeline"))).toBe(true);
  });
});

describe("Activity filter row", () => {
  test("T4-a one blank row sits between the filter row and the live line, which sits directly above the chip line", async ($, on) => {
    worldOf(on);
    await runMixedCalls($);
    const pane = await mountPane($, WIDE_COLUMNS);

    const texts = linesOf((await pane.drawn()) as unknown as Node).map((line) => line.text);

    const tabBarAt = texts.findIndex((text) => text.includes("Activity"));
    const chipAt = texts.findIndex((text) => text.includes(" tools · "));
    expect(texts.slice(tabBarAt + 1, chipAt)).toEqual(["", "f filter", "", "idle"]);
  });

  test("S20a at 60 columns the Tool mix legend wraps onto a second line, every label reads whole, and no … is drawn in it", async ($, on) => {
    worldOf(on);
    await runLegendCalls($);
    const pane = await mountPane($, SIXTY_COLUMNS);

    const legend = legendRowsOf(screenRows(await pane.drawn(), SIXTY_COLUMNS));

    expect(legend).toHaveLength(2);
    for (const label of LEGEND_LABELS)
      expect(legend.some((row) => row.includes(`● ${label}`))).toBe(true);
    expect(legend.join("")).not.toContain("…");
    expect(indentOf(legend[0] ?? "")).toBe(indentOf(legend[1] ?? ""));
  });

  test("S20b at 120 columns the Tool mix legend stays on one line with the same text as today", async ($, on) => {
    worldOf(on);
    await runLegendCalls($);
    const pane = await mountPane($, WIDE_COLUMNS);

    const legend = legendRowsOf(screenRows(await pane.drawn(), WIDE_COLUMNS));

    expect(legend.map((row) => row.trimEnd())).toEqual([WIDE_LEGEND]);
  });
});

async function callKeys(pane: Pane): Promise<string[]> {
  const keys = (await pane.findAll({ type: "Button" })).map((button) => String(button.key));
  return [...new Set(keys.filter((key) => key.startsWith("call-")))].sort();
}

function seedCalls(on: On, rows: CallRecord[]): void {
  on("state.get", async (_$, e, next) => {
    if (e.key !== "calls") return next(e);
    const { value: stored } = await next(e);
    return {
      value: {
        value: stored?.value ?? { shape: "calls-slim", value: rows },
        version: stored?.version ?? 0,
      },
    };
  });
}

function readRows(count: number): CallRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `read-${i}`,
    tool: "Read",
    target: `/work/file${i}.ts`,
    ms: 1,
    isErrored: false,
    added: 0,
    removed: 0,
  }));
}

function filterRows(): CallRecord[] {
  const files = [
    ...Array.from({ length: FILTER_MATCHES }, (_, i) => `${FILTER_TEXT}${i}.ts`),
    ...Array.from({ length: FILTER_MISSES }, (_, i) => `miss${i}.ts`),
  ];
  return files.map((file, i) => ({
    id: `read-${i}`,
    tool: "Read",
    target: `/work/${file}`,
    ms: 1,
    isErrored: false,
    added: 0,
    removed: 0,
  }));
}

let callsKept = 0;
let activityKept: Record<string, unknown>[] = [];
let editFailure = `<tool_use_error>${NOT_FOUND}\nString: missing</tool_use_error>`;
let bashError = "";

function worldOf(on: On, theme?: string): void {
  callsKept = 0;
  activityKept = [];
  editFailure = `<tool_use_error>${NOT_FOUND}\nString: missing</tool_use_error>`;
  bashError = "";
  const clock = mock.clock(on);
  mock.env(on, { HOME: "/h/u" });
  if (theme !== undefined)
    on("config.list", () => ({ value: [{ key: "theme", value: theme }] }) as never);
  on("state.set", (_$, e, next) => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (e.plugin === "paneline" && e.key === "calls") callsKept = keptCount(e.value);
    if (e.key === "activity") activityKept = e.value;
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
  const feed = feedSession(on);
  on("agent.list", () => ({ value: [] }));
  on("tool.call", async (_$, e) => {
    const call = e as unknown as CallSpec;
    if (typeof call.waitMs === "number") await clock.advance(call.waitMs);
    return feed.record(e, outcomeOf(call)) as never;
  });
}

function keptCount(saved: unknown): number {
  return Array.isArray(saved) ? saved.length : (saved as Shaped<unknown[]>).value.length;
}

function outcomeOf(call: CallSpec): Record<string, unknown> {
  if (call.tool === "Bash" && call.command === "fail")
    return { isError: true, result: "boom", text: "boom" };
  if (call.tool === "Bash" && (call.command === FAILING_COMMAND || call.command === LS_COMMAND))
    return { isError: true, result: bashError, text: bashError };
  if (call.tool === "Edit" && call.old_string === "missing")
    return { isError: true, result: editFailure, text: editFailure };
  if (call.tool === "Write" && call.file_path === "/work/blocked.ts") return { deny: DENIED };
  if (call.tool === "Edit")
    return { result: { structuredPatch: [{ lines: ["+a", "-b"] }] }, text: "edited" };
  return { result: BASH_OUTPUT, text: BASH_OUTPUT };
}

async function runMixedCalls($: Engine): Promise<void> {
  const calls: CallSpec[] = [
    { tool: "Bash", command: LONG_COMMAND },
    { tool: "Grep", pattern: "needle" },
    { tool: "Edit", file_path: "/work/src/deep/nested/file.ts" },
    { tool: "Agent", description: "explore the repository", prompt: "look around" },
    { tool: "Bash", command: "fail" },
    { tool: "Bash", command: "fail" },
  ];
  for (const [i, call] of calls.entries())
    await $.tool.call({ ...call, tool_use_id: `mixed-${i}` } as never);
}

async function startInTheme($: Engine, on: On, theme: string): Promise<void> {
  worldOf(on, theme);
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  await $.session.start({ cwd: "/work", surface: "terminal", isInteractive: true });
}

async function openAllowed(pane: Pane): Promise<void> {
  const fold = (await pane.findAll({ type: "Button" })).find((button) =>
    /^▸ \d+ auto-allowed$/.test(String(button.props.label)),
  );
  if (fold === undefined) throw new Error("the auto-allowed fold row is not drawn");
  await pane.press({ key: String(fold.key) });
}

async function runTimed($: Engine, command: string, waitMs: number, id: string): Promise<void> {
  await $.tool.call({ tool: "Bash", command, waitMs, tool_use_id: id } as never);
}

async function runFailedEdit($: Engine): Promise<void> {
  await $.tool.call({
    tool: "Edit",
    file_path: "/work/src/file.ts",
    old_string: "missing",
    tool_use_id: "failed-edit",
  } as never);
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

async function bodyLines(pane: Pane): Promise<Line[]> {
  return linesOf((await pane.drawn()) as unknown as Node).filter((line) => line.text !== "");
}

function linesOf(node: Node): Line[] {
  if (node.type === "Text") return [lineOf(node)];
  if (isRow(node) && !holdsColumn(node)) return [lineOf(node)];
  return elementsIn(node).flatMap(linesOf);
}

function lineOf(node: Node): Line {
  return {
    text: textOf(node),
    outerTexts: outerTextsIn(node),
    hasButton: holds(node, "Button"),
    labels: labelsIn(node),
  };
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

function labelsIn(node: Node): string {
  const label = node.props?.label;
  const own = node.type === "Button" && typeof label === "string" ? label : "";
  return own + elementsIn(node).map(labelsIn).join("");
}

function holds(node: Node, type: string): boolean {
  return node.type === type || elementsIn(node).some((child) => holds(child, type));
}

function outerTextsIn(node: Node): Node[] {
  return node.type === "Text" ? [node] : elementsIn(node).flatMap(outerTextsIn);
}

function elementsIn(node: Node): Node[] {
  return (node.children ?? []).filter(
    (child): child is Node => typeof child === "object" && child !== null,
  );
}

function textOf(node: Node): string {
  return (node.children ?? [])
    .map((child) => (typeof child === "string" ? child : textOf(child as Node)))
    .join("");
}

function ownText(node: Node): string {
  return (node.children ?? [])
    .filter((child): child is string => typeof child === "string")
    .join("");
}

async function chipLeaf(pane: Pane, text: string): Promise<Node | undefined> {
  const matches = await pane.findAll({ type: "Text", text });
  return (matches as unknown as Node[]).find((node) => ownText(node) === text);
}

async function runLegendCalls($: Engine): Promise<void> {
  const calls: CallSpec[] = [
    { tool: "Read", file_path: "/work/a.ts" },
    { tool: "Edit", file_path: "/work/src/file.ts" },
    ...Array.from({ length: BASH_RUNS }, () => ({ tool: "Bash", command: "ls" })),
    { tool: "WebFetch", url: "https://example.com" },
    { tool: "Agent", description: "explore", prompt: "look" },
    { tool: "Mystery" },
  ];
  for (const [i, call] of calls.entries())
    await $.tool.call({ ...call, tool_use_id: `legend-${i}` } as never);
}

function legendRowsOf(rows: string[]): string[] {
  return rows.filter((row) => row.trimStart().startsWith("●"));
}

function indentOf(row: string): number {
  return row.length - row.trimStart().length;
}
