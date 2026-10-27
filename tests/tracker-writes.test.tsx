import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, MockClock } from "claude-code/testing";

type Drawn = { type?: string; props?: Record<string, unknown>; children?: unknown[] };
type Write = { key: string; value: unknown };
type Band = { drawn: () => Promise<unknown> };
type World = { clock: MockClock; writes: Write[]; band: Band; setBranch: (name: string) => void };
type Options = { colour?: string; theme?: string };

const HOME_DIR = "/Users/dev";
const WORK_DIR = "/Users/dev/IT";
const MODEL = "claude-opus-5-5";
const SESSION_ID = "session-1";
const TRANSCRIPT = "/home/session.jsonl";
const TRANSCRIPT_FIELDS = { session_id: SESSION_ID, cwd: WORK_DIR, transcript_path: TRANSCRIPT };
const COLOUR = "red";
const DEFAULT_THEME = "dark";
const MAIN_BRANCH = "main";
const OTHER_BRANCH = "feature/x";
const HEAD_SHA = "abc123";
const EFFORT_HIGH = "high";
const EFFORT_LOW = "low";
const AGENT_ID = "agent-1";
const ENGINE_ROW = "engine row";
const COLUMNS = 100;
const BAND_ROWS = 10;
const SESSION_START = { cwd: WORK_DIR, surface: "terminal", isInteractive: true } as const;
const CHIPS_WITH_HIGH = [" opus 5.5 ", " high ", " ~/IT "];
const CHIPS_WITH_LOW = [" opus 5.5 ", " low ", " ~/IT "];

describe("trackers write only what changed", () => {
  test("W1 a prompt in a session whose colour is unchanged writes no session colour and no transcript path", async ($, on) => {
    const world = await worldOf($, on, { colour: COLOUR });
    await $.session.start(SESSION_START);
    await $.classic.Stop(stop(EFFORT_HIGH));

    const written = keysOf(
      await writesDuring(world, () =>
        $.classic.UserPromptSubmit({ prompt: "hi", ...TRANSCRIPT_FIELDS }),
      ),
    );

    expect(written).not.toContain("sessionColor");
    expect(written).not.toContain("transcriptPath");
  });

  test("W2 a turn that stops in a session whose colour is unchanged writes no session colour and no transcript path", async ($, on) => {
    const world = await worldOf($, on, { colour: COLOUR });
    await $.session.start(SESSION_START);
    await $.classic.Stop(stop(EFFORT_HIGH));

    const written = keysOf(await writesDuring(world, () => $.classic.Stop(stop(EFFORT_HIGH))));

    expect(written).not.toContain("sessionColor");
    expect(written).not.toContain("transcriptPath");
  });

  test("W3 a session that starts with the theme it already has writes no theme", async ($, on) => {
    const world = await worldOf($, on, { theme: DEFAULT_THEME });

    const written = keysOf(await writesDuring(world, () => $.session.start(SESSION_START)));

    expect(written).not.toContain("theme");
  });

  test("W4 a config change that leaves the theme as it was writes no theme", async ($, on) => {
    const world = await worldOf($, on, { theme: DEFAULT_THEME });
    await $.session.start(SESSION_START);

    const written = keysOf(
      await writesDuring(world, () =>
        $.classic.ConfigChange({ source: "user_settings", ...TRANSCRIPT_FIELDS }),
      ),
    );

    expect(written).not.toContain("theme");
  });

  test("W5 a git command that leaves every branch as it was writes no branch list", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    await checkout($, MAIN_BRANCH);

    const written = keysOf(await writesDuring(world, () => checkout($, MAIN_BRANCH)));

    expect(written).not.toContain("gitBranches");
  });

  test("W6 a subagent's tool use leaves the effort on the chips as it was", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    await $.classic.Stop(stop(EFFORT_HIGH));

    await $.classic.PostToolUse(postToolUse(EFFORT_LOW, AGENT_ID));
    await world.clock.settle();

    expect(chipTexts(await lastRow(world))).toEqual(CHIPS_WITH_HIGH);
  });

  test("W7 a main-session tool use shows its effort on the chips at once", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    await $.classic.Stop(stop(EFFORT_HIGH));

    await $.classic.PostToolUse(postToolUse(EFFORT_LOW));
    await world.clock.settle();

    expect(chipTexts(await lastRow(world))).toEqual(CHIPS_WITH_LOW);
  });

  test("W8 a git command that checks out another branch writes the new branch", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    await checkout($, MAIN_BRANCH);
    world.setBranch(OTHER_BRANCH);

    const written = await writesDuring(world, () => checkout($, OTHER_BRANCH));

    expect(written).toContainEqual({ key: "gitBranches", value: { [WORK_DIR]: OTHER_BRANCH } });
  });
});

async function worldOf($: Engine, on: On, options: Options = {}): Promise<World> {
  const clock = mock.clock(on);
  mock.env(on, { HOME: HOME_DIR });
  const writes: Write[] = [];
  const stored = new Map<string, unknown>();
  const theme = options.theme ?? DEFAULT_THEME;
  let branch = MAIN_BRANCH;

  on("state.set", (_$, e, next) => {
    writes.push({ key: e.key, value: e.value });
    return next(e);
  });
  on("tool.call", () => ({ result: "ok", text: "ok" }));
  on("store.get", (_$, e) => ({ value: stored.get(e.key) }));
  on("store.set", (_$, e) => {
    stored.set(e.key, e.value);
    return { value: undefined };
  });
  on("config.list", () => ({ value: [{ key: "theme", value: theme }] }) as never);
  on(
    "process.run",
    (_$, e) =>
      ({
        value: {
          exitCode: 0,
          stdout: stdoutOf(e.argv, options.colour, branch),
          stderr: "",
        },
      }) as never,
  );
  on("session.id", () => ({ value: SESSION_ID }));
  on("session.model", () => ({ value: MODEL }));
  on("session.cwd", () => ({ value: WORK_DIR }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("command.register", () => ({ value: {} }) as never);
  on("agent.list", () => ({ value: [] }));
  on("classic.SessionStart", () => ({}));
  on("classic.UserPromptSubmit", () => ({}));
  on("classic.PostModelSwitch", () => ({}));
  on("classic.CwdChanged", () => ({}));
  on("classic.Stop", () => ({}));
  on("classic.PostToolUse", () => ({}));
  on("classic.ConfigChange", () => ({}));
  on("ui.render", { component: "AbovePrompt" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>{ENGINE_ROW}</Text>;
  });

  const band = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "AbovePrompt",
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: BAND_ROWS,
      bodyColumns: COLUMNS,
      scroll: { offset: 0, bodyRows: BAND_ROWS },
      view: {},
    },
    viewport: { columns: COLUMNS, rows: 40 },
  });

  return {
    clock,
    writes,
    band,
    setBranch: (name) => {
      branch = name;
    },
  };
}

function stdoutOf(argv: readonly string[], colour: string | undefined, branch: string): string {
  if (argv[0] !== "git") return colour === undefined ? "" : colourLine(colour);
  if (argv.includes("--abbrev-ref")) return branch;
  if (argv.includes("--show-toplevel")) {
    return argv.includes("HEAD") ? `${WORK_DIR}\n${HEAD_SHA}` : WORK_DIR;
  }
  return "";
}

function colourLine(colour: string): string {
  return `{"type":"agent-color","agentColor":"${colour}","sessionId":"s"}\n`;
}

async function writesDuring(world: World, act: () => Promise<unknown>): Promise<Write[]> {
  const before = world.writes.length;
  await act();
  return world.writes.slice(before);
}

function keysOf(writes: Write[]): string[] {
  return writes.map((write) => write.key);
}

async function checkout($: Engine, branch: string): Promise<void> {
  await $.tool.call({
    tool: "Bash",
    command: `git checkout ${branch}`,
    tool_use_id: branch,
  } as never);
}

function stop(level: string): Parameters<Engine["classic"]["Stop"]>[0] {
  return {
    stop_hook_active: false,
    effort: { level },
    transcript_path: TRANSCRIPT,
  };
}

function postToolUse(
  level: string,
  agentId?: string,
): Parameters<Engine["classic"]["PostToolUse"]>[0] {
  return {
    tool_name: "Bash",
    tool_input: { command: "ls" },
    tool_response: {},
    tool_use_id: `chips-${level}`,
    effort: { level },
    ...(agentId === undefined ? {} : { agent_id: agentId }),
  };
}

async function lastRow(world: World): Promise<Drawn> {
  const children = ((await world.band.drawn()) as Drawn).children ?? [];
  return children.at(-1) as Drawn;
}

function chipTexts(row: Drawn): string[] {
  return coloredTexts(row).map(shownText);
}

function coloredTexts(node: unknown): Drawn[] {
  const drawn = node as Drawn;
  if (drawn.props?.color !== undefined) return [drawn];
  return (drawn.children ?? []).flatMap((child) =>
    typeof child === "string" ? [] : coloredTexts(child),
  );
}

function shownText(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(shownText).join("");
  const children = (node as { children?: unknown[] } | undefined)?.children ?? [];
  return children.map(shownText).join("");
}
