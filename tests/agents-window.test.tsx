import { describe, expect, mock, test } from "claude-code/testing";
import type { AgentInfo, On } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import type { AgentNode } from "../types";
import { linesOf } from "./skills-tree";

type Pane = Mounted<"terminal", "Pane">;
type World = { seed: (agents: AgentNode[]) => void };

const NOW = 200_000;
const COLUMNS = 100;
const PANE_ROWS = 40;
const AGENT_COUNT = 40;
const FEW_COUNT = 3;
const MIXED_RUNNING = 10;
const CHILD_FIRST = 30;
const CHILD_COUNT = 6;
const MIDDLE_OFFSET = 60;
const RUNNING_LIST_ROWS = 163;
const BOTTOM_OFFSET = RUNNING_LIST_ROWS - PANE_ROWS;
const FINISHED_LIST_ROWS = 40;
const MIXED_LIST_ROWS = 53;
const BLANK_TAIL_ROWS = 4;
const SETTLE_TICKS = 5;
const MAIN_MODEL = "opus";
const CLEAR_LABEL = "clear";
const TAB_LABEL = "Agents";
const LAST_TITLE = "job 01";
const FAR_ABOVE_TITLE = "job 40";
const HIDDEN_DONE_LINE = "… 28 more done";
const MORE_DONE_WORD = "more done";

const TOP_SCREEN = [
  "Activity Files Agents Plan Context MCP Skills Spend",
  "",
  "main · opus",
  "│",
  "├ ● job 40",
  "│ general-purpose · sonnet",
  "│ 13s",
  "│",
  "├ ● job 39",
  "│ general-purpose · sonnet",
  "│ 13s",
  "│",
  "├ ● job 38",
  "│ general-purpose · sonnet",
  "│ 13s",
  "│",
  "├ ● job 37",
  "│ general-purpose · sonnet",
  "│ 13s",
  "│",
  "├ ● job 36",
  "│ general-purpose · sonnet",
  "│ 13s",
  "│",
  "├ ● job 35",
  "│ general-purpose · sonnet",
  "│ 12s",
  "│",
  "├ ● job 34",
  "│ general-purpose · sonnet",
  "│ 12s",
  "│",
  "├ ● job 33",
  "│ general-purpose · sonnet",
  "│ 12s",
  "│",
  "├ ● job 32",
  "│ general-purpose · sonnet",
  "│ 12s",
  "│",
];

const MIDDLE_SCREEN = [
  "├ ● job 26",
  "│ general-purpose · sonnet",
  "│ 12s",
  "│",
  "├ ● job 25",
  "│ general-purpose · sonnet",
  "│ 11s",
  "│",
  "├ ● job 24",
  "│ general-purpose · sonnet",
  "│ 11s",
  "│",
  "├ ● job 23",
  "│ general-purpose · sonnet",
  "│ 11s",
  "│",
  "├ ● job 22",
  "│ general-purpose · sonnet",
  "│ 11s",
  "│",
  "├ ● job 21",
  "│ general-purpose · sonnet",
  "│ 11s",
  "│",
  "├ ● job 20",
  "│ general-purpose · sonnet",
  "│ 11s",
  "│",
  "├ ● job 19",
  "│ general-purpose · sonnet",
  "│ 11s",
  "│",
  "├ ● job 18",
  "│ general-purpose · sonnet",
  "│ 11s",
  "│",
  "├ ● job 17",
  "│ general-purpose · sonnet",
  "│ 11s",
  "│",
];

const BOTTOM_SCREEN = [
  "│",
  "├ ● job 10",
  "│ general-purpose · sonnet",
  "│ 10s",
  "│",
  "├ ● job 09",
  "│ general-purpose · sonnet",
  "│ 10s",
  "│",
  "├ ● job 08",
  "│ general-purpose · sonnet",
  "│ 10s",
  "│",
  "├ ● job 07",
  "│ general-purpose · sonnet",
  "│ 10s",
  "│",
  "├ ● job 06",
  "│ general-purpose · sonnet",
  "│ 10s",
  "│",
  "├ ● job 05",
  "│ general-purpose · sonnet",
  "│ 9s",
  "│",
  "├ ● job 04",
  "│ general-purpose · sonnet",
  "│ 9s",
  "│",
  "├ ● job 03",
  "│ general-purpose · sonnet",
  "│ 9s",
  "│",
  "├ ● job 02",
  "│ general-purpose · sonnet",
  "│ 9s",
  "│",
  "└ ● job 01",
  "general-purpose · sonnet",
  "9s",
];

const FEW_SCREEN = [
  "Activity Files Agents Plan Context MCP Skills Spend",
  "",
  "main · opus",
  "│",
  "├ ● job 03",
  "│ general-purpose · sonnet",
  "│ 9s",
  "│",
  "├ ● job 02",
  "│ general-purpose · sonnet",
  "│ 9s",
  "│",
  "└ ● job 01",
  "general-purpose · sonnet",
  "9s",
  "⎇ feature/x · ../wt",
  "",
  "Spend",
  "▰▰▰▰▰▰ job 03 3.5k",
  "▰▰▰▰▱▱ job 02 2.5k",
  "▰▰▰▱▱▱ job 01 1.5k",
];

describe("agents window", () => {
  test("W1 with 40 running agents and the Agents tab at the top, the first 40 rows look exactly as they do today", async ($, on) => {
    const pane = await agentsPane($, worldOf(on), runningFleet(), 0);

    expect((await rowsOf(pane)).slice(0, PANE_ROWS)).toEqual(TOP_SCREEN);
  });

  test("W2 with 40 running agents at the top, the last agent is not drawn and the four rows where it would stand are blank", async ($, on) => {
    const pane = await agentsPane($, worldOf(on), runningFleet(), 0);

    const rows = await rowsOf(pane);
    expect(rows.some((text) => text.includes(LAST_TITLE))).toBe(false);
    expect(rows.slice(-BLANK_TAIL_ROWS)).toEqual(Array.from({ length: BLANK_TAIL_ROWS }, () => ""));
  });

  test("W3 with 40 running agents scrolled to row 60, the 40 rows from there look exactly as they do today", async ($, on) => {
    const pane = await agentsPane($, worldOf(on), runningFleet(), MIDDLE_OFFSET);

    expect((await rowsOf(pane)).slice(MIDDLE_OFFSET, MIDDLE_OFFSET + PANE_ROWS)).toEqual(
      MIDDLE_SCREEN,
    );
  });

  test("W4 with 40 running agents scrolled to the bottom, the last 40 rows look exactly as they do today", async ($, on) => {
    const pane = await agentsPane($, worldOf(on), runningFleet(), BOTTOM_OFFSET);

    expect((await rowsOf(pane)).slice(BOTTOM_OFFSET, BOTTOM_OFFSET + PANE_ROWS)).toEqual(
      BOTTOM_SCREEN,
    );
  });

  test("W5 with 40 running agents scrolled to row 60, the agents far above and far below the window are not drawn", async ($, on) => {
    const pane = await agentsPane($, worldOf(on), runningFleet(), MIDDLE_OFFSET);

    const rows = await rowsOf(pane);
    expect(rows.some((text) => text.includes(FAR_ABOVE_TITLE))).toBe(false);
    expect(rows.some((text) => text.includes(LAST_TITLE))).toBe(false);
  });

  test("W6 with 40 running agents the list is 163 rows tall, as it is today", async ($, on) => {
    const pane = await agentsPane($, worldOf(on), runningFleet(), 0);

    expect(await rowsOf(pane)).toHaveLength(RUNNING_LIST_ROWS);
  });

  test("W7 with 40 finished agents the list is 40 rows tall and says how many finished agents are hidden, as it does today", async ($, on) => {
    const pane = await agentsPane($, worldOf(on), finishedFleet(), 0);

    const rows = await rowsOf(pane);
    expect(rows).toHaveLength(FINISHED_LIST_ROWS);
    expect(rows).toContain(HIDDEN_DONE_LINE);
  });

  test("W8 with 40 agents of mixed state the list is 53 rows tall, as it is today", async ($, on) => {
    const pane = await agentsPane($, worldOf(on), mixedFleet(), 0);

    expect(await rowsOf(pane)).toHaveLength(MIXED_LIST_ROWS);
  });

  test("W9 with 3 agents, all of which fit, the whole tab looks exactly as it does today", async ($, on) => {
    const pane = await agentsPane($, worldOf(on), fewFleet(), 0);

    expect(await rowsOf(pane)).toEqual(FEW_SCREEN);
  });

  test("W10 with 40 running agents and one finished agent scrolled to row 60, pressing clear removes the hidden-done line and keeps the rows at row 60", async ($, on) => {
    const pane = await agentsPane(
      $,
      worldOf(on),
      [...runningFleet(), finishedOne()],
      MIDDLE_OFFSET,
    );
    expect((await rowsOf(pane)).some((text) => text.includes(MORE_DONE_WORD))).toBe(true);

    await pressClear(pane);

    const rows = await rowsOf(pane);
    expect(rows.some((text) => text.includes(MORE_DONE_WORD))).toBe(false);
    expect(rows.slice(MIDDLE_OFFSET, MIDDLE_OFFSET + PANE_ROWS)).toEqual(MIDDLE_SCREEN);
  });
});

function worldOf(on: On): World {
  const seeded = new Map<string, { value: unknown; version: number }>();
  mock.clock(on, { now: NOW });
  mock.env(on, { HOME: "/h/u" });
  on("state.get", (_$, e, next) => {
    const kept = seeded.get(e.key);
    return kept === undefined ? next(e) : { value: kept };
  });
  on("state.set", (_$, e, next) => {
    seeded.delete(e.key);
    return next(e);
  });
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: MAIN_MODEL }));
  on("session.cwd", () => ({ value: "/work" }));
  on("agent.list", () => ({ value: [] as unknown as AgentInfo[] }));
  on("ui.render", { component: "Pane" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine pane</Text>;
  });
  return {
    seed: (agents) => {
      seeded.set("agents", {
        value: Object.fromEntries(agents.map((one) => [one.id, one])),
        version: 1,
      });
    },
  };
}

async function agentsPane(
  $: Engine,
  world: World,
  agents: AgentNode[],
  offset: number,
): Promise<Pane> {
  world.seed(agents);
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
      scroll: { offset, bodyRows: PANE_ROWS },
      view: {},
    },
    viewport: { columns: COLUMNS, rows: PANE_ROWS },
  });
  const buttons = await pane.findAll({ type: "Button" });
  const tab = buttons.find((button) => button.props.label === TAB_LABEL);
  await pane.press({ key: tab?.key ?? "" });
  return pane;
}

async function pressClear(pane: Pane): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const clear = buttons.find((button) => button.props.label === CLEAR_LABEL);
  expect(clear, "a clear button").toBeDefined();
  await pane.press({ key: clear?.key ?? "" });
  for (let tick = 0; tick < SETTLE_TICKS; tick++) await pane.redraw();
}

async function rowsOf(pane: Pane): Promise<string[]> {
  return linesOf(await pane.drawn()).map((line) => line.text);
}

function titleOf(index: number): string {
  return `job ${String(index + 1).padStart(2, "0")}`;
}

function runningFleet(): AgentNode[] {
  return Array.from({ length: AGENT_COUNT }, (_, i) =>
    agent({
      id: `j${i}`,
      description: titleOf(i),
      status: "running",
      startedAt: NOW - 9_000 - i * 100,
    }),
  );
}

function finishedFleet(): AgentNode[] {
  return Array.from({ length: AGENT_COUNT }, (_, i) =>
    agent({
      id: `j${i}`,
      description: titleOf(i),
      status: "done",
      startedAt: NOW - 50_000,
      endedAt: NOW - 40_000 + i * 100,
    }),
  );
}

function mixedFleet(): AgentNode[] {
  return Array.from({ length: AGENT_COUNT }, (_, i) => mixedAgent(i));
}

function fewFleet(): AgentNode[] {
  return mixedFleet().slice(0, FEW_COUNT);
}

function mixedAgent(i: number): AgentNode {
  const id = `j${i}`;
  const description = titleOf(i);
  if (i < MIXED_RUNNING) {
    return agent({
      id,
      description,
      status: "running",
      startedAt: NOW - 9_000 - i * 100,
      tokensIn: (i + 1) * 1_000,
      tokensOut: 500,
      ...(i === 0 ? { branch: "feature/x", worktree: "../wt" } : {}),
    });
  }
  if (i >= CHILD_FIRST && i < CHILD_FIRST + CHILD_COUNT) {
    return agent({
      id,
      parentId: `j${i - CHILD_FIRST}`,
      description,
      status: "done",
      startedAt: NOW - 30_000 + i * 10,
      endedAt: NOW - 20_000 + i * 100,
    });
  }
  return agent({
    id,
    description,
    status: "done",
    startedAt: NOW - 50_000,
    endedAt: NOW - 40_000 + i * 100,
  });
}

function finishedOne(): AgentNode {
  return agent({
    id: "finished",
    description: "finished one",
    status: "done",
    startedAt: NOW - 50_000,
    endedAt: NOW - 40_000,
  });
}

function agent(fields: Partial<AgentNode> & { id: string }): AgentNode {
  return {
    type: "general-purpose",
    description: fields.id,
    background: false,
    model: "sonnet",
    status: "done",
    startedAt: NOW - 10_000,
    ctxTokens: 0,
    tokensIn: 0,
    tokensOut: 0,
    running: [],
    ...fields,
  };
}
