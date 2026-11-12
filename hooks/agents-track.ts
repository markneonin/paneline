import { gitText } from "./git-run";
import { atom, read, update } from "claude-code";
import type { EngineInterface, On, Timer, TurnUsage } from "claude-code";

import type { AgentTree, SpendState } from "../types";
import { AGENTS_TAB } from "./agents-tab";
import {
  completed,
  located,
  pruned,
  reconciled,
  spawned,
  stepped,
  toolEnded,
  toolStarted,
} from "./agents-model";
import type { Place } from "./agents-place";
import { directoryOf } from "./agents-place";
import { PANE } from "./pane-tab";
import {
  afterAgentRequest,
  afterMainResponse,
  BACKGROUND_OWNER,
  emptySpend,
  hasBaseline,
  withBaseline,
} from "./spend-model";
import { pruneTranscripts, saveSessionSpend } from "./store-queue";
import { SPEND_TAB } from "./spend-tab";
import { refreshSpendTotals } from "./spend-track";
import { forgetShownTab, isShownTab, justEntered } from "./shown-tab";
import { folderName, isInside } from "./paths";
import { targetOf } from "./tools";

const FLUSH_DELAY_MS = 1000;
export const POLL_MS = 1000;
const PRESENT_AGENT_ID = /^(?!undefined$)./;

const agentsAtom = atom({ plugin: "paneline", key: "agents" } as const, {} as AgentTree);
const sessionUsdAtom = atom(
  { plugin: "paneline", key: "sessionUsd" } as const,
  null as number | null,
);

const agentsTickAtom = atom({ plugin: "paneline", key: "agentsTick" } as const, 0);
const spendAtom = atom({ plugin: "paneline", key: "spend" } as const, emptySpend());

type AgentRequest = Parameters<typeof afterAgentRequest>[2];

let tree: AgentTree = {};
let written: AgentTree = tree;
const pendingRequests: AgentRequest[] = [];
let seeding: Promise<void> | undefined;
let pendingFlush: Timer | undefined;
let poller: Timer | undefined;
let lastUsd: number | null | undefined;
const places = new Map<string, Place | null>();
const rootOfAgent = new Map<string, string>();
const stepOfParent = new Map<string, string>();
const MAIN_PARENT = "main";

export function agentsStartedSince(at: number): number {
  return Object.values(tree).filter((node) => node.startedAt >= at).length;
}

export function trackAgentsClose(on: On): void {
  on("ui.close", { id: PANE }, async ($, e, next) => {
    forgetShownTab();
    stopPolling($);
    return next(e);
  });
}

export function trackAgents(on: On): void {
  on("agent.spawn", async ($, e, next) => {
    const spawn = await next(e);
    if (spawn.agentId === undefined) return spawn;
    const agentId = spawn.agentId;
    const at = await $.clock.now();
    const batch = stepOfParent.get(e.parentAgentId ?? MAIN_PARENT);
    await record($, (current) =>
      spawned(current, {
        ...(batch !== undefined && { batch }),
        id: agentId,
        parentId: e.parentAgentId,
        type: e.subagentType,
        description: e.description,
        name: e.name,
        background: e.background,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        model: spawn.model ?? e.model ?? "",
        at,
      }),
    );
    if (isShownTab(AGENTS_TAB.id)) startPolling($);
    if (e.cwd !== undefined) await locate($, agentId, e.cwd);
    return spawn;
  });

  on("tool.call", { agentId: PRESENT_AGENT_ID }, async ($, e, next) => {
    const agentId = e.agentId;
    if (agentId === undefined) return next(e);
    const started = { callId: e.tool_use_id, tool: e.tool, target: targetOf(e) };
    await record($, (current) => toolStarted(current, agentId, started));
    try {
      return await next(e);
    } finally {
      await record($, (current) => toolEnded(current, agentId, e.tool_use_id));
      const dir = rootOfAgent.has(agentId) ? undefined : directoryOf(e);
      if (dir !== undefined) await locate($, agentId, dir);
    }
  });

  on("turn.step", async function* ($, e, next) {
    stepOfParent.set(e.agentId ?? MAIN_PARENT, `${e.turnId}:${e.index}`);
    const startedAt = await $.clock.now();
    const step = yield* next(e);
    const agentId = e.agentId;
    if (agentId === undefined) {
      if (step.usage !== null) await bookMainResponse($, step.usage);
      return step;
    }
    await record($, (current) =>
      stepped(current, agentId, {
        model: e.model,
        effort: e.effort?.toString(),
        usage: step.usage,
      }),
    );
    if (step.usage !== null) {
      const request = {
        agentId,
        index: e.index,
        usage: step.usage,
        startedAt,
        endedAt: await $.clock.now(),
      };
      pendingRequests.push(request);
      if (!poller) scheduleFlush($);
    }
    return step;
  });

  on("turn.complete", { agentId: PRESENT_AGENT_ID }, async ($, e, next) => {
    const agentId = e.agentId;
    if (agentId === undefined) return next(e);
    const at = await $.clock.now();
    await record($, (current) => completed(current, agentId, e.reason, at));
    await relocate($, agentId);
    return next(e);
  });

  on("ui.render", { component: "Pane", requestId: PANE }, ($, e, next) => {
    if (justEntered(AGENTS_TAB.id)) void watchAgents($);
    return next(e);
  });

  on("session.measure", { changed: ["cost"] }, async ($, e, next) => {
    const usd = e.cost?.usd ?? null;
    if (usd !== lastUsd) {
      lastUsd = usd;
      const baseline = usd === null ? undefined : await baselineState($, usd);
      try {
        if (baseline) await saveSessionSpend($, baseline);
      } finally {
        await update($, sessionUsdAtom, () => usd);
      }
      if (usd !== null && (isShownTab(SPEND_TAB.id) || isShownTab(AGENTS_TAB.id)))
        void refreshSpendTotals($);
    }
    return next(e);
  });

  on(
    "classic.SessionStart",
    { source: ["startup", "resume", "clear", "fork"] },
    async ($, e, next) => {
      if (e.agent_id === undefined) pruneTranscripts($);
      return next(e);
    },
  );

  on("classic.SessionStart", { source: "clear" }, async ($, e, next) => {
    pendingRequests.length = 0;
    stopPolling($);
    places.clear();
    rootOfAgent.clear();
    stepOfParent.clear();
    await record($, () => ({}));
    return next(e);
  });
}

async function locate($: EngineInterface, agentId: string, dir: string): Promise<void> {
  if (!places.has(dir)) places.set(dir, await readPlace($, dir));
  const place = places.get(dir);
  if (!place) return;
  rootOfAgent.set(agentId, place.root);
  await showPlace($, agentId, place);
}

async function relocate($: EngineInterface, agentId: string): Promise<void> {
  const root = rootOfAgent.get(agentId);
  if (root === undefined) return;
  const place = await readPlace($, root);
  if (!place) return;
  places.set(root, place);
  await showPlace($, agentId, place);
}

async function showPlace(
  $: EngineInterface,
  agentId: string,
  { root, branch }: Place,
): Promise<void> {
  const isMainCheckout = isInside(await $.session.cwd(), root);
  await record($, (current) =>
    located(current, agentId, { branch, ...(!isMainCheckout && { worktree: folderName(root) }) }),
  );
}

async function readPlace($: EngineInterface, dir: string): Promise<Place | null> {
  const out = await gitText(
    {
      run: (argv) => $.process.run(argv),
      report: (error) => $.ui.log(`git failed: ${String(error)}`, { to: "debug" }),
    },
    dir,
    ["rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"],
  );
  const [root, branch] = out?.split("\n") ?? [];
  return root && branch ? { root, branch } : null;
}

async function record(
  $: EngineInterface,
  change: (current: AgentTree) => AgentTree,
): Promise<void> {
  await seeded($);
  const changed = change(tree);
  if (changed === tree) return;
  tree = changed;
  if (!poller) scheduleFlush($);
}

function seeded($: EngineInterface): Promise<void> {
  seeding ??= read($, agentsAtom).then((saved) => {
    tree = saved;
    written = saved;
  });
  return seeding;
}

async function watchAgents($: EngineInterface): Promise<void> {
  await reconcileListed($);
  startPolling($);
}

function startPolling($: EngineInterface): void {
  if (hasRunningAgent()) poller ??= $.clock.every(POLL_MS, () => void pollOnce($));
}

function stopPolling($: EngineInterface): void {
  poller?.cancel();
  poller = undefined;
  if (tree !== written || pendingRequests.length > 0) scheduleFlush($);
}

function hasRunningAgent(): boolean {
  return Object.values(tree).some((node) => node.status === "running");
}

async function reconcileListed($: EngineInterface): Promise<number> {
  const [listed, at] = await Promise.all([$.agent.list(), $.clock.now()]);
  await record($, (current) => reconciled(current, listed, at));
  return at;
}

async function pollOnce($: EngineInterface): Promise<void> {
  const at = await reconcileListed($);
  const stateWrite = writeTree($) ?? update($, agentsTickAtom, () => at);
  await Promise.all([stateWrite, ...spendWrites($)]);
  if (!hasRunningAgent() || !isShownTab(AGENTS_TAB.id)) stopPolling($);
}

function scheduleFlush($: EngineInterface): void {
  if (pendingFlush) return;
  pendingFlush = $.clock.after(FLUSH_DELAY_MS, () => {
    pendingFlush = undefined;
    void Promise.all([writeTree($), ...spendWrites($)]);
  });
}

function writeTree($: EngineInterface): Promise<unknown> | undefined {
  tree = pruned(tree);
  if (tree === written) return undefined;
  written = tree;
  return update($, agentsAtom, () => tree);
}

function spendWrites($: EngineInterface): Promise<unknown>[] {
  if (pendingRequests.length === 0) return [];
  return [writeSpend($, pendingRequests.splice(0))];
}

async function bookMainResponse($: EngineInterface, usage: TurnUsage): Promise<void> {
  const { rateLimits } = await $.session.usage();
  const fallbackTtl = rateLimits.length > 0 ? "1h" : "5m";
  const state = await update($, spendAtom, (current) =>
    afterMainResponse(current, usage, current.mainCacheTtl ?? fallbackTtl),
  );
  await saveSessionSpend($, state);
}

async function writeSpend($: EngineInterface, requests: AgentRequest[]): Promise<void> {
  const state = await update($, spendAtom, (current) =>
    requests.reduce(
      (acc, request) =>
        afterAgentRequest(acc, tree[request.agentId]?.type ?? BACKGROUND_OWNER, request),
      current,
    ),
  );
  await saveSessionSpend($, state);
}

async function baselineState($: EngineInterface, usd: number): Promise<SpendState | undefined> {
  if (hasBaseline(await read($, spendAtom))) return undefined;
  return update($, spendAtom, (current) => withBaseline(current, usd));
}
