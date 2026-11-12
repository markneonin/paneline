import { atom, memberOf, read, update } from "claude-code";
import type {
  EngineInterface,
  On,
  RenderElement,
  ResolveInput,
  UiPressArgument,
} from "claude-code";

import type { GitChange, UsageSnap, PromptInfo, RunningCall } from "../types";
import { detailOf } from "./activity-calls";
import { UNMEASURED_MS, showCall } from "./activity-track";
import type { WaitingCall } from "./activity-track";
import {
  footerRow,
  layoutOf,
  stampedReplyRow,
  stampedUserRow,
  toolGroupRow,
  userBlock,
} from "./chat-draw";
import type { ToolGroupView } from "./chat-draw";
import { bashChangesOf, bashNotes, diffPanel, fileChangeOf, toolPanel } from "./diff-panel";
import type { BashChanges, ToolPanelRequest } from "./diff-panel";
import { PROGRESS_TOOL } from "./tools";
import { openDiff, FILES_TAB } from "./files-tab";
import { replyView } from "./reply-draw";
import { resolvedAccent } from "./reply-look";
import type { ReplyActions } from "./reply-draw";
import type { OpenPath } from "./inline-draw";
import type { Accent } from "./pane-kit";
import { fillsFor } from "./palette";
import type { Fills } from "./palette";
import { notePaneTheme } from "./pane-ink";
import { metersOf, promptInfoRow } from "./prompt-info";
import { sessionStatusOf } from "./session-status";
import type { SessionStatus } from "./session-status";
import type { Progress } from "./prompt-info";
import { PANE_OPEN } from "./pane-tab";
import { accentOf } from "./session-color";
import { diagramPaneSize } from "./session-pane";
import { clockOf } from "./format";
import { TABS } from "./tabs";
import { TYPED } from "./typed-origin";
import { keepResetRedraw, reseedAfterCompact } from "./usage-track";
import { transcriptLines } from "./transcript-lines";

const DIFF_TOOLS = new Set(["Edit", "Write"]);
const PANEL_TOOLS = new Set(["Bash", "Read"]);
const MAX_PROMPT = 4000;
const MAX_REPLY_CHARS = 60_000;
const BAND_ROWS_WITH_SPACER = 2;
const UNKNOWN_AT = 0;
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
const openDiagramAtom = atom(
  { plugin: "paneline", key: "openDiagram" } as const,
  null as string | null,
);
const bodyOffsetAtom = atom({ plugin: "paneline", key: "bodyOffset" } as const, 0);
const toolMsAtom = atom({ plugin: "paneline", key: "toolMs" } as const, UNMEASURED_MS);
const deniedAtom = atom({ plugin: "paneline", key: "denied" } as const, false);
const turnStatsAtom = atom({ plugin: "paneline", key: "turnStats" } as const, null);
const progressAtom = atom(
  { plugin: "paneline", key: "progress" } as const,
  { tasks: {}, percent: null } as Progress,
);
const waitingAtom = atom({ plugin: "paneline", key: "waiting" } as const, [] as WaitingCall[]);
const mainTurnRunningAtom = atom({ plugin: "paneline", key: "mainTurnRunning" } as const, false);
const runningAtom = atom({ plugin: "paneline", key: "running" } as const, [] as RunningCall[]);
const tabAtom = atom({ plugin: "paneline", key: "tab" } as const, "activity");
const messageAtAtom = atom({ plugin: "paneline", key: "messageAt" } as const, UNKNOWN_AT);
const messageSearchedAtom = atom({ plugin: "paneline", key: "messageSearched" } as const, false);
const transcriptPathAtom = atom({ plugin: "paneline", key: "transcriptPath" } as const, "");
const gitChangesAtom = atom({ plugin: "paneline", key: "gitChanges" } as const, [] as GitChange[]);

type RenderEvent = { surface: string; viewport?: { columns: number } };

async function elapsedOf($: EngineInterface, ids: (string | undefined)[]): Promise<number | null> {
  const known = ids.filter((id): id is string => id !== undefined && id !== "");
  const measured = (
    await Promise.all(known.map((id) => read($, memberOf(toolMsAtom, { requestId: id }))))
  ).filter((ms) => ms !== UNMEASURED_MS);
  return measured.length === 0 ? null : measured.reduce((sum, ms) => sum + ms, 0);
}

type TimedRow = { uuid: string; at: number };

const pendingTimeIds = new Set<string>();
let isTimeSearchScheduled = false;

function timedRowOf(line: string): TimedRow | null {
  try {
    const { type, uuid, timestamp } = JSON.parse(line) as {
      type?: unknown;
      uuid?: unknown;
      timestamp?: unknown;
    };
    if (type !== "user" && type !== "assistant") return null;
    const at = typeof timestamp === "string" ? Date.parse(timestamp) : Number.NaN;
    return typeof uuid === "string" && !Number.isNaN(at) ? { uuid, at } : null;
  } catch {
    return null;
  }
}

async function timesOf(
  $: EngineInterface,
  transcriptPath: string,
  uuids: ReadonlySet<string>,
): Promise<TimedRow[]> {
  try {
    const rows: TimedRow[] = [];
    for await (const line of transcriptLines($, transcriptPath, [...uuids])) {
      const row = timedRowOf(line);
      if (row !== null && uuids.has(row.uuid)) rows.push(row);
    }
    return rows;
  } catch {
    return [];
  }
}

async function searchPendingTimes($: EngineInterface): Promise<void> {
  const uuids = new Set(pendingTimeIds);
  pendingTimeIds.clear();
  isTimeSearchScheduled = false;
  await Promise.all(
    [...uuids].map((uuid) =>
      update($, memberOf(messageSearchedAtom, { requestId: uuid }), () => true),
    ),
  );
  const rows = await timesOf($, await read($, transcriptPathAtom), uuids);
  await Promise.all(
    rows.map(({ uuid, at }) => update($, memberOf(messageAtAtom, { requestId: uuid }), () => at)),
  );
}

function requestTimes($: EngineInterface, uuid: string): void {
  pendingTimeIds.add(uuid);
  if (isTimeSearchScheduled) return;
  isTimeSearchScheduled = true;
  $.clock.after(0, () => void searchPendingTimes($));
}

async function stampOf($: EngineInterface, requestId: string): Promise<string> {
  const [at, isSearched] = await Promise.all([
    read($, memberOf(messageAtAtom, { requestId })),
    read($, memberOf(messageSearchedAtom, { requestId })),
  ]);
  if (at !== UNKNOWN_AT) return clockOf(at);
  if (!isSearched) requestTimes($, requestId);
  return "";
}

async function currentAccent($: EngineInterface): Promise<Accent> {
  return accentOf(await read($, sessionColorAtom));
}

async function currentFills($: EngineInterface): Promise<Fills> {
  return fillsFor(await read($, themeAtom));
}

async function openSessionPane($: EngineInterface, tab: string = TABS[0].id): Promise<void> {
  await update($, tabAtom, () => tab);
  await update($, openDiagramAtom, () => null);
  await update($, bodyOffsetAtom, () => 0);
  await $.ui.open(PANE_OPEN);
}

async function showDetails($: EngineInterface, callId: string | undefined): Promise<void> {
  if (callId !== undefined) await showCall($, callId);
  await openSessionPane($);
}

async function openDiagramPane($: EngineInterface, source: string): Promise<void> {
  await update($, openDiagramAtom, () => source);
  await update($, bodyOffsetAtom, () => 0);
  await $.ui.open({ ...PANE_OPEN, ...diagramPaneSize(source) });
}

function absolutePath(path: string, cwd: string, home: string | undefined): string {
  const full = joinedPath(path, cwd, home);
  const parts: string[] = [];
  for (const part of full.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function joinedPath(path: string, cwd: string, home: string | undefined): string {
  if (path.startsWith("~/")) return `${home ?? ""}${path.slice(1)}`;
  return path.startsWith("/") ? path : `${cwd}/${path}`;
}

async function openFileDiff($: EngineInterface, path: string): Promise<void> {
  const [{ cwd }, home, changes] = await Promise.all([
    read($, promptInfoAtom),
    $.env.get("HOME"),
    read($, gitChangesAtom),
  ]);
  await openDiff($, absolutePath(path, cwd, home), changes);
  await openSessionPane($, FILES_TAB.id);
}

async function toolRow(
  $: EngineInterface,
  e: ResolveInput & RenderEvent,
  ids: (string | undefined)[],
  view: Omit<ToolGroupView, "accent" | "fills">,
  firstCallId: string | undefined,
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
    () => void showDetails($, firstCallId),
  );
}

type FinishedCall = {
  tool_use_id: string;
  tool: string;
  output?: unknown;
  isErrored: boolean;
  isExpanded?: boolean;
};
type CallEvent = ResolveInput & RenderEvent & { props: FinishedCall };
type Draw<E> = (e: E) => RenderElement | Promise<RenderElement>;
type PanelCall = Pick<FinishedCall, "tool" | "output" | "isErrored">;
type Scene = Pick<ToolPanelRequest, "cwd" | "home" | "width" | "accent" | "fills">;

async function withDenial<T extends { tool_use_id?: string; isErrored: boolean }>(
  $: EngineInterface,
  call: T,
): Promise<T & { isDenied: boolean }> {
  const isDenied =
    call.isErrored && call.tool_use_id !== undefined
      ? await read($, memberOf(deniedAtom, { requestId: call.tool_use_id }))
      : false;
  return { ...call, isDenied };
}

async function drawWithChanges<E extends CallEvent>(
  $: EngineInterface,
  e: E,
  next: Draw<E>,
  command: string | undefined,
): Promise<RenderElement> {
  const call = await withDenial($, e.props);
  const detail = panelDetailOf(call, command);
  const changes = call.isErrored ? null : changesOf(call);
  if (detail === undefined && (changes === null || call.tool === "Bash")) return next(e);
  const scene = await sceneOf($, e);
  const ui = $.ui.resolve(e);
  const windows =
    changes?.changes.map((change) =>
      diffPanel(ui, { toolUseId: call.tool_use_id, change, ...scene }),
    ) ?? [];
  if (detail === undefined) return windows[0] ?? next(e);
  const { Box } = ui;
  return (
    <Box flexDirection="column">
      {toolPanel(ui, {
        toolUseId: call.tool_use_id,
        detail,
        ...scene,
        isExpanded: call.isExpanded === true,
        isDenied: call.isDenied,
      })}
      {windows}
      {changes === null ? null : bashNotes(ui, changes)}
    </Box>
  );
}

async function sceneOf($: EngineInterface, e: ResolveInput & RenderEvent): Promise<Scene> {
  const [{ cwd }, home, accent, fills] = await Promise.all([
    read($, promptInfoAtom),
    $.env.get("HOME"),
    currentAccent($),
    currentFills($),
  ]);
  return { cwd, home, accent, fills, width: layoutOf(columnsOf(e)).width };
}

function panelDetailOf(
  { tool, output, isErrored }: PanelCall,
  command: string | undefined,
): ToolPanelRequest["detail"] | undefined {
  if (!PANEL_TOOLS.has(tool) || (output as { isImage?: unknown } | null)?.isImage === true)
    return undefined;
  const detail = detailOf({ tool, command }, { result: output, isError: isErrored });
  return detail?.kind === "bash" || detail?.kind === "read" ? detail : undefined;
}

function commandOf(input: unknown): string | undefined {
  const command = (input as { command?: unknown } | null)?.command;
  return typeof command === "string" ? command : undefined;
}

function changesOf({ tool, output }: FinishedCall): BashChanges | null {
  if (tool === "Bash") return bashChangesOf(output);
  const change = DIFF_TOOLS.has(tool) ? fileChangeOf(output) : null;
  return change === null ? null : { changes: [change], moreFiles: 0, isShared: false };
}

function hiddenRow($: EngineInterface, e: ResolveInput): RenderElement {
  const { Box } = $.ui.resolve(e);
  return <Box height={0} />;
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

async function sessionStatus($: EngineInterface): Promise<SessionStatus> {
  const [isTurnRunning, running, waiting] = await Promise.all([
    read($, mainTurnRunningAtom),
    read($, runningAtom),
    read($, waitingAtom),
  ]);
  return sessionStatusOf(isTurnRunning, running, waiting);
}

export function renderChat(on: On): void {
  on("prompt.compose", async ($, e, next) => {
    const composed = await next(e);
    return { sections: [...composed.sections, RENDER_HINT_SECTION] };
  });

  on("session.append", { door: ["prompt", "response"] }, async ($, e, next) => {
    const at = await $.clock.now();
    await update($, memberOf(messageAtAtom, { requestId: e.uuid }), () => at);
    return next(e);
  });

  const expandedCalls = new Set<string>();
  let copyWithLatest: Copy = () => {};

  let openPathWithLatest: OpenPath = () => {};

  const copy: Copy = (text, press) => copyWithLatest(text, press);
  const actions: ReplyActions = { copy, open: (path) => openPathWithLatest(path) };

  let openWithLatest: (source: string) => void = () => {};

  const openDiagram = (source: string) => openWithLatest(source);

  on("ui.render", { component: "UserMessage" }, async ($, e, next) => {
    const [stamp, fills] = await Promise.all([stampOf($, e.requestId), currentFills($)]);
    const isTyped = TYPED.has(e.props.origin.kind);
    const isDrawnHere = !e.props.isExpanded && isTyped && e.props.text.length <= MAX_PROMPT;
    if (!isDrawnHere)
      return !isTyped || stamp === ""
        ? next(e)
        : stampedUserRow($.ui.resolve(e), await next(e), layoutOf(columnsOf(e)), fills, stamp);
    return userBlock($.ui.resolve(e), e.props.text, layoutOf(columnsOf(e)), fills, stamp);
  });

  on("ui.render", { component: "AssistantMessage" }, async ($, e, next) => {
    if (e.props.text.length > MAX_REPLY_CHARS) {
      const stamp = e.props.isFirstOfReply ? await stampOf($, e.requestId) : "";
      if (stamp === "") return next(e);
      const [accent, fills] = await Promise.all([currentAccent($), currentFills($)]);
      const headerAccent = resolvedAccent(accent, fills);
      return stampedReplyRow(
        $.ui.resolve(e),
        await next(e),
        layoutOf(columnsOf(e)),
        headerAccent,
        stamp,
      );
    }
    copyWithLatest = (text, press) => {
      void $.ui
        .copy({ text, surface: press.surface })
        .then((result) => result.isCopied)
        .catch(() => false)
        .then((isCopied) => $.ui.toast(isCopied ? "Copied" : "Could not copy here"));
    };
    openWithLatest = (source) => void openDiagramPane($, source);
    openPathWithLatest = (path) => void openFileDiff($, path);
    const { width } = layoutOf(columnsOf(e));
    const [accent, fills, stamp] = await Promise.all([
      currentAccent($),
      currentFills($),
      e.props.isFirstOfReply ? stampOf($, e.requestId) : "",
    ]);
    const request = {
      stamp,
      text: e.props.text,
      width,
      isFirstOfReply: e.props.isFirstOfReply,
      surface: e.surface,
      accent,
      fills,
    };
    return replyView($.ui.resolve(e), request, { ...actions, openDiagram }) ?? next(e);
  });

  on("ui.render", { component: "ToolGroup" }, async ($, e, next) => {
    if (e.props.isExpanded) {
      e.props.calls.forEach((call) => call.tool_use_id && expandedCalls.add(call.tool_use_id));
      return next(e);
    }
    const calls = await Promise.all(
      e.props.calls
        .filter((call) => call.tool !== PROGRESS_TOOL)
        .map((call) => withDenial($, call)),
    );
    if (calls.length === 0) return hiddenRow($, e);
    return toolRow(
      $,
      e,
      calls.map((call) => call.tool_use_id),
      { calls, isActive: e.props.isActive, elapsedMs: null },
      calls[0]?.tool_use_id,
    );
  });

  on("ui.render", { component: "ToolUse" }, async ($, e, next) => {
    if (e.props.tool === PROGRESS_TOOL) return hiddenRow($, e);
    const command = commandOf(e.props.input);
    if (expandedCalls.has(e.props.tool_use_id)) return drawWithChanges($, e, next, command);
    const call = await withDenial($, e.props);
    const row = await toolRow(
      $,
      e,
      [e.props.tool_use_id],
      { calls: [call], isActive: e.props.isRunning, elapsedMs: null },
      e.props.tool_use_id,
    );
    const isBashPanelShown =
      e.props.isExpanded === true &&
      e.props.tool === "Bash" &&
      panelDetailOf(call, command) !== undefined;
    if (!isBashPanelShown) return row;
    const panel = await drawWithChanges($, e, next, command);
    const { Box } = $.ui.resolve(e);
    return (
      <Box flexDirection="column">
        {row}
        {panel}
      </Box>
    );
  });

  on("ui.render", { component: "ToolResult" }, ($, e, next) => {
    if (e.props.tool === PROGRESS_TOOL || e.props.isExpanded !== true) return hiddenRow($, e);
    const isDrawnByCallRow =
      e.props.tool === "Bash" && panelDetailOf(e.props, undefined) !== undefined;
    return isDrawnByCallRow ? hiddenRow($, e) : drawWithChanges($, e, next, undefined);
  });

  on("ui.render", { component: "TurnDuration" }, async ($, e) => {
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
    if (e.props.hasSurvey) return next(e);
    reseedAfterCompact($);
    const [theirs, usage, info, home, color, nowMs, progress, status, theme] = await Promise.all([
      next(e),
      read($, usageAtom),
      read($, promptInfoAtom),
      $.env.get("HOME"),
      read($, sessionColorAtom),
      $.clock.now(),
      read($, progressAtom),
      sessionStatus($),
      read($, themeAtom),
    ]);
    notePaneTheme(theme);
    const fills = fillsFor(theme);
    keepResetRedraw($, usage.limits, nowMs);
    const meters = metersOf(usage, nowMs, progress);
    const ui = $.ui.resolve(e);
    const { Box } = ui;
    return (
      <Box flexDirection="column">
        {e.props.maxRows >= BAND_ROWS_WITH_SPACER ? <Box height={1} /> : null}
        {theirs}
        {promptInfoRow(ui, info, home, columnsOf(e), color, meters, status, fills)}
      </Box>
    );
  });
}
