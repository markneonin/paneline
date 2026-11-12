import { describe, expect, mock, test } from "claude-code/testing";
import type { ElementTable, On, RenderElement, SessionContextBreakdown } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import type { Activity } from "../types";
import { collect, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import { inkFor } from "../hooks/pane-ink";
import { TAB_BAR_ROWS } from "../hooks/tab-bar";
import { linesOf } from "./skills-tree";

type Pane = Mounted<"terminal", "Pane">;
type World = { windowOffset: () => number; usageReads: () => number };

const NOW = 200_000;
const COLUMNS = 80;
const PANE_ROWS = 40;
const SETTLE_TICKS = 5;
const SESSION = "session";
const HOME = "/h/u";
const CWD = "/work";
const SKILLS_TAB = "Skills";
const FILES_TAB = "Files";
const LONG_SKILL_COUNT = 60;
const SHORT_SKILL_COUNT = 3;
const LONG_FILE_COUNT = 60;
const SCROLL_ROWS = 5;
const SHORT_SCROLL_ROWS = 3;
const SELECTED_TAB_TEXT = "clawd_background";
const ACTIVITY_KEY = "activity";
const SESSION_ID = "session-one";
const SHORT_PANE_ROWS = 20;
const ACTIVITY_CALLS = 40;
const LIST_SCROLL_ROWS = 12;
const BACK_LABEL = "back";
const FILE_LABEL = "file-01.ts";
const FOLDER_OPEN = "▾ src/";
const FOLDER_CLOSED = "▸ src/";
const DIFF_LINES = 80;
const SKILL_TOKENS = 10;
const TAB_KEY = "tab";
const PROBE_TAB = "probe";
const FIRST_SKILL = "skill 01";
const FIRST_DESCRIPTION = "Reads the first set of words";

describe("pane scroll", () => {
  test("K2 a long Skills tab scrolled down by 5 rows keeps the tab bar on row 0 and starts the list 5 rows lower", async ($, on) => {
    const world = worldOf(on, { skills: LONG_SKILL_COUNT, files: [] });
    await startSession($);
    const pane = await mountPane($);
    await showTab(pane, SKILLS_TAB);
    const top = await screenOf(pane, world);

    await scrollBy($, pane, SCROLL_ROWS);

    const after = await screenOf(pane, world);
    expect(after[0]).toBe(top[0]);
    expect(await selectedTabOf(pane)).toBe(SKILLS_TAB);
    expect(after.slice(TAB_BAR_ROWS, PANE_ROWS - SCROLL_ROWS)).toEqual(
      top.slice(TAB_BAR_ROWS + SCROLL_ROWS),
    );
  });

  test("K3 End on a long Skills tab keeps the tab bar on row 0 and puts the last skill on the bottom row, and Home brings the top back under the tab bar", async ($, on) => {
    const world = worldOf(on, { skills: LONG_SKILL_COUNT, files: [] });
    await startSession($);
    const pane = await mountPane($);
    await showTab(pane, SKILLS_TAB);
    const top = await screenOf(pane, world);
    const lastRow = linesOf(await pane.drawn()).at(-1)?.text;

    await scrollBy($, pane, await contentRowsOf(pane));
    const end = await screenOf(pane, world);
    expect(end[0]).toBe(top[0]);
    expect(end[PANE_ROWS - 1]).toBe(lastRow);

    await scrollBy($, pane, -(await contentRowsOf(pane)));

    expect(await screenOf(pane, world)).toEqual(top);
  });

  test("K6 after scrolling Skills, clicking Files shows the top of Files, the same screen as a Files tab opened fresh", async ($, on) => {
    const world = worldOf(on, { skills: LONG_SKILL_COUNT, files: longFiles() });
    await startSession($);
    const pane = await mountPane($);
    await showTab(pane, FILES_TAB);
    const freshFiles = await screenOf(pane, world);
    await showTab(pane, SKILLS_TAB);
    await scrollBy($, pane, SCROLL_ROWS);

    await showTab(pane, FILES_TAB);

    expect(await screenOf(pane, world)).toEqual(freshFiles);
  });

  test("K7 a Skills tab shorter than the pane does not move when scrolled up or down by 3 rows", async ($, on) => {
    const world = worldOf(on, { skills: SHORT_SKILL_COUNT, files: [] });
    await startSession($);
    const pane = await mountPane($);
    await showTab(pane, SKILLS_TAB);
    const top = await screenOf(pane, world);

    await scrollBy($, pane, -SHORT_SCROLL_ROWS);
    expect(await screenOf(pane, world)).toEqual(top);

    await scrollBy($, pane, SHORT_SCROLL_ROWS);
    expect(await screenOf(pane, world)).toEqual(top);
  });
});

type WorldOptions = {
  skills: number;
  files?: Activity[];
  skillDescription?: () => string;
  probe?: (ui: ElementTable) => RenderElement;
};

function worldOf(on: On, options: WorldOptions): World {
  let windowOffset = 0;
  let usageReads = 0;
  const skillsNow = () =>
    Array.from({ length: options.skills }, (_, index) => ({
      name: `skill ${String(index + 1).padStart(2, "0")}`,
      source: "userSettings",
      tokens: SKILL_TOKENS,
    }));
  mock.clock(on, { now: NOW });
  mock.env(on, { HOME });
  on("state.get", (_$, e, next) =>
    e.key === ACTIVITY_KEY && options.files !== undefined
      ? { value: { value: options.files, version: 1 } }
      : e.key === TAB_KEY && options.probe !== undefined
        ? { value: { value: PROBE_TAB, version: 1 } }
        : next(e),
  );
  on("config.list", () => ({ value: [{ key: "theme", value: "dark" }] }) as never);
  on("store.get", () => ({ value: undefined }));
  on("store.set", () => ({ value: undefined }));
  on("store.delete", () => ({ value: undefined }));
  on("store.keys", () => ({ value: [] }));
  on("classic.SessionStart", () => ({}));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("command.register", () => ({ value: {} }) as never);
  on("agent.list", () => ({ value: [] }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("command.list", () =>
    options.skillDescription === undefined
      ? { value: [] }
      : {
          value: Array.from({ length: options.skills }, (_, index) => ({
            name: `skill ${String(index + 1).padStart(2, "0")}`,
            description: options.skillDescription?.() ?? "",
            source: "user",
          })),
        },
  );
  on("session.usage", () => {
    usageReads++;
    const skills = skillsNow();
    return {
      value: {
        startedAt: 0,
        context: {
          window: 200_000,
          breakdown: {
            categories: [],
            totalTokens: 0,
            rawMaxTokens: 200_000,
            gridRows: [],
            memoryFiles: [],
            mcpTools: [],
            agents: [],
            autoCompactThreshold: 160_000,
            skills: {
              totalSkills: skills.length,
              includedSkills: skills.length,
              tokens: 0,
              skillFrontmatter: skills,
            },
          } as unknown as SessionContextBreakdown,
        },
        rateLimits: [],
      },
    };
  });
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.model", () => ({ value: "opus" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: CWD }));
  on("session.messages", () => ({ value: [] }));
  on("session.id", () => ({ value: SESSION_ID }));
  on("fs.exists", (_$, e) => ({ value: e.path.startsWith(CWD) }));
  on("ui.scroll", (_$, e) => {
    windowOffset = windowAfter(windowOffset, e.by, e.contentRows, e.bodyRows);
    return {};
  });
  on("ui.render", { component: "Pane" }, ($, e) => {
    const ui = $.ui.resolve(e);
    if (options.probe !== undefined) return options.probe(ui);
    return <ui.Text>engine pane</ui.Text>;
  });
  return { windowOffset: () => windowOffset, usageReads: () => usageReads };
}

function windowAfter(offset: number, by: number, contentRows: number, bodyRows: number): number {
  const last = Math.max(0, contentRows - bodyRows);
  return Math.min(Math.max(offset + by, 0), last);
}

function longFiles(): Activity[] {
  return Array.from({ length: LONG_FILE_COUNT }, (_, index) => ({
    id: `file-${index}`,
    tool: "Read",
    target: `${CWD}/file-${String(index + 1).padStart(2, "0")}.ts`,
    ms: 1,
    isErrored: false,
    added: 0,
    removed: 0,
  }));
}

async function startSession($: Engine): Promise<void> {
  await $.session.start({ cwd: CWD, surface: "terminal", isInteractive: true });
}

function mountPane($: Engine, rows: number = PANE_ROWS): Promise<Pane> {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: SESSION,
    props: {
      title: "Session",
      isFocused: false,
      bodyColumns: COLUMNS,
      placement: "dock",
      scroll: { offset: 0, bodyRows: rows },
      view: {},
    },
    viewport: { columns: COLUMNS, rows },
  });
}

async function showTab(pane: Pane, label: string): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const tab = buttons.find((button) => button.props.label === label);
  expect(tab, `the tab bar has a ${label} tab`).toBeDefined();
  await pane.press({ key: tab?.key ?? "" });
  await settle(pane);
}

async function scrollBy($: Engine, pane: Pane, by: number): Promise<void> {
  await $.ui.scroll({
    component: "Pane",
    requestId: SESSION,
    offset: 0,
    by,
    bodyRows: PANE_ROWS,
    contentRows: await contentRowsOf(pane),
    origin: { kind: "person" },
  });
  await settle(pane);
}

async function contentRowsOf(pane: Pane): Promise<number> {
  return linesOf(await pane.drawn()).length;
}

async function screenOf(pane: Pane, world: World, rows: number = PANE_ROWS): Promise<string[]> {
  const offset = world.windowOffset();
  const lines = linesOf(await pane.drawn());
  return lines.slice(offset, offset + rows).map((line) => line.text);
}

async function selectedTabOf(pane: Pane): Promise<string> {
  const selected = collect(await pane.drawn(), "Text").filter(
    (text: Node) => text.props?.color === SELECTED_TAB_TEXT,
  );
  return selected.map(textOf).join("").trim();
}

async function settle(pane: Pane): Promise<void> {
  for (let tick = 0; tick < SETTLE_TICKS; tick++) await pane.redraw();
}

describe("pane box cut cue", () => {
  test("N1 a tab 10 rows taller than the pane ends its last row on an 11 more lines cue in the muted look", async ($, on) => {
    worldOf(on, { skills: LONG_SKILL_COUNT, files: [] });
    await startSession($);
    const pane = await mountPane($);
    await showTab(pane, SKILLS_TAB);

    await checkWindow($, pane, { by: 0, contentRows: PANE_ROWS + 10 });

    const cue = await cueOf(pane);
    expect(cue?.text).toBe("… 11 more lines");
    expect(cue?.box).toMatchObject({ top: PANE_ROWS - 1, left: 1 });
    expect(cue?.color).toBe(inkFor("dark").muted);
  });

  test("N2 a tab exactly as tall as the pane shows no cue", async ($, on) => {
    worldOf(on, { skills: LONG_SKILL_COUNT, files: [] });
    await startSession($);
    const pane = await mountPane($);
    await showTab(pane, SKILLS_TAB);

    await checkWindow($, pane, { by: 0, contentRows: PANE_ROWS });

    expect(await cueOf(pane)).toBeUndefined();
  });

  test("N3 a tab shorter than the pane shows no cue", async ($, on) => {
    worldOf(on, { skills: LONG_SKILL_COUNT, files: [] });
    await startSession($);
    const pane = await mountPane($);
    await showTab(pane, SKILLS_TAB);

    await checkWindow($, pane, { by: 0, contentRows: PANE_ROWS - 10 });

    expect(await cueOf(pane)).toBeUndefined();
  });

  test("N4 a tab one row taller than the pane says 2 more lines, because the cue covers one row", async ($, on) => {
    worldOf(on, { skills: LONG_SKILL_COUNT, files: [] });
    await startSession($);
    const pane = await mountPane($);
    await showTab(pane, SKILLS_TAB);

    await checkWindow($, pane, { by: 0, contentRows: PANE_ROWS + 1 });

    expect((await cueOf(pane))?.text).toBe("… 2 more lines");
  });

  test("N5 after scrolling 4 rows of a tab 10 rows taller than the pane the cue counts the 6 rows left below and the one it covers", async ($, on) => {
    worldOf(on, { skills: LONG_SKILL_COUNT, files: [] });
    await startSession($);
    const pane = await mountPane($);
    await showTab(pane, SKILLS_TAB);

    await checkWindow($, pane, { by: 4, contentRows: PANE_ROWS + 10 });

    expect((await cueOf(pane))?.text).toBe("… 7 more lines");
  });

  test("N6 a tab scrolled to its end shows no cue and its last row on the bottom row", async ($, on) => {
    worldOf(on, { skills: LONG_SKILL_COUNT, files: [] });
    await startSession($);
    const pane = await mountPane($);
    await showTab(pane, SKILLS_TAB);
    const lastRow = linesOf(await pane.drawn()).at(-1)?.text;
    const fullRows = await contentRowsOf(pane);

    await checkWindow($, pane, { by: fullRows, contentRows: fullRows });
    await checkWindow($, pane, { by: 0, contentRows: fullRows + PANE_ROWS });

    expect(await cueOf(pane)).toBeUndefined();
    expect(linesOf(await pane.drawn())[PANE_ROWS - 1]?.text).toBe(lastRow);
  });

  test("N7 pressing another tab while the cue shows draws that tab's first frame without it", async ($, on) => {
    worldOf(on, { skills: LONG_SKILL_COUNT, files: [] });
    await startSession($);
    const pane = await mountPane($);
    await showTab(pane, SKILLS_TAB);
    await checkWindow($, pane, { by: 0, contentRows: PANE_ROWS + 10 });
    expect(await cueOf(pane), "the cue shows before the press").toBeDefined();

    await pressTabKey(pane, FILES_TAB);
    await pane.redraw();

    expect(await cueOf(pane)).toBeUndefined();
  });

  test("N8 drawing the cue does not read the Skills tab's data again", async ($, on) => {
    const world = worldOf(on, { skills: LONG_SKILL_COUNT, files: [] });
    await startSession($);
    const pane = await mountPane($);
    await showTab(pane, SKILLS_TAB);
    const before = world.usageReads();

    await checkWindow($, pane, { by: 0, contentRows: PANE_ROWS + 10 });

    expect(await cueOf(pane), "the cue shows").toBeDefined();
    expect(world.usageReads()).toBe(before);
  });
});

describe("pane box cue after the tab changes by another route", () => {
  test("N9 after the Skills tab shows the cue, /paneline opens the Activity tab, which fits, without it", async ($, on) => {
    worldOf(on, { skills: LONG_SKILL_COUNT, files: [] });
    await startSession($);
    const pane = await mountPane($);
    await showTab(pane, SKILLS_TAB);
    await showCue($, pane);

    await runPanelineCommand($);
    await settle(pane);

    expect(await selectedTabOf(pane)).toBe(ACTIVITY_TAB);
    expect(await cueOf(pane)).toBeUndefined();
  });

  test("N10 after the Skills tab shows the cue, the Details button in the chat opens the Activity tab, which fits, without it", async ($, on) => {
    worldOf(on, { skills: LONG_SKILL_COUNT, files: [] });
    await startSession($);
    const pane = await mountPane($);
    await showTab(pane, SKILLS_TAB);
    await showCue($, pane);
    const group = await mountToolGroup($);

    const [details] = (await group.findAll({ type: "Button" })).filter(
      (button) => button.props.label === DETAILS_LABEL,
    );
    await group.press({ key: details?.key ?? "" });
    await settle(pane);

    expect(await selectedTabOf(pane)).toBe(ACTIVITY_TAB);
    expect(await cueOf(pane)).toBeUndefined();
  });

  test("N11 after the Context tab shows the cue, its Skills tab link opens the short Skills tab without it", async ($, on) => {
    worldOf(on, { skills: SHORT_SKILL_COUNT, files: [] });
    await startSession($);
    const pane = await mountPane($);
    await showTab(pane, CONTEXT_TAB);
    await showCue($, pane);

    await pressButton(pane, SKILLS_LINK_LABEL);

    expect(await selectedTabOf(pane)).toBe(SKILLS_TAB);
    expect(await cueOf(pane)).toBeUndefined();
  });

  test("N12 after the Activity list shows the cue, opening a call shows its short detail view without it", async ($, on) => {
    const world = worldOf(on, { skills: 0 });
    await feedCalls($, on, SHORT_CALLS);
    await startSession($);
    const pane = await mountPane($);
    await showCue($, pane);

    await pane.press({ key: `call-c-${SHORT_CALLS}` });
    await settle(pane);

    expect((await screenOf(pane, world)).join("\n")).toContain(BACK_LABEL);
    expect(await cueOf(pane)).toBeUndefined();
  });

  test("N13 after a call's detail view shows the cue, back shows the short call list without it", async ($, on) => {
    const world = worldOf(on, { skills: 0 });
    await feedCalls($, on, SHORT_CALLS);
    await startSession($);
    const pane = await mountPane($);
    await pane.press({ key: `call-c-${SHORT_CALLS}` });
    await settle(pane);
    await showCue($, pane);

    await pressButton(pane, BACK_LABEL);

    expect((await screenOf(pane, world)).join("\n")).not.toContain(BACK_LABEL);
    expect(await cueOf(pane)).toBeUndefined();
  });

  test("N14 after the Files tab shows the cue, a refresh that leaves 2 files draws the tab without it", async ($, on) => {
    const files = longFiles();
    worldOf(on, { skills: 0, files });
    await startSession($);
    const pane = await mountPane($);
    await showTab(pane, FILES_TAB);
    await showCue($, pane);
    const tallRows = await contentRowsOf(pane);

    files.splice(2);
    await settle(pane);

    expect(await contentRowsOf(pane), "the refresh shortened the tab").toBeLessThan(tallRows);
    expect(await cueOf(pane)).toBeUndefined();
  });

  test("N15 after the Files tab shows the cue, a redraw that changes only the added count keeps the same 11 more lines cue", async ($, on) => {
    const files = longFiles().map((file) => ({ ...file, tool: "Edit", added: 1 }));
    worldOf(on, { skills: 0, files });
    await startSession($);
    const pane = await mountPane($);
    await showTab(pane, FILES_TAB);
    await showCue($, pane);

    for (const file of files) file.added = 3;
    await settle(pane);

    expect(textsOf(await pane.drawn()), "the redraw shows the new count").toContain("+3");
    expect((await cueOf(pane))?.text).toBe("… 11 more lines");
  });

  test("N16 after the Files tab shows the cue, a redraw that adds a file row draws the tab without it", async ($, on) => {
    const files = longFiles();
    worldOf(on, { skills: 0, files });
    await startSession($);
    const pane = await mountPane($);
    await showTab(pane, FILES_TAB);
    await showCue($, pane);
    const tallRows = await contentRowsOf(pane);

    files.push({ ...longFiles()[0]!, id: "file-extra", target: `${CWD}/file-extra.ts` });
    await settle(pane);

    expect(await contentRowsOf(pane), "the refresh added a row").toBeGreaterThan(tallRows);
    expect(await cueOf(pane)).toBeUndefined();
  });

  test("N18 after a tab shows the cue, a redraw that changes the words of a wrapping Text draws the tab without it", async ($, on) => {
    let words = "alpha";
    worldOf(on, { skills: 0, probe: ({ Text }) => <Text wrap="wrap">{words}</Text> });
    await startSession($);
    const pane = await mountPane($);
    await showCue($, pane);

    words = "beta";
    await settle(pane);

    expect(textsOf(await pane.drawn()), "the redraw shows the new words").toContain("beta");
    expect(await cueOf(pane)).toBeUndefined();
  });

  test("N19 after a tab shows the cue, a redraw that changes a truncating Text holding a line break draws the tab without it", async ($, on) => {
    let words = "one\ntwo";
    worldOf(on, { skills: 0, probe: ({ Text }) => <Text wrap="truncate-end">{words}</Text> });
    await startSession($);
    const pane = await mountPane($);
    await showCue($, pane);

    words = "one\nthree";
    await settle(pane);

    expect(textsOf(await pane.drawn()), "the redraw shows the new words").toContain("one\nthree");
    expect(await cueOf(pane)).toBeUndefined();
  });

  test("N20 after a tab shows the cue, a redraw that changes a Text nested in a truncating Text draws the tab without it", async ($, on) => {
    let words = "alpha";
    worldOf(on, {
      skills: 0,
      probe: ({ Text }) => (
        <Text wrap="truncate-end">
          {"count "}
          <Text>{words}</Text>
        </Text>
      ),
    });
    await startSession($);
    const pane = await mountPane($);
    await showCue($, pane);

    words = "beta";
    await settle(pane);

    expect(textsOf(await pane.drawn()), "the redraw shows the new words").toContain("beta");
    expect(await cueOf(pane)).toBeUndefined();
  });

  test("N21 after a tab shows the cue, a redraw that fills an empty truncating Text with words draws the tab without it", async ($, on) => {
    let words = "";
    worldOf(on, { skills: 0, probe: ({ Text }) => <Text wrap="truncate-end">{words}</Text> });
    await startSession($);
    const pane = await mountPane($);
    await showCue($, pane);

    words = "beta";
    await settle(pane);

    expect(textsOf(await pane.drawn()), "the redraw shows the new words").toContain("beta");
    expect(await cueOf(pane)).toBeUndefined();
  });

  test("N17 after the Skills tab shows the cue, a press that opens a description draws no cue, and the next wheel shows the new count", async ($, on) => {
    worldOf(on, { skills: LONG_SKILL_COUNT, skillDescription: () => FIRST_DESCRIPTION });
    await startSession($);
    const pane = await mountPane($);
    await showTab(pane, SKILLS_TAB);
    await showCue($, pane);
    const rowsBefore = await contentRowsOf(pane);

    await pressSkillGlyph(pane, FIRST_SKILL);

    const rowsAfter = await contentRowsOf(pane);
    expect(rowsAfter, "the press added rows").toBeGreaterThan(rowsBefore);
    expect(await cueOf(pane)).toBeUndefined();
    await checkWindow($, pane, { by: 0, contentRows: rowsAfter });
    expect((await cueOf(pane))?.text).toBe(`… ${rowsAfter - PANE_ROWS + 1} more lines`);
  });
});

const ACTIVITY_TAB = "Activity";
const CONTEXT_TAB = "Context";
const DETAILS_LABEL = "Details";
const SKILLS_LINK_LABEL = "Skills tab";
const SHORT_CALLS = 3;

function textsOf(tree: Node): string[] {
  return collect(tree, "Text").map((text) => textOf(text).trim());
}

async function pressSkillGlyph(pane: Pane, name: string): Promise<void> {
  const toggle = (await pane.findAll({ type: "Button" })).find(
    (button) => button.key === `${name}-toggle`,
  );
  expect(toggle, `a toggle for ${name}`).toBeDefined();
  await pane.press({ key: toggle?.key ?? "" });
  await settle(pane);
}

async function showCue($: Engine, pane: Pane): Promise<void> {
  await checkWindow($, pane, { by: 0, contentRows: PANE_ROWS + 10 });
  expect(await cueOf(pane), "the cue shows before the route").toBeDefined();
}

async function runPanelineCommand($: Engine): Promise<void> {
  await $.command.run({
    command: "paneline",
    args: "",
    origin: { kind: "composer" },
    presentation: { isFullscreen: false, columns: COLUMNS },
  });
}

async function feedCalls($: Engine, on: On, count: number): Promise<void> {
  on("tool.call", () => ({ result: "ok", text: "ok" }));
  for (let index = 1; index <= count; index++) {
    await $.tool.call({
      tool: "Bash",
      command: `echo ${index}`,
      tool_use_id: `c-${index}`,
    } as never);
  }
}

function mountToolGroup($: Engine) {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "ToolGroup",
    props: {
      calls: [
        {
          tool_use_id: "g1",
          tool: "Read",
          input: {},
          isRunning: false,
          isErrored: false,
          isInterrupted: false,
        },
      ],
      isActive: false,
      isExpanded: false,
    },
    viewport: { columns: COLUMNS, rows: 24 },
  });
}

async function checkWindow(
  $: Engine,
  pane: Pane,
  window: { by: number; contentRows: number },
): Promise<void> {
  await $.ui.scroll({
    component: "Pane",
    requestId: SESSION,
    offset: 0,
    by: window.by,
    bodyRows: PANE_ROWS,
    contentRows: window.contentRows,
    origin: { kind: "person" },
  });
  await settle(pane);
}

async function cueOf(
  pane: Pane,
): Promise<{ text: string; color: unknown; box: Record<string, unknown> } | undefined> {
  const tree = await pane.drawn();
  const box = collect(tree, "Box").find((candidate) => candidate.props?.position === "absolute");
  const text = box === undefined ? undefined : collect(box, "Text")[0];
  if (box === undefined || text === undefined) return undefined;
  return { text: textOf(text).trim(), color: text.props?.color, box: box.props ?? {} };
}

async function pressTabKey(pane: Pane, label: string): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  await pane.press({ key: buttons.find((button) => button.props.label === label)?.key ?? "" });
}

describe("pane scroll after a view change", () => {
  test("A1 a long Activity list scrolled down by 12 rows in a 20-row pane shows the back button on screen when a call is opened, and back shows the list at the place it was scrolled to", async ($, on) => {
    const world = worldOf(on, { skills: 0 });
    on("tool.call", () => ({ result: "ok", text: "ok" }));
    for (let index = 1; index <= ACTIVITY_CALLS; index++) {
      await $.tool.call({
        tool: "Bash",
        command: `echo ${index}`,
        tool_use_id: `c-${index}`,
      } as never);
    }
    await startSession($);
    const pane = await mountPane($, SHORT_PANE_ROWS);
    const top = await screenOf(pane, world, SHORT_PANE_ROWS);

    await scrollWhenOverflowing($, pane, LIST_SCROLL_ROWS, SHORT_PANE_ROWS);
    const scrolled = await screenOf(pane, world, SHORT_PANE_ROWS);
    expect(scrolled).not.toEqual(top);
    await pane.press({ key: `call-c-${ACTIVITY_CALLS}` });
    await settle(pane);

    expect((await screenOf(pane, world, SHORT_PANE_ROWS)).join("\n")).toContain(BACK_LABEL);
    await pressButton(pane, BACK_LABEL);
    expect(await screenOf(pane, world, SHORT_PANE_ROWS)).toEqual(scrolled);
  });

  test("K11 a Files list scrolled down by 12 rows opens a file's diff from its top, the same screen as opening that diff before scrolling", async ($, on) => {
    const world = worldOf(on, { skills: 0, files: editedFiles(CWD) });
    const content = Array.from({ length: DIFF_LINES }, (_, index) => `line ${index + 1}`).join(
      "\n",
    );
    on("process.run", () => ({ value: { exitCode: 1, stdout: "", stderr: "" } }) as never);
    on("fs.read", () => ({ value: content }));
    await startSession($);
    const pane = await mountPane($);
    await showTab(pane, FILES_TAB);
    const list = await screenOf(pane, world);
    await pressButton(pane, FILE_LABEL);
    const freshDiff = await screenOf(pane, world);
    expect(freshDiff).not.toEqual(list);
    await pressButton(pane, BACK_LABEL);

    await scrollWhenOverflowing($, pane, LIST_SCROLL_ROWS, PANE_ROWS);
    expect(await screenOf(pane, world)).not.toEqual(list);
    await pressButton(pane, FILE_LABEL);

    expect(await screenOf(pane, world)).toEqual(freshDiff);
  });

  test("K12 a Files list scrolled to its bottom, then shortened by folding a folder, scrolls back up to the top of the list, the same screen as folding that folder at the top", async ($, on) => {
    const world = worldOf(on, {
      skills: 0,
      files: [...editedFiles(`${CWD}/src`), editOf(`${CWD}/top.ts`, "top")],
    });
    await startSession($);
    const pane = await mountPane($);
    await showTab(pane, FILES_TAB);
    const foldedAtTop = await screenOf(pane, world);
    await pressButton(pane, FOLDER_CLOSED);
    await scrollWhenOverflowing($, pane, await contentRowsOf(pane), PANE_ROWS);
    expect(await screenOf(pane, world)).not.toEqual(foldedAtTop);

    await pressButton(pane, FOLDER_OPEN);
    await scrollWhenOverflowing($, pane, -(await contentRowsOf(pane)), PANE_ROWS);

    expect(await screenOf(pane, world)).toEqual(foldedAtTop);
  });
});

function editedFiles(dir: string): Activity[] {
  return Array.from({ length: LONG_FILE_COUNT }, (_, index) =>
    editOf(`${dir}/file-${String(index + 1).padStart(2, "0")}.ts`, `${dir}-${index}`),
  );
}

function editOf(target: string, id: string): Activity {
  return { id, tool: "Edit", target, ms: 1, isErrored: false, added: 1, removed: 0 };
}

async function scrollWhenOverflowing(
  $: Engine,
  pane: Pane,
  by: number,
  rows: number,
): Promise<void> {
  const contentRows = await contentRowsOf(pane);
  if (contentRows > rows) {
    await $.ui.scroll({
      component: "Pane",
      requestId: SESSION,
      offset: 0,
      by,
      bodyRows: rows,
      contentRows,
      origin: { kind: "person" },
    });
  }
  await settle(pane);
}

async function pressButton(pane: Pane, label: string): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const target = buttons.find((button) => button.props.label === label);
  expect(target, `a button labelled ${label}`).toBeDefined();
  await pane.press({ key: target?.key ?? "" });
  await settle(pane);
}

describe("pane scroll with a diagram", () => {
  test("K13 a Files list scrolled down by 12 rows opens a chat diagram from its top, the same screen as opening that diagram before scrolling", async ($, on) => {
    const world = worldOf(on, { skills: 0, files: longFiles() });
    const reply = await mountReply($, mermaid(DIAGRAM_SOURCE), DIAGRAM_COLUMNS);
    await startSession($);
    const pane = await mountPane($);
    await showTab(pane, FILES_TAB);
    const list = await screenOf(pane, world);
    await pressOpen(reply);
    const freshDiagram = await screenOf(pane, world);
    expect(freshDiagram).not.toEqual(list);
    await pressButton(pane, BACK_LABEL);

    await scrollWhenOverflowing($, pane, LIST_SCROLL_ROWS, PANE_ROWS);
    expect(await screenOf(pane, world)).not.toEqual(list);
    await pressOpen(reply);

    expect(await screenOf(pane, world)).toEqual(freshDiagram);
  });
});

const DIAGRAM_SOURCE = ["flowchart LR", "  G[grilling] --> S[spec.md]", "  S --> P[plan]"].join(
  "\n",
);
const DIAGRAM_COLUMNS = 220;
const FENCE = "```";

function mermaid(source: string): string {
  return [`${FENCE}mermaid`, source, FENCE].join("\n");
}

function mountReply($: Engine, text: string, columns: number) {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "AssistantMessage",
    props: { text, isFirstOfReply: true },
    viewport: { columns, rows: 24 },
  });
}

async function pressOpen(reply: Awaited<ReturnType<typeof mountReply>>): Promise<void> {
  const buttons = await reply.findAll({ type: "Button" });
  const open = buttons.find((button) => button.props.label === "Open");
  expect(open, "an Open button on the diagram").toBeDefined();
  await reply.press({ key: open?.key ?? "" });
}
