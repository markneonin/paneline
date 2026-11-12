import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

type Repo = { head: string; branch: string };
type Write = { key: string; value: unknown };
type Counts = Record<string, number>;
type World = {
  writes: Write[];
  revParses: () => Counts;
  revParsesAtCommit: () => Counts;
  settle: () => Promise<void>;
  willCommit: (root: string, head: string, numstat: string) => void;
  initRepo: (dir: string, repo: Repo) => void;
};
type Reply = { exitCode: number; stdout: string; stderr: string };

const HOME_DIR = "/Users/dev";
const FIRST_ROOT = "/Users/dev/one";
const SECOND_ROOT = "/Users/dev/two";
const THIRD_ROOT = "/Users/dev/three";
const SESSION_DIR = `${FIRST_ROOT}/app`;
const DEEP_DIR = `${SESSION_DIR}/deep`;
const SESSION_START = { cwd: SESSION_DIR, surface: "terminal", isInteractive: true } as const;
const ROOT_START = { cwd: FIRST_ROOT, surface: "terminal", isInteractive: true } as const;
const MODEL = "claude-opus-5-5";
const MAIN_BRANCH = "main";
const DETACHED = "HEAD";
const START_HEAD = "aaaaaaa1";
const COMMIT_HEAD = "bbbbbbb2";
const SECOND_HEAD = "ccccccc3";
const THIRD_HEAD = "ddddddd4";
const DETACHED_HEAD = "eeeeeee5";
const NEW_REPO_START = "f0000006";
const NEW_REPO_COMMIT = "f0000007";
const COMMITTED_PATH = "src/a.ts";
const ADDED = 4;
const REMOVED = 2;
const COMMIT = "git commit -m x";
const BEHIND = 0;
const AHEAD = 1;
const UPSTREAM_COUNTS = `${BEHIND}\t${AHEAD}`;
const GITHUB_URL = "git@github.com:acme/app.git";
const NO_PULL_REQUESTS = JSON.stringify({ data: { repository: { pullRequests: { nodes: [] } } } });
const NOT_A_REPO = 128;
const FIRST = 0;
const TOOL_RESULT = { result: "ok", text: "ok" };
const ONCE_EACH_THREE_REPOS: Counts = { [FIRST_ROOT]: 1, [SECOND_ROOT]: 1, [THIRD_ROOT]: 1 };
const REMOTES_OF_THREE_REPOS = {
  [FIRST_ROOT]: { branch: MAIN_BRANCH, ahead: AHEAD, behind: BEHIND, review: null },
  [SECOND_ROOT]: { branch: MAIN_BRANCH, ahead: AHEAD, behind: BEHIND, review: null },
  [THIRD_ROOT]: { branch: MAIN_BRANCH, ahead: AHEAD, behind: BEHIND, review: null },
};

describe("git calls of a git-moving Bash call", () => {
  test("A1 a commit from a subfolder of its repo, after edits in that repo and two others, reads each repo once before and once after", async ($, on) => {
    const world = await worldOf($, on, threeRepos());
    await $.session.start(SESSION_START);
    await editOf($, `${DEEP_DIR}/main.ts`);
    await editOf($, `${SECOND_ROOT}/x.ts`);
    await editOf($, `${THIRD_ROOT}/y.ts`);
    await world.settle();
    world.willCommit(FIRST_ROOT, COMMIT_HEAD, `${ADDED}\t${REMOVED}\t${COMMITTED_PATH}\n`);
    const beforeCommit = world.revParses();

    await bash($, COMMIT);

    expect(difference(beforeCommit, world.revParsesAtCommit())).toEqual(ONCE_EACH_THREE_REPOS);
    expect(difference(world.revParsesAtCommit(), world.revParses())).toEqual(ONCE_EACH_THREE_REPOS);
    expect(lastWritten(world, "gitChanges")).toEqual([
      {
        target: `${FIRST_ROOT}/${COMMITTED_PATH}`,
        added: ADDED,
        removed: REMOVED,
        label: "merged",
        base: START_HEAD,
        landedBy: [COMMIT],
      },
    ]);
  });

  test("A2 a stop from a subfolder of a repo, with two other repos edited, reads each repo once and shows each repo's branch", async ($, on) => {
    const world = await worldOf($, on, threeRepos());
    await $.session.start(SESSION_START);
    await editOf($, `${DEEP_DIR}/main.ts`);
    await editOf($, `${SECOND_ROOT}/x.ts`);
    await editOf($, `${THIRD_ROOT}/y.ts`);
    await world.settle();
    const beforeStop = world.revParses();

    await $.classic.Stop({ stop_hook_active: false });
    await world.settle();

    expect(difference(beforeStop, world.revParses())).toEqual(ONCE_EACH_THREE_REPOS);
    expect(lastWritten(world, "remote")).toEqual(REMOTES_OF_THREE_REPOS);
  });

  test("A3 a commit in a folder that became its own repo is credited to that repo, not to the repo it was in before", async ($, on) => {
    const world = await worldOf(
      $,
      on,
      new Map([[FIRST_ROOT, { head: START_HEAD, branch: MAIN_BRANCH }]]),
    );
    await $.session.start(SESSION_START);
    await editOf($, `${SESSION_DIR}/main.ts`);
    await world.settle();
    world.initRepo(SESSION_DIR, { head: NEW_REPO_START, branch: MAIN_BRANCH });
    world.willCommit(SESSION_DIR, NEW_REPO_COMMIT, `${ADDED}\t${REMOVED}\t${COMMITTED_PATH}\n`);

    await bash($, COMMIT);

    expect(lastWritten(world, "gitChanges")).toEqual([
      {
        target: `${SESSION_DIR}/${COMMITTED_PATH}`,
        added: ADDED,
        removed: REMOVED,
        label: "merged",
        base: NEW_REPO_START,
        landedBy: [COMMIT],
      },
    ]);
  });

  test("A4 a stop from a repo root, with two other repos edited, reads each repo once and shows each repo's branch", async ($, on) => {
    const world = await worldOf($, on, threeRepos(), FIRST_ROOT);
    await $.session.start(ROOT_START);
    await editOf($, `${SESSION_DIR}/main.ts`);
    await editOf($, `${SECOND_ROOT}/x.ts`);
    await editOf($, `${THIRD_ROOT}/y.ts`);
    await world.settle();
    const beforeStop = world.revParses();

    await $.classic.Stop({ stop_hook_active: false });
    await world.settle();

    expect(difference(beforeStop, world.revParses())).toEqual(ONCE_EACH_THREE_REPOS);
    expect(lastWritten(world, "remote")).toEqual(REMOTES_OF_THREE_REPOS);
  });

  test("P1-2 a commit in a repo with a detached HEAD labels it with the short commit sha", async ($, on) => {
    const world = await worldOf(
      $,
      on,
      new Map([[FIRST_ROOT, { head: DETACHED_HEAD, branch: DETACHED }]]),
    );
    await $.session.start(SESSION_START);
    await editOf($, `${SESSION_DIR}/main.ts`);

    await bash($, COMMIT);

    expect(lastWritten(world, "gitBranches")).toEqual({ [FIRST_ROOT]: DETACHED_HEAD });
  });
});

function threeRepos(): Map<string, Repo> {
  return new Map([
    [FIRST_ROOT, { head: START_HEAD, branch: MAIN_BRANCH }],
    [SECOND_ROOT, { head: SECOND_HEAD, branch: MAIN_BRANCH }],
    [THIRD_ROOT, { head: THIRD_HEAD, branch: MAIN_BRANCH }],
  ]);
}

async function worldOf(
  $: Engine,
  on: On,
  repos: Map<string, Repo>,
  cwd: string = SESSION_DIR,
): Promise<World> {
  const clock = mock.clock(on);
  mock.env(on, { HOME: HOME_DIR });
  const writes: Write[] = [];
  const stored = new Map<string, unknown>();
  const landings = new Map<string, string>();
  const revParses: Counts = {};
  let atCommit: Counts = {};
  let effect = (): void => undefined;

  on("state.set", (_$, e, next) => {
    writes.push({ key: e.key, value: e.value });
    return next(e);
  });
  on("store.get", (_$, e) => ({ value: stored.get(e.key) }));
  on("store.set", (_$, e) => {
    stored.set(e.key, e.value);
    return { value: undefined };
  });
  on("session.cwd", () => ({ value: cwd }));
  on("session.repo", () => ({ value: null }));
  on("session.root", () => ({ value: FIRST_ROOT }));
  on("session.id", () => ({ value: "s1" }));
  on("store.keys", () => ({ value: [...stored.keys()] }));
  on("store.delete", (_$, e) => {
    stored.delete(e.key);
    return { value: undefined };
  });
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("classic.SessionStart", () => ({}));
  on("classic.Stop", () => ({}));
  on("session.model", () => ({ value: MODEL }));
  on("settings.read", () => ({ value: {} }));
  on("process.run", (_$, e) => {
    if (e.argv[0] === "git" && e.argv[3] === "rev-parse") {
      const dir = e.argv[2] ?? "";
      const repo = rootOf(dir, repos) ?? dir;
      revParses[repo] = (revParses[repo] ?? 0) + 1;
    }
    return { value: runGit(e.argv, repos, landings) } as never;
  });
  on("tool.call", () => {
    effect();
    effect = () => undefined;
    return TOOL_RESULT;
  });

  return {
    writes,
    revParses: () => ({ ...revParses }),
    revParsesAtCommit: () => atCommit,
    settle: () => clock.settle(),
    willCommit: (root, head, numstat) => {
      effect = () => {
        atCommit = { ...revParses };
        landings.set(head, numstat);
        const repo = repos.get(root);
        if (repo !== undefined) repos.set(root, { ...repo, head });
      };
    },
    initRepo: (dir, repo) => {
      repos.set(dir, repo);
    },
  };
}

function runGit(
  argv: readonly string[],
  repos: Map<string, Repo>,
  landings: Map<string, string>,
): Reply {
  if (argv[0] === "gh") return reply(0, NO_PULL_REQUESTS);
  if (argv[0] !== "git") return reply(0, "");
  const root = rootOf(argv[2] ?? "", repos);
  const repo = root === undefined ? undefined : repos.get(root);
  if (root === undefined || repo === undefined) return reply(NOT_A_REPO, "");
  return reply(0, answerOf(argv.slice(3).join(" "), root, repo, landings));
}

function answerOf(args: string, root: string, repo: Repo, landings: Map<string, string>): string {
  if (args === "rev-parse --show-toplevel") return root;
  if (args === "rev-parse --show-toplevel HEAD") return `${root}\n${repo.head}`;
  if (args === "rev-parse --show-toplevel HEAD --abbrev-ref HEAD")
    return `${root}\n${repo.head}\n${repo.branch}`;
  if (args === "rev-parse --abbrev-ref HEAD") return repo.branch;
  if (args === "rev-parse --short HEAD") return repo.head;
  const head = (args.split(" ").at(-1) ?? "").split("..").at(-1) ?? "";
  if (args === "ls-remote --get-url") return GITHUB_URL;
  if (args.startsWith("rev-list")) return UPSTREAM_COUNTS;
  const landed = landings.get(repo.head) ?? "";
  if (args.startsWith("diff --name-only")) return pathsOf(landings.get(head) ?? "");
  if (args.startsWith("diff --no-renames --numstat -z")) return nulSeparated(landed);
  return "";
}

function pathsOf(numstat: string): string {
  return numstat
    .split("\n")
    .map((line) => line.split("\t")[2] ?? "")
    .filter((path) => path !== "")
    .join("\n");
}

function nulSeparated(numstat: string): string {
  return numstat
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => `${line}\0`)
    .join("");
}

function rootOf(dir: string, repos: Map<string, Repo>): string | undefined {
  return [...repos.keys()]
    .filter((root) => dir === root || dir.startsWith(`${root}/`))
    .sort((a, b) => b.length - a.length)[FIRST];
}

function difference(from: Counts, to: Counts): Counts {
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  return Object.fromEntries(
    [...keys]
      .map((key) => [key, (to[key] ?? 0) - (from[key] ?? 0)] as const)
      .filter(([, count]) => count !== 0),
  );
}

function reply(exitCode: number, stdout: string): Reply {
  return { exitCode, stdout, stderr: "" };
}

async function bash($: Engine, command: string): Promise<unknown> {
  return $.tool.call({ tool: "Bash", command, tool_use_id: command } as never);
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

function lastWritten(world: World, key: string): unknown {
  return world.writes.filter((write) => write.key === key).at(-1)?.value;
}
