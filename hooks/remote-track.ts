import { atom, read, update } from "claude-code";
import type { EngineInterface, On } from "claude-code";

import type { RemoteCi, RemoteRepo, RemoteReview } from "../types";
import { FILES_TAB } from "./files-tab";
import { gitIn as git } from "./git-run";
import { askEachRepoOnce, namedDirs } from "./git-track";
import { PANE } from "./pane-tab";
import { isShownTab, justEntered } from "./shown-tab";
import { singleFlight } from "./single-flight";

const REMOTE_COMMAND =
  /(?:^|&&|;|\||\(|\n)\s*(?:cd\s+\S+\s*&&\s*)?(?:\w+=\S*\s+)?(?:\w+=\S*\s+)?(?:\w+=\S*\s+)?(?:git(?:\s+-[Cc]\s+\S+)?(?:\s+-[Cc]\s+\S+)?(?:\s+-[Cc]\s+\S+)?\s+push(?=\s|$)|(?:gh|glab)(?=\s|$))/;
const AHEAD_BEHIND = /^(\d+)\s+(\d+)$/;
const GITLAB_HOST = /gitlab/i;
const GITLAB_NO_MR = /"message":\s*"no open merge request/;
const GITHUB_QUERY =
  "query($owner:String!,$repo:String!,$branch:String!){repository(owner:$owner,name:$repo){pullRequests(headRefName:$branch,states:OPEN,first:10){nodes{number isCrossRepository commits(last:1){nodes{commit{statusCheckRollup{state}}}} reviewThreads(first:100){nodes{isResolved}}}}}}";
const GITHUB_CI: Record<string, RemoteCi> = {
  SUCCESS: "pass",
  FAILURE: "fail",
  ERROR: "fail",
  PENDING: "pending",
  EXPECTED: "pending",
};
const GITLAB_CI: Record<string, RemoteCi> = {
  success: "pass",
  skipped: "pass",
  failed: "fail",
  canceled: "fail",
};

type GithubPull = {
  number: number;
  isCrossRepository?: boolean;
  commits?: { nodes?: { commit?: { statusCheckRollup?: { state: string } | null } }[] };
  reviewThreads?: { nodes?: { isResolved: boolean }[] };
};
type GithubAnswer = {
  data?: { repository?: { pullRequests?: { nodes?: GithubPull[] } } };
};
type GitlabMr = { iid: number; head_pipeline?: { status: string } | null };
type GitlabDiscussion = { notes?: { resolvable?: boolean; resolved?: boolean }[] };

const remoteAtom = atom(
  { plugin: "paneline", key: "remote" } as const,
  {} as Record<string, RemoteRepo>,
);
const branchesAtom = atom(
  { plugin: "paneline", key: "gitBranches" } as const,
  {} as Record<string, string>,
);

const FAILED = Symbol("forge call failed");
type Review = RemoteReview | null | typeof FAILED;

const oneAtATime = singleFlight();

export function trackRemote(on: On): void {
  on("tool.call", { tool: "Bash", command: REMOTE_COMMAND }, async ($, e, next) => {
    const ran = await next(e);
    void refreshRemote($, namedDirs(e.command));
    return ran;
  });

  on("classic.Stop", { stop_hook_active: [true, false] }, async ($, e, next) => {
    if (e.agent_id === undefined) void refreshRemote($, []);
    return next(e);
  });

  on("ui.render", { component: "Pane", requestId: PANE }, ($, e, next) => {
    if (isShownTab(FILES_TAB.id) && justEntered(FILES_TAB.id))
      $.clock.after(0, () => void refreshRemote($, []));
    return next(e);
  });
}

async function refreshRemote($: EngineInterface, named: string[]): Promise<void> {
  const cwd = await $.session.cwd();
  const [stored, branches] = await Promise.all([read($, remoteAtom), read($, branchesAtom)]);
  const checkouts = await askEachRepoOnce($, cwd, [
    ...named.map((dir) => (dir.startsWith("/") ? dir : `${cwd}/${dir}`)),
    ...Object.keys(branches),
    ...Object.keys(stored),
  ]);
  const goneRoots = new Set(
    checkouts.filter(([, checkout]) => checkout === null).map(([dir]) => dir),
  );
  const branchOfRoot = new Map(
    checkouts.flatMap(([, checkout]) =>
      checkout === null ? [] : [[checkout.root, checkout.branch] as const],
    ),
  );
  const kept = Object.fromEntries(Object.entries(stored).filter(([root]) => !goneRoots.has(root)));
  const found = await Promise.all(
    [...branchOfRoot].map(([root, branch]) =>
      oneAtATime(root, async () => [root, await repoOf($, root, branch, stored[root])] as const),
    ),
  );
  const next = { ...kept, ...Object.fromEntries(found) };
  if (JSON.stringify(next) === JSON.stringify(await read($, remoteAtom))) return;
  await update($, remoteAtom, () => next);
}

async function repoOf(
  $: EngineInterface,
  root: string,
  branch: string,
  known: RemoteRepo | undefined,
): Promise<RemoteRepo> {
  const counts = AHEAD_BEHIND.exec(
    (await git($, root, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"])) ?? "",
  );
  if (counts === null) return { branch, ahead: null, behind: null, review: null };
  const review = await reviewOf($, root);
  return {
    branch,
    behind: Number(counts[1]),
    ahead: Number(counts[2]),
    review: review === FAILED ? (known?.branch === branch ? known.review : undefined) : review,
  };
}

async function reviewOf($: EngineInterface, root: string): Promise<Review> {
  const url = await git($, root, ["ls-remote", "--get-url"]);
  if (url === null) return null;
  return GITLAB_HOST.test(url) ? gitlabReview($, root) : githubReview($, root);
}

async function githubReview($: EngineInterface, root: string): Promise<Review> {
  const answer = await forgeJson<GithubAnswer>($, root, [
    "gh",
    "api",
    "graphql",
    "-F",
    "owner={owner}",
    "-F",
    "repo={repo}",
    "-F",
    "branch={branch}",
    "-f",
    `query=${GITHUB_QUERY}`,
  ]);
  if (answer === FAILED) return FAILED;
  const pull = answer?.data?.repository?.pullRequests?.nodes?.find(
    (candidate) => !candidate.isCrossRepository,
  );
  if (pull === undefined) return null;
  const rollup = pull.commits?.nodes?.[0]?.commit?.statusCheckRollup;
  return {
    kind: "PR",
    number: pull.number,
    ci: rollup ? (GITHUB_CI[rollup.state] ?? "pending") : "none",
    threads: (pull.reviewThreads?.nodes ?? []).filter((thread) => !thread.isResolved).length,
  };
}

async function gitlabReview($: EngineInterface, root: string): Promise<Review> {
  const mr = await forgeJson<GitlabMr>($, root, ["glab", "mr", "view", "-F", "json"], GITLAB_NO_MR);
  if (mr === FAILED) return FAILED;
  if (typeof mr?.iid !== "number") return null;
  const pipeline = mr.head_pipeline;
  const discussions = await forgeJson<GitlabDiscussion[]>($, root, [
    "glab",
    "api",
    `projects/:id/merge_requests/${mr.iid}/discussions`,
    "--paginate",
    "--output",
    "json",
  ]);
  if (discussions === FAILED) return FAILED;
  return {
    kind: "MR",
    number: mr.iid,
    ci: pipeline ? (GITLAB_CI[pipeline.status] ?? "pending") : "none",
    threads: Array.isArray(discussions)
      ? discussions.filter((discussion) =>
          discussion.notes?.some((note) => note.resolvable === true && note.resolved !== true),
        ).length
      : 0,
  };
}

async function forgeJson<Answer>(
  $: EngineInterface,
  root: string,
  argv: string[],
  noAnswer?: RegExp,
): Promise<Answer | null | typeof FAILED> {
  try {
    const { exitCode, stdout } = await $.process.run(argv, { cwd: root });
    if (exitCode !== 0) return noAnswer?.test(stdout) ? null : FAILED;
    return (JSON.parse(stdout) as Answer | null) ?? FAILED;
  } catch {
    return FAILED;
  }
}
