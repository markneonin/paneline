import type {
  ContextCategory,
  ContextCategoryKind,
  ContextGridSquare,
  ElementTable,
  RenderElement,
  SessionContextBreakdown,
} from "claude-code";

import type { SpendState } from "../types";
import { formatTokens } from "./format";
import { plural } from "./pane-kit";
import { paneInk } from "./pane-ink";
import { TAB_BAR_ROWS } from "./tab-bar";

type Ui = ElementTable;

export type ContextView = {
  context: SessionContextBreakdown | null;
  spend: SpendState;
  width: number;
  height: number;
};

type Section = { title: string; hint: string; count: number; unit: string; tokens: number };

const SIDE_BY_SIDE_WIDTH = 60;
const GRID_GAP = 2;
const GRID_WIDTH = 19;
const FULL_SQUARE_FROM = 0.7;
const PERCENT = 100;

const GLYPH_BY_KIND: Record<ContextCategoryKind, string> = {
  used: "⛁",
  deferred: "⛁",
  free: "⛶",
  buffer: "⛝",
};
const TAIL_KINDS: ContextCategoryKind[] = ["free", "buffer"];

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
  const summary = [
    ...headerLines(ui, context, view.spend),
    blankRow(ui, "summary-gap"),
    ...legendLines(ui, context),
  ];
  const sections = sectionBlocks(ui, context);
  const isSideBySide = view.width >= SIDE_BY_SIDE_WIDTH;
  return (
    <Box flexDirection="column" height={view.height - TAB_BAR_ROWS} overflow="hidden">
      {isSideBySide ? (
        <Box flexDirection="row" columnGap={GRID_GAP}>
          {grid}
          <Box flexDirection="column" width={view.width - GRID_WIDTH - GRID_GAP}>
            {summary}
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          {grid}
          {blankRow(ui, "grid-gap")}
          {summary}
        </Box>
      )}
      {sections.flatMap((section, i) => [blankRow(ui, `gap-${i}`), ...section])}
    </Box>
  );
}

function gridBlock(ui: Ui, context: SessionContextBreakdown): RenderElement {
  const { Box, Text } = ui;
  const kindByName = new Map(context.categories.map((category) => [category.name, category.kind]));
  const colors = categoryColorsOf(context);
  return (
    <Box flexDirection="column" width={GRID_WIDTH} flexShrink={0}>
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
  return ` · ~${turns} ${plural("turn", turns)} to auto-compact`;
}

function headerLines(
  { Text }: Ui,
  context: SessionContextBreakdown,
  spend: SpendState,
): RenderElement[] {
  const turns = turnsToCompact(context, spend);
  return [
    <Text color={paneInk().text} key="model" weight="semibold" wrap="truncate-end">
      {context.model}
    </Text>,
    <Text key="usage" wrap="truncate-end">
      <Text color={paneInk().text} wrap="truncate-end">
        {`${formatTokens(context.totalTokens)}/${formatTokens(context.rawMaxTokens)} tokens (${context.percentage}%)`}
      </Text>
      {turns === null ? null : (
        <Text color={paneInk().muted} wrap="truncate-end">
          {turns}
        </Text>
      )}
    </Text>,
  ];
}

function legendLines({ Text }: Ui, context: SessionContextBreakdown): RenderElement[] {
  const colors = categoryColorsOf(context);
  const shown = context.categories.filter(
    (category) => category.kind !== "deferred" && category.tokens > 0,
  );
  const byTokens = (a: ContextCategory, b: ContextCategory): number =>
    tail(a) - tail(b) || b.tokens - a.tokens;
  const rows = [...shown].sort(byTokens).map((category) => (
    <Text key={category.name} wrap="truncate-end">
      <Text
        color={colors.get(category.name)}
        wrap="truncate-end"
      >{`${GLYPH_BY_KIND[category.kind]} `}</Text>
      <Text color={paneInk().text} wrap="truncate-end">{`${category.name}: `}</Text>
      <Text color={paneInk().muted} wrap="truncate-end">
        {`${formatTokens(category.tokens)}${category.kind === "free" ? "" : " tokens"} (${share(category.tokens, context.rawMaxTokens)}%)`}
      </Text>
    </Text>
  ));
  const deferred = context.categories
    .filter((category) => category.kind === "deferred")
    .reduce((sum, category) => sum + category.tokens, 0);
  if (deferred === 0) return rows;
  return [
    ...rows,
    <Text key="deferred" color={paneInk().muted} wrap="truncate-end">
      {`${formatTokens(deferred)} tokens deferred, loaded on demand`}
    </Text>,
  ];
}

function tail(category: ContextCategory): number {
  return TAIL_KINDS.indexOf(category.kind) + 1;
}

function sectionBlocks({ Text }: Ui, context: SessionContextBreakdown): RenderElement[][] {
  const sections: Section[] = [
    {
      title: "MCP tools",
      hint: "/mcp",
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
      hint: "/skills",
      count: context.skills?.totalSkills ?? 0,
      unit: "skill",
      tokens: context.skills?.tokens ?? 0,
    },
  ];
  return sections
    .filter((section) => section.count > 0)
    .map((section) => [
      <Text key={`${section.title}-title`} wrap="truncate-end">
        <Text weight="semibold" color={paneInk().text} wrap="truncate-end">
          {section.title}
        </Text>
        <Text color={paneInk().muted} wrap="truncate-end">{` · ${section.hint}`}</Text>
      </Text>,
      <Text key={`${section.title}-count`} color={paneInk().muted} wrap="truncate-end">
        {`└ ${section.count} ${plural(section.unit, section.count)} · ${formatTokens(section.tokens)} tokens`}
      </Text>,
    ]);
}

function blankRow({ Box }: Ui, key: string): RenderElement {
  return <Box key={key} height={1} />;
}

function sum(items: { tokens: number }[]): number {
  return items.reduce((total, item) => total + item.tokens, 0);
}

function share(tokens: number, window: number): string {
  return ((tokens / window) * PERCENT).toFixed(1);
}
