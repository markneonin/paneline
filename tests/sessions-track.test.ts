import { describe, expect, mock, test } from "claude-code/testing";
import type { On, SessionContextBreakdown } from "claude-code";
import type { Engine } from "claude-code/testing";

type Write = { key: string; value: unknown };
type Row = {
  pid: number;
  sessionId: string;
  state: string;
  cwd: string;
  branch: string;
  ctx: number | null;
  usd: number | null;
  since?: number;
};
type Registry = { pid: number; sessionId: string; cwd: string; kind: string; status: string };
type World = {
  writes: Write[];
  files: Map<string, string>;
  removed: string[];
  alive: Map<number, string>;
  branch: { name: string };
  cwd: { path: string };
  usageContext: number | null;
  seededTokens: number | null;
  usageVersion: number;
  settle: () => Promise<void>;
  staleSessionsRead: unknown;
  lastSessionsRead: unknown;
};

const HOME_DIR = "/Users/dev";
const SESSIONS_DIR = `${HOME_DIR}/.claude/paneline/sessions`;
const REGISTRY_DIR = `${HOME_DIR}/.claude/sessions`;
const WORK_DIR = "/Users/dev/IT";
const MOVED_DIR = "/Users/dev/IT/moved";
const TURN_MS = 5000;
const OWN_PID = 4100;
const OTHER_PID = 5200;
const THIRD_PID = 6300;
const OWN_SESSION = "session-own";
const NEW_SESSION = "session-new";
const OTHER_SESSION = "session-other";
const THIRD_SESSION = "session-third";
const MAIN_BRANCH = "main";
const FEATURE_BRANCH = "feature/x";
const CLAUDE_COMMAND = "/Users/dev/.local/bin/claude";
const TOKENS = 1_000;
const WINDOW = 200_000;
const CONTEXT_PERCENT = 42;
const COST_USD = 1.25;
const STATUS_ROW_PERCENT = 17;
const SEEDED_TOKENS = 25_600;
const COMPACT_THRESHOLD = 160_000;
const SEEDED_PERCENT = 16;
const PERMISSION_PROMPT = { notification_type: "permission_prompt", message: "ok" };
const TURN_ID = "turn-1";
const SUBAGENT_ID = "agent-1";
const NO_ROWS = 0;
const INNER_WATCH_PATH = "/Users/dev/other";

describe("sessions tracker", () => {
  test("S1 the start writes the own file with pid, folder, branch and idle, and asks to watch the folder", async ($, on) => {
    const world = worldOf(on);

    const started = await startSession($);

    expect(rowFile(world, OWN_PID)).toEqual(ownRow({ state: "idle" }));
    expect(started.watchPaths).toEqual([SESSIONS_DIR, REGISTRY_DIR]);
    expect(lastSessions(world)[OWN_PID]).toEqual(ownRow({ state: "idle" }));
  });

  test("S3g the start alone lists no other session", async ($, on) => {
    const world = worldOf(on);
    putRegistry(world, registryOf({ pid: OTHER_PID }), CLAUDE_COMMAND);

    await startSession($);

    expect(Object.keys(lastSessions(world))).toEqual([String(OWN_PID)]);
  });

  test("S3c a background spare session that starts writes no row and no file", async ($, on) => {
    const world = worldOf(on);
    putRegistry(world, registryOf({ pid: OWN_PID, kind: "bg" }), CLAUDE_COMMAND);

    await startSession($);

    expect(sessionWrites(world)).toEqual([]);
    expect(world.files.has(fileOf(OWN_PID))).toBe(false);
  });

  test("S4 a turn start writes running", async ($, on) => {
    const world = worldOf(on);
    await startSession($);

    await $.turn.start({ text: "go", turnId: TURN_ID });

    expect(rowFile(world, OWN_PID).state).toBe("running");
    expect(lastSessions(world)[OWN_PID]?.state).toBe("running");
  });

  test("S5 a permission prompt writes waiting", async ($, on) => {
    const world = worldOf(on);
    await startSession($);
    await $.turn.start({ text: "go", turnId: TURN_ID });

    await $.classic.Notification(PERMISSION_PROMPT);

    expect(rowFile(world, OWN_PID).state).toBe("waiting");
  });

  test("S6 a tool use after a permission prompt writes running again", async ($, on) => {
    const world = worldOf(on);
    await startSession($);
    await $.classic.Notification(PERMISSION_PROMPT);

    await $.classic.PostToolUse({ tool_name: "Bash" } as never);

    expect(rowFile(world, OWN_PID).state).toBe("running");
  });

  test("S6b a tool use after a permission prompt writes running although the next read of the sessions is from before the prompt", async ($, on) => {
    const world = worldOf(on);
    await startSession($);
    await $.turn.start({ text: "go", turnId: TURN_ID });
    await $.classic.Notification(PERMISSION_PROMPT);
    world.staleSessionsRead = world.lastSessionsRead;

    await $.classic.PostToolUse({ tool_name: "Bash" } as never);

    expect(rowFile(world, OWN_PID).state).toBe("running");
  });

  test("S6c a user prompt after a permission prompt writes running again", async ($, on) => {
    const world = worldOf(on);
    await startSession($);
    await $.classic.Notification(PERMISSION_PROMPT);

    await $.classic.UserPromptSubmit({ prompt: "go" });

    expect(rowFile(world, OWN_PID).state).toBe("running");
  });

  test("S7 a finished turn writes idle with the folder and branch it ended in", async ($, on) => {
    const world = worldOf(on);
    await startSession($);
    await $.turn.start({ text: "go", turnId: TURN_ID });
    world.branch.name = FEATURE_BRANCH;
    world.cwd.path = MOVED_DIR;
    await world.advance(TURN_MS);

    await finishTurn($);

    expect(rowFile(world, OWN_PID)).toEqual(
      ownRow({ state: "idle", branch: FEATURE_BRANCH, cwd: MOVED_DIR, since: TURN_MS }),
    );
  });

  test("S8 the same state again writes no file and no state", async ($, on) => {
    const world = worldOf(on);
    await startSession($);
    await $.turn.start({ text: "go", turnId: TURN_ID });
    const filesBefore = new Map(world.files);
    const writesBefore = sessionWrites(world).length;

    await $.classic.PostToolUse({ tool_name: "Bash" } as never);
    await $.turn.start({ text: "again", turnId: "turn-2" });

    expect(world.files).toEqual(filesBefore);
    expect(sessionWrites(world)).toHaveLength(writesBefore);
  });

  test("S9 a subagent turn start does not change the state", async ($, on) => {
    const world = worldOf(on);
    await startSession($);

    await $.turn.start({ text: "sub", turnId: "turn-sub", agentId: SUBAGENT_ID });

    expect(rowFile(world, OWN_PID).state).toBe("idle");
  });

  test("S10 a subagent turn end does not write idle while the main turn runs", async ($, on) => {
    const world = worldOf(on);
    await startSession($);
    await $.turn.start({ text: "go", turnId: TURN_ID });

    await finishTurn($, { agentId: SUBAGENT_ID, turnId: "turn-sub" });

    expect(rowFile(world, OWN_PID).state).toBe("running");
  });

  test("S11 a measure with context and cost writes the percent and the dollars", async ($, on) => {
    const world = worldOf(on);
    await startSession($);
    setContext(world, CONTEXT_PERCENT);

    await $.session.measure({
      context: { window: WINDOW, tokens: TOKENS, percent: CONTEXT_PERCENT },
      rateLimits: [],
      cost: { usd: COST_USD },
      changed: ["context", "cost"],
    } as never);

    expect(rowFile(world, OWN_PID)).toMatchObject({ ctx: CONTEXT_PERCENT, usd: COST_USD });
  });

  test("S23 a cost-only measure writes the same context the status row reads from the usage store", async ($, on) => {
    const world = worldOf(on);
    await startSession($);
    setContext(world, STATUS_ROW_PERCENT);

    await $.session.measure({
      context: { window: WINDOW },
      rateLimits: [],
      cost: { usd: COST_USD },
      changed: ["cost"],
    } as never);

    expect(rowFile(world, OWN_PID)).toMatchObject({ ctx: STATUS_ROW_PERCENT, usd: COST_USD });
  });

  test("S24 the first prompt writes the context the status row already shows", async ($, on) => {
    const world = worldOf(on);
    await startSession($);
    setContext(world, STATUS_ROW_PERCENT);

    await $.turn.start({ text: "go", turnId: TURN_ID });

    expect(rowFile(world, OWN_PID)).toMatchObject({ state: "running", ctx: STATUS_ROW_PERCENT });
  });

  test("S25 the turn end writes the context the status row shows now", async ($, on) => {
    const world = worldOf(on);
    await startSession($);
    await $.turn.start({ text: "go", turnId: TURN_ID });
    setContext(world, STATUS_ROW_PERCENT);

    await finishTurn($);

    expect(rowFile(world, OWN_PID)).toMatchObject({ state: "idle", ctx: STATUS_ROW_PERCENT });
  });

  test("S26 a start with the usage store already filled writes that context at once", async ($, on) => {
    const world = worldOf(on);
    setContext(world, STATUS_ROW_PERCENT);

    await startSession($);

    expect(rowFile(world, OWN_PID).ctx).toBe(STATUS_ROW_PERCENT);
  });

  test("S27 a fresh session whose context share is seeded after its row was written shows that share in the shared row, with no prompt and no measure", async ($, on) => {
    const world = worldOf(on);
    await startSession($);
    world.seededTokens = SEEDED_TOKENS;

    await $.session.start({ cwd: WORK_DIR, surface: "terminal", isInteractive: true } as never);
    await world.settle();

    expect(rowFile(world, OWN_PID)).toMatchObject({ state: "idle", ctx: SEEDED_PERCENT });
  });

  test("S28 after /clear, a new session whose context share is seeded after its row was written shows that share in the shared row, with no prompt and no measure", async ($, on) => {
    const world = worldOf(on);
    await startSession($);
    await $.session.end({ reason: "clear" } as never);
    world.session.id = NEW_SESSION;
    world.seededTokens = SEEDED_TOKENS;

    await $.classic.SessionStart({ source: "clear" } as never);
    await world.settle();

    expect(rowFile(world, OWN_PID)).toMatchObject({
      sessionId: NEW_SESSION,
      ctx: SEEDED_PERCENT,
    });
  });

  test("S12 a changed or added file of another session updates its row", async ($, on) => {
    const world = worldOf(on);
    await startSession($);
    world.files.set(fileOf(OTHER_PID), JSON.stringify(otherRow()));
    await fileChanged($, OTHER_PID, "add");
    world.files.set(fileOf(OTHER_PID), JSON.stringify(otherRow({ state: "waiting" })));

    await fileChanged($, OTHER_PID, "change");

    expect(lastSessions(world)[OTHER_PID]).toEqual(otherRow({ state: "waiting" }));
  });

  test("S13 a removed file of another session removes its row", async ($, on) => {
    const world = worldOf(on);
    putSession(world, otherRow(), CLAUDE_COMMAND);
    await startSession($);

    await fileChanged($, OTHER_PID, "unlink");

    expect(Object.keys(lastSessions(world))).toEqual([String(OWN_PID)]);
  });

  test("S14 a file that cannot be read keeps the old row", async ($, on) => {
    const world = worldOf(on);
    putSession(world, otherRow());
    await startSession($);
    await fileChanged($, OTHER_PID, "add");
    world.files.set(fileOf(OTHER_PID), "{broken");

    await fileChanged($, OTHER_PID, "change");

    expect(lastSessions(world)[OTHER_PID]).toEqual(otherRow());
  });

  test("S15 two files changing back to back both end up in the rows", async ($, on) => {
    const world = worldOf(on);
    await startSession($);
    world.files.set(fileOf(OTHER_PID), JSON.stringify(otherRow()));
    world.files.set(
      fileOf(THIRD_PID),
      JSON.stringify(otherRow({ pid: THIRD_PID, sessionId: THIRD_SESSION })),
    );

    await Promise.all([fileChanged($, OTHER_PID, "add"), fileChanged($, THIRD_PID, "add")]);

    expect(Object.keys(lastSessions(world)).sort()).toEqual(
      [OWN_PID, OTHER_PID, THIRD_PID].map(String).sort(),
    );
  });

  test("S16 the echo of the own file does not bring back an older state", async ($, on) => {
    const world = worldOf(on);
    await startSession($);
    const idleFile = world.files.get(fileOf(OWN_PID)) ?? "";
    await $.turn.start({ text: "go", turnId: TURN_ID });
    world.files.set(fileOf(OWN_PID), idleFile);

    await fileChanged($, OWN_PID, "change");

    expect(lastSessions(world)[OWN_PID]?.state).toBe("running");
  });

  test("S17 the session end removes the own file", async ($, on) => {
    const world = worldOf(on);
    await startSession($);

    await $.session.end({ reason: "other" } as never);

    expect(world.removed).toEqual([fileOf(OWN_PID)]);
  });

  test("S18 after clear the own file carries the new session id", async ($, on) => {
    const world = worldOf(on);
    await startSession($);
    await $.session.end({ reason: "clear" } as never);
    world.session.id = NEW_SESSION;

    await $.classic.SessionStart({ source: "clear" } as never);

    expect(rowFile(world, OWN_PID)).toEqual(ownRow({ state: "idle", sessionId: NEW_SESSION }));
  });

  test("S19 with no other session the rows hold only the own row", async ($, on) => {
    const world = worldOf(on);

    await startSession($);

    expect(Object.keys(lastSessions(world))).toHaveLength(NO_ROWS + 1);
  });

  test("S20 a compact start in the middle of a turn keeps the running state and the context", async ($, on) => {
    const world = worldOf(on);
    await startSession($);
    await $.turn.start({ text: "go", turnId: TURN_ID });
    setContext(world, CONTEXT_PERCENT);
    await $.session.measure({
      context: { window: WINDOW, tokens: TOKENS, percent: CONTEXT_PERCENT },
      rateLimits: [],
      changed: ["context"],
    } as never);
    world.branch.name = FEATURE_BRANCH;
    await world.advance(TURN_MS);

    await $.classic.SessionStart({ source: "compact" } as never);

    expect(rowFile(world, OWN_PID)).toEqual(
      ownRow({ state: "running", ctx: CONTEXT_PERCENT, branch: FEATURE_BRANCH, since: 0 }),
    );
  });

  test("S21 the start adds the folder to the paths another hook asked to watch", async ($, on) => {
    worldOf(on, [INNER_WATCH_PATH]);

    const started = await startSession($);

    expect(started.watchPaths).toEqual([INNER_WATCH_PATH, SESSIONS_DIR, REGISTRY_DIR]);
  });

  test("S22 a failed tool after a permission prompt writes running again", async ($, on) => {
    const world = worldOf(on);
    await startSession($);
    await $.classic.Notification(PERMISSION_PROMPT);

    await $.classic.PostToolUseFailure({ tool_name: "Bash" } as never);

    expect(rowFile(world, OWN_PID).state).toBe("running");
  });
});

function ownRow(patch: Partial<Row> = {}): Row {
  return {
    pid: OWN_PID,
    sessionId: OWN_SESSION,
    state: "idle",
    cwd: WORK_DIR,
    branch: MAIN_BRANCH,
    ctx: null,
    usd: null,
    ...patch,
  };
}

function otherRow(patch: Partial<Row> = {}): Row {
  return {
    pid: OTHER_PID,
    sessionId: OTHER_SESSION,
    state: "running",
    cwd: WORK_DIR,
    branch: FEATURE_BRANCH,
    ctx: CONTEXT_PERCENT,
    usd: COST_USD,
    ...patch,
  };
}

function setContext(world: World, context: number): void {
  world.usageContext = context;
}

function breakdownOf(tokens: number): SessionContextBreakdown {
  return {
    totalTokens: tokens,
    autoCompactThreshold: COMPACT_THRESHOLD,
  } as unknown as SessionContextBreakdown;
}

function registryPathOf(pid: number): string {
  return `${REGISTRY_DIR}/${pid}.json`;
}

function registryOf(patch: Partial<Registry> = {}): Registry {
  return {
    pid: OTHER_PID,
    sessionId: OTHER_SESSION,
    cwd: WORK_DIR,
    kind: "interactive",
    status: "idle",
    ...patch,
  };
}

function putRegistry(world: World, entry: Registry, command?: string): void {
  world.files.set(registryPathOf(entry.pid), JSON.stringify(entry));
  if (command !== undefined) world.alive.set(entry.pid, command);
}

function fileOf(pid: number): string {
  return `${SESSIONS_DIR}/${pid}.json`;
}

function putSession(world: World, row: Row, command?: string): void {
  world.files.set(fileOf(row.pid), JSON.stringify(row));
  if (command !== undefined) world.alive.set(row.pid, command);
}

function rowFile(world: World, pid: number): Row {
  return JSON.parse(world.files.get(fileOf(pid)) ?? "null") as Row;
}

function sessionWrites(world: World): Write[] {
  return world.writes.filter((write) => write.key === "sessions");
}

function lastSessions(world: World): Record<string, Row> {
  const written = sessionWrites(world).at(-1);
  return written?.value as Record<string, Row>;
}

function startSession($: Engine): Promise<{ watchPaths?: string[] }> {
  return $.classic.SessionStart({ source: "startup" } as never);
}

async function finishTurn($: Engine, extra: Record<string, unknown> = {}): Promise<void> {
  await $.turn.complete({
    answer: "",
    durationMs: 1,
    isAborted: false,
    turnId: TURN_ID,
    reason: "answer",
    ...extra,
  } as never);
}

async function fileChanged(
  $: Engine,
  pid: number,
  event: "add" | "change" | "unlink",
): Promise<void> {
  await $.classic.FileChanged({ file_path: fileOf(pid), event });
}

type Mutable = World & { session: { id: string }; advance: (ms: number) => Promise<void> };

function worldOf(on: On, watchPaths: string[] = []): Mutable {
  const clock = mock.clock(on);
  mock.env(on, { HOME: HOME_DIR });
  const world: Mutable = {
    writes: [],
    files: new Map(),
    removed: [],
    alive: new Map(),
    branch: { name: MAIN_BRANCH },
    cwd: { path: WORK_DIR },
    usageContext: null,
    seededTokens: null,
    usageVersion: 1,
    settle: () => clock.advance(10),
    advance: (ms) => clock.advance(ms),
    staleSessionsRead: undefined,
    lastSessionsRead: undefined,
    session: { id: OWN_SESSION },
  };
  on("state.get", async (_$, e, next) => {
    if (e.key === "usage") {
      return {
        value: { value: { context: world.usageContext, limits: [] }, version: world.usageVersion },
      };
    }
    if (e.key !== "sessions") return next(e);
    const stale = world.staleSessionsRead;
    world.staleSessionsRead = undefined;
    if (stale !== undefined) return stale as never;
    const fresh = await next(e);
    world.lastSessionsRead = fresh;
    return fresh;
  });
  on("state.set", (_$, e, next) => {
    world.writes.push({ key: e.key, value: e.value });
    if (e.key !== "usage") return next(e);
    world.usageContext = (e.value as { context: number | null }).context;
    world.usageVersion += 1;
    return { value: { isSet: true, version: world.usageVersion } };
  });
  on("session.id", () => ({ value: world.session.id }));
  on("session.repo", () => ({ value: null }));
  on("session.root", () => ({ value: world.cwd.path }));
  on("session.cwd", () => ({ value: world.cwd.path }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("session.model", () => ({ value: "claude-opus-5-5" }));
  on("settings.read", () => ({ value: {} }));
  on("config.list", () => ({ value: [{ key: "theme", value: "dark" }] }) as never);
  on("command.register", () => ({ value: {} }) as never);
  on("session.usage", () => ({
    value: {
      startedAt: 0,
      context: {
        window: WINDOW,
        ...(world.seededTokens === null ? {} : { breakdown: breakdownOf(world.seededTokens) }),
      },
      rateLimits: [],
    },
  }));
  on("classic.SessionStart", () => (watchPaths.length > 0 ? { watchPaths } : {}));
  on("classic.Notification", () => ({}));
  on("classic.PostToolUse", () => ({}));
  on("classic.UserPromptSubmit", () => ({}));
  on("classic.PostToolUseFailure", () => ({}));
  on("classic.FileChanged", () => ({}));
  on("turn.start", (_$, e) => ({ turnId: e.turnId }));
  on("turn.complete", (_$, e) => ({ text: e.answer }));
  on("session.end", () => ({ sessionId: world.session.id }));
  on("agent.list", () => ({ value: [] }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("store.get", () => ({ value: undefined }));
  on("store.set", () => ({ value: undefined }));
  on("store.keys", () => ({ value: [] }));
  on("store.delete", () => ({ value: undefined }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("fs.write", (_$, e) => {
    world.files.set(e.path, e.text);
    return { value: undefined };
  });
  on("fs.read", (_$, e) => {
    const text = world.files.get(e.path);
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`);
    return { value: text };
  });
  on("fs.list", (_$, e) => ({
    value: [...world.files.keys()]
      .filter((path) => path.startsWith(`${e.path}/`))
      .map((path) => ({
        name: path.slice(path.lastIndexOf("/") + 1),
        kind: "file",
        size: 0,
        mtimeMs: 0,
        isLink: false,
      })),
  }));
  on("process.run", (_$, e) => ({ value: runProcess(world, e.argv) }) as never);
  return world;
}

function runProcess(
  world: World,
  argv: readonly string[],
): { exitCode: number; stdout: string; stderr: string } {
  const [command = "", ...args] = argv;
  if (command === "sh") return reply(`${OWN_PID}\n`);
  if (command === "git") return reply(`${world.branch.name}\n`);
  if (command === "rm") {
    const paths = args.filter((arg) => arg !== "-f");
    paths.forEach((path) => world.files.delete(path));
    world.removed.push(...paths);
    return reply("");
  }
  if (command === "ps") {
    const asked = (args[1] ?? "").split(",").map(Number);
    return reply(
      asked
        .filter((pid) => world.alive.has(pid))
        .map((pid) => `${pid} ${world.alive.get(pid) ?? ""}\n`)
        .join(""),
    );
  }
  return reply("");
}

function reply(stdout: string): { exitCode: number; stdout: string; stderr: string } {
  return { exitCode: 0, stdout, stderr: "" };
}
