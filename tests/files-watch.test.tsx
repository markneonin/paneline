import { describe, expect, mock, test } from "claude-code/testing";
import type { EngineInterface, On } from "claude-code";
import type { Engine, MockClock, Mounted } from "claude-code/testing";
import type { Activity } from "../types";
import * as review from "../hooks/review-git";
import { shownTexts } from "./skills-tree";

type Pane = Mounted<"terminal", "Pane">;

type World = {
  numstat: string;
  isRepo: boolean;
  missing: Set<string>;
  untracked: Set<string>;
  files: Map<string, string>;
  commands: string[][];
  clock: MockClock;
};

const COLUMNS = 80;
const ROWS = 40;
const NOW = 1_000;
const FLUSH_MS = 400;
const SETTLE_TICKS = 5;
const ROOT = "/work";
const FILE = "/work/src/m.ts";
const OTHER_FILE = "/work/src/other.ts";
const NEW_NAME = "made.txt";
const NEW_FILE = `${ROOT}/${NEW_NAME}`;
const COUNT = /\+\d+ -\d+/;

const store = new Map<string, { value: unknown; version: number }>();

describe("files live updates", () => {
  test("V3 a changed listed file shows its new plus and minus numbers", async ($, on) => {
    const world = worldOf(on);
    world.numstat = "1\t0\tsrc/m.ts";
    const pane = await paneWith($, world, [edit(FILE)]);
    expect(rowOf(shownTexts(await pane.drawn()), "m.ts")).toContain("+1 -0");

    world.numstat = "5\t2\tsrc/m.ts";
    await $.classic.FileChanged({ file_path: FILE, event: "change" });
    await settle(pane);

    expect(rowOf(shownTexts(await pane.drawn()), "m.ts")).toContain("+5 -2");
  });

  test("V4 a listed file that is deleted from outside leaves the list", async ($, on) => {
    const world = worldOf(on);
    const pane = await paneWith($, world, [edit(FILE), edit(OTHER_FILE)]);
    expect(rowOf(shownTexts(await pane.drawn()), "m.ts")).toBeDefined();

    world.missing.add(FILE);
    await $.classic.FileChanged({ file_path: FILE, event: "unlink" });
    await settle(pane);

    const shown = shownTexts(await pane.drawn());
    expect(rowOf(shown, "m.ts")).toBeUndefined();
    expect(rowOf(shown, "other.ts")).toBeDefined();
  });

  test("V5 a change to a file the pane does not list runs no git command", async ($, on) => {
    const world = worldOf(on);
    const pane = await paneWith($, world, [edit(FILE)]);
    const before = world.commands.length;

    await $.classic.FileChanged({ file_path: "/work/.git/index", event: "change" });
    await $.classic.FileChanged({ file_path: "/work/src/new.ts", event: "add" });
    await settle(pane);

    expect(world.commands).toHaveLength(before);
  });

  test("A1 a new one-line file written with Bash shows +1 -0 in the Files tab", async ($, on) => {
    const world = worldOf(on);
    world.untracked.add(NEW_NAME);
    world.files.set(NEW_FILE, "one\n");

    const pane = await paneWith($, world, [bashWrote("b1", NEW_FILE)]);

    expect(countOf(shownTexts(await pane.drawn()), NEW_NAME)).toBe("+1 -0");
  });

  test("A2 a new three-line file without a trailing newline shows +3 -0 in Files and added 3 in Review", async ($, on) => {
    const world = worldOf(on);
    world.untracked.add(NEW_NAME);
    world.files.set(NEW_FILE, "one\ntwo\nthree");

    const pane = await paneWith($, world, [bashWrote("b1", NEW_FILE)]);
    const reviewed = await review.reviewFiles(reviewEngineOf(world), "uncommitted", []);

    expect(countOf(shownTexts(await pane.drawn()), NEW_NAME)).toBe("+3 -0");
    expect(reviewed).toMatchObject({ files: [{ path: NEW_NAME, added: 3, removed: 0 }] });
  });

  test("A3 a tracked edit keeps its +2 -1 next to a new file's +1 -0", async ($, on) => {
    const world = worldOf(on);
    world.numstat = "2\t1\tsrc/m.ts";
    world.untracked.add(NEW_NAME);
    world.files.set(NEW_FILE, "one\n");

    const pane = await paneWith($, world, [edit(FILE), bashWrote("b1", NEW_FILE)]);
    const shown = shownTexts(await pane.drawn());

    expect(countOf(shown, "m.ts")).toBe("+2 -1");
    expect(countOf(shown, NEW_NAME)).toBe("+1 -0");
  });

  test("A4 a new file the agent saves with two more lines updates its row to +3 -0 while the Files tab is open", async ($, on) => {
    const world = worldOf(on);
    world.untracked.add(NEW_NAME);
    world.files.set(NEW_FILE, "one\n");
    const pane = await paneWith($, world, [bashWrote("b1", NEW_FILE)]);

    world.files.set(NEW_FILE, "one\ntwo\nthree\n");
    await $.classic.FileChanged({ file_path: NEW_FILE, event: "change" });
    await settle(pane);

    expect(countOf(shownTexts(await pane.drawn()), NEW_NAME)).toBe("+3 -0");
  });

  test("A5 leaving the Files tab and coming back keeps the new file at +1 -0", async ($, on) => {
    const world = worldOf(on);
    world.untracked.add(NEW_NAME);
    world.files.set(NEW_FILE, "one\n");
    const pane = await paneWith($, world, [bashWrote("b1", NEW_FILE)]);

    await openTab(pane, "Activity");
    await settle(pane);
    await openTab(pane, "Files");
    await settle(pane);

    expect(countOf(shownTexts(await pane.drawn()), NEW_NAME)).toBe("+1 -0");
  });
});

function rowOf(texts: string[], name: string): string | undefined {
  return texts.find((text) => text.includes(name));
}

function countOf(texts: string[], name: string): string | undefined {
  return rowOf(texts, name)?.match(COUNT)?.[0];
}

function edit(target: string): Activity {
  return { id: target, tool: "Edit", target, ms: 1, isErrored: false, added: 0, removed: 0 };
}

function bashWrote(id: string, target: string): Activity {
  return {
    id,
    tool: "Bash",
    target: `printf one > ${target}`,
    ms: 1,
    isErrored: false,
    added: 0,
    removed: 0,
    files: [{ target, added: 0, removed: 0 }],
  };
}

async function openTab(pane: Pane, label: string): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  await pane.press({ key: buttons.find((button) => button.props.label === label)?.key ?? "" });
}

async function settle(pane: Pane): Promise<void> {
  for (let tick = 0; tick < SETTLE_TICKS; tick++) await pane.redraw();
}

function worldOf(on: On): World {
  store.clear();
  const world: World = {
    numstat: "",
    isRepo: true,
    missing: new Set<string>(),
    untracked: new Set<string>(),
    files: new Map<string, string>(),
    commands: [],
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
  on("classic.FileChanged", () => ({}));
  on("settings.read", () => ({ value: {} }));
  on("store.get", () => ({ value: undefined }));
  on("store.set", () => ({ value: undefined }));
  on("config.list", () => ({ value: [] }));
  on("session.id", () => ({ value: "session-1" }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: ROOT }));
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", (_$, e) => ({ value: !world.missing.has(e.path) }));
  on("fs.read", (_$, e) => ({ value: fileText(world, e.path) }));
  on("fs.stat", (_$, e) => ({ value: statOf(world, e.path) }));
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

function fileText(world: World, path: string): string {
  const text = world.files.get(path);
  if (text === undefined) throw new Error(`no such file ${path}`);
  return text;
}

type Stat = { kind: "file" | "dir" | "other"; size: number; mtimeMs: number; isLink: boolean };

function statOf(world: World, path: string): Stat {
  const isFolder =
    path === ROOT || [...world.files.keys()].some((file) => file.startsWith(`${path}/`));
  if (isFolder) return { kind: "dir", size: 0, mtimeMs: 0, isLink: false };
  const size = new TextEncoder().encode(fileText(world, path)).length;
  return { kind: "file", size, mtimeMs: 0, isLink: false };
}

function reviewEngineOf(world: World): EngineInterface {
  return {
    session: { root: async () => ROOT },
    ui: { log: () => undefined },
    fs: { read: async (path: string) => fileText(world, path) },
    process: { run: async (argv: string[]) => gitAnswer(world, argv) },
  } as unknown as EngineInterface;
}

function gitAnswer(
  world: World,
  argv: string[],
): { exitCode: number; stdout: string; stderr: string } {
  const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: "" });
  if (argv.includes("--show-toplevel"))
    return world.isRepo
      ? ok(
          argv.includes("--abbrev-ref")
            ? `${ROOT}\nhead-0\nmain`
            : argv.includes("HEAD")
              ? `${ROOT}\nhead-0`
              : ROOT,
        )
      : { exitCode: 128, stdout: "", stderr: "fatal" };
  if (argv.includes("--abbrev-ref")) return ok("main");
  if (argv.includes("--numstat")) return ok(world.numstat);
  if (argv.includes("rev-parse") && argv.includes("HEAD")) return ok("head-0");
  if (argv.includes("--others")) {
    const separator = argv.includes("-z") ? "\0" : "\n";
    return ok([...world.untracked].map((path) => `${path}${separator}`).join(""));
  }
  if (argv.includes("ls-files")) return ok("src/m.ts\nsrc/other.ts");
  return ok("");
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
  await openTab(pane, "Files");
  await world.clock.advance(FLUSH_MS);
  await settle(pane);
  return pane;
}
