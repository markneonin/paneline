import { atom, memberOf, read, update } from "claude-code";
import type {
  EngineInterface,
  On,
  RenderElement,
  ResolveInput,
  UiPressArgument,
} from "claude-code";

import type { UsageSnap, PromptInfo } from "../types";
import { UNMEASURED_MS } from "./activity-track";
import { footerRow, layoutOf, toolGroupRow, userBlock } from "./chat-draw";
import type { ToolGroupView } from "./chat-draw";
import {
  bashChangesOf,
  bashNotes,
  diffPanel,
  fileChangeOf,
  withoutBashChanges,
} from "./diff-panel";
import type { BashChanges } from "./diff-panel";
import { replyView } from "./reply-draw";
import type { Accent } from "./pane-kit";
import { fillsFor } from "./palette";
import type { Fills } from "./palette";
import { metersOf, promptInfoRow } from "./prompt-info";
import { PANE } from "./pane-tab";
import { accentOf } from "./session-color";
import { TABS } from "./tabs";
import { isTerminal } from "./surface";

const DIFF_TOOLS = new Set(["Edit", "Write"]);
const TYPED = new Set(["composer", "bridge", "sdk"]);
const MAX_PROMPT = 4000;
const MAX_REPLY_CHARS = 60_000;
const BAND_ROWS_WITH_SPACER = 2;
type Copy = (text: string, press: UiPressArgument) => void;

const usageAtom = atom(
  { plugin: "paneline", key: "usage" } as const,
  { context: null, limits: [] } as UsageSnap,
);
const promptInfoAtom = atom(
  { plugin: "paneline", key: "promptInfo" } as const,
  { model: "", effort: null, cwd: "" } as PromptInfo,
);
const sessionColorAtom = atom({ plugin: "paneline", key: "sessionColor" } as const, "default");
const themeAtom = atom({ plugin: "paneline", key: "theme" } as const, "dark");
const toolMsAtom = atom({ plugin: "paneline", key: "toolMs" } as const, UNMEASURED_MS);
const turnStatsAtom = atom({ plugin: "paneline", key: "turnStats" } as const, null);
const tabAtom = atom({ plugin: "paneline", key: "tab" } as const, "activity");

type RenderEvent = { surface: string; viewport?: { columns: number } };

async function elapsedOf($: EngineInterface, ids: (string | undefined)[]): Promise<number | null> {
  const known = ids.filter((id): id is string => id !== undefined && id !== "");
  const measured = (
    await Promise.all(known.map((id) => read($, memberOf(toolMsAtom, { requestId: id }))))
  ).filter((ms) => ms !== UNMEASURED_MS);
  return measured.length === 0 ? null : measured.reduce((sum, ms) => sum + ms, 0);
}

async function currentAccent($: EngineInterface): Promise<Accent> {
  return accentOf(await read($, sessionColorAtom));
}

async function currentFills($: EngineInterface): Promise<Fills> {
  return fillsFor(await read($, themeAtom));
}

async function openSessionPane($: EngineInterface): Promise<void> {
  await update($, tabAtom, () => TABS[0].id);
  await $.ui.open({ id: PANE, title: "Session", closeOnEscape: true });
}

async function toolRow(
  $: EngineInterface,
  e: ResolveInput & RenderEvent,
  ids: (string | undefined)[],
  view: Omit<ToolGroupView, "accent" | "fills">,
) {
  const [elapsedMs, accent, fills] = await Promise.all([
    elapsedOf($, ids),
    currentAccent($),
    currentFills($),
  ]);
  return toolGroupRow(
    $.ui.resolve(e),
    { ...view, elapsedMs, accent, fills },
    layoutOf(columnsOf(e)),
    () => void openSessionPane($),
  );
}

type FinishedCall = { tool_use_id: string; tool: string; output?: unknown; isErrored: boolean };
type CallEvent = ResolveInput & RenderEvent & { props: FinishedCall };
type Draw<E> = (e: E) => RenderElement | Promise<RenderElement>;

async function drawWithChanges<E extends CallEvent>(
  $: EngineInterface,
  e: E,
  next: Draw<E>,
): Promise<RenderElement> {
  const call = e.props;
  const changes = call.isErrored ? null : changesOf(call);
  if (changes === null) return next(e);
  const [{ cwd }, home, accent, fills] = await Promise.all([
    read($, promptInfoAtom),
    $.env.get("HOME"),
    currentAccent($),
    currentFills($),
  ]);
  const ui = $.ui.resolve(e);
  const windows = changes.changes.map((change) =>
    diffPanel(ui, {
      toolUseId: call.tool_use_id,
      change,
      cwd,
      home,
      width: layoutOf(columnsOf(e)).width,
      accent,
      fills,
    }),
  );
  if (call.tool !== "Bash") return windows[0] ?? next(e);
  const rest = await next({
    ...e,
    props: { ...call, output: withoutBashChanges(call.output) },
  });
  const { Box } = ui;
  return (
    <Box flexDirection="column">
      {rest}
      {windows}
      {bashNotes(ui, changes)}
    </Box>
  );
}

function changesOf({ tool, output }: FinishedCall): BashChanges | null {
  if (tool === "Bash") return bashChangesOf(output);
  const change = DIFF_TOOLS.has(tool) ? fileChangeOf(output) : null;
  return change === null ? null : { changes: [change], moreFiles: 0, isShared: false };
}

const columnsOf = (e: RenderEvent): number => e.viewport?.columns ?? 100;

const RENDER_HINT_SECTION = {
  id: "paneline:render-hint",
  scope: "session",
  text: [
    "Replies in this session are drawn as rich terminal graphics.",
    "Use pipe tables with alignment for comparisons.",
    "Use GitHub alerts (> [!NOTE], [!TIP], [!IMPORTANT], [!WARNING], [!CAUTION]) for things that must not be missed.",
    'Use fenced code with a language, and title="path" when the code belongs to a file.',
    "Commands the user should run go in fenced bash blocks.",
    "When a flow, sequence, state, schema or numeric series is easier to see than read, add one small ```mermaid block: flowchart, sequenceDiagram, stateDiagram, classDiagram, erDiagram, or xychart-beta with bar or line. Keep labels short.",
    "Skip the graphics for simple answers.",
  ].join(" "),
} as const;

const MODEL_COMMAND = "model";

function openModelPicker($: EngineInterface): void {
  void $.command
    .run({ command: MODEL_COMMAND })
    .catch((error: unknown) => $.ui.toast(`/${MODEL_COMMAND} failed: ${String(error)}`));
}

export function renderChat(on: On): void {
  on("prompt.compose", async ($, e, next) => {
    const composed = await next(e);
    return { sections: [...composed.sections, RENDER_HINT_SECTION] };
  });

  const expandedCalls = new Set<string>();
  let copyWithLatest: Copy = () => {};

  const copy: Copy = (text, press) => copyWithLatest(text, press);

  on("ui.render", { component: "UserMessage" }, async ($, e, next) => {
    if (!isTerminal(e)) return next(e);
    if (e.props.isExpanded || !TYPED.has(e.props.origin.kind) || e.props.text.length > MAX_PROMPT)
      return next(e);
    return userBlock($.ui.resolve(e), e.props.text, layoutOf(columnsOf(e)), await currentFills($));
  });

  on("ui.render", { component: "AssistantMessage" }, async ($, e, next) => {
    if (!isTerminal(e)) return next(e);
    if (e.props.text.length > MAX_REPLY_CHARS) return next(e);
    copyWithLatest = (text, press) => {
      void $.ui
        .copy({ text, surface: press.surface })
        .then((result) => result.isCopied)
        .catch(() => false)
        .then((isCopied) => $.ui.toast(isCopied ? "Copied" : "Could not copy here"));
    };
    const { width } = layoutOf(columnsOf(e));
    const [accent, fills] = await Promise.all([currentAccent($), currentFills($)]);
    const request = {
      text: e.props.text,
      width,
      isFirstOfReply: e.props.isFirstOfReply,
      surface: e.surface,
      accent,
      fills,
    };
    return replyView($.ui.resolve(e), request, copy) ?? next(e);
  });

  on("ui.render", { component: "ToolGroup" }, ($, e, next) => {
    if (!isTerminal(e)) return next(e);
    if (e.props.isExpanded) {
      e.props.calls.forEach((call) => call.tool_use_id && expandedCalls.add(call.tool_use_id));
      return next(e);
    }
    return toolRow(
      $,
      e,
      e.props.calls.map((call) => call.tool_use_id),
      { calls: e.props.calls, isActive: e.props.isActive, elapsedMs: null },
    );
  });

  on("ui.render", { component: "ToolUse" }, ($, e, next) => {
    if (!isTerminal(e)) return next(e);
    if (expandedCalls.has(e.props.tool_use_id)) return drawWithChanges($, e, next);
    return toolRow($, e, [e.props.tool_use_id], {
      calls: [e.props],
      isActive: e.props.isRunning,
      elapsedMs: null,
    });
  });

  on("ui.render", { component: "ToolResult" }, ($, e, next) =>
    isTerminal(e) ? drawWithChanges($, e, next) : next(e),
  );

  on("ui.render", { component: "TurnDuration" }, async ($, e, next) => {
    if (!isTerminal(e)) return next(e);
    const [stats, fills] = await Promise.all([
      read($, memberOf(turnStatsAtom, { requestId: String(e.props.durationMs) })),
      currentFills($),
    ]);
    return footerRow(
      $.ui.resolve(e),
      e.props.durationMs,
      stats ?? undefined,
      layoutOf(columnsOf(e)),
      fills,
    );
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (!isTerminal(e)) return next(e);
    if (e.props.hasSurvey) return next(e);
    const [theirs, usage, info, home, color, nowMs] = await Promise.all([
      next(e),
      read($, usageAtom),
      read($, promptInfoAtom),
      $.env.get("HOME"),
      read($, sessionColorAtom),
      $.clock.now(),
    ]);
    const meters = metersOf(usage, nowMs);
    const ui = $.ui.resolve(e);
    const { Box } = ui;
    return (
      <Box flexDirection="column">
        {e.props.maxRows >= BAND_ROWS_WITH_SPACER ? <Box height={1} /> : null}
        {theirs}
        {promptInfoRow(ui, info, home, columnsOf(e), color, meters, () => openModelPicker($))}
      </Box>
    );
  });
}
