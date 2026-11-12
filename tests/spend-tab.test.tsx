import { describe, expect, test } from "claude-code/testing";

import { TABS } from "../hooks/tabs";
import {
  API_KEY,
  HEADINGS,
  HISTORY_TITLE,
  NARROW_COLUMNS,
  NO_HISTORY,
  NO_RENT,
  OPUS,
  PROJECTS_TITLE,
  RENT_TITLE,
  RICH_COST,
  SPLIT_TITLE,
  WIDE_COLUMNS,
  blanksBelowHeading,
  blocks,
  centsOf,
  hasNoSpendNote,
  isAllMuted,
  lines,
  mainTurn,
  mutedPartsText,
  openPane,
  ownersOf,
  plainPartsText,
  readFile,
  rowTextsOf,
  stampOf,
  unstampedLines,
  settle,
  sessionWithAllBlocks,
  setSessionCost,
  splitOf,
  startFreshSession,
  showSpend,
  shownTabs,
  spacingOf,
  spendPane,
  toCents,
  totalsOf,
  unwrappedTexts,
  worldOf,
} from "./spend-world";
import { headingOrder } from "./skills-tree";
import { oracleAtom, paneWithTotals } from "./fixtures/spend-atom";

const MAIN_INPUT = 750_000;
const COST_BEFORE = 4;
const COST_AFTER = 6.5;
const COUNTED_USD = "$3.00";
const ONE_BLANK = 1;
const ONE_BLANK_ABOVE_EACH = [1, 1, 1];
const NO_BLANK_RUN_LONGER_THAN_ONE = 1;
const ONE_BLANK_ABOVE_EACH_OF_TWO = [1, 1];
const LAST_THREE = 3;
const NO_SPEND_NOTE = "no spend this session yet";
const PROMPT_TOKENS = { input: 50_000 };
const RENT_PATH = "/work/hooks/mcp-draw.tsx";
const RENT_CHARS = 36_800;

describe("spend tab layout", () => {
  test("T1 the tab bar ends with Setup, Shells and History, and Spend opens with the Where it went, Cache misses and Biggest tool results in context headings in that order", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sessionWithAllBlocks($, world);
    const pane = await openPane($);
    const bar = await shownTabs(pane);

    expect(bar.slice(-3)).toEqual(["Setup", "Shells", "History"]);
    expect(TABS.map((tab) => tab.label).slice(-4)).toEqual([
      "Shells",
      "History",
      "Review",
      "Sessions",
    ]);
    expect(TABS.at(-1)?.id).toBe("sessions");

    await showSpend(pane);

    expect(headingOrder(await unstampedLines(pane), HEADINGS)).toEqual(HEADINGS);
  });

  test("T2 with data in all three blocks one blank row sits before each heading and no blank row is ever doubled", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sessionWithAllBlocks($, world);

    const pane = await spendPane($);

    expect(spacingOf(await lines(pane))).toEqual({
      gapAboveTop: 1,
      blanksBeforeHeadings: ONE_BLANK_ABOVE_EACH,
      longestBlankRun: NO_BLANK_RUN_LONGER_THAN_ONE,
    });
  });

  test("T3 the engine reports $12.37 and the first total reads $12.37 with the muted label this session under it", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await setSessionCost($, world, RICH_COST);

    const pane = await spendPane($);

    const totals = totalsOf(await lines(pane));
    expect(totals?.usd).toBe("$12.37");
    expect(plainPartsText(totals?.values)).toContain("$12.37");
    expect(mutedPartsText(totals?.values)).not.toContain("$12.37");
    expect(isAllMuted(totals?.labels)).toBe(true);
  });

  test("T4 when the session cost grows from $4.00 to $6.50 with no new tokens the top row shows $6.50 and background grows from $1.00 to $3.50", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await startFreshSession($, world);
    await mainTurn($, world, { model: OPUS, tokens: { input: MAIN_INPUT } });
    await setSessionCost($, world, COST_BEFORE);
    const pane = await spendPane($);
    const before = ownersOf((await blocks(pane))[SPLIT_TITLE]);

    await setSessionCost($, world, COST_AFTER);
    await settle(pane);

    const owners = ownersOf((await blocks(pane))[SPLIT_TITLE]);
    expect(totalsOf(await lines(pane))?.usd).toBe("$6.50");
    expect(before.map((owner) => [owner.name, owner.dollars])).toEqual([
      ["main · opus 5.5", "~$3.00"],
      ["background", "~$1.00"],
    ]);
    expect(owners.map((owner) => [owner.name, owner.dollars])).toEqual([
      ["background", "~$3.50"],
      ["main · opus 5.5", "~$3.00"],
    ]);
  });

  test("T5 a new session shows no spend this session yet, a History block with one blank row under its heading and then no history yet, and no Where it went, Cache misses or Biggest tool results block", async ($, on) => {
    worldOf(on, API_KEY);

    const pane = await spendPane($);

    const found = await blocks(pane);
    expect(hasNoSpendNote(await lines(pane))).toBe(true);
    expect(Object.keys(found)).toEqual([HISTORY_TITLE]);
    expect(blanksBelowHeading(await lines(pane), HISTORY_TITLE)).toBe(ONE_BLANK);
    expect(rowTextsOf(found[HISTORY_TITLE])).toEqual([NO_HISTORY]);
  });

  test("T6 in a new session the tab ends with the History heading, one blank row and no history yet, with nothing after it", async ($, on) => {
    worldOf(on, API_KEY);

    const pane = await spendPane($);

    const texts = (await unstampedLines(pane)).map((line) => line.text);
    expect(texts.slice(-LAST_THREE)).toEqual([HISTORY_TITLE, "", NO_HISTORY]);
  });

  test("T7 a fresh session with engine cost $0 and nothing counted shows no spend this session yet and no owner row", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await startFreshSession($, world);

    const pane = await spendPane($);

    expect(hasNoSpendNote(await lines(pane))).toBe(true);
    expect(ownersOf((await blocks(pane))[SPLIT_TITLE])).toEqual([]);
  });

  test("T7b engine cost $0 while tokens were counted shows the counted spend in the top row and one owner row", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { input: MAIN_INPUT } });
    await setSessionCost($, world, 0);

    const pane = await spendPane($);

    const shown = await lines(pane);
    expect({
      hasNoSpendNote: hasNoSpendNote(shown),
      usd: totalsOf(shown)?.usd,
      split: await splitOf(pane),
    }).toEqual({
      hasNoSpendNote: false,
      usd: COUNTED_USD,
      split: [["main · opus 5.5", `~${COUNTED_USD}`, "100%"]],
    });
  });

  test("STP13a with no tool results the Biggest tool results block is absent", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await startFreshSession($, world);
    await mainTurn($, world, { model: OPUS, tokens: PROMPT_TOKENS, context: PROMPT_TOKENS.input });
    await setSessionCost($, world, COST_BEFORE);

    const pane = await spendPane($);

    const shown = await lines(pane);
    expect(Object.keys(await blocks(pane))).not.toContain(RENT_TITLE);
    expect(shown.some((line) => line.text === NO_RENT)).toBe(false);
  });

  test("STP13b with tool results the Biggest tool results heading ends with tokens", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await readFile($, world, RENT_PATH, RENT_CHARS);
    await setSessionCost($, world, COST_BEFORE);

    const pane = await spendPane($);

    expect(stampOf(await lines(pane), RENT_TITLE)).toBe("tokens");
  });

  test("STP14 with no session spend the top row reads no spend this session yet and no Where it went heading is drawn", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await startFreshSession($, world);

    const pane = await spendPane($);

    const shown = await lines(pane);
    expect(shown.some((line) => line.text === NO_SPEND_NOTE)).toBe(true);
    expect(shown.some((line) => line.text === SPLIT_TITLE)).toBe(false);
  });

  test("STP15a with Cache misses left out and Biggest tool results shown, Where it went and Biggest tool results still have exactly one blank row between them", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await startFreshSession($, world);
    await mainTurn($, world, { model: OPUS, tokens: PROMPT_TOKENS, context: PROMPT_TOKENS.input });
    await readFile($, world, RENT_PATH, RENT_CHARS);
    await setSessionCost($, world, COST_BEFORE);

    const pane = await spendPane($);

    expect(headingOrder(await unstampedLines(pane), HEADINGS)).toEqual([SPLIT_TITLE, RENT_TITLE]);
    expect(spacingOf(await lines(pane))).toMatchObject({
      blanksBeforeHeadings: ONE_BLANK_ABOVE_EACH_OF_TWO,
      longestBlankRun: NO_BLANK_RUN_LONGER_THAN_ONE,
    });
  });

  test("STP15b with Cache misses and Biggest tool results both left out, Where it went is the last block and no blank row follows it", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await startFreshSession($, world);
    await mainTurn($, world, { model: OPUS, tokens: PROMPT_TOKENS, context: PROMPT_TOKENS.input });
    await setSessionCost($, world, COST_BEFORE);

    const pane = await spendPane($);

    const shown = await lines(pane);
    expect(headingOrder(await unstampedLines(pane), HEADINGS)).toEqual([SPLIT_TITLE]);
    expect(shown.at(-1)?.text).not.toBe("");
    expect(spacingOf(shown).longestBlankRun).toBe(NO_BLANK_RUN_LONGER_THAN_ONE);
  });

  test("T8 at 60 columns every Spend row is one line that truncates", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sessionWithAllBlocks($, world);

    const pane = await spendPane($, NARROW_COLUMNS);

    expect(totalsOf(await lines(pane))?.usd).toBe("$12.37");
    expect(await unwrappedTexts(pane)).toEqual([]);
  });

  test("T9 at 120 columns every Spend row is one line that truncates", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sessionWithAllBlocks($, world);

    const pane = await spendPane($, WIDE_COLUMNS);

    expect(totalsOf(await lines(pane))?.usd).toBe("$12.37");
    expect(await unwrappedTexts(pane)).toEqual([]);
  });
});

const ORACLE_TILES = ["$30.86", "$41.46", "$72.26", "$1.25/h"];
const ORACLE_PROJECTS = [
  ["alpha", "$42.25", "58%"],
  ["api", "$18.01", "25%"],
  ["web", "$12.00", "17%"],
];
const ORACLE_PROJECT_DOLLARS = ["$42.25", "$18.01", "$12.00"];
const FOLD_PROJECTS = [
  { name: "alpha", usd: 7.83 },
  { name: "bravo", usd: 6.45 },
  { name: "charlie", usd: 3.56 },
  { name: "delta", usd: 2.71 },
  { name: "echo", usd: 2.61 },
  { name: "foxtrot", usd: 1.72 },
  { name: "golf", usd: 0.94 },
];
const FOLD_PROJECTS_MONTH = 25.82;
const FOLD_PROJECTS_PERCENTS = [
  ["alpha", "30%"],
  ["bravo", "25%"],
  ["charlie", "14%"],
  ["delta", "11%"],
  ["echo", "10%"],
  ["▸ 2 more", "10%"],
];
const ORACLE_SESSION = "$12.40";
const ENGINE_SESSION = 12.37;
const ENGINE_SESSION_TEXT = "$12.37";
const SQL_SESSION = 7.25;
const SQL_SESSION_CENTS = 725;
const SQL_SESSION_TEXT = "$7.25";
const SEVEN_PROJECTS_UNSORTED = [
  { name: "foxtrot", usd: 0.112 },
  { name: "charlie", usd: 3.333 },
  { name: "golf", usd: 0.111 },
  { name: "alpha", usd: 4.333 },
  { name: "echo", usd: 1.111 },
  { name: "bravo", usd: 3.334 },
  { name: "delta", usd: 1.112 },
];
const SEVEN_PROJECTS_MONTH = 13.446;
const SHOWN_PROJECTS = ["alpha", "bravo", "charlie", "delta", "echo", "▸ 2 more"];
const SIX_PROJECTS_SHARES = [
  { name: "alpha", usd: 52.4 },
  { name: "bravo", usd: 22.6 },
  { name: "charlie", usd: 13.6 },
  { name: "delta", usd: 4.6 },
  { name: "echo", usd: 4.5 },
  { name: "foxtrot", usd: 2.3 },
];

describe("spend tab numbers from the transcript totals", () => {
  test("N1 History shows today, 7 days, 30 days and last hour from the totals, and By project lists each project with its 30 days dollars and share", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await setSessionCost($, world, ENGINE_SESSION);

    const found = await blocks(await paneWithTotals($, world, oracleAtom()));

    const tiles = (found[HISTORY_TITLE]?.rows[0]?.text ?? "")
      .split(" ")
      .filter((cell) => cell !== "");
    expect(tiles).toEqual(ORACLE_TILES);
    expect(
      ownersOf(found[PROJECTS_TITLE]).map((owner) => [owner.name, owner.dollars, owner.percent]),
    ).toEqual(ORACLE_PROJECTS);
  });

  test("N2 with $12.37 from the engine and $12.40 counted from the transcripts the first total reads $12.40", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await setSessionCost($, world, ENGINE_SESSION);

    const pane = await paneWithTotals($, world, oracleAtom());

    expect(totalsOf(await lines(pane))?.usd).toBe(ORACLE_SESSION);
  });

  test("N3 when this session is not counted from the transcripts yet the first total reads the engine's $12.37 and History still shows the counted figures", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await setSessionCost($, world, ENGINE_SESSION);

    const pane = await paneWithTotals($, world, { ...oracleAtom(), session: null });

    const history = (await blocks(pane))[HISTORY_TITLE];
    expect(totalsOf(await lines(pane))?.usd).toBe(ENGINE_SESSION_TEXT);
    expect(history?.rows[0]?.text.startsWith(ORACLE_TILES[0] ?? "")).toBe(true);
  });

  test("N4 with $12.37 from the engine and $7.25 counted from the transcripts the Where it went rows add up to $7.25", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sessionWithAllBlocks($, world);

    const pane = await paneWithTotals($, world, { ...oracleAtom(), session: SQL_SESSION });

    const owners = ownersOf((await blocks(pane))[SPLIT_TITLE]);
    expect(totalsOf(await lines(pane))?.usd).toBe(SQL_SESSION_TEXT);
    expect(owners.length).toBeGreaterThan(1);
    expect(centsOf(owners)).toBe(SQL_SESSION_CENTS);
  });

  test("N5 seven projects given in any order show the five biggest largest first then 2 more, and the row dollars add up to the 30 days tile to the cent", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await setSessionCost($, world, ENGINE_SESSION);

    const found = await blocks(
      await paneWithTotals($, world, {
        ...oracleAtom(),
        month: SEVEN_PROJECTS_MONTH,
        projects: SEVEN_PROJECTS_UNSORTED,
      }),
    );

    const owners = ownersOf(found[PROJECTS_TITLE]);
    const monthTile = (found[HISTORY_TITLE]?.rows[0]?.text ?? "").split(" ")[2] ?? null;
    expect(owners.map((owner) => owner.name)).toEqual(SHOWN_PROJECTS);
    expect(centsOf(owners)).toBe(toCents(monthTile));
  });

  test("N6 By project rows of 52.4, 22.6, 13.6, 4.6, 4.5 and 2.3 percent shares read 52 23 14 5 4 2 with 1 more, which add to 100", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await setSessionCost($, world, ENGINE_SESSION);

    const found = await blocks(
      await paneWithTotals($, world, { ...oracleAtom(), projects: SIX_PROJECTS_SHARES }),
    );

    expect(ownersOf(found[PROJECTS_TITLE]).map((owner) => owner.percent)).toEqual([
      "52%",
      "23%",
      "14%",
      "5%",
      "4%",
      "2%",
    ]);
  });

  test("N7 By project rows draw their amounts with no ~, in the same form as the 30-day tile, and the rows sum to it", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await setSessionCost($, world, ENGINE_SESSION);

    const found = await blocks(await paneWithTotals($, world, oracleAtom()));

    const owners = ownersOf(found[PROJECTS_TITLE]);
    const monthTile = (found[HISTORY_TITLE]?.rows[0]?.text ?? "").split(" ")[2] ?? "";
    expect(owners.map((owner) => owner.dollars)).toEqual(ORACLE_PROJECT_DOLLARS);
    expect(monthTile).toBe(ORACLE_TILES[2]);
    expect(centsOf(owners)).toBe(toCents(monthTile));
  });

  test("N8 seven projects fold into five rows plus 2 more, and the 2 more percent is its summed share rounded over the shown rows so the column adds to 100", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await setSessionCost($, world, ENGINE_SESSION);

    const found = await blocks(
      await paneWithTotals($, world, {
        ...oracleAtom(),
        month: FOLD_PROJECTS_MONTH,
        projects: FOLD_PROJECTS,
      }),
    );

    expect(ownersOf(found[PROJECTS_TITLE]).map((owner) => [owner.name, owner.percent])).toEqual(
      FOLD_PROJECTS_PERCENTS,
    );
  });
});
