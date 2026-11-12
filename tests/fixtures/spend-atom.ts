import type { Engine } from "claude-code/testing";

import { settle, spendPane } from "../spend-world";
import type { Pane, World } from "../spend-world";
import { oracleOf, transcriptOf } from "../transcript-oracle";
import { CONTAINERS, OWN_SESSION, WORLD_NOW, worldFiles } from "./spend-world";
import { summaryOfOracle } from "./transcript-summary";
import type { Figures } from "./transcript-summary";

const MICROS_PER_USD = 100_000_000;
const OWN_PROJECT_DIR = "-home-dev-alpha";

export type WorldAtom = {
  at: number;
  rows: [];
  today: number;
  week: number;
  month: number;
  lastHour: number;
  projects: { name: string; usd: number }[];
  session: number | null;
  progress: { doneBytes: number; totalBytes: number; failed: number } | null;
};

export function oracleAtom(): WorldAtom {
  const sources = worldFiles().map((file) => ({ path: file.rel, ...transcriptOf(file.lines) }));
  const wanted = summaryOfOracle(oracleOf(sources, { now: WORLD_NOW, containers: CONTAINERS }));
  const own = wanted.sessions.find((row) => row.key === `${OWN_PROJECT_DIR}/${OWN_SESSION}`);
  return {
    at: WORLD_NOW,
    rows: [],
    today: usdOf(wanted.today),
    week: usdOf(wanted.week),
    month: usdOf(wanted.month),
    lastHour: 1.25,
    projects: wanted.projects.map((project) => ({
      name: folderOfDir(project.name),
      usd: usdOf(project),
    })),
    session: own === undefined ? null : usdOf(own.main) + usdOf(own.subagents),
    progress: null,
  };
}

function folderOfDir(dir: string): string {
  const file = worldFiles().find((candidate) => candidate.rel.startsWith(`${dir}/`));
  return file === undefined ? dir : file.cwd.slice(file.cwd.lastIndexOf("/") + 1);
}

function usdOf(figures: Figures): number {
  return figures.usd / MICROS_PER_USD;
}

const TOTALS_STATE_KEY = "paneline.spendTotals.";

export function seedTotals(world: World, atom: Partial<WorldAtom>): void {
  const base = { at: WORLD_NOW, rows: [] };
  world.state.set(TOTALS_STATE_KEY, { value: { ...base, ...atom }, version: 1 });
}

export async function paneWithTotals(
  $: Engine,
  world: World,
  atom: Partial<WorldAtom>,
  columns?: number,
): Promise<Pane> {
  const pane = await spendPane($, columns);
  seedTotals(world, atom);
  await settle(pane);
  return pane;
}

export function totalsAtom(figures: Partial<WorldAtom>): Partial<WorldAtom> {
  return {
    today: 0,
    week: 0,
    month: 0,
    lastHour: 0,
    projects: [],
    session: null,
    progress: null,
    ...figures,
  };
}
