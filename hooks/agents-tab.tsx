import { atom, read, update } from "claude-code";
import type { EngineInterface, On } from "claude-code";

import type { AgentTree } from "../types";
import { agentsTab } from "./agents-draw";
import { finishedKeys, withoutCleared } from "./agents-model";
import { PANE } from "./pane-tab";
import { isShownTab } from "./shown-tab";
import { isTerminal } from "./surface";

export const AGENTS_TAB = { id: "agents", label: "Agents" };

const agentsAtom = atom({ plugin: "paneline", key: "agents" } as const, {} as AgentTree);
const clearedAtom = atom({ plugin: "paneline", key: "agentsCleared" } as const, [] as string[]);
const sessionUsdAtom = atom(
  { plugin: "paneline", key: "sessionUsd" } as const,
  null as number | null,
);

export function registerAgentsTab(on: On): void {
  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e, next) => {
    if (!isTerminal(e)) return next(e);
    if (!isShownTab(AGENTS_TAB.id)) return next(e);
    const [allAgents, sessionUsd, model, now, cleared] = await Promise.all([
      read($, agentsAtom),
      read($, sessionUsdAtom),
      $.session.model(),
      $.clock.now(),
      read($, clearedAtom),
    ]);
    return agentsTab($.ui.resolve(e), {
      agents: withoutCleared(allAgents, cleared),
      sessionUsd,
      model,
      now,
      width: e.props.bodyColumns,
      height: e.props.scroll.bodyRows,
      clear: () => void clearFinishedAgents($),
    });
  });
}

async function clearFinishedAgents($: EngineInterface): Promise<void> {
  const agents = await read($, agentsAtom);
  await update($, clearedAtom, () => finishedKeys(agents));
}
