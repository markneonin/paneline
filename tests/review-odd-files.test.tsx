import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, MockClock, Mounted } from "claude-code/testing";

import type { Activity } from "../types";
import { collect, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import { HEAD_SHA, MERGE_BASE_SHA, TOP, repoOf, treeOf } from "./review-world";
import type { Repo } from "./review-world";
import { linesOf } from "./skills-tree";

type Pane = Mounted<"terminal", "Pane">;
type World = { repo: Repo; clock: MockClock };

const NOW = 1_000_000;
const ROWS = 40;
const WIDE = 120;
const FLUSH_MS = 400;
const SETTLE_TICKS = 5;
const TAB_PAGES = 12;
const RIGHT_ARROW = "›";
const REVIEW_LABEL = "Review";
const COMMENTS_PATH = `${TOP}/.git/paneline-review.json`;
const APP = "src/app.ts";
const APP_HEAD = "one\ntwo\nthree\n";
const BLOB = "assets/blob.bin";
const BLOB_LINES = 7;
const BIG = "data/big.csv";
const BIG_ROW = "abcdefgh\n";
const BIG_ROWS = 500_000;
const MODE_FILE = "docs/guide.md";
const ESC = "\u001b";
const NUL = "\u0000";
const ESC_SYMBOL = "␛";
const NUL_SYMBOL = "␀";
const CR_SYMBOL = "␍";
const CUT_HEADER = `diff --git a/${APP} b/${APP}\nindex 1111111..2222222 100644\n--- a/${APP}\n+++ b/${APP}\n`;
const CUT_WITH_HUNKS = `${CUT_HEADER}@@ -1,3 +1,3 @@\n one\n-two\n+TWO changed\n three\n@@ -40,3 +40,3 @@\n ctx\n-old far\n+new f`;

describe("review diff of odd files", () => {
  test("A1 a changed line with an escape byte opens the diff, shows the escape as a symbol and keeps the pane drawn", async ($, on) => {
    const world = worldOf(on, repoChangingLine(`${ESC}[31mred`));
    const pane = await openReview($, world);

    await pressShowing(pane, world, APP);

    const rows = await shown(pane);
    expect(rows.some((row) => row.includes(`${ESC_SYMBOL}[31mred`))).toBe(true);
    expect(await labels(pane)).toContain("back");
  });

  test("A2 a changed line with a NUL opens the diff and shows the NUL as a symbol", async ($, on) => {
    const world = worldOf(on, repoChangingLine(`a${NUL}b`));
    const pane = await openReview($, world);

    await pressShowing(pane, world, APP);

    const rows = await shown(pane);
    expect(rows.some((row) => row.includes(`a${NUL_SYMBOL}b`))).toBe(true);
  });

  test("A3 a changed line with a carriage return in the middle opens the diff and shows it as a symbol", async ($, on) => {
    const world = worldOf(on, repoChangingLine("left\rright"));
    const pane = await openReview($, world);

    await pressShowing(pane, world, APP);

    const rows = await shown(pane);
    expect(rows.some((row) => row.includes(`left${CR_SYMBOL}right`))).toBe(true);
  });

  test("A4 a file with Windows line endings shows its changed line as plain text with no symbol", async ($, on) => {
    const repo = repoOf({
      trees: {
        HEAD: treeOf({ [APP]: "one\r\ntwo\r\n" }),
        [HEAD_SHA]: treeOf({ [APP]: "one\r\ntwo\r\n" }),
        [MERGE_BASE_SHA]: treeOf({}),
      },
      work: treeOf({ [APP]: "one\r\nchanged\r\n" }),
      mergeBases: { main: MERGE_BASE_SHA },
    });
    const world = worldOf(on, repo);
    const pane = await openReview($, world);

    await pressShowing(pane, world, APP);

    const rows = await shown(pane);
    expect(rows.some((row) => /\+changed\s*$/.test(row))).toBe(true);
    expect(rows.some((row) => row.includes(CR_SYMBOL))).toBe(false);
  });

  test("A5 an untracked binary file is listed without a line count and opens as one binary file row", async ($, on) => {
    const repo = repoChangingLine("two changed");
    repo.work.set(BLOB, `MZ${NUL}\u0001\n${"payload\n".repeat(BLOB_LINES - 1)}`);
    repo.untracked.add(BLOB);
    repo.binary.add(BLOB);
    const world = worldOf(on, repo);
    const pane = await openReview($, world);

    const list = await shown(pane);
    await pressShowing(pane, world, BLOB);
    const opened = await shown(pane);

    expect(list.some((row) => row.includes("blob.bin") && /\+[1-9]\d* /.test(row))).toBe(false);
    expect(opened.filter((row) => row === "binary file")).toHaveLength(1);
    expect(opened.some((row) => row.includes("payload"))).toBe(false);
  });

  test("A6 an untracked text file over 4 MiB is listed with its real line count", async ($, on) => {
    const repo = repoChangingLine("two changed");
    repo.work.set(BIG, BIG_ROW.repeat(BIG_ROWS));
    repo.untracked.add(BIG);
    const world = worldOf(on, repo);

    const rows = await shown(await openReview($, world));

    expect(rows.some((row) => row.includes("big.csv") && row.endsWith(`+${BIG_ROWS} -0`))).toBe(
      true,
    );
  });

  test("A10 opening an untracked text file over 4 MiB says diff too large, not created empty, and shows no more lines row", async ($, on) => {
    const repo = repoChangingLine("two changed");
    repo.work.set(BIG, BIG_ROW.repeat(BIG_ROWS));
    repo.untracked.add(BIG);
    const world = worldOf(on, repo);
    const pane = await openReview($, world);

    await pressShowing(pane, world, "big.csv");

    const rows = await shown(pane);
    expect(rows.some((row) => row.includes("diff too large"))).toBe(true);
    expect(rows.some((row) => row.includes("created empty"))).toBe(false);
    expect(rows.some((row) => /^… \d+ more lines?$/.test(row))).toBe(false);
  });

  test("A7 a file whose git diff was cut shows the hunks that were read and one diff too large row", async ($, on) => {
    const repo = repoChangingLine("TWO changed");
    repo.cut.set(APP, CUT_WITH_HUNKS);
    const world = worldOf(on, repo);
    const pane = await openReview($, world);

    await pressShowing(pane, world, APP);

    const rows = await shown(pane);
    const hunkAt = rows.findIndex((row) => row.includes("TWO changed"));
    const noteAt = rows.findIndex((row) => row.includes("diff too large"));
    expect(hunkAt).toBeGreaterThanOrEqual(0);
    expect(noteAt).toBeGreaterThan(hunkAt);
    expect(rows.filter((row) => row.includes("diff too large"))).toHaveLength(1);
    expect(rows.some((row) => row.includes("mode change"))).toBe(false);
  });

  test("A8 a file whose git diff was cut before any hunk says diff too large and never mode change", async ($, on) => {
    const repo = repoChangingLine("TWO changed");
    repo.cut.set(APP, CUT_HEADER);
    const world = worldOf(on, repo);
    const pane = await openReview($, world);

    await pressShowing(pane, world, APP);

    const rows = await shown(pane);
    expect(rows.some((row) => row.includes("diff too large"))).toBe(true);
    expect(rows.some((row) => row.includes("mode change"))).toBe(false);
  });

  test("A9 a file whose only change is its mode says mode change and not diff too large", async ($, on) => {
    const repo = repoChangingLine("two changed");
    repo.trees.HEAD?.set(MODE_FILE, "guide\n");
    repo.work.set(MODE_FILE, "guide\n");
    repo.executable.add(MODE_FILE);
    const world = worldOf(on, repo);
    const pane = await openReview($, world);

    await pressShowing(pane, world, MODE_FILE);

    const rows = await shown(pane);
    expect(rows.some((row) => row.includes("mode change"))).toBe(true);
    expect(rows.some((row) => row.includes("diff too large"))).toBe(false);
  });
});

function repoChangingLine(changed: string): Repo {
  const head = { [APP]: APP_HEAD };
  return repoOf({
    trees: { HEAD: treeOf(head), [HEAD_SHA]: treeOf(head), [MERGE_BASE_SHA]: treeOf(head) },
    work: treeOf({ [APP]: `one\n${changed}\nthree\n` }),
    mergeBases: { main: MERGE_BASE_SHA },
  });
}

function edit(target: string): Activity {
  return { id: target, tool: "Edit", target, ms: 1, isErrored: false, added: 1, removed: 1 };
}

function worldOf(on: On, repo: Repo): World {
  const world: World = { repo, clock: mock.clock(on, { now: NOW }) };
  const state = new Map([["activity", { value: [edit(`${TOP}/${APP}`)], version: 1 }]]);
  mock.env(on, { HOME: "/h/u" });
  on("state.get", (_$, e, next) => {
    const seeded = state.get(e.key);
    return seeded ? { value: seeded } : next(e);
  });
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: TOP }));
  on("session.root", () => ({ value: TOP }));
  on("agent.list", () => ({ value: [] }));
  on("settings.read", () => ({ value: {} }));
  on("fs.exists", (_$, e) => ({ value: e.path !== COMMENTS_PATH }));
  on("fs.read", async (_$, e) => ({ value: await repo.$.fs.read(e.path) }));
  on("fs.stat", async (_$, e) => ({ value: await repo.$.fs.stat(e.path) }));
  on("fs.write", () => ({ value: undefined }));
  on("process.run", async (_$, e) => {
    if (e.argv.includes("--absolute-git-dir"))
      return { value: { exitCode: 0, stdout: `${TOP}/.git\n`, stderr: "" } } as never;
    return { value: await repo.$.process.run(e.argv, e.init) };
  });
  on("tool.call", () => ({ result: "ok", text: "ok" }));
  on("prompt.submit", (_$, e) => ({ text: e.text }));
  return world;
}

async function openReview($: Engine, world: World): Promise<Pane> {
  const pane = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: "session",
    props: {
      title: "Session",
      isFocused: false,
      bodyColumns: WIDE,
      placement: "dock",
      scroll: { offset: 0, bodyRows: ROWS },
      view: {},
    },
    viewport: { columns: WIDE, rows: ROWS },
  });
  for (let page = 0; page < TAB_PAGES && !(await barHasReview(pane)); page++)
    await pressNamed(pane, world, RIGHT_ARROW);
  await pressNamed(pane, world, REVIEW_LABEL);
  await pressNamed(pane, world, "uncommitted");
  return pane;
}

async function barHasReview(pane: Pane): Promise<boolean> {
  return JSON.stringify(await pane.drawn()).includes(REVIEW_LABEL);
}

async function settle(pane: Pane, world: World): Promise<void> {
  await world.clock.advance(FLUSH_MS);
  for (let tick = 0; tick < SETTLE_TICKS; tick++) await pane.redraw();
}

function plainLabel(node: Node): string {
  const label = node.props?.label;
  const raw = typeof label === "string" ? label : textOf(node);
  return raw
    .replace(/^\[\s*|\s*\]$/g, "")
    .replace(/^(‹)\d+$|^\d+(›)$/, "$1$2")
    .trim();
}

async function buttons(pane: Pane): Promise<Node[]> {
  return collect(await pane.drawn(), "Button");
}

async function labels(pane: Pane): Promise<string[]> {
  return (await buttons(pane)).map(plainLabel);
}

async function pressNamed(pane: Pane, world: World, name: string): Promise<void> {
  const target = (await buttons(pane)).find((button) => plainLabel(button) === name);
  expect(target, `a button named ${name}`).toBeDefined();
  await pane.press({ key: String(target?.props?.key) });
  await settle(pane, world);
}

async function pressShowing(pane: Pane, world: World, text: string): Promise<void> {
  const target = (await buttons(pane)).find(
    (button) => plainLabel(button).includes(text) || textOf(button).includes(text),
  );
  expect(target, `a button showing ${text}`).toBeDefined();
  await pane.press({ key: String(target?.props?.key) });
  await settle(pane, world);
}

async function shown(pane: Pane): Promise<string[]> {
  return linesOf((await pane.drawn()) as Node)
    .map((line) => line.text)
    .filter((text) => text !== "");
}
