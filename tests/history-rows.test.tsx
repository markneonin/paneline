import { describe, expect, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

import { shownTexts } from "./skills-tree";
import { COLUMNS, OPUS, mainTurn, openPane, settle } from "./spend-world";
import type { Pane } from "./spend-world";
import {
  appendMessage,
  appendTranscriptRow,
  historyWorldOf,
  jsonlRow,
  startFreshSession,
} from "./history-transcript";
import type { HistoryWorld } from "./history-transcript";

const MAX_TAB_PRESSES = 12;
const TURN = { model: OPUS, tokens: { output: 10 }, context: 1000 };
const TYPED_PROMPT = "run the build in the background";
const LATER_PROMPT = "fix the status row";
const NOTIFICATION = "<task-notification>\n<task-id>bg-1</task-id></task-notification>";
const CLAUDE_API_ARGS = "Run this exact bash command: echo ok";
const COMPACT_ARGS = "keep the API notes";
const CONTEXT_REPORT = "## Context Usage\n**Model:** claude-haiku-5-5 **Tokens:** 24.1k / 240k";
const MID_TURN_PROMPT = "Run this Bash command: touch denyme.txt";
const MID_TURN_FRAME = `<system-reminder>\nThe user sent a new message while you were working:\n${MID_TURN_PROMPT}\n\nThis is how Claude Code surfaces messages the user sends mid-turn - within the running turn, often alongside the next tool result, rather than as a separate conversation turn. Address the message above as you continue this turn.\n</system-reminder>`;
const QUEUED_NOTICE = "[SYSTEM NOTIFICATION - NOT USER INPUT] Background task bg-1 finished.";
const POLL_TEXT = "New events since the last poll: 3";

type Row = {
  door: "prompt" | "command" | "note";
  origin: object;
  id: string;
  text: string;
};

type DeliveryRow = {
  id: string;
  name: string;
  origin: object;
  text: string;
  prompt?: string;
};

describe("history rows for wake-ups and commands", () => {
  test("A1 a background task wake-up adds no History row", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await setSessionCost($, world, 0);
    await typedTurn($, world, TYPED_PROMPT, "p1", 1.08);
    await appendRow($, world, {
      door: "prompt",
      origin: { kind: "task-notification" },
      id: "n1",
      text: NOTIFICATION,
    });
    await $.turn.start({ text: "", turnId: "turn-wake" });
    await setSessionCost($, world, 1.1);
    await mainTurn($, world, TURN);
    await showHistory(pane);

    expect(await promptRows(pane)).toEqual([
      expect.stringMatching(/^\d\d:\d\d run the build in the background/),
    ]);
  });

  test("A2 a wake-up turn adds its cost to the prompt row, and the next prompt shows only its own cost", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await setSessionCost($, world, 0);
    await typedTurn($, world, TYPED_PROMPT, "p1", 1.08);
    await $.turn.start({ text: "", turnId: "turn-wake" });
    await setSessionCost($, world, 1.1);
    await mainTurn($, world, TURN);
    await showHistory(pane);

    expect(await promptRows(pane)).toEqual([
      expect.stringMatching(/^\d\d:\d\d run the build in the background.* \$1\.10$/),
    ]);

    await typedTurn($, world, LATER_PROMPT, "p2", 1.4);
    await settle(pane);

    expect(await promptRows(pane)).toEqual([
      expect.stringMatching(/^\d\d:\d\d run the build in the background.* \$1\.10$/),
      expect.stringMatching(/^\d\d:\d\d fix the status row.* \$0\.30$/),
    ]);
  });

  test("A3 a typed slash command with text shows as its name and arguments", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await setSessionCost($, world, 0);
    await appendRow($, world, {
      door: "command",
      origin: { kind: "composer" },
      id: "c1",
      text: commandXml("claude-api", CLAUDE_API_ARGS),
    });
    await showHistory(pane);

    expect(await promptRows(pane)).toEqual([
      expect.stringMatching(/^\d\d:\d\d \/claude-api Run this exact bash command: echo ok/),
    ]);
  });

  test("A4 a typed slash command with no text shows as its name alone", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await setSessionCost($, world, 0);
    await appendRow($, world, {
      door: "note",
      origin: { kind: "engine" },
      id: "c1",
      text: "/compact",
    });
    await showHistory(pane);

    expect(await promptRows(pane)).toEqual([expect.stringMatching(/^\d\d:\d\d \/compact$/)]);
  });

  test("A5 a word from a slash command's text keeps that command's row in the History filter", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await setSessionCost($, world, 0);
    await appendRow($, world, {
      door: "prompt",
      origin: { kind: "composer" },
      id: "p1",
      text: LATER_PROMPT,
    });
    await appendRow($, world, {
      door: "command",
      origin: { kind: "composer" },
      id: "c1",
      text: commandXml("claude-api", CLAUDE_API_ARGS),
    });
    await showHistory(pane);
    await typeFilter(pane, "exact");

    expect(await promptRows(pane)).toEqual([
      expect.stringMatching(/\/claude-api Run this exact bash command: echo ok/),
    ]);
  });

  test("A6 a typed slash command with words after its name shows the name and those words", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await setSessionCost($, world, 0);
    await appendRow($, world, {
      door: "note",
      origin: { kind: "engine" },
      id: "c1",
      text: `/compact ${COMPACT_ARGS}`,
    });
    await showHistory(pane);

    expect(await promptRows(pane)).toEqual([
      expect.stringMatching(/^\d\d:\d\d \/compact keep the API notes/),
    ]);
  });

  test("A7 the usage report that /context prints adds no History row", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await setSessionCost($, world, 0);
    await appendRow($, world, {
      door: "prompt",
      origin: { kind: "composer" },
      id: "p1",
      text: LATER_PROMPT,
    });
    await appendRow($, world, {
      door: "note",
      origin: { kind: "engine" },
      id: "n1",
      text: CONTEXT_REPORT,
    });
    await showHistory(pane);

    expect(await promptRows(pane)).toEqual([
      expect.stringMatching(/^\d\d:\d\d fix the status row/),
    ]);
  });

  test("A8 a typed /context shows one History row, and the report it prints adds none", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await setSessionCost($, world, 0);
    await appendRow($, world, {
      door: "command",
      origin: { kind: "engine" },
      id: "c1",
      text: localCommandXml("context"),
    });
    await appendRow($, world, {
      door: "command",
      origin: { kind: "engine" },
      id: "c2",
      text: `<local-command-stdout>${CONTEXT_REPORT}</local-command-stdout>`,
    });
    await appendRow($, world, {
      door: "note",
      origin: { kind: "engine" },
      id: "n1",
      text: CONTEXT_REPORT,
    });
    await showHistory(pane);

    expect(await promptRows(pane)).toEqual([expect.stringMatching(/^\d\d:\d\d \/context$/)]);
  });

  test("A9 a /compact the app reports as a message and as a command line shows one History row", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await setSessionCost($, world, 0);
    await appendRow($, world, {
      door: "note",
      origin: { kind: "engine" },
      id: "c1",
      text: "/compact",
    });
    await appendRow($, world, {
      door: "command",
      origin: { kind: "unclassified" },
      id: "c2",
      text: localCommandXml("compact"),
    });
    await showHistory(pane);

    expect(await promptRows(pane)).toEqual([expect.stringMatching(/^\d\d:\d\d \/compact$/)]);
  });

  test("A10 a typed /color the transcript keeps only as a local-command line shows its name and argument, and its output line adds no row", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await setSessionCost($, world, 0);
    await $.session.append({
      message: {
        type: "user",
        content: [
          {
            type: "text",
            text: `<command-name>/color</command-name>\n<command-args>red</command-args>`,
          },
        ],
      },
      door: "command",
      origin: { kind: "engine" },
      uuid: "c1",
    } as never);
    appendLocalCommandLine(
      world,
      "c1",
      `<command-name>/color</command-name>\n<command-args>red</command-args>`,
    );
    appendLocalCommandLine(
      world,
      "c2",
      "<local-command-stdout>Session color set to: red</local-command-stdout>",
    );
    await showHistory(pane);

    expect(await promptRows(pane)).toEqual([expect.stringMatching(/^\d\d:\d\d \/color red$/)]);
    expect(shownTexts(await pane.drawn()).join("\n")).toContain("1 prompt");
  });

  test("T1 a prompt typed during a background wake-up turn shows in History before the next typed prompt, and the wake-up stays hidden", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await appendRow($, world, {
      door: "prompt",
      origin: { kind: "task-notification" },
      id: "n1",
      text: NOTIFICATION,
    });
    await $.turn.start({ text: "", turnId: "turn-wake" });
    await appendDelivery($, world, {
      id: "a1",
      name: "queued_command",
      origin: { kind: "composer" },
      text: MID_TURN_FRAME,
      prompt: MID_TURN_PROMPT,
    });
    await setSessionCost($, world, 1.1);
    await mainTurn($, world, TURN);
    await typedTurn($, world, LATER_PROMPT, "p2", 1.4);
    await showHistory(pane);

    expect(await promptRows(pane)).toEqual([
      expect.stringMatching(/^\d\d:\d\d Run this Bash command: touch denyme\.txt(?: -)?$/),
      expect.stringMatching(/^\d\d:\d\d fix the status row(?: -|(?: \d+s)? \$\d+\.\d\d)?$/),
    ]);
  });

  test("T3 a queued task notice and a poll event delivered mid-turn add no History row", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await appendRow($, world, {
      door: "prompt",
      origin: { kind: "composer" },
      id: "p1",
      text: LATER_PROMPT,
    });
    await appendDelivery($, world, {
      id: "q1",
      name: "queued_command",
      origin: { kind: "task-notification" },
      text: QUEUED_NOTICE,
    });
    await appendDelivery($, world, {
      id: "e1",
      name: "poll_events",
      origin: { kind: "engine" },
      text: POLL_TEXT,
    });
    await showHistory(pane);

    expect(await promptRows(pane)).toEqual([
      expect.stringMatching(/^\d\d:\d\d fix the status row(?: -)?$/),
    ]);
  });

  test("T6 a prompt absorbed mid-turn shows no turn cost, and the prompt that opened the turn keeps it", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await appendRow($, world, {
      door: "prompt",
      origin: { kind: "composer" },
      id: "p1",
      text: TYPED_PROMPT,
    });
    await $.turn.start({ text: TYPED_PROMPT, turnId: "turn-p1" });
    await appendDelivery($, world, {
      id: "a1",
      name: "queued_command",
      origin: { kind: "composer" },
      text: MID_TURN_FRAME,
      prompt: MID_TURN_PROMPT,
    });
    await setSessionCost($, world, 1.08);
    await mainTurn($, world, TURN);
    await showHistory(pane);

    expect(await promptRows(pane)).toEqual([
      expect.stringMatching(/^\d\d:\d\d run the build in the background.* \$1\.08$/),
      expect.stringMatching(/^\d\d:\d\d Run this Bash command: touch denyme\.txt(?: -)?$/),
    ]);
  });
});

async function setSessionCost(_$: Engine, world: HistoryWorld, total: number): Promise<void> {
  const booked = world.costUsd ?? 0;
  world.costUsd = total;
  if (total <= booked) return;
  world.index.db.addCall(`call-${total}`, {
    at: world.clock.now(),
    usd: total - booked,
    dir: "p",
    session: "session-one",
    path: "p/session-one.jsonl",
  });
}

function historyWorld(on: On): HistoryWorld {
  return historyWorldOf(on, true);
}

async function typedTurn(
  $: Engine,
  world: HistoryWorld,
  text: string,
  id: string,
  costAfter: number,
): Promise<void> {
  await appendRow($, world, { door: "prompt", origin: { kind: "composer" }, id, text });
  await $.turn.start({ text, turnId: `turn-${id}` });
  await setSessionCost($, world, costAfter);
  await mainTurn($, world, TURN);
}

async function appendRow($: Engine, world: HistoryWorld, row: Row): Promise<void> {
  await appendMessage($, world, row);
}

async function appendDelivery($: Engine, world: HistoryWorld, row: DeliveryRow): Promise<void> {
  await $.session.append({
    message: {
      type: "attachment",
      name: row.name,
      role: "user",
      content: [{ type: "text", text: row.text }],
    },
    door: "delivery",
    origin: row.origin,
    uuid: row.id,
  } as never);
  if (row.prompt !== undefined)
    appendTranscriptRow(
      world,
      jsonlRow({
        type: "attachment",
        uuid: row.id,
        timestamp: new Date(world.clock.now()).toISOString(),
        attachment: {
          type: "queued_command",
          prompt: row.prompt,
          commandMode: "prompt",
          origin: { kind: "human" },
        },
      }),
    );
  await world.clock.advance(1000);
}

function appendLocalCommandLine(world: HistoryWorld, id: string, content: string): void {
  appendTranscriptRow(
    world,
    jsonlRow({
      type: "system",
      subtype: "local_command",
      uuid: id,
      timestamp: new Date(world.clock.now()).toISOString(),
      content,
    }),
  );
}

function commandXml(name: string, args: string): string {
  return `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>\n<command-args>${args}</command-args>`;
}

function localCommandXml(name: string): string {
  return `<command-name>/${name}</command-name> <command-message>${name}</command-message>`;
}

async function showHistory(pane: Pane): Promise<void> {
  for (let press = 0; press < MAX_TAB_PRESSES; press++) {
    const buttons = await pane.findAll({ type: "Button" });
    const tab = buttons.find((button) => button.props.label === "History");
    const next = buttons.find((button) => String(button.props.label).includes("›"));
    const target = tab ?? next;
    expect(target, "a History tab button or the › arrow").toBeDefined();
    await pane.press({ key: target?.key ?? "" });
    await settle(pane);
    if (tab !== undefined) return;
  }
}

async function typeFilter(pane: Pane, text: string): Promise<void> {
  await pane.input({ key: "filter", text, kind: "change" });
  await settle(pane);
}

async function promptRows(pane: Pane): Promise<string[]> {
  return shownTexts(await pane.drawn()).filter((text) => /^\d\d:\d\d /.test(text));
}
