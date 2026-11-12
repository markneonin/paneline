import { atom, read, update } from "claude-code";
import type { EngineInterface, On, SessionMeasureInput, Timer } from "claude-code";

import type { UsageSnap } from "../types";
import {
  FULL_GRID_COLUMNS,
  compactThreshold,
  contextBreakdown,
  forgetThreshold,
  markContextStale,
} from "./breakdown";
import { changeOwn } from "./sessions-track";
import { saveLimits, storedSnapshot } from "./store-queue";

const usageAtom = atom(
  { plugin: "paneline", key: "usage" } as const,
  { context: null, limits: [] } as UsageSnap,
);

let isCompactPending = false;
let measuredContextCount = 0;
let resetSlot: { timer: Timer; at: number } | undefined;

type Measure = Pick<SessionMeasureInput, "context" | "rateLimits" | "changed">;
type Limit = UsageSnap["limits"][number];

export function trackUsage(on: On): void {
  on("session.start", async ($, e, next) => {
    isCompactPending = false;
    await forgetContext($);
    await refreshUsage($);
    const result = await next(e);
    void restoreLimits($);
    void seedContext($);
    return result;
  });

  on("classic.SessionStart", { source: ["clear", "resume", "fork"] }, async ($, e, next) => {
    forgetThreshold();
    isCompactPending = false;
    await forgetContext($);
    await refreshUsage($);
    const result = await next(e);
    void seedContext($);
    return result;
  });

  on("session.measure", { changed: ["context", "rateLimits"] }, async ($, e, next) => {
    if (e.context.tokens !== undefined) isCompactPending = false;
    if (carriesContextReading(e)) measuredContextCount += 1;
    await storeUsage($, e);
    return next(e);
  });
}

export function markCompacted(): void {
  markContextStale();
  isCompactPending = true;
}

export function reseedAfterCompact($: EngineInterface): void {
  if (!isCompactPending) return;
  $.clock.after(0, () => void reseedCompact($));
}

export function keepResetRedraw($: EngineInterface, limits: Limit[], nowMs: number): void {
  const at = nextResetOf(limits, nowMs);
  if (at === undefined || resetSlot?.at === at) return;
  resetSlot?.timer.cancel();
  const timer = $.clock.after(at - nowMs + 1, () => {
    resetSlot = undefined;
    $.ui.invalidate("ui.render");
  });
  resetSlot = { timer, at };
}

function nextResetOf(limits: Limit[], nowMs: number): number | undefined {
  const resets = limits.flatMap((limit) =>
    limit.resetsAt === undefined ? [] : [Date.parse(limit.resetsAt)],
  );
  const later = resets.filter((at) => at > nowMs);
  return later.length === 0 ? undefined : Math.min(...later);
}

function carriesContextReading(measure: Measure): boolean {
  return measure.changed.includes("context") && measure.context.tokens !== undefined;
}

async function contextOf(
  $: EngineInterface,
  context: Pick<Measure["context"], "tokens" | "percent">,
  stored: number | null,
): Promise<number | null> {
  if (context.tokens === undefined) return stored;
  const threshold = await compactThreshold((args) => $.session.usage(args));
  if (!threshold) return context.percent ?? null;
  return Math.min(100, Math.round((context.tokens / threshold) * 100));
}

async function forgetContext($: EngineInterface): Promise<void> {
  if ((await read($, usageAtom)).context === null) return;
  await update($, usageAtom, (stored) => ({ ...stored, context: null }));
}

async function storeUsage($: EngineInterface, measure: Measure): Promise<void> {
  const stored = await read($, usageAtom);
  const snap: UsageSnap = {
    context: carriesContextReading(measure)
      ? await contextOf($, measure.context, stored.context)
      : stored.context,
    limits: mergeLimits(
      stored.limits,
      measure.rateLimits.map((limit) => ({
        label: limitLabel(limit.kind),
        percent: limit.percentUsed,
        ...(limit.resetsAt === undefined ? {} : { resetsAt: limit.resetsAt }),
      })),
    ),
  };
  if (JSON.stringify(stored) === JSON.stringify(snap)) return;
  await update($, usageAtom, () => snap);
  if (JSON.stringify(stored.limits) !== JSON.stringify(snap.limits)) {
    saveLimits($, snap.limits);
  }
}

async function seedContext($: EngineInterface): Promise<void> {
  const measuredAtStart = measuredContextCount;
  const percent = await breakdownPercent($);
  if (percent === undefined) return;
  if ((await read($, usageAtom)).context !== null) return;
  await storeContextShare($, percent, measuredAtStart);
}

async function reseedCompact($: EngineInterface): Promise<void> {
  const measuredAtStart = measuredContextCount;
  const { context } = await $.session.usage();
  if (!isCompactPending || context.tokens !== undefined) return;
  isCompactPending = false;
  const percent = await breakdownPercent($);
  if (percent === undefined) return;
  await storeContextShare($, percent, measuredAtStart);
}

async function storeContextShare(
  $: EngineInterface,
  percent: number | null,
  measuredAtStart: number,
): Promise<void> {
  const write = { isStored: false };
  await update($, usageAtom, (stored) => {
    write.isStored = measuredContextCount === measuredAtStart;
    return write.isStored ? { ...stored, context: percent } : stored;
  });
  if (write.isStored) await changeOwn($, () => ({ ctx: percent }));
}

async function breakdownPercent($: EngineInterface): Promise<number | null | undefined> {
  markContextStale();
  const breakdown = await contextBreakdown((args) => $.session.usage(args), FULL_GRID_COLUMNS);
  if (breakdown === null) return undefined;
  return contextOf($, { tokens: breakdown.totalTokens }, null);
}

async function restoreLimits($: EngineInterface): Promise<void> {
  if ((await read($, usageAtom)).limits.length > 0) return;
  const saved = (await storedSnapshot($)).limits as Limit[] | undefined;
  if (saved === undefined) return;
  await update($, usageAtom, (stored) => ({ ...stored, limits: saved }));
}

function mergeLimits(stored: Limit[], readings: Limit[]): Limit[] {
  const readingByLabel = new Map(readings.map((limit) => [limit.label, limit]));
  const storedLabels = new Set(stored.map((limit) => limit.label));
  const kept = stored.map((limit) => readingByLabel.get(limit.label) ?? limit);
  const added = readings.filter((limit) => !storedLabels.has(limit.label));
  return [...kept, ...added];
}

async function refreshUsage($: EngineInterface): Promise<void> {
  await storeUsage($, { ...(await $.session.usage()), changed: ["context", "rateLimits"] });
}

function limitLabel(kind: string): string {
  const name = kind.toLowerCase();
  if (name.includes("five") || name.includes("5h") || name.includes("5_h")) return "5h";
  if (name.includes("seven") || name.includes("7d") || name.includes("week")) return "7d";
  return name.replace(/_/g, " ");
}
