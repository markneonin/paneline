import { describe, expect, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

import { clockOf } from "../hooks/format";
import { historyTab } from "../hooks/history-draw";
import { paneInk } from "../hooks/pane-ink";
import { paneHeaderLook } from "../hooks/pane-kit";
import type { HistoryEntry } from "../types";
import { linesOf, shownTexts } from "./skills-tree";
import { COLUMNS, clearSession, compact, mainTurn, openPane, OPUS, settle } from "./spend-world";
import type { Pane } from "./spend-world";
import {
  TRANSCRIPT,
  appendMessage,
  appendTranscriptRow,
  historyWorldOf,
  jsonlRow,
  startFreshSession,
  startIndexedSession,
  untilSettled,
} from "./history-transcript";
import type { HistoryWorld, Output, Spawn } from "./history-transcript";
import { ENGINE_READ_LIMIT, paddedTo } from "./transcript-world";

const OTHER_TRANSCRIPT = "/h/u/.claude/projects/p/session-two.jsonl";
const BIG_BYTES = ENGINE_READ_LIMIT + 1024 * 1024;
const READING = "reading transcript…";
const UNREADABLE = "transcript could not be read";
const START_MS = Date.UTC(2026, 9, 6, 14, 2, 0);
const MAX_TAB_PRESSES = 12;
const PAST_CAP = 50;
const FIRST_PROMPT_AT = new Date(2026, 9, 27, 7, 3);
const SECOND_PROMPT_AT = new Date(2026, 9, 27, 7, 9);
const THIRD_PROMPT_AT = new Date(2026, 9, 27, 7, 12);
const ABSORBED_AT = new Date(2026, 9, 27, 7, 6);
const MID_TURN_PROMPT = "Run this Bash command: touch denyme.txt";
const TASK_NOTICE = "<task-notification>build done</task-notification>";
const LONG_LINE_BEFORE_ZEBRA =
  "the quick brown fox jumps over the lazy dog and keeps running through the long grass until the zebra";
const CAP_NOTE = "first 50 matches shown";
const COMPOSER: Origin = { kind: "composer" };
const TASK_REPORT: Origin = { kind: "task-notification" };
const SYSTEM_ORIGINS: { label: string; origin: Origin }[] = [
  { label: "task-notification", origin: TASK_REPORT },
  { label: "scheduled-trigger", origin: { kind: "scheduled-trigger" } },
  { label: "peer", origin: { kind: "peer" } },
  { label: "peer-send-message", origin: { kind: "peer-send-message" } },
  { label: "projects-relay", origin: { kind: "projects-relay" } },
  { label: "channel", origin: { kind: "channel" } },
  { label: "coordinator", origin: { kind: "coordinator" } },
  { label: "observer", origin: { kind: "observer" } },
  { label: "observer-activity", origin: { kind: "observer-activity" } },
  { label: "auto-continuation", origin: { kind: "auto-continuation" } },
  { label: "unclassified", origin: { kind: "unclassified" } },
  { label: "plugin", origin: { kind: "plugin", name: "other-plugin" } },
];
const USER_ORIGINS: { label: string; origin: Origin }[] = [
  { label: "terminal", origin: COMPOSER },
  { label: "bridge", origin: { kind: "bridge" } },
  { label: "sdk", origin: { kind: "sdk" } },
  { label: "Slack ping", origin: { kind: "slack-ping" } },
  { label: "plugin asUser", origin: { kind: "plugin", name: "other-plugin", asUser: true } },
];
const SYSTEM_WRAPPERS = [
  "<task-notification>",
  "<local-command-stdout>",
  "<local-command-stderr>",
  "<local-command-caveat>",
];

const PROJECT_CELL = /^(demo-app|other)\s*$/;
const OTHER_PROJECT = { cwd: "/work/other", gitBranch: "dev" };
const OTHER_BRANCH = { gitBranch: "dev" };
const SHELL_ROWS = [
  { tag: "bash-input", text: "<bash-input>spinner ls</bash-input>" },
  { tag: "bash-stdout", text: "<bash-stdout>spinner out</bash-stdout><bash-stderr></bash-stderr>" },
  { tag: "bash-stderr", text: "<bash-stderr>spinner err</bash-stderr>" },
];
const INTERRUPT_MARKERS = [
  "[Request interrupted by user]",
  "[Request interrupted by user for tool use]",
];
const CLEAR_HINT = "clear";
const NO_HINT = "";
const OTHER_PROJECT_SAME_BRANCH = { cwd: "/work/other", gitBranch: "main" };

describe("history tab", () => {
  test("H1 two prompts with finished turns show one row each with time, first line and cost", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await askAndAnswer($, world, "fix the status row", "p1", 0.42);
    await askAndAnswer($, world, "now the history tab", "p2", 1.08);
    await showHistory(pane);

    const rows = await promptRows(pane);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/^\d\d:\d\d fix the status row.* \$0\.42$/);
    expect(rows[1]).toMatch(/^\d\d:\d\d now the history tab.* \$1\.08$/);
    expect(rows[0]?.startsWith(clockOf(START_MS))).toBe(true);
  });

  test("H2 a prompt whose turn has not ended shows no cost", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await appendEntry($, world, { door: "prompt", id: "p1", text: "still working" });
    await showHistory(pane);

    expect(await promptRows(pane)).toEqual([expect.stringMatching(/still working$/)]);
  });

  test("H3 a multi-line prompt shows only its first line", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await askAndAnswer($, world, "first line\nsecond line\nthird", "p1", 0.1);
    await showHistory(pane);

    const rows = await promptRows(pane);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("first line");
    expect(rows.join("")).not.toContain("second line");
  });

  test("H4 an empty list shows the empty state", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    expect(await bodyTexts(pane)).toContain("no prompts yet");
  });

  test("H5 typing a word keeps only the prompt rows that contain it", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await askAndAnswer($, world, "fix the status row", "p1", 0.42);
    await askAndAnswer($, world, "now the History tab", "p2", 1.08);
    await showHistory(pane);

    await typeFilter(pane, "history");

    const rows = await promptRows(pane);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("now the History tab");
  });

  test("H6 a word found only in a reply shows one muted reply row drawn unlike a prompt row", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await askAndAnswer(
      $,
      world,
      "fix the status row",
      "p1",
      0.42,
      "I changed the\nspinner glyph here",
    );
    await showHistory(pane);

    await typeFilter(pane, "spinner");

    expect(await promptRows(pane)).toEqual([]);
    const replies = await replyButtons(pane);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.props.label).toMatch(/^↳ \d\d:\d\d {2}spinner glyph here/);
    expect(replies[0]?.props.dimColor).toBe(true);
    const prompt = (await pane.findAll({ type: "Button" })).find((button) =>
      String(button.key).startsWith("prompt-button-"),
    );
    expect(prompt).toBeUndefined();
  });

  test("H7 a prompt row button is not dimmed, a reply row button is", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await askAndAnswer($, world, "match me", "p1", 0.42, "match me too");
    await showHistory(pane);
    await typeFilter(pane, "match");

    const buttons = await pane.findAll({ type: "Button" });
    const prompt = buttons.find((button) => String(button.key).startsWith("prompt-button-"));
    const reply = buttons.find((button) => String(button.key).startsWith("reply-button-"));

    expect(prompt?.props.dimColor).toBe(false);
    expect(reply?.props.dimColor).toBe(true);
  });

  test("H8 nothing matches shows no matches", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await askAndAnswer($, world, "fix the status row", "p1", 0.42);
    await showHistory(pane);

    await typeFilter(pane, "zebra");

    expect(await bodyTexts(pane)).toContain("no matches");
  });

  test("H9 pressing a prompt row asks the chat to scroll to that message id", async ($, on) => {
    const jumps = drawFixture(on, [promptEntry("p1", "first"), promptEntry("p2", "second")]);
    const pane = await mountFixture($);

    await pane.press({ key: "prompt-button-p2", plugin: "test" });

    expect(jumps).toEqual(["p2"]);
  });

  test("H10 pressing a reply row asks the chat to scroll to the reply id", async ($, on) => {
    const jumps = drawFixture(
      on,
      [promptEntry("p1", "first"), replyEntry("r1", "spinner")],
      "spin",
    );
    const pane = await mountFixture($);

    await pane.press({ key: "reply-button-r1", plugin: "test" });

    expect(jumps).toEqual(["r1"]);
  });

  test("H12 a compaction keeps earlier prompts listed", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await askAndAnswer($, world, "before the compaction", "p1", 0.42);
    await compact($, world);
    await askAndAnswer($, world, "after the compaction", "p2", 0.5);
    await showHistory(pane);

    const rows = await promptRows(pane);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("before the compaction");
  });

  test("H13 clear empties the list", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await askAndAnswer($, world, "fix the status row", "p1", 0.42);
    await showHistory(pane);
    await clearSession($, world);
    await settle(pane);

    expect(await promptRows(pane)).toEqual([]);
    expect(await bodyTexts(pane)).toContain("no prompts yet");
  });

  test("H14 a subagent prompt is not listed", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await appendEntry($, world, {
      door: "prompt",
      id: "a1",
      text: "agent task",
      agentId: "agent-1",
    });
    await showHistory(pane);

    expect(await promptRows(pane)).toEqual([]);
  });

  test("H15 a long first line is clipped to the pane width", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, 60);
    await startFreshSession($, world);
    await askAndAnswer($, world, "x".repeat(200), "p1", 0.42);
    await showHistory(pane);

    const rows = await promptRows(pane);

    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toContain("x".repeat(60));
    expect(rows[0]).toMatch(/ \$0\.42$/);
  });

  test("H16 Enter on the filter clears it, every prompt is listed again, and no Enter hint is drawn beside the empty box", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await askAndAnswer($, world, "fix the status row", "p1", 0.42);
    await askAndAnswer($, world, "now the history tab", "p2", 1.08);
    await showHistory(pane);
    await typeFilter(pane, "history");
    expect(await promptRows(pane)).toHaveLength(1);

    await pane.input({ key: "filter", text: "history", kind: "submit" });
    await settle(pane);

    expect(await promptRows(pane)).toHaveLength(2);
    expect(await filterSubmitLabel(pane)).toBe(NO_HINT);
  });

  test("H29 with the filter box empty, no Enter hint word is drawn beside it", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await askAndAnswer($, world, "fix the status row", "p1", 0.42);
    await showHistory(pane);

    expect(await filterSubmitLabel(pane)).toBe(NO_HINT);
  });

  test("H30 with text in the filter box, the Enter hint beside it reads clear", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await askAndAnswer($, world, "fix the status row", "p1", 0.42);
    await showHistory(pane);
    await typeFilter(pane, "status");

    expect(await filterSubmitLabel(pane)).toBe(CLEAR_HINT);
  });

  test("H17 a background report between two prompts adds no row", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await askAndAnswer($, world, "fix the status row", "p1", 0.42);
    await turnFrom(
      $,
      world,
      TASK_REPORT,
      "<task-notification>build finished</task-notification>",
      "n1",
      0.3,
      "the build is green",
    );
    await showHistory(pane);

    const rows = await promptRows(pane);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("fix the status row");
  });

  test("H18 a word found only in the answer to a background report shows that answer and no prompt row", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await askAndAnswer($, world, "fix the status row", "p1", 0.42);
    await turnFrom(
      $,
      world,
      TASK_REPORT,
      "<task-notification>build finished</task-notification>",
      "n1",
      0.3,
      "the build is green",
    );
    await showHistory(pane);

    await typeFilter(pane, "green");

    expect(await promptRows(pane)).toEqual([]);
    const replies = await replyButtons(pane);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.props.label).toContain("the build is green");
  });

  for (const { label, origin } of SYSTEM_ORIGINS) {
    test(`H19 a ${label} message adds no History row`, async ($, on) => {
      const world = historyWorld(on);
      const pane = await openPane($, COLUMNS);
      await startFreshSession($, world);
      await appendEntry($, world, { door: "prompt", id: "s1", text: "system text", origin });
      await showHistory(pane);

      expect(await bodyTexts(pane)).toContain("no prompts yet");
    });
  }

  for (const { label, origin } of USER_ORIGINS) {
    test(`H20 a prompt sent from the ${label} is listed`, async ($, on) => {
      const world = historyWorld(on);
      const pane = await openPane($, COLUMNS);
      await startFreshSession($, world);
      await appendEntry($, world, { door: "prompt", id: "u1", text: `sent from ${label}`, origin });
      await showHistory(pane);

      expect(await promptRows(pane)).toEqual([expect.stringContaining(`sent from ${label}`)]);
    });
  }

  test("H21 two prompts around a background report are listed in order, and a filter shows the second answer under the second prompt", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await askAndAnswer($, world, "first question", "p1", 0.42);
    await turnFrom(
      $,
      world,
      TASK_REPORT,
      "<task-notification>job done</task-notification>",
      "n1",
      0.3,
      "job notes",
    );
    await askAndAnswer($, world, "second question", "p2", 1.08, "second answer words", "p2-reply");
    await showHistory(pane);

    const rows = await promptRows(pane);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("first question");
    expect(rows[1]).toContain("second question");

    await typeFilter(pane, "second");

    const texts = await bodyTexts(pane);
    const promptAt = texts.findIndex((text) => text.includes("second question"));
    const replyAt = texts.findIndex((text) => text.includes("second answer words"));
    expect(promptAt).toBeGreaterThan(-1);
    expect(replyAt).toBeGreaterThan(promptAt);
    expect((await replyButtons(pane)).map((button) => String(button.key))).toEqual([
      "reply-button-p2-reply",
    ]);
  });

  test("H22 a prompt matched only on a later line shows that line, so the filter word is on screen", async ($, on) => {
    const world = historyWorld(on);
    spawnWorld(world, {});
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await askAndAnswer(
      $,
      world,
      "second prompt first line\nsecond line mentions STARFRUIT\nthird",
      "p1",
      0.42,
    );
    await showHistory(pane);

    await typeFilter(pane, "starfruit");

    const rows = await promptRows(pane);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/^\d\d:\d\d .*STARFRUIT.* \$0\.42$/);
  });

  test("L1 in a narrow pane a filtered prompt whose match is far along shows its time, an ellipsis, then the match, with its cost kept", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, 60);
    await startFreshSession($, world);
    await askAndAnswer($, world, LONG_LINE_BEFORE_ZEBRA, "p1", 0.42);
    await showHistory(pane);

    await typeFilter(pane, "zebra");

    const rows = await promptRows(pane);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/^\d\d:\d\d …\S* ?.*zebra.* \$0\.42$/);
    expect(rows[0]?.length).toBeLessThanOrEqual(60);
  });

  test("L2 in a narrow pane a filtered reply whose match is far along keeps its mark and shows an ellipsis, then the match", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, 60);
    await startFreshSession($, world);
    await askAndAnswer($, world, "short question", "p1", 0.42, LONG_LINE_BEFORE_ZEBRA, "r1");
    await showHistory(pane);

    await typeFilter(pane, "zebra");

    const replies = (await bodyTexts(pane)).filter((text) => text.startsWith("↳ "));
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatch(/^↳ \d\d:\d\d ….*zebra/);
    expect(replies[0]?.length).toBeLessThanOrEqual(60);
  });

  test("L3 without a filter a long prompt shows its line start", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, 60);
    await startFreshSession($, world);
    await askAndAnswer($, world, LONG_LINE_BEFORE_ZEBRA, "p1", 0.42);
    await showHistory(pane);

    const rows = await promptRows(pane);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/^\d\d:\d\d the quick brown fox/);
  });

  test("L4 a filter whose match is in the first visible cells leaves the line start unchanged", async ($, on) => {
    const world = historyWorld(on);
    const pane = await openPane($, 60);
    await startFreshSession($, world);
    await askAndAnswer($, world, LONG_LINE_BEFORE_ZEBRA, "p1", 0.42);
    await showHistory(pane);

    await typeFilter(pane, "quick");

    const rows = await promptRows(pane);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/^\d\d:\d\d the quick brown fox/);
  });

  test("D1 a prompt row shows its time dim and its first line in the text colour, and pressing the row still jumps to it", async ($, on) => {
    const jumps = drawFixture(on, [promptEntry("p1", "fix the status row")]);
    const pane = await mountFixture($);

    const time = await pane.findAll({
      type: "Text",
      text: new RegExp(`^${clockOf(START_MS)}\\s*$`),
    });
    const prompt = await pane.findAll({ type: "Text", text: /^\s*fix the status row\s*$/ });
    expect(time, "a Text holding only the time").toHaveLength(1);
    expect(prompt, "a Text holding only the prompt").toHaveLength(1);
    expect(time[0]?.props.color).toBe(paneInk().muted);
    expect(prompt[0]?.props.color).toBe(paneInk().text);

    await pane.press({ key: "prompt-button-p1", plugin: "test" });

    expect(jumps).toEqual(["p1"]);
  });

  test("D2 a cost of a cent or more is drawn, in the alert colour as it is far above the others, while a zero cost and a cost under a cent draw nothing", async ($, on) => {
    drawFixture(on, [
      withUsd(promptEntry("p1", "first"), 0.12),
      withUsd(promptEntry("p2", "second"), 0),
      withUsd(promptEntry("p3", "third"), 0.004),
    ]);
    const pane = await mountFixture($);

    const paid = await pane.findAll({ type: "Text", text: /^\s*\$0\.12\s*$/ });
    const free = await pane.findAll({ type: "Text", text: /^\s*\$0\.00\s*$/ });
    const running = await pane.findAll({ type: "Text", text: /^\s*-\s*$/ });
    expect((await promptRows(pane))[0]).toMatch(/ \$0\.12$/);
    expect(paid.length, "the $0.12 cost cell").toBeGreaterThan(0);
    expect(paid.map((one) => one.props.color)).toEqual([paneInk().text, paneInk().alert]);
    expect(free, "no $0.00 cost").toHaveLength(0);
    expect(running, "no dash").toHaveLength(0);
  });

  test("D3 a cost not proven yet is drawn as a dash, the header total becomes a dash, and the alert mean counts only proven costs", async ($, on) => {
    drawFixture(on, [
      withUsd(promptEntry("p1", "first"), 0.4),
      withUsd(promptEntry("p2", "second"), 0.2),
      withUsd(promptEntry("p3", "third"), null),
      withUsd(promptEntry("p4", "fourth"), null),
    ]);
    const pane = await mountFixture($);

    const dashes = await pane.findAll({ type: "Text", text: /^\s*-\s*$/ });
    const big = await pane.findAll({ type: "Text", text: /^\s*\$0\.40\s*$/ });

    expect(dashes).toHaveLength(2);
    expect(big[0]?.props.color).toBe(paneInk().text);
    expect((await bodyTexts(pane)).find((text) => text.startsWith("4 prompts"))).toBe(
      "4 prompts · -",
    );
  });
});

describe("two-row entries", () => {
  test("E1 a prompt shows its clock dim and its text in the text colour, and a prompt with a reply gets a dim row with the first line of the last reply", async ($, on) => {
    const pane = await historyPane($, on, [
      stamped("p1", "fix the status row", NINE),
      reply("r1", "First answer.", NINE),
      reply("r2", "\n\nDone.\nbye", NINE),
      stamped("p2", "no answer yet", TEN),
    ]);

    const time = await pane.findAll({ type: "Text", text: /^09:00\s*$/ });
    const prompt = await pane.findAll({ type: "Text", text: /^\s*fix the status row\s*$/ });
    expect(time[0]?.props.color).toBe(paneInk().muted);
    expect(prompt[0]?.props.color).toBe(paneInk().text);
    const toggles = await replyToggles(pane);
    expect(toggles.map((toggle) => toggle.props.label)).toEqual(["▸ Done."]);
    const foldedLine = await pane.findAll({ type: "Text", text: /^\s*▸ Done\.\s*$/ });
    expect(foldedLine[0]?.props.color).toBe(paneInk().muted);
  });

  test("E2 four tools and 38 seconds show as 4 tools 38s with the number in text and the words dim, one tool shows 1 tool, no tools show nothing", async ($, on) => {
    const pane = await historyPane($, on, [
      { ...stamped("p1", "first", NINE), tools: 4, ms: 38000 },
      { ...stamped("p2", "second", TEN), tools: 1 },
      { ...stamped("p3", "third", ELEVEN), tools: 0 },
    ]);

    const rows = await promptRows(pane);
    expect(rows[0]).toMatch(/^09:00 first\s+4 tools\s+38s$/);
    expect(rows[1]).toMatch(/^10:00 second\s+1 tool$/);
    expect(rows[2]).toMatch(/^11:00 third$/);
    const count = await pane.findAll({ type: "Text", text: /^\s*4\s*$/ });
    const noun = await pane.findAll({ type: "Text", text: /^\s*tools\s*$/ });
    const time = await pane.findAll({ type: "Text", text: /^\s*38s\s*$/ });
    expect(count[0]?.props.color).toBe(paneInk().text);
    expect(noun[0]?.props.color).toBe(paneInk().muted);
    expect(time[0]?.props.color).toBe(paneInk().muted);
  });

  test("E3 two failed calls show ✗ 2 in the failed colour", async ($, on) => {
    const pane = await historyPane($, on, [{ ...stamped("p1", "first", NINE), failed: 2 }]);

    const mark = await pane.findAll({ type: "Text", text: /^\s*✗ 2\s*$/ });

    expect(mark).toHaveLength(1);
    expect(mark[0]?.props.color).toBe(paneInk().failed);
  });

  test("E4 at 60 columns a long prompt with tools and a duration shows the tool count and the duration, and no row wider than the pane", async ($, on) => {
    const pane = await historyPane(
      $,
      on,
      [{ ...stamped("p1", LONG_LINE_BEFORE_ZEBRA, NINE), tools: 4, ms: 38000 }],
      60,
    );

    const texts = await bodyTexts(pane);

    expect(texts.some((text) => text.includes("4 tools"))).toBe(true);
    expect(texts.some((text) => /4 tools\s+38s$/.test(text))).toBe(true);
    expect(Math.max(...texts.map((text) => text.length))).toBeLessThanOrEqual(60);
  });

  test("E8 at 120 columns the duration is shown", async ($, on) => {
    const pane = await historyPane(
      $,
      on,
      [{ ...stamped("p1", "first", NINE), tools: 4, ms: 38000 }],
      120,
    );

    expect((await promptRows(pane))[0]).toMatch(/4 tools\s+38s$/);
  });

  test("E9 a pane whose draw width is 81 shows the duration", async ($, on) => {
    const pane = await historyPane(
      $,
      on,
      [{ ...stamped("p1", "first", NINE), tools: 4, ms: 38000 }],
      81,
    );

    expect((await promptRows(pane))[0]).toMatch(/4 tools\s+38s$/);
  });

  test("E14 a pane whose draw width is 80 shows the tool count and the duration", async ($, on) => {
    const pane = await historyPane(
      $,
      on,
      [{ ...stamped("p1", "first", NINE), tools: 4, ms: 38000 }],
      80,
    );

    expect((await promptRows(pane))[0]).toMatch(/4 tools\s+38s$/);
  });

  test("E5 a resumed prompt with no counts, time or cost has nothing right of its text", async ($, on) => {
    const pane = await historyPane($, on, [stamped("p1", "resumed prompt", NINE)]);

    expect(await promptRows(pane)).toEqual(["09:00 resumed prompt"]);
  });

  test("C1 costs of 0.004, 0 and none draw no cost text on any row", async ($, on) => {
    const pane = await historyPane($, on, [
      { ...stamped("p1", "first", NINE), usd: 0.004 },
      { ...stamped("p2", "second", TEN), usd: 0 },
      stamped("p3", "third", ELEVEN),
    ]);

    const texts = await bodyTexts(pane);

    expect(texts.filter((text) => text.includes("$") || /\s-$/.test(text))).toEqual([]);
    expect(await promptRows(pane)).toEqual(["09:00 first", "10:00 second", "11:00 third"]);
  });

  test("C2a a cost of two cents among four of 0.2 cents is drawn in the alert colour, with no ten-cent floor", async ($, on) => {
    const pane = await historyPane($, on, [
      { ...stamped("p1", "a", NINE), usd: 0.02 },
      ...[0, 1, 2, 3].map((at) => ({ ...stamped(`c${at}`, `cheap ${at}`, TEN), usd: 0.002 })),
    ]);

    const cost = await pane.findAll({ type: "Text", text: /^\s*\$0\.02\s*$/ });

    expect(cost).toHaveLength(1);
    expect(cost[0]?.props.color).toBe(paneInk().alert);
  });

  test("C2b a cost of fifty cents among three of one cent is drawn in the alert colour and the small ones in text", async ($, on) => {
    const pane = await historyPane($, on, [
      { ...stamped("p1", "big", NINE), usd: 0.5 },
      ...[0, 1, 2].map((at) => ({
        ...stamped(`c${at}`, `small ${at}`, TEN + at * 5000),
        usd: 0.01,
      })),
    ]);

    const big = await pane.findAll({ type: "Text", text: /^\s*\$0\.50\s*$/ });
    const small = await pane.findAll({ type: "Text", text: /^\s*\$0\.01\s*$/ });

    expect(big[0]?.props.color).toBe(paneInk().alert);
    expect(small.map((one) => one.props.color)).toEqual([
      paneInk().text,
      paneInk().text,
      paneInk().text,
    ]);
  });

  test("C2d among costs 0.00365, 0.00096, 0.00151, 0.08101 and 0.00071 only the eight cents is drawn, in the alert colour", async ($, on) => {
    const pane = await historyPane(
      $,
      on,
      [0.00365, 0.00096, 0.00151, 0.08101, 0.00071].map((usd, at) => ({
        ...stamped(`p${at}`, `prompt ${at}`, NINE + at * 5000),
        usd,
      })),
    );

    const eight = await pane.findAll({ type: "Text", text: /^\s*\$0\.08\s*$/ });

    expect(eight).toHaveLength(1);
    expect(eight[0]?.props.color).toBe(paneInk().alert);
    const rows = await promptRows(pane);
    expect(rows.filter((row) => row.includes("$"))).toHaveLength(1);
  });

  test("C2c nine cents among nine of 0.1 cent is drawn in the alert colour, with no ten-cent floor", async ($, on) => {
    const pane = await historyPane($, on, [
      { ...stamped("p1", "nine cents", NINE), usd: 0.09 },
      ...Array.from({ length: 9 }, (_, at) => ({
        ...stamped(`c${at}`, `cheap ${at}`, TEN),
        usd: 0.001,
      })),
    ]);

    const cost = await pane.findAll({ type: "Text", text: /^\s*\$0\.09\s*$/ });

    expect(cost).toHaveLength(1);
    expect(cost[0]?.props.color).toBe(paneInk().alert);
  });

  test("E6 three prompts costing 0.004, 0.02 and 0.01 show 3 bold, prompts dim, and $0.03 above the filter", async ($, on) => {
    const pane = await historyPane($, on, [
      { ...stamped("p1", "a", NINE), usd: 0.004 },
      { ...stamped("p2", "b", TEN), usd: 0.02 },
      { ...stamped("p3", "c", ELEVEN), usd: 0.01 },
    ]);

    const count = await pane.findAll({ type: "Text", text: /^\s*3\s*$/ });
    const word = await pane.findAll({ type: "Text", text: /^\s*prompts\s*$/ });
    const total = await pane.findAll({ type: "Text", text: /^\s*\$0\.03\s*$/ });

    expect(count[0]?.props.weight).toBe("semibold");
    expect(count[0]?.props.color).toBe(paneInk().text);
    expect(word[0]?.props.color).toBe(paneInk().muted);
    expect(total[0]?.props.color).toBe(paneInk().text);
    const texts = await historyBody(pane);
    expect(texts[0]).toMatch(/^3 prompts · \$0\.03$/);
    expect(texts.findIndex((text) => text.startsWith("filter"))).toBeGreaterThan(0);
  });

  test("E10 prompts that cost under a cent in total show the count with no dollar part", async ($, on) => {
    const pane = await historyPane($, on, [
      { ...stamped("p1", "a", NINE), usd: 0.004 },
      { ...stamped("p2", "b", TEN), usd: 0.004 },
    ]);

    expect((await historyBody(pane))[0]).toBe("2 prompts");
  });

  test("E11 with no prompts there is no summary row", async ($, on) => {
    const pane = await historyPane($, on, []);

    const texts = await bodyTexts(pane);

    expect(texts.some((text) => /\bprompts?$/.test(text) && text !== "no prompts yet")).toBe(false);
    expect(texts).toContain("no prompts yet");
  });

  test("E12 one prompt says 1 prompt", async ($, on) => {
    const pane = await historyPane($, on, [stamped("p1", "a", NINE)]);

    expect((await historyBody(pane))[0]).toBe("1 prompt");
  });

  test("E13 typing a filter keeps the summary counting all prompts and draws no date row and no reply row", async ($, on) => {
    const pane = await historyPane($, on, [
      stamped("p1", "alpha one", new Date(2026, 9, 28, 9, 0).getTime()),
      reply("r1", "alpha answer", new Date(2026, 9, 28, 9, 0).getTime()),
      stamped("p2", "beta two", new Date(2026, 9, 29, 9, 0).getTime()),
      stamped("p3", "gamma three", new Date(2026, 9, 29, 10, 0).getTime()),
    ]);

    await typeFilter(pane, "alpha one");

    const texts = await historyBody(pane);
    expect(texts[0]).toBe("3 prompts");
    expect(texts.some((text) => /^Oct 2\d\b/.test(text))).toBe(false);
    expect(await replyToggles(pane)).toEqual([]);
  });

  test("E7 prompts at 23:58 on Oct 28 and 00:02 on Oct 29 get a bold heading with a rule before the first prompt of each day, a blank row before every heading except the first", async ($, on) => {
    const pane = await historyPane($, on, [
      stamped("p1", "late one", new Date(2026, 9, 28, 23, 58).getTime()),
      stamped("p2", "early one", new Date(2026, 9, 29, 0, 2).getTime()),
    ]);

    const texts = linesOf(await pane.drawn()).map((line) => line.text);
    const first = texts.findIndex((text) => /^Oct 28\b/.test(text));
    const second = texts.findIndex((text) => /^Oct 29\b/.test(text));
    expect(first).toBeGreaterThan(-1);
    expect(texts[first]).toBe("Oct 28");
    expect(texts[first + 1]).toMatch(/^23:58 late one/);
    expect(texts[second - 1]?.trim()).toBe("");
    expect(texts[second + 1]).toMatch(/^00:02 early one/);
    expect(texts[first - 1]?.trim()).not.toBe("");
    const date = await pane.findAll({ type: "Text", text: /^\s*Oct 28\s*$/ });
    expect(date[0]?.props.color).toBe(paneHeaderLook().color);
    expect(date[0]?.props.weight).toBe("semibold");
  });

  test("E7b prompts that all fall on one day get no date row", async ($, on) => {
    const pane = await historyPane($, on, [stamped("p1", "one", NINE), stamped("p2", "two", TEN)]);

    expect((await bodyTexts(pane)).filter((text) => /^[A-Z][a-z]{2} \d+\b/.test(text))).toEqual([]);
  });

  test("F1 the empty filter box says search this and past sessions", async ($, on) => {
    const pane = await historyPane($, on, [stamped("p1", "a", NINE)]);

    const box = await pane.find({ type: "Input", key: "filter" });

    expect(box?.props.placeholder).toBe("search this and past sessions");
  });

  test("M1 pressing a prompt row draws its text bold and its clock in the text colour, other rows unchanged", async ($, on) => {
    const pane = await historyPane($, on, [
      stamped("p1", "first row", NINE),
      stamped("p2", "second row", TEN),
    ]);

    await pane.press({ key: "prompt-button-p2" });
    await settle(pane);

    const picked = await pane.findAll({ type: "Text", text: /^\s*second row\s*$/ });
    const pickedTime = await pane.findAll({ type: "Text", text: /^10:00\s*$/ });
    const other = await pane.findAll({ type: "Text", text: /^\s*first row\s*$/ });
    const otherTime = await pane.findAll({ type: "Text", text: /^09:00\s*$/ });
    expect(picked[0]?.props.weight).toBe("semibold");
    expect(pickedTime[0]?.props.color).toBe(paneInk().tabText);
    expect(other[0]?.props.weight).not.toBe("semibold");
    expect(otherTime[0]?.props.color).toBe(paneInk().muted);
  });

  test("R1 pressing the reply row opens both replies of the turn under it and pressing again hides them, with the filter still empty", async ($, on) => {
    const pane = await historyPane($, on, [
      stamped("p1", "fix the status row", NINE),
      reply("r1", "First answer.", NINE),
      reply("r2", "Done.", NINE),
      stamped("p2", "no answer yet", TEN),
    ]);

    expect(await replyToggles(pane)).toHaveLength(1);
    await pane.press({ key: String((await replyToggles(pane))[0]?.key) });
    await settle(pane);

    expect((await replyToggles(pane)).map((toggle) => toggle.props.label)).toEqual(["▾ reply"]);
    const open = (await replyButtons(pane)).map((button) => button.props.label);
    expect(open).toEqual(["First answer.", "Done."]);

    await pane.press({ key: String((await replyToggles(pane))[0]?.key) });
    await settle(pane);

    expect((await replyToggles(pane)).map((toggle) => toggle.props.label)).toEqual(["▸ Done."]);
    expect(await replyButtons(pane)).toEqual([]);
    const box = await pane.find({ type: "Input", key: "filter" });
    expect(box?.props.value ?? "").toBe("");
  });

  test("M2 pressing a reply row draws that reply's line bold on the selected fill, and the prompt and the other reply lose their bold", async ($, on) => {
    const pane = await historyPane($, on, [
      stamped("p1", "fix the status row", NINE),
      reply("r1", "First answer.", TEN),
      reply("r2", "Done.", ELEVEN),
    ]);

    await pane.press({ key: "prompt-button-p1" });
    await settle(pane);
    const marked = await pane.findAll({ type: "Text", text: /^\s*fix the status row\s*$/ });
    expect(marked[0]?.props.weight).toBe("semibold");
    await pane.press({ key: String((await replyToggles(pane))[0]?.key) });
    await settle(pane);
    expect(await replyButtons(pane)).toHaveLength(2);
    await pane.press({ key: "reply-button-r2" });
    await settle(pane);

    const picked = await pane.findAll({ type: "Text", text: /^\s*Done\.\s*$/ });
    const prompt = await pane.findAll({ type: "Text", text: /^\s*fix the status row\s*$/ });
    const other = await pane.findAll({ type: "Text", text: /^\s*First answer\.\s*$/ });
    expect(picked, "the pressed reply's line Text").toHaveLength(1);
    expect(picked[0]?.props.weight).toBe("semibold");
    expect(picked[0]?.props.color).toBe(paneInk().tabText);
    expect(prompt[0]?.props.weight).not.toBe("semibold");
    expect(other, "the other reply's line Text").toHaveLength(1);
    expect(other[0]?.props.weight).not.toBe("semibold");
  });

  test("G1 past matches show five rows per project in order of first match, then +2 more, and pressing it shows all seven rows of that project", async ($, on) => {
    const projects = [
      "alpha",
      "beta",
      "alpha",
      "alpha",
      "alpha",
      "alpha",
      "alpha",
      "alpha",
      "beta",
    ];
    const searches = {
      spinner: projects.map((project, at) =>
        jsonLine({
          timestamp: `2026-10-21T10:${String(59 - at).padStart(2, "0")}:00.000Z`,
          cwd: `/work/${project}`,
          type: "user",
          message: { role: "user", content: `spinner m${at + 1}` },
        }),
      ),
    };
    const pane = await historyPane($, on, [], COLUMNS, searches);

    await typeFilter(pane, "spinner");

    expect(await pastLines(pane)).toEqual([
      ...[1, 3, 4, 5, 6].map((at) => expect.stringContaining(`alpha · main spinner m${at}`)),
      "+2 more",
      ...[2, 9].map((at) => expect.stringContaining(`beta · main spinner m${at}`)),
    ]);

    const more = (await pane.findAll({ type: "Button" })).find(
      (button) => button.props.label === "+2 more",
    );
    await pane.press({ key: String(more?.key) });
    await settle(pane);

    expect(await pastLines(pane)).toEqual([
      ...[1, 3, 4, 5, 6, 7, 8].map((at) => expect.stringContaining(`alpha · main spinner m${at}`)),
      ...[2, 9].map((at) => expect.stringContaining(`beta · main spinner m${at}`)),
    ]);
  });
});

const HOUR_MS = 3_600_000;
const CALL_AFTER_PROMPT_MS = 1000;
const NINE = new Date(2026, 9, 29, 9, 0).getTime();
const TEN = new Date(2026, 9, 29, 10, 0).getTime();
const ELEVEN = new Date(2026, 9, 29, 11, 0).getTime();

type Seed = Omit<HistoryEntry, "usd"> & { text: string; usd?: number };

function stamped(id: string, text: string, at: number): Seed {
  return { kind: "prompt", id, at, text };
}

function reply(id: string, text: string, at: number): Seed {
  return { kind: "reply", id, at, text };
}

function transcriptRowOf({ kind, id, at, text }: Seed): string {
  const base = { uuid: id, timestamp: new Date(at).toISOString() };
  if (kind === "reply")
    return jsonlRow({
      type: "assistant",
      ...base,
      message: { role: "assistant", content: [{ type: "text", text }] },
    });
  return jsonlRow({
    type: "user",
    ...base,
    origin: COMPOSER,
    message: { role: "user", content: text },
  });
}

async function historyPane(
  $: Engine,
  on: On,
  seeds: Seed[],
  columns: number = COLUMNS,
  searches: Record<string, Output[]> = {},
): Promise<Pane> {
  const world = historyWorldOf(on, true);
  spawnWorld(world, searches);
  const costedAt = Math.max(...seeds.map((seed) => seed.at)) + HOUR_MS;
  if (costedAt > world.clock.now()) await world.clock.set(costedAt);
  const pane = await openPane($, columns);
  await startIndexedSession($, world);
  await startFreshSession($, world);
  for (const seed of seeds) appendTranscriptRow(world, transcriptRowOf(seed));
  for (const seed of seeds) {
    if (seed.usd === undefined) continue;
    world.index.db.addCall(`call-${seed.id}`, {
      at: seed.at + CALL_AFTER_PROMPT_MS,
      usd: seed.usd,
      dir: "p",
      session: "session-one",
      path: "p/session-one.jsonl",
    });
  }
  const entries = seeds.map(({ text: _text, usd: _usd, ...entry }) => entry);
  world.state.set("paneline.history.", { value: entries, version: 1 });
  await showHistory(pane);
  await untilSettled(pane);
  return pane;
}

async function replyToggles(pane: Pane) {
  return (await pane.findAll({ type: "Button" })).filter((button) =>
    String(button.key).startsWith("toggle-button-"),
  );
}

async function showAllPast(pane: Pane): Promise<void> {
  for (;;) {
    const more = (await pane.findAll({ type: "Button" })).find((button) =>
      /^\+\d+ more$/.test(String(button.props.label)),
    );
    if (more === undefined) return;
    await pane.press({ key: String(more.key) });
    await settle(pane);
  }
}

async function historyBody(pane: Pane): Promise<string[]> {
  const texts = await bodyTexts(pane);
  return texts.slice(texts.findIndex((text) => text.startsWith("Activity ")) + 1);
}

async function pastLines(pane: Pane): Promise<string[]> {
  const texts = await bodyTexts(pane);
  return texts.slice(texts.findIndex((text) => text.startsWith("past sessions")) + 1);
}

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

const FIXTURE_ID = "history-draw";

type FixtureRow = { entry: HistoryEntry; text: string; usd?: number | null };

function promptEntry(id: string, text: string): FixtureRow {
  return { entry: { kind: "prompt", id, at: START_MS }, text };
}

function withUsd(row: FixtureRow, usd: number | null): FixtureRow {
  return { ...row, usd };
}

function replyEntry(id: string, text: string): FixtureRow {
  return { entry: { kind: "reply", id, at: START_MS }, text };
}

function costsOf(rows: FixtureRow[]): { costs: Map<string, number | null> } {
  const costs = new Map<string, number | null>();
  for (const row of rows) if (row.usd !== undefined) costs.set(row.entry.id, row.usd);
  return { costs };
}

function drawFixture(on: On, rows: FixtureRow[], filter = ""): string[] {
  const jumps: string[] = [];
  on("ui.render", { component: "Pane", requestId: FIXTURE_ID }, ($, e) =>
    historyTab($.ui.resolve(e), {
      width: COLUMNS,
      entries: rows.map((row) => row.entry),
      texts: new Map(rows.map((row) => [row.entry.id, row.text])),
      ...costsOf(rows),
      filter,
      past: null,
      cwd: "",
      selectPast: () => {},
      resume: () => {},
      copy: () => {},
      setFilter: () => {},
      focusFilter: () => {},
      jump: (id: string) => jumps.push(id),
      selected: "",
      openReplies: [],
      openProjects: [],
      toggleReplies: () => {},
      openProject: () => {},
    }),
  );
  return jumps;
}

function mountFixture($: Engine): Promise<Pane> {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: FIXTURE_ID,
    props: {
      title: "History",
      isFocused: false,
      bodyColumns: COLUMNS,
      placement: "dock",
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
    viewport: { columns: COLUMNS, rows: 40 },
  });
}

async function askAndAnswer(
  $: Engine,
  world: HistoryWorld,
  text: string,
  id: string,
  usd: number,
  reply?: string,
  replyId?: string,
): Promise<void> {
  await turnFrom($, world, COMPOSER, text, id, usd, reply, replyId);
}

async function turnFrom(
  $: Engine,
  world: HistoryWorld,
  origin: Origin,
  text: string,
  id: string,
  usd: number,
  reply?: string,
  replyId?: string,
): Promise<void> {
  const before = world.costUsd ?? 0;
  await setSessionCost($, world, before);
  await appendEntry($, world, { door: "prompt", id, text, origin });
  await $.turn.start({ text, turnId: `turn-${id}` });
  if (reply !== undefined) {
    await appendEntry($, world, { door: "response", id: replyId ?? `${id}-reply`, text: reply });
  }
  await setSessionCost($, world, before + usd);
  await mainTurn($, world, { model: OPUS, tokens: { output: 10 }, context: 1000 });
}

type Origin = { kind: string; [key: string]: unknown };
type Appended = {
  door: "prompt" | "response";
  id: string;
  text: string;
  agentId?: string;
  origin?: Origin;
};

async function appendEntry($: Engine, world: HistoryWorld, entry: Appended): Promise<void> {
  await appendMessage($, world, entry);
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

async function filterSubmitLabel(pane: Pane): Promise<unknown> {
  const box = await pane.find({ type: "Input", key: "filter" });
  return box?.props.submitLabel;
}
async function bodyTexts(pane: Pane): Promise<string[]> {
  return shownTexts(await pane.drawn());
}

async function promptRows(pane: Pane): Promise<string[]> {
  const keys = (await pane.findAll({ type: "Button" }))
    .map((button) => String(button.key))
    .filter((key) => key.startsWith("prompt-button-"));
  const rows = (await bodyTexts(pane)).filter((text) => /^\d\d:\d\d /.test(text));
  return rows.slice(0, keys.length);
}

function replyButtons(pane: Pane) {
  return pane
    .findAll({ type: "Button" })
    .then((buttons) => buttons.filter((button) => String(button.key).startsWith("reply-button-")));
}

async function projectColours(pane: Pane): Promise<unknown[]> {
  const projects = await pane.findAll({ type: "Text", text: PROJECT_CELL });
  return projects.map((project) => project.props.color);
}

const OLD_DATE = "2026-10-21T10:00:00.000Z";

function jsonLine(row: object): string {
  return `${JSON.stringify({
    timestamp: OLD_DATE,
    cwd: "/work/demo-app",
    gitBranch: "main",
    ...row,
  })}\n`;
}

function oldPrompt(text: string, extra: object = {}): string {
  return jsonLine({ type: "user", message: { role: "user", content: text }, ...extra });
}

function oldReply(text: string): string {
  return jsonLine({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
}

function spinnerLines(count: number): string {
  return Array.from({ length: count }, (_, at) => oldPrompt(`spinner number ${at}`)).join("");
}

function spawnWorld(world: HistoryWorld, outputs: Record<string, Output[]>): Spawn[] {
  world.spawning.searches = outputs;
  return world.spawning.searchSpawns;
}

describe("past sessions", () => {
  test("S1 typing a word starts one ripgrep through the claude binary and shows date, project, branch and line below this session's rows", async ($, on) => {
    const world = historyWorld(on);
    const spawns = spawnWorld(world, { spinner: [oldPrompt("fix the spinner glyph")] });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await askAndAnswer($, world, "spinner today", "p1", 0.42);
    await showHistory(pane);

    await typeFilter(pane, "spinner");

    expect(spawns).toHaveLength(1);
    expect(spawns[0]?.argv[0]).toBe("/h/u/.local/bin/claude");
    expect(spawns[0]?.env).toEqual({ ARGV0: "rg" });
    expect(spawns[0]?.argv).toContain("spinner");
    expect(spawns[0]?.argv.some((arg) => arg.startsWith("!"))).toBe(false);
    const texts = await bodyTexts(pane);
    const todayAt = texts.findIndex((text) => text.includes("spinner today"));
    const headingAt = texts.findIndex((text) => text.startsWith("past sessions"));
    const pastAt = texts.indexOf("Oct 21 demo-app · main fix the spinner glyph");
    expect(todayAt).toBeGreaterThan(-1);
    expect(headingAt).toBeGreaterThan(todayAt);
    expect(pastAt).toBeGreaterThan(headingAt);
  });

  test("S2 tool results, meta rows, sidechain rows and rows without the word are skipped; a past prompt has no reply mark and a past reply has one", async ($, on) => {
    const world = historyWorld(on);
    spawnWorld(world, {
      spinner: [
        jsonLine({
          type: "user",
          message: { role: "user", content: [{ type: "tool_result", content: "spinner" }] },
        }),
        oldPrompt("spinner meta", { isMeta: true }),
        oldPrompt("spinner sidechain", { isSidechain: true }),
        jsonLine({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "tool_use", name: "spinner" }] },
        }),
        oldPrompt("nothing here"),
        oldPrompt("spinner prompt kept"),
        oldReply("about the\nSpinner glyph"),
      ],
    });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    await typeFilter(pane, "spinner");

    const texts = (await bodyTexts(pane)).filter((text) => text.startsWith("Oct 21"));
    expect(texts).toEqual([
      "Oct 21 demo-app · main spinner prompt kept",
      "Oct 21 demo-app · main ↳ Spinner glyph",
    ]);
  });

  test("S3 a line split across two pieces is parsed once, whole", async ($, on) => {
    const world = historyWorld(on);
    const line = oldPrompt("fix the spinner glyph");
    spawnWorld(world, { spinner: [line.slice(0, 40), line.slice(40)] });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    await typeFilter(pane, "spinner");

    const texts = (await bodyTexts(pane)).filter((text) => text.startsWith("Oct 21"));
    expect(texts).toEqual(["Oct 21 demo-app · main fix the spinner glyph"]);
  });

  test("S4 a second input while the first search runs ends the first and shows only the second term's rows", async ($, on) => {
    const world = historyWorld(on);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spawns = spawnWorld(world, {
      alpha: [() => gate, oldPrompt("alpha old")],
      beta: [oldPrompt("beta old")],
    });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    const first = pane.input({ key: "filter", text: "alpha", kind: "change" });
    await pane.input({ key: "filter", text: "beta", kind: "change" });
    release();
    await first;
    await settle(pane);

    const texts = (await bodyTexts(pane)).filter((text) => text.startsWith("Oct 21"));
    expect(texts).toEqual(["Oct 21 demo-app · main beta old"]);
    expect(spawns.map((spawn) => spawn.isFinished)).toEqual([false, true]);
  });

  test("S5 without filter input nothing is spawned, and an emptied filter removes the past section", async ($, on) => {
    const world = historyWorld(on);
    const spawns = spawnWorld(world, { spinner: [oldPrompt("fix the spinner glyph")] });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);
    expect(spawns).toHaveLength(0);

    await typeFilter(pane, "spinner");
    expect((await bodyTexts(pane)).some((text) => text.startsWith("past sessions"))).toBe(true);
    await typeFilter(pane, "");

    expect((await bodyTexts(pane)).some((text) => text.startsWith("past sessions"))).toBe(false);
    expect(spawns).toHaveLength(1);
  });

  test("S6 a search with no hits says so under the heading", async ($, on) => {
    const world = historyWorld(on);
    spawnWorld(world, { zebra: [] });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    await typeFilter(pane, "zebra");

    expect(await bodyTexts(pane)).toContain("no matches in past sessions");
  });

  test("S7 at most 50 matches are shown", async ($, on) => {
    const world = historyWorld(on);
    const lines = Array.from({ length: 60 }, (_, at) => oldPrompt(`spinner number ${at}`));
    spawnWorld(world, { spinner: [lines.join("")] });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    await typeFilter(pane, "spinner");
    await showAllPast(pane);

    const texts = (await bodyTexts(pane)).filter((text) => text.startsWith("Oct 21"));
    expect(texts).toHaveLength(50);
  });

  test("S8 a Cyrillic word matches whatever its case", async ($, on) => {
    const world = historyWorld(on);
    spawnWorld(world, { СПИННЕР: [oldPrompt("почини спиннер сейчас")] });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    await typeFilter(pane, "СПИННЕР");

    expect(await bodyTexts(pane)).toContain("Oct 21 demo-app · main почини спиннер сейчас");
  });

  test("S9 a filter with quotes and a backslash finds the past line that holds them escaped, shown as typed", async ($, on) => {
    const world = historyWorld(on);
    const typed = 'echo "a\\b"';
    const escaped = String.raw`echo \"a\\b\"`;
    const spawns = spawnWorld(world, { [escaped]: [oldPrompt(typed)] });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    await typeFilter(pane, typed);

    expect(spawns[0]?.argv).toContain(escaped);
    const texts = (await bodyTexts(pane)).filter((text) => text.startsWith("Oct 21"));
    expect(texts).toEqual([`Oct 21 demo-app · main ${typed}`]);
  });

  test("S10 with exactly 50 past matches a muted note says the list stops at 50, under the rows", async ($, on) => {
    const world = historyWorld(on);
    spawnWorld(world, { spinner: [spinnerLines(PAST_CAP)] });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    await typeFilter(pane, "spinner");

    const notes = await pane.findAll({ type: "Text", text: CAP_NOTE });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.props.color).toBe(paneInk().muted);
    const texts = await bodyTexts(pane);
    expect(texts.indexOf(CAP_NOTE)).toBeGreaterThan(
      texts.findLastIndex((text) => text.startsWith("Oct 21")),
    );
  });

  test("S11 with 49 past matches no note about a cap is shown", async ($, on) => {
    const world = historyWorld(on);
    spawnWorld(world, { spinner: [spinnerLines(PAST_CAP - 1)] });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    await typeFilter(pane, "spinner");
    await showAllPast(pane);

    const texts = await bodyTexts(pane);
    expect(texts.filter((text) => text.startsWith("Oct 21"))).toHaveLength(PAST_CAP - 1);
    expect(texts).not.toContain(CAP_NOTE);
  });

  test("S12 a past match whose id is already listed in this session is not drawn again, another past match is", async ($, on) => {
    const world = historyWorld(on);
    spawnWorld(world, {
      spinner: [
        oldPrompt("spinner today", { uuid: "p1" }),
        oldPrompt("spinner again", { uuid: "past-2" }),
      ],
    });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await askAndAnswer($, world, "spinner today", "p1", 0.42);
    await showHistory(pane);

    await typeFilter(pane, "spinner");

    expect(await promptRows(pane)).toEqual([expect.stringContaining("spinner today")]);
    const past = (await bodyTexts(pane)).filter((text) => text.startsWith("Oct 21"));
    expect(past).toEqual(["Oct 21 demo-app · main spinner again"]);
  });

  test("S13 a past line that appears twice in the logs is shown once", async ($, on) => {
    const world = historyWorld(on);
    spawnWorld(world, {
      spinner: [
        oldPrompt("spinner twice", { uuid: "a" }),
        oldPrompt("spinner twice", { uuid: "b" }),
      ],
    });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    await typeFilter(pane, "spinner");

    const past = (await bodyTexts(pane)).filter((text) => text.startsWith("Oct 21"));
    expect(past).toEqual(["Oct 21 demo-app · main spinner twice"]);
  });

  test("S15 in a narrow pane a past match at the end of a long line is shown whole, after a leading ellipsis", async ($, on) => {
    const world = historyWorld(on);
    spawnWorld(world, {
      "glyph-spinner-pipeline": [
        oldPrompt("the quick brown fox jumps over the lazy dog glyph-spinner-pipeline"),
      ],
    });
    const pane = await openPane($, 60);
    await startFreshSession($, world);
    await showHistory(pane);

    await typeFilter(pane, "glyph-spinner-pipeline");

    const past = (await bodyTexts(pane)).filter((text) => text.startsWith("Oct 21"));
    expect(past).toHaveLength(1);
    expect(past[0]).toContain("glyph-spinner-pipeline");
    expect(past[0]).toContain("…");
    expect(past[0]?.length).toBeLessThanOrEqual(60);
  });

  test("S14 the past heading says searching while the search runs, then shows the results", async ($, on) => {
    const world = historyWorld(on);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    spawnWorld(world, { spinner: [() => gate, oldPrompt("spinner later")] });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    await pane.input({ key: "filter", text: "spinner", kind: "change" });
    await pane.redraw();
    expect(await bodyTexts(pane)).toContain("searching…");

    release();
    await settle(pane);
    expect(await bodyTexts(pane)).not.toContain("searching…");
    expect(await bodyTexts(pane)).toContain("Oct 21 demo-app · main spinner later");
  });

  test("S16 a prompt sent with a screenshot is found by its text and shown as a prompt", async ($, on) => {
    const world = historyWorld(on);
    spawnWorld(world, {
      spinner: [
        jsonLine({
          type: "user",
          message: {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
              { type: "text", text: "spinner with a screenshot" },
            ],
          },
        }),
      ],
    });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    await typeFilter(pane, "spinner");

    expect(await bodyTexts(pane)).toContain("Oct 21 demo-app · main spinner with a screenshot");
  });

  test("S17 a tool result that holds the word is not drawn as a past row", async ($, on) => {
    const world = historyWorld(on);
    spawnWorld(world, {
      spinner: [
        jsonLine({
          type: "user",
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "t1", content: "spinner output" }],
          },
        }),
      ],
    });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    await typeFilter(pane, "spinner");

    expect(await bodyTexts(pane)).toContain("no matches in past sessions");
  });

  test("S18 an automatic compaction summary that holds the word is not drawn as a past row", async ($, on) => {
    const world = historyWorld(on);
    spawnWorld(world, {
      spinner: [oldPrompt("spinner summary of the earlier work", { isCompactSummary: true })],
    });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    await typeFilter(pane, "spinner");

    expect(await bodyTexts(pane)).toContain("no matches in past sessions");
  });

  test("S19 repeated matches do not use up the 50 shown, so 50 distinct rows and the note show", async ($, on) => {
    const world = historyWorld(on);
    const firstPiece = spinnerLines(45) + oldPrompt("spinner number 0").repeat(5);
    const secondPiece = Array.from({ length: 10 }, (_, at) =>
      oldPrompt(`spinner later ${at}`),
    ).join("");
    spawnWorld(world, { spinner: [firstPiece, secondPiece] });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    await typeFilter(pane, "spinner");
    await showAllPast(pane);

    const texts = await bodyTexts(pane);
    expect(texts.filter((text) => text.startsWith("Oct 21"))).toHaveLength(PAST_CAP);
    expect(texts).toContain(CAP_NOTE);
  });

  test("S20 49 distinct matches with repeats show 49 rows and no note", async ($, on) => {
    const world = historyWorld(on);
    spawnWorld(world, {
      spinner: [spinnerLines(PAST_CAP - 1) + oldPrompt("spinner number 0").repeat(5)],
    });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    await typeFilter(pane, "spinner");
    await showAllPast(pane);

    const texts = await bodyTexts(pane);
    expect(texts.filter((text) => text.startsWith("Oct 21"))).toHaveLength(PAST_CAP - 1);
    expect(texts).not.toContain(CAP_NOTE);
  });

  test("S21 an older prompt with terminal colour codes is listed as plain text", async ($, on) => {
    const world = historyWorld(on);
    spawnWorld(world, { deploy: [oldPrompt("\u001b[2mdeploy notes\u001b[22m")] });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    await typeFilter(pane, "deploy");

    const past = (await bodyTexts(pane)).filter((text) => text.startsWith("Oct 21"));
    expect(past).toEqual(["Oct 21 demo-app · main deploy notes"]);
  });

  for (const wrapper of SYSTEM_WRAPPERS) {
    test(`S22 an older ${wrapper} line is not listed as a past match`, async ($, on) => {
      const world = historyWorld(on);
      const tag = wrapper.slice(1, -1);
      spawnWorld(world, { spinner: [oldPrompt(`${wrapper}spinner glyph</${tag}>`)] });
      const pane = await openPane($, COLUMNS);
      await startFreshSession($, world);
      await showHistory(pane);

      await typeFilter(pane, "spinner");

      expect(await bodyTexts(pane)).toContain("no matches in past sessions");
    });
  }

  test("S23 an older slash command the user typed is listed as a past row", async ($, on) => {
    const world = historyWorld(on);
    spawnWorld(world, { deploy: [oldPrompt("<command-name>/deploy</command-name>")] });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    await typeFilter(pane, "deploy");

    const past = (await bodyTexts(pane)).filter((text) => text.startsWith("Oct 21"));
    expect(past).toEqual(["Oct 21 demo-app · main /deploy"]);
  });

  test("S24 an older user row marked as a system prompt in the transcript is not listed as a past match", async ($, on) => {
    const world = historyWorld(on);
    spawnWorld(world, {
      spinner: [oldPrompt("spinner from a peer note", { promptSource: "system" })],
    });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    await typeFilter(pane, "spinner");

    expect(await bodyTexts(pane)).toContain("no matches in past sessions");
  });

  test("S25 a system prompt this session dropped from History does not come back under past sessions", async ($, on) => {
    const world = historyWorld(on);
    spawnWorld(world, {
      spinner: [oldPrompt("spinner from a peer", { uuid: "peer-1", promptSource: "system" })],
    });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await appendEntry($, world, {
      door: "prompt",
      id: "peer-1",
      text: "spinner from a peer",
      origin: { kind: "peer" },
    });
    await showHistory(pane);

    await typeFilter(pane, "spinner");

    expect(await bodyTexts(pane)).toContain("no matches in past sessions");
  });

  for (const { tag, text } of SHELL_ROWS) {
    test(`S26 an older <${tag}> shell row is not listed as a past match`, async ($, on) => {
      const world = historyWorld(on);
      spawnWorld(world, { spinner: [oldPrompt(text)] });
      const pane = await openPane($, COLUMNS);
      await startFreshSession($, world);
      await showHistory(pane);

      await typeFilter(pane, "spinner");

      expect(await bodyTexts(pane)).toContain("no matches in past sessions");
    });
  }

  test("S27 an older shell output whose filter word is on its second line is not listed as a past match", async ($, on) => {
    const world = historyWorld(on);
    spawnWorld(world, {
      spinner: [
        oldPrompt(
          "<bash-stdout>first output line\nspinner on the second line</bash-stdout><bash-stderr></bash-stderr>",
        ),
      ],
    });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    await typeFilter(pane, "spinner");

    expect(await bodyTexts(pane)).toContain("no matches in past sessions");
  });

  for (const marker of INTERRUPT_MARKERS) {
    test(`S28 an older ${marker} row is not listed as a past match`, async ($, on) => {
      const world = historyWorld(on);
      spawnWorld(world, {
        interrupted: [
          jsonLine({
            type: "user",
            message: { role: "user", content: [{ type: "text", text: marker }] },
          }),
        ],
      });
      const pane = await openPane($, COLUMNS);
      await startFreshSession($, world);
      await showHistory(pane);

      await typeFilter(pane, "interrupted");

      expect(await bodyTexts(pane)).toContain("no matches in past sessions");
    });
  }

  test("S29 an older prompt typed by hand is listed as a past row when its transcript row marks it typed by a human", async ($, on) => {
    const world = historyWorld(on);
    spawnWorld(world, {
      spinner: [
        oldPrompt("spinner typed by hand", {
          promptSource: "typed",
          origin: { kind: "human" },
        }),
      ],
    });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    await typeFilter(pane, "spinner");

    const past = (await bodyTexts(pane)).filter((text) => text.startsWith("Oct 21"));
    expect(past).toEqual(["Oct 21 demo-app · main spinner typed by hand"]);
  });

  test("S30 an older message whose transcript origin is a plugin is not listed as a past match, even with plain text", async ($, on) => {
    const world = historyWorld(on);
    spawnWorld(world, {
      spinner: [
        oldPrompt("spinner from a plugin", { origin: { kind: "plugin", name: "other-plugin" } }),
      ],
    });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    await typeFilter(pane, "spinner");

    expect(await bodyTexts(pane)).toContain("no matches in past sessions");
  });

  test("R3 a prompt absorbed mid-turn in a past session is found by its text and shown as a prompt", async ($, on) => {
    const world = historyWorld(on);
    spawnWorld(world, {
      denyme: [jsonLine(queuedAttachment("past-a1", MID_TURN_PROMPT, "prompt", { kind: "human" }))],
    });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    await typeFilter(pane, "denyme");

    const past = (await bodyTexts(pane)).filter((text) => text.startsWith("Oct 21"));
    expect(past).toEqual(["Oct 21 demo-app · main Run this Bash command: touch denyme.txt"]);
  });

  test("D3 past matches keep the project of every row in the text colour, repeated or not", async ($, on) => {
    const world = historyWorld(on);
    spawnWorld(world, {
      spinner: [
        oldPrompt("spinner one"),
        oldPrompt("spinner two"),
        oldPrompt("spinner three"),
        oldPrompt("spinner four", OTHER_PROJECT),
      ],
    });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    await typeFilter(pane, "spinner");

    expect(await projectColours(pane)).toEqual([
      paneInk().text,
      paneInk().text,
      paneInk().text,
      paneInk().text,
    ]);
  });

  test("D4 a past match whose branch differs from the row above keeps its project in the text colour", async ($, on) => {
    const world = historyWorld(on);
    spawnWorld(world, {
      spinner: [
        oldPrompt("spinner one"),
        oldPrompt("spinner two"),
        oldPrompt("spinner three", OTHER_BRANCH),
      ],
    });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    await typeFilter(pane, "spinner");

    expect(await projectColours(pane)).toEqual([paneInk().text, paneInk().text, paneInk().text]);
  });

  test("D11 a past match from another project on the same branch as the row above keeps its project in the text colour", async ($, on) => {
    const world = historyWorld(on);
    spawnWorld(world, {
      spinner: [
        oldPrompt("spinner one"),
        oldPrompt("spinner two"),
        oldPrompt("spinner three", OTHER_PROJECT_SAME_BRANCH),
      ],
    });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    await typeFilter(pane, "spinner");

    expect(await projectColours(pane)).toEqual([paneInk().text, paneInk().text, paneInk().text]);
  });
});

describe("resumed session", () => {
  test("H23 a resumed session lists the prompts it already holds, in order, with their time and a cost, before any new prompt", async ($, on) => {
    const world = resumedWorld(on, twoTypedPrompts());
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await resumeSession($, world);
    await showHistory(pane);

    const rows = await promptRows(pane);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/^07:03 fix the status row(?: -)?$/);
    expect(rows[1]).toMatch(/^07:09 now the history tab(?: -)?$/);
  });

  test("H24 a prompt sent after a resume is listed as the next row, below the resumed ones", async ($, on) => {
    const world = resumedWorld(on, twoTypedPrompts());
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await resumeSession($, world);
    await askAndAnswer($, world, "and one more thing", "p3", 0.3);
    await showHistory(pane);

    const rows = await promptRows(pane);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("fix the status row");
    expect(rows[1]).toContain("now the history tab");
    expect(rows[2]).toMatch(/^\d\d:\d\d and one more thing.* \$0\.30$/);
  });

  test("H25 filtering a word from a resumed prompt shows it under this session and not again under past sessions", async ($, on) => {
    const world = resumedWorld(on, twoTypedPrompts(), {
      history: [
        oldPrompt("now the history tab", { uuid: "r2" }),
        oldPrompt("history of another day", { uuid: "past-9" }),
      ],
    });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await resumeSession($, world);
    await showHistory(pane);

    await typeFilter(pane, "history");

    expect(await promptRows(pane)).toEqual([expect.stringContaining("now the history tab")]);
    const past = (await bodyTexts(pane)).filter((text) => text.startsWith("Oct 21"));
    expect(past).toEqual(["Oct 21 demo-app · main history of another day"]);
  });

  test("H26 a resumed conversation's task report and shell rows are not listed", async ($, on) => {
    const world = resumedWorld(
      on,
      [
        typedRow("r1", FIRST_PROMPT_AT, "fix the status row"),
        userRow("t1", SECOND_PROMPT_AT, "<task-notification>build done</task-notification>", {
          promptSource: "system",
        }),
        userRow("b1", SECOND_PROMPT_AT, "<bash-input>ls</bash-input>"),
        userRow(
          "b2",
          SECOND_PROMPT_AT,
          "<bash-stdout>a.txt</bash-stdout><bash-stderr></bash-stderr>",
        ),
      ].join("\n"),
    );
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await resumeSession($, world);
    await showHistory(pane);

    expect(await promptRows(pane)).toEqual([expect.stringContaining("fix the status row")]);
  });

  test("H27 clearing a resumed session empties the list", async ($, on) => {
    const world = resumedWorld(on, twoTypedPrompts());
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await resumeSession($, world);
    await showHistory(pane);
    expect(await promptRows(pane)).toHaveLength(2);

    await clearSession($, world);
    await settle(pane);

    expect(await promptRows(pane)).toEqual([]);
    expect(await bodyTexts(pane)).toContain("no prompts yet");
  });

  test("H28 a resumed transcript's typed prompt and slash commands list as their typed text, never as command tags", async ($, on) => {
    const world = resumedWorld(
      on,
      [
        typedRow("r1", FIRST_PROMPT_AT, "fix the status row"),
        userRow("c1", SECOND_PROMPT_AT, commandRow("model", "sonnet")),
        typedRow("c2", THIRD_PROMPT_AT, commandRow("loop", "check the build")),
      ].join("\n"),
    );
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await resumeSession($, world);
    await showHistory(pane);

    const rows = await promptRows(pane);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("fix the status row");
    expect(rows[1]).toMatch(/^07:09 \/model sonnet(?: -)?$/);
    expect(rows[2]).toMatch(/^07:12 \/loop check the build(?: -)?$/);
  });

  test("R1 a prompt absorbed mid-turn in a resumed transcript is listed between the prompts around it, once", async ($, on) => {
    const world = resumedWorld(
      on,
      [
        typedRow("r1", FIRST_PROMPT_AT, "fix the status row"),
        replyRow("r1-reply", FIRST_PROMPT_AT, "done"),
        absorbedRow("a1", ABSORBED_AT, MID_TURN_PROMPT),
        typedRow("r2", SECOND_PROMPT_AT, "now the history tab"),
      ].join("\n"),
    );
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await resumeSession($, world);
    await showHistory(pane);

    const rows = await promptRows(pane);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatch(/^07:03 fix the status row(?: -)?$/);
    expect(rows[1]).toMatch(/^07:06 Run this Bash command: touch denyme\.txt(?: -)?$/);
    expect(rows[2]).toMatch(/^07:09 now the history tab(?: -)?$/);
  });

  test("R4 a prompt absorbed mid-turn as an image plus text is listed by its text", async ($, on) => {
    const world = resumedWorld(
      on,
      [
        typedRow("r1", FIRST_PROMPT_AT, "fix the status row"),
        queuedRow(
          "a1",
          ABSORBED_AT,
          [
            { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
            { type: "text", text: MID_TURN_PROMPT },
          ],
          "prompt",
          { kind: "human" },
        ),
      ].join("\n"),
    );
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await resumeSession($, world);
    await showHistory(pane);

    const rows = await promptRows(pane);

    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatch(/^07:06 Run this Bash command: touch denyme\.txt(?: -)?$/);
  });

  test("R5 after a resume, a wake-up turn's cost stays on the typed prompt and is not moved to the prompt absorbed into it", async ($, on) => {
    const world = resumedWorld(
      on,
      [
        typedRow("r1", FIRST_PROMPT_AT, "fix the status row"),
        absorbedRow("a1", ABSORBED_AT, MID_TURN_PROMPT),
      ].join("\n"),
    );
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await resumeSession($, world);
    world.index.disk.writeLines(
      "p/session-one.jsonl",
      [
        typedRow("r1", FIRST_PROMPT_AT, "fix the status row"),
        absorbedRow("a1", ABSORBED_AT, MID_TURN_PROMPT),
      ],
      world.clock.now(),
    );
    await world.clock.set(FIRST_PROMPT_AT.getTime() + 10 * 60_000);
    await $.turn.start({ text: "wake up", turnId: "turn-wake-up" });
    await setSessionCost($, world, 0.3);
    await mainTurn($, world, { model: OPUS, tokens: { output: 10 }, context: 1000 });
    await showHistory(pane);

    const rows = await promptRows(pane);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/^07:03 fix the status row.* \$0\.30$/);
    expect(rows[1]).toMatch(/^07:06 Run this Bash command: touch denyme\.txt(?: -)?$/);
  });

  test("R2 a background task notice queued mid-turn in a resumed transcript adds no History row", async ($, on) => {
    const world = resumedWorld(
      on,
      [
        typedRow("r1", FIRST_PROMPT_AT, "fix the status row"),
        queuedRow("n1", ABSORBED_AT, TASK_NOTICE, "task-notification", {
          kind: "task-notification",
          producer: "session-task",
        }),
        typedRow("r2", SECOND_PROMPT_AT, "now the history tab"),
      ].join("\n"),
    );
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await resumeSession($, world);
    await showHistory(pane);

    const rows = await promptRows(pane);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("fix the status row");
    expect(rows[1]).toContain("now the history tab");
  });
});

function resumedWorld(
  on: On,
  transcript: string,
  outputs: Record<string, Output[]> = {},
): HistoryWorld {
  const world = historyWorld(on);
  world.spawning.searches = outputs;
  world.transcripts.files.set(TRANSCRIPT, transcript);
  return world;
}

async function resumeSession(
  $: Engine,
  world: HistoryWorld,
  source: "resume" | "fork" = "resume",
  path: string = TRANSCRIPT,
): Promise<void> {
  await $.classic.SessionStart({ source, transcript_path: path });
  await world.transcripts.readsFinished();
  await world.clock.advance(1000);
}

function bigTranscript(): string {
  return paddedTo(BIG_BYTES, [twoTypedPrompts()]);
}

function otherPrompts(): string {
  return [
    typedRow("o1", FIRST_PROMPT_AT, "deploy the other branch"),
    typedRow("o2", SECOND_PROMPT_AT, "check the other logs"),
  ].join("\n");
}

function twoTypedPrompts(): string {
  return [
    typedRow("r1", FIRST_PROMPT_AT, "fix the status row"),
    replyRow("r1-reply", FIRST_PROMPT_AT, "done"),
    turnEndRow("r1-end", FIRST_PROMPT_AT),
    typedRow("r2", SECOND_PROMPT_AT, "now the history tab"),
    replyRow("r2-reply", SECOND_PROMPT_AT, "done too"),
    turnEndRow("r2-end", SECOND_PROMPT_AT),
  ].join("\n");
}

function typedRow(uuid: string, at: Date, text: string): string {
  return userRow(uuid, at, text, { promptSource: "typed", origin: { kind: "human" } });
}

function commandRow(name: string, args: string): string {
  return `<command-name>/${name}</command-name>\n<command-message>${name}</command-message>\n<command-args>${args}</command-args>`;
}

function userRow(uuid: string, at: Date, text: string, extra: object = {}): string {
  return JSON.stringify({
    type: "user",
    uuid,
    timestamp: at.toISOString(),
    message: { role: "user", content: text },
    ...extra,
  });
}

function replyRow(uuid: string, at: Date, text: string): string {
  return JSON.stringify({
    type: "assistant",
    uuid,
    timestamp: at.toISOString(),
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
}

function turnEndRow(uuid: string, at: Date): string {
  return JSON.stringify({
    type: "system",
    subtype: "turn_duration",
    uuid,
    timestamp: at.toISOString(),
    durationMs: 1500,
  });
}

describe("resumed session over 4 MiB", () => {
  test("B1 resuming a transcript over 4 MiB lists its prompts with time and cost, like a small one", async ($, on) => {
    const world = resumedWorld(on, bigTranscript());
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await resumeSession($, world);
    await showHistory(pane);

    const rows = await promptRows(pane);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/^07:03 fix the status row(?: -)?$/);
    expect(rows[1]).toMatch(/^07:09 now the history tab(?: -)?$/);
  });

  test("B2 filtering a word from a reply of a transcript over 4 MiB finds the reply under this session", async ($, on) => {
    const world = resumedWorld(on, bigTranscript());
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await resumeSession($, world);
    await showHistory(pane);

    await typeFilter(pane, "done too");

    expect((await bodyTexts(pane)).some((text) => text.includes("done too"))).toBe(true);
  });

  test("B3 forking a transcript over 4 MiB lists its prompts too", async ($, on) => {
    const world = resumedWorld(on, bigTranscript());
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await resumeSession($, world, "fork");
    await showHistory(pane);

    const rows = await promptRows(pane);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("fix the status row");
    expect(rows[1]).toContain("now the history tab");
  });

  test("B4 a prompt row of a transcript over 4 MiB cut in two pieces by the reader is still listed whole", async ($, on) => {
    const world = resumedWorld(on, bigTranscript());
    world.transcripts.pieceSize = 40;
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await resumeSession($, world);
    await showHistory(pane);

    const rows = await promptRows(pane);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("fix the status row");
    expect(rows[1]).toContain("now the history tab");
  });

  test("B5 a transcript whose reader cannot start says it could not be read, not that there are no prompts", async ($, on) => {
    const world = resumedWorld(on, "");
    world.transcripts.files.set(TRANSCRIPT, { unreadable: "spawn-rejects" });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await resumeSession($, world);
    await showHistory(pane);

    const texts = await bodyTexts(pane);

    expect(texts).toContain(UNREADABLE);
    expect(texts).not.toContain("no prompts yet");
  });

  test("B6 a transcript whose reader fails with exit code 2 says it could not be read", async ($, on) => {
    const world = resumedWorld(on, "");
    world.transcripts.files.set(TRANSCRIPT, { unreadable: "grep-exit-2" });
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await resumeSession($, world);
    await showHistory(pane);

    const texts = await bodyTexts(pane);

    expect(texts).toContain(UNREADABLE);
    expect(texts).not.toContain("no prompts yet");
  });

  test("B7 a transcript over 4 MiB with no prompts in it still says no prompts yet", async ($, on) => {
    const world = resumedWorld(on, paddedTo(BIG_BYTES, []));
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await resumeSession($, world);
    await showHistory(pane);

    const texts = await bodyTexts(pane);

    expect(texts).toContain("no prompts yet");
    expect(texts).not.toContain(UNREADABLE);
  });

  test("B8 while the transcript is still being read the list says reading transcript", async ($, on) => {
    const world = resumedWorld(on, bigTranscript());
    const release = world.transcripts.pause();
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    const resuming = $.classic.SessionStart({ source: "resume", transcript_path: TRANSCRIPT });
    await world.transcripts.readHeld();
    await showHistory(pane);

    const texts = await bodyTexts(pane);
    release();
    await resuming;
    await world.transcripts.readsFinished();
    await world.clock.advance(1000);

    expect(texts).toContain(READING);
    expect(texts).not.toContain("no prompts yet");
  });

  test("B9 a prompt sent while the transcript is being read is listed once, after the resumed ones", async ($, on) => {
    const world = resumedWorld(on, bigTranscript());
    const release = world.transcripts.pause();
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    const resuming = $.classic.SessionStart({ source: "resume", transcript_path: TRANSCRIPT });
    await world.transcripts.readHeld();
    await appendMessage($, world, { door: "prompt", id: "p3", text: "typed during the read" });
    release();
    await resuming;
    await world.transcripts.readsFinished();
    await world.clock.advance(1000);
    await showHistory(pane);

    const rows = await promptRows(pane);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("fix the status row");
    expect(rows[1]).toContain("now the history tab");
    expect(rows[2]).toContain("typed during the read");
  });

  test("B10 resuming another session replaces the list with that session's prompts only", async ($, on) => {
    const world = resumedWorld(on, bigTranscript());
    world.transcripts.files.set(OTHER_TRANSCRIPT, paddedTo(BIG_BYTES, [otherPrompts()]));
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await resumeSession($, world);
    await resumeSession($, world, "resume", OTHER_TRANSCRIPT);
    await showHistory(pane);

    const rows = await promptRows(pane);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("deploy the other branch");
    expect(rows[1]).toContain("check the other logs");
  });
});

function queuedAttachment(
  uuid: string,
  prompt: string | object[],
  commandMode: string,
  origin: object,
): object {
  const shown = typeof prompt === "string" ? prompt : MID_TURN_PROMPT;
  return {
    type: "attachment",
    uuid,
    attachment: {
      type: "queued_command",
      prompt,
      commandMode,
      origin,
      humanTurn: true,
    },
    rendered: [
      {
        content: `<system-reminder>\nThe user sent a new message while you were working:\n${shown}\n\nThis is how Claude Code surfaces messages the user sends mid-turn.\n</system-reminder>`,
      },
    ],
    renderedRole: "system",
  };
}

function queuedRow(
  uuid: string,
  at: Date,
  prompt: string | object[],
  commandMode: string,
  origin: object,
): string {
  return JSON.stringify({
    timestamp: at.toISOString(),
    ...queuedAttachment(uuid, prompt, commandMode, origin),
  });
}

function absorbedRow(uuid: string, at: Date, prompt: string): string {
  return queuedRow(uuid, at, prompt, "prompt", { kind: "human" });
}
