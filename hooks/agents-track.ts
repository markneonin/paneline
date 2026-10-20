import { gitText } from "./git-run";
import { atom, read, update } from "claude-code";
import type { EngineInterface, On, Timer } from "claude-code";

import type { AgentTree } from "../types";
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
  BACKGROUND_OWNER,
  emptySpend,
  hasBaseline,
  SPEND_SESSIONS_KEY,
  withBaseline,
  withSession,
} from "./spend-model";
import { forgetShownTab, isShownTab, justEntered } from "./shown-tab";
import { folderName, isInside } from "./paths";
import { targetOf } from "./tools";
import { isTerminal } from "./surface";

const FLUSH_DELAY_MS = 300;
const POLL_MS = 1000;
const PRESENT_AGENT_ID = /^(?!undefined$)./;

const agentsAtom = atom({ plugin: "paneline", key: "agents" } as const, {} as AgentTree);
const sessionUsdAtom = atom(
  { plugin: "paneline", key: "sessionUsd" } as const,
  null as number | null,
);

const spendAtom = atom({ plugin: "paneline", key: "spend" } as const, emptySpend());

let tree: AgentTree = {};
let seeding: Promise<void> | undefined;
let pendingFlush: Timer | undefined;
let poller: Timer | undefined;
let lastUsd: number | null | undefined;
const places = new Map<string, Place | null>();
const rootOfAgent = new Map<string, string>();

export function trackAgents(on: On): void {
  on("agent.spawn", async ($, e, next) => {
    const spawn = await next(e);
    if (spawn.agentId === undefined) return spawn;
    const agentId = spawn.agentId;
    const at = await $.clock.now();
    await record($, (current) =>
      spawned(current, {
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

  on("turn.step", { agentId: PRESENT_AGENT_ID }, async function* ($, e, next) {
    const startedAt = await $.clock.now();
    const step = yield* next(e);
    const agentId = e.agentId;
    if (agentId === undefined) return step;
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
      const owner = tree[agentId]?.type ?? BACKGROUND_OWNER;
      const state = await update($, spendAtom, (current) =>
        afterAgentRequest(current, owner, request),
      );
      await $.store.set(
        SPEND_SESSIONS_KEY,
        withSession(await $.store.get(SPEND_SESSIONS_KEY), await $.session.id(), state),
      );
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
    if (!isTerminal(e)) return next(e);
    if (justEntered(AGENTS_TAB.id)) void watchAgents($);
    return next(e);
  });

  on("ui.close", { id: PANE }, async ($, e, next) => {
    forgetShownTab();
    stopPolling();
    return next(e);
  });

  on("session.measure", { changed: ["cost"] }, async ($, e, next) => {
    const usd = e.cost?.usd ?? null;
    if (usd !== lastUsd) {
      lastUsd = usd;
      await update($, sessionUsdAtom, () => usd);
      if (usd !== null) await settleBaseline($, usd);
    }
    return next(e);
  });

  on("classic.SessionStart", { source: "clear" }, async ($, e, next) => {
    stopPolling();
    places.clear();
    rootOfAgent.clear();
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
  scheduleFlush($);
}

function seeded($: EngineInterface): Promise<void> {
  seeding ??= read($, agentsAtom).then((saved) => {
    tree = saved;
  });
  return seeding;
}

async function watchAgents($: EngineInterface): Promise<void> {
  await pollOnce($);
  startPolling($);
}

function startPolling($: EngineInterface): void {
  if (hasRunningAgent()) poller ??= $.clock.every(POLL_MS, () => void pollOnce($));
}

function stopPolling(): void {
  poller?.cancel();
  poller = undefined;
}

function hasRunningAgent(): boolean {
  return Object.values(tree).some((node) => node.status === "running");
}

async function pollOnce($: EngineInterface): Promise<void> {
  const [listed, at] = await Promise.all([$.agent.list(), $.clock.now()]);
  await record($, (current) => reconciled(current, listed, at));
  $.ui.invalidate("ui.render");
  if (!hasRunningAgent() || !isShownTab(AGENTS_TAB.id)) stopPolling();
}

function scheduleFlush($: EngineInterface): void {
  if (pendingFlush) return;
  pendingFlush = $.clock.after(FLUSH_DELAY_MS, () => {
    pendingFlush = undefined;
    tree = pruned(tree);
    void update($, agentsAtom, () => tree);
  });
}

async function settleBaseline($: EngineInterface, usd: number): Promise<void> {
  if (hasBaseline(await read($, spendAtom))) return;
  const state = await update($, spendAtom, (current) => withBaseline(current, usd));
  await $.store.set(
    SPEND_SESSIONS_KEY,
    withSession(await $.store.get(SPEND_SESSIONS_KEY), await $.session.id(), state),
  );
}
