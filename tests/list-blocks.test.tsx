import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";
import { screenRows } from "./band-screen";
import { collect, diagramPanels } from "./draw-tree";
import type { Node } from "./draw-tree";

const FENCE = "```";
const WIDE = 120;
const FLOWCHART = ["flowchart LR", "  A[one] --> B[two]"].join("\n");

describe("blocks inside list items", () => {
  test("L1 a diagram under a list item is drawn inside that item", async ($) => {
    const text = [
      "- first step",
      `  ${FENCE}mermaid`,
      `  ${FLOWCHART.replace("\n", "\n  ")}`,
      `  ${FENCE}`,
    ].join("\n");

    const tree = await drawnReply($, text);

    expect(diagramPanels(tree)).toHaveLength(1);
    expect(
      boxesWithPadding(tree).filter((box) => diagramPanels(box).length === 1),
    ).not.toHaveLength(0);
  });

  test("L2 a code fence under a list item is drawn inside that item", async ($) => {
    const text = ["1. run it", `   ${FENCE}sh`, "   npm test", `   ${FENCE}`, "2. done"].join("\n");

    const tree = await drawnReply($, text);

    const item = boxesWithPadding(tree).find((box) => collect(box, "Code").length === 1);
    expect(item).toBeDefined();
  });
});

function boxesWithPadding(tree: Node): Node[] {
  return collect(tree, "Box").filter((box) => box.props?.paddingLeft !== undefined);
}

async function drawnReply($: Engine, text: string): Promise<Node> {
  const ui = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "AssistantMessage",
    props: { text, isFirstOfReply: true },
    viewport: { columns: WIDE, rows: 24 },
  });
  return ui.drawn();
}

const COLUMNS = 60;
const TEXT_COLUMN = 3;
const CODE_CARD_BLANK_ROWS = 3;
const GAP_AFTER_NESTED_CODE = 1;
const BLANK_ROWS_AFTER_NESTED_CODE = CODE_CARD_BLANK_ROWS + GAP_AFTER_NESTED_CODE;
const CODE = ["   ```ts", "   const a = 1;", "   ```"];
const DIAGRAM = ["   ```mermaid", "   flowchart TD", "     A[A] --> B[B]", "   ```"];
const OPEN_FRAME = /^ +\[ Open \]$/;
const DIAGRAM_ROWS = ["┌───┐", "│ A │", "└─┬─┘", "  ▼", "┌───┐", "│ B │", "└───┘"];
const INDENT = " ".repeat(TEXT_COLUMN);

describe("spacing of nested blocks", () => {
  for (const [name, gap] of [
    ["no blank line in the source", []],
    ["a blank line in the source", [""]],
  ] as const) {
    test(`L3 a diagram sits right below its item with the Open row first and one blank row above the next, ${name}`, async ($) => {
      const text = ["1. First", ...gap, ...DIAGRAM, "2. Second"].join("\n");

      const ui = await mountText($, text);

      const rows = screenRows(await ui.drawn(), COLUMNS).map((row) => row.trimEnd());
      const [first, header, ...rest] = rows;
      expect(first).toBe("1. First");
      expect(header).toMatch(OPEN_FRAME);
      expect(rest).toEqual([...DIAGRAM_ROWS.map((row) => INDENT + row), "", "2. Second"]);
      const buttons = await ui.findAll({ type: "Button" });
      expect(buttons.map((button) => button.props.label)).toEqual(["Open"]);
    });

    test(`L4 a code block sits one blank row below its item, starts at the text column and has no extra blank row after it, ${name}`, async ($) => {
      const text = ["1. First", ...gap, ...CODE, "2. Second"].join("\n");

      const rows = await drawnRows($, text);

      expect(rows[0]).toBe("1. First");
      expect(rows[1]).toBe("");
      expect(rows[2]).toMatch(/^ {3}▌ ts/);
      expect(rows.slice(3, -1)).toEqual(Array<string>(BLANK_ROWS_AFTER_NESTED_CODE).fill(""));
      expect(rows.at(-1)).toBe("2. Second");
    });
  }
});

describe("blank lines between items that hold blocks", () => {
  const text = [
    "1. First item",
    "",
    ...CODE,
    "",
    "2. Second item",
    "",
    ...DIAGRAM,
    "",
    "3. Third item after",
  ].join("\n");

  test("L5 one blank row separates a diagram from the next item", async ($) => {
    const rows = await drawnRows($, text);

    const diagramEnd = rows.findIndex((row) => row.includes("└───┘"));
    expect(rows.slice(diagramEnd + 1)).toEqual(["", "3. Third item after"]);
  });

  test("L6 one blank row separates a code block from the next item", async ($) => {
    const rows = await drawnRows($, text);

    const second = rows.indexOf("2. Second item");
    expect(rows.slice(second - BLANK_ROWS_AFTER_NESTED_CODE, second)).toEqual(
      Array<string>(BLANK_ROWS_AFTER_NESTED_CODE).fill(""),
    );
    expect(rows[second - BLANK_ROWS_AFTER_NESTED_CODE - 1]).toMatch(/^ {3}▌ ts/);
  });
});

async function drawnRows($: Engine, text: string): Promise<string[]> {
  const ui = await mountText($, text);
  return screenRows(await ui.drawn(), COLUMNS).map((row) => row.trimEnd());
}

function mountText($: Engine, text: string) {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "AssistantMessage",
    props: { text, isFirstOfReply: false },
    viewport: { columns: COLUMNS, rows: 40 },
  });
}
