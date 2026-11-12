import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

import {
  SUBSCRIPTION,
  OPUS,
  settle,
  startFreshSession as startCostedSession,
  worldOf,
} from "./spend-world";
import type { Pane, World } from "./spend-world";
import { diskOf } from "./fixtures/transcript-disk";
import type { Disk } from "./fixtures/transcript-disk";
import { transcriptSqlite } from "./fixtures/transcript-sqlite";
import type { TranscriptSqlite } from "./fixtures/transcript-sqlite";
import { transcriptWorld } from "./transcript-world";
import type { TranscriptWorld } from "./transcript-world";

export const CLAUDE_HOME = "/h/u/.claude";
export const PROJECTS = `${CLAUDE_HOME}/projects`;
export const TRANSCRIPT = `${PROJECTS}/p/session-one.jsonl`;
export const SESSION_DIR = `${PROJECTS}/p/session-one`;
const COMPOSER = { kind: "composer" };

export type Output = string | (() => Promise<void>);
export type Spawn = {
  argv: readonly string[];
  env: Record<string, string> | undefined;
  isFinished: boolean;
};
export type Spawning = {
  transcriptReads: string[];
  transcriptSpawns: Pick<Spawn, "argv" | "env">[];
  searches: Record<string, Output[]>;
  searchSpawns: Spawn[];
  toasts: string[];
  transcriptFailures: string[];
};
export type IndexWorld = {
  disk: Disk;
  db: TranscriptSqlite;
  indexSpawns: string[][];
  sqlite: { isMissing: boolean; hold: Promise<void> | undefined };
};
export type HistoryWorld = World & {
  spawning: Spawning;
  transcripts: TranscriptWorld;
  index: IndexWorld;
};
export type Message = {
  door: "prompt" | "command" | "note" | "response";
  id: string;
  text: string;
  origin?: object;
  agentId?: string;
};

export function historyWorldOf(on: On, isIndexed = false): HistoryWorld {
  const index = indexOf(on, isIndexed);
  const world = worldOf(on, SUBSCRIPTION);
  on("turn.start", (_$, e) => ({ turnId: e.turnId }));
  on("fs.write", () => ({ value: undefined }));
  on("fs.list", () => ({ value: [] }));
  const transcripts = transcriptWorld(on);
  on("fs.stat", (_$, e) => {
    if (!transcripts.files.has(e.path)) return { deny: "no such file" };
    return { value: { kind: "file", size: 0, mtimeMs: 0, isLink: false } } as never;
  });
  const spawning: Spawning = {
    transcriptReads: [],
    transcriptSpawns: [],
    searches: {},
    searchSpawns: [],
    toasts: [],
    transcriptFailures: [],
  };
  on("ui.toast", (_$, e) => {
    spawning.toasts.push(e.text);
    return { value: undefined };
  });
  on("process.spawn", async function* (_$, e) {
    if (e.argv[0] === "find" || e.argv[0] === "sh") {
      index.indexSpawns.push([...e.argv]);
      return { value: yield* index.disk.run({ argv: e.argv }) };
    }
    if (e.argv.includes("-e")) {
      spawning.transcriptSpawns.push({ argv: e.argv, env: e.env });
      const path = e.argv[e.argv.length - 1] ?? "";
      spawning.transcriptReads.push(path);
      if (!transcripts.files.has(path)) return { value: { code: 2, signal: null } };
      const failure = spawning.transcriptFailures.shift();
      if (failure !== undefined) throw new Error(failure);
      return yield* transcripts.serve(e.argv);
    }
    const spawn: Spawn = { argv: e.argv, env: e.env, isFinished: false };
    spawning.searchSpawns.push(spawn);
    for (const output of spawning.searches[e.argv[e.argv.indexOf("--") + 1] ?? ""] ?? []) {
      if (typeof output === "function") await output();
      else yield { stream: "stdout", text: output };
    }
    spawn.isFinished = true;
    return { value: { code: 0, signal: null } };
  });
  return Object.assign(world, { spawning, transcripts, index });
}

function indexOf(on: On, isIndexed: boolean): IndexWorld {
  const disk = diskOf(CLAUDE_HOME);
  const { db, answer } = transcriptSqlite();
  const index: IndexWorld = {
    disk,
    db,
    indexSpawns: [],
    sqlite: { isMissing: false, hold: undefined },
  };
  if (!isIndexed) return index;
  on("process.run", { argv: /sqlite3/ }, async (_$, e) => {
    await index.sqlite.hold;
    if (index.sqlite.isMissing)
      return {
        value: {
          exitCode: 127,
          stdout: "",
          isStdoutTruncated: false,
          isStderrTruncated: false,
          stderr: "sh: sqlite3: not found",
        },
      };
    return {
      value: {
        exitCode: 0,
        stdout: answer(e.init?.stdin ?? ""),
        isStdoutTruncated: false,
        isStderrTruncated: false,
        stderr: "",
      },
    };
  });
  on("ui.log", () => ({ value: undefined }));
  return index;
}

export function appendCallLine(world: HistoryWorld, line: string, agent?: string): void {
  if (agent === undefined) {
    appendTranscriptRow(world, line);
    return;
  }
  const path = `p/session-one/subagents/${agent}.jsonl`;
  world.index.disk.writeLines(path, [line], world.clock.now());
}

export async function startIndexedSession($: Engine, world: HistoryWorld): Promise<void> {
  await $.session.start({ cwd: "/work", surface: "terminal", isInteractive: true });
  await world.clock.advance(1000);
}

export async function startFreshSession($: Engine, world: HistoryWorld): Promise<void> {
  await $.classic.SessionStart({ source: "startup", transcript_path: TRANSCRIPT } as never);
  world.transcriptPath = TRANSCRIPT;
  await startCostedSession($, world);
}

export async function appendMessage(
  $: Engine,
  world: HistoryWorld,
  message: Message,
): Promise<void> {
  const origin =
    message.origin ?? (message.door === "prompt" ? COMPOSER : { kind: "model", model: OPUS });
  await $.session.append({
    message: {
      type: message.door === "response" ? "assistant" : "user",
      content: [{ type: "text", text: message.text }],
    },
    door: message.door,
    origin,
    uuid: message.id,
    ...(message.agentId === undefined ? {} : { agentId: message.agentId }),
  } as never);
  appendTranscriptRow(world, transcriptRowOf(world, message));
  await world.clock.advance(1000);
}

export function jsonlRow(row: object): string {
  return JSON.stringify(row);
}

export function appendTranscriptRow(world: HistoryWorld, row: string): void {
  const path = world.transcriptPath ?? TRANSCRIPT;
  const file = world.transcripts.files.get(path);
  if (typeof file === "object") return;
  const content = file === undefined || file === "" ? row : `${file}\n${row}`;
  world.transcripts.files.set(path, content);
  if (path.startsWith(`${PROJECTS}/`))
    world.index.disk.writeLines(
      path.slice(PROJECTS.length + 1),
      content.split("\n"),
      world.clock.now(),
    );
}

export function rewriteTranscript(world: HistoryWorld, from: string, to: string): void {
  for (const [path, file] of world.transcripts.files)
    if (typeof file === "string") world.transcripts.files.set(path, file.replace(from, to));
}

function transcriptRowOf(world: World, message: Message): string {
  const base = {
    uuid: message.id,
    timestamp: new Date(world.clock.now()).toISOString(),
    ...(message.agentId === undefined ? {} : { isSidechain: true }),
  };
  if (message.door === "response")
    return jsonlRow({
      type: "assistant",
      ...base,
      message: { role: "assistant", content: [{ type: "text", text: message.text }] },
    });
  return jsonlRow({
    type: "user",
    ...base,
    ...(message.door === "prompt" ? { origin: message.origin ?? COMPOSER } : {}),
    message: { role: "user", content: message.text },
  });
}

const SETTLE_TICKS = 300;
const SETTLE_ROUNDS = 5;

export async function untilSettled(pane: Pane): Promise<void> {
  for (let round = 0; round < SETTLE_ROUNDS; round++) {
    for (let tick = 0; tick < SETTLE_TICKS; tick++) await Promise.resolve();
    await settle(pane);
  }
}
