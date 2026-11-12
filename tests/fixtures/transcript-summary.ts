import type { Sums } from "./transcript-memory-store";
import type { Oracle } from "../transcript-oracle";

const MICROS_PER_USD = 100_000_000;

export type Figures = {
  usd: number;
  advisorUsd: number;
  calls: number;
  input: number;
  output: number;
  write5m: number;
  write1h: number;
  read: number;
};

export type Summary = {
  today: Figures;
  week: Figures;
  month: Figures;
  sessions: { key: string; main: Figures; subagents: Figures }[];
  projects: ({ name: string } & Figures)[];
  unknownModels: ({ name: string } & Figures)[];
};

export function summaryOfSums(sums: Sums): Summary {
  return {
    today: figuresOf(sums.today),
    week: figuresOf(sums.week),
    month: figuresOf(sums.month),
    sessions: sums.sessions
      .map((row) => ({
        key: `${row.dir}/${row.sessionId}`,
        main: figuresOf(row.main),
        subagents: figuresOf(row.subagents),
      }))
      .sort(byKey),
    projects: sums.projects
      .filter((row) => row.calls > 0)
      .map((row) => ({ name: row.project, ...figuresOf(row) }))
      .sort(byName),
    unknownModels: sums.unknownModels
      .map((row) => ({ name: row.model, ...figuresOf(row) }))
      .sort(byName),
  };
}

export function summaryOfOracle(oracle: Oracle): Summary {
  return {
    today: figuresOf(oracle.totals.today),
    week: figuresOf(oracle.totals.week),
    month: figuresOf(oracle.totals.month),
    sessions: oracle.sessions
      .map((row) => ({
        key: `${row.projectDir}/${row.sessionId}`,
        main: figuresOf(row.windows.lifetime.main),
        subagents: figuresOf(row.windows.lifetime.subagents),
      }))
      .sort(byKey),
    projects: [...oracle.byRepo]
      .filter(([, tally]) => tally.calls > 0)
      .map(([name, tally]) => ({ name, ...figuresOf(tally) }))
      .sort(byName),
    unknownModels: [...oracle.unknownModels]
      .map(([name, tally]) => ({ name, ...figuresOf(tally) }))
      .sort(byName),
  };
}

function figuresOf(tally: {
  usd: number;
  advisorUsd: number;
  calls: number;
  input: number;
  output: number;
  write5m: number;
  write1h: number;
  read: number;
}): Figures {
  return {
    usd: Math.round(tally.usd * MICROS_PER_USD),
    advisorUsd: Math.round(tally.advisorUsd * MICROS_PER_USD),
    calls: tally.calls,
    input: tally.input,
    output: tally.output,
    write5m: tally.write5m,
    write1h: tally.write1h,
    read: tally.read,
  };
}

function byKey(a: { key: string }, b: { key: string }): number {
  return a.key.localeCompare(b.key);
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}
