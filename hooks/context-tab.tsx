import { atom, read, update } from "claude-code";
import type { EngineInterface, On } from "claude-code";

import type { UsageSnap } from "../types";

import { contextBreakdown, markContextStale } from "./breakdown";
import { compactionRow, emptyContextLog, wastedFrom, withCompaction } from "./context-log";
import type { WastedLine } from "./context-log";
import { contextTab } from "./context-draw";
import { PANE } from "./pane-tab";
import { isShownTab, justEntered } from "./shown-tab";
import { singleFlight } from "./single-flight";
import { emptySpend } from "./spend-model";

export const CONTEXT_TAB = { id: "context", label: "Context" };

const spendAtom = atom({ plugin: "paneline", key: "spend" } as const, emptySpend());
const contextLogAtom = atom({ plugin: "paneline", key: "contextLog" } as const, emptyContextLog());
const usageAtom = atom(
  { plugin: "paneline", key: "usage" } as const,
  { context: null, limits: [] } as UsageSnap,
);
const measureStampAtom = atom({ plugin: "paneline", key: "measureStamp" } as const, 0);
const mainTurnRunningAtom = atom({ plugin: "paneline", key: "mainTurnRunning" } as const, false);
const tabAtom = atom({ plugin: "paneline", key: "tab" } as const, "activity");
const bodyOffsetAtom = atom({ plugin: "paneline", key: "bodyOffset" } as const, 0);

const COMPACT_QUESTION = "Compact the conversation now?";
const COMPACT_HEADER = "Compact";
const COMPACT_ANSWER = "compact";
const CANCEL_ANSWER = "cancel";

const oneSessionRead = singleFlight();
let wastedRead: { mark: number; lines: WastedLine[] } | undefined;
let wastedMarks = 0;

export function registerContextTab(on: On): void {
  on("session.measure", { changed: ["context"] }, async ($, e, next) => {
    await contextChanged($);
    return next(e);
  });

  on(
    "classic.SessionStart",
    { source: ["startup", "resume", "clear", "compact", "fork"] },
    async ($, e, next) => {
      if (e.agent_id === undefined) markWastedStale();
      return next(e);
    },
  );

  on("classic.SessionStart", { source: "compact" }, async ($, e, next) => {
    if (e.agent_id === undefined) await contextChanged($);
    return next(e);
  });

  on("classic.PostCompact", async ($, e, next) => {
    markWastedStale();
    await contextChanged($);
    return next(e);
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e, next) => {
    if (!isShownTab(CONTEXT_TAB.id)) return next(e);
    if (justEntered(CONTEXT_TAB.id)) {
      markContextStale();
      markWastedStale();
    }
    const [context, spend, log, wasted, isMainTurnRunning, usage] = await Promise.all([
      contextBreakdown((args) => $.session.usage(args), e.props.bodyColumns),
      read($, spendAtom),
      read($, contextLogAtom),
      wastedLinesOf($),
      read($, mainTurnRunningAtom),
      read($, usageAtom),
      read($, measureStampAtom),
    ]);
    return contextTab($.ui.resolve(e), {
      context,
      autoCompact: usage.context,
      spend,
      log,
      wasted,
      isMainTurnRunning,
      width: e.props.bodyColumns,
      compact: () => void compactAfterConfirm($),
      showTab: (id) => void switchTab($, id),
    });
  });
}

function markWastedStale(): void {
  wastedMarks += 1;
}

async function wastedLinesOf($: EngineInterface): Promise<WastedLine[]> {
  if (wastedRead?.mark === wastedMarks) return wastedRead.lines;
  const mark = wastedMarks;
  const lines = await transcriptWasted($);
  wastedRead = { mark, lines };
  return lines;
}

async function transcriptWasted($: EngineInterface): Promise<WastedLine[]> {
  const messages = await oneSessionRead("wasted", () => $.session.messages()).catch(
    () => undefined,
  );
  if (!Array.isArray(messages)) return [];
  return wastedFrom(messages, await $.session.cwd());
}

async function switchTab($: EngineInterface, id: string): Promise<void> {
  await update($, tabAtom, () => id);
  await update($, bodyOffsetAtom, () => 0);
}

async function contextChanged($: EngineInterface): Promise<void> {
  if (!isShownTab(CONTEXT_TAB.id)) return;
  markContextStale();
  await update($, measureStampAtom, (stamp) => stamp + 1);
}

async function compactAfterConfirm($: EngineInterface): Promise<void> {
  const answer = await $.ui
    .ask(COMPACT_QUESTION, {
      options: [CANCEL_ANSWER, COMPACT_ANSWER],
      header: COMPACT_HEADER,
    })
    .catch(() => undefined);
  if (answer !== COMPACT_ANSWER) return;
  const compacted = await $.session.compact().catch(() => undefined);
  if (compacted !== undefined && compacted.skip === undefined) {
    const row = compactionRow(await $.clock.now(), compacted);
    await update($, contextLogAtom, (log) => withCompaction(log, row));
  }
  await contextChanged($);
}
