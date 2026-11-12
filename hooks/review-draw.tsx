import type { ElementTable, RenderElement } from "claude-code";

import type {
  ReviewConfirm,
  PressedLine,
  ReviewDraft,
  ReviewHunk,
  ReviewListComment,
  ReviewListFile,
  ReviewState,
} from "../types";
import { visibleControls } from "./diff-panel";
import { relocatedLine } from "./review-comments";
import { button, header, labelButton, paneHeaderLook } from "./pane-kit";
import { paneInk } from "./pane-ink";
import { TAB_BAR_ROWS } from "./tab-bar";
import { clipStart, displayWidth } from "./text-width";

type Ui = ElementTable;

type Scope = ReviewState["scope"];

export type ReviewView = {
  state: ReviewState;
  width: number;
  height: number;
  offset: number;
  setScope: (scope: Scope) => void;
  openFile: (path: string) => void;
  closeFile: () => void;
  step: (delta: number) => void;
  askRevert: (confirm: ReviewConfirm) => void;
  answerRevert: (isYes: boolean) => void;
  pressLine: (line: PressedLine) => void;
  submitComment: (text: string) => void;
  typeComment: (text: string) => void;
  isDiscardArmed: boolean;
  toggleSeen: (path: string) => void;
};

type Row = { key: string; height: number; isPinned?: boolean; draw: () => RenderElement };

type DiffLine = { marker: string; text: string; side: "new" | "old"; number: number };

const SCOPES: { id: Scope; label: string }[] = [
  { id: "session", label: "session" },
  { id: "uncommitted", label: "uncommitted" },
  { id: "main", label: "main" },
];

const OVERSCAN_ROWS = 6;
const SCOPE_GAP_CELLS = 2;
const LETTER_CELLS = 1;
const TICK_CELLS = 2;
const ANSWER_FRAME_CELLS = 4;
const CHIP_PAD_CELLS = 2;
const SCOPE_LABEL = "scope";
const REVIEWED_MARK = "✓";
const COLUMN_GAP_CELLS = 2;
const MIN_DETAIL_PATH_CELLS = 8;
const LETTER_GAP_CELLS = 1;
const OUTDATED_SEPARATOR = " · ";
const COMMENT_HINT = "click a diff line to comment";
const HEADER_SEPARATOR = " · ";
const NAV_BASE_CELLS = 8 + 5 + 5 + 3 + 1;
const ELLIPSIS_FOLDER = "…/";
const TAB_SPACES = "    ";
const COMMENT_INDENT = "  ";
const COMMENT_PEN = "✎";
const COMMENT_RAIL = "│";
const COMMENT_LEAD = `${COMMENT_INDENT}${COMMENT_PEN} `;
const COMMENT_CONTINUATION = `${COMMENT_INDENT}${COMMENT_RAIL} `;
const RESOLVED_SUFFIX = "  ✓ resolved";
const GUTTER_GAP_CELLS = 1;
const MARKER_CELLS = 1;
const NO_NEWLINE_MARKER = "\\";
const NOT_PRESSABLE_LINE = 0;

const STATUS_LETTER = { added: "A", modified: "M", deleted: "D" } as const;
const HUNK_NOTE = { added: " · new file", modified: "", deleted: " · deleted file" } as const;
const EMPTY_CHANGE_NOTE = {
  added: "created empty",
  modified: "mode change",
  deleted: "deleted",
} as const;

export function reviewTab(ui: Ui, view: ReviewView): RenderElement {
  const file = view.state.files.find(({ path }) => path === view.state.openPath);
  return file ? fileView(ui, view, file) : listView(ui, view);
}

export function commentInputKey(draft: ReviewDraft): string {
  return `comment-${draft.side}-${draft.line}-${draft.opening}`;
}

function listView(ui: Ui, view: ReviewView): RenderElement {
  const { Box } = ui;
  const { state, width } = view;
  const columns = listColumns(state);
  const changed = state.files.filter((file) => !isBare(file));
  const bare = state.files.filter(isBare);
  const rows = (files: ReviewListFile[]): RenderElement[] =>
    files.map((file) => listRow(ui, view, file, columns));
  const body =
    state.reason === null
      ? [
          changed.length > 0 ? summaryRow(ui, changed) : noteText(ui, "none", "no changes"),
          ...totalsRow(ui, view, changed),
          ...rows(changed),
          ...(bare.length > 0 ? commentsOnlyRows(ui, view, rows(bare)) : []),
          ...droppedRows(ui, state),
        ]
      : [noteText(ui, "reason", state.reason)];
  return (
    <Box flexDirection="column" width={width}>
      {scopeRow(ui, view)}
      {body}
    </Box>
  );
}

function commentsOnlyRows(ui: Ui, view: ReviewView, rows: RenderElement[]): RenderElement[] {
  const { Box } = ui;
  return [
    <Box key="bare-gap" height={1} />,
    <Box key="bare" flexShrink={0}>
      {header(ui, "comments only", paneHeaderLook(), view.width)}
    </Box>,
    ...rows,
  ];
}

function noteText({ Text }: Ui, key: string, text: string): RenderElement {
  return (
    <Text key={key} color={paneInk().muted} wrap="truncate-end">
      {text}
    </Text>
  );
}

function scopeRow(ui: Ui, view: ReviewView): RenderElement {
  const { Box, Text } = ui;
  const scopeCells = SCOPES.reduce((sum, { label }) => sum + label.length + CHIP_PAD_CELLS, 0);
  const hasLabel = view.width >= SCOPE_LABEL.length + SCOPE_GAP_CELLS + scopeCells;
  return (
    <Box flexDirection="row" height={1}>
      {hasLabel ? (
        <Box key="scope-label" marginRight={SCOPE_GAP_CELLS}>
          <Text color={paneInk().muted} wrap="truncate-end">
            {SCOPE_LABEL}
          </Text>
        </Box>
      ) : null}
      {SCOPES.map(({ id, label }) =>
        id === view.state.scope ? (
          <Text
            key={id}
            weight="semibold"
            color={paneInk().tabText}
            backgroundColor={paneInk().tabFill}
            wrap="truncate-end"
          >
            {` ${label} `}
          </Text>
        ) : (
          <Box key={id} flexDirection="row">
            <Text wrap="truncate-end"> </Text>
            {labelButton(ui, { key: id, label, onPress: () => view.setScope(id) })}
            <Text wrap="truncate-end"> </Text>
          </Box>
        ),
      )}
    </Box>
  );
}

function summaryRow(ui: Ui, changed: ReviewListFile[]): RenderElement {
  const { Text } = ui;
  const added = changed.reduce((sum, file) => sum + file.added, 0);
  const removed = changed.reduce((sum, file) => sum + file.removed, 0);
  return (
    <Text wrap="truncate-end">
      <Text weight="semibold" color={paneInk().text} wrap="truncate-end">
        {changed.length}
      </Text>
      <Text color={paneInk().muted} wrap="truncate-end">
        {` ${changed.length === 1 ? "file" : "files"} `}
      </Text>
      {countPieces(ui, added, removed, NO_PADDING)}
    </Text>
  );
}

function totalsRow(ui: Ui, view: ReviewView, changed: ReviewListFile[]): RenderElement[] {
  const { Box, Text } = ui;
  const open = view.state.comments.filter((comment) => !comment.resolved).length;
  if (changed.length === 0 && open === 0) return [];
  const reviewed = changed.filter((file) => isReviewed(view.state, file)).length;
  const pen = `${COMMENT_PEN} ${open}`;
  const rest = ` open${changed.length > 0 ? `${HEADER_SEPARATOR}${reviewed} of ${changed.length} reviewed` : ""}`;
  const hasRoomForHint =
    changed.some((file) => !file.isBinary && file.added + file.removed > 0) &&
    view.width >= displayWidth(pen) + displayWidth(rest) + 2 + COMMENT_HINT.length;
  return [
    <Box key="totals" flexDirection="row" width={view.width} height={1}>
      <Box flexShrink={1} minWidth={0}>
        <Text wrap="truncate-end">
          <Text color={open > 0 ? paneInk().alert : paneInk().muted} wrap="truncate-end">
            {pen}
          </Text>
          <Text color={paneInk().muted} wrap="truncate-end">
            {rest}
          </Text>
        </Text>
      </Box>
      {hasRoomForHint ? (
        <Box flexGrow={1} flexShrink={1} minWidth={0} justifyContent="flex-end">
          <Text color={paneInk().muted} wrap="truncate-end">
            {COMMENT_HINT}
          </Text>
        </Box>
      ) : null}
    </Box>,
  ];
}

function isReviewed(state: ReviewState, file: ReviewListFile): boolean {
  return state.seen[file.path] === file.stamp;
}

function droppedRows(ui: Ui, { dropped }: ReviewState): RenderElement[] {
  if (dropped.length === 0) return [];
  return [
    noteText(ui, "dropped", `${dropped.length} edited, not in git diff`),
    ...dropped.map((path) => noteText(ui, `dropped:${path}`, path)),
  ];
}

function isBare(file: ReviewListFile): boolean {
  return file.isCommentOnly;
}

type ListColumns = { tailCells: number; counts: CountCells };

type CountCells = { added: number; removed: number };

const NO_PADDING: CountCells = { added: 0, removed: 0 };

function listColumns(state: ReviewState): ListColumns {
  const tails = state.files.map((file) => openCommentCount(state.comments, file.path));
  const changed = state.files.filter((file) => !isBare(file));
  return {
    tailCells: Math.max(0, ...tails.map((count) => displayWidth(commentTail(count)))),
    counts: {
      added: Math.max(0, ...changed.map((file) => `+${file.added}`.length)),
      removed: Math.max(0, ...changed.map((file) => `-${file.removed}`.length)),
    },
  };
}

function commentTail(count: number): string {
  return count > 0 ? `${COMMENT_PEN} ${count}` : "";
}

function listRow(
  ui: Ui,
  view: ReviewView,
  file: ReviewListFile,
  columns: ListColumns,
): RenderElement {
  const { Box, Button, Text } = ui;
  const { tailCells, counts } = columns;
  const open = openCommentCount(view.state.comments, file.path);
  const countCells = counts.added + 1 + counts.removed;
  const tailSection = tailCells > 0 ? COLUMN_GAP_CELLS + tailCells : 0;
  const prefixCells = TICK_CELLS + LETTER_CELLS + LETTER_GAP_CELLS;
  const rightCells = tailSection + COLUMN_GAP_CELLS + countCells;
  const pathCells = Math.max(1, view.width - prefixCells - rightCells);
  const { folder, name } = fittedPath(file.path, pathCells);
  const padding = " ".repeat(Math.max(0, pathCells - displayWidth(folder) - displayWidth(name)));
  return (
    <Box key={`file:${file.path}`} width={view.width} height={1}>
      <Button key={`open:${file.path}`} plain onPress={() => view.openFile(file.path)}>
        <Text wrap="truncate-end">
          <Text color={paneInk().ok} wrap="truncate-end">
            {isReviewed(view.state, file) ? `${REVIEWED_MARK} ` : " ".repeat(TICK_CELLS)}
          </Text>
          <Text color={letterColor(file)} wrap="truncate-end">
            {isBare(file) ? " " : STATUS_LETTER[file.status]}
          </Text>
          <Text wrap="truncate-end"> </Text>
          <Text color={paneInk().muted} wrap="truncate-end">
            {folder}
          </Text>
          <Text color={paneInk().text} wrap="truncate-end">
            {name}
          </Text>
          <Text wrap="truncate-end">{padding}</Text>
          {isBare(file) ? bareTail(ui, open, rightCells) : changedTail(ui, file, open, columns)}
        </Text>
      </Button>
    </Box>
  );
}

function bareTail({ Text }: Ui, open: number, cells: number): RenderElement {
  return (
    <Text color={paneInk().alert} wrap="truncate-end">
      {commentTail(open).padStart(cells)}
    </Text>
  );
}

function changedTail(
  ui: Ui,
  file: ReviewListFile,
  open: number,
  { tailCells, counts }: ListColumns,
): RenderElement[] {
  const { Text } = ui;
  return [
    ...(tailCells > 0
      ? [
          <Text key="tail" color={paneInk().alert} wrap="truncate-end">
            {`${" ".repeat(COLUMN_GAP_CELLS)}${commentTail(open).padEnd(tailCells)}`}
          </Text>,
        ]
      : []),
    <Text key="tail-gap" wrap="truncate-end">
      {" ".repeat(COLUMN_GAP_CELLS)}
    </Text>,
    ...countPieces(ui, file.added, file.removed, counts),
  ];
}

function fittedPath(path: string, cells: number): { folder: string; name: string } {
  const segments = path.split("/");
  const name = segments.at(-1) ?? path;
  const folders = segments.slice(0, -1);
  if (displayWidth(path) <= cells)
    return { folder: folders.map((part) => `${part}/`).join(""), name };
  for (let dropped = 1; dropped <= folders.length; dropped++) {
    const folder = `${ELLIPSIS_FOLDER}${folders
      .slice(dropped)
      .map((part) => `${part}/`)
      .join("")}`;
    if (displayWidth(folder) + displayWidth(name) <= cells) return { folder, name };
  }
  return { folder: "", name: clipStart(name, cells) };
}

function countsText(ui: Ui, file: ReviewListFile, cells: CountCells): RenderElement {
  const { Text } = ui;
  return <Text wrap="truncate-end">{countPieces(ui, file.added, file.removed, cells)}</Text>;
}

function countPieces(
  { Text }: Ui,
  added: number,
  removed: number,
  cells: CountCells,
): RenderElement[] {
  return [
    <Text key="added" color={added > 0 ? paneInk().ok : paneInk().muted} wrap="truncate-end">
      {`+${added}`.padStart(cells.added)}
    </Text>,
    <Text
      key="removed"
      color={removed > 0 ? paneInk().failed : paneInk().muted}
      wrap="truncate-end"
    >
      {` ${`-${removed}`.padStart(cells.removed)}`}
    </Text>,
  ];
}

function letterColor(file: ReviewListFile): string | undefined {
  if (isBare(file)) return paneInk().muted;
  if (file.status === "added") return paneInk().ok;
  return file.status === "deleted" ? paneInk().failed : paneInk().alert;
}

function openCommentCount(comments: ReviewListComment[], path: string): number {
  return comments.filter((comment) => comment.file === path && !comment.resolved).length;
}

function fileView(ui: Ui, view: ReviewView, file: ReviewListFile): RenderElement {
  const { Box } = ui;
  return (
    <Box flexDirection="column" width={view.width}>
      {windowed(ui, view, fileRows(ui, view, file))}
    </Box>
  );
}

function windowed(ui: Ui, view: ReviewView, rows: Row[]): RenderElement[] {
  const { Box } = ui;
  const top = view.offset - OVERSCAN_ROWS;
  const bottom = view.offset + view.height + OVERSCAN_ROWS;
  let begin = TAB_BAR_ROWS;
  return rows.map((row) => {
    const start = begin;
    begin += row.height;
    const isInWindow = start < bottom && start + row.height > top;
    return row.isPinned || isInWindow ? (
      row.draw()
    ) : (
      <Box key={`${row.key}-spacer`} height={row.height} />
    );
  });
}

function fileRows(ui: Ui, view: ReviewView, file: ReviewListFile): Row[] {
  const { state } = view;
  const fileComments = state.comments.filter((comment) => comment.file === file.path);
  const numbered = state.hunks.map(numberedLines);
  const located = fileComments.map((comment) => locatedComment(comment, numbered.flat()));
  const comments = located.flatMap((comment) => (comment === null ? [] : [comment]));
  const outdated = fileComments.filter((_, i) => located[i] === null);
  return [
    ...headRows(ui, view, file),
    ...(numbered.length === 0 && !file.isBinary && !view.state.isDiffCut
      ? [noteRow(ui, "empty", emptyNote(file))]
      : []),
    ...outdatedRows(ui, view, outdated),
    ...bodyRows(ui, view, file, numbered, comments),
    ...revertFileRows(ui, view, file),
  ];
}

function emptyNote(file: ReviewListFile): string {
  if (file.isCommentOnly) return "no changes in this scope";
  return EMPTY_CHANGE_NOTE[file.status];
}

function headRows(ui: Ui, view: ReviewView, file: ReviewListFile): Row[] {
  const toggle = isBare(file) ? null : reviewToggle(ui, view, file);
  const isToggleBelow = toggle !== null && !toggleFitsPathRow(view.width, file, toggle.cells);
  return [
    { key: "nav", height: 1, draw: () => navRow(ui, view, file) },
    gapRow(ui, "nav-gap"),
    {
      key: "path",
      height: 1,
      draw: () => pathRow(ui, view, file, isToggleBelow ? null : toggle),
    },
    ...(toggle && isToggleBelow ? [{ key: "toggle", height: 1, draw: () => toggle.element }] : []),
    ...errorRows(ui, view),
  ];
}

function gapRow({ Box }: Ui, key: string): Row {
  return { key, height: 1, draw: () => <Box key={key} height={1} /> };
}

function revertFileRows(ui: Ui, view: ReviewView, file: ReviewListFile): Row[] {
  if (file.isCommentOnly) return [];
  const isConfirming = isAsking(view, { kind: "file" });
  return [
    gapRow(ui, "revert-gap"),
    {
      key: "revert-file",
      height: 1,
      isPinned: isConfirming,
      draw: () =>
        isConfirming
          ? confirmPrompt(ui, view, "file")
          : answerButton(ui, {
              key: "revert-file",
              parts: [{ text: "revert file", color: paneInk().failed }],
              onPress: () => view.askRevert({ kind: "file" }),
            }),
    },
  ];
}

function navRow(ui: Ui, view: ReviewView, file: ReviewListFile): RenderElement {
  const { Box, Text } = ui;
  const position = `${view.state.files.indexOf(file) + 1}/${view.state.files.length}`;
  const hasPressableLine = !file.isBinary && view.state.hunks.some(hasPressableLines);
  const hasRoomForHint =
    hasPressableLine && view.width >= NAV_BASE_CELLS + position.length + COMMENT_HINT.length + 2;
  return (
    <Box key="nav" flexDirection="row" columnGap={1} width={view.width} height={1}>
      {button(ui, { key: "back", label: "back", onPress: view.closeFile })}
      {button(ui, { key: "prev", label: "<", onPress: () => view.step(-1) })}
      {button(ui, { key: "next", label: ">", onPress: () => view.step(1) })}
      <Box flexShrink={0} marginLeft={1}>
        <Text color={paneInk().muted} wrap="truncate-end">
          {position}
        </Text>
      </Box>
      {hasRoomForHint ? (
        <Box flexGrow={1} flexShrink={1} minWidth={0} justifyContent="flex-end">
          <Text color={paneInk().muted} wrap="truncate-end">
            {COMMENT_HINT}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

function hasPressableLines(hunk: ReviewHunk): boolean {
  return hunk.lines.some((raw) => !raw.startsWith(NO_NEWLINE_MARKER));
}

function pathRow(
  ui: Ui,
  view: ReviewView,
  file: ReviewListFile,
  toggle: ToggleDraw | null,
): RenderElement {
  const { Box, Text } = ui;
  const counts = isBare(file) ? "" : detailCounts(file);
  const gap = detailGap(view.width, counts, toggle?.cells ?? 0);
  const { folder, name } = fittedPath(
    file.path,
    Math.max(
      1,
      view.width - (counts === "" ? 0 : counts.length + gap) - (toggle ? toggle.cells + gap : 0),
    ),
  );
  return (
    <Box key="path" flexDirection="row" width={view.width} height={1} columnGap={gap}>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="truncate-end">
          <Text color={paneInk().muted} wrap="truncate-end">
            {folder}
          </Text>
          <Text color={paneInk().text} weight="semibold" wrap="truncate-end">
            {name}
          </Text>
        </Text>
      </Box>
      {isBare(file) ? null : <Box flexShrink={0}>{countsText(ui, file, NO_PADDING)}</Box>}
      {toggle?.element}
    </Box>
  );
}

function detailCounts(file: ReviewListFile): string {
  return `+${file.added} -${file.removed}`;
}

function toggleFitsPathRow(width: number, file: ReviewListFile, toggleCells: number): boolean {
  const name = file.path.split("/").at(-1) ?? file.path;
  const taken = displayWidth(name) + detailCounts(file).length + toggleCells + 2;
  return taken <= width;
}

function detailGap(width: number, counts: string, toggleCells: number): number {
  const sides = (counts === "" ? 0 : 1) + (toggleCells > 0 ? 1 : 0);
  const taken = counts.length + toggleCells + sides * COLUMN_GAP_CELLS;
  return width - taken >= MIN_DETAIL_PATH_CELLS ? COLUMN_GAP_CELLS : 1;
}

type ToggleDraw = { element: RenderElement; cells: number };

function reviewToggle(ui: Ui, view: ReviewView, file: ReviewListFile): ToggleDraw {
  const parts = isReviewed(view.state, file)
    ? [
        { text: REVIEWED_MARK, color: paneInk().ok },
        { text: " reviewed", color: paneInk().text },
      ]
    : [{ text: "mark reviewed", color: paneInk().text }];
  return {
    element: answerButton(ui, {
      key: "mark-reviewed",
      parts,
      onPress: () => view.toggleSeen(file.path),
    }),
    cells: ANSWER_FRAME_CELLS + parts.reduce((sum, part) => sum + displayWidth(part.text), 0),
  };
}

function isAsking(view: ReviewView, target: ReviewConfirm): boolean {
  const { confirm } = view.state;
  return confirm !== null && JSON.stringify(confirm) === JSON.stringify(target);
}

type AnswerPart = { text: string; color: string | undefined };

type Answer = { key: string; parts: AnswerPart[]; onPress: () => void };

function confirmPrompt(ui: Ui, view: ReviewView, what: "file" | "hunk"): RenderElement {
  const { Box, Text } = ui;
  return (
    <Box key="confirm" flexDirection="row" flexShrink={0} columnGap={1}>
      <Text weight="semibold" color={paneInk().failed} wrap="truncate-end">
        {`revert ${what}?`}
      </Text>
      {answerButton(ui, {
        key: "yes",
        parts: [{ text: "yes", color: paneInk().failed }],
        onPress: () => view.answerRevert(true),
      })}
      {answerButton(ui, {
        key: "no",
        parts: [{ text: "no", color: paneInk().text }],
        onPress: () => view.answerRevert(false),
      })}
    </Box>
  );
}

function answerButton({ Box, Button, Text }: Ui, answer: Answer): RenderElement {
  return (
    <Box key={answer.key} flexDirection="row" flexShrink={0}>
      <Text color={paneInk().muted} wrap="truncate-end">
        [{" "}
      </Text>
      <Button key={answer.key} plain onPress={answer.onPress}>
        {answer.parts.map((part, i) => (
          <Text key={`${answer.key}:${i}`} color={part.color} wrap="truncate-end">
            {part.text}
          </Text>
        ))}
      </Button>
      <Text color={paneInk().muted} wrap="truncate-end">
        {" "}
        ]
      </Text>
    </Box>
  );
}

function errorRows(ui: Ui, view: ReviewView): Row[] {
  const { error } = view.state;
  if (error === null) return [];
  const lines = wrapWithPrefix(error, { first: "", next: "" }, view.width);
  return [
    {
      key: "error",
      height: lines.length,
      draw: () => textLines(ui, "error", lines, paneInk().failed),
    },
  ];
}

function bodyRows(
  ui: Ui,
  view: ReviewView,
  file: ReviewListFile,
  numbered: DiffLine[][],
  comments: ReviewListComment[],
): Row[] {
  if (file.isBinary) return [noteRow(ui, "binary", "binary file")];
  const { Box } = ui;
  const gutterCells = Math.max(...numbered.flat().map((line) => String(line.number).length), 1);
  const hunks = view.state.hunks.flatMap((hunk, index) =>
    hunkRows(ui, view, file, { hunk, index, lines: numbered[index] ?? [], comments, gutterCells }),
  );
  const gap: Row[] =
    hunks.length > 0
      ? [{ key: "hunks-gap", height: 1, draw: () => <Box key="hunks-gap" height={1} /> }]
      : [];
  if (view.state.isDiffCut) return [...gap, ...hunks, noteRow(ui, "too-large", "diff too large")];
  return [...gap, ...hunks, ...cutRows(ui, view, file)];
}

function cutRows(ui: Ui, view: ReviewView, file: ReviewListFile): Row[] {
  const shown = view.state.hunks
    .flatMap((hunk) => hunk.lines)
    .filter((line) => line.startsWith("+") || line.startsWith("-")).length;
  const hidden = file.added + file.removed - shown;
  return hidden > 0 ? [noteRow(ui, "cut", `… ${hidden} more lines`)] : [];
}

function noteRow({ Text }: Ui, key: string, text: string): Row {
  return {
    key,
    height: 1,
    draw: () => (
      <Text key={key} color={paneInk().muted} wrap="truncate-end">
        {text}
      </Text>
    ),
  };
}

type HunkSpec = {
  hunk: ReviewHunk;
  index: number;
  lines: DiffLine[];
  comments: ReviewListComment[];
  gutterCells: number;
};

function hunkRows(ui: Ui, view: ReviewView, file: ReviewListFile, spec: HunkSpec): Row[] {
  const canRevert = file.status === "modified" && !file.isBinary;
  const lines = spec.lines.flatMap((line, i) =>
    lineRows(ui, view, {
      line,
      key: `line:${spec.index}:${i}`,
      comments: spec.comments,
      gutterCells: spec.gutterCells,
    }),
  );
  return [
    ...(spec.index > 0 ? [gapRow(ui, `hunk-gap:${spec.index}`)] : []),
    {
      key: `hunk:${spec.index}`,
      height: 1,
      isPinned: isAsking(view, { kind: "hunk", index: spec.index }),
      draw: () => hunkHeader(ui, view, file, spec, canRevert),
    },
    ...lines,
  ];
}

function hunkHeader(
  ui: Ui,
  view: ReviewView,
  file: ReviewListFile,
  spec: HunkSpec,
  canRevert: boolean,
): RenderElement {
  const { Box, Text } = ui;
  const { hunk } = spec;
  const label = hunkTitle(hunk, file);
  return (
    <Box key={`hunk:${spec.index}`} flexDirection="row" width={view.width} height={1} columnGap={1}>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text color={paneInk().muted} wrap="truncate-end">
          {label}
        </Text>
      </Box>
      {canRevert ? hunkAction(ui, view, spec) : null}
    </Box>
  );
}

function hunkTitle(hunk: ReviewHunk, file: ReviewListFile): string {
  const line = file.status === "deleted" ? hunk.oldStart : hunk.newStart;
  return `@@ line ${line}${HUNK_NOTE[file.status]}`;
}

function hunkAction(ui: Ui, view: ReviewView, spec: HunkSpec): RenderElement {
  if (isAsking(view, { kind: "hunk", index: spec.index })) return confirmPrompt(ui, view, "hunk");
  return button(ui, {
    key: `revert-hunk:${spec.index}`,
    label: "revert hunk",
    onPress: () => view.askRevert({ kind: "hunk", index: spec.index }),
  });
}

type LineSpec = { line: DiffLine; key: string; comments: ReviewListComment[]; gutterCells: number };

function lineRows(ui: Ui, view: ReviewView, { line, key, comments, gutterCells }: LineSpec): Row[] {
  const number = line.number === NOT_PRESSABLE_LINE ? "" : String(line.number);
  const chunks = wrapWithPrefix(
    visibleControls(line.text).replaceAll("\t", TAB_SPACES),
    {
      first: `${number.padStart(gutterCells)}${" ".repeat(GUTTER_GAP_CELLS)}${line.marker}`,
      next: " ".repeat(gutterCells + GUTTER_GAP_CELLS + MARKER_CELLS),
    },
    view.width,
  );
  const attached = comments.filter(
    (comment) => comment.side === line.side && comment.line === line.number,
  );
  const { draft } = view.state;
  const isDrafting = draft !== null && draft.side === line.side && draft.line === line.number;
  return [
    {
      key,
      height: chunks.length,
      draw: () => lineElement(ui, view, { line, key, chunks, isOpen: isDrafting, gutterCells }),
    },
    ...attached.flatMap((comment) => commentRows(ui, view, comment, "")),
    ...(isDrafting && line.number !== NOT_PRESSABLE_LINE
      ? [...discardHintRows(ui, view), ...inputRows(ui, view, draft)]
      : []),
  ];
}

type LineDraw = {
  line: DiffLine;
  key: string;
  chunks: string[];
  isOpen: boolean;
  gutterCells: number;
};

function lineElement(
  ui: Ui,
  view: ReviewView,
  { line, key, chunks, isOpen, gutterCells }: LineDraw,
): RenderElement {
  const { Box, Button, Text } = ui;
  const color = lineColor(line.marker);
  const weight = isOpen ? "semibold" : undefined;
  const press = (): void => view.pressLine({ side: line.side, line: line.number, code: line.text });
  const gutterEnd = gutterCells + GUTTER_GAP_CELLS;
  const drawn = (chunk: string, i: number): RenderElement => (
    <Text key={`${key}:${i}:text`} wrap="truncate-end">
      <Text color={paneInk().muted} wrap="truncate-end">
        {chunk.slice(0, gutterEnd)}
      </Text>
      <Text color={color} weight={weight} wrap="truncate-end">
        {chunk.slice(gutterEnd)}
      </Text>
    </Text>
  );
  return (
    <Box key={key} flexDirection="column">
      {chunks.map((chunk, i) =>
        line.number === NOT_PRESSABLE_LINE ? (
          drawn(chunk, i)
        ) : (
          <Button key={i === 0 ? key : `${key}:${i}`} plain onPress={press}>
            {drawn(chunk, i)}
          </Button>
        ),
      )}
    </Box>
  );
}

function lineColor(marker: string): string | undefined {
  if (marker === "+") return paneInk().ok;
  if (marker === "-") return paneInk().failed;
  return marker === NO_NEWLINE_MARKER ? paneInk().muted : paneInk().text;
}

function inputRows(ui: Ui, view: ReviewView, draft: ReviewDraft): Row[] {
  if (!("Input" in ui)) return [];
  const { Box, Input, Text } = ui;
  const key = commentInputKey(draft);
  return [
    {
      key,
      height: 1,
      isPinned: true,
      draw: () => (
        <Box key={key} flexDirection="row" width={view.width} height={1}>
          <Box flexShrink={0}>
            <Text color={paneInk().text} wrap="truncate-end">
              {COMMENT_LEAD}
            </Text>
          </Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Input
              key={key}
              placeholder={`comment on line ${draft.line}`}
              submitLabel="save"
              autoFocus
              onInput={view.typeComment}
              onSubmit={view.submitComment}
            />
          </Box>
        </Box>
      ),
    },
  ];
}

function discardHintRows(ui: Ui, view: ReviewView): Row[] {
  if (!view.isDiscardArmed) return [];
  const { Text } = ui;
  return [
    {
      key: "discard-hint",
      height: 1,
      isPinned: true,
      draw: () => (
        <Text key="discard-hint" color={paneInk().muted} wrap="truncate-end">
          {`${COMMENT_CONTINUATION}Esc again discards this comment`}
        </Text>
      ),
    },
  ];
}

function outdatedRows(ui: Ui, view: ReviewView, comments: ReviewListComment[]): Row[] {
  if (comments.length === 0) return [];
  const { Box } = ui;
  const byLine = [...comments].sort((a, b) => a.line - b.line);
  const lineCells = Math.max(...byLine.map((comment) => String(comment.line).length));
  return [
    { key: "outdated-gap", height: 1, draw: () => <Box key="outdated-gap" height={1} /> },
    {
      key: "outdated",
      height: 1,
      draw: () => (
        <Box key="outdated" flexShrink={0}>
          {header(ui, "outdated", paneHeaderLook(), view.width)}
        </Box>
      ),
    },
    ...byLine.flatMap((comment) =>
      commentRows(
        ui,
        view,
        comment,
        `line ${String(comment.line).padStart(lineCells)}${OUTDATED_SEPARATOR}`,
      ),
    ),
  ];
}

function commentRows(ui: Ui, view: ReviewView, comment: ReviewListComment, label: string): Row[] {
  const lead = `${COMMENT_LEAD}${" ".repeat(displayWidth(label))}`;
  const wrapped = wrapWithPrefix(
    `${comment.text}${comment.resolved ? RESOLVED_SUFFIX : ""}`,
    { first: lead, next: COMMENT_CONTINUATION },
    view.width,
  );
  const bodies = wrapped.map((row, i) =>
    row.slice(i === 0 ? lead.length : COMMENT_CONTINUATION.length),
  );
  return [
    {
      key: `comment:${comment.id}`,
      height: bodies.length,
      draw: () =>
        commentElement(ui, { id: comment.id, label, bodies, isResolved: comment.resolved }),
    },
  ];
}

type CommentDraw = { id: string; label: string; bodies: string[]; isResolved: boolean };

function commentElement(
  { Box, Text }: Ui,
  { id, label, bodies, isResolved }: CommentDraw,
): RenderElement {
  const bodyColor = isResolved ? paneInk().muted : paneInk().text;
  const penColor = isResolved ? paneInk().muted : paneInk().alert;
  return (
    <Box key={`comment:${id}`} flexDirection="column">
      {bodies.map((body, i) => (
        <Box key={`comment:${id}:${i}`} flexDirection="row">
          <Text wrap="truncate-end">{COMMENT_INDENT}</Text>
          <Text color={i === 0 ? penColor : paneInk().rule} wrap="truncate-end">
            {i === 0 ? COMMENT_PEN : COMMENT_RAIL}
          </Text>
          <Text wrap="truncate-end"> </Text>
          {i === 0 && label !== "" ? (
            <Text color={paneInk().muted} wrap="truncate-end">
              {label}
            </Text>
          ) : null}
          <Text color={bodyColor} wrap="truncate-end">
            {body}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function textLines(
  { Box, Text }: Ui,
  key: string,
  lines: string[],
  color: string | undefined,
): RenderElement {
  return (
    <Box key={key} flexDirection="column">
      {lines.map((line, i) => (
        <Text key={`${key}:${i}`} color={color} wrap="truncate-end">
          {line}
        </Text>
      ))}
    </Box>
  );
}

function numberedLines(hunk: ReviewHunk): DiffLine[] {
  let oldNumber = hunk.oldStart;
  let newNumber = hunk.newStart;
  return hunk.lines.map((raw) => {
    const marker = raw.charAt(0) || " ";
    const text = raw.slice(1);
    if (marker === "+") return { marker, text, side: "new", number: newNumber++ };
    if (marker === "-") return { marker, text, side: "old", number: oldNumber++ };
    if (marker === NO_NEWLINE_MARKER)
      return { marker, text, side: "new", number: NOT_PRESSABLE_LINE };
    oldNumber++;
    return { marker: " ", text, side: "new", number: newNumber++ };
  });
}

function locatedComment(comment: ReviewListComment, lines: DiffLine[]): ReviewListComment | null {
  const sideLines = lines.filter((line) => line.side === comment.side);
  const number = relocatedLine(comment, sideLines);
  return number === null ? null : { ...comment, line: number };
}

type Prefixes = { first: string; next: string };

function wrapWithPrefix(body: string, prefixes: Prefixes, width: number): string[] {
  const firstCells = Math.max(1, width - displayWidth(prefixes.first));
  const nextCells = Math.max(1, width - displayWidth(prefixes.next));
  const rows: string[] = [];
  let row = "";
  let used = 0;
  const cellsLeft = (): number => (rows.length === 0 ? firstCells : nextCells);
  const endRow = (): void => {
    rows.push(row);
    row = "";
    used = 0;
  };
  for (const token of body.split(/(\s+)/).filter((part) => part !== "")) {
    const tokenCells = displayWidth(token);
    if (used + tokenCells <= cellsLeft()) {
      row += token;
      used += tokenCells;
      continue;
    }
    if (used > 0) endRow();
    if (token.trim() === "") continue;
    for (const char of token) {
      const charCells = displayWidth(char);
      if (used + charCells > cellsLeft()) endRow();
      row += char;
      used += charCells;
    }
  }
  rows.push(row);
  return rows.map((text, i) => `${i === 0 ? prefixes.first : prefixes.next}${text}`);
}
