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
import { mainResponsesOnly, mainTurnOfResponses } from "./fixtures/main-responses";
import type { Owner, Pane, World } from "./spend-world";

const SPLIT = "Where it went";
const TYPICAL_COST = 12.37;
const SCALED_COST = 7.77;
const OWNERS_TOTAL_USD = 9.5;
const FORK = "fork-1";
const MAIN_OPUS_3_USD = 750_000;
const SONNET_1_USD = 500_000;
const TINY_MAIN_TOKENS = 800;
const BIGGER_AGENT_TOKENS = 9_200;
const FOUR_CENT_COST = 0.04;
const SUB_CENT_SESSION_USD = 0.0092;
const SUB_CENT_MAIN_TOKENS = 1_495;
const SUB_CENT_AGENT_TOKENS = 805;
const LOW_ENGINE_USD = 0.004;
const LOW_MAIN_TOKENS = 1_000;
const THREE_AGENT_TOKENS = [12_500, 12_500, 14_000];
const THREE_AGENT_TOTAL = "~$0.16";
const THREE_AGENT_TOP = "$0.16";
const HAIKU_LONG_TIER = "claude-haiku-5-5";
const NINETY_K_CALL = { input: 10_000, read: 80_000, output: 4_000 };
const OVER_100K_CALL = { input: 20_000, read: 100_000, output: 4_000 };
const SMALL_CALL = { input: 8_000, read: 2_000, output: 1_000 };
const AGENT_EIGHT_CENTS = { input: 30_000, output: 2_000 };
const TWO_SMALL_CALLS_SESSION_USD = 0.0876;
const LONG_AND_SMALL_SESSION_USD = 0.10632;
const CACHE_TURN = [
  { input: 1_000, write: 9_000 },
  { input: 1_000, read: 9_000 },
];
const CACHE_TURN_HIT = "45%";

describe("spend split", () => {
  test("D1 a main turn, two implementer runs and one Explore run under a $12.37 session show implementer, main, background and Explore, largest first, each with its $ and percent", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await typicalSession($, world, { cost: TYPICAL_COST });

    const owners = await ownersIn(await spendPane($));

    expect(shown(owners)).toEqual([
      ["implementer", "~$4.50", "37%"],
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
      ["implementer", "~$4.50", "37%"],
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
      ["▸ 2 more", "~$1.50", "10%"],
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

  test("D11 owners worth more than the session cost are kept whole at $4.50, $3.00 and $2.00, the top figure reads their $9.50 sum and no background row is drawn", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await typicalSession($, world, { cost: SCALED_COST });

    const pane = await spendPane($);

    const owners = await ownersIn(pane);
    expect(shown(owners)).toEqual([
      ["implementer", "~$4.50", "47%"],
      ["main · opus 5.5", "~$3.00", "32%"],
      ["Explore", "~$2.00", "21%"],
    ]);
    expect(centsOf(owners)).toBe(OWNERS_TOTAL_USD * 100);
    expect(toCents(totalsOf(await lines(pane))?.usd ?? null)).toBe(OWNERS_TOTAL_USD * 100);
  });

  test("L2 with no indexed total and an engine cost of $0.004 under three agents that spent about five cents each, the Spend session figure is the tracked 16 cents and the agents' row is not zero", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { input: LOW_MAIN_TOKENS } });
    for (const tokens of THREE_AGENT_TOKENS) {
      await agentOwner($, world, "scout", OPUS, { input: tokens });
    }
    await setSessionCost($, world, LOW_ENGINE_USD);

    const pane = await spendPane($);

    const owners = await ownersIn(pane);
    expect(totalsOf(await lines(pane))?.usd).toBe(THREE_AGENT_TOP);
    expect(owners.find((owner) => owner.name === "scout")?.dollars).toBe(THREE_AGENT_TOTAL);
  });

  test("D12 an agent on a model with no price whose share rounds to 0% is not drawn, only the priced main row stays", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { input: 1_250_000 } });
    await agentOwner($, world, "scout", UNPRICED, { output: 1 });
    await setSessionCost($, world, 5);

    const owners = await ownersIn(await spendPane($));

    expect(shown(owners)).toEqual([["main · opus 5.5", "~$5.00", "100%"]]);
  });

  test("S13 a main share under one cent of a $0.04 session reads <$0.01, never $0.00", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { input: TINY_MAIN_TOKENS } });
    await agentOwner($, world, "scout", OPUS, { input: BIGGER_AGENT_TOKENS });
    await setSessionCost($, world, FOUR_CENT_COST);

    const owners = await ownersIn(await spendPane($));

    const main = owners.find((owner) => owner.name.startsWith("main"));
    expect(main?.dollars).toBe("<$0.01");
  });

  test("S14 a $0.0092 session split 65% main and 35% one agent shows <$0.01 this session and <$0.01 on both rows, never ~$0.01", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { input: SUB_CENT_MAIN_TOKENS } });
    await agentOwner($, world, "scout", OPUS, { input: SUB_CENT_AGENT_TOKENS });
    await setSessionCost($, world, SUB_CENT_SESSION_USD);
    const pane = await spendPane($);

    const total = totalsOf(await lines(pane))?.usd;
    const owners = await ownersIn(pane);

    expect({ total, owners: shown(owners) }).toEqual({
      total: "<$0.01",
      owners: [
        ["main · opus 5.5", "<$0.01", "65%"],
        ["scout", "<$0.01", "35%"],
      ],
    });
  });

  test("S15 seven owners fold into 5 rows plus 2 more, and the drawn percents add to 100", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sevenSharedShareOwners($, world);

    const owners = await ownersIn(await spendPane($));

    expect(owners.map((owner) => [owner.name, owner.percent])).toEqual([
      ["main · sonnet 5.5", "30%"],
      ["implementer", "25%"],
      ["test-engineer", "14%"],
      ["Explore", "11%"],
      ["reviewer", "10%"],
      ["▸ 2 more", "10%"],
    ]);
  });

  test("S16 a $0.40 session with four agents under 0.5% each shows main 99% and 4 more 1%, the drawn percents add to 100", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: SONNET, tokens: { input: 197_600 } });
    for (let index = 0; index < 4; index += 1) {
      await agentOwner($, world, `tiny-${index}`, SONNET, { input: 600 });
    }
    await setSessionCost($, world, 0.4);

    const owners = await ownersIn(await spendPane($));

    expect(owners.map((owner) => [owner.name, owner.percent])).toEqual([
      ["main · sonnet 5.5", "99%"],
      ["▸ 4 more", "1%"],
    ]);
  });

  test("P1 a Haiku 5.5 turn of two 90k-token calls and a $0.08 general-purpose run under a $0.0876 session show general-purpose ~$0.08 91% and main ~$0.01 9%, not main ~$0.03", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await startFreshSession($, world);
    await mainTurnOfResponses($, world, {
      model: HAIKU_LONG_TIER,
      responses: [NINETY_K_CALL, NINETY_K_CALL],
    });
    await agentOwner($, world, "general-purpose", SONNET, AGENT_EIGHT_CENTS);
    await setSessionCost($, world, TWO_SMALL_CALLS_SESSION_USD);

    const owners = await ownersIn(await spendPane($));

    expect(shown(owners)).toEqual([
      ["general-purpose", "~$0.08", "91%"],
      ["main · haiku 5.5", "~$0.01", "9%"],
    ]);
  });

  test("P2 in a Haiku 5.5 turn of one 120k-token call and one 10k-token call only the 120k call pays the long rate: main stays 25% of the session", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await startFreshSession($, world);
    await mainTurnOfResponses($, world, {
      model: HAIKU_LONG_TIER,
      responses: [OVER_100K_CALL, SMALL_CALL],
    });
    await agentOwner($, world, "general-purpose", SONNET, AGENT_EIGHT_CENTS);
    await setSessionCost($, world, LONG_AND_SMALL_SESSION_USD);

    const owners = await ownersIn(await spendPane($));

    expect(shown(owners)).toEqual([
      ["general-purpose", "~$0.08", "75%"],
      ["main · haiku 5.5", "~$0.03", "25%"],
    ]);
  });

  test("P3 while a two-call turn is still running the cache share already reads 45% from the calls so far, and it still reads 45% when the turn ends", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await startFreshSession($, world);
    await setSessionCost($, world, FOUR_CENT_COST);
    await mainResponsesOnly($, world, { model: OPUS, responses: CACHE_TURN });

    const midTurnPane = await spendPane($);
    const duringTurn = totalsOf(await lines(midTurnPane))?.hit;
    await midTurnPane.unmount();
    await mainTurnOfResponses($, world, { model: OPUS, responses: [] });
    await mainTurn($, world, { model: OPUS, tokens: { input: 2_000, write: 9_000, read: 9_000 } });

    const afterTurn = totalsOf(await lines(await spendPane($)))?.hit;
    expect([duringTurn, afterTurn]).toEqual([CACHE_TURN_HIT, CACHE_TURN_HIT]);
  });
});

async function ownersIn(pane: Pane): Promise<Owner[]> {
  return ownersOf((await blocks(pane))[SPLIT]);
}

function shown(owners: Owner[]): (string | null)[][] {
  return owners.map((owner) => [owner.name, owner.dollars, owner.percent]);
}

async function sevenSharedShareOwners($: Engine, world: World): Promise<void> {
  await mainTurn($, world, { model: SONNET, tokens: { input: 783_000 } });
  const agents: [string, number][] = [
    ["implementer", 645_000],
    ["test-engineer", 356_000],
    ["Explore", 271_000],
    ["reviewer", 261_000],
    ["high", 172_000],
    ["low", 94_000],
  ];
  for (const [type, input] of agents) await agentOwner($, world, type, SONNET, { input });
  await setSessionCost($, world, 1);
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
