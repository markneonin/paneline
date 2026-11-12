import { describe, expect, mock, test } from "claude-code/testing";
import type { On, SessionContextBreakdown } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

type Pane = Mounted<"terminal", "Pane">;

const COLUMNS = 100;
const PANE_ROWS = 40;
const NOW = 200_000;
const BURST = 20;
const SETTLE_TICKS = 5;
const CONTEXT_TOKENS = 100_000;

describe("pane under a burst of measures", () => {
  test("B1 on the MCP tab a burst of context measures asks for no new breakdown", async ($, on) => {
    const world = worldOf(on);
    const pane = await paneOnTab($, "MCP");
    const askedBefore = world.breakdownCalls;

    for (let beat = 0; beat < BURST; beat++) await measureContext($, { percent: 40 + beat });
    for (let tick = 0; tick < SETTLE_TICKS; tick++) await pane.redraw();

    expect(world.breakdownCalls).toBe(askedBefore);
  });

  test("B2 a burst of measures with token counts asks for the compact threshold once", async ($, on) => {
    const world = worldOf(on);

    for (let beat = 0; beat < BURST; beat++)
      await measureContext($, { tokens: CONTEXT_TOKENS + beat });

    expect(world.breakdownCalls).toBe(1);
  });

  test("B3 measures arriving while a summary fetch is pending share that one fetch", async ($, on) => {
    const world = worldOf(on);
    world.holdBreakdown();

    const burst = Promise.all(
      Array.from({ length: BURST }, () => measureContext($, { tokens: CONTEXT_TOKENS })),
    );
    world.releaseBreakdown();
    await burst;

    expect(world.breakdownCalls).toBe(1);
  });
});

type World = {
  breakdownCalls: number;
  holdBreakdown: () => void;
  releaseBreakdown: () => void;
};

function worldOf(on: On): World {
  let release: () => void = () => {};
  let held: Promise<void> | null = null;
  const world: World = {
    breakdownCalls: 0,
    holdBreakdown: () => {
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    releaseBreakdown: () => release(),
  };
  mock.clock(on, { now: NOW });
  mock.env(on, { HOME: "/h/u" });
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", async (_$, e) => {
    if (e.breakdown !== undefined) {
      world.breakdownCalls++;
      await held;
    }
    const breakdown = {
      categories: [],
      totalTokens: 0,
      rawMaxTokens: 200_000,
      gridRows: [],
      memoryFiles: [],
      agents: [],
      mcpTools: [],
      autoCompactThreshold: 160_000,
    } as unknown as SessionContextBreakdown;
    const context =
      e.breakdown === undefined ? { window: 200_000 } : { window: 200_000, breakdown };
    return { value: { startedAt: 0, context, rateLimits: [] } };
  });
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.model", () => ({ value: "opus" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: "/work" }));
  on("ui.render", { component: "Pane" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine pane</Text>;
  });
  return world;
}

function measureContext($: Engine, fill: { tokens?: number; percent?: number }): Promise<unknown> {
  return $.session.measure({
    context: { window: 200_000, ...fill },
    rateLimits: [],
    changed: ["context"],
  });
}

function mountPane($: Engine): Promise<Pane> {
  return $.ui.mount({
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
}

async function paneOnTab($: Engine, label: string): Promise<Pane> {
  const pane = await mountPane($);
  await pressTab(pane, label);
  return pane;
}

async function pressTab(pane: Pane, label: string): Promise<void> {
  const target = (await pane.findAll({ type: "Button" })).find(
    (button) => button.props.label === label,
  );
  expect(target, `a ${label} button`).toBeDefined();
  await pane.press({ key: target?.key ?? "" });
}
