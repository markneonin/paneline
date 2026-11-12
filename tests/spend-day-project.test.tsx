import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";
import type { On } from "claude-code";

import { API_KEY, lines, settle, spendPane, toCents, worldOf } from "./spend-world";
import type { Pane, World } from "./spend-world";
import { WORLD_NOW } from "./fixtures/spend-world";
import { seedTotals } from "./fixtures/spend-atom";
import { isHeavy } from "./weight";
import type { Line } from "./skills-tree";

type Entry = {
  project: string;
  session: string;
  at: [day: number, hour: number, minute: number];
  usd: number;
  isOwn?: boolean;
};
type Parsed = { name: string; dollars: string; percent: string };

const NARROW_COLUMNS = 60;
const OCTOBER = 9;
const YEAR = 2026;
const BATTLE = "battle_game";
const DAY_ROW = "Wed, Oct 28";
const DAY_HEADING = `${BATTLE} · ${DAY_ROW} $2300.98`;
const MONTH_HEADING = `${BATTLE} · 30 days $5475.47`;
const DAY_TOTAL_CENTS = 230098;
const LAST_HOUR_USD = 1.25;
const ACTIVE_HOURS = 40;
const READS = new Set(["get", "has", "keys"]);
const ROW = /^(.+?)(?: [▰▱]+)* ~?(\$\d+\.\d{2}) (<1%|\d+%)$/;

const ENTRIES: Entry[] = [
  { project: BATTLE, session: "b1", at: [28, 15, 40], usd: 400.4 },
  { project: BATTLE, session: "b1", at: [28, 9, 12], usd: 1300.123 },
  { project: BATTLE, session: "own-sess", at: [29, 11, 0], usd: 1000.666, isOwn: true },
  { project: BATTLE, session: "b2", at: [28, 18, 0], usd: 600.457 },
  { project: BATTLE, session: "b2", at: [27, 16, 0], usd: 200 },
  { project: BATTLE, session: "b3", at: [27, 10, 5], usd: 600.111 },
  { project: BATTLE, session: "b4", at: [25, 11, 0], usd: 400.222 },
  { project: BATTLE, session: "b5", at: [24, 8, 0], usd: 300.333 },
  { project: BATTLE, session: "b6", at: [23, 13, 30], usd: 200.444 },
  { project: BATTLE, session: "b7", at: [23, 17, 20], usd: 100.555 },
  { project: BATTLE, session: "b8", at: [27, 12, 0], usd: 372.159 },
  { project: "demo-app", session: "pl-1", at: [28, 10, 0], usd: 3000.25 },
  { project: "demo-app", session: "pl-2", at: [29, 9, 0], usd: 1500.75 },
];

describe("spend project opened inside a day", () => {
  test("G1 pressing a project inside a day shows that day's total in the header, not the 30-day one", async ($, on) => {
    const { pane } = await dayPane($, on);

    await pressName(pane, BATTLE);

    const texts = await textsOf(pane);
    expect(texts).toContain(DAY_HEADING);
  });

  test("G2 the project's Sessions list only that day's sessions, adding up to the header total and 100%", async ($, on) => {
    const { pane } = await dayPane($, on);

    await pressName(pane, BATTLE);

    const shown = await lines(pane);
    const sessions = rowsUnder(shown, "Sessions");
    expect(sessions.map((row) => row.dollars)).toEqual(["$1700.52", "$600.46"]);
    expect([centsOf(sessions), percentOf(sessions)]).toEqual([DAY_TOTAL_CENTS, 100]);
    expect(shown.some((line) => line.text.startsWith("Costliest days"))).toBe(false);
  });

  test("G3 pressing the project in By project on the Spend list still opens its 30-day detail", async ($, on) => {
    const { pane } = await dayPane($, on, false);

    await pressName(pane, BATTLE);

    expect(await textsOf(pane)).toContain(MONTH_HEADING);
  });

  test("G4 pressing the project inside a day draws with no store read", async ($, on) => {
    const { pane, world } = await dayPane($, on);
    const reads = watchStore(world);

    await pressName(pane, BATTLE);

    expect(await textsOf(pane)).toContain(DAY_HEADING);
    expect(reads).toEqual([]);
  });
});

function parsed(line: Line): Parsed | undefined {
  const match = ROW.exec(line.text);
  if (match === null) return undefined;
  return { name: match[1] ?? "", dollars: match[2] ?? "", percent: match[3] ?? "" };
}

function rowsUnder(shown: Line[], title: string): Parsed[] {
  const at = shown.findIndex(
    (line) =>
      (line.text === title || line.text.startsWith(`${title} `)) && isHeavy(line.parts[0]?.props),
  );
  expect(at, `a "${title}" heading`).toBeGreaterThanOrEqual(0);
  const rest = shown.slice(at + 1);
  const start = rest.findIndex((line) => line.text !== "");
  const body = rest.slice(start);
  const end = body.findIndex((line) => line.text === "");
  return (end === -1 ? body : body.slice(0, end)).flatMap((line) => parsed(line) ?? []);
}

function centsOf(rows: Parsed[]): number {
  return rows.reduce((sum, row) => sum + toCents(row.dollars), 0);
}

function percentOf(rows: Parsed[]): number {
  return rows.reduce((sum, row) => sum + Number.parseInt(row.percent, 10), 0);
}

async function textsOf(pane: Pane): Promise<string[]> {
  return (await lines(pane)).map((line) => line.text);
}

async function keyOfName(pane: Pane, label: string): Promise<string> {
  const buttons = await pane.findAll({ type: "Button" });
  const found = buttons.find((button) => button.props.label === label);
  expect(found, `a "${label}" button`).toBeDefined();
  return found?.key ?? "";
}

async function pressName(pane: Pane, label: string): Promise<void> {
  await pane.press({ key: await keyOfName(pane, label) });
  await settle(pane);
}

function watchStore(world: World): string[] {
  const reads: string[] = [];
  const target = world.store;
  world.store = new Proxy(target, {
    get(_target, property) {
      const member: unknown = Reflect.get(target, property);
      if (typeof member !== "function") return member;
      return (...args: unknown[]): unknown => {
        if (READS.has(String(property))) reads.push(String(property));
        const result: unknown = Reflect.apply(member, target, args);
        return result;
      };
    },
  });
  return reads;
}

function sliceOf(entry: Entry): object {
  const [day, hour, minute] = entry.at;
  const at = new Date(YEAR, OCTOBER, day, hour, minute).getTime();
  return {
    project: entry.project,
    session: entry.session,
    day: `${YEAR}-${OCTOBER + 1}-${String(day).padStart(2, "0")}`,
    at,
    usd: entry.usd,
    isOwn: entry.isOwn === true,
  };
}

function totalsOf(entries: Entry[]): object {
  const spent = new Map<string, number>();
  for (const { project, usd } of entries) spent.set(project, (spent.get(project) ?? 0) + usd);
  const total = entries.reduce((sum, { usd }) => sum + usd, 0);
  return {
    at: WORLD_NOW,
    rows: [],
    today: total,
    week: total,
    month: total,
    lastHour: LAST_HOUR_USD,
    projects: [...spent].map(([name, usd]) => ({ name, usd })),
    session: null,
    progress: null,
    slices: entries.map(sliceOf),
    activeHours: ACTIVE_HOURS,
  };
}

async function dayPane($: Engine, on: On, isDayOpen = true): Promise<{ pane: Pane; world: World }> {
  const world = worldOf(on, API_KEY);
  await world.clock.set(WORLD_NOW);
  const pane = await spendPane($, NARROW_COLUMNS);
  seedTotals(world, totalsOf(ENTRIES));
  await settle(pane);
  if (isDayOpen) await pressName(pane, DAY_ROW);
  return { pane, world };
}
