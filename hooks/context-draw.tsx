import type {
  ContextCategory,
  ContextCategoryKind,
  ContextGridSquare,
  ElementTable,
  RenderElement,
  SessionContextBreakdown,
} from "claude-code";

import type { CompactionRow, ContextLog, SpendState } from "../types";
import type { WastedLine } from "./context-log";
import { MCP_TAB } from "./mcp-tab";
import { clockOf, formatTokens } from "./format";
import { button, paneRow, plural } from "./pane-kit";
import { paneInk } from "./pane-ink";
import { SKILLS_TAB } from "./skills-tab";
import { clipEnd, displayWidth } from "./text-width";

type Ui = ElementTable;

export type ContextView = {
  context: SessionContextBreakdown | null;
  autoCompact: number | null;
  spend: SpendState;
  log: ContextLog;
  wasted: WastedLine[];
  isMainTurnRunning: boolean;
  width: number;
  compact: () => void;
  showTab: (id: string) => void;
};

type TabLink = { id: string; label: string };

type Section = {
  title: string;
  hint: string | TabLink;
  count: number;
  unit: string;
  tokens: number;
};

const SIDE_BY_SIDE_WIDTH = 60;
const TEN_COLUMN_GRID = 10;
const MAX_COMPACTION_ROWS = 3;
const MAX_WASTED_ROWS = 5;
const GRID_GAP = 2;
const FULL_SQUARE_FROM = 0.7;
const FULL_FROM_PERCENT = 80;
const PERCENT = 100;
const LEGEND_GAP = 2;
const LEGEND_GLYPH_CELLS = 2;
const TOKEN_UNIT = " tokens";
const TITLE_SEPARATOR = " · ";
const BUFFER_NOTE = "kept free for auto-compact";
const DEFERRED_NOTE = "loaded only when used, not in the total";
const COMPACT_NOTE = "summarise the chat to free space";
const COMPACT_BUTTON_CELLS = "[ compact ]".length;

const GLYPH_BY_KIND: Record<ContextCategoryKind, string> = {
  used: "⛁",
  deferred: "⛁",
  free: "⛶",
  buffer: "⛝",
};
const TAIL_KINDS: ContextCategoryKind[] = ["deferred", "free", "buffer"];
const NOTE_BY_KIND: Partial<Record<ContextCategoryKind, string>> = {
  deferred: DEFERRED_NOTE,
  buffer: BUFFER_NOTE,
};
const MAX_TURNS_SHOWN = 100;
const COMPACT_TURN_RUNNING = "compact · turn running";

export function contextTab(ui: Ui, view: ContextView): RenderElement {
  const { Box, Text } = ui;
  const { context } = view;
  if (context === null) {
    return (
      <Text color={paneInk().muted} wrap="truncate-end">
        no context data yet
      </Text>
    );
  }
  const grid = gridBlock(ui, context);
  const isSideBySide = view.width >= sideBySideMinWidthOf(context);
  const summaryWidth = isSideBySide ? view.width - gridWidthOf(context) - GRID_GAP : view.width;
  const summary = [
    ...headerLines(ui, context, view),
    ...summaryGapRows(ui, view, summaryWidth),
    ...legendLines(ui, context, summaryWidth),
  ];
  const sections = [...sectionBlocks(ui, context, view.showTab), ...logBlocks(ui, view)];
  return (
    <Box key="context-body" flexDirection="column">
      {isSideBySide ? (
        <Box flexDirection="row" columnGap={GRID_GAP} flexShrink={0}>
          {grid}
          <Box flexDirection="column" width={summaryWidth}>
            {summary}
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column" flexShrink={0}>
          {grid}
          {blankRow(ui, "grid-gap")}
          {summary}
        </Box>
      )}
      {sections.flatMap((section, i) => [
        blankRow(ui, `gap-${i}`),
        <Box key={`section-${i}`} flexDirection="column" flexShrink={0}>
          {section}
        </Box>,
      ])}
    </Box>
  );
}

function widthOfColumns(columns: number): number {
  return Math.max(0, 2 * columns - 1);
}

function gridWidthOf(context: SessionContextBreakdown): number {
  return widthOfColumns(Math.max(0, ...context.gridRows.map((row) => row.length)));
}

function sideBySideMinWidthOf(context: SessionContextBreakdown): number {
  return SIDE_BY_SIDE_WIDTH + Math.max(0, gridWidthOf(context) - widthOfColumns(TEN_COLUMN_GRID));
}

function gridBlock(ui: Ui, context: SessionContextBreakdown): RenderElement {
  const { Box, Text } = ui;
  const kindByName = new Map(context.categories.map((category) => [category.name, category.kind]));
  const colors = categoryColorsOf(context);
  return (
    <Box flexDirection="column" width={gridWidthOf(context)} flexShrink={0}>
      {context.gridRows.map((row, rowIndex) => (
        <Text key={`grid-${rowIndex}`} wrap="truncate-end">
          {row.map((square, i) => (
            <Text
              key={`${rowIndex}-${i}`}
              color={colors.get(square.categoryName)}
              wrap="truncate-end"
            >
              {`${squareGlyph(square, kindByName)}${i < row.length - 1 ? " " : ""}`}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}

function categoryColorsOf(context: SessionContextBreakdown): Map<string, string> {
  const ink = paneInk();
  if (!ink.isRecoloured) {
    return new Map(context.categories.map((category) => [category.name, category.color]));
  }
  const used = context.categories.filter((category) => category.kind === "used");
  return new Map(
    context.categories.map((category) => [
      category.name,
      category.kind === "used" ? ink.hues[used.indexOf(category) % ink.hues.length]! : ink.muted,
    ]),
  );
}

function squareGlyph(
  square: ContextGridSquare,
  kindByName: Map<string, ContextCategoryKind>,
): string {
  const kind = kindByName.get(square.categoryName) ?? "used";
  return kind === "used" && square.squareFullness < FULL_SQUARE_FROM ? "⛀" : GLYPH_BY_KIND[kind];
}

function turnsToCompact(context: SessionContextBreakdown, spend: SpendState): string | null {
  const threshold = context.autoCompactThreshold;
  if (threshold === undefined || spend.growthCount === 0) return null;
  const meanGrowth = spend.growthSum / spend.growthCount;
  const turns = Math.max(1, Math.ceil((threshold - context.totalTokens) / meanGrowth));
  if (turns >= MAX_TURNS_SHOWN) return null;
  return ` · ~${turns} ${plural("turn", turns)} left`;
}

function headerLines(ui: Ui, context: SessionContextBreakdown, view: ContextView): RenderElement[] {
  const { Text } = ui;
  const isFull = context.percentage >= FULL_FROM_PERCENT;
  return [
    <Text color={paneInk().text} key="model" weight="semibold" wrap="truncate-end">
      {context.model}
    </Text>,
    <Text key="usage" wrap="truncate-end">
      <Text color={paneInk().text} wrap="truncate-end">
        {`${formatTokens(context.totalTokens)}/${formatTokens(context.rawMaxTokens)} tokens (`}
      </Text>
      <Text weight="semibold" color={isFull ? paneInk().alert : paneInk().text} wrap="truncate-end">
        {`${context.percentage}%`}
      </Text>
      {isFull && (
        <Text color={paneInk().alert} weight="semibold" wrap="truncate-end">
          {" !"}
        </Text>
      )}
      <Text color={paneInk().muted} wrap="truncate-end">
        {" of window"}
      </Text>
      <Text color={paneInk().text} wrap="truncate-end">
        {")"}
      </Text>
    </Text>,
    ...autoCompactLines(ui, context, view),
  ];
}

function autoCompactLines(
  { Text }: Ui,
  context: SessionContextBreakdown,
  view: ContextView,
): RenderElement[] {
  const { autoCompact } = view;
  if (context.autoCompactThreshold === undefined || autoCompact === null) return [];
  const turns = turnsToCompact(context, view.spend);
  return [
    <Text key="auto-compact" wrap="truncate-end">
      <Text weight="semibold" color={paneInk().text} wrap="truncate-end">
        {`${autoCompact}%`}
      </Text>
      <Text color={paneInk().text} wrap="truncate-end">
        {" to auto-compact"}
      </Text>
      {turns === null ? null : (
        <Text color={paneInk().muted} wrap="truncate-end">
          {turns}
        </Text>
      )}
    </Text>,
  ];
}

type LegendRow = {
  name: string;
  glyph: string;
  color: string | undefined;
  tokens: string;
  share: string;
  note: string;
};

type LegendColumns = { name: number; tokens: number; share: number };

function legendLines(ui: Ui, context: SessionContextBreakdown, width: number): RenderElement[] {
  const colors = categoryColorsOf(context);
  const shown = context.categories.filter((category) => category.tokens > 0);
  const byTokens = (a: ContextCategory, b: ContextCategory): number =>
    tail(a) - tail(b) || b.tokens - a.tokens;
  const legendRows = [...shown]
    .sort(byTokens)
    .map((category) => legendRowOf(category, colors.get(category.name), context.rawMaxTokens));
  const columns = legendColumnsOf(legendRows, width);
  const fullCells = legendFullCellsOf(legendRows, columns);
  return legendRows.flatMap((row) =>
    legendRowElements(ui, row, columns, fullCells + inlineNoteOf(row.note).length <= width),
  );
}

function legendRowElements(
  { Box, Text }: Ui,
  row: LegendRow,
  columns: LegendColumns,
  isNoteInline: boolean,
): RenderElement[] {
  const line = (
    <Box key={row.name} flexDirection="row" height={1} flexShrink={0}>
      <Box flexDirection="row" flexShrink={0}>
        <Text color={row.color} wrap="truncate-end">{`${row.glyph} `}</Text>
        <Box width={columns.name} flexShrink={0}>
          <Text color={paneInk().text} wrap="truncate-end">
            {clipEnd(row.name, columns.name)}
          </Text>
        </Box>
      </Box>
      <Box flexDirection="row" marginLeft={LEGEND_GAP} flexShrink={0}>
        <Box width={columns.tokens} flexShrink={0} justifyContent="flex-end">
          <Text color={paneInk().text} weight="semibold" wrap="truncate-end">
            {row.tokens}
          </Text>
        </Box>
        <Box width={TOKEN_UNIT.length} flexShrink={0}>
          <Text color={paneInk().muted} wrap="truncate-end">
            {TOKEN_UNIT}
          </Text>
        </Box>
      </Box>
      <Box width={columns.share} marginLeft={LEGEND_GAP} flexShrink={0} justifyContent="flex-end">
        <Text color={paneInk().muted} wrap="truncate-end">
          {row.share}
        </Text>
      </Box>
      {row.note === "" || !isNoteInline ? null : (
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text color={paneInk().muted} wrap="truncate-end">
            {inlineNoteOf(row.note)}
          </Text>
        </Box>
      )}
    </Box>
  );
  if (row.note === "" || isNoteInline) return [line];
  return [
    line,
    <Box key={`${row.name}-note`} height={1} marginLeft={LEGEND_GLYPH_CELLS}>
      <Text color={paneInk().muted} wrap="truncate-end">
        {row.note}
      </Text>
    </Box>,
  ];
}

function legendFullCellsOf(rows: LegendRow[], columns: LegendColumns): number {
  const names = Math.max(0, ...rows.map((row) => displayWidth(row.name)));
  return (
    names + LEGEND_GLYPH_CELLS + columns.tokens + TOKEN_UNIT.length + columns.share + 2 * LEGEND_GAP
  );
}

function legendRowOf(
  category: ContextCategory,
  color: string | undefined,
  window: number,
): LegendRow {
  return {
    name: category.name,
    glyph: GLYPH_BY_KIND[category.kind],
    color,
    tokens: formatTokens(category.tokens),
    share: category.kind === "deferred" ? "" : `${share(category.tokens, window)}%`,
    note: NOTE_BY_KIND[category.kind] ?? "",
  };
}

function legendColumnsOf(rows: LegendRow[], width: number): LegendColumns {
  const widest = (cells: number[]): number => Math.max(0, ...cells);
  const tokens = widest(rows.map((row) => row.tokens.length));
  const share = widest(rows.map((row) => row.share.length));
  const fixedCells = LEGEND_GLYPH_CELLS + tokens + TOKEN_UNIT.length + share + 2 * LEGEND_GAP;
  const names = widest(rows.map((row) => displayWidth(row.name)));
  return {
    name: Math.max(1, Math.min(names, width - fixedCells)),
    tokens,
    share,
  };
}

function tail(category: ContextCategory): number {
  return TAIL_KINDS.indexOf(category.kind) + 1;
}

function sectionBlocks(
  ui: Ui,
  context: SessionContextBreakdown,
  showTab: (id: string) => void,
): RenderElement[][] {
  const { Text } = ui;
  const sections: Section[] = [
    {
      title: "MCP tools",
      hint: { id: MCP_TAB.id, label: "MCP tab" },
      count: context.mcpTools.length,
      unit: "tool",
      tokens: sum(context.mcpTools.filter((tool) => tool.isLoaded)),
    },
    {
      title: "Custom agents",
      hint: ".claude/agents/",
      count: context.agents.length,
      unit: "agent",
      tokens: sum(context.agents),
    },
    {
      title: "Memory files",
      hint: "/memory",
      count: context.memoryFiles.length,
      unit: "file",
      tokens: sum(context.memoryFiles),
    },
    {
      title: "Skills",
      hint: { id: SKILLS_TAB.id, label: "Skills tab" },
      count: context.skills?.totalSkills ?? 0,
      unit: "skill",
      tokens: context.skills?.tokens ?? 0,
    },
  ];
  return sections
    .filter((section) => section.count > 0)
    .map((section) => [
      sectionTitle(ui, section, showTab),
      <Text key={`${section.title}-count`} color={paneInk().muted} wrap="truncate-end">
        {`└ ${section.count} ${plural(section.unit, section.count)} · ${formatTokens(section.tokens)} tokens`}
      </Text>,
    ]);
}

function sectionTitle(ui: Ui, section: Section, showTab: (id: string) => void): RenderElement {
  const { Box, Text } = ui;
  const { title, hint } = section;
  if (typeof hint === "string") {
    return (
      <Text key={`${title}-title`} wrap="truncate-end">
        <Text weight="semibold" color={paneInk().text} wrap="truncate-end">
          {title}
        </Text>
        <Text color={paneInk().muted} wrap="truncate-end">{` · ${hint}`}</Text>
      </Text>
    );
  }
  return (
    <Box key={`${title}-title`} flexDirection="row" height={1}>
      <Text weight="semibold" color={paneInk().text} wrap="truncate-end">
        {title}
      </Text>
      <Text color={paneInk().muted} wrap="truncate-end">
        {TITLE_SEPARATOR}
      </Text>
      {button(ui, {
        key: `${title}-tab`,
        label: hint.label,
        onPress: () => showTab(hint.id),
      })}
    </Box>
  );
}

function logBlocks(ui: Ui, view: ContextView): RenderElement[][] {
  const compactions = [...view.log.compactions].reverse();
  const shown = compactions.slice(0, MAX_COMPACTION_ROWS);
  const beforeWidth = Math.max(...shown.map((row) => tokensOrUnknown(row.before).length));
  const blocks = [
    cappedBlock(ui, {
      key: "compactions",
      title: "Compactions",
      hint: "/compact",
      rows: compactions.map((row) => compactionRow(ui, row, view.width, beforeWidth)),
      max: MAX_COMPACTION_ROWS,
    }),
    cappedBlock(ui, {
      key: "wasted",
      title: "Wasted reads",
      hint: "same file or result again",
      rows: view.wasted.map((line, i) => wastedRow(ui, line, i, view.width)),
      max: MAX_WASTED_ROWS,
    }),
  ];
  return blocks.filter((block) => block.length > 0);
}

type CappedBlock = { key: string; title: string; hint: string; rows: RenderElement[]; max: number };

function cappedBlock({ Text }: Ui, block: CappedBlock): RenderElement[] {
  if (block.rows.length === 0) return [];
  const hidden = block.rows.length - block.max;
  return [
    <Text key={`${block.key}-title`} wrap="truncate-end">
      <Text weight="semibold" color={paneInk().text} wrap="truncate-end">
        {block.title}
      </Text>
      <Text color={paneInk().muted} wrap="truncate-end">{` · ${block.hint}`}</Text>
    </Text>,
    ...block.rows.slice(0, block.max),
    ...(hidden > 0
      ? [
          <Text key={`${block.key}-more`} color={paneInk().muted} wrap="truncate-end">
            {`+${hidden} more`}
          </Text>,
        ]
      : []),
  ];
}

function compactionRow(
  ui: Ui,
  row: CompactionRow,
  width: number,
  beforeWidth: number,
): RenderElement {
  return paneRow(ui, {
    key: `compaction-${row.at}`,
    label: { text: clockOf(row.at), color: paneInk().muted },
    middle: {
      text: `${tokensOrUnknown(row.before).padStart(beforeWidth)} → ${tokensOrUnknown(row.after)}`,
      color: paneInk().text,
    },
    middleWrap: "truncate-end",
    width,
  });
}

function tokensOrUnknown(tokens: number | null): string {
  return tokens === null ? "?" : formatTokens(tokens);
}

function wastedRow(ui: Ui, line: WastedLine, index: number, width: number): RenderElement {
  const { kind, row } = line;
  return paneRow(ui, {
    key: `wasted-${index}`,
    label: { text: `×${row.count}`, color: paneInk().muted },
    middle: {
      text: kind === "read" ? row.target : `${row.tool} ${row.target}`,
      color: paneInk().text,
    },
    middleWrap: kind === "read" ? "truncate-start" : "truncate-end",
    right: { text: formatTokens(row.tokens), color: paneInk().muted },
    width,
  });
}

function summaryGapRows(ui: Ui, view: ContextView, width: number): RenderElement[] {
  const { Box, Text } = ui;
  if (view.isMainTurnRunning) {
    return [
      <Box key="summary-gap" height={1} flexDirection="row">
        <Text color={paneInk().muted} wrap="truncate-end">
          {COMPACT_TURN_RUNNING}
        </Text>
      </Box>,
    ];
  }
  const isNoteInline = COMPACT_BUTTON_CELLS + inlineNoteOf(COMPACT_NOTE).length <= width;
  const row = (
    <Box key="summary-gap" height={1} flexDirection="row">
      {button(ui, { key: "compact", label: "compact", onPress: view.compact })}
      {isNoteInline ? (
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text color={paneInk().muted} wrap="truncate-end">
            {inlineNoteOf(COMPACT_NOTE)}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
  if (isNoteInline) return [row];
  return [
    row,
    <Box key="summary-gap-note" height={1} marginLeft={LEGEND_GLYPH_CELLS}>
      <Text color={paneInk().muted} wrap="truncate-end">
        {COMPACT_NOTE}
      </Text>
    </Box>,
  ];
}

function blankRow({ Box }: Ui, key: string): RenderElement {
  return <Box key={key} height={1} flexShrink={0} />;
}

function inlineNoteOf(note: string): string {
  return note === "" ? "" : `${TITLE_SEPARATOR}${note}`;
}

function sum(items: { tokens: number }[]): number {
  return items.reduce((total, item) => total + item.tokens, 0);
}

function share(tokens: number, window: number): string {
  return ((tokens / window) * PERCENT).toFixed(1);
}
