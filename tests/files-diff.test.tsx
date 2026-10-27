import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, MockClock, Mounted } from "claude-code/testing";

import type { Activity } from "../types";
import { collect, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import { shownTexts } from "./skills-tree";

type Pane = Mounted<"terminal", "Pane">;
type World = {
  tracked: Set<string>;
  diffs: Map<string, string>;
  files: Map<string, string>;
  heads: string[];
  commands: string[][];
  failingDiff: boolean;
  numstat: string;
  clock: MockClock;
};

const COLUMNS = 100;
const ROWS = 40;
const NOW = 1_000;
const FLUSH_MS = 400;
const SETTLE_TICKS = 5;
const CHAR_LIMIT = 100_000;
const BIG_HUNK_CHARS = 40_000;
const store = new Map<string, { value: unknown; version: number }>();

describe("files diff view", () => {
  test("D1 pressing a file replaces the tree with its diff, a back button, the path and the counts", async ($, on) => {
    const world = worldOf(on);
    world.tracked.add("src/m.ts");
    world.diffs.set("/work:HEAD:src/m.ts", diffOf("src/m.ts", ["+new1", "+new2", "-old"]));
    const pane = await paneWith($, world, [edit("/work/src/m.ts", 2, 1)]);

    await pressFile(pane, world, "m.ts");

    const shown = shownTexts(await pane.drawn());
    expect(await buttonLabels(pane)).toContain("back");
    expect(shown.some((text) => text.includes("src/m.ts") && text.includes("+2 -1"))).toBe(true);
    expect(shown.some((text) => text.startsWith("▾ /work/"))).toBe(false);
    expect(await diffSource(pane)).toContain("+new1");
    expect(await diffSource(pane)).toContain("-old");
    expect(shown).toContain("[ back ] /work/src/m.ts +2 -1");
    const rules = await ruleRows(pane);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.length).toBeGreaterThanOrEqual(COLUMNS - 2);
  });

  test("D2 pressing back returns to the tree and removes the diff", async ($, on) => {
    const world = worldOf(on);
    world.tracked.add("src/m.ts");
    world.diffs.set("/work:HEAD:src/m.ts", diffOf("src/m.ts", ["+new1", "-old"]));
    const pane = await paneWith($, world, [edit("/work/src/m.ts", 1, 1)]);
    await pressFile(pane, world, "m.ts");

    await pressButton(pane, world, "back");

    const shown = shownTexts(await pane.drawn());
    expect(shown.some((text) => text.startsWith("▾ /work/"))).toBe(true);
    expect(await diffSource(pane)).toBeUndefined();
    expect(await buttonLabels(pane)).not.toContain("back");
  });

  test("D3 a file in a worktree shows the diff of that worktree, not of the main checkout", async ($, on) => {
    const world = worldOf(on);
    world.tracked.add("src/b.ts");
    world.diffs.set("/work/wt:HEAD:src/b.ts", diffOf("src/b.ts", ["+from-worktree"]));
    world.diffs.set("/work:HEAD:src/b.ts", diffOf("src/b.ts", ["+from-main"]));
    const pane = await paneWith($, world, [edit("/work/wt/src/b.ts", 1, 0)]);

    await pressFile(pane, world, "b.ts");

    expect(await diffSource(pane)).toContain("+from-worktree");
    expect(await diffSource(pane)).not.toContain("+from-main");
  });

  test("D4 a file committed during the session is diffed against the commit before the session changed it", async ($, on) => {
    const world = worldOf(on);
    world.tracked.add("src/m.ts");
    world.diffs.set("/work:head-0:src/m.ts", diffOf("src/m.ts", ["+against-first-head"]));
    world.diffs.set("/work:head-1:src/m.ts", diffOf("src/m.ts", ["+against-new-head"]));
    world.diffs.set("/work:HEAD:src/m.ts", diffOf("src/m.ts", ["+against-plain-head"]));
    const pane = await paneWith($, world, [edit("/work/src/m.ts", 3, 1)]);
    await commit($, world, "git commit -am one", "head-1", "3\t1\tsrc/m.ts");

    await pressFile(pane, world, "m.ts");

    expect(await diffSource(pane)).toContain("+against-first-head");
    expect(await diffSource(pane)).not.toContain("+against-new-head");
    expect(await diffSource(pane)).not.toContain("+against-plain-head");
  });

  test("D5 after a second commit the file is still diffed against the commit before the first one", async ($, on) => {
    const world = worldOf(on);
    world.tracked.add("src/m.ts");
    world.diffs.set("/work:head-0:src/m.ts", diffOf("src/m.ts", ["+against-first-head"]));
    world.diffs.set("/work:head-1:src/m.ts", diffOf("src/m.ts", ["+against-second-head"]));
    world.diffs.set("/work:head-2:src/m.ts", diffOf("src/m.ts", ["+against-third-head"]));
    const pane = await paneWith($, world, [edit("/work/src/m.ts", 3, 1)]);
    await commit($, world, "git commit -am one", "head-1", "2\t0\tsrc/m.ts");
    await commit($, world, "git commit -am two", "head-2", "1\t1\tsrc/m.ts");

    await pressFile(pane, world, "m.ts");

    expect(await diffSource(pane)).toContain("+against-first-head");
    expect(await diffSource(pane)).not.toContain("+against-second-head");
  });

  test("D6 a file edited but never committed is diffed against HEAD", async ($, on) => {
    const world = worldOf(on);
    world.tracked.add("src/m.ts");
    world.diffs.set("/work:HEAD:src/m.ts", diffOf("src/m.ts", ["+against-head"]));
    const pane = await paneWith($, world, [edit("/work/src/m.ts", 1, 0)]);

    await pressFile(pane, world, "m.ts");

    expect(await diffSource(pane)).toContain("+against-head");
  });

  test("D7 a new file git does not know shows every line as added", async ($, on) => {
    const world = worldOf(on);
    world.files.set("/work/src/new.ts", "alpha\nbeta\ngamma\n");
    const pane = await paneWith($, world, [edit("/work/src/new.ts", 3, 0)]);

    await pressFile(pane, world, "new.ts");

    const source = (await diffSource(pane)) ?? "";
    expect(source).toContain("@@ -0,0 +1,3 @@");
    expect(source).toContain("+alpha");
    expect(source).toContain("+beta");
    expect(source).toContain("+gamma");
    expect(source).not.toMatch(/^-[^-]/m);
    expect(shownTexts(await pane.drawn()).some((text) => text.includes("+3 -0"))).toBe(true);
  });

  test("D8 the plus and minus counts in the header are counted from the shown diff, not from the tree", async ($, on) => {
    const world = worldOf(on);
    world.tracked.add("src/m.ts");
    world.diffs.set(
      "/work:HEAD:src/m.ts",
      diffOf("src/m.ts", ["+a", "+b", "+c", "-x", "-y", " same", "+d"]),
    );
    const pane = await paneWith($, world, [edit("/work/src/m.ts", 99, 98)]);

    await pressFile(pane, world, "m.ts");

    const shown = shownTexts(await pane.drawn());
    expect(shown.some((text) => text.includes("src/m.ts") && text.includes("+4 -2"))).toBe(true);
    expect(shown.some((text) => text.includes("+99 -98") && text.includes("src/m.ts"))).toBe(false);
  });

  test("D9 a diff over the 100000 character limit is cut after a whole hunk", async ($, on) => {
    const world = worldOf(on);
    world.tracked.add("src/big.ts");
    world.diffs.set(
      "/work:HEAD:src/big.ts",
      [
        "diff --git a/src/big.ts b/src/big.ts",
        "--- a/src/big.ts",
        "+++ b/src/big.ts",
        ...["A", "B", "C"].flatMap((fill) => [`@@ -1 +1 @@`, `+${fill.repeat(BIG_HUNK_CHARS)}`]),
      ].join("\n"),
    );
    const pane = await paneWith($, world, [edit("/work/src/big.ts", 3, 0)]);

    await pressFile(pane, world, "big.ts");

    const source = (await diffSource(pane)) ?? "";
    expect(source.length).toBeLessThanOrEqual(CHAR_LIMIT);
    expect(source).toContain("A".repeat(BIG_HUNK_CHARS));
    expect(source).toContain("B".repeat(BIG_HUNK_CHARS));
    expect(source).not.toContain("CCCC");
  });

  test("D10 opening another file after back shows that file's diff and nothing of the first", async ($, on) => {
    const world = worldOf(on);
    world.tracked.add("src/a.ts").add("src/b.ts");
    world.diffs.set("/work:HEAD:src/a.ts", diffOf("src/a.ts", ["+only-in-a"]));
    world.diffs.set("/work:HEAD:src/b.ts", diffOf("src/b.ts", ["+only-in-b"]));
    const pane = await paneWith($, world, [
      edit("/work/src/a.ts", 1, 0),
      edit("/work/src/b.ts", 1, 0),
    ]);
    await pressFile(pane, world, "a.ts");
    await pressButton(pane, world, "back");

    await pressFile(pane, world, "b.ts");

    expect(await diffSource(pane)).toContain("+only-in-b");
    expect(await diffSource(pane)).not.toContain("+only-in-a");
  });

  test("D11 git runs when the file is pressed and not while the tree or the diff is redrawn", async ($, on) => {
    const world = worldOf(on);
    world.tracked.add("src/m.ts");
    world.diffs.set("/work:HEAD:src/m.ts", diffOf("src/m.ts", ["+new1"]));
    const pane = await paneWith($, world, [edit("/work/src/m.ts", 1, 0)]);
    await settle(pane);
    const beforePress = diffCommands(world).length;

    await pressFile(pane, world, "m.ts");
    const afterPress = diffCommands(world).length;
    await settle(pane);
    await settle(pane);

    expect(beforePress).toBe(0);
    expect(afterPress).toBeGreaterThan(0);
    expect(diffCommands(world)).toHaveLength(afterPress);
  });

  test("D12 when git cannot produce the diff the view still opens and back still returns to the tree", async ($, on) => {
    const world = worldOf(on);
    world.tracked.add("src/m.ts");
    world.failingDiff = true;
    const pane = await paneWith($, world, [edit("/work/src/m.ts", 1, 0)]);

    await pressFile(pane, world, "m.ts");
    const labelsInView = await buttonLabels(pane);
    await pressButton(pane, world, "back");

    expect(labelsInView).toContain("back");
    expect(shownTexts(await pane.drawn()).some((text) => text.startsWith("▾ /work/"))).toBe(true);
  });
});

function diffCommands(world: World): string[][] {
  return world.commands.filter((argv) => argv.includes("diff") || argv.includes("ls-files"));
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

async function commit(
  $: Engine,
  world: World,
  command: string,
  head: string,
  numstat: string,
): Promise<void> {
  world.heads.push(head);
  world.numstat = numstat;
  await ($.tool.call as (e: object) => Promise<unknown>)({
    tool: "Bash",
    command,
    tool_use_id: `commit-${head}`,
  });
}

async function pressFile(pane: Pane, world: World, name: string): Promise<void> {
  await pressButton(pane, world, name);
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

async function ruleRows(pane: Pane): Promise<string[]> {
  const texts = collect((await pane.drawn()) as Node, "Text")
    .map((node) => textOf(node).trim())
    .filter((text) => /^─+$/.test(text));
  return [...new Set(texts)];
}

async function buttonLabels(pane: Pane): Promise<string[]> {
  const buttons = await pane.findAll({ type: "Button" });
  return buttons.map((button) => String(button.props.label));
}

async function diffSource(pane: Pane): Promise<string | undefined> {
  const [code] = collect(await pane.drawn(), "Code");
  const source = code?.props?.source;
  return typeof source === "string" ? source : undefined;
}

function worldOf(on: On): World {
  store.clear();
  const world: World = {
    tracked: new Set<string>(),
    diffs: new Map<string, string>(),
    files: new Map<string, string>(),
    heads: ["head-0"],
    commands: [] as string[][],
    failingDiff: false,
    numstat: "",
    clock: mock.clock(on, { now: NOW }),
  };
  mock.env(on, { HOME: "/h/u" });
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
  on("session.cwd", () => ({ value: "/work" }));
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", () => ({ value: true }));
  on("fs.read", (_$, e) => {
    const text = world.files.get(e.path);
    if (text === undefined) throw new Error(`no such file ${e.path}`);
    return { value: text };
  });
  on("tool.call", () => ({ result: "ok", text: "ok" }));
  on("process.run", (_$, e) => {
    world.commands.push([...e.argv]);
    return { value: gitAnswer(world, [...e.argv]) } as never;
  });
  return world;
}

function gitAnswer(
  world: World,
  argv: string[],
): { exitCode: number; stdout: string; stderr: string } {
  const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: "" });
  const dir = argv[2] ?? "";
  const root = dir.startsWith("/work/wt") ? "/work/wt" : "/work";
  if (argv.includes("--abbrev-ref")) return ok("main");
  if (argv.includes("--show-toplevel"))
    return ok(argv.includes("HEAD") ? `${root}\n${nextHead(world)}` : root);
  if (argv.includes("--numstat")) return ok(world.numstat);
  const file = relative(root, argv[argv.indexOf("--") + 1] ?? "");
  if (argv.includes("ls-files")) return ok(world.tracked.has(file) ? file : "");
  if (argv.includes("--no-index")) return { exitCode: 1, stdout: "", stderr: "" };
  if (argv.includes("diff")) {
    if (world.failingDiff) return { exitCode: 128, stdout: "", stderr: "fatal" };
    const base = argv[argv.indexOf("diff") + 1] ?? "";
    return ok(world.diffs.get(`${dir}:${base}:${file}`) ?? "");
  }
  return ok("");
}

function nextHead(world: World): string | undefined {
  return world.heads.length > 1 ? world.heads.shift() : world.heads[0];
}

function relative(root: string, file: string): string {
  return file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
}

async function paneWith($: Engine, world: World, activity: Activity[]): Promise<Pane> {
  store.set("activity", { value: activity, version: 1 });
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
  await pressButton(pane, world, "Files");
  return pane;
}
