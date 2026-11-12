import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, MockClock, Mounted } from "claude-code/testing";
import type { Worktree } from "../types";

type Pane = Mounted<"terminal", "Pane">;

type Tree = { path: string; branch: string };

type Write = { key: string; value: unknown };

type World = {
  trees: Tree[];
  writes: Write[];
  inFlight: number;
  peak: number;
  clock: MockClock;
};

type Answer = { exitCode: number; stdout: string; stderr: string };

const WORKTREE_COUNT = 20;
const AT_ONCE_LIMIT = 8;
const HOLD_TICKS = 3;
const DIRTY_INDEX = 3;
const MERGED_INDEX = 4;
const MAIN_PATH = "/repo";
const LINKED_PREFIX = "/repo-wt/wt-";
const MAIN_BRANCH = "main";
const BRANCH_PREFIX = "feature/wt-";
const SHORT_SHA = "abc1234";
const DIRTY_STATUS = " M file.ts\n";
const FILES_LABEL = "Files";
const FILES_KEY = "filesWorktrees";
const COLUMNS = 80;
const ROWS = 40;
const NOW = 1_000;
const FLUSH_MS = 400;
const SETTLE_TICKS = 5;
const CONTEXT_WINDOW = 200_000;

describe("perf worktrees", () => {
  test("P3-1 a checkout with 20 worktrees lists all 20 in git's order while at most 8 git processes run at once", async ($, on) => {
    const world = worldOf(on);

    await openFilesTab($, world);

    expect(world.peak, "git processes running at once").toBeLessThanOrEqual(AT_ONCE_LIMIT);
    expect(lastWritten(world, FILES_KEY)).toEqual(expectedRows());
  });
});

function worldOf(on: On): World {
  const world: World = {
    trees: treesOf(),
    writes: [],
    inFlight: 0,
    peak: 0,
    clock: mock.clock(on, { now: NOW }),
  };
  mock.env(on, { HOME: "/h/u" });
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: CONTEXT_WINDOW }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: MAIN_PATH }));
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", () => ({ value: true }));
  on("state.set", (_$, e, next) => {
    world.writes.push({ key: e.key, value: e.value });
    return next(e);
  });
  on("process.run", async (_$, e) => {
    const argv = [...e.argv];
    world.inFlight += 1;
    world.peak = Math.max(world.peak, world.inFlight);
    await holdTicks(holdTicksOf(world, argv));
    world.inFlight -= 1;
    return {
      value: { ...gitAnswer(world, argv), isStdoutTruncated: false, isStderrTruncated: false },
    };
  });
  return world;
}

async function openFilesTab($: Engine, world: World): Promise<void> {
  const pane = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: "session",
    props: {
      title: "Session",
      isFocused: false,
      bodyColumns: COLUMNS,
      placement: "dock",
      scroll: { offset: 0, bodyRows: ROWS },
      view: {},
    },
    viewport: { columns: COLUMNS, rows: ROWS },
  });
  const files = (await pane.findAll({ type: "Button" })).find(
    (button) => button.props.label === FILES_LABEL,
  );
  expect(files, "a Files button").toBeDefined();
  await pane.press({ key: files?.key ?? "" });
  await world.clock.advance(FLUSH_MS);
  await settle(pane);
}

async function settle(pane: Pane): Promise<void> {
  for (let tick = 0; tick < SETTLE_TICKS; tick++) await pane.redraw();
}

function lastWritten(world: World, key: string): unknown {
  return world.writes.filter((write) => write.key === key).at(-1)?.value;
}

function pathOf(index: number): string {
  return index === 0 ? MAIN_PATH : `${LINKED_PREFIX}${String(index).padStart(2, "0")}`;
}

function branchOf(index: number): string {
  return index === 0 ? MAIN_BRANCH : `${BRANCH_PREFIX}${String(index).padStart(2, "0")}`;
}

function treesOf(): Tree[] {
  return Array.from({ length: WORKTREE_COUNT }, (_unused, index) => ({
    path: pathOf(index),
    branch: branchOf(index),
  }));
}

function expectedRows(): Worktree[] {
  return Array.from({ length: WORKTREE_COUNT }, (_unused, index) => ({
    path: pathOf(index),
    label: branchOf(index),
    isMain: index === 0,
    isSession: index === 0,
    isDetached: false,
    isLocked: false,
    isClean: index !== DIRTY_INDEX,
    isMerged: index === 0 || index === MERGED_INDEX,
  }));
}

function holdTicksOf(world: World, argv: string[]): number {
  const index = world.trees.findIndex((tree) => tree.path === (argv[2] ?? ""));
  return 1 + (index % HOLD_TICKS);
}

async function holdTicks(ticks: number): Promise<void> {
  for (let tick = 0; tick < ticks; tick++) await Promise.resolve();
}

function gitAnswer(world: World, argv: string[]): Answer {
  const ok = (stdout: string): Answer => ({ exitCode: 0, stdout, stderr: "" });
  const failed: Answer = { exitCode: 1, stdout: "", stderr: "" };
  const dir = argv[2] ?? "";
  const [command = "", ...args] = argv.slice(3);
  if (command === "rev-parse" && args.includes("--show-toplevel")) return ok(MAIN_PATH);
  if (command === "rev-parse" && args.includes("--verify")) return ok("sha");
  if (command === "worktree") return ok(porcelainOf(world.trees));
  if (command === "status") return ok(dir === pathOf(DIRTY_INDEX) ? DIRTY_STATUS : "");
  if (command === "merge-base") return isMerged(String(args[1])) ? ok("") : failed;
  return ok("");
}

function isMerged(ref: string): boolean {
  return ref === `refs/heads/${MAIN_BRANCH}` || ref === `refs/heads/${branchOf(MERGED_INDEX)}`;
}

function porcelainOf(trees: Tree[]): string {
  return trees
    .map((tree) =>
      [`worktree ${tree.path}`, `HEAD ${SHORT_SHA}`, `branch refs/heads/${tree.branch}`].join("\n"),
    )
    .join("\n\n")
    .concat("\n");
}
