import { atom, read, update } from "claude-code";
import type { ElementTable, EngineInterface, On, RenderElement } from "claude-code";

import { failureText } from "./command-failure";
import { drawDiagram } from "./diagram";
import { diagramPanel, listPanel, PANEL_PADDING_X } from "./diagram-paint";
import type { DiagramLook } from "./diagram-paint";
import { button } from "./pane-kit";
import { palette } from "./palette";
import { PANE, PANE_OPEN } from "./pane-tab";
import { accentOf } from "./session-color";
import { notePaneTheme, paneInk } from "./pane-ink";
import { noteShownTab } from "./shown-tab";
import { TAB_BAR_ROWS, tabBar } from "./tab-bar";
import { TABS } from "./tabs";

const BODY_PADDING = 1;
const NATURAL_COLUMNS = 1000;
const PANEL_ROWS = 2;
const BACK_ROWS = 1;
const FIRST_FRAME_BUDGET_MS = 100;
const BUDGET_ELAPSED = Symbol("budget elapsed");

const sessionColorAtom = atom({ plugin: "paneline", key: "sessionColor" } as const, "default");
const tabAtom = atom({ plugin: "paneline", key: "tab" } as const, "activity");
const themeAtom = atom({ plugin: "paneline", key: "theme" } as const, "dark");
const openDiagramAtom = atom(
  { plugin: "paneline", key: "openDiagram" } as const,
  null as string | null,
);
const bodyOffsetAtom = atom({ plugin: "paneline", key: "bodyOffset" } as const, 0);

type DrawnBody = { tab: string; body: RenderElement; offset: number };

type PendingBody = { tab: string; body: Promise<RenderElement>; stale: boolean };

type ReadyBody = { tab: string; body: RenderElement; stale: boolean };

type MeasuredCue = { tree: string; offset: number; below: number };

type PaneFrame = {
  ui: ElementTable;
  width: number;
  bodyRows: number;
  scrollOffset: number;
  accent: string;
  onPress: (id: string) => void;
};

let knownTab = "";
let readTab = "";
let drawnBody: DrawnBody | null = null;
let pendingBody: PendingBody | null = null;
let readyBody: ReadyBody | null = null;
let pressBudget: Promise<typeof BUDGET_ELAPSED> | null = null;
let cue: MeasuredCue | null = null;

type Shape = { type?: unknown; props?: Record<string, unknown>; children?: unknown };

const ONE_ROW = "one row";
const EMPTY_TEXT = "empty text";
const NO_ROW_EFFECT = new Set(["press", "key", "color"]);
const rowTokens = new WeakSet<object>();

function isTruncatingText(node: unknown): boolean {
  const { type, props } = (node ?? {}) as Shape;
  return type === "Text" && typeof props?.wrap === "string" && props.wrap.startsWith("truncate");
}

function isOneRowBox(node: unknown): boolean {
  const { type, props } = (node ?? {}) as Shape;
  return type === "Box" && props?.height === 1;
}

function oneRowWords(children: unknown): string[] | null {
  const words: string[] = [];
  for (const child of Array.isArray(children) ? children : [children]) {
    if (typeof child === "string" && !child.includes("\n")) words.push(child);
    else {
      const nested = isTruncatingText(child) ? oneRowWords((child as Shape).children) : null;
      if (nested === null) return null;
      words.push(...nested);
    }
  }
  return words;
}

function withoutNoRowEffect(fields: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([name]) => !NO_ROW_EFFECT.has(name)));
}

function oneRowToken(node: object): Shape | null {
  if (!isOneRowBox(node) && !isTruncatingText(node)) return null;
  const words = isOneRowBox(node) ? [ONE_ROW] : oneRowWords((node as Shape).children);
  if (words === null) return null;
  const children = words.some((word) => word !== "") ? ONE_ROW : EMPTY_TEXT;
  const { type, props } = node as Shape;
  const token = { type, props: withoutNoRowEffect(props ?? {}), children };
  rowTokens.add(token);
  return token;
}

function sortRowRuns(items: unknown[]): unknown[] {
  const sorted: unknown[] = [];
  let run: object[] = [];
  const flushRun = (): void => {
    sorted.push(...run.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    run = [];
  };
  for (const item of items) {
    if (typeof item === "object" && item !== null && rowTokens.has(item)) run.push(item);
    else {
      flushRun();
      sorted.push(item);
    }
  }
  flushRun();
  return sorted;
}

function shapeOf(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(shapeOf);
  if (typeof node !== "object" || node === null) return node;
  const token = oneRowToken(node);
  if (token !== null) return token;
  const shaped = Object.fromEntries(
    Object.entries(withoutNoRowEffect(node)).map(([name, value]) => [name, shapeOf(value)]),
  );
  const isColumn = (node as Shape).props?.flexDirection === "column";
  if (!isColumn || !Array.isArray(shaped.children)) return shaped;
  return { ...shaped, children: sortRowRuns(shaped.children) };
}

function treeOf(tab: string, body: RenderElement): string {
  return `${tab}\n${JSON.stringify(shapeOf(body))}`;
}

function cueBelow(tab: string, body: RenderElement | null, offset: number): number {
  if (cue === null || body === null || cue.offset !== offset) return 0;
  return cue.tree === treeOf(tab, body) ? cue.below : 0;
}

function redrawCue($: EngineInterface): void {
  if (drawnBody !== null) readyBody = { tab: drawnBody.tab, body: drawnBody.body, stale: false };
  $.ui.invalidate("ui.render");
}

function isPageStep(e: { by: number; bodyRows: number; origin: { kind: string } }): boolean {
  return e.origin.kind === "person" && Math.abs(e.by) === e.bodyRows;
}

export function registerSessionPane(on: On): void {
  on("ui.scroll", { requestId: PANE }, async ($, e) => {
    const offset = await read($, bodyOffsetAtom);
    const by = isPageStep(e) ? Math.sign(e.by) * Math.max(1, e.bodyRows - TAB_BAR_ROWS - 1) : e.by;
    const spare = offset > 0 ? 2 * e.bodyRows : e.bodyRows;
    const furthest = Math.max(0, e.contentRows - spare);
    const clamped = Math.min(furthest, Math.max(0, offset + by));
    const below = furthest - clamped;
    const drawn = drawnBody;
    const cueChanged = below !== cueBelow(drawn?.tab ?? "", drawn?.body ?? null, offset);
    cue =
      drawn === null || below === 0
        ? null
        : { tree: treeOf(drawn.tab, drawn.body), offset: clamped, below };
    if (clamped !== offset) await update($, bodyOffsetAtom, () => clamped);
    else if (cueChanged) redrawCue($);
    return {};
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e, next) => {
    const width = e.props.bodyColumns;
    const [bodyOffset, tab, theme, color, diagramSource] = await Promise.all([
      read($, bodyOffsetAtom),
      read($, tabAtom),
      read($, themeAtom),
      read($, sessionColorAtom),
      read($, openDiagramAtom),
    ]);
    if (tab !== readTab) knownTab = tab;
    readTab = tab;
    const pane: PaneFrame = {
      ui: $.ui.resolve(e),
      width,
      bodyRows: e.props.scroll.bodyRows,
      scrollOffset: e.props.scroll.offset,
      accent: accentOf(color),
      onPress: (id) => pressTab($, id),
    };
    const { scroll } = e.props;
    const narrowed = {
      ...e,
      props: {
        ...e.props,
        bodyColumns: width - BODY_PADDING,
        scroll: { ...scroll, offset: scroll.offset + bodyOffset },
      },
    };
    const startBody = (): Promise<RenderElement> => {
      noteShownTab(tab);
      notePaneTheme(theme);
      const body = next(narrowed);
      body.catch(() => undefined);
      return body;
    };
    const ready = readyBody;
    readyBody = null;
    if (diagramSource !== null) {
      void startBody();
      const diagram = diagramView(pane.ui, diagramSource, width - BODY_PADDING, () => {
        void update($, openDiagramAtom, () => null);
        void update($, bodyOffsetAtom, () => 0);
      });
      return paneTree(pane, tab, diagram, bodyOffset);
    }
    if (ready?.tab === tab) {
      const answer = answerWithBody(pane, tab, ready.body, bodyOffset);
      if (ready.stale) $.ui.invalidate("ui.render");
      return answer;
    }
    const drawn = drawnBody;
    if (drawn === null || drawn.tab === tab) {
      return answerWithBody(pane, tab, await startBody(), bodyOffset);
    }
    if (pendingBody?.tab === tab) {
      pendingBody.stale = true;
      return paneTree(pane, knownTab, drawn.body, drawn.offset);
    }
    const pending: PendingBody = { tab, body: startBody(), stale: false };
    pendingBody = pending;
    const outcome = await Promise.race([pending.body, pressBudget ?? budgetElapsed($)]).catch(
      (error: unknown) => {
        releasePendingBody(pending);
        throw error;
      },
    );
    if (outcome === BUDGET_ELAPSED) {
      void pending.body.then(
        (body) => settleTabSwitch($, pending, body),
        () => failPendingBody($, pending),
      );
      return paneTree(pane, knownTab, drawn.body, drawn.offset);
    }
    releasePendingBody(pending);
    if (pending.stale) $.ui.invalidate("ui.render");
    return answerWithBody(pane, tab, outcome, bodyOffset);
  });
}

function budgetElapsed($: EngineInterface): Promise<typeof BUDGET_ELAPSED> {
  return new Promise((resolve) => {
    $.clock.after(FIRST_FRAME_BUDGET_MS, () => resolve(BUDGET_ELAPSED));
  });
}

function settleTabSwitch($: EngineInterface, pending: PendingBody, body: RenderElement): void {
  if (pendingBody !== pending) return;
  pendingBody = null;
  if (knownTab !== pending.tab) return;
  readyBody = { tab: pending.tab, body, stale: pending.stale };
  $.ui.invalidate("ui.render");
}

function failPendingBody($: EngineInterface, pending: PendingBody): void {
  if (pendingBody !== pending) return;
  pendingBody = null;
  if (knownTab !== pending.tab) return;
  drawnBody = null;
  $.ui.invalidate("ui.render");
}

function releasePendingBody(pending: PendingBody): void {
  if (pendingBody === pending) pendingBody = null;
}

function answerWithBody(
  pane: PaneFrame,
  tab: string,
  body: RenderElement,
  bodyOffset: number,
): RenderElement {
  if (knownTab !== tab) {
    const last = drawnBody;
    return paneTree(pane, knownTab, last?.body ?? null, last?.offset ?? 0);
  }
  drawnBody = { tab, body, offset: bodyOffset };
  pressBudget = null;
  return paneTree(pane, tab, body, bodyOffset);
}

function pressTab($: EngineInterface, id: string): void {
  knownTab = id;
  pressBudget = budgetElapsed($);
  void update($, tabAtom, () => id);
  void update($, openDiagramAtom, () => null);
  void update($, bodyOffsetAtom, () => 0);
}

function paneTree(
  pane: PaneFrame,
  tab: string,
  body: RenderElement | null,
  bodyOffset: number,
): RenderElement {
  const { ui, width, bodyRows, scrollOffset, accent } = pane;
  const { Box, Text } = ui;
  const { fill, muted } = paneInk();
  const hiddenBelow = cueBelow(tab, body, bodyOffset);
  return (
    <Box
      flexDirection="column"
      width={width}
      minHeight={fill === undefined ? undefined : bodyRows}
      backgroundColor={fill}
    >
      {tabBar(ui, TABS, tab, pane.onPress, width, accent)}
      <Box paddingLeft={BODY_PADDING} width={width} overflow="hidden">
        <Box flexDirection="column" width={width - BODY_PADDING} marginTop={-bodyOffset}>
          {body}
        </Box>
      </Box>
      {bodyOffset > 0 ? <Box height={bodyOffset + bodyRows} /> : null}
      {hiddenBelow > 0 ? (
        <Box
          position="absolute"
          top={scrollOffset + bodyRows - 1}
          left={BODY_PADDING}
          width={width - BODY_PADDING}
          height={1}
          backgroundColor={palette.panel}
        >
          <Text color={muted} wrap="truncate-end">
            {`… ${hiddenBelow + 1} more lines`.padEnd(width - BODY_PADDING)}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

export function registerSessionCommand(on: On, autoOpen: boolean): void {
  on("session.start", { isInteractive: true }, async ($, e, next) => {
    await $.command.register({ name: "paneline", description: "Open the Session side pane" });
    if (autoOpen) void openPane($);
    return next(e);
  });

  on("classic.SessionStart", { source: ["clear", "resume", "fork"] }, async ($, e, next) => {
    if (autoOpen) void openPane($);
    return next(e);
  });

  on("command.run", { command: "paneline" }, async ($) => {
    try {
      await update($, tabAtom, () => TABS[0].id);
      await update($, bodyOffsetAtom, () => 0);
      await openPane($);
      return {};
    } catch (error) {
      const text = failureText(error);
      $.ui.log(text, { to: "debug" });
      return { text };
    }
  });
}

export function diagramPaneSize(source: string): { columns?: number; rows?: number } {
  const lines = diagramLines(source);
  if (lines.length === 0) return {};
  const widest = Math.max(...lines.map((line) => [...line].length));
  return {
    columns: widest + 2 * PANEL_PADDING_X + BODY_PADDING,
    rows: lines.length + PANEL_ROWS + BACK_ROWS + TAB_BAR_ROWS,
  };
}

function diagramLines(source: string): string[] {
  const diagram = drawDiagram(source, NATURAL_COLUMNS);
  if (diagram.kind === "art") return diagram.art.split("\n");
  return diagram.kind === "list" ? diagram.lines : [];
}

function diagramView(
  ui: ElementTable,
  source: string,
  width: number,
  back: () => void,
): RenderElement {
  const { Box, Text } = ui;
  const ink = paneInk();
  const look: DiagramLook = {
    accent: ink.text,
    strong: ink.text,
    prose: ink.text,
    muted: ink.muted,
    rule: ink.rule,
    hues: ink.hues,
  };
  const diagram = drawDiagram(source, width);
  return (
    <Box key="diagram" flexDirection="column" width={width}>
      <Box height={1}>{button(ui, { key: "back", label: "back", onPress: back })}</Box>
      {diagram.kind === "art" ? diagramPanel(ui, diagram.art, look, "art") : null}
      {diagram.kind === "list" ? listPanel(ui, diagram.lines, look, "list") : null}
      {diagram.kind === "failed" ? (
        <Text
          color={ink.muted}
          wrap="truncate-end"
        >{`diagram could not be drawn: ${diagram.reason}`}</Text>
      ) : null}
    </Box>
  );
}

async function openPane($: EngineInterface): Promise<void> {
  await update($, openDiagramAtom, () => null);
  await $.ui.open(PANE_OPEN);
}
