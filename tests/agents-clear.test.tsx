import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";

import { TOKENS_BILLED_LABEL } from "../hooks/spend-model";
import { screenRows } from "./band-screen";

import {
  COLUMNS,
  FLUSH_MS,
  SHORT_ROWS,
  clearButtonsOf,
  editFile,
  finishAgent,
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
import type { Pane, World } from "./clear-world";

const MORE_DONE = /^… \d+ more done$/;
const FINISHED_AGENTS = 20;
const POLL_MS = 1_000;
const OLD_SPEND = 3_000;
const FRESH_SPEND = 800;
const SECOND_SPEND = 400;
const SESSION_COST = 0.42;

describe("agents clear button", () => {
  test("G1 with subagents the first line ends with a dim clear button", async ($, on) => {
    const world = worldOf(on);
    await setSessionCost($, world, SESSION_COST);
    await finishedAgent($, world, "alpha");

    const pane = await paneOnTab($, "Agents");

    const shown = await lines(pane);
    const first = shown.find((line) => /^\s*Agents\b/.test(line.text));
    expect(clearButtonsOf(shown)).toHaveLength(1);
    expect(first?.parts.at(-1)).toBe(clearButtonsOf(shown)[0]);
    expect(first?.text).toMatch(/1 done · .*clear$/);
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
    const whileRunning = await screen(pane);
    await finishAgent($, world, running);
    await world.clock.advance(POLL_MS);
    const afterFinish = await screen(pane);

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
    const afterPress = await screen(pane);
    const mainAfterPress = afterPress.find((row) => row.startsWith("○ main"));

    const fresh = await spawnAgent($, world, "fresh");
    await spendTokens($, world, fresh, FRESH_SPEND);
    const second = await spawnAgent($, world, "second");
    await spendTokens($, world, second, SECOND_SPEND);
    await world.clock.advance(POLL_MS);

    const shown = await screen(pane);
    expect(mainAfterPress).toBe("○ main · opus · idle");
    expect(afterPress.filter((row) => row.includes(TOKENS_BILLED_LABEL))).toEqual([]);
    expect(shown.filter((row) => row.includes(TOKENS_BILLED_LABEL))).toEqual([TOKENS_BILLED_LABEL]);
    expect(
      shown.filter((row) => row.includes("old")),
      "old rows",
    ).toEqual([]);
    expect(tokensOn(shown, "fresh")).toBe("800");
    expect(tokensOn(shown, "second")).toBe("400");
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

  test("G9 the main row is still shown after the press", async ($, on) => {
    const world = worldOf(on);
    await setSessionCost($, world, SESSION_COST);
    await finishedAgent($, world, "alpha");
    const pane = await paneOnTab($, "Agents");

    await pressClear(pane, world);

    expect((await texts(pane)).some((text) => text.startsWith("○ main · opus"))).toBe(true);
  });

  test("G10 a subagent that finished before the press and steps again shows as running and its new tokens are in Spend", async ($, on) => {
    const world = worldOf(on);
    const resumed = await spawnAgent($, world, "alpha");
    await finishAgent($, world, resumed);
    const pane = await paneOnTab($, "Agents");
    await pressClear(pane, world);

    await spendTokens($, world, resumed, FRESH_SPEND);
    const other = await spawnAgent($, world, "bravo");
    await spendTokens($, world, other, SECOND_SPEND);

    const shown = await screen(pane);
    expect(shown.find((text) => text.includes("alpha"))).toContain("●");
    expect(tokensOn(shown, "alpha")).toBe("800");
    expect(tokensOn(shown, "bravo")).toBe("400");
  });

  test("G11 a subagent that finished before the press and calls a tool again shows as running", async ($, on) => {
    const world = worldOf(on);
    const resumed = await spawnAgent($, world, "alpha");
    await finishAgent($, world, resumed);
    const pane = await paneOnTab($, "Agents");
    await pressClear(pane, world);

    await editFile($, world, "/work/a.ts", 1, 0, resumed);
    await world.clock.advance(FLUSH_MS);

    const alphaRows = (await screen(pane)).filter((text) => text.includes("alpha"));
    expect(alphaRows).toHaveLength(1);
    expect(alphaRows[0]).toContain("●");
  });
});

async function finishedAgent($: Engine, world: World, description: string): Promise<void> {
  await finishAgent($, world, await spawnAgent($, world, description));
}

async function screen(pane: Pane): Promise<string[]> {
  return screenRows(await pane.drawn(), COLUMNS)
    .map((row) => row.trim())
    .filter((row) => row !== "");
}

function tokensOn(rows: string[], name: string): string | undefined {
  const row = rows.find((text) => text.includes(name));
  return /(\d[\d.]*k?)(?: (?:~|<)\$\d+\.\d{2})? ▸$/.exec(row ?? "")?.[1];
}
