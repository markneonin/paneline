import { describe, expect, test } from "claude-code/testing";

import { screenRows } from "./band-screen";
import {
  API_KEY,
  HISTORY_TITLE,
  NO_HISTORY,
  PROJECTS_TITLE,
  blocks,
  centsOf,
  colourOfText,
  isAllMuted,
  lines,
  ownersOf,
  partOf,
  setSessionCost,
  settle,
  spendPane,
  toCents,
  totalsOf,
  worldOf,
} from "./spend-world";
import { paneWithTotals, seedTotals, totalsAtom } from "./fixtures/spend-atom";
import { isHeavy } from "./weight";
import type { WorldAtom } from "./fixtures/spend-atom";
import type { Line } from "./skills-tree";
import type { Pane } from "./spend-world";

type Tiles = { values: Line | undefined; labels: Line | undefined; shown: string[] };

const MAIN_TREE_NAME = "demo-app";
const PROJECT_DOLLARS: [string, number][] = [
  ["alpha", 4.333],
  ["bravo", 3.334],
  ["charlie", 3.333],
  ["delta", 1.112],
  ["echo", 1.111],
  ["foxtrot", 0.112],
  ["golf", 0.111],
];
const SHOWN_PROJECTS = ["alpha", "bravo", "charlie", "delta", "echo", "▸ 2 more"];
const TIGHT_HEADING_COLUMNS = 53;
const COUNTING_HEADING = "History · all sessions counting · 2% · 1 unreadable";
const COUNTING_PROGRESS = { doneBytes: 20, totalBytes: 1_000, failed: 1 };
const WEEK_USD = 957.12;
const LAST_HOUR_USD = 1.25;
const SESSION_USD = 0.24;
const PLAIN_TEXT_TILES = ["text", "text", "text"];
const NOT_BOLD = [false, false, false];

describe("spend history", () => {
  test("S1 with no history the tab shows History, a muted no history yet, and no By project", async ($, on) => {
    worldOf(on, API_KEY);

    const pane = await spendPane($);

    const found = await blocks(pane);
    expect(found[HISTORY_TITLE]?.rows.map((row) => row.text)).toEqual([NO_HISTORY]);
    expect(isAllMuted(found[HISTORY_TITLE]?.rows[0])).toBe(true);
    expect(found[PROJECTS_TITLE]).toBeUndefined();
  });

  test("STP2a History tiles $480.70 today, $2139.81 7 days and $10732.23 30 days are plain text, not bold, and $0.24 this session is bold", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await setSessionCost($, world, SESSION_USD);

    const pane = await paneWithTotals(
      $,
      world,
      totalsAtom({
        today: 480.7,
        week: 2139.81,
        month: 10732.23,
        lastHour: LAST_HOUR_USD,
        projects: [{ name: MAIN_TREE_NAME, usd: 10732.23 }],
      }),
    );

    const tiles = await tilesOf(pane);
    const session = totalsOf(await lines(pane))?.values;
    expect(tiles.shown.slice(0, 3)).toEqual(["$480.70", "$2139.81", "$10732.23"]);
    expect(isAllMuted(tiles.labels)).toBe(true);
    const values = tiles.shown.slice(0, 3);
    expect(values.map((value) => colourOfText(tiles.values, value))).toEqual(PLAIN_TEXT_TILES);
    expect(values.map((value) => isHeavy(partOf(tiles.values, value)?.props))).toEqual(NOT_BOLD);
    expect(colourOfText(session, "$0.24")).toBe("text");
    expect(isHeavy(partOf(session, "$0.24")?.props)).toBe(true);
  });

  test("STP2b a $0.00 today tile in History is muted and not bold", async ($, on) => {
    const world = worldOf(on, API_KEY);

    const tiles = await tilesOf(
      await paneWithTotals(
        $,
        world,
        totalsAtom({
          today: 0,
          week: 2139.81,
          month: 10732.23,
          lastHour: LAST_HOUR_USD,
          projects: [{ name: MAIN_TREE_NAME, usd: 10732.23 }],
        }),
      ),
    );

    expect(tiles.shown[0]).toBe("$0.00");
    expect(colourOfText(tiles.values, "$0.00")).toBe("muted");
    expect(isHeavy(partOf(tiles.values, "$0.00")?.props)).toBe(false);
  });

  test("STP3 with 7 days and 30 days both $957.12 History shows one $957.12 tile labelled 7 days · 30 days, and today on its own", async ($, on) => {
    const world = worldOf(on, API_KEY);

    const tiles = await tilesOf(
      await paneWithTotals($, world, equalTilesAtom({ today: 120.5, week: WEEK_USD })),
    );

    expect(tiles.values?.text).toBe("$120.50 $957.12 $1.25/h");
    expect(tiles.labels?.text).toBe("today 7 days · 30 days last hour");
  });

  test("STP4 with today, 7 days and 30 days all $957.12 History shows one tile labelled today · 7 days · 30 days, and the last hour tile on its own", async ($, on) => {
    const world = worldOf(on, API_KEY);

    const tiles = await tilesOf(
      await paneWithTotals($, world, equalTilesAtom({ today: WEEK_USD, week: WEEK_USD })),
    );

    expect(tiles.values?.text).toBe("$957.12 $1.25/h");
    expect(tiles.labels?.text).toBe("today · 7 days · 30 days last hour");
  });

  test("STP6 the History heading reads History · all sessions, and with counting · 2% · 1 unreadable it still fits one line at 53 columns", async ($, on) => {
    const world = worldOf(on, API_KEY);

    const pane = await paneWithTotals(
      $,
      world,
      totalsAtom({
        month: WEEK_USD,
        projects: [{ name: MAIN_TREE_NAME, usd: WEEK_USD }],
        progress: COUNTING_PROGRESS,
      }),
      TIGHT_HEADING_COLUMNS,
    );

    const heading = screenRows(await pane.drawn(), TIGHT_HEADING_COLUMNS).find((row) =>
      row.trim().startsWith("History"),
    );
    expect(heading?.trim()).toContain(COUNTING_HEADING);
    expect(heading).not.toContain("…");
  });

  test("STP5 $73.46 in the last hour against $2000 over 100 active hours ($20/h) draws $73.46/h labelled last hour, high, in the same ink as the other tiles; $10.00 in the last hour draws it labelled last hour", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const pane = await spendPane($);

    seedTotals(world, paceAtom(73.46, 100));
    await settle(pane);
    const busy = await tilesOf(pane);
    seedTotals(world, paceAtom(10, 100));
    await settle(pane);
    const calm = await tilesOf(pane);

    expect(busy.shown[3]).toBe("$73.46/h");
    expect(busy.labels?.text).toBe("today 7 days 30 days last hour, high");
    expect(colourOfText(busy.values, "$73.46/h")).toBe(colourOfText(busy.values, "$30.00"));
    expect(colourOfText(busy.labels, "last hour, high")).toBe(colourOfText(busy.labels, "today"));
    expect(calm.labels?.text).toBe("today 7 days 30 days last hour");
  });

  test("STP5b with $2000 over 100 active hours a $20.00 last hour reads last hour and $20.01 reads last hour, high", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const pane = await spendPane($);

    seedTotals(world, paceAtom(20, 100));
    await settle(pane);
    const equal = await tilesOf(pane);
    seedTotals(world, paceAtom(20.01, 100));
    await settle(pane);
    const above = await tilesOf(pane);

    expect(equal.labels?.text).toBe("today 7 days 30 days last hour");
    expect(above.labels?.text).toBe("today 7 days 30 days last hour, high");
  });

  test("STP5c with no active hours recorded a $73.46 last hour reads last hour, and with 100 active hours it reads last hour, high", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const pane = await spendPane($);

    seedTotals(world, paceAtom(73.46, undefined));
    await settle(pane);
    const unknown = await tilesOf(pane);
    seedTotals(world, paceAtom(73.46, 100));
    await settle(pane);
    const known = await tilesOf(pane);

    expect(unknown.labels?.text).toBe("today 7 days 30 days last hour");
    expect(known.labels?.text).toBe("today 7 days 30 days last hour, high");
  });

  test("S3a $3.10 spent in the current hour shows $3.10/h as the last hour", async ($, on) => {
    const world = worldOf(on, API_KEY);

    const tiles = await tilesOf(await paneWithTotals($, world, hourlyAtom(3.1)));

    expect(tiles.shown[3]).toBe("$3.10/h");
  });

  test("S3b spend only 3 hours ago shows $0.00/h as the last hour", async ($, on) => {
    const world = worldOf(on, API_KEY);

    const tiles = await tilesOf(
      await paneWithTotals($, world, { ...hourlyAtom(3.1), lastHour: 0 }),
    );

    expect(tiles.shown[3]).toBe("$0.00/h");
  });

  test("S4 seven projects show the five biggest, largest first, then 2 more, and the row dollars add up to the 30 days total to the cent", async ($, on) => {
    const world = worldOf(on, API_KEY);

    const pane = await paneWithTotals(
      $,
      world,
      totalsAtom({
        month: PROJECT_DOLLARS.reduce((sum, [, usd]) => sum + usd, 0),
        projects: PROJECT_DOLLARS.map(([name, usd]) => ({ name, usd })),
      }),
    );

    const owners = ownersOf((await blocks(pane))[PROJECTS_TITLE]);
    expect(owners.map((owner) => owner.name)).toEqual(SHOWN_PROJECTS);
    expect(centsOf(owners)).toBe(toCents((await tilesOf(pane)).shown.at(-2) ?? null));
  });
});

function equalTilesAtom(figures: { today: number; week: number }): Partial<WorldAtom> {
  return totalsAtom({
    ...figures,
    month: WEEK_USD,
    lastHour: LAST_HOUR_USD,
    projects: [{ name: MAIN_TREE_NAME, usd: WEEK_USD }],
  });
}

function paceAtom(
  lastHour: number,
  activeHours: number | undefined,
): Partial<WorldAtom> & { activeHours?: number } {
  const atom = totalsAtom({
    today: 30,
    week: 2000,
    month: 2500,
    lastHour,
    projects: [{ name: MAIN_TREE_NAME, usd: 2500 }],
  });
  return activeHours === undefined ? atom : { ...atom, activeHours };
}

function hourlyAtom(usd: number): Partial<WorldAtom> {
  return totalsAtom({
    today: usd,
    week: usd + 1,
    month: usd + 2,
    lastHour: usd,
    projects: [{ name: MAIN_TREE_NAME, usd }],
  });
}

async function tilesOf(pane: Pane): Promise<Tiles> {
  const rows = (await blocks(pane))[HISTORY_TITLE]?.rows ?? [];
  const [values, labels] = rows;
  return { values, labels, shown: (values?.text ?? "").split(" ").filter((cell) => cell !== "") };
}
