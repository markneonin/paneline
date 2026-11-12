import type { ElementTable, RenderElement } from "claude-code";

import type { Align, TableBlock } from "./markdown";
import { inlinePieces, lineOf, plainPiece, withPaths, withStyle } from "./inline-draw";
import type { OpenPath, PathRun } from "./inline-draw";
import type { ReplyLook } from "./reply-look";
import { displayWidth, wrapRuns } from "./text-width";

type Ui = ElementTable;

type Cell = PathRun[];

type Flow = { width: number; open: OpenPath | undefined };

const MIN_COLUMN_WIDTH = 3;

const LONGEST_WHOLE_WORD = 24;

const NO_RUN_STYLE = { strong: false, emphasis: false, strike: false, code: false };

export function tableView(
  ui: Ui,
  block: TableBlock,
  look: ReplyLook,
  flow: Flow,
  key: string,
): RenderElement {
  const { Box } = ui;
  const { width, open } = flow;
  const columns = block.header.length;
  const header = block.header.map((inline) => withPaths(withStyle(inline, { strong: true }), open));
  const rows = block.rows.map((row) =>
    block.header.map((_, c) => withPaths(withStyle(row[c] ?? [], {}), open)),
  );
  const widths = columnWidths([header, ...rows], width);
  const lines =
    widths === null
      ? recordLines(ui, { header, rows }, look, flow, key)
      : gridLines(ui, { header, rows, widths, align: block.align, columns }, look, flow, key);
  return (
    <Box key={key} flexDirection="column">
      {lines}
    </Box>
  );
}

function columnWidths(allRows: Cell[][], width: number): number[] | null {
  const columns = allRows[0]!.length;
  const natural = Array.from({ length: columns }, (_, c) =>
    Math.max(MIN_COLUMN_WIDTH, ...allRows.map((row) => displayWidth(plainOfRuns(row[c]!)))),
  );
  const available = width - (columns + 1) - 2 * columns;
  if (sum(natural) <= available) return natural;
  const minimum = [Infinity, LONGEST_WHOLE_WORD]
    .map((cap) => minimumWidths(natural, allRows, cap))
    .find((widths) => sum(widths) <= available);
  if (minimum === undefined) return null;
  return shareExtra(natural, minimum, available - sum(minimum));
}

function minimumWidths(natural: number[], allRows: Cell[][], cap: number): number[] {
  return natural.map((n, c) =>
    Math.min(n, Math.max(MIN_COLUMN_WIDTH, ...allRows.map((row) => longestWord(row[c]!, cap)))),
  );
}

function longestWord(cell: Cell, cap: number): number {
  const widest = Math.max(...plainOfRuns(cell).split(/\s+/).map(displayWidth));
  return Math.min(cap, widest);
}

function shareExtra(natural: number[], minimum: number[], extra: number): number[] {
  const wanted = natural.map((n, c) => n - minimum[c]!);
  const totalWanted = sum(wanted);
  const widths = minimum.map((m, c) => m + Math.floor((extra * wanted[c]!) / totalWanted));
  let leftover = extra - sum(widths) + sum(minimum);
  const widest = natural.map((_, c) => c).sort((a, b) => natural[b]! - natural[a]!);
  for (const c of widest) {
    if (leftover === 0) break;
    if (widths[c]! >= natural[c]!) continue;
    widths[c]!++;
    leftover--;
  }
  return widths;
}

type Grid = {
  header: Cell[];
  rows: Cell[][];
  widths: number[];
  align: Align[];
  columns: number;
};

function gridLines(
  ui: Ui,
  grid: Grid,
  look: ReplyLook,
  { open }: Flow,
  key: string,
): RenderElement[] {
  const { Text } = ui;
  const { header, rows, widths } = grid;
  const wrapped = [header, ...rows].map((row) => row.map((cell, c) => wrapCell(cell, widths[c]!)));
  const hasWrappedCell = wrapped.some((row) => row.some((cell) => cell.length > 1));
  const border = (left: string, fill: string, cross: string, right: string, k: string) => (
    <Text key={k} color={look.rule} wrap="truncate-end">
      {left + widths.map((w) => fill.repeat(w + 2)).join(cross) + right}
    </Text>
  );
  const out: RenderElement[] = [border("┌", "─", "┬", "┐", `${key}.top`)];
  out.push(...rowLines(ui, wrapped[0]!, grid, { look, open }, `${key}.h`));
  out.push(border("╞", "═", "╪", "╡", `${key}.head`));
  wrapped.slice(1).forEach((row, r) => {
    if (r > 0 && hasWrappedCell) out.push(border("├", "─", "┼", "┤", `${key}.s${r}`));
    out.push(...rowLines(ui, row, grid, { look, open }, `${key}.r${r}`));
  });
  out.push(border("└", "─", "┴", "┘", `${key}.bottom`));
  return out;
}

function wrapCell(cell: Cell, width: number): Cell[] {
  if (displayWidth(plainOfRuns(cell)) <= width) return [cell];
  const lines = wrapRuns(cell, width);
  return lines.length === 0 ? [[]] : lines;
}

function rowLines(
  ui: Ui,
  cells: Cell[][],
  { widths, align }: Grid,
  { look, open }: { look: ReplyLook; open: OpenPath | undefined },
  key: string,
): RenderElement[] {
  const { Text } = ui;
  const height = Math.max(...cells.map((cell) => cell.length));
  return Array.from({ length: height }, (_, line) =>
    lineOf(
      ui,
      [
        ...cells.flatMap((cell, c) => {
          const runs = cell[line] ?? [];
          const [before, after] = paddingOf(widths[c]! - displayWidth(plainOfRuns(runs)), align[c]);
          return [
            plainPiece(
              <Text key={`${c}.l`} color={look.rule}>
                {"│"}
              </Text>,
            ),
            plainPiece(" ".repeat(before + 1)),
            ...inlinePieces(ui, runs, look, look.prose, { key: `${key}.${line}.${c}`, open }),
            plainPiece(" ".repeat(after + 1)),
          ];
        }),
        plainPiece(
          <Text key="end" color={look.rule}>
            {"│"}
          </Text>,
        ),
      ],
      `${key}.${line}`,
      { color: look.prose, wrap: "truncate-end" },
    ),
  );
}

function paddingOf(space: number, align: Align | undefined): [number, number] {
  if (align === "right") return [space, 0];
  if (align === "center") return [Math.floor(space / 2), Math.ceil(space / 2)];
  return [0, space];
}

function recordLines(
  ui: Ui,
  { header, rows }: { header: Cell[]; rows: Cell[][] },
  look: ReplyLook,
  flow: Flow,
  key: string,
): RenderElement[] {
  const { Text } = ui;
  const { width, open } = flow;
  if (rows.length === 0) return headerRecord(ui, header, look, flow, key);
  return rows.flatMap((row, r) => {
    const lines = row.flatMap((cell, c) =>
      wrapRuns([...header[c]!, { text: ": ", style: NO_RUN_STYLE }, ...cell], width),
    );
    const drawn = lines.map((runs, i) =>
      lineOf(
        ui,
        inlinePieces(ui, runs, look, look.prose, { key: `${key}.r${r}.${i}`, open }),
        `${key}.r${r}.${i}`,
        { color: look.prose, wrap: "truncate-end" },
      ),
    );
    if (r === rows.length - 1) return drawn;
    return [
      ...drawn,
      <Text key={`${key}.r${r}.rule`} color={look.rule} wrap="truncate-end">
        {"─".repeat(width)}
      </Text>,
    ];
  });
}

function headerRecord(
  ui: Ui,
  header: Cell[],
  look: ReplyLook,
  { width, open }: Flow,
  key: string,
): RenderElement[] {
  const separator = { text: " │ ", style: NO_RUN_STYLE };
  const runs = header.flatMap((cell, c) => (c === 0 ? cell : [separator, ...cell]));
  return wrapRuns(runs, width).map((line, i) =>
    lineOf(
      ui,
      inlinePieces(ui, line, look, look.prose, { key: `${key}.h${i}`, open }),
      `${key}.h${i}`,
      {
        color: look.prose,
        wrap: "truncate-end",
      },
    ),
  );
}

function plainOfRuns(runs: Cell): string {
  return runs.map((run) => run.text).join("");
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
