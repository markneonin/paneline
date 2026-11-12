type Props = Record<string, unknown>;
type Drawn = { type?: string; props?: Props; children?: unknown };
type Placed = { lines: string[]; width: number };

const ELLIPSIS = "…";
const NOTHING_TO_SHOW = new Set<unknown>([null, undefined, false, true, ""]);

export function screenRows(drawn: unknown, columns: number): string[] {
  return linesOf(drawn, columns).map((line) => line.padEnd(columns));
}

export function shownText(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(shownText).join("");
  if (typeof node !== "object" || node === null) return "";
  const drawn = node as Drawn;
  if (drawn.type === "Button" && drawn.children === undefined) return buttonLabel(drawn.props);
  return shownText(drawn.children);
}

function buttonLabel(props: Props | undefined): string {
  const label = props?.label;
  return typeof label === "string" ? label : "";
}

export function colouredPieces(
  node: unknown,
  inherited?: unknown,
): { text: string; color: unknown }[] {
  if (Array.isArray(node)) return node.flatMap((child) => colouredPieces(child, inherited));
  if (typeof node === "string") return [{ text: node, color: inherited }];
  if (typeof node !== "object" || node === null) return [];
  const { props, children } = node as Drawn;
  const color = props?.color ?? inherited;
  const parts = itemsOf(children);
  if (parts.every((part) => typeof part === "string")) return [{ text: parts.join(""), color }];
  return parts.flatMap((part) => colouredPieces(part, color));
}

export function coloursOfText(drawn: unknown, text: string): unknown[] {
  const pieces = colouredPieces(drawn);
  const start = pieces
    .map((piece) => piece.text)
    .join("")
    .indexOf(text);
  if (start === -1) throw new Error(`"${text}" is not drawn`);
  const perCharacter = pieces.flatMap((piece) =>
    Array.from({ length: piece.text.length }, () => piece.color),
  );
  const shown = perCharacter.slice(start, start + text.length);
  return [...new Set(shown.filter((_, index) => text[index] !== " "))];
}

function itemsOf(children: unknown): (string | Drawn)[] {
  if (Array.isArray(children)) return children.flatMap(itemsOf);
  if (NOTHING_TO_SHOW.has(children)) return [];
  if (typeof children === "number") return [String(children)];
  if (typeof children === "string") return [children];
  return [children as Drawn];
}

function numberProp(props: Props | undefined, ...names: string[]): number {
  for (const name of names) {
    const value = props?.[name];
    if (typeof value === "number") return value;
  }
  return 0;
}

function edge(props: Props | undefined, side: "Left" | "Right" | "Top" | "Bottom"): number {
  const axis = side === "Left" || side === "Right" ? "X" : "Y";
  return numberProp(props, `padding${side}`, `padding${axis}`, "padding");
}

function margin(props: Props | undefined, side: "Left" | "Right" | "Top" | "Bottom"): number {
  const axis = side === "Left" || side === "Right" ? "X" : "Y";
  return numberProp(props, `margin${side}`, `margin${axis}`, "margin");
}

function isTruncating(props: Props | undefined): boolean {
  return typeof props?.wrap === "string" && props.wrap.startsWith("truncate");
}

function textLines(node: string | Drawn): string[] {
  return shownText(node).split("\n");
}

function chunks(line: string, width: number): string[] {
  if (width <= 0) return [""];
  const parts: string[] = [];
  for (let start = 0; start < Math.max(line.length, 1); start += width)
    parts.push(line.slice(start, start + width));
  return parts;
}

function textBlock(node: string | Drawn, width: number): string[] {
  const props = typeof node === "string" ? undefined : node.props;
  return textLines(node).flatMap((line) => {
    if (line.length <= width) return [line];
    if (isTruncating(props)) return [`${line.slice(0, Math.max(width - 1, 0))}${ELLIPSIS}`];
    return chunks(line, width);
  });
}

function directionOf(props: Props | undefined): "row" | "column" {
  return props?.flexDirection === "column" || props?.flexDirection === "column-reverse"
    ? "column"
    : "row";
}

function gapOf(props: Props | undefined, direction: "row" | "column"): number {
  return numberProp(props, direction === "row" ? "columnGap" : "rowGap", "gap");
}

function isHidden(node: string | Drawn): boolean {
  return typeof node !== "string" && node.props?.display === "none";
}

function naturalWidth(node: string | Drawn): number {
  if (typeof node === "string") return Math.max(...node.split("\n").map((line) => line.length));
  if (node.type !== "Box") return Math.max(...textLines(node).map((line) => line.length));
  const explicit = node.props?.width;
  if (typeof explicit === "number") return explicit;
  const direction = directionOf(node.props);
  const widths = itemsOf(node.children)
    .filter((child) => !isHidden(child))
    .map(outerWidth);
  const inner =
    direction === "row"
      ? widths.reduce((sum, width) => sum + width, 0) +
        gapOf(node.props, direction) * Math.max(widths.length - 1, 0)
      : Math.max(0, ...widths);
  return inner + edge(node.props, "Left") + edge(node.props, "Right");
}

function outerWidth(node: string | Drawn): number {
  const props = typeof node === "string" ? undefined : node.props;
  return naturalWidth(node) + margin(props, "Left") + margin(props, "Right");
}

function fitted(lines: string[], width: number): string[] {
  return lines.map((line) => line.padEnd(width));
}

function linesOf(node: unknown, width: number): string[] {
  const items = itemsOf(node);
  if (items.length !== 1) return items.flatMap((item) => linesOf(item, width));
  const only = items[0] as string | Drawn;
  if (typeof only === "string" || only.type !== "Box") return textBlock(only, width);
  return boxLines(only, width);
}

function boxLines(box: Drawn, width: number): string[] {
  const props = box.props;
  const padLeft = edge(props, "Left");
  const padRight = edge(props, "Right");
  const inner = Math.max(width - padLeft - padRight, 0);
  const children = itemsOf(box.children).filter((child) => !isHidden(child));
  const direction = directionOf(props);
  const body =
    direction === "column" ? columnLines(children, props, inner) : rowLines(children, props, inner);
  const height = props?.height;
  const sized =
    typeof height === "number" ? Array.from({ length: height }, (_row, y) => body[y] ?? "") : body;
  const padded = sized.map(
    (line) => `${" ".repeat(padLeft)}${line.padEnd(inner)}${" ".repeat(padRight)}`,
  );
  const blank = " ".repeat(width);
  const top = Array.from({ length: edge(props, "Top") }, () => blank);
  const bottom = Array.from({ length: edge(props, "Bottom") }, () => blank);
  return [...top, ...padded, ...bottom];
}

function crossOffset(align: unknown, room: number): number {
  if (align === "flex-end") return Math.max(room, 0);
  if (align === "center") return Math.max(Math.floor(room / 2), 0);
  return 0;
}

function placedChild(child: string | Drawn, width: number): Placed {
  const props = typeof child === "string" ? undefined : child.props;
  const left = margin(props, "Left");
  const right = margin(props, "Right");
  const body = fitted(linesOf(child, Math.max(width - left - right, 0)), width - left - right);
  const top = Array.from({ length: margin(props, "Top") }, () => " ".repeat(width));
  const bottom = Array.from({ length: margin(props, "Bottom") }, () => " ".repeat(width));
  const sides = body.map((line) => `${" ".repeat(left)}${line}${" ".repeat(right)}`);
  return { lines: [...top, ...sides, ...bottom], width };
}

function columnLines(
  children: (string | Drawn)[],
  props: Props | undefined,
  inner: number,
): string[] {
  const gap = gapOf(props, "column");
  const blank = " ".repeat(inner);
  const placed = children.map((child) => {
    const childProps = typeof child === "string" ? undefined : child.props;
    const own = childProps?.alignSelf;
    const align = own === undefined || own === "auto" ? props?.alignItems : own;
    const isStretched = align === undefined || align === "stretch";
    const width = isStretched ? inner : Math.min(outerWidth(child), inner);
    const offset = crossOffset(align, inner - width);
    return placedChild(child, width).lines.map((line) =>
      `${" ".repeat(offset)}${line}`.padEnd(inner),
    );
  });
  return placed.flatMap((lines, index) =>
    index === 0 ? lines : [...Array.from({ length: gap }, () => blank), ...lines],
  );
}

function shrunk(widths: number[], children: (string | Drawn)[], overflow: number): number[] {
  const shrinkable = children.map((child) => {
    const flexShrink = typeof child === "string" ? undefined : child.props?.flexShrink;
    return flexShrink !== 0;
  });
  const weights = widths.map((width, index) => (shrinkable[index] ? width : 0));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total === 0) return widths;
  return widths.map((width, index) =>
    Math.max(width - Math.ceil(((weights[index] ?? 0) / total) * overflow), 0),
  );
}

function grown(widths: number[], children: (string | Drawn)[], free: number): number[] {
  const grows = children.map((child) =>
    typeof child === "string" ? 0 : numberProp(child.props, "flexGrow"),
  );
  const total = grows.reduce((sum, grow) => sum + grow, 0);
  if (total === 0) return widths;
  return widths.map((width, index) => width + Math.floor(((grows[index] ?? 0) / total) * free));
}

function leadAndBetween(
  justify: unknown,
  free: number,
  count: number,
): { lead: number; between: number } {
  if (free <= 0) return { lead: 0, between: 0 };
  if (justify === "flex-end") return { lead: free, between: 0 };
  if (justify === "center") return { lead: Math.floor(free / 2), between: 0 };
  if (justify === "space-between" && count > 1)
    return { lead: 0, between: Math.floor(free / (count - 1)) };
  return { lead: 0, between: 0 };
}

function rowLines(children: (string | Drawn)[], props: Props | undefined, inner: number): string[] {
  const gap = gapOf(props, "row");
  const naturals = children.map(outerWidth);
  const gaps = gap * Math.max(children.length - 1, 0);
  const free = inner - naturals.reduce((sum, width) => sum + width, 0) - gaps;
  const widths = free < 0 ? shrunk(naturals, children, -free) : grown(naturals, children, free);
  const used = widths.reduce((sum, width) => sum + width, 0) + gaps;
  const { lead, between } = leadAndBetween(props?.justifyContent, inner - used, children.length);
  const cells = children.map((child, index) => placedChild(child, widths[index] ?? 0));
  const height = Math.max(0, ...cells.map((cell) => cell.lines.length));
  const rows = Array.from({ length: height }, () => " ".repeat(lead));
  cells.forEach((cell, index) => {
    const own =
      typeof children[index] === "string" ? undefined : (children[index] as Drawn).props?.alignSelf;
    const align = own === undefined || own === "auto" ? props?.alignItems : own;
    const top = crossOffset(align, height - cell.lines.length);
    const separator = " ".repeat(index === 0 ? 0 : gap + between);
    rows.forEach((_row, y) => {
      const line = cell.lines[y - top] ?? " ".repeat(cell.width);
      rows[y] = `${rows[y] ?? ""}${separator}${line}`;
    });
  });
  return rows;
}
