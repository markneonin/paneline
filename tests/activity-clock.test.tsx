import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, MockClock } from "claude-code/testing";

import { paneOnTab, settle } from "./clear-world";
import { feedSession } from "./session-feed";
import type { SessionFeed } from "./session-feed";

type World = {
  clock: MockClock;
  feed: SessionFeed;
  runMs: number;
  writes: { key: string; value: unknown }[];
  arrivals: Map<string, () => void>;
};
type Started = { arrived: Promise<void>; done: Promise<unknown> };
type Shaped<T> = { value: T };
type KeptCall = { id: string; startedAt?: number };
type LiveCall = { callId: string; startedAt?: number };
type Lookup = { id: string; call?: { startedAt?: number } } | null;

const SECOND = 1_000;
const NOW = 200_000;
const HOME = "/h/u";
const WORK = "/work";
const SESSION_ID = "session-one";
const SHORT_RUN_MS = 2 * SECOND;
const LONG_RUN_MS = 5 * SECOND;
const HUNG_RUN_MS = 60 * SECOND;
const SUBAGENT_FLUSH_MS = 5 * SECOND;
const SUBAGENT = "agent-1";
const MAIN_ID = "main-call";
const SUBAGENT_CALL_ID = "agent-call";
const OUTCOME = { result: "ok", text: "ok" };

describe("activity clock", () => {
  test("K1 a main call keeps the time it started, read from the clock", async ($, on) => {
    const world = worldOf(on, SHORT_RUN_MS);
    const run = startCall($, world, bashCall(MAIN_ID));

    await run.arrived;
    await world.clock.advance(SHORT_RUN_MS);
    await run.done;

    expect(keptIds(world)).toContain(MAIN_ID);
    expect(keptCalls(world).find((call) => call.id === MAIN_ID)?.startedAt).toBe(NOW);
  });

  test("K2 a call an agent makes keeps the time it started, read from the clock", async ($, on) => {
    const world = worldOf(on, SHORT_RUN_MS);
    const run = startCall($, world, bashCall(SUBAGENT_CALL_ID, SUBAGENT));

    await run.arrived;
    await world.clock.advance(SHORT_RUN_MS);
    await run.done;
    await world.clock.advance(SUBAGENT_FLUSH_MS);

    expect(keptIds(world)).toContain(SUBAGENT_CALL_ID);
    expect(keptCalls(world).find((call) => call.id === SUBAGENT_CALL_ID)?.startedAt).toBe(NOW);
  });

  test("K3 a running main call shows its start time as the first tick, then ticks each second until it ends", async ($, on) => {
    const world = worldOf(on, LONG_RUN_MS);
    const run = startCall($, world, bashCall(MAIN_ID));

    await run.arrived;
    const atStart = ticksOf(world);
    await world.clock.advance(SECOND);
    await world.clock.advance(SECOND);
    const whileRunning = ticksOf(world);
    await world.clock.advance(LONG_RUN_MS - 2 * SECOND);
    await run.done;
    const atEnd = ticksOf(world);
    await world.clock.advance(3 * SECOND);

    expect(atStart).toEqual([NOW]);
    expect(whileRunning).toEqual([NOW, NOW + SECOND, NOW + 2 * SECOND]);
    expect(ticksOf(world)).toEqual(atEnd);
  });

  test("K4 a call opened from the Timeline shows the start time it kept when it ran", async ($, on) => {
    const world = worldOf(on, SHORT_RUN_MS);
    const run = startCall($, world, bashCall(MAIN_ID));
    await run.arrived;
    await world.clock.advance(SHORT_RUN_MS);
    await run.done;

    const pane = await paneOnTab($, "Activity");
    await pane.press({ key: `call-${MAIN_ID}` });
    await settle(pane);

    expect(openedCallOf(world)?.id).toBe(MAIN_ID);
    expect(openedCallOf(world)?.call?.startedAt).toBe(NOW);
  });

  test("K5 a running main call is listed as running with its start time, and leaves the list when it ends", async ($, on) => {
    const world = worldOf(on, LONG_RUN_MS);
    const run = startCall($, world, bashCall(MAIN_ID));

    await run.arrived;
    const listed = runningOf(world);
    await world.clock.advance(LONG_RUN_MS);
    await run.done;

    expect(listed.map((call) => call.callId)).toEqual([MAIN_ID]);
    expect(listed.map((call) => call.startedAt)).toEqual([NOW]);
    expect(runningOf(world)).toEqual([]);
  });

  test("K6 a running main call stops ticking once its turn is interrupted with no tool result", async ($, on) => {
    const world = worldOf(on, HUNG_RUN_MS);
    const run = startCall($, world, bashCall(MAIN_ID));

    await run.arrived;
    await world.clock.advance(2 * SECOND);
    await $.turn.complete({
      answer: "",
      durationMs: 2 * SECOND,
      isAborted: true,
      turnId: "turn-1",
      reason: "interrupt",
    } as never);
    const atStop = ticksOf(world);
    await world.clock.advance(5 * SECOND);

    expect(ticksOf(world)).toEqual(atStop);
    await world.clock.advance(HUNG_RUN_MS);
    await run.done;
  });
});

function worldOf(on: On, runMs: number): World {
  const clock = mock.clock(on, { now: NOW });
  mock.env(on, { HOME });
  const values = new Map<string, { value: unknown; version: number }>();
  const world: World = {
    clock,
    feed: feedSession(on),
    runMs,
    writes: [],
    arrivals: new Map(),
  };
  on("state.get", (_$, e) => ({ value: values.get(e.key) ?? { value: undefined, version: 0 } }));
  on("state.set", (_$, e) => {
    const version = (values.get(e.key)?.version ?? 0) + 1;
    values.set(e.key, { value: e.value, version });
    world.writes.push({ key: e.key, value: e.value });
    return { value: { isSet: true, version } };
  });
  on("store.get", () => ({ value: undefined }));
  on("store.set", () => ({ value: undefined }));
  on("session.id", () => ({ value: SESSION_ID }));
  on("session.repo", () => ({ value: null }));
  on("session.root", () => ({ value: WORK }));
  on("session.cwd", () => ({ value: WORK }));
  on("session.model", () => ({ value: "opus" }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("settings.read", () => ({ value: {} }));
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", () => ({ value: true }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("classic.SessionStart", () => ({}));
  on("turn.complete", (_$, e) => ({ text: e.answer }));
  on("process.run", () => ({ value: { exitCode: 0, stdout: "", stderr: "" } }) as never);
  on("tool.call", async (_$, e) => {
    world.arrivals.get(e.tool_use_id)?.();
    await clock.sleep(world.runMs);
    return world.feed.record(e, OUTCOME) as never;
  });
  return world;
}

function bashCall(id: string, agentId?: string): object {
  return {
    tool: "Bash",
    command: `run ${id}`,
    tool_use_id: id,
    ...(agentId === undefined ? {} : { agentId }),
  };
}

function startCall($: Engine, world: World, call: object): Started {
  const id = (call as { tool_use_id: string }).tool_use_id;
  let arrive: () => void = () => undefined;
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  world.arrivals.set(id, arrive);
  const done = ($.tool.call as (e: object) => Promise<unknown>)(call);
  return { arrived, done };
}

function writesTo(world: World, key: string): unknown[] {
  return world.writes.filter((write) => write.key === key).map((write) => write.value);
}

function keptCalls(world: World): KeptCall[] {
  const latest = writesTo(world, "calls").at(-1) as Shaped<KeptCall[]> | undefined;
  return latest?.value ?? [];
}

function keptIds(world: World): string[] {
  return keptCalls(world).map((call) => call.id);
}

function ticksOf(world: World): number[] {
  return writesTo(world, "waitTick") as number[];
}

function runningOf(world: World): LiveCall[] {
  return (writesTo(world, "running").at(-1) as LiveCall[] | undefined) ?? [];
}

function openedCallOf(world: World): Lookup {
  return (writesTo(world, "callLookup").at(-1) as Lookup | undefined) ?? null;
}
