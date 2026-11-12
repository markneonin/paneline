import type { EngineInterface } from "claude-code";

import { gitIn } from "./git-run";

export type ReviewComment = {
  id: string;
  file: string;
  line: number;
  side: "new" | "old";
  code: string;
  text: string;
  resolved: boolean;
};

export type NewReviewComment = Omit<ReviewComment, "id" | "resolved">;

export type CodeLine = { number: number; text: string };

const STORE_NAME = "paneline-review.json";
const ID_PREFIX = "c";
const JSON_INDENT = 2;

export async function readComments($: EngineInterface): Promise<ReviewComment[]> {
  const path = await storePath($);
  return path === null ? [] : loadComments($, path);
}

export async function addComment(
  $: EngineInterface,
  comment: NewReviewComment,
): Promise<string | null> {
  const path = await storePath($);
  if (path === null) return null;
  const comments = await loadComments($, path);
  const id = nextId(comments);
  await saveComments($, path, [...comments, { ...comment, id, resolved: false }]);
  return id;
}

export async function resolveComment($: EngineInterface, id: string): Promise<boolean> {
  const path = await storePath($);
  if (path === null) return false;
  const comments = await loadComments($, path);
  if (!comments.some((comment) => comment.id === id && !comment.resolved)) return false;
  await saveComments(
    $,
    path,
    comments.map((comment) => (comment.id === id ? { ...comment, resolved: true } : comment)),
  );
  return true;
}

export function relocatedLine(
  comment: Pick<ReviewComment, "line" | "code">,
  candidates: CodeLine[],
): number | null {
  const distance = (candidate: CodeLine): number => Math.abs(candidate.number - comment.line);
  const matches = candidates.filter((candidate) => candidate.text === comment.code);
  const nearest = matches.reduce<CodeLine | null>(
    (best, candidate) =>
      best === null ||
      distance(candidate) < distance(best) ||
      (distance(candidate) === distance(best) && candidate.number < best.number)
        ? candidate
        : best,
    null,
  );
  return nearest === null ? null : nearest.number;
}

async function storePath($: EngineInterface): Promise<string | null> {
  const gitDir = await gitIn($, await $.session.root(), ["rev-parse", "--absolute-git-dir"]);
  return gitDir === null ? null : `${gitDir}/${STORE_NAME}`;
}

async function loadComments($: EngineInterface, path: string): Promise<ReviewComment[]> {
  if (!(await $.fs.exists(path))) return [];
  return parseComments(await $.fs.read(path));
}

function parseComments(text: string): ReviewComment[] {
  try {
    return JSON.parse(text) as ReviewComment[];
  } catch {
    return [];
  }
}

async function saveComments(
  $: EngineInterface,
  path: string,
  comments: ReviewComment[],
): Promise<void> {
  await $.fs.write(path, JSON.stringify(comments, null, JSON_INDENT));
}

function nextId(comments: ReviewComment[]): string {
  const numbers = comments.map((comment) => Number(comment.id.slice(ID_PREFIX.length)));
  return `${ID_PREFIX}${Math.max(0, ...numbers) + 1}`;
}
