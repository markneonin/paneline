import { describe, expect, mock, test } from "claude-code/testing";
import type { On, SessionContextBreakdown, SessionContextUsage } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { palette } from "../hooks/palette";
import { coloursOfText, screenRows, colouredPieces } from "./band-screen";
import { collect, findText, labelledTextOf } from "./draw-tree";
import { linesOf } from "./skills-tree";
import type { Node as DrawNode } from "./draw-tree";
import { pressPagedTab } from "./clear-world";
import { isHeavy } from "./weight";

type Pane = Mounted<"terminal", "Pane">;
type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] };
type UsageCall = { breakdown?: string; columns?: number };
type StateWrite = { key: string; value: unknown };

const COLUMNS = 100;
const NARROW_COLUMNS = 16;
const MID_COLUMNS = 50;
const NARROW_SHARE_COLUMNS = 60;
const FULL_GRID_COLUMNS = 80;
const TALL_PANE_ROWS = 60;
const WIDE_SIDE_BY_SIDE_WIDTH = 81;
const COLUMNS_BESIDE_TEN_GRID = 61;
const GRID_WIDTHS = [60, 120];
const WIDE_GRID_ROWS = 10;
const WIDE_GRID_ROW = `${"⛁ ".repeat(18)}⛶ ⛝`;
const EXPLAINER_WIDTHS = [60, 80, 120];
const SHORT_PANE_ROWS = 8;
const NOW = 200_000;
const LEGEND_NAMES = ["Messages", "System prompt", "Free space", "Autocompact buffer"];
const LEGEND_GLYPHS = ["⛁", "⛶", "⛝"];
const DEFERRED_ROW = /^\s*\S\s+MCP tools(?: \(deferred\))?\s+30k\s+tokens/u;
const DEFERRED_NOTE = "loaded only when used, not in the total";
const BUFFER_EXPLAINER = "· kept free for auto-compact";
const COMPACT_EXPLAINER = "· summarise the chat to free space";
const BUFFER_NOTE = "kept free for auto-compact";
const COMPACT_NOTE = "summarise the chat to free space";
const DEFERRED_NUMBER = "30k";
const OWN_ROW_WIDTHS = [60, 80];
const SPACER_WIDTHS = [60, 80, 120];
const COMPACT_WRAP_COLUMNS = 46;
const MCP_TAB_LABEL = "MCP tab";
const SKILLS_TAB_LABEL = "Skills tab";
const BODY_OFFSET_KEY = "bodyOffset";
const SCROLLED_ROWS = 12;
const MEASURED_TOKENS = 46_400;
const MEASURED_SHARE = "29% to auto-compact";
const GROWN_TOKENS = 80_000;
const GROWN_SHARE = "50% to auto-compact";
const WINDOW_SHARE_LINE = "48k/200k tokens (24% of window)";
const AUTO_COMPACT_OFF_TOKENS = 70_000;
const AUTO_COMPACT_OFF_PERCENT = 35;
const AUTO_COMPACT_WORDS = "to auto-compact";

const FIXTURE = {
  categories: [
    {
      name: "System prompt",
      tokens: 8_000,
      color: "promptBorder",
      isDeferred: false,
      kind: "used",
    },
    {
      name: "MCP tools (deferred)",
      tokens: 30_000,
      color: "success",
      isDeferred: true,
      kind: "deferred",
    },
    { name: "Messages", tokens: 40_000, color: "permission", isDeferred: false, kind: "used" },
    {
      name: "Autocompact buffer",
      tokens: 40_000,
      color: "inactive",
      isDeferred: false,
      kind: "buffer",
    },
    { name: "Free space", tokens: 112_000, color: "subtle", isDeferred: false, kind: "free" },
  ],
  totalTokens: 48_000,
  maxTokens: 200_000,
  rawMaxTokens: 200_000,
  percentage: 24,
  model: "Opus 5.5",
  gridRows: [
    [
      { color: "promptBorder", categoryName: "System prompt", squareFullness: 1 },
      { color: "permission", categoryName: "Messages", squareFullness: 1 },
      { color: "permission", categoryName: "Messages", squareFullness: 0.4 },
      { color: "subtle", categoryName: "Free space", squareFullness: 1 },
      { color: "inactive", categoryName: "Autocompact buffer", squareFullness: 1 },
    ],
  ],
  memoryFiles: [
    { path: "/home/u/CLAUDE.md", type: "User", tokens: 1_200 },
    { path: "/work/AGENTS.md", type: "Project", tokens: 300 },
  ],
  mcpTools: [
    { name: "mcp__linear__a", serverName: "linear", tokens: 0, isLoaded: false },
    { name: "mcp__linear__b", serverName: "linear", tokens: 0, isLoaded: false },
    { name: "mcp__docs__c", serverName: "docs", tokens: 0, isLoaded: false },
  ],
  agents: [{ agentType: "reviewer", source: "projectSettings", tokens: 900 }],
  skills: { totalSkills: 9, includedSkills: 7, tokens: 2_500, skillFrontmatter: [] },
  autoCompactThreshold: 160_000,
  isAutoCompactEnabled: true,
} as unknown as SessionContextBreakdown;

const WITH_LONG_CATEGORY = {
  ...FIXTURE,
  categories: [
    ...FIXTURE.categories,
    {
      name: "Compacted earlier conversation",
      tokens: 5_000,
      color: "permission",
      isDeferred: false,
      kind: "used",
    },
  ],
} as unknown as SessionContextBreakdown;

const WIDE_GRID_FIXTURE = {
  ...FIXTURE,
  gridRows: Array.from({ length: 10 }, () => [
    ...Array.from({ length: 18 }, () => ({
      color: "permission",
      categoryName: "Messages",
      squareFullness: 1,
    })),
    { color: "subtle", categoryName: "Free space", squareFullness: 1 },
    { color: "inactive", categoryName: "Autocompact buffer", squareFullness: 1 },
  ]),
} as unknown as SessionContextBreakdown;

const TEN_GRID_FIXTURE = {
  ...FIXTURE,
  gridRows: Array.from({ length: 10 }, () =>
    Array.from({ length: 10 }, () => ({
      color: "permission",
      categoryName: "Messages",
      squareFullness: 1,
    })),
  ),
} as unknown as SessionContextBreakdown;

const AUTO_COMPACT_OFF_FIXTURE = {
  ...FIXTURE,
  autoCompactThreshold: undefined,
  isAutoCompactEnabled: false,
} as unknown as SessionContextBreakdown;

describe("context tab", () => {
  test("C1 the header shows the model, then used over the window with the engine percent and one decimal of k", async ($, on) => {
    worldOf(on);

    const rows = await rowTexts(await paneOnTab($, "Context"));

    expect(rows).toContain("Opus 5.5");
    expect(rows).toContain("48k/200k tokens (24% of window)");
  });

  test("C2 the grid is drawn glyph by glyph, the partial square as a small jar, free and buffer as their own glyphs", async ($, on) => {
    worldOf(on);

    const pane = await paneOnTab($, "Context");

    const gridRow = (await pane.findAll({ type: "Text" })).find(
      (found) => textOf(found as Node) === "⛁ ⛁ ⛀ ⛶ ⛝",
    ) as Node | undefined;
    expect(gridRow).toBeDefined();
  });

  for (const theme of ["dark", "dark-daltonized"]) {
    test(`TH6 under ${theme} every grid square is drawn in the colour the engine gives its category`, async ($, on) => {
      worldOf(on);
      themeOf(on, theme);

      const pane = await paneOnTab($, "Context");

      const gridRow = (await pane.findAll({ type: "Text" })).find(
        (found) => textOf(found as Node) === "⛁ ⛁ ⛀ ⛶ ⛝",
      ) as Node;
      expect(elementsIn(gridRow).map((square) => square.props?.color)).toEqual([
        "promptBorder",
        "permission",
        "permission",
        "subtle",
        "inactive",
      ]);
    });

    test(`TH6b under ${theme} every legend glyph is drawn in the colour the engine gives its category`, async ($, on) => {
      worldOf(on);
      themeOf(on, theme);

      const pane = await paneOnTab($, "Context");

      expect(await legendGlyphColors(pane)).toEqual({
        Messages: "permission",
        "System prompt": "promptBorder",
        "Free space": "subtle",
        "Autocompact buffer": "inactive",
      });
    });
  }

  test("TH7b with a 20 by 10 grid just below 81 columns the header and legend stack under the grid and every legend name reads whole", async ($, on) => {
    worldOf(on, WIDE_GRID_FIXTURE);

    const pane = await mountedOnTab($, "Context", WIDE_SIDE_BY_SIDE_WIDTH - 1);

    expect(await besideGridBoxes(pane)).toHaveLength(0);
    const rows = screenRows(await pane.drawn(), WIDE_SIDE_BY_SIDE_WIDTH - 1);
    for (const name of ["Messages", "System prompt", "MCP tools (deferred)", "Autocompact buffer"])
      expect(legendRowOf(rows, name)).toContain(name);
  });

  test("TH7c with a 20 by 10 grid at 81 columns the header and legend sit beside the grid", async ($, on) => {
    worldOf(on, WIDE_GRID_FIXTURE);

    const pane = await mountedOnTab($, "Context", WIDE_SIDE_BY_SIDE_WIDTH);

    expect(await besideGridBoxes(pane)).toHaveLength(1);
  });

  test("TH7d with a 10 by 10 grid at 61 columns the header and legend still sit beside the grid", async ($, on) => {
    worldOf(on, TEN_GRID_FIXTURE);

    const pane = await mountedOnTab($, "Context", COLUMNS_BESIDE_TEN_GRID);

    expect(await besideGridBoxes(pane)).toHaveLength(1);
  });

  for (const width of GRID_WIDTHS) {
    test(`TH7 at ${width} columns a 20 by 10 grid reaches the screen with all 20 squares of a row and the category in the far columns`, async ($, on) => {
      worldOf(on, WIDE_GRID_FIXTURE);

      const pane = await mountedOnTab($, "Context", width);

      const gridRows = screenRows(await pane.drawn(), width).filter((row) =>
        row.trimStart().startsWith(WIDE_GRID_ROW),
      );
      expect(
        gridRows,
        screenRows(await pane.drawn(), width)
          .slice(0, 14)
          .join("\n"),
      ).toHaveLength(WIDE_GRID_ROWS);
    });
  }

  test("C3 the legend lists non-deferred categories by tokens descending with free space and the buffer last", async ($, on) => {
    worldOf(on);

    const pane = await paneOnTab($, "Context");

    const rows = screenRows(await pane.drawn(), COLUMNS);
    expect(rows.flatMap((row) => LEGEND_NAMES.filter((name) => row.includes(name)))).toEqual([
      "Messages",
      "System prompt",
      "Free space",
      "Autocompact buffer",
    ]);
  });

  test("C4 the deferred category is one legend row with its glyph, its name and 30k tokens, with no percent, and its note says it is not in the total", async ($, on) => {
    worldOf(on);

    const pane = await paneOnTab($, "Context");

    const rows = screenRows(await pane.drawn(), COLUMNS).map((row) => row.trimEnd());
    const row = deferredRowOf(rows);
    expect(row.includes("%")).toBe(false);
    expect(rows.some((candidate) => candidate.includes(DEFERRED_NOTE))).toBe(true);
  });

  test("C5 sections give a bold title with a muted hint and an item count with tokens beneath", async ($, on) => {
    worldOf(on);

    const pane = await paneOnTab($, "Context");

    const rows = await rowTexts(pane);
    expect(rows).toEqual(
      expect.arrayContaining([
        "MCP tools · [ MCP tab ]",
        "└ 3 tools · 0 tokens",
        "Custom agents · .claude/agents/",
        "└ 1 agent · 900 tokens",
        "Memory files · /memory",
        "└ 2 files · 1.5k tokens",
        "Skills · [ Skills tab ]",
        "└ 9 skills · 2.5k tokens",
      ]),
    );
    expect(await colorsOf(pane, "└ 3 tools · 0 tokens")).toEqual([palette.muted]);
  });

  test("C6 a wide pane puts the header and legend beside the grid", async ($, on) => {
    worldOf(on);

    const pane = await paneOnTab($, "Context");

    expect(await besideGridBoxes(pane)).toHaveLength(1);
  });

  test("C6b a pane under 60 columns stacks the header and legend under the grid", async ($, on) => {
    worldOf(on);

    const pane = await mountedOnTab($, "Context", MID_COLUMNS);

    expect(await besideGridBoxes(pane)).toHaveLength(0);
  });

  test("C7 the body opens with content right under the tab bar gap and the sections are separated by blank rows", async ($, on) => {
    worldOf(on);

    const body = await contextBody(await paneOnTab($, "Context"));

    const blanks = elementsIn(body as unknown as Node).map(
      (child) => child.type === "Box" && child.props?.height === 1,
    );
    expect(blanks[0]).toBe(false);
    expect(blanks.filter(Boolean).length).toBeGreaterThanOrEqual(4);
  });

  test("C8 in a short pane the Context body keeps every row instead of being cut to the pane height", async ($, on) => {
    worldOf(on);

    const pane = await paneOnTab($, "Context", SHORT_PANE_ROWS);

    const clipped = collect(await pane.drawn(), "Box").filter(
      (box) =>
        box.props?.overflow === "hidden" &&
        typeof box.props.height === "number" &&
        box.props.height > 1,
    );
    expect(clipped).toEqual([]);
    expect(linesOf(await pane.drawn()).some((line) => line.text.includes("Free space"))).toBe(true);
  });

  test("C8b in a short pane the Context body ends on a cue counting the rows that are out of the window", async ($, on) => {
    worldOf(on);
    const pane = await paneOnTab($, "Context", SHORT_PANE_ROWS);
    const rows = linesOf(await pane.drawn()).length;

    await $.ui.scroll({
      component: "Pane",
      requestId: "session",
      offset: 0,
      by: 0,
      bodyRows: SHORT_PANE_ROWS,
      contentRows: rows,
      origin: { kind: "person" },
    });
    for (let tick = 0; tick < 5; tick++) await pane.redraw();

    const cue = collect(await pane.drawn(), "Box").find(
      (box) => box.props?.position === "absolute",
    );
    const shown =
      cue === undefined
        ? []
        : collect(cue, "Text").map((text) => textOf(text as unknown as Node).trim());
    expect(shown).toEqual([`… ${rows - SHORT_PANE_ROWS + 1} more lines`]);
  });
});

describe("context tab explainers", () => {
  test("C13 the Autocompact buffer legend row ends with a muted explainer after its percent", async ($, on) => {
    worldOf(on);

    const pane = await paneOnTab($, "Context");

    const row = legendRowOf(screenRows(await pane.drawn(), COLUMNS), "Autocompact buffer");
    expect(row.trimEnd()).toMatch(/\d(\.\d)?% · kept free for auto-compact$/u);
    expect(pieceColours(colouredPieces(await pane.drawn()), BUFFER_EXPLAINER)).toEqual([
      palette.muted,
    ]);
  });

  test("C14 the compact row ends with a muted explainer after the button", async ($, on) => {
    worldOf(on);

    const pane = await paneOnTab($, "Context");

    const row = screenRows(await pane.drawn(), COLUMNS).find((candidate) =>
      candidate.includes("[ compact ]"),
    );
    expect(row?.trimEnd()).toMatch(/\[ compact \] · summarise the chat to free space$/u);
    expect(pieceColours(colouredPieces(await pane.drawn()), COMPACT_EXPLAINER)).toEqual([
      palette.muted,
    ]);
  });

  for (const width of OWN_ROW_WIDTHS) {
    test(`C17 at ${width} columns the Autocompact buffer note on its own row reads kept free for auto-compact with no leading dot, muted`, async ($, on) => {
      worldOf(on);

      const pane = await mountedOnTab($, "Context", width);

      const drawn = await pane.drawn();
      const note = screenRows(drawn, width).find((row) => row.includes(BUFFER_NOTE));
      expect(note?.trim()).toBe(BUFFER_NOTE);
      expect(coloursOfText(drawn, BUFFER_NOTE)).toEqual([palette.muted]);
    });
  }

  test("C18 in a narrow pane the compact note on its own row reads summarise the chat to free space with no leading dot, muted", async ($, on) => {
    worldOf(on);

    const pane = await mountedOnTab($, "Context", COMPACT_WRAP_COLUMNS);

    const drawn = await pane.drawn();
    const rows = screenRows(drawn, COMPACT_WRAP_COLUMNS);
    const button = rows.findIndex((row) => row.includes("[ compact ]"));
    expect(rows[button]?.includes(COMPACT_NOTE)).toBe(false);
    expect(rows[button + 1]?.trim()).toBe(COMPACT_NOTE);
    expect(coloursOfText(drawn, COMPACT_NOTE)).toEqual([palette.muted]);
  });

  for (const width of SPACER_WIDTHS) {
    test(`C19 at ${width} columns the deferred row follows the legend with no blank row between, and its name, its 30k and its word tokens sit in the columns of the other legend rows`, async ($, on) => {
      worldOf(on);

      const pane = await mountedOnTab($, "Context", width);

      const rows = screenRows(await pane.drawn(), width).map((row) => row.trimEnd());
      const row = deferredRowOf(rows);
      const messages = legendRowOf(rows, "Messages");
      expect(rows[rows.indexOf(row) - 1]?.trim(), "the row above the deferred row").not.toBe("");
      expect(columnOf(row, "MCP tools")).toBe(columnOf(messages, "Messages"));
      expect(columnOf(row, "tokens")).toBe(columnOf(messages, "tokens"));
    });
  }

  test("C20 the deferred row shows its number 30k in the normal text colour and its word tokens and its note muted", async ($, on) => {
    worldOf(on);

    const pane = await paneOnTab($, "Context");

    const drawn = await pane.drawn();
    expect(coloursOfText(drawn, DEFERRED_NUMBER)).toEqual([palette.text]);
    expect(coloursOfText(drawn, DEFERRED_NOTE)).toEqual([palette.muted]);
  });

  test("C21 the deferred glyph is drawn in the colour the engine gives its category", async ($, on) => {
    worldOf(on);

    const pane = await paneOnTab($, "Context");

    const pieces = colouredPieces(await pane.drawn()).filter((piece) => piece.text.trim() !== "");
    const figure = pieces.findIndex((piece) => piece.text.trim() === DEFERRED_NUMBER);
    expect(figure, "the 30k figure").toBeGreaterThan(1);
    expect(pieces[figure - 1]?.text.trim()).toMatch(/^MCP tools/u);
    expect(pieces[figure - 2]?.color).toBe("success");
  });

  test("C22 the Free space legend row reads 112k tokens, with the word tokens muted and in the column of the Messages row's tokens", async ($, on) => {
    worldOf(on);

    const pane = await paneOnTab($, "Context");

    const drawn = await pane.drawn();
    const rows = screenRows(drawn, COLUMNS).map((row) => row.trimEnd());
    const free = legendRowOf(rows, "Free space");
    expect(free).toMatch(/112k\s+tokens/u);
    expect(columnOf(free, "tokens")).toBe(columnOf(legendRowOf(rows, "Messages"), "tokens"));
    const pieces = colouredPieces(drawn).filter((piece) => piece.text.trim() !== "");
    const figure = pieces.findIndex((piece) => piece.text.trim() === "112k");
    expect(pieces[figure + 1]?.text.trim()).toBe("tokens");
    expect(pieces[figure + 1]?.color).toBe(palette.muted);
  });

  test("C15 pressing MCP tab on the Context tab shows the MCP tab with its body back at the top", async ($, on) => {
    const writes = stateWritesOf(on);
    worldOf(on);
    const pane = await paneOnTab($, "Context");
    writes.length = 0;

    await pressButton(pane, MCP_TAB_LABEL);

    expect(lastWritten(writes, "tab")).toBe("mcp");
    expect(lastWritten(writes, BODY_OFFSET_KEY)).toBe(0);
  });

  test("C16 pressing Skills tab on the Context tab shows the Skills tab with its body back at the top", async ($, on) => {
    const writes = stateWritesOf(on);
    worldOf(on);
    const pane = await paneOnTab($, "Context");
    writes.length = 0;

    await pressButton(pane, SKILLS_TAB_LABEL);

    expect(lastWritten(writes, "tab")).toBe("skills");
    expect(lastWritten(writes, BODY_OFFSET_KEY)).toBe(0);
  });
});

describe("context tab explainers at pane widths", () => {
  for (const width of EXPLAINER_WIDTHS) {
    test(`F1 at ${width} columns each explainer reads whole and muted, with the legend name, its numbers and the compact button not cut`, async ($, on) => {
      worldOf(on);

      const pane = await mountedOnTab($, "Context", width);

      const drawn = await pane.drawn();
      const rows = screenRows(drawn, width).map((row) => row.trimEnd());
      expect(rows.some((row) => DEFERRED_ROW.test(row))).toBe(true);
      expect(rows.some((row) => row.includes(DEFERRED_NOTE))).toBe(true);
      expect(rows.some((row) => row.includes(BUFFER_NOTE))).toBe(true);
      expect(rows.some((row) => row.includes(COMPACT_NOTE))).toBe(true);
      expect(rows.some((row) => /40k tokens\s+20\.0%/u.test(row))).toBe(true);
      expect(rows.some((row) => row.includes("[ compact ]"))).toBe(true);
      expect(coloursOfText(drawn, BUFFER_NOTE)).toEqual([palette.muted]);
      expect(coloursOfText(drawn, COMPACT_NOTE)).toEqual([palette.muted]);
      expect(coloursOfText(drawn, DEFERRED_NUMBER)).toEqual([palette.text]);
      expect(coloursOfText(drawn, DEFERRED_NOTE)).toEqual([palette.muted]);
    });
  }
});

describe("context tab work", () => {
  test("C10 opening the tab asks once with the pane width, and a measure asks again only while it is shown", async ($, on) => {
    const calls = worldOf(on);

    const pane = await paneOnTab($, "Context");
    const asked = () => calls.filter((call) => call.columns !== undefined).length;
    const afterOpen = asked();
    await $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: ["context"] });
    await pane.redraw();
    const afterMeasure = asked();
    await showTab(pane, "Files");
    await $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: ["context"] });

    expect(calls.find((call) => call.columns !== undefined)).toEqual({
      breakdown: "full",
      columns: COLUMNS - 1,
    });
    expect(afterOpen).toBe(1);
    expect(afterMeasure).toBe(2);
    expect(asked()).toBe(2);
  });

  test("C11 a measure while the tab is open redraws the header with the new usage, with no press or redraw", async ($, on) => {
    const fixture = { ...FIXTURE };
    worldOf(on, fixture);
    const pane = await paneOnTab($, "Context");
    expect(await rowTexts(pane)).toContain("48k/200k tokens (24% of window)");
    fixture.totalTokens = 96_000;
    fixture.percentage = 48;

    await $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: ["context"] });

    expect(await rowTexts(pane)).toContain("96k/200k tokens (48% of window)");
  });

  test("C12 the tab reads its spend while the measure stamp is still being read", async ($, on) => {
    worldOf(on);
    let spendRead: () => void = () => undefined;
    const spendAsked = new Promise<void>((resolve) => {
      spendRead = resolve;
    });
    on("state.get", async (_$, e, next) => {
      if (e.key === "spend") spendRead();
      if (e.key === "measureStamp") await spendAsked;
      return next(e);
    });

    const rows = await rowTexts(await paneOnTab($, "Context"));

    expect(rows).toContain("Opus 5.5");
  });
});

describe("context tab grid size", () => {
  test("C9 a pane narrower than 80 columns still asks for the full-resolution grid", async ($, on) => {
    const calls = worldOf(on);

    await mountedOnTab($, "Context", MID_COLUMNS);

    expect(calls.find((call) => call.columns !== undefined)?.columns).toBe(FULL_GRID_COLUMNS);
  });
});

describe("context headline", () => {
  test("A1 at 24% the percent inside the brackets is bold in the normal text colour", async ($, on) => {
    worldOf(on);

    const pane = await paneOnTab($, "Context");

    const percent = findText(await drawnOf(pane), "24%");
    expect(percent, "the 24% as its own Text").toBeDefined();
    expect(isHeavy(percent?.props)).toBe(true);
    expect(percent?.props?.color).toBe(palette.text);
  });

  test("A2 at 85% the percent is bold in the alert colour and is followed by an exclamation mark", async ($, on) => {
    worldOf(on, { ...FIXTURE, totalTokens: 170_000, percentage: 85 });

    const pane = await paneOnTab($, "Context");

    const percent = findText(await drawnOf(pane), "85%");
    expect(percent, "the 85% as its own Text").toBeDefined();
    expect(isHeavy(percent?.props)).toBe(true);
    expect(percent?.props?.color).toBe(palette.alert);
    expect(await rowTexts(pane)).toContain("170k/200k tokens (85% ! of window)");
  });

  test("A3 at 79% the percent is in the normal text colour and no exclamation mark follows", async ($, on) => {
    worldOf(on, { ...FIXTURE, totalTokens: 158_000, percentage: 79 });

    const pane = await paneOnTab($, "Context");

    const percent = findText(await drawnOf(pane), "79%");
    expect(percent, "the 79% as its own Text").toBeDefined();
    expect(percent?.props?.color).toBe(palette.text);
    expect(await rowTexts(pane)).toContain("158k/200k tokens (79% of window)");
  });

  test("A4 at exactly 80% the percent is in the alert colour and is followed by an exclamation mark", async ($, on) => {
    worldOf(on, { ...FIXTURE, totalTokens: 160_000, percentage: 80 });

    const pane = await paneOnTab($, "Context");

    const percent = findText(await drawnOf(pane), "80%");
    expect(percent, "the 80% as its own Text").toBeDefined();
    expect(percent?.props?.color).toBe(palette.alert);
    expect(await rowTexts(pane)).toContain("160k/200k tokens (80% ! of window)");
  });

  test("A21 at 80% or more the exclamation mark is bold and in the same alert colour as the percent", async ($, on) => {
    worldOf(on, { ...FIXTURE, totalTokens: 160_000, percentage: 80 });

    const drawn = await drawnOf(await paneOnTab($, "Context"));

    const percent = findText(drawn, "80%");
    const bang = collect(drawn, "Text").find((node) => textOf(node as Node).trim() === "!");
    expect(bang, "the exclamation mark as its own Text").toBeDefined();
    expect(isHeavy(bang?.props)).toBe(true);
    expect(bang?.props?.color).toBe(palette.alert);
    expect(percent?.props?.color).toBe(palette.alert);
  });
});

describe("context header shares", () => {
  test("H1 the usage line shows the share of the window, and the auto-compact line shows the last measure's share, 29% where the breakdown alone gives 30%", async ($, on) => {
    worldOf(on);
    await measureContext($, { window: 200_000, tokens: MEASURED_TOKENS });

    const pane = await paneOnTab($, "Context");

    const rows = await rowTexts(pane);
    expect(rows).toContain(WINDOW_SHARE_LINE);
    expect(rows).toContain(MEASURED_SHARE);
    expect(await colourOfWords(pane, "of window")).toEqual([palette.muted]);
  });

  test("H2 a new measure while the Context tab is open moves the auto-compact line and the status row band to the new share, and the tab stays open", async ($, on) => {
    const fixture = { ...FIXTURE };
    worldOf(on, fixture);
    on("ui.render", { component: "AbovePrompt" }, ($, e) => {
      const { Text } = $.ui.resolve(e);
      return <Text>engine row</Text>;
    });
    await measureContext($, { window: 200_000, tokens: MEASURED_TOKENS });
    const pane = await paneOnTab($, "Context");
    expect(await rowTexts(pane)).toContain(MEASURED_SHARE);
    fixture.totalTokens = GROWN_TOKENS;
    fixture.percentage = 40;

    await measureContext($, { window: 200_000, tokens: GROWN_TOKENS });

    const rows = await rowTexts(pane);
    expect(rows).toContain(GROWN_SHARE);
    expect(rows.some((row) => row.includes(DEFERRED_NOTE))).toBe(true);
    expect(await statusRowText($)).toContain("≡ 50%");
  });

  test("H3 with auto-compact off the usage line shows the window share and no auto-compact line", async ($, on) => {
    worldOf(on, AUTO_COMPACT_OFF_FIXTURE);
    await measureContext($, {
      window: 200_000,
      tokens: AUTO_COMPACT_OFF_TOKENS,
      percent: AUTO_COMPACT_OFF_PERCENT,
    });

    const rows = await rowTexts(await paneOnTab($, "Context"));

    expect(rows).toContain(WINDOW_SHARE_LINE);
    expect(rows.filter((row) => row.includes(AUTO_COMPACT_WORDS))).toEqual([]);
  });

  test("H5 at 60 columns the model, usage and auto-compact lines are each shown whole", async ($, on) => {
    worldOf(on);
    await measureContext($, { window: 200_000, tokens: MEASURED_TOKENS });

    const pane = await mountedOnTab($, "Context", NARROW_SHARE_COLUMNS);

    const rows = screenRows(await pane.drawn(), NARROW_SHARE_COLUMNS);
    expect(rows.some((row) => row.includes(WINDOW_SHARE_LINE))).toBe(true);
    expect(rows.some((row) => row.includes(MEASURED_SHARE))).toBe(true);
    expect(rows.some((row) => row.includes("Opus 5.5"))).toBe(true);
  });
});

describe("context legend", () => {
  test("A5 the token figures of System prompt and Messages end in the same column", async ($, on) => {
    worldOf(on);

    const rows = screenRows(await (await paneOnTab($, "Context")).drawn(), COLUMNS);

    expect(columnOf(legendRowOf(rows, "System prompt"), "tokens")).toBe(
      columnOf(legendRowOf(rows, "Messages"), "tokens"),
    );
  });

  test("A6 the percent figures of every legend row end in the same column", async ($, on) => {
    worldOf(on);

    const rows = screenRows(await (await paneOnTab($, "Context")).drawn(), COLUMNS);

    const columns = LEGEND_NAMES.map((name) => columnOf(legendRowOf(rows, name), "%"));
    expect(new Set(columns).size).toBe(1);
  });

  test("A7 no legend row has a colon between its name and its figures", async ($, on) => {
    worldOf(on);

    const rows = screenRows(await (await paneOnTab($, "Context")).drawn(), COLUMNS);

    expect(LEGEND_NAMES.filter((name) => legendRowOf(rows, name).includes(":"))).toEqual([]);
  });

  test("A8 legend names and token figures are bright, and the percent and the word tokens are dim", async ($, on) => {
    worldOf(on);

    const pieces = colouredPieces(await (await paneOnTab($, "Context")).drawn());

    expect(pieceColours(pieces, "System prompt")).toEqual([palette.text]);
    expect(pieceColours(pieces, "Messages")).toEqual([palette.text]);
    expect(pieceColours(pieces, "8k")).toEqual([palette.text]);
    expect(pieceColours(pieces, "40k")).toEqual([palette.text, palette.text]);
    expect(pieceColours(pieces, "30k")).toEqual([palette.text]);
    expect(pieceColours(pieces, "tokens")).toEqual([
      palette.muted,
      palette.muted,
      palette.muted,
      palette.muted,
      palette.muted,
    ]);
    const shares = pieces.filter(
      (piece) => /^\d+(\.\d)?%$/u.test(piece.text.trim()) && piece.text.trim() !== "24%",
    );
    expect(shares.map((piece) => piece.color)).toEqual([
      palette.muted,
      palette.muted,
      palette.muted,
      palette.muted,
    ]);
  });

  test("A9 at 60 columns a category name that fits is drawn whole and its row ends with its percent", async ($, on) => {
    worldOf(on, WITH_LONG_CATEGORY);

    const rows = screenRows(await (await mountedOnTab($, "Context", 60)).drawn(), 60);

    const row = rows.find((candidate) => candidate.includes("Compacted"));
    expect(row, "a legend row for the long category").toBeDefined();
    expect(row).toContain("Compacted earlier conversation");
    expect(row?.trimEnd()).toMatch(/\d(\.\d)?%$/u);
  });

  test("A9b at 40 columns a category name that does not fit is cut with an ellipsis, its row stays within the width and ends with its percent", async ($, on) => {
    worldOf(on, WITH_LONG_CATEGORY);

    const rows = screenRows(await (await mountedOnTab($, "Context", 40)).drawn(), 40);

    const row = rows.find((candidate) => candidate.includes("Compacted"));
    expect(row, "a legend row for the long category").toBeDefined();
    expect(row).toContain("…");
    expect(row?.trimEnd().length).toBeLessThanOrEqual(40);
    expect(row?.trimEnd()).toMatch(/\d(\.\d)?%$/u);
  });

  test("A10 at 120 columns the same long category name is shown whole", async ($, on) => {
    worldOf(on, WITH_LONG_CATEGORY);

    const rows = screenRows(await (await mountedOnTab($, "Context", 120)).drawn(), 120);

    expect(rows.some((row) => row.includes("Compacted earlier conversation"))).toBe(true);
  });

  test("A20 in the legend each token figure is bold, and the word tokens and the percent beside it are not bold", async ($, on) => {
    worldOf(on);

    const drawn = await drawnOf(await paneOnTab($, "Context"));
    const texts = collect(drawn, "Text").map((node) => ({
      text: textOf(node as Node).trim(),
      node,
    }));
    const figures = texts.filter(({ text }) => /^\d+(\.\d+)?k$/u.test(text));
    const words = texts.filter(({ text }) => text === "tokens");
    const shares = texts.filter(({ text }) => /^\d+(\.\d)?%$/u.test(text) && text !== "24%");

    expect(figures.length, "the legend token figures").toBeGreaterThan(0);
    expect(figures.every(({ node }) => isHeavy(node.props))).toBe(true);
    expect(words.length, "the word tokens in the legend").toBeGreaterThan(0);
    expect(words.some(({ node }) => isHeavy(node.props))).toBe(false);
    expect(shares.length, "the legend percents").toBeGreaterThan(0);
    expect(shares.some(({ node }) => isHeavy(node.props))).toBe(false);
  });
});

describe("tab bar", () => {
  test("T6 in a narrow pane arrows show the hidden tabs, and clicking one moves to the next or previous page", async ($, on) => {
    worldOf(on);

    const pane = await mountPane($, TALL_PANE_ROWS, NARROW_COLUMNS);
    const buttonLabels = async () =>
      collect((await pane.drawn()) as unknown as DrawNode, "Button")
        .map((button) => button.props?.label)
        .filter((label) => label !== "f filter");

    expect(await buttonLabels()).toEqual(["12›"]);
    await showTab(pane, "12›");
    expect(await buttonLabels()).toEqual(["‹1", "11›"]);
    await showTab(pane, "‹1");
    expect(await buttonLabels()).toEqual(["12›"]);
  });
});

function worldOf(on: On, fixture: typeof FIXTURE = FIXTURE): UsageCall[] {
  const calls: UsageCall[] = [];
  mock.clock(on, { now: NOW });
  mock.env(on, { HOME: "/h/u" });
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", (_$, e) => {
    calls.push({ breakdown: e.breakdown, columns: e.columns });
    const context =
      e.breakdown === undefined ? { window: 200_000 } : { window: 200_000, breakdown: fixture };
    return { value: { startedAt: 0, context, rateLimits: [] } };
  });
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.model", () => ({ value: "opus" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: "/work" }));
  on("session.id", () => ({ value: "s1" }));
  on("fs.write", () => ({ value: undefined }));
  on("fs.list", () => ({ value: [] }));
  on("process.run", () => ({ value: { exitCode: 1, stdout: "", stderr: "" } }) as never);
  on("ui.render", { component: "Pane" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine pane</Text>;
  });
  return calls;
}

function themeOf(on: On, theme: string): void {
  on("config.list", () => ({ value: [{ key: "theme", value: theme }] }) as never);
}

function mountPane(
  $: Engine,
  rows: number = TALL_PANE_ROWS,
  columns: number = COLUMNS,
): Promise<Pane> {
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

async function paneOnTab($: Engine, label: string, rows: number = TALL_PANE_ROWS): Promise<Pane> {
  const pane = await mountPane($, rows);
  await showTab(pane, label);
  return pane;
}

async function mountedOnTab($: Engine, label: string, columns: number): Promise<Pane> {
  const pane = await mountPane($, TALL_PANE_ROWS, columns);
  await showTab(pane, label);
  return pane;
}

async function contextBody(pane: Pane) {
  const found = (await pane.findAll({ type: "Box" })).find((box) =>
    elementsIn(box as unknown as Node).some((child) => child.props?.key === "gap-0"),
  );
  expect(found, "the context body box").toBeDefined();
  return found as NonNullable<typeof found>;
}

async function besideGridBoxes(pane: Pane): Promise<unknown[]> {
  return (await pane.findAll({ type: "Box" })).filter(
    (box) => box.props.flexDirection === "row" && box.props.columnGap === 2,
  );
}

async function showTab(pane: Pane, label: string): Promise<void> {
  await pressPagedTab(pane, label);
}

function measureContext($: Engine, context: SessionContextUsage): Promise<unknown> {
  return $.session.measure({ context, rateLimits: [], changed: ["context"] });
}

async function statusRowText($: Engine): Promise<string> {
  const band = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "AbovePrompt",
    props: {
      hasSurvey: false,
      isCollapsed: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns: COLUMNS,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
    viewport: { columns: COLUMNS, rows: 40 },
  });
  return screenRows(await band.drawn(), COLUMNS).join("\n");
}

async function colourOfWords(pane: Pane, words: string): Promise<unknown[]> {
  return collect(await pane.drawn(), "Text")
    .filter((node) => textOf(node as Node).trim() === words)
    .map((node) => node.props?.color);
}

async function colorsOf(pane: Pane, text: string): Promise<unknown[]> {
  const found = await pane.findAll({ type: "Text", text });
  return found.map((one) => one.props.color);
}

async function legendGlyphColors(pane: Pane): Promise<Record<string, unknown>> {
  const pieces: { text: string; color: unknown }[] = colouredPieces(await pane.drawn());
  return Object.fromEntries(
    pieces.flatMap((piece, index): [string, unknown][] => {
      const name = pieces
        .slice(index + 1)
        .find((next) => next.text.trim() !== "")
        ?.text.trim();
      return LEGEND_GLYPHS.includes(piece.text.trim()) && LEGEND_NAMES.includes(name ?? "")
        ? [[name ?? "", piece.color]]
        : [];
    }),
  );
}

function stateWritesOf(on: On): StateWrite[] {
  const writes: StateWrite[] = [];
  let bodyOffset = { value: SCROLLED_ROWS as unknown, version: 1 };
  on("state.get", (_$, e, next) => (e.key === BODY_OFFSET_KEY ? { value: bodyOffset } : next(e)));
  on("state.set", (_$, e, next) => {
    writes.push({ key: e.key, value: e.value });
    if (e.key !== BODY_OFFSET_KEY) return next(e);
    bodyOffset = { value: e.value, version: bodyOffset.version + 1 };
    return { value: { isSet: true, version: bodyOffset.version } };
  });
  return writes;
}

function lastWritten(writes: StateWrite[], key: string): unknown {
  return writes.filter((write) => write.key === key).at(-1)?.value;
}

async function pressButton(pane: Pane, label: string): Promise<void> {
  const button = (await pane.findAll({ type: "Button" })).find(
    (found) => found.props.label === label,
  );
  expect(button, `a button labelled ${label}`).toBeDefined();
  await pane.press({ key: button?.key ?? "" });
}

async function drawnOf(pane: Pane): Promise<DrawNode> {
  return pane.drawn();
}

function deferredRowOf(rows: string[]): string {
  const row = rows.find((candidate) => DEFERRED_ROW.test(candidate));
  expect(row, "a legend row for the deferred category").toBeDefined();
  return row ?? "";
}

function legendRowOf(rows: string[], name: string): string {
  const row = rows.find((candidate) => candidate.includes(name));
  expect(row, `a legend row for ${name}`).toBeDefined();
  return row ?? "";
}

function columnOf(row: string, text: string): number {
  const at = row.indexOf(text);
  expect(at, `"${text}" in "${row.trimEnd()}"`).toBeGreaterThanOrEqual(0);
  return at;
}

function pieceColours(pieces: { text: string; color: unknown }[], text: string): unknown[] {
  return pieces.filter((piece) => piece.text.trim() === text).map((piece) => piece.color);
}

async function rowTexts(pane: Pane): Promise<string[]> {
  return rowsOf((await pane.drawn()) as unknown as Node)
    .map(labelledTextOf)
    .filter((text) => text !== "");
}

function rowsOf(node: Node): Node[] {
  if (node.type === "Text") return [node];
  if (isRow(node) && !holdsColumn(node)) return [node];
  return elementsIn(node).flatMap(rowsOf);
}

function isRow(node: Node): boolean {
  return (
    node.type === "Box" && !["column", "column-reverse"].includes(String(node.props?.flexDirection))
  );
}

function holdsColumn(node: Node): boolean {
  return elementsIn(node).some(
    (child) => (child.type === "Box" && !isRow(child)) || holdsColumn(child),
  );
}

function elementsIn(node: Node): Node[] {
  return (node.children ?? []).filter(
    (child): child is Node => typeof child === "object" && child !== null,
  );
}

function textOf(node: Node): string {
  return (node.children ?? [])
    .map((child) => (typeof child === "string" ? child : textOf(child as Node)))
    .join("");
}
