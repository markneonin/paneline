import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";
import type { On, SessionMessage } from "claude-code";

import {
  FAILING_COMMAND,
  FLUSH_MS,
  paneOnTab,
  pressClear,
  readFile,
  runCommand,
  spawnAgent,
  texts,
  worldOf,
} from "./clear-world";
import type { World } from "./clear-world";

const SLOW_TEST_MS = 30_000;
const PAST_KEPT = 410;
const READS = 300;
const BASHES = 150;
const HALF = PAST_KEPT / 2;
const CLEAR_TAIL = 3;
const SESSION_START = { cwd: "/work", surface: "terminal", isInteractive: true } as const;
const STATS_LINE = /^(?:\d+ms|\d+s|\d+m \d{2}s) · \d+ tools?(?: · |$)/;
const TOOL_COUNT = /(\d+) tools?(?: · |$)/;
const ERROR_COUNT = /(\d+) errors?$/;
const LEGEND_PART = /● (\w+) (\d+)/g;

describe("activity counts past the kept calls", () => {
  test(
    "C1 410 main Bash commands show 410 tools in the header",
    { timeoutMs: SLOW_TEST_MS },
    async ($, on) => {
      const world = worldOf(on);
      await runCommands($, world, PAST_KEPT);

      const pane = await paneOnTab($, "Activity");

      expect(toolCountOf(await texts(pane))).toBe(PAST_KEPT);
    },
  );

  test(
    "C2 300 Read calls then 150 Bash commands show Read 300 and Bash 150 in the Tool mix",
    { timeoutMs: SLOW_TEST_MS },
    async ($, on) => {
      const world = worldOf(on);
      await readFiles($, world, READS);
      await runCommands($, world, BASHES);

      const pane = await paneOnTab($, "Activity");

      expect(legendOf(await texts(pane))).toEqual(["Read 300", "Bash 150"]);
    },
  );

  test(
    "C3 one failed command then 410 Read calls show 1 error in the header",
    { timeoutMs: SLOW_TEST_MS },
    async ($, on) => {
      const world = worldOf(on);
      await runCommand($, world, FAILING_COMMAND);
      await readFiles($, world, PAST_KEPT);

      const pane = await paneOnTab($, "Activity");

      expect(errorCountOf(await texts(pane))).toBe(1);
    },
  );

  test(
    "C4 after 410 calls and a clear, 3 Bash commands show 3 tools and only Bash in the Tool mix",
    { timeoutMs: SLOW_TEST_MS },
    async ($, on) => {
      const world = worldOf(on);
      await readFiles($, world, PAST_KEPT);
      const pane = await paneOnTab($, "Activity");
      await pressClear(pane, world);

      await runCommands($, world, CLEAR_TAIL);

      const shown = await texts(pane);
      expect(toolCountOf(shown)).toBe(CLEAR_TAIL);
      expect(legendOf(shown)).toEqual([`Bash ${CLEAR_TAIL}`]);
    },
  );

  test(
    "C5 410 subagent Bash commands in two batches show 410 tools in the header",
    { timeoutMs: SLOW_TEST_MS },
    async ($, on) => {
      const world = worldOf(on);
      const agent = await spawnAgent($, world, "explore");
      await runAgentCommands($, agent, HALF, "first");
      await world.clock.advance(FLUSH_MS);
      await runAgentCommands($, agent, HALF, "second");
      await world.clock.advance(FLUSH_MS);

      const pane = await paneOnTab($, "Activity");

      expect(toolCountOf(await texts(pane))).toBe(PAST_KEPT);
    },
  );

  test(
    "C6 after a reload, 409 Read calls and one failing command still show 410 tools and 1 error",
    { timeoutMs: SLOW_TEST_MS },
    async ($, on) => {
      answerHost(on);
      const world = worldOf(on);
      await readFiles($, world, PAST_KEPT - 1);
      await runCommand($, world, FAILING_COMMAND);
      await reload($, world);

      const shown = await texts(await paneOnTab($, "Activity"));

      expect(toolCountOf(shown)).toBe(PAST_KEPT);
      expect(errorCountOf(shown)).toBe(1);
    },
  );
});

async function runCommands($: Engine, world: World, count: number): Promise<void> {
  for (let i = 0; i < count; i++) await runCommand($, world, `echo ${i}`);
}

async function readFiles($: Engine, world: World, count: number): Promise<void> {
  for (let i = 0; i < count; i++) await readFile($, world, "/work/a.ts");
}

async function runAgentCommands(
  $: Engine,
  agentId: string,
  count: number,
  word: string,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await callTool($, {
      tool: "Bash",
      command: `echo ${word} ${i}`,
      tool_use_id: `${word}-${i}`,
      agentId,
    });
  }
}

function answerHost(on: On): void {
  on("config.list", () => ({ value: [{ key: "theme", value: "dark" }] }) as never);
  on("command.register", () => ({ value: {} }) as never);
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("session.messages", () => ({ value: [] as SessionMessage[] }));
}

async function reload($: Engine, world: World): Promise<void> {
  await $.session.start(SESSION_START);
  await world.clock.advance(FLUSH_MS);
}

function callTool($: Engine, call: object): Promise<unknown> {
  return ($.tool.call as (e: object) => Promise<unknown>)(call);
}

function statsOf(shown: string[]): string {
  return shown.find((text) => STATS_LINE.test(text)) ?? "";
}

function toolCountOf(shown: string[]): number {
  return Number(TOOL_COUNT.exec(statsOf(shown))?.[1]);
}

function errorCountOf(shown: string[]): number {
  return Number(ERROR_COUNT.exec(statsOf(shown))?.[1]);
}

function legendOf(shown: string[]): string[] {
  return shown.flatMap((text) => [...text.matchAll(LEGEND_PART)].map((m) => `${m[1]} ${m[2]}`));
}
