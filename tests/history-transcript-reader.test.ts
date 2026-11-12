import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";

import { shownTexts } from "./skills-tree";
import { COLUMNS, openPane, settle, showTabThroughArrows } from "./spend-world";
import type { Pane } from "./spend-world";
import { TRANSCRIPT, appendMessage, historyWorldOf, startFreshSession } from "./history-transcript";
import type { HistoryWorld } from "./history-transcript";
import { paddedTo } from "./transcript-world";

const HISTORY_TAB = "History";
const BUNDLED_READER = "/h/u/.local/bin/claude";
const BUNDLED_READER_ENV = { ARGV0: "rg" };
const LONG_TRANSCRIPT_BYTES = 5 * 1024 * 1024;
const PROMPT_COUNT = 40;
const REST_OF_PROMPT = "the rest of the message keeps going ".repeat(20);
const TIME_ROW = /^\d\d:\d\d/;
const NO_BUNDLED_READER_PROMPT = "asked on a machine without the bundled search binary";

describe("history transcript reader", () => {
  test("S1 entering History on a long session reads the transcript with the bundled search binary and never starts grep", async ($, on) => {
    const world = historyWorldOf(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await appendLongSession($, world);

    await showTabThroughArrows(pane, HISTORY_TAB);

    expect(world.spawning.transcriptSpawns.map((spawn) => spawn.argv[0])).toEqual([BUNDLED_READER]);
    expect(world.spawning.transcriptSpawns.map((spawn) => spawn.env)).toEqual([BUNDLED_READER_ENV]);
  });

  test("S2 entering History on a long session shows the prompt times before the transcript read ends and each first line after", async ($, on) => {
    const world = historyWorldOf(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await appendLongSession($, world);
    const release = world.transcripts.pause();

    await showTabThroughArrows(pane, HISTORY_TAB);
    await world.transcripts.readHeld();
    const timesBeforeRead = await timeRowsOf(pane);
    release();
    await world.transcripts.readsFinished();
    await settle(pane);

    expect(timesBeforeRead).toHaveLength(PROMPT_COUNT);
    expect(await timeRowsOf(pane)).toEqual(
      Array.from({ length: PROMPT_COUNT }, (_, at) => expect.stringContaining(firstLineOf(at + 1))),
    );
  });

  test("S3 entering History on a machine without the bundled search binary shows the prompt text and no read toast", async ($, on) => {
    const world = historyWorldOf(on);
    world.transcripts.bundledReaderInstalled = false;
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await appendMessage($, world, { door: "prompt", id: "p1", text: NO_BUNDLED_READER_PROMPT });

    await showTabThroughArrows(pane, HISTORY_TAB);
    await settle(pane);
    await world.transcripts.readsFinished();
    await settle(pane);

    expect(world.spawning.toasts).toEqual([]);
    expect(shownTexts(await pane.drawn()).join("\n")).toContain(NO_BUNDLED_READER_PROMPT);
  });
});

async function appendLongSession($: Engine, world: HistoryWorld): Promise<void> {
  world.transcripts.files.set(TRANSCRIPT, paddedTo(LONG_TRANSCRIPT_BYTES, []));
  for (let at = 1; at <= PROMPT_COUNT; at++)
    await appendMessage($, world, { door: "prompt", id: `p${at}`, text: promptText(at) });
}

function promptText(at: number): string {
  return `${firstLineOf(at)}\n${REST_OF_PROMPT}`;
}

function firstLineOf(at: number): string {
  return `prompt ${at} opens the long session`;
}

async function timeRowsOf(pane: Pane): Promise<string[]> {
  return shownTexts(await pane.drawn()).filter((text) => TIME_ROW.test(text));
}
