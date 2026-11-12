import { describe, expect, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

import { inkFor } from "../hooks/pane-ink";
import type { SessionRow } from "../types";
import { colouredPieces } from "./band-screen";
import { scrollListBy } from "./pane-keys-kit";
import {
  CLOCK_START,
  HOME,
  begin,
  enterSessions,
  fillerOfBytes,
  rowTexts,
  transcriptOf,
  transcriptPathOf,
} from "./sessions-world";
import type { Pane, World } from "./sessions-world";

const POLL_MS = 2000;
const SESSION_COUNT = 60;
const LIST_SCROLL_ROWS = 20;
const OVER_STDOUT_LIMIT_BYTES = 4_600_000;
const CURRENT_MODEL = /fennec[- ]7[-.]1/u;
const OLD_MODEL = /oldmodel/u;
const NEWEST_MODEL = "claude-fennec-7-1";
const FIRST_MODEL = "claude-oldmodel-1-0";
const LONG_PROMPT =
  "migrate the invoice exporter to the new ledger api then run the nightly reconciliation twice and compare totals against march";
const SHOWN_PROMPT_TAIL = "compare totals against march";
const COPY_WORD = /copy/iu;
const BACK_WORD = /back/iu;
const DASH_CELL = /(^|\s)[-–—]+(\s|$)/u;
const NO_VALUE_WORDS = /null|undefined|NaN/u;
const NARROW = 60;
const COLOUR_THEMES = ["dark", "light"];
const PATH_LABEL = "path";
const WRAPPING_PATH = "/Users/x/proj/service-with-a-long-name/another-nested-folder/final-segment";
const LAST_FOLDER = "final-segment";
type Cell = { ch: string; color: unknown };

const alpha: SessionRow = {
  pid: 4321,
  sessionId: "session-aurora",
  state: "idle",
  cwd: `${HOME}/code/alpha`,
  branch: "feature/ledger",
  ctx: 37,
  usd: 4.5,
};
const beta: SessionRow = {
  pid: 8765,
  sessionId: "session-borealis",
  state: "idle",
  cwd: `${HOME}/code/beta`,
  branch: "main",
  ctx: 12,
  usd: 1.25,
};
const bare: SessionRow = {
  pid: 5555,
  sessionId: "session-bare",
  state: "idle",
  cwd: `${HOME}/code/gamma`,
  branch: "",
  ctx: null,
  usd: null,
};

describe("sessions row detail", () => {
  test("D1 a click on a row opens its detail with the full path, branch, model, context, cost, pid, session id and the whole last prompt", async ($, on) => {
    const world = await begin($, on, [alpha, beta]);
    world.setTranscript(
      transcriptPathOf(alpha),
      transcriptOf({ prompt: LONG_PROMPT, model: NEWEST_MODEL }),
    );
    const pane = await enterSessions($, world);

    await pressRow(pane, world, "alpha");

    const shown = await detailText(pane);
    expect(shown).toMatch(/(\/h\/u|~)\/code\/alpha/u);
    expect(shown).toContain("feature/ledger");
    expect(shown).toMatch(CURRENT_MODEL);
    expect(shown).toContain("37%");
    expect(shown).toContain("$4.50");
    expect(shown).toContain("4321");
    expect(shown).toContain("session-aurora");
    expect(shown.replace(/\s+/gu, " ")).toContain(SHOWN_PROMPT_TAIL);
  });

  test("D2 the detail of one row shows nothing of the other rows", async ($, on) => {
    const world = await begin($, on, [alpha, beta]);
    const pane = await enterSessions($, world);

    await pressRow(pane, world, "alpha");

    const shown = await detailText(pane);
    expect(shown).toContain("session-aurora");
    expect(shown).not.toContain("session-borealis");
    expect(shown).not.toContain("8765");
  });

  test("D3 a row with no branch, context, cost, model or prompt opens a detail with empty cells and no dash", async ($, on) => {
    const world = await begin($, on, [alpha, bare]);
    const pane = await enterSessions($, world);

    await pressRow(pane, world, "gamma");

    const shown = await detailText(pane);
    expect(shown).toContain("session-bare");
    expect(shown).toContain("5555");
    expect(shown.split("\n").filter((line) => DASH_CELL.test(line))).toEqual([]);
    expect(shown).not.toMatch(NO_VALUE_WORDS);
  });

  test("D4 the detail has a copy button and pressing it puts exactly claude --resume and the session id on the clipboard", async ($, on) => {
    const copied: string[] = [];
    on("ui.copy", (_$, e) => {
      copied.push(e.text);
      return { value: { isCopied: true } };
    });
    on("ui.toast", () => ({ value: undefined }));
    const world = await begin($, on, [alpha, beta]);
    const pane = await enterSessions($, world);
    await pressRow(pane, world, "alpha");

    await pressButton(pane, world, COPY_WORD);

    expect(copied).toEqual(["claude --resume session-aurora"]);
  });

  test("D5 back from the detail shows the list scrolled to the same place as before the click", async ($, on) => {
    const { pane, world, scrolled, folder } = await scrolledList($, on);
    await pressRow(pane, world, folder);
    expect(await rowTexts(pane)).not.toEqual(scrolled);

    await pressButton(pane, world, BACK_WORD);

    expect(await rowTexts(pane)).toEqual(scrolled);
  });

  test("D7 the detail shows the model of the newest assistant row also when 4 MiB of assistant rows follow the first one", async ($, on) => {
    const world = await begin($, on, [alpha, beta]);
    const first = transcriptOf({ model: FIRST_MODEL });
    world.setTranscript(
      transcriptPathOf(alpha),
      first + fillerOfBytes(OVER_STDOUT_LIMIT_BYTES, NEWEST_MODEL),
    );
    const pane = await enterSessions($, world);

    await pressRow(pane, world, "alpha");

    const shown = await detailText(pane);
    expect(shown).toMatch(CURRENT_MODEL);
    expect(shown).not.toMatch(OLD_MODEL);
  });

  test("D8 when the session of the open detail ends, back still returns to the list without that session", async ($, on) => {
    const world = await begin($, on, [alpha, beta]);
    const pane = await enterSessions($, world);
    await pressRow(pane, world, "alpha");

    world.alive.delete(alpha.pid);
    await world.advance(POLL_MS * 2);
    await pane.redraw();
    await pressButton(pane, world, BACK_WORD);

    const shown = (await rowTexts(pane)).join("\n");
    expect(shown).toContain("beta");
    expect(shown).not.toContain("alpha");
  });
});

describe("sessions detail path colour", () => {
  for (const theme of COLOUR_THEMES) {
    test(`D3 in the ${theme} theme a wrapped path draws everything up to its last slash muted and the last folder in text, on every line`, async ($, on) => {
      const row = { ...alpha, cwd: WRAPPING_PATH };
      const world = await begin($, on, [row], null, theme);
      const pane = await enterSessions($, world, NARROW);
      await pressRow(pane, world, LAST_FOLDER);

      const cells = await pathCellsOf(pane);
      const split = WRAPPING_PATH.lastIndexOf("/") + 1;
      expect(cells.map((cell) => cell.ch).join("")).toBe(WRAPPING_PATH);
      expect(cells.slice(0, split).map((cell) => cell.color)).toEqual(
        Array(split).fill(inkFor(theme).muted),
      );
      expect(cells.slice(split).map((cell) => cell.color)).toEqual(
        Array(WRAPPING_PATH.length - split).fill(inkFor(theme).text),
      );
    });
  }
});

async function scrolledList(
  $: Engine,
  on: On,
): Promise<{ pane: Pane; world: World; scrolled: string[]; folder: string }> {
  const rows = Array.from({ length: SESSION_COUNT }, (_, index) => manyRowOf(index));
  const world = await begin($, on, rows);
  const pane = await enterSessions($, world);
  const top = await rowTexts(pane);
  await scrollListBy($, pane, LIST_SCROLL_ROWS);
  await world.settle();
  await pane.redraw();
  const scrolled = await rowTexts(pane);
  expect(scrolled).not.toEqual(top);
  const folder = /app-\d+/u.exec(scrolled.join("\n"))?.[0] ?? "";
  expect(folder, "a session row on screen after scrolling").not.toBe("");
  return { pane, world, scrolled, folder };
}

function manyRowOf(index: number): SessionRow {
  const label = String(index).padStart(2, "0");
  return {
    pid: 1000 + index,
    sessionId: `session-many-${label}`,
    state: "idle",
    cwd: `${HOME}/code/app-${label}`,
    branch: "main",
    ctx: 10,
    usd: 1,
    since: CLOCK_START,
  };
}

async function pressRow(pane: Pane, world: World, folder: string): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const row = buttons.find((button) => button.text.includes(folder));
  expect(row, `a clickable row for ${folder}`).toBeDefined();
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

async function detailText(pane: Pane): Promise<string> {
  return (await rowTexts(pane)).join("\n").replace(/[ \t]+/gu, " ");
}

async function pathCellsOf(pane: Pane): Promise<Cell[]> {
  const pieces = colouredPieces(await pane.drawn());
  const labelAt = pieces.findIndex((piece) => piece.text.trim() === PATH_LABEL);
  return pieces
    .slice(labelAt + 1)
    .flatMap((piece) => [...piece.text].map((ch) => ({ ch, color: piece.color })))
    .filter((cell) => cell.ch !== " ")
    .slice(0, WRAPPING_PATH.length);
}
