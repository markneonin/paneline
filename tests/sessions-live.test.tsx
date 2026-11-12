import { describe, expect, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

import { palette } from "../hooks/palette";
import type { AgentStatus, SessionRow } from "../types";
import { colouredPieces, screenRows } from "./band-screen";
import {
  CLOCK_START,
  HOME,
  OWN_SESSION,
  WORK,
  begin,
  enterSessions,
  fillerOfBytes,
  lastPromptLine,
  putRegistry,
  toolResultLine,
  toolUseLine,
  transcriptOf,
  transcriptPathOf,
} from "./sessions-world";
import type { Pane, World } from "./sessions-world";

type Cell = { ch: string; color: unknown };

const NARROW = 60;
const WIDE = 120;
const MINUTE_MS = 60_000;
const SECOND_MS = 1000;
const POLL_MS = 2000;
const SYNC_GAP_MS = 1000;
const PROMPT_CHARS = 40;
const SHOWN_CHARS = PROMPT_CHARS - 1;
const REGISTRY_STAMP = 777_000;
const LONG_TOOL = "mcp__paneline__progress";
const FIRST_PROMPT = "refactor the billing module and write tests for every invoice rule";
const SECOND_PROMPT = "explain why the nightly export job is slower on mondays than on fridays";
const MAIN = "main";
const LONG_TURN_BYTES = 400_000;
const OVER_STDOUT_LIMIT_BYTES = 4_600_000;
const SHORTER_BYTES = 50_000;
const SMALL_READ_BYTES = 4096;
const TURN_MS = 20_000;
const CHINESE_PROMPT = "\u6F22".repeat(30);
const FAMILY_EMOJI = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
const GUTTER_CELLS = 1;

describe("sessions live state", () => {
  test("L1 a waiting row whose state is 3 minutes old draws ! waiting 3m with the glyph and the word in alert and the age in muted", async ($, on) => {
    const world = await begin($, on, [
      rowOf(1, "alpha", "waiting", { since: CLOCK_START - 3 * MINUTE_MS }),
    ]);

    const pane = await enterSessions($, world);

    const [row] = await bodyRows(pane, NARROW);
    expect(row).toMatch(/^! waiting +3m +alpha/u);
    const cells = await bodyCellsOf(pane);
    expect(colourOf(cells, "!")).toEqual([palette.alert]);
    expect(colourOf(cells, "waiting")).toEqual(Array("waiting".length).fill(palette.alert));
    expect(colourOf(cells, "3m")).toEqual([palette.muted, palette.muted]);
  });

  test("L2 an idle row whose state is 12 minutes old draws ○ idle 12m", async ($, on) => {
    const world = await begin($, on, [
      rowOf(1, "alpha", "idle", { since: CLOCK_START - 12 * MINUTE_MS }),
    ]);

    const pane = await enterSessions($, world);

    const [row] = await bodyRows(pane, NARROW);
    expect(row).toMatch(/^○ idle +12m +alpha/u);
  });

  test("L3 a busy row whose last tool call is unanswered draws working with the tool name and its age, and thinking with the age of its state once the tool is answered", async ($, on) => {
    const pending = rowOf(1, "alpha", "running", { since: CLOCK_START - 60 * SECOND_MS });
    const answered = rowOf(2, "gamma", "running", { since: CLOCK_START - 60 * SECOND_MS });
    const world = await begin($, on, [pending, answered]);
    world.setTranscript(
      transcriptPathOf(pending),
      transcriptOf({
        prompt: "go",
        pendingTool: { name: "Bash", at: CLOCK_START - 4 * SECOND_MS },
      }),
    );
    world.setTranscript(
      transcriptPathOf(answered),
      transcriptOf({
        prompt: "go",
        answeredTool: { name: "Bash", at: CLOCK_START - 4 * SECOND_MS },
      }),
    );

    const pane = await enterSessions($, world, WIDE);

    const [first = "", second = ""] = await bodyRows(pane, WIDE);
    expect(first).toMatch(/^● working Bash +4s +alpha/u);
    expect(second).toMatch(/^● thinking +1m +gamma/u);
  });

  test("L4 at 120 columns two rows with the same folder and branch show different muted prompts of at most 40 characters", async ($, on) => {
    const world = await twoRowsWithPrompts($, on);

    const wide = await enterSessions($, world, WIDE);
    const [firstRow = "", secondRow = ""] = await bodyRows(wide, WIDE);
    const wideCells = await bodyCellsOf(wide);

    expect(firstRow).toContain(FIRST_PROMPT.slice(0, SHOWN_CHARS));
    expect(firstRow).not.toContain(FIRST_PROMPT.slice(0, PROMPT_CHARS + 1));
    expect(secondRow).toContain(SECOND_PROMPT.slice(0, SHOWN_CHARS));
    expect(secondRow).not.toContain(SECOND_PROMPT.slice(0, PROMPT_CHARS + 1));
    expect(colourOf(wideCells, FIRST_PROMPT.slice(0, SHOWN_CHARS))).toEqual(
      Array(SHOWN_CHARS).fill(palette.muted),
    );
  });

  test("L4b at 60 columns the same two rows show no prompt text", async ($, on) => {
    const world = await twoRowsWithPrompts($, on);

    const narrow = await enterSessions($, world, NARROW);
    const narrowRows = (await bodyRows(narrow, NARROW)).join("\n");
    expect(narrowRows).not.toContain(FIRST_PROMPT.slice(0, "refactor".length));
    expect(narrowRows).not.toContain(SECOND_PROMPT.slice(0, "explain".length));
  });

  test("L5 a row whose transcript does not exist draws its state text and an empty prompt cell beside a row that has a prompt", async ($, on) => {
    const known = rowOf(1, "alpha", "idle");
    const unknown = rowOf(2, "gamma", "idle");
    const world = await begin($, on, [known, unknown]);
    world.setTranscript(transcriptPathOf(known), transcriptOf({ prompt: FIRST_PROMPT }));

    const pane = await enterSessions($, world, WIDE);

    const [knownRow = "", unknownRow = ""] = await bodyRows(pane, WIDE);
    expect(knownRow).toContain(FIRST_PROMPT.slice(0, SHOWN_CHARS));
    expect(unknownRow).toMatch(/^○ idle +gamma {2}main {2,}40% {2}\$3\.00$/u);
    expect(unknownRow.length).toBe(knownRow.length);
  });

  test("L6 with no registry change a working Bash row's age grows on screen after the clock moves and a poll passes", async ($, on) => {
    const busy = rowOf(1, "alpha", "running", { since: CLOCK_START - 60 * SECOND_MS });
    const world = await begin($, on, [busy]);
    world.setTranscript(
      transcriptPathOf(busy),
      transcriptOf({
        prompt: "go",
        pendingTool: { name: "Bash", at: CLOCK_START - 4 * SECOND_MS },
      }),
    );
    const pane = await enterSessions($, world);
    expect((await bodyRows(pane, NARROW))[0]).toMatch(/working Bash +4s /u);

    await world.advance(5 * SECOND_MS + POLL_MS);

    const age = Number(/working Bash (\d+)s /u.exec((await bodyRows(pane, NARROW))[0] ?? "")?.[1]);
    expect(age).toBeGreaterThanOrEqual(9);
  });

  test("L6b with no registry change every poll asks the pane to redraw so the age keeps moving", async ($, on) => {
    const redraws = { count: 0 };
    on("ui.invalidate", () => {
      redraws.count += 1;
      return { value: undefined };
    });
    const busy = rowOf(1, "alpha", "running", { since: CLOCK_START - 60 * SECOND_MS });
    const world = await begin($, on, [busy]);
    await enterSessions($, world);
    const before = redraws.count;

    await world.advance(POLL_MS * 3);

    expect(redraws.count).toBeGreaterThan(before);
  });

  test("L7 at 60 columns a long tool name is clipped, the age stays whole and the row fits in 60 cells", async ($, on) => {
    const busy = rowOf(1, "alpha", "running", { since: CLOCK_START - 60 * SECOND_MS });
    const world = await begin($, on, [busy]);
    world.setTranscript(
      transcriptPathOf(busy),
      transcriptOf({
        prompt: "go",
        pendingTool: { name: LONG_TOOL, at: CLOCK_START - 4 * SECOND_MS },
      }),
    );

    const pane = await enterSessions($, world);

    const [row = ""] = await bodyRows(pane, NARROW);
    expect(row).toMatch(/^● working mcp\S*… +4s +alpha/u);
    expect(row).not.toContain(LONG_TOOL);
    expect(row.length).toBeLessThanOrEqual(NARROW);
  });

  test("L8 a busy to idle flip with a new status time changes the text to idle 0s and keeps the row's line", async ($, on) => {
    const first = rowOf(1, "alpha", "idle", { since: CLOCK_START - 5 * MINUTE_MS });
    const flipping = rowOf(2, "zeta", "running", { since: CLOCK_START - 5 * MINUTE_MS });
    const world = await begin($, on, [first, flipping]);
    const pane = await enterSessions($, world);
    await world.advance(SYNC_GAP_MS + SYNC_GAP_MS / 2);
    const before = await bodyRows(pane, NARROW);

    putRegistry(world, flipping.pid, {
      status: "idle",
      statusUpdatedAt: CLOCK_START + SYNC_GAP_MS + SYNC_GAP_MS / 2,
    });
    await $.classic.FileChanged({
      file_path: `${HOME}/.claude/sessions/${flipping.pid}.json`,
      event: "change",
    });
    await world.settle();
    await pane.redraw();
    const after = await bodyRows(pane, NARROW);

    expect(before[1]).toMatch(/^● thinking( +\d+[smhd])? +zeta/u);
    expect(after[1]).toMatch(/^○ idle +0s +zeta/u);
    expect(after[0]).toMatch(/alpha/u);
  });

  test("L9 a long turn whose last prompt sits 400 KB before the end of the transcript still shows that prompt", async ($, on) => {
    const busy = rowOf(1, "alpha", "running", { since: CLOCK_START - 60 * SECOND_MS });
    const world = await begin($, on, [busy]);
    world.setTranscript(
      transcriptPathOf(busy),
      lastPromptLine(FIRST_PROMPT) + fillerOfBytes(LONG_TURN_BYTES),
    );

    const pane = await enterSessions($, world, WIDE);

    expect((await bodyRows(pane, WIDE))[0]).toContain(FIRST_PROMPT.slice(0, SHOWN_CHARS));
  });

  test("L10 a tool call in one poll and its answer in the next turn the row from working Bash to thinking", async ($, on) => {
    const busy = rowOf(1, "alpha", "running", { since: CLOCK_START - 60 * SECOND_MS });
    const world = await begin($, on, [busy]);
    const opened = lastPromptLine("go") + toolUseLine("t1", "Bash", CLOCK_START - 4 * SECOND_MS);
    world.setTranscript(transcriptPathOf(busy), opened);
    const pane = await enterSessions($, world);
    expect((await bodyRows(pane, NARROW))[0]).toMatch(/^● working Bash +\d+s +alpha/u);

    world.setTranscript(
      transcriptPathOf(busy),
      opened + toolResultLine("t1", CLOCK_START - 2 * SECOND_MS),
    );
    await world.advance(POLL_MS * 2);

    const [row = ""] = await bodyRows(pane, NARROW);
    expect(row).toMatch(/^● thinking( +\d+[smhd])? +alpha/u);
    expect(row).not.toContain("Bash");
  });

  test("L11 a prompt line that is half written when a poll reads is shown whole after the next poll", async ($, on) => {
    const idle = rowOf(1, "alpha", "idle");
    const world = await begin($, on, [idle]);
    const finished = lastPromptLine(FIRST_PROMPT);
    const next = lastPromptLine(SECOND_PROMPT);
    world.setTranscript(transcriptPathOf(idle), finished + next.slice(0, next.length / 2));
    const pane = await enterSessions($, world, WIDE);
    expect((await bodyRows(pane, WIDE))[0]).toContain(FIRST_PROMPT.slice(0, SHOWN_CHARS));

    world.setTranscript(transcriptPathOf(idle), finished + next);
    await world.advance(POLL_MS * 2);

    expect((await bodyRows(pane, WIDE))[0]).toContain(SECOND_PROMPT.slice(0, SHOWN_CHARS));
  });

  test("L12 a transcript that does not change is read on entry and not again by later polls", async ($, on) => {
    const idle = rowOf(1, "alpha", "idle");
    const world = await begin($, on, [idle]);
    world.setTranscript(transcriptPathOf(idle), lastPromptLine(FIRST_PROMPT));
    await enterSessions($, world, WIDE);
    const readsOnEntry = world.transcriptReads;

    await world.advance(POLL_MS * 4);

    expect(readsOnEntry).toBeGreaterThan(0);
    expect(world.transcriptReads).toBe(readsOnEntry);
  });

  test("L13 a transcript that grew by one line is read from where it ended, not from its start", async ($, on) => {
    const idle = rowOf(1, "alpha", "idle");
    const world = await begin($, on, [idle]);
    const before = lastPromptLine(FIRST_PROMPT) + fillerOfBytes(LONG_TURN_BYTES);
    world.setTranscript(transcriptPathOf(idle), before);
    const pane = await enterSessions($, world, WIDE);
    const bytesOnEntry = world.transcriptBytes;

    world.setTranscript(transcriptPathOf(idle), before + lastPromptLine(SECOND_PROMPT));
    await world.advance(POLL_MS * 2);

    expect(world.transcriptBytes - bytesOnEntry).toBeLessThan(SMALL_READ_BYTES);
    expect((await bodyRows(pane, WIDE))[0]).toContain(SECOND_PROMPT.slice(0, SHOWN_CHARS));
  });

  test("L14 a transcript replaced by a shorter one shows the prompt of the new content", async ($, on) => {
    const idle = rowOf(1, "alpha", "idle");
    const world = await begin($, on, [idle]);
    world.setTranscript(
      transcriptPathOf(idle),
      lastPromptLine(FIRST_PROMPT) + fillerOfBytes(SHORTER_BYTES),
    );
    const pane = await enterSessions($, world, WIDE);

    world.setTranscript(transcriptPathOf(idle), lastPromptLine(SECOND_PROMPT));
    await world.advance(POLL_MS * 2);

    const [row = ""] = await bodyRows(pane, WIDE);
    expect(row).toContain(SECOND_PROMPT.slice(0, SHOWN_CHARS));
    expect(row).not.toContain(FIRST_PROMPT.slice(0, "refactor".length));
  });

  test("L15 redrawing the tab reads no transcript, only a poll does", async ($, on) => {
    const idle = rowOf(1, "alpha", "idle");
    const world = await begin($, on, [idle]);
    world.setTranscript(transcriptPathOf(idle), lastPromptLine(FIRST_PROMPT));
    const pane = await enterSessions($, world, WIDE);
    world.setTranscript(
      transcriptPathOf(idle),
      lastPromptLine(FIRST_PROMPT) + lastPromptLine(SECOND_PROMPT),
    );
    const readsBefore = world.transcriptReads;

    await pane.redraw();
    await pane.redraw();
    await pane.redraw();

    expect(world.transcriptReads).toBe(readsBefore);
    expect((await bodyRows(pane, WIDE))[0]).toContain(FIRST_PROMPT.slice(0, SHOWN_CHARS));
  });

  test("L16 a prompt of wide Chinese characters is cut within 40 cells, so at most 20 characters", async ($, on) => {
    const idle = rowOf(1, "alpha", "idle");
    const world = await begin($, on, [idle]);
    world.setTranscript(transcriptPathOf(idle), lastPromptLine(CHINESE_PROMPT));

    const pane = await enterSessions($, world, WIDE);

    const [row = ""] = await bodyRows(pane, WIDE);
    expect(row).toContain(CHINESE_PROMPT.slice(0, PROMPT_CHARS / 2 - 1));
    expect(row).not.toContain(CHINESE_PROMPT.slice(0, PROMPT_CHARS / 2 + 1));
  });

  test("L17 a prompt whose last emoji would pass cell 40 is cut before that emoji, never in the middle of it", async ($, on) => {
    const idle = rowOf(1, "alpha", "idle");
    const world = await begin($, on, [idle]);
    world.setTranscript(
      transcriptPathOf(idle),
      lastPromptLine(`${"a".repeat(39)}${FAMILY_EMOJI}tail`),
    );

    const pane = await enterSessions($, world, WIDE);

    const [row = ""] = await bodyRows(pane, WIDE);
    expect(row).toContain("a".repeat(SHOWN_CHARS - 1));
    expect(row).not.toContain("a".repeat(PROMPT_CHARS));
    expect(row).not.toContain("\u{1F468}");
    expect(row).not.toContain("\u200D");
    expect(row).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
  });

  test("L18 a session whose registry status is shell draws its own word with a hollow muted dot, not idle", async ($, on) => {
    const world = await begin($, on, [rowOf(1, "alpha", "idle")]);
    putRegistry(world, 1, { status: "shell", statusUpdatedAt: CLOCK_START - 5 * SECOND_MS });

    const pane = await enterSessions($, world);

    const [row = ""] = await bodyRows(pane, NARROW);
    expect(row).toMatch(/^○ shell\b/u);
    expect(row).not.toContain("idle");
    expect(colourOf(await bodyCellsOf(pane), "○")).toEqual([palette.muted]);
  });

  test("L19 the own row's age restarts when its turn ends, whatever the registry said before", async ($, on) => {
    on("turn.start", (_$, e) => ({ turnId: e.turnId }));
    const own = rowOf(1, "alpha", "idle", {
      sessionId: OWN_SESSION,
      since: CLOCK_START - 12 * MINUTE_MS,
    });
    const world = await begin($, on, [own]);
    const pane = await enterSessions($, world);
    expect((await bodyRows(pane, NARROW))[0]).toMatch(/^○ idle +12m /u);

    await $.turn.start({ text: "go", turnId: "t1" });
    putRegistry(world, own.pid, { status: "busy", statusUpdatedAt: CLOCK_START });
    await world.advance(TURN_MS);
    await $.turn.complete({
      answer: "",
      durationMs: TURN_MS,
      isAborted: false,
      turnId: "t1",
      reason: "answer",
    } as never);
    putRegistry(world, own.pid, { status: "idle", statusUpdatedAt: CLOCK_START + TURN_MS });
    await $.classic.FileChanged({
      file_path: `${HOME}/.claude/sessions/${own.pid}.json`,
      event: "change",
    });
    await world.advance(10 * SECOND_MS);

    expect((await bodyRows(pane, NARROW))[0]).toMatch(/^○ idle +10s /u);
  });

  test("L20 two rows of one folder and branch stay in pid order, the lower pid first", async ($, on) => {
    const high = rowOf(7, "app", "idle");
    const low = rowOf(3, "app", "idle");
    const world = await begin($, on, [high, low]);
    world.setTranscript(transcriptPathOf(high), lastPromptLine(FIRST_PROMPT));
    world.setTranscript(transcriptPathOf(low), lastPromptLine(SECOND_PROMPT));

    const pane = await enterSessions($, world, WIDE);

    const [first = "", second = ""] = await bodyRows(pane, WIDE);
    expect(first).toContain(SECOND_PROMPT.slice(0, SHOWN_CHARS));
    expect(second).toContain(FIRST_PROMPT.slice(0, SHOWN_CHARS));
  });

  test("L21 a transcript that grew by more than 4 MiB while the tab was closed shows the newest prompt and tool from the end, and the next small growth shows too", async ($, on) => {
    const busy = rowOf(1, "alpha", "running", { since: CLOCK_START - 60 * SECOND_MS });
    const world = await begin($, on, [busy]);
    const before = lastPromptLine("go");
    world.setTranscript(transcriptPathOf(busy), before);
    const pane = await enterSessions($, world, WIDE);

    const grown =
      before +
      fillerOfBytes(OVER_STDOUT_LIMIT_BYTES) +
      lastPromptLine(SECOND_PROMPT) +
      toolUseLine("t9", "Bash", CLOCK_START - 4 * SECOND_MS);
    world.setTranscript(transcriptPathOf(busy), grown);
    await world.advance(POLL_MS * 2);

    const [row = ""] = await bodyRows(pane, WIDE);
    expect(row).toMatch(/^● working Bash +\d+s +alpha/u);
    expect(row).toContain(SECOND_PROMPT.slice(0, SHOWN_CHARS));

    world.setTranscript(transcriptPathOf(busy), grown + lastPromptLine(FIRST_PROMPT));
    await world.advance(POLL_MS * 2);

    expect((await bodyRows(pane, WIDE))[0]).toContain(FIRST_PROMPT.slice(0, SHOWN_CHARS));
  });

  test("D6 after a sync another session's stored row carries its registry status time and its transcript path, also when the stored row is reused", async ($, on) => {
    const reused = rowOf(500, "app", "idle");
    const world = await begin($, on, [reused]);
    putRegistry(world, reused.pid, { statusUpdatedAt: REGISTRY_STAMP });
    putRegistry(world, 600, {
      sessionId: "session-fresh",
      cwd: `${WORK}/app`,
      statusUpdatedAt: REGISTRY_STAMP + 1,
    });

    await enterSessions($, world);

    expect(world.storedRow(reused.pid)).toMatchObject({
      since: REGISTRY_STAMP,
      transcriptPath: `${HOME}/.claude/projects/-work-app/${reused.sessionId}.jsonl`,
    });
    expect(world.storedRow(600)).toMatchObject({
      since: REGISTRY_STAMP + 1,
      transcriptPath: `${HOME}/.claude/projects/-work-app/session-fresh.jsonl`,
    });
  });
});

async function twoRowsWithPrompts($: Engine, on: On): Promise<World> {
  const first = rowOf(1, "app", "idle");
  const second = rowOf(2, "app", "idle");
  const world = await begin($, on, [first, second]);
  world.setTranscript(transcriptPathOf(first), transcriptOf({ prompt: FIRST_PROMPT }));
  world.setTranscript(transcriptPathOf(second), transcriptOf({ prompt: SECOND_PROMPT }));
  return world;
}

function rowOf(
  pid: number,
  folder: string,
  state: AgentStatus,
  fields: Partial<SessionRow> = {},
): SessionRow {
  return {
    pid,
    sessionId: `session-${pid}`,
    state,
    cwd: `${WORK}/${folder}`,
    branch: MAIN,
    ctx: 40,
    usd: 3,
    ...fields,
  };
}

async function bodyRows(pane: Pane, columns: number): Promise<string[]> {
  const lines = screenRows(await pane.drawn(), columns).map((line) =>
    line.trimEnd().slice(GUTTER_CELLS),
  );
  const header = lines.findIndex((line) => line.includes("ctx"));
  return lines.slice(header + 1).filter((line) => line !== "");
}

async function bodyCellsOf(pane: Pane): Promise<Cell[]> {
  const cells = await cellsOf(pane);
  const costLabelAt = cells
    .map((cell) => cell.ch)
    .join("")
    .indexOf("30d");
  return cells.slice(costLabelAt + "30d".length);
}

async function cellsOf(pane: Pane): Promise<Cell[]> {
  return colouredPieces(await pane.drawn()).flatMap((piece) =>
    [...piece.text].map((ch) => ({ ch, color: piece.color })),
  );
}

function colourOf(cells: Cell[], token: string): unknown[] {
  const line = cells.map((cell) => cell.ch).join("");
  const start = line.indexOf(token);
  if (start === -1) return [];
  return cells.slice(start, start + token.length).map((cell) => cell.color);
}
