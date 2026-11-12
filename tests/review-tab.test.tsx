import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, MockClock, Mounted } from "claude-code/testing";

import { inkFor, paneInk } from "../hooks/pane-ink";
import type { Activity } from "../types";
import { collect, rowGapOf, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import {
  HEAD_SHA,
  INNER_DIR,
  MERGE_BASE_SHA,
  SUBMODULE_DIR,
  TOP,
  nestedRepoOf,
  numbered,
  repoOf,
  treeOf,
} from "./review-world";
import type { Repo } from "./review-world";
import { rowsOf, scrollListBy } from "./pane-keys-kit";
import { linesOf } from "./skills-tree";

type Pane = Mounted<"terminal", "Pane">;
type Scope = "session" | "uncommitted" | "main";
type World = {
  repo: Repo;
  clock: MockClock;
  comments: string | undefined;
  commentWrites: number;
  submitted: string[];
  toolCalls: string[];
  opened: { id: string; focus: boolean | undefined; backgroundColor: string | undefined }[];
  state: Map<string, { value: unknown; version: number }>;
  toolReply:
    | { result: unknown; text: string; isError?: undefined }
    | { isError: true; result: unknown; text: string };
};
type Saved = {
  id: string;
  file: string;
  line: number;
  side: "new" | "old";
  code: string;
  text: string;
  resolved: boolean;
};

const NOW = 1_000_000;
const ROWS = 40;
const NARROW = 30;
const FORTY_EIGHT = 48;
const FIFTY_NINE = 59;
const MEDIUM = 60;
const WIDE = 120;
const GUTTER = 1;
const FLUSH_MS = 400;
const SETTLE_TICKS = 5;
const TAB_PAGES = 12;
const COMMENTS_PATH = `${TOP}/.git/paneline-review.json`;
const RIGHT_ARROW = "›";
const REVIEW_LABEL = "Review";
const APP = "src/app.ts";
const UTIL = "src/util.ts";
const GUIDE = "docs/guide.md";
const APP_LINES = 30;
const UTIL_LINES = 10;
const APP_FIRST_LINE = 3;
const APP_SECOND_LINE = 25;
const APP_FIRST = "app three changed";
const APP_SECOND = "app twenty-five changed";
const UTIL_EDIT = "util five changed";
const GUIDE_OLD = "guide v1\n";
const GUIDE_NEW = "guide v2\n";
const NOTE = "rename this";
const OTHER_NOTE = "split this";
const GONE_CODE = "a line nobody has any more";
const GONE_LINE = 99;
const MOVED_CODE = "LINE FIVE";
const MOVED_FROM = 5;
const TWIN_CODE = "twin line";
const TWIN_EARLY = 4;
const TWIN_LATE = 9;
const NEAR_EARLY = 5;
const NEAR_LATE = 8;
const HUGE_LINES = 2000;
const HUGE_FILE = "src/huge.ts";
const SCROLLED_TO = 1500;
const SCROLL_SLACK = 100;
const WINDOW_LIMIT = 200;
const LONG_DIR = "packages/very-long-directory-name/src/components";
const LONG_NAME = "DeeplyNested.tsx";
const LONG_EXTENSION = ".tsx";
const LONG_PATH = `${LONG_DIR}/${LONG_NAME}`;
const CUT_LINES = 640;
const CUT_CHANGED = 600;
const CUT_FAR = 638;
const CUT_PAD = 100;
const CUT_END_OFFSET = CUT_CHANGED * 2 - 10;
const BINARY = "assets/logo.png";
const NEW_FILE = "src/new.ts";
const EMPTY_FILE = "src/empty.ts";
const MODE_FILE = "scripts/run.sh";
const GONE_FILE = "src/gone.ts";
const APPLY_FAILED = "patch does not apply";
const RESOLVE_TOOL = "mcp__paneline__resolve_review_comment";
const BASH_FILE = "x.txt";
const BASH_WRITE = "echo hi > x.txt";
const BASH_FAILED_WRITE = "echo hi > x.txt && exit 1";
const BASH_OUTSIDE_WRITE = "echo hi > /elsewhere/notes.md";
const BASH_FAILURE = "exit status 1";
const LIST_SCROLL_ROWS = 7;
const TOOL_OK = { result: "ok", text: "ok" };
const HOOK = "hooks/review-draw.tsx";
const COMMENT_WIDTH = 49;
const LONG_NOTE = "make this a constant so every caller shares one value";
const LINE_FOUR = 4;
const LINE_TWELVE = 12;
const LIGHT_ANSI = "light-ansi";
const REVERT_FILE_QUESTION = "revert file?";
const REVERT_HUNK_QUESTION = "revert hunk?";
const COMMENT_HINT = "click a diff line to comment";
const INNER_FILE = `${INNER_DIR}/n.txt`;
const SUBMODULE_FILE = `${SUBMODULE_DIR}/x.ts`;
const OLD_FILE = "src/old.ts";
const ELSEWHERE = "/elsewhere/notes.md";
const MARK_REVIEWED = "mark reviewed";
const REVIEWED = "✓ reviewed";
const NOT_IN_DIFF = "not in git diff";
const HINT_MISSING_WIDTH = 52;
const WRAP_COLUMNS = 40;
const WRAP_TEXT = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda";
const INSERTED_LINES = 3;
const MOVED_LINE = 10;
const HUNK_START_LINE = 12;
const CHANGED_FOR_HUNK = 15;
const FILES_CHANGED = 4;
const LATER_MTIME = 7;

describe("review tab", () => {
  test("V1 the session scope lists the file the session changed with its status, path and counts", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "session");

    const rows = await shown(pane);

    expect(rows.some((row) => /\b1 file \+2 -2\b/.test(row))).toBe(true);
    expect(rows.some((row) => /^M\b.*src\/app\.ts.*\+2 -2/.test(row))).toBe(true);
    expect(rows.some((row) => row.includes(UTIL))).toBe(false);
  });

  test("V2 pressing uncommitted lists every changed file of the worktree", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "session");

    await pressNamed(pane, world, "uncommitted");

    const rows = await shown(pane);
    expect(rows.some((row) => /\b2 files \+3 -3\b/.test(row))).toBe(true);
    expect(rows.some((row) => row.includes(APP))).toBe(true);
    expect(rows.some((row) => row.includes(UTIL))).toBe(true);
    expect(rows.some((row) => row.includes(GUIDE))).toBe(false);
  });

  test("V3 pressing main lists the files committed since main as well", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");

    await pressNamed(pane, world, "main");

    const rows = await shown(pane);
    expect(rows.some((row) => /\b3 files \+4 -4\b/.test(row))).toBe(true);
    expect(rows.some((row) => row.includes(GUIDE))).toBe(true);
  });

  test("V4 pressing a file opens it with back, previous, next, its position, path, counts and diff lines", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");

    await pressShowing(pane, world, APP);

    const rows = await shown(pane);
    expect(await labels(pane)).toEqual(
      expect.arrayContaining(["back", "<", ">", "revert file", "revert hunk"]),
    );
    expect(rows.some((row) => /\b1\/2\b/.test(row))).toBe(true);
    expect(rows.some((row) => row.includes(APP) && row.includes("+2 -2"))).toBe(true);
    expect(rows.some((row) => row.endsWith(APP_FIRST))).toBe(true);
    expect(rows.some((row) => row.endsWith(APP_SECOND))).toBe(true);
    expect(rows.some((row) => row.includes(UTIL_EDIT))).toBe(false);
  });

  test("V5 pressing next shows the next file and pressing previous brings the first one back", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);

    await pressNamed(pane, world, ">");
    const second = await shown(pane);
    await pressNamed(pane, world, "<");
    const first = await shown(pane);

    expect(second.some((row) => /\b2\/2\b/.test(row))).toBe(true);
    expect(second.some((row) => row.endsWith(UTIL_EDIT))).toBe(true);
    expect(second.some((row) => row.endsWith(APP_FIRST))).toBe(false);
    expect(first.some((row) => /\b1\/2\b/.test(row))).toBe(true);
    expect(first.some((row) => row.endsWith(APP_FIRST))).toBe(true);
  });

  test("V6 pressing back returns from a file to the list", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);

    await pressNamed(pane, world, "back");

    const rows = await shown(pane);
    expect(rows.some((row) => /\b2 files\b/.test(row))).toBe(true);
    expect(rows.some((row) => row.endsWith(APP_FIRST))).toBe(false);
    expect(await labels(pane)).not.toContain("back");
  });

  test("V7 pressing revert on a hunk asks yes or no in the tab and changes nothing yet", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);

    await pressNamed(pane, world, "revert hunk");

    const rows = await shown(pane);
    expect(rows.some((row) => row.startsWith("@@") && row.includes(REVERT_HUNK_QUESTION))).toBe(
      true,
    );
    expect(await labels(pane)).toEqual(expect.arrayContaining(["yes", "no"]));
    expect(world.repo.work.get(APP)).toBe(appEdited());
    expect(world.toolCalls).toEqual([]);
  });

  test("V8 answering yes reverts that hunk in the file and the view redraws with the other hunk only", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);
    await pressNamed(pane, world, "revert hunk");

    await pressNamed(pane, world, "yes");

    expect(world.repo.work.get(APP)).toBe(numbered(APP_LINES, { [APP_SECOND_LINE]: APP_SECOND }));
    const rows = await shown(pane);
    expect(rows.some((row) => row.endsWith(APP_FIRST))).toBe(false);
    expect(rows.some((row) => row.endsWith(APP_SECOND))).toBe(true);
    expect(await labels(pane)).not.toContain("yes");
  });

  test("V9 answering no leaves the file and the diff as they were and removes the question", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);
    await pressNamed(pane, world, "revert hunk");

    await pressNamed(pane, world, "no");

    expect(world.repo.work.get(APP)).toBe(appEdited());
    const rows = await shown(pane);
    expect(rows.some((row) => row.endsWith(APP_FIRST))).toBe(true);
    expect(rows.some((row) => row.includes(REVERT_HUNK_QUESTION))).toBe(false);
    expect(await labels(pane)).toContain("revert hunk");
    expect(await labels(pane)).not.toContain("yes");
  });

  test("V10 reverting a whole file asks the same way and yes puts the file back as committed", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);

    await pressNamed(pane, world, "revert file");
    const asked = await shown(pane);
    expect(await labels(pane)).not.toContain("revert file");
    const untouched = world.repo.work.get(APP);
    await pressNamed(pane, world, "yes");

    expect(
      asked.some(
        (row) =>
          row.startsWith(REVERT_FILE_QUESTION) && row.includes("[ yes ]") && row.includes("[ no ]"),
      ),
    ).toBe(true);
    expect(untouched).toBe(appEdited());
    expect(world.repo.work.get(APP)).toBe(numbered(APP_LINES));
    expect(world.toolCalls).toEqual([]);
  });

  test("V11 reverting a file the session created removes it from disk", async ($, on) => {
    const repo = projectRepo();
    repo.work.set(NEW_FILE, "one\ntwo\nthree\n");
    repo.untracked.add(NEW_FILE);
    const world = worldOf(on, repo);
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, NEW_FILE);

    await pressNamed(pane, world, "revert file");
    await pressNamed(pane, world, "yes");

    expect(world.repo.work.has(NEW_FILE)).toBe(false);
  });

  test("V12 a file the session created offers revert file but no revert for a hunk", async ($, on) => {
    const repo = projectRepo();
    repo.work.set(NEW_FILE, "one\ntwo\nthree\n");
    repo.untracked.add(NEW_FILE);
    const world = worldOf(on, repo);
    const pane = await openReview($, world, WIDE, "uncommitted");

    await pressShowing(pane, world, NEW_FILE);

    const names = await labels(pane);
    expect(names).toContain("revert file");
    expect(names).not.toContain("revert hunk");
    expect((await shown(pane)).some((row) => row.endsWith("two"))).toBe(true);
  });

  test("V13 a binary file shows one binary file row and no hunk revert", async ($, on) => {
    const repo = projectRepo();
    repo.trees.HEAD?.set(BINARY, "old bytes");
    repo.work.set(BINARY, "new bytes");
    repo.binary.add(BINARY);
    const world = worldOf(on, repo);
    const pane = await openReview($, world, WIDE, "uncommitted");

    await pressShowing(pane, world, BINARY);

    const rows = await shown(pane);
    expect(rows.filter((row) => row === "binary file")).toHaveLength(1);
    expect(await labels(pane)).not.toContain("revert hunk");
  });

  test("V14 a revert that git refuses shows the error in red and leaves the file as it was", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);
    const edited = numbered(APP_LINES, {
      [APP_FIRST_LINE]: "edited again meanwhile",
      [APP_SECOND_LINE]: APP_SECOND,
    });
    world.repo.work.set(APP, edited);

    await pressNamed(pane, world, "revert hunk");
    await pressNamed(pane, world, "yes");

    const failure = collect((await pane.drawn()) as Node, "Text").find((node) =>
      textOf(node).includes(APPLY_FAILED),
    );
    expect(failure, "a row with the git error").toBeDefined();
    expect(failure?.props?.color).toBe(paneInk().failed);
    expect(world.repo.work.get(APP)).toBe(edited);
  });

  test("V15 pressing a diff line opens a comment field named after the line", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);

    await pressShowing(pane, world, APP_FIRST);

    const inputs = await pane.findAll({ type: "Input" });
    expect(inputs).toHaveLength(1);
    expect(JSON.stringify(await pane.drawn())).toContain(`comment on line ${APP_FIRST_LINE}`);
  });

  test("V16 typing a comment and submitting saves it for the file and line, shows it under the line and sends nothing to the chat", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);
    await pressShowing(pane, world, APP_FIRST);

    await submitComment(pane, world, NOTE);

    expect(savedOf(world)).toEqual([
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
    const rows = await shown(pane);
    const lineAt = rows.findIndex((row) => row.endsWith(APP_FIRST));
    const noteAt = rows.findIndex((row) => row.includes(NOTE));
    expect(noteAt).toBe(lineAt + 1);
    expect(
      collect((await pane.drawn()) as Node, "Text").find((n) => textOf(n).includes(NOTE))?.props
        ?.color,
    ).toBe(paneInk().text);
    expect(await pane.findAll({ type: "Input" })).toHaveLength(0);
    expect(world.submitted).toEqual([]);
    expect(world.toolCalls).toEqual([]);
  });

  test("V17 a comment on a removed line is saved against the old side and old line number", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);

    await pressShowing(pane, world, "line 3");
    await submitComment(pane, world, NOTE);

    expect(savedOf(world)).toEqual([
      {
        id: "c1",
        file: APP,
        line: APP_FIRST_LINE,
        side: "old",
        code: "line 3",
        text: NOTE,
        resolved: false,
      },
    ]);
  });

  test("V18 submitting an empty comment closes the field and saves nothing", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);
    await pressShowing(pane, world, APP_FIRST);

    await submitComment(pane, world, "");

    expect(await pane.findAll({ type: "Input" })).toHaveLength(0);
    expect(world.commentWrites).toBe(0);
    expect(world.comments).toBeUndefined();
  });

  test("V19 pressing another line moves the comment field there instead of opening a second one", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);
    await pressShowing(pane, world, APP_FIRST);

    await pressShowing(pane, world, APP_SECOND);

    const inputs = await pane.findAll({ type: "Input" });
    const drawn = JSON.stringify(await pane.drawn());
    expect(inputs).toHaveLength(1);
    expect(drawn).toContain(`comment on line ${APP_SECOND_LINE}`);
    expect(drawn).not.toContain(`comment on line ${APP_FIRST_LINE}`);
  });

  test("V20 an open comment shows in the text colour and a resolved one shows muted with a check and the word resolved", async ($, on) => {
    const world = worldOf(on, projectRepo());
    world.comments = JSON.stringify([
      commentOn(APP_FIRST_LINE, APP_FIRST, NOTE, { id: "c1", resolved: true }),
      commentOn(APP_SECOND_LINE, APP_SECOND, OTHER_NOTE, { id: "c2" }),
    ]);
    const pane = await openReview($, world, WIDE, "uncommitted");

    await pressShowing(pane, world, APP);

    const rows = await shown(pane);
    const texts = collect(await pane.drawn(), "Text");
    const resolved = texts.find((node) => textOf(node).includes(NOTE));
    const open = texts.find((node) => textOf(node).includes(OTHER_NOTE));
    expect(rows.some((row) => row.includes(NOTE) && row.endsWith("✓ resolved"))).toBe(true);
    expect(rows.some((row) => row.includes(OTHER_NOTE) && row.includes("resolved"))).toBe(false);
    expect(resolved?.props?.color).toBe(paneInk().muted);
    expect(open?.props?.color).toBe(paneInk().text);
  });

  test("V21 a comment whose line is no longer in the diff is listed at the top of the file as outdated with its stored line", async ($, on) => {
    const world = worldOf(on, projectRepo());
    world.comments = JSON.stringify([commentOn(GONE_LINE, GONE_CODE, NOTE, { id: "c1" })]);
    const pane = await openReview($, world, WIDE, "uncommitted");

    await pressShowing(pane, world, APP);

    const rows = await shown(pane);
    const headerAt = rows.indexOf("outdated");
    const commentAt = rows.findIndex((row) => row.includes(`line ${GONE_LINE}`));
    const firstLineAt = rows.findIndex((row) => row.endsWith(APP_FIRST));
    expect(headerAt).toBeGreaterThanOrEqual(0);
    expect(rows[commentAt]).toContain(`line ${GONE_LINE} · ${NOTE}`);
    expect(commentAt).toBeGreaterThan(headerAt);
    expect(commentAt).toBeLessThan(firstLineAt);
  });

  test("V22 a file with an open comment stays in the list where it has no diff, with no counts, and opens with the comment as outdated", async ($, on) => {
    const world = worldOf(on, projectRepo());
    world.comments = JSON.stringify([
      { ...commentOn(1, "guide v2", NOTE, { id: "c1" }), file: GUIDE },
    ]);
    const pane = await openReview($, world, WIDE, "uncommitted");

    const list = await shown(pane);
    await pressShowing(pane, world, GUIDE);
    const view = await shown(pane);

    expect(list.some((row) => row.includes(GUIDE) && row.includes("✎ 1"))).toBe(true);
    expect(list.some((row) => row.includes(GUIDE) && row.includes("+0"))).toBe(false);
    expect(view.some((row) => row.includes("+0"))).toBe(false);
    const headerAt = view.indexOf("outdated");
    const commentAt = view.findIndex((row) => row.includes("line 1") && row.includes(NOTE));
    expect(headerAt).toBeGreaterThanOrEqual(0);
    expect(commentAt).toBeGreaterThan(headerAt);
  });

  test("V23 the list row of a file shows how many open comments it has and does not count resolved ones", async ($, on) => {
    const world = worldOf(on, projectRepo());
    world.comments = JSON.stringify([
      commentOn(APP_FIRST_LINE, APP_FIRST, NOTE, { id: "c1" }),
      commentOn(APP_SECOND_LINE, APP_SECOND, OTHER_NOTE, { id: "c2", resolved: true }),
      commentOn(APP_SECOND_LINE, APP_SECOND, NOTE, { id: "c3" }),
    ]);
    const pane = await openReview($, world, WIDE, "uncommitted");

    const rows = await shown(pane);

    expect(rows.some((row) => row.includes(APP) && /✎ 2\s+\+2 -2$/.test(row))).toBe(true);
    expect(rows.some((row) => row.includes(UTIL) && row.endsWith("+1 -1"))).toBe(true);
  });

  test("V24 a 2000-line new file opens drawing only the rows in view, and scrolling shows the rows further down", async ($, on) => {
    const repo = projectRepo();
    repo.work.set(HUGE_FILE, hugeFile());
    repo.untracked.add(HUGE_FILE);
    const world = worldOf(on, repo);
    const pane = await openReview($, world, WIDE, "uncommitted");

    await pressShowing(pane, world, HUGE_FILE);
    const top = await hugeRows(pane);
    await pane.redraw(paneProps(WIDE, SCROLLED_TO));
    await settle(pane, world);
    const down = await hugeRows(pane);

    expect(top).toContain(1);
    expect(top.length).toBeLessThan(WINDOW_LIMIT);
    expect(down.length).toBeGreaterThan(0);
    expect(down.length).toBeLessThan(WINDOW_LIMIT);
    expect(down).not.toContain(1);
    expect(Math.min(...down)).toBeGreaterThan(SCROLLED_TO - SCROLL_SLACK);
    expect(Math.max(...down)).toBeLessThan(SCROLLED_TO + SCROLL_SLACK);
  });

  test("V25 a diff too long to show whole ends with a row saying how many lines are not shown", async ($, on) => {
    const world = worldOf(on, cutRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");

    await pressShowing(pane, world, "cut.ts");
    await pane.redraw(paneProps(WIDE, CUT_END_OFFSET));
    await settle(pane, world);

    const rows = await shown(pane);
    expect(rows.filter((row) => /^… \d+ more lines?$/.test(row))).toHaveLength(1);
    expect(rows.some((row) => row.includes("fresh-far"))).toBe(false);
  });

  test("V26 at 30 columns the buttons are whole and a long path is cut from its start, keeping the file name", async ($, on) => {
    const world = worldOf(on, longPathRepo());
    const pane = await openReview($, world, NARROW, "uncommitted");

    const listPath = await pathCell(pane);
    expect((await shown(pane)).some((row) => /session\s+uncommitted\s+main/.test(row))).toBe(true);
    expect(clippedFromStart(listPath, NARROW)).toBe(true);
    expect(
      (await shown(pane)).some((row) => row.includes(LONG_NAME) && row.includes("+1 -1")),
    ).toBe(true);

    await pressShowing(pane, world, LONG_NAME);

    expect(await labels(pane)).toEqual(
      expect.arrayContaining(["back", "<", ">", "revert file", "revert hunk"]),
    );
    expect(cutFromStart(await pathCell(pane), NARROW)).toBe(true);
    expect(await navRowWidth(pane)).toBeLessThanOrEqual(NARROW - GUTTER);
  });

  test("V27 at 60 columns the buttons are whole and a long path is cut from its start, keeping the file name", async ($, on) => {
    const world = worldOf(on, longPathRepo());
    const pane = await openReview($, world, MEDIUM, "uncommitted");

    const listPath = await pathCell(pane);
    expect(clippedFromStart(listPath, MEDIUM)).toBe(true);
    expect((await shown(pane)).some((row) => /session\s+uncommitted\s+main/.test(row))).toBe(true);

    await pressShowing(pane, world, LONG_NAME);

    expect(await labels(pane)).toEqual(
      expect.arrayContaining(["back", "<", ">", "revert file", "revert hunk"]),
    );
    expect(clippedFromStart(await pathCell(pane), MEDIUM)).toBe(true);
    expect(await navRowWidth(pane)).toBeLessThanOrEqual(MEDIUM - GUTTER);
  });

  test("V28 at 120 columns the whole path is shown in the list and in the file view", async ($, on) => {
    const world = worldOf(on, longPathRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");

    const listPath = await pathCell(pane);
    await pressShowing(pane, world, LONG_NAME);
    const viewPath = await pathCell(pane);

    expect(cellText(listPath)).toContain(LONG_PATH);
    expect(cellText(viewPath)).toContain(LONG_PATH);
    expect(await labels(pane)).toEqual(
      expect.arrayContaining(["back", "<", ">", "revert file", "revert hunk"]),
    );
  });

  test("V29 a worktree with nothing changed shows no changes", async ($, on) => {
    const repo = projectRepo();
    for (const [path, text] of repo.trees.HEAD ?? []) repo.work.set(path, text);
    const world = worldOf(on, repo);

    const pane = await openReview($, world, WIDE, "uncommitted");

    const rows = await shown(pane);
    expect(rows).toContain("no changes");
    expect(rows.some((row) => /\bfiles?\b.*\+\d/.test(row))).toBe(false);
  });

  test("V30 a folder that is not a git repository shows not a git repo", async ($, on) => {
    const world = worldOf(on, repoOf({ top: null }));

    const pane = await openReview($, world, WIDE, "uncommitted");

    expect(await shown(pane)).toContain("not a git repo");
  });

  test("V31 pressing main in a repository with no main branch shows no main branch", async ($, on) => {
    const repo = projectRepo();
    repo.mergeBases = {};
    const world = worldOf(on, repo);
    const pane = await openReview($, world, WIDE, "uncommitted");

    await pressNamed(pane, world, "main");

    expect(await shown(pane)).toContain("no main branch");
  });

  test("V32 a dirty file whose only Edit failed is not listed in the session scope", async ($, on) => {
    const world = worldOf(on, projectRepo());
    world.state.set("activity", {
      value: [edit(`${TOP}/${APP}`), { ...edit(`${TOP}/${UTIL}`), isErrored: true }],
      version: 1,
    });
    const pane = await openReview($, world, WIDE, "session");

    const rows = await shown(pane);

    expect(rows.some((row) => /^M\b.*src\/app\.ts/.test(row))).toBe(true);
    expect(rows.some((row) => row.includes(UTIL))).toBe(false);
  });

  test("V33 a dirty file whose Edit succeeded is listed in the session scope with its counts", async ($, on) => {
    const world = worldOf(on, projectRepo());
    world.state.set("activity", {
      value: [edit(`${TOP}/${APP}`), edit(`${TOP}/${UTIL}`)],
      version: 1,
    });
    const pane = await openReview($, world, WIDE, "session");

    const rows = await shown(pane);

    expect(rows.some((row) => /^M\b.*src\/util\.ts.*\+1 -1/.test(row))).toBe(true);
  });

  test("V34 (GH-145 A1) a file a successful Bash call wrote is listed in the session scope", async ($, on) => {
    const world = worldOf(on, projectRepo());
    world.state.delete("activity");
    world.repo.work.set(BASH_FILE, "hi\n");
    world.toolReply = bashWrote(`${TOP}/${BASH_FILE}`);
    await bashRuns($, BASH_WRITE);
    const pane = await openReview($, world, WIDE, "session");

    const rows = await shown(pane);

    expect(rows.some((row) => row.includes(BASH_FILE))).toBe(true);
  });

  test("V35 (GH-145 A2) a file a Bash call wrote before it failed is not listed in the session scope", async ($, on) => {
    const world = worldOf(on, projectRepo());
    world.state.delete("activity");
    world.repo.work.set(BASH_FILE, "hi\n");
    world.toolReply = failedBashWrote(`${TOP}/${BASH_FILE}`);
    await bashRuns($, BASH_FAILED_WRITE);
    const pane = await openReview($, world, WIDE, "session");

    const rows = await shown(pane);

    expect(rows.some((row) => row.includes(BASH_FILE))).toBe(false);
  });

  test("R1 the session scope lists a file Claude changed inside a nested repo or submodule with its counts", async ($, on) => {
    const world = worldOf(on, nestedRepoOf());
    world.state.set("activity", {
      value: [
        edit(`${TOP}/src/a.ts`),
        edit(`${TOP}/${INNER_FILE}`),
        edit(`${TOP}/${SUBMODULE_FILE}`),
      ],
      version: 1,
    });
    const pane = await openReview($, world, WIDE, "session");

    const rows = await shown(pane);

    expect(rows.some((row) => /\b3 files \+4 -0\b/.test(row))).toBe(true);
    expect(rows.some((row) => /^M\b.*inner\/n\.txt.*\+2 -0/.test(row))).toBe(true);
    expect(rows.some((row) => /^M\b.*src\/a\.ts.*\+1 -0/.test(row))).toBe(true);
    expect(rows.some((row) => /^M\b.*vendor\/lib\/x\.ts.*\+1 -0/.test(row))).toBe(true);
  });

  test("R2 the uncommitted scope lists the files changed inside a nested repo or submodule and no row for their folders", async ($, on) => {
    const world = worldOf(on, nestedRepoOf());
    const pane = await openReview($, world, WIDE, "uncommitted");

    const rows = await shown(pane);

    expect(rows.some((row) => /\b3 files \+4 -0\b/.test(row))).toBe(true);
    expect(rows.some((row) => /^M\b.*inner\/n\.txt.*\+2 -0/.test(row))).toBe(true);
    expect(rows.some((row) => /^M\b.*vendor\/lib\/x\.ts.*\+1 -0/.test(row))).toBe(true);
    expect(rows.some((row) => /\b(inner|vendor\/lib)\/?\s+\+0 -0/.test(row))).toBe(false);
  });

  test("R3 a file changed inside a nested repo opens and shows its changed lines as a diff hunk", async ($, on) => {
    const world = worldOf(on, nestedRepoOf());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, INNER_FILE);

    const rows = await shown(pane);

    expect(rows.some((row) => row.includes(INNER_FILE) && row.includes("+2 -0"))).toBe(true);
    expect(rows.some((row) => row.endsWith("keep inner"))).toBe(true);
    expect(rows.some((row) => row.endsWith("inner one added"))).toBe(true);
    expect(rows.some((row) => row.endsWith("inner two added"))).toBe(true);
  });

  test("F1 the agent's resolve call for an open comment shows the row as resolved without any press", async ($, on) => {
    const world = worldOf(on, projectRepo());
    world.comments = JSON.stringify([commentOn(APP_FIRST_LINE, APP_FIRST, NOTE, { id: "c1" })]);
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);
    expect((await shown(pane)).some((row) => row.includes(NOTE) && row.includes("resolved"))).toBe(
      false,
    );

    await agentResolves($, "c1");
    await settle(pane, world);
    await settle(pane, world);

    const rows = await shown(pane);
    expect(rows.some((row) => row.includes(NOTE) && row.includes("resolved"))).toBe(true);
  });

  test("F2 pressing a diff line asks for focus on the pane", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);

    await pressShowing(pane, world, APP_FIRST);

    expect(world.opened.some((request) => request.id === "session" && request.focus === true)).toBe(
      true,
    );
  });

  test("F3 pressing a diff line opens the pane with focus and the panel fill", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);

    await pressShowing(pane, world, APP_FIRST);

    expect(world.opened.at(-1)).toEqual({
      id: "session",
      focus: true,
      backgroundColor: "composerSidebarBackground",
    });
  });

  test("V34 a comment follows its line when a line is inserted above it and is drawn under the line's new position, not as outdated", async ($, on) => {
    const world = worldOf(
      on,
      appRepo(`inserted\n${numbered(APP_LINES, { [MOVED_FROM]: MOVED_CODE })}`),
    );
    world.comments = JSON.stringify([commentOn(MOVED_FROM, MOVED_CODE, NOTE, { id: "c1" })]);
    const pane = await openReview($, world, WIDE, "uncommitted");

    await pressShowing(pane, world, APP);

    const rows = await shown(pane);
    const lineAt = rows.findIndex((row) => row.endsWith(MOVED_CODE));
    expect(rows).not.toContain("outdated");
    expect(rows[lineAt + 1]).toContain(NOTE);
    expect(rows.filter((row) => row.includes(NOTE))).toHaveLength(1);
  });

  test("V35 a comment whose line text is no longer anywhere on its side is listed as outdated", async ($, on) => {
    const world = worldOf(
      on,
      appRepo(numbered(APP_LINES, { [MOVED_FROM]: `${MOVED_CODE} EDITED` })),
    );
    world.comments = JSON.stringify([commentOn(MOVED_FROM, MOVED_CODE, NOTE, { id: "c1" })]);
    const pane = await openReview($, world, WIDE, "uncommitted");

    await pressShowing(pane, world, APP);

    const rows = await shown(pane);
    const headerAt = rows.indexOf("outdated");
    const commentAt = rows.findIndex((row) => row.includes(NOTE));
    expect(headerAt).toBeGreaterThanOrEqual(0);
    expect(commentAt).toBeGreaterThan(headerAt);
    expect(rows[commentAt]).toContain(`line ${MOVED_FROM}`);
  });

  test("V36 with the same text on two lines, a comment stored nearer the earlier one is drawn under the earlier one", async ($, on) => {
    const world = worldOf(on, twinRepo());
    world.comments = JSON.stringify([commentOn(NEAR_EARLY, TWIN_CODE, NOTE, { id: "c1" })]);
    const pane = await openReview($, world, WIDE, "uncommitted");

    await pressShowing(pane, world, APP);

    const rows = await shown(pane);
    const [early = -1, late = -1] = twinRows(rows);
    expect(rows).not.toContain("outdated");
    expect(rows[early + 1]).toContain(NOTE);
    expect(rows[late + 1]).not.toContain(NOTE);
  });

  test("V37 with the same text on two lines, a comment stored nearer the later one is drawn under the later one", async ($, on) => {
    const world = worldOf(on, twinRepo());
    world.comments = JSON.stringify([commentOn(NEAR_LATE, TWIN_CODE, NOTE, { id: "c1" })]);
    const pane = await openReview($, world, WIDE, "uncommitted");

    await pressShowing(pane, world, APP);

    const rows = await shown(pane);
    const [early = -1, late = -1] = twinRows(rows);
    expect(rows).not.toContain("outdated");
    expect(rows[late + 1]).toContain(NOTE);
    expect(rows[early + 1]).not.toContain(NOTE);
  });

  test("B1 a new empty file is listed with the changed files as added, counted in the summary, and not under comments only", async ($, on) => {
    const repo = projectRepo();
    repo.work.set(EMPTY_FILE, "");
    repo.untracked.add(EMPTY_FILE);
    const world = worldOf(on, repo);

    const rows = await shown(await openReview($, world, WIDE, "uncommitted"));

    expect(rows.some((row) => /^A\b.*src\/empty\.ts.*\+0 -0/.test(row))).toBe(true);
    expect(rows.some((row) => /\b3 files\b/.test(row))).toBe(true);
    expect(rows.some((row) => row.includes("comments only"))).toBe(false);
  });

  test("B2 a file whose only change is its mode is listed with the changed files as modified, counted in the summary, and not under comments only", async ($, on) => {
    const repo = projectRepo();
    repo.executable.add(GUIDE);
    const world = worldOf(on, repo);

    const rows = await shown(await openReview($, world, WIDE, "uncommitted"));

    expect(rows.some((row) => /^M\b.*docs\/guide\.md.*\+0 -0/.test(row))).toBe(true);
    expect(rows.some((row) => /\b3 files\b/.test(row))).toBe(true);
    expect(rows.some((row) => row.includes("comments only"))).toBe(false);
  });

  test("B3 a deleted empty file is listed with the changed files as deleted, counted in the summary, and not under comments only", async ($, on) => {
    const repo = goneRepo();
    const world = worldOf(on, repo);

    const rows = await shown(await openReview($, world, WIDE, "uncommitted"));

    expect(rows.some((row) => /^D\b.*src\/gone\.ts.*\+0 -0/.test(row))).toBe(true);
    expect(rows.some((row) => /\b3 files\b/.test(row))).toBe(true);
    expect(rows.some((row) => row.includes("comments only"))).toBe(false);
  });

  test("B4 a file with an open comment and no change stays under comments only and is not counted in the summary", async ($, on) => {
    const world = worldOf(on, projectRepo());
    world.comments = JSON.stringify([
      { ...commentOn(1, "guide v2", NOTE, { id: "c1" }), file: GUIDE },
    ]);

    const rows = await shown(await openReview($, world, WIDE, "uncommitted"));

    const headerAt = rows.findIndex((row) => row.includes("comments only"));
    const guideAt = rows.findIndex((row) => row.includes(GUIDE));
    expect(headerAt).toBeGreaterThanOrEqual(0);
    expect(guideAt).toBeGreaterThan(headerAt);
    expect(rows.some((row) => /\b2 files\b/.test(row))).toBe(true);
  });

  test("B5 opening a new empty file says it was created empty, and revert file asks first and then removes it", async ($, on) => {
    const repo = projectRepo();
    repo.work.set(EMPTY_FILE, "");
    repo.untracked.add(EMPTY_FILE);
    const world = worldOf(on, repo);
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, EMPTY_FILE);

    const opened = await shown(pane);
    await pressNamed(pane, world, "revert file");
    const asked = await shown(pane);
    const untouched = world.repo.work.has(EMPTY_FILE);
    await pressNamed(pane, world, "yes");

    expect(opened.some((row) => row.includes("created empty"))).toBe(true);
    expect(opened.some((row) => row.includes("no changes in this scope"))).toBe(false);
    expect(asked.some((row) => /^revert .*\?/.test(row))).toBe(true);
    expect(untouched).toBe(true);
    expect(world.repo.work.has(EMPTY_FILE)).toBe(false);
  });

  test("B6 opening a mode-only change says mode change, and revert file asks first and then puts the old mode back", async ($, on) => {
    const repo = projectRepo();
    repo.executable.add(GUIDE);
    const world = worldOf(on, repo);
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, GUIDE);

    const opened = await shown(pane);
    await pressNamed(pane, world, "revert file");
    const asked = await shown(pane);
    const untouched = world.repo.executable.has(GUIDE);
    await pressNamed(pane, world, "yes");

    expect(opened.some((row) => row.includes("mode change"))).toBe(true);
    expect(opened.some((row) => row.includes("no changes in this scope"))).toBe(false);
    expect(asked.some((row) => /^revert .*\?/.test(row))).toBe(true);
    expect(untouched).toBe(true);
    expect(world.repo.executable.has(GUIDE)).toBe(false);
    expect(world.repo.work.get(GUIDE)).toBe(GUIDE_NEW);
  });

  test("B8 a mode-only file that also has an open comment is listed with the changed files, not under comments only", async ($, on) => {
    const repo = projectRepo();
    repo.executable.add(GUIDE);
    const world = worldOf(on, repo);
    world.comments = JSON.stringify([
      { ...commentOn(1, "guide v2", NOTE, { id: "c1" }), file: GUIDE },
    ]);

    const rows = await shown(await openReview($, world, WIDE, "uncommitted"));

    expect(rows.some((row) => /^M\b.*docs\/guide\.md/.test(row))).toBe(true);
    expect(rows.some((row) => /\b3 files\b/.test(row))).toBe(true);
    expect(rows.some((row) => row.includes("comments only"))).toBe(false);
  });

  test("B9 opening a deleted empty file says it was deleted, and revert file asks first and then brings it back", async ($, on) => {
    const world = worldOf(on, goneRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, GONE_FILE);

    const opened = await shown(pane);
    await pressNamed(pane, world, "revert file");
    const asked = await shown(pane);
    const untouched = world.repo.work.has(GONE_FILE);
    await pressNamed(pane, world, "yes");

    expect(opened.some((row) => row.includes("deleted") && !row.includes(GONE_FILE))).toBe(true);
    expect(opened.some((row) => row.includes("no changes in this scope"))).toBe(false);
    expect(asked.some((row) => /^revert .*\?/.test(row))).toBe(true);
    expect(untouched).toBe(false);
    expect(world.repo.work.get(GONE_FILE)).toBe("");
  });

  test("S1 the list draws the folder of a path grey, the file name in text, and the counts of every file row in one column", async ($, on) => {
    const world = worldOf(on, listRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");

    const rows = await shown(pane);
    const hook = rows.find((row) => row.includes(HOOK)) ?? "";
    const app = rows.find((row) => row.includes(APP)) ?? "";
    const pathButton = (await buttons(pane)).find((button) => textOf(button).includes(HOOK));
    expect(pathButton, "a press target showing the path").toBeDefined();
    const pieces = collect(pathButton as Node, "Text");

    expect(pieces.find((node) => textOf(node) === "hooks/")?.props?.color).toBe(paneInk().muted);
    expect(pieces.find((node) => textOf(node) === "review-draw.tsx")?.props?.color).toBe(
      paneInk().text,
    );
    expect(hook).toContain("+2000 -0");
    expect(app).toContain("+2 -1");
    for (const path of [EMPTY_FILE, MODE_FILE]) {
      expect(rows.find((line) => line.includes(path)) ?? "", `the row of ${path}`).toContain(
        "+0 -0",
      );
    }
    const cells = collect(await pane.drawn(), "Text").map((node) => textOf(node));
    expect(cells, "the added counts padded to one width").toContain("+2000");
    expect(cells).toContain("   +2");
    expect(cells).toContain("   +0");
  });

  test("S2 the open comment counts draw in the warning colour, and a file with only comments shows no +0", async ($, on) => {
    const world = worldOf(on, projectRepo());
    world.comments = JSON.stringify([
      commentOn(APP_FIRST_LINE, APP_FIRST, NOTE, { id: "c1" }),
      commentOn(APP_SECOND_LINE, APP_SECOND, OTHER_NOTE, { id: "c2" }),
      { ...commentOn(1, "guide v2", NOTE, { id: "c3" }), file: GUIDE },
    ]);
    const pane = await openReview($, world, WIDE, "uncommitted");

    const tails = (await buttons(pane))
      .flatMap((button) => collect(button, "Text"))
      .filter((node) => textOf(node).trim().startsWith("✎"));
    const rows = await shown(pane);

    expect(tails.map((node) => textOf(node).trim())).toEqual(["✎ 2", "✎ 1"]);
    expect(tails.map((node) => node.props?.color)).toEqual([paneInk().alert, paneInk().alert]);
    const guide = rows.find((row) => row.includes(GUIDE)) ?? "";
    expect(guide).toContain("✎ 1");
    expect(guide).not.toContain("+0");
  });

  test("S3 the summary row shows the file count in bold text", async ($, on) => {
    const world = worldOf(on, listRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");

    const count = collect(await pane.drawn(), "Text").find((node) => textOf(node) === "6");

    expect((await shown(pane)).some((row) => row.startsWith("6 files +2004 -3"))).toBe(true);
    expect(count?.props?.weight).toBe("semibold");
    expect(count?.props?.color).toBe(paneInk().text);
  });

  test("S4 at 49 columns a long open comment wraps with its mark in the warning colour and a rail under it, and a resolved comment ends with the check", async ($, on) => {
    const world = worldOf(on, projectRepo());
    world.comments = JSON.stringify([
      commentOn(APP_FIRST_LINE, APP_FIRST, LONG_NOTE, { id: "c1" }),
      commentOn(APP_SECOND_LINE, APP_SECOND, NOTE, { id: "c2", resolved: true }),
    ]);
    const pane = await openReview($, world, COMMENT_WIDTH, "uncommitted");
    await pressShowing(pane, world, APP);

    const rows = await drawnRows(pane);
    const lead = rows.findIndex((row) => row.includes("✎ make this"));
    expect(lead, "the open comment's first row").toBeGreaterThanOrEqual(0);
    const rail = rows[lead + 1] ?? "";
    expect(rail.indexOf("│"), "the rail under the mark").toBe(rows[lead]?.indexOf("✎"));
    expect(rail.indexOf("one"), "the wrapped text under the first row's text").toBe(
      rows[lead]?.indexOf("make"),
    );
    const texts = collect(await pane.drawn(), "Text");
    expect(texts.find((node) => textOf(node).includes("✎"))?.props?.color).toBe(paneInk().alert);
    expect(texts.find((node) => textOf(node).includes("│"))?.props?.color).toBe(paneInk().rule);
    expect(rows.some((row) => row.includes(NOTE) && row.endsWith("✓ resolved"))).toBe(true);
  });

  test("S5 outdated comments are listed in line order with their line numbers padded to one width", async ($, on) => {
    const world = worldOf(on, projectRepo());
    world.comments = JSON.stringify([
      commentOn(LINE_TWELVE, GONE_CODE, NOTE, { id: "c1" }),
      commentOn(LINE_FOUR, GONE_CODE, OTHER_NOTE, { id: "c2" }),
    ]);
    const pane = await openReview($, world, WIDE, "uncommitted");

    await pressShowing(pane, world, APP);

    const rows = await shown(pane);
    const fourAt = rows.findIndex((row) => row.includes(`line ${LINE_FOUR} · ${OTHER_NOTE}`));
    const twelveAt = rows.findIndex((row) => row.includes(`line ${LINE_TWELVE} · ${NOTE}`));
    expect(fourAt).toBeGreaterThanOrEqual(0);
    expect(twelveAt).toBeGreaterThan(fourAt);
    const cells = collect(await pane.drawn(), "Text").map((node) => textOf(node));
    expect(cells, "the outdated line numbers padded to one width").toContain(
      `line  ${LINE_FOUR} · `,
    );
    expect(cells).toContain(`line ${LINE_TWELVE} · `);
  });

  test("S6 pressing revert on a hunk turns that hunk's own row into the question, bold red, and the row count stays the same", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);
    const before = await shown(pane);

    await pressNamed(pane, world, "revert hunk");

    const after = await shown(pane);
    expect(after).toHaveLength(before.length);
    const question = after.find((row) => row.includes(REVERT_HUNK_QUESTION));
    expect(question?.startsWith("@@")).toBe(true);
    expect(question).toMatch(/\[ yes \].*\[ no \]/);
    const words = collect(await pane.drawn(), "Text").find((node) =>
      textOf(node).includes(REVERT_HUNK_QUESTION),
    );
    expect(words?.props?.weight).toBe("semibold");
    expect(words?.props?.color).toBe(paneInk().failed);
  });

  test("S6 pressing revert file turns that button's row into the question and the row count stays the same", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);
    const before = await shown(pane);

    await pressNamed(pane, world, "revert file");

    const after = await shown(pane);
    expect(after).toHaveLength(before.length);
    const question = after.find((row) => row.includes(REVERT_FILE_QUESTION));
    expect(question?.startsWith(REVERT_FILE_QUESTION)).toBe(true);
    expect(question).toMatch(/\[ yes \].*\[ no \]/);
    expect(await labels(pane)).not.toContain("revert file");
  });

  test("S7 under light-ansi the open and resolved comment marks and the rail show, and every colour the review tab draws is a terminal colour", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const stored = new Map<string, unknown>();
    on("store.get", (_$, e) => ({ value: stored.get(e.key) }));
    on("store.set", (_$, e) => {
      stored.set(e.key, e.value);
      return { value: undefined };
    });
    on("session.start", (_$, e) => ({ cwd: e.cwd }));
    on("config.list", () => ({ value: [{ key: "theme", value: LIGHT_ANSI }] }) as never);
    await $.session.start({ cwd: TOP, surface: "terminal", isInteractive: true });
    world.comments = JSON.stringify([
      commentOn(APP_FIRST_LINE, APP_FIRST, LONG_NOTE, { id: "c1" }),
      commentOn(APP_SECOND_LINE, APP_SECOND, NOTE, { id: "c2", resolved: true }),
    ]);
    const pane = await openReview($, world, COMMENT_WIDTH, "uncommitted");
    await pressShowing(pane, world, APP);

    const rows = await shown(pane);
    expect(rows.some((row) => row.includes("✎ make this"))).toBe(true);
    expect(rows.some((row) => row.includes("│"))).toBe(true);
    expect(rows.some((row) => row.endsWith("✓ resolved"))).toBe(true);
    const roles = new Set(
      Object.values(inkFor(LIGHT_ANSI)).filter(
        (value): value is string => typeof value === "string",
      ),
    );
    const colours = collect(await pane.drawn(), "Text").map((node) => node.props?.color);
    expect(colours.filter((colour) => typeof colour === "string" && !roles.has(colour))).toEqual(
      [],
    );
  });

  test("S8 an open comment's mark is in the warning colour with its text in text colour, and a resolved comment is all grey", async ($, on) => {
    const world = worldOf(on, projectRepo());
    world.comments = JSON.stringify([
      commentOn(APP_FIRST_LINE, APP_FIRST, OTHER_NOTE, { id: "c1" }),
      commentOn(APP_SECOND_LINE, APP_SECOND, NOTE, { id: "c2", resolved: true }),
    ]);
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);

    const texts = collect(await pane.drawn(), "Text");
    const marks = texts.filter((node) => textOf(node).includes("✎"));

    expect(marks.map((node) => node.props?.color)).toEqual([paneInk().alert, paneInk().muted]);
    expect(texts.find((node) => textOf(node).includes(OTHER_NOTE))?.props?.color).toBe(
      paneInk().text,
    );
    expect(texts.find((node) => textOf(node).includes(NOTE))?.props?.color).toBe(paneInk().muted);
    expect(texts.find((node) => textOf(node).includes("✓ resolved"))?.props?.color).toBe(
      paneInk().muted,
    );
  });

  test("S9 an outdated open comment has its mark in the warning colour and its text in text colour, and an outdated resolved comment is all grey", async ($, on) => {
    const world = worldOf(on, projectRepo());
    world.comments = JSON.stringify([
      commentOn(LINE_TWELVE, GONE_CODE, NOTE, { id: "c1" }),
      commentOn(LINE_FOUR, GONE_CODE, OTHER_NOTE, { id: "c2", resolved: true }),
    ]);
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);

    const texts = collect(await pane.drawn(), "Text");
    const marks = texts.filter((node) => textOf(node).includes("✎"));

    expect(marks.map((node) => node.props?.color)).toEqual([paneInk().muted, paneInk().alert]);
    expect(texts.find((node) => textOf(node).includes(NOTE))?.props?.color).toBe(paneInk().text);
    expect(texts.find((node) => textOf(node).includes(OTHER_NOTE))?.props?.color).toBe(
      paneInk().muted,
    );
  });

  test("S10 the yes answer to a revert is drawn in the failed colour and the no answer in text colour", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);
    await pressNamed(pane, world, "revert hunk");

    const texts = collect(await pane.drawn(), "Text");

    expect(texts.find((node) => textOf(node) === "yes")?.props?.color).toBe(paneInk().failed);
    expect(texts.find((node) => textOf(node) === "no")?.props?.color).toBe(paneInk().text);
  });

  test("S11 at 48 columns a long path keeps the file name whole, starts at a folder boundary, and leaves two cells before the comment count", async ($, on) => {
    const pane = await openLongPathWithComment($, on, FORTY_EIGHT);

    await expectNameKeptAtFolderBoundary(pane);
  });

  test("S11 at 59 columns a long path keeps the file name whole, starts at a folder boundary, and leaves two cells before the comment count", async ($, on) => {
    const pane = await openLongPathWithComment($, on, FIFTY_NINE);

    await expectNameKeptAtFolderBoundary(pane);
  });

  test("S12 an outdated comment's line number is followed by a muted dot and then the comment text", async ($, on) => {
    const world = worldOf(on, projectRepo());
    world.comments = JSON.stringify([
      commentOn(LINE_TWELVE, GONE_CODE, NOTE, { id: "c1" }),
      commentOn(LINE_FOUR, GONE_CODE, OTHER_NOTE, { id: "c2" }),
    ]);
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);

    const pieces = collect(await pane.drawn(), "Text");
    const label = pieces.find((node) => textOf(node) === `line  ${LINE_FOUR} · `);
    expect(label, "the outdated line number followed by the dot").toBeDefined();
    expect(label?.props?.color).toBe(paneInk().muted);
    expect(pieces.find((node) => textOf(node) === OTHER_NOTE)?.props?.color).toBe(paneInk().text);
  });
  test("S13 the revert button on a hunk header reads revert hunk", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);

    expect(await labels(pane)).toContain("revert hunk");
    expect(
      (await shown(pane)).some((row) => row.startsWith("@@") && row.endsWith("[ revert hunk ]")),
    ).toBe(true);
  });

  test("S14 the file and hunk revert buttons both draw their brackets in grey", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);

    const all = await buttons(pane);
    const fileButton = all.find((button) => plainLabel(button) === "revert file");
    const hunkButton = all.find(
      (button) => plainLabel(button).startsWith("revert") && plainLabel(button) !== "revert file",
    );
    expect(fileButton, "the revert file button").toBeDefined();
    expect(hunkButton, "a revert button on a hunk").toBeDefined();
    const brackets = collect(await pane.drawn(), "Text").filter((node) =>
      ["[ ", " ]"].includes(textOf(node)),
    );
    expect(brackets.length).toBeGreaterThanOrEqual(2);
    expect(brackets.every((node) => node.props?.color === paneInk().muted)).toBe(true);
  });

  test("S15 the file name in the file view's path row is bold and the folder part is not", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);

    const pieces = collect(await pane.drawn(), "Text");
    const name = pieces.find((node) => textOf(node) === "app.ts");
    const folder = pieces.find((node) => textOf(node) === "src/");
    expect(name?.props?.weight).toBe("semibold");
    expect(name?.props?.color).toBe(paneInk().text);
    expect(folder?.props?.weight).toBeUndefined();
    expect(folder?.props?.color).toBe(paneInk().muted);
  });

  test("S16 at 120 columns the file view's nav row ends with the muted hint click a diff line to comment", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);

    const rows = await shown(pane);
    expect(rows.some((row) => row.includes("[ back ]") && row.endsWith(COMMENT_HINT))).toBe(true);
    const hint = collect(await pane.drawn(), "Text").find((node) => textOf(node) === COMMENT_HINT);
    expect(hint?.props?.color).toBe(paneInk().muted);
  });

  test("S17 at 120 columns the hint click a diff line to comment is left out of a file view that only has comments", async ($, on) => {
    const repo = projectRepo();
    repo.work.set(GUIDE, repo.trees.HEAD?.get(GUIDE) ?? "");
    const world = worldOf(on, repo);
    world.comments = JSON.stringify([
      { ...commentOn(1, "guide v2", NOTE, { id: "c1" }), file: GUIDE },
    ]);
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, GUIDE);

    expect((await shown(pane)).some((row) => row.includes(COMMENT_HINT))).toBe(false);
  });

  test("S18 at 120 columns the hint click a diff line to comment is left out of a file view of an empty new file", async ($, on) => {
    const repo = projectRepo();
    repo.work.set(EMPTY_FILE, "");
    repo.untracked.add(EMPTY_FILE);
    const world = worldOf(on, repo);
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, EMPTY_FILE);

    expect((await shown(pane)).some((row) => row.includes(COMMENT_HINT))).toBe(false);
  });

  test("S19 at 120 columns the hint click a diff line to comment is left out of a file view of a mode-only change", async ($, on) => {
    const repo = projectRepo();
    repo.executable.add(GUIDE);
    const world = worldOf(on, repo);
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, GUIDE);

    expect((await shown(pane)).some((row) => row.includes(COMMENT_HINT))).toBe(false);
  });

  test("S20 at 120 columns the hint click a diff line to comment is kept on a file view with diff lines", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);

    expect((await shown(pane)).some((row) => row.includes(COMMENT_HINT))).toBe(true);
  });

  test("S16 at 30 columns the file view's nav row omits the hint click a diff line to comment when it does not fit", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, NARROW, "uncommitted");
    await pressShowing(pane, world, APP);

    const rows = await shown(pane);
    expect(rows.some((row) => row.includes("[ back ]"))).toBe(true);
    expect(rows.some((row) => row.includes(COMMENT_HINT))).toBe(false);
  });
  test("U1 the active scope is a filled chip after a muted scope label and the other two are buttons", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "session");

    const texts = collect(await pane.drawn(), "Text");
    const chip = texts.find((node) => textOf(node) === " session ");
    const label = texts.find((node) => textOf(node).trim() === "scope");

    expect(chip, "the active scope chip").toBeDefined();
    expect(chip?.props?.backgroundColor).toBe(paneInk().tabFill);
    expect(chip?.props?.color).toBe(paneInk().tabText);
    expect(label?.props?.color).toBe(paneInk().muted);
    expect(await labels(pane)).toEqual(expect.arrayContaining(["uncommitted", "main"]));
    expect(await labels(pane)).not.toContain("session");
  });

  test("U1 at 30 columns the scope row drops the label and keeps the chip and both buttons whole", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, NARROW, "uncommitted");

    const texts = collect(await pane.drawn(), "Text");
    const scopeRow = (await shown(pane)).find(
      (row) => row.includes("uncommitted") && row.includes("main"),
    );

    expect(texts.find((node) => textOf(node) === " uncommitted ")?.props?.backgroundColor).toBe(
      paneInk().tabFill,
    );
    expect(texts.some((node) => textOf(node).trim() === "scope")).toBe(false);
    expect(await labels(pane)).toEqual(expect.arrayContaining(["session", "main"]));
    expect(scopeRow).toMatch(/session\s+uncommitted\s+main/);
    expect(scopeRow?.length).toBeLessThanOrEqual(NARROW - GUTTER);
  });

  test("U2 the status letters are green for added, yellow for modified and red for deleted, and the comment count has a space", async ($, on) => {
    const world = worldOf(on, mixedRepo());
    world.comments = JSON.stringify([
      commentOn(1, "line 1", NOTE, { id: "c1", file: UTIL }),
      commentOn(2, "line 2", OTHER_NOTE, { id: "c2", file: UTIL }),
    ]);
    const pane = await openReview($, world, WIDE, "uncommitted");

    const texts = collect(await pane.drawn(), "Text");
    const colorsOf = (letter: string) =>
      texts.filter((node) => textOf(node).trim() === letter).map((node) => node.props?.color);

    expect(colorsOf("M")).toEqual([paneInk().alert, paneInk().alert]);
    expect(colorsOf("A")).toEqual([paneInk().ok]);
    expect(colorsOf("D")).toEqual([paneInk().failed]);
    const tail = texts.find((node) => textOf(node).trim() === "✎ 2");
    expect(tail?.props?.color).toBe(paneInk().alert);
  });

  test("U2 pressing the status letter or the counts of a file row opens that file", async ($, on) => {
    const world = worldOf(on, mixedRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");

    const row = (await buttons(pane)).find((button) => textOf(button).includes(APP));
    const cells = collect(row as Node, "Text").map((node) => textOf(node).trim());

    expect(row, "one button holding the whole row").toBeDefined();
    expect(cells).toContain("M");
    expect(cells).toContain("+2");
    await pane.press({ key: String(row?.props?.key) });
    await settle(pane, world);
    expect(await labels(pane)).toContain("back");
    expect((await shown(pane)).some((line) => /\b1\/4\b/.test(line))).toBe(true);
  });

  test("U2 the counts of two file rows end in the same column", async ($, on) => {
    const world = worldOf(on, listRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");

    const rows = (await buttons(pane)).filter((button) =>
      [HOOK, APP].some((path) => textOf(button).includes(path)),
    );
    const texts = rows.map((row) => textOf(row));

    expect(texts).toHaveLength(2);
    expect(texts[0]).toMatch(/\+2000 -0$/);
    expect(texts[1]).toMatch(/ +\+2 -1$/);
    expect(texts[0]?.length).toBe(texts[1]?.length);
  });

  test("U3 marking a file reviewed shows a green tick in the list and counts it in the header", async ($, on) => {
    const world = worldOf(on, mixedRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);

    await pressNamed(pane, world, MARK_REVIEWED);
    const inView = await labels(pane);
    await pressNamed(pane, world, "back");

    expect(inView).toContain(REVIEWED);
    expect(inView).not.toContain(MARK_REVIEWED);
    expect((await shown(pane)).some((row) => row.includes(`1 of ${FILES_CHANGED} reviewed`))).toBe(
      true,
    );
    expect(await tickColors(pane, APP)).toEqual([paneInk().ok]);
    expect(await tickColors(pane, UTIL)).toEqual([]);
  });

  test("U3 a new edit of a reviewed file by its time clears the tick and the count", async ($, on) => {
    const world = worldOf(on, mixedRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);
    await pressNamed(pane, world, MARK_REVIEWED);
    await pressNamed(pane, world, "back");

    world.repo.mtimes.set(APP, LATER_MTIME);
    await reloadList(pane, world);

    expect(await tickColors(pane, APP)).toEqual([]);
    expect((await shown(pane)).some((row) => row.includes(`0 of ${FILES_CHANGED} reviewed`))).toBe(
      true,
    );
  });

  test("U3 a new edit of a reviewed file by its counts clears the tick and the count", async ($, on) => {
    const world = worldOf(on, mixedRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);
    await pressNamed(pane, world, MARK_REVIEWED);
    await pressNamed(pane, world, "back");

    world.repo.work.set(
      APP,
      numbered(APP_LINES, {
        [APP_FIRST_LINE]: APP_FIRST,
        [APP_SECOND_LINE]: APP_SECOND,
        26: "extra",
      }),
    );
    await reloadList(pane, world);

    expect(await tickColors(pane, APP)).toEqual([]);
    expect((await shown(pane)).some((row) => row.includes(`0 of ${FILES_CHANGED} reviewed`))).toBe(
      true,
    );
  });

  test("U3 pressing reviewed again takes the tick back", async ($, on) => {
    const world = worldOf(on, mixedRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);
    await pressNamed(pane, world, MARK_REVIEWED);

    await pressNamed(pane, world, REVIEWED);
    const inView = await labels(pane);
    await pressNamed(pane, world, "back");

    expect(inView).toContain(MARK_REVIEWED);
    expect(await tickColors(pane, APP)).toEqual([]);
    expect((await shown(pane)).some((row) => row.includes(`0 of ${FILES_CHANGED} reviewed`))).toBe(
      true,
    );
  });

  test("U3 a file with only comments has no reviewed button while a changed file has one", async ($, on) => {
    const world = worldOf(on, projectRepo());
    world.comments = JSON.stringify([
      { ...commentOn(1, "guide v2", NOTE, { id: "c1" }), file: GUIDE },
    ]);
    const pane = await openReview($, world, WIDE, "uncommitted");

    await pressShowing(pane, world, GUIDE);
    const bare = await labels(pane);
    await pressNamed(pane, world, "back");
    await pressShowing(pane, world, APP);
    const changed = await labels(pane);

    expect(bare).not.toContain(MARK_REVIEWED);
    expect(bare).not.toContain(REVIEWED);
    expect(changed).toContain(MARK_REVIEWED);
  });

  test("U3 the reviewed button sits at the right end of the path row after the counts", async ($, on) => {
    const world = worldOf(on, mixedRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);

    const line = linesOf((await pane.drawn()) as Node).find((row) => row.text.includes(APP));

    expect(line?.text).toMatch(/\+2 -2 \[ mark reviewed \]$/);
    expect(rowGapOf(await pane.drawn(), MARK_REVIEWED)).toBeGreaterThanOrEqual(2);
  });

  test("U3 on a narrow pane the path is cut first and the reviewed button stays whole", async ($, on) => {
    const world = worldOf(on, longPathRepo());
    const pane = await openReview($, world, NARROW, "uncommitted");
    await pressShowing(pane, world, LONG_NAME);

    expect(await labels(pane)).toContain(MARK_REVIEWED);
    expect(cutFromStart(await pathCell(pane), NARROW)).toBe(true);
  });

  test("U4 the header counts open comments of the repo and reviewed files, the open count in yellow", async ($, on) => {
    const world = worldOf(on, mixedRepo());
    world.comments = JSON.stringify([
      commentOn(APP_FIRST_LINE, APP_FIRST, NOTE, { id: "c1" }),
      commentOn(APP_SECOND_LINE, APP_SECOND, OTHER_NOTE, { id: "c2" }),
      commentOn(1, "line 1", NOTE, { id: "c3", file: UTIL }),
      commentOn(2, "line 2", NOTE, { id: "c4", file: UTIL, resolved: true }),
    ]);
    const pane = await openReview($, world, WIDE, "uncommitted");

    const row = (await shown(pane)).find((line) => line.startsWith("✎"));
    const count = collect(await pane.drawn(), "Text").find((node) => textOf(node).trim() === "✎ 3");

    expect(row).toContain(`✎ 3 open · 0 of ${FILES_CHANGED} reviewed`);
    expect(count?.props?.color).toBe(paneInk().alert);
  });

  test("U4 with no open comments the header says 0 open and is all muted", async ($, on) => {
    const world = worldOf(on, mixedRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");

    const line = linesOf((await pane.drawn()) as Node).find((row) =>
      row.text.startsWith("✎ 0 open"),
    );

    expect(line, "the header row").toBeDefined();
    const colors = (line?.parts ?? []).flatMap((part) =>
      collect(part, "Text").map((node) => node.props?.color),
    );
    expect(colors.length).toBeGreaterThan(0);
    expect(colors.every((color) => color === paneInk().muted)).toBe(true);
  });

  test("U4 at 120 columns with a changed file the header row ends with the muted hint", async ($, on) => {
    const world = worldOf(on, mixedRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");

    const row = (await shown(pane)).find((line) => line.startsWith("✎"));
    const hint = collect(await pane.drawn(), "Text").find((node) => textOf(node) === COMMENT_HINT);

    expect(row?.endsWith(COMMENT_HINT)).toBe(true);
    expect(hint?.props?.color).toBe(paneInk().muted);
  });

  test("U4 at 30 columns the header row stays and the hint is left out", async ($, on) => {
    const world = worldOf(on, mixedRepo());
    const pane = await openReview($, world, NARROW, "uncommitted");

    const rows = await shown(pane);

    expect(rows.some((row) => row.startsWith("✎ 0 open"))).toBe(true);
    expect(rows.some((row) => row.includes(COMMENT_HINT))).toBe(false);
  });

  test("U4 with only a comment-only file listed the header shows the open count with no reviewed text and no hint", async ($, on) => {
    const repo = projectRepo();
    for (const [path, text] of repo.trees.HEAD ?? []) repo.work.set(path, text);
    const world = worldOf(on, repo);
    world.comments = JSON.stringify([
      { ...commentOn(1, "guide v2", NOTE, { id: "c1" }), file: GUIDE },
    ]);
    const pane = await openReview($, world, WIDE, "uncommitted");

    const rows = await shown(pane);

    expect(rows.some((row) => row.startsWith("✎ 1 open"))).toBe(true);
    expect(rows.some((row) => row.includes("reviewed"))).toBe(false);
    expect(rows.some((row) => row.includes(COMMENT_HINT))).toBe(false);
  });

  test("U5 session edits that git does not show are named under the file rows as plain text", async ($, on) => {
    const world = worldOf(on, projectRepo());
    world.state.set("activity", {
      value: [edit(`${TOP}/${APP}`), edit(ELSEWHERE), edit(`${TOP}/${GUIDE}`)],
      version: 1,
    });
    const pane = await openReview($, world, WIDE, "session");

    const rows = await shown(pane);
    const noteAt = rows.indexOf(`2 edited, ${NOT_IN_DIFF}`);
    const texts = collect(await pane.drawn(), "Text");
    const all = await buttons(pane);

    expect(noteAt).toBeGreaterThan(rows.findIndex((row) => row.includes(APP)));
    expect(rows.slice(noteAt + 1, noteAt + 3).sort()).toEqual([ELSEWHERE, GUIDE].sort());
    expect(texts.find((node) => textOf(node) === ELSEWHERE)?.props?.color).toBe(paneInk().muted);
    expect(texts.find((node) => textOf(node) === GUIDE)?.props?.color).toBe(paneInk().muted);
    expect(all.some((button) => textOf(button).includes("notes.md"))).toBe(false);
    expect(all.some((button) => textOf(button).includes("guide.md"))).toBe(false);
  });

  test("U5 the note appears once a session edit lands outside git and only in the session scope", async ($, on) => {
    const world = worldOf(on, projectRepo());
    world.state.delete("activity");
    world.toolReply = bashWrote(`${TOP}/${APP}`);
    await bashRuns($, BASH_WRITE);
    const pane = await openReview($, world, WIDE, "session");
    const before = await shown(pane);

    world.toolReply = bashWrote(ELSEWHERE);
    await bashRuns($, BASH_OUTSIDE_WRITE);
    await settle(pane, world);
    const session = await shown(pane);
    await pressNamed(pane, world, "uncommitted");
    const uncommitted = await shown(pane);
    await pressNamed(pane, world, "main");
    const main = await shown(pane);

    expect(before.some((row) => row.includes(NOT_IN_DIFF))).toBe(false);
    expect(session).toContain(`1 edited, ${NOT_IN_DIFF}`);
    expect(uncommitted.some((row) => row.includes(NOT_IN_DIFF))).toBe(false);
    expect(main.some((row) => row.includes(NOT_IN_DIFF))).toBe(false);
  });

  test("U6 every diff line has a muted right-aligned line number before its marker", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);

    const four = await diffRow(pane, "line 4");
    const twentyTwo = await diffRow(pane, "line 22");

    expect(four.gutter).toMatch(/^ +4$/);
    expect(twentyTwo.gutter).toBe("22");
    expect(four.gutter.length).toBe(twentyTwo.gutter.length);
    expect(four.texts.find((node) => textOf(node).trim() === "4")?.props?.color).toBe(
      paneInk().muted,
    );
  });

  test("U6 a removed line shows its old number and an added line its new number", async ($, on) => {
    const work = `${"new\n".repeat(INSERTED_LINES)}${numbered(APP_LINES, { [MOVED_LINE]: "line 10 edited" })}`;
    const world = worldOf(on, appRepo(work));
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);

    const removed = await diffRow(pane, "line 10");
    const added = await diffRow(pane, "line 10 edited");

    expect(removed.gutter.trim()).toBe(String(MOVED_LINE));
    expect(added.gutter.trim()).toBe(String(MOVED_LINE + INSERTED_LINES));
    expect(
      added.texts.findLast((node) => textOf(node).includes("line 10 edited"))?.props?.color,
    ).toBe(paneInk().ok);
  });

  test("U6 the second row of a wrapped line starts under its text, clear of the numbers", async ($, on) => {
    const world = worldOf(on, appRepo(numbered(APP_LINES, { 5: WRAP_TEXT })));
    const pane = await openReview($, world, WRAP_COLUMNS, "uncommitted");
    await pressShowing(pane, world, APP);

    const rows = rawRows(await pane.drawn());
    const first = rows.findIndex((row) => row.raw.includes("alpha"));
    const lead = /^(\s*\d+ )[ +-]alpha/.exec(rows[first]?.raw ?? "");
    const next = rows[first + 1]?.raw ?? "";
    const indent = next.length - next.trimStart().length;

    expect(lead, "a first row with a number before the marker").not.toBeNull();
    const textColumn = (lead?.[1]?.length ?? 0) + 1;
    expect(indent).toBeGreaterThanOrEqual(textColumn);
    expect(indent).toBeLessThanOrEqual(textColumn + 2);
  });

  test("U6 the no-newline marker sits under the markers with a blank gutter", async ($, on) => {
    const world = worldOf(on, noEolRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);

    const rows = rawRows(await pane.drawn());
    const added = /^(\s*\d+ )\+c2$/.exec(rows.find((row) => row.raw.endsWith("c2"))?.raw ?? "");
    const marker = rows.find((row) => row.raw.includes("No newline"))?.raw ?? "";

    expect(added, "the added line with a number before its marker").not.toBeNull();
    const markerColumn = added?.[1]?.length ?? 0;
    expect(marker.indexOf("\\")).toBe(markerColumn);
    expect(marker.slice(0, markerColumn).trim()).toBe("");
  });

  test("U7 the hunk of a new file reads @@ line 1 · new file", async ($, on) => {
    const world = worldOf(on, mixedRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");

    await pressShowing(pane, world, NEW_FILE);

    expect((await shown(pane)).some((row) => row.startsWith("@@ line 1 · new file"))).toBe(true);
  });

  test("U7 a hunk in the middle of a file reads @@ line 12 and keeps its revert hunk button on the row", async ($, on) => {
    const world = worldOf(
      on,
      appRepo(numbered(APP_LINES, { [CHANGED_FOR_HUNK]: "fifteen changed" })),
    );
    const pane = await openReview($, world, WIDE, "uncommitted");

    await pressShowing(pane, world, APP);

    const row = (await shown(pane)).find((line) => line.startsWith("@@"));
    expect(row?.startsWith(`@@ line ${HUNK_START_LINE}`)).toBe(true);
    expect(row?.endsWith("[ revert hunk ]")).toBe(true);
    expect(row).not.toContain("file");
    expect(row).not.toContain("-");
  });

  test("U7 the hunk of a deleted file reads @@ line 1 · deleted file", async ($, on) => {
    const world = worldOf(on, deletedRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");

    await pressShowing(pane, world, OLD_FILE);

    expect((await shown(pane)).some((row) => row.startsWith("@@ line 1 · deleted file"))).toBe(
      true,
    );
  });

  test("U8 revert file is the last row of the file view, below every diff line, with a red label", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);

    const rows = await shown(pane);
    const lastLine = rows.findLastIndex((row) => row.endsWith("line 28"));
    const texts = collect(await pane.drawn(), "Text");

    expect(rows.findIndex((row) => row.includes("[ revert file ]"))).toBe(rows.length - 1);
    expect(rows.length - 1).toBeGreaterThan(lastLine);
    expect(texts.find((node) => textOf(node) === "revert file")?.props?.color).toBe(
      paneInk().failed,
    );
  });

  test("U8 pressing revert file turns the bottom row into the question without adding a row", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);
    const before = await shown(pane);

    await pressNamed(pane, world, "revert file");

    const after = await shown(pane);
    expect(after).toHaveLength(before.length);
    expect(after[after.length - 1]).toMatch(/^revert file\? \[ yes \] \[ no \]$/);
  });

  test("U8 answering no brings the revert file button back at the bottom and leaves the file", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);
    await pressNamed(pane, world, "revert file");

    await pressNamed(pane, world, "no");

    const rows = await shown(pane);
    expect(rows[rows.length - 1]).toBe("[ revert file ]");
    expect(world.repo.work.get(APP)).toBe(appEdited());
  });

  test("U9 at 52 columns the file view's nav row has no hint because the new words do not fit", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, HINT_MISSING_WIDTH, "uncommitted");
    await pressShowing(pane, world, APP);

    const row = (await shown(pane)).find((line) => line.includes("[ back ]"));

    expect(row).toBeDefined();
    expect(row).not.toContain("comment");
  });
});

async function agentResolves($: Engine, id: string): Promise<void> {
  await ($.tool.call as (e: object) => Promise<unknown>)({
    tool: RESOLVE_TOOL,
    tool_use_id: `call-${id}`,
    id,
  });
}

function mixedRepo(): Repo {
  const repo = projectRepo();
  repo.work.set(NEW_FILE, "one\ntwo\nthree\n");
  repo.untracked.add(NEW_FILE);
  repo.trees.HEAD?.set(OLD_FILE, "a\nb\n");
  repo.trees[HEAD_SHA]?.set(OLD_FILE, "a\nb\n");
  return repo;
}

function deletedRepo(): Repo {
  const head = { [OLD_FILE]: "x\ny\n" };
  return repoOf({
    trees: { HEAD: treeOf(head), [HEAD_SHA]: treeOf(head) },
    mergeBases: { main: HEAD_SHA },
  });
}

function noEolRepo(): Repo {
  const head = { [APP]: "a\nb\nc\n" };
  return repoOf({
    trees: { HEAD: treeOf(head), [HEAD_SHA]: treeOf(head) },
    work: treeOf({ [APP]: "a\nb\nc2" }),
    mergeBases: { main: HEAD_SHA },
  });
}

async function reloadList(pane: Pane, world: World): Promise<void> {
  await pressNamed(pane, world, "main");
  await pressNamed(pane, world, "uncommitted");
}

async function tickColors(pane: Pane, path: string): Promise<unknown[]> {
  const row = (await buttons(pane)).find((button) => textOf(button).includes(path));
  expect(row, `the row of ${path}`).toBeDefined();
  return collect(row as Node, "Text")
    .filter((node) => textOf(node).trim() === "✓")
    .map((node) => node.props?.color);
}

type RawRow = { raw: string; texts: Node[] };

function rawRows(tree: unknown): RawRow[] {
  return linesOf(tree as Node)
    .filter((line) => line.text !== "")
    .map((line) => ({
      raw: line.parts.map((part) => cellText(part)).join(""),
      texts: line.parts.flatMap((part) => collect(part, "Text")),
    }));
}

async function diffRow(pane: Pane, text: string): Promise<RawRow & { gutter: string }> {
  const row = rawRows(await pane.drawn()).find((candidate) => candidate.raw.endsWith(text));
  expect(row, `a diff row ending with ${text}`).toBeDefined();
  const { raw } = row as RawRow;
  return { ...(row as RawRow), gutter: raw.slice(0, Math.max(0, raw.length - text.length - 2)) };
}

function appEdited(): string {
  return numbered(APP_LINES, { [APP_FIRST_LINE]: APP_FIRST, [APP_SECOND_LINE]: APP_SECOND });
}

describe("review tab back", () => {
  test("A8 back from a file shows the file list at the place it was scrolled to", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    const scrolled = await scrolledRows($, pane, world);
    await pressShowing(pane, world, APP);

    await pressNamed(pane, world, "back");

    expect(await rowsOf(pane)).toEqual(scrolled);
  });

  test("A10 a file opened from a scrolled list shows from its top, the same screen as opening it before scrolling", async ($, on) => {
    const world = worldOf(on, projectRepo());
    const pane = await openReview($, world, WIDE, "uncommitted");
    await pressShowing(pane, world, APP);
    const fresh = await rowsOf(pane);
    await pressNamed(pane, world, "back");
    await scrolledRows($, pane, world);

    await pressShowing(pane, world, APP);

    expect(await rowsOf(pane)).toEqual(fresh);
  });

  test("A29 a file dropped by a refresh while open, then another file opened from a list scrolled to a new place, back shows the list at that new place", async ($, on) => {
    const world = worldOf(on, projectRepo());
    world.state.set("activity", {
      value: [edit(`${TOP}/${APP}`), edit(`${TOP}/${UTIL}`)],
      version: 1,
    });
    const pane = await openReview($, world, WIDE, "session");
    const first = await scrolledRows($, pane, world);
    await pressShowing(pane, world, APP);
    world.state.set("activity", { value: [edit(`${TOP}/${UTIL}`)], version: 1 });
    await settle(pane, world);
    await settle(pane, world);
    expect(await labels(pane)).not.toContain("back");
    await scrollListBy($, pane, LIST_SCROLL_ROWS - 4);
    await settle(pane, world);
    const second = await rowsOf(pane);
    expect(second).not.toEqual(first);
    await pressShowing(pane, world, UTIL);

    await pressNamed(pane, world, "back");

    expect(await rowsOf(pane)).toEqual(second);
  });
});

function projectRepo(): Repo {
  const head = {
    [APP]: numbered(APP_LINES),
    [UTIL]: numbered(UTIL_LINES),
    [GUIDE]: GUIDE_NEW,
  };
  return repoOf({
    trees: {
      HEAD: treeOf(head),
      [HEAD_SHA]: treeOf(head),
      [MERGE_BASE_SHA]: treeOf({ ...head, [GUIDE]: GUIDE_OLD }),
    },
    work: treeOf({
      [APP]: appEdited(),
      [UTIL]: numbered(UTIL_LINES, { 5: UTIL_EDIT }),
      [GUIDE]: GUIDE_NEW,
    }),
    mergeBases: { main: MERGE_BASE_SHA },
  });
}

function goneRepo(): Repo {
  const repo = projectRepo();
  repo.trees.HEAD?.set(GONE_FILE, "");
  repo.trees[HEAD_SHA]?.set(GONE_FILE, "");
  return repo;
}

function listRepo(): Repo {
  const head = {
    [APP]: numbered(APP_LINES),
    [UTIL]: numbered(UTIL_LINES),
    [GUIDE]: GUIDE_OLD,
    [MODE_FILE]: "run\n",
  };
  return repoOf({
    trees: { HEAD: treeOf(head), [HEAD_SHA]: treeOf(head) },
    work: treeOf({
      [APP]: numbered(APP_LINES).replace(
        `line ${APP_FIRST_LINE}\n`,
        `${APP_FIRST}\napp three extra\n`,
      ),
      [UTIL]: numbered(UTIL_LINES, { 5: UTIL_EDIT }),
      [GUIDE]: GUIDE_NEW,
      [HOOK]: hugeFile(),
      [EMPTY_FILE]: "",
      [MODE_FILE]: "run\n",
    }),
    untracked: new Set([HOOK, EMPTY_FILE]),
    executable: new Set([MODE_FILE]),
    mergeBases: { main: MERGE_BASE_SHA },
  });
}

async function openLongPathWithComment($: Engine, on: On, columns: number): Promise<Pane> {
  const world = worldOf(on, longPathRepo());
  world.comments = JSON.stringify([
    { ...commentOn(1, "line 1", NOTE, { id: "c1" }), file: LONG_PATH },
  ]);
  return openReview($, world, columns, "uncommitted");
}

async function expectNameKeptAtFolderBoundary(pane: Pane): Promise<void> {
  const path = await pathCell(pane);
  const shownPath = cellText(path);
  const rest = shownPath.slice("…/".length);

  expect(shownPath.startsWith("…/")).toBe(true);
  expect(LONG_PATH.endsWith(rest)).toBe(true);
  expect(LONG_PATH.slice(0, LONG_PATH.length - rest.length).endsWith("/")).toBe(true);
  expect(rest.endsWith(LONG_NAME)).toBe(true);

  const pieces = collect(path, "Text");
  expect(pieces.find((node) => textOf(node).endsWith("/"))?.props?.color).toBe(paneInk().muted);
  expect(pieces.find((node) => textOf(node) === LONG_NAME)?.props?.color).toBe(paneInk().text);

  const row = (await buttons(pane)).find((button) => textOf(button).includes(LONG_NAME));
  expect(row, "the file row").toBeDefined();
  expect(textOf(row as Node)).toMatch(/DeeplyNested\.tsx {2,}✎ 1/);
}

function longPathRepo(): Repo {
  const head = { [LONG_PATH]: numbered(UTIL_LINES) };
  return repoOf({
    trees: { HEAD: treeOf(head), [HEAD_SHA]: treeOf(head) },
    work: treeOf({ [LONG_PATH]: numbered(UTIL_LINES, { 5: UTIL_EDIT }) }),
    mergeBases: { main: HEAD_SHA },
  });
}

function cutRepo(): Repo {
  const pad = "x".repeat(CUT_PAD);
  const before = Array.from({ length: CUT_LINES }, (_, i) => `row ${i + 1} ${pad}`);
  const after = before.map((line, i) =>
    i < CUT_CHANGED ? line.replace(/x$/, "y") : i === CUT_FAR - 1 ? "fresh-far" : line,
  );
  const head = { "src/cut.ts": `${before.join("\n")}\n` };
  return repoOf({
    trees: { HEAD: treeOf(head), [HEAD_SHA]: treeOf(head) },
    work: treeOf({ "src/cut.ts": `${after.join("\n")}\n` }),
    mergeBases: { main: HEAD_SHA },
  });
}

function hugeFile(): string {
  return `${Array.from({ length: HUGE_LINES }, (_, i) => `entry ${i + 1} of the huge file`).join("\n")}\n`;
}

function appRepo(work: string): Repo {
  const head = { [APP]: numbered(APP_LINES) };
  return repoOf({
    trees: { HEAD: treeOf(head), [HEAD_SHA]: treeOf(head), [MERGE_BASE_SHA]: treeOf(head) },
    work: treeOf({ [APP]: work }),
    mergeBases: { main: MERGE_BASE_SHA },
  });
}

function twinRepo(): Repo {
  return appRepo(numbered(APP_LINES, { [TWIN_EARLY]: TWIN_CODE, [TWIN_LATE]: TWIN_CODE }));
}

function twinRows(rows: string[]): number[] {
  return rows.flatMap((row, at) => (row.endsWith(TWIN_CODE) ? [at] : []));
}

function commentOn(
  line: number,
  code: string,
  text: string,
  extra: Partial<Saved> & { id: string },
): Saved {
  return { file: APP, line, side: "new", code, text, resolved: false, ...extra };
}

function savedOf(world: World): Saved[] {
  return world.comments === undefined ? [] : (JSON.parse(world.comments) as Saved[]);
}

function edit(target: string): Activity {
  return { id: target, tool: "Edit", target, ms: 1, isErrored: false, added: 1, removed: 1 };
}

async function bashRuns($: Engine, command: string): Promise<void> {
  await ($.tool.call as (e: object) => Promise<unknown>)({
    tool: "Bash",
    command,
    tool_use_id: command,
  });
}

function bashWrote(filePath: string): { result: unknown; text: string } {
  return { result: bashEditResult(filePath), text: "ok" };
}

function failedBashWrote(filePath: string): { result: unknown; text: string; isError: true } {
  return { result: bashEditResult(filePath), text: BASH_FAILURE, isError: true };
}

function bashEditResult(filePath: string): unknown {
  return {
    stdout: "",
    stderr: "",
    interrupted: false,
    bashEditDiff: {
      files: [
        {
          filePath,
          hunks: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 1, lines: ["+hi"] }],
        },
      ],
      moreFiles: 0,
    },
  };
}

function worldOf(on: On, repo: Repo): World {
  const world: World = {
    repo,
    clock: mock.clock(on, { now: NOW }),
    comments: undefined,
    commentWrites: 0,
    submitted: [],
    toolCalls: [],
    opened: [],
    state: new Map(),
    toolReply: TOOL_OK,
  };
  world.state.set("activity", { value: [edit(`${TOP}/${APP}`)], version: 1 });
  mock.env(on, { HOME: "/h/u" });
  on("state.get", (_$, e, next) => {
    const seeded = world.state.get(e.key);
    return seeded ? { value: seeded } : next(e);
  });
  on("classic.SessionStart", () => ({}));
  on("ui.open", (_$, e) => {
    world.opened.push({ id: e.id, focus: e.focus, backgroundColor: e.backgroundColor });
    return { value: { isPlaced: true } };
  });
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
    if (e.path !== COMMENTS_PATH) return { value: undefined };
    world.comments = e.text;
    world.commentWrites += 1;
    return { value: undefined };
  });
  on("process.run", async (_$, e) => {
    if (repo.top !== null && e.argv.includes("--absolute-git-dir"))
      return { value: { exitCode: 0, stdout: `${TOP}/.git\n`, stderr: "" } } as never;
    return { value: await repo.$.process.run(e.argv, e.init) };
  });
  on("tool.call", (_$, e) => {
    world.toolCalls.push(e.tool);
    return world.toolReply;
  });
  on("prompt.submit", (_$, e) => {
    world.submitted.push(e.text);
    return { text: e.text };
  });
  return world;
}

function commentsText(world: World): string {
  if (world.comments === undefined) throw new Error("no such file");
  return world.comments;
}

function paneProps(columns: number, offset: number) {
  return {
    title: "Session",
    isFocused: false,
    bodyColumns: columns,
    placement: "dock" as const,
    scroll: { offset, bodyRows: ROWS },
    view: {},
  };
}

async function openReview($: Engine, world: World, columns: number, scope: Scope): Promise<Pane> {
  const pane = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: "session",
    props: paneProps(columns, 0),
    viewport: { columns, rows: ROWS },
  });
  for (let page = 0; page < TAB_PAGES && !(await barHasReview(pane)); page++)
    await pressNamed(pane, world, RIGHT_ARROW);
  if ((await labels(pane)).includes(REVIEW_LABEL)) await pressNamed(pane, world, REVIEW_LABEL);
  if ((await labels(pane)).includes(scope)) await pressNamed(pane, world, scope);
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

async function submitComment(pane: Pane, world: World, text: string): Promise<void> {
  const [input] = await pane.findAll({ type: "Input" });
  expect(input, "the comment field").toBeDefined();
  await pane.input({ key: input?.key ?? "", text });
  await settle(pane, world);
}

async function scrolledRows($: Engine, pane: Pane, world: World): Promise<string[]> {
  const top = await rowsOf(pane);
  await scrollListBy($, pane, LIST_SCROLL_ROWS);
  await settle(pane, world);
  const scrolled = await rowsOf(pane);
  expect(scrolled).not.toEqual(top);
  return scrolled;
}

async function shown(pane: Pane): Promise<string[]> {
  return linesOf((await pane.drawn()) as Node)
    .map((line) => line.text)
    .filter((text) => text !== "");
}

async function drawnRows(pane: Pane): Promise<string[]> {
  return linesOf((await pane.drawn()) as Node)
    .filter((line) => line.text !== "")
    .map((line) => `${" ".repeat(line.indent)}${line.text}`);
}

async function hugeRows(pane: Pane): Promise<number[]> {
  const found = (await shown(pane)).flatMap((row) => {
    const match = /entry (\d+) of the huge file$/.exec(row);
    return match ? [Number(match[1])] : [];
  });
  return found;
}

async function pathCell(pane: Pane): Promise<Node> {
  const leaves = collect((await pane.drawn()) as Node, "Text").filter(isLeafText);
  const at = leaves.findIndex((node) => textOf(node).endsWith(LONG_EXTENSION));
  expect(at, "a row showing the file name").toBeGreaterThanOrEqual(0);
  const name = leaves[at] as Node;
  const folder = leaves[at - 1];
  if (textOf(name) !== LONG_NAME || folder === undefined) return name;
  return { type: "Text", children: [folder, name] };
}

function isLeafText(node: Node): boolean {
  const inner = Array.isArray(node.children) ? node.children : [node.children];
  return !inner.some((child) => typeof child === "object" && child !== null);
}

function cellText(node: Node): string {
  const label = node.props?.label;
  return typeof label === "string" ? label : textOf(node);
}

function clippedFromStart(cell: Node, columns: number): boolean {
  const text = cellText(cell);
  const isMarked = cell.props?.wrap === "truncate-start";
  const isCut = text.startsWith("…") && text.length <= columns - GUTTER;
  return text.endsWith(LONG_NAME) && (isMarked || isCut);
}

function cutFromStart(cell: Node, columns: number): boolean {
  const text = cellText(cell);
  return (
    text.startsWith("…") && LONG_PATH.endsWith(text.slice(1)) && text.length <= columns - GUTTER
  );
}

async function navRowWidth(pane: Pane): Promise<number> {
  const line = linesOf((await pane.drawn()) as Node).find((row) =>
    row.parts.some((part) => plainLabel(part) === "back"),
  );
  expect(line, "the row with the back button").toBeDefined();
  return line?.text.length ?? 0;
}
