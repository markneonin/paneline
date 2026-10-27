import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";

import { displayWidth } from "../hooks/text-width";
import { palette } from "../hooks/palette";
import { replyLook } from "../hooks/reply-look";
import { collect, findText, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import { isHeavy } from "./weight";

const BUILD_TIME_BOUND_MS = 3000;
const LONG_CELL = "word ".repeat(24).trim();

describe("tables", () => {
  test("TB1 no row of a 4-column table with a long cell is wider than the reply width", async ($) => {
    const text = table(["A", "B", "C", "D"], [["short", LONG_CELL, "x", `${LONG_CELL} more`]]);

    for (const width of [40, 80, 200]) {
      const lines = await linesOf($, text, width);
      expect(lines.length).toBeGreaterThan(4);
      for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(width);
    }
  });

  test("TB2 a --: column ends flush right and a :-: column is centred", async ($) => {
    const text = [
      "| Name | Size | Mid |",
      "| :-- | --: | :-: |",
      "| a.ts | 12kB | ab |",
      "| bbbbbb | 3 | abcdefg |",
    ].join("\n");

    const lines = await linesOf($, text, 80);

    expect(lines).toContain("│ a.ts   │ 12kB │   ab    │");
    expect(lines).toContain("│ bbbbbb │    3 │ abcdefg │");
    expect(lines).toContain("│ Name   │ Size │   Mid   │");
  });

  test("TB3 a 120-character cell wraps inside its column and separators appear", async ($) => {
    const lines = await linesOf(
      $,
      table(
        ["A", "B"],
        [
          ["x", "word ".repeat(24).trim()],
          ["y", "z"],
        ],
      ),
      40,
    );

    expect(lines.some((line) => line.startsWith("├") && line.includes("┼"))).toBe(true);
    expect(lines.filter((line) => line.startsWith("│")).length).toBeGreaterThan(4);
  });

  test("TB4 a table where no cell wraps has no separator row", async ($) => {
    const lines = await linesOf(
      $,
      table(
        ["Name", "Size"],
        [
          ["a", "1"],
          ["b", "2"],
          ["c", "3"],
        ],
      ),
      80,
    );

    expect(lines.some((line) => line.startsWith("├"))).toBe(false);
    expect(lines[0]).toBe("┌──────┬──────┐");
    expect(lines[2]).toBe("╞══════╪══════╡");
    expect(lines.at(-1)).toBe("└──────┴──────┘");
  });

  test("TB5 a wide-character cell keeps every border in the same column", async ($) => {
    const lines = await linesOf(
      $,
      table(
        ["Name", "Size"],
        [
          ["漢字テスト", "1"],
          ["abc", "2"],
        ],
      ),
      80,
    );

    const bordered = lines.filter((line) => line.startsWith("│"));
    expect(bordered).toHaveLength(3);
    const widths = new Set(lines.map((line) => displayWidth(line)));
    expect(widths.size).toBe(1);
    const borderColumns = bordered.map((line) => columnsOfBorders(line));
    expect(new Set(borderColumns.map((columns) => columns.join(","))).size).toBe(1);
  });

  test("TB6 a 6-column table at 30 columns is drawn as Header: value records", async ($) => {
    const headers = ["One", "Two", "Three", "Four", "Five", "Six"];
    const text = table(headers, [
      ["aaaaaaaa", "b", "c", "d", "e", "f"],
      ["g", "h", "i", "j", "k", "l"],
    ]);

    const lines = await linesOf($, text, 30);

    expect(lines).toContain("One: aaaaaaaa");
    expect(lines).toContain("Six: l");
    expect(lines.some((line) => /^─+$/.test(line))).toBe(true);
    expect(lines.some((line) => line.includes("┌"))).toBe(false);
  });

  test("TB7 inline code in a cell is in the code colour and bold in the strong colour", async ($) => {
    const look = replyLook(null);
    const tree = await treeOf($, table(["A", "B"], [["`x.ts`", "**bold**"]]), 80);

    expect(findText(tree, "x.ts")?.props?.color).toBe(look.code);
    expect(findText(tree, "bold")?.props?.color).toBe(look.strong);
    expect(isHeavy(findText(tree, "bold")?.props)).toBe(true);
    expect(look.code).toBe(palette.button);
  });

  test("TB9 a 9-column table at 180 columns keeps every word whole and, when words cannot fit, falls back to records", async ($) => {
    const headers = [
      "Name",
      "Description",
      "Owner",
      "Status",
      "Priority",
      "Due",
      "Estimate",
      "Link",
      "Notes",
    ];
    const row = [
      "Terminal",
      "Terminal automation for the release pipeline with careful retries",
      "platform-team",
      "In progress",
      "High",
      "2026-11-01",
      "3 weeks",
      "https://example.com/",
      "Needs review before the freeze",
    ];
    const words = new Set(row.flatMap((cell) => cell.split(" ")).concat(headers));

    for (const width of [180, 120]) {
      const lines = await linesOf($, table(headers, [row]), width);
      const drawn = new Set(
        lines.flatMap((line) => line.split(/[\s│]+/)).map((token) => token.replace(/:$/, "")),
      );
      for (const word of words) expect(drawn).toContain(word);
    }
  });

  test("TB8 a 300-row by 6-column table is drawn whole at 80 columns with no line wider than the reply", async ($) => {
    const headers = ["A", "B", "C", "D", "E", "F"];
    const row = ["alpha beta", "gamma", "delta epsilon zeta", "eta", "theta iota", "kappa"];
    const text = table(
      headers,
      Array.from({ length: 300 }, () => row),
    );

    const started = performance.now();
    const lines = await linesOf($, text, 80);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(BUILD_TIME_BOUND_MS);
    expect(lines.filter((line) => line.includes("alpha")).length).toBeGreaterThanOrEqual(300);
    expect(lines.filter((line) => line.includes("kappa")).length).toBeGreaterThanOrEqual(300);
    for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(80);
  });

  test("TB10 a header-only table whose columns do not fit still draws its header words", async ($) => {
    const headers = ["Nomenclature", "Description", "Responsibility", "Classification", "Estimate"];

    const lines = await linesOf($, table(headers, []), 40);

    const drawn = lines.join(" ");
    for (const header of headers) expect(drawn).toContain(header);
    for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(40);
  });
});

function columnsOfBorders(line: string): number[] {
  const columns: number[] = [];
  let at = 0;
  for (const char of line) {
    if (char === "│") columns.push(at);
    at += displayWidth(char);
  }
  return columns;
}

function table(headers: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}

async function treeOf($: Engine, text: string, columns: number): Promise<Node> {
  const ui = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "AssistantMessage",
    props: { text, isFirstOfReply: false },
    viewport: { columns, rows: 24 },
  });
  return await ui.drawn();
}

async function linesOf($: Engine, text: string, columns: number): Promise<string[]> {
  const tree = await treeOf($, text, columns);
  return collect(tree, "Text")
    .filter((node) => node.props?.wrap === "truncate-end")
    .map(textOf);
}
