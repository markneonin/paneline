import type {
  ElementTable,
  RenderElement,
  SessionMessage,
  SessionMessagesResult,
  ToolUseSummary,
} from "claude-code";

import type { AgentNode, CallRecord } from "../types";
import type { AgentShare } from "./spend-model";
import { TOKENS_BILLED_LABEL } from "./spend-model";
import { deniedDot, paneFills } from "./activity-draw";
import { isDenied } from "./activity-calls";
import { UNMEASURED_MS } from "./activity-track";
import { figuresOf, headerTitleParts, OVERSCAN_ROWS, statusAfterMark } from "./agents-draw";
import { TEXT_COLUMN } from "./chat-draw";
import { formatDuration, singleLine } from "./format";
import type { Block } from "./markdown";
import { parse, runsOf } from "./markdown";
import { hangingRowCount } from "./inline-draw";
import type { RowPress } from "./inline-draw";
import type { Fills } from "./palette";
import type { Part } from "./pane-kit";
import { button, gapRow, header, labelButton, paneHeaderLook, statusDot } from "./pane-kit";
import { paneInk } from "./pane-ink";
import { clipPathStart, relativePath } from "./paths";
import type { ReplyActions } from "./reply-draw";
import { KEPT_LINE_HANG_CELLS, replyView } from "./reply-draw";
import { TAB_BAR_ROWS } from "./tab-bar";
import { clipEnd, displayWidth, wrapRuns } from "./text-width";
import { isPathTool, targetOf } from "./tools";

type Ui = ElementTable;
type Drawable = { rows: number; draw: () => RenderElement };
type Line = Drawable | typeof GAP;

export type TranscriptView = {
  agent: AgentNode;
  share: AgentShare | undefined;
  messages: SessionMessagesResult;
  calls: CallRecord[];
  width: number;
  height: number;
  offset: number;
  cwd: string;
  now: number;
  back: () => void;
  stop: () => void;
  openCall: (id: string) => void;
  fills: Fills;
  surface: string;
  copy: ReplyActions["copy"];
  isExpanded: boolean;
  expand: () => void;
  collapse: () => void;
};

const GAP = { kind: "gap" } as const;
const HEADER_ROWS = 2;
const LABEL_ROWS = 1;
const MESSAGE_LIMIT = 12;
const INTERRUPT_MARKER = "[Request interrupted";
const HANDBACK_TOOL = "SubagentHandback";
const BUTTON_CELLS = 8;
const DOT_AND_GAPS_CELLS = 4;
const DURATION_CELLS = 8;
const MARK_CELLS = 2;
const TOOLS_HEAD_ROWS = 2;
const TOOLS_MIN_CALL_ROWS = 2;
const WRAP = { isLongWordContinuing: true, isBreakingAfterSlash: true } as const;

export function agentTranscript(ui: Ui, view: TranscriptView): RenderElement {
  const { Box } = ui;
  return (
    <Box flexDirection="column" width={view.width}>
      {headerRow(ui, view)}
      {gapRow(ui, "header-gap", " ", paneInk().rule)}
      {hasTokens(view) ? mutedLine(ui, "tokens-label", TOKENS_BILLED_LABEL) : null}
      {"deny" in view.messages
        ? mutedLine(ui, "unavailable", "transcript not available")
        : messageRows(ui, view.messages, view)}
    </Box>
  );
}

function headerRow(ui: Ui, view: TranscriptView): RenderElement {
  const { Box, Text } = ui;
  const { agent } = view;
  const dot = statusDot(agent.status);
  const canStop = agent.status === "running" && agent.background;
  const figures = figuresSuffix(view);
  const reserved = statusAfterMark(agent).length + figures.length;
  const title = headerTitleParts(agent, titleCells(view.width, canStop, reserved));
  return (
    <Box flexDirection="row" columnGap={1} height={1}>
      {button(ui, { key: "back", label: "back", onPress: view.back })}
      {canStop ? button(ui, { key: "stop", label: "stop", onPress: view.stop }) : null}
      <Box flexDirection="row" flexGrow={1} flexShrink={1} minWidth={0}>
        <Box flexDirection="row" flexShrink={0}>
          <Text color={dot.color} wrap="truncate-end">
            {dot.text}
          </Text>
          <Text color={dot.color} wrap="truncate-end">
            {`${statusAfterMark(agent)} `}
          </Text>
        </Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text wrap="truncate-end">
            <Text color={paneInk().text} wrap="truncate-end">
              {title.description}
            </Text>
            <Text color={paneInk().muted} wrap="truncate-end">
              {`${title.suffix}${figures}`}
            </Text>
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

function figuresSuffix({ agent, share, now }: TranscriptView): string {
  const { duration, tokens, cost } = figuresOf(agent, share, now);
  return [duration, tokens, cost]
    .filter((figure) => figure !== "")
    .map((figure) => ` · ${figure}`)
    .join("");
}

function hasTokens(view: TranscriptView): boolean {
  return (view.share?.tokens ?? 0) > 0;
}

function titleCells(width: number, canStop: boolean, reserved: number): number {
  const buttons = canStop ? 2 : 1;
  const fixed = buttons * BUTTON_CELLS + DOT_AND_GAPS_CELLS + (buttons - 1) + reserved;
  return Math.max(1, width - fixed);
}

function messageRows(ui: Ui, messages: SessionMessage[], view: TranscriptView): RenderElement[] {
  const shown = messages.filter(isDrawn);
  const fold = foldOf(ui, shown, view);
  const lines = drawableOf(ui, linesOf(ui, shown, fold, view));
  const room = bodyRows(view) - rowsOf(lines);
  const drawable = [...lines, ...toolsRows(ui, view, room)];
  return inWindow(ui, drawable, TAB_BAR_ROWS + headerRows(view), view);
}

type Fold = { start: number; isPromptCut: boolean; hasLeadGap: boolean };

function promptOf(shown: SessionMessage[]): SessionMessage | undefined {
  const [first] = shown;
  return first?.role === "user" ? first : undefined;
}

function headOf(shown: SessionMessage[]): number {
  return promptOf(shown) === undefined ? 0 : 1;
}

function foldOf(ui: Ui, shown: SessionMessage[], view: TranscriptView): Fold {
  const head = headOf(shown);
  if (view.isExpanded) return { start: head, isPromptCut: false, hasLeadGap: true };
  const first = Math.max(head, shown.length - MESSAGE_LIMIT);
  const last = Math.max(first, shown.length - 1);
  const candidatesWith = (hasLeadGap: boolean): Fold[] => [
    { start: first, isPromptCut: false, hasLeadGap },
    ...Array.from({ length: last - first + 1 }, (_, i) => ({
      start: first + i,
      isPromptCut: true,
      hasLeadGap,
    })),
  ];
  const fitting = [...candidatesWith(true), ...candidatesWith(false)].find((fold) =>
    fits(ui, shown, fold, view),
  );
  return fitting ?? { start: last, isPromptCut: true, hasLeadGap: false };
}

function fits(ui: Ui, shown: SessionMessage[], fold: Fold, view: TranscriptView): boolean {
  const rows = rowsOf(drawableOf(ui, linesOf(ui, shown, fold, view)));
  const toolsRoom =
    view.calls.length === 0
      ? 0
      : TOOLS_HEAD_ROWS + Math.min(view.calls.length, TOOLS_MIN_CALL_ROWS);
  return rows + toolsRoom <= bodyRows(view);
}

function linesOf(ui: Ui, shown: SessionMessage[], fold: Fold, view: TranscriptView): Line[] {
  const prompt = promptOf(shown);
  const promptBlock = prompt === undefined ? [] : promptLines(ui, prompt, fold.isPromptCut, view);
  const hidden = fold.start - headOf(shown);
  const marker = hidden > 0 ? [foldLine(ui, hidden, view)] : [];
  const agent = linesFrom(ui, shown, fold.start, view, marker);
  const gap = promptBlock.length > 0 && agent.length > 0 ? [GAP] : [];
  const body = [...promptBlock, ...gap, ...agent];
  return body.length === 0 || !fold.hasLeadGap || !hasTokens(view) ? body : [GAP, ...body];
}

function promptLines(ui: Ui, prompt: SessionMessage, isCut: boolean, view: TranscriptView): Line[] {
  const heading = view.isExpanded
    ? foldableHeading(ui, "prompt", view)
    : headingRow(ui, "m0-role", "prompt", view.width);
  if (isCut) return [heading, promptCutRow(ui, prompt.text, view)];
  return [heading, ...messageRowsOf(ui, prompt, 0, view).map((row) => row.line)];
}

function promptCutRow(ui: Ui, text: string, view: TranscriptView): Drawable {
  const { Button, Text } = ui;
  const label = clipEnd(singleLine(text), view.width);
  return {
    rows: 1,
    draw: () => (
      <Button key="prompt-cut" label={label} plain onPress={view.expand}>
        <Text color={paneInk().text} wrap="truncate-end">
          {label}
        </Text>
      </Button>
    ),
  };
}

function foldLine(ui: Ui, hidden: number, view: TranscriptView): Drawable {
  return { rows: 1, draw: () => earlierButton(ui, `${hidden} earlier`, view.expand) };
}

function bodyRows(view: TranscriptView): number {
  return view.height - TAB_BAR_ROWS - headerRows(view);
}

function headerRows(view: TranscriptView): number {
  return HEADER_ROWS + (hasTokens(view) ? LABEL_ROWS : 0);
}

function rowsOf(lines: Drawable[]): number {
  return lines.reduce((sum, line) => sum + line.rows, 0);
}

function linesFrom(
  ui: Ui,
  shown: SessionMessage[],
  start: number,
  view: TranscriptView,
  marker: Line[],
): Line[] {
  const lines: Line[] = [];
  let last: MessageRow | undefined;
  shown.slice(start).forEach((message, i) => {
    const index = start + i;
    const continuesRun = i > 0 && shown[index - 1]?.role === message.role;
    if (!continuesRun) {
      if (lines.length > 0) lines.push(GAP);
      lines.push(headingRow(ui, `m${index}-role`, roleOf(message), view.width));
      if (i === 0) lines.push(...marker);
      last = undefined;
    }
    for (const row of messageRowsOf(ui, message, index, view)) {
      if (last !== undefined && (row.isText || last.isText)) lines.push(GAP);
      lines.push(row.line);
      last = row;
    }
  });
  return lines;
}

function drawableOf(ui: Ui, lines: Line[]): Drawable[] {
  return lines.map((line, i) => (isGap(line) ? gapLine(ui, `gap${i}`) : line));
}

function inWindow(
  ui: Ui,
  lines: Drawable[],
  firstRow: number,
  view: TranscriptView,
): RenderElement[] {
  const { Box } = ui;
  const top = view.offset - OVERSCAN_ROWS;
  const bottom = view.offset + view.height + OVERSCAN_ROWS;
  const elements: RenderElement[] = [];
  let begin = firstRow;
  let skipped = 0;
  const flushSkipped = (): void => {
    if (skipped > 0) elements.push(<Box key={`skip${elements.length}`} height={skipped} />);
    skipped = 0;
  };
  for (const line of lines) {
    const start = begin;
    begin += line.rows;
    if (start < bottom && start + line.rows > top) {
      flushSkipped();
      elements.push(line.draw());
      continue;
    }
    skipped += line.rows;
  }
  flushSkipped();
  return elements;
}

function gapLine(ui: Ui, key: string): Drawable {
  return { rows: 1, draw: () => gapRow(ui, key, " ", paneInk().rule) };
}

function isGap(line: Line | undefined): line is typeof GAP {
  return line === GAP;
}

function isDrawn(message: SessionMessage): boolean {
  if (message.role === "assistant") return message.text !== "" || message.toolUses.length > 0;
  return message.text !== "" && !message.text.startsWith(INTERRUPT_MARKER);
}

type MessageRow = { isText: boolean; line: Drawable };

function messageRowsOf(
  ui: Ui,
  message: SessionMessage,
  index: number,
  view: TranscriptView,
): MessageRow[] {
  const key = `m${index}`;
  const handbacks = message.toolUses.filter((use) => use.tool === HANDBACK_TOOL);
  const calls = message.toolUses.filter((use) => use.tool !== HANDBACK_TOOL);
  return [
    ...(message.text === ""
      ? []
      : [
          {
            isText: true,
            line: textBlock(ui, `${key}-text`, message.text, view, pressOf(index, view)),
          },
        ]),
    ...calls.map((use, i) => ({ isText: false, line: toolLine(ui, `${key}-tool${i}`, use, view) })),
    ...handbacks.map((use, i) => ({
      isText: true,
      line: textBlock(ui, `${key}-answer${i}-text`, handbackText(use), view),
    })),
  ];
}

function pressOf(index: number, view: TranscriptView): RowPress | undefined {
  return index === 0 && view.isExpanded ? view.collapse : undefined;
}

function handbackText(use: ToolUseSummary): string {
  const { message } = use.input;
  return typeof message === "string" ? message : "";
}

function roleOf(message: SessionMessage): string {
  return message.role === "user" ? "prompt" : "agent";
}

function headingRow(ui: Ui, key: string, label: string, width: number): Drawable {
  const { Box } = ui;
  return {
    rows: 1,
    draw: () => (
      <Box key={key} flexDirection="column">
        {header(ui, label, paneHeaderLook(), width)}
      </Box>
    ),
  };
}

function foldableHeading(ui: Ui, label: string, view: TranscriptView): Drawable {
  const { Button } = ui;
  return {
    rows: 1,
    draw: () => (
      <Button key="m0-role" label={label} plain dimColor={false} onPress={view.collapse}>
        {header(ui, label, paneHeaderLook(), view.width)}
      </Button>
    ),
  };
}

function textBlock(
  ui: Ui,
  key: string,
  text: string,
  view: TranscriptView,
  press?: RowPress,
): Drawable {
  const { Box } = ui;
  const width = view.width - TEXT_COLUMN;
  const blocks = parse(text, "kept");
  return {
    rows: blocks.length === 0 ? 0 : markdownRows(blocks, width),
    draw: () => (
      <Box key={key} flexDirection="column">
        {replyView(
          ui,
          {
            text,
            width,
            isFirstOfReply: false,
            stamp: "",
            surface: view.surface,
            accent: null,
            fills: paneFills(view.fills),
            lineBreaks: "kept",
            slashBreaks: true,
            isFlush: true,
          },
          { copy: view.copy, press },
        )}
      </Box>
    ),
  };
}

function markdownRows(blocks: Block[], width: number): number {
  const rows = blocks.reduce((sum, block) => sum + blockRows(block, width), 0);
  return rows + blocks.length - 1;
}

function blockRows(block: Block, width: number): number {
  if (block.kind === "paragraph") {
    return hangingRowCount(runsOf(block.inline), width, KEPT_LINE_HANG_CELLS);
  }
  return block.raw
    .split("\n")
    .reduce(
      (sum, line) => sum + Math.max(1, wrapRuns([{ text: line, style: null }], width, WRAP).length),
      0,
    );
}

type CallState = "done" | "running" | "failed" | "refused";

function toolsRows(ui: Ui, view: TranscriptView, room: number): Drawable[] {
  if (view.calls.length === 0) return [];
  const listRoom = room - TOOLS_HEAD_ROWS;
  const fits = view.isExpanded || view.calls.length <= listRoom;
  const shownCount = fits ? view.calls.length : Math.max(1, listRoom - 1);
  const newest = view.calls.slice(view.calls.length - shownCount);
  return [
    gapLine(ui, "tools-gap"),
    headingRow(ui, "tools-label", "tools", view.width),
    ...(fits
      ? []
      : [mutedRow(ui, "tools-earlier", `[ ${view.calls.length - shownCount} earlier ]`)]),
    ...newest.map((call) => toolCallRow(ui, call, view)),
  ];
}

function toolCallRow(ui: Ui, call: CallRecord, view: TranscriptView): Drawable {
  const { Box, Text } = ui;
  const duration = call.ms === UNMEASURED_MS ? "" : formatDuration(call.ms);
  const mark = markOf(stateOf(call.id, call.isErrored, call, view));
  return {
    rows: 1,
    draw: () => (
      <Box key={`call-${call.id}`} flexDirection="row" width={view.width} height={1} columnGap={1}>
        <Box flexShrink={0}>
          <Text color={mark.color}>{mark.text}</Text>
        </Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          {labelButton(ui, {
            key: `call-${call.id}`,
            label: callLabel(call, view),
            onPress: () => view.openCall(call.id),
          })}
        </Box>
        <Box flexShrink={0}>
          <Text color={paneInk().muted} wrap="truncate-end">
            {duration}
          </Text>
        </Box>
      </Box>
    ),
  };
}

function callLabel(call: CallRecord, view: TranscriptView): string {
  const prefix = `${call.tool}: `;
  if (call.target === "") return call.tool;
  if (!isPathTool(call.tool)) return `${prefix}${call.target}`;
  const room = Math.max(1, view.width - displayWidth(prefix) - DURATION_CELLS - MARK_CELLS);
  return `${prefix}${clipPathStart(relativePath(call.target, view.cwd), room)}`;
}

function toolLine(ui: Ui, key: string, use: ToolUseSummary, view: TranscriptView): Drawable {
  const call = view.calls.find((one) => one.id === use.tool_use_id);
  const state = stateOf(use.tool_use_id, use.isError === true, call, view);
  return markedRow(ui, key, state, toolText(use, view));
}

function toolText(use: ToolUseSummary, view: TranscriptView): string {
  const target = targetOf(use.input);
  if (target === "") return use.tool;
  const prefix = `${use.tool}: `;
  const room = Math.max(1, view.width - MARK_CELLS - displayWidth(prefix));
  const shownTarget = isPathTool(use.tool)
    ? clipPathStart(relativePath(target, view.cwd), room)
    : target;
  return `${prefix}${shownTarget}`;
}

function stateOf(
  id: string,
  isFailed: boolean,
  call: CallRecord | undefined,
  view: TranscriptView,
): CallState {
  if (call !== undefined && isDenied(call)) return "refused";
  if (isFailed) return "failed";
  return view.agent.running.some((one) => one.callId === id) ? "running" : "done";
}

function markOf(state: CallState): Part {
  if (state === "refused") return deniedDot();
  return statusDot(state);
}

function markedRow(ui: Ui, key: string, state: CallState, text: string): Drawable {
  return { rows: 1, draw: () => markedLine(ui, key, state, text) };
}

function markedLine(ui: Ui, key: string, state: CallState, text: string): RenderElement {
  const { Box, Text } = ui;
  const mark = markOf(state);
  const color = state === "failed" ? paneInk().text : paneInk().muted;
  return (
    <Box key={key} flexDirection="row" height={1} columnGap={1}>
      <Box flexShrink={0}>
        <Text color={mark.color}>{mark.text}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text color={color} wrap="truncate-end">
          {text}
        </Text>
      </Box>
    </Box>
  );
}

function mutedRow(ui: Ui, key: string, text: string): Drawable {
  return { rows: 1, draw: () => mutedLine(ui, key, text) };
}

function mutedLine({ Text }: Ui, key: string, text: string): RenderElement {
  return (
    <Text key={key} color={paneInk().muted} wrap="truncate-end">
      {text}
    </Text>
  );
}

function earlierButton({ Button, Text }: Ui, label: string, onPress: () => void): RenderElement {
  return (
    <Button key="earlier" label={label} plain dimColor onPress={onPress}>
      <Text color={paneInk().muted} wrap="truncate-end">
        {`[ ${label} ]`}
      </Text>
    </Button>
  );
}
