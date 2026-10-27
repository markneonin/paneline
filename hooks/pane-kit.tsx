import type { ElementTable, RenderElement, UiPressArgument } from "claude-code";

import type { AgentStatus } from "../types";
import { palette } from "./palette";
import { paneInk } from "./pane-ink";

type Ui = ElementTable;

export type HeaderLook = { color: string | undefined; ruleChar: string; ruleColor: string };

export type Part = { text: string; color: string | undefined; bold?: boolean };

type Wrap = "truncate-end" | "truncate-start";

type PaneRowSpec = {
  key?: string;
  guide?: string;
  prefix?: string;
  dot?: Part;
  label?: Part;
  middle: Part;
  middleWrap: Wrap;
  right?: Part | Part[];
  width: number;
};

type ButtonSpec = {
  key: string;
  label: string;
  onPress: (press: UiPressArgument) => void;
  backgroundColor?: string;
};

export type Accent = string | null;

export function accentLook(accent: Accent, fallbackColor: string): HeaderLook {
  return { color: accent ?? fallbackColor, ruleChar: "─", ruleColor: accent ?? palette.rule };
}

export const sectionLook = (accent: Accent): HeaderLook => accentLook(accent, palette.section);

export const paneHeaderLook = (): HeaderLook => ({
  color: paneInk().text,
  ruleChar: "─",
  ruleColor: paneInk().rule,
});

const STATUS_GLYPH: Record<AgentStatus, string> = {
  running: "●",
  waiting: "●",
  idle: "●",
  done: "✓",
  failed: "✗",
  stopped: "●",
  killed: "✗",
};

function statusColor(status: AgentStatus): string | undefined {
  const ink = paneInk();
  const colors: Record<AgentStatus, string | undefined> = {
    running: ink.tool,
    waiting: ink.alert,
    idle: ink.muted,
    done: ink.ok,
    failed: ink.failed,
    stopped: ink.muted,
    killed: ink.failed,
  };
  return colors[status];
}

const LABEL_SHARE = 3;
const RIGHT_SHARE = 4;
const PREFIX_SHARE = 2;

export function statusDot(status: AgentStatus): Part {
  return { text: STATUS_GLYPH[status], color: statusColor(status) };
}

export function gapRow(
  { Text }: Ui,
  key: string,
  guides: string,
  color: string | undefined,
): RenderElement {
  return (
    <Text key={key} color={color} wrap="truncate-end">
      {guides}
    </Text>
  );
}

export function paneRow(ui: Ui, spec: PaneRowSpec): RenderElement {
  const { Box, Text } = ui;
  const {
    key,
    prefix,
    dot,
    label,
    middle,
    middleWrap,
    right,
    width,
    guide = paneInk().rule,
  } = spec;
  const isPrefixTight = dot === undefined && label === undefined;
  const hasLead = !isPrefixTight && (prefix !== undefined || dot !== undefined);
  const clippedPrefix = (prefix ?? "").slice(0, Math.floor(width / PREFIX_SHARE));
  return (
    <Box key={key} flexDirection="row" width={width} height={1} columnGap={1}>
      {hasLead ? (
        <Box flexShrink={0}>
          <Text wrap="truncate-end">
            <Text color={guide} wrap="truncate-end">
              {clippedPrefix}
            </Text>
            <Text color={dot?.color} wrap="truncate-end">
              {dot?.text ?? ""}
            </Text>
          </Text>
        </Box>
      ) : null}
      {label ? fixedPart(ui, label, Math.floor(width / LABEL_SHARE)) : null}
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text wrap={middleWrap}>
          <Text color={guide} wrap={middleWrap}>
            {isPrefixTight ? clippedPrefix : ""}
          </Text>
          <Text
            color={middle.color}
            weight={middle.bold ? "semibold" : undefined}
            wrap={middleWrap}
          >
            {middle.text}
          </Text>
        </Text>
      </Box>
      {right ? fixedPart(ui, right, Math.floor(width / RIGHT_SHARE)) : null}
    </Box>
  );
}

function fixedPart({ Box, Text }: Ui, part: Part | Part[], maxCells: number): RenderElement {
  if (Array.isArray(part)) {
    return (
      <Box flexShrink={0}>
        <Text wrap="truncate-end">
          {part.map((piece) => (
            <Text
              key={piece.text}
              color={piece.color}
              weight={piece.bold ? "semibold" : undefined}
              wrap="truncate-end"
            >
              {piece.text}
            </Text>
          ))}
        </Text>
      </Box>
    );
  }
  return (
    <Box flexShrink={0}>
      <Text color={part.color} weight={part.bold ? "semibold" : undefined} wrap="truncate-end">
        {clip(part.text, maxCells)}
      </Text>
    </Box>
  );
}

function clip(text: string, maxCells: number): string {
  if (text.length <= maxCells) return text;
  return maxCells <= 1 ? text.slice(0, maxCells) : `${text.slice(0, maxCells - 1)}…`;
}

export function bar(
  { Text }: Ui,
  value: number,
  max: number,
  cells: number,
  color: string | undefined,
): RenderElement {
  const filled = max <= 0 ? 0 : Math.max(0, Math.min(cells, Math.round((value / max) * cells)));
  return (
    <Text wrap="truncate-end">
      <Text color={color} wrap="truncate-end">
        {"▰".repeat(filled)}
      </Text>
      <Text color={paneInk().meterEmpty} wrap="truncate-end">
        {"▱".repeat(cells - filled)}
      </Text>
    </Text>
  );
}

export function header(ui: Ui, label: string, look: HeaderLook, width: number): RenderElement {
  const { Text } = ui;
  return (
    <Text wrap="truncate-end">
      <Text weight="semibold" color={look.color} wrap="truncate-end">
        {label}
      </Text>
      <Text
        color={look.ruleColor}
        wrap="truncate-end"
      >{` ${look.ruleChar.repeat(Math.max(0, width - label.length - 1))}`}</Text>
    </Text>
  );
}

export function button({ Box, Button, Text }: Ui, spec: ButtonSpec): RenderElement {
  return (
    <Box key={spec.key} flexDirection="row" flexShrink={0} backgroundColor={spec.backgroundColor}>
      <Text color={paneInk().muted} backgroundColor={spec.backgroundColor} wrap="truncate-end">
        [{" "}
      </Text>
      <Button key={spec.key} label={spec.label} plain dimColor onPress={spec.onPress} />
      <Text color={paneInk().muted} backgroundColor={spec.backgroundColor} wrap="truncate-end">
        {" "}
        ]
      </Text>
    </Box>
  );
}

const HOVER_SCOPE_CELLS = 64;

export function isLightTheme(theme: string): boolean {
  return theme.startsWith("light");
}

export function labelButton({ Button }: Ui, spec: ButtonSpec): RenderElement {
  return (
    <Button
      key={spec.key}
      label={spec.label}
      plain
      dimColor={false}
      hover={{
        color: paneInk().text ?? paneInk().section,
        scope: spec.key.slice(0, HOVER_SCOPE_CELLS),
      }}
      onPress={spec.onPress}
    />
  );
}

export function plural(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`;
}
