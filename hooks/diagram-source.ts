import { displayWidth } from "./text-width";
import { renderMermaidAscii, setChartSize } from "./vendor/mermaid-text.js";

export const WIDE_PAD = "\uE001";
const WIDE_CELLS = 2;
const QUOTED_COMMA = "\uE000";
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const X_AXIS_LIST = /^(\s*x-axis\b[^[\n]*\[)([^\]\n]*)\]/m;
const DECISION_NODE = /(\w)\{(?!\{)([^{}\n]*)\}(?!\})/g;
const DETACHED_EDGE_START = /│ ├/g;
const EDGE_LABEL_GAP = /(-->|-\.->|==>|---|-\.-|===)[ \t]+\|/g;
const BAR_VALUES = /^\s*bar\b[^[\n]*\[([^\]\n]*)\]/m;
const SERIES_LINE = /^\s*(bar|line)\b.*$/gm;
const HORIZONTAL_CHART = /^\s*xychart(-beta)?\s+horizontal/m;
const NON_CHART_BLANK_ROW = /^[\s│|]*$/;
const MIN_CHART_WIDTH = 24;
const MAX_CHART_WIDTH = 64;
const CHART_MARGIN = 12;
const MIN_CHART_HEIGHT = 8;
const MAX_CHART_HEIGHT = 18;

export function renderArt(source: string, columns: number): string {
  const isChart = /^\s*xychart/.test(source);
  const fixed = padWide(fixSource(source));
  if (isChart) setChartSize(...chartSize(fixed, columns));
  const art = tidy(renderMermaidAscii(fixed, { colorMode: "none", paddingX: 3, paddingY: 1 }));
  return isChart ? writeBarValues(art, source) : joinEdgeStarts(dropEmptyRows(art));
}

function fixSource(source: string): string {
  return source
    .replace(X_AXIS_LIST, (_, head: string, items: string) => `${head}${unquote(items)}]`)
    .replace(EDGE_LABEL_GAP, "$1|")
    .replace(DECISION_NODE, "$1[$2]");
}

const padWide = (text: string): string =>
  Array.from(graphemes.segment(text), ({ segment }) =>
    displayWidth(segment) === WIDE_CELLS ? `${segment}${WIDE_PAD}` : segment,
  ).join("");

const unquote = (items: string): string =>
  items.replace(/"([^"]*)"/g, (_, inner: string) => inner.replaceAll(",", QUOTED_COMMA));

function chartSize(source: string, columns: number): [number, number] {
  const width = clamp(
    categoryFit(source),
    MIN_CHART_WIDTH,
    Math.min(MAX_CHART_WIDTH, columns - CHART_MARGIN),
  );
  return [width, clamp(Math.round(width / 3), MIN_CHART_HEIGHT, MAX_CHART_HEIGHT)];
}

function categoryFit(source: string): number {
  const list = X_AXIS_LIST.exec(source)?.[2];
  if (list === undefined) return 0;
  const categories = list.split(",").map((category) => category.trim());
  return categories.length * (Math.max(...categories.map((category) => category.length)) + 2);
}

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

function tidy(art: string): string {
  return art
    .replace(/[ \t]+$/gm, "")
    .trimEnd()
    .replaceAll(QUOTED_COMMA, ",")
    .replaceAll("▶", "►")
    .replaceAll("◀", "◄");
}

const dropEmptyRows = (art: string): string =>
  art
    .split("\n")
    .filter((line) => !NON_CHART_BLANK_ROW.test(line))
    .join("\n");

const joinEdgeStarts = (art: string): string => art.replaceAll(DETACHED_EDGE_START, "├──");

function writeBarValues(art: string, source: string): string {
  const values = BAR_VALUES.exec(source)?.[1]
    ?.split(",")
    .map((value) => value.trim());
  const isSingleVerticalBar =
    values !== undefined &&
    (source.match(SERIES_LINE) ?? []).length === 1 &&
    !HORIZONTAL_CHART.test(source);
  if (!isSingleVerticalBar) return art;
  const grid = art.split("\n").map((line) => [...line]);
  const axis = grid.findLastIndex((row) => row.includes("┬"));
  const ticks = grid[axis]?.flatMap((char, x) => (char === "┬" ? [x] : [])) ?? [];
  if (ticks.length !== values.length) return art;
  ticks.forEach((tick, k) => writeAboveBar(grid, axis, tick, [...values[k]!]));
  return grid.map((row) => row.join("").trimEnd()).join("\n");
}

function writeAboveBar(grid: string[][], axis: number, tick: number, text: string[]): void {
  const top = grid.findIndex((row) => row[tick] === "█");
  const row = grid[(top === -1 ? axis : top) - 1];
  const from = tick - Math.floor((text.length - 1) / 2);
  if (row === undefined || from < 0) return;
  while (row.length < from + text.length) row.push(" ");
  const cells = row.slice(from, from + text.length);
  if (!cells.every((cell) => cell === " " || cell === "·")) return;
  row.splice(from, text.length, ...text);
}
