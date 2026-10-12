import { atom, read, update } from "claude-code";
import type { EngineInterface, On } from "claude-code";

import type { Activity, AgentEdit, AgentTree, GitChange } from "../types";
import { withoutCleared } from "./clear-kit";
import { filesTab } from "./files-draw";
import { PANE } from "./pane-tab";
import { isShownTab, justEntered } from "./shown-tab";
import { isTerminal } from "./surface";

export const FILES_TAB = { id: "files", label: "Files" };

const activityAtom = atom({ plugin: "paneline", key: "activity" } as const, [] as Activity[]);
const agentEditsAtom = atom({ plugin: "paneline", key: "agentEdits" } as const, [] as AgentEdit[]);
const gitChangesAtom = atom({ plugin: "paneline", key: "gitChanges" } as const, [] as GitChange[]);
const gitBranchesAtom = atom(
  { plugin: "paneline", key: "gitBranches" } as const,
  {} as Record<string, string>,
);
const filesFoldedAtom = atom(
  { plugin: "paneline", key: "filesFolded" } as const,
  {} as Record<string, boolean>,
);
const clearedAtom = atom({ plugin: "paneline", key: "filesCleared" } as const, [] as string[]);
const agentsAtom = atom({ plugin: "paneline", key: "agents" } as const, {} as AgentTree);

let goneCheck: { key: string | null; gone: Set<string> } = { key: null, gone: new Set() };

export function registerFilesTab(on: On): void {
  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e, next) => {
    if (!isTerminal(e)) return next(e);
    if (!isShownTab(FILES_TAB.id)) return next(e);
    if (justEntered(FILES_TAB.id)) goneCheck = { key: null, gone: new Set() };
    const [allActivity, allAgentEdits, gitChanges, branches, folded, agents, home, cleared] =
      await Promise.all([
        read($, activityAtom),
        read($, agentEditsAtom),
        read($, gitChangesAtom),
        read($, gitBranchesAtom),
        read($, filesFoldedAtom),
        read($, agentsAtom),
        $.env.get("HOME"),
        read($, clearedAtom),
      ]);
    const activity = withoutCleared(allActivity, cleared);
    const agentEdits = withoutCleared(allAgentEdits, cleared);
    const targets = [
      ...new Set(
        [...activity, ...agentEdits, ...gitChanges]
          .map((entry) => entry.target)
          .filter((target) => target !== ""),
      ),
    ];
    return filesTab($.ui.resolve(e), {
      activity,
      agentEdits,
      gitChanges,
      agents,
      gone: await goneTargets($, targets),
      branches,
      home: home ?? "",
      width: e.props.bodyColumns,
      folded,
      clear: () => void clearFiles($),
      toggleFolder: (key, isFolded) =>
        void update($, filesFoldedAtom, (current) => ({ ...current, [key]: isFolded })),
    });
  });
}

async function goneTargets($: EngineInterface, targets: string[]): Promise<Set<string>> {
  const key = targets.join("\n");
  if (key === goneCheck.key) return goneCheck.gone;
  const present = await Promise.all(targets.map((target) => $.fs.exists(target)));
  const gone = new Set(targets.filter((_, i) => !present[i]));
  goneCheck = { key, gone };
  return gone;
}

async function clearFiles($: EngineInterface): Promise<void> {
  const [activity, agentEdits] = await Promise.all([
    read($, activityAtom),
    read($, agentEditsAtom),
  ]);
  await update($, clearedAtom, () => [...activity, ...agentEdits].map((entry) => entry.id));
  await update($, gitChangesAtom, () => []);
}
