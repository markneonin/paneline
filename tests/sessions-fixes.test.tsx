import { describe, expect, test } from "claude-code/testing";

import { isHeavy } from "./weight";
import { palette } from "../hooks/palette";
import type { AgentStatus, SessionRow } from "../types";
import { colouredPieces, screenRows } from "./band-screen";
import { collect, textOf } from "./draw-tree";
import {
  CLOCK_START,
  HOME,
  OWN_PID,
  OWN_SESSION,
  WORK,
  begin,
  enterSessions,
  lastPromptLine,
  putRegistry,
  rowTexts,
  sessionsPane,
  toolResultLine,
  toolUseLine,
  transcriptOf,
  transcriptPathOf,
} from "./sessions-world";
import type { Pane, World } from "./sessions-world";
import type { Engine } from "claude-code/testing";

type Cell = { ch: string; color: unknown };

const NARROW = 60;
const WIDE = 120;
const GUTTER_CELLS = 1;
const SECOND_MS = 1000;
const MINUTE_MS = 60_000;
const POLL_MS = 2000;
const PROMPT_CHARS = 40;
const SHOWN_CHARS = PROMPT_CHARS - 1;
const ELLIPSIS = "…";
const MAIN = "main";
const HOST_CUT_CHARS = 200;
const ROW_KEY_CHARS = 5;
const LONG_PATH = `${HOME}/code/alpha-service-with-a-very-long-name/another-nested-folder/and-the-final-folder-name`;
const LONG_PROMPT =
  "migrate the invoice exporter to the new ledger api then run the nightly reconciliation twice and compare totals against march";
const FIRST_PROMPT = "refactor the billing module and write tests for every invoice rule";
const TYPED_PROMPT = "explain why the nightly export job is slower on mondays than on fridays";
const LONG_BRANCH = "bugfix/status-context-share-with-a-very-long-tail-end";
const LONG_NAME = "youtube-import-never-breaks-on-long-names";
const MID_NAME = "demo-app-status-sharing";
const LONG_MID_NAME = "demo-app-status-share-and-more-names-x";
const MID_BRANCH = "feature/scorched-neighbours-engine";
const MIN_BRANCH_PREFIX_CHARS = 3;

describe("sessions fixes", () => {
  test("F1 a path longer than the detail is shown whole over several lines at 60 columns", async ($, on) => {
    const row = rowOf(1, "alpha", "idle", { cwd: LONG_PATH });
    const world = await begin($, on, [row]);
    const pane = await enterSessions($, world);

    await pressRow(pane, world, "and-the-final");

    const flat = (await allRows(pane, NARROW)).join("").replace(/\s+/gu, "");
    expect(flat.includes(LONG_PATH) || flat.includes(LONG_PATH.replace(HOME, "~"))).toBe(true);
    expect(flat).not.toContain(ELLIPSIS);
  });

  test("F2 the lines after the first of a wrapped last prompt start 2 cells in", async ($, on) => {
    const row = rowOf(1, "alpha", "idle");
    const world = await begin($, on, [row]);
    world.setTranscript(transcriptPathOf(row), transcriptOf({ prompt: LONG_PROMPT }));
    const pane = await enterSessions($, world);
    await pressRow(pane, world, "alpha");

    const rows = await allRows(pane, NARROW);
    const first = rows.findIndex((line) => line.includes("migrate the invoice"));
    const blank = rows.findIndex((line, at) => at > first && line.trim() === "");
    const rest = rows.slice(first + 1, blank === -1 ? undefined : blank);

    expect(first).toBeGreaterThan(-1);
    expect(rows[first]).toMatch(/^\S/u);
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.filter((line) => !/^ {2}\S/u.test(line))).toEqual([]);
  });

  test("F3b one working row keeps its folder column while its age goes from 9s to 11s to 2m", async ($, on) => {
    const busy = rowOf(1, "alpha", "running", { since: CLOCK_START - MINUTE_MS });
    const world = await begin($, on, [busy]);
    world.setTranscript(
      transcriptPathOf(busy),
      transcriptOf({ pendingTool: { name: "Bash", at: CLOCK_START - 9 * SECOND_MS } }),
    );
    const pane = await enterSessions($, world, WIDE);
    const [at9 = ""] = await bodyRows(pane, WIDE);

    await world.advance(POLL_MS);
    await pane.redraw();
    const [at11 = ""] = await bodyRows(pane, WIDE);
    await world.advance(2 * MINUTE_MS - 11 * SECOND_MS);
    await pane.redraw();
    const [at2m = ""] = await bodyRows(pane, WIDE);

    expect(at9).toContain("9s");
    expect(at11).toContain("11s");
    expect(at2m).toContain("2m");
    expect(at11.indexOf("alpha")).toBe(at9.indexOf("alpha"));
    expect(at2m.indexOf("alpha")).toBe(at9.indexOf("alpha"));
  });

  test("F3e one working row keeps its folder column when its tool changes from Bash to WebFetch", async ($, on) => {
    const busy = rowOf(1, "alpha", "running", { since: CLOCK_START - MINUTE_MS });
    const world = await begin($, on, [busy]);
    const path = transcriptPathOf(busy);
    const bash = toolUseLine("t1", "Bash", CLOCK_START - 9 * SECOND_MS);
    world.setTranscript(path, bash);
    const pane = await enterSessions($, world, WIDE);
    const [before = ""] = await bodyRows(pane, WIDE);

    world.setTranscript(
      path,
      bash +
        toolResultLine("t1", CLOCK_START - SECOND_MS) +
        toolUseLine("t2", "WebFetch", CLOCK_START - SECOND_MS),
    );
    await world.advance(POLL_MS);
    await pane.redraw();
    const [after = ""] = await bodyRows(pane, WIDE);

    expect(before).toContain("Bash");
    expect(after).toContain("Web");
    expect(after).not.toContain("Bash");
    expect(after.indexOf("alpha")).toBe(before.indexOf("alpha"));
  });

  test("F3c a thinking row shows the age of its state like every other state", async ($, on) => {
    const thinking = rowOf(1, "alpha", "running", { since: CLOCK_START - 5 * SECOND_MS });
    const world = await begin($, on, [thinking]);

    const pane = await enterSessions($, world, WIDE);

    const [row = ""] = await bodyRows(pane, WIDE);
    expect(row).toMatch(/^● thinking +5s +alpha/u);
  });

  test("F3d at 60 columns a long tool name is cut with an ellipsis and its age stays whole", async ($, on) => {
    const busy = rowOf(1, "alpha", "running", { since: CLOCK_START - MINUTE_MS });
    const world = await begin($, on, [busy]);
    world.setTranscript(
      transcriptPathOf(busy),
      transcriptOf({
        pendingTool: { name: "mcp__paneline__progress", at: CLOCK_START - 4 * SECOND_MS },
      }),
    );

    const pane = await enterSessions($, world);

    const [row = ""] = await bodyRows(pane, NARROW);
    expect(row).toMatch(/^● working mcp\S*… +4s +alpha/u);
  });

  test("F4 a session with the unknown status shell shows a hollow muted dot, a plain name and is not in the working count", async ($, on) => {
    const busy = rowOf(1, "alpha", "running");
    const shell = rowOf(2, "zeta", "idle");
    const world = await begin($, on, [busy, shell]);
    putRegistry(world, 2, { status: "shell", statusUpdatedAt: CLOCK_START - 5 * SECOND_MS });

    const pane = await enterSessions($, world);

    const [, shellRow = ""] = await bodyRows(pane, NARROW);
    expect(shellRow).toMatch(/^○ shell +5s/u);
    expect(colourOf(await bodyCellsOf(pane), "○")).toEqual([palette.muted]);
    expect(heavyNames(await pane.drawn(), "zeta")).toEqual([false]);
    expect(heavyNames(await pane.drawn(), "alpha")).toContain(true);
    expect(screenRows(await pane.drawn(), NARROW).join("\n")).toContain("2 sessions · 1 thinking");
  });

  test("F5 a name that does not fit ends with an ellipsis and keeps its start, and a short name beside it has nothing after it but its column gap", async ($, on) => {
    const long = rowOf(1, LONG_NAME, "idle");
    const short = rowOf(2, "bot", "idle");
    const world = await begin($, on, [long, short]);

    const pane = await enterSessions($, world);

    const [shortRow = "", longRow = ""] = await bodyRows(pane, NARROW);
    const kept = / (youtube[\w-]*)… /u.exec(longRow)?.[1] ?? "";
    expect(kept.length).toBeGreaterThan(MIN_BRANCH_PREFIX_CHARS);
    expect(LONG_NAME.startsWith(kept)).toBe(true);
    expect(shortRow).toMatch(/ bot +main /u);
  });

  test("F6 with every branch main the header says branch whole at 60 columns", async ($, on) => {
    const world = await begin($, on, [rowOf(1, "alpha", "idle"), rowOf(2, "bravo", "idle")]);

    const pane = await enterSessions($, world);

    expect(await headerOf(pane, NARROW)).toMatch(/\bbranch\b/u);
  });

  test("F6b with every branch main the header says branch whole at 120 columns", async ($, on) => {
    const world = await begin($, on, [rowOf(1, "alpha", "idle"), rowOf(2, "bravo", "idle")]);

    const pane = await enterSessions($, world, WIDE);

    expect(await headerOf(pane, WIDE)).toMatch(/\bbranch\b/u);
  });

  test("F6c at 60 columns a long name and a long branch are both cut at their end with an ellipsis and both keep their start", async ($, on) => {
    const row = rowOf(1, MID_NAME, "idle", { branch: MID_BRANCH });
    const world = await begin($, on, [row]);

    const pane = await enterSessions($, world);

    const [line = ""] = await bodyRows(pane, NARROW);
    const name = / (demo-app[\w-]*)… /u.exec(line)?.[1] ?? "";
    const branch = / (feat[\w/-]*)…( |$)/u.exec(line)?.[1] ?? "";
    expect(name.length).toBeGreaterThan(MIN_BRANCH_PREFIX_CHARS);
    expect(MID_NAME.startsWith(name)).toBe(true);
    expect(MID_BRANCH.startsWith(branch)).toBe(true);
    expect(branch.length).toBeGreaterThanOrEqual(MIN_BRANCH_PREFIX_CHARS);
    expect(line.trimEnd().length).toBeLessThanOrEqual(NARROW - GUTTER_CELLS);
  });

  test("F6d at 120 columns a long name and a long branch do not take space from the prompt: it keeps its 40 cells", async ($, on) => {
    const row = rowOf(1, LONG_MID_NAME, "idle", { branch: LONG_BRANCH });
    const world = await begin($, on, [row]);
    world.setTranscript(transcriptPathOf(row), transcriptOf({ prompt: LONG_PROMPT }));

    const pane = await enterSessions($, world, WIDE);

    const [line = ""] = await bodyRows(pane, WIDE);
    expect(line).toContain(LONG_MID_NAME.slice(0, MID_NAME.length - 2));
    expect(line).toContain(`${LONG_PROMPT.slice(0, SHOWN_CHARS)}${ELLIPSIS}`);
  });

  test("F7 rows are sorted waiting first, then by the shown name ignoring case, not by the full path", async ($, on) => {
    const rows = [
      rowOf(1, "charlie", "idle", { cwd: "/m/charlie" }),
      rowOf(2, "Bravo", "idle", { cwd: "/a/Bravo" }),
      rowOf(3, "alpha", "idle", { cwd: "/z/alpha" }),
      rowOf(4, "zulu", "waiting", { cwd: "/q/zulu" }),
    ];
    const world = await begin($, on, rows);

    const pane = await enterSessions($, world);

    const names = (await bodyRows(pane, NARROW)).map(
      (line) => /(zulu|Bravo|alpha|charlie)/u.exec(line)?.[1],
    );
    expect(names).toEqual(["zulu", "alpha", "Bravo", "charlie"]);
  });

  test("F8 at 60 columns the word this stands in muted right after the own row's name and no other row has it", async ($, on) => {
    const world = await begin($, on, [ownRow(), rowOf(2, "gamma", "idle")]);

    const pane = await enterSessions($, world);

    const [own = "", other = ""] = await bodyRows(pane, NARROW);
    expect(own.indexOf("this")).toBe(own.indexOf("alpha") + "alpha ".length);
    expect(colourOf(await bodyCellsOf(pane), "this")).toEqual(Array(4).fill(palette.muted));
    expect(other).not.toContain("this");
  });

  test("F8b at 120 columns the word this stands in muted right after the own row's name and no other row has it", async ($, on) => {
    const world = await begin($, on, [ownRow(), rowOf(2, "gamma", "idle")]);

    const pane = await enterSessions($, world, WIDE);

    const [own = "", other = ""] = await bodyRows(pane, WIDE);
    expect(own.indexOf("this")).toBe(own.indexOf("alpha") + "alpha ".length);
    expect(colourOf(await bodyCellsOf(pane), "this")).toEqual(Array(4).fill(palette.muted));
    expect(other).not.toContain("this");
  });

  test("F9 the detail title shows the state word and age of an idle row after its name", async ($, on) => {
    const row = rowOf(1, "alpha", "idle", { since: CLOCK_START - 3 * MINUTE_MS });
    const world = await begin($, on, [row]);
    const pane = await enterSessions($, world, WIDE);

    await pressRow(pane, world, "alpha");

    const title = (await rowTexts(pane)).find((line) => line.includes("back")) ?? "";
    expect(title).toMatch(/alpha.* idle 3m$/u);
  });

  test("F9b the detail title of a working row shows its tool and age", async ($, on) => {
    const row = rowOf(1, "alpha", "running", { since: CLOCK_START - MINUTE_MS });
    const world = await begin($, on, [row]);
    world.setTranscript(
      transcriptPathOf(row),
      transcriptOf({ pendingTool: { name: "Bash", at: CLOCK_START - 4 * SECOND_MS } }),
    );
    const pane = await enterSessions($, world, WIDE);

    await pressRow(pane, world, "alpha");

    const title = (await rowTexts(pane)).find((line) => line.includes("back")) ?? "";
    expect(title).toMatch(/alpha.* working Bash 4s$/u);
  });

  test("F10 the detail shows the resume command as text beside a [ copy ] button and copying toasts what was copied", async ($, on) => {
    const toasts: string[] = [];
    on("ui.copy", () => ({ value: { isCopied: true } }));
    on("ui.toast", (_$, e) => {
      toasts.push(e.text);
      return { value: undefined };
    });
    const world = await begin($, on, [rowOf(1, "alpha", "idle")]);
    const pane = await enterSessions($, world, WIDE);
    await pressRow(pane, world, "alpha");

    const shown = (await rowTexts(pane)).join("\n");
    expect(shown).toMatch(
      /claude --resume session-1\b.*\[ copy \]|\[ copy \].*claude --resume session-1\b/u,
    );
    await pressButton(pane, world, /copy/iu);

    expect(toasts).toEqual(["Copied claude --resume session-1"]);
  });

  test("F11 a prompt typed after the last last-prompt row of the transcript is the one shown", async ($, on) => {
    const row = rowOf(1, "alpha", "idle");
    const world = await begin($, on, [row]);
    world.setTranscript(
      transcriptPathOf(row),
      lastPromptLine(FIRST_PROMPT) + typedLine(TYPED_PROMPT, {}),
    );

    const pane = await enterSessions($, world, WIDE);

    const [line = ""] = await bodyRows(pane, WIDE);
    expect(line).toContain(TYPED_PROMPT.slice(0, SHOWN_CHARS));
    expect(line).not.toContain(FIRST_PROMPT.slice(0, SHOWN_CHARS));
  });

  test("F11b a tool result, a subagent message and a meta message after the typed prompt do not replace it", async ($, on) => {
    const row = rowOf(1, "alpha", "idle");
    const world = await begin($, on, [row]);
    world.setTranscript(
      transcriptPathOf(row),
      lastPromptLine(FIRST_PROMPT) +
        typedLine(TYPED_PROMPT, {}) +
        typedLine("subagent words that are not typed by the person", { isSidechain: true }) +
        typedLine("meta words that the person did not type at all", { isMeta: true }) +
        toolUseLine("t1", "Bash", CLOCK_START - SECOND_MS),
    );

    const pane = await enterSessions($, world, WIDE);

    const [line = ""] = await bodyRows(pane, WIDE);
    expect(line).toContain(TYPED_PROMPT.slice(0, SHOWN_CHARS));
  });
});

const WRAP_PATHS = {
  "a path through finish-all": "/home/dev/projects/IT/demo-app-service/tasks/finish-all",
  "a path ending in mediaresource": "/home/dev/projects/web-work-area-two/mediaresource",
  "a path with hyphenated folders": `${LONG_PATH}/demo-app-GH-86-review-column-sessions-tab`,
};

const INJECTED_ROWS = {
  "a task notification":
    "<task-notification>\n<task-id>b1x</task-id>\n<status>completed</status>\n</task-notification>",
  "a clear command":
    "<command-name>/clear</command-name>\n<command-message>clear</command-message>",
  "a local command output": "<local-command-stdout>Compacted</local-command-stdout>",
  "a system reminder":
    "<system-reminder>\nThe task tools have not been used recently.\n</system-reminder>",
  "a compaction summary":
    "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion.",
};

const FULL_PROMPT = Array.from(
  { length: 50 },
  (_, at) => `word${String(at).padStart(2, "0")}`,
).join(" ");

describe("sessions detail round two", () => {
  for (const [name, path] of Object.entries(WRAP_PATHS))
    test(`G1 ${name} wraps at 60 columns only after a slash and its continuation lines are indented and never start with a hyphen`, async ($, on) => {
      const row = rowOf(1, "alpha", "idle", { cwd: path });
      const world = await begin($, on, [row]);
      const pane = await enterSessions($, world);

      await pressRow(pane, world, (path.split("/").at(-1) ?? "").slice(0, ROW_KEY_CHARS));

      const lines = pathLinesOf(await allRows(pane, NARROW));
      expect(lines.length).toBeGreaterThan(1);
      expect(lines.slice(0, -1).filter((line) => !line.endsWith("/"))).toEqual([]);
      expect(lines.slice(1).filter((line) => !/^ +[^\s-]/u.test(line))).toEqual([]);
      expect(
        lines
          .map((line) => line.trim())
          .join("")
          .replace(/^path/u, ""),
      ).toContain(path);
    });

  for (const [name, text] of Object.entries(INJECTED_ROWS))
    test(`G2 ${name} after the typed prompt does not replace the prompt shown`, async ($, on) => {
      const row = rowOf(1, "alpha", "idle");
      const world = await begin($, on, [row]);
      world.setTranscript(
        transcriptPathOf(row),
        lastPromptLine(FIRST_PROMPT) + typedLine(TYPED_PROMPT, {}) + typedLine(text, {}),
      );

      const pane = await enterSessions($, world, WIDE);

      const [line = ""] = await bodyRows(pane, WIDE);
      expect(line).toContain(TYPED_PROMPT.slice(0, SHOWN_CHARS));
    });

  test("G2 a 500-character typed prompt shows whole in the detail without an ellipsis", async ($, on) => {
    const row = rowOf(1, "alpha", "idle");
    const world = await begin($, on, [row]);
    world.setTranscript(transcriptPathOf(row), typedLine(FULL_PROMPT, {}));
    const pane = await enterSessions($, world);

    await pressRow(pane, world, "alpha");

    const flat = (await allRows(pane, NARROW)).join("").replace(/\s+/gu, "");
    expect(flat).toContain(FULL_PROMPT.replace(/\s+/gu, ""));
    expect(flat).not.toContain(ELLIPSIS);
  });

  test("G2 a 500-character typed prompt followed by the host's last-prompt row cut at 200 characters shows whole in the detail", async ($, on) => {
    const row = rowOf(1, "alpha", "idle");
    const world = await begin($, on, [row]);
    world.setTranscript(
      transcriptPathOf(row),
      typedLine(FULL_PROMPT, {}) +
        lastPromptLine(`${FULL_PROMPT.slice(0, HOST_CUT_CHARS)}${ELLIPSIS}`),
    );
    const pane = await enterSessions($, world);

    await pressRow(pane, world, "alpha");

    const flat = (await allRows(pane, NARROW)).join("").replace(/\s+/gu, "");
    expect(flat).toContain(FULL_PROMPT.replace(/\s+/gu, ""));
    expect(flat).not.toContain(ELLIPSIS);
  });

  test("G3 a session with no prompt shows a muted no prompt yet row under the Last prompt heading", async ($, on) => {
    const row = rowOf(1, "alpha", "idle");
    const world = await begin($, on, [row]);
    const pane = await enterSessions($, world);

    await pressRow(pane, world, "alpha");

    const lines = (await allRows(pane, NARROW)).map((line) => line.trim());
    const heading = lines.findIndex((line) => line.includes("Last prompt"));
    expect(heading).toBeGreaterThan(-1);
    expect(lines[heading + 1]).toBe("no prompt yet");
    const shown = colouredPieces(await pane.drawn()).filter((piece) =>
      piece.text.includes("no prompt yet"),
    );
    expect(shown.map((piece) => piece.color)).toEqual([palette.muted]);
  });
});

function pathLinesOf(lines: string[]): string[] {
  const start = lines.findIndex((line) => /^path\b/u.test(line));
  const end = lines.findIndex((line, at) => at > start && /^branch\b/u.test(line));
  return lines.slice(start, end).map((line) => line.trimEnd());
}

describe("sessions round three", () => {
  test("H1 a registry file with only a start time shows the age since it started", async ($, on) => {
    const row = rowOf(1, "alpha", "idle");
    const world = await begin($, on, [row]);
    putRegistry(world, 1, { startedAt: CLOCK_START - 5 * SECOND_MS });

    const pane = await enterSessions($, world, WIDE);

    const [line = ""] = await bodyRows(pane, WIDE);
    expect(line).toMatch(/^○ idle +5s +alpha/u);
  });

  test("H1 a registry file with an update time and a start time shows the age since the update", async ($, on) => {
    const row = rowOf(1, "alpha", "idle");
    const world = await begin($, on, [row]);
    putRegistry(world, 1, {
      startedAt: CLOCK_START - 10 * MINUTE_MS,
      updatedAt: CLOCK_START - 30 * SECOND_MS,
    });

    const pane = await enterSessions($, world, WIDE);

    const [line = ""] = await bodyRows(pane, WIDE);
    expect(line).toMatch(/^○ idle +30s +alpha/u);
  });

  test("H1 a registry file with a status time keeps showing the age since the status time", async ($, on) => {
    const row = rowOf(1, "alpha", "idle");
    const world = await begin($, on, [row]);
    putRegistry(world, 1, {
      startedAt: CLOCK_START - 10 * MINUTE_MS,
      updatedAt: CLOCK_START - 30 * SECOND_MS,
      statusUpdatedAt: CLOCK_START - 7 * SECOND_MS,
    });

    const pane = await enterSessions($, world, WIDE);

    const [line = ""] = await bodyRows(pane, WIDE);
    expect(line).toMatch(/^○ idle +7s +alpha/u);
  });

  test("H2 the own row measured with a cost of zero shows an empty cost cell, not $0.00", async ($, on) => {
    const world = await begin($, on, [
      rowOf(OWN_PID, "alpha", "idle", { sessionId: OWN_SESSION, usd: null }),
    ]);
    const pane = await enterSessions($, world, WIDE);

    await measureCost($, pane, 0);

    const [line = ""] = await bodyRows(pane, WIDE);
    expect(line).toContain("alpha");
    expect(line).not.toContain("$");
  });

  test("H2 the own row measured with a cost of 0.004 shows <$0.01", async ($, on) => {
    const world = await begin($, on, [
      rowOf(OWN_PID, "alpha", "idle", { sessionId: OWN_SESSION, usd: null }),
    ]);
    const pane = await enterSessions($, world, WIDE);

    await measureCost($, pane, 0.004);

    const [line = ""] = await bodyRows(pane, WIDE);
    expect(line).toMatch(/<\$0\.01$/u);
  });
});

async function measureCost($: Engine, pane: Pane, usd: number): Promise<void> {
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [],
    cost: { usd },
    changed: ["cost"],
  } as never);
  await pane.redraw();
}

describe("sessions round four", () => {
  test("K1 at 120 columns the branch, ctx and cost columns stay where they are when the prompts arrive", async ($, on) => {
    const first = rowOf(1, "alpha", "idle", { branch: LONG_BRANCH });
    const second = rowOf(2, "bravo", "idle", { branch: LONG_BRANCH });
    const world = await begin($, on, [first, second]);
    const pane = await enterSessions($, world, WIDE);
    const without = await columnsOf(pane, WIDE);

    world.setTranscript(transcriptPathOf(first), transcriptOf({ prompt: LONG_PROMPT }));
    world.setTranscript(transcriptPathOf(second), transcriptOf({ prompt: FIRST_PROMPT }));
    await world.advance(POLL_MS);
    await pane.redraw();
    const withPrompts = await columnsOf(pane, WIDE);

    expect(without.rowPrompts).toBe(false);
    expect(withPrompts.rowPrompts).toBe(true);
    expect(withPrompts.branch).toBe(without.branch);
    expect(withPrompts.ctx).toBe(without.ctx);
    expect(withPrompts.cost).toBe(without.cost);
  });

  test("K1 at 120 columns a long branch is cut with an ellipsis also while no row has a prompt", async ($, on) => {
    const world = await begin($, on, [rowOf(1, "alpha", "idle", { branch: LONG_BRANCH })]);
    const pane = await enterSessions($, world, WIDE);

    const [line = ""] = await bodyRows(pane, WIDE);

    expect(line).not.toContain(LONG_BRANCH);
    expect(line).toMatch(/ bugfix\/[\w-]*… /u);
  });

  test("K2 one working and one thinking row give the summary 1 working then 1 thinking, after the waiting count", async ($, on) => {
    const working = rowOf(1, "alpha", "running");
    const world = await begin($, on, [
      working,
      rowOf(2, "bravo", "running"),
      rowOf(3, "charlie", "waiting"),
    ]);
    world.setTranscript(
      transcriptPathOf(working),
      transcriptOf({ pendingTool: { name: "Bash", at: CLOCK_START - 4 * SECOND_MS } }),
    );

    const pane = await enterSessions($, world, WIDE);

    expect(screenRows(await pane.drawn(), WIDE).join("\n")).toContain(
      "3 sessions · 1 waiting · 1 working · 1 thinking",
    );
  });

  test("K2 with no thinking row the summary has no thinking count", async ($, on) => {
    const working = rowOf(1, "alpha", "running");
    const world = await begin($, on, [working, rowOf(2, "bravo", "idle")]);
    world.setTranscript(
      transcriptPathOf(working),
      transcriptOf({ pendingTool: { name: "Bash", at: CLOCK_START - 4 * SECOND_MS } }),
    );

    const pane = await enterSessions($, world, WIDE);

    const screen = screenRows(await pane.drawn(), WIDE).join("\n");
    expect(screen).toContain("2 sessions · 1 working");
    expect(screen).not.toContain("thinking");
  });
});

async function columnsOf(
  pane: Pane,
  columns: number,
): Promise<{ branch: number; ctx: number; cost: number; rowPrompts: boolean }> {
  const lines = await allRows(pane, columns);
  const header = lines.find((line) => line.includes("ctx")) ?? "";
  const body = await bodyRows(pane, columns);
  return {
    branch: header.indexOf("branch"),
    ctx: header.indexOf("ctx"),
    cost: header.trimEnd().length,
    rowPrompts: body.some((line) => line.includes("migrate") || line.includes("refactor")),
  };
}

describe("sessions round five", () => {
  test("L1 a detail opened before the first sync has a plain title with the name only and the muted row no prompt data yet", async ($, on) => {
    const row = rowOf(1, "alpha", "idle");
    const world = await begin($, on, [row]);
    putRegistry(world, 1, { status: "waiting", statusUpdatedAt: CLOCK_START - 2 * MINUTE_MS });
    world.setTranscript(transcriptPathOf(row), transcriptOf({ prompt: FIRST_PROMPT }));

    const pane = await openBeforeSync($, "alpha");

    const lines = (await rowTexts(pane)).map((line) => line.trim());
    expect(lines.find((line) => line.includes("back"))).toMatch(/^\[ back \] alpha$/u);
    const heading = lines.findIndex((line) => line.includes("Last prompt"));
    expect(lines[heading + 1]).toBe("no prompt data yet");
    const shown = colouredPieces(await pane.drawn()).filter((piece) =>
      piece.text.includes("no prompt data yet"),
    );
    expect(shown.map((piece) => piece.color)).toEqual([palette.muted]);
    expect(lines.join("\n")).not.toContain("no prompt yet");
  });

  test("L1 the own session's detail opened before the first sync has the title name this and nothing else", async ($, on) => {
    const world = await begin($, on, [ownRow()]);
    putRegistry(world, OWN_PID, { status: "waiting", statusUpdatedAt: CLOCK_START - MINUTE_MS });

    const pane = await openBeforeSync($, "alpha");

    const title = (await rowTexts(pane)).find((line) => line.includes("back")) ?? "";
    expect(title.trim()).toMatch(/^\[ back \] alpha this$/u);
  });

  test("L1 after the first sync the detail shows the real state, age and prompt", async ($, on) => {
    const row = rowOf(1, "alpha", "idle");
    const world = await begin($, on, [row]);
    putRegistry(world, 1, { status: "waiting", statusUpdatedAt: CLOCK_START - 2 * MINUTE_MS });
    world.setTranscript(transcriptPathOf(row), transcriptOf({ prompt: FIRST_PROMPT }));
    const pane = await openBeforeSync($, "alpha");

    await world.settle();
    await pane.redraw();

    const shown = (await rowTexts(pane)).join("\n");
    expect(shown).toMatch(/alpha.* waiting 2m/u);
    expect(shown).toContain(FIRST_PROMPT);
  });

  test("L2 a row with no branch, model, ctx and cost draws none of those labels in the detail and keeps the others", async ($, on) => {
    const row = rowOf(1, "alpha", "idle", { branch: "", ctx: null, usd: null });
    const world = await begin($, on, [row]);
    const pane = await enterSessions($, world);
    await pressRow(pane, world, "alpha");

    const lines = (await allRows(pane, NARROW)).map((line) => line.trim());

    expect(lines.filter((line) => /^(branch|model|ctx|30d cost)$/u.test(line))).toEqual([]);
    expect(lines.filter((line) => /^(path|pid|session)\b/u.test(line))).toHaveLength(3);
  });

  test("L2 a row with a branch, model, ctx and cost still draws those four labels", async ($, on) => {
    const row = rowOf(1, "alpha", "idle");
    const world = await begin($, on, [row]);
    world.setTranscript(transcriptPathOf(row), transcriptOf({ model: "claude-opus-5-5" }));
    const pane = await enterSessions($, world);
    await pressRow(pane, world, "alpha");

    const lines = (await allRows(pane, NARROW)).map((line) => line.trim());

    expect(lines.filter((line) => /^(branch|model|ctx|30d cost)\b/u.test(line))).toHaveLength(4);
  });

  test("L3 the own session's detail title reads its name, this, then the state word and age with one space", async ($, on) => {
    const row = ownRow();
    const world = await begin($, on, [{ ...row, since: CLOCK_START - MINUTE_MS }]);
    const pane = await enterSessions($, world, WIDE);
    await pressRow(pane, world, "alpha");

    const title = (await rowTexts(pane)).find((line) => line.includes("back")) ?? "";

    expect(title).toMatch(/alpha this idle 1m$/u);
  });

  test("L3 another session's detail title has no this", async ($, on) => {
    const row = rowOf(1, "alpha", "idle", { since: CLOCK_START - MINUTE_MS });
    const world = await begin($, on, [row]);
    const pane = await enterSessions($, world, WIDE);
    await pressRow(pane, world, "alpha");

    const title = (await rowTexts(pane)).find((line) => line.includes("back")) ?? "";

    expect(title).toMatch(/alpha idle 1m$/u);
    expect(title).not.toContain("this");
  });
});

async function openBeforeSync($: Engine, name: string): Promise<Pane> {
  const pane = await sessionsPane($, WIDE);
  const opener = (await pane.findAll({ type: "Button" })).find((button) =>
    button.text.includes(name),
  );
  expect(opener, "a clickable row before the first sync").toBeDefined();
  await pane.press({ key: opener?.key ?? "" });
  await pane.redraw();
  return pane;
}

function ownRow(): SessionRow {
  return rowOf(OWN_PID, "alpha", "idle", { sessionId: OWN_SESSION });
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

function typedLine(text: string, flags: Record<string, boolean>): string {
  return `${JSON.stringify({
    type: "user",
    ...flags,
    timestamp: new Date(CLOCK_START - MINUTE_MS).toISOString(),
    message: { role: "user", content: text },
  })}\n`;
}

async function bodyRows(pane: Pane, columns: number): Promise<string[]> {
  const lines = (await allRows(pane, columns)).map((line) => line.trimEnd());
  const header = lines.findIndex((line) => line.includes("ctx"));
  return lines.slice(header + 1).filter((line) => line !== "");
}

async function headerOf(pane: Pane, columns: number): Promise<string> {
  const lines = await allRows(pane, columns);
  return lines.find((line) => line.includes("ctx")) ?? "";
}

async function allRows(pane: Pane, columns: number): Promise<string[]> {
  return screenRows(await pane.drawn(), columns).map((line) => line.slice(GUTTER_CELLS));
}

async function pressRow(pane: Pane, world: World, name: string): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const row = buttons.find((button) => button.text.includes(name));
  expect(row, `a clickable row for ${name}`).toBeDefined();
  await pane.press({ key: row?.key ?? "" });
  await world.settle();
  await pane.redraw();
}

async function pressButton(pane: Pane, world: World, word: RegExp): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const button = buttons.find((candidate) => word.test(candidate.text));
  expect(button, `a button matching ${String(word)}`).toBeDefined();
  await pane.press({ key: button?.key ?? "" });
  await world.settle();
  await pane.redraw();
}

function heavyNames(tree: unknown, name: string): boolean[] {
  return collect(tree as never, "Text")
    .filter((node) => textOf(node) === name)
    .map((node) => isHeavy(node.props));
}

async function bodyCellsOf(pane: Pane): Promise<Cell[]> {
  const cells = colouredPieces(await pane.drawn()).flatMap((piece) =>
    [...piece.text].map((ch) => ({ ch, color: piece.color })),
  );
  const costLabelAt = cells
    .map((cell) => cell.ch)
    .join("")
    .indexOf("30d");
  return cells.slice(costLabelAt + "30d".length);
}

function colourOf(cells: Cell[], token: string): unknown[] {
  const line = cells.map((cell) => cell.ch).join("");
  const start = line.indexOf(token);
  if (start === -1) return [];
  return cells.slice(start, start + token.length).map((cell) => cell.color);
}
