import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, MockClock, Mounted } from "claude-code/testing";
import { screenRows } from "./band-screen";
import { isWordEdgeCut } from "./word-edge";

type Pane = Mounted<"terminal", "Pane">;
type Tree = { path: string; branch: string | null; head: string };
type Activity = {
  id: string;
  tool: string;
  target: string;
  ms: number;
  isErrored: boolean;
  added: number;
  removed: number;
};
type World = {
  root: string;
  branch: string;
  trees: Tree[];
  diffLines: string[];
  tracked: Set<string>;
  clock: MockClock;
};

const store = new Map<string, { value: unknown; version: number }>();
const NOW = 1_000;
const FLUSH_MS = 400;
const ELLIPSIS = "…";
const ROOT = "/w/app";
const FITTING_BRANCH = "feature/billing-export";
const BILLING_PREFIX = "another-extremely-long-repository-name-for-billing-service-worktree";
const LONG_FOLDER = "customer-portal-frontend-repository-folder-name";
const VERY_LONG_FOLDER =
  "customer-portal-frontend-repository-folder-name-for-the-billing-export-rewrite-team";
const WORDY_FOLDER = "another-extremely-long-repository-name-for-billing-backend-services";
const WORDLESS_FOLDER = "abcdefghij".repeat(7);
const WORKTREE_FOLDER = `${BILLING_PREFIX}-backend`;
const LONG_BRANCH = "feature/very-long-feature-branch-name-for-billing-export";
const FAIR_LABEL_CELLS = 24;
const FAIR_BRANCH_CELLS = 20;
const DEEP_FILE = "src/components/deeply/nested/module/handler.ts";
const NARROW = 60;

describe("files fit the pane", () => {
  test("F14a a repo whose folder name is too long beside its branch cuts the folder name in the middle and keeps the whole branch at 60 columns", async ($, on) => {
    const root = `/w/${LONG_FOLDER}`;
    const world = worldOf(on, "dark", { root, branch: FITTING_BRANCH });
    const pane = await filesWith($, world, [edit(`${root}/hooks/a.ts`, 5, 1)], NARROW);

    const row = rowWith(await screenOf(pane, NARROW), "customer-portal");

    expect(row).toContain(ELLIPSIS);
    expect(row).toContain("folder-name/");
    expect(row).toMatch(/ · feature\/billing-export$/);
  });

  test("F14b two worktrees whose long folder names differ only at the end draw two different rows, each with its whole branch, at 60 columns", async ($, on) => {
    const world = worldOf(on, "dark", {
      trees: [
        { path: `/wt/${BILLING_PREFIX}-backend`, branch: "main", head: "abc1234" },
        { path: `/wt/${BILLING_PREFIX}-frontend`, branch: "feature/fix-tax", head: "abc1234" },
      ],
    });
    const pane = await filesWith($, world, [], NARROW);

    const rows = (await screenOf(pane, NARROW)).filter((line) =>
      line.includes("another-extremely"),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toBe(rows[1]);
    expect(rows[0]).toContain("backend/");
    expect(rows[0]).toMatch(/ · main$/);
    expect(rows[1]).toContain("frontend/");
    expect(rows[1]).toMatch(/ · feature\/fix-tax$/);
  });

  test("F14c a repo folder name too long for the row even alone keeps its start and its end around an ellipsis and its whole branch at 60 columns", async ($, on) => {
    const root = `/w/${VERY_LONG_FOLDER}`;
    const world = worldOf(on, "dark", { root });
    const pane = await filesWith($, world, [edit(`${root}/hooks/a.ts`, 5, 1)], NARROW);

    const row = rowWith(await screenOf(pane, NARROW), "customer-portal-frontend");

    expect(row).toContain("customer-portal-");
    expect(row).toContain(ELLIPSIS);
    expect(row).toContain("team/");
    expect(row).toMatch(/ · main$/);
  });

  test("F21a a repo folder name of several words that is too long for its row is cut at word edges on both sides, and the branch stays whole, at 60 columns", async ($, on) => {
    const root = `/w/${WORDY_FOLDER}`;
    const world = worldOf(on, "dark", { root });
    const pane = await filesWith($, world, [edit(`${root}/hooks/a.ts`, 5, 1)], NARROW);

    const row = rowWith(await screenOf(pane, NARROW), "another-extremely");
    const [label = "", branch = ""] = row.split(" · ");

    expect(isWordEdgeCut(shownLabel(label), `${WORDY_FOLDER}/`)).toBe(true);
    expect(branch).toBe("main");
  });

  test("F21b a repo folder name that is one single word longer than the row is still cut inside the word, keeping its start and its end", async ($, on) => {
    const root = `/w/${WORDLESS_FOLDER}`;
    const world = worldOf(on, "dark", { root });
    const pane = await filesWith($, world, [edit(`${root}/hooks/a.ts`, 5, 1)], NARROW);

    const row = rowWith(await screenOf(pane, NARROW), "abcdefghij");
    const [start = "", end = ""] = shownLabel(row.split(" · ")[0] ?? "").split(ELLIPSIS);

    expect(`${WORDLESS_FOLDER}/`.startsWith(start)).toBe(true);
    expect(`${WORDLESS_FOLDER}/`.endsWith(end)).toBe(true);
    expect(start.length).toBeGreaterThanOrEqual(FAIR_BRANCH_CELLS / 2);
    expect(end.length).toBeGreaterThanOrEqual(FAIR_BRANCH_CELLS / 2);
  });

  test("F22a a repo with a long folder name and a long branch cuts both at word edges, and neither is squeezed to a stub, at 60 columns", async ($, on) => {
    const root = `/w/${WORKTREE_FOLDER}`;
    const world = worldOf(on, "dark", { root, branch: LONG_BRANCH });
    const pane = await filesWith($, world, [edit(`${root}/hooks/a.ts`, 5, 1)], NARROW);

    const row = rowWith(await screenOf(pane, NARROW), "another");
    const [label = "", branch = ""] = row.split(" · ");

    expect(isWordEdgeCut(shownLabel(label), `${WORKTREE_FOLDER}/`)).toBe(true);
    expect(isWordEdgeCut(branch, LONG_BRANCH)).toBe(true);
    expect(shownLabel(label).length).toBeGreaterThanOrEqual(FAIR_LABEL_CELLS);
    expect(branch.length).toBeGreaterThanOrEqual(FAIR_BRANCH_CELLS);
  });

  test("F22b two worktrees of one repo with long folder names that differ at the end and long branches still draw different rows, each name ending with its own last word and keeping its share, at 60 columns", async ($, on) => {
    const world = worldOf(on, "dark", {
      trees: [
        { path: `/wt/${BILLING_PREFIX}-backend`, branch: LONG_BRANCH, head: "abc1234" },
        { path: `/wt/${BILLING_PREFIX}-frontend`, branch: `${LONG_BRANCH}-v2`, head: "abc1234" },
      ],
    });
    const pane = await filesWith($, world, [], NARROW);

    const rows = (await screenOf(pane, NARROW)).filter((line) => line.includes("another"));
    const labels = rows.map((row) => shownLabel(row.split(" · ")[0] ?? ""));

    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toBe(rows[1]);
    expect(labels[0]).toMatch(/[-…]backend\/$/);
    expect(labels[1]).toMatch(/[-…]frontend\/$/);
    expect(labels[0]?.length).toBeGreaterThanOrEqual(FAIR_LABEL_CELLS);
    expect(labels[1]?.length).toBeGreaterThanOrEqual(FAIR_LABEL_CELLS);
  });

  test("F8a a changed file six folders deep at 60 columns shows the repo label, an ellipsis, its folder and name, then its counts whole", async ($, on) => {
    const world = worldOf(on, "dark", { root: ROOT, tracked: [DEEP_FILE] });
    const pane = await filesWith($, world, [edit(`${ROOT}/${DEEP_FILE}`, 3, 1)], NARROW);
    await pressNamed(pane, world, "handler.ts");

    const header = rowWith(await screenOf(pane, NARROW), "handler.ts");

    expect(header).toContain("app");
    expect(header).toContain(`app/${ELLIPSIS}/`);
    expect(header).toContain("module/handler.ts +3 -1");
  });

  test("F15 a changed file in a repo with a very long folder name at 60 columns shows the label's start and end around an ellipsis, then the file name and its counts whole", async ($, on) => {
    const root = `/w/${VERY_LONG_FOLDER}`;
    const world = worldOf(on, "dark", { root, tracked: ["handler.ts"] });
    const pane = await filesWith($, world, [edit(`${root}/handler.ts`, 3, 1)], NARROW);
    await pressNamed(pane, world, "handler.ts");

    const header = rowWith(await screenOf(pane, NARROW), "handler.ts");

    expect(header).toContain("customer-portal-");
    expect(header).toContain(ELLIPSIS);
    expect(header).toContain("team/handler.ts +3 -1");
  });

  test("F9a a Files tab with no file touched shows its empty-state row and no filter button", async ($, on) => {
    const world = worldOf(on, "dark", { root: ROOT });
    const pane = await filesWith($, world, [], NARROW);

    const buttons = await pane.findAll({ type: "Button" });
    const labels = buttons.map((button) => String(button.props.label));

    expect(labels).not.toContain("filter");
    expect(rowWith(await screenOf(pane, NARROW), "no files touched yet")).toContain(
      "no files touched yet",
    );
  });
  test("F9b a typed filter that matches no row still shows the filter row at 60 columns", async ($, on) => {
    const world = worldOf(on, "dark", { root: ROOT });
    const pane = await filesWith($, world, [edit(`${ROOT}/handler.ts`, 1, 1)], NARROW);

    await pane.input({ key: "filter", text: "zzz-none", kind: "change" });

    expect(await pane.find({ type: "Input", key: "filter" })).toBeDefined();
  });
});

function shownLabel(rowStart: string): string {
  return rowStart.trimStart().replace(/^\S+ /, "");
}

function worldOf(
  on: On,
  theme = "dark",
  options: Partial<Pick<World, "root" | "branch" | "trees" | "diffLines">> & {
    tracked?: string[];
  } = {},
): World {
  store.clear();
  const world: World = {
    root: ROOT,
    branch: "main",
    trees: [],
    diffLines: ["+a", "+b", "+c", "-old"],
    ...options,
    tracked: new Set(options.tracked ?? []),
    clock: mock.clock(on, { now: NOW }),
  };
  mock.env(on, { HOME: "/h/u" });
  on("config.list", () => ({ value: [{ key: "theme", value: theme }] }) as never);
  on("state.get", (_$, e, next) => {
    const seeded = store.get(e.key);
    return seeded ? { value: seeded } : next(e);
  });
  on("state.set", (_$, e, next) => {
    store.delete(e.key);
    return next(e);
  });
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: world.root }));
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", () => ({ value: true }));
  on("tool.call", () => ({ result: "ok", text: "ok" }));
  on("process.run", (_$, e) => ({ value: answerOf(world, [...e.argv]) }) as never);
  return world;
}

type Answer = { exitCode: number; stdout: string; stderr: string };

const TRACKED_ADDED = 3;
const TRACKED_REMOVED = 1;

function answerOf(world: World, argv: string[]): Answer {
  const ok = (stdout: string): Answer => ({ exitCode: 0, stdout, stderr: "" });
  const file = argv[argv.indexOf("--") + 1] ?? "";
  if (argv.includes("worktree")) return ok(porcelainOf(world.trees));
  if (argv.includes("--abbrev-ref")) return ok(world.branch);
  if (argv.includes("--show-toplevel")) return ok(world.root);
  if (argv.includes("--others") || argv.includes("--name-status")) return ok("");
  if (argv.includes("--name-only")) return ok("");
  if (argv.includes("--numstat")) {
    const asked = argv.slice(argv.indexOf("--") + 1);
    return ok(
      asked
        .filter((path) => world.tracked.has(relativeTo(world, path)))
        .map((path) => `${TRACKED_ADDED}\t${TRACKED_REMOVED}\t${relativeTo(world, path)}\0`)
        .join(""),
    );
  }
  if (argv.includes("ls-files")) return ok(world.tracked.has(relativeTo(world, file)) ? file : "");
  if (argv.includes("--no-index")) return { exitCode: 1, stdout: "", stderr: "" };
  if (argv.includes("diff")) return ok(diffOf(relativeTo(world, file), world.diffLines));
  if (argv.includes("merge-base")) return { exitCode: 1, stdout: "", stderr: "" };
  return ok("");
}

function relativeTo(world: World, file: string): string {
  return file.startsWith(`${world.root}/`) ? file.slice(world.root.length + 1) : file;
}

function porcelainOf(trees: Tree[]): string {
  return trees
    .map((tree) =>
      [
        `worktree ${tree.path}`,
        `HEAD ${tree.head}`,
        tree.branch === null ? "detached" : `branch refs/heads/${tree.branch}`,
      ].join("\n"),
    )
    .join("\n\n")
    .concat("\n");
}

function diffOf(file: string, body: string[]): string {
  const added = body.filter((line) => line.startsWith("+")).length;
  const removed = body.filter((line) => line.startsWith("-")).length;
  const kept = body.filter((line) => line.startsWith(" ")).length;
  return [
    `diff --git a/${file} b/${file}`,
    "index 1111111..2222222 100644",
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${removed + kept} +1,${added + kept} @@`,
    ...body,
  ].join("\n");
}

function edit(target: string, added: number, removed: number): Activity {
  return { id: target, tool: "Edit", target, ms: 1, isErrored: false, added, removed };
}

async function filesWith(
  $: Engine,
  world: World,
  activity: Activity[],
  columns: number,
): Promise<Pane> {
  store.set("activity", { value: activity, version: 1 });
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
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
    viewport: { columns, rows: 40 },
  });
  await pressNamed(pane, world, "Files");
  return pane;
}

async function pressNamed(pane: Pane, world: World, label: string): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const target = buttons.find((button) => button.props.label === label);
  expect(target, `a button labelled ${label}`).toBeDefined();
  await pane.press({ key: target?.key ?? "" });
  await world.clock.advance(FLUSH_MS);
}

async function screenOf(pane: Pane, columns: number): Promise<string[]> {
  return screenRows(await pane.drawn(), columns)
    .map((line) => line.trimEnd())
    .filter((line) => line !== "");
}

function rowWith(rows: string[], text: string): string {
  const row = rows.find((line) => line.includes(text));
  expect(row, `a row with ${text}`).toBeDefined();
  return row ?? "";
}
