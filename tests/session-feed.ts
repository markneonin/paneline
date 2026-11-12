import type { On, SessionMessage, ToolUseSummary } from "claude-code";

type Outcome = Record<string, unknown>;
type Called = { tool: string; tool_use_id: string; agentId?: string } & Record<string, unknown>;

export type SessionFeed = {
  hold: (use: ToolUseSummary, agentId?: string) => void;
  say: (row: SessionMessage) => void;
  replace: (use: ToolUseSummary, agentId?: string) => void;
  record: (call: object, outcome: Outcome) => Outcome;
  reads: () => number;
  forgetReads: () => void;
};

export function useOf(call: object, outcome: Outcome): ToolUseSummary {
  const { tool, tool_use_id: id, agentId: _agentId, ...input } = call as Called;
  const text = outcome.text ?? outcome.deny;
  return {
    tool_use_id: id,
    tool,
    input,
    ...(outcome.result === undefined ? {} : { result: outcome.result }),
    ...(typeof text === "string" ? { text } : {}),
    ...(outcome.isError === true || outcome.deny !== undefined ? { isError: true } : {}),
  };
}

export function handbackOf(message: string): ToolUseSummary {
  return { tool_use_id: "handback", tool: "SubagentHandback", input: { message } };
}

export function notificationOf(toolUseId: string, answer: string): SessionMessage {
  const text = [
    "<task-notification>",
    `<task-id>task-${toolUseId}</task-id>`,
    `<tool-use-id>${toolUseId}</tool-use-id>`,
    "<status>completed</status>",
    `<summary>Agent "${toolUseId}" completed</summary>`,
    `<result>${answer}</result>`,
    "</task-notification>",
  ].join("\n");
  return { role: "user", text, toolUses: [] };
}

export function feedSession(on: On): SessionFeed {
  const mainUses: ToolUseSummary[] = [];
  const mainRows: SessionMessage[] = [];
  const agentUses = new Map<string, ToolUseSummary[]>();
  let reads = 0;

  on("session.messages", (_$, e) => {
    reads += 1;
    if (e.agentId === undefined)
      return { value: [{ role: "assistant", text: "", toolUses: mainUses }, ...mainRows] };
    const uses = agentUses.get(e.agentId);
    if (uses === undefined) return { value: { deny: `no agent ${e.agentId}` } };
    return { value: [{ role: "assistant", text: "", toolUses: uses }] };
  });

  const hold = (use: ToolUseSummary, agentId?: string): void => {
    if (agentId === undefined) mainUses.push(use);
    else agentUses.set(agentId, [...(agentUses.get(agentId) ?? []), use]);
  };

  return {
    hold,
    say: (row) => void mainRows.push(row),
    replace: (use, agentId) => {
      const list = agentId === undefined ? mainUses : (agentUses.get(agentId) ?? []);
      const at = list.findIndex((held) => held.tool_use_id === use.tool_use_id);
      if (at >= 0) list[at] = use;
      else hold(use, agentId);
    },
    record: (call, outcome) => {
      hold(useOf(call, outcome), (call as Called).agentId);
      return outcome;
    },
    reads: () => reads,
    forgetReads: () => {
      reads = 0;
    },
  };
}
