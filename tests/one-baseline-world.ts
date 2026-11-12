import { repoOf, treeOf, TOP } from "./review-world";
import type { Git, Repo } from "./review-world";

export type Moving = { head: string };
export type Session = { repo: Repo; moving: Moving };

const START_HEAD = "aaaaaaa1";
const NOT_FOUND = 128;

export function sessionRepoOf(files: Record<string, string>): Session {
  const repo = repoOf({
    trees: { HEAD: treeOf(files), [START_HEAD]: treeOf(files) },
    work: treeOf(files),
  });
  return { repo, moving: { head: START_HEAD } };
}

export function strayFolderOf(files: Record<string, string>): Session {
  return { repo: repoOf({ top: null, work: treeOf(files) }), moving: { head: START_HEAD } };
}

export function commitAll(session: Session, head: string): void {
  const { repo, moving } = session;
  const snapshot = new Map([...repo.work].filter(([path]) => !repo.untracked.has(path)));
  repo.trees[head] = snapshot;
  repo.trees.HEAD = new Map(snapshot);
  moving.head = head;
}

export function mergeIn(session: Session, head: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) session.repo.work.set(path, text);
  commitAll(session, head);
}

export async function gitAnswer(session: Session, argv: readonly string[]): Promise<Git> {
  const { repo, moving } = session;
  const args = argv.slice(argv[1] === "-C" ? 3 : 1);
  if (repo.top !== null && args[0] === "rev-parse" && args.includes("HEAD"))
    return { exitCode: 0, stdout: headAnswer(args.slice(1), moving.head), stderr: "" };
  if (repo.top !== null && args[0] === "log" && args.includes("-g"))
    return { exitCode: 0, stdout: "", stderr: "" };
  const range = args[0] === "diff" ? twoRevisions(args) : undefined;
  if (range !== undefined) return betweenCommits(session, argv, range);
  return repo.$.process.run(argv);
}

function headAnswer(args: string[], head: string): string {
  const lines: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--show-toplevel") lines.push(TOP);
    else if (args[i] === "--abbrev-ref") {
      lines.push("main");
      i++;
    } else if (args[i] === "HEAD") lines.push(head);
  }
  return `${lines.join("\n")}\n`;
}

function twoRevisions(args: string[]): [string, string] | undefined {
  const split = args.indexOf("--");
  const head = split === -1 ? args : args.slice(0, split);
  const revs = head.filter((arg) => !arg.startsWith("-") && arg !== "diff");
  const [from, to, ...rest] = revs;
  return from !== undefined && to !== undefined && rest.length === 0 ? [from, to] : undefined;
}

async function betweenCommits(
  session: Session,
  argv: readonly string[],
  [from, to]: [string, string],
): Promise<Git> {
  const finished = session.repo.trees[to];
  if (finished === undefined)
    return { exitCode: NOT_FOUND, stdout: "", stderr: "unknown revision" };
  const asked = repoOf({
    trees: { [from]: session.repo.trees[from] ?? new Map() },
    work: finished,
  });
  return asked.$.process.run(argv.filter((arg) => arg !== to));
}
