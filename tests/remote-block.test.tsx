import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { TAB_BAR_ROWS } from "../hooks/tab-bar";
import { childrenOf, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";

type Pane = Mounted<"terminal", "Pane">;
type Review = {
  kind: "PR" | "MR";
  number: number;
  ci: "pass" | "fail" | "pending" | "none";
  threads: number;
};
type RemoteRepo = {
  branch: string;
  ahead: number | null;
  behind: number | null;
  review: Review | null;
};

const COLUMNS = 100;
const NARROW = 60;
const REMOTE_HEADING = "Remote ─";
const FILES_HEADING = "Files ─";
const NO_FILES_TEXT = "no files touched yet · edits and reads show here";
const LONG_BRANCH = "feature/remote-block-with-a-very-long-branch-name-for-clipping";
const SHARED_LONG_BRANCH = "feature/some-long-name-x";
const WORK_ROOT = "/h/u/code/work";
const OTHER_ROOT = "/h/u/code/other";
const WORK_NAME = "work/";
const OTHER_NAME = "other/";
const WORK_TAIL = "work/";
const OTHER_TAIL = "other/";
const SAME_NAME_A_ROOT = "/h/u/code/a/app";
const SAME_NAME_B_ROOT = "/h/u/code/b/app";
const SAME_NAME_A = "a/app/";
const SAME_NAME_B = "b/app/";
const store = new Map<string, { value: unknown; version: number }>();

describe("remote block", () => {
  test("B1 the Remote block shows the branch, ahead and behind, the PR, its CI and threads above the Files heading", async ($, on) => {
    worldOf(on);
    seedRemote({ "/work": githubBranch() });
    const pane = await paneWith($);

    const landmarks = await landmarksOf(pane);
    const { block, after } = remoteBlockAt(await drawnLines(pane));

    expect(landmarks).toEqual(["Remote", "Files"]);
    expect(block[0]).toContain(REMOTE_HEADING);
    expect(rowWith(block, "main")).toContain("↑2 ↓1");
    expect(rowWith(block, "main")).toContain("PR #42 · CI pass · 3 threads");
    expect(after[0]).toContain(FILES_HEADING);
  });

  test("B2 a GitLab merge request shows as MR with its failing CI on the branch row", async ($, on) => {
    worldOf(on);
    seedRemote({
      "/work": {
        branch: "feature/x",
        ahead: 0,
        behind: 0,
        review: { kind: "MR", number: 7, ci: "fail", threads: 0 },
      },
    });
    const pane = await paneWith($);

    const { block } = remoteBlockAt(await drawnLines(pane));

    expect(rowWith(block, "feature/x")).toContain("MR !7 · CI fail");
  });

  test("B3 a branch with an upstream and no open PR or MR shows no PR/MR on its row", async ($, on) => {
    worldOf(on);
    seedRemote({
      "/work": { branch: "feature/x", ahead: 0, behind: 0, review: null },
    });
    const pane = await paneWith($);

    const { block } = remoteBlockAt(await drawnLines(pane));

    expect(rowWith(block, "feature/x")).toContain("no PR/MR");
  });

  test("B4 with no Remote data the Files tab opens with its heading and no Remote block", async ($, on) => {
    worldOf(on);
    seedRemote({});
    const pane = await paneWith($);

    const body = await bodyBelowTabBar(pane);

    expect(await landmarksOf(pane)).toEqual(["Files"]);
    expect(body[0]).toContain(FILES_HEADING);
    expect(body[1]).toBe(NO_FILES_TEXT);
  });

  test("B5 at 60 columns a long branch is cut with an ellipsis and every Remote row stays within the pane", async ($, on) => {
    worldOf(on);
    seedRemote({
      "/work": { ...githubBranch(), branch: LONG_BRANCH },
      "/work/lib": { branch: "dev", ahead: 0, behind: 0, review: null },
    });
    const pane = await paneWith($, NARROW);

    const { block } = remoteBlockAt(await drawnLines(pane));
    const longRow = rowWith(block, "PR #42");
    const devRow = rowWith(block, "no PR/MR");

    expect(longRow).toContain("…");
    expect(longRow).toMatch(/PR #42 · CI pass · 3 threads$/);
    expect([...longRow].length).toBeLessThanOrEqual(NARROW);
    expect(devRow).toContain("dev");
    expect([...devRow].length).toBeLessThanOrEqual(NARROW);
  });

  test("B6 a branch with no upstream is left out of the Remote block next to a branch with one", async ($, on) => {
    worldOf(on);
    seedRemote({
      "/work": githubBranch(),
      "/work/lib": { branch: "scratch", ahead: null, behind: null, review: null },
    });
    const pane = await paneWith($);

    const lines = await drawnLines(pane);
    const { block } = remoteBlockAt(lines);

    expect(rowWith(block, "main")).toContain("↑2 ↓1");
    expect(lines.join("\n")).not.toContain("scratch");
    expect(lines.join("\n")).not.toContain("no upstream");
  });

  test("B7 a PR with no threads and no CI check shows the PR number and nothing about threads or CI", async ($, on) => {
    worldOf(on);
    seedRemote({
      "/work": {
        branch: "main",
        ahead: 2,
        behind: 1,
        review: { kind: "PR", number: 42, ci: "none", threads: 0 },
      },
    });
    const pane = await paneWith($);

    const { block } = remoteBlockAt(await drawnLines(pane));

    expect(rowWith(block, "PR #42")).toContain("PR #42");
    expect(rowWith(block, "PR #42")).not.toContain("CI");
    expect(rowWith(block, "PR #42")).not.toContain("thread");
  });

  test("B8 a PR whose checks are still running shows CI pending on its row", async ($, on) => {
    worldOf(on);
    seedRemote({
      "/work": {
        branch: "main",
        ahead: 0,
        behind: 0,
        review: { kind: "PR", number: 42, ci: "pending", threads: 0 },
      },
    });
    const pane = await paneWith($);

    const { block } = remoteBlockAt(await drawnLines(pane));

    expect(rowWith(block, "PR #42")).toContain("PR #42 · CI pending");
  });

  test("B9 a PR with one open thread shows 1 thread in the singular", async ($, on) => {
    worldOf(on);
    seedRemote({
      "/work": {
        branch: "main",
        ahead: 0,
        behind: 0,
        review: { kind: "PR", number: 42, ci: "pass", threads: 1 },
      },
    });
    const pane = await paneWith($);

    const { block } = remoteBlockAt(await drawnLines(pane));

    expect(rowWith(block, "PR #42")).toContain("CI pass · 1 thread");
    expect(rowWith(block, "PR #42")).not.toContain("1 threads");
  });

  test("B10 a person whose only branch has no upstream sees no Remote heading and the Files heading where it sits with no Remote data", async ($, on) => {
    worldOf(on);
    seedRemote({
      "/work": { branch: "scratch", ahead: null, behind: null, review: null },
    });
    const pane = await paneWith($);

    const body = await bodyBelowTabBar(pane);

    expect(await landmarksOf(pane)).toEqual(["Files"]);
    expect((await drawnLines(pane)).join("\n")).not.toContain("scratch");
    expect(body[0]).toContain(FILES_HEADING);
    expect(body[1]).toBe(NO_FILES_TEXT);
  });

  test("B11 with two tracked repos each Remote row starts with its repo name as the Files groups show it", async ($, on) => {
    worldOf(on);
    seedRemote({ [WORK_ROOT]: githubBranch(), [OTHER_ROOT]: githubBranch() });
    const pane = await paneWith($);

    const { block } = remoteBlockAt(await drawnLines(pane));
    const rows = block.slice(1);

    expect(rows.map(nameOf)).toEqual([WORK_NAME, OTHER_NAME]);
  });

  test("B14 with two tracked repos that share a last folder name each Remote row starts with its name and its parent folder", async ($, on) => {
    worldOf(on);
    seedRemote({ [SAME_NAME_A_ROOT]: githubBranch(), [SAME_NAME_B_ROOT]: githubBranch() });
    const pane = await paneWith($);

    const { block } = remoteBlockAt(await drawnLines(pane));
    const rows = block.slice(1);

    expect(rows.map(nameOf)).toEqual([SAME_NAME_A, SAME_NAME_B]);
  });

  test("B12 at 60 columns two tracked repos keep their distinguishing name tails and no row passes the pane width", async ($, on) => {
    worldOf(on);
    seedRemote({ [WORK_ROOT]: githubBranch(), [OTHER_ROOT]: githubBranch() });
    const pane = await paneWith($, NARROW);

    const { block } = remoteBlockAt(await drawnLines(pane));
    const rows = block.slice(1);

    expect(rowWith(rows, OTHER_TAIL)).toContain("PR #42");
    expect(rowWith(rows, WORK_TAIL)).toContain("PR #42");
    expect(rowWith(rows, OTHER_TAIL)).not.toBe(rowWith(rows, WORK_TAIL));
    expect(rows.every((row) => [...row].length <= NARROW)).toBe(true);
  });

  test("B13 at 60 columns two tracked repos on the same long branch still show their distinguishing name tails", async ($, on) => {
    worldOf(on);
    seedRemote({
      [WORK_ROOT]: { ...githubBranch(), branch: SHARED_LONG_BRANCH },
      [OTHER_ROOT]: { ...githubBranch(), branch: SHARED_LONG_BRANCH },
    });
    const pane = await paneWith($, NARROW);

    const { block } = remoteBlockAt(await drawnLines(pane));
    const rows = block.slice(1);

    expect(rowWith(rows, OTHER_TAIL)).toContain("PR #42");
    expect(rowWith(rows, WORK_TAIL)).toContain("PR #42");
    expect(rowWith(rows, OTHER_TAIL)).not.toBe(rowWith(rows, WORK_TAIL));
    expect(rows.every((row) => [...row].length <= NARROW)).toBe(true);
  });
});

function githubBranch(): RemoteRepo {
  return {
    branch: "main",
    ahead: 2,
    behind: 1,
    review: { kind: "PR", number: 42, ci: "pass", threads: 3 },
  };
}

function seedRemote(repos: Record<string, RemoteRepo>): void {
  store.set("remote", { value: repos, version: 1 });
}

function worldOf(on: On): void {
  store.clear();
  mock.clock(on, { now: 1_000 });
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
}

async function paneWith($: Engine, columns: number = COLUMNS): Promise<Pane> {
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
  const buttons = await pane.findAll({ type: "Button" });
  await pane.press({ key: buttons.find((button) => button.props.label === "Files")?.key ?? "" });
  return pane;
}

function remoteBlockAt(lines: string[]): { block: string[]; after: string[] } {
  const start = lines.findIndex((line) => line.includes(REMOTE_HEADING));
  if (start === -1) return { block: [], after: lines };
  const rest = lines.slice(start);
  const blank = rest.findIndex((line) => line === "");
  const stop = blank === -1 ? rest.length : blank;
  return { block: rest.slice(0, stop), after: rest.slice(stop + 1) };
}

function rowWith(lines: string[], needle: string): string {
  return lines.find((line) => line.includes(needle)) ?? "";
}

function nameOf(row: string): string {
  return row.trimStart().split(" ")[0] ?? "";
}

async function drawnLines(pane: Pane): Promise<string[]> {
  return linesOf((await pane.drawn()) as Node).map((line) => line.trimEnd());
}

async function bodyBelowTabBar(pane: Pane): Promise<string[]> {
  return (await drawnLines(pane)).slice(TAB_BAR_ROWS);
}

async function landmarksOf(pane: Pane): Promise<string[]> {
  return landmarksIn(await pane.drawn());
}

function landmarksIn(node: Node): string[] {
  if (node.type === "Input") return ["filter"];
  if (node.type === "Text") return landmarkOfText(textOf(node));
  return childrenOf(node).flatMap(landmarksIn);
}

function landmarkOfText(text: string): string[] {
  if (text.includes(REMOTE_HEADING)) return ["Remote"];
  if (text.includes(FILES_HEADING)) return ["Files"];
  return [];
}

function linesOf(node: Node): string[] {
  if (node.type === "Text") return [textOf(node)];
  if (node.props?.flexDirection === "row") return [textOf(node)];
  const children = childrenOf(node);
  if (node.type === "Box" && children.length === 0) return [""];
  return children.flatMap(linesOf);
}
