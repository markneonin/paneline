import { describe, expect, mock, test } from "claude-code/testing";
import type { On, ToolCheckResult } from "claude-code";
import type { Engine } from "claude-code/testing";

import { palette } from "../hooks/palette";
import { headingLineOf, lines, paneOnTab, texts } from "./clear-world";
import { screenRows } from "./band-screen";
import type { Pane } from "./clear-world";
import { textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import { feedSession, useOf } from "./session-feed";
import { keyOf } from "./skills-tree";
import type { Line } from "./skills-tree";

type Outcome = Record<string, unknown>;
type Script = { verdict?: ToolCheckResult; outcome?: Outcome; outcomes?: Outcome[] };

const SIXTY_COLUMNS = 60;
const ONE_TWENTY_COLUMNS = 120;
const WORK = "/work";
const ECHO_COMMAND = "echo ok";
const FAILED_COMMAND = "cat does-not-exist.txt";
const ALLOWED_COMMAND = "git push --dry-run";
const REFUSED_COMMAND = "rm -r build";
const HOOK_DENIED_COMMAND = "rm -rf does-not-exist";
const READ_PATH = "/work/a.ts";
const EDITED_PATH = "/work/src/file.ts";
const MISSING_PATH = "/work/src/missing.ts";
const SHORT_ERROR = "No such file or directory";
const LONG_ERROR =
  "cat: does-not-exist.txt: No such file or directory, then a much longer explanation that the row cannot show whole";
const HOOK_DENIAL = "Blocked by the project hook: writes outside the workspace";
const REFUSAL = "The user doesn't want to proceed with this tool use.";
const LONG_FAILED_COMMAND = "cat does-not-exist/deeper/some-long-file-name-here-xyz.txt";
const LONG_REFUSED_COMMAND = "rm -r does-not-exist/some/long/directory/name-here";
const SHORT_DENIAL = "Blocked by hook";
const READ_ONLY_REASON = "read-only tool";
const SHOT_ERROR = "Exit code 1: cat: no such file or directory";
const FILTER_KEY = "filter";
const FILTER_BASH = "Bash";
const ECHO_FILTER = "echo";
const REFUSED_FILTER = "rm";
const AUTO_ALLOWED_FOLD = /^▸ \d+ auto-allowed$/;
const CHIP_LINE = /^(?:\d+ms|\d+s|\d+m \d{2}s) · \d+ tools?/;
const DENIED_GLYPH = "⊘";
const FAILED_GLYPH = "✗";
const GLYPHS = ["✓", "✗", "⊘"];
const FAILED_HEADING = "Failed";
const FAILED_KEY_PREFIX = "failed-";
const DENIED_TAG = "denied";
const FAILED_TAG = "failed";
const PERSON_DENIAL = "denied by you";
const ENGINE_REJECTION = "has been denied";
const READABLE_COMMAND_CELLS = 40;
const CLOCK_CELLS = 6;
const CLIPPED_COMMAND_CELLS = READABLE_COMMAND_CELLS - CLOCK_CELLS;
const CLOCK_LEAD = /^ (\d\d:\d\d)/u;
const ONE_TOOL_ONLY_CHIP = /^\S+ · 1 tool$/;
const ONE_ERROR_CHIP = /· 1 error$/;
const TWO_ERRORS_CHIP = /· 2 errors$/;
const STUCK_TITLE = "Stuck";
const ALL_CHIPS = /· 5 tools · 2 files · 2 errors$/;
const BASH_ONLY_CHIPS = /· 2 tools · 1 error$/;
const ALLOW_VERDICT: ToolCheckResult = { decision: "allow" };
const OK_OUTCOME: Outcome = { result: "ok", text: "ok" };
const HOOK_REFUSAL: Script = { outcome: { deny: HOOK_DENIAL } };
const SHORT_HOOK_REFUSAL: Script = { outcome: { deny: SHORT_DENIAL } };
const PERSON_REFUSAL: Script = {
  verdict: { decision: "ask" },
  outcome: { isError: true, result: REFUSAL, text: REFUSAL },
};

const SHORT_DENIED = "touch denied-marker.txt && echo made";
const LONG_DENIED =
  "touch /private/tmp/claude-502/-home-dev-projects-IT-demo-app/denied-marker-with-long-name.txt";
const CUT_MARK = "…";
const SHORT_TARGET = "touch denied-marker.txt";
const PERMISSIONS_TITLE = "Permissions";
const TIMELINE_TITLE = "Timeline";
const FAILED_TITLE = "Failed";
const DURATION = "0ms";
const DENIED_LEAD = " ⊘ Bash   ";
const DONE_LEAD = " ✓ Bash   ";
const FAILED_LEAD = " ✗ Bash   ";
const ROW_PATH_FRAGMENT = "touch /private/tmp/";

describe("Activity denied calls", () => {
  test("S1 a Bash call a hook refuses shows ⊘ on its row, not ✗, and the header reads 1 tool with no errors part and no Failed section", async ($, on) => {
    worldOf(on, { [HOOK_DENIED_COMMAND]: HOOK_REFUSAL });
    await callBash($, HOOK_DENIED_COMMAND, "s1-hook");

    const pane = await paneOnTab($, "Activity", { columns: ONE_TWENTY_COLUMNS });

    const row = rowOf(await lines(pane), "call-s1-hook");
    expect(glyphOf(row)).toBe(DENIED_GLYPH);
    expect(partNamed(row, "Bash")?.props?.color).not.toBe(palette.failed);
    expect(await chipLineOf(pane)).toMatch(ONE_TOOL_ONLY_CHIP);
    expect(headingLineOf(await lines(pane), FAILED_HEADING)).toBeUndefined();
    expect(await failedRowKeys(pane)).toEqual([]);
  });

  test("S2 a Bash call the owner refuses shows ⊘ on its row, and its details say denied, not failed", async ($, on) => {
    worldOf(on, { [REFUSED_COMMAND]: PERSON_REFUSAL });
    await callBash($, REFUSED_COMMAND, "s2-refused");
    const pane = await paneOnTab($, "Activity", { columns: ONE_TWENTY_COLUMNS });

    expect(glyphOf(rowOf(await lines(pane), "call-s2-refused"))).toBe(DENIED_GLYPH);
    await pane.press({ key: "call-s2-refused" });

    const shown = await nodeTexts(pane);
    expect(shown).toContain(DENIED_TAG);
    expect(shown).not.toContain(FAILED_TAG);
  });

  test("S3 one refused call and one failed call make the header read 1 error, and Failed lists only the failed one", async ($, on) => {
    worldOf(on, {
      [HOOK_DENIED_COMMAND]: HOOK_REFUSAL,
      [FAILED_COMMAND]: failedScript(SHORT_ERROR),
    });
    await callBash($, HOOK_DENIED_COMMAND, "s3-refused");
    await callBash($, FAILED_COMMAND, "s3-failed");

    const pane = await paneOnTab($, "Activity", { columns: ONE_TWENTY_COLUMNS });

    expect(await chipLineOf(pane)).toMatch(ONE_ERROR_CHIP);
    expect(await failedRowKeys(pane)).toEqual([`${FAILED_KEY_PREFIX}s3-failed`]);
  });

  test("S4 an allowed Bash call that then fails shows ✗ in Permissions, not ✓", async ($, on) => {
    worldOf(on, { [ALLOWED_COMMAND]: failedScript(SHORT_ERROR) });
    await callBash($, ALLOWED_COMMAND, "s4-allowed");

    const pane = await paneOnTab($, "Activity", { columns: ONE_TWENTY_COLUMNS });
    await openAllowed(pane);

    expect(glyphOf(rowOf(await lines(pane), "permission-s4-allowed"))).toBe(FAILED_GLYPH);
  });

  test("S5 at 60 columns a failed command with a long error keeps the full command on its row", async ($, on) => {
    worldOf(on, { [FAILED_COMMAND]: failedScript(LONG_ERROR) });
    await callBash($, FAILED_COMMAND, "s5-failed");

    const pane = await paneOnTab($, "Activity", { columns: SIXTY_COLUMNS });

    expect(rowOf(await lines(pane), "call-s5-failed")?.text).toContain(FAILED_COMMAND);
  });

  test("S6 at 120 columns a failed command shows its command and its error on one row", async ($, on) => {
    worldOf(on, { [FAILED_COMMAND]: failedScript(SHORT_ERROR) });
    await callBash($, FAILED_COMMAND, "s6-failed");

    const pane = await paneOnTab($, "Activity", { columns: ONE_TWENTY_COLUMNS });

    const row = rowOf(await lines(pane), "call-s6-failed")?.text ?? "";
    expect(row).toContain(FAILED_COMMAND);
    expect(row).toContain(SHORT_ERROR);
  });

  test("S7 typing Bash in the filter hides the other rows and the header chips count only the Bash calls", async ($, on) => {
    worldOf(on, {
      [FAILED_COMMAND]: failedScript(SHORT_ERROR),
      [MISSING_PATH]: failedScript(SHORT_ERROR),
    });
    await callBash($, ECHO_COMMAND, "s7-echo");
    await callTool($, { tool: "Read", file_path: READ_PATH, tool_use_id: "s7-read" });
    await callTool($, { tool: "Edit", file_path: EDITED_PATH, tool_use_id: "s7-edit" });
    await callTool($, { tool: "Edit", file_path: MISSING_PATH, tool_use_id: "s7-missing" });
    await callBash($, FAILED_COMMAND, "s7-failed");
    const pane = await paneOnTab($, "Activity", { columns: ONE_TWENTY_COLUMNS });
    expect(await chipLineOf(pane)).toMatch(ALL_CHIPS);

    await pane.input({ key: FILTER_KEY, text: FILTER_BASH, kind: "change" });
    expect(rowOf(await lines(pane), "call-s7-read")).toBeUndefined();
    expect(await chipLineOf(pane)).toMatch(BASH_ONLY_CHIPS);
  });

  test("P-F1 typing echo in the filter makes the auto-allowed fold count and list only the 2 echo calls", async ($, on) => {
    worldOf(on, {});
    await callBash($, ECHO_COMMAND, "pf1-echo-1");
    await callBash($, ECHO_COMMAND, "pf1-echo-2");
    await callTool($, { tool: "Read", file_path: READ_PATH, tool_use_id: "pf1-read-1" });
    await callTool($, { tool: "Read", file_path: EDITED_PATH, tool_use_id: "pf1-read-2" });
    const pane = await paneOnTab($, "Activity", { columns: ONE_TWENTY_COLUMNS });
    expect(await autoAllowedFoldsOf(pane)).toEqual(["▸ 4 auto-allowed"]);

    await pane.input({ key: FILTER_KEY, text: ECHO_FILTER, kind: "change" });
    expect(await autoAllowedFoldsOf(pane)).toEqual(["▸ 2 auto-allowed"]);
    await openAllowed(pane);

    const shown = await lines(pane);
    expect(rowOf(shown, "permission-pf1-echo-1")).toBeDefined();
    expect(rowOf(shown, "permission-pf1-echo-2")).toBeDefined();
    expect(rowOf(shown, "permission-pf1-read-1")).toBeUndefined();
    expect(rowOf(shown, "permission-pf1-read-2")).toBeUndefined();
  });

  test("P-F2 typing a filter that matches no auto-allowed call draws no auto-allowed fold, while the refused call still shows", async ($, on) => {
    worldOf(on, { [REFUSED_COMMAND]: PERSON_REFUSAL });
    await callBash($, ECHO_COMMAND, "pf2-echo-1");
    await callBash($, ECHO_COMMAND, "pf2-echo-2");
    await callBash($, REFUSED_COMMAND, "pf2-refused");
    const pane = await paneOnTab($, "Activity", { columns: ONE_TWENTY_COLUMNS });

    await pane.input({ key: FILTER_KEY, text: REFUSED_FILTER, kind: "change" });

    expect(rowOf(await lines(pane), "permission-pf2-refused")).toBeDefined();
    expect(await autoAllowedFoldsOf(pane)).toEqual([]);
  });

  test("S8 at 60 columns a hook-refused command keeps the readable start of the command on its Permissions row", async ($, on) => {
    worldOf(on, { [LONG_REFUSED_COMMAND]: HOOK_REFUSAL });
    await callBash($, LONG_REFUSED_COMMAND, "s8-refused");

    const pane = await paneOnTab($, "Activity", { columns: SIXTY_COLUMNS });

    expect(rowOf(await lines(pane), "permission-s8-refused")?.text).toContain(
      LONG_REFUSED_COMMAND.slice(0, CLIPPED_COMMAND_CELLS),
    );
  });

  test("S9 at 60 columns a failed command longer than the row keeps its first 34 cells and drops the reason", async ($, on) => {
    worldOf(on, { [LONG_FAILED_COMMAND]: failedScript(LONG_ERROR) });
    await callBash($, LONG_FAILED_COMMAND, "s9-failed");

    const pane = await paneOnTab($, "Activity", { columns: SIXTY_COLUMNS });

    const row = rowOf(await lines(pane), "call-s9-failed")?.text ?? "";
    expect(row).toContain(LONG_FAILED_COMMAND.slice(0, CLIPPED_COMMAND_CELLS));
    expect(row).not.toContain(LONG_ERROR);
  });

  test("S10 at 120 columns a short refused command and its short reason both stay on its Permissions row", async ($, on) => {
    worldOf(on, { [HOOK_DENIED_COMMAND]: SHORT_HOOK_REFUSAL });
    await callBash($, HOOK_DENIED_COMMAND, "s10-refused");

    const pane = await paneOnTab($, "Activity", { columns: ONE_TWENTY_COLUMNS });

    const row = rowOf(await lines(pane), "permission-s10-refused")?.text ?? "";
    expect(row).toContain(HOOK_DENIED_COMMAND);
    expect(row).toContain(SHORT_DENIAL);
  });

  test("S11 a refused Bash call's row says denied by you, not the engine's denial text", async ($, on) => {
    worldOf(on, { [REFUSED_COMMAND]: PERSON_REFUSAL });
    await callBash($, REFUSED_COMMAND, "s11-refused");

    const pane = await paneOnTab($, "Activity", { columns: ONE_TWENTY_COLUMNS });

    const row = rowOf(await lines(pane), "call-s11-refused")?.text ?? "";
    expect(row).toContain(PERSON_DENIAL);
    expect(row).not.toContain(ENGINE_REJECTION);
  });

  test("S12 the engine's denial text in a refused call's details is not drawn in the failure colour", async ($, on) => {
    worldOf(on, { [REFUSED_COMMAND]: PERSON_REFUSAL });
    await callBash($, REFUSED_COMMAND, "s12-refused");
    const pane = await paneOnTab($, "Activity", { columns: ONE_TWENTY_COLUMNS });
    await pane.press({ key: "call-s12-refused" });

    const rejection = await textNodesWith(pane, ENGINE_REJECTION);

    expect(rejection.length).toBeGreaterThan(0);
    expect(rejection.every((node) => node.props?.color !== palette.failed)).toBe(true);
  });

  test("S13 at 60 columns an allowed command that failed keeps its command and reason, and its row fits the pane", async ($, on) => {
    worldOf(on, {
      [FAILED_COMMAND]: {
        verdict: { decision: "allow", reason: READ_ONLY_REASON },
        outcome: { isError: true, result: SHOT_ERROR, text: SHOT_ERROR },
      },
    });
    await callBash($, FAILED_COMMAND, "s13-allowed");

    const pane = await paneOnTab($, "Activity", { columns: SIXTY_COLUMNS });
    await openAllowed(pane);

    const row = rowOf(await lines(pane), "permission-s13-allowed")?.text ?? "";
    expect(row).toContain(FAILED_COMMAND);
    expect(row).toContain(READ_ONLY_REASON);
    expect([...row].length).toBeLessThanOrEqual(SIXTY_COLUMNS);
  });

  test("S19a at 60 columns a refused short command's target is cut with an ellipsis, and its row ends with denied by you, at least two cells after the target", async ($, on) => {
    worldOf(on, { [SHORT_DENIED]: PERSON_REFUSAL });
    await callBash($, SHORT_DENIED, "s19a-refused");
    const pane = await paneOnTab($, "Activity", { columns: SIXTY_COLUMNS });

    expect(rowOf(await lines(pane), "permission-s19a-refused")?.text).toContain(SHORT_TARGET);
    const row = sectionRow(await screenOf(pane, SIXTY_COLUMNS), PERMISSIONS_TITLE, SHORT_TARGET);

    expect(row.trimEnd()).toHaveLength(SIXTY_COLUMNS);
    expect(row).toContain(CUT_MARK);
    expect(row.trimEnd().endsWith(PERSON_DENIAL)).toBe(true);
    expect(gapBeforeReason(row)).toBeGreaterThanOrEqual(2);
  });

  test("S19b at 60 columns a refused long path is cut with an ellipsis, and its row still ends with denied by you", async ($, on) => {
    worldOf(on, { [LONG_DENIED]: PERSON_REFUSAL });
    await callBash($, LONG_DENIED, "s19b-refused");
    const pane = await paneOnTab($, "Activity", { columns: SIXTY_COLUMNS });

    const row = sectionRow(
      await screenOf(pane, SIXTY_COLUMNS),
      PERMISSIONS_TITLE,
      ROW_PATH_FRAGMENT,
    );

    expect(row.trimEnd()).toHaveLength(SIXTY_COLUMNS);
    expect(row).toContain(CUT_MARK);
    expect(row.trimEnd().endsWith(PERSON_DENIAL)).toBe(true);
    expect(gapBeforeReason(row)).toBeGreaterThanOrEqual(2);
  });

  test("S19c at 120 columns a refused short command's row reads exactly as it does today", async ($, on) => {
    worldOf(on, { [SHORT_DENIED]: PERSON_REFUSAL });
    await callBash($, SHORT_DENIED, "s19c-refused");
    const pane = await paneOnTab($, "Activity", { columns: ONE_TWENTY_COLUMNS });

    const row = sectionRow(
      await screenOf(pane, ONE_TWENTY_COLUMNS),
      PERMISSIONS_TITLE,
      SHORT_DENIED,
    );

    expect(row).toBe(
      rowEnding(`${clocked(row)}${DENIED_LEAD}${SHORT_DENIED}`, ONE_TWENTY_COLUMNS, PERSON_DENIAL),
    );
  });

  test("S19d at 60 and 120 columns the Timeline and Failed rows read exactly as they do today", async ($, on) => {
    worldOf(on, { [SHORT_DENIED]: PERSON_REFUSAL, [FAILED_COMMAND]: failedScript(SHORT_ERROR) });
    await callBash($, ECHO_COMMAND, "s19d-done");
    await callBash($, SHORT_DENIED, "s19d-refused");
    await callBash($, FAILED_COMMAND, "s19d-failed");

    const narrow = await paneOnTab($, "Activity", { columns: SIXTY_COLUMNS });
    const narrowRows = await screenOf(narrow, SIXTY_COLUMNS);

    const narrowDone = sectionRow(narrowRows, TIMELINE_TITLE, ECHO_COMMAND);
    const narrowDenied = sectionRow(narrowRows, TIMELINE_TITLE, SHORT_DENIED);
    expect(narrowDone).toBe(
      rowEnding(`${clocked(narrowDone)}${DONE_LEAD}${ECHO_COMMAND}`, SIXTY_COLUMNS, DURATION),
    );
    expect(narrowDenied).toBe(
      rowEnding(`${clocked(narrowDenied)}${DENIED_LEAD}${SHORT_DENIED}`, SIXTY_COLUMNS, DURATION),
    );
    await narrow.unmount();

    const wide = await paneOnTab($, "Activity", { columns: ONE_TWENTY_COLUMNS });
    const wideRows = await screenOf(wide, ONE_TWENTY_COLUMNS);

    const wideDone = sectionRow(wideRows, TIMELINE_TITLE, ECHO_COMMAND);
    const wideDenied = sectionRow(wideRows, TIMELINE_TITLE, SHORT_DENIED);
    const wideFailed = sectionRow(wideRows, FAILED_TITLE, FAILED_COMMAND);
    expect(wideDone).toBe(
      rowEnding(`${clocked(wideDone)}${DONE_LEAD}${ECHO_COMMAND}`, ONE_TWENTY_COLUMNS, DURATION),
    );
    expect(wideDenied).toBe(
      rowEnding(
        `${clocked(wideDenied)}${DENIED_LEAD}${SHORT_DENIED} · ${PERSON_DENIAL}`,
        ONE_TWENTY_COLUMNS,
        DURATION,
      ),
    );
    expect(wideFailed).toBe(
      rowEnding(
        `${clocked(wideFailed)}${FAILED_LEAD}${FAILED_COMMAND} · ${SHORT_ERROR}`,
        ONE_TWENTY_COLUMNS,
        DURATION,
      ),
    );
  });
  test("S19e at 120 columns a refused long path is cut with an ellipsis, and its row still ends with denied by you", async ($, on) => {
    worldOf(on, { [LONG_DENIED]: PERSON_REFUSAL });
    await callBash($, LONG_DENIED, "s19e-refused");
    const pane = await paneOnTab($, "Activity", { columns: ONE_TWENTY_COLUMNS });

    const row = sectionRow(
      await screenOf(pane, ONE_TWENTY_COLUMNS),
      PERMISSIONS_TITLE,
      ROW_PATH_FRAGMENT,
    );

    expect(row.trimEnd()).toHaveLength(ONE_TWENTY_COLUMNS);
    expect(row).toContain(CUT_MARK);
    expect(row.trimEnd().endsWith(PERSON_DENIAL)).toBe(true);
    expect(gapBeforeReason(row)).toBeGreaterThanOrEqual(2);
  });

  test("S20 three refused calls of one command draw no Stuck section", async ($, on) => {
    worldOf(on, { [HOOK_DENIED_COMMAND]: HOOK_REFUSAL });
    await callBash($, HOOK_DENIED_COMMAND, "s20-refused-1");
    await callBash($, HOOK_DENIED_COMMAND, "s20-refused-2");
    await callBash($, HOOK_DENIED_COMMAND, "s20-refused-3");

    const pane = await paneOnTab($, "Activity", { columns: ONE_TWENTY_COLUMNS });

    const shown = await lines(pane);
    expect(rowOf(shown, "call-s20-refused-3")).toBeDefined();
    expect(headingLineOf(shown, STUCK_TITLE)).toBeUndefined();
  });

  test("S21 two failed and one refused call of one command draw no Stuck section", async ($, on) => {
    worldOf(on, {
      [HOOK_DENIED_COMMAND]: {
        outcomes: [failedOutcome(SHORT_ERROR), failedOutcome(SHORT_ERROR), { deny: HOOK_DENIAL }],
      },
    });
    await callBash($, HOOK_DENIED_COMMAND, "s21-failed-1");
    await callBash($, HOOK_DENIED_COMMAND, "s21-failed-2");
    await callBash($, HOOK_DENIED_COMMAND, "s21-refused");

    const pane = await paneOnTab($, "Activity", { columns: ONE_TWENTY_COLUMNS });

    expect(await chipLineOf(pane)).toMatch(TWO_ERRORS_CHIP);
    expect(headingLineOf(await lines(pane), STUCK_TITLE)).toBeUndefined();
  });
});

function worldOf(on: On, scripts: Record<string, Script>): void {
  mock.clock(on);
  mock.env(on, { HOME: "/h/u" });
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: WORK }));
  const feed = feedSession(on);
  on("agent.list", () => ({ value: [] }));
  on("process.run", () => ({ value: { exitCode: 1, stdout: "", stderr: "" } }) as never);
  on("tool.check", (_$, e) => {
    const { verdict } = scriptOf(scripts, targetOf(e.input));
    if (verdict.decision === "ask" && e.tool_use_id !== undefined) {
      const call = { tool: e.tool, tool_use_id: e.tool_use_id, ...(e.input as object) };
      feed.hold(useOf(call, refusalOutcome(e.tool, targetOf(e.input))));
    }
    return verdict;
  });
  on("tool.call", (_$, e) => feed.record(e, outcomeOf(scripts, targetOf(e))) as never);
}

function outcomeOf(scripts: Record<string, Script>, target: string): Outcome {
  return scripts[target]?.outcomes?.shift() ?? scriptOf(scripts, target).outcome;
}

function refusalOutcome(tool: string, target: string): Outcome {
  const text = `Permission to use ${tool} with command ${target} has been denied.`;
  return { isError: true, result: text, text };
}

function scriptOf(
  scripts: Record<string, Script>,
  target: string,
): { verdict: ToolCheckResult; outcome: Outcome } {
  const script = scripts[target];
  return { verdict: script?.verdict ?? ALLOW_VERDICT, outcome: script?.outcome ?? OK_OUTCOME };
}

type CallTarget = { command?: unknown; file_path?: unknown };

function targetOf(input: unknown): string {
  if (typeof input !== "object" || input === null) return "";
  const { command, file_path: filePath } = input as CallTarget;
  const target = command ?? filePath;
  return typeof target === "string" ? target : "";
}

function failedScript(text: string): Script {
  return { outcome: failedOutcome(text) };
}

function failedOutcome(text: string): Outcome {
  return { isError: true, result: text, text };
}

async function callBash($: Engine, command: string, id: string): Promise<unknown> {
  return callTool($, { tool: "Bash", command, tool_use_id: id });
}

function callTool($: Engine, call: Record<string, string>): Promise<unknown> {
  return $.tool.call(call as never);
}

async function autoAllowedFoldsOf(pane: Pane): Promise<string[]> {
  const buttons = await pane.findAll({ type: "Button" });
  return buttons
    .map((button) => String(button.props.label))
    .filter((label) => AUTO_ALLOWED_FOLD.test(label));
}

async function openAllowed(pane: Pane): Promise<void> {
  const fold = (await pane.findAll({ type: "Button" })).find((button) =>
    /^▸ \d+ auto-allowed$/.test(String(button.props.label)),
  );
  if (fold === undefined) throw new Error("the auto-allowed fold row is not drawn");
  await pane.press({ key: String(fold.key) });
}

function rowOf(shown: Line[], key: string): Line | undefined {
  return shown.find((line) => line.parts.some((part) => keyOf(part) === key));
}

function glyphOf(row: Line | undefined): string {
  return row?.parts.map(textOf).find((text) => GLYPHS.includes(text)) ?? "";
}

function partNamed(row: Line | undefined, name: string): Node | undefined {
  return row?.parts.find((part) => part.type === "Text" && textOf(part) === name);
}

async function failedRowKeys(pane: Pane): Promise<string[]> {
  const buttons = await pane.findAll({ type: "Button" });
  return buttons
    .map((button) => String(button.key))
    .filter((key) => key.startsWith(FAILED_KEY_PREFIX));
}

async function nodeTexts(pane: Pane): Promise<string[]> {
  const nodes = await pane.findAll({ type: "Text" });
  return nodes.map((node) => textOf(node as unknown as Node));
}

async function chipLineOf(pane: Pane): Promise<string> {
  return (await texts(pane)).find((text) => CHIP_LINE.test(text)) ?? "";
}

async function textNodesWith(pane: Pane, fragment: string): Promise<Node[]> {
  const nodes = await pane.findAll({ type: "Text" });
  return nodes
    .map((node) => node as unknown as Node)
    .filter((node) => textOf(node).includes(fragment));
}

async function screenOf(pane: Pane, columns: number): Promise<string[]> {
  return screenRows(await pane.drawn(), columns);
}

function sectionRow(rows: string[], title: string, fragment: string): string {
  const start = rows.findIndex((row) => row.trimStart().startsWith(title));
  const below = start < 0 ? [] : rows.slice(start);
  return below.find((row) => row.includes(fragment)) ?? "";
}

function gapBeforeReason(row: string): number {
  const shown = row.trimEnd();
  const before = shown.slice(0, shown.length - PERSON_DENIAL.length);
  return before.length - before.trimEnd().length;
}

function clocked(row: string): string {
  return ` ${CLOCK_LEAD.exec(row)?.[1] ?? ""}`;
}

function rowEnding(lead: string, columns: number, tail: string): string {
  return lead.padEnd(columns - tail.length) + tail;
}
