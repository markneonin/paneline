import { describe, expect, test } from "claude-code/testing";
import { oracleOf, repoRollup, splitTotal, transcriptOf } from "./transcript-oracle";
import type { Oracle } from "./transcript-oracle";
import { assistantLine, userLine } from "./fixtures/transcript-oracle";

const MILLION = 1_000_000;
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const NOW = new Date(2026, 9, 29, 12, 0, 0).getTime();
const AN_HOUR_AGO = NOW - MS_PER_HOUR;
const TEN_DAYS_AGO = NOW - 10 * MS_PER_DAY;
const OPUS_INPUT_USD = 4;
const OPUS_OUTPUT_USD = 20;
const OPUS_WRITE_5M_USD = 5;
const OPUS_WRITE_1H_USD = 8;
const OPUS_FAST_OUTPUT_USD = 40;
const SONNET_US_OUTPUT_USD = 11;
const HAIKU_SHORT_PROMPT_USD = 0.005;
const HAIKU_LONG_PROMPT_USD = 0.075;
const YESTERDAY_LATE = new Date(2026, 9, 28, 23, 30, 0).getTime();
const THIRTY_ONE_DAYS_AGO = NOW - 31 * MS_PER_DAY;
const OPUS_READ_USD = 0.2;
const SEARCH_USD = 0.01;
const HAIKU_THRESHOLD = 100_000;
const HAIKU_AT_THRESHOLD_USD = 0.01;
const HAIKU_OVER_THRESHOLD_USD = 0.0500005;
const SONNET_INPUT_USD = 2;
const CONTAINERS = ["-home-dev"];

const MICROS_PER_USD = 100_000_000;

type Files = Record<string, string[]>;

function oracleOfFiles(files: Files): Oracle {
  const sources = Object.entries(files).map(([path, lines]) => ({
    path,
    ...transcriptOf(lines),
  }));
  return oracleOf(sources, { now: NOW, containers: CONTAINERS });
}

function micros(usd: number | undefined): number {
  return Math.round((usd ?? Number.NaN) * MICROS_PER_USD);
}

function monthUsdOf(oracle: Oracle, sessionId: string, part: "main" | "subagents"): number {
  const row = oracle.sessions.find((session) => session.sessionId === sessionId);
  return row?.windows.month[part].usd ?? Number.NaN;
}

describe("transcript oracle", () => {
  test("O1 an API call written as several lines counts once", () => {
    const line = assistantLine({ id: "msg_1", at: AN_HOUR_AGO, input: MILLION });

    const oracle = oracleOfFiles({
      "-home-dev-proj/s1.jsonl": [line, userLine(AN_HOUR_AGO), line, line],
    });

    expect(micros(oracle.totals.today.usd)).toBe(micros(OPUS_INPUT_USD));
    expect(oracle.totals.today.calls).toBe(1);
    expect(oracle.totals.today.input).toBe(MILLION);
  });

  test("O2 a subagent file counts toward its parent session", () => {
    const oracle = oracleOfFiles({
      "-home-dev-proj/s1.jsonl": [
        assistantLine({ id: "msg_main", at: AN_HOUR_AGO, input: MILLION }),
      ],
      "-home-dev-proj/s1/subagents/agent-a.jsonl": [
        assistantLine({ id: "msg_sub", at: AN_HOUR_AGO, output: MILLION }),
      ],
      "-home-dev-proj/s1/subagents/workflows/wf_1/agent-b.jsonl": [
        assistantLine({ id: "msg_deep", at: AN_HOUR_AGO, output: MILLION }),
      ],
    });

    expect(oracle.sessions).toHaveLength(1);
    expect(micros(monthUsdOf(oracle, "s1", "main"))).toBe(micros(OPUS_INPUT_USD));
    expect(micros(monthUsdOf(oracle, "s1", "subagents"))).toBe(micros(2 * OPUS_OUTPUT_USD));
    expect(micros(oracle.totals.month.usd)).toBe(micros(OPUS_INPUT_USD + 2 * OPUS_OUTPUT_USD));
  });

  test("O3 a resumed session that repeats earlier lines does not double count", () => {
    const first = assistantLine({ id: "msg_x", at: AN_HOUR_AGO - 2000, input: MILLION });
    const second = assistantLine({ id: "msg_y", at: AN_HOUR_AGO - 1000, input: MILLION });
    const third = assistantLine({ id: "msg_z", at: AN_HOUR_AGO, input: MILLION });

    const oracle = oracleOfFiles({
      "-home-dev-proj/s1.jsonl": [first, second],
      "-home-dev-proj/s2.jsonl": [first, second, third],
    });

    expect(oracle.totals.month.calls).toBe(3);
    expect(micros(oracle.totals.month.usd)).toBe(micros(3 * OPUS_INPUT_USD));
    const sessionTotals = oracle.sessions.map((row) => splitTotal(row.windows.month).usd);
    expect(micros(sessionTotals.reduce((total, usd) => total + usd, 0))).toBe(
      micros(3 * OPUS_INPUT_USD),
    );
  });

  test("O4 a call older than 7 days is in the 30 day total only", () => {
    const oracle = oracleOfFiles({
      "-home-dev-proj/s1.jsonl": [
        assistantLine({ id: "msg_old", at: TEN_DAYS_AGO, input: MILLION }),
      ],
    });

    expect(micros(oracle.totals.month.usd)).toBe(micros(OPUS_INPUT_USD));
    expect(oracle.totals.week.usd).toBe(0);
    expect(oracle.totals.today.usd).toBe(0);
  });

  test("O5 cache writes of 5 minutes and 1 hour are priced differently", () => {
    const oracle = oracleOfFiles({
      "-home-dev-proj/s1.jsonl": [
        assistantLine({ id: "msg_5m", at: AN_HOUR_AGO, write5m: MILLION }),
        assistantLine({ id: "msg_1h", at: AN_HOUR_AGO, write1h: MILLION }),
      ],
    });

    expect(micros(oracle.totals.today.usd)).toBe(micros(OPUS_WRITE_5M_USD + OPUS_WRITE_1H_USD));
    expect(oracle.totals.today.write5m).toBe(MILLION);
    expect(oracle.totals.today.write1h).toBe(MILLION);
  });

  test("O6 the synthetic model costs nothing and is not an unknown model", () => {
    const oracle = oracleOfFiles({
      "-home-dev-proj/s1.jsonl": [
        assistantLine({ id: "msg_syn", at: AN_HOUR_AGO, model: "<synthetic>", input: MILLION }),
      ],
    });

    expect(oracle.totals.today.usd).toBe(0);
    expect(oracle.unknownModels.size).toBe(0);
  });

  test("O7 a model missing from the price table is listed with its tokens and costs nothing", () => {
    const oracle = oracleOfFiles({
      "-home-dev-proj/s1.jsonl": [
        assistantLine({
          id: "msg_new",
          at: AN_HOUR_AGO,
          model: "claude-mystery-9",
          input: MILLION,
        }),
      ],
    });

    expect(oracle.totals.today.usd).toBe(0);
    expect(oracle.unknownModels.get("claude-mystery-9")?.input).toBe(MILLION);
  });

  test("O8 a Haiku 5.5 prompt over 100000 tokens pays the long prompt row", () => {
    const haiku = "claude-haiku-5-5";
    const oracle = oracleOfFiles({
      "-home-dev-proj/s1.jsonl": [
        assistantLine({ id: "msg_short", at: AN_HOUR_AGO, model: haiku, input: 50_000 }),
        assistantLine({ id: "msg_long", at: AN_HOUR_AGO, model: haiku, input: 150_000 }),
      ],
    });

    expect(micros(oracle.totals.today.usd)).toBe(
      micros(HAIKU_SHORT_PROMPT_USD + HAIKU_LONG_PROMPT_USD),
    );
  });

  test("O9 fast speed doubles the Opus price and the US region adds ten percent", () => {
    const oracle = oracleOfFiles({
      "-home-dev-proj/s1.jsonl": [
        assistantLine({ id: "msg_fast", at: AN_HOUR_AGO, output: MILLION, speed: "fast" }),
        assistantLine({
          id: "msg_us",
          at: AN_HOUR_AGO,
          model: "claude-sonnet-5-5",
          output: MILLION,
          geo: "us",
        }),
      ],
    });

    expect(micros(oracle.totals.today.usd)).toBe(
      micros(OPUS_FAST_OUTPUT_USD + SONNET_US_OUTPUT_USD),
    );
  });

  test("O10 a line whose usage is all zero does not hide the full line of the same call", () => {
    const oracle = oracleOfFiles({
      "-home-dev-proj/s1.jsonl": [
        assistantLine({ id: "msg_1", at: AN_HOUR_AGO }),
        assistantLine({ id: "msg_1", at: AN_HOUR_AGO + 1000, input: MILLION }),
      ],
    });

    expect(micros(oracle.totals.today.usd)).toBe(micros(OPUS_INPUT_USD));
    expect(oracle.totals.today.calls).toBe(1);
  });

  test("O11 a half-written last line is skipped", () => {
    const whole = assistantLine({ id: "msg_1", at: AN_HOUR_AGO, input: MILLION });

    const oracle = oracleOfFiles({
      "-home-dev-proj/s1.jsonl": [whole, whole.slice(0, whole.length / 2)],
    });

    expect(micros(oracle.totals.today.usd)).toBe(micros(OPUS_INPUT_USD));
  });

  test("O12 a worktree dir and a scratchpad dir roll into their repo and outside dirs stay unmapped", () => {
    const scratchpad =
      "-private-tmp-claude-502--home-dev-proj-3a7c8722-93a4-4648-b3f0-b1a7e5bb660f-scratchpad-w1";

    const rollup = repoRollup(
      ["-home-dev-proj", "-home-dev-proj-wt-1", "-home-dev-other", scratchpad, "-tmp-x"],
      CONTAINERS,
    );

    expect(rollup.repoOfDir.get("-home-dev-proj-wt-1")).toBe("-home-dev-proj");
    expect(rollup.repoOfDir.get(scratchpad)).toBe("-home-dev-proj");
    expect(rollup.repoOfDir.get("-home-dev-other")).toBe("-home-dev-other");
    expect(rollup.unmappedDirs).toContain("-tmp-x");
    expect(rollup.unmappedDirs).not.toContain("-home-dev-proj-wt-1");
  });

  test("O13 the 30 day total of a repo adds its worktree dirs", () => {
    const oracle = oracleOfFiles({
      "-home-dev-proj/s1.jsonl": [assistantLine({ id: "msg_a", at: AN_HOUR_AGO, input: MILLION })],
      "-home-dev-proj-wt-1/s2.jsonl": [
        assistantLine({ id: "msg_b", at: AN_HOUR_AGO, input: MILLION }),
      ],
    });

    expect(micros(oracle.byRepo.get("-home-dev-proj")?.usd)).toBe(micros(2 * OPUS_INPUT_USD));
    expect(micros(oracle.byDir.get("-home-dev-proj-wt-1")?.usd)).toBe(micros(OPUS_INPUT_USD));
  });

  test("O14 cache reads are priced at the cache read rate", () => {
    const oracle = oracleOfFiles({
      "-home-dev-proj/s1.jsonl": [assistantLine({ id: "msg_1", at: AN_HOUR_AGO, read: MILLION })],
    });

    expect(micros(oracle.totals.today.usd)).toBe(micros(OPUS_READ_USD));
    expect(oracle.totals.today.read).toBe(MILLION);
  });

  test("O15 each web search adds one cent", () => {
    const oracle = oracleOfFiles({
      "-home-dev-proj/s1.jsonl": [assistantLine({ id: "msg_1", at: AN_HOUR_AGO, searches: 3 })],
    });

    expect(micros(oracle.totals.today.usd)).toBe(micros(3 * SEARCH_USD));
  });

  test("O16 cache writes without a 5 minute and 1 hour split are priced as 5 minute writes", () => {
    const oracle = oracleOfFiles({
      "-home-dev-proj/s1.jsonl": [
        assistantLine({ id: "msg_1", at: AN_HOUR_AGO, write5m: MILLION, isUnsplit: true }),
      ],
    });

    expect(micros(oracle.totals.today.usd)).toBe(micros(OPUS_WRITE_5M_USD));
    expect(oracle.totals.today.write5m).toBe(MILLION);
    expect(oracle.totals.today.write1h).toBe(0);
  });

  test("O17 a Haiku 5.5 prompt of exactly 100000 tokens pays the short row and 100001 the long row", () => {
    const haiku = "claude-haiku-5-5";
    const atThreshold = oracleOfFiles({
      "-home-dev-proj/s1.jsonl": [
        assistantLine({ id: "msg_1", at: AN_HOUR_AGO, model: haiku, input: HAIKU_THRESHOLD }),
      ],
    });
    const overThreshold = oracleOfFiles({
      "-home-dev-proj/s1.jsonl": [
        assistantLine({ id: "msg_1", at: AN_HOUR_AGO, model: haiku, input: HAIKU_THRESHOLD + 1 }),
      ],
    });

    expect(micros(atThreshold.totals.today.usd)).toBe(micros(HAIKU_AT_THRESHOLD_USD));
    expect(micros(overThreshold.totals.today.usd)).toBe(micros(HAIKU_OVER_THRESHOLD_USD));
  });

  test("O18 a call after now is ignored", () => {
    const oracle = oracleOfFiles({
      "-home-dev-proj/s1.jsonl": [assistantLine({ id: "msg_1", at: NOW + 1000, input: MILLION })],
    });

    expect(oracle.totals.month.usd).toBe(0);
    expect(oracle.totals.today.calls).toBe(0);
  });

  test("O19 a call from late yesterday is in the week but not in today", () => {
    const oracle = oracleOfFiles({
      "-home-dev-proj/s1.jsonl": [
        assistantLine({ id: "msg_1", at: YESTERDAY_LATE, input: MILLION }),
      ],
    });

    expect(oracle.totals.today.usd).toBe(0);
    expect(micros(oracle.totals.week.usd)).toBe(micros(OPUS_INPUT_USD));
  });

  test("O20 a call 31 days old is not in the 30 day total", () => {
    const oracle = oracleOfFiles({
      "-home-dev-proj/s1.jsonl": [
        assistantLine({ id: "msg_1", at: THIRTY_ONE_DAYS_AGO, input: MILLION }),
      ],
    });

    expect(oracle.totals.month.usd).toBe(0);
  });

  test("O21 a call shared by a forked copy is credited to the session that started first", () => {
    const shared = assistantLine({ id: "msg_shared", at: AN_HOUR_AGO, input: MILLION });
    const added = assistantLine({ id: "msg_added", at: AN_HOUR_AGO + 1000, input: MILLION });

    const oracle = oracleOfFiles({
      "-home-dev-proj/a-copy.jsonl": [userLine(AN_HOUR_AGO - 1000), shared, added],
      "-home-dev-proj/z-original.jsonl": [userLine(AN_HOUR_AGO - 5000), shared],
    });

    expect(micros(monthUsdOf(oracle, "z-original", "main"))).toBe(micros(OPUS_INPUT_USD));
    expect(micros(monthUsdOf(oracle, "a-copy", "main"))).toBe(micros(OPUS_INPUT_USD));
    expect(oracle.totals.month.calls).toBe(2);
  });

  test("O22 an advisor sub-call is priced at its own model and reported as a separate line", () => {
    const oracle = oracleOfFiles({
      "-home-dev-proj/s1.jsonl": [
        assistantLine({
          id: "msg_1",
          at: AN_HOUR_AGO,
          advisors: [{ model: "claude-sonnet-5-5", input: MILLION }],
        }),
      ],
    });

    expect(micros(oracle.totals.today.advisorUsd)).toBe(micros(SONNET_INPUT_USD));
    expect(micros(oracle.totals.today.usd)).toBe(micros(SONNET_INPUT_USD));
    expect(oracle.totals.today.input).toBe(0);
  });

  test("O23 an assistant line written with spaces after the colons is still counted", () => {
    const oracle = oracleOfFiles({
      "-home-dev-proj/s1.jsonl": [
        assistantLine({ id: "msg_1", at: AN_HOUR_AGO, input: MILLION, isSpaced: true }),
      ],
    });

    expect(micros(oracle.totals.today.usd)).toBe(micros(OPUS_INPUT_USD));
  });

  test("O24 a faithful copy of a session in another file does not take the credit from the session that wrote the call", () => {
    const written = (id: string) =>
      assistantLine({ id, at: AN_HOUR_AGO, input: MILLION, sessionId: "z-original" });

    const oracle = oracleOfFiles({
      "-home-dev-scratch/a-copy.jsonl": [userLine(AN_HOUR_AGO - 5000), written("msg_shared")],
      "-home-dev-proj/z-original.jsonl": [userLine(AN_HOUR_AGO - 1000), written("msg_shared")],
    });

    expect(micros(monthUsdOf(oracle, "z-original", "main"))).toBe(micros(OPUS_INPUT_USD));
    expect(oracle.sessions.find((row) => row.sessionId === "a-copy")).toBeUndefined();
  });
});
