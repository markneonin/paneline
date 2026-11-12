import { describe, expect, test } from "claude-code/testing";
import type { On, SessionContextBreakdown, SessionMessage } from "claude-code";
import type { Engine } from "claude-code/testing";

import { formatTokens } from "../hooks/format";
import {
  MS_PER_MINUTE,
  OPUS,
  SUBSCRIPTION,
  callTool,
  clockText,
  compact,
  lines,
  mainTurn,
  openPane,
  settle,
  showTabThroughArrows,
  startFreshSession,
  worldOf,
} from "./spend-world";
import type { ToolReply, ToolSpec, World } from "./spend-world";

const WINDOW = 200_000;
const PANE_COLUMNS = 60;
const PANE_ROWS = 40;
const BEFORE = 182_000;
const AFTER = 41_000;
const FILE_CHARS = 40_000;
const FILE_TOKENS = 10_000;
const REPEAT_CHARS = 8_000;
const REPEAT_TOKENS = 2_000;
const READS = 3;
const REDRAWS = 5;
const TOOL_CALLS = 20;
const COMPACT_CAP = 3;
const WASTED_CAP = 5;
const SUBAGENT = "agent-sub";
const CONTEXT_TAB = "Context";
const FILES_TAB = "Files";
const COMPACTIONS_TITLE = "Compactions";
const WASTED_TITLE = "Wasted reads";
const CONTEXT_LOG_STATE = "paneline.contextLog.";
const RESTART_MS = 1_000;
const SUMMARY: SessionMessage = { role: "user", text: "summary", toolUses: [] };
const TOOL_SEARCH = "ToolSearch";
const CREATE_SEARCH = "select:TaskCreate";
const UPDATE_SEARCH = "select:TaskUpdate";
const NO_MATCH_REPLY = "No matching deferred tools found.";

describe("context tab compaction log and wasted reads", () => {
  test("C1 on Context tab entry a file read three times earlier in the session shows under Wasted reads as ×3 with its tokens", async ($, on) => {
    const session = await sessionWith(on, $);
    earlierReads(session, "/work/src/big.ts", FILE_CHARS, READS);

    const rows = await blockRows(await contextPane($), WASTED_TITLE);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("big.ts");
    expect(rows[0]).toContain("×3");
    expect(rows[0]).toContain(formatTokens(READS * FILE_TOKENS));
  });

  test("C2 on Context tab entry two identical Bash results earlier in the session show as one repeated-result row", async ($, on) => {
    const session = await sessionWith(on, $);
    earlierRepeats(session, "Bash", ["git status", "git status"], "y");

    const rows = await blockRows(await contextPane($), WASTED_TITLE);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("Bash");
    expect(rows[0]).toContain("×2");
    expect(rows[0]).toContain(formatTokens(2 * REPEAT_TOKENS));
  });

  test("C3 twenty tool calls in one session write no copy of their results to the pane's saved state", async ($, on) => {
    const session = await sessionWith(on, $);
    const before = contextLogWrites(session.world);
    for (let call = 0; call < TOOL_CALLS; call++) {
      await readFile($, session, `/work/src/file-${call}.ts`, REPEAT_CHARS);
    }

    expect(contextLogWrites(session.world) - before).toBe(0);
  });

  test("C4 five redraws while the Context tab stays open read the session once", async ($, on) => {
    const session = await sessionWith(on, $);
    const pane = await contextPane($);
    for (let redraw = 0; redraw < REDRAWS; redraw++) await pane.redraw();

    expect(session.reads.count).toBe(1);
  });

  test("C5 leaving the Context tab and coming back reads the session once more", async ($, on) => {
    const session = await sessionWith(on, $);
    const pane = await contextPane($);
    await showTabThroughArrows(pane, FILES_TAB);
    await showTabThroughArrows(pane, CONTEXT_TAB);

    expect(session.reads.count).toBe(2);
  });

  test("C6 after a compaction from the Context tab the tab keeps its compaction row and the next draw reads the session again", async ($, on) => {
    const session = await sessionWith(on, $);
    const pane = await contextPane($);
    await compactFromTab($, session);
    await settle(pane);

    const rows = await blockRows(pane, COMPACTIONS_TITLE);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("182k → 49k");
    expect(session.reads.count).toBe(2);
  });

  test("C7 while the Context tab stays open, reads made in that time do not reach Wasted reads until the owner comes back", async ($, on) => {
    const session = await sessionWith(on, $);
    for (let read = 0; read < READS; read++) {
      await readFile($, session, "/work/src/big.ts", FILE_CHARS);
    }
    const pane = await contextPane($);
    for (let read = 0; read < READS; read++) {
      await readFile($, session, "/work/src/other.ts", FILE_CHARS);
    }
    await settle(pane);

    const rows = await blockRows(pane, WASTED_TITLE);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("big.ts");
  });

  test("W1 a manual compaction from 182k to 41k shows one row with its clock time and `182k → 49k`", async ($, on) => {
    const session = await sessionWith(on, $);
    const at = session.world.clock.now();
    await compactWith($, session, BEFORE, AFTER);

    const rows = await blockRows(await contextPane($), COMPACTIONS_TITLE);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(clockText(at));
    expect(rows[0]).toContain("182k → 49k");
  });

  test("W2 two compactions five minutes apart show two rows, the later one first", async ($, on) => {
    const session = await sessionWith(on, $);
    await compactWith($, session, 150_000, 30_000);
    await session.world.clock.advance(5 * MS_PER_MINUTE);
    await compactWith($, session, BEFORE, AFTER);

    const rows = await blockRows(await contextPane($), COMPACTIONS_TITLE);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("182k → 49k");
    expect(rows[1]).toContain("150k → 38k");
  });

  test("W3 an automatic compaction is listed like a manual one", async ($, on) => {
    const session = await sessionWith(on, $);
    await compactWith($, session, BEFORE, AFTER, { trigger: "auto" });

    const rows = await blockRows(await contextPane($), COMPACTIONS_TITLE);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("182k → 49k");
  });

  test("W4 a compaction with no reported sizes shows `?` instead of a number", async ($, on) => {
    const session = await sessionWith(on, $);
    await compactWith($, session, BEFORE, undefined);
    await compactWith($, session, undefined, undefined);

    const rows = await blockRows(await contextPane($), COMPACTIONS_TITLE);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("? → ?");
    expect(rows[1]).toContain("182k → ?");
  });

  test("W5 a background precompute adds no row next to a real compaction", async ($, on) => {
    const session = await sessionWith(on, $);
    await compactWith($, session, 120_000, 20_000, { trigger: "precompute" });
    await compactWith($, session, BEFORE, AFTER);

    const rows = await blockRows(await contextPane($), COMPACTIONS_TITLE);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("182k → 49k");
  });

  test("W6 a refused compaction adds no row next to a real compaction", async ($, on) => {
    const session = await sessionWith(on, $);
    session.world.compaction = { skip: "off" };
    await compact($, session.world);
    await compactWith($, session, BEFORE, AFTER);

    const rows = await blockRows(await contextPane($), COMPACTIONS_TITLE);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("182k → 49k");
  });

  test("W7 a subagent's compaction adds no row next to a real compaction", async ($, on) => {
    const session = await sessionWith(on, $);
    await compactWith($, session, 120_000, 20_000, { agentId: SUBAGENT });
    await compactWith($, session, BEFORE, AFTER);

    const rows = await blockRows(await contextPane($), COMPACTIONS_TITLE);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("182k → 49k");
  });

  test("W8 a file read three times shows its path, `×3` and the three results' tokens added", async ($, on) => {
    const session = await sessionWith(on, $);
    for (let read = 0; read < READS; read++) {
      await readFile($, session, "/work/src/big.ts", FILE_CHARS);
    }

    const rows = await blockRows(await contextPane($), WASTED_TITLE);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("big.ts");
    expect(rows[0]).toContain("×3");
    expect(rows[0]).toContain(formatTokens(READS * FILE_TOKENS));
  });

  test("W9 a file read only twice is not listed next to one read three times", async ($, on) => {
    const session = await sessionWith(on, $);
    await readFile($, session, "/work/src/twice.ts", FILE_CHARS);
    await readFile($, session, "/work/src/twice.ts", FILE_CHARS);
    for (let read = 0; read < READS; read++) {
      await readFile($, session, "/work/src/big.ts", FILE_CHARS);
    }

    const rows = await blockRows(await contextPane($), WASTED_TITLE);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("big.ts");
  });

  test("W10 reads by a subagent add nothing next to the main agent's reads", async ($, on) => {
    const session = await sessionWith(on, $);
    for (let read = 0; read < READS; read++) {
      await readFile($, session, "/work/src/agent.ts", FILE_CHARS, SUBAGENT);
    }
    await readFile($, session, "/work/src/big.ts", FILE_CHARS);
    await readFile($, session, "/work/src/big.ts", FILE_CHARS);
    await readFile($, session, "/work/src/big.ts", FILE_CHARS, SUBAGENT);
    for (let read = 0; read < READS; read++) {
      await readFile($, session, "/work/src/main.ts", FILE_CHARS);
    }

    const rows = await blockRows(await contextPane($), WASTED_TITLE);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("main.ts");
  });

  test("W11 the same output returned twice by one non-Read tool shows its tool, `×2` and the tokens added", async ($, on) => {
    const session = await sessionWith(on, $);
    await repeatedOutput($, session, "Bash", ["git status", "git status"], "y");

    const rows = await blockRows(await contextPane($), WASTED_TITLE);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("Bash");
    expect(rows[0]).toContain("×2");
    expect(rows[0]).toContain(formatTokens(2 * REPEAT_TOKENS));
  });

  test("W12 the same tool with different outputs is not listed", async ($, on) => {
    const session = await sessionWith(on, $);
    await repeatedOutput($, session, "Bash", ["ls"], "a");
    await repeatedOutput($, session, "Bash", ["pwd"], "b");
    await repeatedOutput($, session, "Bash", ["git log", "git log"], "c");

    const rows = await blockRows(await contextPane($), WASTED_TITLE);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("×2");
    expect(rows[0]).toContain(formatTokens(2 * REPEAT_TOKENS));
  });

  test("W13 the same output from two different tools is not listed", async ($, on) => {
    const session = await sessionWith(on, $);
    await repeatedOutput($, session, "Bash", ["ls"], "z");
    await repeatedOutput($, session, "Grep", ["ls"], "z");
    await repeatedOutput($, session, "Bash", ["git log", "git log"], "c");

    const rows = await blockRows(await contextPane($), WASTED_TITLE);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("Bash");
  });

  test("W14 reads before a compaction do not count after it: two before and one after show no Wasted reads row", async ($, on) => {
    const session = await sessionWith(on, $);
    await readFile($, session, "/work/src/big.ts", FILE_CHARS);
    await readFile($, session, "/work/src/big.ts", FILE_CHARS);
    await compactWith($, session, BEFORE, AFTER);
    await readFile($, session, "/work/src/big.ts", FILE_CHARS);

    const titles = await titlesDrawn(await contextPane($));

    expect(isDrawn(titles, WASTED_TITLE)).toBe(false);
  });

  test("W15 rows are sorted by tokens, a big duplicate result above a smaller file", async ($, on) => {
    const session = await sessionWith(on, $);
    for (let read = 0; read < READS; read++) {
      await readFile($, session, "/work/src/mid.ts", 4_000);
    }
    await repeatedOutput($, session, "Bash", ["cat log", "cat log"], "q", 4 * REPEAT_CHARS);
    for (let read = 0; read < READS; read++) {
      await readFile($, session, "/work/src/big.ts", FILE_CHARS);
    }

    const rows = await blockRows(await contextPane($), WASTED_TITLE);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("big.ts");
    expect(rows[1]).toContain("Bash");
    expect(rows[2]).toContain("mid.ts");
  });

  test("W16 four compactions show the newest three and `+1 more`", async ($, on) => {
    const session = await sessionWith(on, $);
    for (const before of [101_000, 102_000, 103_000, 104_000]) {
      await compactWith($, session, before, AFTER);
      await session.world.clock.advance(MS_PER_MINUTE);
    }

    const rows = await blockRows(await contextPane($), COMPACTIONS_TITLE);

    expect(rows).toHaveLength(COMPACT_CAP + 1);
    expect(rows.slice(0, COMPACT_CAP).map((row) => /\d+k/.exec(row)?.[0])).toEqual([
      "104k",
      "103k",
      "102k",
    ]);
    expect(rows[COMPACT_CAP]).toContain("+1 more");
    expect(rows.join("\n")).not.toContain("101k");
  });

  test("W17 six wasted files show the five biggest and `+1 more`", async ($, on) => {
    const session = await sessionWith(on, $);
    for (let file = 1; file <= 6; file++) {
      for (let read = 0; read < READS; read++) {
        await readFile($, session, `/work/src/file-${file}.ts`, file * FILE_CHARS);
      }
    }

    const rows = await blockRows(await contextPane($), WASTED_TITLE);

    expect(rows).toHaveLength(WASTED_CAP + 1);
    expect(rows[0]).toContain("file-6.ts");
    expect(rows[WASTED_CAP - 1]).toContain("file-2.ts");
    expect(rows[WASTED_CAP]).toContain("+1 more");
    expect(rows.join("\n")).not.toContain("file-1.ts");
  });

  test("W18 a session with no compaction and no repeats shows the usual tab and neither title", async ($, on) => {
    const session = await sessionWith(on, $);
    await readFile($, session, "/work/src/big.ts", FILE_CHARS);
    await readFile($, session, "/work/src/other.ts", FILE_CHARS);

    const titles = await titlesDrawn(await contextPane($));

    expect(titles.some((title) => title.startsWith("Memory files"))).toBe(true);
    expect(isDrawn(titles, COMPACTIONS_TITLE)).toBe(false);
    expect(isDrawn(titles, WASTED_TITLE)).toBe(false);
  });

  test("W19 three Bash calls that return nothing add no wasted row", async ($, on) => {
    const session = await sessionWith(on, $);
    await repeatedOutput($, session, "Bash", ["mkdir a", "mkdir b", "mkdir c"], "", 0);

    expect(isDrawn(await titlesDrawn(await contextPane($)), WASTED_TITLE)).toBe(false);
  });

  test("W20 starting a cleared session empties both blocks", async ($, on) => {
    const session = await sessionWith(on, $);
    await loggedCompactionAndRepeatedReads($, session);
    await startSession($, session, "clear");

    const titles = await titlesDrawn(await contextPane($));

    expect(isDrawn(titles, COMPACTIONS_TITLE)).toBe(false);
    expect(isDrawn(titles, WASTED_TITLE)).toBe(false);
  });

  test("W21 starting a fresh session empties both blocks", async ($, on) => {
    const session = await sessionWith(on, $);
    await loggedCompactionAndRepeatedReads($, session);
    await startSession($, session, "startup");

    const titles = await titlesDrawn(await contextPane($));

    expect(isDrawn(titles, COMPACTIONS_TITLE)).toBe(false);
    expect(isDrawn(titles, WASTED_TITLE)).toBe(false);
  });

  test("W22 three reads after a compaction show ×3, counted from the compaction", async ($, on) => {
    const session = await sessionWith(on, $);
    await compactWith($, session, BEFORE, AFTER);
    for (let read = 0; read < READS; read++) {
      await readFile($, session, "/work/src/big.ts", FILE_CHARS);
    }

    const rows = await blockRows(await contextPane($), WASTED_TITLE);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("×3");
  });

  test("R1 starting a new session with /clear empties Wasted reads on the next draw, with the tab still open", async ($, on) => {
    const session = await sessionWith(on, $);
    for (let read = 0; read < READS; read++) {
      await readFile($, session, "/work/src/big.ts", FILE_CHARS);
    }
    const pane = await contextPane($);
    expect(isDrawn(await titlesDrawn(pane), WASTED_TITLE)).toBe(true);

    await startSession($, session, "clear");
    await settle(pane);

    const titles = await titlesDrawn(pane);
    expect(titles.some((title) => title.startsWith("Memory files"))).toBe(true);
    expect(isDrawn(titles, WASTED_TITLE)).toBe(false);
  });

  test("R2 when the session history cannot be read, the Context tab keeps its other blocks and redraws do not read it again", async ($, on) => {
    const session = await sessionWith(on, $);
    session.broken = true;
    const pane = await contextPane($);
    for (let redraw = 0; redraw < REDRAWS; redraw++) await pane.redraw();

    const titles = await titlesDrawn(pane);
    expect(titles.some((title) => title.startsWith("Memory files"))).toBe(true);
    expect(isDrawn(titles, WASTED_TITLE)).toBe(false);
    expect(session.reads.count).toBe(1);
  });
});

describe("context tab repeated searches", () => {
  test("R2a two ToolSearch calls for different queries with the same no-match reply are not listed as a repeat", async ($, on) => {
    const session = await sessionWith(on, $);
    await toolSearches($, session, [CREATE_SEARCH, UPDATE_SEARCH]);

    const rows = await blockRows(await contextPane($), WASTED_TITLE);

    expect(rows).toEqual([]);
  });

  test("R2c the same ToolSearch query run twice shows one wasted row with ×2 and that query", async ($, on) => {
    const session = await sessionWith(on, $);
    await toolSearches($, session, [CREATE_SEARCH, CREATE_SEARCH]);

    const rows = await blockRows(await contextPane($), WASTED_TITLE);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("×2");
    expect(rows[0]).toContain(CREATE_SEARCH);
  });
});

async function toolSearches($: Engine, session: Session, queries: string[]): Promise<void> {
  for (const query of queries) {
    await toolCall($, session, {
      tool: TOOL_SEARCH,
      input: { query },
      reply: { text: NO_MATCH_REPLY },
    });
  }
}

type Session = {
  world: World;
  history: SessionMessage[];
  reads: { count: number };
  broken: boolean;
};
type CompactOptions = { trigger?: "manual" | "auto" | "plugin" | "precompute"; agentId?: string };
type Pane = Awaited<ReturnType<typeof contextPane>>;

async function loggedCompactionAndRepeatedReads($: Engine, session: Session): Promise<void> {
  await compactWith($, session, BEFORE, AFTER);
  for (let read = 0; read < READS; read++) {
    await readFile($, session, "/work/src/big.ts", FILE_CHARS);
  }
}

async function sessionWith(on: On, $: Engine): Promise<Session> {
  const world = worldOf(on, SUBSCRIPTION);
  world.breakdown = breakdown();
  const session: Session = { world, history: [], reads: { count: 0 }, broken: false };
  on("session.messages", (_$, e) => {
    if (e.agentId !== undefined) return { value: [] };
    session.reads.count += 1;
    if (session.broken) throw new Error("the session history cannot be read");
    return { value: [...session.history] };
  });
  on("classic.PostCompact", () => ({}));
  on("fs.write", () => ({ value: undefined }));
  await $.session.start({ cwd: "/work", surface: "terminal", isInteractive: true });
  await world.clock.advance(RESTART_MS);
  await startFreshSession($, world);
  await mainTurn($, world, { model: OPUS, tokens: { write: 20_000 }, context: 20_000 });
  return session;
}

async function startSession(
  $: Engine,
  session: Session,
  source: "clear" | "startup",
): Promise<void> {
  session.history.length = 0;
  await $.classic.SessionStart({ source });
  await session.world.clock.advance(RESTART_MS);
}

async function compactWith(
  $: Engine,
  session: Session,
  before: number | undefined,
  after: number | undefined,
  options: CompactOptions = {},
): Promise<void> {
  session.world.compaction = {
    ...(before === undefined ? {} : { tokensBefore: before }),
    ...(after === undefined ? {} : { tokensAfter: after }),
  };
  await compact($, session.world, options.agentId, options.trigger ?? "manual");
  if (options.agentId === undefined && options.trigger !== "precompute") {
    session.history.splice(0, session.history.length, SUMMARY);
  }
}

async function compactFromTab($: Engine, session: Session): Promise<void> {
  await compactWith($, session, BEFORE, AFTER);
  await $.classic.PostCompact({ trigger: "manual", compact_summary: "summary" });
}

function contextLogWrites(world: World): number {
  return world.state.get(CONTEXT_LOG_STATE)?.version ?? 0;
}

async function toolCall($: Engine, session: Session, call: ToolSpec): Promise<void> {
  await callTool($, session.world, call);
  if (call.agentId === undefined) session.history.push(usedTool(session.history.length, call));
}

function earlierCall(session: Session, call: ToolSpec): void {
  session.history.push(usedTool(session.history.length, call));
}

function usedTool(index: number, call: ToolSpec): SessionMessage {
  const text = textOf(call.reply);
  return {
    role: "assistant",
    text: "",
    toolUses: [
      {
        tool_use_id: `history-${index}`,
        tool: call.tool,
        input: call.input as Record<string, unknown>,
        result: text,
        text,
      },
    ],
  };
}

function textOf(reply: ToolReply): string {
  return "text" in reply ? reply.text : "";
}

function readSpec(path: string, chars: number, agentId?: string): ToolSpec {
  return {
    tool: "Read",
    input: { file_path: path },
    reply: { text: "x".repeat(chars) },
    ...(agentId === undefined ? {} : { agentId }),
  };
}

function readFile(
  $: Engine,
  session: Session,
  path: string,
  chars: number,
  agentId?: string,
): Promise<void> {
  return toolCall($, session, readSpec(path, chars, agentId));
}

function earlierReads(session: Session, path: string, chars: number, times: number): void {
  for (let read = 0; read < times; read++) earlierCall(session, readSpec(path, chars));
}

function repeatSpecs(tool: string, commands: string[], fill: string, chars: number): ToolSpec[] {
  return commands.map((command) => ({
    tool,
    input: { command, pattern: command },
    reply: { text: fill.repeat(chars) },
  }));
}

async function repeatedOutput(
  $: Engine,
  session: Session,
  tool: string,
  commands: string[],
  fill: string,
  chars: number = REPEAT_CHARS,
): Promise<void> {
  for (const spec of repeatSpecs(tool, commands, fill, chars)) {
    await toolCall($, session, spec);
  }
}

function earlierRepeats(
  session: Session,
  tool: string,
  commands: string[],
  fill: string,
  chars: number = REPEAT_CHARS,
): void {
  for (const spec of repeatSpecs(tool, commands, fill, chars)) earlierCall(session, spec);
}

async function contextPane($: Engine) {
  const pane = await openPane($, PANE_COLUMNS, PANE_ROWS);
  await showTabThroughArrows(pane, CONTEXT_TAB);
  await settle(pane);
  return pane;
}

async function titlesDrawn(pane: Pane): Promise<string[]> {
  return (await lines(pane)).map((line) => line.text);
}

async function blockRows(pane: Pane, title: string): Promise<string[]> {
  const shown = await lines(pane);
  const start = shown.findIndex((line) => line.text.startsWith(title));
  if (start === -1) return [];
  const rest = shown.slice(start + 1);
  const end = rest.findIndex((line) => line.text === "");
  return (end === -1 ? rest : rest.slice(0, end)).map((line) => line.text);
}

function isDrawn(texts: string[], title: string): boolean {
  return texts.some((text) => text.startsWith(title));
}

function breakdown(): SessionContextBreakdown {
  return {
    categories: [
      {
        name: "System prompt",
        tokens: 8_000,
        color: "promptBorder",
        isDeferred: false,
        kind: "used",
      },
      { name: "Messages", tokens: 20_000, color: "permission", isDeferred: false, kind: "used" },
      { name: "Free space", tokens: 172_000, color: "subtle", isDeferred: false, kind: "free" },
    ],
    totalTokens: 28_000,
    maxTokens: WINDOW,
    rawMaxTokens: WINDOW,
    percentage: 14,
    model: "Opus 5.5",
    gridRows: [],
    memoryFiles: [{ path: "/work/AGENTS.md", type: "Project", tokens: 300 }],
    mcpTools: [],
    agents: [{ agentType: "reviewer", source: "projectSettings", tokens: 900 }],
    skills: { totalSkills: 9, includedSkills: 7, tokens: 2_500, skillFrontmatter: [] },
    autoCompactThreshold: 160_000,
    isAutoCompactEnabled: true,
  } as unknown as SessionContextBreakdown;
}
