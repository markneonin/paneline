import { describe, expect, test } from "claude-code/testing";

import { seedTotals } from "./fixtures/spend-atom";
import {
  API_KEY,
  HAIKU,
  OPUS,
  hasNoSpendNote,
  lines,
  mainTurn,
  setSessionCost,
  spendPane,
  splitOf,
  startFreshSession,
  totalsOf,
  worldOf,
} from "./spend-world";

const CACHE_READ_TOKENS = 46_100;
const OPUS_INPUT_TOKENS = 750_000;
const ENGINE_USD = 5;
const KNOWN_ENGINE_USD = 1;
const TRANSCRIPT_USD = 9;
const HAIKU_SPLIT = [["main · haiku 4.5", "<$0.01", "100%"]];

describe("spend of a session that spent before the Spend tab first opened", () => {
  test("E1 a haiku turn done before the Spend tab first opens shows the tiles and a Where it went row on the first draw", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: HAIKU, tokens: { read: CACHE_READ_TOKENS } });

    const pane = await spendPane($);

    const shown = await lines(pane);
    expect({
      hasNoSpendNote: hasNoSpendNote(shown),
      tileUsd: totalsOf(shown)?.usd,
      split: await splitOf(pane),
    }).toEqual({ hasNoSpendNote: false, tileUsd: "<$0.01", split: HAIKU_SPLIT });
  });

  test("E1b a fresh session with engine cost $0 and a haiku turn done before Spend first opens shows the tiles and a Where it went row on the first draw", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await startFreshSession($, world);
    await mainTurn($, world, { model: HAIKU, tokens: { read: CACHE_READ_TOKENS } });

    const pane = await spendPane($);

    const shown = await lines(pane);
    expect({
      hasNoSpendNote: hasNoSpendNote(shown),
      tileUsd: totalsOf(shown)?.usd,
      split: await splitOf(pane),
    }).toEqual({ hasNoSpendNote: false, tileUsd: "<$0.01", split: HAIKU_SPLIT });
  });

  test("E5 a known engine cost of $1 with $3 of counted spend before the index shows $3.00, because the counted spend comes from the transcripts so an engine figure below it never lowers the tiles", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { input: OPUS_INPUT_TOKENS } });
    await setSessionCost($, world, KNOWN_ENGINE_USD);

    const pane = await spendPane($);

    expect(totalsOf(await lines(pane))?.usd).toBe("$3.00");
  });

  test("E3 once the transcript total is counted the tiles show it, over the engine cost and the counted spend", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { input: OPUS_INPUT_TOKENS } });
    await setSessionCost($, world, ENGINE_USD);
    seedTotals(world, { session: TRANSCRIPT_USD });

    const pane = await spendPane($);

    expect(totalsOf(await lines(pane))?.usd).toBe("$9.00");
  });
});
