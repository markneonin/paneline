import { atom, read, update } from "claude-code";
import type { EngineInterface, On } from "claude-code";

import type {
  Activity,
  AgentEdit,
  AgentTree,
  FilesDiff,
  GitChange,
  RemoteRepo,
  Worktree,
  WorktreeOpen,
} from "../types";
import { withoutCleared } from "./clear-kit";
import { hunksOf, unifiedDiff, visibleControls, wholeHunks } from "./diff-panel";
import { filesTab } from "./files-draw";
import { fileTargetsOf, isStale } from "./files-model";
import { gitIn } from "./git-run";
import { refreshFileNumbers } from "./git-track";
import { focusFilter } from "./pane-kit";
import { enterDetail, keepPane, leaveDetail, PANE } from "./pane-tab";
import { isShownTab, justEntered } from "./shown-tab";
import { loadWorktrees, removeWorktree } from "./worktrees";

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
const worktreesAtom = atom(
  { plugin: "paneline", key: "filesWorktrees" } as const,
  [] as Worktree[],
);
const worktreeOpenAtom = atom(
  { plugin: "paneline", key: "filesWorktreeOpen" } as const,
  null as WorktreeOpen | null,
);
const clearedAtom = atom({ plugin: "paneline", key: "filesCleared" } as const, [] as string[]);
const tabAtom = atom({ plugin: "paneline", key: "tab" } as const, "activity");
const filesFilterAtom = atom({ plugin: "paneline", key: "filesFilter" } as const, "");
const agentsAtom = atom({ plugin: "paneline", key: "agents" } as const, {} as AgentTree);
const remoteAtom = atom(
  { plugin: "paneline", key: "remote" } as const,
  {} as Record<string, RemoteRepo>,
);

let goneCheck: { key: string | null; gone: Set<string> } = { key: null, gone: new Set() };

export function registerFilesTab(on: On): void {
  on("ui.close", { id: PANE }, async ($, e, next) => {
    if (e.origin.kind !== "person" || (await read($, tabAtom)) !== FILES_TAB.id) return next(e);
    if ((await read($, filesDiffAtom)) !== null) {
      await closeDiff($);
      return keepPane($);
    }
    if ((await read($, filesFilterAtom)) === "") return next(e);
    await update($, filesFilterAtom, () => "");
    return keepPane($);
  });

  on("ui.render", { component: "Pane", requestId: PANE }, ($, e, next) => {
    if (isShownTab(FILES_TAB.id) && justEntered(FILES_TAB.id))
      $.clock.after(0, () => void Promise.all([recountFiles($), refreshWorktrees($)]));
    return next(e);
  });

  on("classic.FileChanged", async ($, e, next) => {
    if (await isListed($, e.file_path)) {
      goneCheck = { key: null, gone: new Set() };
      await recountFiles($);
      $.ui.invalidate("ui.render");
    }
    return next(e);
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e, next) => {
    if (!isShownTab(FILES_TAB.id)) return next(e);
    if (justEntered(FILES_TAB.id)) goneCheck = { key: null, gone: new Set() };
    const [
      allActivity,
      allAgentEdits,
      gitChanges,
      branches,
      folded,
      agents,
      home,
      cleared,
      diff,
      worktrees,
      openWorktree,
      filter,
      remote,
    ] = await Promise.all([
      read($, activityAtom),
      read($, agentEditsAtom),
      read($, gitChangesAtom),
      read($, gitBranchesAtom),
      read($, filesFoldedAtom),
      read($, agentsAtom),
      $.env.get("HOME"),
      read($, clearedAtom),
      read($, filesDiffAtom),
      read($, worktreesAtom),
      read($, worktreeOpenAtom),
      read($, filesFilterAtom),
      read($, remoteAtom),
    ]);
    const activity = withoutCleared(allActivity, cleared);
    const agentEdits = withoutCleared(allAgentEdits, cleared);
    const targets = [
      ...new Set(
        [
          ...[...activity, ...agentEdits].flatMap(fileTargetsOf),
          ...gitChanges.map((change) => change.target),
        ].filter((target) => target !== ""),
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
      filter,
      setFilter: (text) => void update($, filesFilterAtom, () => text),
      focusFilter: () => void focusFilter($),
      width: e.props.bodyColumns,
      folded,
      remote,
      diff,
      openDiff: (target) => void openDiff($, target, gitChanges).then(() => keepPane($)),
      closeDiff: () => void closeDiff($),
      clear: () => void clearFiles($),
      worktrees,
      openWorktree,
      toggleWorktree: (path) =>
        void update($, worktreeOpenAtom, (open) =>
          open?.path === path ? null : { path, isConfirming: false },
        ),
      askRemoveWorktree: (path) =>
        void update($, worktreeOpenAtom, () => ({ path, isConfirming: true })),
      confirmRemoveWorktree: (path) => void removeStaleWorktree($, path),
      toggleFolder: (key, isFolded) =>
        void update($, filesFoldedAtom, (current) => ({ ...current, [key]: isFolded })),
    });
  });
}

type ListedFiles = { activity: Activity[]; agentEdits: AgentEdit[]; changes: GitChange[] };

async function listedFiles($: EngineInterface): Promise<ListedFiles> {
  const [activity, agentEdits, changes, cleared] = await Promise.all([
    read($, activityAtom),
    read($, agentEditsAtom),
    read($, gitChangesAtom),
    read($, clearedAtom),
  ]);
  return {
    activity: withoutCleared(activity, cleared),
    agentEdits: withoutCleared(agentEdits, cleared),
    changes,
  };
}

async function isListed($: EngineInterface, path: string): Promise<boolean> {
  const { activity, agentEdits, changes } = await listedFiles($);
  return [
    ...[...activity, ...agentEdits].flatMap(fileTargetsOf),
    ...changes.map((change) => change.target),
  ].includes(path);
}

async function refreshWorktrees($: EngineInterface): Promise<void> {
  const found = await loadWorktrees((dir, args) => gitIn($, dir, args), await $.session.cwd());
  await update($, worktreesAtom, () => found);
}

async function removeStaleWorktree($: EngineInterface, path: string): Promise<void> {
  const worktrees = await read($, worktreesAtom);
  const main = worktrees.find((worktree) => worktree.isMain);
  const target = worktrees.find((worktree) => worktree.path === path && isStale(worktree));
  if (main === undefined || target === undefined) return;
  await removeWorktree((dir, args) => gitIn($, dir, args), main.path, target.path);
  await update($, worktreeOpenAtom, () => null);
  await refreshWorktrees($);
}

async function recountFiles($: EngineInterface): Promise<void> {
  const { activity, agentEdits, changes } = await listedFiles($);
  const edited = [...activity, ...agentEdits]
    .filter((entry) => entry.tool !== "Read")
    .flatMap(fileTargetsOf);
  await refreshFileNumbers(
    $,
    [...edited, ...changes.map((change) => change.target)].filter((target) => target !== ""),
  );
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

export async function openDiff(
  $: EngineInterface,
  target: string,
  changes: GitChange[],
): Promise<void> {
  const folder = target.slice(0, target.lastIndexOf("/")) || "/";
  const dir = (await gitIn($, folder, ["rev-parse", "--show-toplevel"])) ?? folder;
  const base = changes.find((change) => change.target === target)?.base ?? "HEAD";
  const isTracked = Boolean(await gitIn($, dir, ["ls-files", "--", target]));
  const text = isTracked
    ? ((await gitIn($, dir, ["diff", base, "--", target])) ?? "")
    : await newFileDiff($, target);
  await enterDetail($, FILES_TAB.id);
  await update($, filesDiffAtom, () => ({ target, text: visibleControls(wholeHunks(text)) }));
}

async function closeDiff($: EngineInterface): Promise<void> {
  await update($, filesDiffAtom, () => null);
  await leaveDetail($, FILES_TAB.id);
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
