export const HOME = "/home/dev";
export const CLAUDE_ROOT = `${HOME}/.claude`;
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
const NEWLINE = 10;
const UNLIMITED_PIECE = 0;
const FAILED_CODE = 1;
const OK_CODE = 0;
const HEAD_NO_BYTES_ERROR = "head: illegal byte count -- 0\n";
const STAT_MISSING_ERROR = (path: string) => `stat: ${path}: No such file or directory\n`;
const MILLISECONDS_PER_SECOND = 1000;
const MISSING_FIND_ERROR = (path: string) => `find: ${path}: No such file or directory\n`;

function isUnder(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

export type RunChunk = { stream: "stdout" | "stderr"; text: string };
export type RunResult = { code: number | null; signal: string | null };
export type RunStream = AsyncGenerator<RunChunk, RunResult> & {
  readonly result: Promise<RunResult>;
};
export type TranscriptRunner = (request: { argv: readonly string[] }) => RunStream;

type DiskFile = { bytes: Uint8Array; mtime: number };

export type Disk = {
  run: TranscriptRunner;
  write: (path: string, bytes: Uint8Array, mtime: number) => void;
  writeLines: (path: string, lines: readonly string[], mtime: number) => void;
  failRead: (path: string, times: number) => void;
  failStat: (path: string) => void;
  interruptRead: (path: string) => void;
  pieceCharacters: (count: number) => void;
  bytesServed: () => number;
  readsOf: (path: string) => number;
};

export function diskOf(root: string = CLAUDE_ROOT): Disk {
  const PROJECTS = `${root}/projects`;
  const files = new Map<string, DiskFile>();
  const failures = new Map<string, number>();
  const interrupts = new Set<string>();
  const statFailures = new Set<string>();
  const readCounts = new Map<string, number>();
  let pieceSize = UNLIMITED_PIECE;
  let served = 0;

  function listing(): string[] {
    return [...files]
      .filter(([path]) => !statFailures.has(`${PROJECTS}/${path}`))
      .map(
        ([path, file]) =>
          `${file.bytes.length} ${Math.floor(file.mtime / MILLISECONDS_PER_SECOND)} ${PROJECTS}/${path}\n`,
      );
  }

  function statErrors(): string[] {
    return [...statFailures].map(STAT_MISSING_ERROR);
  }

  function findOf(argv: readonly string[]): RunStream {
    const searched = argv.slice(1, argv.indexOf("-name"));
    const errors = [
      ...statErrors(),
      ...searched.filter((path) => !isThere(path)).map((path) => MISSING_FIND_ERROR(path)),
    ];
    const listed = listing().filter((line) =>
      searched.some((path) => isUnder(path, line.split(" ").slice(2).join(" ").trimEnd())),
    );
    return streamOf(listed, errors.length === 0 ? OK_CODE : FAILED_CODE, errors);
  }

  function isThere(path: string): boolean {
    return (
      path === PROJECTS || [...files.keys()].some((rel) => isUnder(path, `${PROJECTS}/${rel}`))
    );
  }

  function readOf(argv: readonly string[]): RunStream {
    const start = Number(argv[4]);
    const path = argv[5] ?? "";
    const marker = argv[6] ?? "";
    const length = Number(argv[7]);
    readCounts.set(path, (readCounts.get(path) ?? 0) + 1);
    const file = files.get(path.slice(PROJECTS.length + 1));
    if (interrupts.delete(path)) throw new Error("the read was interrupted");
    const failed = failures.get(path) ?? 0;
    if (failed > 0) failures.set(path, failed - 1);
    if (file === undefined || failed > 0) return streamOf([], FAILED_CODE);
    if (length === 0) return streamOf([], FAILED_CODE, [HEAD_NO_BYTES_ERROR]);
    const slice = file.bytes.subarray(start - 1, start - 1 + length);
    served += slice.length;
    return streamOf(piecesOf(outputOf(file.bytes, slice, start, marker)), OK_CODE);
  }

  function streamOf(
    pieces: readonly string[],
    code: number,
    errors: readonly string[] = [],
  ): RunStream {
    const result = { code, signal: null };
    async function* chunks(): AsyncGenerator<RunChunk, RunResult> {
      for (const text of pieces) yield { stream: "stdout", text };
      for (const text of errors) yield { stream: "stderr", text };
      return result;
    }
    return Object.assign(chunks(), { result: Promise.resolve(result) });
  }

  function piecesOf(text: string): string[] {
    if (pieceSize === UNLIMITED_PIECE) return [text];
    const characters = Array.from(text);
    const pieces: string[] = [];
    for (let at = 0; at < characters.length; at += pieceSize) {
      pieces.push(characters.slice(at, at + pieceSize).join(""));
    }
    return pieces;
  }

  return {
    run: ({ argv }) => {
      if (argv[0] === "find") return findOf(argv);
      if (argv[0] === "sh") return readOf(argv);
      throw new Error(`the shell double has no answer for ${argv.join(" ")}`);
    },
    write: (path, bytes, mtime) => {
      files.set(path, { bytes, mtime });
    },
    writeLines: (path, lines, mtime) => {
      files.set(path, { bytes: fileBytes(lines), mtime });
    },
    failRead: (path, times) => {
      failures.set(`${PROJECTS}/${path}`, times);
    },
    failStat: (path) => {
      statFailures.add(`${PROJECTS}/${path}`);
    },
    interruptRead: (path) => {
      interrupts.add(`${PROJECTS}/${path}`);
    },
    pieceCharacters: (count) => {
      pieceSize = count;
    },
    bytesServed: () => served,
    readsOf: (path) => readCounts.get(`${PROJECTS}/${path}`) ?? 0,
  };
}

function outputOf(whole: Uint8Array, slice: Uint8Array, start: number, marker: string): string {
  const firstBreak = whole.indexOf(NEWLINE);
  const timestamp =
    start === 1 && firstBreak >= 0 && firstBreak < slice.length
      ? `${timestampOf(DECODER.decode(whole.subarray(0, firstBreak)))}\n`
      : "";
  const lastBreak = slice.lastIndexOf(NEWLINE);
  const complete = DECODER.decode(slice.subarray(0, lastBreak + 1));
  const matching = complete
    .split("\n")
    .slice(0, -1)
    .filter((line) => line.includes(marker))
    .map((line) => `${line}\n`)
    .join("");
  const tail = slice.length - (lastBreak + 1);
  return `${timestamp}${matching}${tail}\n`;
}

function timestampOf(line: string): string {
  return (JSON.parse(line) as { timestamp: string }).timestamp;
}

export function fileBytes(lines: readonly string[]): Uint8Array {
  return ENCODER.encode(lines.map((line) => `${line}\n`).join(""));
}

export function lineByteLength(line: string): number {
  return ENCODER.encode(`${line}\n`).length;
}

export function cutInsideCharacter(line: string, letter: string): number {
  return ENCODER.encode(line.slice(0, line.indexOf(letter))).length + 1;
}

export function textLine(at: number, text: string): string {
  return JSON.stringify({
    type: "user",
    timestamp: new Date(at).toISOString(),
    message: { role: "user", content: text },
  });
}
