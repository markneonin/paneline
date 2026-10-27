import { describe, expect, mock, test } from "claude-code/testing";
import type { AgentInfo, On } from "claude-code";
import type { Engine, MockClock, Mounted } from "claude-code/testing";

import type { AgentNode, AgentTree } from "../hooks/agents-model";

type Pane = Mounted<"terminal", "Pane">;
type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] };
type GitAnswer = { exitCode: number; stdout: string };

const NOW = 200_000;
const FLUSH_MS = 1_000;
const COLUMNS = 100;
const TALL_ROWS = 40;
const SHORT_ROWS = 22;
const MAIN_ROOT = "/work/paneline";
const WORKTREE_ROOT = "/work/paneline-signals";
const written = new Map<string, unknown>();
const store = new Map<string, { value: unknown; version: number }>();
const GIT_ARGV = [
  "git",
  "-C",
  WORKTREE_ROOT,
  "rev-parse",
  "--show-toplevel",
  "--abbrev-ref",
  "HEAD",
];

describe("branch line in the card", () => {
  test("P1 an agent in its own worktree shows the branch and the worktree folder", async ($, on) => {
    world(on);

    const rows = await rowTexts(
      await paneWith($, [
        agent({
          id: "a",
          description: "alpha",
          branch: "feature/signals",
          worktree: "paneline-signals",
        }),
      ]),
    );

    expect(rows.map((text) => text.trim())).toContain("⎇ feature/signals · paneline-signals");
  });

  test("P2 an agent in the main checkout shows the branch alone", async ($, on) => {
    world(on);

    const rows = await rowTexts(
      await paneWith($, [
        agent({ id: "a", description: "alpha", status: "running", branch: "main" }),
      ]),
    );

    expect(rows.some((text) => text.includes("⎇ main") && !text.includes("·"))).toBe(true);
  });

  test("P3 an agent with no known place shows no branch line", async ($, on) => {
    world(on);

    const rows = await rowTexts(await paneWith($, [agent({ id: "a", description: "alpha" })]));

    expect(rows.some((text) => text.includes("⎇"))).toBe(false);
  });

  test("P4 the collapse counts the branch line, so fewer finished cards fit", async ($, on) => {
    world(on);
    const finished = (withBranch: boolean) =>
      Array.from({ length: 8 }, (_, i) =>
        agent({
          id: `f${i}`,
          description: `finished ${i}`,
          endedAt: NOW - 40_000 + i * 100,
          ...(withBranch && { branch: "main" }),
        }),
      );

    const plainPane = await paneWith($, finished(false), SHORT_ROWS);
    const plain = await rowTexts(plainPane);
    await plainPane.unmount();
    const branched = await rowTexts(await paneWith($, finished(true), SHORT_ROWS));

    const cards = (rows: string[]) => rows.filter((text) => text.includes("finished ")).length;
    expect(cards(branched)).toBeLessThan(cards(plain));
    expect(branched.length).toBeLessThan(SHORT_ROWS);
  });
});

describe("finding the place", () => {
  test("P5 a spawn with a cwd runs one git command and shows the worktree", async ($, on) => {
    const w = world(on, { [WORKTREE_ROOT]: answer(WORKTREE_ROOT, "feature/signals") });

    await $.agent.spawn(spawnInput({ cwd: WORKTREE_ROOT }));
    await w.clock.advance(FLUSH_MS);

    expect(w.processes).toEqual([GIT_ARGV]);
    expect(w.tree()["agent-1"]).toMatchObject({
      branch: "feature/signals",
      worktree: "paneline-signals",
    });
  });

  test("P6 an agent in the main checkout gets the branch and no worktree", async ($, on) => {
    const w = world(on, { [MAIN_ROOT]: answer(MAIN_ROOT, "main") });

    await $.agent.spawn(spawnInput({ cwd: MAIN_ROOT }));
    await w.clock.advance(FLUSH_MS);

    expect(w.tree()["agent-1"]?.branch).toBe("main");
    expect(w.tree()["agent-1"]?.worktree).toBeUndefined();
  });

  test("P7 a second agent in the same directory spawns no new process", async ($, on) => {
    const w = world(on, { [WORKTREE_ROOT]: answer(WORKTREE_ROOT, "feature/signals") });
    await $.agent.spawn(spawnInput({ cwd: WORKTREE_ROOT }));

    await $.agent.spawn(spawnInput({ cwd: WORKTREE_ROOT }));
    await w.clock.advance(FLUSH_MS);

    expect(w.processes).toHaveLength(1);
    expect(w.tree()["agent-2"]?.branch).toBe("feature/signals");
  });

  test("P8 tool calls of a placed agent spawn no process", async ($, on) => {
    const w = world(on, { [WORKTREE_ROOT]: answer(WORKTREE_ROOT, "feature/signals") });
    await $.agent.spawn(spawnInput({ cwd: WORKTREE_ROOT }));

    await subagentCall($, "agent-1", { tool: "Edit", file_path: `${WORKTREE_ROOT}/src/a.ts` });
    await subagentCall($, "agent-1", { tool: "Bash", command: `cd ${WORKTREE_ROOT} && ls` });

    expect(w.processes).toHaveLength(1);
  });

  test("P9 the directory of a first file edit places an agent that had no cwd", async ($, on) => {
    const w = world(on, { [`${WORKTREE_ROOT}/src`]: answer(WORKTREE_ROOT, "feature/signals") });
    await $.agent.spawn(spawnInput());

    await subagentCall($, "agent-1", { tool: "Write", file_path: `${WORKTREE_ROOT}/src/a.ts` });
    await w.clock.advance(FLUSH_MS);

    expect(w.tree()["agent-1"]).toMatchObject({
      branch: "feature/signals",
      worktree: "paneline-signals",
    });
  });

  test("P10 an agent whose directory is unknown spawns no process and has no branch", async ($, on) => {
    const w = world(on);
    await $.agent.spawn(spawnInput());

    await subagentCall($, "agent-1", { tool: "Bash", command: "npm test" });
    await subagentCall($, "agent-1", { tool: "Read", file_path: "relative/file.ts" });
    await w.clock.advance(FLUSH_MS);

    expect(w.processes).toEqual([]);
    expect(w.tree()["agent-1"]?.branch).toBeUndefined();
  });

  test("P11 a directory outside any repo is asked once and shows no branch", async ($, on) => {
    const w = world(on);
    await $.agent.spawn(spawnInput({ cwd: "/tmp/none" }));

    await subagentCall($, "agent-1", { tool: "Bash", command: "cd /tmp/none && ls" });
    await subagentCall($, "agent-1", { tool: "Read", file_path: "/tmp/none/a.txt" });
    await w.clock.advance(FLUSH_MS);

    expect(w.processes).toHaveLength(1);
    expect(w.tree()["agent-1"]?.branch).toBeUndefined();
  });

  test("P12 the main chat tool calls spawn no process", async ($, on) => {
    const w = world(on);

    await $.tool.call({ tool: "Edit", file_path: `${WORKTREE_ROOT}/src/a.ts` } as never);
    await w.clock.advance(FLUSH_MS);

    expect(w.processes).toEqual([]);
  });

  test("P13 when the agent finishes its branch is read once more", async ($, on) => {
    const w = world(on, { [WORKTREE_ROOT]: answer(WORKTREE_ROOT, "feature/signals") });
    await $.agent.spawn(spawnInput({ cwd: WORKTREE_ROOT }));
    w.answers[WORKTREE_ROOT] = answer(WORKTREE_ROOT, "feature/signals-2");

    await $.turn.complete({
      answer: "",
      durationMs: 5,
      isAborted: false,
      turnId: "t",
      agentId: "agent-1",
      reason: "answer",
    } as never);
    await w.clock.advance(FLUSH_MS);

    expect(w.processes).toHaveLength(2);
    expect(w.tree()["agent-1"]?.branch).toBe("feature/signals-2");
  });
});

type World = {
  clock: MockClock;
  processes: string[][];
  answers: Record<string, GitAnswer>;
  tree: () => AgentTree;
};

function answer(root: string, branch: string): GitAnswer {
  return { exitCode: 0, stdout: `${root}\n${branch}\n` };
}

function world(on: On, answers: Record<string, GitAnswer> = {}): World {
  const clock = mock.clock(on, { now: NOW });
  const processes: string[][] = [];
  store.clear();
  written.clear();
  let spawned = 0;
  on("state.get", (_$, e, next) => {
    const seeded = store.get(e.key);
    return seeded ? { value: seeded } : next(e);
  });
  on("state.set", (_$, e, next) => {
    store.delete(e.key);
    written.set(e.key, e.value);
    return next(e);
  });
  on("process.run", (_$, e) => {
    processes.push([...e.argv]);
    const dir = e.argv[2] ?? "";
    const { exitCode, stdout } = answers[dir] ?? { exitCode: 128, stdout: "" };
    return { value: { exitCode, stdout, stderr: "" } } as never;
  });
  on("session.cwd", () => ({ value: MAIN_ROOT }));
  on("session.usage", () => ({
    value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("agent.spawn", () => ({ model: "sonnet", agentId: `agent-${++spawned}` }));
  on("tool.call", () => ({ result: "ok", text: "ok", ref: 1 }));
  on("turn.complete", (_$, e) => ({ text: e.answer }));
  on("classic.SessionStart", () => ({}));
  mock.env(on, { HOME: "/h/u" });
  on("session.model", () => ({ value: "opus" }));
  on("ui.render", { component: "Pane" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine pane</Text>;
  });
  on("agent.list", () => ({ value: [] as AgentInfo[] }));
  return { clock, processes, answers, tree: () => (written.get("agents") ?? {}) as AgentTree };
}

function spawnInput(overrides: Record<string, unknown> = {}): never {
  return {
    tool_use_id: "call",
    prompt: "do the work",
    description: "work",
    subagentType: "general-purpose",
    provider: { plugin: "engine", tier: "core" },
    parentModel: "sonnet",
    background: false,
    fork: false,
    ...overrides,
  } as never;
}

function subagentCall($: Engine, agentId: string, call: object): Promise<unknown> {
  return ($.tool.call as (e: object) => Promise<unknown>)({ ...call, agentId });
}

function agent(fields: Partial<AgentNode> & { id: string }): AgentNode {
  return {
    type: "general-purpose",
    description: fields.id,
    background: false,
    model: "sonnet",
    status: "done",
    startedAt: NOW - 10_000,
    ctxTokens: 0,
    tokensIn: 0,
    tokensOut: 0,
    running: [],
    ...fields,
  };
}

async function paneWith($: Engine, agents: AgentNode[], rows: number = TALL_ROWS): Promise<Pane> {
  store.set("agents", {
    value: Object.fromEntries(agents.map((one) => [one.id, one])),
    version: 1,
  });
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
      scroll: { offset: 0, bodyRows: rows },
      view: {},
    },
    viewport: { columns: COLUMNS, rows },
  });
  const tab = (await pane.findAll({ type: "Button" })).find(
    (button) => button.props.label === "Agents",
  );
  if (tab?.key) await pane.press({ key: tab.key });
  return pane;
}

async function rowTexts(pane: Pane): Promise<string[]> {
  return linesOf((await pane.drawn()) as unknown as Node).filter((text) => text !== "");
}

function linesOf(node: Node): string[] {
  if (node.type === "Text") return [textOf(node)];
  const children = elementsIn(node);
  const isRow =
    node.type === "Box" &&
    !["column", "column-reverse"].includes(String(node.props?.flexDirection));
  if (isRow && !children.some(holdsColumn)) return [textOf(node)];
  return children.flatMap(linesOf);
}

function holdsColumn(node: Node): boolean {
  const isColumn =
    node.type === "Box" && ["column", "column-reverse"].includes(String(node.props?.flexDirection));
  return isColumn || elementsIn(node).some(holdsColumn);
}

function elementsIn(node: Node): Node[] {
  return (node.children ?? []).filter(
    (child): child is Node => typeof child === "object" && child !== null,
  );
}

function textOf(node: Node): string {
  return (node.children ?? [])
    .map((child) => (typeof child === "string" ? child : textOf(child as Node)))
    .join("");
}
