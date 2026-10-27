import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";

import { palette } from "../hooks/palette";

type Tree = { type: string; props?: Record<string, unknown>; children?: unknown[] };
type Drawn = { drawn: () => Promise<unknown> };
type Row = { cells: number; text: string };

const PROGRESS_TOOL = "mcp__paneline__progress";
const NARROW = 80;
const WIDE = 200;
const BAND_SUFFIX_CELLS = 2;
const TEXT_COLUMN_CELLS = 2;
const RIGHT_GUTTER_CELLS = 3;
const FLUSH_RIGHT = "flex-end";
const LONG_PARAGRAPH = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
const PROSE = [
  "# Heading",
  LONG_PARAGRAPH,
  "- first bullet\n- second bullet",
  "| a | b |\n|---|---|\n| 1 | 2 |",
  "```ts\nconst x = 1\n```",
].join("\n\n");
const URL = `https://example.com/${"a1b2c3d4e5".repeat(28)}`;
const EMOJI_TEXT = Array.from({ length: 40 }, (_, i) =>
  i % 3 === 0 ? "🚀" : i % 3 === 1 ? "✅" : "⭐",
).join(" ");
const CJK_TEXT = Array.from({ length: 30 }, () => "日本語 テキスト 한국어").join(" ");
const MIXED_TEXT = [EMOJI_TEXT, CJK_TEXT, URL].join(" ");
const ESCAPE_TEXT = "before \u001b[31mred\u001b[0m after";
const CONTROL_CHARACTER = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

describe("Claude rows are flush with the left gutter", () => {
  for (const columns of [NARROW, WIDE]) {
    test(`L1 at ${columns} columns Claude rows start at the shared text column and take the content width`, async ($) => {
      const roots = await claudeRoots($, columns);

      expect(roots.map((root) => root.props?.marginLeft)).toEqual([
        TEXT_COLUMN_CELLS,
        TEXT_COLUMN_CELLS,
        TEXT_COLUMN_CELLS,
        TEXT_COLUMN_CELLS,
      ]);
      expect(roots.map((root) => root.props?.width)).toEqual(Array(4).fill(innerWidth(columns)));
    });
  }

  for (const columns of [NARROW, WIDE]) {
    test(`L2 at ${columns} columns the CLAUDE header and the TOOL header start with the label`, async ($) => {
      const [reply, group] = await claudeRoots($, columns);

      expect(textOf(childTrees(reply!)[0]!).startsWith("CLAUDE")).toBe(true);
      expect(textOf(childTrees(group!)[0]!).startsWith("TOOL")).toBe(true);
    });
  }

  for (const columns of [NARROW, WIDE]) {
    test(`L3 at ${columns} columns no Claude row is pushed to the right`, async ($) => {
      const roots = [
        await rootOf(await mountReply($, PROSE, columns)),
        ...(await claudeRoots($, columns)),
      ];

      expect(roots.flatMap(flushRightRows)).toEqual([]);
    });
  }
});

describe("the progress call is invisible", () => {
  test("H1 a progress call draws no text in the chat", async ($) => {
    const call = await $.ui.mount({
      plugin: "paneline",
      surface: "terminal",
      component: "ToolUse",
      props: toolProps("p1", PROGRESS_TOOL),
      viewport: { columns: NARROW, rows: 24 },
    });

    expect(textOf(await rootOf(call))).toBe("");
  });

  test("H2 a group of a Read and a progress call shows only the Read", async ($) => {
    const readOnly = await mountGroup($, [toolProps("g1", "Read")]);
    const mixed = await mountGroup($, [toolProps("g1", "Read"), toolProps("g2", PROGRESS_TOOL)]);

    expect(textOf(await rootOf(mixed))).toBe(textOf(await rootOf(readOnly)));
    expect(textOf(await rootOf(mixed))).toContain("Read");
    expect(textOf(await rootOf(mixed))).not.toContain("progress");
  });
});

describe("the owner prompt is flush right", () => {
  for (const columns of [NARROW, WIDE]) {
    test(`L7 at ${columns} columns the USER header ends with the label and the block spans the content width`, async ($) => {
      const root = await rootOf(await mountUser($, "hello", columns));

      expect(root.props?.marginLeft).toBe(TEXT_COLUMN_CELLS);
      expect(root.props?.width).toBe(innerWidth(columns));
      expect(textOf(childTrees(root)[0]!).endsWith("USER")).toBe(true);
    });

    test(`L5 at ${columns} columns every line of a long prompt is a full-width row ending at the right gutter`, async ($) => {
      const root = await rootOf(await mountUser($, LONG_PARAGRAPH, columns));

      const rows = flushRightRows(root);

      expect(rows.length).toBeGreaterThan(1);
      expect(rows.map((row) => row.props?.width)).toEqual(
        Array(rows.length).fill(innerWidth(columns)),
      );
      expect(rows.every((row) => textOf(row).endsWith("▌"))).toBe(true);
    });
  }
});

describe("pasted content tags", () => {
  const WRAPPED = [
    '<pasted_content id="a1">\nfirst line\nsecond line\n</pasted_content id="a1">',
    '<\\pasted_content id="b2">\nfirst line\nsecond line\n<\\/pasted_content id="b2">',
  ];

  for (const wrapped of WRAPPED) {
    test("P1 a prompt wrapped in pasted_content tags shows only its inner text, flush right", async ($) => {
      const root = await rootOf(await mountUser($, wrapped, NARROW));

      const rows = flushRightRows(root);

      expect(rows.map((row) => textOf(row))).toEqual(["first line ▌", "second line ▌"]);
      expect(textOf(root)).not.toContain("pasted_content");
    });
  }
});

describe("user band width", () => {
  test("B1 at 80 columns no band row with wide emoji is wider than the band", async ($) => {
    const rows = await bandRows($, EMOJI_TEXT, NARROW);

    expect(rowsWiderThan(rows, innerWidth(NARROW))).toEqual([]);
    expect(rows.length).toBeGreaterThan(1);
  });

  test("B2 at 80 columns no band row with CJK words is wider than the band", async ($) => {
    const rows = await bandRows($, CJK_TEXT, NARROW);

    expect(rowsWiderThan(rows, innerWidth(NARROW))).toEqual([]);
    expect(rows.length).toBeGreaterThan(1);
  });

  test("B3 at 80 columns a 300-character URL does not make a band row wider than the band", async ($) => {
    const rows = await bandRows($, URL, NARROW);

    expect(rowsWiderThan(rows, innerWidth(NARROW))).toEqual([]);
    expect(rows.length).toBeGreaterThan(1);
  });

  test("B4 at 200 columns emoji, CJK and a 300-character URL together stay inside the band", async ($) => {
    const rows = await bandRows($, MIXED_TEXT, WIDE);

    expect(rowsWiderThan(rows, innerWidth(WIDE))).toEqual([]);
    expect(rows.length).toBeGreaterThan(1);
  });

  test("B5 a 300-character URL broken across band rows loses no character", async ($) => {
    const rows = await bandRows($, URL, NARROW);

    expect(rows.length).toBeGreaterThan(1);
    expect(rows.map((row) => row.text).join("")).toContain(URL);
  });
});

describe("control characters in the prompt", () => {
  test("C1 an ESC sequence in the prompt does not reach the drawing", async ($) => {
    const user = await mountUser($, ESCAPE_TEXT, NARROW);

    expect(stringsOf(await rootOf(user)).filter((text) => CONTROL_CHARACTER.test(text))).toEqual(
      [],
    );
  });
});

function toolProps(id: string, tool: string) {
  return {
    tool_use_id: id,
    tool,
    input: {},
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
  };
}

function mountGroup($: Engine, calls: ReturnType<typeof toolProps>[]) {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "ToolGroup",
    props: { calls, isActive: false, isExpanded: false },
    viewport: { columns: NARROW, rows: 24 },
  });
}

function mountUser($: Engine, text: string, columns: number) {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "UserMessage",
    props: { text, origin: { kind: "composer" }, isExpanded: false },
    viewport: { columns, rows: 24 },
  });
}

async function claudeRoots($: Engine, columns: number): Promise<Tree[]> {
  const viewport = { columns, rows: 24 };
  const reply = await mountReply($, "Hello world", columns);
  const group = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "ToolGroup",
    props: {
      calls: [
        {
          tool_use_id: "g1",
          tool: "Read",
          input: {},
          isRunning: false,
          isErrored: false,
          isInterrupted: false,
        },
      ],
      isActive: false,
      isExpanded: false,
    },
    viewport,
  });
  const call = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "ToolUse",
    props: {
      tool_use_id: "c1",
      tool: "Bash",
      input: {},
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
    },
    viewport,
  });
  const footer = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "TurnDuration",
    props: { word: "Baked", durationMs: 5000 },
    viewport,
  });
  return Promise.all([reply, group, call, footer].map(rootOf));
}

function mountReply($: Engine, text: string, columns: number) {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "AssistantMessage",
    props: { text, isFirstOfReply: true },
    viewport: { columns, rows: 24 },
  });
}

async function bandRows($: Engine, text: string, columns: number): Promise<Row[]> {
  const user = await mountUser($, text, columns);
  return bandBoxes(await rootOf(user)).map((box) => ({
    cells: cellsOf(textOf(box)),
    text: textOf(box).slice(0, -BAND_SUFFIX_CELLS),
  }));
}

async function rootOf(mounted: Drawn): Promise<Tree> {
  return (await mounted.drawn()) as Tree;
}

function innerWidth(columns: number): number {
  return columns - TEXT_COLUMN_CELLS - RIGHT_GUTTER_CELLS;
}

function flushRightRows(tree: Tree): Tree[] {
  const own = tree.type === "Box" && tree.props?.justifyContent === FLUSH_RIGHT ? [tree] : [];
  return [...own, ...childTrees(tree).flatMap(flushRightRows)];
}

function rowsWiderThan(rows: Row[], width: number): Row[] {
  return rows.filter((row) => row.cells > width);
}

function bandBoxes(tree: Tree): Tree[] {
  const own = tree.type === "Box" && tree.props?.backgroundColor === palette.userBand ? [tree] : [];
  return [...own, ...childTrees(tree).flatMap(bandBoxes)];
}

function childTrees(tree: Tree): Tree[] {
  return (tree.children ?? []).filter(
    (child): child is Tree => typeof child === "object" && child !== null,
  );
}

function textOf(tree: Tree): string {
  return (tree.children ?? [])
    .map((child) => (typeof child === "string" ? child : textOf(child as Tree)))
    .join("");
}

function stringsOf(tree: Tree): string[] {
  return (tree.children ?? []).flatMap((child) =>
    typeof child === "string" ? [child] : stringsOf(child as Tree),
  );
}

function cellsOf(text: string): number {
  return [...text].reduce(
    (sum, character) => sum + (isWide(character.codePointAt(0) ?? 0) ? 2 : 1),
    0,
  );
}

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    code === 0x2705 ||
    code === 0x274c ||
    code === 0x2b50 ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x1f900 && code <= 0x1f9ff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}
