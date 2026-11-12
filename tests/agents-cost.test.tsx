import { describe, expect, test } from "claude-code/testing";

import { paneInk } from "../hooks/pane-ink";
import { screenRows } from "./band-screen";
import { collect, textOf } from "./draw-tree";
import * as spendModel from "../hooks/spend-model";
import type { DiskWorld } from "./fixtures/agents-disk-world";
import { diskWorldOf, OWN_DIR, OWN_SESSION, WORK_CWD } from "./fixtures/agents-disk-world";
import { assistantLine } from "./fixtures/transcript-oracle";
import { seedTotals, totalsAtom } from "./fixtures/spend-atom";
import { oracleOf, transcriptOf } from "./transcript-oracle";
import type { Tokens as OracleTokens } from "./transcript-oracle";
import {
  API_KEY,
  BEFORE_TRACKING,
  COLUMNS,
  OPUS,
  SONNET,
  SPLIT_TITLE,
  UNPRICED,
  agentRequest,
  blocks,
  finishAgent,
  lines,
  mainStep,
  mainTurn,
  openPane,
  ownersOf,
  reloadPlugin,
  setSessionCost,
  settle,
  showTabThroughArrows,
  spawnAgent,
  spendPane,
  toCents,
  totalsOf,
  usageOf,
  worldOf,
} from "./spend-world";
import type { Pane, Tokens, World } from "./spend-world";
import type { Engine } from "claude-code/testing";

const SESSION_COST = 0.29;
const MAIN_TOKENS = 300_000;
const AGENT_TOKENS = 250_000;
const TINY_MAIN_TOKENS = 800;
const BIGGER_AGENT_TOKENS = 9_200;
const FOUR_CENT_COST = 0.04;
const MAIN_ONE_DOLLAR: Tokens = { input: 250_000 };
const BIG_AGENT: Tokens = { input: 100_000, output: 50_000, write: 200_000, read: 500_000 };
const SMALL_AGENT: Tokens = { input: 33_000, output: 7_000, write: 20_000, read: 80_000 };
const MAIN_TRANSCRIPT_TOKENS = 250_000;
const AGENT_TRANSCRIPT_TOKENS = 500_000;
const AMPLE_SESSION_USD = 10;
const HALF_OF_TRACKED_USD = 1.75;
const TRACKED_USD = 3.5;
const TRACKED_CENTS = 350;
const STALE_WITH_BASELINE_USD = 1;
const LOW_ENGINE_USD = 0.004;
const LOW_MAIN_TOKENS = 1_000;
const THREE_AGENT_TOKENS = [12_500, 12_500, 14_000];
const THREE_AGENT_DOLLARS = ["~$0.05", "~$0.05", "~$0.06"];
const THREE_AGENT_TOTAL_CENTS = 16;
const ENGINE_TRACKED_PLUS_BACKGROUND_USD = 5;
const SHARED_CENT_AGENT: Tokens = { input: 100_000, read: 100_000, output: 29_250 };
const SHARED_CENT_SESSION_USD = 2.01;
const SHARED_CENT_CENTS = 201;
const MILLI = 1_000;
const ORACLE_NOW = 10_000;
const ORACLE_AT = 1_000;
const MS_PER_HOUR = 3_600_000;
const SETTLE_ROUNDS = 5;
const QUIET_TICKS = 300;
const LATER_AGENT_TOKENS = 40_000;
const FIRST_OPUS_STEP: Tokens = { input: 100_000, output: 10_000 };
const SECOND_SONNET_STEP: Tokens = { input: 400_000, output: 20_000 };
const ABOVE_TRACKED_USD = 5;
const ABOVE_TRACKED_FACTOR = 2;
const STALE_DIVISOR = 4;
const LABEL_TEXT = "tokens billed (cache reads included)";
const FLUSH_WINDOWS = 3;
const FLUSH_MS = 1_000;
const CENTS_PER_USD = 100;
const AGENTS = "Agents";
const AGENTS_STATE_KEY = "paneline.agents.";
const COUNTER_FIELDS = ["usd", "tokensIn", "tokensOut"];

describe("agents cost", () => {
  test("C1 the Agents main row shows the same amount as the Spend main row, never the session total", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { write: MAIN_TOKENS }, context: MAIN_TOKENS });
    const agentId = await spawnAgent($, world, "reviewer");
    await agentRequest($, world, {
      agentId,
      model: OPUS,
      tokens: { write: AGENT_TOKENS },
      index: 0,
    });
    await finishAgent($, world, agentId, usageOf(OPUS, { write: AGENT_TOKENS }));
    await setSessionCost($, world, SESSION_COST);
    const pane = await spendPane($);
    const spendMain = ownersOf((await blocks(pane))[SPLIT_TITLE]).find((owner) =>
      owner.name.startsWith("main"),
    )?.dollars;

    await showTabThroughArrows(pane, "Agents");

    const mainRow = await mainRowText(pane);
    expect(spendMain).toMatch(/^~\$\d+\.\d{2}$/);
    expect(mainRow).toMatch(/^○ main · opus · idle\s+/);
    expect(mainRow.endsWith(` ${spendMain}`)).toBe(true);
    expect(mainRow).not.toContain("$0.29");
  });
  test("V8 the main row amount is in the text colour", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { write: MAIN_TOKENS }, context: MAIN_TOKENS });
    const agentId = await spawnAgent($, world, "reviewer");
    await agentRequest($, world, {
      agentId,
      model: OPUS,
      tokens: { write: AGENT_TOKENS },
      index: 0,
    });
    await finishAgent($, world, agentId, usageOf(OPUS, { write: AGENT_TOKENS }));
    await setSessionCost($, world, SESSION_COST);
    const pane = await spendPane($);
    const spendMain =
      ownersOf((await blocks(pane))[SPLIT_TITLE]).find((owner) => owner.name.startsWith("main"))
        ?.dollars ?? "";

    expect(spendMain).toMatch(/^~\$\d+\.\d{2}$/);
    await showTabThroughArrows(pane, "Agents");

    const amounts = collect(await pane.drawn(), "Text").filter(
      (node) => textOf(node).trim() === spendMain,
    );
    expect(amounts, "the main row amount").toHaveLength(1);
    expect(amounts[0]?.props?.color).toBe(paneInk().text);
  });

  test("C2 a main share under one cent shows <$0.01 on the Agents main row", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { input: TINY_MAIN_TOKENS } });
    const agentId = await spawnAgent($, world, "reviewer");
    await agentRequest($, world, {
      agentId,
      model: OPUS,
      tokens: { input: BIGGER_AGENT_TOKENS },
      index: 0,
    });
    await finishAgent($, world, agentId, usageOf(OPUS, { input: BIGGER_AGENT_TOKENS }));
    await setSessionCost($, world, FOUR_CENT_COST);
    const pane = await spendPane($);

    await showTabThroughArrows(pane, "Agents");

    const mainRow = await mainRowText(pane);
    expect(mainRow.endsWith(" <$0.01")).toBe(true);
  });

  test("N1 one agent shows the dollars and tokens an independent count of its transcript gives, the same as Spend's row for its type", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: MAIN_ONE_DOLLAR });
    const agentId = await spawnAgent($, world, "reviewer");
    await agentRequest($, world, { agentId, model: OPUS, tokens: BIG_AGENT, index: 0 });
    await finishAgent($, world, agentId, usageOf(OPUS, BIG_AGENT));
    const counted = countedSubagent(BIG_AGENT);
    await setSessionCost($, world, 1 + counted.usd);
    const pane = await openPane($);
    await showTabThroughArrows(pane, "Spend");
    const spendRow = await spendRowOf(pane, "reviewer");

    await showTabThroughArrows(pane, AGENTS);

    const [agentRow] = await agentFigures(pane, "reviewer");
    expect(agentRow).toEqual({ tokens: kiloOf(counted.tokens), dollars: dollarsOf(counted.usd) });
    expect(agentRow?.dollars).toBe(spendRow);
  });

  test("N2 two agents of one type each show their own share and the two shares add up to Spend's row for the type", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: MAIN_ONE_DOLLAR });
    const first = await spawnAgent($, world, "reviewer");
    const second = await spawnAgent($, world, "reviewer");
    await agentRequest($, world, { agentId: first, model: OPUS, tokens: BIG_AGENT, index: 0 });
    await agentRequest($, world, { agentId: second, model: OPUS, tokens: SMALL_AGENT, index: 0 });
    await finishAgent($, world, first, usageOf(OPUS, BIG_AGENT));
    await finishAgent($, world, second, usageOf(OPUS, SMALL_AGENT));
    const big = countedSubagent(BIG_AGENT);
    const small = countedSubagent(SMALL_AGENT);
    await setSessionCost($, world, 1 + big.usd + small.usd);
    const pane = await openPane($);
    await showTabThroughArrows(pane, "Spend");
    const spendRow = await spendRowOf(pane, "reviewer");

    await showTabThroughArrows(pane, AGENTS);

    const shown = await agentFigures(pane, "reviewer");
    expect(sortedByTokens(shown)).toEqual(
      sortedByTokens([
        { tokens: kiloOf(big.tokens), dollars: dollarsOf(big.usd) },
        { tokens: kiloOf(small.tokens), dollars: dollarsOf(small.usd) },
      ]),
    );
    expect(sum(shown.map((row) => toCents(row.dollars)))).toBe(toCents(spendRow));
  });

  test("N3 the main row and the agent rows add up to the session figure Spend shows when the transcript count differs from the engine cost", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await trackedMainAndAgent($, world);
    await setSessionCost($, world, HALF_OF_TRACKED_USD);
    await setSessionCost($, world, ENGINE_TRACKED_PLUS_BACKGROUND_USD);
    const pane = await openPane($);
    await showTabThroughArrows(pane, AGENTS);
    seedTotals(world, totalsAtom({ session: TRACKED_USD }));
    await settle(pane);

    const cents = await centsOnAgentsTab(pane);

    expect(cents).toBe(TRACKED_CENTS);
  });

  test("N3b with no indexed total and an engine cost below the tracked spend the main row and the agent rows keep the tracked amount", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await trackedMainAndAgent($, world);
    await setSessionCost($, world, HALF_OF_TRACKED_USD);
    const pane = await openPane($);
    await showTabThroughArrows(pane, AGENTS);
    seedTotals(world, totalsAtom({ session: null }));
    await settle(pane);

    const cents = await centsOnAgentsTab(pane);

    expect(cents).toBe(TRACKED_CENTS);
  });

  test("L1 with no indexed total and an engine cost of $0.004 under three agents that spent about five cents each, the cards read 5, 5 and 6 cents and the header total is their sum with the main row, never <$0.01", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: { input: LOW_MAIN_TOKENS } });
    for (const tokens of THREE_AGENT_TOKENS) {
      const agentId = await spawnAgent($, world, "reviewer");
      await agentRequest($, world, { agentId, model: OPUS, tokens: { input: tokens }, index: 0 });
      await finishAgent($, world, agentId, usageOf(OPUS, { input: tokens }));
    }
    await setSessionCost($, world, LOW_ENGINE_USD);
    const pane = await openPane($);

    await showTabThroughArrows(pane, AGENTS);

    const cards = (await agentFigures(pane, "reviewer")).map((card) => card.dollars);
    expect(cards.sort()).toEqual(THREE_AGENT_DOLLARS);
    expect(await headerCentsOf(pane)).toBe(THREE_AGENT_TOTAL_CENTS);
  });

  test("L3 with no indexed total and an engine cost above the tracked spend, the Spend session figure stays the engine cost and the Agents rows keep their tracked amounts", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await trackedMainAndAgent($, world);
    await setSessionCost($, world, ENGINE_TRACKED_PLUS_BACKGROUND_USD);
    const pane = await openPane($);
    await showTabThroughArrows(pane, "Spend");
    expect(await spendSessionCents(pane)).toBe(ENGINE_TRACKED_PLUS_BACKGROUND_USD * CENTS_PER_USD);

    await showTabThroughArrows(pane, AGENTS);

    expect(await centsOnAgentsTab(pane)).toBe(TRACKED_CENTS);
  });

  test("N4 when the session cost is not known no Agents row shows a dollar amount", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: UNPRICED, tokens: MAIN_ONE_DOLLAR });
    const agentId = await spawnAgent($, world, "reviewer");
    await agentRequest($, world, { agentId, model: UNPRICED, tokens: BIG_AGENT, index: 0 });
    await finishAgent($, world, agentId, usageOf(UNPRICED, BIG_AGENT));
    const pane = await openPane($);

    await showTabThroughArrows(pane, AGENTS);

    expect((await lines(pane)).filter((line) => line.text.includes("$"))).toEqual([]);
  });

  test("J5 with no engine cost and no totals the Agents header total and the main and agent rows add up to the tracked amount Spend shows", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await trackedMainAndAgent($, world);
    const pane = await openPane($);
    await showTabThroughArrows(pane, "Spend");
    const spendCents = toCents(totalsOf(await lines(pane))?.usd ?? null);

    await showTabThroughArrows(pane, AGENTS);

    const headerCents = await headerCentsOf(pane);
    expect(spendCents).toBeGreaterThan(0);
    expect(headerCents).toBe(spendCents);
    expect(await centsOnAgentsTab(pane)).toBe(spendCents);
  });

  test("K2a when the indexed session total lags below what the session was seen to spend the Agents header shows the tracked amount", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await trackedMainAndAgent($, world);
    const pane = await openPane($);
    const tracked = await trackedCentsOnSpend(pane);

    await seedStaleTotal(pane, world, tracked);

    await showTabThroughArrows(pane, AGENTS);
    expect(await headerCentsOf(pane)).toBe(tracked);
  });

  test("K2b when the indexed session total is above what the session was seen to spend the Spend session figure is that total and the Agents rows keep their tracked amounts", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await trackedMainAndAgent($, world);
    const pane = await openPane($);
    const tracked = await trackedCentsOnSpend(pane);

    seedTotals(world, totalsAtom({ session: (tracked * ABOVE_TRACKED_FACTOR) / CENTS_PER_USD }));
    await settle(pane);

    expect(await spendSessionCents(pane)).toBe(tracked * ABOVE_TRACKED_FACTOR);
    await showTabThroughArrows(pane, AGENTS);
    expect(await centsOnAgentsTab(pane)).toBe(tracked);
  });

  test("K2c a finished agent's row and the Agents header do not change when the lagging session total is replaced by the caught-up one", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await trackedMainAndAgent($, world);
    const pane = await openPane($);
    const tracked = await trackedCentsOnSpend(pane);
    await seedStaleTotal(pane, world, tracked);
    await showTabThroughArrows(pane, AGENTS);
    const stale = await agentsFigures(pane);

    seedTotals(world, totalsAtom({ session: tracked / CENTS_PER_USD }));
    await settle(pane);

    expect(await agentsFigures(pane)).toEqual(stale);
  });

  test("K2d while the session total lags, Spend's session figure and the Agents header show the same tracked amount", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await trackedMainAndAgent($, world);
    const pane = await openPane($);
    const tracked = await trackedCentsOnSpend(pane);

    await seedStaleTotal(pane, world, tracked);

    const spend = await spendSessionCents(pane);
    await showTabThroughArrows(pane, AGENTS);
    expect(spend).toBe(tracked);
    expect(await headerCentsOf(pane)).toBe(tracked);
  });

  test("K2e while the session total lags below the tracked spend plus the before-tracking amount, Spend's session figure and the Agents rows plus the before-tracking row add up to tracked plus before-tracking", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await setSessionCost($, world, ABOVE_TRACKED_USD);
    await trackedMainAndAgent($, world);
    await setSessionCost($, world, ABOVE_TRACKED_USD + TRACKED_USD);
    const pane = await openPane($);
    await showTabThroughArrows(pane, "Spend");

    seedTotals(world, totalsAtom({ session: STALE_WITH_BASELINE_USD }));
    await settle(pane);

    const owners = ownersOf((await blocks(pane))[SPLIT_TITLE]);
    const beforeTracking = owners.find((owner) => owner.name === BEFORE_TRACKING)?.dollars ?? null;
    expect(await spendSessionCents(pane)).toBe((ABOVE_TRACKED_USD + TRACKED_USD) * CENTS_PER_USD);
    await showTabThroughArrows(pane, AGENTS);
    expect((await centsOnAgentsTab(pane)) + toCents(beforeTracking)).toBe(
      (ABOVE_TRACKED_USD + TRACKED_USD) * CENTS_PER_USD,
    );
  });

  test("N5 an agent whose model has no price shows all its token kinds and no dollar amount while a priced agent next to it keeps its dollars", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: MAIN_ONE_DOLLAR });
    const priced = await spawnAgent($, world, "reviewer");
    const unpriced = await spawnAgent($, world, "scribe");
    await agentRequest($, world, { agentId: priced, model: OPUS, tokens: BIG_AGENT, index: 0 });
    await agentRequest($, world, {
      agentId: unpriced,
      model: UNPRICED,
      tokens: SMALL_AGENT,
      index: 0,
    });
    await finishAgent($, world, priced, usageOf(OPUS, BIG_AGENT));
    await finishAgent($, world, unpriced, usageOf(UNPRICED, SMALL_AGENT));
    await setSessionCost($, world, AMPLE_SESSION_USD);
    const pane = await openPane($);

    await showTabThroughArrows(pane, AGENTS);

    const [scribe] = await agentFigures(pane, "scribe");
    const [reviewer] = await agentFigures(pane, "reviewer");
    expect(scribe).toEqual({ tokens: kiloOf(countedSubagent(SMALL_AGENT).tokens), dollars: null });
    expect(reviewer?.dollars).toBe(dollarsOf(countedSubagent(BIG_AGENT).usd));
  });

  test("N8 the batch receipt shows the sum of its members' dollars and tokens", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainStep($, world, { model: OPUS, tokens: { input: 1 } });
    const first = await spawnAgent($, world, "reviewer");
    const second = await spawnAgent($, world, "reviewer");
    await agentRequest($, world, {
      agentId: first,
      model: OPUS,
      tokens: SHARED_CENT_AGENT,
      index: 0,
    });
    await agentRequest($, world, {
      agentId: second,
      model: OPUS,
      tokens: SHARED_CENT_AGENT,
      index: 0,
    });
    await finishAgent($, world, first, usageOf(OPUS, SHARED_CENT_AGENT));
    await finishAgent($, world, second, usageOf(OPUS, SHARED_CENT_AGENT));
    await setSessionCost($, world, SHARED_CENT_SESSION_USD);
    const pane = await openPane($);

    await showTabThroughArrows(pane, AGENTS);

    const members = await agentFigures(pane, "reviewer");
    const receipt = (await lines(pane)).find((line) => line.text.includes("batch · "))?.text;
    expect(sum(members.map((row) => toCents(row.dollars)))).toBe(SHARED_CENT_CENTS);
    expect(receipt).toMatch(/ · 458\.5k tokens · ~\$2\.01$/);
  });

  test("N9 a response that arrives before its agent is known still lands in that agent's dollars and in Spend's row for the agent's type", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: MAIN_ONE_DOLLAR });
    const agentId = await responseBeforeSpawn($, world, "reviewer", BIG_AGENT);
    await finishAgent($, world, agentId, usageOf(OPUS, BIG_AGENT));
    const counted = countedSubagent(BIG_AGENT);
    await setSessionCost($, world, 1 + counted.usd);
    const pane = await openPane($);
    await showTabThroughArrows(pane, "Spend");
    const spendRow = await spendRowOf(pane, "reviewer");

    await showTabThroughArrows(pane, AGENTS);

    const [agentRow] = await agentFigures(pane, "reviewer");
    expect(agentRow).toEqual({ tokens: kiloOf(counted.tokens), dollars: dollarsOf(counted.usd) });
    expect(spendRow).toBe(dollarsOf(counted.usd));
  });

  test("N10 after the plugin restores its saved Spend state each agent shows the same dollars and tokens as before", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: MAIN_ONE_DOLLAR });
    const first = await spawnAgent($, world, "reviewer");
    const second = await spawnAgent($, world, "scribe");
    await agentRequest($, world, { agentId: first, model: OPUS, tokens: BIG_AGENT, index: 0 });
    await agentRequest($, world, { agentId: second, model: OPUS, tokens: SMALL_AGENT, index: 0 });
    await finishAgent($, world, first, usageOf(OPUS, BIG_AGENT));
    await finishAgent($, world, second, usageOf(OPUS, SMALL_AGENT));
    const cost = 1 + countedSubagent(BIG_AGENT).usd + countedSubagent(SMALL_AGENT).usd;
    await setSessionCost($, world, cost);
    const pane = await openPane($);
    const before = await figuresOn(pane, ["reviewer", "scribe"]);
    expect(before.flat().every((row) => row.dollars !== null && row.tokens !== "")).toBe(true);
    expect(before.flat()).toHaveLength(2);

    await pane.unmount();
    await restoreSpendOnly($, world, cost);
    const reopened = await openPane($);

    expect(await figuresOn(reopened, ["reviewer", "scribe"])).toEqual(before);
  });

  test("N11 Agents opened first, with Spend never opened, shows the transcript session figure and not the engine cost", async ($, on) => {
    const world = diskWorldOf(on);
    putSessionTranscripts(world);
    await trackedMainAndAgent($, world);
    await setSessionCost($, world, HALF_OF_TRACKED_USD);
    await setSessionCost($, world, ENGINE_TRACKED_PLUS_BACKGROUND_USD);
    const pane = await openPane($);

    await showTabThroughArrows(pane, AGENTS);
    await quiet();
    await settle(pane);

    expect(await centsOnAgentsTab(pane)).toBe(TRACKED_CENTS);
  });
  test("N12 with the Agents tab open a session cost change moves the Agents dollars to the new session figure and they equal Spend's row", async ($, on) => {
    const world = diskWorldOf(on);
    putSessionTranscripts(world);
    await trackedMainAndAgent($, world);
    await setSessionCost($, world, HALF_OF_TRACKED_USD);
    const pane = await openPane($);
    await showTabThroughArrows(pane, AGENTS);
    await quiet();
    await settle(pane);
    const grown = growSubagentTranscript(world);
    await agentRequest($, world, {
      agentId: "agent-1",
      model: OPUS,
      tokens: { input: LATER_AGENT_TOKENS },
      index: 1,
    });

    await setSessionCost($, world, ENGINE_TRACKED_PLUS_BACKGROUND_USD);
    await quiet();
    await settle(pane);

    const cents = await centsOnAgentsTab(pane);
    const [agentRow] = await agentFigures(pane, "reviewer");
    await showTabThroughArrows(pane, "Spend");
    expect(cents).toBe(grown.sessionCents);
    expect(agentRow?.dollars).toBe(await spendRowOf(pane, "reviewer"));
  });

  test("N13 an agent first seen after the first flush window shows the dollars of its transcript count and adds up to Spend's row for its type", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: MAIN_ONE_DOLLAR });
    const agentId = await responseBeforeSpawn($, world, "reviewer", BIG_AGENT, FLUSH_WINDOWS);
    await agentRequest($, world, { agentId, model: OPUS, tokens: SMALL_AGENT, index: 1 });
    await finishAgent($, world, agentId, usageOf(OPUS, SMALL_AGENT));
    const counted = countedAgent([
      { model: OPUS, tokens: BIG_AGENT },
      { model: OPUS, tokens: SMALL_AGENT },
    ]);
    await setSessionCost($, world, 1 + counted.usd);
    const pane = await openPane($);
    await showTabThroughArrows(pane, "Spend");
    const spendRow = await spendRowOf(pane, "reviewer");

    await showTabThroughArrows(pane, AGENTS);

    const [agentRow] = await agentFigures(pane, "reviewer");
    expect(agentRow).toEqual({ tokens: kiloOf(counted.tokens), dollars: dollarsOf(counted.usd) });
    expect(agentRow?.dollars).toBe(spendRow);
  });

  test("N14 one agent that steps on two priced models shows each response at its own model's price", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: MAIN_ONE_DOLLAR });
    const agentId = await spawnAgent($, world, "reviewer");
    await agentRequest($, world, { agentId, model: OPUS, tokens: FIRST_OPUS_STEP, index: 0 });
    await agentRequest($, world, { agentId, model: SONNET, tokens: SECOND_SONNET_STEP, index: 1 });
    await finishAgent($, world, agentId, usageOf(SONNET, SECOND_SONNET_STEP));
    const counted = countedAgent([
      { model: OPUS, tokens: FIRST_OPUS_STEP },
      { model: SONNET, tokens: SECOND_SONNET_STEP },
    ]);
    await setSessionCost($, world, 1 + counted.usd);
    const pane = await openPane($);

    await showTabThroughArrows(pane, AGENTS);

    const [agentRow] = await agentFigures(pane, "reviewer");
    expect(agentRow).toEqual({ tokens: kiloOf(counted.tokens), dollars: dollarsOf(counted.usd) });
  });

  test("N15 with a before-tracking amount each agent shows Spend's row for its type and the Agents rows plus the before-tracking row add up to the session figure", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await setSessionCost($, world, ABOVE_TRACKED_USD);
    await mainTurn($, world, { model: OPUS, tokens: MAIN_ONE_DOLLAR });
    const agentId = await spawnAgent($, world, "reviewer");
    await agentRequest($, world, { agentId, model: OPUS, tokens: BIG_AGENT, index: 0 });
    await finishAgent($, world, agentId, usageOf(OPUS, BIG_AGENT));
    await setSessionCost($, world, ABOVE_TRACKED_USD + 1 + countedSubagent(BIG_AGENT).usd);
    const pane = await openPane($);
    await showTabThroughArrows(pane, "Spend");
    const owners = ownersOf((await blocks(pane))[SPLIT_TITLE]);
    const spendRow = await spendRowOf(pane, "reviewer");
    const beforeTracking = owners.find((owner) => owner.name === BEFORE_TRACKING)?.dollars ?? null;
    expect(beforeTracking, "the before-tracking row").not.toBeNull();

    await showTabThroughArrows(pane, AGENTS);

    const [agentRow] = await agentFigures(pane, "reviewer");
    expect(agentRow?.dollars).toBe(spendRow);
    expect((await centsOnAgentsTab(pane)) + toCents(beforeTracking)).toBe(
      toCents(dollarsOf(ABOVE_TRACKED_USD + 1 + countedSubagent(BIG_AGENT).usd)),
    );
  });

  test("N16 the Agents tab names what its token figure counts with the same label text Spend uses, once and not on every row", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: OPUS, tokens: MAIN_ONE_DOLLAR });
    const first = await spawnAgent($, world, "reviewer");
    const second = await spawnAgent($, world, "reviewer");
    await agentRequest($, world, { agentId: first, model: OPUS, tokens: BIG_AGENT, index: 0 });
    await agentRequest($, world, { agentId: second, model: OPUS, tokens: SMALL_AGENT, index: 0 });
    await finishAgent($, world, first, usageOf(OPUS, BIG_AGENT));
    await finishAgent($, world, second, usageOf(OPUS, SMALL_AGENT));
    await setSessionCost($, world, AMPLE_SESSION_USD);
    const pane = await openPane($);

    await showTabThroughArrows(pane, AGENTS);

    const labelled = (await lines(pane)).filter((line) =>
      line.text.includes(spendModel.TOKENS_BILLED_LABEL),
    );
    expect(labelled.map((line) => line.text)).toEqual([LABEL_TEXT]);
    expect(spendModel.TOKENS_BILLED_LABEL).toBe(LABEL_TEXT);
  });
});

type Figures = { tokens: string; dollars: string | null };

function countedSubagent(tokens: Tokens): { usd: number; tokens: number } {
  const lines = [
    assistantLine({
      id: "r1",
      at: ORACLE_AT,
      sessionId: "s",
      model: OPUS,
      input: tokens.input ?? 0,
      output: tokens.output ?? 0,
      write5m: tokens.write ?? 0,
      read: tokens.read ?? 0,
    }),
  ];
  const oracle = oracleOf([{ path: "-p/s/subagents/agent-1.jsonl", ...transcriptOf(lines) }], {
    now: ORACLE_NOW,
    containers: [],
  });
  const tally = oracle.sessions[0]?.windows.lifetime.subagents;
  return { usd: tally?.usd ?? Number.NaN, tokens: tokenSum(tally) };
}

type Step = { model: string; tokens: Tokens };

function countedAgent(steps: Step[]): { usd: number; tokens: number } {
  const lines = steps.map((step, index) =>
    assistantLine({
      id: `r${index}`,
      at: ORACLE_AT + index,
      sessionId: "s",
      model: step.model,
      input: step.tokens.input ?? 0,
      output: step.tokens.output ?? 0,
      write5m: step.tokens.write ?? 0,
      read: step.tokens.read ?? 0,
    }),
  );
  const oracle = oracleOf([{ path: "-p/s/subagents/agent-1.jsonl", ...transcriptOf(lines) }], {
    now: ORACLE_NOW,
    containers: [],
  });
  const tally = oracle.sessions[0]?.windows.lifetime.subagents;
  return { usd: tally?.usd ?? Number.NaN, tokens: tokenSum(tally) };
}

function tokenSum(tally: OracleTokens | undefined): number {
  return tally === undefined
    ? Number.NaN
    : tally.input + tally.output + tally.write5m + tally.write1h + tally.read;
}

function kiloOf(tokens: number): string {
  return `${tokens / MILLI}k`;
}

function dollarsOf(usd: number): string {
  return `~$${usd.toFixed(2)}`;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function sortedByTokens(rows: Figures[]): Figures[] {
  return [...rows].sort((a, b) => a.tokens.localeCompare(b.tokens));
}

async function spendRowOf(pane: Pane, owner: string): Promise<string> {
  const row = ownersOf((await blocks(pane))[SPLIT_TITLE]).find((one) => one.name === owner);
  return row?.dollars ?? "";
}

async function agentsScreen(pane: Pane): Promise<string[]> {
  return screenRows(await pane.drawn(), COLUMNS).map((row) => row.trim());
}

async function mainRowText(pane: Pane): Promise<string> {
  return (await agentsScreen(pane)).find((row) => row.startsWith("○ main")) ?? "";
}

async function agentFigures(pane: Pane, type: string): Promise<Figures[]> {
  const row = new RegExp(`${type} · .*?\\s(\\d+(?:\\.\\d)?k?)\\s+((?:~|<)\\$\\d+\\.\\d{2})?\\s*▸$`);
  return (await agentsScreen(pane)).flatMap((text) => {
    const match = row.exec(text);
    return match === null ? [] : [{ tokens: match[1] ?? "", dollars: match[2] ?? null }];
  });
}

async function trackedCentsOnSpend(pane: Pane): Promise<number> {
  await showTabThroughArrows(pane, "Spend");
  return spendSessionCents(pane);
}

async function spendSessionCents(pane: Pane): Promise<number> {
  return toCents(totalsOf(await lines(pane))?.usd ?? null);
}

async function seedStaleTotal(pane: Pane, world: World, trackedCents: number): Promise<void> {
  seedTotals(world, totalsAtom({ session: trackedCents / CENTS_PER_USD / STALE_DIVISOR }));
  await settle(pane);
}

async function headerCentsOf(pane: Pane): Promise<number> {
  const header = (await agentsScreen(pane)).find((row) => /\d+ done/.test(row)) ?? "";
  return toCents(/(?:~|<)\$\d+\.\d{2}/.exec(header)?.[0] ?? null);
}

async function agentsFigures(pane: Pane): Promise<string[]> {
  return (await agentsScreen(pane)).filter((row) => /(?:~|<)\$\d+\.\d{2}/.test(row));
}

async function centsOnAgentsTab(pane: Pane): Promise<number> {
  const main = /(?:~|<)\$\d+\.\d{2}$/.exec(await mainRowText(pane))?.[0];
  const agents = [...(await agentFigures(pane, "reviewer"))].map((row) => row.dollars);
  return sum([main ?? null, ...agents].map(toCents));
}

async function trackedMainAndAgent($: Engine, world: World): Promise<void> {
  await mainTurn($, world, { model: OPUS, tokens: MAIN_ONE_DOLLAR });
  const agentId = await spawnAgent($, world, "reviewer");
  await agentRequest($, world, { agentId, model: OPUS, tokens: BIG_AGENT, index: 0 });
  await finishAgent($, world, agentId, usageOf(OPUS, BIG_AGENT));
}

async function responseBeforeSpawn(
  $: Engine,
  world: World,
  type: string,
  tokens: Tokens,
  flushWindows = 0,
): Promise<string> {
  const agentId = `agent-${world.spawned + 1}`;
  world.stepUsage = usageOf(OPUS, tokens);
  const stream = $.turn.step({
    turnId: `run-${agentId}`,
    index: 0,
    model: OPUS,
    effort: "high",
    messageCount: 1,
    agentId,
  } as never);
  for await (const _chunk of stream) continue;
  await world.clock.advance(flushWindows * FLUSH_MS);
  const spawned = await spawnAgent($, world, type);
  expect(spawned).toBe(agentId);
  return agentId;
}

async function figuresOn(pane: Pane, types: string[]): Promise<Figures[][]> {
  await showTabThroughArrows(pane, AGENTS);
  return Promise.all(types.map((type) => agentFigures(pane, type)));
}

async function restoreSpendOnly($: Engine, world: World, cost: number): Promise<void> {
  const agents = world.state.get(AGENTS_STATE_KEY);
  await reloadPlugin($, world);
  if (agents !== undefined) {
    world.state.set(AGENTS_STATE_KEY, { ...agents, value: withoutCounters(agents.value) });
  }
  await setSessionCost($, world, cost);
}

function withoutCounters(tree: unknown): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(tree as Record<string, Record<string, unknown>>).map(([id, node]) => [
      id,
      Object.fromEntries(Object.entries(node).filter(([field]) => !COUNTER_FIELDS.includes(field))),
    ]),
  );
}

function putSessionTranscripts(world: DiskWorld): void {
  const at = world.clock.now() - MS_PER_HOUR;
  const write = (path: string, line: string): void => world.disk.writeLines(path, [line], at);
  write(
    `${OWN_DIR}/${OWN_SESSION}.jsonl`,
    assistantLine({
      id: "m1",
      at,
      sessionId: OWN_SESSION,
      cwd: WORK_CWD,
      model: OPUS,
      input: MAIN_TRANSCRIPT_TOKENS,
    }),
  );
  write(
    `${OWN_DIR}/${OWN_SESSION}/subagents/agent-1.jsonl`,
    assistantLine({
      id: "s1",
      at,
      sessionId: OWN_SESSION,
      cwd: WORK_CWD,
      model: OPUS,
      write5m: AGENT_TRANSCRIPT_TOKENS,
    }),
  );
}

function growSubagentTranscript(world: DiskWorld): { sessionCents: number } {
  const at = world.clock.now() - MS_PER_HOUR;
  const main = transcriptLine("m1", at, { input: MAIN_TRANSCRIPT_TOKENS });
  const first = transcriptLine("s1", at, { write5m: AGENT_TRANSCRIPT_TOKENS });
  const later = transcriptLine("s2", at + 1, { input: LATER_AGENT_TOKENS });
  world.disk.writeLines(`${OWN_DIR}/${OWN_SESSION}/subagents/agent-1.jsonl`, [first, later], at);
  const oracle = oracleOf(
    [
      { path: `${OWN_DIR}/${OWN_SESSION}.jsonl`, ...transcriptOf([main]) },
      {
        path: `${OWN_DIR}/${OWN_SESSION}/subagents/agent-1.jsonl`,
        ...transcriptOf([first, later]),
      },
    ],
    { now: world.clock.now(), containers: [] },
  );
  const session = oracle.sessions[0]?.windows.lifetime;
  const usd = (session?.main.usd ?? 0) + (session?.subagents.usd ?? 0);
  return { sessionCents: Math.round(usd * CENTS_PER_USD) };
}

function transcriptLine(
  id: string,
  at: number,
  tokens: { input?: number; write5m?: number },
): string {
  return assistantLine({
    id,
    at,
    sessionId: OWN_SESSION,
    cwd: WORK_CWD,
    model: OPUS,
    ...tokens,
  });
}

async function quiet(): Promise<void> {
  for (let round = 0; round < SETTLE_ROUNDS; round++) {
    for (let at = 0; at < QUIET_TICKS; at++) await Promise.resolve();
  }
}
