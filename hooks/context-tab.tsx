import { atom, read, update } from "claude-code";
import type { On } from "claude-code";

import { contextBreakdown, markContextStale } from "./breakdown";
import { contextTab } from "./context-draw";
import { PANE } from "./pane-tab";
import { isShownTab, justEntered } from "./shown-tab";
import { emptySpend } from "./spend-model";

export const CONTEXT_TAB = { id: "context", label: "Context" };

const spendAtom = atom({ plugin: "paneline", key: "spend" } as const, emptySpend());
const measureStampAtom = atom({ plugin: "paneline", key: "measureStamp" } as const, 0);

export function registerContextTab(on: On): void {
  on("session.measure", { changed: ["context"] }, async ($, e, next) => {
    if (isShownTab(CONTEXT_TAB.id)) {
      markContextStale();
      await update($, measureStampAtom, (stamp) => stamp + 1);
    }
    return next(e);
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e, next) => {
    if (!isShownTab(CONTEXT_TAB.id)) return next(e);
    if (justEntered(CONTEXT_TAB.id)) markContextStale();
    await read($, measureStampAtom);
    const [context, spend] = await Promise.all([
      contextBreakdown((args) => $.session.usage(args), e.props.bodyColumns),
      read($, spendAtom),
    ]);
    return contextTab($.ui.resolve(e), {
      context,
      spend,
      width: e.props.bodyColumns,
      height: e.props.scroll.bodyRows,
    });
  });
}
