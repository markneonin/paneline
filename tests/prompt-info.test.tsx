import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, MockClock } from "claude-code/testing";

import { ENGINE_DEFAULT_GREY } from "../hooks/session-color";

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] };
type Mounted = {
  drawn: () => Promise<unknown>;
  press: (target: { key: string }) => Promise<unknown>;
};
type World = { clock: MockClock; band: Mounted; commands: string[] };
type WorldOptions = { model?: string; cwd?: string; home?: string };
type BandOptions = { columns?: number };

const HOME = "/Users/dev";
const WORK_DIR = "/Users/dev/IT";
const MODEL = "claude-opus-5-5";
const ENGINE_ROW = "engine row";
const MODEL_CHIP_KEY = "model-chip";
const EFFORT_CHIP_KEY = "effort-chip";
const MODEL_COMMAND = "model";
const SESSION_START = { cwd: WORK_DIR, surface: "terminal", isInteractive: true } as const;

describe("the chips row", () => {
  test("C1 the last band row holds the three chips at the left, home as ~", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    await stopMainChat($, world, "high");

    const row = await lastRow(world);

    expect(rowText(row)).toBe(" opus 5.5  high  ~/IT ");
    expect(chipTexts(row)).toEqual([" opus 5.5 ", " high ", " ~/IT "]);
    expect(chipsPlainGrey(row)).toBe(true);
  });

  test("C2 before any effort is known there are two chips", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);

    expect(chipTexts(await lastRow(world))).toEqual([" opus 5.5 ", " ~/IT "]);
  });

  test("C3 a dated model drops the prefix and the date", async ($, on) => {
    const world = await worldOf($, on, { model: "claude-haiku-4-5-20251001" });
    await $.session.start(SESSION_START);

    expect(chipTexts(await lastRow(world))[0]).toBe(" haiku 4.5 ");
  });

  test("C4 the engine row stays above the chips", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);

    const children = ((await world.band.drawn()) as Drawn).children ?? [];

    expect(shownText(children.at(-2))).toBe(ENGINE_ROW);
  });

  test("C5 at 40 columns a long directory is cut to its last segments and the row fits", async ($, on) => {
    const tail = "a/very/long/path/that/never/fits/in/forty/columns/at/all";
    const world = await worldOf($, on, { cwd: `${HOME}/${tail}` }, { columns: 40 });
    await $.session.start(SESSION_START);

    const row = await lastRow(world);

    expect(rowText(row).length).toBeLessThanOrEqual(40);
    expect(rowText(row)).toContain("…");
    expect(rowText(row).trimEnd().endsWith("/at/all")).toBe(true);
  });

  test("C6 a directory that only starts like home keeps its full path", async ($, on) => {
    const world = await worldOf($, on, { cwd: "/Users/devops/app" });
    await $.session.start(SESSION_START);

    expect(chipTexts(await lastRow(world)).at(-1)).toBe(" /Users/devops/app ");
  });

  test("C7 switching the model changes the first chip", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);

    await $.classic.PostModelSwitch(modelSwitch(MODEL, "claude-haiku-4-5"));
    await world.clock.settle();

    expect(chipTexts(await lastRow(world))[0]).toBe(" haiku 4.5 ");
  });

  test("C8 a subagent turn ending with another effort leaves the main chat effort", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    await stopMainChat($, world, "high");

    await stopMainChat($, world, "low", "agent-1");

    expect(chipTexts(await lastRow(world))).toContain(" high ");
  });
  test("C9 pressing the model chip opens the model picker", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    await stopMainChat($, world, "high");

    await world.band.press({ key: MODEL_CHIP_KEY });

    expect(world.commands).toEqual([MODEL_COMMAND]);
  });

  test("C10 pressing the effort chip opens the model picker", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    await stopMainChat($, world, "high");

    await world.band.press({ key: EFFORT_CHIP_KEY });

    expect(world.commands).toEqual([MODEL_COMMAND]);
  });

  test("C11 the directory chip is not pressable", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    await stopMainChat($, world, "high");

    expect(pressableKeys(await lastRow(world))).toEqual([MODEL_CHIP_KEY, EFFORT_CHIP_KEY]);
  });
});

async function worldOf(
  $: Engine,
  on: On,
  options: WorldOptions = {},
  bandOptions: BandOptions = {},
): Promise<World> {
  const clock = mock.clock(on);
  const commands: string[] = [];
  mock.env(on, { HOME: options.home ?? HOME });
  const model = options.model ?? MODEL;
  const cwd = options.cwd ?? WORK_DIR;

  on("session.model", () => ({ value: model }));
  on("session.cwd", () => ({ value: cwd }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("command.register", () => ({ value: {} }) as never);
  on("command.run", { command: MODEL_COMMAND }, (_$, e) => {
    commands.push(e.command);
    return {};
  });
  on("classic.SessionStart", () => ({}));
  on("classic.UserPromptSubmit", () => ({}));
  on("classic.PostModelSwitch", () => ({}));
  on("classic.CwdChanged", () => ({}));
  on("classic.Stop", () => ({}));
  on("classic.PostToolUse", () => ({}));
  on("ui.render", { component: "AbovePrompt" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>{ENGINE_ROW}</Text>;
  });

  const columns = bandOptions.columns ?? 100;
  const band = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "AbovePrompt",
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns: columns,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
    viewport: { columns, rows: 40 },
  });

  return { clock, band, commands };
}

async function lastRow(world: World): Promise<Drawn> {
  const children = ((await world.band.drawn()) as Drawn).children ?? [];
  return children.at(-1) as Drawn;
}

function chipTexts(row: Drawn): string[] {
  return chipsOf(row).map((chip) =>
    chip.type === "Button" ? String(chip.props?.label) : shownText(chip),
  );
}

function rowText(row: Drawn): string {
  return chipTexts(row).join("");
}

function pressableKeys(row: Drawn): string[] {
  return chipsOf(row)
    .filter((chip) => chip.type === "Button")
    .map((chip) => String(chip.props?.key));
}

function chipsPlainGrey(row: Drawn): boolean {
  return chipsOf(row)
    .filter((chip) => chip.type !== "Button")
    .every(
      (chip) =>
        chip.props?.backgroundColor === undefined && chip.props?.color === ENGINE_DEFAULT_GREY,
    );
}

function chipsOf(node: unknown): Drawn[] {
  const drawn = node as Drawn;
  if (drawn.type === "Button" || drawn.props?.color !== undefined) return [drawn];
  return (drawn.children ?? []).flatMap((child) =>
    typeof child === "string" ? [] : chipsOf(child),
  );
}

async function stopMainChat(
  $: Engine,
  world: World,
  effort: string,
  agentId?: string,
): Promise<void> {
  await $.classic.Stop({
    stop_hook_active: false,
    effort: { level: effort },
    ...(agentId ? { agent_id: agentId } : {}),
  });
  await world.clock.settle();
}

function modelSwitch(
  from: string,
  to: string,
): Parameters<Engine["classic"]["PostModelSwitch"]>[0] {
  return {
    from_model: from,
    to_model: to,
    requested_model: to,
    source: "command",
    context_tokens: 0,
    prompt_cache_warm: false,
    cache_ttl: "5m",
    estimated_cache_write_usd: 0,
    pricing: "catalog",
  };
}

function shownText(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(shownText).join("");
  const children = (node as { children?: unknown[] } | undefined)?.children ?? [];
  return children.map(shownText).join("");
}
