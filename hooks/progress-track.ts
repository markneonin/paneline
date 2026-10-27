import { atom, read, update } from "claude-code";
import type { EngineInterface, On } from "claude-code";

import { TYPED } from "./chat-render";
import { PROGRESS_TOOL } from "./tools";

export type Status = "pending" | "in_progress" | "completed";
export type Task = { status: Status; title: string };
export type Tasks = Record<string, Task>;
type ProgressState = { tasks: Tasks; percent: number | null };

const MAX_REPORTED_PERCENT = 95;
const PROGRESS_CALL = new RegExp(`^${PROGRESS_TOOL}$`);
const TASK_TOOLS = /^(TaskCreate|TaskUpdate|TaskList|TodoWrite)$/;

const progressAtom = atom(
  { plugin: "paneline", key: "progress" } as const,
  { tasks: {}, percent: null } as { tasks: Tasks; percent: number | null },
);
const callsSinceNoteAtom = atom({ plugin: "paneline", key: "callsSinceNote" } as const, 0);

export function trackProgress(on: On): void {
  on("session.start", { isInteractive: true }, async ($, e, next) => {
    await $.tool
      .register({
        name: "progress",
        description: "Report how much of the whole task is done, as a whole percent from 0 to 100.",
        inputSchema: {
          type: "object",
          properties: { percent: { type: "integer", minimum: 0, maximum: 100 } },
          required: ["percent"],
        },
        isDeferred: false,
      })
      .catch(() => undefined);
    return next(e);
  });

  on("tool.check", { tool: PROGRESS_CALL }, () => ({ decision: "allow" }));

  on("tool.call", { tool: PROGRESS_CALL }, async ($, e) => {
    if (e.agentId === undefined) {
      const percent = Math.min(Number(Reflect.get(e, "percent")), MAX_REPORTED_PERCENT);
      await Promise.all([writeProgress($, (state) => ({ ...state, percent })), resetCallCount($)]);
    }
    return { result: "ok" };
  });

  on("tool.call", { tool: TASK_TOOLS }, async ($, e, next) => {
    const ran = await next(e);
    if (e.agentId !== undefined || ran.deny !== undefined || ran.isError === true) return ran;
    await writeProgress($, (state) => ({
      ...state,
      tasks: tasksAfter(state.tasks, e.tool, e, ran.result),
    }));
    return ran;
  });

  on("prompt.submit", async ($, e, next) => {
    if (TYPED.has(e.origin.kind) && e.text.trim() !== "")
      await Promise.all([
        writeProgress($, (state) => ({ ...state, percent: null })),
        resetCallCount($),
      ]);
    return next(e);
  });
}

async function writeProgress(
  $: EngineInterface,
  change: (state: ProgressState) => ProgressState,
): Promise<void> {
  const current = await read($, progressAtom);
  const changed = change(current);
  if (changed.percent === current.percent && isSameTasks(changed.tasks, current.tasks)) return;
  await update($, progressAtom, change);
}

async function resetCallCount($: EngineInterface): Promise<void> {
  if ((await read($, callsSinceNoteAtom)) === 0) return;
  await update($, callsSinceNoteAtom, () => 0);
}

function isSameTasks(left: Tasks, right: Tasks): boolean {
  const ids = Object.keys(left);
  return (
    ids.length === Object.keys(right).length &&
    ids.every(
      (id) => left[id]?.status === right[id]?.status && left[id]?.title === right[id]?.title,
    )
  );
}

export function tasksAfter(tasks: Tasks, tool: string, input: object, result: unknown): Tasks {
  const fields = input as { taskId?: string; status?: string; subject?: string };
  const output = result as {
    task?: { id: string; subject?: string };
    tasks?: { id: string; subject: string; status: Status }[];
    newTodos?: { content: string; status: Status }[];
  };
  switch (tool) {
    case "TodoWrite":
      return Object.fromEntries(
        (output.newTodos ?? []).map((todo, index) => [
          `todo-${index}`,
          { status: todo.status, title: todo.content },
        ]),
      );
    case "TaskList":
      return Object.fromEntries(
        (output.tasks ?? []).map((task) => [task.id, { status: task.status, title: task.subject }]),
      );
    case "TaskCreate":
      return output.task === undefined
        ? tasks
        : {
            ...tasks,
            [output.task.id]: {
              status: "pending",
              title: output.task.subject ?? fields.subject ?? output.task.id,
            },
          };
    default:
      return taskUpdated(tasks, fields);
  }
}

function taskUpdated(
  tasks: Tasks,
  fields: { taskId?: string; status?: string; subject?: string },
): Tasks {
  const { taskId, status, subject } = fields;
  if (taskId === undefined) return tasks;
  if (status === "deleted")
    return Object.fromEntries(Object.entries(tasks).filter(([id]) => id !== taskId));
  const known = tasks[taskId];
  if (known === undefined && status === undefined) return tasks;
  return {
    ...tasks,
    [taskId]: {
      status: (status as Status | undefined) ?? known?.status ?? "pending",
      title: subject ?? known?.title ?? taskId,
    },
  };
}
