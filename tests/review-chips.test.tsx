import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, MockClock, Mounted } from "claude-code/testing";

import { paneInk } from "../hooks/pane-ink";
import { displayWidth } from "../hooks/text-width";
import type { Activity } from "../types";
import { childrenOf, collect, labelledTextOf, rowGapOf, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import { HEAD_SHA, MERGE_BASE_SHA, TOP, numbered, repoOf, treeOf } from "./review-world";
import type { Repo } from "./review-world";
import { linesOf } from "./skills-tree";
import type { Line } from "./skills-tree";

type Pane = Mounted<"terminal", "Pane">;
type World = {
  repo: Repo;
  clock: MockClock;
  comments: string | undefined;
  state: Map<string, { value: unknown; version: number }>;
};

const NOW = 1_000_000;
const ROWS = 40;
const MEDIUM = 60;
const WIDE = 120;
const FLUSH_MS = 400;
const SETTLE_TICKS = 5;
const TAB_PAGES = 12;
const RIGHT_ARROW = "›";
const REVIEW_LABEL = "Review";
const COMMENTS_PATH = `${TOP}/.git/paneline-review.json`;
const APP = "src/app.ts";
const APP_NAME = "app.ts";
const UTIL = "src/util.ts";
const UTIL_NAME = "util.ts";
const EMPTY = "src/empty.ts";
const EMPTY_NAME = "empty.ts";
const APP_LINES = 30;
const UTIL_LINES = 10;
const APP_FIRST_LINE = 3;
const APP_SECOND_LINE = 25;
const APP_FIRST = "app three changed";
const APP_SECOND = "app twenty-five changed";
const UTIL_EDIT = "util five changed";
const NOTE = "rename this";
const COUNTS_AT_END = /\+\d+ -\d+$/;
const COMMENT_THEN_COUNTS = /✎ 1 {2,}\+\d+ -\d+$/;
const IDLE_SCOPES = ["session", "main"];
const REVERT_FILE_QUESTION = "revert file? [ yes ] [ no ]";
const REVERT_FILE_BUTTON = "[ revert file ]";
const MARK_REVIEWED_BUTTON = "[ mark reviewed ]";
const DEEP_FOLDER = "docs/architecture/decisions";
const FITTING_NAME = "review-scope-chips-notes.md";
const LONG_NAME = "review-scope-chips-and-file-rows-notes.md";
const OVERSIZE_NAME = "review-scope-chips-and-file-rows-and-detail-title-notes.md";
const MIN_GAP = 2;
const GUIDE = "docs/guide.md";
const SCOPE_ORDER = ["session", "uncommitted", "main"];
const COUNTS_PIECE = /\+\d+ -\d+/;
const COMMENT_PIECE = /✎ \d+/;
const NARROW = 30;
const MARK_REVIEWED = "mark reviewed";
const SECOND_HUNK_TITLE = /^@@ line 22\b/;
const FIRST_HUNK_TITLE = /^@@ line 1\b/;

describe("review chips", () => {
  test("A1 at 60 columns no row of the review list or of an open file is wider than the pane", async ($, on) => {
    const world = commentedWorld(on);
    const pane = await openReview($, world, MEDIUM, "uncommitted");

    const listRows = widerThan(await linesNow(pane), MEDIUM);
    await pressShowing(pane, world, APP_NAME);
    const fileRows = widerThan(await linesNow(pane), MEDIUM);

    expect(listRows).toEqual([]);
    expect(fileRows).toEqual([]);
  });

  test("A2 at 120 columns no row of the review list or of an open file is wider than the pane", async ($, on) => {
    const world = commentedWorld(on);
    const pane = await openReview($, world, WIDE, "uncommitted");

    const listRows = widerThan(await linesNow(pane), WIDE);
    await pressShowing(pane, world, APP_NAME);
    const fileRows = widerThan(await linesNow(pane), WIDE);

    expect(listRows).toEqual([]);
    expect(fileRows).toEqual([]);
  });

  test("A3 with one commented and one uncommented changed file, the +N -N counts of both rows start in the same column", async ($, on) => {
    const world = commentedWorld(on);
    const pane = await openReview($, world, WIDE, "uncommitted");

    const commented = await fileRowText(pane, APP_NAME);
    const plain = await fileRowText(pane, UTIL_NAME);

    expect(countsColumn(plain)).toBeGreaterThan(0);
    expect(countsColumn(commented)).toBe(countsColumn(plain));
  });

  test("A4 on a row with a comment, the comment count ends at least two cells before the +N -N counts", async ($, on) => {
    const world = commentedWorld(on);
    const pane = await openReview($, world, WIDE, "uncommitted");

    expect(await fileRowText(pane, APP_NAME)).toMatch(COMMENT_THEN_COUNTS);
  });

  test("A5 opening a changed file shows one blank row between the back row and the file name row", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP_NAME);

    const [gap, title] = await linesBelowBack(pane);

    expect(gap).toBe("");
    expect(title).toContain(APP_NAME);
  });

  test("A6 opening a new empty file shows one blank row between the back row and the file name row", async ($, on) => {
    const world = worldOf(on, emptyFileRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, EMPTY_NAME);

    const [gap, title] = await linesBelowBack(pane);

    expect(gap).toBe("");
    expect(title).toContain(EMPTY_NAME);
  });

  test("A7 opening a changed file shows one blank row between its last diff line and the revert file button", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP_NAME);

    expect(await lineAbove(pane, REVERT_FILE_BUTTON)).toBe("");
  });

  test("A8 pressing revert file keeps one blank row between the last diff line and the question", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP_NAME);
    await pressNamed(pane, world, "revert file");

    expect(await lineAbove(pane, REVERT_FILE_QUESTION)).toBe("");
  });

  test("A9 the scope names not selected draw in the text colour, and the selected one stays a filled chip", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");

    const idle = (await buttons(pane)).filter((button) => IDLE_SCOPES.includes(plainLabel(button)));
    const chip = collect(await pane.drawn(), "Text").find(
      (node) => textOf(node) === " uncommitted ",
    );

    expect(
      idle.map((button) => [
        plainLabel(button),
        button.props?.dimColor === true,
        collect(button, "Text").map((node) => node.props?.color),
      ]),
    ).toEqual([
      ["session", false, [paneInk().text]],
      ["main", false, [paneInk().text]],
    ]);
    expect(chip?.props?.backgroundColor).toBe(paneInk().tabFill);
  });

  test("A11 the revert hunk button draws its label dim in grey brackets, not red, as on main", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP_NAME);

    const hunk = (await buttons(pane)).find((button) => plainLabel(button) === "revert hunk");

    expect(hunk, "the revert hunk button").toBeDefined();
    expect(collect(hunk as Node, "Text").map((node) => node.props?.color)).not.toContain(
      paneInk().failed,
    );
    expect(hunk?.props?.dimColor).toBe(true);
  });
  test("A14 a file name wider than the whole path space is still cut, the counts stay on the path row and the mark button sits on its own row under it", async ($, on) => {
    const world = worldOf(on, deepFileRepo(OVERSIZE_NAME));
    const pane = await openReview($, world, MEDIUM, "uncommitted");
    await pressShowing(pane, world, "and-detail-title-notes.md");

    const [row, below] = await pathRowAndBelow(pane, "and-detail-title-notes.md");

    expect(row.text.startsWith("…")).toBe(true);
    expect(row.text).not.toContain(OVERSIZE_NAME);
    expect(row.text).toMatch(/\+1 -1$/);
    expect(displayWidth(row.text)).toBeLessThanOrEqual(MEDIUM - 1);
    expect(below.text).toBe(MARK_REVIEWED_BUTTON);
  });

  test("A15 at 60 columns the detail path row shows the whole file name after the folder cut, with at least two cells before the counts and two before the mark button", async ($, on) => {
    const world = worldOf(on, deepFileRepo(FITTING_NAME));
    const pane = await openReview($, world, MEDIUM, "uncommitted");
    await pressShowing(pane, world, FITTING_NAME);

    const row = await detailPathRow(pane);

    expect(row).toBe(`…/${FITTING_NAME} +1 -1 [ mark reviewed ]`);
    expect(rowGapOf(await pane.drawn(), MARK_REVIEWED)).toBeGreaterThanOrEqual(MIN_GAP);
  });

  test("A17 at 30 columns the detail path row keeps the file name tail and the counts, and the mark button sits on the row under it", async ($, on) => {
    const world = worldOf(on, deepFileRepo(FITTING_NAME));
    const pane = await openReview($, world, NARROW, "uncommitted");
    await pressShowing(pane, world, "notes.md");

    const [row, below] = await pathRowAndBelow(pane, "s.md");

    expect(row.text).toMatch(/^….*s\.md \+1 -1$/);
    expect(below.text).toBe(MARK_REVIEWED_BUTTON);
  });

  test("A16 in a diff with two hunks exactly one blank row sits above each hunk title, so the second hunk does not run into the first and the first gains no extra gap", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP_NAME);

    const blanks = await blankRowsAbove(pane, [FIRST_HUNK_TITLE, SECOND_HUNK_TITLE]);

    expect(blanks).toEqual([1, 1]);
  });

  test("A19 at 60 columns a file name that fits whole with its counts but not with the mark button keeps its whole name and counts on the path row, and the mark button moves to the row under it, indented one cell", async ($, on) => {
    const world = worldOf(on, deepFileRepo(LONG_NAME));
    const pane = await openReview($, world, MEDIUM, "uncommitted");
    await pressShowing(pane, world, LONG_NAME);

    const [row, below] = await pathRowAndBelow(pane, LONG_NAME);

    expect(row.text).toMatch(new RegExp(`${LONG_NAME} +\\+1 -1$`));
    expect(row.text).not.toContain(MARK_REVIEWED);
    expect(below.text).toBe(MARK_REVIEWED_BUTTON);
    expect(below.indent).toBe(await indentOf(pane, REVERT_FILE_BUTTON));
  });

  test("A20 at 120 columns the same long file name keeps the counts and the mark button on the one path row", async ($, on) => {
    const world = worldOf(on, deepFileRepo(LONG_NAME));
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, LONG_NAME);

    expect(await detailPathRow(pane)).toBe(
      `${DEEP_FOLDER}/${LONG_NAME} +1 -1 ${MARK_REVIEWED_BUTTON}`,
    );
  });

  test("A21 the detail path row draws the folders in the muted colour and the file name in the text colour, as the list row does", async ($, on) => {
    const world = worldOf(on, deepFileRepo(FITTING_NAME));
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, FITTING_NAME);

    const pieces = await detailPathPieces(pane);

    expect(pieces.map((piece) => [piece.text, piece.color])).toEqual([
      [`${DEEP_FOLDER}/`, paneInk().muted],
      [FITTING_NAME, paneInk().text],
    ]);
  });

  test("A22 at 60 columns each scope name keeps its place when another scope is selected", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, MEDIUM, "session");
    const whenSession = await scopeLabelColumns(pane);
    await pressNamed(pane, world, "uncommitted");
    const whenUncommitted = await scopeLabelColumns(pane);
    await pressNamed(pane, world, "main");
    const whenMain = await scopeLabelColumns(pane);

    expect(Object.keys(whenSession)).toEqual(SCOPE_ORDER);
    expect(whenUncommitted).toEqual(whenSession);
    expect(whenMain).toEqual(whenSession);
  });

  test("A23 at 120 columns each scope name keeps its place when another scope is selected", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "session");
    const whenSession = await scopeLabelColumns(pane);
    await pressNamed(pane, world, "uncommitted");
    const whenUncommitted = await scopeLabelColumns(pane);
    await pressNamed(pane, world, "main");
    const whenMain = await scopeLabelColumns(pane);

    expect(Object.keys(whenSession)).toEqual(SCOPE_ORDER);
    expect(whenUncommitted).toEqual(whenSession);
    expect(whenMain).toEqual(whenSession);
  });

  test("A24 at 60 columns the comment count of a comments only file ends at the column where the counts of a changed file end", async ($, on) => {
    const world = guideCommentWorld(on, projectRepo());
    const pane = await openReview($, world, MEDIUM, "uncommitted");

    const guide = await fileRowText(pane, "guide.md");
    const changed = await fileRowText(pane, UTIL_NAME);

    expect(endOf(guide, COMMENT_PIECE)).toBe(endOf(changed, COUNTS_PIECE));
  });

  test("A25 at 120 columns the comment count of a comments only file ends at the column where the counts of a changed file end", async ($, on) => {
    const world = guideCommentWorld(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");

    const guide = await fileRowText(pane, "guide.md");
    const changed = await fileRowText(pane, UTIL_NAME);

    expect(endOf(guide, COMMENT_PIECE)).toBe(endOf(changed, COUNTS_PIECE));
  });

  test("A26 at 60 columns with no changed file the comment count of a comments only file ends at the right edge of the pane", async ($, on) => {
    const world = guideCommentWorld(on, cleanRepo());
    const pane = await openReview($, world, MEDIUM, "uncommitted");

    expect(endOf(await fileRowText(pane, "guide.md"), COMMENT_PIECE)).toBe(MEDIUM - 1);
  });

  test("A27 at 120 columns with no changed file the comment count of a comments only file ends at the right edge of the pane", async ($, on) => {
    const world = guideCommentWorld(on, cleanRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");

    expect(endOf(await fileRowText(pane, "guide.md"), COMMENT_PIECE)).toBe(WIDE - 1);
  });
});

function guideCommentWorld(on: On, repo: Repo): World {
  const world = worldOf(on, repo);
  world.comments = JSON.stringify([
    {
      id: "c1",
      file: GUIDE,
      line: 1,
      side: "new",
      code: "guide v2",
      text: NOTE,
      resolved: false,
    },
  ]);
  return world;
}

function cleanRepo(): Repo {
  const head = { [APP]: numbered(APP_LINES), [GUIDE]: numbered(UTIL_LINES) };
  return repoOf({
    trees: { HEAD: treeOf(head), [HEAD_SHA]: treeOf(head), [MERGE_BASE_SHA]: treeOf(head) },
    work: treeOf(head),
    mergeBases: { main: MERGE_BASE_SHA },
  });
}

function endOf(row: string, piece: RegExp): number {
  const match = piece.exec(row);
  expect(match, `${piece} in the row ${row}`).not.toBeNull();
  return displayWidth(row.slice(0, (match?.index ?? 0) + (match?.[0].length ?? 0)));
}

async function pathRowAndBelow(pane: Pane, nameTail: string): Promise<[Line, Line]> {
  const lines = await linesNow(pane);
  const at = lines.findIndex(
    (line) => line.text.includes(nameTail) && COUNTS_PIECE.test(line.text),
  );
  expect(at, `the detail path row showing ${nameTail}`).toBeGreaterThanOrEqual(0);
  return [lines[at] as Line, lines[at + 1] as Line];
}

async function indentOf(pane: Pane, text: string): Promise<number | undefined> {
  const line = (await linesNow(pane)).find((candidate) => candidate.text === text);
  expect(line, `a row reading ${text}`).toBeDefined();
  return line?.indent;
}

async function detailPathPieces(pane: Pane): Promise<{ text: string; color: unknown }[]> {
  const row = collect(await pane.drawn(), "Box")
    .filter((box) => typeof box.props?.columnGap === "number" && textOf(box).includes("+1 -1"))
    .at(-1);
  expect(row, "the detail path row").toBeDefined();
  const [path] = childrenOf(row as Node);
  return collect(path as Node, "Text")
    .filter((node) => childrenOf(node).length === 0)
    .map((node) => ({ text: textOf(node), color: node.props?.color }));
}

async function scopeLabelColumns(pane: Pane): Promise<Record<string, number>> {
  const row = collect(await pane.drawn(), "Box")
    .filter((box) => SCOPE_ORDER.every((scope) => labelledTextOf(box).includes(scope)))
    .at(-1);
  expect(row, "the scope row").toBeDefined();
  const gap = Number((row as Node).props?.columnGap);
  const columns: Record<string, number> = {};
  let at = 0;
  for (const cell of childrenOf(row as Node)) {
    const text = labelledTextOf(cell);
    if (SCOPE_ORDER.includes(text.trim()))
      columns[text.trim()] = at + text.length - text.trimStart().length;
    at += displayWidth(text) + gap;
  }
  return columns;
}

function commentedWorld(on: On): World {
  const world = worldOf(on, projectRepo());
  world.comments = JSON.stringify([
    {
      id: "c1",
      file: APP,
      line: APP_FIRST_LINE,
      side: "new",
      code: APP_FIRST,
      text: NOTE,
      resolved: false,
    },
  ]);
  return world;
}

function widerThan(lines: Line[], columns: number): string[] {
  return lines
    .filter((line) => line.text !== "" && drawnWidth(line) > columns)
    .map((line) => line.text);
}

function drawnWidth(line: Line): number {
  return displayWidth(`${" ".repeat(line.indent)}${line.text}`);
}

async function fileRowText(pane: Pane, name: string): Promise<string> {
  const row = (await buttons(pane)).find((button) => textOf(button).includes(name));
  expect(row, `the file row of ${name}`).toBeDefined();
  return textOf(row as Node);
}

function countsColumn(row: string): number {
  return row.search(COUNTS_AT_END);
}

async function linesOfPane(pane: Pane): Promise<string[]> {
  return linesOf(await pane.drawn()).map((line) => line.text);
}

async function linesNow(pane: Pane): Promise<Line[]> {
  return linesOf(await pane.drawn());
}

async function lineAbove(pane: Pane, text: string): Promise<string | undefined> {
  const lines = await linesOfPane(pane);
  const at = lines.indexOf(text);
  expect(at, `a row reading ${text}`).toBeGreaterThan(0);
  return lines[at - 1];
}

async function linesBelowBack(pane: Pane): Promise<string[]> {
  const lines = linesOf(await pane.drawn());
  const at = lines.findIndex((line) => line.parts.some((part) => plainLabel(part) === "back"));
  expect(at, "the row with the back button").toBeGreaterThanOrEqual(0);
  return lines.slice(at + 1, at + 3).map((line) => line.text);
}

function projectRepo(): Repo {
  const head = { [APP]: numbered(APP_LINES), [UTIL]: numbered(UTIL_LINES) };
  return repoOf({
    trees: { HEAD: treeOf(head), [HEAD_SHA]: treeOf(head), [MERGE_BASE_SHA]: treeOf(head) },
    work: treeOf({
      [APP]: numbered(APP_LINES, { [APP_FIRST_LINE]: APP_FIRST, [APP_SECOND_LINE]: APP_SECOND }),
      [UTIL]: numbered(UTIL_LINES, { 5: UTIL_EDIT }),
    }),
    mergeBases: { main: MERGE_BASE_SHA },
  });
}

function deepFileRepo(name: string): Repo {
  const path = `${DEEP_FOLDER}/${name}`;
  const head = { [path]: numbered(UTIL_LINES) };
  return repoOf({
    trees: { HEAD: treeOf(head), [HEAD_SHA]: treeOf(head), [MERGE_BASE_SHA]: treeOf(head) },
    work: treeOf({ [path]: numbered(UTIL_LINES, { 5: UTIL_EDIT }) }),
    mergeBases: { main: MERGE_BASE_SHA },
  });
}

async function detailPathRow(pane: Pane): Promise<string> {
  const row = (await linesOfPane(pane)).find((text) => text.endsWith(MARK_REVIEWED_BUTTON));
  expect(row, "the detail path row ending in the mark button").toBeDefined();
  return row as string;
}

async function blankRowsAbove(pane: Pane, titles: RegExp[]): Promise<number[]> {
  const lines = await linesOfPane(pane);
  return titles.map((title) => {
    const at = lines.findIndex((text) => title.test(text));
    expect(at, `a row matching ${title}`).toBeGreaterThan(0);
    const above = lines.slice(0, at).reverse();
    const firstFilled = above.findIndex((text) => text !== "");
    return firstFilled === -1 ? above.length : firstFilled;
  });
}

function emptyFileRepo(): Repo {
  const repo = projectRepo();
  repo.work.set(EMPTY, "");
  repo.untracked.add(EMPTY);
  return repo;
}

function edit(target: string): Activity {
  return { id: target, tool: "Edit", target, ms: 1, isErrored: false, added: 1, removed: 1 };
}

function worldOf(on: On, repo: Repo): World {
  const world: World = {
    repo,
    clock: mock.clock(on, { now: NOW }),
    comments: undefined,
    state: new Map(),
  };
  world.state.set("activity", { value: [edit(`${TOP}/${APP}`)], version: 1 });
  mock.env(on, { HOME: "/h/u" });
  on("state.get", (_$, e, next) => {
    const seeded = world.state.get(e.key);
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
  on("fs.exists", (_$, e) => ({
    value: e.path === COMMENTS_PATH ? world.comments !== undefined : true,
  }));
  on("fs.read", async (_$, e) => ({
    value: e.path === COMMENTS_PATH ? commentsText(world) : await repo.$.fs.read(e.path),
  }));
  on("fs.stat", async (_$, e) => ({ value: await repo.$.fs.stat(e.path) }));
  on("fs.write", (_$, e) => {
    if (e.path === COMMENTS_PATH) world.comments = e.text;
    return { value: undefined };
  });
  on("process.run", async (_$, e) => {
    if (repo.top !== null && e.argv.includes("--absolute-git-dir"))
      return { value: { exitCode: 0, stdout: `${TOP}/.git\n`, stderr: "" } } as never;
    return { value: await repo.$.process.run(e.argv, e.init) };
  });
  return world;
}

function commentsText(world: World): string {
  if (world.comments === undefined) throw new Error("no such file");
  return world.comments;
}

function paneProps(columns: number) {
  return {
    title: "Session",
    isFocused: false,
    bodyColumns: columns,
    placement: "dock" as const,
    scroll: { offset: 0, bodyRows: ROWS },
    view: {},
  };
}

async function openReview($: Engine, world: World, columns: number, scope: string): Promise<Pane> {
  const pane = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: "session",
    props: paneProps(columns),
    viewport: { columns, rows: ROWS },
  });
  for (let page = 0; page < TAB_PAGES && !(await barHasReview(pane)); page++)
    await pressNextTabs(pane, world);
  if ((await labels(pane)).includes(REVIEW_LABEL)) await pressNamed(pane, world, REVIEW_LABEL);
  if ((await labels(pane)).includes(scope)) await pressNamed(pane, world, scope);
  return pane;
}

async function pressNextTabs(pane: Pane, world: World): Promise<void> {
  const target = (await buttons(pane)).find((button) => plainLabel(button).endsWith(RIGHT_ARROW));
  expect(target, "the next tabs arrow").toBeDefined();
  await pane.press({ key: String(target?.props?.key) });
  await settle(pane, world);
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
  return raw.replace(/^\[\s*|\s*\]$/g, "").trim();
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
