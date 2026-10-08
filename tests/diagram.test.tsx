import { describe, expect, mock, test } from "claude-code/testing";
import type { Engine, Mounted } from "claude-code/testing";
import type { On } from "claude-code";
import { drawDiagram } from "../hooks/diagram";
import { textList } from "../hooks/diagram-list";
import { diagramPanel } from "../hooks/diagram-paint";
import { WIDE_PAD } from "../hooks/diagram-source";
import { fillsFor, palette } from "../hooks/palette";
import { replyLook } from "../hooks/reply-look";
import { accentOf } from "../hooks/session-color";
import { displayWidth } from "../hooks/text-width";
import { childrenOf, collect, diagramPanels, diagramRows } from "./draw-tree";

type Reply = Mounted<"terminal", "AssistantMessage">;

const FENCE = "```";
const WIDE = 220;
const NARROW = 80;
const TINY = 20;

const OWNER_FLOWCHART = [
  "flowchart LR",
  "  G[grilling] --> S[spec.md]",
  "  S --> P[plan mode: plan]",
  "  P --> X[ExitPlanMode → Plannotator HTML]",
  "  X -->|approved| T[TaskCreate per plan task + blockedBy]",
  "  T --> W[agents work, TaskUpdate status]",
].join("\n");
const SEQUENCE = [
  "sequenceDiagram",
  "  participant U as User",
  "  participant A as API",
  "  U->>A: request data",
  "  A-->>U: response, ok",
].join("\n");
const CHART = [
  "xychart-beta",
  '  title "Sales"',
  "  x-axis [jan, feb, mar]",
  '  y-axis "units" 0 --> 10',
  "  bar [3, 7, 5]",
].join("\n");

const WIDE_FLOWCHART = ["flowchart LR", "  A[상태 줄] --> B[대화 꾸미기]"].join("\n");

const GREEN = accentOf("green");
const SINGLE_SERIES = [
  "xychart-beta",
  "  x-axis [jan, feb, mar]",
  '  y-axis "units" 0 --> 10',
  "  bar [3, 9, 5]",
].join("\n");
const TWO_SERIES = [
  "xychart-beta",
  "  x-axis [jan, feb, mar]",
  '  y-axis "units" 0 --> 10',
  "  bar [3, 9, 5]",
  "  bar [4, 2, 8]",
].join("\n");
const TANGLED_FLOWCHART = [
  "flowchart TD",
  "  A[a] --> B[b]",
  "  B --> C[c]",
  "  C --> A",
  "  C --> D[d]",
  "  D --> E[e]",
  "  E --> B",
  "  E --> F[f]",
].join("\n");

describe("flowchart placements", () => {
  const placements: [string, (block: string) => string][] = [
    ["top level", (block) => block],
    ["after a heading", (block) => `## What I suggest\n\n${block}`],
    ["after a heading, no blank line", (block) => `## What I suggest\n${block}`],
    ["indented by 2", (block) => indented(block, 2)],
    ["indented by 4", (block) => indented(block, 4)],
    ["inside a list item", (block) => `- first step\n${indented(block, 2)}\n- second step`],
    ["inside a numbered item", (block) => `1. first step\n${indented(block, 3)}`],
  ];

  for (const [name, place] of placements) {
    test(`D1 the owner flowchart is drawn as a diagram: ${name}`, async ($) => {
      const ui = await mountReply($, place(mermaid(OWNER_FLOWCHART)), WIDE);

      const rows = await drawnRows(ui);
      expect(await ui.find({ type: "Code" })).toBeUndefined();
      expect(rows).toHaveLength(3);
      expect(rows[0]).toMatch(/^┌─+┐ +┌/);
      expect(rows[1]).toMatch(
        /grilling.*►.*spec\.md.*►.*plan mode: plan.*►.*Plannotator HTML.*approved.*►.*blockedBy.*►.*TaskUpdate status/,
      );
      expect(rows[2]).toMatch(/^└─+┘ +└/);
    });
  }

  test("D2 at 80 columns the flowchart is drawn top-down with wrapped labels", async ($) => {
    const ui = await mountReply($, mermaid(OWNER_FLOWCHART), NARROW);

    const rows = await drawnRows(ui);
    expect(await ui.find({ type: "Code" })).toBeUndefined();
    expect(rows.filter((row) => row.includes("▼"))).toHaveLength(5);
    expect(rows.filter((row) => row.includes("┌"))).toHaveLength(6);
    expect(rows.every((row) => (row.match(/┌/g) ?? []).length <= 1)).toBe(true);
    const exitRow = rows.findIndex((row) => row.includes("ExitPlanMode"));
    expect(rows[exitRow + 1]).toContain("Plannotator HTML");
  });

  test("D3 at 20 columns the flowchart is a readable list of edges, not a drawing", async ($) => {
    const ui = await mountReply($, mermaid(OWNER_FLOWCHART), TINY);

    const rows = await drawnRows(ui);
    expect(await ui.find({ type: "Code" })).toBeUndefined();
    expect(rows).toHaveLength(5);
    expect(rows[0]).toBe("grilling → spec.md");
    expect(rows.join("")).not.toMatch(/[┌└│├►▼]/);
  });
});

describe("streaming", () => {
  test("D4 the block is a code card while chunks arrive and a diagram once the fence closes", async ($) => {
    const full = mermaid(OWNER_FLOWCHART);
    const lines = full.split("\n");
    const ui = await mountReply($, lines.slice(0, 3).join("\n"), WIDE);

    for (let end = 4; end < lines.length; end++) {
      await ui.redraw({ text: lines.slice(0, end).join("\n"), isFirstOfReply: true });
      expect(await ui.find({ type: "Code" })).toBeDefined();
    }
    await ui.redraw({ text: full, isFirstOfReply: true });

    const rows = await drawnRows(ui);
    expect(await ui.find({ type: "Code" })).toBeUndefined();
    expect(rows[0]).toMatch(/^┌─+┐ +┌/);
    expect(rows[1]).toMatch(/grilling.*►.*spec\.md/);
  });

  test("D5 a completed block is built once per width and source", () => {
    const first = drawDiagram(OWNER_FLOWCHART, WIDE);

    expect(drawDiagram(OWNER_FLOWCHART, WIDE)).toBe(first);
  });
});

describe("other diagram kinds", () => {
  test("D6 a sequenceDiagram is drawn with its participants above and below and an arrow per message", async ($) => {
    const ui = await mountReply($, mermaid(SEQUENCE), NARROW);

    const rows = await drawnRows(ui);
    expect(await ui.find({ type: "Code" })).toBeUndefined();
    expect(rows[0]).toMatch(/^┌─+┐ +┌─+┐$/);
    expect(rows[1]).toMatch(/^│ User │ +│ API │$/);
    expect(rows.at(-1)).toMatch(/^└─+┘ +└─+┘$/);
    expect(rows.at(-2)).toMatch(/^│ User │ +│ API │$/);
    const request = rows.findIndex((row) => row.includes("request data"));
    const response = rows.findIndex((row) => row.includes("response, ok"));
    expect(rows[request + 1]).toMatch(/─+►/);
    expect(rows[response + 1]).toMatch(/◄╌+/);
  });

  test("D7 an xychart-beta is drawn as bars in proportion to their values under its title", async ($) => {
    const ui = await mountReply($, mermaid(CHART), NARROW);

    const rows = await drawnRows(ui);
    expect(await ui.find({ type: "Code" })).toBeUndefined();
    expect(rows[0]).toContain("Sales");
    const [jan, feb, mar] = barHeights(rows);
    expect(feb).toBeGreaterThan(mar!);
    expect(mar).toBeGreaterThan(jan!);
    expect(rows.at(-1)).toMatch(/jan\s+feb\s+mar/);
  });

  test("D8 a sequenceDiagram at 20 columns is a list of messages with participant names", () => {
    expect(drawDiagram(SEQUENCE, TINY)).toEqual({
      kind: "list",
      lines: ["User → API: request data", "API → User: response, ok"],
    });
  });
});

describe("failure", () => {
  test("D9 an unsupported diagram keeps its source in a code card with one line giving the reason", async ($) => {
    const ui = await mountReply($, mermaid('pie title Pets\n  "Dogs": 3'), WIDE);

    expect((await ui.find({ type: "Code" }))?.props.source).toContain("pie title Pets");
    expect(
      await ui.find({
        type: "Text",
        text: 'diagram could not be drawn: Invalid mermaid header: "pie title Pets"',
      }),
    ).toBeDefined();
  });

  test("D10 an empty block says it is empty", () => {
    expect(drawDiagram("   ", WIDE)).toEqual({ kind: "failed", reason: "the diagram is empty" });
  });

  test("D11 a drawing wider than the width with no edge list says how wide it may be", () => {
    const wide =
      "stateDiagram-v2\n  [*] --> A_state_with_a_very_long_name_indeed\n  A_state_with_a_very_long_name_indeed --> [*]";

    expect(drawDiagram(wide, 20)).toEqual({
      kind: "failed",
      reason: "the drawing is wider than 16 columns",
    });
  });
});

describe("edge lists", () => {
  test("D12 labels, spoken labels, chains, shapes and skipped lines", () => {
    const source = [
      "graph TD",
      "  subgraph box [Part]",
      "  A((Start)) -- yes --> B{Choice} --> C[Done]",
      "  end",
      '  B -.->|no| D["Retry, later"]',
      "  style A fill:#f9f",
    ].join("\n");

    expect(textList(source)).toEqual([
      "Start → Choice (yes)",
      "Choice → Done",
      "Choice → Retry, later (no)",
    ]);
  });
});

describe("colour and fixes", () => {
  test("D13 under /color green every arrow character is the session colour", async ($, on) => {
    worldOf(on, "green");

    const ui = await mountReply($, mermaid(OWNER_FLOWCHART), WIDE);

    const arrows = await runColors(ui, /[►◄▲▼]/);
    expect(arrows.length).toBeGreaterThan(0);
    expect(new Set(arrows)).toEqual(new Set([GREEN]));
  });

  test("D14 in a single-series bar chart the tallest bar is strong, the others muted, with values above", async ($) => {
    const ui = await mountReply($, mermaid(SINGLE_SERIES), NARROW);

    const bars = await runColors(ui, /^█+$/);
    expect(bars[0]).toBe(replyLook(null).strong);
    expect(new Set(bars)).toEqual(new Set([replyLook(null).strong, palette.muted]));
    const rows = drawnArt(SINGLE_SERIES).split("\n");
    const valueRow = rows.findIndex((row) => row.includes("9"));
    expect(rows[valueRow + 1]![rows[valueRow]!.indexOf("9")]).toBe("█");
    for (const value of ["3", "5"]) expect(rows.join("\n")).toContain(value);
  });

  test("D15 under the default colour the tallest bar is palette.userText", async ($) => {
    const ui = await mountReply($, mermaid(SINGLE_SERIES), NARROW);

    expect((await runColors(ui, /^█+$/))[0]).toBe(palette.userText);
  });

  test("D16 a two-series bar chart has two bar hues", async ($) => {
    const ui = await mountReply($, mermaid(TWO_SERIES), NARROW);

    expect(new Set(await runColors(ui, /^█+$/)).size).toBe(2);
  });

  test("D17 a sequence participant has the same hue at the top and the bottom", async ($) => {
    const ui = await mountReply($, mermaid(SEQUENCE), NARROW);

    const users = await runColors(ui, /User/);
    expect(users).toHaveLength(2);
    expect(users[0]).toBe(users[1]);
    expect(users[0]).not.toBe(palette.text);
  });

  test("D24 a flowchart, a sequence diagram and a bar chart float on the terminal with no fill", async ($) => {
    for (const source of [OWNER_FLOWCHART, SEQUENCE, CHART]) {
      const ui = await mountReply($, mermaid(source), WIDE);

      const panels = diagramPanels(await ui.drawn());
      expect(panels).toHaveLength(1);
      const rows = childrenOf(panels[0]!);
      expect(rows.length).toBeGreaterThan(0);
      expect(panels[0]!.props?.backgroundColor).toBeUndefined();
      expect(rows.map((row) => row.props?.backgroundColor)).toEqual(rows.map(() => undefined));
    }
  });

  test("D25 an edge label keeps all its letters on a one-way and a two-way arrow", () => {
    for (const arrow of ["-->", "<-->"]) {
      const art = drawnArt(`flowchart LR\n  A{Tool call?} ${arrow}|request| B[Run tool]`, WIDE);

      expect(art).toContain("request");
    }
  });

  test("D26 under a light or ansi theme the diagram text takes the terminal colour, not the theme text key", () => {
    const ui = { Box: "Box", Text: "Text" } as never;
    const look = replyLook(accentOf("green"), fillsFor("light-ansi"));

    const panel = diagramPanel(ui, drawnArt(SEQUENCE, WIDE), look, "d") as never;

    const colours = new Set(collect(panel, "Text").map((run) => run.props?.color));
    expect(colours.has(palette.text)).toBe(false);
  });

  test("D18 no drawn diagram holds the emoji-prone arrows", () => {
    for (const source of [OWNER_FLOWCHART, SEQUENCE]) {
      expect(drawnArt(source, WIDE)).not.toMatch(/[▶◀]/);
    }
  });

  test("D19 a quoted x category with a comma is drawn as one category", () => {
    const art = drawnArt(SINGLE_SERIES.replace("jan, feb, mar", '"Q1, 2026", feb, mar'));

    expect(art).toContain("Q1, 2026");
    expect(art).not.toMatch(/Q1\s{2,}2026/);
    expect(art.match(/┬/g)).toHaveLength(3);
  });

  test("D20 an edge label written after a space is drawn", () => {
    expect(drawnArt("flowchart LR\n  A --> |yes| B")).toContain("yes");
  });

  test("D21 an xychart at 60 and 200 columns stays within the reply width", () => {
    for (const columns of [60, 200]) {
      const rows = drawnArt(SINGLE_SERIES, columns).split("\n");
      expect(Math.max(...rows.map((row) => [...row].length))).toBeLessThanOrEqual(columns - 4);
    }
  });
});

describe("cyclic flowchart", () => {
  test("D22 a flowchart whose edges cannot all be routed is drawn as an edge list", () => {
    const diagram = drawDiagram(TANGLED_FLOWCHART, WIDE);

    expect(diagram.kind).toBe("list");
    expect(diagram.kind === "list" && diagram.lines).toContain("c → a");
  });
});

describe("decision nodes", () => {
  test("D23 a decision node is a closed box and no arrow starts inside its border", () => {
    const art = drawnArt(
      "flowchart LR\n  Request --> Valid{Valid?}\n  Valid -->|yes| Process\n  Valid -->|no| Reject",
      180,
    );

    expect(art).not.toContain("◇");
    expect(art).not.toMatch(/│ ├─/);
    expect(art).toMatch(/│ Valid\? ├─+yes─►/);
    expect(art).toMatch(/└─+┬─+┘/);
    expect(art).toContain("yes");
    expect(art).toContain("no");
  });
});

describe("wide characters", () => {
  test("D27 a box around a label with wide characters closes at the same column on every row", async ($) => {
    const rows = await drawnRows(await mountReply($, mermaid(WIDE_FLOWCHART), WIDE));
    const top = rows.find((row) => row.includes("┐"))!;
    const label = rows.find((row) => row.includes("상태 줄"))!;

    expect(columnOf(label, "├")).toBe(columnOf(top, "┐"));
  });

  test("D28 a diagram with wide characters shows no placeholder character", async ($) => {
    const rows = await drawnRows(await mountReply($, mermaid(WIDE_FLOWCHART), WIDE));

    expect(rows.join("\n")).toContain("대화 꾸미기");
    expect(rows.join("\n")).not.toContain(WIDE_PAD);
  });
});

function columnOf(row: string, char: string): number {
  return displayWidth(row.slice(0, row.indexOf(char)));
}

function drawnArt(source: string, columns = NARROW): string {
  const diagram = drawDiagram(source, columns);
  if (diagram.kind !== "art") throw new Error(`not drawn: ${diagram.kind}`);
  return diagram.art;
}

async function drawnRows(ui: Reply): Promise<string[]> {
  return diagramRows(await ui.drawn());
}

function barHeights(rows: string[]): number[] {
  const axis = rows.findLastIndex((row) => row.includes("┬"));
  const ticks = [...rows[axis]!].flatMap((char, x) => (char === "┬" ? [x] : []));
  return ticks.map((x) => rows.filter((row) => [...row][x] === "█").length);
}

function worldOf(on: On, colorName: string): void {
  mock.env(on, { HOME: "/h/u" });
  on("state.get", (_$, e, next) =>
    e.key === "sessionColor" ? { value: { value: colorName, version: 1 } } : next(e),
  );
}

async function runColors(ui: Reply, text: RegExp): Promise<unknown[]> {
  const nodes = await ui.findAll({ type: "Text" });
  return nodes
    .filter(
      (node) => node.children.every((child) => typeof child === "string") && text.test(node.text),
    )
    .map((node) => node.props.color);
}

function indented(block: string, spaces: number): string {
  return block
    .split("\n")
    .map((line) => " ".repeat(spaces) + line)
    .join("\n");
}

function mermaid(source: string): string {
  return [`${FENCE}mermaid`, source, FENCE].join("\n");
}

function mountReply($: Engine, text: string, columns: number) {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "AssistantMessage",
    props: { text, isFirstOfReply: true },
    viewport: { columns, rows: 24 },
  });
}
