import { describe, expect, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

import { screenRows } from "./band-screen";
import { collect } from "./draw-tree";
import type { Node } from "./draw-tree";

const NARROW = 60;
const MIDDLE = 80;
const WIDE = 120;
const BORDER_WIDTH = 2;
const BOX_PADDING = 2;
const MEASURED_MS = 3000;
const KINDS_IN_GROUP = 5;
const TOTAL_TIME = "18s";
const ELLIPSIS = "…";
const FILE_NAME = "src/hooks/prompt-info.tsx";
const PATH_IN_HEADING = "src/components/status-row/prompt-info-layout.tsx";
const LONG_H1 = "A very long first-level heading that goes past sixty columns for sure yes";
const LONG_H2 = "Second level heading that is also long and carries the model name and the cost";
const LONG_H3 = "Third level heading that is also long and has many words in it to pass sixty";
const PATH_H3 = `Third heading with ${PATH_IN_HEADING} inside it`;
const OVER_WIDE_PATH =
  "src/components/status-row/very/deep/nested/folder/prompt-info-layout-final.tsx";
const OVER_WIDE_HEADING = `Changes in ${OVER_WIDE_PATH}`;
const NARROWEST = 40;
const KIND_PHRASE =
  /^(Read|Ran|Edited|Searched|Used) \d+ (file|files|command|commands|time|times|tool|tools)$/;
const HIDDEN_COUNT = /^\+(\d+)$/;
const TABLE = [
  "| File | Cost | Notes |",
  "|------|------|-------|",
  `| ${FILE_NAME} | $12.34 | the status row draws the model and ctx percent |`,
].join("\n");
const TABLE_AT_WIDE = [
  "┌───────────────────────────┬────────┬────────────────────────────────────────────────┐",
  "│ File                      │ Cost   │ Notes                                          │",
  "╞═══════════════════════════╪════════╪════════════════════════════════════════════════╡",
  "│ src/hooks/prompt-info.tsx │ $12.34 │ the status row draws the model and ctx percent │",
  "└───────────────────────────┴────────┴────────────────────────────────────────────────┘",
];
const GROUP_TOOLS = ["Read", "Read", "Bash", "Edit", "Grep", "Agent"];
const WIDE_GROUP_ROW =
  "Done   Read 2 files · Ran 1 command · Edited 1 file · Searched 1 time · Used 1 tool · 18s";

describe("chat cards at narrow widths", () => {
  test("S1 a first-level heading wider than 60 columns is wrapped inside its box with every word on screen", async ($, on) => {
    mockCopy(on);

    const box = await roundBoxOf(await mountReply($, `# ${LONG_H1}`, NARROW));

    const boxWidth = box.props!.width as number;
    const inner = screenRows(box, boxWidth - BORDER_WIDTH).map((row) => row.trimEnd());
    expect(boxWidth).toBeLessThanOrEqual(NARROW);
    expect(inner.join("")).not.toContain(ELLIPSIS);
    expect(withoutSpaces(inner.join(""))).toContain(withoutSpaces(LONG_H1));
    expect(inner.filter((row) => row !== "").length).toBeGreaterThanOrEqual(2);
  });

  test("S1b a second-level heading wider than 60 columns is wrapped with every word on screen", async ($, on) => {
    mockCopy(on);

    const rows = await rowsOf($, `## ${LONG_H2}`, NARROW);

    expect(rows.join("")).not.toContain(ELLIPSIS);
    expect(withoutSpaces(rows.join(""))).toContain(withoutSpaces(LONG_H2));
    expect(rows.filter((row) => !row.startsWith("━")).length).toBeGreaterThanOrEqual(2);
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(NARROW);
  });

  test("S1c a third-level heading wider than 60 columns is wrapped with every word on screen", async ($, on) => {
    mockCopy(on);

    const rows = await rowsOf($, `### ${LONG_H3}`, NARROW);

    expect(rows.join("")).not.toContain(ELLIPSIS);
    expect(withoutSpaces(rows.join(""))).toContain(withoutSpaces(LONG_H3));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(NARROW);
  });

  test("S2 short headings at 60 and 120 columns are drawn as before", async ($, on) => {
    mockCopy(on);
    const text = "# Short title\n\n## Short label\n\n### Short note";

    const narrow = await rowsOf($, text, NARROW);
    const wide = await rowsOf($, text, WIDE);
    const box = await roundBoxOf(await mountReply($, text, NARROW));

    const expected = [
      " Short title",
      "Short label",
      "━".repeat("Short label".length),
      "Short note",
    ];
    expect(narrow).toEqual(expected);
    expect(wide).toEqual(expected);
    expect(box.props!.width).toBe("Short title".length + BORDER_WIDTH + BOX_PADDING);
  });

  test("S3 a heading holding a file path at 60 columns shows the whole path or breaks it only after a slash", async ($, on) => {
    mockCopy(on);

    const rows = await rowsOf($, `### ${PATH_H3}`, NARROW);

    expect(rows.join("")).not.toContain(ELLIPSIS);
    expect(withoutSpaces(rows.join(""))).toContain(withoutSpaces(PATH_H3));
    expect(pathBreaksOnlyAfterSlash(rows)).toBe(true);
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(NARROW);
  });

  test("S3b a heading holding a file path at 80 columns shows the whole path or breaks it only after a slash", async ($, on) => {
    mockCopy(on);

    const rows = await rowsOf($, `### ${PATH_H3}`, MIDDLE);

    expect(rows.join("")).not.toContain(ELLIPSIS);
    expect(withoutSpaces(rows.join(""))).toContain(withoutSpaces(PATH_H3));
    expect(pathBreaksOnlyAfterSlash(rows)).toBe(true);
  });

  test("S3c a heading holding a file path that fits at 120 columns stays on one line as before", async ($, on) => {
    mockCopy(on);

    const rows = await rowsOf($, `### ${PATH_H3}`, WIDE);

    expect(rows).toEqual([PATH_H3]);
  });

  test("S3d a heading holding a file path wider than the row shows every character and breaks it only after a slash", async ($, on) => {
    mockCopy(on);

    const rows = await rowsOf($, `### ${OVER_WIDE_HEADING}`, NARROWEST);

    expect(rows.join("")).not.toContain(ELLIPSIS);
    expect(withoutSpaces(rows.join(""))).toContain(OVER_WIDE_PATH);
    expect(pathBreaksOnlyAfterSlash(rows, OVER_WIDE_PATH)).toBe(true);
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(NARROWEST);
  });

  test("S4 a table at 60 columns keeps the file name in its first column on one row", async ($, on) => {
    mockCopy(on);

    const rows = await rowsOf($, TABLE, NARROW);

    expect(rows.filter((row) => row.includes(FILE_NAME))).toHaveLength(1);
  });

  test("S4b the same table at 120 columns is drawn as before", async ($, on) => {
    mockCopy(on);

    const rows = await rowsOf($, TABLE, WIDE);

    expect(rows).toEqual(TABLE_AT_WIDE);
  });

  test("S5 a collapsed tool group of five kinds at 60 columns keeps the time and counts the kinds that do not fit", async ($, on) => {
    mockToolTimes(on);

    const summary = await groupSummary($, NARROW);

    const parts = summary.replace(/^Done\s+/, "").split(" · ");
    const shown = parts.filter((part) => KIND_PHRASE.test(part));
    const counts = parts.flatMap((part) => HIDDEN_COUNT.exec(part)?.[1] ?? []);
    expect(parts).toContain(TOTAL_TIME);
    expect(parts).toHaveLength(shown.length + counts.length + 1);
    expect(counts).toHaveLength(1);
    expect(shown.length + Number(counts[0])).toBe(KINDS_IN_GROUP);
  });

  test("S5b a collapsed tool group at 120 columns with room is drawn as before", async ($, on) => {
    mockToolTimes(on);

    const summary = await groupSummary($, WIDE);

    expect(summary).toBe(WIDE_GROUP_ROW);
  });
});

function mountReply($: Engine, text: string, columns: number) {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "AssistantMessage",
    props: { text, isFirstOfReply: false },
    viewport: { columns, rows: 24 },
  });
}

async function rowsOf($: Engine, text: string, columns: number): Promise<string[]> {
  const ui = await mountReply($, text, columns);
  return screenRows(await ui.drawn(), columns)
    .map((row) => row.trimEnd())
    .filter((row) => row !== "");
}

async function roundBoxOf(ui: { drawn(): Promise<unknown> }): Promise<Node> {
  const tree = (await ui.drawn()) as Node;
  return collect(tree, "Box").find((node) => node.props?.borderStyle === "round")!;
}

async function groupSummary($: Engine, columns: number): Promise<string> {
  const calls = GROUP_TOOLS.map((tool, index) => ({
    tool_use_id: `g${index}`,
    tool,
    input: {},
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
  }));
  const ui = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "ToolGroup",
    props: { calls, isActive: false, isExpanded: false },
    viewport: { columns, rows: 24 },
  });
  const row = screenRows(await ui.drawn(), columns)
    .map((line) => line.trimEnd())
    .find((line) => line.startsWith("Done"))!;
  return row.slice(0, row.lastIndexOf(" ["));
}

function mockToolTimes(on: On): void {
  on("state.get", (_$, e, next) =>
    e.key === "toolMs" ? { value: { value: MEASURED_MS, version: 1 } } : next(e),
  );
}

function mockCopy(on: On): void {
  on("ui.copy", () => ({ value: { isCopied: true } }) as never);
  on("ui.toast", () => ({ value: undefined }));
}

function withoutSpaces(text: string): string {
  return text.replace(/\s+/g, "");
}

function pathBreaksOnlyAfterSlash(rows: string[], path = PATH_IN_HEADING): boolean {
  const rejoined = rows.join("\n").replace(/\/\s*\n\s*/g, "/");
  return rejoined.includes(path);
}
