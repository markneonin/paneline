import { atom, read, update } from "claude-code";
import type { EngineInterface, On } from "claude-code";

import type {
  Activity,
  AgentEdit,
  GitChange,
  ReviewConfirm,
  PressedLine,
  ReviewDraft,
  ReviewListFile,
  ReviewState,
} from "../types";
import { withoutCleared } from "./clear-kit";
import { enterDetail, forgetDetail, keepPane, leaveDetail, PANE, PANE_OPEN } from "./pane-tab";
import { addComment, readComments } from "./review-comments";
import type { ReviewComment } from "./review-comments";
import { commentInputKey, reviewTab } from "./review-draw";
import { loadFileDiff, reviewFiles, revertFile, revertHunk } from "./review-git";
import type { ReviewFile, SessionFile } from "./review-git";
import { isShownTab } from "./shown-tab";
import { changedPaths } from "./tools";

export const REVIEW_TAB = { id: "review", label: "Review" };

const NO_PATCH = { confirm: null, error: null, draft: null } as const;

const EMPTY_STATE: ReviewState = {
  scope: "session",
  top: null,
  reason: null,
  files: [],
  comments: [],
  openPath: null,
  hunks: [],
  isDiffCut: false,
  seen: {},
  dropped: [],
  ...NO_PATCH,
};

const reviewAtom = atom({ plugin: "paneline", key: "review" } as const, EMPTY_STATE);
const activityAtom = atom({ plugin: "paneline", key: "activity" } as const, [] as Activity[]);
const agentEditsAtom = atom({ plugin: "paneline", key: "agentEdits" } as const, [] as AgentEdit[]);
const gitChangesAtom = atom({ plugin: "paneline", key: "gitChanges" } as const, [] as GitChange[]);
const resolvedCountAtom = atom({ plugin: "paneline", key: "reviewResolved" } as const, 0);
const bodyOffsetAtom = atom({ plugin: "paneline", key: "bodyOffset" } as const, 0);
const tabAtom = atom({ plugin: "paneline", key: "tab" } as const, "activity");
const discardArmedAtom = atom({ plugin: "paneline", key: "reviewDiscardArmed" } as const, false);
const clearedAtom = atom({ plugin: "paneline", key: "filesCleared" } as const, [] as string[]);

type SessionEdits = { files: SessionFile[]; stamp: string };

let seenStamp: string | null = null;
let draftText = "";
let openings = 0;

export function registerReviewTab(on: On): void {
  on("ui.close", { id: PANE }, async ($, e, next) => {
    if (e.origin.kind !== "person" || (await read($, tabAtom)) !== REVIEW_TAB.id) return next(e);
    const { draft, openPath } = await read($, reviewAtom);
    if (draft !== null) await escapeComment($);
    else if (openPath !== null) await closeFile($);
    else return next(e);
    const swallow = await keepPane($);
    const kept = (await read($, reviewAtom)).draft;
    if (kept !== null) await focusComment($, kept);
    else if (draft !== null) await releaseKeys($);
    return swallow;
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e, next) => {
    if (!isShownTab(REVIEW_TAB.id)) {
      seenStamp = null;
      return next(e);
    }
    const [state, edits, resolvedCount, isDiscardArmed] = await Promise.all([
      read($, reviewAtom),
      sessionEdits($),
      read($, resolvedCountAtom),
      read($, discardArmedAtom),
    ]);
    const stamp = `${edits.stamp}\n${resolvedCount}`;
    if (stamp !== seenStamp) {
      seenStamp = stamp;
      $.clock.after(0, () => void refresh($));
    }
    return reviewTab($.ui.resolve(e), {
      state,
      width: e.props.bodyColumns,
      height: e.props.scroll.bodyRows,
      offset: e.props.scroll.offset,
      setScope: (scope) => void change($, { scope, openPath: null, ...NO_PATCH }),
      openFile: (path) => void openFile($, path).then(() => keepPane($)),
      closeFile: () => void closeFile($),
      step: (delta) => void stepFile($, delta),
      askRevert: (confirm) => void setConfirm($, confirm),
      answerRevert: (isYes) => void answerRevert($, isYes),
      pressLine: (draft) => void pressLine($, draft),
      submitComment: (text) => void saveComment($, text),
      typeComment: (text) => void typeComment($, text),
      isDiscardArmed,
      toggleSeen: (path) => void toggleSeen($, path),
    });
  });
}

async function sessionEdits($: EngineInterface): Promise<SessionEdits> {
  const [activity, agentEdits, changes, cleared] = await Promise.all([
    read($, activityAtom),
    read($, agentEditsAtom),
    read($, gitChangesAtom),
    read($, clearedAtom),
  ]);
  const edits = [
    ...withoutCleared(activity, cleared),
    ...withoutCleared(agentEdits, cleared),
  ].filter((entry) => changedPaths(entry).length > 0);
  const files = new Map<string, SessionFile>();
  for (const change of changes)
    if (change.target !== "")
      files.set(change.target, { target: change.target, base: change.base || undefined });
  for (const target of edits.flatMap(changedPaths))
    if (!files.has(target)) files.set(target, { target });
  const stamp = [
    ...edits.map((entry) => entry.id),
    ...changes.map((change) => `${change.target}:${change.added}:${change.removed}`),
  ].join("\n");
  return { files: [...files.values()], stamp };
}

async function change($: EngineInterface, patch: Partial<ReviewState>): Promise<void> {
  if ("scope" in patch || "openPath" in patch) await update($, bodyOffsetAtom, () => 0);
  await update($, reviewAtom, (current) => ({ ...current, ...patch }));
  await refresh($);
}

async function openFile($: EngineInterface, path: string): Promise<void> {
  await enterDetail($, REVIEW_TAB.id);
  await change($, { openPath: path, ...NO_PATCH });
}

async function closeFile($: EngineInterface): Promise<void> {
  await change($, { openPath: null, ...NO_PATCH });
  await leaveDetail($, REVIEW_TAB.id);
}

async function escapeComment($: EngineInterface): Promise<void> {
  const isArmed = await read($, discardArmedAtom);
  if (draftText.trim() !== "" && !isArmed) {
    await update($, discardArmedAtom, () => true);
    return;
  }
  draftText = "";
  await update($, discardArmedAtom, () => false);
  await update($, reviewAtom, (current) => ({ ...current, draft: null }));
}

async function typeComment($: EngineInterface, text: string): Promise<void> {
  draftText = text;
  if (await read($, discardArmedAtom)) await update($, discardArmedAtom, () => false);
}

async function refresh($: EngineInterface): Promise<void> {
  const state = await read($, reviewAtom);
  const [edits, comments] = await Promise.all([sessionEdits($), readComments($)]);
  const review = await reviewFiles($, state.scope, edits.files);
  const stamped = "files" in review ? await withStamps($, review.top, review.files) : [];
  const files = "files" in review ? withCommentFiles(stamped, comments) : [];
  const dropped =
    "files" in review && state.scope === "session"
      ? droppedEdits(review.top, review.files, edits.files)
      : [];
  const open = files.find(({ path }) => path === state.openPath);
  const hasDiff = "files" in review && review.files.some(({ path }) => path === open?.path);
  const { hunks, isCut } =
    open && hasDiff ? await loadFileDiff($, state.scope, open) : { hunks: [], isCut: false };
  await update($, reviewAtom, (current) => {
    if (current.scope !== state.scope || current.openPath !== state.openPath) return current;
    return {
      ...current,
      top: "top" in review ? review.top : null,
      reason: "reason" in review ? review.reason : null,
      files,
      comments,
      openPath: open?.path ?? null,
      hunks,
      isDiffCut: isCut,
      dropped,
    };
  });
  if (state.openPath !== null && (await read($, reviewAtom)).openPath === null)
    await forgetDetail($, REVIEW_TAB.id);
}

type StampedFile = ReviewFile & { stamp: string };

async function withStamps(
  $: EngineInterface,
  top: string,
  files: ReviewFile[],
): Promise<StampedFile[]> {
  return Promise.all(
    files.map(async (file) => {
      const mtime = await mtimeOf($, `${top}/${file.path}`);
      return { ...file, stamp: `${file.status}:${mtime}:${file.added}:${file.removed}` };
    }),
  );
}

async function mtimeOf($: EngineInterface, target: string): Promise<string> {
  try {
    return String((await $.fs.stat(target)).mtimeMs);
  } catch {
    return "";
  }
}

function droppedEdits(top: string, files: ReviewFile[], edits: SessionFile[]): string[] {
  const listed = new Set(files.map(({ path }) => `${top}/${path}`));
  return edits
    .map(({ target }) => target)
    .filter((target) => !listed.has(target))
    .map((target) => (target.startsWith(`${top}/`) ? target.slice(top.length + 1) : target));
}

function withCommentFiles(files: StampedFile[], comments: ReviewComment[]): ReviewListFile[] {
  const listed = new Set(files.map(({ path }) => path));
  const bare = [
    ...new Set(
      comments
        .filter((comment) => !comment.resolved && !listed.has(comment.file))
        .map((comment) => comment.file),
    ),
  ].map((path): ReviewListFile => ({
    path,
    status: "modified",
    isBinary: false,
    added: 0,
    removed: 0,
    base: "HEAD",
    isCommentOnly: true,
    stamp: "",
  }));
  const changed = files.map((file): ReviewListFile => ({ ...file, isCommentOnly: false }));
  return [...changed, ...bare].sort((a, b) => a.path.localeCompare(b.path));
}

async function toggleSeen($: EngineInterface, path: string): Promise<void> {
  await update($, reviewAtom, (current) => {
    const file = current.files.find((listed) => listed.path === path);
    if (!file) return current;
    const { [path]: stored, ...rest } = current.seen;
    return { ...current, seen: stored === file.stamp ? rest : { ...rest, [path]: file.stamp } };
  });
}

async function stepFile($: EngineInterface, delta: number): Promise<void> {
  const { files, openPath } = await read($, reviewAtom);
  const target = files[files.findIndex(({ path }) => path === openPath) + delta];
  if (target) await change($, { openPath: target.path, ...NO_PATCH });
}

async function setConfirm($: EngineInterface, confirm: ReviewConfirm | null): Promise<void> {
  await update($, reviewAtom, (current) => ({ ...current, confirm, error: null, draft: null }));
}

async function answerRevert($: EngineInterface, isYes: boolean): Promise<void> {
  const state = await read($, reviewAtom);
  const file = state.files.find(({ path }) => path === state.openPath);
  const { confirm, top } = state;
  if (!isYes || !confirm || !file || top === null) return setConfirm($, null);
  const hunk = confirm.kind === "hunk" ? state.hunks[confirm.index] : undefined;
  const error =
    confirm.kind === "file"
      ? await revertFile($, top, file)
      : hunk
        ? await revertHunk($, top, file, hunk)
        : null;
  await update($, reviewAtom, (current) => ({ ...current, confirm: null, error }));
  await refresh($);
}

async function pressLine($: EngineInterface, line: PressedLine): Promise<void> {
  const draft = { ...line, opening: ++openings };
  draftText = "";
  await update($, discardArmedAtom, () => false);
  await update($, reviewAtom, (current) => ({ ...current, draft, confirm: null, error: null }));
  await $.ui.open({ ...PANE_OPEN, focus: true });
  await focusComment($, draft);
}

async function releaseKeys($: EngineInterface): Promise<void> {
  await $.ui.close({ id: PANE }).catch(() => undefined);
  await $.ui.open(PANE_OPEN).catch(() => undefined);
}

async function focusComment($: EngineInterface, draft: ReviewDraft): Promise<void> {
  await $.ui.focus({ requestId: PANE, key: commentInputKey(draft) }).catch(() => undefined);
}

async function saveComment($: EngineInterface, text: string): Promise<void> {
  const { draft, openPath } = await read($, reviewAtom);
  const trimmed = text.trim();
  if (draft && openPath !== null && trimmed !== "")
    await addComment($, {
      file: openPath,
      line: draft.line,
      side: draft.side,
      code: draft.code,
      text: trimmed,
    });
  draftText = "";
  await update($, discardArmedAtom, () => false);
  await change($, { draft: null });
  await releaseKeys($);
}
