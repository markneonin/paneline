import { describe, expect, test } from "claude-code/testing";
import type { On } from "claude-code";

import { shownTexts } from "./skills-tree";
import { COLUMNS, SUBSCRIPTION, openPane, settle, startFreshSession, worldOf } from "./spend-world";
import type { Pane } from "./spend-world";

const KEYS = ["h", "hi", "his", "hist", "histo"];
const OLD_DATE = "2026-10-21T10:00:00.000Z";
const MAX_TAB_PRESSES = 12;
const SETTLE_MS = 300;
const LAST_ROW = "Oct 21 demo-app · main histo old prompt";

describe("history past-session search load", () => {
  test("P5-1 five filter keys in a row leave at most one past search running after each key and show the last text's rows", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    on("turn.start", (_$, e) => ({ turnId: e.turnId }));
    const search = silentSearchesWorld(on, KEYS[KEYS.length - 1] ?? "");
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    const pending: Promise<unknown>[] = [];
    const aliveAfterKey: number[] = [];
    for (const text of KEYS) {
      pending.push(pane.input({ key: "filter", text, kind: "change" }));
      await pane.findAll({ type: "Button" });
      aliveAfterKey.push(search.alive());
    }
    search.releaseAll();
    await Promise.all(pending);
    await settle(pane);

    expect(Math.max(...aliveAfterKey)).toBeLessThanOrEqual(1);
    const texts = shownTexts(await pane.drawn()).filter((text) => text.startsWith("Oct 21"));
    expect(texts).toEqual([LAST_ROW]);
  });

  test("P5-1b five filter keys fired back to back leave at most one past search running once things settle and show the last text's rows", async ($, on) => {
    const world = worldOf(on, SUBSCRIPTION);
    on("turn.start", (_$, e) => ({ turnId: e.turnId }));
    const search = silentSearchesWorld(on, KEYS[KEYS.length - 1] ?? "");
    const pane = await openPane($, COLUMNS);
    await startFreshSession($, world);
    await showHistory(pane);

    const pending = KEYS.map((text) => pane.input({ key: "filter", text, kind: "change" }));
    await world.clock.advance(SETTLE_MS);
    const aliveWhenSettled = search.alive();
    search.releaseAll();
    await Promise.all(pending);
    await settle(pane);

    expect(aliveWhenSettled).toBeLessThanOrEqual(1);
    const texts = shownTexts(await pane.drawn()).filter((text) => text.startsWith("Oct 21"));
    expect(texts).toEqual([LAST_ROW]);
  });
});

function silentSearchesWorld(
  on: On,
  answeredText: string,
): { alive: () => number; releaseAll: () => void } {
  let alive = 0;
  const releases: (() => void)[] = [];
  on("process.spawn", async function* (_$, e, next) {
    if (e.argv.includes("-e")) return { value: { code: 0, signal: null } };
    const needle = e.argv[e.argv.indexOf("--") + 1];
    alive++;
    try {
      if (needle === answeredText) {
        yield { stream: "stdout", text: oldPrompt(`${answeredText} old prompt`) };
        return { value: { code: 0, signal: null } };
      }
      await new Promise<void>((resolve) => {
        releases.push(resolve);
        next.signal.addEventListener("abort", () => resolve());
      });
      return { value: { code: null, signal: null } };
    } finally {
      alive--;
    }
  });
  return {
    alive: () => alive,
    releaseAll: () => releases.forEach((release) => release()),
  };
}

function oldPrompt(text: string): string {
  return `${JSON.stringify({
    timestamp: OLD_DATE,
    cwd: "/work/demo-app",
    gitBranch: "main",
    type: "user",
    message: { role: "user", content: text },
  })}\n`;
}

async function showHistory(pane: Pane): Promise<void> {
  for (let press = 0; press < MAX_TAB_PRESSES; press++) {
    const buttons = await pane.findAll({ type: "Button" });
    const tab = buttons.find((button) => button.props.label === "History");
    const next = buttons.find((button) => String(button.props.label).includes("›"));
    const target = tab ?? next;
    expect(target, "a History tab button or the › arrow").toBeDefined();
    await pane.press({ key: target?.key ?? "" });
    await settle(pane);
    if (tab !== undefined) return;
  }
}
