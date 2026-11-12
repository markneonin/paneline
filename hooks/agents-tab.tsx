import { atom, read, update } from "claude-code";
import type { EngineInterface, On, SessionMessagesResult } from "claude-code";

import type {
  AgentNode,
  AgentTree,
  CallRecord,
  SpendOwner,
  SpendState,
  SpendTotals,
} from "../types";
import { ACTIVITY_TAB } from "./activity-tab";
import { showCall } from "./activity-track";
import { agentsTab, titleOf } from "./agents-draw";
import { agentTranscript } from "./agents-transcript";
import { finishedKeys, withoutCleared } from "./agents-model";
import { fillsFor } from "./palette";
import { enterDetail, keepPane, leaveDetail, PANE } from "./pane-tab";
import { isShownTab, justEntered } from "./shown-tab";
import type { SplitRow } from "./spend-model";
import { agentSplit, emptySpend, MAIN_OWNER, sessionSpendUsd, splitRows } from "./spend-model";
import { refreshSpendTotals } from "./spend-track";

export const AGENTS_TAB = { id: "agents", label: "Agents" };

const agentsAtom = atom({ plugin: "paneline", key: "agents" } as const, {} as AgentTree);
const agentsTickAtom = atom({ plugin: "paneline", key: "agentsTick" } as const, 0);
const clearedAtom = atom({ plugin: "paneline", key: "agentsCleared" } as const, [] as string[]);
const tabAtom = atom({ plugin: "paneline", key: "tab" } as const, "activity");
const openAgentAtom = atom(
  { plugin: "paneline", key: "openAgent" } as const,
  null as string | null,
);
const expandedAgentAtom = atom(
  { plugin: "paneline", key: "expandedAgent" } as const,
  null as string | null,
);
const sessionUsdAtom = atom(
  { plugin: "paneline", key: "sessionUsd" } as const,
  null as number | null,
);
const mainTurnRunningAtom = atom({ plugin: "paneline", key: "mainTurnRunning" } as const, false);
const spendAtom = atom({ plugin: "paneline", key: "spend" } as const, emptySpend());
const spendTotalsAtom = atom(
  { plugin: "paneline", key: "spendTotals" } as const,
  null as SpendTotals | null,
);
const callsAtom = atom({ plugin: "paneline", key: "calls" } as const, [] as CallRecord[], {
  shape: "calls-slim",
});
const themeAtom = atom({ plugin: "paneline", key: "theme" } as const, "dark");

let transcriptRead: { key: string; messages: SessionMessagesResult } | undefined;

export function registerAgentsTab(on: On): void {
  on("ui.close", { id: PANE }, async ($, e, next) => {
    if (e.origin.kind !== "person" || (await read($, tabAtom)) !== AGENTS_TAB.id) return next(e);
    if ((await read($, openAgentAtom)) === null) return next(e);
    await closeTranscript($);
    return keepPane($);
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e, next) => {
    if (!isShownTab(AGENTS_TAB.id)) return next(e);
    const [
      allAgents,
      engineSessionUsd,
      totals,
      spend,
      model,
      cwd,
      now,
      cleared,
      openId,
      expandedId,
      calls,
      theme,
      isMainRunning,
    ] = await Promise.all([
      read($, agentsAtom),
      read($, sessionUsdAtom),
      read($, spendTotalsAtom),
      read($, spendAtom),
      $.session.model(),
      $.session.cwd(),
      $.clock.now(),
      read($, clearedAtom),
      read($, openAgentAtom),
      read($, expandedAgentAtom),
      read($, callsAtom),
      read($, themeAtom),
      read($, mainTurnRunningAtom),
      read($, agentsTickAtom),
    ]);
    if (justEntered(AGENTS_TAB.id)) void refreshSpendTotals($);
    const sessionUsd = sessionSpendUsd(totals, engineSessionUsd, spend);
    const agents = withoutCleared(allAgents, cleared);
    const open = openId === null ? undefined : agents[openId];
    const split = agentSplit(spend, sessionUsd);
    if (open) {
      return agentTranscript($.ui.resolve(e), {
        agent: open,
        share: split[open.id],
        messages: await transcriptOf($, open),
        calls: calls.filter((call) => call.agentId === open.id),
        width: e.props.bodyColumns,
        height: e.props.scroll.bodyRows,
        offset: e.props.scroll.offset,
        cwd,
        now,
        back: () => void closeTranscript($),
        stop: () => void stopAgent($, open),
        openCall: (id) => void openToolCall($, id),
        fills: fillsFor(theme),
        surface: e.surface,
        copy: (text, press) => {
          void $.ui
            .copy({ text, surface: press.surface })
            .then((result) => result.isCopied)
            .catch(() => false)
            .then((isCopied) => $.ui.toast(isCopied ? "Copied" : "Could not copy here"));
        },
        isExpanded: expandedId === open.id,
        expand: () => void update($, expandedAgentAtom, () => open.id),
        collapse: () => void update($, expandedAgentAtom, () => null),
      });
    }
    return agentsTab($.ui.resolve(e), {
      agents,
      main: mainRowOf(spend, sessionUsd),
      mainTokens: tokensOf(spend.owners[MAIN_OWNER]),
      isMainRunning,
      split,
      model,
      now,
      width: e.props.bodyColumns,
      height: e.props.scroll.bodyRows,
      offset: e.props.scroll.offset,
      clear: () => void clearFinishedAgents($),
      openAgent: (id) => void openAgent($, id),
    });
  });
}

function mainRowOf(spend: SpendState, sessionUsd: number | null): SplitRow | undefined {
  const listed = splitRows(spend, sessionUsd).find((row) => row.name === MAIN_OWNER);
  const owner = spend.owners[MAIN_OWNER];
  const isHiddenUnderCent =
    (sessionUsd ?? 0) > 0 && (owner?.pricedTokens ?? 0) > 0 && owner?.unpricedTokens === 0;
  if (listed !== undefined || !isHiddenUnderCent) return listed;
  return { name: MAIN_OWNER, cents: 0, share: 0, percent: 0, value: 0 };
}

function tokensOf(owner: SpendOwner | undefined): number {
  return (owner?.pricedTokens ?? 0) + (owner?.unpricedTokens ?? 0);
}

async function transcriptOf($: EngineInterface, agent: AgentNode): Promise<SessionMessagesResult> {
  const key = changeKey(agent);
  if (transcriptRead?.key === key) return transcriptRead.messages;
  const messages = await $.session.messages({ agentId: agent.id });
  transcriptRead = { key, messages };
  return messages;
}

function changeKey(agent: AgentNode): string {
  return [
    agent.id,
    agent.status,
    agent.endedAt,
    agent.ctxTokens,
    agent.running.map((call) => call.callId).join(","),
  ].join("|");
}

async function clearFinishedAgents($: EngineInterface): Promise<void> {
  const agents = await read($, agentsAtom);
  await update($, clearedAtom, () => finishedKeys(agents));
}

async function openAgent($: EngineInterface, id: string): Promise<void> {
  await enterDetail($, AGENTS_TAB.id);
  await update($, openAgentAtom, () => id);
}

async function openToolCall($: EngineInterface, id: string): Promise<void> {
  await update($, tabAtom, () => ACTIVITY_TAB.id);
  await showCall($, id);
}

async function closeTranscript($: EngineInterface): Promise<void> {
  await update($, openAgentAtom, () => null);
  await update($, expandedAgentAtom, () => null);
  await leaveDetail($, AGENTS_TAB.id);
}

async function stopAgent($: EngineInterface, agent: AgentNode): Promise<void> {
  const answer = await $.ui
    .ask(`Stop ${titleOf(agent)}?`, ["Stop", "Keep running"])
    .catch(() => null);
  if (answer !== "Stop") return;
  const outcome = await $.tool
    .call({ tool: "TaskStop", task_id: agent.id })
    .catch((error: unknown) => ({ deny: String(error) }));
  const reason = "deny" in outcome ? outcome.deny : outcome.isError ? outcome.text : undefined;
  if (reason !== undefined) $.ui.toast(`Could not stop ${titleOf(agent)}: ${reason}`);
}
