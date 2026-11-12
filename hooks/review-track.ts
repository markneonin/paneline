import { atom, update } from "claude-code";
import type { EngineInterface, On } from "claude-code";

import { TYPED } from "./typed-origin";
import { singleLine } from "./format";
import { gitIn } from "./git-run";
import { readComments, relocatedLine, resolveComment } from "./review-comments";
import type { ReviewComment } from "./review-comments";
import { RESOLVE_REVIEW_TOOL } from "./tools";

const resolvedCountAtom = atom({ plugin: "paneline", key: "reviewResolved" } as const, 0);
const TYPED_ORIGIN = new RegExp(`^(${[...TYPED].join("|")})$`);
const RESOLVE_CALL = new RegExp(`^${RESOLVE_REVIEW_TOOL}$`);

const COMMENTS_HEADER =
  "Unresolved review comments from the owner (paneline Review tab). Address each, then call mcp__paneline__resolve_review_comment with its id.";

export function trackReviewComments(on: On): void {
  on("session.start", { isInteractive: true }, async ($, e, next) => {
    await $.tool
      .register({
        name: "resolve_review_comment",
        description:
          "Mark a review comment as resolved once you have addressed it. Pass its id, such as c3.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        isDeferred: false,
      })
      .catch(() => undefined);
    return next(e);
  });

  on("tool.check", { tool: RESOLVE_CALL }, () => ({ decision: "allow" }));

  on("tool.call", { tool: RESOLVE_CALL }, async ($, e) => {
    const id = String(Reflect.get(e, "id"));
    const resolved = await resolveComment($, id);
    if (resolved) await update($, resolvedCountAtom, (count) => count + 1);
    return { result: resolved ? `resolved ${id}` : `no open comment ${id}` };
  });

  on("prompt.submit", { origin: { kind: TYPED_ORIGIN } }, async ($, e, next) => {
    if (e.isMeta === true) return next(e);
    const open = (await readComments($)).filter((comment) => !comment.resolved);
    if (open.length === 0) return next(e);
    return next({ ...e, context: [...(e.context ?? []), await commentsBlock($, open)] });
  });
}

async function commentsBlock($: EngineInterface, open: ReviewComment[]): Promise<string> {
  const root = await $.session.root();
  const top = await gitIn($, root, ["rev-parse", "--show-toplevel"]);
  const lines = await Promise.all(open.map((comment) => commentLine($, top, comment)));
  return [COMMENTS_HEADER, ...lines].join("\n");
}

async function commentLine(
  $: EngineInterface,
  top: string | null,
  comment: ReviewComment,
): Promise<string> {
  const code = singleLine(comment.code);
  const text = singleLine(comment.text);
  const line = await currentLine($, top, comment);
  return `- [${comment.id}] ${comment.file}:${line} "${code}": ${text}`;
}

async function currentLine(
  $: EngineInterface,
  top: string | null,
  comment: ReviewComment,
): Promise<number> {
  if (comment.side === "old" || top === null) return comment.line;
  const content = await $.fs.read(`${top}/${comment.file}`).catch(() => null);
  if (content === null) return comment.line;
  const candidates = content.split("\n").map((text, i) => ({ number: i + 1, text }));
  return relocatedLine(comment, candidates) ?? comment.line;
}
