import { describe, expect, mock, test } from "claude-code/testing";
import type { On, ToolCheckResult } from "claude-code";
import type { Engine } from "claude-code/testing";

import { palette } from "../hooks/palette";
import { replyLook } from "../hooks/reply-look";
import { isHeavy } from "./weight";

type Node = { type: string; props: Record<string, unknown>; children?: unknown };

const HOME = "/Users/dev";
const CWD = "/Users/dev/app";
const ENGINE_RESULT = "engine drew this result";
const ENGINE_CALL = "engine drew this call";
const SESSION_START = { cwd: CWD, surface: "terminal", isInteractive: true } as const;
const COMMAND = "npm test";
const CALL_OUTPUT = "hello from npm";
const RAN_ONE_COMMAND = "Ran 1 command";
const BUILD = "npm run build";
const GROUP_SUMMARY = "Read 2 files · Ran 1 command · Searched 1 time";
const FULL_ROWS = 11;
const LONG_ROWS = 30;
const HIDDEN_MARK = "… +";
const READ_START = 5;
const READ_LINES = 3;
const READ_TOTAL = 40;
const CONTEXT_WINDOW = 200_000;
const FAILED_PREFIX = "Error: ";
const ESC = "\u001b";
const COLUMNS = 80;
const ROWS = 40;
const NARROW_COLUMNS = 60;
const READ_BIG_ROWS = 509;
const LONG_PATH =
  "/srv/paneline-fixtures/archive/2026/10/28/nested-session-logs/transcript-for-the-long-title.txt";

const REFUSED_COMMAND = "rm -rf build";
const SECOND_REFUSED_COMMAND = "rm -r dist";
const FAILED_COMMAND = "cat missing.txt";
const LATER_COMMAND = "echo later";
const REFUSED_EDIT = "/Users/dev/app/src/locked.ts";
const REFUSAL_REASON = "Blocked by the permission rule for this command";
const PERSON_REFUSAL_TEXT = "The user doesn't want to proceed with this tool use.";
const FAILED_OUTPUT = "No such file or directory";
const CALLS_KEPT = 50;
const DENIED_WORD = "Denied";
const FAILED_WORD = "Failed";
const ALLOW_VERDICT: ToolCheckResult = { decision: "allow" };
const OK_OUTCOME = { result: "ok", text: "ok" };
const REFUSED: CallScript = { verdict: { decision: "deny", reason: REFUSAL_REASON } };
const PERSON_PROMPT: CallScript = {
  verdict: { decision: "ask" },
  outcome: { isError: true, result: PERSON_REFUSAL_TEXT, text: PERSON_REFUSAL_TEXT },
};
const FAILED_RUN: CallScript = {
  outcome: { isError: true, result: FAILED_OUTPUT, text: FAILED_OUTPUT },
};

type CallScript = { verdict?: ToolCheckResult; outcome?: Record<string, unknown> };
type CallTarget = { command?: unknown; file_path?: unknown };

type Hunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
};

describe("tool result panels", () => {
  test("TP1 a Bash command that prints text shows its output in a rounded panel titled with the command in the title colour", async ($, on) => {
    await world($, on);
    const tree = await drawCall(
      $,
      "b1",
      "Bash",
      { command: COMMAND },
      { output: bashOutput("hello from npm"), isExpanded: true },
    );

    const [panel] = windowsOf(tree);
    expect(panel?.props.borderStyle).toBe("round");
    expect(panel?.props.borderColor).toBe(replyLook(null).accent);
    const title = textNode(tree, COMMAND);
    expect(title?.props.color).toBe(replyLook(null).prose);
    expect(isHeavy(title?.props)).toBe(true);
    expect(shownText(tree)).toContain("hello from npm");
  });

  test("TP2 a Bash command that exits non-zero shows exit N in the failure colour and its error text as the body", async ($, on) => {
    await world($, on);

    const tree = await drawCall(
      $,
      "b2",
      "Bash",
      { command: COMMAND },
      { output: `${FAILED_PREFIX}Exit code 2\nboom happened`, isExpanded: true, isErrored: true },
    );

    expect(textNode(tree, "exit 2")?.props.color).toBe(palette.failed);
    expect(shownText(tree)).toContain("boom happened");
    expect(shownText(tree)).not.toContain("Exit code 2");
  });

  test("TP2b a Bash command sent to the background shows in background as its tag", async ($, on) => {
    await world($, on);

    const tree = await drawCall(
      $,
      "b2b",
      "Bash",
      { command: COMMAND },
      { output: { ...bashOutput(""), backgroundTaskId: "task-1" }, isExpanded: true },
    );

    expect(shownText(tree)).toContain("in background");
  });

  test("TP4 a Bash command's stderr lines follow its stdout lines in the failure colour", async ($, on) => {
    await world($, on);

    const tree = await drawCall(
      $,
      "b4",
      "Bash",
      { command: COMMAND },
      { output: bashOutput("out-line", "err-line"), isExpanded: true },
    );

    const text = shownText(tree);
    expect(text).toContain("out-line");
    expect(text.indexOf("err-line")).toBeGreaterThan(text.indexOf("out-line"));
    expect(textNodeContaining(tree, "err-line")?.props.color).toBe(palette.failed);
  });

  test("TP5 a Bash command that prints nothing shows no output in the muted colour", async ($, on) => {
    await world($, on);

    const tree = await drawCall(
      $,
      "b5",
      "Bash",
      { command: COMMAND },
      { output: bashOutput(""), isExpanded: true },
    );

    expect(textNode(tree, "no output")?.props.color).toBe(palette.muted);
  });

  test("TP6b a Bash command that prints 11 lines shows all 11 with no folded row", async ($, on) => {
    await world($, on);

    const tree = await drawCall(
      $,
      "b6",
      "Bash",
      { command: COMMAND },
      { output: bashOutput(outputLines(FULL_ROWS)), isExpanded: true },
    );

    const text = shownText(tree);
    expect(text).toContain(lineName(FULL_ROWS));
    expect(text).not.toContain(HIDDEN_MARK);
  });

  test("TP6c a Bash result of 30 lines in the full transcript (ctrl+o) shows all 30 with no folded row", async ($, on) => {
    await world($, on);

    const tree = await drawCall(
      $,
      "b6c",
      "Bash",
      { command: COMMAND },
      { output: bashOutput(outputLines(LONG_ROWS)), isExpanded: true },
    );

    const text = shownText(tree);
    expect(text).toContain(lineName(LONG_ROWS));
    expect(text).not.toContain(HIDDEN_MARK);
  });

  test("TP7 a Bash command that changed files shows its output panel first, then one panel per file, and no engine output", async ($, on) => {
    await world($, on);
    const output = {
      ...bashOutput("built"),
      bashEditDiff: {
        files: [{ filePath: `${CWD}/a.ts`, hunks: [hunk(1, ["-a", "+b"])] }],
        moreFiles: 0,
      },
    };

    const tree = await drawCall($, "b7", "Bash", { command: BUILD }, { output, isExpanded: true });

    const [commandPanel, filePanel, ...rest] = windowsOf(tree);
    expect(commandPanel).toBeDefined();
    expect(titleOf(commandPanel!)).toContain(BUILD);
    expect(filePanel).toBeDefined();
    expect(titleOf(filePanel!)).toContain("a.ts");
    expect(rest).toHaveLength(0);
    expect(shownText(tree)).toContain("built");
    expect(textOf(tree)).not.toContain(ENGINE_RESULT);
  });

  test("TP8 a Read row in the expanded transcript shows the file in a panel titled with its relative path, tagged with its line range and numbered from its first line", async ($, on) => {
    await world($, on);
    const output = readOutput(`${CWD}/hooks/a.ts`, "alpha\nbeta\ngamma");
    await drawGroup($, [{ tool_use_id: "r8", tool: "Read", input: {}, output }], true);

    const tree = await drawCall($, "r8", "Read", {}, { output, isExpanded: true });

    const [panel] = windowsOf(tree);
    expect(panel?.props.borderStyle).toBe("round");
    expect(titleOf(panel!)).toContain("hooks/a.ts");
    expect(textOf(tree)).toContain(
      `lines ${READ_START}-${READ_START + READ_LINES - 1} of ${READ_TOTAL - 1}`,
    );
    const code = collect(tree, "Code")[0];
    expect(code?.props.startLine).toBe(READ_START);
    expect(String(code?.props.source)).toContain("alpha");
  });

  test("TP10 a Read of an image shows the engine's own result and no panel", async ($, on) => {
    await world($, on);
    const output = {
      type: "image",
      file: { base64: "iVBORw0KGgo=", type: "image/png", originalSize: 8 },
    };

    expect(textOf(await drawResult($, "Read", output))).toBe(ENGINE_RESULT);
  });

  test("TP10b a Read that failed shows the engine's own result and no panel", async ($, on) => {
    await world($, on);

    const tree = await drawResult($, "Read", "File does not exist.", { isErrored: true });

    expect(textOf(tree)).toBe(ENGINE_RESULT);
  });

  test("TP10c a Bash command that prints image data shows the engine's own result and no panel", async ($, on) => {
    await world($, on);
    const output = { ...bashOutput("iVBORw0KGgo="), isImage: true };

    const call = await drawCall(
      $,
      "b10c",
      "Bash",
      { command: COMMAND },
      { output, isExpanded: true },
    );
    const result = await drawResult($, "Bash", output, { id: "b10c" });

    expect(windowsOf(call)).toEqual([]);
    expect(textOf(call)).not.toContain(ENGINE_RESULT);
    expect(textOf(result)).toBe(ENGINE_RESULT);
  });

  test("TP11 a folded group of two reads, a shell command and a search draws one row and no panel", async ($, on) => {
    await world($, on);

    const tree = await drawGroup($, [
      { tool_use_id: "g1", tool: "Read", input: {}, output: readOutput(`${CWD}/hooks/a.ts`, "a1") },
      { tool_use_id: "g2", tool: "Grep", input: { pattern: "x" }, output: "GREP-HIT" },
      { tool_use_id: "g3", tool: "Read", input: {}, output: readOutput(`${CWD}/hooks/b.ts`, "b1") },
      { tool_use_id: "g4", tool: "Bash", input: { command: COMMAND }, output: bashOutput("ok") },
    ]);

    expect(textOf(tree)).toContain(GROUP_SUMMARY);
    expect(windowsOf(tree)).toEqual([]);
    expect(shownText(tree)).not.toContain("GREP-HIT");
  });

  test("TP12 in the full transcript (ctrl+o) a Bash result of 30 lines shows all 30 lines in a titled panel with no folded row", async ($, on) => {
    await world($, on);

    const tree = await drawCall(
      $,
      "b12",
      "Bash",
      { command: COMMAND },
      { output: bashOutput(outputLines(LONG_ROWS)), isExpanded: true },
    );

    expect(windowsOf(tree)).toHaveLength(1);
    const text = shownText(tree);
    expect(text).toContain(lineName(LONG_ROWS));
    expect(text).not.toContain(HIDDEN_MARK);
  });

  test("TP13 a Bash command whose output has colour codes shows the plain words with no colour code text", async ($, on) => {
    await world($, on);

    const tree = await drawCall(
      $,
      "b13",
      "Bash",
      { command: COMMAND },
      { output: bashOutput(`${ESC}[31mred${ESC}[0m done`), isExpanded: true },
    );

    const text = shownText(tree);
    expect(text).toContain("red done");
    expect(text).not.toContain("[31m");
    expect(text).not.toContain("[0m");
  });

  test("TP14 a Read of a 509-line file shows the whole range in its tag", async ($, on) => {
    await world($, on);

    const tree = await drawResult(
      $,
      "Read",
      readOutput(`${CWD}/hooks/big.ts`, numberedRows(READ_BIG_ROWS), {
        startLine: 1,
        numLines: READ_BIG_ROWS,
        totalLines: READ_BIG_ROWS,
      }),
    );

    expect(textOf(tree)).toContain(`lines 1-${READ_BIG_ROWS} of ${READ_BIG_ROWS}`);
  });

  test("TP15 a Read of a whole three-line file shows its range as lines 1-3 of 3 with its three lines and no folded row", async ($, on) => {
    await world($, on);

    const tree = await drawResult(
      $,
      "Read",
      readOutput(`${CWD}/hooks/tiny.ts`, "one\ntwo\nthree\n", {
        startLine: 1,
        numLines: 4,
        totalLines: 4,
      }),
    );

    expect(textOf(tree)).toContain("lines 1-3 of 3");
    const text = shownText(tree);
    expect(text).toContain("one");
    expect(text).toContain("two");
    expect(text).toContain("three");
    expect(text).not.toContain(HIDDEN_MARK);
  });

  test("TP16 a failed Bash command draws its output lines in the body colour, and only its exit tag in the failure colour", async ($, on) => {
    await world($, on);

    const succeeded = await drawCall(
      $,
      "b16-ok",
      "Bash",
      { command: COMMAND },
      { output: bashOutput("some-out\nbad-thing"), isExpanded: true },
    );
    const failed = await drawCall(
      $,
      "b16",
      "Bash",
      { command: COMMAND },
      {
        output: `${FAILED_PREFIX}Exit code 3\nsome-out\nbad-thing`,
        isExpanded: true,
        isErrored: true,
      },
    );

    const bodyColour = textNodeContaining(succeeded, "bad-thing")?.props.color;
    expect(bodyColour).not.toBe(palette.failed);
    expect(textNodeContaining(failed, "some-out")?.props.color).toBe(bodyColour);
    expect(textNodeContaining(failed, "bad-thing")?.props.color).toBe(bodyColour);
    expect(textNode(failed, "exit 3")?.props.color).toBe(palette.failed);
  });

  test("TP18 at 60 columns a long path outside the project draws its title on one row, cut at the start, with its tag on the same row", async ($, on) => {
    await world($, on);

    const read = await drawResult($, "Read", readOutput(LONG_PATH, "a\nb\nc"), {
      columns: NARROW_COLUMNS,
    });
    const readTitle = textNode(read, LONG_PATH);
    const readTag = textNode(
      read,
      `lines ${READ_START}-${READ_START + READ_LINES - 1} of ${READ_TOTAL - 1}`,
    );
    expect(readTitle).toBeDefined();
    expect(readTitle?.props.wrap).toBe("truncate-start");
    expect(readTag).toBeDefined();
    expect(sameRow(read, readTitle!, readTag!)).toBe(true);

    const edit = await drawResult($, "Edit", editOutput(LONG_PATH, [hunk(1, ["-a", "+b"])]), {
      id: "e18",
      columns: NARROW_COLUMNS,
    });
    const editTitle = textNode(edit, LONG_PATH);
    const editTag = textNode(edit, "edited");
    expect(editTitle).toBeDefined();
    expect(editTitle?.props.wrap).toBe("truncate-start");
    expect(editTag).toBeDefined();
    expect(sameRow(edit, editTitle!, editTag!)).toBe(true);
  });
  test("TP19 a Read that stops before the end of a 509-line file shows its own range in the tag, and a whole read shows lines 1-509 of 509", async ($, on) => {
    await world($, on);
    const partialContent = rowRange(20, 40);
    const partial = await drawResult(
      $,
      "Read",
      readOutput(`${CWD}/hooks/big.ts`, partialContent, {
        startLine: 20,
        numLines: 21,
        totalLines: 510,
      }),
      { id: "r19-part" },
    );
    const whole = await drawResult(
      $,
      "Read",
      readOutput(`${CWD}/hooks/big.ts`, `${numberedRows(READ_BIG_ROWS)}\n`, {
        startLine: 1,
        numLines: 510,
        totalLines: 510,
      }),
      { id: "r19-whole" },
    );

    expect(textOf(partial)).toContain("lines 20-40 of 509");
    expect(textOf(whole)).toContain(`lines 1-${READ_BIG_ROWS} of ${READ_BIG_ROWS}`);
  });

  test("TP20 a Read with no tag draws its title to the full row, leaving one space before the right border", async ($, on) => {
    await world($, on);

    const tree = await drawResult(
      $,
      "Read",
      readOutput(`${CWD}/hooks/empty.ts`, "", { startLine: 1, numLines: 0, totalLines: 0 }),
    );

    const title = textNode(tree, "hooks/empty.ts");
    expect(title).toBeDefined();
    expect(trailingCellsOf(tree, title!)).toBe(1);
  });

  test("TP21 a Bash result in the background with no output draws its title and the in background tag, with no body and no rule row", async ($, on) => {
    await world($, on);
    const tree = await drawCall(
      $,
      "b21",
      "Bash",
      { command: COMMAND },
      { output: { ...bashOutput(""), backgroundTaskId: "task-21" }, isExpanded: true },
    );

    expect(textNode(tree, COMMAND)).toBeDefined();
    expect(textNode(tree, "in background")).toBeDefined();
    expect(textOf(tree)).not.toContain("no output");
    expect(collect(tree, "Box").some((box) => box.props.key === "header-rule")).toBe(false);
  });

  test("TP22 a Bash command the permission check refuses shows its chat card as Denied with ⊘ denied, both in the alert colour, and no Failed or failed", async ($, on) => {
    await world($, on, { [REFUSED_COMMAND]: REFUSED });
    await callBash($, REFUSED_COMMAND, "d22");

    const tree = await drawGroup($, [
      erroredCall("d22", "Bash", { command: REFUSED_COMMAND }, REFUSAL_REASON),
    ]);

    expect(textOf(tree)).toContain(DENIED_WORD);
    expect(textNode(tree, DENIED_WORD)?.props.color).toBe(palette.alert);
    expect(shownText(tree)).not.toMatch(/failed/i);
  });

  test("TP23 a Bash command that fails with no exit code and was not refused keeps its card as Failed in the failure colour, with its box tag failed", async ($, on) => {
    await world($, on, { [FAILED_COMMAND]: FAILED_RUN });
    await callBash($, FAILED_COMMAND, "f23");

    const tree = await drawGroup($, [
      erroredCall("f23", "Bash", { command: FAILED_COMMAND }, FAILED_OUTPUT),
    ]);

    expect(textNode(tree, FAILED_WORD)?.props.color).toBe(palette.failed);
    expect(textNode(tree, DENIED_WORD)).toBeUndefined();
  });

  test("TP24 a group of one refused and one failed Bash command shows its header as Failed, its refused box as ⊘ denied and its failed box as failed", async ($, on) => {
    await world($, on, { [REFUSED_COMMAND]: REFUSED, [FAILED_COMMAND]: FAILED_RUN });
    await callBash($, REFUSED_COMMAND, "m24-refused");
    await callBash($, FAILED_COMMAND, "m24-failed");

    const tree = await drawGroup($, [
      erroredCall("m24-refused", "Bash", { command: REFUSED_COMMAND }, REFUSAL_REASON),
      erroredCall("m24-failed", "Bash", { command: FAILED_COMMAND }, FAILED_OUTPUT),
    ]);

    expect(textNode(tree, FAILED_WORD)?.props.color).toBe(palette.failed);
    expect(textNode(tree, DENIED_WORD)).toBeUndefined();
  });

  test("TP25 a refused command's chat card, drawn again after 50 later commands, still says Denied and not Failed", async ($, on) => {
    await world($, on, { [REFUSED_COMMAND]: REFUSED });
    await callBash($, REFUSED_COMMAND, "d25");
    await callLaterCommands($, CALLS_KEPT);

    const tree = await drawGroup($, [
      erroredCall("d25", "Bash", { command: REFUSED_COMMAND }, REFUSAL_REASON),
    ]);

    expect(textOf(tree)).toContain(DENIED_WORD);
    expect(textNode(tree, DENIED_WORD)?.props.color).toBe(palette.alert);
    expect(textNode(tree, FAILED_WORD)).toBeUndefined();
  });

  test("TP26 a command the person refuses at the permission prompt shows its chat card as Denied with ⊘ denied, and no Failed or failed", async ($, on) => {
    await world($, on, { [REFUSED_COMMAND]: PERSON_PROMPT });
    await callBash($, REFUSED_COMMAND, "p26");

    const tree = await drawGroup($, [
      erroredCall("p26", "Bash", { command: REFUSED_COMMAND }, PERSON_REFUSAL_TEXT),
    ]);

    expect(textOf(tree)).toContain(DENIED_WORD);
    expect(textNode(tree, DENIED_WORD)?.props.color).toBe(palette.alert);
    expect(shownText(tree)).not.toMatch(/failed/i);
  });

  test("TP27 a refused Edit shows its chat card header as Denied and not Failed", async ($, on) => {
    await world($, on, { [REFUSED_EDIT]: REFUSED });
    await callTool($, { tool: "Edit", file_path: REFUSED_EDIT, tool_use_id: "e27" });

    const tree = await drawGroup($, [
      erroredCall("e27", "Edit", { file_path: REFUSED_EDIT }, REFUSAL_REASON),
    ]);

    expect(textOf(tree)).toContain(DENIED_WORD);
    expect(textNode(tree, DENIED_WORD)?.props.color).toBe(palette.alert);
    expect(textNode(tree, FAILED_WORD)).toBeUndefined();
  });

  test("TP28 a group of two refused Bash commands shows its header as Denied and both boxes as ⊘ denied", async ($, on) => {
    await world($, on, { [REFUSED_COMMAND]: REFUSED, [SECOND_REFUSED_COMMAND]: REFUSED });
    await callBash($, REFUSED_COMMAND, "m28-first");
    await callBash($, SECOND_REFUSED_COMMAND, "m28-second");

    const tree = await drawGroup($, [
      erroredCall("m28-first", "Bash", { command: REFUSED_COMMAND }, REFUSAL_REASON),
      erroredCall("m28-second", "Bash", { command: SECOND_REFUSED_COMMAND }, REFUSAL_REASON),
    ]);

    expect(textOf(tree)).toContain(DENIED_WORD);
    expect(textNode(tree, DENIED_WORD)?.props.color).toBe(palette.alert);
    expect(shownText(tree)).not.toMatch(/failed/i);
  });

  test("TP29 a refused Bash call's expanded result panel shows its box tag as ⊘ denied in the alert colour, and no failed", async ($, on) => {
    await world($, on, { [REFUSED_COMMAND]: REFUSED });
    await callBash($, REFUSED_COMMAND, "d29");

    const tree = await drawCall(
      $,
      "d29",
      "Bash",
      { command: REFUSED_COMMAND },
      { output: REFUSAL_REASON, isExpanded: true, isErrored: true },
    );

    expect(textNodeContaining(tree, "⊘ denied")?.props.color).toBe(palette.alert);
    expect(shownText(tree)).not.toMatch(/failed/i);
  });

  test("TP30 a refused Bash call drawn as one collapsed row says Denied in the alert colour, not Failed", async ($, on) => {
    await world($, on, { [REFUSED_COMMAND]: REFUSED });
    await callBash($, REFUSED_COMMAND, "d30");

    const tree = await drawCall(
      $,
      "d30",
      "Bash",
      { command: REFUSED_COMMAND },
      {
        output: REFUSAL_REASON,
        isErrored: true,
      },
    );

    expect(textOf(tree)).toContain(DENIED_WORD);
    expect(textNode(tree, DENIED_WORD)?.props.color).toBe(palette.alert);
    expect(textNode(tree, FAILED_WORD)).toBeUndefined();
  });

  test("B1 in the full transcript (ctrl+o) a finished Bash call shows its compact row and, under it, a panel titled with its command that holds its output", async ($, on) => {
    await world($, on);

    const tree = await drawCall(
      $,
      "b1",
      "Bash",
      { command: COMMAND },
      { output: bashOutput(CALL_OUTPUT), isExpanded: true },
    );

    const [panel] = windowsOf(tree);
    expect(panel).toBeDefined();
    expect(titleOf(panel!)).toContain(COMMAND);
    expect(shownText(tree)).toContain(CALL_OUTPUT);
    expect(textOf(tree)).toContain(RAN_ONE_COMMAND);
    expect(textOf(tree).indexOf(RAN_ONE_COMMAND)).toBeLessThan(textOf(tree).indexOf(COMMAND));
  });

  test("B2 in the full transcript (ctrl+o) a finished Bash call's result adds no second panel and no repeated output under the call", async ($, on) => {
    await world($, on);
    await drawCall(
      $,
      "b2",
      "Bash",
      { command: COMMAND },
      { output: bashOutput(CALL_OUTPUT), isExpanded: true },
    );

    const result = await drawResult($, "Bash", bashOutput(CALL_OUTPUT), { id: "b2" });

    expect(windowsOf(result)).toEqual([]);
    expect(textOf(result)).toBe("");
    expect(shownText(result)).not.toContain(CALL_OUTPUT);
  });

  test("B3 after a hot reload a Bash result drawn without its call draws no panel of its own, so no panel shows without its command", async ($, on) => {
    await world($, on);

    const result = await drawResult($, "Bash", bashOutput(CALL_OUTPUT), { id: "b3" });

    expect(windowsOf(result)).toEqual([]);
    expect(shownText(result)).not.toContain(CALL_OUTPUT);
  });

  test("B4 in the full transcript (ctrl+o) a Bash call still running shows its compact row and no panel", async ($, on) => {
    await world($, on);

    const tree = await drawCall($, "b4", "Bash", { command: COMMAND }, { isExpanded: true });

    expect(windowsOf(tree)).toEqual([]);
    expect(textOf(tree)).toContain(RAN_ONE_COMMAND);
  });

  test("B5 in the full transcript (ctrl+o) a Bash call that exited non-zero shows its command as the panel title and the exit code in the failure colour", async ($, on) => {
    await world($, on);

    const tree = await drawCall(
      $,
      "b5",
      "Bash",
      { command: COMMAND },
      {
        output: `${FAILED_PREFIX}Exit code 2\nboom happened`,
        isExpanded: true,
        isErrored: true,
      },
    );

    const [panel] = windowsOf(tree);
    expect(panel).toBeDefined();
    expect(titleOf(panel!)).toContain(COMMAND);
    expect(textNode(tree, "exit 2")?.props.color).toBe(palette.failed);
    expect(shownText(tree)).toContain("boom happened");
  });
});

function editOutput(filePath: string, structuredPatch: Hunk[]) {
  return { filePath, structuredPatch, originalFile: "", userModified: false, replaceAll: false };
}

function erroredCall(id: string, tool: string, input: unknown, output: string): GroupCall {
  return { tool_use_id: id, tool, input, output, isErrored: true };
}

function callBash($: Engine, command: string, id: string): Promise<unknown> {
  return callTool($, { tool: "Bash", command, tool_use_id: id });
}

function callTool($: Engine, call: Record<string, string>): Promise<unknown> {
  return $.tool.call(call as never);
}

async function callLaterCommands($: Engine, count: number): Promise<void> {
  for (let index = 1; index <= count; index++) await callBash($, LATER_COMMAND, `later-${index}`);
}

function scriptOf(scripts: Record<string, CallScript>, target: string): Required<CallScript> {
  const script = scripts[target];
  return { verdict: script?.verdict ?? ALLOW_VERDICT, outcome: script?.outcome ?? OK_OUTCOME };
}

function targetOf(input: unknown): string {
  if (typeof input !== "object" || input === null) return "";
  const { command, file_path: filePath } = input as CallTarget;
  const target = command ?? filePath;
  return typeof target === "string" ? target : "";
}

async function world($: Engine, on: On, scripts: Record<string, CallScript> = {}): Promise<void> {
  mock.clock(on);
  mock.env(on, { HOME });
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("agent.list", () => ({ value: [] }));
  on("config.list", () => ({ value: [] }));
  on("session.id", () => ({ value: "tool-panel-session" }));
  const stored = new Map<string, unknown>();
  on("store.get", (_$, e) => ({ value: stored.get(e.key) }));
  on("store.set", (_$, e) => {
    stored.set(e.key, e.value);
    return { value: undefined };
  });
  on("store.delete", (_$, e) => {
    stored.delete(e.key);
    return { value: undefined };
  });
  on("store.keys", () => ({ value: [...stored.keys()] }));
  on("process.run", () => ({ value: { exitCode: 1, stdout: "", stderr: "" } }) as never);
  on("tool.check", (_$, e) => scriptOf(scripts, targetOf(e.input)).verdict);
  on("tool.call", (_$, e) => scriptOf(scripts, targetOf(e)).outcome as never);
  on("session.model", () => ({ value: "claude-opus-5-5" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: CWD }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: CONTEXT_WINDOW }, rateLimits: [] },
  }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("command.register", () => ({ value: {} }) as never);
  on("ui.render", { component: "ToolResult" }, ($ui, e) => {
    const { Text } = $ui.ui.resolve(e);
    return <Text>{ENGINE_RESULT}</Text>;
  });
  on("ui.render", { component: "ToolUse" }, ($ui, e) => {
    const { Text } = $ui.ui.resolve(e);
    return <Text>{ENGINE_CALL}</Text>;
  });
  on("ui.render", { component: "ToolGroup" }, ($ui, e) => {
    const { Text } = $ui.ui.resolve(e);
    return <Text>{ENGINE_RESULT}</Text>;
  });
  await $.session.start(SESSION_START);
}

type ResultOptions = { id?: string; isErrored?: boolean; isExpanded?: boolean; columns?: number };

async function drawResult(
  $: Engine,
  tool: string,
  output: unknown,
  { id = `r-${tool}`, isErrored = false, isExpanded = true, columns = COLUMNS }: ResultOptions = {},
): Promise<Node> {
  const ui = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "ToolResult",
    props: {
      tool_use_id: id,
      tool,
      output,
      isErrored,
      isExpanded,
    },
    viewport: { columns, rows: ROWS },
  });
  return (await ui.drawn()) as unknown as Node;
}

type CallOptions = { output?: unknown; isExpanded?: boolean; isErrored?: boolean };

async function drawCall(
  $: Engine,
  id: string,
  tool: string,
  input: unknown,
  { output, isExpanded, isErrored = false }: CallOptions = {},
): Promise<Node> {
  const ui = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "ToolUse",
    props: {
      tool_use_id: id,
      tool,
      input,
      isRunning: false,
      isErrored,
      isInterrupted: false,
      ...(output === undefined ? {} : { output }),
      ...(isExpanded === undefined ? {} : { isExpanded }),
    },
    viewport: { columns: COLUMNS, rows: ROWS },
  });
  return (await ui.drawn()) as unknown as Node;
}

type GroupCall = {
  tool_use_id: string;
  tool: string;
  input: unknown;
  output: unknown;
  isErrored?: boolean;
};

async function drawGroup($: Engine, calls: GroupCall[], isExpanded = false): Promise<Node> {
  const ui = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "ToolGroup",
    props: {
      calls: calls.map((call) => ({
        isRunning: false,
        isErrored: false,
        isInterrupted: false,
        ...call,
      })),
      isActive: false,
      isExpanded,
    },
    viewport: { columns: COLUMNS, rows: ROWS },
  });
  return (await ui.drawn()) as unknown as Node;
}

function bashOutput(stdout: string, stderr = ""): Record<string, unknown> {
  return { stdout, stderr, interrupted: false };
}

type ReadRange = { startLine: number; numLines: number; totalLines: number };

function readOutput(
  filePath: string,
  content: string,
  range: ReadRange = { startLine: READ_START, numLines: READ_LINES, totalLines: READ_TOTAL },
) {
  return {
    type: "text",
    file: {
      filePath,
      content,
      numLines: range.numLines,
      startLine: range.startLine,
      totalLines: range.totalLines,
    },
  };
}

function lineName(index: number): string {
  return `out-${String(index).padStart(2, "0")}`;
}

function outputLines(count: number): string {
  return Array.from({ length: count }, (_, i) => lineName(i + 1)).join("\n");
}

function rowName(index: number): string {
  return `row-${String(index).padStart(3, "0")}`;
}

function rowRange(first: number, last: number): string {
  return Array.from({ length: last - first + 1 }, (_, i) => rowName(first + i)).join("\n");
}

function trailingCellsOf(tree: Node, title: Node): number {
  const header = collect(tree, "Box").find((box) => box.props.key === "header");
  expect(header).toBeDefined();
  return childrenOf(header!).reduce((cells, cell) => {
    const padding = numberOf(cell.props.paddingRight ?? cell.props.paddingX ?? cell.props.padding);
    const text = collect(cell, "Text").includes(title) ? 0 : textOf(cell).length;
    return cells + padding + text;
  }, 0);
}

function numberedRows(count: number): string {
  return Array.from({ length: count }, (_, i) => rowName(i + 1)).join("\n");
}

function numberOf(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function sameRow(tree: Node, first: Node, second: Node): boolean {
  return collect(tree, "Box").some(
    (box) =>
      box.props.flexDirection !== "column" &&
      collect(box, "Text").includes(first) &&
      collect(box, "Text").includes(second),
  );
}

function hunk(start: number, lines: string[]): Hunk {
  const added = lines.filter((line) => line.startsWith("+")).length;
  const removed = lines.filter((line) => line.startsWith("-")).length;
  const context = lines.length - added - removed;
  return {
    oldStart: start,
    oldLines: context + removed,
    newStart: start,
    newLines: context + added,
    lines,
  };
}

function windowsOf(tree: Node): Node[] {
  return collect(tree, "Box").filter((box) => box.props.borderStyle === "round");
}

function titleOf(window: Node): string {
  return textOf(childrenOf(window)[0]!);
}

function textNode(tree: Node, text: string): Node | undefined {
  return collect(tree, "Text").find((node) => textOf(node) === text);
}

function textNodeContaining(tree: Node, text: string): Node | undefined {
  return collect(tree, "Text").find((node) => textOf(node).includes(text));
}

function shownText(tree: Node): string {
  const sources = collect(tree, "Code").map((code) => {
    const source = code.props.source;
    return typeof source === "string" ? source : "";
  });
  return [textOf(tree), ...sources].join("\n");
}

function listOf(raw: unknown): unknown[] {
  if (raw === undefined || raw === null) return [];
  return Array.isArray(raw) ? raw.flat(Infinity) : [raw];
}

function childrenOf(node: Node): Node[] {
  return listOf(node.children).filter(
    (child): child is Node => typeof child === "object" && child !== null,
  );
}

function collect(node: Node, type: string): Node[] {
  const inner = childrenOf(node).flatMap((child) => collect(child, type));
  return node.type === type ? [node, ...inner] : inner;
}

function textOf(node: Node): string {
  return listOf(node.children)
    .map((child) => (typeof child === "object" ? textOf(child as Node) : (child as string)))
    .join("");
}
