import { describe, expect, test } from "claude-code/testing";
import type { ToolCheckResult } from "claude-code";
import type { Engine } from "claude-code/testing";

import {
  FAILING_COMMAND,
  FLUSH_MS,
  paneOnTab,
  runCommand,
  spawnAgent,
  texts,
  worldOf,
} from "./clear-world";
import type { Pane } from "./clear-world";
import { failingEdit, failedEditWorldOf } from "./failed-edit-world";

const FIVE = 5;
const SEVEN = 7;
const OLD_FAILED = 3;
const OK_CALLS = 50;
const SUBAGENT_CALL_ID = "sub-fail";
const REFUSED_COMMAND = "rm -r build";
const DENY_RULE = "Bash(rm:*)";
const REFUSED_IDS = ["refused-0", "refused-1"];
const SIX = 6;
const NEWEST_FAILED_KEYS = [
  "failed-fail-5",
  "failed-fail-4",
  "failed-fail-3",
  "failed-fail-2",
  "failed-fail-1",
];
const CHIP_LINE = /^(?:\d+ms|\d+s|\d+m \d{2}s) · \d+ tools?/;
const ERROR_COUNT = /(\d+) errors?$/;
const MORE_LINE = /^▸ (\d+) more failed$/;

describe("activity header error count", () => {
  test("S1 a subagent's failed command shows as 1 error in the header and under Failed", async ($, on) => {
    const world = worldOf(on);
    const agent = await spawnAgent($, world, "explore");
    await failingCall($, SUBAGENT_CALL_ID, agent);
    await world.clock.advance(FLUSH_MS);
    await runCommand($, world, "echo ok");

    const pane = await paneOnTab($, "Activity");

    expect(await chipLineOf(pane)).toMatch(/ · 1 error$/);
    expect(await failedRowKeys(pane)).toEqual([`failed-${SUBAGENT_CALL_ID}`]);
  });

  test("S2 the header error count equals the failed rows shown plus the more line", async ($, on) => {
    failedEditWorldOf(on);
    await failMainCalls($, "old", OLD_FAILED);
    for (let i = 0; i < OK_CALLS; i++) await okCall($, `ok-${i}`);
    await failMainCalls($, "recent", 1);

    const pane = await paneOnTab($, "Activity");

    const shownFailed = (await failedRowKeys(pane)).length + (await moreCountOf(pane));
    expect(await headerErrorCount(pane)).toBe(shownFailed);
  });

  test("S3 seven failed calls show 7 errors, five failed rows and ▸ 2 more failed", async ($, on) => {
    failedEditWorldOf(on);
    await failMainCalls($, "f", SEVEN);

    const pane = await paneOnTab($, "Activity");

    expect(await chipLineOf(pane)).toMatch(/ · 7 errors$/);
    expect(await failedRowKeys(pane)).toHaveLength(FIVE);
    expect(await moreLineOf(pane)).toBe(`▸ ${SEVEN - FIVE} more failed`);
  });

  test("S4 six failed calls and two refused calls show five failed rows, ▸ 1 more failed, and 6 errors, with no refused call under Failed", async ($, on) => {
    failedEditWorldOf(on);
    on("tool.check", (_$, e) => verdictOf(e.input));
    await failMainCalls($, "fail", SIX);
    for (const id of REFUSED_IDS) await refusedCall($, id);

    const pane = await paneOnTab($, "Activity");

    expect(await headerErrorCount(pane)).toBe(SIX);
    expect(await failedRowKeys(pane)).toEqual(NEWEST_FAILED_KEYS);
    expect(await moreLineOf(pane)).toBe(`▸ ${SIX - FIVE} more failed`);
  });
});

function failingCall($: Engine, id: string, agentId?: string): Promise<unknown> {
  return $.tool.call({
    tool: "Bash",
    command: FAILING_COMMAND,
    tool_use_id: id,
    ...(agentId === undefined ? {} : { agentId }),
  } as never);
}

async function failMainCalls($: Engine, prefix: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++)
    await failingEdit($, `${prefix}-${i}`, `/work/src/${prefix}-${i}.ts`);
}

async function okCall($: Engine, id: string): Promise<void> {
  await $.tool.call({ tool: "Bash", command: "echo ok", tool_use_id: id } as never);
}

function refusedCall($: Engine, id: string): Promise<unknown> {
  return $.tool.call({ tool: "Bash", command: REFUSED_COMMAND, tool_use_id: id } as never);
}

function verdictOf(input: unknown): ToolCheckResult {
  const { command } = input as { command?: string };
  return command === REFUSED_COMMAND
    ? { decision: "deny", rule: DENY_RULE }
    : { decision: "allow" };
}

async function chipLineOf(pane: Pane): Promise<string> {
  return (await texts(pane)).find((text) => CHIP_LINE.test(text)) ?? "";
}

async function headerErrorCount(pane: Pane): Promise<number> {
  return Number(ERROR_COUNT.exec(await chipLineOf(pane))?.[1]);
}

async function moreLineOf(pane: Pane): Promise<string> {
  const labels = (await pane.findAll({ type: "Button" })).map((button) =>
    String(button.props.label),
  );
  return labels.find((label) => MORE_LINE.test(label)) ?? "";
}

async function moreCountOf(pane: Pane): Promise<number> {
  const line = await moreLineOf(pane);
  return line === "" ? 0 : Number(MORE_LINE.exec(line)?.[1]);
}

async function failedRowKeys(pane: Pane): Promise<string[]> {
  return (await pane.findAll({ type: "Button" }))
    .map((button) => String(button.key))
    .filter((key) => key.startsWith("failed-"));
}
