import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import type { AgentNode } from "../types";
import { formatTokens, shortModel, aboutDollars } from "../hooks/format";
import { paneInk } from "../hooks/pane-ink";
import {
  afterMainResponse,
  agentSplit,
  splitRows,
  TOKENS_BILLED_LABEL,
} from "../hooks/spend-model";
import { trackedUsd } from "../hooks/spend-model";
import { coloursOfText, screenRows } from "./band-screen";
import { textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import { PRICED_MODEL, OPUS_MODEL, pricedSpent, seedOf } from "./fixtures/agent-spend";
import { keyOf, linesOf } from "./skills-tree";
import type { Line } from "./skills-tree";
import { usageOf } from "./spend-world";

type Pane = Mounted<"terminal", "Pane">;
type Agent = AgentNode & { tokens?: number };
type Shown = { pane: Pane; split: ReturnType<typeof agentSplit>; cents: Map<string, number> };
type Setup = {
  agents: Agent[];
  columns?: number;
  rows?: number;
  isMainRunning?: boolean;
  mainTokens?: number;
};

const NOW = 200_000;
const WIDE = 120;
const NARROW = 60;
const ROWS = 40;
const SETTLE_TICKS = 5;
const SECOND = 1_000;
const SMALL_TOKENS = 2_000;
const BIG_TOKENS = 8_000;
const FIGURE_TOKENS = 14_300;
const MAIN_TOKENS = 50_000;
const HUGE_TOKENS = 300_000;
const TINY_TOKENS = 100;
const THIRD_A_TOKENS = 35_400;
const THIRD_B_TOKENS = 32_300;
const BAR_SHARE_BIG = 0.8;
const SHORT_PANE_ROWS = 24;
const BATCH = "turn-1:0";
const LONG_PATH = "/work/packages/server/src/deep/nested/folders/important-file-name.ts";
const CONNECTOR = /[├└│]/;
const LONG_TITLE = "Refactor the payment validation layer thoroughly";
const OTHER_LONG_TITLE = "Reorganize the checkout pipeline completely";
const HAIKU_MODEL = "claude-haiku-4-5";

describe("agents rows", () => {
  test("R1 at 120 columns a finished agent is one row: status, name, type, model, time, tokens, cost, arrow, no connector", async ($, on) => {
    worldOf(on);
    const { pane, split } = await shown($, {
      agents: [finished("alpha", { tokens: FIGURE_TOKENS })],
    });

    const row = rowIn(await screenLines(pane, WIDE), "alpha");

    expect(row?.text).toBeDefined();
    expect(
      inOrder(row?.text ?? "", [
        "done",
        "alpha",
        "Explore",
        shortModel(PRICED_MODEL),
        "7s",
        "14.3k",
        costOf(split, "alpha"),
        "▸",
      ]),
    ).toBe(true);
    expect(CONNECTOR.test(row?.text ?? "")).toBe(false);
  });

  test("R1b at 60 columns a finished agent is one row with its bar on the next line", async ($, on) => {
    worldOf(on);
    const { pane, split } = await shown($, {
      agents: [finished("alpha", { tokens: FIGURE_TOKENS })],
      columns: NARROW,
    });

    const lines = await screenLines(pane, NARROW);
    const at = lines.findIndex((line) => line.text.includes("alpha"));

    expect(at).toBeGreaterThanOrEqual(0);
    expect(
      inOrder(lines[at]?.text ?? "", [
        "alpha",
        "Explore",
        "7s",
        "14.3k",
        costOf(split, "alpha"),
        "▸",
      ]),
    ).toBe(true);
    expect(CONNECTOR.test(lines[at]?.text ?? "")).toBe(false);
    expect(lines[at + 1]?.text).toContain("▰");
  });

  test("R2 a child agent sits indented under its parent with a connector, the parent has none", async ($, on) => {
    worldOf(on);
    const parent = running("parent", { tokens: SMALL_TOKENS });
    const child = finished("child", { parentId: "parent", tokens: SMALL_TOKENS });
    const { pane } = await shown($, { agents: [parent, child] });

    const lines = await screenLines(pane, WIDE);
    const parentRow = rowIn(lines, "parent");
    const childRow = rowIn(lines, "child");

    expect(childRow?.text).toMatch(/[└├]─/);
    expect(childRow?.text.indexOf("child")).toBeGreaterThan(
      parentRow?.text.indexOf("parent") ?? Infinity,
    );
    expect(lines.indexOf(childRow as Line)).toBeGreaterThan(lines.indexOf(parentRow as Line));
    expect(parentRow?.text).not.toMatch(/[├└│─]/);
  });

  test("R3 while a turn runs the main row says working with its own tokens", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, {
      agents: [finished("alpha", { tokens: SMALL_TOKENS })],
      isMainRunning: true,
      mainTokens: MAIN_TOKENS,
    });

    const main = mainRowOf(await screenLines(pane, WIDE));

    expect(main?.text).toMatch(/\bworking\b/);
    expect(main?.text).toContain(formatTokens(MAIN_TOKENS));
  });

  test("R3b after the turn ends the main row says idle", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, {
      agents: [finished("alpha", { tokens: SMALL_TOKENS })],
      isMainRunning: false,
      mainTokens: MAIN_TOKENS,
    });

    const main = mainRowOf(await screenLines(pane, WIDE));

    expect(main?.text).toMatch(/\bidle\b/);
    expect(main?.text).not.toMatch(/\bworking\b/);
  });

  test("R4 the header line reads done count, running count and clear, and the main row has no clear", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, { agents: mixedAgents() });

    const lines = await screenLines(pane, WIDE);

    expect(headerOf(lines)?.text).toMatch(/2 done.*1 running.*clear$/);
    expect(mainRowOf(lines)?.text).not.toContain("clear");
  });

  test("R4b pressing the header clear removes the finished agents and keeps the running one", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, { agents: mixedAgents() });
    const clear = (await pane.findAll({ type: "Button" })).find(
      (button) => button.props.label === "clear",
    );

    expect(headerOf(await screenLines(pane, WIDE))?.text).toMatch(/clear$/);
    expect(clear, "a clear button").toBeDefined();
    await pane.press({ key: keyOf(clear) });
    await settle(pane);

    const names = (await screenLines(pane, WIDE)).map((line) => line.text);
    expect(names.some((text) => text.includes("done-one"))).toBe(false);
    expect(names.some((text) => text.includes("done-two"))).toBe(false);
    expect(names.some((text) => text.includes("busy"))).toBe(true);
  });

  test("R5 the press target is the whole row (name, cost and arrow) and pressing it opens the agent", async ($, on) => {
    worldOf(on);
    const { pane, split } = await shown($, {
      agents: [finished("alpha", { tokens: FIGURE_TOKENS })],
    });

    const target = (await pane.findAll({ type: "Button" })).find((button) =>
      buttonText(button).includes("alpha"),
    );
    expect(target).toBeDefined();
    expect(buttonText(target as Node)).toContain(costOf(split, "alpha"));
    expect(buttonText(target as Node)).toContain("▸");
    await pane.press({ key: keyOf(target) });
    await settle(pane);

    const labels = (await pane.findAll({ type: "Button" })).map((button) => button.props.label);
    expect(labels).toContain("back");
  });

  test("R6 at 120 columns each row's bar is filled by the agent's share of agent tokens and has no percent text", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, { agents: shareAgents() });

    const lines = await screenLines(pane, WIDE);
    const big = rowIn(lines, "big");
    const small = rowIn(lines, "small");

    const cells = countOf(big?.text, "▰") + countOf(big?.text, "▱");
    expect(cells).toBeGreaterThan(0);
    expect(countOf(big?.text, "▰")).toBe(Math.round(BAR_SHARE_BIG * cells));
    expect(countOf(small?.text, "▰")).toBe(Math.round((1 - BAR_SHARE_BIG) * cells));
    expect(big?.text).not.toContain("% of agent tokens");
  });

  test("R6b at 60 columns the bar line under the row reads its percent of agent tokens", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, { agents: shareAgents(), columns: NARROW });

    const lines = await screenLines(pane, NARROW);
    const big = lines.findIndex((line) => line.text.includes("big"));
    const small = lines.findIndex((line) => line.text.includes("small"));

    expect(big).toBeGreaterThanOrEqual(0);
    expect(lines[big + 1]?.text).toMatch(/▰.*80% of agent tokens/);
    expect(lines[small + 1]?.text).toMatch(/▰.*20% of agent tokens/);
  });

  test("R6c with four agents the heaviest row comes first", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, { agents: weightedAgents(["a", "b", "c", "d"]) });

    expect(namesInOrder(await screenLines(pane, WIDE), ["a", "b", "c", "d"])).toEqual([
      "b",
      "d",
      "c",
      "a",
    ]);
  });

  test("R6d with three agents the rows keep the usual order, newest finished first, even if the heaviest is not first", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, { agents: weightedAgents(["a", "b", "c"]) });

    expect(namesInOrder(await screenLines(pane, WIDE), ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  test("G3 a main row whose cost is under a cent reads <$0.01 like a card's", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, {
      agents: [finished("hugejob", { tokens: HUGE_TOKENS })],
      mainTokens: TINY_TOKENS,
    });

    const lines = await screenLines(pane, WIDE);

    expect(mainRowOf(lines)?.text).toContain("<$0.01");
    expect(rowIn(lines, "hugejob")?.text).not.toContain("<$0.01");
  });

  test("R7 every cost on the tab is the string Spend's formatter gives for that amount", async ($, on) => {
    worldOf(on);
    const { pane, split, cents } = await shown($, {
      agents: [
        finished("hugejob", { tokens: HUGE_TOKENS }),
        finished("tinyjob", { tokens: TINY_TOKENS }),
      ],
      mainTokens: MAIN_TOKENS,
    });
    const lines = await screenLines(pane, WIDE);

    const total = [...cents.values()].reduce((sum, one) => sum + one, 0);
    expect(rowIn(lines, "hugejob")?.text).toContain(
      aboutDollars((split.hugejob?.cents ?? 0) / 100),
    );
    expect(rowIn(lines, "tinyjob")?.text).toContain("<$0.01");
    expect(mainRowOf(lines)?.text).toContain(aboutDollars((cents.get("main") ?? 0) / 100));
    expect(headerOf(lines)?.text).toContain(aboutDollars(total / 100));
  });

  test("R8 a failed agent's state glyph is red, its name stays in the text colour, and a done agent's glyph is green", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, {
      agents: [finished("broken", { status: "failed" }), finished("fine")],
    });
    const tree = await pane.drawn();

    expect(coloursOfText(tree, "✗")).toEqual([paneInk().failed]);
    expect(coloursOfText(tree, "broken")).toEqual([paneInk().text]);
    expect(coloursOfText(tree, "✓")).toEqual([paneInk().ok]);
  });

  test("R9 the hint under the list reads click an agent for prompt, tools and result", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, { agents: [finished("alpha"), finished("beta")] });

    const lines = linesOf(await pane.drawn());
    const hint = lines.findIndex((line) =>
      /click an agent for (its )?prompt, tools and result/.test(line.text),
    );

    expect(hint).toBeGreaterThan(lines.findIndex((line) => line.text.includes("beta")));
  });

  test("D1 there is no separate Spend section below the cards", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, { agents: shareAgents() });

    const texts = linesOf(await pane.drawn()).map((line) => line.text);

    expect(texts.some((text) => text.startsWith("Spend"))).toBe(false);
  });

  test("R10 at 120 columns the tokens label is drawn once, above the rows, not on each row", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, { agents: batchAgents() });

    expect(await labelPlaces(pane)).toEqual({ count: 1, isAboveRows: true });
  });

  test("R10b at 60 columns the tokens label is drawn once, above the rows", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, { agents: batchAgents(), columns: NARROW });

    expect(await labelPlaces(pane)).toEqual({ count: 1, isAboveRows: true });
  });

  test("R10c the open agent view draws the tokens label once", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, { agents: [finished("alpha", { tokens: FIGURE_TOKENS })] });

    await openAgent(pane, "alpha");

    const texts = linesOf(await pane.drawn()).map((line) => line.text);
    expect(texts.filter((text) => text.includes(TOKENS_BILLED_LABEL))).toHaveLength(1);
  });

  test("B1 a batch of three cards says 3 agents and the amount is the formatter over the sum of the three card amounts", async ($, on) => {
    worldOf(on);
    const { pane, split } = await shown($, { agents: batchAgents() });

    const row = linesOf(await pane.drawn()).find((line) => line.text.includes("batch · "));

    const cards = ["b1", "b2", "b3"];
    const sum = cards.reduce((total, id) => total + (split[id]?.cents ?? 0), 0);
    expect(row?.text).toContain("batch · 3 agents");
    expect(row?.text.trimEnd().endsWith(aboutDollars(sum / 100))).toBe(true);
  });

  test("B2 when only some batch cards fit the pane the batch row counts exactly the cards drawn", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, {
      agents: interleavedAgents(),
      rows: SHORT_PANE_ROWS,
    });

    const lines = await screenLines(pane, WIDE);
    const drawn = ["b1", "b2", "b3"].filter((id) => rowIn(lines, id) !== undefined);

    const row = lines.find((line) => line.text.includes("batch · "));
    expect(drawn.length).toBeGreaterThan(0);
    expect(row?.text).toContain(`batch · ${drawn.length} agents`);
  });

  test("C1 at 60 columns a running agent's tool row keeps the file name whole", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, {
      agents: [
        running("scanner", {
          running: [{ callId: "c1", tool: "Read", target: LONG_PATH }],
        }),
      ],
      columns: NARROW,
    });

    const lines = await screenLines(pane, NARROW);

    expect(lines.some((line) => line.text.includes("important-file-name.ts"))).toBe(true);
  });

  test("C2 at 60 columns each agent that has a model shows it on its card, also when its title is long", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, {
      agents: [
        finished("sonnetjob", { description: LONG_TITLE, tokens: SMALL_TOKENS }),
        finished("haikujob", {
          description: OTHER_LONG_TITLE,
          model: HAIKU_MODEL,
          tokens: SMALL_TOKENS,
        }),
      ],
      columns: NARROW,
    });
    const lines = await screenLines(pane, NARROW);

    expect(cardText(lines, "Refactor")).toContain(shortModel(PRICED_MODEL));
    expect(cardText(lines, "Reorganize")).toContain(shortModel(HAIKU_MODEL));
  });

  test("C3 at 60 columns a running agent's type and elapsed time are on one row", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, {
      agents: [running("scanner", { startedAt: NOW - 12 * SECOND })],
      columns: NARROW,
    });

    const lines = await screenLines(pane, NARROW);

    expect(lines.some((line) => line.text.includes("Explore") && line.text.includes("12s"))).toBe(
      true,
    );
  });

  test("H1 the open agent's header shows the same duration, tokens and cost as its row in the list", async ($, on) => {
    worldOf(on);
    const { pane, split } = await shown($, {
      agents: [finished("alpha", { tokens: FIGURE_TOKENS })],
    });
    const row = rowIn(await screenLines(pane, WIDE), "alpha")?.text ?? "";

    await openAgent(pane, "alpha");

    const header =
      (await screenLines(pane, WIDE)).find((line) => line.text.includes("back"))?.text ?? "";
    for (const figure of ["7s", "14.3k", costOf(split, "alpha")]) {
      expect(row).toContain(figure);
      expect(header).toContain(figure);
    }
  });

  test("P1 a row's cost is in the text colour, its type muted, its bar fill the tool colour and its empty cells the meter colour", async ($, on) => {
    worldOf(on);
    const { pane, split } = await shown($, { agents: shareAgents() });
    const tree = await pane.drawn();

    expect(coloursOfText(tree, costOf(split, "small"))).toEqual([paneInk().text]);
    expect(coloursOfText(tree, "Explore")).toEqual([paneInk().muted]);
    expect(coloursOfText(tree, "▰")).toEqual([paneInk().tool]);
    expect(coloursOfText(tree, "▱")).toEqual([paneInk().meterEmpty]);
  });
});

describe("agents layout", () => {
  test("W1 at 60 columns a batch of three has its line above the cards at the card glyph column and one blank row after the last card", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, { agents: batchThenOther(), columns: NARROW });

    const grid = await screenGrid(pane, NARROW);

    expectBatchAboveCards(grid);
  });

  test("W1 at 120 columns a batch of three has its line above the cards at the card glyph column and one blank row after the last card", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, { agents: batchThenOther() });

    const grid = await screenGrid(pane, WIDE);

    expectBatchAboveCards(grid);
  });

  test("J1 at 60 columns one blank row sits between the main row and the batch line", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, { agents: batchAgents(), columns: NARROW });

    const grid = await screenGrid(pane, NARROW);

    expectBlankBetweenMainAndBatch(grid);
  });

  test("J1 at 120 columns one blank row sits between the main row and the batch line", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, { agents: batchAgents() });

    const grid = await screenGrid(pane, WIDE);

    expectBlankBetweenMainAndBatch(grid);
  });

  test("W2 at 60 columns the model starts at the same cell on rows whose names differ in length", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, { agents: readerAgents(), columns: NARROW });

    const lines = await screenLines(pane, NARROW);

    const model = shortModel(PRICED_MODEL);
    expect(rowIn(lines, "Reader\\s+one")?.text.indexOf(model)).toBeGreaterThan(0);
    expect(rowIn(lines, "Reader\\s+one")?.text.indexOf(model)).toBe(
      rowIn(lines, "Reader\\s+three")?.text.indexOf(model),
    );
  });

  test("W2 at 120 columns the type, the model and the bar start at the same cell on rows whose names differ in length", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, { agents: readerAgents() });

    const lines = await screenLines(pane, WIDE);

    const one = rowIn(lines, "Reader\\s+one")?.text ?? "";
    const three = rowIn(lines, "Reader\\s+three")?.text ?? "";
    expect(one.indexOf("Explore")).toBeGreaterThan(0);
    expect(one.indexOf("Explore")).toBe(three.indexOf("Explore"));
    expect(one.indexOf(shortModel(PRICED_MODEL))).toBe(three.indexOf(shortModel(PRICED_MODEL)));
    expect(one.indexOf("▰")).toBeGreaterThan(0);
    expect(one.indexOf("▰")).toBe(three.indexOf("▰"));
  });

  test("W3 at 60 columns shares of 35.4, 32.3 and 32.3 percent are drawn as numbers that add up to 100", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, {
      agents: [
        finished("first", { tokens: THIRD_A_TOKENS }),
        finished("second", { tokens: THIRD_B_TOKENS }),
        finished("third", { tokens: THIRD_B_TOKENS }),
      ],
      columns: NARROW,
    });

    const lines = await screenLines(pane, NARROW);

    const shares = lines.flatMap((line) => /(\d+)% of agent tokens/.exec(line.text)?.[1] ?? []);
    expect(shares).toHaveLength(3);
    expect(shares.reduce((sum, share) => sum + Number(share), 0)).toBe(100);
  });

  test("W4 with three done agents and none running the header has no running part", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, {
      agents: [finished("a"), finished("b"), finished("c")],
    });

    const header = (await screenLines(pane, WIDE)).find((line) => /\d+ done/.test(line.text));

    expect(header?.text).toContain("3 done");
    expect(header?.text).toMatch(/clear$/);
    expect(header?.text).not.toContain("running");
  });

  test("W4 with three running agents and none done the header has no done part", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, {
      agents: [running("a"), running("b"), running("c")],
    });

    const header = (await screenLines(pane, WIDE)).find((line) => /\d+ running/.test(line.text));

    expect(header?.text).toContain("3 running");
    expect(header?.text).not.toContain("done");
  });

  test("W5 an idle main row starts with the hollow circle in the muted colour", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, {
      agents: [finished("alpha")],
      isMainRunning: false,
      mainTokens: MAIN_TOKENS,
    });

    const main = mainRowOf(await screenLines(pane, WIDE));

    expect(main?.text.trimStart()).toMatch(/^○ main/);
    expect(coloursOfText(await pane.drawn(), "○ main")).toContain(paneInk().muted);
  });

  test("W5 a working main row starts with the filled circle in the ok colour", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, {
      agents: [finished("alpha")],
      isMainRunning: true,
      mainTokens: MAIN_TOKENS,
    });

    const main = mainRowOf(await screenLines(pane, WIDE));

    expect(main?.text.trimStart()).toMatch(/^● main/);
    expect(coloursOfText(await pane.drawn(), "● main")).toContain(paneInk().ok);
  });

  test("W6 after clear the main row is followed by one blank row and then no subagents yet", async ($, on) => {
    worldOf(on);
    const { pane } = await shown($, {
      agents: [finished("alpha")],
      mainTokens: MAIN_TOKENS,
    });
    const clear = (await pane.findAll({ type: "Button" })).find(
      (button) => button.props.label === "clear",
    );
    await pane.press({ key: keyOf(clear) });
    await settle(pane);

    const grid = await screenGrid(pane, WIDE);

    const main = grid.findIndex((row) => /(^|\s)main(\s|$)/.test(row));
    expect(main).toBeGreaterThanOrEqual(0);
    expect(grid[main + 1]).toBe("");
    expect(grid[main + 2]?.trim()).toBe("no subagents yet");
  });
});

function batchThenOther(): Agent[] {
  return [
    ...batchAgents(),
    finished("other", {
      type: "Plan",
      tokens: SMALL_TOKENS,
      startedAt: NOW - 200 * SECOND,
      endedAt: NOW - 190 * SECOND,
    }),
  ];
}

function expectBlankBetweenMainAndBatch(grid: string[]): void {
  const main = grid.findIndex((row) => /(^|\s)main(\s|$)/.test(row) && /[●○]/.test(row));
  expect(main).toBeGreaterThanOrEqual(0);
  expect(grid[main + 1]).toBe("");
  expect(grid[main + 2]).toContain("batch · 3 agents");
}

function readerAgents(): Agent[] {
  return [
    finished("Reader one", { tokens: SMALL_TOKENS }),
    finished("Reader three", { tokens: SMALL_TOKENS }),
  ];
}

function expectBatchAboveCards(grid: string[]): void {
  const batch = grid.findIndex((row) => row.includes("batch · "));
  const cards = ["b1", "b2", "b3"].map((id) =>
    grid.findIndex((row) => new RegExp(`(^|\\s)${id}(\\s|$)`).test(row) && /[●○✓✗]/.test(row)),
  );
  const other = grid.findIndex((row) => /(^|\s)other(\s|$)/.test(row) && /[●○✓✗]/.test(row));
  expect(batch).toBeGreaterThanOrEqual(0);
  expect(Math.max(batch, ...cards)).toBe(Math.max(...cards));
  expect(batch).toBeLessThan(Math.min(...cards));
  expect(cards.map((at) => grid[at]?.search(/[●○✓✗]/))).toEqual(
    cards.map(() => grid[batch]?.search(/\S/)),
  );
  expect(grid[other - 1]).toBe("");
  expect(grid[other - 2]).not.toBe("");
}

async function screenGrid(pane: Pane, columns: number): Promise<string[]> {
  return screenRows(await pane.drawn(), columns).map((row) => row.trimEnd());
}

function finished(id: string, over: Partial<Agent> = {}): Agent {
  return {
    id,
    type: "Explore",
    description: id,
    background: false,
    model: PRICED_MODEL,
    status: "done",
    startedAt: NOW - 60 * SECOND,
    endedAt: NOW - 53 * SECOND,
    ctxTokens: 0,
    running: [],
    ...over,
  };
}

function running(id: string, over: Partial<Agent> = {}): Agent {
  const { endedAt: _endedAt, ...base } = finished(id);
  return { ...base, status: "running", startedAt: NOW - 5 * SECOND, ...over };
}

function mixedAgents(): Agent[] {
  return [
    finished("done-one", { tokens: SMALL_TOKENS }),
    finished("done-two", { tokens: SMALL_TOKENS }),
    running("busy", { tokens: SMALL_TOKENS }),
  ];
}

function shareAgents(): Agent[] {
  return [
    finished("big", { type: "Explore", tokens: BIG_TOKENS }),
    finished("small", { type: "Explore", tokens: SMALL_TOKENS }),
  ];
}

function weightedAgents(ids: string[]): Agent[] {
  const tokens: Record<string, number> = { a: 1_000, b: 4_000, c: 2_000, d: 3_000 };
  return ids.map((id, i) =>
    finished(id, {
      tokens: tokens[id],
      endedAt: NOW - (i + 1) * 10 * SECOND,
      startedAt: NOW - (i + 1) * 10 * SECOND - 7 * SECOND,
    }),
  );
}

function batchAgents(): Agent[] {
  const tokens = [90_000, 41_000, 17_000];
  return ["b1", "b2", "b3"].map((id, i) =>
    finished(id, { batch: BATCH, type: `Kind${i}`, tokens: tokens[i] }),
  );
}

function interleavedAgents(): Agent[] {
  const endsAgo = { s1: 1, b1: 2, b2: 3, s2: 4, b3: 5, s3: 6 };
  return Object.entries(endsAgo).map(([id, ago], i) =>
    finished(id, {
      type: `Kind${i}`,
      tokens: SMALL_TOKENS,
      ...(id.startsWith("b") && { batch: BATCH }),
      startedAt: NOW - ago * SECOND - 7 * SECOND,
      endedAt: NOW - ago * SECOND,
    }),
  );
}

function namesInOrder(lines: Line[], names: string[]): string[] {
  return names
    .map((name) => ({ name, at: lines.findIndex((line) => isRow(line, name)) }))
    .sort((left, right) => left.at - right.at)
    .map(({ name }) => name);
}

function isRow(line: Line, name: string): boolean {
  return new RegExp(`(^|\\s)${name}(\\s|$)`).test(line.text) && /[●○✓✗]/.test(line.text);
}

function rowIn(lines: Line[], name: string): Line | undefined {
  return lines.find((line) => isRow(line, name));
}

function mainRowOf(lines: Line[]): Line | undefined {
  return lines.find((line) => /(^|\s)main(\s|$)/.test(line.text));
}

function headerOf(lines: Line[]): Line | undefined {
  return lines.find((line) => /\d+ (done|running)/.test(line.text));
}

function labelOf(button: Node): string {
  const label = button.props?.label;
  return typeof label === "string" ? label : "";
}

function buttonText(button: Node): string {
  return `${labelOf(button)} ${textOf(button)}`;
}

function cardText(lines: Line[], name: string): string {
  const start = lines.findIndex((line) => isRow(line, name));
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.text.trim() === "" || /^\S/.test(line.text));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))]
    .map((line) => line?.text ?? "")
    .join("\n");
}

function countOf(text: string | undefined, glyph: string): number {
  return (text ?? "").split(glyph).length - 1;
}

function inOrder(text: string, pieces: string[]): boolean {
  let from = 0;
  for (const piece of pieces) {
    const at = text.indexOf(piece, from);
    if (at === -1) return false;
    from = at + piece.length;
  }
  return true;
}

function costOf(split: Shown["split"], id: string): string {
  const cents = split[id]?.cents ?? 0;
  return cents === 0 ? "<$0.01" : aboutDollars(cents / 100);
}

async function labelPlaces(pane: Pane): Promise<{ count: number; isAboveRows: boolean }> {
  const lines = await screenLines(pane, WIDE);
  const holding = lines.filter((line) => line.text.includes(TOKENS_BILLED_LABEL));
  const firstRow = lines.findIndex((line) => isRow(line, "b1"));
  return {
    count: holding.length,
    isAboveRows: holding.every((line) => lines.indexOf(line) < firstRow),
  };
}

async function screenLines(pane: Pane, columns: number): Promise<Line[]> {
  return screenRows(await pane.drawn(), columns)
    .map((text) => ({ text: text.trimEnd(), indent: 0, parts: [] }))
    .filter((line) => line.text !== "");
}

async function openAgent(pane: Pane, name: string): Promise<void> {
  const target = (await pane.findAll({ type: "Button" })).find((button) =>
    buttonText(button).includes(name),
  );
  expect(target, `a press target for ${name}`).toBeDefined();
  await pane.press({ key: keyOf(target) });
  await settle(pane);
}

async function shown($: Engine, setup: Setup): Promise<Shown> {
  const columns = setup.columns ?? WIDE;
  const spent = setup.agents.flatMap((one) =>
    one.tokens === undefined ? [] : [pricedSpent(one.id, one.type, { input: one.tokens })],
  );
  const base = seedOf(spent).spend;
  const spend =
    setup.mainTokens === undefined
      ? base
      : afterMainResponse(base, usageOf(OPUS_MODEL, { input: setup.mainTokens }), "5m");
  const sessionUsd = trackedUsd(spend);
  seed("agents", Object.fromEntries(setup.agents.map((one) => [one.id, withoutTokens(one)])));
  seed("spend", spend);
  seed("sessionUsd", sessionUsd);
  seed("mainTurnRunning", setup.isMainRunning ?? false);
  const pane = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: "session",
    props: {
      title: "Session",
      isFocused: false,
      bodyColumns: columns,
      placement: "dock",
      scroll: { offset: 0, bodyRows: setup.rows ?? ROWS },
      view: {},
    },
    viewport: { columns, rows: setup.rows ?? ROWS },
  });
  const tab = (await pane.findAll({ type: "Button" })).find(
    (button) => button.props.label === "Agents",
  );
  expect(tab, "an Agents tab button").toBeDefined();
  await pane.press({ key: tab?.key ?? "" });
  await settle(pane);
  const centsOfMain = splitRows(spend, sessionUsd).find((row) => row.name === "main")?.cents ?? 0;
  const split = agentSplit(spend, sessionUsd);
  const cents = new Map([
    ["main", centsOfMain],
    ...Object.entries(split).map(([id, share]): [string, number] => [id, share.cents ?? 0]),
  ]);
  return { pane, split, cents };
}

function withoutTokens({ tokens: _tokens, ...node }: Agent): AgentNode {
  return node;
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
  on("session.messages", () => ({ value: [] }));
}
