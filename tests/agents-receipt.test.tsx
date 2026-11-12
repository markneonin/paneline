import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { paneInk } from "../hooks/pane-ink";
import { textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import { seedOf } from "./fixtures/agent-spend";
import { UNPRICED } from "./spend-world";
import { keyOf, linesOf, shownTexts } from "./skills-tree";

type Pane = Mounted<"terminal", "Pane">;
type Member = Record<string, unknown> & { id: string };

const NOW = 200_000;
const COLUMNS = 100;
const ROWS = 40;
const SETTLE_TICKS = 5;
const CLEAR_LABEL = "clear";
const SECOND = 1_000;
const STEP_TOKENS_IN = 100_000;
const STEP_TOKENS_OUT = 20_000;
const OLD_BATCH = "turn-1:0";
const ALONE_BATCH = "turn-1:7";
const NEW_BATCH = "turn-1:1";
const EARLIER = NOW - 60_000;
const LATER = NOW - 30_000;

describe("batch receipt", () => {
  test("R4 two subagents from one step, both finished, show one muted row under the batch cards with count, wall time, tokens and cost", async ($, on) => {
    worldOf(on);
    const first = member("a", OLD_BATCH, { startedAt: EARLIER, endedAt: EARLIER + 3 * SECOND });
    const second = member("b", OLD_BATCH, {
      startedAt: EARLIER + SECOND,
      endedAt: EARLIER + 5 * SECOND,
    });

    const shown = await agentsTexts($, [first, second]);

    const rowAt = shown.findIndex((text) => text.includes("batch · "));
    expect(shown[rowAt]).toMatch(/batch · 2 agents · 5s · 240k tokens · ~\$2\.00$/);
  });

  test("R11 the batch row shows its time and token numbers in the text colour and the word batch dim", async ($, on) => {
    worldOf(on);
    const first = member("a", OLD_BATCH, { startedAt: EARLIER, endedAt: EARLIER + 3 * SECOND });
    const second = member("b", OLD_BATCH, {
      startedAt: EARLIER + SECOND,
      endedAt: EARLIER + 5 * SECOND,
    });
    const pane = await paneOn($, [first, second]);

    const row = linesOf(await pane.drawn()).find((line) => line.text.includes("batch · "));

    const parts = row?.parts ?? [];
    expect(colourOfPart(parts, "5s")).toBe(paneInk().text);
    expect(colourOfPart(parts, "240k")).toBe(paneInk().text);
    expect(colourOfPart(parts, "batch")).toBe(paneInk().muted);
  });

  test("R10 with two batch cards and two other cards the batch row is the row right above the first batch card, not under main", async ($, on) => {
    worldOf(on);
    const batch = [member("first", OLD_BATCH), member("second", OLD_BATCH)];
    const others = [member("solo-one", ALONE_BATCH), member("solo-two", "turn-1:9")];

    const shown = await agentsTexts($, [...batch, ...others]);

    const rowAt = shown.findIndex((text) => text.includes("batch · 2 agents"));
    const cardAt = (name: string): number => shown.findIndex((text) => text.includes(name));
    expect(rowAt).toBe(Math.min(cardAt("first"), cardAt("second")) - 1);
    expect(rowAt).toBeGreaterThan(shown.findIndex((text) => /^[○●] main/.test(text)));
  });

  test("R5 a subagent started alone has no batch row of its own and is not counted in another batch", async ($, on) => {
    worldOf(on);
    const alone = member("a", ALONE_BATCH);
    const pair = [member("b", OLD_BATCH), member("c", OLD_BATCH)];

    const shown = await agentsTexts($, [alone, ...pair]);

    expect(batchRows(shown)).toEqual(["batch · 2 agents · 4s · 240k tokens · ~$2.00"]);
  });

  test("R6 a batch row appears only once the last of its running members has ended", async ($, on) => {
    worldOf(on);
    const first = member("a", OLD_BATCH);
    const last = member("b", OLD_BATCH, { status: "running", endedAt: undefined });
    const pane = await paneOn($, [first, last]);
    const whileRunning = batchRows(shownTexts(await pane.drawn()));

    seed("agents", { a: first, b: member("b", OLD_BATCH) });
    await settle(pane);

    expect(whileRunning).toEqual([]);
    expect(batchRows(shownTexts(await pane.drawn()))).toHaveLength(1);
  });

  test("R7 a newer finished batch of three replaces the row of the older batch", async ($, on) => {
    worldOf(on);
    const older = [member("a", OLD_BATCH), member("b", OLD_BATCH)];
    const newer = ["c", "d", "e"].map((id) =>
      member(id, NEW_BATCH, { startedAt: LATER, endedAt: LATER + 2 * SECOND }),
    );

    const shown = await agentsTexts($, [...older, ...newer]);

    expect(batchRows(shown)).toEqual(["batch · 3 agents · 2s · 360k tokens · ~$3.00"]);
  });

  test("R8 after clear the finished batch leaves no batch row", async ($, on) => {
    worldOf(on);
    const pane = await paneOn($, [member("a", OLD_BATCH), member("b", OLD_BATCH)]);
    const before = batchRows(shownTexts(await pane.drawn()));

    await pressClear(pane);

    expect(before).toHaveLength(1);
    expect(batchRows(shownTexts(await pane.drawn()))).toEqual([]);
  });

  test("R9 when a member has no known cost the batch row shows no dollar part", async ($, on) => {
    worldOf(on);

    const shown = await agentsTexts($, [
      member("a", OLD_BATCH),
      member("b", OLD_BATCH, { type: "other", model: UNPRICED }),
    ]);

    const [row] = batchRows(shown);
    expect(row).toMatch(/^batch · 2 agents · .+ · 240k tokens$/);
    expect(row).not.toContain("$");
  });
});

function member(id: string, batch: string, over: Record<string, unknown> = {}): Member {
  return {
    id,
    type: "general-purpose",
    description: id,
    background: false,
    model: "claude-opus-4-5",
    status: "done",
    startedAt: EARLIER,
    endedAt: EARLIER + 4 * SECOND,
    ctxTokens: 0,
    running: [],
    batch,
    ...over,
  };
}

function colourOfPart(parts: Node[], piece: string): unknown {
  return parts.find((part) => textOf(part).trim() === piece)?.props?.color;
}

function batchRows(shown: string[]): string[] {
  return shown
    .map((text) => text.replace(/^[^b]*/, ""))
    .filter((text) => text.startsWith("batch · "));
}

async function agentsTexts($: Engine, agents: Member[]): Promise<string[]> {
  const pane = await paneOn($, agents);
  return shownTexts(await pane.drawn());
}

async function paneOn($: Engine, agents: Member[]): Promise<Pane> {
  seed("agents", Object.fromEntries(agents.map((one) => [one.id, one])));
  seedSpend(agents);
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
      scroll: { offset: 0, bodyRows: ROWS },
      view: {},
    },
    viewport: { columns: COLUMNS, rows: ROWS },
  });
  const tab = (await pane.findAll({ type: "Button" })).find(
    (button) => button.props.label === "Agents",
  );
  expect(tab, "an Agents tab button").toBeDefined();
  await pane.press({ key: tab?.key ?? "" });
  await settle(pane);
  return pane;
}

function seedSpend(agents: Member[]): void {
  const { spend, sessionUsd } = seedOf(
    agents.map((one) => ({
      id: one.id,
      type: String(one.type),
      model: String(one.model),
      tokens: { input: STEP_TOKENS_IN, output: STEP_TOKENS_OUT },
    })),
  );
  seed("spend", spend);
  seed("sessionUsd", sessionUsd);
}

async function pressClear(pane: Pane): Promise<void> {
  const button = linesOf(await pane.drawn())
    .flatMap((line) => line.parts)
    .find((part) => part.type === "Button" && part.props?.label === CLEAR_LABEL);
  expect(button, `a "${CLEAR_LABEL}" button`).toBeDefined();
  if (button !== undefined) await pane.press({ key: keyOf(button) });
  await settle(pane);
}

async function settle(pane: Pane): Promise<void> {
  for (let tick = 0; tick < SETTLE_TICKS; tick++) await pane.redraw();
}

const store = new Map<string, { value: unknown; version: number }>();

function seed(key: string, value: unknown): void {
  store.set(key, { value, version: (store.get(key)?.version ?? 0) + 1 });
}

function worldOf(on: On): void {
  store.clear();
  mock.clock(on, { now: NOW });
  mock.env(on, { HOME: "/h/u" });
  on("state.get", (_$, e, next) => {
    const seeded = store.get(e.key);
    return seeded ? { value: seeded } : next(e);
  });
  on("state.set", (_$, e, next) => {
    store.delete(e.key);
    return next(e);
  });
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: "/work" }));
  on("agent.list", () => ({ value: [] }));
}
