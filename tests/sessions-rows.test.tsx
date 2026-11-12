import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { palette } from "../hooks/palette";
import { inkFor } from "../hooks/pane-ink";
import type { AgentStatus, SessionRow } from "../types";
import { colouredPieces, screenRows } from "./band-screen";
import { childrenOf, collect, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import { statusDot } from "../hooks/pane-kit";
import { drainCostReads, measureOwnCost, seedStoredCosts } from "./cost-seed";
import { isHeavy } from "./weight";

type Pane = Mounted<"terminal", "Pane">;
type Cell = { ch: string; color: unknown };

const NARROW = 60;
const MID = 82;
const WIDE = 120;
const HUGE = 180;
const PANE_ROWS = 40;
const THEMES = ["dark", "light", "light-ansi", "dark-ansi"];
const HOME = "/h/u";
const WORK = "/work";
const OWN_SESSION = "session-own";
const DOT = "●";
const IDLE_DOT = "○";
const WAITING_DOT = "!";
const STATUS_MARKS = [WAITING_DOT, DOT, IDLE_DOT];
const ELLIPSIS = "…";
const NEXT_TAB = "›";
const TAB_PRESSES_LIMIT = 12;
const MAIN = "main";
const MIN_KEPT_CHARS = 3;
const LONG_BRANCH = `feature/${"scorched-neighbours-".repeat(6)}end`;
const BRANCH_35 = "feature/gh-153-rows-spare-wid-tests";
const FOLDER_30 = "demo-app-GH-153-sessions-rows";
const FOLDER_60 = "demo-app-GH-153-sessions-rows-column-gap-width-and-fit-test";
const REVIEW_TAB = "demo-app-GH-86-review-column-sessions-tab";
const REVIEW_VISUAL = "demo-app-GH-86-review-column-sessions-visual";
const SHORT_FOLDER = "alpha";
const SECOND_FOLDER = "gamma";
const THIRD_FOLDER = "delta";
const SHARED_NAME = "work";
const LONG_PARENT_TAB = "demo-app-GH-86-tab";
const LONG_PARENT_VISUAL = "demo-app-GH-86-visual";
const NO_SESSIONS_TEXT = "no running sessions";
const HEADER_BRANCH = "branch";
const HEADER_CTX = "ctx";
const HEADER_COST = "30d";
const FEATURE_X = "feature/x";
const OWN_LONG_BRANCH = "bugfix/own-long-branch";
const WIDE_COST = 1007.42;
const WIDE_COST_TEXT = "$1007.42";
const HUGE_COST = 12345.6;
const HUGE_COST_TEXT = "$12345.60";
const FULL_CTX = 100;
const ORDER_FOLDERS = ["a", "b", "c"];
const AGENT_WAITING_GLYPH = "●";
const GUTTER_CELLS = 1;
const LOW_CTX = 7;

describe("sessions rows", () => {
  test("A1 at 120 columns a running row with a long branch has one cell after the dot, then the state word and two cells between it, the folder, the branch, the context and the cost", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "running", { branch: LONG_BRANCH, ctx: 100, usd: 100 }),
    ]);
    const pane = await sessionsPane($, WIDE);

    const rows = await sessionRows(pane, WIDE);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/^● thinking +alpha {2}\S.*\S {2,}100%! \$100\.00$/u);
  });

  test("A2 at 60 columns a running row with a long branch has one cell after the dot, then the state word and two cells between it, the folder, the branch, the context and the cost", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "running", { branch: LONG_BRANCH, ctx: 100, usd: 100 }),
    ]);
    const pane = await sessionsPane($, NARROW);

    const rows = await sessionRows(pane, NARROW);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/^● thinking +alpha {2}\S.*\S {2}100%! \$100\.00$/u);
  });

  test("A3 at 120 columns short folder and branch names are drawn whole", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "idle", { branch: MAIN, ctx: 12, usd: 1.5 }),
      sessionOf(2, SECOND_FOLDER, "running", { branch: "feature/x", ctx: 40, usd: 3 }),
    ]);
    const pane = await sessionsPane($, WIDE);

    const rows = await sessionRows(pane, WIDE);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("alpha");
    expect(rows[0]).toContain(MAIN);
    expect(rows[1]).toContain("gamma");
    expect(rows[1]).toContain("feature/x");
    expect(rows.join("\n")).not.toContain(ELLIPSIS);
  });

  test("A4 at 82 columns short folder and branch names are drawn whole", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "idle", { branch: MAIN, ctx: 12, usd: 1.5 }),
      sessionOf(2, SECOND_FOLDER, "running", { branch: "feature/x", ctx: 40, usd: 3 }),
    ]);
    const pane = await sessionsPane($, MID);

    const rows = await sessionRows(pane, MID);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("alpha");
    expect(rows[0]).toContain(MAIN);
    expect(rows[1]).toContain("gamma");
    expect(rows[1]).toContain("feature/x");
    expect(rows.join("\n")).not.toContain(ELLIPSIS);
  });

  test("A5 at 120 columns a 30-character folder beside the branch main is drawn whole", async ($, on) => {
    await begin($, on, [sessionOf(1, FOLDER_30, "running", { branch: MAIN, ctx: 40, usd: 3 })]);
    const pane = await sessionsPane($, WIDE);

    const rows = await sessionRows(pane, WIDE);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(FOLDER_30);
  });

  test("A6 at 180 columns a 60-character folder beside the branch main is drawn whole", async ($, on) => {
    await begin($, on, [sessionOf(1, FOLDER_60, "running", { branch: MAIN, ctx: 40, usd: 3 })]);
    const pane = await sessionsPane($, HUGE);

    const rows = await sessionRows(pane, HUGE);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(FOLDER_60);
  });

  test("A7 at 120 columns a 60-character folder and a 35-character branch beside it are both cut at their end with an ellipsis and keep their start", async ($, on) => {
    await begin($, on, [
      sessionOf(1, FOLDER_60, "running", { branch: BRANCH_35, ctx: 40, usd: 3 }),
    ]);
    const pane = await sessionsPane($, WIDE);

    const rows = await sessionRows(pane, WIDE);

    expect(rows).toHaveLength(1);
    const folder = / (demo-app-GH-153[\w-]*)… /u.exec(rows[0] ?? "")?.[1] ?? "";
    expect(FOLDER_60.startsWith(folder)).toBe(true);
    expect(folder.length).toBeGreaterThan(MIN_KEPT_CHARS);
    expect(rows[0]).toContain(BRANCH_35.slice(0, MIN_KEPT_CHARS));
  });

  test("A8 at 60 columns a 60-character folder is cut at its end with an ellipsis so its first characters stay", async ($, on) => {
    await begin($, on, [sessionOf(1, FOLDER_60, "running", { branch: MAIN, ctx: 40, usd: 3 })]);
    const pane = await sessionsPane($, NARROW);

    const shown = (await screenOf(pane, NARROW)).join("\n");

    expect(shown).toMatch(/ demo-app-GH-153[\w-]*… /u);
    expect(shown).not.toContain(FOLDER_60);
  });

  test("A9 at 60 columns two folders that differ only at the end are both cut at their end with an ellipsis and keep their start", async ($, on) => {
    await begin($, on, [
      sessionOf(1, REVIEW_TAB, "running", { branch: MAIN }),
      sessionOf(2, REVIEW_VISUAL, "running", { branch: MAIN }),
    ]);
    const pane = await sessionsPane($, NARROW);

    const rows = await sessionRows(pane, NARROW);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => / (demo-app-GH-86[\w-]*)… /u.exec(row)?.[1] ?? "")).toEqual([
      expect.stringMatching(/^demo-app-GH-86-/u),
      expect.stringMatching(/^demo-app-GH-86-/u),
    ]);
  });

  for (const theme of THEMES) {
    test(`A10 in the ${theme} theme the running session folder is bold and the idle session folder is plain`, async ($, on) => {
      await begin(
        $,
        on,
        [sessionOf(1, SECOND_FOLDER, "running"), sessionOf(2, SHORT_FOLDER, "idle")],
        theme,
      );
      const pane = await sessionsPane($, WIDE);

      expect(await weightsOf(pane, SECOND_FOLDER)).toEqual([true]);
      expect(await weightsOf(pane, SHORT_FOLDER)).toEqual([false]);
    });
  }

  for (const theme of THEMES) {
    test(`A11 in the ${theme} theme a waiting row shows the word waiting in alert right after its dot, before its folder`, async ($, on) => {
      await begin(
        $,
        on,
        [sessionOf(1, "beta", "waiting", { branch: "feature/x", ctx: 40, usd: 3 })],
        theme,
      );
      const pane = await sessionsPane($, WIDE);

      const [row] = await sessionRows(pane, WIDE);

      expect(row).toMatch(/^! waiting +beta /u);
      expect(colourOfToken(await bodyCellsOf(pane), "waiting")).toEqual(
        Array("waiting".length).fill(inkFor(theme).alert),
      );
    });
  }

  test("A12 at 60 columns a waiting row shows the whole word waiting", async ($, on) => {
    await begin($, on, [
      sessionOf(1, FOLDER_60, "waiting", { branch: BRANCH_35, ctx: 40, usd: 3 }),
    ]);
    const pane = await sessionsPane($, NARROW);

    const rows = await sessionRows(pane, NARROW);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/ waiting /u);
  });

  test("A13 at 120 columns with no waiting session the word waiting appears nowhere on the tab", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "idle", { branch: MAIN, ctx: 12, usd: 1.5 }),
      sessionOf(2, SECOND_FOLDER, "running", { branch: "feature/x", ctx: 40, usd: 3 }),
    ]);
    const pane = await sessionsPane($, WIDE);

    expect((await screenOf(pane, WIDE)).join("\n")).not.toContain("waiting");
  });

  for (const theme of THEMES) {
    test(`A14 in the ${theme} theme a context value and a cost value draw their digits in text and their signs in muted`, async ($, on) => {
      await begin(
        $,
        on,
        [sessionOf(1, SHORT_FOLDER, "idle", { branch: MAIN, ctx: 12, usd: 1.5 })],
        theme,
      );
      const pane = await sessionsPane($, WIDE);
      const cells = await cellsOf(pane);

      expect(colourOfToken(cells, "12%")).toEqual([
        inkFor(theme).text,
        inkFor(theme).text,
        inkFor(theme).muted,
      ]);
      expect(colourOfToken(cells, "$1.50")).toEqual([
        inkFor(theme).muted,
        inkFor(theme).text,
        inkFor(theme).text,
        inkFor(theme).text,
        inkFor(theme).text,
      ]);
    });
  }

  test("A15 a zero context is drawn in muted, and a zero cost and unknown values draw no figure", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "idle", { branch: "", ctx: 0, usd: 0 }),
      sessionOf(2, SECOND_FOLDER, "running", { branch: "", ctx: null, usd: null }),
    ]);
    const pane = await sessionsPane($, WIDE);
    const cells = await cellsOf(pane);

    expect(colourOfToken(cells, "0%")).toEqual([palette.muted, palette.muted]);
    expect(colourOfToken(cells, "$0.00")).toEqual([]);
    expect((await sessionRows(pane, WIDE)).join("\n")).not.toContain("$0.00");
    expect((await sessionRows(pane, WIDE)).join("\n")).not.toContain("-");
  });

  test("A16 the context values end in one cell column and the cost values end in one cell column on every row that has them", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "idle", { branch: MAIN, ctx: 5, usd: 0.5 }),
      sessionOf(2, SECOND_FOLDER, "running", { branch: MAIN, ctx: 100, usd: 12.345 }),
      sessionOf(3, THIRD_FOLDER, "idle", { branch: MAIN, ctx: null, usd: null }),
    ]);
    const pane = await sessionsPane($, WIDE);

    const rows = await sessionRows(pane, WIDE);

    expect(rows).toHaveLength(3);
    const [first = "", , third = ""] = rows;
    expect(new Set([first, third].map((row) => row.indexOf("%"))).size).toBe(1);
    expect(new Set([first, third].map((row) => row.length)).size).toBe(1);
  });

  for (const theme of THEMES) {
    test(`A17 in the ${theme} theme a session folder is drawn in text and its branch in muted`, async ($, on) => {
      await begin($, on, [sessionOf(1, SECOND_FOLDER, "running", { branch: "feature/x" })], theme);
      const pane = await sessionsPane($, WIDE);

      expect(await colorsOf(pane, SECOND_FOLDER)).toEqual([inkFor(theme).text]);
      expect(await colorsOf(pane, "feature/x")).toEqual([inkFor(theme).muted]);
    });
  }

  for (const theme of THEMES) {
    test(`A18 in the ${theme} theme the running dot keeps the status colour it has today`, async ($, on) => {
      await begin($, on, [sessionOf(1, SECOND_FOLDER, "running")], theme);
      const pane = await sessionsPane($, WIDE);

      expect(await colorsOf(pane, DOT)).toEqual([inkFor(theme).tool]);
    });
  }

  test("A19 at 60 columns a 60-character folder beside a long branch are both cut at their end with an ellipsis and the row fits", async ($, on) => {
    await begin($, on, [sessionOf(1, FOLDER_60, "running", { branch: LONG_BRANCH })]);
    const pane = await sessionsPane($, NARROW);

    const [row = ""] = await sessionRows(pane, NARROW);

    const folder = / (demo-app-GH-153[\w-]*)… /u.exec(row)?.[1] ?? "";
    const branch = / (feat[\w/-]*)…( |$)/u.exec(row)?.[1] ?? "";
    expect(FOLDER_60.startsWith(folder)).toBe(true);
    expect(folder.length).toBeGreaterThan(MIN_KEPT_CHARS);
    expect(LONG_BRANCH.startsWith(branch)).toBe(true);
    expect(branch.length).toBeGreaterThan(MIN_KEPT_CHARS);
    expect(row.length).toBeLessThan(NARROW);
  });

  test("A20 at 60 columns a $1007.42 cost is drawn whole and the two costs end in one cell", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "running", { branch: MAIN, ctx: 40, usd: 3 }),
      sessionOf(2, SECOND_FOLDER, "idle", { branch: MAIN, ctx: 40, usd: WIDE_COST }),
    ]);
    const pane = await sessionsPane($, NARROW);

    const rows = await sessionRows(pane, NARROW);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/\$3\.00$/u);
    expect(rows[1]).toContain(WIDE_COST_TEXT);
    expect(rows[1]).toMatch(/\$1007\.42$/u);
    expect(new Set(rows.map((row) => row.length)).size).toBe(1);
  });

  test("A21 at 120 columns a $1007.42 cost is drawn whole and the two costs end in one cell", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "running", { branch: MAIN, ctx: 40, usd: 3 }),
      sessionOf(2, SECOND_FOLDER, "idle", { branch: MAIN, ctx: 40, usd: WIDE_COST }),
    ]);
    const pane = await sessionsPane($, WIDE);

    const rows = await sessionRows(pane, WIDE);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/\$3\.00$/u);
    expect(rows[1]).toContain(WIDE_COST_TEXT);
    expect(rows[1]).toMatch(/\$1007\.42$/u);
    expect(new Set(rows.map((row) => row.length)).size).toBe(1);
  });

  test("A22 at 120 columns a $12345.60 cost is drawn whole", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "running", { branch: MAIN, ctx: 40, usd: HUGE_COST }),
    ]);
    const pane = await sessionsPane($, WIDE);

    const rows = await sessionRows(pane, WIDE);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/\$12345\.60$/u);
    expect(rows[0]).toContain(HUGE_COST_TEXT);
  });

  test("A23 at 120 columns a 100% context and a 7% context end their percent signs in one cell", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "running", { branch: MAIN, ctx: FULL_CTX, usd: 3 }),
      sessionOf(2, SECOND_FOLDER, "idle", { branch: MAIN, ctx: LOW_CTX, usd: 3 }),
    ]);
    const pane = await sessionsPane($, WIDE);

    const rows = await sessionRows(pane, WIDE);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("100%");
    expect(rows[1]).toContain("7%");
    expect(new Set(rows.map((row) => row.indexOf("%"))).size).toBe(1);
  });

  for (const theme of THEMES) {
    test(`A25 in the ${theme} theme a session costing $0.004 draws <$0.01 with the signs in muted and the digits in text`, async ($, on) => {
      await begin(
        $,
        on,
        [sessionOf(1, SHORT_FOLDER, "idle", { branch: MAIN, ctx: 12, usd: 0.004 })],
        theme,
      );
      const pane = await sessionsPane($, WIDE);

      const [row] = await sessionRows(pane, WIDE);

      expect(row).toMatch(/<\$0\.01$/u);
      expect(colourOfToken(await cellsOf(pane), "<$0.01")).toEqual([
        inkFor(theme).muted,
        inkFor(theme).muted,
        ...Array.from({ length: "0.01".length }, () => inkFor(theme).text),
      ]);
    });
  }

  test("A26 a session costing $0.006 draws <$0.01 with its digits in text and its signs in muted", async ($, on) => {
    await begin($, on, [sessionOf(1, SHORT_FOLDER, "idle", { branch: MAIN, ctx: 12, usd: 0.006 })]);
    const pane = await sessionsPane($, WIDE);

    const [row] = await sessionRows(pane, WIDE);

    expect(row).toMatch(/<\$0\.01$/u);
    expect(colourOfToken(await cellsOf(pane), "<$0.01")).toEqual([
      inkFor("dark").muted,
      inkFor("dark").muted,
      inkFor("dark").text,
      inkFor("dark").text,
      inkFor("dark").text,
      inkFor("dark").text,
    ]);
  });

  test("A28 at 120 columns the waiting row starts with the glyph and the word, and its context and cost keep two cells between them", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "waiting", { branch: MAIN, ctx: 15, usd: 3 }),
      sessionOf(2, SECOND_FOLDER, "running", { branch: MAIN, ctx: 46, usd: 3 }),
    ]);
    const pane = await sessionsPane($, WIDE);

    const rows = await sessionRows(pane, WIDE);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/^! waiting +alpha .* {2}15% {2}\$3\.00$/u);
    expect(rows[1]).toMatch(/^● thinking +gamma .* {2}46% {2}\$3\.00$/u);
  });

  test("A29 at 120 columns a $0.004 and a $0.006 cost are each drawn exactly two cells after their context value", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "idle", { branch: MAIN, ctx: 40, usd: 0.004 }),
      sessionOf(2, SECOND_FOLDER, "idle", { branch: MAIN, ctx: 40, usd: 0.006 }),
    ]);
    const pane = await sessionsPane($, WIDE);

    const rows = await sessionRows(pane, WIDE);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/40% {2}<\$0\.01$/u);
    expect(rows[1]).toMatch(/40% {2}<\$0\.01$/u);
  });

  for (const theme of THEMES) {
    test(`A30 in the ${theme} theme the thinking word is drawn in the running dot colour, idle in muted and waiting in alert`, async ($, on) => {
      await begin(
        $,
        on,
        [
          sessionOf(1, SHORT_FOLDER, "running", { branch: MAIN, ctx: 40, usd: 3 }),
          sessionOf(2, SECOND_FOLDER, "idle", { branch: MAIN, ctx: 40, usd: 3 }),
          sessionOf(3, THIRD_FOLDER, "waiting", { branch: MAIN, ctx: 40, usd: 3 }),
        ],
        theme,
      );
      const pane = await sessionsPane($, WIDE);
      const cells = await bodyCellsOf(pane);

      expect(colourOfToken(cells, "thinking")).toEqual(
        Array("thinking".length).fill(inkFor(theme).tool),
      );
      expect(colourOfToken(cells, "idle")).toEqual(Array(4).fill(inkFor(theme).muted));
      expect(colourOfToken(cells, "waiting")).toEqual(
        Array("waiting".length).fill(inkFor(theme).alert),
      );
    });
  }

  test("A31 at 120 columns a running and an idle session start their state words in one cell, right after the dot and before the folder", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "running", { branch: MAIN, ctx: 40, usd: 3 }),
      sessionOf(2, SECOND_FOLDER, "idle", { branch: FEATURE_X, ctx: 40, usd: 3 }),
    ]);
    const pane = await sessionsPane($, WIDE);

    const rows = await sessionRows(pane, WIDE);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.indexOf("thinking")).toBe(rows[1]?.indexOf("idle"));
    expect(rows[0]?.indexOf("thinking")).toBe(2);
    expect(rows[0]?.indexOf("thinking")).toBeLessThan(rows[0]?.indexOf(SHORT_FOLDER) ?? -1);
  });

  test("A32 at 120 columns the own session row shows its state word after the dot like the other row and this in muted right after its name", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "running", {
        branch: MAIN,
        ctx: 40,
        usd: 3,
        sessionId: OWN_SESSION,
      }),
      sessionOf(2, SECOND_FOLDER, "running", { branch: MAIN, ctx: 40, usd: 3 }),
    ]);
    const pane = await sessionsPane($, WIDE);

    const rows = await sessionRows(pane, WIDE);

    const ownRow = rows.find((row) => row.includes(SHORT_FOLDER)) ?? "";
    const otherRow = rows.find((row) => row.includes(SECOND_FOLDER)) ?? "";

    expect(ownRow).toMatch(/^● thinking +alpha this .*40% {2}\$3\.00$/u);
    expect(otherRow).toMatch(/^● thinking +gamma /u);
    expect(colourOfToken(await bodyCellsOf(pane), "this")).toEqual(
      Array("this".length).fill(inkFor("dark").muted),
    );
  });

  test("A33 at 60 columns a running session with a long branch draws the word thinking whole after the dot and keeps two cells before the context value", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "running", { branch: LONG_BRANCH, ctx: 40, usd: 3 }),
    ]);
    const pane = await sessionsPane($, NARROW);

    const [row] = await sessionRows(pane, NARROW);

    expect(row).toMatch(/^● thinking +alpha {2}\S.*\S {2}40% {2}\$3\.00$/u);
  });

  test("A34 at 60 columns two sessions named work under the parents a and b draw a/work and b/work, and a unique name stays bare", async ($, on) => {
    await begin($, on, [
      sessionOf(1, `a/${SHARED_NAME}`, "running", { branch: MAIN }),
      sessionOf(2, `b/${SHARED_NAME}`, "idle", { branch: MAIN }),
      sessionOf(3, SHORT_FOLDER, "idle", { branch: MAIN }),
    ]);
    const pane = await sessionsPane($, NARROW);

    const rows = await sessionRows(pane, NARROW);

    expect(rows.map(folderOf)).toEqual([`a/${SHARED_NAME}`, SHORT_FOLDER, `b/${SHARED_NAME}`]);
  });

  test("A35 at 120 columns two sessions named work under long parent folders each draw their whole parent and name", async ($, on) => {
    await begin($, on, [
      sessionOf(1, `${LONG_PARENT_TAB}/${SHARED_NAME}`, "running", { branch: MAIN }),
      sessionOf(2, `${LONG_PARENT_VISUAL}/${SHARED_NAME}`, "idle", { branch: MAIN }),
    ]);
    const pane = await sessionsPane($, WIDE);

    const rows = await sessionRows(pane, WIDE);

    expect(rows.map(folderOf)).toEqual([
      `${LONG_PARENT_TAB}/${SHARED_NAME}`,
      `${LONG_PARENT_VISUAL}/${SHARED_NAME}`,
    ]);
  });

  for (const theme of THEMES) {
    test(`A36 in the ${theme} theme the parent and slash of a shared name are muted, the name is in text and bold only when running`, async ($, on) => {
      await begin(
        $,
        on,
        [
          sessionOf(1, `a/${SHARED_NAME}`, "running", { branch: MAIN }),
          sessionOf(2, `b/${SHARED_NAME}`, "idle", { branch: MAIN }),
        ],
        theme,
      );
      const pane = await sessionsPane($, WIDE);

      expect(colourOfToken(await cellsOf(pane), `a/${SHARED_NAME}`)).toEqual([
        inkFor(theme).muted,
        inkFor(theme).muted,
        ...Array.from({ length: SHARED_NAME.length }, () => inkFor(theme).text),
      ]);
      expect(await weightsOf(pane, SHARED_NAME)).toEqual([true, false]);
    });
  }

  test("A37 at 60 columns the branch label starts over the branch values and the ctx and cost labels end over their values", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "running", { branch: MAIN, ctx: 40, usd: 3 }),
      sessionOf(2, SECOND_FOLDER, "idle", { branch: FEATURE_X, ctx: 100, usd: 12.5 }),
    ]);
    const pane = await sessionsPane($, NARROW);
    const lines = await rawLinesOf(pane, NARROW);
    const header = headerLineOf(lines);
    const rows = sessionLinesOf(lines);

    expect(rows[0]?.indexOf(MAIN)).toBe(header.indexOf(HEADER_BRANCH));
    expect(rows[1]?.indexOf(FEATURE_X)).toBe(header.indexOf(HEADER_BRANCH));
    expect(rows.map((row) => row.indexOf("%") + 1)).toEqual([
      header.indexOf(HEADER_CTX) + HEADER_CTX.length,
      header.indexOf(HEADER_CTX) + HEADER_CTX.length,
    ]);
    expect(rows.map((row) => row.length)).toEqual([header.length, header.length]);
  });

  test("A38 at 120 columns the branch label starts over the branch values and the ctx and cost labels end over their values", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "running", { branch: MAIN, ctx: 40, usd: 3 }),
      sessionOf(2, SECOND_FOLDER, "idle", { branch: FEATURE_X, ctx: 100, usd: 12.5 }),
    ]);
    const pane = await sessionsPane($, WIDE);
    const lines = await rawLinesOf(pane, WIDE);
    const header = headerLineOf(lines);
    const rows = sessionLinesOf(lines);

    expect(rows[0]?.indexOf(MAIN)).toBe(header.indexOf(HEADER_BRANCH));
    expect(rows[1]?.indexOf(FEATURE_X)).toBe(header.indexOf(HEADER_BRANCH));
    expect(rows.map((row) => row.indexOf("%") + 1)).toEqual([
      header.indexOf(HEADER_CTX) + HEADER_CTX.length,
      header.indexOf(HEADER_CTX) + HEADER_CTX.length,
    ]);
    expect(rows.map((row) => row.length)).toEqual([header.length, header.length]);
  });

  for (const theme of THEMES) {
    test(`A39 in the ${theme} theme the branch, ctx and cost labels are drawn in muted`, async ($, on) => {
      await begin(
        $,
        on,
        [sessionOf(1, SHORT_FOLDER, "running", { branch: MAIN, ctx: 40, usd: 3 })],
        theme,
      );
      const pane = await sessionsPane($, WIDE);

      expect(await colorsOf(pane, HEADER_BRANCH)).toEqual([inkFor(theme).muted]);
      expect(await colorsOf(pane, HEADER_CTX)).toEqual([inkFor(theme).muted]);
      expect(await colorsOf(pane, HEADER_COST)).toEqual([inkFor(theme).muted]);
    });
  }

  test("A40 at 60 columns with unknown context and cost the ctx and cost labels are drawn whole above empty cells", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "idle", { branch: MAIN, ctx: null, usd: null }),
    ]);
    const pane = await sessionsPane($, NARROW);
    const lines = await rawLinesOf(pane, NARROW);
    const header = headerLineOf(lines);
    const [row] = sessionLinesOf(lines);

    expect(header).toMatch(/ctx {2}30d$/u);
    expect(row).toMatch(/^○ idle +alpha {2}main$/u);
    expect(row?.length).toBeLessThan(header.indexOf(HEADER_CTX));
  });

  test("A41 at 120 columns the header holds only the labels branch, ctx and cost, none above the dot, the folder or the state", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "waiting", { branch: MAIN, ctx: 40, usd: 3 }),
      sessionOf(2, SECOND_FOLDER, "running", { branch: FEATURE_X, ctx: 40, usd: 3 }),
    ]);
    const pane = await sessionsPane($, WIDE);

    const header = headerLineOf(await rawLinesOf(pane, WIDE));

    expect(header.trim().split(/ +/u)).toEqual([HEADER_BRANCH, HEADER_CTX, HEADER_COST]);
  });

  test("A42 with no sessions the tab shows only the no running sessions line and no column labels", async ($, on) => {
    await begin($, on, []);
    const pane = await sessionsPane($, WIDE);

    const screen = (await rawLinesOf(pane, WIDE)).join("\n");

    expect(screen).toContain(NO_SESSIONS_TEXT);
    expect(screen).not.toMatch(/branch|ctx|cost/u);
  });

  test("A43 at 120 columns the column labels sit under the summary and its blank row and above the first session", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "running", { branch: MAIN, ctx: 40, usd: 3 }),
      sessionOf(2, SECOND_FOLDER, "idle", { branch: FEATURE_X, ctx: 40, usd: 3 }),
    ]);
    const pane = await sessionsPane($, WIDE);

    const lines = await screenOf(pane, WIDE);
    const headerAt = lines.findIndex((line) => line.startsWith(HEADER_BRANCH));

    expect(lines[headerAt - 2]).toBe("2 sessions · 1 thinking");
    expect(lines[headerAt - 1]).toBe("");
    expect(lines[headerAt + 1]).toMatch(/^● /u);
  });

  test("A44 at 60 columns a $1251.40 cost is drawn whole and the two costs end in one cell", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "running", { branch: MAIN, ctx: 40, usd: 3 }),
      sessionOf(2, SECOND_FOLDER, "idle", { branch: MAIN, ctx: 40, usd: 1251.4 }),
    ]);
    const pane = await sessionsPane($, NARROW);

    const rows = await sessionRows(pane, NARROW);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/\$3\.00$/u);
    expect(rows[1]).toMatch(/\$1251\.40$/u);
    expect(new Set(rows.map((row) => row.length)).size).toBe(1);
  });
  for (const theme of THEMES) {
    test(`A45 in the ${theme} theme a 100% context draws its digits in alert and its percent sign in muted`, async ($, on) => {
      await begin(
        $,
        on,
        [sessionOf(1, SHORT_FOLDER, "idle", { branch: MAIN, ctx: FULL_CTX, usd: 3 })],
        theme,
      );
      const pane = await sessionsPane($, WIDE);

      expect(colourOfToken(await cellsOf(pane), "100%")).toEqual([
        inkFor(theme).alert,
        inkFor(theme).alert,
        inkFor(theme).alert,
        inkFor(theme).muted,
      ]);
    });
  }

  test("A46 a 79% context keeps its digits in text and an 80% context turns its digits alert", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "idle", { branch: MAIN, ctx: 79, usd: 3 }),
      sessionOf(2, SECOND_FOLDER, "idle", { branch: MAIN, ctx: 80, usd: 3 }),
    ]);
    const pane = await sessionsPane($, WIDE);
    const cells = await cellsOf(pane);

    expect(colourOfToken(cells, "79%")).toEqual([
      inkFor("dark").text,
      inkFor("dark").text,
      inkFor("dark").muted,
    ]);
    expect(colourOfToken(cells, "80%")).toEqual([
      inkFor("dark").alert,
      inkFor("dark").alert,
      inkFor("dark").muted,
    ]);
  });

  test("A47 in the summary row the session count is bold and in text, the word sessions and the dot stay muted, and the waiting count stays alert", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "waiting", { branch: MAIN, ctx: 40, usd: 3 }),
      sessionOf(2, SECOND_FOLDER, "running", { branch: MAIN, ctx: 40, usd: 3 }),
      sessionOf(3, THIRD_FOLDER, "idle", { branch: MAIN, ctx: 40, usd: 3 }),
    ]);
    const pane = await sessionsPane($, WIDE);
    const summary = "3 sessions · 1 waiting · 1 thinking";
    const cells = await cellsOf(pane);

    expect(await weightsOf(pane, "3")).toEqual([true]);
    expect(colourOfToken(cells, summary)).toEqual([
      inkFor("dark").text,
      ...Array.from({ length: " sessions · ".length }, () => inkFor("dark").muted),
      ...Array.from({ length: "1 waiting".length }, () => inkFor("dark").alert),
      ...Array.from({ length: " · ".length }, () => inkFor("dark").muted),
      ...Array.from({ length: "1 thinking".length }, () => inkFor("dark").tool),
    ]);
  });

  test("A48 in the summary row a lone session count is bold and in text and the word session stays muted", async ($, on) => {
    await begin($, on, [sessionOf(1, SHORT_FOLDER, "idle", { branch: MAIN, ctx: 40, usd: 3 })]);
    const pane = await sessionsPane($, WIDE);

    expect(await weightsOf(pane, "1")).toEqual([true]);
    expect(colourOfToken(await cellsOf(pane), "1 session")).toEqual([
      inkFor("dark").text,
      ...Array.from({ length: " session".length }, () => inkFor("dark").muted),
    ]);
  });

  test("A49 at 120 columns a row with no branch draws nothing under the branch label", async ($, on) => {
    await begin($, on, [sessionOf(1, SHORT_FOLDER, "running", { branch: "", ctx: 40, usd: 3 })]);
    const pane = await sessionsPane($, WIDE);
    const lines = await rawLinesOf(pane, WIDE);
    const [row] = sessionLinesOf(lines);

    expect(row).toMatch(/^● thinking +alpha +40% {2}\$3\.00$/u);
    expect(row).not.toContain("-");
  });

  test("A50 at 60 columns a row with no branch draws nothing between its folder and its context", async ($, on) => {
    await begin($, on, [sessionOf(1, SHORT_FOLDER, "idle", { branch: "", ctx: 40, usd: 3 })]);
    const pane = await sessionsPane($, NARROW);

    const [row] = await sessionRows(pane, NARROW);

    expect(row).toMatch(/^○ idle +alpha +40% {2}\$3\.00$/u);
  });

  test("A51 three idle rows in /b, /a and /c draw as a, b, c and the b row going busy keeps its line", async ($, on) => {
    on("turn.start", (_$, e) => ({ turnId: e.turnId }));
    await begin($, on, [
      sessionOf(1, "b", "idle", { sessionId: OWN_SESSION }),
      sessionOf(2, "a", "idle"),
      sessionOf(3, "c", "idle"),
    ]);
    const pane = await sessionsPane($, WIDE);
    const before = await sessionRows(pane, WIDE);

    await $.turn.start({ text: "go", turnId: "t1" });
    await pane.redraw();
    const after = await sessionRows(pane, WIDE);

    expect(before.map(shownNameOf)).toEqual(ORDER_FOLDERS);
    expect(after.map(shownNameOf)).toEqual(ORDER_FOLDERS);
    expect(before[1]).toMatch(/^○ idle /u);
    expect(after[1]).toMatch(/^● thinking /u);
  });

  test("A52 a waiting row in /z draws above the idle and running rows in /a and /b", async ($, on) => {
    await begin($, on, [
      sessionOf(1, "a", "idle"),
      sessionOf(2, "b", "running"),
      sessionOf(3, "z", "waiting"),
    ]);
    const pane = await sessionsPane($, WIDE);

    const rows = await sessionRows(pane, WIDE);

    expect(rows.map(folderOf)).toEqual(["z", "a", "b"]);
    expect(rows[0]).toMatch(/^! waiting /u);
  });

  for (const theme of THEMES) {
    test(`A53 in the ${theme} theme waiting draws ! in alert, running draws ● in tool and idle draws ○ in muted`, async ($, on) => {
      await begin(
        $,
        on,
        [
          sessionOf(1, SHORT_FOLDER, "waiting"),
          sessionOf(2, SECOND_FOLDER, "running"),
          sessionOf(3, THIRD_FOLDER, "idle"),
        ],
        theme,
      );
      const pane = await sessionsPane($, WIDE);

      expect(await colorsOf(pane, WAITING_DOT)).toEqual([inkFor(theme).alert]);
      expect(await colorsOf(pane, DOT)).toEqual([inkFor(theme).tool]);
      expect(await colorsOf(pane, IDLE_DOT)).toEqual([inkFor(theme).muted]);
    });
  }

  test("A53b the shared status dot of the Agents tab still draws a waiting agent as ●", () => {
    expect(statusDot("waiting").text).toBe(AGENT_WAITING_GLYPH);
  });

  test("A54 the summary with 1 waiting and 2 running rows reads 4 sessions, 1 waiting, 2 thinking with waiting in alert and thinking in the running colour", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "waiting"),
      sessionOf(2, SECOND_FOLDER, "running"),
      sessionOf(3, THIRD_FOLDER, "running"),
      sessionOf(4, "omega", "idle"),
    ]);
    const pane = await sessionsPane($, WIDE);
    const summary = "4 sessions · 1 waiting · 2 thinking";

    expect(await screenOf(pane, WIDE)).toContain(summary);
    expect(colourOfToken(await cellsOf(pane), summary)).toEqual([
      inkFor("dark").text,
      ...Array.from({ length: " sessions · ".length }, () => inkFor("dark").muted),
      ...Array.from({ length: "1 waiting".length }, () => inkFor("dark").alert),
      ...Array.from({ length: " · ".length }, () => inkFor("dark").muted),
      ...Array.from({ length: "2 thinking".length }, () => inkFor("dark").tool),
    ]);
  });

  test("A54b the summary with no waiting and no running row reads only 4 sessions", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "idle"),
      sessionOf(2, SECOND_FOLDER, "idle"),
      sessionOf(3, THIRD_FOLDER, "idle"),
      sessionOf(4, "omega", "idle"),
    ]);
    const pane = await sessionsPane($, WIDE);

    expect(await screenOf(pane, WIDE)).toContain("4 sessions");
  });

  for (const columns of [NARROW, WIDE]) {
    test(`A55 at ${columns} columns a row with no context, no cost and no branch holds no dash and the other rows keep their context and cost in one cell column`, async ($, on) => {
      await begin($, on, [
        sessionOf(1, SHORT_FOLDER, "idle", { branch: "", ctx: null, usd: null }),
        sessionOf(2, SECOND_FOLDER, "running", { branch: MAIN, ctx: 40, usd: 1645.2 }),
        sessionOf(3, THIRD_FOLDER, "idle", { branch: MAIN, ctx: 5, usd: 12.5 }),
      ]);
      const pane = await sessionsPane($, columns);

      const [empty, third, second] = await sessionRows(pane, columns);

      expect(empty).not.toContain("-");
      expect(empty).toMatch(/^○ idle +alpha *$/u);
      expect(third?.indexOf("%")).toBe(second?.indexOf("%"));
      expect(third?.length).toBe(second?.length);
      expect(second).toMatch(/\$1645\.20$/u);
    });
  }

  test("A56 the own row shows its state word after its dot and this right after its name, and another row has no this", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "idle", { sessionId: OWN_SESSION }),
      sessionOf(2, SECOND_FOLDER, "running"),
    ]);
    const pane = await sessionsPane($, WIDE);

    const [ownRow = "", otherRow = ""] = await sessionRows(pane, WIDE);

    expect(ownRow).toMatch(/^○ idle +alpha this .*40% {2}\$3\.00$/u);
    expect(otherRow).toMatch(/ {2}40% {2}\$3\.00$/u);
    expect(otherRow).not.toContain("this");
  });

  test("A57 after the session cost is measured as $1645.20 the own row's cost cell reads $1645.20 in full", async ($, on) => {
    await begin($, on, [sessionOf(1, SHORT_FOLDER, "idle", { sessionId: OWN_SESSION, usd: 3 })]);
    const pane = await sessionsPane($, NARROW);

    await $.session.measure({
      context: { window: 200_000 },
      rateLimits: [],
      cost: { usd: 1645.2 },
      changed: ["cost"],
    } as never);
    await pane.redraw();

    const [row] = await sessionRows(pane, NARROW);
    expect(row).toMatch(/\$1645\.20$/u);
  });

  test("A57b at 120 columns after the session cost is measured as $1645.20 the own row's cost cell reads $1645.20 in full", async ($, on) => {
    await begin($, on, [sessionOf(1, SHORT_FOLDER, "idle", { sessionId: OWN_SESSION, usd: 3 })]);
    const pane = await sessionsPane($, WIDE);

    await $.session.measure({
      context: { window: 200_000 },
      rateLimits: [],
      cost: { usd: 1645.2 },
      changed: ["cost"],
    } as never);
    await pane.redraw();

    const [row] = await sessionRows(pane, WIDE);
    expect(row).toMatch(/\$1645\.20$/u);
  });
});

describe("sessions look", () => {
  for (const theme of ["dark", "light"]) {
    test(`N1 in the ${theme} theme a 79% context has no sign and 80% and 100% contexts carry a ! in alert`, async ($, on) => {
      await begin(
        $,
        on,
        [
          sessionOf(1, SHORT_FOLDER, "idle", { branch: MAIN, ctx: 79, usd: 3 }),
          sessionOf(2, THIRD_FOLDER, "idle", { branch: MAIN, ctx: 80, usd: 3 }),
          sessionOf(3, SECOND_FOLDER, "idle", { branch: MAIN, ctx: FULL_CTX, usd: 3 }),
        ],
        theme,
      );
      const pane = await sessionsPane($, WIDE);

      const rows = await sessionRows(pane, WIDE);
      const signs = (await cellsOf(pane)).filter((cell) => cell.ch === "!");

      expect(rows.map((row) => /\d%!/u.test(row))).toEqual([false, true, true]);
      expect(signs.map((cell) => cell.color)).toEqual([inkFor(theme).alert, inkFor(theme).alert]);
    });
  }

  for (const columns of [NARROW, WIDE]) {
    test(`N2 at ${columns} columns rows with a signed ctx end their ctx cell under the ctx label and their cost under the 30d label`, async ($, on) => {
      await begin($, on, [
        sessionOf(1, SHORT_FOLDER, "idle", { branch: MAIN, ctx: FULL_CTX, usd: 12.5 }),
        sessionOf(2, THIRD_FOLDER, "idle", { branch: MAIN, ctx: 80, usd: 3 }),
        sessionOf(3, SECOND_FOLDER, "idle", { branch: MAIN, ctx: LOW_CTX, usd: 3 }),
      ]);
      const pane = await sessionsPane($, columns);
      const lines = await rawLinesOf(pane, columns);
      const header = headerLineOf(lines);
      const rows = sessionLinesOf(lines);

      expect(rows.map((row) => /\d%!/u.test(row))).toEqual([true, true, false]);
      expect(rows.map((row) => row.indexOf("%") + 1)).toEqual(
        rows.map(() => header.indexOf(HEADER_CTX) + HEADER_CTX.length),
      );
      expect(rows.map((row) => row.length)).toEqual(rows.map(() => header.length));
    });
  }

  for (const columns of [NARROW, WIDE]) {
    test(`N6 at ${columns} columns the sign takes no column: an 85% and a 59% row keep their percent signs in one column, with the sign in the gap and one gap cell left before the cost`, async ($, on) => {
      await begin($, on, [
        sessionOf(1, SHORT_FOLDER, "idle", { branch: MAIN, ctx: 85, usd: 3 }),
        sessionOf(2, SECOND_FOLDER, "idle", { branch: MAIN, ctx: 59, usd: 3 }),
      ]);
      const pane = await sessionsPane($, columns);
      const lines = await rawLinesOf(pane, columns);
      const header = headerLineOf(lines);
      const [signed = "", plain = ""] = sessionLinesOf(lines);
      const percentAt = plain.indexOf("%");

      expect({
        percents: [signed.indexOf("%"), plain.indexOf("%")],
        ctxEnd: header.indexOf(HEADER_CTX) + HEADER_CTX.length,
        branches: [signed.indexOf(MAIN), plain.indexOf(MAIN)],
        costs: [signed.indexOf("$"), plain.indexOf("$")],
      }).toEqual({
        percents: [percentAt, percentAt],
        ctxEnd: percentAt + 1,
        branches: [header.indexOf(HEADER_BRANCH), header.indexOf(HEADER_BRANCH)],
        costs: [percentAt + 3, percentAt + 3],
      });
      expect(signed.slice(percentAt, percentAt + 3)).toBe("%! ");
    });
  }

  for (const columns of [NARROW, WIDE]) {
    test(`N7 at ${columns} columns an 88% row with a $1047.85 cost keeps its sign and one gap cell, beside a 59% row with $4.53, with the percent signs in one column and the cost right edges in one column`, async ($, on) => {
      await begin($, on, [
        sessionOf(1, FOLDER_30, "idle", { branch: LONG_BRANCH, ctx: 88, usd: 1047.85 }),
        sessionOf(2, REVIEW_TAB, "idle", { branch: LONG_BRANCH, ctx: 59, usd: 4.53 }),
      ]);
      const pane = await sessionsPane($, columns);
      const lines = await rawLinesOf(pane, columns);
      const header = headerLineOf(lines);
      const [signed = "", plain = ""] = sessionLinesOf(lines);

      expect(signed).toMatch(/88%! \$1047\.85$/u);
      expect(signed.indexOf("%")).toBe(plain.indexOf("%"));
      expect([signed.length, plain.length]).toEqual([header.length, header.length]);
    });

    test(`N7b at ${columns} columns a 59% row with a $1047.85 cost keeps two gap cells after the percent sign`, async ($, on) => {
      await begin($, on, [
        sessionOf(1, SHORT_FOLDER, "idle", { branch: MAIN, ctx: 59, usd: 1047.85 }),
      ]);
      const pane = await sessionsPane($, columns);

      const [row = ""] = await sessionRows(pane, columns);

      expect(row).toMatch(/59% {2}\$1047\.85$/u);
    });
  }

  test("N3 at 60 columns a long own folder gets the same name width as another long folder and its branch cell reads this", async ($, on) => {
    await begin($, on, [
      sessionOf(1, FOLDER_30, "idle", { branch: OWN_LONG_BRANCH, sessionId: OWN_SESSION }),
      sessionOf(2, REVIEW_TAB, "idle", { branch: FEATURE_X }),
    ]);
    const pane = await sessionsPane($, NARROW);
    const lines = await rawLinesOf(pane, NARROW);
    const header = headerLineOf(lines);
    const [own = "", other = ""] = sessionLinesOf(lines);

    expect(own.indexOf(ELLIPSIS)).toBe(other.indexOf(ELLIPSIS));
    expect(own.indexOf("this")).toBe(header.indexOf(HEADER_BRANCH));
    expect(own).not.toContain(OWN_LONG_BRANCH.slice(0, MIN_KEPT_CHARS));
    expect(other).not.toContain("this");
  });

  test("N4 at 60 columns a short own folder keeps its name, this right after it and its branch", async ($, on) => {
    await begin($, on, [
      sessionOf(1, SHORT_FOLDER, "idle", { branch: MAIN, sessionId: OWN_SESSION }),
      sessionOf(2, REVIEW_TAB, "idle", { branch: FEATURE_X }),
    ]);
    const pane = await sessionsPane($, NARROW);

    const own = (await sessionRows(pane, NARROW)).find((row) => row.includes("this")) ?? "";

    expect(own).toMatch(/^○ idle +alpha this +main\b/u);
  });

  test("N5 at 120 columns a long own folder that fits is drawn whole with this and its branch", async ($, on) => {
    await begin($, on, [
      sessionOf(1, FOLDER_30, "idle", { branch: MAIN, sessionId: OWN_SESSION }),
      sessionOf(2, SECOND_FOLDER, "idle", { branch: FEATURE_X }),
    ]);
    const pane = await sessionsPane($, WIDE);

    const own = (await sessionRows(pane, WIDE)).find((row) => row.includes("this")) ?? "";

    expect(own).toMatch(new RegExp(`^○ idle +${FOLDER_30} this +main\\b`, "u"));
  });
});

function sessionOf(
  pid: number,
  folder: string,
  state: AgentStatus,
  fields: Partial<SessionRow> = {},
): SessionRow {
  return {
    pid,
    sessionId: `session-${pid}`,
    state,
    cwd: `${WORK}/${folder}`,
    branch: MAIN,
    ctx: 40,
    usd: 3,
    ...fields,
  };
}

async function begin($: Engine, on: On, rows: SessionRow[], theme = "dark"): Promise<void> {
  const files = new Map<string, string>(
    rows.map((row) => [`${HOME}/.claude/paneline/sessions/${row.pid}.json`, JSON.stringify(row)]),
  );
  const state = new Map<string, { value: unknown; version: number }>([
    [
      "paneline.sessions.",
      { value: Object.fromEntries(rows.map((row) => [row.pid, row])), version: 1 },
    ],
    ["paneline.usage.", { value: { context: null, limits: [] }, version: 1 }],
  ]);
  const clock = mock.clock(on, { now: 1_000_000 });
  settleCostReads = () => drainCostReads(clock);
  mock.env(on, { HOME });
  on("config.list", () => ({ value: [{ key: "theme", value: theme }] }) as never);
  on("command.register", () => ({ value: {} }) as never);
  on("session.id", () => ({ value: OWN_SESSION }));
  on("settings.read", () => ({ value: {} }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("store.get", () => ({ value: undefined }));
  on("store.set", () => ({ value: undefined }));
  on("store.keys", () => ({ value: [] }));
  on("state.get", (_$, e) => {
    const entry = state.get(`${e.plugin}.${e.key}.${e.id ?? ""}`);
    return { value: { value: entry?.value, version: entry?.version ?? 0 } };
  });
  on("state.set", (_$, e) => {
    const key = `${e.plugin}.${e.key}.${e.id ?? ""}`;
    const version = (state.get(key)?.version ?? 0) + 1;
    state.set(key, { value: JSON.parse(JSON.stringify(e.value)), version });
    return { value: { isSet: true, version } };
  });
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("session.repo", () => ({ value: null }));
  on("session.root", () => ({ value: WORK }));
  on("session.cwd", () => ({ value: WORK }));
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", () => ({ value: true }));
  on("tool.register", (_$, e) => ({ value: { tool: `mcp__paneline__${e.name}` } }));
  on("tool.check", () => ({ decision: "allow" }));
  on("prompt.submit", (_$, e) => ({ text: e.text }));
  on("turn.complete", (_$, e) => ({ text: e.answer }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("fs.write", (_$, e) => {
    files.set(e.path, e.text);
    return { value: undefined };
  });
  on("fs.list", () => ({
    value: [...files.keys()].map((path) => ({
      name: path.slice(path.lastIndexOf("/") + 1),
      kind: "file",
      size: 0,
      mtimeMs: 0,
      isLink: false,
    })),
  }));
  on("fs.read", (_$, e) => ({ value: files.get(e.path) ?? "" }));
  seedStoredCosts(on, rows, OWN_SESSION);
  on("process.run", (_$, e) => ({ value: aliveOutput(rows, e.argv) }) as never);
  await $.session.start({ cwd: WORK, surface: "terminal", isInteractive: true });
  state.set("paneline.usage.", {
    value: { context: ownContextOf(rows), limits: [] },
    version: (state.get("paneline.usage.")?.version ?? 0) + 1,
  });
  await measureOwnCost($, rows, OWN_SESSION);
}

let settleCostReads: () => Promise<void> = async () => {};

function ownContextOf(rows: SessionRow[]): number | null {
  const own = rows.find((row) => row.sessionId === OWN_SESSION);
  return (own?.usd ?? 0) > 0 ? (own?.ctx ?? null) : null;
}

function aliveOutput(
  rows: SessionRow[],
  argv: readonly string[],
): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  const [command = "", ...args] = argv;
  const alive = new Set(rows.map((row) => row.pid));
  const stdout =
    command === "ps"
      ? (args[1] ?? "")
          .split(",")
          .map(Number)
          .filter((pid) => alive.has(pid))
          .map((pid) => `${pid} claude\n`)
          .join("")
      : "";
  return { exitCode: 0, stdout, stderr: "" };
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
      scroll: { offset: 0, bodyRows: PANE_ROWS },
      view: {},
    },
    viewport: { columns, rows: PANE_ROWS },
  });
}

async function sessionsPane($: Engine, columns: number): Promise<Pane> {
  const pane = await mountPane($, columns);
  await showSessions(pane);
  await settleCostReads();
  await pane.redraw();
  return pane;
}

async function showSessions(pane: Pane): Promise<void> {
  for (let press = 0; press < TAB_PRESSES_LIMIT; press += 1) {
    const buttons = await pane.findAll({ type: "Button" });
    const sessionsTab = buttons.find((button) => button.props.label === "Sessions");
    const nextTab = buttons.find((button) => String(button.props.label).includes(NEXT_TAB));
    const target = sessionsTab ?? nextTab;
    if (target === undefined) return;
    await pane.press({ key: target.key ?? "" });
    await pane.redraw();
    if (sessionsTab !== undefined) return;
  }
  expect(false, "Sessions reached through the tab bar").toBe(true);
}

async function screenOf(pane: Pane, columns: number): Promise<string[]> {
  return screenRows(await pane.drawn(), columns).map((line) => line.trim());
}

async function sessionRows(pane: Pane, columns: number): Promise<string[]> {
  return (await screenOf(pane, columns)).filter((line) =>
    STATUS_MARKS.some((mark) => line.startsWith(mark)),
  );
}

async function textNodes(pane: Pane, text: string): Promise<Node[]> {
  return collect(await pane.drawn(), "Text").filter(
    (node) => textOf(node) === text && childrenOf(node).every((child) => child.type !== "Text"),
  );
}

async function weightsOf(pane: Pane, text: string): Promise<boolean[]> {
  return (await textNodes(pane, text)).map((node) => isHeavy(node.props));
}

async function colorsOf(pane: Pane, text: string): Promise<unknown[]> {
  return (await textNodes(pane, text)).map((node) => node.props?.color);
}

async function bodyCellsOf(pane: Pane): Promise<Cell[]> {
  const cells = await cellsOf(pane);
  const costLabelAt = cells
    .map((cell) => cell.ch)
    .join("")
    .indexOf(HEADER_COST);
  return cells.slice(costLabelAt + HEADER_COST.length);
}

async function cellsOf(pane: Pane): Promise<Cell[]> {
  return colouredPieces(await pane.drawn()).flatMap((piece) =>
    [...piece.text].map((ch) => ({ ch, color: piece.color })),
  );
}

function colourOfToken(cells: Cell[], token: string): unknown[] {
  const line = cells.map((cell) => cell.ch).join("");
  const start = line.indexOf(token);
  if (start === -1) return [];
  return cells.slice(start, start + token.length).map((cell) => cell.color);
}

function shownNameOf(row: string): string {
  return /^\S +\S+(?: +\d+[smhd])? +(\S+)/u.exec(row)?.[1] ?? "";
}

function folderOf(row: string): string {
  return (row.slice(2).split(/ {2,}/u)[1] ?? "").replace(/ this$/u, "");
}

async function rawLinesOf(pane: Pane, columns: number): Promise<string[]> {
  return screenRows(await pane.drawn(), columns).map((line) => line.trimEnd().slice(GUTTER_CELLS));
}

function headerLineOf(lines: string[]): string {
  return lines.find((line) => line.includes(HEADER_BRANCH)) ?? "";
}

function sessionLinesOf(lines: string[]): string[] {
  return lines.filter((line) => STATUS_MARKS.some((mark) => line.trimStart().startsWith(mark)));
}
