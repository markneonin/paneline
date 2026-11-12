import { atom, read, update } from "claude-code";
import type { EngineInterface, On } from "claude-code";

import { contextBreakdown, markContextStale } from "./breakdown";
import { keepPane, PANE } from "./pane-tab";
import { setupTab } from "./setup-draw";
import {
  installedPlugins,
  PLUGIN_MANIFEST,
  pluginReadPaths,
  pluginSources,
  pluginsInForce,
  setupBlocks,
  setupDetails,
  SETTINGS_SOURCES,
  settingsFileOf,
} from "./setup-model";
import type {
  ActivePlugin,
  PluginFiles,
  SetupBlock,
  SetupDetail,
  SettingsLayer,
} from "./setup-model";
import { isShownTab, justEntered } from "./shown-tab";
import { skillUsageOf } from "./skill-usage";

export const SETUP_TAB = { id: "setup", label: "Setup" };

const PLUGIN_REGISTRY_FILE = ".claude/plugins/installed_plugins.json";
const CLAUDE_CONFIG_FILE = ".claude.json";

type Loaded = { blocks: SetupBlock[]; details: SetupDetail[] };

const bodyOffsetAtom = atom({ plugin: "paneline", key: "bodyOffset" } as const, 0);
const tabAtom = atom({ plugin: "paneline", key: "tab" } as const, "activity");
const setupHookAtom = atom(
  { plugin: "paneline", key: "setupHook" } as const,
  null as { id: string; listOffset: number } | null,
);

let loaded: Loaded | null = null;

export function registerSetupTab(on: On): void {
  on("ui.close", { id: PANE }, async ($, e, next) => {
    if (e.origin.kind !== "person" || (await read($, tabAtom)) !== SETUP_TAB.id) return next(e);
    if ((await read($, setupHookAtom)) === null) return next(e);
    await closeDetail($);
    return keepPane($);
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e, next) => {
    if (!isShownTab(SETUP_TAB.id)) return next(e);
    if (justEntered(SETUP_TAB.id)) {
      markContextStale();
      loaded = null;
    }
    const { blocks, details } = loaded ?? (await loadSetup($, e.props.bodyColumns));
    const openId = (await read($, setupHookAtom))?.id;
    return setupTab($.ui.resolve(e), {
      width: e.props.bodyColumns,
      blocks,
      opened: details.find((detail) => detail.id === openId),
      openDetail: (id) => void openDetail($, id),
      closeDetail: () => void closeDetail($),
    });
  });
}

async function openDetail($: EngineInterface, id: string): Promise<void> {
  const listOffset = await read($, bodyOffsetAtom);
  await update($, setupHookAtom, () => ({ id, listOffset }));
  await update($, bodyOffsetAtom, () => 0);
}

async function closeDetail($: EngineInterface): Promise<void> {
  const open = await read($, setupHookAtom);
  await update($, setupHookAtom, () => null);
  await update($, bodyOffsetAtom, () => open?.listOffset ?? 0);
}

async function loadSetup($: EngineInterface, columns: number): Promise<Loaded> {
  const breakdown = await contextBreakdown((args) => $.session.usage(args), columns);
  const home = (await $.env.get("HOME")) ?? "";
  const memoryFiles = breakdown?.memoryFiles ?? [];
  const layers = await settingsLayers($);
  const plugins = pluginsInForce(layers);
  const [fileTexts, pluginFiles, claudeText, now] = await Promise.all([
    Promise.all(memoryFiles.map(async ({ path }) => ({ path, text: await readText($, path) }))),
    pluginFilesOf($, plugins, `${home}/${PLUGIN_REGISTRY_FILE}`),
    readText($, `${home}/${CLAUDE_CONFIG_FILE}`),
    $.clock.now(),
  ]);
  const input = {
    home,
    now,
    memoryFiles,
    fileTexts,
    layers,
    plugins,
    pluginFiles,
    skills: breakdown?.skills?.skillFrontmatter ?? [],
    skillUsage: skillUsageOf(claudeText),
  };
  const setup = { blocks: setupBlocks(input), details: setupDetails(input) };
  if (breakdown !== null) loaded = setup;
  return setup;
}

async function settingsLayers($: EngineInterface): Promise<SettingsLayer[]> {
  return Promise.all(
    SETTINGS_SOURCES.map(async (source) => ({
      source,
      file: settingsFileOf(source),
      settings: await $.settings.read({ source }),
    })),
  );
}

async function pluginFilesOf(
  $: EngineInterface,
  plugins: readonly ActivePlugin[],
  registryPath: string,
): Promise<PluginFiles[]> {
  const installs = installedPlugins(await readText($, registryPath));
  return Promise.all(
    plugins.flatMap((plugin) => {
      const install = installs.get(plugin.id);
      const root = plugin.folder ?? install?.root;
      if (root === undefined) return [];
      return [readPluginFiles($, plugin, root, install?.version)];
    }),
  );
}

async function readPluginFiles(
  $: EngineInterface,
  plugin: ActivePlugin,
  root: string,
  version: string | undefined,
): Promise<PluginFiles> {
  const manifestText = await readText($, `${root}/${PLUGIN_MANIFEST}`);
  const files = await Promise.all(
    pluginReadPaths(root, manifestText).map(async (path) => ({
      path,
      text: await readText($, path),
    })),
  );
  return { plugin, root, version, ...pluginSources(root, manifestText, files) };
}

function readText($: EngineInterface, path: string): Promise<string> {
  return $.fs.read(path).catch(() => "");
}
