import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";

import { headingLineOf, lines, paneOnTab, runCommand, texts, worldOf } from "./clear-world";
import type { Pane } from "./clear-world";
import type { Line } from "./skills-tree";
import { failingEdit, failedEditWorldOf } from "./failed-edit-world";

const FIVE = 5;
const SIX = 6;
const TWELVE = 12;
const MORE_SIX = "▸ 1 more failed";
const MORE_TWELVE = "▸ 7 more failed";
const NEWEST_FIVE_OF_SIX = ["failed-f-5", "failed-f-4", "failed-f-3", "failed-f-2", "failed-f-1"];
const NEWEST_FIVE_OF_TWELVE = [
  "failed-f-11",
  "failed-f-10",
  "failed-f-9",
  "failed-f-8",
  "failed-f-7",
];
const ALL_FIVE = ["failed-f-4", "failed-f-3", "failed-f-2", "failed-f-1", "failed-f-0"];

describe("activity failed list", () => {
  test("A1 six failed calls show the five newest failed rows, then ▸ 1 more failed", async ($, on) => {
    failedEditWorldOf(on);
    await failCalls($, SIX);

    const pane = await paneOnTab($, "Activity");

    expect(await failedRowKeys(pane)).toEqual(NEWEST_FIVE_OF_SIX);
    const under = failedLinesOf(await lines(pane));
    expect(under).toHaveLength(FIVE + 1);
    expect(under.at(-1)).toBe(MORE_SIX);
  });

  test("A2 twelve failed calls show the five newest failed rows, then ▸ 7 more failed", async ($, on) => {
    failedEditWorldOf(on);
    await failCalls($, TWELVE);

    const pane = await paneOnTab($, "Activity");

    expect(await failedRowKeys(pane)).toEqual(NEWEST_FIVE_OF_TWELVE);
    const under = failedLinesOf(await lines(pane));
    expect(under).toHaveLength(FIVE + 1);
    expect(under.at(-1)).toBe(MORE_TWELVE);
  });

  test("A3 exactly five failed calls show five failed rows and no more failed line", async ($, on) => {
    failedEditWorldOf(on);
    await failCalls($, FIVE);

    const pane = await paneOnTab($, "Activity");

    expect(await failedRowKeys(pane)).toEqual(ALL_FIVE);
    const under = failedLinesOf(await lines(pane));
    expect(under).toHaveLength(FIVE);
    expect(under.some((text) => text.includes("more failed"))).toBe(false);
  });

  test("A4 with no failed calls the Activity tab has no Failed heading and no more line", async ($, on) => {
    const world = worldOf(on);
    await runCommand($, world, "echo one");
    await runCommand($, world, "echo two");

    const pane = await paneOnTab($, "Activity");

    expect(headingLineOf(await lines(pane), "Failed")).toBeUndefined();
    expect((await texts(pane)).some((text) => text.includes("more"))).toBe(false);
  });

  test("A5 the ▸ 1 more failed line is a dim button", async ($, on) => {
    failedEditWorldOf(on);
    await failCalls($, SIX);

    const pane = await paneOnTab($, "Activity");

    const more = (await pane.findAll({ type: "Button" })).filter(
      (button) => button.props.label === MORE_SIX,
    );
    expect(more).toHaveLength(1);
    expect(more[0]?.props.dimColor).toBe(true);
  });
});

async function failCalls($: Engine, count: number): Promise<void> {
  for (let i = 0; i < count; i++) await failingEdit($, `f-${i}`, `/work/src/f-${i}.ts`);
}

async function failedRowKeys(pane: Pane): Promise<string[]> {
  return (await pane.findAll({ type: "Button" }))
    .map((button) => String(button.key))
    .filter((key) => key.startsWith("failed-"));
}

function failedLinesOf(shown: Line[]): string[] {
  const heading = headingLineOf(shown, "Failed");
  if (heading === undefined) return [];
  const after = shown.slice(shown.indexOf(heading) + 1);
  const end = after.findIndex((line) => line.text === "");
  return (end === -1 ? after : after.slice(0, end)).map((line) => line.text);
}
