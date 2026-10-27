import { expect, mock } from "claude-code/testing";
import type { On, TurnStepResult, TurnUsage } from "claude-code";
import type { Engine, MockClock, Mounted } from "claude-code/testing";

import { palette } from "../hooks/palette";
import { textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import { keyOf, linesOf, shownTexts } from "./skills-tree";
import type { Line } from "./skills-tree";
import { isHeavy } from "./weight";

export type Pane = Mounted<"terminal", "Pane">;
export type World = {
  clock: MockClock;
  patches: Map<string, { added: number; removed: number }>;
  landing: { diff: string; heads: string[] };
  stepUsage: TurnUsage | null;
  spawned: number;
  callsMade: number;
};

export const COLUMNS = 100;
export const TALL_ROWS = 40;
export const SHORT_ROWS = 20;
export const FLUSH_MS = 1_000;
export const CLEAR_LABEL = "clear";
export const FAILING_COMMAND = "fail";

const DEFAULT_TAB = "Activity";
const NOW = 200_000;
const SETTLE_TICKS = 5;
const WORK = "/work";
const SESSION_ID = "session-one";
const NO_USAGE: TurnUsage = {
  model: "sonnet",
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

export function worldOf(on: On): World {
  const world: World = {
    clock: mock.clock(on, { now: NOW }),
    patches: new Map(),
    landing: { diff: "", heads: ["head-0"] },
    stepUsage: null,
    spawned: 0,
    callsMade: 0,
  };
  mock.env(on, { HOME: "/h/u" });
  const kept = new Map<string, unknown>();
  on("store.get", (_$, e) => ({ value: kept.get(e.key) }));
  on("store.set", (_$, e) => {
    kept.set(e.key, JSON.parse(JSON.stringify(e.value)));
    return { value: undefined };
  });
  on("session.id", () => ({ value: SESSION_ID }));
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: WORK }));
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", () => ({ value: true }));
  on("agent.spawn", () => ({ model: "sonnet", agentId: `agent-${++world.spawned}` }));
  on("turn.step", async function* (_$, e) {
    return stepResultOf(e.turnId, e.index, world.stepUsage);
  });
  on("turn.complete", (_$, e) => ({ text: e.answer }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("tool.call", (_$, e) => {
    const call = e as unknown as { tool: string; command?: string; tool_use_id: string };
    if (call.tool === "Bash" && call.command === FAILING_COMMAND)
      return { isError: true, result: "boom", text: "boom" } as never;
    const patch = world.patches.get(call.tool_use_id);
    if (patch === undefined) return { result: "ok", text: "ok" };
    const lines = [
      ...Array.from({ length: patch.added }, () => "+x"),
      ...Array.from({ length: patch.removed }, () => "-x"),
    ];
    return { result: { structuredPatch: [{ lines }] }, text: "edited" };
  });
  on("process.run", (_$, e) => {
    const stdout = e.argv.includes("--abbrev-ref")
      ? "main"
      : e.argv.includes("--show-toplevel")
        ? e.argv.includes("HEAD")
          ? `${WORK}\n${nextHead(world)}`
          : WORK
        : e.argv.includes("--numstat")
          ? world.landing.diff
          : "";
    return { value: { exitCode: 0, stdout, stderr: "" } } as never;
  });
  return world;
}

export async function paneOnTab(
  $: Engine,
  label: string,
  size: { columns?: number; rows?: number } = {},
): Promise<Pane> {
  const pane = await mountPane($, size.columns ?? COLUMNS, size.rows ?? TALL_ROWS);
  if (label !== DEFAULT_TAB) await showTab(pane, label);
  return pane;
}

export async function showTab(pane: Pane, label: string): Promise<void> {
  const target = (await pane.findAll({ type: "Button" })).find(
    (button) => button.props.label === label,
  );
  expect(target, `a ${label} tab button`).toBeDefined();
  await pane.press({ key: target?.key ?? "" });
  await settle(pane);
}

export async function lines(pane: Pane): Promise<Line[]> {
  return linesOf(await pane.drawn());
}

export async function texts(pane: Pane): Promise<string[]> {
  return shownTexts(await pane.drawn());
}

export async function callRowKeys(pane: Pane): Promise<string[]> {
  const buttons = await pane.findAll({ type: "Button" });
  return buttons.map((button) => String(button.key)).filter((key) => /^(call|failed)-/.test(key));
}

export function headingLineOf(shown: Line[], title: string): Line | undefined {
  return shown.findLast((line) =>
    line.parts.some(
      (part) => part.type === "Text" && isHeavy(part.props) && textOf(part).trim() === title,
    ),
  );
}

export function clearButtonsOf(shown: Line[]): Node[] {
  return shown
    .flatMap((line) => line.parts)
    .filter((part) => part.type === "Button" && part.props?.label === CLEAR_LABEL);
}

export function isDim(part: Node): boolean {
  return part.props?.dimColor === true || part.props?.color === palette.muted;
}

export async function pressClear(pane: Pane, world: World): Promise<void> {
  const [button] = clearButtonsOf(await lines(pane));
  expect(button, `a "${CLEAR_LABEL}" button`).toBeDefined();
  await pane.press({ key: keyOf(button) });
  await world.clock.advance(FLUSH_MS);
  await settle(pane);
}

export async function settle(pane: Pane): Promise<void> {
  for (let tick = 0; tick < SETTLE_TICKS; tick++) await pane.redraw();
}

export async function editFile(
  $: Engine,
  world: World,
  path: string,
  added: number,
  removed: number,
  agentId?: string,
): Promise<void> {
  const id = newCallId(world);
  world.patches.set(id, { added, removed });
  await callTool($, {
    tool: "Edit",
    file_path: path,
    tool_use_id: id,
    ...(agentId === undefined ? {} : { agentId }),
  });
}

export async function readFile($: Engine, world: World, path: string): Promise<void> {
  await callTool($, { tool: "Read", file_path: path, tool_use_id: newCallId(world) });
}

export async function runCommand($: Engine, world: World, command: string): Promise<void> {
  await callTool($, { tool: "Bash", command, tool_use_id: newCallId(world) });
}

export async function landCommit(
  $: Engine,
  world: World,
  command: string,
  diff: string,
  head: string,
): Promise<void> {
  world.landing.diff = diff;
  world.landing.heads.push(head);
  await runCommand($, world, command);
}

export async function finishTurn($: Engine, durationMs: number): Promise<void> {
  await $.turn.complete({
    answer: "",
    durationMs,
    isAborted: false,
    turnId: `turn-${durationMs}`,
    reason: "answer",
  } as never);
}

export async function spawnAgent(
  $: Engine,
  world: World,
  description: string,
  parentAgentId?: string,
): Promise<string> {
  const spawn = await $.agent.spawn({
    tool_use_id: `call-${description}`,
    prompt: "do the work",
    description,
    subagentType: "general-purpose",
    provider: "anthropic",
    parentModel: "sonnet",
    background: false,
    fork: false,
    ...(parentAgentId === undefined ? {} : { parentAgentId }),
  } as never);
  await world.clock.advance(FLUSH_MS);
  return spawn.agentId ?? "";
}

export async function finishAgent($: Engine, world: World, agentId: string): Promise<void> {
  await $.turn.complete({
    answer: "",
    durationMs: 5,
    isAborted: false,
    turnId: `turn-${agentId}`,
    agentId,
    reason: "answer",
  } as never);
  await world.clock.advance(FLUSH_MS);
}

export async function spendTokens(
  $: Engine,
  world: World,
  agentId: string,
  tokens: number,
): Promise<void> {
  world.stepUsage = { ...NO_USAGE, input_tokens: tokens };
  const stream = $.turn.step({
    turnId: `step-${agentId}`,
    index: 0,
    model: "sonnet",
    effort: "high",
    messageCount: 1,
    agentId,
  } as never);
  for await (const _chunk of stream) continue;
  await world.clock.advance(FLUSH_MS);
}

export async function setSessionCost($: Engine, world: World, usd: number): Promise<void> {
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [],
    cost: { usd },
    changed: ["cost"],
  } as never);
  await world.clock.advance(FLUSH_MS);
}

function mountPane($: Engine, columns: number, rows: number): Promise<Pane> {
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
      scroll: { offset: 0, bodyRows: rows },
      view: {},
    },
    viewport: { columns, rows },
  });
}

function callTool($: Engine, call: object): Promise<unknown> {
  return ($.tool.call as (e: object) => Promise<unknown>)(call);
}

function nextHead(world: World): string | undefined {
  const heads = world.landing.heads;
  return heads.length > 1 ? heads.shift() : heads[0];
}

function newCallId(world: World): string {
  world.callsMade += 1;
  return `call-${world.callsMade}`;
}

function stepResultOf(turnId: string, index: number, usage: TurnUsage | null): TurnStepResult {
  return { turnId, index, answer: "", toolUses: [], stopReason: "end_turn", usage };
}
