import type { EngineInterface } from "claude-code";

export type Git = {
  exitCode: number;
  stdout: string;
  stderr: string;
  isStdoutTruncated?: boolean;
};
export type Tree = Map<string, string>;
export type Repo = {
  top: string | null;
  trees: Record<string, Tree>;
  work: Tree;
  untracked: Set<string>;
  executable: Set<string>;
  binary: Set<string>;
  cut: Map<string, string>;
  mtimes: Map<string, number>;
  mergeBases: Record<string, string>;
  originHead: string | null;
  commands: { argv: string[]; stdin: string | undefined }[];
  nested: Nested[];
  $: EngineInterface;
};
export type Nested = { dir: string; repo: Repo; kind: NestedKind };
export type NestedKind = "nested" | "submodule" | "moved submodule";

export const TOP = "/work";
export const INNER_DIR = "inner";
export const SUBMODULE_DIR = "vendor/lib";
export const HEAD_SHA = "aaaaaaa1";
export const OLD_BASE_SHA = "bbbbbbb2";
export const MERGE_BASE_SHA = "ccccccc3";
export const APPLY_FAILURE = "error: patch failed: a.txt:18\nerror: a.txt: patch does not apply";
const CONTEXT = 3;
const NO_EOL = "\u0000";
const NOT_FOUND = 128;
const READ_LIMIT_CHARS = 4 * 1024 * 1024;
const NO_INDEX_DIFFERS = 1;
const REF_PREFIX = new RegExp("^refs/(heads|remotes)/");
const SUBMODULE_ENTRY = "gitlink";

export function repoOf(init: Partial<Omit<Repo, "$">> = {}): Repo {
  const repo = {
    top: TOP,
    trees: { HEAD: new Map(), [HEAD_SHA]: new Map() },
    work: new Map(),
    untracked: new Set(),
    executable: new Set(),
    binary: new Set(),
    cut: new Map(),
    mtimes: new Map(),
    mergeBases: {},
    originHead: null,
    commands: [],
    nested: [],
    ...init,
  } as Repo;
  repo.$ = {
    session: { cwd: async () => TOP, root: async () => TOP },
    ui: { log: () => undefined },
    fs: {
      stat: async (path: string) => {
        if (isFolderOf(repo, path)) return { kind: "dir", size: 0, mtimeMs: 0, isLink: false };
        const owner = ownerOf(repo, path);
        const relative = relativeTo(owner, path);
        const text = owner.work.get(relative);
        if (text === undefined) throw new Error(`no such file ${path}`);
        return {
          kind: "file",
          size: new TextEncoder().encode(text).length,
          mtimeMs: owner.mtimes.get(relative) ?? 0,
          isLink: false,
        };
      },
      read: async (path: string) => {
        const text = fileIn(repo, path);
        if (text === undefined) throw new Error(`no such file ${path}`);
        if (text.length > READ_LIMIT_CHARS) throw new Error(`file too large ${path}`);
        return text;
      },
    },
    process: {
      run: async (argv: readonly string[], runInit?: { stdin?: string }) => {
        repo.commands.push({ argv: [...argv], stdin: runInit?.stdin });
        return git(repo, [...argv], runInit?.stdin);
      },
    },
  } as unknown as EngineInterface;
  return repo;
}

export function nestedRepoOf(): Repo {
  const repo = repoOf({
    trees: { HEAD: treeOf({ "src/a.ts": "one\n" }), [HEAD_SHA]: treeOf({ "src/a.ts": "one\n" }) },
    work: treeOf({ "src/a.ts": "one\ntwo\n" }),
  });
  nest(repo, INNER_DIR, {
    trees: { HEAD: treeOf({ "n.txt": "keep inner\n" }) },
    work: treeOf({ "n.txt": "keep inner\ninner one added\ninner two added\n" }),
  });
  nest(
    repo,
    SUBMODULE_DIR,
    { trees: { HEAD: treeOf({ "x.ts": "keep\n" }) }, work: treeOf({ "x.ts": "keep\ny\n" }) },
    "submodule",
  );
  return repo;
}

export function movedSubmoduleRepoOf(work: Tree = treeOf({ "x.ts": "keep\n" })): Repo {
  const repo = repoOf({
    trees: { HEAD: treeOf({ "src/a.ts": "one\n" }), [HEAD_SHA]: treeOf({ "src/a.ts": "one\n" }) },
    work: treeOf({ "src/a.ts": "one\n" }),
  });
  nest(
    repo,
    SUBMODULE_DIR,
    { trees: { HEAD: treeOf({ "x.ts": "keep\n" }) }, work },
    "moved submodule",
  );
  return repo;
}

export function nestedRepoWithoutMainOf(): Repo {
  const repo = repoOf({
    trees: {
      HEAD: treeOf({ "src/a.ts": "one\n" }),
      [MERGE_BASE_SHA]: treeOf({ "src/a.ts": "one\n" }),
    },
    work: treeOf({ "src/a.ts": "one\ntwo\n" }),
    mergeBases: { main: MERGE_BASE_SHA },
  });
  nest(repo, INNER_DIR, {
    trees: { HEAD: treeOf({ "n.txt": "keep inner\n" }) },
    work: treeOf({ "n.txt": "keep inner\ninner one added\n" }),
  });
  return repo;
}

function nest(
  parent: Repo,
  dir: string,
  init: Partial<Omit<Repo, "$" | "top">>,
  kind: NestedKind = "nested",
): void {
  const repo = repoOf({ ...init, top: `${rootOf(parent)}/${dir}` });
  parent.nested.push({ dir, repo, kind });
}

export function repoAt(parent: Repo, dir: string): Repo {
  const child = parent.nested.find((nested) => nested.dir === dir);
  if (!child) throw new Error(`no nested repo at ${dir}`);
  return child.repo;
}

function rootOf(repo: Repo): string {
  return repo.top ?? TOP;
}

function isFolderOf(repo: Repo, path: string): boolean {
  return repo.nested.some(({ repo: child }) => rootOf(child) === path);
}

function ownerOf(repo: Repo, path: string): Repo {
  const child = repo.nested.find(
    ({ repo: nested }) => path === rootOf(nested) || path.startsWith(`${rootOf(nested)}/`),
  );
  return child ? ownerOf(child.repo, path) : repo;
}

function relativeTo(repo: Repo, path: string): string {
  const root = rootOf(repo);
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

function fileIn(repo: Repo, path: string): string | undefined {
  const owner = ownerOf(repo, path);
  return owner.work.get(relativeTo(owner, path));
}

export function treeOf(files: Record<string, string>): Tree {
  return new Map(Object.entries(files));
}

export function numbered(count: number, edits: Record<number, string> = {}): string {
  const lines = Array.from({ length: count }, (_, i) => edits[i + 1] ?? `line ${i + 1}`);
  return `${lines.join("\n")}\n`;
}

function ok(stdout: string): Git {
  return { exitCode: 0, stdout, stderr: "" };
}

function fail(stderr: string, exitCode = 1): Git {
  return { exitCode, stdout: "", stderr };
}

function git(parent: Repo, argv: string[], stdin: string | undefined): Git {
  const cwd = argv[1] === "-C" ? (argv[2] ?? TOP) : TOP;
  const repo = ownerOf(parent, cwd);
  const args = argv.slice(argv[1] === "-C" ? 3 : 1);
  const [command = "", ...rest] = args;
  if (repo.top === null) return fail("fatal: not a git repository", NOT_FOUND);
  if (command === "rev-parse") return revParse(repo, rest);
  if (command === "symbolic-ref")
    return repo.originHead ? ok(`origin/${repo.originHead}\n`) : fail("fatal: no ref", NOT_FOUND);
  if (command === "merge-base") {
    const sha = repo.mergeBases[rest[1] ?? ""];
    return sha ? ok(`${sha}\n`) : fail("");
  }
  if (command === "show-ref" || command === "branch") return refCheck(repo, rest);
  if (command === "cat-file") return catFile(repo, rest);
  if (command === "ls-files") return lsFiles(repo, rest);
  if (command === "diff") return diff(repo, rest, cwd);
  if (command === "restore") return restore(repo, rest);
  if (command === "rm") return remove(repo, rest);
  if (command === "clean") return clean(repo, rest);
  if (command === "apply") return apply(repo, rest, stdin ?? "");
  return ok("");
}

function revParse(repo: Repo, rest: string[]): Git {
  if (rest.includes("--show-toplevel"))
    return ok(rest.includes("--abbrev-ref") ? `${repo.top}\n${HEAD_SHA}\nmain\n` : `${repo.top}\n`);
  const ref = (rest[rest.length - 1] ?? "").replace(/\^\{commit\}$/, "");
  if (ref === "HEAD") return ok(`${HEAD_SHA}\n`);
  return refCheck(repo, [ref]);
}

function refCheck(repo: Repo, rest: string[]): Git {
  const name = (rest[rest.length - 1] ?? "").replace(REF_PREFIX, "");
  return name in repo.mergeBases ? ok(`${HEAD_SHA}\n`) : fail("", NOT_FOUND);
}

function catFile(repo: Repo, rest: string[]): Git {
  const [rev = "", path = ""] = (rest[1] ?? "").split(":");
  return repo.trees[rev]?.has(path) ? ok("") : fail("fatal: path not in tree", NOT_FOUND);
}

function isTracked(repo: Repo, path: string): boolean {
  return !repo.untracked.has(path) && (repo.work.has(path) || repo.trees.HEAD?.has(path) === true);
}

function lsFiles(repo: Repo, rest: string[]): Git {
  const separator = rest.includes("-z") ? "\0" : "\n";
  if (rest.includes("--others")) {
    const files = [...repo.untracked].filter((p) => repo.work.has(p));
    return ok([...files, ...untrackedNestedDirs(repo, rest)].join(separator) + separator);
  }
  const paths = rest.slice(rest.indexOf("--") + 1);
  const tracked = paths.filter((path) => isTracked(repo, path));
  if (rest.includes("--error-unmatch") && tracked.length < paths.length) return fail("", 1);
  return ok(tracked.map((path) => `${path}\n`).join(""));
}

function untrackedNestedDirs(repo: Repo, rest: string[]): string[] {
  const split = rest.indexOf("--");
  const scope = split === -1 ? undefined : rest.slice(split + 1);
  return repo.nested
    .filter(
      ({ dir, kind }) =>
        kind === "nested" &&
        (scope === undefined || scope.some((path) => path === dir || path === `${dir}/`)),
    )
    .map(({ dir }) => `${dir}/`);
}

function isDirty(repo: Repo): boolean {
  return changesAgainst(repo, "HEAD", undefined, false).length > 0;
}

function submoduleChanges(repo: Repo, onlyPaths: string[] | undefined): Change[] {
  return repo.nested
    .filter(
      ({ dir, kind, repo: child }) =>
        kind !== "nested" &&
        (kind === "moved submodule" || isDirty(child)) &&
        (onlyPaths === undefined || onlyPaths.includes(dir)),
    )
    .map(({ dir, kind }) => ({
      path: dir,
      from: undefined,
      before: SUBMODULE_ENTRY,
      after: SUBMODULE_ENTRY,
      isSubmodule: true,
      isMoved: kind === "moved submodule",
    }));
}

type Change = {
  path: string;
  from: string | undefined;
  before: string | undefined;
  after: string | undefined;
  renamed?: string;
  isSubmodule?: boolean;
  isMoved?: boolean;
};

function changesAgainst(
  repo: Repo,
  rev: string,
  onlyPaths: string[] | undefined,
  renames: boolean,
): Change[] {
  const tree: Tree = repo.trees[rev] ?? new Map<string, string>();
  const paths = new Set([
    ...tree.keys(),
    ...[...repo.work.keys()].filter((p) => !repo.untracked.has(p)),
  ]);
  const found: Change[] = [...paths]
    .filter((path) => onlyPaths === undefined || onlyPaths.includes(path))
    .map((path): Change => ({
      path,
      from: undefined,
      before: tree.get(path),
      after: repo.untracked.has(path) ? undefined : repo.work.get(path),
    }))
    .filter(
      (change) =>
        change.before !== change.after ||
        (change.before !== undefined && repo.executable.has(change.path)),
    );
  if (!renames) return found;
  const gone = found.filter((c) => c.after === undefined);
  const merged: Change[] = [];
  for (const change of found) {
    if (change.after === undefined) {
      if (!found.some((c) => c.before === undefined && c.after === change.before))
        merged.push(change);
      continue;
    }
    const source =
      change.before === undefined ? gone.find((g) => g.before === change.after) : undefined;
    merged.push(source ? { ...change, from: source.path, renamed: source.path } : change);
  }
  return merged;
}

function noIndexDiff(repo: Repo, rest: string[], cwd: string): Git {
  const file = rest[rest.length - 1] ?? "";
  const absolute = file.startsWith("/") ? file : `${cwd}/${file}`;
  const path = relativeTo(repo, absolute);
  const text = repo.work.get(path);
  if (text === undefined) return fail(`fatal: Could not access '${file}'`, NOT_FOUND);
  if (text === "") return ok("");
  const count = repo.binary.has(path) ? "-\t-" : `${tokens(text).length}\t0`;
  return { exitCode: NO_INDEX_DIFFERS, stdout: `${count}\t${file}\n`, stderr: "" };
}

function diff(repo: Repo, rest: string[], cwd: string): Git {
  if (rest.includes("--no-index")) return noIndexDiff(repo, rest, cwd);
  const split = rest.indexOf("--");
  const head = split === -1 ? rest : rest.slice(0, split);
  const onlyPaths = split === -1 ? undefined : rest.slice(split + 1);
  const revs = head.filter((a) => !a.startsWith("-"));
  const rev = revs[0] ?? "HEAD";
  const changes = [
    ...changesAgainst(repo, rev, onlyPaths, !head.includes("--no-renames")),
    ...submoduleChanges(repo, onlyPaths),
  ];
  const separator = head.includes("-z") ? "\0" : "\n";
  if (head.includes("--numstat"))
    return ok(changes.map((c) => numstatOf(repo, c, separator)).join(""));
  if (head.includes("--name-status"))
    return ok(changes.map((c) => statusOf(c, separator)).join(""));
  if (head.includes("--name-only")) return ok(changes.map((c) => `${c.path}${separator}`).join(""));
  const cutStdout = (onlyPaths ?? []).map((path) => repo.cut.get(path)).find((text) => text);
  if (cutStdout !== undefined) return { ...ok(cutStdout), isStdoutTruncated: true };
  return ok(changes.map((c) => textOf(repo, c)).join(""));
}

function statusOf(change: Change, separator: string): string {
  if (change.renamed)
    return ["R100", change.renamed, change.path].join(separator === "\0" ? "\0" : "\t") + separator;
  const letter = change.before === undefined ? "A" : change.after === undefined ? "D" : "M";
  return `${letter}${separator === "\0" ? "\0" : "\t"}${change.path}${separator}`;
}

function numstatOf(repo: Repo, change: Change, separator: string): string {
  const name = change.renamed ? `${change.renamed} => ${change.path}` : change.path;
  if (change.isSubmodule) {
    const count = change.isMoved ? 1 : 0;
    return `${count}\t${count}\t${name}${separator}`;
  }
  if (repo.binary.has(change.path)) return `-\t-\t${name}${separator}`;
  if (change.renamed) return `0\t0\t${name}${separator}`;
  const ops = opsOf(change.before ?? "", change.after ?? "");
  const added = ops.filter((o) => o.kind === "+").length;
  const removed = ops.filter((o) => o.kind === "-").length;
  return `${added}\t${removed}\t${name}${separator}`;
}

function textOf(repo: Repo, change: Change): string {
  const { path } = change;
  if (change.before === change.after)
    return `diff --git a/${path} b/${path}\nold mode 100644\nnew mode 100755\n`;
  if (change.renamed)
    return `diff --git a/${change.renamed} b/${path}\nsimilarity index 100%\nrename from ${change.renamed}\nrename to ${path}\n`;
  const lead =
    change.before === undefined
      ? `new file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/${path}\n`
      : change.after === undefined
        ? `deleted file mode 100644\nindex 1111111..0000000\n--- a/${path}\n+++ /dev/null\n`
        : `index 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n`;
  const head = `diff --git a/${path} b/${path}\n`;
  if (repo.binary.has(path))
    return `${head}index 1111111..2222222 100644\nBinary files a/${path} and b/${path} differ\n`;
  return head + lead + hunksOf(change);
}

type Op = { kind: " " | "-" | "+"; text: string };

function tokens(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  else lines.push(`${lines.pop() ?? ""}${NO_EOL}`);
  return lines;
}

function opsOf(before: string, after: string): Op[] {
  const a = tokens(before);
  const b = tokens(after);
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      ops.push({ kind: " ", text: a[i++]! });
      j++;
    } else if (i < a.length && (j === b.length || table[i + 1]![j]! >= table[i]![j + 1]!))
      ops.push({ kind: "-", text: a[i++]! });
    else ops.push({ kind: "+", text: b[j++]! });
  }
  return ops;
}

function span(start: number, count: number): string {
  const shown = count === 0 ? start - 1 : start;
  return count === 1 ? `${shown}` : `${shown},${count}`;
}

function hunksOf(change: Change): string {
  const ops = opsOf(change.before ?? "", change.after ?? "");
  const changed = ops.flatMap((op, index) => (op.kind === " " ? [] : [index]));
  const ranges: [number, number][] = [];
  for (const index of changed) {
    const start = Math.max(0, index - CONTEXT);
    const end = Math.min(ops.length - 1, index + CONTEXT);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1] + 1) last[1] = end;
    else ranges.push([start, end]);
  }
  return ranges
    .map(([start, end]) => {
      const slice = ops.slice(start, end + 1);
      const oldBefore = ops.slice(0, start).filter((o) => o.kind !== "+").length;
      const newBefore = ops.slice(0, start).filter((o) => o.kind !== "-").length;
      const oldCount = slice.filter((o) => o.kind !== "+").length;
      const newCount = slice.filter((o) => o.kind !== "-").length;
      const body = slice
        .map((o) =>
          o.text.endsWith(NO_EOL)
            ? `${o.kind}${o.text.slice(0, -1)}\n\\ No newline at end of file`
            : `${o.kind}${o.text}`,
        )
        .join("\n");
      return `@@ -${span(oldBefore + 1, oldCount)} +${span(newBefore + 1, newCount)} @@\n${body}\n`;
    })
    .join("");
}

function restore(repo: Repo, rest: string[]): Git {
  const source = rest.find((a) => a.startsWith("--source="))?.slice("--source=".length) ?? "HEAD";
  const path = rest[rest.indexOf("--") + 1] ?? "";
  if (!rest.includes("--staged") || !rest.includes("--worktree"))
    return fail("restore must reset index and tree");
  const text = repo.trees[source]?.get(path);
  if (text === undefined) return fail(`error: pathspec '${path}' did not match`);
  repo.work.set(path, text);
  repo.untracked.delete(path);
  repo.executable.delete(path);
  return ok("");
}

function remove(repo: Repo, rest: string[]): Git {
  const path = rest[rest.indexOf("--") + 1] ?? "";
  if (!isTracked(repo, path))
    return fail(`fatal: pathspec '${path}' did not match any files`, NOT_FOUND);
  repo.work.delete(path);
  return ok("");
}

function clean(repo: Repo, rest: string[]): Git {
  const path = rest[rest.indexOf("--") + 1] ?? "";
  if (!rest.includes("-f") || !repo.untracked.has(path)) return ok("");
  repo.work.delete(path);
  repo.untracked.delete(path);
  return ok(`Removing ${path}\n`);
}

function apply(repo: Repo, rest: string[], patch: string): Git {
  if (!rest.includes("-R")) return fail("error: only reverse applies are supported");
  const lines = patch.split("\n");
  const plus = lines.find((l) => l.startsWith("+++ b/"));
  const minus = lines.find((l) => l.startsWith("--- a/"));
  const first = lines.findIndex((l) => l.startsWith("@@"));
  if (!plus || !minus || first === -1) return fail("error: No valid patches in input");
  const path = plus.slice("+++ b/".length);
  const current = repo.work.get(path);
  if (current === undefined) return fail(`error: ${path}: No such file or directory`);
  const oldSide: string[] = [];
  const newSide: string[] = [];
  let noEolNew = false;
  let noEolOld = false;
  let last: string | undefined;
  for (const line of lines.slice(first + 1)) {
    if (line.startsWith("@@") || line === "") continue;
    if (line.startsWith("\\")) {
      if (last !== "+") noEolOld = true;
      if (last !== "-") noEolNew = true;
      continue;
    }
    last = line[0];
    if (!line.startsWith("+")) oldSide.push(line.slice(1));
    if (!line.startsWith("-")) newSide.push(line.slice(1));
  }
  const needle = newSide.map((l) => `${l}\n`).join("");
  const target = noEolNew ? needle.slice(0, -1) : needle;
  const at = noEolNew
    ? current.endsWith(target)
      ? current.length - target.length
      : -1
    : current.indexOf(target);
  if (at === -1 || (needle === "" && !noEolNew)) return fail(APPLY_FAILURE);
  const restored = oldSide.map((l) => `${l}\n`).join("");
  const replacement = noEolOld ? restored.slice(0, -1) : restored;
  repo.work.set(path, current.slice(0, at) + replacement + current.slice(at + target.length));
  return ok("");
}
