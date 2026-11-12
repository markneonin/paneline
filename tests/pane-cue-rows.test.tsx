import { describe, expect, mock, test } from "claude-code/testing";
import type { ElementTable, On, RenderElement } from "claude-code";
import type { Engine } from "claude-code/testing";

import { collect, textOf } from "./draw-tree";
import { linesOf } from "./skills-tree";
import {
  API_KEY,
  OPUS,
  SONNET,
  agentRequest,
  answerPrompts,
  mainTurn,
  openPane,
  sessionWithAllBlocks,
  setSessionCost,
  settle,
  showSpend,
  spawnAgent,
  submitPrompt,
  worldOf,
} from "./spend-world";
import type { Pane, Tokens, World } from "./spend-world";

const COLUMNS = 60;
const PROBE_ROWS = 20;
const PROBE_CONTENT_ROWS = 30;
const PROBE_TAB = "probe";
const SESSION = "session";
const CWD = "/work";
const HOME = "/h/u";
const SHORT_PANE_ROWS = 12;
const FIRST_COST = 13;
const SECOND_COST = 13.5;
const BIG_COST = 20;
const CONTEXT = 100_000;
const AGENT_TOKENS: Tokens = { input: 10_000, output: 5_000 };
const FIRST_TURN: Tokens = { input: 30_000, output: 8_200 };
const SMALL_TURN: Tokens = { input: 5_000, output: 1_000 };
const BIG_TURN: Tokens = { input: 900_000, output: 90_000 };
const FIRST_TURN_MS = 72_000;
const SECOND_TURN_MS = 5_000;

type Turn = { withAgent: boolean; tokens: Tokens; cost: number };

describe("spend scroll cue", () => {
  test("H1a with Spend scrolled to leave rows hidden, a finished turn without subagents after one with a subagent keeps the more lines cue", async ($, on) => {
    const world = fakeWorld(on);
    await sessionWithAllBlocks($, world);
    await finishTurn($, world, { withAgent: true, tokens: FIRST_TURN, cost: FIRST_COST });
    const pane = await scrolledSpend($);
    const before = await cueOf(pane);

    await finishTurn($, world, { withAgent: false, tokens: SMALL_TURN, cost: SECOND_COST });
    await settle(pane);

    expect(before, "the cue shows before the turn ends").toBeDefined();
    expect(await cueOf(pane)).toBe(before);
  });

  test("H1b with Spend scrolled to leave rows hidden, a finished turn that makes main the biggest spender and swaps the two top Where it went rows keeps the more lines cue", async ($, on) => {
    const world = fakeWorld(on);
    await sessionWithAllBlocks($, world);
    await finishTurn($, world, { withAgent: false, tokens: FIRST_TURN, cost: FIRST_COST });
    const pane = await scrolledSpend($);
    const before = await cueOf(pane);

    await finishTurn($, world, { withAgent: false, tokens: BIG_TURN, cost: BIG_COST });
    await settle(pane);

    expect(before, "the cue shows before the turn ends").toBeDefined();
    expect(await cueOf(pane)).toBe(before);
  });

  test("H1c with Spend scrolled to leave rows hidden, a finished turn that gives a subagent its first filled bar cell keeps the more lines cue", async ($, on) => {
    const world = fakeWorld(on);
    await sessionWithAllBlocks($, world);
    await finishTurn($, world, { withAgent: true, tokens: FIRST_TURN, cost: FIRST_COST });
    const pane = await scrolledSpend($);
    const before = await cueOf(pane);

    await finishTurn($, world, { withAgent: true, tokens: SMALL_TURN, cost: SECOND_COST });
    await settle(pane);

    expect(before, "the cue shows before the turn ends").toBeDefined();
    expect(await cueOf(pane)).toBe(before);
  });
});

describe("pane cue row lock", () => {
  test("H3 with the cue showing, a redraw that adds one fixed-height row draws the tab without it", async ($, on) => {
    let rowCount = 3;
    probeWorld(on, ({ Box, Text }) => (
      <Box flexDirection="column">{oneRows(Box, Text, rowCount)}</Box>
    ));
    const pane = await probePane($);
    const before = await cueOf(pane);

    rowCount = 4;
    await settle(pane);

    expect(before, "the cue shows before the redraw").toBeDefined();
    expect(await cueOf(pane)).toBeUndefined();
  });

  test("H4 with the cue showing, a redraw that removes one fixed-height row draws the tab without it", async ($, on) => {
    let rowCount = 4;
    probeWorld(on, ({ Box, Text }) => (
      <Box flexDirection="column">{oneRows(Box, Text, rowCount)}</Box>
    ));
    const pane = await probePane($);
    const before = await cueOf(pane);

    rowCount = 3;
    await settle(pane);

    expect(before, "the cue shows before the redraw").toBeDefined();
    expect(await cueOf(pane)).toBeUndefined();
  });

  test("H5 with the cue showing, a redraw that makes a one-row box two rows tall draws the tab without it", async ($, on) => {
    let height = 1;
    probeWorld(on, ({ Box, Text }) => (
      <Box flexDirection="column">
        <Box key="row" height={height} flexShrink={0}>
          <Text>row</Text>
        </Box>
      </Box>
    ));
    const pane = await probePane($);
    const before = await cueOf(pane);

    height = 2;
    await settle(pane);

    expect(before, "the cue shows before the redraw").toBeDefined();
    expect(await cueOf(pane)).toBeUndefined();
  });
});

describe("pane cue row props", () => {
  test("H6 with the cue showing, a redraw that gives a fixed-height row a top margin draws the tab without it", async ($, on) => {
    let margin = 0;
    probeWorld(on, ({ Box, Text }) => (
      <Box flexDirection="column">
        <Box key="row" height={1} marginTop={margin} flexShrink={0}>
          <Text>row</Text>
        </Box>
      </Box>
    ));
    const pane = await probePane($);
    const before = await cueOf(pane);

    margin = 3;
    await settle(pane);

    expect(before, "the cue shows before the redraw").toBeDefined();
    expect(await cueOf(pane)).toBeUndefined();
  });

  test("H7 with the cue showing, a redraw that gives a fixed-height row a minimum height draws the tab without it", async ($, on) => {
    let minimum = 0;
    probeWorld(on, ({ Box, Text }) => (
      <Box flexDirection="column">
        <Box key="row" height={1} minHeight={minimum} flexShrink={0}>
          <Text>row</Text>
        </Box>
      </Box>
    ));
    const pane = await probePane($);
    const before = await cueOf(pane);

    minimum = 4;
    await settle(pane);

    expect(before, "the cue shows before the redraw").toBeDefined();
    expect(await cueOf(pane)).toBeUndefined();
  });

  test("H8 with the cue showing, a redraw that hides a fixed-height row draws the tab without it", async ($, on) => {
    let display: "flex" | "none" = "flex";
    probeWorld(on, ({ Box, Text }) => (
      <Box flexDirection="column">
        <Box key="row" height={1} display={display} flexShrink={0}>
          <Text>row</Text>
        </Box>
      </Box>
    ));
    const pane = await probePane($);
    const before = await cueOf(pane);

    display = "none";
    await settle(pane);

    expect(before, "the cue shows before the redraw").toBeDefined();
    expect(await cueOf(pane)).toBeUndefined();
  });

  test("H9 with the cue showing, a redraw that swaps two fixed-height items side by side in a row draws the tab without it", async ($, on) => {
    let isSwapped = false;
    probeWorld(on, ({ Box, Text }) => (
      <Box flexDirection="row">{swappedItems(Box, Text, isSwapped)}</Box>
    ));
    const pane = await probePane($);
    const before = await cueOf(pane);

    isSwapped = true;
    await settle(pane);

    expect(before, "the cue shows before the redraw").toBeDefined();
    expect(await cueOf(pane)).toBeUndefined();
  });

  test("H10 with the cue showing, a redraw that swaps two fixed-height rows in a column keeps it", async ($, on) => {
    let isSwapped = false;
    probeWorld(on, ({ Box, Text }) => (
      <Box flexDirection="column">{swappedItems(Box, Text, isSwapped)}</Box>
    ));
    const pane = await probePane($);
    const before = await cueOf(pane);

    isSwapped = true;
    await settle(pane);

    expect(before, "the cue shows before the redraw").toBeDefined();
    expect(await cueOf(pane)).toBe(before);
  });
});

function swappedItems(Box: ElementTable["Box"], Text: ElementTable["Text"], isSwapped: boolean) {
  const narrow = (
    <Box key="narrow" height={1} width={5} flexShrink={0}>
      <Text>a</Text>
    </Box>
  );
  const wide = (
    <Box key="wide" height={1} width={9} flexShrink={0}>
      <Text>b</Text>
    </Box>
  );
  return isSwapped ? [wide, narrow] : [narrow, wide];
}

type Probe = (ui: ElementTable) => RenderElement;

function oneRows(Box: ElementTable["Box"], Text: ElementTable["Text"], count: number) {
  return Array.from({ length: count }, (_, index) => (
    <Box key={`row-${index}`} height={1} flexShrink={0}>
      <Text>{`row ${index}`}</Text>
    </Box>
  ));
}

function probeWorld(on: On, probe: Probe): void {
  mock.clock(on, { now: 200_000 });
  mock.env(on, { HOME });
  on("state.get", (_$, e, next) =>
    e.key === "tab" ? { value: { value: PROBE_TAB, version: 1 } } : next(e),
  );
  on("config.list", () => ({ value: [{ key: "theme", value: "dark" }] }) as never);
  on("store.get", () => ({ value: undefined }));
  on("store.set", () => ({ value: undefined }));
  on("store.delete", () => ({ value: undefined }));
  on("store.keys", () => ({ value: [] }));
  on("classic.SessionStart", () => ({}));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("command.register", () => ({ value: {} }) as never);
  on("agent.list", () => ({ value: [] }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("ui.scroll", () => ({}));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: CWD }));
  on("session.messages", () => ({ value: [] }));
  on("session.id", () => ({ value: "session-one" }));
  on("fs.exists", () => ({ value: false }));
  on("ui.render", { component: "Pane" }, ($, e) => probe($.ui.resolve(e)));
}

async function probePane($: Engine): Promise<Pane> {
  await $.session.start({ cwd: CWD, surface: "terminal", isInteractive: true });
  const pane = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: SESSION,
    props: {
      title: "Session",
      isFocused: false,
      bodyColumns: COLUMNS,
      placement: "dock",
      scroll: { offset: 0, bodyRows: PROBE_ROWS },
      view: {},
    },
    viewport: { columns: COLUMNS, rows: PROBE_ROWS },
  });
  await $.ui.scroll({
    component: "Pane",
    requestId: SESSION,
    offset: 0,
    by: 0,
    bodyRows: PROBE_ROWS,
    contentRows: PROBE_CONTENT_ROWS,
    origin: { kind: "person" },
  });
  await settle(pane);
  return pane;
}

function fakeWorld(on: On): World {
  on("turn.start", (_$, e) => ({ turnId: e.turnId }));
  answerPrompts(on);
  return worldOf(on, API_KEY);
}

async function finishTurn($: Engine, world: World, turn: Turn): Promise<void> {
  await submitPrompt($, world, `turn at ${turn.cost}`);
  if (turn.withAgent) {
    const agentId = await spawnAgent($, world, "implementer");
    await agentRequest($, world, { agentId, model: SONNET, tokens: AGENT_TOKENS, index: 0 });
  }
  await setSessionCost($, world, turn.cost);
  await mainTurn($, world, {
    model: OPUS,
    tokens: turn.tokens,
    context: CONTEXT,
    durationMs: turn.withAgent ? FIRST_TURN_MS : SECOND_TURN_MS,
  });
}

async function scrolledSpend($: Engine): Promise<Pane> {
  const pane = await openPane($, COLUMNS, SHORT_PANE_ROWS);
  await showSpend(pane);
  await $.ui.scroll({
    component: "Pane",
    requestId: "session",
    offset: 0,
    by: 0,
    bodyRows: SHORT_PANE_ROWS,
    contentRows: linesOf(await pane.drawn()).length,
    origin: { kind: "person" },
  });
  await settle(pane);
  return pane;
}

async function cueOf(pane: Pane): Promise<string | undefined> {
  const box = collect(await pane.drawn(), "Box").find((c) => c.props?.position === "absolute");
  const text = box === undefined ? undefined : collect(box, "Text")[0];
  return text === undefined ? undefined : textOf(text).trim();
}
