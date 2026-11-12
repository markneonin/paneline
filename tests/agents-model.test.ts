import { describe, expect, test } from "claude-code/testing";
import {
  completed,
  cutDone,
  orderedRows,
  pruned,
  reconciled,
  spawned,
  stepped,
  toolEnded,
  toolStarted,
} from "../hooks/agents-model";
import type { AgentTree, Usage } from "../hooks/agents-model";

const NO_USAGE = null;

describe("spawning", () => {
  test("A1 a new subagent is running with zero tokens and no command running", () => {
    const tree = spawn({}, "A", { type: "general-purpose", description: "scan repo", at: 5 });

    expect(tree.A).toMatchObject({
      id: "A",
      type: "general-purpose",
      description: "scan repo",
      status: "running",
      startedAt: 5,
      ctxTokens: 0,
      running: [],
    });
  });

  test("A2 a subagent started by another one is shown one level under it", () => {
    const tree = spawn(spawn({}, "A", { at: 1 }), "B", { parentId: "A", at: 2 });

    expect(rowsOf(tree)).toEqual([
      ["A", 0, true],
      ["B", 1, true],
    ]);
  });
});

describe("finishing", () => {
  test("A3 an agent that finishes with an answer is done", () => {
    const tree = completed(spawn({}, "A"), "A", "answer", 10);

    expect(tree.A?.status).toBe("done");
  });

  test("A4 an agent that finishes with an error is failed", () => {
    const tree = completed(spawn({}, "A"), "A", "error", 10);

    expect(tree.A?.status).toBe("failed");
  });

  test("A5 an agent that finishes with a refusal is failed", () => {
    const tree = completed(spawn({}, "A"), "A", "refusal", 10);

    expect(tree.A?.status).toBe("failed");
  });

  test("A6 an aborted agent is stopped", () => {
    const tree = completed(spawn({}, "A"), "A", "aborted", 10);

    expect(tree.A?.status).toBe("stopped");
  });

  test("A7 a finished agent has an end time and no command running", () => {
    const running = toolStarted(spawn({}, "A"), "A", bash("c1"));

    const tree = completed(running, "A", "answer", 42);

    expect(tree.A?.endedAt).toBe(42);
    expect(tree.A?.running).toEqual([]);
  });

  test("A12 an agent that ended and takes another step is running again with no end time", () => {
    const ended = completed(spawn({}, "A"), "A", "answer", 10);

    const tree = stepped(ended, "A", { model: "opus", usage: NO_USAGE });

    expect(tree.A?.status).toBe("running");
    expect(tree.A?.endedAt).toBeUndefined();
  });

  test("A13 an agent that ended and starts a command is running again with no end time", () => {
    const ended = completed(spawn({}, "A"), "A", "error", 10);

    const tree = toolStarted(ended, "A", bash("c1"));

    expect(tree.A?.status).toBe("running");
    expect(tree.A?.endedAt).toBeUndefined();
  });
});

describe("steps and context", () => {
  test("A8 a step shows the model and effort the agent runs with", () => {
    const tree = stepped(spawn({}, "A"), "A", {
      model: "claude-opus",
      effort: "high",
      usage: NO_USAGE,
    });

    expect(tree.A?.model).toBe("claude-opus");
    expect(tree.A?.effort).toBe("high");
  });

  test("A9 over two steps the context size shows only the last step", () => {
    const first = usage({ input: 100, output: 20, cacheRead: 50, cacheCreation: 30 });
    const second = usage({ input: 10, output: 5, cacheRead: 400, cacheCreation: 0 });

    const afterFirst = stepped(spawn({}, "A"), "A", { model: "m", usage: first });
    const afterSecond = stepped(afterFirst, "A", { model: "m", usage: second });

    expect(afterFirst.A).toMatchObject({ ctxTokens: 200 });
    expect(afterSecond.A).toMatchObject({ ctxTokens: 415 });
  });

  test("A10 a step without usage leaves the context size as it was", () => {
    const counted = stepped(spawn({}, "A"), "A", {
      model: "m",
      usage: usage({ input: 100, output: 20, cacheRead: 50, cacheCreation: 30 }),
    });

    const tree = stepped(counted, "A", { model: "m2", usage: NO_USAGE });

    expect(tree.A).toMatchObject({ model: "m2", ctxTokens: 200 });
  });
});

describe("commands running", () => {
  test("A11 two parallel commands are both shown and ending one keeps the other", () => {
    const both = toolStarted(toolStarted(spawn({}, "A"), "A", bash("c1")), "A", bash("c2"));

    const afterEnd = toolEnded(both, "A", "c1");

    expect(both.A?.running.map((t) => t.callId)).toEqual(["c1", "c2"]);
    expect(afterEnd.A?.running.map((t) => t.callId)).toEqual(["c2"]);
  });

  test("A33 ending a command that is not running leaves the running commands as they are", () => {
    const both = toolStarted(toolStarted(spawn({}, "A"), "A", bash("c1")), "A", bash("c2"));

    const tree = toolEnded(both, "A", "nope");

    expect(tree.A?.running.map((t) => t.callId)).toEqual(["c1", "c2"]);
  });
});

describe("reconciling with the engine list", () => {
  test("A14 a killed agent in the engine list shows as stopped although it looked running", () => {
    const tree = reconciled(spawn({}, "A"), [listed("A", "killed")], 50);

    expect(tree.A?.status).toBe("stopped");
  });

  test("A15 waiting and idle in the engine list show as waiting and idle", () => {
    const before = spawn(spawn({}, "A"), "B");

    const tree = reconciled(before, [listed("A", "waiting"), listed("B", "idle")], 50);

    expect(statusesOf(tree)).toEqual({ A: "waiting", B: "idle" });
  });

  test("A16 completed in the engine list shows as done and failed as failed", () => {
    const before = spawn(spawn({}, "A"), "B");

    const tree = reconciled(before, [listed("A", "completed"), listed("B", "failed")], 50);

    expect(statusesOf(tree)).toEqual({ A: "done", B: "failed" });
  });

  test("A28 running and pending in the engine list change nothing the tree already shows", () => {
    const waitingAndIdle = reconciled(
      spawn(spawn({}, "A"), "B"),
      [listed("A", "waiting"), listed("B", "idle")],
      40,
    );

    const tree = reconciled(waitingAndIdle, [listed("A", "running"), listed("B", "pending")], 50);

    expect(statusesOf(tree)).toEqual({ A: "waiting", B: "idle" });
  });

  test("A17 an agent only the engine knows appears under its parent with the listed type and description", () => {
    const before = spawn({}, "A", { at: 1 });

    const tree = reconciled(
      before,
      [listed("skill1", "running", { parentId: "A", type: "skill", description: "fork" })],
      777,
    );

    expect(tree.skill1).toMatchObject({
      id: "skill1",
      parentId: "A",
      type: "skill",
      description: "fork",
      model: "",
      startedAt: 777,
      status: "running",
    });
    expect(rowsOf(tree)).toEqual([
      ["A", 0, true],
      ["skill1", 1, true],
    ]);
  });

  test("A18 an unknown agent listed as pending shows as running and as completed shows as done", () => {
    const tree = reconciled({}, [listed("P", "pending"), listed("C", "completed")], 777);

    expect(statusesOf(tree)).toEqual({ P: "running", C: "done" });
  });

  test("A35 an empty engine list leaves the tree as it was", () => {
    const before = spawn(spawn({}, "A"), "B", { parentId: "A" });

    const tree = reconciled(before, [], 50);

    expect(tree).toEqual(before);
  });
});

describe("unknown agents", () => {
  test("A29 a step for an unknown agent changes nothing", () => {
    const before = spawn({}, "A");

    const tree = stepped(before, "ghost", { model: "m", usage: NO_USAGE });

    expect(tree).toEqual(before);
  });

  test("A30 a command start for an unknown agent changes nothing", () => {
    const before = spawn({}, "A");

    const tree = toolStarted(before, "ghost", bash("c1"));

    expect(tree).toEqual(before);
  });

  test("A31 a command end for an unknown agent changes nothing", () => {
    const before = toolStarted(spawn({}, "A"), "A", bash("c1"));

    const tree = toolEnded(before, "ghost", "c1");

    expect(tree).toEqual(before);
  });

  test("A32 a finish for an unknown agent changes nothing", () => {
    const before = spawn({}, "A");

    const tree = completed(before, "ghost", "error", 10);

    expect(tree).toEqual(before);
  });
});

describe("earlier trees", () => {
  test("A34 an update never alters the tree that was shown before it", () => {
    const before = stepped(spawn({}, "A"), "A", { model: "m1", usage: NO_USAGE });
    const snapshot = structuredClone(before);

    const after = stepped(before, "A", { model: "m2", usage: NO_USAGE });
    const withTool = toolStarted(after, "A", bash("c1"));
    const ended = completed(withTool, "A", "answer", 9);
    const killed = reconciled(ended, [listed("A", "killed")], 10);

    expect(after.A?.model).toBe("m2");
    expect(withTool.A?.running).toHaveLength(1);
    expect(ended.A?.status).toBe("done");
    expect(killed.A?.status).toBe("stopped");
    expect(before).toEqual(snapshot);
  });
});

describe("pruning", () => {
  test("A21 with exactly 60 agents nothing is dropped", () => {
    const tree = agentsWith({ running: 0, endedAt: endedFrom(100, 60) });

    const result = pruned(tree, 60);

    expect(Object.keys(result)).toHaveLength(60);
  });

  test("A22 with 61 agents the one that ended longest ago is dropped and working ones stay", () => {
    const tree = agentsWith({ running: 59, endedAt: { old: 100, mid: 200 } });

    const result = pruned(tree, 60);

    expect(Object.keys(result)).toHaveLength(60);
    expect(result.old).toBeUndefined();
    expect(result.mid).toBeDefined();
    expect(result.run0).toBeDefined();
    expect(result.run58).toBeDefined();
  });

  test("A23 the agent that ended longest ago goes first even when it started later", () => {
    const tree = agentsWith({
      running: 59,
      endedAt: { startedEarlyEndedLate: 500, startedLateEndedEarly: 100 },
      startedAt: { startedEarlyEndedLate: 1, startedLateEndedEarly: 50 },
    });

    const result = pruned(tree, 60);

    expect(result.startedLateEndedEarly).toBeUndefined();
    expect(result.startedEarlyEndedLate).toBeDefined();
  });

  test("A24 when more than 60 agents are working none of them is dropped", () => {
    const tree = agentsWith({ running: 61, endedAt: {} });

    const result = pruned(tree, 60);

    expect(Object.keys(result)).toHaveLength(61);
  });

  test("A25 without a limit given the tree is cut to 60 agents", () => {
    const tree = agentsWith({ running: 60, endedAt: { old: 100 } });

    const result = pruned(tree);

    expect(Object.keys(result)).toHaveLength(60);
    expect(result.old).toBeUndefined();
  });

  test("A26 a dropped ended parent leaves its working child at the top level", () => {
    const base = agentsWith({ running: 59, endedAt: {} });
    const withParent = completed(spawn(base, "parent", { at: 1 }), "parent", "answer", 100);
    const tree = spawn(withParent, "child", { parentId: "parent", at: 2 });

    const result = pruned(tree, 60);

    expect(result.parent).toBeUndefined();
    expect(rowsOf(result).find(([id]) => id === "child")?.[1]).toBe(0);
  });
});

describe("tree rows", () => {
  test("A19 parents come before children and children follow the order they started", () => {
    const tree = spawnAll([
      ["A", { at: 1 }],
      ["late", { parentId: "A", at: 30 }],
      ["early", { parentId: "A", at: 10 }],
      ["grandchild", { parentId: "early", at: 11 }],
    ]);

    expect(rowsOf(tree).map(([id, depth]) => [id, depth])).toEqual([
      ["A", 0],
      ["early", 1],
      ["grandchild", 2],
      ["late", 1],
    ]);
  });

  test("A36 each level marks only its last sibling", () => {
    const tree = spawnAll([
      ["A", { at: 1 }],
      ["B", { at: 2 }],
      ["A1", { parentId: "A", at: 3 }],
      ["A2", { parentId: "A", at: 4 }],
      ["A2x", { parentId: "A2", at: 5 }],
    ]);

    expect(rowsOf(tree)).toEqual([
      ["A", 0, false],
      ["A1", 1, false],
      ["A2", 1, true],
      ["A2x", 2, true],
      ["B", 0, true],
    ]);
  });

  test("A20 an agent whose parent is not in the tree is shown at the top level", () => {
    const tree = spawn({}, "orphan", { parentId: "missing" });

    expect(rowsOf(tree)).toEqual([["orphan", 0, true]]);
  });

  test("A27 an empty tree shows no rows", () => {
    expect(cutDone(orderedRows({}), Infinity).rows).toEqual([]);
  });
});

function spawn(
  tree: AgentTree,
  id: string,
  over: { parentId?: string; type?: string; description?: string; at?: number } = {},
): AgentTree {
  return spawned(tree, {
    id,
    parentId: over.parentId,
    type: over.type ?? "general-purpose",
    description: over.description ?? `task ${id}`,
    background: false,
    model: "m",
    at: over.at ?? 1,
  });
}

function spawnAll(specs: [string, { parentId?: string; at: number }][]): AgentTree {
  return specs.reduce<AgentTree>((tree, [id, over]) => spawn(tree, id, over), {});
}

function agentsWith(spec: {
  running: number;
  endedAt: Record<string, number>;
  startedAt?: Record<string, number>;
}): AgentTree {
  const withRunning = Array.from({ length: spec.running }, (_, i) => `run${i}`).reduce<AgentTree>(
    (tree, id) => spawn(tree, id, { at: 1000 }),
    {},
  );
  return Object.entries(spec.endedAt).reduce((tree, [id, at]) => {
    const started = spawn(tree, id, { at: spec.startedAt?.[id] ?? 1 });
    return completed(started, id, "answer", at);
  }, withRunning);
}

function endedFrom(firstEnd: number, count: number): Record<string, number> {
  return Object.fromEntries(Array.from({ length: count }, (_, i) => [`end${i}`, firstEnd + i]));
}

function rowsOf(tree: AgentTree): [string, number, boolean][] {
  return cutDone(orderedRows(tree), Infinity).rows.map((row) => [
    row.node.id,
    row.depth,
    row.isLast,
  ]);
}

function statusesOf(tree: AgentTree): Record<string, string> {
  return Object.fromEntries(Object.values(tree).map((node) => [node.id, node.status]));
}

function bash(callId: string) {
  return { callId, tool: "Bash", target: `cmd ${callId}` };
}

function usage(u: {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}): Usage {
  return {
    input_tokens: u.input,
    output_tokens: u.output,
    cache_read_input_tokens: u.cacheRead,
    cache_creation_input_tokens: u.cacheCreation,
  };
}

type ListedStatus = Parameters<typeof reconciled>[1][number]["status"];

function listed(
  id: string,
  status: ListedStatus,
  over: { parentId?: string; type?: string; description?: string } = {},
): Parameters<typeof reconciled>[1][number] {
  return {
    id,
    parentId: over.parentId,
    type: over.type ?? "general-purpose",
    description: over.description ?? `task ${id}`,
    status,
  };
}
