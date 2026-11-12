import { describe, expect, mock, test } from "claude-code/testing";
import type { On, SessionMessage } from "claude-code";
import type { Engine, MockClock, Mounted } from "claude-code/testing";

import type { AgentNode } from "../hooks/agents-model";
import { fillsFor, palette } from "../hooks/palette";
import { paneHeaderLook } from "../hooks/pane-kit";
import { paneInk } from "../hooks/pane-ink";
import type { CallRecord } from "../types";
import { screenRows } from "./band-screen";
import { collect, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import { pricedSpent, seedOf } from "./fixtures/agent-spend";
import type { Tokens } from "./spend-world";
import { TOKENS_BILLED_LABEL } from "../hooks/spend-model";

type Pane = Mounted<"terminal", "Pane">;
type Fixture = AgentNode & { spent?: Tokens };
type Transcript = SessionMessage[] | { deny: string };
type World = {
  clock: MockClock;
  transcripts: Map<string, Transcript>;
  asked: { question: string; options: string[] }[];
  answer: string | null;
  stopCalls: unknown[];
  stopFailure: string | null;
  toasts: string[];
  writes: { key: string; value: unknown }[];
};

const NOW = 200_000;
const COLUMNS = 100;
const NARROW_COLUMNS = 60;
const WIDE_COLUMNS = 120;
const PATHS_IN_PROMPT = 30;
const NESTED_FOLDER = "/private/tmp/claude-502/-home-dev-projects-IT-demo-app/nested-folder";
const WRAP_PROMPT = `read ${NESTED_FOLDER}/module-alpha/nested-folder/report-final-version.ts and answer`;
const WIDE_NAME = `${"x".repeat(70)}-final-report.ts`;
const WIDE_NAME_PROMPT = `open /work/${WIDE_NAME}`;
const LONG_ID = `agent-${"0123456789".repeat(7)}0123`;
const LIVE_LAST_LINE = "live log 4";
const SLASH_PATH = `/home/dev/${"y".repeat(NARROW_COLUMNS)}/y.ts`;
const SLASH_PROMPT = `${"x".repeat(NARROW_COLUMNS - 6)} ${SLASH_PATH}`;
const TOOL_CALLS = 40;
const CODE_PATH = `${NESTED_FOLDER}/module-alpha/nested-folder/report-final-version.ts`;
const HEADING = /^(prompt|agent) ─+$/;
const NARROW_SHOWN_MESSAGES = 11;
const ROWS = 40;
const SECOND = 1_000;
const SETTLE_TICKS = 5;
const MANY_MESSAGES = 200;
const FEW_MESSAGES = 3;
const TOOL_RUN_LENGTH = 14;
const EXPANDED_CALLS = 30;
const MESSAGES_WITH_EARLIER = 13;
const TALL_ROWS = 48;
const FILLING_LINES = 42;
const AGENT_ROWS = 60;
const LONG_TOOL_PATH = "/home/dev/demo-app-agents-detail/hooks/activity-calls.ts";
const DATE_PROMPT = "Use Bash to run date and answer with the output only.";
const DATE_OUTPUT = "Tue Oct 28 14:02:11 2026";
const LONG_TEXT =
  "investigate why the nightly export job keeps timing out when the warehouse is under heavy load and the queue backs up for hours";
const DRAWN_LIMIT_FACTOR = 2;
const HANGING_ROWS = 6;
const HANGING_INDENT = 2;
const STOP = "Stop";
const KEEP = "Keep running";
const store = new Map<string, { value: unknown; version: number }>();

describe("agent transcript", () => {
  test("V1 pressing a finished agent's title opens its transcript with the prompt and agent headings, each followed by its text, and a muted tool row for every tool use", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [
      message("user", "write the report"),
      message("assistant", "on it", [{ tool: "Read", input: { file_path: "/work/a.ts" } }]),
    ]);
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);

    await openTranscript(pane, "alpha");

    const rows = await rowTexts(pane);
    const at = (text: string): number => rows.findIndex((row) => row.trim().endsWith(text));
    expect(rows.some((row) => row.includes("main"))).toBe(false);
    expect(headingAt(rows, "prompt")).toBeLessThan(at("write the report"));
    expect(at("write the report")).toBeLessThan(headingAt(rows, "agent"));
    expect(headingAt(rows, "agent")).toBeLessThan(at("on it"));
    expect(at("on it")).toBeLessThan(at("Read: a.ts"));
    expect(await colorOfText(pane, "prompt")).toBe(paneHeaderLook().color);
    expect(await colorOfText(pane, "agent")).toBe(paneHeaderLook().color);
    expect(await colorOfText(pane, "Read: a.ts")).toBe(palette.muted);
  });

  test("S7 the detail header shows the status word after the mark and ends with the agent's cost", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go")]);
    const pane = await paneWithAgents($, [
      agent({
        id: "a",
        description: "alpha",
        model: "haiku",
        effort: "high",
        spent: { input: 20_000, output: 2_000 },
      }),
    ]);

    await openTranscript(pane, "alpha");

    const header = (await lines(pane)).find((line) => line.buttons.includes("back"));
    expect(header?.text.trimEnd()).toMatch(/✓ done alpha · haiku · high · 10s · 22k · ~\$0\.09$/);
    expect(await colorOfText(pane, "done")).toBe(paneInk().ok);
  });

  test("S7 with no cost the detail header ends at the effort and shows no dollar sign", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go")]);
    const pane = await paneWithAgents($, [
      agent({ id: "a", description: "alpha", model: "haiku", effort: "high" }),
    ]);

    await openTranscript(pane, "alpha");

    const header = (await lines(pane)).find((line) => line.buttons.includes("back"));
    expect(header?.text.trimEnd()).toMatch(/alpha · haiku · high · 10s$/);
    expect(header?.text).not.toContain("$");
  });

  test("S7 a waiting agent's detail header shows the word waiting after its dot", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go")]);
    const pane = await paneWithAgents($, [
      agent({ id: "a", description: "alpha", model: "haiku", effort: "high", status: "waiting" }),
    ]);

    await openTranscript(pane, "alpha");

    const header = (await lines(pane)).find((line) => line.buttons.includes("back"));
    expect(header?.text.trimEnd()).toMatch(/● waiting alpha · haiku · high · 10s$/);
  });

  test("S9 an agent that cost zero dollars and used no tokens shows no cost in its detail header", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go")]);
    const pane = await paneWithAgents($, [
      agent({ id: "a", description: "alpha", model: "haiku", effort: "high", spent: {} }),
    ]);

    await openTranscript(pane, "alpha");

    const header = (await lines(pane)).find((line) => line.buttons.includes("back"));
    expect(header?.text.trimEnd()).toMatch(/alpha · haiku · high · 10s$/);
    expect(header?.text).not.toContain("$");
  });

  test("V2 the transcript header has a back button and the same title the card had", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go")]);
    const pane = await paneWithAgents($, [
      agent({ id: "a", description: "alpha", model: "haiku", effort: "high" }),
    ]);

    await openTranscript(pane, "alpha");

    const header = (await lines(pane)).find((line) => line.buttons.includes("back"));
    expect(header, "a header row with a back button").toBeDefined();
    expect(header?.text).toContain("alpha · haiku · high");
  });

  test("V29 the transcript title of an idle agent starts with the hollow dim circle", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go")]);
    const pane = await paneWithAgents($, [
      agent({ id: "a", description: "alpha", status: "idle" }),
    ]);

    await openTranscript(pane, "alpha");

    expect(await colorOfText(pane, "○")).toBe(paneInk().muted);
  });

  test("V28 the transcript header shows the model and effort after the description in the muted colour while the description keeps its colour", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go")]);
    const pane = await paneWithAgents($, [
      agent({ id: "a", description: "alpha", model: "haiku", effort: "high" }),
    ]);

    await openTranscript(pane, "alpha");

    expect(await colorOfOwnText(pane, "haiku · high")).toBe(palette.muted);
    expect(await colorOfOwnText(pane, "alpha")).toBe(palette.text);
  });

  test("V3 a user message that holds only tool results is not drawn, and the agent messages on either side of it share one agent label", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [
      message("user", "first task"),
      message("assistant", "reading", [{ tool: "Read", input: { file_path: "/work/a.ts" } }]),
      message("user", ""),
      message("assistant", "all done"),
    ]);
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);

    await openTranscript(pane, "alpha");

    const rows = await rowTexts(pane);
    expect(rows.filter((row) => isHeading(row, "prompt"))).toHaveLength(1);
    expect(rows.filter((row) => isHeading(row, "agent"))).toHaveLength(1);
  });

  test("V4 a long transcript shows its newest messages and an earlier row that counts the hidden ones", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", manyMessages(MANY_MESSAGES));
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);

    await openTranscript(pane, "alpha");

    const rows = (await rowTexts(pane)).map((row) => row.trim());
    const earlier = rows.find(isEarlierRow);
    const shown = rows.filter((row) => /^message \d+$/.test(row)).length;
    expect(earlier, "an earlier row").toBeDefined();
    expect(Number(earlier?.match(/\d+/)?.[0]) + shown).toBe(MANY_MESSAGES);
    expect(rows.some((row) => row.includes(`message ${MANY_MESSAGES - 1}`))).toBe(true);
    expect(rows.some((row) => row === "message 1")).toBe(false);
  });

  test("V5 a short transcript shows every message and no earlier row", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", manyMessages(FEW_MESSAGES));
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);

    await openTranscript(pane, "alpha");

    const rows = await rowTexts(pane);
    expect(rows.some((row) => row.includes("earlier"))).toBe(false);
    expect(rows.filter((row) => HEADING.test(row))).toHaveLength(FEW_MESSAGES);
  });

  test("V6 when the engine cannot read the transcript the view says so in one muted row", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", { deny: "no saved transcript" });
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);

    await openTranscript(pane, "alpha");

    const rows = await rowTexts(pane);
    expect(rows.filter((row) => row.includes("transcript not available"))).toHaveLength(1);
    expect(await colorOfText(pane, "transcript not available")).toBe(palette.muted);
    expect(rows.some((row) => HEADING.test(row))).toBe(false);
  });

  test("V7 pressing back returns to the agent list", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go")]);
    const pane = await paneWithAgents($, [
      agent({ id: "a", description: "alpha" }),
      agent({ id: "b", description: "bravo" }),
    ]);
    await openTranscript(pane, "alpha");

    await pressButton(pane, "back");

    const rows = await rowTexts(pane);
    expect(rows.some((row) => row.includes("main"))).toBe(true);
    expect(rows.some((row) => row.includes("alpha"))).toBe(true);
    expect(rows.some((row) => row.includes("bravo"))).toBe(true);
    expect(rows.some((row) => isHeading(row, "prompt"))).toBe(false);
  });

  test("V8 an open transcript falls back to the list when its agent leaves the tab", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go")]);
    const pane = await paneWithAgents($, [
      agent({ id: "a", description: "alpha" }),
      agent({ id: "b", description: "bravo" }),
    ]);
    await openTranscript(pane, "alpha");

    await writeAgents([agent({ id: "b", description: "bravo" })]);
    await settle(pane);

    const rows = await rowTexts(pane);
    expect(rows.some((row) => row.includes("main"))).toBe(true);
    expect(rows.some((row) => row.includes("bravo"))).toBe(true);
    expect(rows.some((row) => isHeading(row, "prompt"))).toBe(false);
  });

  test("V9 the transcript of a running agent shows a message that arrives while it is open", async ($, on) => {
    const world = worldOf(on);
    const messages = [message("user", "go")];
    world.transcripts.set("a", messages);
    const pane = await paneWithAgents($, [
      agent({ id: "a", description: "alpha", status: "running", startedAt: NOW - 5_000 }),
    ]);
    await openTranscript(pane, "alpha");

    messages.push(message("assistant", "fresh news"));
    await writeAgents([
      agent({
        id: "a",
        description: "alpha",
        status: "running",
        startedAt: NOW - 5_000,
        ctxTokens: 500,
      }),
    ]);
    await world.clock.advance(2 * SECOND);

    expect((await rowTexts(pane)).some((row) => row.includes("fresh news"))).toBe(true);
  });

  test("V15 tool rows with long paths keep the file name and the tool name", async ($, on) => {
    const world = worldOf(on);
    const folder = `/private/tmp/claude-502/-home-dev-projects-IT-demo-app/${"nested-folder/".repeat(6)}`;
    world.transcripts.set("a", [
      message("user", "read both"),
      message("assistant", "reading", [
        { tool: "Read", input: { file_path: `${folder}file07.txt` } },
        { tool: "Read", input: { file_path: `${folder}file08.txt` } },
      ]),
    ]);
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);

    await openTranscript(pane, "alpha");

    const toolRows = (await screenOf(pane, COLUMNS)).filter((row) => row.includes("Read:"));
    expect(toolRows.map((row) => row.slice(-10))).toEqual(["file07.txt", "file08.txt"]);
    expect(toolRows.every((row) => row.startsWith("✓ Read: …"))).toBe(true);
    expect(toolRows.every((row) => row.length <= COLUMNS)).toBe(true);
  });

  test("V24 a Read of a file outside the session folder keeps its absolute path", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [
      message("user", "look around"),
      message("assistant", "", [
        { tool: "Read", input: { file_path: "/work/inside.ts" } },
        { tool: "Read", input: { file_path: "/elsewhere/outside.ts" } },
      ]),
    ]);
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);

    await openTranscript(pane, "alpha");

    const toolRows = (await screenOf(pane, COLUMNS)).filter((row) => row.includes("Read:"));
    expect(toolRows).toEqual(["✓ Read: inside.ts", "✓ Read: /elsewhere/outside.ts"]);
  });

  test("V25 the transcript has one blank row after the header block, the agent label directly above the first tool row after one blank row, none between two tool rows, and one blank row before the reply", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [
      message("user", "read both"),
      message("assistant", "", [
        { tool: "Read", input: { file_path: "/work/one.ts" } },
        { tool: "Read", input: { file_path: "/work/two.ts" } },
      ]),
      message("assistant", "all read"),
    ]);
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);

    await openTranscript(pane, "alpha");

    const rows = await screenBody(pane);
    const at = (text: string): number => rows.indexOf(text);
    expect(rows[headingAt(rows, "prompt") - 1]).toBe("");
    expect(rows[headingAt(rows, "prompt") - 2]).not.toBe("");
    expect(rows[headingAt(rows, "agent") - 1]).toBe("");
    expect(rows[headingAt(rows, "agent") + 1]).toBe("✓ Read: one.ts");
    expect(at("✓ Read: two.ts") - at("✓ Read: one.ts")).toBe(1);
    expect(rows[at("all read") - 1]).toBe("");
  });

  test("V26 prompt text, then an agent message holding only a tool call, then agent text: one agent label sits above the tool row and a blank row sets the reply apart", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [
      message("user", DATE_PROMPT),
      message("assistant", "", [{ tool: "Bash", input: { command: "date" } }]),
      message("assistant", DATE_OUTPUT),
    ]);
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);

    await openTranscript(pane, "alpha");

    expect((await screenBody(pane)).map(headingWord)).toEqual([
      "",
      "prompt",
      DATE_PROMPT,
      "",
      "agent",
      "✓ Bash: date",
      "",
      DATE_OUTPUT,
    ]);
  });

  test("V27 when the 12-message window starts in the middle of a run of agent tool calls, the earlier row sits under the agent heading and the first kept row is a tool row", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go"), ...toolOnlyMessages(TOOL_RUN_LENGTH)]);
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);

    await openTranscript(pane, "alpha");

    const rows = await bodyRows(pane);
    const earlier = rows.findIndex((row) => /^\[ \d+ earlier \]$/.test(row));
    expect(earlier, "an earlier row, so the window starts mid-run").toBeGreaterThanOrEqual(0);
    expect(headingWord(rows[earlier - 1] ?? "")).toBe("agent");
    expect(rows[earlier + 1] ?? "", "the first kept row").toContain("file2.ts");
  });

  test("V16 a message with only tool uses draws its tool rows under the one agent label of its run", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [
      message("user", "go"),
      message("assistant", "", [{ tool: "Read", input: { file_path: "/work/a.ts" } }]),
      message("assistant", "", [{ tool: "Grep", input: { pattern: "needle" } }]),
      message("assistant", "found it"),
    ]);
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);

    await openTranscript(pane, "alpha");

    const rows = (await rowTexts(pane)).map((row) => row.trim());
    expect(rows.filter((row) => isHeading(row, "agent"))).toHaveLength(1);
    expect(headingAt(rows, "agent")).toBeLessThan(
      rows.findIndex((row) => row.endsWith("Read: a.ts")),
    );
    expect(rows.some((row) => row.includes("Grep:"))).toBe(true);
  });

  test("V17 the agent's hand-back is drawn as its answer under an agent row, wrapped, without the engine tool name", async ($, on) => {
    const world = worldOf(on);
    const answer =
      'Each file has one line of text ("file 07 content") and nothing else, so the folder holds twelve lines in total and there is no other output to report';
    world.transcripts.set("a", [
      message("user", "count the lines"),
      message("assistant", "", [{ tool: "SubagentHandback", input: { message: answer } }]),
    ]);
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);

    await openTranscript(pane, "alpha");

    const rows = (await rowTexts(pane)).map((row) => row.trim());
    const roleAt = headingAt(rows, "agent");
    expect(rows.some((row) => row.includes("SubagentHandback"))).toBe(false);
    expect(roleAt).toBeGreaterThan(headingAt(rows, "prompt"));
    expect(rows[roleAt + 1]).toBe(rows.find((row) => row.startsWith("Each file has one line")));
    expect(rows.some((row) => row.endsWith("no other output to report"))).toBe(true);
    expect(rows.join(" ")).toContain(answer);
  });

  test("V21 a multi-line hand-back shows every one of its lines", async ($, on) => {
    const world = worldOf(on);
    const files = Array.from(
      { length: 16 },
      (_, i) => `f${String(i + 1).padStart(2, "0")}.txt: line ${i + 1}`,
    );
    world.transcripts.set("a", [
      message("user", "read the files"),
      message("assistant", "", [
        { tool: "SubagentHandback", input: { message: files.join("\n") } },
      ]),
    ]);
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);

    await openTranscript(pane, "alpha");

    const drawn = (await rowTexts(pane)).flatMap((row) => row.split("\n")).map((row) => row.trim());
    expect(files.filter((line) => !drawn.includes(line))).toEqual([]);
  });

  test("V22 a multi-line agent message shows every one of its lines", async ($, on) => {
    const world = worldOf(on);
    const lines16 = Array.from({ length: 16 }, (_, i) => `step ${i + 1} done`);
    world.transcripts.set("a", [message("user", "go"), message("assistant", lines16.join("\n"))]);
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);

    await openTranscript(pane, "alpha");

    const drawn = (await rowTexts(pane)).flatMap((row) => row.split("\n")).map((row) => row.trim());
    expect(lines16.filter((line) => !drawn.includes(line))).toEqual([]);
  });

  test("V23 with tool-result-only and empty messages mixed in, the newest drawn messages show and the earlier count is the drawn total minus the ones shown", async ($, on) => {
    const world = worldOf(on);
    const drawnTotal = 20;
    world.transcripts.set("a", mixedMessages(drawnTotal));
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);

    await openTranscript(pane, "alpha");

    const rows = (await rowTexts(pane)).map((row) => row.trim());
    const shown = rows.filter((row) => /^message \d+$/.test(row)).length;
    expect(rows).toContain(`[ ${drawnTotal - shown} earlier ]`);
    expect(rows.some((row) => row.includes(`message ${drawnTotal - 1}`))).toBe(true);
    expect(rows).toContain(`message ${drawnTotal - shown + 1}`);
    expect(rows).not.toContain(`message ${drawnTotal - shown}`);
  });

  test("V18 the engine's interrupt marker is not drawn as a prompt", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [
      message("user", "go"),
      message("assistant", "working", [{ tool: "Bash", input: { command: "sleep 99" } }]),
      message("user", "[Request interrupted by user for tool use]"),
    ]);
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);

    await openTranscript(pane, "alpha");

    const rows = (await rowTexts(pane)).map((row) => row.trim());
    expect(rows.some((row) => row.includes("Request interrupted"))).toBe(false);
    expect(rows.filter((row) => isHeading(row, "prompt"))).toHaveLength(1);
  });

  test("V10 a long description is clipped in the transcript header and the model and effort are dropped before it", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go")]);
    const pane = await paneWithAgents($, [
      agent({ id: "a", description: LONG_TEXT, model: "haiku", effort: "high" }),
    ]);

    await openTranscript(pane, "investigate");

    const header = (await lines(pane)).find((line) => line.buttons.includes("back"));
    expect(header?.text).toContain("…");
    expect(header?.text).not.toContain("haiku");
    expect(header?.text).not.toContain("high");
  });

  test("V11 a short description in the transcript header is not clipped", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go")]);
    const pane = await paneWithAgents($, [
      agent({ id: "a", description: "alpha", model: "haiku", effort: "high" }),
    ]);

    await openTranscript(pane, "alpha");

    const header = (await lines(pane)).find((line) => line.buttons.includes("back"));
    expect(header?.text.trimEnd().endsWith("alpha · haiku · high · 10s")).toBe(true);
    expect(header?.text).not.toContain("…");
  });

  test("V12 the earlier row of a long transcript is a button", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", manyMessages(MANY_MESSAGES));
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);

    await openTranscript(pane, "alpha");

    expect(await earlierLabels(pane)).toHaveLength(1);
  });

  test("V13 pressing the earlier row shows the first message and the earlier row is gone", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", manyMessages(MANY_MESSAGES));
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);
    await openTranscript(pane, "alpha");

    await pressButton(pane, (await earlierLabels(pane))[0] ?? "");

    const rows = await rowTexts(pane);
    expect(rows.some((row) => row.includes("message 0"))).toBe(true);
    expect(await earlierLabels(pane)).toEqual([]);
    expect(rows.some((row) => /^\[ \d+ earlier \]$/.test(row.trim()))).toBe(false);
  });

  test("V14 after back and reopen the transcript is short again", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", manyMessages(MANY_MESSAGES));
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);
    await openTranscript(pane, "alpha");
    await pressButton(pane, (await earlierLabels(pane))[0] ?? "");
    await pressButton(pane, "back");

    await openTranscript(pane, "alpha");

    const rows = await rowTexts(pane);
    expect(rows.some((row) => row.trim() === "message 1")).toBe(false);
    expect(await earlierLabels(pane)).toHaveLength(1);
  });
  test("Z3 a text line followed by a tool row in one run has one blank row between them", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [
      message("user", "go"),
      message("assistant", "reading the file now", [
        { tool: "Read", input: { file_path: "/work/one.ts" } },
      ]),
    ]);
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);
    await openTranscript(pane, "alpha");

    const rows = await screenBody(pane);
    const text = rows.findIndex((row) => row.includes("reading the file now"));
    expect(text, "the text line").toBeGreaterThanOrEqual(0);
    expect(rows[text + 1], "a blank row after the text").toBe("");
    expect(rows[text + 2] ?? "", "the tool row after the blank row").toContain("one.ts");
  });

  test("Z3 a tool row followed by a text line in one run has one blank row between them", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [
      message("user", "go"),
      message("assistant", "", [{ tool: "Read", input: { file_path: "/work/one.ts" } }]),
      message("assistant", "all done"),
    ]);
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);
    await openTranscript(pane, "alpha");

    const rows = await screenBody(pane);
    const tool = rows.findIndex((row) => row.includes("one.ts"));
    expect(tool, "the tool row").toBeGreaterThanOrEqual(0);
    expect(rows[tool + 1], "a blank row after the tool row").toBe("");
    expect(rows[tool + 2], "the text after the blank row").toBe("all done");
  });
});

describe("agent transcript wrap", () => {
  test("W1 at 60 columns a prompt holding a long path breaks only at a slash or a space", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", WRAP_PROMPT), message("assistant", "ok")]);
    const pane = await paneWithAgents(
      $,
      [agent({ id: "a", description: "alpha" })],
      NARROW_COLUMNS,
    );

    await openTranscript(pane, "alpha");

    const lines = promptRowsOf(await screenOf(pane, NARROW_COLUMNS));
    expect(lines[0]?.startsWith("read /private/")).toBe(true);
    expect(breaksAtSeparators(WRAP_PROMPT, lines)).toBe(true);
  });

  test("W2 at 60 columns a file name wider than the row shows all its characters across rows", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", WIDE_NAME_PROMPT), message("assistant", "ok")]);
    const pane = await paneWithAgents(
      $,
      [agent({ id: "a", description: "alpha" })],
      NARROW_COLUMNS,
    );

    await openTranscript(pane, "alpha");

    const rows = await screenOf(pane, NARROW_COLUMNS);
    expect(promptRowsOf(rows).join("")).toContain(WIDE_NAME);
  });

  test("W3 at 60 columns an agent ID wider than the row is drawn across rows with all its characters", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [
      message("user", "go"),
      message("assistant", `agent ${LONG_ID} finished`),
    ]);
    const pane = await paneWithAgents(
      $,
      [agent({ id: "a", description: "alpha" })],
      NARROW_COLUMNS,
    );

    await openTranscript(pane, "alpha");

    expect((await screenOf(pane, NARROW_COLUMNS)).join("")).toContain(LONG_ID);
  });

  test("W3 at 120 columns an agent ID that fits the row is drawn whole on one row", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [
      message("user", "go"),
      message("assistant", `agent ${LONG_ID} finished`),
    ]);
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })], WIDE_COLUMNS);

    await openTranscript(pane, "alpha");

    expect(await screenOf(pane, WIDE_COLUMNS)).toContain(`agent ${LONG_ID} finished`);
  });

  test("Y3 at 60 columns a prompt whose first slash would end a row never leaves a lone slash at a row end", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", SLASH_PROMPT), message("assistant", "ok")]);
    const pane = await paneWithAgents(
      $,
      [agent({ id: "a", description: "alpha" })],
      NARROW_COLUMNS,
    );
    await openTranscript(pane, "alpha");

    const rows = await screenOf(pane, NARROW_COLUMNS);
    expect(rows.some((row) => row === "/" || row.endsWith(" /"))).toBe(false);
    expect(rows.join("")).toContain(SLASH_PATH);
  });
  test("Z2 at 60 columns a tool call on a long path shows the folder tail after an ellipsis, cut at a slash", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go"), message("assistant", "done")]);
    seedCalls([callRecord("a-read", "a", "Read", LONG_TOOL_PATH, 2_000)]);
    const pane = await paneWithAgents(
      $,
      [agent({ id: "a", description: "alpha" })],
      NARROW_COLUMNS,
    );
    await openTranscript(pane, "alpha");

    const row = (await screenOf(pane, NARROW_COLUMNS)).find((candidate) =>
      candidate.includes("activity-calls.ts"),
    );
    expect(row, "a call row for the path").toBeDefined();
    expect(row).toContain("…/hooks/activity-calls.ts");
  });
});

describe("agent transcript fold", () => {
  test("F1 at 60 columns a prompt of 30 paths is cut to one row ending with an ellipsis", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", manyPathsPrompt()), ...liveLog()]);
    const pane = await paneWithAgents(
      $,
      [agent({ id: "a", description: "alpha" })],
      NARROW_COLUMNS,
    );

    await openTranscript(pane, "alpha");

    const rows = await screenOf(pane, NARROW_COLUMNS);
    expect(rows[headingAt(rows, "prompt") + 1] ?? "", "the cut prompt row").toMatch(/…$/);
  });

  test("F1 at 120 columns a prompt of 30 paths is cut to one row ending with an ellipsis and the last live log line is on screen", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", manyPathsPrompt()), ...liveLog()]);
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })], WIDE_COLUMNS);

    await openTranscript(pane, "alpha");

    const rows = await screenOf(pane, WIDE_COLUMNS);
    expect(rows[headingAt(rows, "prompt") + 1] ?? "", "the cut prompt row").toMatch(/…$/);
    expect(rows).toContain(LIVE_LAST_LINE);
  });
  test("F2 at 60 columns a transcript of 200 messages shows 188 earlier, its prompt and its 11 newest messages", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", manyMessages(MANY_MESSAGES));
    const pane = await paneWithAgents(
      $,
      [agent({ id: "a", description: "alpha" })],
      NARROW_COLUMNS,
    );

    await openTranscript(pane, "alpha");

    const rows = await screenOf(pane, NARROW_COLUMNS);
    expect(rows).toContain(`[ ${MANY_MESSAGES - NARROW_SHOWN_MESSAGES - 1} earlier ]`);
    expect(rows.filter((row) => HEADING.test(row))).toHaveLength(NARROW_SHOWN_MESSAGES + 1);
    expect(rows.some((row) => row.trim() === "message 1")).toBe(false);
  });

  test("Y5 at 60 columns the earlier row of a long transcript sits under the agent heading, with the first kept message right below it", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", manyMessages(MANY_MESSAGES));
    const pane = await paneWithAgents(
      $,
      [agent({ id: "a", description: "alpha" })],
      NARROW_COLUMNS,
    );
    await openTranscript(pane, "alpha");

    const rows = await screenOf(pane, NARROW_COLUMNS);
    const earlier = rows.findIndex(isEarlierRow);
    expect(earlier, "an earlier row").toBeGreaterThanOrEqual(0);
    expect(headingWord(rows[earlier - 1] ?? "")).toBe("agent");
    expect(rows[earlier + 1], "the first kept message").toBe("message 189");
  });
  test("F1 expanded: after pressing the earlier row the Tools list shows all 30 calls and each one is a press target", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", toolOnlyMessages(MESSAGES_WITH_EARLIER));
    seedCalls(readCalls(EXPANDED_CALLS));
    const pane = await paneWithAgents(
      $,
      [agent({ id: "a", description: "alpha" })],
      COLUMNS,
      TALL_ROWS,
    );
    await openTranscript(pane, "alpha");

    await pressButton(pane, (await earlierLabels(pane))[0] ?? "");

    const labels = await buttonLabels(pane);
    const missing = readTargets().filter(
      (target) => !labels.some((label) => label.includes(target)),
    );
    expect(missing, "a press target for every call").toEqual([]);
    expect((await screenOf(pane, COLUMNS)).some(isEarlierRow)).toBe(false);
  });

  test("F1 folded with the newest message filling the pane: the newest call is still drawn and pressable", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [
      message("user", "go"),
      message("assistant", stepsText(FILLING_LINES)),
    ]);
    seedCalls(readCalls(EXPANDED_CALLS));
    const pane = await paneWithAgents(
      $,
      [agent({ id: "a", description: "alpha" })],
      COLUMNS,
      TALL_ROWS,
    );
    await openTranscript(pane, "alpha");

    await pressToolRow(pane, `call-${EXPANDED_CALLS - 1}.ts`);

    const opened = world.writes
      .filter((write) => write.key === "openCall")
      .map((write) => write.value);
    expect(opened.at(-1)).toBe(`a-read-${EXPANDED_CALLS - 1}`);
  });
  test("Z1 a folded transcript shows the prompt heading, its row, one blank row and the agent heading above the earlier row", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", manyMessages(MANY_MESSAGES));
    const pane = await paneWithAgents(
      $,
      [agent({ id: "a", description: "alpha" })],
      NARROW_COLUMNS,
    );
    await openTranscript(pane, "alpha");

    const rows = await screenOf(pane, NARROW_COLUMNS);
    const earlier = rows.findIndex(isEarlierRow);
    expect(earlier, "an earlier row").toBeGreaterThanOrEqual(0);
    expect(headingAt(rows, "prompt"), "the prompt heading four rows above the earlier row").toBe(
      earlier - 4,
    );
    expect(rows[earlier - 2], "a blank row below the prompt row").toBe("");
    expect(rows[earlier - 1] ?? "", "the agent heading above the earlier row").toMatch(
      /^agent ─+$/,
    );
  });

  test("Z1 a fold that hides agent messages puts the prompt heading four rows above the agent heading and the earlier row", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go"), ...toolOnlyMessages(MESSAGES_WITH_EARLIER)]);
    const pane = await paneWithAgents(
      $,
      [agent({ id: "a", description: "alpha" })],
      NARROW_COLUMNS,
    );
    await openTranscript(pane, "alpha");

    const rows = await screenOf(pane, NARROW_COLUMNS);
    const earlier = rows.findIndex(isEarlierRow);
    expect(earlier, "an earlier row").toBeGreaterThanOrEqual(0);
    expect(headingAt(rows, "prompt"), "the prompt heading four rows above the earlier row").toBe(
      earlier - 4,
    );
    expect(rows[earlier - 1] ?? "", "the agent heading above the earlier row").toMatch(
      /^agent ─+$/,
    );
  });
  test("H1 at 60 columns a done agent with a 30-path prompt and 60 calls shows one cut prompt row, then the agent heading, the earlier row counting the hidden agent rows, and the newest row", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [
      message("user", manyPathsPrompt()),
      ...toolOnlyMessages(AGENT_ROWS),
    ]);
    seedCalls(readCalls(AGENT_ROWS));
    const pane = await paneWithAgents(
      $,
      [agent({ id: "a", description: "alpha" })],
      NARROW_COLUMNS,
    );
    await openTranscript(pane, "alpha");

    const rows = await screenOf(pane, NARROW_COLUMNS);
    const prompt = headingAt(rows, "prompt");
    expect(rows[prompt + 1] ?? "", "one prompt row cut with an ellipsis").toMatch(/…$/);
    expect(rows[prompt + 2], "a blank row after the prompt row").toBe("");
    expect(rows[prompt + 3] ?? "", "the agent heading").toMatch(/^agent ─+$/);
    expect(rows[prompt + 4] ?? "", "the earlier row under the agent heading").toMatch(
      /^\[ \d+ earlier \]$/,
    );
    expect(
      rows.some((row) => row.includes(`file${AGENT_ROWS - 1}.ts`)),
      "the newest agent row on screen",
    ).toBe(true);
    const hidden = Number(/\d+/.exec(rows[prompt + 4] ?? "")?.[0]);
    const kept = rows.filter((row) => /Read: file\d+\.ts/.test(row)).length;
    expect(hidden + kept, "every agent row is either hidden or kept").toBe(AGENT_ROWS);
  });

  test("H2 at 60 columns a running agent with only its prompt cut shows no earlier row, and pressing the cut prompt row shows the whole prompt", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", manyPathsPrompt()), ...liveLog()]);
    const pane = await paneWithAgents($, [runningAgent("a", "alpha", true)], NARROW_COLUMNS);
    await openTranscript(pane, "alpha");

    const rows = await screenOf(pane, NARROW_COLUMNS);
    expect(rows.some(isEarlierRow), "no earlier row").toBe(false);
    expect(
      rows.some((row) => row.endsWith("…")),
      "a cut prompt row",
    ).toBe(true);

    await pressCutPrompt(pane);

    expect((await screenOf(pane, NARROW_COLUMNS)).join(" ")).toContain("module-1");
  });

  test("J3 at 60 columns pressing the expanded prompt folds it back to the one cut row", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", manyPathsPrompt()), ...liveLog()]);
    const pane = await paneWithAgents($, [runningAgent("a", "alpha", true)], NARROW_COLUMNS);
    await openTranscript(pane, "alpha");
    await pressCutPrompt(pane);

    await pressExpandedPrompt(pane);

    const rows = await screenOf(pane, NARROW_COLUMNS);
    expect(rows[headingAt(rows, "prompt") + 1] ?? "", "the cut prompt row").toMatch(/…$/);
    expect(rows.join(" ")).not.toContain("module-29");
  });

  test("K1 at 60 columns an expanded prompt of 30 long paths draws fewer than twice its own length in characters and pressing a row of it still folds it back", async ($, on) => {
    const world = worldOf(on);
    const prompt = manyPathsPrompt();
    world.transcripts.set("a", [message("user", prompt), ...liveLog()]);
    const pane = await paneWithAgents($, [runningAgent("a", "alpha", true)], NARROW_COLUMNS);
    await openTranscript(pane, "alpha");
    await pressCutPrompt(pane);

    const drawn = drawnCharacters(await pane.drawn());

    expect(drawn, "characters drawn for the expanded prompt").toBeLessThan(
      prompt.length * DRAWN_LIMIT_FACTOR,
    );
    await pressExpandedPrompt(pane);
    const rows = await screenOf(pane, NARROW_COLUMNS);
    expect(rows[headingAt(rows, "prompt") + 1] ?? "", "the cut prompt row").toMatch(/…$/);
  });

  test("J4 at 60 columns an expanded prompt that wraps continues 2 cells further in than its first row", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", manyPathsPrompt()), ...liveLog()]);
    const pane = await paneWithAgents($, [runningAgent("a", "alpha", true)], NARROW_COLUMNS);
    await openTranscript(pane, "alpha");
    await pressCutPrompt(pane);

    const rows = screenRows(await pane.drawn(), NARROW_COLUMNS);

    const start =
      headingAt(
        rows.map((row) => row.trim()),
        "prompt",
      ) + 1;
    const wrapped = rows.slice(start, start + HANGING_ROWS);
    const first = wrapped[0]?.search(/\S/) ?? -1;
    expect(first, "the first prompt row has text").toBeGreaterThanOrEqual(0);
    expect(wrapped.slice(1).map((row) => row.search(/\S/))).toEqual(
      Array(HANGING_ROWS - 1).fill(first + HANGING_INDENT),
    );
  });

  test("H3 at 60 columns a short prompt that fits is drawn whole, with no cut row", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go"), message("assistant", "ok")]);
    const pane = await paneWithAgents(
      $,
      [agent({ id: "a", description: "alpha" })],
      NARROW_COLUMNS,
    );
    await openTranscript(pane, "alpha");

    const rows = await screenOf(pane, NARROW_COLUMNS);
    expect(rows[headingAt(rows, "prompt") + 1], "the whole prompt").toBe("go");
    expect(
      rows.some((row) => row.endsWith("…")),
      "no cut row",
    ).toBe(false);
  });
});

describe("agent transcript tools", () => {
  test("T1 the Tools section lists this agent's calls in call order with their durations and no other agent's or the main session's calls", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go"), message("assistant", "on it")]);
    seedCalls([
      callRecord("a-read", "a", "Read", "alpha-read.ts", 2_000),
      callRecord("b-read", "b", "Read", "bravo-read.ts", 900),
      callRecord("a-bash", "a", "Bash", "echo alpha-bash", 340),
      callRecord("main-read", undefined, "Read", "main-read.ts", 1_500),
    ]);
    const pane = await paneWithAgents($, [
      agent({ id: "a", description: "alpha" }),
      agent({ id: "b", description: "bravo" }),
    ]);

    await openTranscript(pane, "alpha");

    const rows = await rowTexts(pane);
    const tools = rows.slice(rows.findIndex((row) => isHeading(row, "tools")) + 1);
    const at = (text: string): number => tools.findIndex((row) => row.includes(text));
    expect(rows.some((row) => isHeading(row, "tools"))).toBe(true);
    expect(at("alpha-read.ts")).toBeGreaterThanOrEqual(0);
    expect(at("alpha-read.ts")).toBeLessThan(at("echo alpha-bash"));
    expect(tools[at("alpha-read.ts")]).toContain("2s");
    expect(tools[at("echo alpha-bash")]).toContain("340ms");
    expect(tools.some((row) => row.includes("bravo-read.ts") || row.includes("main-read.ts"))).toBe(
      false,
    );
  });

  test("T2 pressing a Tools row opens that call in the Activity tab", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go")]);
    seedCalls([callRecord("a-read", "a", "Read", "alpha-read.ts", 2_000)]);
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);
    await openTranscript(pane, "alpha");

    await pressToolRow(pane, "alpha-read.ts");

    const opened = world.writes
      .filter((write) => write.key === "openCall")
      .map((write) => write.value);
    expect(opened.at(-1)).toBe("a-read");
    expect(await fillOfTab(pane, "Activity")).toBe(paneInk().tabFill);
  });

  test("T3 an agent with no tool calls shows no Tools section even while another agent has calls", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go"), message("assistant", "done")]);
    seedCalls([callRecord("b-read", "b", "Read", "bravo-read.ts", 900)]);
    const pane = await paneWithAgents($, [
      agent({ id: "a", description: "alpha" }),
      agent({ id: "b", description: "bravo" }),
    ]);

    await openTranscript(pane, "alpha");

    expect((await rowTexts(pane)).some((row) => isHeading(row, "tools"))).toBe(false);
  });

  test("P1 the Tools heading and its rows draw only in colours the pane already uses", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go")]);
    seedCalls([callRecord("a-read", "a", "Read", "alpha-read.ts", 2_000)]);
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);
    await openTranscript(pane, "alpha");

    const shown = (await pane.findAll({ type: "Text" })).filter((node) => {
      const text = textOf(node).trim();
      return text === "tools" || text.includes("alpha-read.ts");
    });
    const known = new Set<unknown>([
      ...Object.values(palette),
      ...Object.values(paneInk()).filter((value) => typeof value === "string"),
    ]);
    expect(shown.length).toBeGreaterThanOrEqual(2);
    expect(shown.every((node) => known.has(node.props.color))).toBe(true);
  });

  test("Y1 at 60 columns a finished agent with 40 tool calls shows its newest call and an earlier row counting the calls not drawn", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go"), message("assistant", "done")]);
    seedCalls(
      Array.from({ length: TOOL_CALLS }, (_, i) =>
        callRecord(`a-read-${i}`, "a", "Read", `call-${i}.ts`, 100),
      ),
    );
    const pane = await paneWithAgents(
      $,
      [agent({ id: "a", description: "alpha" })],
      NARROW_COLUMNS,
    );

    await openTranscript(pane, "alpha");

    const rows = await screenOf(pane, NARROW_COLUMNS);
    const drawn = rows.filter((row) => /Read: call-\d+\.ts/.test(row)).length;
    expect(rows.some((row) => row.includes(`Read: call-${TOOL_CALLS - 1}.ts`))).toBe(true);
    expect(rows.find(isEarlierRow)).toBe(`[ ${TOOL_CALLS - drawn} earlier ]`);
  });

  test("Y4 the Tools section heading is drawn like the prompt and agent headings", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go")]);
    seedCalls([callRecord("a-read", "a", "Read", "alpha-read.ts", 2_000)]);
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);
    await openTranscript(pane, "alpha");

    expect((await rowTexts(pane)).some((row) => isHeading(row, "tools"))).toBe(true);
  });

  test("Y6 a finished agent's final answer after its tool rows is set apart by one blank row", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [
      message("user", "go"),
      message("assistant", "", [
        { tool: "Read", input: { file_path: "/work/alpha-read.ts" } },
        { tool: "SubagentHandback", input: { message: "All done." } },
      ]),
    ]);
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);
    await openTranscript(pane, "alpha");

    const rows = await bodyRows(pane);
    const answer = rows.indexOf("All done.");
    expect(answer).toBeGreaterThan(0);
    expect(rows[answer - 1], "a blank row before the answer").toBe("");
    expect(rows[answer - 2]).toContain("alpha-read.ts");
  });
});

describe("agent transcript markdown and labels", () => {
  test("M1 an agent message with inline code shows the code without backticks in the code colour", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go"), message("assistant", "run `npm test` now")]);
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);

    await openTranscript(pane, "alpha");

    const rows = (await rowTexts(pane)).map((row) => row.trim());
    expect(rows).toContain("run npm test now");
    const code = (await pane.findAll({ type: "Text" })).find(
      (node) => textOf(node).trim() === "npm test",
    );
    expect(code?.props.color).toBe(fillsFor("dark").code);
  });

  test("M2 at 60 columns a prompt holding a long path in inline code wraps at a slash and no word breaks", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [
      message("user", `read \`${CODE_PATH}\` and answer`),
      message("assistant", "ok"),
    ]);
    const pane = await paneWithAgents(
      $,
      [agent({ id: "a", description: "alpha" })],
      NARROW_COLUMNS,
    );

    await openTranscript(pane, "alpha");

    const lines = promptRowsOf(await screenOf(pane, NARROW_COLUMNS)).map((row) =>
      row.replaceAll("`", ""),
    );
    expect(breaksAtSeparators(`read ${CODE_PATH} and answer`, lines)).toBe(true);
  });

  test("H1 at 60 columns the second row of a wrapped list item starts under the first character of its text", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [
      message("user", "go"),
      message("assistant", `- ${"listed word ".repeat(10)}end`),
    ]);
    const pane = await paneWithAgents(
      $,
      [agent({ id: "a", description: "alpha" })],
      NARROW_COLUMNS,
    );

    await openTranscript(pane, "alpha");

    const lines = screenRows(await pane.drawn(), NARROW_COLUMNS);
    const first = lines.findIndex((line) => line.includes("listed"));
    const second = lines[first + 1] ?? "";
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second.search(/\S/)).toBe(lines[first]?.indexOf("listed"));
  });

  test("L1 the prompt and agent labels are drawn as section headings in the pane's heading look", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go"), message("assistant", "on it")]);
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);

    await openTranscript(pane, "alpha");

    const texts = await pane.findAll({ type: "Text" });
    const look = paneHeaderLook();
    for (const label of ["prompt", "agent"]) {
      const at = texts.findIndex((node) => textOf(node).trim() === label);
      expect(at, `a ${label} label`).toBeGreaterThanOrEqual(0);
      expect(texts[at]?.props.weight).toBe("semibold");
      expect(texts[at]?.props.color).toBe(look.color);
      const rule = texts[at + 1];
      expect(rule?.props.color).toBe(look.ruleColor);
      expect(textOf(rule ?? { type: "Text" })).toMatch(new RegExp(`^ ${look.ruleChar}+$`));
    }
  });

  test("G1 the row under the back button is blank", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go"), message("assistant", "on it")]);
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);

    await openTranscript(pane, "alpha");

    const rows = await lines(pane);
    const back = rows.findIndex((line) => line.buttons.includes("back"));
    expect(back, "a row with the back button").toBeGreaterThanOrEqual(0);
    expect(rows[back + 1]?.text.trim()).toBe("");
  });
});

describe("agent transcript failures", () => {
  test("X1 at 60 columns a failed Read in the agent's log shows the failed mark in the failed colour on its row", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [
      message("user", "go"),
      toolUseMessage("a-read", "Read", "alpha-read.ts", { isError: true }),
    ]);
    seedCalls([{ ...callRecord("a-read", "a", "Read", "alpha-read.ts", 2_000), isErrored: true }]);
    const pane = await paneWithAgents(
      $,
      [agent({ id: "a", description: "alpha" })],
      NARROW_COLUMNS,
    );

    await openTranscript(pane, "alpha");

    const rows = await screenOf(pane, NARROW_COLUMNS);
    const logRow = rows.find((row) => row.includes("alpha-read.ts")) ?? "";
    expect(logRow).toContain("✗");
    expect(await colorOfGlyph(pane, "✗")).toBe(paneInk().failed);
  });

  test("X2 the failed call in the Tools list shows the failed mark", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go")]);
    seedCalls([{ ...callRecord("a-read", "a", "Read", "alpha-read.ts", 2_000), isErrored: true }]);
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);

    await openTranscript(pane, "alpha");

    const rows = await rowTexts(pane);
    expect(rows.some((row) => row.includes("alpha-read.ts") && row.includes("✗"))).toBe(true);
  });

  test("X3 a refused call shows the refused mark and no failed mark, and a successful call shows neither", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [
      message("user", "go"),
      toolUseMessage("refused-read", "Read", "refused-read.ts", { isError: true }),
      toolUseMessage("ok-read", "Read", "ok-read.ts", {}),
    ]);
    seedCalls([
      {
        ...callRecord("refused-read", "a", "Read", "refused-read.ts", 0),
        isErrored: true,
        permission: { kind: "denied", reason: "blocked by a hook" },
      },
      callRecord("ok-read", "a", "Read", "ok-read.ts", 900),
    ]);
    const pane = await paneWithAgents($, [agent({ id: "a", description: "alpha" })]);

    await openTranscript(pane, "alpha");

    const rows = await rowTexts(pane);
    const refused = rows.filter((row) => row.includes("refused-read.ts"));
    const ok = rows.filter((row) => row.includes("ok-read.ts"));
    expect(refused.length).toBeGreaterThan(0);
    expect(refused.every((row) => row.includes("⊘") && !row.includes("✗"))).toBe(true);
    expect(ok.length).toBeGreaterThan(0);
    expect(ok.every((row) => !row.includes("✗") && !row.includes("⊘"))).toBe(true);
  });

  test("Y2 ok, failed and refused tool rows carry their mark in one column, and the failed label is in the body text colour", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [
      message("user", "go"),
      toolUseMessage("ok-read", "Read", "ok-read.ts", {}),
      toolUseMessage("failed-read", "Read", "failed-read.ts", { isError: true }),
      toolUseMessage("refused-read", "Read", "refused-read.ts", { isError: true }),
    ]);
    seedCalls([
      callRecord("ok-read", "a", "Read", "ok-read.ts", 900),
      { ...callRecord("failed-read", "a", "Read", "failed-read.ts", 2_000), isErrored: true },
      {
        ...callRecord("refused-read", "a", "Read", "refused-read.ts", 0),
        isErrored: true,
        permission: { kind: "denied", reason: "blocked by a hook" },
      },
    ]);
    const pane = await paneWithAgents(
      $,
      [agent({ id: "a", description: "alpha" })],
      NARROW_COLUMNS,
    );
    await openTranscript(pane, "alpha");

    const labelled = screenRows(await pane.drawn(), NARROW_COLUMNS).filter((row) =>
      /Read: \w+-read\.ts/.test(row),
    );
    const marksOf = (name: string): string[] =>
      labelled.filter((row) => row.includes(name)).map(markBefore);
    expect(labelled).toHaveLength(6);
    expect(marksOf("ok-read.ts")).toEqual(["✓", "✓"]);
    expect(marksOf("failed-read.ts")).toEqual(["✗", "✗"]);
    expect(marksOf("refused-read.ts")).toEqual(["⊘", "⊘"]);
    expect(new Set(labelled.map((row) => row.indexOf("Read:"))).size).toBe(1);
    const failedLabels = (await pane.findAll({ type: "Text" })).filter((node) =>
      textOf(node).includes("failed-read.ts"),
    );
    expect(failedLabels.length).toBeGreaterThan(0);
    expect(failedLabels.every((node) => node.props.color === paneInk().text)).toBe(true);
  });
});

describe("agent stop", () => {
  test("S1 a running background agent's transcript has a stop button on the row with back", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go")]);
    const pane = await paneWithAgents($, [runningAgent("a", "alpha", true)]);

    await openTranscript(pane, "alpha");

    const header = (await lines(pane)).find((line) => line.buttons.includes("back"));
    expect(header?.buttons).toContain("stop");
  });

  test("S2 a running foreground agent's transcript has no stop button", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go")]);
    const pane = await paneWithAgents($, [runningAgent("a", "alpha", false)]);

    await openTranscript(pane, "alpha");

    expect(await buttonLabels(pane)).not.toContain("stop");
  });

  test("S3 a finished background agent's transcript has no stop button", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go")]);
    const pane = await paneWithAgents($, [
      agent({ id: "a", description: "alpha", background: true, status: "done" }),
    ]);

    await openTranscript(pane, "alpha");

    expect(await buttonLabels(pane)).not.toContain("stop");
  });

  test("S4 pressing stop asks Stop <title>? with the options Stop and Keep running and nothing is stopped before the answer", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go")]);
    world.answer = KEEP;
    const pane = await paneWithAgents($, [runningAgent("a", "alpha", true)]);
    await openTranscript(pane, "alpha");

    await pressButton(pane, "stop");

    expect(world.asked).toEqual([{ question: "Stop alpha?", options: [STOP, KEEP] }]);
    expect(world.stopCalls).toEqual([]);
  });

  test("S5 answering Stop ends the agent's background task by its id", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go")]);
    world.answer = STOP;
    const pane = await paneWithAgents($, [runningAgent("a", "alpha", true)]);
    await openTranscript(pane, "alpha");

    await pressButton(pane, "stop");

    expect(world.stopCalls).toEqual([{ tool: "TaskStop", task_id: "a" }]);
  });

  test("S6 answering Keep running stops nothing", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go")]);
    world.answer = KEEP;
    const pane = await paneWithAgents($, [runningAgent("a", "alpha", true)]);
    await openTranscript(pane, "alpha");

    await pressButton(pane, "stop");

    expect(world.stopCalls).toEqual([]);
    expect(world.toasts).toEqual([]);
  });

  test("S7 dismissing the question stops nothing, shows no message and keeps the transcript open", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go")]);
    world.answer = null;
    const pane = await paneWithAgents($, [runningAgent("a", "alpha", true)]);
    await openTranscript(pane, "alpha");

    await pressButton(pane, "stop");

    expect(world.stopCalls).toEqual([]);
    expect(world.toasts).toEqual([]);
    expect(await buttonLabels(pane)).toContain("back");
  });

  test("S8 when the engine refuses to stop the agent a toast tells the reason", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go")]);
    world.answer = STOP;
    world.stopFailure = "task already finished";
    const pane = await paneWithAgents($, [runningAgent("a", "alpha", true)]);
    await openTranscript(pane, "alpha");

    await pressButton(pane, "stop");

    expect(world.toasts).toHaveLength(1);
    expect(world.toasts[0]).toContain("task already finished");
  });
});

describe("agent transcript token label fit", () => {
  test("G1 at 60 columns a folded finished agent with tokens fills the pane height exactly and its newest Tools row is the last row drawn", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", manyMessages(MANY_MESSAGES));
    seedCalls(readCalls(TOOL_CALLS));
    const pane = await paneWithAgents($, [withTokens("a")], NARROW_COLUMNS);

    await openTranscript(pane, "alpha");

    const rows = await screenOf(pane, NARROW_COLUMNS);
    expect(rows.filter((row) => row.includes(TOKENS_BILLED_LABEL))).toHaveLength(1);
    expect(rows).toHaveLength(ROWS);
    expect(rows.at(-1)).toContain(`call-${TOOL_CALLS - 1}.ts`);
  });

  test("G1 at 120 columns a folded finished agent with tokens fills the pane height exactly and its newest Tools row is the last row drawn", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", manyMessages(MANY_MESSAGES));
    seedCalls(readCalls(TOOL_CALLS));
    const pane = await paneWithAgents($, [withTokens("a")], WIDE_COLUMNS);

    await openTranscript(pane, "alpha");

    const rows = await screenOf(pane, WIDE_COLUMNS);
    expect(rows.filter((row) => row.includes(TOKENS_BILLED_LABEL))).toHaveLength(1);
    expect(rows).toHaveLength(ROWS);
    expect(rows.at(-1)).toContain(`call-${TOOL_CALLS - 1}.ts`);
  });

  test("W7 at 60 columns the open view runs header, one blank row, the label line, one blank row, then the body, and the newest Tools row is the pane's last row", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", manyMessages(MANY_MESSAGES));
    seedCalls(readCalls(TOOL_CALLS));
    const pane = await paneWithAgents($, [withTokens("a")], NARROW_COLUMNS);

    await openTranscript(pane, "alpha");

    const rows = await screenOf(pane, NARROW_COLUMNS);
    const back = rows.findIndex((row) => row.startsWith("[ back ]"));
    expect(back).toBeGreaterThanOrEqual(0);
    expect(rows[back + 1]).toBe("");
    expect(rows[back + 2]).toContain(TOKENS_BILLED_LABEL);
    expect(rows[back + 3]).toBe("");
    expect(rows[back + 4]).toMatch(/^prompt ─+$/);
    expect(rows).toHaveLength(ROWS);
    expect(rows.at(-1)).toContain(`call-${TOOL_CALLS - 1}.ts`);
  });

  test("J2 at 60 columns the label line is followed by one blank row, then the prompt heading", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go"), message("assistant", "ok")]);
    const pane = await paneWithAgents($, [withTokens("a")], NARROW_COLUMNS);

    await openTranscript(pane, "alpha");

    const rows = await screenOf(pane, NARROW_COLUMNS);
    const label = rows.findIndex((row) => row.includes(TOKENS_BILLED_LABEL));
    expect(label).toBeGreaterThanOrEqual(0);
    expect(rows[label + 1]).toBe("");
    expect(rows[label + 2]).toMatch(/^prompt ─+$/);
  });

  test("J2 at 60 columns with no label line exactly one blank row sits between the back row and the prompt heading", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", [message("user", "go"), message("assistant", "ok")]);
    const pane = await paneWithAgents(
      $,
      [agent({ id: "a", description: "alpha" })],
      NARROW_COLUMNS,
    );

    await openTranscript(pane, "alpha");

    const rows = await screenOf(pane, NARROW_COLUMNS);
    const back = rows.findIndex((row) => row.startsWith("[ back ]"));
    expect(rows[back + 1]).toBe("");
    expect(rows[back + 2]).toMatch(/^prompt ─+$/);
  });

  test("G2 at 60 columns the same agent with no token figure draws no label line and the body fills the pane height with the row back", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.set("a", manyMessages(MANY_MESSAGES));
    seedCalls(readCalls(TOOL_CALLS));
    const pane = await paneWithAgents(
      $,
      [agent({ id: "a", description: "alpha" })],
      NARROW_COLUMNS,
    );

    await openTranscript(pane, "alpha");

    const rows = await screenOf(pane, NARROW_COLUMNS);
    expect(rows.some((row) => row.includes(TOKENS_BILLED_LABEL))).toBe(false);
    expect(rows).toHaveLength(ROWS);
    expect(rows.at(-1)).toContain(`call-${TOOL_CALLS - 1}.ts`);
  });
});

function worldOf(on: On): World {
  store.clear();
  const world: World = {
    clock: mock.clock(on, { now: NOW }),
    transcripts: new Map(),
    asked: [],
    answer: KEEP,
    stopCalls: [],
    stopFailure: null,
    toasts: [],
    writes: [],
  };
  mock.env(on, { HOME: "/h/u" });
  on("state.get", (_$, e, next) => {
    const seeded = store.get(e.key);
    return seeded ? { value: seeded } : next(e);
  });
  on("state.set", (_$, e, next) => {
    world.writes.push({ key: e.key, value: e.value });
    store.delete(e.key);
    return next(e);
  });
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: "/work" }));
  on("agent.list", () => ({ value: [] }));
  on("session.messages", (_$, e) => {
    const found = world.transcripts.get(String((e as { agentId?: string }).agentId));
    return { value: found ?? { deny: "unknown agent" } };
  });
  on("tool.call", (_$, e) => answerTool(world, e as unknown as ToolCall));
  on("ui.toast", (_$, e) => {
    world.toasts.push(e.text);
    return { value: undefined };
  });
  on("ui.render", { component: "Pane" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine pane</Text>;
  });
  return world;
}

type ToolCall = {
  tool: string;
  task_id?: string;
  questions?: { question: string; options: { label: string }[] }[];
};

function answerTool(world: World, call: ToolCall): never {
  if (call.tool === "AskUserQuestion") {
    const [asked] = call.questions ?? [];
    world.asked.push({
      question: asked?.question ?? "",
      options: (asked?.options ?? []).map((option) => option.label),
    });
    if (world.answer === null) return { deny: "dismissed" } as never;
    return {
      result: { questions: call.questions, answers: { [asked?.question ?? ""]: world.answer } },
      text: world.answer,
    } as never;
  }
  if (call.tool === "TaskStop") {
    world.stopCalls.push({ tool: call.tool, task_id: call.task_id });
    if (world.stopFailure !== null)
      return { isError: true, result: world.stopFailure, text: world.stopFailure } as never;
  }
  return { result: "ok", text: "ok" } as never;
}

function message(
  role: "user" | "assistant",
  text: string,
  uses: { tool: string; input: Record<string, unknown> }[] = [],
): SessionMessage {
  return {
    role,
    text,
    toolUses: uses.map((use, i) => ({ tool_use_id: `use-${i}`, ...use })),
  };
}

function toolOnlyMessages(count: number): SessionMessage[] {
  return Array.from({ length: count }, (_, i) =>
    message("assistant", "", [{ tool: "Read", input: { file_path: `/work/file${i}.ts` } }]),
  );
}

function readCalls(count: number): CallRecord[] {
  return Array.from({ length: count }, (_, i) =>
    callRecord(`a-read-${i}`, "a", "Read", `call-${i}.ts`, 100),
  );
}
function readTargets(): string[] {
  return Array.from({ length: EXPANDED_CALLS }, (_, i) => `call-${i}.ts`);
}
function stepsText(count: number): string {
  return Array.from({ length: count }, (_, i) => `step ${i + 1} done`).join("\n");
}
function manyMessages(count: number): SessionMessage[] {
  return Array.from({ length: count }, (_, i) =>
    message(i % 2 === 0 ? "user" : "assistant", `message ${i}`),
  );
}

function mixedMessages(drawnTotal: number): SessionMessage[] {
  return Array.from({ length: drawnTotal }, (_, i) => [
    message(i % 2 === 0 ? "user" : "assistant", `message ${i}`),
    message("user", ""),
    message("assistant", ""),
  ]).flat();
}

function agent(fields: Partial<Fixture> & { id: string }): Fixture {
  return {
    type: "general-purpose",
    description: fields.id,
    background: false,
    model: "",
    status: "done",
    startedAt: NOW - 10_000,
    ctxTokens: 0,
    running: [],
    ...fields,
  };
}

function withTokens(id: string): Fixture {
  return agent({ id, description: "alpha", spent: { input: 20_000, output: 2_000 } });
}

function runningAgent(id: string, description: string, background: boolean): Fixture {
  return agent({ id, description, background, status: "running", startedAt: NOW - 5_000 });
}

async function writeAgents(agents: Fixture[]): Promise<void> {
  const nodes = agents.map(({ spent: _spent, ...node }): AgentNode => node);
  const value = Object.fromEntries(nodes.map((one) => [one.id, one]));
  store.set("agents", { value, version: (store.get("agents")?.version ?? 0) + 1 });
  const seed = seedOf(
    agents.flatMap(({ id, type, spent }) =>
      spent === undefined ? [] : [pricedSpent(id, type, spent)],
    ),
  );
  store.set("spend", { value: seed.spend, version: 1 });
  store.set("sessionUsd", { value: seed.sessionUsd, version: 1 });
}

async function paneWithAgents(
  $: Engine,
  agents: Fixture[],
  columns = COLUMNS,
  rows = ROWS,
): Promise<Pane> {
  await writeAgents(agents);
  const pane = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: "session",
    props: {
      title: "Session",
      isFocused: false,
      bodyColumns: columns,
      placement: "dock",
      scroll: { offset: 0, bodyRows: rows },
      view: {},
    },
    viewport: { columns, rows },
  });
  await pressButton(pane, "Agents");
  return pane;
}

async function openTranscript(pane: Pane, title: string): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const target = buttons.find((button) => String(button.props.label).includes(title));
  expect(target, `a title button for ${title}`).toBeDefined();
  await pane.press({ key: target?.key ?? "" });
  await settle(pane);
}

async function pressButton(pane: Pane, label: string): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const target = buttons.find((button) => button.props.label === label);
  expect(target, `a ${label} button`).toBeDefined();
  await pane.press({ key: target?.key ?? "" });
  await settle(pane);
}

async function pressCutPrompt(pane: Pane): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const target = buttons.find((button) => String(button.props.label).endsWith("…"));
  expect(target, "a cut prompt button").toBeDefined();
  await pane.press({ key: target?.key ?? "" });
  await settle(pane);
}
function drawnCharacters(tree: Node): number {
  const texts = collect(tree, "Text").map((node) => textOf(node).length);
  const buttons = collect(tree, "Button");
  const labels = buttons.map(
    (node) => (typeof node.props?.label === "string" ? node.props.label : "").length,
  );
  const insideButtons = buttons.map((node) => textOf(node).length);
  return sum(texts) + sum(labels) - sum(insideButtons);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

async function pressExpandedPrompt(pane: Pane): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const target = buttons.find((button) => String(button.props.label).includes("module-0"));
  expect(target, "a press target on the expanded prompt").toBeDefined();
  await pane.press({ key: target?.key ?? "" });
  await settle(pane);
}

async function earlierLabels(pane: Pane): Promise<string[]> {
  return (await buttonLabels(pane)).filter((label) => /^\d+ earlier$/.test(label));
}

async function settle(pane: Pane): Promise<void> {
  for (let tick = 0; tick < SETTLE_TICKS; tick++) await pane.redraw();
}

async function buttonLabels(pane: Pane): Promise<string[]> {
  return (await pane.findAll({ type: "Button" })).map((button) => String(button.props.label));
}

async function screenBody(pane: Pane): Promise<string[]> {
  const rows = await screenOf(pane, COLUMNS);
  const body = rows.slice(rows.findIndex((row) => row.startsWith("[ back ]")) + 1);
  let end = body.length;
  while (end > 0 && body[end - 1] === "") end -= 1;
  return body.slice(0, end);
}

async function bodyRows(pane: Pane): Promise<string[]> {
  const drawn = await lines(pane);
  const header = drawn.findIndex((line) => line.buttons.includes("back"));
  return drawn.slice(header + 1).map((line) => line.text.trim());
}

async function rowTexts(pane: Pane): Promise<string[]> {
  return (await lines(pane)).map((line) => line.text).filter((text) => text !== "");
}

async function colorOfText(pane: Pane, text: string): Promise<unknown> {
  const found = (await pane.findAll({ type: "Text" })).find((node) => textOf(node).trim() === text);
  return found?.props.color;
}

async function colorOfOwnText(pane: Pane, text: string): Promise<unknown> {
  const found = (await pane.findAll({ type: "Text" })).find((node) => ownText(node).includes(text));
  return found?.props.color;
}

function ownText(node: Node): string {
  const raw = Array.isArray(node.children) ? node.children.flat(Infinity) : [node.children];
  return raw.filter((child) => typeof child === "string").join("");
}

type Line = { text: string; buttons: string[] };

async function lines(pane: Pane): Promise<Line[]> {
  return linesOf(await pane.drawn());
}

function linesOf(node: Node): Line[] {
  if (node.type === "Text") return [lineOf(node)];
  if (isRow(node) && !holdsColumn(node)) return [lineOf(node)];
  return childNodes(node).flatMap(linesOf);
}

function lineOf(node: Node): Line {
  return {
    text: textOf(node),
    buttons: collect(node, "Button").map((button) => String(button.props?.label)),
  };
}

function isRow(node: Node): boolean {
  return (
    node.type === "Box" && !["column", "column-reverse"].includes(String(node.props?.flexDirection))
  );
}

function holdsColumn(node: Node): boolean {
  return childNodes(node).some(
    (child) => (child.type === "Box" && !isRow(child)) || holdsColumn(child),
  );
}

function childNodes(node: Node): Node[] {
  const raw = Array.isArray(node.children) ? node.children.flat(Infinity) : [node.children];
  return raw.filter((child): child is Node => typeof child === "object" && child !== null);
}

function seedCalls(records: CallRecord[]): void {
  store.set("calls", { value: { shape: "calls-slim", value: records }, version: 1 });
}

function callRecord(
  id: string,
  agentId: string | undefined,
  tool: string,
  target: string,
  ms: number,
): CallRecord {
  return { id, tool, target, ms, isErrored: false, added: 0, removed: 0, agentId };
}

function manyPathsPrompt(): string {
  return Array.from(
    { length: PATHS_IN_PROMPT },
    (_, i) => `${NESTED_FOLDER}/module-${i}/nested-folder/deeper-nested-folder/file-${i}.ts`,
  ).join(" ");
}

function liveLog(): SessionMessage[] {
  return Array.from({ length: 4 }, (_, i) => message("assistant", `live log ${i + 1}`));
}

async function screenOf(pane: Pane, columns: number): Promise<string[]> {
  return screenRows(await pane.drawn(), columns).map((row) => row.trim());
}

function toolUseMessage(
  id: string,
  tool: string,
  file: string,
  outcome: { isError?: true },
): SessionMessage {
  return {
    role: "assistant",
    text: "",
    toolUses: [{ tool_use_id: id, tool, input: { file_path: `/work/${file}` }, ...outcome }],
  };
}

async function colorOfGlyph(pane: Pane, glyph: string): Promise<unknown> {
  const found = (await pane.findAll({ type: "Text" })).find((node) => textOf(node).includes(glyph));
  return found?.props.color;
}

function isHeading(row: string, role: string): boolean {
  return new RegExp(`^${role} ─+$`).test(row.trim());
}

function headingAt(rows: string[], role: string): number {
  return rows.findIndex((row) => isHeading(row, role));
}

function headingWord(row: string): string {
  return HEADING.exec(row)?.[1] ?? row;
}

function promptRowsOf(rows: string[]): string[] {
  const body = rows.slice(headingAt(rows, "prompt") + 1);
  const end = body.indexOf("");
  return end < 0 ? body : body.slice(0, end);
}

function breaksAtSeparators(text: string, lines: string[]): boolean {
  let at = 0;
  for (const [i, line] of lines.entries()) {
    if (!text.startsWith(line, at)) return false;
    at += line.length;
    if (i === lines.length - 1) return at === text.length;
    if (line.endsWith("/")) continue;
    if (text[at] !== " ") return false;
    at += 1;
  }
  return false;
}

function markBefore(row: string): string {
  return row.slice(0, row.indexOf("Read:")).trim();
}

function isEarlierRow(row: string): boolean {
  return /^\[ \d+ earlier \]$/.test(row);
}

async function pressToolRow(pane: Pane, target: string): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const found = buttons.find((button) => String(button.props.label).includes(target));
  expect(found, `a Tools row button for ${target}`).toBeDefined();
  await pane.press({ key: found?.key ?? "" });
  await settle(pane);
}

async function fillOfTab(pane: Pane, label: string): Promise<unknown> {
  const found = (await pane.findAll({ type: "Text" })).find(
    (node) => textOf(node).trim() === label,
  );
  return found?.props.backgroundColor;
}
