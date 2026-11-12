import { closeSync, openSync, readSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { availableParallelism, homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { isMainThread, parentPort, Worker } from "node:worker_threads";
import type { Oracle, Source, Tally } from "./transcript-oracle";

type Job = { path: string; relative: string };
type WorkerMessage = Source | "ready";

const core = (await import(
  `file://${dirname(process.argv[1] ?? "")}/transcript-oracle.ts`
)) as typeof import("./transcript-oracle");

const CHUNK_BYTES = 8 * 1024 * 1024;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MONTH_DAYS = 30;
const TOP_SESSIONS = 15;
const TOP_DIRS = 40;
const PERCENT = 100;
const SECONDS = 1000;
const ROOT_FLAG = "--root";
const NOW_FLAG = "--now";

if (isMainThread) await runMain();
else runWorker();

async function runMain(): Promise<void> {
  const startedAt = Date.now();
  const root = argument(ROOT_FLAG) ?? join(homedir(), ".claude", "projects");
  const now = Date.parse(argument(NOW_FLAG) ?? "") || startedAt;
  const jobs = await recentTranscripts(root, now - MONTH_DAYS * MS_PER_DAY);
  const sources = await readAll(jobs);
  const containers = containersOf(homedir());
  const oracle = core.oracleOf(sources, { now, containers });
  report(oracle, containers, jobs.length);
  console.log(`\nrun time ${((Date.now() - startedAt) / SECONDS).toFixed(1)} s`);
}

function runWorker(): void {
  const port = parentPort;
  if (port === null) return;
  port.on("message", (message) => {
    const job = message as Job;
    const source: Source = { path: job.relative, ...core.transcriptOf(linesOf(job.path)) };
    port.postMessage(source);
  });
  port.postMessage("ready" satisfies WorkerMessage);
}

function argument(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index < 0 ? undefined : process.argv[index + 1];
}

function containersOf(home: string): string[] {
  const encoded = home.replace(/[^A-Za-z0-9]/g, "-");
  return [encoded, `${encoded}-projects`, `${encoded}-projects-IT`];
}

async function recentTranscripts(root: string, notBefore: number): Promise<Job[]> {
  const paths = await transcriptsUnder(root);
  const stats = await Promise.all(paths.map((path) => stat(path)));
  return paths
    .map((path, index) => ({
      path,
      relative: relative(root, path),
      size: stats[index]?.size ?? 0,
      at: stats[index]?.mtimeMs ?? 0,
    }))
    .filter((file) => file.at >= notBefore)
    .sort((a, b) => b.size - a.size);
}

async function transcriptsUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return transcriptsUnder(path);
      return entry.name.endsWith(".jsonl") ? [path] : [];
    }),
  );
  return nested.flat();
}

async function readAll(jobs: readonly Job[]): Promise<Source[]> {
  const queue = [...jobs];
  const sources: Source[] = [];
  const script = process.argv[1] ?? "";
  const workers = Array.from(
    { length: Math.min(availableParallelism(), jobs.length) },
    () => new Worker(script),
  );
  await Promise.all(
    workers.map(
      (worker) =>
        new Promise<void>((resolve, reject) => {
          worker.on("error", reject);
          worker.on("message", (message) => {
            const reply = message as WorkerMessage;
            if (reply !== "ready") sources.push(reply);
            const next = queue.shift();
            if (next === undefined) {
              void worker.terminate();
              resolve();
              return;
            }
            worker.postMessage(next);
          });
        }),
    ),
  );
  return sources;
}

function* linesOf(path: string): Generator<string> {
  const fd = openSync(path, "r");
  const buffer = new Uint8Array(CHUNK_BYTES);
  const decoder = new TextDecoder();
  let carry = "";
  try {
    for (
      let read = readSync(fd, buffer, 0, CHUNK_BYTES, null);
      read > 0;
      read = readSync(fd, buffer, 0, CHUNK_BYTES, null)
    ) {
      const parts = (carry + decoder.decode(buffer.subarray(0, read), { stream: true })).split(
        "\n",
      );
      carry = parts.pop() ?? "";
      yield* parts;
    }
    yield carry;
  } finally {
    closeSync(fd);
  }
}

function report(oracle: Oracle, containers: readonly string[], fileCount: number): void {
  const nameOf = (dir: string): string => core.shortName(dir, containers);
  console.log(`files read: ${fileCount}, sessions: ${oracle.sessions.length}`);
  console.log(`prices: ${core.PRICE_SOURCE.url} fetched ${core.PRICE_SOURCE.fetched}`);
  console.log("\nTOTALS (usd)");
  for (const name of ["today", "week", "month"] as const) {
    console.log(
      `  ${name.padEnd(6)} ${money(oracle.totals[name].usd)}  ${tokensText(oracle.totals[name])}`,
    );
  }
  console.log(
    `  advisor ${money(oracle.totals.month.advisorUsd)} of the month total, priced at the advisor's own model`,
  );
  console.log(`\nTOP ${TOP_SESSIONS} SESSIONS BY 30-DAY COST`);
  const ranked = oracle.sessions
    .map((row) => ({ row, month: core.splitTotal(row.windows.month).usd }))
    .sort((a, b) => b.month - a.month)
    .slice(0, TOP_SESSIONS);
  for (const { row, month } of ranked) {
    const lifetime = core.splitTotal(row.windows.lifetime).usd;
    const subagents = row.windows.month.subagents.usd;
    const today = core.splitTotal(row.windows.today).usd;
    console.log(
      `  ${money(month)}  today ${money(today)}  subagents ${money(subagents)}  lifetime ${money(lifetime)}  ${nameOf(oracle.repoOfDir.get(row.projectDir) ?? row.projectDir)}  ${nameOf(row.projectDir)}  ${row.sessionId}`,
    );
  }
  console.log("\nBY REPO, 30 DAYS");
  printShares(oracle.byRepo, oracle.totals.month.usd, nameOf, Infinity);
  console.log("\nBY TRANSCRIPT DIR, 30 DAYS");
  printShares(oracle.byDir, oracle.totals.month.usd, nameOf, TOP_DIRS);
  console.log("\nMODELS, 30 DAYS");
  printTallies(oracle.models);
  console.log("\nUNKNOWN MODELS (not priced)");
  printTallies(oracle.unknownModels);
  console.log("\nUNMAPPED DIRS (outside the containers)");
  for (const dir of oracle.unmappedDirs) console.log(`  ${dir}`);
}

function printShares(
  tallies: Map<string, Tally>,
  total: number,
  nameOf: (dir: string) => string,
  limit: number,
): void {
  const ranked = [...tallies]
    .filter(([, tally]) => tally.usd > 0)
    .sort((a, b) => b[1].usd - a[1].usd);
  for (const [key, tally] of ranked.slice(0, limit)) {
    console.log(
      `  ${money(tally.usd)}  ${Math.round((tally.usd / total) * PERCENT)}%  ${nameOf(key)}`,
    );
  }
  const rest = ranked.slice(limit).reduce((sum, [, tally]) => sum + tally.usd, 0);
  if (ranked.length > limit) console.log(`  ${money(rest)}  ${ranked.length - limit} more`);
}

function printTallies(tallies: Map<string, Tally>): void {
  for (const [model, tally] of [...tallies].sort((a, b) => b[1].usd - a[1].usd)) {
    console.log(`  ${model.padEnd(28)} ${money(tally.usd)}  ${tokensText(tally)}`);
  }
}

function money(usd: number): string {
  return `$${usd.toFixed(2)}`.padStart(11);
}

function tokensText(tally: Tally): string {
  const fields = ["input", "output", "write5m", "write1h", "read"] as const;
  return `${fields.map((field) => `${field} ${tally[field].toLocaleString("en-US")}`).join("  ")}  calls ${tally.calls.toLocaleString("en-US")}`;
}
