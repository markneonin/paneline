import { describe, expect, test } from "claude-code/testing";

import {
  API_KEY,
  HEADINGS,
  CACHE_TITLE,
  RENT_TITLE,
  SPLIT_TITLE,
  blocks,
  cacheSummaryOf,
  isAllMuted,
  lines,
  missesOf,
  noteRowOf,
  ownersOf,
  sessionWithAllBlocks,
  shapeOf,
  spendPane,
  totalsOf,
  worldOf,
} from "./spend-world";

const RICH_TOTALS = ["$12.37", "64%", "9.2k"];
const RICH_SHAPE = [
  "totals",
  "labels",
  "blank",
  "totals",
  "blank",
  `heading ${SPLIT_TITLE}`,
  "blank",
  "spend",
  "note",
  "spend",
  "spend",
  "blank",
  `heading ${CACHE_TITLE}`,
  "summary",
  "blank",
  "miss",
  "blank",
  `heading ${RENT_TITLE}`,
  "blank",
  "tool",
];

describe("spend look B", () => {
  test("L1 with a $12.37 session, 64% read from cache and 9.2k tokens of tool results the top shows $12.37, 64% and 9.2k in one row with their labels muted under them", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sessionWithAllBlocks($, world);

    const pane = await spendPane($);

    const totals = totalsOf(await lines(pane));
    expect([totals?.usd, totals?.hit, totals?.rent]).toEqual(RICH_TOTALS);
    expect(isAllMuted(totals?.labels)).toBe(true);
    expect(isAllMuted(totals?.values)).toBe(false);
  });

  test("L2 the tab reads top to bottom as totals, labels, a blank row, each heading followed by a blank row and its rows, with the cache summary right under its heading and a blank row after it", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sessionWithAllBlocks($, world);

    const pane = await spendPane($);

    expect(shapeOf(await lines(pane))).toEqual(RICH_SHAPE);
  });

  test("L3 every spend row, miss row, tool-result row, the background note and the cache summary starts at the same column as its heading", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sessionWithAllBlocks($, world);

    const found = await blocks(await spendPane($));

    const offsets = HEADINGS.flatMap((title) =>
      (found[title]?.rows ?? []).map((row) => row.indent - (found[title]?.heading.indent ?? 0)),
    );
    expect(ownersOf(found[SPLIT_TITLE])).toHaveLength(3);
    expect(noteRowOf(found[SPLIT_TITLE])).toBeDefined();
    expect(offsets.length).toBeGreaterThanOrEqual(6);
    expect(new Set(offsets)).toEqual(new Set([0]));
  });

  test("L4 the cache section opens with 1 miss and ~$0.37 lost and lists the 78k miss under it", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sessionWithAllBlocks($, world);

    const cache = (await blocks(await spendPane($)))[CACHE_TITLE];

    expect(cacheSummaryOf(cache)).toEqual({ misses: "1 miss", lost: "~$0.37" });
    expect(missesOf(cache).map((miss) => [miss.cause, miss.tokens])).toEqual([
      ["cache rebuilt", "78k"],
    ]);
  });
});
