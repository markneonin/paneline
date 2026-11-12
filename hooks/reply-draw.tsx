import type { ElementTable, RenderElement, UiPressArgument } from "claude-code";

import type {
  AlertBlock,
  AlertLevel,
  Block,
  FenceBlock,
  Inline,
  LineBreaks,
  ListBlock,
  ListItem,
  QuoteBlock,
  Run,
  RunStyle,
} from "./markdown";
import { TEXT_COLUMN } from "./chat-draw";
import { drawDiagram } from "./diagram";
import { diagramPanel, listPanel } from "./diagram-paint";
import {
  flowOf,
  hasPath,
  inlineElements,
  inlinePieces,
  localPath,
  lineOf,
  plainPiece,
  withPaths,
  withStyle,
} from "./inline-draw";
import type { OpenPath, PathRun, RowPress } from "./inline-draw";
import { memo } from "./memo";
import { isRightToLeft, parse, runsOf } from "./markdown";
import { button, header, sectionLook } from "./pane-kit";
import type { Accent } from "./pane-kit";
import { palette } from "./palette";
import type { Fills } from "./palette";
import { panel } from "./panel";
import { replyLook } from "./reply-look";
import type { ReplyLook } from "./reply-look";
import { tableView } from "./table-draw";
import { displayWidth, wrapRuns } from "./text-width";
import type { Styled } from "./text-width";

type Ui = ElementTable;

type Copy = (text: string, press: UiPressArgument) => void;

export type ReplyActions = {
  copy: Copy;
  open?: OpenPath;
  openDiagram?: (source: string) => void;
  press?: RowPress;
};

type Flow = { width: number; open: OpenPath | undefined };
type BlockScope = ReplyActions & { accent: Accent; lineBreaks?: LineBreaks; slashBreaks?: boolean };

type ReplyRequest = {
  text: string;
  width: number;
  isFirstOfReply: boolean;
  stamp: string;
  surface: string;
  accent: Accent;
  fills: Fills;
  lineBreaks?: LineBreaks;
  slashBreaks?: boolean;
  isFlush?: boolean;
};

const REPLY_CACHE_LIMIT = 40;

const BLOCK_CACHE_LIMIT = 400;

const LIST_INDENT = 2;
const DIAGRAM_INDENT = 2;
export const KEPT_LINE_HANG_CELLS = 2;
type Margin = { marginTop: number; marginBottom: number; marginLeft: number };
const NO_MARGIN: Margin = { marginTop: 0, marginBottom: 0, marginLeft: 0 };
const NESTED_CODE_MARGIN: Margin = {
  marginTop: 1,
  marginBottom: 1,
  marginLeft: DIAGRAM_INDENT,
};
const TASK_MARKER_WIDTH = 4;
const BULLET_MARKER_WIDTH = 2;
const MAX_CODE_SOURCE = 10_000;

const MIN_UNDERLINE = 3;

const HEADING_BOX_EDGES = 4;
const ALERT_FRAME_WIDTH = 4;
const QUOTE_BAR_RIGHT = " │";

type MarkerGap = { before: string; after: string };
const GAP_AFTER: MarkerGap = { before: "", after: " " };
const GAP_BEFORE: MarkerGap = { before: " ", after: "" };

type Tail = { text: string; color: string; weight?: "semibold" };
type TailOf = (row: number) => Tail | null;
type RightRows = { key: string; width: number; open: OpenPath | undefined; tail: TailOf };
type LineLook = { color?: string; weight?: "semibold"; wrap?: "truncate-end" };
type Pieces = ReturnType<typeof inlinePieces>;
const NO_TAIL: TailOf = () => null;

const LEVEL_NAMES: Record<AlertLevel, string> = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
};

const replyCache = memo<RenderElement | null>(REPLY_CACHE_LIMIT);

const blockCache = memo<RenderElement>(BLOCK_CACHE_LIMIT);

export function replyView(
  ui: Ui,
  request: ReplyRequest,
  actions: ReplyActions,
): RenderElement | null {
  const key = `${request.text}|${request.width}|${request.isFirstOfReply}|${request.stamp}|${request.surface}|${request.accent}|${request.fills.source}|${request.lineBreaks}|${request.slashBreaks}|${request.isFlush}|${actions.press !== undefined}`;
  return replyCache(key, () => buildReply(ui, request, actions));
}

function buildReply(ui: Ui, request: ReplyRequest, actions: ReplyActions): RenderElement | null {
  const blocks = parse(request.text, request.lineBreaks);
  if (blocks.length === 0) return null;
  const { Box } = ui;
  const { width, isFirstOfReply, stamp, surface, accent, fills, isFlush } = request;
  const look = replyLook(accent, fills);
  const scope: BlockScope = {
    ...actions,
    accent,
    lineBreaks: request.lineBreaks,
    slashBreaks: request.slashBreaks,
  };
  return (
    <Box flexDirection="column" marginTop={isFlush ? 0 : 1} marginLeft={TEXT_COLUMN} width={width}>
      {isFirstOfReply
        ? header(ui, "CLAUDE", sectionLook(accent === null ? null : look.accent), width, stamp)
        : null}
      <Box flexDirection="column" rowGap={1} marginTop={isFirstOfReply ? 1 : 0}>
        {blocks.map((block, b) =>
          blockCache(
            `${block.raw}|${width}|${surface}|${accent}|${fills.source}|${request.lineBreaks}|${request.slashBreaks}|b${b}`,
            () => blockView(ui, block, look, width, scope, `b${b}`),
          ),
        )}
      </Box>
    </Box>
  );
}

function blockView(
  ui: Ui,
  block: Block,
  look: ReplyLook,
  width: number,
  actions: BlockScope,
  key: string,
): RenderElement {
  return isRightToLeft(block)
    ? rightBlockView(ui, block, look, width, actions, key)
    : leftBlockView(ui, block, look, width, actions, key);
}

function rightBlockView(
  ui: Ui,
  block: Block,
  look: ReplyLook,
  width: number,
  actions: BlockScope,
  key: string,
): RenderElement {
  const { Box } = ui;
  switch (block.kind) {
    case "heading":
      return rightHeadingView(
        ui,
        block.level,
        block.inline,
        look,
        { width, open: actions.open },
        key,
      );
    case "paragraph":
      return (
        <Box key={key} flexDirection="column">
          {rightRows(ui, look, runsOf(block.inline), {
            key,
            width,
            open: actions.open,
            tail: NO_TAIL,
          })}
        </Box>
      );
    case "list":
      return rightListView(ui, block, look, width, actions, key);
    case "alert":
      return rightAlertView(ui, block, look, { width, open: actions.open }, key);
    case "quote":
      return rightQuoteView(ui, block, look, { width, open: actions.open }, key);
    default:
      return leftBlockView(ui, block, look, width, actions, key);
  }
}

function leftBlockView(
  ui: Ui,
  block: Block,
  look: ReplyLook,
  width: number,
  actions: BlockScope,
  key: string,
): RenderElement {
  const { Text } = ui;
  switch (block.kind) {
    case "heading":
      return headingView(ui, block.level, block.inline, look, { width, open: actions.open }, key);
    case "paragraph":
      return flowOf(ui, runsOf(block.inline), look, {
        key,
        width,
        color: look.prose,
        open: actions.open,
        hang: actions.lineBreaks === "kept" ? KEPT_LINE_HANG_CELLS : undefined,
        slashBreaks: actions.slashBreaks,
        press: actions.press,
      });
    case "list":
      return listView(ui, block, look, width, actions, key);
    case "table":
      return tableView(ui, block, look, { width, open: actions.open }, key);
    case "code":
      return codeView(ui, block, look, width, { ...actions, codeMargin: NO_MARGIN }, key);
    case "alert":
      return alertView(ui, block, look, { width, open: actions.open }, key);
    case "quote":
      return quoteView(ui, block, look, { width, open: actions.open }, key);
    case "rule":
      return (
        <Text key={key} color={look.rule}>
          {"─".repeat(width)}
        </Text>
      );
  }
}

function headingView(
  ui: Ui,
  level: number,
  inline: Inline[],
  look: ReplyLook,
  { width, open }: Flow,
  key: string,
): RenderElement {
  const { Box, Text } = ui;
  const { rows, textWidth } = headingRows(withPaths(runsOf(inline), open), level, width);
  const subheadingColor = look.strong;
  const label = (color: string | undefined) =>
    rows.map((row, i) =>
      lineOf(
        ui,
        inlinePieces(ui, row, look, color, { key: `${key}.${i}`, open, weight: "semibold" }),
        `${key}.l${i}`,
        { weight: "semibold", color },
      ),
    );
  if (level === 1)
    return (
      <Box
        key={key}
        borderStyle="round"
        borderColor={look.accent}
        paddingX={1}
        alignSelf="flex-start"
        width={Math.min(width, textWidth + HEADING_BOX_EDGES)}
      >
        <Box flexDirection="column">{label(look.strong)}</Box>
      </Box>
    );
  if (level === 2)
    return (
      <Box key={key} flexDirection="column">
        {label(look.strong)}
        <Text color={look.accent}>
          {"━".repeat(Math.min(width, Math.max(MIN_UNDERLINE, textWidth)))}
        </Text>
      </Box>
    );
  return (
    <Box key={key} flexDirection="column">
      {label(level === 3 ? subheadingColor : look.prose)}
    </Box>
  );
}

function headingRows(
  runs: PathRun[],
  level: number,
  width: number,
): { rows: PathRun[][]; textWidth: number } {
  const rows = wrapRuns(runs, level === 1 ? width - HEADING_BOX_EDGES : width, {
    isLongWordContinuing: true,
    isBreakingAfterSlash: true,
  });
  const drawn = rows.length === 0 ? [[]] : rows;
  const widths = drawn.map((row) => displayWidth(row.map((run) => run.text).join("")));
  return { rows: drawn, textWidth: Math.max(...widths) };
}

function quoteView(
  ui: Ui,
  block: QuoteBlock,
  look: ReplyLook,
  { width, open }: Flow,
  key: string,
): RenderElement {
  const { Box, Text } = ui;
  const rows = block.lines.flatMap((line) => {
    const wrapped = wrapRuns(withPaths(withStyle(line, {}), open), width - 2);
    return wrapped.length === 0 ? [[]] : wrapped;
  });
  return (
    <Box key={key} flexDirection="column">
      {rows.map((row, i) =>
        lineOf(
          ui,
          [
            plainPiece(
              <Text key={`${key}.${i}.bar`} color={look.accent}>
                {"│ "}
              </Text>,
            ),
            ...inlinePieces(ui, italicised(row), look, look.prose, { key: `${key}.${i}`, open }),
          ],
          `${key}.${i}`,
          { color: look.prose },
        ),
      )}
    </Box>
  );
}

function rightRows(
  ui: Ui,
  look: ReplyLook,
  runs: Run[],
  { key, width, open, tail }: RightRows,
): RenderElement[] {
  const { Box, Text } = ui;
  const lead = tail(0);
  const pathRuns = withPaths(runs, open);
  const wrapped = wrapRuns(pathRuns, width - (lead === null ? 0 : displayWidth(lead.text)), {
    isLongWordContinuing: hasPath(pathRuns),
  });
  const rows = wrapped.length === 0 ? [[]] : wrapped;
  return rows.map((row, i) => {
    const end = tail(i);
    return (
      <Box key={`${key}.${i}`} width={width} justifyContent="flex-end">
        {rightLineOf(
          ui,
          inlinePieces(ui, row, look, look.prose, { key: `${key}.${i}`, open }),
          `${key}.${i}.l`,
          {
            color: look.prose,
          },
        )}
        {end === null ? null : (
          <Text color={end.color} weight={end.weight}>
            {end.text}
          </Text>
        )}
      </Box>
    );
  });
}

function rightLineOf(
  { Box, Text }: Ui,
  pieces: Pieces,
  key: string,
  line: LineLook,
): RenderElement {
  if (!pieces.some((piece) => piece.isButton))
    return (
      <Text key={key} dir="rtl" {...line}>
        {pieces.map((piece) => piece.node)}
      </Text>
    );
  const parts: RenderElement[] = [];
  let pending: (RenderElement | string)[] = [];
  const flush = () => {
    if (pending.length === 0) return;
    parts.push(
      <Text key={`${key}.t${parts.length}`} dir="rtl" {...line}>
        {pending}
      </Text>,
    );
    pending = [];
  };
  for (const piece of pieces) {
    if (!piece.isButton) {
      pending.push(piece.node);
      continue;
    }
    flush();
    parts.push(piece.node);
  }
  flush();
  return (
    <Box key={key} flexDirection="row">
      {parts.reverse()}
    </Box>
  );
}

function rightHeadingView(
  ui: Ui,
  level: number,
  inline: Inline[],
  look: ReplyLook,
  { width, open }: Flow,
  key: string,
): RenderElement {
  const { Box, Text } = ui;
  const { rows, textWidth } = headingRows(withPaths(runsOf(inline), open), level, width);
  const subheadingColor = look.strong;
  const label = (color: string | undefined) =>
    rows.map((row, i) =>
      rightLineOf(
        ui,
        inlinePieces(ui, row, look, color, { key: `${key}.${i}`, open, weight: "semibold" }),
        `${key}.l${i}`,
        { weight: "semibold", color },
      ),
    );
  if (level === 1)
    return (
      <Box
        key={key}
        borderStyle="round"
        borderColor={look.accent}
        paddingX={1}
        alignSelf="flex-end"
        width={Math.min(width, textWidth + HEADING_BOX_EDGES)}
      >
        <Box flexDirection="column" alignItems="flex-end">
          {label(look.strong)}
        </Box>
      </Box>
    );
  if (level === 2)
    return (
      <Box key={key} flexDirection="column" alignItems="flex-end">
        {label(look.strong)}
        <Text color={look.accent}>
          {"━".repeat(Math.min(width, Math.max(MIN_UNDERLINE, textWidth)))}
        </Text>
      </Box>
    );
  return (
    <Box key={key} flexDirection="column" alignItems="flex-end">
      {label(level === 3 ? subheadingColor : look.prose)}
    </Box>
  );
}

function rightQuoteView(
  ui: Ui,
  block: QuoteBlock,
  look: ReplyLook,
  { width, open }: Flow,
  key: string,
): RenderElement {
  const { Box } = ui;
  const bar: Tail = { text: QUOTE_BAR_RIGHT, color: look.accent };
  return (
    <Box key={key} flexDirection="column">
      {block.lines.flatMap((line, i) =>
        rightRows(ui, look, italicised(runsOf(line)), {
          key: `${key}.${i}`,
          width,
          open,
          tail: () => bar,
        }),
      )}
    </Box>
  );
}

function rightAlertView(
  ui: Ui,
  block: AlertBlock,
  look: ReplyLook,
  { width, open }: Flow,
  key: string,
): RenderElement {
  const { Box } = ui;
  const color = look.alert[block.level];
  const name = LEVEL_NAMES[block.level];
  const innerWidth = width - ALERT_FRAME_WIDTH;
  const label: Tail = {
    text: block.title.length > 0 ? `  ${name}` : name,
    color,
    weight: "semibold",
  };
  return (
    <Box
      key={key}
      flexDirection="column"
      borderStyle="round"
      borderColor={color}
      paddingX={1}
      width={width}
    >
      {rightRows(ui, look, runsOf(block.title), {
        key: `${key}.t`,
        width: innerWidth,
        open: undefined,
        tail: (row) => (row === 0 ? label : null),
      })}
      {block.lines.flatMap((line, i) =>
        rightRows(ui, look, runsOf(line), {
          key: `${key}.${i}`,
          width: innerWidth,
          open,
          tail: NO_TAIL,
        }),
      )}
    </Box>
  );
}

function italicised<S extends RunStyle>(runs: Styled<S>[]): Styled<S>[] {
  return runs.map((run) => ({ text: run.text, style: { ...run.style, emphasis: true } }));
}

function alertView(
  ui: Ui,
  block: AlertBlock,
  look: ReplyLook,
  { width, open }: Flow,
  key: string,
): RenderElement {
  const { Box, Text } = ui;
  const color = look.alert[block.level];
  const hasTitle = block.title.length > 0;
  return (
    <Box
      key={key}
      flexDirection="column"
      borderStyle="round"
      borderColor={color}
      paddingX={1}
      width={width}
    >
      <Text color={look.prose}>
        <Text weight="semibold" color={color}>
          {LEVEL_NAMES[block.level]}
        </Text>
        {hasTitle ? "  " : ""}
        {inlineElements(ui, runsOf(block.title), look, look.prose, `${key}.t`)}
      </Text>
      {block.lines.map((line, i) =>
        flowOf(ui, runsOf(line), look, {
          key: `${key}.${i}`,
          width: width - ALERT_FRAME_WIDTH,
          color: look.prose,
          open,
        }),
      )}
    </Box>
  );
}

function listView(
  ui: Ui,
  block: ListBlock,
  look: ReplyLook,
  width: number,
  actions: ReplyActions,
  key: string,
): RenderElement {
  const { Box, Text } = ui;
  return (
    <Box key={key} flexDirection="column">
      {block.items.map((item, i) => (
        <Box key={`${key}.${i}`} flexDirection="column" paddingLeft={item.depth * LIST_INDENT}>
          <Box flexDirection="row">
            <Box flexShrink={0}>
              <Text>{markerView(ui, item, look, GAP_AFTER)}</Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              {flowOf(ui, itemRuns(item), look, {
                key: `${key}.${i}`,
                width: width - item.depth * LIST_INDENT - textOffset(item),
                color: look.prose,
                open: actions.open,
              })}
            </Box>
          </Box>
          {nestedFences(ui, item, { look, width, actions }, `${key}.${i}`)}
        </Box>
      ))}
    </Box>
  );
}

function rightListView(
  ui: Ui,
  block: ListBlock,
  look: ReplyLook,
  width: number,
  actions: ReplyActions,
  key: string,
): RenderElement {
  const { Box, Text } = ui;
  return (
    <Box key={key} flexDirection="column">
      {block.items.map((item, i) => (
        <Box key={`${key}.${i}`} flexDirection="column" paddingRight={item.depth * LIST_INDENT}>
          <Box flexDirection="row">
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              {rightRows(ui, look, itemRuns(item), {
                key: `${key}.${i}`,
                width: width - item.depth * LIST_INDENT - textOffset(item),
                open: actions.open,
                tail: NO_TAIL,
              })}
            </Box>
            <Box flexShrink={0}>
              <Text>{markerView(ui, item, look, GAP_BEFORE)}</Text>
            </Box>
          </Box>
          {nestedFences(ui, item, { look, width, actions }, `${key}.${i}`)}
        </Box>
      ))}
    </Box>
  );
}

function itemRuns(item: ListItem): Run[] {
  return item.task === "done" ? withStyle(item.inline, { strike: true }) : runsOf(item.inline);
}

type FenceContext = { look: ReplyLook; width: number; actions: ReplyActions };

function nestedFences(
  ui: Ui,
  item: ListItem,
  { look, width, actions }: FenceContext,
  key: string,
): RenderElement[] {
  const { Box } = ui;
  return item.blocks.map((fence, f) => (
    <Box key={`${key}.${f}`} paddingLeft={textOffset(item) - DIAGRAM_INDENT}>
      {codeView(
        ui,
        fence,
        look,
        width - item.depth * LIST_INDENT - textOffset(item),
        { ...actions, codeMargin: NESTED_CODE_MARGIN },
        `${key}.${f}`,
      )}
    </Box>
  ));
}

function textOffset(item: ListItem): number {
  if (item.task !== null) return TASK_MARKER_WIDTH;
  return item.ordered ? item.marker.length + 1 : BULLET_MARKER_WIDTH;
}

function markerView(
  { Text }: Ui,
  item: ListItem,
  look: ReplyLook,
  { before, after }: MarkerGap,
): RenderElement[] {
  if (item.task === "open")
    return [
      <Text key="m" color={look.muted}>
        {`${before}[ ]${after}`}
      </Text>,
    ];
  if (item.task === "done")
    return [
      <Text key="a" color={look.muted}>
        {`${before}[`}
      </Text>,
      <Text key="b" color={palette.ok}>
        {"✓"}
      </Text>,
      <Text key="c" color={look.muted}>
        {`]${after}`}
      </Text>,
    ];
  return [
    <Text key="m" color={look.accent}>
      {`${before}${item.ordered ? item.marker : bulletOf(item.depth)}${after}`}
    </Text>,
  ];
}

function bulletOf(depth: number): string {
  if (depth === 0) return "•";
  return depth === 1 ? "◦" : "▪";
}

function codeView(
  ui: Ui,
  block: FenceBlock,
  look: ReplyLook,
  width: number,
  { copy, open, openDiagram, codeMargin }: ReplyActions & { codeMargin: Margin },
  key: string,
): RenderElement {
  const source = block.lines.join("\n");
  const diagram =
    block.isClosed && block.lang.toLowerCase() === "mermaid" ? drawDiagram(source, width) : null;
  const onOpen = openDiagram && (() => openDiagram(source));
  if (diagram?.kind === "art") return diagramPanel(ui, diagram.art, look, key, onOpen);
  if (diagram?.kind === "list") return listPanel(ui, diagram.lines, look, key, onOpen);
  const failure = diagram?.kind === "failed" ? diagram.reason : undefined;
  const { Box } = ui;
  return (
    <Box key={`${key}.wrap`} {...codeMargin}>
      {codePanel(ui, block, look, width, { source, copy, open, failure }, key)}
    </Box>
  );
}

type CodeSource = {
  source: string;
  copy: Copy;
  open: OpenPath | undefined;
  failure: string | undefined;
};

function codePanel(
  ui: Ui,
  block: FenceBlock,
  look: ReplyLook,
  width: number,
  { source, copy, open, failure }: CodeSource,
  key: string,
): RenderElement {
  const { Box, Code, Text } = ui;
  const path = block.file === undefined ? null : localPath(block.file);
  const title =
    block.file === undefined ? (
      <Text color={look.onBand ?? look.muted} backgroundColor={look.band}>
        {block.lang || "code"}
      </Text>
    ) : (
      fileTitle(
        ui,
        block.file,
        look,
        path === null || open === undefined ? null : { path, open, key },
      )
    );
  const body = (
    <Box flexDirection="column">
      {source.length <= MAX_CODE_SOURCE ? (
        <Code source={source} language={block.lang || undefined} wrap="wrap" />
      ) : (
        block.lines.map((line, i) => (
          <Text key={`${key}.${i}`} color={look.text}>
            {line === "" ? " " : line}
          </Text>
        ))
      )}
      {failure === undefined ? null : (
        <Text color={look.muted}>{`diagram could not be drawn: ${failure}`}</Text>
      )}
    </Box>
  );
  return panel(ui, {
    key,
    width,
    look,
    title,
    isTitlePressable: path !== null,
    right: [
      button(ui, {
        key: `copy-${key}`,
        label: "Copy",
        onPress: (p) => copy(source, p),
        backgroundColor: look.band,
      }),
    ],
    body,
    background: look.body,
  });
}

function fileTitle(
  ui: Ui,
  file: string,
  look: ReplyLook,
  press: { path: string; open: OpenPath; key: string } | null,
): RenderElement {
  const { Button, Text } = ui;
  const name = (
    <Text weight="semibold" color={palette.userText} backgroundColor={look.band}>
      {file}
    </Text>
  );
  if (press === null) return name;
  return (
    <Button key={`file-${press.key}`} plain onPress={() => press.open(press.path)}>
      {name}
    </Button>
  );
}
