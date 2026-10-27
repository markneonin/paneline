import { atom, read, update } from "claude-code";
import type { EngineInterface, On } from "claude-code";

import type { AgentTree } from "../types";
import { agentsTab } from "./agents-draw";
import { finishedKeys, withoutCleared } from "./agents-model";
import { PANE } from "./pane-tab";
import { isShownTab } from "./shown-tab";

export const AGENTS_TAB = { id: "agents", label: "Agents" };

const agentsAtom = atom({ plugin: "paneline", key: "agents" } as const, {} as AgentTree);
const agentsTickAtom = atom({ plugin: "paneline", key: "agentsTick" } as const, 0);
const clearedAtom = atom({ plugin: "paneline", key: "agentsCleared" } as const, [] as string[]);
const sessionUsdAtom = atom(
  { plugin: "paneline", key: "sessionUsd" } as const,
  null as number | null,
);

export function registerAgentsTab(on: On): void {
  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e, next) => {
    if (!isShownTab(AGENTS_TAB.id)) return next(e);
    const [allAgents, sessionUsd, model, now, cleared] = await Promise.all([
      read($, agentsAtom),
      read($, sessionUsdAtom),
      $.session.model(),
      $.clock.now(),
      read($, clearedAtom),
      read($, agentsTickAtom),
    ]);
    return agentsTab($.ui.resolve(e), {
      agents: withoutCleared(allAgents, cleared),
      sessionUsd,
      model,
      now,
      width: e.props.bodyColumns,
      height: e.props.scroll.bodyRows,
      offset: e.props.scroll.offset,
      clear: () => void clearFinishedAgents($),
    });
  });
}

async function clearFinishedAgents($: EngineInterface): Promise<void> {
  const agents = await read($, agentsAtom);
  await update($, clearedAtom, () => finishedKeys(agents));
}
