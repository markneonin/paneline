import { describe, expect, mock, test } from "claude-code/testing";
import type { On, Shaped, ToolUseSummary } from "claude-code";
import type { Engine, MockClock, Mounted } from "claude-code/testing";

import type { Activity, CallRecord } from "../types";
import { lines, settle } from "./clear-world";
import { textOf } from "./draw-tree";
import { feedSession, notificationOf, useOf } from "./session-feed";
import type { SessionFeed } from "./session-feed";
import { keyOf } from "./skills-tree";

type Pane = Mounted<"terminal", "Pane">;
type Outcome = Record<string, unknown>;
type World = {
  clock: MockClock;
  feed: SessionFeed;
  outcomes: Map<string, Outcome>;
  writes: { key: string; value: unknown }[];
  gates: Map<string, Promise<void>>;
};

const COLUMNS = 80;
const PANE_ROWS = 40;
const CWD = "/work";
const NOW = 200_000;
const BATCH_MS = 1_000;
const CALL_MS = 750;
const RUN_MS = 4_000;
const MANY_CALLS = 50;
const STDOUT_LINES = 400;
const COMMAND_LINES = 300;
const WRITE_LIMIT_BYTES = 16 * 1024;
const REPEATED_FAILS = 3;
const AGENT = "agent-1";
const SPAWNED = "agent-7";
const COMMAND = "make build-all";
const LIVE_OUT = "output the tool returned while it ran";
const SESSION_OUT = "output the session holds for the call";
const SHORT_ANSWER = "short answer from the turn";
const NOTIFIED_ANSWER = "the full answer from the notification";
const LAUNCH_TEXT =
  "Async agent launched successfully. (This tool result is internal metadata, do not repeat it.)";
const GONE_LINE = "no longer in the session";
const BODY_FIELDS = ["detail", "fields", "input", "output", "subject"];
const OLD_INPUT = "input the previous version saved";
const OLD_OUTPUT = "output the previous version saved";
const SUBAGENT_ANSWER = "the answer the subagent gave";
const NEWER_CALLS = 399;

describe("the calls index keeps rows, the session keeps bodies", () => {
  test("K1 fifty agent Bash calls with 400-line output and a 300-line command write call records with no body, each write under 16 KB", async ($, on) => {
    const world = worldOf(on);
    world.outcomes.set("*", bashOk(numbered(STDOUT_LINES, "out")));

    for (let i = 0; i < MANY_CALLS; i++)
      await callTool($, {
        tool: "Bash",
        command: longCommand(i),
        tool_use_id: `k1-${i}`,
        agentId: AGENT,
      });
    await world.clock.advance(BATCH_MS);

    const written = callWrites(world);
    const bodyFields = new Set(
      written.flatMap((list) => list.flatMap((record) => Object.keys(record))).filter(isBodyField),
    );
    const heavy = written
      .map((list) => JSON.stringify(list).length)
      .filter((bytes) => bytes >= WRITE_LIMIT_BYTES);
    expect([...bodyFields]).toEqual([]);
    expect(heavy).toEqual([]);
    expect(written.length).toBeGreaterThan(0);
  });

  test("K2 three failed Bash calls with the same one-line command show one Stuck row reading 3 fails", async ($, on) => {
    const world = worldOf(on);
    world.outcomes.set("*", { isError: true, result: "boom", text: "boom" });
    for (let i = 0; i < REPEATED_FAILS; i++)
      await callTool($, { tool: "Bash", command: COMMAND, tool_use_id: `k2-${i}` });
    const pane = await mountPane($);

    const stuck = (await lines(pane)).filter((line) =>
      line.parts.some((part) => keyOf(part).startsWith("stuck-")),
    );

    expect(stuck.map((line) => line.parts.map(textOf).join(""))).toEqual([
      expect.stringContaining(`${REPEATED_FAILS} fails`),
    ]);
  });

  test("K3 an async Agent call that reports keeps its new duration in calls and activity and writes no output", async ($, on) => {
    const world = worldOf(on);
    world.outcomes.set("k3", asyncLaunch());
    await callTool($, { tool: "Agent", description: "look around", tool_use_id: "k3" });
    await world.clock.advance(RUN_MS);

    await $.turn.complete(completion(SHORT_ANSWER));

    const call = lastCallWrite(world, "k3");
    const entry = lastActivityWrite(world, "k3");
    expect(call?.ms).toBe(RUN_MS);
    expect(entry?.ms).toBe(RUN_MS);
    expect(call !== undefined && "output" in call).toBe(false);
  });

  test("K4 Details of a kept main Bash call shows its command and its stdout from the session, with the kept duration", async ($, on) => {
    const world = worldOf(on, CALL_MS);
    world.outcomes.set("k4", bashOk(LIVE_OUT));
    world.feed.hold(bashUse("k4", COMMAND, SESSION_OUT));
    await callTool($, { tool: "Bash", command: COMMAND, tool_use_id: "k4" });

    const text = await detailTextOf(await mountPane($), "k4");

    expect(text).toContain(COMMAND);
    expect(text).toContain(SESSION_OUT);
    expect(text).toContain(`${CALL_MS}ms`);
  });

  test("K5 Details of a kept agent Bash call shows the output from that agent's messages", async ($, on) => {
    const world = worldOf(on);
    world.outcomes.set("k5", bashOk(LIVE_OUT));
    world.feed.hold(bashUse("k5", COMMAND, SESSION_OUT), AGENT);
    await callTool($, { tool: "Bash", command: COMMAND, tool_use_id: "k5", agentId: AGENT });
    await world.clock.advance(BATCH_MS);

    const text = await detailTextOf(await mountPane($), "k5");

    expect(text).toContain(COMMAND);
    expect(text).toContain(SESSION_OUT);
  });

  test("K6 Details of an async Agent call that reported shows the answer from the task notification", async ($, on) => {
    const world = worldOf(on);
    world.outcomes.set("k6", asyncLaunch());
    world.feed.hold(agentUse("k6"));
    await callTool($, { tool: "Agent", description: "look around", tool_use_id: "k6" });
    world.feed.say(notificationOf("k6", NOTIFIED_ANSWER));
    await $.turn.complete(completion(SHORT_ANSWER));

    const text = await detailTextOf(await mountPane($), "k6");

    expect(text).toContain(NOTIFIED_ANSWER);
    expect(text).not.toContain("Async agent launched");
  });

  test("K6b Details of an async Agent call opened before the report shows the launch text, then the answer once the report comes", async ($, on) => {
    const world = worldOf(on);
    world.outcomes.set("k6b", asyncLaunch());
    world.feed.hold(agentUse("k6b"));
    await callTool($, { tool: "Agent", description: "look around", tool_use_id: "k6b" });
    const pane = await mountPane($);
    const waiting = await detailTextOf(pane, "k6b");

    world.feed.say(notificationOf("k6b", NOTIFIED_ANSWER));
    await $.turn.complete(completion(SHORT_ANSWER));

    const reported = textOf(await detailRoot(pane));
    expect(waiting).toContain("Async agent launched");
    expect(reported).toContain(NOTIFIED_ANSWER);
  });

  test("K7 Details of a kept main call the session no longer has shows tool, target, duration and no longer in the session", async ($, on) => {
    const world = worldOf(on, CALL_MS);
    world.outcomes.set("k7", bashOk(LIVE_OUT));
    world.feed.hold(bashUse("other", "ls", SESSION_OUT));
    await callTool($, { tool: "Bash", command: COMMAND, tool_use_id: "k7" });

    const text = await detailTextOf(await mountPane($), "k7");

    expect(text).toContain("Bash");
    expect(text).toContain(COMMAND);
    expect(text).toContain(`${CALL_MS}ms`);
    expect(text).toContain(GONE_LINE);
  });

  test("K7b Details of a kept agent call whose messages the session denies shows the same no longer in the session line", async ($, on) => {
    const world = worldOf(on, CALL_MS);
    world.outcomes.set("k7b", bashOk(LIVE_OUT));
    await callTool($, { tool: "Bash", command: COMMAND, tool_use_id: "k7b", agentId: AGENT });
    await world.clock.advance(BATCH_MS);

    const text = await detailTextOf(await mountPane($), "k7b");

    expect(text).toContain(COMMAND);
    expect(text).toContain(GONE_LINE);
  });

  test("K8 opening Details and redrawing five times reads the session once", async ($, on) => {
    const world = worldOf(on);
    world.outcomes.set("k8", bashOk(LIVE_OUT));
    world.feed.hold(bashUse("k8", COMMAND, SESSION_OUT));
    await callTool($, { tool: "Bash", command: COMMAND, tool_use_id: "k8" });
    const pane = await mountPane($);
    world.feed.forgetReads();

    await pane.press({ key: "call-k8" });
    await settle(pane);

    expect(world.feed.reads()).toBe(1);
  });

  test("K9 Details opened on a running Bash call shows its output when the result row reaches the session after the tool.call hook returned, with no second press", async ($, on) => {
    const world = worldOf(on);
    let finish: () => void = () => undefined;
    world.gates.set("k9", new Promise<void>((resolve) => (finish = resolve)));
    world.outcomes.set("k9", bashOk(LIVE_OUT));
    const call = { tool: "Bash", command: COMMAND, tool_use_id: "k9" };
    world.feed.hold(useOf(call, {}));
    await $.session.start({ cwd: CWD, surface: "terminal", isInteractive: true });
    const running = callTool($, call);
    await pressDetailsOnCard($, "k9");
    const pane = await mountPane($);

    finish();
    await running;
    await $.session.append(resultRow("k9", SESSION_OUT));
    world.feed.replace(bashUse("k9", COMMAND, SESSION_OUT));
    await world.clock.advance(0);
    await settle(pane);

    const text = textOf(await detailRoot(pane));
    expect(text).toContain(SESSION_OUT);
    expect(text).not.toContain(GONE_LINE);
  });

  test("K10 Details open on an async Agent call shows the answer when the task-notification row reaches the session after the agent's turn.complete returned", async ($, on) => {
    const world = worldOf(on);
    world.outcomes.set("k10", asyncLaunch());
    world.feed.hold(agentUse("k10"));
    await callTool($, { tool: "Agent", description: "look around", tool_use_id: "k10" });
    const pane = await mountPane($);
    await pane.press({ key: "call-k10" });

    await $.turn.complete(completion(SHORT_ANSWER));
    const notice = notificationOf("k10", NOTIFIED_ANSWER);
    await $.session.append({
      message: { type: "user", role: "user", content: [{ type: "text", text: notice.text }] },
      door: "queue",
      origin: { kind: "engine" },
      uuid: "notice-k10",
    });
    world.feed.say(notice);
    await world.clock.advance(0);
    await settle(pane);

    expect(textOf(await detailRoot(pane))).toContain(NOTIFIED_ANSWER);
  });

  test("K11 after an update a call the previous version saved is no longer listed, and later saves keep none of its output", async ($, on) => {
    const world = worldOf(on);
    on("state.get", (_$, e, next) =>
      e.key === "calls" && world.writes.every((write) => write.key !== "calls")
        ? { value: { value: [legacyRecord("old1")], version: 0 } }
        : next(e),
    );

    await callTool($, { tool: "Bash", command: COMMAND, tool_use_id: "new1" });
    const pane = await mountPane($);

    expect(JSON.stringify(world.writes.filter((write) => write.key === "calls"))).not.toContain(
      OLD_OUTPUT,
    );
    expect(await callKeysOf(pane)).not.toContain("call-old1");
  });

  test("K12 an Agent call that is the 400th newest still opens its Details from the agent's transcript and shows the answer", async ($, on) => {
    const world = worldOf(on);
    world.feed.hold(answerUse("k12", SUBAGENT_ANSWER), AGENT);
    seedCalls(on, [agentRecord("k12"), ...slimRows(NEWER_CALLS - 1, "k12-")]);
    await callTool($, { tool: "Bash", command: "echo newest", tool_use_id: "k12-newest" });
    const pane = await mountPane($);
    await pane.input({ key: "filter", text: "Agent", kind: "change" });
    await settle(pane);

    expect(await callKeysOf(pane)).toContain("call-k12");
    await pane.press({ key: "call-k12" });
    const text = textOf(await detailRoot(pane));

    expect(text).toContain(SUBAGENT_ANSWER);
    expect(text).not.toContain(GONE_LINE);
  });
});

function worldOf(on: On, callMs = 0): World {
  const clock = mock.clock(on, { now: NOW });
  const outcomes = new Map<string, Outcome>();
  const writes: World["writes"] = [];
  const gates = new Map<string, Promise<void>>();
  const feed = feedSession(on);
  mock.env(on, { HOME: "/h/u" });
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("fs.exists", () => ({ value: true }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: CWD }));
  on("command.register", () => ({ value: {} }) as never);
  on("settings.read", () => ({ value: {} }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("ui.panes", () => ({
    value: [{ id: "session", title: "Session", isShown: true, isFocused: false, isPlaced: true }],
  }));
  on("agent.list", () => ({ value: [] }));
  on("turn.complete", (_$, e) => ({ text: e.answer }));
  on("state.set", (_$, e, next) => {
    writes.push({ key: e.key, value: e.value });
    return next(e);
  });
  on("tool.call", async (_$, e) => {
    const id = (e as unknown as { tool_use_id: string }).tool_use_id;
    await gates.get(id);
    if (callMs > 0) await clock.advance(callMs);
    return (outcomes.get(id) ?? outcomes.get("*") ?? bashOk("ok")) as never;
  });
  return { clock, feed, outcomes, writes, gates };
}

function bashOk(stdout: string): Outcome {
  return { result: { stdout, stderr: "", interrupted: false }, text: stdout };
}

function bashUse(id: string, command: string, stdout: string): ToolUseSummary {
  return {
    tool_use_id: id,
    tool: "Bash",
    input: { command },
    result: { stdout, stderr: "", interrupted: false },
    text: stdout,
  };
}

async function pressDetailsOnCard($: Engine, id: string): Promise<void> {
  const card = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "ToolUse",
    props: {
      tool_use_id: id,
      tool: "Bash",
      input: { command: COMMAND },
      isRunning: true,
      isErrored: false,
      isInterrupted: false,
    },
    viewport: { columns: COLUMNS, rows: PANE_ROWS },
  });
  const [details] = (await card.findAll({ type: "Button" })).filter(
    (button) => button.props.label === "Details",
  );
  await card.press({ key: details?.key ?? "" });
}

function resultRow(toolUseId: string, content: string) {
  return {
    message: {
      type: "user",
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUseId, content }],
    },
    door: "tool-result",
    origin: { kind: "engine" },
    uuid: `result-${toolUseId}`,
  } as never;
}

function agentUse(id: string): ToolUseSummary {
  return {
    tool_use_id: id,
    tool: "Agent",
    input: { description: "look around" },
    result: asyncLaunch().result,
    text: LAUNCH_TEXT,
  };
}

function asyncLaunch(): Outcome {
  return {
    result: {
      status: "async_launched",
      isAsync: true,
      agentId: SPAWNED,
      description: "look around",
      prompt: "look around",
      outputFile: `${CWD}/${SPAWNED}.output`,
    },
    text: LAUNCH_TEXT,
  };
}

function completion(answer: string): never {
  return {
    answer,
    durationMs: RUN_MS,
    isAborted: false,
    turnId: `turn-${SPAWNED}`,
    agentId: SPAWNED,
    reason: "answer",
  } as never;
}

function numbered(count: number, prefix: string): string {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i}`).join("\n");
}

function longCommand(index: number): string {
  return [`build step ${index}`, ...numbered(COMMAND_LINES - 1, "echo line").split("\n")].join(
    "\n",
  );
}

function isBodyField(name: string): boolean {
  return BODY_FIELDS.includes(name);
}

function callTool($: Engine, call: object): Promise<unknown> {
  return ($.tool.call as (e: object) => Promise<unknown>)(call);
}

function callWrites(world: World): CallRecord[][] {
  return world.writes
    .filter((write) => write.key === "calls")
    .map((write) => (write.value as Shaped<CallRecord[]>).value);
}

function seedCalls(on: On, rows: CallRecord[]): void {
  on("state.get", async (_$, e, next) => {
    if (e.key !== "calls") return next(e);
    const { value: stored } = await next(e);
    return {
      value: {
        value: stored?.value ?? { shape: "calls-slim", value: rows },
        version: stored?.version ?? 0,
      },
    };
  });
}

function slimRows(count: number, prefix: string): CallRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i}`,
    tool: "Bash",
    target: `echo ${i}`,
    ms: CALL_MS,
    isErrored: false,
    added: 0,
    removed: 0,
  }));
}

function agentRecord(id: string): CallRecord {
  return {
    id,
    tool: "Agent",
    target: "look around",
    ms: CALL_MS,
    isErrored: false,
    added: 0,
    removed: 0,
    agentId: AGENT,
  };
}

function legacyRecord(id: string): Record<string, unknown> {
  return {
    id,
    tool: "Bash",
    target: COMMAND,
    ms: CALL_MS,
    isErrored: false,
    added: 0,
    removed: 0,
    input: OLD_INPUT,
    fields: [],
    output: OLD_OUTPUT,
  };
}

function answerUse(id: string, answer: string): ToolUseSummary {
  return { tool_use_id: id, tool: "Agent", input: { description: "look around" }, text: answer };
}

async function callKeysOf(pane: Pane): Promise<string[]> {
  return (await pane.findAll({ type: "Button" }))
    .map((button) => String(button.key))
    .filter((key) => key.startsWith("call-"));
}

function lastCallWrite(world: World, id: string): CallRecord | undefined {
  return callWrites(world)
    .at(-1)
    ?.find((record) => record.id === id);
}

function lastActivityWrite(world: World, id: string): Activity | undefined {
  const lists = world.writes
    .filter((write) => write.key === "activity")
    .map((write) => write.value as Activity[]);
  return lists.at(-1)?.find((entry) => entry.id === id);
}

function mountPane($: Engine): Promise<Pane> {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: "session",
    props: {
      title: "Session",
      isFocused: false,
      bodyColumns: COLUMNS,
      placement: "dock",
      scroll: { offset: 0, bodyRows: PANE_ROWS },
      view: {},
    },
    viewport: { columns: COLUMNS, rows: PANE_ROWS },
  });
}

async function detailRoot(pane: Pane): Promise<never> {
  return (await pane.drawn()) as never;
}

async function detailTextOf(pane: Pane, callId: string): Promise<string> {
  await pane.press({ key: `call-${callId}` });
  return textOf(await detailRoot(pane));
}
