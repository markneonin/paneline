import { singleLine } from "./format";

export type ToolKind = "Read" | "Edit" | "Bash" | "Search" | "Web" | "Agent" | "Other";

export const TOOL_KINDS: ToolKind[] = ["Read", "Edit", "Bash", "Search", "Web", "Agent", "Other"];

const KIND_BY_TOOL = new Map<string, ToolKind>([
  ["Read", "Read"],
  ["Edit", "Edit"],
  ["MultiEdit", "Edit"],
  ["Write", "Edit"],
  ["NotebookEdit", "Edit"],
  ["Bash", "Bash"],
  ["PowerShell", "Bash"],
  ["Grep", "Search"],
  ["Glob", "Search"],
  ["WebFetch", "Web"],
  ["WebSearch", "Web"],
  ["Agent", "Agent"],
  ["Task", "Agent"],
]);

const TARGET_FIELDS = [
  "file_path",
  "notebook_path",
  "command",
  "pattern",
  "url",
  "query",
  "description",
  "message",
];

export function kindOf(tool: string): ToolKind {
  return KIND_BY_TOOL.get(tool) ?? "Other";
}

export function isEditTool(tool: string): boolean {
  return kindOf(tool) === "Edit";
}

export function isPathTool(tool: string): boolean {
  return kindOf(tool) === "Read" || isEditTool(tool);
}

export function isProgressTool(tool: string): boolean {
  return tool === PROGRESS_TOOL;
}

export function targetOf(call: object): string {
  const fields = call as Record<string, unknown>;
  const target = [...TARGET_FIELDS.map((name) => fields[name]), firstQuestion(fields)].find(
    (value) => typeof value === "string" && singleLine(value) !== "",
  );
  return typeof target === "string" ? singleLine(target) : "";
}

function firstQuestion(fields: Record<string, unknown>): unknown {
  const [first] = Array.isArray(fields.questions) ? (fields.questions as unknown[]) : [];
  return (first as { question?: unknown } | undefined)?.question;
}

export const PROGRESS_TOOL = "mcp__paneline__progress";
