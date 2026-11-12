import { describe, expect, mock, test } from "claude-code/testing";
import type { ContextCategoryKind, On, SessionContextBreakdown } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { palette } from "../hooks/palette";
import { textOf } from "./draw-tree";
import { lines } from "./spend-world";

type Pane = Mounted<"terminal", "Pane">;
type AskAnswer = "compact" | "cancel" | "dismissed";
type Ask = { question: string; header: string | undefined; options: string[] };
type Sizes = { tokensBefore?: number; tokensAfter?: number };
type World = {
  compacts: number;
  asks: Ask[];
  answer: AskAnswer;
  used: number;
  sizes: Sizes;
  clock: ReturnType<typeof mock.clock>;
};

const START = Date.UTC(2026, 9, 6, 14, 2, 0);
const WINDOW = 200_000;
const USED_TOKENS = 48_000;
const COMPACTED_TOKENS = 12_000;
const COMPACTED_SIZE = "12k/200k tokens (6% of window)";
const THRESHOLD = 160_000;
const BREAKDOWN = {
  categories: [],
  totalTokens: USED_TOKENS,
  maxTokens: WINDOW,
  rawMaxTokens: WINDOW,
  percentage: 24,
  model: "Opus 5.5",
  gridRows: [],
  memoryFiles: [],
  mcpTools: [],
  agents: [],
  skills: { totalSkills: 0, includedSkills: 0, tokens: 0, skillFrontmatter: [] },
  autoCompactThreshold: THRESHOLD,
  isAutoCompactEnabled: true,
} as unknown as SessionContextBreakdown;

function breakdownAt(used: number): SessionContextBreakdown {
  return { ...BREAKDOWN, totalTokens: used, percentage: Math.round((used / WINDOW) * 100) };
}
const WORK = "/work";
const SESSION_ID = "session-one";
const MAIN_TURN = "main-turn";
const AGENT_TURN = "agent-turn";
const AGENT_ID = "agent-1";
const TURN_MS = 1_000;
const COLUMNS = 100;
const NARROW_COLUMNS = 60;
const WIDE_COLUMNS = 120;
const PANE_ROWS = 60;
const TAB_STEPS = 10;
const QUESTION = "Compact the conversation now?";
const COMPACT_LABEL = "compact";
const CANCEL_LABEL = "cancel";
const COMPACT_HEADER = "Compact";
const CONFIRM: Ask = {
  question: QUESTION,
  header: COMPACT_HEADER,
  options: [CANCEL_LABEL, COMPACT_LABEL],
};
const FIXED_CATEGORIES = (
  [
    { name: "System tools", tokens: 22_500, kind: "used" },
    { name: "System prompt", tokens: 5_200, kind: "used" },
    { name: "Memory files", tokens: 3_300, kind: "used" },
    { name: "Skills", tokens: 3_000, kind: "used" },
    { name: "Messages", tokens: 7_200, kind: "used" },
    { name: "Free space", tokens: 155_000, kind: "free" },
  ] satisfies { name: string; tokens: number; kind: ContextCategoryKind }[]
).map((category) => ({ ...category, color: "subtle", isDeferred: false }));
const FIRST_SIZES: Sizes = { tokensBefore: 44_144, tokensAfter: 5_560 };
const SECOND_SIZES: Sizes = { tokensBefore: 30_000, tokensAfter: 3_000 };
const FIVE_MINUTES_MS = 300_000;
const DURING_TEXT = "compact · turn running";

describe("context compact", () => {
  test("K1 between turns the Context pane shows [ compact ], during a main turn it is gone, and it comes back after the turn ends", async ($, on) => {
    const world = worldOf(on);
    await $.session.start({ cwd: WORK, surface: "terminal", isInteractive: true });
    const pane = await contextPane($);

    const idle = await compactButtons(pane);
    await $.turn.start({ text: "go", turnId: MAIN_TURN });
    const during = await compactButtons(pane);
    await completeMainTurn($, MAIN_TURN);
    const after = await compactButtons(pane);

    expect(idle).toHaveLength(1);
    expect(during).toHaveLength(0);
    expect(after).toHaveLength(1);
    expect(world.compacts).toBe(0);
  });

  test("K2 a subagent's turn start leaves [ compact ] shown", async ($, on) => {
    worldOf(on);
    await $.session.start({ cwd: WORK, surface: "terminal", isInteractive: true });
    const pane = await contextPane($);

    await $.turn.start({ text: "", turnId: AGENT_TURN, agentId: AGENT_ID });

    expect(await compactButtons(pane)).toHaveLength(1);
  });

  test("K3 pressing compact and confirming runs exactly one compaction", async ($, on) => {
    const world = worldOf(on, "compact");
    await $.session.start({ cwd: WORK, surface: "terminal", isInteractive: true });
    const pane = await contextPane($);

    await pressCompact(pane);

    expect(world.asks).toEqual([CONFIRM]);
    expect(world.compacts).toBe(1);
  });

  test("K4 pressing compact and choosing cancel runs no compaction", async ($, on) => {
    const world = worldOf(on, "cancel");
    await $.session.start({ cwd: WORK, surface: "terminal", isInteractive: true });
    const pane = await contextPane($);

    await pressCompact(pane);

    expect(world.asks).toEqual([CONFIRM]);
    expect(world.compacts).toBe(0);
  });

  test("K5 pressing compact and dismissing the question runs no compaction", async ($, on) => {
    const world = worldOf(on, "dismissed");
    await $.session.start({ cwd: WORK, surface: "terminal", isInteractive: true });
    const pane = await contextPane($);

    await pressCompact(pane);

    expect(world.asks).toEqual([CONFIRM]);
    expect(world.compacts).toBe(0);
  });

  test("K6 the compact row takes the place of a blank row, so every other row stays where it was", async ($, on) => {
    worldOf(on);
    await $.session.start({ cwd: WORK, surface: "terminal", isInteractive: true });
    const pane = await contextPane($);
    const idle = await rowTexts(pane);
    const idleButtons = await compactButtons(pane);

    await $.turn.start({ text: "go", turnId: MAIN_TURN });
    const during = await rowTexts(pane);

    expect(idleButtons).toHaveLength(1);
    expect(during).toEqual(idle);
  });

  test("K7 the compact row shows in a pane 60 columns wide", async ($, on) => {
    worldOf(on);
    await $.session.start({ cwd: WORK, surface: "terminal", isInteractive: true });

    expect(await compactButtons(await contextPane($, NARROW_COLUMNS))).toHaveLength(1);
  });

  test("K8 the compact row shows in a pane 120 columns wide", async ($, on) => {
    worldOf(on);
    await $.session.start({ cwd: WORK, surface: "terminal", isInteractive: true });

    expect(await compactButtons(await contextPane($, WIDE_COLUMNS))).toHaveLength(1);
  });

  test("K9 a finished compaction from the compact button shows the new size in the Context pane, with no measure event", async ($, on) => {
    const world = worldOf(on, "compact");
    await $.session.start({ cwd: WORK, surface: "terminal", isInteractive: true });
    const pane = await contextPane($);
    expect(await rowTexts(pane)).toContain("48k/200k tokens (24% of window)");

    await pressCompact(pane);

    expect(world.compacts).toBe(1);
    expect(await rowTexts(pane)).toContain(COMPACTED_SIZE);
  });

  test("K10 an engine compaction shows the new size in the Context pane, with no measure event", async ($, on) => {
    const world = worldOf(on);
    await $.session.start({ cwd: WORK, surface: "terminal", isInteractive: true });
    const pane = await contextPane($);
    world.used = COMPACTED_TOKENS;

    await $.classic.PostCompact({ trigger: "auto", compact_summary: "summary" });

    expect(await rowTexts(pane)).toContain(COMPACTED_SIZE);
  });

  test("K11 during a main turn the slot of [ compact ] shows muted text in the same row, with no button", async ($, on) => {
    worldOf(on);
    await $.session.start({ cwd: WORK, surface: "terminal", isInteractive: true });
    const pane = await contextPane($);
    const idleRow = (await lines(pane)).findIndex((line) => line.text.includes(COMPACT_LABEL));

    await $.turn.start({ text: "go", turnId: MAIN_TURN });
    const during = await lines(pane);
    const duringRow = during.findIndex((line) => line.text === DURING_TEXT);

    expect(duringRow).toBe(idleRow);
    expect(
      during[duringRow]?.parts.some(
        (part) => part.props?.color === palette.muted && textOf(part) === DURING_TEXT,
      ),
    ).toBe(true);
    expect(await compactButtons(pane)).toHaveLength(0);
  });
  test("K12 a compaction from 44.1k to a conversation of 5.6k, with 34k of fixed context, shows `44.1k → 39.6k` in Compactions", async ($, on) => {
    const world = worldOf(on, "compact");
    world.sizes = FIRST_SIZES;
    await $.session.start({ cwd: WORK, surface: "terminal", isInteractive: true });
    const pane = await contextPane($);

    await pressCompact(pane);

    expect(await compactionRows(pane)).toEqual([expect.stringContaining("44.1k → 39.6k")]);
  });

  test("K13 a compaction that reported no size after it shows `44.1k → ?` in Compactions", async ($, on) => {
    const world = worldOf(on, "compact");
    world.sizes = { tokensBefore: FIRST_SIZES.tokensBefore };
    await $.session.start({ cwd: WORK, surface: "terminal", isInteractive: true });
    const pane = await contextPane($);

    await pressCompact(pane);

    expect(await compactionRows(pane)).toEqual([expect.stringContaining("44.1k → ?")]);
  });

  test("K14 two compactions each add the same 34k of fixed context to their own conversation size", async ($, on) => {
    const world = worldOf(on, "compact");
    world.sizes = FIRST_SIZES;
    await $.session.start({ cwd: WORK, surface: "terminal", isInteractive: true });
    const pane = await contextPane($);
    await pressCompact(pane);
    world.sizes = SECOND_SIZES;
    await world.clock.advance(FIVE_MINUTES_MS);
    await pressCompact(pane);

    expect(await compactionRows(pane)).toEqual([
      expect.stringContaining("30k → 37k"),
      expect.stringContaining("44.1k → 39.6k"),
    ]);
  });
});

function worldOf(on: On, answer: AskAnswer = "cancel"): World {
  const world: World = {
    compacts: 0,
    asks: [],
    answer,
    used: USED_TOKENS,
    sizes: {},
    clock: mock.clock(on, { now: START }),
  };
  mock.env(on, { HOME: "/h/u" });
  mock.store(on);
  on("classic.SessionStart", () => ({}));
  on("classic.PostCompact", () => ({}));
  on("command.register", () => ({ value: {} }) as never);
  on("config.list", () => ({ value: [{ key: "theme", value: "dark" }] }) as never);
  on("turn.start", (_$, e) => ({ turnId: e.turnId }));
  on("turn.complete", (_$, e) => ({ text: e.answer }));
  on("session.id", () => ({ value: SESSION_ID }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("session.usage", (_$, e) => ({
    value: {
      startedAt: 0,
      context: {
        window: WINDOW,
        ...(e.breakdown === undefined
          ? {}
          : { breakdown: { ...breakdownAt(world.used), categories: FIXED_CATEGORIES } }),
      },
      rateLimits: [],
    },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: WORK }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.compact", () => {
    world.compacts += 1;
    world.used = COMPACTED_TOKENS;
    return { messages: [{ role: "user", text: "summary", toolUses: [] }], ...world.sizes };
  });
  on("tool.call", { tool: "AskUserQuestion" }, (_$, e) => {
    const questions = Reflect.get(e, "questions") as AskedQuestion[] | undefined;
    world.asks.push(askOf(questions?.[0]));
    return answerOf(world.answer);
  });
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", () => ({ value: true }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("process.run", () => ({ value: { exitCode: 1, stdout: "", stderr: "" } }) as never);
  return world;
}

type AskedQuestion = {
  question?: string;
  header?: string;
  options?: { label: string }[];
};

function askOf(asked: AskedQuestion | undefined): Ask {
  return {
    question: asked?.question ?? "",
    header: asked?.header,
    options: (asked?.options ?? []).map((option) => option.label),
  };
}

function answerOf(answer: AskAnswer): { result?: unknown; isError?: true; text?: string } {
  if (answer === "dismissed") return { isError: true, text: "dismissed", result: "dismissed" };
  return {
    result: { answers: { [QUESTION]: answer === "compact" ? COMPACT_LABEL : CANCEL_LABEL } },
  };
}

async function completeMainTurn($: Engine, turnId: string): Promise<void> {
  await $.turn.complete({
    answer: "",
    durationMs: TURN_MS,
    isAborted: false,
    turnId,
    reason: "answer",
  } as never);
}

async function contextPane($: Engine, columns: number = COLUMNS): Promise<Pane> {
  const pane = await mountPane($, columns);
  for (let step = 0; step < TAB_STEPS; step++) {
    const buttons = await pane.findAll({ type: "Button" });
    const context = buttons.find((button) => button.props.label === "Context");
    const next = buttons.find((button) => String(button.props.label).includes("›"));
    await pane.press({ key: (context ?? next)?.key ?? "" });
    if (context !== undefined) return pane;
  }
  throw new Error("Context tab not reached");
}

function mountPane($: Engine, columns: number): Promise<Pane> {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: "session",
    props: {
      title: "Session",
      isFocused: false,
      bodyColumns: columns,
      placement: "dock",
      scroll: { offset: 0, bodyRows: PANE_ROWS },
      view: {},
    },
    viewport: { columns, rows: PANE_ROWS },
  });
}

async function compactButtons(pane: Pane) {
  return (await pane.findAll({ type: "Button" })).filter(
    (button) => button.props.label === COMPACT_LABEL,
  );
}

async function pressCompact(pane: Pane): Promise<void> {
  const [button] = await compactButtons(pane);
  await pane.press({ key: button?.key ?? "" });
}

async function rowTexts(pane: Pane): Promise<string[]> {
  return (await lines(pane)).map((line) => (line.text.includes(COMPACT_LABEL) ? "" : line.text));
}

async function compactionRows(pane: Pane): Promise<string[]> {
  return (await lines(pane)).map((line) => line.text).filter((text) => text.includes("→"));
}
