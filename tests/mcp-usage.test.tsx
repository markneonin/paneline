import { describe, expect, mock, test } from "claude-code/testing";
import type { On, SessionContextBreakdown } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { palette } from "../hooks/palette";
import { colouredPieces, screenRows } from "./band-screen";
import { pressPagedTab } from "./clear-world";
import { collect, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import {
  bodyOf,
  detailAfter,
  failedTextOf,
  usesTextOf,
  isDim,
  hollowRowOf,
  lines,
  partText,
  pressAction,
  pressNode,
  pressServer,
  rowOrFail,
  serverRowsOf,
  settle,
  summaryOf,
  tokenTextOf,
  toolRowsOf,
  usesOf,
} from "./mcp-tree";
import type { Line } from "./skills-tree";
import { isHeavy } from "./weight";

type Pane = Mounted<"terminal", "Pane">;
type Answer = { error: string } | { deny: string };
type World = {
  commands: string[];
  replies: Map<string, Answer>;
  nextCallId: () => string;
  storedValue: (key: string) => unknown;
  forgetState: () => void;
  changeCwd: (folder: string) => void;
  fullCalls: () => number;
  releaseFull: () => void;
};
type WorldOptions = {
  tools?: unknown[];
  storeSeed?: Record<string, unknown>;
  theme?: string;
  files?: Record<string, string>;
  hasMemoryState?: boolean;
  summaryTools?: unknown[];
  holdFull?: boolean;
};

const COLUMNS = 60;
const PANE_ROWS = 40;
const NOW = 200_000;
const HOME = "/h/u";
const CWD = "/work";
const AGENT = "agent-1";
const HEADINGS = ["Project MCPs", "Local MCPs", "User MCPs", "claude.ai", "Built-in MCPs"];
const ACTIONS_ROW = "reconnect disable";
const CLEAR_LABEL = "clear usage stats";
const TITLE_LINE = /^Manage MCP servers\b/u;
const ERROR: Answer = { error: "boom" };
const DENIED: Answer = { deny: "not allowed here" };
const LONG_SERVER = toolsOf("long_named_server_with_many_failures", ["search"]);
const LONG_SEARCH = "mcp__long_named_server_with_many_failures__search";
const LONG_NAME = "long_named_server_with_many_failures";
const MEDIUM_NAME = "claude_ai_Claude_Docs";
const DEFERRED_SERVER = "claude-in-chrome";
const LIVE_SERVER = "paneline";
const WIDE_COLUMNS = 120;

const LINEAR = toolsOf("linear", ["create-issue", "get-issue", "list-issues", "update-issue"]);
const DOCS = toolsOf("docs", ["search"]);
const RUNPOD = toolsOf("plugin_runpod_runpod", ["list-pods"]);
const GROUPED = toolsOf("user-docs", ["t"]).concat(
  toolsOf("local-notes", ["t"]),
  toolsOf("proj-db", ["t"]),
  toolsOf("plugin_runpod_runpod", ["t"]),
  toolsOf("claude_ai_Trello", ["t"]),
);
const GROUP_FILES = {
  [`${HOME}/.claude.json`]: JSON.stringify({
    mcpServers: { "user-docs": {} },
    projects: { [CWD]: { mcpServers: { "local-notes": {} } } },
  }),
  [`${CWD}/.mcp.json`]: JSON.stringify({ mcpServers: { "proj-db": {} } }),
};
const DISABLED_FILES = {
  [`${HOME}/.claude.json`]: JSON.stringify({
    projects: { [CWD]: { disabledMcpServers: ["linear"] } },
  }),
};

describe("mcp tab usage rows", () => {
  test("U1 a closed server row shows its tool count and the uses of all its tools, dim, with nothing opened", async ($, on) => {
    const world = worldOf(on, { tools: [...LINEAR, ...DOCS] });
    await startIn($, CWD);
    await useTools($, world, { "mcp__linear__get-issue": 2, "mcp__linear__list-issues": 1 });

    const pane = await paneOnTab($, "MCP");

    const shown = await lines(pane);
    const linear = rowOrFail(shown, "linear");
    expect(summaryOf(shown, "linear")).toEqual({ glyph: "▸", tools: "4 tools", uses: "3 uses" });
    expect(
      linear.line.parts.filter((part) => !isDim(part) && partText(part).includes("tools")),
    ).toEqual([]);
    expect(bodyOf(shown, "linear")).toEqual([]);
    expect(bodyOf(shown, "docs")).toEqual([]);
    expect(shown.some((line) => line.text.includes("reconnect"))).toBe(false);
  });

  test("U2 a server with one tool called once shows 1 tool and 1 use", async ($, on) => {
    const world = worldOf(on, { tools: [...LINEAR, ...DOCS] });
    await startIn($, CWD);
    await useTools($, world, { mcp__docs__search: 1 });

    const pane = await paneOnTab($, "MCP");

    expect(summaryOf(await lines(pane), "docs")).toEqual({
      glyph: "▸",
      tools: "1 tool",
      uses: "1 use",
    });
  });

  test("U3 a server never used shows 0 uses", async ($, on) => {
    worldOf(on, { tools: [...LINEAR, ...DOCS] });
    await startIn($, CWD);

    const pane = await paneOnTab($, "MCP");

    const shown = await lines(pane);
    expect(summaryOf(shown, "docs")).toEqual({ glyph: "▸", tools: "1 tool", uses: "0 uses" });
    expect(summaryOf(shown, "linear")).toEqual({ glyph: "▸", tools: "4 tools", uses: "0 uses" });
  });

  test("U4 clicking a server opens it, the old actions row comes first and then the tools", async ($, on) => {
    worldOf(on, { tools: LINEAR });
    await startIn($, CWD);
    const pane = await paneOnTab($, "MCP");

    await pressServer(pane, "linear");

    const shown = await lines(pane);
    const linear = rowOrFail(shown, "linear");
    const [actions, firstTool] = bodyOf(shown, "linear");
    expect(linear.glyph).toBe("▾");
    expect(actions?.text).toBe(ACTIONS_ROW);
    expect(actions?.parts.map((part) => part.props?.dimColor)).toEqual([true, true]);
    expect(toolRowsOf(bodyOf(shown, "linear"))).toHaveLength(4);
    expect(firstTool?.indent).toBeGreaterThan(linear.line.indent);
  });

  test("U5 the opened tools show short names, most used first, ties by name, never-used last and dim", async ($, on) => {
    const world = worldOf(on, { tools: LINEAR });
    await startIn($, CWD);
    await useTools($, world, {
      "mcp__linear__get-issue": 5,
      "mcp__linear__list-issues": 2,
      "mcp__linear__create-issue": 2,
    });
    const pane = await paneOnTab($, "MCP");

    await pressServer(pane, "linear");

    const tools = toolRowsOf(bodyOf(await lines(pane), "linear"));
    expect(tools.map((tool) => [tool.name, tool.uses])).toEqual([
      ["get-issue", "5 uses"],
      ["create-issue", "2 uses"],
      ["list-issues", "2 uses"],
      ["update-issue", "0 uses"],
    ]);
    expect(tools.slice(0, 3).every((tool) => tool.line.parts.some((part) => !isDim(part)))).toBe(
      true,
    );
    expect(tools[3]?.line.parts.every(isDim)).toBe(true);
  });

  test("U6 clicking an opened server again closes it", async ($, on) => {
    const world = worldOf(on, { tools: LINEAR });
    await startIn($, CWD);
    await useTools($, world, { "mcp__linear__get-issue": 1 });
    const pane = await paneOnTab($, "MCP");
    const closed = await lines(pane);

    await pressServer(pane, "linear");
    const opened = await lines(pane);
    await pressServer(pane, "linear");

    const closedAgain = await lines(pane);
    expect(bodyOf(opened, "linear")).not.toEqual([]);
    expect(closedAgain.map((line) => line.text)).toEqual(closed.map((line) => line.text));
    expect(rowOrFail(closedAgain, "linear").glyph).toBe("▸");
  });

  test("U8 several servers stay open at once, each with its own actions and tools", async ($, on) => {
    worldOf(on, { tools: [...LINEAR, ...DOCS] });
    await startIn($, CWD);
    const pane = await paneOnTab($, "MCP");

    await pressServer(pane, "linear");
    await pressServer(pane, "docs");

    const shown = await lines(pane);
    expect(bodyOf(shown, "linear").map((line) => line.text)).toEqual([
      ACTIONS_ROW,
      "create-issue 0 uses",
      "get-issue 0 uses",
      "list-issues 0 uses",
      "update-issue 0 uses",
    ]);
    expect(bodyOf(shown, "docs").map((line) => line.text)).toEqual([ACTIONS_ROW, "search 0 uses"]);
  });

  test("U7 a plugin server shows under the name /mcp lists and its underscored tool calls count on it", async ($, on) => {
    const world = worldOf(on, { tools: RUNPOD });
    await startIn($, CWD);
    await useTools($, world, { "mcp__plugin_runpod_runpod__list-pods": 1 });
    const pane = await paneOnTab($, "MCP");

    await pressServer(pane, "plugin:runpod:runpod");

    const shown = await lines(pane);
    expect(summaryOf(shown, "plugin:runpod:runpod")).toEqual({
      glyph: "▾",
      tools: "1 tool",
      uses: "1 use",
    });
    expect(
      toolRowsOf(bodyOf(shown, "plugin:runpod:runpod")).map((tool) => [tool.name, tool.uses]),
    ).toEqual([["list-pods", "1 use"]]);
  });
});

describe("mcp tab counts per launch folder", () => {
  test("P1 calls in one project do not show in another and come back in the first", async ($, on) => {
    const world = worldOf(on, { tools: LINEAR, hasMemoryState: true });
    await startIn($, "/work/a");
    await useTools($, world, { "mcp__linear__get-issue": 2 });
    world.forgetState();
    await startIn($, "/work/b");
    const inB = await paneOnTab($, "MCP");
    const usesInB = usesOf(await lines(inB), "linear");
    await useTools($, world, { "mcp__linear__list-issues": 1 });
    await settle(inB);
    const usesInBAfterCall = usesOf(await lines(inB), "linear");
    await inB.unmount();
    world.forgetState();
    await startIn($, "/work/a");

    const backInA = await paneOnTab($, "MCP");

    expect([usesInB, usesInBAfterCall]).toEqual(["0 uses", "1 use"]);
    expect(usesOf(await lines(backInA), "linear")).toBe("2 uses");
  });

  test("P2 a cd during the session does not move the counts to the new folder", async ($, on) => {
    const world = worldOf(on, { tools: LINEAR });
    await startIn($, CWD);
    await useTools($, world, { "mcp__linear__get-issue": 1 });
    const pane = await paneOnTab($, "MCP");

    world.changeCwd(`${CWD}/sub`);
    await useTools($, world, { "mcp__linear__get-issue": 1 });
    await settle(pane);

    expect(usesOf(await lines(pane), "linear")).toBe("2 uses");
  });

  test("P3 a call made by an agent counts like a call made by the main chat", async ($, on) => {
    const world = worldOf(on, { tools: LINEAR });
    await startIn($, CWD);
    await useTools($, world, { "mcp__linear__get-issue": 1 });
    await useTools($, world, { "mcp__linear__get-issue": 2 }, AGENT);

    const pane = await paneOnTab($, "MCP");

    expect(usesOf(await lines(pane), "linear")).toBe("3 uses");
  });

  test("P4 tools that are not mcp tools are not counted", async ($, on) => {
    const world = worldOf(on, { tools: LINEAR });
    await startIn($, CWD);

    await useTools($, world, { Bash: 2, Read: 1, "mcp__linear__get-issue": 1 });

    const pane = await paneOnTab($, "MCP");
    expect(usesOf(await lines(pane), "linear")).toBe("1 use");
    expect(world.storedValue("toolUses")).toEqual({ [CWD]: { "mcp__linear__get-issue": 1 } });
  });

  test("P5 a call made while the tab is open shows in the row after the next redraw", async ($, on) => {
    const world = worldOf(on, { tools: LINEAR });
    await startIn($, CWD);
    await useTools($, world, { "mcp__linear__get-issue": 1 });
    const pane = await paneOnTab($, "MCP");
    const before = usesOf(await lines(pane), "linear");

    await useTools($, world, { "mcp__linear__get-issue": 2 });
    await settle(pane);

    expect([before, usesOf(await lines(pane), "linear")]).toEqual(["1 use", "3 uses"]);
  });

  test("P6 after a new session in the same folder the uses of the earlier session are still shown", async ($, on) => {
    const world = worldOf(on, { tools: LINEAR, hasMemoryState: true });
    await startIn($, CWD);
    await useTools($, world, { "mcp__linear__get-issue": 3, "mcp__linear__list-issues": 1 });
    const first = await paneOnTab($, "MCP");
    await first.unmount();

    world.forgetState();
    await startIn($, CWD);
    const second = await paneOnTab($, "MCP");

    expect(usesOf(await lines(second), "linear")).toBe("4 uses");
  });

  test("P7 every mcp call is added under the launch folder in the toolUses store key by its full name", async ($, on) => {
    const world = worldOf(on, { tools: LINEAR });
    await startIn($, CWD);

    await useTools($, world, { "mcp__linear__get-issue": 2, "mcp__linear__list-issues": 1 });

    expect(world.storedValue("toolUses")).toEqual({
      [CWD]: { "mcp__linear__get-issue": 2, "mcp__linear__list-issues": 1 },
    });
  });

  test("P8 a call adds to the counts an earlier session left, shown before any call, and leaves other folders alone", async ($, on) => {
    const world = worldOf(on, {
      tools: LINEAR,
      storeSeed: {
        toolUses: {
          [CWD]: { "mcp__linear__get-issue": 5, "mcp__linear__list-issues": 2 },
          "/other": { "mcp__linear__get-issue": 9 },
        },
      },
    });
    await startIn($, CWD);
    const pane = await paneOnTab($, "MCP");
    const before = usesOf(await lines(pane), "linear");

    await useTools($, world, { "mcp__linear__get-issue": 1, "mcp__linear__create-issue": 1 });
    await settle(pane);

    expect([before, usesOf(await lines(pane), "linear")]).toEqual(["7 uses", "9 uses"]);
    expect(world.storedValue("toolUses")).toEqual({
      [CWD]: {
        "mcp__linear__get-issue": 6,
        "mcp__linear__list-issues": 2,
        "mcp__linear__create-issue": 1,
      },
      "/other": { "mcp__linear__get-issue": 9 },
    });
  });
});

describe("mcp tab heading look", () => {
  test("H1 in the dark theme group headings are bold plain text colour, not periwinkle", async ($, on) => {
    worldOf(on, { tools: GROUPED, files: GROUP_FILES, theme: "dark" });
    await startIn($, CWD);

    const pane = await paneOnTab($, "MCP");

    expect(await headingColours(pane)).toEqual(HEADINGS.map(() => palette.text));
  });

  test("H2 in the light theme group headings are bold plain text colour, not periwinkle", async ($, on) => {
    worldOf(on, { tools: GROUPED, files: GROUP_FILES, theme: "light" });
    await startIn($, CWD);

    const pane = await paneOnTab($, "MCP");

    expect(await headingColours(pane)).toEqual(HEADINGS.map(() => palette.text));
  });
});

describe("mcp tab keeps what it did", () => {
  test("R1 reconnect and disable from an opened server run for that server", async ($, on) => {
    const world = worldOf(on, { tools: [...LINEAR, ...DOCS] });
    await startIn($, CWD);
    const pane = await paneOnTab($, "MCP");

    await pressServer(pane, "linear");
    await pressAction(pane, "linear", "reconnect");
    await pressServer(pane, "docs");
    await pressAction(pane, "docs", "disable");

    expect(world.commands).toEqual(["reconnect linear", "disable docs"]);
  });

  test("R2 in the light theme the server name is not dim, an opened used tool is not dim and a never-used tool is dim", async ($, on) => {
    const world = worldOf(on, { tools: LINEAR, theme: "light" });
    await startIn($, CWD);
    await useTools($, world, { "mcp__linear__get-issue": 1 });
    const pane = await paneOnTab($, "MCP");

    await pressServer(pane, "linear");

    const shown = await lines(pane);
    const nameParts = rowOrFail(shown, "linear").line.parts.filter((part) =>
      partText(part).includes("linear"),
    );
    const tools = toolRowsOf(bodyOf(shown, "linear"));
    expect(nameParts).toHaveLength(1);
    expect(nameParts.some(isDim)).toBe(false);
    expect(tools[0]?.line.parts.some((part) => !isDim(part))).toBe(true);
    expect(tools[3]?.line.parts.every(isDim)).toBe(true);
  });

  test("R3 a server the project disabled stays listed hollow and clicking it offers enable", async ($, on) => {
    const world = worldOf(on, { tools: DOCS, files: DISABLED_FILES });
    await startIn($, CWD);
    const pane = await paneOnTab($, "MCP");
    const hollow = hollowRowOf(await lines(pane), "linear");
    const offeredBefore = await buttonLabels(pane);

    await pressNode(
      pane,
      hollow?.parts.find((part) => part.type === "Button"),
    );
    await pressAction(pane, "linear", "enable");

    expect(hollow).toBeDefined();
    expect(offeredBefore).not.toContain("enable");
    expect(world.commands).toEqual(["enable linear"]);
  });
});

describe("mcp tab clear usage stats", () => {
  test("C1 with uses in this project a dim clear usage stats button ends the Manage MCP servers line and no group heading holds it", async ($, on) => {
    const world = worldOf(on, { tools: [...LINEAR, ...DOCS] });
    await startIn($, CWD);
    await useTools($, world, { "mcp__linear__get-issue": 1 });

    const pane = await paneOnTab($, "MCP");

    const shown = await lines(pane);
    const holders = shown.filter((line) => clearButtonsOf([line]).length > 0);
    const headingRows = shown.filter((line) =>
      HEADINGS.some((heading) => line.text.startsWith(heading)),
    );
    expect(clearButtonsOf(shown)).toHaveLength(1);
    expect(holders.map((line) => line.text)).toEqual([expect.stringMatching(TITLE_LINE)]);
    expect(holders[0]?.parts.at(-1)).toBe(clearButtonsOf(shown)[0]);
    expect(clearButtonsOf(shown).every(isDim)).toBe(true);
    expect(headingRows.length).toBeGreaterThan(0);
    expect(headingRows.flatMap((line) => clearButtonsOf([line]))).toEqual([]);
  });

  test("C2 with no use in this project there is no clear button even when another project has uses, it shows after the first use", async ($, on) => {
    const world = worldOf(on, {
      tools: LINEAR,
      storeSeed: { toolUses: { "/other": { "mcp__linear__get-issue": 4 } } },
    });
    await startIn($, CWD);
    const pane = await paneOnTab($, "MCP");
    const before = clearButtonsOf(await lines(pane));

    await useTools($, world, { "mcp__linear__get-issue": 1 });
    await settle(pane);

    expect(before).toEqual([]);
    expect(clearButtonsOf(await lines(pane))).toHaveLength(1);
  });

  test("C3 one click sets every server row to 0 uses and the button disappears", async ($, on) => {
    const world = worldOf(on, { tools: [...LINEAR, ...DOCS] });
    await startIn($, CWD);
    await useTools($, world, { "mcp__linear__get-issue": 3, mcp__docs__search: 2 });
    const pane = await paneOnTab($, "MCP");

    await pressClear(pane);

    const shown = await lines(pane);
    expect([usesOf(shown, "linear"), usesOf(shown, "docs")]).toEqual(["0 uses", "0 uses"]);
    expect(clearButtonsOf(shown)).toEqual([]);
  });

  test("C4 the wipe holds in a new session of the same folder and the other project keeps its counts", async ($, on) => {
    const world = worldOf(on, { tools: LINEAR, hasMemoryState: true });
    await startIn($, "/work/a");
    await useTools($, world, { "mcp__linear__get-issue": 2 });
    world.forgetState();
    await startIn($, "/work/b");
    await useTools($, world, { "mcp__linear__get-issue": 4 });
    const inB = await paneOnTab($, "MCP");
    await pressClear(inB);
    await inB.unmount();
    world.forgetState();
    await startIn($, "/work/b");
    const backInB = await paneOnTab($, "MCP");
    const shownB = await lines(backInB);
    await backInB.unmount();
    world.forgetState();
    await startIn($, "/work/a");

    const backInA = await paneOnTab($, "MCP");

    expect(usesOf(shownB, "linear")).toBe("0 uses");
    expect(clearButtonsOf(shownB)).toEqual([]);
    expect(usesOf(await lines(backInA), "linear")).toBe("2 uses");
  });

  test("C5 clearing enables, disables and removes no server", async ($, on) => {
    const world = worldOf(on, { tools: [...LINEAR, ...DOCS] });
    await startIn($, CWD);
    await useTools($, world, { "mcp__linear__get-issue": 3 });
    const pane = await paneOnTab($, "MCP");

    await pressClear(pane);

    const shown = await lines(pane);
    expect(world.commands).toEqual([]);
    expect(serverRowsOf(shown).map((row) => [row.name, row.tools])).toEqual([
      ["linear", "4 tools"],
      ["docs", "1 tool"],
    ]);
  });

  test("C6 a call after the wipe counts from zero and the button comes back", async ($, on) => {
    const world = worldOf(on, { tools: LINEAR });
    await startIn($, CWD);
    await useTools($, world, { "mcp__linear__get-issue": 3 });
    const pane = await paneOnTab($, "MCP");
    await pressClear(pane);

    await useTools($, world, { "mcp__linear__list-issues": 1 });
    await settle(pane);

    const shown = await lines(pane);
    expect(usesOf(shown, "linear")).toBe("1 use");
    expect(clearButtonsOf(shown)).toHaveLength(1);
  });
});

describe("mcp tab failed calls", () => {
  test("F1 two of three calls answered with an error show 3 uses and 2 failed in the failed colour", async ($, on) => {
    const world = worldOf(on, { tools: LINEAR });
    await startIn($, CWD);
    await useTools($, world, { "mcp__linear__get-issue": 1 });
    await answerCalls($, world, "mcp__linear__list-issues", ERROR, 1);
    await answerCalls($, world, "mcp__linear__create-issue", ERROR, 1);

    const pane = await paneOnTab($, "MCP");

    const shown = await lines(pane);
    const linear = rowOrFail(shown, "linear").line;
    expect([usesOf(shown, "linear"), failedTextOf(linear)]).toEqual(["3 uses", "2 failed"]);
    expect(failedColoursOf(linear)).toEqual([palette.failed]);
  });

  test("F2 a call a hook or permission refused counts as a use, not as a failure: one error and one refusal read 2 uses and 1 failed", async ($, on) => {
    const world = worldOf(on, { tools: LINEAR });
    await startIn($, CWD);
    await answerCalls($, world, "mcp__linear__list-issues", ERROR, 1);
    await answerCalls($, world, "mcp__linear__create-issue", DENIED, 1);

    const pane = await paneOnTab($, "MCP");

    const shown = await lines(pane);
    expect([usesOf(shown, "linear"), failedTextOf(rowOrFail(shown, "linear").line)]).toEqual([
      "2 uses",
      "1 failed",
    ]);
  });

  test("F3 a server with no failed calls shows no failed text while its neighbour with failures shows its count", async ($, on) => {
    const world = worldOf(on, { tools: [...LINEAR, ...DOCS] });
    await startIn($, CWD);
    await answerCalls($, world, "mcp__linear__list-issues", ERROR, 1);
    await useTools($, world, { mcp__docs__search: 2 });

    const pane = await paneOnTab($, "MCP");

    const shown = await lines(pane);
    expect([
      failedTextOf(rowOrFail(shown, "linear").line),
      failedTextOf(rowOrFail(shown, "docs").line),
    ]).toEqual(["1 failed", undefined]);
  });

  test("F4 the summary line adds the failed calls of all servers and shows that sum in the failed colour", async ($, on) => {
    const world = worldOf(on, { tools: [...LINEAR, ...DOCS] });
    await startIn($, CWD);
    await answerCalls($, world, "mcp__linear__list-issues", ERROR, 2);
    await answerCalls($, world, "mcp__docs__search", ERROR, 1);

    const pane = await paneOnTab($, "MCP");

    const summary = summaryLineOf(await lines(pane));
    expect(summary.text).toBe("2 servers · 3 failed");
    expect(failedColoursOf(summary)).toEqual([palette.failed]);
  });

  test("F5 a server turned off for this project still shows the failed calls made to it on its row", async ($, on) => {
    const world = worldOf(on, { tools: DOCS, files: DISABLED_FILES });
    await startIn($, CWD);
    await useTools($, world, { "mcp__linear__get-issue": 1 });
    await answerCalls($, world, "mcp__linear__list-issues", ERROR, 1);

    const pane = await paneOnTab($, "MCP");

    const shown = await lines(pane);
    const turnedOffRow = hollowLineOf(shown, "linear");
    expect([failedTextOf(turnedOffRow), usesTextOf(turnedOffRow)]).toEqual(["1 failed", "2 uses"]);
  });

  test("F6 a restart in the same project keeps its failed counts", async ($, on) => {
    const world = worldOf(on, { tools: LINEAR, hasMemoryState: true });
    await startIn($, CWD);
    await answerCalls($, world, "mcp__linear__list-issues", ERROR, 2);
    const first = await paneOnTab($, "MCP");
    await first.unmount();
    world.forgetState();
    await startIn($, CWD);

    const second = await paneOnTab($, "MCP");

    expect(failedTextOf(rowOrFail(await lines(second), "linear").line)).toBe("2 failed");
    expect(world.storedValue("toolFailures")).toEqual({ [CWD]: { "mcp__linear__list-issues": 2 } });
  });

  test("F7 failed counts stay with their project: a second project's failures are not added to the first", async ($, on) => {
    const world = worldOf(on, { tools: LINEAR, hasMemoryState: true });
    await startIn($, "/work/a");
    await answerCalls($, world, "mcp__linear__list-issues", ERROR, 1);
    world.forgetState();
    await startIn($, "/work/b");
    await answerCalls($, world, "mcp__linear__list-issues", ERROR, 3);
    const inB = await paneOnTab($, "MCP");
    const failedInB = failedTextOf(rowOrFail(await lines(inB), "linear").line);
    await inB.unmount();
    world.forgetState();
    await startIn($, "/work/a");

    const backInA = await paneOnTab($, "MCP");

    expect([failedInB, failedTextOf(rowOrFail(await lines(backInA), "linear").line)]).toEqual([
      "3 failed",
      "1 failed",
    ]);
  });

  test("F8 clear usage stats removes the failed counts from every row and the summary, and they stay gone after a restart", async ($, on) => {
    const world = worldOf(on, { tools: [...LINEAR, ...DOCS], hasMemoryState: true });
    await startIn($, CWD);
    await answerCalls($, world, "mcp__linear__list-issues", ERROR, 2);
    await answerCalls($, world, "mcp__docs__search", ERROR, 1);
    const pane = await paneOnTab($, "MCP");
    const before = summaryLineOf(await lines(pane)).text;

    await pressClear(pane);
    const shown = await lines(pane);
    await pane.unmount();
    world.forgetState();
    await startIn($, CWD);
    const restarted = await paneOnTab($, "MCP");

    expect(before).toBe("2 servers · 3 failed");
    expect([
      summaryLineOf(shown).text,
      failedTextOf(rowOrFail(shown, "linear").line),
      failedTextOf(rowOrFail(shown, "docs").line),
    ]).toEqual(["2 servers", undefined, undefined]);
    expect(summaryLineOf(await lines(restarted)).text).toBe("2 servers");
  });

  test("F9 a store written before failed counts existed keeps its uses and gains failures from the first failed call", async ($, on) => {
    const world = worldOf(on, {
      tools: LINEAR,
      storeSeed: { toolUses: { [CWD]: { "mcp__linear__get-issue": 2 } } },
    });
    await startIn($, CWD);
    await answerCalls($, world, "mcp__linear__list-issues", ERROR, 1);

    const pane = await paneOnTab($, "MCP");

    const shown = await lines(pane);
    expect([usesOf(shown, "linear"), failedTextOf(rowOrFail(shown, "linear").line)]).toEqual([
      "3 uses",
      "1 failed",
    ]);
  });
});

describe("mcp tab narrow layout", () => {
  test("L1 at 60 columns a server with a long name and failures keeps its status mark whole at the start of its row", async ($, on) => {
    const world = worldOf(on, { tools: [...LONG_SERVER] });
    await startIn($, CWD);
    await answerCalls($, world, LONG_SEARCH, ERROR, 2);

    const pane = await paneOnTab($, "MCP");

    const boxes = await pane.findAll({ type: "Box" });
    const markBox = boxes.find((box) => childrenOf(box).some(isMarkText));
    const row = boxes.find((box) => String(box.props.key).endsWith("-name"));
    expect(markBox?.props.width).toBe(1);
    expect(markBox?.props.flexShrink).toBe(0);
    expect(row?.props.height).toBe(1);
  });
});

describe("mcp tab name column", () => {
  test("N1 at 120 columns a long server name is drawn whole on its button", async ($, on) => {
    const world = worldOf(on, { tools: [...LONG_SERVER] });
    await startIn($, CWD);
    await answerCalls($, world, LONG_SEARCH, ERROR, 2);

    const pane = await paneOnTab($, "MCP", 120);

    expect(await nameLabelsOf(pane)).toEqual([LONG_NAME]);
  });

  test("N1 at 60 columns a long server name is cut with an ellipsis, and its row fits the pane with its counts whole", async ($, on) => {
    const world = worldOf(on, { tools: [...LONG_SERVER] });
    await startIn($, CWD);
    await answerCalls($, world, LONG_SEARCH, ERROR, 2);

    const pane = await paneOnTab($, "MCP");

    const [label] = await nameLabelsOf(pane);
    expect(label).toMatch(/^long_named_\S*…$/u);
    expect(LONG_NAME.startsWith(label?.slice(0, -1) ?? "")).toBe(true);
    const row = (await lines(pane)).find((line) => line.text.startsWith("▸ ✔ long_named_"));
    expect(row?.text).toMatch(/^▸ ✔ long_named_\S*… · 2 failed\s+1 tool\s+100 tokens\s+2 uses$/u);
    expect([...(row?.text ?? "")].length).toBeLessThanOrEqual(COLUMNS);
  });
});

describe("mcp tab name per row", () => {
  test("N3 at 60 columns with a failing server the medium name stays whole beside a long name cut with an ellipsis, and every row fits the pane", async ($, on) => {
    const world = worldOf(on, { tools: [...LONG_SERVER, ...toolsOf(MEDIUM_NAME, ["search"])] });
    await startIn($, CWD);
    await answerCalls($, world, LONG_SEARCH, ERROR, 2);

    const pane = await paneOnTab($, "MCP");

    expect(await buttonLabelsOf(pane)).toEqual(
      expect.arrayContaining([MEDIUM_NAME, expect.stringMatching(/^long_named_\S*…$/u)]),
    );
    const rows = (await lines(pane)).filter((line) => line.text.startsWith("▸ "));
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => [...row.text].length > COLUMNS).map((row) => row.text)).toEqual([]);
  });

  test("N3b at 60 columns without a failing server the medium name is drawn whole beside a long name cut with an ellipsis, and every row fits the pane", async ($, on) => {
    worldOf(on, { tools: [...LONG_SERVER, ...toolsOf(MEDIUM_NAME, ["search"])] });
    await startIn($, CWD);

    const pane = await paneOnTab($, "MCP");

    expect(await buttonLabelsOf(pane)).toEqual(
      expect.arrayContaining([MEDIUM_NAME, expect.stringMatching(/^long_named_\S*…$/u)]),
    );
    const rows = (await lines(pane)).filter((line) => line.text.startsWith("▸ "));
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => [...row.text].length > COLUMNS).map((row) => row.text)).toEqual([]);
  });
});

describe("mcp tab failed separator", () => {
  test("N2 the separator before a failed count is drawn in the muted colour, only the count in the failed colour", async ($, on) => {
    const world = worldOf(on, { tools: [...LINEAR] });
    await startIn($, CWD);
    await answerCalls($, world, "mcp__linear__create-issue", ERROR, 1);

    const pane = await paneOnTab($, "MCP");

    const failedTexts = (await pane.findAll({ type: "Text" }))
      .filter((text) => textPropsOf(text).color === palette.failed)
      .map((text) => String(text.children));
    expect(failedTexts.length).toBeGreaterThan(0);
    expect(failedTexts).toEqual(failedTexts.map(() => "1 failed"));
  });
});

describe("mcp tab token source", () => {
  test("S1 the MCP server rows and the Context tab's MCP tools line report the same token total", async ($, on) => {
    worldOf(on, {
      tools: [toolWith("docs", "search", 800, true)],
      summaryTools: [toolWith("docs", "search", 500, true)],
    });
    await startIn($, CWD);
    const mcp = await paneOnTab($, "MCP");
    const rowTokens = tokenTextOf(rowOrFail(await lines(mcp), "docs").line);
    await mcp.unmount();

    const context = await paneOnTab($, "Context");
    const contextMcp = (await lines(context)).find((line) => /^└ \d+ tools? · /u.test(line.text));

    expect(contextMcp?.text, "the MCP tools line of the Context tab").toContain(rowTokens);
  });

  test("S2 until the usage read for the Context tab answers, a live server row shows no token figure, then shows it", async ($, on) => {
    const world = worldOf(on, {
      tools: [toolWith("docs", "search", 800, true)],
      summaryTools: [toolWith("docs", "search", 500, true)],
      holdFull: true,
    });
    await startIn($, CWD);
    const mcp = await paneOnTab($, "MCP");

    expect(rowOrFail(await lines(mcp), "docs").line.text).not.toMatch(/tokens/u);

    world.releaseFull();
    await settle(mcp);
    expect(tokenTextOf(rowOrFail(await lines(mcp), "docs").line)).toBe("800 tokens");
  });

  test("S3 opening the MCP tab after the usage is loaded for the Context tab asks for no new full usage read", async ($, on) => {
    const world = worldOf(on, { tools: [toolWith("docs", "search", 800, true)] });
    await startIn($, CWD);
    const context = await paneOnTab($, "Context");
    await settle(context);
    await context.unmount();

    const readsBefore = world.fullCalls();
    const mcp = await paneOnTab($, "MCP");
    await settle(mcp);

    expect(world.fullCalls()).toBe(readsBefore);
  });
});

describe("mcp tab number columns", () => {
  test("A11 a server with 8 tools and one with 12 tools put the word tools in the same column", async ($, on) => {
    worldOf(on, { tools: [...toolsOf("linear", namesOf(8)), ...toolsOf("docs", namesOf(12))] });
    await startIn($, CWD);

    const rows = screenRows(await (await paneOnTab($, "MCP")).drawn(), COLUMNS);

    expect(columnOfIn(rows, "linear", "tools")).toBe(columnOfIn(rows, "docs", "tools"));
  });

  test("A12 a server with 2 failed calls and one with 12 uses put the word uses in the same column", async ($, on) => {
    const world = worldOf(on, {
      tools: [...toolsOf("linear", ["list-issues"]), ...toolsOf("docs", ["search"])],
    });
    await startIn($, CWD);
    await answerCalls($, world, "mcp__linear__list-issues", ERROR, 2);
    await useTools($, world, { mcp__docs__search: 12 });

    const rows = screenRows(await (await paneOnTab($, "MCP")).drawn(), COLUMNS);

    expect(endOfIn(rows, "linear", "uses")).toBe(endOfIn(rows, "docs", "uses"));
  });

  test("A13 a server with 800 tokens and one with 1.2k tokens put the word tokens in the same column, even when their uses differ in width", async ($, on) => {
    const world = worldOf(on, {
      tools: [toolWith("docs", "search", 800, true), toolWith("linear", "list", 1_200, true)],
    });
    await startIn($, CWD);
    await useTools($, world, { mcp__docs__search: 12 });

    const rows = screenRows(await (await paneOnTab($, "MCP")).drawn(), COLUMNS);

    expect(columnOfIn(rows, "linear", "tokens")).toBe(columnOfIn(rows, "docs", "tokens"));
  });

  test("Q4 a server with 1 tool and one with 12 tools start the word tool in the same column and end their numbers in the same column", async ($, on) => {
    worldOf(on, {
      tools: [...toolsOf("linear", ["list-issues"]), ...toolsOf("docs", namesOf(12))],
    });
    await startIn($, CWD);

    const rows = screenRows(await (await paneOnTab($, "MCP")).drawn(), COLUMNS);

    expect(columnOfIn(rows, "linear", "tool")).toBe(columnOfIn(rows, "docs", "tool"));
    expect(numberEndOfIn(rows, "linear", "tool")).toBe(numberEndOfIn(rows, "docs", "tool"));
  });

  test("Q4b a server with 1 use and one with 12 uses start the word use in the same column and end their numbers in the same column", async ($, on) => {
    const world = worldOf(on, {
      tools: [...toolsOf("linear", ["list-issues"]), ...toolsOf("docs", ["search"])],
    });
    await startIn($, CWD);
    await useTools($, world, { "mcp__linear__list-issues": 1, mcp__docs__search: 12 });

    const rows = screenRows(await (await paneOnTab($, "MCP")).drawn(), COLUMNS);

    expect(usesWordColumnOf(rows, "linear")).toBe(usesWordColumnOf(rows, "docs"));
    expect(usesColumnOf(rows, "linear")).toBe(usesColumnOf(rows, "docs") + 1);
  });

  test("A15 a server with 3 uses shows the 3 bright and the word uses dim, and a server never used shows its 0 dim", async ($, on) => {
    const world = worldOf(on, {
      tools: [...toolsOf("linear", ["list-issues"]), ...toolsOf("docs", ["search"])],
    });
    await startIn($, CWD);
    await useTools($, world, { mcp__docs__search: 3 });

    const pane = await paneOnTab($, "MCP");
    const drawn = await pane.drawn();
    const pieces = colouredPieces(drawn);

    expect(pieceColours(pieces, "3")).toEqual([palette.text]);
    expect(pieceColours(pieces, "0")).toEqual([palette.muted]);
    expect(pieceColours(pieces, "uses")).toEqual([palette.muted, palette.muted]);
    expect(heavyTextsOf(drawn, "3")).toEqual([true]);
    expect(heavyTextsOf(drawn, "0")).toEqual([false]);
  });

  test("A16 under an opened server a tool used twice shows its 2 bright and a tool never used shows its 0 dim", async ($, on) => {
    const world = worldOf(on, { tools: toolsOf("docs", ["search", "index"]) });
    await startIn($, CWD);
    await useTools($, world, { mcp__docs__search: 2 });
    const pane = await paneOnTab($, "MCP");
    const [server] = (await pane.findAll({ type: "Button" })).filter(
      (button) => button.props.label === "docs",
    );
    await pressNode(pane, server);

    const shown = await lines(pane);
    const [searchRow] = toolRowsOf(bodyOf(shown, "docs")).filter((row) => row.name === "search");
    const [indexRow] = toolRowsOf(bodyOf(shown, "docs")).filter((row) => row.name === "index");
    expect(searchRow, "the opened search tool row").toBeDefined();
    expect(indexRow, "the opened index tool row").toBeDefined();

    expect(partColoursOf(searchRow?.line, "2")).toEqual([palette.text]);
    expect(partColoursOf(indexRow?.line, "0")).toEqual([palette.muted]);
    expect(numberWeightsOf(searchRow?.line, "2")).toEqual([true]);
    expect(numberWeightsOf(indexRow?.line, "0")).toEqual([false]);
  });

  test("A17 a turned-off server's uses sit in the same column as the connected servers' uses", async ($, on) => {
    const world = worldOf(on, { tools: DOCS, files: DISABLED_FILES });
    await startIn($, CWD);
    await useTools($, world, { "mcp__linear__get-issue": 1 });
    await answerCalls($, world, "mcp__linear__list-issues", ERROR, 1);

    const rows = screenRows(await (await paneOnTab($, "MCP")).drawn(), COLUMNS);

    expect(endOfIn(rows, "linear", "uses")).toBe(endOfIn(rows, "docs", "uses"));
  });

  test("A19 under an opened server each tool's uses end on the same cell as the server's uses, also when the server's count is wider and another server has failed calls", async ($, on) => {
    const world = worldOf(on, {
      tools: [...toolsOf("linear", ["list-issues"]), ...toolsOf("docs", ["search", "index"])],
    });
    await startIn($, CWD);
    await answerCalls($, world, "mcp__linear__list-issues", ERROR, 2);
    await useTools($, world, { mcp__docs__search: 3, mcp__docs__index: 9 });
    const pane = await paneOnTab($, "MCP");
    const [docs] = (await pane.findAll({ type: "Button" })).filter(
      (button) => button.props.label === "docs",
    );
    await pressNode(pane, docs);

    const rows = screenRows(await pane.drawn(), COLUMNS);

    expect(endOfIn(rows, "search", "uses")).toBe(endOfIn(rows, "docs", "uses"));
  });

  test("A22 the summary line shows the server count in the normal text colour and the word servers dim, and the failed count keeps the failed colour", async ($, on) => {
    const world = worldOf(on, { tools: [...LINEAR, ...DOCS] });
    await startIn($, CWD);
    await answerCalls($, world, "mcp__linear__list-issues", ERROR, 2);
    await answerCalls($, world, "mcp__docs__search", ERROR, 1);

    const summary = summaryLineOf(await lines(await paneOnTab($, "MCP")));

    expect(partColoursOf(summary, "2")).toEqual([palette.text]);
    expect(partColoursOf(summary, "servers")).toEqual([palette.muted]);
    expect(failedColoursOf(summary)).toEqual([palette.failed]);
  });

  test("A23 a server with no failed calls ends its uses on the same cell whether or not another server has failed calls", async ($, on) => {
    const world = worldOf(on, {
      tools: [...toolsOf("linear", ["list-issues"]), ...toolsOf("docs", ["search"])],
    });
    await startIn($, CWD);
    await useTools($, world, { mcp__docs__search: 12 });
    const pane = await paneOnTab($, "MCP");
    const before = endOfIn(screenRows(await pane.drawn(), COLUMNS), "docs", "uses");

    await answerCalls($, world, "mcp__linear__list-issues", ERROR, 2);
    await settle(pane);

    const after = endOfIn(screenRows(await pane.drawn(), COLUMNS), "docs", "uses");
    expect(after).toBe(before);
  });
});

describe("mcp tab token cost", () => {
  test("T1 a live server row shows the tokens of its loaded tools only, in k from a thousand up", async ($, on) => {
    worldOf(on, {
      tools: [toolWith("docs", "search", 1_200, true), toolWith("docs", "index", 900, false)],
    });
    await startIn($, CWD);

    const pane = await paneOnTab($, "MCP");

    expect(detailAfter(rowOrFail(await lines(pane), "docs").line, "docs")).toBe(
      "2 tools 1.2k tokens 0 uses",
    );
  });

  test("T2 a server whose tools are all deferred reads deferred in muted text, not 0 tokens", async ($, on) => {
    worldOf(on, { tools: [toolWith("docs", "search", 900, false)] });
    await startIn($, CWD);

    const pane = await paneOnTab($, "MCP");

    const docs = rowOrFail(await lines(pane), "docs").line;
    expect(detailAfter(docs, "docs")).toMatch(/^1 tool\s+deferred\s+0 uses$/u);
    expect(partColoursOf(docs, "deferred")).toEqual([palette.muted]);
  });

  test("T5 a deferred server and a server with a token figure start the uses column in the same cell", async ($, on) => {
    worldOf(on, {
      tools: [
        ...namesOf(8).map((name) => toolWith(MEDIUM_NAME, name, 900, false)),
        toolWith("paneline", "ping", 88, true),
        toolWith("paneline", "pong", 100, true),
      ],
    });
    await startIn($, CWD);

    const rows = screenRows(await (await paneOnTab($, "MCP")).drawn(), COLUMNS);

    expect(usesColumnOf(rows, MEDIUM_NAME), "the cell where the uses column starts").toBe(
      usesColumnOf(rows, "paneline"),
    );
  });

  test("T6 a deferred server and a server with a token figure end their token word in one column at 60 columns", async ($, on) => {
    worldOf(on, {
      tools: [
        ...namesOf(22).map((name) => toolWith(DEFERRED_SERVER, name, 900, false)),
        toolWith(LIVE_SERVER, "ping", 100, true),
        toolWith(LIVE_SERVER, "pong", 86, true),
      ],
    });
    await startIn($, CWD);

    const rows = screenRows(await (await paneOnTab($, "MCP")).drawn(), COLUMNS);

    expect(endOfWordIn(rows, DEFERRED_SERVER, "deferred")).toBe(
      endOfWordIn(rows, LIVE_SERVER, "tokens"),
    );
  });

  test("T7 the gap between the token word and the uses figure is the same on a deferred row and on a token row at 60 columns", async ($, on) => {
    worldOf(on, {
      tools: [
        ...namesOf(22).map((name) => toolWith(DEFERRED_SERVER, name, 900, false)),
        toolWith(LIVE_SERVER, "ping", 100, true),
        toolWith(LIVE_SERVER, "pong", 86, true),
      ],
    });
    await startIn($, CWD);

    const rows = screenRows(await (await paneOnTab($, "MCP")).drawn(), COLUMNS);

    expect(
      usesColumnOf(rows, DEFERRED_SERVER) - endOfWordIn(rows, DEFERRED_SERVER, "deferred"),
    ).toBe(usesColumnOf(rows, LIVE_SERVER) - endOfWordIn(rows, LIVE_SERVER, "tokens"));
  });

  test("T8 at 120 columns the token words of a deferred server, a server with 1.2k tokens and a server with 186 tokens all end in one column", async ($, on) => {
    worldOf(on, {
      tools: [
        ...namesOf(22).map((name) => toolWith(DEFERRED_SERVER, name, 900, false)),
        toolWith(MEDIUM_NAME, "search", 1_200, true),
        toolWith(LIVE_SERVER, "ping", 186, true),
      ],
    });
    await startIn($, CWD);

    const rows = screenRows(await (await paneOnTab($, "MCP", WIDE_COLUMNS)).drawn(), WIDE_COLUMNS);

    expect(endOfWordIn(rows, MEDIUM_NAME, "tokens")).toBe(endOfWordIn(rows, LIVE_SERVER, "tokens"));
    expect(endOfWordIn(rows, DEFERRED_SERVER, "deferred")).toBe(
      endOfWordIn(rows, LIVE_SERVER, "tokens"),
    );
  });

  test("V2-F2 a server with 188 tokens reads 188 tokens with one space between the number and the word", async ($, on) => {
    worldOf(on, {
      tools: [toolWith("docs", "search", 900, false), toolWith("paneline", "ping", 188, true)],
    });
    await startIn($, CWD);

    const pane = await paneOnTab($, "MCP");

    const rows = screenRows(await pane.drawn(), COLUMNS);
    expect(rows.find((row) => row.includes("paneline"))).toMatch(/ 188 tokens /u);
  });

  test("T3 a turned-off server shows no token figure while the live server next to it shows its own", async ($, on) => {
    worldOf(on, { tools: DOCS, files: DISABLED_FILES });
    await startIn($, CWD);

    const pane = await paneOnTab($, "MCP");

    const shown = await lines(pane);
    expect(tokenTextOf(rowOrFail(shown, "docs").line)).toBe("100 tokens");
    expect(tokenTextOf(hollowLineOf(shown, "linear"))).toBeUndefined();
  });

  test("T4 the MCP tools line on the Context tab shows the sum of the server rows' token figures", async ($, on) => {
    worldOf(on, {
      tools: [
        toolWith("docs", "search", 1_200, true),
        toolWith("linear", "create-issue", 300, true),
        toolWith("linear", "get-issue", 200, false),
      ],
    });
    await startIn($, CWD);
    const mcp = await paneOnTab($, "MCP");
    const shown = await lines(mcp);
    expect([
      tokenTextOf(rowOrFail(shown, "docs").line),
      tokenTextOf(rowOrFail(shown, "linear").line),
    ]).toEqual(["1.2k tokens", "300 tokens"]);
    await mcp.unmount();

    const context = await paneOnTab($, "Context");

    const contextMcp = (await lines(context)).find((line) => /^└ \d+ tools? · /u.test(line.text));
    expect(contextMcp, "the MCP tools count line of the Context tab").toBeDefined();
    expect(tokenTextOf(contextMcp as Line)).toBe("1.5k tokens");
  });
});

function toolsOf(serverName: string, names: string[]): unknown[] {
  return names.map((name) => ({
    name: `mcp__${serverName}__${name}`,
    serverName,
    tokens: 100,
    isLoaded: true,
  }));
}

function toolWith(serverName: string, name: string, tokens: number, isLoaded: boolean): unknown {
  return { name: `mcp__${serverName}__${name}`, serverName, tokens, isLoaded };
}

async function answerCalls(
  $: Engine,
  world: World,
  tool: string,
  answer: Answer,
  times: number,
): Promise<void> {
  const call = $.tool.call as (event: object) => Promise<unknown>;
  for (let use = 0; use < times; use++) {
    const id = world.nextCallId();
    world.replies.set(id, answer);
    await call({ tool, tool_use_id: id });
  }
}

function failedColoursOf(line: Line): unknown[] {
  return line.parts
    .filter((part) => partText(part).includes("failed"))
    .map((part) => part.props?.color);
}

function summaryLineOf(shown: Line[]): Line {
  const line = shown.find((candidate) => /^\d+ servers?\b/u.test(candidate.text));
  expect(line, 'a summary line like "2 servers"').toBeDefined();
  return line as Line;
}

function hollowLineOf(shown: Line[], name: string): Line {
  const line = hollowRowOf(shown, name);
  expect(line, `a turned-off row for ${name}`).toBeDefined();
  return line as Line;
}

function childrenOf(box: { children?: unknown }): unknown[] {
  return Array.isArray(box.children) ? box.children : [];
}

function isMarkText(node: unknown): boolean {
  const { type, children } = node as { type?: unknown; children?: unknown };
  return type === "Text" && JSON.stringify(children) === '["✔"]';
}

async function buttonLabelsOf(pane: Pane): Promise<string[]> {
  const buttons = await pane.findAll({ type: "Button" });
  return buttons
    .map((button) => button.props.label)
    .filter((label): label is string => typeof label === "string");
}

async function nameLabelsOf(pane: Pane): Promise<string[]> {
  const buttons = await pane.findAll({ type: "Button" });
  return buttons
    .map((button) => button.props.label)
    .filter(
      (label): label is string => typeof label === "string" && label.startsWith("long_named_"),
    );
}

function textPropsOf(node: unknown): { wrap?: unknown; color?: unknown } {
  return (node as { props?: { wrap?: unknown; color?: unknown } }).props ?? {};
}

async function useTools(
  $: Engine,
  world: World,
  counts: Record<string, number>,
  agentId?: string,
): Promise<void> {
  const call = $.tool.call as (event: object) => Promise<unknown>;
  for (const [tool, times] of Object.entries(counts)) {
    for (let use = 0; use < times; use++) {
      await call({ tool, tool_use_id: world.nextCallId(), agentId });
    }
  }
}

async function startIn($: Engine, folder: string): Promise<void> {
  await $.session.start({ cwd: folder, surface: "terminal", isInteractive: true });
}

function clearButtonsOf(shown: Line[]): Node[] {
  return shown
    .flatMap((line) => line.parts)
    .filter((part) => part.type === "Button" && part.props?.label === CLEAR_LABEL);
}

async function pressClear(pane: Pane): Promise<void> {
  const [button] = clearButtonsOf(await lines(pane));
  expect(button, `a "${CLEAR_LABEL}" button`).toBeDefined();
  await pressNode(pane, button);
}

async function buttonLabels(pane: Pane): Promise<unknown[]> {
  return (await pane.findAll({ type: "Button" })).map((button) => button.props.label);
}

async function headingColours(pane: Pane): Promise<unknown[]> {
  const shown = await lines(pane);
  return HEADINGS.flatMap((heading) =>
    shown
      .filter((line) => line.text === heading)
      .map((line) => line.parts.find((part) => isHeavy(part.props))?.props?.color),
  );
}

function worldOf(on: On, options: WorldOptions): World {
  const stored = new Map<string, unknown>(Object.entries(options.storeSeed ?? {}));
  const stateValues = new Map<string, { value: unknown; version: number }>();
  let folder = CWD;
  let calls = 0;
  let fullReads = 0;
  let openFull: () => void = () => {};
  const fullGate: Promise<void> = options.holdFull
    ? new Promise<void>((resolve) => {
        openFull = resolve;
      })
    : Promise.resolve();
  const world: World = {
    commands: [],
    replies: new Map(),
    nextCallId: () => `call-${++calls}`,
    storedValue: (key) => stored.get(key),
    forgetState: () => stateValues.clear(),
    fullCalls: () => fullReads,
    releaseFull: () => openFull(),
    changeCwd: (next) => {
      folder = next;
    },
  };
  mock.clock(on, { now: NOW });
  mock.env(on, { HOME });
  on("config.list", () => ({ value: [{ key: "theme", value: options.theme ?? "dark" }] }) as never);
  on("store.get", (_$, e) => ({ value: stored.get(e.key) }));
  on("store.set", (_$, e) => {
    stored.set(e.key, e.value);
    return { value: undefined };
  });
  on("store.delete", (_$, e) => {
    stored.delete(e.key);
    return { value: undefined };
  });
  on("store.keys", () => ({ value: [...stored.keys()] }));
  if (options.hasMemoryState === true) {
    on("state.get", (_$, e) => ({
      value: stateValues.get(e.key) ?? { value: undefined, version: 0 },
    }));
    on("state.set", (_$, e) => {
      const version = (stateValues.get(e.key)?.version ?? 0) + 1;
      stateValues.set(e.key, { value: e.value, version });
      return { value: { isSet: true, version } };
    });
  }
  on("classic.SessionStart", () => ({}));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("session.id", () => ({ value: "session-1" }));
  on("command.register", () => ({ value: {} }) as never);
  on("agent.list", () => ({ value: [] }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("tool.call", (_$, e) => {
    const answer = world.replies.get(e.tool_use_id);
    if (answer === undefined) return { result: "ok", text: "ok", ref: 1 };
    if ("deny" in answer) return { deny: answer.deny };
    return { isError: true, result: answer.error, text: answer.error };
  });
  on("session.usage", async (_$, e) => {
    if (e.breakdown === "full") {
      fullReads++;
      await fullGate;
    }
    const breakdown = {
      categories: [],
      totalTokens: 0,
      rawMaxTokens: 200_000,
      gridRows: [],
      memoryFiles: [],
      agents: [],
      mcpTools:
        (e.breakdown === "summary" ? options.summaryTools : undefined) ?? options.tools ?? [],
    } as unknown as SessionContextBreakdown;
    const context =
      e.breakdown === undefined ? { window: 200_000 } : { window: 200_000, breakdown };
    return { value: { startedAt: 0, context, rateLimits: [] } };
  });
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.model", () => ({ value: "opus" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: folder }));
  on("fs.read", (_$, e) => {
    const text = options.files?.[e.path];
    return { value: text ?? "" };
  });
  on("command.run", { command: "mcp" }, (_$, e) => {
    world.commands.push(e.args);
    return {};
  });
  on("ui.render", { component: "Pane" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine pane</Text>;
  });
  return world;
}

function mountPane($: Engine, columns = COLUMNS): Promise<Pane> {
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
      scroll: { offset: 0, bodyRows: PANE_ROWS },
      view: {},
    },
    viewport: { columns, rows: PANE_ROWS },
  });
}

async function paneOnTab($: Engine, label: string, columns = COLUMNS): Promise<Pane> {
  const pane = await mountPane($, columns);
  await pressPagedTab(pane, label);
  await settle(pane);
  return pane;
}

function namesOf(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `tool-${index}`);
}

function columnOf(row: string, text: string): number {
  const at = row.indexOf(text);
  expect(at, `"${text}" in "${row.trimEnd()}"`).toBeGreaterThanOrEqual(0);
  return at;
}

function columnOfIn(rows: string[], name: string, word: string): number {
  const row = rows.find((line) => line.includes(name));
  expect(row, `a row for ${name}`).toBeDefined();
  return columnOf(row ?? "", word);
}

function endOfIn(rows: string[], name: string, word: string): number {
  return columnOfIn(rows, name, word) + word.length;
}

function endOfWordIn(rows: string[], name: string, word: string): number {
  const row = rows.find((line) => line.includes(name));
  expect(row, `a row for ${name}`).toBeDefined();
  return columnOf(row ?? "", word) + word.length;
}
function usesColumnOf(rows: string[], name: string): number {
  const row = rows.find((line) => line.includes(name));
  expect(row, `a row for ${name}`).toBeDefined();
  const column = (row ?? "").search(/\d+ uses?\s*$/u);
  expect(column, `a uses figure in "${(row ?? "").trimEnd()}"`).toBeGreaterThanOrEqual(0);
  return column;
}

function numberEndOfIn(rows: string[], name: string, word: string): number {
  const row = rows.find((line) => line.includes(name));
  expect(row, `a row for ${name}`).toBeDefined();
  return columnOf(row ?? "", ` ${word}`);
}

function usesWordColumnOf(rows: string[], name: string): number {
  const row = rows.find((line) => line.includes(name));
  expect(row, `a row for ${name}`).toBeDefined();
  const column = (row ?? "").search(/ uses?\s*$/u);
  expect(column, `a uses figure in "${(row ?? "").trimEnd()}"`).toBeGreaterThanOrEqual(0);
  return column + 1;
}

function pieceColours(pieces: { text: string; color: unknown }[], text: string): unknown[] {
  return pieces.filter((piece) => piece.text.trim() === text).map((piece) => piece.color);
}

function numberWeightsOf(line: Line | undefined, number: string): boolean[] {
  return (line?.parts ?? [])
    .filter((part) => partText(part).trim() === number)
    .map((part) => isHeavy(part.props));
}

function heavyTextsOf(drawn: unknown, text: string): boolean[] {
  return collect(drawn as Node, "Text")
    .filter((node) => textOf(node).trim() === text)
    .map((node) => isHeavy(node.props));
}

function partColoursOf(line: Line | undefined, number: string): unknown[] {
  return (line?.parts ?? [])
    .filter((part) => partText(part).trim() === number)
    .map((part) => part.props?.color);
}
