import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

const NOW = 200_000;
const FOLDER = "/work";
const SKILL = "commit";
const MCP_TOOL = "mcp__docs__search";
const QUIET_TICKS = 50_000;

type World = {
  hangWrites: () => void;
  failNextWrite: () => void;
  stored: (key: string) => unknown;
  state: (key: string) => unknown;
  logs: string[];
};

describe("store writes never block a hook", () => {
  test("W1 a skill prompt returns while the store write never finishes", async ($, on) => {
    const world = worldOf(on);
    await startIn($);
    world.hangWrites();

    const outcomes = [await raceHang($, usePrompt), await raceHang($, usePrompt)];

    expect(outcomes).toEqual(["returned", "returned"]);
  });

  test("W2 an MCP tool call counts its use while the store write never finishes", async ($, on) => {
    const world = worldOf(on);
    await startIn($);
    world.hangWrites();

    useTool($).catch(() => undefined);
    await quietTicks();

    expect(world.state("toolUses")).toEqual({ [MCP_TOOL]: 1 });
  });

  test("W3 a compact session start returns while the store write never finishes", async ($, on) => {
    const world = worldOf(on);
    await startIn($);
    world.hangWrites();

    const outcomes = [await raceHang($, compactStart), await raceHang($, compactStart)];

    expect(outcomes).toEqual(["returned", "returned"]);
  });

  test("W4 a failed write is reported and written again with the next use", async ($, on) => {
    const world = worldOf(on);
    await startIn($);
    world.failNextWrite();

    await usePrompt($);
    await settle();
    const reported = world.logs.length;
    await usePrompt($);
    await settle();

    expect(reported).toBeGreaterThan(0);
    expect(world.stored("skillUses")).toEqual({ [FOLDER]: { [SKILL]: 2 } });
  });

  test("W5 uses made while the store is slow are all written once it answers", async ($, on) => {
    const world = worldOf(on);
    await startIn($);

    await usePrompt($);
    await usePrompt($);
    await usePrompt($);
    await settle();

    expect(world.stored("skillUses")).toEqual({ [FOLDER]: { [SKILL]: 3 } });
  });
});

async function raceHang(
  $: Engine,
  action: ($: Engine) => Promise<unknown>,
): Promise<"returned" | "hung"> {
  return Promise.race([
    action($).then(
      () => "returned" as const,
      () => "returned" as const,
    ),
    quietTicks().then(() => "hung" as const),
  ]);
}

async function quietTicks(): Promise<void> {
  for (let tick = 0; tick < QUIET_TICKS; tick++) await Promise.resolve();
}

async function settle(): Promise<void> {
  await quietTicks();
}

async function startIn($: Engine): Promise<void> {
  await $.session.start({ cwd: FOLDER, surface: "terminal", isInteractive: true });
}

async function usePrompt($: Engine): Promise<unknown> {
  return $.skill.prompt({ skill: SKILL, text: `Run ${SKILL}.` });
}

async function useTool($: Engine): Promise<unknown> {
  const call = $.tool.call as (event: object) => Promise<unknown>;
  return call({ tool: MCP_TOOL, tool_use_id: "call-1" });
}

async function compactStart($: Engine): Promise<unknown> {
  return $.classic.SessionStart({ source: "compact" } as never);
}

function worldOf(on: On): World {
  const kept = new Map<string, unknown>();
  const logs: string[] = [];
  let isHanging = false;
  let isFailingNext = false;
  mock.clock(on, { now: NOW });
  mock.env(on, { HOME: "/h/u" });
  const states = new Map<string, { value: unknown; version: number }>();
  on("state.get", (_$, e) => ({
    value: states.get(e.key) ?? { value: undefined, version: 0 },
  }));
  on("state.set", (_$, e) => {
    const version = (states.get(e.key)?.version ?? 0) + 1;
    states.set(e.key, { value: e.value, version });
    return { value: { isSet: true, version } };
  });
  on("store.get", (_$, e) => ({ value: kept.get(e.key) }));
  on("store.set", async (_$, e) => {
    if (isHanging) await new Promise(() => undefined);
    if (isFailingNext) {
      isFailingNext = false;
      throw new Error("Lock file is already being held");
    }
    kept.set(e.key, JSON.parse(JSON.stringify(e.value)));
    return { value: undefined };
  });
  on("store.keys", () => ({ value: [...kept.keys()] }));
  on("store.delete", () => ({ value: undefined }));
  on("ui.log", (_$, e) => {
    logs.push(e.text);
    return { value: undefined };
  });
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("session.id", () => ({ value: "session-1" }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: FOLDER }));
  on("command.register", () => ({ value: {} }) as never);
  on("agent.list", () => ({ value: [] }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", () => ({
    value: { startedAt: NOW, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("config.list", () => ({ value: [{ key: "theme", value: "dark" }] }) as never);
  on("settings.read", () => ({ value: {} }));
  on("fs.exists", () => ({ value: false }));
  on("fs.read", () => ({ value: undefined }) as never);
  on("fs.write", () => ({ value: undefined }));
  on("session.repo", () => ({ value: null }));
  on("session.root", () => ({ value: FOLDER }));
  on("skill.prompt", (_$, e) => ({ text: e.text }));
  on("tool.call", () => ({ result: "ok", text: "ok", ref: 1 }));
  on("classic.SessionStart", () => ({}));
  return {
    hangWrites: () => {
      isHanging = true;
    },
    failNextWrite: () => {
      isFailingNext = true;
    },
    stored: (key) => kept.get(key),
    state: (key) => states.get(key)?.value,
    logs,
  };
}
