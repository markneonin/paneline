import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";
import type { ToolUseSummary } from "claude-code";

import { useOf } from "./session-feed";

type Node = { type: string; props?: Record<string, unknown>; children?: unknown };

const SESSION_START = { cwd: "/work", surface: "terminal", isInteractive: true } as const;
const COLUMNS = 100;
const ROWS = 40;
const OUTPUT_LINE = "output-marker-line";
const FIRST_COMMAND = "echo first-call";
const SECOND_COMMAND = "echo second-call";
const TIMELINE_TITLE = "Timeline";
const PANE_ID = "session";
let messageReads = 0;
const gates = new Map<string, Promise<void>>();
const SECOND_FORGOTTEN_ID = "forgotten-call-2";
const SECOND_FORGOTTEN_COMMAND = "echo forgotten-two";
const ERROR_TEXT = "boom-error-line";
const PANE_OPEN = {
  id: "session",
  title: "Session",
  isShown: true,
  isFocused: false,
  isPlaced: true,
};
const readGates: Promise<void>[] = [];
let sessionUses: ToolUseSummary[] = [];
const FORGOTTEN_ID = "forgotten-call";
const FORGOTTEN_COMMAND = "echo forgotten-call";
const FORGOTTEN_OUTPUT = "forgotten-output-line";

describe("chat tool cards start folded", () => {
  test("F1 a finished Bash call draws no output panel in the normal transcript", async ($, on) => {
    worldOf(on, []);
    await $.session.start(SESSION_START);

    const tree = await drawResult($, "f1", false);

    expect(textOf(tree)).not.toContain(OUTPUT_LINE);
  });

  test("F2 a finished Bash call in the full transcript (ctrl+o) still draws its output panel", async ($, on) => {
    worldOf(on, []);
    await $.session.start(SESSION_START);

    const tree = (await (await drawCall($, "f2", FIRST_COMMAND, true)).drawn()) as unknown as Node;

    expect(textOf(tree)).toContain(OUTPUT_LINE);
  });

  test("F3 a folded group of Bash calls with output draws its one row and no panel", async ($, on) => {
    worldOf(on, []);
    await $.session.start(SESSION_START);

    const tree = (await (await drawGroup($)).drawn()) as unknown as Node;

    expect(textOf(tree)).toContain("Ran 2 commands");
    expect(textOf(tree)).not.toContain(OUTPUT_LINE);
  });
});

describe("Details with the side pane", () => {
  test("D2 with the pane open, Details on a group opens the first call of the group in Activity", async ($, on) => {
    worldOf(on, [
      { id: PANE_ID, title: "Session", isShown: true, isFocused: false, isPlaced: true },
    ]);
    await $.session.start(SESSION_START);
    await runCalls($);

    await pressDetails(await drawGroup($));

    const text = textOf(await mountPane($));
    expect(text).not.toContain(TIMELINE_TITLE);
    expect(text).toContain(FIRST_COMMAND);
    expect(text).not.toContain(SECOND_COMMAND);
  });

  test("D3 with the pane open, Details on a single call opens that call in Activity", async ($, on) => {
    worldOf(on, [
      { id: PANE_ID, title: "Session", isShown: true, isFocused: false, isPlaced: true },
    ]);
    await $.session.start(SESSION_START);
    await runCalls($);

    await pressDetails(await drawCall($, "d-2", SECOND_COMMAND));

    const text = textOf(await mountPane($));
    expect(text).not.toContain(TIMELINE_TITLE);
    expect(text).toContain(SECOND_COMMAND);
  });

  test("D5 with the pane open, Details on a call Activity no longer keeps shows its command and output", async ($, on) => {
    worldOf(on, [
      { id: PANE_ID, title: "Session", isShown: true, isFocused: false, isPlaced: true },
    ]);
    await $.session.start(SESSION_START);

    await pressDetails(await drawCall($, FORGOTTEN_ID, FORGOTTEN_COMMAND));

    const text = textOf(await mountPane($));
    expect(text).not.toContain(TIMELINE_TITLE);
    expect(text).toContain(FORGOTTEN_COMMAND);
    expect(text).toContain(FORGOTTEN_OUTPUT);
  });

  test("D6 rendering the open call view again reads the session once", async ($, on) => {
    worldOf(on, [
      { id: PANE_ID, title: "Session", isShown: true, isFocused: false, isPlaced: true },
    ]);
    await $.session.start(SESSION_START);

    await pressDetails(await drawCall($, FORGOTTEN_ID, FORGOTTEN_COMMAND));
    await mountPane($);
    await mountPane($);
    await mountPane($);

    expect(messageReads).toBe(1);
  });

  test("D7 Details on a running call opens its view at once and shows the output when the call ends, with no second press", async ($, on) => {
    worldOf(on, [
      { id: PANE_ID, title: "Session", isShown: true, isFocused: false, isPlaced: true },
    ]);
    await $.session.start(SESSION_START);
    let finish: () => void = () => undefined;
    gates.set("run-1", new Promise<void>((resolve) => (finish = resolve)));
    const running = $.tool.call({
      tool: "Bash",
      command: FIRST_COMMAND,
      tool_use_id: "run-1",
    } as never);

    await pressDetails(await drawCall($, "run-1", FIRST_COMMAND));
    const whileRunning = textOf(await mountPane($));
    finish();
    await running;
    const afterEnd = textOf(await mountPane($));

    expect(whileRunning).not.toContain(TIMELINE_TITLE);
    expect(whileRunning).toContain("running");
    expect(whileRunning).toContain(FIRST_COMMAND);
    expect(afterEnd).toContain(OUTPUT_LINE);
  });

  test("D4 with the pane closed, Details opens the pane on the first call of the group", async ($, on) => {
    worldOf(on, []);
    await $.session.start(SESSION_START);
    await runCalls($);

    await pressDetails(await drawGroup($));

    const text = textOf(await mountPane($));
    expect(text).not.toContain(TIMELINE_TITLE);
    expect(text).toContain(FIRST_COMMAND);
  });

  test("D8 a call read from the session shows no run time", async ($, on) => {
    worldOf(on, [PANE_OPEN]);
    await $.session.start(SESSION_START);

    await pressDetails(await drawCall($, FORGOTTEN_ID, FORGOTTEN_COMMAND));

    expect(textOf(await mountPane($))).not.toContain("0ms");
  });

  test("D9 a running call that throws ends on its error from the session, not on details not kept", async ($, on) => {
    worldOf(on, [PANE_OPEN]);
    await $.session.start(SESSION_START);
    let fail: () => void = () => undefined;
    gates.set(
      "run-2",
      new Promise<void>((_resolve, reject) => (fail = () => reject(new Error(ERROR_TEXT)))),
    );
    const running = $.tool.call({
      tool: "Bash",
      command: FIRST_COMMAND,
      tool_use_id: "run-2",
    } as never);
    await pressDetails(await drawCall($, "run-2", FIRST_COMMAND));
    expect(textOf(await mountPane($))).toContain("running");

    sessionUses.push({
      tool_use_id: "run-2",
      tool: "Bash",
      input: { command: FIRST_COMMAND },
      text: ERROR_TEXT,
      isError: true,
    });
    fail();
    await running.catch(() => undefined);

    const text = textOf(await mountPane($));
    expect(text).toContain(ERROR_TEXT);
    expect(text).not.toContain("details not kept");
  });

  test("D10 pressing Details on A and then on B shows B although A's session read ends last", async ($, on) => {
    worldOf(on, [PANE_OPEN]);
    await $.session.start(SESSION_START);
    let releaseA: () => void = () => undefined;
    readGates.push(new Promise<void>((resolve) => (releaseA = resolve)));

    await pressDetails(await drawCall($, FORGOTTEN_ID, FORGOTTEN_COMMAND));
    const staleDraw = mountPane($);
    await pressDetails(await drawCall($, SECOND_FORGOTTEN_ID, SECOND_FORGOTTEN_COMMAND));
    releaseA();
    await staleDraw;

    const text = textOf(await mountPane($));
    expect(text).toContain(SECOND_FORGOTTEN_COMMAND);
    expect(text).not.toContain(FORGOTTEN_COMMAND);
  });
});

type Pressable = {
  findAll: (query: {
    type: "Button";
  }) => Promise<{ key?: string; props: Record<string, unknown> }[]>;
  press: (target: { key: string }) => Promise<unknown>;
};

type Panes = {
  id: string;
  title: string;
  isShown: boolean;
  isFocused: boolean;
  isPlaced: boolean;
}[];

function worldOf(on: On, panes: Panes): void {
  messageReads = 0;
  gates.clear();
  readGates.length = 0;
  sessionUses = [
    forgottenUse(FORGOTTEN_ID, FORGOTTEN_COMMAND),
    forgottenUse(SECOND_FORGOTTEN_ID, SECOND_FORGOTTEN_COMMAND),
  ];
  on("session.messages", async () => {
    messageReads += 1;
    await readGates.shift();
    return { value: [{ role: "assistant", text: "", toolUses: sessionUses }] };
  });
  mock.clock(on);
  mock.env(on, { HOME: "/home" });
  on("session.model", () => ({ value: "claude-opus-5-5" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: "/work" }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("ui.panes", () => ({ value: panes }));
  on("command.register", () => ({ value: {} }) as never);
  on("agent.list", () => ({ value: [] }));
  on("config.list", () => ({ value: [] }));
  on("session.id", () => ({ value: "fold-session" }));
  const stored = new Map<string, unknown>();
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
  on("classic.SessionStart", () => ({}));
  on("process.run", () => ({ value: { exitCode: 1, stdout: "", stderr: "" } }) as never);
  on("fs.exists", () => ({ value: true }));
  on("tool.call", async (_$, e) => {
    await gates.get(e.tool_use_id);
    const outcome = { result: bashOutput(), text: OUTPUT_LINE };
    sessionUses.push(useOf(e, outcome));
    return outcome;
  });
}

function forgottenUse(id: string, command: string): ToolUseSummary {
  return {
    tool_use_id: id,
    tool: "Bash",
    input: { command },
    result: { stdout: FORGOTTEN_OUTPUT, stderr: "", interrupted: false },
    text: FORGOTTEN_OUTPUT,
  };
}

function bashOutput(): Record<string, unknown> {
  return { stdout: OUTPUT_LINE, stderr: "", interrupted: false };
}

async function runCalls($: Engine): Promise<void> {
  await $.tool.call({ tool: "Bash", command: FIRST_COMMAND, tool_use_id: "d-1" } as never);
  await $.tool.call({ tool: "Bash", command: SECOND_COMMAND, tool_use_id: "d-2" } as never);
}

function callProps(id: string, command: string) {
  return {
    tool_use_id: id,
    tool: "Bash",
    input: { command },
    output: bashOutput(),
    isRunning: false,
    isErrored: false,
    isInterrupted: false,
  };
}

async function drawResult($: Engine, id: string, isExpanded: boolean): Promise<Node> {
  const ui = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "ToolResult",
    props: { tool_use_id: id, tool: "Bash", output: bashOutput(), isErrored: false, isExpanded },
    viewport: { columns: COLUMNS, rows: ROWS },
  });
  return await ui.drawn();
}

function drawGroup($: Engine) {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "ToolGroup",
    props: {
      calls: [callProps("d-1", FIRST_COMMAND), callProps("d-2", SECOND_COMMAND)],
      isActive: false,
      isExpanded: false,
    },
    viewport: { columns: COLUMNS, rows: ROWS },
  });
}

function drawCall($: Engine, id: string, command: string, isExpanded = false) {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "ToolUse",
    props: { ...callProps(id, command), isExpanded },
    viewport: { columns: COLUMNS, rows: ROWS },
  });
}

async function pressDetails(card: Pressable): Promise<void> {
  const [details] = (await card.findAll({ type: "Button" })).filter(
    (button) => button.props.label === "Details",
  );
  await card.press({ key: details?.key ?? "" });
}

async function mountPane($: Engine): Promise<Node> {
  const pane = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: PANE_ID,
    props: {
      title: "Session",
      isFocused: false,
      bodyColumns: COLUMNS,
      placement: "dock",
      scroll: { offset: 0, bodyRows: ROWS },
      view: {},
    },
    viewport: { columns: COLUMNS, rows: ROWS },
  });
  const tree = await pane.drawn();
  await pane.unmount();
  return tree;
}

function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node !== "object" || node === null) return "";
  const { children } = node as Node;
  return textOf(children);
}
