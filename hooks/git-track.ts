import { atom, read, update } from "claude-code";
import type { EngineInterface, On } from "claude-code";

import type { Activity, AgentEdit, GitChange } from "../types";
import { gitIn as git } from "./git-run";
import { countedChangesSince } from "./review-git";
import { changedPaths, targetOf } from "./tools";

const MOVING_COMMAND =
  /\bgit\b[^|;&\n]*\b(merge|rebase|pull|cherry-pick|reset|checkout|switch|commit)\b/;
const EDIT_TOOLS = /^(Edit|MultiEdit|Write|NotebookEdit)$/;
const MERGE_SUBJECT = /^merge (\S+?):/;
const GENERIC_LABEL = "merged";
const WORKING_TREE_LABEL = "working tree";
const GIT_DIR_FLAG = /\bgit\s+-C\s+(?:"([^"]+)"|'([^']+)'|(\S+))/g;
const LEADING_CD = /^\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s&;]+))\s*&&/;

const changesAtom = atom({ plugin: "paneline", key: "gitChanges" } as const, [] as GitChange[]);

const activityAtom = atom({ plugin: "paneline", key: "activity" } as const, [] as Activity[]);
const agentEditsAtom = atom({ plugin: "paneline", key: "agentEdits" } as const, [] as AgentEdit[]);

const branchesAtom = atom(
  { plugin: "paneline", key: "gitBranches" } as const,
  {} as Record<string, string>,
);

const rootOfDir = new Map<string, string>();

type Checkout = { root: string; head: string; branch: string };

export function trackGit(on: On): void {
  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    if (!MOVING_COMMAND.test(e.command)) return next(e);
    const before = await checkoutsAround($, e.command);
    const ran = await next(e);
    const after = await Promise.all(
      before.map(async (checkout) => {
        const landed = await checkoutOf($, checkout.root);
        await recordLanded($, checkout, landed, e.tool_use_id);
        return landed;
      }),
    );
    await refreshBranches(
      $,
      before.map((checkout) => checkout.root),
      branchesOf(after),
    );
    return ran;
  });

  on("tool.call", { tool: EDIT_TOOLS }, async ($, e, next) => {
    const ran = await next(e);
    if (ran.isError !== true && ran.deny === undefined) await refreshFileNumbers($, [targetOf(e)]);
    return ran;
  });

  on("classic.SessionStart", { source: "clear" }, async ($, e, next) => {
    await reset($);
    return next(e);
  });
}

async function reset($: EngineInterface): Promise<void> {
  rootOfDir.clear();
  await update($, changesAtom, () => []);
  await update($, branchesAtom, () => ({}));
}

async function checkoutsAround($: EngineInterface, command: string): Promise<Checkout[]> {
  const cwd = await $.session.cwd();
  const [known, edited] = await Promise.all([read($, branchesAtom), editedRoots($)]);
  const knownRoots = [...Object.keys(known), ...edited];
  const found = await askEachRepoOnce($, cwd, [
    ...namedDirs(command).map((dir) => resolved(cwd, dir)),
    ...knownRoots,
  ]);
  const byRoot = new Map(
    found.flatMap(([, checkout]) =>
      checkout === null ? [] : [[checkout.root, checkout] as const],
    ),
  );
  return [...byRoot.values()];
}

export function namedDirs(command: string): string[] {
  const flagged = [...command.matchAll(GIT_DIR_FLAG)].map(
    (match) => match[1] ?? match[2] ?? match[3],
  );
  const [, ...quoted] = LEADING_CD.exec(command) ?? [];
  return [...flagged, ...quoted].filter((dir): dir is string => dir !== undefined);
}

function resolved(cwd: string, dir: string): string {
  return dir.startsWith("/") ? dir : `${cwd}/${dir}`;
}

async function recordLanded(
  $: EngineInterface,
  before: Checkout | null,
  after: Checkout | null,
  callId: string,
): Promise<void> {
  if (before === null || after === null) return;
  if (before.root !== after.root || before.head === after.head) return;
  const { root } = before;
  const [names, subjects, known] = await Promise.all([
    git($, root, ["diff", "--name-only", "--no-renames", before.head, after.head]),
    git($, root, ["log", "-g", "--format=%gs", `${before.head}..${after.head}`]),
    read($, changesAtom),
  ]);
  const inRoot = await changesOfRepo($, known, root);
  const targets = (names ?? "")
    .split("\n")
    .filter((path) => path !== "")
    .map((path) => `${root}/${path}`);
  const counted = await countInTree($, root, inRoot[0]?.base ?? before.head, targets, inRoot);
  const label = mergeLabel(subjects ?? "");
  const landed = counted.map((change) => ({
    ...change,
    label,
    landedBy: [...(inRoot.find((one) => one.target === change.target)?.landedBy ?? []), callId],
  }));
  const landedTargets = new Set(landed.map((change) => change.target));
  await update($, changesAtom, (current) => [
    ...current.filter((change) => !landedTargets.has(change.target)),
    ...landed,
  ]);
}

export async function refreshFileNumbers($: EngineInterface, targets: string[]): Promise<void> {
  const byRoot = await targetsByRoot($, [...new Set(targets)]);
  if (byRoot.size === 0) return;
  const known = await read($, changesAtom);
  const counted = await Promise.all(
    [...byRoot].map(async ([root, own]) => {
      const inRoot = await changesOfRepo($, known, root);
      const base = inRoot[0]?.base ?? (await git($, root, ["rev-parse", "HEAD"]));
      return base === null ? [] : countInTree($, root, base, own, inRoot);
    }),
  );
  const fresh = new Map(counted.flat().map((change) => [change.target, change]));
  const next = [
    ...known.map((change) => fresh.get(change.target) ?? change),
    ...[...fresh.values()].filter((change) => !known.some((one) => one.target === change.target)),
  ];
  if (JSON.stringify(next) !== JSON.stringify(known)) await update($, changesAtom, () => next);
  await refreshBranches($, [...byRoot.keys()]);
}

async function changesOfRepo(
  $: EngineInterface,
  changes: GitChange[],
  root: string,
): Promise<GitChange[]> {
  const own = new Set(
    (
      await targetsByRoot(
        $,
        changes.map((change) => change.target),
      )
    ).get(root),
  );
  return changes.filter((change) => own.has(change.target));
}

async function targetsByRoot(
  $: EngineInterface,
  targets: string[],
): Promise<Map<string, string[]>> {
  const absolute = targets.filter((target) => target.startsWith("/"));
  const roots = await Promise.all(
    absolute.map((target) => rootOf($, target.slice(0, target.lastIndexOf("/")) || "/")),
  );
  const byRoot = new Map<string, string[]>();
  absolute.forEach((target, i) => {
    const root = roots[i];
    if (root !== null && root !== undefined)
      byRoot.set(root, [...(byRoot.get(root) ?? []), target]);
  });
  return byRoot;
}

async function countInTree(
  $: EngineInterface,
  root: string,
  base: string,
  own: string[],
  knownInRoot: GitChange[],
): Promise<GitChange[]> {
  if (own.length === 0) return [];
  const [listed, changed] = await Promise.all([
    git($, root, ["ls-files", "--", ...own]),
    countedChangesSince(
      $,
      root,
      base,
      own.map((target) => target.slice(root.length + 1)),
    ),
  ]);
  if (listed === null || changed === null) return [];
  const tracked = new Set(listed.split("\n").map((path) => `${root}/${path}`));
  const counts = new Map(changed.map((file) => [`${root}/${file.path}`, file]));
  return own
    .filter((target) => tracked.has(target) || counts.has(target))
    .map((target) => {
      const before = knownInRoot.find((change) => change.target === target);
      return {
        target,
        added: counts.get(target)?.added ?? 0,
        removed: counts.get(target)?.removed ?? 0,
        label: before?.label ?? WORKING_TREE_LABEL,
        base,
        ...(before?.landedBy === undefined ? {} : { landedBy: before.landedBy }),
      };
    });
}

function branchesOf(checkouts: (Checkout | null)[]): Record<string, string> {
  return Object.fromEntries(
    checkouts.flatMap((checkout) => (checkout === null ? [] : [[checkout.root, checkout.branch]])),
  );
}

async function refreshBranches(
  $: EngineInterface,
  ranIn: string[],
  names: Record<string, string> = {},
): Promise<void> {
  const [known, edited] = await Promise.all([read($, branchesAtom), editedRoots($)]);
  const roots = new Set([...Object.keys(known), ...edited, ...ranIn]);
  const branches = await Promise.all(
    [...roots].map(async (root) => [root, await branchOf($, root, names[root])] as const),
  );
  const next = Object.fromEntries(
    branches.filter((entry): entry is readonly [string, string] => entry[1] !== null),
  );
  if (sameBranches(await read($, branchesAtom), next)) return;
  await update($, branchesAtom, () => next);
}

function sameBranches(stored: Record<string, string>, next: Record<string, string>): boolean {
  const keys = Object.keys(next);
  return (
    keys.length === Object.keys(stored).length && keys.every((key) => stored[key] === next[key])
  );
}

async function branchOf(
  $: EngineInterface,
  root: string,
  asked: string | undefined,
): Promise<string | null> {
  const name = asked ?? (await git($, root, ["rev-parse", "--abbrev-ref", "HEAD"]));
  return name === "HEAD" ? git($, root, ["rev-parse", "--short", "HEAD"]) : name;
}

async function editedRoots($: EngineInterface): Promise<string[]> {
  const [activity, agentEdits] = await Promise.all([
    read($, activityAtom),
    read($, agentEditsAtom),
  ]);
  const dirs = new Set(
    [...activity, ...agentEdits]
      .flatMap(changedPaths)
      .filter((target) => target.startsWith("/"))
      .map((target) => target.slice(0, target.lastIndexOf("/")) || "/"),
  );
  const roots = await Promise.all([...dirs].map((dir) => rootOf($, dir)));
  return roots.filter((root): root is string => root !== null);
}

export async function rootOf($: EngineInterface, dir: string): Promise<string | null> {
  const known = rootOfDir.get(dir);
  if (known !== undefined) return known;
  const root = await git($, dir, ["rev-parse", "--show-toplevel"]);
  if (root !== null) rootOfDir.set(dir, root);
  return root;
}

export async function checkoutOf($: EngineInterface, dir: string): Promise<Checkout | null> {
  const found = await git($, dir, ["rev-parse", "--show-toplevel", "HEAD", "--abbrev-ref", "HEAD"]);
  const [root, head, branch] = found?.split("\n") ?? [];
  if (!root || !head || !branch) return null;
  rootOfDir.set(dir, root);
  return { root, head, branch };
}

export async function askEachRepoOnce(
  $: EngineInterface,
  sessionDir: string,
  otherDirs: string[],
): Promise<(readonly [string, Checkout | null])[]> {
  const first = await checkoutOf($, sessionDir);
  const remaining = [...new Set(otherDirs)].filter(
    (dir) => dir !== sessionDir && (rootOfDir.get(dir) ?? dir) !== first?.root,
  );
  const rest = await Promise.all(
    remaining.map(async (dir) => [dir, await checkoutOf($, dir)] as const),
  );
  return [[sessionDir, first], ...rest];
}

function mergeLabel(subjects: string): string {
  const branches = new Set(
    subjects.split("\n").flatMap((subject) => MERGE_SUBJECT.exec(subject)?.[1] ?? []),
  );
  const [only] = branches;
  return branches.size === 1 && only !== undefined ? `merge ${only}` : GENERIC_LABEL;
}
