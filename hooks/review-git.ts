import type { EngineInterface } from "claude-code";

import { hunksOf, unifiedDiff, wholeHunks } from "./diff-panel";
import type { Hunk } from "./diff-panel";
import { gitIn } from "./git-run";
import { rootOf } from "./git-track";

export type ReviewScope = "session" | "uncommitted" | "main";
export type FileStatus = "added" | "modified" | "deleted";
export type SessionFile = { target: string; base?: string };

export type ReviewFile = {
  path: string;
  status: FileStatus;
  isBinary: boolean;
  added: number;
  removed: number;
  base: string;
};

export type Review = { top: string; files: ReviewFile[] } | { reason: string };

type GitResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  isStdoutTruncated?: boolean;
};

export type FileDiff = { hunks: Hunk[]; isCut: boolean };

const BINARY_SNIFF_CHARS = 8000;
const READ_LIMIT_BYTES = 4 * 1024 * 1024;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export async function reviewFiles(
  $: EngineInterface,
  scope: ReviewScope,
  sessionFiles: SessionFile[],
): Promise<Review> {
  const top = await repoTop($);
  if (top === null) return { reason: "not a git repo" };
  if (scope === "session") return { top, files: await sessionReview($, top, sessionFiles) };
  const base = await baseIn($, scope, top);
  if (base === null) return { reason: "no main branch" };
  return { top, files: await repoChanges($, top, top, scope, base) };
}

export async function fileDiff(
  $: EngineInterface,
  scope: ReviewScope,
  file: ReviewFile,
): Promise<Hunk[]> {
  return (await loadFileDiff($, scope, file)).hunks;
}

export async function loadFileDiff(
  $: EngineInterface,
  _scope: ReviewScope,
  file: ReviewFile,
): Promise<FileDiff> {
  const top = await repoTop($);
  if (top === null) return { hunks: [], isCut: false };
  const { repo, path } = await fileRepo($, top, file);
  const isTracked = Boolean(await gitIn($, repo, ["ls-files", "--", path]));
  if (!isTracked && file.status === "added") return newFileDiff($, `${top}/${file.path}`);
  const { stdout, isStdoutTruncated } = await runGit($, repo, [
    "diff",
    "--no-renames",
    file.base,
    "--",
    path,
  ]);
  return { hunks: parseHunks(wholeHunks(stdout)), isCut: isStdoutTruncated === true };
}

export async function revertFile(
  $: EngineInterface,
  top: string,
  file: ReviewFile,
): Promise<string | null> {
  const { repo, path } = await fileRepo($, top, file);
  const inBase = (await gitIn($, repo, ["cat-file", "-e", `${file.base}:${path}`])) !== null;
  if (inBase)
    return gitError(
      await runGit($, repo, [
        "restore",
        `--source=${file.base}`,
        "--staged",
        "--worktree",
        "--",
        path,
      ]),
    );
  const isTracked = Boolean(await gitIn($, repo, ["ls-files", "--", path]));
  const removal = isTracked ? ["rm", "-f"] : ["clean", "-f"];
  return gitError(await runGit($, repo, [...removal, "--", path]));
}

export async function revertHunk(
  $: EngineInterface,
  top: string,
  file: ReviewFile,
  hunk: Hunk,
): Promise<string | null> {
  const { repo, path } = await fileRepo($, top, file);
  const patch = `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${unifiedDiff([hunk])}\n`;
  const args = ["apply", "-R", "--recount", "--whitespace=nowarn"];
  return gitError(await runGit($, repo, args, patch));
}

export function parseHunks(text: string): Hunk[] {
  if (text === "") return [];
  const hunks: Hunk[] = [];
  for (const line of text.replace(/\n$/, "").split("\n")) {
    const header = HUNK_HEADER.exec(line);
    if (header) hunks.push(hunkFrom(header));
    else hunks.at(-1)?.lines.push(line);
  }
  return hunks;
}

function hunkFrom(header: RegExpExecArray): Hunk {
  const [, oldStart, oldLines, newStart, newLines] = header;
  return {
    oldStart: Number(oldStart),
    oldLines: Number(oldLines ?? 1),
    newStart: Number(newStart),
    newLines: Number(newLines ?? 1),
    lines: [],
  };
}

async function repoTop($: EngineInterface): Promise<string | null> {
  const top = await gitIn($, await $.session.root(), ["rev-parse", "--show-toplevel"]);
  return top || null;
}

async function baseIn(
  $: EngineInterface,
  scope: ReviewScope,
  repo: string,
): Promise<string | null> {
  return scope === "main" ? mainBase($, repo) : "HEAD";
}

async function repoOf($: EngineInterface, top: string, target: string): Promise<string> {
  return (await rootOf($, target.slice(0, target.lastIndexOf("/")))) ?? top;
}

async function fileRepo(
  $: EngineInterface,
  top: string,
  file: ReviewFile,
): Promise<{ repo: string; path: string }> {
  const target = `${top}/${file.path}`;
  const repo = await repoOf($, top, target);
  return { repo, path: target.slice(repo.length + 1) };
}

async function mainBase($: EngineInterface, top: string): Promise<string | null> {
  const remoteHead = await gitIn($, top, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  const candidates = remoteHead ? [remoteHead, "main", "master"] : ["main", "master"];
  for (const name of candidates) {
    const base = await gitIn($, top, ["merge-base", "HEAD", name]);
    if (base) return base;
  }
  return null;
}

type SessionGroup = { repo: string; base: string; paths: string[] };

async function sessionReview(
  $: EngineInterface,
  top: string,
  sessionFiles: SessionFile[],
): Promise<ReviewFile[]> {
  const inTop = sessionFiles.filter(({ target }) => target.startsWith(`${top}/`));
  const repos = await Promise.all(inTop.map(({ target }) => repoOf($, top, target)));
  const groups = new Map<string, SessionGroup>();
  inTop.forEach(({ target, base }, i) => {
    const repo = repos[i]!;
    const groupBase = base ?? "HEAD";
    const key = JSON.stringify([repo, groupBase]);
    const group = groups.get(key) ?? { repo, base: groupBase, paths: [] };
    group.paths.push(target.slice(repo.length + 1));
    groups.set(key, group);
  });
  const parts = await Promise.all(
    [...groups.values()].map(async ({ repo, base, paths }) =>
      underTop(top, repo, await changesSince($, repo, base, paths)),
    ),
  );
  return parts.flat().sort(byPath);
}

async function repoChanges(
  $: EngineInterface,
  top: string,
  repo: string,
  scope: ReviewScope,
  base: string,
): Promise<ReviewFile[]> {
  const files = underTop(top, repo, await changesSince($, repo, base, []));
  const parts = await Promise.all(files.map((file) => expandNested($, top, scope, file)));
  return parts.flat().sort(byPath);
}

async function expandNested(
  $: EngineInterface,
  top: string,
  scope: ReviewScope,
  file: ReviewFile,
): Promise<ReviewFile[]> {
  const dir = `${top}/${file.path.replace(/\/$/, "")}`;
  if (!(await isFolder($, dir))) return [file];
  const repo = await rootOf($, dir);
  if (repo !== dir) return [file];
  const base = await baseIn($, scope, repo);
  if (base === null) return [file];
  const inside = await repoChanges($, top, repo, scope, base);
  return inside.length > 0 ? inside : [file];
}

function underTop(top: string, repo: string, files: ReviewFile[]): ReviewFile[] {
  if (repo === top) return files;
  const prefix = `${repo.slice(top.length + 1)}/`;
  return files.map((file) => ({ ...file, path: prefix + file.path }));
}

async function changesSince(
  $: EngineInterface,
  repo: string,
  base: string,
  paths: string[],
): Promise<ReviewFile[]> {
  return (await countedChangesSince($, repo, base, paths)) ?? [];
}

export async function countedChangesSince(
  $: EngineInterface,
  repo: string,
  base: string,
  paths: string[],
): Promise<ReviewFile[] | null> {
  const scope = paths.length > 0 ? ["--", ...paths] : [];
  const [numstat, statuses, untracked] = await Promise.all([
    gitIn($, repo, ["diff", "--no-renames", "--numstat", "-z", base, ...scope]),
    gitIn($, repo, ["diff", "--no-renames", "--name-status", "-z", base, ...scope]),
    gitIn($, repo, ["ls-files", "--others", "--exclude-standard", "-z", ...scope]),
  ]);
  if (numstat === null || statuses === null || untracked === null) return null;
  const tracked = trackedFiles(numstat, statuses, base);
  const fresh = await Promise.all(
    nulSplit(untracked).map((path) => untrackedFile($, repo, path, base)),
  );
  return [...tracked, ...fresh].sort(byPath);
}

function trackedFiles(numstat: string, nameStatus: string, base: string): ReviewFile[] {
  const statusOf = new Map<string, FileStatus>();
  const tokens = nulSplit(nameStatus);
  for (let i = 0; i + 1 < tokens.length; i += 2)
    statusOf.set(tokens[i + 1]!, statusFrom(tokens[i]!));
  return nulSplit(numstat).map((entry) => {
    const [added = "", removed = "", ...rest] = entry.split("\t");
    const path = rest.join("\t");
    const isBinary = added === "-" && removed === "-";
    return {
      path,
      status: statusOf.get(path) ?? "modified",
      isBinary,
      added: isBinary ? 0 : Number(added),
      removed: isBinary ? 0 : Number(removed),
      base,
    };
  });
}

async function untrackedFile(
  $: EngineInterface,
  repo: string,
  path: string,
  base: string,
): Promise<ReviewFile> {
  const { isBinary, added } = await newFileCount($, `${repo}/${path}`);
  return { path, status: "added", isBinary, added, removed: 0, base };
}

async function newFileDiff($: EngineInterface, target: string): Promise<FileDiff> {
  if (await isOverReadLimit($, target)) return { hunks: [], isCut: true };
  return { hunks: await newFileHunks($, target), isCut: false };
}

async function isOverReadLimit($: EngineInterface, target: string): Promise<boolean> {
  return (await sizeOf($, target)) > READ_LIMIT_BYTES;
}

async function newFileCount(
  $: EngineInterface,
  target: string,
): Promise<{ isBinary: boolean; added: number }> {
  if (await isOverReadLimit($, target)) return gitNewFileCount($, target);
  const content = await readWhole($, target);
  if (content === null) return { isBinary: false, added: 0 };
  if (content.slice(0, BINARY_SNIFF_CHARS).includes("\0")) return { isBinary: true, added: 0 };
  const hunks = hunksOf({ filePath: target, isCreate: true, isDelete: false, hunks: [], content });
  return { isBinary: false, added: hunks.reduce((sum, hunk) => sum + hunk.newLines, 0) };
}

async function isFolder($: EngineInterface, target: string): Promise<boolean> {
  try {
    return (await $.fs.stat(target)).kind === "dir";
  } catch {
    return false;
  }
}

async function sizeOf($: EngineInterface, target: string): Promise<number> {
  try {
    return (await $.fs.stat(target)).size;
  } catch {
    return 0;
  }
}

async function readWhole($: EngineInterface, target: string): Promise<string | null> {
  try {
    return await $.fs.read(target);
  } catch (error) {
    $.ui.log(`read failed: ${String(error)}`, { to: "debug" });
    return null;
  }
}

async function gitNewFileCount(
  $: EngineInterface,
  target: string,
): Promise<{ isBinary: boolean; added: number }> {
  const slash = target.lastIndexOf("/");
  const { stdout } = await runGit($, target.slice(0, slash) || "/", [
    "diff",
    "--no-index",
    "--numstat",
    "--",
    "/dev/null",
    target.slice(slash + 1),
  ]);
  const [added = "", removed = ""] = stdout.split("\t");
  const isBinary = added === "-" && removed === "-";
  return { isBinary, added: isBinary ? 0 : Number(added) || 0 };
}

async function newFileHunks($: EngineInterface, target: string): Promise<Hunk[]> {
  const content = await readWhole($, target);
  if (content === null) return [];
  return hunksOf({ filePath: target, isCreate: true, isDelete: false, hunks: [], content });
}

async function runGit(
  $: EngineInterface,
  top: string,
  args: string[],
  stdin?: string,
): Promise<GitResult> {
  try {
    return await $.process.run(
      ["git", "-C", top, ...args],
      stdin === undefined ? undefined : { stdin },
    );
  } catch (error) {
    return { exitCode: -1, stdout: "", stderr: String(error) };
  }
}

function gitError({ exitCode, stderr }: GitResult): string | null {
  if (exitCode === 0) return null;
  return stderr.trim() || `git exited with ${exitCode}`;
}

function statusFrom(letter: string): FileStatus {
  if (letter === "A") return "added";
  if (letter === "D") return "deleted";
  return "modified";
}

const nulSplit = (text: string): string[] => text.split("\0").filter((part) => part !== "");

const byPath = (a: ReviewFile, b: ReviewFile): number => a.path.localeCompare(b.path);
