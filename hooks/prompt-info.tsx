import type { ElementTable, RenderElement } from "claude-code";

import type { AgentStatus, PromptInfo, UsageSnap } from "../types";
import { formatAge, shortModel } from "./format";
import { statusDot } from "./pane-kit";
import { paneInk } from "./pane-ink";
import { themeFills } from "./palette";
import type { Fills } from "./palette";
import { tildePath } from "./paths";
import { resolvedAccent } from "./reply-look";
import { accentOf, chipColors } from "./session-color";
import type { SessionStatus } from "./session-status";

const MAX_TOOL_LABEL = 12;
const MIN_PATH_COLUMNS = 8;
const MIN_PATH_COLUMNS_BEFORE_DROP = 12;
const CHIP_PADDING = 2;
const PANE_TOGGLE_COLUMNS = 5;
const PERCENT_SCALE = 100;
const FILLED_CELL = "▰";
const EMPTY_CELL = "▱";
const COLUMN_GAP = "   ";
type StatusMark = { text: string; color: string | undefined };
const ROW_GAP = 2;
const DOT_STATUS: Record<Exclude<SessionStatus["word"], "idle">, AgentStatus> = {
  thinking: "running",
  working: "running",
  waiting: "waiting",
};
const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MS_PER_HOUR = MINUTES_PER_HOUR * MS_PER_MINUTE;
const WINDOW_MS: Partial<Record<string, number>> = {
  "5h": 5 * MS_PER_HOUR,
  "7d": 7 * HOURS_PER_DAY * MS_PER_HOUR,
};
const TASK_SYMBOL = "◆";
const TASK_BAR_CELLS = 5;
const TASK_COLUMN_WIDTH = `${TASK_SYMBOL} ${PERCENT_SCALE}%`.length;
const SYMBOLS: Record<string, string> = { task: TASK_SYMBOL, ctx: "≡", "5h": "◷", "7d": "▦" };
const DROP_STEPS = [[], ["7d"], ["7d", "5h"]];
const NO_METERS: MeterLayout = {
  meters: [],
  withBars: false,
  shortensPath: false,
  markOnTop: false,
};

export type Progress = {
  tasks: Record<string, { status: "pending" | "in_progress" | "completed"; title: string }>;
  percent: number | null;
};
type Meter = {
  label: string;
  symbol: string;
  percent: number;
  reset: string | null;
  ahead: boolean;
};

export function metersOf(usage: UsageSnap, nowMs: number, progress: Progress): Meter[] {
  return [
    ...taskMeters(progress),
    ...[
      ...(usage.context === null ? [] : [{ label: "ctx", percent: usage.context }]),
      ...usage.limits,
    ].map((meter) => {
      const resetsAt = "resetsAt" in meter ? meter.resetsAt : undefined;
      const percent = hasPassed(resetsAt, nowMs) ? 0 : clampedPercent(meter.percent);
      return {
        label: meter.label,
        symbol: SYMBOLS[meter.label] ?? meter.label,
        percent,
        reset: resetIn(resetsAt, nowMs),
        ahead: paceOf(meter.label, percent, resetsAt, nowMs),
      };
    }),
  ];
}

function taskMeters({ tasks, percent }: Progress): Meter[] {
  const statuses = Object.values(tasks).map((task) => task.status);
  const done = statuses.filter((status) => status === "completed").length;
  const value = statuses.length > 0 ? (done / statuses.length) * PERCENT_SCALE : percent;
  if (value === null) return [];
  return [
    {
      label: "task",
      symbol: TASK_SYMBOL,
      percent: clampedPercent(value),
      reset: null,
      ahead: false,
    },
  ];
}

function clampedPercent(percent: number): number {
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function paceOf(
  label: string,
  percent: number,
  resetsAt: string | undefined,
  nowMs: number,
): boolean {
  const windowMs = WINDOW_MS[label];
  if (windowMs === undefined || resetsAt === undefined) return false;
  const elapsed = Math.min(1, Math.max(0, (nowMs - (Date.parse(resetsAt) - windowMs)) / windowMs));
  return percent > elapsed * PERCENT_SCALE;
}

function hasPassed(resetsAt: string | undefined, nowMs: number): boolean {
  return resetsAt !== undefined && Date.parse(resetsAt) < nowMs;
}

function resetIn(resetsAt: string | undefined, nowMs: number): string | null {
  if (resetsAt === undefined) return null;
  const remainingMs = Date.parse(resetsAt) - nowMs;
  if (Number.isNaN(remainingMs) || remainingMs < 0) return null;
  return formatAge(remainingMs);
}

type MeterLayout = {
  meters: Meter[];
  withBars: boolean;
  shortensPath: boolean;
  markOnTop: boolean;
};

export function promptInfoRow(
  ui: ElementTable,
  { model, effort, cwd }: PromptInfo,
  home: string | undefined,
  totalColumns: number,
  colorName: string,
  meters: Meter[],
  status: SessionStatus,
  fills: Fills = themeFills,
): RenderElement {
  const { Box, Text } = ui;
  const mark = statusMark(status);
  const columns = totalColumns - PANE_TOGGLE_COLUMNS;
  const lead = [shortModel(model), effort].filter((label): label is string => !!label);
  const leadWidth = lead.reduce((width, label) => width + label.length + CHIP_PADDING, 0);
  const path = tildePath(cwd, home);
  const roomForPathAndMeters = columns - leadWidth - CHIP_PADDING;
  const layout = fittingLayout(meters, roomForPathAndMeters, path.length, mark.text.length);
  const room = Math.max(
    roomForPathAndMeters - leftMarkCells(layout, mark.text.length) - rightWidth(layout),
    MIN_PATH_COLUMNS,
  );
  const accent = resolvedAccent(accentOf(colorName), fills);
  const chip = chipColors(colorName);
  const text = chip.background === undefined ? accent : chip.text;
  const labels = [...lead, shortenPath(path, room)];
  const chips = labels.map((label) => (
    <Text key={label} color={text} backgroundColor={chip.background}>{` ${label} `}</Text>
  ));
  const markText = <Text color={mark.color}>{mark.text}</Text>;
  return (
    <Box
      width={totalColumns}
      paddingRight={PANE_TOGGLE_COLUMNS}
      justifyContent="space-between"
      alignItems="flex-end"
    >
      {layout.markOnTop ? (
        <Box flexDirection="column" flexShrink={1} minWidth={0}>
          <Text wrap="truncate-end">{markText}</Text>
          <Text wrap="truncate-end">{chips}</Text>
        </Box>
      ) : (
        <Text wrap="truncate-end">
          {chips}
          {markText}
        </Text>
      )}
      {layout.meters.length === 0 ? null : meterText(ui, layout, accent, fills.alert)}
    </Box>
  );
}

function statusMark({ word, tool }: SessionStatus): StatusMark {
  if (word === "idle") return { text: "", color: undefined };
  const dot = statusDot(DOT_STATUS[word]);
  const label = tool === undefined ? word : `${word} ${shortToolName(tool)}`;
  return { text: ` ${dot.text} ${label}`, color: word === "waiting" ? paneInk().alert : dot.color };
}

function shortToolName(tool: string): string {
  return (tool.split("__").pop() ?? tool).slice(0, MAX_TOOL_LABEL);
}

function meterText(
  { Box, Text }: ElementTable,
  { meters, withBars }: MeterLayout,
  accent: string,
  alert: string,
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
            <Text
              weight="semibold"
              color={meter.ahead ? alert : accent}
            >{`${meter.percent}%${trailingOf(meter)}`}</Text>
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
  const bar = FILLED_CELL.repeat(filled) + EMPTY_CELL.repeat(cells - filled);
  return bar.padEnd(columnWidthOf(meter));
}

function fittingLayout(
  meters: Meter[],
  roomForPathAndMeters: number,
  pathLength: number,
  markLength: number,
): MeterLayout {
  const layouts = layoutsOf(meters, markLength > 0);
  const fitting = layouts.find((layout) => {
    const needed = layout.shortensPath
      ? Math.min(pathLength, MIN_PATH_COLUMNS_BEFORE_DROP)
      : pathLength;
    return roomForPathAndMeters - leftMarkCells(layout, markLength) - rightWidth(layout) >= needed;
  });
  return fitting ?? layouts.at(-1) ?? NO_METERS;
}

function layoutsOf(meters: Meter[], hasMark: boolean): MeterLayout[] {
  if (meters.length === 0) return [];
  const bare = meters.map((meter) => ({ ...meter, reset: null }));
  return [
    { meters, withBars: true, shortensPath: false, markOnTop: false },
    { meters, withBars: true, shortensPath: true, markOnTop: false },
    ...(hasMark ? [{ meters, withBars: true, shortensPath: true, markOnTop: true }] : []),
    ...DROP_STEPS.map((dropped) => ({
      meters: bare.filter((meter) => !dropped.includes(meter.label)),
      withBars: true,
      shortensPath: true,
      markOnTop: hasMark,
    })),
  ];
}

function leftMarkCells({ markOnTop }: MeterLayout, markLength: number): number {
  return markOnTop ? 0 : markLength;
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
