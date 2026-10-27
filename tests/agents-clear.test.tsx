import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";

import {
  FLUSH_MS,
  SHORT_ROWS,
  clearButtonsOf,
  editFile,
  finishAgent,
  headingLineOf,
  isDim,
  lines,
  paneOnTab,
  pressClear,
  setSessionCost,
  spawnAgent,
  spendTokens,
  texts,
  worldOf,
} from "./clear-world";
import type { World } from "./clear-world";

const MORE_DONE = /^… \d+ more done$/;
const FINISHED_AGENTS = 8;
const POLL_MS = 1_000;
const OLD_SPEND = 3_000;
const FRESH_SPEND = 800;
const SESSION_COST = 0.42;

describe("agents clear button", () => {
  test("G1 with subagents the first line ends with a dim clear button after the session cost", async ($, on) => {
    const world = worldOf(on);
    await setSessionCost($, world, SESSION_COST);
    await finishedAgent($, world, "alpha");

    const pane = await paneOnTab($, "Agents");

    const shown = await lines(pane);
    const first = headingLineOf(shown, "main");
    expect(clearButtonsOf(shown)).toHaveLength(1);
    expect(first?.parts.at(-1)).toBe(clearButtonsOf(shown)[0]);
    expect(first?.text).toMatch(/\$0\.42 clear$/);
    expect(clearButtonsOf(shown).every(isDim)).toBe(true);
  });

  test("G2 with no subagent or only a running one there is no clear button, it shows once one has finished and goes after the press", async ($, on) => {
    const world = worldOf(on);
    const pane = await paneOnTab($, "Agents");
    const withNone = clearButtonsOf(await lines(pane)).length;

    await spawnAgent($, world, "alpha");
    const withOnlyRunning = clearButtonsOf(await lines(pane)).length;
    await finishedAgent($, world, "bravo");
    const withFinished = clearButtonsOf(await lines(pane)).length;
    await pressClear(pane, world);
    const afterPress = clearButtonsOf(await lines(pane)).length;

    expect([withNone, withOnlyRunning, withFinished, afterPress]).toEqual([0, 0, 1, 0]);
  });

  test("G3 pressing clear removes every finished subagent card and the tab says no subagents yet", async ($, on) => {
    const world = worldOf(on);
    await finishedAgent($, world, "alpha");
    await finishedAgent($, world, "bravo");
    const pane = await paneOnTab($, "Agents");

    await pressClear(pane, world);

    const shown = await texts(pane);
    expect(shown).toContain("no subagents yet");
    expect(shown.filter((text) => /alpha|bravo|✓/.test(text))).toEqual([]);
  });

  test("G4 a running subagent stays after the press and shows as done when it finishes", async ($, on) => {
    const world = worldOf(on);
    const running = await spawnAgent($, world, "alpha");
    await finishedAgent($, world, "bravo");
    const pane = await paneOnTab($, "Agents");

    await pressClear(pane, world);
    await world.clock.advance(POLL_MS);
    const whileRunning = await texts(pane);
    await finishAgent($, world, running);
    await world.clock.advance(POLL_MS);
    const afterFinish = await texts(pane);

    expect(whileRunning.find((text) => text.includes("alpha"))).toContain("●");
    expect(whileRunning.some((text) => text.includes("bravo"))).toBe(false);
    expect(afterFinish.find((text) => text.includes("alpha"))).toContain("✓");
  });

  test("G5 a subagent that starts after the press shows next to the running one and the finished ones before are gone", async ($, on) => {
    const world = worldOf(on);
    await spawnAgent($, world, "alpha");
    await finishedAgent($, world, "bravo");
    const pane = await paneOnTab($, "Agents");
    await pressClear(pane, world);

    await spawnAgent($, world, "charlie");
    await world.clock.advance(POLL_MS);

    const shown = await texts(pane);
    expect(shown.some((text) => text.includes("alpha"))).toBe(true);
    expect(shown.some((text) => text.includes("charlie"))).toBe(true);
    expect(shown.some((text) => text.includes("bravo"))).toBe(false);
  });

  test("G6 a finished subagent under a running parent goes after the press and the parent stays", async ($, on) => {
    const world = worldOf(on);
    const parent = await spawnAgent($, world, "alpha");
    const child = await spawnAgent($, world, "kid", parent);
    await finishAgent($, world, child);
    const pane = await paneOnTab($, "Agents");

    await pressClear(pane, world);

    const shown = await texts(pane);
    expect(shown.some((text) => text.includes("alpha"))).toBe(true);
    expect(shown.some((text) => text.includes("kid"))).toBe(false);
  });

  test("G7 the Spend block counts only tokens spent after the press", async ($, on) => {
    const world = worldOf(on);
    const old = await spawnAgent($, world, "old");
    await spendTokens($, world, old, OLD_SPEND);
    await finishAgent($, world, old);
    const pane = await paneOnTab($, "Agents");
    await pressClear(pane, world);
    const spendAfterPress = headingLineOf(await lines(pane), "Spend");

    const fresh = await spawnAgent($, world, "fresh");
    await spendTokens($, world, fresh, FRESH_SPEND);
    await world.clock.advance(POLL_MS);

    const shown = await texts(pane);
    const spendRows = shown.slice(shown.indexOf("Spend") + 1);
    expect(spendAfterPress).toBeUndefined();
    expect(spendRows).toHaveLength(1);
    expect(spendRows[0]).toMatch(/fresh 800$/);
  });

  test("G8 in a short pane the line with the count of hidden finished subagents is gone after the press", async ($, on) => {
    const world = worldOf(on);
    for (let i = 0; i < FINISHED_AGENTS; i++) await finishedAgent($, world, `done ${i}`);
    const pane = await paneOnTab($, "Agents", { rows: SHORT_ROWS });
    const hasMoreDoneBefore = (await texts(pane)).some((text) => MORE_DONE.test(text));

    await pressClear(pane, world);

    const hasMoreDoneAfter = (await texts(pane)).some((text) => MORE_DONE.test(text));
    expect([hasMoreDoneBefore, hasMoreDoneAfter]).toEqual([true, false]);
  });

  test("G9 the session cost on the first line is still shown after the press", async ($, on) => {
    const world = worldOf(on);
    await setSessionCost($, world, SESSION_COST);
    await finishedAgent($, world, "alpha");
    const pane = await paneOnTab($, "Agents");

    await pressClear(pane, world);

    expect(await texts(pane)).toContain("main · opus $0.42");
  });

  test("G10 a subagent that finished before the press and steps again shows as running and its new tokens are in Spend", async ($, on) => {
    const world = worldOf(on);
    const resumed = await spawnAgent($, world, "alpha");
    await finishAgent($, world, resumed);
    const pane = await paneOnTab($, "Agents");
    await pressClear(pane, world);

    await spendTokens($, world, resumed, FRESH_SPEND);

    const shown = await texts(pane);
    const spendRows = shown.slice(shown.indexOf("Spend") + 1);
    expect(shown.find((text) => text.includes("alpha"))).toContain("●");
    expect(spendRows).toHaveLength(1);
    expect(spendRows[0]).toMatch(/alpha 800$/);
  });

  test("G11 a subagent that finished before the press and calls a tool again shows as running", async ($, on) => {
    const world = worldOf(on);
    const resumed = await spawnAgent($, world, "alpha");
    await finishAgent($, world, resumed);
    const pane = await paneOnTab($, "Agents");
    await pressClear(pane, world);

    await editFile($, world, "/work/a.ts", 1, 0, resumed);
    await world.clock.advance(FLUSH_MS);

    const alphaRows = (await texts(pane)).filter((text) => text.includes("alpha"));
    expect(alphaRows).toHaveLength(1);
    expect(alphaRows[0]).toContain("●");
  });
});

async function finishedAgent($: Engine, world: World, description: string): Promise<void> {
  await finishAgent($, world, await spawnAgent($, world, description));
}
