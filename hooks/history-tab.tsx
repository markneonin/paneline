import { atom, read, update } from "claude-code";
import type { EngineInterface, On, UiPressArgument } from "claude-code";

import type { HistoryEntry, PastMatch, TranscriptState } from "../types";
import { costsOf, isCostProofRefused, refreshCosts } from "./history-cost";
import { historyTab } from "./history-draw";
import { focusFilter } from "./pane-kit";
import { searchPast, transcriptRows } from "./history-search";
import { keepPane, PANE } from "./pane-tab";
import { TURN_END_REASONS } from "./spend-track";
import { isShownTab, justEntered, onTabLeft } from "./shown-tab";
import { TranscriptReadError } from "./transcript-lines";

export const HISTORY_TAB = { id: "history", label: "History" };

const historyAtom = atom({ plugin: "paneline", key: "history" } as const, [] as HistoryEntry[]);
const historyPastAtom = atom(
  { plugin: "paneline", key: "historyPast" } as const,
  null as PastMatch[] | null,
);
const historyTranscriptAtom = atom(
  { plugin: "paneline", key: "historyTranscript" } as const,
  "read" as TranscriptState,
);
const historyFilterAtom = atom({ plugin: "paneline", key: "historyFilter" } as const, "");
const transcriptPathAtom = atom({ plugin: "paneline", key: "transcriptPath" } as const, "");
const historySelectedAtom = atom({ plugin: "paneline", key: "historySelected" } as const, "");
const historyOpenRepliesAtom = atom(
  { plugin: "paneline", key: "historyOpenReplies" } as const,
  [] as string[],
);
const historyOpenProjectsAtom = atom(
  { plugin: "paneline", key: "historyOpenProjects" } as const,
  [] as string[],
);
const tabAtom = atom({ plugin: "paneline", key: "tab" } as const, "activity");

type HistoryText = { path: string; texts: Map<string, string> };

let historyText: HistoryText | undefined;

onTabLeft(HISTORY_TAB.id, () => {
  historyText = undefined;
});

export function noteShownText(id: string, text: string): void {
  historyText?.texts.set(id, text);
}

export function registerHistoryTab(on: On): void {
  on("ui.close", { id: PANE }, async ($, e, next) => {
    if (e.origin.kind !== "person" || (await read($, tabAtom)) !== HISTORY_TAB.id) return next(e);
    if ((await read($, historyFilterAtom)) === "") return next(e);
    await filterBy($, "");
    return keepPane($);
  });

  on("turn.complete", { reason: TURN_END_REASONS }, async ($, e, next) => {
    const result = await next(e);
    void refreshHistoryCosts($);
    return result;
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e, next) => {
    if (!isShownTab(HISTORY_TAB.id)) return next(e);
    if (justEntered(HISTORY_TAB.id) || isCostProofRefused()) void refreshHistoryCosts($);
    const [entries, filter, past, transcript, path, selected, openReplies, openProjects, cwd] =
      await Promise.all([
        read($, historyAtom),
        read($, historyFilterAtom),
        read($, historyPastAtom),
        read($, historyTranscriptAtom),
        read($, transcriptPathAtom),
        read($, historySelectedAtom),
        read($, historyOpenRepliesAtom),
        read($, historyOpenProjectsAtom),
        $.session.cwd(),
      ]);
    const texts = textsOf($, path);
    const now = await $.clock.now();
    const costs = costsOf(entries, now, path);
    return historyTab($.ui.resolve(e), {
      width: e.props.bodyColumns,
      entries,
      costs,
      texts,
      filter,
      past,
      cwd,
      selectPast: (id) =>
        void update($, historySelectedAtom, (current) => (current === id ? "" : id)),
      resume: (sessionId) => void resumeSession($, sessionId),
      copy: (text, press) => void copyResumeCommand($, text, press),
      transcript,
      setFilter: (text) => void filterBy($, text),
      focusFilter: () => void focusFilter($),
      jump: (id) => {
        void update($, historySelectedAtom, () => id);
        void $.ui.scroll({ to: { requestId: id }, block: "start" }).catch(() => undefined);
      },
      selected,
      openReplies,
      openProjects,
      toggleReplies: (id) =>
        void update($, historyOpenRepliesAtom, (open) =>
          open.includes(id) ? open.filter((one) => one !== id) : [...open, id],
        ),
      openProject: (project) =>
        void update($, historyOpenProjectsAtom, (open) =>
          open.includes(project) ? open : [...open, project],
        ),
    });
  });
}

export async function refreshHistoryCosts($: EngineInterface): Promise<void> {
  if (!isShownTab(HISTORY_TAB.id)) return;
  const entries = await read($, historyAtom);
  const path = await read($, transcriptPathAtom);
  if (entries.length === 0) return;
  await refreshCosts($, path, Math.min(...entries.map((entry) => entry.at)));
}

async function resumeSession($: EngineInterface, sessionId: string): Promise<void> {
  await $.clock.sleep(0);
  try {
    await $.command.run({ command: "resume", args: sessionId });
  } catch (error) {
    $.ui.toast(`Could not resume the session: ${String(error)}`);
  }
}

async function copyResumeCommand(
  $: EngineInterface,
  text: string,
  press: UiPressArgument,
): Promise<void> {
  const isCopied = await $.ui
    .copy({ text, surface: press.surface })
    .then((result) => result.isCopied)
    .catch(() => false);
  $.ui.toast(isCopied ? "Resume command copied" : "Could not copy the resume command");
}

async function filterBy($: EngineInterface, text: string): Promise<void> {
  await update($, historyFilterAtom, () => text);
  await searchPast($, text);
}

function textsOf($: EngineInterface, path: string): Map<string, string> {
  if (historyText?.path === path) return historyText.texts;
  const loading: HistoryText = { path, texts: new Map() };
  historyText = loading;
  if (path !== "") void loadTexts($, loading);
  return loading.texts;
}

async function loadTexts($: EngineInterface, loading: HistoryText): Promise<void> {
  try {
    for await (const row of transcriptRows($, loading.path)) loading.texts.set(row.id, row.text);
  } catch (error) {
    if (
      error instanceof TranscriptReadError &&
      error.isReaderError &&
      (await $.fs.stat(loading.path).catch(() => undefined)) === undefined
    )
      return;
    $.ui.toast(`History could not read the transcript: ${String(error)}`);
  }
  $.ui.invalidate("ui.render");
}
