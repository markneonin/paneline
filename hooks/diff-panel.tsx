import type { ElementTable, RenderElement } from "claude-code";

import type { CallDetail } from "../types";
import { BACKGROUND_TAG } from "./activity-calls";
import { TEXT_COLUMN } from "./chat-draw";
import { diffstat } from "./activity-track";
import { memo } from "./memo";
import type { Accent } from "./pane-kit";
import { paneInk } from "./pane-ink";
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

type BodyRoom = { rows: number; chars: number };

type DiffWindow = { element: RenderElement; hiddenLines: number };

type Tag = { key: string; text: string; color: string };

type Title = { text: string; href?: string; wrap: "truncate-start" | "truncate-end" };

type PanelSpec = {
  key: string;
  width: number;
  look: ReplyLook;
  frame: WindowFrame;
  title: Title;
  tags: Tag[];
  body: RenderElement | null;
  hiddenLines: number;
};

type PanelParts = Pick<PanelSpec, "title" | "tags" | "body" | "hiddenLines">;

type BashDetail = Extract<CallDetail, { kind: "bash" }>;
type ReadDetail = Extract<CallDetail, { kind: "read" }>;

export type ToolPanelRequest = {
  toolUseId: string;
  detail: BashDetail | ReadDetail;
  cwd: string;
  home: string | undefined;
  width: number;
  accent: Accent;
  fills: Fills;
  isExpanded: boolean;
  isDenied: boolean;
};

type WindowFrame = {
  room: BodyRoom;
  margins: { marginTop?: number; marginLeft?: number };
  isHiddenNoted: boolean;
  titleColor: (look: ReplyLook) => string | undefined;
};

export const DENIED_GLYPH = "⊘";
const MAX_BODY_LINES = 40;
const MAX_BODY_CHARS = 9_000;
const CHAT_ROOM: BodyRoom = { rows: MAX_BODY_LINES, chars: MAX_BODY_CHARS };
const CHAT_MARGINS = { marginTop: 1, marginLeft: TEXT_COLUMN };
const PANE_BODY_CHARS = 90_000;
const FRAME_COLUMNS = 2;
const FOLDED_LINES = 10;
const DIFF_CACHE_LIMIT = 40;

const CHAT_FRAME: WindowFrame = {
  room: CHAT_ROOM,
  margins: CHAT_MARGINS,
  isHiddenNoted: true,
  titleColor: (look) => look.prose,
};

const diffCache = memo<DiffWindow>(DIFF_CACHE_LIMIT);

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

export function diffPanel(ui: Ui, request: DiffRequest): RenderElement {
  const key = `${windowKey(request)}|chat`;
  return diffCache(key, () => buildWindow(ui, request, CHAT_FRAME)).element;
}

export function toolPanel(ui: Ui, request: ToolPanelRequest): RenderElement {
  const { detail, toolUseId, width, accent, fills, isExpanded, isDenied } = request;
  const subject = detail.kind === "read" ? detail.filePath : detail.command;
  const key = `${toolUseId}|${detail.kind}|${subject}|${width}|${accent}|${fills.source}|${isExpanded}|${isDenied}|chat`;
  return diffCache(key, () => framePanel(ui, toolSpec(ui, request))).element;
}

export function paneDiffPanel(ui: Ui, request: DiffRequest, maxLines: number): DiffWindow {
  const key = `${windowKey(request)}|pane|${maxLines}`;
  const frame = {
    room: { rows: maxLines, chars: PANE_BODY_CHARS },
    margins: {},
    isHiddenNoted: !Number.isFinite(maxLines),
    titleColor: () => paneInk().text,
  };
  return diffCache(key, () => buildWindow(ui, request, frame));
}

function windowKey(request: DiffRequest): string {
  return `${request.toolUseId}|${request.change.filePath}|${request.width}|${request.accent}|${request.fills.source}`;
}

function buildWindow(ui: Ui, request: DiffRequest, frame: WindowFrame): DiffWindow {
  const { Code } = ui;
  const look = replyLook(request.accent, request.fills);
  const hunks = hunksOf(request.change);
  const stat = diffstat({ structuredPatch: hunks });
  const shown = fitHunks(hunks, frame.room);
  const { filePath } = request.change;
  const body =
    stat.added + stat.removed > 0 ? (
      <Code
        key="body"
        format="diff"
        path={filePath}
        source={visibleControls(unifiedDiff(shown.hunks))}
        wrap="wrap"
      />
    ) : null;
  return framePanel(ui, {
    key: `diff-${request.toolUseId}-${filePath}`,
    width: request.width,
    look,
    frame,
    title: {
      text: displayPath(filePath, request.cwd, request.home),
      href: fileHref(filePath),
      wrap: "truncate-start",
    },
    tags: tagsOf(request.change, stat, look),
    body,
    hiddenLines: shown.hiddenLines,
  });
}

function framePanel(ui: Ui, spec: PanelSpec): DiffWindow {
  const { Box, Text } = ui;
  const { look, frame } = spec;
  const innerWidth = spec.width - FRAME_COLUMNS;
  const element = (
    <Box
      key={spec.key}
      flexDirection="column"
      {...frame.margins}
      width={spec.width}
      borderStyle="round"
      borderColor={look.accent}
    >
      {headerView(ui, spec, innerWidth)}
      {spec.body === null ? null : (
        <Box key="header-rule" width={innerWidth}>
          <Text color={look.accent} wrap="truncate-end">
            {"─".repeat(innerWidth)}
          </Text>
        </Box>
      )}
      {spec.body}
      {frame.isHiddenNoted && spec.hiddenLines > 0 ? (
        <Box key="fold" paddingX={1}>
          <Text color={look.muted}>{`… +${spec.hiddenLines} lines`}</Text>
        </Box>
      ) : null}
    </Box>
  );
  return { element, hiddenLines: frame.isHiddenNoted ? 0 : spec.hiddenLines };
}

function toolSpec(ui: Ui, request: ToolPanelRequest): PanelSpec {
  const look = replyLook(request.accent, request.fills);
  const { detail } = request;
  const parts =
    detail.kind === "read"
      ? readParts(ui, request, detail, look)
      : bashParts(ui, request, detail, look);
  return {
    key: `tool-${request.toolUseId}`,
    width: request.width,
    look,
    frame: CHAT_FRAME,
    ...parts,
  };
}

function readParts(
  ui: Ui,
  request: ToolPanelRequest,
  detail: ReadDetail,
  look: ReplyLook,
): PanelParts {
  const { Code } = ui;
  const title: Title = {
    text: displayPath(detail.filePath, request.cwd, request.home),
    href: fileHref(detail.filePath),
    wrap: "truncate-start",
  };
  const lines = linesOf(detail.content);
  if (lines.length === 0)
    return {
      title,
      tags: [],
      body: noteRow(ui, look, "empty file"),
      hiddenLines: 0,
    };
  const { shown, hiddenLines } = foldLines(
    lines,
    request.isExpanded,
    detail.numLines - lines.length,
  );
  const lastLine = detail.startLine + detail.numLines - 1;
  return {
    title,
    tags: [
      {
        key: "range",
        text: `lines ${detail.startLine}-${lastLine} of ${detail.totalLines}`,
        color: look.muted,
      },
    ],
    body: (
      <Code
        key="body"
        path={detail.filePath}
        source={shown.join("\n")}
        startLine={detail.startLine}
        wrap={wrapOf(request.isExpanded)}
      />
    ),
    hiddenLines,
  };
}

function bashParts(
  ui: Ui,
  request: ToolPanelRequest,
  detail: BashDetail,
  look: ReplyLook,
): PanelParts {
  const { Box, Text } = ui;
  const [commandLine = ""] = detail.command.split("\n");
  const title: Title = {
    text: commandLine === "" ? "Bash" : commandLine,
    wrap: "truncate-end",
  };
  const tags = [request.isDenied ? deniedTag(look) : bashTag(detail, look)];
  const stderrColor = isFailedRun(detail) ? look.prose : look.removed;
  const rows = [
    ...linesOf(detail.stdout).map((text) => ({ text, color: look.prose })),
    ...linesOf(detail.stderr).map((text) => ({ text, color: stderrColor })),
  ];
  if (rows.length === 0)
    return {
      title,
      tags,
      body: detail.tag === BACKGROUND_TAG ? null : noteRow(ui, look, "no output"),
      hiddenLines: detail.droppedLines,
    };
  const { shown, hiddenLines } = foldLines(rows, request.isExpanded, detail.droppedLines);
  return {
    title,
    tags,
    body: (
      <Box key="body" flexDirection="column" paddingX={1}>
        {shown.map(({ text, color }, index) => (
          <Text key={`row-${index}`} color={color} wrap={wrapOf(request.isExpanded)}>
            {text === "" ? " " : text}
          </Text>
        ))}
      </Box>
    ),
    hiddenLines,
  };
}

function isFailedRun({ exitCode, tag }: BashDetail): boolean {
  return exitCode === null ? tag === "" : exitCode > 0;
}

function noteRow({ Box, Text }: Ui, look: ReplyLook, text: string): RenderElement {
  return (
    <Box key="body" paddingX={1}>
      <Text color={look.muted}>{text}</Text>
    </Box>
  );
}

function deniedTag(look: ReplyLook): Tag {
  return { key: "exit", text: `${DENIED_GLYPH} denied`, color: look.alert.warning };
}

function bashTag({ exitCode, tag }: BashDetail, look: ReplyLook): Tag {
  if (exitCode === 0) return { key: "exit", text: "exit 0", color: look.added };
  if (exitCode !== null) return { key: "exit", text: `exit ${exitCode}`, color: look.removed };
  if (tag === "interrupted") return { key: "exit", text: tag, color: look.removed };
  if (tag !== "") return { key: "exit", text: tag, color: look.muted };
  return { key: "exit", text: "failed", color: look.removed };
}

function linesOf(text: string): string[] {
  return text === "" ? [] : text.replace(/\n$/, "").split("\n");
}

function foldLines<T>(
  rows: T[],
  isExpanded: boolean,
  droppedLines: number,
): { shown: T[]; hiddenLines: number } {
  const isWhole = isExpanded || rows.length <= FOLDED_LINES + 1;
  const shown = isWhole ? rows : rows.slice(0, FOLDED_LINES);
  return { shown, hiddenLines: rows.length - shown.length + droppedLines };
}

const wrapOf = (isExpanded: boolean): "wrap" | "truncate-end" =>
  isExpanded ? "wrap" : "truncate-end";

const fileHref = (path: string): string => `file://${encodeURI(path)}`;

function headerView(ui: Ui, spec: PanelSpec, width: number): RenderElement {
  const { Box, Link, Text } = ui;
  const { title, tags, look, frame } = spec;
  const style = { weight: "semibold", color: frame.titleColor(look) } as const;
  const label = <Text {...style}>{title.text}</Text>;
  const text = (
    <Text {...style} wrap={title.wrap}>
      {title.href === undefined ? title.text : <Link href={title.href}>{label}</Link>}
    </Text>
  );
  return (
    <Box key="header" width={width}>
      <Box flexGrow={1} flexShrink={1} minWidth={0} paddingX={1}>
        {text}
      </Box>
      {tags.length === 0 ? null : (
        <Box flexShrink={0} columnGap={1} paddingRight={1}>
          {tags.map(({ key, text: label, color }) => (
            <Text key={key} color={color}>
              {label}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

function displayPath(path: string, cwd: string, home: string | undefined): string {
  if (cwd !== "" && path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
  if (home && path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
  return path;
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

export function fitHunks(
  hunks: Hunk[],
  limit: BodyRoom = CHAT_ROOM,
): { hunks: Hunk[]; hiddenLines: number } {
  const shown: Hunk[] = [];
  let rows = 0;
  let chars = 0;
  for (const hunk of hunks) {
    const room = {
      rows: limit.rows - rows - (shown.length > 0 ? 1 : 0),
      chars: limit.chars - chars,
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

function linesWithin(lines: string[], room: BodyRoom): number {
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

export const DIFF_CHAR_LIMIT = 100_000;

const CONTROL_CHARACTER = /\r(?=[^\n])|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const CONTROL_PICTURES_START = 0x2400;
const DELETE_PICTURE = "\u2421";
const C1_STAND_IN = "\ufffd";

export function visibleControls(text: string): string {
  return text.replace(CONTROL_CHARACTER, (character) => {
    const code = character.charCodeAt(0);
    if (code === 0x7f) return DELETE_PICTURE;
    return code < 0x20 ? String.fromCharCode(CONTROL_PICTURES_START + code) : C1_STAND_IN;
  });
}

export function wholeHunks(text: string): string {
  const start = text.indexOf("@@");
  if (start === -1) return "";
  const kept: string[] = [];
  let chars = 0;
  for (const hunk of text.slice(start).split(/\n(?=@@ )/)) {
    chars += hunk.length + 1;
    if (chars > DIFF_CHAR_LIMIT && kept.length > 0) break;
    kept.push(hunk);
  }
  return kept.join("\n");
}
