import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

import { fillsFor, palette } from "../hooks/palette";
import { childrenOf, collect, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";

const CWD = "/work";
const FENCE = "```";
const COLUMNS = 80;

const NAMED_THEMES = [
  "dark",
  "light",
  "dark-daltonized",
  "light-daltonized",
  "dark-ansi",
  "light-ansi",
] as const;
const PLAIN_PROSE_THEMES = ["light", "light-daltonized", "dark-ansi", "light-ansi"];

describe("the diff window header per theme", () => {
  for (const theme of [...NAMED_THEMES, "auto"]) {
    const isPlain = PLAIN_PROSE_THEMES.includes(theme);
    test(`AT10 under ${theme} the diff header has no fill and the path is ${isPlain ? "the terminal default colour" : "the text key"}`, async ($, on) => {
      await sessionWithTheme($, on, theme);

      const header = childrenOf(await treeOf(await mountDiff($)))[0]!;

      expect(allBackgrounds(header)).toEqual([]);
      expect(pathColourOf(header)).toBe(isPlain ? undefined : palette.text);
    });
  }
});

describe("prose colour per theme", () => {
  for (const theme of NAMED_THEMES) {
    const isPlain = PLAIN_PROSE_THEMES.includes(theme);
    test(`AT7 under ${theme} chat prose is ${isPlain ? "the terminal default colour" : "the text key"}`, () => {
      expect(fillsFor(theme).prose).toBe(isPlain ? undefined : palette.text);
    });
  }

  test("AT8 under auto chat prose keeps the text key", () => {
    expect(fillsFor("auto").prose).toBe(palette.text);
  });

  test("AT9 under light-ansi the Completed footer numbers draw in the terminal default colour", async ($, on) => {
    await sessionWithTheme($, on, "light-ansi");
    const ui = await $.ui.mount({
      plugin: "paneline",
      surface: "terminal",
      component: "TurnDuration",
      props: { word: "Completed", durationMs: 12_000 },
      viewport: { columns: COLUMNS, rows: 24 },
    });

    expect(await colorsOf(ui)).not.toContain(palette.text);
  });
});

describe("auto keeps the dark theme look", () => {
  test("AT1 under auto the fills equal the dark fills", () => {
    expect(fillsFor("auto")).toEqual(fillsFor("dark"));
  });

  test("AT2 under auto the user bubble band and a code block body are the theme keys", async ($, on) => {
    await sessionWithTheme($, on, "auto");

    expect(await backgroundsOf(await mountUser($))).toContain(palette.userBand);
    expect(await backgroundsOf(await mountReply($, `${FENCE}txt\nplain\n${FENCE}`))).toContain(
      palette.panel,
    );
  });

  test("AT3 under auto the diff header counts are the theme keys", async ($, on) => {
    await sessionWithTheme($, on, "auto");

    const colours = await countColoursOf(await mountDiff($));

    expect(colours).toEqual({ added: palette.ok, removed: palette.failed });
  });

  test("AT3b under auto the USER mark is the theme key", async ($, on) => {
    await sessionWithTheme($, on, "auto");

    expect(await colorsOf(await mountUser($))).toContain(palette.user);
  });

  test("AT4 under dark the fills stay the theme keys", async ($, on) => {
    await sessionWithTheme($, on, "dark");

    expect(await backgroundsOf(await mountUser($))).toContain(palette.userBand);
    expect(await backgroundsOf(await mountReply($, `${FENCE}txt\nplain\n${FENCE}`))).toContain(
      palette.panel,
    );
    expect(await countColoursOf(await mountDiff($))).toEqual({
      added: palette.ok,
      removed: palette.failed,
    });
  });

  test("AT5 under light-ansi the fills stay the theme keys the engine maps to ansi", async ($, on) => {
    await sessionWithTheme($, on, "light-ansi");

    expect(await backgroundsOf(await mountUser($))).toContain(palette.userBand);
  });

  test("AT6 a theme changed to auto from the menu keeps the theme keys", async ($, on) => {
    const theme = { value: "light-ansi" };
    await sessionWithTheme($, on, theme);
    await $.config.set({ key: "theme", value: "auto" } as never);

    expect(await backgroundsOf(await mountUser($))).toContain(palette.userBand);
  });
});

async function sessionWithTheme($: Engine, on: On, theme: string | { value: string }) {
  const holder = typeof theme === "string" ? { value: theme } : theme;
  mock.env(on, { HOME: "/h/u" });
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("ui.render", { component: "ToolResult" }, ($ui, e) => {
    const { Text } = $ui.ui.resolve(e);
    return <Text>engine</Text>;
  });
  on("session.model", () => ({ value: "claude-opus-5-5" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: CWD }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("command.register", () => ({ value: {} }) as never);
  on("config.set", (_$, e) => {
    holder.value = String(e.value);
    return { value: e.value };
  });

  on("ui.open", () => ({ value: { isPlaced: true } }));
  on(
    "config.list",
    () =>
      ({
        value: [{ key: "theme", value: holder.value }],
      }) as never,
  );
  await $.session.start({ cwd: CWD, surface: "terminal", isInteractive: true });
}

function mountUser($: Engine) {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "UserMessage",
    props: { text: "hello there", origin: { kind: "composer" }, isExpanded: false },
    viewport: { columns: COLUMNS, rows: 24 },
  });
}

function mountReply($: Engine, text: string) {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "AssistantMessage",
    props: { text, isFirstOfReply: true },
    viewport: { columns: COLUMNS, rows: 24 },
  });
}

function mountDiff($: Engine) {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "ToolResult",
    props: {
      tool_use_id: "diff-1",
      tool: "Edit",
      isExpanded: true,
      isErrored: false,
      output: {
        filePath: `${CWD}/a.ts`,
        structuredPatch: [
          { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-old", "+new"] },
        ],
      },
    },
    viewport: { columns: COLUMNS, rows: 40 },
  });
}

function pathColourOf(header: Node): unknown {
  return collect(header, "Text").find((node) => textOf(node) === "a.ts")?.props?.color;
}

async function countColoursOf(ui: { drawn: () => Promise<unknown> }) {
  const texts = collect((await ui.drawn()) as Node, "Text");
  const colourOf = (text: string) => texts.find((node) => textOf(node) === text)?.props?.color;
  return { added: colourOf("+1"), removed: colourOf("-1") };
}

async function treeOf(ui: { drawn: () => Promise<unknown> }): Promise<Node> {
  return (await ui.drawn()) as Node;
}

async function colorsOf(ui: { drawn: () => Promise<unknown> }): Promise<unknown[]> {
  return allColors((await ui.drawn()) as Node);
}

function allColors(node: Node): unknown[] {
  const own = node.props?.color === undefined ? [] : [node.props.color];
  return [...own, ...childrenOf(node).flatMap(allColors)];
}

async function backgroundsOf(ui: { drawn: () => Promise<unknown> }): Promise<unknown[]> {
  return allBackgrounds((await ui.drawn()) as Node);
}

function allBackgrounds(node: Node): unknown[] {
  const own = node.props?.backgroundColor === undefined ? [] : [node.props.backgroundColor];
  return [...own, ...childrenOf(node).flatMap(allBackgrounds)];
}
