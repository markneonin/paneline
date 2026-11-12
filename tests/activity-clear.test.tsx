import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";
import type { On } from "claude-code";

import { inkFor } from "../hooks/pane-ink";

import {
  COLUMNS,
  FAILING_COMMAND,
  FLUSH_MS,
  TALL_ROWS,
  callRowKeys,
  clearButtonsOf,
  editFile,
  finishTurn,
  headingLineOf,
  isDim,
  lines,
  paneOnTab,
  pressClear,
  readFile,
  runCommand,
  spawnAgent,
  texts,
  worldOf,
} from "./clear-world";
import type { World } from "./clear-world";
import { headingOrder, shownTexts } from "./skills-tree";
import type { Line } from "./skills-tree";

type ChipNode = { props?: Record<string, unknown>; children?: unknown[] };
type Pane = Awaited<ReturnType<typeof paneOnTab>>;

const KEPT_CALLS = 400;
const SLOW_TEST_MS = 30_000;
const CALLS_BEYOND_KEPT = KEPT_CALLS + 10;
const DURATION = "(?:\\d+ms|\\d+s|\\d+m \\d{2}s)";
const STATS_LINE = new RegExp(
  `^${DURATION}(?: · \\d+ tools?)?(?: · \\d+ files?)?(?: · \\+\\d+ · −\\d+)?(?: · \\d+ errors?)?$`,
);
const ELAPSED = new RegExp(`^${DURATION}`);
const SECTIONS = ["Failed", "Tool mix", "Timeline"];
const FIVE_SECONDS = 5_000;
const TWO_SECONDS = 2_000;
const MAIN_TURN = "turn-main";
const NEXT_MAIN_TURN = "turn-main-next";
const AGENT_TURN = "turn-agent";
const NO_MATCH_FILTER = "zz";

describe("activity clear button", () => {
  test("A1 after some calls the Timeline heading line ends with a dim clear button, and no Now heading is drawn", async ($, on) => {
    const world = worldOf(on);
    await ranBeforeClear($, world);

    const pane = await paneOnTab($, "Activity");

    const shown = await lines(pane);
    const heading = headingLineOf(shown, "Timeline");
    expect(headingLineOf(shown, "Now")).toBeUndefined();
    expect(clearButtonsOf(shown)).toHaveLength(1);
    expect(heading?.parts.at(-1)).toBe(clearButtonsOf(shown)[0]);
    expect(clearButtonsOf(shown).every(isDim)).toBe(true);
  });

  test("A2 with no call there is no clear button, it shows after the first call and goes after the press", async ($, on) => {
    const world = worldOf(on);
    const pane = await paneOnTab($, "Activity");
    const beforeAnyCall = clearButtonsOf(await lines(pane)).length;

    await runCommand($, world, "echo first");
    const afterFirstCall = clearButtonsOf(await lines(pane)).length;
    await pressClear(pane, world);
    const afterPress = clearButtonsOf(await lines(pane)).length;

    expect([beforeAnyCall, afterFirstCall, afterPress]).toEqual([0, 1, 0]);
  });

  test("T9 with calls kept and a filter matching none, the Timeline heading has no clear button and no matching calls shows", async ($, on) => {
    const world = worldOf(on);
    await runCommand($, world, "echo first");
    const pane = await paneOnTab($, "Activity");

    await pane.input({ key: "filter", text: NO_MATCH_FILTER, kind: "change" });

    const shown = await lines(pane);
    const heading = headingLineOf(shown, "Timeline");
    expect(heading).toBeDefined();
    expect(clearButtonsOf(heading === undefined ? [] : [heading])).toHaveLength(0);
    expect(await texts(pane)).toContain("no matching calls");
  });

  test("T10 with calls kept and no filter, the Timeline heading ends with a clear button", async ($, on) => {
    const world = worldOf(on);
    await runCommand($, world, "echo first");

    const pane = await paneOnTab($, "Activity");

    const heading = headingLineOf(await lines(pane), "Timeline");
    expect(clearButtonsOf(heading === undefined ? [] : [heading])).toHaveLength(1);
  });

  test("A3 pressing clear empties the timeline, the failed block and the tool mix", async ($, on) => {
    const world = worldOf(on);
    await ranBeforeClear($, world);
    const pane = await paneOnTab($, "Activity");

    await pressClear(pane, world);

    const shown = await texts(pane);
    expect(await callRowKeys(pane)).toEqual([]);
    expect(headingLineOf(await lines(pane), "Failed")).toBeUndefined();
    expect(shown).toContain("no calls yet");
    expect(shown).toContain("nothing run yet");
  });

  test("A4 a call that runs after the press is the only row in the timeline", async ($, on) => {
    const world = worldOf(on);
    await ranBeforeClear($, world);
    const pane = await paneOnTab($, "Activity");
    await pressClear(pane, world);

    await runCommand($, world, "echo later");

    const shown = await texts(pane);
    expect(await callRowKeys(pane)).toHaveLength(1);
    expect(shown.some((text) => text.includes("echo later"))).toBe(true);
    expect(shown.some((text) => text.includes("b.ts"))).toBe(false);
  });

  test("A5 after the press the stats line and the tool mix count only later calls", async ($, on) => {
    const world = worldOf(on);
    await ranBeforeClear($, world);
    const pane = await paneOnTab($, "Activity");
    const before = statsOf(await texts(pane));
    await pressClear(pane, world);

    await editFile($, world, "/work/c.ts", 2, 0);

    const shown = await texts(pane);
    expect(before).toMatch(/3 tools · 2 files · \+4 · −1 · 1 error$/);
    expect(statsOf(shown)).toMatch(/1 tool · 1 file · \+2 · −0$/);
    expect(shown.some((text) => text.includes("Edit 1"))).toBe(true);
    expect(shown.some((text) => /Read 1|Bash 1/.test(text))).toBe(false);
  });

  test("A6 after the press the elapsed time starts again and adds only later turns", async ($, on) => {
    const world = worldOf(on);
    await runCommand($, world, "echo first");
    await finishTurn($, FIVE_SECONDS);
    const pane = await paneOnTab($, "Activity");
    const before = elapsedOf(await texts(pane));
    await pressClear(pane, world);
    const afterPress = elapsedOf(await texts(pane));

    await runCommand($, world, "echo second");
    await finishTurn($, TWO_SECONDS);

    expect([before, afterPress, elapsedOf(await texts(pane))]).toEqual(["5s", "0ms", "2s"]);
  });

  test(
    "A7 with more calls before the press than are kept, exactly the calls after it show",
    { timeoutMs: SLOW_TEST_MS },
    async ($, on) => {
      const world = worldOf(on);
      await runCommands($, world, CALLS_BEYOND_KEPT, "old");
      const pane = await paneOnTab($, "Activity");
      await pressClear(pane, world);

      await runCommands($, world, 3, "new");

      const shown = await texts(pane);
      expect(await callRowKeys(pane)).toHaveLength(3);
      expect(shown.some((text) => text.includes("old"))).toBe(false);
      expect(statsOf(shown)).toMatch(/^\S+ · 3 tools$/);
    },
  );

  test("A8 a second press hides what ran after the first and the stats start again", async ($, on) => {
    const world = worldOf(on);
    await runCommand($, world, "echo one");
    const pane = await paneOnTab($, "Activity");
    await pressClear(pane, world);
    await runCommand($, world, "echo two");
    await pressClear(pane, world);

    await runCommand($, world, "echo three");

    const shown = await texts(pane);
    expect(await callRowKeys(pane)).toHaveLength(1);
    expect(shown.some((text) => text.includes("echo three"))).toBe(true);
    expect(shown.some((text) => text.includes("echo two"))).toBe(false);
    expect(statsOf(shown)).toMatch(/^\S+ · 1 tool$/);
  });

  test("A9 the Failed, Tool mix and Timeline headings come in that order with exactly one blank row above each", async ($, on) => {
    const world = worldOf(on);
    await ranBeforeClear($, world);

    const pane = await paneOnTab($, "Activity");

    const shown = await lines(pane);
    expect(headingOrder(shown, SECTIONS)).toEqual(SECTIONS);
    expect(SECTIONS.map((title) => blankRowsAbove(shown, title))).toEqual([1, 1, 1]);
  });

  test("A16 a subagent's edit adds one to the header tool count and the tool mix, and draws one timeline row", async ($, on) => {
    const world = worldOf(on);
    const agentId = await spawnAgent($, world, "explore");
    await editFile($, world, "/work/a.ts", 1, 0, agentId);
    await world.clock.advance(FLUSH_MS);

    const pane = await paneOnTab($, "Activity");

    const shown = await texts(pane);
    expect(statsOf(shown)).toMatch(/ · 1 tool$/);
    expect(shown.some((text) => text.includes("Edit 1"))).toBe(true);
    expect(await callRowKeys(pane)).toHaveLength(1);
  });

  test("A17 a subagent's hand-back draws no timeline row and leaves the header tool count alone", async ($, on) => {
    const world = worldOf(on);
    await readFile($, world, "/work/a.ts");
    const agentId = await spawnAgent($, world, "explore");
    await $.tool.call({ tool: "SubagentHandback", tool_use_id: "handback-1", agentId } as never);
    await world.clock.advance(FLUSH_MS);

    const pane = await paneOnTab($, "Activity");

    expect(await callRowKeys(pane)).toHaveLength(1);
    expect(statsOf(await texts(pane))).toMatch(/ · 1 tool · 1 file$/);
  });

  test("A18 after the press the header tool count equals the timeline rows, a subagent call among them", async ($, on) => {
    const world = worldOf(on);
    await runCommand($, world, "echo before");
    const pane = await paneOnTab($, "Activity");
    await pressClear(pane, world);
    const agentId = await spawnAgent($, world, "explore");
    await editFile($, world, "/work/a.ts", 1, 0, agentId);
    await world.clock.advance(FLUSH_MS);
    await runCommand($, world, "echo after");

    const shown = await texts(pane);
    expect(await callRowKeys(pane)).toHaveLength(2);
    expect(statsOf(shown)).toMatch(/ · 2 tools$/);
  });
});

describe("the counts under a finished main reply", () => {
  test("A10 a subagent's turn start keeps the main reply's read and changed file counts", async ($, on) => {
    const world = worldOf(on);
    answerTurnStarts(on);
    await $.turn.start({ text: "go", turnId: MAIN_TURN });
    await readFile($, world, "/work/a.ts");
    await editFile($, world, "/work/b.ts", 4, 1);
    const agentId = await spawnAgent($, world, "explore");

    await $.turn.start({ text: "", turnId: AGENT_TURN, agentId });
    await finishTurn($, FIVE_SECONDS);

    expect(await footerOf($)).toContain("1 file read · 1 file changed");
  });

  test("A11 a main turn start clears the counts of the reply before it", async ($, on) => {
    const world = worldOf(on);
    answerTurnStarts(on);
    await $.turn.start({ text: "first", turnId: MAIN_TURN });
    await readFile($, world, "/work/a.ts");
    await $.turn.start({ text: "second", turnId: NEXT_MAIN_TURN });

    await finishTurn($, FIVE_SECONDS);

    expect(await footerOf($)).toBe("Completed · 5s");
  });

  test("D8 a turn that read three files and changed none ends with the read count alone", async ($, on) => {
    const world = worldOf(on);
    answerTurnStarts(on);
    await $.turn.start({ text: "go", turnId: MAIN_TURN });
    await readFile($, world, "/work/a.ts");
    await readFile($, world, "/work/b.ts");
    await readFile($, world, "/work/c.ts");

    await finishTurn($, FIVE_SECONDS);

    expect(await footerOf($)).toBe("Completed · 5s · 3 files read");
  });

  test("D9 a turn that changed two files and read none ends with the changed count alone", async ($, on) => {
    const world = worldOf(on);
    answerTurnStarts(on);
    await $.turn.start({ text: "go", turnId: MAIN_TURN });
    await editFile($, world, "/work/a.ts", 1, 0);
    await editFile($, world, "/work/b.ts", 1, 0);

    await finishTurn($, FIVE_SECONDS);

    expect(await footerOf($)).toBe("Completed · 5s · 2 files changed");
  });

  test("D10 a turn that read exactly one file and changed none says file in the singular", async ($, on) => {
    const world = worldOf(on);
    answerTurnStarts(on);
    await $.turn.start({ text: "go", turnId: MAIN_TURN });
    await readFile($, world, "/work/a.ts");

    await finishTurn($, FIVE_SECONDS);

    expect(await footerOf($)).toBe("Completed · 5s · 1 file read");
  });
});

function answerTurnStarts(on: On): void {
  on("turn.start", (_$, e) => ({ turnId: e.turnId }));
}

async function footerOf($: Engine): Promise<string> {
  const footer = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "TurnDuration",
    props: { word: "Completed", durationMs: FIVE_SECONDS },
    viewport: { columns: COLUMNS, rows: TALL_ROWS },
  });
  return shownTexts(await footer.drawn()).join("");
}

describe("activity change chips", () => {
  test("A12 an edit with no lines added or removed shows no +N and no −N in the stats line", async ($, on) => {
    const world = worldOf(on);

    await editFile($, world, "/work/a.ts", 0, 0);

    const shown = await texts(await paneOnTab($, "Activity"));
    expect(statsOf(shown)).toMatch(/1 tool · 1 file$/);
  });

  test("A13 an edit that only adds lines shows +N and −0 in the stats line, with −0 drawn muted", async ($, on) => {
    const world = worldOf(on);

    await editFile($, world, "/work/a.ts", 3, 0);

    const pane = await paneOnTab($, "Activity");
    expect(statsOf(await texts(pane))).toMatch(/1 tool · 1 file · \+3 · −0$/);
    expect(await chipColourOf(pane, "−0")).toBe(inkFor("dark").muted);
  });

  test("A14 an edit that only removes lines shows +0 and −N in the stats line, with +0 drawn muted", async ($, on) => {
    const world = worldOf(on);

    await editFile($, world, "/work/a.ts", 0, 2);

    const pane = await paneOnTab($, "Activity");
    expect(statsOf(await texts(pane))).toMatch(/1 tool · 1 file · \+0 · −2$/);
    expect(await chipColourOf(pane, "+0")).toBe(inkFor("dark").muted);
  });

  test("A15 an edit that adds and removes lines shows +N then −N in the stats line", async ($, on) => {
    const world = worldOf(on);

    await editFile($, world, "/work/a.ts", 3, 2);

    const shown = await texts(await paneOnTab($, "Activity"));
    expect(statsOf(shown)).toMatch(/1 tool · 1 file · \+3 · −2$/);
  });

  test("S22a an edit that adds 4 lines and removes none shows +4 · −0, with −0 drawn muted", async ($, on) => {
    const world = worldOf(on);

    await editFile($, world, "/work/a.ts", 4, 0);

    const pane = await paneOnTab($, "Activity");
    expect(statsOf(await texts(pane))).toMatch(/1 tool · 1 file · \+4 · −0$/);
    expect(await chipColourOf(pane, "−0")).toBe(inkFor("dark").muted);
  });

  test("S22b an edit that removes 3 lines and adds none shows +0 · −3, with +0 drawn muted", async ($, on) => {
    const world = worldOf(on);

    await editFile($, world, "/work/a.ts", 0, 3);

    const pane = await paneOnTab($, "Activity");
    expect(statsOf(await texts(pane))).toMatch(/1 tool · 1 file · \+0 · −3$/);
    expect(await chipColourOf(pane, "+0")).toBe(inkFor("dark").muted);
  });

  test("S22c two edits with no changes show neither +N nor −N in the stats line", async ($, on) => {
    const world = worldOf(on);

    await editFile($, world, "/work/a.ts", 0, 0);
    await editFile($, world, "/work/b.ts", 0, 0);

    const shown = await texts(await paneOnTab($, "Activity"));
    expect(statsOf(shown)).toMatch(/2 tools · 2 files$/);
  });

  test("S22d an edit with added and removed lines draws every minus sign in the Activity tab as −, never a hyphen", async ($, on) => {
    const world = worldOf(on);

    await editFile($, world, "/work/a.ts", 1, 2);

    const shown = (await texts(await paneOnTab($, "Activity"))).join("\n");
    expect(shown).toContain("−2");
    expect(shown).not.toMatch(/(^|[^\w])-\d/);
  });
});

async function ranBeforeClear($: Engine, world: World): Promise<void> {
  await readFile($, world, "/work/a.ts");
  await editFile($, world, "/work/b.ts", 4, 1);
  await runCommand($, world, FAILING_COMMAND);
}

async function runCommands($: Engine, world: World, count: number, word: string): Promise<void> {
  for (let i = 0; i < count; i++) await runCommand($, world, `echo ${word} ${i}`);
}

function blankRowsAbove(shown: Line[], title: string): number {
  const heading = headingLineOf(shown, title);
  const at = heading === undefined ? -1 : shown.indexOf(heading);
  let blanks = 0;
  while (at - blanks - 1 >= 0 && shown[at - blanks - 1]?.text === "") blanks += 1;
  return at === -1 ? -1 : blanks;
}

function statsOf(shown: string[]): string {
  return shown.find((text) => STATS_LINE.test(text)) ?? "";
}

function elapsedOf(shown: string[]): string {
  return ELAPSED.exec(statsOf(shown))?.[0] ?? "";
}

async function chipColourOf(pane: Pane, text: string): Promise<unknown> {
  const nodes = (await pane.findAll({ type: "Text", text })) as unknown as ChipNode[];
  return nodes.find((node) => ownTextOf(node) === text)?.props?.color;
}

function ownTextOf(node: ChipNode): string {
  return (node.children ?? [])
    .filter((child): child is string => typeof child === "string")
    .join("");
}
