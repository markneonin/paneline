import { describe, expect, mock, test } from "claude-code/testing";
import type { EngineInterface, On, PromptOrigin, ToolCallResult } from "claude-code";
import type { Engine } from "claude-code/testing";

import { addComment } from "../hooks/review-comments";

const WORK = "/work";
const WORKTREE_A = "/work/wt-a";
const WORKTREE_B = "/work/wt-b";
const SESSION_ONE = "session-one";
const SESSION_TWO = "session-two";
const NOW = 1_000_000;
const CONTEXT_WINDOW = 200_000;
const COMMENTS_FILE = "paneline-review.json";
const RESOLVE_TOOL = "mcp__paneline__resolve_review_comment";
const STATE_PREFIX = "paneline.";
const TYPED: PromptOrigin = { kind: "composer" };
const BACKGROUND: PromptOrigin = { kind: "task-notification" };
const OWNER_PROMPT = "next thing";
const MAIN_FILE = "src/a.ts";
const MAIN_LINE = 42;
const MAIN_CODE = "const total = 1";
const MAIN_TEXT = "rename total";
const OTHER_FILE = "src/b.ts";
const OTHER_LINE = 7;
const OTHER_CODE = "return null";
const OTHER_TEXT = "return an empty list";
const UNKNOWN_ID = "c9";
const SHIFTED_LINE = MAIN_LINE + 1;
const FILE_LINES = 60;

type Comment = {
  id: string;
  file: string;
  line: number;
  side: "new" | "old";
  code: string;
  text: string;
  resolved: boolean;
};
type Submitted = { text: string; context?: string[] };
type World = {
  cwd: string;
  sessionId: string;
  files: Map<string, string>;
  submitted: string[];
  calls: number;
  state: Map<string, { value: unknown; version: number }>;
  store: Map<string, unknown>;
};

describe("the review comments", () => {
  test("R1 an added comment is saved in the review file of the worktree and nothing reaches the chat", async ($, on) => {
    const world = await begin($, on);

    await addComment(hookOf(world), {
      file: MAIN_FILE,
      line: MAIN_LINE,
      side: "new",
      code: MAIN_CODE,
      text: MAIN_TEXT,
    });

    expect(JSON.parse(commentsFileOf(world, WORK) ?? "null")).toEqual([
      {
        id: "c1",
        file: MAIN_FILE,
        line: MAIN_LINE,
        side: "new",
        code: MAIN_CODE,
        text: MAIN_TEXT,
        resolved: false,
      },
    ]);
    expect(world.submitted).toEqual([]);
  });

  test("R2 a typed prompt with two open comments goes out as typed with one block listing both and naming the resolve tool", async ($, on) => {
    const world = await begin($, on);
    seedComments(world, WORK, [mainComment(), otherComment()]);

    const reply = await submit($, OWNER_PROMPT, TYPED);

    expect(reply.text).toBe(OWNER_PROMPT);
    expect(reply.context).toHaveLength(1);
    const block = blockOf(reply);
    expect(block).toContain(RESOLVE_TOOL);
    expect(block).toContain(`[c1] ${MAIN_FILE}:${MAIN_LINE}`);
    expect(block).toContain(MAIN_CODE);
    expect(block).toContain(MAIN_TEXT);
    expect(block).toContain(`[c2] ${OTHER_FILE}:${OTHER_LINE}`);
    expect(block).toContain(OTHER_CODE);
    expect(block).toContain(OTHER_TEXT);
  });

  test("R12 after a line was inserted above the commented line, the prompt names the line's current number", async ($, on) => {
    const world = await begin($, on);
    seedComments(world, WORK, [mainComment()]);
    world.files.set(`${WORK}/${MAIN_FILE}`, shiftedFile());

    const reply = await submit($, OWNER_PROMPT, TYPED);

    const block = blockOf(reply);
    expect(block).toContain(`[c1] ${MAIN_FILE}:${SHIFTED_LINE} `);
    expect(block).not.toContain(`${MAIN_FILE}:${MAIN_LINE} `);
  });

  test("R3 once the only open comment is resolved, the owner's next prompt carries no review block", async ($, on) => {
    const world = await begin($, on);
    seedComments(world, WORK, [mainComment()]);
    const before = await submit($, OWNER_PROMPT, TYPED);

    await resolve($, world, "c1");
    const after = await submit($, OWNER_PROMPT, TYPED);

    expect(blockOf(before)).toContain(`[c1] ${MAIN_FILE}:${MAIN_LINE}`);
    expect(after.context ?? []).toEqual([]);
  });

  test("R4 a background task notification carries no review block, and the next typed prompt still does", async ($, on) => {
    const world = await begin($, on);
    seedComments(world, WORK, [mainComment()]);

    const background = await submit($, "task done", BACKGROUND);
    const typed = await submit($, OWNER_PROMPT, TYPED);

    expect(blockOf(typed)).toContain(`[c1] ${MAIN_FILE}:${MAIN_LINE}`);
    expect(background.context ?? []).toEqual([]);
  });

  test("R5 a prompt the owner does not see as typed carries no review block, and the next typed prompt still does", async ($, on) => {
    const world = await begin($, on);
    seedComments(world, WORK, [mainComment()]);

    const meta = await submit($, "engine note", TYPED, { isMeta: true });
    const typed = await submit($, OWNER_PROMPT, TYPED);

    expect(blockOf(typed)).toContain(`[c1] ${MAIN_FILE}:${MAIN_LINE}`);
    expect(meta.context ?? []).toEqual([]);
  });

  test("R6 after the agent resolves one of two comments, the owner's next prompt lists only the other", async ($, on) => {
    const world = await begin($, on);
    seedComments(world, WORK, [mainComment(), otherComment()]);

    await resolve($, world, "c1");
    const reply = await submit($, OWNER_PROMPT, TYPED);

    const block = blockOf(reply);
    expect(block).toContain(`[c2] ${OTHER_FILE}:${OTHER_LINE}`);
    expect(block).not.toContain("[c1]");
  });

  test("R7 resolving an id with no open comment says so, and both open comments still reach the owner's next prompt", async ($, on) => {
    const world = await begin($, on);
    seedComments(world, WORK, [mainComment(), otherComment()]);

    const reply = await resolve($, world, UNKNOWN_ID);
    const next = await submit($, OWNER_PROMPT, TYPED);

    expect(JSON.stringify(reply)).toContain(`no open comment ${UNKNOWN_ID}`);
    expect(blockOf(next)).toContain(`[c1] ${MAIN_FILE}:${MAIN_LINE}`);
    expect(blockOf(next)).toContain(`[c2] ${OTHER_FILE}:${OTHER_LINE}`);
  });

  test("R8 resolving the same comment twice says it is resolved once, then that no open comment has that id", async ($, on) => {
    const world = await begin($, on);
    seedComments(world, WORK, [mainComment()]);

    const first = await resolve($, world, "c1");
    const second = await resolve($, world, "c1");

    expect(JSON.stringify(first)).toContain("resolved c1");
    expect(JSON.stringify(second)).toContain("no open comment c1");
  });

  test("R9 a comment made in one session is listed in the first typed prompt of a new session in the same worktree", async ($, on) => {
    const world = await begin($, on);
    seedComments(world, WORK, [mainComment()]);

    await startSession($, world, WORK, SESSION_TWO);
    const reply = await submit($, OWNER_PROMPT, TYPED);

    expect(blockOf(reply)).toContain(`[c1] ${MAIN_FILE}:${MAIN_LINE}`);
  });

  test("R10 each worktree of one repo lists only its own comments to its owner", async ($, on) => {
    const world = await begin($, on);
    await startSession($, world, WORKTREE_A, SESSION_ONE);
    seedComments(world, WORKTREE_A, [mainComment()]);
    await startSession($, world, WORKTREE_B, SESSION_TWO);
    seedComments(world, WORKTREE_B, [otherComment()]);

    const fromB = await submit($, OWNER_PROMPT, TYPED);
    await startSession($, world, WORKTREE_A, SESSION_ONE);
    const fromA = await submit($, OWNER_PROMPT, TYPED);

    expect(blockOf(fromB)).toContain(`[c2] ${OTHER_FILE}:${OTHER_LINE}`);
    expect(blockOf(fromB)).not.toContain(MAIN_FILE);
    expect(blockOf(fromA)).toContain(`[c1] ${MAIN_FILE}:${MAIN_LINE}`);
    expect(blockOf(fromA)).not.toContain(OTHER_FILE);
  });

  test("R11 a review file that is not valid JSON does not block the owner's prompt, and a new comment is listed after it", async ($, on) => {
    const world = await begin($, on);
    world.files.set(commentsPathOf(WORK), "{not json");

    const broken = await submit($, OWNER_PROMPT, TYPED);
    await addComment(hookOf(world), {
      file: MAIN_FILE,
      line: MAIN_LINE,
      side: "new",
      code: MAIN_CODE,
      text: MAIN_TEXT,
    });
    const reply = await submit($, OWNER_PROMPT, TYPED);

    expect(broken.text).toBe(OWNER_PROMPT);
    expect(blockOf(reply)).toContain(`[c1] ${MAIN_FILE}:${MAIN_LINE}`);
  });
});

function mainComment(): Comment {
  return {
    id: "c1",
    file: MAIN_FILE,
    line: MAIN_LINE,
    side: "new",
    code: MAIN_CODE,
    text: MAIN_TEXT,
    resolved: false,
  };
}

function otherComment(): Comment {
  return {
    id: "c2",
    file: OTHER_FILE,
    line: OTHER_LINE,
    side: "new",
    code: OTHER_CODE,
    text: OTHER_TEXT,
    resolved: false,
  };
}

function shiftedFile(): string {
  const lines = Array.from({ length: FILE_LINES }, (_, at) => `row ${at + 1}`);
  lines[SHIFTED_LINE - 1] = MAIN_CODE;
  return `${lines.join("\n")}\n`;
}

function blockOf(reply: Submitted): string {
  return (reply.context ?? []).join("\n");
}

function commentsPathOf(root: string): string {
  return `${root}/.git/${COMMENTS_FILE}`;
}

function commentsFileOf(world: World, root: string): string | undefined {
  return world.files.get(commentsPathOf(root));
}

function seedComments(world: World, root: string, comments: Comment[]): void {
  world.files.set(commentsPathOf(root), JSON.stringify(comments));
}

async function begin($: Engine, on: On): Promise<World> {
  const world = worldOf(on);
  await startSession($, world, WORK, SESSION_ONE);
  return world;
}

async function startSession(
  $: Engine,
  world: World,
  cwd: string,
  sessionId: string,
): Promise<void> {
  world.sessionId = sessionId;
  await $.session.start({ cwd, surface: "terminal", isInteractive: true });
}

async function submit(
  $: Engine,
  text: string,
  origin: PromptOrigin,
  extra: object = {},
): Promise<Submitted> {
  return ($.prompt.submit as (e: object) => Promise<Submitted>)({
    text,
    wait: false,
    origin,
    ...extra,
  });
}

function hookOf(world: World): EngineInterface {
  return {
    session: { root: async () => world.cwd },
    fs: {
      exists: async (path: string) => world.files.has(path),
      read: async (path: string) => {
        const text = world.files.get(path);
        if (text === undefined) throw new Error(`no such file ${path}`);
        return text;
      },
      write: async (path: string, text: string) => {
        world.files.set(path, text);
      },
    },
    process: {
      run: async (argv: readonly string[]) => gitAnswer(world, { argv }),
    },
  } as unknown as EngineInterface;
}

async function resolve($: Engine, world: World, id: string): Promise<ToolCallResult> {
  return ($.tool.call as (e: object) => Promise<ToolCallResult>)({
    tool: RESOLVE_TOOL,
    tool_use_id: `call-${++world.calls}`,
    id,
  });
}

function worldOf(on: On): World {
  const world: World = {
    cwd: WORK,
    sessionId: SESSION_ONE,
    files: new Map(),
    submitted: [],
    calls: 0,
    state: new Map(),
    store: new Map(),
  };
  mock.clock(on, { now: NOW });
  mock.env(on, { HOME: "/h/u" });
  on("config.list", () => ({ value: [{ key: "theme", value: "dark" }] }) as never);
  on("command.register", () => ({ value: {} }) as never);
  on("session.id", () => ({ value: world.sessionId }));
  on("session.start", (_$, e) => {
    world.cwd = e.cwd;
    return { cwd: e.cwd };
  });
  on("session.cwd", () => ({ value: world.cwd }));
  on("session.root", () => ({ value: world.cwd }));
  on("store.get", (_$, e) => ({ value: world.store.get(e.key) }));
  on("store.set", (_$, e) => {
    world.store.set(e.key, JSON.parse(JSON.stringify(e.value)));
    return { value: undefined };
  });
  on("state.get", (_$, e) => {
    const entry = world.state.get(`${STATE_PREFIX}${e.key}.${e.id ?? ""}`);
    return { value: { value: entry?.value, version: entry?.version ?? 0 } };
  });
  on("state.set", (_$, e) => {
    const key = `${STATE_PREFIX}${e.key}.${e.id ?? ""}`;
    const held = world.state.get(key)?.version ?? 0;
    if (e.ifVersion !== undefined && e.ifVersion !== held)
      return { value: { isSet: false, version: held } };
    const version = held + 1;
    world.state.set(key, { value: JSON.parse(JSON.stringify(e.value)), version });
    return { value: { isSet: true, version } };
  });
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: CONTEXT_WINDOW }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", (_$, e) => ({ value: world.files.has(e.path) }));
  on("fs.read", (_$, e) => {
    const text = world.files.get(e.path);
    if (text === undefined) throw new Error(`no such file ${e.path}`);
    return { value: text };
  });
  on("fs.write", (_$, e) => {
    world.files.set(e.path, e.text);
    return { value: undefined };
  });
  on("process.run", (_$, e) => ({ value: gitAnswer(world, e) }) as never);
  on("tool.register", (_$, e) => ({ value: { tool: `mcp__paneline__${e.name}` } }));
  on("tool.check", () => ({ decision: "allow" }));
  on("tool.call", () => ({ result: "ok", text: "ok" }));
  on("prompt.submit", (_$, e) => {
    world.submitted.push(e.text);
    return { text: e.text, context: e.context };
  });
  return world;
}

function gitAnswer(
  world: World,
  e: { argv: readonly string[]; init?: { cwd?: string } },
): { exitCode: number; stdout: string; stderr: string } {
  const dir = e.init?.cwd ?? world.cwd;
  if (e.argv.includes("--absolute-git-dir"))
    return { exitCode: 0, stdout: `${dir}/.git`, stderr: "" };
  if (e.argv.includes("--show-toplevel"))
    return {
      exitCode: 0,
      stdout: e.argv.includes("--abbrev-ref") ? `${dir}\nsha\nmain\n` : `${dir}\n`,
      stderr: "",
    };
  return { exitCode: 0, stdout: "", stderr: "" };
}
