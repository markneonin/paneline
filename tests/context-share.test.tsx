import { describe, expect, mock, test } from "claude-code/testing";
import type { ContextCategoryKind, On, SessionContextBreakdown } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { lines } from "./spend-world";

type Pane = Mounted<"terminal", "Pane">;
type World = {
  clock: ReturnType<typeof mock.clock>;
  fixedTokens: number;
  isBreakdownKnown: boolean;
  isTranscriptApplied: boolean;
  sizes: { tokensBefore?: number; tokensAfter?: number };
};

const START = Date.UTC(2026, 9, 6, 14, 2, 0);
const WINDOW = 200_000;
const OLD_TOTAL = 48_000;
const NEW_TOTAL = 12_000;
const OLD_SIZE = "48k/200k tokens (24% of window)";
const NEW_SIZE = "12k/200k tokens (6% of window)";
const MESSAGES_TOKENS = 7_200;
const FIXED_TOKENS = 34_000;
const CHANGED_FIXED_TOKENS = 36_000;
const SIZES = { tokensBefore: 44_144, tokensAfter: 5_560 };
const FULL_ROW = "44.1k → 39.6k";
const UNKNOWN_ROW = "44.1k → ?";
const FEW_SECONDS_MS = 5_000;
const RENDER_MS = 100;
const WORK = "/work";
const COLUMNS = 100;
const PANE_ROWS = 60;
const TAB_STEPS = 10;
const SUMMARY = { role: "user" as const, text: "summary", toolUses: [] };

describe("context size after a typed compaction", () => {
  test("J1 after a typed /compact the Context header shows the new total, not the old one", async ($, on) => {
    const world = worldOf(on);
    await $.session.start({ cwd: WORK, surface: "terminal", isInteractive: true });
    const pane = await contextPane($);

    await $.session.compact({ trigger: "manual", messages: [SUMMARY] });
    await world.clock.advance(RENDER_MS);
    world.isTranscriptApplied = true;
    await $.classic.SessionStart({ source: "compact" } as never);
    await world.clock.advance(FEW_SECONDS_MS);

    expect(await texts(pane)).toContain(NEW_SIZE);
    expect(await texts(pane)).not.toContain(OLD_SIZE);
  });

  test("J2 a recorded compaction keeps its after size when a later breakdown has a different fixed part", async ($, on) => {
    const world = worldOf(on);
    world.sizes = SIZES;
    await $.session.start({ cwd: WORK, surface: "terminal", isInteractive: true });
    const pane = await contextPane($);
    await $.session.compact({ trigger: "manual", messages: [SUMMARY] });
    await world.clock.advance(FEW_SECONDS_MS);
    const first = await compactionRows(pane);

    world.fixedTokens = CHANGED_FIXED_TOKENS;
    await engineMeasuresContext($);
    await world.clock.advance(FEW_SECONDS_MS);

    expect(first).toEqual([expect.stringContaining(FULL_ROW)]);
    expect(await compactionRows(pane)).toEqual([expect.stringContaining(FULL_ROW)]);
  });

  test("J3 a compaction recorded before any breakdown was known shows `?` as its after size", async ($, on) => {
    const world = worldOf(on);
    world.sizes = SIZES;
    world.isBreakdownKnown = false;
    await $.session.start({ cwd: WORK, surface: "terminal", isInteractive: true });
    await world.clock.advance(FEW_SECONDS_MS);
    await $.session.compact({ trigger: "manual", messages: [SUMMARY] });
    world.isBreakdownKnown = true;

    const pane = await contextPane($);

    expect(await compactionRows(pane)).toEqual([expect.stringContaining(UNKNOWN_ROW)]);
  });

  test("J4 a typed compaction with the Context tab never opened shows the after size on the full scale when the tab opens", async ($, on) => {
    const world = worldOf(on);
    world.sizes = SIZES;
    await $.session.start({ cwd: WORK, surface: "terminal", isInteractive: true });
    await world.clock.advance(FEW_SECONDS_MS);
    await $.session.compact({ trigger: "manual", messages: [SUMMARY] });
    world.fixedTokens = CHANGED_FIXED_TOKENS;

    const pane = await contextPane($);

    expect(await compactionRows(pane)).toEqual([expect.stringContaining(FULL_ROW)]);
  });
});

function worldOf(on: On): World {
  const world: World = {
    clock: mock.clock(on, { now: START }),
    fixedTokens: FIXED_TOKENS,
    isBreakdownKnown: true,
    isTranscriptApplied: false,
    sizes: {},
  };
  mock.env(on, { HOME: "/h/u" });
  mock.store(on);
  on("classic.SessionStart", () => ({}));
  on("classic.PostCompact", () => ({}));
  on("command.register", () => ({ value: {} }) as never);
  on("config.list", () => ({ value: [{ key: "theme", value: "dark" }] }) as never);
  on("turn.start", (_$, e) => ({ turnId: e.turnId }));
  on("turn.complete", (_$, e) => ({ text: e.answer }));
  on("session.id", () => ({ value: "session-one" }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("session.usage", (_$, e) => ({
    value: {
      startedAt: 0,
      context: {
        window: WINDOW,
        ...(e.breakdown === undefined || !world.isBreakdownKnown
          ? {}
          : { breakdown: breakdownOf(world) }),
      },
      rateLimits: [],
    },
  }));
  on("settings.read", () => ({ value: {} }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: WORK }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.compact", () => ({ messages: [SUMMARY], ...world.sizes }));
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", () => ({ value: true }));
  on("fs.write", () => ({ value: undefined }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("process.run", () => ({ value: { exitCode: 1, stdout: "", stderr: "" } }) as never);
  return world;
}

function breakdownOf(world: World): SessionContextBreakdown {
  const total = world.isTranscriptApplied ? NEW_TOTAL : OLD_TOTAL;
  const categories = (
    [
      { name: "System tools", tokens: world.fixedTokens, kind: "used" },
      { name: "Messages", tokens: MESSAGES_TOKENS, kind: "used" },
      { name: "Free space", tokens: WINDOW - total, kind: "free" },
    ] satisfies { name: string; tokens: number; kind: ContextCategoryKind }[]
  ).map((category) => ({ ...category, color: "subtle", isDeferred: false }));
  return {
    categories,
    totalTokens: total,
    maxTokens: WINDOW,
    rawMaxTokens: WINDOW,
    percentage: Math.round((total / WINDOW) * 100),
    model: "Opus 5.5",
    gridRows: [],
    memoryFiles: [],
    mcpTools: [],
    agents: [],
    skills: { totalSkills: 0, includedSkills: 0, tokens: 0, skillFrontmatter: [] },
    autoCompactThreshold: 160_000,
    isAutoCompactEnabled: true,
  } as unknown as SessionContextBreakdown;
}

async function contextPane($: Engine): Promise<Pane> {
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
  for (let step = 0; step < TAB_STEPS; step++) {
    const buttons = await pane.findAll({ type: "Button" });
    const context = buttons.find((button) => button.props.label === "Context");
    const next = buttons.find((button) => String(button.props.label).includes("›"));
    await pane.press({ key: (context ?? next)?.key ?? "" });
    if (context !== undefined) return pane;
  }
  throw new Error("Context tab not reached");
}

function engineMeasuresContext($: Engine): Promise<unknown> {
  return $.session.measure({ context: { window: WINDOW }, rateLimits: [], changed: ["context"] });
}

async function texts(pane: Pane): Promise<string[]> {
  return (await lines(pane)).map((line) => line.text);
}

async function compactionRows(pane: Pane): Promise<string[]> {
  return (await texts(pane)).filter((text) => text.includes("→"));
}
