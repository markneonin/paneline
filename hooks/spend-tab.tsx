import { atom, read, update } from "claude-code";
import type { EngineInterface, On } from "claude-code";

import { contextBreakdown } from "./breakdown";
import { showCall } from "./activity-track";
import { centsOf, clockOf } from "./format";
import { enterDetail, keepPane, leaveDetail, PANE } from "./pane-tab";
import { isShownTab, justEntered } from "./shown-tab";
import {
  baseTokens,
  emptySpend,
  nextTurnOptions,
  roundedCents,
  sessionSpendUsd,
  splitRows,
  warmUntilOf,
  withMoreRow,
  withPercents,
} from "./spend-model";
import type { SplitRow, SplitShare } from "./spend-model";
import type { CacheOption } from "./spend-model";
import type { SpendSlice, SpendState, SpendTotals } from "../types";
import { spendTab } from "./spend-draw";
import type { SpendDetail, SpendHistory } from "./spend-draw";
import { keepColdFlip, refreshSpendTotals } from "./spend-track";

export const SPEND_TAB = { id: "spend", label: "Spend" };

const spendAtom = atom({ plugin: "paneline", key: "spend" } as const, emptySpend());
const sessionUsdAtom = atom(
  { plugin: "paneline", key: "sessionUsd" } as const,
  null as number | null,
);

const spendTotalsAtom = atom(
  { plugin: "paneline", key: "spendTotals" } as const,
  null as SpendTotals | null,
);

const tabAtom = atom({ plugin: "paneline", key: "tab" } as const, "activity");
const openAgentAtom = atom(
  { plugin: "paneline", key: "openAgent" } as const,
  null as string | null,
);
const spendOpenAtom = atom({ plugin: "paneline", key: "spendOpen" } as const, {
  unfolded: [] as string[],
});

const mainTurnRunningAtom = atom({ plugin: "paneline", key: "mainTurnRunning" } as const, false);

const AGENTS_TAB_ID = "agents";
const ACTIVITY_TAB_ID = "activity";
const NO_TOTALS: SpendTotals = { at: 0 };
const MONTH_DAYS = "30 days";
const SEPARATOR = " · ";
const OWN_SESSION = "this session";
const DAY_NAME_FORMAT = { weekday: "short", month: "short", day: "numeric" } as const;
const CALL_DAY_FORMAT = { month: "short", day: "numeric" } as const;

type RankItem = { id: string; name: string; usd: number };

export function registerSpendTab(on: On): void {
  on("ui.close", { id: PANE }, async ($, e, next) => {
    if (e.origin.kind !== "person" || (await read($, tabAtom)) !== SPEND_TAB.id) return next(e);
    const open = await read($, spendOpenAtom);
    if (open.project === undefined && open.day === undefined) return next(e);
    await closeDetail($);
    return keepPane($);
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e, next) => {
    if (!isShownTab(SPEND_TAB.id)) return next(e);
    const [spend, engineSessionUsd, totals, now, isMainTurnRunning, open] = await Promise.all([
      read($, spendAtom),
      read($, sessionUsdAtom),
      read($, spendTotalsAtom),
      $.clock.now(),
      read($, mainTurnRunningAtom),
      read($, spendOpenAtom),
    ]);
    const warmUntil = warmUntilOf(spend.mainMemory);
    if (warmUntil !== undefined && warmUntil > now) keepColdFlip($, warmUntil, now);
    const options = isMainTurnRunning ? [] : await coldOptions($, spend, now, e.props.bodyColumns);
    if (justEntered(SPEND_TAB.id)) void refreshSpendTotals($);
    const shownTotals = totals ?? NO_TOTALS;
    const sessionUsd = sessionSpendUsd(totals, engineSessionUsd, spend);
    return spendTab($.ui.resolve(e), {
      width: e.props.bodyColumns,
      sessionUsd,
      rows: splitRows(spend, sessionUsd),
      spend,
      history: historyOf(shownTotals, now),
      detail: detailOf(shownTotals.slices ?? [], open, now),
      unfolded: open.unfolded,
      progress: shownTotals.progress ?? null,
      now,
      options,
      openProject: (name) => void openDetail($, { project: name, day: open.day }),
      openDay: (id) => void openDetail($, { day: id }),
      openAgents: (ids) => void openAgents($, ids),
      openCall: (id) => void openCall($, id),
      back: () => void closeDetail($),
      toggle: (list) => void toggleList($, list),
    });
  });
}

function historyOf(totals: SpendTotals, now: number): SpendHistory {
  const week = totals.week ?? 0;
  const activeHours = totals.activeHours ?? 0;
  const slices = totals.slices ?? [];
  return {
    today: totals.today ?? 0,
    week,
    month: totals.month ?? 0,
    lastHour: totals.lastHour ?? 0,
    hourAverage: activeHours > 0 ? week / activeHours : null,
    projects: rankedRows((totals.projects ?? []).map(({ name, usd }) => ({ id: name, name, usd }))),
    days: rankedRows(daysOf(slices, now)),
  };
}

function detailOf(
  slices: readonly SpendSlice[],
  open: { project?: string; day?: string },
  now: number,
): SpendDetail | null {
  if (open.project !== undefined && open.day !== undefined) {
    const mine = slices.filter(({ project, day }) => project === open.project && day === open.day);
    return {
      title: `${open.project}${SEPARATOR}${dayName(open.day, now)}`,
      total: usdOf(mine),
      ranked: { key: `project-day:${open.project}:${open.day}`, title: "", opens: "day", rows: [] },
      sessionsKey: `sessions:project-day:${open.project}:${open.day}`,
      sessions: rankedRows(sessionsOf(mine)),
    };
  }
  if (open.project !== undefined) {
    const mine = slices.filter(({ project }) => project === open.project);
    return {
      title: `${open.project}${SEPARATOR}${MONTH_DAYS}`,
      total: usdOf(mine),
      ranked: {
        key: `project-days:${open.project}`,
        title: "Costliest days",
        opens: "day",
        rows: rankedRows(daysOf(mine, now)),
      },
      sessionsKey: `sessions:project:${open.project}`,
      sessions: rankedRows(sessionsOf(mine)),
    };
  }
  if (open.day === undefined) return null;
  const mine = slices.filter(({ day }) => day === open.day);
  return {
    title: dayName(open.day, now),
    total: usdOf(mine),
    ranked: {
      key: `day-projects:${open.day}`,
      title: "By project",
      opens: "project",
      rows: rankedRows(projectsOf(mine)),
    },
    sessionsKey: `sessions:day:${open.day}`,
    sessions: rankedRows(sessionsOf(mine)),
  };
}

function usdOf(slices: readonly SpendSlice[]): number {
  return slices.reduce((total, { usd }) => total + usd, 0);
}

function daysOf(slices: readonly SpendSlice[], now: number): RankItem[] {
  return groupedItems(
    slices,
    ({ day }) => day,
    (day) => dayName(day, now),
  );
}

function projectsOf(slices: readonly SpendSlice[]): RankItem[] {
  return groupedItems(
    slices,
    ({ project }) => project,
    (project) => project,
  );
}

function sessionsOf(slices: readonly SpendSlice[]): RankItem[] {
  return groupedItems(
    slices,
    ({ session }) => session,
    (_session, group) =>
      group.some(({ isOwn }) => isOwn)
        ? OWN_SESSION
        : callTime(Math.min(...group.map(({ at }) => at))),
  );
}

function callTime(at: number): string {
  return `${new Date(at).toLocaleDateString("en-US", CALL_DAY_FORMAT)}, ${clockOf(at)}`;
}

function groupedItems(
  slices: readonly SpendSlice[],
  keyOf: (slice: SpendSlice) => string,
  nameOf: (key: string, group: SpendSlice[]) => string,
): RankItem[] {
  const groups = new Map<string, SpendSlice[]>();
  for (const slice of slices) {
    const key = keyOf(slice);
    const group = groups.get(key) ?? [];
    group.push(slice);
    groups.set(key, group);
  }
  return [...groups].map(([id, group]) => ({ id, name: nameOf(id, group), usd: usdOf(group) }));
}

function dayName(day: string, now: number): string {
  if (day === dayKey(now)) return "today";
  return new Date(`${day}T00:00:00`).toLocaleDateString("en-US", DAY_NAME_FORMAT);
}

function dayKey(at: number): string {
  const time = new Date(at);
  const pad = (part: number): string => String(part).padStart(2, "0");
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}`;
}

function rankedRows(items: readonly RankItem[]): SplitRow[] {
  const spent = items.filter(({ usd }) => usd > 0).sort((left, right) => right.usd - left.usd);
  const total = spent.reduce((sum, { usd }) => sum + usd, 0);
  const cents = roundedCents(
    spent.map(({ usd }) => usd),
    centsOf(total),
  );
  const split = spent.map(({ id, name, usd }, index): SplitShare => ({
    id,
    name,
    cents: cents[index] ?? 0,
    value: usd,
  }));
  return withPercents(withMoreRow(split), total);
}

async function openDetail(
  $: EngineInterface,
  target: { project?: string; day?: string },
): Promise<void> {
  await enterDetail($, SPEND_TAB.id);
  await update($, spendOpenAtom, ({ unfolded }) => ({ ...target, unfolded }));
}

async function openAgents($: EngineInterface, ids: string[]): Promise<void> {
  const [only] = ids;
  if (ids.length === 1 && only !== undefined) {
    await enterDetail($, AGENTS_TAB_ID);
    await update($, openAgentAtom, () => only);
  }
  await update($, tabAtom, () => AGENTS_TAB_ID);
}

async function openCall($: EngineInterface, id: string): Promise<void> {
  await showCall($, id);
  await update($, tabAtom, () => ACTIVITY_TAB_ID);
}

async function closeDetail($: EngineInterface): Promise<void> {
  await update($, spendOpenAtom, ({ unfolded }) => ({ unfolded }));
  await leaveDetail($, SPEND_TAB.id);
}

async function toggleList($: EngineInterface, list: string): Promise<void> {
  await update($, spendOpenAtom, (open) => ({
    ...open,
    unfolded: open.unfolded.includes(list)
      ? open.unfolded.filter((key) => key !== list)
      : [...open.unfolded, list],
  }));
}

async function coldOptions(
  $: EngineInterface,
  spend: SpendState,
  now: number,
  columns: number,
): Promise<CacheOption[]> {
  const { mainMemory: memory } = spend;
  const warmUntil = warmUntilOf(memory);
  const isWarm = warmUntil === undefined || warmUntil > now;
  if (memory?.size === undefined || memory.ttl === undefined || isWarm) return [];
  const breakdown = await contextBreakdown((args) => $.session.usage(args), columns);
  if (breakdown === null) return [];
  const size = spend.lastTurn?.contextTokens ?? memory.size;
  return nextTurnOptions(memory.model, size, baseTokens(breakdown), memory.ttl);
}
