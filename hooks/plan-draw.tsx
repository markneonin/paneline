import type { ElementTable, RenderElement } from "claude-code";

import { header, paneHeaderLook } from "./pane-kit";
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

const OPEN_GLYPH = "▾";
const FOLDED_GLYPH = "▸";
const DONE_INDENT = "  ";

export function planTab(ui: Ui, view: PlanView): RenderElement {
  const { Box, Text } = ui;
  if (view.tasks.length === 0) {
    return (
      <Text color={paneInk().muted} wrap="truncate-end">
        no plan yet
      </Text>
    );
  }
  const done = view.tasks.filter((task) => task.status === "completed");
  const left = view.tasks.filter((task) => task.status !== "completed");
  return (
    <Box flexDirection="column" width={view.width}>
      {titleRow(ui, view.width, `${done.length}/${view.tasks.length}`)}
      <Box height={1} />
      {left.map((task, index) => (
        <Text key={`left-${index}`} color={paneInk().text} wrap="truncate-end">
          {`${task.status === "in_progress" ? "▸" : "○"} ${task.title}`}
        </Text>
      ))}
      {left.length > 0 && done.length > 0 && <Box height={1} />}
      {done.length > 0 && doneRows(ui, view, done)}
    </Box>
  );
}

function titleRow(ui: Ui, width: number, count: string): RenderElement {
  const { Box, Text } = ui;
  const label = "Plan";
  return (
    <Box flexDirection="row" width={width} columnGap={1}>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {header(ui, label, paneHeaderLook(), width - count.length - 1)}
      </Box>
      <Box flexShrink={0}>
        <Text color={paneInk().muted} wrap="truncate-end">
          {count}
        </Text>
      </Box>
    </Box>
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
