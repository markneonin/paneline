import { describe, expect, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

import { palette } from "../hooks/palette";
import { replyLook } from "../hooks/reply-look";
import { accentOf } from "../hooks/session-color";
import { screenRows } from "./band-screen";
import { childrenOf, collect, diagramRows, findText, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";

const FENCE = "```";
const TERMINAL_COLUMNS = 80;
const WIDE_COLUMNS = 250;
const WIDE_ART_SOURCE = [
  "flowchart LR",
  "  A[Receive the request] --> B[Validate the payload] --> C[Store the record] --> D[Notify the owner]",
  "  D --> E[Close the ticket] --> F[Archive everything] --> G[Audit the trail] --> H[Report the totals] --> I[Review the report]",
].join("\n");
const CHAT_BULLET = "promptBorder";
const FRUIT =
  "# Fruit report\n\n- apple\n- pear\n- plum\n\nA plain paragraph here.\n\nSome **important** words";
const RED = accentOf("red");
const ENGINE_DRAWING = "engine drew this reply";
const NEAR_RIGHT_EDGE = TERMINAL_COLUMNS - 10;
const HEBREW_WORDS = ["שלום", "עולם", "בית", "ספר", "מים", "יום", "לילה", "דרך"];
const ARABIC_WORDS = ["مرحبا", "كتاب", "بيت", "ماء", "يوم", "ليل"];
const WORDS_PAST_ONE_ROW = 30;
const WORDS_FOR_TWO_QUOTE_ROWS = 18;
const HEBREW_LETTER = /\p{Script=Hebrew}/u;
const BULLET_WIDTH = " •".length;
const LIST_INDENT = 2;

describe("code blocks", () => {
  test("R1 a short ts block is a panel with a Code body and the Copy button on its band", async ($, on) => {
    mockClipboard(on);
    const source = "const answer = 42\nconsole.log(answer)";

    const ui = await mountReply($, fenced("ts", source));

    const code = await ui.find({ type: "Code" });
    expect(code?.props.source).toBe(source);
    expect(code?.props.language).toBe("ts");
    expect(await ui.find({ type: "Button", text: "Copy" })).toBeDefined();
  });

  test("R2 a block of 10,000 characters is drawn by Code, one of 10,001 is a panel of plain text with Copy", async ($, on) => {
    mockClipboard(on);
    const atLimit = codeOfLength(10_000);
    const pastLimit = codeOfLength(10_001);

    const limit = await mountReply($, fenced("ts", atLimit));
    const past = await mountReply($, fenced("ts", pastLimit));

    expect((await limit.find({ type: "Code" }))?.props.source).toHaveLength(10_000);
    expect(await past.find({ type: "Code" })).toBeUndefined();
    expect(await past.find({ type: "Text", text: pastLimit.split("\n")[0]! })).toBeDefined();
    expect(await past.find({ type: "Button", text: "Copy" })).toBeDefined();
  });
});

describe("reply blocks", () => {
  test("R10 H1 is a round box in the accent colour and H2 is a heavy rule as wide as its label", async ($, on) => {
    mockClipboard(on);
    mockSessionColor(on, "red");

    const ui = await mountReply($, "# Big title\n\n## Label\n\nbody");
    const tree = await drawnOf(ui);

    const box = collect(tree, "Box").find((node) => node.props?.borderStyle === "round");
    expect(box?.props?.borderColor).toBe(RED);
    expect(textOf(box!)).toBe("Big title");
    expect(findText(tree, "━".repeat(5))?.props?.color).toBe(RED);
  });

  test("R11 under /color red bullets, the quote bar and bold are red", async ($, on) => {
    mockClipboard(on);
    mockSessionColor(on, "red");

    const tree = await drawnOf(await mountReply($, "- item\n\n> said\n\nsome **loud** words"));

    expect(findText(tree, "• ")?.props?.color).toBe(RED);
    expect(findText(tree, "│ ")?.props?.color).toBe(RED);
    expect(findText(tree, "loud")?.props?.color).toBe(RED);
  });

  test("R11b under the default colour bold is the user text colour", async ($, on) => {
    mockClipboard(on);
    mockSessionColor(on, "default");

    const tree = await drawnOf(await mountReply($, "some **loud** words"));

    expect(findText(tree, "loud")?.props?.color).toBe(palette.userText);
  });

  test("R22 a ### heading with no /color set is drawn in the user text colour, bold", async ($, on) => {
    mockClipboard(on);
    mockSessionColor(on, "default");

    const tree = await drawnOf(await mountReply($, "### Result\n\nbody"));

    const heading = findText(tree, "Result");
    expect(heading?.props?.color).toBe(palette.userText);
    expect(heading?.props?.weight).toBe("semibold");
  });

  test("R12 a ts block with a title is a panel named by it with a Code body, Copy and no vertical border", async ($, on) => {
    mockClipboard(on);

    const tree = await drawnOf(await mountReply($, '```ts title="a.ts"\nconst a = 1\n```'));

    expect(findText(tree, "a.ts")?.props?.color).toBe(palette.userText);
    expect(collect(tree, "Code")).toHaveLength(1);
    expect(collect(tree, "Button").map((button) => button.props?.label)).toContain("Copy");
    expect(JSON.stringify(tree)).not.toContain("│");
    expect(JSON.stringify(tree)).not.toContain("borderStyle");
  });

  test("R20 every Text on the code panel band, and the Copy button box, carries the band background", async ($, on) => {
    mockClipboard(on);
    const { band } = replyLook(null);

    for (const text of [fenced("ts", "const a = 1"), '```ts title="a.ts"\nconst a = 1\n```']) {
      const tree = await drawnOf(await mountReply($, text));

      const row = collect(tree, "Box").find(
        (node) => node.props?.flexDirection === "row" && node.props.backgroundColor === band,
      )!;
      const texts = collect(row, "Text");
      expect(texts.length).toBeGreaterThanOrEqual(5);
      for (const node of texts) expect(node.props?.backgroundColor).toBe(band);
      const buttonBox = collect(row, "Box").find((box) => collect(box, "Button").length === 1);
      expect(buttonBox?.props?.backgroundColor).toBe(band);
    }
  });

  test("R13 an unlabeled block is titled code", async ($, on) => {
    mockClipboard(on);

    const tree = await drawnOf(await mountReply($, "```\nplain\n```"));

    expect(findText(tree, "code")).toBeDefined();
  });

  test("R14 a CAUTION alert has the failed colour border and starts with Caution", async ($, on) => {
    mockClipboard(on);

    const tree = await drawnOf(await mountReply($, "> [!CAUTION]\n> Do not do this"));

    const box = collect(tree, "Box").find((node) => node.props?.borderStyle === "round");
    expect(box?.props?.borderColor).toBe(palette.failed);
    expect(textOf(childrenOf(box!)[0]!).startsWith("Caution")).toBe(true);
    expect(textOf(box!)).toContain("Do not do this");
  });

  test("R15 a done task is struck and muted with a green check", async ($, on) => {
    mockClipboard(on);

    const tree = await drawnOf(await mountReply($, "- [x] shipped\n- [ ] later"));

    const struck = findText(tree, "shipped");
    expect(struck?.props?.strikethrough).toBe(true);
    expect(struck?.props?.color).toBe(palette.muted);
    expect(findText(tree, "✓")?.props?.color).toBe(palette.ok);
    expect(findText(tree, "[ ] ")?.props?.color).toBe(palette.muted);
  });

  test("R16 a markdown link is a Link with its href", async ($, on) => {
    mockClipboard(on);

    const tree = await drawnOf(await mountReply($, "see [the site](https://x.dev) now"));

    const link = collect(tree, "Link")[0];
    expect(link?.props?.href).toBe("https://x.dev");
    expect(textOf(link!)).toBe("the site");
  });

  test("R17 a nested list shows a bullet then a hollow bullet and a wrapped item hangs under its text", async ($, on) => {
    mockClipboard(on);
    const long = "word ".repeat(40).trim();

    const tree = await drawnOf(await mountReply($, `- top\n  - inner\n- ${long}`));

    expect(findText(tree, "• ")).toBeDefined();
    expect(findText(tree, "◦ ")).toBeDefined();
    const rows = collect(tree, "Box").filter((node) => node.props?.flexDirection === "row");
    const wrapped = rows.find((row) => textOf(row).includes("word word"))!;
    const [marker, text] = childrenOf(wrapped);
    expect(marker?.props?.flexShrink).toBe(0);
    expect(text?.props?.flexGrow).toBe(1);
  });

  test("R18 a half-streamed reply draws without an error and keeps an unclosed ** as text", async ($, on) => {
    mockClipboard(on);
    const text = "| A | B |\n\n> [!NOTE]\n\n**bold\n\n```ts\nconst x";

    const tree = await drawnOf(await mountReply($, text));

    expect(textOf(tree)).toContain("**bold");
    expect(collect(tree, "Code")).toHaveLength(1);
  });

  test("R19 a quote wrapped to 3 rows has a bar on each row", async ($, on) => {
    mockClipboard(on);
    const text = `> ${"word ".repeat(50).trim()}`;

    const tree = await drawnOf(await mountReply($, text, { columns: 60 }));

    const bars = collect(tree, "Text").filter((node) => textOf(node).startsWith("│ "));
    expect(bars.length).toBeGreaterThanOrEqual(3);
    for (const bar of bars) expect(textOf(bar).length).toBeLessThanOrEqual(60);
  });
});

describe("mermaid diagrams", () => {
  test("R5 a 9-box diagram is redrawn top-down at 80 columns and stays one row of boxes at 250 columns", async ($, on) => {
    mockClipboard(on);
    const text = [`${FENCE}mermaid`, WIDE_ART_SOURCE, FENCE].join("\n");

    const narrow = await mountReply($, text, { columns: TERMINAL_COLUMNS });
    const wide = await mountReply($, text, { columns: WIDE_COLUMNS });

    const narrowRows = diagramRows(await drawnOf(narrow));
    const wideRows = diagramRows(await drawnOf(wide));
    expect(await narrow.find({ type: "Code" })).toBeUndefined();
    expect(narrowRows.filter((row) => row.includes("▼"))).toHaveLength(8);
    expect(narrowRows.every((row) => (row.match(/┌/g) ?? []).length <= 1)).toBe(true);
    expect(await wide.find({ type: "Code" })).toBeUndefined();
    expect(wideRows).toHaveLength(3);
    expect((wideRows[0]!.match(/┌/g) ?? []).length).toBe(9);
    expect(wideRows[1]).toMatch(
      /Receive the request.*►.*Validate the payload.*►.*Review the report/,
    );
  });
});

describe("copying", () => {
  test("R6 a reply drawn again still copies its code and shows Copied", async ($, on) => {
    const clipboard = mockClipboard(on);
    const source = "const redrawn = true";
    const text = fenced("ts", source);
    const first = await mountReply($, text);
    await first.unmount();

    const again = await mountReply($, text);
    await again.press({ key: "copy-b0" });

    expect(await again.find({ type: "Code" })).toBeDefined();
    expect(clipboard.copied).toEqual([source]);
    expect(clipboard.toasts).toEqual(["Copied"]);
  });

  test("R7 a reply that keeps growing under a finished code block still copies that block", async ($, on) => {
    const clipboard = mockClipboard(on);
    const source = "const growing = 1";
    const code = fenced("ts", source);
    const ui = await mountReply($, code);

    await ui.redraw({ text: `${code}\n\nMore words arrive under the code.`, isFirstOfReply: true });
    await ui.press({ key: "copy-b0" });

    expect(await ui.find({ type: "Code" })).toBeDefined();
    expect(clipboard.copied).toEqual([source]);
    expect(clipboard.toasts).toEqual(["Copied"]);
  });

  test('R8 a refused copy shows "Could not copy here"', async ($, on) => {
    const clipboard = mockClipboard(on, { isRefusing: true });
    const ui = await mountReply($, fenced("ts", "const refused = 1"));

    await ui.press({ key: "copy-b0" });

    expect(clipboard.toasts).toEqual(["Could not copy here"]);
  });
});

describe("very long replies", () => {
  test("R9 a reply of 60,001 characters is left to the engine to draw", async ($, on) => {
    mockClipboard(on);
    on("ui.render", { component: "AssistantMessage" }, ($, e) => {
      const { Text } = $.ui.resolve(e);
      return <Text>{ENGINE_DRAWING}</Text>;
    });

    const ui = await mountReply($, paragraphsOfLength(60_001));

    expect(await ui.find({ type: "Text", text: ENGINE_DRAWING })).toBeDefined();
  });
});

describe("reply colours", () => {
  for (const theme of ["light", "dark"]) {
    test(`R21 under ${theme} the chat reply draws its heading, list items, paragraph and bold in the text colour and its bullets in the prompt border colour`, async ($, on) => {
      mockClipboard(on);
      on("config.list", () => ({ value: [{ key: "theme", value: theme }] }) as never);

      const tree = await drawnOf(await mountReply($, FRUIT));

      const runs = collect(tree, "Text")
        .filter((node) => childrenOf(node).length === 0)
        .map((node) => [textOf(node), node.props?.color]);
      expect(runs.slice(2)).toEqual([
        ["Fruit report", palette.text],
        ["• ", CHAT_BULLET],
        ["apple", palette.text],
        ["• ", CHAT_BULLET],
        ["pear", palette.text],
        ["• ", CHAT_BULLET],
        ["plum", palette.text],
        ["A plain paragraph here.", palette.text],
        ["important", palette.text],
      ]);
    });
  }
});

describe("right-to-left replies", () => {
  test("RTL1 a Hebrew paragraph wider than the reply ends every row at the right edge and reads right to left", async ($, on) => {
    mockClipboard(on);
    const text = wordsOf(HEBREW_WORDS, WORDS_PAST_ONE_ROW);

    const { tree, rows } = await drawnReply($, text);

    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(new Set(rows.map((row) => row.length))).toEqual(new Set([rows[0]!.length]));
    expect(rows[0]!.length).toBeGreaterThanOrEqual(NEAR_RIGHT_EDGE);
    const rightToLeft = collect(tree, "Text").filter((node) => node.props?.dir === "rtl");
    expect(rightToLeft).toHaveLength(rows.length);
  });

  test("RTL2 a one-row Hebrew paragraph sits at the right edge", async ($, on) => {
    mockClipboard(on);

    const { rows } = await drawnReply($, wordsOf(HEBREW_WORDS, 2));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.length).toBeGreaterThanOrEqual(NEAR_RIGHT_EDGE);
  });

  test("RTL3 Hebrew bullets sit at the right end of their row and nested ones step in from the right", async ($, on) => {
    mockClipboard(on);
    const text = [
      `- ${wordsOf(HEBREW_WORDS, 3)}`,
      `  - ${wordsOf(HEBREW_WORDS, 2)}`,
      `    - ${wordsOf(HEBREW_WORDS, 1)}`,
    ].join("\n");

    const { rows } = await drawnReply($, text);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatch(/•$/);
    expect(rows[1]).toMatch(/◦$/);
    expect(rows[2]).toMatch(/▪$/);
    expect(rows[0]!.length).toBeGreaterThanOrEqual(NEAR_RIGHT_EDGE);
    expect(rows[1]!.length).toBe(rows[0]!.length - LIST_INDENT);
    expect(rows[2]!.length).toBe(rows[0]!.length - 2 * LIST_INDENT);
  });

  test("RTL4 Hebrew numbered and task items have their number and checkbox at the right end of the row", async ($, on) => {
    mockClipboard(on);
    const text = [
      `1. ${wordsOf(HEBREW_WORDS, 2)}`,
      "",
      `- [ ] ${wordsOf(HEBREW_WORDS, 2)}`,
      `- [x] ${wordsOf(HEBREW_WORDS, 2)}`,
    ].join("\n");

    const { rows } = await drawnReply($, text);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatch(/ 1\.$/);
    expect(rows[1]).toMatch(/ \[ \]$/);
    expect(rows[2]).toMatch(/ \[✓\]$/);
    for (const row of rows) expect(row.length).toBeGreaterThanOrEqual(NEAR_RIGHT_EDGE);
  });

  test("RTL5 the second row of a long Hebrew bullet ends under its own text, not under the bullet", async ($, on) => {
    mockClipboard(on);

    const { rows } = await drawnReply($, `- ${wordsOf(HEBREW_WORDS, WORDS_PAST_ONE_ROW)}`);

    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]).toMatch(/•$/);
    expect(rows[1]).not.toMatch(/•$/);
    expect(rows[1]!.length).toBe(rows[0]!.length - BULLET_WIDTH);
  });

  test("RTL6 a list that opens in Hebrew keeps every bullet on the right, even for an English item", async ($, on) => {
    mockClipboard(on);
    const text = `- ${wordsOf(HEBREW_WORDS, 2)}\n- English item here`;

    const { rows } = await drawnReply($, text);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/•$/);
    expect(rows[1]).toMatch(/•$/);
    expect(rows[1]!.length).toBe(rows[0]!.length);
  });

  test("RTL7 a Hebrew quote over two rows ends each row with the accent bar at the right edge", async ($, on) => {
    mockClipboard(on);

    const { tree, rows } = await drawnReply(
      $,
      `> ${wordsOf(HEBREW_WORDS, WORDS_FOR_TWO_QUOTE_ROWS)}`,
    );

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatch(/│$/);
      expect(row).not.toMatch(/^│/);
      expect(row.length).toBe(rows[0]!.length);
    }
    expect(rows[0]!.length).toBeGreaterThanOrEqual(NEAR_RIGHT_EDGE);
    const bars = collect(tree, "Text").filter((node) => textOf(node).includes("│"));
    expect(bars.length).toBeGreaterThanOrEqual(2);
    for (const bar of bars) expect(textOf(bar)).not.toMatch(HEBREW_LETTER);
  });

  test("RTL8 a Hebrew H1 is a round box at the right edge", async ($, on) => {
    mockClipboard(on);

    const tree = await drawnOf(await mountReply($, `# ${wordsOf(HEBREW_WORDS, 2)}`));

    const box = collect(tree, "Box").find((node) => node.props?.borderStyle === "round");
    expect(box?.props?.alignSelf).toBe("flex-end");
  });

  test("RTL9 a Hebrew H2 label and its heavy rule both end at the right edge", async ($, on) => {
    mockClipboard(on);
    const label = wordsOf(HEBREW_WORDS, 2);

    const { rows } = await drawnReply($, `## ${label}`);

    expect(rows).toHaveLength(2);
    expect(rows[1]).toBe(
      `${" ".repeat(rows[1]!.length - label.length)}${"━".repeat(label.length)}`,
    );
    expect(rows[0]!.length).toBe(rows[1]!.length);
    expect(rows[1]!.length).toBeGreaterThanOrEqual(NEAR_RIGHT_EDGE);
  });

  test("RTL10 a Hebrew H3 label is flush right", async ($, on) => {
    mockClipboard(on);

    const { rows } = await drawnReply($, `### ${wordsOf(HEBREW_WORDS, 2)}`);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.length).toBeGreaterThanOrEqual(NEAR_RIGHT_EDGE);
  });

  test("RTL11 a Hebrew note alert has its title and its lines flush right inside the box", async ($, on) => {
    mockClipboard(on);
    const line = wordsOf(HEBREW_WORDS, 3);

    const { tree, rows } = await drawnReply($, `> [!NOTE]\n> ${line}`);

    const title = rows.find((row) => row.includes("Note"))!;
    const body = rows.find((row) => row.includes(line))!;
    expect(title.length).toBe(body.length);
    expect(body.length).toBeGreaterThanOrEqual(NEAR_RIGHT_EDGE);
    expect(collect(tree, "Text").some((node) => node.props?.dir === "rtl")).toBe(true);
  });

  test("RTL12 an Arabic paragraph goes right, an English one stays left without a direction, the code panel is as before", async ($, on) => {
    mockClipboard(on);
    const arabic = wordsOf(ARABIC_WORDS, 3);
    const english = "Plain English paragraph.";
    const code = fenced("ts", "const answer = 42");

    const mixed = await drawnReply($, [arabic, english, code].join("\n\n"));
    const codeAlone = await drawnReply($, code);

    expect(mixed.rows[0]!.length).toBeGreaterThanOrEqual(NEAR_RIGHT_EDGE);
    expect(mixed.rows[1]).toBe(english);
    const englishTexts = collect(mixed.tree, "Text").filter((node) => textOf(node) === english);
    expect(englishTexts.length).toBeGreaterThan(0);
    for (const node of englishTexts) expect(node.props?.dir).toBeUndefined();
    expect(mixed.rows.slice(2)).toEqual(codeAlone.rows);
  });

  test("RTL13 a paragraph that starts with English stays left although it holds Hebrew, and the Hebrew paragraph after it goes right", async ($, on) => {
    mockClipboard(on);
    const latinFirst = `Claude ${wordsOf(HEBREW_WORDS, 2)}`;

    const { tree, rows } = await drawnReply($, `${latinFirst}\n\n${wordsOf(HEBREW_WORDS, 2)}`);

    expect(rows[0]).toBe(latinFirst);
    expect(rows[1]!.length).toBeGreaterThanOrEqual(NEAR_RIGHT_EDGE);
    const latinTexts = collect(tree, "Text").filter((node) => textOf(node) === latinFirst);
    expect(latinTexts.length).toBeGreaterThan(0);
    for (const node of latinTexts) expect(node.props?.dir).toBeUndefined();
  });

  test("RTL14 a paragraph of only digits and punctuation stays left, and the Hebrew paragraph after it goes right", async ($, on) => {
    mockClipboard(on);
    const digits = "2024 - 15% (3/4).";

    const { rows } = await drawnReply($, `${digits}\n\n${wordsOf(HEBREW_WORDS, 2)}`);

    expect(rows[0]).toBe(digits);
    expect(rows[1]!.length).toBeGreaterThanOrEqual(NEAR_RIGHT_EDGE);
  });

  test("RTL15 a half-streamed Hebrew bullet with an unclosed ** draws on the right and keeps the ** as text", async ($, on) => {
    mockClipboard(on);

    const { rows } = await drawnReply($, `- ${wordsOf(HEBREW_WORDS, 2)} **${HEBREW_WORDS[2]}`);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/•$/);
    expect(rows[0]).toContain("**");
  });
});

type Clipboard = { copied: string[]; toasts: string[] };

function mockClipboard(on: On, { isRefusing = false }: { isRefusing?: boolean } = {}): Clipboard {
  const clipboard: Clipboard = { copied: [], toasts: [] };
  on("ui.toast", (_$, e) => {
    clipboard.toasts.push(e.text);
    return { value: undefined };
  });
  on("ui.copy", (_$, e) => {
    if (isRefusing) return { deny: "clipboard unavailable" };
    clipboard.copied.push(e.text);
    return { value: { isCopied: true } };
  });
  return clipboard;
}

function mountReply(
  $: Engine,
  text: string,
  {
    columns = TERMINAL_COLUMNS,
    isFirstOfReply = true,
  }: { columns?: number; isFirstOfReply?: boolean } = {},
) {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "AssistantMessage",
    props: { text, isFirstOfReply },
    viewport: { columns, rows: 24 },
  });
}

function fenced(language: string, source: string): string {
  return [`${FENCE}${language}`, source, FENCE].join("\n");
}

function codeOfLength(length: number): string {
  const lineLength = 80;
  const fullLines = Math.floor((length - 1) / (lineLength + 1));
  const lastLength = length - fullLines * (lineLength + 1);
  const lines = Array.from({ length: fullLines }, (_, i) => `row${i}`.padEnd(lineLength, "x"));
  return [...lines, "z".repeat(lastLength)].join("\n");
}

function paragraphsOfLength(length: number): string {
  const paragraph = `${"a".repeat(98)}\n\n`;
  return (
    paragraph.repeat(Math.floor(length / paragraph.length)) + "b".repeat(length % paragraph.length)
  );
}

function mockSessionColor(on: On, colorName: string): void {
  on("state.get", (_$, e, next) =>
    e.key === "sessionColor" ? { value: { value: colorName, version: 1 } } : next(e),
  );
}

async function drawnOf(ui: { drawn(): Promise<unknown> }): Promise<Node> {
  return (await ui.drawn()) as Node;
}

function wordsOf(words: string[], count: number): string {
  return Array.from({ length: count }, (_, i) => words[i % words.length]!).join(" ");
}

async function drawnReply($: Engine, text: string): Promise<{ tree: Node; rows: string[] }> {
  const tree = await drawnOf(await mountReply($, text, { isFirstOfReply: false }));
  const rows = screenRows(tree, TERMINAL_COLUMNS)
    .map((row) => row.trimEnd())
    .filter((row) => row !== "");
  return { tree, rows };
}
