import { atom, read, update } from "claude-code";
import type { EngineInterface, On, SessionContextBreakdown } from "claude-code";

import { markContextStale, mcpBreakdown } from "./breakdown";
import { singleLine } from "./format";
import { mcpCommandName } from "./mcp-name";
import { mcpTab } from "./mcp-draw";
import { TOOL_USES_KEY } from "./mcp-track";
import { PANE } from "./pane-tab";
import { isShownTab, justEntered } from "./shown-tab";
import { disabledServersOf, projectRootOf, scopeIndexOf } from "./servers";
import type { McpAction, ScopeIndex } from "./servers";
import { withoutFolder } from "./use-counts";
import type { UseCounts } from "./use-counts";
import { isTerminal } from "./surface";

export const MCP_TAB = { id: "mcp", label: "MCP" };

const UNSAFE_SERVER_NAME = /[\s\p{Cc}]/u;

const launchFolderAtom = atom({ plugin: "paneline", key: "launchFolder" } as const, "");
const toolUsesAtom = atom(
  { plugin: "paneline", key: "toolUses" } as const,
  {} as Record<string, number>,
);
const mcpSeenAtom = atom({ plugin: "paneline", key: "mcpSeen" } as const, [] as string[]);
const mcpOpenAtom = atom({ plugin: "paneline", key: "mcpOpen" } as const, [] as string[]);
const mcpQueuedAtom = atom({ plugin: "paneline", key: "mcpQueued" } as const, [] as string[]);

const CLAUDE_CONFIG_FILE = ".claude.json";
const PROJECT_MCP_FILE = ".mcp.json";

type McpConfig = { disabled: string[]; scopes: ScopeIndex };

let configured: McpConfig | null = null;

export function registerMcpTab(on: On): void {
  on("session.measure", async ($, e, next) => {
    if (e.changed.length === 0 && isShownTab(MCP_TAB.id)) {
      markContextStale();
      $.ui.invalidate("ui.render");
    }
    return next(e);
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e, next) => {
    if (!isTerminal(e)) return next(e);
    if (!isShownTab(MCP_TAB.id)) return next(e);
    if (justEntered(MCP_TAB.id)) {
      markContextStale();
      configured = null;
    }
    const [loaded, context, seen, queuedServers, openServers, toolUses] = await Promise.all([
      configured ?? loadConfig($),
      mcpBreakdown((args) => $.session.usage(args)),
      read($, mcpSeenAtom),
      read($, mcpQueuedAtom),
      read($, mcpOpenAtom),
      read($, toolUsesAtom),
    ]);
    configured = loaded;
    return mcpTab($.ui.resolve(e), {
      context,
      width: e.props.bodyColumns,
      disabledServers: [...new Set([...seen, ...loaded.disabled])],
      scopes: loaded.scopes,
      queuedServers,
      openServers: new Set(openServers),
      toolUses,
      clearUses: () => void clearToolUses($),
      toggle: (server) =>
        void update($, mcpOpenAtom, (list) =>
          list.includes(server) ? list.filter((open) => open !== server) : [...list, server],
        ),
      act: (action, server) => void requestMcp($, action, server, context),
    });
  });
}

async function clearToolUses($: EngineInterface): Promise<void> {
  const folder = await read($, launchFolderAtom);
  const stored = ((await $.store.get(TOOL_USES_KEY)) ?? {}) as UseCounts;
  await $.store.set(TOOL_USES_KEY, withoutFolder(stored, folder));
  await update($, toolUsesAtom, () => ({}));
}

async function loadConfig($: EngineInterface): Promise<McpConfig> {
  const home = await $.env.get("HOME");
  const cwd = await $.session.cwd();
  const configText = await readText($, `${home ?? ""}/${CLAUDE_CONFIG_FILE}`);
  const projectMcpText = await readText($, `${projectRootOf(configText, cwd)}/${PROJECT_MCP_FILE}`);
  return {
    disabled: disabledServersOf(configText, cwd),
    scopes: scopeIndexOf(configText, projectMcpText, cwd),
  };
}

function readText($: EngineInterface, path: string): Promise<string> {
  return $.fs.read(path).catch(() => "");
}

async function rememberServers(
  $: EngineInterface,
  breakdown: SessionContextBreakdown | null,
): Promise<void> {
  const live = (breakdown?.mcpTools ?? []).map((tool) => mcpCommandName(tool.serverName));
  await update($, mcpSeenAtom, (list) => [...new Set([...list, ...live])]);
}

async function finishMcp($: EngineInterface, server: string): Promise<void> {
  await update($, mcpQueuedAtom, (list) => list.filter((name) => name !== server));
  configured = null;
  markContextStale();
  $.ui.invalidate("ui.render");
}

async function requestMcp(
  $: EngineInterface,
  action: McpAction,
  server: string,
  breakdown: SessionContextBreakdown | null,
): Promise<void> {
  if (UNSAFE_SERVER_NAME.test(server)) {
    $.ui.toast(
      `Cannot ${action} "${singleLine(server)}": the name has spaces or control characters`,
    );
    return;
  }
  await rememberServers($, breakdown);
  await update($, mcpQueuedAtom, (list) => [...list, server]);
  $.ui.invalidate("ui.render");
  void $.command
    .run({ command: "mcp", args: `${action} ${server}` })
    .catch((error: unknown) => $.ui.toast(`/mcp ${action} ${server} failed: ${String(error)}`))
    .finally(() => finishMcp($, server));
}
