import { atom, read, update } from "claude-code";
import type { ContextSkill, EngineInterface, On, SessionContextBreakdown } from "claude-code";

import {
  cachedContextBreakdown,
  loadFullBreakdown,
  mcpBreakdown,
  markContextStale,
} from "./breakdown";
import { focusFilter, isLightTheme } from "./pane-kit";
import { keepPane, PANE } from "./pane-tab";
import { isShownTab, justEntered } from "./shown-tab";
import { skillUsageOf } from "./skill-usage";
import type { SkillUsage } from "./skill-usage";
import { promptedTab, skillsTab } from "./skills-draw";
import type { PromptBlockView, PromptEntry, SkillEntry, SkillOwner } from "./skills-draw";
import { rankedUses } from "./use-counts";
import { clearUses } from "./store-queue";

export const SKILLS_TAB = { id: "skills", label: "Skills" };

const TOP_USED_COUNT = 3;

const skillUsesAtom = atom(
  { plugin: "paneline", key: "skillUses" } as const,
  {} as Record<string, number>,
);
const launchFolderAtom = atom({ plugin: "paneline", key: "launchFolder" } as const, "");
const themeAtom = atom({ plugin: "paneline", key: "theme" } as const, "dark");
const tabAtom = atom({ plugin: "paneline", key: "tab" } as const, "activity");
const skillsExpandedAtom = atom(
  { plugin: "paneline", key: "skillsExpanded" } as const,
  [] as string[],
);
const skillsFilterAtom = atom({ plugin: "paneline", key: "skillsFilter" } as const, "");
const neverUsedOpenAtom = atom({ plugin: "paneline", key: "skillsNeverOpen" } as const, false);
const overridesRevisionAtom = atom({ plugin: "paneline", key: "skillOverridesRev" } as const, 0);
const skillsStatsOpenAtom = atom({ plugin: "paneline", key: "skillsStatsOpen" } as const, false);

const PLUGIN_REGISTRY_FILE = ".claude/plugins/installed_plugins.json";
const CLAUDE_JSON_FILE = ".claude.json";
const LOCAL_SETTINGS_FILE = ".claude/settings.local.json";
const LOAD_ATTEMPTS = 20;
const LOAD_RETRY_MS = 100;
const OVERRIDE_OFF = "off";
const SKILL_FILE = "SKILL.md";
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
const BLOCK_SCALAR = /^[>|][+-]?$/;
const SURROUNDING_QUOTES = /^(["'])(.*)\1$/;
const DESCRIPTION_KEY = "description:";
const PROMPTS_FILE = ".claude/paneline-prompts.md";
const GLOBAL_PROMPTS_TITLE = "Prompts";
const PROJECT_PROMPTS_TITLE = "Project prompts";
const PROMPT_HEADING = /^## /m;
const LINE_BREAK = /\r?\n/;

type Folders = { home: string; cwd: string };

type LocalSettings = { skillOverrides?: Record<string, string> };

type Loaded = { key: string; skills: SkillEntry[] };

type PromptFiles = { key: string; blocks: PromptBlockView[] };

let loaded: Loaded | null = null;
let pluginRoots: Map<string, string> | null = null;
let promptFiles: PromptFiles | null = null;

let claudeJsonUsage: { key: string; usage: SkillUsage | null } | null = null;

export function registerSkillsTab(on: On): void {
  on("ui.close", { id: PANE }, async ($, e, next) => {
    if (e.origin.kind !== "person" || (await read($, tabAtom)) !== SKILLS_TAB.id) return next(e);
    if ((await read($, skillsFilterAtom)) === "") return next(e);
    await update($, skillsFilterAtom, () => "");
    return keepPane($);
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e, next) => {
    if (!isShownTab(SKILLS_TAB.id)) return next(e);
    if (justEntered(SKILLS_TAB.id)) {
      markContextStale();
      loaded = null;
      pluginRoots = null;
      promptFiles = null;
    }
    const full = cachedContextBreakdown(e.props.bodyColumns);
    if (full === null) void loadFullBreakdown($, e.props.bodyColumns);
    const [, context, expanded, uses, statsOpen, neverOpen, theme, filter, home, cwd] =
      await Promise.all([
        read($, overridesRevisionAtom),
        mcpBreakdown((args) => $.session.usage(args)),
        read($, skillsExpandedAtom),
        read($, skillUsesAtom),
        read($, skillsStatsOpenAtom),
        read($, neverUsedOpenAtom),
        read($, themeAtom),
        read($, skillsFilterAtom),
        $.env.get("HOME"),
        $.session.cwd(),
      ]);
    const allUsed = rankedUses(uses);
    const [usage, overridesText] = await Promise.all([
      cachedSkillUsage($, `${home ?? ""}/${CLAUDE_JSON_FILE}`),
      readText($, localSettingsPath(cwd)),
    ]);
    const folders = { home: home ?? "", cwd };
    const ui = $.ui.resolve(e);
    const tab = skillsTab(ui, {
      width: e.props.bodyColumns,
      isLightTheme: isLightTheme(theme),
      top: allUsed.slice(0, TOP_USED_COUNT),
      allUsed,
      statsOpen,
      clearUses: () => void clearSkillUses($),
      toggleStats: () => void update($, skillsStatsOpenAtom, (isOpen) => !isOpen),
      skills: withFullTokens(
        await entriesOf($, context?.skills?.skillFrontmatter ?? [], folders),
        full,
      ),
      expanded: new Set(expanded),
      toggle: (name) =>
        void update($, skillsExpandedAtom, (list) =>
          list.includes(name) ? list.filter((open) => open !== name) : [...list, name],
        ),
      insert: (name) => void insertCommand($, name),
      filter,
      setFilter: (text) => void update($, skillsFilterAtom, () => text),
      focusFilter: () => void focusFilter($),
      usage,
      now: await $.clock.now(),
      neverOpen,
      toggleNever: () => void update($, neverUsedOpenAtom, (isOpen) => !isOpen),
      offNames: offNamesOf(overridesText),
      setOff: (name, off) => void setSkillOff($, cwd, name, off),
    });
    return promptedTab(
      ui,
      {
        width: e.props.bodyColumns,
        blocks: await promptBlocksOf($, folders),
        fill: (text) => void $.prompt.fill({ text, mode: "insert" }),
      },
      tab,
    );
  });
}

function withFullTokens(
  skills: readonly SkillEntry[],
  full: SessionContextBreakdown | null,
): SkillEntry[] {
  const tokens = new Map(
    (full?.skills?.skillFrontmatter ?? []).map((skill) => [
      `${skill.source}:${skill.name}`,
      skill.tokens,
    ]),
  );
  return skills.map((skill) => ({ ...skill, tokens: tokens.get(`${skill.source}:${skill.name}`) }));
}

async function clearSkillUses($: EngineInterface): Promise<void> {
  const folder = await read($, launchFolderAtom);
  clearUses($, folder, ["skill"]);
  await update($, skillUsesAtom, () => ({}));
}

function localSettingsPath(cwd: string): string {
  return `${cwd}/${LOCAL_SETTINGS_FILE}`;
}

function offNamesOf(settingsText: string): Set<string> {
  const overrides = parseSettings(settingsText).skillOverrides ?? {};
  return new Set(
    Object.entries(overrides).flatMap(([name, value]) => (value === OVERRIDE_OFF ? [name] : [])),
  );
}

function parseSettings(text: string): LocalSettings {
  try {
    return (JSON.parse(text) as LocalSettings | null) ?? {};
  } catch {
    return {};
  }
}

async function setSkillOff(
  $: EngineInterface,
  cwd: string,
  name: string,
  off: boolean,
): Promise<void> {
  const path = localSettingsPath(cwd);
  const text = await readText($, path);
  const settings = (text.trim() === "" ? {} : JSON.parse(text)) as LocalSettings;
  const { skillOverrides: current = {}, ...rest } = settings;
  const overrides = off
    ? { ...current, [name]: OVERRIDE_OFF }
    : Object.fromEntries(Object.entries(current).filter(([key]) => key !== name));
  const next = Object.keys(overrides).length === 0 ? rest : { ...rest, skillOverrides: overrides };
  await $.fs.write(path, `${JSON.stringify(next, null, 2)}\n`);
  await untilEngineLoads($, name, off);
  markContextStale();
  await update($, overridesRevisionAtom, (revision) => revision + 1);
}

async function untilEngineLoads($: EngineInterface, name: string, off: boolean): Promise<void> {
  for (let attempt = 0; attempt < LOAD_ATTEMPTS; attempt++) {
    const loadedSettings = (await $.settings.read({ source: "local" })) as LocalSettings;
    if ((loadedSettings.skillOverrides?.[name] === OVERRIDE_OFF) === off) return;
    await $.clock.sleep(LOAD_RETRY_MS);
  }
}

async function insertCommand($: EngineInterface, name: string): Promise<void> {
  const { text } = await $.prompt.read();
  if (text.startsWith(`/${name} `)) return;
  await $.prompt.fill({ text: `/${name} ${text}` });
}

async function promptBlocksOf($: EngineInterface, folders: Folders): Promise<PromptBlockView[]> {
  const key = JSON.stringify(folders);
  if (promptFiles?.key === key) return promptFiles.blocks;
  const globalPath = `${folders.home}/${PROMPTS_FILE}`;
  const projectPath = `${folders.cwd}/${PROMPTS_FILE}`;
  const globalText = await readText($, globalPath);
  const projectText = projectPath === globalPath ? "" : await readText($, projectPath);
  const blocks = [
    { title: GLOBAL_PROMPTS_TITLE, prompts: promptsOf(globalText) },
    { title: PROJECT_PROMPTS_TITLE, prompts: promptsOf(projectText) },
  ].filter((block) => block.prompts.length > 0);
  promptFiles = { key, blocks };
  return blocks;
}

function promptsOf(promptText: string): PromptEntry[] {
  return promptText
    .split(PROMPT_HEADING)
    .slice(1)
    .map((section) => {
      const [label = "", ...body] = section.split(LINE_BREAK);
      return { label: label.trim(), text: body.join("\n").trim() };
    });
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
    (entry, index) => ({
      ...entry,
      source: unique[index]?.source,
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

async function cachedSkillUsage($: EngineInterface, path: string): Promise<SkillUsage | null> {
  const stat = await $.fs.stat(path).catch(() => undefined);
  if (stat === undefined) return skillUsageOf(await readText($, path));
  const key = `${stat.mtimeMs}:${stat.size}`;
  if (claudeJsonUsage?.key === key) return claudeJsonUsage.usage;
  const text = await $.fs.read(path).catch(() => undefined);
  if (text === undefined) return null;
  const usage = skillUsageOf(text);
  claudeJsonUsage = { key, usage };
  return usage;
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
