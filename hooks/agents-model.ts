import type { AgentNode, AgentStatus, AgentTree, RunningCall } from "../types";
import { singleLine } from "./format";
import type { AgentShare } from "./spend-model";

export type { AgentNode, AgentStatus, AgentTree };
export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
};
export type TreeRow = { node: AgentNode; depth: number; isLast: boolean };
export type OrderedRow = {
  node: AgentNode;
  depth: number;
  parentId: string | undefined;
  active: boolean;
};
export type Receipt = {
  memberIds: string[];
  count: number;
  wallMs: number;
  tokens: number;
  cents: number | undefined;
};
type VisibleRows = { rows: TreeRow[]; hiddenDone: number };

export const KEPT_AGENTS = 60;
const HEAVIEST_FIRST_ABOVE = 3;

const FINISHED: AgentStatus[] = ["done", "failed", "killed", "stopped"];

type SpawnInfo = Pick<
  AgentNode,
  "id" | "parentId" | "type" | "description" | "name" | "background" | "model" | "batch"
> & { at: number };
type StepInfo = { model: string; effort?: string; usage: Usage | null };
type CompletionReason = "answer" | "aborted" | "refusal" | "error";
type ListedStatus = "pending" | "running" | "waiting" | "idle" | "completed" | "failed" | "killed";
type ListedAgent = Pick<AgentNode, "id" | "parentId" | "type" | "description"> & {
  status: ListedStatus;
};

const statusByReason: Record<CompletionReason, AgentStatus> = {
  answer: "done",
  error: "failed",
  refusal: "failed",
  aborted: "stopped",
};

const statusOverrides: Partial<Record<ListedStatus, AgentStatus>> = {
  waiting: "waiting",
  idle: "idle",
  killed: "stopped",
  completed: "done",
  failed: "failed",
};

export function spawned(tree: AgentTree, { at, ...fields }: SpawnInfo): AgentTree {
  const node = newNode({ ...fields, status: "running", startedAt: at });
  return { ...tree, [node.id]: node };
}

export function stepped(tree: AgentTree, id: string, s: StepInfo): AgentTree {
  return update(tree, id, (node) => {
    const resumed = resumedNode(node);
    const withModel = { ...resumed, model: s.model, effort: s.effort ?? node.effort };
    if (!s.usage) return withModel;
    const u = s.usage;
    return {
      ...withModel,
      ctxTokens:
        u.input_tokens +
        u.cache_read_input_tokens +
        u.cache_creation_input_tokens +
        u.output_tokens,
    };
  });
}

export function toolStarted(tree: AgentTree, id: string, t: RunningCall): AgentTree {
  return update(tree, id, (node) => ({ ...resumedNode(node), running: [...node.running, t] }));
}

export function located(
  tree: AgentTree,
  id: string,
  place: { branch: string; worktree?: string },
): AgentTree {
  return update(tree, id, (node) => {
    const { worktree: _worktree, ...rest } = node;
    return {
      ...rest,
      branch: place.branch,
      ...(place.worktree !== undefined && { worktree: place.worktree }),
    };
  });
}

export function toolEnded(tree: AgentTree, id: string, callId: string): AgentTree {
  return update(tree, id, (node) => ({
    ...node,
    running: node.running.filter((t) => t.callId !== callId),
  }));
}

export function completed(
  tree: AgentTree,
  id: string,
  reason: CompletionReason,
  at: number,
): AgentTree {
  return update(tree, id, (node) => ({
    ...node,
    status: statusByReason[reason],
    endedAt: at,
    running: [],
  }));
}

export function reconciled(tree: AgentTree, list: ListedAgent[], at: number): AgentTree {
  return list.reduce((acc, listed) => {
    const known = acc[listed.id];
    const override = statusOverrides[listed.status];
    if (known) {
      if (!override || known.status === override) return acc;
      return { ...acc, [listed.id]: { ...known, status: override } };
    }
    const node = newNode({
      id: listed.id,
      parentId: listed.parentId,
      type: listed.type,
      description: listed.description,
      background: false,
      model: "",
      status: override ?? "running",
      startedAt: at,
    });
    return { ...acc, [listed.id]: node };
  }, tree);
}

export function tallyOf(tree: AgentTree): { done: number; running: number } {
  const nodes = Object.values(tree);
  const done = nodes.filter((node) => FINISHED.includes(node.status)).length;
  return { done, running: nodes.length - done };
}

export function hasFinished(tree: AgentTree): boolean {
  return Object.values(tree).some((node) => FINISHED.includes(node.status));
}

function finishKey(node: AgentNode): string {
  return `${node.id}@${node.endedAt ?? ""}`;
}

export function finishedKeys(tree: AgentTree): string[] {
  return Object.values(tree)
    .filter((node) => FINISHED.includes(node.status))
    .map(finishKey);
}

export function withoutCleared(tree: AgentTree, keys: string[]): AgentTree {
  return Object.fromEntries(
    Object.entries(tree).filter(
      ([, node]) => !(FINISHED.includes(node.status) && keys.includes(finishKey(node))),
    ),
  );
}

export function pruned(tree: AgentTree, max = KEPT_AGENTS): AgentTree {
  const nodes = Object.values(tree);
  const excess = nodes.length - max;
  if (excess <= 0) return tree;
  const dropped = nodes
    .filter((node) => node.endedAt !== undefined)
    .sort((a, b) => a.endedAt! - b.endedAt!)
    .slice(0, excess)
    .map((node) => node.id);
  return Object.fromEntries(Object.entries(tree).filter(([id]) => !dropped.includes(id)));
}
export function receiptOf(tree: AgentTree, split: Record<string, AgentShare>): Receipt | null {
  const batches = new Map<string, AgentNode[]>();
  for (const node of Object.values(tree)) {
    if (node.batch !== undefined)
      batches.set(node.batch, [...(batches.get(node.batch) ?? []), node]);
  }
  const members = [...batches.values()]
    .filter((nodes) => nodes.length >= 2)
    .sort((a, b) => lastStart(b) - lastStart(a))[0];
  if (!members?.every((node) => FINISHED.includes(node.status))) return null;
  const shares = members.map((node) => split[node.id]);
  const cents = shares.map((share) => share?.cents);
  return {
    memberIds: members.map((node) => node.id),
    count: members.length,
    wallMs:
      Math.max(...members.map((node) => node.endedAt ?? node.startedAt)) -
      Math.min(...members.map((node) => node.startedAt)),
    tokens: shares.reduce((sum, share) => sum + (share?.tokens ?? 0), 0),
    cents: cents.includes(undefined)
      ? undefined
      : cents.reduce<number>((sum, value) => sum + (value ?? 0), 0),
  };
}

function lastStart(nodes: AgentNode[]): number {
  return Math.max(...nodes.map((node) => node.startedAt));
}

export function orderedRows(tree: AgentTree, split: Record<string, AgentShare> = {}): OrderedRow[] {
  const nodes = Object.values(tree);
  const tokensOf = (node: AgentNode): number => split[node.id]?.tokens ?? 0;
  const heaviestFirst = nodes.length > HEAVIEST_FIRST_ABOVE;
  const siblingsOf = groupByParent(tree, nodes);
  const active = activeIds(tree, nodes);
  const rows: OrderedRow[] = [];
  const visit = (parentId: string | undefined, depth: number): void => {
    for (const node of orderedSiblings(
      siblingsOf.get(parentId) ?? [],
      active,
      heaviestFirst ? tokensOf : undefined,
    )) {
      rows.push({ node, depth, parentId, active: active.has(node.id) });
      visit(node.id, depth + 1);
    }
  };
  visit(undefined, 0);
  return rows;
}

export function cutDone(ordered: OrderedRow[], doneLimit: number): VisibleRows {
  const kept: OrderedRow[] = [];
  let doneShown = 0;
  let hiddenDone = 0;
  for (const row of ordered) {
    if (row.active) {
      kept.push(row);
      continue;
    }
    if (doneShown >= doneLimit) {
      hiddenDone += 1;
      continue;
    }
    doneShown += 1;
    kept.push(row);
  }
  const lastChildOf = new Map(kept.map((row) => [row.parentId, row.node.id]));
  return {
    rows: kept.map(({ node, depth, parentId }) => ({
      node,
      depth,
      isLast: lastChildOf.get(parentId) === node.id,
    })),
    hiddenDone,
  };
}

function groupByParent(tree: AgentTree, nodes: AgentNode[]): Map<string | undefined, AgentNode[]> {
  const groups = new Map<string | undefined, AgentNode[]>();
  for (const node of nodes) {
    const parent = parentKey(tree, node);
    const siblings = groups.get(parent);
    if (siblings) {
      siblings.push(node);
    } else {
      groups.set(parent, [node]);
    }
  }
  return groups;
}

function activeIds(tree: AgentTree, nodes: AgentNode[]): Set<string> {
  const active = new Set<string>();
  for (const node of nodes) {
    if (!FINISHED.includes(node.status)) markWithAncestors(tree, node, active);
  }
  return active;
}

function markWithAncestors(tree: AgentTree, node: AgentNode, active: Set<string>): void {
  let current: AgentNode | undefined = node;
  while (current !== undefined && !active.has(current.id)) {
    active.add(current.id);
    const parent = parentKey(tree, current);
    current = parent === undefined ? undefined : tree[parent];
  }
}

function orderedSiblings(
  siblings: AgentNode[],
  active: Set<string>,
  tokensOf: ((node: AgentNode) => number) | undefined,
): AgentNode[] {
  const isActive = (node: AgentNode) => active.has(node.id);
  const inOrder = [
    ...siblings.filter(isActive).sort((a, b) => a.startedAt - b.startedAt),
    ...siblings.filter((node) => !isActive(node)).sort((a, b) => endOf(b) - endOf(a)),
  ];
  return tokensOf ? inOrder.sort((a, b) => tokensOf(b) - tokensOf(a)) : inOrder;
}

function parentKey(tree: AgentTree, node: AgentNode): string | undefined {
  const { parentId } = node;
  return parentId !== undefined && tree[parentId] ? parentId : undefined;
}

function endOf(node: AgentNode): number {
  return node.endedAt ?? node.startedAt;
}

function newNode(fields: Omit<AgentNode, "ctxTokens" | "running">): AgentNode {
  return {
    ...fields,
    description: singleLine(fields.description),
    ...(fields.name !== undefined && { name: singleLine(fields.name) }),
    ctxTokens: 0,
    running: [],
  };
}

function update(tree: AgentTree, id: string, change: (node: AgentNode) => AgentNode): AgentTree {
  const node = tree[id];
  if (!node) return tree;
  return { ...tree, [id]: change(node) };
}

function resumedNode(node: AgentNode): AgentNode {
  const { endedAt: _endedAt, ...rest } = node;
  return { ...rest, status: "running" };
}
