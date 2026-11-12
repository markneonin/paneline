import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, MockClock, Mounted } from "claude-code/testing";

import { collect, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import { commitAll, gitAnswer, mergeIn, sessionRepoOf, strayFolderOf } from "./one-baseline-world";
import type { Session } from "./one-baseline-world";
import { TOP } from "./review-world";
import { linesOf } from "./skills-tree";

type Pane = Mounted<"terminal", "Pane">;
type World = { session: Session; clock: MockClock; effects: (() => unknown)[]; calls: number };
type Seen = { filesRow: string; filesHeader: string; reviewRow: string; reviewDetail: string };

const COLUMNS = 100;
const ROWS = 40;
const NOW = 1_000;
const FLUSH_MS = 400;
const SETTLE_TICKS = 5;
const NEXT_PAGE = "›";
const PREVIOUS_PAGE = "‹";
const COUNT = /\+\d+ -\d+/;
const FILE = "src/handler.ts";
const NAME = "handler.ts";
const START_HEAD = "aaaaaaa1";
const BIG_LINES = 1500;
const BIG_LINE_CHARS = 80;
const TOOL_OK = { result: "ok", text: "ok" };
const COMMENTS_PATH = `${TOP}/.git/paneline-review.json`;

describe("files and review count from one baseline", () => {
  test("S1 a file already dirty before the session shows the same plus and minus as git in Files and Review after an edit", async ($, on) => {
    const world = worldOf(on, sessionRepoOf({ [FILE]: "a = 1\n" }));
    world.session.repo.work.set(FILE, "a = 100\na = 2\nb = 3\n");
    const pane = await openFiles($, world);

    await toolEdit($, world, FILE, "a = 100\na = 2\nb = 33\n");
    const seen = await seenIn(pane, world, NAME);

    expect(seen).toEqual(allShow(await gitCounts(world, START_HEAD, FILE)));
  });

  test("S2 an untracked file written with two lines and edited to six shows plus six minus zero in Files and Review", async ($, on) => {
    const world = worldOf(on, sessionRepoOf({ "keep.txt": "keep\n" }));
    const pane = await openFiles($, world);

    await toolWrite($, world, "fresh.txt", "one\ntwo\n");
    await toolEdit($, world, "fresh.txt", "one\ntwo\nthree\nfour\nfive\nsix\n");
    const seen = await seenIn(pane, world, "fresh.txt");

    expect(seen).toEqual(allShow(await untrackedCounts(world, "fresh.txt")));
  });

  test("S3 a second edit after a recount shows git's numbers, not the two edits added together", async ($, on) => {
    const world = worldOf(on, sessionRepoOf({ [FILE]: "one\ntwo\nthree\n" }));
    const pane = await openFiles($, world);
    await toolEdit($, world, FILE, "ONE\ntwo\nthree\n");
    await openTab(pane, world, "Activity");
    await openTab(pane, world, "Files");

    await toolEdit($, world, FILE, "UNO\ntwo\nthree\n");
    const seen = await seenIn(pane, world, NAME);

    expect(seen).toEqual(allShow(await gitCounts(world, START_HEAD, FILE)));
  });

  test("S4 a change whose diff is over one hundred thousand characters shows git's numbers in the open file header", async ($, on) => {
    const world = worldOf(on, sessionRepoOf({ [FILE]: bigText("old") }));
    const pane = await openFiles($, world);

    await toolEdit($, world, FILE, bigText("new"));
    const seen = await seenIn(pane, world, NAME);

    expect(seen).toEqual(allShow(await gitCounts(world, START_HEAD, FILE)));
  });

  test("S5a after a commit inside the session, the edited file keeps its numbers against the first base", async ($, on) => {
    const world = worldOf(on, sessionRepoOf({ [FILE]: "one\ntwo\n" }));
    const pane = await openFiles($, world);
    await toolEdit($, world, FILE, "ONE\ntwo\n");
    await toolBash($, world, "git commit -am mid", () => commitAll(world.session, "bbbbbbb2"));

    await toolEdit($, world, FILE, "ONE\ntwo\nthree\n");
    const seen = await seenIn(pane, world, NAME);

    expect(seen).toEqual(allShow(await gitCounts(world, START_HEAD, FILE)));
  });

  test("S5b a merge that brings in a file the session never edited shows that file's numbers against the first base", async ($, on) => {
    const world = worldOf(on, sessionRepoOf({ [FILE]: "one\ntwo\n", "other.ts": "x\n" }));
    const pane = await openFiles($, world);
    await toolEdit($, world, FILE, "ONE\ntwo\n");

    await toolBash($, world, "git merge side", () =>
      mergeIn(world.session, "ccccccc3", { "other.ts": "x\ny\nz\n" }),
    );
    const seen = await seenIn(pane, world, "other.ts");

    expect(seen).toEqual(allShow(await gitCounts(world, START_HEAD, "other.ts")));
  });

  test("S6 a file outside any repo keeps its own edit counts in the Files row", async ($, on) => {
    const world = worldOf(on, strayFolderOf({ "loose.txt": "one\ntwo\n" }));
    const pane = await openFiles($, world);

    await toolEdit($, world, "loose.txt", "ONE\ntwo\n");

    expect(await filesRowCount(pane, world, "loose.txt")).toBe("+1 -1");
  });

  test("S7 a subagent edit of a listed file shows git's numbers in the row without reopening the tab", async ($, on) => {
    const world = worldOf(on, sessionRepoOf({ [FILE]: "a = 1\n" }));
    world.session.repo.work.set(FILE, "a = 100\na = 2\nb = 3\n");
    const pane = await openFiles($, world);
    await toolEdit($, world, FILE, "a = 100\na = 2\nb = 4\n");

    await toolEdit($, world, FILE, "a = 100\na = 2\nb = 44\n", "agent-1");

    expect(await filesRowCount(pane, world, NAME)).toBe(
      plusMinus(await gitCounts(world, START_HEAD, FILE)),
    );
  });
});

function allShow(counts: { added: number; removed: number }): Seen {
  const shown = plusMinus(counts);
  return { filesRow: shown, filesHeader: shown, reviewRow: shown, reviewDetail: shown };
}

function plusMinus({ added, removed }: { added: number; removed: number }): string {
  return `+${added} -${removed}`;
}

function bigText(word: string): string {
  const line = `${word} `.padEnd(BIG_LINE_CHARS - 6, "x");
  return `${Array.from({ length: BIG_LINES }, (_, i) => `${line}${i}`).join("\n")}\n`;
}

async function gitCounts(world: World, base: string, path: string) {
  const ran = await world.session.repo.$.process.run([
    "git",
    "-C",
    TOP,
    "diff",
    "--numstat",
    "--no-renames",
    base,
    "--",
    path,
  ]);
  return countsOf(ran.stdout);
}

async function untrackedCounts(world: World, path: string) {
  const ran = await world.session.repo.$.process.run([
    "git",
    "-C",
    TOP,
    "diff",
    "--no-index",
    "--numstat",
    "/dev/null",
    `${TOP}/${path}`,
  ]);
  return countsOf(ran.stdout);
}

function countsOf(numstat: string): { added: number; removed: number } {
  const [added = "0", removed = "0"] = numstat.split("\n")[0]?.split("\t") ?? [];
  return { added: Number(added), removed: Number(removed) };
}

function worldOf(on: On, session: Session): World {
  const { repo } = session;
  const world: World = { session, clock: mock.clock(on, { now: NOW }), effects: [], calls: 0 };
  mock.env(on, { HOME: "/h/u" });
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
  on("session.cwd", () => ({ value: TOP }));
  on("session.root", () => ({ value: TOP }));
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", async (_$, e) => ({
    value:
      e.path !== COMMENTS_PATH &&
      (await repo.$.fs.stat(e.path).then(
        () => true,
        () => false,
      )),
  }));
  on("fs.read", async (_$, e) => ({ value: await repo.$.fs.read(e.path) }));
  on("fs.stat", async (_$, e) => ({ value: await repo.$.fs.stat(e.path) }));
  on("fs.write", () => ({ value: undefined }));
  on("process.run", async (_$, e) => {
    if (repo.top !== null && e.argv.includes("--absolute-git-dir"))
      return { value: { exitCode: 0, stdout: `${TOP}/.git\n`, stderr: "" } } as never;
    return {
      value: {
        isStdoutTruncated: false,
        isStderrTruncated: false,
        ...(await gitAnswer(session, e.argv)),
      },
    };
  });
  on("tool.call", () => (world.effects.shift()?.() ?? TOOL_OK) as never);
  return world;
}

function patchResult(before: string, after: string): { result: unknown; text: string } {
  const was = before.split("\n");
  const now = after.split("\n");
  const changed = now.map((_, i) => i).filter((i) => was[i] !== now[i]);
  const lines = [
    ...changed.map((i) => `-${was[i] ?? ""}`),
    ...changed.map((i) => `+${now[i] ?? ""}`),
  ];
  const patch = { oldStart: 1, oldLines: was.length, newStart: 1, newLines: now.length, lines };
  return { result: { structuredPatch: [patch] }, text: "ok" };
}

async function toolEdit(
  $: Engine,
  world: World,
  path: string,
  text: string,
  agentId?: string,
): Promise<void> {
  const { work } = world.session.repo;
  const patched = patchResult(work.get(path) ?? "", text);
  world.effects.push(() => {
    work.set(path, text);
    return patched;
  });
  await $.tool.call({
    tool: "Edit",
    file_path: `${TOP}/${path}`,
    old_string: "a",
    new_string: "b",
    tool_use_id: `edit-${world.calls++}`,
    ...(agentId === undefined ? {} : { agentId }),
  } as never);
  await world.clock.advance(FLUSH_MS);
}

async function toolWrite($: Engine, world: World, path: string, text: string): Promise<void> {
  const { work, untracked } = world.session.repo;
  world.effects.push(() => {
    work.set(path, text);
    untracked.add(path);
  });
  await $.tool.call({
    tool: "Write",
    file_path: `${TOP}/${path}`,
    content: text,
    tool_use_id: `write-${world.calls++}`,
  } as never);
  await world.clock.advance(FLUSH_MS);
}

async function toolBash(
  $: Engine,
  world: World,
  command: string,
  effect: () => void,
): Promise<void> {
  world.effects.push(effect);
  await $.tool.call({ tool: "Bash", command, tool_use_id: `bash-${world.calls++}` } as never);
  await world.clock.advance(FLUSH_MS);
}

async function redraw(pane: Pane, world: World): Promise<void> {
  await world.clock.advance(FLUSH_MS);
  for (let tick = 0; tick < SETTLE_TICKS; tick++) await pane.redraw();
}

async function openFiles($: Engine, world: World): Promise<Pane> {
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
  await openTab(pane, world, "Files");
  return pane;
}

async function seenIn(pane: Pane, world: World, name: string): Promise<Seen> {
  await redraw(pane, world);
  const filesRow = countIn(await shown(pane), name);
  await press(pane, world, (button) => plainLabel(button) === name);
  const header = (await shown(pane)).filter((text) => text.startsWith("[ back ]"));
  const filesHeader = countIn(header, name);
  await openTab(pane, world, "Review");
  const reviewRow = countIn(await shown(pane), name);
  await press(pane, world, (button) => plainLabel(button).includes(name));
  const reviewDetail = countIn(await shown(pane), name);
  return { filesRow, filesHeader, reviewRow, reviewDetail };
}

async function filesRowCount(pane: Pane, world: World, name: string): Promise<string> {
  await redraw(pane, world);
  return countIn(await shown(pane), name);
}

function countIn(rows: string[], name: string): string {
  const row = rows.find((one) => one.includes(name) && COUNT.test(one));
  return row?.match(COUNT)?.[0] ?? `no counts in ${rows.join(" // ").slice(0, 300)}`;
}

async function shown(pane: Pane): Promise<string[]> {
  return linesOf((await pane.drawn()) as Node)
    .map((line) => line.text)
    .filter((text) => text !== "");
}

function plainLabel(node: Node): string {
  const label = node.props?.label;
  const raw = typeof label === "string" ? label : textOf(node);
  return raw.replace(/^\[\s*|\s*\]$/g, "").trim();
}

async function buttons(pane: Pane): Promise<Node[]> {
  return collect(await pane.drawn(), "Button");
}

async function press(pane: Pane, world: World, match: (button: Node) => boolean): Promise<void> {
  const all = await buttons(pane);
  const target = all.find(match);
  expect(
    target,
    `a button to press among ${all.map(plainLabel).join("|")} in ${(await shown(pane)).join(" // ")}`,
  ).toBeDefined();
  await pane.press({ key: String(target?.props?.key) });
  await redraw(pane, world);
}

async function openTab(pane: Pane, world: World, label: string): Promise<void> {
  const isShown = async () => (await buttons(pane)).some((button) => plainLabel(button) === label);
  if (!(await isShown())) {
    const hasNext = (await buttons(pane)).some((button) => plainLabel(button).endsWith(NEXT_PAGE));
    await press(pane, world, (button) =>
      hasNext
        ? plainLabel(button).endsWith(NEXT_PAGE)
        : plainLabel(button).startsWith(PREVIOUS_PAGE),
    );
  }
  if (await isShown()) await press(pane, world, (button) => plainLabel(button) === label);
}
