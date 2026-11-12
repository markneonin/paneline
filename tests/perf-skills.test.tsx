import { describe, expect, mock, test } from "claude-code/testing";
import type { On, SessionContextBreakdown } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { showTabThroughArrows } from "./spend-world";
import { blocksOf, linesOf } from "./skills-tree";
import type { Block } from "./skills-tree";

type Pane = Mounted<"terminal", "Pane">;
type ListedSkill = { name: string; source: string; pluginName?: string };
type StoredFile = { text: string; mtimeMs: number };
type World = {
  reads: string[];
  readsOf: (path: string) => number;
  changeFile: (path: string, text: string, mtimeMs: number) => void;
  failNextReadOf: (path: string) => void;
};
type WorldOptions = { skills: ListedSkill[]; files: Record<string, string>; mtimeMs: number };

const COLUMNS = 60;
const PANE_ROWS = 40;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const NOW = 1_800_000_000_000;
const HOME = "/h/u";
const CWD = "/work";
const PLUGIN_ROOT = "/p";
const HEADINGS = ["Top used", "User", "Project", "runpod", "Built-in", "Off"];
const CLAUDE_JSON = `${HOME}/.claude.json`;
const FRAMES = 5;
const COMMIT_DESCRIPTION = "Commit the staged changes with a short message.";
const RUNPOD_DESCRIPTION = "Start here for any Runpod task.";
const BODY_LINE = "Body text that must not show.";
const COMMIT: ListedSkill = { name: "commit", source: "userSettings" };
const DOCS: ListedSkill = { name: "docs", source: "userSettings" };
const RUNPOD: ListedSkill = { name: "runpod:runpod", source: "plugin", pluginName: "runpod" };
const FIRST_MTIME = NOW - MS_PER_HOUR;
const SECOND_MTIME = NOW - 2 * MS_PER_HOUR;
const CHANGED_MTIME = NOW - 3 * MS_PER_HOUR;
const FAILED_READ_MTIME = NOW - 4 * MS_PER_HOUR;
const FIRST_USAGE_TEXT = usageText({
  commit: { usageCount: 44, lastUsedAt: NOW - 3 * MS_PER_DAY },
  docs: { usageCount: 1, lastUsedAt: NOW - 2 * MS_PER_HOUR },
  "runpod:runpod": { usageCount: 7, lastUsedAt: NOW - 3 * MS_PER_DAY },
});
const SECOND_USAGE_TEXT = usageText({
  commit: { usageCount: 45, lastUsedAt: NOW - 3 * MS_PER_DAY },
  docs: { usageCount: 1, lastUsedAt: NOW - 2 * MS_PER_HOUR },
});
const USER_ROWS_BEFORE = ["▸ commit 10 tokens 44 uses · 3d", "▸ docs 10 tokens 1 use · 2h"];
const RUNPOD_ROWS = ["▸ runpod:runpod 10 tokens 7 uses · 3d"];

describe("skills tab frame reads", () => {
  test("P4-1 with ~/.claude.json unchanged, five redraws on the Skills tab draw the same rows and read the file once", async ($, on) => {
    const world = worldOf(on, {
      skills: [COMMIT, DOCS, RUNPOD],
      files: {
        ...userFile("commit", COMMIT_DESCRIPTION),
        ...pluginRegistryFile(),
        [`${PLUGIN_ROOT}/skills/runpod/SKILL.md`]: skillFile("runpod", RUNPOD_DESCRIPTION),
        [CLAUDE_JSON]: FIRST_USAGE_TEXT,
      },
      mtimeMs: FIRST_MTIME,
    });
    await startIn($, CWD);
    const pane = await mountPane($);
    world.reads.length = 0;

    await showTabThroughArrows(pane, "Skills");
    const framesOfRows: { user: string[]; runpod: string[] }[] = [];
    for (let frame = 0; frame < FRAMES; frame++) {
      await pane.redraw();
      const found = await blocks(pane);
      framesOfRows.push({ user: rowTexts(found.User), runpod: rowTexts(found.runpod) });
    }

    expect(framesOfRows).toEqual(
      Array.from({ length: FRAMES }, () => ({ user: USER_ROWS_BEFORE, runpod: RUNPOD_ROWS })),
    );
    expect(world.readsOf(CLAUDE_JSON)).toBe(1);
  });

  test("P4-2 after ~/.claude.json changes on disk the Skills tab shows the new use count on the next redraw and reads the file once more, not on each frame", async ($, on) => {
    const world = worldOf(on, {
      skills: [COMMIT, DOCS],
      files: { ...userFile("commit", COMMIT_DESCRIPTION), [CLAUDE_JSON]: FIRST_USAGE_TEXT },
      mtimeMs: SECOND_MTIME,
    });
    await startIn($, CWD);
    const pane = await mountPane($);
    await showTabThroughArrows(pane, "Skills");
    world.reads.length = 0;

    world.changeFile(CLAUDE_JSON, SECOND_USAGE_TEXT, CHANGED_MTIME);
    await pane.redraw();
    const nextFrame = rowTexts((await blocks(pane)).User);
    for (let frame = 1; frame < FRAMES; frame++) await pane.redraw();

    expect(nextFrame).toEqual(["▸ commit 10 tokens 45 uses · 3d", "▸ docs 10 tokens 1 use · 2h"]);
    expect(world.readsOf(CLAUDE_JSON)).toBe(1);
  });

  test("P4-3 when the first read of ~/.claude.json fails, the next redraw reads it again and draws its use counts", async ($, on) => {
    const world = worldOf(on, {
      skills: [COMMIT, DOCS],
      files: { ...userFile("commit", COMMIT_DESCRIPTION), [CLAUDE_JSON]: FIRST_USAGE_TEXT },
      mtimeMs: FAILED_READ_MTIME,
    });
    await startIn($, CWD);
    const pane = await mountPane($);
    world.failNextReadOf(CLAUDE_JSON);

    await showTabThroughArrows(pane, "Skills");
    await pane.redraw();

    expect(rowTexts((await blocks(pane)).User)).toEqual(USER_ROWS_BEFORE);
  });
});

function rowTexts(block: Block | undefined): string[] {
  return (block?.rows ?? []).map((row) => row.text);
}

function usageText(
  skillUsage: Record<string, { usageCount?: number; lastUsedAt?: number }>,
): string {
  return JSON.stringify({ skillUsage });
}

function skillFile(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${BODY_LINE}\n`;
}

function userFile(name: string, description: string): Record<string, string> {
  return { [`${HOME}/.claude/skills/${name}/SKILL.md`]: skillFile(name, description) };
}

function pluginRegistryFile(): Record<string, string> {
  return {
    [`${HOME}/.claude/plugins/installed_plugins.json`]: JSON.stringify({
      plugins: { "runpod@marketplace": [{ installPath: PLUGIN_ROOT }] },
    }),
  };
}

async function blocks(pane: Pane): Promise<Record<string, Block>> {
  return blocksOf(linesOf(await pane.drawn()), HEADINGS);
}

async function startIn($: Engine, folder: string): Promise<void> {
  await $.session.start({ cwd: folder, surface: "terminal", isInteractive: true });
}

function mountPane($: Engine): Promise<Pane> {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: "session",
    props: {
      title: "Session",
      isFocused: false,
      bodyColumns: COLUMNS,
      placement: "dock",
      scroll: { offset: 0, bodyRows: PANE_ROWS },
      view: {},
    },
    viewport: { columns: COLUMNS, rows: PANE_ROWS },
  });
}

function worldOf(on: On, options: WorldOptions): World {
  const stored = new Map<string, unknown>();
  const stateValues = new Map<string, { value: unknown; version: number }>();
  const files = new Map<string, StoredFile>(
    Object.entries(options.files).map(([path, text]) => [path, { text, mtimeMs: options.mtimeMs }]),
  );
  const refusals = new Set<string>();
  const world: World = {
    reads: [],
    readsOf: (path) => world.reads.filter((read) => read === path).length,
    changeFile: (path, text, mtimeMs) => {
      files.set(path, { text, mtimeMs });
    },
    failNextReadOf: (path) => {
      refusals.add(path);
    },
  };
  mock.clock(on, { now: NOW });
  mock.env(on, { HOME });
  on("config.list", () => ({ value: [{ key: "theme", value: "dark" }] }) as never);
  on("store.get", (_$, e) => ({ value: stored.get(e.key) }));
  on("store.set", (_$, e) => {
    stored.set(e.key, e.value);
    return { value: undefined };
  });
  on("store.delete", (_$, e) => {
    stored.delete(e.key);
    return { value: undefined };
  });
  on("store.keys", () => ({ value: [...stored.keys()] }));
  on("state.get", (_$, e) => ({
    value: stateValues.get(e.key) ?? { value: undefined, version: 0 },
  }));
  on("state.set", (_$, e) => {
    const version = (stateValues.get(e.key)?.version ?? 0) + 1;
    stateValues.set(e.key, { value: e.value, version });
    return { value: { isSet: true, version } };
  });
  on("command.list", () => ({ value: [] }));
  on("classic.SessionStart", () => ({}));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("command.register", () => ({ value: {} }) as never);
  on("agent.list", () => ({ value: [] }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("prompt.read", () => ({ value: { text: "", cursor: 0 } }));
  on("session.usage", (_$, e) => {
    const breakdown = {
      categories: [],
      totalTokens: 0,
      rawMaxTokens: 200_000,
      gridRows: [],
      memoryFiles: [],
      agents: [],
      mcpTools: [],
      skills: {
        totalSkills: options.skills.length,
        includedSkills: options.skills.length,
        tokens: 0,
        skillFrontmatter: options.skills.map((skill) => ({ ...skill, tokens: 10 })),
      },
    } as unknown as SessionContextBreakdown;
    const context =
      e.breakdown === undefined ? { window: 200_000 } : { window: 200_000, breakdown };
    return { value: { startedAt: 0, context, rateLimits: [] } };
  });
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.model", () => ({ value: "opus" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: CWD }));
  on("fs.exists", (_$, e) => ({ value: files.has(e.path) }));
  on("fs.stat", (_$, e) => {
    const file = files.get(e.path);
    if (file === undefined) throw new Error(`ENOENT: ${e.path}`);
    return {
      value: { kind: "file", size: file.text.length, mtimeMs: file.mtimeMs, isLink: false },
    };
  });
  on("fs.read", (_$, e) => {
    world.reads.push(e.path);
    if (refusals.delete(e.path)) throw new Error(`EIO: ${e.path}`);
    const file = files.get(e.path);
    if (file === undefined) throw new Error(`ENOENT: ${e.path}`);
    return { value: file.text };
  });
  on("ui.render", { component: "Pane" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine pane</Text>;
  });
  return world;
}
