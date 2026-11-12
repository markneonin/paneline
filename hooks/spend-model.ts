import type { SessionContextBreakdown, TurnUsage } from "claude-code";

import type {
  SpendLastTurn,
  SpendMemory,
  SpendMiss,
  SpendOwner,
  SpendRent,
  SpendState,
  SpendTotals,
} from "../types";
import { MS_PER_SECOND, centsOf, shortModel } from "./format";
import { mcpCommandName } from "./mcp-name";
import { clipEnd, clipStart } from "./text-width";
import { relativePath } from "./paths";
import { isPathTool } from "./tools";

export const MAIN_OWNER = "main";
export const BACKGROUND_OWNER = "background";
export const BEFORE_TRACKING_OWNER = "before tracking";
const NO_AGENT_OWNERS = new Set([MAIN_OWNER, BACKGROUND_OWNER, BEFORE_TRACKING_OWNER]);
const FLOAT_NOISE_USD = 1e-9;
export const SPEND_SESSIONS_KEY = "spendSessions";
const KEPT_SESSIONS = 8;
export const TOKENS_BILLED_LABEL = "tokens billed (cache reads included)";
export const MISS_MIN_TOKENS = 10_000;
export const SMALL_MISS_TOKENS = 2_000;
export const MAX_SPLIT_OWNERS = 5;

const MAX_MISSES = 3;
const KEPT_AGENT_MEMORIES = 50;
const MAX_RENT_ROWS = 5;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const TTL_MS = { "5m": 5 * MS_PER_MINUTE, "1h": 60 * MS_PER_MINUTE } as const;
const TOKENS_PER_MILLION = 1_000_000;
const CHARS_PER_TOKEN = 4;
const CENTS_PER_USD = 100;
const PERCENT = 100;
const FRACTION_DIGITS = 9;
const MIN_SHOWN_SHARE = 0.005;
const RENT_TARGET_CELLS = 120;
const MCP_PREFIX = "mcp__";
const MCP_SEPARATOR = "__";
const MCP_LABEL = "MCP";
const SUMMARY_TOKENS = 2_000;
const MESSAGES_CATEGORY = "Messages";
const AFTER_COMPACTION = "after compaction";
const MODEL_SWITCH = "model switch";
const CACHE_REBUILT = "cache rebuilt";

export type CacheTtl = "5m" | "1h";

export type CacheOption = { name: string; usd: number };

type Price = {
  input: number;
  output: number;
  cacheWrite: Record<CacheTtl, number>;
  cacheRead: number;
};

type PriceRow = Price & {
  match: string;
  longPrompt?: { aboveTokens: number; price: Price };
};

const PRICES: readonly PriceRow[] = [
  {
    match: "fable-5-1",
    input: 10,
    output: 50,
    cacheWrite: { "5m": 12.5, "1h": 20 },
    cacheRead: 0.25,
  },
  {
    match: "mythos-5-1",
    input: 10,
    output: 50,
    cacheWrite: { "5m": 12.5, "1h": 20 },
    cacheRead: 0.25,
  },
  { match: "fable-5", input: 10, output: 50, cacheWrite: { "5m": 12.5, "1h": 20 }, cacheRead: 1 },
  { match: "mythos-5", input: 10, output: 50, cacheWrite: { "5m": 12.5, "1h": 20 }, cacheRead: 1 },
  { match: "opus-5-5", input: 4, output: 20, cacheWrite: { "5m": 5, "1h": 8 }, cacheRead: 0.2 },
  {
    match: "opus-5",
    input: 5,
    output: 25,
    cacheWrite: { "5m": 6.25, "1h": 10 },
    cacheRead: 0.5,
  },
  { match: "opus-4-8", input: 5, output: 25, cacheWrite: { "5m": 6.25, "1h": 10 }, cacheRead: 0.5 },
  { match: "opus-4-7", input: 5, output: 25, cacheWrite: { "5m": 6.25, "1h": 10 }, cacheRead: 0.5 },
  { match: "opus-4-6", input: 5, output: 25, cacheWrite: { "5m": 6.25, "1h": 10 }, cacheRead: 0.5 },
  { match: "opus-4-5", input: 5, output: 25, cacheWrite: { "5m": 6.25, "1h": 10 }, cacheRead: 0.5 },
  {
    match: "opus-4-1",
    input: 15,
    output: 75,
    cacheWrite: { "5m": 18.75, "1h": 30 },
    cacheRead: 1.5,
  },
  { match: "opus-4", input: 15, output: 75, cacheWrite: { "5m": 18.75, "1h": 30 }, cacheRead: 1.5 },
  { match: "sonnet-5-5", input: 2, output: 10, cacheWrite: { "5m": 2.5, "1h": 4 }, cacheRead: 0.1 },
  { match: "sonnet-5", input: 2, output: 10, cacheWrite: { "5m": 2.5, "1h": 4 }, cacheRead: 0.2 },
  {
    match: "sonnet-4-6",
    input: 3,
    output: 15,
    cacheWrite: { "5m": 3.75, "1h": 6 },
    cacheRead: 0.3,
  },
  {
    match: "sonnet-4-5",
    input: 3,
    output: 15,
    cacheWrite: { "5m": 3.75, "1h": 6 },
    cacheRead: 0.3,
  },
  { match: "sonnet-4", input: 3, output: 15, cacheWrite: { "5m": 3.75, "1h": 6 }, cacheRead: 0.3 },
  {
    match: "haiku-5-5",
    input: 0.1,
    output: 0.5,
    cacheWrite: { "5m": 0.125, "1h": 0.2 },
    cacheRead: 0.01,
    longPrompt: {
      aboveTokens: 100_000,
      price: { input: 0.5, output: 2.5, cacheWrite: { "5m": 0.625, "1h": 1 }, cacheRead: 0.05 },
    },
  },
  { match: "haiku-4-5", input: 1, output: 5, cacheWrite: { "5m": 1.25, "1h": 2 }, cacheRead: 0.1 },
  {
    match: "haiku-3-5",
    input: 0.8,
    output: 4,
    cacheWrite: { "5m": 1, "1h": 1.6 },
    cacheRead: 0.08,
  },
];

const FAST_MODEL_MATCHES: readonly string[] = ["opus-5-5", "opus-5", "opus-4-8"];
export const FAST_MULTIPLIER = 2;
export const US_GEO_MULTIPLIER = 1.1;
export const USD_PER_WEB_SEARCH = 0.01;

export const PRICING_KEY = JSON.stringify([
  PRICES,
  FAST_MODEL_MATCHES,
  FAST_MULTIPLIER,
  US_GEO_MULTIPLIER,
  USD_PER_WEB_SEARCH,
]);

export function isFastModel(model: string): boolean {
  return FAST_MODEL_MATCHES.some((match) => model.includes(match));
}

const AGENT_TTL: CacheTtl = "5m";
const NO_OWNER: SpendOwner = { weight: 0, pricedTokens: 0, unpricedTokens: 0 };

export type MainTurn = {
  usage: TurnUsage;
  context: number | undefined;
  startedAt: number;
  endedAt: number;
  fallbackTtl: CacheTtl;
};

export type RentCall = { tool: string; target: string; cwd: string; callId?: string };

export type AgentRequest = {
  agentId: string;
  index: number;
  usage: TurnUsage;
  startedAt: number;
  endedAt: number;
};

export type SplitRow = {
  id?: string;
  name: string;
  model?: string;
  agentIds?: string[];
  cents: number | null;
  share: number;
  percent: number;
  value: number;
  folded?: SplitRow[];
};

type FoldedShare = Omit<SplitRow, "share" | "percent" | "folded">;

export type SplitShare = FoldedShare & { folded?: FoldedShare[] };

export type AgentShare = { cents: number | undefined; tokens: number };

type Weighted = { name: string; value: number; isPriced: boolean };
type OwnerCents = { owners: Weighted[]; cents: number[] };

export function emptySpend(): SpendState {
  return {
    owners: {},
    agents: {},
    mainModel: "",
    cacheReadTokens: 0,
    promptTokens: 0,
    missCount: 0,
    lostUsd: 0,
    misses: [],
    rentTokens: 0,
    rent: [],
    isCompacted: false,
    growthSum: 0,
    growthCount: 0,
    mainCacheTtl: null,
    baselineUsd: null,
    mainMemory: null,
    agentMemories: {},
    lastTurn: null,
  };
}

export function freshSpend(): SpendState {
  return { ...emptySpend(), baselineUsd: 0 };
}

export function hasBaseline(state: SpendState): boolean {
  return typeof state.baselineUsd === "number";
}

export function withBaseline(state: SpendState, sessionUsd: number): SpendState {
  if (hasBaseline(state)) return state;
  const unexplained = sessionUsd - sum(weightedOwners(state).map((owner) => owner.value));
  return {
    ...state,
    baselineUsd: unexplained < FLOAT_NOISE_USD ? 0 : unexplained,
  };
}

export function withSession(
  saved: unknown,
  sessionId: string,
  state: SpendState,
): Record<string, SpendState> {
  const others = Object.entries(savedSpend(saved)).filter(([id]) => id !== sessionId);
  const kept: [string, SpendState][] = [...others, [sessionId, state]];
  return Object.fromEntries(kept.slice(-KEPT_SESSIONS));
}

export function restoredSpend(saved: unknown, sessionId: string): SpendState | undefined {
  const state = savedSpend(saved)[sessionId];
  return state === undefined ? undefined : { ...emptySpend(), ...state };
}

function savedSpend(saved: unknown): Record<string, SpendState> {
  return (saved ?? {}) as Record<string, SpendState>;
}

export function afterCompaction(state: SpendState): SpendState {
  return {
    ...state,
    rentTokens: 0,
    rent: [],
    isCompacted: true,
    growthSum: 0,
    growthCount: 0,
    mainMemory: state.mainMemory && { ...state.mainMemory, size: undefined },
  };
}

export function warmUntilOf(memory: SpendMemory | null): number | undefined {
  return memory?.ttl === undefined ? undefined : memory.endedAt + TTL_MS[memory.ttl];
}

export function baseTokens(breakdown: SessionContextBreakdown): number {
  const messages = breakdown.categories.filter(({ name }) => name === MESSAGES_CATEGORY);
  return breakdown.totalTokens - sum(messages.map(({ tokens }) => tokens));
}

export function nextTurnOptions(
  model: string,
  size: number,
  base: number,
  ttl: CacheTtl,
): CacheOption[] {
  const price = priceOf(model, size);
  const next = nextMessageUsd(model, size, ttl);
  if (price === undefined || next === null) return [];
  const write = price.cacheWrite[ttl];
  const summaryPrompt = base + SUMMARY_TOKENS;
  const perMillion = (tokenCosts: number): number => tokenCosts / TOKENS_PER_MILLION;
  return [
    {
      name: "compact",
      usd: perMillion(size * price.input + SUMMARY_TOKENS * price.output + summaryPrompt * write),
    },
    { name: "clear", usd: perMillion(base * write) },
    { name: "keep going", usd: next.cold },
  ];
}

export type TurnStart = {
  at: number;
  usd: number | undefined;
  tokens: number;
  trackedUsd: number;
};

export type TurnFinish = {
  usd: number | undefined;
  durationMs: number;
  agents: number;
  contextTokens: number | null;
};

export function trackedTokens(state: SpendState): number {
  return sum(Object.values(state.owners).map((owner) => owner.pricedTokens + owner.unpricedTokens));
}

export function trackedUsd(state: SpendState): number {
  return sum(Object.values(state.owners).map((owner) => owner.weight));
}

export function sessionSpendUsd(
  totals: SpendTotals | null,
  engineUsd: number | null,
  state: SpendState,
): number | null {
  const floor = trackedUsd(state) + (state.baselineUsd ?? 0);
  const known = totals?.session ?? (engineUsd !== null && engineUsd > 0 ? engineUsd : null);
  const figure = Math.max(known ?? 0, floor);
  return figure > 0 ? figure : null;
}

export function withLastTurn(state: SpendState, start: TurnStart, finish: TurnFinish): SpendState {
  if (start.usd === undefined || finish.usd === undefined) return state;
  const lastTurn: SpendLastTurn = {
    durationMs: finish.durationMs,
    usd: trackedUsd(state) - start.trackedUsd,
    tokens: trackedTokens(state) - start.tokens,
    agents: finish.agents,
    contextTokens: finish.contextTokens,
  };
  return { ...state, lastTurn };
}

export function nextMessageUsd(
  model: string,
  contextTokens: number,
  ttl: CacheTtl,
): { warm: number; cold: number } | null {
  const price = priceOf(model, contextTokens);
  if (price === undefined) return null;
  return {
    warm: (contextTokens * price.cacheRead) / TOKENS_PER_MILLION,
    cold: (contextTokens * price.cacheWrite[ttl]) / TOKENS_PER_MILLION,
  };
}

export function afterMainResponse(state: SpendState, usage: TurnUsage, ttl: CacheTtl): SpendState {
  return withUsage(state, MAIN_OWNER, usage, ttl);
}

export function afterMainTurn(state: SpendState, turn: MainTurn): SpendState {
  const ttl = state.mainCacheTtl ?? turn.fallbackTtl;
  const counted = {
    ...state,
    mainModel: turn.usage.model,
    ...withGrowth(state, turn.context),
    isCompacted: false,
    mainMemory: { model: turn.usage.model, endedAt: turn.endedAt, size: turn.context, ttl },
  };
  const miss = mainMiss(state, turn, ttl);
  return miss === null ? counted : withMiss(counted, miss);
}

function withGrowth(
  state: SpendState,
  size: number | undefined,
): Pick<SpendState, "growthSum" | "growthCount"> {
  const previous = state.mainMemory?.size;
  const growth = size === undefined || previous === undefined ? 0 : size - previous;
  if (state.isCompacted || growth <= 0) {
    return { growthSum: state.growthSum, growthCount: state.growthCount };
  }
  return { growthSum: state.growthSum + growth, growthCount: state.growthCount + 1 };
}

export function afterAgentRequest(
  carriedState: SpendState,
  owner: string,
  request: AgentRequest,
): SpendState {
  const state = { ...emptySpend(), ...carriedState };
  const rehomed = withAgentOwner(state, request.agentId, owner);
  const known = rehomed.agents[request.agentId] ?? { ...NO_OWNER, owner };
  const remembered = {
    ...withUsage(rehomed, owner, request.usage, AGENT_TTL),
    agents: {
      ...rehomed.agents,
      [request.agentId]: addedUsage(known, request.usage, AGENT_TTL),
    },
    agentMemories: withAgentMemory(state.agentMemories, request),
  };
  const miss = agentMiss(request, state.agentMemories[request.agentId]);
  return miss === null ? remembered : withMiss(remembered, miss);
}

function withAgentOwner(state: SpendState, agentId: string, owner: string): SpendState {
  const agent = state.agents[agentId];
  if (agent === undefined || agent.owner === owner) return state;
  const from = state.owners[agent.owner] ?? NO_OWNER;
  const to = state.owners[owner] ?? NO_OWNER;
  return {
    ...state,
    owners: {
      ...state.owners,
      [agent.owner]: {
        ...from,
        weight: from.weight - agent.weight,
        pricedTokens: from.pricedTokens - agent.pricedTokens,
        unpricedTokens: from.unpricedTokens - agent.unpricedTokens,
      },
      [owner]: {
        ...to,
        weight: to.weight + agent.weight,
        pricedTokens: to.pricedTokens + agent.pricedTokens,
        unpricedTokens: to.unpricedTokens + agent.unpricedTokens,
      },
    },
    agents: { ...state.agents, [agentId]: { ...agent, owner } },
  };
}

export function rentRowOf(call: RentCall, resultText: string): SpendRent {
  const { tool, target, cwd, callId } = call;
  const tokens = Math.ceil(resultText.length / CHARS_PER_TOKEN);
  if (!tool.startsWith(MCP_PREFIX)) {
    return { tool, target: shortTarget(tool, target, cwd), tokens, callId };
  }
  const [server = "", ...name] = tool.slice(MCP_PREFIX.length).split(MCP_SEPARATOR);
  return {
    tool: MCP_LABEL,
    target: `${mcpCommandName(server)} · ${name.join(MCP_SEPARATOR)}`,
    tokens,
    callId,
  };
}

export function withRent(state: SpendState, row: SpendRent): SpendState {
  return {
    ...state,
    rentTokens: state.rentTokens + row.tokens,
    rent: [...state.rent, row]
      .sort((left, right) => right.tokens - left.tokens)
      .slice(0, MAX_RENT_ROWS),
  };
}

export function cacheHitPercent(state: SpendState): number | null {
  if (state.promptTokens === 0) return null;
  return Math.round((state.cacheReadTokens / state.promptTokens) * PERCENT);
}

export function splitRows(state: SpendState, sessionUsd: number | null): SplitRow[] {
  if (sessionUsd === null || sessionUsd <= 0) return [];
  const { owners, cents } = ownerCents(state, sessionUsd);
  const rows = owners
    .map((owner, index): SplitShare => ({
      name: owner.name,
      ...(owner.name === MAIN_OWNER &&
        state.mainModel !== "" && { model: shortModel(state.mainModel) }),
      ...agentIdsOf(state, owner.name),
      cents: owner.isPriced ? (cents[index] ?? 0) : null,
      value: owner.value,
    }))
    .sort((left, right) => right.value - left.value);
  const shown = rows.filter((row) => drawsOwnRow(row, sessionUsd));
  const hidden = rows.filter((row) => row.value > 0 && !drawsOwnRow(row, sessionUsd));
  const withMore = withPercents(withMoreRow(shown, hidden), sessionUsd);
  return dropEmptyHiddenMore(withMore, shown.length);
}

function agentIdsOf(state: SpendState, owner: string): { agentIds?: string[] } {
  if (NO_AGENT_OWNERS.has(owner)) return {};
  const ids = Object.entries(state.agents)
    .filter(([, agent]) => agent.owner === owner)
    .map(([id]) => id);
  return ids.length === 0 ? {} : { agentIds: ids };
}

function dropEmptyHiddenMore(rows: SplitRow[], shownCount: number): SplitRow[] {
  const last = rows.at(-1);
  const holdsOnlyHidden = shownCount <= MAX_SPLIT_OWNERS && rows.length > shownCount;
  return holdsOnlyHidden && last?.percent === 0 ? rows.slice(0, -1) : rows;
}

function drawsOwnRow(row: SplitShare, sessionUsd: number): boolean {
  return (row.cents ?? 0) !== 0 || row.value >= sessionUsd * MIN_SHOWN_SHARE;
}

export function agentSplit(
  state: SpendState,
  sessionUsd: number | null,
): Record<string, AgentShare> {
  const centsOfId = new Map(
    [...pricedOwnerCents(state, sessionUsd)].flatMap(([owner, total]) =>
      memberCents(state, owner, total),
    ),
  );
  return Object.fromEntries(
    Object.entries(state.agents).map(([id, agent]) => [
      id,
      { cents: centsOfId.get(id), tokens: agent.pricedTokens + agent.unpricedTokens },
    ]),
  );
}

function pricedOwnerCents(state: SpendState, sessionUsd: number | null): Map<string, number> {
  if (sessionUsd === null || sessionUsd <= 0) return new Map();
  const { owners, cents } = ownerCents(state, sessionUsd);
  return new Map(
    owners.flatMap((owner, index) => (owner.isPriced ? [[owner.name, cents[index] ?? 0]] : [])),
  );
}

function memberCents(state: SpendState, owner: string, ownerTotal: number): [string, number][] {
  const members = Object.entries(state.agents).filter(([, agent]) => agent.owner === owner);
  const weights = members.map(([, agent]) => agent.weight);
  const total = sum(weights) || 1;
  const cents = roundedCents(
    weights.map((weight) => (weight / total) * (ownerTotal / CENTS_PER_USD)),
    ownerTotal,
  );
  return members.map(([id], index) => [id, cents[index] ?? 0]);
}

function ownerCents(state: SpendState, sessionUsd: number): OwnerCents {
  const baseline = Math.min(state.baselineUsd ?? 0, sessionUsd);
  const tracked = fitted(weightedOwners(state), sessionUsd - baseline);
  const owners =
    baseline > 0
      ? [...tracked, { name: BEFORE_TRACKING_OWNER, value: baseline, isPriced: true }]
      : tracked;
  const cents = roundedCents(
    owners.map((owner) => owner.value),
    centsOf(sessionUsd),
  );
  return { owners, cents };
}

function withUsage(state: SpendState, owner: string, usage: TurnUsage, ttl: CacheTtl): SpendState {
  const next = addedUsage(state.owners[owner] ?? NO_OWNER, usage, ttl);
  return {
    ...state,
    owners: { ...state.owners, [owner]: next },
    cacheReadTokens: state.cacheReadTokens + usage.cache_read_input_tokens,
    promptTokens: state.promptTokens + promptOf(usage),
  };
}

function addedUsage<Owner extends SpendOwner>(
  current: Owner,
  usage: TurnUsage,
  ttl: CacheTtl,
): Owner {
  const tokens = totalTokens(usage);
  const price = priceOf(usage.model, promptOf(usage));
  return price === undefined
    ? { ...current, unpricedTokens: current.unpricedTokens + tokens }
    : {
        ...current,
        weight: current.weight + weightOf(usage, price, ttl),
        pricedTokens: current.pricedTokens + tokens,
      };
}

function withAgentMemory(
  memories: Record<string, SpendMemory>,
  request: AgentRequest,
): Record<string, SpendMemory> {
  const memory: SpendMemory = {
    model: request.usage.model,
    endedAt: request.endedAt,
    size: promptOf(request.usage),
  };
  const others = Object.entries(memories).filter(([id]) => id !== request.agentId);
  const kept: [string, SpendMemory][] = [...others, [request.agentId, memory]];
  return Object.fromEntries(kept.slice(-KEPT_AGENT_MEMORIES));
}

function withMiss(state: SpendState, miss: SpendMiss): SpendState {
  return {
    ...state,
    missCount: state.missCount + 1,
    lostUsd: state.lostUsd + (miss.usd ?? 0),
    misses: [miss, ...state.misses].slice(0, MAX_MISSES),
  };
}

function mainMiss(state: SpendState, turn: MainTurn, ttl: CacheTtl): SpendMiss | null {
  const { usage } = turn;
  const memory = state.mainMemory ?? undefined;
  const written = usage.cache_creation_input_tokens;
  const requestTokens = turn.context ?? promptOf(usage);
  if (state.isCompacted) {
    if (written < MISS_MIN_TOKENS) return null;
    return missOf(written, usage, requestTokens, AFTER_COMPACTION, ttl, turn.endedAt);
  }
  const previous = memory?.size;
  if (previous === undefined) return null;
  const growth = Math.max(0, (turn.context ?? previous) - previous);
  const rebuilt = written - growth;
  const cause = causeOf(usage.model, turn.startedAt, memory, TTL_MS[ttl]);
  const isBig = rebuilt >= MISS_MIN_TOKENS && rebuilt >= previous / 2;
  const isKnownCause = cause !== CACHE_REBUILT && rebuilt >= SMALL_MISS_TOKENS;
  return isBig || isKnownCause
    ? missOf(rebuilt, usage, requestTokens, cause, ttl, turn.endedAt)
    : null;
}

function agentMiss(
  { index, usage, startedAt, endedAt }: AgentRequest,
  memory: SpendMemory | undefined,
): SpendMiss | null {
  const previous = memory?.size;
  if (index === 0 || previous === undefined) return null;
  const read = usage.cache_read_input_tokens;
  const uncached = previous - read;
  const cause = causeOf(usage.model, startedAt, memory, TTL_MS[AGENT_TTL]);
  const isBig = uncached >= MISS_MIN_TOKENS && read < previous / 2;
  const isKnownCause = cause !== CACHE_REBUILT && uncached >= SMALL_MISS_TOKENS && read < previous;
  if (!isBig && !isKnownCause) return null;
  const rebuilt = Math.min(usage.cache_creation_input_tokens, uncached);
  return missOf(rebuilt, usage, promptOf(usage), cause, AGENT_TTL, endedAt);
}

function causeOf(
  model: string,
  startedAt: number,
  memory: SpendMemory | undefined,
  ttlMs: number,
): string {
  if (memory === undefined) return CACHE_REBUILT;
  if (memory.model !== model) return MODEL_SWITCH;
  const idleMs = startedAt - memory.endedAt;
  if (idleMs <= ttlMs) return CACHE_REBUILT;
  return `after ${Math.floor(idleMs / MS_PER_MINUTE)}m idle`;
}

function missOf(
  rebuilt: number,
  usage: TurnUsage,
  requestTokens: number,
  cause: string,
  ttl: CacheTtl,
  at: number,
): SpendMiss {
  const price = priceOf(usage.model, requestTokens);
  const usd =
    price === undefined
      ? null
      : (rebuilt * (price.cacheWrite[ttl] - price.cacheRead)) / TOKENS_PER_MILLION;
  return { at, cause, rebuilt, usd };
}

export function priceOf(model: string, promptTokens: number): Price | undefined {
  const row = PRICES.filter(({ match }) => model.includes(match)).sort(
    (left, right) => right.match.length - left.match.length,
  )[0];
  if (row === undefined) return undefined;
  const { longPrompt } = row;
  return longPrompt !== undefined && promptTokens > longPrompt.aboveTokens ? longPrompt.price : row;
}

function weightOf(usage: TurnUsage, price: Price, ttl: CacheTtl): number {
  return (
    (usage.input_tokens * price.input +
      usage.output_tokens * price.output +
      usage.cache_read_input_tokens * price.cacheRead +
      usage.cache_creation_input_tokens * price.cacheWrite[ttl]) /
    TOKENS_PER_MILLION
  );
}

function promptOf(usage: TurnUsage): number {
  return usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens;
}

function totalTokens(usage: TurnUsage): number {
  return promptOf(usage) + usage.output_tokens;
}

function shortTarget(tool: string, target: string, cwd: string): string {
  return isPathTool(tool)
    ? clipStart(relativePath(target, cwd), RENT_TARGET_CELLS)
    : clipEnd(target, RENT_TARGET_CELLS);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function weightedOwners(state: SpendState): Weighted[] {
  const owners = Object.entries(state.owners);
  const pricedTokens = sum(owners.map(([, owner]) => owner.pricedTokens));
  const usdPerToken =
    pricedTokens === 0 ? 1 : sum(owners.map(([, owner]) => owner.weight)) / pricedTokens;
  return owners.map(([name, owner]) => ({
    name,
    value: owner.weight + owner.unpricedTokens * usdPerToken,
    isPriced: owner.unpricedTokens === 0,
  }));
}

function fitted(owners: Weighted[], sessionUsd: number): Weighted[] {
  const total = sum(owners.map((owner) => owner.value));
  if (total > sessionUsd) {
    return owners.map((owner) => ({ ...owner, value: (owner.value * sessionUsd) / total }));
  }
  const residual = sessionUsd - total;
  if (residual < FLOAT_NOISE_USD) return owners;
  if (!owners.some((owner) => owner.name === BACKGROUND_OWNER)) {
    return [...owners, { name: BACKGROUND_OWNER, value: residual, isPriced: true }];
  }
  return owners.map((owner) =>
    owner.name === BACKGROUND_OWNER ? { ...owner, value: owner.value + residual } : owner,
  );
}

export function roundedCents(values: readonly number[], totalCents: number): number[] {
  const exact = values.map((value) => value * CENTS_PER_USD);
  const floors = exact.map(Math.floor);
  const remainder = Math.max(0, totalCents - sum(floors));
  const luckiest = exact
    .map((value, index) => ({
      index,
      fraction: Number((value - Math.floor(value)).toFixed(FRACTION_DIGITS)),
    }))
    .sort((left, right) => right.fraction - left.fraction)
    .slice(0, remainder)
    .map(({ index }) => index);
  return floors.map((floor, index) => (luckiest.includes(index) ? floor + 1 : floor));
}

export function withMoreRow(rows: SplitShare[], hidden: SplitShare[] = []): SplitShare[] {
  const rest = [...rows.slice(MAX_SPLIT_OWNERS), ...hidden];
  if (rest.length === 0) return rows;
  const more: SplitShare = {
    name: `${rest.length} more`,
    cents: rest.some((row) => row.cents === null) ? null : sum(rest.map((row) => row.cents ?? 0)),
    value: sum(rest.map((row) => row.value)),
    folded: rest,
  };
  return [...rows.slice(0, MAX_SPLIT_OWNERS), more];
}

export function moreRowOf(rest: readonly SplitRow[]): SplitRow {
  const share = sum(rest.map((row) => row.share));
  return {
    name: `${rest.length} more`,
    cents: rest.some((row) => row.cents === null) ? null : sum(rest.map((row) => row.cents ?? 0)),
    share,
    percent: Math.round(share * PERCENT),
    value: sum(rest.map((row) => row.value)),
  };
}

export function withPercents(rows: SplitShare[], total: number): SplitRow[] {
  const percents = roundedCents(
    rows.map((row) => row.value / total),
    PERCENT,
  );
  return rows.map(({ folded, ...row }, index) => ({
    ...row,
    share: row.value / total,
    percent: percents[index] ?? 0,
    ...(folded && { folded: foldedPercents(folded, total) }),
  }));
}

function foldedPercents(rows: FoldedShare[], total: number): SplitRow[] {
  return rows.map((row) => {
    const share = row.value / total;
    return { ...row, share, percent: Math.round(share * PERCENT) };
  });
}
