import { describe, expect, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

import { shownTexts } from "./skills-tree";
import { COLUMNS, openPane } from "./spend-world";
import type { Pane } from "./spend-world";
import {
  TRANSCRIPT,
  appendTranscriptRow,
  historyWorldOf,
  startIndexedSession,
  untilSettled,
} from "./history-transcript";
import type { HistoryWorld } from "./history-transcript";
import { assistantLine } from "./fixtures/transcript-oracle";
import type { TranscriptRunner } from "./fixtures/transcript-disk";

const MINUTE = 60_000;
const START_AT = Date.UTC(2026, 10, 4, 9, 0, 0);
const PROMPT_AT = START_AT + 5 * MINUTE;
const MAX_TAB_PRESSES = 12;
const PROMPT = "run the build in the background";
const CALL = assistantLine({ id: "main-1", at: PROMPT_AT + MINUTE, output: 100_000 });
const PROMPT_ROW = JSON.stringify({
  type: "user",
  uuid: "p1",
  timestamp: new Date(PROMPT_AT).toISOString(),
  origin: { kind: "composer" },
  message: { role: "user", content: PROMPT },
});
const FINISHED = { code: 0, signal: null };

type Gate = { isHeld: boolean; release: () => void };
type Ready = { world: HistoryWorld; pane: Pane; startup: Gate };

describe("transcript lease release", () => {
  test("A1 a History cost refresh that ends while the startup index still reads leaves the lease with this session", async ($, on) => {
    const { world, pane } = await sessionWithStartupIndexReading($, on);

    await showHistory(pane);

    expect(world.index.db.leaseHolder(world.clock.now())).toBe(world.session);
  });

  test("A2 once the startup index also ends, a second session can take the lease", async ($, on) => {
    const { world, pane, startup } = await sessionWithStartupIndexReading($, on);
    await showHistory(pane);

    startup.release();
    await untilSettled(pane);

    expect(world.index.db.leaseHolder(world.clock.now())).toBeUndefined();
  });

  test("A3 a History cost refresh that runs alone frees the lease when it ends", async ($, on) => {
    const world = await worldWithEarlierPrompt(on);
    const pane = await openPane($, COLUMNS);
    await startIndexedSession($, world);
    await $.classic.SessionStart({ source: "resume", transcript_path: TRANSCRIPT } as never);
    await untilSettled(pane);

    await showHistory(pane);

    expect(world.index.db.leaseHolder(world.clock.now())).toBeUndefined();
  });

  async function sessionWithStartupIndexReading($: Engine, on: On): Promise<Ready> {
    const world = await worldWithEarlierPrompt(on);
    const startup = holdFirstTranscriptRead(world);
    const pane = await openPane($, COLUMNS);
    await startIndexedSession($, world);
    await $.classic.SessionStart({ source: "resume", transcript_path: TRANSCRIPT } as never);
    for (let at = 0; at < 300; at++) await Promise.resolve();
    expect(startup.isHeld, "the startup index is still reading").toBe(true);
    return { world, pane, startup };
  }

  async function worldWithEarlierPrompt(on: On): Promise<HistoryWorld> {
    const world = historyWorldOf(on, true);
    await world.clock.set(START_AT);
    world.transcripts.files.set(TRANSCRIPT, "");
    world.transcriptPath = TRANSCRIPT;
    appendTranscriptRow(world, PROMPT_ROW);
    appendTranscriptRow(world, CALL);
    await world.clock.set(PROMPT_AT + 5 * MINUTE);
    return world;
  }

  function holdFirstTranscriptRead(world: HistoryWorld): Gate {
    const gate: Gate = { isHeld: false, release: () => {} };
    const opened = new Promise<void>((resolve) => (gate.release = resolve));
    const run: TranscriptRunner = world.index.disk.run;
    let isFirst = true;
    world.index.disk.run = (request) => {
      if (request.argv[0] !== "sh" || !isFirst) return run(request);
      isFirst = false;
      gate.isHeld = true;
      async function* held() {
        await opened;
        gate.isHeld = false;
        return yield* run(request);
      }
      return Object.assign(held(), { result: Promise.resolve(FINISHED) });
    };
    return gate;
  }

  async function showHistory(pane: Pane): Promise<void> {
    for (let press = 0; press < MAX_TAB_PRESSES; press++) {
      const buttons = await pane.findAll({ type: "Button" });
      const tab = buttons.find((button) => button.props.label === "History");
      const next = buttons.find((button) => button.props.label === "›");
      const target = tab ?? next;
      expect(target, "a History tab button or the › arrow").toBeDefined();
      await pane.press({ key: target?.key ?? "" });
      await untilSettled(pane);
      if (tab !== undefined) break;
    }
    expect(shownTexts(await pane.drawn()).some((text) => text.includes(PROMPT))).toBe(true);
  }
});
