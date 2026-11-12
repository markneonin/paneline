import type { EngineInterface } from "claude-code";

import type { HistoryEntry } from "../types";
import { refreshOwnTranscripts } from "./spend-track";
import { monthStart } from "./store-sql";
import { sessionCalls } from "./store-queue";

type Call = [at: number, usd: number];

type SessionCosts = {
  session: string;
  calls: Call[] | undefined;
  provenUntil: number;
  dirtyAt: number;
};

export type RowCosts = Map<string, number | null>;

const TRANSCRIPT_NAME = /^(.*)\/([^/]+)\.jsonl$/;

let known: SessionCosts | undefined;
let lastAttemptRefused = false;

export function isCostProofRefused(): boolean {
  return lastAttemptRefused;
}

export async function refreshCosts($: EngineInterface, path: string, since: number): Promise<void> {
  const match = TRANSCRIPT_NAME.exec(path);
  if (match === null) return;
  const [, dir = "", session = ""] = match;
  if (known?.session !== session) known = { session, calls: undefined, provenUntil: 0, dirtyAt: 0 };
  const costs = known;
  const triggeredAt = await $.clock.now();
  costs.dirtyAt = triggeredAt;
  const paths = [path, `${dir}/${session}/subagents`];
  let claimedAt = await refreshOwnTranscripts($, paths);
  if (claimedAt !== undefined && claimedAt < triggeredAt) {
    claimedAt = await refreshOwnTranscripts($, paths);
  }
  const calls = claimedAt === undefined ? undefined : await sessionCalls($, session, since);
  lastAttemptRefused = calls === undefined;
  if (calls === undefined || claimedAt === undefined) return;
  costs.calls = calls;
  costs.provenUntil = claimedAt;
  $.ui.invalidate("ui.render");
}

export function costsOf(entries: HistoryEntry[], now: number, path: string): RowCosts {
  const session = TRANSCRIPT_NAME.exec(path)?.[2];
  const current = known?.session === session ? known : undefined;
  const rows = entries.filter((entry) => entry.kind === "prompt" && !entry.absorbed);
  const costs: RowCosts = new Map();
  rows.forEach((row, at) => {
    const following = rows[at + 1];
    const windowEnd = following?.at ?? Math.max(row.at, current?.dirtyAt ?? 0);
    const isProven = current !== undefined && isProvenWindow(current, row.at, windowEnd, now);
    costs.set(row.id, isProven ? sumBetween(current, row.at, following?.at) : null);
  });
  return costs;
}

function isProvenWindow(
  costs: SessionCosts,
  from: number,
  windowEnd: number,
  now: number,
): boolean {
  return costs.calls !== undefined && windowEnd <= costs.provenUntil && from >= monthStart(now);
}

function sumBetween(costs: SessionCosts, from: number, until: number | undefined): number {
  return (costs.calls ?? [])
    .filter(([at]) => at >= from && (until === undefined || at < until))
    .reduce((sum, [, usd]) => sum + usd, 0);
}
