import { atom, read, update } from "claude-code";
import type { EngineInterface, On, SessionMeasureInput } from "claude-code";

import type { UsageSnap } from "../types";
import { compactThreshold, forgetThreshold } from "./breakdown";

const usageAtom = atom(
  { plugin: "paneline", key: "usage" } as const,
  { context: null, limits: [] } as UsageSnap,
);

type Measure = Pick<SessionMeasureInput, "context" | "rateLimits" | "changed">;
type Limit = UsageSnap["limits"][number];

export function trackUsage(on: On): void {
  on("session.start", async ($, e, next) => {
    await forgetContext($);
    await refreshUsage($);
    return next(e);
  });

  on("classic.SessionStart", { source: ["clear", "resume", "fork"] }, async ($, e, next) => {
    forgetThreshold();
    await forgetContext($);
    await refreshUsage($);
    return next(e);
  });

  on("session.measure", { changed: ["context", "rateLimits"] }, async ($, e, next) => {
    await storeUsage($, e);
    return next(e);
  });
}

async function contextOf(
  $: EngineInterface,
  context: Measure["context"],
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
    context: measure.changed.includes("context")
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
