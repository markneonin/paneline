import type { ElementTable, RenderElement } from "claude-code";

import type { PromptInfo, UsageSnap } from "../types";
import { shortModel } from "./format";
import { tildePath } from "./paths";
import { accentOf, chipColors } from "./session-color";

const MIN_PATH_COLUMNS = 8;
const MIN_PATH_COLUMNS_BEFORE_DROP = 12;
const CHIP_PADDING = 2;
const PANE_TOGGLE_COLUMNS = 5;
const PERCENT_SCALE = 100;
const FILLED_CELL = "▰";
const EMPTY_CELL = "▱";
const COLUMN_GAP = "   ";
const ROW_GAP = 2;
const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const TASK_SYMBOL = "◆";
const TASK_BAR_CELLS = 5;
const TASK_COLUMN_WIDTH = `${TASK_SYMBOL} ${PERCENT_SCALE}%`.length;
const SYMBOLS: Record<string, string> = { task: TASK_SYMBOL, ctx: "≡", "5h": "◷", "7d": "▦" };
const DROP_STEPS = [[], ["7d"], ["7d", "5h"]];
const NO_METERS: MeterLayout = { meters: [], withBars: false, shortensPath: false };

export type Progress = {
  tasks: Record<string, { status: "pending" | "in_progress" | "completed"; title: string }>;
  percent: number | null;
};
type Meter = { label: string; symbol: string; percent: number; reset: string | null };

export function metersOf(usage: UsageSnap, nowMs: number, progress: Progress): Meter[] {
  return [
    ...taskMeters(progress),
    ...[
      ...(usage.context === null ? [] : [{ label: "ctx", percent: usage.context }]),
      ...usage.limits,
    ].map((meter) => {
      const resetsAt = "resetsAt" in meter ? meter.resetsAt : undefined;
      return {
        label: meter.label,
        symbol: SYMBOLS[meter.label] ?? meter.label,
        percent: hasPassed(resetsAt, nowMs) ? 0 : clampedPercent(meter.percent),
        reset: resetIn(resetsAt, nowMs),
      };
    }),
  ];
}

function taskMeters({ tasks, percent }: Progress): Meter[] {
  const statuses = Object.values(tasks).map((task) => task.status);
  const done = statuses.filter((status) => status === "completed").length;
  const value = statuses.length > 0 ? (done / statuses.length) * PERCENT_SCALE : percent;
  if (value === null) return [];
  return [{ label: "task", symbol: TASK_SYMBOL, percent: clampedPercent(value), reset: null }];
}

function clampedPercent(percent: number): number {
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function hasPassed(resetsAt: string | undefined, nowMs: number): boolean {
  return resetsAt !== undefined && Date.parse(resetsAt) < nowMs;
}

function resetIn(resetsAt: string | undefined, nowMs: number): string | null {
  if (resetsAt === undefined) return null;
  const minutes = Math.floor((Date.parse(resetsAt) - nowMs) / MS_PER_MINUTE);
  if (Number.isNaN(minutes) || minutes < 0) return null;
  if (minutes < MINUTES_PER_HOUR) return `${minutes}m`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) return `${hours}h`;
  return `${Math.floor(hours / HOURS_PER_DAY)}d`;
}

type MeterLayout = { meters: Meter[]; withBars: boolean; shortensPath: boolean };

export function promptInfoRow(
  ui: ElementTable,
  { model, effort, cwd }: PromptInfo,
  home: string | undefined,
  totalColumns: number,
  colorName: string,
  meters: Meter[],
): RenderElement {
  const { Box, Text } = ui;
  const columns = totalColumns - PANE_TOGGLE_COLUMNS;
  const lead = [shortModel(model), effort].filter((label): label is string => !!label);
  const leadWidth = lead.reduce((width, label) => width + label.length + CHIP_PADDING, 0);
  const path = tildePath(cwd, home);
  const layout = fittingLayout(meters, columns - leadWidth - CHIP_PADDING, path.length);
  const room = Math.max(columns - leadWidth - CHIP_PADDING - rightWidth(layout), MIN_PATH_COLUMNS);
  const { background, text } = chipColors(colorName);
  const labels = [...lead, shortenPath(path, room)];
  return (
    <Box
      width={totalColumns}
      paddingRight={PANE_TOGGLE_COLUMNS}
      justifyContent="space-between"
      alignItems="flex-end"
    >
      <Text wrap="truncate-end">
        {labels.map((label) => (
          <Text key={label} color={text} backgroundColor={background}>{` ${label} `}</Text>
        ))}
      </Text>
      {layout.meters.length === 0 ? null : meterText(ui, layout, accentOf(colorName))}
    </Box>
  );
}

function meterText(
  { Box, Text }: ElementTable,
  { meters, withBars }: MeterLayout,
  accent: string,
): RenderElement {
  return (
    <Box flexShrink={0} flexDirection="column">
      <Text wrap="truncate-end">
        {meters.map((meter, index) => (
          <Text key={meter.label}>
            {index === 0 ? "" : COLUMN_GAP}
            <Text
              color={accent}
            >{`${meter.symbol} ${meter.reset === null ? "" : `${meter.reset} `}`}</Text>
            <Text weight="semibold" color={accent}>{`${meter.percent}%${trailingOf(meter)}`}</Text>
          </Text>
        ))}
      </Text>
      {withBars ? (
        <Text wrap="truncate-end">
          {meters.map((meter, index) => (
            <Text key={meter.label}>
              {index === 0 ? "" : COLUMN_GAP}
              <Text color={accent}>{barOf(meter)}</Text>
            </Text>
          ))}
        </Text>
      ) : null}
    </Box>
  );
}

function topTextOf({ symbol, reset, percent }: Meter): string {
  return `${symbol} ${reset === null ? "" : `${reset} `}${percent}%`;
}

function barCellsOf(meter: Meter): number {
  return meter.label === "task" ? TASK_BAR_CELLS : topTextOf(meter).length;
}

function columnWidthOf(meter: Meter): number {
  if (meter.label === "task") return TASK_COLUMN_WIDTH;
  return Math.max(topTextOf(meter).length, barCellsOf(meter));
}

function trailingOf(meter: Meter): string {
  return " ".repeat(columnWidthOf(meter) - topTextOf(meter).length);
}

function barOf(meter: Meter): string {
  const cells = barCellsOf(meter);
  const filled = Math.round((meter.percent / PERCENT_SCALE) * cells);
  return (FILLED_CELL.repeat(filled) + EMPTY_CELL.repeat(cells - filled)).padEnd(
    columnWidthOf(meter),
  );
}

function fittingLayout(
  meters: Meter[],
  roomForPathAndMeters: number,
  pathLength: number,
): MeterLayout {
  const layouts = layoutsOf(meters);
  const fitting = layouts.find((layout) => {
    const needed = layout.shortensPath
      ? Math.min(pathLength, MIN_PATH_COLUMNS_BEFORE_DROP)
      : pathLength;
    return roomForPathAndMeters - rightWidth(layout) >= needed;
  });
  return fitting ?? layouts.at(-1) ?? NO_METERS;
}

function layoutsOf(meters: Meter[]): MeterLayout[] {
  if (meters.length === 0) return [];
  return [
    { meters, withBars: true, shortensPath: false },
    ...DROP_STEPS.map((dropped) => ({
      meters: meters.filter((meter) => !dropped.includes(meter.label)),
      withBars: true,
      shortensPath: true,
    })),
  ];
}

function rightWidth(layout: MeterLayout): number {
  return layout.meters.length === 0 ? 0 : ROW_GAP + metersWidth(layout);
}

function metersWidth({ meters }: MeterLayout): number {
  const widths = meters.map(columnWidthOf);
  return widths.reduce((sum, width) => sum + width, 0) + COLUMN_GAP.length * (widths.length - 1);
}

function shortenPath(path: string, room: number): string {
  if (path.length <= room) return path;
  const segments = path.split("/").filter((segment) => segment !== "");
  const last = segments.at(-1) ?? path;
  for (let kept = segments.length - 1; kept >= 1; kept--) {
    const candidate = `…/${segments.slice(-kept).join("/")}`;
    if (candidate.length <= room) return candidate;
  }
  return last.length + 2 <= room ? `…/${last}` : `…${last.slice(-(room - 1))}`;
}
