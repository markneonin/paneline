import { mock } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

const CWD = "/work";
const NOW = 200_000;
const FAILED_EDIT_OLD_STRING = "missing";
const FAILING_COMMAND = "fail";
const NOT_FOUND_TEXT = "<tool_use_error>String to replace not found in file.</tool_use_error>";

export function failedEditWorldOf(on: On): void {
  mock.clock(on, { now: NOW });
  mock.env(on, { HOME: "/h/u" });
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("fs.exists", () => ({ value: true }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: CWD }));
  on("settings.read", () => ({ value: {} }));
  on("agent.list", () => ({ value: [] }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("turn.complete", (_$, e) => ({ text: e.answer }));
  on("tool.call", (_$, e) => {
    const call = e as unknown as { tool: string; command?: string; old_string?: string };
    if (call.tool === "Bash" && call.command === FAILING_COMMAND)
      return { isError: true, result: "boom", text: "boom" } as never;
    if (call.tool === "Edit" && call.old_string === FAILED_EDIT_OLD_STRING)
      return { isError: true, result: NOT_FOUND_TEXT, text: NOT_FOUND_TEXT } as never;
    return { result: "ok", text: "ok" };
  });
}

export function failingCommand($: Engine, id: string): Promise<unknown> {
  return $.tool.call({ tool: "Bash", command: FAILING_COMMAND, tool_use_id: id } as never);
}

export function failingEdit($: Engine, id: string, filePath: string): Promise<unknown> {
  return $.tool.call({
    tool: "Edit",
    file_path: filePath,
    old_string: FAILED_EDIT_OLD_STRING,
    new_string: "x",
    tool_use_id: id,
  } as never);
}

export function readOf($: Engine, id: string, filePath: string): Promise<unknown> {
  return $.tool.call({ tool: "Read", file_path: filePath, tool_use_id: id } as never);
}
