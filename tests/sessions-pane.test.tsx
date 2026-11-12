import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";

import { palette } from "../hooks/palette";
import { screenRows } from "./band-screen";
import type { SessionRow } from "../types";
import { childrenOf, collect, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import {
  COLUMNS,
  DOT_GLYPHS,
  HOME,
  IDLE_DOT,
  OWN_PID,
  OWN_SESSION,
  REGISTRY_DIR,
  RUNNING_DOT,
  SESSIONS_DIR,
  WAITING_DOT,
  WORK,
  begin,
  colorsOf,
  enterSessions,
  mountPane,
  putRegistry,
  rowTexts,
  sessionRows,
  sessionsPane,
  showSessions,
} from "./sessions-world";
import type { Pane, World } from "./sessions-world";

const NARROW_COLUMNS = 55;
const SHARE_COLUMNS = 53;
const WIDE_COLUMNS = 160;
const CTX_CELLS = 3;
const COST_CELLS = 5;
const MIN_KEPT_CHARS = 3;
const TAB_LABELS = [
  "Activity",
  "Files",
  "Agents",
  "Plan",
  "Context",
  "MCP",
  "Skills",
  "Spend",
  "Setup",
  "Sessions",
];
const PREVIOUS_PAGE_ARROW = "‹";
const SYNC_GAP_MS = 1000;
const POLL_GAP_MS = 2000;
const BURST_CHANGES = 5;
const EMPTY_TEXT = "no running sessions";
const ALPHA_FOLDER = "alpha";
const LONG_FOLDER_NAME = "battle_game-night-scorched-neighbours-engine-tests";
const INVEST_PID = 500;
const INVEST_CWD = `${HOME}/webWork/invest`;
const INVEST_FOLDER = "invest";

const own: SessionRow = {
  pid: OWN_PID,
  sessionId: OWN_SESSION,
  state: "idle",
  cwd: `${HOME}/code/alpha`,
  branch: "main",
  ctx: 12,
  usd: 1.5,
};
const waiting: SessionRow = {
  pid: 200,
  sessionId: "session-two",
  state: "waiting",
  cwd: "/srv/beta",
  branch: "feature/x",
  ctx: null,
  usd: null,
};
const running: SessionRow = {
  pid: 300,
  sessionId: "session-three",
  state: "running",
  cwd: HOME,
  branch: "",
  ctx: 100,
  usd: 12.345,
};

const spare: SessionRow = {
  pid: 600,
  sessionId: "session-spare",
  state: "idle",
  cwd: `${HOME}/spare`,
  branch: "main",
  ctx: 17,
  usd: null,
};

const longFolder: SessionRow = {
  pid: 400,
  sessionId: "session-four",
  state: "running",
  cwd: `${HOME}/projects/IT/battle_game-night-scorched-neighbours-engine-tests`,
  branch: "feature/scorched-neighbours",
  ctx: 40,
  usd: 3,
};

describe("sessions tab", () => {
  test("S1 the tab bar lists Sessions last, after Setup and the tab opens with a summary row", async ($, on) => {
    await begin($, on, [own]);
    const pane = await mountPane($, WIDE_COLUMNS);

    const labels = (await pane.findAll({ type: "Button" }))
      .map((button) => String(button.props.label))
      .filter((label) => TAB_LABELS.includes(label));
    expect(labels.at(-1)).toBe("Sessions");
    expect(labels.at(-2)).toBe("Setup");

    await showSessions(pane);

    expect(await rowTexts(pane)).toContain("1 session");
  });

  test("S2 with no sessions the tab says no running sessions in a muted line", async ($, on) => {
    await begin($, on, []);
    const pane = await sessionsPane($);

    expect(await rowTexts(pane)).toContain(EMPTY_TEXT);
    expect(await colorsOf(pane, EMPTY_TEXT)).toEqual([palette.muted]);
  });

  test("S3 three sessions show dot, state word, folder, branch, context and cost, the waiting one first and the rest by folder", async ($, on) => {
    await begin($, on, [own, running, waiting]);
    const pane = await sessionsPane($);

    const rows = await sessionRows(pane);
    const ownLine = await screenLineOf(pane, 80, "alpha");

    expect(await rowTexts(pane)).toContain("3 sessions · 1 waiting · 1 thinking");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatch(/^! waiting\s+beta\s+feature\/x$/u);
    expect(rows[1]).toMatch(/^● thinking\s+~\s+100%!\s\$12\.35$/u);
    expect(ownLine).toMatch(/^\s*○ idle\s+alpha this\s+main\s+12%\s+\$1\.50$/u);
  });

  test("S4 each state has its own dot glyph and colour", async ($, on) => {
    await begin($, on, [own, running, waiting]);
    const pane = await sessionsPane($);

    const dots = collect(await pane.drawn(), "Text").filter((text) =>
      DOT_GLYPHS.includes(textOf(text)),
    );

    expect(dots.map((dot) => [textOf(dot), dot.props?.color])).toEqual([
      [WAITING_DOT, palette.alert],
      [RUNNING_DOT, palette.tool],
      [IDLE_DOT, palette.muted],
    ]);
  });

  test("S5 the current session folder is drawn plain like every other row", async ($, on) => {
    await begin($, on, [own, waiting]);
    const pane = await sessionsPane($);

    const weights = async (text: string): Promise<unknown[]> =>
      (await pane.findAll({ type: "Text", text })).map((one) => one.props.weight);

    expect(new Set(await weights(ALPHA_FOLDER))).toEqual(new Set([undefined]));
    expect(new Set(await weights("beta"))).toEqual(new Set([undefined]));
  });

  test("S17 the waiting count in the summary row is alert", async ($, on) => {
    await begin($, on, [own, waiting]);
    const pane = await sessionsPane($);

    const texts = collect(await pane.drawn(), "Text");

    expect(
      texts.filter((text) => textOf(text) === "1 waiting").map((text) => text.props?.color),
    ).toEqual([palette.alert]);
  });

  test("S6 null context and cost draw empty cells, not dashes", async ($, on) => {
    await begin($, on, [waiting]);
    const pane = await sessionsPane($);

    const [row] = await sessionRows(pane);

    expect(row).toMatch(/^! waiting\s+beta\s+feature\/x$/u);
    expect(await colorsOf(pane, "-")).toEqual([]);
  });

  test("S7 the folder column shows the last path segment and the home folder shows a tilde", async ($, on) => {
    const deep = { ...waiting, cwd: "/very/long/path/to/some/deeply/nested/project/folder" };
    await begin($, on, [deep, running]);
    const pane = await sessionsPane($);

    const rows = await sessionRows(pane);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/^! waiting\s+folder\s/u);
    expect(rows[1]).toMatch(/^● thinking\s+~\s/u);
  });

  test("S18 at 53 columns two folders that share a prefix take the longest name's width and keep their own tails", async ($, on) => {
    const tab = { ...running, pid: 500, cwd: `${WORK}/demo-app-GH-86-tab`, branch: "a" };
    const visual = { ...running, pid: 501, cwd: `${WORK}/demo-app-GH-86-visual`, branch: "b" };
    await begin($, on, [tab, visual]);
    const pane = await sessionsPane($, SHARE_COLUMNS);

    const rows = await sessionRows(pane);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("demo-app-GH-86-tab");
    expect(rows[1]).toContain("demo-app-GH-86-visual");
    expect(rows[0]?.search(/ {2}a\b/u)).toBe(rows[1]?.search(/ {2}b\b/u));
  });

  test("S15 the own row draws the context of the usage store while its file holds none, other rows keep their file value", async ($, on) => {
    await begin($, on, [{ ...own, ctx: null }, running], 17);
    const pane = await sessionsPane($, WIDE_COLUMNS);

    const rows = await sessionRows(pane);

    expect(rows.find((row) => row.includes("alpha"))).toMatch(/\s17%\s/u);
    expect(rows.find((row) => row.includes("~ "))).toMatch(/\s100%!\s/u);
  });

  test("S9 at 55 columns a long folder never pushes the dot out: the dot cell is fixed and starts every row", async ($, on) => {
    await begin($, on, [longFolder, own]);
    const pane = await sessionsPane($, NARROW_COLUMNS);

    const dotBoxes = (await rowBoxes(pane)).map((row) => childrenOf(row)[0]);

    expect(await sessionRows(pane)).toHaveLength(2);
    expect(dotBoxes.map((box) => box?.props?.flexShrink)).toEqual([0, 0]);
    expect(dotBoxes.map((box) => box?.props?.width)).toEqual([1, 1]);
  });

  test("S10 every row gives the folder the same fixed width so the branches start at one cell", async ($, on) => {
    await begin($, on, [own, waiting, running]);
    const pane = await sessionsPane($, WIDE_COLUMNS);

    const widths = (await rowBoxes(pane)).map(
      (row, at) => boxHolding(row, ["beta", "~", ALPHA_FOLDER][at] ?? "").props?.width,
    );

    expect(widths[0]).toBeGreaterThanOrEqual(ALPHA_FOLDER.length);
    expect(widths).toEqual([widths[0], widths[0], widths[0]]);
  });

  test("S14 at 55 columns the long folder shows its own name, not a path tail", async ($, on) => {
    await begin($, on, [longFolder]);
    const pane = await sessionsPane($, NARROW_COLUMNS);

    const [row] = await sessionRows(pane);

    expect(row).toContain(LONG_FOLDER_NAME.slice(0, 10));
    expect(row).not.toContain("projects");
  });

  test("S11 at 55 columns a folder and a branch both too long for the row are cut at their end with an ellipsis and keep their start", async ($, on) => {
    await begin($, on, [longFolder]);
    const pane = await sessionsPane($, NARROW_COLUMNS);

    const row = await screenLineOf(pane, NARROW_COLUMNS, "battle_game");

    const folder = / (battle_game[\w-]*)… /u.exec(row)?.[1] ?? "";
    const branch = / (feat[\w/-]*)…( |$)/u.exec(row)?.[1] ?? "";
    expect(LONG_FOLDER_NAME.startsWith(folder)).toBe(true);
    expect(folder.length).toBeGreaterThan(MIN_KEPT_CHARS);
    expect(longFolder.branch.startsWith(branch)).toBe(true);
    expect(branch.length).toBeGreaterThan(MIN_KEPT_CHARS);
    expect(row.length).toBeLessThanOrEqual(NARROW_COLUMNS);
  });

  test("S16 at 53 columns the same row is cut at the end of its folder and branch and fits", async ($, on) => {
    await begin($, on, [longFolder]);
    const pane = await sessionsPane($, SHARE_COLUMNS);

    const row = await screenLineOf(pane, SHARE_COLUMNS, "battle_game");

    expect(row).toMatch(/ battle_game[\w-]*… /u);
    expect(row).toMatch(/ feat[\w/-]*…/u);
    expect(row.length).toBeLessThanOrEqual(SHARE_COLUMNS);
  });

  test("S13 the context and cost columns are fixed cells inside the row width", async ($, on) => {
    await begin($, on, [own]);
    const pane = await sessionsPane($, WIDE_COLUMNS);

    const [row] = await rowBoxes(pane);
    const cells = childrenOf(row ?? { type: "Box" }).map((box) => box.props?.width);

    expect(row?.props?.width).toBe(WIDE_COLUMNS - 1);
    expect(cells.slice(-2)).toEqual([CTX_CELLS, COST_CELLS]);
  });

  test("S8 entering the tab removes the row of a dead process and its file", async ($, on) => {
    const world = await begin($, on, [own, waiting]);
    world.alive.delete(waiting.pid);
    const pane = await sessionsPane($);
    await world.settle();
    await pane.redraw();

    expect(await sessionRows(pane)).toHaveLength(1);
    expect(world.removed).toEqual([`${SESSIONS_DIR}/${waiting.pid}.json`]);
  });

  test("S22 entering the tab lists a live session of another project that wrote no file", async ($, on) => {
    const world = await begin($, on, [own]);
    putRegistry(world, 500, { cwd: `${HOME}/webWork/invest` });

    const pane = await enterSessions($, world);

    expect(await sessionRows(pane)).toContainEqual(expect.stringContaining("invest"));
  });

  test("S23 a background spare session is not listed and its file is removed", async ($, on) => {
    const world = await begin($, on, [own, spare]);
    putRegistry(world, spare.pid, { kind: "bg" });

    const pane = await enterSessions($, world);

    expect(await sessionRows(pane)).toHaveLength(1);
    expect(world.removed).toEqual([`${SESSIONS_DIR}/${spare.pid}.json`]);
  });

  test("S24 a registry file that cannot be parsed keeps the row and the file of a live session", async ($, on) => {
    const world = await begin($, on, [own, waiting]);
    world.files.set(`${REGISTRY_DIR}/${waiting.pid}.json`, "{half");

    const pane = await enterSessions($, world);

    expect(await sessionRows(pane)).toHaveLength(2);
    expect(world.removed).toEqual([]);
  });

  test("S25 a live session with no registry file yet keeps its row and its file", async ($, on) => {
    const world = await begin($, on, [own, waiting]);
    world.files.delete(`${REGISTRY_DIR}/${waiting.pid}.json`);

    const pane = await enterSessions($, world);

    expect(await sessionRows(pane)).toHaveLength(2);
    expect(world.removed).toEqual([]);
  });

  test("S26 the own row keeps its hook-written session id and cost while the registry holds the old session id", async ($, on) => {
    const world = await begin($, on, [own]);
    putRegistry(world, own.pid, { sessionId: "session-before-clear" });

    const pane = await enterSessions($, world);

    expect(await sessionRows(pane)).toContainEqual(expect.stringContaining("$1.50"));
  });

  test("S27 the own row shows running when the registry says busy while the hook-written state is still idle", async ($, on) => {
    const world = await begin($, on, [own]);
    putRegistry(world, own.pid, { status: "busy" });

    const pane = await enterSessions($, world);

    const alpha = (await sessionRows(pane)).find((text) => text.includes(ALPHA_FOLDER));
    expect(alpha?.startsWith("●")).toBe(true);
  });

  test("S28 with the tab open and no file event, a new session shows within the poll gap and a key file is ignored", async ($, on) => {
    const world = await begin($, on, [own]);
    const pane = await enterSessions($, world);

    putRegistry(world, 981, { cwd: `${HOME}/webWork/invest` });
    world.files.set(`${REGISTRY_DIR}/981.abcdef.key`, "secret-not-json");
    await world.advance(POLL_GAP_MS + SYNC_GAP_MS);
    await pane.redraw();

    const rows = await sessionRows(pane);
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual(expect.stringContaining("invest"));
  });

  test("S29 with the tab open and no file event, a busy flip shows within the poll gap", async ($, on) => {
    const world = await begin($, on, [own]);
    putRegistry(world, 500, { cwd: `${HOME}/webWork/invest` });
    const pane = await enterSessions($, world);

    putRegistry(world, 500, { status: "busy" });
    await world.advance(POLL_GAP_MS + SYNC_GAP_MS);
    await pane.redraw();

    const invest = (await sessionRows(pane)).find((text) => text.includes("invest"));
    expect(invest?.startsWith("●")).toBe(true);
  });

  test("S30 the polling stops when the Sessions tab is left", async ($, on) => {
    const world = await begin($, on, [own, waiting]);
    const pane = await enterSessions($, world);
    await leaveSessions(pane);
    await world.advance(POLL_GAP_MS);
    world.psCalls = 0;

    await world.advance(POLL_GAP_MS * 5);

    expect(world.psCalls).toBe(0);
  });

  test("S19 a registry change with the Sessions tab closed runs no ps", async ($, on) => {
    const world = await begin($, on, [own, waiting]);
    await mountPane($, COLUMNS);
    world.psCalls = 0;

    await registryChanged($, world, waiting, "busy");
    await world.advance(SYNC_GAP_MS * 2);

    expect(world.psCalls).toBe(0);
  });

  test("S20 a registry change with the Sessions tab open updates the row after the sync gap", async ($, on) => {
    const world = await begin($, on, [own]);
    putRegistry(world, 500, { cwd: `${HOME}/webWork/invest` });
    const pane = await enterSessions($, world);
    await world.advance(SYNC_GAP_MS * 2);

    putRegistry(world, 500, { status: "busy" });
    await $.classic.FileChanged({ file_path: `${REGISTRY_DIR}/500.json`, event: "change" });
    await world.advance(SYNC_GAP_MS * 2);
    await pane.redraw();

    const invest = (await sessionRows(pane)).find((text) => text.includes("invest"));
    expect(invest?.startsWith("●")).toBe(true);
  });

  test("S21 a burst of registry changes with the tab open runs one sync", async ($, on) => {
    const world = await begin($, on, [own, waiting]);
    await sessionsPane($);
    await world.advance(SYNC_GAP_MS * 2);
    world.psCalls = 0;

    for (let change = 0; change < BURST_CHANGES; change += 1)
      await registryChanged($, world, own, "busy");
    await world.advance(SYNC_GAP_MS + SYNC_GAP_MS / 2);

    expect(world.psCalls).toBe(1);
  });

  test("S31 after the person denies a permission dialog the own row leaves waiting while the turn still runs", async ($, on) => {
    on("classic.PermissionRequest", () => ({ decision: { behavior: "deny" } }));
    on("turn.start", (_$, e) => ({ turnId: e.turnId }));
    on("classic.Notification", () => ({}));
    const world = await begin($, on, [own]);
    putRegistry(world, own.pid, { status: "busy" });
    const pane = await enterSessions($, world);
    await $.turn.start({ text: "go", turnId: "t1" });
    await $.classic.Notification({
      hook_event_name: "Notification",
      notification_type: "permission_prompt",
      message: "Claude needs your permission to use Bash",
      session_id: OWN_SESSION,
    } as never);
    await pane.redraw();
    expect(await rowTexts(pane)).toContain("1 session · 1 waiting");

    await $.classic.PermissionRequest({
      hook_event_name: "PermissionRequest",
      tool_name: "Bash",
      tool_input: { command: "touch build/out" },
      session_id: OWN_SESSION,
    } as never);
    await pane.redraw();

    expect(await rowTexts(pane)).not.toContain("1 session · 1 waiting");
    const alpha = (await sessionRows(pane)).find((text) => text.includes(ALPHA_FOLDER));
    expect(alpha?.startsWith("●")).toBe(true);
    expect(await colorsOf(pane, "●")).not.toContain(palette.alert);
  });

  test("S32 another session stopped at a permission dialog shows its row waiting and the summary counts it", async ($, on) => {
    const world = await begin($, on, [own]);
    putRegistry(world, INVEST_PID, { cwd: INVEST_CWD, status: "waiting" });

    const pane = await enterSessions($, world);

    expect(await dotOf(pane, INVEST_FOLDER)).toEqual({ glyph: WAITING_DOT, color: palette.alert });
    expect(await rowTexts(pane)).toContain("2 sessions · 1 waiting");
  });

  test("S33 once that session is busy again its row shows running and the summary has no waiting count", async ($, on) => {
    const world = await begin($, on, [own]);
    putRegistry(world, INVEST_PID, { cwd: INVEST_CWD, status: "waiting" });
    const pane = await enterSessions($, world);
    expect(await dotOf(pane, INVEST_FOLDER)).toEqual({ glyph: WAITING_DOT, color: palette.alert });

    putRegistry(world, INVEST_PID, { status: "busy" });
    await $.classic.FileChanged({
      file_path: `${REGISTRY_DIR}/${INVEST_PID}.json`,
      event: "change",
    });
    await world.advance(SYNC_GAP_MS * 2);
    await pane.redraw();

    expect(await dotOf(pane, INVEST_FOLDER)).toEqual({ glyph: RUNNING_DOT, color: palette.tool });
    expect(await rowTexts(pane)).toContain("2 sessions · 1 thinking");
  });

  test("S34 once that session goes idle its row shows the idle dot and the summary has no waiting count", async ($, on) => {
    const world = await begin($, on, [own]);
    putRegistry(world, INVEST_PID, { cwd: INVEST_CWD, status: "waiting" });
    const pane = await enterSessions($, world);
    expect(await dotOf(pane, INVEST_FOLDER)).toEqual({ glyph: WAITING_DOT, color: palette.alert });
    putRegistry(world, INVEST_PID, { status: "busy" });
    await $.classic.FileChanged({
      file_path: `${REGISTRY_DIR}/${INVEST_PID}.json`,
      event: "change",
    });
    await world.advance(SYNC_GAP_MS * 2);

    putRegistry(world, INVEST_PID, { status: "idle" });
    await $.classic.FileChanged({
      file_path: `${REGISTRY_DIR}/${INVEST_PID}.json`,
      event: "change",
    });
    await world.advance(SYNC_GAP_MS * 2);
    await pane.redraw();

    expect(await dotOf(pane, INVEST_FOLDER)).toEqual({ glyph: IDLE_DOT, color: palette.muted });
    expect(await rowTexts(pane)).toContain("2 sessions");
  });

  test("S35 the own session stopped at a permission dialog shows its own row waiting and the summary counts it", async ($, on) => {
    const world = await begin($, on, [own]);
    putRegistry(world, own.pid, { status: "waiting" });

    const pane = await enterSessions($, world);

    expect(await dotOf(pane, ALPHA_FOLDER)).toEqual({ glyph: WAITING_DOT, color: palette.alert });
    expect(await rowTexts(pane)).toContain("1 session · 1 waiting");
  });

  test("S36 the own row that showed waiting at a permission dialog shows running once the person denies it and the summary drops the waiting count", async ($, on) => {
    on("classic.Notification", () => ({}));
    const world = await begin($, on, [own]);
    putRegistry(world, own.pid, { status: "waiting" });
    const pane = await enterSessions($, world);

    await $.classic.Notification({
      hook_event_name: "Notification",
      notification_type: "permission_prompt",
      message: "Claude needs your permission to use Bash",
      session_id: OWN_SESSION,
    } as never);
    await pane.redraw();
    expect(await dotOf(pane, ALPHA_FOLDER)).toEqual({ glyph: WAITING_DOT, color: palette.alert });

    putRegistry(world, own.pid, { status: "busy" });
    await $.classic.FileChanged({
      file_path: `${REGISTRY_DIR}/${own.pid}.json`,
      event: "change",
    });
    await world.advance(SYNC_GAP_MS * 2);
    await pane.redraw();

    expect(await dotOf(pane, ALPHA_FOLDER)).toEqual({ glyph: RUNNING_DOT, color: palette.tool });
    expect(await rowTexts(pane)).toContain("1 session · 1 thinking");
  });
});

async function leaveSessions(pane: Pane): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const back = buttons.find((button) => String(button.props.label).includes(PREVIOUS_PAGE_ARROW));
  expect(back, "a previous-page arrow beside the Sessions tab").toBeDefined();
  await pane.press({ key: back?.key ?? "" });
  await pane.redraw();
}

async function registryChanged(
  $: Engine,
  world: World,
  row: SessionRow,
  status: string,
): Promise<void> {
  const path = `${REGISTRY_DIR}/${row.pid}.json`;
  world.files.set(path, JSON.stringify({ ...JSON.parse(world.files.get(path) ?? "{}"), status }));
  await $.classic.FileChanged({ file_path: path, event: "change" });
}

async function rowBoxes(pane: Pane): Promise<Node[]> {
  return collect(await pane.drawn(), "Box").filter(
    (box) =>
      box.props?.height === 1 &&
      box.props.flexDirection === "row" &&
      collect(box, "Text").some((text) => DOT_GLYPHS.includes(textOf(text))),
  );
}

function boxHolding(row: Node, text: string): Node {
  return (
    childrenOf(row).find((box) => collect(box, "Text").some((one) => textOf(one) === text)) ?? {
      type: "Box",
    }
  );
}

async function dotOf(
  pane: Pane,
  folder: string,
): Promise<{ glyph: string; color: unknown } | undefined> {
  const row = (await rowBoxes(pane)).find((box) =>
    collect(box, "Text").some((text) => textOf(text) === folder),
  );
  const dot = collect(row ?? { type: "Box" }, "Text").find((text) =>
    DOT_GLYPHS.includes(textOf(text)),
  );
  return dot === undefined ? undefined : { glyph: textOf(dot), color: dot.props?.color };
}

async function screenLineOf(pane: Pane, columns: number, word: string): Promise<string> {
  const lines = screenRows(await pane.drawn(), columns).map((line) => line.trimEnd());
  return lines.find((line) => line.includes(word)) ?? "";
}
