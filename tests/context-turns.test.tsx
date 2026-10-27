import { describe, expect, test } from "claude-code/testing";
import type { On, SessionContextBreakdown } from "claude-code";
import type { Engine } from "claude-code/testing";

import {
  OPUS,
  SUBSCRIPTION,
  compact,
  lines,
  mainTurn,
  mutedPartsText,
  openPane,
  settle,
  startFreshSession,
  worldOf,
} from "./spend-world";
import type { Pane, World } from "./spend-world";

const WINDOW = 200_000;
const THRESHOLD = 160_000;
const K = 1_000;
const TURNS_TO_COMPACT = /~\d+ turns? to auto-compact/;
const USAGE_ROW = "tokens (";
const TAB_STEPS = 10;
const TURN_TOKENS = { write: 20_000 };

describe("context turns to auto-compact", () => {
  test("G1 after turns that grew the context by 10k and then 20k, with 45k left before auto-compact, the summary says '~3 turns to auto-compact' in muted", async ($, on) => {
    const world = await sessionWith(on, $, 115 * K);
    await contextTurns($, world, [50 * K, 60 * K, 80 * K]);

    const row = await usageRow(await contextPane($));

    expect(row?.text).toContain("~3 turns to auto-compact");
    expect(mutedPartsText(row)).toContain("~3 turns to auto-compact");
  });

  test("G2 with 5k left and turns that grow 10k each, the summary says '~1 turn to auto-compact'", async ($, on) => {
    const world = await sessionWith(on, $, 155 * K);
    await contextTurns($, world, [100 * K, 110 * K]);

    const row = await usageRow(await contextPane($));

    expect(row?.text).toContain("~1 turn to auto-compact");
    expect(row?.text).not.toContain("~1 turns");
  });

  test("G3 the estimate waits for a second main turn: with one turn the summary has no turns line, after the next turn it has one", async ($, on) => {
    const world = await sessionWith(on, $, 115 * K);
    await contextTurns($, world, [50 * K]);
    const pane = await contextPane($);
    const afterOne = (await usageRow(pane))?.text;
    await contextTurns($, world, [60 * K]);
    await settle(pane);
    const afterTwo = (await usageRow(pane))?.text;

    expect(afterOne).toBeDefined();
    expect(afterOne).not.toMatch(TURNS_TO_COMPACT);
    expect(afterTwo).toContain("~5 turns to auto-compact");
  });

  test("G4 a turn that made the context smaller is not counted: 50k, 40k, 60k with 40k left says '~2 turns'", async ($, on) => {
    const world = await sessionWith(on, $, 120 * K);
    await contextTurns($, world, [50 * K, 40 * K, 60 * K]);

    const row = await usageRow(await contextPane($));

    expect(row?.text).toContain("~2 turns to auto-compact");
  });

  test("G5 a compaction restarts the count: right after it, and after one more turn, the line is gone; two turns later it uses only the new growth", async ($, on) => {
    const world = await sessionWith(on, $, 115 * K);
    await contextTurns($, world, [50 * K, 60 * K]);
    const pane = await contextPane($);
    const before = (await usageRow(pane))?.text;
    await compact($, world);
    await contextTurns($, world, [30 * K]);
    await settle(pane);
    const afterCompactTurn = (await usageRow(pane))?.text;
    await contextTurns($, world, [60 * K]);
    await settle(pane);
    const restarted = (await usageRow(pane))?.text;

    expect(before).toContain("~5 turns to auto-compact");
    expect(afterCompactTurn).toBeDefined();
    expect(afterCompactTurn).not.toMatch(TURNS_TO_COMPACT);
    expect(restarted).toContain("~2 turns to auto-compact");
  });
});

async function sessionWith(on: On, $: Engine, used: number): Promise<World> {
  const world = worldOf(on, SUBSCRIPTION);
  world.breakdown = breakdownWith(used);
  await startFreshSession($, world);
  return world;
}

async function contextTurns($: Engine, world: World, sizes: number[]): Promise<void> {
  for (const context of sizes) {
    await mainTurn($, world, { model: OPUS, tokens: TURN_TOKENS, context });
  }
}

async function contextPane($: Engine): Promise<Pane> {
  const pane = await openPane($);
  for (let step = 0; step < TAB_STEPS; step++) {
    const buttons = await pane.findAll({ type: "Button" });
    const context = buttons.find((button) => button.props.label === "Context");
    const next = buttons.find((button) => button.props.label === "›");
    await pane.press({ key: (context ?? next)?.key ?? "" });
    await settle(pane);
    if (context !== undefined) return pane;
  }
  throw new Error("Context tab not reached");
}

async function usageRow(pane: Pane) {
  return (await lines(pane)).find((line) => line.text.includes(USAGE_ROW));
}

function breakdownWith(used: number): SessionContextBreakdown {
  return {
    categories: [],
    totalTokens: used,
    maxTokens: WINDOW,
    rawMaxTokens: WINDOW,
    percentage: Math.round((used / WINDOW) * 100),
    model: "Opus 5.5",
    gridRows: [],
    memoryFiles: [],
    mcpTools: [],
    agents: [],
    skills: { totalSkills: 0, includedSkills: 0, tokens: 0, skillFrontmatter: [] },
    autoCompactThreshold: THRESHOLD,
    isAutoCompactEnabled: true,
  } as unknown as SessionContextBreakdown;
}
