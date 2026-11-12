import type {
  EngineInterface,
  SessionContextBreakdown,
  SessionUsage,
  SessionUsageArgs,
} from "claude-code";

import { singleFlight } from "./single-flight";

export type UsageFetch = (args: SessionUsageArgs) => Promise<SessionUsage>;

type FullSnapshot = { columns: number; breakdown: SessionContextBreakdown };

export const FULL_GRID_COLUMNS = 80;
const MESSAGES_CATEGORY = "Messages";

const oneFetchAtATime = singleFlight();
let full: FullSnapshot | undefined;
let isFullStale = true;
let fullMarks = 0;
let summary: SessionContextBreakdown | undefined;
let isSummaryStale = true;
let summaryMarks = 0;
let knownThreshold: number | undefined;
let failedFullMarks: number | undefined;
let newest: SessionContextBreakdown | undefined;

export function markContextStale(): void {
  isFullStale = true;
  fullMarks += 1;
  markSummaryStale();
}

export function markSummaryStale(): void {
  isSummaryStale = true;
  summaryMarks += 1;
}

export function fixedTokensHeld(): number | undefined {
  return newest?.categories
    .filter((category) => category.kind === "used" && category.name !== MESSAGES_CATEGORY)
    .reduce((sum, category) => sum + category.tokens, 0);
}

export function forgetThreshold(): void {
  knownThreshold = undefined;
}

function fullColumnsOf(paneColumns: number): number {
  return Math.max(paneColumns, FULL_GRID_COLUMNS);
}

export function cachedContextBreakdown(paneColumns: number): SessionContextBreakdown | null {
  const columns = fullColumnsOf(paneColumns);
  return full?.columns === columns && !isFullStale ? full.breakdown : null;
}

export async function contextBreakdown(
  usage: UsageFetch,
  paneColumns: number,
): Promise<SessionContextBreakdown | null> {
  const cached = cachedContextBreakdown(paneColumns);
  if (cached !== null) return cached;
  const columns = fullColumnsOf(paneColumns);
  const marksAtStart = fullMarks;
  const breakdown = await oneFetchAtATime(`full-${columns}-${marksAtStart}`, async () => {
    const { context } = await usage({ breakdown: "full", columns });
    return context.breakdown;
  });
  if (breakdown === undefined) return null;
  full = { columns, breakdown };
  newest = breakdown;
  isFullStale = fullMarks !== marksAtStart;
  return breakdown;
}

export async function mcpBreakdown(usage: UsageFetch): Promise<SessionContextBreakdown | null> {
  if (summary !== undefined && !isSummaryStale) return summary;
  const marksAtStart = summaryMarks;
  const breakdown = await summaryBreakdown(usage, marksAtStart);
  if (breakdown === null) return null;
  summary = breakdown;
  newest = breakdown;
  isSummaryStale = summaryMarks !== marksAtStart;
  return breakdown;
}

export async function compactThreshold(usage: UsageFetch): Promise<number | undefined> {
  if (knownThreshold !== undefined) return knownThreshold;
  const breakdown = await summaryBreakdown(usage, summaryMarks);
  knownThreshold = breakdown?.autoCompactThreshold;
  return knownThreshold;
}

function summaryBreakdown(
  usage: UsageFetch,
  marksAtStart: number,
): Promise<SessionContextBreakdown | null> {
  return oneFetchAtATime(`summary-${marksAtStart}`, async () => {
    const { context } = await usage({ breakdown: "summary" });
    return context.breakdown ?? null;
  });
}

export async function loadFullBreakdown($: EngineInterface, paneColumns: number): Promise<void> {
  if (failedFullMarks === fullMarks) return;
  const marksAtStart = fullMarks;
  const breakdown = await contextBreakdown((args) => $.session.usage(args), paneColumns).catch(
    (error: unknown) => {
      failedFullMarks = marksAtStart;
      $.ui.toast(`Token counts failed: ${String(error)}`);
      return null;
    },
  );
  if (breakdown !== null) $.ui.invalidate("ui.render");
}
