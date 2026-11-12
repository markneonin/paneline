import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

import { fitHunks } from "../hooks/diff-panel";
import { palette } from "../hooks/palette";
import { replyLook } from "../hooks/reply-look";
import { isHeavy } from "./weight";

const HOME = "/Users/dev";
const CWD = "/Users/dev/app";
const ENGINE_RESULT = "engine drew this result";
const SESSION_START = { cwd: CWD, surface: "terminal", isInteractive: true } as const;
const ESC = "\u001b";
const NUL = "\u0000";
const CR = "\r";
const ESC_SYMBOL = "␛";
const NUL_SYMBOL = "␀";
const CR_SYMBOL = "␍";
const RAW_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
const BASH_COMMAND = "npm run build";

type Node = { type: string; props: Record<string, unknown>; children?: unknown };
type Hunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
};

describe("diff panels", () => {
  test("DF1 an Edit replacing 3 lines with 5 is titled by the relative path with +5 and -3 and hands the engine both hunks with correct counts", async ($, on) => {
    await world($, on);
    const output = editOutput(`${CWD}/hooks/a.ts`, [
      hunk(10, ["-a1", "-a2", "-a3", "+b1", "+b2", "+b3", "+b4", "+b5"]),
      hunk(40, [" ctx1", " ctx2"]),
    ]);

    const tree = await draw($, "Edit", output);

    const text = textOf(tree);
    expect(text).toContain("hooks/a.ts");
    expect(text).toContain("+5");
    expect(text).toContain("-3");
    const code = codeOf(tree);
    expect(code.props.format).toBe("diff");
    expect(code.props.path).toBe(`${CWD}/hooks/a.ts`);
    expect(code.props.source).toBe(
      [
        "@@ -10,3 +10,5 @@",
        "-a1",
        "-a2",
        "-a3",
        "+b1",
        "+b2",
        "+b3",
        "+b4",
        "+b5",
        "@@ -40,2 +40,2 @@",
        " ctx1",
        " ctx2",
      ].join("\n"),
    );
  });

  test("DF2 the title is a Link to a file URL", async ($, on) => {
    await world($, on);
    const output = editOutput(`${CWD}/hooks/my file.ts`, [hunk(1, ["-a", "+b"])]);

    const link = collect(await draw($, "Edit", output), "Link")[0];

    expect(link?.props.href).toBe(`file://${encodeURI(`${CWD}/hooks/my file.ts`)}`);
  });

  test("DF3 a path outside the cwd under HOME shows ~", async ($, on) => {
    await world($, on);
    const output = editOutput(`${HOME}/notes/todo.md`, [hunk(1, ["-a", "+b"])]);

    expect(textOf(await draw($, "Edit", output))).toContain("~/notes/todo.md");
  });

  test("DF4 a Write create of 50 lines shows new and +50 and no minus", async ($, on) => {
    await world($, on);
    const content = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");

    const text = textOf(await draw($, "Write", writeCreate(`${CWD}/b.ts`, content)));

    expect(text).toContain("new");
    expect(text).toContain("+50");
    expect(text).not.toMatch(/-\d/);
  });

  test("DF5 a 200-line change shows 40 body lines and the hidden count", async ($, on) => {
    await world($, on);
    const lines = Array.from({ length: 200 }, (_, i) => `+row ${i}`);
    const output = editOutput(`${CWD}/c.ts`, [hunk(1, lines)]);

    const tree = await draw($, "Edit", output);

    const [header, ...body] = sourceLines(tree);
    expect(header).toBe("@@ -1,0 +1,40 @@");
    expect(body).toEqual(lines.slice(0, 40));
    expect(textOf(tree)).toContain("… +160 lines");
  });

  test("DF5c a change of long lines is cut by size and shows the hidden count", async ($, on) => {
    await world($, on);
    const lines = Array.from({ length: 50 }, () => `+${"x".repeat(299)}`);
    const output = editOutput(`${CWD}/c.ts`, [hunk(1, lines)]);

    const tree = await draw($, "Edit", output);

    expect(sourceLines(tree).slice(1)).toHaveLength(29);
    expect(textOf(tree)).toContain("… +21 lines");
  });

  test("DF5b a cut hunk keeps its counts in step with the kept lines", async ($, on) => {
    await world($, on);
    const lines = [" c1", " c2", ...Array.from({ length: 60 }, (_, i) => `-r${i}`), "+n1"];

    const { hunks } = fitHunks([hunk(5, lines)]);

    expect(hunks[0]!.lines).toHaveLength(40);
    expect(hunks[0]!.oldLines).toBe(40);
    expect(hunks[0]!.newLines).toBe(2);
  });

  test("DF6 an errored Edit is left to the engine", async ($, on) => {
    await world($, on);
    const output = editOutput(`${CWD}/a.ts`, [hunk(1, ["-a", "+b"])]);

    const text = textOf(await draw($, "Edit", output, true));

    expect(text).toBe(ENGINE_RESULT);
  });

  test("DF7 a Read result of a text file shows a titled panel instead of the engine result", async ($, on) => {
    await world($, on);
    const output = {
      type: "text",
      file: { filePath: `${CWD}/a.ts`, content: "x", numLines: 1, startLine: 1, totalLines: 1 },
    };

    const tree = await draw($, "Read", output);

    expect(collect(tree, "Box").some((box) => box.props.borderStyle === "round")).toBe(true);
    expect(textOf(tree)).toContain("a.ts");
    expect(textOf(tree)).not.toBe(ENGINE_RESULT);
  });

  test("DF8 an Edit with an empty patch shows no changes and no body rows", async ($, on) => {
    await world($, on);

    const tree = await draw($, "Edit", editOutput(`${CWD}/a.ts`, []));

    const notice = collect(tree, "Text").find((node) => textOf(node) === "no changes");
    expect(notice?.props.color).toBe(palette.muted);
    expect(notice?.props.backgroundColor).toBeUndefined();
    expect(childrenOf(tree)).toHaveLength(1);
  });

  test("DF9 the same result drawn twice is built once", async ($, on) => {
    await world($, on);
    const first = editOutput(`${CWD}/a.ts`, [hunk(1, ["-a", "+first"])], "same-id");
    const second = editOutput(`${CWD}/a.ts`, [hunk(1, ["-a", "+second"])], "same-id");

    await draw($, "Edit", first, false, "same-id");
    const again = codeOf(await draw($, "Edit", second, false, "same-id"));

    expect(again.props.source).toContain("+first");
    expect(again.props.source).not.toContain("+second");
  });

  test("DF10 an added line is marked + and a removed line - in the diff the engine highlights", async ($, on) => {
    await world($, on);
    const output = editOutput(`${CWD}/a.ts`, [hunk(1, [" keep", "-gone", "+came"])]);

    const tree = await draw($, "Edit", output);

    expect(sourceLines(tree)).toEqual(["@@ -1,2 +1,2 @@", " keep", "-gone", "+came"]);
  });

  test("DW1 the window is a rounded frame in the session accent with a gap above it", async ($, on) => {
    await world($, on);

    const tree = await draw($, "Edit", editOutput(`${CWD}/a.ts`, [hunk(1, ["-a", "+b"])]));

    expect(tree.props.borderStyle).toBe("round");
    expect(tree.props.borderColor).toBe(replyLook(null).accent);
    expect(tree.props.marginTop).toBe(1);
  });

  test("DW2 the header is the first row inside the frame and the code rows follow it with no spacer", async ($, on) => {
    await world($, on);

    const tree = await draw($, "Edit", editOutput(`${CWD}/hooks/a.ts`, [hunk(1, ["-a", "+b"])]));

    const [header, ...rows] = childrenOf(tree);
    expect(textOf(header!)).toContain("hooks/a.ts");
    expect(isHeavy(collect(header!, "Text").find((t) => textOf(t) === "hooks/a.ts")?.props)).toBe(
      true,
    );
    expect(header!.props.backgroundColor).toBeUndefined();
    expect(collect(header!, "Text").every((t) => t.props.backgroundColor === undefined)).toBe(true);
    expect(textOf(rows[0]!)).toBe("─".repeat(80 - 2 - 3 - 2));
    expect(collect(rows[0]!, "Text")[0]!.props.color).toBe(replyLook(null).accent);
    expect(rows.map((row) => row.type)).toEqual(["Box", "Code"]);
  });

  test("DW3 the tag reads new for a created file, edited for a change and deleted when every line goes", async ($, on) => {
    await world($, on);

    const created = textOf(await draw($, "Write", writeCreate(`${CWD}/n.ts`, "x\ny")));
    const edited = textOf(
      await draw($, "Edit", editOutput(`${CWD}/e.ts`, [hunk(3, [" c", "-a", "+b"])])),
    );
    const deleted = textOf(
      await draw($, "Edit", editOutput(`${CWD}/d.ts`, [hunk(1, ["-a", "-b", "-c"])])),
    );

    expect(created).toContain("new");
    expect(edited).toContain("edited");
    expect(edited).not.toContain("new");
    expect(deleted).toContain("deleted");
    expect(deleted).toContain("-3");
    expect(deleted).not.toContain("+");
  });

  test("DW4 a line wider than the frame wraps and is never truncated", async ($, on) => {
    await world($, on);
    const wide = `+${"w".repeat(300)}`;

    const tree = await draw($, "Edit", editOutput(`${CWD}/a.ts`, [hunk(1, [wide])]));

    const code = codeOf(tree);
    expect(code.props.wrap).toBe("wrap");
    expect(sourceLines(tree)).toContain(wide);
  });

  test("DW5 at 60 columns the frame and every row fit the reply width", async ($, on) => {
    await world($, on);

    const tree = await draw(
      $,
      "Edit",
      editOutput(`${CWD}/a.ts`, [hunk(1, ["-a", "+b"])]),
      false,
      "narrow",
      60,
    );

    const frameWidth = 60 - 2 - 3;
    expect(tree.props.width).toBe(frameWidth);
    const [header, rule, code] = childrenOf(tree);
    expect(Number(header!.props.width)).toBe(frameWidth - 2);
    expect(Number(rule!.props.width)).toBe(frameWidth - 2);
    expect(textOf(rule!)).toBe("─".repeat(frameWidth - 2));
    expect(code!.type).toBe("Code");
  });

  test("DW6 a Write that deletes nothing and adds nothing shows no changes", async ($, on) => {
    await world($, on);

    const tree = await draw($, "Write", writeCreate(`${CWD}/empty.ts`, ""));

    expect(textOf(tree)).toContain("no changes");
  });

  test("DW7 an expanded call row draws the same window", async ($, on) => {
    await world($, on);
    const group = await $.ui.mount({
      plugin: "paneline",
      surface: "terminal",
      component: "ToolGroup",
      props: {
        calls: [
          {
            tool_use_id: "x1",
            tool: "Edit",
            isRunning: false,
            isErrored: false,
            input: {},
            isInterrupted: false,
          },
        ],
        isActive: false,
        isExpanded: true,
      },
      viewport: { columns: 80, rows: 40 },
    });
    await group.drawn();
    const output = editOutput(`${CWD}/a.ts`, [hunk(1, ["-a", "+b"])]);

    const ui = await $.ui.mount({
      plugin: "paneline",
      surface: "terminal",
      component: "ToolUse",
      props: {
        tool_use_id: "x1",
        tool: "Edit",
        input: {},
        isRunning: false,
        isErrored: false,
        isInterrupted: false,
        output,
      },
      viewport: { columns: 80, rows: 40 },
    });
    const tree = (await ui.drawn()) as unknown as Node;

    expect(tree.props.borderStyle).toBe("round");
  });

  test("BX1 a Bash result that changed files shows its output panel and one window per file, tagged new, edited and deleted, with no engine output", async ($, on) => {
    await world($, on);
    const output = {
      stdout: "merged",
      stderr: "",
      bashEditDiff: {
        files: [
          { filePath: `${CWD}/a.ts`, hunks: [hunk(1, ["-a", "+b"])] },
          { filePath: `${CWD}/b.ts`, hunks: [hunk(0, ["+x", "+y"])], created: true },
          { filePath: `${CWD}/c.ts`, hunks: [hunk(1, [" keep", "-gone"])], deleted: true },
        ],
        moreFiles: 0,
      },
    };

    const tree = await drawBashCall($, output);

    const windows = collect(tree, "Box").filter((box) => box.props.borderStyle === "round");
    expect(windows).toHaveLength(4);
    const text = textOf(tree);
    expect(text).not.toContain(ENGINE_RESULT);
    expect(text).toContain("edited");
    expect(text).toContain("new");
    expect(text).toContain("deleted");
  });

  test("BX2 a Bash result with no file changes shows its output in a titled panel", async ($, on) => {
    await world($, on);

    const tree = await drawBashCall($, { stdout: "ok", stderr: "", interrupted: false });

    expect(collect(tree, "Box").filter((box) => box.props.borderStyle === "round")).toHaveLength(1);
    expect(textOf(tree)).not.toBe(ENGINE_RESULT);
  });

  test("BX3 more files and a shared repository each add one dim line under the windows", async ($, on) => {
    await world($, on);
    const output = {
      stdout: "",
      stderr: "",
      bashEditDiff: {
        files: [{ filePath: `${CWD}/a.ts`, hunks: [hunk(1, ["-a", "+b"])] }],
        moreFiles: 4,
        shared: true,
      },
    };

    const tree = await drawBashCall($, output);

    const notes = collect(tree, "Text").filter(
      (node) => (node.props as Record<string, unknown> | undefined)?.dimColor === true,
    );
    expect(notes.map(textOf)).toEqual([
      "… +4 more files",
      "another command ran in this repository at the same time; a change made by either may show under either result",
    ]);
  });

  test("TH5 the +N count is drawn in the added colour", async ($, on) => {
    await world($, on);
    const output = editOutput(`${CWD}/a.ts`, [hunk(1, [" keep", "-gone", "+came", "+more"])]);

    const count = textNode(await draw($, "Edit", output), "+2");

    expect(count.props.color).toBe(palette.ok);
  });

  test("TH5b the -N count is drawn in the removed colour", async ($, on) => {
    await world($, on);
    const output = editOutput(`${CWD}/a.ts`, [hunk(1, [" keep", "-gone", "-old", "+came"])]);

    const count = textNode(await draw($, "Edit", output), "-2");

    expect(count.props.color).toBe(palette.failed);
  });

  test("DF11 a removed line with an escape byte shows it as ␛ and the card draws no raw control character", async ($, on) => {
    await world($, on);
    const output = editOutput(`${CWD}/a.ts`, [hunk(1, [`-${ESC}qold`, "+new"])]);

    const tree = await draw($, "Edit", output, false, "df11");

    expect(sourceLines(tree)).toContain(`-${ESC_SYMBOL}qold`);
    expect(rawControlsIn(tree)).toEqual([]);
  });

  test("DF12 an added line with a NUL byte shows it as ␀ and the card draws no raw control character", async ($, on) => {
    await world($, on);
    const output = editOutput(`${CWD}/a.ts`, [hunk(1, ["-old", `+a${NUL}b`])]);

    const tree = await draw($, "Edit", output, false, "df12");

    expect(sourceLines(tree)).toContain(`+a${NUL_SYMBOL}b`);
    expect(rawControlsIn(tree)).toEqual([]);
  });

  test("DF13 an added line with a carriage return in its middle shows it as ␍ and the card draws no raw control character", async ($, on) => {
    await world($, on);
    const output = editOutput(`${CWD}/a.ts`, [hunk(1, ["-old", `+left${CR}right`])]);

    const tree = await draw($, "Edit", output, false, "df13");

    expect(sourceLines(tree)).toContain(`+left${CR_SYMBOL}right`);
    expect(rawControlsIn(tree)).toEqual([]);
  });

  test("DF14 a changed line of a CRLF file reads as plain text and no ␍ is drawn", async ($, on) => {
    await world($, on);
    const output = editOutput(`${CWD}/win.ts`, [hunk(1, ["-old\r", "+changed\r"])]);

    const source = String(codeOf(await draw($, "Edit", output, false, "df14")).props.source);

    expect(source).toContain("+changed");
    expect(source).not.toContain(CR_SYMBOL);
  });

  test("DF17 a Read of a file with Windows line ends and a final carriage return keeps its lines exactly as the file holds them", async ($, on) => {
    await world($, on);
    const output = {
      type: "text",
      file: {
        filePath: `${CWD}/w.txt`,
        content: "one\r\ntwo\r",
        numLines: 2,
        startLine: 1,
        totalLines: 2,
      },
    };

    const tree = await draw($, "Read", output, false, "df17");

    expect(String(codeOf(tree).props.source)).toBe("one\ntwo");
  });

  test("DF18 a Write creating a file whose content holds an escape byte shows it as ␛ and the card draws no raw control character", async ($, on) => {
    await world($, on);
    const content = `alpha\nx${ESC}q z`;

    const tree = await draw($, "Write", writeCreate(`${CWD}/n.ts`, content), false, "df18");

    expect(sourceLines(tree)).toContain(`+x${ESC_SYMBOL}q z`);
    expect(rawControlsIn(tree)).toEqual([]);
  });
});

async function world($: Engine, on: On): Promise<void> {
  mock.env(on, { HOME });
  on("session.model", () => ({ value: "claude-opus-5-5" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: CWD }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("command.register", () => ({ value: {} }) as never);
  on("ui.render", { component: "ToolResult" }, ($ui, e) => {
    const { Text } = $ui.ui.resolve(e);
    return <Text>{ENGINE_RESULT}</Text>;
  });
  on("ui.render", { component: "ToolGroup" }, ($ui, e) => {
    const { Text } = $ui.ui.resolve(e);
    return <Text>{ENGINE_RESULT}</Text>;
  });
  await $.session.start(SESSION_START);
}

async function draw(
  $: Engine,
  tool: string,
  output: unknown,
  isErrored = false,
  id = `id-${Math.random()}`,
  columns = 80,
): Promise<Node> {
  const ui = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "ToolResult",
    props: { tool_use_id: id, tool, output, isErrored, isExpanded: true },
    viewport: { columns, rows: 40 },
  });
  return (await ui.drawn()) as unknown as Node;
}

async function drawBashCall($: Engine, output: unknown): Promise<Node> {
  const ui = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "ToolUse",
    props: {
      tool_use_id: "bash-call",
      tool: "Bash",
      input: { command: BASH_COMMAND },
      output,
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
      isExpanded: true,
    },
    viewport: { columns: 80, rows: 40 },
  });
  return (await ui.drawn()) as unknown as Node;
}

function hunk(start: number, lines: string[]): Hunk {
  const added = lines.filter((l) => l.startsWith("+")).length;
  const removed = lines.filter((l) => l.startsWith("-")).length;
  const context = lines.length - added - removed;
  return {
    oldStart: start,
    oldLines: context + removed,
    newStart: start,
    newLines: context + added,
    lines,
  };
}

function editOutput(filePath: string, structuredPatch: Hunk[], _id?: string) {
  return { filePath, structuredPatch, originalFile: "", userModified: false, replaceAll: false };
}

function writeCreate(filePath: string, content: string) {
  return { type: "create", filePath, content, structuredPatch: [], originalFile: null };
}

function codeOf(tree: Node): Node {
  const codes = collect(tree, "Code");
  expect(codes).toHaveLength(1);
  return codes[0]!;
}

function sourceLines(tree: Node): string[] {
  return String(codeOf(tree).props.source).split("\n");
}

function textNode(tree: Node, text: string): Node {
  const nodes = collect(tree, "Text").filter((node) => textOf(node) === text);
  expect(nodes).toHaveLength(1);
  return nodes[0]!;
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

function rawControlsIn(tree: Node): string[] {
  return stringsIn(tree).flatMap((text) => text.match(RAW_CONTROL) ?? []);
}

function stringsIn(node: Node): string[] {
  const props = Object.values(node.props).filter(
    (value): value is string => typeof value === "string",
  );
  const children = listOf(node.children).flatMap((child) => {
    if (typeof child === "string") return [child];
    return typeof child === "object" && child !== null ? stringsIn(child as Node) : [];
  });
  return [...props, ...children];
}
