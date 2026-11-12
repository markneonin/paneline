import type { EngineInterface, ProcessSpawnChunk, ProcessSpawnResult } from "claude-code";

const ROW_MARKERS = [
  '"type":"user"',
  '"type":"assistant"',
  '"type":"queued_command"',
  '"subtype":"local_command"',
];
const FOUND = 0;
const NOTHING_FOUND = 1;

const READER_ERROR = 2;

export const RIPGREP_ENV = { ARGV0: "rg" };

export function bundledRipgrep(home: string): string {
  return `${home}/.local/bin/claude`;
}

export class TranscriptReadError extends Error {
  constructor(
    readonly code: number | null,
    signal: string | null,
  ) {
    super(`transcript reader ended with ${String(code ?? signal)}`);
  }

  get isReaderError(): boolean {
    return this.code === READER_ERROR;
  }
}

export async function* transcriptLines(
  $: EngineInterface,
  path: string,
  markers: readonly string[] = ROW_MARKERS,
): AsyncGenerator<string> {
  const home = (await $.env.get("HOME")) ?? "";
  const pattern = markers.flatMap((marker) => ["-e", marker]);
  const reader = $.process.spawn({
    argv: [bundledRipgrep(home), "--no-config", "-a", "-F", ...pattern, "--", path],
    env: RIPGREP_ENV,
  });
  let first: IteratorResult<ProcessSpawnChunk, ProcessSpawnResult>;
  try {
    first = await reader.next();
  } catch {
    const grep = $.process.spawn({ argv: ["grep", "-a", "-F", ...pattern, "--", path] });
    yield* transcriptPieces(grep, await grep.next());
    return;
  }
  yield* transcriptPieces(reader, first);
}

async function* transcriptPieces(
  stream: ReturnType<EngineInterface["process"]["spawn"]>,
  first: IteratorResult<ProcessSpawnChunk, ProcessSpawnResult>,
): AsyncGenerator<string> {
  let tail = "";
  for (let step = first; !step.done; step = await stream.next()) {
    if (step.value.stream !== "stdout") continue;
    const lines = `${tail}${step.value.text}`.split("\n");
    tail = lines.pop() ?? "";
    yield* lines;
  }
  const { code, signal } = await stream.result;
  if (code !== FOUND && code !== NOTHING_FOUND) throw new TranscriptReadError(code, signal);
  if (tail !== "") yield tail;
}
