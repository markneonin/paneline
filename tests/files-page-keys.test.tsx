import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, MockClock, Mounted } from "claude-code/testing";

import { TAB_BAR_ROWS } from "../hooks/tab-bar";
import type { Activity } from "../types";
import { collect, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import { linesOf } from "./skills-tree";

type Pane = Mounted<"terminal", "Pane">;
type World = {
  tracked: Set<string>;
  diffs: Map<string, string>;
  files: Map<string, string>;
  heads: string[];
  commands: string[][];
  failingDiff: boolean;
  numstat: string;
  opened: { focus: boolean | undefined }[];
  clock: MockClock;
};

const COLUMNS = 60;
const ROWS = 40;
const NOW = 1_000;
const FLUSH_MS = 400;
const SETTLE_TICKS = 5;
const LONG_FILE = "src/long.ts";
const SIBLING = "src/other.ts";
const DIFF_LINES = 240;
const PAGE_ROWS = ROWS;
const MAX_PRESSES = 60;
const store = new Map<string, { value: unknown; version: number }>();

describe("files diff page keys", () => {
  test("A2 pressing a file row in the Files tab opens its diff and asks the pane for focus", async ($, on) => {
    const world = worldOf(on);
    const pane = await longDiffPane($, world);
    world.opened.length = 0;

    await pressButton(pane, world, "long.ts");

    expect(world.opened.some((call) => call.focus === true)).toBe(true);
  });

  test("A4 folding a folder in the Files tab asks the pane for no focus", async ($, on) => {
    const world = worldOf(on);
    const pane = await longDiffPane($, world);
    world.opened.length = 0;

    await pressFolder(pane, world);

    const labels = (await pane.findAll({ type: "Button" })).map((button) =>
      String(button.props.label),
    );
    expect(labels.some((label) => label.startsWith("▸"))).toBe(true);
    expect(world.opened.some((call) => call.focus === true)).toBe(false);
  });

  test("A9 PageDown steps through a 240-line Files diff at 60 columns without skipping a row", async ($, on) => {
    const world = worldOf(on);
    const pane = await longDiffPane($, world);
    await pressButton(pane, world, "long.ts");
    const total = await bodyRowsOf(pane);

    const windows = await pageThrough($, pane, total);

    expect(uncoveredRows(windows, total)).toEqual([]);
  });
});

async function longDiffPane($: Engine, world: World): Promise<Pane> {
  world.tracked.add(LONG_FILE);
  world.tracked.add(SIBLING);
  world.numstat = `${DIFF_LINES}\t0\t${LONG_FILE}\n1\t0\t${SIBLING}`;
  world.diffs.set(`/work:HEAD:${LONG_FILE}`, diffOf(LONG_FILE, longBody()));
  world.diffs.set(`/work:HEAD:${SIBLING}`, diffOf(SIBLING, ["+one"]));
  return paneWith($, world, [
    edit(`/work/${LONG_FILE}`, DIFF_LINES, 0),
    edit(`/work/${SIBLING}`, 1, 0),
  ]);
}

function longBody(): string[] {
  return Array.from({ length: DIFF_LINES }, (_, i) => `+entry ${i + 1} of the long file`);
}

async function pressFolder(pane: Pane, world: World): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const folder = buttons.find((button) => String(button.props.label).startsWith("▾"));
  expect(folder, "a folder row").toBeDefined();
  await pane.press({ key: folder?.key ?? "" });
  await world.clock.advance(FLUSH_MS);
  await settle(pane);
}

async function bodyRowsOf(pane: Pane): Promise<number> {
  const drawn = (await pane.drawn()) as Node;
  const [code] = collect(drawn, "Code");
  const source = typeof code?.props?.source === "string" ? code.props.source : "";
  return linesOf(drawn).length + source.split("\n").length;
}

async function offsetOf(pane: Pane): Promise<number> {
  const body = collect((await pane.drawn()) as Node, "Box").find(
    (box) => typeof box.props?.marginTop === "number" && box.props.marginTop <= 0,
  );
  return -(Number(body?.props?.marginTop) || 0);
}

async function scrollBy($: Engine, pane: Pane, by: number, total: number): Promise<void> {
  const offset = await offsetOf(pane);
  await $.ui.scroll({
    component: "Pane",
    requestId: "session",
    offset: 0,
    by,
    bodyRows: ROWS,
    contentRows: offset > 0 ? total + ROWS : total,
    origin: { kind: "person" },
  });
  await settle(pane);
}

type Window = { offset: number; shown: number };

async function windowOf(pane: Pane): Promise<Window> {
  const hasCue = collect(await pane.drawn(), "Text").some((text) =>
    textOf(text).includes("more lines"),
  );
  return { offset: await offsetOf(pane), shown: ROWS - TAB_BAR_ROWS - (hasCue ? 1 : 0) };
}

async function pageThrough($: Engine, pane: Pane, total: number): Promise<Window[]> {
  const windows = [await windowOf(pane)];
  for (let press = 0; press < MAX_PRESSES; press++) {
    await scrollBy($, pane, PAGE_ROWS, total);
    const next = await windowOf(pane);
    if (next.offset === windows.at(-1)?.offset) break;
    windows.push(next);
  }
  return windows;
}

function uncoveredRows(windows: Window[], total: number): number[] {
  const covered = new Set(
    windows.flatMap(({ offset, shown }) => Array.from({ length: shown }, (_, i) => offset + i)),
  );
  return Array.from({ length: total - TAB_BAR_ROWS }, (_, i) => i).filter(
    (row) => !covered.has(row),
  );
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
    opened: [],
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
  on("ui.open", (_$, e) => {
    world.opened.push({ focus: e.focus });
    return { value: { isPlaced: true } };
  });
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("settings.read", () => ({ value: {} }));
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
  if (argv.includes("--abbrev-ref") && argv.includes("--show-toplevel"))
    return ok(`${root}\n${nextHead(world)}\nmain`);
  if (argv.includes("--abbrev-ref")) return ok("main");
  if (argv.includes("--show-toplevel"))
    return ok(argv.includes("HEAD") ? `${root}\n${nextHead(world)}` : root);
  if (argv.includes("--others") || argv.includes("--name-status")) return ok("");
  if (argv.includes("--name-only")) return ok(pathsOf(world.numstat));
  if (argv.includes("--numstat"))
    return ok(argv.includes("-z") ? nulSeparated(world.numstat) : world.numstat);
  if (argv.includes("rev-parse") && argv.includes("HEAD")) return ok(world.heads[0] ?? "");
  const file = relative(root, argv[argv.indexOf("--") + 1] ?? "");
  if (argv.includes("ls-files")) return ok(world.tracked.has(file) ? file : "");
  if (argv.includes("--no-index")) return { exitCode: 1, stdout: "", stderr: "" };
  if (argv.includes("diff")) {
    if (world.failingDiff) return { exitCode: 128, stdout: "", stderr: "fatal" };
    const base = argv[argv.indexOf("diff") + 1] ?? "";
    const text = world.diffs.get(`${dir}:${base}:${file}`);
    return ok(text ?? world.diffs.get(`${dir}:HEAD:${file}`) ?? "");
  }
  return ok("");
}

function nulSeparated(numstat: string): string {
  return numstat
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => `${line}\0`)
    .join("");
}

function pathsOf(numstat: string): string {
  return numstat
    .split("\n")
    .map((line) => line.split("\t")[2] ?? "")
    .filter((path) => path !== "")
    .join("\n");
}

function nextHead(world: World): string | undefined {
  return world.heads.length > 1 ? world.heads.shift() : world.heads[0];
}

function relative(root: string, file: string): string {
  return file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file;
}

async function paneWith(
  $: Engine,
  world: World,
  activity: Activity[],
  columns: number = COLUMNS,
): Promise<Pane> {
  store.set("activity", { value: activity, version: 1 });
  const pane = await mountSessionPane($, columns);
  await pressButton(pane, world, "Files");
  return pane;
}

function mountSessionPane($: Engine, columns: number): Promise<Pane> {
  return $.ui.mount({
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
}
