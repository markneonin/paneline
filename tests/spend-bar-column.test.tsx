import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";

import { screenRows } from "./band-screen";
import { paneWithTotals, totalsAtom } from "./fixtures/spend-atom";
import type { Block } from "./skills-tree";
import {
  API_KEY,
  HAIKU,
  NARROW_COLUMNS,
  OPUS,
  PROJECTS_TITLE,
  SPLIT_TITLE,
  WIDE_COLUMNS,
  agentOwner,
  blocks,
  mainTurn,
  ownersOf,
  setSessionCost,
  startFreshSession,
  worldOf,
} from "./spend-world";
import type { Pane, World } from "./spend-world";

const BAR_CELL = /[▰▱]/;
const BIG_PROJECT = "big";
const BIG_USD = 127.81;
const WORK_USD = 19.99;
const SESSION_USD = 9.99;
const SEVEN_CELL_AMOUNT = "$127.81";
const SIX_CELL_AMOUNT = "$19.99";
const SPLIT_AMOUNTS = ["~$20.00", "~$1.00"];
const MAIN_TOKENS = { input: 5_000_000 };
const EXPLORE_TOKENS = { input: 1_000_000 };
const BAR_ROWS = 4;

describe("spend bar column across blocks", () => {
  test("A7 at 60 columns the first bar cell of Where it went and of By project sits in the same column when their longest amounts are 7 and 6 cells and the split amounts are the tracked spend, not a figure scaled to the session cost", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sessionWithLongerProjectAmount($, world);
    const pane = await longerProjectPane($, world, NARROW_COLUMNS);

    const starts = await barStartsOf(pane, NARROW_COLUMNS);

    expect(await amountsOfBlocks(pane)).toEqual({
      projects: [SEVEN_CELL_AMOUNT, SIX_CELL_AMOUNT],
      split: SPLIT_AMOUNTS,
    });
    expect(starts).toHaveLength(BAR_ROWS);
    expect(new Set(starts).size).toBe(1);
  });

  test("A8 at 120 columns the first bar cell of Where it went and of By project sits in the same column when their longest amounts are 7 and 6 cells and the split amounts are the tracked spend, not a figure scaled to the session cost", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sessionWithLongerProjectAmount($, world);
    const pane = await longerProjectPane($, world, WIDE_COLUMNS);

    const starts = await barStartsOf(pane, WIDE_COLUMNS);

    expect(await amountsOfBlocks(pane)).toEqual({
      projects: [SEVEN_CELL_AMOUNT, SIX_CELL_AMOUNT],
      split: SPLIT_AMOUNTS,
    });
    expect(starts).toHaveLength(BAR_ROWS);
    expect(new Set(starts).size).toBe(1);
  });
});

async function sessionWithLongerProjectAmount($: Engine, world: World): Promise<void> {
  await startFreshSession($, world);
  await mainTurn($, world, { model: OPUS, tokens: MAIN_TOKENS });
  await agentOwner($, world, "Explore", HAIKU, EXPLORE_TOKENS);
  await setSessionCost($, world, SESSION_USD);
}

function longerProjectPane($: Engine, world: World, columns: number): Promise<Pane> {
  return paneWithTotals(
    $,
    world,
    totalsAtom({
      month: BIG_USD + WORK_USD,
      projects: [
        { name: BIG_PROJECT, usd: BIG_USD },
        { name: "work", usd: WORK_USD },
      ],
    }),
    columns,
  );
}

async function amountsOfBlocks(pane: Pane) {
  const found = await blocks(pane);
  return {
    projects: amountsOf(found[PROJECTS_TITLE]),
    split: amountsOf(found[SPLIT_TITLE]),
  };
}

function amountsOf(block: Block | undefined): (string | null)[] {
  return ownersOf(block).map((owner) => owner.dollars);
}

async function barStartsOf(pane: Pane, columns: number): Promise<number[]> {
  const rows = screenRows(await pane.drawn(), columns);
  return rows.filter((row) => BAR_CELL.test(row)).map((row) => row.search(BAR_CELL));
}
