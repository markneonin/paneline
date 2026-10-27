import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";

import { screenRows } from "./band-screen";
import {
  API_KEY,
  COLUMNS,
  NARROW_COLUMNS,
  sessionWithAllBlocks,
  setSessionCost,
  spendPane,
  worldOf,
} from "./spend-world";

const ELLIPSIS = "…";
const SESSION_LABEL = "this session";
const HIT_LABEL = "from cache · all agents";
const RENT_LABEL = "tool results";
const SESSION_VALUE = "$12.37";
const HIT_VALUE = "64%";
const RENT_VALUE = "9.2k";
const CLIPPED_COST_PREFIX = "$123";
const CLIPPED_COST_USD = 123.45;
const CLIPPED_COST_COLUMNS = 20;
const DEFAULT_TILE_STARTS = [1, 34, 67];

describe("spend tile gap", () => {
  test("S1 at 60 columns the clipped cache hit label ends in a blank cell before tool results", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sessionWithAllBlocks($, world);

    const rows = await spendRows($, NARROW_COLUMNS);

    const labels = rowContaining(rows, SESSION_LABEL);
    expect(labels).toContain(ELLIPSIS);
    expect(labels.slice(labels.indexOf(ELLIPSIS) + 1)).toMatch(/^ +tool results/);
  });

  test("S2 at 20 columns a clipped session cost ends in a blank cell before the cache hit value", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sessionWithAllBlocks($, world);
    await setSessionCost($, world, CLIPPED_COST_USD);

    const rows = await spendRows($, CLIPPED_COST_COLUMNS);

    const values = rowContaining(rows, CLIPPED_COST_PREFIX);
    expect(values).toContain(ELLIPSIS);
    expect(values.slice(values.indexOf(ELLIPSIS) + 1)).toMatch(/^ +64%/);
  });

  test("S3 at 100 columns every totals value and label starts in its usual column and reads in full", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sessionWithAllBlocks($, world);

    const rows = await spendRows($, COLUMNS);

    const values = rowContaining(rows, SESSION_VALUE);
    const labels = rowContaining(rows, SESSION_LABEL);
    expect(startsOf(values, [SESSION_VALUE, HIT_VALUE, RENT_VALUE])).toEqual(DEFAULT_TILE_STARTS);
    expect(startsOf(labels, [SESSION_LABEL, HIT_LABEL, RENT_LABEL])).toEqual(DEFAULT_TILE_STARTS);
  });
});

async function spendRows($: Engine, columns: number): Promise<string[]> {
  const pane = await spendPane($, columns);
  return screenRows(await pane.drawn(), columns);
}

function rowContaining(rows: string[], text: string): string {
  return rows.find((row) => row.includes(text)) ?? "";
}

function startsOf(row: string, texts: string[]): number[] {
  return texts.map((text) => row.indexOf(text));
}
