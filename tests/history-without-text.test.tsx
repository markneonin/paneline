import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";

import { shownTexts } from "./skills-tree";
import {
  COLUMNS,
  OPUS,
  SPEND,
  mainTurn,
  openPane,
  settle,
  showTabThroughArrows,
  startFreshSession as startCostedSession,
} from "./spend-world";
import type { Pane } from "./spend-world";
import {
  TRANSCRIPT,
  appendMessage,
  historyWorldOf,
  jsonlRow,
  rewriteTranscript,
  startFreshSession,
  startIndexedSession,
  untilSettled,
} from "./history-transcript";
import type { HistoryWorld } from "./history-transcript";

const PROMPT_COUNT = 20;
const ENTRIES_PER_TURN = 2;
const BYTES_PER_ENTRY_LIMIT = 100;
const MARKER = "MARKERWORD";
const PROMPT_BODY = `${MARKER} ${"fix the status row and the spinner glyph ".repeat(5)}`;
const REPLY_BODY = `${MARKER} ${"I changed the spinner and checked every tab ".repeat(7)}`;
const HISTORY_STATE_KEY = "paneline.history.";
const HISTORY_TAB = "History";
const FORK_TRANSCRIPT = "/h/u/.claude/projects/p/session-fork.jsonl";
const TURN = { model: OPUS, tokens: { output: 10 }, context: 1000 };
const BIG_ROWS = 60;
const BIG_ROW_CHARS = 100_000;
const FIRST_PROMPT_AT = new Date(2026, 9, 27, 7, 3);
const SECOND_PROMPT_AT = new Date(2026, 9, 27, 7, 9);
const THIRD_PROMPT_AT = new Date(2026, 9, 27, 7, 12);

describe("history keeps no prompt or reply text", () => {
  test("W1 twenty prompts with replies leave a history of about a hundred bytes an entry and no prompt or reply text", async ($, on) => {
    const world = historyWorldOf(on);
    await startFreshSession($, world);

    await answerPrompts($, world, PROMPT_COUNT);

    const written = historyState(world);
    expect(
      written.length,
      `${world.state.get(HISTORY_STATE_KEY)?.version} history writes, last ${written.length} bytes`,
    ).toBeLessThanOrEqual(PROMPT_COUNT * ENTRIES_PER_TURN * BYTES_PER_ENTRY_LIMIT);
    expect(written).not.toContain(MARKER);
  });

  test("W2 entering History shows each prompt's first line from the transcript", async ($, on) => {
    const world = historyWorldOf(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await sendWithTranscriptText(
      $,
      world,
      "p1",
      "text the session held",
      "first line in the transcript\nsecond line",
    );
    await showHistory(pane);

    const rows = await promptRows(pane);

    expect(rows).toEqual([expect.stringMatching(/^\d\d:\d\d first line in the transcript/)]);
    expect(rows.join("")).not.toContain("second line");
  });

  test("W3 typing a word that only a reply in the transcript holds shows that reply line", async ($, on) => {
    const world = historyWorldOf(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await appendMessage($, world, { door: "prompt", id: "p1", text: "fix the status row" });
    await appendMessage($, world, {
      door: "response",
      id: "p1-reply",
      text: "reply text the session held",
    });
    rewriteTranscript(
      world,
      "reply text the session held",
      "the transcript reply mentions ZEBRAWORD here",
    );
    await showHistory(pane);

    await typeFilter(pane, "zebraword");

    const replies = await replyButtons(pane);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.props.label).toContain("ZEBRAWORD");
  });

  test("W4 a prompt sent while History is shown appears without a second transcript read", async ($, on) => {
    const world = historyWorldOf(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await appendMessage($, world, { door: "prompt", id: "p1", text: "the first question" });
    await showHistory(pane);

    await appendMessage($, world, { door: "prompt", id: "p2", text: "a question sent just now" });
    await settle(pane);

    expect(await promptRows(pane)).toEqual([
      expect.stringContaining("the first question"),
      expect.stringContaining("a question sent just now"),
    ]);
    expect(world.spawning.transcriptReads).toEqual([TRANSCRIPT]);
  });

  test("W5 resuming a transcript larger than 4 MiB lists its prompts with their times and texts", async ($, on) => {
    const world = historyWorldOf(on);
    world.transcripts.files.set(TRANSCRIPT, largeTranscript().join("\n"));
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await $.classic.SessionStart({ source: "resume", transcript_path: TRANSCRIPT } as never);
    await world.clock.advance(1000);
    await showHistory(pane);

    const rows = await promptRows(pane);

    expect(rows).toEqual([
      expect.stringMatching(/^07:03 fix the status row/),
      expect.stringMatching(/^07:09 now the history tab/),
      expect.stringMatching(/^07:12 and the last one/),
    ]);
    expect(historyState(world)).not.toContain("fix the status row");
  });

  test("W6 a finished turn writes its prompt as kind, id, time and counts, and shows its transcript cost next to the prompt", async ($, on) => {
    const world = historyWorldOf(on, true);
    const pane = await openPane($, COLUMNS);
    await startIndexedSession($, world);
    await startFreshSession($, world);

    await answerPrompts($, world, 1, 0.42);
    await showHistory(pane);
    await untilSettled(pane);

    expect(historyEntries(world)[0]).toEqual({
      kind: "prompt",
      id: "p1",
      at: expect.any(Number),
      tools: 0,
      failed: 0,
      ms: expect.any(Number),
    });
    expect(await promptRows(pane)).toEqual([expect.stringMatching(/ \$0\.42$/)]);
  });

  test("W7 leaving History and coming back reads the transcript once more and lists the prompt sent meanwhile", async ($, on) => {
    const world = historyWorldOf(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await appendMessage($, world, { door: "prompt", id: "p1", text: "before leaving" });
    await showHistory(pane);
    await showTabThroughArrows(pane, SPEND);
    await appendMessage($, world, { door: "prompt", id: "p2", text: "sent while away" });

    await showHistory(pane);

    expect(world.spawning.transcriptReads).toEqual([TRANSCRIPT, TRANSCRIPT]);
    expect(await promptRows(pane)).toEqual([
      expect.stringContaining("before leaving"),
      expect.stringContaining("sent while away"),
    ]);
  });

  test("W8 a slash-command note and a prompt recorded live both show their transcript text after leaving History and coming back", async ($, on) => {
    const world = historyWorldOf(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await sendWithTranscriptText(
      $,
      world,
      "p1",
      "text the session held",
      "the prompt as transcribed",
    );
    await appendMessage($, world, {
      door: "note",
      id: "c1",
      text: "/compact",
      origin: { kind: "engine" },
    });
    rewriteTranscript(
      world,
      JSON.stringify("/compact"),
      JSON.stringify("/compact keep the API notes"),
    );
    await showHistory(pane);
    await showTabThroughArrows(pane, SPEND);

    await showHistory(pane);

    expect(await promptRows(pane)).toEqual([
      expect.stringMatching(/^\d\d:\d\d the prompt as transcribed/),
      expect.stringMatching(/^\d\d:\d\d \/compact keep the API notes/),
    ]);
  });

  test("W10 entering History before any hook event gave a transcript path starts no read and draws the rows without text", async ($, on) => {
    const world = historyWorldOf(on);
    const pane = await openPane($, COLUMNS);
    await startCostedSession($, world);
    await appendMessage($, world, { door: "prompt", id: "p1", text: "asked with no path" });

    await showHistory(pane);

    expect(world.spawning.transcriptReads).toEqual([]);
    const rows = await promptRows(pane);
    expect(rows).toHaveLength(1);
    expect(rows.join("")).not.toContain("asked with no path");
  });

  test("W11 a transcript read that fails shows the History read failure toast and draws the rows without text", async ($, on) => {
    const world = historyWorldOf(on);
    world.spawning.transcriptFailures.push("cannot open the file", "cannot open the file");
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await appendMessage($, world, { door: "prompt", id: "p1", text: "asked while rg fails" });

    await showHistory(pane);

    expect(world.spawning.toasts).toEqual([
      expect.stringContaining("History could not read the transcript"),
    ]);
    const rows = await promptRows(pane);
    expect(rows).toHaveLength(1);
    expect(rows.join("")).not.toContain("asked while rg fails");
  });

  test("W13 a prompt sent in a forked session shows its text in History and the filter finds it", async ($, on) => {
    const world = historyWorldOf(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await appendMessage($, world, { door: "prompt", id: "p1", text: "asked before the fork" });
    await showHistory(pane);
    world.session = "session-fork";
    world.transcripts.files.set(FORK_TRANSCRIPT, world.transcripts.files.get(TRANSCRIPT) ?? "");
    world.transcriptPath = FORK_TRANSCRIPT;
    await $.classic.SessionStart({ source: "fork", transcript_path: FORK_TRANSCRIPT } as never);
    await appendMessage($, world, { door: "prompt", id: "p2", text: "asked inside the fork" });
    await settle(pane);

    await typeFilter(pane, "inside the fork");

    expect(world.spawning.transcriptReads.at(-1)).toBe(FORK_TRANSCRIPT);
    expect(await promptRows(pane)).toEqual([expect.stringContaining("asked inside the fork")]);
  });

  test("W14 entering History in a fork whose transcript file does not exist yet shows no toast, and a prompt sent once the file exists shows its text", async ($, on) => {
    const world = historyWorldOf(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    world.session = "session-fork";
    world.transcriptPath = FORK_TRANSCRIPT;
    await $.classic.SessionStart({ source: "fork", transcript_path: FORK_TRANSCRIPT } as never);
    const readsBefore = world.spawning.transcriptReads.length;

    await showHistory(pane);

    expect(world.spawning.toasts).toEqual([]);
    await typeFilter(pane, "abc");
    expect(world.spawning.transcriptReads.length - readsBefore).toBe(1);
    await typeFilter(pane, "");
    world.transcripts.files.set(FORK_TRANSCRIPT, "");
    await appendMessage($, world, { door: "prompt", id: "p2", text: "asked inside the fork" });
    await showTabThroughArrows(pane, SPEND);
    await showHistory(pane);
    expect(world.spawning.transcriptReads.length - readsBefore).toBe(2);
    expect(await promptRows(pane)).toEqual([expect.stringContaining("asked inside the fork")]);
  });

  test("W15 a transcript that exists but cannot be read by grep shows the History read failure toast", async ($, on) => {
    const world = historyWorldOf(on);
    world.transcripts.files.set(TRANSCRIPT, { unreadable: "grep-exit-2" });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await appendMessage($, world, {
      door: "prompt",
      id: "p1",
      text: "asked into an unreadable file",
    });

    await showHistory(pane);

    expect(world.spawning.toasts).toEqual([
      expect.stringContaining("History could not read the transcript"),
    ]);
  });
});

async function answerPrompts(
  $: Engine,
  world: HistoryWorld,
  count: number,
  usd = 0.1,
): Promise<void> {
  for (let at = 1; at <= count; at++) {
    await appendMessage($, world, { door: "prompt", id: `p${at}`, text: PROMPT_BODY });
    await $.turn.start({ text: PROMPT_BODY, turnId: `turn-${at}` });
    await appendMessage($, world, { door: "response", id: `p${at}-reply`, text: REPLY_BODY });
    world.index.db.addCall(`call-${at}`, {
      at: world.clock.now(),
      usd,
      dir: "p",
      session: "session-one",
      path: "p/session-one.jsonl",
    });
    await mainTurn($, world, TURN);
  }
}

async function sendWithTranscriptText(
  $: Engine,
  world: HistoryWorld,
  id: string,
  sessionText: string,
  transcriptText: string,
): Promise<void> {
  await appendMessage($, world, { door: "prompt", id, text: sessionText });
  rewriteTranscript(world, JSON.stringify(sessionText), JSON.stringify(transcriptText));
}

function largeTranscript(): string[] {
  const filler = Array.from({ length: BIG_ROWS }, (_, at) =>
    jsonlRow({
      type: "assistant",
      uuid: `big-${at}`,
      timestamp: FIRST_PROMPT_AT.toISOString(),
      message: { role: "assistant", content: [{ type: "text", text: "x".repeat(BIG_ROW_CHARS) }] },
    }),
  );
  const half = BIG_ROWS / 2;
  return [
    typedRow("r1", FIRST_PROMPT_AT, "fix the status row"),
    ...filler.slice(0, half),
    typedRow("r2", SECOND_PROMPT_AT, "now the history tab"),
    ...filler.slice(half),
    typedRow("r3", THIRD_PROMPT_AT, "and the last one"),
  ];
}

function typedRow(uuid: string, at: Date, text: string): string {
  return jsonlRow({
    type: "user",
    uuid,
    timestamp: at.toISOString(),
    promptSource: "typed",
    origin: { kind: "human" },
    message: { role: "user", content: text },
  });
}

function historyState(world: HistoryWorld): string {
  return JSON.stringify(world.state.get(HISTORY_STATE_KEY)?.value ?? null);
}

function historyEntries(world: HistoryWorld): object[] {
  return (world.state.get(HISTORY_STATE_KEY)?.value as object[] | undefined) ?? [];
}

async function showHistory(pane: Pane): Promise<void> {
  await showTabThroughArrows(pane, HISTORY_TAB);
}

async function typeFilter(pane: Pane, text: string): Promise<void> {
  await pane.input({ key: "filter", text, kind: "change" });
  await settle(pane);
}

async function promptRows(pane: Pane): Promise<string[]> {
  return shownTexts(await pane.drawn()).filter((text) => /^\d\d:\d\d( |$)/.test(text));
}

async function replyButtons(pane: Pane) {
  const buttons = await pane.findAll({ type: "Button" });
  return buttons.filter((button) => String(button.key).startsWith("reply-button-"));
}
