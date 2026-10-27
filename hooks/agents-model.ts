import type { AgentNode, AgentStatus, AgentTree, RunningCall } from "../types";
import { singleLine } from "./format";

export type { AgentNode, AgentStatus, AgentTree };
export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
};
export type TreeRow = { node: AgentNode; depth: number; isLast: boolean };
type VisibleRows = { rows: TreeRow[]; hiddenDone: number };

export const KEPT_AGENTS = 60;

const FINISHED: AgentStatus[] = ["done", "failed", "killed", "stopped"];

type SpawnInfo = Pick<
  AgentNode,
  "id" | "parentId" | "type" | "description" | "name" | "background" | "model"
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
  killed: "killed",
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
      tokensIn: node.tokensIn + u.input_tokens + u.cache_creation_input_tokens,
      tokensOut: node.tokensOut + u.output_tokens,
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

export function visibleRows(tree: AgentTree, doneLimit: number): VisibleRows {
  const nodes = Object.values(tree);
  const parentOf = (node: AgentNode) =>
    node.parentId !== undefined && tree[node.parentId] ? node.parentId : undefined;
  const childrenOf = (parentId: string | undefined) =>
    nodes.filter((node) => parentOf(node) === parentId);
  const isActive = (node: AgentNode): boolean =>
    !FINISHED.includes(node.status) || childrenOf(node.id).some(isActive);
  const endOf = (node: AgentNode) => node.endedAt ?? node.startedAt;
  const ordered = (siblings: AgentNode[]) => [
    ...siblings.filter(isActive).sort((a, b) => a.startedAt - b.startedAt),
    ...siblings.filter((node) => !isActive(node)).sort((a, b) => endOf(b) - endOf(a)),
  ];
  const walk = (
    parentId: string | undefined,
    depth: number,
  ): { node: AgentNode; depth: number }[] =>
    ordered(childrenOf(parentId)).flatMap((node) => [{ node, depth }, ...walk(node.id, depth + 1)]);
  const hidden = new Set<string>();
  let doneShown = 0;
  const shown = walk(undefined, 0).filter(({ node }) => {
    if (isActive(node)) return true;
    const parent = parentOf(node);
    if ((parent !== undefined && hidden.has(parent)) || doneShown >= doneLimit) {
      hidden.add(node.id);
      return false;
    }
    doneShown += 1;
    return true;
  });
  const lastChildOf = new Map(shown.map(({ node }) => [parentOf(node), node.id]));
  return {
    rows: shown.map(({ node, depth }) => ({
      node,
      depth,
      isLast: lastChildOf.get(parentOf(node)) === node.id,
    })),
    hiddenDone: hidden.size,
  };
}

function newNode(
  fields: Omit<AgentNode, "ctxTokens" | "tokensIn" | "tokensOut" | "running">,
): AgentNode {
  return {
    ...fields,
    description: singleLine(fields.description),
    ...(fields.name !== undefined && { name: singleLine(fields.name) }),
    ctxTokens: 0,
    tokensIn: 0,
    tokensOut: 0,
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
