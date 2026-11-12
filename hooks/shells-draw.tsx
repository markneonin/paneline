import type { ElementTable, RenderElement } from "claude-code";

import type { AgentStatus, ListeningPort, Shell, ShellOpen } from "../types";
import { formatDuration, singleLine } from "./format";
import { header, labelButton, paneHeaderLook, plural, statusDot } from "./pane-kit";
import type { Part } from "./pane-kit";
import { paneInk } from "./pane-ink";
import { clipEndAtWord, displayWidth } from "./text-width";

type Ui = ElementTable;

export type ShellsView = {
  shells: Shell[];
  tails: Record<string, string[]>;
  open: ShellOpen | null;
  ports: ListeningPort[] | null;
  now: number;
  width: number;
  toggle: (id: string) => void;
  askKill: (id: string) => void;
  confirmKill: (id: string) => void;
};

const MARK_CELLS = 2;

const INDENT_CELLS = 2;

const GAP_CELLS = 1;

const NAME_GAP_CELLS = 2;

const WORD_GAP = "  ";

const EXIT_MARK = /^\[exited with code (\d+)\]$/;

const END_MARK = /^\[(?:killed|exited with code \d+)\]$/;

const DRAWN_TAIL_LINES = 5;

const KILLED_GLYPH = "■";

type Outcome = "running" | "done" | "failed" | "killed";

const DOT_STATUS: Record<Exclude<Outcome, "killed">, AgentStatus> = {
  running: "running",
  done: "done",
  failed: "failed",
};

type Listed = { shell: Shell; outcome: Outcome; heldPorts: string };

type Columns = { word: number; time: number };

export function shellsTab(ui: Ui, view: ShellsView): RenderElement {
  const { Box, Text } = ui;
  const listed = listShells(view);
  const columns = columnsOf(listed, view.now);
  return (
    <Box flexDirection="column">
      {header(ui, "Shells", paneHeaderLook(), view.width)}
      {listed.length === 0 ? (
        <Text color={paneInk().muted} wrap="truncate-end">
          no background shells
        </Text>
      ) : (
        [summaryRow(ui, view), ...listed.flatMap((entry) => shellRows(ui, entry, columns, view))]
      )}
      {portsSection(ui, view)}
    </Box>
  );
}

function listShells(view: ShellsView): Listed[] {
  return ordered(view.shells).map((shell) => ({
    shell,
    outcome: outcomeOf(shell, view.tails[shell.id] ?? []),
    heldPorts: (view.ports ?? [])
      .filter(({ port }) => owningShell(view.shells, port)?.id === shell.id)
      .map(({ port }) => `:${port}`)
      .join(" "),
  }));
}

function ordered(shells: Shell[]): Shell[] {
  const running = shells.filter((shell) => shell.status === "running");
  const ended = shells
    .filter((shell) => shell.status !== "running")
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
  return [...running, ...ended];
}

function outcomeOf(shell: Shell, tail: string[]): Outcome {
  if (shell.status === "running" || shell.status === "killed") return shell.status;
  return exitedWithError(tail) ? "failed" : "done";
}

function exitedWithError(tail: string[]): boolean {
  const code = EXIT_MARK.exec(tail.at(-1)?.trim() ?? "")?.[1];
  return code !== undefined && Number(code) !== 0;
}

function elapsedOf(shell: Shell, now: number): string {
  return formatDuration(Math.max(0, (shell.endedAt ?? now) - shell.startedAt));
}

function columnsOf(listed: Listed[], now: number): Columns {
  const widest = (texts: string[]): number => Math.max(0, ...texts.map(displayWidth));
  return {
    word: widest(
      listed.filter(({ outcome }) => outcome !== "running").map(({ outcome }) => outcome),
    ),
    time: widest(listed.map(({ shell }) => elapsedOf(shell, now))),
  };
}

function summaryRow({ Text }: Ui, view: ShellsView): RenderElement {
  const ink = paneInk();
  const running = view.shells.filter((shell) => shell.status === "running").length;
  const ports = view.ports?.length ?? 0;
  const restText = [
    view.shells.length > running ? `${view.shells.length - running} ended` : "",
    ports > 0 ? `${ports} ${plural("port", ports)}` : "",
  ]
    .filter((part) => part !== "")
    .join(" · ");
  const mutedText = running > 0 && restText !== "" ? ` · ${restText}` : restText;
  return (
    <Text key="shells-summary" wrap="truncate-end">
      {running > 0 ? (
        <Text weight="semibold" color={ink.text} wrap="truncate-end">
          {`${running} running`}
        </Text>
      ) : null}
      <Text color={ink.muted} wrap="truncate-end">
        {mutedText}
      </Text>
    </Text>
  );
}

function shellRows(ui: Ui, entry: Listed, columns: Columns, view: ShellsView): RenderElement[] {
  const isOpen = view.open?.id === entry.shell.id && entry.outcome === "running";
  return [
    shellRow(ui, entry, columns, view),
    ...(isOpen ? [killRow(ui, entry.shell.id, view)] : []),
    ...tailRows(ui, entry.shell, view),
  ];
}

function shellRow(
  ui: Ui,
  { shell, outcome, heldPorts }: Listed,
  columns: Columns,
  view: ShellsView,
): RenderElement {
  const { Box, Text } = ui;
  const mark = markOf(outcome);
  const name = clipEndAtWord(
    singleLine(shell.command),
    view.width - MARK_CELLS - rightCells(outcome, columns, heldPorts) - NAME_GAP_CELLS,
  );
  return (
    <Box key={`shell-${shell.id}`} flexDirection="row" width={view.width} height={1}>
      <Box flexShrink={0}>
        <Text color={mark.color} wrap="truncate-end">
          {`${mark.text} `}
        </Text>
      </Box>
      <Box flexShrink={1} minWidth={0}>
        {outcome === "running" ? (
          labelButton(ui, {
            key: `shell-name-${shell.id}`,
            label: name,
            onPress: () => view.toggle(shell.id),
          })
        ) : (
          <Text color={paneInk().text} wrap="truncate-end">
            {name}
          </Text>
        )}
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0} />
      <Box flexShrink={0}>
        {rightColumn(ui, outcome, elapsedOf(shell, view.now), columns, heldPorts)}
      </Box>
    </Box>
  );
}

function markOf(outcome: Outcome): Part {
  if (outcome === "killed") return { text: KILLED_GLYPH, color: paneInk().muted };
  return statusDot(DOT_STATUS[outcome]);
}

function rightColumn(
  { Text }: Ui,
  outcome: Outcome,
  runtime: string,
  columns: Columns,
  heldPorts: string,
): RenderElement {
  const time = (
    <Text color={paneInk().muted} wrap="truncate-end">
      {`${portsPrefix(heldPorts)}${runtime.padStart(columns.time)}`}
    </Text>
  );
  if (outcome === "running") return time;
  return (
    <Text wrap="truncate-end">
      <Text color={markOf(outcome).color} wrap="truncate-end">
        {outcome.padEnd(columns.word)}
      </Text>
      {WORD_GAP}
      {time}
    </Text>
  );
}

function rightCells(outcome: Outcome, columns: Columns, heldPorts: string): number {
  const portCells = portsPrefix(heldPorts).length;
  return outcome === "running"
    ? portCells + columns.time
    : columns.word + WORD_GAP.length + columns.time;
}

function portsPrefix(heldPorts: string): string {
  return heldPorts === "" ? "" : `${heldPorts} `;
}

function killRow(ui: Ui, id: string, view: ShellsView): RenderElement {
  const { Box, Button } = ui;
  const isConfirming = view.open?.isConfirming === true;
  const label = isConfirming ? "confirm kill" : "kill";
  return (
    <Box
      key={`shell-actions-${id}`}
      flexDirection="row"
      marginLeft={INDENT_CELLS}
      height={1}
      overflow="hidden"
    >
      <Button
        key={label}
        label={label}
        plain
        dimColor
        onPress={() => (isConfirming ? view.confirmKill(id) : view.askKill(id))}
      />
    </Box>
  );
}

function drawnLines(tail: string[]): string[] {
  const last = tail.at(-1)?.trim() ?? "";
  const output = END_MARK.test(last) ? tail.slice(0, -1) : tail;
  return output.slice(-DRAWN_TAIL_LINES);
}

function tailRows({ Box, Text }: Ui, shell: Shell, view: ShellsView): RenderElement[] {
  const lines =
    shell.outputPath === undefined ? ["no output file"] : drawnLines(view.tails[shell.id] ?? []);
  return lines.map((line, i) => (
    <Box key={`tail-${shell.id}-${i}`} marginLeft={INDENT_CELLS} height={1}>
      <Text color={paneInk().muted} wrap="truncate-end">
        {singleLine(line).trimStart()}
      </Text>
    </Box>
  ));
}

function owningShell(shells: Shell[], port: number): Shell | undefined {
  const holdsPort = new RegExp(`(?<!\\d)${port}(?!\\d)`);
  return shells.find(
    (shell) => shell.status === "running" && holdsPort.test(singleLine(shell.command)),
  );
}

function portsSection(ui: Ui, view: ShellsView): RenderElement | null {
  const { Box } = ui;
  const rows = portRows(ui, view);
  if (rows.length === 0) return null;
  return (
    <Box flexDirection="column">
      <Box height={1} />
      {header(ui, "Ports opened in this session", paneHeaderLook(), view.width)}
      {rows}
    </Box>
  );
}

function portRows(ui: Ui, view: ShellsView): RenderElement[] {
  const { Box, Text } = ui;
  const ink = paneInk();
  if (view.ports === null) {
    return [
      <Text key="ports-unavailable" color={ink.muted} wrap="truncate-end">
        ports unavailable
      </Text>,
    ];
  }
  const loose = view.ports.filter(({ port }) => owningShell(view.shells, port) === undefined);
  if (loose.length === 0) return [];
  const portCells = Math.max(...loose.map((entry) => `:${entry.port}`.length));
  return loose.map((entry) => (
    <Box
      key={`port-${entry.port}-${entry.pid}`}
      flexDirection="row"
      width={view.width}
      height={1}
      columnGap={GAP_CELLS}
    >
      <Box flexShrink={0}>
        <Text color={ink.text} wrap="truncate-end">
          {`:${entry.port}`.padEnd(portCells)}
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text color={ink.text} wrap="truncate-end">
          {entry.command}
        </Text>
      </Box>
      <Box flexShrink={0}>
        <Text color={ink.muted} wrap="truncate-end">{`pid ${entry.pid}`}</Text>
      </Box>
    </Box>
  ));
}
