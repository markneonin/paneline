import { describe, expect, mock, test } from "claude-code/testing";
import type { On, SessionContextBreakdown } from "claude-code";
import type { MockClock } from "claude-code/testing";

import { collect, textOf } from "./draw-tree";
import { paneOnTab, settle, texts } from "./clear-world";
import type { Pane } from "./clear-world";

const NOW = 200_000;
const SLOW_MS = 3_000;
const FIRST_FRAME_BUDGET_MS = 100;
const WINDOW = 200_000;
const COMPACT_THRESHOLD = 160_000;
const WORK = "/work";
const SESSION_ID = "session-one";
const ACTIVITY = "Activity";
const FILES = "Files";
const CONTEXT = "Context";
const TAB_LABELS = [
  "Activity",
  "Files",
  "Agents",
  "Plan",
  "Context",
  "MCP",
  "Skills",
  "Spend",
  "Setup",
  "Shells",
  "History",
  "Review",
  "Sessions",
];
const SELECTED_TAB_TEXT = "clawd_background";
const CONTEXT_MARK = "tokens (";
const ACTIVITY_MARK = "no calls yet";
const FILES_EMPTY_TEXT = "no files touched yet · edits and reads show here";
const USED_BEFORE_TOKENS = 48_000;
const USED_AFTER_TOKENS = 12_000;
const OLD_CONTEXT_TEXT = "48k/200k tokens (24% of window)";
const NEW_CONTEXT_TEXT = "12k/200k tokens (6% of window)";
const CONTEXT_FAILURE = "the context breakdown cannot be read";

describe("tab click", () => {
  test("A1 on a slow session the pressed Context tab is selected within the budget, the old body stays under it, and the Context body shows once its data arrives", async ($, on) => {
    const { clock, bodyStarted } = worldOf(on, true);
    const pane = await paneOnTab($, ACTIVITY);
    const oldBody = await bodyTexts(pane);

    const pressed = pane.press({ key: await tabButtonKey(pane, CONTEXT) });
    await bodyStarted;
    await clock.advance(FIRST_FRAME_BUDGET_MS);

    expect(await selectedTabOf(pane)).toBe(CONTEXT);
    expect(await bodyTexts(pane)).toEqual(oldBody);

    await clock.advance(SLOW_MS);
    await pressed;
    await settle(pane);

    expect((await bodyTexts(pane)).join("\n")).toContain(CONTEXT_MARK);
  });

  test("A2 a Context press followed by a Files press before Context's data arrives selects Files at once, never draws the Context body, and then shows Files", async ($, on) => {
    const { clock, bodyStarted } = worldOf(on, true);
    const pane = await paneOnTab($, ACTIVITY);

    const pressedContext = pane.press({ key: await tabButtonKey(pane, CONTEXT) });
    await bodyStarted;
    await clock.advance(FIRST_FRAME_BUDGET_MS);
    expect(await selectedTabOf(pane)).toBe(CONTEXT);

    await pane.press({ key: await tabButtonKey(pane, FILES) });

    expect(await selectedTabOf(pane)).toBe(FILES);
    expect((await bodyTexts(pane)).join("\n")).toContain(FILES_EMPTY_TEXT);

    await clock.advance(SLOW_MS);
    await pressedContext;
    await settle(pane);

    expect(await selectedTabOf(pane)).toBe(FILES);
    expect((await bodyTexts(pane)).join("\n")).not.toContain(CONTEXT_MARK);
    expect((await bodyTexts(pane)).join("\n")).toContain(FILES_EMPTY_TEXT);
  });

  test("A3 on a fast session the first frame after pressing Context shows Context selected with the Context body under it", async ($, on) => {
    worldOf(on, false);
    const pane = await paneOnTab($, ACTIVITY);

    await pane.press({ key: await tabButtonKey(pane, CONTEXT) });

    expect(await selectedTabOf(pane)).toBe(CONTEXT);
    expect((await bodyTexts(pane)).join("\n")).toContain(CONTEXT_MARK);
  });

  test("A4 a Context press whose data is still slow, with the session's context size changing during the wait, ends showing the new size and not the old one", async ($, on) => {
    const world = worldOf(on, true);
    world.tokens.used = USED_BEFORE_TOKENS;
    const pane = await paneOnTab($, ACTIVITY);

    const pressed = pane.press({ key: await tabButtonKey(pane, CONTEXT) });
    await world.bodyStarted;
    await world.clock.advance(FIRST_FRAME_BUDGET_MS);

    world.tokens.used = USED_AFTER_TOKENS;
    void $.session.measure({ context: { window: WINDOW }, rateLimits: [], changed: ["context"] });
    await advanceInSteps(world.clock, SLOW_MS);
    await pressed;
    await settle(pane);

    expect((await bodyTexts(pane)).join("\n")).toContain(NEW_CONTEXT_TEXT);
    expect((await bodyTexts(pane)).join("\n")).not.toContain(OLD_CONTEXT_TEXT);
  });

  test("A5 a Context press whose data is slow and then fails leaves Activity selected once the wait is over, never Context", async ($, on) => {
    const world = worldOf(on, true, { failsBreakdown: true });
    const pane = await paneOnTab($, ACTIVITY);

    const pressed = pane.press({ key: await tabButtonKey(pane, CONTEXT) });
    await world.bodyStarted;
    await world.clock.advance(FIRST_FRAME_BUDGET_MS);
    await world.clock.advance(SLOW_MS);
    await pressed;

    expect(await selectedTabOf(pane)).toBe(CONTEXT);
    expect((await bodyTexts(pane)).join("\n")).toContain(CONTEXT_MARK);
    expect((await bodyTexts(pane)).join("\n")).not.toContain(ACTIVITY_MARK);
  });

  test("A6 a Context press whose data is slow, with the pane redrawn after the first 100 ms, shows Context selected in the frame after that redraw without more time passing", async ($, on) => {
    const world = worldOf(on, true);
    const pane = await paneOnTab($, ACTIVITY);

    const pressed = pane.press({ key: await tabButtonKey(pane, CONTEXT) });
    await world.bodyStarted;
    await world.clock.advance(FIRST_FRAME_BUDGET_MS);

    await pane.redraw();

    expect(await selectedTabOf(pane)).toBe(CONTEXT);
    await advanceInSteps(world.clock, SLOW_MS);
    await pressed;
  });
});

type World = { clock: MockClock; bodyStarted: Promise<void>; tokens: { used: number } };
type WorldOptions = { failsBreakdown?: boolean };

function worldOf(on: On, isBreakdownSlow: boolean, options: WorldOptions = {}): World {
  const clock = mock.clock(on, { now: NOW });
  let markBodyStarted: () => void = () => {};
  const bodyStarted = new Promise<void>((resolve) => {
    markBodyStarted = resolve;
  });
  const world: World = { clock, bodyStarted, tokens: { used: 0 } };
  let breakdownReads = 0;
  mock.env(on, { HOME: "/h/u" });
  const kept = new Map<string, unknown>();
  on("store.get", (_$, e) => ({ value: kept.get(e.key) }));
  on("store.set", (_$, e) => {
    kept.set(e.key, JSON.parse(JSON.stringify(e.value)));
    return { value: undefined };
  });
  on("session.id", () => ({ value: SESSION_ID }));
  on("session.repo", () => ({ value: null }));
  on("session.root", () => ({ value: WORK }));
  on("session.cwd", () => ({ value: WORK }));
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.model", () => ({ value: "opus" }));
  on("settings.read", () => ({ value: {} }));
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", () => ({ value: true }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.usage", async (_$, e) => {
    if (e.breakdown === undefined)
      return { value: { startedAt: 0, context: { window: WINDOW }, rateLimits: [] } };
    markBodyStarted();
    const used = world.tokens.used;
    const isThisReadSlow = isBreakdownSlow && breakdownReads === 0;
    breakdownReads += 1;
    if (isThisReadSlow) await clock.sleep(SLOW_MS);
    if (isThisReadSlow && options.failsBreakdown) throw new Error(CONTEXT_FAILURE);
    return {
      value: {
        startedAt: 0,
        context: { window: WINDOW, breakdown: breakdownAt(used) },
        rateLimits: [],
      },
    };
  });
  on("process.run", () => ({ value: { exitCode: 0, stdout: "", stderr: "" } }) as never);
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
    autoCompactThreshold: COMPACT_THRESHOLD,
    isAutoCompactEnabled: true,
  } as unknown as SessionContextBreakdown;
}

async function advanceInSteps(clock: MockClock, ms: number): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += FIRST_FRAME_BUDGET_MS)
    await clock.advance(FIRST_FRAME_BUDGET_MS);
}

async function tabButtonKey(pane: Pane, label: string): Promise<string> {
  const button = (await pane.findAll({ type: "Button" })).find(
    (candidate) => candidate.props.label === label,
  );
  expect(button, `a ${label} tab button`).toBeDefined();
  return button?.key ?? "";
}

async function bodyTexts(pane: Pane): Promise<string[]> {
  const [, ...body] = await texts(pane);
  return body;
}

async function selectedTabOf(pane: Pane): Promise<string | undefined> {
  const selected = collect(await pane.drawn(), "Text")
    .filter((text) => text.props?.color === SELECTED_TAB_TEXT)
    .map(textOf);
  return TAB_LABELS.find((label) => selected.includes(label));
}
