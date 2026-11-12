import { describe, expect, mock, test } from "claude-code/testing";
import type { On, PermissionRequestDecision, ToolCheckResult } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { allowReason, permissionOf } from "../hooks/activity-track";
import { palette } from "../hooks/palette";
import { inkFor } from "../hooks/pane-ink";

type Pane = Mounted<"terminal", "Pane">;
type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] };
type Line = { text: string; texts: Node[] };
type Scripted = { verdict: ToolCheckResult; answer?: PermissionRequestDecision };
type PermissionCall = Parameters<typeof permissionOf>[0];

const WIDE_COLUMNS = 100;
const SIXTY_COLUMNS = 60;
const PANEL_INDENT = 2;
const NARROW_COLUMNS = 40;
const SHOWN_ROWS = 8;
const EXTRA_CALLS = 10;
const DENY_RULE = "Bash(curl:*)";
const ALLOW_RULE = "Bash(ls:*)";
const READ_ONLY_REASON = "read-only tool";
const REFUSAL = "User declined this call\nsecond line of the refusal";
const HEADING_ROW = 1;
const NEXT_HEADING = "Tool mix";
const ALLOWED_RUNS = 6;
const FOLD_PATTERN = /^[▸▾] \d+ auto-allowed$/u;
const CLOCK_PREFIX = "(?:\\d\\d:\\d\\d\\s*)?";
const STATUS_ROW = new RegExp(`^${CLOCK_PREFIX}[✓✗⊘]`, "u");
const DENIED_ROW = new RegExp(`^${CLOCK_PREFIX}⊘`, "u");
const ALLOWED_ROW = new RegExp(`^${CLOCK_PREFIX}✓`, "u");
const CLOCK_CELL = /^\d\d:\d\d$/u;
const CLASSIFIER_REASON = "classifier: looks destructive";
const PERSON_DENIAL = "denied by you";
const GUARD_ON = { options: { guard: true } };
const MODE_LABEL = "allowed by mode or tool check";
const READ_ONLY_LABEL = "read-only tool";
const LONG_DENY_RULE = "Bash(a-very-long-denied-command-prefix-that-the-row-cannot-show-whole:*)";
const HELD_YES = "rm -r held-yes";
const HELD_NO = "rm -r held-no";
const AUTO_MODE_REASON = "auto mode classifier";

const SCRIPTS: Record<string, Scripted> = {
  "curl x": { verdict: { decision: "deny", rule: DENY_RULE } },
  "ls y": { verdict: { decision: "allow", rule: ALLOW_RULE } },
  "cat z": { verdict: { decision: "allow", reason: READ_ONLY_REASON } },
  "asked no": { verdict: { decision: "ask" }, answer: { behavior: "deny", message: REFUSAL } },
  "hook refused": { verdict: { decision: "ask" }, answer: { behavior: "allow" } },
  classified: { verdict: { decision: "ask" } },
  "asked yes fails": { verdict: { decision: "ask" }, answer: { behavior: "allow" } },
  "asked yes": { verdict: { decision: "ask" }, answer: { behavior: "allow" } },
  "mode z": { verdict: { decision: "allow" } },
  "long denied rule": { verdict: { decision: "deny", rule: LONG_DENY_RULE } },
  [HELD_YES]: { verdict: { decision: "ask", hook: "PreToolUse" }, answer: { behavior: "allow" } },
  [HELD_NO]: {
    verdict: { decision: "ask", hook: "PreToolUse" },
    answer: { behavior: "deny", message: REFUSAL },
  },
};

describe("Permission log", () => {
  test("PL1 a rule-denied call shows a denied row with its rule", async ($, on) => {
    worldOf($, on);
    await run($, "curl x");

    const rows = await permissionRows(await mountPane($, WIDE_COLUMNS));

    expect(rows.map((row) => row.text)).toEqual([expect.stringContaining(DENY_RULE)]);
    expect(rows[0]?.texts.find((text) => ownText(text) === "⊘")?.props?.color).toBe(palette.alert);
  });

  test("PL2 a rule-allowed call shows a done row with its rule", async ($, on) => {
    worldOf($, on);
    await run($, "ls y");

    const pane = await mountPane($, WIDE_COLUMNS);
    await toggleAllowed(pane);

    const rows = await permissionRows(pane);

    expect(rows.map((row) => row.text)).toEqual([expect.stringContaining(ALLOW_RULE)]);
    expect(rows[0]?.texts.find((text) => ownText(text) === "✓")?.props?.color).toBe(palette.ok);
  });

  test("PL3 an allow with no rule shows the verdict reason", async ($, on) => {
    worldOf($, on);
    await run($, "cat z");

    const pane = await mountPane($, WIDE_COLUMNS);
    await toggleAllowed(pane);

    const rows = await permissionRows(pane);

    expect(rows.map((row) => row.text)).toEqual([expect.stringContaining(READ_ONLY_REASON)]);
  });

  test("PL4 a call refused by a tool.call hook shows the first line of its refusal", async ($, on) => {
    worldOf($, on);
    await run($, "hook refused");

    const rows = await permissionRows(await mountPane($, WIDE_COLUMNS));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).toContain("User declined this call");
    expect(rows[0]?.text).not.toContain("second line");
  });

  test("PL5 an ask that ran shows no permission row and no block", async ($, on) => {
    worldOf($, on);
    await run($, "asked yes");

    const lines = await bodyLines(await mountPane($, WIDE_COLUMNS));

    expect(lines.some((line) => line.text.startsWith("Permissions"))).toBe(false);
  });

  test("PL10 a call the classifier denied shows a denied row with its reason", async ($, on) => {
    worldOf($, on);
    await run($, "classified");

    const rows = await permissionRows(await mountPane($, WIDE_COLUMNS));

    expect(rows.map((row) => row.text)).toEqual([expect.stringContaining(CLASSIFIER_REASON)]);
    expect(rows[0]?.texts.find((text) => ownText(text) === "⊘")?.props?.color).toBe(palette.alert);
  });

  test("PL11 a call the person answered no shows a failed row saying so", async ($, on) => {
    worldOf($, on);
    await run($, "asked no");

    const rows = await permissionRows(await mountPane($, WIDE_COLUMNS));

    expect(rows.map((row) => row.text)).toEqual([expect.stringContaining(PERSON_DENIAL)]);
  });

  test("PL12 a tool that ran and failed after a yes shows no permission row", async ($, on) => {
    worldOf($, on);
    await run($, "asked yes fails");

    const lines = await bodyLines(await mountPane($, WIDE_COLUMNS));

    expect(lines.some((line) => line.text.startsWith("Permissions"))).toBe(false);
    expect(lines.some((line) => line.text.includes("asked yes fails"))).toBe(true);
  });

  test("PL6 the fold row counts the auto-allowed calls and no summary line repeats the counts", async ($, on) => {
    worldOf($, on);
    for (const command of ["curl x", "ls y", "cat z", "asked yes"]) await run($, command);
    const pane = await mountPane($, WIDE_COLUMNS);

    const lines = await bodyLines(pane);

    expect(lines.map((line) => line.text)).not.toContain("1 denied · 2 auto-allowed");
    expect(await foldLabels(pane)).toEqual(["▸ 2 auto-allowed"]);
  });

  test("PL7 only the newest eight permission rows are listed", async ($, on) => {
    worldOf($, on);
    for (let i = 0; i < SHOWN_ROWS + EXTRA_CALLS; i++) await run($, "ls y");
    const pane = await mountPane($, WIDE_COLUMNS);
    await toggleAllowed(pane);

    const rows = await permissionRows(pane);

    expect(rows).toHaveLength(SHOWN_ROWS);
  });

  test("PL8 a long reason keeps the row on one line at a narrow pane", async ($, on) => {
    worldOf($, on);
    await run($, "ls y");
    const pane = await mountPane($, NARROW_COLUMNS);
    await toggleAllowed(pane);

    const rows = await permissionRows(pane);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.text).not.toContain("\n");
  });

  test("PL9 pressing a permission row opens the call details", async ($, on) => {
    worldOf($, on);
    await run($, "ls y");
    const pane = await mountPane($, WIDE_COLUMNS);
    await toggleAllowed(pane);

    await pane.press({ key: "permission-perm-0" });

    const lines = (await bodyLines(pane)).map((line) => line.text);
    expect(lines.some((text) => text.startsWith("Permissions"))).toBe(false);
    expect(lines.some((text) => text.includes("ls y"))).toBe(true);
  });

  test(
    "PL13 a held command the person allowed shows no permission row",
    GUARD_ON,
    async ($, on) => {
      worldOf($, on);
      await run($, HELD_YES);

      const lines = await bodyLines(await mountPane($, WIDE_COLUMNS));

      expect(lines.some((line) => line.text.startsWith("Permissions"))).toBe(false);
      expect(lines.some((line) => line.text.includes(HELD_YES))).toBe(true);
    },
  );

  test("PL14 a held command the person refused shows denied by you", GUARD_ON, async ($, on) => {
    worldOf($, on);
    await run($, HELD_NO);

    const rows = await permissionRows(await mountPane($, WIDE_COLUMNS));

    expect(rows.map((row) => row.text)).toEqual([expect.stringContaining(PERSON_DENIAL)]);
    expect(rows[0]?.texts.find((text) => ownText(text) === "⊘")?.props?.color).toBe(palette.alert);
  });

  test("PL15 an allow from a mode or a tool check still names a reason", async ($, on) => {
    worldOf($, on);
    await run($, "mode z");
    const pane = await mountPane($, WIDE_COLUMNS);
    await toggleAllowed(pane);

    const rows = await permissionRows(pane);

    expect(rows.map((row) => row.text)).toEqual([expect.stringContaining(MODE_LABEL)]);
  });

  test("PL16 an allow with no rule says read-only for a read-only tool", () => {
    expect(allowReason({ decision: "allow" }, true)).toBe(READ_ONLY_LABEL);
    expect(allowReason({ decision: "allow" }, false)).toBe(MODE_LABEL);
    expect(allowReason({ decision: "allow", rule: ALLOW_RULE }, true)).toBe(ALLOW_RULE);
  });

  test("PL25 an ask cleared without a permission request shows an auto-allowed row with reason auto mode classifier", () => {
    expect(permissionOf(ranAskedCall({}))).toEqual({
      kind: "auto-allowed",
      reason: AUTO_MODE_REASON,
    });
  });

  test("PL26 an ask the person answered yes shows no auto-allowed row", () => {
    expect(permissionOf(ranAskedCall({ dialogOpened: true }))).toBeUndefined();
  });

  test("PL27 a call with no tool check verdict shows no permission row", () => {
    expect(permissionOf(ranAskedCall({ verdict: undefined }))).toBeUndefined();
  });

  test("PL28 a call the tool check denied still shows a denied row with its rule", () => {
    const denied = ranAskedCall({
      verdict: { decision: "deny", rule: DENY_RULE },
      hasRun: false,
      wasAsked: false,
      ran: { deny: REFUSAL },
    });

    expect(permissionOf(denied)).toEqual({ kind: "denied", reason: DENY_RULE });
  });

  test("PL17 the call details of a denied call show its whole rule on one line", async ($, on) => {
    worldOf($, on);
    await run($, "long denied rule");
    await run($, "ls y");
    const pane = await mountPane($, WIDE_COLUMNS);

    await pane.press({ key: "permission-perm-0" });

    const lines = (await bodyLines(pane)).map((line) => line.text);
    expect(lines).toContain(`denied · ${LONG_DENY_RULE}`);

    await pane.press({ key: "back" });
    await toggleAllowed(pane);
    await pane.press({ key: "permission-perm-1" });

    const allowedLines = (await bodyLines(pane)).map((line) => line.text);
    expect(allowedLines.some((text) => text.includes("ls y"))).toBe(true);
    expect(allowedLines.some((text) => text.startsWith("auto-allowed"))).toBe(false);
  });

  test("PL18 the call details of a denied call show who denied it", async ($, on) => {
    worldOf($, on);
    await run($, "asked no");
    const pane = await mountPane($, WIDE_COLUMNS);

    await pane.press({ key: "permission-perm-0" });

    const lines = (await bodyLines(pane)).map((line) => line.text);
    expect(lines).toContain(`denied · ${PERSON_DENIAL}`);
  });

  test("PL19 in dark the auto-allowed calls fold behind a dim row, and opening it lists them", async ($, on) => {
    worldOf($, on, "dark");
    await run($, "curl x");
    for (let i = 0; i < ALLOWED_RUNS; i++) await run($, "cat z");
    const pane = await mountPane($, WIDE_COLUMNS);
    const ink = inkFor("dark");

    const folded = await permissionRows(pane);
    expect(folded.map((row) => row.text)).toEqual([expect.stringContaining(DENY_RULE)]);
    expect(folded[0]?.texts.find((text) => ownText(text) === "⊘")?.props?.color).toBe(ink.alert);
    expect(await foldLabels(pane)).toEqual([`▸ ${ALLOWED_RUNS} auto-allowed`]);
    expect((await requireFold(pane)).isDim).toBe(true);

    await toggleAllowed(pane);

    expect(await foldLabels(pane)).toEqual([`▾ ${ALLOWED_RUNS} auto-allowed`]);
    const opened = await permissionRows(pane);
    const greenMarks = opened.filter((row) =>
      row.texts.some((text) => ownText(text) === "✓" && text.props?.color === ink.ok),
    );
    expect(greenMarks).toHaveLength(ALLOWED_RUNS);
  });

  test("PL20 in dark with only a denied call the permissions show that row and no auto-allowed text", async ($, on) => {
    worldOf($, on, "dark");
    await run($, "curl x");
    const pane = await mountPane($, WIDE_COLUMNS);

    const rows = await permissionRows(pane);
    const drawn = [
      ...(await bodyLines(pane)).map((line) => line.text),
      ...(await pane.findAll({ type: "Button" })).map((button) => String(button.props.label)),
    ];

    expect(rows.map((row) => row.text)).toEqual([expect.stringContaining(DENY_RULE)]);
    expect(drawn.filter((text) => text.includes("auto-allowed"))).toEqual([]);
  });

  test("PL21 pressing the open auto-allowed row folds its rows away again", async ($, on) => {
    worldOf($, on, "dark");
    await run($, "ls y");
    const pane = await mountPane($, WIDE_COLUMNS);
    await toggleAllowed(pane);
    expect(await permissionRows(pane)).toHaveLength(1);

    await toggleAllowed(pane);

    expect(await permissionRows(pane)).toEqual([]);
    expect(await foldLabels(pane)).toEqual(["▸ 1 auto-allowed"]);
  });

  test("PL22 the auto-allowed rows stay open after the owner opens one row and goes back", async ($, on) => {
    worldOf($, on, "dark");
    await run($, "ls y");
    const pane = await mountPane($, WIDE_COLUMNS);
    await toggleAllowed(pane);

    await pane.press({ key: "permission-perm-0" });
    await pane.press({ key: "back" });

    const rows = await permissionRows(pane);
    expect(rows.map((row) => row.text)).toEqual([expect.stringContaining(ALLOW_RULE)]);
  });

  test("PL24 at 60 columns with the fold open, each auto-allowed row starts 2 cells right of the fold row and ends at the same edge as the denied row above", async ($, on) => {
    worldOf($, on, "dark");
    await run($, "curl x");
    for (let i = 0; i < ALLOWED_RUNS; i++) await run($, "cat z");
    const pane = await mountPane($, SIXTY_COLUMNS);
    const deniedBefore = permissionSection(placedIn(await pane.drawn())).find((item) =>
      DENIED_ROW.test(item.text),
    );
    await toggleAllowed(pane);

    const section = permissionSection(placedIn(await pane.drawn()));
    const foldAt = section.findIndex((item) => FOLD_PATTERN.test(item.text));
    const denied = section.slice(0, foldAt).find((item) => DENIED_ROW.test(item.text));
    const allowedRows = section
      .slice(foldAt + 1)
      .filter((item) => ALLOWED_ROW.test(item.text) && item.right !== null);
    const allowedClocks = section.slice(foldAt + 1).filter((item) => CLOCK_CELL.test(item.text));

    expect(allowedRows).toHaveLength(ALLOWED_RUNS);
    expect(allowedClocks).toHaveLength(ALLOWED_RUNS);
    expect(allowedClocks.map((item) => item.column)).toEqual(
      allowedClocks.map(() => (section[foldAt]?.column ?? Number.NaN) + PANEL_INDENT),
    );
    expect(denied?.column).toBe(deniedBefore?.column);
    expect(allowedRows.map((item) => item.right)).toEqual(allowedRows.map(() => denied?.right));
  });

  test("PL23 the details of a denied call show a blank row between the denial and the body", async ($, on) => {
    worldOf($, on, "dark");
    await run($, "curl x");
    const pane = await mountPane($, WIDE_COLUMNS);

    await pane.press({ key: "permission-perm-0" });

    const lines = (await bodyLines(pane)).map((line) => line.text);
    const denial = lines.indexOf(`denied · ${DENY_RULE}`);
    expect(denial).toBeGreaterThan(-1);
    expect(lines[denial + 1]).toBe("");
  });
});

let nextId = 0;

function run($: Engine, command: string): Promise<unknown> {
  return $.tool.call({ tool: "Bash", command, tool_use_id: `perm-${nextId++}` } as never);
}

function worldOf(engine: Engine, on: On, theme?: string): void {
  nextId = 0;
  mock.clock(on);
  mock.env(on, { HOME: "/h/u" });
  if (theme !== undefined)
    on("config.list", () => ({ value: [{ key: "theme", value: theme }] }) as never);
  on("classic.SessionStart", () => ({}));
  on("classic.PostToolUse", () => ({}));
  on("classic.PostToolUseFailure", () => ({}));
  on("classic.PermissionDenied", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: "/work" }));
  on("session.messages", () => ({ value: [] }));
  on("process.run", () => ({ value: { exitCode: 1, stdout: "", stderr: "" } }) as never);
  on("agent.list", () => ({ value: [] }));
  on("tool.check", async (_$, e) => {
    const { command } = e.input as { command?: string };
    if (command === "classified")
      await engine.classic.PermissionDenied({
        tool_name: e.tool,
        tool_input: e.input,
        tool_use_id: e.tool_use_id ?? "",
        reason: CLASSIFIER_REASON,
      });
    return scriptOf(command).verdict;
  });
  on("classic.PermissionRequest", (_$, e) => {
    const { answer } = scriptOf((e.tool_input as { command?: string }).command);
    return { decision: answer };
  });
  on("tool.call", async (_$, e) => {
    const command = Reflect.get(e, "command") as string;
    if (command === "hook refused") return { deny: REFUSAL };
    const call = { tool_name: e.tool, tool_input: { command }, tool_use_id: e.tool_use_id };
    if (command === "asked yes fails") {
      await engine.classic.PostToolUseFailure({ ...call, error: "exit 1" });
      return { isError: true, result: "exit 1", text: "exit 1" };
    }
    await engine.classic.PostToolUse({ ...call, tool_response: "out" });
    return { result: "out", text: "out" };
  });
}

function scriptOf(command: string | undefined): Scripted {
  return SCRIPTS[command ?? ""] ?? { verdict: { decision: "allow" } };
}

function ranAskedCall(overrides: Partial<PermissionCall>): PermissionCall {
  return {
    verdict: { decision: "ask" },
    classifierReason: undefined,
    hasRun: true,
    isReadOnly: false,
    wasAsked: true,
    dialogOpened: false,
    ran: { result: "out", text: "out" },
    ...overrides,
  };
}

async function permissionRows(pane: Pane): Promise<Line[]> {
  const lines = await bodyLines(pane);
  const start = lines.findIndex((line) => line.text.startsWith("Permissions"));
  if (start < 0) return [];
  const below = lines.slice(start + HEADING_ROW);
  const end = below.findIndex((line) => line.text === "");
  return (end < 0 ? below : below.slice(0, end)).filter((line) => STATUS_ROW.test(line.text));
}

type Placed = { text: string; column: number; right: number | null };

function placedIn(node: Node, offset = 0): Placed[] {
  if (node.type === "Text") return [{ text: textOf(node), column: offset, right: null }];
  const props = node.props ?? {};
  if (node.type === "Button") {
    return [
      { text: typeof props.label === "string" ? props.label : "", column: offset, right: null },
    ];
  }
  const at =
    offset +
    Number(props.paddingLeft ?? props.paddingX ?? 0) +
    Number(props.marginLeft ?? props.marginX ?? 0);
  const rowWidth =
    node.type === "Box" && props.flexDirection === "row" && typeof props.width === "number"
      ? props.width
      : null;
  const own: Placed[] =
    rowWidth === null ? [] : [{ text: textOf(node), column: at, right: at + rowWidth }];
  return [...own, ...elementsIn(node).flatMap((child) => placedIn(child, at))];
}

function permissionSection(placed: Placed[]): Placed[] {
  const header = placed.findIndex((item) => item.text.startsWith("Permissions"));
  const below = placed.slice(header);
  const next = below.findIndex((item, at) => at > 0 && item.text.startsWith(NEXT_HEADING));
  return next < 0 ? below : below.slice(0, next);
}

async function foldLabels(pane: Pane): Promise<string[]> {
  return (await pane.findAll({ type: "Button" }))
    .map((button) => String(button.props.label))
    .filter((label) => FOLD_PATTERN.test(label));
}

async function requireFold(pane: Pane): Promise<{ key: string; isDim: boolean }> {
  const fold = (await pane.findAll({ type: "Button" })).find((button) =>
    FOLD_PATTERN.test(String(button.props.label)),
  );
  if (fold === undefined) throw new Error("the auto-allowed fold row is not drawn");
  return { key: String(fold.key), isDim: fold.props.dimColor === true };
}

async function toggleAllowed(pane: Pane): Promise<void> {
  await pane.press({ key: (await requireFold(pane)).key });
}

function mountPane($: Engine, columns: number): Promise<Pane> {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: "session",
    props: {
      title: "Session",
      isFocused: false,
      bodyColumns: columns,
      placement: "dock",
      scroll: { offset: 0, bodyRows: 120 },
      view: {},
    },
    viewport: { columns, rows: 120 },
  });
}

async function bodyLines(pane: Pane): Promise<Line[]> {
  return linesOf(await pane.drawn());
}

function linesOf(node: Node): Line[] {
  if (node.type === "Text") return [lineOf(node)];
  if (isRow(node) && !holdsColumn(node)) return [lineOf(node)];
  return elementsIn(node).flatMap(linesOf);
}

function lineOf(node: Node): Line {
  return { text: textOf(node), texts: textsIn(node) };
}

function isRow(node: Node): boolean {
  return (
    node.type === "Box" && !["column", "column-reverse"].includes(String(node.props?.flexDirection))
  );
}

function holdsColumn(node: Node): boolean {
  return elementsIn(node).some(
    (child) => (child.type === "Box" && !isRow(child)) || holdsColumn(child),
  );
}

function textsIn(node: Node): Node[] {
  return node.type === "Text" ? [node] : elementsIn(node).flatMap(textsIn);
}

function elementsIn(node: Node): Node[] {
  return (node.children ?? []).filter(
    (child): child is Node => typeof child === "object" && child !== null,
  );
}

function textOf(node: Node): string {
  return (node.children ?? [])
    .map((child) => (typeof child === "string" ? child : textOf(child as Node)))
    .join("");
}

function ownText(node: Node): string {
  return (node.children ?? [])
    .filter((child): child is string => typeof child === "string")
    .join("");
}
