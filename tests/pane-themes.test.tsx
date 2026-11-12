import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

import { inkFor } from "../hooks/pane-ink";
import { palette } from "../hooks/palette";
import { colouredPieces } from "./band-screen";
import { childrenOf, collect, labelledTextOf, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import {
  ANSI_FILLS,
  contrastRatio,
  deltaE2000,
  luminance,
  rgbOfColour,
  xtermRgbOfColour,
} from "./contrast";
import type { Rgb, ThemeName } from "./contrast";
import { THEMES } from "./theme-rgb";

const DISTINCT_HUE_DELTA_E = 22;
const DISTINCT_FLOOR: Record<string, number> = {
  light: DISTINCT_HUE_DELTA_E,
  "light-daltonized": DISTINCT_HUE_DELTA_E,
  "light-ansi": DISTINCT_HUE_DELTA_E,
  "dark-ansi": 15,
};
const AUTO_DISTINCT_FLOOR = 11.4;
const INK_DELTA_E = 10;

const HOME = "/Users/dev";
const CWD = "/Users/dev/app";
const COLUMNS = 60;
const PANE_ROWS = 40;
const FLUSH_MS = 400;
const MARK_RATIO = 3;
const TEXT_RATIO = 4.5;
const DARK_ANSI_MUTED_RATIO = 2;
const NAME_OVER_MUTED_RATIO = 1.5;
const GREY_251 = [198, 198, 198];
const THEME_NAMES = Object.keys(THEMES) as ThemeName[];

let clock: ReturnType<typeof mock.clock>;

const MIX_THEMES = [
  "dark",
  "light",
  "dark-daltonized",
  "light-daltonized",
  "dark-ansi",
  "light-ansi",
  "auto",
];

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

    const textRatio =
      theme === "dark-ansi"
        ? DARK_ANSI_MUTED_RATIO
        : theme.endsWith("ansi")
          ? MARK_RATIO
          : TEXT_RATIO;

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

  test("PT8 dark-ansi: muted text is dimmer than names", () => {
    const ink = inkFor("dark-ansi");

    expect(luminance(rgbOfColour("dark-ansi", ink.muted))).toBeLessThan(
      luminance(rgbOfColour("dark-ansi", ink.text ?? "")),
    );
  });

  test("PT8b dark-ansi: names are clearly brighter than muted text, not just a hair", () => {
    const ink = inkFor("dark-ansi");

    expect(
      contrastRatio(rgbOfColour("dark-ansi", ink.text ?? ""), rgbOfColour("dark-ansi", ink.muted)),
    ).toBeGreaterThanOrEqual(NAME_OVER_MUTED_RATIO);
  });

  test("PT8c dark-ansi: muted text is its own grey, so it differs from names in palettes where white and grey match", () => {
    const ink = inkFor("dark-ansi");

    expect([palette.text, palette.muted]).not.toContain(ink.muted);
  });

  test("PT8d a 256-colour grey from the ramp reads as that grey", () => {
    expect(rgbOfColour("dark-ansi", "ansi256(251)")).toEqual(GREY_251);
  });

  test("PT10 the muted colour is unchanged in dark, light, light-ansi, light-daltonized, dark-daltonized and auto", () => {
    expect({
      dark: inkFor("dark").muted,
      light: inkFor("light").muted,
      "light-ansi": inkFor("light-ansi").muted,
      "light-daltonized": inkFor("light-daltonized").muted,
      "dark-daltonized": inkFor("dark-daltonized").muted,
      auto: inkFor("auto").muted,
    }).toEqual({
      dark: palette.muted,
      light: palette.muted,
      "light-ansi": palette.text,
      "light-daltonized": palette.muted,
      "dark-daltonized": palette.muted,
      auto: "ansi256(8)",
    });
  });

  for (const theme of ["light", "light-daltonized"] as const) {
    test(`PT13 ${theme}: the empty bar cells are at least ${MARK_RATIO}:1 on the pane fill and lighter than muted text`, () => {
      const ink = inkFor(theme);
      const fill = rgbOf(theme, palette.panel);
      const empty = rgbOfColour(theme, ink.meterEmpty);

      expect(contrastRatio(empty, fill)).toBeGreaterThanOrEqual(MARK_RATIO);
      expect(luminance(empty)).toBeGreaterThan(luminance(rgbOfColour(theme, ink.muted)));
    });
  }

  for (const theme of MIX_THEMES) {
    test(`PT11 under ${theme} no two tool kinds in the Tool mix share a colour`, () => {
      expect(duplicatesOf(Object.values(inkFor(theme).mix))).toEqual([]);
    });
  }
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
    test(`PT6 under ${theme} the tab bar stays dimmed buttons and only the filter label, the folder name and the file name are undimmed labels`, async ($, on) => {
      paneWorld(on, theme);
      await $.session.start({ cwd: CWD, surface: "terminal", isInteractive: true });

      const tree = await paneOnTab($, "Files");

      const undimmed = collect(tree, "Button").filter((button) => button.props?.dimColor !== true);
      expect(undimmed.map((button) => button.props?.label)).toEqual([
        "f filter",
        "▾ ~/app/src/",
        "a.ts",
      ]);
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

  for (const theme of ["light-ansi", "dark-ansi", "light", "dark"]) {
    test(`PT12 under ${theme} the Context links to the MCP and Skills tabs are drawn as bracketed buttons`, async ($, on) => {
      paneWorld(on, theme, BREAKDOWN_WITH_LINKS);
      await $.session.start({ cwd: CWD, surface: "terminal", isInteractive: true });

      const tree = await paneOnTab($, "Context");

      const links = collect(tree, "Button").filter(
        (button) => button.props?.label === "MCP tab" || button.props?.label === "Skills tab",
      );
      expect(links.map((button) => button.props?.label)).toEqual(["MCP tab", "Skills tab"]);
      expect(collect(tree, "Box").map(labelledTextOf)).toEqual(
        expect.arrayContaining(["[ MCP tab ]", "[ Skills tab ]"]),
      );
    });
  }

  for (const theme of ["light", "light-daltonized", "light-ansi", "dark-ansi", "auto"]) {
    test(`PT14 under ${theme} the Context legend gives each of the eight used categories its own swatch colour`, async ($, on) => {
      paneWorld(on, theme, BREAKDOWN_EIGHT);
      await $.session.start({ cwd: CWD, surface: "terminal", isInteractive: true });

      const pieces = colouredPieces(await paneOnTab($, "Context")).filter(
        (piece) => piece.text.trim() !== "",
      );

      const swatches = USED_CATEGORIES.map((name) => {
        const at = pieces.findIndex((piece) => piece.text.trim() === name);
        expect(at, `a legend row for ${name}`).toBeGreaterThan(0);
        return pieces[at - 1]?.color;
      });
      expect(new Set(swatches).size).toBe(USED_CATEGORIES.length);
    });
  }

  for (const theme of ["light", "light-daltonized", "light-ansi", "dark-ansi"]) {
    test(`PT15 under ${theme} every two Context legend swatches of the eight used categories are at least ${DISTINCT_FLOOR[theme]} CIEDE2000 apart`, async ($, on) => {
      paneWorld(on, theme, BREAKDOWN_EIGHT);
      await $.session.start({ cwd: CWD, surface: "terminal", isInteractive: true });

      const pieces = colouredPieces(await paneOnTab($, "Context")).filter(
        (piece) => piece.text.trim() !== "",
      );

      const swatches = USED_CATEGORIES.map((name) => {
        const at = pieces.findIndex((piece) => piece.text.trim() === name);
        expect(at, `a legend row for ${name}`).toBeGreaterThan(0);
        return { name, rgb: swatchRgbOf(theme as ThemeName, String(pieces[at - 1]?.color)) };
      });
      const closePairs = swatches.flatMap((first, i) =>
        swatches
          .slice(i + 1)
          .filter((second) => deltaE2000(first.rgb, second.rgb) < (DISTINCT_FLOOR[theme] ?? 0))
          .map((second) => `${first.name}/${second.name}`),
      );
      expect(closePairs).toEqual([]);
    });
  }

  test("PT16 under auto every two pane hues are at least the measured floor apart in the terminal's default palette", () => {
    const hues = inkFor("auto").hues.map(xtermRgbOfColour);

    const closePairs = hues.flatMap((first, i) =>
      hues
        .slice(i + 1)
        .filter((second) => deltaE2000(first, second) < AUTO_DISTINCT_FLOOR)
        .map((second) => `${first.join(",")}/${second.join(",")}`),
    );
    expect(closePairs).toEqual([]);
  });

  test(`PT17 dark-ansi: every pane hue is at least ${INK_DELTA_E} CIEDE2000 from the name, muted and failed colours`, () => {
    const ink = inkFor("dark-ansi");
    const inks = [ink.text, ink.muted, ink.failed].map((colour) =>
      rgbOfColour("dark-ansi", colour ?? ""),
    );

    const lost = ink.hues.filter((hue) =>
      inks.some((other) => deltaE2000(rgbOfColour("dark-ansi", hue), other) < INK_DELTA_E),
    );
    expect(lost).toEqual([]);
  });

  test("PT18 light-ansi: the alert colour is the amber brown 94", () => {
    expect(inkFor("light-ansi").alert).toBe("ansi256(94)");
  });

  test("PT19 dark and dark-daltonized keep their pane hue tables", () => {
    for (const theme of ["dark", "dark-daltonized"]) {
      expect(inkFor(theme).hues).toEqual([
        palette.tool,
        palette.ok,
        palette.alert,
        palette.keyword,
        palette.button,
        palette.user,
      ]);
    }
  });

  test("PT9 dark-ansi: an Activity row's duration is dimmer than the file name beside it", async ($, on) => {
    paneWorld(on, "dark-ansi");
    await $.session.start({ cwd: CWD, surface: "terminal", isInteractive: true });

    const cells = textsOfRowWith(await paneOnTab($, "Activity"), "a.ts");
    const duration = cells.find(isDuration);
    const name = cells.find((node) => textOf(node).includes("a.ts"));

    expect(duration).toBeDefined();
    expect(name).toBeDefined();
    expect(brightnessInDarkAnsi(duration)).toBeLessThan(brightnessInDarkAnsi(name));
  });
});

function duplicatesOf(values: string[]): string[] {
  return values.filter((value, i) => values.indexOf(value) !== i);
}

function textsOfRowWith(tree: Node, text: string): Node[] {
  const row = collect(tree, "Box").find(
    (box) =>
      box.props?.flexDirection === "row" &&
      box.props.height === 1 &&
      collect(box, "Text").some((node) => textOf(node).includes(text)),
  );
  return row === undefined ? [] : collect(row, "Text");
}

function isDuration(node: Node): boolean {
  return /^\d+(ms|s)$/.test(textOf(node));
}

function brightnessInDarkAnsi(node: Node | undefined): number {
  return luminance(rgbOfColour("dark-ansi", String(node?.props?.color)));
}

function ownText(node: Node): string {
  return childrenOf(node).length === 0 ? textOf(node) : "";
}

function rgbOf(theme: ThemeName, key: string): Rgb {
  return (THEMES[theme] as Record<string, Rgb>)[key] ?? [0, 0, 0];
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

const USED_CATEGORIES = [
  "System prompt",
  "System tools",
  "MCP tools",
  "MCP server instructions",
  "Custom agents",
  "Memory files",
  "Skills",
  "Messages",
];

const BREAKDOWN_EIGHT = {
  ...BREAKDOWN,
  categories: [
    ...USED_CATEGORIES.map((name, i) => ({
      name,
      tokens: 80_000 - i * 5_000,
      color: "permission",
      isDeferred: false,
      kind: "used",
    })),
    { name: "Free space", tokens: 20_000, color: "promptBorder", isDeferred: false, kind: "free" },
  ],
  totalTokens: 180_000,
  gridRows: USED_CATEGORIES.map((name) => [{ categoryName: name, squareFullness: 1 }]),
};

const BREAKDOWN_WITH_LINKS = {
  ...BREAKDOWN,
  mcpTools: [{ name: "mcp__linear__a", serverName: "linear", tokens: 0, isLoaded: false }],
  skills: { totalSkills: 2, includedSkills: 2, tokens: 300, skillFrontmatter: [] },
};

function swatchRgbOf(theme: ThemeName, colour: string): Rgb {
  const index = /^ansi256\((\d+)\)$/.exec(colour)?.[1];
  const isKnown = index === undefined ? colour in THEMES[theme] : Number(index) >= 16;
  expect(isKnown, `swatch colour ${colour} resolves to RGB under ${theme}`).toBe(true);
  return rgbOfColour(theme, colour);
}

function paneWorld(on: On, theme: string, breakdown: object = BREAKDOWN): void {
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
          context: { window: 200_000, breakdown },
          rateLimits: [],
        },
      }) as never,
  );
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.model", () => ({ value: "claude-opus-5-5" }));
  on("settings.read", () => ({ value: {} }));
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
