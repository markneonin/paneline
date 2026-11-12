import {
  MONTH_DAYS,
  MS_PER_DAY,
  costOf,
  mergeCall,
  projectNamesOf,
} from "../../hooks/transcript-cost";
import type { CallRow, CostStore, FileState } from "../../hooks/transcript-cost";
import { priceOf } from "../../hooks/spend-model";

const SYNTHETIC_MODEL = "<synthetic>";
const WEEK_DAYS = 7;
const NO_TOKENS: Tokens = { input: 0, output: 0, write5m: 0, write1h: 0, read: 0 };
const NO_TALLY: Tally = { ...NO_TOKENS, usd: 0, advisorUsd: 0, calls: 0 };

type Tokens = {
  input: number;
  output: number;
  write5m: number;
  write1h: number;
  read: number;
};

export type Tally = Tokens & { usd: number; advisorUsd: number; calls: number };

export type SessionTally = {
  dir: string;
  sessionId: string;
  main: Tally;
  subagents: Tally;
};

export type ProjectTally = Tally & { project: string };

export type ModelTally = Tally & { model: string };

export type Sums = {
  today: Tally;
  week: Tally;
  month: Tally;
  sessions: SessionTally[];
  projects: ProjectTally[];
  unknownModels: ModelTally[];
};

export type SumsOptions = {
  now: number;
  dayStart: number;
  containers: readonly string[];
};

export type Progress = { doneBytes: number; totalBytes: number; failed: number };

export type SavedFile = { state: FileState; rows: readonly CallRow[] };

export type MemoryCostStore = CostStore & {
  sums(options: SumsOptions): Sums;
  saved(): readonly SavedFile[];
  progressLog(): readonly Progress[];
};

type Priced = { usd: number; advisorUsd: number; isUnknown: boolean };

type Billed = { call: CallRow; priced: Priced };

export function memoryCostStore(
  options: { onSaveFile?: (state: FileState) => void } = {},
): MemoryCostStore {
  const calls = new Map<string, CallRow>();
  const files = new Map<string, FileState>();
  const saved: SavedFile[] = [];
  const progress: Progress[] = [];
  return {
    async saveFile(state, rows) {
      for (const row of rows) addCall(calls, row);
      files.set(state.path, state);
      saved.push({ state, rows });
      options.onSaveFile?.(state);
    },
    async files() {
      return [...files.values()];
    },
    async saveProgress(next) {
      progress.push(next);
    },
    sums: (sumsOptions) => sumsOf([...calls.values()], sumsOptions),
    saved: () => saved,
    progressLog: () => progress,
  };
}

export function sumsOf(rows: readonly CallRow[], options: SumsOptions): Sums {
  const merged = new Map<string, CallRow>();
  for (const row of rows) addCall(merged, row);
  const billed = [...merged.values()]
    .filter((call) => call.at <= options.now)
    .map((call): Billed => ({ call, priced: pricedOf(call) }));
  const monthStart = options.now - MONTH_DAYS * MS_PER_DAY;
  const month = billed.filter(({ call }) => call.at >= monthStart);
  const projectOf = projectNamesOf(
    billed.map(({ call }) => call.credit.dir),
    options.containers,
  );
  return {
    today: tallySince(billed, options.dayStart),
    week: tallySince(billed, options.now - WEEK_DAYS * MS_PER_DAY),
    month: tallySince(billed, monthStart),
    sessions: sessionTallies(billed),
    projects: projectTallies(month, projectOf),
    unknownModels: unknownModelTallies(month),
  };
}

function addCall(rows: Map<string, CallRow>, row: CallRow): void {
  const seen = rows.get(row.id);
  rows.set(row.id, seen === undefined ? row : mergeCall(seen, row));
}

function pricedOf(call: CallRow): Priced {
  return {
    usd: costOf(call),
    advisorUsd: costOf({ ...call, model: SYNTHETIC_MODEL, searches: 0 }),
    isUnknown: isUnpriced(call, call.model) || call.advisors.some((a) => isUnpriced(a, a.model)),
  };
}

function isUnpriced(tokens: Tokens, model: string): boolean {
  if (model === SYNTHETIC_MODEL) return false;
  const prompt = tokens.input + tokens.read + tokens.write5m + tokens.write1h;
  return priceOf(model, prompt) === undefined;
}

function tallyOf({ call, priced }: Billed): Tally {
  return {
    input: call.input,
    output: call.output,
    write5m: call.write5m,
    write1h: call.write1h,
    read: call.read,
    usd: priced.usd,
    advisorUsd: priced.advisorUsd,
    calls: 1,
  };
}

function tallySince(billed: readonly Billed[], since: number): Tally {
  return sumTallies(billed.filter(({ call }) => call.at >= since).map(tallyOf));
}

function sessionTallies(billed: readonly Billed[]): SessionTally[] {
  const sessions = new Map<string, SessionTally>();
  for (const entry of billed) {
    const { dir, session, isSubagent } = entry.call.credit;
    const key = `${dir}/${session}`;
    const row = sessions.get(key) ?? {
      dir,
      sessionId: session,
      main: NO_TALLY,
      subagents: NO_TALLY,
    };
    const tally = tallyOf(entry);
    sessions.set(
      key,
      isSubagent
        ? { ...row, subagents: addTally(row.subagents, tally) }
        : { ...row, main: addTally(row.main, tally) },
    );
  }
  return [...sessions.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row);
}

function projectTallies(
  month: readonly Billed[],
  projectOf: ReadonlyMap<string, string>,
): ProjectTally[] {
  const groups = groupBy(month, ({ call }) => projectOf.get(call.credit.dir) ?? call.credit.dir);
  return [...groups].map(([project, group]) => ({
    project,
    ...sumTallies(group.map(tallyOf)),
  }));
}

function unknownModelTallies(month: readonly Billed[]): ModelTally[] {
  const groups = groupBy(
    month.filter(({ priced }) => priced.isUnknown),
    ({ call }) => call.model,
  );
  return [...groups]
    .map(([model, group]) => ({ model, ...sumTallies(group.map(tallyOf)) }))
    .sort((a, b) => a.model.localeCompare(b.model));
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

function addTally(a: Tally, b: Tally): Tally {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    write5m: a.write5m + b.write5m,
    write1h: a.write1h + b.write1h,
    read: a.read + b.read,
    usd: a.usd + b.usd,
    advisorUsd: a.advisorUsd + b.advisorUsd,
    calls: a.calls + b.calls,
  };
}

function sumTallies(tallies: readonly Tally[]): Tally {
  return tallies.reduce(addTally, NO_TALLY);
}
