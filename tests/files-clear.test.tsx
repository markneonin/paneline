import { describe, expect, test } from "claude-code/testing";

import {
  clearButtonsOf,
  editFile,
  headingLineOf,
  isDim,
  landCommit,
  lines,
  paneOnTab,
  pressClear,
  readFile,
  spawnAgent,
  texts,
  worldOf,
} from "./clear-world";

const EMPTY_TEXT = "No files touched yet.";
const AGENT_EDIT_BATCH_MS = 1_000;

describe("files clear button", () => {
  test("F1 after some files were touched the Files heading line ends with a dim clear button", async ($, on) => {
    const world = worldOf(on);
    await editFile($, world, "/work/a.ts", 3, 1);

    const pane = await paneOnTab($, "Files");

    const shown = await lines(pane);
    expect(clearButtonsOf(shown)).toHaveLength(1);
    expect(headingLineOf(shown, "Files")?.parts.at(-1)).toBe(clearButtonsOf(shown)[0]);
    expect(clearButtonsOf(shown).every(isDim)).toBe(true);
  });

  test("F2 with no file touched there is no clear button, it shows after the first edit and goes after the press", async ($, on) => {
    const world = worldOf(on);
    const pane = await paneOnTab($, "Files");
    const beforeAnyFile = clearButtonsOf(await lines(pane)).length;

    await editFile($, world, "/work/a.ts", 3, 1);
    const afterFirstEdit = clearButtonsOf(await lines(pane)).length;
    await pressClear(pane, world);
    const afterPress = clearButtonsOf(await lines(pane)).length;

    expect([beforeAnyFile, afterFirstEdit, afterPress]).toEqual([0, 1, 0]);
  });

  test("F3 pressing clear hides every file, folder and the summary, also a file that was only read", async ($, on) => {
    const world = worldOf(on);
    await readFile($, world, "/work/src/read-only.ts");
    await editFile($, world, "/work/docs/edited.md", 3, 1);
    const pane = await paneOnTab($, "Files");

    await pressClear(pane, world);

    const shown = await texts(pane);
    expect(shown).toContain(EMPTY_TEXT);
    expect(shown.filter((text) => /read-only|edited|src\/|docs\/|changed|▾/.test(text))).toEqual(
      [],
    );
  });

  test("F4 a file touched after the press is listed alone", async ($, on) => {
    const world = worldOf(on);
    await readFile($, world, "/work/a.ts");
    await editFile($, world, "/work/b.ts", 4, 1);
    const pane = await paneOnTab($, "Files");
    await pressClear(pane, world);

    await editFile($, world, "/work/c.ts", 2, 0);

    const shown = await texts(pane);
    expect(shown.filter((text) => text.includes(".ts"))).toEqual([expect.stringMatching(/c\.ts/)]);
    expect(shown).not.toContain(EMPTY_TEXT);
  });

  test("F5 a file edited before and after the press shows only the lines of the edit after it", async ($, on) => {
    const world = worldOf(on);
    await editFile($, world, "/work/m.ts", 10, 4);
    const pane = await paneOnTab($, "Files");
    await pressClear(pane, world);

    await editFile($, world, "/work/m.ts", 3, 1);

    const shown = await texts(pane);
    expect(shown.find((text) => text.includes("m.ts"))).toMatch(/m\.ts \+3 -1$/);
    expect(shown).toContain("1 file changed +3 -1");
  });

  test("F6 a file a subagent edited before the press is gone and one it edits after the press shows with its lines and label", async ($, on) => {
    const world = worldOf(on);
    const agent = await spawnAgent($, world, "alpha");
    await editFile($, world, "/work/before.ts", 5, 1, agent);
    await world.clock.advance(AGENT_EDIT_BATCH_MS);
    const pane = await paneOnTab($, "Files");
    await pressClear(pane, world);

    await editFile($, world, "/work/after.ts", 2, 0, agent);
    await world.clock.advance(AGENT_EDIT_BATCH_MS);

    const shown = await texts(pane);
    expect(shown.some((text) => text.includes("before.ts"))).toBe(false);
    expect(shown.find((text) => text.includes("after.ts"))).toMatch(/after\.ts \+2 -0$/);
    expect(shown).toContain("1 file changed +2 -0");
    expect(shown).toContain("alpha 1 file +2 -0");
  });

  test("F7 a file landed by a git commit before the press is gone and a commit after it shows only its own files", async ($, on) => {
    const world = worldOf(on);
    await landCommit($, world, "git commit -am first", "7\t2\tsrc/early.ts", "head-1");
    const pane = await paneOnTab($, "Files");
    await pressClear(pane, world);

    await landCommit($, world, "git commit -am second", "1\t0\tsrc/late.ts", "head-2");

    const shown = await texts(pane);
    expect(shown.some((text) => text.includes("early.ts"))).toBe(false);
    expect(shown.find((text) => text.includes("late.ts"))).toMatch(/late\.ts \+1 -0$/);
    expect(shown).toContain("1 file changed +1 -0");
  });
});
