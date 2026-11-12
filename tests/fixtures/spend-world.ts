import { assistantLine, userLine } from "./transcript-oracle";

export const ROOT = "/home/dev/.claude/projects";
export const OWN_SESSION = "own-sess";
export const CONTAINERS = ["-home-dev", "-home-dev-work"];
export const HAIKU = "claude-haiku-5-5";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MILLION = 1_000_000;
const HAIKU_LONG_PROMPT = 100_001;
const HAIKU_SHORT_PROMPT = 100_000;

export const WORLD_NOW = new Date(2026, 9, 29, 12, 0, 0).getTime();

const HOUR_AGO = WORLD_NOW - MS_PER_HOUR;
const TWO_HOURS_AGO = WORLD_NOW - 2 * MS_PER_HOUR;
const FOUR_HOURS_AGO = WORLD_NOW - 4 * MS_PER_HOUR;
const FIVE_HOURS_AGO = WORLD_NOW - 5 * MS_PER_HOUR;
const THREE_DAYS_AGO = WORLD_NOW - 3 * MS_PER_DAY;
const NINE_DAYS_AGO = WORLD_NOW - 9 * MS_PER_DAY;
const TEN_DAYS_AGO = WORLD_NOW - 10 * MS_PER_DAY;
const TWELVE_DAYS_AGO = WORLD_NOW - 12 * MS_PER_DAY;
const TWENTY_DAYS_AGO = WORLD_NOW - 20 * MS_PER_DAY;
const THIRTY_ONE_DAYS_AGO = WORLD_NOW - 31 * MS_PER_DAY;
const YESTERDAY_LATE = new Date(2026, 9, 28, 23, 30, 0).getTime();
const TODAY_EARLY = new Date(2026, 9, 29, 1, 0, 0).getTime();
const STREAM_GAP = 2_000;
const PARTIAL_OUTPUT = 100;
const FULL_OUTPUT = 90_000;

const SCRATCH_DIR =
  "-private-tmp-claude-502--home-dev-alpha-3a7c8722-93a4-4648-b3f0-b1a7e5bb660f-scratchpad-w1";

export type WorldFile = {
  rel: string;
  path: string;
  cwd: string;
  lines: string[];
  start: number;
  size: number;
};

export function worldFiles(): WorldFile[] {
  return [
    fileOf("-home-dev-alpha/own-sess.jsonl", "/home/dev/alpha", [
      assistantLine({ id: "a1", sessionId: OWN_SESSION, at: HOUR_AGO, input: MILLION }),
      assistantLine({ id: "a2", sessionId: OWN_SESSION, at: THREE_DAYS_AGO, output: 100_000 }),
      assistantLine({
        id: "p1",
        sessionId: OWN_SESSION,
        at: TWO_HOURS_AGO,
        output: PARTIAL_OUTPUT,
      }),
      assistantLine({
        id: "p1",
        sessionId: OWN_SESSION,
        at: TWO_HOURS_AGO + STREAM_GAP,
        output: FULL_OUTPUT,
      }),
      userLine(HOUR_AGO),
    ]),
    fileOf("-home-dev-alpha/own-sess/subagents/agent-1.jsonl", "/home/dev/alpha", [
      assistantLine({ id: "s1", sessionId: OWN_SESSION, at: TWO_HOURS_AGO, output: 200_000 }),
      assistantLine({ id: "s2", sessionId: OWN_SESSION, at: THREE_DAYS_AGO, read: 3 * MILLION }),
    ]),
    fileOf("-home-dev-alpha/old-sess.jsonl", "/home/dev/alpha", [
      assistantLine({ id: "o1", sessionId: "old-sess", at: TWELVE_DAYS_AGO, read: 5 * MILLION }),
      assistantLine({ id: "o2", sessionId: "old-sess", at: TEN_DAYS_AGO, write1h: MILLION }),
      assistantLine({ id: "r1", sessionId: "old-sess", at: NINE_DAYS_AGO, input: 2 * MILLION }),
      assistantLine({ id: "x1", sessionId: "old-sess", at: TWENTY_DAYS_AGO, output: 100 }),
    ]),
    fileOf("-home-dev-alpha/resumed-new.jsonl", "/home/dev/alpha", [
      assistantLine({ id: "o2", sessionId: "old-sess", at: TEN_DAYS_AGO, write1h: MILLION }),
      assistantLine({ id: "r1", sessionId: "old-sess", at: NINE_DAYS_AGO, input: 2 * MILLION }),
      assistantLine({
        id: "x1",
        sessionId: "old-sess",
        at: TWENTY_DAYS_AGO + STREAM_GAP,
        output: FULL_OUTPUT,
      }),
      assistantLine({
        id: "n1",
        sessionId: "resumed-new",
        at: TWO_HOURS_AGO,
        output: 50_000,
      }),
    ]),
    fileOf("-home-dev-alpha-wt/wt-sess.jsonl", "/home/dev/alpha-wt", [
      assistantLine({
        id: "w1",
        sessionId: "wt-sess",
        at: FIVE_HOURS_AGO,
        output: 100_000,
        speed: "fast",
      }),
      assistantLine({
        id: "w2",
        sessionId: "wt-sess",
        at: FIVE_HOURS_AGO,
        model: HAIKU,
        input: HAIKU_LONG_PROMPT,
      }),
    ]),
    fileOf(`${SCRATCH_DIR}/scratch-sess.jsonl`, "/home/dev/alpha", [
      assistantLine({ id: "c1", sessionId: "scratch-sess", at: FOUR_HOURS_AGO, output: 300_000 }),
    ]),
    fileOf("-home-dev-work-api/api-sess.jsonl", "/home/dev/work/api", [
      assistantLine({ id: "i1", sessionId: "api-sess", at: YESTERDAY_LATE, output: 400_000 }),
      assistantLine({ id: "i2", sessionId: "api-sess", at: TODAY_EARLY, output: 500_000 }),
      assistantLine({
        id: "i3",
        sessionId: "api-sess",
        at: TODAY_EARLY,
        model: HAIKU,
        input: HAIKU_SHORT_PROMPT,
      }),
    ]),
    fileOf("-home-dev-work-web/web-sess.jsonl", "/home/dev/work/web", [
      assistantLine({ id: "b1", sessionId: "web-sess", at: TWENTY_DAYS_AGO, output: 600_000 }),
      assistantLine({ id: "b2", sessionId: "web-sess", at: THIRTY_ONE_DAYS_AGO, output: 700_000 }),
      assistantLine({
        id: "f1",
        sessionId: "web-sess",
        at: WORLD_NOW + MS_PER_HOUR,
        output: 800_000,
      }),
    ]),
  ];
}

function fileOf(rel: string, cwd: string, lines: string[]): WorldFile {
  const first = JSON.parse(lines[0] ?? "{}") as { timestamp: string };
  return {
    rel,
    path: `${ROOT}/${rel}`,
    cwd,
    lines,
    start: Date.parse(first.timestamp),
    size: lines.join("\n").length,
  };
}
