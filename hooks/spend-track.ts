import { atom, read, update } from "claude-code";
import type { EngineInterface, On, Timer } from "claude-code";

import { compactionRow, emptyContextLog, withCompaction } from "./context-log";
import { agentsStartedSince } from "./agents-track";
import {
  afterCompaction,
  emptySpend,
  freshSpend,
  PRICING_KEY,
  trackedTokens,
  trackedUsd,
  warmUntilOf,
  withLastTurn,
} from "./spend-model";
import type { TurnStart } from "./spend-model";
import { isTypedOrigin } from "./typed-origin";
import { singleFlight } from "./single-flight";
import { spendTotalsOf, transcriptWindowsOf } from "./store-sql";
import type { TranscriptRaw } from "./store-sql";
import {
  claimTranscripts,
  ownSpendState,
  releaseTranscripts,
  saveSessionSpend,
  saveTranscriptFile,
  saveTranscriptProgress,
  transcriptFiles,
  transcriptTotals,
} from "./store-queue";
import { indexTranscripts } from "./transcript-files";
import type { CostStore } from "./transcript-cost";
import { markCompacted } from "./usage-track";
import type { SpendState, SpendTotals } from "../types";

const spendAtom = atom({ plugin: "paneline", key: "spend" } as const, emptySpend());
const spendTotalsAtom = atom(
  { plugin: "paneline", key: "spendTotals" } as const,
  null as SpendTotals | null,
);
const contextLogAtom = atom({ plugin: "paneline", key: "contextLog" } as const, emptyContextLog());

const ANY_ORIGIN = /^/;
export const TURN_END_REASONS = ["answer", "aborted", "refusal", "error"] as const;

const oneRefreshAtATime = singleFlight();

const INTERIM_TOTALS_MS = 5_000;
const NOT_ALPHANUMERIC = /[^a-zA-Z0-9]/g;
const OUTSIDE_WORK_TREE_SCRIPT =
  'for d; do git -C "$d" rev-parse --is-inside-work-tree >/dev/null 2>&1 || echo "$d"; done';

const isContainer = new Map<string, boolean>();

let promptStart: TurnStart | null = null;
let pendingCold: { timer: Timer; warmUntil: number } | undefined;

export function keepColdFlip($: EngineInterface, warmUntil: number, now: number): void {
  if (pendingCold?.warmUntil === warmUntil) return;
  pendingCold?.timer.cancel();
  const timer = $.clock.after(warmUntil - now, () => {
    pendingCold = undefined;
    $.ui.invalidate("ui.render");
  });
  pendingCold = { timer, warmUntil };
}

export function refreshSpendTotals($: EngineInterface): Promise<number | undefined> {
  return oneRefreshAtATime("totals", async () => {
    try {
      const [session, now] = await Promise.all([$.session.id(), $.clock.now()]);
      const claimedAt = await claimedRefresh($, session, now);
      await writeTotals($, session);
      return claimedAt;
    } catch (error) {
      $.ui.log(String(error), { to: "debug" });
      return undefined;
    }
  });
}

export function refreshOwnTranscripts(
  $: EngineInterface,
  paths: string[],
): Promise<number | undefined> {
  return oneRefreshAtATime("own-transcripts", async () => {
    try {
      const [session, now] = await Promise.all([$.session.id(), $.clock.now()]);
      return await claimedRefresh($, session, now, paths);
    } catch (error) {
      $.ui.log(String(error), { to: "debug" });
      return undefined;
    }
  });
}

async function claimedRefresh(
  $: EngineInterface,
  session: string,
  now: number,
  paths?: string[],
): Promise<number | undefined> {
  if (!(await claimTranscripts($, session, now, PRICING_KEY))) return undefined;
  return (await indexAsOwner($, session, paths)) ? now : undefined;
}

async function indexAsOwner(
  $: EngineInterface,
  session: string,
  paths?: string[],
): Promise<boolean> {
  const now = await $.clock.now();
  try {
    const report = await indexTranscripts(
      (request) => $.process.spawn(request),
      costStoreOf($, session, now, paths),
      {
        root: await transcriptsRoot($),
        now,
        ownSession: session,
        ...(paths && { paths }),
      },
    );
    return report.failed === 0;
  } catch (error) {
    $.ui.log(String(error), { to: "debug" });
    return false;
  } finally {
    await releaseTranscripts($, session);
  }
}

function costStoreOf(
  $: EngineInterface,
  session: string,
  startedAt: number,
  paths?: string[],
): CostStore {
  if (paths !== undefined) {
    return {
      files: () => transcriptFiles($),
      saveFile: async (file, rows) => {
        await saveTranscriptFile($, session, await $.clock.now(), file, rows);
      },
      saveProgress: async () => {},
    };
  }
  let lastWriteAt = startedAt;
  let isSeeded = false;
  return {
    files: () => transcriptFiles($),
    saveFile: async (file, rows) => {
      const now = await $.clock.now();
      await saveTranscriptFile($, session, now, file, rows);
      if (now - lastWriteAt < INTERIM_TOTALS_MS) return;
      lastWriteAt = now;
      await writeTotals($, session);
    },
    saveProgress: async (progress) => {
      await saveTranscriptProgress($, progress);
      if (isSeeded) return;
      isSeeded = true;
      await writeTotals($, session);
    },
  };
}

async function transcriptsRoot($: EngineInterface): Promise<string> {
  const configDir = await $.env.get("CLAUDE_CONFIG_DIR");
  return configDir || `${(await $.env.get("HOME")) ?? ""}/.claude`;
}

async function writeTotals($: EngineInterface, session: string): Promise<void> {
  const at = await $.clock.now();
  const raw = await transcriptTotals($, transcriptWindowsOf(at), session);
  if (raw === undefined) return;
  const totals = spendTotalsOf(raw, await containersOf($, raw), at);
  await update($, spendTotalsAtom, () => totals);
}

async function containersOf($: EngineInterface, raw: TranscriptRaw): Promise<string[]> {
  const dirs = raw.dirs.map(([dir]) => dir);
  const unchecked = raw.cwds.filter(
    ([dir]) => !isContainer.has(dir) && dirs.some((other) => other.startsWith(`${dir}-`)),
  );
  if (unchecked.length > 0) await classifyCandidates($, unchecked);
  const home = (await $.env.get("HOME")) ?? "";
  return [home.replace(NOT_ALPHANUMERIC, "-"), ...dirs.filter((dir) => isContainer.get(dir))];
}

async function classifyCandidates(
  $: EngineInterface,
  candidates: readonly [dir: string, cwd: string][],
): Promise<void> {
  const run = await $.process.run([
    "sh",
    "-c",
    OUTSIDE_WORK_TREE_SCRIPT,
    "sh",
    ...candidates.map(([, cwd]) => cwd),
  ]);
  const outside = new Set(run.stdout.split("\n"));
  for (const [dir, cwd] of candidates) isContainer.set(dir, outside.has(cwd));
}

export async function snapshotTurnStart($: EngineInterface): Promise<TurnStart> {
  const [at, usage, spend] = await Promise.all([
    $.clock.now(),
    $.session.usage(),
    read($, spendAtom),
  ]);
  return {
    at,
    usd: usage.cost?.usd,
    tokens: trackedTokens(spend),
    trackedUsd: trackedUsd(spend),
  };
}

async function recordPromptReceipt(
  $: EngineInterface,
  start: TurnStart,
  outputTokens: number,
): Promise<void> {
  const [now, usage] = await Promise.all([$.clock.now(), $.session.usage()]);
  const state = await update($, spendAtom, (current) =>
    withLastTurn(current, start, {
      usd: usage.cost?.usd,
      durationMs: now - start.at,
      agents: agentsStartedSince(start.at),
      contextTokens:
        usage.context.tokens === undefined ? null : usage.context.tokens + outputTokens,
    }),
  );
  await saveSessionSpend($, state);
}

export function trackSpend(on: On): void {
  on("prompt.submit", { origin: { kind: ANY_ORIGIN } }, async ($, e, next) => {
    if (!e.isMeta && isTypedOrigin(e.origin)) promptStart = await snapshotTurnStart($);
    return next(e);
  });

  on("session.start", { isInteractive: true }, async ($, e, next) => {
    const spendState = await ownSpendState($);
    if (spendState !== undefined) {
      await update($, spendAtom, () => ({ ...emptySpend(), ...(spendState as SpendState) }));
    }
    const started = await next(e);
    void refreshSpendTotals($);
    return started;
  });

  on("session.compact", { trigger: ["manual", "auto", "plugin"] }, async ($, e, next) => {
    const compacted = await next(e);
    if (e.agentId !== undefined || compacted.skip !== undefined) return compacted;
    markCompacted();
    const row = compactionRow(await $.clock.now(), compacted);
    await update($, contextLogAtom, (log) => withCompaction(log, row));
    return compacted;
  });

  on("classic.SessionStart", { source: ["startup", "clear", "compact"] }, async ($, e, next) => {
    if (e.agent_id !== undefined) return next(e);
    if (e.source !== "compact") await update($, contextLogAtom, () => emptyContextLog());
    const state = await update($, spendAtom, (current) =>
      e.source === "compact" ? afterCompaction(current) : freshSpend(),
    );
    await saveSessionSpend($, state);
    return next(e);
  });

  on("turn.complete", { reason: TURN_END_REASONS }, async ($, e, next) => {
    const result = await next(e);
    if (e.agentId !== undefined) return result;
    if (promptStart !== null && e.usage !== undefined) {
      await recordPromptReceipt($, promptStart, e.usage.output_tokens);
    }
    const warmUntil = warmUntilOf((await read($, spendAtom)).mainMemory);
    if (warmUntil !== undefined) keepColdFlip($, warmUntil, await $.clock.now());
    return result;
  });
}
