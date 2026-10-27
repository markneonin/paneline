import { atom, read, update } from "claude-code";
import type { EngineInterface, On } from "claude-code";

import type { PromptInfo } from "../types";
import { emptySpend } from "./spend-model";

const COLOR_ENTRY = '"type":"agent-color"';

const promptInfoAtom = atom(
  { plugin: "paneline", key: "promptInfo" } as const,
  { model: "", effort: null, cwd: "" } as PromptInfo,
);
const spendAtom = atom({ plugin: "paneline", key: "spend" } as const, emptySpend());
const sessionColorAtom = atom({ plugin: "paneline", key: "sessionColor" } as const, "default");
const transcriptPathAtom = atom({ plugin: "paneline", key: "transcriptPath" } as const, "");

export function trackPromptInfo(on: On): void {
  on("session.start", { isInteractive: true }, async ($, e, next) => {
    await seed($);
    return next(e);
  });

  on(
    "classic.SessionStart",
    { source: ["startup", "resume", "clear", "compact", "fork"] },
    async ($, e, next) => {
      await seed($);
      await refreshColor($, e.transcript_path);
      return next(e);
    },
  );

  on("classic.UserPromptSubmit", async ($, e, next) => {
    await refreshColor($, e.transcript_path);
    await refreshModel($);
    return next(e);
  });

  on("command.run", { command: "color" }, async ($, e, next) => {
    const result = await next(e);
    await refreshColor($, await read($, transcriptPathAtom));
    return result;
  });

  on("command.run", { command: "model" }, async ($, e, next) => {
    const result = await next(e);
    await refreshModel($);
    return result;
  });

  on("classic.PostModelSwitch", async ($, e, next) => {
    await change($, { model: e.to_model });
    await update($, spendAtom, (state) => ({ ...state, mainCacheTtl: e.cache_ttl }));
    return next(e);
  });

  on("classic.CwdChanged", async ($, e, next) => {
    await change($, { cwd: e.new_cwd });
    return next(e);
  });

  on("classic.Stop", async ($, e, next) => {
    if (e.agent_id === undefined) {
      await refreshColor($, e.transcript_path);
      await refreshModel($);
      await change($, { effort: e.effort?.level ?? null });
    }
    return next(e);
  });

  on("classic.PostToolUse", async ($, e, next) => {
    if (e.agent_id === undefined) await change($, { effort: e.effort?.level ?? null });
    return next(e);
  });
}

async function seed($: EngineInterface): Promise<void> {
  await change($, { model: await $.session.model(), cwd: await $.session.cwd() });
}

async function refreshModel($: EngineInterface): Promise<void> {
  await change($, { model: await $.session.model() });
}

async function change($: EngineInterface, patch: Partial<PromptInfo>): Promise<void> {
  const current = await read($, promptInfoAtom);
  const updated = { ...current, ...patch };
  if (
    updated.model === current.model &&
    updated.effort === current.effort &&
    updated.cwd === current.cwd
  )
    return;
  await update($, promptInfoAtom, () => updated);
}

async function refreshColor($: EngineInterface, transcriptPath: string): Promise<void> {
  if (transcriptPath !== (await read($, transcriptPathAtom)))
    await update($, transcriptPathAtom, () => transcriptPath);
  const agentColor = await lastAgentColor($, transcriptPath);
  if (agentColor === undefined || agentColor === (await read($, sessionColorAtom))) return;
  await update($, sessionColorAtom, () => agentColor);
}

function colorOf(line: string): string | undefined {
  try {
    const { agentColor } = JSON.parse(line) as { agentColor?: unknown };
    return typeof agentColor === "string" ? agentColor : undefined;
  } catch {
    return undefined;
  }
}

async function lastAgentColor(
  $: EngineInterface,
  transcriptPath: string,
): Promise<string | undefined> {
  try {
    const { stdout } = await $.process.run(["grep", "-a", COLOR_ENTRY, transcriptPath]);
    return stdout
      .trimEnd()
      .split("\n")
      .reverse()
      .map(colorOf)
      .find((color) => color !== undefined);
  } catch {
    return undefined;
  }
}
