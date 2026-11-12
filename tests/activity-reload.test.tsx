import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";
import type { On, SessionMessage } from "claude-code";

import { FLUSH_MS, lines, paneOnTab, texts, worldOf } from "./clear-world";
import type { Pane, World } from "./clear-world";
import { keyOf } from "./skills-tree";

const SESSION_START = { cwd: "/work", surface: "terminal", isInteractive: true } as const;
const SKILL = "Skill";
const READ = "Read";
const ONE_FILE_CHIP = / · 1 file(?: · |$)/;
const UNKNOWN_CALL = "r4-unknown";
const KNOWN_CALL = "r4-known";
const REFUSED_CALL = "r4-refused";
const REFUSED_AGENT = "a2";

describe("activity targets after a plugin reload", () => {
  test("R1 a Skill row recorded with no label shows its skill name after a reload", async ($, on) => {
    const world = worldOf(on);
    answerHost(on, { main: [answerOf(toolUse("r1", SKILL, { skill: "x" }))] });
    await callTool($, { tool: SKILL, tool_use_id: "r1", args: "x" });

    await reload($, world);

    expect(await labelOf(await paneOnTab($, "Activity"), "r1")).toBe("x");
  });

  test("R2 a subagent's Skill row recorded with no label shows its skill name after a reload", async ($, on) => {
    const world = worldOf(on);
    answerHost(on, {
      main: [],
      agents: { a1: [answerOf(toolUse("r2", SKILL, { skill: "x" }))] },
    });
    await callTool($, { tool: SKILL, tool_use_id: "r2", args: "x", agentId: "a1" });
    await world.clock.advance(FLUSH_MS);

    await reload($, world);

    expect(await labelOf(await paneOnTab($, "Activity"), "r2")).toBe("x");
  });

  test("R3 after a reload a row with a label keeps it while an empty row beside it takes its transcript label", async ($, on) => {
    const world = worldOf(on);
    answerHost(on, {
      main: [
        answerOf(
          toolUse("r3-kept", SKILL, { skill: "y" }),
          toolUse("r3-empty", SKILL, { skill: "z" }),
        ),
      ],
    });
    await callTool($, { tool: SKILL, tool_use_id: "r3-kept", skill: "x" });
    await callTool($, { tool: SKILL, tool_use_id: "r3-empty", args: "z" });

    await reload($, world);

    const pane = await paneOnTab($, "Activity");
    expect([await labelOf(pane, "r3-kept"), await labelOf(pane, "r3-empty")]).toEqual(["x", "z"]);
  });

  test("R4 after a reload rows the transcript cannot place stay blank, a refused subagent row stays blank, and a placeable row is filled, with no error", async ($, on) => {
    const world = worldOf(on);
    answerHost(on, {
      main: [answerOf(toolUse(KNOWN_CALL, SKILL, { skill: "x" }))],
      agents: {},
    });
    await callTool($, { tool: SKILL, tool_use_id: UNKNOWN_CALL, args: "u" });
    await callTool($, { tool: SKILL, tool_use_id: KNOWN_CALL, args: "k" });
    await callTool($, {
      tool: SKILL,
      tool_use_id: REFUSED_CALL,
      args: "r",
      agentId: REFUSED_AGENT,
    });
    await world.clock.advance(FLUSH_MS);

    await reload($, world);

    const pane = await paneOnTab($, "Activity");
    expect([
      await labelOf(pane, UNKNOWN_CALL),
      await labelOf(pane, REFUSED_CALL),
      await labelOf(pane, KNOWN_CALL),
    ]).toEqual(["", "", "x"]);
  });

  test("R5 a Read call recorded with no path counts as a file in the chips after a reload", async ($, on) => {
    const world = worldOf(on);
    answerHost(on, {
      main: [answerOf(toolUse("r5", READ, { file_path: "/work/a.ts" }))],
    });
    await callTool($, { tool: READ, tool_use_id: "r5", path: "/work/a.ts" });

    await reload($, world);

    expect(
      (await texts(await paneOnTab($, "Activity"))).some((text) => ONE_FILE_CHIP.test(text)),
    ).toBe(true);
  });
});

function answerHost(
  on: On,
  transcripts: { main: SessionMessage[]; agents?: Record<string, SessionMessage[]> },
): void {
  on("config.list", () => ({ value: [{ key: "theme", value: "dark" }] }) as never);
  on("command.register", () => ({ value: {} }) as never);
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("session.messages", (_$, e) => {
    if (e.agentId === undefined) return { value: transcripts.main };
    const rows = transcripts.agents?.[e.agentId];
    return { value: rows ?? { deny: `no agent ${e.agentId}` } };
  });
}

function toolUse(id: string, tool: string, input: Record<string, unknown>) {
  return { tool_use_id: id, tool, input };
}

function answerOf(...toolUses: ReturnType<typeof toolUse>[]): SessionMessage {
  return { role: "assistant", text: "", toolUses };
}

async function reload($: Engine, world: World): Promise<void> {
  await $.session.start(SESSION_START);
  await world.clock.advance(FLUSH_MS);
}

function callTool($: Engine, call: object): Promise<unknown> {
  return ($.tool.call as (e: object) => Promise<unknown>)(call);
}

async function labelOf(pane: Pane, id: string): Promise<string | undefined> {
  const part = (await lines(pane))
    .flatMap((line) => line.parts)
    .find((node) => keyOf(node) === `call-${id}`);
  const label = part?.props?.label;
  return typeof label === "string" ? label : undefined;
}
