import { describe, expect, mock, test } from "claude-code/testing";
import type { AgentInfo, On } from "claude-code";
import type { Engine, Mounted, MockClock } from "claude-code/testing";

import type { AgentNode } from "../hooks/agents-model";
import { palette } from "../hooks/palette";
import { isHeavy } from "./weight";

type Pane = Mounted<"terminal", "Pane">;
type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] };
type Line = { text: string; outerTexts: Node[]; allTexts: Node[]; buttonLabels: unknown[] };
type EngineListing = { id: string; type: string; description: string; status: string };
type LoggedLine = { to: string; text: string };

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
const SPEND_BARS = 6;
const SHORT_PANE_ROWS = 20;
const TALL_PANE_ROWS = 40;
const RUNNING_CARD_ROWS = 3;
const FINISHED_CARD_ROWS = 2;
const SPACER_ROWS = 1;
const NESTING_CELLS = 2;
const TAB_COLOR = "clawd_background";
const TAB_LABELS = ["Activity", "Files", "Agents"];
const LONG_TEXT =
  "investigate why the nightly export job keeps timing out when the warehouse is under heavy load";

describe("main row", () => {
  test("A1 the tab starts with a main row showing the main model and the session total", async ($, on) => {
    worldOf(on);
    await writeSessionUsd($, 0.42);

    const pane = await paneWithTab($, [agent({ id: "a", description: "alpha" })]);

    const mainRow = lineContaining(await bodyLines(pane), "main");
    expect(mainRow).toContain(MAIN_MODEL);
    expect(mainRow).toContain("$0.42");
  });

  test("A2 when the session cost is not known the main row shows no dollar amount", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [agent({ id: "a", description: "alpha" })]);

    const mainRow = lineContaining(await bodyLines(pane), "main");
    expect(mainRow).toContain(MAIN_MODEL);
    expect(mainRow).not.toContain("$");
  });
});

describe("agent tree", () => {
  test("A3 a child that is not last gets a branch, the last one an end mark, and a grandchild sits 2 cells right of its parent", async ($, on) => {
    worldOf(on);
    const pane = await paneWithTab($, [
      agent({ id: "a", description: "alpha", startedAt: NOW - 5_000 }),
      agent({ id: "a1", parentId: "a", description: "alpha one", startedAt: NOW - 8_000 }),
      agent({ id: "b", description: "bravo", startedAt: NOW - 9_000 }),
    ]);

    const rows = await bodyLines(pane);
    const alpha = lineContaining(rows, "alpha");
    const alphaOne = lineContaining(rows, "alpha one");
    const bravo = lineContaining(rows, "bravo");

    expect(alpha.startsWith("├─")).toBe(true);
    expect(bravo.startsWith("└─")).toBe(true);
    expect(alphaOne.startsWith("│ └─")).toBe(true);
    expect(alphaOne.indexOf("└─")).toBe(alpha.indexOf("├─") + 2);
  });

  test("A4 a line runs down from a parent that has later siblings, and not from the last one", async ($, on) => {
    worldOf(on);
    const pane = await paneWithTab($, [
      agent({ id: "a", description: "alpha", startedAt: NOW - 5_000 }),
      agent({ id: "e", parentId: "a", description: "echo", startedAt: NOW - 8_000 }),
      agent({ id: "c", description: "charlie", startedAt: NOW - 9_000 }),
      agent({ id: "d", parentId: "c", description: "delta", startedAt: NOW - 6_000 }),
    ]);

    const rows = await bodyLines(pane);

    expect(lineContaining(rows, "echo")).toContain("│");
    expect(lineContaining(rows, "delta")).not.toContain("│");
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
  test("A6 a finished agent is a title with its description and one dim line with type, a run time that stays at 1m 04s and tokens", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      agent({
        id: "a",
        type: "plugin:review",
        description: "review the diff",
        background: true,
        status: "done",
        tokensIn: 12_000,
        tokensOut: 3_000,
        startedAt: NOW - 100_000,
        endedAt: NOW - 36_000,
      }),
    ]);

    const rows = await rowTexts(pane);
    const titleAt = rows.findIndex((text) => text.includes("review the diff"));
    expect(rows[titleAt]).toContain("✓");
    expect(rows[titleAt]).not.toContain("plugin:review");
    expect(rows[titleAt + 1]).toContain("plugin:review");
    expect(rows[titleAt + 1]).toContain("1m 04s");
    expect(rows[titleAt + 1]).toContain("15k tokens");
  });

  test("A6b a running card is 3 rows and a finished card is 2", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      agent({ id: "a", description: "alpha", status: "running", startedAt: NOW - 9_000 }),
      agent({ id: "b", description: "bravo", status: "done", startedAt: NOW - 8_000 }),
    ]);

    const rows = await rowTexts(pane);
    const alphaAt = rows.findIndex((text) => text.includes("alpha"));
    const bravoAt = rows.findIndex((text) => text.includes("bravo"));
    expect(bravoAt - alphaAt).toBe(RUNNING_CARD_ROWS + SPACER_ROWS);
    expect(rows.length - bravoAt).toBe(FINISHED_CARD_ROWS);
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

  test("A7 a running agent shows type, model and effort on its first dim line, and time, context and only the first running tool on its second", async ($, on) => {
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
        tokensIn: 12_000,
        tokensOut: 3_000,
        running: [
          { callId: "c1", tool: "Bash", target: "git status" },
          { callId: "c2", tool: "Read", target: "/work/src/index.ts" },
        ],
      }),
    ]);

    const rows = await rowTexts(pane);
    const titleAt = rows.findIndex((text) => text.includes("scan repo"));
    expect(rows[titleAt]).not.toContain("haiku");
    expect(rows[titleAt + 1]).toContain("Explore");
    expect(rows[titleAt + 1]).toContain("haiku");
    expect(rows[titleAt + 1]).toContain("high");
    expect(rows[titleAt + 2]).toContain("ctx 48k");
    expect(rows[titleAt + 2]).toContain("Bash: git status");
    expect(rows[titleAt + 2]).not.toContain("Read");
  });

  test("A8 the run time of a running agent counts up every second with nothing else happening", async ($, on) => {
    const clock = worldOf(on);
    const pane = await paneWithTab($, [
      agent({ id: "a", description: "scan repo", status: "running", startedAt: NOW - 5_000 }),
    ]);
    const before = await rowTexts(pane);

    await clock.advance(2 * SECOND);

    const after = await rowTexts(pane);
    const timeAt = before.findIndex((text) => text.includes("scan repo")) + 2;
    expect(before[timeAt]).toContain("5s");
    expect(after[timeAt]).toContain("7s");
  });

  test("A21 every card has an empty spacer above it and the guide lines run unbroken between the first card and the last", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      agent({ id: "a", description: "alpha", status: "running", startedAt: NOW - 9_000 }),
      agent({
        id: "a1",
        parentId: "a",
        description: "alpha one",
        status: "done",
        startedAt: NOW - 8_000,
      }),
      agent({ id: "b", description: "bravo", status: "done", startedAt: NOW - 7_000 }),
    ]);

    const rows = await rowTexts(pane);
    const alphaAt = rows.findIndex((text) => text.includes("alpha") && !text.includes("alpha one"));
    const alphaOneAt = rows.findIndex((text) => text.includes("alpha one"));
    const bravoAt = rows.findIndex((text) => text.includes("bravo"));
    expect(rows[alphaAt - 1]?.trimEnd()).toBe("│");
    expect(rows[alphaOneAt - 1]?.trimEnd()).toBe("│ │");
    expect(rows[bravoAt - 1]?.trimEnd()).toBe("│");
    expect(rows.slice(alphaAt + 1, bravoAt).filter((text) => !text.startsWith("│"))).toEqual([]);
  });

  test("A22 a nested card starts 2 cells right of its parent, on its title and on its dim line", async ($, on) => {
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

    const rows = await rowTexts(pane);
    const parentAt = rows.findIndex((text) => text.includes("parent job"));
    const childAt = rows.findIndex((text) => text.includes("child job"));
    expect(rows[childAt]?.indexOf("child job")).toBe(
      (rows[parentAt]?.indexOf("parent job") ?? 0) + NESTING_CELLS,
    );
    expect(rows[childAt + 1]?.indexOf("Plan")).toBe(
      (rows[parentAt + 1]?.indexOf("Explore") ?? 0) + NESTING_CELLS,
    );
  });

  test("A25 one blank row sits above the Spend header", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      agent({ id: "a", description: "alpha", tokensIn: 9_000, tokensOut: 1_000 }),
    ]);

    const rows = await rowTexts(pane);
    const spendAt = rows.findIndex((text) => text.startsWith("Spend"));
    expect(rows[spendAt - 1]?.trim()).toBe("");
    expect(rows[spendAt - 2]?.trim()).not.toBe("");
  });
});

describe("a pane too short for every card", () => {
  test("A23 at height 20 the oldest finished cards collapse into one row that counts exactly the cards left out", async ($, on) => {
    worldOf(on);
    const finished = Array.from({ length: 8 }, (_, i) =>
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

    const rows = await rowTexts(pane);
    const shown = rows.filter((text) => text.includes("finished "));
    const hidden = Number(rows.find((text) => /^… \d+ more done$/.test(text))?.match(/\d+/)?.[0]);
    expect(rows.length).toBeLessThan(SHORT_PANE_ROWS);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length + hidden).toBe(finished.length);
    expect(shown.some((text) => text.includes("finished 7"))).toBe(true);
    expect(shown.some((text) => text.includes("finished 0"))).toBe(false);
  });

  test("A24 at height 20 six running cards are all drawn whole and all finished ones collapse", async ($, on) => {
    worldOf(on);
    const running = Array.from({ length: 6 }, (_, i) =>
      agent({ id: `r${i}`, description: `busy ${i}`, status: "running", startedAt: NOW - 5_000 }),
    );
    const finished = Array.from({ length: 3 }, (_, i) =>
      agent({ id: `f${i}`, description: `finished ${i}`, status: "done" }),
    );

    const pane = await paneWithTab($, [...running, ...finished], COLUMNS, SHORT_PANE_ROWS);

    const rows = await rowTexts(pane);
    const titleAts = running.map((one) =>
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      rows.findIndex((text) => text.includes(one.description ?? "")),
    );
    expect(titleAts.every((at) => at >= 0)).toBe(true);
    expect(titleAts.map((at) => rows[at + 2])).toEqual(
      titleAts.map(() => expect.stringContaining("5s")),
    );
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

  test("A12 an agent that waits for the owner shows an amber dot", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      agent({ id: "a", description: "alpha", status: "waiting" }),
    ]);

    expect(await colorsOfMark(pane, "●")).toContain(palette.alert);
  });
});

describe("spend", () => {
  test("A13 with 7 agents Spend shows 6 bars, the biggest first, and leaves the smallest out", async ($, on) => {
    worldOf(on);
    const spenders = Array.from({ length: SPENDERS }, (_, i) =>
      agent({
        id: `s${i + 1}`,
        description: `task ${i + 1}`,
        tokensIn: (i + 1) * 10_000 - 1_000,
        tokensOut: 1_000,
      }),
    );

    const pane = await paneWithTab($, spenders);

    const counts = (await spendLines(pane)).map((row) =>
      textOf(row.allTexts[row.allTexts.length - 1] as Node),
    );
    expect(counts).toHaveLength(SPEND_BARS);
    expect(counts).toEqual(["70k", "60k", "50k", "40k", "30k", "20k"]);
  });

  test("A13b spend rows say what each agent did", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      agent({
        id: "big",
        description: "migrate the billing tables",
        tokensIn: 39_000,
        tokensOut: 1_000,
      }),
      agent({
        id: "small",
        description: "write the release notes",
        tokensIn: 9_000,
        tokensOut: 1_000,
      }),
    ]);

    const [biggest, smaller] = await spendLines(pane);
    expect(biggest?.text).toContain("migrate the billing tables");
    expect(smaller?.text).toContain("write the release notes");
  });

  test("A14 the biggest spender has a full bar and a smaller one has a grey empty rest", async ($, on) => {
    worldOf(on);

    const pane = await paneWithTab($, [
      agent({ id: "big", description: "big task", tokensIn: 39_000, tokensOut: 1_000 }),
      agent({ id: "small", description: "small task", tokensIn: 9_000, tokensOut: 1_000 }),
    ]);

    const [biggest, smaller] = await spendLines(pane);
    expect(emptyRestOf(biggest)).toEqual([]);
    expect(emptyRestOf(smaller)).not.toEqual([]);
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

  test("A20 a few seconds later the tab shows the killed agent as killed and an agent the engine lists that it never saw", async ($, on) => {
    const clock = worldOf(on, [
      { id: "spawned-1", type: "general-purpose", description: "tracked job", status: "killed" },
      { id: "forked", type: "fork", description: "forked skill", status: "running" },
    ]);
    await $.classic.SessionStart({ source: "clear" });
    await spawnAgent($, clock, "tracked job");
    const pane = await mountPane($, COLUMNS);
    await showTab(pane, "Agents");

    await clock.advance(POLL_AND_FLUSH_MS);

    expect(await colorsOfMark(pane, "✗")).toContain(palette.failed);
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
      tokensIn: 12_000,
      tokensOut: 3_000,
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
  agents: AgentNode[],
  columns: number = COLUMNS,
  rows: number = TALL_PANE_ROWS,
): Promise<Pane> {
  await writeAgents($, agents);
  const pane = await mountPane($, columns, rows);
  await showTab(pane, "Agents");
  return pane;
}

function writeAgents($: Engine, agents: AgentNode[]): Promise<unknown> {
  return writeKey("agents", Object.fromEntries(agents.map((one) => [one.id, one])));
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

async function spendLines(pane: Pane): Promise<Line[]> {
  const lines = await bodyLines(pane);
  return lines.slice(lines.findIndex((line) => line.text.startsWith("Spend")) + 1);
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

function emptyRestOf(line: Line | undefined): Node[] {
  return (line?.allTexts ?? []).filter(
    (text) => text.props?.color === palette.meterEmpty && textOf(text) !== "",
  );
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
