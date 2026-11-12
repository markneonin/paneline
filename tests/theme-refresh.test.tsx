import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

import { inkFor } from "../hooks/pane-ink";
import { collect } from "./draw-tree";

const CWD = "/Users/dev/app";
const COLUMNS = 60;
const PANE_ROWS = 40;
const FLUSH_MS = 400;

let clock: ReturnType<typeof mock.clock>;
let chosenTheme = "dark";
let pendingTheme: string | null = null;
let readsSincePick = 0;
const WRITE_LAG_READS = 3;

describe("the pane follows a theme change at once", () => {
  test("TR1 /theme from light-ansi to auto: the next pane draw is the dark look", async ($, on) => {
    paneWorld(on, "light-ansi");
    await startWithBashCall($);
    expect(await mixColours($)).toContain(inkFor("light-ansi").mix.Bash);

    await pickTheme($, "auto");

    const colours = await mixColours($);
    expect(colours).toContain(inkFor("auto").mix.Bash);
    expect(colours).not.toContain(inkFor("light-ansi").mix.Bash);
  });

  test("TR2 /theme from auto to light-ansi: the next pane draw is the light ansi look", async ($, on) => {
    paneWorld(on, "auto");
    await startWithBashCall($);

    await pickTheme($, "light-ansi");

    expect(await mixColours($)).toContain(inkFor("light-ansi").mix.Bash);
  });

  test("TR3 a settings file edit from light-ansi to auto shows on the next pane draw", async ($, on) => {
    paneWorld(on, "light-ansi");
    await startWithBashCall($);

    chosenTheme = "auto";
    await $.classic.ConfigChange({ source: "user_settings" } as never);

    const colours = await mixColours($);
    expect(colours).toContain(inkFor("auto").mix.Bash);
    expect(colours).not.toContain(inkFor("light-ansi").mix.Bash);
  });

  test("TR4 /theme that keeps the theme leaves the pane look as it was", async ($, on) => {
    paneWorld(on, "light-ansi");
    await startWithBashCall($);

    await pickTheme($, "light-ansi");

    expect(await mixColours($)).toContain(inkFor("light-ansi").mix.Bash);
  });
});

async function startWithBashCall($: Engine): Promise<void> {
  await $.session.start({ cwd: CWD, surface: "terminal", isInteractive: true });
  await $.tool.call({ tool: "Bash", command: "ls", tool_use_id: "tr-1" } as never);
  await clock.advance(FLUSH_MS);
}

async function pickTheme($: Engine, theme: string): Promise<void> {
  pendingTheme = theme;
  await $.command.run({
    command: "theme",
    args: "",
    origin: { kind: "composer" },
    presentation: { isFullscreen: false, columns: COLUMNS },
  });
}

async function mixColours($: Engine): Promise<unknown[]> {
  const tree = await drawPane($);
  return collect(tree, "Text").map((node) => node.props?.color);
}

function paneWorld(on: On, theme: string): void {
  chosenTheme = theme;
  pendingTheme = null;
  readsSincePick = 0;
  clock = mock.clock(on, { now: 200_000 });
  mock.env(on, { HOME: "/Users/dev" });
  on("command.run", () => ({ value: { ref: 1 } }) as never);
  on("config.list", () => {
    if (pendingTheme !== null && ++readsSincePick >= WRITE_LAG_READS) chosenTheme = pendingTheme;
    return { value: [{ key: "theme", value: chosenTheme }] } as never;
  });
  on("classic.SessionStart", () => ({}));
  on("classic.ConfigChange", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", () => ({ value: true }));
  on("tool.call", () => ({ result: "ok", text: "ok" }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.model", () => ({ value: "claude-opus-5-5" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: CWD }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("command.register", () => ({ value: {} }) as never);
  on("ui.render", { component: "Pane" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text color="text">engine pane</Text>;
  });
}

async function drawPane($: Engine) {
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
      scroll: { offset: 0, bodyRows: PANE_ROWS },
      view: {},
    },
    viewport: { columns: COLUMNS, rows: PANE_ROWS },
  });
  const tree = await pane.drawn();
  await pane.unmount();
  return tree;
}
