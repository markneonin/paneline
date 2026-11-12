import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, MockClock, Mounted } from "claude-code/testing";

import { lines } from "./clear-world";
import { textOf } from "./draw-tree";
import { keyOf } from "./skills-tree";

type Pane = Mounted<"terminal", "Pane">;

const COLUMNS = 80;
const PANE_ROWS = 40;
const CWD = "/work";
const NOW = 200_000;
const LAUNCH_MS = 526;
const RUN_MS = 4_000;
const CALL_ID = "agent-call";
const CALL_KEY = `call-${CALL_ID}`;
const SPAWNED = "agent-7";
const REPORT = "# Found\n- one\n- two";
const LAUNCH_TEXT =
  "Async agent launched successfully. (This tool result is internal metadata, do not repeat it.)";

describe("background Agent calls in the Activity tab", () => {
  test("G4 a background Agent row shows the 4s its subagent ran, not the 526ms of its launch", async ($, on) => {
    const clock = worldOf(on);
    await launchBackgroundAgent($);
    await clock.advance(RUN_MS);
    await $.turn.complete(completion(REPORT));

    const row = await rowTextOf(await mountPane($), CALL_KEY);
    expect(row).toContain("4s");
    expect(row).not.toContain("526ms");
  });

  test("G5 a background Agent that ends with no report still shows the 4s its subagent ran", async ($, on) => {
    const clock = worldOf(on);
    await launchBackgroundAgent($);
    await clock.advance(RUN_MS);
    await $.turn.complete(completion(""));

    const row = await rowTextOf(await mountPane($), CALL_KEY);
    expect(row).toContain("4s");
    expect(row).not.toContain("526ms");
  });
});

function worldOf(on: On): MockClock {
  const clock = mock.clock(on, { now: NOW });
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
  on("agent.list", () => ({ value: [] }));
  on("turn.complete", (_$, e) => ({ text: e.answer }));
  on("tool.call", async () => {
    await clock.advance(LAUNCH_MS);
    return asyncLaunch() as never;
  });
  return clock;
}

function asyncLaunch(): Record<string, unknown> {
  return {
    result: {
      status: "async_launched",
      isAsync: true,
      agentId: SPAWNED,
      description: "look around",
      prompt: "look around",
      outputFile: `${CWD}/${SPAWNED}.output`,
    },
    text: LAUNCH_TEXT,
  };
}

function launchBackgroundAgent($: Engine): Promise<unknown> {
  return $.tool.call({ tool: "Agent", description: "look around", tool_use_id: CALL_ID } as never);
}

function completion(answer: string): never {
  return {
    answer,
    durationMs: RUN_MS,
    isAborted: false,
    turnId: `turn-${SPAWNED}`,
    agentId: SPAWNED,
    reason: "answer",
  } as never;
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

async function rowTextOf(pane: Pane, key: string): Promise<string> {
  const row = (await lines(pane)).find((line) =>
    line.parts.some((part) => part.type === "Button" && keyOf(part) === key),
  );
  if (row === undefined) throw new Error(`the call row ${key} is not drawn`);
  return row.parts.map((part) => textOf(part)).join("");
}
