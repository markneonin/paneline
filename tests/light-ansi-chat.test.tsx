import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

import { ANSI_FILLS, contrastRatio, rgbOfColour } from "./contrast";
import type { Rgb } from "./contrast";
import { childrenOf, collect, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import { accentOf, ENGINE_DEFAULT_GREY } from "../hooks/session-color";
import { colouredPieces } from "./band-screen";

const FENCE = "```";
const CWD = "/Users/dev/app";
const TERMINAL_COLUMNS = 80;
const CONTRAST_RATIO = 3;
const BAR = "▌";
const BULLET = "•";
const PARAGRAPH = "A plain paragraph here.";
const CODE = fenced("ts", "const answer = 42");
const MIXED = `${PARAGRAPH}\n\n${CODE}`;
const LIST = `${PARAGRAPH}\n\n- apple\n- pear`;
const RED = accentOf("red");
const LIGHT_ANSI_BACKGROUNDS = ANSI_FILLS["light-ansi"] as readonly Rgb[];
const REPLY_AT = new Date(2026, 9, 28, 9, 5).getTime();
const RULE = "─";
const LONG_REPLY = "huge reply words ".repeat(4000);
const WIDE = 120;
const TOOL_CALL = {
  tool_use_id: "g1",
  tool: "Read",
  input: {},
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
};
const STATUS_THEMES = ["dark", "light", "dark-ansi", "light-daltonized", "dark-daltonized"];
const UNCHANGED: Record<string, (string | null)[]> = {
  dark: ["promptBorder", "userMessageBackground", "text"],
  light: ["promptBorder", "userMessageBackground", null],
  "dark-ansi": ["promptBorder", "userMessageBackground", null],
  "light-daltonized": ["promptBorder", "userMessageBackground", null],
  "dark-daltonized": ["promptBorder", "userMessageBackground", "text"],
};

describe("light-ansi chat reply colours", () => {
  test("A1 under light-ansi with no /color the code title bar is at least 3:1 against its band and the chat background", async ($, on) => {
    const holder = { value: "light-ansi" };
    registerWorld(on, holder);
    await startSession($);

    const tree = await drawnOf(await mountReply($, MIXED));

    expect(proseOf(tree)).toBeUndefined();
    const bar = barOf(tree);
    const accent = rgbOfColour("light-ansi", String(bar.props?.color));
    const band = rgbOfColour("light-ansi", String(bar.props?.backgroundColor));
    const weakest = Math.min(
      contrastRatio(accent, band),
      ...LIGHT_ANSI_BACKGROUNDS.map((background) => contrastRatio(accent, background)),
    );
    expect(weakest).toBeGreaterThanOrEqual(CONTRAST_RATIO);
  });

  test("A2 under light-ansi with no /color the reply bullets are at least 3:1 against the chat background", async ($, on) => {
    const holder = { value: "light-ansi" };
    registerWorld(on, holder);
    await startSession($);

    const tree = await drawnOf(await mountReply($, LIST));

    expect(proseOf(tree)).toBeUndefined();
    const bullet = collect(tree, "Text").find(
      (node) => childrenOf(node).length === 0 && textOf(node).includes(BULLET),
    );
    expect(bullet?.props?.color).toBeDefined();
    const ink = rgbOfColour("light-ansi", String(bullet?.props?.color));
    const weakest = Math.min(
      ...LIGHT_ANSI_BACKGROUNDS.map((background) => contrastRatio(ink, background)),
    );
    expect(weakest).toBeGreaterThanOrEqual(CONTRAST_RATIO);
  });

  test("A3 under light-ansi with /color red the code title bar stays red", async ($, on) => {
    const holder = { value: "light-ansi" };
    registerWorld(on, holder);
    mockSessionColor(on, "red");
    await startSession($);

    const tree = await drawnOf(await mountReply($, MIXED));

    expect(proseOf(tree)).toBeUndefined();
    expect(barOf(tree).props?.color).toBe(RED);
  });

  for (const [theme, expected] of Object.entries(UNCHANGED)) {
    test(`A4 under ${theme} the code title bar keeps its colour and band`, async ($, on) => {
      registerWorld(on, { value: theme });
      await startSession($);

      const tree = await drawnOf(await mountReply($, MIXED));

      expect([...barKeys(barOf(tree)), colourOf(proseOf(tree))]).toEqual(expected);
    });
  }
});

describe("light-ansi chat headers", () => {
  test("A5 under light-ansi with no /color the CLAUDE header title and rule are at least 3:1 against the chat background", async ($, on) => {
    registerWorld(on, { value: "light-ansi" });
    await startSession($);

    const tree = await drawnOf(await mountReply($, MIXED));

    expect(weakestContrast(headerColours(tree, "CLAUDE"))).toBeGreaterThanOrEqual(CONTRAST_RATIO);
  });

  test("A6 under light-ansi with /color red the CLAUDE header title and rule stay red", async ($, on) => {
    registerWorld(on, { value: "light-ansi" });
    mockSessionColor(on, "red");
    await startSession($);

    const tree = await drawnOf(await mountReply($, MIXED));

    expect(headerColours(tree, "CLAUDE")).toEqual([RED, RED]);
  });

  test("A7 under light-ansi with no /color the TOOL header title and rule are at least 3:1 against the chat background", async ($, on) => {
    registerWorld(on, { value: "light-ansi" });
    await startSession($);

    const tree = await drawnOf(await mountToolGroup($));

    expect(weakestContrast(headerColours(tree, "TOOL"))).toBeGreaterThanOrEqual(CONTRAST_RATIO);
  });

  test("A8 under light-ansi with /color red the TOOL header title and rule stay red", async ($, on) => {
    registerWorld(on, { value: "light-ansi" });
    mockSessionColor(on, "red");
    await startSession($);

    const tree = await drawnOf(await mountToolGroup($));

    expect(headerColours(tree, "TOOL")).toEqual([RED, RED]);
  });

  test("A9 under light-ansi with no /color the CLAUDE header of a very long reply is at least 3:1 against the chat background", async ($, on) => {
    registerWorld(on, { value: "light-ansi" });
    registerEngineReply(on);
    await startSession($);
    await appendReply($, "long-reply");

    const tree = await drawnOf(await mountLongReply($, "long-reply"));

    expect(weakestContrast(headerColours(tree, "CLAUDE"))).toBeGreaterThanOrEqual(CONTRAST_RATIO);
  });

  test("A10 under light-ansi with /color red the CLAUDE header of a very long reply stays red", async ($, on) => {
    registerWorld(on, { value: "light-ansi" });
    registerEngineReply(on);
    mockSessionColor(on, "red");
    await startSession($);
    await appendReply($, "long-reply");

    const tree = await drawnOf(await mountLongReply($, "long-reply"));

    expect(headerColours(tree, "CLAUDE")).toEqual([RED, RED]);
  });
});

describe("light-ansi status row above the prompt", () => {
  test("A11 under light-ansi with no /color the chips, path and meters are at least 3:1 against white and the grey fill", async ($, on) => {
    registerWorld(on, { value: "light-ansi" });
    await startSession($);
    await measureContext($);

    const colours = await statusColours($);

    expect(colours.length).toBeGreaterThan(0);
    expect(weakestContrast(colours)).toBeGreaterThanOrEqual(CONTRAST_RATIO);
  });

  test("A12 under light-ansi with /color red the status row stays red", async ($, on) => {
    registerWorld(on, { value: "light-ansi" });
    mockSessionColor(on, "red");
    await startSession($);
    await measureContext($);

    const colours = await statusColours($);

    expect(colours).toContain(RED);
  });

  for (const theme of STATUS_THEMES) {
    test(`A13 under ${theme} the status row keeps the grey default`, async ($, on) => {
      registerWorld(on, { value: theme });
      await startSession($);
      await measureContext($);

      const colours = await statusColours($);

      expect(new Set(colours)).toEqual(new Set([ENGINE_DEFAULT_GREY]));
    });
  }
});

function registerWorld(on: On, holder: { value: string }): void {
  const values = new Map<string, unknown>();
  on("store.get", (_$, e) => ({ value: values.get(e.key) }));
  on("store.set", (_$, e) => {
    values.set(e.key, e.value);
    return { value: undefined };
  });
  mock.env(on, { HOME: "/h/u" });
  mock.clock(on, { now: REPLY_AT });
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.id", () => ({ value: "light-ansi-chat-session" }));
  on("classic.SessionStart", () => ({}));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "claude-opus-5-5" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: CWD }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("command.register", () => ({ value: {} }) as never);
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("config.list", () => ({ value: [{ key: "theme", value: holder.value }] }) as never);
  on("ui.copy", () => ({ value: { isCopied: true } }) as never);
  on("ui.toast", () => ({ value: undefined }));
  on("ui.render", { component: "AbovePrompt" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>{""}</Text>;
  });
}

function mockSessionColor(on: On, colorName: string): void {
  on("state.get", (_$, e, next) =>
    e.key === "sessionColor" ? { value: { value: colorName, version: 1 } } : next(e),
  );
}

function startSession($: Engine) {
  return $.session.start({ cwd: CWD, surface: "terminal", isInteractive: true });
}

function mountReply($: Engine, text: string) {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "AssistantMessage",
    props: { text, isFirstOfReply: true },
    viewport: { columns: TERMINAL_COLUMNS, rows: 24 },
  });
}

function fenced(language: string, source: string): string {
  return [`${FENCE}${language}`, source, FENCE].join("\n");
}

async function drawnOf(ui: { drawn(): Promise<unknown> }): Promise<Node> {
  return (await ui.drawn()) as Node;
}

function leafTexts(tree: Node): Node[] {
  return collect(tree, "Text").filter((node) => childrenOf(node).length === 0);
}

function barOf(tree: Node): Node {
  return leafTexts(tree).find((node) => textOf(node) === BAR)!;
}

function proseOf(tree: Node): unknown {
  return leafTexts(tree).find((node) => textOf(node) === PARAGRAPH)?.props?.color;
}

function barKeys(bar: Node): string[] {
  return [String(bar.props?.color), String(bar.props?.backgroundColor)];
}

function colourOf(colour: unknown): string | null {
  return typeof colour === "string" ? colour : null;
}

function weakestContrast(colours: string[]): number {
  const backdrops = [...LIGHT_ANSI_BACKGROUNDS, [255, 255, 255]];
  return Math.min(
    ...colours.flatMap((colour) =>
      backdrops.map((backdrop) => contrastRatio(rgbOfColour("light-ansi", colour), backdrop)),
    ),
  );
}

function headerColours(tree: Node, label: string): string[] {
  const leaves = leafTexts(tree);
  const title = leaves.find((node) => textOf(node) === label);
  const rule = leaves.find((node) => textOf(node).trim().startsWith(RULE));
  return [String(title?.props?.color), String(rule?.props?.color)];
}

function mountToolGroup($: Engine) {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "ToolGroup",
    props: { calls: [TOOL_CALL], isActive: false, isExpanded: false },
    viewport: { columns: TERMINAL_COLUMNS, rows: 24 },
  });
}

function registerEngineReply(on: On): void {
  on("ui.render", { component: "AssistantMessage" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine reply row</Text>;
  });
}

function appendReply($: Engine, uuid: string) {
  return $.session.append({
    message: {
      type: "assistant",
      role: "assistant",
      content: [{ type: "text", text: LONG_REPLY }],
    },
    door: "response",
    origin: { kind: "model", model: "claude-opus-5-5" },
    uuid,
  });
}

function mountLongReply($: Engine, requestId: string) {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "AssistantMessage",
    props: { text: LONG_REPLY, isFirstOfReply: true },
    requestId,
    viewport: { columns: TERMINAL_COLUMNS, rows: 24 },
  });
}

function measureContext($: Engine) {
  return $.session.measure({
    context: { window: 200_000, tokens: 80_000, percent: 40 },
    rateLimits: [],
    changed: ["context", "rateLimits"],
  });
}

async function statusColours($: Engine): Promise<string[]> {
  const band = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "AbovePrompt",
    props: {
      hasSurvey: false,
      isCollapsed: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns: WIDE,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
    viewport: { columns: WIDE, rows: 40 },
  });
  return colouredPieces(await band.drawn())
    .filter(({ text }) => text.trim() !== "" && typeof text === "string")
    .map(({ color }) => String(color));
}
