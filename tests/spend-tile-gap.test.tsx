import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";

import { screenRows } from "./band-screen";
import {
  API_KEY,
  COLUMNS,
  NARROW_COLUMNS,
  sessionWithAllBlocks,
  WIDE_COLUMNS,
  setSessionCost,
  spendPane,
  worldOf,
} from "./spend-world";

const ELLIPSIS = "…";
const SESSION_LABEL = "this session";
const HIT_LABEL = "cache, all agents";
const RENT_LABEL = "result tokens";
const LIVE_PANE_COLUMNS = 53;
const SESSION_VALUE = "$12.37";
const HIT_VALUE = "64%";
const RENT_VALUE = "~9.2k";
const CLIPPED_COST_PREFIX = "$12";
const CLIPPED_COST_USD = 123.45;
const CLIPPED_COST_COLUMNS = 20;
const MIN_LABEL_GAP = 2;
const TIGHT_COLUMNS = 52;

describe("spend tile gap", () => {
  test("A4 at 60 columns the cache hit label reads in full with no ellipsis and a blank cell before tool results", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sessionWithAllBlocks($, world);

    const narrow = labelRowOf(await spendRows($, NARROW_COLUMNS));

    expect(narrow).toContain(RENT_LABEL);
    expect(hitLabelOf(narrow)).not.toContain(ELLIPSIS);
    expect(hitLabelOf(narrow)).toBe(HIT_LABEL);
    expect(narrow[narrow.indexOf(RENT_LABEL) - 1]).toBe(" ");
  });

  test("A7 at 53 columns, the live pane width, the tool results label reads result tokens in full", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sessionWithAllBlocks($, world);

    const live = labelRowOf(await spendRows($, LIVE_PANE_COLUMNS));

    expect(live).toContain(RENT_LABEL);
  });

  test("A6 at 60 columns at least two blank cells separate the cache hit label from tool results", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sessionWithAllBlocks($, world);

    const narrow = labelRowOf(await spendRows($, NARROW_COLUMNS));

    expect(blankRunBeforeRentLabel(narrow)).toBeGreaterThanOrEqual(2);
  });

  test("A4 at 120 columns the cache hit label reads in full with no ellipsis and a blank cell before tool results", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sessionWithAllBlocks($, world);

    const wide = labelRowOf(await spendRows($, WIDE_COLUMNS));

    expect(hitLabelOf(wide)).not.toContain(ELLIPSIS);
    expect(hitLabelOf(wide)).toBe(HIT_LABEL);
    expect(wide[wide.indexOf(RENT_LABEL) - 1]).toBe(" ");
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

  test("S3 at 100 columns every totals value and label reads in full and each label starts in the column of its value", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sessionWithAllBlocks($, world);

    const rows = await spendRows($, COLUMNS);

    const values = rowContaining(rows, SESSION_VALUE);
    const labels = rowContaining(rows, SESSION_LABEL);
    const valueStarts = startsOf(values, [SESSION_VALUE, HIT_VALUE, RENT_VALUE]);
    expect(Math.min(...valueStarts)).toBeGreaterThanOrEqual(0);
    expect(startsOf(labels, [SESSION_LABEL, HIT_LABEL, RENT_LABEL])).toEqual(valueStarts);
  });

  test("STP1a at 52 columns the session tiles read this session, cache, all agents and result tokens in full with at least two blank cells between labels", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sessionWithAllBlocks($, world);

    const labels = labelRowOf(await spendRows($, TIGHT_COLUMNS));

    expectLabelsInFullWithGaps(labels);
  });

  test("STP1b at 60 columns the session tiles read this session, cache, all agents and result tokens in full with at least two blank cells between labels", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sessionWithAllBlocks($, world);

    const labels = labelRowOf(await spendRows($, NARROW_COLUMNS));

    expectLabelsInFullWithGaps(labels);
  });

  test("STP1c at 120 columns the session tiles read this session, cache, all agents and result tokens in full with at least two blank cells between labels", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sessionWithAllBlocks($, world);

    const labels = labelRowOf(await spendRows($, WIDE_COLUMNS));

    expectLabelsInFullWithGaps(labels);
  });
});

function expectLabelsInFullWithGaps(labelRow: string): void {
  const [session = -1, hit = -1, rent = -1] = startsOf(labelRow, [
    SESSION_LABEL,
    HIT_LABEL,
    RENT_LABEL,
  ]);
  expect(Math.min(session, hit, rent)).toBeGreaterThanOrEqual(0);
  expect(hit).toBeGreaterThanOrEqual(session + SESSION_LABEL.length + MIN_LABEL_GAP);
  expect(rent).toBeGreaterThanOrEqual(hit + HIT_LABEL.length + MIN_LABEL_GAP);
}

async function spendRows($: Engine, columns: number): Promise<string[]> {
  const pane = await spendPane($, columns);
  return screenRows(await pane.drawn(), columns);
}

function rowContaining(rows: string[], text: string): string {
  return rows.find((row) => row.includes(text)) ?? "";
}

function labelRowOf(rows: string[]): string {
  return rowContaining(rows, SESSION_LABEL);
}

function hitLabelOf(labelRow: string): string {
  const from = labelRow.indexOf(SESSION_LABEL) + SESSION_LABEL.length;
  return labelRow.slice(from, labelRow.indexOf(RENT_LABEL)).trim();
}

function blankRunBeforeRentLabel(labelRow: string): number {
  const before = labelRow.slice(0, labelRow.indexOf(RENT_LABEL));
  return before.length - before.trimEnd().length;
}

function startsOf(row: string, texts: string[]): number[] {
  return texts.map((text) => row.indexOf(text));
}
