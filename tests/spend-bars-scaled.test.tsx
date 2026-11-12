import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";

import { paneWithTotals, totalsAtom } from "./fixtures/spend-atom";
import type { Block, Line } from "./skills-tree";
import type { Pane, World } from "./spend-world";
import {
  API_KEY,
  HAIKU,
  NARROW_COLUMNS,
  OPUS,
  PROJECTS_TITLE,
  SPLIT_TITLE,
  agentOwner,
  blocks,
  mainTurn,
  ownerRowOf,
  ownersOf,
  setSessionCost,
  spendPane,
  startFreshSession,
  worldOf,
} from "./spend-world";

const WHOLE_SHARE = 100;
const ONE_CELL = 1;
const BAR_CELL = /[▰▱]/g;
const SESSION_USD = 10;
const BIG_USD = 8.4;
const SMALL_USD = 1.6;

type Bar = { percent: number; filled: number; total: number };

describe("spend bars scaled to the share", () => {
  test("A1 a main turn at 95% and an Explore run at 5% under Where it went: the main bar is short of full and the Explore bar is at most one cell", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await startFreshSession($, world);
    await mainTurn($, world, { model: OPUS, tokens: { input: 5_000_000 } });
    await agentOwner($, world, "Explore", HAIKU, { input: 1_000_000 });
    await setSessionCost($, world, SESSION_USD);

    const bars = barsOf((await blocks(await spendPane($)))[SPLIT_TITLE]);

    expect(bars.map((bar) => bar.percent)).toEqual([95, 5]);
    expect(bars.filter(isOffShare)).toEqual([]);
  });

  test("A2 three projects at 50%, 42% and 8% under By project: the 50% project's bar is half full and each bar fills its printed share", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await arrangeThreeProjects($, world);

    const bars = barsOf((await blocks(await threeProjectsPane($, world)))[PROJECTS_TITLE]);

    expect(bars.map((bar) => bar.percent)).toEqual([50, 42, 8]);
    expect(bars.filter(isOffShare)).toEqual([]);
  });

  test("A3 at 60 columns the same three projects: the 50% project's bar is half full and each bar fills its printed share", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await arrangeThreeProjects($, world);

    const bars = barsOf(
      (await blocks(await threeProjectsPane($, world, NARROW_COLUMNS)))[PROJECTS_TITLE],
    );

    expect(bars.map((bar) => bar.percent)).toEqual([50, 42, 8]);
    expect(bars.filter(isOffShare)).toEqual([]);
  });
});

async function arrangeThreeProjects($: Engine, world: World): Promise<void> {
  await startFreshSession($, world);
  await mainTurn($, world, { model: OPUS, tokens: { input: 5_000_000 } });
  await agentOwner($, world, "Explore", HAIKU, { input: 1_000_000 });
  await setSessionCost($, world, SESSION_USD);
}

function threeProjectsPane($: Engine, world: World, columns?: number): Promise<Pane> {
  return paneWithTotals(
    $,
    world,
    totalsAtom({
      month: SESSION_USD + BIG_USD + SMALL_USD,
      projects: [
        { name: "work", usd: SESSION_USD },
        { name: "big", usd: BIG_USD },
        { name: "small", usd: SMALL_USD },
      ],
    }),
    columns,
  );
}

function barsOf(block: Block | undefined): Bar[] {
  return ownersOf(block).map((owner) => ({
    percent: Number.parseInt(owner.percent, 10),
    filled: owner.filled,
    total: cellsOf(ownerRowOf(block, owner.name)),
  }));
}

function cellsOf(row: Line | undefined): number {
  return (row?.text.match(BAR_CELL) ?? []).length;
}

function isOffShare({ percent, filled, total }: Bar): boolean {
  const share = Math.max(ONE_CELL, (percent / WHOLE_SHARE) * total);
  return Math.abs(filled - share) >= ONE_CELL || (percent < WHOLE_SHARE && filled === total);
}
