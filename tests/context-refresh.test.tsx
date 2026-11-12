import { describe, expect, mock, test } from "claude-code/testing";
import type { On, SessionContextBreakdown } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { lines } from "./spend-world";

type Pane = Mounted<"terminal", "Pane">;
type Gate = { opened: Promise<void>; open: () => void };
type World = {
  clock: ReturnType<typeof mock.clock>;
  isCompacting: boolean;
  isCompactResolved: boolean;
  oldFetchStarted: Gate;
  oldFetchMayFinish: Gate;
  compactDone: Gate;
};

const START = Date.UTC(2026, 9, 6, 14, 2, 0);
const WINDOW = 200_000;
const USED_TOKENS = 48_000;
const COMPACTED_TOKENS = 12_000;
const OLD_SIZE = "48k/200k tokens (24% of window)";
const NEW_SIZE = "12k/200k tokens (6% of window)";
const FEW_SECONDS_MS = 5_000;
const RENDER_MS = 100;
const WORK = "/work";
const COLUMNS = 100;
const PANE_ROWS = 60;
const TAB_STEPS = 10;
const QUESTION = "Compact the conversation now?";
const COMPACT_LABEL = "compact";
const COMPACTIONS_TITLE = "Compactions";
const SUMMARY = { role: "user" as const, text: "summary", toolUses: [] };

describe("context view after a compaction", () => {
  test("R1 after the compact button finishes, the Context pane shows the new size within a few seconds with no click", async ($, on) => {
    const world = worldOf($, on);
    await $.session.start({ cwd: WORK, surface: "terminal", isInteractive: true });
    const pane = await contextPane($);
    const before = await texts(pane);

    const pressing = pressCompact(pane);
    await world.compactDone.opened;
    world.oldFetchMayFinish.open();
    await pressing;
    await world.clock.advance(FEW_SECONDS_MS);

    expect(before).toContain(OLD_SIZE);
    expect(await texts(pane)).toContain(NEW_SIZE);
    expect(await texts(pane)).not.toContain(OLD_SIZE);
  });

  test("R2 after a typed /compact finishes, the Context pane shows the new size within a few seconds with no click", async ($, on) => {
    const world = worldOf($, on);
    await $.session.start({ cwd: WORK, surface: "terminal", isInteractive: true });
    const pane = await contextPane($);

    const compacting = $.session.compact({ trigger: "manual", messages: [SUMMARY] });
    const rendering = world.clock.advance(RENDER_MS);
    await world.compactDone.opened;
    const measuring = engineMeasuresContext($);
    world.oldFetchMayFinish.open();
    await rendering;
    await compacting;
    await measuring;
    await world.clock.advance(FEW_SECONDS_MS);

    expect(await texts(pane)).toContain(NEW_SIZE);
    expect(await texts(pane)).not.toContain(OLD_SIZE);
  });

  test("R3 one compaction from the compact button adds exactly one row to the Compactions list", async ($, on) => {
    const world = worldOf($, on);
    await $.session.start({ cwd: WORK, surface: "terminal", isInteractive: true });
    const pane = await contextPane($);

    const pressing = pressCompact(pane);
    await world.compactDone.opened;
    world.oldFetchMayFinish.open();
    await pressing;
    await world.clock.advance(FEW_SECONDS_MS);

    expect(await compactionRows(pane)).toEqual([expect.stringContaining("48k → 12k")]);
  });
});

function gate(): Gate {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

function worldOf($: Engine, on: On): World {
  const world: World = {
    clock: mock.clock(on, { now: START }),
    isCompacting: false,
    isCompactResolved: false,
    oldFetchStarted: gate(),
    oldFetchMayFinish: gate(),
    compactDone: gate(),
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
  on("session.usage", async (_$, e) => {
    const used = world.isCompactResolved ? COMPACTED_TOKENS : USED_TOKENS;
    if (world.isCompacting && !world.isCompactResolved) {
      world.oldFetchStarted.open();
      await world.oldFetchMayFinish.opened;
    }
    return {
      value: {
        startedAt: 0,
        context: {
          window: WINDOW,
          ...(e.breakdown === undefined ? {} : { breakdown: breakdownAt(used) }),
        },
        rateLimits: [],
      },
    };
  });
  on("settings.read", () => ({ value: {} }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: WORK }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.compact", async () => {
    world.isCompacting = true;
    await $.classic.PostCompact({ trigger: "manual", compact_summary: "summary" });
    await world.oldFetchStarted.opened;
    world.isCompactResolved = true;
    world.compactDone.open();
    return {
      messages: [SUMMARY],
      tokensBefore: USED_TOKENS,
      tokensAfter: COMPACTED_TOKENS,
    };
  });
  on("tool.call", { tool: "AskUserQuestion" }, () => ({
    result: { answers: { [QUESTION]: COMPACT_LABEL } },
  }));
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", () => ({ value: true }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("process.run", () => ({ value: { exitCode: 1, stdout: "", stderr: "" } }) as never);
  return world;
}

function breakdownAt(used: number): SessionContextBreakdown {
  return {
    categories: [],
    totalTokens: used,
    maxTokens: WINDOW,
    rawMaxTokens: WINDOW,
    percentage: Math.round((used / WINDOW) * 100),
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

async function pressCompact(pane: Pane): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const button = buttons.find((candidate) => candidate.props.label === COMPACT_LABEL);
  await pane.press({ key: button?.key ?? "" });
}

async function texts(pane: Pane): Promise<string[]> {
  return (await lines(pane)).map((line) => line.text);
}

async function compactionRows(pane: Pane): Promise<string[]> {
  const shown = await texts(pane);
  const start = shown.findIndex((text) => text.startsWith(COMPACTIONS_TITLE));
  if (start < 0) return [];
  const rest = shown.slice(start + 1);
  const end = rest.indexOf("");
  return end < 0 ? rest : rest.slice(0, end);
}
