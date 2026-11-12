import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";

import { screenRows } from "./band-screen";
import { paneWithTotals, totalsAtom } from "./fixtures/spend-atom";
import {
  API_KEY,
  COLUMNS,
  HAIKU,
  NARROW_COLUMNS,
  OPUS,
  PROJECTS_TITLE,
  SPLIT_TITLE,
  WIDE_COLUMNS,
  agentOwner,
  blocks,
  cellsIn,
  colourOfText,
  lineStartingWith,
  lines,
  mainTurn,
  ownerRowOf,
  ownersOf,
  setSessionCost,
  settle,
  startFreshSession,
  toCents,
  worldOf,
} from "./spend-world";
import type { Line } from "./skills-tree";
import type { Pane, World } from "./spend-world";

const BAR_CELL = /[▰▱]/;
const BAR_CELLS = /[▰▱]/g;
const LIVE_PANE_COLUMNS = 53;
const NARROW_PANE_COLUMNS = 42;
const GAP_CELLS = 2;
const NAME_GAP_CELLS = 1;
const NAME_TO_BAR_CELLS = 2;
const NARROW_NAME_CELLS = 16;
const MIN_BAR_CELLS = 10;
const MAIN_LABEL = "main · opus 5.5";
const HAIKU_LABEL = "main · haiku 4.5";
const BIG_USD = 5475.47;
const BIG_AMOUNT = "$5475.47";
const BIG_PERCENT = "100%";
const TINY_USD = 0.004;
const SESSION_USD = 10;
const HAIKU_COST_USD = 1;
const TRIPLE_SHARE = [
  { name: "alpha", usd: 9 },
  { name: "bravo", usd: 0.7 },
  { name: "gamma", usd: 0.3 },
];
const BIG_PROJECTS = [
  { name: "p1", usd: 20 },
  { name: "p2", usd: 20 },
  { name: "p3", usd: 20 },
  { name: "p4", usd: 20 },
  { name: "p5", usd: 17.03 },
];
const SMALL_PROJECT_COUNT = 33;
const SMALL_PROJECT_USD = 0.09;
const FOLDED_NAME = "▸ 33 more";
const EXPLORE_TOKENS = { input: 1_000_000 };
const LONG_NAME = "-private-tmp-claude-502-scratchpad-df-lightansi-g2";
const NAME_BASE = "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz";
const WIDEST_NAME = NAME_BASE.slice(0, 24);
const SHORT_NAME = "tiny";
const ELLIPSIS = "…";
const NAME_EDGE_CHARS = 4;
const FOLDED_CHILD_COUNT = 2;
const CHILD_FOLD_ROW = "▸ 2 more";
const OPEN_CHILD_FOLD_ROW = "▾ 2 more";
const CHILD_INDENT = "  ";
const PANE_PADDING_CELLS = 1;
const PERCENT_COLUMN_CELLS = 5;
const SHARE_GAP_CELLS = 3;
const USD_COLUMN_CELLS = "~$20.00".length + 1;
const CHILD_NAME_ROOM_CELLS =
  CHILD_INDENT.length + USD_COLUMN_CELLS + PERCENT_COLUMN_CELLS + SHARE_GAP_CELLS + MIN_BAR_CELLS;
const CHILD_PROJECT_USD = 0.05;
const UNDER_ONE = "<1%";
const LARGE_PROJECTS = [
  { name: "alpha", usd: 5000 },
  { name: "bravo", usd: 400 },
  { name: "charlie", usd: 50 },
  { name: "delta", usd: 20 },
  { name: "echo", usd: 15 },
  { name: "foxtrot", usd: 9.56 },
  { name: "golf", usd: 8.38 },
];
const LARGE_MONTH = 5502.94;
const SHARE_PROJECTS = [
  { name: "alpha", usd: 98.1 },
  { name: "bravo", usd: 1.4 },
  { name: "charlie", usd: 0.5 },
];
const BY_PROJECT_HEADING = "By project";
const WHERE_HEADING = "Where it went";
const BAR_ROWS_ON_EDGE = 2;

describe("spend bar rows", () => {
  test("SBR0a at 53 columns every bar in By project and Where it went starts one cell after the longest name", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await arrangeMainAndExplore($, world);

    const pane = await paneWithTotals($, world, twoProjects(), LIVE_PANE_COLUMNS);

    expectBarsOneCellAfterLongestName(await rowsOf(pane, LIVE_PANE_COLUMNS));
  });

  test("SBR0b at 60 columns every bar in By project and Where it went starts one cell after the longest name", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await arrangeMainAndExplore($, world);

    const pane = await paneWithTotals($, world, twoProjects(), NARROW_COLUMNS);

    expectBarsOneCellAfterLongestName(await rowsOf(pane, NARROW_COLUMNS));
  });

  test("SBR1 a By project row with a 3% share draws one filled cell and the rest of the bar empty, as long as the other rows' bars", async ($, on) => {
    const world = worldOf(on, API_KEY);

    const pane = await paneWithTotals(
      $,
      world,
      totalsAtom({ month: 10, projects: TRIPLE_SHARE }),
      LIVE_PANE_COLUMNS,
    );

    const block = (await blocks(pane))[PROJECTS_TITLE];
    const alpha = ownerRowOf(block, "alpha");
    const gamma = ownerRowOf(block, "gamma");
    expect(cellsIn(gamma, "▰")).toBe(1);
    expect(cellsIn(gamma, "▰") + cellsIn(gamma, "▱")).toBe(
      cellsIn(alpha, "▰") + cellsIn(alpha, "▱"),
    );
  });

  test("SBR2 a project under a cent shows its name in text with <$0.01 and <1% muted and no filled cell, and a $5475.47 project shows its amount and percent in text", async ($, on) => {
    const world = worldOf(on, API_KEY);

    const pane = await paneWithTotals($, world, bigAndTinyProjects(), COLUMNS);

    const block = (await blocks(pane))[PROJECTS_TITLE];
    const tiny = block?.rows.find((line) => line.text.startsWith("tiny"));
    const big = ownerRowOf(block, "big");
    expect(cellsIn(tiny, "▰")).toBe(0);
    expect(colourOfText(tiny, "tiny")).toBe("text");
    expect(colourOfText(tiny, "<$0.01")).toBe("muted");
    expect(colourOfText(tiny, UNDER_ONE)).toBe("muted");
    expect(colourOfText(big, BIG_AMOUNT)).toBe("text");
    expect(colourOfText(big, BIG_PERCENT)).toBe("text");
  });

  test("SBR4 Where it went with only main · haiku 4.5 at 100% draws no bar cells and its amount ends in the same column as By project's amounts", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await startFreshSession($, world);
    await mainTurn($, world, { model: HAIKU, tokens: { input: 1_000_000 } });
    await setSessionCost($, world, HAIKU_COST_USD);

    const pane = await paneWithTotals($, world, twoProjects(), COLUMNS);

    const found = await blocks(pane);
    const split = ownerRowOf(found[SPLIT_TITLE], HAIKU_LABEL);
    const rows = await rowsOf(pane, COLUMNS);
    const splitAmount = ownersOf(found[SPLIT_TITLE])[0]?.dollars ?? "";
    const projectAmount = ownersOf(found[PROJECTS_TITLE])[0]?.dollars ?? "";
    expect(split?.text).toMatch(/^main · haiku 4\.5 ~\$\d+\.\d{2} 100%$/);
    expect(amountEnd(rows, HAIKU_LABEL, splitAmount)).toBe(
      amountEnd(rows, "battle-game", projectAmount),
    );
  });

  test("SBR5a at 52 columns the widest amount has two blank cells after its bar and before its percent", async ($, on) => {
    const world = worldOf(on, API_KEY);

    const pane = await paneWithTotals($, world, bigAndTinyProjects(), 52);

    expectTwoBlankCellsAroundWidestAmount(await rowsOf(pane, 52));
  });

  test("SBR5b at 60 columns the widest amount has two blank cells after its bar and before its percent", async ($, on) => {
    const world = worldOf(on, API_KEY);

    const pane = await paneWithTotals($, world, bigAndTinyProjects(), NARROW_COLUMNS);

    expectTwoBlankCellsAroundWidestAmount(await rowsOf(pane, NARROW_COLUMNS));
  });

  test("SBR5c at 120 columns the widest amount has two blank cells after its bar and before its percent", async ($, on) => {
    const world = worldOf(on, API_KEY);

    const pane = await paneWithTotals($, world, bigAndTinyProjects(), WIDE_COLUMNS);

    expectTwoBlankCellsAroundWidestAmount(await rowsOf(pane, WIDE_COLUMNS));
  });

  test("SBR6 the 33 more row with a 3% share draws one filled cell", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const smallProjects = Array.from({ length: SMALL_PROJECT_COUNT }, (_, index) => ({
      name: `small-${index}`,
      usd: SMALL_PROJECT_USD,
    }));

    const pane = await paneWithTotals(
      $,
      world,
      totalsAtom({ month: 100, projects: [...BIG_PROJECTS, ...smallProjects] }),
      LIVE_PANE_COLUMNS,
    );

    const folded = ownersOf((await blocks(pane))[PROJECTS_TITLE]).find(
      (owner) => owner.name === FOLDED_NAME,
    );
    expect(folded?.percent).toBe("3%");
    expect(folded?.filled).toBe(1);
  });

  test("SBR7a at 53 columns every By project and Where it went row ends its percent at the pane's last cell, the cell the heading rule ends on", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await arrangeMainAndExplore($, world);

    const pane = await paneWithTotals($, world, twoProjects(), LIVE_PANE_COLUMNS);

    expectPercentOnPaneEdge(await rowsOf(pane, LIVE_PANE_COLUMNS), LIVE_PANE_COLUMNS);
  });

  test("SBR7b at 60 columns every By project and Where it went row ends its percent at the pane's last cell, the cell the heading rule ends on", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await arrangeMainAndExplore($, world);

    const pane = await paneWithTotals($, world, twoProjects(), NARROW_COLUMNS);

    expectPercentOnPaneEdge(await rowsOf(pane, NARROW_COLUMNS), NARROW_COLUMNS);
  });

  test("SBR8a at 53 columns an unfolded project named -private-tmp-claude-502-scratchpad-df-lightansi-g2 that does not fit draws its start and one trailing …, and ends the name exactly at the name column's last cell", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const pane = await paneWithFoldedNames($, world, [LONG_NAME, SHORT_NAME], LIVE_PANE_COLUMNS);

    expectNameCutAtEnd(await rowsOf(pane, LIVE_PANE_COLUMNS), LONG_NAME);
  });

  test("SBR8a at 60 columns an unfolded project named -private-tmp-claude-502-scratchpad-df-lightansi-g2 that does not fit draws its start and one trailing …, and ends the name exactly at the name column's last cell", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const pane = await paneWithFoldedNames($, world, [LONG_NAME, SHORT_NAME], NARROW_COLUMNS);

    expectNameCutAtEnd(await rowsOf(pane, NARROW_COLUMNS), LONG_NAME);
  });

  test("SBR8b at 53 columns an unfolded name that exactly fills its cells draws whole with no …", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const fitting = fittingNameAt(LIVE_PANE_COLUMNS);
    const pane = await paneWithFoldedNames($, world, [fitting, SHORT_NAME], LIVE_PANE_COLUMNS);

    expect(await unfoldedChildNames(pane, LIVE_PANE_COLUMNS)).toEqual([fitting, SHORT_NAME]);
  });

  test("SBR8b at 60 columns an unfolded name that exactly fills its cells draws whole with no …", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const fitting = fittingNameAt(NARROW_COLUMNS);
    const pane = await paneWithFoldedNames($, world, [fitting, SHORT_NAME], NARROW_COLUMNS);

    expect(await unfoldedChildNames(pane, NARROW_COLUMNS)).toEqual([fitting, SHORT_NAME]);
  });

  test("SBR8b at 53 columns an unfolded name one cell longer than its cells draws its start and one trailing …, cut at the end", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const longer = longerNameAt(LIVE_PANE_COLUMNS);
    const pane = await paneWithFoldedNames($, world, [longer, SHORT_NAME], LIVE_PANE_COLUMNS);

    expectNameCutAtEnd(await rowsOf(pane, LIVE_PANE_COLUMNS), longer);
  });

  test("SBR8b at 60 columns an unfolded name one cell longer than its cells draws its start and one trailing …, cut at the end", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const longer = longerNameAt(NARROW_COLUMNS);
    const pane = await paneWithFoldedNames($, world, [longer, SHORT_NAME], NARROW_COLUMNS);

    expectNameCutAtEnd(await rowsOf(pane, NARROW_COLUMNS), longer);
  });

  test("SBR9 at 60 columns a By project list whose widest name is 24 cells draws every name whole, the bar keeps at least 10 cells and the percent ends on the last cell", async ($, on) => {
    const world = worldOf(on, API_KEY);

    const pane = await paneWithTotals($, world, widestNameProjects(), NARROW_COLUMNS);

    const row = rowStarting(await rowsOf(pane, NARROW_COLUMNS), WIDEST_NAME);
    expect(row.trim().split(" ")[0]).toBe(WIDEST_NAME);
    expect(barCellsIn(row)).toBeGreaterThanOrEqual(MIN_BAR_CELLS);
    expect(row.trimEnd().length).toBe(NARROW_COLUMNS);
  });

  test("SBR9 at 42 columns where only 16 name cells fit beside a 10-cell bar, the 24-cell name is cut at the end to a 16-cell name column", async ($, on) => {
    const world = worldOf(on, API_KEY);

    const pane = await paneWithTotals($, world, widestNameProjects(), NARROW_PANE_COLUMNS);

    const rows = await rowsOf(pane, NARROW_PANE_COLUMNS);
    const name = expectNameCutAtEnd(rows, WIDEST_NAME);
    expect(name.length).toBe(NARROW_NAME_CELLS);
    const row = rowStarting(rows, WIDEST_NAME.slice(0, NAME_EDGE_CHARS));
    expect(barCellsIn(row)).toBeGreaterThanOrEqual(MIN_BAR_CELLS);
    expect(row.trimEnd().length).toBe(NARROW_PANE_COLUMNS);
  });

  test("SBR10 at 53 columns unfolded children $9.56 and $8.38 under a $5502.94 total both read <1% in muted ink, and their dollars add up to the fold row", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const pane = await paneWithTotals($, world, largeTotalProjects(), LIVE_PANE_COLUMNS);

    await pressButton(pane, CHILD_FOLD_ROW);

    expectFoldedPairUnderOne(await lines(pane));
  });

  test("SBR10 at 60 columns unfolded children $9.56 and $8.38 under a $5502.94 total both read <1% in muted ink, and their dollars add up to the fold row", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const pane = await paneWithTotals($, world, largeTotalProjects(), NARROW_COLUMNS);

    await pressButton(pane, CHILD_FOLD_ROW);

    expectFoldedPairUnderOne(await lines(pane));
  });

  test("SBR11 at 53 columns a By project row of $0.50 out of $100 reads <1%, a $1.40 row reads 1% and a $98.10 row reads 98%", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const pane = await paneWithTotals($, world, shareProjects(), LIVE_PANE_COLUMNS);

    expectShareRowsReading(await lines(pane));
  });

  test("SBR11 at 60 columns a By project row of $0.50 out of $100 reads <1%, a $1.40 row reads 1% and a $98.10 row reads 98%", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const pane = await paneWithTotals($, world, shareProjects(), NARROW_COLUMNS);

    expectShareRowsReading(await lines(pane));
  });
});

async function arrangeMainAndExplore($: Engine, world: World): Promise<void> {
  await startFreshSession($, world);
  await mainTurn($, world, { model: OPUS, tokens: { input: 5_000_000 } });
  await agentOwner($, world, "Explore", HAIKU, EXPLORE_TOKENS);
  await setSessionCost($, world, SESSION_USD);
}

async function paneWithFoldedNames(
  $: Engine,
  world: World,
  names: string[],
  columns: number,
): Promise<Pane> {
  const pane = await paneWithTotals(
    $,
    world,
    totalsAtom({
      month: 100,
      projects: [...BIG_PROJECTS, ...names.map((name) => ({ name, usd: CHILD_PROJECT_USD }))],
    }),
    columns,
  );
  await pressButton(pane, CHILD_FOLD_ROW);
  return pane;
}

async function pressButton(pane: Pane, label: string): Promise<void> {
  const button = (await pane.findAll({ type: "Button" })).find(
    (candidate) => candidate.props.label === label,
  );
  expect(button, `a "${label}" button`).toBeDefined();
  await pane.press({ key: button?.key ?? "" });
  await settle(pane);
}

async function unfoldedChildNames(pane: Pane, columns: number): Promise<string[]> {
  const rows = await rowsOf(pane, columns);
  const foldAt = rows.findIndex((row) => row.trim().startsWith(OPEN_CHILD_FOLD_ROW));
  expect(foldAt, `a "${OPEN_CHILD_FOLD_ROW}" row`).toBeGreaterThan(-1);
  return rows
    .slice(foldAt + 1, foldAt + 1 + FOLDED_CHILD_COUNT)
    .map((row) => row.slice(PANE_PADDING_CELLS + CHILD_INDENT.length).split(" ")[0] ?? "");
}

function twoProjects() {
  return totalsAtom({
    month: 10,
    projects: [
      { name: "battle-game", usd: 6 },
      { name: "demo-app", usd: 4 },
    ],
  });
}

function bigAndTinyProjects() {
  return totalsAtom({
    month: BIG_USD + TINY_USD,
    projects: [
      { name: "big", usd: BIG_USD },
      { name: "tiny", usd: TINY_USD },
    ],
  });
}

function widestNameProjects() {
  return totalsAtom({
    month: 100,
    projects: [
      { name: WIDEST_NAME, usd: 60 },
      { name: "alpha", usd: 40 },
    ],
  });
}

function largeTotalProjects() {
  return totalsAtom({ month: LARGE_MONTH, projects: LARGE_PROJECTS });
}

function shareProjects() {
  return totalsAtom({ month: 100, projects: SHARE_PROJECTS });
}

async function rowsOf(pane: Pane, columns: number): Promise<string[]> {
  return screenRows(await pane.drawn(), columns);
}

function fittingNameAt(columns: number): string {
  return NAME_BASE.slice(0, columns - CHILD_NAME_ROOM_CELLS);
}

function longerNameAt(columns: number): string {
  return NAME_BASE.slice(0, columns - CHILD_NAME_ROOM_CELLS + 1);
}

function rowStarting(rows: string[], start: string): string {
  return rows.find((row) => row.trim().startsWith(start)) ?? "";
}

function barCellsIn(row: string): number {
  return row.match(BAR_CELLS)?.length ?? 0;
}

function barStartOf(rows: string[]): number {
  return rows.find((row) => BAR_CELL.test(row))?.search(BAR_CELL) ?? -1;
}

function expectNameCutAtEnd(rows: string[], original: string): string {
  const row =
    rows.find((candidate) => candidate.includes(original.slice(0, NAME_EDGE_CHARS))) ?? "";
  const name = row.trim().split(" ")[0] ?? "";
  expect(name.startsWith(original.slice(0, NAME_EDGE_CHARS))).toBe(true);
  expect(name.endsWith(ELLIPSIS)).toBe(true);
  expect(name.split(ELLIPSIS)).toHaveLength(2);
  expect(barStartOf(rows) - row.indexOf(ELLIPSIS)).toBe(NAME_TO_BAR_CELLS);
  return name;
}

function expectFoldedPairUnderOne(shown: Line[]): void {
  const fold = lineStartingWith(shown, OPEN_CHILD_FOLD_ROW);
  const foxtrot = lineStartingWith(shown, "foxtrot");
  const golf = lineStartingWith(shown, "golf");
  expect(dollarsOf(foxtrot)).toBe("$9.56");
  expect(dollarsOf(golf)).toBe("$8.38");
  expect(percentOf(foxtrot)).toBe(UNDER_ONE);
  expect(percentOf(golf)).toBe(UNDER_ONE);
  expect(colourOfText(foxtrot, UNDER_ONE)).toBe("muted");
  expect(colourOfText(golf, UNDER_ONE)).toBe("muted");
  expect(toCents(dollarsOf(fold))).toBe(toCents(dollarsOf(foxtrot)) + toCents(dollarsOf(golf)));
}

function expectShareRowsReading(shown: Line[]): void {
  const alpha = lineStartingWith(shown, "alpha");
  const bravo = lineStartingWith(shown, "bravo");
  const charlie = lineStartingWith(shown, "charlie");
  expect(percentOf(alpha)).toBe("98%");
  expect(percentOf(bravo)).toBe("1%");
  expect(percentOf(charlie)).toBe(UNDER_ONE);
  expect(colourOfText(charlie, UNDER_ONE)).toBe("muted");
}

function dollarsOf(line: { text: string } | undefined): string | null {
  return line?.text.match(/\$\d+\.\d{2}/)?.[0] ?? null;
}

function percentOf(line: { text: string } | undefined): string {
  return line?.text.split(" ").at(-1) ?? "";
}

function expectBarsOneCellAfterLongestName(rows: string[]): void {
  const main = rows.find((row) => row.includes(MAIN_LABEL)) ?? "";
  const expected = main.indexOf(MAIN_LABEL) + MAIN_LABEL.length + NAME_GAP_CELLS;
  const starts = rows.filter((row) => BAR_CELL.test(row)).map((row) => row.search(BAR_CELL));
  expect(starts).toHaveLength(4);
  expect(starts).toEqual(starts.map(() => expected));
}

function expectTwoBlankCellsAroundWidestAmount(rows: string[]): void {
  const widest = rows.find((row) => row.includes(BIG_AMOUNT) && row.includes(BIG_PERCENT)) ?? "";
  const amountAt = widest.indexOf(BIG_AMOUNT);
  const amountEndAt = amountAt + BIG_AMOUNT.length;
  const barEndAt = Math.max(widest.lastIndexOf("▰", amountAt), widest.lastIndexOf("▱", amountAt));
  expect(amountAt - barEndAt - 1).toBe(GAP_CELLS);
  expect(widest.indexOf(BIG_PERCENT) - amountEndAt).toBe(GAP_CELLS);
}

function amountEnd(rows: string[], name: string, amount: string): number {
  const row = rows.find((candidate) => candidate.includes(name)) ?? "";
  return row.indexOf(amount) + amount.length;
}

function expectPercentOnPaneEdge(rows: string[], columns: number): void {
  const by = edgesUnder(rows, BY_PROJECT_HEADING);
  const split = edgesUnder(rows, WHERE_HEADING);
  expect(by.rowEnds).toHaveLength(BAR_ROWS_ON_EDGE);
  expect(split.rowEnds).toHaveLength(BAR_ROWS_ON_EDGE);
  expect([by.ruleEnd, split.ruleEnd]).toEqual([columns, columns]);
  expect([...by.rowEnds, ...split.rowEnds]).toEqual(
    Array.from({ length: BAR_ROWS_ON_EDGE * 2 }, () => columns),
  );
}

function edgesUnder(rows: string[], title: string): { ruleEnd: number; rowEnds: number[] } {
  const headingAt = rows.findIndex((row) => row.trim().startsWith(title));
  expect(headingAt, `a "${title}" heading`).toBeGreaterThan(-1);
  const rest = rows.slice(headingAt + 2);
  const end = rest.findIndex((row) => row.trim() === "");
  return {
    ruleEnd: (rows[headingAt] ?? "").trimEnd().length,
    rowEnds: (end === -1 ? rest : rest.slice(0, end)).map((row) => row.trimEnd().length),
  };
}
