import { describe, expect, mock, test } from "claude-code/testing";
import type { AgentInfo, ElementTable, On } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { agentsTab } from "../hooks/agents-draw";
import type { AgentNode, AgentTree } from "../types";
import { textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import { unpricedSpent, seedOf } from "./fixtures/agent-spend";
import { screenRows } from "./band-screen";
import type { Tokens } from "./spend-world";

declare const console: { log(line: string): void };

type Pane = Mounted<"terminal", "Pane">;
type Fixture = AgentNode & { spent?: Tokens };
type World = { seed: (agents: Fixture[]) => void };

const NOW = 200_000;
const COLUMNS = 120;
const PANE_ROWS = 40;
const AGENT_COUNT = 40;
const RUNNING_COUNT = 160;
const SCROLLED_AGENT = 6;
const SCROLL_ROWS = 12;
const BACK_LABEL = "back";
const TRANSCRIPT_PROMPT = "summarise the nightly export";
const FEW_COUNT = 3;
const MIXED_RUNNING = 10;
const CHILD_FIRST = 30;
const CHILD_COUNT = 6;
const MIDDLE_OFFSET = 60;
const RUNNING_LIST_ROWS = 166;
const BOTTOM_OFFSET = RUNNING_LIST_ROWS - PANE_ROWS;
const FINISHED_LIST_ROWS = 40;
const MIXED_LIST_ROWS = 40;
const BLANK_TAIL_ROWS = 4;
const HINT_ROWS = 2;
const SETTLE_TICKS = 5;
const MAIN_MODEL = "opus";
const CLEAR_LABEL = "clear";
const TAB_LABEL = "Agents";
const LAST_TITLE = "job 001";
const FAR_ABOVE_TITLE = "job 160";
const HIDDEN_DONE_LINE = " … 7 more done";
const MORE_DONE_WORD = "more done";
const NESTED_OFFSET = 18;

const NESTED_SCREEN = [
  " Activity   Files   Agents   Plan   Context   MCP   Skills   Spend   Setup   Shells   History   Review   Sessions",
  "",
  " Agents ─────────────────────────────────────────────────────────────────────────────────── 9 done · 4 running · clear",
  " tokens billed (cache reads included)",
  " ○ main · opus · idle",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  " ✓ done    mid lead       general-purpose · sonnet                                                 10s ▱▱▱▱▱▱▱▱▱▱      ▸",
  " ├─ ✓ done    mid child two  general-purpose · sonnet                                               5s ▱▱▱▱▱▱▱▱▱▱      ▸",
  " └─ ✓ done    mid child one  general-purpose · sonnet                                               4s ▱▱▱▱▱▱▱▱▱▱      ▸",
  " ✓ done    old lead       general-purpose · sonnet                                                 10s ▱▱▱▱▱▱▱▱▱▱      ▸",
  " ├─ ✓ done    old child b    general-purpose · sonnet                                               5s ▱▱▱▱▱▱▱▱▱▱      ▸",
  " └─ ✓ done    old child a    general-purpose · sonnet                                               4s ▱▱▱▱▱▱▱▱▱▱      ▸",
  "",
  " click an agent for prompt, tools and result",
];
const NESTED_SIXTY = 60;
const NESTED_FORTY = 40;
const FLAT_SIXTY = 60;
const PARENT_READS_PER_AGENT = 4;
const SWEEP_STEPS = 100;
const ROOT_GROUP = 6;
const PARENT_STEP = [0, 1, 2, 3, 2, 3];
const RUNNING_ROOT_EVERY = 3;
const FLAT_RUNNING_EVERY = 15;
const ELEMENTS = new Proxy({}, { get: (_, name) => String(name) }) as unknown as ElementTable;

const TOP_SCREEN = [
  " Activity   Files   Agents   Plan   Context   MCP   Skills   Spend   Setup   Shells   History   Review   Sessions",
  "",
  " Agents ─────────────────────────────────────────────────────────────────────────────────────────────────── 160 running",
  " ○ main · opus · idle",
  " ● running job 160  general-purpose · sonnet                                                            25s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 159  general-purpose · sonnet                                                            25s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 158  general-purpose · sonnet                                                            25s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 157  general-purpose · sonnet                                                            25s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 156  general-purpose · sonnet                                                            25s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 155  general-purpose · sonnet                                                            24s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 154  general-purpose · sonnet                                                            24s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 153  general-purpose · sonnet                                                            24s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 152  general-purpose · sonnet                                                            24s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 151  general-purpose · sonnet                                                            24s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 150  general-purpose · sonnet                                                            24s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 149  general-purpose · sonnet                                                            24s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 148  general-purpose · sonnet                                                            24s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 147  general-purpose · sonnet                                                            24s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 146  general-purpose · sonnet                                                            24s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 145  general-purpose · sonnet                                                            23s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 144  general-purpose · sonnet                                                            23s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 143  general-purpose · sonnet                                                            23s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 142  general-purpose · sonnet                                                            23s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 141  general-purpose · sonnet                                                            23s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 140  general-purpose · sonnet                                                            23s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 139  general-purpose · sonnet                                                            23s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 138  general-purpose · sonnet                                                            23s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 137  general-purpose · sonnet                                                            23s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 136  general-purpose · sonnet                                                            23s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 135  general-purpose · sonnet                                                            22s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 134  general-purpose · sonnet                                                            22s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 133  general-purpose · sonnet                                                            22s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 132  general-purpose · sonnet                                                            22s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 131  general-purpose · sonnet                                                            22s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 130  general-purpose · sonnet                                                            22s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 129  general-purpose · sonnet                                                            22s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 128  general-purpose · sonnet                                                            22s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 127  general-purpose · sonnet                                                            22s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 126  general-purpose · sonnet                                                            22s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 125  general-purpose · sonnet                                                            21s ▱▱▱▱▱▱▱▱▱▱ ▸",
];

const MIDDLE_SCREEN = [
  " ● running job 104  general-purpose · sonnet                                                            19s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 103  general-purpose · sonnet                                                            19s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 102  general-purpose · sonnet                                                            19s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 101  general-purpose · sonnet                                                            19s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 100  general-purpose · sonnet                                                            19s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 099  general-purpose · sonnet                                                            19s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 098  general-purpose · sonnet                                                            19s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 097  general-purpose · sonnet                                                            19s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 096  general-purpose · sonnet                                                            19s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 095  general-purpose · sonnet                                                            18s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 094  general-purpose · sonnet                                                            18s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 093  general-purpose · sonnet                                                            18s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 092  general-purpose · sonnet                                                            18s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 091  general-purpose · sonnet                                                            18s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 090  general-purpose · sonnet                                                            18s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 089  general-purpose · sonnet                                                            18s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 088  general-purpose · sonnet                                                            18s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 087  general-purpose · sonnet                                                            18s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 086  general-purpose · sonnet                                                            18s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 085  general-purpose · sonnet                                                            17s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 084  general-purpose · sonnet                                                            17s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 083  general-purpose · sonnet                                                            17s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 082  general-purpose · sonnet                                                            17s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 081  general-purpose · sonnet                                                            17s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 080  general-purpose · sonnet                                                            17s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 079  general-purpose · sonnet                                                            17s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 078  general-purpose · sonnet                                                            17s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 077  general-purpose · sonnet                                                            17s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 076  general-purpose · sonnet                                                            17s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 075  general-purpose · sonnet                                                            16s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 074  general-purpose · sonnet                                                            16s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 073  general-purpose · sonnet                                                            16s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 072  general-purpose · sonnet                                                            16s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 071  general-purpose · sonnet                                                            16s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 070  general-purpose · sonnet                                                            16s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 069  general-purpose · sonnet                                                            16s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 068  general-purpose · sonnet                                                            16s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 067  general-purpose · sonnet                                                            16s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 066  general-purpose · sonnet                                                            16s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 065  general-purpose · sonnet                                                            15s ▱▱▱▱▱▱▱▱▱▱ ▸",
];

const BOTTOM_SCREEN = [
  " ● running job 038  general-purpose · sonnet                                                            13s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 037  general-purpose · sonnet                                                            13s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 036  general-purpose · sonnet                                                            13s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 035  general-purpose · sonnet                                                            12s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 034  general-purpose · sonnet                                                            12s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 033  general-purpose · sonnet                                                            12s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 032  general-purpose · sonnet                                                            12s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 031  general-purpose · sonnet                                                            12s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 030  general-purpose · sonnet                                                            12s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 029  general-purpose · sonnet                                                            12s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 028  general-purpose · sonnet                                                            12s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 027  general-purpose · sonnet                                                            12s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 026  general-purpose · sonnet                                                            12s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 025  general-purpose · sonnet                                                            11s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 024  general-purpose · sonnet                                                            11s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 023  general-purpose · sonnet                                                            11s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 022  general-purpose · sonnet                                                            11s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 021  general-purpose · sonnet                                                            11s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 020  general-purpose · sonnet                                                            11s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 019  general-purpose · sonnet                                                            11s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 018  general-purpose · sonnet                                                            11s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 017  general-purpose · sonnet                                                            11s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 016  general-purpose · sonnet                                                            11s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 015  general-purpose · sonnet                                                            10s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 014  general-purpose · sonnet                                                            10s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 013  general-purpose · sonnet                                                            10s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 012  general-purpose · sonnet                                                            10s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 011  general-purpose · sonnet                                                            10s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 010  general-purpose · sonnet                                                            10s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 009  general-purpose · sonnet                                                            10s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 008  general-purpose · sonnet                                                            10s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 007  general-purpose · sonnet                                                            10s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 006  general-purpose · sonnet                                                            10s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 005  general-purpose · sonnet                                                             9s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 004  general-purpose · sonnet                                                             9s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 003  general-purpose · sonnet                                                             9s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 002  general-purpose · sonnet                                                             9s ▱▱▱▱▱▱▱▱▱▱ ▸",
  " ● running job 001  general-purpose · sonnet                                                             9s ▱▱▱▱▱▱▱▱▱▱ ▸",
  "",
  " click an agent for prompt, tools and result",
];

const FEW_SCREEN = [
  " Activity   Files   Agents   Plan   Context   MCP   Skills   Spend   Setup   Shells   History   Review   Sessions",
  "",
  " Agents ───────────────────────────────────────────────────────────────────────────────────────────────────── 3 running",
  " tokens billed (cache reads included)",
  " ○ main · opus · idle",
  " ● running job 003  general-purpose · sonnet                                                        9s ▰▰▰▰▰▱▱▱▱▱ 3.5k ▸",
  " ● running job 002  general-purpose · sonnet                                                        9s ▰▰▰▱▱▱▱▱▱▱ 2.5k ▸",
  " ● running job 001  general-purpose · sonnet                                                        9s ▰▰▱▱▱▱▱▱▱▱ 1.5k ▸",
  "    ⎇ feature/x · ../wt",
  "",
  " click an agent for prompt, tools and result",
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
    expect(rows.slice(-HINT_ROWS - BLANK_TAIL_ROWS, -HINT_ROWS)).toEqual(
      Array.from({ length: BLANK_TAIL_ROWS }, () => ""),
    );
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

  test("W11 with a nested fleet of running and finished agents scrolled to row 18, the rows look exactly as they do today", async ($, on) => {
    const pane = await agentsPane($, worldOf(on), nestedMixedFleet(), NESTED_OFFSET);

    expect(await rowsOf(pane)).toEqual(NESTED_SCREEN);
  });

  test("S3 a 60-agent nested fleet is drawn in one render that reads each agent's parent link at most four times", () => {
    const reads = { count: 0 };
    const agents = nestedFleet(NESTED_SIXTY).map((node) => withParentReads(node, reads));

    drawAgents(agents, 0);

    expect(reads.count).toBeLessThanOrEqual(PARENT_READS_PER_AGENT * NESTED_SIXTY);
  });

  test("S5 scrolling a 40-agent nested fleet and a 60-agent flat fleet up and down draws the same rows at each position", () => {
    const nested = sweepScroll(nestedFleet(NESTED_FORTY));
    const flat = sweepScroll(flatFleet(FLAT_SIXTY));

    console.log(reportOf("nested 40", nested.up));
    console.log(reportOf("flat 60", flat.up));
    expect(nested.back.map((step) => step.rows).reverse()).toEqual(
      nested.up.map((step) => step.rows),
    );
    expect(flat.back.map((step) => step.rows).reverse()).toEqual(flat.up.map((step) => step.rows));
  });

  test("K9 with 40 running agents, the Agents tab scrolled down to the middle draws the agent cards in view, not blank rows", async ($, on) => {
    on("ui.scroll", () => ({}));
    const pane = await agentsPane($, worldOf(on), runningFleet(), 0);
    await $.ui.scroll({
      component: "Pane",
      requestId: "session",
      offset: 0,
      by: MIDDLE_OFFSET,
      bodyRows: PANE_ROWS,
      contentRows: (await rowsOf(pane)).length,
      origin: { kind: "person" },
    });
    for (let tick = 0; tick < SETTLE_TICKS; tick++) await pane.redraw();

    expect(await rowsOf(pane)).toContain(MIDDLE_SCREEN[4]);
  });
});

describe("agent transcript scrolled", () => {
  test("A5 with the Agents list scrolled down by 12 rows, an agent opened shows its transcript from the top with back under the tab bar, and closing it shows the list at the place it was scrolled to", async ($, on) => {
    on("ui.scroll", () => ({}));
    on("session.messages", () => ({
      value: [{ role: "user", text: TRANSCRIPT_PROMPT, toolUses: [] }],
    }));
    const pane = await agentsPane($, worldOf(on), runningFleet(), 0);
    const top = await rowsOf(pane);
    await openAgentTranscript(pane, titleOf(RUNNING_COUNT - SCROLLED_AGENT));
    const freshTranscript = await rowsOf(pane);
    expect(freshTranscript.join("\n")).toContain(TRANSCRIPT_PROMPT);
    await pressBack(pane);
    expect(await rowsOf(pane)).toEqual(top);

    await $.ui.scroll({
      component: "Pane",
      requestId: "session",
      offset: 0,
      by: SCROLL_ROWS,
      bodyRows: PANE_ROWS,
      contentRows: top.length,
      origin: { kind: "person" },
    });
    await settle(pane);
    const scrolled = await rowsOf(pane);
    expect(scrolled).not.toEqual(top);
    await openAgentTranscript(pane, titleOf(RUNNING_COUNT - SCROLLED_AGENT));

    expect(await rowsOf(pane)).toEqual(freshTranscript);
    await pressBack(pane);
    expect(await rowsOf(pane)).toEqual(scrolled);
  });
});

async function openAgentTranscript(pane: Pane, title: string): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const target = buttons.find((button) => String(button.props.label).includes(title));
  expect(target, `a title button for ${title}`).toBeDefined();
  await pane.press({ key: target?.key ?? "" });
  await settle(pane);
}

async function pressBack(pane: Pane): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const back = buttons.find((button) => button.props.label === BACK_LABEL);
  expect(back, "a back button").toBeDefined();
  await pane.press({ key: back?.key ?? "" });
  await settle(pane);
}

async function settle(pane: Pane): Promise<void> {
  for (let tick = 0; tick < SETTLE_TICKS; tick++) await pane.redraw();
}

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
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: "/work" }));
  on("agent.list", () => ({ value: [] as unknown as AgentInfo[] }));
  on("ui.render", { component: "Pane" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine pane</Text>;
  });
  return {
    seed: (agents) => {
      const nodes = agents.map(({ spent: _spent, ...node }): AgentNode => node);
      seeded.set("agents", {
        value: Object.fromEntries(nodes.map((one) => [one.id, one])),
        version: 1,
      });
      const seed = seedOf(
        agents.flatMap(({ id, type, spent }) =>
          spent === undefined ? [] : [unpricedSpent(id, type, spent)],
        ),
      );
      if (seed.sessionUsd === 0) return;
      seeded.set("spend", { value: seed.spend, version: 1 });
      seeded.set("sessionUsd", { value: seed.sessionUsd, version: 1 });
    },
  };
}

async function agentsPane(
  $: Engine,
  world: World,
  agents: Fixture[],
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
  return screenRows(await pane.drawn(), COLUMNS).map((row) => row.trimEnd());
}

function titleOf(index: number): string {
  return `job ${String(index + 1).padStart(3, "0")}`;
}

function runningFleet(): Fixture[] {
  return Array.from({ length: RUNNING_COUNT }, (_, i) =>
    agent({
      id: `j${i}`,
      description: titleOf(i),
      status: "running",
      startedAt: NOW - 9_000 - i * 100,
    }),
  );
}

function finishedFleet(): Fixture[] {
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

function mixedFleet(): Fixture[] {
  return Array.from({ length: AGENT_COUNT }, (_, i) => mixedAgent(i));
}

function fewFleet(): Fixture[] {
  return mixedFleet().slice(0, FEW_COUNT);
}

function mixedAgent(i: number): Fixture {
  const id = `j${i}`;
  const description = titleOf(i);
  if (i < MIXED_RUNNING) {
    return agent({
      id,
      description,
      status: "running",
      startedAt: NOW - 9_000 - i * 100,
      spent: { input: (i + 1) * 1_000, output: 500 },
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

function agent(fields: Partial<AgentNode> & { id: string; spent?: Tokens }): Fixture {
  return {
    type: "general-purpose",
    description: fields.id,
    background: false,
    model: "sonnet",
    status: "done",
    startedAt: NOW - 10_000,
    ctxTokens: 0,
    running: [],
    ...fields,
  };
}

function nestedMixedFleet(): Fixture[] {
  return [
    agent({
      id: "lead1",
      description: "lead one",
      status: "running",
      startedAt: NOW - 9_000,
      spent: { input: 1_000, output: 500 },
    }),
    agent({
      id: "scan1",
      parentId: "lead1",
      description: "scan one",
      status: "running",
      startedAt: NOW - 8_000,
      spent: { input: 500, output: 500 },
    }),
    agent({
      id: "read1",
      parentId: "scan1",
      description: "read one",
      status: "running",
      startedAt: NOW - 7_000,
    }),
    agent({
      id: "test1",
      parentId: "lead1",
      description: "test one",
      startedAt: NOW - 6_500,
      endedAt: NOW - 6_000,
    }),
    agent({ id: "lead2", description: "lead two", status: "running", startedAt: NOW - 9_500 }),
    agent({
      id: "check2a",
      parentId: "lead2",
      description: "check two a",
      startedAt: NOW - 8_800,
      endedAt: NOW - 8_400,
    }),
    agent({
      id: "check2b",
      parentId: "lead2",
      description: "check two b",
      startedAt: NOW - 8_700,
      endedAt: NOW - 8_300,
    }),
    agent({ id: "mid", description: "mid lead", startedAt: NOW - 30_000, endedAt: NOW - 20_000 }),
    agent({
      id: "mid1",
      parentId: "mid",
      description: "mid child one",
      startedAt: NOW - 29_000,
      endedAt: NOW - 25_000,
    }),
    agent({
      id: "mid2",
      parentId: "mid",
      description: "mid child two",
      startedAt: NOW - 29_000,
      endedAt: NOW - 24_000,
    }),
    agent({ id: "old", description: "old lead", startedAt: NOW - 70_000, endedAt: NOW - 60_000 }),
    agent({
      id: "olda",
      parentId: "old",
      description: "old child a",
      startedAt: NOW - 69_000,
      endedAt: NOW - 65_000,
    }),
    agent({
      id: "oldb",
      parentId: "old",
      description: "old child b",
      startedAt: NOW - 69_000,
      endedAt: NOW - 64_000,
    }),
  ];
}

function nestedFleet(count: number): Fixture[] {
  return Array.from({ length: count }, (_, i) => nestedAgent(i));
}

function nestedAgent(i: number): Fixture {
  const slot = i % ROOT_GROUP;
  const id = `n${i}`;
  const description = titleOf(i);
  const parentId = slot === 0 ? undefined : `n${i - PARENT_STEP[slot]!}`;
  if (slot === 0 && Math.floor(i / ROOT_GROUP) % RUNNING_ROOT_EVERY === 0) {
    return agent({ id, description, status: "running", startedAt: NOW - 9_000 - i * 100 });
  }
  return agent({
    id,
    parentId,
    description,
    status: "done",
    startedAt: NOW - 50_000 + i * 100,
    endedAt: NOW - 40_000 + i * 100,
  });
}

function flatFleet(count: number): Fixture[] {
  return Array.from({ length: count }, (_, i) => {
    const id = `f${i}`;
    const description = titleOf(i);
    if (i % FLAT_RUNNING_EVERY === 0) {
      return agent({ id, description, status: "running", startedAt: NOW - 9_000 - i * 100 });
    }
    return agent({
      id,
      description,
      status: "done",
      startedAt: NOW - 50_000 + i * 100,
      endedAt: NOW - 40_000 + i * 100,
    });
  });
}

function withParentReads(node: AgentNode, reads: { count: number }): AgentNode {
  return new Proxy(node, {
    get(target, key: keyof AgentNode) {
      if (key === "parentId") reads.count += 1;
      return target[key];
    },
  });
}

function drawAgents(agents: AgentNode[], offset: number): Node {
  const tree: AgentTree = Object.fromEntries(agents.map((node) => [node.id, node]));
  return agentsTab(ELEMENTS, {
    agents: tree,
    model: MAIN_MODEL,
    main: undefined,
    mainTokens: 0,
    isMainRunning: false,
    split: {},
    now: NOW,
    width: COLUMNS,
    height: PANE_ROWS,
    offset,
    clear: () => undefined,
    openAgent: () => undefined,
  });
}

type Step = { offset: number; rows: string; ms: number };
type Sweep = { up: Step[]; back: Step[] };

function sweepScroll(agents: AgentNode[]): Sweep {
  const up = Array.from({ length: SWEEP_STEPS }, (_, offset) => timedDraw(agents, offset));
  const back = Array.from({ length: SWEEP_STEPS }, (_, i) =>
    timedDraw(agents, SWEEP_STEPS - 1 - i),
  );
  return { up, back };
}

function timedDraw(agents: AgentNode[], offset: number): Step {
  const started = performance.now();
  const rows = textOf(drawAgents(agents, offset));
  return { offset, rows, ms: performance.now() - started };
}

function reportOf(name: string, steps: Step[]): string {
  const total = steps.reduce((sum, step) => sum + step.ms, 0);
  const perStep = steps.map((step) => step.ms.toFixed(2)).join(" ");
  return `S5 ${name}: ${steps.length} redraws, total ${total.toFixed(1)} ms, ms per redraw: ${perStep}`;
}
