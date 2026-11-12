import type { ElementTable, RenderElement, UiPressArgument } from "claude-code";

import type { AgentStatus, SessionRow } from "../types";
import { dollars, formatAge, shortModel } from "./format";
import { paneInk } from "./pane-ink";
import type { Part } from "./pane-kit";
import { bar, button, header, paneHeaderLook, plural, statusDot } from "./pane-kit";
import { folderName, tildePath } from "./paths";
import type { SessionTail } from "./session-tail";
import { clipEnd, displayWidth, type Styled, wrapPlain, wrapRuns } from "./text-width";

type Ui = ElementTable;

export type SessionsView = {
  rows: SessionRow[];
  home: string | undefined;
  ownSessionId: string | undefined;
  width: number;
  now: number;
  tails: Record<number, SessionTail>;
  openPid: number | null;
  isSynced: boolean;
  open: (pid: number) => void;
  close: () => void;
  copy: (text: string, press: UiPressArgument) => void;
};

type Columns = {
  width: number;
  nameCells: number;
  stateCells: number;
  branchCells: number;
  promptCells: number;
  ctxCells: number;
  signCells: number;
  costCells: number;
};

type Layout = Columns & { labels: ReadonlyMap<number, FolderLabel> };

type FolderLabel = { parent: string | undefined; name: string; suffix: string };

type Cells = {
  dot: RenderElement;
  name: RenderElement;
  branch: RenderElement;
  state: RenderElement;
  prompt: RenderElement;
  ctx: RenderElement;
  cost: RenderElement;
};

const DOT_CELLS = 1;
const DOT_GAP_CELLS = 1;
const GAP_CELLS = 2;
const OWN_SUFFIX = " this";
const BRANCH_HEADER = "branch";
const CTX_HEADER = "ctx";
const COST_HEADER = "30d";
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const STATE_LABEL_CELLS = 12;
const AGE_CELLS = 3;
const STATE_CELLS = STATE_LABEL_CELLS + 1 + AGE_CELLS;
const PROMPT_MIN_COLUMNS = 100;
const PROMPT_CELLS = 40;
const MIN_TEXT_CELLS = 20;
const WORKING_WORD = "working";
const THINKING_WORD = "thinking";
const WAITING_GLYPH = "!";
const ALERT_SIGN = "!";
const ALERT_SLOT = `${ALERT_SIGN} `;
const NO_TAIL: SessionTail = { prompt: null, model: null, tool: null };
const CTX_ALERT_PERCENT = 80;
const CTX_BAR_CELLS = 12;
const DETAIL_LABEL_CELLS = 9;
const HANGING_CELLS = 2;
const FULL_PERCENT = 100;
const RESUME_COMMAND = "claude --resume";
const COPY_GAP_CELLS = 1;
const COPY_BUTTON_CELLS = "[ copy ]".length;
const COST_SIGN = /^[<$]+/;

export function sessionsTab(ui: Ui, view: SessionsView): RenderElement {
  const { Box, Text } = ui;
  const opened = view.rows.find((row) => row.pid === view.openPid);
  if (opened !== undefined) return sessionDetail(ui, opened, view);
  if (view.openPid !== null) return endedDetail(ui, view);
  if (view.rows.length === 0) {
    return (
      <Box flexDirection="column" width={view.width}>
        <Text color={paneInk().muted} wrap="truncate-end">
          no running sessions
        </Text>
      </Box>
    );
  }
  const layout = layoutOf(view);
  return (
    <Box flexDirection="column" width={view.width}>
      {summaryRow(ui, view)}
      <Box height={1} />
      {headerRow(ui, layout)}
      {sorted(view.rows, layout.labels).map((row) => sessionRow(ui, row, view, layout))}
    </Box>
  );
}

function summaryRow({ Text }: Ui, { rows, tails }: SessionsView): RenderElement {
  const waiting = rows.filter((row) => shownState(row) === "waiting").length;
  const running = rows.filter((row) => shownState(row) === "running");
  const working = running.filter((row) => (tails[row.pid] ?? NO_TAIL).tool !== null).length;
  const thinking = running.length - working;
  return (
    <Text wrap="truncate-end">
      <Text color={paneInk().text} weight="semibold">
        {String(rows.length)}
      </Text>
      <Text color={paneInk().muted}>{` ${plural("session", rows.length)}`}</Text>
      {countPart(Text, waiting, "waiting", paneInk().alert)}
      {countPart(Text, working, WORKING_WORD, paneInk().tool)}
      {countPart(Text, thinking, THINKING_WORD, paneInk().tool)}
    </Text>
  );
}

function countPart(
  Text: Ui["Text"],
  count: number,
  word: string,
  color: string | undefined,
): RenderElement | null {
  if (count === 0) return null;
  return (
    <Text color={paneInk().muted}>
      {" · "}
      <Text color={color}>{`${count} ${word}`}</Text>
    </Text>
  );
}

function headerRow(ui: Ui, columns: Columns): RenderElement {
  return gridRow(ui, columns, "header", {
    branch: figureText(ui, [mutedPart(BRANCH_HEADER)]),
    ctx: ctxCell(ui, [mutedPart(CTX_HEADER)], CTX_HEADER.length, columns.ctxCells),
    cost: figureText(ui, [mutedPart(COST_HEADER)]),
  });
}

function ctxCell(ui: Ui, shown: Part[], plainCells: number, columnCells: number): RenderElement {
  const padding = " ".repeat(Math.max(0, columnCells - plainCells));
  return figureText(ui, [{ text: padding, color: undefined }, ...shown]);
}

function sessionRow(ui: Ui, row: SessionRow, view: SessionsView, layout: Layout): RenderElement {
  const { Button, Text } = ui;
  const dot = dotOf(row);
  const tail = view.tails[row.pid] ?? NO_TAIL;
  const fullLabel = layout.labels.get(row.pid) ?? { parent: undefined, name: "", suffix: "" };
  const isSuffixMoved = labelWidth(fullLabel) > layout.nameCells && fullLabel.suffix !== "";
  const label = isSuffixMoved ? { ...fullLabel, suffix: "" } : fullLabel;
  return gridRow(ui, layout, String(row.pid), {
    dot: (
      <Text color={dot.color} wrap="truncate-end">
        {dot.text}
      </Text>
    ),
    state: figureText(ui, stateParts(view, row, tail)),
    name: (
      <Button
        key={`open-${row.pid}`}
        label={nameOf(row, view.home)}
        plain
        dimColor={false}
        onPress={() => view.open(row.pid)}
      >
        {nameText(ui, row, label, layout.nameCells)}
      </Button>
    ),
    branch: (
      <Text color={paneInk().muted} wrap="truncate-end">
        {clipEnd(isSuffixMoved ? fullLabel.suffix.trim() : row.branch, layout.branchCells)}
      </Text>
    ),
    prompt: (
      <Text color={paneInk().muted} wrap="truncate-end">
        {clipEnd(tail.prompt ?? "", layout.promptCells)}
      </Text>
    ),
    ctx: ctxCell(
      ui,
      alertedCtxParts(row.ctx),
      displayWidth(textOf(ctxParts(row.ctx))),
      layout.ctxCells,
    ),
    cost: figureText(ui, costParts(row.usd)),
  });
}

function sessionDetail(ui: Ui, row: SessionRow, view: SessionsView): RenderElement {
  const { Box, Text } = ui;
  const dot = dotOf(row);
  const tail = view.tails[row.pid] ?? NO_TAIL;
  const valueCells = Math.max(1, view.width - DETAIL_LABEL_CELLS);
  const command = `${RESUME_COMMAND} ${row.sessionId}`;
  const copyButton = button(ui, {
    key: "copy",
    label: "copy",
    onPress: (press) => view.copy(command, press),
  });
  const isCopyBeside = displayWidth(command) + COPY_GAP_CELLS + COPY_BUTTON_CELLS <= view.width;
  return (
    <Box flexDirection="column" width={view.width}>
      <Box flexDirection="row" columnGap={1} height={1}>
        {button(ui, { key: "back", label: "back", onPress: view.close })}
        {view.isSynced ? (
          <Text color={dot.color} wrap="truncate-end">
            {dot.text}
          </Text>
        ) : null}
        <Text wrap="truncate-end">
          <Text weight="semibold" color={paneInk().text}>
            {nameOf(row, view.home)}
          </Text>
          <Text color={paneInk().muted}>
            {row.sessionId === view.ownSessionId ? OWN_SUFFIX : ""}
          </Text>
        </Text>
        {figureText(ui, detailStateParts(view, row, tail))}
      </Box>
      <Box height={1} />
      {detailRow(ui, "path", hangingText(ui, row.cwd, valueCells, true))}
      {row.branch === "" ? null : detailRow(ui, "branch", valueText(ui, row.branch))}
      {tail.model === null ? null : detailRow(ui, "model", valueText(ui, shortModel(tail.model)))}
      {row.ctx === null ? null : detailRow(ui, "ctx", ctxMeter(ui, row.ctx))}
      {row.usd === null ? null : detailRow(ui, "30d cost", figureText(ui, costParts(row.usd)))}
      {detailRow(ui, "pid", valueText(ui, String(row.pid)))}
      {detailRow(ui, "session", valueText(ui, row.sessionId))}
      <Box height={1} />
      {header(ui, "Last prompt", paneHeaderLook(), view.width)}
      {tail.prompt === null ? (
        <Text color={paneInk().muted} wrap="truncate-end">
          {view.isSynced ? "no prompt yet" : "no prompt data yet"}
        </Text>
      ) : (
        hangingText(ui, tail.prompt, view.width)
      )}
      <Box height={1} />
      {header(ui, "Resume", paneHeaderLook(), view.width)}
      <Box flexDirection={isCopyBeside ? "row" : "column"} columnGap={COPY_GAP_CELLS}>
        {valueText(ui, command)}
        {copyButton}
      </Box>
    </Box>
  );
}

function hangingText(
  { Box, Text }: Ui,
  text: string,
  cells: number,
  isPath = false,
): RenderElement {
  const width = Math.max(1, cells - HANGING_CELLS);
  const lines: Styled<string | undefined>[][] = isPath
    ? wrapRuns(pathRuns(text), width, { isBreakingAfterSlash: true })
    : wrapPlain(text, width).map((line) => [{ text: line, style: paneInk().text }]);
  return (
    <Box flexDirection="column">
      {lines.map((runs, index) => (
        <Text key={String(index)} wrap="truncate-end">
          {index === 0 ? null : <Text color={paneInk().text}>{" ".repeat(HANGING_CELLS)}</Text>}
          {runs.map((run, runIndex) => (
            <Text key={String(runIndex)} color={run.style}>
              {run.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}

function pathRuns(path: string): Styled<string | undefined>[] {
  const cut = path.lastIndexOf("/") + 1;
  return [
    { text: path.slice(0, cut), style: paneInk().muted },
    { text: path.slice(cut), style: paneInk().text },
  ].filter((run) => run.text !== "");
}

function endedDetail(ui: Ui, view: SessionsView): RenderElement {
  const { Box, Text } = ui;
  return (
    <Box flexDirection="row" columnGap={1} width={view.width} height={1}>
      {button(ui, { key: "back", label: "back", onPress: view.close })}
      <Text color={paneInk().muted} wrap="truncate-end">
        session ended
      </Text>
    </Box>
  );
}

function detailRow({ Box, Text }: Ui, label: string, value: RenderElement): RenderElement {
  return (
    <Box key={label} flexDirection="row">
      <Box width={DETAIL_LABEL_CELLS} flexShrink={0}>
        <Text color={paneInk().muted} wrap="truncate-end">
          {label}
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {value}
      </Box>
    </Box>
  );
}

function valueText({ Text }: Ui, text: string): RenderElement {
  return (
    <Text color={paneInk().text} wrap="truncate-end">
      {text}
    </Text>
  );
}

function ctxMeter(ui: Ui, ctx: number): RenderElement {
  const { Box } = ui;
  const color = ctx >= CTX_ALERT_PERCENT ? paneInk().alert : paneInk().tool;
  return (
    <Box flexDirection="row" columnGap={1}>
      {bar(ui, ctx, FULL_PERCENT, CTX_BAR_CELLS, color)}
      {figureText(ui, alertedCtxParts(ctx))}
    </Box>
  );
}

function nameText(ui: Ui, row: SessionRow, label: FolderLabel, cells: number): RenderElement {
  const { Text } = ui;
  const weight = shownState(row) === "running" ? "semibold" : undefined;
  const nameCells = Math.max(1, cells - displayWidth(label.suffix));
  const full = `${label.parent === undefined ? "" : `${label.parent}/`}${label.name}`;
  const clipped = clipEnd(full, nameCells);
  const parentLength = label.parent === undefined ? 0 : label.parent.length + 1;
  const padding = " ".repeat(
    Math.max(0, cells - displayWidth(clipped) - displayWidth(label.suffix)),
  );
  return (
    <Text wrap="truncate-end">
      <Text color={paneInk().muted}>{clipped.slice(0, parentLength)}</Text>
      <Text color={paneInk().text} weight={weight}>
        {clipped.slice(parentLength)}
      </Text>
      <Text color={paneInk().muted}>{`${label.suffix}${padding}`}</Text>
    </Text>
  );
}

function shownState(row: SessionRow): AgentStatus {
  return row.statusWord === undefined || row.statusWord === null ? row.state : "idle";
}

function dotOf(row: SessionRow): Part {
  if (shownState(row) === "waiting") return { text: WAITING_GLYPH, color: paneInk().alert };
  return statusDot(shownState(row));
}

function detailStateParts(view: SessionsView, row: SessionRow, tail: SessionTail): Part[] {
  if (!view.isSynced) return [];
  const [word, age] = stateParts(view, row, tail);
  const ageText = age.text.trim();
  return [
    { ...word, text: word.text.trimEnd() },
    ...(ageText === "" ? [] : [{ ...age, text: ` ${ageText}` }]),
  ];
}

function stateParts(view: SessionsView, row: SessionRow, tail: SessionTail): [Part, Part] {
  const { now } = view;
  const state = shownState(row);
  const color = stateColor(state);
  const since = state === "running" && tail.tool !== null ? tail.tool.since : row.since;
  return [
    { text: stateWord(row, tail, state).padEnd(STATE_LABEL_CELLS), color },
    agePart(since, now),
  ];
}

function stateWord(row: SessionRow, tail: SessionTail, state: AgentStatus): string {
  const word = row.statusWord ?? (state === "running" ? THINKING_WORD : state);
  if (state !== "running" || row.statusWord) return clipEnd(word, STATE_LABEL_CELLS);
  if (tail.tool === null) return word;
  return clipEnd(`${WORKING_WORD} ${tail.tool.name}`, STATE_LABEL_CELLS);
}

function agePart(since: number | null | undefined, now: number): Part {
  if (since === null || since === undefined || Number.isNaN(since)) {
    return mutedPart(" ".repeat(1 + AGE_CELLS));
  }
  const ms = Math.max(0, now - since);
  const seconds = Math.floor(ms / MS_PER_SECOND);
  const age = seconds < SECONDS_PER_MINUTE ? `${seconds}s` : formatAge(ms);
  return mutedPart(` ${age.padStart(AGE_CELLS)}`);
}

function stateColor(state: AgentStatus): string | undefined {
  if (state === "running") return paneInk().tool;
  if (state === "waiting") return paneInk().alert;
  return paneInk().muted;
}

function figureText({ Text }: Ui, parts: Part[]): RenderElement {
  return (
    <Text wrap="truncate-end">
      {parts.map((part, index) => (
        <Text
          key={String(index)}
          color={part.color}
          weight={part.bold ? "semibold" : undefined}
          wrap="truncate-end"
        >
          {part.text}
        </Text>
      ))}
    </Text>
  );
}

function gridRow(ui: Ui, columns: Columns, key: string, cells: Partial<Cells>): RenderElement {
  const { Box } = ui;
  return (
    <Box key={key} flexDirection="row" width={columns.width} height={1}>
      <Box width={DOT_CELLS} flexShrink={0}>
        {cells.dot}
      </Box>
      <Box width={columns.stateCells} marginLeft={DOT_GAP_CELLS} flexShrink={0}>
        {cells.state}
      </Box>
      <Box width={columns.nameCells} marginLeft={GAP_CELLS} flexShrink={0}>
        {cells.name}
      </Box>
      <Box width={columns.branchCells} marginLeft={GAP_CELLS} flexShrink={0}>
        {cells.branch}
      </Box>
      {columns.promptCells === 0 ? null : (
        <Box width={columns.promptCells} marginLeft={GAP_CELLS} flexShrink={0}>
          {cells.prompt}
        </Box>
      )}
      <Box width={columns.ctxCells + columns.signCells} marginLeft={GAP_CELLS} flexShrink={0}>
        {cells.ctx}
      </Box>
      <Box
        width={columns.costCells}
        marginLeft={GAP_CELLS - columns.signCells}
        flexShrink={0}
        justifyContent="flex-end"
      >
        {cells.cost}
      </Box>
    </Box>
  );
}

function sorted(rows: SessionRow[], labels: ReadonlyMap<number, FolderLabel>): SessionRow[] {
  const shown = (row: SessionRow): string => {
    const label = labels.get(row.pid);
    return `${label?.parent === undefined ? "" : `${label.parent}/`}${label?.name ?? ""}`.toLowerCase();
  };
  return [...rows].sort(
    (a, b) =>
      Number(shownState(a) !== "waiting") - Number(shownState(b) !== "waiting") ||
      shown(a).localeCompare(shown(b)) ||
      a.pid - b.pid,
  );
}

function nameOf(row: SessionRow, home: string | undefined): string {
  const path = tildePath(row.cwd, home);
  return path === "~" ? path : folderName(path) || path;
}

function parentOf(row: SessionRow, home: string | undefined): string | undefined {
  const path = tildePath(row.cwd, home);
  const cut = path.lastIndexOf("/");
  return cut <= 0 ? undefined : folderName(path.slice(0, cut));
}

function labelsOf(view: SessionsView): Map<number, FolderLabel> {
  const names = view.rows.map((row) => nameOf(row, view.home));
  const repeated = new Set(names.filter((name, index) => names.indexOf(name) !== index));
  return new Map(
    view.rows.map((row) => {
      const name = nameOf(row, view.home);
      return [
        row.pid,
        {
          name,
          parent: repeated.has(name) ? parentOf(row, view.home) : undefined,
          suffix: row.sessionId === view.ownSessionId ? OWN_SUFFIX : "",
        },
      ];
    }),
  );
}

function labelWidth(label: FolderLabel): number {
  const parentCells = label.parent === undefined ? 0 : displayWidth(`${label.parent}/`);
  return parentCells + displayWidth(label.name) + displayWidth(label.suffix);
}

function layoutOf(view: SessionsView): Layout {
  const labels = labelsOf(view);
  const ctxCells = Math.max(
    CTX_HEADER.length,
    widestCells(view.rows, (row) => ctxParts(row.ctx)),
  );
  const costCells = Math.max(
    COST_HEADER.length,
    widestCells(view.rows, (row) => costParts(row.usd)),
  );
  const hasPrompt = view.width >= PROMPT_MIN_COLUMNS;
  const fixedCells = DOT_CELLS + DOT_GAP_CELLS + STATE_CELLS + ctxCells + costCells + GAP_CELLS * 4;
  const flexibleCells = Math.max(0, view.width - fixedCells);
  const promptCells = hasPrompt
    ? Math.max(0, Math.min(PROMPT_CELLS, flexibleCells - GAP_CELLS - MIN_TEXT_CELLS))
    : 0;
  const textCells = flexibleCells - (promptCells === 0 ? 0 : promptCells + GAP_CELLS);
  const longestName = Math.max(...[...labels.values()].map(labelWidth));
  const longestBranch = Math.max(...view.rows.map((row) => displayWidth(row.branch)));
  const nameCells = Math.max(1, Math.min(longestName, textCells - BRANCH_HEADER.length));
  const branchCells = Math.max(
    0,
    Math.min(Math.max(longestBranch, BRANCH_HEADER.length), textCells - nameCells),
  );
  return {
    width: view.width,
    nameCells,
    stateCells: STATE_CELLS,
    branchCells,
    promptCells,
    ctxCells,
    signCells: view.rows.some((row) => (row.ctx ?? 0) >= CTX_ALERT_PERCENT) ? ALERT_SLOT.length : 0,
    costCells,
    labels,
  };
}

function widestCells(rows: SessionRow[], partsOf: (row: SessionRow) => Part[]): number {
  return Math.max(...rows.map((row) => displayWidth(textOf(partsOf(row)))));
}

function textOf(parts: Part[]): string {
  return parts.map((part) => part.text).join("");
}

function ctxParts(ctx: number | null): Part[] {
  if (ctx === null) return [];
  const digits = digitsPart(String(ctx));
  if (ctx < CTX_ALERT_PERCENT) return [digits, mutedPart("%")];
  return [{ ...digits, color: paneInk().alert, bold: true }, mutedPart("%")];
}

function alertedCtxParts(ctx: number | null): Part[] {
  if (ctx === null || ctx < CTX_ALERT_PERCENT) return ctxParts(ctx);
  const alert = paneInk().alert;
  return [
    { ...digitsPart(String(ctx)), color: alert, bold: true },
    mutedPart("%"),
    { text: ALERT_SLOT, color: alert, bold: true },
  ];
}

function costParts(usd: number | null): Part[] {
  if (usd === null) return [];
  const text = dollars(usd);
  const sign = COST_SIGN.exec(text)?.[0] ?? "";
  return [mutedPart(sign), digitsPart(text.slice(sign.length))];
}

function digitsPart(digits: string): Part {
  return { text: digits, color: numberColor(digits) };
}

function mutedPart(text: string): Part {
  return { text, color: paneInk().muted };
}

function numberColor(digits: string): string | undefined {
  return Number(digits) === 0 ? paneInk().muted : paneInk().text;
}
