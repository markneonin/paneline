import { atom, read, update } from "claude-code";
import type { ContextSkill, EngineInterface, On } from "claude-code";

import { mcpBreakdown, markContextStale } from "./breakdown";
import { isLightTheme } from "./pane-kit";
import { PANE } from "./pane-tab";
import { isShownTab, justEntered } from "./shown-tab";
import { SKILL_USES_KEY } from "./skills-track";
import { skillsTab } from "./skills-draw";
import type { SkillEntry, SkillOwner } from "./skills-draw";
import { rankedUses, withoutFolder } from "./use-counts";
import type { UseCounts } from "./use-counts";
import { isTerminal } from "./surface";

export const SKILLS_TAB = { id: "skills", label: "Skills" };

const TOP_USED_COUNT = 3;

const skillUsesAtom = atom(
  { plugin: "paneline", key: "skillUses" } as const,
  {} as Record<string, number>,
);
const launchFolderAtom = atom({ plugin: "paneline", key: "launchFolder" } as const, "");
const themeAtom = atom({ plugin: "paneline", key: "theme" } as const, "dark");
const skillsExpandedAtom = atom(
  { plugin: "paneline", key: "skillsExpanded" } as const,
  [] as string[],
);
const skillsStatsOpenAtom = atom({ plugin: "paneline", key: "skillsStatsOpen" } as const, false);

const PLUGIN_REGISTRY_FILE = ".claude/plugins/installed_plugins.json";
const SKILL_FILE = "SKILL.md";
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
const BLOCK_SCALAR = /^[>|][+-]?$/;
const SURROUNDING_QUOTES = /^(["'])(.*)\1$/;
const DESCRIPTION_KEY = "description:";

type Folders = { home: string; cwd: string };

type Loaded = { key: string; skills: SkillEntry[] };

let loaded: Loaded | null = null;
let pluginRoots: Map<string, string> | null = null;

export function registerSkillsTab(on: On): void {
  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e, next) => {
    if (!isTerminal(e)) return next(e);
    if (!isShownTab(SKILLS_TAB.id)) return next(e);
    if (justEntered(SKILLS_TAB.id)) {
      markContextStale();
      loaded = null;
      pluginRoots = null;
    }
    const [context, expanded, uses, statsOpen, theme, home, cwd] = await Promise.all([
      mcpBreakdown((args) => $.session.usage(args)),
      read($, skillsExpandedAtom),
      read($, skillUsesAtom),
      read($, skillsStatsOpenAtom),
      read($, themeAtom),
      $.env.get("HOME"),
      $.session.cwd(),
    ]);
    const allUsed = rankedUses(uses);
    return skillsTab($.ui.resolve(e), {
      width: e.props.bodyColumns,
      isLightTheme: isLightTheme(theme),
      top: allUsed.slice(0, TOP_USED_COUNT),
      allUsed,
      statsOpen,
      clearUses: () => void clearSkillUses($),
      toggleStats: () => void update($, skillsStatsOpenAtom, (isOpen) => !isOpen),
      skills: await entriesOf($, context?.skills?.skillFrontmatter ?? [], {
        home: home ?? "",
        cwd,
      }),
      expanded: new Set(expanded),
      toggle: (name) =>
        void update($, skillsExpandedAtom, (list) =>
          list.includes(name) ? list.filter((open) => open !== name) : [...list, name],
        ),
      insert: (name) => void insertCommand($, name),
    });
  });
}

async function clearSkillUses($: EngineInterface): Promise<void> {
  const folder = await read($, launchFolderAtom);
  const stored = (await $.store.get(SKILL_USES_KEY)) ?? {};
  await $.store.set(SKILL_USES_KEY, withoutFolder(stored as UseCounts, folder));
  await update($, skillUsesAtom, () => ({}));
}

async function insertCommand($: EngineInterface, name: string): Promise<void> {
  const { text } = await $.prompt.read();
  if (text.startsWith(`/${name} `)) return;
  await $.prompt.fill({ text: `/${name} ${text}` });
}

async function entriesOf(
  $: EngineInterface,
  listed: ContextSkill[],
  folders: Folders,
): Promise<SkillEntry[]> {
  const key = JSON.stringify([listed, folders]);
  if (loaded?.key === key) return loaded.skills;
  const [roots, commandDescriptions] = await Promise.all([
    pluginRootsOf($, folders.home),
    commandDescriptionsOf($),
  ]);
  const unique = [
    ...new Map(listed.map((skill) => [`${skill.source}:${skill.name}`, skill])).values(),
  ];
  const skills = (await Promise.all(unique.map((skill) => entryOf($, skill, folders, roots)))).map(
    (entry) => ({
      ...entry,
      description: entry.description || (commandDescriptions.get(entry.name) ?? ""),
    }),
  );
  loaded = { key, skills };
  return skills;
}

async function commandDescriptionsOf($: EngineInterface): Promise<Map<string, string>> {
  const commands = await $.command.list().catch(() => []);
  return new Map(commands.map((command) => [command.name, command.description]));
}

async function entryOf(
  $: EngineInterface,
  skill: ContextSkill,
  folders: Folders,
  roots: Map<string, string>,
): Promise<SkillEntry> {
  if (skill.source === "built-in") {
    return { name: skill.name, description: "", owner: "built-in" };
  }
  if (skill.source === "plugin" || skill.source === "mcp") {
    const plugin = skill.pluginName ?? skill.name.split(":")[0] ?? skill.source;
    const root = roots.get(plugin);
    const folder = skill.name.split(":").pop() ?? skill.name;
    const text = root === undefined ? "" : await pluginSkillText($, root, folder);
    return { name: skill.name, description: descriptionOf(text), owner: "plugin", plugin };
  }
  const userText = await readText($, skillPath(folders.home, skill.name));
  if (userText !== "") {
    return { name: skill.name, description: descriptionOf(userText), owner: "user" };
  }
  const projectText = await readText($, skillPath(folders.cwd, skill.name));
  const owner: SkillOwner = projectText === "" ? "user" : "project";
  return { name: skill.name, description: descriptionOf(projectText), owner };
}

async function pluginSkillText($: EngineInterface, root: string, folder: string): Promise<string> {
  const skillText = await readText($, `${root}/skills/${folder}/${SKILL_FILE}`);
  return skillText === "" ? readText($, `${root}/commands/${folder}.md`) : skillText;
}

function skillPath(base: string, name: string): string {
  return `${base}/.claude/skills/${name}/${SKILL_FILE}`;
}

async function pluginRootsOf($: EngineInterface, home: string): Promise<Map<string, string>> {
  if (pluginRoots !== null) return pluginRoots;
  const text = await readText($, `${home}/${PLUGIN_REGISTRY_FILE}`);
  const registry = parseRegistry(text);
  pluginRoots = new Map(
    Object.entries(registry).flatMap(([id, installs]) => {
      const root = installs[0]?.installPath;
      return root === undefined ? [] : [[id.split("@")[0] ?? id, root] as const];
    }),
  );
  return pluginRoots;
}

function parseRegistry(text: string): Record<string, { installPath?: string }[]> {
  try {
    const parsed = JSON.parse(text) as { plugins?: Record<string, { installPath?: string }[]> };
    return parsed.plugins ?? {};
  } catch {
    return {};
  }
}

function readText($: EngineInterface, path: string): Promise<string> {
  return $.fs.read(path).catch(() => "");
}

function descriptionOf(skillText: string): string {
  const block = FRONTMATTER.exec(skillText)?.[1];
  if (block === undefined) return "";
  const lines = block.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(DESCRIPTION_KEY));
  if (start === -1) return "";
  const first = (lines[start] ?? "").slice(DESCRIPTION_KEY.length).trim();
  const continuation = lines
    .slice(start + 1)
    .filter((line) => line.trim() === "" || /^\s/.test(line))
    .map((line) => line.trim());
  const parts = BLOCK_SCALAR.test(first) ? continuation : [first, ...continuation];
  const joined = parts.filter((part) => part !== "").join(" ");
  return joined.replace(SURROUNDING_QUOTES, "$2");
}
