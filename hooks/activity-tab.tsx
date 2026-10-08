import { atom, read, update } from "claude-code";
import type { EngineInterface, On } from "claude-code";

import type { Activity, CallRecord, RunningCall } from "../types";
import { activityTab } from "./activity-draw";
import { withoutCleared } from "./clear-kit";
import { failureText } from "./command-failure";
import { isLightTheme } from "./pane-kit";
import { PANE } from "./pane-tab";
import { isShownTab } from "./shown-tab";
import { isTerminal } from "./surface";

export const ACTIVITY_TAB = { id: "activity", label: "Activity" };

const callsAtom = atom({ plugin: "paneline", key: "calls" } as const, [] as CallRecord[]);
const activityAtom = atom({ plugin: "paneline", key: "activity" } as const, [] as Activity[]);
const runningAtom = atom({ plugin: "paneline", key: "running" } as const, [] as RunningCall[]);
const totalMsAtom = atom({ plugin: "paneline", key: "totalMs" } as const, 0);
const clearedAtom = atom({ plugin: "paneline", key: "activityCleared" } as const, {
  ids: [] as string[],
  totalMs: 0,
});
const themeAtom = atom({ plugin: "paneline", key: "theme" } as const, "dark");
const openCallAtom = atom({ plugin: "paneline", key: "openCall" } as const, null as string | null);

export function registerActivityTab(on: On): void {
  on("command.run", { command: "session" }, async ($, e, next) => {
    try {
      await update($, openCallAtom, () => null);
      return await next(e);
    } catch (error) {
      const text = failureText(error);
      $.ui.log(text, { to: "debug" });
      return { text };
    }
  });

  on("ui.close", { id: PANE }, async ($, e, next) => {
    if (e.origin.kind !== "person" || (await read($, openCallAtom)) === null) return next(e);
    await update($, openCallAtom, () => null);
    return { value: undefined };
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e, next) => {
    if (!isTerminal(e)) return next(e);
    if (!isShownTab(ACTIVITY_TAB.id)) return next(e);
    const [allActivity, allCalls, running, allMs, cwd, openCallId, theme, cleared] =
      await Promise.all([
        read($, activityAtom),
        read($, callsAtom),
        read($, runningAtom),
        read($, totalMsAtom),
        $.session.cwd(),
        read($, openCallAtom),
        read($, themeAtom),
        read($, clearedAtom),
      ]);
    return activityTab($.ui.resolve(e), {
      activity: withoutCleared(allActivity, cleared.ids),
      calls: withoutCleared(allCalls, cleared.ids),
      running,
      totalMs: allMs - cleared.totalMs,
      cwd,
      width: e.props.bodyColumns,
      openCallId,
      openCall: (id) => void update($, openCallAtom, () => id),
      closeCall: () => void update($, openCallAtom, () => null),
      isLightTheme: isLightTheme(theme),
      clear: () => void clearActivity($),
    });
  });
}

async function clearActivity($: EngineInterface): Promise<void> {
  const [activity, calls, totalMs] = await Promise.all([
    read($, activityAtom),
    read($, callsAtom),
    read($, totalMsAtom),
  ]);
  await update($, clearedAtom, () => ({
    ids: [...activity, ...calls].map((entry) => entry.id),
    totalMs,
  }));
}
