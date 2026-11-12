import type { ElementTable, RenderElement } from "claude-code";

import type { TurnStats } from "../types";
import { cleanText } from "./markdown";
import { resolvedAccent } from "./reply-look";
import { memo } from "./memo";
import { accentLook, button, header, plural, sectionLook, stampText } from "./pane-kit";
import type { Accent, HeaderLook } from "./pane-kit";
import { palette } from "./palette";
import type { Fills } from "./palette";
import { displayWidth, wrapPlain } from "./text-width";

type Ui = ElementTable;

const userLook = (fills: Fills): HeaderLook => ({
  color: fills.user,
  ruleChar: "━",
  ruleColor: fills.user,
});

type CallLike = { tool: string; isRunning: boolean; isErrored: boolean; isDenied: boolean };

export type ToolGroupView = {
  calls: readonly CallLike[];
  isActive: boolean;
  elapsedMs: number | null;
  accent: Accent;
  fills: Fills;
};

const GUTTER = 3;

export const TEXT_COLUMN = 2;

const MIN_INNER_WIDTH = 20;

type Layout = { width: number };

export function layoutOf(columns: number): Layout {
  return { width: Math.max(MIN_INNER_WIDTH, columns - TEXT_COLUMN - GUTTER) };
}

const USER_CACHE_LIMIT = 40;
const userCache = memo<RenderElement>(USER_CACHE_LIMIT);

const DETAILS_LABEL = "Details";

const DETAILS_BUTTON_CELLS = DETAILS_LABEL.length + 4;

const ROW_GAP = 1;

const STATUS_GAP = "   ";

const SUMMARY_SEPARATOR = " · ";

const CALL_KINDS = [
  { pattern: /^Read$/, verb: "Read", noun: "file" },
  { pattern: /^(Bash|PowerShell)$/, verb: "Ran", noun: "command" },
  { pattern: /^(Edit|MultiEdit|Write|NotebookEdit)$/, verb: "Edited", noun: "file" },
  { pattern: /^(Grep|Glob)$/, verb: "Searched", noun: "time" },
];

function rightHeader(
  ui: Ui,
  label: string,
  look: HeaderLook,
  width: number,
  stamp: string,
): RenderElement {
  const { Text } = ui;
  const stampCells = stamp === "" ? 0 : stamp.length + 1;
  return (
    <Text wrap="truncate-end">
      <Text
        color={look.ruleColor}
      >{`${look.ruleChar.repeat(Math.max(0, width - label.length - 1 - stampCells))} `}</Text>
      {stamp === "" ? null : stampText(ui, `${stamp} `)}
      <Text weight="semibold" color={look.color}>
        {label}
      </Text>
    </Text>
  );
}

export function userBlock(
  ui: Ui,
  text: string,
  layout: Layout,
  fills: Fills,
  stamp: string,
): RenderElement {
  return userCache(`user|${fills.source}|${layout.width}|${stamp}|${text}`, () =>
    buildUserBlock(ui, text, layout, fills, stamp),
  );
}

function buildUserBlock(
  ui: Ui,
  text: string,
  layout: Layout,
  fills: Fills,
  stamp: string,
): RenderElement {
  const { Box, Text } = ui;
  const { width } = layout;
  return (
    <Box flexDirection="column" marginTop={1} marginLeft={TEXT_COLUMN} width={width}>
      {rightHeader(ui, "USER", userLook(fills), width, stamp)}
      {wrapPlain(cleanText(withoutPastedTags(text)), width - 3).map((line, i) => (
        <Box key={`u${i}`} width={width} justifyContent="flex-end" backgroundColor={fills.userBand}>
          <Text backgroundColor={fills.userBand}>
            <Text color={palette.userText}>{`${line} `}</Text>
            <Text color={fills.user}>▌</Text>
          </Text>
        </Box>
      ))}
    </Box>
  );
}

function stampedRow(ui: Ui, headerLine: RenderElement, inner: RenderElement): RenderElement {
  const { Box } = ui;
  return (
    <Box flexDirection="column">
      <Box marginTop={1} marginLeft={TEXT_COLUMN}>
        {headerLine}
      </Box>
      {inner}
    </Box>
  );
}

export function stampedUserRow(
  ui: Ui,
  inner: RenderElement,
  layout: Layout,
  fills: Fills,
  stamp: string,
): RenderElement {
  return stampedRow(ui, rightHeader(ui, "USER", userLook(fills), layout.width, stamp), inner);
}

export function stampedReplyRow(
  ui: Ui,
  inner: RenderElement,
  layout: Layout,
  accent: Accent,
  stamp: string,
): RenderElement {
  return stampedRow(ui, header(ui, "CLAUDE", sectionLook(accent), layout.width, stamp), inner);
}

const PASTED_TAG = /<\\?\/?pasted_content\b[^>]*>/g;

function withoutPastedTags(text: string): string {
  return text.replace(PASTED_TAG, "").trim();
}

export function toolGroupRow(
  ui: Ui,
  view: ToolGroupView,
  layout: Layout,
  onDetails: () => void,
): RenderElement {
  const { Box, Text } = ui;
  const { width } = layout;
  const status = groupStatus(view);
  const elapsed = view.elapsedMs === null ? "" : ` · ${formatDuration(view.elapsedMs)}`;
  const summaryWidth =
    width -
    DETAILS_BUTTON_CELLS -
    ROW_GAP -
    STATUS_GAP.length -
    displayWidth(status.word) -
    displayWidth(elapsed);
  const summary = fittedSummary(callSummaryParts(view.calls), summaryWidth);
  const headerAccent = view.accent === null ? null : resolvedAccent(view.accent, view.fills);
  return (
    <Box flexDirection="column" marginTop={1} marginLeft={TEXT_COLUMN} width={width}>
      {header(ui, "TOOL", accentLook(headerAccent, palette.tool), width)}
      <Box flexDirection="row" columnGap={ROW_GAP}>
        <Text wrap="truncate-end">
          <Text weight="semibold" color={status.color}>
            {status.word}
          </Text>
          <Text color={view.fills.prose}>{`${STATUS_GAP}${summary}${elapsed}`}</Text>
        </Text>
        {button(ui, { key: "details", label: DETAILS_LABEL, onPress: onDetails })}
      </Box>
    </Box>
  );
}

function groupStatus(view: ToolGroupView): { word: string; color: string } {
  if (view.isActive && view.calls.some((call) => call.isRunning))
    return { word: "Running", color: palette.muted };
  const errored = view.calls.filter((call) => call.isErrored);
  if (errored.length > 0 && errored.every((call) => call.isDenied))
    return { word: "Denied", color: palette.alert };
  if (errored.length > 0) return { word: "Failed", color: palette.failed };
  return { word: "Done", color: palette.ok };
}

function callSummaryParts(calls: readonly CallLike[]): string[] {
  const known = CALL_KINDS.map((kind) => ({
    kind,
    count: calls.filter((call) => kind.pattern.test(call.tool)).length,
  }))
    .filter((part) => part.count > 0)
    .map(({ kind, count }) => `${kind.verb} ${count} ${plural(kind.noun, count)}`);
  const other = calls.filter(
    (call) => !CALL_KINDS.some((kind) => kind.pattern.test(call.tool)),
  ).length;
  return [...known, ...(other > 0 ? [`Used ${other} ${plural("tool", other)}`] : [])];
}

function fittedSummary(parts: string[], width: number): string {
  const candidates = parts.map((_, i) => {
    const shown = parts.slice(0, parts.length - i);
    return (i === 0 ? shown : [...shown, `+${i}`]).join(SUMMARY_SEPARATOR);
  });
  return candidates.find((text) => displayWidth(text) <= width) ?? candidates.at(-1) ?? "";
}

export function footerRow(
  ui: Ui,
  durationMs: number,
  stats: TurnStats | undefined,
  layout: Layout,
  fills: Fills,
): RenderElement {
  const { Box } = ui;
  return (
    <Box marginTop={1} marginLeft={TEXT_COLUMN} width={layout.width}>
      {footerText(ui, durationMs, stats, fills)}
    </Box>
  );
}

function footerText(
  ui: Ui,
  durationMs: number,
  stats: TurnStats | undefined,
  fills: Fills,
): RenderElement {
  const { Text } = ui;
  return (
    <Text color={palette.muted}>
      {"Completed · "}
      <Text color={fills.prose}>{formatDuration(durationMs)}</Text>
      {countPart(ui, stats?.reads ?? 0, "read", fills)}
      {countPart(ui, stats?.changedFiles ?? 0, "changed", fills)}
    </Text>
  );
}

function countPart(ui: Ui, count: number, verb: string, fills: Fills): RenderElement | null {
  if (count === 0) return null;
  const { Text } = ui;
  return (
    <Text color={palette.muted}>
      {" · "}
      <Text color={fills.prose}>{String(count)}</Text>
      {` ${plural("file", count)} ${verb}`}
    </Text>
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
