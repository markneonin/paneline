import type { ElementTable, RenderElement } from "claude-code";

import type { AgentNode, AgentTree } from "../types";
import type { TreeRow } from "./agents-model";
import { hasFinished, visibleRows } from "./agents-model";
import { clearButton } from "./clear-kit";
import { formatDuration, formatTokens, shortModel } from "./format";
import { bar, gapRow, header, paneRow, paneHeaderLook, statusDot } from "./pane-kit";
import { paneInk } from "./pane-ink";
import { TAB_BAR_ROWS } from "./tab-bar";
import { guideBetween, guideUnder, treeGlyphs } from "./tree-glyphs";

type Ui = ElementTable;

export type AgentsView = {
  agents: AgentTree;
  model: string;
  sessionUsd: number | null;
  now: number;
  width: number;
  height: number;
  offset: number;
  clear: () => void;
};

type Shown = { row: TreeRow; prefix: string; spacer: string; continuation: string };

type Spender = { node: AgentNode; tokens: number };

type Plan = { rows: TreeRow[]; hiddenDone: number; spenders: Spender[] };

const SPEND_LIMIT = 6;
const SPEND_BAR_CELLS = 6;
const MAIN_ROWS = 1;
const RUNNING_CARD_ROWS = 3;
const FINISHED_CARD_ROWS = 2;
const SPACER_ROWS = 1;
const BRANCH_ROWS = 1;
const HIDDEN_DONE_ROWS = 1;
const SPEND_HEADING_ROWS = 2;
const DETAILS_INDENT = "  ";
const OVERSCAN_ROWS = 6;

export function agentsTab(ui: Ui, view: AgentsView): RenderElement {
  const { Box, Text } = ui;
  const plan = planOf(view);
  return (
    <Box flexDirection="column">
      {mainRow(ui, view)}
      {plan.rows.length === 0 ? (
        <Text color={paneInk().muted} wrap="truncate-end">
          no subagents yet
        </Text>
      ) : null}
      {cardsInWindow(ui, shownRows(plan.rows), view)}
      {plan.hiddenDone > 0 ? (
        <Text color={paneInk().muted} wrap="truncate-end">
          {`… ${plan.hiddenDone} more done`}
        </Text>
      ) : null}
      {plan.spenders.length > 0 ? gapRow(ui, "gap-spend", " ", paneInk().rule) : null}
      {spendSection(ui, plan.spenders, view)}
    </Box>
  );
}

function planOf(view: AgentsView): Plan {
  const spenders = rankedSpenders(view.agents).slice(0, SPEND_LIMIT);
  const spendRows = spenders.length > 0 ? SPEND_HEADING_ROWS + spenders.length : 0;
  const budget = view.height - TAB_BAR_ROWS - MAIN_ROWS - spendRows;
  const active = visibleRows(view.agents, 0);
  const total = visibleRows(view.agents, Infinity);
  const activeCost = active.rows.reduce((sum, { node }) => sum + cardRows(node), 0);
  const activeIds = new Set(active.rows.map(({ node }) => node.id));
  const finished = total.rows.filter(({ node }) => !activeIds.has(node.id));
  const finishedCost = Math.max(0, ...finished.map(({ node }) => cardRows(node)));
  const finishedTotal = finished.length;
  const fitsAll = Math.floor((budget - activeCost) / finishedCost) >= finishedTotal;
  const finishedFit = fitsAll
    ? finishedTotal
    : Math.floor((budget - activeCost - HIDDEN_DONE_ROWS) / finishedCost);
  const listed = fitsAll ? total : visibleRows(view.agents, Math.max(0, finishedFit));
  return { rows: listed.rows, hiddenDone: listed.hiddenDone, spenders };
}

function cardRows(node: AgentNode): number {
  const base = node.status === "running" ? RUNNING_CARD_ROWS : FINISHED_CARD_ROWS;
  return base + (node.branch === undefined ? 0 : BRANCH_ROWS) + SPACER_ROWS;
}

function rankedSpenders(agents: AgentTree): Spender[] {
  return Object.values(agents)
    .map((node) => ({ node, tokens: node.tokensIn + node.tokensOut }))
    .filter((spender) => spender.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);
}

function shownRows(rows: TreeRow[]): Shown[] {
  const glyphs = treeGlyphs(rows.map((row) => ({ depth: row.depth + 1, isLast: row.isLast })));
  return rows.map((row, i) => {
    const glyph = glyphs[i] ?? "";
    const hasChildren = (rows[i + 1]?.depth ?? 0) > row.depth;
    return {
      row,
      prefix: `${glyph} `,
      spacer: guideBetween(glyph),
      continuation: `${guideUnder(glyph, row.isLast)}${hasChildren ? "│" : " "}${DETAILS_INDENT}`,
    };
  });
}

function cardsInWindow(ui: Ui, shown: Shown[], view: AgentsView): RenderElement[] {
  const { Box } = ui;
  const top = view.offset - OVERSCAN_ROWS;
  const bottom = view.offset + view.height + OVERSCAN_ROWS;
  let begin = TAB_BAR_ROWS + MAIN_ROWS;
  return shown.map((card) => {
    const rows = cardRows(card.row.node);
    const start = begin;
    begin += rows;
    const inWindow = start < bottom && start + rows > top;
    return inWindow ? (
      agentCard(ui, card, view)
    ) : (
      <Box key={`${card.row.node.id}-spacer`} height={rows} />
    );
  });
}

function mainRow(ui: Ui, view: AgentsView): RenderElement {
  const { Box, Text } = ui;
  return (
    <Box flexDirection="row" width={view.width} height={1} columnGap={1}>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="truncate-end">
          <Text color={paneInk().text} weight="semibold" wrap="truncate-end">
            main
          </Text>
          <Text color={paneInk().muted} wrap="truncate-end">
            {` · ${shortModel(view.model)}`}
          </Text>
        </Text>
      </Box>
      {view.sessionUsd === null ? null : (
        <Box flexShrink={0}>
          <Text color={paneInk().muted} wrap="truncate-end">
            {`$${view.sessionUsd.toFixed(2)}`}
          </Text>
        </Box>
      )}
      {hasFinished(view.agents) ? (
        <Box flexShrink={0} marginLeft={1}>
          {clearButton(ui, view.clear)}
        </Box>
      ) : null}
    </Box>
  );
}

function agentCard(ui: Ui, shown: Shown, view: AgentsView): RenderElement {
  const { Box } = ui;
  const { node } = shown.row;
  return (
    <Box key={node.id} flexDirection="column">
      {gapRow(ui, `gap-${node.id}`, shown.spacer, paneInk().rule)}
      {titleRow(ui, shown, view)}
      {detailLines(node, view.now).map((line, i) =>
        paneRow(ui, {
          key: `${node.id}-${i}`,
          prefix: shown.continuation,
          middle: { text: line, color: paneInk().muted },
          middleWrap: "truncate-end",
          width: view.width,
        }),
      )}
    </Box>
  );
}

function titleRow(ui: Ui, shown: Shown, view: AgentsView): RenderElement {
  const { node } = shown.row;
  return paneRow(ui, {
    prefix: shown.prefix,
    dot: statusDot(node.status),
    middle: { text: titleOf(node), color: paneInk().text },
    middleWrap: "truncate-end",
    width: view.width,
  });
}

function spendSection(ui: Ui, spenders: Spender[], view: AgentsView): RenderElement | null {
  const { Box } = ui;
  const largest = spenders[0]?.tokens ?? 0;
  if (largest === 0) return null;
  return (
    <Box flexDirection="column">
      {header(ui, "Spend", paneHeaderLook(), view.width)}
      {spenders.map(({ node, tokens }) => spendRow(ui, node, tokens, largest, view))}
    </Box>
  );
}

function spendRow(
  ui: Ui,
  node: AgentNode,
  tokens: number,
  largest: number,
  view: AgentsView,
): RenderElement {
  const { Box, Text } = ui;
  return (
    <Box key={node.id} flexDirection="row" width={view.width} height={1} columnGap={1}>
      {bar(ui, tokens, largest, SPEND_BAR_CELLS, paneInk().tool)}
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text color={paneInk().text} wrap="truncate-end">
          {titleOf(node)}
        </Text>
      </Box>
      <Box flexShrink={0}>
        <Text color={paneInk().muted} wrap="truncate-end">
          {formatTokens(tokens)}
        </Text>
      </Box>
    </Box>
  );
}

function titleOf(node: AgentNode): string {
  return node.description || node.name || node.type;
}

function detailLines(node: AgentNode, now: number): string[] {
  const lines = timingLines(node, now);
  return node.branch === undefined
    ? lines
    : [...lines, joined([`⎇ ${node.branch}`, node.worktree ?? ""])];
}

function timingLines(node: AgentNode, now: number): string[] {
  const elapsed = formatDuration(Math.max(0, (node.endedAt ?? now) - node.startedAt));
  if (node.status !== "running") {
    const tokens = node.tokensIn + node.tokensOut;
    return [joined([node.type, elapsed, tokens > 0 ? `${formatTokens(tokens)} tokens` : ""])];
  }
  const tool = node.running[0];
  return [
    joined([node.type, shortModel(node.model), node.effort ?? ""]),
    joined([
      elapsed,
      node.ctxTokens > 0 ? `ctx ${formatTokens(node.ctxTokens)}` : "",
      tool ? `${tool.tool}: ${tool.target}`.replace(/: $/, "") : "",
    ]),
  ];
}

function joined(parts: string[]): string {
  return parts.filter((part) => part !== "").join(" · ");
}
