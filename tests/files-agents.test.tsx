import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import type { Activity, AgentEdit } from "../types";

type Pane = Mounted<"terminal", "Pane">;
type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] };
type Row = { text: string; outerTexts: Node[] };

const COLUMNS = 100;
const missing = new Set<string>();
const store = new Map<string, { value: unknown; version: number }>();

const AGENTS = {
  a1: {
    id: "a1",
    type: "general-purpose",
    description: "build parser",
    background: false,
    model: "m",
    status: "done",
    startedAt: 0,
    ctxTokens: 0,
    tokensIn: 0,
    tokensOut: 0,
    running: [],
  },
  a2: {
    id: "a2",
    parentId: "a1",
    type: "Explore",
    description: "fix tests",
    background: false,
    model: "m",
    status: "done",
    startedAt: 0,
    ctxTokens: 0,
    tokensIn: 0,
    tokensOut: 0,
    running: [],
  },
};

describe("files merged through git", () => {
  test("a merge Bash call followed by a numstat result shows the merged file with its lines and the branch label", async ($, on) => {
    worldOf(on);
    gitOf(on, { diff: "7\t2\tsrc/m.ts", reflog: "merge feature/x: Fast-forward" });
    await ($.tool.call as (e: object) => Promise<unknown>)({
      tool: "Bash",
      command: "git merge --ff-only feature/x",
    });

    const rows = await rowsOf(await paneWith($, [], []));

    expect(rows.find((row) => row.includes("m.ts"))).toMatch(/m\.ts *\+7 -2$/);
    expect(rows).toContain("▾ /work/ · main");
    expect(rows.find((row) => row.includes("merge"))).toMatch(/^merge feature\/x *1 file \+7 -2$/);
    expect(rows[0]).toMatch(/^1 file changed *\+7 -2$/);
  });

  test("git numbers replace the edit counts of a file and keep its agent as author", async ($, on) => {
    worldOf(on);
    gitOf(on, { diff: "4\t1\tsrc/m.ts", reflog: "" });
    await ($.tool.call as (e: object) => Promise<unknown>)({
      tool: "Bash",
      command: "git commit -am x",
    });

    const rows = await rowsOf(await paneWith($, [], [agentEdit("a1", "/work/src/m.ts", 30, 30)]));

    expect(rows.find((row) => row.includes("m.ts"))).toMatch(/m\.ts *\+4 -1$/);
  });
});

describe("files grouped by checkout", () => {
  test("two roots show their branch in the header and no per-file tags", async ($, on) => {
    worldOf(on);
    on("tool.call", () => ({ result: "ok", text: "ok", ref: 1 }));
    on("process.run", (_$, e) => {
      const dir = e.argv[2] ?? "";
      const root = dir.startsWith("/work/wt") ? "/work/wt" : "/work";
      const stdout = e.argv.includes("--abbrev-ref")
        ? root === "/work"
          ? "main"
          : "feature/x"
        : e.argv.includes("--show-toplevel")
          ? e.argv.includes("HEAD")
            ? `${root}\nabc`
            : root
          : e.argv.includes("--numstat")
            ? "2\t1\tsrc/a.ts"
            : "";
      return { value: { exitCode: 0, stdout, stderr: "" } } as never;
    });
    store.set("agentEdits", { value: [agentEdit("a1", "/work/wt/src/b.ts", 4, 0)], version: 1 });
    await ($.tool.call as (e: object) => Promise<unknown>)({
      tool: "Bash",
      command: "git commit -am x",
    });

    const rows = await rowsOf(
      await paneWith(
        $,
        [edit("/work/src/a.ts", 2, 1), read("/tmp/n.txt")],
        [agentEdit("a1", "/work/wt/src/b.ts", 4, 0)],
      ),
    );

    expect(rows).toContain("▾ /work/ · main");
    expect(rows).toContain("▾ /work/wt/ · feature/x");
    expect(
      rows.filter((row) => /main,|build parser|git|merge/.test(row) && row.includes(".ts")),
    ).toEqual([]);
    expect(rows).toContain("▾ /tmp/");
  });
});

describe("files own to this session", () => {
  test("a file changed on disk with no call from the session is not listed", async ($, on) => {
    worldOf(on);
    gitOf(on, { diff: "85000\t49000\tideas/bank.md", reflog: "" });
    await ($.tool.call as (e: object) => Promise<unknown>)({ tool: "Bash", command: "ls" });

    const rows = await rowsOf(await paneWith($, [edit("/work/mine.ts", 2, 1)], []));

    expect(rows.join("\n")).not.toContain("bank.md");
    expect(rows[0]).toMatch(/^1 file changed *\+2 -1$/);
  });

  test("a git command that leaves HEAD where it was lists nothing", async ($, on) => {
    worldOf(on);
    gitOf(on, { diff: "3\t0\tsrc/other.ts", reflog: "", heads: ["same111"] });
    await ($.tool.call as (e: object) => Promise<unknown>)({
      tool: "Bash",
      command: "git checkout feature/x",
    });

    const rows = await rowsOf(await paneWith($, [], []));

    expect(rows.join("\n")).not.toContain("other.ts");
  });

  test("the diff runs between HEAD before and after the call and no working tree diff is asked", async ($, on) => {
    worldOf(on);
    const argvs: string[][] = [];
    gitOf(on, { diff: "3\t0\tsrc/early.ts", reflog: "", heads: ["before1", "after22"] }, argvs);
    await ($.tool.call as (e: object) => Promise<unknown>)({
      tool: "Bash",
      command: "git merge feature/x",
    });

    const diff = argvs.find((argv) => argv.includes("--numstat"));
    expect(diff?.slice(-2)).toEqual(["before1", "after22"]);
    expect(argvs.some((argv) => argv.some((arg) => arg.startsWith("HEAD@{")))).toBe(false);
  });

  test("a git -C merge in another checkout lists its files under that checkout", async ($, on) => {
    worldOf(on);
    const heads = { "/other": ["o1", "o2"], "/work": ["w1"] } as Record<string, string[]>;
    on("tool.call", () => ({ result: "ok", text: "ok", ref: 1 }));
    on("process.run", (_$, e) => {
      const dir = e.argv[2] ?? "";
      const queue = heads[dir] ?? [];
      const stdout = e.argv.includes("--show-toplevel")
        ? `${dir}\n${queue.length > 1 ? queue.shift() : queue[0]}`
        : e.argv.includes("--numstat")
          ? "5\t2\tsrc/x.ts"
          : e.argv.includes("--abbrev-ref")
            ? "main"
            : "";
      return { value: { exitCode: 0, stdout, stderr: "" } } as never;
    });
    await ($.tool.call as (e: object) => Promise<unknown>)({
      tool: "Bash",
      command: "git -C /other merge feature/x",
    });

    const rows = await rowsOf(await paneWith($, [], []));

    expect(rows).toContain("▾ /other/ · main");
    expect(rows.find((row) => row.includes("x.ts"))).toMatch(/x\.ts *\+5 -2$/);
  });

  test("two landings of one file add their lines up", async ($, on) => {
    worldOf(on);
    gitOf(on, { diff: "3\t1\tsrc/m.ts", reflog: "", heads: ["a1", "b2", "b2", "c3"] });
    for (const command of ["git commit -am x", "git commit -am y"])
      await ($.tool.call as (e: object) => Promise<unknown>)({ tool: "Bash", command });

    const rows = await rowsOf(await paneWith($, [], []));

    expect(rows.find((row) => row.includes("m.ts"))).toMatch(/m\.ts *\+6 -2$/);
  });
});

describe("files from subagents", () => {
  test("a subagent edit in a sibling worktree shows under its path with the agent label", async ($, on) => {
    worldOf(on);
    const pane = await paneWith($, [], [agentEdit("a1", "/h/u/P/repo-feature-x/src/p.ts", 5, 1)]);

    const rows = await rowsOf(pane);

    expect(rows.find((row) => row.includes("p.ts"))).toMatch(/p\.ts *\+5 -1$/);
    expect(rows).toContain("▾ /h/u/P/repo-feature-x/src/".replace("/h/u", "~"));
  });

  test("main and subagent edits to one file sum and list both authors", async ($, on) => {
    worldOf(on);
    const pane = await paneWith(
      $,
      [edit("/work/a.ts", 3, 1)],
      [agentEdit("a1", "/work/a.ts", 2, 2)],
    );

    const rows = await rowsOf(pane);

    expect(rows.find((row) => row.includes("a.ts"))).toMatch(/a\.ts *\+5 -3$/);
    expect(rows[0]).toMatch(/^1 file changed *\+5 -3$/);
  });

  test("the summary lists agents by lines changed, biggest first", async ($, on) => {
    worldOf(on);
    const pane = await paneWith(
      $,
      [edit("/work/m.ts", 1, 0)],
      [agentEdit("a2", "/work/x.ts", 9, 3), agentEdit("a1", "/work/y.ts", 4, 0)],
    );

    const rows = await rowsOf(pane);

    expect(rows.slice(0, 4)).toEqual([
      expect.stringMatching(/^3 files changed *\+14 -3$/),
      expect.stringMatching(/^fix tests *1 file \+9 -3$/),
      expect.stringMatching(/^build parser *1 file \+4 -0$/),
      expect.stringMatching(/^this session *1 file \+1 -0$/),
    ]);
  });

  test("a file that no longer exists is not drawn and its emptied folder goes with it", async ($, on) => {
    worldOf(on);
    missing.add("/h/u/P/repo-gone/src/old.ts");
    const pane = await paneWith(
      $,
      [edit("/work/keep.ts", 1, 0)],
      [agentEdit("a1", "/h/u/P/repo-gone/src/old.ts", 7, 0)],
    );

    const rows = (await rowsOf(pane)).join("\n");

    expect(rows).toContain("keep.ts");
    expect(rows).not.toContain("old.ts");
    expect(rows).not.toContain("repo-gone");
    expect(rows).not.toContain("▾ src/");
  });
});

function gitOf(
  on: On,
  answers: { diff: string; reflog: string; heads?: string[]; branch?: string },
  argvs: string[][] = [],
): void {
  const heads = [...(answers.heads ?? ["abc123", "def456"])];
  const nextHead = () => (heads.length > 1 ? heads.shift() : heads[0]);
  on("tool.call", () => ({ result: "ok", text: "ok", ref: 1 }));
  on("process.run", (_$, e) => {
    argvs.push([...e.argv]);
    const stdout = e.argv.includes("--abbrev-ref")
      ? (answers.branch ?? "main")
      : e.argv.includes("--show-toplevel")
        ? e.argv.includes("HEAD")
          ? `/work\n${nextHead()}`
          : "/work"
        : e.argv.includes("--numstat")
          ? answers.diff
          : answers.reflog;
    return { value: { exitCode: 0, stdout, stderr: "" } } as never;
  });
}

function agentEdit(agentId: string, target: string, added: number, removed: number): AgentEdit {
  return { ...edit(target, added, removed), agentId };
}

function read(target: string): Activity {
  return { id: target, tool: "Read", target, ms: 1, isErrored: false, added: 0, removed: 0 };
}

function edit(target: string, added: number, removed: number): Activity {
  return { id: target, tool: "Edit", target, ms: 1, isErrored: false, added, removed };
}

function worldOf(on: On): void {
  store.clear();
  missing.clear();
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
  on("session.cwd", () => ({ value: "/work" }));
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", (_$, e) => (missing.has(e.path) ? { value: false } : { value: true }));
}

async function paneWith(
  $: Engine,
  activity: Activity[],
  agentEdits: AgentEdit[] = [],
  columns: number = COLUMNS,
): Promise<Pane> {
  store.set("activity", { value: activity, version: 1 });
  store.set("agentEdits", { value: agentEdits, version: 1 });
  store.set("agents", { value: AGENTS, version: 1 });
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

async function rowsOf(pane: Pane): Promise<string[]> {
  const rows = await bodyRows(pane);
  return rows
    .map((row) => row.text.trimEnd())
    .filter(
      (text) =>
        text.trim() !== "Files" &&
        !text.includes("Activity  Files") &&
        !text.startsWith("Files ─") &&
        !text.startsWith("SESSION"),
    );
}

async function bodyRows(pane: Pane): Promise<Row[]> {
  const rows = rowsIn(await pane.drawn());
  return rows.filter((row) => row.text !== "" && !holdsButton(row));
}

function rowsIn(node: Node): Row[] {
  if (node.type === "Text") return [{ text: textOf(node), outerTexts: [node] }];
  if (isRow(node) && !holdsColumn(node))
    return [{ text: textOf(node), outerTexts: outerTexts(node) }];
  return elementsIn(node).flatMap(rowsIn);
}

function holdsButton(row: Row): boolean {
  return row.text.includes("[ ");
}

function isRow(node: Node): boolean {
  return (
    node.type === "Box" && !["column", "column-reverse"].includes(String(node.props?.flexDirection))
  );
}

function holdsColumn(node: Node): boolean {
  return elementsIn(node).some(
    (child) => (child.type === "Box" && !isRow(child)) || holdsColumn(child),
  );
}

function outerTexts(node: Node): Node[] {
  return node.type === "Text" ? [node] : elementsIn(node).flatMap(outerTexts);
}

function elementsIn(node: Node): Node[] {
  return (node.children ?? []).filter(
    (child): child is Node => typeof child === "object" && child !== null,
  );
}

function foldLabel(node: Node): string {
  const label = node.props?.label;
  return typeof label === "string" ? label : "";
}

function textOf(node: Node): string {
  if (node.type === "Button") return foldLabel(node);
  return (node.children ?? [])
    .map((child) => (typeof child === "string" ? child : textOf(child as Node)))
    .join("");
}
