import type { Worktree } from "../types";

export type Git = (dir: string, args: string[]) => Promise<string | null>;

type Entry = { path: string; head: string; branch: string | null; isLocked: boolean };

type Repo = { root: string; defaultBranch: string | null };

const SHORT_SHA_CHARS = 7;

const WORKTREES_AT_ONCE = 4;

const BRANCH_REF_PREFIX = "refs/heads/";

const DEFAULT_BRANCHES = ["main", "master"];

export async function loadWorktrees(git: Git, cwd: string): Promise<Worktree[]> {
  const root = await git(cwd, ["rev-parse", "--show-toplevel"]);
  if (root === null) return [];
  const listed = await git(root, ["worktree", "list", "--porcelain"]);
  if (listed === null) return [];
  const repo = { root, defaultBranch: await defaultBranchOf(git, root) };
  return worktreesOf(git, repo, entriesOf(listed));
}

async function worktreesOf(git: Git, repo: Repo, entries: Entry[]): Promise<Worktree[]> {
  const rows: Worktree[] = [];
  const pending = entries.entries();
  const takeNext = async (): Promise<void> => {
    for (const [index, entry] of pending) {
      rows[index] = await worktreeOf(git, repo, entry, index === 0);
    }
  };
  await Promise.all(Array.from({ length: WORKTREES_AT_ONCE }, takeNext));
  return rows;
}

export async function removeWorktree(git: Git, from: string, path: string): Promise<void> {
  await git(from, ["worktree", "remove", path]);
}

async function defaultBranchOf(git: Git, root: string): Promise<string | null> {
  for (const name of DEFAULT_BRANCHES) {
    const ref = `${BRANCH_REF_PREFIX}${name}`;
    if ((await git(root, ["rev-parse", "--verify", "--quiet", ref])) !== null) return ref;
  }
  return null;
}

function entriesOf(porcelain: string): Entry[] {
  return porcelain
    .split("\n\n")
    .map((block) => block.split("\n"))
    .filter((lines) => lines.some((line) => line.startsWith("worktree ")))
    .map((lines) => {
      const value = (key: string): string | undefined =>
        lines.find((line) => line === key || line.startsWith(`${key} `))?.slice(key.length + 1);
      return {
        path: value("worktree") ?? "",
        head: value("HEAD") ?? "",
        branch: value("branch") ?? null,
        isLocked: lines.some((line) => line === "locked" || line.startsWith("locked ")),
      };
    });
}

async function worktreeOf(git: Git, repo: Repo, entry: Entry, isMain: boolean): Promise<Worktree> {
  const [status, isMerged] = await Promise.all([
    git(entry.path, ["status", "--porcelain"]),
    isMergedInto(git, repo, entry.branch),
  ]);
  return {
    path: entry.path,
    label: entry.branch?.slice(BRANCH_REF_PREFIX.length) ?? entry.head.slice(0, SHORT_SHA_CHARS),
    isMain,
    isSession: entry.path === repo.root,
    isDetached: entry.branch === null,
    isLocked: entry.isLocked,
    isClean: status === "",
    isMerged,
  };
}

async function isMergedInto(git: Git, repo: Repo, branch: string | null): Promise<boolean> {
  if (branch === null || repo.defaultBranch === null) return false;
  return (
    (await git(repo.root, ["merge-base", "--is-ancestor", branch, repo.defaultBranch])) !== null
  );
}
