import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

type Write = { key: string; value: unknown };
type Repo = { head: string; branch: string };
type Landing = { numstat: string; subjects: string };
type Verdict =
  | { result: unknown; text: string }
  | { isError: true; result: unknown; text: string }
  | { deny: string };
type World = {
  writes: Write[];
  willMerge: (root: string, head: string, landing: Landing) => void;
  willCheckout: (root: string, branch: string) => void;
  willAnswer: (verdict: Verdict) => void;
  willWorkingDiff: (root: string, base: string, numstat: string) => void;
};

const HOME_DIR = "/Users/dev";
const WORK_DIR = "/Users/dev/IT";
const OTHER_DIR = "/Users/dev/other";
const NOT_REPO_DIR = "/Users/dev/scratch";
const SESSION_START = { cwd: WORK_DIR, surface: "terminal", isInteractive: true } as const;
const MAIN_BRANCH = "main";
const FEATURE_BRANCH = "feature/x";
const OTHER_FEATURE = "feature/y";
const OTHER_REPO_BRANCH = "feature/z";
const START_HEAD = "aaaaaaa1";
const FIRST_MERGE_HEAD = "bbbbbbb2";
const SECOND_MERGE_HEAD = "ccccccc3";
const OTHER_HEAD = "ddddddd4";
const TRACKED_PATH = "src/a.ts";
const TRACKED_FILE = `${WORK_DIR}/${TRACKED_PATH}`;
const ADDED = 3;
const REMOVED = 1;
const BOTH_MERGES_ADDED = 4;
const BOTH_MERGES_REMOVED = 1;
const MERGED_LABEL = "merged";
const FAST_FORWARD = "Fast-forward";
const TOOL_RESULT = { result: "ok", text: "ok" };
const OTHER_FILE = `${OTHER_DIR}/notes.ts`;
const REFUSAL = "Blocked: that repo is outside the project";
const EDIT_FAILURE = "<tool_use_error>String to replace not found in file.</tool_use_error>";
const FAILED_EDIT: Verdict = { isError: true, result: EDIT_FAILURE, text: EDIT_FAILURE };
const DENIED_EDIT: Verdict = { deny: REFUSAL };
const BASH_FAILURE = "exit status 1";
const NOT_A_REPO = 128;
const FIRST = 0;
const MODEL = "claude-opus-5-5";
const NO_EFFECT = (): void => undefined;
const NESTED_DIR = `${WORK_DIR}/inner`;
const NESTED_PATH = "n.txt";
const NESTED_START = "eeeeeee5";
const NESTED_ADDED = 1;
const NESTED_REMOVED = 0;
const RECOUNT_ADDED = 5;
const RECOUNT_REMOVED = 2;

describe("git changes and branches", () => {
  test("G1 a shell command that does not move git leaves the git changes and branches untouched", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);

    const written = await writesDuring(world, () => bash($, "ls"));

    expect(keysOf(written)).not.toContain("gitChanges");
    expect(keysOf(written)).not.toContain("gitBranches");
  });

  test("G2 a merge that brings in commits lists each changed file with its lines, labelled with the merged branch", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    world.willMerge(WORK_DIR, FIRST_MERGE_HEAD, {
      numstat: numstatLine(ADDED, REMOVED, TRACKED_PATH),
      subjects: mergeSubject(FEATURE_BRANCH),
    });

    await bash($, `git merge ${FEATURE_BRANCH}`);

    expect(lastWritten(world, "gitChanges")).toEqual([
      {
        target: TRACKED_FILE,
        added: ADDED,
        removed: REMOVED,
        label: `merge ${FEATURE_BRANCH}`,
        base: START_HEAD,
        landedBy: [`git merge ${FEATURE_BRANCH}`],
      },
    ]);
  });

  test("G3 a merge that leaves HEAD where it was records no git change", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);

    const written = await writesDuring(world, () => bash($, `git merge ${FEATURE_BRANCH}`));

    expect(keysOf(written)).not.toContain("gitChanges");
  });

  test("G4 a merge whose commits name several branches is labelled merged", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    world.willMerge(WORK_DIR, FIRST_MERGE_HEAD, {
      numstat: numstatLine(ADDED, REMOVED, TRACKED_PATH),
      subjects: [mergeSubject(FEATURE_BRANCH), mergeSubject(OTHER_FEATURE)].join("\n"),
    });

    await bash($, `git merge ${FEATURE_BRANCH}`);

    expect(lastWritten(world, "gitChanges")).toEqual([
      {
        target: TRACKED_FILE,
        added: ADDED,
        removed: REMOVED,
        label: MERGED_LABEL,
        base: START_HEAD,
        landedBy: [`git merge ${FEATURE_BRANCH}`],
      },
    ]);
  });

  test("G5 two merges that change the same file show the lines git counts against the first base, not the two merges added up", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    world.willMerge(WORK_DIR, FIRST_MERGE_HEAD, {
      numstat: numstatLine(ADDED, REMOVED, TRACKED_PATH),
      subjects: mergeSubject(FEATURE_BRANCH),
    });
    await bash($, `git merge ${FEATURE_BRANCH}`);
    world.willMerge(WORK_DIR, SECOND_MERGE_HEAD, {
      numstat: numstatLine(BOTH_MERGES_ADDED, BOTH_MERGES_REMOVED, TRACKED_PATH),
      subjects: mergeSubject(OTHER_FEATURE),
    });

    await bash($, `git merge ${OTHER_FEATURE}`);

    const row = (lastWritten(world, "gitChanges") as GitRow[]).find(
      (change) => change.target === TRACKED_FILE,
    );
    expect(row).toMatchObject({
      added: BOTH_MERGES_ADDED,
      removed: BOTH_MERGES_REMOVED,
      base: START_HEAD,
    });
  });

  test("G6 a git command aimed at another repo with git -C records that repo's new branch", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    world.willCheckout(OTHER_DIR, OTHER_REPO_BRANCH);

    await bash($, `git -C ${OTHER_DIR} checkout ${OTHER_REPO_BRANCH}`);

    expect(lastWritten(world, "gitBranches")).toEqual({
      [WORK_DIR]: MAIN_BRANCH,
      [OTHER_DIR]: OTHER_REPO_BRANCH,
    });
  });

  test("G7 a cd into another repo before git checkout records that repo's new branch", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    world.willCheckout(OTHER_DIR, OTHER_REPO_BRANCH);

    await bash($, `cd ${OTHER_DIR} && git checkout ${OTHER_REPO_BRANCH}`);

    expect(lastWritten(world, "gitBranches")).toEqual({
      [WORK_DIR]: MAIN_BRANCH,
      [OTHER_DIR]: OTHER_REPO_BRANCH,
    });
  });

  test("G8 a git command in a folder that is not a repo leaves the Bash result as it was and writes nothing", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);

    let result: unknown;
    const written = await writesDuring(world, async () => {
      result = await bash($, `git -C ${NOT_REPO_DIR} merge ${FEATURE_BRANCH}`);
    });

    expect(keysOf(written)).not.toContain("gitChanges");
    expect(result).toEqual(TOOL_RESULT);
  });

  test("G9 starting a session with /clear empties the git changes", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    world.willMerge(WORK_DIR, FIRST_MERGE_HEAD, {
      numstat: numstatLine(ADDED, REMOVED, TRACKED_PATH),
      subjects: mergeSubject(FEATURE_BRANCH),
    });
    await bash($, `git merge ${FEATURE_BRANCH}`);

    await $.classic.SessionStart({ source: "clear" });

    expect(lastWritten(world, "gitChanges")).toEqual([]);
  });

  test("G10 a failed Edit in another repo records no branch for that repo", async ($, on) => {
    const world = await worldOf($, on);
    world.willAnswer(FAILED_EDIT);

    await editOf($, OTHER_FILE);

    expect(JSON.stringify(branchesWritten(world))).not.toContain(OTHER_DIR);
  });

  test("G11 a denied Edit in another repo records no branch for that repo", async ($, on) => {
    const world = await worldOf($, on);
    world.willAnswer(DENIED_EDIT);

    await editOf($, OTHER_FILE);

    expect(JSON.stringify(branchesWritten(world))).not.toContain(OTHER_DIR);
  });

  test("G13 a failed Edit in another repo, then a commit, records no branch for that repo", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    world.willAnswer(FAILED_EDIT);
    await editOf($, OTHER_FILE);

    await bash($, "git commit -m x");

    expect(JSON.stringify(branchesWritten(world))).not.toContain(OTHER_DIR);
  });

  test("G14 (GH-145 A3) a successful Bash command that wrote a file in another repo, then a commit, tracks that repo's branch", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    world.willAnswer(bashWrote(OTHER_FILE));
    await bash($, `echo b > ${OTHER_FILE}`);

    await bash($, "git commit -m x");

    expect(lastWritten(world, "gitBranches")).toEqual(
      expect.objectContaining({ [OTHER_DIR]: MAIN_BRANCH }),
    );
  });

  test("G15 (GH-145 A4) a Bash command that wrote a file in another repo and then failed, then a commit, tracks no branch for that repo", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    world.willAnswer(failedBashWrote(OTHER_FILE));
    await bash($, `echo b > ${OTHER_FILE} && exit 1`);

    await bash($, "git commit -m x");

    expect(JSON.stringify(branchesWritten(world))).not.toContain(OTHER_DIR);
  });

  test("G16 a save to a session repo file recounts it against that repo's own base after a merge in a nested repo", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    world.willMerge(NESTED_DIR, FIRST_MERGE_HEAD, {
      numstat: numstatLine(NESTED_ADDED, NESTED_REMOVED, NESTED_PATH),
      subjects: mergeSubject(FEATURE_BRANCH),
    });
    await bash($, `git -C ${NESTED_DIR} merge ${FEATURE_BRANCH}`);
    world.willMerge(WORK_DIR, SECOND_MERGE_HEAD, {
      numstat: numstatLine(ADDED, REMOVED, TRACKED_PATH),
      subjects: mergeSubject(OTHER_FEATURE),
    });
    await bash($, `git merge ${OTHER_FEATURE}`);
    world.willWorkingDiff(
      WORK_DIR,
      START_HEAD,
      numstatLine(RECOUNT_ADDED, RECOUNT_REMOVED, TRACKED_PATH),
    );

    await $.classic.FileChanged({ file_path: TRACKED_FILE, event: "change" });

    const row = (lastWritten(world, "gitChanges") as GitRow[]).find(
      (change) => change.target === TRACKED_FILE,
    );
    expect(row).toEqual(
      expect.objectContaining({ added: RECOUNT_ADDED, removed: RECOUNT_REMOVED }),
    );
  });

  test("G12 a successful Edit in another repo records that repo's branch", async ($, on) => {
    const world = await worldOf($, on);

    await editOf($, OTHER_FILE);

    expect(lastWritten(world, "gitBranches")).toEqual(
      expect.objectContaining({ [OTHER_DIR]: MAIN_BRANCH }),
    );
  });
});

type GitRow = { target: string; added: number; removed: number };

async function worldOf($: Engine, on: On): Promise<World> {
  mock.clock(on);
  mock.env(on, { HOME: HOME_DIR });
  const writes: Write[] = [];
  const stored = new Map<string, unknown>();
  const repos = new Map<string, Repo>([
    [WORK_DIR, { head: START_HEAD, branch: MAIN_BRANCH }],
    [OTHER_DIR, { head: OTHER_HEAD, branch: MAIN_BRANCH }],
    [NESTED_DIR, { head: NESTED_START, branch: MAIN_BRANCH }],
  ]);
  const landings = new Map<string, Landing>();
  const workingDiffs = new Map<string, string>();
  let effect = NO_EFFECT;

  on("state.set", (_$, e, next) => {
    writes.push({ key: e.key, value: e.value });
    return next(e);
  });
  on("store.get", (_$, e) => ({ value: stored.get(e.key) }));
  on("store.set", (_$, e) => {
    stored.set(e.key, e.value);
    return { value: undefined };
  });
  on("session.cwd", () => ({ value: WORK_DIR }));
  on("session.repo", () => ({ value: null }));
  on("session.root", () => ({ value: WORK_DIR }));
  on("session.id", () => ({ value: "s1" }));
  on("store.keys", () => ({ value: [...stored.keys()] }));
  on("store.delete", (_$, e) => {
    stored.delete(e.key);
    return { value: undefined };
  });
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("classic.SessionStart", () => ({}));
  on("classic.FileChanged", () => ({}));
  on("session.model", () => ({ value: MODEL }));
  on("settings.read", () => ({ value: {} }));
  on("process.run", (_$, e) => ({ value: runGit(e.argv, repos, landings, workingDiffs) }) as never);
  let answer: Verdict = TOOL_RESULT;
  on("tool.call", () => {
    effect();
    effect = NO_EFFECT;
    const verdict = answer;
    answer = TOOL_RESULT;
    return verdict;
  });

  return {
    writes,
    willAnswer: (verdict) => {
      answer = verdict;
    },
    willMerge: (root, head, landing) => {
      effect = () => {
        landings.set(head, landing);
        moveHead(repos, root, head);
      };
    },
    willWorkingDiff: (root, base, numstat) => {
      workingDiffs.set(`${root} ${base}`, numstat);
    },
    willCheckout: (root, branch) => {
      effect = () => {
        const repo = repos.get(root);
        if (repo !== undefined) repos.set(root, { ...repo, branch });
      };
    },
  };
}

function moveHead(repos: Map<string, Repo>, root: string, head: string): void {
  const repo = repos.get(root);
  if (repo !== undefined) repos.set(root, { ...repo, head });
}

function runGit(
  argv: readonly string[],
  repos: Map<string, Repo>,
  landings: Map<string, Landing>,
  workingDiffs: Map<string, string>,
): { exitCode: number; stdout: string; stderr: string } {
  if (argv[0] !== "git") return reply(0, "");
  const root = rootOf(argv[2] ?? "", repos);
  const repo = root === undefined ? undefined : repos.get(root);
  if (root === undefined || repo === undefined) return reply(NOT_A_REPO, "");
  const args = argv.slice(3).join(" ");
  return reply(0, answerOf(args, root, repo, landings, workingDiffs));
}

function answerOf(
  args: string,
  root: string,
  repo: Repo,
  landings: Map<string, Landing>,
  workingDiffs: Map<string, string>,
): string {
  if (args === "rev-parse --show-toplevel") return root;
  if (args === "rev-parse --show-toplevel HEAD") return `${root}\n${repo.head}`;
  if (args === "rev-parse --show-toplevel HEAD --abbrev-ref HEAD")
    return `${root}\n${repo.head}\n${repo.branch}`;
  if (args === "rev-parse --abbrev-ref HEAD") return repo.branch;
  if (args === "rev-parse --short HEAD") return repo.head;
  const tokens = args.split(" ");
  const head = tokens.at(-1) ?? "";
  if (args.startsWith("diff --name-only")) return pathsOf(landings.get(head)?.numstat ?? "");
  if (args.startsWith("diff --no-renames --numstat -z"))
    return countsAgainst(
      tokens,
      workingDiffs.get(`${root} ${tokens[4]}`) ?? landings.get(repo.head)?.numstat ?? "",
    );
  if (args.startsWith("diff --no-renames --name-status -z")) return "";
  if (args.startsWith("ls-files")) return "";
  if (args.startsWith("log -g")) return landings.get(head.split("..").at(-1) ?? "")?.subjects ?? "";
  return "";
}

function pathsOf(numstat: string): string {
  return numstat
    .split("\n")
    .map((line) => line.split("\t")[2] ?? "")
    .filter((path) => path !== "")
    .join("\n");
}

function countsAgainst(tokens: string[], numstat: string): string {
  const asked = tokens.slice(tokens.indexOf("--") + 1);
  return numstat
    .split("\n")
    .filter((line) => asked.includes(line.split("\t")[2] ?? ""))
    .map((line) => `${line}\0`)
    .join("");
}

function rootOf(dir: string, repos: Map<string, Repo>): string | undefined {
  return [...repos.keys()]
    .filter((root) => dir === root || dir.startsWith(`${root}/`))
    .sort((a, b) => b.length - a.length)[FIRST];
}

function reply(
  exitCode: number,
  stdout: string,
): { exitCode: number; stdout: string; stderr: string } {
  return { exitCode, stdout, stderr: "" };
}

function numstatLine(added: number, removed: number, path: string): string {
  return `${added}\t${removed}\t${path}\n`;
}

function mergeSubject(branch: string): string {
  return `merge ${branch}: ${FAST_FORWARD}`;
}

async function bash($: Engine, command: string): Promise<unknown> {
  return $.tool.call({ tool: "Bash", command, tool_use_id: command } as never);
}

async function writesDuring(world: World, act: () => Promise<unknown>): Promise<Write[]> {
  const before = world.writes.length;
  await act();
  return world.writes.slice(before);
}

function keysOf(writes: Write[]): string[] {
  return writes.map((write) => write.key);
}

function lastWritten(world: World, key: string): unknown {
  return world.writes.filter((write) => write.key === key).at(-1)?.value;
}

async function editOf($: Engine, file: string): Promise<unknown> {
  return $.tool.call({
    tool: "Edit",
    file_path: file,
    old_string: "a",
    new_string: "b",
    tool_use_id: file,
  } as never);
}

function bashWrote(filePath: string): Verdict {
  return { result: bashEditResult(filePath), text: "ok" };
}

function failedBashWrote(filePath: string): Verdict {
  return { isError: true, result: bashEditResult(filePath), text: BASH_FAILURE };
}

function bashEditResult(filePath: string): unknown {
  return {
    stdout: "",
    stderr: "",
    interrupted: false,
    bashEditDiff: {
      files: [
        {
          filePath,
          hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-a", "+b"] }],
        },
      ],
      moreFiles: 0,
    },
  };
}

function branchesWritten(world: World): unknown[] {
  return world.writes.filter((write) => write.key === "gitBranches").map((write) => write.value);
}
