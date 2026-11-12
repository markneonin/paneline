import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

const FIRST_PATH = "/home/first.jsonl";
const SECOND_PATH = "/home/second.jsonl";
const SESSION_START = { cwd: "/work", surface: "terminal", isInteractive: true } as const;
const FROM_START = 0;
const COLOR_ENTRY = '"type":"agent-color"';
const RED_LINE = colorLine("red");
const BLUE_HEAD = '{"type":"agent-co';
const BLUE_TAIL = 'lor","agentColor":"blue"}\n';
const BLUE_LINE = colorLine("blue");
const PLAIN_LINES = '{"type":"user","text":"hello"}\n{"type":"assistant","text":"hi"}\n';

type Scan = { from: number; length: number };

type World = {
  files: Map<string, string>;
  scans: Scan[];
  colorsWritten: () => string[];
};

describe("the colour check reads only what a transcript gained", () => {
  test("P2-1 lines without a colour are skipped by the next check and the colour stays", async ($, on) => {
    const world = worldOf(on, { [FIRST_PATH]: RED_LINE });
    await $.session.start(SESSION_START);
    await $.classic.Stop(stop(FIRST_PATH));
    world.files.set(FIRST_PATH, RED_LINE + PLAIN_LINES);
    await $.classic.Stop(stop(FIRST_PATH));

    await $.classic.Stop(stop(FIRST_PATH));

    expect(world.scans).toEqual([
      { from: FROM_START, length: byteLength(RED_LINE) },
      { from: byteLength(RED_LINE), length: byteLength(PLAIN_LINES) },
    ]);
    expect(world.colorsWritten()).toEqual(["red"]);
  });

  test("P2-2 a colour line added to the transcript changes the chips", async ($, on) => {
    const world = worldOf(on, { [FIRST_PATH]: RED_LINE });
    await $.session.start(SESSION_START);
    await $.classic.Stop(stop(FIRST_PATH));
    world.files.set(FIRST_PATH, RED_LINE + PLAIN_LINES);
    await $.classic.Stop(stop(FIRST_PATH));
    world.files.set(FIRST_PATH, RED_LINE + PLAIN_LINES + BLUE_LINE);

    await $.classic.Stop(stop(FIRST_PATH));

    expect(world.colorsWritten()).toEqual(["red", "blue"]);
    expect(world.scans.at(-1)).toEqual({
      from: byteLength(RED_LINE + PLAIN_LINES),
      length: byteLength(BLUE_LINE),
    });
  });

  test("P2-3 a transcript cut shorter is read whole again", async ($, on) => {
    const world = worldOf(on, { [FIRST_PATH]: RED_LINE + PLAIN_LINES });
    await $.session.start(SESSION_START);
    await $.classic.Stop(stop(FIRST_PATH));
    world.files.set(FIRST_PATH, RED_LINE + PLAIN_LINES + PLAIN_LINES);
    await $.classic.Stop(stop(FIRST_PATH));
    world.files.set(FIRST_PATH, BLUE_LINE);

    await $.classic.Stop(stop(FIRST_PATH));

    expect(world.scans.slice(-2)).toEqual([
      { from: byteLength(RED_LINE + PLAIN_LINES), length: byteLength(PLAIN_LINES) },
      { from: FROM_START, length: byteLength(BLUE_LINE) },
    ]);
    expect(world.colorsWritten()).toEqual(["red", "blue"]);
  });

  test("P2-4 a transcript path not seen before is read whole", async ($, on) => {
    const world = worldOf(on, { [FIRST_PATH]: RED_LINE, [SECOND_PATH]: BLUE_LINE });
    await $.session.start(SESSION_START);
    await $.classic.Stop(stop(FIRST_PATH));
    await $.classic.Stop(stop(FIRST_PATH));

    await $.classic.Stop(stop(SECOND_PATH));

    expect(world.scans).toEqual([
      { from: FROM_START, length: byteLength(RED_LINE) },
      { from: FROM_START, length: byteLength(BLUE_LINE) },
    ]);
    expect(world.colorsWritten()).toEqual(["red", "blue"]);
  });

  test("P2-5 a colour line finished after a check that saw half of it still changes the chips", async ($, on) => {
    const world = worldOf(on, { [FIRST_PATH]: RED_LINE + BLUE_HEAD });
    await $.session.start(SESSION_START);
    await $.classic.Stop(stop(FIRST_PATH));
    world.files.set(FIRST_PATH, RED_LINE + BLUE_HEAD + BLUE_TAIL);

    await $.classic.Stop(stop(FIRST_PATH));

    expect(world.colorsWritten()).toEqual(["red", "blue"]);
  });
});

function colorLine(agentColor: string): string {
  return `{"type":"agent-color","agentColor":"${agentColor}","sessionId":"s"}\n`;
}

function worldOf(on: On, initial: Record<string, string>): World {
  mock.clock(on);
  mock.env(on, { HOME: "/home" });
  const files = new Map(Object.entries(initial));
  const scans: Scan[] = [];
  const writes: { key: string; value: unknown }[] = [];
  on("state.set", (_$, e, next) => {
    writes.push({ key: e.key, value: e.value });
    return next(e);
  });
  const stored = new Map<string, unknown>();
  on("store.get", (_$, e) => ({ value: stored.get(e.key) }));
  on("store.set", (_$, e) => {
    stored.set(e.key, e.value);
    return { value: undefined };
  });
  on("config.list", () => ({ value: [{ key: "theme", value: "dark" }] }) as never);
  on("session.id", () => ({ value: "session-1" }));
  on("session.model", () => ({ value: "claude-opus-5-5" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: "/work" }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("command.register", () => ({ value: {} }) as never);
  on("agent.list", () => ({ value: [] }));
  on("classic.SessionStart", () => ({}));
  on("classic.UserPromptSubmit", () => ({}));
  on("classic.PostModelSwitch", () => ({}));
  on("classic.CwdChanged", () => ({}));
  on("classic.Stop", () => ({}));
  on("command.run", () => ({}));
  on("classic.PostToolUse", () => ({}));
  on("fs.stat", (_$, e) => {
    const content = files.get(e.path);
    if (content === undefined) throw new Error("no such file");
    return {
      value: { kind: "file", size: byteLength(content), mtimeMs: 0, isLink: false },
    } as never;
  });
  on("fs.read", (_$, e) => {
    const content = files.get(e.path);
    if (content === undefined) throw new Error("no such file");
    const asBytes = (e as { as?: string }).as === "bytes";
    return { value: asBytes ? { base64: btoa(binaryOf(content)) } : content };
  });
  on("process.run", (_$, e) => {
    if (!e.argv.join(" ").includes(COLOR_ENTRY))
      return { value: { exitCode: 1, stdout: "", stderr: "" } } as never;
    const path = e.argv.find((arg) => files.has(arg)) ?? "";
    const bytes = new TextEncoder().encode(files.get(path) ?? "");
    const from = e.argv[0] === "grep" ? FROM_START : Number(e.argv[4]) - 1;
    const length = e.argv[0] === "grep" ? bytes.length : Number(e.argv[7]);
    scans.push({ from, length });
    const range = new TextDecoder().decode(bytes.slice(from, from + length));
    const complete = range.split("\n");
    const unfinished = complete.pop() ?? "";
    const matches = complete.filter((line) => line.includes(COLOR_ENTRY));
    const countLine = e.argv[0] === "grep" ? "" : `${byteLength(unfinished)}\n`;
    return {
      value: {
        exitCode: 0,
        stdout: matches.map((line) => `${line}\n`).join("") + countLine,
        stderr: "",
      },
    } as never;
  });
  return {
    files,
    scans,
    colorsWritten: () =>
      writes
        .filter((write) => write.key.includes("sessionColor"))
        .map((write) => write.value as string)
        .filter((value) => value !== "default"),
  };
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function binaryOf(text: string): string {
  return String.fromCharCode(...new TextEncoder().encode(text));
}

function stop(path: string): Parameters<Engine["classic"]["Stop"]>[0] {
  return { stop_hook_active: false, effort: { level: "high" }, transcript_path: path };
}
