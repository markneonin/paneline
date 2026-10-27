import { describe, expect, mock, test } from "claude-code/testing";
import type { AgentInfo, On } from "claude-code";
import type { Engine, MockClock, Mounted } from "claude-code/testing";

import { inkFor } from "../hooks/pane-ink";
import { collect, textOf } from "./draw-tree";

type Pane = Mounted<"terminal", "Pane">;

const NOW = 200_000;
const COLUMNS = 60;
const PANE_ROWS = 40;
const FLUSH_MS = 1_000;
const POLL_AND_FLUSH_MS = 4_000;
const SPAWNED_DESCRIPTION = "alpha job";
const LISTED_DESCRIPTION = "forked skill";

describe("pane shell", () => {
  test("S1 /paneline while Agents is shown: the first pane draw after it is Activity, without the agents", async ($, on) => {
    const world = worldOf(on);
    const pane = await mountPane($);
    await spawnAgent($, world.clock, SPAWNED_DESCRIPTION);
    await showTab(pane, "Agents");
    expect(await paneText(pane)).toContain(SPAWNED_DESCRIPTION);

    await runPanelineCommand($);

    expect(await paneText(pane)).not.toContain(SPAWNED_DESCRIPTION);
  });

  test("S2 after /paneline the Agents tab can be opened again and shows the agents", async ($, on) => {
    const world = worldOf(on);
    const pane = await mountPane($);
    await spawnAgent($, world.clock, SPAWNED_DESCRIPTION);
    await showTab(pane, "Agents");
    await runPanelineCommand($);
    expect(await paneText(pane)).not.toContain(SPAWNED_DESCRIPTION);

    await showTab(pane, "Agents");

    expect(await paneText(pane)).toContain(SPAWNED_DESCRIPTION);
  });

  test("S3 a theme change from outside shows the new look on the first pane draw after it", async ($, on) => {
    const world = worldOf(on);
    world.theme = "light-ansi";
    await $.session.start({ cwd: "/work", surface: "terminal", isInteractive: true });
    await $.tool.call({ tool: "Bash", command: "ls", tool_use_id: "sh-1" } as never);
    await world.clock.advance(FLUSH_MS);
    const pane = await mountPane($);
    expect(await mixColours(pane)).toContain(inkFor("light-ansi").mix.Bash);

    world.theme = "auto";
    await $.classic.ConfigChange({ source: "user_settings" } as never);

    const colours = await mixColours(pane);
    expect(colours).toContain(inkFor("auto").mix.Bash);
    expect(colours).not.toContain(inkFor("light-ansi").mix.Bash);
  });

  test("S4 clicking Agents makes the tab list an agent the engine runs that the pane never saw", async ($, on) => {
    const world = worldOf(on, [
      { id: "forked", type: "fork", description: LISTED_DESCRIPTION, status: "running" },
    ]);
    await $.classic.SessionStart({ source: "clear" });
    const pane = await mountPane($);

    await showTab(pane, "Agents");
    await world.clock.advance(POLL_AND_FLUSH_MS);

    expect(await paneText(pane)).toContain(LISTED_DESCRIPTION);
  });

  test("S5 the Agents tab stays as it is when it is drawn again without a click", async ($, on) => {
    const world = worldOf(on, [
      { id: "forked", type: "fork", description: LISTED_DESCRIPTION, status: "running" },
    ]);
    await $.classic.SessionStart({ source: "clear" });
    const pane = await mountPane($);
    await showTab(pane, "Agents");
    await world.clock.advance(POLL_AND_FLUSH_MS);
    const before = await paneText(pane);

    await pane.redraw();

    expect(await paneText(pane)).toBe(before);
  });
});

type World = { clock: MockClock; theme: string };

function worldOf(on: On, listed: object[] = []): World {
  const world: World = { clock: mock.clock(on, { now: NOW }), theme: "dark" };
  mock.env(on, { HOME: "/h/u" });
  on("command.run", () => ({ value: { ref: 1 } }) as never);
  on("config.list", () => ({ value: [{ key: "theme", value: world.theme }] }) as never);
  on("classic.SessionStart", () => ({}));
  on("classic.ConfigChange", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("fs.exists", () => ({ value: true }));
  on("tool.call", () => ({ result: "ok", text: "ok" }));
  on("agent.spawn", () => ({ model: "sonnet", agentId: "spawned-1" }));
  on("agent.list", () => ({ value: listed as unknown as AgentInfo[] }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: "/work" }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("command.register", () => ({ value: {} }) as never);
  on("ui.render", { component: "Pane" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text color="text">engine pane</Text>;
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

async function spawnAgent($: Engine, clock: MockClock, description: string): Promise<void> {
  await $.agent.spawn({
    tool_use_id: `call-${description}`,
    prompt: "do the work",
    description,
    subagentType: "general-purpose",
    provider: "anthropic",
    parentModel: "sonnet",
    background: false,
    fork: false,
  } as never);
  await clock.advance(FLUSH_MS);
}

function runPanelineCommand($: Engine) {
  return $.command.run({
    command: "paneline",
    args: "",
    origin: { kind: "composer" },
    presentation: { isFullscreen: false, columns: COLUMNS },
  });
}

async function showTab(pane: Pane, label: string): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const tab = buttons.find((button) => button.props.label === label);
  expect(tab, `the tab bar has a ${label} tab`).toBeDefined();
  await pane.press({ key: tab?.key ?? "" });
}

async function paneText(pane: Pane): Promise<string> {
  return collect(await pane.drawn(), "Text")
    .map(textOf)
    .join("\n");
}

async function mixColours(pane: Pane): Promise<unknown[]> {
  return collect(await pane.drawn(), "Text").map((node) => node.props?.color);
}
