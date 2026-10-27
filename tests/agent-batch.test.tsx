import { describe, expect, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

import type { AgentEdit, CallRecord } from "../types";
import {
  callRowKeys,
  editFile,
  paneOnTab,
  settle,
  spawnAgent,
  texts,
  worldOf as clearWorldOf,
} from "./clear-world";
import type { World } from "./clear-world";

type Write = { key: string; value: unknown };
type Batched = World & { writes: Write[] };

const BATCH_MS = 1_000;
const AGENT = "agent-1";
const KEPT_CALLS = 50;
const MANY = 60;

describe("agent calls and edits are written once per second", () => {
  test("B1 three agent calls within a second are written once, all three together", async ($, on) => {
    const world = batchedWorldOf(on);

    await agentCall($, "Read", "r1");
    await agentCall($, "Read", "r2");
    await agentCall($, "Read", "r3");
    await world.clock.advance(BATCH_MS);

    expect(callWrites(world).map(idsOf)).toEqual([["r1", "r2", "r3"]]);
  });

  test("B2 three agent edits within a second are written once, all three together", async ($, on) => {
    const world = batchedWorldOf(on);

    await editFile($, world, "/work/a.ts", 1, 0, AGENT);
    await editFile($, world, "/work/b.ts", 2, 0, AGENT);
    await editFile($, world, "/work/c.ts", 3, 0, AGENT);
    await world.clock.advance(BATCH_MS);

    expect(editWrites(world).map(targetsOf)).toEqual([["/work/a.ts", "/work/b.ts", "/work/c.ts"]]);
  });

  test("B3 a main-session call is written at once, with the agent calls waiting before it", async ($, on) => {
    const world = batchedWorldOf(on);
    await agentCall($, "Read", "r1");
    await agentCall($, "Read", "r2");

    await mainCall($, "Bash", "m1");

    expect(callWrites(world).map(idsOf)).toEqual([["r1", "r2", "m1"]]);
    await world.clock.advance(BATCH_MS);
    expect(callWrites(world).map(idsOf)).toEqual([["r1", "r2", "m1"]]);
  });

  test("B4 a main-session call with no agent calls waiting is written at once, alone", async ($, on) => {
    const world = batchedWorldOf(on);

    await mainCall($, "Bash", "m1");

    expect(callWrites(world).map(idsOf)).toEqual([["m1"]]);
  });

  test("B5 an agent call shows in an open Activity tab within a second", async ($, on) => {
    const world = batchedWorldOf(on);
    const pane = await paneOnTab($, "Activity");

    await agentCall($, "Read", "r1");
    await world.clock.advance(BATCH_MS);
    await settle(pane);

    expect(await callRowKeys(pane)).toContain("call-r1");
  });

  test("B6 an agent edit shows in an open Files tab within a second, under the agent that made it", async ($, on) => {
    const world = batchedWorldOf(on);
    const agent = await spawnAgent($, world, "alpha");
    const pane = await paneOnTab($, "Files");

    await editFile($, world, "/work/a.ts", 3, 1, agent);
    await world.clock.advance(BATCH_MS);
    await settle(pane);

    const shown = await texts(pane);
    expect(shown.find((text) => text.includes("a.ts"))).toMatch(/a\.ts \+3 -1$/);
    expect(shown).toContain("alpha 1 file +3 -1");
  });

  test("B7 sixty agent calls within a second are written once and keep the last fifty", async ($, on) => {
    const world = batchedWorldOf(on);

    for (let i = 0; i < MANY; i++) await agentCall($, "Read", `r${i}`);
    await world.clock.advance(BATCH_MS);

    const written = callWrites(world);
    expect(written).toHaveLength(1);
    expect(idsOf(written[0] ?? [])).toEqual(
      Array.from({ length: KEPT_CALLS }, (_, i) => `r${MANY - KEPT_CALLS + i}`),
    );
  });

  test("B8 agent calls a second apart are written in two batches, the second keeping the first", async ($, on) => {
    const world = batchedWorldOf(on);

    await agentCall($, "Read", "r1");
    await world.clock.advance(BATCH_MS);
    await agentCall($, "Read", "r2");
    await world.clock.advance(BATCH_MS);

    expect(callWrites(world).map(idsOf)).toEqual([["r1"], ["r1", "r2"]]);
  });
});

function batchedWorldOf(on: On): Batched {
  const world = clearWorldOf(on) as Batched;
  world.writes = [];
  on("state.set", (_$, e, next) => {
    world.writes.push({ key: e.key, value: e.value });
    return next(e);
  });
  return world;
}

function agentCall($: Engine, tool: string, id: string): Promise<unknown> {
  return callOf($, { tool, file_path: `/work/${id}.ts`, tool_use_id: id, agentId: AGENT });
}

function mainCall($: Engine, tool: string, id: string): Promise<unknown> {
  return callOf($, { tool, command: id, tool_use_id: id });
}

function callOf($: Engine, call: object): Promise<unknown> {
  return ($.tool.call as (e: object) => Promise<unknown>)(call);
}

function callWrites(world: Batched): CallRecord[][] {
  return writtenUnder(world, "calls") as CallRecord[][];
}

function editWrites(world: Batched): AgentEdit[][] {
  return writtenUnder(world, "agentEdits") as AgentEdit[][];
}

function writtenUnder(world: Batched, key: string): unknown[] {
  return world.writes.filter((write) => write.key === key).map((write) => write.value);
}

function idsOf(calls: CallRecord[]): string[] {
  return calls.map((call) => call.id);
}

function targetsOf(edits: AgentEdit[]): string[] {
  return edits.map((edit) => edit.target);
}
