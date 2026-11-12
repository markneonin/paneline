import type { ContextMemoryFile, ContextSkill } from "claude-code";

import { formatDuration, formatTokens, MS_PER_SECOND } from "./format";
import { hookCommandName } from "./hook-name";
import { plural } from "./pane-kit";
import { folderName, tildePath } from "./paths";
import type { SkillUsage } from "./skill-usage";
import { displayWidth } from "./text-width";

export type SettingsSource = "policy" | "flag" | "local" | "project" | "user";

export type SettingsLayer = {
  source: SettingsSource;
  file: string;
  settings: Readonly<Record<string, unknown>>;
};

export type CellLook = "text" | "muted" | "tool" | "failed" | "alert" | "strong";

export type Cell = { text: string; look: CellLook; width?: number; alternatives?: boolean };

export type Opens = { id: string; cell: number };

export type SetupRow = {
  indent: number;
  mark: string;
  cells: Cell[];
  right: string;
  clipsStart: boolean;
  opens?: Opens;
};

export type SetupBlock = { title: string; rows: SetupRow[]; empty: string; count?: Cell[] };

export type SetupFile = { path: string; text: string };

export type RepeatedRule = { rule: string; paths: string[] };

export type ActivePlugin = { id: string; name: string; source: SettingsSource; folder?: string };

export type InstalledPlugin = { root: string; version: string | undefined };

export type PluginSource = { file: string; document: unknown };

export type PluginFiles = {
  plugin: ActivePlugin;
  root: string;
  version: string | undefined;
  hooks: PluginSource[];
  servers: PluginSource[];
};

export type DetailField = { label: string; cells: Cell[] };

export type DetailBody = { title: string; text: string };

export type SetupDetail = { id: string; title: string; fields: DetailField[]; body?: DetailBody };

export type HookItem = {
  id: string;
  event: string;
  name: string;
  source: string;
  file: string | undefined;
  matcher: string;
  type: string;
  timeout: number | null;
  isAsync: boolean;
  condition: string;
  body: string;
};

export type SetupInput = {
  home: string;
  now: number;
  memoryFiles: readonly ContextMemoryFile[];
  fileTexts: readonly SetupFile[];
  layers: readonly SettingsLayer[];
  plugins: readonly ActivePlugin[];
  pluginFiles: readonly PluginFiles[];
  skills: readonly ContextSkill[];
  skillUsage: SkillUsage | null;
};

const SOURCE_LABELS: Record<SettingsSource, string> = {
  policy: "managed",
  flag: "session",
  local: "local",
  project: "project",
  user: "user",
};

const SETTINGS_FILES: Record<SettingsSource, string> = {
  policy: "managed settings",
  flag: "--settings",
  local: ".claude/settings.local.json",
  project: ".claude/settings.json",
  user: "~/.claude/settings.json",
};

export const SETTINGS_SOURCES = Object.keys(SETTINGS_FILES) as SettingsSource[];

export const settingsFileOf = (source: SettingsSource): string => SETTINGS_FILES[source];

const realFileOf = (source: SettingsSource): string | undefined =>
  FILE_SOURCES.includes(source) ? SETTINGS_FILES[source] : undefined;

const PLUGIN_DIRS_KEY = "CLAUDE_CODE_PLUGIN_DIRS";
const PERMISSION_KINDS = ["allow", "deny", "ask"] as const;
type PermissionKind = (typeof PERMISSION_KINDS)[number];
type PermissionRule = { kind: PermissionKind; rule: string };
const KIND_LOOKS: Record<PermissionKind, CellLook> = {
  allow: "muted",
  deny: "failed",
  ask: "alert",
};
const HOOK_CUE = "click a hook for its full command";
const BODY_TITLES: Record<string, string> = {
  command: "Command",
  http: "URL",
  prompt: "Prompt",
  agent: "Prompt",
  mcp_tool: "Tool",
};
const UNUSED_AFTER_DAYS = 30;
const MS_PER_DAY = 86_400_000;
const MIN_RULE_WORDS = 4;
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;
const FENCE = /^\s*(?:```|~~~)/;
const HEADING = /^\s*#/;
const FRONTMATTER_EDGE = /^---\s*$/;
const TRAILING_SLASH = /\/+$/;
const URL_HOST = /^\w+:\/\/([^/:?#]+)/;
const LEADING_DOT_SLASH = /^\.\//;
const URL_START = /^\w+:\/\//;
const FILE_SOURCES: readonly SettingsSource[] = ["local", "project", "user"];
export const PLUGIN_MANIFEST = ".claude-plugin/plugin.json";
export const PLUGIN_HOOKS_FILE = "hooks/hooks.json";
export const PLUGIN_MCP_FILE = ".mcp.json";

const plain = (text: string): Cell => ({ text, look: "text" });
const dim = (text: string): Cell => ({ text, look: "muted" });

function row(cells: Cell[], extra: Partial<SetupRow> = {}): SetupRow {
  return { indent: 0, mark: "", cells, right: "", clipsStart: false, ...extra };
}

function groupRow(title: string, right: string): SetupRow {
  return row([{ text: title, look: "strong" }], { clipsStart: true, right });
}

function itemRow(cells: Cell[], extra: Partial<SetupRow> = {}): SetupRow {
  return row(cells, { indent: 2, ...extra });
}

function countCells(count: number, noun: string): Cell[] {
  return [plain(String(count)), dim(` ${plural(noun, count)}`)];
}

function permissionCount(rules: readonly PermissionRule[]): Cell[] {
  const parts = PERMISSION_KINDS.flatMap((kind) => {
    const count = rules.filter((rule) => rule.kind === kind).length;
    return count === 0 ? [] : [[plain(String(count)), dim(` ${kind}`)]];
  });
  if (parts.length === 0) return countCells(0, "rule");
  return parts.flatMap((part, index) => (index === 0 ? part : [dim(" · "), ...part]));
}

export function setupBlocks(input: SetupInput): SetupBlock[] {
  const rules = repeatedRules(
    input.fileTexts.map(({ path, text }) => ({ path: tildePath(path, input.home), text })),
  );
  return [
    instructionBlock(input),
    ...(rules.length === 0 ? [] : [repeatedBlock(rules)]),
    permissionsBlock(input.layers),
    hooksBlock(hookItems(input)),
    pluginsBlock(input.plugins),
    unusedSkillsBlock(input),
  ];
}

function instructionBlock(input: SetupInput): SetupBlock {
  return {
    title: "Instructions",
    count: countCells(input.memoryFiles.length, "file"),
    empty: "no instruction files · CLAUDE.md files the session loads show here",
    rows: input.memoryFiles.map(({ path, tokens }) =>
      row([plain(folderName(path)), dim(folderOf(tildePath(path, input.home)))], {
        right: formatTokens(tokens),
        clipsStart: true,
      }),
    ),
  };
}

function folderOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

function repeatedBlock(rules: readonly RepeatedRule[]): SetupBlock {
  return {
    title: "Repeated rules",
    empty: "",
    rows: rules.flatMap(({ rule, paths }) => [
      row([plain(rule)], { right: `${paths.length} files` }),
      ...paths.map((path) => itemRow([dim(path)], { clipsStart: true })),
    ]),
  };
}

function hooksBlock(items: readonly HookItem[]): SetupBlock {
  const events = [...new Set(items.map(({ event }) => event))].sort((left, right) =>
    left.localeCompare(right),
  );
  return {
    title: "Hooks",
    count: countCells(items.length, "hook"),
    empty: "no hooks",
    rows: items.length === 0 ? [] : [row([dim(HOOK_CUE)]), ...eventRows(items, events)],
  };
}

function eventRows(items: readonly HookItem[], events: readonly string[]): SetupRow[] {
  return events.flatMap((event) => {
    const inEvent = items.filter((item) => item.event === event);
    return [
      groupRow(event, `${inEvent.length} ${plural("hook", inEvent.length)}`),
      ...hookRows(inEvent),
    ];
  });
}

function hookRows(items: readonly HookItem[]): SetupRow[] {
  const nameWidth = Math.max(...items.map(({ name }) => displayWidth(name)));
  const hasMatchers = items.some(({ matcher }) => matcher !== "");
  return items.map((item) =>
    itemRow(
      hasMatchers
        ? [
            { text: item.name, look: "text", width: nameWidth },
            { text: item.matcher, look: "tool", alternatives: true },
          ]
        : [plain(item.name)],
      { right: item.source, opens: { id: item.id, cell: 0 } },
    ),
  );
}

function permissionsBlock(layers: readonly SettingsLayer[]): SetupBlock {
  const groups = layers
    .map((layer) => ({ layer, rules: permissionRules(layer.settings) }))
    .filter(({ rules }) => rules.length > 0);
  return {
    title: "Permissions",
    count: permissionCount(groups.flatMap(({ rules }) => rules)),
    empty: "no permission rules",
    rows: groups.flatMap(({ layer, rules }) => [
      groupRow(SOURCE_LABELS[layer.source], `${rules.length} ${plural("rule", rules.length)}`),
      ...rules.map((permission) =>
        itemRow(
          [{ text: permission.kind, look: KIND_LOOKS[permission.kind] }, plain(permission.rule)],
          {
            opens: { id: permissionIdOf(layer, permission), cell: 1 },
          },
        ),
      ),
    ]),
  };
}

function permissionRules(settings: Readonly<Record<string, unknown>>): PermissionRule[] {
  return PERMISSION_KINDS.flatMap((kind) =>
    listOf(recordOf(settings.permissions)[kind]).flatMap((rule) =>
      typeof rule === "string" ? [{ kind, rule }] : [],
    ),
  );
}

function pluginsBlock(plugins: readonly ActivePlugin[]): SetupBlock {
  const sources = [...new Set(plugins.map(({ source }) => source))];
  return {
    title: "Plugins",
    count: countCells(plugins.length, "plugin"),
    empty: "no plugins",
    rows: sources.flatMap((source) => {
      const inSource = plugins.filter((plugin) => plugin.source === source);
      const count = inSource.length;
      return [
        groupRow(SOURCE_LABELS[source], `${count} ${plural("plugin", count)}`),
        ...inSource.map((plugin) =>
          itemRow([plain(plugin.id)], {
            mark: "✔",
            right: plugin.folder === undefined ? "" : "plugin dir",
            opens: { id: pluginIdOf(plugin), cell: 0 },
          }),
        ),
      ];
    }),
  };
}

function unusedSkillsBlock(input: SetupInput): SetupBlock {
  const title = `Skills not used in ${UNUSED_AFTER_DAYS} days`;
  if (input.skillUsage === null) {
    return { title, count: countCells(0, "skill"), empty: "no skill use data", rows: [] };
  }
  const names = [...new Set(input.skills.map(({ name }) => name))].sort((left, right) =>
    left.localeCompare(right),
  );
  const usage = input.skillUsage;
  const rows = names.flatMap((name) => {
    const lastUsedAt = usage[name]?.lastUsedAt;
    if (typeof lastUsedAt !== "number") return [row([plain(name)], { right: "never" })];
    const age = input.now - lastUsedAt;
    if (age <= UNUSED_AFTER_DAYS * MS_PER_DAY) return [];
    return [row([plain(name)], { right: `${Math.floor(age / MS_PER_DAY)} days` })];
  });
  return {
    title,
    count: countCells(rows.length, "skill"),
    empty: `all skills used in ${UNUSED_AFTER_DAYS} days`,
    rows,
  };
}

export function repeatedRules(files: readonly SetupFile[]): RepeatedRule[] {
  const pathsByRule = new Map<string, Set<string>>();
  for (const { path, text } of files) {
    for (const rule of ruleLines(text)) {
      pathsByRule.set(rule, (pathsByRule.get(rule) ?? new Set()).add(path));
    }
  }
  return [...pathsByRule]
    .filter(([, paths]) => paths.size >= 2)
    .map(([rule, paths]) => ({ rule, paths: [...paths] }));
}

function ruleLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const bodyStart = frontmatterEnd(lines) + 1;
  let isFenced = false;
  const rules: string[] = [];
  for (const line of lines.slice(bodyStart)) {
    if (FENCE.test(line)) {
      isFenced = !isFenced;
      continue;
    }
    if (isFenced || HEADING.test(line)) continue;
    const rule = normalized(line);
    if (rule.split(" ").length >= MIN_RULE_WORDS) rules.push(rule);
  }
  return rules;
}

function frontmatterEnd(lines: readonly string[]): number {
  if (!FRONTMATTER_EDGE.test(lines[0] ?? "")) return -1;
  return lines.findIndex((line, index) => index > 0 && FRONTMATTER_EDGE.test(line));
}

function normalized(line: string): string {
  return line.replace(LIST_MARKER, "").toLowerCase().replace(/\s+/g, " ").trim().replace(/\.$/, "");
}

export function pluginsInForce(layers: readonly SettingsLayer[]): ActivePlugin[] {
  const decided = new Set<string>();
  const active: ActivePlugin[] = [];
  for (const { source, settings } of layers) {
    for (const [id, isOn] of Object.entries(recordOf(settings.enabledPlugins))) {
      if (decided.has(id)) continue;
      decided.add(id);
      if (isOn === true) active.push({ id, name: id.split("@")[0] ?? id, source });
    }
    for (const folder of pluginFolders(recordOf(settings.env)[PLUGIN_DIRS_KEY])) {
      const name = folderName(folder);
      active.push({ id: name, name, source, folder });
    }
  }
  return active;
}

function pluginFolders(dirs: unknown): string[] {
  if (typeof dirs !== "string") return [];
  return dirs
    .split(":")
    .filter((folder) => folder !== "")
    .map((folder) => folder.replace(TRAILING_SLASH, ""));
}

export function installedPlugins(registryText: string): Map<string, InstalledPlugin> {
  const plugins = recordOf(recordOf(parsed(registryText)).plugins);
  return new Map(
    Object.entries(plugins).flatMap(([id, installs]) => {
      const install = recordOf(listOf(installs)[0]);
      const root = install.installPath;
      if (typeof root !== "string") return [];
      const version = typeof install.version === "string" ? install.version : undefined;
      return [[id, { root, version }] as const];
    }),
  );
}

export function pluginReadPaths(root: string, manifestText: string): string[] {
  const manifest = recordOf(parsed(manifestText));
  return [
    ...listedPaths(root, PLUGIN_HOOKS_FILE, manifest.hooks),
    ...listedPaths(root, PLUGIN_MCP_FILE, manifest.mcpServers),
  ];
}

export function pluginSources(
  root: string,
  manifestText: string,
  files: readonly SetupFile[],
): Pick<PluginFiles, "hooks" | "servers"> {
  const manifest = recordOf(parsed(manifestText));
  return {
    hooks: sourcesOf(root, files, manifest.hooks, PLUGIN_HOOKS_FILE, "hooks"),
    servers: sourcesOf(root, files, manifest.mcpServers, PLUGIN_MCP_FILE, "mcpServers"),
  };
}

function sourcesOf(
  root: string,
  files: readonly SetupFile[],
  entry: unknown,
  fallback: string,
  key: string,
): PluginSource[] {
  const fromFiles = listedPaths(root, fallback, entry).flatMap((file) => {
    const text = files.find((item) => item.path === file)?.text;
    return text === undefined ? [] : [{ file, document: parsed(text) }];
  });
  const inline = itemsOf(entry)
    .filter(isRecord)
    .map((map) => ({ file: `${root}/${PLUGIN_MANIFEST}`, document: { [key]: map } }));
  return [...fromFiles, ...inline];
}

function listedPaths(root: string, fallback: string, entry: unknown): string[] {
  return [fallback, ...itemsOf(entry).filter(isJsonPath)].map(
    (path) => `${root}/${path.replace(LEADING_DOT_SLASH, "")}`,
  );
}

function itemsOf(entry: unknown): unknown[] {
  return Array.isArray(entry) ? entry : [entry];
}

function isJsonPath(item: unknown): item is string {
  return typeof item === "string" && item.endsWith(".json") && !URL_START.test(item);
}

function serverNamesOf(document: unknown): string[] {
  const doc = recordOf(document);
  return Object.keys(doc.mcpServers === undefined ? doc : recordOf(doc.mcpServers));
}

export function hookItems(input: SetupInput): HookItem[] {
  return distinctHooks([
    ...input.layers.flatMap(({ source, settings }) =>
      sourceHooks(settings.hooks, {
        key: source,
        label: SOURCE_LABELS[source],
        file: realFileOf(source),
      }),
    ),
    ...input.pluginFiles.flatMap((files) => pluginHookItems(input.home, files)),
  ]);
}

function pluginHookItems(home: string, { plugin, hooks }: PluginFiles): HookItem[] {
  return hooks.flatMap(({ file, document }, index) =>
    sourceHooks(recordOf(document).hooks, {
      key: `plugin:${plugin.name}:${index}`,
      label: `${plugin.name} plugin`,
      file: tildePath(file, home),
    }),
  );
}

export function setupDetails(input: SetupInput): SetupDetail[] {
  return [
    ...hookItems(input).map(hookDetail),
    ...input.layers.flatMap((layer) =>
      permissionRules(layer.settings).map((permission) => permissionDetail(layer, permission)),
    ),
    ...input.plugins.map((plugin) => pluginDetail(input, plugin)),
  ];
}

function hookDetail(hook: HookItem): SetupDetail {
  return {
    id: hook.id,
    title: hook.name,
    fields: [
      { label: "event", cells: [plain(hook.event)] },
      {
        label: "matcher",
        cells: hook.matcher === "" ? [dim("any")] : [{ text: hook.matcher, look: "tool" }],
      },
      { label: "source", cells: [plain(hook.source)] },
      ...(hook.file === undefined ? [] : [{ label: "file", cells: [plain(hook.file)] }]),
      {
        label: "type",
        cells: hook.isAsync ? [plain(hook.type), dim(" · async")] : [plain(hook.type)],
      },
      {
        label: "timeout",
        cells:
          hook.timeout === null
            ? [dim("default")]
            : [plain(formatDuration(hook.timeout * MS_PER_SECOND))],
      },
      ...(hook.condition === "" ? [] : [{ label: "if", cells: [plain(hook.condition)] }]),
    ],
    body: { title: BODY_TITLES[hook.type] ?? "Hook", text: hook.body },
  };
}

function permissionDetail(layer: SettingsLayer, permission: PermissionRule): SetupDetail {
  return {
    id: permissionIdOf(layer, permission),
    title: "Permission",
    fields: [
      {
        label: "behavior",
        cells: [{ text: permission.kind, look: KIND_LOOKS[permission.kind] }],
      },
      { label: "source", cells: [plain(SOURCE_LABELS[layer.source])] },
      ...(realFileOf(layer.source) === undefined
        ? []
        : [{ label: "file", cells: [plain(layer.file)] }]),
    ],
    body: { title: "Rule", text: permission.rule },
  };
}

function pluginDetail(input: SetupInput, plugin: ActivePlugin): SetupDetail {
  const files = input.pluginFiles.find((entry) => entry.plugin === plugin);
  const hookNames =
    files === undefined ? [] : pluginHookItems(input.home, files).map(({ name }) => name);
  const skillNames = input.skills
    .filter((skill) => skill.pluginName === plugin.name)
    .map((skill) => skill.name);
  const serverNames =
    files === undefined
      ? []
      : [...new Set(files.servers.flatMap(({ document }) => serverNamesOf(document)))];
  return {
    id: pluginIdOf(plugin),
    title: plugin.name,
    fields: [
      ...(files?.version === undefined
        ? []
        : [{ label: "version", cells: [plain(files.version)] }]),
      ...(files === undefined
        ? []
        : [{ label: "path", cells: [plain(tildePath(files.root, input.home))] }]),
      { label: "hooks", cells: namedCount(hookNames, "hook") },
      { label: "skills", cells: namedCount(skillNames, "skill") },
      { label: "MCP", cells: namedCount(serverNames, "server") },
    ],
  };
}

function namedCount(names: readonly string[], noun: string): Cell[] {
  if (names.length === 0) return [dim("none")];
  return [
    plain(String(names.length)),
    dim(` ${plural(noun, names.length)} · `),
    plain(names.join(", ")),
  ];
}

function permissionIdOf(layer: SettingsLayer, { kind, rule }: PermissionRule): string {
  return [layer.file, kind, rule].join("|");
}

function pluginIdOf(plugin: ActivePlugin): string {
  return [plugin.source, plugin.id].join("|");
}

function distinctHooks(items: readonly HookItem[]): HookItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = JSON.stringify([item.event, item.matcher, item.body]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type HookOrigin = { key: string; label: string; file: string | undefined };

function sourceHooks(hooks: unknown, from: HookOrigin): HookItem[] {
  const handlers = Object.entries(recordOf(hooks)).flatMap(([event, matchers]) =>
    listOf(matchers).flatMap((entry) => {
      const { matcher, hooks: group } = recordOf(entry);
      return listOf(group).map((handler) => ({
        event,
        matcher: typeof matcher === "string" ? matcher : "",
        handler: recordOf(handler),
      }));
    }),
  );
  return handlers.flatMap(({ event, matcher, handler }, position) => {
    const type = handlerType(handler);
    const body = handlerBody(type, handler);
    if (body === "") return [];
    const { timeout, async: isAsync, asyncRewake, if: condition } = handler;
    return [
      {
        id: `${from.key}#${position}`,
        event,
        name: handlerName(type, handler),
        source: from.label,
        file: from.file,
        matcher,
        type,
        timeout: typeof timeout === "number" && Number.isFinite(timeout) ? timeout : null,
        isAsync: isAsync === true || asyncRewake === true,
        condition: typeof condition === "string" ? condition : "",
        body,
      },
    ];
  });
}

function handlerType(handler: Record<string, unknown>): string {
  if (typeof handler.type === "string") return handler.type;
  return typeof handler.command === "string" ? "command" : "";
}

function handlerBody(type: string, handler: Record<string, unknown>): string {
  const { command, args, url, prompt, server, tool, input } = handler;
  switch (type) {
    case "command":
      if (typeof command !== "string") return "";
      return [command, ...listOf(args).filter((arg) => typeof arg === "string")].join(" ");
    case "http":
      return typeof url === "string" ? url : "";
    case "prompt":
    case "agent":
      return typeof prompt === "string" ? prompt : "";
    case "mcp_tool":
      if (typeof server !== "string" || typeof tool !== "string") return "";
      return `${server} ${tool}${
        typeof input === "object" && input !== null ? `\n${JSON.stringify(input, null, 2)}` : ""
      }`;
    default:
      return "";
  }
}

function handlerName(type: string, handler: Record<string, unknown>): string {
  const { command, url, tool } = handler;
  switch (type) {
    case "command":
      return hookCommandName(String(command));
    case "http":
      return URL_HOST.exec(String(url))?.[1] ?? String(url);
    case "mcp_tool":
      return String(tool);
    default:
      return type;
  }
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordOf(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function listOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
