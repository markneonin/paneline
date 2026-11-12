import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { inkFor } from "../hooks/pane-ink";
import { fillsFor, palette } from "../hooks/palette";
import { ENGINE_DEFAULT_GREY, accentOf } from "../hooks/session-color";
import { childrenOf, collect, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import { feedSession } from "./session-feed";
import type { SessionFeed } from "./session-feed";

type Pane = Mounted<"terminal", "Pane">;
type Outcome = Record<string, unknown>;
type Hunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
};

const COLUMNS = 80;
const PANE_ROWS = 40;
const NARROW_COLUMNS = 60;
const CHROME_ROWS = 9;
const FOLD_ROOM = PANE_ROWS - CHROME_ROWS;
const LONG_OUTPUT = 200;
const SHORT_PANE_ROWS = 20;
const WIDE_LINES = 10;
const KEPT_LINES = 400;
const DROPPED = 600;
const HIDDEN_AFTER_FOLD = LONG_OUTPUT - FOLD_ROOM;
const CWD = "/work";
const BODY_INDENT = 2;
const FAILED_BASH_TEXT = "Exit code 3\nout-line\nls: /nonexistent-gh70: No such file or directory";
const RED = accentOf("red");
const PATH_TEXT = /src\/a\.ts|lib\/b\.py/;
const CR_SYMBOL = "␍";
const THEMES = ["dark", "light", "dark-ansi"];

describe("call detail views", () => {
  test("D1 a Bash call shows its command as the panel title and exit 0 in the ok colour, with no separate command block", async ($, on) => {
    worldOf(on, { b1: bashOk("first\nsecond") });
    await $.tool.call({ tool: "Bash", command: "ls -la", tool_use_id: "b1" } as never);

    const root = await openedDetail($, "b1");

    const title = lineOf(root, "ls -la");
    expect(title?.props?.color).toBe(palette.text);
    expect(title?.props?.weight).toBe("semibold");
    expect(lineOf(root, "exit 0")?.props?.color).toBe(palette.ok);
    expect(lineOf(root, "first")?.props?.color).toBe(palette.text);
    expect(collect(root, "Code")).toEqual([]);
  });

  test("D1b a Bash call with no output shows no output in the muted colour", async ($, on) => {
    worldOf(on, { b1: bashOk("") });
    await $.tool.call({ tool: "Bash", command: "true", tool_use_id: "b1" } as never);

    const root = await openedDetail($, "b1");

    expect(lineOf(root, "no output")?.props?.color).toBe(palette.muted);
    expect(lineOf(root, "exit 0")?.props?.color).toBe(palette.ok);
  });

  test("D2 a failed Bash call shows exit 3 and its error lines in the failed colour with no output label row", async ($, on) => {
    worldOf(on, { b1: { isError: true, result: FAILED_BASH_TEXT, text: FAILED_BASH_TEXT } });
    await $.tool.call({
      tool: "Bash",
      command: "ls /nonexistent-gh70",
      tool_use_id: "b1",
    } as never);

    const root = await openedDetail($, "b1");

    expect(lineOf(root, "exit 3")?.props?.color).toBe(palette.failed);
    expect(lineOf(root, "output")).toBeUndefined();
    expect(lineOf(root, "stderr")).toBeUndefined();
    expect(lineOf(root, "out-line")?.props?.color).toBe(palette.failed);
    expect(lineOf(root, "ls: /nonexistent-gh70: No such file or directory")?.props?.color).toBe(
      palette.failed,
    );
  });

  test("D3 a successful Bash with warnings shows stdout in the text colour and stderr apart in the failed colour", async ($, on) => {
    worldOf(on, { b1: bashOk("built ok", "warning: deprecated flag") });
    await $.tool.call({ tool: "Bash", command: "make", tool_use_id: "b1" } as never);

    const root = await openedDetail($, "b1");

    expect(lineOf(root, "built ok")?.props?.color).toBe(palette.text);
    expect(lineOf(root, "stderr")?.props?.color).toBe(palette.muted);
    expect(lineOf(root, "warning: deprecated flag")?.props?.color).toBe(palette.failed);
    expect(lineOf(root, "exit 0")?.props?.color).toBe(palette.ok);
  });

  test("D4 an interrupted run shows interrupted in the failed colour", async ($, on) => {
    worldOf(on, { b1: bashOk("partial", "", { interrupted: true }) });
    await $.tool.call({ tool: "Bash", command: "sleep 99", tool_use_id: "b1" } as never);

    const root = await openedDetail($, "b1");

    expect(lineOf(root, "interrupted")?.props?.color).toBe(palette.failed);
    expect(lineOf(root, "exit 0")).toBeUndefined();
  });

  test("D4b a run with a note from the shell shows that note muted", async ($, on) => {
    worldOf(on, { b1: bashOk("", "", { returnCodeInterpretation: "No matches found" }) });
    await $.tool.call({ tool: "Bash", command: "grep zzz a", tool_use_id: "b1" } as never);

    const root = await openedDetail($, "b1");

    expect(lineOf(root, "No matches found")?.props?.color).toBe(palette.muted);
  });

  test("D4c a background run shows in background muted", async ($, on) => {
    worldOf(on, { b1: bashOk("", "", { backgroundTaskId: "task-1" }) });
    await $.tool.call({ tool: "Bash", command: "npm run dev", tool_use_id: "b1" } as never);

    const root = await openedDetail($, "b1");

    expect(lineOf(root, "in background")?.props?.color).toBe(palette.muted);
  });

  test("D5 a 300-character command keeps its start on the title row and the whole command as bash Code in the body", async ($, on) => {
    const command = `echo ${"x".repeat(295)}`;
    worldOf(on, { b1: bashOk("done") });
    await $.tool.call({ tool: "Bash", command, tool_use_id: "b1" } as never);

    const root = await openedDetail($, "b1");

    const title = leavesOf(root).find((leaf) => textOf(leaf).startsWith("echo xxxx"));
    expect(title?.props?.weight).toBe("semibold");
    expect(textOf(title!).length).toBeLessThan(command.length);
    expect(textOf(title!).endsWith("…")).toBe(true);
    const [code, ...others] = collect(root, "Code");
    expect(others).toEqual([]);
    expect(code?.props?.language).toBe("bash");
    expect(code?.props?.source).toBe(command);
  });

  test("D5b a three-line command keeps its first line on the title row and the whole command as bash Code in the body", async ($, on) => {
    const command = "git add .\ngit commit -m fix\ngit push";
    worldOf(on, { b1: bashOk("done") });
    await $.tool.call({ tool: "Bash", command, tool_use_id: "b1" } as never);

    const root = await openedDetail($, "b1");

    expect(lineStarting(root, "git add .")?.props?.weight).toBe("semibold");
    const [code, ...others] = collect(root, "Code");
    expect(others).toEqual([]);
    expect(code?.props?.language).toBe("bash");
    expect(code?.props?.source).toBe(command);
  });

  test("D6 a Read of a.py from line 120 shows one Code element with that path, text and start line, and the muted lines tag", async ($, on) => {
    const content = "def f():\n    return 1";
    worldOf(on, { r1: readOk("/work/a.py", content, 120, 400) });
    await $.tool.call({ tool: "Read", file_path: "/work/a.py", tool_use_id: "r1" } as never);

    const root = await openedDetail($, "r1");

    const codes = collect(root, "Code");
    expect(codes).toHaveLength(1);
    expect(codes[0]?.props?.path).toBe("/work/a.py");
    expect(codes[0]?.props?.source).toBe(content);
    expect(codes[0]?.props?.startLine).toBe(120);
    expect(lineOf(root, "a.py")?.props?.weight).toBe("semibold");
    expect(lineOf(root, "lines 120-121 of 399")?.props?.color).toBe(palette.muted);
  });

  test("D6b an empty file shows empty file muted and no Code element", async ($, on) => {
    worldOf(on, { r1: readOk("/work/empty.py", "", 1, 0) });
    await $.tool.call({ tool: "Read", file_path: "/work/empty.py", tool_use_id: "r1" } as never);

    const root = await openedDetail($, "r1");

    expect(lineOf(root, "empty file")?.props?.color).toBe(palette.muted);
    expect(collect(root, "Code")).toEqual([]);
  });

  test("D7 an Edit call shows the chat's diff window with path title, edited +2 -1, the hunks as diff Code, no margins and the pane width", async ($, on) => {
    const hunks = [hunk(1, ["-old", "+new1", "+new2"])];
    worldOf(on, { e1: editOk("/work/src/a.ts", hunks) });
    await $.tool.call({ tool: "Edit", file_path: "/work/src/a.ts", tool_use_id: "e1" } as never);

    const root = await openedDetail($, "e1");

    const window = collect(root, "Box").find((box) => box.props?.borderStyle === "round");
    expect(window?.props?.marginTop).toBeUndefined();
    expect(window?.props?.marginLeft).toBeUndefined();
    expect(window?.props?.width).toBe(root.props?.width);
    const text = textOf(window!);
    expect(text).toContain("src/a.ts");
    expect(text).toContain("edited");
    expect(text).toContain("+2");
    expect(text).toContain("-1");
    const code = collect(window!, "Code")[0];
    expect(code?.props?.format).toBe("diff");
    expect(code?.props?.path).toBe("/work/src/a.ts");
    expect(code?.props?.source).toBe("@@ -1,1 +1,2 @@\n-old\n+new1\n+new2");
  });

  test("D32 an Edit of a CRLF file shows its changed line as plain text and no ␍ is drawn", async ($, on) => {
    worldOf(on, { crlf32: editOk("/work/src/a.ts", [hunk(1, ["-old\r", "+changed\r"])]) });
    await $.tool.call({
      tool: "Edit",
      file_path: "/work/src/a.ts",
      tool_use_id: "crlf32",
    } as never);

    const root = await openedDetail($, "crlf32");

    expect(sourceOf(root)).toContain("+changed");
    expect(sourceOf(root)).not.toContain(CR_SYMBOL);
  });

  test("D8 an Agent result draws its heading without the hash and its list as items", async ($, on) => {
    const reply = "# Found\n- one\n- two";
    worldOf(on, { a1: { result: reply, text: reply } });
    await $.tool.call({ tool: "Agent", description: "look around", tool_use_id: "a1" } as never);

    const root = await openedDetail($, "a1");

    const text = textOf(root);
    expect(text).not.toContain("# Found");
    expect(text).not.toContain("- one");
    expect(leavesOf(root).map(textOf)).toContain("Found");
    expect(text).toContain("• one");
    expect(text).toContain("• two");
  });

  test("D8b an MCP tool result with a markdown table draws a table, not raw pipes", async ($, on) => {
    const table = "| name | size |\n|---|---|\n| a | 1 |\n| b | 2 |";
    worldOf(on, { m1: { result: table, text: table } });
    await $.tool.call({ tool: "mcp__files__list", path: "/work", tool_use_id: "m1" } as never);

    const root = await openedDetail($, "m1");

    const text = textOf(root);
    expect(text).toContain("┌");
    expect(text).not.toContain("|---");
  });

  test("D9 an unknown tool shows its Input as key rows in the muted colour and its Output as text", async ($, on) => {
    worldOf(on, { g1: { result: "src/a.ts:1: needle", text: "src/a.ts:1: needle" } });
    await $.tool.call({
      tool: "Grep",
      pattern: "needle",
      path: "src",
      tool_use_id: "g1",
    } as never);

    const root = await openedDetail($, "g1");

    expect(lineOf(root, "Input")).toBeDefined();
    expect(lineOf(root, "Output")).toBeDefined();
    expect(lineOf(root, "pattern")?.props?.color).toBe(palette.muted);
    expect(lineOf(root, "needle")?.props?.color).toBe(palette.text);
    expect(textOf(root)).toContain("src/a.ts:1: needle");
  });

  test("P18 an Activity call output that names a file path draws no button for that path", async ($, on) => {
    const reply = "Edited `src/a.ts` and lib/b.py.";
    worldOf(on, { a18: { result: reply, text: reply } });
    await $.tool.call({ tool: "Agent", description: "edit", tool_use_id: "a18" } as never);

    const root = await openedDetail($, "a18");

    expect(textOf(root)).toContain("src/a.ts");
    expect(collect(root, "Button").filter((button) => PATH_TEXT.test(textOf(button)))).toEqual([]);
  });
});

describe("Markdown output for every text tool", () => {
  const FETCH_REPLY =
    "**Target:** the page\n\n# Overview\n\n- first item\n- second item\n\n|a|b|\n|---|---|\n|1|2|";

  test("M1 a WebFetch output draws bold, heading, list and table with no raw Markdown marks", async ($, on) => {
    worldOf(on, { w1: { result: FETCH_REPLY, text: FETCH_REPLY } });
    await $.tool.call({ tool: "WebFetch", url: "https://x.test", tool_use_id: "w1" } as never);

    const root = await openedDetail($, "w1");

    const text = textOf(root);
    expect(text).not.toContain("**");
    expect(text).not.toContain("# Overview");
    expect(text).not.toContain("|---");
    expect(text).toContain("┌");
    expect(text).toContain("• first item");
    expect(leavesOf(root).map(textOf)).toContain("Target:");
  });

  for (const tool of ["WebSearch", "Skill", "SomeNewTool"]) {
    test(`M2 a ${tool} output goes through Markdown too`, async ($, on) => {
      worldOf(on, { t1: { result: "**bold** word", text: "**bold** word" } });
      await $.tool.call({ tool, tool_use_id: "t1" } as never);

      const root = await openedDetail($, "t1");

      expect(textOf(root)).not.toContain("**");
      expect(leavesOf(root).map(textOf)).toContain("bold");
    });
  }

  test("M3 a JSON string output shows as a json code block with its keys visible", async ($, on) => {
    worldOf(on, { j1: { result: '{"a":1}', text: '{"a":1}' } });
    await $.tool.call({ tool: "WebFetch", url: "https://x.test", tool_use_id: "j1" } as never);

    const root = await openedDetail($, "j1");

    const blocks = collect(root, "Code");
    expect(blocks.map((block) => block.props?.language)).toEqual(["json"]);
    expect(String(blocks[0]?.props?.source)).toBe('{\n  "a": 1\n}');
  });

  test("M4 an object result shows as a json code block", async ($, on) => {
    worldOf(on, { j2: { result: { rows: [1, 2], key: "v" } } });
    await $.tool.call({ tool: "TaskOutput", task_id: "t", tool_use_id: "j2" } as never);

    const root = await openedDetail($, "j2");

    const blocks = collect(root, "Code");
    expect(blocks.map((block) => block.props?.language)).toEqual(["json"]);
    expect(String(blocks[0]?.props?.source)).toContain('"rows"');
  });

  test("M5 an output that only starts like JSON stays Markdown text", async ($, on) => {
    worldOf(on, { j3: { result: "[note] **bold**", text: "[note] **bold**" } });
    await $.tool.call({ tool: "WebFetch", url: "https://x.test", tool_use_id: "j3" } as never);

    const root = await openedDetail($, "j3");

    expect(collect(root, "Code")).toEqual([]);
    expect(textOf(root)).not.toContain("**");
  });

  test("M6 each input field is one row with its key muted, and a wrapped value starts at the value column", async ($, on) => {
    const long = "word ".repeat(40).trim();
    worldOf(on, { f1: { result: "ok", text: "ok" } });
    await $.tool.call({
      tool: "WebFetch",
      url: long,
      prompt: "line one\nnote: not a key",
      tool_use_id: "f1",
    } as never);

    const root = await openedDetail($, "f1");

    expect(lineOf(root, "url")?.props?.color).toBe(palette.muted);
    expect(lineOf(root, "prompt")?.props?.color).toBe(palette.muted);
    expect(lineOf(root, "line one")?.props?.color).toBe(palette.text);
    expect(lineOf(root, "note: not a key")?.props?.color).toBe(palette.text);
    const valueLeaf = lineOf(root, "line one");
    if (valueLeaf === undefined) throw new Error("rows not drawn");
    const valueColumn = pathTo(root, valueLeaf)?.findLast((node) => node.type === "Box");
    expect(textOf(valueColumn as Node)).toContain("note: not a key");
    expect(textOf(valueColumn as Node)).not.toContain("prompt");
  });

  test("M10 a multi-line Grep output draws one row per line", async ($, on) => {
    const out = "src/a.ts:1: needle\nsrc/b.ts:7: needle two\nsrc/c.ts:9: needle three";
    worldOf(on, { g2: { result: out, text: out } });
    await $.tool.call({ tool: "Grep", pattern: "needle", tool_use_id: "g2" } as never);

    const root = await openedDetail($, "g2");

    const rows = leavesOf(root).map((leaf) => textOf(leaf).trim());
    expect(rows).toContain("src/a.ts:1: needle");
    expect(rows).toContain("src/b.ts:7: needle two");
    expect(rows).toContain("src/c.ts:9: needle three");
  });

  test("M11 a Glob output draws one row per file", async ($, on) => {
    const out = "src/a.ts\nsrc/b.ts\nsrc/c.ts";
    worldOf(on, { g3: { result: out, text: out } });
    await $.tool.call({ tool: "Glob", pattern: "src/*.ts", tool_use_id: "g3" } as never);

    const root = await openedDetail($, "g3");

    const rows = leavesOf(root).map((leaf) => textOf(leaf).trim());
    expect(rows).toEqual(expect.arrayContaining(["src/a.ts", "src/b.ts", "src/c.ts"]));
  });

  test("M12 a Grep context separator line draws no heading", async ($, on) => {
    const out = "src/a.ts:1: needle\n--\nsrc/b.ts:7: needle two";
    worldOf(on, { g4: { result: out, text: out } });
    await $.tool.call({ tool: "Grep", pattern: "needle", tool_use_id: "g4" } as never);

    const root = await openedDetail($, "g4");

    const rows = leavesOf(root).map((leaf) => textOf(leaf).trim());
    expect(rows).toContain("src/a.ts:1: needle");
    expect(rows).toContain("--");
    expect(textOf(root)).not.toContain("━");
  });

  test("M13 an Agent output with a soft line break still joins into one line", async ($, on) => {
    const out = "first part\nsecond part";
    worldOf(on, { a13: { result: out, text: out } });
    await $.tool.call({ tool: "Agent", description: "look", tool_use_id: "a13" } as never);

    const root = await openedDetail($, "a13");

    expect(leavesOf(root).map((leaf) => textOf(leaf).trim())).toContain("first part second part");
  });

  test("M7 a one-field string input still shows its key", async ($, on) => {
    worldOf(on, { s1: { result: "ok", text: "ok" } });
    await $.tool.call({ tool: "WebSearch", query: "paneline", tool_use_id: "s1" } as never);

    const root = await openedDetail($, "s1");

    expect(lineOf(root, "query")?.props?.color).toBe(palette.muted);
    expect(lineOf(root, "paneline")?.props?.color).toBe(palette.text);
  });

  test("M8 a record saved before structured fields existed still draws its input text", async ($, on) => {
    const feed = worldOf(on, {});
    feed.hold({
      tool_use_id: "old1",
      tool: "WebFetch",
      input: { url: "https://x.test" },
      text: "done",
    });
    on("state.get", (_$, e, next) =>
      e.key === "calls"
        ? {
            value: {
              value: {
                shape: "calls-slim",
                value: [{ id: "old1", tool: "WebFetch", target: "https://x.test", at: 1, ms: 5 }],
              },
              version: 1,
            },
          }
        : next(e),
    );

    const root = await openedDetail($, "old1");

    expect(lineOf(root, "https://x.test")?.props?.color).toBe(palette.text);
    expect(textOf(root)).toContain("done");
  });

  test("M9 a long WebFetch output folds with the hidden-lines button, and pressing it shows all", async ($, on) => {
    const reply = numbered(LONG_OUTPUT, "- item").replaceAll("- item ", "- item no");
    worldOf(on, { w2: { result: reply, text: reply } });
    await $.tool.call({ tool: "WebFetch", url: "https://x.test", tool_use_id: "w2" } as never);
    const pane = await mountPane($);
    await pane.press({ key: "call-w2" });

    const folded = await detailOf(pane);

    expect(textOf(folded)).not.toContain(`item no${LONG_OUTPUT - 1}`);
    expect(hiddenCount(folded)).toBeGreaterThan(0);
    await pressUnfold(pane);
    expect(textOf(await detailOf(pane))).toContain(`item no${LONG_OUTPUT - 1}`);
  });
});

describe("folding long details", () => {
  test("D10 a Bash call with 200 output lines shows the hidden count, and pressing it shows all 200 lines and no button", async ($, on) => {
    worldOf(on, { b1: bashOk(numbered(LONG_OUTPUT, "out")) });
    await $.tool.call({ tool: "Bash", command: "seq 200", tool_use_id: "b1" } as never);
    const pane = await mountPane($);
    await pane.press({ key: "call-b1" });

    const folded = await detailOf(pane);

    expect(moreButton(folded)?.props?.label).toBe(`▸ ${HIDDEN_AFTER_FOLD} more lines`);
    expect(lineOf(folded, "out 199")).toBeUndefined();
    await pressUnfold(pane);
    const unfolded = await detailOf(pane);
    expect(lineOf(unfolded, "out 199")).toBeDefined();
    expect(lineOf(unfolded, "out 0")).toBeDefined();
    expect(moreButton(unfolded)).toBeUndefined();
  });

  test("D11 an Edit of 200 changed lines cuts the diff to the room with the fold button, and pressing it shows every line", async ($, on) => {
    const added = Array.from({ length: LONG_OUTPUT }, (_, i) => `+row ${i}`);
    worldOf(on, { e1: editOk("/work/big.ts", [hunk(1, added)]) });
    await $.tool.call({ tool: "Edit", file_path: "/work/big.ts", tool_use_id: "e1" } as never);
    const pane = await mountPane($);
    await pane.press({ key: "call-e1" });

    const folded = await detailOf(pane);

    expect(diffBody(folded)).toHaveLength(FOLD_ROOM);
    expect(moreButton(folded)?.props?.label).toBe(`▸ ${HIDDEN_AFTER_FOLD} more lines`);
    expect(textOf(folded)).not.toContain("… +");
    await pressUnfold(pane);
    const unfolded = await detailOf(pane);
    expect(diffBody(unfolded)).toEqual(added);
    expect(moreButton(unfolded)).toBeUndefined();
  });

  test("D12 after unfolding one call, opening another long call shows it folded", async ($, on) => {
    worldOf(on, {
      b1: bashOk(numbered(LONG_OUTPUT, "first")),
      b2: bashOk(numbered(LONG_OUTPUT, "second")),
    });
    await $.tool.call({ tool: "Bash", command: "seq 200", tool_use_id: "b1" } as never);
    await $.tool.call({ tool: "Bash", command: "seq 200", tool_use_id: "b2" } as never);
    const pane = await mountPane($);
    await pane.press({ key: "call-b1" });
    await pressUnfold(pane);
    await pane.press({ key: "back" });

    await pane.press({ key: "call-b2" });

    const second = await detailOf(pane);
    expect(moreButton(second)?.props?.label).toBe(`▸ ${HIDDEN_AFTER_FOLD} more lines`);
    expect(lineOf(second, "second 199")).toBeUndefined();
  });
});

describe("folding follows what is drawn", () => {
  test("D14 the same long Bash output folds at a different place when the pane is shorter", async ($, on) => {
    worldOf(on, { b1: bashOk(numbered(LONG_OUTPUT, "out")) });
    await $.tool.call({ tool: "Bash", command: "seq 200", tool_use_id: "b1" } as never);
    const tall = await mountPane($, PANE_ROWS);
    await tall.press({ key: "call-b1" });
    const tallRoot = await detailOf(tall);
    await tall.unmount();
    const short = await mountPane($, SHORT_PANE_ROWS);
    const shortRoot = await detailOf(short);

    expect(hiddenCount(shortRoot)).toBeGreaterThan(hiddenCount(tallRoot));
    expect(hiddenCount(tallRoot)).toBeGreaterThan(0);
    expect(shownCount(tallRoot, "out") + hiddenCount(tallRoot)).toBe(LONG_OUTPUT);
    expect(shownCount(shortRoot, "out") + hiddenCount(shortRoot)).toBe(LONG_OUTPUT);
    expect(shownCount(tallRoot, "out")).toBeLessThanOrEqual(PANE_ROWS);
    expect(shownCount(shortRoot, "out")).toBeLessThanOrEqual(SHORT_PANE_ROWS);
  });

  test("D15 a Read longer than the pane folds, and pressing the button shows the whole file", async ($, on) => {
    const content = numbered(LONG_OUTPUT, "code");
    worldOf(on, { r1: readOk("/work/long.py", content, 1, LONG_OUTPUT) });
    await $.tool.call({ tool: "Read", file_path: "/work/long.py", tool_use_id: "r1" } as never);
    const pane = await mountPane($);
    await pane.press({ key: "call-r1" });

    const folded = await detailOf(pane);

    const shown = sourceOf(folded).split("\n").length;
    expect(shown).toBeLessThan(LONG_OUTPUT);
    expect(shown).toBeLessThanOrEqual(PANE_ROWS);
    expect(hiddenCount(folded)).toBe(LONG_OUTPUT - shown);
    await pressUnfold(pane);
    const unfolded = await detailOf(pane);
    expect(sourceOf(unfolded)).toBe(content);
    expect(moreButton(unfolded)).toBeUndefined();
  });

  test("D16 an Agent markdown result longer than the pane folds, and pressing the button shows all of it", async ($, on) => {
    const reply = `# Report\n${numbered(LONG_OUTPUT, "- item").replaceAll("- item ", "- item no")}`;
    worldOf(on, { a1: { result: reply, text: reply } });
    await $.tool.call({ tool: "Agent", description: "look around", tool_use_id: "a1" } as never);
    const pane = await mountPane($);
    await pane.press({ key: "call-a1" });

    const folded = await detailOf(pane);

    expect(textOf(folded)).toContain("item no0");
    expect(textOf(folded)).not.toContain(`item no${LONG_OUTPUT - 1}`);
    expect(hiddenCount(folded)).toBeGreaterThan(0);
    await pressUnfold(pane);
    const unfolded = await detailOf(pane);
    expect(textOf(unfolded)).toContain(`item no${LONG_OUTPUT - 1}`);
    expect(moreButton(unfolded)).toBeUndefined();
  });

  test("D17 ten Bash lines wider than the pane fold by the rows they fill, and pressing the button shows all ten", async ($, on) => {
    const wide = Array.from({ length: WIDE_LINES }, (_, i) => `w${i} ${"x".repeat(2000)}`).join(
      "\n",
    );
    worldOf(on, { b1: bashOk(wide) });
    await $.tool.call({ tool: "Bash", command: "wide", tool_use_id: "b1" } as never);
    const pane = await mountPane($);
    await pane.press({ key: "call-b1" });

    const folded = await detailOf(pane);

    expect(lineStarting(folded, `w${WIDE_LINES - 1} `)).toBeUndefined();
    expect(hiddenCount(folded)).toBeGreaterThan(0);
    await pressUnfold(pane);
    const unfolded = await detailOf(pane);
    expect(lineStarting(unfolded, `w${WIDE_LINES - 1} `)).toBeDefined();
    expect(moreButton(unfolded)).toBeUndefined();
  });

  test("D18 with 1000 output lines the fold button counts only the lines the fold hides, and unfolded the pane says 600 more lines were not kept", async ($, on) => {
    worldOf(on, { b1: bashOk(numbered(KEPT_LINES + DROPPED, "out")) });
    await $.tool.call({ tool: "Bash", command: "seq 1000", tool_use_id: "b1" } as never);
    const pane = await mountPane($);
    await pane.press({ key: "call-b1" });

    const folded = await detailOf(pane);

    expect(shownCount(folded, "out") + hiddenCount(folded)).toBe(KEPT_LINES);
    expect(lineOf(folded, `… ${DROPPED} more lines not kept`)).toBeUndefined();
    await pressUnfold(pane);
    const unfolded = await detailOf(pane);
    expect(shownCount(unfolded, "out")).toBe(KEPT_LINES);
    expect(lineOf(unfolded, `… ${DROPPED} more lines not kept`)?.props?.color).toBe(palette.muted);
    expect(moreButton(unfolded)).toBeUndefined();
  });
});

describe("detail spacing, wrap and heading colour", () => {
  test("D29 a WebFetch detail has its back row, one empty row, then the Input heading", async ($, on) => {
    worldOf(on, { w1: { result: "ok", text: "ok" } });
    await $.tool.call({ tool: "WebFetch", url: "https://x.test", tool_use_id: "w1" } as never);

    const root = await openedDetail($, "w1");
    const rows = rowTexts(root);

    expect(backIsOnFirstRow(root)).toBe(true);
    expect(rows[1]).toBe("");
    expect(rows[2]?.startsWith("Input")).toBe(true);
  });

  test("D30 a Bash detail has its back row, one empty row, then the command title", async ($, on) => {
    worldOf(on, { b1: bashOk("first") });
    await $.tool.call({ tool: "Bash", command: "ls -la", tool_use_id: "b1" } as never);

    const root = await openedDetail($, "b1");
    const rows = rowTexts(root);

    expect(backIsOnFirstRow(root)).toBe(true);
    expect(rows[1]).toBe("");
    expect(rows[2]).toContain("ls -la");
  });

  test("D31 at 60 columns a wrapped plain output line starts its second row two cells in, and the first row lines up with a short line", async ($, on) => {
    const long = "word ".repeat(40).trim();
    worldOf(on, { s1: { result: `${long}\nshort end`, text: `${long}\nshort end` } });
    await $.tool.call({ tool: "SomeNewTool", tool_use_id: "s1" } as never);
    const pane = await mountPane($, PANE_ROWS, NARROW_COLUMNS);
    await pane.press({ key: "call-s1" });

    const root = await detailOf(pane);
    const wrapped = leavesOf(root).filter((leaf) => textOf(leaf).includes("word"));
    const short = lineOf(root, "short end");
    if (short === undefined) throw new Error("the short line is not drawn");

    expect(wrapped.length).toBeGreaterThan(1);
    expect(indentOf(root, wrapped[0]!)).toBe(indentOf(root, short));
    expect(indentOf(root, wrapped[1]!)).toBe(indentOf(root, short) + BODY_INDENT);
  });

  test("D32 under light a heading in a detail's output is drawn in the user text colour, bold", async ($, on) => {
    worldOf(
      on,
      { h1: { result: "### Result\n\nbody text", text: "### Result\n\nbody text" } },
      "light",
    );
    await $.tool.call({ tool: "SomeNewTool", tool_use_id: "h1" } as never);

    const root = await openedDetail($, "h1");

    const heading = lineOf(root, "Result");
    expect(heading?.props?.color).toBe(palette.userText);
    expect(heading?.props?.weight).toBe("semibold");
  });
});

describe("detail colours", () => {
  for (const theme of THEMES) {
    test(`D13 under ${theme} every colour drawn by the Bash, Read and Edit details is a palette colour`, async ($, on) => {
      worldOf(
        on,
        {
          b1: bashOk("out", "warn"),
          r1: readOk("/work/a.py", "x = 1", 1, 1),
          e1: editOk("/work/a.ts", [hunk(1, ["-a", "+b"])]),
        },
        theme,
      );
      await $.tool.call({ tool: "Bash", command: "make", tool_use_id: "b1" } as never);
      await $.tool.call({ tool: "Read", file_path: "/work/a.py", tool_use_id: "r1" } as never);
      await $.tool.call({ tool: "Edit", file_path: "/work/a.ts", tool_use_id: "e1" } as never);
      const pane = await mountPane($);
      const allowed = paletteColours(theme);

      const roots: Node[] = [];
      for (const id of ["b1", "r1", "e1"]) {
        await pane.press({ key: `call-${id}` });
        roots.push(await detailOf(pane));
        await pane.press({ key: "back" });
      }

      expect(roots.map((root) => collect(root, "Code").length)).toEqual([0, 1, 1]);
      const strays = roots.flatMap(coloursIn).filter((colour) => !allowed.has(colour));
      expect(strays).toEqual([]);
    });
  }

  test("D13b after /color red the Bash, Read and Edit panels and the diff border are not the red accent", async ($, on) => {
    worldOf(
      on,
      {
        b1: bashOk("out", "warn"),
        r1: readOk("/work/a.py", "x = 1", 1, 1),
        e1: editOk("/work/a.ts", [hunk(1, ["-a", "+b"])]),
      },
      undefined,
      "red",
    );
    await $.tool.call({ tool: "Bash", command: "make", tool_use_id: "b1" } as never);
    await $.tool.call({ tool: "Read", file_path: "/work/a.py", tool_use_id: "r1" } as never);
    await $.tool.call({ tool: "Edit", file_path: "/work/a.ts", tool_use_id: "e1" } as never);
    const pane = await mountPane($);

    const roots: Node[] = [];
    for (const id of ["b1", "r1", "e1"]) {
      await pane.press({ key: `call-${id}` });
      roots.push(await detailOf(pane));
      await pane.press({ key: "back" });
    }

    const border = collect(roots[2]!, "Box").find((box) => box.props?.borderStyle === "round");
    expect(border?.props?.borderColor).toBe(ENGINE_DEFAULT_GREY);
    expect(roots.flatMap(coloursIn)).not.toContain(RED);
  });
});

describe("detail look in the pane", () => {
  test("D20 a Bash detail draws its title as a plain row, with no bar and no filled band", async ($, on) => {
    worldOf(on, { b1: bashOk("first") });
    await $.tool.call({ tool: "Bash", command: "ls -la", tool_use_id: "b1" } as never);

    const root = await openedDetail($, "b1");

    expect(textOf(root)).not.toContain("▌");
    expect(fillsIn(root)).toEqual([]);
    expect(lineOf(root, "ls -la")?.props?.color).toBe(palette.text);
  });

  test("D21 a Read detail draws its title as a plain row, with no bar and no filled band", async ($, on) => {
    worldOf(on, { r1: readOk("/work/a.py", "x = 1", 1, 1) });
    await $.tool.call({ tool: "Read", file_path: "/work/a.py", tool_use_id: "r1" } as never);

    const root = await openedDetail($, "r1");

    expect(textOf(root)).not.toContain("▌");
    expect(fillsIn(root)).toEqual([]);
    expect(lineOf(root, "a.py")?.props?.weight).toBe("semibold");
  });

  test("D22 a Bash title that shows only the first line of a three-line command ends with an ellipsis", async ($, on) => {
    worldOf(on, { b1: bashOk("done") });
    await $.tool.call({
      tool: "Bash",
      command: "git add .\ngit commit -m fix\ngit push",
      tool_use_id: "b1",
    } as never);

    const root = await openedDetail($, "b1");

    expect(textOf(lineStarting(root, "git add .")!).trim()).toBe("git add .…");
  });

  test("D22b a Bash title that shows its whole one-line command has no ellipsis", async ($, on) => {
    worldOf(on, { b1: bashOk("done") });
    await $.tool.call({ tool: "Bash", command: "ls -la", tool_use_id: "b1" } as never);

    const root = await openedDetail($, "b1");

    expect(textOf(lineStarting(root, "ls -la")!).trim()).toBe("ls -la");
  });

  test("D23 an Agent detail has a blank row above Output and above Input", async ($, on) => {
    worldOf(on, { a1: { result: "all good here", text: "all good here" } });
    await $.tool.call({ tool: "Agent", description: "look around", tool_use_id: "a1" } as never);

    const root = await openedDetail($, "a1");

    expect(isBlankAbove(root, "Output")).toBe(true);
    expect(isBlankAbove(root, "Input")).toBe(true);
  });

  test("D24 an unknown tool detail has a blank row above Output and above Input", async ($, on) => {
    worldOf(on, { g1: { result: "src/a.ts:1: needle", text: "src/a.ts:1: needle" } });
    await $.tool.call({ tool: "Grep", pattern: "needle", path: "src", tool_use_id: "g1" } as never);

    const root = await openedDetail($, "g1");

    expect(isBlankAbove(root, "Output")).toBe(true);
    expect(isBlankAbove(root, "Input")).toBe(true);
  });

  test("D25 an Agent detail draws the Input body and the Output body at the same two-cell indent", async ($, on) => {
    worldOf(on, { a1: { result: "all good here", text: "all good here" } });
    await $.tool.call({ tool: "Agent", description: "look around", tool_use_id: "a1" } as never);

    const root = await openedDetail($, "a1");

    expect(indentOf(root, lineOf(root, "look around")!)).toBe(BODY_INDENT);
    expect(indentOf(root, lineOf(root, "all good here")!)).toBe(BODY_INDENT);
  });

  test("D26 an unknown tool detail draws the Input body and the Output body at the same two-cell indent", async ($, on) => {
    worldOf(on, { g1: { result: "src/a.ts:1: needle", text: "src/a.ts:1: needle" } });
    await $.tool.call({ tool: "Grep", pattern: "needle", path: "src", tool_use_id: "g1" } as never);

    const root = await openedDetail($, "g1");

    expect(indentOf(root, lineOf(root, "pattern")!)).toBe(BODY_INDENT);
    expect(indentOf(root, lineOf(root, "src/a.ts:1: needle")!)).toBe(BODY_INDENT);
  });

  test("D27 under the light theme the pane diff window title is drawn in the pane text colour", async ($, on) => {
    worldOf(on, { e1: editOk("/work/src/a.ts", [hunk(1, ["-old", "+new"])]) }, "light");
    on("config.set", () => ({ value: true }));
    await $.config.set({ key: "theme", value: "light" } as never);
    await $.tool.call({ tool: "Edit", file_path: "/work/src/a.ts", tool_use_id: "e1" } as never);

    const root = await openedDetail($, "e1");

    const window = collect(root, "Box").find((box) => box.props?.borderStyle === "round");
    const title = leavesOf(window!).find((leaf) => textOf(leaf) === "src/a.ts");
    expect(title?.props?.color).toBe(inkFor("light").text);
  });

  test("D28 after unfolding a long Bash call a fewer lines row folds it back to the folded view", async ($, on) => {
    worldOf(on, { b1: bashOk(numbered(LONG_OUTPUT, "out")) });
    await $.tool.call({ tool: "Bash", command: "seq 200", tool_use_id: "b1" } as never);
    const pane = await mountPane($);
    await pane.press({ key: "call-b1" });
    await pressUnfold(pane);

    const unfolded = await detailOf(pane);
    const fewer = fewerButton(unfolded);
    await pane.press({ key: fewer!.props?.key as string });

    expect(fewer?.props?.label).toBe("▾ fewer lines");
    const folded = await detailOf(pane);
    expect(lineOf(folded, "out 199")).toBeUndefined();
    expect(moreButton(folded)?.props?.label).toBe(`▸ ${HIDDEN_AFTER_FOLD} more lines`);
    expect(fewerButton(folded)).toBeUndefined();
  });
});

const FRUIT_REPORT =
  "# Fruit report\n\n- apple\n- pear\n- plum\n\nA plain paragraph here.\n\nSome **important** words";
const FRUIT_WORDS = [
  "Fruit report",
  "apple",
  "pear",
  "plum",
  "A plain paragraph here.",
  "important",
];

describe("pale text in the light theme", () => {
  for (const theme of ["light", "dark"]) {
    test(`V1 under ${theme} the more lines and fewer lines rows are drawn in the pane text colour`, async ($, on) => {
      worldOf(on, { b1: bashOk(numbered(LONG_OUTPUT, "out")) }, theme);
      await $.tool.call({ tool: "Bash", command: "seq 200", tool_use_id: "b1" } as never);
      const pane = await mountPane($);
      await pane.press({ key: "call-b1" });
      const folded = await detailOf(pane);
      await pressUnfold(pane);
      const unfolded = await detailOf(pane);

      const more = colourOfLabel(folded, moreButton(folded)!);
      const fewer = colourOfLabel(unfolded, fewerButton(unfolded)!);

      expect(inkFor(theme).text).toBeDefined();
      expect(more).toBe(inkFor(theme).text);
      expect(fewer).toBe(inkFor(theme).text);
    });
  }

  test("V2 under light an Agent markdown output draws its heading, list items, paragraph and bold text each in a pane colour", async ($, on) => {
    worldOf(on, { a1: { result: FRUIT_REPORT, text: FRUIT_REPORT } }, "light");
    on("config.set", () => ({ value: true }));
    await $.config.set({ key: "theme", value: "light" } as never);
    await $.tool.call({ tool: "Agent", description: "fruit", tool_use_id: "a1" } as never);

    const root = await openedDetail($, "a1");

    const ink = inkFor("light");
    const allowed = new Set(Object.values(ink).filter((value) => typeof value === "string"));
    const colours = FRUIT_WORDS.map((word) => ({ word, colour: runColour(root, word) }));
    expect(colours.filter(({ colour }) => colour === undefined)).toEqual([]);
    expect(colours.filter(({ colour }) => !allowed.has(colour as string))).toEqual([]);
  });
});

function worldOf(
  on: On,
  outcomes: Record<string, Outcome>,
  theme?: string,
  color?: string,
): SessionFeed {
  const feed = feedSession(on);
  mock.clock(on, { now: 200_000 });
  mock.env(on, { HOME: "/h/u" });
  if (theme !== undefined)
    on("config.list", () => ({ value: [{ key: "theme", value: theme }] }) as never);
  if (color !== undefined)
    on("state.get", (_$, e, next) =>
      e.key === "sessionColor" ? { value: { value: color, version: 1 } } : next(e),
    );
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
  on("tool.call", (_$, e) => {
    const id = (e as unknown as { tool_use_id: string }).tool_use_id;
    return feed.record(e, outcomes[id] ?? { result: "ok", text: "ok" }) as never;
  });
  return feed;
}

function bashOk(stdout: string, stderr = "", extra: Record<string, unknown> = {}): Outcome {
  return { result: { stdout, stderr, interrupted: false, ...extra }, text: stdout };
}

function readOk(filePath: string, content: string, startLine: number, totalLines: number): Outcome {
  const numLines = content === "" ? 0 : content.split("\n").length;
  return {
    result: { type: "text", file: { filePath, content, numLines, startLine, totalLines } },
    text: content,
  };
}

function editOk(filePath: string, structuredPatch: Hunk[]): Outcome {
  return {
    result: {
      filePath,
      oldString: "",
      newString: "",
      originalFile: "",
      structuredPatch,
      userModified: false,
      replaceAll: false,
    },
    text: `The file ${filePath} has been updated`,
  };
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

function numbered(count: number, prefix: string): string {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i}`).join("\n");
}

function mountPane($: Engine, rows = PANE_ROWS, columns = COLUMNS): Promise<Pane> {
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
      scroll: { offset: 0, bodyRows: rows },
      view: {},
    },
    viewport: { columns, rows },
  });
}

async function openedDetail($: Engine, callId: string): Promise<Node> {
  const pane = await mountPane($);
  await pane.press({ key: `call-${callId}` });
  return detailOf(pane);
}

async function detailOf(pane: Pane): Promise<Node> {
  const tree = (await pane.drawn()) as unknown as Node;
  const root = collect(tree, "Box").find((box) =>
    childrenOf(box).some((row) => childrenOf(row).some((cell) => cell.props?.key === "back")),
  );
  if (root === undefined) throw new Error("the call detail is not drawn");
  return root;
}

function backIsOnFirstRow(root: Node): boolean {
  const [firstRow] = childrenOf(root);
  return firstRow !== undefined && childrenOf(firstRow).some((cell) => cell.props?.key === "back");
}

function leavesOf(root: Node): Node[] {
  return collect(root, "Text").filter((text) => childrenOf(text).length === 0);
}

function lineOf(root: Node, text: string): Node | undefined {
  return leavesOf(root).find((leaf) => textOf(leaf).trim() === text);
}

function hiddenCount(root: Node): number {
  const label = (moreButton(root)?.props?.label as string | undefined) ?? "";
  return Number(/^▸ (\d+) more lines?$/.exec(label)?.[1] ?? Number.NaN);
}

function shownCount(root: Node, prefix: string): number {
  return leavesOf(root).filter((leaf) => new RegExp(`^${prefix} \\d+$`).test(textOf(leaf).trim()))
    .length;
}

function lineStarting(root: Node, start: string): Node | undefined {
  return leavesOf(root).find((leaf) => textOf(leaf).trim().startsWith(start));
}

function sourceOf(root: Node): string {
  return (collect(root, "Code")[0]?.props?.source as string | undefined) ?? "";
}

function moreButton(root: Node): Node | undefined {
  return collect(root, "Button").find((button) => /^▸ \d+ more lines?$/.test(labelOf(button)));
}

function diffBody(root: Node): string[] {
  const code = collect(root, "Code").find((node) => node.props?.format === "diff");
  return ((code?.props?.source as string | undefined) ?? "").split("\n").slice(1);
}

function coloursIn(node: Node): string[] {
  const own = ["color", "backgroundColor", "borderColor"]
    .map((name) => node.props?.[name])
    .filter((value): value is string => typeof value === "string");
  return [...own, ...childrenOf(node).flatMap(coloursIn)];
}

function paletteColours(theme: string): Set<string> {
  const ink = inkFor(theme);
  const fills = fillsFor(theme);
  const values = [
    ...Object.values(palette),
    ...Object.values(ink.mix),
    ...ink.hues,
    ...Object.values(ink).filter((value) => typeof value === "string"),
    ...Object.values(fills).filter((value) => typeof value === "string"),
    ...fills.hues,
    ENGINE_DEFAULT_GREY,
  ];
  return new Set(values);
}

async function pressUnfold(pane: Pane): Promise<void> {
  const button = moreButton(await detailOf(pane));
  if (button === undefined) throw new Error("the fold button is not drawn");
  await pane.press({ key: button.props?.key as string });
}

function labelOf(button: Node): string {
  return (button.props?.label as string | undefined) ?? "";
}

function fewerButton(root: Node): Node | undefined {
  return collect(root, "Button").find((button) => labelOf(button) === "▾ fewer lines");
}

function fillsIn(node: Node): string[] {
  const own = node.props?.backgroundColor;
  return [...(typeof own === "string" ? [own] : []), ...childrenOf(node).flatMap(fillsIn)];
}

function isBlankAbove(root: Node, label: string): boolean {
  const rows = rowTexts(root);
  const at = rows.findIndex((row) => row.trim().startsWith(label));
  if (at < 0) throw new Error(`no ${label} row is drawn`);
  return rows[at - 1]?.trim() === "";
}

function rowTexts(node: Node): string[] {
  if (node.type !== "Box" || node.props?.flexDirection !== "column") return [textOf(node)];
  return childrenOf(node).flatMap(rowTexts);
}

function indentOf(root: Node, leaf: Node): number {
  const path = pathTo(root, leaf) ?? [];
  const boxes = path.filter((node) => node.type === "Box").slice(1);
  const cells = boxes.reduce(
    (sum, box) =>
      sum +
      Number(box.props?.paddingLeft ?? box.props?.paddingX ?? 0) +
      Number(box.props?.marginLeft ?? box.props?.marginX ?? 0),
    0,
  );
  const row = path.find((node) => node.type === "Text") ?? leaf;
  return cells + textOf(row).length - textOf(row).trimStart().length;
}

function pathTo(node: Node, target: Node): Node[] | undefined {
  if (node === target) return [node];
  for (const child of childrenOf(node)) {
    const found = pathTo(child, target);
    if (found !== undefined) return [node, ...found];
  }
  return undefined;
}

function runColour(root: Node, word: string): unknown {
  const path = leavesOf(root)
    .filter((leaf) => textOf(leaf).trim() === word)
    .map((leaf) => pathTo(root, leaf) ?? [])[0];
  if (path === undefined) throw new Error(`no run ${word} is drawn`);
  return [...path].reverse().find((node) => node.type === "Text" && node.props?.color !== undefined)
    ?.props?.color;
}

function colourOfLabel(root: Node, button: Node): unknown {
  const inside = collect(button, "Text").find((text) => textOf(text) === labelOf(button));
  if (inside?.props?.color !== undefined) return inside.props.color;
  const path = pathTo(root, button) ?? [];
  return [...path].reverse().find((node) => node.props?.color !== undefined)?.props?.color;
}
