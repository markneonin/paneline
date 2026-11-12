import type { ElementTable, RenderElement } from "claude-code";

import type { AgentNode, AgentTree } from "../types";
import type { OrderedRow, Receipt, TreeRow } from "./agents-model";
import { cutDone, hasFinished, orderedRows, receiptOf, tallyOf } from "./agents-model";
import { clampCells } from "./activity-draw";
import { clearButton } from "./clear-kit";
import { aboutDollars, formatDuration, formatTokens, shortModel } from "./format";
import { bar, barText, gapRow, header, paneHeaderLook, statusDot } from "./pane-kit";
import type { Part } from "./pane-kit";
import { paneInk } from "./pane-ink";
import { roundedCents, TOKENS_BILLED_LABEL } from "./spend-model";
import type { AgentShare, SplitRow } from "./spend-model";
import { TAB_BAR_ROWS } from "./tab-bar";
import { fitPair } from "./paths";
import { clipEnd, clipEndAtWord, clipStart, displayWidth } from "./text-width";
import { isPathTool } from "./tools";
import { guideUnder, treeGlyphs } from "./tree-glyphs";

type Ui = ElementTable;

export type AgentsView = {
  agents: AgentTree;
  model: string;
  main: SplitRow | undefined;
  mainTokens: number;
  isMainRunning: boolean;
  split: Record<string, AgentShare>;
  now: number;
  width: number;
  height: number;
  offset: number;
  clear: () => void;
  openAgent: (id: string) => void;
};

type Shown = { row: TreeRow; prefix: string; continuation: string };

type Columns = {
  nameCells: number;
  suffixCells: number;
  percents: Record<string, number>;
  duration: number;
  tokens: number;
  cost: number;
  totalTokens: number;
  isWide: boolean;
};

type RightColumns = Pick<Columns, "duration" | "tokens" | "cost" | "isWide">;

type Plan = { rows: TreeRow[]; hiddenDone: number; receipt: Receipt | null };

export type Figures = { duration: string; tokens: string; cost: string };

const CENTS_PER_USD = 100;
const HALF_CENT_USD = 0.005;
const PERCENT = 100;
const WIDE_WIDTH = 100;
const BAR_CELLS = 10;
const HEADER_ROWS = 1;
const LABEL_ROWS = 1;
const MAIN_ROWS = 1;
const FOOTER_ROWS = 2;
const RECEIPT_ROWS = 3;
const HIDDEN_DONE_ROWS = 1;
const DETAILS_INDENT = "  ";
export const OVERSCAN_ROWS = 6;
const MIN_NAME_CELLS = 12;
const NAME_GAP = "  ";
const STATUS_COLUMN_CELLS = " waiting".length;
const DOT_CELLS = 2;
const FOLDED_GLYPH = "▸";
const MAIN_WORKING_DOT = "●";
const MAIN_IDLE_DOT = "○";
const MAIN_NAME = "main";
const HINT = "click an agent for prompt, tools and result";
const NOTHING_YET = "no subagents yet";
const CLEAR_LABEL_CELLS = "clear".length;
const TOOL_COLON_CELLS = 2;
const SUMMARY_SEPARATOR = " · ";

export function agentsTab(ui: Ui, view: AgentsView): RenderElement {
  const { Box, Text } = ui;
  const hasTokens =
    view.mainTokens > 0 || Object.keys(view.agents).some((id) => (view.split[id]?.tokens ?? 0) > 0);
  const plan = planOf(view, hasTokens);
  const shown = shownRows(plan.rows);
  const columns = columnsOf(view, shown);
  const firstRow = TAB_BAR_ROWS + HEADER_ROWS + (hasTokens ? LABEL_ROWS : 0) + MAIN_ROWS;
  const hasRows = shown.length > 0;
  const isGroupLast =
    plan.receipt !== null && shown.findLastIndex(isMemberOf(plan.receipt)) === shown.length - 1;
  return (
    <Box flexDirection="column">
      {sectionHeader(ui, view)}
      {hasTokens ? (
        <Text color={paneInk().muted} wrap="truncate-end">
          {TOKENS_BILLED_LABEL}
        </Text>
      ) : null}
      {mainRow(ui, view, columns)}
      {hasRows ? null : gapRow(ui, "gap-nothing", " ", paneInk().rule)}
      {hasRows ? null : (
        <Text color={paneInk().muted} wrap="truncate-end">
          {NOTHING_YET}
        </Text>
      )}
      {cardsInWindow(ui, shown, plan.receipt, view, columns, firstRow)}
      {plan.hiddenDone > 0 ? (
        <Text color={paneInk().muted} wrap="truncate-end">
          {`… ${plan.hiddenDone} more done`}
        </Text>
      ) : null}
      {hasRows && !(isGroupLast && plan.hiddenDone === 0)
        ? gapRow(ui, "gap-hint", " ", paneInk().rule)
        : null}
      {hasRows ? (
        <Text color={paneInk().muted} wrap="truncate-end">
          {HINT}
        </Text>
      ) : null}
    </Box>
  );
}

function sectionHeader(ui: Ui, view: AgentsView): RenderElement {
  const { Box, Text } = ui;
  const canClear = hasFinished(view.agents);
  const summary = [...summaryParts(view), ...(canClear ? [word(SUMMARY_SEPARATOR)] : [])];
  const clearCells = canClear ? CLEAR_LABEL_CELLS + 1 : 0;
  const headerCells = view.width - partsWidth(summary) - clearCells - 2;
  return (
    <Box flexDirection="row" width={view.width} height={1}>
      <Box flexShrink={0}>{header(ui, "Agents", paneHeaderLook(), headerCells)}</Box>
      <Box flexShrink={0} marginLeft={1}>
        <Text wrap="truncate-end">
          {summary.map((part, i) => (
            <Text
              key={`${i}`}
              color={part.color}
              weight={part.bold ? "semibold" : undefined}
              wrap="truncate-end"
            >
              {part.text}
            </Text>
          ))}
        </Text>
      </Box>
      {canClear ? <Box flexShrink={0}>{clearButton(ui, view.clear)}</Box> : null}
      <Box flexShrink={0} width={1} />
    </Box>
  );
}

function summaryParts(view: AgentsView): Part[] {
  const { done, running } = tallyOf(view.agents);
  const cents = totalCents(view);
  const counts = [
    ...(done > 0 ? [[figure(String(done)), word(" done")]] : []),
    ...(running > 0 ? [[figure(String(running)), word(" running")]] : []),
    ...(cents === undefined ? [] : [[{ ...figure(costTextOf(cents)), bold: true }]]),
  ];
  return joined(counts);
}

function totalCents(view: AgentsView): number | undefined {
  const known = [
    view.main?.cents ?? undefined,
    ...Object.keys(view.agents).map((id) => view.split[id]?.cents),
  ].filter((cents) => cents !== undefined);
  return known.length === 0 ? undefined : known.reduce((sum, cents) => sum + cents, 0);
}

function planOf(view: AgentsView, hasTokens: boolean): Plan {
  const hasReceipt = receiptOf(view.agents, view.split) !== null;
  const budget =
    view.height -
    TAB_BAR_ROWS -
    HEADER_ROWS -
    (hasTokens ? LABEL_ROWS : 0) -
    MAIN_ROWS -
    FOOTER_ROWS -
    (hasReceipt ? RECEIPT_ROWS : 0);
  const ordered = orderedRows(view.agents, view.split);
  const rowsOf = ({ node }: OrderedRow): number => cardRows(node, view);
  const active = ordered.filter((row) => row.active);
  const finished = ordered.filter((row) => !row.active);
  const activeCost = active.reduce((sum, row) => sum + rowsOf(row), 0);
  const finishedCost = Math.max(0, ...finished.map(rowsOf));
  const finishedTotal = finished.length;
  const fitsAll = Math.floor((budget - activeCost) / finishedCost) >= finishedTotal;
  const finishedFit = fitsAll
    ? finishedTotal
    : Math.floor((budget - activeCost - HIDDEN_DONE_ROWS) / finishedCost);
  const listed = cutDone(ordered, fitsAll ? Infinity : Math.max(0, finishedFit));
  const drawn = Object.fromEntries(listed.rows.map(({ node }) => [node.id, node]));
  return { ...listed, receipt: receiptOf(drawn, view.split) };
}

function cardRows(node: AgentNode, view: AgentsView): number {
  const hasShareLine = view.width < WIDE_WIDTH && (view.split[node.id]?.tokens ?? 0) > 0;
  return 1 + (hasShareLine ? 1 : 0) + (hasRunningLine(node) ? 1 : 0) + (node.branch ? 1 : 0);
}

function hasRunningLine(node: AgentNode): boolean {
  return node.status === "running" && (node.ctxTokens > 0 || node.running.length > 0);
}

function columnsOf(view: AgentsView, shown: Shown[]): Columns {
  const nodes = shown.map(({ row }) => row.node);
  const figures = nodes.map((node) => figuresOf(node, view.split[node.id], view.now));
  const widest = (texts: string[]): number => Math.max(0, ...texts.map(displayWidth));
  const main = mainFigures(view);
  const totalTokens = Object.keys(view.agents).reduce(
    (sum, id) => sum + (view.split[id]?.tokens ?? 0),
    0,
  );
  const sized = {
    duration: widest(figures.map((one) => one.duration)),
    tokens: widest([main.tokens, ...figures.map((one) => one.tokens)]),
    cost: widest([main.cost, ...figures.map((one) => one.cost)]),
    totalTokens,
    percents: percentsOf(view, totalTokens),
    isWide: view.width >= WIDE_WIDTH,
  };
  return { ...sized, ...nameColumnOf(view, shown, sized) };
}

function percentsOf(view: AgentsView, totalTokens: number): Record<string, number> {
  if (totalTokens === 0) return {};
  const ids = Object.keys(view.agents);
  const shares = ids.map((id) => (view.split[id]?.tokens ?? 0) / totalTokens);
  const percents = roundedCents(shares, PERCENT);
  return Object.fromEntries(ids.map((id, i) => [id, percents[i] ?? 0]));
}

function nameColumnOf(
  view: AgentsView,
  shown: Shown[],
  columns: RightColumns,
): Pick<Columns, "nameCells" | "suffixCells"> {
  const nodes = shown.map(({ row }) => row.node);
  const prefixCells = Math.max(0, ...shown.map(({ prefix }) => displayWidth(prefix)));
  const region = Math.max(
    1,
    view.width - prefixCells - DOT_CELLS - STATUS_COLUMN_CELLS - rightCells(columns),
  );
  const widestName = Math.max(0, ...nodes.map((node) => displayWidth(titleOf(node))));
  const fits = (suffix: string): boolean =>
    region - displayWidth(suffix) >= Math.min(widestName, MIN_NAME_CELLS);
  const chosen = nodes.map((node) => {
    const suffixes = suffixesOf(node);
    return suffixes.find(fits) ?? suffixes.at(-1) ?? "";
  });
  const suffixCells = Math.max(0, ...chosen.map(displayWidth));
  return { nameCells: clampCells(widestName, region - suffixCells), suffixCells };
}

function mainFigures(view: AgentsView): { tokens: string; cost: string } {
  return {
    tokens: view.mainTokens > 0 ? formatTokens(view.mainTokens) : "",
    cost: costTextOf(view.main?.cents ?? undefined),
  };
}

function leadCells(columns: RightColumns): number {
  const duration = columns.duration > 0 ? 1 + columns.duration : 0;
  return duration + (columns.isWide ? 1 + BAR_CELLS : 0);
}

function figureCells(columns: RightColumns): number {
  return (columns.tokens > 0 ? 1 + columns.tokens : 0) + (columns.cost > 0 ? 1 + columns.cost : 0);
}

function rightCells(columns: RightColumns): number {
  return leadCells(columns) + figureCells(columns) + 1 + FOLDED_GLYPH.length;
}

export function figuresOf(node: AgentNode, share: AgentShare | undefined, now: number): Figures {
  const tokens = share?.tokens ?? 0;
  return {
    duration: formatDuration(Math.max(0, (node.endedAt ?? now) - node.startedAt)),
    tokens: tokens > 0 ? formatTokens(tokens) : "",
    cost: shownCostOf(share),
  };
}

function shownRows(rows: TreeRow[]): Shown[] {
  const glyphs = treeGlyphs(rows);
  return rows.map((row, i) => {
    const glyph = glyphs[i] ?? "";
    const hasChildren = (rows[i + 1]?.depth ?? 0) > row.depth;
    return {
      row,
      prefix: glyph === "" ? "" : `${glyph} `,
      continuation: `${guideUnder(glyph, row.isLast)}${hasChildren ? "│" : " "}${DETAILS_INDENT}`,
    };
  });
}

function cardsInWindow(
  ui: Ui,
  shown: Shown[],
  receipt: Receipt | null,
  view: AgentsView,
  columns: Columns,
  firstRow: number,
): RenderElement[] {
  const { Box } = ui;
  const top = view.offset - OVERSCAN_ROWS;
  const bottom = view.offset + view.height + OVERSCAN_ROWS;
  const receiptBefore = receipt === null ? -1 : shown.findIndex(isMemberOf(receipt));
  const receiptAfter = receipt === null ? -1 : shown.findLastIndex(isMemberOf(receipt));
  let begin = firstRow;
  return shown.flatMap((card, index) => {
    const groupLine =
      index === receiptBefore && receipt !== null
        ? [
            gapRow(ui, "receipt-gap-top", " ", paneInk().rule),
            receiptRow(ui, receipt, card, view.width),
          ]
        : [];
    begin += groupLine.length;
    const rows = cardRows(card.row.node, view);
    const start = begin;
    begin += rows;
    const inWindow = start < bottom && start + rows > top;
    const drawn = inWindow ? (
      agentCard(ui, card, view, columns)
    ) : (
      <Box key={`${card.row.node.id}-spacer`} height={rows} />
    );
    if (index !== receiptAfter) return [...groupLine, drawn];
    begin += 1;
    return [...groupLine, drawn, gapRow(ui, "receipt-gap", " ", paneInk().rule)];
  });
}

function isMemberOf(receipt: Receipt): (card: Shown) => boolean {
  return ({ row }) => receipt.memberIds.includes(row.node.id);
}

function mainRow(ui: Ui, view: AgentsView, columns: Columns): RenderElement {
  const { Box, Text } = ui;
  const ink = paneInk();
  const { tokens, cost } = mainFigures(view);
  const model = shortModel(view.model);
  const state = view.isMainRunning ? "working" : "idle";
  const detail = ` · ${[model, state].filter((part) => part !== "").join(" · ")}`;
  const dot = view.isMainRunning ? MAIN_WORKING_DOT : MAIN_IDLE_DOT;
  const room = Math.max(0, view.width - DOT_CELLS - MAIN_NAME.length - rightCells(columns));
  const shownDetail = clipEnd(detail, room);
  const pad = " ".repeat(room - displayWidth(shownDetail) + leadCells(columns));
  return (
    <Box key="main" flexDirection="row" width={view.width} height={1}>
      <Text wrap="truncate-end">
        <Text color={view.isMainRunning ? ink.ok : ink.muted} wrap="truncate-end">
          {`${dot} `}
        </Text>
        <Text color={ink.text} weight="semibold" wrap="truncate-end">
          {MAIN_NAME}
        </Text>
        <Text color={ink.muted} wrap="truncate-end">
          {`${shownDetail}${pad}`}
        </Text>
        <Text color={ink.muted} wrap="truncate-end">
          {columns.tokens > 0 ? ` ${tokens.padStart(columns.tokens)}` : ""}
        </Text>
        <Text color={ink.text} wrap="truncate-end">
          {columns.cost > 0 ? ` ${cost.padStart(columns.cost)}` : ""}
        </Text>
      </Text>
    </Box>
  );
}

function receiptRow(ui: Ui, receipt: Receipt, first: Shown, width: number): RenderElement {
  const line = joined([
    [word("batch")],
    [figure(String(receipt.count)), word(" agents")],
    [figure(formatDuration(receipt.wallMs))],
    [figure(formatTokens(receipt.tokens)), word(" tokens")],
    receipt.cents === undefined ? [] : [figure(costTextOf(receipt.cents))],
  ]);
  return partsRow(ui, "receipt", " ".repeat(displayWidth(first.prefix)), line, width);
}

function partsRow(
  { Box, Text }: Ui,
  key: string,
  prefix: string,
  parts: Part[],
  width: number,
): RenderElement {
  return (
    <Box key={key} flexDirection="row" width={width} height={1}>
      <Text wrap="truncate-end">
        <Text color={paneInk().rule} wrap="truncate-end">
          {prefix}
        </Text>
        {parts.map((part, i) => (
          <Text key={`${i}`} color={part.color} wrap="truncate-end">
            {part.text}
          </Text>
        ))}
      </Text>
    </Box>
  );
}

function figure(text: string): Part {
  return { text, color: paneInk().text };
}

function word(text: string): Part {
  return { text, color: paneInk().muted };
}

function agentCard(ui: Ui, shown: Shown, view: AgentsView, columns: Columns): RenderElement {
  const { Box } = ui;
  const { node } = shown.row;
  const share = view.split[node.id];
  const cells = view.width - displayWidth(shown.continuation);
  const lines = [
    ...shareLine(ui, node, share, shown, view, columns),
    ...detailLines(node, cells).map((line, i) =>
      partsRow(ui, `${node.id}-${i}`, shown.continuation, line, view.width),
    ),
  ];
  return (
    <Box key={node.id} flexDirection="column">
      {titleRow(ui, shown, view, columns)}
      {lines}
    </Box>
  );
}

function shareLine(
  ui: Ui,
  node: AgentNode,
  share: AgentShare | undefined,
  shown: Shown,
  view: AgentsView,
  columns: Columns,
): RenderElement[] {
  const { Box, Text } = ui;
  const tokens = share?.tokens ?? 0;
  if (columns.isWide || tokens === 0) return [];
  return [
    <Box key={`${node.id}-share`} flexDirection="row" width={view.width} height={1}>
      <Text color={paneInk().rule} wrap="truncate-end">
        {shown.continuation}
      </Text>
      {bar(ui, tokens, columns.totalTokens, BAR_CELLS, paneInk().tool)}
      <Text color={paneInk().muted} wrap="truncate-end">
        {` ${columns.percents[node.id] ?? 0}% of agent tokens`}
      </Text>
    </Box>,
  ];
}

function titleRow(ui: Ui, shown: Shown, view: AgentsView, columns: Columns): RenderElement {
  const { Box, Button, Text } = ui;
  const { node } = shown.row;
  const ink = paneInk();
  const key = `title-${node.id}`;
  const share = view.split[node.id];
  const dot = statusDot(node.status);
  const figures = figuresOf(node, share, view.now);
  const status = statusAfterMark(node).padEnd(STATUS_COLUMN_CELLS);
  const region = Math.max(
    1,
    view.width - displayWidth(shown.prefix) - DOT_CELLS - STATUS_COLUMN_CELLS - rightCells(columns),
  );
  const title = rowTitle(node, columns);
  const tokens = share?.tokens ?? 0;
  const duration = columns.duration > 0 ? ` ${figures.duration.padStart(columns.duration)}` : "";
  const namePadding = " ".repeat(Math.max(0, columns.nameCells - displayWidth(title.name)));
  const named = `${title.name}${namePadding}${title.suffix}`;
  const padding = " ".repeat(Math.max(0, region - displayWidth(named)));
  const paddedName = `${named}${padding}`;
  const tokenCell = columns.tokens > 0 ? ` ${figures.tokens.padStart(columns.tokens)}` : "";
  const costCell = columns.cost > 0 ? ` ${figures.cost.padStart(columns.cost)}` : "";
  const barCell = columns.isWide ? ` ${barText(tokens, columns.totalTokens, BAR_CELLS)}` : "";
  const label = [
    shown.prefix,
    `${dot.text}${status} `,
    paddedName,
    duration,
    barCell,
    tokenCell,
    costCell,
    ` ${FOLDED_GLYPH}`,
  ].join("");
  return (
    <Box key={key} flexDirection="row" width={view.width} height={1}>
      <Button
        key={key}
        label={label}
        plain
        dimColor={false}
        hover={{ color: ink.text ?? ink.section, scope: key }}
        onPress={() => view.openAgent(node.id)}
      >
        <Text wrap="truncate-end">
          <Text color={ink.rule} wrap="truncate-end">
            {shown.prefix}
          </Text>
          <Text color={dot.color} wrap="truncate-end">
            {`${dot.text}${status} `}
          </Text>
          <Text color={ink.text} wrap="truncate-end">
            {title.name}
          </Text>
          <Text color={ink.muted} wrap="truncate-end">
            {`${namePadding}${title.suffix}${padding}${duration}`}
          </Text>
          {columns.isWide ? <Text> </Text> : null}
          {columns.isWide ? bar(ui, tokens, columns.totalTokens, BAR_CELLS, ink.tool) : null}
          <Text color={ink.muted} wrap="truncate-end">
            {tokenCell}
          </Text>
          <Text color={ink.text} wrap="truncate-end">
            {costCell}
          </Text>
          <Text color={ink.muted} wrap="truncate-end">
            {` ${FOLDED_GLYPH}`}
          </Text>
        </Text>
      </Button>
    </Box>
  );
}

function rowTitle(node: AgentNode, columns: Columns): { name: string; suffix: string } {
  const suffixes = suffixesOf(node);
  const suffix =
    suffixes.find((one) => displayWidth(one) <= columns.suffixCells) ?? suffixes.at(-1) ?? "";
  return { name: clipEndAtWord(titleOf(node), columns.nameCells), suffix };
}

function suffixesOf(node: AgentNode): string[] {
  const model = shortModel(node.model);
  const effort = node.effort ?? "";
  const kinds =
    model === ""
      ? [[node.type, effort], [node.type]]
      : [[node.type, model, effort], [node.type, model], [model]];
  return kinds.map((parts) => `${NAME_GAP}${parts.filter((part) => part !== "").join(" · ")}`);
}

export function costTextOf(cents: number | undefined): string {
  if (cents === undefined) return "";
  return aboutDollars(cents === 0 ? HALF_CENT_USD : cents / CENTS_PER_USD);
}

export function statusAfterMark(node: AgentNode): string {
  return ` ${node.status}`;
}

export function shownCostOf(share: AgentShare | undefined): string {
  return (share?.tokens ?? 0) > 0 ? costTextOf(share?.cents) : "";
}

export function titleOf(node: AgentNode): string {
  return node.description || node.name || node.type;
}

export function headerTitleParts(
  node: AgentNode,
  cells: number,
): { description: string; suffix: string } {
  const name = titleOf(node);
  const suffix =
    modelSuffixes(node).find((one) => displayWidth(name) + displayWidth(one) <= cells) ?? "";
  return { description: clipEndAtWord(name, cells - displayWidth(suffix)), suffix };
}

function modelSuffixes(node: AgentNode): string[] {
  const model = shortModel(node.model);
  const parts = [model, node.effort ?? ""].filter((part) => part !== "");
  if (parts.length === 0) return [];
  const modelOnly = model !== "" && parts.length > 1 ? [` · ${model}`] : [];
  return [` · ${parts.join(" · ")}`, ...modelOnly];
}

function detailLines(node: AgentNode, cells: number): Part[][] {
  const lines = runningLines(node, cells);
  if (node.branch === undefined) return lines;
  const { first, second } = fitPair(
    `⎇ ${node.branch}`,
    node.worktree ? ` · ${node.worktree}` : "",
    cells,
  );
  return [...lines, [word(`${first}${second}`)]];
}

function runningLines(node: AgentNode, cells: number): Part[][] {
  if (!hasRunningLine(node)) return [];
  const tool = node.running[0];
  const context = node.ctxTokens > 0 ? [word("ctx "), figure(formatTokens(node.ctxTokens))] : [];
  const used = partsWidth(joined([context, tool ? [word(tool.tool)] : []])) + TOOL_COLON_CELLS;
  return [joined([context, tool ? runningTool(tool.tool, tool.target, cells - used) : []])];
}

function partsWidth(parts: Part[]): number {
  return parts.reduce((cells, part) => cells + displayWidth(part.text), 0);
}

function runningTool(name: string, target: string, room: number): Part[] {
  const toolPart = { text: name, color: paneInk().tool };
  if (target === "") return [toolPart];
  const shown = isPathTool(name) ? clipStart(target, Math.max(1, room)) : target;
  return [toolPart, word(`: ${shown}`)];
}

function joined(groups: Part[][]): Part[] {
  return groups
    .filter((group) => group.length > 0)
    .flatMap((group, i) => (i === 0 ? group : [word(" · "), ...group]));
}
