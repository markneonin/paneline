import { describe, expect, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

import { historyTab } from "../hooks/history-draw";
import type { HistoryView } from "../hooks/history-draw";
import { paneInk } from "../hooks/pane-ink";
import { displayWidth } from "../hooks/text-width";
import type { HistoryEntry, PastMatch } from "../types";
import { collect, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import { COLUMNS, NARROW_COLUMNS, WIDE_COLUMNS, openPane, SESSION_ID, settle } from "./spend-world";
import type { Pane } from "./spend-world";
import { historyWorldOf, jsonlRow, startFreshSession } from "./history-transcript";
import type { HistoryWorld } from "./history-transcript";

let mounts = 0;
const START_MS = Date.UTC(2026, 9, 6, 14, 2, 0);
const LONG_LINE =
  "the quick brown fox jumps over the lazy dog and keeps running past every fence in the county";
const MAX_TAB_PRESSES = 12;
const OLD_DATE = "2026-10-21T10:00:00.000Z";
const ELLIPSIS = "…";

type Seed = { entry: HistoryEntry; text: string };

const SEEDS: Seed[] = [
  {
    entry: { kind: "prompt", id: "p1", at: START_MS, tools: 2, ms: 8000 },
    text: LONG_LINE,
  },
  {
    entry: { kind: "reply", id: "r1", at: START_MS },
    text: `First line of the answer.\n\n${LONG_LINE}`,
  },
  { entry: { kind: "reply", id: "r2", at: START_MS }, text: "Done." },
  { entry: { kind: "prompt", id: "p2", at: START_MS + 60_000, failed: 1 }, text: "second prompt" },
];

const PAST: PastMatch[] = [
  { date: OLD_DATE, project: "demo-app", branch: "main", line: LONG_LINE },
  { date: OLD_DATE, project: "demo-app", branch: "main", line: LONG_LINE, isReply: true },
  { date: OLD_DATE, project: "other", branch: "dev", line: "short" },
];

type Frame = Partial<HistoryView>;

function viewOf(width: number, frame: Frame): HistoryView {
  return {
    width,
    entries: SEEDS.map((seed) => seed.entry),
    texts: new Map(SEEDS.map((seed) => [seed.entry.id, seed.text])),
    costs: new Map([["p1", 0.12]]),
    filter: "",
    past: null,
    cwd: "",
    selectPast: () => {},
    resume: () => {},
    copy: () => {},
    setFilter: () => {},
    focusFilter: () => {},
    jump: () => {},
    selected: "",
    openReplies: [],
    openProjects: [],
    toggleReplies: () => {},
    openProject: () => {},
    ...frame,
  };
}

type Drawer = (width: number, frame: Frame) => Promise<Node>;

function drawerOf($: Engine, on: On): Drawer {
  let current: { width: number; frame: Frame } = { width: COLUMNS, frame: {} };
  on("ui.render", { component: "Pane" }, ($$, e) =>
    historyTab($$.ui.resolve(e), viewOf(current.width, current.frame)),
  );
  return async (width, frame) => {
    current = { width, frame };
    const pane = await $.ui.mount({
      plugin: "paneline",
      surface: "terminal",
      component: "Pane",
      requestId: `history-paint-${++mounts}`,
      props: {
        title: "History",
        isFocused: false,
        bodyColumns: width,
        placement: "dock",
        scroll: { offset: 0, bodyRows: 40 },
        view: {},
      },
      viewport: { columns: width, rows: 40 },
    });
    return await pane.drawn();
  };
}

function rowBoxes(tree: Node, width: number): Node[] {
  return collect(tree, "Box").filter((box) => box.props?.width === width && box.props.height === 1);
}

function rowTexts(tree: Node, width: number): string[] {
  return rowBoxes(tree, width).map(textOf);
}

const FRAMES: { name: string; frame: Frame }[] = [
  { name: "default", frame: {} },
  { name: "reply open", frame: { openReplies: ["p1"] } },
  { name: "selected", frame: { selected: "p1" } },
  { name: "filter", frame: { filter: "the", past: PAST } },
  { name: "past searching", frame: { filter: "the", past: null } },
];

describe("history paint", () => {
  for (const width of [NARROW_COLUMNS, WIDE_COLUMNS]) {
    for (const { name, frame } of FRAMES) {
      test(`P1 at ${width} columns the ${name} frame paints every cell of every row it draws`, async ($, on) => {
        const tree = await drawerOf($, on)(width, frame);

        const rows = rowTexts(tree, width);

        expect(rows.length).toBeGreaterThan(0);
        expect(rows.map(displayWidth)).toEqual(rows.map(() => width));
      });
    }
  }

  test("P2 a folded reply is one muted row cut with an ellipsis, an open one reads reply alone and lists every non-empty reply line indented two cells under it", async ($, on) => {
    const drawn = drawerOf($, on);
    const folded = await drawn(NARROW_COLUMNS, {});
    const open = await drawn(WIDE_COLUMNS, { openReplies: ["p1"] });

    const foldedRows = rowTexts(folded, NARROW_COLUMNS).filter((row) => row.includes("▸"));
    const openRows = rowTexts(open, WIDE_COLUMNS).map((row) => row.trimEnd());

    expect(foldedRows[0]?.trimEnd().endsWith("Done.")).toBe(true);
    const longFolded = await drawn(NARROW_COLUMNS, {
      texts: new Map([["r2", LONG_LINE]]),
    });
    const cut = rowTexts(longFolded, NARROW_COLUMNS).filter((row) => row.includes("▸"));
    expect(cut[0]?.trimEnd().endsWith(ELLIPSIS)).toBe(true);
    const at = openRows.findIndex((row) => row.trim() === "▾ reply");
    expect(at).toBeGreaterThan(0);
    expect(openRows.slice(at + 1, at + 4)).toEqual([
      "    First line of the answer.",
      `    ${LONG_LINE}`,
      "    Done.",
    ]);
  });

  test("P11 a folded and an open reply show their text without list markers or code backticks", async ($, on) => {
    const drawn = drawerOf($, on);
    const texts = new Map([["r2", "- Every row is one line (`height={1}`), **bold** end"]]);
    const folded = await drawn(WIDE_COLUMNS, { texts });
    const open = await drawn(WIDE_COLUMNS, { texts, openReplies: ["p1"] });

    const foldedRows = rowTexts(folded, WIDE_COLUMNS).filter((row) => row.includes("▸"));
    const openRows = rowTexts(open, WIDE_COLUMNS).map((row) => row.trim());

    expect(foldedRows[0]?.trimEnd()).toBe("  ▸ Every row is one line (height={1}), bold end");
    expect(openRows).toContain("Every row is one line (height={1}), bold end");
  });

  test("P12 no History row carries the word reply: folded or open", async ($, on) => {
    const drawn = drawerOf($, on);
    const folded = await drawn(WIDE_COLUMNS, {});
    const open = await drawn(WIDE_COLUMNS, { openReplies: ["p1"] });

    expect(rowTexts(folded, WIDE_COLUMNS).filter((row) => row.includes("reply:"))).toEqual([]);
    expect(rowTexts(open, WIDE_COLUMNS).filter((row) => row.includes("reply:"))).toEqual([]);
  });

  test("P3 every cut text ends in an ellipsis: reply hit rows and past rows under a filter", async ($, on) => {
    const tree = await drawerOf($, on)(NARROW_COLUMNS, { filter: "the", past: PAST });

    const cuts = rowBoxes(tree, NARROW_COLUMNS)
      .filter((box) => /^(reply|past)-/.test(String(box.props?.key)))
      .map((box) => textOf(box).trimEnd())
      .filter((row) => displayWidth(row) >= NARROW_COLUMNS - 1);

    expect(cuts.length).toBeGreaterThanOrEqual(2);
    for (const row of cuts) expect(row.endsWith(ELLIPSIS), row).toBe(true);
  });

  test("P4 the selected prompt row and the selected reply row are filled with the tab fill, their text in the tab text", async ($, on) => {
    const drawn = drawerOf($, on);
    const prompt = await drawn(WIDE_COLUMNS, { selected: "p1" });
    const reply = await drawn(WIDE_COLUMNS, { filter: "Done", selected: "r2" });

    for (const [tree, id] of [
      [prompt, "prompt-p1"],
      [reply, "reply-r2"],
    ] as const) {
      const row = collect(tree, "Box").find((box) => box.props?.key === id);
      expect(row?.props?.backgroundColor, id).toBe(paneInk().tabFill);
      const texts = collect(row as Node, "Text").filter(
        (text) => collect(text, "Text").length === 1,
      );
      for (const text of texts) {
        expect(text.props?.backgroundColor).toBe(paneInk().tabFill);
        expect([paneInk().tabText, paneInk().failed, undefined]).toContain(text.props?.color);
      }
    }
    const idle = await drawn(WIDE_COLUMNS, {});
    const row = collect(idle, "Box").find((box) => box.props?.key === "prompt-p1");
    expect(row?.props?.backgroundColor).toBeUndefined();
  });

  test("P9 at every width the one button of a prompt row covers its whole width, right columns included", async ($, on) => {
    const drawn = drawerOf($, on);

    for (const width of [NARROW_COLUMNS, WIDE_COLUMNS]) {
      const tree = await drawn(width, {});
      const row = collect(tree, "Box").find((box) => box.props?.key === "prompt-p1");
      const buttons = collect(row as Node, "Button");

      expect(buttons, `${width}`).toHaveLength(1);
      const covered = textOf(buttons[0] as Node);
      expect(displayWidth(covered), `${width}`).toBe(width);
      expect(covered, `${width}`).toContain("$0.12");
    }
  });

  test("P12 a prompt row draws every blank cell with no colour so a hovered row reads as one band", async ($, on) => {
    const drawn = drawerOf($, on);

    for (const frame of [{}, { selected: "p1" }, { selected: "p2" }]) {
      const tree = await drawn(WIDE_COLUMNS, frame);
      const rows = collect(tree, "Box").filter((box) =>
        /^prompt-p\d$/.test(String(box.props?.key)),
      );

      expect(rows).toHaveLength(2);
      const blanks = rows
        .flatMap((row) => collect(row, "Text"))
        .filter((cell) => textOf(cell).trim() === "");
      expect(blanks.length).toBeGreaterThan(0);
      for (const cell of blanks) expect(cell.props?.color, JSON.stringify(frame)).toBeUndefined();
    }
  });

  test("P6 past rows start the snippet at one cell, with or without the reply mark, and keep every project in the text colour", async ($, on) => {
    const tree = await drawerOf($, on)(WIDE_COLUMNS, { filter: "short", past: PAST });

    const rows = collect(tree, "Box").filter((box) =>
      /^past-(demo-app|other)-/.test(String(box.props?.key)),
    );
    const snippetAt = rows.map((row) => textOf(row).search(/short|the quick/));
    const first = snippetAt[0] ?? 0;

    expect(rows).toHaveLength(3);
    expect(snippetAt).toEqual([first, first, first]);
    const projects = collect(tree, "Text").filter((text) =>
      /^(demo-app|other) *$/.test(textOf(text)),
    );
    expect(projects.map((text) => text.props?.color)).toEqual(projects.map(() => paneInk().text));
  });

  test("P10 at 60 columns the snippet of a past row gets at least half the row even with long project and branch names", async ($, on) => {
    const past = ["GH-101", "GH-102", "GH-103"].map((ticket) => ({
      date: OLD_DATE,
      project: `demo-app-${ticket}-long-project-name`,
      branch: `bugfix/${ticket}-long-branch-name`,
      line: `${ticket} ${LONG_LINE}`,
    }));
    const tree = await drawerOf($, on)(NARROW_COLUMNS, { filter: "the", past });

    const rows = collect(tree, "Box").filter((box) =>
      String(box.props?.key).startsWith("past-demo-app-"),
    );
    const snippets = rows.map((row) =>
      collect(row, "Text")
        .filter((text) => collect(text, "Text").length === 1)
        .at(-1),
    );

    expect(rows).toHaveLength(3);
    for (const snippet of snippets)
      expect(displayWidth(textOf(snippet as Node))).toBeGreaterThanOrEqual(NARROW_COLUMNS / 2);
  });

  test("P7 a blank row that cannot shrink sits before the past sessions heading at every width", async ($, on) => {
    const drawn = drawerOf($, on);
    for (const width of [NARROW_COLUMNS, WIDE_COLUMNS]) {
      const tree = await drawn(width, { filter: "the", past: PAST });

      const gap = collect(tree, "Box").find((box) => box.props?.key === "past-gap");

      expect(gap?.props?.height).toBe(1);
      expect(gap?.props?.flexShrink).toBe(0);
    }
  });
});

describe("history past search", () => {
  test("P5 a line of the live session is not listed under past sessions, a line of another session is", async ($, on) => {
    const world = historyWorldOf(on);
    world.spawning.searches = {
      spinner: [pastLine("spinner mine", SESSION_ID), pastLine("spinner theirs", "session-other")],
    };
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    await pane.input({ key: "filter", text: "spinner", kind: "change" });
    await settle(pane);

    const lines = (await pane.findAll({ type: "Text" })).map((text) => textOf(text));
    expect(lines.some((line) => line.includes("spinner theirs"))).toBe(true);
    expect(lines.some((line) => line.includes("spinner mine"))).toBe(false);
  });

  test("P8 pressing Enter on the filter at 60 columns clears the query and lists every prompt", async ($, on) => {
    const world: HistoryWorld = historyWorldOf(on);
    const pane = await openPane($, NARROW_COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);
    await pane.input({ key: "filter", text: "spinner", kind: "change" });
    await settle(pane);

    await pane.input({ key: "filter", text: "spinner", kind: "submit" });
    await settle(pane);

    const box = await pane.find({ type: "Input", key: "filter" });
    expect(box?.props.value ?? "").toBe("");
  });
});

function pastLine(text: string, sessionId: string): string {
  return `${jsonlRow({
    type: "user",
    uuid: `u-${sessionId}`,
    sessionId,
    timestamp: OLD_DATE,
    cwd: "/work/demo-app",
    gitBranch: "main",
    message: { role: "user", content: text },
  })}\n`;
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
