import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, MockClock, Mounted } from "claude-code/testing";
import { paneInk } from "../hooks/pane-ink";
import { collect, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import { shownTexts } from "./skills-tree";

type Pane = Mounted<"terminal", "Pane">;

type Tree = { path: string; branch: string | null; head: string; isLocked?: boolean };

type World = {
  trees: Tree[];
  merged: Set<string>;
  dirty: Set<string>;
  statusFails: Set<string>;
  defaultBranches: string[];
  isRepo: boolean;
  refuseRemove: boolean;
  commands: string[][];
  clock: MockClock;
};

const COLUMNS = 80;
const ROWS = 40;
const NOW = 1_000;
const FLUSH_MS = 400;
const SETTLE_TICKS = 5;
const ACTIONS_INDENT_CELLS = 2;
const SHORT_SHA = "abc1234";
const MAIN_PATH = "/repo";
const SESSION_PATH = "/repo-wt/session";
const STALE_PATH = "/repo-wt/done";
const DIRTY_PATH = "/repo-wt/dirty";
const OPEN_PATH = "/repo-wt/open";
const DETACHED_PATH = "/repo-wt/detached";
const BROKEN_PATH = "/repo-wt/broken";
const LOCKED_PATH = "/repo-wt/locked";
const DIRTY_MARK = "●";
const STALE_MARK = "○";
const CLEAN_MARK = "✔";
const MAIN_NAME = "repo/";
const DIRTY_NAME = "dirty/";
const STALE_NAME = "done/";
const OPEN_NAME = "open/";
const DETACHED_NAME = "detached/";

describe("files worktrees", () => {
  test("W1 the Files tab lists every worktree with its branch, main included, a detached one by short sha", async ($, on) => {
    const world = worldOf(on);
    const pane = await paneWith($, world);

    const shown = shownTexts(await pane.drawn());

    expect(shown).toContain("Worktrees");
    expect(shown).toContain(`${CLEAN_MARK} ${MAIN_NAME} · main`);
    expect(shown).toContain(`${STALE_MARK} ${STALE_NAME} · feature/done`);
    expect(shown).toContain(`${CLEAN_MARK} ${OPEN_NAME} · feature/open`);
    expect(shown).toContain(`${CLEAN_MARK} ${DETACHED_NAME} · ${SHORT_SHA}`);
  });

  test("W2 a worktree with uncommitted changes is marked dirty in the alert colour", async ($, on) => {
    const world = worldOf(on);
    const pane = await paneWith($, world);

    expect(shownTexts(await pane.drawn())).toContain(`${DIRTY_MARK} ${DIRTY_NAME} · feature/dirty`);
    expect(await markColour(pane, DIRTY_MARK)).toBe(paneInk().alert);
    expect(await markColour(pane, STALE_MARK)).toBe(paneInk().muted);
    expect(await markColour(pane, CLEAN_MARK)).toBe(paneInk().ok);
  });

  test("V2 two worktrees with the same last folder name draw their parent folder dim and their last folder in the text colour", async ($, on) => {
    const world = worldOf(on);
    world.trees = [
      { path: "/a/app", branch: "feature/a", head: SHORT_SHA },
      { path: "/b/app", branch: "feature/b", head: SHORT_SHA },
    ];
    const pane = await paneWith($, world);

    const texts = collect(await pane.drawn(), "Text");

    expect(colourOfExactText(texts, "a/")).toBe(paneInk().muted);
    expect(colourOfExactText(texts, "b/")).toBe(paneInk().muted);
    expect(colourOfExactText(texts, "app")).toBe(paneInk().text);
  });

  test("W3 only the stale worktree is a button: main, the session's, dirty, unmerged, detached, locked and unreadable ones are not", async ($, on) => {
    const world = worldOf(on);
    const pane = await paneWith($, world);

    expect(await rowButtons(pane)).toEqual([STALE_NAME]);
  });

  test("W4 pressing the stale row opens remove, pressing remove turns it into confirm remove, pressing the row closes it", async ($, on) => {
    const world = worldOf(on);
    const pane = await paneWith($, world);

    await pressButton(pane, world, STALE_NAME);
    expect(await actionButtons(pane)).toEqual(["remove"]);
    await pressButton(pane, world, "remove");
    expect(await actionButtons(pane)).toEqual(["confirm remove"]);
    await pressButton(pane, world, STALE_NAME);
    expect(await actionButtons(pane)).toEqual([]);
  });

  test("W5 the remove row sits right under its worktree indented two cells", async ($, on) => {
    const world = worldOf(on);
    const pane = await paneWith($, world);

    await pressButton(pane, world, STALE_NAME);

    const shown = shownTexts(await pane.drawn());
    expect(shown[shown.findIndex((text) => text.includes(STALE_NAME)) + 1]).toBe("remove");
    const indented = collect(await pane.drawn(), "Box").filter(
      (box) =>
        box.props?.marginLeft === ACTIONS_INDENT_CELLS &&
        collect(box, "Button").some((button) => button.props?.label === "remove"),
    );
    expect(indented).toHaveLength(1);
  });

  test("W6 confirm remove runs git worktree remove on that path without --force and the row disappears", async ($, on) => {
    const world = worldOf(on);
    const pane = await paneWith($, world);

    await pressButton(pane, world, STALE_NAME);
    await pressButton(pane, world, "remove");
    await pressButton(pane, world, "confirm remove");

    expect(removeCommands(world)).toEqual([
      ["git", "-C", MAIN_PATH, "worktree", "remove", STALE_PATH],
    ]);
    expect(shownTexts(await pane.drawn()).some((text) => text.includes(STALE_NAME))).toBe(false);
    expect(await actionButtons(pane)).toEqual([]);
    expect(world.commands.some((argv) => argv.includes("branch"))).toBe(false);
  });

  test("W7 when git refuses the remove the row stays", async ($, on) => {
    const world = worldOf(on);
    world.refuseRemove = true;
    const pane = await paneWith($, world);

    await pressButton(pane, world, STALE_NAME);
    await pressButton(pane, world, "remove");
    await pressButton(pane, world, "confirm remove");

    expect(removeCommands(world)).toHaveLength(1);
    expect(shownTexts(await pane.drawn())).toContain(`${STALE_MARK} ${STALE_NAME} · feature/done`);
  });

  test("W8 a merged worktree with changes or with a failed status is not stale", async ($, on) => {
    const world = worldOf(on);
    world.merged.add("feature/dirty");
    world.merged.add("feature/broken");
    const pane = await paneWith($, world);

    expect(await rowButtons(pane)).not.toContain(DIRTY_PATH);
    expect(await rowButtons(pane)).not.toContain(BROKEN_PATH);
    expect(await markColour(pane, DIRTY_MARK)).toBe(paneInk().alert);
  });

  test("W9 outside a git repo there is no Worktrees block", async ($, on) => {
    const world = worldOf(on);
    world.isRepo = false;
    const pane = await paneWith($, world);

    expect(shownTexts(await pane.drawn()).some((text) => text.startsWith("Worktrees"))).toBe(false);
  });

  test("S3 with one worktree, the main checkout, the Worktrees heading shows and lists that checkout", async ($, on) => {
    const world = worldOf(on);
    world.trees = world.trees.slice(0, 1);
    const pane = await paneWith($, world);

    const shown = shownTexts(await pane.drawn());
    expect(shown).toContain("Worktrees");
    expect(shown).toContain(`${CLEAN_MARK} ${MAIN_NAME} · main`);
  });

  test("S3 with two worktrees the Worktrees heading shows and lists both checkouts", async ($, on) => {
    const world = worldOf(on);
    world.trees = world.trees.filter((tree) => tree.path === MAIN_PATH || tree.path === OPEN_PATH);
    const pane = await paneWith($, world);

    const shown = shownTexts(await pane.drawn());
    expect(shown.some((text) => text.startsWith("Worktrees"))).toBe(true);
    expect(shown).toContain(`${CLEAN_MARK} ${MAIN_NAME} · main`);
    expect(shown).toContain(`${CLEAN_MARK} ${OPEN_NAME} · feature/open`);
  });

  test("W10 a repo with neither main nor master has no stale worktree", async ($, on) => {
    const world = worldOf(on);
    world.defaultBranches = [];
    const pane = await paneWith($, world);

    expect(await rowButtons(pane)).toEqual([]);
    expect(shownTexts(await pane.drawn())).toContain(`${CLEAN_MARK} ${STALE_NAME} · feature/done`);
  });

  test("W11 master counts as the default branch when there is no main", async ($, on) => {
    const world = worldOf(on);
    world.defaultBranches = ["master"];
    const pane = await paneWith($, world);

    expect(await rowButtons(pane)).toEqual([STALE_NAME]);
  });

  test("W12 reopening the Files tab lists the worktrees again", async ($, on) => {
    const world = worldOf(on);
    const pane = await paneWith($, world);
    world.trees = world.trees.filter((tree) => tree.path !== STALE_PATH);

    await pressButton(pane, world, "Activity");
    await pressButton(pane, world, "Files");

    expect(shownTexts(await pane.drawn()).some((text) => text.includes(STALE_NAME))).toBe(false);
  });

  test("W13 at 60 columns a long worktree name is cut in the middle, keeps its whole branch and the row stays on one line", async ($, on) => {
    const world = worldOf(on);
    const longPath = `/repo-wt/${"deep-".repeat(12)}name`;
    world.trees.push({ path: longPath, branch: "feature/long", head: SHORT_SHA });
    world.merged.add("feature/long");
    const pane = await paneWith($, world, 60);

    const row = shownTexts(await pane.drawn()).find((text) => text.includes("deep-"));
    expect(row).toBeDefined();
    expect(row?.length).toBeLessThanOrEqual(60);
    expect(row).toContain("deep-");
    expect(row).toContain("…");
    expect(row).toContain("name/");
    expect(row?.endsWith(" · feature/long")).toBe(true);
  });
});

function ownTextOf(node: Node): string {
  return (
    (node.children as unknown[] | undefined)?.filter((c) => typeof c === "string").join("") ?? ""
  );
}

function colourOfExactText(texts: Node[], word: string): unknown {
  return texts.find((node) => ownTextOf(node) === word)?.props?.color;
}

async function markColour(pane: Pane, mark: string): Promise<unknown> {
  const texts = collect(await pane.drawn(), "Text");
  return texts.find((node) => textOf(node) === `${mark} `)?.props?.color;
}

async function rowButtons(pane: Pane): Promise<string[]> {
  return (await buttonLabels(pane)).filter((label) => label.endsWith("/"));
}

async function actionButtons(pane: Pane): Promise<string[]> {
  return (await buttonLabels(pane)).filter((label) => label.endsWith("remove"));
}

async function buttonLabels(pane: Pane): Promise<string[]> {
  const buttons = await pane.findAll({ type: "Button" });
  return buttons.map((button) => String(button.props.label));
}

function removeCommands(world: World): string[][] {
  return world.commands.filter((argv) => argv.includes("remove"));
}

async function pressButton(pane: Pane, world: World, label: string): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const target = buttons.find((button) => button.props.label === label);
  expect(target, `a button labelled ${label}`).toBeDefined();
  await pane.press({ key: target?.key ?? "" });
  await world.clock.advance(FLUSH_MS);
  await settle(pane);
}

async function settle(pane: Pane): Promise<void> {
  for (let tick = 0; tick < SETTLE_TICKS; tick++) await pane.redraw();
}

function worldOf(on: On): World {
  const world: World = {
    trees: [
      { path: MAIN_PATH, branch: "main", head: SHORT_SHA },
      { path: SESSION_PATH, branch: "feature/session", head: SHORT_SHA },
      { path: STALE_PATH, branch: "feature/done", head: SHORT_SHA },
      { path: DIRTY_PATH, branch: "feature/dirty", head: SHORT_SHA },
      { path: OPEN_PATH, branch: "feature/open", head: SHORT_SHA },
      { path: DETACHED_PATH, branch: null, head: `${SHORT_SHA}ffff` },
      { path: BROKEN_PATH, branch: "feature/broken", head: SHORT_SHA },
      { path: LOCKED_PATH, branch: "feature/locked", head: SHORT_SHA, isLocked: true },
    ],
    merged: new Set(["feature/session", "feature/done", "feature/locked"]),
    dirty: new Set([DIRTY_PATH]),
    statusFails: new Set([BROKEN_PATH]),
    defaultBranches: ["main"],
    isRepo: true,
    refuseRemove: false,
    commands: [],
    clock: mock.clock(on, { now: NOW }),
  };
  mock.env(on, { HOME: "/h/u" });
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: SESSION_PATH }));
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", () => ({ value: true }));
  on("tool.call", () => ({ result: "ok", text: "ok" }));
  on("process.run", (_$, e) => {
    world.commands.push([...e.argv]);
    return {
      value: {
        ...gitAnswer(world, [...e.argv]),
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    };
  });
  return world;
}

type Answer = { exitCode: number; stdout: string; stderr: string };

function gitAnswer(world: World, argv: string[]): Answer {
  const ok = (stdout: string): Answer => ({ exitCode: 0, stdout, stderr: "" });
  const failed: Answer = { exitCode: 1, stdout: "", stderr: "fatal" };
  const dir = argv[2] ?? "";
  const [command = "", ...args] = argv.slice(3);
  if (command === "rev-parse" && args.includes("--show-toplevel")) {
    const top = dir === SESSION_PATH ? SESSION_PATH : MAIN_PATH;
    return world.isRepo ? ok(args.includes("--abbrev-ref") ? `${top}\nsha\nmain` : top) : failed;
  }
  if (command === "rev-parse" && args.includes("--verify"))
    return world.defaultBranches.some((name) => args.includes(`refs/heads/${name}`))
      ? ok("sha")
      : failed;
  if (command === "worktree" && args[0] === "list") return ok(porcelainOf(world.trees));
  if (command === "worktree" && args[0] === "remove") return removed(world, args[1] ?? "");
  if (command === "status") return statusOf(world, dir);
  if (command === "merge-base")
    return world.merged.has(String(args[1]).replace("refs/heads/", "")) ? ok("") : failed;
  return ok("");
}

function removed(world: World, path: string): Answer {
  if (world.refuseRemove) return { exitCode: 128, stdout: "", stderr: "fatal: contains changes" };
  world.trees = world.trees.filter((tree) => tree.path !== path);
  return { exitCode: 0, stdout: "", stderr: "" };
}

function statusOf(world: World, dir: string): Answer {
  if (world.statusFails.has(dir)) return { exitCode: 128, stdout: "", stderr: "fatal" };
  return { exitCode: 0, stdout: world.dirty.has(dir) ? " M file.ts\n" : "", stderr: "" };
}

function porcelainOf(trees: Tree[]): string {
  return trees
    .map((tree) =>
      [
        `worktree ${tree.path}`,
        `HEAD ${tree.head}`,
        tree.branch === null ? "detached" : `branch refs/heads/${tree.branch}`,
        ...(tree.isLocked === true ? ["locked"] : []),
      ].join("\n"),
    )
    .join("\n\n")
    .concat("\n");
}

async function paneWith($: Engine, world: World, columns = COLUMNS): Promise<Pane> {
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
      scroll: { offset: 0, bodyRows: ROWS },
      view: {},
    },
    viewport: { columns, rows: ROWS },
  });
  await pressButton(pane, world, "Files");
  return pane;
}
