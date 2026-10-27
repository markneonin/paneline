import { atom, read, update } from "claude-code";
import type { EngineInterface, On } from "claude-code";

import type { Activity, AgentEdit, GitChange } from "../types";
import { gitIn as git } from "./git-run";

const MOVING_COMMAND =
  /\bgit\b[^|;&\n]*\b(merge|rebase|pull|cherry-pick|reset|checkout|switch|commit)\b/;
const MERGE_SUBJECT = /^merge (\S+?):/;
const GENERIC_LABEL = "merged";
const GIT_DIR_FLAG = /\bgit\s+-C\s+(?:"([^"]+)"|'([^']+)'|(\S+))/g;
const LEADING_CD = /^\s*cd\s+(?:"([^"]+)"|'([^']+)'|([^\s&;]+))\s*&&/;

const changesAtom = atom({ plugin: "paneline", key: "gitChanges" } as const, [] as GitChange[]);

const activityAtom = atom({ plugin: "paneline", key: "activity" } as const, [] as Activity[]);
const agentEditsAtom = atom({ plugin: "paneline", key: "agentEdits" } as const, [] as AgentEdit[]);

const branchesAtom = atom(
  { plugin: "paneline", key: "gitBranches" } as const,
  {} as Record<string, string>,
);

const rootOfDir = new Map<string, string | null>();

type Checkout = { root: string; head: string };

export function trackGit(on: On): void {
  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    if (!MOVING_COMMAND.test(e.command)) return next(e);
    const before = await checkoutsAround($, e.command);
    const ran = await next(e);
    await Promise.all(
      before.map(async (checkout) => recordLanded($, checkout, await checkoutOf($, checkout.root))),
    );
    await refreshBranches(
      $,
      before.map((checkout) => checkout.root),
    );
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
  const dirs = [
    cwd,
    ...namedDirs(command).map((dir) => resolved(cwd, dir)),
    ...Object.keys(known),
    ...edited,
  ];
  const found = await Promise.all([...new Set(dirs)].map((dir) => checkoutOf($, dir)));
  const byRoot = new Map(
    found.flatMap((checkout) => (checkout === null ? [] : [[checkout.root, checkout] as const])),
  );
  return [...byRoot.values()];
}

function namedDirs(command: string): string[] {
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
): Promise<void> {
  if (before === null || after === null) return;
  if (before.root !== after.root || before.head === after.head) return;
  const landed = await changesBetween($, before, after.head);
  await update($, changesAtom, (known) => mergedChanges(known, landed));
}

function mergedChanges(known: GitChange[], landed: GitChange[]): GitChange[] {
  const landedTargets = new Set(landed.map((change) => change.target));
  const earlier = new Map(known.map((change) => [change.target, change]));
  return [
    ...known.filter((change) => !landedTargets.has(change.target)),
    ...landed.map((change) => {
      const before = earlier.get(change.target);
      return before === undefined
        ? change
        : {
            ...change,
            base: before.base,
            added: change.added + before.added,
            removed: change.removed + before.removed,
          };
    }),
  ];
}

async function refreshBranches($: EngineInterface, ranIn: string[]): Promise<void> {
  const [known, edited] = await Promise.all([read($, branchesAtom), editedRoots($)]);
  const roots = new Set([...Object.keys(known), ...edited, ...ranIn]);
  const branches = await Promise.all(
    [...roots].map(async (root) => [root, await branchOf($, root)] as const),
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

async function branchOf($: EngineInterface, root: string): Promise<string | null> {
  const name = await git($, root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return name === "HEAD" ? git($, root, ["rev-parse", "--short", "HEAD"]) : name;
}

async function editedRoots($: EngineInterface): Promise<string[]> {
  const [activity, agentEdits] = await Promise.all([
    read($, activityAtom),
    read($, agentEditsAtom),
  ]);
  const dirs = new Set(
    [...activity, ...agentEdits]
      .filter((entry) => entry.tool !== "Read" && entry.target.startsWith("/"))
      .map((entry) => entry.target.slice(0, entry.target.lastIndexOf("/")) || "/"),
  );
  const roots = await Promise.all([...dirs].map((dir) => rootOf($, dir)));
  return roots.filter((root): root is string => root !== null);
}

async function rootOf($: EngineInterface, dir: string): Promise<string | null> {
  const known = rootOfDir.get(dir);
  if (known !== undefined) return known;
  const root = await git($, dir, ["rev-parse", "--show-toplevel"]);
  rootOfDir.set(dir, root);
  return root;
}

async function checkoutOf($: EngineInterface, dir: string): Promise<Checkout | null> {
  const found = await git($, dir, ["rev-parse", "--show-toplevel", "HEAD"]);
  const [root, head] = found?.split("\n") ?? [];
  return root && head ? { root, head } : null;
}

async function changesBetween(
  $: EngineInterface,
  before: Checkout,
  head: string,
): Promise<GitChange[]> {
  const { root } = before;
  const [numstat, subjects] = await Promise.all([
    git($, root, ["diff", "--numstat", "--no-renames", before.head, head]),
    git($, root, ["log", "-g", "--format=%gs", `${before.head}..${head}`]),
  ]);
  const label = mergeLabel(subjects ?? "");
  return (numstat ?? "")
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([, , path]) => path !== undefined && path !== "")
    .map(([added, removed, path]) => ({
      target: `${root}/${path}`,
      added: Number(added) || 0,
      removed: Number(removed) || 0,
      label,
      base: before.head,
    }));
}

function mergeLabel(subjects: string): string {
  const branches = new Set(
    subjects.split("\n").flatMap((subject) => MERGE_SUBJECT.exec(subject)?.[1] ?? []),
  );
  const [only] = branches;
  return branches.size === 1 && only !== undefined ? `merge ${only}` : GENERIC_LABEL;
}
