import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

const SESSION_START = { cwd: "/work", surface: "terminal", isInteractive: true } as const;
const COLUMNS = 100;
const ROWS = 24;

describe("details button", () => {
  test("D1 pressing Details in a tool group opens the session pane with the panel fill", async ($, on) => {
    const opened = worldOf(on);
    await $.session.start(SESSION_START);
    opened.length = 0;
    const group = await mountToolGroup($);
    const [details] = (await group.findAll({ type: "Button" })).filter(
      (button) => button.props.label === "Details",
    );

    await group.press({ key: details?.key ?? "" });

    expect(opened).toEqual([
      {
        id: "session",
        title: "Session",
        closeOnEscape: true,
        backgroundColor: "composerSidebarBackground",
      },
    ]);
  });
});

function mountToolGroup($: Engine) {
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
        },
      ],
      isActive: false,
      isExpanded: false,
    },
    viewport: { columns: COLUMNS, rows: ROWS },
  });
}

function worldOf(on: On): unknown[] {
  mock.clock(on);
  mock.env(on, { HOME: "/home" });
  const opened: unknown[] = [];
  on("session.model", () => ({ value: "claude-opus-5-5" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: "/work" }));
  on("session.messages", () => ({ value: [] }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("ui.panes", () => ({ value: [] }));
  on("ui.open", (_$, e) => {
    opened.push({
      id: e.id,
      title: e.title,
      closeOnEscape: e.closeOnEscape,
      backgroundColor: e.backgroundColor,
    });
    return { value: { isPlaced: true } };
  });
  on("command.register", () => ({ value: {} }) as never);
  on("agent.list", () => ({ value: [] }));
  on("classic.SessionStart", () => ({}));
  on("process.run", () => ({ value: { exitCode: 1, stdout: "", stderr: "" } }) as never);
  on("fs.exists", () => ({ value: true }));
  return opened;
}
