import type { ProcessSpawnChunk, ProcessSpawnResult } from "claude-code";

import type { TranscriptProgress } from "../types";
import { MONTH_DAYS, MS_PER_DAY, addCall, callOf } from "./transcript-cost";
import type { CallRow, CostStore, FileState } from "./transcript-cost";

export type ProcessStream = AsyncIterable<ProcessSpawnChunk> & {
  readonly result: Promise<ProcessSpawnResult>;
};

export type ProcessRunner = (request: { argv: readonly string[] }) => ProcessStream;

export type IndexOptions = { root: string; now: number; ownSession?: string; paths?: string[] };

export type IndexReport = { read: number; failed: number };

type Listing = { files: FoundFile[]; code: number | null; errorText: string };

type Finished = { lines: string[]; code: number | null; errorText: string };

type Ended = Pick<Finished, "code" | "errorText">;

type IndexOutcome = "read" | "failed" | "unread";

export type TranscriptRead = { rows: CallRow[]; offset: number; start: number; cwd: string };

type FoundFile = Pick<FileState, "path" | "size" | "mtimeMs">;

type SavedPlace = Pick<FileState, "offset" | "start" | "cwd">;

type ReadTarget = Pick<FileState, "path" | "size" | "start">;

class ProcessFailed extends Error {}

const READ_CONCURRENCY = 8;
const EXIT_OK = 0;
const NO_START = Number.POSITIVE_INFINITY;
const FRESH_FILE: SavedPlace = { offset: 0, start: NO_START, cwd: "" };
const JSON_LINE_START = "{";
const USAGE_KEY = '"usage"';
const MS_PER_SECOND = 1000;
const FOUND_LINE = /^(\d+) (\d+(?:\.\d+)?) (.+)$/;
const PROJECTS_DIR = "projects";

const AWK_PROGRAM = String.raw`NR > 1 {
  if (w == 1 && !found && match(prev, /"timestamp" *: *"[^"]+"/)) {
    found = 1
    stamp = substr(prev, RSTART, RLENGTH)
    sub(/^"timestamp" *: *"/, "", stamp)
    sub(/"$/, "", stamp)
    print stamp
  }
  if (index(prev, p)) print prev
}
{ prev = $0 }
END { print length(prev) }`;

const READ_SCRIPT = `{ if [ "$1" = 1 ]; then head -c "$4" "$2"; else tail -c +"$1" "$2" | head -c "$4"; fi; echo; } | LC_ALL=C awk -v p="$3" -v w="$5" '${AWK_PROGRAM}'`;

const BSD_STAT = ["-exec", "stat", "-f", "%z %Fm %N", "{}", "+"];
const GNU_STAT = ["-exec", "stat", "-c", "%s %.9Y %n", "{}", "+"];

export async function indexTranscripts(
  run: ProcessRunner,
  index: CostStore,
  options: IndexOptions,
): Promise<IndexReport> {
  const known = new Map((await index.files()).map((state) => [state.path, state]));
  const found = await discoverTranscripts(run, options);
  const changed = found
    .filter((file) => isChanged(file, known.get(file.path)))
    .sort(byOwnSessionThenNewest(options.ownSession));
  const progress: TranscriptProgress = {
    doneBytes: totalSize(found.filter((file) => known.has(file.path))),
    totalBytes: totalSize(found),
    failed: 0,
  };
  const outcomes: IndexOutcome[] = [];
  await index.saveProgress({ ...progress });
  await inPool(changed, READ_CONCURRENCY, async (file) => {
    const outcome = await indexFile(run, index, file, known.get(file.path));
    outcomes.push(outcome);
    if (outcome === "failed") progress.failed += 1;
    if (!known.has(file.path)) progress.doneBytes += file.size;
    await index.saveProgress({ ...progress });
  });
  await index.saveProgress({ ...progress });
  return {
    read: outcomes.filter((outcome) => outcome === "read").length,
    failed: progress.failed,
  };
}

export async function readTranscript(
  run: ProcessRunner,
  file: ReadTarget,
  offset: number,
): Promise<TranscriptRead> {
  const calls = new Map<string, CallRow>();
  let start = file.start;
  let cwd = "";
  let lastLine: string | undefined;
  const take = (line: string): void => {
    if (!line.startsWith(JSON_LINE_START)) {
      const stamp = Date.parse(line);
      if (!Number.isNaN(stamp)) start = stamp;
      return;
    }
    const call = callOf(line, { path: file.path, start });
    if (call === undefined) return;
    addCall(calls, call.row);
    cwd ||= call.cwd;
  };
  const ended = await eachLine(
    run,
    [
      "sh",
      "-c",
      READ_SCRIPT,
      "sh",
      String(offset + 1),
      file.path,
      USAGE_KEY,
      String(file.size - offset),
      file.start === NO_START ? "1" : "0",
    ],
    (line) => {
      if (lastLine !== undefined) take(lastLine);
      lastLine = line;
    },
  );
  assertSucceeded("sh", ended);
  return {
    rows: [...calls.values()],
    offset: file.size - Number(lastLine),
    start,
    cwd,
  };
}

async function discoverTranscripts(
  run: ProcessRunner,
  options: IndexOptions,
): Promise<FoundFile[]> {
  const notBefore = options.now - MONTH_DAYS * MS_PER_DAY;
  const paths = options.paths ?? [`${options.root}/${PROJECTS_DIR}`];
  const bsd = await listing(run, paths, BSD_STAT);
  const isBsd = bsd.files.length > 0 || bsd.code === EXIT_OK;
  const found = isBsd ? bsd : await listing(run, paths, GNU_STAT);
  if (found.files.length === 0 && found.code !== EXIT_OK) {
    throw new ProcessFailed(`find failed: ${found.errorText || String(found.code)}`);
  }
  return found.files.filter((file) => file.mtimeMs >= notBefore);
}

async function listing(
  run: ProcessRunner,
  paths: readonly string[],
  statArgs: readonly string[],
): Promise<Listing> {
  const { lines, code, errorText } = await finished(run, [
    "find",
    ...paths,
    "-name",
    "*.jsonl",
    ...statArgs,
  ]);
  const files = lines.map(foundFileOf).filter((file): file is FoundFile => file !== undefined);
  return { files, code, errorText };
}

function foundFileOf(line: string): FoundFile | undefined {
  const match = FOUND_LINE.exec(line);
  if (match === null) return undefined;
  return {
    size: Number(match[1]),
    mtimeMs: Math.round(Number(match[2]) * MS_PER_SECOND),
    path: match[3] ?? "",
  };
}

function isChanged(file: FoundFile, state: FileState | undefined): boolean {
  return state?.size !== file.size || state.mtimeMs !== file.mtimeMs;
}

async function indexFile(
  run: ProcessRunner,
  index: CostStore,
  file: FoundFile,
  state: FileState | undefined,
): Promise<IndexOutcome> {
  const previous = state !== undefined && file.size >= state.size ? state : FRESH_FILE;
  const target = { path: file.path, size: file.size, start: previous.start };
  if (previous.offset === file.size) {
    await index.saveFile(
      { ...file, offset: previous.offset, start: previous.start, cwd: previous.cwd },
      [],
    );
    return "unread";
  }
  const read = await readTranscript(run, target, previous.offset).catch((error: unknown) => {
    if (error instanceof ProcessFailed) return undefined;
    throw error;
  });
  if (read === undefined) return "failed";
  const cwd = previous.cwd || read.cwd;
  await index.saveFile({ ...file, offset: read.offset, start: read.start, cwd }, read.rows);
  return "read";
}

function byOwnSessionThenNewest(
  ownSession: string | undefined,
): (a: FoundFile, b: FoundFile) => number {
  const isOwn = (file: FoundFile): number =>
    ownSession !== undefined && file.path.includes(`/${ownSession}`) ? 0 : 1;
  return (a, b) => isOwn(a) - isOwn(b) || b.mtimeMs - a.mtimeMs;
}

function totalSize(files: readonly FoundFile[]): number {
  return files.reduce((total, file) => total + file.size, 0);
}

async function finished(run: ProcessRunner, argv: readonly string[]): Promise<Finished> {
  const lines: string[] = [];
  const ended = await eachLine(run, argv, (line) => lines.push(line));
  return { lines, ...ended };
}

async function eachLine(
  run: ProcessRunner,
  argv: readonly string[],
  onLine: (line: string) => void,
): Promise<Ended> {
  const stream = run({ argv });
  const errors: string[] = [];
  let carry = "";
  for await (const piece of stream) {
    if (piece.stream !== "stdout") {
      errors.push(piece.text);
      continue;
    }
    const parts = (carry + piece.text).split("\n");
    carry = parts.pop() ?? "";
    parts.forEach(onLine);
  }
  const { code } = await stream.result;
  return { code, errorText: errors.join("").trim() };
}

function assertSucceeded(command: string, { code, errorText }: Ended): void {
  if (code !== EXIT_OK || errorText !== "") {
    throw new ProcessFailed(`${command} failed: ${errorText || String(code)}`);
  }
}

async function inPool<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let item = items[next++]; item !== undefined; item = items[next++]) await work(item);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
