import { describe, expect, test } from "claude-code/testing";
import * as markdown from "../hooks/markdown";
import type { Block, CodeBlock, Inline, TableBlock } from "../hooks/markdown";
import { displayWidth, wrapRuns } from "../hooks/text-width";

const { parse, plainOf, runsOf } = markdown;
const cleanText = (text: string): string => markdown.cleanText(text);

const FENCE4 = "````";
const FENCE3 = "```";

describe("code fences", () => {
  test("A1 four backticks around an inner triple-backtick fence make one code block", () => {
    const text = [FENCE4, "before", FENCE3 + "js", "inside", FENCE3, "after", FENCE4].join("\n");

    const blocks = parse(text);

    expect(blocks).toHaveLength(1);
    expect(codeBlockOf(text).lines).toEqual(["before", FENCE3 + "js", "inside", FENCE3, "after"]);
  });

  test("A2 four tildes around an inner triple-tilde fence make one code block", () => {
    const text = ["~~~~", "before", "~~~", "inside", "~~~", "after", "~~~~"].join("\n");

    const blocks = parse(text);

    expect(blocks).toHaveLength(1);
    expect(codeBlockOf(text).lines).toEqual(["before", "~~~", "inside", "~~~", "after"]);
  });

  test("A3 a fence still waiting for its closing line is marked open", () => {
    const text = [FENCE3 + "ts", "const a = 1"].join("\n");

    expect(codeBlockOf(text).isClosed).toBe(false);
  });

  test("A4 the same text with its closing line added is marked closed", () => {
    const text = [FENCE3 + "ts", "const a = 1", FENCE3].join("\n");

    expect(codeBlockOf(text).isClosed).toBe(true);
  });

  test("A5 a fence that is only an opening line is an open block with no lines", () => {
    const text = FENCE3 + "ts";

    const block = codeBlockOf(text);

    expect(block.isClosed).toBe(false);
    expect(block.lines).toEqual([]);
  });

  test("A6 a four-backtick fence is not closed by a triple-backtick line", () => {
    const text = [FENCE4, "code", FENCE3].join("\n");

    const block = codeBlockOf(text);

    expect(block.isClosed).toBe(false);
    expect(block.lines).toEqual(["code", FENCE3]);
  });

  test("A7 a triple-backtick fence is closed by a longer backtick line and the text after it is a separate paragraph", () => {
    const text = [FENCE3, "code", "`````", "after"].join("\n");

    const blocks = parse(text);

    expect(codeBlockOf(text).isClosed).toBe(true);
    expect(blocks.map((block) => block.kind)).toEqual(["code", "paragraph"]);
  });

  test("A8 a backtick fence is not closed by a tilde line", () => {
    const text = [FENCE3, "code", "~~~", "more"].join("\n");

    const block = codeBlockOf(text);

    expect(block.isClosed).toBe(false);
    expect(block.lines).toEqual(["code", "~~~", "more"]);
  });

  test("A9 a four-backtick fence keeps its language label", () => {
    const text = [FENCE4 + "ts", "const a = 1", FENCE4].join("\n");

    expect(codeBlockOf(text).lang).toBe("ts");
  });
});

const PARSE_TIME_BOUND_MS = 2000;

describe("table cells", () => {
  test("A10 header cells show their text without the code marks", () => {
    const text = ["| `x` | name |", "| --- | --- |", "| 1 | 2 |"].join("\n");

    expect(tableOf(text).header.map(plainOf)).toEqual(["x", "name"]);
    expect(tableOf(text).header[0]).toEqual([{ kind: "code", text: "x" }]);
  });

  test("A11 body cells show their text without the bold marks", () => {
    const text = ["| a | b |", "| --- | --- |", "| **y** | plain |", "| a **b** c | `d` |"].join(
      "\n",
    );

    expect(tableOf(text).rows.map((row) => row.map(plainOf))).toEqual([
      ["y", "plain"],
      ["a b c", "d"],
    ]);
  });
});

describe("raw source of a block", () => {
  test("A12 a paragraph keeps its own source lines, not the lines of the blocks before it", () => {
    const text = ["# Title", "", "line one", "line two", "", "tail"].join("\n");

    const blocks = parse(text);

    expect(rawOf(blocks[1]!)).toBe("line one\nline two");
  });

  test("A13 a table keeps its header, divider and body lines", () => {
    const lines = ["| a | b |", "| --- | --- |", "| **y** | `x` |"];

    const blocks = parse(lines.join("\n"));

    expect(rawOf(blocks[0]!)).toBe(lines.join("\n"));
  });

  test("A14 a closed code block keeps its fence lines and its code", () => {
    const lines = [FENCE3 + "ts", "const a = 1", "const b = 2", FENCE3];

    const blocks = parse(lines.join("\n"));

    expect(rawOf(blocks[0]!)).toBe(lines.join("\n"));
  });

  test("A15 a tilde block with an inner shorter fence keeps every line", () => {
    const lines = ["~~~~", "a", "~~~", "b", "~~~~"];

    const blocks = parse(lines.join("\n"));

    expect(rawOf(blocks[0]!)).toBe(lines.join("\n"));
  });
});

describe("cleaning text", () => {
  test("A16 carriage returns are removed and line breaks stay", () => {
    expect(cleanText("one\r\ntwo\r\n")).toBe("one\ntwo\n");
  });

  test("A17 the escape character is removed", () => {
    expect(cleanText("red\x1b[31m text")).toBe("red text");
  });

  test("A18 other control characters are removed", () => {
    expect(cleanText("a\x00b\x07c")).toBe("abc");
  });

  test("A19 tabs and line breaks are kept", () => {
    expect(cleanText("a\tb\nc")).toBe("a\tb\nc");
  });

  test("A21 a line of exactly 10,000 characters is kept whole", () => {
    expect(cleanText("x".repeat(10000))).toHaveLength(10000);
  });

  test("A22 a line of 10,001 characters loses only its last character", () => {
    expect(cleanText("x".repeat(10000) + "y")).toBe("x".repeat(10000));
  });

  test("A23 a long line does not cut the lines around it", () => {
    const text = ["before", "x".repeat(20000), "after"].join("\n");

    expect(cleanText(text).split("\n")).toEqual(["before", "x".repeat(10000), "after"]);
  });

  test("A24 empty text stays empty", () => {
    expect(cleanText("")).toBe("");
  });
});

describe("parsing dirty text", () => {
  test("A25 a paragraph shows no escape character", () => {
    const blocks = parse("one \x1b[0m two\r\nthree");

    expect(inlineTextOf(blocks[0]!)).toBe("one  two three");
  });

  test("A26 a 20,000 character line of code is shown as 10,000 characters", () => {
    const text = [FENCE3, "y".repeat(20000), FENCE3].join("\n");

    expect(codeBlockOf(text).lines).toEqual(["y".repeat(10000)]);
  });

  test("A27 a code line shows no escape character", () => {
    const text = [FENCE3, "\x1b[1mbold\x1b[0m", FENCE3].join("\n");

    expect(codeBlockOf(text).lines).toEqual(["bold"]);
  });
});

describe("long answers", () => {
  test("A28 an answer of 20,000 paragraphs is parsed into one block per paragraph", () => {
    const text = Array.from({ length: 20000 }, (_, i) => `paragraph ${i}`).join("\n\n");

    const blocks = parse(text);

    expect(blocks).toHaveLength(20000);
    expect(inlineTextOf(blocks[19999]!)).toBe("paragraph 19999");
  });
});

type Located = { raw: string | string[]; isClosed: boolean };

function codeBlockOf(text: string): CodeBlock & Located {
  const block = parse(text).find((candidate): candidate is CodeBlock => candidate.kind === "code");
  return block as CodeBlock & Located;
}

function tableOf(text: string): TableBlock {
  return parse(text).find((candidate): candidate is TableBlock => candidate.kind === "table")!;
}

function rawOf(block: Block): string {
  const raw = (block as Block & Located).raw;
  return Array.isArray(raw) ? raw.join("\n") : raw;
}

function inlineTextOf(block: Block): string {
  return block.kind === "paragraph" ? plainOf(block.inline) : "";
}

function blockOf<K extends Block["kind"]>(text: string, kind: K): Extract<Block, { kind: K }> {
  return parse(text).find((block) => block.kind === kind) as Extract<Block, { kind: K }>;
}

function inlineOf(text: string): Inline[] {
  return (parse(text)[0] as { inline: Inline[] }).inline;
}

describe("inline markup", () => {
  test("A29 emphasis nests inside strong", () => {
    expect(inlineOf("**a _b_ c**")).toEqual([
      {
        kind: "strong",
        children: [
          { kind: "text", text: "a " },
          { kind: "emphasis", children: [{ kind: "text", text: "b" }] },
          { kind: "text", text: " c" },
        ],
      },
    ]);
  });

  test("A30 a double-backtick span keeps a single backtick inside as one code node", () => {
    expect(inlineOf("``a`b``")).toEqual([{ kind: "code", text: "a`b" }]);
  });

  test("A31 a code span padded with one space on both ends loses one space on each end", () => {
    expect(inlineOf("`` a ``")).toEqual([{ kind: "code", text: "a" }]);
  });

  test("A32 snake_case_name and a spaced multiplication stay plain text", () => {
    expect(inlineOf("snake_case_name")).toEqual([{ kind: "text", text: "snake_case_name" }]);
    expect(inlineOf("2 * 3 * 4")).toEqual([{ kind: "text", text: "2 * 3 * 4" }]);
  });

  test("A33 a markdown link keeps its href and a bare url loses its final dot", () => {
    expect(inlineOf("[docs](https://x.dev)")).toEqual([
      { kind: "link", href: "https://x.dev", children: [{ kind: "text", text: "docs" }] },
    ]);
    expect(inlineOf("see https://x.dev/a.")).toEqual([
      { kind: "text", text: "see " },
      {
        kind: "link",
        href: "https://x.dev/a",
        children: [{ kind: "text", text: "https://x.dev/a" }],
      },
      { kind: "text", text: "." },
    ]);
  });

  test("A34 a strong marker that is never closed stays literal text", () => {
    expect(inlineOf("**open")).toEqual([{ kind: "text", text: "**open" }]);
  });

  test("A35 a backslash makes the next marker literal", () => {
    expect(inlineOf("\\*a\\*")).toEqual([{ kind: "text", text: "*a*" }]);
  });

  test("A36 strike and a link label with markup are parsed", () => {
    expect(inlineOf("~~x~~ [**b**](u)")).toEqual([
      { kind: "strike", children: [{ kind: "text", text: "x" }] },
      { kind: "text", text: " " },
      {
        kind: "link",
        href: "u",
        children: [{ kind: "strong", children: [{ kind: "text", text: "b" }] }],
      },
    ]);
  });

  test("A37 a 60,000 character reply with 2,000 unmatched markers is shown as plain text up to the 10,000 character line cap", () => {
    const text = Array.from(
      { length: 2000 },
      (_, i) => `${i % 2 ? "_" : "*"}w${"x".repeat(26)}`,
    ).join(" ");

    const started = performance.now();
    const blocks = parse(text);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(PARSE_TIME_BOUND_MS);
    expect(text.length).toBeGreaterThan(55000);
    expect(blocks).toHaveLength(1);
    expect(inlineTextOf(blocks[0]!)).toBe(text.slice(0, 10000));
  });
});

describe("table structure", () => {
  test("A38 an escaped pipe stays a pipe inside its cell", () => {
    const text = ["| a | b |", "| --- | --- |", "| a \\| b | c |"].join("\n");

    expect(plainOf(tableOf(text).rows[0]![0]!)).toBe("a | b");
    expect(tableOf(text).rows[0]).toHaveLength(2);
  });

  test("A39 the divider gives left, center and right alignment", () => {
    const text = ["| a | b | c | d |", "| --- | :-: | --: | :-- |"].join("\n");

    expect(tableOf(text).align).toEqual(["left", "center", "right", "left"]);
  });

  test("A40 a short body row is padded and a long one is cut to the header count", () => {
    const text = ["| a | b | c |", "| --- | --- | --- |", "| 1 |", "| 1 | 2 | 3 | 4 |"].join("\n");

    const rows = tableOf(text).rows.map((row) => row.map(plainOf));

    expect(rows).toEqual([
      ["1", "", ""],
      ["1", "2", "3"],
    ]);
  });

  test("A41 a table with only a header and a divider has no rows", () => {
    expect(tableOf(["| a | b |", "| --- | --- |"].join("\n")).rows).toEqual([]);
  });
});

describe("block kinds", () => {
  test("A42 a warning alert has its title, and an unknown marker is a quote that keeps its text", () => {
    const alert = blockOf("> [!WARNING] Disk\n> almost full", "alert");
    const quote = blockOf("> [!FOO] x", "quote");

    expect(alert.level).toBe("warning");
    expect(plainOf(alert.title)).toBe("Disk");
    expect(alert.lines.map(plainOf)).toEqual(["almost full"]);
    expect(quote.lines.map(plainOf)).toEqual(["[!FOO] x"]);
  });

  test("A43 a quote strips every leading marker and keeps an empty row", () => {
    const quote = blockOf("> one\n>\n> > two", "quote");

    expect(quote.lines.map(plainOf)).toEqual(["one", "", "two"]);
  });

  test("A44 task boxes give done and open at their depths", () => {
    const list = blockOf("- [x] done\n  - [ ] open\n1. plain", "list");

    expect(
      list.items.map((item) => [item.depth, item.task, item.ordered, plainOf(item.inline)]),
    ).toEqual([
      [0, "done", false, "done"],
      [1, "open", false, "open"],
      [0, null, true, "plain"],
    ]);
  });

  test("A45 an indented line under an item joins that item with one space", () => {
    const list = blockOf("- first\n  second\n- next", "list");

    expect(list.items.map((item) => plainOf(item.inline))).toEqual(["first second", "next"]);
  });

  test("A61 a fence indented under an item belongs to that item", () => {
    const text = ["- first", "  " + FENCE3 + "js", "  code", "  " + FENCE3, "- second"].join("\n");

    const list = blockOf(text, "list");

    expect(parse(text).map((block) => block.kind)).toEqual(["list"]);
    expect(list.items.map((item) => item.blocks.map((block) => block.lines))).toEqual([
      [["  code"]],
      [],
    ]);
  });

  test("A62 a fence after a blank line under an item stays in that item and the next item keeps its number", () => {
    const text = ["1. first", "", "   " + FENCE3, "   code", "   " + FENCE3, "2. second"].join(
      "\n",
    );

    const list = blockOf(text, "list");

    expect(parse(text).map((block) => block.kind)).toEqual(["list"]);
    expect(list.items.map((item) => [item.marker, item.blocks.length])).toEqual([
      ["1.", 1],
      ["2.", 0],
    ]);
  });

  test("A63 an unindented line after a blank line still ends the list", () => {
    const text = ["- first", "", "plain"].join("\n");

    expect(parse(text).map((block) => block.kind)).toEqual(["list", "paragraph"]);
  });

  test("A46 a dash line between two paragraphs is a rule block", () => {
    const kinds = parse("one\n\n---\n\ntwo").map((block) => block.kind);

    expect(kinds).toEqual(["paragraph", "rule", "paragraph"]);
  });

  test("A47 a heading drops its closing hashes and keeps its markup", () => {
    const heading = blockOf("## Title ##", "heading");
    const marked = blockOf("# a **b**", "heading");

    expect(heading.level).toBe(2);
    expect(plainOf(heading.inline)).toBe("Title");
    expect(marked.inline.map((node) => node.kind)).toEqual(["text", "strong"]);
  });

  for (const source of ["***both***", "___both___", "**_both_**", "*__both__*"]) {
    test(`triple or mixed marks ${source} draw one bold italic run with no marks left`, () => {
      const runs = runsOf(inlineOf(`x ${source} y`));

      expect(runs.map((run) => [run.text, run.style.strong, run.style.emphasis])).toEqual([
        ["x ", false, false],
        ["both", true, true],
        [" y", false, false],
      ]);
    });
  }

  test("A48 runsOf flattens the tree with the styles of every level", () => {
    const runs = runsOf(inlineOf("**a _b_** [c](u)"));

    expect(
      runs.map((run) => [run.text, run.style.strong, run.style.emphasis, run.style.href]),
    ).toEqual([
      ["a ", true, false, undefined],
      ["b", true, true, undefined],
      [" ", false, false, undefined],
      ["c", false, false, "u"],
    ]);
  });
});

describe("display width", () => {
  test("A49 wide characters count two columns and combining marks and joined emoji count by grapheme", () => {
    expect(displayWidth("漢字")).toBe(4);
    expect(displayWidth("👍")).toBe(2);
    expect(displayWidth("é")).toBe(1);
    expect(displayWidth("e\u0301")).toBe(1);
    expect(displayWidth("👨\u200d👩\u200d👧")).toBe(2);
    expect(displayWidth("abc")).toBe(3);
  });

  test("A50 wrapRuns never makes a row wider than the width and keeps a style across a split", () => {
    const runs = [
      { text: "short ", style: "plain" },
      { text: "averyveryverylongstyledwordthatmustsplit", style: "bold" },
      { text: " 漢字漢字漢字", style: "plain" },
    ];

    const rows = wrapRuns(runs, 10);

    expect(rows.every((row) => displayWidth(row.map((piece) => piece.text).join("")) <= 10)).toBe(
      true,
    );
    expect(
      rows
        .flat()
        .filter((piece) => piece.style === "bold")
        .map((piece) => piece.text)
        .join(""),
    ).toBe("averyveryverylongstyledwordthatmustsplit");
    expect(rows.length).toBeGreaterThan(3);
  });

  test("A52 a bare url inside bold stops before the closing marks", () => {
    expect(inlineOf("**https://x.dev**")).toEqual([
      {
        kind: "strong",
        children: [
          {
            kind: "link",
            href: "https://x.dev",
            children: [{ kind: "text", text: "https://x.dev" }],
          },
        ],
      },
    ]);
  });

  test("A53 a pipe line followed by a one-cell rule is a paragraph and a rule, not a table", () => {
    expect(parse(["a | b", "---"].join("\n")).map((block) => block.kind)).toEqual([
      "paragraph",
      "rule",
    ]);
    expect(parse(["a | b", "--- | ---"].join("\n")).map((block) => block.kind)).toEqual(["table"]);
  });

  test("A51 wrapRuns drops edge spaces and merges neighbours of the same style", () => {
    const rows = wrapRuns(
      [
        { text: "ab ", style: "x" },
        { text: "cd", style: "x" },
        { text: " ef", style: "y" },
      ],
      5,
    );

    expect(rows).toEqual([[{ text: "ab cd", style: "x" }], [{ text: "ef", style: "y" }]]);
  });
});

describe("setext headings", () => {
  test("A54 an equals line under a text line draws a level 1 heading", () => {
    const heading = blockOf("Title\n=====", "heading");

    expect(heading.level).toBe(1);
    expect(plainOf(heading.inline)).toBe("Title");
  });

  test("A55 a dash line under a text line draws a level 2 heading", () => {
    const heading = blockOf("Section\n---", "heading");

    expect(heading.level).toBe(2);
    expect(plainOf(heading.inline)).toBe("Section");
  });

  test("A56 every line of a paragraph above an underline is one heading", () => {
    const blocks = parse("first\nsecond\n===");

    expect(blocks.map((block) => block.kind)).toEqual(["heading"]);
    expect(plainOf((blocks[0] as Extract<Block, { kind: "heading" }>).inline)).toBe("first second");
  });

  test("A57 a dash line with no text above it stays a thematic break", () => {
    expect(parse("---\nafter").map((block) => block.kind)).toEqual(["rule", "paragraph"]);
  });

  test("A58 an equals line with no text above it stays a paragraph", () => {
    expect(parse("===").map((block) => block.kind)).toEqual(["paragraph"]);
  });

  test("A59 a table row above an underline is not a heading", () => {
    expect(parse("a | b\n===").map((block) => block.kind)).toEqual(["paragraph"]);
    expect(parse("a | b\n---").map((block) => block.kind)).toEqual(["paragraph", "rule"]);
  });

  test("A60 a list item above an underline is not a heading", () => {
    expect(parse("- item\n===").map((block) => block.kind)).toEqual(["list", "paragraph"]);
    expect(parse("- item\n---").map((block) => block.kind)).toEqual(["list", "rule"]);
  });
});
