import { expect, mock } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import type { SessionRow } from "../types";
import { childrenOf, collect, textOf } from "./draw-tree";
import { drainCostReads, measureOwnCost, seedStoredCosts } from "./cost-seed";
import { linesOf } from "./skills-tree";

export type Pane = Mounted<"terminal", "Pane">;

export type World = {
  alive: Set<number>;
  removed: string[];
  files: Map<string, string>;
  psCalls: number;
  transcriptReads: number;
  transcriptBytes: number;
  transcripts: Map<string, string>;
  setTranscript: (path: string, text: string) => void;
  storedRow: (pid: number) => SessionRow | undefined;
  settle: () => Promise<void>;
  advance: (ms: number) => Promise<void>;
};

export type ToolAt = { name: string; at: number };

export type TranscriptSpec = {
  prompt?: string;
  model?: string;
  pendingTool?: ToolAt;
  answeredTool?: ToolAt;
};

export const HOME = "/h/u";
export const WORK = "/work";
export const SESSIONS_DIR = `${HOME}/.claude/paneline/sessions`;
export const REGISTRY_DIR = `${HOME}/.claude/sessions`;
export const OWN_SESSION = "session-one";
export const OWN_PID = 100;
export const CLOCK_START = 1_000_000;
export const COLUMNS = 60;
export const PANE_ROWS = 40;
export const WAITING_DOT = "!";
export const RUNNING_DOT = "●";
export const IDLE_DOT = "○";
export const DOT_GLYPHS = [WAITING_DOT, RUNNING_DOT, IDLE_DOT];

const STDOUT_LIMIT_BYTES = 4_194_304;
const NEXT_TAB = "›";
const TAB_PRESSES_LIMIT = 12;
const SETTLE_MS = 10;
const PENDING_TOOL_ID = "tool-pending";
const ANSWERED_TOOL_ID = "tool-answered";

export function transcriptPathOf(row: Pick<SessionRow, "cwd" | "sessionId">): string {
  return `${HOME}/.claude/projects/${row.cwd.replace(/[^A-Za-z0-9]/g, "-")}/${row.sessionId}.jsonl`;
}

export function transcriptOf(spec: TranscriptSpec): string {
  const lines: unknown[] = [];
  if (spec.prompt !== undefined) lines.push({ type: "last-prompt", lastPrompt: spec.prompt });
  if (spec.answeredTool !== undefined) {
    lines.push(toolUseRow(spec.answeredTool, ANSWERED_TOOL_ID, spec.model));
    lines.push({
      type: "user",
      timestamp: new Date(spec.answeredTool.at + 1).toISOString(),
      message: { content: [{ type: "tool_result", tool_use_id: ANSWERED_TOOL_ID }] },
    });
  }
  if (spec.pendingTool !== undefined)
    lines.push(toolUseRow(spec.pendingTool, PENDING_TOOL_ID, spec.model));
  if (spec.pendingTool === undefined && spec.model !== undefined)
    lines.push({
      type: "assistant",
      timestamp: new Date(0).toISOString(),
      message: { model: spec.model, content: [{ type: "text", text: "done" }] },
    });
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

function toolUseRow(tool: ToolAt, id: string, model: string | undefined): unknown {
  return {
    type: "assistant",
    timestamp: new Date(tool.at).toISOString(),
    message: {
      model: model ?? "claude-opus-5-5",
      content: [{ type: "tool_use", id, name: tool.name, input: {} }],
    },
  };
}

export function lastPromptLine(prompt: string): string {
  return `${JSON.stringify({ type: "last-prompt", lastPrompt: prompt })}\n`;
}

export function toolUseLine(id: string, name: string, at: number): string {
  return `${JSON.stringify(toolUseRow({ name, at }, id, undefined))}\n`;
}

export function toolResultLine(id: string, at: number): string {
  return `${JSON.stringify({
    type: "user",
    timestamp: new Date(at).toISOString(),
    message: { content: [{ type: "tool_result", tool_use_id: id }] },
  })}\n`;
}

export function fillerOfBytes(bytes: number, model = "claude-opus-5-5"): string {
  const line = `${JSON.stringify({
    type: "assistant",
    timestamp: new Date(0).toISOString(),
    message: { model, content: [{ type: "text", text: "x".repeat(900) }] },
  })}\n`;
  return line.repeat(Math.ceil(bytes / line.length));
}

export async function begin(
  $: Engine,
  on: On,
  rows: SessionRow[],
  usageContext: number | null = null,
  theme = "dark",
  isSeedingCosts = true,
): Promise<World> {
  const transcripts = new Map<string, string>();
  const mtimes = new Map<string, number>();
  const world: World = {
    alive: new Set(rows.map((row) => row.pid)),
    removed: [],
    files: new Map(),
    psCalls: 0,
    transcriptReads: 0,
    transcriptBytes: 0,
    transcripts,
    setTranscript: (path, text) => {
      if (transcripts.get(path) !== text) mtimes.set(path, (mtimes.get(path) ?? 0) + 1);
      transcripts.set(path, text);
    },
    storedRow: (pid) =>
      (state.get("paneline.sessions.")?.value as Record<string, SessionRow> | undefined)?.[pid],
    settle: () => (isSeedingCosts ? drainCostReads(clock) : clock.advance(SETTLE_MS)),
    advance: async (ms) => {
      await clock.advance(ms);
      await settleCostReads();
    },
  };
  settleCostReads = isSeedingCosts ? () => drainCostReads(clock) : async () => {};
  const files = world.files;
  rows.forEach((row) => files.set(`${SESSIONS_DIR}/${row.pid}.json`, JSON.stringify(row)));
  rows.forEach((row) =>
    files.set(
      `${REGISTRY_DIR}/${row.pid}.json`,
      JSON.stringify({
        pid: row.pid,
        sessionId: row.sessionId,
        cwd: row.cwd,
        kind: "interactive",
        status: registryStatusOf(row),
        statusUpdatedAt: row.since ?? undefined,
      }),
    ),
  );
  const state = new Map<string, { value: unknown; version: number }>([
    [
      "paneline.sessions.",
      { value: Object.fromEntries(rows.map((row) => [row.pid, row])), version: 1 },
    ],
  ]);
  const clock = mock.clock(on, { now: CLOCK_START });
  mock.env(on, { HOME });
  on("config.list", () => ({ value: [{ key: "theme", value: theme }] }) as never);
  on("command.register", () => ({ value: {} }) as never);
  on("session.id", () => ({ value: OWN_SESSION }));
  on("settings.read", () => ({ value: {} }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("store.get", () => ({ value: undefined }));
  on("store.set", () => ({ value: undefined }));
  on("state.get", (_$, e) => {
    const entry = state.get(`${e.plugin}.${e.key}.${e.id ?? ""}`);
    return { value: { value: entry?.value, version: entry?.version ?? 0 } };
  });
  on("state.set", (_$, e) => {
    const key = `${e.plugin}.${e.key}.${e.id ?? ""}`;
    const version = (state.get(key)?.version ?? 0) + 1;
    state.set(key, { value: JSON.parse(JSON.stringify(e.value)), version });
    return { value: { isSet: true, version } };
  });
  on("classic.SessionStart", () => ({}));
  on("classic.FileChanged", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("session.repo", () => ({ value: null }));
  on("session.root", () => ({ value: WORK }));
  on("session.cwd", () => ({ value: WORK }));
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", () => ({ value: true }));
  on("tool.register", (_$, e) => ({ value: { tool: `mcp__paneline__${e.name}` } }));
  on("tool.check", () => ({ decision: "allow" }));
  on("prompt.submit", (_$, e) => ({ text: e.text }));
  on("turn.complete", (_$, e) => ({ text: e.answer }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("fs.write", (_$, e) => {
    files.set(e.path, e.text);
    return { value: undefined };
  });
  on("fs.stat", (_$, e) => {
    const text = transcripts.get(e.path);
    if (text === undefined) throw new Error("no such file");
    return {
      value: { kind: "file", size: text.length, mtimeMs: mtimes.get(e.path) ?? 0, isLink: false },
    } as never;
  });
  on("fs.list", (_$, e) => ({
    value: [...files.keys()]
      .filter((path) => path.startsWith(`${e.path}/`))
      .map((path) => ({
        name: path.slice(path.lastIndexOf("/") + 1),
        kind: "file",
        size: 0,
        mtimeMs: 0,
        isLink: false,
      })),
  }));
  on("fs.read", (_$, e) => ({ value: files.get(e.path) ?? "" }));
  if (isSeedingCosts) seedStoredCosts(on, rows, OWN_SESSION);
  on("process.run", (_$, e) => ({ value: runProcess(world, files, e.argv) }) as never);
  await $.session.start({ cwd: WORK, surface: "terminal", isInteractive: true });
  state.set("paneline.usage.", {
    value: { context: usageContext ?? ownContextOf(rows, isSeedingCosts), limits: [] },
    version: (state.get("paneline.usage.")?.version ?? 0) + 1,
  });
  if (isSeedingCosts) await measureOwnCost($, rows, OWN_SESSION);
  return world;
}

function ownContextOf(rows: SessionRow[], isSeedingCosts: boolean): number | null {
  const own = rows.find((row) => row.sessionId === OWN_SESSION);
  return isSeedingCosts && (own?.usd ?? 0) > 0 ? (own?.ctx ?? null) : null;
}

function registryStatusOf(row: SessionRow): string {
  if (row.state === "waiting") return "waiting";
  return row.state === "idle" ? "idle" : "busy";
}

function runProcess(
  world: World,
  files: Map<string, string>,
  argv: readonly string[],
): { exitCode: number; stdout: string; stderr: string } {
  const [command = "", ...args] = argv;
  if (command === "rm") {
    const paths = args.filter((arg) => arg !== "-f");
    paths.forEach((path) => files.delete(path));
    world.removed.push(...paths);
  }
  const transcriptPath = argv.find((arg) => world.transcripts.has(arg));
  if (transcriptPath !== undefined) return readTranscriptSlice(world, transcriptPath, argv);
  if (isRangeScan(argv)) return { exitCode: 1, stdout: "", stderr: "no such file" };
  if (command === "sh") return { exitCode: 0, stdout: `${OWN_PID}\n`, stderr: "" };
  if (command === "tail") return { exitCode: 1, stdout: "", stderr: "no such file" };
  if (command === "ps") world.psCalls += 1;
  const alive =
    command === "ps"
      ? (args[1] ?? "")
          .split(",")
          .map(Number)
          .filter((pid) => world.alive.has(pid))
          .map((pid) => `${pid} claude\n`)
          .join("")
      : "";
  return { exitCode: 0, stdout: alive, stderr: "" };
}

function readTranscriptSlice(
  world: World,
  path: string,
  argv: readonly string[],
): { exitCode: number; stdout: string; stderr: string } {
  const text = world.transcripts.get(path) ?? "";
  const whole = isRangeScan(argv) ? rangeScanOf(text, argv) : tailOf(text, argv);
  const stdout = whole.slice(0, STDOUT_LIMIT_BYTES);
  world.transcriptReads += 1;
  world.transcriptBytes += stdout.length;
  return { exitCode: 0, stdout, stderr: "" };
}

function isRangeScan(argv: readonly string[]): boolean {
  return argv[0] === "sh" && argv.some((arg) => arg.includes("awk"));
}

function tailOf(text: string, argv: readonly string[]): string {
  const count = argv[argv.indexOf("-c") + 1] ?? "0";
  return count.startsWith("+") ? text.slice(Number(count) - 1) : text.slice(-Number(count));
}

const MAX_FIELD_CHARS = 20000;
const INJECTED_CANDIDATE =
  /^"role":"user","content":("|\[\{"type":"text","text":")(\\n|\\t| )*(<(task-notification|command-|local-command-|system-reminder|bash-)|This session is being continued|\[Request interrupted)/u;

function rangeScanOf(text: string, argv: readonly string[]): string {
  const [offset = "1", , length = "0"] = argv.slice(argv.indexOf("sh", 3) + 1);
  const slice = `${text.slice(Number(offset) - 1).slice(0, Number(length))}\n`;
  const lines = slice.split("\n");
  lines.pop();
  const unterminated = lines.pop() ?? "";
  return `${[...scanOutputOf(lines), String(unterminated.length)].join("\n")}\n`;
}

function scanOutputOf(lines: string[]): string[] {
  const out: string[] = [];
  const opened: { id: string; use: string; stamp: string }[] = [];
  const open = new Set<string>();
  let model = "";
  let lastPrompt = "";
  let typed = "";
  let typedAt = 0;
  let promptAt = 0;
  lines.forEach((line, at) => {
    if (line.includes('"isSidechain":true')) return;
    if (line.includes('"type":"assistant"')) {
      if (!line.includes("<synthetic>")) model = /"model":"[^"]+"/u.exec(line)?.[0] ?? model;
      const stampMatch = /"timestamp":"[^"]*"/u.exec(line)?.[0];
      const stamp = stampMatch === undefined ? "" : `${stampMatch},`;
      for (const use of line.match(/"type":"tool_use","id":"[^"]*","name":"[^"]*"/gu) ?? []) {
        const id = /"id":"([^"]*)"/u.exec(use)?.[1] ?? "";
        opened.push({ id, use, stamp });
        open.add(id);
      }
    }
    if (line.includes('"type":"user"')) {
      for (const match of line.matchAll(/"tool_use_id":"([^"]*)"/gu)) {
        const id = match[1] ?? "";
        if (open.has(id)) open.delete(id);
        else
          out.push(
            `{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"${id}"}]}}`,
          );
      }
      if (!line.includes('"isMeta":true')) {
        const plain = /"role":"user","content":"([^"\\]|\\.)*"/u.exec(line)?.[0];
        const blocks = /"role":"user","content":\[\{"type":"text","text":"([^"\\]|\\.)*"/u.exec(
          line,
        )?.[0];
        const candidate =
          plain !== undefined && plain.length <= MAX_FIELD_CHARS
            ? plain
            : blocks !== undefined && blocks.length <= MAX_FIELD_CHARS
              ? `${blocks}}]`
              : "";
        if (candidate !== "" && !INJECTED_CANDIDATE.test(candidate)) {
          typed = candidate;
          typedAt = at + 1;
        }
      }
    }
    if (line.includes('"type":"last-prompt"')) {
      promptAt = at + 1;
      const found = /"lastPrompt":"([^"\\]|\\.)*"/u.exec(line)?.[0];
      if (found !== undefined && found.length <= MAX_FIELD_CHARS) lastPrompt = found;
    }
  });
  if (model !== "") out.push(`{${model}}`);
  if (typed !== "" && typedAt < promptAt) out.push(`{"type":"user","message":{${typed}}}`);
  if (lastPrompt !== "") out.push(`{"type":"last-prompt",${lastPrompt}}`);
  for (const [at, item] of opened.entries())
    if (open.has(item.id) && opened.findLastIndex((other) => other.id === item.id) === at)
      out.push(`{"type":"assistant",${item.stamp}"message":{"content":[{${item.use}}]}}`);
  if (typed !== "" && typedAt > promptAt) out.push(`{"type":"user","message":{${typed}}}`);
  return out;
}

export function putRegistry(world: World, pid: number, patch: Record<string, unknown>): void {
  const path = `${REGISTRY_DIR}/${pid}.json`;
  const before = (JSON.parse(world.files.get(path) ?? "null") as object | null) ?? {
    pid,
    sessionId: `session-${pid}`,
    cwd: WORK,
    kind: "interactive",
    status: "idle",
  };
  world.files.set(path, JSON.stringify({ ...before, ...patch }));
  world.alive.add(pid);
}

export function mountPane($: Engine, columns: number): Promise<Pane> {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: "session",
    props: {
      title: "Session",
      isFocused: false,
      bodyColumns: columns,
      placement: "dock",
      scroll: { offset: 0, bodyRows: PANE_ROWS },
      view: {},
    },
    viewport: { columns, rows: PANE_ROWS },
  });
}

let settleCostReads: () => Promise<void> = async () => {};

export async function sessionsPane($: Engine, columns: number = COLUMNS): Promise<Pane> {
  const pane = await mountPane($, columns);
  await showSessions(pane);
  return pane;
}

export async function enterSessions(
  $: Engine,
  world: World,
  columns: number = COLUMNS,
): Promise<Pane> {
  const pane = await sessionsPane($, columns);
  await world.settle();
  await pane.redraw();
  return pane;
}

export async function showSessions(pane: Pane): Promise<void> {
  for (let press = 0; press < TAB_PRESSES_LIMIT; press += 1) {
    const buttons = await pane.findAll({ type: "Button" });
    const sessionsTab = buttons.find((button) => button.props.label === "Sessions");
    const nextTab = buttons.find((button) => String(button.props.label).includes(NEXT_TAB));
    const target = sessionsTab ?? nextTab;
    if (target === undefined) return;
    await pane.press({ key: target.key ?? "" });
    await pane.redraw();
    if (sessionsTab !== undefined) return;
  }
  expect(false, "Sessions reached through the tab bar").toBe(true);
}

export async function rowTexts(pane: Pane): Promise<string[]> {
  return linesOf(await pane.drawn())
    .map((line) => line.text.trimEnd())
    .filter((text) => text !== "");
}

export async function sessionRows(pane: Pane): Promise<string[]> {
  await settleCostReads();
  await pane.redraw();
  return (await rowTexts(pane)).filter((text) =>
    DOT_GLYPHS.some((glyph) => text.startsWith(`${glyph} `)),
  );
}

export async function colorsOf(pane: Pane, text: string): Promise<unknown[]> {
  const leaves = collect(await pane.drawn(), "Text").filter(
    (node) => textOf(node) === text && childrenOf(node).every((child) => child.type !== "Text"),
  );
  return leaves.map((node) => node.props?.color);
}
