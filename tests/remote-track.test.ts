import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, MockClock } from "claude-code/testing";

import { paneOnTab, showTab } from "./clear-world";
import { textOf } from "./draw-tree";

type Write = { key: string; value: unknown };
type Call = { argv: readonly string[]; cwd: string | undefined };
type Answer =
  | { kind: "json"; body: unknown }
  | { kind: "text"; stdout: string; exitCode: number }
  | { kind: "missing" };
type Forge = { url: string; github: Answer; mrView: Answer; discussions: Answer };
type Repo = { branch: string; counts: string | null; forge: Forge };
type World = { clock: MockClock; writes: Write[]; calls: Call[]; repos: Map<string, Repo> };
type Rollup = "SUCCESS" | "FAILURE" | "PENDING" | null;

const HOME_DIR = "/Users/dev";
const WORK_DIR = "/Users/dev/IT";
const OTHER_DIR = "/Users/dev/other";
const SESSION_START = { cwd: WORK_DIR, surface: "terminal", isInteractive: true } as const;
const FEATURE_BRANCH = "feature/x";
const OTHER_BRANCH = "feature/z";
const GITHUB_URL = "git@github.com:acme/app.git";
const GITLAB_URL = "git@gitlab.com:acme/app.git";
const BEHIND = 2;
const AHEAD = 3;
const COUNTS = `${BEHIND}\t${AHEAD}`;
const PR_NUMBER = 42;
const OTHER_PR_NUMBER = 7;
const MR_IID = 9;
const ONE_UNRESOLVED = 1;
const NO_UNRESOLVED = 0;
const NOT_A_REPO = 128;
const FAILED = 1;
const HEAD_SHA = "abc123";
const AGENT_ID = "agent-1";
const ONE_HOUR_MS = 3_600_000;
const SESSION_ID = "session-1";
const MODEL = "claude-opus-5-5";
const NO_REVIEW = null;
const FILES_LABEL = "Files";
const FIRST = 0;
const NESTED_NAME = "services/api";
const NESTED_DIR = `${WORK_DIR}/${NESTED_NAME}`;
const NESTED_BRANCH = "feature/nested";
const NESTED_PR_NUMBER = 11;
const NEW_BRANCH = "main";
const KEPT_PR_TEXT = "PR #42 · CI pass · 1 thread";
const KEPT_MR_TEXT = "MR !9 · CI fail · 1 thread";
const NO_REVIEW_TEXT = "no PR/MR";
const WORK_COUNTS_TEXT = "↑3 ↓2";
const FORK_PR_NUMBER = 77;
const FORK_NAME_WITH_OWNER = "fork-owner/app";
const REPO_NAME_WITH_OWNER = "acme/app";

describe("remote tracker", () => {
  test("R1 after git push on a GitHub branch the remote data shows branch, ahead and behind, PR number, CI and unresolved threads", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);

    await bash($, world, "git push");

    expect(lastWritten(world, "remote")).toEqual({
      [WORK_DIR]: {
        branch: FEATURE_BRANCH,
        ahead: AHEAD,
        behind: BEHIND,
        review: { kind: "PR", number: PR_NUMBER, ci: "pass", threads: ONE_UNRESOLVED },
      },
    });
  });

  test("R2 after git -C another repo push that repo gets its own row", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);

    await bash($, world, `git -C ${OTHER_DIR} push`);

    expect(remoteRows(world)[OTHER_DIR]).toEqual({
      branch: OTHER_BRANCH,
      ahead: AHEAD,
      behind: BEHIND,
      review: { kind: "PR", number: OTHER_PR_NUMBER, ci: "pass", threads: NO_UNRESOLVED },
    });
  });

  test("R3 after a glab call on a GitLab branch the remote data shows MR number, pipeline CI and unresolved discussions", async ($, on) => {
    const world = await worldOf($, on, { [WORK_DIR]: { forge: gitlabForge("failed") } });
    await $.session.start(SESSION_START);

    await bash($, world, "glab mr view");

    expect(remoteRows(world)[WORK_DIR]?.review).toEqual({
      kind: "MR",
      number: MR_IID,
      ci: "fail",
      threads: ONE_UNRESOLVED,
    });
  });

  test("R4 a branch with no open PR shows no review but still its ahead and behind", async ($, on) => {
    const world = await worldOf($, on, { [WORK_DIR]: { forge: githubForge(noPullRequest()) } });
    await $.session.start(SESSION_START);

    await bash($, world, "git push");

    expect(remoteRows(world)[WORK_DIR]).toEqual({
      branch: FEATURE_BRANCH,
      ahead: AHEAD,
      behind: BEHIND,
      review: NO_REVIEW,
    });
  });

  test("R5 a branch with no upstream shows no ahead and behind and runs no gh or glab command", async ($, on) => {
    const world = await worldOf($, on, { [WORK_DIR]: { counts: null } });
    await $.session.start(SESSION_START);

    await bash($, world, "git push");

    expect(remoteRows(world)[WORK_DIR]).toEqual({
      branch: FEATURE_BRANCH,
      ahead: null,
      behind: null,
      review: NO_REVIEW,
    });
    expect(forgeCalls(world)).toEqual([]);
  });

  test("R6 a Stop of the main agent refreshes the remote data", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);

    await $.classic.Stop({ stop_hook_active: false });
    await world.clock.settle();

    expect(remoteRows(world)[WORK_DIR]?.review?.number).toBe(PR_NUMBER);
  });

  test("R6 a Stop of a subagent does not refresh the remote data", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);

    await pushed($, world);
    const before = world.calls.length;

    await $.classic.Stop({ stop_hook_active: false, agent_id: AGENT_ID });
    await world.clock.settle();

    expect(world.calls.slice(before)).toEqual([]);
  });

  test("R7 opening the Files tab refreshes the remote data", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    const pane = await paneOnTab($, "Activity");

    await showTab(pane, FILES_LABEL);
    await world.clock.settle();

    expect(remoteRows(world)[WORK_DIR]?.review?.number).toBe(PR_NUMBER);
  });

  test("R8 a git status runs no remote command", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    await pushed($, world);
    const before = world.calls.length;

    await bash($, world, "git status");

    expect(remoteCalls(world.calls.slice(before))).toEqual([]);
  });

  test("R8 an ls runs no remote command", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    await pushed($, world);
    const before = world.calls.length;

    await bash($, world, "ls");

    expect(remoteCalls(world.calls.slice(before))).toEqual([]);
  });

  test("R9 an hour passing with no event runs no command", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    await pushed($, world);
    const before = world.calls.length;

    await world.clock.advance(ONE_HOUR_MS);

    expect(world.calls.slice(before)).toEqual([]);
  });

  test("R10a a SUCCESS check rollup shows CI pass", async ($, on) => {
    const world = await worldOf($, on, {
      [WORK_DIR]: { forge: githubForge(pullRequest("SUCCESS")) },
    });
    await $.session.start(SESSION_START);

    await bash($, world, "git push");

    expect(remoteRows(world)[WORK_DIR]?.review?.ci).toBe("pass");
  });

  test("R10b a FAILURE check rollup shows CI fail", async ($, on) => {
    const world = await worldOf($, on, {
      [WORK_DIR]: { forge: githubForge(pullRequest("FAILURE")) },
    });
    await $.session.start(SESSION_START);

    await bash($, world, "git push");

    expect(remoteRows(world)[WORK_DIR]?.review?.ci).toBe("fail");
  });

  test("R10c a PENDING check rollup shows CI pending", async ($, on) => {
    const world = await worldOf($, on, {
      [WORK_DIR]: { forge: githubForge(pullRequest("PENDING")) },
    });
    await $.session.start(SESSION_START);

    await bash($, world, "git push");

    expect(remoteRows(world)[WORK_DIR]?.review?.ci).toBe("pending");
  });

  test("R10d a PR with no check rollup shows CI none", async ($, on) => {
    const world = await worldOf($, on, { [WORK_DIR]: { forge: githubForge(pullRequest(null)) } });
    await $.session.start(SESSION_START);

    await bash($, world, "git push");

    expect(remoteRows(world)[WORK_DIR]?.review?.ci).toBe("none");
  });

  test("R11 when gh is not installed the PR, CI and threads already shown stay on the row", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    await pushed($, world);
    forgeOf(world, WORK_DIR, { github: { kind: "missing" } });

    const drawn = await blockAfterStop($, world);

    expect(drawn).toContain(KEPT_PR_TEXT);
    expect(drawn).toContain(WORK_COUNTS_TEXT);
  });

  test("R12 when gh answers with text that is not JSON the PR, CI and threads already shown stay on the row", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    await pushed($, world);
    forgeOf(world, WORK_DIR, {
      github: { kind: "text", stdout: "gh: please log in", exitCode: 0 },
    });

    const drawn = await blockAfterStop($, world);

    expect(drawn).toContain(KEPT_PR_TEXT);
  });

  test("R12 when gh exits with an error the PR, CI and threads already shown stay on the row", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    await pushed($, world);
    forgeOf(world, WORK_DIR, { github: { kind: "text", stdout: "", exitCode: FAILED } });

    const drawn = await blockAfterStop($, world);

    expect(drawn).toContain(KEPT_PR_TEXT);
  });

  test("R20 when gh fails and nothing is known about the branch the row shows branch and counts and no claim about a PR", async ($, on) => {
    const world = await worldOf($, on, {
      [WORK_DIR]: { forge: githubForge({ kind: "text", stdout: "", exitCode: FAILED }) },
    });
    await $.session.start(SESSION_START);

    await bash($, world, "git push");
    const drawn = await blockAfterStop($, world);

    expect(drawn).toContain(WORK_COUNTS_TEXT);
    expect(drawn).toContain(FEATURE_BRANCH);
    expect(drawn).not.toContain(NO_REVIEW_TEXT);
    expect(drawn).not.toContain("PR #");
  });

  test("R21 when the branch changed and gh fails the old PR is not shown for the new branch and no PR/MR is not claimed", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    await pushed($, world);
    forgeOf(world, WORK_DIR, { github: { kind: "missing" } });
    checkout(world, WORK_DIR, NEW_BRANCH);

    const drawn = await blockAfterStop($, world);

    expect(drawn).toContain(NEW_BRANCH);
    expect(drawn).not.toContain("PR #");
    expect(drawn).not.toContain(NO_REVIEW_TEXT);
  });

  test("R22 when gh answers that the branch has no PR any more the row shows no PR/MR", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    await pushed($, world);
    forgeOf(world, WORK_DIR, { github: noPullRequest() });

    const drawn = await blockAfterStop($, world);

    expect(drawn).toContain(NO_REVIEW_TEXT);
    expect(drawn).not.toContain("PR #");
  });

  test("R23 when glab mr view fails the MR, CI and threads already shown stay on the row", async ($, on) => {
    const world = await worldOf($, on, { [WORK_DIR]: { forge: gitlabForge("failed") } });
    await $.session.start(SESSION_START);
    await bash($, world, "glab mr view");
    forgeOf(world, WORK_DIR, { mrView: { kind: "text", stdout: "", exitCode: FAILED } });

    const drawn = await blockAfterStop($, world);

    expect(drawn).toContain(KEPT_MR_TEXT);
  });

  test("R24 when glab answers that the branch has no MR the row shows no PR/MR", async ($, on) => {
    const world = await worldOf($, on, { [WORK_DIR]: { forge: gitlabForge("failed") } });
    await $.session.start(SESSION_START);
    await bash($, world, "glab mr view");
    forgeOf(world, WORK_DIR, { mrView: { kind: "json", body: {} } });

    const drawn = await blockAfterStop($, world);

    expect(drawn).toContain(NO_REVIEW_TEXT);
    expect(drawn).not.toContain("MR !");
  });

  test("R25 when glab mr view fails and nothing is known about the branch the row says nothing about an MR", async ($, on) => {
    const world = await worldOf($, on, {
      [WORK_DIR]: {
        forge: { ...gitlabForge("failed"), mrView: { kind: "text", stdout: "", exitCode: FAILED } },
      },
    });
    await $.session.start(SESSION_START);

    await bash($, world, "glab mr view");
    const drawn = await blockAfterStop($, world);

    expect(drawn).toContain(WORK_COUNTS_TEXT);
    expect(drawn).not.toContain(NO_REVIEW_TEXT);
    expect(drawn).not.toContain("MR !");
  });

  test("R26 when glab exits with its no open merge request answer and nothing is stored the row shows no PR/MR", async ($, on) => {
    const world = await worldOf($, on, {
      [WORK_DIR]: { forge: { ...gitlabForge("failed"), mrView: noMergeRequestAnswer() } },
    });
    await $.session.start(SESSION_START);

    await bash($, world, "glab mr view");
    const drawn = await blockAfterStop($, world);

    expect(drawn).toContain(NO_REVIEW_TEXT);
    expect(drawn).not.toContain("MR !");
  });

  test("R27 when the MR already shown is gone and glab exits with its no open merge request answer the row shows no PR/MR", async ($, on) => {
    const world = await worldOf($, on, { [WORK_DIR]: { forge: gitlabForge("failed") } });
    await $.session.start(SESSION_START);
    await bash($, world, "glab mr view");
    forgeOf(world, WORK_DIR, { mrView: noMergeRequestAnswer() });

    const drawn = await blockAfterStop($, world);

    expect(drawn).toContain(NO_REVIEW_TEXT);
    expect(drawn).not.toContain("MR !");
  });

  test("R28 when glab answers the MR but the discussions call fails the thread count already shown stays on the row", async ($, on) => {
    const world = await worldOf($, on, { [WORK_DIR]: { forge: gitlabForge("failed") } });
    await $.session.start(SESSION_START);
    await bash($, world, "glab mr view");
    forgeOf(world, WORK_DIR, { discussions: { kind: "text", stdout: "", exitCode: FAILED } });

    const drawn = await blockAfterStop($, world);

    expect(drawn).toContain(KEPT_MR_TEXT);
  });

  test("R14 a repo whose folder is gone drops out of the remote data while a repo still there keeps its row", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    await bash($, world, `git -C ${OTHER_DIR} push`);
    expect(Object.keys(remoteRows(world)).sort()).toEqual([OTHER_DIR, WORK_DIR].sort());
    world.repos.delete(OTHER_DIR);

    await $.classic.Stop({ stop_hook_active: false });
    await world.clock.settle();

    expect(Object.keys(remoteRows(world))).toEqual([WORK_DIR]);
  });

  test("R13 a Stop when nothing changed on the remote writes no remote data", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    await pushed($, world);
    const before = world.writes.length;
    await $.classic.Stop({ stop_hook_active: false });
    await world.clock.settle();

    expect(keysOf(world.writes.slice(before))).not.toContain("remote");
  });

  test("R15 a Stop of the main agent after a stop hook ran still refreshes the remote data", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);

    await $.classic.Stop({ stop_hook_active: true });
    await world.clock.settle();

    expect(remoteRows(world)[WORK_DIR]?.review?.number).toBe(PR_NUMBER);
  });

  test("R16a a git commit whose message says push runs no remote command", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    await pushed($, world);
    const before = world.calls.length;

    await bash($, world, 'git commit -m "push it"');

    expect(remoteCalls(world.calls.slice(before))).toEqual([]);
  });

  test("R16b a git stash push runs no remote command", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    await pushed($, world);
    const before = world.calls.length;

    await bash($, world, "git stash push");

    expect(remoteCalls(world.calls.slice(before))).toEqual([]);
  });

  test("R16c a git log searching for push runs no remote command", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    await pushed($, world);
    const before = world.calls.length;

    await bash($, world, "git log --grep=push");

    expect(remoteCalls(world.calls.slice(before))).toEqual([]);
  });

  test("R17 a gh call behind an environment variable refreshes the remote data", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);

    await bash($, world, "GH_TOKEN=x gh pr view");

    expect(remoteRows(world)[WORK_DIR]?.review?.number).toBe(PR_NUMBER);
  });

  test("R18 a cd into another repo followed by git push gives that repo its row", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);

    await bash($, world, `cd ${OTHER_DIR} && git push`);

    expect(remoteRows(world)[OTHER_DIR]?.review?.number).toBe(OTHER_PR_NUMBER);
  });

  test("R19 git -C with a relative folder gives the repo under the session folder its row", async ($, on) => {
    const world = await worldOf($, on);
    world.repos.set(NESTED_DIR, repoOf(NESTED_BRANCH, NESTED_PR_NUMBER));
    await $.session.start(SESSION_START);

    await bash($, world, `git -C ${NESTED_NAME} push`);

    expect(remoteRows(world)[NESTED_DIR]?.review?.number).toBe(NESTED_PR_NUMBER);
  });

  test("R29 when the only open PR with the branch name is from a fork the row shows branch and counts and no PR/MR", async ($, on) => {
    const world = await worldOf($, on, {
      [WORK_DIR]: { forge: githubForge(graphql([forkNode()])) },
    });
    await $.session.start(SESSION_START);

    await bash($, world, "git push");

    expect(remoteRows(world)[WORK_DIR]).toEqual({
      branch: FEATURE_BRANCH,
      ahead: AHEAD,
      behind: BEHIND,
      review: NO_REVIEW,
    });
  });

  test("R30 when a fork's PR with the branch name is listed before the repo's own PR the row shows the repo's PR number", async ($, on) => {
    const world = await worldOf($, on, {
      [WORK_DIR]: { forge: githubForge(graphql([forkNode(), ownNode()])) },
    });
    await $.session.start(SESSION_START);

    await bash($, world, "git push");

    expect(remoteRows(world)[WORK_DIR]?.review?.number).toBe(PR_NUMBER);
  });
});

function forkNode(): unknown {
  return {
    number: FORK_PR_NUMBER,
    isCrossRepository: true,
    headRepository: { nameWithOwner: FORK_NAME_WITH_OWNER },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] },
    reviewThreads: { nodes: [] },
  };
}

function ownNode(): unknown {
  return {
    number: PR_NUMBER,
    isCrossRepository: false,
    headRepository: { nameWithOwner: REPO_NAME_WITH_OWNER },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
    reviewThreads: { nodes: [{ isResolved: true }, { isResolved: false }] },
  };
}

async function worldOf(
  $: Engine,
  on: On,
  overrides: Record<string, Partial<Repo>> = {},
): Promise<World> {
  const clock = mock.clock(on);
  mock.env(on, { HOME: HOME_DIR });
  const writes: Write[] = [];
  const calls: Call[] = [];
  const stored = new Map<string, unknown>();
  const repos = new Map<string, Repo>([
    [WORK_DIR, repoOf(FEATURE_BRANCH, PR_NUMBER, overrides[WORK_DIR])],
    [OTHER_DIR, repoOf(OTHER_BRANCH, OTHER_PR_NUMBER, overrides[OTHER_DIR])],
  ]);

  on("state.set", (_$, e, next) => {
    writes.push({ key: e.key, value: e.value });
    return next(e);
  });
  on("store.get", (_$, e) => ({ value: stored.get(e.key) }));
  on("store.set", (_$, e) => {
    stored.set(e.key, e.value);
    return { value: undefined };
  });
  on("session.id", () => ({ value: SESSION_ID }));
  on("session.cwd", () => ({ value: WORK_DIR }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("session.model", () => ({ value: MODEL }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("config.list", () => ({ value: [{ key: "theme", value: "dark" }] }) as never);
  on("settings.read", () => ({ value: {} }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", () => ({ value: true }));
  on("classic.SessionStart", () => ({}));
  on("command.register", () => ({ value: {} }) as never);
  on("classic.Stop", () => ({}));
  on("tool.call", () => ({ result: "ok", text: "ok" }));
  on("process.run", (_$, e) => {
    calls.push({ argv: e.argv, cwd: e.init?.cwd });
    return { value: answerOf(e.argv, e.init?.cwd, repos) } as never;
  });

  return { clock, writes, calls, repos };
}

function repoOf(branch: string, number: number, override: Partial<Repo> = {}): Repo {
  return {
    branch,
    counts: COUNTS,
    forge: githubForge(pullRequest("SUCCESS", number)),
    ...override,
  };
}

function githubForge(github: Answer): Forge {
  return { url: GITHUB_URL, github, mrView: textAnswer(""), discussions: textAnswer("") };
}

function gitlabForge(pipeline: string): Forge {
  return {
    url: GITLAB_URL,
    github: textAnswer(""),
    mrView: { kind: "json", body: { iid: MR_IID, head_pipeline: { status: pipeline } } },
    discussions: {
      kind: "json",
      body: [
        { notes: [{ resolvable: true, resolved: false }] },
        { notes: [{ resolvable: true, resolved: true }] },
        { notes: [{ resolvable: false, resolved: false }] },
      ],
    },
  };
}

function pullRequest(rollup: Rollup, number: number = PR_NUMBER): Answer {
  const threads = number === PR_NUMBER ? [{ isResolved: true }, { isResolved: false }] : [];
  return graphql([
    {
      number,
      commits: {
        nodes: [{ commit: { statusCheckRollup: rollup === null ? null : { state: rollup } } }],
      },
      reviewThreads: { nodes: threads },
    },
  ]);
}

function noPullRequest(): Answer {
  return graphql([]);
}

function graphql(nodes: unknown[]): Answer {
  return {
    kind: "json",
    body: { data: { repository: { pullRequests: { nodes } } } },
  };
}

function textAnswer(stdout: string): Answer {
  return { kind: "text", stdout, exitCode: 0 };
}

type Reply = { exitCode: number; stdout: string; stderr: string };

function answerOf(
  argv: readonly string[],
  cwd: string | undefined,
  repos: Map<string, Repo>,
): Reply {
  if (argv[0] === "gh" || argv[0] === "glab") return forgeAnswer(argv, repos.get(cwd ?? ""));
  if (argv[0] !== "git") return reply(0, "");
  const root = rootOf(argv[2] ?? "", repos);
  const repo = root === undefined ? undefined : repos.get(root);
  if (root === undefined || repo === undefined) return reply(NOT_A_REPO, "");
  return gitAnswer(argv.slice(3).join(" "), root, repo);
}

function gitAnswer(args: string, root: string, repo: Repo): Reply {
  if (args === "rev-parse --show-toplevel") return reply(0, root);
  if (args === "rev-parse --show-toplevel HEAD") return reply(0, `${root}\n${HEAD_SHA}`);
  if (args === "rev-parse --show-toplevel HEAD --abbrev-ref HEAD")
    return reply(0, `${root}\n${HEAD_SHA}\n${repo.branch}`);
  if (args === "rev-parse --abbrev-ref HEAD") return reply(0, repo.branch);
  if (args === "ls-remote --get-url") return reply(0, repo.forge.url);
  if (args.startsWith("rev-list")) {
    return repo.counts === null ? reply(NOT_A_REPO, "") : reply(0, repo.counts);
  }
  return reply(0, "");
}

function forgeAnswer(argv: readonly string[], repo: Repo | undefined): Reply {
  if (repo === undefined) return reply(FAILED, "");
  if (argv[0] === "gh") return replyOf(repo.forge.github);
  if (argv.some((word) => word.includes("discussions"))) return replyOf(repo.forge.discussions);
  return replyOf(repo.forge.mrView);
}

function replyOf(answer: Answer): Reply {
  if (answer.kind === "missing") throw new Error("spawn ENOENT");
  if (answer.kind === "text") return reply(answer.exitCode, answer.stdout);
  return reply(0, JSON.stringify(answer.body));
}

function rootOf(dir: string, repos: Map<string, Repo>): string | undefined {
  return [...repos.keys()]
    .filter((root) => dir === root || dir.startsWith(`${root}/`))
    .sort((a, b) => b.length - a.length)[FIRST];
}

function reply(exitCode: number, stdout: string): Reply {
  return { exitCode, stdout, stderr: "" };
}

async function bash($: Engine, world: World, command: string): Promise<void> {
  await $.tool.call({ tool: "Bash", command, tool_use_id: command } as never);
  await world.clock.settle();
}

function noMergeRequestAnswer(): Answer {
  return {
    kind: "text",
    stdout: JSON.stringify({
      error: { message: `no open merge request available for "${FEATURE_BRANCH}"` },
    }),
    exitCode: FAILED,
  };
}

function forgeOf(world: World, root: string, change: Partial<Forge>): void {
  const repo = world.repos.get(root);
  if (repo !== undefined) repo.forge = { ...repo.forge, ...change };
}

function checkout(world: World, root: string, branch: string): void {
  const repo = world.repos.get(root);
  if (repo !== undefined) repo.branch = branch;
}

async function blockAfterStop($: Engine, world: World): Promise<string> {
  await $.classic.Stop({ stop_hook_active: false });
  await world.clock.settle();
  const pane = await paneOnTab($, FILES_LABEL);
  await world.clock.settle();
  return textOf(await pane.drawn());
}

async function pushed($: Engine, world: World): Promise<void> {
  await bash($, world, "git push");
  expect(remoteRows(world)[WORK_DIR]?.review?.number).toBe(PR_NUMBER);
}

function remoteCalls(calls: Call[]): Call[] {
  return calls.filter(
    (call) =>
      call.argv[0] === "gh" ||
      call.argv[0] === "glab" ||
      call.argv.includes("rev-list") ||
      call.argv.includes("ls-remote") ||
      call.argv.includes("fetch") ||
      call.argv.includes("push"),
  );
}

function forgeCalls(world: World): Call[] {
  return world.calls.filter((call) => call.argv[0] === "gh" || call.argv[0] === "glab");
}

function remoteRows(world: World): Record<string, RemoteRow | undefined> {
  return (lastWritten(world, "remote") ?? {}) as Record<string, RemoteRow | undefined>;
}

type RemoteRow = {
  branch: string;
  ahead: number | null;
  behind: number | null;
  review: { kind: string; number: number; ci: string; threads: number } | null;
};

function keysOf(writes: Write[]): string[] {
  return writes.map((write) => write.key);
}

function lastWritten(world: World, key: string): unknown {
  return world.writes.filter((write) => write.key === key).at(-1)?.value;
}
