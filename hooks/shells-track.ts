import { atom, update } from "claude-code";
import type { ApiContentBlock, On, ToolCallResult } from "claude-code";

import type { Shell } from "../types";

const OUTPUT_PATH = /\S*\/tasks\/[\w-]+\.output/;
const TASK_NOTIFICATION = /<task-notification>([\s\S]*?)<\/task-notification>/g;
const TASK_ID = /<task-id>([\w-]+)<\/task-id>/;

const shellsAtom = atom({ plugin: "paneline", key: "shells" } as const, [] as Shell[]);
const checkedAtAtom = atom({ plugin: "paneline", key: "shellsCheckedAt" } as const, 0);

export function trackShells(on: On): void {
  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    const ran = await next(e);
    const { backgroundTaskId: id } = (ran.result ?? {}) as { backgroundTaskId?: unknown };
    if (typeof id !== "string") return ran;
    const shell: Shell = {
      id,
      command: e.command,
      startedAt: await $.clock.now(),
      outputPath: OUTPUT_PATH.exec(ran.text ?? "")?.[0],
      status: "running",
    };
    await update($, shellsAtom, (shells) => [...shells.filter((one) => one.id !== id), shell]);
    return ran;
  });

  on("tool.call", { tool: "TaskStop" }, async ($, e, next) => {
    const ran = await next(e);
    const id = e.task_id ?? e.shell_id;
    if (id === undefined || !isStopped(ran)) return ran;
    const endedAt = await $.clock.now();
    await update($, shellsAtom, (shells) =>
      endedShells(shells, (shell) => shell.id === id, "killed", endedAt),
    );
    return ran;
  });

  on("classic.Stop", { stop_hook_active: false }, async ($, e, next) => {
    const alive = e.background_tasks?.map((task) => task.id);
    const checkedAt = await $.clock.now();
    if (alive !== undefined)
      await update($, shellsAtom, (shells) =>
        endedShells(shells, (shell) => !alive.includes(shell.id), "done", checkedAt),
      );
    await update($, checkedAtAtom, () => checkedAt);
    return next(e);
  });

  on("session.append", { door: "queue" }, async ($, e, next) => {
    const ids = finishedTaskIds(textOf(e.message.content));
    if (ids.length === 0) return next(e);
    const endedAt = await $.clock.now();
    await update($, shellsAtom, (shells) =>
      endedShells(shells, (shell) => ids.includes(shell.id), "done", endedAt),
    );
    return next(e);
  });
}

export function isStopped(ran: ToolCallResult): boolean {
  return ran.deny === undefined && !ran.isError;
}

export function endedShells(
  shells: Shell[],
  isEnded: (shell: Shell) => boolean,
  status: "done" | "killed",
  endedAt: number,
): Shell[] {
  return shells.map((shell) =>
    shell.status === "running" && isEnded(shell) ? { ...shell, status, endedAt } : shell,
  );
}

function textOf(content: ApiContentBlock[]): string {
  return content.flatMap((block) => (block.type === "text" ? [String(block.text)] : [])).join("\n");
}

function finishedTaskIds(text: string): string[] {
  return [...text.matchAll(TASK_NOTIFICATION)].flatMap(([, body = ""]) => {
    const id = TASK_ID.exec(body)?.[1];
    return id === undefined ? [] : [id];
  });
}
