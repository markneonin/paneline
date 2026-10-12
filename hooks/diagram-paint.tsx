import type { ElementTable, RenderElement } from "claude-code";

import { WIDE_PAD } from "./diagram-source";
import { palette } from "./palette";
import type { ReplyLook } from "./reply-look";

type Grid = string[][];
type ColorGrid = (string | undefined)[][];
type Rect = { top: number; left: number; bottom: number; right: number };
type Bar = { left: number; top: number };
type Run = { text: string; color: string | undefined };

const BOX_TOP_LEFT = /[┌╭(]/;
const BOX_TOP_EDGE = /[─┬┴┼▲▼]/;
const BOX_TOP_RIGHT = /[┐╮)]/;
const BOX_LEFT_EDGE = /[│├┤┼►◄]/;
const BOX_BOTTOM_LEFT = /[└╰(]/;
const BOX_BOTTOM_RIGHT = /[┘╯)]/;
const ARROW = /[►◄▲▼]/;
const LINE_ART = /[─-╿◇]/;
const AXIS_NUMBER = /^\d+[┤┼]/;
const AXIS_MARK = /[│┤┼]/;

export function diagramPanel(
  ui: ElementTable,
  art: string,
  look: ReplyLook,
  key: string,
): RenderElement {
  const rows = art.split("\n").map((line) => [...line]);
  const colors = paint(rows, look);
  return panelOf(
    ui,
    key,
    rows.map((row, y) => runsOf(row, colors[y]!)),
  );
}

export function listPanel(
  ui: ElementTable,
  lines: string[],
  look: ReplyLook,
  key: string,
): RenderElement {
  const rows = lines.map((line) => [...line]);
  const colors = rows.map((row) => row.map((char) => (char === "→" ? look.accent : look.prose)));
  return panelOf(
    ui,
    key,
    rows.map((row, y) => runsOf(row, colors[y]!)),
  );
}

function panelOf({ Box, Text }: ElementTable, key: string, lines: Run[][]): RenderElement {
  return (
    <Box key={key} flexDirection="column" alignSelf="flex-start" paddingX={2} paddingY={1}>
      {lines.map((runs, y) => (
        <Text key={`${key}.${y}`}>
          {runs.length === 0
            ? " "
            : runs.map((run, r) => (
                <Text key={`r${r}`} color={run.color}>
                  {run.text}
                </Text>
              ))}
        </Text>
      ))}
    </Box>
  );
}

function runsOf(chars: string[], colors: (string | undefined)[]): Run[] {
  const runs: Run[] = [];
  chars.forEach((char, x) => {
    if (char === WIDE_PAD) return;
    const last = runs[runs.length - 1];
    if (last !== undefined && last.color === colors[x]) last.text += char;
    else runs.push({ text: char, color: colors[x] });
  });
  return runs;
}

function paint(grid: Grid, look: ReplyLook): ColorGrid {
  const colors: ColorGrid = grid.map((row) => row.map(() => undefined));
  paintBoxes(grid, colors, look);
  const barColors = barColorOf(grid, look);
  grid.forEach((row, y) =>
    row.forEach((char, x) => {
      if (ARROW.test(char) || colors[y]![x] === undefined)
        colors[y]![x] = colorOf(row, x, barColors(y, x), look);
    }),
  );
  return colors;
}

function colorOf(
  row: string[],
  x: number,
  barColor: string | undefined,
  look: ReplyLook,
): string | undefined {
  const char = row[x]!;
  if (char === "█") return barColor;
  if (ARROW.test(char)) return look.accent;
  if (char === "·") return look.rule;
  if (LINE_ART.test(char)) return look.muted;
  if (AXIS_NUMBER.test(row.slice(x).join(""))) return look.muted;
  return look.prose;
}

function paintBoxes(grid: Grid, colors: ColorGrid, look: ReplyLook): void {
  const rects = findRects(grid);
  const innermost = rects.filter((outer) => !rects.some((inner) => isInside(inner, outer)));
  const hues = new Map<string, string>();
  for (const rect of innermost) {
    const label = labelOf(grid, rect);
    if (!hues.has(label)) hues.set(label, look.hues[hues.size % look.hues.length]!);
    fillRect(grid, colors, rect, hues.get(label)!);
  }
}

function isInside(inner: Rect, outer: Rect): boolean {
  return (
    inner !== outer &&
    inner.top > outer.top &&
    inner.bottom < outer.bottom &&
    inner.left > outer.left &&
    inner.right < outer.right
  );
}

const labelOf = (grid: Grid, rect: Rect): string =>
  grid
    .slice(rect.top + 1, rect.bottom)
    .map((row) => row.slice(rect.left + 1, rect.right).join(""))
    .join(" ")
    .trim();

function fillRect(grid: Grid, colors: ColorGrid, rect: Rect, hue: string): void {
  for (let y = rect.top; y <= rect.bottom; y++)
    for (let x = rect.left; x <= rect.right; x++)
      if ((grid[y]?.[x] ?? " ").trim() !== "") colors[y]![x] = hue;
}

function findRects(grid: Grid): Rect[] {
  const rects: Rect[] = [];
  grid.forEach((row, top) =>
    row.forEach((char, left) => {
      const rect = BOX_TOP_LEFT.test(char) ? rectFrom(grid, top, left) : undefined;
      if (rect !== undefined) rects.push(rect);
    }),
  );
  return rects;
}

function rectFrom(grid: Grid, top: number, left: number): Rect | undefined {
  const cell = (y: number, x: number) => grid[y]?.[x] ?? "";
  let right = left + 1;
  while (BOX_TOP_EDGE.test(cell(top, right))) right++;
  if (right === left + 1 || !BOX_TOP_RIGHT.test(cell(top, right))) return undefined;
  let bottom = top + 1;
  while (BOX_LEFT_EDGE.test(cell(bottom, left))) bottom++;
  if (!BOX_BOTTOM_LEFT.test(cell(bottom, left)) || !BOX_BOTTOM_RIGHT.test(cell(bottom, right)))
    return undefined;
  return { top, left, bottom, right };
}

const strongOf = (look: ReplyLook): string | undefined =>
  look.strong === palette.userText ? look.prose : look.strong;

type BarColorOf = (y: number, x: number) => string | undefined;

function barColorOf(grid: Grid, look: ReplyLook): BarColorOf {
  const legendRows = new Set(
    grid.flatMap((row, y) =>
      row.includes("█") && !row.some((char) => AXIS_MARK.test(char)) ? [y] : [],
    ),
  );
  const bars = barsOf(grid, legendRows);
  const hasLegend = legendRows.size > 0;
  const seriesCount = Math.max(1, ...[...legendRows].map((y) => barLefts(grid[y]!).length));
  const highest = Math.min(...bars.map((bar) => bar.top));
  const hueOf = (series: number) => look.hues[series % look.hues.length]!;
  return (y, x) => {
    const row = grid[y]!;
    const left = barLeft(row, x);
    if (legendRows.has(y)) return hueOf(barLefts(row).indexOf(left));
    const k = bars.findIndex((bar) => bar.left === left);
    if (hasLegend) return hueOf(k % seriesCount);
    return bars[k]?.top === highest ? strongOf(look) : look.muted;
  };
}

function barsOf(grid: Grid, legendRows: Set<number>): Bar[] {
  const tops = new Map<number, number>();
  grid.forEach((row, y) => {
    if (legendRows.has(y)) return;
    row.forEach((char, x) => {
      if (char === "█" && row[x - 1] !== "█" && !tops.has(x)) tops.set(x, y);
    });
  });
  return [...tops].map(([left, top]) => ({ left, top })).sort((a, b) => a.left - b.left);
}

const barLefts = (row: string[]): number[] =>
  row.flatMap((char, x) => (char === "█" && row[x - 1] !== "█" ? [x] : []));

function barLeft(row: string[], x: number): number {
  let left = x;
  while (row[left - 1] === "█") left--;
  return left;
}
