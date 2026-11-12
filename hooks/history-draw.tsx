import type { ElementTable, RenderElement, UiPressArgument } from "claude-code";

import type { HistoryEntry, PastMatch, TranscriptState } from "../types";
import { clockOf, dollars, formatDuration, singleLine } from "./format";
import { FILTER_KEY, header, paneHeaderLook, plural } from "./pane-kit";
import { paneInk } from "./pane-ink";
import type { RowCosts } from "./history-cost";
import { PAST_LIMIT, readable } from "./history-search";
import { clipEnd, displayWidth } from "./text-width";

type Ui = ElementTable;

export type HistoryView = {
  width: number;
  entries: HistoryEntry[];
  costs: RowCosts;
  texts: Map<string, string>;
  filter: string;
  past: PastMatch[] | null;
  cwd: string;
  selectPast: (id: string) => void;
  resume: (sessionId: string) => void;
  copy: (text: string, press: UiPressArgument) => void;
  transcript?: TranscriptState;
  setFilter: (text: string) => void;
  focusFilter: () => void;
  jump: (id: string) => void;
  selected: string;
  openReplies: string[];
  openProjects: string[];
  toggleReplies: (id: string) => void;
  openProject: (project: string) => void;
};

const FILTER_PLACEHOLDER = "search this and past sessions";
const MIN_COST_USD = 0.01;
const PENDING_COST = "-";
const ALERT_MEAN_FACTOR = 3;
const PAST_ROWS_PER_PROJECT = 5;
const FAILED_MARK = "✗";
const FOLDED_MARK = "▸";
const OPEN_MARK = "▾";
const PAST_TITLE = "past sessions";
const SESSION_TITLE = "this session";
const SEARCHING = "searching…";
const DATE_CELLS = 6;
const PROJECT_SHARE = 0.26;
const BRANCH_SHARE = 0.15;
const PAST_LINE_SHARE = 0.5;
const MIN_BRANCH_CELLS = 4;
const SEPARATOR = " · ";
const LINE_BREAK = /\r?\n|\r/;
const REPLY_MARK = "↳";
const LEAD_CHARS = 8;
const ROW_GAP_CELLS = 2;
const REPLY_INDENT = 2;
const OPEN_REPLY_INDENT = 4;
const COLUMN_GAP = 1;
const MARK_CELLS = 2;
const PAST_FIXED_CELLS = DATE_CELLS + ROW_GAP_CELLS + SEPARATOR.length + ROW_GAP_CELLS + MARK_CELLS;
const RESUME_LABEL = "resume";
const COPY_COMMAND_LABEL = "copy resume command";

type Columns = { failed: number; tools: number; duration: number; cost: number };

type RowLook = {
  columns: Columns;
  costs: RowCosts;
  provenCosts: { sum: number; count: number };
  needle: string;
  replies: Map<string, HistoryEntry[]>;
};

export function historyTab(ui: Ui, view: HistoryView): RenderElement {
  const { Box, Text } = ui;
  const needle = view.filter.toLowerCase();
  const shown = view.entries.filter((entry) =>
    needle === "" ? entry.kind === "prompt" : textOf(view, entry).toLowerCase().includes(needle),
  );
  const look: RowLook = {
    columns: columnsOf(shown, view.costs),
    costs: view.costs,
    provenCosts: provenCosts(view.costs),
    needle,
    replies: repliesByPrompt(view.entries),
  };
  const spansDays = needle === "" && dayCount(shown) > 1;
  return (
    <Box flexDirection="column" width={view.width}>
      {summaryRow(ui, view)}
      {filterRow(ui, view)}
      {needle === "" ? null : blankRow(ui, "session-gap", view.width)}
      {needle === "" ? null : header(ui, SESSION_TITLE, paneHeaderLook(), view.width)}
      {shown.length === 0 ? (
        <Text color={paneInk().muted} wrap="truncate-end">
          {fitted(needle === "" ? emptyText(view.transcript) : "no matches", view.width)}
        </Text>
      ) : (
        shown.flatMap((entry, at) =>
          entry.kind === "prompt"
            ? [
                ...(spansDays && startsDay(shown, at)
                  ? dateRows(ui, entry, view.width, at === 0)
                  : []),
                ...promptRows(ui, view, entry, look),
              ]
            : [replyRow(ui, view, entry, needle)],
        )
      )}
      {view.filter === "" ? null : pastSection(ui, view, view.past)}
    </Box>
  );
}

function blankRow(ui: Ui, key: string, width: number): RenderElement {
  const { Box, Text } = ui;
  return (
    <Box key={key} height={1} flexShrink={0}>
      <Text wrap="truncate-end">{" ".repeat(width)}</Text>
    </Box>
  );
}

function summaryRow(ui: Ui, view: HistoryView): RenderElement | null {
  const { Text } = ui;
  const prompts = view.entries.filter((entry) => entry.kind === "prompt");
  if (prompts.length === 0) return null;
  const rowCosts = [...view.costs.values()];
  const isPending = rowCosts.includes(null);
  const total = rowCosts.reduce<number>((sum, usd) => sum + (usd ?? 0), 0);
  const count = String(prompts.length);
  const noun = ` ${plural("prompt", prompts.length)}`;
  const money = isPending || total < MIN_COST_USD ? "" : dollars(total);
  const used =
    displayWidth(count + noun) +
    (isPending ? SEPARATOR.length + PENDING_COST.length : 0) +
    (money === "" ? 0 : SEPARATOR.length + money.length);
  return (
    <Text key="summary-row" wrap="truncate-end">
      <Text color={paneInk().text} weight="semibold">
        {count}
      </Text>
      <Text color={paneInk().muted}>{noun}</Text>
      {isPending ? <Text color={paneInk().muted}>{`${SEPARATOR}${PENDING_COST}`}</Text> : null}
      {money === "" ? null : <Text color={paneInk().muted}>{SEPARATOR}</Text>}
      {money === "" ? null : <Text color={paneInk().text}>{money}</Text>}
      <Text>{" ".repeat(Math.max(0, view.width - used))}</Text>
    </Text>
  );
}

function dayOf(entry: HistoryEntry): string {
  return new Date(entry.at).toDateString();
}

function dayCount(prompts: HistoryEntry[]): number {
  return new Set(prompts.map(dayOf)).size;
}

function startsDay(prompts: HistoryEntry[], at: number): boolean {
  const before = prompts[at - 1];
  return before === undefined || dayOf(before) !== dayOf(prompts[at]!);
}

function dateRows(ui: Ui, entry: HistoryEntry, width: number, isFirst: boolean): RenderElement[] {
  const { Box } = ui;
  return [
    ...(isFirst ? [] : [blankRow(ui, `date-gap-${entry.id}`, width)]),
    <Box key={`date-${entry.id}`} flexShrink={0}>
      {header(ui, dateOf(entry.at), paneHeaderLook(), width)}
    </Box>,
  ];
}

function repliesByPrompt(entries: HistoryEntry[]): Map<string, HistoryEntry[]> {
  const replies = new Map<string, HistoryEntry[]>();
  let turn: HistoryEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === "prompt") {
      turn = [];
      replies.set(entry.id, turn);
      continue;
    }
    turn.push(entry);
  }
  return replies;
}

function columnsOf(shown: HistoryEntry[], costs: RowCosts): Columns {
  const prompts = shown.filter((entry) => entry.kind === "prompt");
  const widest = (text: (entry: HistoryEntry) => string): number =>
    Math.max(0, ...prompts.map((entry) => displayWidth(text(entry))));
  return {
    failed: widest(failedText),
    tools: widest(toolsText),
    duration: widest(durationText),
    cost: widest((entry) => costText(costs, entry)),
  };
}

function failedText(entry: HistoryEntry): string {
  return entry.failed !== undefined && entry.failed > 0 ? `${FAILED_MARK} ${entry.failed}` : "";
}

function toolsText(entry: HistoryEntry): string {
  return entry.tools !== undefined && entry.tools > 0
    ? `${entry.tools} ${plural("tool", entry.tools)}`
    : "";
}

function durationText(entry: HistoryEntry): string {
  return entry.ms !== undefined && entry.ms > 0 ? formatDuration(entry.ms) : "";
}

function costText(costs: RowCosts, entry: HistoryEntry): string {
  const usd = costs.get(entry.id);
  if (usd === null) return PENDING_COST;
  return usd !== undefined && usd >= MIN_COST_USD ? dollars(usd) : "";
}

function provenCosts(costs: RowCosts): { sum: number; count: number } {
  const proven = [...costs.values()].filter((usd): usd is number => usd !== null);
  return { sum: proven.reduce((sum, usd) => sum + usd, 0), count: proven.length };
}

function costColor(look: RowLook, entry: HistoryEntry): string | undefined {
  const usd = look.costs.get(entry.id);
  const { sum, count } = look.provenCosts;
  if (usd === undefined || usd === null || usd < MIN_COST_USD || count < 2) return paneInk().text;
  const isAlert = usd >= (ALERT_MEAN_FACTOR * (sum - usd)) / (count - 1);
  return isAlert ? paneInk().alert : paneInk().text;
}

function emptyText(transcript: TranscriptState | undefined): string {
  if (transcript === "reading") return "reading transcript…";
  if (transcript === "unreadable") return "transcript could not be read";
  return "no prompts yet";
}

function pastSection(ui: Ui, view: HistoryView, past: PastMatch[] | null): RenderElement {
  const { Box, Text } = ui;
  const { projectCells, branchCells } = pastColumnsOf(view.width, past ?? []);
  return (
    <Box key="past" flexDirection="column" width={view.width}>
      {blankRow(ui, "past-gap", view.width)}
      {header(ui, PAST_TITLE, paneHeaderLook(), view.width)}
      {past === null ? (
        <Text color={paneInk().muted} wrap="truncate-end">
          {fitted(SEARCHING, view.width)}
        </Text>
      ) : past.length === 0 ? (
        <Text color={paneInk().muted} wrap="truncate-end">
          {fitted("no matches in past sessions", view.width)}
        </Text>
      ) : (
        projectGroups(past).flatMap(([project, matches]) =>
          projectRows(ui, view, project, matches, { projectCells, branchCells }),
        )
      )}
      {past !== null && past.length >= PAST_LIMIT ? (
        <Text color={paneInk().muted} wrap="truncate-end">
          {fitted(`first ${PAST_LIMIT} matches shown`, view.width)}
        </Text>
      ) : null}
    </Box>
  );
}

type PastColumns = { projectCells: number; branchCells: number };

function pastColumnsOf(width: number, past: PastMatch[]): PastColumns {
  const room = Math.max(0, width - PAST_FIXED_CELLS - Math.ceil(width * PAST_LINE_SHARE));
  const wantedProject = columnCells(
    past,
    (match) => match.project,
    Math.floor(width * PROJECT_SHARE),
  );
  const branchCells = columnCells(
    past,
    (match) => match.branch,
    Math.min(Math.floor(width * BRANCH_SHARE), Math.max(MIN_BRANCH_CELLS, room - wantedProject)),
  );
  return { projectCells: Math.min(wantedProject, Math.max(0, room - branchCells)), branchCells };
}

function projectGroups(past: PastMatch[]): [string, PastMatch[]][] {
  const groups = new Map<string, PastMatch[]>();
  for (const match of past) {
    const group = groups.get(match.project) ?? [];
    group.push(match);
    groups.set(match.project, group);
  }
  return [...groups];
}

function projectRows(
  ui: Ui,
  view: HistoryView,
  project: string,
  matches: PastMatch[],
  columns: PastColumns,
): RenderElement[] {
  const { Box, Button, Text } = ui as ElementTable<"terminal">;
  const isOpen = view.openProjects.includes(project);
  const visible = isOpen ? matches : matches.slice(0, PAST_ROWS_PER_PROJECT);
  const rows = visible.flatMap((match, at) => [
    pastRow(ui, view, match, `${project}-${at}`, columns),
    ...(view.selected === pastId(match) ? resumeRows(ui, view, match, `${project}-${at}`) : []),
  ]);
  if (visible.length === matches.length) return rows;
  const key = `past-more-${project}`;
  return [
    ...rows,
    <Box key={key} width={view.width} height={1}>
      <Button
        key={`${key}-button`}
        label={`+${matches.length - visible.length} more`}
        plain
        dimColor={false}
        onPress={() => view.openProject(project)}
      >
        <Text color={paneInk().muted} wrap="truncate-end">
          {fitted(`+${matches.length - visible.length} more`, view.width)}
        </Text>
      </Button>
    </Box>,
  ];
}

function pastId(match: PastMatch): string {
  return `past:${match.sessionId ?? ""}:${match.date}:${match.line}`;
}

function resumeRows(ui: Ui, view: HistoryView, match: PastMatch, rowKey: string): RenderElement[] {
  const { Box, Button, Text } = ui as ElementTable<"terminal">;
  const { sessionId, cwd } = match;
  if (sessionId === undefined || cwd === undefined) return [];
  const isSameFolder = cwd === view.cwd;
  const quotedCwd = shellQuoted(cwd);
  const command = `cd ${quotedCwd} && claude --resume ${sessionId}`;
  const actions = (
    <Box key={`past-actions-${rowKey}`} marginLeft={REPLY_INDENT} height={1}>
      <Button
        key={isSameFolder ? `past-resume-${rowKey}` : `past-copy-${rowKey}`}
        label={isSameFolder ? RESUME_LABEL : COPY_COMMAND_LABEL}
        plain
        dimColor
        onPress={isSameFolder ? () => view.resume(sessionId) : (press) => view.copy(command, press)}
      />
    </Box>
  );
  if (isSameFolder) return [actions];
  return [
    actions,
    <Box key={`past-command-${rowKey}`} marginLeft={REPLY_INDENT} height={1}>
      <Text color={paneInk().muted} wrap="truncate-end">
        {previewOf(quotedCwd, sessionId, view.width - REPLY_INDENT)}
      </Text>
    </Box>,
  ];
}

function previewOf(quotedCwd: string, sessionId: string, cells: number): string {
  const tail = ` && claude --resume ${sessionId}`;
  return `cd ${clipEnd(quotedCwd, cells - tail.length - "cd ".length)}${tail}`;
}

function shellQuoted(path: string): string {
  return /^[\w@%+=:,./-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;
}

function columnCells(past: PastMatch[], pick: (match: PastMatch) => string, limit: number): number {
  return Math.min(limit, Math.max(0, ...past.map((match) => displayWidth(pick(match)))));
}

function fitted(text: string, cells: number): string {
  const clipped = clipEnd(text, cells);
  return clipped + " ".repeat(Math.max(0, cells - displayWidth(clipped)));
}

function pastRow(
  ui: Ui,
  view: HistoryView,
  match: PastMatch,
  rowKey: string,
  columns: PastColumns,
): RenderElement {
  const { Box, Button, Text } = ui;
  const id = pastId(match);
  const isSelected = view.selected === id;
  const fill = fillOf(isSelected);
  const lineCells =
    view.width -
    (DATE_CELLS + ROW_GAP_CELLS) -
    columns.projectCells -
    displayWidth(SEPARATOR) -
    columns.branchCells -
    ROW_GAP_CELLS -
    MARK_CELLS;
  const line = clipEnd(
    windowAroundMatch(match.line, view.filter.trim().toLowerCase(), lineCells),
    lineCells,
  );
  const mark = match.isReply === true ? `${REPLY_MARK} ` : " ".repeat(MARK_CELLS);
  const key = `past-button-${rowKey}`;
  const [dateText, projectText, branchText, lineText] = [
    `${fitted(dateOf(match.date), DATE_CELLS)}  `,
    fitted(match.project, columns.projectCells),
    `${SEPARATOR}${fitted(match.branch, columns.branchCells)}  `,
    fitted(`${mark}${line}`, lineCells + MARK_CELLS),
  ];
  return (
    <Box key={`past-${rowKey}`} width={view.width} height={1} backgroundColor={fill}>
      <Button
        key={key}
        label={`${dateText}${projectText}${branchText}${lineText}`}
        plain
        dimColor={false}
        hover={isSelected ? undefined : { color: paneInk().text ?? paneInk().section, scope: key }}
        onPress={() => view.selectPast(id)}
      >
        <Text backgroundColor={fill} wrap="truncate-end">
          <Text
            color={inkOf(isSelected, paneInk().muted)}
            backgroundColor={fill}
            wrap="truncate-end"
          >
            {dateText}
          </Text>
          <Text
            color={inkOf(isSelected, paneInk().text)}
            backgroundColor={fill}
            wrap="truncate-end"
          >
            {projectText}
          </Text>
          <Text
            color={inkOf(isSelected, paneInk().muted)}
            backgroundColor={fill}
            wrap="truncate-end"
          >
            {branchText}
          </Text>
          <Text
            color={inkOf(isSelected, match.isReply === true ? paneInk().muted : paneInk().text)}
            backgroundColor={fill}
            wrap="truncate-end"
          >
            {lineText}
          </Text>
        </Text>
      </Button>
    </Box>
  );
}

function windowAroundMatch(line: string, needle: string, cells: number): string {
  const matchAt = line.toLowerCase().indexOf(needle);
  if (matchAt <= 0 || needle === "" || displayWidth(line) <= cells) return line;
  const lead = Math.max(0, Math.min(LEAD_CHARS, cells - 1 - displayWidth(needle)));
  const from = matchAt - lead;
  if (from <= 0) return line;
  const space = line.indexOf(" ", from);
  return `…${line.slice(space >= 0 && space < matchAt ? space + 1 : matchAt)}`;
}

function dateOf(timestamp: string | number): string {
  return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function filterRow(ui: Ui, view: HistoryView): RenderElement {
  const { Box, Button, Input, Text } = ui as ElementTable<"terminal">;
  return (
    <Box key="filter-row" flexDirection="row">
      <Box flexShrink={0}>
        <Button
          key="filter-open"
          label="filter"
          plain
          dimColor
          hotkey="f"
          onPress={view.focusFilter}
        />
      </Box>
      <Box flexShrink={0}>
        <Text> </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Input
          key={FILTER_KEY}
          placeholder={FILTER_PLACEHOLDER}
          submitLabel={view.filter ? "clear" : ""}
          value={view.filter}
          onInput={view.setFilter}
          onSubmit={() => view.setFilter("")}
        />
      </Box>
    </Box>
  );
}

function promptRows(
  ui: Ui,
  view: HistoryView,
  entry: HistoryEntry,
  look: RowLook,
): RenderElement[] {
  const row = promptRow(ui, view, entry, look);
  if (look.needle !== "") return [row];
  const replies = look.replies.get(entry.id) ?? [];
  const last = replies[replies.length - 1];
  if (last === undefined) return [row];
  const isOpen = view.openReplies.includes(entry.id);
  return [
    row,
    replyToggle(ui, view, entry.id, last, isOpen),
    ...(isOpen ? replies.flatMap((reply) => openReplyRows(ui, view, reply)) : []),
  ];
}

function replyToggle(
  ui: Ui,
  view: HistoryView,
  promptId: string,
  last: HistoryEntry,
  isOpen: boolean,
): RenderElement {
  const { Box, Button, Text } = ui as ElementTable<"terminal">;
  const line = (replyLines(textOf(view, last))[0] ?? "").trim();
  const label = isOpen ? `${OPEN_MARK} reply` : `${FOLDED_MARK} ${line}`;
  const shown = clipEnd(label, view.width - REPLY_INDENT);
  return (
    <Box key={`toggle-${promptId}`} width={view.width} height={1}>
      <Button
        key={`toggle-button-${promptId}`}
        label={shown}
        plain
        dimColor={false}
        onPress={() => view.toggleReplies(promptId)}
      >
        <Text color={paneInk().muted} wrap="truncate-end">
          {fitted(`${" ".repeat(REPLY_INDENT)}${shown}`, view.width)}
        </Text>
      </Button>
    </Box>
  );
}

function replyLines(text: string): string[] {
  return text
    .split(LINE_BREAK)
    .map(readable)
    .filter((one) => one !== "");
}

function openReplyRows(ui: Ui, view: HistoryView, entry: HistoryEntry): RenderElement[] {
  const { Box, Button, Text } = ui as ElementTable<"terminal">;
  const isSelected = view.selected === entry.id;
  const fill = fillOf(isSelected);
  return replyLines(textOf(view, entry)).map((line, at) => {
    const key = at === 0 ? `reply-button-${entry.id}` : `reply-button-${entry.id}-${at}`;
    const shown = clipEnd(line.trim(), view.width - OPEN_REPLY_INDENT);
    return (
      <Box key={key.replace("button", "row")} width={view.width} height={1} backgroundColor={fill}>
        <Button key={key} label={shown} plain dimColor={false} onPress={() => view.jump(entry.id)}>
          <Text
            color={inkOf(isSelected, paneInk().muted)}
            backgroundColor={fill}
            weight={isSelected ? "semibold" : undefined}
            wrap="truncate-end"
          >
            {fitted(`${" ".repeat(OPEN_REPLY_INDENT)}${shown}`, view.width)}
          </Text>
        </Button>
      </Box>
    );
  });
}

function promptRow(ui: Ui, view: HistoryView, entry: HistoryEntry, look: RowLook): RenderElement {
  const { Box, Button, Text } = ui;
  const { columns, needle } = look;
  const cells = [columns.failed, columns.tools, columns.duration, columns.cost].filter(
    (width) => width > 0,
  );
  const labelCells = view.width - cells.reduce((sum, width) => sum + width + COLUMN_GAP, 0);
  const line = matchingLine(textOf(view, entry), needle) ?? "";
  const key = `prompt-button-${entry.id}`;
  const clock = clockOf(entry.at);
  const isSelected = view.selected === entry.id;
  const fill = fillOf(isSelected);
  const shown = windowAroundMatch(
    singleLine(line),
    needle,
    labelCells - clock.length - ROW_GAP_CELLS,
  );
  const label = clipEnd(`${clock}  ${shown}`, labelCells);
  const cellTexts = [
    failedText(entry),
    toolsText(entry),
    durationText(entry),
    costText(look.costs, entry),
  ].filter((text) => text !== "");
  const cell = (text: string, width: number, color: string | undefined): RenderElement => (
    <Text color={text === "" ? undefined : color} backgroundColor={fill} wrap="truncate-end">
      {text.padStart(width + COLUMN_GAP)}
    </Text>
  );
  return (
    <Box key={`prompt-${entry.id}`} width={view.width} height={1} backgroundColor={fill}>
      <Button
        key={key}
        label={[label, ...cellTexts].join(" ")}
        plain
        dimColor={false}
        hover={isSelected ? undefined : { color: paneInk().text ?? paneInk().section, scope: key }}
        onPress={() => view.jump(entry.id)}
      >
        <Text backgroundColor={fill} wrap="truncate-end">
          <Text
            color={inkOf(isSelected, paneInk().muted)}
            backgroundColor={fill}
            wrap="truncate-end"
          >
            {label.slice(0, clock.length)}
          </Text>
          <Text
            color={inkOf(isSelected, paneInk().text)}
            backgroundColor={fill}
            weight={isSelected ? "semibold" : undefined}
            wrap="truncate-end"
          >
            {fitted(label.slice(clock.length), labelCells - clock.length)}
          </Text>
          {columns.failed > 0 ? cell(failedText(entry), columns.failed, paneInk().failed) : null}
          {columns.tools > 0 ? toolsCell(ui, entry, columns.tools, isSelected) : null}
          {columns.duration > 0
            ? cell(durationText(entry), columns.duration, inkOf(isSelected, paneInk().muted))
            : null}
          {columns.cost > 0
            ? cell(
                costText(look.costs, entry),
                columns.cost,
                isSelected ? paneInk().tabText : costColor(look, entry),
              )
            : null}
        </Text>
      </Button>
    </Box>
  );
}

function fillOf(isSelected: boolean): string | undefined {
  return isSelected ? paneInk().tabFill : undefined;
}

function inkOf(isSelected: boolean, color: string | undefined): string | undefined {
  return isSelected ? paneInk().tabText : color;
}

function toolsCell(ui: Ui, entry: HistoryEntry, cells: number, isSelected: boolean): RenderElement {
  const { Text } = ui;
  const count = entry.tools ?? 0;
  const noun = count > 0 ? ` ${plural("tool", count)}` : "";
  const number = count > 0 ? String(count) : "";
  const fill = fillOf(isSelected);
  return (
    <Text key="tools-cell" backgroundColor={fill} wrap="truncate-end">
      {" ".repeat(Math.max(0, cells + COLUMN_GAP - displayWidth(number) - displayWidth(noun)))}
      <Text
        color={count > 0 ? inkOf(isSelected, paneInk().text) : undefined}
        backgroundColor={fill}
      >
        {number}
      </Text>
      <Text
        color={count > 0 ? inkOf(isSelected, paneInk().muted) : undefined}
        backgroundColor={fill}
      >
        {noun}
      </Text>
    </Text>
  );
}

function replyRow(ui: Ui, view: HistoryView, entry: HistoryEntry, needle: string): RenderElement {
  const { Box, Button, Text } = ui as ElementTable<"terminal">;
  const line = matchingLine(textOf(view, entry), needle) ?? "";
  const clock = clockOf(entry.at);
  const lead = `${REPLY_MARK} ${clock}  `;
  const cells = view.width - REPLY_INDENT - displayWidth(lead);
  const shown = clipEnd(windowAroundMatch(singleLine(line), needle, cells), cells);
  const isSelected = view.selected === entry.id;
  const fill = fillOf(isSelected);
  const color = isSelected ? paneInk().tabText : undefined;
  return (
    <Box key={`reply-${entry.id}`} width={view.width} height={1} backgroundColor={fill}>
      <Button
        key={`reply-button-${entry.id}`}
        label={clipEnd(`${lead}${shown}`, view.width - REPLY_INDENT)}
        plain
        dimColor={!isSelected}
        onPress={() => view.jump(entry.id)}
      >
        <Text backgroundColor={fill} wrap="truncate-end">
          <Text color={color} backgroundColor={fill}>
            {`${" ".repeat(REPLY_INDENT)}${REPLY_MARK} `}
          </Text>
          <Text color={color} backgroundColor={fill}>
            {clock}
          </Text>
          <Text color={color} backgroundColor={fill} weight={isSelected ? "semibold" : undefined}>
            {fitted(`  ${shown}`, cells + ROW_GAP_CELLS)}
          </Text>
        </Text>
      </Button>
    </Box>
  );
}

function textOf(view: HistoryView, entry: HistoryEntry): string {
  return view.texts.get(entry.id) ?? "";
}

function matchingLine(text: string, needle: string): string | undefined {
  return text.split(LINE_BREAK).find((one) => one.toLowerCase().includes(needle));
}
