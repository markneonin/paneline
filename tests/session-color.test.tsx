import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

import { ENGINE_DEFAULT_GREY, accentOf } from "../hooks/session-color";

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] };

const TRANSCRIPT = "/home/session.jsonl";
const SESSION_START = { cwd: "/work", surface: "terminal", isInteractive: true } as const;
const RED = accentOf("red");
const BLUE = accentOf("blue");
const DEFAULT_GREY = ENGINE_DEFAULT_GREY;
const TITLE_CHIP_TEXT = "clawd_background";

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
    expect(chipTextColors(row)).toEqual([DEFAULT_GREY]);
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
    expect(chipTextColors(await lastRow($))).toEqual([TITLE_CHIP_TEXT]);
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

function worldOf(on: On, initial: string[]): { entries: string[]; settle: () => Promise<void> } {
  const clock = mock.clock(on);
  const entries = [...initial];
  mock.env(on, { HOME: "/home" });
  on("session.model", () => ({ value: "claude-opus-5-5" }));
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
  return chips(row)
    .map((chip) => chip.props?.color)
    .filter((color) => color !== undefined);
}

function chips(node: Drawn): Drawn[] {
  if (node.props?.color !== undefined) return [node];
  const children = (node.children ?? []).filter(
    (child): child is Drawn => typeof child !== "string",
  );
  if (children.some((child) => child.type === "Button")) return [node];
  return children.flatMap(chips);
}

async function selectedTabPaint($: Engine): Promise<{ background: unknown; text: unknown }> {
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
  return { background: label?.props.backgroundColor, text: label?.props.color };
}
