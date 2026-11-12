import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

import { inkFor } from "../hooks/pane-ink";
import { collect } from "./draw-tree";
import type { Node } from "./draw-tree";

const HOME = "/Users/dev";
const CWD = "/Users/dev/app";
const COLUMNS = 60;
const PANE_ROWS = 40;
const FLUSH_MS = 400;
const TERMINAL_COLOUR = /^ansi256\(([0-9]|1[0-5])\)$/;
const AUTO_HUES = [
  "ansi256(1)",
  "ansi256(2)",
  "ansi256(3)",
  "ansi256(4)",
  "ansi256(5)",
  "ansi256(6)",
  "ansi256(12)",
  "ansi256(13)",
].sort();
const OTHER_THEMES = [
  "dark",
  "light",
  "dark-ansi",
  "light-ansi",
  "dark-daltonized",
  "light-daltonized",
];
const ENGINE_KEY = /^[a-zA-Z]+$/;
const TABS = ["Activity", "Files", "Agents", "Context", "MCP"];

const BREAKDOWN = {
  categories: [
    {
      name: "System prompt",
      tokens: 3_000,
      color: "promptBorder",
      isDeferred: false,
      kind: "used",
    },
    { name: "Messages", tokens: 40_000, color: "permission", isDeferred: false, kind: "used" },
    { name: "Free space", tokens: 100_000, color: "promptBorder", isDeferred: false, kind: "free" },
  ],
  totalTokens: 43_000,
  rawMaxTokens: 200_000,
  percentage: 21,
  model: "claude-opus-5-5",
  gridRows: [
    [
      { categoryName: "System prompt", squareFullness: 1 },
      { categoryName: "Messages", squareFullness: 1 },
      { categoryName: "Free space", squareFullness: 1 },
    ],
  ],
  memoryFiles: [],
  mcpTools: [],
  agents: [],
  skills: { totalSkills: 0, includedSkills: 0, tokens: 0, skillFrontmatter: [] },
  autoCompactThreshold: 160_000,
  isAutoCompactEnabled: true,
};

let clock: ReturnType<typeof mock.clock>;

describe("under auto the pane marks take the terminal's palette on the engine fill", () => {
  test("TL1 every auto ink colour is a terminal palette index", () => {
    const ink = inkFor("auto");

    const colours = [
      ink.rule,
      ink.meterEmpty,
      ink.section,
      ink.muted,
      ink.ok,
      ink.failed,
      ink.alert,
      ...Object.values(ink.mix),
      ...ink.hues,
    ];
    expect(colours.filter((colour) => !TERMINAL_COLOUR.test(colour))).toEqual([]);
  });

  test("TL2 the auto pane marks are the terminal's red, green, yellow, blue, magenta and cyan, then bright blue and bright magenta", () => {
    const ink = inkFor("auto");

    expect([...ink.hues].sort()).toEqual(AUTO_HUES);
    expect(ink.mix.Read).toBe("ansi256(4)");
    expect(ink.ok).toBe("ansi256(2)");
    expect(ink.failed).toBe("ansi256(1)");
  });

  test("TL3 under auto the pane keeps the engine fill and the text takes the terminal default colour", () => {
    const ink = inkFor("auto");

    expect(ink.fill).toBeUndefined();
    expect(ink.text).toBeUndefined();
    expect(ink.tool).toBeUndefined();
  });

  test("TL4 every other theme keeps the engine's pane fill", () => {
    for (const theme of OTHER_THEMES) expect(inkFor(theme).fill).toBeUndefined();
  });

  for (const tab of TABS) {
    test(`TL5 under auto the ${tab} tab draws no engine theme key and no fill`, async ($, on) => {
      paneWorld(on, "auto");
      await $.session.start({ cwd: CWD, surface: "terminal", isInteractive: true });

      const tree = await paneOnTab($, tab);

      const keyed = collect(tree, "Text")
        .map((node) => node.props?.color)
        .filter(
          (colour): colour is string => typeof colour === "string" && ENGINE_KEY.test(colour),
        );
      expect(keyed).toEqual([]);
      expect(tree.props?.backgroundColor).toBeUndefined();
    });
  }

  test("TL6 under dark the pane root has no fill of its own", async ($, on) => {
    paneWorld(on, "dark");
    await $.session.start({ cwd: CWD, surface: "terminal", isInteractive: true });

    const tree = await paneOnTab($, "Activity");

    expect(tree.props?.backgroundColor).toBeUndefined();
  });
});

function paneWorld(on: On, theme: string): void {
  clock = mock.clock(on, { now: 200_000 });
  mock.env(on, { HOME });
  on("config.list", () => ({ value: [{ key: "theme", value: theme }] }) as never);
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", () => ({ value: true }));
  on("tool.call", () => ({ result: "ok", text: "ok" }));
  on(
    "session.usage",
    () =>
      ({
        value: {
          startedAt: 0,
          context: { window: 200_000, breakdown: BREAKDOWN },
          rateLimits: [],
        },
      }) as never,
  );
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

async function paneOnTab($: Engine, label: string): Promise<Node> {
  const calls = [
    { tool: "Read", file_path: `${CWD}/src/a.ts` },
    { tool: "Edit", file_path: `${CWD}/src/a.ts` },
  ];
  for (const [i, call] of calls.entries())
    await $.tool.call({ ...call, tool_use_id: `tl-${i}` } as never);
  await clock.advance(FLUSH_MS);
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
  const tab = (await pane.findAll({ type: "Button" })).find(
    (button) => button.props.label === label,
  );
  if (tab !== undefined) await pane.press({ key: tab.key ?? "" });
  return await pane.drawn();
}
