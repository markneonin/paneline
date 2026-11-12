import { describe, expect, test } from "claude-code/testing";

import {
  API_KEY,
  BACKGROUND_NOTE,
  BEFORE_TRACKING,
  OPUS,
  SONNET,
  SPLIT_TITLE,
  agentOwner,
  blocks,
  clearSession,
  dropBaselineField,
  forgetLastCost,
  hasNoSpendNote,
  lines,
  mainTurn,
  noteRowOf,
  setSessionCost,
  settle,
  spendPane,
  splitOf,
  worldOf,
} from "./spend-world";
import type { Engine } from "claude-code/testing";
import type { World } from "./spend-world";

const RESUMED_COST = 80;
const MAIN_OPUS_4_USD = 1_000_000;
const AGENT_SONNET_2_USD = 1_000_000;
const COST_AFTER_TRACKING = 86;
const COST_AFTER_GROWTH = 89;
const MAIN_OPUS_3_USD = 750_000;
const COST_OF_RUNNING_SESSION = 88;
const COST_AFTER_RESIDUAL = 91;

describe("spend before tracking", () => {
  test("B1 a session already at $80 when the plugin first sees it, then $6 of tracked turns, shows before tracking ~$80 and main ~$4 and implementer ~$2, with no background row", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await resumedSessionWithSixTrackedDollars($, world);

    const pane = await spendPane($);

    expect(await splitOf(pane)).toEqual([
      [BEFORE_TRACKING, "~$80.00", "93%"],
      ["main · opus 5.5", "~$4.00", "5%"],
      ["implementer", "~$2.00", "2%"],
    ]);
  });

  test("B2 a session at $80 when the plugin first sees it, with no turn tracked yet, is one before tracking row of ~$80.00 and 100%, with no background row and no note", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await setSessionCost($, world, RESUMED_COST);

    const pane = await spendPane($);

    expect(await splitOf(pane)).toEqual([[BEFORE_TRACKING, "~$80.00", "100%"]]);
    expect(noteRowOf((await blocks(pane))[SPLIT_TITLE])).toBeUndefined();
  });

  test("B3 when the session cost then grows by $3 with no new tokens the $3 shows as background with its note while before tracking stays ~$80.00", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await resumedSessionWithSixTrackedDollars($, world);
    await setSessionCost($, world, COST_AFTER_GROWTH);

    const pane = await spendPane($);

    const split = (await blocks(pane))[SPLIT_TITLE];
    expect(await splitOf(pane)).toEqual([
      [BEFORE_TRACKING, "~$80.00", "90%"],
      ["main · opus 5.5", "~$4.00", "5%"],
      ["background", "~$3.00", "3%"],
      ["implementer", "~$2.00", "2%"],
    ]);
    expect(noteRowOf(split)?.text).toBe(BACKGROUND_NOTE);
  });

  test("B4 the before tracking row is gone after /clear and the engine's reset to $0, and a new $3 turn shows only main at 100%", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await resumedSessionWithSixTrackedDollars($, world);
    const pane = await spendPane($);
    const namesBeforeClear = (await splitOf(pane)).map(([name]) => name);

    await clearSession($, world);
    await setSessionCost($, world, 0);
    await settle(pane);
    const isEmptied = hasNoSpendNote(await lines(pane));
    const splitEmptied = await splitOf(pane);
    await mainTurn($, world, { model: OPUS, tokens: { input: MAIN_OPUS_3_USD } });
    await setSessionCost($, world, 3);
    await settle(pane);

    expect(namesBeforeClear).toContain(BEFORE_TRACKING);
    expect(isEmptied).toBe(true);
    expect(splitEmptied).toEqual([]);
    expect(await splitOf(pane)).toEqual([["main · opus 5.5", "~$3.00", "100%"]]);
  });

  test("B5 turns tracked by an older plugin version that left no baseline, then a $88 cost, show before tracking ~$82.00 and no background row", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await trackedWithoutBaseline($, world);
    await setSessionCost($, world, COST_OF_RUNNING_SESSION);

    const pane = await spendPane($);

    expect(await splitOf(pane)).toEqual([
      [BEFORE_TRACKING, "~$82.00", "93%"],
      ["main · opus 5.5", "~$4.00", "5%"],
      ["implementer", "~$2.00", "2%"],
    ]);
    expect(noteRowOf((await blocks(pane))[SPLIT_TITLE])).toBeUndefined();
  });

  test("B6 with an older plugin's state and a cost that then grows by $3, background shows only that $3 and before tracking stays ~$82.00", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await trackedWithoutBaseline($, world);
    await setSessionCost($, world, COST_OF_RUNNING_SESSION);
    await setSessionCost($, world, COST_AFTER_RESIDUAL);

    expect(await splitOf(await spendPane($))).toEqual([
      [BEFORE_TRACKING, "~$82.00", "90%"],
      ["main · opus 5.5", "~$4.00", "5%"],
      ["background", "~$3.00", "3%"],
      ["implementer", "~$2.00", "2%"],
    ]);
  });
});

async function trackedWithoutBaseline($: Engine, world: World): Promise<void> {
  await forgetLastCost($);
  await mainTurn($, world, { model: OPUS, tokens: { input: MAIN_OPUS_4_USD } });
  await agentOwner($, world, "implementer", SONNET, { input: AGENT_SONNET_2_USD });
  dropBaselineField(world);
}

async function resumedSessionWithSixTrackedDollars($: Engine, world: World): Promise<void> {
  await setSessionCost($, world, RESUMED_COST);
  await mainTurn($, world, { model: OPUS, tokens: { input: MAIN_OPUS_4_USD } });
  await agentOwner($, world, "implementer", SONNET, { input: AGENT_SONNET_2_USD });
  await setSessionCost($, world, COST_AFTER_TRACKING);
}
