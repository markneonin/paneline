import { describe, expect, mock, test } from "claude-code/testing";
import type { AgentInfo, On } from "claude-code";
import type { Engine, Mounted, MockClock } from "claude-code/testing";

import type { AgentNode } from "../hooks/agents-model";
import { palette } from "../hooks/palette";
import { paneInk } from "../hooks/pane-ink";
import { coloursOfText, screenRows } from "./band-screen";
import { pricedSpent, seedOf, unpricedSpent } from "./fixtures/agent-spend";
import type { Tokens } from "./spend-world";
import { isHeavy } from "./weight";

type Pane = Mounted<"terminal", "Pane">;
type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] };
type Line = { text: string; outerTexts: Node[]; allTexts: Node[]; buttonLabels: unknown[] };
type EngineListing = { id: string; type: string; description: string; status: string };
type LoggedLine = { to: string; text: string };
type Fixture = AgentNode & { spent?: Tokens; priced?: true };

const NOW = 200_000;
const COLUMNS = 100;
const NARROW_COLUMNS = 36;
const MAIN_MODEL = "opus";
const PROBE_PERIOD = 200;
const SECOND = 1_000;
const POLL_MS = 1_000;
const SLOW_TEST_MS = 30_000;
const FLUSH_MS = 1_000;
const POLL_AND_FLUSH_MS = 4_000;
const SPENDERS = 7;
const SHORT_PANE_ROWS = 20;
const TALL_PANE_ROWS = 40;
const RUNNING_ROW_LINES = 2;
const FINISHED_ROW_LINES = 2;
const NESTING_CELLS = 3;
const BAR_COLUMNS = 101;
const BAR_CELLS = 10;
const TAB_COLOR = "clawd_background";
const TAB_LABELS = ["Activity", "Files", "Agents"];
const LONG_TEXT =
  "investigate why the nightly export job keeps timing out when the warehouse is under heavy load";

describe("main row", () => {
  test("A1 the session total alone does not show on the main row", async ($, on) => {
    worldOf(on);
    await writeSessionUsd($, 0.42);

    const pane = await paneWithTab($, [agent({ id: "a", description: "alpha" })]);

    const mainRow = lineContaining(await bodyLines(pane), "main");
    expect(mainRow).toContain(MAIN_MODEL);
    expect(mainRow).not.toContain("$");
  });

  test("A2 when the session cost is not known the main row shows no dollar amount", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [agent({ id: "a", description: "alpha" })]);

    const mainRow = lineContaining(await bodyLines(pane), "main");
    expect(mainRow).toContain(MAIN_MODEL);
    expect(mainRow).not.toContain("$");
  });
});

describe("agent cost", () => {
  test("A27 a finished agent with a known cost shows ~$0.03 and its tokens on its one row, before the open mark", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [finishedWithCost({ input: 10_500 }, true)]);

    expect(rowOf(await screenBody(pane), "alpha")).toMatch(/\s5s\s+10\.5k ~\$0\.03 ▸$/);
  });

  test("A28 a finished agent whose cost is under one cent shows <$0.01 after its tokens and no other row shows a dollar sign", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [finishedWithCost({ read: 10_500 }, true)]);

    const rows = await screenBody(pane);
    expect(rowOf(rows, "alpha")).toMatch(/10\.5k <\$0\.01 ▸$/);
    expect(
      rows.filter((row) => row.includes("$") && !row.includes("alpha") && !/^\s*Agents/.test(row)),
    ).toEqual([]);
  });

  test("A29 a finished agent whose cost is not known ends its row with the tokens and shows no dollar sign", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [finishedWithCost({ input: 10_500 }, false)]);

    const row = rowOf(await screenBody(pane), "alpha");
    expect(row).toMatch(/10\.5k ▸$/);
    expect(row).not.toContain("$");
  });

  test("A34 a finished agent that cost zero dollars and used no tokens shows no dollar sign on its row", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [agent({ id: "a", description: "alpha" })]);

    expect(rowOf(await screenBody(pane), "alpha")).not.toContain("$");
  });
});

describe("agent cost in Spend", () => {
  test("A30 the row of an agent with 10.5k tokens and a cost of 0.03 shows 10.5k followed by ~$0.03", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      spender("alpha", { input: 10_500 }, true),
      spender("bravo", { input: 5_000 }, false),
    ]);

    expect(rowOf(await screenBody(pane), "alpha")).toMatch(/10\.5k ~\$0\.03 ▸$/);
  });

  test("A31 the row of an agent whose cost is under one cent shows <$0.01 after its tokens", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      spender("alpha", { read: 10_500 }, true),
      spender("bravo", { input: 5_000 }, false),
    ]);

    expect(rowOf(await screenBody(pane), "alpha")).toMatch(/10\.5k <\$0\.01 ▸$/);
  });

  test("A32 the row of an agent whose cost is not known shows its tokens and no dollar sign", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      spender("alpha", { input: 10_500 }, false),
      spender("bravo", { input: 5_000 }, false),
    ]);

    const row = rowOf(await screenBody(pane), "alpha");
    expect(row).toMatch(/10\.5k ▸$/);
    expect(row).not.toContain("$");
  });

  test("A33 with one priced and one unpriced agent the tokens of both rows end in the same column and the priced one shows its cost", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      spender("alpha", { input: 10_500 }, true),
      spender("bravo", { input: 10_400 }, false),
    ]);

    const rows = await screenBody(pane);
    const priced = rowOf(rows, "alpha");
    const unpriced = rowOf(rows, "bravo");
    expect(priced).toContain("~$0.03");
    expect(priced.indexOf("10.5k")).toBe(unpriced.indexOf("10.4k"));
  });
});

describe("agent tree", () => {
  test("A3 a child that is not last gets a branch, the last one an end mark, and a grandchild sits 2 cells right of its parent's mark", async ($, on) => {
    worldOf(on);
    const pane = await paneWithTab($, [
      agent({ id: "r", description: "root job", startedAt: NOW - 9_000 }),
      agent({ id: "e", parentId: "r", description: "echo", startedAt: NOW - 8_000 }),
      agent({ id: "f", parentId: "r", description: "foxtrot", startedAt: NOW - 7_000 }),
      agent({ id: "g", parentId: "e", description: "golf", startedAt: NOW - 6_000 }),
    ]);

    const rows = await screenBody(pane);
    const kids = [rowOf(rows, "echo"), rowOf(rows, "foxtrot")].sort(
      (a, b) => rows.indexOf(a) - rows.indexOf(b),
    );
    const echo = rowOf(rows, "echo");
    const golf = rowOf(rows, "golf");
    expect(kids[0]).toContain("├─");
    expect(kids[1]).toContain("└─");
    expect(golf.indexOf("└─")).toBe(echo.search(/├─|└─/) + 2);
  });

  test("A4 a line runs down from a child that has later siblings, and not from the last one", async ($, on) => {
    worldOf(on);
    const pane = await paneWithTab($, [
      agent({ id: "r", description: "root job", startedAt: NOW - 9_000 }),
      agent({ id: "k1", parentId: "r", description: "kone", startedAt: NOW - 8_000 }),
      agent({ id: "k2", parentId: "r", description: "ktwo", startedAt: NOW - 7_000 }),
      agent({ id: "g1", parentId: "k1", description: "gone", startedAt: NOW - 6_000 }),
      agent({ id: "g2", parentId: "k2", description: "gtwo", startedAt: NOW - 5_000 }),
    ]);

    const rows = await screenBody(pane);
    const firstKid = rows.indexOf(rowOf(rows, "kone")) < rows.indexOf(rowOf(rows, "ktwo"));
    const [withLater, lastOne] = firstKid ? ["gone", "gtwo"] : ["gtwo", "gone"];
    expect(rowOf(rows, withLater)).toContain("│");
    expect(rowOf(rows, lastOne)).not.toContain("│");
  });

  test("A5 an agent whose parent is gone from the tree is still listed", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      agent({ id: "x", parentId: "pushed-out", description: "orphan task" }),
    ]);

    expect(lineContaining(await bodyLines(pane), "orphan task")).not.toBe("");
  });

  test("A15 with no subagents the tab says so in a muted line", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, []);

    const notices = await pane.findAll({ type: "Text", text: "no subagents yet" });
    expect(notices.map((notice) => notice.props.color)).toContain(palette.muted);
  });
});

describe("agent cards", () => {
  test("A6 a finished agent is one row with its description, type, a run time that stays at 1m 04s and tokens", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      agent({
        id: "a",
        type: "plugin:review",
        description: "review the diff",
        background: true,
        status: "done",
        spent: { input: 12_000, output: 3_000 },
        startedAt: NOW - 100_000,
        endedAt: NOW - 36_000,
      }),
    ]);

    const row = rowOf(await screenBody(pane), "review the diff");
    expect(row).toContain("✓");
    expect(row.indexOf("review the diff")).toBeLessThan(row.indexOf("plugin:review"));
    expect(row).toContain("1m 04s");
    expect(row).toContain("15k");
  });

  test("A6b an agent is one row, a running agent with a context size and a tool adds one line, and nothing sits between two rows", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      agent({
        id: "a",
        description: "alpha",
        status: "running",
        startedAt: NOW - 9_000,
        ctxTokens: 48_000,
        running: [{ callId: "c1", tool: "Bash", target: "git status" }],
      }),
      agent({ id: "b", description: "bravo", status: "done", startedAt: NOW - 8_000 }),
    ]);

    const rows = (await screenBody(pane)).filter((text) => text !== "");
    const alphaAt = rows.findIndex((text) => text.includes("alpha"));
    const bravoAt = rows.findIndex((text) => text.includes("bravo"));
    expect(bravoAt - alphaAt).toBe(RUNNING_ROW_LINES);
    expect(rows.length - bravoAt).toBe(FINISHED_ROW_LINES);
  });

  test("A6c a running card comes first, then the finished ones with the most recently ended on top", async ($, on) => {
    worldOf(on);
    const finished = Array.from({ length: 3 }, (_, i) =>
      agent({
        id: `f${i}`,
        description: `finished ${i}`,
        status: "done",
        startedAt: NOW - 5_000,
        endedAt: NOW - 4_000 + i * 100,
      }),
    );

    const pane = await paneWithTab($, [
      ...finished,
      agent({ id: "r", description: "running one", status: "running", startedAt: NOW - 9_000 }),
    ]);

    const rows = await rowTexts(pane);
    const order = ["running one", "finished 2", "finished 1", "finished 0"].map((word) =>
      rows.findIndex((text) => text.includes(word)),
    );
    expect(Math.min(...order)).toBeGreaterThan(0);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test("A7 a running agent shows its type on its row, and context and only the first running tool on the line under it", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      agent({
        id: "a",
        type: "Explore",
        description: "scan repo",
        status: "running",
        model: "haiku",
        effort: "high",
        ctxTokens: 48_000,
        spent: { input: 12_000, output: 3_000 },
        running: [
          { callId: "c1", tool: "Bash", target: "git status" },
          { callId: "c2", tool: "Read", target: "/work/src/index.ts" },
        ],
      }),
    ]);

    const rows = await screenBody(pane);
    const context = rowOf(rows, "ctx 48k");
    expect(rowOf(rows, "scan repo")).toContain("Explore");
    expect(context).toContain("Bash: git status");
    expect(context).not.toContain("Read");
  });

  test("A7b the row of a running agent shows its type, model and effort after its description", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      agent({
        id: "a",
        description: "scan repo",
        status: "running",
        model: "claude-opus-4-5-20251101",
        effort: "high",
      }),
    ]);

    expect(rowOf(await screenBody(pane), "scan repo")).toContain(
      "scan repo  general-purpose · opus 4.5 · high",
    );
  });

  test("A7c the row of a finished agent shows its type, model and effort after its description", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      agent({ id: "a", description: "review the diff", model: "haiku", effort: "low" }),
    ]);

    expect(rowOf(await screenBody(pane), "review the diff")).toContain(
      "review the diff  general-purpose · haiku · low",
    );
  });

  test("A7d a row whose effort is unknown shows only the model after the type", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      agent({ id: "a", description: "review the diff", model: "haiku" }),
    ]);

    const row = rowOf(await screenBody(pane), "review the diff");
    expect(row).toContain("general-purpose · haiku");
    expect(row).not.toContain("haiku ·");
  });

  test("A7e a row whose model is unknown shows only the effort after the type", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      agent({ id: "a", description: "review the diff", model: "", effort: "high" }),
    ]);

    expect(rowOf(await screenBody(pane), "review the diff")).toContain("general-purpose · high");
  });

  test("A7g a long description of a running agent is clipped with an ellipsis and its model stays while the name is cut", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab(
      $,
      [
        agent({
          id: "a",
          description: LONG_TEXT,
          status: "running",
          model: "haiku",
          effort: "high",
        }),
      ],
      NARROW_COLUMNS,
    );

    const title = rowOf(await screenBody(pane, NARROW_COLUMNS), "● running");
    expect(title).toContain("…");
    expect(title).toContain("haiku");
  });

  test("A7h a short description of a running agent is not clipped", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab(
      $,
      [agent({ id: "a", description: "alpha", status: "running", model: "haiku", effort: "high" })],
      NARROW_COLUMNS,
    );

    const title = rowOf(await screenBody(pane, NARROW_COLUMNS), "alpha");
    expect(title).toContain("● running alpha ");
    expect(title).not.toContain("…");
  });

  test("A26 the card title shows the description in the text colour and the model and effort after it in the muted colour, inside the title button", async ($, on) => {
    worldOf(on);
    const pane = await paneWithTab($, [
      agent({ id: "a", description: "alpha", model: "haiku", effort: "high" }),
    ]);

    const texts = allTextsIn(await titleButtonOf(pane, "alpha"));

    expect(colorOfTextIn(texts, "alpha")).toBe(palette.text);
    expect(colorOfTextIn(texts, " · haiku · high")).toBe(palette.muted);
  });

  test("A8 the run time of a running agent counts up every second with nothing else happening", async ($, on) => {
    const clock = worldOf(on);
    const pane = await paneWithTab($, [
      agent({ id: "a", description: "scan repo", status: "running", startedAt: NOW - 5_000 }),
    ]);
    const before = rowOf(await screenBody(pane), "scan repo");

    await clock.advance(2 * SECOND);

    const after = rowOf(await screenBody(pane), "scan repo");
    expect(before).toMatch(/\s5s\s/);
    expect(after).toMatch(/\s7s\s/);
  });

  test("A21 rows of a tree have no empty row between them and the guide lines run unbroken from a child to its last sibling", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      agent({ id: "r", description: "root job", status: "running", startedAt: NOW - 9_000 }),
      agent({ id: "k1", parentId: "r", description: "kone", startedAt: NOW - 8_000 }),
      agent({ id: "g1", parentId: "k1", description: "gone", startedAt: NOW - 7_000 }),
      agent({ id: "k2", parentId: "r", description: "ktwo", startedAt: NOW - 6_000 }),
    ]);

    const rows = (await screenBody(pane)).filter((text) => text !== "");
    const rootAt = rows.findIndex((text) => text.includes("root job"));
    const treeRows = [rowOf(rows, "kone"), rowOf(rows, "gone"), rowOf(rows, "ktwo")];
    const lastAt = Math.max(...treeRows.map((row) => rows.indexOf(row)));
    expect(lastAt - rootAt).toBe(treeRows.length);
    const grand = rowOf(rows, "gone");
    const kids = [rowOf(rows, "kone"), rowOf(rows, "ktwo")];
    const firstKidIsParent = rows.indexOf(kids[0] as string) < rows.indexOf(kids[1] as string);
    expect(grand.includes("│")).toBe(firstKidIsParent);
  });

  test("A22 a nested row starts its name 3 cells right of its parent's name", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      agent({
        id: "p",
        type: "Explore",
        description: "parent job",
        status: "done",
        startedAt: NOW - 9_000,
      }),
      agent({
        id: "c",
        parentId: "p",
        type: "Plan",
        description: "child job",
        status: "done",
        startedAt: NOW - 8_000,
      }),
    ]);

    const rows = await screenBody(pane);
    expect(rowOf(rows, "child job").indexOf("child job")).toBe(
      rowOf(rows, "parent job").indexOf("parent job") + NESTING_CELLS,
    );
  });

  test("A25 one blank row sits above the hint under the list", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      agent({ id: "a", description: "alpha", spent: { input: 9_000, output: 1_000 } }),
      agent({ id: "b", description: "bravo", spent: { input: 4_000, output: 1_000 } }),
    ]);

    const rows = await screenBody(pane);
    const hintAt = rows.findIndex((text) => text.includes("click an agent"));
    expect(rows[hintAt - 1]?.trim()).toBe("");
    expect(rows[hintAt - 2]?.trim()).not.toBe("");
  });
});

describe("a pane too short for every card", () => {
  test("A23 at height 20 the oldest finished rows collapse into one row that counts exactly the rows left out", async ($, on) => {
    worldOf(on);
    const finished = Array.from({ length: 20 }, (_, i) =>
      agent({
        id: `f${i}`,
        description: `finished ${i}`,
        status: "done",
        startedAt: NOW - 50_000,
        endedAt: NOW - 40_000 + i * 100,
      }),
    );

    const pane = await paneWithTab(
      $,
      [
        ...finished,
        agent({ id: "r", description: "busy one", status: "running", startedAt: NOW - 5_000 }),
      ],
      COLUMNS,
      SHORT_PANE_ROWS,
    );

    const rows = (await screenBody(pane)).map((text) => text.trim()).filter((text) => text !== "");
    const shown = rows.filter((text) => text.includes("finished "));
    const hidden = Number(rows.find((text) => /^… \d+ more done$/.test(text))?.match(/\d+/)?.[0]);
    expect(rows.length).toBeLessThanOrEqual(SHORT_PANE_ROWS);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length + hidden).toBe(finished.length);
    expect(shown.some((text) => text.includes("finished 19"))).toBe(true);
    expect(shown.some((text) => text.includes("finished 0"))).toBe(false);
  });

  test("A24 at height 20 sixteen running rows are all drawn whole and all finished ones collapse", async ($, on) => {
    worldOf(on);
    const running = Array.from({ length: 16 }, (_, i) =>
      agent({ id: `r${i}`, description: `busy ${i}`, status: "running", startedAt: NOW - 5_000 }),
    );
    const finished = Array.from({ length: 3 }, (_, i) =>
      agent({ id: `f${i}`, description: `finished ${i}`, status: "done" }),
    );

    const pane = await paneWithTab($, [...running, ...finished], COLUMNS, SHORT_PANE_ROWS);

    const rows = (await screenBody(pane)).map((text) => text.trim());
    const busy = rows.filter((text) => text.includes("busy "));
    expect(busy).toHaveLength(running.length);
    expect(busy.every((text) => /\s5s\s/.test(text))).toBe(true);
    expect(rows.filter((text) => text.includes("finished "))).toEqual([]);
    expect(rows).toContain("… 3 more done");
  });
});

describe("status marks", () => {
  test("A9 a done agent shows a green check", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [agent({ id: "a", description: "alpha", status: "done" })]);

    expect(await colorsOfMark(pane, "✓")).toContain(palette.ok);
  });

  test("A10 an agent that failed shows a red cross", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [agent({ id: "a", description: "alpha", status: "failed" })]);

    expect(await colorsOfMark(pane, "✗")).toContain(palette.failed);
  });

  test("A11 an agent that was killed shows a red cross", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [agent({ id: "a", description: "alpha", status: "killed" })]);

    expect(await colorsOfMark(pane, "✗")).toContain(palette.failed);
  });

  test("S6 a done agent's row reads done after the ✓, in the same green", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [agent({ id: "a", description: "alpha", status: "done" })]);

    expect(rowOf(await screenBody(pane), "alpha")).toMatch(/✓ done +alpha/);
    expect(coloursOfText(await pane.drawn(), "✓ done")).toEqual([paneInk().ok]);
  });

  test("S6 a failed agent's row reads failed after the ✗, in the red", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [agent({ id: "a", description: "alpha", status: "failed" })]);

    expect(rowOf(await screenBody(pane), "alpha")).toMatch(/✗ failed +alpha/);
    expect(coloursOfText(await pane.drawn(), "✗ failed")).toEqual([paneInk().failed]);
  });

  test("S6 a killed agent's row reads killed after the ✗, in the red", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [agent({ id: "a", description: "alpha", status: "killed" })]);

    expect(rowOf(await screenBody(pane), "alpha")).toMatch(/✗ killed +alpha/);
    expect(coloursOfText(await pane.drawn(), "✗ killed")).toEqual([paneInk().failed]);
  });

  test("S6 a running agent's row reads running after the ●, in the running colour", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      agent({ id: "a", description: "alpha", status: "running" }),
    ]);

    expect(rowOf(await screenBody(pane), "alpha")).toMatch(/● running +alpha/);
    expect(coloursOfText(await pane.drawn(), "● running")).toEqual([paneInk().tool]);
  });

  test("S6 a waiting agent's row reads waiting after the ●, in the alert colour", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      agent({ id: "a", description: "alpha", status: "waiting" }),
    ]);

    expect(rowOf(await screenBody(pane), "alpha")).toMatch(/● waiting +alpha/);
    expect(coloursOfText(await pane.drawn(), "● waiting")).toEqual([paneInk().alert]);
  });

  test("A12 an agent that waits for the owner shows an amber dot", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      agent({ id: "a", description: "alpha", status: "waiting" }),
    ]);

    expect(await colorsOfMark(pane, "●")).toContain(palette.alert);
  });
});

describe("spend", () => {
  test("A13 with 7 agents every agent has its own row with its tokens", async ($, on) => {
    worldOf(on);
    const spenders = Array.from({ length: SPENDERS }, (_, i) =>
      agent({
        id: `s${i + 1}`,
        description: `task ${i + 1}`,
        spent: { input: (i + 1) * 10_000 - 1_000, output: 1_000 },
      }),
    );

    const pane = await paneWithTab($, spenders);

    const rows = await screenBody(pane);
    const counts = spenders.map((one) => /(\d+k) ▸$/.exec(rowOf(rows, one.description))?.[1]);
    expect(counts).toEqual(["10k", "20k", "30k", "40k", "50k", "60k", "70k"]);
  });

  test("A13b the rows say what each agent did", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      agent({
        id: "big",
        description: "migrate the billing tables",
        spent: { input: 39_000, output: 1_000 },
      }),
      agent({
        id: "small",
        description: "write the release notes",
        spent: { input: 9_000, output: 1_000 },
      }),
    ]);

    const rows = await screenBody(pane);
    expect(rowOf(rows, "migrate the billing tables")).toMatch(/40k ▸$/);
    expect(rowOf(rows, "write the release notes")).toMatch(/10k ▸$/);
  });

  test("A14 at 101 columns the bigger spender has more filled cells in its 10 cell bar and the smaller one has a grey empty rest", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab(
      $,
      [
        agent({ id: "big", description: "big task", spent: { input: 39_000, output: 1_000 } }),
        agent({ id: "small", description: "small task", spent: { input: 9_000, output: 1_000 } }),
      ],
      BAR_COLUMNS,
    );

    const rows = await screenBody(pane, BAR_COLUMNS);
    const [big, small] = [rowOf(rows, "big task"), rowOf(rows, "small task")];
    expect(cellsOf(big, "▰") + cellsOf(big, "▱")).toBe(BAR_CELLS);
    expect(cellsOf(small, "▰") + cellsOf(small, "▱")).toBe(BAR_CELLS);
    expect(cellsOf(big, "▰")).toBeGreaterThan(cellsOf(small, "▰"));
    expect(coloursOfText(await pane.drawn(), "▱")).toEqual([paneInk().meterEmpty]);
  });
});

describe("agents read at a glance", () => {
  test("V9 a finished row shows its name in the text colour and its words dim", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      agent({
        id: "a",
        type: "general-purpose",
        description: "review the diff",
        status: "done",
        spent: { input: 10_000, output: 500 },
        startedAt: NOW - 5_000,
        endedAt: NOW,
      }),
    ]);

    const drawn = await pane.drawn();
    expect(coloursOfText(drawn, "review the diff")).toEqual([paneInk().text]);
    expect(coloursOfText(drawn, "general-purpose")).toEqual([paneInk().muted]);
    expect(coloursOfText(drawn, "10.5k")).toEqual([paneInk().muted]);
  });

  test("V10 a running agent's line under its row shows its context size in the text colour, its label dim, its target dim and its tool name in the tool colour", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      agent({
        id: "a",
        type: "Explore",
        description: "scan repo",
        status: "running",
        ctxTokens: 12_300,
        startedAt: NOW - 5_000,
        running: [{ callId: "c1", tool: "Read", target: "hooks/x.ts" }],
      }),
    ]);

    const drawn = await pane.drawn();
    expect(coloursOfText(drawn, "ctx")).toEqual([paneInk().muted]);
    expect(coloursOfText(drawn, "12.3k")).toEqual([paneInk().text]);
    expect(coloursOfText(drawn, "Read")).toEqual([paneInk().tool]);
    expect(coloursOfText(drawn, "hooks/x.ts")).toEqual([paneInk().muted]);
  });

  test("V11 a waiting agent's row starts with its status word and then its name and type", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      agent({ id: "w", description: "wait for owner", status: "waiting", startedAt: NOW - 5_000 }),
    ]);

    expect(rowOf(await screenBody(pane), "wait for owner")).toMatch(
      /^ ?● waiting wait for owner\s+general-purpose/,
    );
  });

  test("V13 an idle agent row shows a hollow dim circle and no running dot", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [agent({ id: "a", description: "alpha", status: "idle" })]);

    expect(rowOf(await screenBody(pane), "alpha")).toMatch(/^ ?○/);
    expect(rowOf(await screenBody(pane), "alpha")).not.toContain("●");
    expect(coloursOfText(await pane.drawn(), "○")).toEqual([paneInk().muted]);
  });

  test("V16 with two agents that spent tokens each row draws a 10 cell bar once the pane is 101 columns wide", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, twoSpenders(), BAR_COLUMNS);

    const rows = await screenBody(pane, BAR_COLUMNS);
    const cells = ["big task", "small task"].map((name) => barCellsOf(rowOf(rows, name)));
    expect(cells).toEqual([BAR_CELLS, BAR_CELLS]);
  });

  test("V24 when the pane is 100 columns wide each spender's bar is a 10 cell bar on the line under its row", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, twoSpenders(), BAR_COLUMNS - 1);

    const rows = await screenBody(pane, BAR_COLUMNS - 1);
    const bars = rows.filter((row) => row.includes("of agent tokens"));
    expect(bars.map(barCellsOf)).toEqual([BAR_CELLS, BAR_CELLS]);
  });

  test("V17 the token counts of the rows end in the same column", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, twoSpenders());

    const rows = await screenBody(pane);
    const ends = [rowOf(rows, "big task"), rowOf(rows, "small task")].map((row) =>
      row.indexOf(" ▸"),
    );
    expect(ends[0]).toBe(ends[1]);
    expect(rowOf(rows, "big task")).toMatch(/ 12k ▸$/);
    expect(rowOf(rows, "small task")).toMatch(/9\.5k ▸$/);
  });

  test("V22 with one agent that spent tokens its row is the whole share: 100 per cent in a full bar", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      agent({ id: "a", description: "alpha", spent: { input: 9_000, output: 1_000 } }),
    ]);

    const rows = await screenBody(pane);
    const bar = rowOf(rows, "of agent tokens");
    expect(bar).toContain("100%");
    expect(cellsOf(bar, "▰")).toBe(BAR_CELLS);
    expect(cellsOf(bar, "▱")).toBe(0);
  });

  test("V23 with two agents and tokens spent by only one the spender's bar is full and the other row has no tokens", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      agent({ id: "a", description: "alpha", spent: { input: 9_000, output: 1_000 } }),
      agent({ id: "b", description: "bravo" }),
    ]);

    const rows = await screenBody(pane);
    expect(rowOf(rows, "alpha")).toMatch(/10k ▸$/);
    expect(rowOf(rows, "bravo")).not.toMatch(/\dk? ▸$/);
    expect(cellsOf(rowOf(rows, "of agent tokens"), "▰")).toBe(BAR_CELLS);
  });
});

describe("narrow and wide panes", () => {
  test("A16 at 36 columns every line of the tab is one line high", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, longFixture(), NARROW_COLUMNS);

    await expectEveryLineIsOneLine(pane);
  });

  test("A17 at 100 columns every line of the tab is one line high", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, longFixture(), COLUMNS);

    await expectEveryLineIsOneLine(pane);
  });
});

describe("tabs", () => {
  test("A18 the selected tab is bold and bright, the other tabs are dim buttons, and the body follows the click", async ($, on) => {
    worldOf(on);
    await writeAgents($, [agent({ id: "a", description: "alpha" })]);
    const pane = await mountPane($, COLUMNS);

    const atStart = await tabStrength(pane);
    await showTab(pane, "Agents");
    const onSubagents = await tabStrength(pane);
    const subagentsBody = await bodyLines(pane);
    await showTab(pane, "Files");
    const onFiles = await tabStrength(pane);
    await showTab(pane, "Activity");
    const onActivity = await tabStrength(pane);
    const activityBody = await bodyLines(pane);

    expect(atStart).toEqual({
      bold: ["Activity"],
      dimButtons: ["Files", "Agents"],
      brightColors: [TAB_COLOR],
    });
    expect(onSubagents).toEqual({
      bold: ["Agents"],
      dimButtons: ["Activity", "Files"],
      brightColors: [TAB_COLOR],
    });
    expect(onFiles).toEqual({
      bold: ["Files"],
      dimButtons: ["Activity", "Agents"],
      brightColors: [TAB_COLOR],
    });
    expect(onActivity.bold).toEqual(["Activity"]);
    expect(lineContaining(subagentsBody, "alpha")).not.toBe("");
    expect(lineContaining(activityBody, "alpha")).toBe("");
  });
});

describe("live updates", () => {
  test(
    "A19 an agent update draws nothing new while Activity is open, and shows at once while Subagents is open",
    { options: { probe: true }, timeoutMs: SLOW_TEST_MS },
    async ($, on) => {
      const clock = worldOf(on);
      const logged = recordLogs(on);
      const pane = await mountPane($, COLUMNS);
      await redrawTimes(pane, PROBE_PERIOD - 3);

      await spawnAgent($, clock, "alpha");
      const drawsCountedWhileActivityOpen = logged.length;
      await showTab(pane, "Agents");
      await spawnAgent($, clock, "late arrival");
      await clock.advance(POLL_MS);

      expect(drawsCountedWhileActivityOpen).toBe(0);
      expect(lineContaining(await bodyLines(pane), "late arrival")).not.toBe("");
    },
  );

  test("A20 a few seconds later the tab shows the engine-killed agent as stopped, not failed, and an agent the engine lists that it never saw", async ($, on) => {
    const clock = worldOf(on, [
      { id: "spawned-1", type: "general-purpose", description: "tracked job", status: "killed" },
      { id: "forked", type: "fork", description: "forked skill", status: "running" },
    ]);
    await $.classic.SessionStart({ source: "clear" });
    await spawnAgent($, clock, "tracked job");
    const pane = await mountPane($, COLUMNS);
    await showTab(pane, "Agents");

    await clock.advance(POLL_AND_FLUSH_MS);

    expect(await colorsOfMark(pane, "✗")).not.toContain(palette.failed);
    expect(await colorsOfMark(pane, "○")).toContain(paneInk().muted);
    expect(lineContaining(await bodyLines(pane), "forked skill")).not.toBe("");
  });
});

let spawnCount = 0;
const store = new Map<string, { value: unknown; version: number }>();

async function writeKey(key: string, value: unknown): Promise<void> {
  store.set(key, { value, version: (store.get(key)?.version ?? 0) + 1 });
}

function worldOf(on: On, listed: EngineListing[] = []): MockClock {
  store.clear();
  spawnCount = 0;
  const clock = mock.clock(on, { now: NOW });
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
  on("agent.spawn", () => ({ model: "sonnet", agentId: `spawned-${++spawnCount}` }));
  on("session.model", () => ({ value: MAIN_MODEL }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: "/work" }));
  on("agent.list", () => ({ value: listed as unknown as AgentInfo[] }));
  on("ui.render", { component: "Pane" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine pane</Text>;
  });
  return clock;
}

async function spawnAgent($: Engine, clock: MockClock, description: string): Promise<void> {
  await $.agent.spawn({
    tool_use_id: `call-${description}`,
    prompt: "do the work",
    description,
    subagentType: "general-purpose",
    provider: "anthropic",
    parentModel: "sonnet",
    background: false,
    fork: false,
  } as never);
  await clock.advance(FLUSH_MS);
}

function agent(
  fields: Partial<AgentNode> & { id: string; spent?: Tokens; priced?: true },
): Fixture {
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

function finishedWithCost(spent: Tokens, priced: boolean): Fixture {
  return agent({
    id: "a",
    description: "alpha",
    spent,
    ...(priced && { priced: true as const }),
    startedAt: NOW - 10_000,
    endedAt: NOW - 5_000,
  });
}

function spender(description: string, spent: Tokens, priced: boolean): Fixture {
  return agent({
    id: description,
    type: description,
    description,
    spent,
    ...(priced && { priced: true as const }),
  });
}

function twoSpenders(): AgentNode[] {
  return [
    agent({ id: "big", description: "big task", spent: { input: 11_000, output: 1_000 } }),
    agent({ id: "small", description: "small task", spent: { input: 9_000, output: 500 } }),
  ];
}

function longFixture(): AgentNode[] {
  return [
    agent({
      id: "a",
      type: "plugin:very-long-agent-type",
      description: LONG_TEXT,
      background: true,
      status: "running",
      model: "sonnet",
      effort: "high",
      ctxTokens: 48_000,
      spent: { input: 12_000, output: 3_000 },
      startedAt: NOW - 9_000,
      running: [{ callId: "c1", tool: "Bash", target: LONG_TEXT }],
    }),
    agent({
      id: "b",
      parentId: "a",
      description: LONG_TEXT,
      status: "waiting",
      startedAt: NOW - 8_000,
    }),
    agent({
      id: "c",
      parentId: "a",
      description: LONG_TEXT,
      status: "failed",
      startedAt: NOW - 7_000,
    }),
    agent({
      id: "d",
      parentId: "c",
      description: LONG_TEXT,
      status: "done",
      startedAt: NOW - 6_000,
    }),
  ];
}

function mountPane($: Engine, columns: number, rows: number = TALL_PANE_ROWS): Promise<Pane> {
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
      scroll: { offset: 0, bodyRows: rows },
      view: {},
    },
    viewport: { columns, rows },
  });
}

async function paneWithTab(
  $: Engine,
  agents: Fixture[],
  columns: number = COLUMNS,
  rows: number = TALL_PANE_ROWS,
): Promise<Pane> {
  await writeAgents($, agents);
  const pane = await mountPane($, columns, rows);
  await showTab(pane, "Agents");
  return pane;
}

async function writeAgents($: Engine, agents: Fixture[]): Promise<void> {
  const nodes = agents.map(({ spent: _spent, priced: _priced, ...node }): AgentNode => node);
  await writeKey("agents", Object.fromEntries(nodes.map((one) => [one.id, one])));
  const seed = seedOf(
    agents.flatMap(({ id, type, spent, priced }) =>
      spent === undefined ? [] : [(priced === true ? pricedSpent : unpricedSpent)(id, type, spent)],
    ),
  );
  if (seed.sessionUsd === 0) return;
  await writeKey("spend", seed.spend);
  await writeSessionUsd($, seed.sessionUsd);
}

function writeSessionUsd($: Engine, usd: number): Promise<unknown> {
  return writeKey("sessionUsd", usd);
}

async function showTab(pane: Pane, label: string): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const tab = buttons.find((button) => button.props.label === label);
  expect(tab, `the tab bar has a ${label} tab`).toBeDefined();
  await pane.press({ key: tab?.key ?? "" });
}

async function tabStrength(
  pane: Pane,
): Promise<{ bold: unknown[]; dimButtons: unknown[]; brightColors: unknown[] }> {
  const buttons = await pane.findAll({ type: "Button" });
  const dimButtons = buttons
    .filter(
      (button) => TAB_LABELS.includes(String(button.props.label)) && button.props.dimColor === true,
    )
    .map((button) => button.props.label);
  const bold = (
    await Promise.all(
      TAB_LABELS.map(async (label) =>
        (await pane.findAll({ type: "Text", text: label })).slice(0, 1),
      ),
    )
  )
    .flat()
    .filter((text) => isHeavy(text.props) && text.props.color === TAB_COLOR);
  return {
    bold: bold.map(
      (text) => text.props.text ?? TAB_LABELS.find((label) => JSON.stringify(text).includes(label)),
    ),
    dimButtons,
    brightColors: bold.map((text) => text.props.color),
  };
}

async function colorsOfMark(pane: Pane, mark: string): Promise<unknown[]> {
  const marks = await pane.findAll({ type: "Text", text: mark });
  return marks.map((found) => found.props.color);
}

function recordLogs(on: On): LoggedLine[] {
  const logged: LoggedLine[] = [];
  on("ui.log", (_$, e) => {
    logged.push({ to: e.to, text: e.text });
    return { value: undefined };
  });
  return logged;
}

async function redrawTimes(pane: Pane, times: number): Promise<void> {
  for (let i = 0; i < times; i++) await pane.redraw();
}

async function bodyLines(pane: Pane): Promise<Line[]> {
  const lines = linesOf(await pane.drawn());
  return lines.filter((line) => !isTabBar(line) && line.text !== "");
}

async function rowTexts(pane: Pane): Promise<string[]> {
  return (await bodyLines(pane)).map((line) => line.text);
}

async function expectEveryLineIsOneLine(pane: Pane): Promise<void> {
  const lines = await bodyLines(pane);
  const unwrapped = lines
    .flatMap((line) => line.outerTexts)
    .filter((text) => !String(text.props?.wrap).startsWith("truncate"));
  expect(lines.some((line) => line.text.includes(LONG_TEXT))).toBe(true);
  expect(unwrapped.map(textOf)).toEqual([]);
  expect(lines.filter((line) => line.text.includes("\n")).map((line) => line.text)).toEqual([]);
}

function lineContaining(lines: Line[], word: string): string {
  return lines.find((line) => line.text.includes(word))?.text ?? "";
}

async function titleButtonOf(pane: Pane, title: string): Promise<Node> {
  const buttons = await pane.findAll({ type: "Button" });
  const button = buttons.find((one) => String(one.props.label).includes(title));
  expect(button, `a title button for ${title}`).toBeDefined();
  return button as Node;
}

function colorOfTextIn(texts: Node[], text: string): unknown {
  return texts.find((node) => ownTextOf(node).includes(text))?.props?.color;
}

function ownTextOf(node: Node): string {
  return (node.children ?? []).filter((child) => typeof child === "string").join("");
}

function linesOf(node: Node): Line[] {
  if (node.type === "Text") return [lineOf(node)];
  if (isRow(node) && !holdsColumn(node)) return [lineOf(node)];
  return elementsIn(node).flatMap(linesOf);
}

function lineOf(node: Node): Line {
  return {
    text: textOf(node),
    outerTexts: outerTextsIn(node),
    allTexts: allTextsIn(node),
    buttonLabels: buttonsIn(node).map((button) => button.props?.label),
  };
}

function isRow(node: Node): boolean {
  return (
    node.type === "Box" && !["column", "column-reverse"].includes(String(node.props?.flexDirection))
  );
}

function holdsColumn(node: Node): boolean {
  return elementsIn(node).some(
    (child) => (child.type === "Box" && !isRow(child)) || holdsColumn(child),
  );
}

function buttonsIn(node: Node): Node[] {
  const own = node.type === "Button" ? [node] : [];
  return [...own, ...elementsIn(node).flatMap(buttonsIn)];
}

function isTabBar(line: Line): boolean {
  return line.buttonLabels.some((label) => TAB_LABELS.includes(String(label)));
}

function outerTextsIn(node: Node): Node[] {
  return node.type === "Text" ? [node] : elementsIn(node).flatMap(outerTextsIn);
}

function allTextsIn(node: Node): Node[] {
  const own = node.type === "Text" ? [node] : [];
  return [...own, ...elementsIn(node).flatMap(allTextsIn)];
}

function elementsIn(node: Node): Node[] {
  return (node.children ?? []).filter(
    (child): child is Node => typeof child === "object" && child !== null,
  );
}

function textOf(node: Node): string {
  return (node.children ?? [])
    .map((child) => (typeof child === "string" ? child : textOf(child as Node)))
    .join("");
}

async function screenBody(pane: Pane, columns: number = COLUMNS): Promise<string[]> {
  return screenRows(await pane.drawn(), columns)
    .slice(1)
    .map((row) => row.trimEnd());
}

function rowOf(rows: string[], word: string): string {
  const row = rows.find((text) => text.includes(word));
  expect(row, `a row with ${word}`).toBeDefined();
  return row ?? "";
}

function cellsOf(row: string, glyph: string): number {
  return Array.from(row).filter((one) => one === glyph).length;
}

function barCellsOf(row: string): number {
  return cellsOf(row, "▰") + cellsOf(row, "▱");
}
