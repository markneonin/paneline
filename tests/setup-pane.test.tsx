import { describe, expect, mock, test } from "claude-code/testing";
import type { On, SessionContextBreakdown } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { paneInk } from "../hooks/pane-ink";
import { coloursOfText, screenRows } from "./band-screen";
import { pressPagedTab } from "./clear-world";
import { NAME_CASES, tmuxHookCommand } from "./hook-name-cases";
import { childrenOf, collect, textOf } from "./draw-tree";
import { isHeavy } from "./weight";
import { headingOrder, linesOf, nameButtonOf } from "./skills-tree";
import type { Block, Line } from "./skills-tree";

type Pane = Mounted<"terminal", "Pane">;
type Source = "policy" | "flag" | "local" | "project" | "user";
type MemoryFile = { path: string; type: string; tokens: number };
type ListedSkill = { name: string; source: string; pluginName?: string };
type WorldOptions = {
  memoryFiles?: MemoryFile[];
  files?: Record<string, string>;
  settings?: Partial<Record<Source, Record<string, unknown>>>;
  skills?: ListedSkill[];
};

const COLUMNS = 60;
const PANE_ROWS = 100;
const SETTLE_TICKS = 5;
const MAX_TAB_PRESSES = 12;
const NEXT_TAB_LABEL = "›";
const SETUP = "Setup";
const HOME = "/h/u";
const CWD = "/work";
const DAY_MS = 86_400_000;
const NOW = 1_800_000_000_000;
const HEADINGS = [
  "Instructions",
  "Repeated rules",
  "Hooks",
  "Permissions",
  "Plugins",
  "Skills not used in 30 days",
];
const USER_SETTINGS = "~/.claude/settings.json";
const LOCAL_SETTINGS = ".claude/settings.local.json";
const USER_CLAUDE = "/h/u/.claude/CLAUDE.md";
const PROJECT_CLAUDE = "/h/u/proj/CLAUDE.md";
const SKILL_USAGE_FILE = "/h/u/.claude.json";
const PLUGIN_REGISTRY_FILE = "/h/u/.claude/plugins/installed_plugins.json";
const LONG_FOLDER = `/h/u/${"deeply-nested-folder/".repeat(8)}proj`;
const SHARED_RULE = "Never push without the owner's explicit yes";
const SHARED_RULE_SHOUTED = "NEVER  push without the owner's   explicit yes.";
const SHARED_RULE_TEXT = "never push without the owner's explicit yes";
const SHORT_RULE = "Keep it simple";
const HEADING_RULE = "Always run the full test suite";
const FENCED_RULE = "git push --force origin main now";
const FRONTMATTER_RULE = "description: Use when the owner asks for it";
const WIDE_COLUMNS = 120;
const TALL_PANE_ROWS = 400;
const EVENT_INDENT = 2;
const COLUMN_GAP = 2;
const BODY_OFFSET_KEY = "bodyOffset";
const HOOK_KEY = "setupHook";
const BACK_LABEL = /^\[?\s*back\s*\]?$/;
const BACK_ROW = "[ back ]";
const PUSH_COMMAND = "claude-settings push";
const PUSH_PATH = "~/.claude/bin/claude-settings push";
const RECORD_PATH = "~/.claude/bin/task-context record";
const RECORD_NAME = "task-context record";
const CRON_GUARD = '"${TMUX_CLAUDE_HOOK_TMUX_BIN:-tmux}" hooks claude cron-create-guard';
const CRON_GUARD_NAME = "tmux cron-create-guard";
const MEMORY_PATH = "/home/dev/.claude/projects/-home-dev-projects-IT-demo-app/memory/MEMORY.md";
const MEMORY_TOKENS = 390;
const MEMORY_CUT_ROW = /MEMORY\.md\s+…[-/]\S*memory\s+390$/;
const MID_NAME = "cron-create-guard-and-inbox-drain";
const MID_PATH = `/a/b/${MID_NAME}`;
const LONG_NAME = "cron-create-guard-and-inbox-drain-and-the-rest-of-it";
const LONG_PATH = `/a/b/${LONG_NAME}`;
const REMINDER_PATH = "~/.claude/hooks/settings-cleanup-reminder";
const REMINDER_NAME = "settings-cleanup-reminder";
const LONG_EVENT = "PermissionRequest";
const NO_INSTRUCTIONS = "no instruction files · CLAUDE.md files the session loads show here";
const SCROLLED_ROWS = 3;
const GUARD_NAME = "guard.js";
const GUARD_PATH = "/a/b/guard.js";
const PUSH_RULE = "Bash(git push *)";
const SPOOL_HEAD =
  'if [ -n "${TMUX_CLAUDE_HOOK_SPOOL_DIR:-}" ] && [ -x /bin/zsh ]; then exec /bin/zsh -fc \'LC_ALL=C';
const SPOOL_TAIL =
  "' tmux-hook 'tmux_cli=x; \"$tmux_cli\" hooks enqueue claude stop'; else /bin/sh -c 'x'; fi";
const STEP_LEADS = ["", "  ", "    ", "\t"];
const STEP_COUNT = 20;
const EDIT_MATCHER = "Write|Edit|MultiEdit|NotebookEdit";
const LONG_FIRST_LINE = `tmux_probe ${Array.from({ length: 10 }, (_, step) => `probe_step_${step}`).join(" ")}`;
const NESTED_ONE = "  nested_one --flag";
const NESTED_TWO = "  nested_two --flag";
const ALL_KINDS = {
  allow: ["Bash(git status)"],
  deny: ["Read(./.env)"],
  ask: ["Bash(git push:*)"],
};
const CUE = "click a hook for its full command";
const LONG_RULE =
  "Bash(git push --force-with-lease origin feature/the-long-branch-name-that-keeps-going)";
const PLUGIN_ID = "gate@market";
const PLUGIN_NAME = "gate";
const PLUGIN_PATH = "/cache/gate";
const PLUGIN_SKILLS = ["gate-review", "gate-lint"];
const PLUGIN_VERSION = "1.4.2";
const PLUGIN_MCP_PATH = `${PLUGIN_PATH}/.mcp.json`;
const WRAPPED_MCP = { mcpServers: { "sec-scan": { command: "sec" }, docs: { command: "docs" } } };
const MANIFEST_HOOK_FILE = "hooks/stop.json";
const SEPARATED_TOKEN = "build_cache-step/".repeat(12);
const SEPARATOR_END = /[-_/=:;|&,]$/;
const FLAT_MCP = { playwright: { command: "npx", args: ["@playwright/mcp@latest"] } };
const ELLIPSIS = /…$/;
const WHITESPACE_RUN = /\s+/g;
const GUARD_SPEC: HookSpec = {
  event: "PreToolUse",
  matcher: "Bash",
  handler: commandOf(GUARD_PATH),
};
const STOP_SPEC: HookSpec = { event: "Stop", handler: commandOf(PUSH_COMMAND) };

describe("setup tab", () => {
  test("S1 the Setup tab opens with the Instructions heading and one row per memory file with its tokens", async ($, on) => {
    worldOf(on, {
      memoryFiles: [
        { path: USER_CLAUDE, type: "User", tokens: 2100 },
        { path: PROJECT_CLAUDE, type: "Project", tokens: 600 },
        { path: "/h/u/.claude/projects/p/memory/MEMORY.md", type: "AutoMem", tokens: 400 },
      ],
    });

    const pane = await setupPane($);

    const rows = rowTexts((await blocks(pane)).Instructions);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toBe("CLAUDE.md ~/.claude 2.1k");
    expect(rows[1]).toBe("CLAUDE.md ~/proj 600");
    expect(rows[2]?.startsWith("MEMORY.md ")).toBe(true);
    expect(rows[2]?.endsWith(" 400")).toBe(true);
  });

  test("S3 allow, deny and ask rules show under their file, and a rule in two sources shows under both", async ($, on) => {
    worldOf(on, {
      settings: {
        user: { permissions: { allow: ["Bash(git status)"], deny: ["Read(./.env)"] } },
        local: { permissions: { allow: ["Bash(git status)"], ask: ["Bash(git push:*)"] } },
      },
    });

    const pane = await setupPane($);

    const permissions = (await blocks(pane)).Permissions;
    expect(groupItems(permissions, "user").sort()).toEqual([
      "allow Bash(git status)",
      "deny Read(./.env)",
    ]);
    expect(groupItems(permissions, "local").sort()).toEqual([
      "allow Bash(git status)",
      "ask Bash(git push:*)",
    ]);
  });

  test("S4 a plugin true in user and false in local is not shown, true only in user shows under the user file, a plugin folder shows as a plugin dir", async ($, on) => {
    worldOf(on, {
      settings: {
        user: {
          enabledPlugins: { "alpha@market": true, "beta@market": true },
          env: { CLAUDE_CODE_PLUGIN_DIRS: "/dev/demo-app" },
        },
        local: { enabledPlugins: { "beta@market": false } },
      },
    });

    const pane = await setupPane($);

    const plugins = (await blocks(pane)).Plugins;
    expect(groupItems(plugins, "user").sort()).toEqual(["✔ alpha@market", "✔ demo-app plugin dir"]);
    expect(rowTexts(plugins)).not.toContain(LOCAL_SETTINGS);
    expect(rowTexts(plugins).some((text) => text.includes("beta"))).toBe(false);
  });

  test("S6 the same bullet in two files shows once under Repeated rules with both paths, a short line, a heading, a code-fence line and a frontmatter line are not counted", async ($, on) => {
    worldOf(on, {
      memoryFiles: [
        { path: USER_CLAUDE, type: "User", tokens: 100 },
        { path: PROJECT_CLAUDE, type: "Project", tokens: 100 },
      ],
      files: {
        [USER_CLAUDE]: instructionFile(`- ${SHARED_RULE}`),
        [PROJECT_CLAUDE]: instructionFile(`1. ${SHARED_RULE_SHOUTED}`),
      },
    });

    const pane = await setupPane($);

    const repeated = (await blocks(pane))["Repeated rules"];
    const rows = rowTexts(repeated);
    expect(rows.filter((text) => text.toLowerCase().includes(SHARED_RULE_TEXT))).toHaveLength(1);
    expect(rows.find((text) => text.toLowerCase().includes(SHARED_RULE_TEXT))).toContain("2 files");
    expect(rows).toContain("~/.claude/CLAUDE.md");
    expect(rows).toContain("~/proj/CLAUDE.md");
    for (const ignored of [SHORT_RULE, HEADING_RULE, FENCED_RULE, FRONTMATTER_RULE])
      expect(rows.some((text) => text.toLowerCase().includes(ignored.toLowerCase()))).toBe(false);
  });

  test("S7 a skill last used 31 days ago shows 31 days, one never used shows never, a built-in skill never used shows never too, one used yesterday is not listed", async ($, on) => {
    worldOf(on, {
      skills: [
        { name: "council", source: "userSettings" },
        { name: "use-runpod", source: "userSettings" },
        { name: "commit", source: "userSettings" },
        { name: "update-config", source: "built-in" },
      ],
      files: {
        [SKILL_USAGE_FILE]: JSON.stringify({
          skillUsage: {
            council: { usageCount: 3, lastUsedAt: NOW - 31 * DAY_MS },
            commit: { usageCount: 9, lastUsedAt: NOW - DAY_MS },
          },
        }),
      },
    });

    const pane = await setupPane($);

    expect(rowTexts((await blocks(pane))["Skills not used in 30 days"])).toEqual([
      "council 31 days",
      "update-config never",
      "use-runpod never",
    ]);
  });

  test("S8 with no settings, no memory files and no ~/.claude.json each block shows its muted empty row and nothing is left out", async ($, on) => {
    worldOf(on, {});

    const pane = await setupPane($);

    const found = await blocks(pane);
    expect(rowTexts(found.Instructions)).toEqual([NO_INSTRUCTIONS]);
    expect(rowTexts(found.Hooks)).toEqual(["no hooks"]);
    expect(rowTexts(found.Permissions)).toEqual(["no permission rules"]);
    expect(rowTexts(found.Plugins)).toEqual(["no plugins"]);
    expect(rowTexts(found["Skills not used in 30 days"])).toEqual(["no skill use data"]);
    expect(found["Repeated rules"]).toBeUndefined();
  });

  test("S9 when every skill was used in the last 30 days the skills block says so", async ($, on) => {
    worldOf(on, {
      skills: [{ name: "commit", source: "userSettings" }],
      files: {
        [SKILL_USAGE_FILE]: JSON.stringify({
          skillUsage: { commit: { usageCount: 9, lastUsedAt: NOW - DAY_MS } },
        }),
      },
    });

    const pane = await setupPane($);

    expect(rowTexts((await blocks(pane))["Skills not used in 30 days"])).toEqual([
      "all skills used in 30 days",
    ]);
  });

  test("A1 a built-in skill last used 55 days ago shows as 55 days under Skills not used in 30 days", async ($, on) => {
    worldOf(on, {
      skills: [{ name: "code-review", source: "built-in" }],
      files: {
        [SKILL_USAGE_FILE]: JSON.stringify({
          skillUsage: { "code-review": { usageCount: 1, lastUsedAt: NOW - 55 * DAY_MS } },
        }),
      },
    });

    const pane = await setupPane($);

    expect(rowTexts((await blocks(pane))["Skills not used in 30 days"])).toEqual([
      "code-review 55 days",
    ]);
  });

  test("A3 when every skill, built-in included, was used in the last 30 days the skills block says so", async ($, on) => {
    worldOf(on, {
      skills: [
        { name: "commit", source: "userSettings" },
        { name: "code-review", source: "built-in" },
      ],
      files: {
        [SKILL_USAGE_FILE]: JSON.stringify({
          skillUsage: {
            commit: { usageCount: 9, lastUsedAt: NOW - DAY_MS },
            "code-review": { usageCount: 4, lastUsedAt: NOW - DAY_MS },
          },
        }),
      },
    });

    const pane = await setupPane($);

    expect(rowTexts((await blocks(pane))["Skills not used in 30 days"])).toEqual([
      "all skills used in 30 days",
    ]);
  });

  test("S10 at 60 columns a long instruction folder stays one truncated row", async ($, on) => {
    worldOf(on, {
      memoryFiles: [{ path: `${LONG_FOLDER}/CLAUDE.md`, type: "Project", tokens: 100 }],
    });

    const pane = await setupPane($);

    const drawn = await pane.drawn();
    const unwrapped = collect(drawn, "Text")
      .filter((text) => !String(text.props?.wrap).startsWith("truncate"))
      .map(textOf)
      .filter((text) => text.includes("deeply-nested"));
    const shown = linesOf(drawn).map((line) => line.text);
    expect(shown.some((text) => text.includes("CLAUDE.md"))).toBe(true);
    expect(unwrapped).toEqual([]);
    expect(shown.filter((text) => text.includes("\n"))).toEqual([]);
  });

  test("S12 at 60 columns a MEMORY.md folder path too long for its row is cut at a folder or name boundary, never inside a word", async ($, on) => {
    worldOf(on, {
      memoryFiles: [{ path: MEMORY_PATH, type: "AutoMem", tokens: MEMORY_TOKENS }],
    });

    const pane = await setupPane($);

    const row = rowWith(screenRows(await pane.drawn(), COLUMNS), "MEMORY.md");
    expect(row.trimEnd()).toMatch(MEMORY_CUT_ROW);
  });
});

describe("setup hook blocks", () => {
  test("S11 the Permissions block sits above the Hooks block", async ($, on) => {
    worldOf(on, {
      settings: {
        user: {
          hooks: hookEntry("Stop", undefined, PUSH_COMMAND),
          permissions: { allow: ["Bash(git status)"] },
        },
      },
    });

    const pane = await setupPane($);

    const order = headingOrder(linesOf(await pane.drawn()), HEADINGS);
    expect(order.filter((title) => title === "Hooks" || title === "Permissions")).toEqual([
      "Permissions",
      "Hooks",
    ]);
  });

  test("G6 at 60 columns the event PermissionRequest shows whole on its event row", async ($, on) => {
    worldOf(on, {
      settings: { user: { hooks: hookEntry(LONG_EVENT, "ExitPlanMode", "plannotator") } },
    });

    const pane = await setupPane($);

    const screen = screenRows(await pane.drawn(), COLUMNS);
    expect(screen.some((row) => row.includes("PermissionR…"))).toBe(false);
    expect(screen.some((row) => /^\s*PermissionRequest\s+1 hook$/.test(row.trimEnd()))).toBe(true);
  });

  test("H1 hooks of one event from --settings and the user file show in one event block with a bold event, a muted count at the right edge and no per-source count row", async ($, on) => {
    worldOf(on, {
      settings: {
        flag: {
          hooks: hooksFile([
            { event: "PreToolUse", matcher: "Bash", handler: commandOf(GUARD_PATH) },
          ]),
        },
        user: {
          hooks: hooksFile([
            { event: "PreToolUse", matcher: "Edit", handler: commandOf("/a/b/lint.js") },
          ]),
        },
      },
    });

    const pane = await setupPane($);

    const ink = paneInk();
    const hooks = (await blocks(pane)).Hooks;
    const event = eventRow(hooks, "PreToolUse");
    expect(event.text).toBe("PreToolUse 2 hooks");
    expect(isHeavy(event.parts[0]?.props) && event.parts[0]?.props?.color).toBe(ink.text);
    expect(event.parts[1]?.props?.color).toBe(ink.muted);
    expect(screenRows(await pane.drawn(), COLUMNS).some((row) => row.endsWith("2 hooks"))).toBe(
      true,
    );
    expect(rowTexts(hooks).filter((text) => SOURCE_COUNT.test(text))).toEqual([]);
  });

  test("H2 a hook is one row with its name as a button in text colour, its matcher in tool colour and its source muted at the right edge", async ($, on) => {
    worldOf(on, {
      settings: {
        flag: {
          hooks: hooksFile([
            { event: "PreToolUse", matcher: "Bash", handler: commandOf(GUARD_PATH) },
          ]),
        },
      },
    });

    const pane = await setupPane($);

    const ink = paneInk();
    const hooks = (await blocks(pane)).Hooks;
    const row = hookRow(hooks, GUARD_NAME);
    const name = nameButtonOf(row, GUARD_NAME);
    expect(row.indent).toBe(eventRow(hooks, "PreToolUse").indent + EVENT_INDENT);
    expect(collect(name ?? { type: "none" }, "Text")[0]?.props?.color).toBe(ink.text);
    expect(partColour(row, "Bash")).toBe(ink.tool);
    expect(partColour(row, "session")).toBe(ink.muted);
    expect(row.text).toBe(`${GUARD_NAME} Bash session`);
    expect(screenRows(await pane.drawn(), COLUMNS).some((line) => line.endsWith("session"))).toBe(
      true,
    );
  });

  test("H3 every kind of hook command shows a short readable name and never raw shell", async ($, on) => {
    worldOf(on, {
      settings: {
        user: {
          hooks: hooksFile(
            NAME_CASES.map(({ id, command }) => ({
              event: `Case${id}`,
              handler: commandOf(command),
            })),
          ),
        },
      },
    });

    const pane = await setupPane($);

    const shown = namesByEvent((await blocks(pane)).Hooks);
    expect(shown).toEqual(
      Object.fromEntries(NAME_CASES.map(({ id, name }) => [`Case${id}`, name])),
    );
  });

  for (const columns of [COLUMNS, WIDE_COLUMNS]) {
    test(`H4 at ${columns} columns the matchers of one event start in one column set by that event's widest name, an empty matcher leaves it blank and an event without matchers has no matcher column`, async ($, on) => {
      worldOf(on, {
        settings: {
          flag: {
            hooks: hooksFile([
              { event: "PreToolUse", matcher: "Bash", handler: commandOf(GUARD_PATH) },
              {
                event: "PreToolUse",
                matcher: "PushNotification",
                handler: commandOf("/a/b/notify.js"),
              },
              { event: "PreToolUse", handler: commandOf("/a/b/lint.js") },
              { event: "PostToolUse", matcher: "Edit", handler: commandOf(RECORD_PATH) },
              { event: "Stop", handler: commandOf(PUSH_PATH) },
              { event: "Stop", handler: commandOf(CRON_GUARD) },
            ]),
          },
        },
      });

      const pane = await setupPane($, columns);

      const screen = screenRows(await pane.drawn(), columns);
      const pre =
        eventColumn(screen, "PreToolUse") + EVENT_INDENT + "notify.js".length + COLUMN_GAP;
      const post =
        eventColumn(screen, "PostToolUse") + EVENT_INDENT + RECORD_NAME.length + COLUMN_GAP;
      expect(
        matcherColumns(screen, [
          [GUARD_NAME, "Bash"],
          ["notify.js", "PushNotification"],
        ]),
      ).toEqual([pre, pre]);
      expect(matcherColumns(screen, [[RECORD_NAME, "Edit"]])).toEqual([post]);
      const lint = rowWith(screen, "lint.js");
      expect(lint.includes("Bash") || lint.includes("PushNotification")).toBe(false);
      expect(lint.indexOf("lint.js")).toBe(eventColumn(screen, "PreToolUse") + EVENT_INDENT);
      expect(rowWith(screen, PUSH_COMMAND).trimEnd().endsWith("session")).toBe(true);
      expect(rowWith(screen, CRON_GUARD_NAME).trimEnd().endsWith("session")).toBe(true);
    });
  }

  test("H5 at 60 columns a 25-cell hook name shows whole, its long matcher is cut with an ellipsis and its source stays whole, all on one row per hook", async ($, on) => {
    worldOf(on, {
      settings: {
        user: {
          hooks: hooksFile([
            {
              event: "PreToolUse",
              matcher: "Write|Edit|MultiEdit|NotebookEdit",
              handler: commandOf(REMINDER_PATH),
            },
            { event: "PreToolUse", matcher: "Bash", handler: commandOf(GUARD_PATH) },
          ]),
        },
      },
    });

    const pane = await setupPane($);

    const screen = screenRows(await pane.drawn(), COLUMNS);
    expect(rowWith(screen, REMINDER_NAME).trim()).toMatch(
      /^settings-cleanup-reminder\s+Write\|Edit\|MultiEdit \+1\s+user$/,
    );
    const start = screen.findIndex((row) => /^\s*PreToolUse\s+2 hooks$/.test(row.trimEnd()));
    expect(start, "the PreToolUse event row").not.toBe(-1);
    const block = screen.slice(start + 1);
    expect(block.findIndex((row) => row.trim() === "")).toBe(2);
  });

  test("H5b at 60 columns a 33-cell hook name in an event with a matcher shows whole, because the row has the cells for it", async ($, on) => {
    worldOf(on, {
      settings: {
        flag: {
          hooks: hooksFile([
            { event: "PreToolUse", matcher: "CronCreate", handler: commandOf(MID_PATH) },
          ]),
        },
      },
    });

    const pane = await setupPane($);

    const row = rowWith(screenRows(await pane.drawn(), COLUMNS), MID_NAME);
    expect(row.trim()).toMatch(/^cron-create-guard-and-inbox-drain\s+CronCreate\s+session$/);
  });

  test("H5c at 60 columns a 50-cell hook name is cut at the end with an ellipsis that fills every free cell, so only the column gap is left before the matcher", async ($, on) => {
    worldOf(on, {
      settings: {
        flag: {
          hooks: hooksFile([
            { event: "PreToolUse", matcher: "CronCreate", handler: commandOf(LONG_PATH) },
          ]),
        },
      },
    });

    const pane = await setupPane($);

    const row = rowWith(screenRows(await pane.drawn(), COLUMNS), "cron-create-guard-");
    const shown = row.trimEnd();
    const parts = /^(\s*)(\S*…)(\s+)CronCreate(\s+)session$/.exec(shown);
    expect(parts, `a cut name, matcher and source in "${shown}"`).not.toBeNull();
    const freeCells =
      COLUMNS - (parts?.[1]?.length ?? 0) - COLUMN_GAP * 2 - "CronCreate".length - "session".length;
    expect(shown.length).toBe(COLUMNS);
    expect(parts?.[2]?.length).toBe(freeCells);
    expect(parts?.[3]?.length).toBe(COLUMN_GAP);
    expect(row.includes(LONG_NAME)).toBe(false);
  });

  test("H5d a Stop event with two tmux hooks shows two different names, the script and the event each was made for", async ($, on) => {
    worldOf(on, {
      settings: {
        flag: {
          hooks: hooksFile([
            { event: "Stop", handler: commandOf(tmuxHookCommand("stop")) },
            { event: "Stop", handler: commandOf(tmuxHookCommand("feed")) },
            { event: "Stop", handler: commandOf(CRON_GUARD) },
          ]),
        },
      },
    });

    const pane = await setupPane($);

    expect(buttonLabels((await blocks(pane)).Hooks)).toEqual([
      "tmux-hook stop",
      "tmux-hook feed",
      CRON_GUARD_NAME,
    ]);
  });

  test("H6 events list in alphabetical order and, inside one event, hooks list as managed, --settings, local, project, user, then plugins", async ($, on) => {
    worldOf(on, {
      settings: {
        policy: { hooks: hooksFile([{ event: "Stop", handler: commandOf("/x/managed-hook") }]) },
        flag: { hooks: hooksFile([{ event: "Stop", handler: commandOf("/x/flag-hook") }]) },
        local: { hooks: hooksFile([{ event: "Stop", handler: commandOf("/x/local-hook") }]) },
        project: {
          hooks: hooksFile([
            { event: "Stop", handler: commandOf("/x/project-hook") },
            { event: "PreToolUse", matcher: "Bash", handler: commandOf(GUARD_PATH) },
          ]),
        },
        user: {
          hooks: hooksFile([
            { event: "Stop", handler: commandOf("/x/user-hook") },
            { event: "Notification", handler: commandOf("/x/notify-hook") },
          ]),
          enabledPlugins: { "gate@market": true },
        },
      },
      files: gatePlugin(hooksFile([{ event: "Stop", handler: commandOf("/x/plugin-hook") }])),
    });

    const pane = await setupPane($);

    const rows = ((await blocks(pane)).Hooks?.rows ?? []).filter((row) => row.text !== CUE);
    const events = rows.filter((row) => !hasButton(row)).map((row) => row.text.split(" ")[0]);
    expect(events).toEqual(["Notification", "PreToolUse", "Stop"]);
    const stop = rows.slice(rows.findIndex((row) => row.text.startsWith("Stop ")) + 1);
    expect(stop.map((row) => row.text)).toEqual([
      "managed-hook managed",
      "flag-hook session",
      "local-hook local",
      "project-hook project",
      "user-hook user",
      "plugin-hook gate plugin",
    ]);
  });

  test("H7 pressing a hook name opens its page with back, the name, event, matcher, source, type, timeout and then the command", async ($, on) => {
    const state = stateWorldOf(on);
    worldOf(on, {
      settings: {
        flag: {
          hooks: hooksFile([
            {
              event: "PreToolUse",
              matcher: "Bash",
              handler: { type: "command", command: "node /a/b/guard.js --x", timeout: 5 },
            },
          ]),
        },
      },
    });
    const pane = await setupPane($);
    state.writes.length = 0;

    await pressName(pane, GUARD_NAME);

    const rows = detailRows(screenRows(await pane.drawn(), COLUMNS));
    expect(rows).toEqual([
      BACK_ROW,
      "",
      GUARD_NAME,
      "event PreToolUse",
      "matcher Bash",
      "source session",
      "type command",
      "timeout 5s",
      "",
      "Command",
      "node /a/b/guard.js --x",
    ]);
    const screen = screenRows(await pane.drawn(), COLUMNS);
    const values = [
      ["event", "PreToolUse"],
      ["matcher", "Bash"],
      ["source", "session"],
      ["type", "command"],
      ["timeout", "5s"],
    ].map(([label, value]) => rowWith(screen, `${label} `).indexOf(value ?? ""));
    expect(new Set(values).size).toBe(1);
    const opened = lastWritten(state.writes, HOOK_KEY) as { id?: string } | null;
    expect(/^flag#\d+$/.test(opened?.id ?? "")).toBe(true);
    expect(lastWritten(state.writes, BODY_OFFSET_KEY)).toBe(0);
  });

  test("H8 at 60 columns the page of a 3000-character, 22-line command shows every character, cuts nothing and hangs each wrapped row 4 cells in from its own line", async ($, on) => {
    const command = spoolCommand();
    worldOf(on, {
      settings: { flag: { hooks: hooksFile([{ event: "Stop", handler: commandOf(command) }]) } },
    });
    const pane = await setupPane($, COLUMNS, TALL_PANE_ROWS);

    await pressOnlyHook(pane);

    const screen = screenRows(await pane.drawn(), COLUMNS);
    const heading = screen.findIndex((row) => row.replace(/─+/g, "").trim() === "Command");
    expect(heading, "the Command heading").not.toBe(-1);
    const body = screen.slice(heading + 1);
    expect(body.join("").replace(/\s+/g, "")).toBe(command.replace(/\s+/g, ""));
    expect(body.filter((row) => row.trimEnd().endsWith("…"))).toEqual([]);
    const flush = body.find((row) => row.includes(stepName(0)))?.indexOf(stepName(0)) ?? -1;
    const starts = STEP_LEADS.map((_, step) => {
      const first = body.findIndex((row) => row.includes(stepName(step)));
      const column = body[first]?.indexOf(stepName(step)) ?? -1;
      const next = body[first + 1] ?? "";
      return [column - flush, next.length - next.trimStart().length - flush];
    });
    expect(starts).toEqual([
      [0, 4],
      [2, 6],
      [4, 8],
      [2, 6],
    ]);
  });

  test("H9 pressing back on a hook page shows the list again at the scroll place it had", async ($, on) => {
    const state = stateWorldOf(on);
    worldOf(on, {
      settings: {
        flag: {
          hooks: hooksFile([
            { event: "PreToolUse", matcher: "Bash", handler: commandOf(GUARD_PATH) },
          ]),
        },
      },
    });
    const pane = await setupPane($);
    state.scrollTo(SCROLLED_ROWS);
    await settle(pane);
    await pressName(pane, GUARD_NAME);

    await pressBack(pane);

    expect(lastWritten(state.writes, BODY_OFFSET_KEY)).toBe(SCROLLED_ROWS);
    expect(lastWritten(state.writes, HOOK_KEY)).toBe(null);
    expect(await hasBack(pane)).toBe(false);
    expect(nameButtonOf(hookRow((await blocks(pane)).Hooks, GUARD_NAME), GUARD_NAME)).toBeDefined();
  });

  test("H11 a hook with a timeout, async and an if shows 5s, command · async, the if row and its matcher in tool colour", async ($, on) => {
    worldOf(on, {
      settings: {
        flag: {
          hooks: hooksFile([
            {
              event: "PreToolUse",
              matcher: "Bash",
              handler: {
                type: "command",
                command: GUARD_PATH,
                timeout: 5,
                async: true,
                if: PUSH_RULE,
              },
            },
          ]),
        },
      },
    });
    const pane = await setupPane($);

    await pressName(pane, GUARD_NAME);

    const drawn = await pane.drawn();
    const ink = paneInk();
    const rows = detailRows(screenRows(drawn, COLUMNS));
    expect(rows).toContain("matcher Bash");
    expect(rows).toContain("type command · async");
    expect(rows).toContain("timeout 5s");
    expect(rows).toContain(`if ${PUSH_RULE}`);
    expect(coloursOfText(drawn, "matcher Bash").slice(1)).toEqual([ink.tool]);
    expect(coloursOfText(drawn, "5s")).toEqual([ink.text]);
    expect(coloursOfText(drawn, "async")).toEqual([ink.muted]);
  });

  test("H11b a hook with no matcher, no timeout and no if shows any and default muted, its layer as source with its settings file, plain command and no if row", async ($, on) => {
    worldOf(on, {
      settings: { user: { hooks: hooksFile([{ event: "Stop", handler: commandOf(GUARD_PATH) }]) } },
    });
    const pane = await setupPane($);

    await pressName(pane, GUARD_NAME);

    const drawn = await pane.drawn();
    const rows = detailRows(screenRows(drawn, COLUMNS));
    expect(rows).toContain("matcher any");
    expect(rows).toContain("timeout default");
    expect(rows).toContain("source user");
    expect(rows).toContain(`file ${USER_SETTINGS}`);
    expect(rows).toContain("type command");
    expect(rows.filter((row) => row.startsWith("if "))).toEqual([]);
    expect(coloursOfText(drawn, "matcher any")).toEqual([paneInk().muted]);
    expect(coloursOfText(drawn, "timeout default")).toEqual([paneInk().muted]);
  });

  test("H12 a plugin hook shows its name with the source gate plugin, and its page names the plugin and the hooks.json path", async ($, on) => {
    worldOf(on, {
      settings: { user: { enabledPlugins: { "gate@market": true } } },
      files: gatePlugin(hookEntry("PermissionRequest", undefined, "plannotator")),
    });
    const pane = await setupPane($);

    expect(hookRow((await blocks(pane)).Hooks, "plannotator").text).toBe("plannotator gate plugin");
    await pressName(pane, "plannotator");

    const rows = detailRows(screenRows(await pane.drawn(), COLUMNS));
    expect(rows).toContain("source gate plugin");
    expect(rows).toContain("file /cache/gate/hooks/hooks.json");
  });

  test("H12b an http hook shows its host, an mcp_tool hook its tool and a prompt hook the word prompt as the name", async ($, on) => {
    worldOf(on, { settings: { user: { hooks: hooksFile(REMOTE_HOOKS) } } });

    const pane = await setupPane($);

    expect(namesByEvent((await blocks(pane)).Hooks)).toEqual({
      Http: "hooks.example.com",
      Mcp: "scan",
      Prompt: "prompt",
    });
  });

  test("H12c the page of an http, an mcp_tool and a prompt hook has the heading URL, Tool or Prompt over the full text", async ($, on) => {
    worldOf(on, { settings: { user: { hooks: hooksFile(REMOTE_HOOKS) } } });
    const pane = await setupPane($);
    const shown: Record<string, string[]> = {};

    for (const name of ["hooks.example.com", "scan", "prompt"]) {
      await pressName(pane, name);
      shown[name] = bodyAfterFieldRows(detailRows(screenRows(await pane.drawn(), COLUMNS)));
      await pressBack(pane);
    }

    expect(shown).toEqual({
      "hooks.example.com": ["URL", "https://hooks.example.com/scan"],
      scan: ["Tool", "sec scan", ...MCP_INPUT_LINES],
      prompt: ["Prompt", "Is this change safe?"],
    });
  });

  test("H13 a plugin whose hooks.json lists only modules adds no hook, and with no hooks the block says no hooks", async ($, on) => {
    worldOf(on, {
      settings: { user: { enabledPlugins: { "modular@market": true } } },
      files: {
        [PLUGIN_REGISTRY_FILE]: JSON.stringify({
          plugins: { "modular@market": [{ installPath: "/cache/modular" }] },
        }),
        "/cache/modular/hooks/hooks.json": JSON.stringify({ modules: ["./hooks/index.ts"] }),
      },
    });

    const pane = await setupPane($);

    const hooks = (await blocks(pane)).Hooks;
    expect(rowTexts(hooks)).toEqual(["no hooks"]);
  });

  test("H13b settings whose hooks value is garbage add no hook and no error", async ($, on) => {
    worldOf(on, {
      settings: {
        user: {
          hooks: {
            Stop: "oops",
            Notification: 5,
            PreToolUse: [{ matcher: "Bash", hooks: "nope" }],
            PostToolUse: [{ hooks: [{ type: "command" }] }],
          },
        },
      },
    });

    const pane = await setupPane($);

    expect(rowTexts((await blocks(pane)).Hooks)).toEqual(["no hooks"]);
  });

  test("H14 a hook page left open is still open after a visit to another tab", async ($, on) => {
    worldOf(on, {
      settings: {
        flag: {
          hooks: hooksFile([
            { event: "PreToolUse", matcher: "Bash", handler: commandOf(GUARD_PATH) },
          ]),
        },
      },
    });
    const pane = await setupPane($, WIDE_COLUMNS);
    await pressName(pane, GUARD_NAME);

    await visitTab(pane, "Context", SETUP);

    expect(await hasBack(pane)).toBe(true);
    expect(detailRows(screenRows(await pane.drawn(), WIDE_COLUMNS))).toContain("event PreToolUse");
  });

  test("H15 when the opened hook is gone from the settings by the time the user returns, the list shows and no empty page", async ($, on) => {
    const settings: WorldOptions["settings"] = {
      flag: {
        hooks: hooksFile([
          { event: "PreToolUse", matcher: "Bash", handler: commandOf(GUARD_PATH) },
        ]),
      },
    };
    worldOf(on, { settings });
    const pane = await setupPane($, WIDE_COLUMNS);
    await pressName(pane, GUARD_NAME);
    settings.flag = {};

    await visitTab(pane, "Context", SETUP);

    expect(await hasBack(pane)).toBe(false);
    expect(rowTexts((await blocks(pane)).Hooks)).toEqual(["no hooks"]);
  });

  test("H16 a hook that the user and the project settings both list shows once under its event, and the event counts one hook", async ($, on) => {
    const guard = { event: "PreToolUse", matcher: "Bash", handler: commandOf(GUARD_PATH) };
    worldOf(on, {
      settings: {
        user: { hooks: hooksFile([guard]) },
        project: { hooks: hooksFile([guard]) },
      },
    });

    const pane = await setupPane($);

    const hooks = (await blocks(pane)).Hooks;
    expect(eventRow(hooks, "PreToolUse").text).toBe("PreToolUse 1 hook");
    expect(buttonLabels(hooks)).toEqual([GUARD_NAME]);
  });
});

describe("setup hook row matcher and wrap r2", () => {
  test("V2-F1 at 60 columns a matcher too long for its cell shows its whole alternatives and a muted ' +N' for the rest", async ($, on) => {
    worldOf(on, {
      settings: {
        user: {
          hooks: hooksFile([
            { event: "PreToolUse", matcher: EDIT_MATCHER, handler: commandOf(REMINDER_PATH) },
          ]),
        },
      },
    });

    const pane = await setupPane($);

    const screen = screenRows(await pane.drawn(), COLUMNS);
    expect(rowWith(screen, REMINDER_NAME).trim()).toMatch(
      /^settings-cleanup-reminder\s+Write\|Edit\|MultiEdit \+1\s+user$/,
    );
    const row = hookRow((await blocks(pane)).Hooks, REMINDER_NAME);
    expect(colourOfPiece(row, "+1")).toBe(paneInk().muted);
  });

  test("V2-F1b at 60 columns a matcher that fits its cell shows whole with no ' +N'", async ($, on) => {
    worldOf(on, {
      settings: {
        user: {
          hooks: hooksFile([
            { event: "PreToolUse", matcher: "Write|Edit", handler: commandOf(REMINDER_PATH) },
          ]),
        },
      },
    });

    const pane = await setupPane($);

    expect(rowWith(screenRows(await pane.drawn(), COLUMNS), REMINDER_NAME).trim()).toMatch(
      /^settings-cleanup-reminder\s+Write\|Edit\s+user$/,
    );
  });

  test("V2-F1c at 60 columns the page of a hook with a long matcher shows the full matcher", async ($, on) => {
    worldOf(on, {
      settings: {
        user: {
          hooks: hooksFile([
            { event: "PreToolUse", matcher: EDIT_MATCHER, handler: commandOf(REMINDER_PATH) },
          ]),
        },
      },
    });
    const pane = await setupPane($);

    await pressName(pane, REMINDER_NAME);

    expect(detailRows(screenRows(await pane.drawn(), COLUMNS))).toContain(
      `matcher ${EDIT_MATCHER}`,
    );
  });

  test("V2-F3 at 60 columns the wrapped first line of a command hangs its next row 4 cells in while a nested 2-space line stays 2 cells in", async ($, on) => {
    const command = [LONG_FIRST_LINE, NESTED_ONE, NESTED_TWO].join("\n");
    worldOf(on, {
      settings: { flag: { hooks: hooksFile([{ event: "Stop", handler: commandOf(command) }]) } },
    });
    const pane = await setupPane($, COLUMNS, TALL_PANE_ROWS);

    await pressOnlyHook(pane);

    const screen = screenRows(await pane.drawn(), COLUMNS);
    const heading = screen.findIndex((row) => row.replace(/─+/g, "").trim() === "Command");
    expect(heading, "the Command heading").not.toBe(-1);
    const body = screen.slice(heading + 1);
    expect(body.join("").replace(/\s+/g, "")).toBe(command.replace(/\s+/g, ""));
    const first = body.findIndex((row) => row.includes("tmux_probe"));
    const cells = [
      body[first],
      body[first + 1],
      rowWith(body, "nested_one"),
      rowWith(body, "nested_two"),
    ].map(leadingCellsOf);
    expect(cells.map((column) => column - (cells[0] ?? 0))).toEqual([0, 4, 2, 2]);
  });
});

describe("setup permissions and sources", () => {
  test("G7 a deny rule's kind word is in failed colour and an allow rule's is muted, the rule itself in text colour", async ($, on) => {
    worldOf(on, { settings: { user: { permissions: ALL_KINDS } } });

    const pane = await setupPane($);

    const ink = paneInk();
    const rows = groupRows((await blocks(pane)).Permissions, "user");
    expect(rowColours(rows, "deny")).toEqual([ink.failed, ink.text]);
    expect(rowColours(rows, "allow")).toEqual([ink.muted, ink.text]);
  });

  test("G8 an ask rule's kind word is in alert colour", async ($, on) => {
    worldOf(on, { settings: { user: { permissions: ALL_KINDS } } });

    const pane = await setupPane($);

    const rows = groupRows((await blocks(pane)).Permissions, "user");
    expect(rowColours(rows, "ask")).toEqual([paneInk().alert, paneInk().text]);
  });

  test("G9 a permissions source shows its rule count and a plugins source its plugin count, source names bold text and counts muted", async ($, on) => {
    worldOf(on, {
      settings: {
        user: {
          permissions: ALL_KINDS,
          enabledPlugins: { "alpha@market": true },
          env: { CLAUDE_CODE_PLUGIN_DIRS: "/dev/demo-app" },
        },
      },
    });

    const pane = await setupPane($);

    const found = await blocks(pane);
    const ink = paneInk();
    const rules = sourceRow(found.Permissions, "user");
    const plugins = sourceRow(found.Plugins, "user");
    expect(rules.text).toBe("user 3 rules");
    expect(plugins.text).toBe("user 2 plugins");
    for (const source of [rules, plugins]) {
      expect(isHeavy(source.parts[0]?.props) && source.parts[0]?.props?.color).toBe(ink.text);
      expect(source.parts[1]?.props?.color).toBe(ink.muted);
    }
  });

  test("G10 an event with one hook reads 1 hook and a source with one rule or one plugin reads 1 rule, 1 plugin", async ($, on) => {
    worldOf(on, {
      settings: {
        user: {
          hooks: hookEntry("Stop", undefined, PUSH_COMMAND),
          permissions: { allow: ["Bash(git status)"] },
          enabledPlugins: { "alpha@market": true },
        },
      },
    });

    const pane = await setupPane($);

    const found = await blocks(pane);
    expect(eventRow(found.Hooks, "Stop").text).toBe("Stop 1 hook");
    expect(sourceRow(found.Permissions, "user").text).toBe("user 1 rule");
    expect(sourceRow(found.Plugins, "user").text).toBe("user 1 plugin");
  });
});

describe("setup tab T1 finish", () => {
  test("A3 the Hooks section with one hook opens with the cue in muted colour above the first event row", async ($, on) => {
    worldOf(on, {
      settings: {
        flag: {
          hooks: hooksFile([
            { event: "PreToolUse", matcher: "Bash", handler: commandOf(GUARD_PATH) },
          ]),
        },
      },
    });
    const pane = await setupPane($);

    const hooks = (await blocks(pane)).Hooks;
    expect(rowTexts(hooks).slice(0, 2)).toEqual([CUE, "PreToolUse 1 hook"]);
    expect(coloursOfText(await pane.drawn(), CUE)).toEqual([paneInk().muted]);
  });

  test("A4 the Hooks section with no hook shows only its empty row and no cue", async ($, on) => {
    worldOf(on, {});
    const pane = await setupPane($);

    expect(rowTexts((await blocks(pane)).Hooks)).toEqual(["no hooks"]);
  });

  test("A5 the Instructions heading reads its file count after the title", async ($, on) => {
    worldOf(on, {
      memoryFiles: [
        { path: USER_CLAUDE, type: "User", tokens: 2100 },
        { path: PROJECT_CLAUDE, type: "Project", tokens: 600 },
        { path: MEMORY_PATH, type: "AutoMem", tokens: MEMORY_TOKENS },
      ],
    });
    const pane = await setupPane($);

    expect(await headingText(pane, "Instructions")).toBe("Instructions 3 files");
  });

  test("A6 the Permissions heading counts the allow, deny and ask rows shown under it", async ($, on) => {
    worldOf(on, {
      settings: {
        user: { permissions: { allow: ["Bash(git status)"], deny: ["Read(./.env)"] } },
        local: { permissions: { allow: ["Bash(git status)"], ask: ["Bash(git push:*)"] } },
      },
    });
    const pane = await setupPane($);

    expect(await headingText(pane, "Permissions")).toBe("Permissions 2 allow · 1 deny · 1 ask");
    const kinds = ruleRowTexts(await pane.drawn());
    expect(kinds.filter((text) => text.startsWith("allow "))).toHaveLength(2);
    expect(kinds.filter((text) => text.startsWith("deny "))).toHaveLength(1);
    expect(kinds.filter((text) => text.startsWith("ask "))).toHaveLength(1);
  });

  test("A7 the Permissions heading with one allow rule shows only that count", async ($, on) => {
    worldOf(on, { settings: { user: { permissions: { allow: [PUSH_RULE] } } } });
    const pane = await setupPane($);

    expect(await headingText(pane, "Permissions")).toBe("Permissions 1 allow");
  });

  test("A8 the Hooks heading counts a hook that two files list once", async ($, on) => {
    worldOf(on, {
      settings: {
        user: { hooks: hooksFile([GUARD_SPEC, STOP_SPEC]) },
        project: { hooks: hooksFile([GUARD_SPEC]) },
      },
    });
    const pane = await setupPane($);

    expect(await headingText(pane, "Hooks")).toBe("Hooks 2 hooks");
  });

  test("A9 the Plugins heading counts its plugins", async ($, on) => {
    worldOf(on, {
      settings: { user: { enabledPlugins: { [PLUGIN_ID]: true, "lint@market": true } } },
    });
    const pane = await setupPane($);

    expect(await headingText(pane, "Plugins")).toBe("Plugins 2 plugins");
  });

  test("A10 pressing a permission rule opens a page with back, the whole rule, its behaviour, its source and its settings file", async ($, on) => {
    worldOf(on, { settings: { user: { permissions: { allow: [PUSH_RULE] } } } });
    const pane = await setupPane($);

    await pressRule(pane, PUSH_RULE);

    const rows = detailRows(screenRows(await pane.drawn(), COLUMNS));
    expect(rows[0]).toBe(BACK_ROW);
    expect(rows.some((row) => row.includes(PUSH_RULE))).toBe(true);
    expect(rows.some((row) => /\ballow\b/.test(row))).toBe(true);
    expect(rows.some((row) => /\buser\b/.test(row))).toBe(true);
    expect(rows.some((row) => row.includes(USER_SETTINGS))).toBe(true);
  });

  test("A11 a permission rule longer than its list row shows every character on its page at 60 columns", async ($, on) => {
    worldOf(on, { settings: { user: { permissions: { allow: [LONG_RULE] } } } });
    const pane = await setupPane($);

    await pressRule(pane, LONG_RULE);

    const rows = detailRows(screenRows(await pane.drawn(), COLUMNS));
    expect(rows.join("").replace(WHITESPACE_RUN, "")).toContain(
      LONG_RULE.replace(WHITESPACE_RUN, ""),
    );
    expect(rows.filter((row) => row.endsWith("…"))).toEqual([]);
  });

  test("A12 pressing back on a permission page shows the list at the scroll place it had", async ($, on) => {
    const state = stateWorldOf(on);
    worldOf(on, { settings: { user: { permissions: { allow: [PUSH_RULE] } } } });
    const pane = await setupPane($);
    state.scrollTo(SCROLLED_ROWS);
    await settle(pane);
    await pressRule(pane, PUSH_RULE);

    await pressBack(pane);

    expect(lastWritten(state.writes, BODY_OFFSET_KEY)).toBe(SCROLLED_ROWS);
    expect(await hasBack(pane)).toBe(false);
  });

  test("A14 pressing a plugin row opens a page with back, the plugin name, its install path and the hooks it adds with their count and names", async ($, on) => {
    worldOf(on, {
      settings: { user: { enabledPlugins: { [PLUGIN_ID]: true } } },
      files: gatePlugin(hooksFile([GUARD_SPEC, STOP_SPEC])),
    });
    const pane = await setupPane($);

    await pressName(pane, PLUGIN_ID);

    const rows = detailRows(screenRows(await pane.drawn(), COLUMNS));
    expect(rows[0]).toBe(BACK_ROW);
    expect(rows).toContain(PLUGIN_NAME);
    expect(rows.some((row) => row.includes(PLUGIN_PATH))).toBe(true);
    expect(rows.some((row) => /\b2 hooks\b/.test(row))).toBe(true);
    expect(rows.some((row) => row.includes(GUARD_NAME))).toBe(true);
    expect(rows.some((row) => row.includes(PUSH_COMMAND))).toBe(true);
  });

  test("A15 pressing a plugin row shows the skills the plugin adds with their count and names", async ($, on) => {
    worldOf(on, {
      settings: { user: { enabledPlugins: { [PLUGIN_ID]: true } } },
      files: gatePlugin({}),
      skills: PLUGIN_SKILLS.map((name) => ({ name, source: "plugin", pluginName: PLUGIN_NAME })),
    });
    const pane = await setupPane($);

    await pressName(pane, PLUGIN_ID);

    const rows = detailRows(screenRows(await pane.drawn(), COLUMNS));
    expect(rows.some((row) => /\b2 skills\b/.test(row))).toBe(true);
    for (const name of PLUGIN_SKILLS) {
      expect(rows.some((row) => row.includes(name))).toBe(true);
    }
  });

  test("A16 a plugin whose hooks file cannot be read still opens its page, which says it adds no hooks", async ($, on) => {
    worldOf(on, {
      settings: { user: { enabledPlugins: { [PLUGIN_ID]: true } } },
      files: {
        [PLUGIN_REGISTRY_FILE]: JSON.stringify({
          plugins: { [PLUGIN_ID]: [{ installPath: PLUGIN_PATH }] },
        }),
      },
    });
    const pane = await setupPane($);

    await pressName(pane, PLUGIN_ID);

    const rows = detailRows(screenRows(await pane.drawn(), COLUMNS));
    expect(rows[0]).toBe(BACK_ROW);
    expect(rows).toContain(PLUGIN_NAME);
    expect(rows).toContain("hooks none");
  });

  test("A17 a plugin whose registry entry records a version shows that version on its page", async ($, on) => {
    worldOf(on, {
      settings: { user: { enabledPlugins: { [PLUGIN_ID]: true } } },
      files: gatePlugin({}, { version: PLUGIN_VERSION }),
    });
    const pane = await setupPane($);

    await pressName(pane, PLUGIN_ID);

    const rows = detailRows(screenRows(await pane.drawn(), COLUMNS));
    expect(rows).toContain(`version ${PLUGIN_VERSION}`);
  });

  test("A18 a plugin whose .mcp.json wraps its servers in mcpServers lists those server names on its page", async ($, on) => {
    worldOf(on, {
      settings: { user: { enabledPlugins: { [PLUGIN_ID]: true } } },
      files: { ...gatePlugin({}), [PLUGIN_MCP_PATH]: JSON.stringify(WRAPPED_MCP) },
    });
    const pane = await setupPane($);

    await pressName(pane, PLUGIN_ID);

    const rows = detailRows(screenRows(await pane.drawn(), COLUMNS));
    expect(rows).toContain("MCP 2 servers · sec-scan, docs");
  });

  test("A19 a plugin whose .mcp.json lists its servers at the top level lists those server names on its page", async ($, on) => {
    worldOf(on, {
      settings: { user: { enabledPlugins: { [PLUGIN_ID]: true } } },
      files: { ...gatePlugin({}), [PLUGIN_MCP_PATH]: JSON.stringify(FLAT_MCP) },
    });
    const pane = await setupPane($);

    await pressName(pane, PLUGIN_ID);

    const rows = detailRows(screenRows(await pane.drawn(), COLUMNS));
    expect(rows).toContain("MCP 1 server · playwright");
  });

  test("A20 a plugin whose plugin.json lists its hook files and MCP config shows those hooks and servers on its page", async ($, on) => {
    worldOf(on, {
      settings: { user: { enabledPlugins: { [PLUGIN_ID]: true } } },
      files: manifestPlugin(),
    });
    const pane = await setupPane($);

    await pressName(pane, PLUGIN_ID);

    const rows = detailRows(screenRows(await pane.drawn(), COLUMNS));
    const hooksRow = rows.find((row) => row.startsWith("hooks ")) ?? "";
    expect(hooksRow).toContain("2 hooks");
    expect(hooksRow).toContain(GUARD_NAME);
    expect(hooksRow).toContain(PUSH_COMMAND);
    expect(rows).toContain("MCP 2 servers · sec-scan, docs");
  });

  test("A21 a plugin whose plugin.json lists its hook files shows those hooks by name in the Hooks section", async ($, on) => {
    worldOf(on, {
      settings: { user: { enabledPlugins: { [PLUGIN_ID]: true } } },
      files: manifestPlugin(),
    });

    const pane = await setupPane($);

    expect(buttonLabels((await blocks(pane)).Hooks)).toEqual([GUARD_NAME, PUSH_COMMAND]);
  });

  test("A22 a hook command that is one unbroken token of -, _ and / wraps only after one of those separators at 60 columns", async ($, on) => {
    worldOf(on, {
      settings: {
        flag: { hooks: hooksFile([{ event: "Stop", handler: commandOf(SEPARATED_TOKEN) }]) },
      },
    });
    const pane = await setupPane($, COLUMNS, TALL_PANE_ROWS);

    await pressOnlyHook(pane);

    const screen = screenRows(await pane.drawn(), COLUMNS);
    const heading = screen.findIndex((row) => row.replace(/─+/g, "").trim() === "Command");
    expect(heading, "the Command heading").not.toBe(-1);
    const body = screen
      .slice(heading + 1)
      .map((row) => row.trim())
      .filter((row) => row !== "");
    expect(body.length).toBeGreaterThan(1);
    expect(body.join("")).toBe(SEPARATED_TOKEN);
    expect(body.slice(0, -1).filter((row) => !SEPARATOR_END.test(row))).toEqual([]);
  });

  test("A23 a hook from the session flag shows source session on its page, the label its list row shows, and no file row", async ($, on) => {
    worldOf(on, { settings: { flag: { hooks: hooksFile([GUARD_SPEC]) } } });
    const pane = await setupPane($);
    expect(hookRow((await blocks(pane)).Hooks, GUARD_NAME).text.endsWith(" session")).toBe(true);

    await pressName(pane, GUARD_NAME);

    const rows = detailRows(screenRows(await pane.drawn(), COLUMNS));
    expect(rows).toContain("source session");
    expect(rows.some((row) => row.startsWith("file "))).toBe(false);
  });

  test("A24 a permission rule from the session flag shows source session on its page and no file row", async ($, on) => {
    worldOf(on, { settings: { flag: { permissions: { allow: [PUSH_RULE] } } } });
    const pane = await setupPane($);

    await pressRule(pane, PUSH_RULE);

    const rows = detailRows(screenRows(await pane.drawn(), COLUMNS));
    expect(rows).toContain("source session");
    expect(rows.some((row) => row.startsWith("file "))).toBe(false);
  });

  test("A32 the Permissions group of the session flag is labelled session, the label its hook rows show", async ($, on) => {
    worldOf(on, { settings: { flag: { permissions: { allow: [PUSH_RULE, "Bash(ls)"] } } } });
    const pane = await setupPane($);

    expect(sourceRow((await blocks(pane)).Permissions, "session").text).toBe("session 2 rules");
  });

  test("A33 the Permissions group of the user settings is labelled user, the label its hook rows show", async ($, on) => {
    worldOf(on, { settings: { user: { permissions: { allow: [PUSH_RULE, "Bash(ls)"] } } } });
    const pane = await setupPane($);

    expect(sourceRow((await blocks(pane)).Permissions, "user").text).toBe("user 2 rules");
  });

  test("A34 the Plugins group of a plugin enabled in the session flag is labelled session, the label its hook rows show", async ($, on) => {
    worldOf(on, { settings: { flag: { enabledPlugins: { "alpha@market": true } } } });
    const pane = await setupPane($);

    expect(sourceRow((await blocks(pane)).Plugins, "session").text).toBe("session 1 plugin");
  });

  test("A35 the Plugins group of a plugin enabled in the user settings is labelled user, the label its hook rows show", async ($, on) => {
    worldOf(on, { settings: { user: { enabledPlugins: { "alpha@market": true } } } });
    const pane = await setupPane($);

    expect(sourceRow((await blocks(pane)).Plugins, "user").text).toBe("user 1 plugin");
  });

  test("A27 the Skills not used in 30 days heading counts the skills it lists", async ($, on) => {
    worldOf(on, {
      skills: [
        { name: "code-review", source: "built-in" },
        { name: "commit", source: "userSettings" },
      ],
      files: {
        [SKILL_USAGE_FILE]: JSON.stringify({
          skillUsage: {
            "code-review": { usageCount: 1, lastUsedAt: NOW - 55 * DAY_MS },
            commit: { usageCount: 2, lastUsedAt: NOW - 40 * DAY_MS },
          },
        }),
      },
    });

    const pane = await setupPane($);

    expect(await headingText(pane, "Skills not used in 30 days")).toBe(
      "Skills not used in 30 days 2 skills",
    );
  });
});

const SOURCE_COUNT =
  /^(--settings|~\/\.claude\/settings\.json|\.claude\/settings(\.local)?\.json) \d+ hooks?$/;
const MCP_INPUT = { path: "/a", mode: "fast" };
const MCP_INPUT_LINES = JSON.stringify(MCP_INPUT, null, 2)
  .split("\n")
  .map((line) => line.trim());
const REMOTE_HOOKS: HookSpec[] = [
  { event: "Http", handler: { type: "http", url: "https://hooks.example.com/scan" } },
  { event: "Mcp", handler: { type: "mcp_tool", server: "sec", tool: "scan", input: MCP_INPUT } },
  { event: "Prompt", handler: { type: "prompt", prompt: "Is this change safe?" } },
];

type HookSpec = { event: string; matcher?: string; handler: Record<string, unknown> };
type StateWrite = { key: string; value: unknown };

function commandOf(command: string): Record<string, unknown> {
  return { type: "command", command };
}

function hooksFile(specs: HookSpec[]): Record<string, unknown> {
  const events: Record<string, unknown[]> = {};
  for (const spec of specs) {
    const group = {
      ...(spec.matcher === undefined ? {} : { matcher: spec.matcher }),
      hooks: [spec.handler],
    };
    (events[spec.event] ??= []).push(group);
  }
  return events;
}

function manifestPlugin(): Record<string, string> {
  return {
    ...gatePlugin({}),
    [`${PLUGIN_PATH}/.claude-plugin/plugin.json`]: JSON.stringify({
      hooks: [`./${MANIFEST_HOOK_FILE}`, hooksFile([GUARD_SPEC])],
      mcpServers: WRAPPED_MCP.mcpServers,
    }),
    [`${PLUGIN_PATH}/${MANIFEST_HOOK_FILE}`]: JSON.stringify({ hooks: hooksFile([STOP_SPEC]) }),
  };
}

function gatePlugin(
  hooks: Record<string, unknown>,
  install: Record<string, unknown> = {},
): Record<string, string> {
  return {
    [PLUGIN_REGISTRY_FILE]: JSON.stringify({
      plugins: { "gate@market": [{ installPath: "/cache/gate", ...install }] },
    }),
    "/cache/gate/hooks/hooks.json": JSON.stringify({ hooks }),
  };
}

function stepName(step: number): string {
  return `tmux_step_${String(step).padStart(2, "0")}()`;
}

function spoolCommand(): string {
  const steps = Array.from({ length: STEP_COUNT }, (_, step) => {
    const lead = STEP_LEADS[step % STEP_LEADS.length] ?? "";
    return `${lead}${stepName(step)} { print -r -- "step ${step} $TMUX_CLAUDE_PID $PPID /usr/bin/true" >&3; /bin/cat /dev/null | /bin/sh -c "$1" >&3 || exit 1; }`;
  });
  return [SPOOL_HEAD, ...steps, SPOOL_TAIL].join("\n");
}

function hasButton(row: Line): boolean {
  return row.parts.some((part) => part.type === "Button");
}

function eventRow(block: Block | undefined, event: string): Line {
  const row = (block?.rows ?? []).find((candidate) => candidate.text.startsWith(`${event} `));
  expect(row, `an event row ${event}`).toBeDefined();
  return row as Line;
}

function hookRow(block: Block | undefined, name: string): Line {
  const row = (block?.rows ?? []).find((candidate) => nameButtonOf(candidate, name) !== undefined);
  expect(row, `a hook row ${name}`).toBeDefined();
  return row as Line;
}

function partColour(row: Line, text: string): unknown {
  const part = row.parts.find((candidate) => textOf(candidate) === text);
  expect(part, `a part ${text}`).toBeDefined();
  return part?.props?.color;
}

function buttonLabels(block: Block | undefined): string[] {
  return (block?.rows ?? []).flatMap((row) =>
    row.parts
      .filter((part) => part.type === "Button")
      .map((part) => (typeof part.props?.label === "string" ? part.props.label : "")),
  );
}

function namesByEvent(block: Block | undefined): Record<string, string> {
  const names: Record<string, string> = {};
  let event = "";
  for (const row of block?.rows ?? []) {
    const button = row.parts.find((part) => part.type === "Button");
    if (button === undefined) event = row.text.split(" ")[0] ?? "";
    else names[event] = typeof button.props?.label === "string" ? button.props.label : "";
  }
  return names;
}

function rowWith(screen: string[], text: string): string {
  const row = screen.find((candidate) => candidate.includes(text));
  expect(row, `a screen row with ${text}`).toBeDefined();
  return row ?? "";
}

function eventColumn(screen: string[], event: string): number {
  const row = screen.find((candidate) =>
    new RegExp(`^\\s*${event}\\s+\\d+ hooks?$`).test(candidate.trimEnd()),
  );
  expect(row, `an event row ${event}`).toBeDefined();
  return (row ?? "").indexOf(event);
}

function matcherColumns(screen: string[], pairs: string[][]): number[] {
  return pairs.map(([name = "", matcher = ""]) => {
    const row = rowWith(screen, name);
    return row.indexOf(matcher, row.indexOf(name) + name.length);
  });
}

function detailRows(screen: string[]): string[] {
  const rows = screen.map((row) => row.replace(/─+/g, "").replace(/\s+/g, " ").trim());
  const start = rows.indexOf(BACK_ROW);
  expect(start, "the back button row").not.toBe(-1);
  const shown = rows.slice(start);
  while (shown.at(-1) === "") shown.pop();
  return shown;
}

function bodyAfterFieldRows(rows: string[]): string[] {
  return rows.slice(rows.findIndex((row) => row.startsWith("timeout ")) + 2);
}

function stateWorldOf(on: On): { writes: StateWrite[]; scrollTo: (rows: number) => void } {
  const writes: StateWrite[] = [];
  let bodyOffset = { value: 0 as unknown, version: 1 };
  on("state.get", (_$, e, next) => (e.key === BODY_OFFSET_KEY ? { value: bodyOffset } : next(e)));
  on("state.set", (_$, e, next) => {
    writes.push({ key: e.key, value: e.value });
    if (e.key !== BODY_OFFSET_KEY) return next(e);
    bodyOffset = { value: e.value, version: bodyOffset.version + 1 };
    return { value: { isSet: true, version: bodyOffset.version } };
  });
  return {
    writes,
    scrollTo: (rows) => {
      bodyOffset = { value: rows, version: bodyOffset.version + 1 };
    },
  };
}

function lastWritten(writes: StateWrite[], key: string): unknown {
  return writes.filter((write) => write.key === key).at(-1)?.value;
}

async function pressName(pane: Pane, name: string): Promise<void> {
  const target = (await pane.findAll({ type: "Button" })).find(
    (button) => button.props.label === name,
  );
  expect(target, `a button labelled ${name}`).toBeDefined();
  await pane.press({ key: target?.key ?? "" });
  await settle(pane);
}

async function pressOnlyHook(pane: Pane): Promise<void> {
  const hooks = (await blocks(pane)).Hooks;
  const label = Object.values(namesByEvent(hooks))[0] ?? "";
  await pressName(pane, label);
}

async function hasBack(pane: Pane): Promise<boolean> {
  const buttons = await pane.findAll({ type: "Button" });
  return buttons.some((button) => BACK_LABEL.test(String(button.props.label)));
}

async function pressBack(pane: Pane): Promise<void> {
  const back = (await pane.findAll({ type: "Button" })).find((button) =>
    BACK_LABEL.test(String(button.props.label)),
  );
  expect(back, "a back button").toBeDefined();
  await pane.press({ key: back?.key ?? "" });
  await settle(pane);
}

async function visitTab(pane: Pane, away: string, home: string): Promise<void> {
  await pressPagedTab(pane, away);
  await settle(pane);
  await pressPagedTab(pane, home);
  await settle(pane);
}

function hookEntry(
  event: string,
  matcher: string | undefined,
  command: string,
): Record<string, unknown> {
  const group = {
    ...(matcher === undefined ? {} : { matcher }),
    hooks: [{ type: "command", command }],
  };
  return { [event]: [group] };
}

function instructionFile(rule: string): string {
  return [
    "---",
    FRONTMATTER_RULE,
    "---",
    "",
    `## ${HEADING_RULE}`,
    "",
    SHORT_RULE,
    rule,
    "",
    "```",
    FENCED_RULE,
    "```",
    "",
  ].join("\n");
}

function rowTexts(block: Block | undefined): string[] {
  return (block?.rows ?? []).map((row) => row.text);
}

function groupItems(block: Block | undefined, group: string): string[] {
  return groupRows(block, group).map((row) => row.text);
}

function groupRows(block: Block | undefined, group: string): Line[] {
  const rows = block?.rows ?? [];
  const start = rows.findIndex((row) => isSourceRow(row, group));
  expect(start, `a "${group}" group row`).not.toBe(-1);
  const items: Line[] = [];
  for (const row of rows.slice(start + 1)) {
    if (row.indent <= (rows[start]?.indent ?? 0)) break;
    items.push(row);
  }
  return items;
}

function isSourceRow(row: Line, group: string): boolean {
  return row.text === group || row.text.startsWith(`${group} `);
}

function sourceRow(block: Block | undefined, group: string): Line {
  const row = (block?.rows ?? []).find((candidate) => isSourceRow(candidate, group));
  expect(row, `a "${group}" source row`).toBeDefined();
  return row as Line;
}

function rowColours(rows: Line[], kind: string): unknown[] {
  const row = rows.find((candidate) => candidate.text.startsWith(`${kind} `));
  expect(row, `a ${kind} rule row`).toBeDefined();
  return (row?.parts ?? []).map(colourOf);
}

function colourOf(part: Line["parts"][number]): unknown {
  if (part.type !== "Button") return part.props?.color;
  return childrenOf(part).find((child) => child.type === "Text")?.props?.color;
}

async function blocks(pane: Pane): Promise<Record<string, Block>> {
  const found: Record<string, Block> = {};
  let current: Block | undefined;
  for (const line of linesOf(await pane.drawn())) {
    const text = line.text.replace(WHITESPACE_RUN, " ").trim();
    const title = HEADINGS.find(
      (candidate) => text === candidate || text.startsWith(`${candidate} `),
    );
    if (title !== undefined) {
      current = { title, count: null, heading: line, rows: [] };
      found[title] = current;
    } else if (text !== "") {
      current?.rows.push(line);
    }
  }
  return found;
}

async function settle(pane: Pane): Promise<void> {
  for (let tick = 0; tick < SETTLE_TICKS; tick++) await pane.redraw();
}

async function setupPane($: Engine, columns = COLUMNS, rows = PANE_ROWS): Promise<Pane> {
  await $.session.start({ cwd: CWD, surface: "terminal", isInteractive: true });
  const pane = await mountPane($, columns, rows);
  for (let press = 0; press < MAX_TAB_PRESSES; press++) {
    const buttons = await pane.findAll({ type: "Button" });
    const target =
      buttons.find((button) => button.props.label === SETUP) ??
      buttons.find((button) => String(button.props.label).includes(NEXT_TAB_LABEL));
    expect(target, `a ${SETUP} tab button or the next-tab arrow`).toBeDefined();
    await pane.press({ key: target?.key ?? "" });
    await settle(pane);
    if (target?.props.label === SETUP) return pane;
  }
  expect(false, `${SETUP} reached through the tab arrows`).toBe(true);
  return pane;
}

function mountPane($: Engine, columns: number, rows: number): Promise<Pane> {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: "session",
    props: {
      title: "Session",
      isFocused: false,
      bodyColumns: columns,
      placement: "dock",
      scroll: { offset: 0, bodyRows: rows },
      view: {},
    },
    viewport: { columns, rows },
  });
}

function worldOf(on: On, options: WorldOptions): void {
  const stored = new Map<string, unknown>();
  const skills = options.skills ?? [];
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
  on("session.id", () => ({ value: "session-one" }));
  on("classic.SessionStart", () => ({}));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("command.register", () => ({ value: {} }) as never);
  on("agent.list", () => ({ value: [] }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", (_$, e) => {
    const breakdown = {
      categories: [],
      totalTokens: 0,
      rawMaxTokens: 200_000,
      gridRows: [],
      memoryFiles: options.memoryFiles ?? [],
      agents: [],
      mcpTools: [],
      skills: {
        totalSkills: skills.length,
        includedSkills: skills.length,
        tokens: 0,
        skillFrontmatter: skills.map((skill) => ({ ...skill, tokens: 10 })),
      },
    } as unknown as SessionContextBreakdown;
    const context =
      e.breakdown === undefined ? { window: 200_000 } : { window: 200_000, breakdown };
    return { value: { startedAt: 0, context, rateLimits: [] } };
  });
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: CWD }));
  on("settings.read", (_$, e) => ({
    value: e.source === undefined ? {} : (options.settings?.[e.source] ?? {}),
  }));
  on("fs.exists", (_$, e) => ({ value: options.files?.[e.path] !== undefined }));
  on("fs.read", (_$, e) => {
    const text = options.files?.[e.path];
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`);
    return { value: text };
  });
  on("ui.render", { component: "Pane" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine pane</Text>;
  });
}

function colourOfPiece(row: Line, piece: string): unknown {
  const part = row.parts.find((candidate) => textOf(candidate).trim() === piece);
  expect(part, `a piece ${piece}`).toBeDefined();
  return part?.props?.color;
}

function leadingCellsOf(row: string | undefined): number {
  expect(row, "a screen row").toBeDefined();
  return (row ?? "").length - (row ?? "").trimStart().length;
}

async function pressRule(pane: Pane, rule: string): Promise<void> {
  const target = (await pane.findAll({ type: "Button" }))
    .map((button) => ({
      key: button.key,
      label: labelOfButton(button).replace(ELLIPSIS, ""),
    }))
    .filter(({ label }) => label.length > 0 && rule.startsWith(label))
    .sort((left, right) => right.label.length - left.label.length)[0];
  expect(target, `a button showing the start of ${rule}`).toBeDefined();
  await pane.press({ key: target?.key ?? "" });
  await settle(pane);
}

async function headingText(pane: Pane, title: string): Promise<string> {
  const heading = linesOf(await pane.drawn())
    .map((line) => line.text.replace(WHITESPACE_RUN, " ").trim())
    .find((text) => text === title || text.startsWith(`${title} `));
  expect(heading, `the ${title} heading`).toBeDefined();
  return heading ?? "";
}

function ruleRowTexts(drawn: unknown): string[] {
  return linesOf(drawn as Parameters<typeof linesOf>[0])
    .map((line) => line.text.replace(WHITESPACE_RUN, " ").trim())
    .filter((text) => /^(allow|deny|ask) /.test(text));
}

function labelOfButton(button: { props: Record<string, unknown> }): string {
  return typeof button.props.label === "string" ? button.props.label : "";
}
