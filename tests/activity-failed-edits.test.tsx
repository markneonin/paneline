import { describe, expect, test } from "claude-code/testing";

import { failedEditWorldOf, failingEdit, readOf } from "./failed-edit-world";
import { lines, paneOnTab, texts } from "./clear-world";
import type { Pane } from "./clear-world";
import { textOf } from "./draw-tree";

const PROSE_PATH = "/work/prose.txt";
const NOTES_PATH = "/work/notes.txt";
const PROSE_NAME = "prose.txt";
const COUNT_MARK = /[+\-−]\d/;
const CHIP_LINE = /^(?:\d+ms|\d+s|\d+m \d{2}s) · \d+ tools?/;

describe("failed edits in the Files tab and the Activity header", () => {
  test("G2 a file read and then edited only by failed edits is listed without edit counts", async ($, on) => {
    failedEditWorldOf(on);
    await readOf($, "read-1", PROSE_PATH);
    await failingEdit($, "edit-1", PROSE_PATH);
    await failingEdit($, "edit-2", PROSE_PATH);

    const pane = await paneOnTab($, "Files");

    const rowText = await fileRowTextOf(pane, PROSE_NAME);
    expect(rowText).toContain(PROSE_NAME);
    expect(rowText).not.toMatch(COUNT_MARK);
  });

  test("G3 two failed edits to a file leave the Activity header with no files part", async ($, on) => {
    failedEditWorldOf(on);
    await failingEdit($, "edit-1", NOTES_PATH);
    await failingEdit($, "edit-2", NOTES_PATH);

    const pane = await paneOnTab($, "Activity");

    expect(await chipLineOf(pane)).toMatch(/^\S+ · 2 tools · 2 errors$/);
  });
});

async function fileRowTextOf(pane: Pane, name: string): Promise<string> {
  const row = (await lines(pane)).find((line) =>
    line.parts.some((part) => textOf(part).includes(name)),
  );
  return row?.parts.map((part) => textOf(part)).join("") ?? "";
}

async function chipLineOf(pane: Pane): Promise<string> {
  return (await texts(pane)).find((text) => CHIP_LINE.test(text)) ?? "";
}
