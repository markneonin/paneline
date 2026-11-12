import { palette } from "../hooks/palette";

export type Node = { type: string; props?: Record<string, unknown>; children?: unknown };

function listOf(raw: unknown): unknown[] {
  if (raw === undefined || raw === null) return [];
  return Array.isArray(raw) ? raw.flat(Infinity) : [raw];
}

export function childrenOf(node: Node): Node[] {
  return listOf(node.children).filter(
    (child): child is Node => typeof child === "object" && child !== null,
  );
}

export function isHidden(node: Node): boolean {
  return node.type === "Box" && node.props?.display === "none";
}

export function collect(node: Node, type: string): Node[] {
  if (isHidden(node)) return [];
  const inner = childrenOf(node).flatMap((child) => collect(child, type));
  return node.type === type ? [node, ...inner] : inner;
}

export function textOf(node: Node): string {
  return listOf(node.children)
    .map((child) => (typeof child === "object" ? textOf(child as Node) : (child as string)))
    .join("");
}

export function findText(tree: Node, text: string): Node | undefined {
  return collect(tree, "Text").findLast((node) => textOf(node) === text);
}

export function panelRows(tree: Node): string[] {
  return collect(tree, "Text")
    .filter((row) => row.props?.backgroundColor === palette.panel)
    .map(textOf);
}

export function diagramPanels(tree: Node): Node[] {
  return collect(tree, "Box").filter(
    (box) =>
      box.props?.alignSelf === "flex-start" &&
      box.props.paddingX === 2 &&
      box.props.paddingBottom === 1,
  );
}

export function diagramRows(tree: Node): string[] {
  return diagramPanels(tree).flatMap((panel) => childrenOf(panel).slice(1).map(textOf));
}

export function labelledTextOf(node: Node): string {
  const label = node.props?.label;
  if (node.type === "Button" && node.children === undefined)
    return typeof label === "string" ? label : "";
  return listOf(node.children)
    .map((child) => (typeof child === "object" ? labelledTextOf(child as Node) : (child as string)))
    .join("");
}

export function rowGapOf(tree: Node, text: string): number | undefined {
  const gap = collect(tree, "Box")
    .filter((box) => typeof box.props?.columnGap === "number" && textOf(box).includes(text))
    .at(-1)?.props?.columnGap;
  return typeof gap === "number" ? gap : undefined;
}
