import { atom, update } from "claude-code";
import type { ElementTable, EngineInterface, RenderElement, UiPressArgument } from "claude-code";

import type { AgentStatus } from "../types";
import { palette } from "./palette";
import { paneInk } from "./pane-ink";
import { PANE } from "./pane-tab";
import { clipEnd, displayWidth } from "./text-width";

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
  idle: "○",
  done: "✓",
  failed: "✗",
  stopped: "○",
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
const CELLS_FOR_ELLIPSIS = 2;

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
  if (displayWidth(text) <= maxCells) return text;
  return maxCells < CELLS_FOR_ELLIPSIS ? text.slice(0, maxCells) : clipEnd(text, maxCells);
}

function filledCells(value: number, max: number, cells: number): number {
  return max <= 0 ? 0 : Math.max(0, Math.min(cells, Math.round((value / max) * cells)));
}

export function barText(value: number, max: number, cells: number): string {
  const filled = filledCells(value, max, cells);
  return "▰".repeat(filled) + "▱".repeat(cells - filled);
}

export function bar(
  { Text }: Ui,
  value: number,
  max: number,
  cells: number,
  color: string | undefined,
): RenderElement {
  const filled = filledCells(value, max, cells);
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

export function stampText(ui: Ui, text: string): RenderElement {
  const { Text } = ui;
  return (
    <Text color={paneInk().muted} dimColor wrap="truncate-end">
      {text}
    </Text>
  );
}

export function header(
  ui: Ui,
  label: string,
  look: HeaderLook,
  width: number,
  stamp = "",
): RenderElement {
  const { Text } = ui;
  const stampCells = stamp === "" ? 0 : stamp.length + 1;
  return (
    <Text wrap="truncate-end">
      <Text weight="semibold" color={look.color} wrap="truncate-end">
        {label}
      </Text>
      {stamp === "" ? null : stampText(ui, ` ${stamp}`)}
      <Text
        color={look.ruleColor}
        wrap="truncate-end"
      >{` ${look.ruleChar.repeat(Math.max(0, width - label.length - 1 - stampCells))}`}</Text>
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

export const HOVER_SCOPE_CELLS = 64;

export function isLightTheme(theme: string): boolean {
  return theme.startsWith("light");
}

export function labelButton({ Button, Text }: Ui, spec: ButtonSpec): RenderElement {
  const ink = paneInk();
  return (
    <Button
      key={spec.key}
      label={spec.label}
      plain
      dimColor={false}
      hover={{ color: ink.text ?? ink.section, scope: spec.key.slice(0, HOVER_SCOPE_CELLS) }}
      onPress={spec.onPress}
    >
      <Text color={ink.text} wrap="truncate-end">
        {spec.label}
      </Text>
    </Button>
  );
}

type FilterSpec = {
  value: string;
  onInput: (text: string) => void;
  onFocus: () => void;
};

export const FILTER_KEY = "filter";

const bodyOffsetAtom = atom({ plugin: "paneline", key: "bodyOffset" } as const, 0);

export async function focusFilter($: EngineInterface): Promise<void> {
  await update($, bodyOffsetAtom, () => 0);
  await $.ui.open({ id: PANE, title: "Session", closeOnEscape: true, focus: true });
  await $.ui.focus({ requestId: PANE, key: FILTER_KEY }).catch(() => undefined);
}

const FILTER_OPEN_KEY = "filter-open";
const FILTER_HINT_KEY = "filter-hint";

export function filterInput(ui: Ui, value: string, onInput: (text: string) => void): RenderElement {
  const { Input } = ui as ElementTable<"terminal">;
  return (
    <Input
      key={FILTER_KEY}
      placeholder="type to narrow"
      submitLabel={value ? "clear" : ""}
      value={value}
      onInput={onInput}
      onSubmit={() => onInput("")}
    />
  );
}

export function filterRow(ui: Ui, spec: FilterSpec): RenderElement {
  const { Box, Button, Text } = ui as ElementTable<"terminal">;
  return (
    <Box key="filter-row" flexDirection="row" columnGap={1}>
      <Box flexShrink={0}>
        <Button
          key={FILTER_HINT_KEY}
          plain
          dimColor={false}
          hover={{ color: paneInk().text ?? paneInk().section, scope: FILTER_HINT_KEY }}
          onPress={spec.onFocus}
        >
          <Text color={paneInk().text} wrap="truncate-end">
            f
          </Text>
          <Text color={paneInk().muted} wrap="truncate-end">
            {" "}
            filter
          </Text>
        </Button>
        <Box display="none">
          <Button key={FILTER_OPEN_KEY} label="filter" hotkey="f" onPress={spec.onFocus} />
        </Box>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {filterInput(ui, spec.value, spec.onInput)}
      </Box>
    </Box>
  );
}

export function matchesFilter(filter: string, ...texts: string[]): boolean {
  const needle = filter.toLowerCase();
  return texts.some((text) => text.toLowerCase().includes(needle));
}

export function plural(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`;
}
