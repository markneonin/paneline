import { describe, expect, mock, test } from "claude-code/testing";
import type { On, PromptOrigin, ToolCallResult } from "claude-code";
import type { Engine, MockClock } from "claude-code/testing";

import { shownText } from "./band-screen";

const PROGRESS = "mcp__paneline__progress";
const OTHER_MCP_TOOL = "mcp__other__lookup";
const FLUSH_MS = 1_000;
const WORK = "/work";
const NOTE_EVERY = 8;
const NOTE_MARK = "progress";
const REPORT_CAP = 95;
const TYPED: PromptOrigin = { kind: "composer" };
const BACKGROUND: PromptOrigin = { kind: "task-notification" };
const SUBAGENT = "agent-1";
const STATE_PREFIX = "paneline.";
const EMPTY_PROGRESS = { tasks: {}, percent: null, callsSinceNote: 0 };
const FIVE_TODOS = [
  { content: "a", status: "completed", activeForm: "a" },
  { content: "b", status: "completed", activeForm: "b" },
  { content: "c", status: "completed", activeForm: "c" },
  { content: "d", status: "pending", activeForm: "d" },
  { content: "e", status: "in_progress", activeForm: "e" },
];
const BAND_COLUMNS = 100;
const BAND_AT_40 = "◆ 40%";
const BAND_AT_100 = "◆ 100%";
const BAND_TASK_MARK = "◆";
const BAND_AT_ONE_OF_THREE = "◆ 33%";
const PANE_ROWS = 40;
const THREE_DONE_OF_FIVE = ["completed", "completed", "completed", "pending", "pending"];

type TaskStatus = "pending" | "in_progress" | "completed";
type ListedTask = { id: string; subject: string; status: TaskStatus };
type ToolInput = { tool: string; [field: string]: unknown };
type Registered = { name: string; isDeferred?: boolean; inputSchema?: { required?: string[] } };
type World = {
  clock: MockClock;
  state: Map<string, { value: unknown; version: number }>;
  store: Map<string, unknown>;
  registered: Registered[];
  created: number;
  taskList: ListedTask[];
  calls: number;
  writes: string[];
  isAgentRunning: boolean;
};

describe("the task list the meter reads", () => {
  test("P1a five created tasks and three completed ones make a list of five with three done", async ($, on) => {
    const world = await begin($, on);

    await createTasks($, world, 5);
    await completeTasks($, world, ["1", "2", "3"]);

    expect(statusesOf(world)).toEqual(THREE_DONE_OF_FIVE);
  });

  test("P1b a todo list of five with three done gives the same five with three done", async ($, on) => {
    const world = await begin($, on);

    await callTool($, world, { tool: "TodoWrite", todos: FIVE_TODOS });

    expect(statusesOf(world)).toEqual([
      "completed",
      "completed",
      "completed",
      "pending",
      "in_progress",
    ]);
  });

  test("P2a a deleted task leaves the list and the others stay", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, 3);

    await callTool($, world, { tool: "TaskUpdate", taskId: "2", status: "deleted" });

    expect(Object.keys(progressOf(world).tasks)).toEqual(["1", "3"]);
  });

  test("P2b reading the task list replaces the whole list", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, 3);
    world.taskList = [listed("7", "completed"), listed("8", "pending")];

    await callTool($, world, { tool: "TaskList" });

    expect(progressOf(world).tasks).toEqual({
      "7": { status: "completed", title: "task 7" },
      "8": { status: "pending", title: "task 8" },
    });
  });
});

describe("the titles the task list keeps", () => {
  test("P11a a created task keeps its subject next to its status", async ($, on) => {
    const world = await begin($, on);

    await createTasks($, world, 2);

    expect(progressOf(world).tasks).toEqual({
      "1": pending("task 0"),
      "2": pending("task 1"),
    });
  });

  test("P11b a todo list keeps each todo text as its title", async ($, on) => {
    const world = await begin($, on);

    await callTool($, world, { tool: "TodoWrite", todos: FIVE_TODOS });

    expect(Object.values(progressOf(world).tasks).map((task) => task.title)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });

  test("P11c reading the task list takes the titles from the list", async ($, on) => {
    const world = await begin($, on);
    world.taskList = [listed("7", "completed"), listed("8", "pending")];

    await callTool($, world, { tool: "TaskList" });

    expect(Object.values(progressOf(world).tasks).map((task) => task.title)).toEqual([
      "task 7",
      "task 8",
    ]);
  });

  test("P11d an update that renames a task changes its title and keeps its status", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, 1);

    await callTool($, world, { tool: "TaskUpdate", taskId: "1", subject: "renamed" });

    expect(progressOf(world).tasks).toEqual({ "1": pending("renamed") });
  });

  test("P11e an update that only moves the status keeps the title", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, 1);

    await callTool($, world, { tool: "TaskUpdate", taskId: "1", status: "in_progress" });

    expect(progressOf(world).tasks).toEqual({
      "1": { status: "in_progress", title: "task 0" },
    });
  });
});

describe("the percent the model reports", () => {
  test("P3a a reported 40 is the meter value", async ($, on) => {
    const world = await begin($, on);

    await report($, world, 40);

    expect(progressOf(world).percent).toBe(40);
  });

  test("P3b a reported 99 shows as 95", async ($, on) => {
    const world = await begin($, on);

    await report($, world, 99);

    expect(progressOf(world).percent).toBe(REPORT_CAP);
  });

  test("P3c a reported 100 shows as 95", async ($, on) => {
    const world = await begin($, on);

    await report($, world, 100);

    expect(progressOf(world).percent).toBe(REPORT_CAP);
  });

  test("P3d the model gets ok back", async ($, on) => {
    const world = await begin($, on);

    const reply = await report($, world, 40);

    expect(JSON.stringify(reply.result)).toContain("ok");
  });

  test("P9 reporting progress never asks the person for permission", async ($, on) => {
    await begin($, on);

    const verdict = await $.tool.check({ tool: PROGRESS, input: { percent: 40 } });

    expect(verdict.decision).toBe("allow");
  });

  test("P10 the model has a progress tool from session start, with a required percent, not behind a search", async ($, on) => {
    const world = await begin($, on);

    expect(world.registered).toContainEqual(
      expect.objectContaining({
        name: "progress",
        isDeferred: false,
        inputSchema: expect.objectContaining({ required: ["percent"] }),
      }),
    );
  });
});

describe("the reminder to report", () => {
  test("P6a with no task list the 8th tool call carries a note asking for progress, the 7th and 9th do not", async ($, on) => {
    const world = await begin($, on);

    const replies = await reads($, world, NOTE_EVERY + 1);

    expect(noteFlags(replies)).toEqual(flagsAt([NOTE_EVERY - 1], NOTE_EVERY + 1));
  });

  test("P6b a progress call restarts the count, so the note comes 8 calls after it", async ($, on) => {
    const world = await begin($, on);
    await reads($, world, 5);
    await report($, world, 30);

    const replies = await reads($, world, NOTE_EVERY);

    expect(noteFlags(replies)).toEqual(flagsAt([NOTE_EVERY - 1], NOTE_EVERY));
  });

  test("P6c with a task list of two there is no note", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, 2);

    const replies = await reads($, world, NOTE_EVERY + 2);

    expect([Object.keys(progressOf(world).tasks).length, ...noteFlags(replies)]).toEqual([
      2,
      ...flagsAt([], NOTE_EVERY + 2),
    ]);
  });

  test("P6d after a note the next one comes 8 calls later", async ($, on) => {
    const world = await begin($, on);

    const replies = await reads($, world, NOTE_EVERY * 2 + 1);

    expect(noteFlags(replies)).toEqual(
      flagsAt([NOTE_EVERY - 1, NOTE_EVERY * 2 - 1], NOTE_EVERY * 2 + 1),
    );
  });
});

describe("a new prompt", () => {
  test("P4a a typed prompt clears the reported percent and keeps the task list", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, 2);
    await report($, world, 40);

    await submit($, "next thing", TYPED);

    expect(progressOf(world)).toMatchObject({
      percent: null,
      tasks: { "1": pending("task 0"), "2": pending("task 1") },
    });
  });

  test("P4b a blank typed prompt keeps the percent and the task list", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, 2);
    await report($, world, 40);

    await submit($, "  ", TYPED);

    expect(progressOf(world)).toMatchObject({
      percent: 40,
      tasks: { "1": pending("task 0"), "2": pending("task 1") },
    });
  });

  test("P4c a background task notification keeps the percent and the task list", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, 2);
    await report($, world, 40);

    await submit($, "task done", BACKGROUND);

    expect(progressOf(world)).toMatchObject({
      percent: 40,
      tasks: { "1": pending("task 0"), "2": pending("task 1") },
    });
  });

  test("P4d a typed prompt restarts the call count, so the note comes 8 calls after it", async ($, on) => {
    const world = await begin($, on);
    await reads($, world, 5);
    await submit($, "next thing", TYPED);

    const replies = await reads($, world, NOTE_EVERY);

    expect(noteFlags(replies)).toEqual(flagsAt([NOTE_EVERY - 1], NOTE_EVERY));
  });

  test("P4e a blank typed prompt keeps the call count, so the note still comes on the 8th call", async ($, on) => {
    const world = await begin($, on);
    await reads($, world, 5);
    await submit($, "", TYPED);

    const replies = await reads($, world, NOTE_EVERY - 5);

    expect(noteFlags(replies)).toEqual(flagsAt([NOTE_EVERY - 6], NOTE_EVERY - 5));
  });
});

describe("the final answer", () => {
  test("P7a an answer with a reported percent and no subagent running makes it 100", async ($, on) => {
    const world = await begin($, on);
    await report($, world, 40);

    await finishTurn($, "answer");

    expect(progressOf(world).percent).toBe(100);
  });

  test("P7b an answer while a background subagent still runs keeps the value", async ($, on) => {
    const world = await begin($, on);
    await spawnBackgroundAgent($, world);
    await report($, world, 40);

    await finishTurn($, "answer");

    expect(progressOf(world).percent).toBe(40);
  });

  test("P7c an aborted turn keeps the value", async ($, on) => {
    const world = await begin($, on);
    await report($, world, 40);

    await finishTurn($, "aborted");

    expect(progressOf(world).percent).toBe(40);
  });

  test("P7e a turn that ends with an error keeps the value", async ($, on) => {
    const world = await begin($, on);
    await report($, world, 40);

    await finishTurn($, "error");

    expect(progressOf(world).percent).toBe(40);
  });

  test("P7d an answer with only a task list of two does not invent a percent", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, 2);

    await finishTurn($, "answer");

    expect(progressOf(world)).toMatchObject({
      percent: null,
      tasks: { "1": pending("task 0"), "2": pending("task 1") },
    });
  });
});

describe("what subagents cannot move", () => {
  test("P5a a subagent creating, updating and listing tasks leaves the list unchanged", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, 1);
    world.taskList = [listed("9", "completed")];

    await callTool($, world, { tool: "TaskCreate", subject: "x", description: "x" }, SUBAGENT);
    await callTool($, world, { tool: "TaskUpdate", taskId: "1", status: "completed" }, SUBAGENT);
    await callTool($, world, { tool: "TaskList" }, SUBAGENT);
    await callTool($, world, { tool: "TodoWrite", todos: FIVE_TODOS }, SUBAGENT);

    expect(progressOf(world).tasks).toEqual({ "1": pending("task 0") });
  });

  test("P5b subagent tool calls get no note and do not count towards the main session's 8", async ($, on) => {
    const world = await begin($, on);

    const fromSubagent = await reads($, world, NOTE_EVERY, SUBAGENT);
    const fromMain = await reads($, world, NOTE_EVERY);

    expect(noteFlags([...fromSubagent, ...fromMain])).toEqual(
      flagsAt([NOTE_EVERY * 2 - 1], NOTE_EVERY * 2),
    );
  });

  test("P5c a subagent's progress call gets ok and moves nothing", async ($, on) => {
    const world = await begin($, on);

    const reply = await report($, world, 70, SUBAGENT);

    expect(JSON.stringify(reply.result)).toContain("ok");
    expect(progressOf(world)).toEqual(EMPTY_PROGRESS);
  });

  test("P5d a subagent finishing its turn does not make the meter 100", async ($, on) => {
    const world = await begin($, on);
    await spawnBackgroundAgent($, world);
    await report($, world, 40);

    await finishTurn($, "answer", SUBAGENT);

    expect(progressOf(world).percent).toBe(40);
  });
});

describe("a progress call stays out of the counts", () => {
  test("P8a it is not in the Activity list, a normal call is", async ($, on) => {
    const world = await begin($, on);

    await runThreeCalls($, world);

    expect(toolsIn(world, "activity")).toEqual(["Read", OTHER_MCP_TOOL]);
  });

  test("P8b it is not in the call records, a normal call is", async ($, on) => {
    const world = await begin($, on);

    await runThreeCalls($, world);

    expect(toolsIn(world, "calls")).toEqual(["Read", OTHER_MCP_TOOL]);
  });

  test("P8c it is not in the MCP use counts, a normal MCP call is", async ($, on) => {
    const world = await begin($, on);

    await runThreeCalls($, world);

    expect(stateOf(world, "toolUses")).toEqual({ [OTHER_MCP_TOOL]: 1 });
  });
});

describe("the final answer with agents", () => {
  test("PF1 a background agent started just before the final answer keeps a reported 40 at 40", async ($, on) => {
    const world = await begin($, on);
    await report($, world, 40);

    await spawnAgentAt($, world, false);
    await finishTurn($, "answer");

    expect(progressOf(world).percent).toBe(40);
  });

  test("PF2 a foreground agent that finished before the final answer still lets the meter reach 100", async ($, on) => {
    const world = await begin($, on);
    await report($, world, 40);
    await spawnAgentAt($, world, true);
    await finishTurn($, "answer", SUBAGENT);
    await world.clock.advance(FLUSH_MS);

    await finishTurn($, "answer");

    expect(progressOf(world).percent).toBe(100);
  });
});

describe("what the band redraws for", () => {
  test("PF3 a tool call that brings no note writes nothing the band reads", async ($, on) => {
    const world = await begin($, on);

    const written = await progressWritesDuring(world, () => reads($, world, 1));

    expect(written).toBe(0);
  });

  test("PF5a reading the same task list again writes nothing", async ($, on) => {
    const world = await begin($, on);
    world.taskList = [listed("7", "completed"), listed("8", "pending")];
    await callTool($, world, { tool: "TaskList" });

    const written = await progressWritesDuring(world, () =>
      callTool($, world, { tool: "TaskList" }),
    );

    expect(written).toBe(0);
  });

  test("PF5b setting a task to the status it already has writes nothing", async ($, on) => {
    const world = await begin($, on);
    await createTasks($, world, 1);
    await completeTasks($, world, ["1"]);

    const written = await progressWritesDuring(world, () => completeTasks($, world, ["1"]));

    expect(written).toBe(0);
  });

  test("PF5c reporting the same percent again writes nothing", async ($, on) => {
    const world = await begin($, on);
    await report($, world, 40);

    const written = await progressWritesDuring(world, () => report($, world, 40));

    expect(written).toBe(0);
  });

  test("PF5d a second typed prompt with nothing to clear writes nothing", async ($, on) => {
    const world = await begin($, on);
    await submit($, "first", TYPED);

    const written = await progressWritesDuring(world, () => submit($, "second", TYPED));

    expect(written).toBe(0);
  });

  test("PF5e a final answer on a meter already at 100 writes nothing", async ($, on) => {
    const world = await begin($, on);
    await report($, world, 40);
    await finishTurn($, "answer");

    const written = await progressWritesDuring(world, () => finishTurn($, "answer"));

    expect(written).toBe(0);
  });

  test("PF7 three tasks created in parallel all land in the band and the Plan tab", async ($, on) => {
    const world = await begin($, on);
    await Promise.all(
      ["alpha", "beta", "gamma"].map((subject) =>
        callTool($, world, { tool: "TaskCreate", subject, description: "x" }),
      ),
    );
    await completeTasks($, world, ["1"]);
    await reads($, world, NOTE_EVERY + 2);

    const plan = await planTabText($);

    expect(await bandText($)).toContain(BAND_AT_ONE_OF_THREE);
    expect(plan).toContain("beta");
    expect(plan).toContain("gamma");
  });

  test("PF6a the band shows a reported 40 as 40%", async ($, on) => {
    const world = await begin($, on);

    await report($, world, 40);

    expect(await bandText($)).toContain(BAND_AT_40);
  });

  test("PF6b the band shows 100% after the final answer", async ($, on) => {
    const world = await begin($, on);
    await report($, world, 40);

    await finishTurn($, "answer");

    expect(await bandText($)).toContain(BAND_AT_100);
  });

  test("PF6c the band drops the meter when a typed prompt clears the percent", async ($, on) => {
    const world = await begin($, on);
    await report($, world, 40);

    await submit($, "next thing", TYPED);

    expect(await bandText($)).not.toContain(BAND_TASK_MARK);
  });

  test("PF6d the band shows the share of finished tasks after many tool calls", async ($, on) => {
    const world = await begin($, on);
    await callTool($, world, { tool: "TodoWrite", todos: FIVE_TODOS });

    await reads($, world, NOTE_EVERY + 2);

    expect(await bandText($)).toContain("◆ 60%");
  });
});

async function progressWritesDuring(world: World, action: () => Promise<unknown>): Promise<number> {
  const before = world.writes.length;
  await action();
  return world.writes.slice(before).filter((key) => key === "progress").length;
}

async function bandText($: Engine): Promise<string> {
  const band = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "AbovePrompt",
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns: BAND_COLUMNS,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
    viewport: { columns: BAND_COLUMNS, rows: 40 },
  });
  return shownText(await band.drawn());
}

async function planTabText($: Engine): Promise<string> {
  const pane = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: "session",
    props: {
      title: "Session",
      isFocused: false,
      bodyColumns: BAND_COLUMNS,
      placement: "dock",
      scroll: { offset: 0, bodyRows: PANE_ROWS },
      view: {},
    },
    viewport: { columns: BAND_COLUMNS, rows: PANE_ROWS },
  });
  const tab = (await pane.findAll({ type: "Button" })).find(
    (button) => button.props.label === "Plan",
  );
  await pane.press({ key: tab?.key ?? "" });
  await pane.redraw();
  return JSON.stringify(await pane.drawn());
}

async function spawnAgentAt($: Engine, world: World, isForeground: boolean): Promise<void> {
  await $.agent.spawn({
    tool_use_id: "spawn-call",
    prompt: "do the work",
    description: "work",
    subagentType: "general-purpose",
    provider: "anthropic",
    parentModel: "claude-opus-5-5",
    background: !isForeground,
    fork: false,
  } as never);
  if (isForeground) await world.clock.advance(FLUSH_MS);
}

async function runThreeCalls($: Engine, world: World): Promise<void> {
  await callTool($, world, { tool: "Read", file_path: "/work/a.ts" });
  await report($, world, 40);
  await callTool($, world, { tool: OTHER_MCP_TOOL, query: "x" });
}

function toolsIn(world: World, key: string): string[] {
  return ((stateOf(world, key) ?? []) as { tool: string }[]).map((entry) => entry.tool);
}

function noteFlags(replies: ToolCallResult[]): boolean[] {
  return replies.map((reply) => (reply.context ?? []).join("\n").includes(NOTE_MARK));
}

function flagsAt(positions: number[], length: number): boolean[] {
  return Array.from({ length }, (_unused, index) => positions.includes(index));
}

function listed(id: string, status: TaskStatus): ListedTask {
  return { id, subject: `task ${id}`, status };
}

function pending(title: string): { status: string; title: string } {
  return { status: "pending", title };
}

function statusesOf(world: World): string[] {
  return Object.values(progressOf(world).tasks).map((task) => task.status);
}

function progressOf(world: World): {
  tasks: Record<string, { status: string; title: string }>;
  percent: number | null;
  callsSinceNote: number;
} {
  return (stateOf(world, "progress") ?? EMPTY_PROGRESS) as ReturnType<typeof progressOf>;
}

function stateOf(world: World, key: string): unknown {
  return world.state.get(`${STATE_PREFIX}${key}.`)?.value;
}

async function begin($: Engine, on: On): Promise<World> {
  const world = worldOf(on);
  await $.session.start({ cwd: WORK, surface: "terminal", isInteractive: true });
  await world.clock.advance(FLUSH_MS);
  return world;
}

async function callTool(
  $: Engine,
  world: World,
  input: ToolInput,
  agentId?: string,
): Promise<ToolCallResult> {
  const reply = await ($.tool.call as (e: object) => Promise<ToolCallResult>)({
    ...input,
    tool_use_id: `call-${++world.calls}`,
    ...(agentId === undefined ? {} : { agentId }),
  });
  await world.clock.advance(FLUSH_MS);
  return reply;
}

function report(
  $: Engine,
  world: World,
  percent: number,
  agentId?: string,
): Promise<ToolCallResult> {
  return callTool($, world, { tool: PROGRESS, percent }, agentId);
}

async function reads(
  $: Engine,
  world: World,
  count: number,
  agentId?: string,
): Promise<ToolCallResult[]> {
  const replies: ToolCallResult[] = [];
  for (let index = 0; index < count; index++) {
    replies.push(
      await callTool($, world, { tool: "Read", file_path: `/work/${index}.ts` }, agentId),
    );
  }
  return replies;
}

async function createTasks($: Engine, world: World, count: number): Promise<void> {
  for (let index = 0; index < count; index++) {
    await callTool($, world, { tool: "TaskCreate", subject: `task ${index}`, description: "x" });
  }
}

async function completeTasks($: Engine, world: World, ids: string[]): Promise<void> {
  for (const taskId of ids) {
    await callTool($, world, { tool: "TaskUpdate", taskId, status: "completed" });
  }
}

async function submit($: Engine, text: string, origin: PromptOrigin): Promise<void> {
  await ($.prompt.submit as (e: object) => Promise<unknown>)({ text, wait: false, origin });
}

async function finishTurn(
  $: Engine,
  reason: "answer" | "aborted" | "error",
  agentId?: string,
): Promise<void> {
  await $.turn.complete({
    answer: "",
    durationMs: 5,
    isAborted: reason === "aborted",
    turnId: "turn-1",
    reason,
    ...(agentId === undefined ? {} : { agentId }),
  });
}

async function spawnBackgroundAgent($: Engine, world: World): Promise<void> {
  await $.agent.spawn({
    tool_use_id: "spawn-call",
    prompt: "do the work",
    description: "work",
    subagentType: "general-purpose",
    provider: "anthropic",
    parentModel: "claude-opus-5-5",
    background: true,
    fork: false,
  } as never);
  await world.clock.advance(FLUSH_MS);
}

function worldOf(on: On): World {
  const world: World = {
    clock: mock.clock(on, { now: 1_000_000 }),
    state: new Map(),
    store: new Map(),
    registered: [],
    created: 0,
    taskList: [],
    calls: 0,
    writes: [],
    isAgentRunning: false,
  };
  mock.env(on, { HOME: "/h/u" });
  on("config.list", () => ({ value: [{ key: "theme", value: "dark" }] }) as never);
  on("command.register", () => ({ value: {} }) as never);
  on("session.id", () => ({ value: "session-one" }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("store.get", (_$, e) => ({ value: world.store.get(e.key) }));
  on("store.set", (_$, e) => {
    world.store.set(e.key, JSON.parse(JSON.stringify(e.value)));
    return { value: undefined };
  });
  on("state.get", (_$, e) => {
    const entry = world.state.get(`${e.plugin}.${e.key}.${e.id ?? ""}`);
    return { value: { value: entry?.value, version: entry?.version ?? 0 } };
  });
  on("state.set", (_$, e) => {
    const key = `${e.plugin}.${e.key}.${e.id ?? ""}`;
    const held = world.state.get(key)?.version ?? 0;
    if (e.ifVersion !== undefined && e.ifVersion !== held)
      return { value: { isSet: false, version: held } };
    const version = held + 1;
    world.writes.push(e.key);
    world.state.set(key, { value: JSON.parse(JSON.stringify(e.value)), version });
    return { value: { isSet: true, version } };
  });
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: WORK }));
  on("ui.render", { component: "Pane" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine pane</Text>;
  });
  on("ui.render", { component: "AbovePrompt" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine row</Text>;
  });
  on(
    "agent.list",
    () =>
      ({
        value: world.isAgentRunning ? [{ id: SUBAGENT, status: "running" }] : [],
      }) as never,
  );
  on("fs.exists", () => ({ value: true }));
  on("agent.spawn", (_$, e) => {
    world.isAgentRunning = e.background;
    return { model: "claude-sonnet-5-5", agentId: SUBAGENT };
  });
  on("tool.register", (_$, e) => {
    world.registered.push(e);
    return { value: { tool: `mcp__paneline__${e.name}` } };
  });
  on("tool.check", (_$, e) => ({ decision: e.tool === PROGRESS ? "ask" : "allow" }));
  on("prompt.submit", (_$, e) => ({ text: e.text }));
  on("turn.complete", (_$, e) => ({ text: e.answer }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("process.run", () => ({ value: { exitCode: 0, stdout: "", stderr: "" } }) as never);
  on("tool.call", (_$, e) => answerOf(world, e as unknown as ToolInput));
  return world;
}

function answerOf(world: World, call: ToolInput): ToolCallResult {
  if (call.tool === PROGRESS)
    return { isError: true, result: "unknown tool", text: "unknown tool" } as never;
  if (call.tool === "TaskCreate") {
    const id = String(++world.created);
    return { result: { task: { id, subject: call.subject } }, text: "created" };
  }
  if (call.tool === "TaskUpdate") {
    return {
      result: { success: true, taskId: call.taskId, updatedFields: ["status"] },
      text: "updated",
    };
  }
  if (call.tool === "TaskList") return { result: { tasks: world.taskList }, text: "listed" };
  if (call.tool === "TodoWrite") {
    return { result: { oldTodos: [], newTodos: call.todos }, text: "written" };
  }
  return { result: "ok", text: "ok" };
}
