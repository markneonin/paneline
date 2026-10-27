import { atom, read, update } from "claude-code";
import type { EngineInterface, On } from "claude-code";

import type { Activity, AgentEdit, AgentTree, FilesDiff, GitChange } from "../types";
import { withoutCleared } from "./clear-kit";
import { hunksOf, unifiedDiff } from "./diff-panel";
import { filesTab } from "./files-draw";
import { gitIn } from "./git-run";
import { PANE } from "./pane-tab";
import { isShownTab, justEntered } from "./shown-tab";

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
const filesDiffAtom = atom(
  { plugin: "paneline", key: "filesDiff" } as const,
  null as FilesDiff | null,
);
const clearedAtom = atom({ plugin: "paneline", key: "filesCleared" } as const, [] as string[]);
const agentsAtom = atom({ plugin: "paneline", key: "agents" } as const, {} as AgentTree);

let goneCheck: { key: string | null; gone: Set<string> } = { key: null, gone: new Set() };

export function registerFilesTab(on: On): void {
  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e, next) => {
    if (!isShownTab(FILES_TAB.id)) return next(e);
    if (justEntered(FILES_TAB.id)) goneCheck = { key: null, gone: new Set() };
    const [allActivity, allAgentEdits, gitChanges, branches, folded, agents, home, cleared, diff] =
      await Promise.all([
        read($, activityAtom),
        read($, agentEditsAtom),
        read($, gitChangesAtom),
        read($, gitBranchesAtom),
        read($, filesFoldedAtom),
        read($, agentsAtom),
        $.env.get("HOME"),
        read($, clearedAtom),
        read($, filesDiffAtom),
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
      diff,
      openDiff: (target) => void openDiff($, target, gitChanges),
      closeDiff: () => void update($, filesDiffAtom, () => null),
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

const DIFF_CHAR_LIMIT = 100_000;

async function openDiff($: EngineInterface, target: string, changes: GitChange[]): Promise<void> {
  const folder = target.slice(0, target.lastIndexOf("/")) || "/";
  const dir = (await gitIn($, folder, ["rev-parse", "--show-toplevel"])) ?? folder;
  const base = changes.find((change) => change.target === target)?.base ?? "HEAD";
  const isTracked = Boolean(await gitIn($, dir, ["ls-files", "--", target]));
  const text = isTracked
    ? ((await gitIn($, dir, ["diff", base, "--", target])) ?? "")
    : await newFileDiff($, target);
  await update($, filesDiffAtom, () => ({ target, text: wholeHunks(text) }));
}

async function newFileDiff($: EngineInterface, target: string): Promise<string> {
  try {
    const content = await $.fs.read(target);
    return unifiedDiff(
      hunksOf({ filePath: target, isCreate: true, isDelete: false, hunks: [], content }),
    );
  } catch (error) {
    $.ui.log(`read failed: ${String(error)}`, { to: "debug" });
    return "";
  }
}

function wholeHunks(text: string): string {
  const start = text.indexOf("@@");
  if (start === -1) return "";
  const kept: string[] = [];
  let chars = 0;
  for (const hunk of text.slice(start).split(/\n(?=@@ )/)) {
    chars += hunk.length + 1;
    if (chars > DIFF_CHAR_LIMIT && kept.length > 0) break;
    kept.push(hunk);
  }
  return kept.join("\n");
}
