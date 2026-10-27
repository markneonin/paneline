import { describe, expect, test } from "claude-code/testing";

import {
  API_KEY,
  BACKGROUND_NOTE,
  OPUS,
  SONNET,
  UNPRICED,
  agentOwner,
  agentRequest,
  blocks,
  centsOf,
  lines,
  mainTurn,
  mutedPartsText,
  noteRowOf,
  ownerRowOf,
  ownersOf,
  plainPartsText,
  setSessionCost,
  startFreshSession,
  spendPane,
  toCents,
  totalsOf,
  typicalSession,
  worldOf,
} from "./spend-world";
import type { Engine } from "claude-code/testing";
import type { Owner, Pane, World } from "./spend-world";

const SPLIT = "Where it went";
const TYPICAL_COST = 12.37;
const SCALED_COST = 7.77;
const OWNERS_TOTAL_USD = 9.5;
const FORK = "fork-1";
const MAIN_OPUS_3_USD = 750_000;
const SONNET_1_USD = 500_000;

describe("spend split", () => {
  test("D1 a main turn, two implementer runs and one Explore run under a $12.37 session show implementer, main, background and Explore, largest first, each with its $ and percent", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await typicalSession($, world, { cost: TYPICAL_COST });

    const owners = await ownersIn(await spendPane($));

    expect(shown(owners)).toEqual([
      ["implementer", "~$4.50", "36%"],
      ["main · opus 5.5", "~$3.00", "24%"],
      ["background", "~$2.87", "23%"],
      ["Explore", "~$2.00", "16%"],
    ]);
  });

  test("D2 the shown $ values add up to the top USD to the cent", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await typicalSession($, world, { cost: TYPICAL_COST });

    const pane = await spendPane($);

    const top = totalsOf(await lines(pane))?.usd ?? "";
    expect(centsOf(await ownersIn(pane))).toBe(toCents(top));
    expect(toCents(top)).toBe(1237);
  });

  test("D3 under the background row sits one muted note row starting at the same column as the row names", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await typicalSession($, world, { cost: TYPICAL_COST });

    const block = (await blocks(await spendPane($)))[SPLIT];

    const rows = block?.rows ?? [];
    const note = noteRowOf(block);
    const background = ownerRowOf(block, "background");
    expect(rows.findIndex((row) => row === note)).toBe(
      rows.findIndex((row) => row === background) + 1,
    );
    expect(note?.indent).toBe(background?.indent);
    expect(mutedPartsText(note)).toBe(BACKGROUND_NOTE);
  });

  test("D4 the main row draws main in the text colour and · opus 5.5 muted", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await typicalSession($, world, { cost: TYPICAL_COST });

    const block = (await blocks(await spendPane($)))[SPLIT];

    const main = ownerRowOf(block, "main · opus 5.5");
    expect(plainPartsText(main)).toContain("main");
    expect(plainPartsText(main)).not.toContain("opus");
    expect(mutedPartsText(main)).toContain("· opus 5.5");
  });

  test("D5 the biggest owner's bar has more filled cells than the smallest owner's", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await typicalSession($, world, { cost: TYPICAL_COST });

    const owners = await ownersIn(await spendPane($));

    const biggest = owners.find((owner) => owner.name === "implementer");
    const smallest = owners.find((owner) => owner.name === "Explore");
    expect(biggest?.filled).toBeGreaterThan(smallest?.filled ?? Infinity);
    expect(smallest?.filled).toBeGreaterThan(0);
  });

  test("D6 tokens of an engine fork no agent owns land in background on top of the part nobody owns", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await startFreshSession($, world);
    await mainTurn($, world, { model: OPUS, tokens: { input: MAIN_OPUS_3_USD } });
    await agentRequest($, world, {
      agentId: FORK,
      model: SONNET,
      tokens: { input: SONNET_1_USD },
      index: 0,
    });
    await setSessionCost($, world, 6.5);

    const owners = await ownersIn(await spendPane($));

    expect(shown(owners)).toEqual([
      ["background", "~$3.50", "54%"],
      ["main · opus 5.5", "~$3.00", "46%"],
    ]);
  });

  test("D7 an agent whose finished turn reports the same tokens again still shows $4.50, not double", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await typicalSession($, world, { cost: TYPICAL_COST, isFinishingAgents: true });

    const owners = await ownersIn(await spendPane($));

    expect(shown(owners)).toEqual([
      ["implementer", "~$4.50", "36%"],
      ["main · opus 5.5", "~$3.00", "24%"],
      ["background", "~$2.87", "23%"],
      ["Explore", "~$2.00", "16%"],
    ]);
  });

  test("D8 seven owners with a cost equal to their total show five owner rows and 2 more with the sum of the two smallest", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sevenOwners($, world);

    const owners = await ownersIn(await spendPane($));

    expect(shown(owners)).toEqual([
      ["main · opus 5.5", "~$4.00", "28%"],
      ["implementer", "~$3.00", "21%"],
      ["test-engineer", "~$2.50", "17%"],
      ["Explore", "~$2.00", "14%"],
      ["reviewer", "~$1.50", "10%"],
      ["2 more", "~$1.50", "10%"],
    ]);
  });

  test("D9 when the cost equals the owners' total there is no background row and no note row", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await typicalSession($, world, { cost: OWNERS_TOTAL_USD });

    const block = (await blocks(await spendPane($)))[SPLIT];

    expect(ownersOf(block).map((owner) => owner.name)).toEqual([
      "implementer",
      "main · opus 5.5",
      "Explore",
    ]);
    expect(noteRowOf(block)).toBeUndefined();
  });

  test("D10 an agent on a model with no price shows its percent and no $ while priced rows keep theirs", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await startFreshSession($, world);
    await mainTurn($, world, { model: OPUS, tokens: { input: MAIN_OPUS_3_USD } });
    await agentOwner($, world, "scout", UNPRICED, { input: 100_000, output: 100_000 });
    await setSessionCost($, world, 4);

    const owners = await ownersIn(await spendPane($));

    expect(shown(owners)).toEqual([
      ["main · opus 5.5", "~$3.00", "75%"],
      ["scout", null, "20%"],
      ["background", "~$0.20", "5%"],
    ]);
  });

  test("D11 owners worth more than the session cost are scaled to $3.68, $2.45 and $1.64, add up to $7.77 and leave no background row", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await typicalSession($, world, { cost: SCALED_COST });

    const owners = await ownersIn(await spendPane($));

    expect(shown(owners)).toEqual([
      ["implementer", "~$3.68", "47%"],
      ["main · opus 5.5", "~$2.45", "32%"],
      ["Explore", "~$1.64", "21%"],
    ]);
    expect(centsOf(owners)).toBe(777);
  });

  test("D12 an agent on a model with no price whose share rounds to 0% is not drawn, only the priced main row stays", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { input: 1_250_000 } });
    await agentOwner($, world, "scout", UNPRICED, { output: 1 });
    await setSessionCost($, world, 5);

    const owners = await ownersIn(await spendPane($));

    expect(shown(owners)).toEqual([["main · opus 5.5", "~$5.00", "100%"]]);
  });
});

async function ownersIn(pane: Pane): Promise<Owner[]> {
  return ownersOf((await blocks(pane))[SPLIT]);
}

function shown(owners: Owner[]): (string | null)[][] {
  return owners.map((owner) => [owner.name, owner.dollars, owner.percent]);
}

async function sevenOwners($: Engine, world: World): Promise<void> {
  await mainTurn($, world, { model: OPUS, tokens: { input: 1_000_000 } });
  const agents: [string, number][] = [
    ["implementer", 1_500_000],
    ["test-engineer", 1_250_000],
    ["Explore", 1_000_000],
    ["reviewer", 750_000],
    ["high", 500_000],
    ["low", 250_000],
  ];
  for (const [type, input] of agents) await agentOwner($, world, type, SONNET, { input });
  await setSessionCost($, world, 14.5);
}
