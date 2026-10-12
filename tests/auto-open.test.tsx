import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

const SESSION_START = { cwd: "/work", surface: "terminal", isInteractive: true } as const;
const AUTO_OPEN_OFF = { options: { autoOpen: false } };

describe("auto open", () => {
  test("O1 with the option not set, a new session and a clear open the pane", async ($, on) => {
    const world = worldOf(on);

    await $.session.start(SESSION_START);
    await world.settle();
    await $.classic.SessionStart({ source: "clear" });
    await world.settle();

    expect(world.opened).toEqual(["session", "session"]);
  });

  test(
    "O2 with auto open off, a new session does not open the pane",
    AUTO_OPEN_OFF,
    async ($, on) => {
      const world = worldOf(on);

      await $.session.start(SESSION_START);
      await world.settle();

      expect(world.opened).toEqual([]);
    },
  );

  test(
    "O3 with auto open off, clear, resume and fork do not open the pane",
    AUTO_OPEN_OFF,
    async ($, on) => {
      const world = worldOf(on);
      await $.session.start(SESSION_START);
      await world.settle();

      await $.classic.SessionStart({ source: "clear" });
      await $.classic.SessionStart({ source: "resume" });
      await $.classic.SessionStart({ source: "fork" });
      await world.settle();

      expect(world.opened).toEqual([]);
    },
  );

  test("O4 with auto open off, /session still opens the pane", AUTO_OPEN_OFF, async ($, on) => {
    const world = worldOf(on);
    await $.session.start(SESSION_START);
    await world.settle();

    await runSession($);
    await world.settle();

    expect(world.opened).toEqual(["session"]);
  });
});

function runSession($: Engine) {
  return $.command.run({
    command: "session",
    args: "",
    origin: { kind: "composer" },
    presentation: { isFullscreen: false, columns: 100 },
  });
}

function worldOf(on: On): { opened: string[]; settle: () => Promise<void> } {
  const clock = mock.clock(on);
  mock.env(on, { HOME: "/home" });
  const opened: string[] = [];
  const stored = new Map<string, unknown>();
  on("config.list", () => ({ value: [{ key: "theme", value: "dark" }] }) as never);
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
  on("session.id", () => ({ value: "s1" }));
  on("session.model", () => ({ value: "claude-opus-5-5" }));
  on("session.cwd", () => ({ value: "/work" }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("ui.open", (_$, e) => {
    opened.push(e.id);
    return { value: { isPlaced: true } };
  });
  on("command.register", () => ({ value: {} }) as never);
  on("agent.list", () => ({ value: [] }));
  on("classic.SessionStart", () => ({}));
  on("process.run", () => ({ value: { exitCode: 1, stdout: "", stderr: "" } }) as never);
  return { opened, settle: () => clock.settle() };
}
