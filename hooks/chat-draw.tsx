import type { ElementTable, RenderElement } from "claude-code";

import type { TurnStats } from "../types";
import { cleanText } from "./markdown";
import { memo } from "./memo";
import { accentLook, button, header, plural } from "./pane-kit";
import type { Accent, HeaderLook } from "./pane-kit";
import { palette } from "./palette";
import type { Fills } from "./palette";
import { wrapPlain } from "./text-width";

type Ui = ElementTable;

const userLook = (fills: Fills): HeaderLook => ({
  color: fills.user,
  ruleChar: "━",
  ruleColor: fills.user,
});

type CallLike = { tool: string; isRunning: boolean; isErrored: boolean };

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

const CALL_KINDS = [
  { pattern: /^Read$/, verb: "Read", noun: "file" },
  { pattern: /^(Bash|PowerShell)$/, verb: "Ran", noun: "command" },
  { pattern: /^(Edit|MultiEdit|Write|NotebookEdit)$/, verb: "Edited", noun: "file" },
  { pattern: /^(Grep|Glob)$/, verb: "Searched", noun: "time" },
];

function rightHeader(ui: Ui, label: string, look: HeaderLook, width: number): RenderElement {
  const { Text } = ui;
  return (
    <Text wrap="truncate-end">
      <Text
        color={look.ruleColor}
      >{`${look.ruleChar.repeat(Math.max(0, width - label.length - 1))} `}</Text>
      <Text weight="semibold" color={look.color}>
        {label}
      </Text>
    </Text>
  );
}

export function userBlock(ui: Ui, text: string, layout: Layout, fills: Fills): RenderElement {
  return userCache(`user|${fills.source}|${layout.width}|${text}`, () =>
    buildUserBlock(ui, text, layout, fills),
  );
}

function buildUserBlock(ui: Ui, text: string, layout: Layout, fills: Fills): RenderElement {
  const { Box, Text } = ui;
  const { width } = layout;
  return (
    <Box flexDirection="column" marginTop={1} marginLeft={TEXT_COLUMN} width={width}>
      {rightHeader(ui, "USER", userLook(fills), width)}
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
  return (
    <Box flexDirection="column" marginTop={1} marginLeft={TEXT_COLUMN} width={width}>
      {header(ui, "TOOL", accentLook(view.accent, palette.tool), width)}
      <Box flexDirection="row" columnGap={1}>
        <Text wrap="truncate-end">
          <Text weight="semibold" color={status.color}>
            {status.word}
          </Text>
          <Text color={view.fills.prose}>{`   ${callSummary(view.calls)}${elapsed}`}</Text>
        </Text>
        {button(ui, { key: "details", label: "Details", onPress: onDetails })}
      </Box>
    </Box>
  );
}

function groupStatus(view: ToolGroupView): { word: string; color: string } {
  if (view.isActive && view.calls.some((call) => call.isRunning))
    return { word: "Running", color: palette.muted };
  if (view.calls.some((call) => call.isErrored)) return { word: "Failed", color: palette.failed };
  return { word: "Done", color: palette.ok };
}

function callSummary(calls: readonly CallLike[]): string {
  const known = CALL_KINDS.map((kind) => ({
    kind,
    count: calls.filter((call) => kind.pattern.test(call.tool)).length,
  }))
    .filter((part) => part.count > 0)
    .map(({ kind, count }) => `${kind.verb} ${count} ${plural(kind.noun, count)}`);
  const other = calls.filter(
    (call) => !CALL_KINDS.some((kind) => kind.pattern.test(call.tool)),
  ).length;
  return [...known, ...(other > 0 ? [`Used ${other} ${plural("tool", other)}`] : [])].join(" · ");
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
  { Text }: Ui,
  durationMs: number,
  stats: TurnStats | undefined,
  fills: Fills,
): RenderElement {
  return (
    <Text color={palette.muted}>
      {"Completed · "}
      <Text color={fills.prose}>{formatDuration(durationMs)}</Text>
      {stats ? " · " : ""}
      {stats ? <Text color={fills.prose}>{String(stats.reads)}</Text> : null}
      {stats ? ` ${plural("file", stats.reads)} read · ` : ""}
      {stats?.changedFiles === 0 ? "no files changed" : null}
      {stats && stats.changedFiles > 0 ? (
        <Text color={fills.prose}>{String(stats.changedFiles)}</Text>
      ) : null}
      {stats && stats.changedFiles > 0 ? ` ${plural("file", stats.changedFiles)} changed` : ""}
    </Text>
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
