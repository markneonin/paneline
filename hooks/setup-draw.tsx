import type { ElementTable, RenderElement } from "claude-code";

import { button, header, labelButton, paneHeaderLook } from "./pane-kit";
import { paneInk } from "./pane-ink";
import type { Cell, SetupBlock, SetupDetail, SetupRow } from "./setup-model";
import { clipEnd, clipStart, displayWidth, wrapPlain } from "./text-width";

type Ui = ElementTable;

export type SetupView = {
  width: number;
  blocks: readonly SetupBlock[];
  opened: SetupDetail | undefined;
  openDetail: (id: string) => void;
  closeDetail: () => void;
};

const FIELD_LABEL_CELLS = 9;
const HANG_CELLS = 4;
const TAB_CELLS = 2;
const EXPLICIT_COLUMN_SHARE = 2;
const ALTERNATIVE_SEPARATOR = "|";
const PATH_BOUNDARY = /(?=[/-])/;
const AFTER_SEPARATOR = /(?<=[/\-_=:;|&,])/;

const FIXED_COLUMN_SHARE = 3;
const FIXED_TOTAL_SHARE = 2;
const COLUMN_GAP = 2;

export function setupTab(ui: Ui, view: SetupView): RenderElement {
  const { Box } = ui;
  if (view.opened !== undefined) return detailElement(ui, view.opened, view);
  return (
    <Box flexDirection="column" width={view.width}>
      {view.blocks.flatMap((block, index) => [
        ...(index > 0 ? [<Box key={`${block.title}-gap`} height={1} />] : []),
        blockElement(ui, block, view),
      ])}
    </Box>
  );
}

function blockElement(ui: Ui, block: SetupBlock, view: SetupView): RenderElement {
  const { Box, Text } = ui;
  const { width } = view;
  const cap = Math.floor(width / FIXED_COLUMN_SHARE);
  const columns = columnWidths(block.rows, cap);
  const nameCap = explicitCellCap(block.rows, width);
  return (
    <Box key={block.title} flexDirection="column" width={width}>
      {headingElement(ui, block, width)}
      {block.rows.length === 0 ? (
        <Text color={paneInk().muted} wrap="truncate-end">
          {block.empty}
        </Text>
      ) : (
        block.rows.map((row, index) =>
          rowElement(ui, row, { index, columns, nameCap, width, openDetail: view.openDetail }),
        )
      )}
    </Box>
  );
}

function headingElement(ui: Ui, block: SetupBlock, width: number): RenderElement {
  const { Box, Text } = ui;
  if (block.count === undefined) return header(ui, block.title, paneHeaderLook(), width);
  const countWidth = block.count.reduce((sum, cell) => sum + displayWidth(cell.text), 0);
  return (
    <Box flexDirection="row" width={width} height={1} columnGap={1}>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {header(ui, block.title, paneHeaderLook(), width - countWidth - 1)}
      </Box>
      <Box flexShrink={0}>
        <Text wrap="truncate-end">
          {block.count.map((cell, index) => (
            <Text key={`${index}`} color={cellInk(cell).color}>
              {cell.text}
            </Text>
          ))}
        </Text>
      </Box>
    </Box>
  );
}

function columnWidths(rows: readonly SetupRow[], cap: number): number[] {
  const widths: number[] = [];
  for (const { cells } of rows) {
    cells.slice(0, -1).forEach(({ text, width }, index) => {
      if (width !== undefined) return;
      widths[index] = Math.min(cap, Math.max(widths[index] ?? 0, displayWidth(text)));
    });
  }
  return fitToShare(widths, Math.floor((cap * FIXED_COLUMN_SHARE) / FIXED_TOTAL_SHARE));
}

function explicitCellCap(rows: readonly SetupRow[], width: number): number {
  const caps = rows
    .filter(({ cells }) => cells.some((cell) => cell.width !== undefined))
    .map((row) => {
      const half = Math.floor((width - row.indent) / EXPLICIT_COLUMN_SHARE);
      const lastText = row.cells[row.cells.length - 1]?.text ?? "";
      const taken = markCellsOf(row) + rightCellsOf(row) + COLUMN_GAP + displayWidth(lastText);
      return Math.max(half, width - row.indent - taken);
    });
  return Math.min(...caps);
}

function markCellsOf(row: SetupRow): number {
  return row.mark === "" ? 0 : displayWidth(row.mark) + COLUMN_GAP;
}

function rightCellsOf(row: SetupRow): number {
  return row.right === "" ? 0 : displayWidth(row.right) + COLUMN_GAP;
}

function fitToShare(widths: number[], budget: number): number[] {
  const fitted = [...widths];
  const total = () => fitted.reduce((sum, width) => sum + width + COLUMN_GAP, 0);
  while (total() > budget && Math.max(...fitted) > 1) {
    fitted[fitted.indexOf(Math.max(...fitted))]! -= 1;
  }
  return fitted;
}

function cellInk(cell: Cell | undefined): { color: string | undefined; weight?: "semibold" } {
  const ink = paneInk();
  switch (cell?.look ?? "text") {
    case "muted":
      return { color: ink.muted };
    case "tool":
      return { color: ink.tool };
    case "failed":
      return { color: ink.failed };
    case "alert":
      return { color: ink.alert };
    case "strong":
      return { color: ink.text, weight: "semibold" };
    default:
      return { color: ink.text };
  }
}

type RowLayout = {
  index: number;
  columns: readonly number[];
  nameCap: number;
  width: number;
  openDetail: (id: string) => void;
};

function rowElement(ui: Ui, row: SetupRow, layout: RowLayout): RenderElement {
  const { Box, Text } = ui;
  const ink = paneInk();
  const last = row.cells.length - 1;
  const lastCell = row.cells[last];
  const room = lastCellRoom(row, layout);
  return (
    <Box
      key={`row-${layout.index}`}
      flexDirection="row"
      marginLeft={row.indent}
      width={layout.width - row.indent}
      height={1}
      columnGap={COLUMN_GAP}
    >
      {row.mark === "" ? null : (
        <Box flexShrink={0}>
          <Text color={ink.ok} wrap="truncate-end">
            {row.mark}
          </Text>
        </Box>
      )}
      {row.cells.slice(0, -1).map((cell, index) => {
        const cellWidth = cellWidthOf(row, index, layout);
        return cellWidth === 0 ? null : (
          <Box key={`cell-${index}`} width={cellWidth} flexShrink={0}>
            {cellText(ui, cell, openingAt(row, index, layout, cellWidth), "truncate-end")}
          </Box>
        );
      })}
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {lastCell?.alternatives
          ? alternativesText(ui, lastCell, room)
          : cellText(
              ui,
              row.clipsStart && lastCell
                ? { ...lastCell, text: startFitted(lastCell.text, room) }
                : lastCell,
              openingAt(row, last, layout, room),
              row.clipsStart ? "truncate-start" : "truncate-end",
            )}
      </Box>
      {row.right === "" ? null : (
        <Box flexShrink={0}>
          <Text color={ink.muted} wrap="truncate-end">
            {row.right}
          </Text>
        </Box>
      )}
    </Box>
  );
}

type Opening = { id: string; open: (id: string) => void; cells: number };

function openingAt(
  row: SetupRow,
  index: number,
  layout: RowLayout,
  cells: number,
): Opening | undefined {
  const opens = row.opens;
  return opens?.cell === index ? { id: opens.id, open: layout.openDetail, cells } : undefined;
}

function cellWidthOf(row: SetupRow, index: number, layout: RowLayout): number {
  const cell = row.cells[index];
  if (cell?.width === undefined) return layout.columns[index] ?? 0;
  return Math.min(cell.width, layout.nameCap);
}

function lastCellRoom(row: SetupRow, layout: RowLayout): number {
  const leadingCells = row.cells
    .slice(0, -1)
    .map((_, index) => cellWidthOf(row, index, layout))
    .reduce((sum, cells) => (cells === 0 ? sum : sum + cells + COLUMN_GAP), 0);
  return layout.width - row.indent - markCellsOf(row) - leadingCells - rightCellsOf(row);
}

function startFitted(text: string, cells: number): string {
  if (displayWidth(text) <= cells) return text;
  const parts = text.split(PATH_BOUNDARY);
  for (let first = 1; first < parts.length; first += 1) {
    const tail = parts.slice(first).join("");
    if (displayWidth(tail) + 1 <= cells) return `…${tail}`;
  }
  return clipStart(text, cells);
}

type Fit = { head: string; more: string };

function alternativesText(ui: Ui, cell: Cell, room: number): RenderElement {
  const { Text } = ui;
  const fit = fitAlternatives(cell.text, room);
  if (fit === null) return cellText(ui, cell, undefined, "truncate-end");
  return (
    <Text wrap="truncate-end">
      <Text {...cellInk(cell)}>{fit.head}</Text>
      <Text color={paneInk().muted}>{fit.more}</Text>
    </Text>
  );
}

function fitAlternatives(matcher: string, room: number): Fit | null {
  const alternatives = matcher.split(ALTERNATIVE_SEPARATOR);
  if (alternatives.length < 2 || displayWidth(matcher) <= room) return null;
  for (let shown = alternatives.length - 1; shown >= 0; shown -= 1) {
    const head = alternatives.slice(0, shown).join(ALTERNATIVE_SEPARATOR);
    const hidden = alternatives.length - shown;
    const more = shown === 0 ? `+${hidden}` : ` +${hidden}`;
    if (displayWidth(head) + displayWidth(more) <= room) return { head, more };
  }
  return null;
}

function cellText(
  ui: Ui,
  cell: Cell | undefined,
  opens: Opening | undefined,
  wrap: "truncate-end" | "truncate-start",
): RenderElement {
  const { Text } = ui;
  if (opens !== undefined) {
    return labelButton(ui, {
      key: `hook-${opens.id}`,
      label: clipEnd(cell?.text ?? "", opens.cells),
      onPress: () => opens.open(opens.id),
    });
  }
  return (
    <Text {...cellInk(cell)} wrap={wrap}>
      {cell?.text ?? ""}
    </Text>
  );
}

function detailElement(ui: Ui, detail: SetupDetail, view: SetupView): RenderElement {
  const { Box } = ui;
  const { width } = view;
  return (
    <Box flexDirection="column" width={width}>
      {button(ui, { key: "back", label: "back", onPress: view.closeDetail })}
      <Box height={1} />
      {header(ui, detail.title, paneHeaderLook(), width)}
      {detail.fields.map((field) => fieldRow(ui, field.label, field.cells))}
      {detail.body === undefined ? null : (
        <Box flexDirection="column">
          <Box height={1} />
          {header(ui, detail.body.title, paneHeaderLook(), width)}
          {bodyRows(ui, detail.body.text, width)}
        </Box>
      )}
    </Box>
  );
}

function fieldRow(ui: Ui, label: string, cells: readonly Cell[]): RenderElement {
  const { Box, Text } = ui;
  return (
    <Box key={label} flexDirection="row">
      <Box width={FIELD_LABEL_CELLS} flexShrink={0}>
        <Text color={paneInk().muted} wrap="truncate-end">
          {`${label} `}
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="wrap">
          {cells.map((cell, index) => (
            <Text key={`${index}`} color={cellInk(cell).color}>
              {cell.text}
            </Text>
          ))}
        </Text>
      </Box>
    </Box>
  );
}

function bodyRows(ui: Ui, body: string, width: number): RenderElement[] {
  const { Box, Text } = ui;
  return body.split("\n").flatMap((line, lineIndex) => {
    const lead = leadWidth(line);
    const rows = wrapCommandLine(line.trimStart(), width - lead - HANG_CELLS);
    return (rows.length === 0 ? [""] : rows).map((text, rowIndex) => (
      <Box
        key={`body-${lineIndex}-${rowIndex}`}
        marginLeft={rowIndex === 0 ? lead : lead + HANG_CELLS}
        height={1}
      >
        <Text color={paneInk().text} wrap="truncate-end">
          {text}
        </Text>
      </Box>
    ));
  });
}

type Piece = { text: string; spaced: boolean };

function wrapCommandLine(line: string, width: number): string[] {
  const rows: string[] = [];
  let row = "";
  for (const { text, spaced } of piecesOf(line, width)) {
    const joiner = spaced && row !== "" ? " " : "";
    if (row !== "" && displayWidth(row) + displayWidth(joiner) + displayWidth(text) > width) {
      rows.push(row);
      row = text;
    } else {
      row += joiner + text;
    }
  }
  return [...rows, row];
}

function piecesOf(line: string, width: number): Piece[] {
  return line.split(" ").flatMap((word, index) => {
    const parts =
      displayWidth(word) <= width
        ? [word]
        : word.split(AFTER_SEPARATOR).flatMap((part) => wrapPlain(part, width));
    return parts.map((text, part) => ({ text, spaced: index > 0 && part === 0 }));
  });
}

function leadWidth(line: string): number {
  const lead = line.slice(0, line.length - line.trimStart().length);
  return [...lead].reduce((sum, char) => sum + (char === "\t" ? TAB_CELLS : 1), 0);
}
