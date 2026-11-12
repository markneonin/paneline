import type {
  ContextMcpTool,
  ElementTable,
  RenderElement,
  SessionContextBreakdown,
} from "claude-code";

import { formatTokens, singleLine } from "./format";
import { mcpCommandName } from "./mcp-name";
import { header, labelButton, paneHeaderLook, plural } from "./pane-kit";
import { paneInk } from "./pane-ink";
import { SCOPE_GROUPS, scopeOf, serversOf } from "./servers";
import type { McpAction, McpScope, ScopeIndex, Server } from "./servers";
import { rankedUses } from "./use-counts";
import type { UseEntry } from "./use-counts";
import { clipEnd, displayWidth } from "./text-width";

type Ui = ElementTable;

export type McpView = {
  context: SessionContextBreakdown | null;
  full: SessionContextBreakdown | null;
  width: number;
  disabledServers: string[];
  scopes: ScopeIndex;
  queuedServers: string[];
  openServers: Set<string>;
  toggle: (server: string) => void;
  act: (action: McpAction, server: string) => void;
  toolUses: Record<string, number>;
  toolFailures: Record<string, number>;
  clearUses: () => void;
};

type Figure = { value: string; unit: string; isZero: boolean };

type Figures = { tools: Figure | null; tokens: Figure | null; uses: Figure };

type Card = {
  name: string;
  scope: McpScope;
  figures: Figures;
  failed: number;
  queued: boolean;
  isLive: boolean;
  actions: McpAction[];
  tools: UseEntry[];
};

type Group = { scope: McpScope; heading: string; cards: Card[] };

type Column = { valueCells: number; unitCells: number; cells: number };

type Layout = { tools: Column | null; tokens: Column | null; uses: Column };

const ACTIONS_INDENT_CELLS = 2;
const OPEN_GLYPH = "▾";
const FOLDED_GLYPH = "▸";
const CLEAR_LABEL = "clear usage stats";
const QUEUED_LABEL = "queued";
const STAT_GAP = 2;
const UNIT_GAP = 1;

export function mcpTab(ui: Ui, view: McpView): RenderElement {
  const { Box, Text } = ui;
  const { context } = view;
  if (context === null) {
    return (
      <Text color={paneInk().muted} wrap="truncate-end">
        no MCP data yet
      </Text>
    );
  }
  const groups = groupsOf(cardsOf(serversOf(context.mcpTools), view));
  const cards = groups.flatMap((group) => group.cards);
  if (cards.length === 0) {
    return (
      <Text color={paneInk().muted} wrap="truncate-end">
        no MCP servers
      </Text>
    );
  }
  const failedTotal = cards.reduce((sum, card) => sum + card.failed, 0);
  const layout = layoutOf(cards);
  return (
    <Box flexDirection="column" width={view.width}>
      {titleRow(ui, view)}
      <Text color={paneInk().muted} wrap="truncate-end">
        <Text color={paneInk().text}>{String(cards.length)}</Text>
        <Text color={paneInk().muted}>{` ${plural("server", cards.length)}`}</Text>
        {failedTotal > 0 && FAILED_SEPARATOR}
        {failedTotal > 0 && <Text color={paneInk().failed}>{failedLabel(failedTotal)}</Text>}
      </Text>
      <Box height={1} />
      {groups.flatMap((group, index) => [
        ...(index > 0 ? [<Box key={`${group.scope}-gap`} height={1} />] : []),
        header(ui, group.heading, paneHeaderLook(), view.width),
        ...group.cards.flatMap((card) =>
          cardRows(ui, card, {
            view,
            layout,
            isOpen: view.openServers.has(card.name),
          }),
        ),
      ])}
    </Box>
  );
}

function titleRow(ui: Ui, view: McpView): RenderElement {
  const { Box, Button, Text } = ui;
  const hasUses = Object.values(view.toolUses).some((uses) => uses > 0);
  return (
    <Box flexDirection="row" width={view.width} columnGap={1}>
      <Box flexGrow={1}>
        <Text weight="semibold" color={paneInk().text} wrap="truncate-end">
          Manage MCP servers
        </Text>
      </Box>
      {hasUses && (
        <Box flexShrink={0}>
          <Button key="clear-uses" label={CLEAR_LABEL} plain dimColor onPress={view.clearUses} />
        </Box>
      )}
    </Box>
  );
}

function groupsOf(cards: Card[]): Group[] {
  return SCOPE_GROUPS.map(({ scope, heading }) => ({
    scope,
    heading,
    cards: cards.filter((card) => card.scope === scope),
  })).filter((group) => group.cards.length > 0);
}

function cardsOf(live: Server[], view: McpView): Card[] {
  const fullServers = serversOf(view.full?.mcpTools ?? []);
  const named = live.map((server) => ({
    ...server,
    name: singleLine(mcpCommandName(server.name)),
    loadedTokens: fullServers.find((full) => full.name === server.name)?.loadedTokens,
  }));
  const liveNames = new Set(named.map((server) => server.name));
  const disabled = view.disabledServers.filter((name) => !liveNames.has(name));
  return [
    ...named.map((server): Card => {
      const ofServer = (view.context?.mcpTools ?? []).filter(
        (tool) => mcpCommandName(tool.serverName) === server.name,
      );
      const tools = toolRowsOf(ofServer, view.toolUses);
      const uses = tools.reduce((sum, tool) => sum + tool.uses, 0);
      const failed = ofServer.reduce((sum, tool) => sum + (view.toolFailures[tool.name] ?? 0), 0);
      return {
        name: server.name,
        scope: scopeOf(server.name, view.scopes),
        figures: {
          tools: countFigure(server.tools, "tool"),
          tokens:
            server.loadedTokens === undefined
              ? null
              : tokensFigure(server.loadedTokens, server.tools),
          uses: countFigure(uses, "use"),
        },
        failed,
        queued: false,
        isLive: true,
        actions: ["reconnect", "disable"],
        tools,
      };
    }),
    ...disabled.map((name) => disabledCard(name, view)),
  ].map((card) => (view.queuedServers.includes(card.name) ? queuedCard(card) : card));
}

function disabledCard(name: string, view: McpView): Card {
  return {
    name,
    scope: scopeOf(name, view.scopes),
    figures: {
      tools: null,
      tokens: null,
      uses: countFigure(usesOfServer(name, view.toolUses), "use"),
    },
    failed: usesOfServer(name, view.toolFailures),
    queued: false,
    isLive: false,
    actions: ["enable"],
    tools: [],
  };
}

function queuedCard(card: Card): Card {
  return {
    ...card,
    figures: { ...card.figures, tools: null, tokens: null },
    queued: true,
    actions: [],
  };
}

function countFigure(count: number, noun: string): Figure {
  return { value: String(count), unit: plural(noun, count), isZero: count === 0 };
}

function tokensFigure(tokens: number, tools: number): Figure {
  if (tokens === 0 && tools > 0) return { value: "", unit: "deferred", isZero: true };
  return { value: formatTokens(tokens), unit: "tokens", isZero: tokens === 0 };
}

function layoutOf(cards: Card[]): Layout {
  const toolFigures = cards.flatMap((card) => card.figures.tools ?? []);
  const tokenFigures = cards.flatMap((card) => card.figures.tokens ?? []);
  const hasQueued = cards.some((card) => card.queued);
  return {
    tools: toolFigures.length > 0 ? columnOf(toolFigures) : null,
    tokens: tokenFigures.length > 0 ? columnOf(tokenFigures) : null,
    uses: columnOf(
      cards.map((card) => card.figures.uses),
      hasQueued ? QUEUED_LABEL.length : 0,
    ),
  };
}

function columnOf(figures: Figure[], minCells = 0): Column {
  const valueCells = Math.max(0, ...figures.map((figure) => figure.value.length));
  const unitCells = Math.max(0, ...figures.map((figure) => figure.unit.length));
  return {
    valueCells,
    unitCells,
    cells: Math.max(minCells, valueCells + UNIT_GAP + unitCells),
  };
}

function statsCellsOf(layout: Layout): number {
  const columns = [layout.tools, layout.tokens, layout.uses].filter(
    (column): column is Column => column !== null,
  );
  return columns.reduce((sum, column) => sum + column.cells, STAT_GAP * (columns.length - 1));
}

function usesOfServer(serverName: string, toolUses: Record<string, number>): number {
  const prefix = `mcp__${serverName}__`;
  return Object.entries(toolUses)
    .filter(([tool]) => tool.startsWith(prefix))
    .reduce((sum, [, uses]) => sum + uses, 0);
}

function toolRowsOf(ofServer: ContextMcpTool[], toolUses: Record<string, number>): UseEntry[] {
  return rankedUses(
    Object.fromEntries(
      ofServer.map((tool) => [
        tool.name.replace(`mcp__${tool.serverName}__`, ""),
        toolUses[tool.name] ?? 0,
      ]),
    ),
  );
}

function shownFailed(card: Card): number {
  return card.queued ? 0 : card.failed;
}

const FAILED_SEPARATOR = " · ";
const MARK_CELLS = 1;
const ROW_GAPS = 3;

function failedLabel(failed: number): string {
  return `${failed} failed`;
}

function failedCells(failed: number): number {
  return failed > 0 ? FAILED_SEPARATOR.length + failedLabel(failed).length : 0;
}

type RowLook = { view: McpView; layout: Layout; isOpen: boolean };

function cardRows(ui: Ui, card: Card, { view, layout, isOpen }: RowLook): RenderElement[] {
  const { Box, Button, Text } = ui;
  const toggle = () => view.toggle(card.name);
  const toggleGlyph = isOpen ? OPEN_GLYPH : FOLDED_GLYPH;
  const failed = shownFailed(card);
  const nameCells = Math.max(
    1,
    view.width -
      displayWidth(toggleGlyph) -
      MARK_CELLS -
      statsCellsOf(layout) -
      ROW_GAPS -
      failedCells(failed),
  );
  const rows: RenderElement[] = [
    <Box key={`${card.name}-name`} flexDirection="row" width={view.width} height={1} columnGap={1}>
      <Box flexShrink={0}>
        <Button key={`${card.name}-toggle`} label={toggleGlyph} plain dimColor onPress={toggle} />
      </Box>
      <Box width={1} flexShrink={0}>
        <Text color={card.isLive ? paneInk().ok : paneInk().muted} wrap="truncate-end">
          {card.isLive ? "✔" : "○"}
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0} height={1} overflow="hidden">
        <Box flexDirection="row">
          {labelButton(ui, {
            key: card.name,
            label: clipEnd(card.name, nameCells),
            onPress: toggle,
          })}
          {failed > 0 && failedText(ui, failed)}
        </Box>
      </Box>
      {statsRow(ui, card, layout)}
    </Box>,
  ];
  if (!isOpen) return rows;
  if (card.actions.length > 0) {
    rows.push(
      <Box
        key={`${card.name}-actions`}
        flexDirection="row"
        columnGap={2}
        marginLeft={ACTIONS_INDENT_CELLS}
        height={1}
        overflow="hidden"
      >
        {card.actions.map((action) => (
          <Button
            key={`${card.name}-${action}`}
            label={action}
            plain
            dimColor
            onPress={() => view.act(action, card.name)}
          />
        ))}
      </Box>,
    );
  }
  return [...rows, ...toolRows(ui, card, view.width)];
}

function statsRow(ui: Ui, card: Card, layout: Layout): RenderElement {
  const { Box } = ui;
  return (
    <Box flexDirection="row" columnGap={STAT_GAP} flexShrink={0}>
      {layout.tools && figureCell(ui, card.figures.tools, layout.tools)}
      {layout.tokens && tokenCell(ui, card.figures.tokens, layout.tokens)}
      {usesCell(ui, card, layout.uses)}
    </Box>
  );
}

function figureCell(ui: Ui, figure: Figure | null, column: Column): RenderElement {
  const { Box } = ui;
  return (
    <Box width={column.cells} flexShrink={0} justifyContent="flex-end">
      {figure === null ? null : figureRow(ui, figure, column.valueCells, column.unitCells)}
    </Box>
  );
}

function tokenCell(ui: Ui, figure: Figure | null, column: Column): RenderElement {
  const { Box } = ui;
  return (
    <Box width={column.cells} flexShrink={0} justifyContent="flex-end">
      {figure === null ? null : figureRow(ui, figure, column.valueCells, figure.unit.length)}
    </Box>
  );
}

function usesCell(ui: Ui, card: Card, column: Column): RenderElement {
  const { Box, Text } = ui;
  return (
    <Box width={column.cells} flexShrink={0} justifyContent="flex-end">
      {card.queued ? (
        <Text color={paneInk().muted} wrap="truncate-end">
          {QUEUED_LABEL}
        </Text>
      ) : (
        figureRow(ui, card.figures.uses, column.valueCells, column.unitCells)
      )}
    </Box>
  );
}

function figureRow(ui: Ui, figure: Figure, valueCells: number, unitCells: number): RenderElement {
  const { Box, Text } = ui;
  return (
    <Box flexDirection="row" columnGap={UNIT_GAP} flexShrink={0}>
      <Box width={valueCells} flexShrink={0} justifyContent="flex-end">
        <Text
          color={figure.isZero ? paneInk().muted : paneInk().text}
          weight={figure.isZero ? undefined : "semibold"}
          wrap="truncate-end"
        >
          {figure.value}
        </Text>
      </Box>
      <Box width={unitCells} flexShrink={0}>
        <Text color={paneInk().muted} wrap="truncate-end">
          {figure.unit}
        </Text>
      </Box>
    </Box>
  );
}

function failedText({ Text }: Ui, failed: number): RenderElement {
  return (
    <Text color={paneInk().muted} wrap="truncate-end">
      {FAILED_SEPARATOR}
      <Text color={paneInk().failed}>{failedLabel(failed)}</Text>
    </Text>
  );
}

function toolRows(ui: Ui, card: Card, width: number): RenderElement[] {
  const { Box, Text } = ui;
  const usesCells = Math.max(
    0,
    ...card.tools.map((tool) => `${tool.uses} ${plural("use", tool.uses)}`.length),
  );
  return card.tools.map((tool) => (
    <Box
      key={`${card.name}-tool-${tool.name}`}
      flexDirection="row"
      width={width - ACTIONS_INDENT_CELLS}
      height={1}
      marginLeft={ACTIONS_INDENT_CELLS}
      columnGap={1}
    >
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text color={tool.uses > 0 ? paneInk().text : paneInk().muted} wrap="truncate-end">
          {tool.name}
        </Text>
      </Box>
      <Box width={usesCells} flexShrink={0} justifyContent="flex-end">
        <Text wrap="truncate-end">
          <Text
            color={tool.uses > 0 ? paneInk().text : paneInk().muted}
            weight={tool.uses > 0 ? "semibold" : undefined}
          >
            {String(tool.uses)}
          </Text>
          <Text color={paneInk().muted}>{` ${plural("use", tool.uses)}`}</Text>
        </Text>
      </Box>
    </Box>
  ));
}
