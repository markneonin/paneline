import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

import { palette } from "../hooks/palette";
import { ENGINE_DEFAULT_GREY, accentOf } from "../hooks/session-color";
import { THEMES } from "./theme-rgb";
import { isHeavy } from "./weight";

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] };

const TRANSCRIPT = "/home/session.jsonl";
const SESSION_START = { cwd: "/work", surface: "terminal", isInteractive: true } as const;
const RED = accentOf("red");
const BLUE = accentOf("blue");
const DEFAULT_GREY = ENGINE_DEFAULT_GREY;
const TITLE_CHIP_TEXT = "clawd_background";
const PANE_FILL = palette.panel;
const CLAWD_BACKGROUND = "clawd_background";
const PROMPT_BORDER = "promptBorder";
const LIGHT_ANSI = "light-ansi";
const WCAG_AA_RATIO = 4.5;
const LUMINANCE_OFFSET = 0.05;
const CHANNEL_MAX = 255;
const SRGB_LINEAR_CUTOFF = 0.03928;
const SRGB_LINEAR_DIVISOR = 12.92;
const SRGB_OFFSET = 0.055;
const SRGB_SCALE = 1.055;
const SRGB_GAMMA = 2.4;
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;
const OTHER_THEMES = [
  "dark",
  "light",
  "dark-ansi",
  "auto",
  "dark-daltonized",
  "light-daltonized",
] as const;

describe("chips follow the session colour", () => {
  test("K1 the chips take the colour recorded in the transcript", async ($, on) => {
    const world = worldOf(on, ["red"]);
    await $.session.start(SESSION_START);
    await $.classic.Stop(stop());
    await world.settle();

    expect(chipBackgrounds(await lastRow($))).toEqual([RED, RED, RED]);
  });

  test("K1b a half-written last entry keeps the previous colour", async ($, on) => {
    const world = worldOf(on, ["red", '{"type":"agent-color","agentCo']);
    await $.session.start(SESSION_START);
    await $.classic.Stop(stop());
    await world.settle();

    expect(chipBackgrounds(await lastRow($))).toEqual([RED, RED, RED]);
  });

  test("K2 with no colour recorded the chips are plain grey text", async ($, on) => {
    const world = worldOf(on, []);
    await $.session.start(SESSION_START);
    await $.classic.Stop(stop());
    await world.settle();

    const row = await lastRow($);
    expect(chipBackgrounds(row)).toEqual([undefined, undefined, undefined]);
    expect(chipTextColors(row)).toEqual([DEFAULT_GREY, DEFAULT_GREY, DEFAULT_GREY]);
  });

  test("K3 a colour change shows on the chips at the next event", async ($, on) => {
    const world = worldOf(on, ["red"]);
    await $.session.start(SESSION_START);
    await $.classic.Stop(stop());
    await world.settle();

    world.entries.push("blue");
    await $.classic.Stop(stop());
    await world.settle();

    expect(chipBackgrounds(await lastRow($))[0]).toBe(BLUE);
  });

  test("K4 the last colour entry wins and default returns plain grey text", async ($, on) => {
    const world = worldOf(on, ["red", "default"]);
    await $.session.start(SESSION_START);
    await $.classic.Stop(stop());
    await world.settle();

    const row = await lastRow($);
    expect(chipBackgrounds(row)[0]).toBeUndefined();
    expect(chipTextColors(row)[0]).toBe(DEFAULT_GREY);
  });

  test("K5 chip text is the title chip text colour on red and still on yellow after a change", async ($, on) => {
    const world = worldOf(on, ["red"]);
    await $.session.start(SESSION_START);
    await $.classic.Stop(stop());
    await world.settle();

    world.entries.push("yellow");
    await $.classic.Stop(stop());
    await world.settle();
    expect(chipTextColors(await lastRow($))).toEqual([
      TITLE_CHIP_TEXT,
      TITLE_CHIP_TEXT,
      TITLE_CHIP_TEXT,
    ]);
  });

  test("K7 /color repaints the chips at once, without a prompt or a turn end", async ($, on) => {
    const world = worldOf(on, ["red"]);
    await $.session.start(SESSION_START);
    await $.classic.Stop(stop());
    await world.settle();

    world.entries.push("blue");
    await $.command.run({
      command: "color",
      args: "blue",
      origin: { kind: "composer" },
      presentation: { isFullscreen: false, columns: 100 },
    });
    await world.settle();

    expect(chipBackgrounds(await lastRow($))[0]).toBe(BLUE);
  });
});

describe("the pane tab follows the session colour", () => {
  for (const name of ["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"]) {
    test(`K8 under /color ${name} the selected tab is that accent with clawd_background text`, async ($, on) => {
      const world = worldOf(on, [name]);
      await $.session.start(SESSION_START);
      await $.classic.Stop(stop());
      await world.settle();

      expect(await selectedTabPaint($)).toEqual({
        background: accentOf(name),
        text: TITLE_CHIP_TEXT,
      });
    });
  }

  test("K9 with no colour the selected tab is the engine default grey with clawd_background text", async ($, on) => {
    const world = worldOf(on, []);
    await $.session.start(SESSION_START);
    await $.classic.Stop(stop());
    await world.settle();

    expect(await selectedTabPaint($)).toEqual({
      background: DEFAULT_GREY,
      text: TITLE_CHIP_TEXT,
    });
  });

  test("K10 on light-ansi with no colour the selected tab is an inverse block, white bold name on a black fill", async ($, on) => {
    const world = worldOf(on, [], LIGHT_ANSI);
    await $.session.start(SESSION_START);
    await $.classic.Stop(stop());
    await world.settle();

    expectInverseTab(await selectedTabLabel($));
  });

  test("K11 on light-ansi under /color red the selected tab is the red accent with bold black text", async ($, on) => {
    const world = worldOf(on, ["red"], LIGHT_ANSI);
    await $.session.start(SESSION_START);
    await $.classic.Stop(stop());
    await world.settle();

    const label = await selectedTabLabel($);
    expect(label?.backgroundColor).toBe(RED);
    expect(label?.color).toBe(TITLE_CHIP_TEXT);
    expect(isHeavy(label)).toBe(true);
  });

  for (const theme of OTHER_THEMES) {
    test(`K12 on ${theme} with no colour the selected tab keeps the engine default grey with bold clawd_background text`, async ($, on) => {
      const world = worldOf(on, [], theme);
      await $.session.start(SESSION_START);
      await $.classic.Stop(stop());
      await world.settle();

      const label = await selectedTabLabel($);
      expect(label?.backgroundColor).toBe(DEFAULT_GREY);
      expect(label?.color).toBe(TITLE_CHIP_TEXT);
      expect(isHeavy(label)).toBe(true);
    });
  }

  test("K13 on light-ansi after /color red then /color default the selected tab is an inverse block again", async ($, on) => {
    const world = worldOf(on, ["red", "default"], LIGHT_ANSI);
    await $.session.start(SESSION_START);
    await $.classic.Stop(stop());
    await world.settle();

    expectInverseTab(await selectedTabLabel($));
  });
});

describe("the side pane", () => {
  test("K6 the Pane root has no backgroundColor", async ($, on) => {
    worldOf(on, []);
    await $.session.start(SESSION_START);
    const pane = await $.ui.mount({
      plugin: "paneline",
      surface: "terminal",
      component: "Pane",
      requestId: "session",
      props: {
        title: "Session",
        isFocused: false,
        bodyColumns: 40,
        placement: "dock",
        scroll: { offset: 0, bodyRows: 40 },
        view: {},
      },
      viewport: { columns: 40, rows: 40 },
    });

    expect(((await pane.drawn()) as Drawn).props?.backgroundColor).toBeUndefined();
  });
});

function worldOf(
  on: On,
  initial: string[],
  theme = "dark",
): { entries: string[]; settle: () => Promise<void> } {
  const clock = mock.clock(on);
  const entries = [...initial];
  mock.env(on, { HOME: "/home" });
  on("config.list", () => ({ value: [{ key: "theme", value: theme }] }) as never);
  on("session.model", () => ({ value: "claude-opus-5-5" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: "/work" }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("command.register", () => ({ value: {} }) as never);
  on("agent.list", () => ({ value: [] }));
  on("classic.SessionStart", () => ({}));
  on("classic.UserPromptSubmit", () => ({}));
  on("classic.PostModelSwitch", () => ({}));
  on("classic.CwdChanged", () => ({}));
  on("classic.Stop", () => ({}));
  on("command.run", () => ({}));
  on("classic.PostToolUse", () => ({}));
  on("ui.render", { component: "AbovePrompt" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine row</Text>;
  });
  on(
    "process.run",
    () =>
      ({
        value: {
          exitCode: entries.length === 0 ? 1 : 0,
          stdout: entries
            .map((agentColor) =>
              agentColor.startsWith("{")
                ? `${agentColor}\n`
                : `{"type":"agent-color","agentColor":"${agentColor}","sessionId":"s"}\n`,
            )
            .join(""),
          stderr: "",
        },
      }) as never,
  );
  return { entries, settle: () => clock.settle() };
}

function stop(): Parameters<Engine["classic"]["Stop"]>[0] {
  return {
    stop_hook_active: false,
    effort: { level: "high" },
    transcript_path: TRANSCRIPT,
  };
}

async function lastRow($: Engine): Promise<Drawn> {
  const band = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "AbovePrompt",
    props: {
      hasSurvey: false,
      isCollapsed: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns: 100,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
    viewport: { columns: 100, rows: 40 },
  });
  const children = ((await band.drawn()) as Drawn).children ?? [];
  return children.at(-1) as Drawn;
}

function chipBackgrounds(row: Drawn): unknown[] {
  return chips(row).map((chip) => chip.props?.backgroundColor);
}

function chipTextColors(row: Drawn): unknown[] {
  return chips(row).map((chip) => chip.props?.color);
}

function chips(node: Drawn): Drawn[] {
  if (node.props?.color !== undefined) return [node];
  return (node.children ?? []).flatMap((child) =>
    typeof child === "string" ? [] : chips(child as Drawn),
  );
}

async function selectedTabPaint($: Engine): Promise<{ background: unknown; text: unknown }> {
  const label = await selectedTabLabel($);
  return { background: label?.backgroundColor, text: label?.color };
}

function expectInverseTab(label: Record<string, unknown> | undefined): void {
  expect({ fill: label?.backgroundColor, text: label?.color }).toEqual({
    fill: CLAWD_BACKGROUND,
    text: PROMPT_BORDER,
  });
  expect(isHeavy(label)).toBe(true);
  expect(themeRgb(LIGHT_ANSI, label?.backgroundColor)).not.toEqual(themeRgb(LIGHT_ANSI, PANE_FILL));
  expect(
    contrastRatio(themeRgb(LIGHT_ANSI, label?.color), themeRgb(LIGHT_ANSI, label?.backgroundColor)),
  ).toBeGreaterThanOrEqual(WCAG_AA_RATIO);
}

function contrastRatio(a: readonly number[], b: readonly number[]): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + LUMINANCE_OFFSET) / ((dark ?? 0) + LUMINANCE_OFFSET);
}

function luminance(rgb: readonly number[]): number {
  const [r = 0, g = 0, b = 0] = rgb.map((channel) => {
    const unit = channel / CHANNEL_MAX;
    return unit <= SRGB_LINEAR_CUTOFF
      ? unit / SRGB_LINEAR_DIVISOR
      : ((unit + SRGB_OFFSET) / SRGB_SCALE) ** SRGB_GAMMA;
  });
  return LUMA_R * r + LUMA_G * g + LUMA_B * b;
}

function themeRgb(theme: string, key: unknown): readonly number[] {
  const rgb = (THEMES as Record<string, Record<string, readonly number[]>>)[theme]?.[String(key)];
  if (rgb === undefined) throw new Error(`no RGB for ${String(key)} in ${theme}`);
  return rgb;
}

async function selectedTabLabel($: Engine): Promise<Record<string, unknown> | undefined> {
  const pane = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: "session",
    props: {
      title: "Session",
      isFocused: false,
      bodyColumns: 60,
      placement: "dock",
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
    viewport: { columns: 60, rows: 40 },
  });
  const [label] = await pane.findAll({ type: "Text", text: "Activity" });
  return label?.props;
}
