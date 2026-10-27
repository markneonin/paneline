import type { ElementTable, RenderElement } from "claude-code";

import { TEXT_COLUMN } from "./chat-draw";
import { diffstat } from "./activity-track";
import { memo } from "./memo";
import type { Accent } from "./pane-kit";
import { palette } from "./palette";
import type { Fills } from "./palette";
import { replyLook } from "./reply-look";
import type { ReplyLook } from "./reply-look";

type Ui = ElementTable;

type BashEditDiff = {
  files: { filePath: string; hunks: Hunk[]; created?: true; deleted?: true }[];
  moreFiles: number;
  shared?: true;
};

export type Hunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
};

export type FileChange = {
  filePath: string;
  isCreate: boolean;
  isDelete: boolean;
  hunks: Hunk[];
  content: string;
};

export type BashChanges = { changes: FileChange[]; moreFiles: number; isShared: boolean };

export type DiffRequest = {
  toolUseId: string;
  change: FileChange;
  cwd: string;
  home: string | undefined;
  width: number;
  accent: Accent;
  fills: Fills;
};

const MAX_BODY_LINES = 40;
const MAX_BODY_CHARS = 9_000;
const FRAME_COLUMNS = 2;
const DIFF_CACHE_LIMIT = 40;

const diffCache = memo<RenderElement>(DIFF_CACHE_LIMIT);

export function fileChangeOf(output: unknown): FileChange | null {
  const result = output as {
    filePath?: unknown;
    structuredPatch?: unknown;
    type?: unknown;
    content?: unknown;
  } | null;
  if (typeof result?.filePath !== "string" || !Array.isArray(result.structuredPatch)) return null;
  const isCreate = result.type === "create";
  const content = typeof result.content === "string" ? result.content : "";
  return {
    filePath: result.filePath,
    isCreate,
    isDelete: false,
    hunks: result.structuredPatch as Hunk[],
    content,
  };
}

export function bashChangesOf(output: unknown): BashChanges | null {
  const diff = (output as { bashEditDiff?: BashEditDiff } | null)?.bashEditDiff;
  if (!Array.isArray(diff?.files) || diff.files.length === 0) return null;
  const changes = diff.files.map((file) => ({
    filePath: file.filePath,
    isCreate: file.created === true,
    isDelete: file.deleted === true,
    hunks: file.hunks,
    content: "",
  }));
  return { changes, moreFiles: diff.moreFiles, isShared: diff.shared === true };
}

export function bashNotes(ui: Ui, { moreFiles, isShared }: BashChanges): RenderElement[] {
  const { Text } = ui;
  const notes: [string, string][] = [];
  if (moreFiles > 0) notes.push(["more", `… +${moreFiles} more files`]);
  if (isShared)
    notes.push([
      "shared",
      "another command ran in this repository at the same time; a change made by either may show under either result",
    ]);
  return notes.map(([key, text]) => (
    <Text key={key} dimColor color={palette.muted} wrap="wrap">
      {text}
    </Text>
  ));
}

export function withoutBashChanges(output: unknown): unknown {
  return { ...(output as object), bashEditDiff: undefined };
}

export function diffPanel(ui: Ui, request: DiffRequest): RenderElement {
  const key = `${request.toolUseId}|${request.change.filePath}|${request.width}|${request.accent}|${request.fills.source}`;
  return diffCache(key, () => buildWindow(ui, request));
}

function buildWindow(ui: Ui, request: DiffRequest): RenderElement {
  const { Box, Code, Text } = ui;
  const look = replyLook(request.accent, request.fills);
  const hunks = hunksOf(request.change);
  const stat = diffstat({ structuredPatch: hunks });
  const shown = fitHunks(hunks);
  const innerWidth = request.width - FRAME_COLUMNS;
  const hasChanges = stat.added + stat.removed > 0;
  return (
    <Box
      key={`diff-${request.toolUseId}-${request.change.filePath}`}
      flexDirection="column"
      marginTop={1}
      marginLeft={TEXT_COLUMN}
      width={request.width}
      borderStyle="round"
      borderColor={look.accent}
    >
      {headerView(ui, request, stat, innerWidth)}
      {hasChanges ? (
        <Box key="header-rule" width={innerWidth}>
          <Text color={look.accent} wrap="truncate-end">
            {"─".repeat(innerWidth)}
          </Text>
        </Box>
      ) : null}
      {hasChanges ? (
        <Code
          key="body"
          format="diff"
          path={request.change.filePath}
          source={unifiedDiff(shown.hunks)}
          wrap="wrap"
        />
      ) : null}
      {shown.hiddenLines > 0 ? (
        <Text color={look.muted}>{`… +${shown.hiddenLines} lines`}</Text>
      ) : null}
    </Box>
  );
}

export function hunksOf({ isCreate, hunks, content }: FileChange): Hunk[] {
  if (!isCreate || hunks.length > 0 || content === "") return hunks;
  const lines = content.replace(/\n$/, "").split("\n");
  return [
    {
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: lines.length,
      lines: lines.map((l) => `+${l}`),
    },
  ];
}

function headerView(
  ui: Ui,
  request: DiffRequest,
  stat: { added: number; removed: number },
  width: number,
): RenderElement {
  const { Box, Link, Text } = ui;
  const { change, cwd, home, accent, fills } = request;
  const look = replyLook(accent, fills);
  const path = displayPath(change.filePath, cwd, home);
  return (
    <Box key="header" width={width}>
      <Box flexGrow={1} flexShrink={1} minWidth={0} paddingX={1}>
        <Link href={`file://${encodeURI(change.filePath)}`}>
          <Text weight="semibold" wrap="truncate-start" color={look.prose}>
            {path}
          </Text>
        </Link>
      </Box>
      <Box flexShrink={0} columnGap={1} paddingRight={1}>
        {tagsOf(change, stat, look).map(({ key, text, color }) => (
          <Text key={key} color={color}>
            {text}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

function displayPath(path: string, cwd: string, home: string | undefined): string {
  if (cwd !== "" && path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
  if (home && path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
  return path;
}

type Tag = { key: string; text: string; color: string };

function tagsOf(
  change: FileChange,
  stat: { added: number; removed: number },
  look: ReplyLook,
): Tag[] {
  const tags: Tag[] = [];
  if (stat.added + stat.removed === 0)
    return [{ key: "none", text: "no changes", color: look.muted }];
  if (change.isCreate) tags.push({ key: "kind", text: "new", color: look.added });
  else if (change.isDelete || isWholeFileRemoved(change.hunks, stat))
    tags.push({ key: "kind", text: "deleted", color: look.removed });
  else tags.push({ key: "kind", text: "edited", color: look.muted });
  if (stat.added > 0) tags.push({ key: "added", text: `+${stat.added}`, color: look.added });
  if (stat.removed > 0)
    tags.push({ key: "removed", text: `-${stat.removed}`, color: look.removed });
  return tags;
}

function isWholeFileRemoved(hunks: Hunk[], stat: { added: number; removed: number }): boolean {
  return (
    stat.added === 0 &&
    hunks.length === 1 &&
    hunks[0]!.oldStart === 1 &&
    hunks[0]!.lines.every((line) => line.startsWith("-"))
  );
}

export function fitHunks(hunks: Hunk[]): { hunks: Hunk[]; hiddenLines: number } {
  const shown: Hunk[] = [];
  let rows = 0;
  let chars = 0;
  for (const hunk of hunks) {
    const room = {
      rows: MAX_BODY_LINES - rows - (shown.length > 0 ? 1 : 0),
      chars: MAX_BODY_CHARS - chars,
    };
    const fitting = linesWithin(hunk.lines, room);
    if (fitting < hunk.lines.length && shown.length > 0) break;
    const kept = fitting < hunk.lines.length ? cutHunk(hunk, fitting) : hunk;
    shown.push(kept);
    rows += kept.lines.length + (shown.length > 1 ? 1 : 0);
    chars += charsOf(kept.lines);
    if (fitting < hunk.lines.length) break;
  }
  const total = hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
  const kept = shown.reduce((sum, hunk) => sum + hunk.lines.length, 0);
  return { hunks: shown, hiddenLines: total - kept };
}

function linesWithin(lines: string[], room: { rows: number; chars: number }): number {
  let chars = 0;
  let count = 0;
  for (const line of lines) {
    chars += line.length + 1;
    if (count >= room.rows || chars > room.chars) break;
    count += 1;
  }
  return count;
}

const charsOf = (lines: string[]): number => lines.reduce((sum, line) => sum + line.length + 1, 0);

function cutHunk(hunk: Hunk, keep: number): Hunk {
  const lines = hunk.lines.slice(0, keep);
  const added = lines.filter((line) => line.startsWith("+")).length;
  const removed = lines.filter((line) => line.startsWith("-")).length;
  const context = lines.length - added - removed;
  return { ...hunk, lines, oldLines: context + removed, newLines: context + added };
}

export function unifiedDiff(hunks: Hunk[]): string {
  return hunks
    .map(
      (hunk) =>
        `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${hunk.lines.join("\n")}`,
    )
    .join("\n");
}
