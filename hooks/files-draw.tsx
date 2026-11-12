import type { ElementTable, RenderElement } from "claude-code";

import type { FilesDiff, RemoteRepo, Worktree, WorktreeOpen } from "../types";
import { headerWithClear } from "./clear-kit";
import { filesModel, isStale, unfoldedRows } from "./files-model";
import type { AgentTotal, Change, FileTreeRow, FilesSource } from "./files-model";
import {
  button,
  filterRow,
  header,
  HOVER_SCOPE_CELLS,
  labelButton,
  paneRow,
  paneHeaderLook,
  plural,
} from "./pane-kit";
import type { Part } from "./pane-kit";
import { clipEnd, clipStart, displayWidth } from "./text-width";
import { treeGlyphs } from "./tree-glyphs";
import { paneInk } from "./pane-ink";
import { isInside, fitPair, shortLabels, squeezedPath, tildePath } from "./paths";
import { remoteBlock } from "./remote-draw";

type Ui = ElementTable;

export type FilesView = FilesSource & {
  width: number;
  folded: Record<string, boolean>;
  remote: Record<string, RemoteRepo>;
  toggleFolder: (key: string, isFolded: boolean) => void;
  diff: FilesDiff | null;
  openDiff: (target: string) => void;
  closeDiff: () => void;
  clear: () => void;
  worktrees: Worktree[];
  openWorktree: WorktreeOpen | null;
  toggleWorktree: (path: string) => void;
  askRemoveWorktree: (path: string) => void;
  confirmRemoveWorktree: (path: string) => void;
  setFilter: (text: string) => void;
  focusFilter: () => void;
};

const AUTO_FOLD_ROWS = 60;

const MARK_CELLS = 2;

const COUNTS_GAP_CELLS = 1;

const WORKTREE_ACTIONS_INDENT_CELLS = 2;

const BACK_BUTTON_CELLS = "[ back ]".length;

const DIFF_HEADER_GAPS_CELLS = 2;

const DIRTY_MARK = "●";

const STALE_MARK = "○";

const CLEAN_MARK = "✔";

const OPEN_GLYPH = "▾";

const FOLDED_GLYPH = "▸";

export function filesTab(ui: Ui, view: FilesView): RenderElement {
  return view.diff === null ? listView(ui, view) : diffView(ui, view, view.diff);
}

function listView(ui: Ui, view: FilesView): RenderElement {
  const { Box, Text } = ui;
  const model = filesModel(view);
  const isFolded = (row: FileTreeRow): boolean =>
    view.folded[row.key] ?? (model.fileCount > AUTO_FOLD_ROWS && row.depth >= 1);
  const rows = withRepoLabels(unfoldedRows(model.rows, isFolded));
  const glyphs = treeGlyphs(rows);
  if (model.fileCount === 0 && view.filter === "") {
    return (
      <Box flexDirection="column">
        {remoteBlock(ui, view.remote, view.width)}
        {header(ui, "Files", paneHeaderLook(), view.width)}
        <Text color={paneInk().muted} wrap="truncate-end">
          no files touched yet · edits and reads show here
        </Text>
        {worktreeBlock(ui, view)}
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      {filterRow(ui, {
        value: view.filter,
        onInput: view.setFilter,
        onFocus: view.focusFilter,
      })}
      <Box height={1} />
      {remoteBlock(ui, view.remote, view.width)}
      {model.fileCount === 0
        ? header(ui, "Files", paneHeaderLook(), view.width)
        : headerWithClear(ui, "Files", view.width, view.clear)}
      {model.fileCount === 0 ? (
        <Text color={paneInk().muted} wrap="truncate-end">
          no matching files
        </Text>
      ) : (
        <Box flexDirection="column">
          {summary(ui, model.totals, view.width)}
          {rows.map((row, i) => fileRow(ui, row, glyphs[i] ?? "", isFolded(row), view))}
        </Box>
      )}
      {worktreeBlock(ui, view)}
    </Box>
  );
}

function withRepoLabels(rows: FileTreeRow[]): FileTreeRow[] {
  const repos = rows.filter((row) => row.branch !== undefined);
  const labels = shortLabels(repos.map((row) => row.key));
  return rows.map((row) => {
    const at = repos.indexOf(row);
    return at === -1 ? row : { ...row, name: `${labels[at]}/` };
  });
}

function fileRow(
  ui: Ui,
  row: FileTreeRow,
  glyph: string,
  isFolded: boolean,
  view: FilesView,
): RenderElement {
  if (row.total !== undefined) return folderRow(ui, row, row.total, glyph, isFolded, view);
  const { file } = row;
  if (!file?.isEdited) {
    return paneRow(ui, {
      prefix: glyph === "" ? undefined : glyph,
      guide: paneInk().rule,
      middle: { text: row.name, color: paneInk().muted },
      middleWrap: "truncate-end",
      width: view.width,
    });
  }
  return editedFileRow(ui, row, glyph, changeParts(file), view);
}

function editedFileRow(
  ui: Ui,
  row: FileTreeRow,
  glyph: string,
  counts: Part[],
  view: FilesView,
): RenderElement {
  const { Box, Text } = ui;
  const countsCells = counts.reduce((cells, part) => cells + part.text.length, 0);
  const nameCells = view.width - displayWidth(glyph) - countsCells - COUNTS_GAP_CELLS;
  return (
    <Box key={row.key} flexDirection="row" width={view.width} height={1}>
      <Box flexShrink={0}>
        <Text color={paneInk().rule} wrap="truncate-end">
          {glyph}
        </Text>
      </Box>
      <Box flexShrink={1} minWidth={0}>
        {labelButton(ui, {
          key: row.key,
          label: clipEnd(row.name, nameCells),
          onPress: () => view.openDiff(row.key),
        })}
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0} />
      <Box flexShrink={0}>
        <Text wrap="truncate-end">{counts.map(changePiece(ui))}</Text>
      </Box>
    </Box>
  );
}

function folderRow(
  ui: Ui,
  row: FileTreeRow,
  total: Change,
  glyph: string,
  isFolded: boolean,
  view: FilesView,
): RenderElement {
  const { Box, Button, Text } = ui;
  const mark = isFolded ? FOLDED_GLYPH : OPEN_GLYPH;
  const counts = isFolded && total.added + total.removed > 0 ? changeParts(total) : [];
  const countsCells = counts.reduce((cells, part) => cells + part.text.length, 0);
  const branchLabel = row.branch === undefined ? "" : ` · ${row.branch}`;
  const cells =
    view.width -
    displayWidth(glyph) -
    MARK_CELLS -
    (countsCells === 0 ? 0 : countsCells + COUNTS_GAP_CELLS);
  const { name, branch } =
    row.branch === undefined
      ? { name: clipStart(row.name, cells), branch: "" }
      : namePair(row.name, branchLabel, cells);
  return (
    <Box key={row.key} flexDirection="row" width={view.width} height={1}>
      <Box flexShrink={0}>
        <Text color={paneInk().rule} wrap="truncate-end">
          {glyph}
        </Text>
      </Box>
      <Box flexShrink={1} minWidth={0}>
        <Button
          label={`${mark} ${name}`}
          plain
          dimColor={false}
          hover={{
            color: paneInk().text ?? paneInk().section,
            scope: row.key.slice(0, HOVER_SCOPE_CELLS),
          }}
          onPress={() => view.toggleFolder(row.key, !isFolded)}
        >
          {pathText(ui, `${mark} `, name)}
        </Button>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text color={paneInk().muted} wrap="truncate-end">
          {branch}
        </Text>
      </Box>
      {counts.length === 0 ? null : (
        <Box flexShrink={0}>
          <Text wrap="truncate-end">{counts.map(changePiece(ui))}</Text>
        </Box>
      )}
    </Box>
  );
}

function worktreeBlock(ui: Ui, view: FilesView): RenderElement | null {
  const { Box } = ui;
  if (view.worktrees.length === 0) return null;
  const labels = shortLabels(view.worktrees.map((worktree) => worktree.path));
  return (
    <Box flexDirection="column">
      <Box height={1} />
      {header(ui, "Worktrees", paneHeaderLook(), view.width)}
      {view.worktrees.flatMap((worktree, i) => worktreeRows(ui, worktree, labels[i] ?? "", view))}
    </Box>
  );
}

function worktreeRows(ui: Ui, worktree: Worktree, label: string, view: FilesView): RenderElement[] {
  const rows = [worktreeRow(ui, worktree, label, view)];
  if (view.openWorktree?.path !== worktree.path || !isStale(worktree)) return rows;
  return [...rows, worktreeActions(ui, worktree.path, view)];
}

function worktreeMark(worktree: Worktree): Part {
  if (!worktree.isClean) return { text: DIRTY_MARK, color: paneInk().alert };
  if (isStale(worktree)) return { text: STALE_MARK, color: paneInk().muted };
  return { text: CLEAN_MARK, color: paneInk().ok };
}

function worktreeRow(ui: Ui, worktree: Worktree, label: string, view: FilesView): RenderElement {
  const { Box, Button, Text } = ui;
  const mark = worktreeMark(worktree);
  const { name: path, branch: branchLabel } = namePair(
    label,
    ` · ${worktree.label}`,
    view.width - MARK_CELLS - 1,
  );
  return (
    <Box key={`worktree-${worktree.path}`} flexDirection="row" width={view.width} height={1}>
      <Box flexShrink={0}>
        <Text color={mark.color} wrap="truncate-end">
          {`${mark.text} `}
        </Text>
      </Box>
      <Box flexShrink={1} minWidth={0}>
        {isStale(worktree) ? (
          <Button
            key={`worktree-${worktree.path}`}
            label={`${path}/`}
            plain
            onPress={() => view.toggleWorktree(worktree.path)}
          >
            {pathText(ui, "", path, "/")}
          </Button>
        ) : (
          pathText(ui, "", path, "/")
        )}
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text color={paneInk().muted} wrap="truncate-end">
          {branchLabel}
        </Text>
      </Box>
    </Box>
  );
}

function namePair(
  name: string,
  branchLabel: string,
  cells: number,
): { name: string; branch: string } {
  const { first, second } = fitPair(name, branchLabel, cells);
  return { name: first, branch: second };
}

function pathText({ Text }: Ui, lead: string, path: string, tail = ""): RenderElement {
  const wrap = "truncate-end";
  const split = path.replace(/\/$/, "").lastIndexOf("/") + 1;
  return (
    <Text wrap={wrap}>
      <Text color={paneInk().muted} wrap={wrap}>
        {`${lead}${path.slice(0, split)}`}
      </Text>
      <Text color={paneInk().text} wrap={wrap}>
        {path.slice(split)}
      </Text>
      {tail === "" ? null : (
        <Text color={paneInk().muted} wrap={wrap}>
          {tail}
        </Text>
      )}
    </Text>
  );
}

function worktreeActions(ui: Ui, path: string, view: FilesView): RenderElement {
  const { Box, Button } = ui;
  const isConfirming = view.openWorktree?.isConfirming === true;
  return (
    <Box
      key={`worktree-actions-${path}`}
      flexDirection="row"
      marginLeft={WORKTREE_ACTIONS_INDENT_CELLS}
      height={1}
      overflow="hidden"
    >
      <Button
        key={isConfirming ? "confirm remove" : "remove"}
        label={isConfirming ? "confirm remove" : "remove"}
        plain
        dimColor
        onPress={() =>
          isConfirming ? view.confirmRemoveWorktree(path) : view.askRemoveWorktree(path)
        }
      />
    </Box>
  );
}

function changePiece({ Text }: Ui): (part: Part) => RenderElement {
  return (part) => (
    <Text key={part.text} color={part.color} wrap="truncate-end">
      {part.text}
    </Text>
  );
}

function changeParts(change: Change): Part[] {
  return [
    { text: `+${change.added}`, color: change.added === 0 ? paneInk().muted : paneInk().ok },
    {
      text: ` -${change.removed}`,
      color: change.removed === 0 ? paneInk().muted : paneInk().failed,
    },
  ];
}

function summary(ui: Ui, totals: AgentTotal[], width: number): RenderElement | null {
  const { Box, Text } = ui;
  if (totals.length === 0) return null;
  const files = new Set(totals.flatMap((total) => [...total.files])).size;
  const change = {
    added: totals.reduce((sum, total) => sum + total.added, 0),
    removed: totals.reduce((sum, total) => sum + total.removed, 0),
  };
  return (
    <Box flexDirection="column">
      {paneRow(ui, {
        middle: {
          text: `${files} ${plural("file", files)} changed`,
          color: paneInk().text,
          bold: true,
        },
        middleWrap: "truncate-end",
        right: changeParts(change),
        width,
      })}
      {totals.length < 2
        ? null
        : totals.map((total) =>
            paneRow(ui, {
              middle: { text: total.label, color: paneInk().muted },
              middleWrap: "truncate-end",
              right: [
                {
                  text: `${total.files.size} ${plural("file", total.files.size)} `,
                  color: paneInk().muted,
                },
                ...changeParts(total),
              ],
              width,
            }),
          )}
      <Text wrap="truncate-end"> </Text>
    </Box>
  );
}

function diffView(ui: Ui, view: FilesView, diff: FilesDiff): RenderElement {
  const { Box, Code, Text } = ui;
  const { rows } = filesModel(view);
  const change = rows.find((row) => row.key === diff.target)?.file ?? { added: 0, removed: 0 };
  const changeCells = changeParts(change).reduce((cells, part) => cells + part.text.length, 0);
  const pathCells = view.width - BACK_BUTTON_CELLS - changeCells - DIFF_HEADER_GAPS_CELLS;
  const shownPath = diffPath(rows, diff.target, view.home, pathCells);
  return (
    <Box flexDirection="column" width={view.width}>
      <Box flexDirection="row" columnGap={1} height={1}>
        {button(ui, { key: "back", label: "back", onPress: view.closeDiff })}
        <Box flexShrink={1} minWidth={0}>
          {pathText(ui, "", shownPath)}
        </Box>
        <Box flexShrink={0}>
          <Text wrap="truncate-end">{changeParts(change).map(changePiece(ui))}</Text>
        </Box>
      </Box>
      {header(ui, "", paneHeaderLook(), view.width)}
      {diff.text === "" ? (
        <Text color={paneInk().muted} wrap="truncate-end">
          No changes.
        </Text>
      ) : (
        <Code format="diff" path={diff.target} source={diff.text} wrap="wrap" />
      )}
    </Box>
  );
}

function diffPath(
  rows: FileTreeRow[],
  target: string,
  home: string | undefined,
  cells: number,
): string {
  const repos = rows.filter((row) => row.branch !== undefined);
  const labels = shortLabels(repos.map((repo) => repo.key));
  const owner = repos.reduce(
    (best, repo, i) =>
      isInside(target, repo.key) && (best === -1 || repo.key.length > repos[best]!.key.length)
        ? i
        : best,
    -1,
  );
  if (owner !== -1)
    return squeezedPath(labels[owner]!, target.slice(repos[owner]!.key.length + 1), cells);
  const shown = tildePath(target, home);
  const segments = shown.split("/");
  const headCount = shown.startsWith("/") ? 2 : 1;
  const rest = segments.slice(headCount).join("/");
  if (rest === "") return clipStart(shown, cells);
  return squeezedPath(segments.slice(0, headCount).join("/"), rest, cells);
}
