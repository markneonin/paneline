import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, MockClock, Mounted } from "claude-code/testing";

import type { Activity } from "../types";
import { collect } from "./draw-tree";

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
const ESC = "\u001b";
const NUL = "\u0000";
const ESC_SYMBOL = "\u241b";
const NUL_SYMBOL = "\u2400";
const CR_SYMBOL = "\u240d";
const store = new Map<string, { value: unknown; version: number }>();

describe("files diff of odd files", () => {
  test("A11 a changed line with an escape byte opens the diff and shows the escape as a symbol", async ($, on) => {
    const world = worldOf(on);
    world.tracked.add("src/m.ts");
    world.diffs.set("/work:HEAD:src/m.ts", diffOf("src/m.ts", [`+${ESC}[31mred`, "-old"]));
    const pane = await paneWith($, world, [edit("/work/src/m.ts", 1, 1)]);

    await pressFile(pane, world, "m.ts");

    expect(await buttonLabels(pane)).toContain("back");
    expect(await diffSource(pane)).toContain(`+${ESC_SYMBOL}[31mred`);
  });

  test("A12 a changed line with a NUL opens the diff and shows the NUL as a symbol", async ($, on) => {
    const world = worldOf(on);
    world.tracked.add("src/m.ts");
    world.diffs.set("/work:HEAD:src/m.ts", diffOf("src/m.ts", [`+a${NUL}b`, "-old"]));
    const pane = await paneWith($, world, [edit("/work/src/m.ts", 1, 1)]);

    await pressFile(pane, world, "m.ts");

    expect(await buttonLabels(pane)).toContain("back");
    expect(await diffSource(pane)).toContain(`+a${NUL_SYMBOL}b`);
  });

  test("A13 a changed line with a carriage return in the middle opens the diff and shows it as a symbol", async ($, on) => {
    const world = worldOf(on);
    world.tracked.add("src/m.ts");
    world.diffs.set("/work:HEAD:src/m.ts", diffOf("src/m.ts", ["+left\rright", "-old"]));
    const pane = await paneWith($, world, [edit("/work/src/m.ts", 1, 1)]);

    await pressFile(pane, world, "m.ts");

    expect(await buttonLabels(pane)).toContain("back");
    expect(await diffSource(pane)).toContain(`+left${CR_SYMBOL}right`);
  });

  test("A14 a file with Windows line endings shows its changed line as plain text with no symbol", async ($, on) => {
    const world = worldOf(on);
    world.tracked.add("src/m.ts");
    world.diffs.set("/work:HEAD:src/m.ts", diffOf("src/m.ts", ["+changed\r", "-old\r"]));
    const pane = await paneWith($, world, [edit("/work/src/m.ts", 1, 1)]);

    await pressFile(pane, world, "m.ts");

    const source = (await diffSource(pane)) ?? "";
    expect(source).toContain("+changed");
    expect(source).not.toContain(CR_SYMBOL);
  });

  test("A15 a new file with an escape byte and a NUL opens its diff and shows both as symbols", async ($, on) => {
    const world = worldOf(on);
    world.files.set("/work/src/new.ts", `alpha\n${ESC}[31mred\n${NUL}tail\n`);
    const pane = await paneWith($, world, [edit("/work/src/new.ts", 3, 0)]);

    await pressFile(pane, world, "new.ts");

    expect(await buttonLabels(pane)).toContain("back");
    const source = (await diffSource(pane)) ?? "";
    expect(source).toContain(`+${ESC_SYMBOL}[31mred`);
    expect(source).toContain(`+${NUL_SYMBOL}tail`);
  });
});

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
  if (argv.includes("--abbrev-ref")) return ok("main");
  if (argv.includes("--show-toplevel"))
    return ok(argv.includes("HEAD") ? `${root}\n${nextHead(world)}` : root);
  if (argv.includes("--numstat")) return ok(world.numstat);
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
