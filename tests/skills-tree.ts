import { childrenOf, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import { isHeavy } from "./weight";

export type Line = { text: string; indent: number; parts: Node[]; edge?: number };
export type Block = { title: string; count: string | null; heading: Line; rows: Line[] };

const RULE_CHARS = /─+/g;
const INDENT_PROPS = ["marginLeft", "paddingLeft", "marginX", "paddingX"];
const GLYPHS = ["▸", "▾"];
const COUNT_SUFFIX = /^\s*(\d+(?: [a-z]+)?)$/;
const CLEAR_SUFFIX = / clear$/;
const USE_COUNT = /^(.+?) (\d+ uses?)$/;

export function linesOf(tree: Node): Line[] {
  return layout(tree, 0);
}

export function shownTexts(tree: Node): string[] {
  return linesOf(tree)
    .map((line) => line.text)
    .filter((text) => text !== "");
}

export function blocksOf(lines: Line[], titles: string[]): Record<string, Block> {
  const blocks: Record<string, Block> = {};
  let current: Block | null = null;
  for (const line of lines) {
    const heading = headingOf(line, titles);
    if (heading !== null) {
      current = { ...heading, heading: line, rows: [] };
      blocks[heading.title] = current;
    } else if (current !== null && line.text !== "") current.rows.push(line);
  }
  return blocks;
}

export function headingOrder(lines: Line[], titles: string[]): string[] {
  return lines.flatMap((line) => headingOf(line, titles)?.title ?? []);
}

export function isSkillRow(line: Line): boolean {
  return GLYPHS.some((glyph) => line.text.startsWith(`${glyph} `));
}

export function skillRowTexts(block: Block | undefined): string[] {
  return (block?.rows ?? []).filter(isSkillRow).map((line) => line.text);
}

export function rowOf(block: Block | undefined, name: string): Line | undefined {
  return block?.rows.find((line) => GLYPHS.some((glyph) => line.text === `${glyph} ${name}`));
}

export function bareRowOf(block: Block | undefined, name: string): Line | undefined {
  return block?.rows.find((line) => line.text === name);
}

export function descriptionRowsOf(block: Block | undefined, name: string): Line[] {
  const rows = block?.rows ?? [];
  const start = rows.findIndex((line) => line === rowOf(block, name));
  if (start === -1) return [];
  const rest = rows.slice(start + 1);
  const next = rest.findIndex(isSkillRow);
  return next === -1 ? rest : rest.slice(0, next);
}

export function glyphButtonOf(line: Line | undefined): Node | undefined {
  return line?.parts.find(
    (part) => part.type === "Button" && GLYPHS.includes(labelOf(part).trim()),
  );
}

export function nameButtonOf(line: Line | undefined, name: string): Node | undefined {
  return line?.parts.find((part) => part.type === "Button" && labelOf(part).trim() === name);
}

export function keyOf(node: Node | undefined): string {
  const key = node?.props?.key;
  return typeof key === "string" ? key : "";
}

export function clearButtonOf(block: Block | undefined): Node | undefined {
  return block?.heading.parts.find((part) => part.type === "Button" && labelOf(part) === "clear");
}

export function useRowsOf(block: Block | undefined): string[][] {
  return (block?.rows ?? []).flatMap((line) => {
    const match = USE_COUNT.exec(line.text);
    return match === null ? [] : [[match[1] ?? "", match[2] ?? ""]];
  });
}

export function statsButtonOf(block: Block | undefined): Line | undefined {
  return block?.rows.find(isSkillRow);
}

function headingOf(line: Line, titles: string[]): Omit<Block, "heading" | "rows"> | null {
  const isBold = line.parts.some((part) => part.type === "Text" && isHeavy(part.props));
  if (!isBold) return null;
  const hasClear = line.parts.some((part) => part.type === "Button" && labelOf(part) === "clear");
  const text = hasClear ? line.text.replace(CLEAR_SUFFIX, "") : line.text;
  for (const title of titles) {
    if (text === title) return { title, count: null };
    if (!text.startsWith(`${title} `)) continue;
    const count = COUNT_SUFFIX.exec(text.slice(title.length))?.[1];
    if (count !== undefined) return { title, count };
  }
  return null;
}

function labelOf(node: Node): string {
  return typeof node.props?.label === "string" ? node.props.label : textOf(node);
}

function layout(node: Node, inherited: number): Line[] {
  if (node.type === "Text") return splitLines(textOf(node), leavesOf(node), inherited);
  if (node.type === "Button") return splitLines(labelOf(node), [node], inherited);
  const indent = inherited + indentOf(node);
  const children = childrenOf(node);
  if (children.length === 0) return spacerLines(node, indent);
  const columns = children.map((child) => layout(child, indent));
  return isRow(node) ? mergeRow(columns, gapOf(node), edgeOf(node, indent)) : columns.flat();
}

function leavesOf(node: Node): Node[] {
  if (node.type === "Button") return [node];
  const nested = childrenOf(node);
  if (!nested.some((child) => child.type === "Text" || child.type === "Button")) return [node];
  return nested.flatMap(leavesOf);
}

function isRow(node: Node): boolean {
  if (node.type !== "Box") return false;
  const direction = node.props?.flexDirection;
  return direction === undefined || direction === "row" || direction === "row-reverse";
}

function edgeOf(node: Node, indent: number): number | undefined {
  const width = node.props?.width;
  return typeof width === "number" ? indent + width : undefined;
}

function gapOf(node: Node): number {
  const gap = node.props?.columnGap;
  return typeof gap === "number" ? gap : 0;
}

function mergeRow(columns: Line[][], gap: number, edge: number | undefined): Line[] {
  const height = Math.max(0, ...columns.map((column) => column.length));
  return Array.from({ length: height }, (_, index) => {
    const pieces = columns.flatMap((column) => column[index] ?? []);
    return {
      text: pieces
        .map((piece) => piece.text)
        .filter((text) => text !== "")
        .join(" "),
      indent: leadingIndent(pieces, gap),
      parts: pieces.flatMap((piece) => piece.parts),
      ...(edge === undefined ? {} : { edge }),
    };
  });
}

function leadingIndent(pieces: Line[], gap: number): number {
  const first = pieces[0];
  if (first === undefined) return 0;
  return first.text === "" && pieces.length > 1 ? first.indent + gap : first.indent;
}

function splitLines(text: string, parts: Node[], indent: number): Line[] {
  return text.split("\n").map((chunk) => ({
    text: chunk.replace(RULE_CHARS, "").replace(/\s+/g, " ").trim(),
    indent: indent + chunk.length - chunk.trimStart().length,
    parts,
  }));
}

function spacerLines(node: Node, indent: number): Line[] {
  const { height, width } = node.props ?? {};
  if (typeof height !== "number" && typeof width === "number") {
    return [{ text: "", indent: indent + width, parts: [] }];
  }
  const count = typeof height === "number" ? height : 0;
  return Array.from({ length: count }, () => ({ text: "", indent, parts: [] }));
}

function indentOf(node: Node): number {
  return INDENT_PROPS.reduce((sum, key) => {
    const value = node.props?.[key];
    return sum + (typeof value === "number" ? value : 0);
  }, 0);
}
