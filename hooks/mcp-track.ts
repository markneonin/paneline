import { atom, read, update } from "claude-code";
import type { EngineInterface, On } from "claude-code";

import { isProgressTool } from "./tools";
import { countsIn, withUse } from "./use-counts";
import type { UseCounts } from "./use-counts";

export const TOOL_USES_KEY = "toolUses";

const MCP_TOOL = /^mcp__/;

const launchFolderAtom = atom({ plugin: "paneline", key: "launchFolder" } as const, "");
const toolUsesAtom = atom(
  { plugin: "paneline", key: "toolUses" } as const,
  {} as Record<string, number>,
);

export function trackMcpUses(on: On): void {
  on("session.start", { isInteractive: true }, async ($, e, next) => {
    const known = await read($, launchFolderAtom);
    const counts = countsIn(await storedUses($), known === "" ? e.cwd : known);
    await update($, toolUsesAtom, () => counts);
    return next(e);
  });

  on("tool.call", { tool: MCP_TOOL }, async ($, e, next) => {
    const folder = await read($, launchFolderAtom);
    if (folder === "" || isProgressTool(e.tool)) return next(e);
    const all = withUse(await storedUses($), folder, e.tool);
    await $.store.set(TOOL_USES_KEY, all);
    await update($, toolUsesAtom, () => countsIn(all, folder));
    return next(e);
  });
}

async function storedUses($: EngineInterface): Promise<UseCounts> {
  return ((await $.store.get(TOOL_USES_KEY)) ?? {}) as UseCounts;
}
