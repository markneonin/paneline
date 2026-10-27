import type { ElementTable, RenderElement, UiPressArgument } from "claude-code";

import type {
  AlertBlock,
  AlertLevel,
  Block,
  CodeBlock,
  Inline,
  ListBlock,
  ListItem,
  QuoteBlock,
  Run,
} from "./markdown";
import { TEXT_COLUMN } from "./chat-draw";
import { drawDiagram } from "./diagram";
import { diagramPanel, listPanel } from "./diagram-paint";
import { inlineElements, withStyle } from "./inline-draw";
import { memo } from "./memo";
import { parse, plainOf, runsOf } from "./markdown";
import { button, header, sectionLook } from "./pane-kit";
import type { Accent } from "./pane-kit";
import { palette } from "./palette";
import type { Fills } from "./palette";
import { panel } from "./panel";
import { replyLook } from "./reply-look";
import type { ReplyLook } from "./reply-look";
import { tableView } from "./table-draw";
import { displayWidth, wrapRuns } from "./text-width";

type Ui = ElementTable;

type Copy = (text: string, press: UiPressArgument) => void;

type ReplyRequest = {
  text: string;
  width: number;
  isFirstOfReply: boolean;
  surface: string;
  accent: Accent;
  fills: Fills;
};

const REPLY_CACHE_LIMIT = 40;

const BLOCK_CACHE_LIMIT = 400;

const MAX_CODE_SOURCE = 10_000;

const MIN_UNDERLINE = 3;

const LEVEL_NAMES: Record<AlertLevel, string> = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
};

const replyCache = memo<RenderElement | null>(REPLY_CACHE_LIMIT);

const blockCache = memo<RenderElement>(BLOCK_CACHE_LIMIT);

export function replyView(ui: Ui, request: ReplyRequest, copy: Copy): RenderElement | null {
  const key = `${request.text}|${request.width}|${request.isFirstOfReply}|${request.surface}|${request.accent}|${request.fills.source}`;
  return replyCache(key, () => buildReply(ui, request, copy));
}

function buildReply(ui: Ui, request: ReplyRequest, copy: Copy): RenderElement | null {
  const blocks = parse(request.text);
  if (blocks.length === 0) return null;
  const { Box } = ui;
  const { width, isFirstOfReply, surface, accent, fills } = request;
  const look = replyLook(accent, fills);
  return (
    <Box flexDirection="column" marginTop={1} marginLeft={TEXT_COLUMN} width={width}>
      {isFirstOfReply ? header(ui, "CLAUDE", sectionLook(accent), width) : null}
      <Box flexDirection="column" rowGap={1} marginTop={isFirstOfReply ? 1 : 0}>
        {blocks.map((block, b) =>
          blockCache(`${block.raw}|${width}|${surface}|${accent}|b${b}`, () =>
            blockView(ui, block, look, width, copy, `b${b}`),
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
  copy: Copy,
  key: string,
): RenderElement {
  const { Text } = ui;
  switch (block.kind) {
    case "heading":
      return headingView(ui, block.level, block.inline, look, width, key);
    case "paragraph":
      return (
        <Text key={key} color={look.prose}>
          {inlineElements(ui, runsOf(block.inline), look, look.prose, key)}
        </Text>
      );
    case "list":
      return listView(ui, block, look, key);
    case "table":
      return tableView(ui, block, look, width, key);
    case "code":
      return codeView(ui, block, look, width, copy, key);
    case "alert":
      return alertView(ui, block, look, width, key);
    case "quote":
      return quoteView(ui, block, look, width, key);
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
  width: number,
  key: string,
): RenderElement {
  const { Box, Text } = ui;
  const runs = runsOf(inline);
  const labelWidth = displayWidth(plainOf(inline));
  const label = (color: string | undefined) => (
    <Text weight="semibold" color={color} wrap="truncate-end">
      {inlineElements(ui, runs, look, color, key)}
    </Text>
  );
  if (level === 1)
    return (
      <Box
        key={key}
        borderStyle="round"
        borderColor={look.accent}
        paddingX={1}
        alignSelf="flex-start"
        width={Math.min(width, labelWidth + 4)}
      >
        {label(look.strong)}
      </Box>
    );
  if (level === 2)
    return (
      <Box key={key} flexDirection="column">
        {label(look.strong)}
        <Text color={look.accent}>
          {"━".repeat(Math.min(width, Math.max(MIN_UNDERLINE, labelWidth)))}
        </Text>
      </Box>
    );
  return <Box key={key}>{label(level === 3 ? look.accent : look.prose)}</Box>;
}

function quoteView(
  ui: Ui,
  block: QuoteBlock,
  look: ReplyLook,
  width: number,
  key: string,
): RenderElement {
  const { Box, Text } = ui;
  const rows = block.lines.flatMap((line) => {
    const wrapped = wrapRuns(withStyle(line, {}), width - 2);
    return wrapped.length === 0 ? [[]] : wrapped;
  });
  return (
    <Box key={key} flexDirection="column">
      {rows.map((row, i) => (
        <Text key={`${key}.${i}`} color={look.prose}>
          <Text color={look.accent}>{"│ "}</Text>
          {inlineElements(ui, italicised(row), look, look.prose, `${key}.${i}`)}
        </Text>
      ))}
    </Box>
  );
}

function italicised(runs: Run[]): Run[] {
  return runs.map((run) => ({ text: run.text, style: { ...run.style, emphasis: true } }));
}

function alertView(
  ui: Ui,
  block: AlertBlock,
  look: ReplyLook,
  width: number,
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
      {block.lines.map((line, i) => (
        <Text key={`${key}.${i}`} color={look.prose}>
          {inlineElements(ui, runsOf(line), look, look.prose, `${key}.${i}`)}
        </Text>
      ))}
    </Box>
  );
}

function listView(ui: Ui, block: ListBlock, look: ReplyLook, key: string): RenderElement {
  const { Box, Text } = ui;
  return (
    <Box key={key} flexDirection="column">
      {block.items.map((item, i) => {
        const isDone = item.task === "done";
        const runs = isDone ? withStyle(item.inline, { strike: true }) : runsOf(item.inline);
        return (
          <Box key={`${key}.${i}`} flexDirection="row" paddingLeft={item.depth * 2}>
            <Box flexShrink={0}>
              <Text>{markerView(ui, item, look)}</Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              <Text color={look.prose}>
                {inlineElements(ui, runs, look, look.prose, `${key}.${i}`)}
              </Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

function markerView({ Text }: Ui, item: ListItem, look: ReplyLook): RenderElement[] {
  if (item.task === "open")
    return [
      <Text key="m" color={look.muted}>
        {"[ ] "}
      </Text>,
    ];
  if (item.task === "done")
    return [
      <Text key="a" color={look.muted}>
        {"["}
      </Text>,
      <Text key="b" color={palette.ok}>
        {"✓"}
      </Text>,
      <Text key="c" color={look.muted}>
        {"] "}
      </Text>,
    ];
  return [
    <Text key="m" color={look.accent}>
      {item.ordered ? `${item.marker} ` : `${bulletOf(item.depth)} `}
    </Text>,
  ];
}

function bulletOf(depth: number): string {
  if (depth === 0) return "•";
  return depth === 1 ? "◦" : "▪";
}

function codeView(
  ui: Ui,
  block: CodeBlock,
  look: ReplyLook,
  width: number,
  copy: Copy,
  key: string,
): RenderElement {
  const source = block.lines.join("\n");
  const diagram =
    block.isClosed && block.lang.toLowerCase() === "mermaid" ? drawDiagram(source, width) : null;
  if (diagram?.kind === "art") return diagramPanel(ui, diagram.art, look, key);
  if (diagram?.kind === "list") return listPanel(ui, diagram.lines, look, key);
  const failure = diagram?.kind === "failed" ? diagram.reason : undefined;
  return codePanel(ui, block, look, width, { source, copy, failure }, key);
}

type CodeSource = { source: string; copy: Copy; failure: string | undefined };

function codePanel(
  ui: Ui,
  block: CodeBlock,
  look: ReplyLook,
  width: number,
  { source, copy, failure }: CodeSource,
  key: string,
): RenderElement {
  const { Box, Code, Text } = ui;
  const title =
    block.file === undefined ? (
      <Text color={look.onBand ?? look.muted} backgroundColor={look.band}>
        {block.lang || "code"}
      </Text>
    ) : (
      <Text weight="semibold" color={palette.userText} backgroundColor={look.band}>
        {block.file}
      </Text>
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
