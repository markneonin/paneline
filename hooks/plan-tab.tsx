import { atom, read, update } from "claude-code";
import type { On } from "claude-code";

import { planTab } from "./plan-draw";
import { PANE } from "./pane-tab";
import { isShownTab } from "./shown-tab";

export const PLAN_TAB = { id: "plan", label: "Plan" };

const progressAtom = atom(
  { plugin: "paneline", key: "progress" } as const,
  {
    tasks: {},
    percent: null,
  } as {
    tasks: Record<string, { status: "pending" | "in_progress" | "completed"; title: string }>;
    percent: number | null;
  },
);
const planDoneOpenAtom = atom({ plugin: "paneline", key: "planDoneOpen" } as const, false);

export function registerPlanTab(on: On): void {
  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e, next) => {
    if (!isShownTab(PLAN_TAB.id)) return next(e);
    const [{ tasks }, isDoneOpen] = await Promise.all([
      read($, progressAtom),
      read($, planDoneOpenAtom),
    ]);
    return planTab($.ui.resolve(e), {
      tasks: Object.values(tasks),
      width: e.props.bodyColumns,
      isDoneOpen,
      toggleDone: () => void update($, planDoneOpenAtom, (isOpen) => !isOpen),
    });
  });
}
