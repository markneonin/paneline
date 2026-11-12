import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { childrenOf, collect, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import { feedSession, handbackOf, notificationOf } from "./session-feed";
import type { SessionFeed } from "./session-feed";

type Pane = Mounted<"terminal", "Pane">;
type Outcome = Record<string, unknown>;

const COLUMNS = 80;
const PANE_ROWS = 40;
const KEPT_LINES = 400;
const LONG_REPORT_LINES = 450;
const CWD = "/work";
const LAUNCH_TEXT =
  "Async agent launched successfully. (This tool result is internal metadata, do not repeat it.)";
const REPORT = "# Found\n- one\n- two";
const SPAWNED = "agent-7";
const OTHER = "agent-9";
const HANDBACK = "PINEAPPLE-7";
const POINTER =
  "This agent's report was delivered to you as a message … Read it there; it is not repeated here.";

describe("an async Agent call shows the subagent's report", () => {
  test("R1 the detail shows the launch text until the subagent finishes, then its report as a heading and two items", async ($, on) => {
    worldOf(on, { a1: asyncLaunch(SPAWNED) });
    await $.tool.call(agentCall("a1"));
    const pane = await mountPane($);
    await pane.press({ key: "call-a1" });

    const waiting = await detailOf(pane);
    await $.turn.complete(completion(SPAWNED, REPORT));
    const reported = await detailOf(pane);

    expect(textOf(waiting)).toContain("Async agent launched successfully");
    const text = textOf(reported);
    expect(text).not.toContain("Async agent launched successfully");
    expect(text).not.toContain("# Found");
    expect(text).not.toContain("- one");
    expect(leavesOf(reported).map(textOf)).toContain("Found");
    expect(text).toContain("• one");
    expect(text).toContain("• two");
  });

  test("R2 the answer of another agent leaves the call showing its launch text", async ($, on) => {
    worldOf(on, { a1: asyncLaunch(SPAWNED) });
    await $.tool.call(agentCall("a1"));

    await $.turn.complete(completion(OTHER, REPORT));

    const pane = await mountPane($);
    await pane.press({ key: "call-a1" });
    const text = textOf(await detailOf(pane));
    expect(text).toContain("Async agent launched successfully");
    expect(text).not.toContain("• one");
  });

  test("R3 a synchronous Agent result is still shown as it was, and a later answer of another agent does not change it", async ($, on) => {
    worldOf(on, { a1: { result: "# Sync\n- alpha", text: "# Sync\n- alpha" } });
    await $.tool.call(agentCall("a1"));

    await $.turn.complete(completion(OTHER, REPORT));

    const pane = await mountPane($);
    await pane.press({ key: "call-a1" });
    const root = await detailOf(pane);
    expect(leavesOf(root).map(textOf)).toContain("Sync");
    expect(textOf(root)).toContain("• alpha");
    expect(textOf(root)).not.toContain("• one");
  });

  test("R4 a subagent that ends with no answer leaves the call showing its launch text", async ($, on) => {
    worldOf(on, { a1: asyncLaunch(SPAWNED) });
    await $.tool.call(agentCall("a1"));

    await $.turn.complete(completion(SPAWNED, ""));

    const pane = await mountPane($);
    await pane.press({ key: "call-a1" });
    expect(textOf(await detailOf(pane))).toContain("Async agent launched successfully");
  });

  test("R5 a report of 450 lines keeps the first 400 and says 50 more were not kept", async ($, on) => {
    const report = Array.from({ length: LONG_REPORT_LINES }, (_, i) => `- item no${i}`).join("\n");
    worldOf(on, { a1: asyncLaunch(SPAWNED) });
    await $.tool.call(agentCall("a1"));

    await $.turn.complete(completion(SPAWNED, report));

    const pane = await mountPane($);
    await pane.press({ key: "call-a1" });
    const folded = await detailOf(pane);
    expect(textOf(folded)).toContain("item no0");
    const unfoldButton = collect(folded, "Button").find((button) =>
      /more lines?$/.test(String(button.props?.label)),
    );
    await pane.press({ key: String(unfoldButton?.props?.key) });
    const text = textOf(await detailOf(pane));
    expect(text).toContain(`item no${KEPT_LINES - 1}`);
    expect(text).not.toContain(`item no${KEPT_LINES}`);
    expect(text).toContain(`… ${LONG_REPORT_LINES - KEPT_LINES} more lines`);
  });

  test("R6 the detail shows the subagent's hand-back instead of the pointer to its report", async ($, on) => {
    const feed = worldOf(on, { a1: asyncLaunch(SPAWNED) });
    await $.tool.call(agentCall("a1"));
    feed.hold(handbackOf(HANDBACK), SPAWNED);

    await $.turn.complete(completion(SPAWNED, POINTER));

    const pane = await mountPane($);
    await pane.press({ key: "call-a1" });
    const text = textOf(await detailOf(pane));
    expect(text).toContain(HANDBACK);
    expect(text).not.toContain("it is not repeated here");
  });

  test("R7 the detail shows the report from the finished-task notice when the subagent has no hand-back", async ($, on) => {
    worldOf(on, { a1: asyncLaunch(SPAWNED) });
    await $.tool.call(agentCall("a1"));

    await $.turn.complete(completion(SPAWNED, REPORT));

    const pane = await mountPane($);
    await pane.press({ key: "call-a1" });
    const text = textOf(await detailOf(pane));
    expect(text).toContain("• one");
    expect(text).toContain("• two");
  });

  function agentCall(id: string): never {
    return { tool: "Agent", description: "look around", tool_use_id: id } as never;
  }
});

function worldOf(on: On, outcomes: Record<string, Outcome>): SessionFeed {
  const feed = feedSession(on);
  mock.clock(on, { now: 200_000 });
  mock.env(on, { HOME: "/h/u" });
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("fs.exists", () => ({ value: true }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: CWD }));
  on("command.register", () => ({ value: {} }) as never);
  on("agent.list", () => ({ value: [] }));
  on("turn.complete", (_$, e) => {
    const launchId = Object.keys(outcomes).find(
      (id) => (outcomes[id]?.result as { agentId?: string } | undefined)?.agentId === e.agentId,
    );
    if (launchId !== undefined && e.answer !== "") feed.say(notificationOf(launchId, e.answer));
    return { text: e.answer };
  });
  on("tool.call", (_$, e) => {
    const id = (e as unknown as { tool_use_id: string }).tool_use_id;
    return feed.record(e, outcomes[id] ?? { result: "ok", text: "ok" }) as never;
  });
  return feed;
}

function asyncLaunch(agentId: string): Outcome {
  return {
    result: {
      status: "async_launched",
      isAsync: true,
      agentId,
      description: "look around",
      prompt: "look around",
      outputFile: `/tmp/${agentId}.output`,
    },
    text: LAUNCH_TEXT,
  };
}

function completion(agentId: string, answer: string) {
  return {
    answer,
    durationMs: 5,
    isAborted: false,
    turnId: "turn-1",
    agentId,
    reason: "answer",
  } as const;
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

async function detailOf(pane: Pane): Promise<Node> {
  const tree = (await pane.drawn()) as unknown as Node;
  const root = collect(tree, "Box").find((box) =>
    childrenOf(box).some((row) => childrenOf(row).some((cell) => cell.props?.key === "back")),
  );
  if (root === undefined) throw new Error("the call detail is not drawn");
  return root;
}

function leavesOf(root: Node): Node[] {
  return collect(root, "Text").filter((text) => childrenOf(text).length === 0);
}
