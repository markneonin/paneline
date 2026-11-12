import { expect, mock } from "claude-code/testing";
import type {
  On,
  PromptOrigin,
  SessionContextBreakdown,
  SessionMessage,
  TurnUsage,
} from "claude-code";
import type { Engine, MockClock, Mounted } from "claude-code/testing";

import { palette } from "../hooks/palette";
import { collect, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import { blocksOf, linesOf } from "./skills-tree";
import type { Block, Line } from "./skills-tree";
import { isHeavy } from "./weight";

export type Pane = Mounted<"terminal", "Pane">;
export type Tokens = { input?: number; output?: number; read?: number; write?: number };
export type ToolReply = { text: string } | { text: string; isError: true } | { deny: string };
export type Plan = "subscription" | "api key";
export type World = {
  clock: MockClock;
  plan: Plan;
  contextTokens: number | undefined;
  promptAt: number | undefined;
  costUsd: number | undefined;
  breakdown: SessionContextBreakdown | undefined;
  stepUsage: TurnUsage | null;
  replies: Map<string, ToolReply>;
  spawned: number;
  calls: number;
  session: string;
  transcriptPath: string | undefined;
  repoRoot: string | null;
  compaction: { tokensBefore?: number; tokensAfter?: number; skip?: string };
  isStoreCorruptUntilWritten: boolean;
  isStoreStrict: boolean;
  storeSetsInFlight: number;
  heldStoreWrites: (() => void)[];
  rejectedStoreKeys: string[];
  store: Map<string, unknown>;
  state: Map<string, { value: unknown; version: number }>;
};
export type MainTurn = {
  model: string;
  tokens: Tokens;
  context?: number;
  idleMinutes?: number;
  durationMs?: number;
  isStepped?: boolean;
};
export type AgentRequest = {
  agentId: string;
  model: string;
  tokens: Tokens;
  index: number;
  idleMinutes?: number;
};
export type ToolSpec = {
  tool: string;
  input: object;
  reply: ToolReply;
  agentId?: string;
};
export type Owner = { name: string; dollars: string | null; percent: string; filled: number };
export type Miss = { time: string; cause: string; tokens: string; dollars: string | null };
export type CacheSummary = { misses: string; lost: string };
export type Totals = { usd: string; hit: string; rent: string; values: Line; labels: Line };
export type RentRow = { tool: string; target: string; size: string };
export type Spacing = {
  gapAboveTop: number;
  blanksBeforeHeadings: number[];
  longestBlankRun: number;
};

export const SESSION_ID = "session-one";
export const OTHER_SESSION_ID = "session-two";
export const NO_CACHE_DATA = "no cache data yet";
export const SUBSCRIPTION: Plan = "subscription";
export const API_KEY: Plan = "api key";
export const OPUS = "claude-opus-5-5";
export const SONNET = "claude-sonnet-5-5";
export const HAIKU = "claude-haiku-4-5-20251001";
export const UNPRICED = "claude-mystery-9";
export const COLUMNS = 100;
export const NARROW_COLUMNS = 60;
export const WIDE_COLUMNS = 120;
export const SPEND = "Spend";
export const SPLIT_TITLE = "Where it went";
export const CACHE_TITLE = "Cache misses";
export const RENT_TITLE = "Biggest tool results in context";
export const HISTORY_TITLE = "History · all sessions";
export const PROJECTS_TITLE = "By project · 30 days";
export const NO_HISTORY = "no history yet";
export const HEADINGS = [SPLIT_TITLE, CACHE_TITLE, RENT_TITLE];
export const HISTORY_HEADINGS = [HISTORY_TITLE, PROJECTS_TITLE];
export const HIT_LABEL = "cache, all agents";
const TOTAL_LABELS = /^this session .+ result tokens$/;
export const BEFORE_TRACKING = "before tracking";
export const NO_SPEND = "no spend this session yet";
export const NO_RENT = "no tool results in context";
export const BACKGROUND_NOTE = "agent summaries, compaction, memory";
export const MS_PER_MINUTE = 60_000;
export const TURN_MS = 1_000;

const SUMMARY_MESSAGE: SessionMessage = { role: "user", text: "summary", toolUses: [] };
const START = Date.UTC(2026, 9, 6, 14, 2, 0);
const FLUSH_MS = 1_000;
const STORE_LOCK_ERROR = "Lock file is already being held";
const SETTLE_TICKS = 5;
const PANE_ROWS = 80;
const WORK = "/work";
const SPEND_STATE_PREFIX = "paneline.spend.";
const TRACKED_USE_KEYS = ["toolUses", "skillUses"];
const CORRUPT_VALUE = { sessions: "not a list", owners: 7 };
const TAB_NAMES = [
  "Activity",
  "Files",
  "Agents",
  "Plan",
  "Context",
  "MCP",
  "Skills",
  "Spend",
  "Setup",
  "Shells",
  "History",
  "Review",
];
const NEXT_TAB_LABEL = "›";
const PREV_TAB_LABEL = "‹";
const SELECTED_TAB_TEXT = "clawd_background";
const OWNER_ROW = /^(.+?)(?: +[▰▱█░]+)? +(?:(~?<?\$\d+\.\d{2}) +)?(<1%|\d+%)$/;
const MISS_ROW =
  /^(\d{2}:\d{2}) (after \d+m idle|model switch|after compaction|cache rebuilt) (\d+(?:\.\d)?k?)(?: (~?<?\$\d+\.\d{2}))?$/;
const CACHE_SUMMARY = /^(\d+ miss(?:es)?) · (~?<?\$\d+\.\d{2}) lost$/;
const MISS_PART = /(\d+ miss(?:es)?) · (~?<?\$\d+\.\d{2}) lost/;
const WARMTH_ROW = /^cache (?:warm until \d{2}:\d{2}|cold)/;
const RENT_ROW = /^(\S+)(?: (.*?))? (\d+(?:\.\d)?k?)$/;
const LEGACY_HISTORY_TITLE = "History";
const FILLED_CELLS = /[▰█]/g;

export function worldOf(on: On, plan: Plan): World {
  const world: World = {
    clock: mock.clock(on, { now: START }),
    plan,
    contextTokens: undefined,
    promptAt: undefined,
    costUsd: undefined,
    breakdown: undefined,
    stepUsage: null,
    replies: new Map(),
    spawned: 0,
    calls: 0,
    session: SESSION_ID,
    transcriptPath: undefined,
    repoRoot: null,
    compaction: {},
    isStoreCorruptUntilWritten: false,
    isStoreStrict: false,
    storeSetsInFlight: 0,
    heldStoreWrites: [],
    rejectedStoreKeys: [],
    store: new Map(),
    state: new Map(),
  };
  mock.env(on, { HOME: "/h/u" });
  on("config.list", () => ({ value: [{ key: "theme", value: "dark" }] }) as never);
  on("command.register", () => ({ value: {} }) as never);
  on("session.id", () => ({ value: world.session }));
  on("session.repo", () => ({
    value: world.repoRoot === null ? null : ({ root: world.repoRoot } as never),
  }));
  on("session.root", () => ({ value: WORK }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("store.get", (_$, e) => {
    const isCorrupt =
      world.isStoreCorruptUntilWritten &&
      !world.store.has(e.key) &&
      !TRACKED_USE_KEYS.includes(e.key);
    return { value: isCorrupt ? CORRUPT_VALUE : world.store.get(e.key) };
  });
  on("store.set", async (_$, e) => {
    if (world.isStoreStrict && world.storeSetsInFlight > 0) {
      world.rejectedStoreKeys.push(e.key);
      releaseHeldStoreWrites(world);
      throw new Error(STORE_LOCK_ERROR);
    }
    world.storeSetsInFlight += 1;
    if (world.isStoreStrict)
      await new Promise<void>((release) => world.heldStoreWrites.push(release));
    const saved: unknown = JSON.parse(JSON.stringify(e.value));
    world.store.set(e.key, saved);
    world.storeSetsInFlight -= 1;
    return { value: undefined };
  });
  on("store.delete", (_$, e) => {
    world.store.delete(e.key);
    return { value: undefined };
  });
  on("store.keys", () => ({ value: [...world.store.keys()] }));
  on("state.get", (_$, e) => {
    const entry = world.state.get(stateKey(e));
    return { value: { value: entry?.value, version: entry?.version ?? 0 } };
  });
  on("state.set", (_$, e) => {
    const key = stateKey(e);
    const version = (world.state.get(key)?.version ?? 0) + 1;
    world.state.set(key, { value: e.value, version });
    return { value: { isSet: true, version } };
  });
  on("classic.SessionStart", () => ({}));
  on("session.compact", () =>
    world.compaction.skip === undefined
      ? {
          messages: [SUMMARY_MESSAGE],
          ...(world.compaction.tokensBefore === undefined
            ? {}
            : { tokensBefore: world.compaction.tokensBefore }),
          ...(world.compaction.tokensAfter === undefined
            ? {}
            : { tokensAfter: world.compaction.tokensAfter }),
        }
      : { skip: world.compaction.skip },
  );
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", (_$, e) => ({
    value: {
      startedAt: 0,
      ...(world.costUsd === undefined ? {} : { cost: { usd: world.costUsd } }),
      context: {
        window: 200_000,
        ...(world.contextTokens === undefined ? {} : { tokens: world.contextTokens }),
        ...(e.breakdown === undefined || world.breakdown === undefined
          ? {}
          : { breakdown: world.breakdown }),
      },
      rateLimits: world.plan === SUBSCRIPTION ? [{ kind: "five_hour", percentUsed: 5 }] : [],
    },
  }));
  on("classic.PostModelSwitch", () => ({}));
  on("session.model", () => ({ value: "opus" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: WORK }));
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", () => ({ value: true }));
  on("agent.spawn", () => ({ model: SONNET, agentId: `agent-${++world.spawned}` }));
  on("turn.step", async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: "",
      toolUses: [],
      stopReason: "end_turn",
      usage: world.stepUsage,
    } as never;
  });
  on("turn.complete", (_$, e) => ({ text: e.answer }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("tool.call", (_$, e) => {
    const reply = world.replies.get(e.tool_use_id);
    if (reply === undefined) return { result: "ok", text: "ok" };
    if ("deny" in reply) return { deny: reply.deny };
    if ("isError" in reply) return { isError: true, result: reply.text, text: reply.text };
    return { result: reply.text, text: reply.text };
  });
  on("process.run", () => ({ value: { exitCode: 0, stdout: "", stderr: "" } }) as never);
  return world;
}

function stateKey(address: { plugin: string; key: string; id?: string }): string {
  return `${address.plugin}.${address.key}.${address.id ?? ""}`;
}

export async function forgetLastCost($: Engine): Promise<void> {
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [],
    changed: ["cost"],
  } as never);
}

export function dropBaselineField(world: World): void {
  for (const [key, entry] of world.state) {
    if (!key.startsWith(SPEND_STATE_PREFIX)) continue;
    const { baselineUsd: _dropped, ...rest } = entry.value as Record<string, unknown>;
    world.state.set(key, { ...entry, value: rest });
  }
}

export async function reloadPlugin($: Engine, world: World): Promise<void> {
  world.state.clear();
  await forgetLastCost($);
  await $.session.start({ cwd: WORK, surface: "terminal", isInteractive: true });
  await world.clock.advance(FLUSH_MS);
}

export function usageOf(model: string, tokens: Tokens): TurnUsage {
  return {
    model,
    input_tokens: tokens.input ?? 0,
    output_tokens: tokens.output ?? 0,
    cache_read_input_tokens: tokens.read ?? 0,
    cache_creation_input_tokens: tokens.write ?? 0,
  };
}

export async function setSessionCost($: Engine, world: World, usd: number): Promise<void> {
  world.costUsd = usd;
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [],
    cost: { usd },
    changed: ["cost"],
  } as never);
  await world.clock.advance(FLUSH_MS);
}

export async function beginSession(
  $: Engine,
  world: World,
  source: "startup" | "resume" | "clear",
): Promise<void> {
  await forgetLastCost($);
  await $.classic.SessionStart({ source });
  await world.clock.advance(FLUSH_MS);
}

export function releaseHeldStoreWrites(world: World): void {
  world.heldStoreWrites.splice(0).forEach((release) => release());
}

export function startFreshSession($: Engine, world: World): Promise<void> {
  return setSessionCost($, world, 0);
}

export function answerPrompts(on: On): void {
  on("prompt.submit", (_$, e) => ({ text: e.text }));
  on("fs.read", () => ({ value: "" }));
  on("fs.write", () => ({ value: undefined }));
}

export async function submitPrompt(
  $: Engine,
  world: World,
  text: string,
  origin: PromptOrigin = { kind: "composer" },
): Promise<void> {
  world.promptAt = world.clock.now();
  await ($.prompt.submit as (e: object) => Promise<unknown>)({ text, wait: false, origin });
  await $.turn.start({ text, turnId: `turn-${text}` });
}

export async function submitMetaPrompt($: Engine, text: string): Promise<void> {
  await ($.prompt.submit as (e: object) => Promise<unknown>)({
    text,
    wait: false,
    isMeta: true,
    origin: { kind: "composer" },
  });
}

export async function mainTurn($: Engine, world: World, turn: MainTurn): Promise<number> {
  world.contextTokens = turn.context;
  await world.clock.advance((turn.idleMinutes ?? 0) * MS_PER_MINUTE + TURN_MS);
  if (world.promptAt !== undefined && turn.durationMs !== undefined) {
    await world.clock.advance(Math.max(0, world.promptAt + turn.durationMs - world.clock.now()));
  }
  if (turn.isStepped !== true) await mainStep($, world, turn);
  const completedAt = world.clock.now();
  await $.turn.complete({
    answer: "",
    durationMs: turn.durationMs ?? TURN_MS,
    isAborted: false,
    turnId: `turn-${world.clock.now()}`,
    reason: "answer",
    usage: usageOf(turn.model, turn.tokens),
  } as never);
  await world.clock.advance(FLUSH_MS);
  return completedAt;
}

export async function mainStep($: Engine, world: World, turn: MainTurn): Promise<void> {
  world.stepUsage = usageOf(turn.model, turn.tokens);
  const stream = $.turn.step({
    turnId: "turn-main",
    index: 0,
    model: turn.model,
    effort: "high",
    messageCount: 1,
  } as never);
  for await (const _chunk of stream) continue;
}

export async function spawnAgent($: Engine, world: World, type: string): Promise<string> {
  const spawn = await $.agent.spawn({
    tool_use_id: `spawn-${world.spawned + 1}`,
    prompt: "do the work",
    description: type,
    subagentType: type,
    provider: "anthropic",
    parentModel: OPUS,
    background: false,
    fork: false,
  } as never);
  await world.clock.advance(FLUSH_MS);
  return spawn.agentId ?? "";
}

export async function agentRequest($: Engine, world: World, request: AgentRequest): Promise<void> {
  world.stepUsage = usageOf(request.model, request.tokens);
  await world.clock.advance((request.idleMinutes ?? 0) * MS_PER_MINUTE);
  const stream = $.turn.step({
    turnId: `run-${request.agentId}`,
    index: request.index,
    model: request.model,
    effort: "high",
    messageCount: 1,
    agentId: request.agentId,
  } as never);
  for await (const _chunk of stream) continue;
  await world.clock.advance(FLUSH_MS);
}

export async function finishAgent(
  $: Engine,
  world: World,
  agentId: string,
  usage: TurnUsage,
): Promise<void> {
  await $.turn.complete({
    answer: "",
    durationMs: TURN_MS,
    isAborted: false,
    turnId: `run-${agentId}`,
    agentId,
    reason: "answer",
    usage,
  } as never);
  await world.clock.advance(FLUSH_MS);
}

export async function callTool($: Engine, world: World, call: ToolSpec): Promise<void> {
  const id = `call-${++world.calls}`;
  world.replies.set(id, call.reply);
  await ($.tool.call as (e: object) => Promise<unknown>)({
    tool: call.tool,
    ...call.input,
    tool_use_id: id,
    ...(call.agentId === undefined ? {} : { agentId: call.agentId }),
  });
  await world.clock.advance(FLUSH_MS);
}

export function readFile(
  $: Engine,
  world: World,
  path: string,
  chars: number,
  agentId?: string,
): Promise<void> {
  return callTool($, world, {
    tool: "Read",
    input: { file_path: path },
    reply: { text: "x".repeat(chars) },
    ...(agentId === undefined ? {} : { agentId }),
  });
}

export type CompactTrigger = "manual" | "auto" | "plugin" | "precompute";

export async function compact(
  $: Engine,
  world: World,
  agentId?: string,
  trigger: CompactTrigger = "manual",
): Promise<void> {
  await $.session.compact({
    trigger,
    messages: [SUMMARY_MESSAGE],
    ...(agentId === undefined ? {} : { agentId }),
  });
  await $.classic.SessionStart({
    source: "compact",
    ...(world.transcriptPath === undefined ? {} : { transcript_path: world.transcriptPath }),
    ...(agentId === undefined ? {} : { agent_id: agentId }),
  } as never);
  await world.clock.advance(FLUSH_MS);
}

export async function switchModel(
  $: Engine,
  world: World,
  to: string,
  cacheTtl: "5m" | "1h",
): Promise<void> {
  await $.classic.PostModelSwitch({
    from_model: OPUS,
    to_model: to,
    requested_model: to,
    source: "command",
    context_tokens: 0,
    prompt_cache_warm: false,
    cache_ttl: cacheTtl,
    estimated_cache_write_usd: 0,
    pricing: "catalog",
  });
  await world.clock.advance(FLUSH_MS);
}

export async function clearSession($: Engine, world: World): Promise<void> {
  await $.classic.SessionStart({ source: "clear" } as never);
  await world.clock.advance(FLUSH_MS);
}

export async function spendPane($: Engine, columns: number = COLUMNS): Promise<Pane> {
  const pane = await openPane($, columns);
  await showSpend(pane);
  return pane;
}

export async function showSpend(pane: Pane): Promise<void> {
  await showTabThroughArrows(pane, SPEND);
}

export async function showTabThroughArrows(pane: Pane, label: string): Promise<void> {
  for (const _tab of TAB_NAMES) {
    const buttons = await pane.findAll({ type: "Button" });
    const tab = buttons.find((button) => button.props.label === label);
    if (tab !== undefined) {
      await pane.press({ key: tab.key ?? "" });
      await settle(pane);
      return;
    }
    const selected = await selectedTabName(pane);
    if (selected === label) return;
    const arrow = arrowToward(label, selected);
    const button = buttons.find((candidate) => String(candidate.props.label).includes(arrow));
    expect(button, `a ${label} tab button or the ${arrow} arrow`).toBeDefined();
    await pane.press({ key: button?.key ?? "" });
    await settle(pane);
  }
  expect(false, `${label} reached through the tab arrows`).toBe(true);
}

function arrowToward(label: string, selected: string | undefined): string {
  return TAB_NAMES.indexOf(label) > TAB_NAMES.indexOf(selected ?? "")
    ? NEXT_TAB_LABEL
    : PREV_TAB_LABEL;
}

async function selectedTabName(pane: Pane): Promise<string | undefined> {
  const selectedTexts = collect(await pane.drawn(), "Text")
    .filter((text) => text.props?.color === SELECTED_TAB_TEXT)
    .map(textOf);
  return TAB_NAMES.find((name) => selectedTexts.includes(name));
}

export async function shownTabs(pane: Pane): Promise<string[]> {
  const buttons = await pane.findAll({ type: "Button" });
  return buttons
    .map((button) => String(button.props.label))
    .filter((label) => TAB_NAMES.includes(label));
}

export async function lines(pane: Pane): Promise<Line[]> {
  return linesOf(await pane.drawn());
}

export async function blocks(pane: Pane): Promise<Record<string, Block>> {
  return blocksOf(await unstampedLines(pane), [...HISTORY_HEADINGS, ...HEADINGS]);
}

export async function unstampedLines(pane: Pane): Promise<Line[]> {
  return (await lines(pane)).map(withoutStamp);
}

function withoutStamp(line: Line): Line {
  const [label] = line.parts;
  const name = label === undefined || !isHeavy(label.props) ? "" : textOf(label).trim();
  if (name === LEGACY_HISTORY_TITLE) return { ...line, text: HISTORY_TITLE };
  return [...HISTORY_HEADINGS, ...HEADINGS].includes(name) ? { ...line, text: name } : line;
}

export function stampOf(shown: Line[], title: string): string | undefined {
  const heading = shown.find((line) => line.text === title || line.text.startsWith(`${title} `));
  return heading?.text.slice(title.length).trim();
}

export function warmthLineOf(shown: Line[]): Line | undefined {
  return shown.find((line) => WARMTH_ROW.test(line.text));
}

export function missCaptionOf(shown: Line[]): CacheSummary | undefined {
  for (const line of shown) {
    const match = MISS_PART.exec(line.text);
    if (match !== null) return { misses: match[1] ?? "", lost: match[2] ?? "" };
  }
  return undefined;
}

export function totalsOf(shown: Line[]): Totals | undefined {
  const labelsAt = shown.findIndex((line) => isLabelsLine(line));
  const values = shown[labelsAt - 1];
  const labels = shown[labelsAt];
  if (labelsAt <= 0 || values === undefined || labels === undefined) return undefined;
  const [usd = "", hit = "", rent = ""] = values.text.split(" ");
  return { usd, hit, rent, values, labels };
}

function isLabelsLine(line: Line | undefined): boolean {
  return TOTAL_LABELS.test(line?.text ?? "");
}

export function hasNoSpendNote(shown: Line[]): boolean {
  return shown.some((line) => line.text === NO_SPEND);
}

export function isMuted(part: Node): boolean {
  return part.props?.dimColor === true || part.props?.color === palette.muted;
}

export function isAllMuted(line: Line | undefined): boolean {
  return (line?.parts ?? []).every(isMuted);
}

export type Colour = "text" | "muted" | "other";
export type Run = [Colour, string];

export function colourOf(part: Node): Colour {
  const shown = part.type === "Button" ? (collect(part, "Text")[0] ?? part) : part;
  if (isMuted(shown)) return "muted";
  return shown.props?.color === palette.text ? "text" : "other";
}

export function runsOf(line: Line | undefined): Run[] {
  const runs: Run[] = [];
  for (const part of line?.parts ?? []) {
    const colour = colourOf(part);
    const last = runs.at(-1);
    if (last?.[0] === colour) last[1] += textOf(part);
    else runs.push([colour, textOf(part)]);
  }
  return runs
    .map(([colour, text]): Run => [colour, text.replace(/\s+/g, " ").trim()])
    .filter(([, text]) => text !== "");
}

export function partOf(line: Line | undefined, text: string): Node | undefined {
  return (line?.parts ?? []).find((candidate) => textOf(candidate).trim() === text);
}

export function colourOfText(line: Line | undefined, text: string): Colour | undefined {
  const part = partOf(line, text);
  return part === undefined ? undefined : colourOf(part);
}

export function cellsIn(line: Line | undefined, cell: "▰" | "▱"): number {
  return (line?.text.split(cell).length ?? 1) - 1;
}

export function lineStartingWith(shown: Line[], prefix: string): Line | undefined {
  return shown.find((line) => line.text.startsWith(prefix));
}

export function mutedPartsText(line: Line | undefined): string {
  return (line?.parts ?? []).filter(isMuted).map(textOf).join("").replace(/\s+/g, " ").trim();
}

export function plainPartsText(line: Line | undefined): string {
  return (line?.parts ?? [])
    .filter((part) => !isMuted(part))
    .map(textOf)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export function ownersOf(block: Block | undefined): Owner[] {
  return (block?.rows ?? []).flatMap((line) => {
    const match = OWNER_ROW.exec(line.text);
    if (match === null) return [];
    return [
      {
        name: match[1] ?? "",
        dollars: match[2] ?? null,
        percent: match[3] ?? "",
        filled: line.text.match(FILLED_CELLS)?.length ?? 0,
      },
    ];
  });
}

export function noteRowOf(block: Block | undefined): Line | undefined {
  return block?.rows.find((line) => line.text === BACKGROUND_NOTE);
}

export async function splitOf(pane: Pane): Promise<(string | null)[][]> {
  const found = await blocks(pane);
  return ownersOf(found[SPLIT_TITLE]).map((owner) => [owner.name, owner.dollars, owner.percent]);
}

export function ownerRowOf(block: Block | undefined, name: string): Line | undefined {
  return block?.rows.find((line) => OWNER_ROW.exec(line.text)?.[1] === name);
}

export function centsOf(owners: Owner[]): number {
  return owners.reduce((sum, owner) => sum + toCents(owner.dollars), 0);
}

export function toCents(dollars: string | null): number {
  return dollars === null ? 0 : Math.round(Number(dollars.replace(/[~$]/g, "")) * 100);
}

export function missesOf(block: Block | undefined): Miss[] {
  return (block?.rows ?? []).flatMap((line) => {
    const match = MISS_ROW.exec(line.text);
    if (match === null) return [];
    return [
      {
        time: match[1] ?? "",
        cause: match[2] ?? "",
        tokens: match[3] ?? "",
        dollars: match[4] ?? null,
      },
    ];
  });
}

export function rentRowsOf(block: Block | undefined): RentRow[] {
  return (block?.rows ?? []).flatMap((line) => {
    const match = RENT_ROW.exec(line.text);
    if (match === null || line.text === NO_RENT) return [];
    return [{ tool: match[1] ?? "", target: match[2] ?? "", size: match[3] ?? "" }];
  });
}

export function rowTextsOf(block: Block | undefined): string[] {
  return (block?.rows ?? []).map((line) => line.text);
}

export function spacingOf(shown: Line[]): Spacing {
  const body = bodyOf(shown);
  const blanksAbove = (at: number): number => gapAbove(body, at);
  return {
    gapAboveTop: gapAbove(shown, shown.indexOf(body[0] as Line)),
    blanksBeforeHeadings: HEADINGS.map((title) =>
      body.findIndex((line) => line.text === title || line.text.startsWith(`${title} `)),
    )
      .filter((at) => at !== -1)
      .map(blanksAbove),
    longestBlankRun: Math.max(0, ...body.map((_line, at) => blankRunAt(body, at))),
  };
}

export function blanksBelowHeading(shown: Line[], title: string): number {
  const at = shown.findIndex((line) => line.text === title);
  return at === -1 ? -1 : blankRunAt(shown, at + 1);
}

export function shapeOf(shown: Line[]): string[] {
  let block = "";
  return bodyOf(shown).map((line) => {
    if (line.text === "") return "blank";
    if (isLabelsLine(line)) return "labels";
    if ([...HISTORY_HEADINGS, ...HEADINGS].includes(line.text)) {
      block = line.text;
      return `heading ${line.text}`;
    }
    if (block === "") return "totals";
    if (block === HISTORY_TITLE) return "tiles";
    if (block === PROJECTS_TITLE) return "project";
    if (block === SPLIT_TITLE) return line.text === BACKGROUND_NOTE ? "note" : "spend";
    if (block === CACHE_TITLE) return CACHE_SUMMARY.test(line.text) ? "summary" : "miss";
    return "tool";
  });
}

export async function unwrappedTexts(pane: Pane): Promise<string[]> {
  const found: string[] = [];
  const visit = (node: Node): void => {
    if (node.type === "Text") {
      if (textOf(node) !== "" && !String(node.props?.wrap).startsWith("truncate")) {
        found.push(textOf(node));
      }
      return;
    }
    const children = node.children;
    const list = Array.isArray(children) ? (children.flat(Infinity) as unknown[]) : [children];
    for (const child of list) {
      if (typeof child === "object" && child !== null) visit(child as Node);
    }
  };
  visit(await pane.drawn());
  return found;
}

export function clockText(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export async function settle(pane: Pane): Promise<void> {
  for (let tick = 0; tick < SETTLE_TICKS; tick++) await pane.redraw();
}

export function bodyOf(shown: Line[]): Line[] {
  const topAt = shown.findIndex(
    (line, at) => line.text === NO_SPEND || isLabelsLine(shown[at + 1]),
  );
  const lastAt = shown.findLastIndex((line) => line.text !== "");
  return shown.slice(topAt, lastAt + 1);
}

function blankRunAt(lines: Line[], at: number): number {
  let count = 0;
  while (lines[at + count]?.text === "") count += 1;
  return count;
}

function gapAbove(shown: Line[], at: number): number {
  let count = 0;
  while (at - count - 1 >= 0 && shown[at - count - 1]?.text === "") count += 1;
  return count;
}

export function openPane(
  $: Engine,
  columns: number = COLUMNS,
  rows: number = PANE_ROWS,
): Promise<Pane> {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: "session",
    props: {
      title: "Session",
      isFocused: false,
      bodyColumns: columns,
      placement: "dock",
      scroll: { offset: 0, bodyRows: rows },
      view: {},
    },
    viewport: { columns, rows },
  });
}

export const RICH_COST = 12.37;
export const LONG_AGENT_TYPE = "general-purpose-assistant-for-everything";
export const LONG_PATH = "/work/some/very/deep/folder/structure/that/goes/on/and/on/mcp-draw.tsx";
const RICH_CONTEXT = 100_000;
const RICH_REBUILD = 80_000;
const RICH_GROWTH = 2_000;
const RICH_READ_CHARS = 36_800;

export async function sessionWithAllBlocks($: Engine, world: World): Promise<void> {
  await startFreshSession($, world);
  await mainTurn($, world, { model: OPUS, tokens: { write: RICH_CONTEXT }, context: RICH_CONTEXT });
  await mainTurn($, world, {
    model: OPUS,
    tokens: { input: 500_000, output: 50_000, write: RICH_REBUILD },
    context: RICH_CONTEXT + RICH_GROWTH,
  });
  const agentId = await spawnAgent($, world, LONG_AGENT_TYPE);
  await agentRequest($, world, {
    agentId,
    model: SONNET,
    tokens: { input: 500_000, output: 50_000, write: 200_000, read: 2_500_000 },
    index: 0,
  });
  await readFile($, world, LONG_PATH, RICH_READ_CHARS);
  await setSessionCost($, world, RICH_COST);
}

export type TypicalOptions = { cost: number; isFinishingAgents?: boolean };

const IMPLEMENTER_RUN: Tokens = { input: 500_000, output: 50_000, write: 200_000, read: 2_500_000 };
const EXPLORE_RUN: Tokens = { input: 1_000_000, output: 200_000 };
const MAIN_TYPICAL: Tokens = { input: 500_000, output: 50_000 };

export async function typicalSession(
  $: Engine,
  world: World,
  options: TypicalOptions,
): Promise<void> {
  await startFreshSession($, world);
  await mainTurn($, world, { model: OPUS, tokens: MAIN_TYPICAL });
  const runs: [string, string, Tokens][] = [
    ["implementer", SONNET, IMPLEMENTER_RUN],
    ["implementer", SONNET, IMPLEMENTER_RUN],
    ["Explore", HAIKU, EXPLORE_RUN],
  ];
  for (const [type, model, tokens] of runs) {
    const agentId = await spawnAgent($, world, type);
    await agentRequest($, world, { agentId, model, tokens, index: 0 });
    if (options.isFinishingAgents === true) {
      await finishAgent($, world, agentId, usageOf(model, tokens));
    }
  }
  await setSessionCost($, world, options.cost);
}

export async function agentOwner(
  $: Engine,
  world: World,
  type: string,
  model: string,
  tokens: Tokens,
): Promise<void> {
  const agentId = await spawnAgent($, world, type);
  await agentRequest($, world, { agentId, model, tokens, index: 0 });
}
