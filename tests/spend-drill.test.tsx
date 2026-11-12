import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";
import type { On } from "claude-code";

import {
  API_KEY,
  HISTORY_TITLE,
  OPUS,
  SONNET,
  agentOwner,
  blocks,
  lines,
  mainTurn,
  openPane,
  setSessionCost,
  settle,
  showSpend,
  spendPane,
  toCents,
  worldOf,
} from "./spend-world";
import type { Pane, World } from "./spend-world";
import { WORLD_NOW } from "./fixtures/spend-world";
import { seedTotals } from "./fixtures/spend-atom";
import { screenRows } from "./band-screen";
import { isHeavy } from "./weight";
import type { Line } from "./skills-tree";
import { paneInk } from "../hooks/pane-ink";
import { childrenOf, collect, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";

type Entry = {
  project: string;
  session: string;
  at: [day: number, hour: number, minute: number];
  usd: number;
  isOwn?: boolean;
};

const NARROW_COLUMNS = 60;
const TIGHT_COLUMNS = 53;
const SHORT_PANE_ROWS = 14;
const SCROLL_ROWS = 6;
const OCTOBER = 9;
const YEAR = 2026;
const PANE_ID = "session";
const COSTLIEST_TITLE = "Costliest days · 30 days";
const BATTLE = "battle_game";
const COSTLIEST_ROWS = 6;
const BATTLE_HEADING = `${BATTLE} · 30 days $5475.47`;
const MONTH_USD = 11485.97;
const WEEK_USD = 11077.87;
const TODAY_USD = 2501.416;
const ACTIVE_HOURS = 40;
const LAST_HOUR_USD = 1.25;
const SMALL_PROJECTS = 35;
const OWN_SESSION = "own-sess";
const ROW = /^(.+?)(?: [▰▱]+)* ~?(\$\d+\.\d{2}) (<1%|\d+%)$/;
const BULK = "bulk";
const BULK_SESSIONS = 255;
const HUGE_DAY_SESSIONS = 1800;
const HOURS_PER_DAY = 24;
const SHOWN_SESSIONS = 5;
const UNFOLDED_LIMIT = 100;
const FOLD_CHILD_INDENT = 2;
const NODE_LIMIT = 20000;
const BULK_DAY = 28;
const MINUTES_PER_HOUR = 60;
const CENTS = 100;
const DAY_ROW = "Wed, Oct 28";
const SMALL_DAY_SESSIONS = 12;
const READS = new Set(["get", "has", "keys"]);

const BATTLE_ENTRIES: Entry[] = [
  { project: BATTLE, session: "b1", at: [28, 15, 40], usd: 400.4 },
  { project: BATTLE, session: "b1", at: [28, 9, 12], usd: 1300.123 },
  { project: BATTLE, session: OWN_SESSION, at: [29, 11, 0], usd: 1000.666, isOwn: true },
  { project: BATTLE, session: "b2", at: [28, 18, 0], usd: 600.457 },
  { project: BATTLE, session: "b2", at: [27, 16, 0], usd: 200 },
  { project: BATTLE, session: "b3", at: [27, 10, 5], usd: 600.111 },
  { project: BATTLE, session: "b4", at: [25, 11, 0], usd: 400.222 },
  { project: BATTLE, session: "b5", at: [24, 8, 0], usd: 300.333 },
  { project: BATTLE, session: "b6", at: [23, 13, 30], usd: 200.444 },
  { project: BATTLE, session: "b7", at: [23, 17, 20], usd: 100.555 },
  { project: BATTLE, session: "b8", at: [27, 12, 0], usd: 372.159 },
];
const OTHER_ENTRIES: Entry[] = [
  { project: "demo-app", session: "pl-1", at: [28, 10, 0], usd: 3000.25 },
  { project: "demo-app", session: "pl-2", at: [29, 9, 0], usd: 1500.75 },
  { project: "demo-app", session: "pl-3", at: [26, 9, 0], usd: 400.5 },
  { project: "alpha", session: "a-1", at: [27, 14, 0], usd: 700.9 },
];
const SMALL_ENTRIES: Entry[] = Array.from({ length: SMALL_PROJECTS }, (_, index) => ({
  project: `proj-${String(index + 1).padStart(2, "0")}`,
  session: `p-${index + 1}`,
  at: [22, 8, 0],
  usd: Math.round((5 + 0.37 * (index + 1)) * 1000) / 1000,
}));
const WORLD_ENTRIES = [...BATTLE_ENTRIES, ...OTHER_ENTRIES, ...SMALL_ENTRIES];
const FIVE_DAYS: Entry[] = [29, 28, 27, 26, 25].map((day, index) => ({
  project: "alpha",
  session: `s${day}`,
  at: [day, 9, 0],
  usd: (5 - index) * 100,
}));

describe("spend costliest days and drill-down", () => {
  test("SDR1 Costliest days · 30 days lists the five costliest days, today labelled today, then ▸ 3 more, and all day amounts add up to the 30 days tile", async ($, on) => {
    const { pane } = await drillPane($, on, NARROW_COLUMNS);

    const shown = await lines(pane);
    const rows = rowsUnder(shown, COSTLIEST_TITLE);
    expect(rows.map((row) => row.name)).toEqual([
      "Wed, Oct 28",
      "today",
      "Tue, Oct 27",
      "Thu, Oct 22",
      "Mon, Oct 26",
      "▸ 3 more",
    ]);
    expect(centsOf(rows)).toBe(toCents(await monthTile(pane)));
  });

  test("SDR2 pressing battle_game opens [ back ], battle_game · 30 days $5475.47, its costliest days and its sessions; each list's amounts add up to $5475.47 and its percents to 100", async ($, on) => {
    const { pane } = await drillPane($, on, TIGHT_COLUMNS);

    await pressName(pane, BATTLE);

    const shown = await lines(pane);
    const texts = shown.map((line) => line.text);
    const backAt = texts.indexOf("[ back ]");
    expect(backAt).toBeGreaterThanOrEqual(0);
    expect(texts[backAt + 1]).toBe("");
    expect(texts[backAt + 2]).toBe(BATTLE_HEADING);
    const days = rowsUnder(shown, "Costliest days");
    const sessions = rowsUnder(shown, "Sessions");
    expect(days.map((row) => row.name)).toEqual([
      "Wed, Oct 28",
      "Tue, Oct 27",
      "today",
      "Sun, Oct 25",
      "Fri, Oct 23",
      "▸ 1 more",
    ]);
    expect([centsOf(days), centsOf(sessions)]).toEqual([547547, 547547]);
    expect([percentOf(days), percentOf(sessions)]).toEqual([100, 100]);
  });

  test("SDR3 in a project's Sessions, this session reads this session and another one reads its first call time Oct 28, 09:12", async ($, on) => {
    const { pane } = await drillPane($, on, TIGHT_COLUMNS);

    await pressName(pane, BATTLE);

    const sessions = rowsUnder(await lines(pane), "Sessions");
    expect(sessions.map((row) => row.name)).toEqual([
      "Oct 28, 09:12",
      "this session",
      "Oct 27, 16:00",
      "Oct 27, 10:05",
      "Oct 25, 11:00",
      "▸ 4 more",
    ]);
  });

  test("SDR4a pressing a day row opens that day with By project and Sessions for that day only", async ($, on) => {
    const { pane } = await drillPane($, on, NARROW_COLUMNS);

    await pressName(pane, "Wed, Oct 28");

    const shown = await lines(pane);
    expect(shown.some((line) => line.text === "Wed, Oct 28 $5301.23")).toBe(true);
    const projects = rowsUnder(shown, "By project");
    const sessions = rowsUnder(shown, "Sessions");
    expect(projects.map((row) => [row.name, row.dollars])).toEqual([
      ["demo-app", "$3000.25"],
      [BATTLE, "$2300.98"],
    ]);
    expect(sessions.map((row) => row.dollars)).toEqual(["$3000.25", "$1700.52", "$600.46"]);
  });

  test("SDR4b pressing a project inside a day opens that project for that day", async ($, on) => {
    const { pane } = await drillPane($, on, NARROW_COLUMNS);
    await pressName(pane, "Wed, Oct 28");

    await pressName(pane, BATTLE);

    const texts = (await lines(pane)).map((line) => line.text);
    expect(texts).toContain(`${BATTLE} · Wed, Oct 28 $2300.98`);
    expect(texts).not.toContain(BATTLE_HEADING);
    expect(texts).toContain("[ back ]");
  });

  test("SDR5a [ back ] returns to the Spend list at the scroll row the user left", async ($, on) => {
    const { pane } = await scrolledDrillPane($, on);
    const scrolled = await textsOf(pane);
    await pressName(pane, BATTLE);

    await pressName(pane, "back");

    expect(await textsOf(pane)).toEqual(scrolled);
  });

  test("SDR6 pressing ▸ 33 more shows ▾ 33 more with its 33 projects indented two cells, and pressing it again folds them", async ($, on) => {
    const { pane } = await drillPane($, on, NARROW_COLUMNS);
    const folded = await textsOf(pane);
    const foldedPercent = await percentOfRowStarting(pane, "▸ 33 more");

    await pressName(pane, "▸ 33 more");

    const shown = await lines(pane);
    const foldAt = shown.findIndex((line) => line.text.startsWith("▾ 33 more"));
    expect(foldAt).toBeGreaterThanOrEqual(0);
    const children = shown.slice(foldAt + 1, foldAt + 34);
    expect(parsed(shown[foldAt] as Line)?.percent).toBe(foldedPercent);
    expect(children.map((line) => parsed(line)?.name)).toEqual(hiddenProjects());
    expect(children.map((line) => line.indent - (shown[foldAt]?.indent ?? 0))).toEqual(
      children.map(() => 2),
    );
    await pressName(pane, "▾ 33 more");
    expect(await textsOf(pane)).toEqual(folded);
  });

  test("SDR6b pressing ▸ 2 more under Where it went shows ▾ 2 more with its 2 agents indented two cells", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await sevenOwners($, world);
    const pane = await spendPane($, NARROW_COLUMNS);
    const foldedPercent = await percentOfRowStarting(pane, "▸ 2 more");

    await pressName(pane, "▸ 2 more");

    const shown = await lines(pane);
    const foldAt = shown.findIndex((line) => line.text.startsWith("▾ 2 more"));
    expect(foldAt).toBeGreaterThanOrEqual(0);
    const children = shown.slice(foldAt + 1, foldAt + 3);
    expect(parsed(shown[foldAt] as Line)?.percent).toBe(foldedPercent);
    expect(children.map((line) => parsed(line)?.name)).toEqual(["high", "low"]);
    expect(children.map((line) => line.indent - (shown[foldAt]?.indent ?? 0))).toEqual([2, 2]);
  });

  test("SDR7 pressing a project draws its detail with no store read between the press and the draw", async ($, on) => {
    const { pane, world } = await drillPane($, on, NARROW_COLUMNS);
    const reads = watchStore(world);

    await pressName(pane, BATTLE);

    const texts = (await lines(pane)).map((line) => line.text);
    expect(texts).toContain(BATTLE_HEADING);
    expect(reads).toEqual([]);
  });

  test("SDR9 with exactly five days of spend, Costliest days lists five days and no N more row", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await world.clock.set(WORLD_NOW);
    const pane = await spendPane($, NARROW_COLUMNS);

    seedTotals(world, totalsOf(FIVE_DAYS));
    await settle(pane);

    const rows = rowsUnder(await lines(pane), COSTLIEST_TITLE);
    expect(rows.map((row) => row.name)).toEqual([
      "today",
      "Wed, Oct 28",
      "Tue, Oct 27",
      "Mon, Oct 26",
      "Sun, Oct 25",
    ]);
  });

  test("SDR10 while battle_game is open, fresh totals with $100.00 more for it show $5575.47 in its header and keep it open", async ($, on) => {
    const { pane, world } = await drillPane($, on, NARROW_COLUMNS);
    await pressName(pane, BATTLE);

    seedTotals(world, totalsOf(WORLD_ENTRIES.map((entry) => bumped(entry, 100))));
    await settle(pane);

    const texts = (await lines(pane)).map((line) => line.text);
    expect(texts).toContain(`${BATTLE} · 30 days $5575.47`);
    expect(texts).toContain("[ back ]");
  });

  test("SDR11a unfolding 250 folded sessions at 53 columns draws 100 indented rows and one muted 150 more row holding the rest's dollars", async ($, on) => {
    await expectBoundedUnfold($, on, TIGHT_COLUMNS);
  });

  test("SDR11b unfolding 250 folded sessions at 60 columns draws 100 indented rows and one muted 150 more row holding the rest's dollars", async ($, on) => {
    await expectBoundedUnfold($, on, NARROW_COLUMNS);
  });

  test("SDR12a after unfolding Sessions in a day, pressing its project at 53 columns opens the project with Sessions folded", async ($, on) => {
    await expectProjectSessionsFolded($, on, TIGHT_COLUMNS);
  });

  test("SDR12b after unfolding Sessions in a day, pressing its project at 60 columns opens the project with Sessions folded", async ($, on) => {
    await expectProjectSessionsFolded($, on, NARROW_COLUMNS);
  });

  test("SDR13a a day with 1800 sessions of one project, unfolded then the project pressed, still draws at 53 columns", async ($, on) => {
    await expectHugeDayDraws($, on, TIGHT_COLUMNS);
  });

  test("SDR13b a day with 1800 sessions of one project, unfolded then the project pressed, still draws at 60 columns", async ($, on) => {
    await expectHugeDayDraws($, on, NARROW_COLUMNS);
  });

  test("SBR7c at 53 columns every Costliest days row ends its percent at the pane's last cell, the cell the heading rule ends on", async ($, on) => {
    const { pane } = await drillPane($, on, TIGHT_COLUMNS);

    expectCostliestOnPaneEdge(screenRows(await pane.drawn(), TIGHT_COLUMNS), TIGHT_COLUMNS);
  });

  test("SBR7d at 60 columns every Costliest days row ends its percent at the pane's last cell, the cell the heading rule ends on", async ($, on) => {
    const { pane } = await drillPane($, on, NARROW_COLUMNS);

    expectCostliestOnPaneEdge(screenRows(await pane.drawn(), NARROW_COLUMNS), NARROW_COLUMNS);
  });
});

type Parsed = { name: string; dollars: string; percent: string };

function bulkEntries(count: number): Entry[] {
  return Array.from({ length: count }, (_, index) => ({
    project: BULK,
    session: `bulk-${index}`,
    at: [BULK_DAY, Math.floor(index / MINUTES_PER_HOUR) % HOURS_PER_DAY, index % MINUTES_PER_HOUR],
    usd: Math.round((1 + index * 0.01) * CENTS) / CENTS,
  }));
}

async function bulkPane($: Engine, on: On, columns: number, count: number): Promise<Pane> {
  const world = worldOf(on, API_KEY);
  await world.clock.set(WORLD_NOW);
  const pane = await spendPane($, columns);
  seedTotals(world, totalsOf(bulkEntries(count)));
  await settle(pane);
  return pane;
}

function foldChildren(shown: Line[], foldAt: number): Line[] {
  const rest = shown.slice(foldAt + 1);
  const end = rest.findIndex((line) => line.text === "");
  return end === -1 ? rest : rest.slice(0, end);
}

function mutedColoursOf(line: Line | undefined, text: string): unknown[] {
  const coloured = (line?.parts ?? [])
    .flatMap((part) => collect(part, "Text"))
    .filter((node) => textOf(node).trim() === text && node.props?.color !== undefined);
  return [...new Set(coloured.map((node) => node.props?.color))];
}

function nodeCount(node: Node): number {
  return 1 + childrenOf(node).reduce((sum, child) => sum + nodeCount(child), 0);
}

async function expectBoundedUnfold($: Engine, on: On, columns: number): Promise<void> {
  const pane = await bulkPane($, on, columns, BULK_SESSIONS);
  await pressName(pane, BULK);
  const heldCents = bulkEntries(BULK_SESSIONS)
    .map((entry) => Math.round(entry.usd * CENTS))
    .sort((left, right) => right - left)
    .slice(SHOWN_SESSIONS + UNFOLDED_LIMIT)
    .reduce((sum, cents) => sum + cents, 0);

  await pressName(pane, "▸ 250 more");

  const shown = await lines(pane);
  const foldAt = shown.findIndex((line) => line.text.startsWith("▾ 250 more"));
  expect(foldAt).toBeGreaterThanOrEqual(0);
  const children = foldChildren(shown, foldAt);
  const tail = children.at(-1);
  expect(children).toHaveLength(UNFOLDED_LIMIT + 1);
  expect(parsed(tail as Line)?.name).toBe("150 more");
  expect(toCents(parsed(tail as Line)?.dollars ?? "")).toBe(heldCents);
  expect(children.map((line) => line.indent - (shown[foldAt]?.indent ?? 0))).toEqual(
    children.map(() => FOLD_CHILD_INDENT),
  );
  expect(mutedColoursOf(tail, "150 more")).toEqual([paneInk().muted]);
  const labels = (await pane.findAll({ type: "Button" })).map((button) => button.props.label);
  expect(labels).not.toContain("150 more");
}

async function expectProjectSessionsFolded($: Engine, on: On, columns: number): Promise<void> {
  const pane = await bulkPane($, on, columns, SMALL_DAY_SESSIONS);
  await pressName(pane, DAY_ROW);
  await pressName(pane, "▸ 7 more");
  expect((await textsOf(pane)).some((text) => text.startsWith("▾ 7 more"))).toBe(true);

  await pressName(pane, BULK);

  const texts = await textsOf(pane);
  expect(texts.some((text) => text.startsWith(`${BULK} · ${DAY_ROW}`))).toBe(true);
  const foldMarks = texts.filter((text) => /^[▸▾] 7 more/.test(text)).map((text) => text[0]);
  expect(foldMarks).toEqual(["▸"]);
}

async function expectHugeDayDraws($: Engine, on: On, columns: number): Promise<void> {
  const pane = await bulkPane($, on, columns, HUGE_DAY_SESSIONS);
  await pressName(pane, DAY_ROW);
  await pressName(pane, `▸ ${HUGE_DAY_SESSIONS - SHOWN_SESSIONS} more`);

  await pressName(pane, BULK);

  const texts = await textsOf(pane);
  expect(texts).toContain("[ back ]");
  expect(texts.some((text) => text.startsWith(`${BULK} · ${DAY_ROW}`))).toBe(true);
  expect(nodeCount(await pane.drawn())).toBeLessThan(NODE_LIMIT);
}

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

function expectCostliestOnPaneEdge(rows: string[], columns: number): void {
  const headingAt = rows.findIndex((row) => row.trim().startsWith(COSTLIEST_TITLE));
  expect(headingAt, `a "${COSTLIEST_TITLE}" heading`).toBeGreaterThan(-1);
  const rest = rows.slice(headingAt + 2);
  const end = rest.findIndex((row) => row.trim() === "");
  const ends = (end === -1 ? rest : rest.slice(0, end)).map((row) => row.trimEnd().length);
  expect(rows[headingAt]?.trimEnd().length).toBe(columns);
  expect(ends).toEqual(Array.from({ length: COSTLIEST_ROWS }, () => columns));
}

function percentOf(rows: Parsed[]): number {
  return rows.reduce((sum, row) => sum + Number.parseInt(row.percent, 10), 0);
}

function hiddenProjects(): string[] {
  return Array.from({ length: SMALL_PROJECTS - 2 }, (_, index) => {
    const number = SMALL_PROJECTS - 2 - index;
    return `proj-${String(number).padStart(2, "0")}`;
  });
}

async function percentOfRowStarting(pane: Pane, start: string): Promise<string | undefined> {
  const row = (await lines(pane)).find((line) => line.text.startsWith(start));
  return row === undefined ? undefined : parsed(row)?.percent;
}

async function textsOf(pane: Pane): Promise<string[]> {
  return (await lines(pane)).map((line) => line.text);
}

async function monthTile(pane: Pane): Promise<string | null> {
  const [values] = (await blocks(pane))[HISTORY_TITLE]?.rows ?? [];
  return (values?.text ?? "").split(" ").filter((cell) => cell !== "")[2] ?? null;
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

function bumped(entry: Entry, extra: number): Entry {
  return entry.session === "b8" ? { ...entry, usd: entry.usd + extra } : entry;
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
  const isFull = entries === WORLD_ENTRIES;
  return {
    at: WORLD_NOW,
    rows: [],
    today: isFull ? TODAY_USD : total,
    week: isFull ? WEEK_USD : total,
    month: isFull ? MONTH_USD : total,
    lastHour: LAST_HOUR_USD,
    projects: [...spent].map(([name, usd]) => ({ name, usd })),
    session: null,
    progress: null,
    slices: entries.map(sliceOf),
    activeHours: ACTIVE_HOURS,
  };
}

async function drillPane(
  $: Engine,
  on: On,
  columns: number,
): Promise<{ pane: Pane; world: World }> {
  const world = worldOf(on, API_KEY);
  await world.clock.set(WORLD_NOW);
  const pane = await spendPane($, columns);
  seedTotals(world, totalsOf(WORLD_ENTRIES));
  await settle(pane);
  return { pane, world };
}

async function scrolledDrillPane($: Engine, on: On): Promise<{ pane: Pane; world: World }> {
  const world = worldOf(on, API_KEY);
  await world.clock.set(WORLD_NOW);
  const pane = await openPane($, NARROW_COLUMNS, SHORT_PANE_ROWS);
  await showSpend(pane);
  seedTotals(world, totalsOf(WORLD_ENTRIES));
  await settle(pane);
  const top = await textsOf(pane);
  await $.ui.scroll({
    component: "Pane",
    requestId: PANE_ID,
    offset: 0,
    by: SCROLL_ROWS,
    bodyRows: SHORT_PANE_ROWS,
    contentRows: top.length,
    origin: { kind: "person" },
  });
  await settle(pane);
  expect(await textsOf(pane)).not.toEqual(top);
  return { pane, world };
}

async function sevenOwners($: Engine, world: World): Promise<void> {
  await mainTurn($, world, { model: OPUS, tokens: { input: 1_000_000 } });
  const agents: [string, number][] = [
    ["implementer", 1_500_000],
    ["test-engineer", 1_250_000],
    ["Explore", 1_000_000],
    ["reviewer", 750_000],
    ["high", 500_000],
    ["low", 250_000],
  ];
  for (const [type, input] of agents) await agentOwner($, world, type, SONNET, { input });
  await setSessionCost($, world, 14.5);
}
