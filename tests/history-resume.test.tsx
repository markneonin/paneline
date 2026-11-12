import { describe, expect, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

import { paneInk } from "../hooks/pane-ink";
import { shownTexts } from "./skills-tree";
import { openPane, settle } from "./spend-world";
import type { Pane } from "./spend-world";
import { appendMessage, historyWorldOf, startFreshSession } from "./history-transcript";
import type { HistoryWorld } from "./history-transcript";

const NARROW = 60;
const WIDE = 100;
const MAX_TAB_PRESSES = 12;
const SAME_ID = "11111111-aaaa-4aaa-8aaa-111111111111";
const OTHER_ID = "22222222-bbbb-4bbb-8bbb-222222222222";
const OTHER_CWD = "/home/dev/projects/IT/a-rather-long-project-name/sub-folder";
const OTHER_COMMAND = `cd ${OTHER_CWD} && claude --resume ${OTHER_ID}`;
const LONG_CWD = `/private/tmp/claude-502/-home-dev-projects-IT-demo-app/${"scratchpad/".repeat(5)}history`;
const SPACED_CWD = "/Users/a/My Projects/x";
const SPACED_COMMAND = `cd '${SPACED_CWD}' && claude --resume ${OTHER_ID}`;
let refuseCopy = false;
const SAME_LINE = "fix the spinner glyph";
const OTHER_LINE = "spinner in the other project";

type Run = { command: string; args: string };

describe("resuming a past session from its row", () => {
  test("R1 clicking a past row of this project fills it like a selected prompt row and draws resume under it", async ($, on) => {
    const { pane } = await pastPane($, on, [samePrompt()]);
    expect(await fillOf(pane, SAME_LINE)).toBeUndefined();

    await pressRow(pane, SAME_LINE);

    expect(await fillOf(pane, SAME_LINE)).toBe(paneInk().tabFill);
    expect(await resumeButtons(pane)).toHaveLength(1);
  });

  test("R2 pressing resume asks Claude Code once to resume that session", async ($, on) => {
    const { pane, world, runs } = await pastPane($, on, [samePrompt()]);
    await pressRow(pane, SAME_LINE);

    await pane.press({ key: String((await resumeButtons(pane))[0]?.key) });
    await world.clock.advance(1000);
    await settle(pane);

    expect(runs).toEqual([{ command: "resume", args: SAME_ID }]);
  });

  test("R3 a past row of another project shows no resume button, a copy resume command button and one muted row with the command that fits 60 columns", async ($, on) => {
    const { pane } = await pastPane($, on, [otherPrompt()], NARROW);

    await pressRow(pane, OTHER_LINE);

    expect(await resumeButtons(pane)).toEqual([]);
    expect(await copyButtons(pane)).toHaveLength(1);
    const rows = await rowsBelow(pane, OTHER_LINE);
    const commandRow = rows.find((row) => row.startsWith("cd "));
    expect(commandRow?.length).toBeLessThanOrEqual(NARROW);
    const pieces = await pane.findAll({ type: "Text", text: /^cd / });
    expect(pieces).toHaveLength(1);
    expect(pieces[0]?.props.color).toBe(paneInk().muted);
  });

  test("R9 at 70 columns a long folder is cut inside its path and the muted command row still ends with && claude --resume and the id", async ($, on) => {
    const { pane } = await pastPane($, on, [longCwdPrompt()], 70);
    await pressRow(pane, OTHER_LINE);

    const commandRow = (await rowsBelow(pane, OTHER_LINE)).find((row) => row.startsWith("cd "));

    expect(commandRow).toMatch(new RegExp(` && claude --resume ${OTHER_ID}$`));
    expect(commandRow).toContain("…");
    expect(commandRow?.length).toBeLessThanOrEqual(70);
  });

  test("R9b at 120 columns a long folder is cut inside its path and the muted command row still ends with && claude --resume and the id", async ($, on) => {
    const { pane } = await pastPane($, on, [longCwdPrompt()], 120);
    await pressRow(pane, OTHER_LINE);

    const commandRow = (await rowsBelow(pane, OTHER_LINE)).find((row) => row.startsWith("cd "));

    expect(commandRow).toMatch(new RegExp(` && claude --resume ${OTHER_ID}$`));
    expect(commandRow).toContain("…");
    expect(commandRow?.length).toBeLessThanOrEqual(120);
  });

  test("R10 a short folder shows the whole command uncut", async ($, on) => {
    const short = await pastPane(
      $,
      on,
      [pastLine(OTHER_LINE, { sessionId: OTHER_ID, cwd: "/work/x" })],
      120,
    );
    await pressRow(short.pane, OTHER_LINE);

    const rows = await rowsBelow(short.pane, OTHER_LINE);

    expect(rows).toContain(`cd /work/x && claude --resume ${OTHER_ID}`);
  });

  test("R6 when the host refuses the resume the pane keeps drawing and a toast names the failure", async ($, on) => {
    const { pane, world } = await pastPane(
      $,
      on,
      [samePrompt()],
      WIDE,
      "refused: a turn is running",
    );
    await pressRow(pane, SAME_LINE);

    await pane.press({ key: String((await resumeButtons(pane))[0]?.key) });
    await world.clock.advance(1000);
    await settle(pane);

    expect(world.spawning.toasts).toHaveLength(1);
    expect(world.spawning.toasts[0]).toMatch(/^Could not resume the session: /);
    expect(await resumeButtons(pane)).toHaveLength(1);
  });

  test("R7 a past row whose project path has a space copies the path in single quotes", async ($, on) => {
    const { pane, copied } = await pastPane(
      $,
      on,
      [pastLine(OTHER_LINE, { sessionId: OTHER_ID, cwd: SPACED_CWD })],
      NARROW,
    );

    await pressRow(pane, OTHER_LINE);
    await pane.press({ key: String((await copyButtons(pane))[0]?.key) });
    await settle(pane);

    expect(copied).toEqual([SPACED_COMMAND]);
  });

  test("R8 pressing copy resume command copies exactly the command and toasts that it was copied, or that it could not", async ($, on) => {
    const { pane, world, copied } = await pastPane($, on, [otherPrompt()], NARROW);
    await pressRow(pane, OTHER_LINE);

    await pane.press({ key: String((await copyButtons(pane))[0]?.key) });
    await settle(pane);

    expect(copied).toEqual([OTHER_COMMAND]);
    expect(world.spawning.toasts).toEqual(["Resume command copied"]);

    copied.length = 0;
    world.spawning.toasts.length = 0;
    refuseCopy = true;
    await pane.press({ key: String((await copyButtons(pane))[0]?.key) });
    await settle(pane);

    expect(world.spawning.toasts).toEqual(["Could not copy the resume command"]);
  });

  test("R4 clicking the selected past row again clears its fill and its action row", async ($, on) => {
    const { pane } = await pastPane($, on, [samePrompt()]);
    await pressRow(pane, SAME_LINE);

    await pressRow(pane, SAME_LINE);

    expect(await fillOf(pane, SAME_LINE)).toBeUndefined();
    expect(await resumeButtons(pane)).toEqual([]);
  });

  test("R5 selecting a prompt row clears a selected past row and selecting a past row clears a selected prompt row", async ($, on) => {
    const { pane } = await pastPane($, on, [samePrompt()]);
    await pressRow(pane, SAME_LINE);

    await pressRow(pane, "spinner today");

    expect(await fillOf(pane, "spinner today")).toBe(paneInk().tabFill);
    expect(await fillOf(pane, SAME_LINE)).toBeUndefined();
    expect(await resumeButtons(pane)).toEqual([]);

    await pressRow(pane, SAME_LINE);

    expect(await fillOf(pane, SAME_LINE)).toBe(paneInk().tabFill);
    expect(await fillOf(pane, "spinner today")).toBeUndefined();
  });
});

function samePrompt(): string {
  return pastLine(SAME_LINE, { sessionId: SAME_ID, cwd: "/work" });
}

function longCwdPrompt(): string {
  return pastLine(OTHER_LINE, { sessionId: OTHER_ID, cwd: LONG_CWD });
}

function otherPrompt(): string {
  return pastLine(OTHER_LINE, { sessionId: OTHER_ID, cwd: OTHER_CWD });
}

function pastLine(text: string, extra: object): string {
  return `${JSON.stringify({
    type: "user",
    timestamp: "2026-10-21T10:00:00.000Z",
    gitBranch: "main",
    cwd: "/work",
    message: { role: "user", content: text },
    ...extra,
  })}\n`;
}

async function pastPane(
  $: Engine,
  on: On,
  lines: string[],
  columns: number = WIDE,
  refusal?: string,
): Promise<{ pane: Pane; world: HistoryWorld; runs: Run[]; copied: string[] }> {
  const world = historyWorldOf(on, true);
  const runs: Run[] = [];
  const copied: string[] = [];
  refuseCopy = false;
  on("ui.copy", (_$, e) => {
    copied.push(e.text);
    return refuseCopy
      ? { value: { isCopied: false, reason: "refused" } }
      : { value: { isCopied: true } };
  });
  on("command.run", (_$, e) => {
    runs.push({ command: e.command, args: e.args });
    if (refusal !== undefined) throw new Error(refusal);
    return {};
  });
  world.spawning.searches = { spinner: lines };
  const pane = await openPane($, columns);
  await startFreshSession($, world);
  await appendMessage($, world, {
    door: "prompt",
    id: "p1",
    text: "spinner today",
  });
  await showHistory(pane);
  await pane.input({ key: "filter", text: "spinner", kind: "change" });
  await settle(pane);
  return { pane, world, runs, copied };
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

async function pressRow(pane: Pane, line: string): Promise<void> {
  const row = (await pane.findAll({ type: "Button" })).find((button) =>
    String(button.props.label).includes(line),
  );
  expect(row, `a Button whose label holds "${line}"`).toBeDefined();
  await pane.press({ key: String(row?.key) });
  await settle(pane);
}

async function resumeButtons(pane: Pane) {
  return (await pane.findAll({ type: "Button" })).filter(
    (button) => String(button.props.label).trim() === "resume",
  );
}

async function copyButtons(pane: Pane) {
  return (await pane.findAll({ type: "Button" })).filter(
    (button) => String(button.props.label).trim() === "copy resume command",
  );
}

async function fillOf(pane: Pane, line: string): Promise<unknown> {
  const texts = await pane.findAll({ type: "Text", text: new RegExp(line) });
  return texts.map((text) => text.props.backgroundColor).find((color) => color !== undefined);
}

async function bodyTexts(pane: Pane): Promise<string[]> {
  return shownTexts(await pane.drawn());
}

async function rowsBelow(pane: Pane, line: string): Promise<string[]> {
  const texts = await bodyTexts(pane);
  return texts.slice(texts.findIndex((text) => text.includes(line)) + 1);
}
