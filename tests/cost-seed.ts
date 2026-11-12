import type { Engine } from "claude-code/testing";
import type { On } from "claude-code";

import type { SessionRow } from "../types";
import { diskOf } from "./fixtures/transcript-disk";
import { transcriptSqlite } from "./fixtures/transcript-sqlite";

const HOME = "/h/u";
const SEED_AGE_MS = 60_000;
const SETTLE_ROUNDS = 5;
const SETTLE_MS = 10;
const YIELD_TICKS = 300;
const CLOCK_START = 1_000_000;
const WINDOW_TOKENS = 200_000;

type Clock = { advance: (ms: number) => Promise<unknown> };

export function seedStoredCosts(on: On, rows: SessionRow[], ownSession: string): void {
  const disk = diskOf(`${HOME}/.claude`);
  const { db, answer } = transcriptSqlite();
  rows
    .filter((row) => row.sessionId !== ownSession && (row.usd ?? 0) > 0)
    .forEach((row) =>
      db.addCall(`seed-${row.sessionId}`, {
        at: CLOCK_START - SEED_AGE_MS,
        usd: row.usd ?? 0,
        dir: "-seeded",
        session: row.sessionId,
        path: `-seeded/${row.sessionId}.jsonl`,
      }),
    );
  on("process.run", { argv: /sqlite3/ }, (_$, e) => ({
    value: {
      exitCode: 0,
      stdout: answer(e.init?.stdin ?? ""),
      isStdoutTruncated: false,
      isStderrTruncated: false,
      stderr: "",
    },
  }));
  on("process.spawn", async function* (_$, e) {
    return { value: yield* disk.run({ argv: e.argv }) };
  });
}

export async function measureOwnCost(
  $: Engine,
  rows: SessionRow[],
  ownSession: string,
): Promise<void> {
  const usd = rows.find((row) => row.sessionId === ownSession)?.usd ?? 0;
  if (usd <= 0) return;
  await $.session.measure({
    context: { window: WINDOW_TOKENS },
    rateLimits: [],
    cost: { usd },
    changed: ["cost"],
  } as never);
}

export async function drainCostReads(clock: Clock): Promise<void> {
  for (let round = 0; round < SETTLE_ROUNDS; round++) {
    for (let tick = 0; tick < YIELD_TICKS; tick++) await Promise.resolve();
    await clock.advance(SETTLE_MS);
  }
}
