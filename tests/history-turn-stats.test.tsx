import { describe, expect, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

import { OPUS, SUBSCRIPTION, callTool, mainTurn, startFreshSession, worldOf } from "./spend-world";
import type { ToolSpec, World } from "./spend-world";

type StoredEntry = {
  kind: string;
  id: string;
  tools?: number;
  failed?: number;
  ms?: number;
};
type Prompt = { id: string; text: string };
type Turn = { prompt?: Prompt; calls: ToolSpec[]; durationMs: number };

const HISTORY_STATE = "paneline.history.";
const PROGRESS_TOOL = "mcp__paneline__progress";
const COMPOSER = { kind: "composer" };
const TURN_OUTPUT_TOKENS = 10;
const TURN_CONTEXT_TOKENS = 1000;
const STEP_MS = 1000;
const SLOW_TURN_MS = 4200;
const QUICK_TURN_MS = 2500;
const FIRST_TURN_MS = 1000;
const SECOND_TURN_MS = 3000;
const WAKE_UP_TURN_MS = 2000;
const READ: ToolSpec = {
  tool: "Read",
  input: { file_path: "/work/a.ts" },
  reply: { text: "export const a = 1;" },
};
const FAILING_EDIT: ToolSpec = {
  tool: "Edit",
  input: { file_path: "/work/src/file.ts", old_string: "a", new_string: "b" },
  reply: { text: "old_string not found in file", isError: true },
};
const BASH_OK: ToolSpec = {
  tool: "Bash",
  input: { command: "npm test" },
  reply: { text: "all tests pass" },
};
const DENIED_BASH: ToolSpec = {
  tool: "Bash",
  input: { command: "rm -rf build" },
  reply: { deny: "Blocked by project hook" },
};
const PROGRESS_CALL: ToolSpec = {
  tool: PROGRESS_TOOL,
  input: { percent: 40 },
  reply: { text: "ok" },
};

describe("history-turn-stats", () => {
  test("T1 a turn with three tool calls, one failing, shows its tools, failures and time on its prompt", async ($, on) => {
    const world = statsWorld(on);
    await startFreshSession($, world);

    await runTurn($, world, {
      prompt: { id: "p1", text: "fix the parser" },
      calls: [READ, FAILING_EDIT, BASH_OK],
      durationMs: SLOW_TURN_MS,
    });

    expect(promptEntry(world, "p1")).toMatchObject({
      tools: 3,
      failed: 1,
      ms: SLOW_TURN_MS,
    });
  });

  test("T2 a turn with no tool calls shows zero tools, zero failures and its time on its prompt", async ($, on) => {
    const world = statsWorld(on);
    await startFreshSession($, world);

    await runTurn($, world, {
      prompt: { id: "p2", text: "explain the diff" },
      calls: [],
      durationMs: QUICK_TURN_MS,
    });

    expect(promptEntry(world, "p2")).toMatchObject({ tools: 0, failed: 0, ms: QUICK_TURN_MS });
  });

  test("T3 two prompts in separate turns each keep only their own tools, failures and time", async ($, on) => {
    const world = statsWorld(on);
    await startFreshSession($, world);

    await runTurn($, world, {
      prompt: { id: "p3", text: "run the tests" },
      calls: [BASH_OK, READ],
      durationMs: FIRST_TURN_MS,
    });
    await runTurn($, world, {
      prompt: { id: "p4", text: "open the log" },
      calls: [READ],
      durationMs: SECOND_TURN_MS,
    });

    expect(promptStats(world)).toEqual([
      { id: "p3", tools: 2, failed: 0, ms: FIRST_TURN_MS },
      { id: "p4", tools: 1, failed: 0, ms: SECOND_TURN_MS },
    ]);
  });

  test("T4 a wake-up turn with no new prompt adds its calls and time to the last prompt", async ($, on) => {
    const world = statsWorld(on);
    await startFreshSession($, world);

    await runTurn($, world, {
      prompt: { id: "p5", text: "start the build" },
      calls: [READ],
      durationMs: FIRST_TURN_MS,
    });
    await runTurn($, world, {
      calls: [BASH_OK, READ],
      durationMs: WAKE_UP_TURN_MS,
    });

    expect(promptStats(world)).toEqual([
      { id: "p5", tools: 3, failed: 0, ms: FIRST_TURN_MS + WAKE_UP_TURN_MS },
    ]);
  });

  test("T5 the progress tool is not counted among a turn's tools", async ($, on) => {
    const world = statsWorld(on);
    await startFreshSession($, world);

    await runTurn($, world, {
      prompt: { id: "p6", text: "report how far along you are" },
      calls: [PROGRESS_CALL, READ],
      durationMs: QUICK_TURN_MS,
    });

    expect(promptEntry(world, "p6")).toMatchObject({ tools: 1 });
  });

  test("T6 a denied tool call counts as a failure on its prompt", async ($, on) => {
    const world = statsWorld(on);
    await startFreshSession($, world);

    await runTurn($, world, {
      prompt: { id: "p7", text: "clean the build folder" },
      calls: [DENIED_BASH, READ],
      durationMs: QUICK_TURN_MS,
    });

    expect(promptEntry(world, "p7")).toMatchObject({ tools: 2, failed: 1 });
  });
});

function statsWorld(on: On): World {
  const world = worldOf(on, SUBSCRIPTION);
  on("turn.start", (_$, e) => ({ turnId: e.turnId }));
  return world;
}

async function runTurn($: Engine, world: World, turn: Turn): Promise<void> {
  if (turn.prompt !== undefined) await appendPrompt($, world, turn.prompt);
  await $.turn.start({
    text: turn.prompt?.text ?? "",
    turnId: `turn-${turn.prompt?.id ?? "wake-up"}`,
  });
  for (const call of turn.calls) await callTool($, world, call);
  await mainTurn($, world, {
    model: OPUS,
    tokens: { output: TURN_OUTPUT_TOKENS },
    context: TURN_CONTEXT_TOKENS,
    durationMs: turn.durationMs,
  });
}

async function appendPrompt($: Engine, world: World, prompt: Prompt): Promise<void> {
  await $.session.append({
    message: { type: "user", content: [{ type: "text", text: prompt.text }] },
    door: "prompt",
    origin: COMPOSER,
    uuid: prompt.id,
  } as never);
  await world.clock.advance(STEP_MS);
}

function storedEntries(world: World): StoredEntry[] {
  return (world.state.get(HISTORY_STATE)?.value ?? []) as StoredEntry[];
}

function promptEntry(world: World, id: string): StoredEntry | undefined {
  return storedEntries(world).find((entry) => entry.kind === "prompt" && entry.id === id);
}

function promptStats(world: World): Omit<StoredEntry, "kind">[] {
  return storedEntries(world)
    .filter((entry) => entry.kind === "prompt")
    .map(({ id, tools, failed, ms }) => ({ id, tools, failed, ms }));
}
