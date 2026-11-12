import type { EngineInterface } from "claude-code";

import { namedDirs, rootOf } from "./git-track";

const SNAPSHOT_TIMEOUT_MS = 750;
const STATUS_ARGS = [
  "status",
  "--porcelain=v2",
  "-z",
  "--untracked-files=all",
  "--ignored=no",
  "--no-renames",
];
const WHOLE_GIT_MOVE = new RegExp(
  String.raw`^[ \t]*(?:sudo[ \t]+)?git[ \t]+(?:checkout|switch|stash|pull|merge|rebase|reset|restore|clean|cherry-pick|revert)(?:[ \t]+[A-Za-z0-9._/@~^][A-Za-z0-9._/@~^-]*){0,16}\s*$`,
);
const UNMERGED_PATH_FIELD = 10;
const CHANGED_PATH_FIELD = 8;
const SUBMODULE_FIELD = 2;
const GONE = "gone";

type Snapshot = Map<string, string>;
type Entry = { path: string; isRoot: boolean };

export type Watch = { root: string; before: Snapshot }[];

export async function watchBash(
  $: EngineInterface,
  call: { command: string; run_in_background?: boolean },
): Promise<Watch> {
  if (call.run_in_background === true || WHOLE_GIT_MOVE.test(call.command)) return [];
  const cwd = await $.session.cwd();
  const dirs = [cwd, ...namedDirs(call.command).map((dir) => resolved(cwd, dir))];
  const roots = await Promise.all([...new Set(dirs)].map((dir) => rootOf($, dir)));
  const watched = await Promise.all(
    [...new Set(roots)].flatMap((root) => (root === null ? [] : [snapshotWatch($, root)])),
  );
  return watched.flatMap((one) => (one === null ? [] : [one]));
}

export async function writtenSince($: EngineInterface, watch: Watch): Promise<string[]> {
  const written = await Promise.all(watch.map((one) => writtenInRoot($, one.root, one.before)));
  return written.flat();
}

function resolved(cwd: string, dir: string): string {
  return dir.startsWith("/") ? dir : `${cwd}/${dir}`;
}

async function snapshotWatch($: EngineInterface, root: string): Promise<Watch[number] | null> {
  const before = await snapshotOf($, root);
  return before === null ? null : { root, before };
}

async function writtenInRoot(
  $: EngineInterface,
  root: string,
  before: Snapshot,
): Promise<string[]> {
  const after = await snapshotOf($, root);
  if (after === null) return [];
  const changed = [...after].filter(([path, mark]) => before.get(path) !== mark);
  const left = await Promise.all(
    [...before]
      .filter(([path]) => !after.has(path))
      .map(async ([path, mark]) => ((await markOf($, path)) === mark ? [] : [[path]])),
  );
  return [...changed.map(([path]) => path), ...left.flat(2)];
}

async function snapshotOf($: EngineInterface, root: string): Promise<Snapshot | null> {
  const entries = await dirtyEntries($, root);
  if (entries === null) return null;
  const files = entries.filter((entry) => !entry.isRoot);
  const childRoots = entries.filter((entry) => entry.isRoot);
  const marks = await Promise.all(
    files.map(async ({ path }) => [`${root}/${path}`, await markOf($, `${root}/${path}`)] as const),
  );
  const children = await Promise.all(
    childRoots.map(({ path }) => snapshotOf($, `${root}/${path}`)),
  );
  if (children.some((child) => child === null)) return null;
  return new Map([...marks, ...children.flatMap((child) => [...(child ?? [])])]);
}

async function dirtyEntries($: EngineInterface, root: string): Promise<Entry[] | null> {
  try {
    const { exitCode, stdout } = await $.process.run(["git", "-C", root, ...STATUS_ARGS], {
      env: { GIT_OPTIONAL_LOCKS: "0" },
      timeoutMs: SNAPSHOT_TIMEOUT_MS,
    });
    return exitCode === 0 ? stdout.split("\0").flatMap(entryOf) : null;
  } catch {
    return null;
  }
}

function entryOf(line: string): Entry[] {
  if (line.startsWith("? ")) return [untrackedEntry(line.slice(2))];
  if (line.startsWith("1 ")) return [changedEntry(line)];
  if (line.startsWith("u "))
    return [{ path: fieldsFrom(line, UNMERGED_PATH_FIELD), isRoot: false }];
  return [];
}

function untrackedEntry(path: string): Entry {
  return path.endsWith("/") ? { path: path.slice(0, -1), isRoot: true } : { path, isRoot: false };
}

function changedEntry(line: string): Entry {
  const submodule = line.split(" ")[SUBMODULE_FIELD] ?? "";
  return { path: fieldsFrom(line, CHANGED_PATH_FIELD), isRoot: submodule.startsWith("S") };
}

function fieldsFrom(entry: string, first: number): string {
  return entry.split(" ").slice(first).join(" ");
}

async function markOf($: EngineInterface, path: string): Promise<string> {
  try {
    const { size, mtimeMs } = await $.fs.stat(path);
    return `${size}:${mtimeMs}`;
  } catch {
    return GONE;
  }
}
