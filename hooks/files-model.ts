import type { Activity, AgentEdit, AgentTree, GitChange, Worktree } from "../types";
import { memo } from "./memo";
import { matchesFilter } from "./pane-kit";
import { groupLabel, tildePath } from "./paths";
import { isFailedEdit, isPathTool } from "./tools";

export type FilesSource = {
  activity: Activity[];
  agentEdits: AgentEdit[];
  gitChanges: GitChange[];
  agents: AgentTree;
  gone: Set<string>;
  branches: Record<string, string>;
  home: string;
  filter: string;
};

type Author = { kind: "main" } | { kind: "agent"; id: string } | { kind: "git"; label: string };

type Touch = {
  id: string;
  target: string;
  added: number;
  removed: number;
  isRead: boolean;
  author: Author;
};

export type AgentTotal = { label: string; files: Set<string>; added: number; removed: number };

type TouchedFile = { added: number; removed: number; isEdited: boolean };

type FolderNode = { folders: Map<string, FolderNode>; files: Map<string, TouchedFile> };

export type Change = { added: number; removed: number };

export type FileTreeRow = {
  depth: number;
  isLast: boolean;
  name: string;
  key: string;
  file?: TouchedFile;
  branch?: string;
  total?: Change;
};

type FilesModel = { fileCount: number; rows: FileTreeRow[]; totals: AgentTotal[] };

type PlacedFile = { folders: string[]; name: string; file: TouchedFile };

const MAIN_LABEL = "this session";

const FALLBACK_LABEL = "agent";

const NO_CHANGE: Change = { added: 0, removed: 0 };

const modelCache = memo<FilesModel>(1);

export function filesModel(source: FilesSource): FilesModel {
  return modelCache(modelKey(source), () => buildModel(source));
}

function modelKey(view: FilesSource): string {
  const agentIds = new Set(view.agentEdits.map((edit) => edit.agentId));
  return JSON.stringify([
    view.activity,
    view.agentEdits,
    view.gitChanges,
    [...view.gone],
    view.branches,
    view.home,
    view.filter,
    [...agentIds].map((id) => labelOf(view.agents, { kind: "agent", id })),
  ]);
}

function buildModel(view: FilesSource): FilesModel {
  const touches = withGitNumbers(touchesOf(view), view.gitChanges).filter(
    (one) =>
      !view.gone.has(one.target) && matchesFilter(view.filter, tildePath(one.target, view.home)),
  );
  const files = touchedFiles(touches);
  return {
    fileCount: files.size,
    rows: fileTreeRows(files, view.home, view.branches),
    totals: authorTotals(touches, (author) => labelOf(view.agents, author)),
  };
}

export function isStale(worktree: Worktree): boolean {
  return (
    worktree.isMerged &&
    worktree.isClean &&
    !worktree.isMain &&
    !worktree.isSession &&
    !worktree.isDetached &&
    !worktree.isLocked
  );
}

export function unfoldedRows(
  rows: FileTreeRow[],
  isFolded: (row: FileTreeRow) => boolean,
): FileTreeRow[] {
  const shown: FileTreeRow[] = [];
  let foldedDepth: number | undefined;
  for (const row of rows) {
    if (foldedDepth !== undefined && row.depth > foldedDepth) continue;
    foldedDepth = undefined;
    shown.push(row);
    if (row.total !== undefined && isFolded(row)) foldedDepth = row.depth;
  }
  return shown;
}

export function fileTargetsOf(entry: Activity): string[] {
  if (entry.files !== undefined) return entry.files.map((file) => file.target);
  return entry.tool === "Bash" ? [] : [entry.target];
}

function touchesOf(view: FilesSource): Touch[] {
  const fromMain = view.activity.flatMap((entry) => touchesOfEntry(entry, { kind: "main" }));
  const fromAgents = view.agentEdits.flatMap((edit) =>
    touchesOfEntry(edit, { kind: "agent", id: edit.agentId }),
  );
  const landed = new Set(
    view.gitChanges.flatMap((change) =>
      (change.landedBy ?? []).map((id) => `${id}\0${change.target}`),
    ),
  );
  return [...fromMain, ...fromAgents].filter(
    (touch) => !landed.has(`${touch.id}\0${touch.target}`),
  );
}

function touchesOfEntry(entry: Activity, author: Author): Touch[] {
  if (entry.files !== undefined)
    return entry.files.map((file) => ({ ...file, id: entry.id, isRead: false, author }));
  return isFileTouch(entry) ? [touchOf(entry, author)] : [];
}

function isFileTouch(entry: Activity): boolean {
  return isPathTool(entry.tool) && entry.target !== "" && !isFailedEdit(entry);
}

function touchOf(entry: Activity, author: Author): Touch {
  return {
    id: entry.id,
    target: entry.target,
    added: entry.added,
    removed: entry.removed,
    isRead: entry.tool === "Read",
    author,
  };
}

function labelOf(agents: AgentTree, author: Author): string {
  if (author.kind === "main") return MAIN_LABEL;
  if (author.kind === "git") return author.label;
  const node = agents[author.id];
  return node?.description || node?.type || FALLBACK_LABEL;
}

function authorKey(author: Author): string {
  if (author.kind === "main") return author.kind;
  return author.kind === "git" ? `git:${author.label}` : `agent:${author.id}`;
}

function withGitNumbers(edits: Touch[], changes: GitChange[]): Touch[] {
  const byTarget = new Map(changes.map((change) => [change.target, change]));
  const owners = new Map<string, Touch>();
  for (const entry of edits.filter((one) => !one.isRead && byTarget.has(one.target))) {
    const owner = owners.get(entry.target);
    if (owner === undefined || entry.added + entry.removed > owner.added + owner.removed)
      owners.set(entry.target, entry);
  }
  const numbered = edits.flatMap((entry): Touch[] => {
    const change = byTarget.get(entry.target);
    if (change === undefined || entry.isRead) return [entry];
    if (owners.get(entry.target) !== entry) return [];
    return [{ ...entry, added: change.added, removed: change.removed }];
  });
  const unowned = changes.filter((change) => !owners.has(change.target));
  return [
    ...numbered,
    ...unowned.map((change): Touch => ({
      id: change.target,
      target: change.target,
      added: change.added,
      removed: change.removed,
      isRead: false,
      author: { kind: "git", label: change.label },
    })),
  ];
}

function touchedFiles(touches: Touch[]): Map<string, TouchedFile> {
  const files = new Map<string, TouchedFile>();
  for (const entry of touches) {
    const known = files.get(entry.target) ?? { added: 0, removed: 0, isEdited: false };
    files.set(entry.target, {
      added: known.added + entry.added,
      removed: known.removed + entry.removed,
      isEdited: known.isEdited || !entry.isRead,
    });
  }
  return files;
}

function authorTotals(touches: Touch[], label: (author: Author) => string): AgentTotal[] {
  const totals = new Map<string, AgentTotal>();
  for (const entry of touches.filter((one) => !one.isRead)) {
    const key = authorKey(entry.author);
    const known = totals.get(key) ?? {
      label: label(entry.author),
      files: new Set<string>(),
      added: 0,
      removed: 0,
    };
    known.files.add(entry.target);
    known.added += entry.added;
    known.removed += entry.removed;
    totals.set(key, known);
  }
  return [...totals.values()].sort(
    (a, b) => b.added + b.removed - (a.added + a.removed) || a.label.localeCompare(b.label),
  );
}

function placed(path: string, file: TouchedFile): PlacedFile {
  const folders = path.split("/").filter((part) => part !== "");
  return { folders, name: folders.pop() ?? path, file };
}

function fileTreeRows(
  files: Map<string, TouchedFile>,
  home: string,
  branches: Record<string, string>,
): FileTreeRow[] {
  const roots = Object.keys(branches);
  const groups = new Map<string, PlacedFile[]>();
  for (const [path, file] of files) {
    const one = placed(path, file);
    const key = owningRoot(path, roots) ?? `/${one.folders[0] ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), one]);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([key, group]) =>
      key in branches ? repoRows(key, group, home, branches[key]) : rootRows(group, home),
    );
}

function owningRoot(path: string, roots: string[]): string | undefined {
  return roots.filter((root) => path.startsWith(`${root}/`)).sort((a, b) => b.length - a.length)[0];
}

function repoRows(
  root: string,
  group: PlacedFile[],
  home: string,
  branch: string | undefined,
): FileTreeRow[] {
  const folders = root.split("/").filter((part) => part !== "");
  return groupRows(folders, root, group, home, branch);
}

function rootRows(group: PlacedFile[], home: string): FileTreeRow[] {
  const shared = commonFolders(group.map((one) => one.folders));
  return groupRows(shared, `/${shared.join("/")}`, group, home, undefined);
}

function groupRows(
  rootFolders: string[],
  key: string,
  group: PlacedFile[],
  home: string,
  branch: string | undefined,
): FileTreeRow[] {
  const tree = buildTree(
    group.map((one) => ({ ...one, folders: one.folders.slice(rootFolders.length) })),
  );
  const header: FileTreeRow = {
    depth: 0,
    isLast: true,
    name: groupLabel(`/${rootFolders.join("/")}`, home),
    key,
    branch,
    total: NO_CHANGE,
  };
  const rows = [header];
  header.total = addChildren(rows, tree, 1, key);
  return rows;
}

function commonFolders(lists: string[][]): string[] {
  const [first = [], ...rest] = lists;
  const length = first.findIndex((part, i) => rest.some((list) => list[i] !== part));
  return first.slice(0, length === -1 ? first.length : length);
}

function buildTree(files: PlacedFile[]): FolderNode {
  const root: FolderNode = { folders: new Map(), files: new Map() };
  for (const { folders, name, file } of files) {
    const folder = folders.reduce((node, part) => {
      const child = node.folders.get(part) ?? { folders: new Map(), files: new Map() };
      node.folders.set(part, child);
      return child;
    }, root);
    folder.files.set(name, file);
  }
  return root;
}

function addChildren(
  rows: FileTreeRow[],
  node: FolderNode,
  depth: number,
  parentKey: string,
): Change {
  const folders = [...node.folders].sort(([a], [b]) => a.localeCompare(b));
  const files = [...node.files].sort(([a], [b]) => a.localeCompare(b));
  const count = folders.length + files.length;
  const sum = { added: 0, removed: 0 };
  folders.forEach(([name, child], i) => {
    const chain = compacted(name, child);
    const row: FileTreeRow = {
      depth,
      isLast: i === count - 1,
      name: `${chain.name}/`,
      key: `${parentKey}/${chain.name}`,
      total: NO_CHANGE,
    };
    rows.push(row);
    row.total = addChildren(rows, chain.node, depth + 1, row.key);
    sum.added += row.total.added;
    sum.removed += row.total.removed;
  });
  files.forEach(([name, file], i) => {
    rows.push({
      depth,
      isLast: folders.length + i === count - 1,
      name,
      key: `${parentKey}/${name}`,
      file,
    });
    if (!file.isEdited) return;
    sum.added += file.added;
    sum.removed += file.removed;
  });
  return sum;
}

function compacted(name: string, node: FolderNode): { name: string; node: FolderNode } {
  const [only] = node.folders;
  if (node.folders.size !== 1 || node.files.size > 0 || only === undefined) return { name, node };
  const inner = compacted(only[0], only[1]);
  return { name: `${name}/${inner.name}`, node: inner.node };
}
