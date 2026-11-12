import { describe, expect, test } from "claude-code/testing";
import type { Activity } from "../types";
import { callRecord } from "../hooks/activity-calls";

const LINE_CAP = 400;
const BELL = String.fromCharCode(7);
const ESCAPE = String.fromCharCode(27);

describe("the call record shown in the Activity tab", () => {
  test("CR1 a call that only had a command shows that command alone as its input", () => {
    const record = callRecord(
      { tool: "Bash", tool_use_id: "t1", command: "git status" },
      rowEntry(),
      { text: "" },
      undefined,
    );

    expect(record.input).toBe("git status");
  });

  test("CR2 a call with several fields shows one name: value line each, strings as written and other values as JSON", () => {
    const record = callRecord(
      { command: "ls", timeout: 5000, flags: ["-a", "-l"] },
      rowEntry(),
      { text: "" },
      undefined,
    );

    expect(record.input).toBe('command: ls\ntimeout: 5000\nflags: ["-a","-l"]');
  });

  test("CR3 the engine's own fields are not in the input", () => {
    const record = callRecord(
      {
        tool: "Grep",
        tool_use_id: "t1",
        agentId: "a1",
        pattern: "todo",
        path: "src",
      },
      rowEntry(),
      { text: "" },
      "a1",
    );

    expect(record.input).toBe("pattern: todo\npath: src");
  });

  test("CR4 a field set to nothing is not listed", () => {
    const record = callRecord(
      { command: "ls", cwd: undefined, timeout: 5000 },
      rowEntry(),
      { text: "" },
      undefined,
    );

    expect(record.input).toBe("command: ls\ntimeout: 5000");
  });

  test("CR5 a call with one field that is not text still shows the field name", () => {
    const record = callRecord({ timeout: 5000 }, rowEntry(), { text: "" }, undefined);

    expect(record.input).toBe("timeout: 5000");
  });

  test("CR6 a finished call that returned text shows that text as its output", () => {
    const record = callRecord({}, rowEntry(), { text: "3 files changed" }, undefined);

    expect(record.output).toBe("3 files changed");
  });

  test("CR7 a blocked call that also has text shows the block reason as its output", () => {
    const record = callRecord(
      {},
      rowEntry(),
      { deny: "not allowed here", text: "3 files changed" },
      undefined,
    );

    expect(record.output).toBe("not allowed here");
  });

  test("CR8 a call with text and a result shows the text as its output", () => {
    const record = callRecord(
      {},
      rowEntry(),
      { text: "3 files changed", result: { files: 3 } },
      undefined,
    );

    expect(record.output).toBe("3 files changed");
  });

  test("CR9 a call whose result is an object shows it as JSON indented by 2 spaces", () => {
    const record = callRecord({}, rowEntry(), { result: { files: 3, names: ["a"] } }, undefined);

    expect(record.output).toBe('{\n  "files": 3,\n  "names": [\n    "a"\n  ]\n}');
  });

  test("CR10 a call whose result is plain text shows the text itself, not in quotes", () => {
    const record = callRecord({}, rowEntry(), { result: "all done" }, undefined);

    expect(record.output).toBe("all done");
  });

  test("CR11 a call from a subagent carries its agent id and a main-session call carries none", () => {
    const fromAgent = callRecord({}, rowEntry(), { text: "" }, "agent-7");
    const fromMain = callRecord({}, rowEntry(), { text: "" }, undefined);

    expect(fromAgent.agentId).toBe("agent-7");
    expect(fromMain.agentId).toBeUndefined();
  });

  test("CR12 the record keeps the row's id, tool, target, run time, error flag and line counts", () => {
    const entry: Activity = {
      id: "t9",
      tool: "Edit",
      target: "src/a.ts",
      ms: 1234,
      isErrored: true,
      added: 7,
      removed: 2,
    };

    const record = callRecord({}, entry, { text: "" }, undefined);

    expect(record).toMatchObject(entry);
  });

  test("CR13 an output of exactly 400 lines is shown whole with no marker", () => {
    const output = numberedLines(LINE_CAP);

    const record = callRecord({}, rowEntry(), { text: output }, undefined);

    expect(record.output).toBe(output);
  });

  test("CR14 an output of 401 lines shows the first 400 and a last line saying 1 more", () => {
    const record = callRecord({}, rowEntry(), { text: numberedLines(LINE_CAP + 1) }, undefined);

    expect(record.output).toBe(`${numberedLines(LINE_CAP)}\n… 1 more lines`);
  });

  test("CR15 an output of 1000 lines shows the first 400 and a last line saying 600 more", () => {
    const record = callRecord({}, rowEntry(), { text: numberedLines(1000) }, undefined);

    expect(record.output).toBe(`${numberedLines(LINE_CAP)}\n… 600 more lines`);
  });

  test("CR16 an input of 401 lines is cut the same way as an output", () => {
    const record = callRecord(
      { command: numberedLines(LINE_CAP + 1) },
      rowEntry(),
      { text: "" },
      undefined,
    );

    expect(record.input).toBe(`${numberedLines(LINE_CAP)}\n… 1 more lines`);
  });

  test("CR17 a call with no result and no text has an empty output", () => {
    const record = callRecord({}, rowEntry(), {}, undefined);

    expect(record.output).toBe("");
  });

  test("CR18 control characters a tool returns are not in the shown input or output", () => {
    const record = callRecord(
      { command: `echo ${BELL}hi` },
      rowEntry(),
      { text: `${ESCAPE}[31mred${BELL}` },
      undefined,
    );

    expect(record.input).toBe("echo hi");
    expect(record.output).toBe("red");
  });

  test("CR19 a successful Bash keeps its command, stdout and stderr apart, with exit code 0", () => {
    const record = callRecord(
      { tool: "Bash", tool_use_id: "t1", command: "git status" },
      rowEntry(),
      { result: { stdout: "On branch main", stderr: "warning: x", interrupted: false } },
      undefined,
    );

    expect(record.detail).toEqual({
      kind: "bash",
      command: "git status",
      stdout: "On branch main",
      stderr: "warning: x",
      exitCode: 0,
      tag: "",
      droppedLines: 0,
    });
  });

  test("CR20 a failed Bash keeps exit code 3 and the rest as stderr; an error without that line keeps no exit code and the whole text", () => {
    const failed = callRecord(
      { tool: "Bash", tool_use_id: "t2", command: "ls /nonexistent-gh70" },
      rowEntry(),
      {
        isError: true,
        text: "Exit code 3\nout-line\nls: /nonexistent-gh70: No such file or directory",
      },
      undefined,
    );
    const bare = callRecord(
      { tool: "Bash", tool_use_id: "t3", command: "make" },
      rowEntry(),
      { isError: true, text: "make: *** no rule\nstop" },
      undefined,
    );

    expect(failed.detail).toEqual({
      kind: "bash",
      command: "ls /nonexistent-gh70",
      stdout: "",
      stderr: "out-line\nls: /nonexistent-gh70: No such file or directory",
      exitCode: 3,
      tag: "",
      droppedLines: 0,
    });
    expect(bare.detail).toEqual({
      kind: "bash",
      command: "make",
      stdout: "",
      stderr: "make: *** no rule\nstop",
      exitCode: null,
      tag: "",
      droppedLines: 0,
    });
  });

  test("CR21 a Bash with a return-code note, an interrupted Bash and a background Bash each keep their tag, with no exit code", () => {
    const noted = callRecord(
      { tool: "Bash", tool_use_id: "t4", command: "grep todo src" },
      rowEntry(),
      {
        result: {
          stdout: "",
          stderr: "",
          interrupted: false,
          returnCodeInterpretation: "No matches found",
        },
      },
      undefined,
    );
    const interrupted = callRecord(
      { tool: "Bash", tool_use_id: "t5", command: "make build" },
      rowEntry(),
      { result: { stdout: "partial", stderr: "", interrupted: true } },
      undefined,
    );
    const background = callRecord(
      { tool: "Bash", tool_use_id: "t6", command: "npm run dev" },
      rowEntry(),
      { result: { stdout: "", stderr: "", interrupted: false, backgroundTaskId: "bg-1" } },
      undefined,
    );

    expect(noted.detail).toEqual({
      kind: "bash",
      command: "grep todo src",
      stdout: "",
      stderr: "",
      exitCode: null,
      tag: "No matches found",
      droppedLines: 0,
    });
    expect(interrupted.detail).toEqual({
      kind: "bash",
      command: "make build",
      stdout: "partial",
      stderr: "",
      exitCode: null,
      tag: "interrupted",
      droppedLines: 0,
    });
    expect(background.detail).toEqual({
      kind: "bash",
      command: "npm run dev",
      stdout: "",
      stderr: "",
      exitCode: null,
      tag: "in background",
      droppedLines: 0,
    });
  });

  test("CR22 an Edit keeps its path and hunks; a Write that creates a file is marked new and keeps its content", () => {
    const editHunk = { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-a", "+b"] };
    const createHunk = {
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 1,
      lines: ["+export const x = 1"],
    };
    const edit = callRecord(
      { tool: "Edit", tool_use_id: "t7", file_path: "/p/a.ts", old_string: "a", new_string: "b" },
      rowEntry(),
      {
        result: {
          filePath: "/p/a.ts",
          oldString: "a",
          newString: "b",
          originalFile: "a",
          structuredPatch: [editHunk],
          userModified: false,
          replaceAll: false,
        },
      },
      undefined,
    );
    const created = callRecord(
      { tool: "Write", tool_use_id: "t8", file_path: "/p/new.ts", content: "export const x = 1" },
      rowEntry(),
      {
        result: {
          type: "create",
          filePath: "/p/new.ts",
          content: "export const x = 1",
          structuredPatch: [createHunk],
          originalFile: null,
        },
      },
      undefined,
    );

    expect(edit.detail).toEqual({
      kind: "change",
      filePath: "/p/a.ts",
      isCreate: false,
      hunks: [editHunk],
      content: "",
    });
    expect(created.detail).toEqual({
      kind: "change",
      filePath: "/p/new.ts",
      isCreate: true,
      hunks: [createHunk],
      content: "export const x = 1",
    });
  });

  test("CR23 a text Read keeps its path, the first 400 lines of content, the start line and the total line count", () => {
    const record = callRecord(
      { tool: "Read", tool_use_id: "t9", file_path: "/p/big.ts" },
      rowEntry(),
      {
        result: {
          type: "text",
          file: {
            filePath: "/p/big.ts",
            content: numberedLines(LINE_CAP + 100),
            numLines: LINE_CAP + 100,
            startLine: 50,
            totalLines: 1000,
          },
        },
      },
      undefined,
    );

    expect(record.detail).toEqual({
      kind: "read",
      filePath: "/p/big.ts",
      content: numberedLines(LINE_CAP),
      numLines: LINE_CAP + 100,
      startLine: 50,
      totalLines: 999,
    });
  });

  test("CR25 a Bash with 1000 stdout lines keeps 400 lines with no marker line and says 600 were not kept", () => {
    const record = callRecord(
      { tool: "Bash", tool_use_id: "t7", command: "seq 1000" },
      rowEntry(),
      { result: { stdout: numberedLines(1000), stderr: "", interrupted: false } },
      undefined,
    );

    const detail = record.detail as unknown as { stdout: string; droppedLines: number };
    const kept = detail.stdout.split("\n");
    expect(kept).toHaveLength(LINE_CAP);
    expect(kept.filter((line) => line.startsWith("… "))).toEqual([]);
    expect(detail.droppedLines).toBe(1000 - LINE_CAP);
  });

  test("CR24 a blocked Bash, a Bash whose result is plain text and an image Read keep no call detail", () => {
    const blocked = callRecord(
      { tool: "Bash", tool_use_id: "t10", command: "rm -rf /" },
      rowEntry(),
      { deny: "not allowed here" },
      undefined,
    );
    const plain = callRecord(
      { tool: "Bash", tool_use_id: "t11", command: "echo hi" },
      rowEntry(),
      { result: "hi" },
      undefined,
    );
    const image = callRecord(
      { tool: "Read", tool_use_id: "t12", file_path: "/p/shot.png" },
      rowEntry(),
      {
        result: {
          type: "image",
          file: { base64: "AAAA", type: "image/png", originalSize: 4 },
        },
      },
      undefined,
    );

    expect(blocked).not.toHaveProperty("detail");
    expect(plain).not.toHaveProperty("detail");
    expect(image).not.toHaveProperty("detail");
  });
});

function rowEntry(): Activity {
  return { id: "t1", tool: "Bash", target: "x", ms: 0, isErrored: false, added: 0, removed: 0 };
}

function numberedLines(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");
}
