import type { ElementTable, RenderElement } from "claude-code";

import { bar, header, paneHeaderLook, statusDot } from "./pane-kit";
import type { Part } from "./pane-kit";
import { paneInk } from "./pane-ink";

type Ui = ElementTable;

export type PlanTask = {
  status: "pending" | "in_progress" | "completed";
  title: string;
};

export type PlanView = {
  tasks: PlanTask[];
  width: number;
  isDoneOpen: boolean;
  toggleDone: () => void;
};

type Progress = { done: number; total: number };

const OPEN_GLYPH = "▾";
const FOLDED_GLYPH = "▸";
const PENDING_GLYPH = "○";
const DONE_INDENT = "  ";
const WIDE_BAR_COLUMNS = 100;
const WIDE_BAR_CELLS = 16;
const NARROW_BAR_CELLS = 8;

export function planTab(ui: Ui, view: PlanView): RenderElement {
  const { Box, Text } = ui;
  if (view.tasks.length === 0) {
    return (
      <Box flexDirection="column" width={view.width}>
        {header(ui, "Plan", paneHeaderLook(), view.width)}
        <Text color={paneInk().muted} wrap="truncate-end">
          no task list yet · Claude's steps show here
        </Text>
      </Box>
    );
  }
  const done = view.tasks.filter((task) => task.status === "completed");
  const left = view.tasks.filter((task) => task.status !== "completed");
  return (
    <Box flexDirection="column" width={view.width}>
      {titleRow(ui, view.width, { done: done.length, total: view.tasks.length })}
      <Box height={1} />
      {left.map((task, index) => leftRow(ui, task, `left-${index}`))}
      {left.length > 0 && done.length > 0 && <Box height={1} />}
      {done.length > 0 && doneRows(ui, view, done)}
    </Box>
  );
}

function titleRow(ui: Ui, width: number, progress: Progress): RenderElement {
  const { Box, Text } = ui;
  const ink = paneInk();
  const label = "Plan";
  const count = `${progress.done}/${progress.total}`;
  const cells = width >= WIDE_BAR_COLUMNS ? WIDE_BAR_CELLS : NARROW_BAR_CELLS;
  return (
    <Box flexDirection="row" width={width} columnGap={1}>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {header(ui, label, paneHeaderLook(), width - count.length - cells - 2)}
      </Box>
      <Box flexShrink={0}>{bar(ui, progress.done, progress.total, cells, ink.ok)}</Box>
      <Box flexShrink={0}>
        <Text weight="semibold" color={ink.text} wrap="truncate-end">
          {count}
        </Text>
      </Box>
    </Box>
  );
}

function leftRow(ui: Ui, task: PlanTask, key: string): RenderElement {
  const { Text } = ui;
  const ink = paneInk();
  const isActive = task.status === "in_progress";
  const mark: Part = isActive ? statusDot("running") : { text: PENDING_GLYPH, color: ink.muted };
  return (
    <Text key={key} wrap="truncate-end">
      <Text color={mark.color} wrap="truncate-end">
        {mark.text}
      </Text>{" "}
      <Text color={ink.text} weight={isActive ? "semibold" : undefined} wrap="truncate-end">
        {task.title}
      </Text>
    </Text>
  );
}

function doneRows(ui: Ui, view: PlanView, done: PlanTask[]): RenderElement[] {
  const { Button, Text } = ui;
  const glyph = view.isDoneOpen ? OPEN_GLYPH : FOLDED_GLYPH;
  return [
    <Button
      key="done-toggle"
      label={`${glyph} ✓ ${done.length} done`}
      plain
      dimColor
      onPress={view.toggleDone}
    />,
    ...(view.isDoneOpen
      ? done.map((task, index) => (
          <Text key={`done-${index}`} color={paneInk().muted} wrap="truncate-end">
            {`${DONE_INDENT}✓ ${task.title}`}
          </Text>
        ))
      : []),
  ];
}
