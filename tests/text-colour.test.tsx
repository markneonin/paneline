import { describe, expect, mock, test } from "claude-code/testing";
import type { On, SessionContextBreakdown } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { inkFor } from "../hooks/pane-ink";
import { categoryColors, palette } from "../hooks/palette";
import { accentOf } from "../hooks/session-color";
import { THEMES } from "./theme-rgb";
import { childrenOf, collect, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import { isHeavy } from "./weight";

type Pane = Mounted<"terminal", "Pane">;

type ThemeName = keyof typeof THEMES;

const HOME = "/Users/dev";
const CWD = "/Users/dev/app";
const COLUMNS = 100;
const PANE_ROWS = 60;
const FENCE = "```";
const FLUSH_MS = 1_000;
const TABS = ["Context", "Activity", "Files", "Agents", "MCP"];

const ACCENT_NAMES = ["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"];
const ACCENT_TEXT = "clawd_background";
const LOW_CONTRAST_EXCEPTIONS: readonly (readonly [ThemeName, string, string])[] = [
  ["light", "background", "terminal"],
  ["light", "claude", "panel"],
  ["light", "claude", "band"],
  ["light-daltonized", "background", "terminal"],
  ["light-daltonized", "background", "panel"],
  ["light-daltonized", "background", "band"],
  ["light-daltonized", "warning", "terminal"],
  ["light-daltonized", "warning", "panel"],
  ["light-daltonized", "warning", "band"],
  ["light-daltonized", "claude", "terminal"],
  ["light-daltonized", "claude", "panel"],
  ["light-daltonized", "claude", "band"],
  ["light-daltonized", ACCENT_TEXT, accentOf("purple")],
];
const MAIN_TEXT_RATIO = 4.5;
const MARK_RATIO = 3;
const IN_PARAGRAPH_COLOURS = [palette.identifier, palette.button];
const MARK_COLOURS = [
  palette.section,
  palette.tool,
  palette.keyword,
  palette.ok,
  palette.failed,
  palette.alert,
  palette.user,
];

const BREAKDOWN = {
  categories: [
    { name: "Messages", tokens: 40_000, color: "permission", isDeferred: false, kind: "used" },
    { name: "Free space", tokens: 100_000, color: "promptBorder", isDeferred: false, kind: "free" },
  ],
  totalTokens: 40_000,
  rawMaxTokens: 200_000,
  percentage: 20,
  model: "claude-opus-5-5",
  gridRows: [[{ categoryName: "Messages", squareFullness: 1 }]],
  memoryFiles: [{ path: "/work/AGENTS.md", type: "Project", tokens: 300 }],
  mcpTools: [
    { name: "mcp__docs__c", serverName: "docs", tokens: 0, isLoaded: false },
    { name: "mcp__linear__a", serverName: "linear", tokens: 700, isLoaded: true },
    { name: "mcp__linear__b", serverName: "linear", tokens: 800, isLoaded: true },
  ],
  agents: [{ agentType: "reviewer", source: "projectSettings", tokens: 900 }],
  skills: { totalSkills: 9, includedSkills: 7, tokens: 2_500, skillFrontmatter: [] },
  autoCompactThreshold: 160_000,
  isAutoCompactEnabled: true,
} as unknown as SessionContextBreakdown;

describe("text carries an explicit theme colour", () => {
  for (const tab of TABS) {
    test(`TC1 the ${tab} tab draws no text in the terminal default foreground`, async ($, on) => {
      paneWorld(on);

      const tree = await paneOnTab($, tab);

      expect(uncolouredText(tree)).toEqual([]);
      expect(subtleText(tree)).toEqual([]);
    });
  }

  for (const tab of TABS) {
    test(`TC1b every button on the ${tab} tab is dim, or a name label drawn undimmed in a dark theme`, async ($, on) => {
      paneWorld(on);

      const tree = await paneOnTab($, tab);

      const undimmed = collect(tree, "Button").filter((button) => button.props?.dimColor !== true);
      expect(undimmed.filter((button) => !isNameLabel(button))).toEqual([]);
    });
  }

  test("TC7 the MCP tab draws each server name as one undimmed button in a dark theme and the actions of an opened server dim under it", async ($, on) => {
    paneWorld(on);
    const pane = await openedPane($, "MCP");

    await pane.press({ key: "docs" });

    const tree = await pane.drawn();

    const names = collect(tree, "Button").filter((node) =>
      ["docs", "linear"].includes(String(node.props?.label)),
    );
    expect(names.map((node) => [node.props?.label, node.props?.dimColor])).toEqual([
      ["docs", false],
      ["linear", false],
    ]);
    const actions = collect(tree, "Button").filter((node) =>
      ["reconnect", "disable"].includes(String(node.props?.label)),
    );
    expect(actions.map((node) => node.props?.dimColor)).toEqual([true, true]);
  });

  for (const tab of ["MCP", "Activity"]) {
    test(`TC7b the ${tab} tab draws its clickable name labels in full text colour, not dim, in a light theme`, async ($, on) => {
      paneWorld(on, "light");
      await $.session.start({ cwd: CWD, surface: "terminal", isInteractive: true });

      const tree = await paneOnTab($, tab);

      const labels = collect(tree, "Button").filter(isNameLabel);
      expect(labels.length).toBeGreaterThan(0);
      expect(labels.map((node) => node.props?.dimColor === true)).toEqual(labels.map(() => false));
    });
  }

  for (const theme of ["light", "light-ansi", "light-daltonized", "auto"]) {
    test(`TC7c the MCP tab draws its server names not dim and its headings in the theme text colour under ${theme}, which may sit on a light fill`, async ($, on) => {
      paneWorld(on, theme);
      await $.session.start({ cwd: CWD, surface: "terminal", isInteractive: true });

      const tree = await paneOnTab($, "MCP");

      const names = collect(tree, "Button").filter((node) =>
        ["docs", "linear"].includes(String(node.props?.label)),
      );
      expect(names.map((node) => [node.props?.label, node.props?.dimColor === true])).toEqual([
        ["docs", false],
        ["linear", false],
      ]);
      const colors = collect(tree, "Text")
        .filter((node) => isHeavy(node.props))
        .map((node) => node.props?.color);
      expect(colors).toContain(inkFor(theme).text);
      expect(colors).not.toContain(inkFor(theme).section);
    });
  }

  test("TC8 pressing an MCP server name button opens its actions", async ($, on) => {
    paneWorld(on);
    const pane = await openedPane($, "MCP");

    await pane.press({ key: "linear" });

    const labels = (await pane.findAll({ type: "Button" })).map((node) => node.props.label);
    expect(labels).toContain("reconnect");
  });

  test("TC8b pressing an MCP server name button in a light theme opens its actions", async ($, on) => {
    paneWorld(on, "light");
    await $.session.start({ cwd: CWD, surface: "terminal", isInteractive: true });
    const pane = await openedPane($, "MCP");

    await pane.press({ key: "linear" });

    const labels = (await pane.findAll({ type: "Button" })).map((node) => node.props.label);
    expect(labels).toContain("reconnect");
  });

  test("TC9 pressing an Activity call row label opens the call details", async ($, on) => {
    paneWorld(on);
    const pane = await openedPane($, "Activity");
    const row = (await pane.findAll({ type: "Button" })).find(
      (node) => node.props.label === "npm test",
    );

    expect(row?.key).toBe("call-tc-0");
    await pane.press({ key: row?.key ?? "" });

    const labels = (await pane.findAll({ type: "Button" })).map((node) => node.props.label);
    expect(labels).toContain("back");
  });

  test("TC10 pressing a Files folder label folds the folder", async ($, on) => {
    paneWorld(on);
    const pane = await openedPane($, "Files");
    const folder = (await pane.findAll({ type: "Button" })).find((node) =>
      String(node.props.label).startsWith("▾"),
    );

    await pane.press({ key: folder?.key ?? "" });

    const folded = (await pane.findAll({ type: "Button" })).filter((node) =>
      String(node.props.label).startsWith("▸"),
    );
    expect(folded.length).toBeGreaterThan(0);
  });

  test("TC2 the status row draws no text in the terminal default foreground", async ($, on) => {
    paneWorld(on);
    const band = await $.ui.mount({
      plugin: "paneline",
      surface: "terminal",
      component: "AbovePrompt",
      props: {
        hasSurvey: false,
        isWorking: false,
        maxRows: 10,
        bodyColumns: COLUMNS,
        scroll: { offset: 0, bodyRows: 10 },
        view: {},
      },
      viewport: { columns: COLUMNS, rows: 40 },
    });

    const tree = (await band.drawn()) as Node;

    expect(uncolouredText(tree)).toEqual([]);
    expect(subtleText(tree)).toEqual([]);
  });

  test("TC3 chat blocks draw no text in the terminal default foreground", async ($, on) => {
    paneWorld(on);
    const text = [
      "# Title",
      "plain **bold** and `code` text",
      "- one\n- two",
      "| a | b |\n| - | - |\n| 1 | 2 |",
      `${FENCE}ts title="a.ts"\nconst a = 1\n${FENCE}`,
      `${FENCE}mermaid\nflowchart TD\n  A[start] --> B[end]\n${FENCE}`,
    ].join("\n\n");
    const reply = await $.ui.mount({
      plugin: "paneline",
      surface: "terminal",
      component: "AssistantMessage",
      props: { text, isFirstOfReply: true },
      viewport: { columns: COLUMNS, rows: 60 },
    });

    const tree = (await reply.drawn()) as Node;

    expect(uncolouredText(tree)).toEqual([]);
    expect(subtleText(tree)).toEqual([]);
  });

  test("TC4 an edit diff panel draws no text in the terminal default foreground", async ($, on) => {
    paneWorld(on);
    await $.session.start({ cwd: CWD, surface: "terminal", isInteractive: true });
    const output = {
      filePath: `${CWD}/a.ts`,
      structuredPatch: [
        { oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [" keep", "-gone", "+came"] },
      ],
      originalFile: "",
      userModified: false,
      replaceAll: false,
    };
    const result = await $.ui.mount({
      plugin: "paneline",
      surface: "terminal",
      component: "ToolResult",
      props: { tool_use_id: "tc4", tool: "Edit", output, isErrored: false },
      viewport: { columns: 80, rows: 40 },
    });

    const tree = (await result.drawn()) as Node;

    expect(uncolouredText(tree)).toEqual([]);
    expect(subtleText(tree)).toEqual([]);
  });
});

for (const theme of Object.keys(THEMES) as ThemeName[])
  describe(`${theme} theme contrast`, () => {
    const isAnsi = theme.endsWith("ansi");
    const terminal = theme.startsWith("light") ? [255, 255, 255] : [0, 0, 0];
    const grounds = {
      terminal,
      panel: rgbOf(theme, palette.panel),
      band: rgbOf(theme, palette.userBand),
    };
    const coloured = isAnsi ? [] : [...IN_PARAGRAPH_COLOURS, ...MARK_COLOURS];

    for (const [groundName, ground] of Object.entries(grounds)) {
      const textRatio = isAnsi && groundName !== "terminal" ? MARK_RATIO : MAIN_TEXT_RATIO;
      test(`TC5 text is at least ${textRatio}:1 on the ${groundName}`, () => {
        expect(contrastRatio(rgbOf(theme, palette.text), ground)).toBeGreaterThanOrEqual(textRatio);
      });

      test(`TC5 inactive is at least ${MARK_RATIO}:1 on the ${groundName}`, () => {
        expect(contrastRatio(rgbOf(theme, palette.muted), ground)).toBeGreaterThanOrEqual(
          MARK_RATIO,
        );
      });

      test(`TC5 every coloured text key is readable on the ${groundName}`, () => {
        const failing = coloured
          .map((key) => ({ key, ratio: contrastRatio(rgbOf(theme, key), ground) }))
          .filter(({ key, ratio }) => ratio < minRatioOf(key, groundName))
          .filter(({ key }) => !isException(theme, key, groundName));

        expect(failing).toEqual([]);
      });
    }

    test(`TC5 every diagram hue is at least ${MARK_RATIO}:1 on the terminal and the code body`, () => {
      const failing = isAnsi
        ? []
        : categoryColors
            .flatMap((key) =>
              (["terminal", "panel"] as const).map((groundName) => ({
                key,
                groundName,
                ratio: contrastRatio(rgbOf(theme, key), grounds[groundName]),
              })),
            )
            .filter(({ ratio }) => ratio < MARK_RATIO)
            .filter(({ key, groundName }) => !isException(theme, key, groundName));

      expect(failing).toEqual([]);
    });

    test(`TC5 the selected tab and chip text is at least ${MARK_RATIO}:1 on each /color accent`, () => {
      const failing = isAnsi
        ? []
        : ACCENT_NAMES.map((name) => {
            const accent = accentOf(name);
            return {
              name,
              ratio: contrastRatio(rgbOf(theme, ACCENT_TEXT), rgbOf(theme, accent)),
            };
          })
            .filter(({ ratio }) => ratio < MARK_RATIO)
            .filter(({ name }) => !isException(theme, ACCENT_TEXT, accentOf(name)));

      expect(failing).toEqual([]);
    });
  });

let clock: ReturnType<typeof mock.clock>;

function paneWorld(on: On, theme = "dark"): void {
  clock = mock.clock(on, { now: 200_000 });
  mock.env(on, { HOME });
  on("config.list", () => ({ value: [{ key: "theme", value: theme }] }) as never);
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("agent.list", () => ({ value: [] }));
  on("agent.spawn", (_$, e) => ({ model: "sonnet", agentId: `spawned-${e.description}` }));
  on("fs.exists", () => ({ value: true }));
  on("tool.call", (_$, e) => {
    const call = e as unknown as { tool: string; command?: string };
    if (call.tool === "Bash" && call.command === "fail")
      return { isError: true, result: "boom", text: "boom" } as never;
    return { result: "ok", text: "ok" };
  });
  on("ui.copy", () => ({ value: { isCopied: true } }));
  on("session.usage", (_$, e) => {
    const context =
      e.breakdown === undefined ? { window: 200_000 } : { window: 200_000, breakdown: BREAKDOWN };
    return { value: { startedAt: 0, context, rateLimits: [] } };
  });
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.model", () => ({ value: "claude-opus-5-5" }));
  on("session.cwd", () => ({ value: CWD }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("command.register", () => ({ value: {} }) as never);
  on("ui.render", { component: "Pane" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text color="text">engine pane</Text>;
  });
  on("ui.render", { component: "AbovePrompt" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text color="text">engine row</Text>;
  });
  on("ui.render", { component: "ToolResult" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text color="text">engine result</Text>;
  });
}

async function runCalls($: Engine): Promise<void> {
  const calls = [
    { tool: "Bash", command: "npm test" },
    { tool: "Bash", command: "fail" },
    { tool: "Grep", pattern: "needle" },
    { tool: "Edit", file_path: `${CWD}/src/a.ts` },
  ];
  for (const [i, call] of calls.entries())
    await $.tool.call({ ...call, tool_use_id: `tc-${i}` } as never);
  for (const description of ["review the diff", "map the repo"])
    await $.agent.spawn({
      tool_use_id: `spawn-${description}`,
      prompt: "do the work",
      description,
      subagentType: "general-purpose",
      provider: "anthropic",
      parentModel: "sonnet",
      background: false,
      fork: false,
    } as never);
  await clock.advance(FLUSH_MS);
}

async function paneOnTab($: Engine, label: string): Promise<Node> {
  return await (await openedPane($, label)).drawn();
}

async function openedPane($: Engine, label: string): Promise<Pane> {
  await runCalls($);
  const pane = await $.ui.mount({
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
  const tab = (await pane.findAll({ type: "Button" })).find(
    (button) => button.props.label === label,
  );
  if (tab !== undefined) await pane.press({ key: tab.key ?? "" });
  return pane;
}

function uncolouredText(node: Node, isInsideColour = false): string[] {
  const isText = node.type === "Text";
  const isColoured = isInsideColour || (isText && node.props?.color !== undefined);
  const own = isText && !isColoured && ownString(node).trim() !== "" ? [ownString(node)] : [];
  return [...own, ...childrenOf(node).flatMap((child) => uncolouredText(child, isColoured))];
}

function ownString(node: Node): string {
  const parts = Array.isArray(node.children) ? node.children.flat(Infinity) : [node.children];
  return parts.filter((part) => typeof part === "string").join("");
}

function subtleText(tree: Node): string[] {
  return collect(tree, "Text")
    .filter((node) => node.props?.color === palette.rule && /[\p{L}\p{N}]/u.test(textOf(node)))
    .map(textOf);
}

function isException(theme: ThemeName, key: string, background: string): boolean {
  return LOW_CONTRAST_EXCEPTIONS.some(
    ([exceptionTheme, exceptionKey, exceptionBackground]) =>
      exceptionTheme === theme && exceptionKey === key && exceptionBackground === background,
  );
}

function minRatioOf(key: string, groundName: string): number {
  const isInParagraph = (IN_PARAGRAPH_COLOURS as readonly string[]).includes(key);
  return isInParagraph && groundName === "terminal" ? MAIN_TEXT_RATIO : MARK_RATIO;
}

function rgbOf(theme: ThemeName, key: string): readonly number[] {
  const rgb = (THEMES[theme] as Record<string, readonly number[]>)[key];
  if (rgb === undefined) throw new Error(`no RGB for ${key} in ${theme}`);
  return rgb;
}

function contrastRatio(a: readonly number[], b: readonly number[]): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

function luminance(rgb: readonly number[]): number {
  const [r = 0, g = 0, b = 0] = rgb.map((channel) => {
    const unit = channel / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isNameLabel(button: Node): boolean {
  return (button as Node & { hover?: unknown }).hover !== undefined;
}
