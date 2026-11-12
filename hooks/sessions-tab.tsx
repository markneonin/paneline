import { atom, read, update } from "claude-code";
import type { EngineInterface, On } from "claude-code";

import type { SessionRow, SpendTotals, UsageSnap } from "../types";
import { enterDetail, keepPane, leaveDetail, PANE } from "./pane-tab";
import { cachedTail } from "./session-tail";
import { sessionsTab } from "./sessions-draw";
import { emptySpend, sessionSpendUsd } from "./spend-model";
import { refreshSpendTotals } from "./spend-track";
import { SESSIONS_TAB_ID, startSessionsPolling, syncThrottled } from "./sessions-track";
import { isShownTab, justEntered } from "./shown-tab";

const usageAtom = atom(
  { plugin: "paneline", key: "usage" } as const,
  { context: null, limits: [] } as UsageSnap,
);

export const SESSIONS_TAB = { id: SESSIONS_TAB_ID, label: "Sessions" };

const sessionsAtom = atom(
  { plugin: "paneline", key: "sessions" } as const,
  {} as Record<string, SessionRow>,
);

const spendTotalsAtom = atom(
  { plugin: "paneline", key: "spendTotals" } as const,
  null as SpendTotals | null,
);

const costsAtom = atom(
  { plugin: "paneline", key: "sessionCosts" } as const,
  {} as Record<string, number>,
);

const spendAtom = atom({ plugin: "paneline", key: "spend" } as const, emptySpend());

const sessionUsdAtom = atom(
  { plugin: "paneline", key: "sessionUsd" } as const,
  null as number | null,
);

const syncedAtom = atom({ plugin: "paneline", key: "sessionsSynced" } as const, false);

const openPidAtom = atom(
  { plugin: "paneline", key: "openSession" } as const,
  null as number | null,
);

export function registerSessionsTab(on: On): void {
  on("ui.close", { id: PANE }, async ($, e, next) => {
    if (e.origin.kind !== "person" || !isShownTab(SESSIONS_TAB.id)) return next(e);
    if ((await read($, openPidAtom)) === null) return next(e);
    await closeDetail($);
    return keepPane($);
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e, next) => {
    if (!isShownTab(SESSIONS_TAB.id)) return next(e);
    const isEntering = justEntered(SESSIONS_TAB.id);
    if (isEntering) {
      void syncThrottled($);
      startSessionsPolling($);
      void refreshSpendTotals($);
    }
    const [
      sessions,
      usage,
      currentSessionId,
      home,
      now,
      openPid,
      isSynced,
      totals,
      costs,
      spend,
      engineUsd,
    ] = await Promise.all([
      read($, sessionsAtom),
      read($, usageAtom),
      $.session.id(),
      $.env.get("HOME"),
      $.clock.now(),
      read($, openPidAtom),
      read($, syncedAtom),
      read($, spendTotalsAtom),
      read($, costsAtom),
      read($, spendAtom),
      read($, sessionUsdAtom),
    ]);
    const ownUsd = sessionSpendUsd(totals, engineUsd, spend);
    const rows = Object.values(sessions).map((row) => {
      if (row.sessionId === currentSessionId) {
        return { ...row, ctx: usage.context ?? row.ctx, usd: positive(ownUsd) };
      }
      return { ...row, usd: positive(costs[row.sessionId]) };
    });
    return sessionsTab($.ui.resolve(e), {
      rows,
      now,
      tails: Object.fromEntries(rows.map((row) => [row.pid, cachedTail(row.transcriptPath)])),
      home,
      ownSessionId: currentSessionId,
      width: e.props.bodyColumns,
      openPid,
      isSynced,
      open: (pid) => void openDetail($, pid),
      close: () => void closeDetail($),
      copy: (text, press) => {
        void $.ui
          .copy({ text, surface: press.surface })
          .then((result) => result.isCopied)
          .catch(() => false)
          .then((isCopied) => $.ui.toast(isCopied ? `Copied ${text}` : "Could not copy here"));
      },
    });
  });
}

function positive(usd: number | null | undefined): number | null {
  return usd !== undefined && usd !== null && usd > 0 ? usd : null;
}

async function openDetail($: EngineInterface, pid: number): Promise<void> {
  await enterDetail($, SESSIONS_TAB.id);
  await update($, openPidAtom, () => pid);
}

async function closeDetail($: EngineInterface): Promise<void> {
  await update($, openPidAtom, () => null);
  await leaveDetail($, SESSIONS_TAB.id);
}
