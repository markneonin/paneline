import type { SessionMessage } from "claude-code";

import type { CompactionRow, ContextLog, RepeatRow, SpendRent } from "../types";
import { fixedTokensHeld } from "./breakdown";
import { rentRowOf } from "./spend-model";
import { isProgressTool, kindOf, targetOf } from "./tools";

export const MIN_READ_REPEATS = 3;
export const MIN_RESULT_REPEATS = 2;
export type WastedLine = { kind: "read" | "result"; row: RepeatRow };

export function emptyContextLog(): ContextLog {
  return { compactions: [] };
}

export function withCompaction(log: ContextLog, row: CompactionRow): ContextLog {
  return { compactions: [...log.compactions, row] };
}

export function compactionRow(
  at: number,
  compacted: { tokensBefore?: number; tokensAfter?: number },
): CompactionRow {
  const fixed = fixedTokensHeld();
  const after =
    compacted.tokensAfter === undefined || fixed === undefined
      ? null
      : compacted.tokensAfter + fixed;
  return { at, before: compacted.tokensBefore ?? null, after };
}

export function wastedFrom(messages: readonly SessionMessage[], cwd: string): WastedLine[] {
  const reads = new Map<string, RepeatRow>();
  const results = new Map<string, RepeatRow>();
  for (const use of messages.flatMap((message) => message.toolUses)) {
    if (use.text === undefined || isProgressTool(use.tool)) continue;
    const target = targetOf({ tool: use.tool, ...use.input });
    const row = rentRowOf({ tool: use.tool, target, cwd }, use.text);
    if (row.tokens === 0) continue;
    if (kindOf(use.tool) === "Read") countInto(reads, row.target, row);
    else countInto(results, `${use.tool}\u0000${target}\u0000${use.text}`, row);
  }
  return [
    ...repeated(reads, MIN_READ_REPEATS).map((row) => ({ kind: "read" as const, row })),
    ...repeated(results, MIN_RESULT_REPEATS).map((row) => ({ kind: "result" as const, row })),
  ].sort((left, right) => right.row.tokens - left.row.tokens);
}

function countInto(rows: Map<string, RepeatRow>, key: string, row: SpendRent): void {
  const seen = rows.get(key);
  rows.set(key, {
    tool: row.tool,
    target: row.target,
    count: (seen?.count ?? 0) + 1,
    tokens: (seen?.tokens ?? 0) + row.tokens,
  });
}

function repeated(rows: Map<string, RepeatRow>, minCount: number): RepeatRow[] {
  return [...rows.values()]
    .filter((row) => row.count >= minCount)
    .sort((left, right) => right.tokens - left.tokens);
}
