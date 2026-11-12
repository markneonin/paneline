import type { ElementTable, RenderElement } from "claude-code";

import type { SpendLastTurn, SpendMiss, SpendRent, SpendState, TranscriptProgress } from "../types";
import { aboutDollars, clockOf, dollars, formatDuration, formatTokens } from "./format";
import { bar, button, header, labelButton, paneHeaderLook, paneRow, plural } from "./pane-kit";
import { paneInk } from "./pane-ink";
import {
  BACKGROUND_OWNER,
  TOKENS_BILLED_LABEL,
  cacheHitPercent,
  moreRowOf,
  nextMessageUsd,
  warmUntilOf,
} from "./spend-model";
import type { CacheOption, SplitRow } from "./spend-model";
import { clipEnd, displayWidth } from "./text-width";
import { isPathTool } from "./tools";

type Ui = ElementTable;

export type SpendHistory = {
  today: number;
  week: number;
  month: number;
  lastHour: number;
  hourAverage: number | null;
  projects: SplitRow[];
  days: SplitRow[];
};

export type DetailList = {
  key: string;
  title: string;
  opens: "day" | "project";
  rows: SplitRow[];
};

export type SpendDetail = {
  title: string;
  total: number;
  ranked: DetailList;
  sessionsKey: string;
  sessions: SplitRow[];
};

export type SpendView = {
  width: number;
  sessionUsd: number | null;
  rows: readonly SplitRow[];
  spend: SpendState;
  history: SpendHistory;
  detail: SpendDetail | null;
  unfolded: readonly string[];
  progress: TranscriptProgress | null;
  now: number;
  options: readonly CacheOption[];
  openProject: (name: string) => void;
  openDay: (id: string) => void;
  openAgents: (ids: string[]) => void;
  openCall: (id: string) => void;
  back: () => void;
  toggle: (list: string) => void;
};

const MIN_BAR_CELLS = 4;
const MIN_BAR_WITH_WIDE_NAME_CELLS = 10;
const MIN_NAME_CELLS = 6;
const MAX_NAME_CELLS = 16;
const PERCENT_CELLS = 5;
const SMALLEST_PERCENT = 1;
const UNDER_PERCENT_LABEL = "<1%";
const AMOUNT_PADDING_CELLS = 1;
const TILE_GAP_CELLS = 2;
const TOKEN_CELLS = 5;
const CENTS_PER_USD = 100;
const SEPARATOR = " · ";
const FULL_PERCENT = 100;
const BACKGROUND_NOTE = "agent summaries, compaction, memory";
const HISTORY_TITLE = "History · all sessions";
const PROJECTS_TITLE = "By project · 30 days";
const DAYS_TITLE = "Costliest days · 30 days";
const SESSIONS_TITLE = "Sessions";
const PROJECTS_KEY = "projects";
const DAYS_KEY = "days";
const SPLIT_KEY = "split";
const MAX_FOLDED_ROWS = 100;
const FOLDED_GLYPH = "▸";
const OPEN_GLYPH = "▾";
const FOLD_INDENT_CELLS = 2;
const HIGH_HOUR_LABEL = "last hour, high";
const NO_HISTORY = "no history yet";
const NO_SPEND = "no spend this session yet";
const LAST_TURN_TITLE = "Last turn";
const DEFAULT_TTL = "5m";
const SPLIT_TITLE = "Where it went";
const CACHE_TITLE = "Cache misses";
const RENT_TITLE = "Biggest tool results in context";
const CHEAPEST = "cheapest";
const OPTIONS_CAPTION = "price of the next turn";
const COMPACTED_CAPTION = "cache cold · compacted";
const OPTION_INDENT = "  ";
const CACHE_STAMP = `tokens${SEPARATOR}lost`;
const RENT_STAMP = "tokens";

export function spendTab(ui: Ui, view: SpendView): RenderElement {
  if (view.detail !== null) return detailTab(ui, view, view.detail);
  const { Box } = ui;
  const lines = spendLines(view);
  const sections = [
    totalsRow(ui, view),
    lastTurnSection(ui, view),
    historySection(ui, view, lines),
    splitSection(ui, view, lines),
    cacheSection(ui, view),
    rentSection(ui, view),
  ].filter((section): section is RenderElement => section !== null);
  return (
    <Box flexDirection="column" width={view.width}>
      {sections.flatMap((section, index) => [
        ...(index > 0 ? [<Box key={`gap-${index}`} height={1} />] : []),
        section,
      ])}
    </Box>
  );
}

type SpendLines = {
  columns: SplitColumns;
  projects: SplitLine[];
  days: SplitLine[];
  split: SplitLine[];
};

function spendLines(view: SpendView): SpendLines {
  const { history } = view;
  const projects = linesOf(view, {
    key: PROJECTS_KEY,
    rows: history.projects,
    usdOf: projectUsdText,
    open: view.openProject,
  });
  const days = linesOf(view, {
    key: DAYS_KEY,
    rows: history.days,
    usdOf: projectUsdText,
    open: view.openDay,
  });
  const split = linesOf(view, {
    key: SPLIT_KEY,
    rows: view.rows,
    usdOf: usdText,
    openAgents: view.openAgents,
  });
  return {
    columns: splitColumns([...projects, ...days, ...split], view.width),
    projects,
    days,
    split,
  };
}

function detailTab(ui: Ui, view: SpendView, detail: SpendDetail): RenderElement {
  const { Box } = ui;
  const { ranked } = detail;
  const rankedLines = linesOf(view, {
    key: ranked.key,
    rows: ranked.rows,
    usdOf: projectUsdText,
    open: ranked.opens === "day" ? view.openDay : view.openProject,
  });
  const sessionLines = linesOf(view, {
    key: detail.sessionsKey,
    rows: detail.sessions,
    usdOf: projectUsdText,
  });
  const columns = splitColumns([...rankedLines, ...sessionLines], view.width);
  const blocks = [
    listBlock(ui, view, ranked.title, rankedLines, detail.total, columns),
    listBlock(ui, view, SESSIONS_TITLE, sessionLines, detail.total, columns),
  ].filter((block): block is RenderElement => block !== null);
  return (
    <Box key="detail" flexDirection="column" width={view.width}>
      {button(ui, { key: "back", label: "back", onPress: view.back })}
      {gap("detail-back-gap", ui)}
      {header(ui, detail.title, paneHeaderLook(), view.width, dollars(detail.total))}
      {blocks.flatMap((block, index) => [gap(`detail-gap-${index}`, ui), block])}
    </Box>
  );
}

function listBlock(
  ui: Ui,
  view: SpendView,
  title: string,
  lines: readonly SplitLine[],
  total: number,
  columns: SplitColumns,
): RenderElement | null {
  if (lines.length === 0) return null;
  const { Box } = ui;
  return (
    <Box key={title} flexDirection="column" width={view.width}>
      {header(ui, title, paneHeaderLook(), view.width)}
      {gap(`${title}-gap`, ui)}
      {lines.map((line) => splitRow(ui, line, total, columns, lines.length > 1))}
    </Box>
  );
}

function totalsRow(ui: Ui, view: SpendView): RenderElement {
  const { Box, Text } = ui;
  if (view.sessionUsd === null || view.sessionUsd <= 0) {
    return (
      <Text key="totals" color={paneInk().muted} wrap="truncate-end">
        {NO_SPEND}
      </Text>
    );
  }
  const hit = cacheHitPercent(view.spend);
  const totals = [
    { value: dollars(view.sessionUsd), label: "this session", isKey: true, isZero: false },
    {
      value: hit === null ? "-" : `${hit}%`,
      label: "cache, all agents",
      isKey: false,
      isZero: hit === 0,
    },
    {
      value: rentText(view.spend.rentTokens),
      label: "result tokens",
      isKey: false,
      isZero: view.spend.rentTokens === 0,
    },
  ];
  const caption = captionOf(view);
  return (
    <Box key="totals" flexDirection="column" width={view.width}>
      {tileRow(ui, totals, view.width)}
      {caption === null ? null : gap("warmth-gap", ui)}
      {caption === null ? null : run(ui, caption)}
      {view.options.length === 0 ? null : optionRows(ui, view)}
    </Box>
  );
}

type Tile = { value: string; label: string; isKey: boolean; isZero: boolean };

function tileRow({ Box, Text }: Ui, tiles: readonly Tile[], width: number): RenderElement {
  return (
    <Box flexDirection="row" width={width}>
      {tiles.map(({ value, label, isKey, isZero }) => (
        <Box
          key={label}
          flexDirection="column"
          width={Math.max(displayWidth(value), displayWidth(label)) + TILE_GAP_CELLS}
          flexGrow={1}
          flexShrink={1}
          minWidth={0}
          paddingRight={1}
        >
          <Text
            weight={isKey ? "semibold" : undefined}
            color={isZero ? paneInk().muted : paneInk().text}
            wrap="truncate-end"
          >
            {value}
          </Text>
          <Text color={paneInk().muted} wrap="truncate-end">
            {label}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function mergedTiles(tiles: readonly Tile[]): Tile[] {
  return tiles.reduce<Tile[]>((merged, tile) => {
    const previous = merged.at(-1);
    if (previous?.value !== tile.value) return [...merged, tile];
    return [
      ...merged.slice(0, -1),
      { ...previous, label: `${previous.label}${SEPARATOR}${tile.label}` },
    ];
  }, []);
}

function progressNote(progress: TranscriptProgress | null): string {
  if (progress === null) return "";
  const { doneBytes, totalBytes, failed } = progress;
  const counting =
    doneBytes < totalBytes
      ? `counting · ${Math.floor((doneBytes / totalBytes) * FULL_PERCENT)}%`
      : "";
  const unreadable = failed > 0 ? `· ${failed} unreadable` : "";
  return [counting, unreadable].filter((part) => part !== "").join(" ");
}

function historySection(ui: Ui, view: SpendView, lines: SpendLines): RenderElement {
  const { Box, Text } = ui;
  const { history, width } = view;
  const heading = header(ui, HISTORY_TITLE, paneHeaderLook(), width, progressNote(view.progress));
  if (history.projects.length === 0) {
    return (
      <Box key="history" flexDirection="column" width={width}>
        {heading}
        {gap("history-empty-gap", ui)}
        <Text color={paneInk().muted} wrap="truncate-end">
          {NO_HISTORY}
        </Text>
      </Box>
    );
  }
  const tiles = mergedTiles([
    historyTile(history.today, dollars(history.today), "today"),
    historyTile(history.week, dollars(history.week), "7 days"),
    historyTile(history.month, dollars(history.month), "30 days"),
    historyTile(history.lastHour, `${dollars(history.lastHour)}/h`, lastHourLabel(history)),
  ]);
  return (
    <Box key="history" flexDirection="column" width={width}>
      {heading}
      {gap("history-tiles-gap", ui)}
      {tileRow(ui, tiles, width)}
      {gap("history-gap", ui)}
      {listBlock(
        ui,
        view,
        PROJECTS_TITLE,
        lines.projects,
        totalOf(history.projects),
        lines.columns,
      )}
      {history.days.length === 0 ? null : gap("days-block-gap", ui)}
      {listBlock(ui, view, DAYS_TITLE, lines.days, totalOf(history.days), lines.columns)}
    </Box>
  );
}

function lastHourLabel({ lastHour, hourAverage }: SpendHistory): string {
  return hourAverage !== null && lastHour > hourAverage ? HIGH_HOUR_LABEL : "last hour";
}

function totalOf(rows: readonly SplitRow[]): number {
  return rows.reduce((sum, row) => sum + row.value, 0);
}

function historyTile(usd: number, value: string, label: string): Tile {
  return { value, label, isKey: false, isZero: usd === 0 };
}

function optionRows(ui: Ui, view: SpendView): RenderElement[] {
  const cheapest = Math.min(...view.options.map((option) => option.usd));
  return view.options.map((option) =>
    paneRow(ui, {
      key: `option-${option.name}`,
      label: { text: `${OPTION_INDENT}${option.name}`, color: paneInk().text },
      middle: {
        text: option.usd === cheapest ? `· ${CHEAPEST}` : "",
        color: paneInk().muted,
      },
      middleWrap: "truncate-end",
      right: { text: aboutDollars(option.usd), color: paneInk().muted },
      width: view.width,
    }),
  );
}

function captionOf(view: SpendView): Part[] | null {
  const { spend } = view;
  const isCompacted = spend.isCompacted && warmUntilOf(spend.mainMemory) !== undefined;
  const warmth = isCompacted ? COMPACTED_CAPTION : warmthText(spend, view.now);
  const hasOptions = warmth !== null && !isCompacted && view.options.length > 0;
  const groups = [
    warmth === null ? null : [word(warmth)],
    missPart(spend),
    hasOptions ? [word(OPTIONS_CAPTION)] : null,
  ].filter((group): group is Part[] => group !== null);
  return groups.length === 0 ? null : joined(groups);
}

function missPart(spend: SpendState): Part[] | null {
  if (cacheHitPercent(spend) === null) return null;
  const hasMisses = spend.missCount > 0;
  return [
    { text: String(spend.missCount), isValue: hasMisses },
    word(` ${spend.missCount === 1 ? "miss" : "misses"}${SEPARATOR}`),
    { text: aboutDollars(spend.lostUsd), isValue: hasMisses },
    word(" lost"),
  ];
}

type Part = { text: string; isValue: boolean };

function word(text: string): Part {
  return { text, isValue: false };
}

function value(text: string): Part {
  return { text, isValue: true };
}

function joined(groups: readonly Part[][]): Part[] {
  return groups.flatMap((group, index) => (index === 0 ? group : [word(SEPARATOR), ...group]));
}

function run({ Text }: Ui, parts: readonly Part[]): RenderElement {
  return (
    <Text wrap="truncate-end">
      {parts.map(({ text, isValue }, index) => (
        <Text
          key={`${index}-${text}`}
          color={isValue ? paneInk().text : paneInk().muted}
          wrap="truncate-end"
        >
          {text}
        </Text>
      ))}
    </Text>
  );
}

function warmthText(spend: SpendState, now: number): string | null {
  const warmUntil = warmUntilOf(spend.mainMemory);
  if (warmUntil === undefined) return null;
  return warmUntil > now ? `cache warm until ${clockOf(warmUntil)}` : "cache cold";
}

function gap(key: string, { Box }: Ui): RenderElement {
  return <Box key={key} height={1} />;
}

function lastTurnSection(ui: Ui, view: SpendView): RenderElement | null {
  const { lastTurn } = view.spend;
  if (lastTurn === null) return null;
  const { Box } = ui;
  const lines = [
    { key: "receipt", parts: receiptParts(lastTurn) },
    { key: "next-message", parts: nextMessageParts(view.spend) },
  ];
  return (
    <Box key="last-turn" flexDirection="column" width={view.width}>
      {header(
        ui,
        `${LAST_TURN_TITLE}${SEPARATOR}${TOKENS_BILLED_LABEL}`,
        paneHeaderLook(),
        view.width,
      )}
      {gap("last-turn-gap", ui)}
      {lines.map(({ key, parts }) =>
        parts === null ? null : <Box key={key}>{run(ui, parts)}</Box>,
      )}
    </Box>
  );
}

function receiptParts(lastTurn: SpendLastTurn): Part[] {
  const agents =
    lastTurn.agents === 0
      ? []
      : [[value(String(lastTurn.agents)), word(` ${plural("agent", lastTurn.agents)}`)]];
  return joined([
    [value(dollars(lastTurn.usd))],
    [value(formatTokens(lastTurn.tokens)), word(" tokens")],
    [value(formatDuration(lastTurn.durationMs))],
    ...agents,
  ]);
}

function nextMessageParts({ lastTurn, mainMemory, isCompacted }: SpendState): Part[] | null {
  if (lastTurn?.contextTokens == null || mainMemory === null || isCompacted) return null;
  const cost = nextMessageUsd(
    mainMemory.model,
    lastTurn.contextTokens,
    mainMemory.ttl ?? DEFAULT_TTL,
  );
  if (cost === null) return null;
  return joined([
    [word("next message "), value(dollars(cost.warm)), word(" warm")],
    [value(dollars(cost.cold)), word(" cold")],
  ]);
}

function splitSection(
  ui: Ui,
  view: SpendView,
  { columns, split }: SpendLines,
): RenderElement | null {
  if (view.rows.length === 0) return null;
  const { Box } = ui;
  const { width } = view;
  const total = view.sessionUsd ?? 0;
  return (
    <Box key="split" flexDirection="column" width={view.width}>
      {header(ui, SPLIT_TITLE, paneHeaderLook(), view.width)}
      {gap("split-gap", ui)}
      {split.flatMap((line) => [
        splitRow(ui, line, total, columns, split.length > 1),
        ...(line.row.name === BACKGROUND_OWNER ? [backgroundNote(ui, width)] : []),
      ])}
    </Box>
  );
}

type SplitColumns = { width: number; name: number; usd: number; bar: number };

type SplitLine = {
  key: string;
  row: SplitRow;
  usd: string;
  name: string;
  indent: number;
  isMuted: boolean;
  onPress: (() => void) | undefined;
};

type RankedList = {
  key: string;
  rows: readonly SplitRow[];
  usdOf: (row: SplitRow) => string;
  open?: (id: string) => void;
  openAgents?: (ids: string[]) => void;
};

function linesOf(view: SpendView, list: RankedList): SplitLine[] {
  return list.rows.flatMap((row) => {
    if (row.folded === undefined) return [lineOf(list, row, 0)];
    const isOpen = view.unfolded.includes(list.key);
    const fold: SplitLine = {
      key: `${list.key}-fold`,
      row,
      usd: list.usdOf(row),
      name: `${isOpen ? OPEN_GLYPH : FOLDED_GLYPH} ${row.name}`,
      indent: 0,
      isMuted: false,
      onPress: () => view.toggle(list.key),
    };
    return isOpen ? [fold, ...foldedLines(list, row.folded)] : [fold];
  });
}

function foldedLines(list: RankedList, folded: readonly SplitRow[]): SplitLine[] {
  const shown = folded.slice(0, MAX_FOLDED_ROWS).map((row) => lineOf(list, row, FOLD_INDENT_CELLS));
  if (folded.length <= MAX_FOLDED_ROWS) return shown;
  const more = moreRowOf(folded.slice(MAX_FOLDED_ROWS));
  return [
    ...shown,
    {
      key: `${list.key}-more`,
      row: more,
      usd: list.usdOf(more),
      name: more.name,
      indent: FOLD_INDENT_CELLS,
      isMuted: true,
      onPress: undefined,
    },
  ];
}

function lineOf(list: RankedList, row: SplitRow, indent: number): SplitLine {
  return {
    key: `${list.key}-${row.id ?? row.name}`,
    row,
    usd: list.usdOf(row),
    name: rowName(row),
    indent,
    isMuted: false,
    onPress: pressOf(list, row),
  };
}

function pressOf(
  { open, openAgents }: RankedList,
  { id, agentIds }: SplitRow,
): (() => void) | undefined {
  if (agentIds !== undefined && openAgents !== undefined) return () => openAgents(agentIds);
  if (id === undefined || open === undefined) return undefined;
  return () => open(id);
}

function splitColumns(lines: readonly SplitLine[], width: number): SplitColumns {
  const widestUsd = Math.max(0, ...lines.map(({ usd }) => displayWidth(usd)));
  const usdCells = widestUsd === 0 ? 0 : widestUsd + AMOUNT_PADDING_CELLS;
  const gaps = usdCells === 0 ? 2 : 3;
  const besideName = width - usdCells - PERCENT_CELLS - gaps;
  const widestName = Math.max(0, ...lines.map(({ indent, name }) => indent + displayWidth(name)));
  const nameCap = Math.max(MAX_NAME_CELLS, besideName - MIN_BAR_WITH_WIDE_NAME_CELLS);
  const nameCells = Math.min(nameCap, Math.max(MIN_NAME_CELLS, widestName));
  return {
    width,
    name: nameCells,
    usd: usdCells,
    bar: Math.max(MIN_BAR_CELLS, besideName - nameCells),
  };
}

function splitRow(
  ui: Ui,
  line: SplitLine,
  total: number,
  columns: SplitColumns,
  hasBar: boolean,
): RenderElement {
  const { Box, Text } = ui;
  const { row, usd, onPress } = line;
  const filled = filledCells(row, total, columns.bar);
  const nameCells = columns.name - line.indent;
  const hasCents = row.cents !== null && row.cents !== 0;
  const isUnder = isUnderPercent(row);
  return (
    <Box key={line.key} flexDirection="row" width={columns.width} height={1} columnGap={1}>
      <Box width={columns.name} flexShrink={1} minWidth={0} paddingLeft={line.indent}>
        {onPress === undefined ? (
          <Text wrap="truncate-end">
            <Text color={line.isMuted ? paneInk().muted : paneInk().text} wrap="truncate-end">
              {clipEnd(row.name, nameCells)}
            </Text>
            <Text color={paneInk().muted} wrap="truncate-end">
              {row.model === undefined ? "" : `${SEPARATOR}${row.model}`}
            </Text>
          </Text>
        ) : (
          labelButton(ui, {
            key: `name-${line.key}`,
            label: clipEnd(line.name, nameCells),
            onPress,
          })
        )}
      </Box>
      <Box width={columns.bar} flexShrink={0}>
        {hasBar ? bar(ui, filled, columns.bar, columns.bar, paneInk().tool) : null}
      </Box>
      {columns.usd === 0 ? null : (
        <Box width={columns.usd} flexShrink={0}>
          <Text color={hasCents ? paneInk().text : paneInk().muted} wrap="truncate-end">
            {usd.padStart(columns.usd)}
          </Text>
        </Box>
      )}
      <Box width={PERCENT_CELLS} flexShrink={0}>
        <Text
          color={row.percent === 0 || isUnder ? paneInk().muted : paneInk().text}
          wrap="truncate-end"
        >
          {(isUnder ? UNDER_PERCENT_LABEL : `${row.percent}%`).padStart(PERCENT_CELLS)}
        </Text>
      </Box>
    </Box>
  );
}

function isUnderPercent(row: SplitRow): boolean {
  return row.value > 0 && row.share * FULL_PERCENT < SMALLEST_PERCENT;
}

function filledCells(row: SplitRow, total: number, cells: number): number {
  if (row.value <= 0 || total <= 0 || isUnderPercent(row)) return 0;
  return Math.min(cells, Math.max(1, Math.round((row.value / total) * cells)));
}

function backgroundNote({ Text }: Ui, width: number): RenderElement {
  return (
    <Text key="background-note" color={paneInk().muted} wrap="truncate-end">
      {BACKGROUND_NOTE.slice(0, width)}
    </Text>
  );
}

function rowName(row: SplitRow): string {
  return `${row.name}${row.model === undefined ? "" : `${SEPARATOR}${row.model}`}`;
}

export function usdText(row: Pick<SplitRow, "cents" | "value">): string {
  if (row.cents === null) return "";
  return aboutDollars(shownUsd(row.cents, row.value));
}

function projectUsdText(row: SplitRow): string {
  if (row.cents === null) return "";
  return dollars(shownUsd(row.cents, row.value));
}

function shownUsd(cents: number, value: number): number {
  return cents === 0 ? value : cents / CENTS_PER_USD;
}

function rentText(tokens: number): string {
  return tokens === 0 ? "0" : `~${formatTokens(tokens)}`;
}

function cacheSection(ui: Ui, view: SpendView): RenderElement | null {
  const { spend, width } = view;
  if (spend.misses.length === 0) return null;
  const { Box } = ui;
  const usdCells = Math.max(0, ...spend.misses.map((miss) => displayWidth(missUsd(miss))));
  return (
    <Box key="cache" flexDirection="column" width={width}>
      {header(ui, CACHE_TITLE, paneHeaderLook(), width, CACHE_STAMP)}
      {gap("cache-title-gap", ui)}
      {spend.misses.map((miss) => missRow(ui, miss, usdCells, width))}
    </Box>
  );
}

function missRow(ui: Ui, miss: SpendMiss, usdCells: number, width: number): RenderElement {
  const tokens = formatTokens(miss.rebuilt).padStart(TOKEN_CELLS);
  const right = usdCells === 0 ? tokens : `${tokens} ${missUsd(miss).padStart(usdCells)}`;
  return paneRow(ui, {
    key: `miss-${miss.at}`,
    label: { text: clockOf(miss.at), color: paneInk().muted },
    middle: { text: miss.cause, color: paneInk().text },
    middleWrap: "truncate-end",
    right: { text: right, color: paneInk().muted },
    width,
  });
}

function missUsd(miss: SpendMiss): string {
  return miss.usd === null ? "" : aboutDollars(miss.usd);
}

function rentSection(ui: Ui, view: SpendView): RenderElement | null {
  const { spend, width } = view;
  if (spend.rent.length === 0) return null;
  const { Box } = ui;
  const labelCells = Math.max(0, ...spend.rent.map((row) => displayWidth(row.tool)));
  return (
    <Box key="rent" flexDirection="column" width={width}>
      {header(ui, RENT_TITLE, paneHeaderLook(), width, RENT_STAMP)}
      {gap("rent-gap", ui)}
      {spend.rent.map((row, index) => rentRow(ui, view, row, index, labelCells))}
    </Box>
  );
}

function rentRow(
  ui: Ui,
  view: SpendView,
  row: SpendRent,
  index: number,
  labelCells: number,
): RenderElement {
  const { callId } = row;
  const { width } = view;
  const key = `rent-${index}`;
  const right = { text: formatTokens(row.tokens).padStart(TOKEN_CELLS), color: paneInk().muted };
  const middleWrap = isPathTool(row.tool) ? "truncate-start" : "truncate-end";
  if (callId === undefined) {
    return paneRow(ui, {
      key,
      label: { text: row.tool.padEnd(labelCells), color: paneInk().text },
      middle: { text: row.target, color: paneInk().text },
      middleWrap,
      right,
      width,
    });
  }
  const { Box, Text } = ui;
  return (
    <Box key={key} flexDirection="row" width={width} height={1} columnGap={1}>
      <Box width={labelCells} flexShrink={0}>
        {labelButton(ui, {
          key: `name-${key}`,
          label: row.tool,
          onPress: () => view.openCall(callId),
        })}
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text color={paneInk().text} wrap={middleWrap}>
          {row.target}
        </Text>
      </Box>
      <Box flexShrink={0}>
        <Text color={right.color} wrap="truncate-end">
          {right.text}
        </Text>
      </Box>
    </Box>
  );
}
