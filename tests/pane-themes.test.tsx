import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

import { inkFor } from "../hooks/pane-ink";
import { palette } from "../hooks/palette";
import { childrenOf, collect, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import { THEMES } from "./theme-rgb";

type ThemeName = keyof typeof THEMES;
type Rgb = readonly number[];

const HOME = "/Users/dev";
const CWD = "/Users/dev/app";
const COLUMNS = 60;
const PANE_ROWS = 40;
const FLUSH_MS = 400;
const MARK_RATIO = 3;
const TEXT_RATIO = 4.5;
const CUBE_START = 16;
const CUBE_SIDE = 6;
const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];
const ANSI_FILLS: Record<string, readonly Rgb[]> = {
  "light-ansi": [
    [191, 191, 191],
    [229, 229, 229],
  ],
  "dark-ansi": [
    [102, 102, 102],
    [127, 127, 127],
  ],
};
const THEME_NAMES = Object.keys(THEMES) as ThemeName[];
const ANSI256 = /^ansi256\((\d+)\)$/;

let clock: ReturnType<typeof mock.clock>;

describe("pane marks stay readable on the pane fill in every theme", () => {
  for (const theme of THEME_NAMES) {
    const ink = inkFor(theme);
    const fills = ANSI_FILLS[theme] ?? [rgbOf(theme, palette.panel)];
    const marks = {
      tool: ink.tool,
      ok: ink.ok,
      failed: ink.failed,
      alert: ink.alert,
      ...ink.mix,
      ...Object.fromEntries(ink.hues.map((hue, i) => [`hue${i}`, hue])),
    };

    test(`PT1 ${theme}: every mark colour is at least ${MARK_RATIO}:1 on the pane fill`, () => {
      const weak = Object.entries(marks)
        .filter(
          (entry): entry is [string, string] => entry[0] !== "Other" && entry[1] !== undefined,
        )
        .map(([name, colour]) => ({
          name,
          ratio: Math.min(...fills.map((fill) => contrastRatio(rgbOfColour(theme, colour), fill))),
        }))
        .filter(({ ratio }) => ratio < MARK_RATIO);

      expect(weak).toEqual([]);
    });

    const textRatio = theme.endsWith("ansi") ? MARK_RATIO : TEXT_RATIO;

    test(`PT2 ${theme}: muted text is at least ${textRatio}:1 on the pane fill`, () => {
      const ratio = Math.min(
        ...fills.map((fill) => contrastRatio(rgbOfColour(theme, ink.muted), fill)),
      );

      expect(ratio).toBeGreaterThanOrEqual(textRatio);
    });
  }

  test("PT3 dark and dark-daltonized keep today's pane colours", () => {
    for (const theme of ["dark", "dark-daltonized"]) {
      const ink = inkFor(theme);

      expect([ink.muted, ink.tool, ink.ok, ink.failed, ink.alert]).toEqual([
        palette.muted,
        palette.tool,
        palette.ok,
        palette.failed,
        palette.alert,
      ]);
    }
  });
});

describe("the drawn tabs use the theme's pane colours", () => {
  test("PT4 under light-ansi the Activity tool names and the +/- counts are not the engine blue", async ($, on) => {
    paneWorld(on, "light-ansi");
    await $.session.start({ cwd: CWD, surface: "terminal", isInteractive: true });

    const tree = await paneOnTab($, "Activity");

    const colours = collect(tree, "Text").map((node) => node.props?.color);
    expect(colours).not.toContain(palette.tool);
    expect(colours).not.toContain(palette.ok);
    expect(colours).not.toContain(palette.muted);
  });

  test("PT5 under dark the Activity tool names keep the permission colour", async ($, on) => {
    paneWorld(on, "dark");
    await $.session.start({ cwd: CWD, surface: "terminal", isInteractive: true });

    const tree = await paneOnTab($, "Activity");

    const readColours = collect(tree, "Text")
      .filter((node) => textOf(node).trim() === "Read")
      .map((node) => node.props?.color);
    expect(readColours).toContain(palette.tool);
  });

  for (const theme of ["light-ansi", "dark-ansi", "light", "dark"]) {
    test(`PT6 under ${theme} the tab bar and file folders stay dimmed buttons and only the file name is an undimmed name label`, async ($, on) => {
      paneWorld(on, theme);
      await $.session.start({ cwd: CWD, surface: "terminal", isInteractive: true });

      const tree = await paneOnTab($, "Files");

      const undimmed = collect(tree, "Button").filter((button) => button.props?.dimColor !== true);
      expect(undimmed.map((button) => button.props?.label)).toEqual(["a.ts"]);
    });
  }

  for (const theme of ["light-ansi", "dark-ansi", "light", "light-daltonized"]) {
    test(`PT7 under ${theme} the Context grid draws no engine category colour`, async ($, on) => {
      paneWorld(on, theme);
      await $.session.start({ cwd: CWD, surface: "terminal", isInteractive: true });

      const tree = await paneOnTab($, "Context");

      const ink = inkFor(theme);
      const allowed = new Set<unknown>([...ink.hues, ink.muted, palette.text]);
      const glyphs = collect(tree, "Text").filter((node) => /^[⛁⛀⛶⛝]\s?$/u.test(ownText(node)));
      expect(glyphs.length).toBeGreaterThan(0);
      expect(glyphs.filter((node) => !allowed.has(node.props?.color))).toEqual([]);
    });
  }
});

function ownText(node: Node): string {
  return childrenOf(node).length === 0 ? textOf(node) : "";
}

function rgbOfColour(theme: ThemeName, colour: string): Rgb {
  const cube = ANSI256.exec(colour);
  if (cube === null) return (THEMES[theme] as Record<string, Rgb>)[colour] ?? [0, 0, 0];
  const index = Number(cube[1]) - CUBE_START;
  const level = (step: number): number => CUBE_LEVELS[Math.floor(index / step) % CUBE_SIDE] ?? 0;
  return [level(CUBE_SIDE ** 2), level(CUBE_SIDE), level(1)];
}

function rgbOf(theme: ThemeName, key: string): Rgb {
  return (THEMES[theme] as Record<string, Rgb>)[key] ?? [0, 0, 0];
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

function luminance(rgb: Rgb): number {
  const [r = 0, g = 0, b = 0] = rgb.map((channel) => {
    const unit = channel / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const BREAKDOWN = {
  categories: [
    {
      name: "System prompt",
      tokens: 3_000,
      color: "promptBorder",
      isDeferred: false,
      kind: "used",
    },
    { name: "Messages", tokens: 40_000, color: "permission", isDeferred: false, kind: "used" },
    { name: "Free space", tokens: 100_000, color: "promptBorder", isDeferred: false, kind: "free" },
  ],
  totalTokens: 43_000,
  rawMaxTokens: 200_000,
  percentage: 21,
  model: "claude-opus-5-5",
  gridRows: [
    [
      { categoryName: "System prompt", squareFullness: 1 },
      { categoryName: "Messages", squareFullness: 1 },
      { categoryName: "Free space", squareFullness: 1 },
    ],
  ],
  memoryFiles: [],
  mcpTools: [],
  agents: [],
  skills: { totalSkills: 0, includedSkills: 0, tokens: 0, skillFrontmatter: [] },
  autoCompactThreshold: 160_000,
  isAutoCompactEnabled: true,
};

function paneWorld(on: On, theme: string): void {
  clock = mock.clock(on, { now: 200_000 });
  mock.env(on, { HOME });
  on("config.list", () => ({ value: [{ key: "theme", value: theme }] }) as never);
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", () => ({ value: true }));
  on("tool.call", () => ({ result: "ok", text: "ok" }));
  on(
    "session.usage",
    () =>
      ({
        value: {
          startedAt: 0,
          context: { window: 200_000, breakdown: BREAKDOWN },
          rateLimits: [],
        },
      }) as never,
  );
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.model", () => ({ value: "claude-opus-5-5" }));
  on("session.cwd", () => ({ value: CWD }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("command.register", () => ({ value: {} }) as never);
  on("ui.render", { component: "Pane" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text color="text">engine pane</Text>;
  });
}

async function paneOnTab($: Engine, label: string): Promise<Node> {
  const calls = [
    { tool: "Read", file_path: `${CWD}/src/a.ts` },
    { tool: "Edit", file_path: `${CWD}/src/a.ts` },
  ];
  for (const [i, call] of calls.entries())
    await $.tool.call({ ...call, tool_use_id: `pt-${i}` } as never);
  await clock.advance(FLUSH_MS);
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
  return await pane.drawn();
}
