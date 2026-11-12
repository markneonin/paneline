import { describe, expect, test } from "claude-code/testing";
import { callRowsOf, costOf } from "../hooks/transcript-cost";
import { sumsOf } from "./fixtures/transcript-memory-store";
import type { Sums, Tally } from "./fixtures/transcript-memory-store";
import { PRICES_PER_MTOK, oracleOf, priceOf, transcriptOf } from "./transcript-oracle";
import type { Oracle } from "./transcript-oracle";
import { OPUS, assistantLine, userLine } from "./fixtures/transcript-oracle";
import type { LineOptions } from "./fixtures/transcript-oracle";

const MILLION = 1_000_000;
const SMALL_OUTPUT = 1_000;
const MEDIUM_OUTPUT = 3_000;
const GROWN_OUTPUT = 5_000;
const SEARCH_COUNT = 3;
const HAIKU = "claude-haiku-5-5";
const HAIKU_AT_LIMIT = 100_000;
const HAIKU_OVER_LIMIT = 100_001;
const HAIKU_CACHE_PROMPT_INPUT = 50_000;
const HAIKU_CACHE_PROMPT_READ = 60_000;
const SONNET = "claude-sonnet-5-5";
const SYNTHETIC = "<synthetic>";
const UNKNOWN_MODEL = "claude-mystery-9";
const CUT_TAIL_CHARS = 40;
const MICROS_PER_USD = 100_000_000;

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const NOW = new Date(2026, 9, 29, 12, 0, 0).getTime();
const DAY_START = new Date(NOW).setHours(0, 0, 0, 0);
const AN_HOUR_AGO = NOW - MS_PER_HOUR;
const THREE_DAYS_AGO = NOW - 3 * MS_PER_DAY;
const TWENTY_DAYS_AGO = NOW - 20 * MS_PER_DAY;
const TEN_DAYS_AGO = NOW - 10 * MS_PER_DAY;
const THIRTY_ONE_DAYS_AGO = NOW - 31 * MS_PER_DAY;
const TWO_HOURS_AGO = NOW - 2 * MS_PER_HOUR;
const THIRTY_MINUTES_AGO = NOW - 30 * MS_PER_MINUTE;
const YESTERDAY_LATE = new Date(2026, 9, 28, 23, 30, 0).getTime();
const TODAY_EARLY = new Date(2026, 9, 29, 1, 0, 0).getTime();
const A_FEW_MS = 1_000;
const EARLIER_BY_MS = 5_000;
const FUTURE_BY_MS = MS_PER_HOUR;

const CONTAINERS = ["-home-dev"];
const WORK_CONTAINERS = ["-home-dev", "-home-dev-work"];
const SCRATCHPAD_DIR =
  "-private-tmp-claude-502--home-dev-proj-3a7c8722-93a4-4648-b3f0-b1a7e5bb660f-scratchpad-w1";

type TranscriptText = { path: string; lines: readonly string[] };
type Read = TranscriptText & { start: number };
type Figures = {
  usd: number;
  advisorUsd: number;
  calls: number;
  input: number;
  output: number;
  write5m: number;
  write1h: number;
  read: number;
};
type Summary = {
  today: Figures;
  week: Figures;
  month: Figures;
  sessions: { key: string; main: Figures; subagents: Figures }[];
  projects: ({ name: string } & Figures)[];
  unknownModels: ({ name: string } & Figures)[];
};

describe("transcript cost", () => {
  test("A1 the owner with two projects sees every total and each project's 30 day figure match the transcripts", () => {
    const files = [
      textOf("-home-dev-alpha/s1.jsonl", [
        assistantLine({ id: "a1", at: AN_HOUR_AGO, input: MILLION }),
        assistantLine({ id: "a2", at: THREE_DAYS_AGO, output: MILLION }),
        assistantLine({ id: "a3", at: TWENTY_DAYS_AGO, input: MILLION }),
      ]),
      textOf("-home-dev-beta/s2.jsonl", [
        assistantLine({ id: "b1", at: AN_HOUR_AGO, read: MILLION }),
        assistantLine({ id: "b2", at: TEN_DAYS_AGO, write1h: MILLION }),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf));

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files)));
  });

  test("A2 a worktree and a scratchpad folder of one project count under that project", () => {
    const files = [
      textOf("-home-dev-proj/s1.jsonl", [
        assistantLine({ id: "m1", at: AN_HOUR_AGO, input: MILLION }),
      ]),
      textOf("-home-dev-proj-wt-1/s2.jsonl", [
        assistantLine({ id: "w1", at: AN_HOUR_AGO, output: MILLION }),
      ]),
      textOf(`${SCRATCHPAD_DIR}/s3.jsonl`, [
        assistantLine({ id: "p1", at: AN_HOUR_AGO, read: MILLION }),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf));

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files)));
  });

  test("A3 a session's subagent calls, including a nested workflows folder, count under that session", () => {
    const files = [
      textOf("-home-dev-proj/s1.jsonl", [
        assistantLine({ id: "main1", at: AN_HOUR_AGO, input: MILLION, sessionId: "s1" }),
      ]),
      textOf("-home-dev-proj/s1/subagents/agent-a.jsonl", [
        assistantLine({ id: "sub1", at: AN_HOUR_AGO, output: MILLION, sessionId: "s1" }),
      ]),
      textOf("-home-dev-proj/s1/subagents/workflows/wf_1/agent-b.jsonl", [
        assistantLine({ id: "sub2", at: AN_HOUR_AGO, output: MILLION, sessionId: "s1" }),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf));

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files)));
  });

  test("A4 a resumed session that repeats earlier calls counts each call once", () => {
    const earlier = [
      assistantLine({ id: "x", at: TWO_HOURS_AGO, input: MILLION, sessionId: "s1" }),
      assistantLine({ id: "y", at: AN_HOUR_AGO, output: MILLION, sessionId: "s1" }),
    ];
    const files = [
      textOf("-home-dev-proj/s1.jsonl", earlier),
      textOf("-home-dev-proj/s2.jsonl", [
        ...earlier,
        assistantLine({ id: "z", at: THIRTY_MINUTES_AGO, input: MILLION, sessionId: "s2" }),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf));

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files)));
  });

  test("A5 a call copied into another session's file is credited to the session that wrote it", () => {
    const files = [
      textOf("-home-dev-scratch/a-copy.jsonl", [
        userLine(AN_HOUR_AGO - EARLIER_BY_MS),
        writtenBy("z-original", "msg_shared"),
      ]),
      textOf("-home-dev-proj/z-original.jsonl", [
        userLine(AN_HOUR_AGO - A_FEW_MS),
        writtenBy("z-original", "msg_shared"),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf));

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files)));
  });

  test("A6 a call in two sessions' files that neither wrote is credited to the session that started first", () => {
    const files = [
      textOf("-home-dev-proj/late.jsonl", [
        userLine(AN_HOUR_AGO - A_FEW_MS),
        assistantLine({ id: "msg_x", at: AN_HOUR_AGO, input: MILLION }),
      ]),
      textOf("-home-dev-other/early.jsonl", [
        userLine(AN_HOUR_AGO - EARLIER_BY_MS),
        assistantLine({ id: "msg_x", at: AN_HOUR_AGO, input: MILLION }),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf));

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files)));
  });

  test("A7 a session started in a parent folder keeps its own row and absorbs no project under it", () => {
    const files = [
      textOf("-home-dev-work/s1.jsonl", [
        assistantLine({ id: "c1", at: AN_HOUR_AGO, input: MILLION }),
      ]),
      textOf("-home-dev-work-app/s2.jsonl", [
        assistantLine({ id: "c2", at: AN_HOUR_AGO, output: MILLION }),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf), WORK_CONTAINERS);

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files, WORK_CONTAINERS)));
  });

  test("A8 an Opus call in fast mode costs double", () => {
    const files = [
      textOf("-home-dev-proj/s1.jsonl", [
        assistantLine({
          id: "f1",
          at: AN_HOUR_AGO,
          input: MILLION,
          output: MILLION,
          speed: "fast",
        }),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf));

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files)));
  });

  test("A9 a call in the US region costs 1.1 times the standard price", () => {
    const files = [
      textOf("-home-dev-proj/s1.jsonl", [
        assistantLine({ id: "u1", at: AN_HOUR_AGO, input: MILLION, output: MILLION, geo: "us" }),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf));

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files)));
  });

  test("A10 each web search adds one cent", () => {
    const files = [
      textOf("-home-dev-proj/s1.jsonl", [
        assistantLine({ id: "s1", at: AN_HOUR_AGO, searches: SEARCH_COUNT }),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf));

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files)));
  });

  test("A11 cache writes of 5 minutes and of 1 hour are each priced at their own rate", () => {
    const files = [
      textOf("-home-dev-proj/s1.jsonl", [
        assistantLine({ id: "w5", at: AN_HOUR_AGO, write5m: MILLION }),
        assistantLine({ id: "w1h", at: AN_HOUR_AGO, write1h: MILLION }),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf));

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files)));
  });

  test("A12 cache reads are priced at the cache read rate", () => {
    const files = [
      textOf("-home-dev-proj/s1.jsonl", [
        assistantLine({ id: "r1", at: AN_HOUR_AGO, read: MILLION }),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf));

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files)));
  });

  test("A13 an advisor sub-call is priced at its own model, added to its call, and counted as advisor spend", () => {
    const files = [
      textOf("-home-dev-proj/s1.jsonl", [
        assistantLine({
          id: "adv",
          at: AN_HOUR_AGO,
          input: MILLION,
          advisors: [{ model: SONNET, output: MILLION }],
        }),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf));

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files)));
  });

  test("A14 a model missing from the price table is listed as unknown with its tokens and costs nothing", () => {
    const files = [
      textOf("-home-dev-proj/s1.jsonl", [
        assistantLine({ id: "n1", at: AN_HOUR_AGO, model: UNKNOWN_MODEL, input: MILLION }),
        assistantLine({ id: "k1", at: AN_HOUR_AGO, input: MILLION }),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf));

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files)));
  });

  test("A15 a synthetic-model call costs nothing and is not listed as unknown", () => {
    const files = [
      textOf("-home-dev-proj/s1.jsonl", [
        assistantLine({ id: "syn", at: AN_HOUR_AGO, model: SYNTHETIC, input: MILLION }),
        assistantLine({ id: "k1", at: AN_HOUR_AGO, input: MILLION }),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf));

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files)));
  });

  test("A16 a call streamed as several lines with growing output is counted once, at its largest output", () => {
    const files = [
      textOf("-home-dev-proj/s1.jsonl", [
        assistantLine({ id: "g1", at: AN_HOUR_AGO, output: SMALL_OUTPUT }),
        assistantLine({ id: "g1", at: AN_HOUR_AGO, output: GROWN_OUTPUT }),
        assistantLine({ id: "g1", at: AN_HOUR_AGO, output: MEDIUM_OUTPUT }),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf));

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files)));
  });

  test("A17 a call whose top-level usage is zero is priced from the tokens of its message", () => {
    const files = [
      textOf("-home-dev-proj/s1.jsonl", [
        assistantLine({
          id: "z1",
          at: AN_HOUR_AGO,
          input: MILLION,
          output: MILLION,
          isTopLevelZeroed: true,
        }),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf));

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files)));
  });

  test("B1 a call from 23:30 yesterday is in the 7 day total and not in today's", () => {
    const files = [
      textOf("-home-dev-proj/s1.jsonl", [
        assistantLine({ id: "y1", at: YESTERDAY_LATE, input: MILLION }),
        assistantLine({ id: "t1", at: AN_HOUR_AGO, input: MILLION }),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf));

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files)));
  });

  test("B2 a call from 10 days ago is in the 30 day total and not in the 7 day total", () => {
    const files = [
      textOf("-home-dev-proj/s1.jsonl", [
        assistantLine({ id: "old10", at: TEN_DAYS_AGO, input: MILLION }),
        assistantLine({ id: "t1", at: AN_HOUR_AGO, input: MILLION }),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf));

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files)));
  });

  test("B3 a call from 31 days ago is in no total", () => {
    const files = [
      textOf("-home-dev-proj/s1.jsonl", [
        assistantLine({ id: "old31", at: THIRTY_ONE_DAYS_AGO, input: MILLION }),
        assistantLine({ id: "t1", at: AN_HOUR_AGO, input: MILLION }),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf));

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files)));
  });

  test("B4 a call dated after the current time is in no total", () => {
    const files = [
      textOf("-home-dev-proj/s1.jsonl", [
        assistantLine({ id: "future", at: NOW + FUTURE_BY_MS, input: MILLION }),
        assistantLine({ id: "t1", at: AN_HOUR_AGO, input: MILLION }),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf));

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files)));
  });

  test("B5 a call whose first line is from yesterday and whose repeat is from today is counted as yesterday's", () => {
    const files = [
      textOf("-home-dev-proj/s1.jsonl", [
        assistantLine({ id: "span", at: YESTERDAY_LATE, input: MILLION }),
        assistantLine({ id: "span", at: TODAY_EARLY, input: MILLION }),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf));

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files)));
  });

  test("B6 a Haiku 5.5 call with a 100,000 token prompt pays the short-prompt price", () => {
    const files = [
      textOf("-home-dev-proj/s1.jsonl", [
        assistantLine({ id: "h100", at: AN_HOUR_AGO, model: HAIKU, input: HAIKU_AT_LIMIT }),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf));

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files)));
  });

  test("B7 a Haiku 5.5 call with a 100,001 token prompt pays the long-prompt price", () => {
    const files = [
      textOf("-home-dev-proj/s1.jsonl", [
        assistantLine({ id: "h101", at: AN_HOUR_AGO, model: HAIKU, input: HAIKU_OVER_LIMIT }),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf));

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files)));
  });

  test("B8 a Haiku 5.5 prompt made mostly of cache reads over 100,000 tokens pays the long-prompt price", () => {
    const files = [
      textOf("-home-dev-proj/s1.jsonl", [
        assistantLine({
          id: "hc",
          at: AN_HOUR_AGO,
          model: HAIKU,
          input: HAIKU_CACHE_PROMPT_INPUT,
          read: HAIKU_CACHE_PROMPT_READ,
        }),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf));

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files)));
  });

  test("B9 the owner with no transcripts sees every total at zero and every list empty", () => {
    const sums = readerSumsOf([]);

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles([])));
  });

  test("E1 reading the same transcript a second time changes no total", () => {
    const file = readOf(
      textOf("-home-dev-proj/s1.jsonl", [
        assistantLine({ id: "e1", at: AN_HOUR_AGO, input: MILLION }),
        assistantLine({ id: "e2", at: AN_HOUR_AGO, output: MILLION }),
      ]),
    );

    const sums = readerSumsOf([file, file]);

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles([file])));
  });

  test("E2 the transcripts give the same totals whichever file is read first", () => {
    const copy = textOf("-home-dev-scratch/a-copy.jsonl", [
      userLine(AN_HOUR_AGO - EARLIER_BY_MS),
      writtenBy("z-original", "msg_shared"),
      assistantLine({ id: "msg_added", at: AN_HOUR_AGO + A_FEW_MS, input: MILLION }),
    ]);
    const writer = textOf("-home-dev-proj/z-original.jsonl", [
      userLine(AN_HOUR_AGO - A_FEW_MS),
      writtenBy("z-original", "msg_shared"),
    ]);

    const copyFirst = readerSumsOf([copy, writer].map(readOf));
    const writerFirst = readerSumsOf([writer, copy].map(readOf));

    expect(summaryOfSums(copyFirst)).toEqual(summaryOfOracle(oracleOfFiles([copy, writer])));
    expect(summaryOfSums(writerFirst)).toEqual(summaryOfOracle(oracleOfFiles([copy, writer])));
  });

  test("E3 a transcript read in two pieces, with a repeated call across the cut, gives the same totals as one read", () => {
    const lines = [
      assistantLine({ id: "p", at: AN_HOUR_AGO, output: SMALL_OUTPUT }),
      assistantLine({ id: "q", at: AN_HOUR_AGO, input: MILLION }),
      assistantLine({ id: "p", at: AN_HOUR_AGO, output: GROWN_OUTPUT }),
    ];
    const whole = textOf("-home-dev-proj/s1.jsonl", lines);
    const start = startOf(whole.lines);

    const sums = readerSumsOf([
      { path: whole.path, lines: whole.lines.slice(0, 2), start },
      { path: whole.path, lines: whole.lines.slice(2), start },
    ]);

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles([whole])));
  });

  test("E4 a user line carrying an assistant-shaped object with usage adds nothing", () => {
    const files = [
      textOf("-home-dev-proj/s1.jsonl", [
        userLineWithNestedAssistant(AN_HOUR_AGO - A_FEW_MS),
        assistantLine({ id: "real", at: AN_HOUR_AGO, input: MILLION }),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf));

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files)));
  });

  test("E5 a line cut in half or a line of plain text between valid calls adds nothing and the valid calls still count", () => {
    const whole = assistantLine({ id: "cut", at: AN_HOUR_AGO, input: MILLION });
    const files = [
      textOf("-home-dev-proj/s1.jsonl", [
        assistantLine({ id: "before", at: AN_HOUR_AGO, input: MILLION }),
        whole.slice(0, whole.length - CUT_TAIL_CHARS),
        "garbage that is not a transcript line",
        assistantLine({ id: "after", at: AN_HOUR_AGO, input: MILLION }),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf));

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files)));
  });

  test("E6 assistant lines without a message id, a model or a timestamp add nothing", () => {
    const valid = assistantLine({ id: "ok", at: AN_HOUR_AGO, input: MILLION });
    const files = [
      textOf("-home-dev-proj/s1.jsonl", [
        valid,
        lineWithout(assistantLine({ id: "no-id", at: AN_HOUR_AGO, input: MILLION }), "id"),
        lineWithout(assistantLine({ id: "no-model", at: AN_HOUR_AGO, input: MILLION }), "model"),
        lineWithout(assistantLine({ id: "no-time", at: AN_HOUR_AGO, input: MILLION }), "timestamp"),
      ]),
    ];

    const sums = readerSumsOf(files.map(readOf));

    expect(summaryOfSums(sums)).toEqual(summaryOfOracle(oracleOfFiles(files)));
  });
  test("F19 the cost of every call matches the independent price for each model in the table and each pricing variant", () => {
    const lines = Object.keys(PRICES_PER_MTOK).flatMap(variantLinesOf);
    const rows = callRowsOf(lines, { path: "-home-dev-proj/s1.jsonl", start: AN_HOUR_AGO });
    const calls = transcriptOf(lines).calls;

    const priced = rows
      .map((row) => ({ id: row.id, usd: Math.round(costOf(row) * MICROS_PER_USD) }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const expected = calls
      .map((call) => ({ id: call.id, usd: Math.round(priceOf(call).usd * MICROS_PER_USD) }))
      .sort((a, b) => a.id.localeCompare(b.id));

    expect(priced).toEqual(expected);
  });
});

function variantLinesOf(model: string): string[] {
  const plain: LineOptions = {
    id: "",
    at: AN_HOUR_AGO,
    model,
    input: MILLION,
    output: SMALL_OUTPUT,
    write5m: SMALL_OUTPUT,
    write1h: SMALL_OUTPUT,
    read: SMALL_OUTPUT,
  };
  const variants: LineOptions[] = [
    plain,
    { ...plain, speed: "fast" },
    { ...plain, geo: "us" },
    { ...plain, searches: SEARCH_COUNT },
    { ...plain, advisors: [{ model: SONNET, input: MILLION, output: SMALL_OUTPUT }] },
    { ...plain, input: HAIKU_AT_LIMIT, output: SMALL_OUTPUT },
    { ...plain, input: HAIKU_OVER_LIMIT, output: SMALL_OUTPUT },
  ];
  return variants.map((options, index) => assistantLine({ ...options, id: `${index}:${model}` }));
}

function textOf(path: string, lines: readonly string[]): TranscriptText {
  return { path, lines };
}

function startOf(lines: readonly string[]): number {
  const first = JSON.parse(lines[0] ?? "") as { timestamp: string };
  return Date.parse(first.timestamp);
}

function readOf(file: TranscriptText): Read {
  return { ...file, start: startOf(file.lines) };
}

function readerSumsOf(reads: readonly Read[], containers: readonly string[] = CONTAINERS): Sums {
  const rows = reads.flatMap((read) =>
    callRowsOf(read.lines, { path: read.path, start: read.start }),
  );
  return sumsOf(rows, { now: NOW, dayStart: DAY_START, containers });
}

function oracleOfFiles(
  files: readonly TranscriptText[],
  containers: readonly string[] = CONTAINERS,
): Oracle {
  const sources = files.map(({ path, lines }) => ({ path, ...transcriptOf(lines) }));
  return oracleOf(sources, { now: NOW, containers });
}

function writtenBy(sessionId: string, id: string): string {
  return assistantLine({ id, sessionId, at: AN_HOUR_AGO, input: MILLION });
}

function userLineWithNestedAssistant(at: number): string {
  return JSON.stringify({
    type: "user",
    timestamp: new Date(at).toISOString(),
    message: { role: "user", content: "tool result" },
    toolUseResult: {
      type: "assistant",
      message: {
        id: "msg_pasted",
        model: OPUS,
        usage: { input_tokens: MILLION, output_tokens: 0 },
      },
    },
  });
}

function lineWithout(line: string, field: "id" | "model" | "timestamp"): string {
  const entry = JSON.parse(line) as {
    timestamp?: string;
    message: { id?: string; model?: string };
  };
  if (field === "timestamp") delete entry.timestamp;
  else if (field === "id") delete entry.message.id;
  else delete entry.message.model;
  return JSON.stringify(entry);
}

function figuresOf(tally: Tally | Figures): Figures {
  return {
    usd: Math.round(tally.usd * MICROS_PER_USD),
    advisorUsd: Math.round(tally.advisorUsd * MICROS_PER_USD),
    calls: tally.calls,
    input: tally.input,
    output: tally.output,
    write5m: tally.write5m,
    write1h: tally.write1h,
    read: tally.read,
  };
}

function summaryOfSums(sums: Sums): Summary {
  return {
    today: figuresOf(sums.today),
    week: figuresOf(sums.week),
    month: figuresOf(sums.month),
    sessions: sums.sessions
      .map((row) => ({
        key: `${row.dir}/${row.sessionId}`,
        main: figuresOf(row.main),
        subagents: figuresOf(row.subagents),
      }))
      .sort(byKey),
    projects: sums.projects
      .filter((row) => row.calls > 0)
      .map((row) => ({ name: row.project, ...figuresOf(row) }))
      .sort(byName),
    unknownModels: sums.unknownModels
      .map((row) => ({ name: row.model, ...figuresOf(row) }))
      .sort(byName),
  };
}

function summaryOfOracle(oracle: Oracle): Summary {
  return {
    today: figuresOf(oracle.totals.today),
    week: figuresOf(oracle.totals.week),
    month: figuresOf(oracle.totals.month),
    sessions: oracle.sessions
      .map((row) => ({
        key: `${row.projectDir}/${row.sessionId}`,
        main: figuresOf(row.windows.lifetime.main),
        subagents: figuresOf(row.windows.lifetime.subagents),
      }))
      .sort(byKey),
    projects: [...oracle.byRepo]
      .filter(([, tally]) => tally.calls > 0)
      .map(([name, tally]) => ({ name, ...figuresOf(tally) }))
      .sort(byName),
    unknownModels: [...oracle.unknownModels]
      .map(([name, tally]) => ({ name, ...figuresOf(tally) }))
      .sort(byName),
  };
}

function byKey(a: { key: string }, b: { key: string }): number {
  return a.key.localeCompare(b.key);
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}
