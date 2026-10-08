import { atom, read } from "claude-code";
import type { On } from "claude-code";

import { PANE } from "./pane-tab";
import { isShownTab } from "./shown-tab";
import { emptySpend, splitRows } from "./spend-model";
import { spendTab } from "./spend-draw";
import { isTerminal } from "./surface";

export const SPEND_TAB = { id: "spend", label: "Spend" };

const spendAtom = atom({ plugin: "paneline", key: "spend" } as const, emptySpend());
const sessionUsdAtom = atom(
  { plugin: "paneline", key: "sessionUsd" } as const,
  null as number | null,
);

export function registerSpendTab(on: On): void {
  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e, next) => {
    if (!isTerminal(e)) return next(e);
    if (!isShownTab(SPEND_TAB.id)) return next(e);
    const [spend, sessionUsd] = await Promise.all([read($, spendAtom), read($, sessionUsdAtom)]);
    return spendTab($.ui.resolve(e), {
      width: e.props.bodyColumns,
      sessionUsd,
      rows: splitRows(spend, sessionUsd),
      spend,
    });
  });
}
