import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, MockClock, Mounted } from "claude-code/testing";

import type { Activity, AgentEdit } from "../types";
import { paneInk } from "../hooks/pane-ink";
import { isHidden, textOf as leafTextOf } from "./draw-tree";
import { linesOf } from "./skills-tree";
import type { Line } from "./skills-tree";

type Pane = Mounted<"terminal", "Pane">;
type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] };
type Row = { text: string; outerTexts: Node[] };
type Parts = Line["parts"];
type BashFile = {
  filePath: string;
  hunks: {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
  }[];
  created?: true;
  deleted?: true;
};

const COLUMNS = 100;
const WIDE_COLUMNS = 120;
const BATCH_MS = 1000;
const MERGE_LINES = ["+a", "+b", "+c", "+d", "+e", "+f", "+g", "-x", "-y"];
const missing = new Set<string>();
const asked = new Set<string>();
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
    running: [],
  },
};

describe("files merged through git", () => {
  test("a merge Bash call followed by a numstat result shows the merged file with its lines and no scope row", async ($, on) => {
    worldOf(on);
    gitOf(on, { diff: "7\t2\tsrc/m.ts", reflog: "merge feature/x: Fast-forward" });
    await ($.tool.call as (e: object) => Promise<unknown>)({
      tool: "Bash",
      command: "git merge --ff-only feature/x",
    });

    const rows = await rowsOf(await paneWith($, [], []));

    expect(rows.find((row) => row.includes("m.ts"))).toMatch(/m\.ts *\+7 -2$/);
    expect(rows).toContain("▾ work/ · main");
    expect(rows).not.toContainEqual(expect.stringMatching(/^merge feature\/x/));
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

  test("G1 a git merge whose result also carries a Bash diff shows the merged file with its lines and no scope row", async ($, on) => {
    worldOf(on);
    gitOf(on, {
      diff: "7\t2\tsrc/m.ts",
      reflog: "merge feature/x: Fast-forward",
      bashFiles: [
        changed("/work/src/m.ts", ["+a", "+b", "+c", "+d", "+e", "+f", "+g", "-x", "-y"]),
      ],
    });
    const pane = await paneWith($, [], []);
    await ($.tool.call as (e: object) => Promise<unknown>)({
      tool: "Bash",
      command: "git merge --ff-only feature/x",
    });
    await pane.redraw();

    const rows = await rowsOf(pane);

    expect(rows).not.toContainEqual(expect.stringMatching(/^merge feature\/x/));
    expect(rows[0]).toMatch(/^1 file changed *\+7 -2$/);
  });

  test("G2 a merge with a Bash diff shows the merged file with its lines and no scope row after the Files tab recounts", async ($, on) => {
    worldOf(on);
    gitOf(on, {
      diff: "7\t2\tsrc/m.ts",
      reflog: "merge feature/x: Fast-forward",
      bashFiles: [changed("/work/src/m.ts", MERGE_LINES)],
    });
    const pane = await paneWith($, [], []);
    await ($.tool.call as (e: object) => Promise<unknown>)({
      tool: "Bash",
      command: "git merge --ff-only feature/x",
    });
    await $.classic.FileChanged({ file_path: "/work/src/m.ts", event: "change" });
    await pane.redraw();

    const rows = await rowsOf(pane);

    expect(rows).not.toContainEqual(expect.stringMatching(/^merge feature\/x/));
    expect(rows[0]).toMatch(/^1 file changed *\+7 -2$/);
    expect(rows).not.toContainEqual(expect.stringMatching(/^this session/));
  });

  test("G3 two merges of one file, each with a Bash diff, show git's lines against the one base and no scope row", async ($, on) => {
    worldOf(on);
    gitOf(on, {
      diff: "7\t2\tsrc/m.ts",
      reflog: "merge feature/x: Fast-forward",
      heads: ["a1", "b2", "b2", "c3"],
      bashFiles: [changed("/work/src/m.ts", MERGE_LINES)],
    });
    const pane = await paneWith($, [], []);
    for (const command of ["git merge --ff-only feature/x", "git merge --ff-only feature/x"])
      await ($.tool.call as (e: object) => Promise<unknown>)({ tool: "Bash", command });
    await pane.redraw();

    const rows = await rowsOf(pane);

    expect(rows.find((row) => row.includes("m.ts"))).toMatch(/m\.ts *\+7 -2$/);
    expect(rows).not.toContainEqual(expect.stringMatching(/^merge feature\/x/));
    expect(rows[0]).toMatch(/^1 file changed *\+7 -2$/);
    expect(rows).not.toContainEqual(expect.stringMatching(/^this session/));
  });
});

describe("files grouped by checkout", () => {
  test("two roots show their branch in the header and no per-file tags", async ($, on) => {
    worldOf(on);
    on("tool.call", () => ({ result: "ok", text: "ok", ref: 1 }));
    on("process.run", (_$, e) => {
      const dir = e.argv[2] ?? "";
      const root = dir.startsWith("/work/wt") ? "/work/wt" : "/work";
      const stdout =
        e.argv.includes("--abbrev-ref") && e.argv.includes("--show-toplevel")
          ? `${root}\nabc\n${root === "/work" ? "main" : "feature/x"}`
          : e.argv.includes("--abbrev-ref")
            ? root === "/work"
              ? "main"
              : "feature/x"
            : e.argv.includes("--show-toplevel")
              ? e.argv.includes("HEAD")
                ? `${root}\nabc`
                : root
              : (diffAnswer(e.argv, "2\t1\tsrc/a.ts") ?? "");
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

    expect(rows).toContain("▾ work/ · main");
    expect(rows).toContain("▾ wt/ · feature/x");
    expect(
      rows.filter((row) => /main,|build parser|git|merge/.test(row) && row.includes(".ts")),
    ).toEqual([]);
    expect(rows).toContain("▾ /tmp/");
  });

  test("two repos with the same last folder name show their parent folder in their group rows", async ($, on) => {
    worldOf(on);
    store.set("gitBranches", { value: { "/a/app": "main", "/b/app": "main" }, version: 1 });
    on("process.run", (_$, e) => {
      const root = (e.argv[2] ?? "").startsWith("/b/app") ? "/b/app" : "/a/app";
      const stdout = e.argv.includes("--abbrev-ref")
        ? "main"
        : e.argv.includes("--show-toplevel")
          ? root
          : "";
      return { value: { exitCode: 0, stdout, stderr: "" } } as never;
    });

    const rows = await rowsOf(
      await paneWith($, [edit("/a/app/x.ts", 1, 0), edit("/b/app/y.ts", 2, 0)], []),
    );

    expect(rows).toContain("▾ a/app/ · main");
    expect(rows).toContain("▾ b/app/ · main");
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

  test("the landed files are named between HEAD before and after the call and counted against the session base", async ($, on) => {
    worldOf(on);
    const argvs: string[][] = [];
    gitOf(on, { diff: "3\t0\tsrc/early.ts", reflog: "", heads: ["before1", "after22"] }, argvs);
    await ($.tool.call as (e: object) => Promise<unknown>)({
      tool: "Bash",
      command: "git merge feature/x",
    });

    const named = argvs.find((argv) => argv.includes("--name-only"));
    const counted = argvs.find((argv) => argv.includes("--numstat"));
    expect(named?.slice(-2)).toEqual(["before1", "after22"]);
    expect(counted).toContain("before1");
    expect(counted).not.toContain("after22");
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
        ? `${dir}\n${queue.length > 1 ? queue.shift() : queue[0]}${e.argv.includes("--abbrev-ref") ? "\nmain" : ""}`
        : (diffAnswer(e.argv, "5\t2\tsrc/x.ts") ?? (e.argv.includes("--abbrev-ref") ? "main" : ""));
      return { value: { exitCode: 0, stdout, stderr: "" } } as never;
    });
    await ($.tool.call as (e: object) => Promise<unknown>)({
      tool: "Bash",
      command: "git -C /other merge feature/x",
    });

    const rows = await rowsOf(await paneWith($, [], []));

    expect(rows).toContain("▾ other/ · main");
    expect(rows.find((row) => row.includes("x.ts"))).toMatch(/x\.ts *\+5 -2$/);
  });

  test("two landings of one file show git's lines against the one base, not added up", async ($, on) => {
    worldOf(on);
    gitOf(on, {
      diff: "3\t1\tsrc/m.ts",
      reflog: "",
      heads: ["a1", "b2", "b2", "c3"],
    });
    for (const command of ["git commit -am x", "git commit -am y"])
      await ($.tool.call as (e: object) => Promise<unknown>)({ tool: "Bash", command });

    const rows = await rowsOf(await paneWith($, [], []));

    expect(rows.find((row) => row.includes("m.ts"))).toMatch(/m\.ts *\+3 -1$/);
  });
});

describe("files from subagents", () => {
  test("S1 a repo root row on main shows only its last folder name in the text colour, then the branch", async ($, on) => {
    const clock = worldOf(on);
    on("process.run", (_$, e) => {
      const stdout = e.argv.includes("--abbrev-ref") ? "main" : "/work/IT/demo-app";
      return { value: { exitCode: 0, stdout, stderr: "" } } as never;
    });
    const pane = await paneWith($, [], [agentEdit("a1", "/work/IT/demo-app/hooks/a.ts", 5, 1)]);
    await clock.advance(0);
    await pane.redraw();

    const rows = await rowsOf(pane);
    const root = (await bodyRows(pane)).find((row) => row.text.includes("demo-app"));

    expect(rows).toContain("▾ demo-app/ · main");
    expect(rows.some((row) => row.includes("IT/"))).toBe(false);
    expect(
      root?.outerTexts.flatMap(textNodesIn).find((node) => textOf(node) === "demo-app/")?.props
        ?.color,
    ).toBe(paneInk().text);
  });

  test("a subagent edit in a sibling worktree shows under its path with the agent label", async ($, on) => {
    const clock = worldOf(on);
    on("process.run", (_$, e) => {
      const stdout =
        e.argv.includes("--abbrev-ref") && e.argv.includes("--show-toplevel")
          ? "/h/u/P/repo-feature-x\nabc\nfeature-x"
          : e.argv.includes("--abbrev-ref")
            ? "feature-x"
            : "/h/u/P/repo-feature-x";
      return { value: { exitCode: 0, stdout, stderr: "" } } as never;
    });
    const pane = await paneWith($, [], [agentEdit("a1", "/h/u/P/repo-feature-x/src/p.ts", 5, 1)]);
    await clock.advance(0);
    await pane.redraw();

    const rows = await rowsOf(pane);

    expect(rows.find((row) => row.includes("p.ts"))).toMatch(/p\.ts *\+5 -1$/);
    expect(rows).toContain("▾ repo-feature-x/ · feature-x");
  });

  test("a subagent edit in a new worktree under .claude/worktrees gets its branch group while the tab is open", async ($, on) => {
    const clock = worldOf(on);
    const tree = "/work/.claude/worktrees/feat-a";
    on("tool.call", () => ({ result: "ok", text: "ok", ref: 1 }));
    on("process.run", (_$, e) => {
      const stdout =
        e.argv.includes("--abbrev-ref") && e.argv.includes("--show-toplevel")
          ? `${tree}\nabc\nfeat-a`
          : e.argv.includes("--abbrev-ref")
            ? "feat-a"
            : tree;
      return { value: { exitCode: 0, stdout, stderr: "" } } as never;
    });
    const pane = await paneWith($, [], []);

    await ($.tool.call as (e: object) => Promise<unknown>)({
      tool: "Write",
      file_path: `${tree}/src/p.ts`,
      agentId: "a1",
    });
    await clock.advance(BATCH_MS);
    await pane.redraw();

    const rows = await rowsOf(pane);

    expect(rows.some((row) => row.includes("p.ts"))).toBe(true);
    expect(rows).toContain("▾ feat-a/ · feat-a");
  });

  test("a main repo inside a plain folder and its worktree edited by the session get one group each at 120 columns", async ($, on) => {
    const clock = worldOf(on);
    const parent =
      "/private/tmp/claude-502/-home-dev-projects-IT-demo-app/5d9d9540-b407-4738-92e9-b0624fa29cab/scratchpad";
    const repo = `${parent}/repo2`;
    const tree = `${repo}/.claude/worktrees/feat-a`;
    on("tool.call", () => ({ result: "ok", text: "ok", ref: 1 }));
    on("process.run", (_$, e) => {
      const dir = e.argv[2] ?? "";
      const root = dir.startsWith(tree) ? tree : dir.startsWith(repo) ? repo : null;
      if (root === null) return { value: { exitCode: 128, stdout: "", stderr: "" } } as never;
      const branch = root === tree ? "feat-a" : "main";
      const stdout =
        e.argv.includes("--abbrev-ref") && e.argv.includes("--show-toplevel")
          ? `${root}\nabc\n${branch}`
          : e.argv.includes("--abbrev-ref")
            ? branch
            : root;
      return { value: { exitCode: 0, stdout, stderr: "" } } as never;
    });
    const pane = await paneWith($, [], [], WIDE_COLUMNS);

    for (const file of [`${repo}/a.txt`, `${tree}/b.txt`])
      await ($.tool.call as (e: object) => Promise<unknown>)({ tool: "Write", file_path: file });
    await clock.advance(BATCH_MS);
    await pane.redraw();

    const rows = await rowsOf(pane);

    const groups = rows.filter((row) => row.includes("·"));
    expect(groups.every((row) => row.length <= WIDE_COLUMNS)).toBe(true);
    expect(groups).toEqual(["▾ repo2/ · main", "▾ feat-a/ · feat-a"]);
    expect(rows.filter((row) => row.includes(".txt"))).toEqual([
      expect.stringMatching(/^└─a\.txt *\+\d+ -\d+$/),
      expect.stringMatching(/^└─b\.txt *\+\d+ -\d+$/),
    ]);
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

describe("files written by Bash", () => {
  test("B1 a file created by echo into it shows in the tree with its added lines and in the summary", async ($, on) => {
    worldOf(on);
    bashOf(on, [changed("/work/new.txt", ["+hi"], { created: true })]);
    const pane = await paneWith($, [], []);
    await ($.tool.call as (e: object) => Promise<unknown>)({
      tool: "Bash",
      command: "echo hi > new.txt",
    });
    await pane.redraw();

    const rows = await rowsOf(pane);

    expect(rows.find((row) => row.includes("new.txt"))).toMatch(/new\.txt *\+1 -0$/);
    expect(rows[0]).toMatch(/^1 file changed *\+1 -0$/);
    expect(rows).not.toContainEqual(expect.stringMatching(/^this session/));
  });

  test("B2 one sed -i over two files shows both files, each with its own counts", async ($, on) => {
    worldOf(on);
    bashOf(on, [changed("/work/a.txt", ["-x", "+y"]), changed("/work/b.txt", ["+a", "+b", "-c"])]);
    const pane = await paneWith($, [], []);
    await ($.tool.call as (e: object) => Promise<unknown>)({
      tool: "Bash",
      command: "sed -i '' 's/x/y/' a.txt b.txt",
    });
    await pane.redraw();

    const rows = await rowsOf(pane);

    expect(rows.find((row) => row.includes("a.txt"))).toMatch(/a\.txt *\+1 -1$/);
    expect(rows.find((row) => row.includes("b.txt"))).toMatch(/b\.txt *\+2 -1$/);
    expect(rows[0]).toMatch(/^2 files changed *\+3 -2$/);
  });

  test("B3 a file a subagent wrote with Bash shows in the tree and the summary without a scope row", async ($, on) => {
    const clock = worldOf(on);
    bashOf(on, [changed("/work/src/p.ts", ["+a", "+b", "-c"])]);
    const pane = await paneWith($, [], []);

    await ($.tool.call as (e: object) => Promise<unknown>)({
      tool: "Bash",
      command: "sed -i '' 's/c/b/' src/p.ts",
      agentId: "a1",
    });
    await clock.advance(BATCH_MS);
    await pane.redraw();

    const rows = await rowsOf(pane);

    expect(rows.find((row) => row.includes("p.ts"))).toMatch(/p\.ts *\+2 -1$/);
    expect(rows).not.toContainEqual(expect.stringMatching(/^build parser/));
  });

  test("B4 a file removed by rm is not drawn", async ($, on) => {
    worldOf(on);
    missing.add("/work/old.txt");
    bashOf(on, [
      changed("/work/old.txt", ["-a"], { deleted: true }),
      changed("/work/new.txt", ["+hi"], { created: true }),
    ]);
    const pane = await paneWith($, [], []);
    await ($.tool.call as (e: object) => Promise<unknown>)({
      tool: "Bash",
      command: "rm old.txt && echo hi > new.txt",
    });
    await pane.redraw();

    const rows = await rowsOf(pane);

    expect(rows.find((row) => row.includes("new.txt"))).toMatch(/new\.txt *\+1 -0$/);
    expect(rows.join("\n")).not.toContain("old.txt");
  });

  test("B5 a Bash command that changed no files adds nothing to the tree", async ($, on) => {
    worldOf(on);
    on("tool.call", () => ({
      result: { stdout: "a.txt", stderr: "", interrupted: false },
      text: "a.txt",
      ref: 1,
    }));
    const pane = await paneWith($, [], []);
    await ($.tool.call as (e: object) => Promise<unknown>)({ tool: "Bash", command: "ls" });
    await pane.redraw();

    const rows = await rowsOf(pane);

    expect(rows).toContain("no files touched yet · edits and reads show here");
    expect(rows.join("\n")).not.toMatch(/changed|this session/);
    expect([...asked].filter((path) => path.split("/").at(-1) === "ls")).toEqual([]);
  });

  test("B6 a Bash command whose text names git commit but runs no git shows the file it wrote", async ($, on) => {
    worldOf(on);
    bashOf(on, [changed("/work/docs/git-commit.md", ["+hi"], { created: true })]);
    const pane = await paneWith($, [], []);
    await ($.tool.call as (e: object) => Promise<unknown>)({
      tool: "Bash",
      command: "echo hi > docs/git-commit.md",
    });
    await pane.redraw();

    const rows = await rowsOf(pane);

    expect(rows.find((row) => row.includes("git-commit.md"))).toMatch(/git-commit\.md *\+1 -0$/);
    expect(rows).not.toContainEqual(expect.stringMatching(/^this session/));
  });

  test("B7 a git command that leaves HEAD where it was still shows the file the same call wrote", async ($, on) => {
    worldOf(on);
    gitOf(on, {
      diff: "",
      reflog: "",
      heads: ["abc123"],
      bashFiles: [changed("/work/new.txt", ["+hi"], { created: true })],
    });
    const pane = await paneWith($, [], []);
    await ($.tool.call as (e: object) => Promise<unknown>)({
      tool: "Bash",
      command: "git checkout -b feat && echo hi > new.txt",
    });
    await pane.redraw();

    const rows = await rowsOf(pane);

    expect(rows.find((row) => row.includes("new.txt"))).toMatch(/new\.txt *\+1 -0$/);
    expect(rows).not.toContainEqual(expect.stringMatching(/^this session/));
  });

  test("B8 one call that writes a file and commits it lists the file once with git's lines", async ($, on) => {
    worldOf(on);
    gitOf(on, {
      diff: "1\t0\tnew.txt",
      reflog: "commit: x",
      bashFiles: [changed("/work/new.txt", ["+hi"], { created: true })],
    });
    const pane = await paneWith($, [], []);
    await ($.tool.call as (e: object) => Promise<unknown>)({
      tool: "Bash",
      command: "echo hi > new.txt && git add -A && git commit -m x",
    });
    await pane.redraw();

    const rows = await rowsOf(pane);

    expect(rows.filter((row) => row.includes("new.txt"))).toHaveLength(1);
    expect(rows.find((row) => row.includes("new.txt"))).toMatch(/new\.txt *\+1 -0$/);
    expect(rows[0]).toMatch(/^1 file changed *\+1 -0$/);
  });
});

describe("files summary counts files written by Bash", () => {
  test("A1 a Bash command that writes two files without changing their lines lists both in the summary count", async ($, on) => {
    worldOf(on);
    const pane = await paneWith(
      $,
      [edit("/work/a.ts", 3, 1), bashWrites("bash-1", ["/work/b.ts", "/work/c.ts"])],
      [],
    );

    const rows = await rowsOf(pane);

    expect(rows[0]).toMatch(/^3 files changed *\+3 -1$/);
    expect(rows.find((row) => row.includes("b.ts"))).toMatch(/b\.ts *\+0 -0$/);
    expect(rows.find((row) => row.includes("c.ts"))).toMatch(/c\.ts *\+0 -0$/);
  });

  test("A2 a subagent's Bash command that writes two files without changing their lines counts them on its own line", async ($, on) => {
    worldOf(on);
    const pane = await paneWith(
      $,
      [edit("/work/a.ts", 3, 1)],
      [agentBashWrites("a1", ["/work/b.ts", "/work/c.ts"])],
    );

    const rows = await rowsOf(pane);

    expect(rows[0]).toMatch(/^3 files changed *\+3 -1$/);
    expect(rows).toContainEqual(expect.stringMatching(/^this session *1 file *\+3 -1$/));
    expect(rows).toContainEqual(expect.stringMatching(/^build parser *2 files *\+0 -0$/));
  });
});

describe("files summary read at a glance", () => {
  test("V6 the summary line 3 files changed is bold in the text colour", async ($, on) => {
    worldOf(on);
    const pane = await paneWith(
      $,
      [edit("/work/a.ts", 1, 0), edit("/work/b.ts", 2, 1), edit("/work/c.ts", 3, 2)],
      [],
    );

    const parts = await partsOfRow(pane, "3 files changed");

    const summary = parts.find((part) => leafTextOf(part).trim() === "3 files changed");
    expect(summary?.props?.weight).toBe("semibold");
    expect(summary?.props?.color).toBe(paneInk().text);
  });

  test("V7 with two scopes both scope rows are drawn with dim labels and counts, green plus, red minus and a dim zero side", async ($, on) => {
    worldOf(on);
    const pane = await paneWith(
      $,
      [edit("/work/m.ts", 1, 0)],
      [agentEdit("a1", "/work/x.ts", 4, 2)],
    );

    const session = await partsOfRow(pane, "this session");
    const agent = await partsOfRow(pane, "build parser");

    expect(colourOfPiece(session, "this session")).toBe(paneInk().muted);
    expect(colourOfPiece(session, "1 file")).toBe(paneInk().muted);
    expect(colourOfPiece(session, "+1")).toBe(paneInk().ok);
    expect(colourOfPiece(session, "-0")).toBe(paneInk().muted);
    expect(colourOfPiece(agent, "build parser")).toBe(paneInk().muted);
    expect(colourOfPiece(agent, "1 file")).toBe(paneInk().muted);
    expect(colourOfPiece(agent, "+4")).toBe(paneInk().ok);
    expect(colourOfPiece(agent, "-2")).toBe(paneInk().failed);
  });

  test("V21a with only this session's edits the summary draws no scope row", async ($, on) => {
    worldOf(on);
    const pane = await paneWith($, [edit("/work/a.ts", 3, 1), edit("/work/b.ts", 2, 0)], []);

    const rows = await rowsOf(pane);

    expect(rows[0]).toMatch(/^2 files changed *\+5 -1$/);
    expect(rows).not.toContainEqual(expect.stringMatching(/^this session/));
  });

  test("V21b with the edits of only one agent the summary draws no scope row", async ($, on) => {
    worldOf(on);
    const pane = await paneWith($, [], [agentEdit("a1", "/work/x.ts", 4, 2)]);

    const rows = await rowsOf(pane);

    expect(rows[0]).toMatch(/^1 file changed *\+4 -2$/);
    expect(rows).not.toContainEqual(expect.stringMatching(/^build parser/));
  });
});

function bashOf(on: On, files: BashFile[]): void {
  on("tool.call", () => ({
    result: { stdout: "", stderr: "", interrupted: false, bashEditDiff: { files, moreFiles: 0 } },
    text: "",
    ref: 1,
  }));
}

function changed(
  filePath: string,
  lines: string[],
  kind: Partial<Pick<BashFile, "created" | "deleted">> = {},
): BashFile {
  const oldLines = lines.filter((line) => !line.startsWith("+")).length;
  const newLines = lines.filter((line) => !line.startsWith("-")).length;
  return {
    filePath,
    hunks: [{ oldStart: 1, oldLines, newStart: 1, newLines, lines }],
    ...kind,
  };
}

function gitOf(
  on: On,
  answers: {
    diff: string;
    reflog: string;
    heads?: string[];
    branch?: string;
    bashFiles?: BashFile[];
  },
  argvs: string[][] = [],
): void {
  const heads = [...(answers.heads ?? ["abc123", "def456"])];
  const nextHead = () => (heads.length > 1 ? heads.shift() : heads[0]);
  on("tool.call", () => ({
    result: answers.bashFiles
      ? {
          stdout: "",
          stderr: "",
          interrupted: false,
          bashEditDiff: { files: answers.bashFiles, moreFiles: 0 },
        }
      : "ok",
    text: "ok",
    ref: 1,
  }));
  on("process.run", (_$, e) => {
    argvs.push([...e.argv]);
    const stdout =
      e.argv.includes("--abbrev-ref") && e.argv.includes("--show-toplevel")
        ? `/work\n${nextHead()}\n${answers.branch ?? "main"}`
        : e.argv.includes("--abbrev-ref")
          ? (answers.branch ?? "main")
          : e.argv.includes("--show-toplevel")
            ? e.argv.includes("HEAD")
              ? `/work\n${nextHead()}`
              : "/work"
            : (diffAnswer(e.argv, answers.diff) ?? answers.reflog);
    return { value: { exitCode: 0, stdout, stderr: "" } } as never;
  });
}

function diffAnswer(argv: readonly string[], numstat: string): string | undefined {
  const lines = numstat.split("\n").filter((line) => line !== "");
  const pathOf = (line: string) => line.split("\t")[2] ?? "";
  if (argv.includes("--others") || argv.includes("--name-status")) return "";
  if (argv.includes("--name-only")) return lines.map(pathOf).join("\n");
  if (!argv.includes("--numstat")) return undefined;
  const asked = argv.slice(argv.indexOf("--") + 1);
  return lines
    .filter((line) =>
      asked.some((path) => path === pathOf(line) || path.endsWith(`/${pathOf(line)}`)),
    )
    .map((line) => `${line}\0`)
    .join("");
}

function agentEdit(agentId: string, target: string, added: number, removed: number): AgentEdit {
  return { ...edit(target, added, removed), agentId };
}

function bashWrites(id: string, targets: string[]): Activity {
  return {
    id,
    tool: "Bash",
    target: "",
    ms: 1,
    isErrored: false,
    added: 0,
    removed: 0,
    files: targets.map((target) => ({ target, added: 0, removed: 0 })),
  };
}

function agentBashWrites(agentId: string, targets: string[]): AgentEdit {
  return { ...bashWrites(`${agentId}-bash`, targets), agentId };
}

function read(target: string): Activity {
  return { id: target, tool: "Read", target, ms: 1, isErrored: false, added: 0, removed: 0 };
}

function edit(target: string, added: number, removed: number): Activity {
  return { id: target, tool: "Edit", target, ms: 1, isErrored: false, added, removed };
}

function worldOf(on: On): MockClock {
  store.clear();
  missing.clear();
  asked.clear();
  const clock = mock.clock(on, { now: 1_000 });
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
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: "/work" }));
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", (_$, e) => {
    asked.add(e.path);
    return missing.has(e.path) ? { value: false } : { value: true };
  });
  return clock;
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

async function partsOfRow(pane: Pane, start: string): Promise<Parts> {
  const line = linesOf(await pane.drawn()).find((one) => one.text.startsWith(start));
  expect(line, `a row starting ${start}`).toBeDefined();
  return line?.parts ?? [];
}

function colourOfPiece(parts: Parts, piece: string): unknown {
  return parts.find((part) => leafTextOf(part).trim() === piece)?.props?.color;
}

async function rowsOf(pane: Pane): Promise<string[]> {
  const rows = await bodyRows(pane);
  return rows
    .map((row) => row.text.trimEnd())
    .filter(
      (text) =>
        text.trim() !== "Files" &&
        text.trim() !== "f filter" &&
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
  if (isHidden(node)) return [];
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

function textNodesIn(node: Node): Node[] {
  const own = node.type === "Text" ? [node] : [];
  return [...own, ...elementsIn(node).flatMap(textNodesIn)];
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
  if (isHidden(node)) return "";
  if (node.type === "Button") return foldLabel(node);
  return (node.children ?? [])
    .map((child) => (typeof child === "string" ? child : textOf(child as Node)))
    .join("");
}
