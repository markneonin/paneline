import { describe, expect, mock, test } from "claude-code/testing";
import type { AgentInfo, On } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import type { Activity } from "../types";
import type { AgentNode } from "../hooks/agents-model";
import { pricedSpent, seedOf } from "./fixtures/agent-spend";
import { palette } from "../hooks/palette";
import { ENGINE_DEFAULT_GREY, accentOf } from "../hooks/session-color";

type Pane = Mounted<"terminal", "Pane">;
type Mount = { findAll: Pane["findAll"] };

const RED = accentOf("red");
const DEFAULT_GREY = ENGINE_DEFAULT_GREY;
const COLUMNS = 100;
const SHARE_BAR = "▰".repeat(7);
const NOW = 200_000;
const store = new Map<string, { value: unknown; version: number }>();

describe("tool header", () => {
  test("A1 the TOOL label and its rule take the session colour", async ($, on) => {
    worldOf(on, "red");

    const group = await mountToolGroup($);

    expect(await colorsOf(group, "TOOL")).toEqual([RED]);
    expect(await colorsOf(group, "──")).toEqual([RED]);
  });

  test("A2 with no colour set the TOOL header takes the engine default grey", async ($, on) => {
    worldOf(on, "default");

    const group = await mountToolGroup($);

    expect(await colorsOf(group, "TOOL")).toEqual([DEFAULT_GREY]);
    expect(await colorsOf(group, "──")).toEqual([DEFAULT_GREY]);
  });

  test("A3 the Failed word keeps its status colour under a session colour", async ($, on) => {
    worldOf(on, "red");

    const group = await mountToolGroup($, { isErrored: true });

    expect(await colorsOf(group, "Failed")).toEqual([palette.failed]);
  });
});

describe("activity pane", () => {
  test("A4 the section headers stay plain white under a session colour", async ($, on) => {
    worldOf(on, "blue");

    const pane = await mountPane($);

    for (const name of ["Tool mix", "Timeline"])
      expect(await colorsOf(pane, name)).toEqual([palette.userText]);
  });

  test("A5 with no colour set the section headers are plain white", async ($, on) => {
    worldOf(on, "default");

    const pane = await mountPane($);

    expect(await colorsOf(pane, "Timeline")).toEqual([palette.userText]);
  });
});

describe("files pane", () => {
  test("A6 the header and folder rows are plain white, the guides muted, the counts keep their colours", async ($, on) => {
    worldOf(on, "red");
    store.set("activity", {
      value: [edit("/work/src/a.ts", 3, 1), edit("/work/src/deep/b.ts", 2, 0)],
      version: 1,
    });

    const pane = await mountPane($, "Files");

    expect(await colorsOf(pane, "Files")).not.toContain(RED);
    expect(await colorsOf(pane, "└─")).toEqual([palette.rule]);
    expect(await colorsOf(pane, "+3")).toEqual([palette.ok]);
  });
});

describe("subagents pane", () => {
  test("A7 the header is plain white, the row bars and the tree guides ignore the session colour, the status dots keep theirs", async ($, on) => {
    worldOf(on, "red");
    store.set("agents", {
      value: { a: agent("a", "alpha"), b: { ...agent("b", "bravo"), parentId: "a" } },
      version: 1,
    });
    seedAgentSpend();

    const pane = await mountPane($, "Agents");

    const header = await colorsOf(pane, "Agents");
    expect(header).toContain(palette.userText);
    expect(header).not.toContain(RED);
    expect(await colorsOf(pane, SHARE_BAR)).toEqual([palette.tool]);
    expect(await colorsOf(pane, "└─ ")).toEqual([palette.rule]);
    expect(await colorsOf(pane, "✓")).toEqual([palette.ok]);
  });

  test("A8 with no colour set the row bar has the same colour", async ($, on) => {
    worldOf(on, "default");
    store.set("agents", {
      value: { a: agent("a", "alpha"), b: { ...agent("b", "bravo"), parentId: "a" } },
      version: 1,
    });
    seedAgentSpend();

    const pane = await mountPane($, "Agents");

    expect(await colorsOf(pane, SHARE_BAR)).toEqual([palette.tool]);
  });
});

function seedAgentSpend(): void {
  const seed = seedOf([
    pricedSpent("a", "general-purpose", { input: 10_000 }),
    pricedSpent("b", "general-purpose", { input: 20_000 }),
  ]);
  store.set("spend", { value: seed.spend, version: 1 });
  store.set("sessionUsd", { value: seed.sessionUsd, version: 1 });
}

function worldOf(on: On, colorName: string): void {
  store.clear();
  store.set("sessionColor", { value: colorName, version: 1 });
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
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: "/work" }));
  on("agent.list", () => ({ value: [] as unknown as AgentInfo[] }));
  on("fs.exists", () => ({ value: true }));
}

function mountToolGroup($: Engine, call: { isErrored?: boolean } = {}) {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "ToolGroup",
    props: {
      calls: [
        {
          tool_use_id: "g1",
          tool: "Read",
          input: {},
          isRunning: false,
          isErrored: false,
          isInterrupted: false,
          ...call,
        },
      ],
      isActive: false,
      isExpanded: false,
    },
    viewport: { columns: COLUMNS, rows: 24 },
  });
}

async function mountPane($: Engine, tab?: string): Promise<Pane> {
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
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
    viewport: { columns: COLUMNS, rows: 40 },
  });
  if (tab === undefined) return pane;
  const buttons = await pane.findAll({ type: "Button" });
  await pane.press({ key: buttons.find((button) => button.props.label === tab)?.key ?? "" });
  return pane;
}

async function colorsOf(mount: Mount, text: string): Promise<unknown[]> {
  const colors = (await mount.findAll({ type: "Text", text }))
    .map((node) => node.props.color)
    .filter((color) => color !== undefined);
  return [...new Set(colors)];
}

function edit(target: string, added: number, removed: number): Activity {
  return { id: target, tool: "Edit", target, ms: 1, isErrored: false, added, removed };
}

function agent(id: string, description: string): AgentNode {
  return {
    id,
    type: "general-purpose",
    description,
    background: false,
    model: "sonnet",
    status: "done",
    startedAt: NOW - 10_000,
    ctxTokens: 0,
    running: [],
  };
}
