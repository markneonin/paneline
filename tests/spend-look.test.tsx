import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";

import { paneInk } from "../hooks/pane-ink";
import { textOf } from "./draw-tree";
import { oracleAtom, paneWithTotals, seedTotals } from "./fixtures/spend-atom";
import type { WorldAtom } from "./fixtures/spend-atom";
import type { Line } from "./skills-tree";

import {
  API_KEY,
  HEADINGS,
  answerPrompts,
  CACHE_TITLE,
  HISTORY_TITLE,
  PROJECTS_TITLE,
  RENT_TITLE,
  SPLIT_TITLE,
  blocks,
  isAllMuted,
  lines,
  missCaptionOf,
  missesOf,
  noteRowOf,
  ownersOf,
  NARROW_COLUMNS,
  OPUS,
  mainTurn,
  sessionWithAllBlocks,
  setSessionCost,
  settle,
  shapeOf,
  spendPane,
  submitPrompt,
  totalsOf,
  unstampedLines,
  unwrappedTexts,
  worldOf,
} from "./spend-world";
import type { Pane, World } from "./spend-world";

const RICH_TOTALS = ["$12.37", "64%", "~9.2k"];
const ONE_PROJECT = { name: "alpha", usd: 72.26 };
const RICH_SESSION = 12.37;
const RECEIPT_TOKENS = { input: 30_000, output: 8_200 };
const RECEIPT_MS = 72_000;
const LAST_TURN_HEADING = "Last turn · tokens billed (cache reads included)";
const RICH_SHAPE = [
  "totals",
  "labels",
  "blank",
  "totals",
  "blank",
  `heading ${HISTORY_TITLE}`,
  "blank",
  "tiles",
  "tiles",
  "blank",
  `heading ${PROJECTS_TITLE}`,
  "blank",
  "project",
  "blank",
  `heading ${SPLIT_TITLE}`,
  "blank",
  "spend",
  "note",
  "spend",
  "spend",
  "blank",
  `heading ${CACHE_TITLE}`,
  "blank",
  "miss",
  "blank",
  `heading ${RENT_TITLE}`,
  "blank",
  "tool",
];

describe("spend look B", () => {
  test("L1 with a $12.37 session, 64% read from cache and about 9.2k tokens in tool results the top shows $12.37, 64% and ~9.2k in one row with their labels muted under them", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sessionWithAllBlocks($, world);

    const pane = await spendPane($);

    const totals = totalsOf(await lines(pane));
    expect([totals?.usd, totals?.hit, totals?.rent]).toEqual(RICH_TOTALS);
    expect(isAllMuted(totals?.labels)).toBe(true);
    expect(isAllMuted(totals?.values)).toBe(false);
  });

  test("L2 the tab reads top to bottom as totals, labels, a blank row, then the Last turn receipt between the totals and History, History with one blank row under its heading and then its tiles, then By project · 30 days with one blank row under its heading and then its rows, then Where it went, each other heading followed by a blank row and its rows, then Cache misses with one blank row under its heading, then its miss rows", async ($, on) => {
    on("turn.start", (_$, e) => ({ turnId: e.turnId }));
    answerPrompts(on);
    const world = worldOf(on, API_KEY);
    await sessionWithAllBlocks($, world);
    await submitPrompt($, world, "go");
    await mainTurn($, world, { model: OPUS, tokens: RECEIPT_TOKENS, durationMs: RECEIPT_MS });

    const shown = await unstampedLines(
      await paneWithTotals($, world, {
        ...oracleAtom(),
        projects: [ONE_PROJECT],
        session: RICH_SESSION,
      }),
    );
    const labelsAt = shown.findIndex((line) => line === totalsOf(shown)?.labels);
    const titleAt = shown.findIndex((line) => line.text === LAST_TURN_HEADING);
    const historyAt = shown.findIndex((line) => line.text === HISTORY_TITLE);
    const splitAt = shown.findIndex((line) => line.text === SPLIT_TITLE);
    expect(titleAt, `a ${LAST_TURN_HEADING} heading`).toBeGreaterThan(-1);
    expect(titleAt).toBeGreaterThan(labelsAt);
    expect(historyAt).toBeGreaterThan(titleAt);
    expect(splitAt).toBeGreaterThan(historyAt);
    const receipt = shown.slice(titleAt, historyAt).map((line) => line.text);
    expect([receipt[0], receipt[1]]).toEqual([LAST_TURN_HEADING, ""]);
    expect(receipt.slice(2, -1)).not.toEqual([]);
    expect(receipt.slice(2, -1)).not.toContain("");
    expect(receipt.at(-1)).toBe("");
    expect(shapeOf([...shown.slice(0, titleAt), ...shown.slice(historyAt)])).toEqual(RICH_SHAPE);
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

  test("L4 the totals caption ends with 1 miss and ~$0.37 lost and the cache section lists the 78k miss", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sessionWithAllBlocks($, world);

    const pane = await spendPane($);

    const cache = (await blocks(pane))[CACHE_TITLE];

    expect(missCaptionOf(await lines(pane))).toEqual({ misses: "1 miss", lost: "~$0.37" });
    expect(missesOf(cache).map((miss) => [miss.cause, miss.tokens])).toEqual([
      ["cache rebuilt", "78k"],
    ]);
  });
});

const ENGINE_SESSION = 12.37;
const COUNTING = { doneBytes: 420, totalBytes: 1000, failed: 0 };
const COUNTED_ALL_UNREADABLE = { doneBytes: 1000, totalBytes: 1000, failed: 3 };
const COUNTING_AND_UNREADABLE = { doneBytes: 420, totalBytes: 1000, failed: 3 };
const COUNTED_ALL = { doneBytes: 1000, totalBytes: 1000, failed: 0 };
const COUNTING_NOTE = "counting · 42%";
const UNREADABLE_NOTE = "· 3 unreadable";
const HISTORY_ROWS_SHAPE = [
  `heading ${HISTORY_TITLE}`,
  "blank",
  "tiles",
  "tiles",
  "blank",
  `heading ${PROJECTS_TITLE}`,
  "blank",
  "project",
  "project",
  "project",
];

describe("spend look with the counting note", () => {
  test("K1 while 42% of the transcripts are counted the History heading carries counting · 42% in the muted colour beside the title and the rows under it stay as they were", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await setSessionCost($, world, ENGINE_SESSION);
    const pane = await paneWithTotals($, world, oracleAtom());
    const plain = await lines(pane);

    const shown = await linesWith($, pane, world, { progress: COUNTING });

    const heading = historyHeadingOf(shown);
    expect(heading?.text).toBe(`${HISTORY_TITLE} ${COUNTING_NOTE}`);
    expect(mutedTextOf(heading)).toContain(COUNTING_NOTE);
    expect(texts(withoutHeading(shown))).toEqual(texts(withoutHeading(plain)));
  });

  test("K2 with every transcript counted and 3 unreadable the History heading carries · 3 unreadable in the muted colour and no counting", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await setSessionCost($, world, ENGINE_SESSION);
    const pane = await paneWithTotals($, world, oracleAtom());

    const shown = await linesWith($, pane, world, { progress: COUNTED_ALL_UNREADABLE });

    const heading = historyHeadingOf(shown);
    expect(heading?.text).toBe(`${HISTORY_TITLE} ${UNREADABLE_NOTE}`);
    expect(mutedTextOf(heading)).toContain(UNREADABLE_NOTE);
  });

  test("K3 while counting 42% with 3 unreadable the History heading carries both notes, counting first", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await setSessionCost($, world, ENGINE_SESSION);
    const pane = await paneWithTotals($, world, oracleAtom());

    const shown = await linesWith($, pane, world, { progress: COUNTING_AND_UNREADABLE });

    expect(historyHeadingOf(shown)?.text).toBe(
      `${HISTORY_TITLE} ${COUNTING_NOTE} ${UNREADABLE_NOTE}`,
    );
  });

  test("K4 with no progress known the History heading is the plain title and the tab keeps its rows: totals, History tiles, By project rows", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await setSessionCost($, world, ENGINE_SESSION);

    const shown = await lines(await paneWithTotals($, world, oracleAtom()));

    const heading = historyHeadingOf(shown);
    expect(heading?.text).toBe(HISTORY_TITLE);
    expect(mutedTextOf(heading)).toBe("");
    expect(historyShapeOf(shown)).toEqual(HISTORY_ROWS_SHAPE);
  });

  test("K5 once every transcript is counted and none is unreadable the whole tab is drawn exactly as when no progress is known", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await setSessionCost($, world, ENGINE_SESSION);
    const pane = await paneWithTotals($, world, oracleAtom());
    const unknown = await lines(pane);

    const shown = await linesWith($, pane, world, { progress: COUNTED_ALL });

    expect(texts(shown)).toEqual(texts(unknown));
    expect(historyHeadingOf(shown)?.text).toBe(HISTORY_TITLE);
    expect(historyShapeOf(shown)).toEqual(HISTORY_ROWS_SHAPE);
  });

  test("K6 at 60 columns the heading with both notes is still one truncating row and the tab has the same number of rows", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await setSessionCost($, world, ENGINE_SESSION);
    const pane = await paneWithTotals($, world, oracleAtom(), NARROW_COLUMNS);
    const plain = await lines(pane);

    const shown = await linesWith($, pane, world, { progress: COUNTING_AND_UNREADABLE });

    expect(historyHeadingOf(shown)?.text).toBe(
      `${HISTORY_TITLE} ${COUNTING_NOTE} ${UNREADABLE_NOTE}`,
    );
    expect(await unwrappedTexts(pane)).toEqual([]);
    expect(shown.length).toBe(plain.length);
  });
});

async function linesWith(
  $: Engine,
  pane: Pane,
  world: World,
  change: Partial<WorldAtom>,
): Promise<Line[]> {
  seedTotals(world, { ...oracleAtom(), ...change });
  await settle(pane);
  return lines(pane);
}

function historyShapeOf(shown: Line[]): string[] {
  const shape = shapeOf(shown);
  const from = shape.indexOf(`heading ${HISTORY_TITLE}`);
  return shape.slice(from, from + HISTORY_ROWS_SHAPE.length);
}

function historyHeadingOf(shown: Line[]): Line | undefined {
  return shown.find((line) => line.text.startsWith(HISTORY_TITLE));
}

function withoutHeading(shown: Line[]): Line[] {
  const heading = historyHeadingOf(shown);
  return shown.filter((line) => line !== heading);
}

function texts(shown: Line[]): string[] {
  return shown.map((line) => line.text);
}

function mutedTextOf(line: Line | undefined): string {
  return (line?.parts ?? [])
    .filter((part) => part.props?.color === paneInk().muted)
    .map(textOf)
    .join("");
}
