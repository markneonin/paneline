import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, MockClock, Mounted } from "claude-code/testing";

import type { Activity } from "../types";
import { collect, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import { TAB_BAR_ROWS } from "../hooks/tab-bar";
import { HEAD_SHA, MERGE_BASE_SHA, TOP, repoOf, treeOf } from "./review-world";
import type { Repo } from "./review-world";
import { linesOf } from "./skills-tree";

type Pane = Mounted<"terminal", "Pane">;
type World = {
  repo: Repo;
  clock: MockClock;
  comments: string | undefined;
  commentWrites: number;
  submitted: string[];
  toolCalls: string[];
  opened: { id: string; focus: boolean | undefined }[];
  state: Map<string, { value: unknown; version: number }>;
};

const NOW = 1_000_000;
const ROWS = 40;
const COLUMNS = 60;
const FLUSH_MS = 400;
const SETTLE_TICKS = 5;
const TAB_PAGES = 12;
const COMMENTS_PATH = `${TOP}/.git/paneline-review.json`;
const RIGHT_ARROW = "›";
const REVIEW_LABEL = "Review";
const LONG_FILE = "src/long.ts";
const SMALL_FILE = "src/small.ts";
const LONG_LINES = 240;
const PAGE_ROWS = ROWS;
const WHEEL_ROWS = 3;
const MAX_PRESSES = 60;
const NOTE = "rename this";
const MARK_REVIEWED = "mark reviewed";

describe("review file view page keys", () => {
  test("A1 pressing a file row in the Review list opens the file and asks the pane for focus", async ($, on) => {
    const world = worldOf(on, longRepo());
    const pane = await openReview($, world);
    world.opened.length = 0;

    await pressShowing(pane, world, LONG_FILE);

    expect(world.opened.some((call) => call.focus === true)).toBe(true);
  });

  test("A3 marking a file reviewed in the file view asks the pane for no focus", async ($, on) => {
    const world = worldOf(on, longRepo());
    const pane = await openReview($, world);
    await pressShowing(pane, world, LONG_FILE);
    world.opened.length = 0;

    await pressNamed(pane, world, MARK_REVIEWED);

    expect(await labels(pane)).not.toContain(MARK_REVIEWED);
    expect(world.opened.some((call) => call.focus === true)).toBe(false);
  });

  test("A5 saving a comment leaves the pane unfocused", async ($, on) => {
    const world = worldOf(on, longRepo());
    const pane = await openReview($, world);
    await pressShowing(pane, world, LONG_FILE);
    await pressShowing(pane, world, entryText(1));

    await submitComment(pane, world, NOTE);

    expect(world.opened.at(-1)?.focus).not.toBe(true);
  });

  test("A6 PageDown steps through a 240-line file at 60 columns without skipping a line", async ($, on) => {
    const world = worldOf(on, longRepo());
    const pane = await fileViewOf($, world);

    const screens = await pageThrough($, pane, PAGE_ROWS);

    expect(missingEntries(screens)).toEqual([]);
  });

  test("A8 PageUp from the end shows every line again and reaches the top", async ($, on) => {
    const world = worldOf(on, longRepo());
    const pane = await fileViewOf($, world);
    await pageThrough($, pane, PAGE_ROWS);

    const screens = await pageThrough($, pane, -PAGE_ROWS);

    expect(missingEntries(screens)).toEqual([]);
    expect(entriesOn(screens.at(-1) ?? [])).toContain(1);
  });

  test("A10 one wheel step moves the file view by exactly 3 rows", async ($, on) => {
    const world = worldOf(on, longRepo());
    const pane = await fileViewOf($, world);
    const top = await screenOf(pane);

    await scrollBy($, pane, WHEEL_ROWS);

    const moved = await screenOf(pane);
    expect(moved.slice(TAB_BAR_ROWS, ROWS - WHEEL_ROWS)).toEqual(
      top.slice(TAB_BAR_ROWS + WHEEL_ROWS),
    );
  });

  test("A12 a scroll sent by a plugin with the size of a page moves the file view the full distance", async ($, on) => {
    const world = worldOf(on, longRepo());
    const pane = await fileViewOf($, world);
    const headRows =
      (await screenOf(pane)).findIndex((row) => row.endsWith(entryText(1))) - TAB_BAR_ROWS;

    await scrollBy($, pane, PAGE_ROWS, { kind: "plugin", name: "other-plugin" });

    const [firstShown = 0] = entriesOn([(await screenOf(pane))[TAB_BAR_ROWS] ?? ""]);
    expect(firstShown - 1 + headRows).toBe(PAGE_ROWS);
  });

  test("A11 the tab bar rows stay the same on every screen of a PageDown walk", async ($, on) => {
    const world = worldOf(on, longRepo());
    const pane = await fileViewOf($, world);
    const top = await screenOf(pane);

    const screens = await pageThrough($, pane, PAGE_ROWS);

    expect(screens.map((screen) => screen.slice(0, TAB_BAR_ROWS))).toEqual(
      screens.map(() => top.slice(0, TAB_BAR_ROWS)),
    );
  });
});

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
  };
  world.state.set("activity", { value: [edit(`${TOP}/${LONG_FILE}`)], version: 1 });
  mock.env(on, { HOME: "/h/u" });
  on("state.get", (_$, e, next) => {
    const seeded = world.state.get(e.key);
    return seeded ? { value: seeded } : next(e);
  });
  on("classic.SessionStart", () => ({}));
  on("ui.open", (_$, e) => {
    world.opened.push({ id: e.id, focus: e.focus });
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
    return { result: "ok", text: "ok" };
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

function longRepo(): Repo {
  const head = { [SMALL_FILE]: "one\n" };
  const repo = repoOf({
    trees: { HEAD: treeOf(head), [HEAD_SHA]: treeOf(head), [MERGE_BASE_SHA]: treeOf(head) },
    work: treeOf({ ...head, [LONG_FILE]: longText() }),
    mergeBases: { main: MERGE_BASE_SHA },
  });
  repo.untracked.add(LONG_FILE);
  return repo;
}

function longText(): string {
  return `${Array.from({ length: LONG_LINES }, (_, i) => entryText(i + 1)).join("\n")}\n`;
}

function entryText(number: number): string {
  return `entry ${number} of the long file`;
}

function edit(target: string): Activity {
  return { id: target, tool: "Edit", target, ms: 1, isErrored: false, added: 1, removed: 1 };
}

function paneProps() {
  return {
    title: "Session",
    isFocused: false,
    bodyColumns: COLUMNS,
    placement: "dock" as const,
    scroll: { offset: 0, bodyRows: ROWS },
    view: {},
  };
}

async function openReview($: Engine, world: World): Promise<Pane> {
  const pane = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: "session",
    props: paneProps(),
    viewport: { columns: COLUMNS, rows: ROWS },
  });
  for (let page = 0; page < TAB_PAGES && !(await barHasReview(pane)); page++)
    await pressNamed(pane, world, RIGHT_ARROW);
  await pressNamed(pane, world, REVIEW_LABEL);
  await pressNamed(pane, world, "uncommitted");
  return pane;
}

async function fileViewOf($: Engine, world: World): Promise<Pane> {
  const pane = await openReview($, world);
  await pressShowing(pane, world, LONG_FILE);
  return pane;
}

async function barHasReview(pane: Pane): Promise<boolean> {
  return JSON.stringify(await pane.drawn()).includes(REVIEW_LABEL);
}

async function settle(pane: Pane, world: World): Promise<void> {
  await world.clock.advance(FLUSH_MS);
  for (let tick = 0; tick < SETTLE_TICKS; tick++) await pane.redraw();
}

async function screenOf(pane: Pane): Promise<string[]> {
  const drawn = (await pane.drawn()) as Node;
  const rows = linesOf(drawn)
    .slice(0, ROWS)
    .map((line) => line.text);
  return hasCue(drawn) ? rows.slice(0, ROWS - 1) : rows;
}

function hasCue(drawn: Node): boolean {
  return collect(drawn, "Text").some((text) => textOf(text).includes("more lines"));
}

async function scrollBy(
  $: Engine,
  pane: Pane,
  by: number,
  origin: { kind: "person" } | { kind: "plugin"; name: string } = { kind: "person" },
): Promise<void> {
  await $.ui.scroll({
    component: "Pane",
    requestId: "session",
    offset: 0,
    by,
    bodyRows: ROWS,
    contentRows: linesOf(await pane.drawn()).length,
    origin,
  });
  for (let tick = 0; tick < SETTLE_TICKS; tick++) await pane.redraw();
}

async function pageThrough($: Engine, pane: Pane, by: number): Promise<string[][]> {
  const screens = [await screenOf(pane)];
  for (let press = 0; press < MAX_PRESSES; press++) {
    await scrollBy($, pane, by);
    const next = await screenOf(pane);
    if (next.join("\n") === screens.at(-1)?.join("\n")) break;
    screens.push(next);
  }
  return screens;
}

function entriesOn(screen: string[]): number[] {
  return screen.flatMap((row) => {
    const match = /entry (\d+) of the long file$/.exec(row);
    return match ? [Number(match[1])] : [];
  });
}

function missingEntries(screens: string[][]): number[] {
  const seen = new Set(screens.flatMap(entriesOn));
  return Array.from({ length: LONG_LINES }, (_, i) => i + 1).filter((number) => !seen.has(number));
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
