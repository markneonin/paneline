import { describe, expect, mock, test } from "claude-code/testing";
import type { On, SessionContextBreakdown, SessionContextUsage } from "claude-code";
import type { Engine } from "claude-code/testing";

import {
  lines,
  paneOnTab,
  readFile,
  runCommand,
  settle,
  showTab,
  texts,
  worldOf,
} from "./clear-world";
import type { Pane } from "./clear-world";
import { collect, textOf } from "./draw-tree";
import type { Line } from "./skills-tree";
import { paneInk } from "../hooks/pane-ink";

type Tab = {
  label: string;
  open: ($: Engine, on: On) => Promise<Pane>;
  filter: string;
  kept: string;
  hidden: string;
};

const WINDOW = 200_000;
const NOW = 200_000;
const HOME = "/h/u";
const CWD = "/work";
const AGENTS = "Agents";
const COMPACT = "compact";
const EMPTY = "";
const CLEAR = "clear";
const NO_HINT = "";
const FILTER_KEY = "filter";
const FILTER_HINT_KEY = "filter-hint";
const FILTER_OPEN_KEY = "filter-open";
const PANE_ID = "session";
const HINT_LETTER = "f";
const HINT_WORD = " filter";
const SKILLS = [
  { name: "commit", source: "userSettings" },
  { name: "deploy-notes", source: "userSettings" },
];

const TABS: Tab[] = [
  { label: "Activity", open: openActivity, filter: "bash", kept: "npm test", hidden: "notes.md" },
  { label: "Files", open: openFiles, filter: "draw", kept: "draw.ts", hidden: "notes.md" },
  { label: "Skills", open: openSkills, filter: "deploy", kept: "deploy-notes", hidden: "commit" },
];

describe("filter row Enter clears the filter", () => {
  for (const tab of TABS) {
    test(`S1 ${tab.label}: Enter on a filter that narrows the list empties the box, lists every row again, and drops the Enter hint`, async ($, on) => {
      const pane = await tab.open($, on);
      const full = await texts(pane);
      await typeFilter(pane, tab);
      expect(await hasText(pane, tab.hidden)).toBe(false);

      await submitFilter(pane, tab);

      expect(await boxValue(pane)).toBe(EMPTY);
      expect(await texts(pane)).toEqual(full);
      expect(await boxSubmitLabel(pane)).toBe(NO_HINT);
    });

    test(`S2 ${tab.label}: after Enter on a filter, going to Agents and back empties the box and lists every row`, async ($, on) => {
      const pane = await tab.open($, on);
      const full = await texts(pane);
      await typeFilter(pane, tab);
      expect(await hasText(pane, tab.hidden)).toBe(false);
      await submitFilter(pane, tab);

      await showTab(pane, AGENTS);
      await showTab(pane, tab.label);

      expect(await boxValue(pane)).toBe(EMPTY);
      expect(await texts(pane)).toEqual(full);
    });

    test(`S3 ${tab.label}: after Enter on a filter, the session compacts and the box is empty with every row listed`, async ($, on) => {
      const pane = await tab.open($, on);
      const full = await texts(pane);
      await typeFilter(pane, tab);
      expect(await hasText(pane, tab.hidden)).toBe(false);
      await submitFilter(pane, tab);

      await $.classic.SessionStart({ source: COMPACT } as never);
      await settle(pane);

      expect(await boxValue(pane)).toBe(EMPTY);
      expect(await texts(pane)).toEqual(full);
    });

    test(`S4 ${tab.label}: with the filter box empty, no Enter hint word is drawn beside it`, async ($, on) => {
      const pane = await tab.open($, on);

      expect(await boxSubmitLabel(pane)).toBe(NO_HINT);
    });

    test(`S5 ${tab.label}: with text in the filter box, the Enter hint beside it reads clear`, async ($, on) => {
      const pane = await tab.open($, on);
      await typeFilter(pane, tab);

      expect(await boxSubmitLabel(pane)).toBe(CLEAR);
    });
  }
});

describe("filter row key hint", () => {
  for (const tab of TABS) {
    test(`F1 ${tab.label}: the filter hint reads f filter with no colon, the f in the text colour and filter in the muted colour`, async ($, on) => {
      const pane = await tab.open($, on);

      const row = hintRowOf(await lines(pane));
      expect(row?.text ?? "").toMatch(/^f filter/);
      expect(textColours(row, HINT_LETTER)).toEqual([paneInk().text]);
      expect(textColours(row, HINT_WORD)).toEqual([paneInk().muted]);
    });

    test(`F3 ${tab.label}: pressing the visible filter hint asks for the pane to open with focus, the same way the f key does`, async ($, on) => {
      const opened = openRequestsOf(on);
      const pane = await tab.open($, on);

      await pane.press({ key: FILTER_HINT_KEY });
      const byHint = opened.splice(0);
      await pane.press({ key: FILTER_OPEN_KEY });
      const byKey = opened.splice(0);

      expect(byHint).toEqual([{ id: PANE_ID, focus: true }]);
      expect(byHint).toEqual(byKey);
    });
  }
});

async function typeFilter(pane: Pane, tab: Tab): Promise<void> {
  await pane.input({ key: "filter", text: tab.filter, kind: "change" });
  await settle(pane);
  expect(await hasText(pane, tab.kept)).toBe(true);
}

async function submitFilter(pane: Pane, tab: Tab): Promise<void> {
  await pane.input({ key: "filter", text: tab.filter, kind: "submit" });
  await settle(pane);
}

async function boxValue(pane: Pane): Promise<unknown> {
  const box = await pane.find({ type: "Input", key: "filter" });
  return box?.props.value;
}

async function boxSubmitLabel(pane: Pane): Promise<unknown> {
  const box = await pane.find({ type: "Input", key: "filter" });
  return box?.props.submitLabel;
}

async function hasText(pane: Pane, fragment: string): Promise<boolean> {
  return (await texts(pane)).some((text) => text.includes(fragment));
}

async function openActivity($: Engine, on: On): Promise<Pane> {
  const world = worldOf(on);
  answerWrites(on);
  await runCommand($, world, "npm test");
  await readFile($, world, "/work/docs/notes.md");
  return paneOnTab($, "Activity");
}

async function openFiles($: Engine, on: On): Promise<Pane> {
  const world = worldOf(on);
  answerWrites(on);
  await readFile($, world, "/work/src/draw.ts");
  await readFile($, world, "/work/docs/notes.md");
  return paneOnTab($, "Files");
}

function answerWrites(on: On): void {
  on("fs.write", () => ({ value: undefined }));
  on("fs.list", () => ({ value: [] }));
}

async function openSkills($: Engine, on: On): Promise<Pane> {
  skillsWorldOf(on);
  return paneOnTab($, "Skills");
}

function skillsWorldOf(on: On): void {
  const stored = new Map<string, unknown>();
  mock.clock(on, { now: NOW });
  mock.env(on, { HOME });
  on("store.get", (_$, e) => ({ value: stored.get(e.key) }));
  on("store.set", (_$, e) => {
    stored.set(e.key, e.value);
    return { value: undefined };
  });
  on("session.id", () => ({ value: "session-one" }));
  on("session.cwd", () => ({ value: CWD }));
  on("session.model", () => ({ value: "opus" }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.usage", (_$, e) => ({
    value: {
      startedAt: 0,
      context: e.breakdown === undefined ? { window: WINDOW } : skillsContext(),
      rateLimits: [],
    },
  }));
  on("settings.read", () => ({ value: {} }));
  on("fs.exists", () => ({ value: false }));
  answerWrites(on);
  on("process.run", () => ({ value: { exitCode: 0, stdout: "", stderr: "" } }) as never);
  on("agent.list", () => ({ value: [] }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("classic.SessionStart", () => ({}));
}

function skillsContext(): SessionContextUsage {
  const breakdown = {
    categories: [],
    totalTokens: 0,
    rawMaxTokens: WINDOW,
    gridRows: [],
    memoryFiles: [],
    agents: [],
    mcpTools: [],
    skills: {
      totalSkills: SKILLS.length,
      includedSkills: SKILLS.length,
      tokens: 0,
      skillFrontmatter: SKILLS.map((skill) => ({ ...skill, tokens: 10 })),
    },
  } as unknown as SessionContextBreakdown;
  return { window: WINDOW, breakdown };
}

function openRequestsOf(on: On): { id: string; focus?: boolean }[] {
  const requests: { id: string; focus?: boolean }[] = [];
  on("ui.open", { id: PANE_ID }, (_$, e, next) => {
    requests.push({ id: e.id, focus: e.focus });
    return next(e);
  });
  return requests;
}

function hintRowOf(shown: Line[]): Line | undefined {
  return shown.find((line) => line.text.includes(FILTER_KEY));
}

function textColours(row: Line | undefined, text: string): unknown[] {
  const texts = (row?.parts ?? [])
    .filter((part) => part.type === "Button")
    .flatMap((button) => collect(button, "Text"));
  const colours = texts.filter((node) => textOf(node) === text).map((node) => node.props?.color);
  return [...new Set(colours)];
}
