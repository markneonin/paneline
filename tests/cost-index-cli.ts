import { spawn } from "node:child_process";
import { registerHooks } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

registerHooks({
  resolve(specifier, context, next) {
    const isBare = specifier.startsWith(".") && !/\.\w+$/.test(specifier);
    if (!isBare) return next(specifier, context);
    return next(`${specifier}.ts`, context);
  },
});

const testsDir = dirname(process.argv[1] ?? "");
const hooksDir = join(testsDir, "..", "hooks");
const files = (await import(
  `file://${hooksDir}/transcript-files.ts`
)) as typeof import("../hooks/transcript-files");
const memory = (await import(
  `file://${testsDir}/fixtures/transcript-memory-store.ts`
)) as typeof import("./fixtures/transcript-memory-store");

const SECONDS = 1000;
const TOP_PROJECTS = 5;
const NOW_FLAG = "--now";
const SESSION_FLAG = "--session";
const PROJECT_FLAG = "--project";

await main();

async function main(): Promise<void> {
  const now = Date.parse(argument(NOW_FLAG) ?? "") || Date.now();
  const home = homedir();
  const root = process.env.CLAUDE_CONFIG_DIR || `${home}/.claude`;
  const index = memory.memoryCostStore();
  for (const round of [1, 2]) {
    const startedAt = Date.now();
    const { read, failed } = await files.indexTranscripts(nodeRunner, index, { root, now });
    console.log(
      `index run ${round}: ${((Date.now() - startedAt) / SECONDS).toFixed(2)} s, files read ${read}, failed ${failed}`,
    );
  }
  const containers = containersOf(home);
  const dayStart = new Date(now).setHours(0, 0, 0, 0);
  const sumsStartedAt = Date.now();
  const sums = index.sums({ now, dayStart, containers });
  console.log(`sums(): ${Date.now() - sumsStartedAt} ms`);
  report(sums, containers);
}

function report(
  sums: import("./fixtures/transcript-memory-store").Sums,
  containers: readonly string[],
): void {
  console.log("\nTOTALS (usd)");
  for (const name of ["today", "week", "month"] as const) {
    console.log(`  ${name.padEnd(6)} ${money(sums[name].usd)}  calls ${sums[name].calls}`);
  }
  const sessionId = argument(SESSION_FLAG);
  if (sessionId !== undefined) {
    const rows = sums.sessions.filter((row) => row.sessionId === sessionId);
    const usd = rows.reduce((total, row) => total + row.main.usd + row.subagents.usd, 0);
    console.log(`\nSESSION ${sessionId} (all time) ${money(usd)}`);
  }
  console.log("\nTOP PROJECTS, 30 DAYS");
  const ranked = [...sums.projects].sort((a, b) => b.usd - a.usd);
  const wanted = argument(PROJECT_FLAG);
  const shown = ranked.filter(
    (row, place) => place < TOP_PROJECTS || (wanted !== undefined && row.project.includes(wanted)),
  );
  for (const row of shown)
    console.log(`  ${money(row.usd)}  ${shortName(row.project, containers)}`);
  console.log("\nUNKNOWN MODELS");
  for (const row of sums.unknownModels) console.log(`  ${row.model} calls ${row.calls}`);
}

function nodeRunner(request: {
  argv: readonly string[];
}): import("../hooks/transcript-files").ProcessStream {
  const [command = "", ...args] = request.argv;
  const child = spawn(command, args);
  const decoder = new TextDecoder();
  let errorText = "";
  child.stderr.on("data", (chunk) => {
    errorText += decoder.decode(chunk);
  });
  const result = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  async function* pieces(): AsyncGenerator<{ stream: "stdout" | "stderr"; text: string }> {
    const stdoutDecoder = new TextDecoder();
    for await (const chunk of child.stdout) {
      yield { stream: "stdout", text: stdoutDecoder.decode(chunk, { stream: true }) };
    }
    await result;
    if (errorText !== "") yield { stream: "stderr", text: errorText };
  }
  return Object.assign(pieces(), { result });
}

function argument(flag: string): string | undefined {
  const at = process.argv.indexOf(flag);
  return at < 0 ? undefined : process.argv[at + 1];
}

function containersOf(home: string): string[] {
  const encoded = home.replace(/[^A-Za-z0-9]/g, "-");
  return [encoded, `${encoded}-projects`, `${encoded}-projects-IT`];
}

function shortName(dir: string, containers: readonly string[]): string {
  const parent = containers
    .filter((container) => dir.startsWith(`${container}-`))
    .sort((a, b) => a.length - b.length)[0];
  return parent === undefined ? dir : dir.slice(parent.length + 1);
}

function money(usd: number): string {
  return `$${usd.toFixed(2)}`.padStart(11);
}
