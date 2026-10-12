import type { On } from "claude-code";

import { contextBreakdown, markContextStale } from "./breakdown";
import { contextTab } from "./context-draw";
import { PANE } from "./pane-tab";
import { isShownTab, justEntered } from "./shown-tab";
import { isTerminal } from "./surface";

export const CONTEXT_TAB = { id: "context", label: "Context" };

export function registerContextTab(on: On): void {
  on("session.measure", { changed: ["context"] }, async ($, e, next) => {
    if (isShownTab(CONTEXT_TAB.id)) {
      markContextStale();
      $.ui.invalidate("ui.render");
    }
    return next(e);
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e, next) => {
    if (!isTerminal(e)) return next(e);
    if (!isShownTab(CONTEXT_TAB.id)) return next(e);
    if (justEntered(CONTEXT_TAB.id)) markContextStale();
    return contextTab($.ui.resolve(e), {
      context: await contextBreakdown((args) => $.session.usage(args), e.props.bodyColumns),
      width: e.props.bodyColumns,
      height: e.props.scroll.bodyRows,
    });
  });
}
