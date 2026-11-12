import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";
import type { On } from "claude-code";

import { paneOnTab, readFile, runCommand, settle, worldOf } from "./clear-world";
import { TAB_BAR_ROWS } from "../hooks/tab-bar";
import type { Pane, World } from "./clear-world";
import { linesOf } from "./skills-tree";

const SESSION = "session";
const PAGE_ROWS = 20;
const CALLS = 60;
const FILES = 60;
const FILTER_KEY = "filter";
const FILTER_OPEN_KEY = "filter-open";
const NO_MATCH = "zzz";
const NO_MATCHING_CALLS = "no matching calls";
const NO_MATCHING_FILES = "no matching files";
const NARROWING = "npm";
const FIRST_MATCH = "npm test first";
const SECOND_MATCH = "npm test second";

describe("pane offset never points past the content", () => {
  test("O1 Activity scrolled to the bottom, pressing f and typing a filter that matches nothing shows the filter row and no matching calls", async ($, on) => {
    const pane = await scrolledActivity($, on);

    await pressFilterOpen(pane);
    await typeFilter(pane, NO_MATCH);

    const screen = await screenOf(pane);
    expect(screen.some(isFilterRow)).toBe(true);
    expect(screen).toContain(NO_MATCHING_CALLS);
  });

  test("O3 Activity scrolled to the bottom, pressing f and typing a filter that keeps two calls shows the filter row and both calls on screen", async ($, on) => {
    const pane = await scrolledActivity($, on);

    await pressFilterOpen(pane);
    await typeFilter(pane, NARROWING);

    const screen = await screenOf(pane);
    const shown = screen.join("\n");
    expect(screen.some(isFilterRow)).toBe(true);
    expect(shown).toContain(FIRST_MATCH);
    expect(shown).toContain(SECOND_MATCH);
  });

  test("O4 Activity scrolled to the bottom, pressing f shows the filter row on screen", async ($, on) => {
    const pane = await scrolledActivity($, on);

    await pressFilterOpen(pane);

    expect((await screenOf(pane)).some(isFilterRow)).toBe(true);
  });

  test("O5 Files scrolled to the bottom, pressing f and typing a filter that matches nothing shows the filter row and no matching files", async ($, on) => {
    const pane = await scrolledFiles($, on);

    await pressFilterOpen(pane);
    await typeFilter(pane, NO_MATCH);

    const screen = await screenOf(pane);
    expect(screen.some(isFilterRow)).toBe(true);
    expect(screen.join("\n")).toContain(NO_MATCHING_FILES);
  });

  test("O6 Files scrolled to the bottom, pressing f shows the filter row on screen", async ($, on) => {
    const pane = await scrolledFiles($, on);

    await pressFilterOpen(pane);

    expect((await screenOf(pane)).some(isFilterRow)).toBe(true);
  });

  test("O8 Activity not scrolled, a filter that keeps two calls shows the filter row first and clearing it brings back the first screen", async ($, on) => {
    const pane = await activityPane($, on);
    const first = await screenOf(pane);

    await typeFilter(pane, NARROWING);
    const filtered = await screenOf(pane);
    await typeFilter(pane, "");

    expect(filtered.findIndex(isFilterRow)).toBe(TAB_BAR_ROWS);
    expect(filtered.join("\n")).toContain(FIRST_MATCH);
    expect(await screenOf(pane)).toEqual(first);
  });
});

async function activityPane($: Engine, on: On, world: World = worldOf(on)): Promise<Pane> {
  answerWrites(on);
  for (let index = 1; index <= CALLS; index++) await runCommand($, world, `echo ${index}`);
  await runCommand($, world, FIRST_MATCH);
  await runCommand($, world, SECOND_MATCH);
  return paneOnTab($, "Activity", { rows: PAGE_ROWS });
}

async function scrolledActivity($: Engine, on: On, world?: World): Promise<Pane> {
  const pane = await activityPane($, on, world);
  await scrollToBottom($, pane);
  return pane;
}

async function scrolledFiles($: Engine, on: On): Promise<Pane> {
  const world = worldOf(on);
  answerWrites(on);
  for (let index = 1; index <= FILES; index++) {
    await readFile($, world, `/work/src/file-${String(index).padStart(2, "0")}.ts`);
  }
  const pane = await paneOnTab($, "Files", { rows: PAGE_ROWS });
  await scrollToBottom($, pane);
  return pane;
}

function answerWrites(on: On): void {
  on("fs.write", () => ({ value: undefined }));
  on("fs.list", () => ({ value: [] }));
}

async function scrollToBottom($: Engine, pane: Pane): Promise<void> {
  const before = await screenOf(pane);
  await scrollBy($, pane, (await contentRowsOf(pane)) * 2);
  expect(await screenOf(pane), "the list moved when scrolled").not.toEqual(before);
}

async function scrollBy($: Engine, pane: Pane, by: number): Promise<void> {
  await $.ui.scroll({
    component: "Pane",
    requestId: SESSION,
    offset: 0,
    by,
    bodyRows: PAGE_ROWS,
    contentRows: await contentRowsOf(pane),
    origin: { kind: "person" },
  });
  await settle(pane);
}

async function contentRowsOf(pane: Pane): Promise<number> {
  return linesOf(await pane.drawn()).length;
}

async function screenOf(pane: Pane): Promise<string[]> {
  return linesOf(await pane.drawn())
    .slice(0, PAGE_ROWS)
    .map((line) => line.text);
}

function isFilterRow(text: string): boolean {
  return text.startsWith("f filter");
}

async function typeFilter(pane: Pane, text: string): Promise<void> {
  await pane.input({ key: FILTER_KEY, text, kind: "change" });
  await settle(pane);
}

async function pressFilterOpen(pane: Pane): Promise<void> {
  await pane.press({ key: FILTER_OPEN_KEY });
  await settle(pane);
}
