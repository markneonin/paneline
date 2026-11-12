import { atom, update } from "claude-code";
import type { ApiContentBlock, EngineInterface, On } from "claude-code";

import type { HistoryEntry, TranscriptState } from "../types";
import { commandLine } from "./command-line";
import { transcriptRows } from "./history-search";
import { noteShownText, refreshHistoryCosts } from "./history-tab";
import { isTypedOrigin } from "./typed-origin";

const historyAtom = atom({ plugin: "paneline", key: "history" } as const, [] as HistoryEntry[]);
const transcriptPathAtom = atom({ plugin: "paneline", key: "transcriptPath" } as const, "");
const transcriptStateAtom = atom(
  { plugin: "paneline", key: "historyTranscript" } as const,
  "read" as TranscriptState,
);
const SLASH_COMMAND_LINE = /^\/[^\s/]+(\s|$)/;
const ABSORBED_PROMPT = /while you were working:\n([\s\S]*?)\n+This is how Claude Code surfaces/;

let readGeneration = 0;

export function trackHistory(on: On): void {
  on(
    "session.append",
    { door: ["prompt", "command", "response", "note", "delivery"] },
    async ($, e, next) => {
      const joined = textOf(e.message.content);
      const text =
        e.door === "command"
          ? commandLine(joined)
          : (e.door === "delivery" && ABSORBED_PROMPT.exec(joined)?.[1]?.trim()) || joined;
      if (e.agentId === undefined && text !== "" && isRecorded(e.door, e.origin, text)) {
        const at = await $.clock.now();
        const entry: HistoryEntry = {
          kind: e.door === "response" ? "reply" : "prompt",
          id: e.uuid,
          at,
          ...(e.door === "delivery" && { absorbed: true as const }),
        };
        noteShownText(entry.id, text);
        await update($, historyAtom, (entries) => [...entries, entry]);
      }
      return next(e);
    },
  );

  on("classic.SessionStart", { source: "clear" }, async ($, e, next) => {
    readGeneration += 1;
    await update($, historyAtom, () => []);
    await update($, transcriptStateAtom, () => "read");
    return next(e);
  });

  on("classic.SessionStart", { source: ["resume", "fork"] }, async ($, e, next) => {
    readGeneration += 1;
    await update($, historyAtom, () => []);
    await update($, transcriptPathAtom, () => e.transcript_path);
    await update($, transcriptStateAtom, () => "reading");
    const started = await next(e);
    void loadPast($, e.transcript_path, readGeneration);
    return started;
  });
}

async function loadPast($: EngineInterface, path: string, generation: number): Promise<void> {
  const past = await pastEntriesOf($, path);
  if (generation !== readGeneration) return;
  if (past === null) {
    await update($, transcriptStateAtom, () => "unreadable");
    return;
  }
  const pastIds = new Set(past.map((entry) => entry.id));
  await update($, historyAtom, (meanwhile) => [
    ...past,
    ...meanwhile.filter((entry) => !pastIds.has(entry.id)),
  ]);
  await update($, transcriptStateAtom, () => "read");
  void refreshHistoryCosts($);
}

async function pastEntriesOf($: EngineInterface, path: string): Promise<HistoryEntry[] | null> {
  const past: HistoryEntry[] = [];
  try {
    for await (const { kind, id, at, absorbed } of transcriptRows($, path))
      past.push({ kind, id, at, ...(absorbed && { absorbed }) });
  } catch {
    return null;
  }
  return past;
}

export type TurnStats = { tools: number; failed: number; ms?: number };

export async function recordTurnStats($: EngineInterface, turn: TurnStats): Promise<void> {
  await update($, historyAtom, (entries) =>
    withLastPrompt(entries, (entry) => ({
      ...entry,
      tools: (entry.tools ?? 0) + turn.tools,
      failed: (entry.failed ?? 0) + turn.failed,
      ...(turn.ms !== undefined && { ms: (entry.ms ?? 0) + turn.ms }),
    })),
  );
}

function withLastPrompt(
  entries: HistoryEntry[],
  change: (entry: HistoryEntry) => HistoryEntry,
): HistoryEntry[] {
  const index = entries.findLastIndex((entry) => entry.kind === "prompt" && !entry.absorbed);
  if (index < 0) return entries;
  return entries.map((entry, at) => (at === index ? change(entry) : entry));
}

function isRecorded(door: string, origin: { kind: string; asUser?: true }, text: string): boolean {
  if (door === "response") return true;
  if (origin.kind !== "engine") return door !== "note" && isTypedOrigin(origin);
  return door === "command" || (door === "note" && SLASH_COMMAND_LINE.test(text));
}

function textOf(content: ApiContentBlock[]): string {
  return content
    .flatMap((block) => (block.type === "text" ? [String(block.text)] : []))
    .join("\n")
    .trim();
}
