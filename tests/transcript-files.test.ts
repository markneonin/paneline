import { describe, expect, test } from "claude-code/testing";
import { indexTranscripts } from "../hooks/transcript-files";
import type { IndexOptions, ProcessRunner } from "../hooks/transcript-files";
import { memoryCostStore } from "./fixtures/transcript-memory-store";
import type { MemoryCostStore } from "./fixtures/transcript-memory-store";
import { oracleOf, transcriptOf } from "./transcript-oracle";
import { assistantLine } from "./fixtures/transcript-oracle";
import {
  CLAUDE_ROOT,
  cutInsideCharacter,
  diskOf,
  fileBytes,
  lineByteLength,
  textLine,
} from "./fixtures/transcript-disk";
import type { Disk } from "./fixtures/transcript-disk";
import { summaryOfOracle, summaryOfSums } from "./fixtures/transcript-summary";
import type { Summary } from "./fixtures/transcript-summary";

const MILLION = 1_000_000;
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const NOW = new Date(2026, 9, 29, 12, 0, 0).getTime();
const DAY_START = new Date(NOW).setHours(0, 0, 0, 0);
const A_FEW_MS = 1_000;
const AN_HOUR_AGO = NOW - MS_PER_HOUR;
const TWO_HOURS_AGO = NOW - 2 * MS_PER_HOUR;
const THIRTY_MINUTES_AGO = NOW - 30 * MS_PER_MINUTE;
const TWENTY_NINE_DAYS_AGO = NOW - 29 * MS_PER_DAY;
const THIRTY_ONE_DAYS_AGO = NOW - 31 * MS_PER_DAY;
const RECENT = NOW - MS_PER_HOUR;
const JUST_NOW = NOW - A_FEW_MS;
const CONTAINERS = ["-home-dev"];
const PROJECT = "-home-dev-proj/s1.jsonl";
const RESUMED = "-home-dev-proj/s2.jsonl";
const SUBAGENT = "-home-dev-proj/s1/subagents/agent-a.jsonl";
const NESTED_SUBAGENT = "-home-dev-proj/s1/subagents/workflows/wf_1/agent-b.jsonl";
const STALE = "-home-dev-old/s9.jsonl";
const ALPHA = "-home-dev-alpha/s1.jsonl";
const BETA = "-home-dev-beta/s2.jsonl";
const PIECE_CHARACTERS = 7;
const FOUR_MIB = 4 * 1024 * 1024;
const BIG_CALL_COUNT = 10_000;
const CUT_INTO_LINE = 10;
const CYRILLIC_LETTER = "П";
const TEXT_WITH_LETTERS = "Привет, мир 🙂";
const NOTES_REPEATS = 50;
const EMPTY_SESSION = "-home-dev-proj/s3.jsonl";
const TOUCHED_SESSION = "-home-dev-proj/s4.jsonl";
const VANISHING = "-home-dev-gone/s5.jsonl";
const OWN = "-home-dev-proj/s7.jsonl";
const STREAMED_CALLS = 5;
const STREAM_PIECE_CHARACTERS = 300;
const NARROW_PIECE_CHARACTERS = 40;
const SMALL_OUTPUT = 1_000;
const GROWN_OUTPUT = 5_000;
const THREE_HOURS_AGO = NOW - 3 * MS_PER_HOUR;

type FileText = { path: string; lines: readonly string[] };
type IndexResult = { read: number; failed: number };

describe("transcript files", () => {
  test("F1 the owner indexes again with nothing changed and no session file is read again", async () => {
    const lines = [assistantLine({ id: "f1-a", at: AN_HOUR_AGO, input: MILLION })];
    const disk = diskOf();
    const store = memoryCostStore();
    disk.writeLines(PROJECT, lines, RECENT);

    await indexOnce(disk, store);
    const readAgain = (await indexOnce(disk, store)).read;

    expect(readAgain).toBe(0);
    expect(summaryOf(store)).toEqual(expectedOf([{ path: PROJECT, lines }]));
  });

  test("F2 a session file that grows is read from its old end and Russian and emoji text on both sides count correctly", async () => {
    const before = [
      textLine(TWO_HOURS_AGO, "Привет, мир 🙂"),
      assistantLine({ id: "f2-a", at: TWO_HOURS_AGO + A_FEW_MS, input: MILLION }),
    ];
    const added = [
      textLine(AN_HOUR_AGO, "Ещё текст 🚀"),
      assistantLine({ id: "f2-b", at: AN_HOUR_AGO, output: MILLION }),
    ];
    const disk = diskOf();
    const store = memoryCostStore();
    disk.writeLines(PROJECT, before, RECENT);
    await indexOnce(disk, store);
    const servedBefore = disk.bytesServed();
    disk.writeLines(PROJECT, [...before, ...added], JUST_NOW);

    const readAgain = (await indexOnce(disk, store)).read;

    expect(readAgain).toBe(1);
    expect(disk.bytesServed() - servedBefore).toBe(fileBytes(added).length);
    expect(summaryOf(store)).toEqual(expectedOf([{ path: PROJECT, lines: [...before, ...added] }]));
  });

  test("F3 a session file rewritten shorter with the same calls is read again from its start and no call is counted twice", async () => {
    const calls = [
      assistantLine({ id: "f3-a", at: TWO_HOURS_AGO, input: MILLION }),
      assistantLine({ id: "f3-b", at: AN_HOUR_AGO, output: MILLION }),
    ];
    const notes = textLine(TWO_HOURS_AGO - A_FEW_MS, "заметки ".repeat(NOTES_REPEATS));
    const disk = diskOf();
    const store = memoryCostStore();
    disk.writeLines(PROJECT, [notes, ...calls], RECENT);
    await indexOnce(disk, store);
    disk.writeLines(PROJECT, calls, JUST_NOW);
    const servedBefore = disk.bytesServed();

    const readAgain = (await indexOnce(disk, store)).read;

    expect(readAgain).toBe(1);
    expect(disk.bytesServed() - servedBefore).toBe(fileBytes(calls).length);
    expect(summaryOf(store)).toEqual(expectedOf([{ path: PROJECT, lines: calls }]));
  });

  test("F4 subagent files that appear later, one of them in a nested workflows folder, count under their session", async () => {
    const main = [
      assistantLine({ id: "f4-main", at: TWO_HOURS_AGO, input: MILLION, sessionId: "s1" }),
    ];
    const subagent = [
      assistantLine({ id: "f4-sub", at: AN_HOUR_AGO, output: MILLION, sessionId: "s1" }),
    ];
    const nested = [
      assistantLine({ id: "f4-nested", at: THIRTY_MINUTES_AGO, read: MILLION, sessionId: "s1" }),
    ];
    const disk = diskOf();
    const store = memoryCostStore();
    disk.writeLines(PROJECT, main, RECENT);
    await indexOnce(disk, store);
    disk.writeLines(SUBAGENT, subagent, RECENT);
    disk.writeLines(NESTED_SUBAGENT, nested, RECENT);

    const readAgain = (await indexOnce(disk, store)).read;

    expect(readAgain).toBe(2);
    expect(summaryOf(store)).toEqual(
      expectedOf([
        { path: PROJECT, lines: main },
        { path: SUBAGENT, lines: subagent },
        { path: NESTED_SUBAGENT, lines: nested },
      ]),
    );
  });

  test("F5 a session file last written 31 days ago is not read and adds nothing to the day, week or month totals", async () => {
    const recent = [assistantLine({ id: "f5-new", at: AN_HOUR_AGO, input: MILLION })];
    const stale = [assistantLine({ id: "f5-old", at: THIRTY_ONE_DAYS_AGO, input: MILLION })];
    const disk = diskOf();
    const store = memoryCostStore();
    disk.writeLines(PROJECT, recent, RECENT);
    disk.writeLines(STALE, stale, THIRTY_ONE_DAYS_AGO);

    const readCount = (await indexOnce(disk, store)).read;

    expect(readCount).toBe(1);
    expect(windowsOf(summaryOf(store))).toEqual(
      windowsOf(
        expectedOf([
          { path: PROJECT, lines: recent },
          { path: STALE, lines: stale },
        ]),
      ),
    );
  });

  test("F6 a session file last written 29 days ago is read and its call counts in the month total", async () => {
    const older = [assistantLine({ id: "f6-old", at: TWENTY_NINE_DAYS_AGO, input: MILLION })];
    const disk = diskOf();
    const store = memoryCostStore();
    disk.writeLines(PROJECT, older, TWENTY_NINE_DAYS_AGO);

    const readCount = (await indexOnce(disk, store)).read;

    expect(readCount).toBe(1);
    expect(summaryOf(store)).toEqual(expectedOf([{ path: PROJECT, lines: older }]));
  });

  test("F7 a session with more than 4 MiB of call lines is counted to its last call", async () => {
    const calls = Array.from({ length: BIG_CALL_COUNT }, (_, index) =>
      assistantLine({
        id: `f7-${index}`,
        at: TWO_HOURS_AGO - index * A_FEW_MS,
        input: MILLION,
        output: index,
      }),
    );
    expect(fileBytes(calls).length).toBeGreaterThan(FOUR_MIB);
    const disk = diskOf();
    const store = memoryCostStore();
    disk.writeLines(PROJECT, calls, RECENT);

    const readCount = (await indexOnce(disk, store)).read;

    expect(readCount).toBe(1);
    expect(summaryOf(store)).toEqual(expectedOf([{ path: PROJECT, lines: calls }]));
  });

  test("F8 a session resumed into a new file counts its repeated call once across two indexes", async () => {
    const earlier = [
      assistantLine({ id: "f8-x", at: TWO_HOURS_AGO, input: MILLION, sessionId: "s1" }),
      assistantLine({ id: "f8-y", at: AN_HOUR_AGO, output: MILLION, sessionId: "s1" }),
    ];
    const resumed = [
      ...earlier,
      assistantLine({ id: "f8-z", at: THIRTY_MINUTES_AGO, read: MILLION, sessionId: "s2" }),
    ];
    const disk = diskOf();
    const store = memoryCostStore();
    disk.writeLines(PROJECT, earlier, RECENT);
    await indexOnce(disk, store);
    disk.writeLines(RESUMED, resumed, JUST_NOW);

    const readCount = (await indexOnce(disk, store)).read;

    expect(readCount).toBe(1);
    expect(summaryOf(store)).toEqual(
      expectedOf([
        { path: PROJECT, lines: earlier },
        { path: RESUMED, lines: resumed },
      ]),
    );
  });

  test("F9 an index interrupted while reading the second transcript is finished by the next index without double counting", async () => {
    const alpha = [assistantLine({ id: "f9-a", at: TWO_HOURS_AGO, input: MILLION })];
    const beta = [assistantLine({ id: "f9-b", at: AN_HOUR_AGO, output: MILLION })];
    const disk = diskOf();
    const store = memoryCostStore();
    disk.writeLines(ALPHA, alpha, RECENT);
    disk.writeLines(BETA, beta, RECENT);
    disk.interruptRead(BETA);
    await indexOnce(disk, store).catch(() => undefined);

    await indexOnce(disk, store);

    expect(summaryOf(store)).toEqual(
      expectedOf([
        { path: ALPHA, lines: alpha },
        { path: BETA, lines: beta },
      ]),
    );
  });

  test("F10 output that arrives in pieces cutting through lines and characters counts each call once", async () => {
    const lines = interruptedTranscript();
    const disk = diskOf();
    const store = memoryCostStore();
    disk.writeLines(PROJECT, lines, RECENT);
    disk.pieceCharacters(PIECE_CHARACTERS);

    await indexOnce(disk, store);

    expect(summaryOf(store)).toEqual(expectedOf([{ path: PROJECT, lines }]));
  });

  test("F11 a transcript that cannot be read any more does not stop the index and the rest still count", async () => {
    const alpha = [assistantLine({ id: "f11-a", at: TWO_HOURS_AGO, input: MILLION })];
    const beta = [assistantLine({ id: "f11-b", at: AN_HOUR_AGO, output: MILLION })];
    const disk = diskOf();
    const store = memoryCostStore();
    disk.writeLines(ALPHA, alpha, RECENT);
    disk.writeLines(BETA, beta, RECENT);
    disk.failRead(BETA, Number.POSITIVE_INFINITY);

    const result = await indexOnce(disk, store);

    expect(result.failed).toBe(1);
    expect(summaryOf(store)).toEqual(expectedOf([{ path: ALPHA, lines: alpha }]));
  });

  test("F12 a transcript whose read fails once is counted by the next index", async () => {
    const alpha = [assistantLine({ id: "f12-a", at: TWO_HOURS_AGO, input: MILLION })];
    const beta = [assistantLine({ id: "f12-b", at: AN_HOUR_AGO, output: MILLION })];
    const disk = diskOf();
    const store = memoryCostStore();
    disk.writeLines(ALPHA, alpha, RECENT);
    disk.writeLines(BETA, beta, RECENT);
    disk.failRead(BETA, 1);
    const failedRun = await indexOnce(disk, store);
    const beforeRetry = summaryOf(store);

    const retryRun = await indexOnce(disk, store);

    expect(failedRun.failed).toBe(1);
    expect(retryRun.failed).toBe(0);
    expect(beforeRetry).toEqual(expectedOf([{ path: ALPHA, lines: alpha }]));
    expect(summaryOf(store)).toEqual(
      expectedOf([
        { path: ALPHA, lines: alpha },
        { path: BETA, lines: beta },
      ]),
    );
  });

  test("F20 an empty session file and a session file touched without new text are not read again", async () => {
    const touched = [assistantLine({ id: "f20-a", at: TWO_HOURS_AGO, input: MILLION })];
    const disk = diskOf();
    const store = memoryCostStore();
    disk.writeLines(EMPTY_SESSION, [], RECENT);
    disk.writeLines(TOUCHED_SESSION, touched, RECENT);
    await indexOnce(disk, store);
    const readsAfterFirst = disk.readsOf(TOUCHED_SESSION);
    disk.writeLines(TOUCHED_SESSION, touched, JUST_NOW);

    const touchedRun = await indexOnce(disk, store);
    const nextRun = await indexOnce(disk, store);

    expect(disk.readsOf(EMPTY_SESSION)).toBe(0);
    expect(touchedRun.failed).toBe(0);
    expect(disk.readsOf(TOUCHED_SESSION)).toBe(readsAfterFirst);
    expect(nextRun.read).toBe(0);
    expect(summaryOf(store)).toEqual(expectedOf([{ path: TOUCHED_SESSION, lines: touched }]));
  });

  test("F21 a session file that disappears while the index lists the folders does not stop the other transcripts from counting", async () => {
    const alpha = [assistantLine({ id: "f21-a", at: TWO_HOURS_AGO, input: MILLION })];
    const beta = [assistantLine({ id: "f21-b", at: AN_HOUR_AGO, output: MILLION })];
    const disk = diskOf();
    const store = memoryCostStore();
    disk.writeLines(ALPHA, alpha, RECENT);
    disk.writeLines(
      VANISHING,
      [assistantLine({ id: "f21-gone", at: AN_HOUR_AGO, read: MILLION })],
      RECENT,
    );
    disk.writeLines(BETA, beta, RECENT);
    disk.failStat(VANISHING);

    await indexOnce(disk, store);

    expect(summaryOf(store)).toEqual(
      expectedOf([
        { path: ALPHA, lines: alpha },
        { path: BETA, lines: beta },
      ]),
    );
  });

  test("F13 a session file that ends right after its first call counts that call, and the rest once it is written", async () => {
    const lines = interruptedTranscript();
    const cut = bytesThrough(lines, 1);

    const { whileWriting, afterWriting } = await readsAroundCut(lines, cut);

    expect(whileWriting).toEqual(
      expectedOf([{ path: PROJECT, lines: completeLinesBefore(lines, cut) }]),
    );
    expect(afterWriting).toEqual(expectedOf([{ path: PROJECT, lines }]));
  });

  test("F14 a file that ends right after a text line between two calls counts only the complete lines until the rest is written", async () => {
    const lines = interruptedTranscript();
    const cut = bytesThrough(lines, 2);

    const { whileWriting, afterWriting } = await readsAroundCut(lines, cut);

    expect(whileWriting).toEqual(
      expectedOf([{ path: PROJECT, lines: completeLinesBefore(lines, cut) }]),
    );
    expect(afterWriting).toEqual(expectedOf([{ path: PROJECT, lines }]));
  });

  test("F15 a file that ends inside its first call counts nothing until the rest is written", async () => {
    const lines = interruptedTranscript();
    const cut = bytesThrough(lines, 0) + CUT_INTO_LINE;

    const { whileWriting, afterWriting } = await readsAroundCut(lines, cut);

    expect(whileWriting).toEqual(
      expectedOf([{ path: PROJECT, lines: completeLinesBefore(lines, cut) }]),
    );
    expect(afterWriting).toEqual(expectedOf([{ path: PROJECT, lines }]));
  });

  test("F16 a file that ends inside a text line counts nothing from that line until the rest is written", async () => {
    const lines = interruptedTranscript();
    const cut = bytesThrough(lines, 1) + CUT_INTO_LINE;

    const { whileWriting, afterWriting } = await readsAroundCut(lines, cut);

    expect(whileWriting).toEqual(
      expectedOf([{ path: PROJECT, lines: completeLinesBefore(lines, cut) }]),
    );
    expect(afterWriting).toEqual(expectedOf([{ path: PROJECT, lines }]));
  });

  test("F17 a file that ends inside its last call does not count the partial call until the rest is written", async () => {
    const lines = interruptedTranscript();
    const cut = bytesThrough(lines, 2) + CUT_INTO_LINE;

    const { whileWriting, afterWriting } = await readsAroundCut(lines, cut);

    expect(whileWriting).toEqual(
      expectedOf([{ path: PROJECT, lines: completeLinesBefore(lines, cut) }]),
    );
    expect(afterWriting).toEqual(expectedOf([{ path: PROJECT, lines }]));
  });

  test("F18 a file that ends inside a two-byte Cyrillic character does not count the partial character until the rest is written", async () => {
    const lines = interruptedTranscript();
    const cut = bytesThrough(lines, 1) + cutInsideCharacter(lines[1] ?? "", CYRILLIC_LETTER);

    const { whileWriting, afterWriting } = await readsAroundCut(lines, cut);

    expect(whileWriting).toEqual(
      expectedOf([{ path: PROJECT, lines: completeLinesBefore(lines, cut) }]),
    );
    expect(afterWriting).toEqual(expectedOf([{ path: PROJECT, lines }]));
  });

  test("F22 output cut into one-character pieces gives whole call lines, one save per file and the resume point at the last full line", async () => {
    const lines = interruptedTranscript();
    const cut = bytesThrough(lines, 2) + CUT_INTO_LINE;
    const disk = diskOf();
    const store = memoryCostStore();
    disk.write(PROJECT, fileBytes(lines).subarray(0, cut), RECENT);
    disk.pieceCharacters(1);

    await indexOnce(disk, store);

    expect(store.saved().map(({ state }) => state.path)).toEqual([pathOf(PROJECT)]);
    expect(store.saved()[0]?.state.offset).toBe(bytesThrough(lines, 2));
    expect(store.saved()[0]?.state.start).toBe(TWO_HOURS_AGO);
    expect(summaryOf(store)).toEqual(
      expectedOf([{ path: PROJECT, lines: completeLinesBefore(lines, cut) }]),
    );
  });

  test("F23 the session the owner is in is read first, then the other changed sessions newest first", async () => {
    const call = (id: string) => [assistantLine({ id, at: TWO_HOURS_AGO, input: MILLION })];
    const disk = diskOf();
    const store = memoryCostStore();
    const readOrder: string[] = [];
    disk.writeLines(ALPHA, call("f23-a"), NOW - 3 * MS_PER_HOUR);
    disk.writeLines(OWN, call("f23-own"), NOW - 5 * MS_PER_HOUR);
    disk.writeLines(BETA, call("f23-b"), NOW - MS_PER_HOUR);
    const run = watchedRun(disk, { onReadStart: (path) => readOrder.push(path) });

    await indexWith(run, store, { ownSession: "s7" });

    expect(
      readOrder.map((path) => path.slice(path.indexOf("projects/") + "projects/".length)),
    ).toEqual([OWN, BETA, ALPHA]);
  });

  test("F24 a run with one unreadable file ends with every byte counted and one failure, leaves no saved row for it, and the retry reads it", async () => {
    const alpha = [assistantLine({ id: "f24-a", at: TWO_HOURS_AGO, input: MILLION })];
    const beta = [
      assistantLine({ id: "f24-b", at: AN_HOUR_AGO, output: MILLION }),
      textLine(AN_HOUR_AGO, TEXT_WITH_LETTERS),
    ];
    const disk = diskOf();
    const store = memoryCostStore();
    disk.writeLines(ALPHA, alpha, RECENT);
    disk.writeLines(BETA, beta, RECENT);
    disk.writeLines(STALE, alpha, THIRTY_ONE_DAYS_AGO);
    disk.failRead(BETA, 1);

    await indexOnce(disk, store);
    const failedRun = lastOf(store.progressLog());
    const savedAfterFailure = (await store.files()).map(({ path }) => path);
    await indexOnce(disk, store);
    const retryRun = lastOf(store.progressLog());

    expect(failedRun).toEqual({
      doneBytes: sizeOf(alpha) + sizeOf(beta),
      totalBytes: sizeOf(alpha) + sizeOf(beta),
      failed: 1,
    });
    expect(savedAfterFailure).toEqual([pathOf(ALPHA)]);
    expect(retryRun).toEqual({
      doneBytes: sizeOf(alpha) + sizeOf(beta),
      totalBytes: sizeOf(alpha) + sizeOf(beta),
      failed: 0,
    });
  });

  test("F28 progress grows file by file during the index and ends complete", async () => {
    const small = [assistantLine({ id: "f28-s", at: TWO_HOURS_AGO, input: MILLION })];
    const large = [
      assistantLine({ id: "f28-l", at: AN_HOUR_AGO, output: MILLION }),
      textLine(AN_HOUR_AGO, "заметки ".repeat(NOTES_REPEATS)),
    ];
    const disk = diskOf();
    const store = memoryCostStore();
    disk.writeLines(ALPHA, small, RECENT);
    disk.writeLines(BETA, large, RECENT);
    const total = sizeOf(small) + sizeOf(large);

    await indexOnce(disk, store);

    const done = store.progressLog().map((progress) => progress.doneBytes);
    expect(done.some((bytes) => bytes > 0 && bytes < total)).toBe(true);
    expect(done).toEqual([...done].sort((a, b) => a - b));
    expect(lastOf(done)).toBe(total);
  });

  test("F29 an index with nothing changed still reports every found byte as done", async () => {
    const lines = [assistantLine({ id: "f29-a", at: AN_HOUR_AGO, input: MILLION })];
    const disk = diskOf();
    const store = memoryCostStore();
    disk.writeLines(PROJECT, lines, RECENT);
    await indexOnce(disk, store);
    const before = store.progressLog().length;

    await indexOnce(disk, store);

    expect(store.progressLog().slice(before)).not.toEqual([]);
    expect(lastOf(store.progressLog())).toEqual({
      doneBytes: sizeOf(lines),
      totalBytes: sizeOf(lines),
      failed: 0,
    });
  });

  test("F25 a session is saved with the folder of its first call, not of a later one", async () => {
    const lines = [
      textLine(TWO_HOURS_AGO, TEXT_WITH_LETTERS),
      assistantLine({ id: "f25-a", at: TWO_HOURS_AGO, input: MILLION, cwd: "/home/dev/proj" }),
      assistantLine({ id: "f25-b", at: AN_HOUR_AGO, output: MILLION, cwd: "/home/dev/proj/sub" }),
    ];
    const disk = diskOf();
    const store = memoryCostStore();
    disk.writeLines(PROJECT, lines, RECENT);

    await indexOnce(disk, store);

    expect((await store.files()).map(({ path, cwd }) => ({ path, cwd }))).toEqual([
      { path: pathOf(PROJECT), cwd: "/home/dev/proj" },
    ]);
  });

  test("F30 a session that grows keeps the folder of its first call, and gets one once its first call appears", async () => {
    const opening = [textLine(THREE_HOURS_AGO, TEXT_WITH_LETTERS)];
    const first = assistantLine({
      id: "f30-a",
      at: TWO_HOURS_AGO,
      input: MILLION,
      cwd: "/home/dev/proj",
    });
    const later = assistantLine({
      id: "f30-b",
      at: AN_HOUR_AGO,
      output: MILLION,
      cwd: "/home/dev/other",
    });
    const disk = diskOf();
    const store = memoryCostStore();
    const cwdNow = async () => (await store.files()).map(({ cwd }) => cwd);
    disk.writeLines(PROJECT, opening, RECENT);
    await indexOnce(disk, store);
    const withoutCalls = await cwdNow();
    disk.writeLines(PROJECT, [...opening, first], RECENT + A_FEW_MS);
    await indexOnce(disk, store);
    const afterFirstCall = await cwdNow();
    disk.writeLines(PROJECT, [...opening, first, later], RECENT + 2 * A_FEW_MS);
    await indexOnce(disk, store);

    expect(withoutCalls).toEqual([""]);
    expect(afterFirstCall).toEqual(["/home/dev/proj"]);
    expect(await cwdNow()).toEqual(["/home/dev/proj"]);
  });

  test("F26 with the Claude folder somewhere else the sessions in that folder are counted", async () => {
    const lines = [assistantLine({ id: "f26-a", at: AN_HOUR_AGO, input: MILLION })];
    const disk = diskOf("/cfg");
    const store = memoryCostStore();
    disk.writeLines(PROJECT, lines, RECENT);

    const result = await indexOnce(disk, store, { root: "/cfg" });

    expect(result.read).toBe(1);
    expect(summaryOf(store)).toEqual(expectedOf([{ path: PROJECT, lines }]));
  });

  test("F27 a long session is parsed while its output streams in, nothing is left to parse after the last piece", async () => {
    const calls = Array.from({ length: STREAMED_CALLS }, (_, index) =>
      assistantLine({ id: `f27-${index}`, at: TWO_HOURS_AGO - index * A_FEW_MS, input: MILLION }),
    );
    const disk = diskOf();
    disk.writeLines(PROJECT, calls, RECENT);
    disk.pieceCharacters(STREAM_PIECE_CHARACTERS);
    const parses = countingParses();
    const marks = { started: 0, ended: 0, saved: 0 };
    const store = memoryCostStore({ onSaveFile: () => (marks.saved = parses.count()) });
    const run = watchedRun(disk, {
      onReadStart: () => (marks.started = parses.count()),
      onReadEnd: () => (marks.ended = parses.count()),
    });

    try {
      await indexWith(run, store);
    } finally {
      parses.stop();
    }

    expect({
      parsedWhileStreaming: marks.ended - marks.started >= STREAMED_CALLS,
      parsedAfterStream: marks.saved - marks.ended,
    }).toEqual({ parsedWhileStreaming: true, parsedAfterStream: 0 });
  });

  test("F31 a call repeated in two different pieces counts once with its larger figures", async () => {
    const lines = [
      assistantLine({ id: "f31-a", at: TWO_HOURS_AGO, output: SMALL_OUTPUT }),
      textLine(AN_HOUR_AGO, TEXT_WITH_LETTERS),
      assistantLine({ id: "f31-a", at: TWO_HOURS_AGO, output: GROWN_OUTPUT }),
    ];
    const disk = diskOf();
    const store = memoryCostStore();
    disk.writeLines(PROJECT, lines, RECENT);
    disk.pieceCharacters(NARROW_PIECE_CHARACTERS);

    await indexOnce(disk, store);

    expect(summaryOf(store)).toEqual(expectedOf([{ path: PROJECT, lines }]));
    expect(summaryOf(store).month.calls).toBe(1);
  });
});

async function indexOnce(
  disk: Disk,
  store: MemoryCostStore,
  options: Partial<IndexOptions> = {},
): Promise<IndexResult> {
  return indexWith(disk.run, store, options);
}

async function indexWith(
  run: ProcessRunner,
  store: MemoryCostStore,
  options: Partial<IndexOptions> = {},
): Promise<IndexResult> {
  return indexTranscripts(run, store, { root: CLAUDE_ROOT, now: NOW, ownSession: "", ...options });
}

function watchedRun(
  disk: Disk,
  watcher: { onReadStart?: (path: string) => void; onReadEnd?: (path: string) => void },
): ProcessRunner {
  return (request) => {
    const inner = disk.run(request);
    if (request.argv[0] !== "sh") return inner;
    const path = request.argv[5] ?? "";
    watcher.onReadStart?.(path);
    async function* pieces(): AsyncGenerator<{ stream: "stdout" | "stderr"; text: string }> {
      for await (const piece of inner) yield piece;
      watcher.onReadEnd?.(path);
    }
    return Object.assign(pieces(), { result: inner.result }) as ReturnType<ProcessRunner>;
  };
}

function countingParses(): { count: () => number; stop: () => void } {
  const original = globalThis.JSON;
  let parses = 0;
  const counting: JSON = {
    parse: (...args: Parameters<typeof original.parse>): unknown => {
      parses += 1;
      return original.parse(...args) as unknown;
    },
    stringify: original.stringify.bind(original),
    [Symbol.toStringTag]: "JSON",
  };
  globalThis.JSON = counting;
  return {
    count: () => parses,
    stop: () => {
      globalThis.JSON = original;
    },
  };
}

function pathOf(session: string): string {
  return `${CLAUDE_ROOT}/projects/${session}`;
}

function sizeOf(lines: readonly string[]): number {
  return fileBytes(lines).length;
}

function lastOf<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1];
}

function summaryOf(store: MemoryCostStore): Summary {
  return summaryOfSums(store.sums({ now: NOW, dayStart: DAY_START, containers: CONTAINERS }));
}

function expectedOf(files: readonly FileText[]): Summary {
  const sources = files.map(({ path, lines }) => ({ path, ...transcriptOf(lines) }));
  return summaryOfOracle(oracleOf(sources, { now: NOW, containers: CONTAINERS }));
}

function windowsOf(summary: Summary): Pick<Summary, "today" | "week" | "month" | "projects"> {
  return {
    today: summary.today,
    week: summary.week,
    month: summary.month,
    projects: summary.projects,
  };
}

function interruptedTranscript(): string[] {
  return [
    assistantLine({ id: "cut-a", at: TWO_HOURS_AGO, input: MILLION }),
    textLine(AN_HOUR_AGO, TEXT_WITH_LETTERS),
    assistantLine({ id: "cut-b", at: THIRTY_MINUTES_AGO, output: MILLION }),
  ];
}

function bytesThrough(lines: readonly string[], count: number): number {
  return lines.slice(0, count).reduce((total, line) => total + lineByteLength(line), 0);
}

function completeLinesBefore(lines: readonly string[], cut: number): string[] {
  const complete: string[] = [];
  let end = 0;
  for (const line of lines) {
    end += lineByteLength(line);
    if (end > cut) break;
    complete.push(line);
  }
  return complete;
}

async function readsAroundCut(
  lines: readonly string[],
  cut: number,
): Promise<{ whileWriting: Summary; afterWriting: Summary }> {
  const disk = diskOf();
  const store = memoryCostStore();
  disk.write(PROJECT, fileBytes(lines).subarray(0, cut), RECENT);
  await indexOnce(disk, store);
  const whileWriting = summaryOf(store);
  disk.writeLines(PROJECT, lines, JUST_NOW);
  await indexOnce(disk, store);
  return { whileWriting, afterWriting: summaryOf(store) };
}
