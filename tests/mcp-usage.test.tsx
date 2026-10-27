import { describe, expect, mock, test } from "claude-code/testing";
import type { On, SessionContextBreakdown } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { palette } from "../hooks/palette";
import type { Node } from "./draw-tree";
import {
  bodyOf,
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
  toolRowsOf,
  usesOf,
} from "./mcp-tree";
import type { Line } from "./skills-tree";
import { isHeavy } from "./weight";

type Pane = Mounted<"terminal", "Pane">;
type World = {
  commands: string[];
  nextCallId: () => string;
  storedValue: (key: string) => unknown;
  forgetState: () => void;
  changeCwd: (folder: string) => void;
};
type WorldOptions = {
  tools?: unknown[];
  storeSeed?: Record<string, unknown>;
  theme?: string;
  files?: Record<string, string>;
  hasMemoryState?: boolean;
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

function toolsOf(serverName: string, names: string[]): unknown[] {
  return names.map((name) => ({
    name: `mcp__${serverName}__${name}`,
    serverName,
    tokens: 100,
    isLoaded: true,
  }));
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
  const world: World = {
    commands: [],
    nextCallId: () => `call-${++calls}`,
    storedValue: (key) => stored.get(key),
    forgetState: () => stateValues.clear(),
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
  on("command.register", () => ({ value: {} }) as never);
  on("agent.list", () => ({ value: [] }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("tool.call", () => ({ result: "ok", text: "ok", ref: 1 }));
  on("session.usage", (_$, e) => {
    const breakdown = {
      categories: [],
      totalTokens: 0,
      rawMaxTokens: 200_000,
      gridRows: [],
      memoryFiles: [],
      agents: [],
      mcpTools: options.tools ?? [],
    } as unknown as SessionContextBreakdown;
    const context =
      e.breakdown === undefined ? { window: 200_000 } : { window: 200_000, breakdown };
    return { value: { startedAt: 0, context, rateLimits: [] } };
  });
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.model", () => ({ value: "opus" }));
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
  const target = (await pane.findAll({ type: "Button" })).find(
    (button) => button.props.label === label,
  );
  expect(target, `a ${label} tab button`).toBeDefined();
  await pane.press({ key: target?.key ?? "" });
  await settle(pane);
  return pane;
}
