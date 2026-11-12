import type { ElementTable, RenderElement } from "claude-code";

import type {
  Activity,
  AgentStatus,
  CallBody,
  CallCounts,
  CallDetail,
  CallRecord,
  RunningCall,
} from "../types";
import { TEXT_COLUMN } from "./chat-draw";
import { isDenied, isFailure, NO_CALL_COUNTS, totalOf, withCalls } from "./activity-calls";
import { UNMEASURED_MS } from "./activity-track";
import type { WaitingCall } from "./activity-track";
import { headerWithClear } from "./clear-kit";
import { DENIED_GLYPH, paneDiffPanel } from "./diff-panel";
import { clockOf, formatDuration, formatSeconds, MS_PER_SECOND, singleLine } from "./format";
import {
  button,
  filterRow,
  header,
  labelButton,
  matchesFilter,
  paneRow,
  paneHeaderLook,
  plural,
  statusDot,
} from "./pane-kit";
import type { Part } from "./pane-kit";
import { paneInk } from "./pane-ink";
import type { Fills } from "./palette";
import { relativePath } from "./paths";
import { replyView } from "./reply-draw";
import { clipEnd, clipStart, displayWidth } from "./text-width";
import { isFailedEdit, isPathTool, kindOf, TOOL_KINDS } from "./tools";
import type { ToolKind } from "./tools";

type Ui = ElementTable;

export type ActivityView = {
  activity: Activity[];
  calls: CallRecord[];
  counts: CallCounts;
  running: RunningCall[];
  totalMs: number;
  waiting: WaitingCall[];
  now: number;
  modelMs: number;
  toolsMs: number;
  youMs: number;
  cwd: string;
  width: number;
  openCallId: string | null;
  openedCall: (CallRecord & CallBody) | undefined;
  isLookedUp: boolean;
  openCall: (id: string) => void;
  closeCall: () => void;
  isLightTheme: boolean;
  clear: () => void;
  rows: number;
  isUnfolded: boolean;
  unfold: () => void;
  fold: () => void;
  isAllowedOpen: boolean;
  toggleAllowed: () => void;
  isFailedOpen: boolean;
  toggleFailed: () => void;
  isMainTurnRunning: boolean;
  fills: Fills;
  home: string | undefined;
  surface: string;
  copy: Parameters<typeof replyView>[2]["copy"];
  filter: string;
  setFilter: (text: string) => void;
  focusFilter: () => void;
};

type Body = { element: RenderElement; hiddenLines: number };

type Tag = { text: string; color: string };

type Row = {
  key: string;
  call: CallRecord;
  count?: string;
  calls?: number;
  isStuck?: boolean;
  reason?: string;
};

type Repeats = { members: CallRecord[]; noun: string };

const TIMELINE_LIMIT = 15;
const FAILED_LIMIT = 5;
const PERMISSION_LIMIT = 8;
const REASON_WIDTH_SHARE = 3;
const REASON_GAP_CELLS = 2;
const STUCK_REPEATS = 3;
const STUCK_TOOLS = new Set(["Bash", "Read"]);
const MIN_TOOL_CELLS = 6;
const MAX_TOOL_CELLS = 16;
const SPAN_CELLS = 6;
const CLOCK_CELLS = 5;
const ROW_GAPS = 4;
const ROW_GAPS_WITHOUT_RIGHT = ROW_GAPS - 1;
const DOT_CELLS = 1;
const DETAIL_CHROME_ROWS = 9;
const MIN_FOLD_LINES = 5;
const TITLE_GAP_CELLS = 1;
const PANEL_INDENT_CELLS = 2;
const KEY_SHARE = 3;
const READ_GUTTER_PADDING = 3;
const SLOW_CALL_MS = 10_000;
const OPEN_GLYPH = "▾";
const FOLDED_GLYPH = "▸";

export function activityTab(ui: Ui, view: ActivityView): RenderElement {
  if (view.openedCall) return callDetails(ui, view.openedCall, view);
  if (view.openCallId !== null) return pendingCallDetails(ui, view.openCallId, view);
  return activityList(ui, view);
}

function activityList(ui: Ui, view: ActivityView): RenderElement {
  const { Box } = ui;
  const newestFirst = [...view.calls]
    .reverse()
    .filter((call) => matchesFilter(view.filter, call.tool, targetText(call, view.cwd)));
  const numbers = numbersView(view, newestFirst);
  const timelineRows = collapseRepeats(newestFirst, "call", stuckRepeatsOf);
  const timeline = timelineRows.slice(0, TIMELINE_LIMIT);
  const olderCount = newestFirst.length - callsOf(timeline);
  const failureRows = collapseRepeats(newestFirst.filter(isFailure), "failed", failRepeatsOf);
  const failed = failureRows.slice(0, FAILED_LIMIT);
  const moreFailed = failureRows.slice(FAILED_LIMIT);
  const permissions = permissionRows(newestFirst);
  const stuck = stuckRows(newestFirst);
  const toolCells = toolCellsOf([
    ...stuck,
    ...timeline,
    ...failed,
    ...(view.isFailedOpen ? moreFailed : []),
    ...permissions,
  ]);
  return (
    <Box flexDirection="column">
      {filterRow(ui, {
        value: view.filter,
        onInput: view.setFilter,
        onFocus: view.focusFilter,
      })}
      <Box height={1} />
      {liveRow(ui, view)}
      {chipLine(ui, numbers)}
      {timeRow(ui, view)}
      <Box height={1} />
      {stuck.length === 0 ? null : header(ui, "Stuck", paneHeaderLook(), view.width)}
      {stuck.map((row) => callRow(ui, row, view, toolCells))}
      {stuck.length === 0 ? null : <Box height={1} />}
      {failedBlock(ui, view, failed, moreFailed, toolCells)}
      {permissionBlock(ui, view, newestFirst, permissions, toolCells)}
      {view.filter !== "" && newestFirst.length === 0 ? null : mixBlock(ui, numbers)}
      {timelineHeader(ui, view, timeline.length > 0)}
      {timeline.length === 0
        ? emptyLine(ui, view.filter === "" ? "no calls yet" : "no matching calls")
        : timeline.map((row) => callRow(ui, row, view, toolCells))}
      {olderCount === 0 ? null : emptyLine(ui, `${olderCount} older`)}
    </Box>
  );
}

function numbersView(view: ActivityView, newestFirst: CallRecord[]): ActivityView {
  if (view.filter === "") return view;
  const shownIds = new Set(newestFirst.map((call) => call.id));
  return {
    ...view,
    counts: withCalls(NO_CALL_COUNTS, newestFirst),
    activity: view.activity.filter((entry) => shownIds.has(entry.id)),
  };
}

function mixBlock(ui: Ui, view: ActivityView): RenderElement {
  const { Box } = ui;
  return (
    <Box key="tool-mix" flexDirection="column">
      {header(ui, "Tool mix", paneHeaderLook(), view.width)}
      {mixBar(ui, view)}
      {mixLegend(ui, view)}
      <Box height={1} />
    </Box>
  );
}

function callsOf(rows: Row[]): number {
  return rows.reduce((sum, row) => sum + (row.calls ?? 1), 0);
}

function collapseRepeats(
  calls: CallRecord[],
  keyPrefix: string,
  repeatsOf: (group: CallRecord[]) => Repeats | undefined,
): Row[] {
  const newestOf = new Map<string, Repeats>();
  const hidden = new Set<string>();
  for (const group of groupCallsByStuckKey(calls)) {
    const repeats = repeatsOf(group);
    const [newest, ...older] = repeats?.members ?? [];
    if (repeats === undefined || newest === undefined) continue;
    newestOf.set(newest.id, repeats);
    for (const call of older) hidden.add(call.id);
  }
  return calls
    .filter((call) => !hidden.has(call.id))
    .map((call) => {
      const key = `${keyPrefix}-${call.id}`;
      const repeats = newestOf.get(call.id);
      if (repeats === undefined) return { key, call };
      const size = repeats.members.length;
      return { key, call, count: `${size} ${plural(repeats.noun, size)}`, calls: size };
    });
}

function failRepeatsOf(failures: CallRecord[]): Repeats | undefined {
  return failures.length > 1 ? { members: failures, noun: "fail" } : undefined;
}

function permissionRows(newestFirst: CallRecord[]): Row[] {
  const rows = newestFirst.flatMap((call) =>
    call.permission === undefined
      ? []
      : [{ key: `permission-${call.id}`, call, reason: call.permission.reason }],
  );
  const denied = rows.filter(isDeniedRow).slice(0, PERMISSION_LIMIT);
  const allowed = rows.filter((row) => !isDeniedRow(row)).slice(0, PERMISSION_LIMIT);
  return [...denied, ...allowed];
}

function failedBlock(
  ui: Ui,
  view: ActivityView,
  rows: Row[],
  moreRows: Row[],
  toolCells: number,
): RenderElement | null {
  if (rows.length === 0) return null;
  const { Box } = ui;
  return (
    <Box key="failed" flexDirection="column">
      {header(ui, "Failed", paneHeaderLook(), view.width)}
      {rows.map((row) => callRow(ui, row, view, toolCells))}
      {moreRows.length === 0
        ? null
        : foldToggle(
            ui,
            "more-failed",
            view.isFailedOpen,
            `${callsOf(moreRows)} more failed`,
            view.toggleFailed,
          )}
      {view.isFailedOpen ? (
        <Box flexDirection="column" paddingLeft={PANEL_INDENT_CELLS}>
          {moreRows.map((row) =>
            callRow(ui, row, { ...view, width: view.width - PANEL_INDENT_CELLS }, toolCells),
          )}
        </Box>
      ) : null}
      <Box height={1} />
    </Box>
  );
}

function isDeniedRow(row: Row): boolean {
  return row.call.permission?.kind === "denied";
}

function permissionBlock(
  ui: Ui,
  view: ActivityView,
  newestFirst: CallRecord[],
  rows: Row[],
  toolCells: number,
): RenderElement | null {
  if (rows.length === 0) return null;
  const { Box } = ui;
  const kinds = newestFirst.flatMap((call) => (call.permission ? [call.permission.kind] : []));
  const denied = kinds.filter((kind) => kind === "denied").length;
  const allowed = kinds.length - denied;
  return (
    <Box key="permissions" flexDirection="column">
      {header(ui, "Permissions", paneHeaderLook(), view.width)}
      {rows.filter(isDeniedRow).map((row) => callRow(ui, row, view, toolCells))}
      {allowed === 0
        ? null
        : foldToggle(
            ui,
            "allowed-toggle",
            view.isAllowedOpen,
            `${allowed} auto-allowed`,
            view.toggleAllowed,
          )}
      {view.isAllowedOpen ? (
        <Box flexDirection="column" paddingLeft={PANEL_INDENT_CELLS}>
          {rows
            .filter((row) => !isDeniedRow(row))
            .map((row) =>
              callRow(ui, row, { ...view, width: view.width - PANEL_INDENT_CELLS }, toolCells),
            )}
        </Box>
      ) : null}
      <Box height={1} />
    </Box>
  );
}

function foldToggle(
  { Button }: Ui,
  key: string,
  isOpen: boolean,
  text: string,
  onPress: () => void,
): RenderElement {
  return (
    <Button
      key={key}
      label={`${isOpen ? OPEN_GLYPH : FOLDED_GLYPH} ${text}`}
      plain
      dimColor
      onPress={onPress}
    />
  );
}

function timelineHeader(ui: Ui, view: ActivityView, hasRows: boolean): RenderElement {
  return hasRows
    ? headerWithClear(ui, "Timeline", view.width, view.clear)
    : header(ui, "Timeline", paneHeaderLook(), view.width);
}

function chipLine({ Text }: Ui, view: ActivityView): RenderElement {
  const tools = totalOf(view.counts);
  const { errors } = view.counts;
  const files = new Set(
    view.activity
      .filter((entry) => isPathTool(entry.tool) && entry.target !== "" && !isFailedEdit(entry))
      .map((entry) => entry.target),
  ).size;
  const added = view.activity.reduce((sum, entry) => sum + entry.added, 0);
  const removed = view.activity.reduce((sum, entry) => sum + entry.removed, 0);
  const chips = [
    { text: formatDuration(view.totalMs), color: paneInk().text, weight: "semibold" as const },
    ...(tools > 0 ? [{ text: `${tools} ${plural("tool", tools)}`, color: paneInk().text }] : []),
    ...(files > 0 ? [{ text: `${files} ${plural("file", files)}`, color: paneInk().text }] : []),
    ...(added + removed > 0
      ? [
          { text: `+${added}`, color: added > 0 ? paneInk().ok : paneInk().muted },
          { text: `−${removed}`, color: removed > 0 ? paneInk().failed : paneInk().muted },
        ]
      : []),
    ...(errors > 0
      ? [{ text: `${errors} ${plural("error", errors)}`, color: paneInk().failed }]
      : []),
  ];
  return (
    <Text wrap="truncate-end">
      {chips.map((chip, i) => (
        <Text key={chip.text} wrap="truncate-end">
          <Text color={paneInk().muted} wrap="truncate-end">
            {i === 0 ? "" : " · "}
          </Text>
          <Text color={chip.color} weight={chip.weight} wrap="truncate-end">
            {chip.text}
          </Text>
        </Text>
      ))}
    </Text>
  );
}

function timeRow({ Text }: Ui, view: ActivityView): RenderElement {
  const parts = [
    { word: "model", ms: view.modelMs, color: paneInk().text },
    { word: "tools", ms: view.toolsMs, color: paneInk().text },
    ...(view.youMs > 0 ? [{ word: "waiting on you", ms: view.youMs, color: paneInk().text }] : []),
  ];
  return (
    <Text wrap="truncate-end">
      {parts.map((part, i) => (
        <Text key={part.word} wrap="truncate-end">
          <Text color={paneInk().muted} wrap="truncate-end">
            {`${i === 0 ? "" : " · "}${part.word} `}
          </Text>
          <Text color={part.color} wrap="truncate-end">
            {formatDuration(part.ms)}
          </Text>
        </Text>
      ))}
    </Text>
  );
}

function liveRow(ui: Ui, view: ActivityView): RenderElement {
  const waitingCall = view.running
    .map((call) => ({ call, wait: view.waiting.find((one) => one.callId === call.callId) }))
    .find((entry) => entry.wait !== undefined);
  const running = waitingCall?.call ?? view.running[0];
  if (!running && !view.isMainTurnRunning) return emptyLine(ui, "idle");
  if (!running) {
    return paneRow(ui, {
      dot: statusDot("running"),
      middle: { text: "thinking", color: paneInk().text },
      middleWrap: "truncate-end",
      width: view.width,
    });
  }
  const since = waitingCall?.wait?.since ?? 0;
  return paneRow(ui, {
    dot: statusDot(waitingCall ? "waiting" : "running"),
    right: waitingCall
      ? {
          text: `waiting ${formatDuration(Math.max(0, view.now - since))}`,
          color: paneInk().alert,
        }
      : elapsedPart(running, view.now),
    label: { text: running.tool, color: paneInk().tool, bold: true },
    middle: { text: running.target, color: paneInk().text },
    middleWrap: isPathTool(running.tool) ? "truncate-start" : "truncate-end",
    width: view.width,
  });
}

function elapsedPart(call: RunningCall, now: number): Part | undefined {
  if (call.startedAt === undefined) return undefined;
  return {
    text: formatSeconds(Math.floor(Math.max(0, now - call.startedAt) / MS_PER_SECOND)),
    color: paneInk().muted,
  };
}

function usedMixCounts(view: ActivityView): { name: ToolKind; color: string; count: number }[] {
  const counts = TOOL_KINDS.map((name) => ({
    name,
    color: paneInk().mix[name],
    count: view.counts.kinds[name] ?? 0,
  }));
  return counts.filter((part) => part.count > 0);
}

function mixBar({ Text }: Ui, view: ActivityView): RenderElement | null {
  const counts = usedMixCounts(view);
  if (counts.length === 1) return null;
  const total = totalOf(view.counts);
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
            {"▰".repeat(part.cells)}
          </Text>
        ))
      )}
    </Text>
  );
}

const LEGEND_GAP = "  ";

function legendLines(counts: { name: ToolKind; color: string; count: number }[], width: number) {
  const lines: (typeof counts)[] = [];
  let used = 0;
  for (const part of counts) {
    const cells = displayWidth(`● ${part.name} ${part.count}`);
    const last = lines[lines.length - 1];
    const fits = last !== undefined && used + LEGEND_GAP.length + cells <= width;
    if (fits) {
      last.push(part);
      used += LEGEND_GAP.length + cells;
    } else {
      lines.push([part]);
      used = cells;
    }
  }
  return lines;
}

function mixLegend({ Box, Text }: Ui, view: ActivityView): RenderElement {
  const counts = usedMixCounts(view);
  if (counts.length === 0)
    return (
      <Text color={paneInk().muted} wrap="truncate-end">
        nothing run yet
      </Text>
    );
  return (
    <Box flexDirection="column">
      {legendLines(counts, view.width).map((line) => (
        <Text key={line[0]?.name} wrap="truncate-end">
          {line.map((part, i) => (
            <Text key={part.name} wrap="truncate-end">
              <Text color={part.color} wrap="truncate-end">
                {`${i === 0 ? "" : LEGEND_GAP}● `}
              </Text>
              <Text color={paneInk().muted} wrap="truncate-end">{`${part.name} `}</Text>
              <Text color={paneInk().text} wrap="truncate-end">{`${part.count}`}</Text>
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}

function stuckRows(newestFirst: CallRecord[]): Row[] {
  return groupCallsByStuckKey(newestFirst).flatMap(stuckRowOf).slice(0, FAILED_LIMIT);
}

function groupCallsByStuckKey(calls: CallRecord[]): CallRecord[][] {
  const groups = new Map<string, CallRecord[]>();
  for (const call of calls) {
    if (!STUCK_TOOLS.has(call.tool) || call.target === "") continue;
    const key = JSON.stringify([call.tool, call.target]);
    groups.set(key, [...(groups.get(key) ?? []), call]);
  }
  return [...groups.values()];
}

function stuckRepeatsOf(calls: CallRecord[]): Repeats | undefined {
  const isRead = calls[0]?.tool === "Read";
  const members = isRead ? calls : calls.filter(isFailure);
  if (members.length < STUCK_REPEATS) return undefined;
  return { members, noun: isRead ? "read" : "fail" };
}

function stuckRowOf(calls: CallRecord[]): Row[] {
  const repeats = stuckRepeatsOf(calls);
  const [latest] = repeats?.members ?? [];
  if (repeats === undefined || latest === undefined) return [];
  const size = repeats.members.length;
  return [
    {
      key: `stuck-${latest.id}`,
      call: latest,
      count: `${size} ${plural(repeats.noun, size)}`,
      isStuck: true,
    },
  ];
}

function toolCellsOf(rows: Row[]): number {
  const longest = Math.max(...rows.map((row) => row.call.tool.length));
  return Math.min(MAX_TOOL_CELLS, Math.max(MIN_TOOL_CELLS, longest));
}

function rowStatus({ call, isStuck }: Row): AgentStatus {
  if (isStuck) return call.tool === "Read" ? "waiting" : "failed";
  return isFailure(call) ? "failed" : "done";
}

export function deniedDot(): Part {
  return { text: DENIED_GLYPH, color: paneInk().alert };
}

function rowDot(row: Row): Part {
  if (!row.isStuck && isDenied(row.call)) return deniedDot();
  return statusDot(rowStatus(row));
}

function fixedRightCells(count: string | undefined): number {
  return count === undefined ? SPAN_CELLS : Math.max(SPAN_CELLS, count.length);
}

function reasonCapOf(width: number): number {
  return Math.floor(width / REASON_WIDTH_SHARE);
}

function leftoverReasonCells(reason: string, width: number, restCells: number): number {
  const reasonRoom = restCells - REASON_GAP_CELLS;
  if (reasonRoom < MIN_INLINE_REASON_CELLS) return 0;
  return Math.min(displayWidth(reason), reasonCapOf(width), reasonRoom) + REASON_GAP_CELLS;
}

export function clampCells(textCells: number, roomCells: number): number {
  return Math.max(1, Math.min(textCells, roomCells));
}

function rowCellsOf(
  row: Row,
  shown: string,
  width: number,
  toolCells: number,
): { targetCells: number; rightCells: number } {
  const labelRoom = width - CLOCK_CELLS - DOT_CELLS - toolCells;
  if (row.reason === undefined) {
    const rightCells = fixedRightCells(row.count);
    const targetCells = clampCells(displayWidth(shown), labelRoom - ROW_GAPS - rightCells);
    return { targetCells, rightCells };
  }
  const shownCells = displayWidth(shown);
  if (displayWidth(row.reason) > reasonCapOf(width)) {
    const targetCells = clampCells(shownCells, labelRoom - ROW_GAPS_WITHOUT_RIGHT);
    const rightCells = leftoverReasonCells(row.reason, width, labelRoom - ROW_GAPS - targetCells);
    return { targetCells, rightCells };
  }
  const reasonCells = displayWidth(row.reason) + REASON_GAP_CELLS;
  const targetRoom = labelRoom - ROW_GAPS - reasonCells;
  if (targetRoom < Math.min(MIN_INLINE_TEXT_CELLS, shownCells)) {
    return {
      targetCells: clampCells(shownCells, labelRoom - ROW_GAPS_WITHOUT_RIGHT),
      rightCells: 0,
    };
  }
  return { targetCells: clampCells(shownCells, targetRoom), rightCells: reasonCells };
}

function rowGapCells(rightCells: number): number {
  return rightCells === 0 ? ROW_GAPS_WITHOUT_RIGHT : ROW_GAPS;
}

function mainReasonOf({ call }: Row): string | undefined {
  return isDenied(call) ? call.permission?.reason : call.reason;
}

function fallbackReasonOf({ call }: Row): string | undefined {
  return isDenied(call) ? undefined : call.fallbackReason;
}

function inlineTextOf(row: Row, cells: number): string | undefined {
  const text = mainReasonOf(row);
  if (text === row.reason) return undefined;
  return [text, fallbackReasonOf(row)].find(
    (candidate) => candidate !== undefined && displayWidth(candidate) <= cells,
  );
}

function rowLayoutOf(row: Row, shown: string, width: number, toolCells: number) {
  const { targetCells, rightCells } = rowCellsOf(row, shown, width, toolCells);
  const flexibleCells =
    width - CLOCK_CELLS - DOT_CELLS - toolCells - rowGapCells(rightCells) - rightCells;
  return { targetCells, rightCells, flexibleCells };
}

function callRow(ui: Ui, row: Row, view: ActivityView, toolCells: number): RenderElement {
  const { Box, Text } = ui;
  const { key, call, count, reason } = row;
  const dot = rowDot(row);
  const shown = targetText(call, view.cwd);
  const layout = rowLayoutOf(row, shown, view.width, toolCells);
  const { rightCells, flexibleCells } = layout;
  const label = shownTarget(call, shown, layout.targetCells);
  const inlineCells = flexibleCells - displayWidth(label) - INLINE_REASON_SEPARATOR_CELLS;
  const inlineText = inlineTextOf(row, inlineCells);
  const isSlow = reason === undefined && count === undefined && call.ms >= SLOW_CALL_MS;
  return (
    <Box key={key} flexDirection="row" width={view.width} height={1} columnGap={1}>
      <Box width={CLOCK_CELLS} flexShrink={0}>
        <Text color={paneInk().muted} wrap="truncate-end">
          {call.startedAt === undefined ? " ".repeat(CLOCK_CELLS) : clockOf(call.startedAt)}
        </Text>
      </Box>
      <Text color={dot.color} wrap="truncate-end">
        {dot.text}
      </Text>
      <Box width={toolCells} flexShrink={0}>
        <Text color={paneInk().tool} wrap="truncate-end">
          {clipEnd(call.tool, toolCells)}
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {labelButton(ui, {
          key,
          label,
          onPress: () => view.openCall(call.id),
        })}
        {inlineText === undefined ? null : (
          <Box width={inlineCells + INLINE_REASON_SEPARATOR_CELLS} flexShrink={0}>
            <Text color={paneInk().muted} wrap="truncate-end">
              {` · ${inlineText}`}
            </Text>
          </Box>
        )}
      </Box>
      {rightCells === 0 ? null : (
        <Box width={rightCells} flexShrink={0} justifyContent="flex-end">
          <Text
            color={paneInk().muted}
            weight={isSlow ? "semibold" : undefined}
            wrap="truncate-end"
          >
            {reason ?? count ?? formatDuration(call.ms)}
          </Text>
        </Box>
      )}
    </Box>
  );
}

function callDetails(ui: Ui, call: CallRecord & CallBody, view: ActivityView): RenderElement {
  const { Box, Text } = ui;
  const denial = call.permission?.kind === "denied" ? call.permission : undefined;
  const chromeRows = DETAIL_CHROME_ROWS + (denial === undefined ? 0 : 1);
  const maxLines = view.isUnfolded
    ? Number.POSITIVE_INFINITY
    : Math.max(MIN_FOLD_LINES, view.rows - chromeRows);
  const body = detailBody(ui, call, view, maxLines);
  return (
    <Box flexDirection="column" width={view.width}>
      {backRow(ui, view, call)}
      {denial === undefined ? null : (
        <Text key="permission" color={paneInk().muted} wrap="truncate-end">
          {`${denial.kind} · ${denial.reason}`}
        </Text>
      )}
      <Box height={1} />
      {body.element}
      {foldButton(ui, body.hiddenLines, view)}
    </Box>
  );
}

function backRow(ui: Ui, view: ActivityView, call: CallRecord): RenderElement {
  const { Box, Text } = ui;
  const dot = callDot(call);
  const shown = view.calls.filter((other) =>
    matchesFilter(view.filter, other.tool, targetText(other, view.cwd)),
  );
  const at = shown.findIndex((other) => other.id === call.id);
  const older = at > 0 ? shown[at - 1] : undefined;
  const newer = at >= 0 ? shown[at + 1] : undefined;
  return (
    <Box flexDirection="row" columnGap={1} height={1}>
      {button(ui, { key: "back", label: "back", onPress: view.closeCall })}
      <Text color={dot.color} wrap="truncate-end">
        {dot.text}
      </Text>
      <Box flexShrink={1}>
        <Text weight="semibold" color={paneInk().tool} wrap="truncate-end">
          {call.tool}
        </Text>
      </Box>
      {call.ms === UNMEASURED_MS ? null : (
        <Box flexShrink={0}>
          <Text color={paneInk().muted}>{formatDuration(call.ms)}</Text>
        </Box>
      )}
      {call.startedAt === undefined ? null : (
        <Box flexShrink={0}>
          <Text color={paneInk().muted}>{clockOf(call.startedAt)}</Text>
        </Box>
      )}
      <Box flexGrow={1} />
      {newer === undefined
        ? null
        : button(ui, { key: "newer", label: "newer", onPress: () => view.openCall(newer.id) })}
      {older === undefined
        ? null
        : button(ui, { key: "older", label: "older", onPress: () => view.openCall(older.id) })}
    </Box>
  );
}

function pendingNote(isRunning: boolean, isLookedUp: boolean): string {
  if (isRunning) return "running";
  return isLookedUp ? "no longer in the session" : "loading";
}

function callDot(call: CallRecord): Part {
  return isDenied(call) ? deniedDot() : statusDot(isFailure(call) ? "failed" : "done");
}

function pendingCallDetails(ui: Ui, callId: string, view: ActivityView): RenderElement {
  const { Box, Text } = ui;
  const running = view.running.find((call) => call.callId === callId);
  const kept = view.calls.find((call) => call.id === callId);
  const known = running ?? kept;
  const dot =
    kept === undefined ? statusDot(running === undefined ? "done" : "running") : callDot(kept);
  const denial = kept?.permission?.kind === "denied" ? kept.permission : undefined;
  return (
    <Box flexDirection="column" width={view.width}>
      <Box flexDirection="row" columnGap={1} height={1}>
        {button(ui, { key: "back", label: "back", onPress: view.closeCall })}
        <Text color={dot.color} wrap="truncate-end">
          {dot.text}
        </Text>
        <Text weight="semibold" color={paneInk().tool} wrap="truncate-end">
          {known?.tool ?? ""}
        </Text>
        {kept === undefined || kept.ms === UNMEASURED_MS ? null : (
          <Text color={paneInk().muted} wrap="truncate-end">
            {formatDuration(kept.ms)}
          </Text>
        )}
        {kept?.startedAt === undefined ? null : (
          <Text color={paneInk().muted} wrap="truncate-end">
            {clockOf(kept.startedAt)}
          </Text>
        )}
        <Text color={paneInk().muted} wrap="truncate-end">
          {pendingNote(running !== undefined, view.isLookedUp)}
        </Text>
      </Box>
      {denial === undefined ? null : (
        <Text key="permission" color={paneInk().muted} wrap="truncate-end">
          {`${denial.kind} · ${denial.reason}`}
        </Text>
      )}
      {denial === undefined ? null : <Box height={1} />}
      {known === undefined ? null : (
        <Text color={paneInk().muted} wrap="truncate-end">
          {known.target}
        </Text>
      )}
    </Box>
  );
}

function detailBody(
  ui: Ui,
  call: CallRecord & CallBody,
  view: ActivityView,
  maxLines: number,
): Body {
  const { detail } = call;
  if (detail?.kind === "bash") return bashBody(ui, call, detail, view, maxLines);
  if (detail?.kind === "change") return changeBody(ui, call, detail, view, maxLines);
  if (detail?.kind === "read") return readBody(ui, detail, view, maxLines);
  return markdownBody(ui, call, view, maxLines);
}

function bashBody(
  ui: Ui,
  call: CallRecord & CallBody,
  detail: Extract<CallDetail, { kind: "bash" }>,
  view: ActivityView,
  maxLines: number,
): Body {
  const { Box, Code, Text } = ui;
  const tag = isDenied(call) ? { text: "denied", color: paneInk().alert } : bashTag(detail);
  const commandLines = detail.command.replace(/\n+$/, "").split("\n");
  const titleCells = Math.max(1, view.width - TITLE_GAP_CELLS - displayWidth(tag.text));
  const isMultiLine = commandLines.length > 1;
  const firstLine = isMultiLine ? `${singleLine(detail.command)}…` : singleLine(detail.command);
  const isWholeShown = isMultiLine || displayWidth(firstLine) > titleCells;
  const stdoutLines = detail.stdout === "" ? [] : detail.stdout.split("\n");
  const stderrLines = detail.stderr === "" ? [] : detail.stderr.split("\n");
  const bodyCells = Math.max(1, view.width - PANEL_INDENT_CELLS);
  const cut = cutGroups(
    [
      { lines: isWholeShown ? commandLines : [], cells: Number.POSITIVE_INFINITY },
      { lines: stdoutLines, cells: bodyCells },
      { lines: stderrLines, cells: bodyCells },
    ],
    maxLines,
  );
  const [shownCommand = [], shownStdout = [], shownStderr = []] = cut.shown;
  const hasOutput = stdoutLines.length + stderrLines.length > 0;
  const body = (
    <Box flexDirection="column">
      {shownCommand.length === 0 ? null : (
        <Box key="command" flexDirection="column" paddingLeft={PANEL_INDENT_CELLS}>
          <Code language="bash" source={shownCommand.join("\n")} />
          <Text> </Text>
        </Box>
      )}
      {header(ui, "Output", paneHeaderLook(), view.width)}
      <Box flexDirection="column" paddingLeft={PANEL_INDENT_CELLS}>
        {textLines(ui, shownStdout, "stdout", paneInk().text)}
        {stderrLines.length === 0 || isFailedRun(detail) ? null : (
          <Text key="stderr-label" color={paneInk().muted}>
            stderr
          </Text>
        )}
        {textLines(ui, shownStderr, "stderr", isDenied(call) ? paneInk().text : paneInk().failed)}
        {hasOutput ? null : emptyLine(ui, "no output")}
        {detail.droppedLines > 0 && cut.hiddenLines === 0
          ? emptyLine(
              ui,
              `… ${detail.droppedLines} more ${plural("line", detail.droppedLines)} not kept`,
            )
          : null}
      </Box>
    </Box>
  );
  const title = (
    <Text weight="semibold" color={paneInk().text}>
      {clipEnd(firstLine, titleCells)}
    </Text>
  );
  return {
    element: titledBody(ui, {
      key: `detail-${call.id}`,
      width: view.width,
      title,
      right: [tagText(ui, tag)],
      body,
    }),
    hiddenLines: cut.hiddenLines,
  };
}

function titledBody(
  { Box, Text }: Ui,
  spec: {
    key: string;
    width: number;
    title: RenderElement;
    right: RenderElement[];
    body: RenderElement;
  },
): RenderElement {
  return (
    <Box key={spec.key} flexDirection="column" width={spec.width}>
      <Box flexDirection="row" width={spec.width}>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text wrap="truncate-start">{spec.title}</Text>
        </Box>
        {spec.right.length === 0 ? null : (
          <Box flexShrink={0} columnGap={2} paddingLeft={TITLE_GAP_CELLS}>
            {spec.right}
          </Box>
        )}
      </Box>
      <Box flexDirection="column" paddingTop={1}>
        {spec.body}
      </Box>
    </Box>
  );
}

function isFailedRun({ exitCode, tag }: Extract<CallDetail, { kind: "bash" }>): boolean {
  return exitCode === null ? tag === "" : exitCode > 0;
}

function bashTag({ exitCode, tag }: Extract<CallDetail, { kind: "bash" }>): Tag {
  if (exitCode === 0) return { text: "exit 0", color: paneInk().ok };
  if (exitCode !== null && exitCode > 0)
    return { text: `exit ${exitCode}`, color: paneInk().failed };
  if (tag === "interrupted") return { text: tag, color: paneInk().failed };
  if (tag !== "") return { text: tag, color: paneInk().muted };
  return { text: "failed", color: paneInk().failed };
}

function tagText({ Text }: Ui, tag: Tag): RenderElement {
  return (
    <Text key="tag" color={tag.color}>
      {tag.text}
    </Text>
  );
}

function changeBody(
  ui: Ui,
  call: CallRecord & CallBody,
  detail: Extract<CallDetail, { kind: "change" }>,
  view: ActivityView,
  maxLines: number,
): Body {
  const request = {
    toolUseId: call.id,
    change: { ...detail, isDelete: false },
    cwd: view.cwd,
    home: view.home,
    width: view.width,
    accent: null,
    fills: view.fills,
  };
  return paneDiffPanel(ui, request, maxLines);
}

function readBody(
  ui: Ui,
  detail: Extract<CallDetail, { kind: "read" }>,
  view: ActivityView,
  maxLines: number,
): Body {
  const { Box, Code, Text } = ui;
  const lines = detail.content === "" ? [] : detail.content.replace(/\n$/, "").split("\n");
  const gutterCells = String(detail.startLine + lines.length).length + READ_GUTTER_PADDING;
  const { shown, hiddenLines } = cutLines(
    lines,
    Math.max(1, view.width - PANEL_INDENT_CELLS - gutterCells),
    maxLines,
  );
  const lastLine = detail.startLine + shown.length - 1;
  const title = (
    <Text weight="semibold" color={paneInk().text}>
      {relativePath(detail.filePath, view.cwd)}
    </Text>
  );
  const right = [
    tagText(ui, {
      text: `lines ${detail.startLine}-${lastLine} of ${detail.totalLines}`,
      color: paneInk().muted,
    }),
  ];
  const body = (
    <Box flexDirection="column" paddingLeft={PANEL_INDENT_CELLS}>
      {lines.length === 0 ? (
        emptyLine(ui, "empty file")
      ) : (
        <Code
          path={detail.filePath}
          source={shown.join("\n")}
          startLine={detail.startLine}
          wrap="wrap"
        />
      )}
    </Box>
  );
  return {
    element: titledBody(ui, {
      key: `detail-${detail.filePath}`,
      width: view.width,
      title,
      right: lines.length === 0 ? [] : right,
      body,
    }),
    hiddenLines,
  };
}

export function paneFills(fills: Fills): Fills {
  return { ...fills, source: `${fills.source}-pane:${paneInk().text}`, prose: paneInk().text };
}

function markdownBody(
  ui: Ui,
  call: CallRecord & CallBody,
  view: ActivityView,
  maxLines: number,
): Body {
  const { Box, Text } = ui;
  const json = prettyJson(call.output);
  const { shown, hiddenLines } = cutLines(
    (json ?? call.output).split("\n"),
    Math.max(1, view.width - TEXT_COLUMN),
    maxLines,
  );
  const reply =
    call.output === ""
      ? null
      : replyView(
          ui,
          {
            text: json === undefined ? shown.join("\n") : `\`\`\`json\n${shown.join("\n")}\n\`\`\``,
            width: view.width - TEXT_COLUMN,
            isFirstOfReply: false,
            stamp: "",
            surface: view.surface,
            accent: null,
            fills: paneFills(view.fills),
            lineBreaks: isProse(call.tool) ? "joined" : "kept",
          },
          { copy: view.copy },
        );
  return {
    element: (
      <Box flexDirection="column">
        {header(ui, "Input", paneHeaderLook(), view.width)}
        <Box flexDirection="column" paddingLeft={PANEL_INDENT_CELLS}>
          {inputRows(ui, call, view.width - PANEL_INDENT_CELLS)}
        </Box>
        <Text key="output-gap"> </Text>
        {header(ui, "Output", paneHeaderLook(), view.width)}
        {reply ?? (
          <Box flexDirection="column" paddingLeft={PANEL_INDENT_CELLS}>
            {emptyLine(ui, "no output")}
          </Box>
        )}
      </Box>
    ),
    hiddenLines,
  };
}

function isProse(tool: string): boolean {
  return kindOf(tool) === "Agent" || tool.startsWith("mcp__");
}

function prettyJson(output: string): string | undefined {
  const trimmed = output.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return undefined;
  }
}

function inputRows(ui: Ui, call: CallRecord & CallBody, cells: number): RenderElement[] {
  const { Box, Text } = ui;
  const { fields } = call;
  if (fields === undefined || fields.length === 0)
    return textLines(ui, call.input.split("\n"), "input", paneInk().text);
  const keyCells = Math.min(
    Math.max(...fields.map(({ name }) => displayWidth(name))),
    Math.floor(cells / KEY_SHARE),
  );
  return fields.map(({ name, value }) => (
    <Box key={`input-${name}`} flexDirection="row" columnGap={1}>
      <Box width={keyCells} flexShrink={0}>
        <Text color={paneInk().muted} wrap="truncate-end">
          {name}
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
        {textLines(ui, value.split("\n"), `input-${name}`, paneInk().text)}
      </Box>
    </Box>
  ));
}

function cutLines(
  lines: string[],
  cells: number,
  maxRows: number,
): { shown: string[]; hiddenLines: number } {
  const { shown, hiddenLines } = cutGroups([{ lines, cells }], maxRows);
  return { shown: shown[0] ?? [], hiddenLines };
}

function cutGroups(
  groups: { lines: string[]; cells: number }[],
  maxRows: number,
): { shown: string[][]; hiddenLines: number } {
  let room = maxRows;
  const shown = groups.map(({ lines, cells }) => {
    const part = fitRows(lines, cells, room);
    room = part.length < lines.length ? 0 : room - rowsOf(part, cells);
    return part;
  });
  const total = groups.reduce((sum, group) => sum + group.lines.length, 0);
  const kept = shown.reduce((sum, lines) => sum + lines.length, 0);
  return { shown, hiddenLines: total - kept };
}

function fitRows(lines: string[], cells: number, room: number): string[] {
  const fitting: string[] = [];
  let used = 0;
  for (const line of lines) {
    used += rowsOf([line], cells);
    if (used > room) break;
    fitting.push(line);
  }
  return fitting;
}

function rowsOf(lines: string[], cells: number): number {
  return lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(displayWidth(line) / cells)), 0);
}

function foldButton(ui: Ui, hiddenLines: number, view: ActivityView): RenderElement | null {
  if (view.isUnfolded)
    return labelButton(ui, { key: "fewer-lines", label: "▾ fewer lines", onPress: view.fold });
  if (hiddenLines === 0) return null;
  return labelButton(ui, {
    key: "more-lines",
    label: `▸ ${hiddenLines} more ${plural("line", hiddenLines)}`,
    onPress: view.unfold,
  });
}

function textLines(
  { Text }: Ui,
  lines: string[],
  key: string,
  color: string | undefined,
): RenderElement[] {
  return lines.map((line, i) => (
    <Text key={`${key}${i}`} color={color} wrap="wrap">
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

const INLINE_REASON_SEPARATOR_CELLS = 3;
const MIN_INLINE_REASON_CELLS = 8;
const MIN_INLINE_TEXT_CELLS = 16;

function targetText(call: CallRecord, cwd: string): string {
  return isPathTool(call.tool) ? relativePath(call.target, cwd) : call.target;
}

function shownTarget(call: CallRecord, shown: string, cells: number): string {
  return isPathTool(call.tool) ? clipStart(shown, cells) : clipEnd(shown, cells);
}
