import { describe, expect, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

import { shownTexts } from "./skills-tree";
import { COLUMNS, OPUS, mainTurn, openPane, settle } from "./spend-world";
import type { Pane } from "./spend-world";
import {
  PROJECTS,
  SESSION_DIR,
  TRANSCRIPT,
  appendCallLine,
  appendMessage,
  appendTranscriptRow,
  historyWorldOf,
  jsonlRow,
  startFreshSession,
  startIndexedSession,
  untilSettled,
} from "./history-transcript";
import type { HistoryWorld } from "./history-transcript";
import { assistantLine } from "./fixtures/transcript-oracle";
import { priceOf, transcriptOf } from "./transcript-oracle";

const MAX_TAB_PRESSES = 12;
const TURN = { model: OPUS, tokens: { output: 10 }, context: 1000 };
const MINUTE = 60_000;
const FIRST_PROMPT_AT = Date.UTC(2026, 10, 4, 9, 0, 0);
const COMPACT_AT = FIRST_PROMPT_AT + 5 * MINUTE;
const SECOND_PROMPT_AT = FIRST_PROMPT_AT + 10 * MINUTE;
const EARLIER_PROMPT_AT = FIRST_PROMPT_AT - 60 * MINUTE;
const ABSORBED_AT = FIRST_PROMPT_AT + 2 * MINUTE + 30_000;
const LEASE_HOLD_MS = 60 * MINUTE;
const EARLIER_PROMPT = "an earlier prompt";
const ABSORBED_PROMPT = "also check the footer";
const ABSORBED_FRAME = `<system-reminder>\nThe user sent a new message while you were working:\n${ABSORBED_PROMPT}\n\nThis is how Claude Code surfaces messages the user sends mid-turn - within the running turn, often alongside the next tool result, rather than as a separate conversation turn. Address the message above as you continue this turn.\n</system-reminder>`;
const OTHER_OWNER = "other-session";
const OTHER_TRANSCRIPT = `${PROJECTS}/p/other-session.jsonl`;
const OTHER_USD = 0.25;
const LAST_MONTH_PROMPT_AT = Date.UTC(2026, 9, 5, 0, 0, 0);
const TOTALS_KEY = "paneline.spendTotals.";
const RESUMED_LEDGER_USD = 5;
const FIRST_PROMPT = "run the build in the background";
const SECOND_PROMPT = "fix the status row";

const MAIN_CALL = assistantLine({ id: "main-1", at: FIRST_PROMPT_AT + MINUTE, output: 100_000 });
const AGENT_CALL = assistantLine({
  id: "agent-1",
  at: FIRST_PROMPT_AT + 2 * MINUTE,
  sessionId: "agent-session",
  output: 25_000,
});
const EARLIER_CALL = assistantLine({
  id: "earlier-1",
  at: EARLIER_PROMPT_AT + MINUTE,
  output: 50_000,
});
const WAKE_CALL = assistantLine({ id: "wake-1", at: FIRST_PROMPT_AT + 3 * MINUTE, output: 10_000 });
const COMPACT_CALL = assistantLine({ id: "compact-1", at: COMPACT_AT + MINUTE, output: 20_000 });
const SECOND_MAIN_CALL = assistantLine({
  id: "main-2",
  at: SECOND_PROMPT_AT + MINUTE,
  output: 40_000,
});
const LATE_AGENT_CALL = assistantLine({
  id: "agent-2",
  at: SECOND_PROMPT_AT + 2 * MINUTE,
  sessionId: "agent-session",
  output: 30_000,
});

type Turn = { text: string; id: string; at: number; line: string };
type Agent = { line: string; name: string };
type Ready = { world: HistoryWorld; pane: Pane };

describe("history prompt cost from the transcript index", () => {
  test("C1 a background agent's cost that lands after the turn ended shows on the prompt, once, together with the turn and the wake-up", async ($, on) => {
    const { world, pane } = await readySession($, on);
    await typedTurn($, world, {
      text: FIRST_PROMPT,
      id: "p1",
      at: FIRST_PROMPT_AT,
      line: MAIN_CALL,
    });

    await spendAgent($, world, AGENT);
    await $.turn.start({ text: "", turnId: "turn-wake" });
    await spend($, world, WAKE_CALL);
    await mainTurn($, world, TURN);
    await showHistory(pane);

    const expected = oracleUsd([MAIN_CALL, AGENT_CALL, WAKE_CALL], FIRST_PROMPT_AT);
    expect(await promptRows(pane)).toEqual([promptRow(FIRST_PROMPT, expected)]);
  });

  test("C2 a /compact outside a turn shows what it cost on its own row, once, and the prompt before it keeps its cost", async ($, on) => {
    const { world, pane } = await readySession($, on);
    await typedTurn($, world, {
      text: FIRST_PROMPT,
      id: "p1",
      at: FIRST_PROMPT_AT,
      line: MAIN_CALL,
    });

    await world.clock.set(COMPACT_AT);
    await appendMessage($, world, {
      door: "note",
      origin: { kind: "engine" },
      id: "c1",
      text: "/compact",
    });
    await spend($, world, COMPACT_CALL);
    await showHistory(pane);

    expect(await promptRows(pane)).toEqual([
      promptRow(FIRST_PROMPT, oracleUsd([MAIN_CALL], FIRST_PROMPT_AT, COMPACT_AT)),
      promptRow("/compact", oracleUsd([COMPACT_CALL], COMPACT_AT)),
    ]);
  });

  test("C3 after a resume with $5 already on the session, past prompts show their transcript cost and the first new prompt only its own, agent included", async ($, on) => {
    const world = historyWorldOf(on, true);
    await world.clock.set(EARLIER_PROMPT_AT);
    world.transcripts.files.set(TRANSCRIPT, "");
    world.transcriptPath = TRANSCRIPT;
    appendTranscriptRow(world, earlierPromptRow());
    appendTranscriptRow(world, EARLIER_CALL);
    world.costUsd = RESUMED_LEDGER_USD;
    await world.clock.set(FIRST_PROMPT_AT - 5 * MINUTE);
    const pane = await openPane($, COLUMNS);
    await startIndexedSession($, world);
    await $.classic.SessionStart({ source: "resume", transcript_path: TRANSCRIPT } as never);
    await world.transcripts.readsFinished();
    await world.clock.advance(1000);

    await typedTurn($, world, {
      text: FIRST_PROMPT,
      id: "p1",
      at: FIRST_PROMPT_AT,
      line: MAIN_CALL,
    });
    await spendAgent($, world, AGENT);
    await showHistory(pane);

    expect(await promptRows(pane)).toEqual([
      promptRow(EARLIER_PROMPT, oracleUsd([EARLIER_CALL], EARLIER_PROMPT_AT, FIRST_PROMPT_AT)),
      promptRow(FIRST_PROMPT, oracleUsd([MAIN_CALL, AGENT_CALL], FIRST_PROMPT_AT)),
    ]);
  });

  test("C4 an agent's cost that lands after the second prompt goes to the second prompt and leaves the first unchanged", async ($, on) => {
    const { world, pane } = await readySession($, on);
    await typedTurn($, world, {
      text: FIRST_PROMPT,
      id: "p1",
      at: FIRST_PROMPT_AT,
      line: MAIN_CALL,
    });
    await typedTurn($, world, {
      text: SECOND_PROMPT,
      id: "p2",
      at: SECOND_PROMPT_AT,
      line: SECOND_MAIN_CALL,
    });

    await spendAgent($, world, LATE_AGENT);
    await showHistory(pane);

    expect(await promptRows(pane)).toEqual([
      promptRow(FIRST_PROMPT, oracleUsd([MAIN_CALL], FIRST_PROMPT_AT, SECOND_PROMPT_AT)),
      promptRow(SECOND_PROMPT, oracleUsd([SECOND_MAIN_CALL, LATE_AGENT_CALL], SECOND_PROMPT_AT)),
    ]);
  });

  test("C5 after the plugin reloads in a session already at $5, the next prompt shows only its own cost", async ($, on) => {
    const world = historyWorldOf(on, true);
    on("classic.UserPromptSubmit", () => ({}));
    world.transcripts.files.set(TRANSCRIPT, "");
    world.transcriptPath = TRANSCRIPT;
    world.costUsd = RESUMED_LEDGER_USD;
    await world.clock.set(FIRST_PROMPT_AT - 5 * MINUTE);
    const pane = await openPane($, COLUMNS);
    await $.session.start({ cwd: "/work", surface: "terminal", isInteractive: true });
    await world.clock.set(FIRST_PROMPT_AT);

    await $.classic.UserPromptSubmit({
      transcript_path: TRANSCRIPT,
      prompt: FIRST_PROMPT,
    });
    await typedTurn($, world, {
      text: FIRST_PROMPT,
      id: "p1",
      at: FIRST_PROMPT_AT,
      line: MAIN_CALL,
    });
    await showHistory(pane);

    const expected = oracleUsd([MAIN_CALL], FIRST_PROMPT_AT);
    expect(await promptRows(pane)).toEqual([promptRow(FIRST_PROMPT, expected)]);
  });

  test("C6 while another session holds the index lease the prompt shows a dash, and after the lease is free the next turn shows the transcript cost", async ($, on) => {
    const { world, pane } = await readySession($, on);
    world.index.db.holdLease(OTHER_OWNER, world.clock.now() + LEASE_HOLD_MS);
    await typedTurn($, world, {
      text: FIRST_PROMPT,
      id: "p1",
      at: FIRST_PROMPT_AT,
      line: MAIN_CALL,
    });
    await showHistory(pane);
    const whileHeld = await promptRows(pane);

    world.index.db.holdLease(OTHER_OWNER, 0);
    await mainTurn($, world, TURN);
    await untilSettled(pane);

    const expected = oracleUsd([MAIN_CALL], FIRST_PROMPT_AT);
    expect([whileHeld, await promptRows(pane)]).toEqual([
      [pendingRow(FIRST_PROMPT)],
      [promptRow(FIRST_PROMPT, expected)],
    ]);
  });

  test("C15 when the lease was held at tab entry, the prompt shows a dash, and once the lease is free the next draw of History shows the transcript cost without a turn end", async ($, on) => {
    const { world, pane } = await readySession($, on);
    world.index.db.holdLease(OTHER_OWNER, world.clock.now() + LEASE_HOLD_MS);
    await typedTurn($, world, {
      text: FIRST_PROMPT,
      id: "p1",
      at: FIRST_PROMPT_AT,
      line: MAIN_CALL,
    });
    await showHistory(pane);
    const whileHeld = await promptRows(pane);

    world.index.db.holdLease(OTHER_OWNER, 0);
    await redrawHistory(pane);

    const expected = oracleUsd([MAIN_CALL], FIRST_PROMPT_AT);
    expect([whileHeld, await promptRows(pane)]).toEqual([
      [pendingRow(FIRST_PROMPT)],
      [promptRow(FIRST_PROMPT, expected)],
    ]);
  });

  test("C16 once the lease is free and the cost is shown, drawing History again indexes nothing more", async ($, on) => {
    const { world, pane } = await readySession($, on);
    world.index.db.holdLease(OTHER_OWNER, world.clock.now() + LEASE_HOLD_MS);
    await typedTurn($, world, {
      text: FIRST_PROMPT,
      id: "p1",
      at: FIRST_PROMPT_AT,
      line: MAIN_CALL,
    });
    await showHistory(pane);
    world.index.db.holdLease(OTHER_OWNER, 0);
    await redrawHistory(pane);
    const spawnsWhenShown = world.index.indexSpawns.length;

    await redrawHistory(pane);
    await redrawHistory(pane);

    expect(await promptRows(pane)).toEqual([
      promptRow(FIRST_PROMPT, oracleUsd([MAIN_CALL], FIRST_PROMPT_AT)),
    ]);
    expect(world.index.indexSpawns).toHaveLength(spawnsWhenShown);
  });

  test("C7 without sqlite3 every prompt and the header total show a dash", async ($, on) => {
    const world = historyWorldOf(on, true);
    world.index.sqlite.isMissing = true;
    await world.clock.set(FIRST_PROMPT_AT - 5 * MINUTE);
    const pane = await openPane($, COLUMNS);
    await startIndexedSession($, world);
    await startFreshSession($, world);
    await typedTurn($, world, {
      text: FIRST_PROMPT,
      id: "p1",
      at: FIRST_PROMPT_AT,
      line: MAIN_CALL,
    });
    await typedTurn($, world, {
      text: SECOND_PROMPT,
      id: "p2",
      at: SECOND_PROMPT_AT,
      line: SECOND_MAIN_CALL,
    });

    await showHistory(pane);

    expect([await promptRows(pane), await headerOf(pane)]).toEqual([
      [pendingRow(FIRST_PROMPT), pendingRow(SECOND_PROMPT)],
      "2 prompts · -",
    ]);
  });

  test("C8 a prompt absorbed mid-turn draws no cost and the prompt that opened the turn keeps all of it", async ($, on) => {
    const { world, pane } = await readySession($, on);
    await world.clock.set(FIRST_PROMPT_AT);
    await appendMessage($, world, {
      door: "prompt",
      origin: { kind: "composer" },
      id: "p1",
      text: FIRST_PROMPT,
    });
    await $.turn.start({ text: FIRST_PROMPT, turnId: "turn-p1" });
    await spend($, world, MAIN_CALL);
    await world.clock.set(ABSORBED_AT);
    await appendAbsorbed($, world);
    await spend($, world, WAKE_CALL);
    await mainTurn($, world, TURN);

    await showHistory(pane);

    const expected = oracleUsd([MAIN_CALL, WAKE_CALL], FIRST_PROMPT_AT);
    expect(await promptRows(pane)).toEqual([promptRow(FIRST_PROMPT, expected), ABSORBED_PROMPT]);
  });

  test("C9 entering History indexes only this session's transcript and its agents, not every project", async ($, on) => {
    const { world, pane } = await readySession($, on);
    await typedTurn($, world, {
      text: FIRST_PROMPT,
      id: "p1",
      at: FIRST_PROMPT_AT,
      line: MAIN_CALL,
    });
    await spendAgent($, world, AGENT);
    world.index.indexSpawns.length = 0;

    await showHistory(pane);

    expect(searchedPaths(world)).toEqual([[TRANSCRIPT, `${SESSION_DIR}/subagents`]]);
  });
  test("C10 after a resume into another session, rows show a dash until that session's own figures arrive, never the old session's calls", async ($, on) => {
    const { world, pane } = await readySession($, on);
    await typedTurn($, world, {
      text: FIRST_PROMPT,
      id: "p1",
      at: FIRST_PROMPT_AT,
      line: MAIN_CALL,
    });
    world.index.db.addCall("other-1", {
      at: FIRST_PROMPT_AT + 30_000,
      usd: OTHER_USD,
      dir: "p",
      session: "other-session",
      path: "p/other-session.jsonl",
    });
    world.transcripts.files.set(OTHER_TRANSCRIPT, resumedPromptRow(FIRST_PROMPT_AT));
    world.index.disk.writeLines(
      "p/other-session.jsonl",
      [resumedPromptRow(FIRST_PROMPT_AT)],
      world.clock.now(),
    );
    let release = (): void => {};
    world.index.sqlite.hold = new Promise((resolve) => (release = resolve));

    world.transcriptPath = OTHER_TRANSCRIPT;
    await $.classic.SessionStart({ source: "resume", transcript_path: OTHER_TRANSCRIPT } as never);
    await world.transcripts.readsFinished();
    await showTab(pane, "History");
    const whileHeld = await promptRows(pane);
    release();
    world.index.sqlite.hold = undefined;
    await untilSettled(pane);

    expect([whileHeld, await promptRows(pane)]).toEqual([
      [pendingRow(EARLIER_PROMPT)],
      [promptRow(EARLIER_PROMPT, OTHER_USD)],
    ]);
  });

  test("C11 a prompt from before the start of this month shows a dash while this month's prompt shows its figure", async ($, on) => {
    const world = historyWorldOf(on, true);
    world.transcripts.files.set(TRANSCRIPT, "");
    world.transcriptPath = TRANSCRIPT;
    appendTranscriptRow(world, resumedPromptRow(LAST_MONTH_PROMPT_AT));
    await world.clock.set(FIRST_PROMPT_AT - 5 * MINUTE);
    const pane = await openPane($, COLUMNS);
    await startIndexedSession($, world);
    await $.classic.SessionStart({ source: "resume", transcript_path: TRANSCRIPT } as never);
    await world.transcripts.readsFinished();
    await world.clock.advance(1000);

    await typedTurn($, world, {
      text: FIRST_PROMPT,
      id: "p1",
      at: FIRST_PROMPT_AT,
      line: MAIN_CALL,
    });
    await showHistory(pane);

    expect(await promptRows(pane)).toEqual([
      pendingRow(EARLIER_PROMPT),
      promptRow(FIRST_PROMPT, oracleUsd([MAIN_CALL], FIRST_PROMPT_AT)),
    ]);
  });

  test("C12 when the index run fails on the transcript the prompt shows a dash, and after a good run it shows the figure", async ($, on) => {
    const { world, pane } = await readySession($, on);
    await typedTurn($, world, {
      text: FIRST_PROMPT,
      id: "p1",
      at: FIRST_PROMPT_AT,
      line: MAIN_CALL,
    });
    world.index.disk.failRead("p/session-one.jsonl", 100);
    await spend($, world, WAKE_CALL);
    await showHistory(pane);
    const whileFailing = await promptRows(pane);

    world.index.disk.failRead("p/session-one.jsonl", 0);
    await mainTurn($, world, TURN);
    await untilSettled(pane);

    expect([whileFailing, await promptRows(pane)]).toEqual([
      [pendingRow(FIRST_PROMPT)],
      [promptRow(FIRST_PROMPT, oracleUsd([MAIN_CALL, WAKE_CALL], FIRST_PROMPT_AT))],
    ]);
  });

  test("C13 entering History leaves the Spend tab's progress row and totals untouched", async ($, on) => {
    const { world, pane } = await readySession($, on);
    await typedTurn($, world, {
      text: FIRST_PROMPT,
      id: "p1",
      at: FIRST_PROMPT_AT,
      line: MAIN_CALL,
    });
    await untilSettled(pane);
    await spendAgent($, world, AGENT);
    const before = [world.index.db.progressWrites(), world.state.get(TOTALS_KEY)?.version];

    await showHistory(pane);

    expect([world.index.db.progressWrites(), world.state.get(TOTALS_KEY)?.version]).toEqual(before);
    expect(await promptRows(pane)).toEqual([
      promptRow(FIRST_PROMPT, oracleUsd([MAIN_CALL, AGENT_CALL], FIRST_PROMPT_AT)),
    ]);
  });

  test("C14 a Spend refresh asked while the History refresh runs still writes the Spend totals", async ($, on) => {
    const { world, pane } = await readySession($, on);
    await typedTurn($, world, {
      text: FIRST_PROMPT,
      id: "p1",
      at: FIRST_PROMPT_AT,
      line: MAIN_CALL,
    });
    await untilSettled(pane);
    const before = world.state.get(TOTALS_KEY)?.version ?? 0;
    let release = (): void => {};
    world.index.sqlite.hold = new Promise((resolve) => (release = resolve));

    await showTab(pane, "History");
    await showTab(pane, "Spend");
    release();
    world.index.sqlite.hold = undefined;
    await untilSettled(pane);

    expect(world.state.get(TOTALS_KEY)?.version ?? 0).toBeGreaterThan(before);
  });
});

const AGENT: Agent = { line: AGENT_CALL, name: "agent-1" };
const LATE_AGENT: Agent = { line: LATE_AGENT_CALL, name: "agent-2" };

function oracleUsd(lines: string[], from: number, until = Infinity): number {
  return transcriptOf(lines)
    .calls.filter((call) => call.at >= from && call.at < until)
    .reduce((total, call) => total + priceOf(call).usd, 0);
}

function promptRow(text: string, usd: number): string {
  return `${text} $${usd.toFixed(2)}`;
}

function pendingRow(text: string): string {
  return `${text} -`;
}

function earlierPromptRow(): string {
  return resumedPromptRow(EARLIER_PROMPT_AT);
}

function resumedPromptRow(at: number): string {
  return jsonlRow({
    type: "user",
    uuid: "e1",
    timestamp: new Date(at).toISOString(),
    origin: { kind: "composer" },
    message: { role: "user", content: EARLIER_PROMPT },
  });
}

async function readySession($: Engine, on: On): Promise<Ready> {
  const world = historyWorldOf(on, true);
  await world.clock.set(FIRST_PROMPT_AT - 5 * MINUTE);
  const pane = await openPane($, COLUMNS);
  await startIndexedSession($, world);
  await startFreshSession($, world);
  return { world, pane };
}

async function spend($: Engine, world: HistoryWorld, line: string): Promise<void> {
  appendCallLine(world, line);
  await arrive(world, line);
}

async function spendAgent($: Engine, world: HistoryWorld, agent: Agent): Promise<void> {
  appendCallLine(world, agent.line, agent.name);
  await arrive(world, agent.line);
}

async function arrive(world: HistoryWorld, line: string): Promise<void> {
  const landed = Date.parse((JSON.parse(line) as { timestamp: string }).timestamp) + 1000;
  if (landed > world.clock.now()) await world.clock.set(landed);
}

async function typedTurn($: Engine, world: HistoryWorld, turn: Turn): Promise<void> {
  await world.clock.set(turn.at);
  await appendMessage($, world, {
    door: "prompt",
    origin: { kind: "composer" },
    id: turn.id,
    text: turn.text,
  });
  await $.turn.start({ text: turn.text, turnId: `turn-${turn.id}` });
  await spend($, world, turn.line);
  await mainTurn($, world, TURN);
}

async function appendAbsorbed($: Engine, world: HistoryWorld): Promise<void> {
  await $.session.append({
    message: {
      type: "attachment",
      name: "queued_command",
      role: "user",
      content: [{ type: "text", text: ABSORBED_FRAME }],
    },
    door: "delivery",
    origin: { kind: "composer" },
    uuid: "a1",
  } as never);
  appendTranscriptRow(
    world,
    jsonlRow({
      type: "attachment",
      uuid: "a1",
      timestamp: new Date(world.clock.now()).toISOString(),
      attachment: {
        type: "queued_command",
        prompt: ABSORBED_PROMPT,
        commandMode: "prompt",
        origin: { kind: "human" },
      },
    }),
  );
  await world.clock.advance(1000);
}

function searchedPaths(world: HistoryWorld): string[][] {
  const lists = world.index.indexSpawns
    .filter((argv) => argv[0] === "find")
    .map((argv) => argv.slice(1, argv.indexOf("-name")).sort());
  return [...new Map(lists.map((paths) => [paths.join("\n"), paths])).values()];
}

async function showHistory(pane: Pane): Promise<void> {
  await showTab(pane, "History");
  await untilSettled(pane);
}

async function showTab(pane: Pane, label: string): Promise<void> {
  for (let press = 0; press < MAX_TAB_PRESSES; press++) {
    const buttons = await pane.findAll({ type: "Button" });
    const tab = buttons.find((button) => button.props.label === label);
    const next = buttons.find((button) => String(button.props.label).includes("›"));
    const target = tab ?? next;
    expect(target, "a History tab button or the › arrow").toBeDefined();
    await pane.press({ key: target?.key ?? "" });
    await settle(pane);
    if (tab !== undefined) break;
  }
}

async function promptRows(pane: Pane): Promise<string[]> {
  const rows = shownTexts(await pane.drawn()).filter((text) => /^\d\d:\d\d /.test(text));
  return rows.map((row) => row.replace(/^\d\d:\d\d /, "").replace(/ \d+s( [$-]|$)/, "$1"));
}

async function redrawHistory(pane: Pane): Promise<void> {
  const row = (await pane.findAll({ type: "Button" })).find((button) =>
    String(button.props.label).includes(FIRST_PROMPT),
  );
  expect(row, "a prompt row button").toBeDefined();
  await pane.press({ key: String(row?.key) });
  await untilSettled(pane);
}

async function headerOf(pane: Pane): Promise<string | undefined> {
  return shownTexts(await pane.drawn()).find((text) => /^\d+ prompts?/.test(text));
}
