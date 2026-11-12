import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

import { failingEdit, failedEditWorldOf, failingCommand } from "./failed-edit-world";
import { headingLineOf, lines, paneOnTab, settle, texts } from "./clear-world";
import type { Pane } from "./clear-world";
import { blockOf, textsIn } from "./activity-block";

const EDIT_FILTER = "Edit";
const ZQ_FILTER = "zq";
const NO_MATCH_FILTER = "nothing-matches";
const ONE_ERROR = 1;
const NOW = 200_000;
const WORK = "/work";
const FAILING_PREFIX = "boom";
const MATCHED_FAILURE = "boom zq";
const MATCHED_READ = "/work/zq-notes.md";
const OTHER_FAILURE = "boom build-";
const OTHER_EDIT = "/work/src/file-";
const OTHER_COUNT = 4;
const CHIP_LINE = /^(?:\d+ms|\d+s|\d+m \d{2}s) · \d+ tools?/;
const ERROR_COUNT = /(\d+) errors?$/;
const MIX_COUNT = /([A-Za-z]+) (\d+)/g;
const TOOLS_CHIP = /\d+ tools?\b/;
const SIGNED_CHIP = /[+−]\d/;

describe("activity error count under a filter", () => {
  test("G1 a filter that matches one of three failed calls counts 1 error in the header and lists only that call", async ($, on) => {
    failedEditWorldOf(on);
    await failingCommand($, "fail-1");
    await failingCommand($, "fail-2");
    await failingEdit($, "edit-1", "/work/p.txt");

    const pane = await paneOnTab($, "Activity");
    await filterBy(pane, EDIT_FILTER);

    expect(await errorCountOf(pane)).toBe(ONE_ERROR);
    expect(await failedRowKeys(pane)).toEqual(["failed-edit-1"]);
  });

  test("F1 a filter matching two of ten calls counts 2 tools and 1 error in the chip line and lists only Read 1 and Bash 1 in the Tool mix", async ($, on) => {
    filterWorldOf(on);
    await readMatched($);
    await failingBashMatched($);
    await failingOthers($);
    await editsOthers($);

    const pane = await paneOnTab($, "Activity");
    await filterBy(pane, ZQ_FILTER);

    const chip = await chipLineOf(pane);
    expect(chip).toMatch(/· 2 tools · 1 file · 1 error$/);
    expect(chip).not.toMatch(SIGNED_CHIP);
    expect(mixCountsOf(blockOf(await lines(pane), "Tool mix"))).toEqual(["Bash 1", "Read 1"]);
  });

  test("F1b a filter matching two failures of one repeated Bash command counts 2 tools and 2 errors and shows Failed once with 2 fails", async ($, on) => {
    filterWorldOf(on);
    await failingBash($, MATCHED_FAILURE, "f1b-1");
    await failingBash($, MATCHED_FAILURE, "f1b-2");
    await $.tool.call({ tool: "Bash", command: "echo ok", tool_use_id: "f1b-ok" } as never);

    const pane = await paneOnTab($, "Activity");
    await filterBy(pane, ZQ_FILTER);

    expect(await chipLineOf(pane)).toMatch(/· 2 tools · 2 errors$/);
    const failed = textsIn(blockOf(await lines(pane), "Failed")).filter((text) =>
      text.includes(MATCHED_FAILURE),
    );
    expect(failed).toHaveLength(1);
    expect(failed[0]).toContain("2 fails");
  });

  test("F3 a filter that matches no call shows no tools count in the chip line and no Tool mix block", async ($, on) => {
    filterWorldOf(on);
    await readMatched($);
    await failingBashMatched($);
    await failingOthers($);
    await editsOthers($);

    const pane = await paneOnTab($, "Activity");
    await filterBy(pane, NO_MATCH_FILTER);

    expect((await texts(pane)).some((text) => TOOLS_CHIP.test(text))).toBe(false);
    expect(headingLineOf(await lines(pane), "Tool mix")).toBeUndefined();
  });
});

function filterWorldOf(on: On): void {
  mock.clock(on, { now: NOW });
  mock.env(on, { HOME: "/h/u" });
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("fs.exists", () => ({ value: true }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: WORK }));
  on("settings.read", () => ({ value: {} }));
  on("agent.list", () => ({ value: [] }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("turn.complete", (_$, e) => ({ text: e.answer }));
  on("tool.call", (_$, e) => {
    const call = e as unknown as { tool: string; command?: string };
    if (call.tool === "Bash" && call.command?.startsWith(FAILING_PREFIX))
      return { isError: true, result: "boom", text: "boom" } as never;
    if (call.tool === "Edit")
      return { result: { structuredPatch: [{ lines: ["+x", "-x"] }] }, text: "edited" };
    return { result: "ok", text: "ok" };
  });
}

async function readMatched($: Engine): Promise<void> {
  await $.tool.call({ tool: "Read", file_path: MATCHED_READ, tool_use_id: "f1-read" } as never);
}

async function failingBashMatched($: Engine): Promise<void> {
  await failingBash($, MATCHED_FAILURE, "f1-bash");
}

async function failingOthers($: Engine): Promise<void> {
  for (let i = 1; i <= OTHER_COUNT; i++)
    await failingBash($, `${OTHER_FAILURE}${i}`, `f1-fail-${i}`);
}

async function editsOthers($: Engine): Promise<void> {
  for (let i = 1; i <= OTHER_COUNT; i++)
    await $.tool.call({
      tool: "Edit",
      file_path: `${OTHER_EDIT}${i}.ts`,
      old_string: "a",
      new_string: "b",
      tool_use_id: `f1-edit-${i}`,
    } as never);
}

function failingBash($: Engine, command: string, id: string): Promise<unknown> {
  return $.tool.call({ tool: "Bash", command, tool_use_id: id } as never);
}

async function filterBy(pane: Pane, text: string): Promise<void> {
  await pane.input({ key: "filter", text, kind: "change" });
  await settle(pane);
}

async function chipLineOf(pane: Pane): Promise<string> {
  return (await texts(pane)).find((text) => CHIP_LINE.test(text)) ?? "";
}

async function errorCountOf(pane: Pane): Promise<number> {
  return Number(ERROR_COUNT.exec(await chipLineOf(pane))?.[1]);
}

function mixCountsOf(block: ReturnType<typeof blockOf>): string[] {
  return textsIn(block)
    .flatMap((text) => [...text.matchAll(MIX_COUNT)])
    .map((match) => `${match[1]} ${match[2]}`)
    .sort();
}

async function failedRowKeys(pane: Pane): Promise<string[]> {
  return (await pane.findAll({ type: "Button" }))
    .map((button) => String(button.key))
    .filter((key) => key.startsWith("failed-"));
}
