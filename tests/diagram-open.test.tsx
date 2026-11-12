import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";
import { drawDiagram } from "../hooks/diagram";
import { textOf } from "./draw-tree";
import { feedSession } from "./session-feed";

type Reply = Mounted<"terminal", "AssistantMessage">;
type Pane = Mounted<"terminal", "Pane">;
type World = {
  opened: Record<string, unknown>[];
  state: Map<string, unknown>;
  clipboard: { copied: string[] };
};

const FENCE = "```";
const WIDE = 220;
const TINY = 20;
const PANEL_AND_BODY_PADDING = 5;
const BACK_ROW_AND_PADDING = 5;
const CODE_SOURCE = "const kept = 1";
const OPEN = "Open";
const BACK = "back";
const FLOWCHART = ["flowchart LR", "  G[grilling] --> S[spec.md]", "  S --> P[plan]"].join("\n");
const LONG_FLOWCHART = [
  "flowchart LR",
  "  G[grilling] --> S[spec.md]",
  "  S --> P[plan mode: plan]",
  "  P --> X[ExitPlanMode → Plannotator HTML]",
  "  X -->|approved| T[TaskCreate per plan task + blockedBy]",
  "  T --> W[agents work, TaskUpdate status]",
].join("\n");
const SECOND = ["flowchart LR", "  Alpha --> Beta"].join("\n");
const SEQUENCE = ["sequenceDiagram", "  U->>A: request data"].join("\n");
const AGENT_OUTPUT = [mermaid(FLOWCHART), "", `${FENCE}ts`, CODE_SOURCE, FENCE].join("\n");
const UNSUPPORTED = 'pie title Pets\n  "Dogs": 3';

describe("open a diagram", () => {
  test("O1 a diagram drawn as art has an Open button", async ($, on) => {
    worldOf(on);

    const reply = await mountReply($, mermaid(FLOWCHART), WIDE);

    expect(await openButtons(reply)).toHaveLength(1);
  });

  test("O2 a diagram that fell back to the edge list has an Open button", async ($, on) => {
    worldOf(on);

    const reply = await mountReply($, mermaid(LONG_FLOWCHART), TINY);

    expect(drawDiagram(LONG_FLOWCHART, TINY).kind).toBe("list");
    expect(await openButtons(reply)).toHaveLength(1);
  });

  test("O3 pressing Open opens the Session pane sized to the drawing and keeps the tab", async ($, on) => {
    const world = worldOf(on);
    const reply = await mountReply($, mermaid(FLOWCHART), WIDE);

    await pressOpen(reply, 0);

    expect(world.state.get("openDiagram")).toBe(FLOWCHART);
    expect(world.opened).toHaveLength(1);
    expect(world.opened[0]).toMatchObject({ id: "session", title: "Session" });
    expect(world.opened[0]).toMatchObject({
      columns: naturalWidth(FLOWCHART) + PANEL_AND_BODY_PADDING,
      rows: naturalRows(FLOWCHART) + BACK_ROW_AND_PADDING,
    });
    expect(world.state.get("tab")).toBeUndefined();
  });

  test("O3b the diagram pane asks for the panel fill and keeps its drawing size", async ($, on) => {
    const world = worldOf(on);
    const reply = await mountReply($, mermaid(FLOWCHART), WIDE);

    await pressOpen(reply, 0);

    expect(world.opened[0]).toMatchObject({
      backgroundColor: "composerSidebarBackground",
      rows: naturalRows(FLOWCHART) + BACK_ROW_AND_PADDING,
    });
  });

  test("O4 the pane shows the diagram instead of the tab body", async ($, on) => {
    worldOf(on);
    const reply = await mountReply($, mermaid(FLOWCHART), WIDE);
    const pane = await mountPane($);
    await pane.press({ key: await tabKey(pane, "Files") });
    expect(await hasButton(pane, BACK)).toBe(false);

    await pressOpen(reply, 0);

    const drawn = await pane.drawn();
    expect(await hasButton(pane, BACK)).toBe(true);
    expect(textOf(drawn)).toContain("grilling");
    expect(textOf(drawn)).toContain("spec.md");
    expect(await hasButton(pane, "call-bash-1")).toBe(false);
  });

  test("O5 pressing back removes the diagram and the previous tab draws again", async ($, on) => {
    worldOf(on);
    await $.tool.call({ tool: "Bash", command: "ls", tool_use_id: "bash-1" } as never);
    const reply = await mountReply($, mermaid(FLOWCHART), WIDE);
    const pane = await mountPane($);
    await pressOpen(reply, 0);
    expect(await hasButton(pane, "call-bash-1")).toBe(false);

    await pane.press({ key: BACK });

    expect(await hasButton(pane, BACK)).toBe(false);
    expect(textOf(await pane.drawn())).not.toContain("grilling");
    expect(await hasButton(pane, "call-bash-1")).toBe(true);
  });

  test("O6 pressing another tab while the diagram is open shows that tab", async ($, on) => {
    worldOf(on);
    const reply = await mountReply($, mermaid(FLOWCHART), WIDE);
    const pane = await mountPane($);
    await pressOpen(reply, 0);

    await pane.press({ key: await tabKey(pane, "Files") });

    expect(await hasButton(pane, BACK)).toBe(false);
    expect(textOf(await pane.drawn())).not.toContain("grilling");
  });

  test("O7 /paneline while the diagram is open shows the normal tab", async ($, on) => {
    worldOf(on);
    const reply = await mountReply($, mermaid(FLOWCHART), WIDE);
    const pane = await mountPane($);
    await pressOpen(reply, 0);

    await $.command.run({
      command: "paneline",
      args: "",
      origin: { kind: "composer" },
      presentation: { isFullscreen: false, columns: WIDE },
    });

    expect(await hasButton(pane, BACK)).toBe(false);
    expect(textOf(await pane.drawn())).not.toContain("grilling");
  });
});

describe("diagram in an Activity call", () => {
  test("V1 a call output with a mermaid block and a code block copies the code and shows no Open", async ($, on) => {
    const clipboard = worldOf(on).clipboard;
    await $.tool.call({
      tool: "Agent",
      description: "draw",
      prompt: "draw",
      tool_use_id: "agent-1",
    } as never);
    const pane = await mountPane($);
    await pane.press({ key: "call-agent-1" });

    const copy = (await pane.findAll({ type: "Button" })).find((b) => b.props.label === "Copy");
    await pane.press({ key: copy?.key ?? "" });

    expect(clipboard.copied).toEqual([CODE_SOURCE]);
    expect(await openButtons(pane)).toEqual([]);
    expect(textOf(await pane.drawn())).toContain("grilling");
  });
});

describe("which diagrams get a button", () => {
  test("B1 two diagrams in a reply each have Open and the second opens the second", async ($, on) => {
    const world = worldOf(on);
    const reply = await mountReply($, `${mermaid(FLOWCHART)}\n\ntext\n\n${mermaid(SECOND)}`, WIDE);

    await pressOpen(reply, 1);

    expect(await openButtons(reply)).toHaveLength(2);
    expect(world.state.get("openDiagram")).toBe(SECOND);
  });

  test("B2 a reply with no diagram has no Open button", async ($, on) => {
    worldOf(on);

    const reply = await mountReply($, "plain words", WIDE);

    expect(await openButtons(reply)).toEqual([]);
  });

  test("U1 a diagram that could not be drawn has no Open button", async ($, on) => {
    worldOf(on);

    const reply = await mountReply($, mermaid(UNSUPPORTED), WIDE);

    expect(await reply.find({ type: "Code" })).toBeDefined();
    expect(await openButtons(reply)).toEqual([]);
  });

  test("U2 a diagram whose fence is still open has no Open button", async ($, on) => {
    worldOf(on);

    const reply = await mountReply($, `${FENCE}mermaid\n${SEQUENCE}`, WIDE);

    expect(await openButtons(reply)).toEqual([]);
  });
});

function worldOf(on: On): World {
  const world: World = { opened: [], state: new Map(), clipboard: { copied: [] } };
  mock.clock(on);
  mock.env(on, { HOME: "/home" });
  on("state.set", (_$, e, next) => {
    const stored = e.value as { value?: unknown; version?: unknown } | null;
    const isEnvelope = typeof stored === "object" && stored !== null && "version" in stored;
    world.state.set(e.key, isEnvelope ? stored.value : e.value);
    return next(e);
  });
  on("ui.open", (_$, e) => {
    world.opened.push({ ...e });
    return { value: { isPlaced: true } };
  });
  on("classic.SessionStart", () => ({}));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: "/work" }));
  const feed = feedSession(on);
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", () => ({ value: true }));
  on("tool.call", (_$, e) => feed.record(e, { result: AGENT_OUTPUT, text: AGENT_OUTPUT }) as never);
  on("ui.toast", () => ({ value: undefined }));
  on("ui.copy", (_$, e) => {
    world.clipboard.copied.push(e.text);
    return { value: { isCopied: true } };
  });
  return world;
}

function naturalWidth(source: string): number {
  const drawn = drawDiagram(source, 400);
  if (drawn.kind !== "art") throw new Error(`not drawn: ${drawn.kind}`);
  return Math.max(...drawn.art.split("\n").map((row) => [...row].length));
}

function naturalRows(source: string): number {
  const drawn = drawDiagram(source, 400);
  if (drawn.kind !== "art") throw new Error(`not drawn: ${drawn.kind}`);
  return drawn.art.split("\n").length;
}

async function openButtons(reply: Reply | Pane) {
  return (await reply.findAll({ type: "Button" })).filter((b) => b.props.label === OPEN);
}

async function pressOpen(reply: Reply, index: number): Promise<void> {
  const button = (await openButtons(reply))[index];
  await reply.press({ key: button?.key ?? "" });
}

async function hasButton(pane: Pane, key: string): Promise<boolean> {
  return (await pane.findAll({ type: "Button" })).some((b) => b.key === key);
}

async function tabKey(pane: Pane, label: string): Promise<string> {
  const tab = (await pane.findAll({ type: "Button" })).find((b) => b.props.label === label);
  return tab?.key ?? "";
}

function mermaid(source: string): string {
  return [`${FENCE}mermaid`, source, FENCE].join("\n");
}

function mountReply($: Engine, text: string, columns: number) {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "AssistantMessage",
    props: { text, isFirstOfReply: true },
    viewport: { columns, rows: 24 },
  });
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
      bodyColumns: WIDE,
      placement: "dock",
      scroll: { offset: 0, bodyRows: 80 },
      view: {},
    },
    viewport: { columns: WIDE, rows: 80 },
  });
}
