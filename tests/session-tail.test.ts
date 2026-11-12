import { describe, expect, test } from "claude-code/testing";

import { sessionTailOf } from "../hooks/session-tail";
import type { SessionTail } from "../hooks/session-tail";

const TOOL_AT = 1_700_000_000_000;
const EMPTY_TAIL: SessionTail = { prompt: null, model: null, tool: null };

describe("session transcript tail", () => {
  test("D1 a tail with two last-prompt lines gives the later prompt as one line", () => {
    const text = jsonl(
      { type: "last-prompt", lastPrompt: "first prompt" },
      { type: "last-prompt", lastPrompt: "fix the billing bug\nand add a test" },
    );

    expect(sessionTailOf(text).prompt).toBe("fix the billing bug");
  });

  test("D2 the model is the last assistant row's model and a synthetic row after it does not replace it", () => {
    const text = jsonl(
      assistant("claude-sonnet-5-5"),
      assistant("claude-opus-5-5"),
      assistant("<synthetic>"),
    );

    expect(sessionTailOf(text).model).toBe("claude-opus-5-5");
  });

  test("D3 an unanswered Bash tool call is the current tool and an answered one is not", () => {
    const pending = jsonl(assistant("claude-opus-5-5", [bashUse("t1")], TOOL_AT));
    const answered = jsonl(
      assistant("claude-opus-5-5", [bashUse("t1")], TOOL_AT),
      toolResult("t1"),
    );

    expect(sessionTailOf(pending).tool).toEqual({ name: "Bash", since: TOOL_AT });
    expect(sessionTailOf(answered).tool).toBeNull();
  });

  test("D4 with two parallel tool calls and the first answered the second one is the current tool", () => {
    const text = jsonl(
      assistant("claude-opus-5-5", [bashUse("t1"), toolUse("t2", "Read")], TOOL_AT),
      toolResult("t1"),
    );

    expect(sessionTailOf(text).tool).toEqual({ name: "Read", since: TOOL_AT });
  });

  test("D5 a cut first line, a line that is not JSON and a sidechain tool call are skipped", () => {
    const text = [
      '{"type":"assistant","message":{"model":"claude-op',
      "not json at all",
      JSON.stringify({
        ...assistant("claude-haiku-5", [bashUse("side")], TOOL_AT),
        isSidechain: true,
      }),
      JSON.stringify({ type: "last-prompt", lastPrompt: "still read" }),
    ].join("\n");

    expect(sessionTailOf(text)).toEqual({ ...EMPTY_TAIL, prompt: "still read" });
  });

  test("D6 a prompt typed after the last last-prompt row is the prompt", () => {
    const text = jsonl(
      { type: "last-prompt", lastPrompt: "first prompt" },
      typed("the newest typed prompt\nwith a second line"),
    );

    expect(sessionTailOf(text).prompt).toBe("the newest typed prompt");
  });

  test("D7 a prompt typed as text blocks is the prompt, and a tool result, a subagent row and a meta row after it are not", () => {
    const text = jsonl(
      { type: "last-prompt", lastPrompt: "first prompt" },
      {
        type: "user",
        message: { role: "user", content: [{ type: "text", text: "typed in blocks" }] },
      },
      assistant("claude-opus-5-5", [bashUse("t1")], TOOL_AT),
      toolResult("t1"),
      { ...typed("from a subagent"), isSidechain: true },
      { ...typed("injected by a hook"), isMeta: true },
    );

    expect(sessionTailOf(text).prompt).toBe("typed in blocks");
  });
});

function typed(text: string): Record<string, unknown> {
  return { type: "user", message: { role: "user", content: text } };
}

function jsonl(...rows: unknown[]): string {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function assistant(model: string, content: unknown[] = [], at = 0): Record<string, unknown> {
  return {
    type: "assistant",
    timestamp: new Date(at).toISOString(),
    message: { model, content },
  };
}

function toolUse(id: string, name: string): unknown {
  return { type: "tool_use", id, name, input: {} };
}

function bashUse(id: string): unknown {
  return toolUse(id, "Bash");
}

function toolResult(id: string): unknown {
  return {
    type: "user",
    timestamp: new Date(TOOL_AT + 1).toISOString(),
    message: { content: [{ type: "tool_result", tool_use_id: id }] },
  };
}
