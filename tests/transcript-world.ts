import type { On } from "claude-code";

export const ENGINE_READ_LIMIT = 4 * 1024 * 1024;
const DEFAULT_PIECE = 64 * 1024;
const PADDING_LINE_BYTES = 4096;

export type Unreadable = { unreadable: "spawn-rejects" | "grep-exit-2" };
export type TranscriptFile = string | Unreadable;

export type TranscriptWorld = {
  files: Map<string, TranscriptFile>;
  pieceSize: number;
  bundledReaderInstalled: boolean;
  pause: () => () => void;
  readsFinished: () => Promise<void>;
  readHeld: () => Promise<void>;
  isReader: (argv: readonly string[]) => boolean;
  serve: (
    argv: readonly string[],
  ) => AsyncGenerator<
    { stream: "stdout"; text: string },
    { value: { code: number; signal: null } }
  >;
};

export function transcriptWorld(on: On): TranscriptWorld {
  const files = new Map<string, TranscriptFile>();
  const finished: Promise<void>[] = [];
  let gate: Promise<void> = Promise.resolve();
  let markHeld = () => {};
  const held = new Promise<void>((resolve) => (markHeld = resolve));
  const world: TranscriptWorld = {
    files,
    pieceSize: DEFAULT_PIECE,
    bundledReaderInstalled: true,
    pause: () => {
      let release = () => {};
      gate = new Promise<void>((resolve) => (release = resolve));
      return release;
    },
    readsFinished: async () => {
      await Promise.all(finished);
    },
    readHeld: () => held,
    isReader: () => false,
    serve: async function* () {
      return { value: { code: 1, signal: null } };
    },
  };

  on("fs.read", (_$, e) => {
    const file = files.get(e.path);
    if (typeof file !== "string") return { deny: "no such file" };
    if (new TextEncoder().encode(file).length > ENGINE_READ_LIMIT)
      return { deny: "file is larger than 4 MiB" };
    return { value: file };
  });

  world.isReader = isBundledReader;
  world.serve = async function* (argv) {
    if (isBundledReader(argv) && !world.bundledReaderInstalled)
      throw new Error(`${argv[0]}: cannot start, no such file`);
    const target = searchTarget(argv) ?? { patterns: [], path: "" };
    let done = () => {};
    finished.push(new Promise<void>((resolve) => (done = resolve)));
    try {
      const file = files.get(target.path);
      if (file === undefined || typeof file !== "string") {
        if (file === undefined || file.unreadable === "spawn-rejects")
          throw new Error("cannot start grep");
        return { value: { code: 2, signal: null } };
      }
      markHeld();
      await gate;
      const kept = file.split("\n").filter((line) => target.patterns.some((p) => line.includes(p)));
      const text = kept.length === 0 ? "" : `${kept.join("\n")}\n`;
      for (let at = 0; at < text.length; at += world.pieceSize)
        yield { stream: "stdout", text: text.slice(at, at + world.pieceSize) };
      return { value: { code: kept.length === 0 ? 1 : 0, signal: null } };
    } finally {
      done();
    }
  };

  return world;
}

function isBundledReader(argv: readonly string[]): boolean {
  return (argv[0] ?? "").endsWith("/.local/bin/claude") && argv[1] === "--no-config";
}

function searchTarget(argv: readonly string[]): { patterns: string[]; path: string } | undefined {
  if (!isBundledReader(argv) && argv[0] !== "grep") return undefined;
  const patterns = argv.flatMap((arg, at) => (argv[at - 1] === "-e" ? [arg] : []));
  return { patterns, path: argv[argv.length - 1] ?? "" };
}

export function paddedTo(bytes: number, rows: string[]): string {
  const padding = JSON.stringify({
    type: "system",
    subtype: "padding",
    note: "x".repeat(PADDING_LINE_BYTES),
  });
  const count = Math.ceil(bytes / (padding.length + 1));
  const half = Math.floor(count / 2);
  return [
    ...Array<string>(half).fill(padding),
    ...rows,
    ...Array<string>(count - half).fill(padding),
  ].join("\n");
}
