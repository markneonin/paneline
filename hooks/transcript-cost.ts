import type { TranscriptProgress } from "../types";
import { MS_PER_SECOND } from "./format";
import {
  FAST_MULTIPLIER,
  US_GEO_MULTIPLIER,
  USD_PER_WEB_SEARCH,
  isFastModel,
  priceOf,
} from "./spend-model";

const SYNTHETIC_MODEL = "<synthetic>";
const TOKENS_PER_MILLION = 1_000_000;
const NO_MULTIPLIER = 1;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;
export const MONTH_DAYS = 30;
const SUBAGENTS_DIR = "subagents";
const JSONL_SUFFIX = /\.jsonl$/;
const USAGE_KEY = '"usage"';
const ASSISTANT_TYPE = /"type"\s*:\s*"assistant"/;
const SCRATCHPAD_DIR =
  /^-private-tmp-claude-\d+-(-.+?)-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}-scratchpad/;
const NO_TOKENS: Tokens = { input: 0, output: 0, write5m: 0, write1h: 0, read: 0 };

export type Tokens = {
  input: number;
  output: number;
  write5m: number;
  write1h: number;
  read: number;
};

type AdvisorUse = Tokens & { model: string };

type CallCredit = {
  session: string;
  dir: string;
  isSubagent: boolean;
  isOwnSession: boolean;
  start: number;
  path: string;
};

export type CallRow = Tokens & {
  id: string;
  model: string;
  at: number;
  searches: number;
  isFast: boolean;
  isUsGeo: boolean;
  advisors: AdvisorUse[];
  credit: CallCredit;
};

export type TranscriptFile = { path: string; start: number };

export type FileState = {
  path: string;
  size: number;
  mtimeMs: number;
  offset: number;
  start: number;
  cwd: string;
};

export type CostStore = {
  files(): Promise<FileState[]>;
  saveFile(state: FileState, rows: readonly CallRow[]): Promise<void>;
  saveProgress(progress: TranscriptProgress): Promise<void>;
};

type RawTokens = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
};

type RawIteration = RawTokens & { type?: string; model?: string };

type RawUsage = RawTokens & {
  server_tool_use?: { web_search_requests?: number };
  speed?: string;
  inference_geo?: string;
  iterations?: RawIteration[];
};

type RawLine = {
  type?: string;
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  message?: { id?: string; model?: string; usage?: RawUsage };
};

export type ParsedCall = { row: CallRow; cwd: string };

type Place = { dir: string; session: string; isSubagent: boolean };

type Modes = Pick<CallRow, "isFast" | "isUsGeo">;

type TokenPrice = { usd: number; isUnknown: boolean };

export type Priced = { usd: number; advisorUsd: number; isUnknown: boolean };

export function callRowsOf(lines: readonly string[], file: TranscriptFile): CallRow[] {
  const rows = new Map<string, CallRow>();
  for (const line of lines) {
    const call = callOf(line, file);
    if (call !== undefined) addCall(rows, call.row);
  }
  return [...rows.values()];
}

export function costOf(call: CallRow): number {
  return pricedOf(call).usd;
}

export function mergeCall(a: CallRow, b: CallRow): CallRow {
  return {
    ...a,
    ...mapTokens(a, b, Math.max),
    at: Math.min(a.at, b.at),
    searches: Math.max(a.searches, b.searches),
    isFast: a.isFast || b.isFast,
    isUsGeo: a.isUsGeo || b.isUsGeo,
    advisors: mergedAdvisors(a.advisors, b.advisors),
    credit: isEarlier(b.credit, a.credit) ? b.credit : a.credit,
  };
}

export function addCall(rows: Map<string, CallRow>, row: CallRow): void {
  const seen = rows.get(row.id);
  rows.set(row.id, seen === undefined ? row : mergeCall(seen, row));
}

export function callOf(line: string, file: TranscriptFile): ParsedCall | undefined {
  if (!line.includes(USAGE_KEY) || !ASSISTANT_TYPE.test(line)) return undefined;
  const entry = parsedLine(line);
  const message = entry?.message;
  const usage = message?.usage;
  if (
    entry?.type !== "assistant" ||
    message?.id === undefined ||
    message.model === undefined ||
    usage === undefined
  ) {
    return undefined;
  }
  const at = Date.parse(entry.timestamp ?? "");
  if (Number.isNaN(at)) return undefined;
  const place = placeOf(file.path);
  const iterations = usage.iterations ?? [];
  const messageTokens = sumTokens(
    iterations.filter((iteration) => iteration.type === "message").map(tokensOf),
  );
  const row: CallRow = {
    ...mapTokens(tokensOf(usage), messageTokens, Math.max),
    id: message.id,
    model: message.model,
    at,
    searches: usage.server_tool_use?.web_search_requests ?? 0,
    isFast: usage.speed === "fast",
    isUsGeo: usage.inference_geo === "us",
    advisors: iterations.filter((iteration) => iteration.type === "advisor_message").map(advisorOf),
    credit: {
      session: place.session,
      dir: place.dir,
      isSubagent: place.isSubagent,
      isOwnSession: (entry.sessionId ?? "") === place.session,
      start: file.start,
      path: file.path,
    },
  };
  return { row, cwd: entry.cwd ?? "" };
}

function parsedLine(line: string): RawLine | undefined {
  try {
    return JSON.parse(line) as RawLine;
  } catch {
    return undefined;
  }
}

function placeOf(path: string): Place {
  const parts = path.split("/");
  const subagentsAt = parts.indexOf(SUBAGENTS_DIR);
  if (subagentsAt === -1) {
    return {
      dir: parts.at(-2) ?? "",
      session: (parts.at(-1) ?? "").replace(JSONL_SUFFIX, ""),
      isSubagent: false,
    };
  }
  return {
    dir: parts[subagentsAt - 2] ?? "",
    session: parts[subagentsAt - 1] ?? "",
    isSubagent: true,
  };
}

function tokensOf(usage: RawTokens): Tokens {
  const split = usage.cache_creation;
  return {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    write5m:
      split === undefined
        ? (usage.cache_creation_input_tokens ?? 0)
        : (split.ephemeral_5m_input_tokens ?? 0),
    write1h: split?.ephemeral_1h_input_tokens ?? 0,
    read: usage.cache_read_input_tokens ?? 0,
  };
}

function advisorOf(iteration: RawIteration): AdvisorUse {
  return { ...tokensOf(iteration), model: iteration.model ?? "" };
}

function mergedAdvisors(a: readonly AdvisorUse[], b: readonly AdvisorUse[]): AdvisorUse[] {
  if (a.length !== b.length) return a.length > b.length ? [...a] : [...b];
  return a.map((advisor, index) => ({
    ...advisor,
    ...mapTokens(advisor, b[index] ?? advisor, Math.max),
  }));
}

function isEarlier(a: CallCredit, b: CallCredit): boolean {
  if (a.isOwnSession !== b.isOwnSession) return a.isOwnSession;
  if (a.start !== b.start) return a.start < b.start;
  return a.path.localeCompare(b.path) < 0;
}

export function pricedOf(call: CallRow): Priced {
  const own = tokensPriced(call, call.model, call);
  const advisors = call.advisors.map((advisor) => tokensPriced(advisor, advisor.model, call));
  const advisorUsd = sum(advisors.map(({ usd }) => usd));
  return {
    usd: own.usd + call.searches * USD_PER_WEB_SEARCH + advisorUsd,
    advisorUsd,
    isUnknown: own.isUnknown || advisors.some(({ isUnknown }) => isUnknown),
  };
}

function tokensPriced(tokens: Tokens, model: string, modes: Modes): TokenPrice {
  if (model === SYNTHETIC_MODEL) return { usd: 0, isUnknown: false };
  const price = priceOf(model, promptOf(tokens));
  if (price === undefined) return { usd: 0, isUnknown: true };
  const speed = modes.isFast && isFastModel(model) ? FAST_MULTIPLIER : NO_MULTIPLIER;
  const geo = modes.isUsGeo ? US_GEO_MULTIPLIER : NO_MULTIPLIER;
  const perMillion =
    tokens.input * price.input +
    tokens.output * price.output +
    tokens.write5m * price.cacheWrite["5m"] +
    tokens.write1h * price.cacheWrite["1h"] +
    tokens.read * price.cacheRead;
  return { usd: (perMillion * speed * geo) / TOKENS_PER_MILLION, isUnknown: false };
}

function promptOf(tokens: Tokens): number {
  return tokens.input + tokens.read + tokens.write5m + tokens.write1h;
}

export function projectNamesOf(
  dirs: readonly string[],
  containers: readonly string[],
): Map<string, string> {
  const known = new Set([...dirs, ...dirs.map(originOf)]);
  return new Map(
    dirs.map((dir): [string, string] => [dir, rootOf(originOf(dir), known, containers)]),
  );
}

function originOf(dir: string): string {
  return SCRATCHPAD_DIR.exec(dir)?.[1] ?? dir;
}

function rootOf(origin: string, known: ReadonlySet<string>, containers: readonly string[]): string {
  const roots = [...known]
    .filter((other) => !containers.includes(other) && origin.startsWith(`${other}-`))
    .sort((a, b) => a.length - b.length);
  return roots[0] ?? origin;
}

function mapTokens(a: Tokens, b: Tokens, combine: (x: number, y: number) => number): Tokens {
  return {
    input: combine(a.input, b.input),
    output: combine(a.output, b.output),
    write5m: combine(a.write5m, b.write5m),
    write1h: combine(a.write1h, b.write1h),
    read: combine(a.read, b.read),
  };
}

function sumTokens(parts: readonly Tokens[]): Tokens {
  return parts.reduce((total, part) => mapTokens(total, part, (x, y) => x + y), NO_TOKENS);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
