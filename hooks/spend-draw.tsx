import type { ElementTable, RenderElement } from "claude-code";

import type { SpendMiss, SpendRent, SpendState } from "../types";
import { formatTokens } from "./format";
import { bar, header, paneHeaderLook, paneRow } from "./pane-kit";
import { paneInk } from "./pane-ink";
import { BACKGROUND_OWNER, cacheHitPercent } from "./spend-model";
import type { SplitRow } from "./spend-model";
import { displayWidth } from "./text-width";
import { isPathTool } from "./tools";

type Ui = ElementTable;

export type SpendView = {
  width: number;
  sessionUsd: number | null;
  rows: readonly SplitRow[];
  spend: SpendState;
  now: number;
};

const BAR_CELLS = 16;
const MIN_BAR_CELLS = 4;
const MIN_NAME_CELLS = 6;
const MAX_NAME_CELLS = 16;
const PERCENT_CELLS = 4;
const TOKEN_CELLS = 5;
const CENTS_PER_USD = 100;
const TTL_MS = { "5m": 5 * 60_000, "1h": 60 * 60_000 } as const;
const SEPARATOR = " · ";
const BACKGROUND_NOTE = "agent summaries, compaction, memory";
const NO_SPEND = "no spend yet";
const NO_RENT = "no tool results in context";
const SPLIT_TITLE = "Where it went";
const CACHE_TITLE = "Cache misses";
const RENT_TITLE = "Biggest tool results in context";
const NO_CACHE = "no cache data yet";

export function spendTab(ui: Ui, view: SpendView): RenderElement {
  const { Box } = ui;
  const sections = [
    totalsRow(ui, view),
    splitSection(ui, view),
    cacheSection(ui, view),
    rentSection(ui, view),
  ];
  return (
    <Box flexDirection="column" width={view.width}>
      {sections.flatMap((section, index) => [
        ...(index > 0 ? [<Box key={`gap-${index}`} height={1} />] : []),
        section,
      ])}
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
    { value: dollars(view.sessionUsd), label: "this session" },
    { value: hit === null ? "-" : `${hit}%`, label: "from cache · all agents" },
    { value: formatTokens(view.spend.rentTokens), label: "tool results" },
  ];
  const cells = Math.floor(view.width / totals.length);
  const warmth = warmthText(view.spend, view.now);
  return (
    <Box key="totals" flexDirection="column" width={view.width}>
      <Box flexDirection="row" width={view.width}>
        {totals.map(({ value, label }) => (
          <Box
            key={label}
            flexDirection="column"
            width={cells}
            flexShrink={1}
            minWidth={0}
            paddingRight={1}
          >
            <Text weight="semibold" color={paneInk().text} wrap="truncate-end">
              {value}
            </Text>
            <Text color={paneInk().muted} wrap="truncate-end">
              {label}
            </Text>
          </Box>
        ))}
      </Box>
      {warmth === null ? null : gap("warmth-gap", ui)}
      {warmth === null ? null : (
        <Text color={paneInk().muted} wrap="truncate-end">
          {warmth}
        </Text>
      )}
    </Box>
  );
}

function warmthText(spend: SpendState, now: number): string | null {
  const memory = spend.mainMemory;
  if (memory?.ttl === undefined) return null;
  const warmUntil = memory.endedAt + TTL_MS[memory.ttl];
  return warmUntil > now ? `cache warm until ${clockOf(warmUntil)}` : "cache cold";
}

function gap(key: string, { Box }: Ui): RenderElement {
  return <Box key={key} height={1} />;
}

function splitSection(ui: Ui, view: SpendView): RenderElement {
  const { Box } = ui;
  const { width } = view;
  const columns = splitColumns(view.rows, width);
  const largest = Math.max(0, ...view.rows.map((row) => row.value));
  return (
    <Box key="split" flexDirection="column" width={view.width}>
      {header(ui, SPLIT_TITLE, paneHeaderLook(), view.width)}
      {view.rows.length === 0 ? null : gap("split-gap", ui)}
      {view.rows.flatMap((row) => [
        splitRow(ui, row, largest, columns),
        ...(row.name === BACKGROUND_OWNER ? [backgroundNote(ui, width)] : []),
      ])}
    </Box>
  );
}

type SplitColumns = { width: number; name: number; usd: number; bar: number };

function splitColumns(rows: readonly SplitRow[], width: number): SplitColumns {
  const nameCells = Math.min(
    MAX_NAME_CELLS,
    Math.max(MIN_NAME_CELLS, ...rows.map((row) => displayWidth(rowName(row)))),
  );
  const usdCells = Math.max(0, ...rows.map((row) => displayWidth(usdText(row))));
  const gaps = usdCells === 0 ? 2 : 3;
  const free = width - nameCells - usdCells - PERCENT_CELLS - gaps;
  return {
    width,
    name: nameCells,
    usd: usdCells,
    bar: Math.max(MIN_BAR_CELLS, Math.min(BAR_CELLS, free)),
  };
}

function splitRow(ui: Ui, row: SplitRow, largest: number, columns: SplitColumns): RenderElement {
  const { Box, Text } = ui;
  return (
    <Box key={row.name} flexDirection="row" width={columns.width} height={1} columnGap={1}>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap="truncate-end">
          <Text color={paneInk().text} wrap="truncate-end">
            {row.name}
          </Text>
          <Text color={paneInk().muted} wrap="truncate-end">
            {row.model === undefined ? "" : `${SEPARATOR}${row.model}`}
          </Text>
        </Text>
      </Box>
      <Box flexShrink={0}>{bar(ui, row.value, largest, columns.bar, paneInk().tool)}</Box>
      {columns.usd === 0 ? null : (
        <Box width={columns.usd} flexShrink={0}>
          <Text color={paneInk().muted} wrap="truncate-end">
            {usdText(row).padStart(columns.usd)}
          </Text>
        </Box>
      )}
      <Box width={PERCENT_CELLS} flexShrink={0}>
        <Text color={paneInk().muted} wrap="truncate-end">
          {`${row.percent}%`.padStart(PERCENT_CELLS)}
        </Text>
      </Box>
    </Box>
  );
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

function usdText(row: { cents: number | null }): string {
  return row.cents === null ? "" : `~${dollars(row.cents / CENTS_PER_USD)}`;
}

function dollars(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

function cacheSection(ui: Ui, view: SpendView): RenderElement {
  const { Box, Text } = ui;
  const { spend } = view;
  const usdCells = Math.max(0, ...spend.misses.map((miss) => displayWidth(missUsd(miss))));
  const { width } = view;
  return (
    <Box key="cache" flexDirection="column" width={view.width}>
      {header(ui, CACHE_TITLE, paneHeaderLook(), view.width)}
      <Text color={paneInk().muted} wrap="truncate-end">
        {cacheHitPercent(spend) === null
          ? NO_CACHE
          : `${missCountText(spend.missCount)}${SEPARATOR}~${dollars(spend.lostUsd)} lost`}
      </Text>
      {spend.misses.length === 0 ? null : gap("cache-gap", ui)}
      {spend.misses.map((miss) => missRow(ui, miss, usdCells, width))}
    </Box>
  );
}

function missCountText(count: number): string {
  return `${count} ${count === 1 ? "miss" : "misses"}`;
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
  return miss.usd === null ? "" : `~${dollars(miss.usd)}`;
}

function clockOf(at: number): string {
  const time = new Date(at);
  const pad = (part: number): string => String(part).padStart(2, "0");
  return `${pad(time.getHours())}:${pad(time.getMinutes())}`;
}

function rentSection(ui: Ui, view: SpendView): RenderElement {
  const { Box, Text } = ui;
  const { spend } = view;
  const labelCells = Math.max(0, ...spend.rent.map((row) => displayWidth(row.tool)));
  const { width } = view;
  return (
    <Box key="rent" flexDirection="column" width={view.width}>
      {header(ui, RENT_TITLE, paneHeaderLook(), view.width)}
      {gap("rent-gap", ui)}
      {spend.rent.length === 0 ? (
        <Text color={paneInk().muted} wrap="truncate-end">
          {NO_RENT}
        </Text>
      ) : (
        spend.rent.map((row, index) => rentRow(ui, row, index, labelCells, width))
      )}
    </Box>
  );
}

function rentRow(
  ui: Ui,
  row: SpendRent,
  index: number,
  labelCells: number,
  width: number,
): RenderElement {
  return paneRow(ui, {
    key: `rent-${index}`,
    label: { text: row.tool.padEnd(labelCells), color: paneInk().text },
    middle: { text: row.target, color: paneInk().text },
    middleWrap: isPathTool(row.tool) ? "truncate-start" : "truncate-end",
    right: { text: formatTokens(row.tokens).padStart(TOKEN_CELLS), color: paneInk().muted },
    width,
  });
}
