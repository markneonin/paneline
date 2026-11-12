import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";

import {
  API_KEY,
  HAIKU,
  OPUS,
  RENT_TITLE,
  SONNET,
  SPLIT_TITLE,
  agentOwner,
  blocks,
  lines,
  mainTurn,
  readFile,
  setSessionCost,
  settle,
  spendPane,
  startFreshSession,
  worldOf,
} from "./spend-world";
import type { Pane, World } from "./spend-world";
import type { Block, Line } from "./skills-tree";
import { keyOf } from "./skills-tree";
import { feedSession } from "./session-feed";
import type { SessionFeed } from "./session-feed";

const SESSION_COST = 6;
const AGENT_RUN = { input: 200_000, output: 20_000 };
const MAIN_RUN = { input: 100_000, output: 10_000 };
const BIG_READ_CHARS = 40_000;
const SMALL_READ_CHARS = 8_000;
const SPEND_DRAW = "hooks/spend-draw.tsx";
const SPEND_DRAW_PATH = `/work/${SPEND_DRAW}`;
const MCP_DRAW_PATH = "/work/hooks/mcp-draw.tsx";
const OLD_FILE = "old-notes.ts";
const NEW_FILE = "new-notes.ts";
const GENERAL = "general-purpose";
const EXPLORE = "Explore";
const BACK = "back";
const SPEND_STATE_PREFIX = "paneline.spend.";

type SavedRent = { tool: string; target: string; tokens: number; callId?: string };

describe("spend rows open their detail", () => {
  test("SCL1 pressing general-purpose in Where it went opens that agent's detail in the Agents tab", async ($, on) => {
    const world = worldOf(on, API_KEY);
    feedSession(on);
    await startFreshSession($, world);
    await mainTurn($, world, { model: OPUS, tokens: MAIN_RUN });
    await agentOwner($, world, GENERAL, SONNET, AGENT_RUN);
    await setSessionCost($, world, SESSION_COST);
    const pane = await spendPane($);

    await pressRow(pane, SPLIT_TITLE, GENERAL);

    const shown = await lines(pane);
    expect(await blocks(pane)).not.toHaveProperty(SPLIT_TITLE);
    expect(shown.some((line) => hasBack(line) && line.text.includes(GENERAL))).toBe(true);
  });

  test("SCL2 pressing an Explore row that holds two agents opens the Agents tab list", async ($, on) => {
    const world = worldOf(on, API_KEY);
    feedSession(on);
    await startFreshSession($, world);
    await mainTurn($, world, { model: OPUS, tokens: MAIN_RUN });
    await agentOwner($, world, EXPLORE, SONNET, AGENT_RUN);
    await agentOwner($, world, EXPLORE, SONNET, AGENT_RUN);
    await setSessionCost($, world, SESSION_COST);
    const pane = await spendPane($);

    await pressRow(pane, SPLIT_TITLE, EXPLORE);

    const shown = await lines(pane);
    expect(await blocks(pane)).not.toHaveProperty(SPLIT_TITLE);
    expect(shown.filter((line) => titles(line, EXPLORE))).toHaveLength(2);
    expect(shown.some(hasBack)).toBe(false);
  });

  test("SCL3 main · haiku 5.5 and background rows draw as plain text, with no button", async ($, on) => {
    const world = worldOf(on, API_KEY);
    feedSession(on);
    await startFreshSession($, world);
    await mainTurn($, world, { model: HAIKU, tokens: MAIN_RUN });
    await agentOwner($, world, GENERAL, SONNET, AGENT_RUN);
    await setSessionCost($, world, SESSION_COST);

    const split = (await blocks(await spendPane($)))[SPLIT_TITLE];

    expect(buttonOf(rowOf(split, "main"))).toBeUndefined();
    expect(buttonOf(rowOf(split, "background"))).toBeUndefined();
    expect(buttonOf(rowOf(split, GENERAL))).toBeDefined();
  });

  test("SCL4 pressing the Read hooks/spend-draw.tsx row in Biggest tool results opens that call's details in Activity", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const feed = feedSession(on);
    await readHeld($, world, feed, SPEND_DRAW_PATH, BIG_READ_CHARS);
    await readHeld($, world, feed, MCP_DRAW_PATH, SMALL_READ_CHARS);
    const pane = await spendPane($);

    await pressRow(pane, RENT_TITLE, SPEND_DRAW);

    const shown = await lines(pane);
    expect(await blocks(pane)).not.toHaveProperty(RENT_TITLE);
    expect(shown.some(hasBack)).toBe(true);
    expect(shown.some((line) => line.text.includes(SPEND_DRAW))).toBe(true);
    expect(shown.some((line) => line.text.includes("mcp-draw.tsx"))).toBe(false);
  });

  test("SCL5 a tool-result row restored from a saved session with no call id draws as plain text", async ($, on) => {
    const world = worldOf(on, API_KEY);
    const feed = feedSession(on);
    await readHeld($, world, feed, `/work/${OLD_FILE}`, BIG_READ_CHARS);
    await readHeld($, world, feed, `/work/${NEW_FILE}`, SMALL_READ_CHARS);
    forgetCallId(world, OLD_FILE);

    const rent = (await blocks(await spendPane($)))[RENT_TITLE];

    expect(rowOf(rent, OLD_FILE)).toBeDefined();
    expect(buttonOf(rowOf(rent, OLD_FILE))).toBeUndefined();
    expect(buttonOf(rowOf(rent, NEW_FILE))).toBeDefined();
  });
});

function rowOf(block: Block | undefined, name: string): Line | undefined {
  return block?.rows.find((line) => line.text.includes(name));
}

function buttonOf(line: Line | undefined) {
  return line?.parts.find((part) => part.type === "Button");
}

function titles(line: Line, name: string): boolean {
  const named = new RegExp(`(^|\\s)${name}(\\s|$)`);
  return line.parts.some((part) => part.type === "Button" && named.test(String(part.props?.label)));
}

function hasBack(line: Line): boolean {
  return line.parts.some((part) => part.type === "Button" && part.props?.label === BACK);
}

async function pressRow(pane: Pane, title: string, name: string): Promise<void> {
  const row = rowOf((await blocks(pane))[title], name);
  const button = buttonOf(row);
  expect(button, `a button in the "${name}" row`).toBeDefined();
  await pane.press({ key: keyOf(button) });
  await settle(pane);
}

async function readHeld(
  $: Engine,
  world: World,
  feed: SessionFeed,
  path: string,
  chars: number,
): Promise<void> {
  const text = "x".repeat(chars);
  feed.hold({
    tool_use_id: `call-${world.calls + 1}`,
    tool: "Read",
    input: { file_path: path },
    result: text,
    text,
  });
  await readFile($, world, path, chars);
}

function forgetCallId(world: World, file: string): void {
  for (const [key, entry] of world.state) {
    if (!key.startsWith(SPEND_STATE_PREFIX)) continue;
    const saved = entry.value as { rent: SavedRent[] };
    const rent = saved.rent.map((row) => (row.target.includes(file) ? withoutCallId(row) : row));
    world.state.set(key, { ...entry, value: { ...saved, rent } });
  }
}

function withoutCallId({ callId: _forgotten, ...row }: SavedRent): SavedRent {
  return row;
}
