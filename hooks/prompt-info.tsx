import type { ElementTable, RenderElement } from "claude-code";

import type { PromptInfo, UsageSnap } from "../types";
import { shortModel } from "./format";
import { tildePath } from "./paths";
import { accentOf, chipColors } from "./session-color";

const MIN_PATH_COLUMNS = 8;
const MIN_PATH_COLUMNS_BEFORE_DROP = 12;
const CHIP_PADDING = 2;
const MODEL_CHIP_KEY = "model-chip";
const EFFORT_CHIP_KEY = "effort-chip";
const PANE_TOGGLE_COLUMNS = 5;
const PERCENT_SCALE = 100;
const FILLED_CELL = "▰";
const EMPTY_CELL = "▱";
const COLUMN_GAP = "   ";
const ROW_GAP = 2;
const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const SYMBOLS: Record<string, string> = { ctx: "≡", "5h": "◷", "7d": "▦" };
const DROP_STEPS = [[], ["7d"], ["7d", "5h"]];
const NO_METERS: MeterLayout = { meters: [], withBars: false, shortensPath: false };

type Meter = { label: string; symbol: string; percent: number; reset: string | null };

export function metersOf(usage: UsageSnap, nowMs: number): Meter[] {
  return [
    ...(usage.context === null ? [] : [{ label: "ctx", percent: usage.context }]),
    ...usage.limits,
  ].map((meter) => ({
    label: meter.label,
    symbol: SYMBOLS[meter.label] ?? meter.label,
    percent: Math.max(0, Math.min(100, Math.round(meter.percent))),
    reset: "resetsAt" in meter ? resetIn(meter.resetsAt, nowMs) : null,
  }));
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
  openModelPicker: () => void,
): RenderElement {
  const { Box, Button, Text } = ui;
  const columns = totalColumns - PANE_TOGGLE_COLUMNS;
  const lead = [
    { key: MODEL_CHIP_KEY, label: shortModel(model) },
    { key: EFFORT_CHIP_KEY, label: effort },
  ].filter((chip): chip is { key: string; label: string } => !!chip.label);
  const leadWidth = lead.reduce((width, { label }) => width + label.length + CHIP_PADDING, 0);
  const path = tildePath(cwd, home);
  const layout = fittingLayout(meters, columns - leadWidth - CHIP_PADDING, path.length);
  const room = Math.max(columns - leadWidth - CHIP_PADDING - rightWidth(layout), MIN_PATH_COLUMNS);
  const { background, text } = chipColors(colorName);
  return (
    <Box
      width={totalColumns}
      paddingRight={PANE_TOGGLE_COLUMNS}
      justifyContent="space-between"
      alignItems="flex-end"
    >
      <Box flexDirection="row" flexShrink={1} overflow="hidden">
        {lead.map(({ key, label }) => (
          <Box key={key} flexShrink={0} backgroundColor={background}>
            <Button key={key} label={` ${label} `} plain dimColor onPress={openModelPicker} />
          </Box>
        ))}
        <Text
          wrap="truncate-end"
          color={text}
          backgroundColor={background}
        >{` ${shortenPath(path, room)} `}</Text>
      </Box>
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
            <Text bold color={accent}>{`${meter.percent}%`}</Text>
          </Text>
        ))}
      </Text>
      {withBars ? (
        <Text wrap="truncate-end">
          {meters.map((meter, index) => (
            <Text key={meter.label}>
              {index === 0 ? "" : COLUMN_GAP}
              <Text color={accent}>{barOf(meter.percent, topTextOf(meter).length)}</Text>
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

function barOf(percent: number, cells: number): string {
  const filled = Math.round((percent / PERCENT_SCALE) * cells);
  return FILLED_CELL.repeat(filled) + EMPTY_CELL.repeat(cells - filled);
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
    { meters, withBars: false, shortensPath: false },
    ...DROP_STEPS.map((dropped) => ({
      meters: meters.filter((meter) => !dropped.includes(meter.label)),
      withBars: false,
      shortensPath: true,
    })),
  ];
}

function rightWidth(layout: MeterLayout): number {
  return layout.meters.length === 0 ? 0 : ROW_GAP + metersWidth(layout);
}

function metersWidth({ meters }: MeterLayout): number {
  const widths = meters.map((meter) => topTextOf(meter).length);
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
