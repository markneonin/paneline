export const PRICE_SOURCE = {
  url: "https://platform.claude.com/docs/en/about-claude/pricing",
  fetched: "2026-10-29",
};
export const SYNTHETIC_MODEL = "<synthetic>";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WEEK_DAYS = 7;
const MONTH_DAYS = 30;
const TOKENS_PER_MTOK = 1_000_000;
const USD_PER_SEARCH = 0.01;
const FAST_MULTIPLIER = 2;
const US_GEO_MULTIPLIER = 1.1;
const HAIKU_LONG_PROMPT_TOKENS = 100_000;
const HAIKU_5_5 = "claude-haiku-5-5";

export type Rates = {
  input: number;
  write5m: number;
  write1h: number;
  read: number;
  output: number;
};

function rates(input: number, write5m: number, write1h: number, read: number, output: number) {
  return { input, write5m, write1h, read, output } satisfies Rates;
}

export const PRICES_PER_MTOK: Readonly<Record<string, Rates>> = {
  "claude-fable-5-1": rates(10, 12.5, 20, 0.25, 50),
  "claude-mythos-5-1": rates(10, 12.5, 20, 0.25, 50),
  "claude-fable-5": rates(10, 12.5, 20, 1, 50),
  "claude-mythos-5": rates(10, 12.5, 20, 1, 50),
  "claude-opus-5-5": rates(4, 5, 8, 0.2, 20),
  "claude-opus-5": rates(5, 6.25, 10, 0.5, 25),
  "claude-opus-4-8": rates(5, 6.25, 10, 0.5, 25),
  "claude-opus-4-7": rates(5, 6.25, 10, 0.5, 25),
  "claude-opus-4-6": rates(5, 6.25, 10, 0.5, 25),
  "claude-opus-4-5-20251101": rates(5, 6.25, 10, 0.5, 25),
  "claude-sonnet-5-5": rates(2, 2.5, 4, 0.1, 10),
  "claude-sonnet-5": rates(2, 2.5, 4, 0.2, 10),
  "claude-sonnet-4-6": rates(3, 3.75, 6, 0.3, 15),
  "claude-sonnet-4-5-20250929": rates(3, 3.75, 6, 0.3, 15),
  [HAIKU_5_5]: rates(0.1, 0.125, 0.2, 0.01, 0.5),
  "claude-haiku-4-5-20251001": rates(1, 1.25, 2, 0.1, 5),
};

const HAIKU_5_5_LONG_PROMPT_RATES = rates(0.5, 0.625, 1, 0.05, 2.5);
const FAST_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-opus-4-8"]);
const MODEL_ALIASES: Readonly<Record<string, string>> = {
  "claude-opus-4-5": "claude-opus-4-5-20251101",
  "claude-sonnet-4-5": "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5": "claude-haiku-4-5-20251001",
};

export type Tokens = {
  input: number;
  output: number;
  write5m: number;
  write1h: number;
  read: number;
};

export type AdvisorUse = Tokens & { model: string };

export type Call = Tokens & {
  id: string;
  sessionId: string;
  at: number;
  model: string;
  searches: number;
  isFast: boolean;
  isUsGeo: boolean;
  advisors: AdvisorUse[];
};

export type Transcript = { startedAt: number; calls: Call[] };
export type Source = Transcript & { path: string };

export type Tally = Tokens & { usd: number; advisorUsd: number; calls: number };
export type Split = { main: Tally; subagents: Tally };
export type WindowName = "lifetime" | "today" | "week" | "month";
export type SessionRow = {
  sessionId: string;
  projectDir: string;
  windows: Record<WindowName, Split>;
};

export type Options = { now: number; containers: readonly string[] };

export type Oracle = {
  sessions: SessionRow[];
  totals: Record<"today" | "week" | "month", Tally>;
  byDir: Map<string, Tally>;
  byRepo: Map<string, Tally>;
  repoOfDir: Map<string, string>;
  unmappedDirs: string[];
  models: Map<string, Tally>;
  unknownModels: Map<string, Tally>;
};

type RawUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
  server_tool_use?: { web_search_requests?: number };
  speed?: string;
  inference_geo?: string;
  iterations?: (RawUsage & { type?: string; model?: string })[];
};

type RawLine = {
  type?: string;
  sessionId?: string;
  timestamp?: string;
  message?: { id?: string; model?: string; usage?: RawUsage };
};

const WINDOW_NAMES: readonly WindowName[] = ["lifetime", "today", "week", "month"];
const ASSISTANT_TYPE = /"type"\s*:\s*"assistant"/;
const FIRST_TIMESTAMP = /"timestamp"\s*:\s*"([^"]+)"/;
const SCRATCHPAD_DIR =
  /^-private-tmp-claude-502-(-.+?)-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}-scratchpad/;

export function transcriptOf(lines: Iterable<string>): Transcript {
  const byId = new Map<string, Call>();
  let startedAt = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (startedAt === Number.POSITIVE_INFINITY) startedAt = timestampOf(line);
    const call = callOfLine(line);
    if (call === undefined) continue;
    const seen = byId.get(call.id);
    byId.set(call.id, seen === undefined ? call : mergedCalls(seen, call));
  }
  return { startedAt, calls: [...byId.values()] };
}

export function oracleOf(sources: readonly Source[], options: Options): Oracle {
  const starts = windowStarts(options.now);
  const sessions = new Map<string, SessionRow>();
  const models = new Map<string, Tally>();
  const unknownModels = new Map<string, Tally>();
  for (const { path, call } of ownedCalls(sources)) {
    if (call.at > options.now) continue;
    const place = placeOf(path);
    const key = `${place.projectDir}/${place.sessionId}`;
    const row = sessions.get(key) ?? emptySession(place.projectDir, place.sessionId);
    sessions.set(key, row);
    const priced = priceOf(call);
    for (const name of WINDOW_NAMES) {
      if (call.at < starts[name]) continue;
      addTo(row.windows[name][place.isSubagent ? "subagents" : "main"], call, priced);
    }
    if (call.at >= starts.month) {
      addTo(tallyIn(models, call.model), call, priced);
      if (priced.isUnknown) addTo(tallyIn(unknownModels, call.model), call, priced);
    }
  }
  const rows = [...sessions.values()];
  const repos = repoRollup([...new Set(rows.map((row) => row.projectDir))], options.containers);
  return {
    sessions: rows,
    totals: {
      today: totalOf(rows, "today"),
      week: totalOf(rows, "week"),
      month: totalOf(rows, "month"),
    },
    byDir: tallyBy(rows, (row) => row.projectDir),
    byRepo: tallyBy(rows, (row) => repos.repoOfDir.get(row.projectDir) ?? row.projectDir),
    repoOfDir: repos.repoOfDir,
    unmappedDirs: repos.unmappedDirs,
    models,
    unknownModels,
  };
}

export function repoRollup(
  dirs: readonly string[],
  containers: readonly string[],
): { repoOfDir: Map<string, string>; unmappedDirs: string[] } {
  const known = new Set(dirs);
  const repoOfDir = new Map<string, string>();
  for (const dir of dirs) {
    const origin = SCRATCHPAD_DIR.exec(dir)?.[1] ?? dir;
    known.add(origin);
    repoOfDir.set(dir, origin);
  }
  for (const [dir, origin] of repoOfDir) {
    const roots = [...known]
      .filter((other) => origin.startsWith(`${other}-`) && !containers.includes(other))
      .sort((a, b) => a.length - b.length);
    repoOfDir.set(dir, roots[0] ?? origin);
  }
  const unmappedDirs = dirs.filter(
    (dir) =>
      !containers.some((container) => (repoOfDir.get(dir) ?? dir).startsWith(`${container}-`)),
  );
  return { repoOfDir, unmappedDirs };
}

export function shortName(dir: string, containers: readonly string[]): string {
  const parents = containers
    .filter((container) => dir.startsWith(`${container}-`))
    .sort((a, b) => a.length - b.length);
  return parents[0] === undefined ? dir : dir.slice(parents[0].length + 1);
}

export function emptyTally(): Tally {
  return { input: 0, output: 0, write5m: 0, write1h: 0, read: 0, usd: 0, advisorUsd: 0, calls: 0 };
}

export function sumTally(tallies: readonly Tally[]): Tally {
  const total = emptyTally();
  for (const tally of tallies) {
    for (const field of Object.keys(total) as (keyof Tally)[]) total[field] += tally[field];
  }
  return total;
}

export function splitTotal(split: Split): Tally {
  return sumTally([split.main, split.subagents]);
}

type Priced = { usd: number; advisorUsd: number; isUnknown: boolean };

export function priceOf(call: Call): Priced {
  const own = pricedTokens(call, call.model, call);
  const advisors = call.advisors.map((advisor) => pricedTokens(advisor, advisor.model, call));
  const advisorUsd = advisors.reduce((total, advisor) => total + advisor.usd, 0);
  return {
    usd: own.usd + call.searches * USD_PER_SEARCH + advisorUsd,
    advisorUsd,
    isUnknown: own.isUnknown || advisors.some((advisor) => advisor.isUnknown),
  };
}

function pricedTokens(
  tokens: Tokens,
  model: string,
  call: Call,
): { usd: number; isUnknown: boolean } {
  if (model === SYNTHETIC_MODEL) return { usd: 0, isUnknown: false };
  const id = MODEL_ALIASES[model] ?? model;
  const rate = ratesFor(id, tokens);
  if (rate === undefined) return { usd: 0, isUnknown: true };
  const multiplier =
    (call.isFast && FAST_MODELS.has(id) ? FAST_MULTIPLIER : 1) *
    (call.isUsGeo ? US_GEO_MULTIPLIER : 1);
  const perMtok =
    tokens.input * rate.input +
    tokens.write5m * rate.write5m +
    tokens.write1h * rate.write1h +
    tokens.read * rate.read +
    tokens.output * rate.output;
  return { usd: (perMtok * multiplier) / TOKENS_PER_MTOK, isUnknown: false };
}

function ratesFor(id: string, tokens: Tokens): Rates | undefined {
  const isLongHaiku =
    id === HAIKU_5_5 &&
    tokens.input + tokens.read + tokens.write5m + tokens.write1h > HAIKU_LONG_PROMPT_TOKENS;
  return isLongHaiku ? HAIKU_5_5_LONG_PROMPT_RATES : PRICES_PER_MTOK[id];
}

function callOfLine(line: string): Call | undefined {
  if (!line.includes('"usage"') || !ASSISTANT_TYPE.test(line)) return undefined;
  const entry = parsedLine(line);
  const usage = entry?.message?.usage;
  const id = entry?.message?.id;
  const model = entry?.message?.model;
  if (entry === undefined || usage === undefined || id === undefined || model === undefined) {
    return undefined;
  }
  if (entry.type !== "assistant") return undefined;
  const at = Date.parse(entry.timestamp ?? "");
  if (Number.isNaN(at)) return undefined;
  const iterations = usage.iterations ?? [];
  const messageTokens = sumTokens(
    iterations.filter((iteration) => iteration.type === "message").map(tokensOf),
  );
  return {
    ...maxTokens(tokensOf(usage), messageTokens),
    id,
    sessionId: entry.sessionId ?? "",
    at,
    model,
    searches: usage.server_tool_use?.web_search_requests ?? 0,
    isFast: usage.speed === "fast",
    isUsGeo: usage.inference_geo === "us",
    advisors: iterations
      .filter((iteration) => iteration.type === "advisor_message")
      .map((iteration) => ({ ...tokensOf(iteration), model: iteration.model ?? "" })),
  };
}

function timestampOf(line: string): number {
  const at = Date.parse(FIRST_TIMESTAMP.exec(line)?.[1] ?? "");
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at;
}

function parsedLine(line: string): RawLine | undefined {
  try {
    return JSON.parse(line) as RawLine;
  } catch {
    return undefined;
  }
}

function tokensOf(usage: RawUsage): Tokens {
  const breakdown = usage.cache_creation;
  const created = usage.cache_creation_input_tokens ?? 0;
  return {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    write5m: breakdown === undefined ? created : (breakdown.ephemeral_5m_input_tokens ?? 0),
    write1h: breakdown?.ephemeral_1h_input_tokens ?? 0,
    read: usage.cache_read_input_tokens ?? 0,
  };
}

function sumTokens(parts: readonly Tokens[]): Tokens {
  return {
    input: parts.reduce((total, part) => total + part.input, 0),
    output: parts.reduce((total, part) => total + part.output, 0),
    write5m: parts.reduce((total, part) => total + part.write5m, 0),
    write1h: parts.reduce((total, part) => total + part.write1h, 0),
    read: parts.reduce((total, part) => total + part.read, 0),
  };
}

function maxTokens(a: Tokens, b: Tokens): Tokens {
  return {
    input: Math.max(a.input, b.input),
    output: Math.max(a.output, b.output),
    write5m: Math.max(a.write5m, b.write5m),
    write1h: Math.max(a.write1h, b.write1h),
    read: Math.max(a.read, b.read),
  };
}

function mergedCalls(a: Call, b: Call): Call {
  return {
    ...a,
    ...maxTokens(a, b),
    at: Math.min(a.at, b.at),
    searches: Math.max(a.searches, b.searches),
    advisors: b.advisors.length > a.advisors.length ? b.advisors : a.advisors,
  };
}

function ownedCalls(sources: readonly Source[]): { path: string; call: Call }[] {
  const ordered = sources
    .filter((source) => source.calls.length > 0)
    .sort((a, b) => a.startedAt - b.startedAt || a.path.localeCompare(b.path));
  const owned = new Map<string, { path: string; call: Call }>();
  for (const source of ordered) {
    for (const call of source.calls) {
      const seen = owned.get(call.id);
      if (seen === undefined) {
        owned.set(call.id, { path: source.path, call });
        continue;
      }
      const isTakenOver = !isHomeOf(seen) && isHomeOf({ path: source.path, call });
      owned.set(call.id, {
        path: isTakenOver ? source.path : seen.path,
        call: {
          ...mergedCalls(seen.call, call),
          sessionId: isTakenOver ? call.sessionId : seen.call.sessionId,
        },
      });
    }
  }
  return [...owned.values()];
}

function isHomeOf(owner: { path: string; call: Call }): boolean {
  return placeOf(owner.path).sessionId === owner.call.sessionId;
}

function placeOf(path: string): { projectDir: string; sessionId: string; isSubagent: boolean } {
  const [projectDir = "", second = "", ...rest] = path.split("/");
  return rest.length === 0
    ? { projectDir, sessionId: second.replace(/\.jsonl$/, ""), isSubagent: false }
    : { projectDir, sessionId: second, isSubagent: true };
}

function windowStarts(now: number): Record<WindowName, number> {
  return {
    lifetime: Number.NEGATIVE_INFINITY,
    today: new Date(now).setHours(0, 0, 0, 0),
    week: now - WEEK_DAYS * MS_PER_DAY,
    month: now - MONTH_DAYS * MS_PER_DAY,
  };
}

function emptySession(projectDir: string, sessionId: string): SessionRow {
  const emptySplit = (): Split => ({ main: emptyTally(), subagents: emptyTally() });
  return {
    sessionId,
    projectDir,
    windows: {
      lifetime: emptySplit(),
      today: emptySplit(),
      week: emptySplit(),
      month: emptySplit(),
    },
  };
}

function addTo(tally: Tally, call: Call, priced: Priced): void {
  tally.input += call.input;
  tally.output += call.output;
  tally.write5m += call.write5m;
  tally.write1h += call.write1h;
  tally.read += call.read;
  tally.usd += priced.usd;
  tally.advisorUsd += priced.advisorUsd;
  tally.calls += 1;
}

function tallyIn(tallies: Map<string, Tally>, key: string): Tally {
  const tally = tallies.get(key) ?? emptyTally();
  tallies.set(key, tally);
  return tally;
}

function totalOf(rows: readonly SessionRow[], name: WindowName): Tally {
  return sumTally(rows.map((row) => splitTotal(row.windows[name])));
}

function tallyBy(
  rows: readonly SessionRow[],
  keyOf: (row: SessionRow) => string,
): Map<string, Tally> {
  const groups = new Map<string, Tally[]>();
  for (const row of rows) {
    const key = keyOf(row);
    groups.set(key, [...(groups.get(key) ?? []), splitTotal(row.windows.month)]);
  }
  return new Map([...groups].map(([key, tallies]) => [key, sumTally(tallies)]));
}
