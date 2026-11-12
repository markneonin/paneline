import { describe, expect, test } from "claude-code/testing";

import {
  API_KEY,
  RENT_TITLE,
  SONNET,
  blocks,
  callTool,
  lines,
  mainTurn,
  readFile,
  rentRowsOf,
  setSessionCost,
  spawnAgent,
  spendPane,
  totalsOf,
  worldOf,
} from "./spend-world";
import type { Pane } from "./spend-world";

const CHARS_PER_TOKEN = 4;
const SESSION_COST = 1;

describe("spend context rent", () => {
  test("R1 a main-loop Read result of 40k characters shows a Read row with the file name and 10k, and the third total reads ~10k", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await readFile($, world, "/work/hooks/mcp-draw.tsx", 40_000);
    await setSessionCost($, world, SESSION_COST);

    const pane = await spendPane($);

    const block = await rentIn(pane);

    const [row] = rentRowsOf(block);
    expect(rentRowsOf(block)).toHaveLength(1);
    expect(row?.tool).toBe("Read");
    expect(row?.target).toContain("mcp-draw.tsx");
    expect(row?.size).toBe("10k");
    expect(totalsOf(await lines(pane))?.rent).toBe("~10k");
  });

  test("R2 an MCP tool result of 24.4k characters shows an MCP row with context7 · query-docs and 6.1k", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await callTool($, world, {
      tool: "mcp__context7__query-docs",
      input: {},
      reply: { text: "x".repeat(24_400) },
    });

    const block = await rentIn(await spendPane($));

    expect(rentRowsOf(block)).toEqual([
      { tool: "MCP", target: "context7 · query-docs", size: "6.1k" },
    ]);
  });

  test("R3 a tool of a plugin MCP server shows the server as plugin:runpod:runpod", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await callTool($, world, {
      tool: "mcp__plugin_runpod_runpod__list-pods",
      input: {},
      reply: { text: "x".repeat(8_000) },
    });

    const block = await rentIn(await spendPane($));

    expect(rentRowsOf(block)).toEqual([
      { tool: "MCP", target: "plugin:runpod:runpod · list-pods", size: "2k" },
    ]);
  });

  test("R4 the Agent tool's report of 8k characters is listed under Agent with 2k", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await callTool($, world, {
      tool: "Agent",
      input: { description: "scan repo" },
      reply: { text: "x".repeat(8_000) },
    });

    const block = await rentIn(await spendPane($));

    expect(rentRowsOf(block)).toEqual([{ tool: "Agent", target: "scan repo", size: "2k" }]);
  });

  test("R5 a tool result that errored is listed", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await callTool($, world, {
      tool: "Read",
      input: { file_path: "/work/missing.ts" },
      reply: { text: "x".repeat(4_000), isError: true },
    });

    const block = await rentIn(await spendPane($));

    expect(rentRowsOf(block).map((row) => [row.tool, row.size])).toEqual([["Read", "1k"]]);
  });

  test("R6 the same file read twice makes two rows and the third total reads ~2k", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await readFile($, world, "/work/a.ts", 4_000);
    await readFile($, world, "/work/a.ts", 4_000);
    await setSessionCost($, world, SESSION_COST);

    const pane = await spendPane($);

    const block = await rentIn(pane);

    expect(rentRowsOf(block).map((row) => [row.tool, row.size])).toEqual([
      ["Read", "1k"],
      ["Read", "1k"],
    ]);
    expect(totalsOf(await lines(pane))?.rent).toBe("~2k");
  });

  test("R7 a subagent's tool result is not listed and the Biggest tool results block is absent", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const agentId = await spawnAgent($, world, "implementer");
    await readFile($, world, "/work/a.ts", 40_000, agentId);

    const block = await rentIn(await spendPane($));

    expect(block).toBeUndefined();
  });

  test("R8 a denied call is not listed and the Biggest tool results block is absent", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await callTool($, world, {
      tool: "Read",
      input: { file_path: "/work/secret.env" },
      reply: { deny: "not allowed" },
    });

    const block = await rentIn(await spendPane($));

    expect(block).toBeUndefined();
  });

  test("R9 seven Reads of 1k to 7k tokens show the five biggest first while the third total counts all seven as ~28k", async ($, on) => {
    const world = worldOf(on, API_KEY);
    for (const thousands of [3, 1, 7, 5, 2, 6, 4]) {
      await readFile($, world, `/work/f${thousands}.ts`, thousands * 1_000 * CHARS_PER_TOKEN);
    }
    await setSessionCost($, world, SESSION_COST);

    const pane = await spendPane($);

    const block = await rentIn(pane);

    expect(rentRowsOf(block).map((row) => row.size)).toEqual(["7k", "6k", "5k", "4k", "3k"]);
    expect(totalsOf(await lines(pane))?.rent).toBe("~28k");
  });

  test("R13 a session with no tool results shows 0 over result tokens, not ~0", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await mainTurn($, world, { model: SONNET, tokens: { input: 50_000 } });
    await setSessionCost($, world, SESSION_COST);

    const pane = await spendPane($);

    expect(totalsOf(await lines(pane))?.rent).toBe("0");
  });

  test("R10 a Read of a file inside the session folder shows the path relative to it, src/big_catalog.py", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await readFile($, world, "/work/src/big_catalog.py", 40_000);

    const block = await rentIn(await spendPane($));

    expect(rentRowsOf(block)).toMatchObject([{ tool: "Read", target: "src/big_catalog.py" }]);
  });

  test("R11 an Edit of a file inside the session folder shows the path relative to it, src/big_catalog.py", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await callTool($, world, {
      tool: "Edit",
      input: { file_path: "/work/src/big_catalog.py", old_string: "a", new_string: "b" },
      reply: { text: "x".repeat(8_000) },
    });

    const block = await rentIn(await spendPane($));

    expect(rentRowsOf(block)).toMatchObject([{ tool: "Edit", target: "src/big_catalog.py" }]);
  });

  test("R12 a Read outside the session folder keeps its full path, also when the folder name only starts the same", async ($, on) => {
    const world = worldOf(on, API_KEY);
    await readFile($, world, "/other/lib/big_catalog.py", 40_000);
    await readFile($, world, "/workshop/notes.md", 20_000);

    const block = await rentIn(await spendPane($));

    expect(rentRowsOf(block).map((row) => row.target)).toEqual([
      "/other/lib/big_catalog.py",
      "/workshop/notes.md",
    ]);
  });
});

async function rentIn(pane: Pane) {
  return (await blocks(pane))[RENT_TITLE];
}
