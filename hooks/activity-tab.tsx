import { atom, read, update } from "claude-code";
import type { EngineInterface, On } from "claude-code";

import type { Activity, CallBody, CallRecord, RunningCall } from "../types";
import { NO_CALL_COUNTS, withoutCounts } from "./activity-calls";
import { showCall } from "./activity-track";
import type { WaitingCall } from "./activity-track";
import { activityTab } from "./activity-draw";
import { withoutCleared } from "./clear-kit";
import { failureText } from "./command-failure";
import { focusFilter, isLightTheme } from "./pane-kit";
import { fillsFor } from "./palette";
import { forgetDetail, keepPane, leaveDetail, PANE } from "./pane-tab";
import { isShownTab } from "./shown-tab";

export const ACTIVITY_TAB = { id: "activity", label: "Activity" };

const callsAtom = atom({ plugin: "paneline", key: "calls" } as const, [] as CallRecord[], {
  shape: "calls-slim",
});
const activityAtom = atom({ plugin: "paneline", key: "activity" } as const, [] as Activity[]);
const runningAtom = atom({ plugin: "paneline", key: "running" } as const, [] as RunningCall[]);
const totalMsAtom = atom({ plugin: "paneline", key: "totalMs" } as const, 0);
const callCountsAtom = atom({ plugin: "paneline", key: "callCounts" } as const, NO_CALL_COUNTS);
const clearedAtom = atom({ plugin: "paneline", key: "activityCleared" } as const, {
  ids: [] as string[],
  totalMs: 0,
  toolsMs: 0,
  youMs: 0,
});
const waitingAtom = atom({ plugin: "paneline", key: "waiting" } as const, [] as WaitingCall[]);
const waitTickAtom = atom({ plugin: "paneline", key: "waitTick" } as const, 0);
const timeSplitAtom = atom({ plugin: "paneline", key: "timeSplit" } as const, {
  modelMs: 0,
  toolsMs: 0,
  youMs: 0,
});
const themeAtom = atom({ plugin: "paneline", key: "theme" } as const, "dark");
const tabAtom = atom({ plugin: "paneline", key: "tab" } as const, "activity");
const activityFilterAtom = atom({ plugin: "paneline", key: "activityFilter" } as const, "");
const openCallAtom = atom({ plugin: "paneline", key: "openCall" } as const, null as string | null);
const callLookupAtom = atom(
  { plugin: "paneline", key: "callLookup" } as const,
  null as { id: string; call: (CallRecord & CallBody) | null } | null,
);
const unfoldedAtom = atom(
  { plugin: "paneline", key: "unfoldedCall" } as const,
  null as string | null,
);
const allowedOpenAtom = atom({ plugin: "paneline", key: "allowedOpen" } as const, false);
const mainTurnRunningAtom = atom({ plugin: "paneline", key: "mainTurnRunning" } as const, false);
const failedOpenAtom = atom({ plugin: "paneline", key: "failedOpen" } as const, false);

export function registerActivityTab(on: On): void {
  on("command.run", { command: "paneline" }, async ($, e, next) => {
    try {
      await showCall($, null);
      await forgetDetail($, ACTIVITY_TAB.id);
      return await next(e);
    } catch (error) {
      const text = failureText(error);
      $.ui.log(text, { to: "debug" });
      return { text };
    }
  });

  on("ui.close", { id: PANE }, async ($, e, next) => {
    if (e.origin.kind !== "person" || (await read($, tabAtom)) !== ACTIVITY_TAB.id) return next(e);
    if ((await read($, openCallAtom)) !== null) {
      await closeCall($);
      return keepPane($);
    }
    if ((await read($, activityFilterAtom)) === "") return next(e);
    await update($, activityFilterAtom, () => "");
    return keepPane($);
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e, next) => {
    if (!isShownTab(ACTIVITY_TAB.id)) return next(e);
    const [
      allActivity,
      allCalls,
      running,
      allMs,
      allCounts,
      cwd,
      openCallId,
      storedLookup,
      unfoldedCall,
      theme,
      cleared,
      home,
      waiting,
      now,
      split,
      filter,
      allowedOpen,
      failedOpen,
      isMainTurnRunning,
    ] = await Promise.all([
      read($, activityAtom),
      read($, callsAtom),
      read($, runningAtom),
      read($, totalMsAtom),
      read($, callCountsAtom),
      $.session.cwd(),
      read($, openCallAtom),
      read($, callLookupAtom),
      read($, unfoldedAtom),
      read($, themeAtom),
      read($, clearedAtom),
      $.env.get("HOME"),
      read($, waitingAtom),
      read($, waitTickAtom),
      read($, timeSplitAtom),
      read($, activityFilterAtom),
      read($, allowedOpenAtom),
      read($, failedOpenAtom),
      read($, mainTurnRunningAtom),
    ]);
    const lookup = storedLookup?.id === openCallId ? storedLookup : undefined;
    return activityTab($.ui.resolve(e), {
      activity: withoutCleared(allActivity, cleared.ids),
      calls: withoutCleared(allCalls, cleared.ids),
      counts: withoutCounts(allCounts, cleared.counts),
      running,
      totalMs: allMs - cleared.totalMs,
      waiting: waiting.filter((call) => call.isMain),
      now,
      modelMs: split.modelMs - (cleared.modelMs ?? 0),
      toolsMs: split.toolsMs - (cleared.toolsMs ?? 0),
      youMs: split.youMs - (cleared.youMs ?? 0),
      cwd,
      width: e.props.bodyColumns,
      openCallId,
      openedCall: lookup?.call ?? undefined,
      isLookedUp: lookup !== undefined,
      openCall: (id) => void showCall($, id),
      closeCall: () => void closeCall($),
      isLightTheme: isLightTheme(theme),
      clear: () => void clearActivity($),
      rows: e.props.scroll.bodyRows,
      isUnfolded: unfoldedCall === openCallId,
      unfold: () => void update($, unfoldedAtom, () => openCallId),
      fold: () => void update($, unfoldedAtom, () => null),
      isAllowedOpen: allowedOpen,
      toggleAllowed: () => void update($, allowedOpenAtom, (isOpen) => !isOpen),
      isFailedOpen: failedOpen,
      toggleFailed: () => void update($, failedOpenAtom, (isOpen) => !isOpen),
      isMainTurnRunning,
      fills: fillsFor(theme),
      home,
      surface: e.surface,
      copy: (text, press) => {
        void $.ui
          .copy({ text, surface: press.surface })
          .then((result) => result.isCopied)
          .catch(() => false)
          .then((isCopied) => $.ui.toast(isCopied ? "Copied" : "Could not copy here"));
      },
      filter,
      setFilter: (text) => void update($, activityFilterAtom, () => text),
      focusFilter: () => void focusFilter($),
    });
  });
}

async function closeCall($: EngineInterface): Promise<void> {
  await showCall($, null);
  await leaveDetail($, ACTIVITY_TAB.id);
}

async function clearActivity($: EngineInterface): Promise<void> {
  const [activity, calls, totalMs, counts, split] = await Promise.all([
    read($, activityAtom),
    read($, callsAtom),
    read($, totalMsAtom),
    read($, callCountsAtom),
    read($, timeSplitAtom),
  ]);
  await update($, clearedAtom, () => ({
    ids: [...activity, ...calls].map((entry) => entry.id),
    totalMs,
    counts,
    modelMs: split.modelMs,
    toolsMs: split.toolsMs,
    youMs: split.youMs,
  }));
}
