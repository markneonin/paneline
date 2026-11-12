import { describe, expect, mock, test } from "claude-code/testing";
import type { On, PromptOrigin } from "claude-code";
import type { Engine } from "claude-code/testing";

import { paneInk } from "../hooks/pane-ink";
import { collect, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import {
  TRANSCRIPT as HISTORY_TRANSCRIPT,
  historyWorldOf,
  startFreshSession,
} from "./history-transcript";
import { COLUMNS as PANE_COLUMNS, openPane, settle } from "./spend-world";
import type { Pane } from "./spend-world";
import { shownTexts } from "./skills-tree";
import { ENGINE_READ_LIMIT, paddedTo, transcriptWorld } from "./transcript-world";

const COLUMNS = 80;
const TRANSCRIPT = "/h/u/.claude/projects/p/session.jsonl";
const APPENDED_AT = new Date(2026, 9, 28, 9, 5).getTime();
const LATER_AT = new Date(2026, 9, 28, 14, 30).getTime();
const EARLIER_AT = new Date(2026, 9, 27, 7, 3);
const EARLIER_REPLY_AT = new Date(2026, 9, 27, 7, 4);
const BIG_BYTES = ENGINE_READ_LIMIT + 1024 * 1024;
const TIME_SHAPE = /\b\d\d:\d\d\b/;
const COMPOSER: PromptOrigin = { kind: "composer" };
const TASK: PromptOrigin = { kind: "task-notification" };
const PEER: PromptOrigin = { kind: "peer" };
const LONG_ROW_COUNT = 4000;
const FILLER_AT = new Date(2026, 9, 26, 12, 0);
const SCROLLED_AT = new Date(2026, 9, 27, 8, 15);
const MOUNTED_MESSAGES = 3;
const MAX_TAB_PRESSES = 12;
const SLOW_TEST_MS = 30_000;
const READING = "reading transcript…";

describe("message times", () => {
  test("M1 a message you just sent shows its time in muted text beside USER", async ($, on) => {
    const world = worldOf(on);
    await appendUser($, "m1-user", "M1 first words");

    const tree = await drawnOf(await mountUser($, "m1-user", "M1 first words"));

    expect(timeTextsOf(tree)).toEqual([{ text: "09:05", color: paneInk().muted }]);
    expect(world.drawnRowsOf(tree)).toContain("USER");
  });

  test("M2 a Claude reply shows the time it arrived in muted text beside CLAUDE", async ($, on) => {
    const world = worldOf(on);
    await world.clock.set(LATER_AT);
    await appendReply($, "m2-reply", "M2 plain answer");

    const tree = await drawnOf(await mountReply($, "m2-reply", "M2 plain answer", true));

    expect(timeTextsOf(tree)).toEqual([{ text: "14:30", color: paneInk().muted }]);
    expect(world.drawnRowsOf(tree)).toContain("CLAUDE");
  });

  test("M3 only the first block of a long reply shows the time", async ($, on) => {
    worldOf(on);
    await appendReply($, "m3-block-a", "M3 first block");
    await appendReply($, "m3-block-b", "M3 second block");

    const first = await drawnOf(await mountReply($, "m3-block-a", "M3 first block", true));
    const second = await drawnOf(await mountReply($, "m3-block-b", "M3 second block", false));

    expect(timeTextsOf(first)).toHaveLength(1);
    expect(timeTextsOf(second)).toEqual([]);
  });

  test("M4 a resumed session shows the times its transcript recorded", async ($, on) => {
    const world = worldOf(on);
    world.transcript.set(TRANSCRIPT, transcriptOf());
    await $.classic.SessionStart({ source: "resume", transcript_path: TRANSCRIPT });
    const user = await mountUser($, "old-user", "M4 old question");
    const reply = await mountReply($, "old-reply", "M4 old answer", true);
    await settled(world);

    expect(timeTextsOf(await drawnOf(user)).map(({ text }) => text)).toEqual(["07:03"]);
    expect(timeTextsOf(await drawnOf(reply)).map(({ text }) => text)).toEqual(["07:04"]);
  });

  test("M5 a forked session shows the times its transcript recorded", async ($, on) => {
    const world = worldOf(on);
    world.transcript.set(TRANSCRIPT, transcriptOf());
    await $.classic.SessionStart({ source: "fork", transcript_path: TRANSCRIPT });
    const user = await mountUser($, "old-user", "M5 old question");
    await settled(world);

    expect(timeTextsOf(await drawnOf(user)).map(({ text }) => text)).toEqual(["07:03"]);
  });

  test("M6 a message with no known time is drawn as before, without any time", async ($, on) => {
    worldOf(on);

    const user = await drawnOf(await mountUser($, "m6-unknown-user", "M6 question"));
    const reply = await drawnOf(await mountReply($, "m6-unknown-reply", "M6 answer", true));

    expect(timeTextsOf(user)).toEqual([]);
    expect(timeTextsOf(reply)).toEqual([]);
  });

  test("M7 a time that arrives after the reply was first drawn shows on the next draw", async ($, on) => {
    worldOf(on);
    const reply = await mountReply($, "m7-late", "M7 late answer", true);
    expect(timeTextsOf(await drawnOf(reply))).toEqual([]);

    await appendReply($, "m7-late", "M7 late answer");
    await reply.redraw({ text: "M7 late answer", isFirstOfReply: true });

    expect(timeTextsOf(await drawnOf(reply)).map(({ text }) => text)).toEqual(["09:05"]);
  });

  test("M8 a sub-agent's message shows its time too", async ($, on) => {
    worldOf(on);
    await appendUser($, "m8-agent-user", "M8 agent question", "a1");

    const tree = await drawnOf(await mountUser($, "m8-agent-user", "M8 agent question"));

    expect(timeTextsOf(tree).map(({ text }) => text)).toEqual(["09:05"]);
  });

  test("M9 an unreadable transcript leaves old messages without a time while new ones still show theirs", async ($, on) => {
    const world = worldOf(on);
    await $.classic.SessionStart({ source: "resume", transcript_path: TRANSCRIPT });
    await appendUser($, "m9-new-user", "M9 new question");

    const oldUser = await mountUser($, "old-user", "M9 old question");
    await settled(world);
    const old = await drawnOf(oldUser);
    const fresh = await drawnOf(await mountUser($, "m9-new-user", "M9 new question"));

    expect(timeTextsOf(old)).toEqual([]);
    expect(textOf(old)).toContain("M9 old question");
    expect(timeTextsOf(fresh).map(({ text }) => text)).toEqual(["09:05"]);
  });

  test("M10 a garbled or time-less transcript row does not stop the other rows from showing theirs", async ($, on) => {
    const world = worldOf(on);
    world.transcript.set(
      TRANSCRIPT,
      ["not json at all", JSON.stringify({ type: "user", uuid: "no-time" }), transcriptOf()].join(
        "\n",
      ),
    );
    await $.classic.SessionStart({ source: "resume", transcript_path: TRANSCRIPT });
    const user = await mountUser($, "old-user", "M10 old question");
    const blank = await mountUser($, "no-time", "M10 timeless");
    await settled(world);

    expect(timeTextsOf(await drawnOf(user)).map(({ text }) => text)).toEqual(["07:03"]);
    expect(timeTextsOf(await drawnOf(blank))).toEqual([]);
  });

  test("M14 resuming a transcript over 4 MiB shows the times it recorded, as a small one does", async ($, on) => {
    const world = worldOf(on);
    world.transcript.set(TRANSCRIPT, paddedTo(BIG_BYTES, [transcriptOf()]));
    await $.classic.SessionStart({ source: "resume", transcript_path: TRANSCRIPT });
    const user = await mountUser($, "old-user", "M14 old question");
    const reply = await mountReply($, "old-reply", "M14 old answer", true);
    await settled(world);

    expect(timeTextsOf(await drawnOf(user)).map(({ text }) => text)).toEqual(["07:03"]);
    expect(timeTextsOf(await drawnOf(reply)).map(({ text }) => text)).toEqual(["07:04"]);
  });

  test("M15 a row of a transcript over 4 MiB cut in two by the reader still shows its time", async ($, on) => {
    const world = worldOf(on);
    world.transcripts.pieceSize = 25;
    world.transcript.set(TRANSCRIPT, paddedTo(BIG_BYTES, [transcriptOf()]));
    await $.classic.SessionStart({ source: "resume", transcript_path: TRANSCRIPT });
    const user = await mountUser($, "old-user", "M15 old question");
    await settled(world);

    expect(timeTextsOf(await drawnOf(user)).map(({ text }) => text)).toEqual(["07:03"]);
  });

  test("M11 a prompt over 4000 characters shows its time in muted text like a short one", async ($, on) => {
    worldOf(on);
    const text = `M11 ${"long prompt words ".repeat(300)}`;
    await appendUser($, "m11-user", text);

    const tree = await drawnOf(await mountUser($, "m11-user", text));

    expect(timeTextsOf(tree)).toEqual([{ text: "09:05", color: paneInk().muted }]);
  });

  test("M12 a reply over 60000 characters shows its time on its first block", async ($, on) => {
    worldOf(on);
    const text = `M12 ${"huge reply words ".repeat(4000)}`;
    await appendReply($, "m12-reply", text);
    await appendReply($, "m12-later", text);

    const first = await drawnOf(await mountReply($, "m12-reply", text, true));
    const next = await drawnOf(await mountReply($, "m12-later", text, false));

    expect(timeTextsOf(first).map(({ text: shown }) => shown)).toEqual(["09:05"]);
    expect(timeTextsOf(next)).toEqual([]);
  });

  test("M13 a notification or a peer's message shows the engine's own row, with no USER label and no time", async ($, on) => {
    const world = worldOf(on);
    await appendFrom($, "m13-task", "M13 task summary", TASK);
    await appendFrom($, "m13-peer", "M13 peer words", PEER);

    const task = await drawnOf(await mountUser($, "m13-task", "M13 task summary", TASK));
    const peer = await drawnOf(await mountUser($, "m13-peer", "M13 peer words", PEER));

    expect(world.drawnRowsOf(task)).toContain("engine prompt row");
    expect(world.drawnRowsOf(peer)).toContain("engine prompt row");
    expect(textOf(task)).not.toContain("USER");
    expect(textOf(task)).not.toMatch(TIME_SHAPE);
    expect(textOf(peer)).not.toContain("USER");
    expect(textOf(peer)).not.toMatch(TIME_SHAPE);
  });

  test("M16 a resumed session of about 4,000 rows shows the times of the messages on screen", async ($, on) => {
    const world = worldOf(on);
    world.transcript.set(TRANSCRIPT, longTranscriptOf());
    await $.classic.SessionStart({ source: "resume", transcript_path: TRANSCRIPT });
    const user = await mountUser($, "old-user", "M16 old question");
    const reply = await mountReply($, "old-reply", "M16 old answer", true);
    await settled(world);

    expect(timeTextsOf(await drawnOf(user)).map(({ text }) => text)).toEqual(["07:03"]);
    expect(timeTextsOf(await drawnOf(reply)).map(({ text }) => text)).toEqual(["07:04"]);
  });

  test("M17 a message scrolled up to in a resumed long session shows its time once it is drawn", async ($, on) => {
    const world = worldOf(on);
    world.transcript.set(TRANSCRIPT, longTranscriptOf());
    await $.classic.SessionStart({ source: "resume", transcript_path: TRANSCRIPT });
    const latest = await mountReply($, "old-reply", "M17 latest answer", true);
    await settled(world);
    const scrolled = await mountUser($, "late-user", "M17 scrolled question");
    await settled(world);

    expect(timeTextsOf(await drawnOf(latest)).map(({ text }) => text)).toEqual(["07:04"]);
    expect(timeTextsOf(await drawnOf(scrolled)).map(({ text }) => text)).toEqual(["08:15"]);
  });

  test(
    "M18 resuming a 4,000-row session writes a time only for the messages on screen",
    { timeoutMs: SLOW_TEST_MS },
    async ($, on) => {
      const world = worldOf(on);
      const writes = { count: 0 };
      on("state.set", (_$, e, next) => {
        if (e.key === "messageAt") writes.count += 1;
        return next(e);
      });
      world.transcript.set(TRANSCRIPT, longTranscriptOf());
      await $.classic.SessionStart({ source: "resume", transcript_path: TRANSCRIPT });
      const user = await mountUser($, "old-user", "M18 old question");
      const reply = await mountReply($, "old-reply", "M18 old answer", true);
      const scrolled = await mountUser($, "late-user", "M18 scrolled question");
      await settled(world);

      expect(timeTextsOf(await drawnOf(user)).map(({ text }) => text)).toEqual(["07:03"]);
      expect(timeTextsOf(await drawnOf(reply)).map(({ text }) => text)).toEqual(["07:04"]);
      expect(timeTextsOf(await drawnOf(scrolled)).map(({ text }) => text)).toEqual(["08:15"]);
      expect(writes.count).toBeLessThanOrEqual(MOUNTED_MESSAGES);
    },
  );

  test(
    "M19 a pane tab pressed while the transcript is still being read is drawn before the read ends",
    { timeoutMs: SLOW_TEST_MS },
    async ($, on) => {
      const world = historyWorldOf(on);
      world.transcripts.files.set(HISTORY_TRANSCRIPT, paddedTo(BIG_BYTES, [transcriptOf()]));
      const release = world.transcripts.pause();
      const pane = await openPane($, PANE_COLUMNS);
      await startFreshSession($, world);
      const resuming = $.classic.SessionStart({
        source: "resume",
        transcript_path: HISTORY_TRANSCRIPT,
      });
      await world.transcripts.readHeld();

      await showTab(pane, "History");
      const texts = shownTexts(await pane.drawn());
      release();
      await resuming;
      await world.transcripts.readsFinished();
      await world.clock.advance(1000);

      expect(texts).toContain(READING);
    },
  );
});

async function settled(world: {
  transcripts: { readsFinished: () => Promise<void> };
  clock: { advance: (ms: number) => Promise<unknown> };
}): Promise<void> {
  await world.clock.advance(1000);
  await world.transcripts.readsFinished();
  await world.clock.advance(1000);
}

function longTranscriptOf(): string {
  const filler = Array.from({ length: LONG_ROW_COUNT }, (_, at) =>
    JSON.stringify({
      type: at % 2 === 0 ? "user" : "assistant",
      uuid: `filler-${at}`,
      timestamp: FILLER_AT.toISOString(),
    }),
  );
  filler.splice(
    LONG_ROW_COUNT / 2,
    0,
    JSON.stringify({ type: "user", uuid: "late-user", timestamp: SCROLLED_AT.toISOString() }),
  );
  return [...filler, transcriptOf()].join("\n");
}

function transcriptOf(): string {
  return [
    JSON.stringify({ type: "user", uuid: "old-user", timestamp: EARLIER_AT.toISOString() }),
    JSON.stringify({
      type: "assistant",
      uuid: "old-reply",
      timestamp: EARLIER_REPLY_AT.toISOString(),
    }),
  ].join("\n");
}

function timeTextsOf(tree: Node): { text: string; color: unknown }[] {
  return collect(tree, "Text")
    .filter((node) => TIME_SHAPE.test(textOf(node)) && collect(node, "Text").length === 1)
    .map((node) => ({ text: textOf(node).trim(), color: node.props?.color }));
}

function appendUser($: Engine, uuid: string, text: string, agentId?: string) {
  return $.session.append({
    message: { type: "user", role: "user", content: [{ type: "text", text }] },
    door: "prompt",
    origin: { kind: "composer" },
    uuid,
    ...(agentId === undefined ? {} : { agentId }),
  });
}

function appendFrom($: Engine, uuid: string, text: string, origin: PromptOrigin) {
  return $.session.append({
    message: { type: "user", role: "user", content: [{ type: "text", text }] },
    door: "prompt",
    origin,
    uuid,
  });
}

function appendReply($: Engine, uuid: string, text: string) {
  return $.session.append({
    message: { type: "assistant", role: "assistant", content: [{ type: "text", text }] },
    door: "response",
    origin: { kind: "model", model: "claude-opus-5-5" },
    uuid,
  });
}

function mountUser($: Engine, requestId: string, text: string, origin: PromptOrigin = COMPOSER) {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "UserMessage",
    props: { text, origin, isExpanded: false },
    requestId,
    viewport: { columns: COLUMNS, rows: 24 },
  });
}

function mountReply($: Engine, requestId: string, text: string, isFirstOfReply: boolean) {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "AssistantMessage",
    props: { text, isFirstOfReply },
    requestId,
    viewport: { columns: COLUMNS, rows: 24 },
  });
}

async function drawnOf(ui: { drawn(): Promise<unknown> }): Promise<Node> {
  return (await ui.drawn()) as Node;
}

async function showTab(pane: Pane, label: string): Promise<void> {
  for (let press = 0; press < MAX_TAB_PRESSES; press++) {
    const buttons = await pane.findAll({ type: "Button" });
    const tab = buttons.find((button) => button.props.label === label);
    const next = buttons.find((button) => String(button.props.label).includes("›"));
    const target = tab ?? next;
    expect(target, `a ${label} tab button or the › arrow`).toBeDefined();
    await pane.press({ key: target?.key ?? "" });
    await settle(pane);
    if (tab !== undefined) return;
  }
}

function worldOf(on: On) {
  const clock = mock.clock(on, { now: APPENDED_AT });
  mock.env(on, { HOME: "/h/u" });
  const transcripts = transcriptWorld(on);
  on("process.spawn", async function* (_$, e, next) {
    if (!transcripts.isReader(e.argv)) return yield* next(e);
    return yield* transcripts.serve(e.argv);
  });
  on("config.list", () => ({ value: [{ key: "theme", value: "dark" }] }) as never);
  on("classic.SessionStart", () => ({}));
  on("settings.read", () => ({ value: {} }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.model", () => ({ value: "claude-opus-5-5" }));
  on("session.cwd", () => ({ value: "/work" }));
  on("session.id", () => ({ value: "s1" }));
  on("fs.write", () => ({ value: undefined }));
  on("fs.list", () => ({ value: [] }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("command.register", () => ({ value: {} }) as never);
  on("agent.list", () => ({ value: [] }));
  on("process.run", () => ({ value: { exitCode: 1, stdout: "", stderr: "" } }) as never);
  on("fs.exists", () => ({ value: true }));
  on("ui.render", { component: "UserMessage" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine prompt row</Text>;
  });
  on("ui.render", { component: "AssistantMessage" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine reply row</Text>;
  });
  return {
    clock,
    transcripts,
    transcript: transcripts.files,
    drawnRowsOf: (tree: Node) => collect(tree, "Text").map(textOf),
  };
}
