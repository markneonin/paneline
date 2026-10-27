import type { ElementTable, RenderElement } from "claude-code";

import type { Activity, CallRecord, RunningCall } from "../types";
import { headerWithClear } from "./clear-kit";
import { formatDuration } from "./format";
import {
  button,
  header,
  labelButton,
  paneRow,
  paneHeaderLook,
  plural,
  statusDot,
} from "./pane-kit";
import { paneInk } from "./pane-ink";
import { relativePath } from "./paths";
import { clipEnd, clipStart } from "./text-width";
import { isPathTool, kindOf, TOOL_KINDS } from "./tools";
import type { ToolKind } from "./tools";

type Ui = ElementTable;

export type ActivityView = {
  activity: Activity[];
  calls: CallRecord[];
  running: RunningCall[];
  totalMs: number;
  cwd: string;
  width: number;
  openCallId: string | null;
  openCall: (id: string) => void;
  closeCall: () => void;
  isLightTheme: boolean;
  clear: () => void;
};

type Row = { key: string; call: CallRecord };

const TIMELINE_LIMIT = 15;
const FAILED_LIMIT = 5;
const MIN_TOOL_CELLS = 6;
const MAX_TOOL_CELLS = 16;
const SPAN_CELLS = 6;
const ROW_GAPS = 3;
const DOT_CELLS = 1;

export function activityTab(ui: Ui, view: ActivityView): RenderElement {
  const open = view.calls.find((call) => call.id === view.openCallId);
  return open ? callDetails(ui, open, view) : activityList(ui, view);
}

function activityList(ui: Ui, view: ActivityView): RenderElement {
  const { Box } = ui;
  const newestFirst = [...view.calls].reverse();
  const timeline = newestFirst
    .slice(0, TIMELINE_LIMIT)
    .map((call) => ({ key: `call-${call.id}`, call }));
  const failed = newestFirst
    .filter((call) => call.isErrored)
    .slice(0, FAILED_LIMIT)
    .map((call) => ({ key: `failed-${call.id}`, call }));
  const toolCells = toolCellsOf([...timeline, ...failed]);
  return (
    <Box flexDirection="column">
      {chipLine(ui, view)}
      <Box height={1} />
      {nowHeader(ui, view)}
      {nowRow(ui, view)}
      <Box height={1} />
      {header(ui, "Tool mix", paneHeaderLook(), view.width)}
      {mixBar(ui, view)}
      {mixLegend(ui, view)}
      <Box height={1} />
      {header(ui, "Timeline", paneHeaderLook(), view.width)}
      {timeline.length === 0
        ? emptyLine(ui, "no calls yet")
        : timeline.map((row) => callRow(ui, row, view, toolCells))}
      {failed.length === 0 ? null : <Box height={1} />}
      {failed.length === 0 ? null : header(ui, "Failed", paneHeaderLook(), view.width)}
      {failed.map((row) => callRow(ui, row, view, toolCells))}
    </Box>
  );
}

function nowHeader(ui: Ui, view: ActivityView): RenderElement {
  const hasHistory = view.calls.length > 0 || view.activity.length > 0;
  return hasHistory
    ? headerWithClear(ui, "Now", view.width, view.clear)
    : header(ui, "Now", paneHeaderLook(), view.width);
}

function chipLine({ Text }: Ui, view: ActivityView): RenderElement {
  const files = new Set(
    view.activity
      .filter((entry) => isPathTool(entry.tool) && entry.target !== "")
      .map((entry) => entry.target),
  ).size;
  const added = view.activity.reduce((sum, entry) => sum + entry.added, 0);
  const removed = view.activity.reduce((sum, entry) => sum + entry.removed, 0);
  const errors = view.activity.filter((entry) => entry.isErrored).length;
  const chips = [
    { text: formatDuration(view.totalMs), color: paneInk().text },
    {
      text: `${view.activity.length} ${plural("tool", view.activity.length)}`,
      color: paneInk().text,
    },
    { text: `${files} ${plural("file", files)}`, color: paneInk().text },
    { text: `+${added}`, color: paneInk().ok },
    { text: `−${removed}`, color: paneInk().failed },
    {
      text: `${errors} ${plural("error", errors)}`,
      color: errors > 0 ? paneInk().failed : paneInk().muted,
    },
  ];
  return (
    <Text wrap="truncate-end">
      {chips.map((chip, i) => (
        <Text key={chip.text} wrap="truncate-end">
          <Text color={paneInk().muted} wrap="truncate-end">
            {i === 0 ? "" : " · "}
          </Text>
          <Text color={chip.color} wrap="truncate-end">
            {chip.text}
          </Text>
        </Text>
      ))}
    </Text>
  );
}

function nowRow(ui: Ui, view: ActivityView): RenderElement {
  const [running] = view.running;
  if (!running) return emptyLine(ui, "idle");
  return paneRow(ui, {
    dot: statusDot("running"),
    label: { text: running.tool, color: paneInk().tool, bold: true },
    middle: { text: running.target, color: paneInk().text },
    middleWrap: isPathTool(running.tool) ? "truncate-start" : "truncate-end",
    width: view.width,
  });
}

function usedMixCounts(view: ActivityView): { name: ToolKind; color: string; count: number }[] {
  const counts = TOOL_KINDS.map((name) => ({
    name,
    color: paneInk().mix[name],
    count: view.activity.filter((entry) => kindOf(entry.tool) === name).length,
  }));
  return counts.filter((part) => part.count > 0);
}

function mixBar({ Text }: Ui, view: ActivityView): RenderElement {
  const counts = usedMixCounts(view);
  const total = view.activity.length;
  let drawn = 0;
  let cumulative = 0;
  const segments = counts.map((part) => {
    cumulative += part.count;
    const edge = Math.round((cumulative / total) * view.width);
    const cells = edge - drawn;
    drawn = edge;
    return { ...part, cells };
  });
  return (
    <Text wrap="truncate-end">
      {total === 0 ? (
        <Text color={paneInk().meterEmpty} wrap="truncate-end">
          {"▱".repeat(view.width)}
        </Text>
      ) : (
        segments.map((part) => (
          <Text key={part.name} color={part.color} wrap="truncate-end">
            {"█".repeat(part.cells)}
          </Text>
        ))
      )}
    </Text>
  );
}

function mixLegend({ Text }: Ui, view: ActivityView): RenderElement {
  const counts = usedMixCounts(view);
  return (
    <Text wrap="truncate-end">
      {counts.length === 0 ? (
        <Text color={paneInk().muted} wrap="truncate-end">
          nothing run yet
        </Text>
      ) : (
        counts.map((part) => (
          <Text key={part.name} wrap="truncate-end">
            <Text color={part.color} wrap="truncate-end">
              {"● "}
            </Text>
            <Text color={paneInk().muted} wrap="truncate-end">{`${part.name} `}</Text>
            <Text color={paneInk().text} wrap="truncate-end">{`${part.count}  `}</Text>
          </Text>
        ))
      )}
    </Text>
  );
}

function toolCellsOf(rows: Row[]): number {
  const longest = Math.max(...rows.map((row) => row.call.tool.length));
  return Math.min(MAX_TOOL_CELLS, Math.max(MIN_TOOL_CELLS, longest));
}

function callRow(ui: Ui, { key, call }: Row, view: ActivityView, toolCells: number): RenderElement {
  const { Box, Text } = ui;
  const dot = statusDot(call.isErrored ? "failed" : "done");
  const fixedCells = DOT_CELLS + toolCells + SPAN_CELLS + ROW_GAPS;
  const label = shownTarget(call, view.cwd, Math.max(1, view.width - fixedCells));
  return (
    <Box key={key} flexDirection="row" width={view.width} height={1} columnGap={1}>
      <Text color={dot.color} wrap="truncate-end">
        {dot.text}
      </Text>
      <Box width={toolCells} flexShrink={0}>
        <Text color={call.isErrored ? paneInk().failed : paneInk().tool} wrap="truncate-end">
          {clipEnd(call.tool, toolCells)}
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {labelButton(ui, {
          key,
          label,
          onPress: () => view.openCall(call.id),
        })}
      </Box>
      <Box width={SPAN_CELLS} flexShrink={0} justifyContent="flex-end">
        <Text color={paneInk().muted} wrap="truncate-end">
          {formatDuration(call.ms)}
        </Text>
      </Box>
    </Box>
  );
}

function callDetails(ui: Ui, call: CallRecord, view: ActivityView): RenderElement {
  const { Box, Text } = ui;
  const dot = statusDot(call.isErrored ? "failed" : "done");
  return (
    <Box flexDirection="column" width={view.width}>
      <Box flexDirection="row" columnGap={1} height={1}>
        {button(ui, { key: "back", label: "back", onPress: view.closeCall })}
        <Text color={dot.color} wrap="truncate-end">
          {dot.text}
        </Text>
        <Text weight="semibold" color={paneInk().tool} wrap="truncate-end">
          {call.tool}
        </Text>
        <Text color={paneInk().muted} wrap="truncate-end">
          {formatDuration(call.ms)}
        </Text>
      </Box>
      {header(ui, "Input", paneHeaderLook(), view.width)}
      {textLines(ui, call.input, "input")}
      {header(ui, "Output", paneHeaderLook(), view.width)}
      {call.output === "" ? emptyLine(ui, "no output") : textLines(ui, call.output, "output")}
    </Box>
  );
}

function textLines({ Text }: Ui, text: string, key: string): RenderElement[] {
  return text.split("\n").map((line, i) => (
    <Text key={`${key}${i}`} color={paneInk().text}>
      {line === "" ? " " : line}
    </Text>
  ));
}

function emptyLine({ Text }: Ui, text: string): RenderElement {
  return (
    <Text color={paneInk().muted} wrap="truncate-end">
      {text}
    </Text>
  );
}

function shownTarget(call: CallRecord, cwd: string, cells: number): string {
  const shown = isPathTool(call.tool) ? relativePath(call.target, cwd) : call.target;
  return isPathTool(call.tool) ? clipStart(shown, cells) : clipEnd(shown, cells);
}
