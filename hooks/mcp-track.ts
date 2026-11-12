import { atom, read, update } from "claude-code";
import type { On } from "claude-code";

import { isProgressTool } from "./tools";
import { countUse, storedUses } from "./store-queue";

const MCP_TOOL = /^mcp__/;

const launchFolderAtom = atom({ plugin: "paneline", key: "launchFolder" } as const, "");
const toolUsesAtom = atom(
  { plugin: "paneline", key: "toolUses" } as const,
  {} as Record<string, number>,
);
const toolFailuresAtom = atom(
  { plugin: "paneline", key: "toolFailures" } as const,
  {} as Record<string, number>,
);

export function trackMcpUses(on: On): void {
  on("session.start", { isInteractive: true }, async ($, e, next) => {
    const known = await read($, launchFolderAtom);
    const folder = known === "" ? e.cwd : known;
    const [uses, failures] = await Promise.all([
      storedUses($, "tool", folder),
      storedUses($, "toolFailure", folder),
    ]);
    await update($, toolUsesAtom, () => uses);
    await update($, toolFailuresAtom, () => failures);
    return next(e);
  });

  on("tool.call", { tool: MCP_TOOL }, async ($, e, next) => {
    const folder = await read($, launchFolderAtom);
    if (folder === "" || isProgressTool(e.tool)) return next(e);
    await update($, toolUsesAtom, (counts) => withCount(counts, e.tool));
    const ran = await next(e);
    countUse($, "tool", folder, e.tool);
    if (ran.isError !== true) return ran;
    countUse($, "toolFailure", folder, e.tool);
    await update($, toolFailuresAtom, (counts) => withCount(counts, e.tool));
    return ran;
  });
}

function withCount(counts: Record<string, number>, name: string): Record<string, number> {
  return { ...counts, [name]: (counts[name] ?? 0) + 1 };
}
