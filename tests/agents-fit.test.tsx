import { describe, expect, mock, test } from "claude-code/testing";
import type { On, SessionMessage } from "claude-code";
import type { Engine, MockClock, Mounted } from "claude-code/testing";
import type { AgentNode } from "../hooks/agents-model";
import { screenRows } from "./band-screen";
import { pricedSpent, seedOf } from "./fixtures/agent-spend";
import type { Tokens } from "./spend-world";
import { isWordEdgeCut } from "./word-edge";

type Pane = Mounted<"terminal", "Pane">;
type Fixture = AgentNode & { spent?: Tokens };

const store = new Map<string, { value: unknown; version: number }>();
const NOW = 200_000;
const FLUSH_MS = 1_000;
const ROWS = 40;
const WIDE = 120;
const COLUMNS = 100;
const NARROW = 60;
const ELLIPSIS = "…";
const SHORT_NAME = "Run sleep 170";
const TRANSCRIPT_NAME = "Run sleep 170 now";
const LONG_NAME = "Run sleep 170 then report the full outcome to the billing team lead";
const LONG_TYPE = "code-reviewer-for-the-billing-export-rewrite-team";
const COST = "~$0.04";
const ROW_COST_END = /~\$0\.09 ▸$/;
const WORDY_NAME = "Read 30 hook files in the pane and report what each one draws";
const ONE_WORD_NAME = "abcdefghij".repeat(7);
const PLACE_BRANCH = "feature/GH-184-make-files-agents-plan";
const PLACE_WORKTREE = "demo-app-GH-184";
const MEDIUM_NAME = "List";
const ONE_WORD_MIN_KEPT = 10;
const FULL_NAME = "List files under app directory";

describe("agents fit the pane", () => {
  test("F10a a waiting agent and a finished agent at 120 columns start their titles at the same column", async ($, on) => {
    const clock = worldOf(on);
    await writeAgents([
      agent({ id: "w", description: SHORT_NAME, status: "waiting", startedAt: NOW - 9_000 }),
      agent({
        id: "d",
        description: "List files under app directory",
        status: "done",
        startedAt: NOW - 20_000,
        endedAt: NOW - 5_000,
      }),
    ]);
    const pane = await paneWithTab($, clock, WIDE);

    const rows = await screenOf(pane, WIDE);

    expect(rowWith(rows, SHORT_NAME).indexOf(SHORT_NAME)).toBe(
      rowWith(rows, "List files under app directory").indexOf("List files under app directory"),
    );
  });

  test("F11a a waiting agent's first detail row starts with its type, not with the word waiting", async ($, on) => {
    const clock = worldOf(on);
    await writeAgents([
      agent({ id: "w", description: SHORT_NAME, status: "waiting", startedAt: NOW - 9_000 }),
    ]);
    const pane = await paneWithTab($, clock, COLUMNS);

    const rows = await screenOf(pane, COLUMNS);
    const title = rows.findIndex((row) => row.includes(SHORT_NAME));

    expect(rows[title]).toMatch(/waiting Run sleep 170\s+general-purpose/);
  });

  test("F12a a finished agent whose detail line is too long for 60 columns shows its whole cost on the title row and none on the detail line", async ($, on) => {
    const clock = worldOf(on);
    await writeAgents([
      agent({
        id: "d",
        type: LONG_TYPE,
        description: SHORT_NAME,
        status: "done",
        startedAt: NOW - 10_000,
        endedAt: NOW - 5_000,
        spent: { input: 20_000, output: 4_000 },
      }),
    ]);
    const pane = await paneWithTab($, clock, NARROW);

    const rows = await screenOf(pane, NARROW);
    const title = rows.findIndex((row) => row.includes(SHORT_NAME));

    expect(rows[title]).toMatch(/~\$0\.12 ▸$/);
    expect(rows[title + 1]).not.toContain("$");
  });

  test("F17a a finished agent's card title row at 60 columns shows its status word and whole cost and drops the effort first when the name, model and cost still fit", async ($, on) => {
    const clock = worldOf(on);
    await writeAgents([finishedCard(MEDIUM_NAME, "Explore")]);
    const pane = await paneWithTab($, clock, NARROW);

    const title = rowWith(await screenOf(pane, NARROW), "✓ done");

    expect(title).toContain(`${MEDIUM_NAME}  Explore · sonnet 5.5`);
    expect(title).not.toContain("medium");
    expect(title).toMatch(ROW_COST_END);
  });

  test("F17b a finished agent's row at 60 columns whose name does not fit ends the name after its last whole word, keeps its model, shows no type or effort and keeps the status word and whole cost", async ($, on) => {
    const clock = worldOf(on);
    await writeAgents([finishedCard(FULL_NAME)]);
    const pane = await paneWithTab($, clock, NARROW);

    const title = rowWith(await screenOf(pane, NARROW), MEDIUM_NAME);

    expect(title).toContain("done");
    expect(isCutAfterWholeWord(keptName(title), FULL_NAME)).toBe(true);
    expect(title).toContain("sonnet");
    expect(title).not.toContain("general-purpose");
    expect(title).not.toContain("medium");
    expect(title).toMatch(ROW_COST_END);
  });

  test("E1a a row at 60 columns with a long type drops the type before the model and keeps the whole name", async ($, on) => {
    const clock = worldOf(on);
    await writeAgents([finishedCard("Read hook files")]);
    const pane = await paneWithTab($, clock, NARROW);

    const row = rowWith(await screenOf(pane, NARROW), "Read hook files");

    expect(row).toContain("sonnet");
    expect(row).not.toContain("general-purpose");
  });

  test("E1b a row at 60 columns with a long name cuts the name at a word edge and still shows the model", async ($, on) => {
    const clock = worldOf(on);
    await writeAgents([finishedCard(LONG_NAME)]);
    const pane = await paneWithTab($, clock, NARROW);

    const row = rowWith(await screenOf(pane, NARROW), "Run sleep 170");

    expect(isCutAfterWholeWord(keptName(row), LONG_NAME)).toBe(true);
    expect(row).toContain("sonnet");
  });

  test("F17c a finished agent whose name is too long even alone keeps its status word and whole cost on the title row and ends the name with an ellipsis at 60 columns", async ($, on) => {
    const clock = worldOf(on);
    await writeAgents([finishedCard(LONG_NAME)]);
    const pane = await paneWithTab($, clock, NARROW);

    const title = rowWith(await screenOf(pane, NARROW), "Run sleep 170");

    expect(title).toContain("done");
    expect(title).toContain(ELLIPSIS);
    expect(title).toMatch(ROW_COST_END);
  });

  test("F17d a finished agent's card title row at 120 columns shows status word, name, model, effort and cost, and its detail line shows no cost", async ($, on) => {
    const clock = worldOf(on);
    await writeAgents([finishedCard(FULL_NAME)]);
    const pane = await paneWithTab($, clock, WIDE);

    const rows = await screenOf(pane, WIDE);
    const title = rows.findIndex((row) => row.includes(FULL_NAME));

    expect(rows[title]).toContain("done");
    expect(rows[title]).toContain(`${FULL_NAME}  general-purpose · sonnet 5.5 · medium`);
    expect(rows[title]).toMatch(ROW_COST_END);
    expect(rows[title + 1]).toContain("click an agent");
  });

  test("F18 a running agent with tokens spent shows its cost on its card title row at 60 columns", async ($, on) => {
    const clock = worldOf(on);
    await writeAgents([
      agent({
        id: "r",
        description: "Sleep 300 seconds",
        status: "running",
        model: "claude-sonnet-5-5",
        effort: "medium",
        startedAt: NOW - 30_000,
        ctxTokens: 29_500,
        spent: { input: 20_000, output: 2_000 },
      }),
    ]);
    const pane = await paneWithTab($, clock, NARROW);

    const rows = await screenOf(pane, NARROW);
    const title = rows.findIndex((row) => row.includes("Sleep 300"));

    expect(rows[title]).toContain("running");
    expect(rows[title]).toMatch(ROW_COST_END);
    expect(rows[title + 1]).not.toContain("$");
  });

  test("F23a a waiting agent's open header at 60 columns whose name is too long ends the name after its last whole word, then the ellipsis, and keeps the cost whole", async ($, on) => {
    const clock = worldOf(on);
    transcriptsOf(on, "a").set("a", [message("user", "go")]);
    await writeAgents([waitingCard(WORDY_NAME)]);
    const pane = await paneWithTab($, clock, NARROW);
    await openTranscript(pane, "Read 30 hook");

    const header = rowWith(await screenOf(pane, NARROW), "waiting");

    expect(isCutAfterWholeWord(keptName(header), WORDY_NAME)).toBe(true);
    expect(header.endsWith(COST)).toBe(true);
  });

  test("F23b a finished agent's card title row at 60 columns whose name is too long ends the name after its last whole word, with status word and cost whole and the model kept, no effort", async ($, on) => {
    const clock = worldOf(on);
    await writeAgents([finishedCard(WORDY_NAME)]);
    const pane = await paneWithTab($, clock, NARROW);

    const title = rowWith(await screenOf(pane, NARROW), "Read 30 hook");

    expect(isCutAfterWholeWord(keptName(title), WORDY_NAME)).toBe(true);
    expect(title).toContain("done");
    expect(title).toMatch(ROW_COST_END);
    expect(title).toContain("sonnet");
    expect(title).not.toContain("medium");
  });

  test("F23c an agent name whose first word is longer than the title row is still cut inside that word and ends with an ellipsis", async ($, on) => {
    const clock = worldOf(on);
    await writeAgents([finishedCard(ONE_WORD_NAME)]);
    const pane = await paneWithTab($, clock, NARROW);

    const title = rowWith(await screenOf(pane, NARROW), "abcdefghij");

    expect(ONE_WORD_NAME.startsWith(keptName(title))).toBe(true);
    expect(keptName(title).length).toBeGreaterThanOrEqual(ONE_WORD_MIN_KEPT);
    expect(title).toMatch(ROW_COST_END);
  });

  test("F24 a finished agent's branch and worktree row at 60 columns cuts the branch at a word edge and keeps the end of the worktree name", async ($, on) => {
    const clock = worldOf(on);
    await writeAgents([
      agent({
        id: "d",
        description: SHORT_NAME,
        status: "done",
        branch: PLACE_BRANCH,
        worktree: PLACE_WORKTREE,
        startedAt: NOW - 20_000,
        endedAt: NOW - 5_000,
      }),
    ]);
    const pane = await paneWithTab($, clock, NARROW);

    const row = rowWith(await screenOf(pane, NARROW), "⎇");
    const [branch = ""] = row.trim().slice(2).split(" · ");

    expect(isWordEdgeCut(branch, PLACE_BRANCH)).toBe(true);
    expect(row.endsWith("GH-184")).toBe(true);
  });

  test("F13a a waiting agent's transcript at 60 columns whose name fits once effort and model are gone keeps its status word, name and cost whole", async ($, on) => {
    const clock = worldOf(on);
    const transcripts = transcriptsOf(on, "a");
    transcripts.set("a", [message("user", "go")]);
    await writeAgents([
      agent({
        id: "a",
        description: TRANSCRIPT_NAME,
        status: "waiting",
        model: "sonnet",
        effort: "medium",
        spent: { input: 8_000, output: 1_000 },
        startedAt: NOW - 9_000,
      }),
    ]);
    const pane = await paneWithTab($, clock, NARROW);
    await openTranscript(pane, SHORT_NAME);

    const header = rowWith(await screenOf(pane, NARROW), "waiting");

    expect(header).toContain("waiting");
    expect(header).toContain(TRANSCRIPT_NAME);
    expect(header.endsWith(COST)).toBe(true);
  });

  test("F13b a waiting agent's transcript at 60 columns whose name is too long even alone keeps its status word and cost whole and ends the name with an ellipsis", async ($, on) => {
    const clock = worldOf(on);
    const transcripts = transcriptsOf(on, "a");
    transcripts.set("a", [message("user", "go")]);
    await writeAgents([
      agent({
        id: "a",
        description: LONG_NAME,
        status: "waiting",
        model: "sonnet",
        effort: "medium",
        spent: { input: 8_000, output: 1_000 },
        startedAt: NOW - 9_000,
      }),
    ]);
    const pane = await paneWithTab($, clock, NARROW);
    await openTranscript(pane, SHORT_NAME);

    const header = rowWith(await screenOf(pane, NARROW), "waiting");

    expect(header).toContain("waiting");
    expect(header.endsWith(COST)).toBe(true);
    expect(header).toContain(ELLIPSIS);
  });
});

function worldOf(on: On): MockClock {
  store.clear();
  const clock = mock.clock(on, { now: NOW });
  mock.env(on, { HOME: "/h/u" });
  on("state.get", (_$, e, next) => {
    const seeded = store.get(e.key);
    return seeded ? { value: seeded } : next(e);
  });
  on("state.set", (_$, e, next) => {
    store.delete(e.key);
    return next(e);
  });
  on("classic.SessionStart", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: "/work" }));
  on("agent.list", () => ({ value: [] }));
  on("tool.call", () => ({ result: "ok", text: "ok" }));
  return clock;
}

const transcripts = new Map<string, SessionMessage[]>();

function transcriptsOf(on: On, id: string): Map<string, SessionMessage[]> {
  transcripts.clear();
  on("session.messages", (_$, e) => {
    const found = transcripts.get((e as { agentId?: string }).agentId ?? id);
    return { value: found ?? { deny: "unknown agent" } };
  });
  return transcripts;
}

function message(role: "user" | "assistant", text: string): SessionMessage {
  return { role, text, toolUses: [] };
}

function waitingCard(description: string): Fixture {
  return agent({
    id: "a",
    description,
    status: "waiting",
    model: "sonnet",
    effort: "medium",
    spent: { input: 8_000, output: 1_000 },
    startedAt: NOW - 9_000,
  });
}

function keptName(row: string): string {
  return /(?:done|waiting)\s+(.*?)…/.exec(row)?.[1] ?? "";
}

function isCutAfterWholeWord(kept: string, original: string): boolean {
  return kept !== "" && original.startsWith(kept) && original[kept.length] === " ";
}

function finishedCard(description: string, type = "general-purpose"): Fixture {
  return agent({
    type,
    id: "d",
    description,
    status: "done",
    model: "claude-sonnet-5-5",
    effort: "medium",
    startedAt: NOW - 20_000,
    endedAt: NOW - 5_000,
    spent: { input: 20_000, output: 2_000 },
  });
}

function agent(fields: Partial<Fixture> & { id: string }): Fixture {
  return {
    type: "general-purpose",
    description: fields.id,
    background: false,
    model: "sonnet",
    status: "done",
    startedAt: NOW - 10_000,
    ctxTokens: 0,
    running: [],
    ...fields,
  };
}

async function writeAgents(agents: Fixture[]): Promise<void> {
  const nodes = agents.map(({ spent: _spent, ...node }): AgentNode => node);
  const value = Object.fromEntries(nodes.map((one) => [one.id, one]));
  store.set("agents", { value, version: (store.get("agents")?.version ?? 0) + 1 });
  const seed = seedOf(
    agents.flatMap(({ id, type, spent }) =>
      spent === undefined ? [] : [pricedSpent(id, type, spent)],
    ),
  );
  store.set("spend", { value: seed.spend, version: 1 });
  store.set("sessionUsd", { value: seed.sessionUsd, version: 1 });
}

async function paneWithTab($: Engine, clock: MockClock, columns: number): Promise<Pane> {
  const pane = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: "session",
    props: {
      title: "Session",
      isFocused: false,
      bodyColumns: columns,
      placement: "dock",
      scroll: { offset: 0, bodyRows: ROWS },
      view: {},
    },
    viewport: { columns, rows: ROWS },
  });
  await clock.advance(FLUSH_MS);
  await pressNamed(pane, "Agents");
  return pane;
}

async function pressNamed(pane: Pane, label: string): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const target = buttons.find((button) => button.props.label === label);
  expect(target, `a button labelled ${label}`).toBeDefined();
  await pane.press({ key: target?.key ?? "" });
  for (let tick = 0; tick < 5; tick++) await pane.redraw();
}

async function openTranscript(pane: Pane, title: string): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const target = buttons.find((button) => String(button.props.label).includes(title));
  expect(target, `a title button for ${title}`).toBeDefined();
  await pane.press({ key: target?.key ?? "" });
  for (let tick = 0; tick < 5; tick++) await pane.redraw();
}

async function screenOf(pane: Pane, columns: number): Promise<string[]> {
  return screenRows(await pane.drawn(), columns)
    .map((line) => line.trimEnd())
    .filter((line) => line !== "");
}

function rowWith(rows: string[], text: string): string {
  const row = rows.find((line) => line.includes(text));
  expect(row, `a row with ${text}`).toBeDefined();
  return row ?? "";
}
