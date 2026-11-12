import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

import { childrenOf, collect, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";

const FENCE = "```";
const CWD = "/Users/dev/app";
const TERMINAL_COLUMNS = 80;
const BAR = "▌";
const PARAGRAPH = "A plain paragraph here.";
const CODE = [`${FENCE}ts`, "const answer = 42", FENCE].join("\n");
const MIXED = `${PARAGRAPH}\n\n${CODE}`;
const REPLY_AT = new Date(2026, 9, 28, 9, 5).getTime();
const DARK_CODE_BAR = ["promptBorder", "userMessageBackground"];
const LIGHT_ANSI_CODE_BAR = ["clawd_background", "userMessageBackground"];

describe("reply colours after a theme switch", () => {
  test("A1 after a switch from dark to light-ansi the code title bar matches a fresh light-ansi session", async ($, on) => {
    const holder = { value: "dark" };
    registerWorld(on, holder);
    await startSession($);
    await drawnOf(await mountReply($, MIXED));

    await switchTheme($, holder, "light-ansi");
    const tree = await drawnOf(await mountReply($, MIXED));

    expect(barKeys(barOf(tree))).toEqual(LIGHT_ANSI_CODE_BAR);
  });

  test("A2 after a switch from light-ansi to dark the code title bar matches a fresh dark session", async ($, on) => {
    const holder = { value: "light-ansi" };
    registerWorld(on, holder);
    await startSession($);
    await drawnOf(await mountReply($, MIXED));

    await switchTheme($, holder, "dark");
    const tree = await drawnOf(await mountReply($, MIXED));

    expect(barKeys(barOf(tree))).toEqual(DARK_CODE_BAR);
  });

  test("A3 after a switch from dark to light-ansi the prose of the reply matches a fresh light-ansi session", async ($, on) => {
    const holder = { value: "dark" };
    registerWorld(on, holder);
    await startSession($);
    await drawnOf(await mountReply($, MIXED));

    await switchTheme($, holder, "light-ansi");
    const tree = await drawnOf(await mountReply($, MIXED));

    const prose = proseNodeOf(tree);
    expect(prose).toBeDefined();
    expect(prose?.props?.color).toBeUndefined();
  });

  test("A4 redrawing the same reply under the same theme keeps the code title bar colours", async ($, on) => {
    const holder = { value: "dark" };
    registerWorld(on, holder);
    await startSession($);
    const first = barKeys(barOf(await drawnOf(await mountReply($, MIXED))));

    const second = barKeys(barOf(await drawnOf(await mountReply($, MIXED))));

    expect(first).toEqual(DARK_CODE_BAR);
    expect(second).toEqual(first);
  });
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
  on("session.id", () => ({ value: "reply-theme-switch-session" }));
  on("classic.SessionStart", () => ({}));
  on("classic.ConfigChange", () => ({}));
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

function startSession($: Engine) {
  return $.session.start({ cwd: CWD, surface: "terminal", isInteractive: true });
}

async function switchTheme($: Engine, holder: { value: string }, theme: string): Promise<void> {
  holder.value = theme;
  await $.classic.ConfigChange({ source: "user_settings" } as never);
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

async function drawnOf(ui: { drawn(): Promise<unknown> }): Promise<Node> {
  return (await ui.drawn()) as Node;
}

function leafTexts(tree: Node): Node[] {
  return collect(tree, "Text").filter((node) => childrenOf(node).length === 0);
}

function barOf(tree: Node): Node {
  return leafTexts(tree).find((node) => textOf(node) === BAR)!;
}

function proseNodeOf(tree: Node): Node | undefined {
  return leafTexts(tree).find((node) => textOf(node) === PARAGRAPH);
}

function barKeys(bar: Node): string[] {
  return [String(bar.props?.color), String(bar.props?.backgroundColor)];
}
