import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";

import {
  FAILING_COMMAND,
  editFile,
  finishAgent,
  paneOnTab,
  pressClear,
  readFile,
  runCommand,
  showTab,
  spawnAgent,
  spendTokens,
  texts,
  worldOf,
} from "./clear-world";
import type { Pane, World } from "./clear-world";

const SPEND = 1_000;
const AGENT_EDIT_BATCH_MS = 1_000;

describe("clear leaves the other tabs alone", () => {
  test("X1 pressing clear in Activity leaves Files with its files and counts and Agents with its subagents", async ($, on) => {
    const world = worldOf(on);
    await busySession($, world);
    const pane = await paneOnTab($, "Activity");
    const filesBefore = await tabTexts(pane, "Files");
    await showTab(pane, "Activity");

    await pressClear(pane, world);

    const filesAfter = await tabTexts(pane, "Files");
    const agentsAfter = await tabTexts(pane, "Agents");
    expect(filesBefore.some((text) => text.includes("b.ts +4 -1"))).toBe(true);
    expect(filesAfter).toEqual(filesBefore);
    expect(agentsAfter.some((text) => text.includes("alpha"))).toBe(true);
    expect(agentsAfter.some((text) => text.includes("bravo"))).toBe(true);
  });

  test("X2 pressing clear in Files leaves Activity with its calls and stats and Agents with its subagents", async ($, on) => {
    const world = worldOf(on);
    await busySession($, world);
    const pane = await paneOnTab($, "Activity");
    const activityBefore = await texts(pane);
    await showTab(pane, "Files");

    await pressClear(pane, world);

    const activityAfter = await tabTexts(pane, "Activity");
    const agentsAfter = await tabTexts(pane, "Agents");
    expect(activityBefore.some((text) => text.includes("3 tools"))).toBe(true);
    expect(activityAfter).toEqual(activityBefore);
    expect(agentsAfter.some((text) => text.includes("alpha"))).toBe(true);
    expect(agentsAfter.some((text) => text.includes("bravo"))).toBe(true);
  });

  test("X3 pressing clear in Agents leaves Activity with its calls and stats and Files with its files and counts", async ($, on) => {
    const world = worldOf(on);
    await busySession($, world);
    const pane = await paneOnTab($, "Activity");
    const activityBefore = await texts(pane);
    const filesBefore = await tabTexts(pane, "Files");
    await showTab(pane, "Agents");

    await pressClear(pane, world);

    const activityAfter = await tabTexts(pane, "Activity");
    const filesAfter = await tabTexts(pane, "Files");
    expect(filesBefore.some((text) => text.includes("z.ts +3 -2"))).toBe(true);
    expect(activityAfter).toEqual(activityBefore);
    expect(filesAfter).toEqual(filesBefore);
  });

  test("X4 after the press a tab is still cleared when the owner comes back to it from another tab", async ($, on) => {
    const world = worldOf(on);
    await busySession($, world);
    const pane = await paneOnTab($, "Activity");
    await pressClear(pane, world);
    await showTab(pane, "Files");
    await pressClear(pane, world);
    await showTab(pane, "Agents");
    await pressClear(pane, world);

    const activity = await tabTexts(pane, "Activity");
    const files = await tabTexts(pane, "Files");
    const agents = await tabTexts(pane, "Agents");

    expect(activity).toContain("no calls yet");
    expect(files).toContain("No files touched yet.");
    expect(agents.some((text) => text.includes("bravo"))).toBe(false);
  });

  test("X5 after clearing Agents, Files still names the finished agent that made each listed edit", async ($, on) => {
    const world = worldOf(on);
    const running = await spawnAgent($, world, "alpha");
    const finished = await spawnAgent($, world, "bravo");
    await editFile($, world, "/work/a.ts", 3, 2, running);
    await editFile($, world, "/work/b.ts", 5, 1, finished);
    await world.clock.advance(AGENT_EDIT_BATCH_MS);
    await finishAgent($, world, finished);
    const pane = await paneOnTab($, "Agents");
    const filesBefore = await tabTexts(pane, "Files");
    await showTab(pane, "Agents");

    await pressClear(pane, world);

    const filesAfter = await tabTexts(pane, "Files");
    expect(filesBefore.some((text) => text.includes("bravo 1 file +5 -1"))).toBe(true);
    expect(filesAfter.some((text) => text.includes("bravo 1 file +5 -1"))).toBe(true);
    expect(filesAfter.some((text) => text.includes("alpha 1 file +3 -2"))).toBe(true);
  });
});

async function busySession($: Engine, world: World): Promise<void> {
  await readFile($, world, "/work/a.ts");
  await editFile($, world, "/work/b.ts", 4, 1);
  await runCommand($, world, FAILING_COMMAND);
  const running = await spawnAgent($, world, "alpha");
  const finished = await spawnAgent($, world, "bravo");
  await spendTokens($, world, finished, SPEND);
  await finishAgent($, world, finished);
  await editFile($, world, "/work/z.ts", 3, 2, running);
  await world.clock.advance(AGENT_EDIT_BATCH_MS);
}

async function tabTexts(pane: Pane, label: string): Promise<string[]> {
  await showTab(pane, label);
  return texts(pane);
}
