import { describe, expect, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { palette } from "../hooks/palette";
import { notePaneTheme } from "../hooks/pane-ink";
import { skillsTab } from "../hooks/skills-draw";
import type { SkillEntry, SkillsView } from "../hooks/skills-draw";
import { textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import {
  bareRowOf,
  blocksOf,
  descriptionRowsOf,
  glyphButtonOf,
  headingOrder,
  keyOf,
  linesOf,
  nameButtonOf,
  rowOf,
  skillRowTexts,
  statsButtonOf,
  useRowsOf,
} from "./skills-tree";
import type { Block, Line } from "./skills-tree";
import { isHeavy } from "./weight";

type Pane = Mounted<"terminal", "Pane">;
type DrawWorld = { view: SkillsView; events: string[] };
type DrawOptions = Partial<SkillsView> & { theme?: "dark" | "light" };

const COLUMNS = 60;
const VIEW_WIDTH = 40;
const PANE_ROWS = 40;
const FIXTURE_ID = "skills-draw";
const FIXTURE_PLUGIN = "test";
const DESCRIPTION_INDENT = 2;
const GLYPH_CELLS = 2;
const HEADINGS = ["Top used", "User", "Project", "runpod", "superpowers", "Built-in"];
const LONG_DESCRIPTION =
  "Use this skill whenever a release has to be planned, checked and announced to the team, including notes, tags and the final sign-off.";
const ONE_LINE = "Commit the staged changes.";

const COMMIT: SkillEntry = { name: "commit", description: ONE_LINE, owner: "user" };
const ALPHA: SkillEntry = { name: "alpha", description: ONE_LINE, owner: "user" };
const DEPLOY: SkillEntry = {
  name: "deploy-notes",
  description: LONG_DESCRIPTION,
  owner: "project",
};
const RELEASE: SkillEntry = { name: "release-notes", description: ONE_LINE, owner: "project" };
const RUNPOD: SkillEntry = {
  name: "runpod:runpod",
  description: LONG_DESCRIPTION,
  owner: "plugin",
  plugin: "runpod",
};
const RUNPOD_FLASH: SkillEntry = {
  name: "runpod:flash",
  description: ONE_LINE,
  owner: "plugin",
  plugin: "runpod",
};
const BRAINSTORM: SkillEntry = {
  name: "superpowers:brainstorming",
  description: ONE_LINE,
  owner: "plugin",
  plugin: "superpowers",
};
const UPDATE_CONFIG: SkillEntry = {
  name: "update-config",
  description: ONE_LINE,
  owner: "built-in",
};
const BARE: SkillEntry = { name: "bare-skill", description: "", owner: "user" };
const FIVE_USED = [
  { name: "deploy-notes", uses: 5 },
  { name: "commit", uses: 2 },
  { name: "runpod:runpod", uses: 1 },
  { name: "docs", uses: 1 },
  { name: "review", uses: 1 },
];
const TOP_THREE = FIVE_USED.slice(0, 3);
const EVERY_OWNER = [COMMIT, DEPLOY, RUNPOD, UPDATE_CONFIG];

describe("skills tab draw", () => {
  test("L1 headings come in the order Top used, User, Project, plugin name, Built-in", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills($, world, {
      top: [{ name: "commit", uses: 3 }],
      allUsed: [{ name: "commit", uses: 3 }],
      skills: [UPDATE_CONFIG, RUNPOD, DEPLOY, COMMIT],
    });

    expect(headingOrder(await lines(pane), HEADINGS)).toEqual([
      "Top used",
      "User",
      "Project",
      "runpod",
      "Built-in",
    ]);
  });

  test("L2 with only built-in skills and no top only the Built-in heading is drawn", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills($, world, { skills: [UPDATE_CONFIG] });

    expect(headingOrder(await lines(pane), HEADINGS)).toEqual(["Built-in"]);
  });

  test("L3 each plugin has its own block with its own skills and whole colon names", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills($, world, { skills: [RUNPOD, BRAINSTORM, RUNPOD_FLASH] });

    const blocks = blocksOf(await lines(pane), HEADINGS);
    expect(skillRowTexts(blocks.runpod)).toEqual(["▸ runpod:flash", "▸ runpod:runpod"]);
    expect(skillRowTexts(blocks.superpowers)).toEqual(["▸ superpowers:brainstorming"]);
    expect(blocks.User).toBeUndefined();
  });

  test("L3b plugin blocks come A-Z and the skills inside every block come A-Z", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills($, world, {
      skills: [BRAINSTORM, RUNPOD, COMMIT, RUNPOD_FLASH, ALPHA],
    });

    const shown = await lines(pane);
    const blocks = blocksOf(shown, HEADINGS);
    expect(headingOrder(shown, HEADINGS)).toEqual(["User", "runpod", "superpowers"]);
    expect(skillRowTexts(blocks.User)).toEqual(["▸ alpha", "▸ commit"]);
    expect(skillRowTexts(blocks.runpod)).toEqual(["▸ runpod:flash", "▸ runpod:runpod"]);
  });

  test("L4 closed skills with descriptions are exactly one row each and no description is on screen", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills($, world, { skills: [COMMIT, DEPLOY, RUNPOD] });

    const blocks = blocksOf(await lines(pane), HEADINGS);
    expect(rowTexts(blocks.User)).toEqual(["▸ commit"]);
    expect(rowTexts(blocks.Project)).toEqual(["▸ deploy-notes"]);
    expect(rowTexts(blocks.runpod)).toEqual(["▸ runpod:runpod"]);
  });

  test("L5 clicking the glyph of a skill toggles it by its exact name and inserts nothing", async ($, on) => {
    const world = worldOf(on);
    const pane = await drawSkills($, world, { skills: [COMMIT, RUNPOD] });
    const row = await skillRow(pane, "runpod", "runpod:runpod");

    await press(pane, glyphButtonOf(row));

    expect(world.events).toEqual(["toggle:runpod:runpod"]);
  });

  test("L6 clicking the name of a skill inserts it by its exact name and toggles nothing", async ($, on) => {
    const world = worldOf(on);
    const pane = await drawSkills($, world, { skills: [COMMIT, RUNPOD] });
    const row = await skillRow(pane, "runpod", "runpod:runpod");

    await press(pane, nameButtonOf(row, "runpod:runpod"));

    expect(world.events).toEqual(["insert:runpod:runpod"]);
  });

  test("L7 an open skill shows its whole description dim under it, indented 2 cells, and the closed one stays one row", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills($, world, {
      skills: [DEPLOY, RELEASE],
      expanded: new Set(["deploy-notes"]),
    });

    const project = blocksOf(await lines(pane), HEADINGS).Project;
    const open = rowOf(project, "deploy-notes");
    const description = descriptionRowsOf(project, "deploy-notes");
    expect(open).toBeDefined();
    expect(description.length).toBeGreaterThan(0);
    expect(description.map((row) => row.text).join(" ")).toBe(LONG_DESCRIPTION);
    expect(description.map((row) => row.indent)).toEqual(
      description.map(() => (open?.indent ?? 0) + DESCRIPTION_INDENT),
    );
    expect(description.every(isDim)).toBe(true);
    expect(skillRowTexts(project)).toEqual(["▾ deploy-notes", "▸ release-notes"]);
    expect(descriptionRowsOf(project, "release-notes")).toEqual([]);
  });

  test("L8 Top used lists the top skills with their counts in the given order, then the unfold button", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills($, world, {
      top: TOP_THREE,
      allUsed: FIVE_USED,
      skills: [COMMIT, DEPLOY, RUNPOD],
    });

    const blocks = blocksOf(await lines(pane), HEADINGS);
    expect(useRowsOf(blocks["Top used"])).toEqual([
      ["deploy-notes", "5 uses"],
      ["commit", "2 uses"],
      ["runpod:runpod", "1 use"],
    ]);
    expect(statsButtonOf(blocks["Top used"])?.text).toBe("▸ all 5 used");
    expect(blocks["Top used"]?.count).toBeNull();
    expect(skillRowTexts(blocks.User)).toEqual(["▸ commit"]);
    expect(skillRowTexts(blocks.Project)).toEqual(["▸ deploy-notes"]);
    expect(skillRowTexts(blocks.runpod)).toEqual(["▸ runpod:runpod"]);
  });

  test("L9 pressing the button under Top used asks to toggle the stats", async ($, on) => {
    const world = worldOf(on);
    const pane = await drawSkills($, world, {
      top: TOP_THREE,
      allUsed: FIVE_USED,
      skills: [COMMIT],
    });
    const button = statsButtonOf(blocksOf(await lines(pane), HEADINGS)["Top used"]);

    await press(
      pane,
      button?.parts.find((part) => part.type === "Button"),
    );

    expect(world.events).toEqual(["stats"]);
  });

  test("L10 with the stats open Top used lists every used skill with its count and the button reads top 3", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills($, world, {
      top: TOP_THREE,
      allUsed: FIVE_USED,
      statsOpen: true,
      skills: [COMMIT, DEPLOY, RUNPOD],
    });

    const block = blocksOf(await lines(pane), HEADINGS)["Top used"];
    expect(useRowsOf(block)).toEqual([
      ["deploy-notes", "5 uses"],
      ["commit", "2 uses"],
      ["runpod:runpod", "1 use"],
      ["docs", "1 use"],
      ["review", "1 use"],
    ]);
    expect(statsButtonOf(block)?.text).toBe("▾ top 3");
  });

  test("L11 in a dark theme every block heading is bold plain text colour, not the periwinkle section colour", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills($, world, {
      top: TOP_THREE,
      allUsed: FIVE_USED,
      skills: EVERY_OWNER,
    });

    const headings = Object.values(blocksOf(await lines(pane), HEADINGS)).map(
      (block) => block.heading,
    );
    expect(headings).toHaveLength(5);
    expect(headings.map(boldColour)).toEqual(headings.map(() => palette.text));
  });

  test("L12 in a light theme every block heading is bold plain text colour, not the periwinkle section colour", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills($, world, {
      top: TOP_THREE,
      allUsed: FIVE_USED,
      skills: EVERY_OWNER,
      theme: "light",
    });

    const headings = Object.values(blocksOf(await lines(pane), HEADINGS)).map(
      (block) => block.heading,
    );
    expect(headings).toHaveLength(5);
    expect(headings.map(boldColour)).toEqual(headings.map(() => palette.text));
  });

  test("L13 the heading of a block carries a dim count written 2 skills, or 1 skill for one", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills($, world, { skills: [COMMIT, ALPHA, RUNPOD] });

    const blocks = blocksOf(await lines(pane), HEADINGS);
    expect([blocks.User?.count, blocks.runpod?.count]).toEqual(["2 skills", "1 skill"]);
    expect(blocks.User?.heading.parts.some(isDimCount)).toBe(true);
    expect(blocks.runpod?.heading.parts.some(isDimCount)).toBe(true);
  });

  test("L14 the tab starts with a heading and one blank row sits before every other heading", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills($, world, {
      top: TOP_THREE,
      allUsed: FIVE_USED,
      skills: EVERY_OWNER,
    });

    const shown = await lines(pane);
    const headingIndexes = shown.flatMap((line, index) =>
      headingOrder([line], HEADINGS).length > 0 ? [index] : [],
    );
    expect(headingIndexes).toHaveLength(5);
    expect(headingIndexes[0]).toBe(0);
    for (const index of headingIndexes.slice(1)) {
      expect([shown[index - 2]?.text === "", shown[index - 1]?.text === ""]).toEqual([false, true]);
    }
  });

  test("L15 with no uses there is no Top used heading and no unfold button", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills($, world, { top: [], allUsed: [], skills: [COMMIT] });

    const shown = await lines(pane);
    expect(headingOrder(shown, HEADINGS)).toEqual(["User"]);
    expect(shown.some((line) => /all \d+ used|top 3/.test(line.text))).toBe(false);
  });

  test("L16 a skill with no description draws its name with no glyph, 2 blank cells in the glyph place, and the name still inserts", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills($, world, { skills: [BARE, COMMIT] });

    const user = blocksOf(await lines(pane), HEADINGS).User;
    const bare = bareRowOf(user, "bare-skill");
    const glyphRow = rowOf(user, "commit");
    expect(rowTexts(user)).toEqual(["bare-skill", "▸ commit"]);
    expect(glyphButtonOf(bare)).toBeUndefined();
    expect(bare?.indent).toBe((glyphRow?.indent ?? 0) + GLYPH_CELLS);
    await press(pane, nameButtonOf(bare, "bare-skill"));
    expect(world.events).toEqual(["insert:bare-skill"]);
  });

  test("L17 with three used skills or fewer Top used lists them all and draws no unfold button", async ($, on) => {
    const world = worldOf(on);
    const three = [
      { name: "deploy-notes", uses: 5 },
      { name: "commit", uses: 2 },
      { name: "docs", uses: 1 },
    ];

    const pane = await drawSkills($, world, { top: three, allUsed: three, skills: [COMMIT] });

    const shown = await lines(pane);
    expect(useRowsOf(blocksOf(shown, HEADINGS)["Top used"])).toEqual([
      ["deploy-notes", "5 uses"],
      ["commit", "2 uses"],
      ["docs", "1 use"],
    ]);
    expect(shown.some((line) => /all \d+ used|top 3/.test(line.text))).toBe(false);
  });

  test("L18 in a light theme the skill names are not dim and still insert when pressed", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills($, world, { theme: "light", skills: [COMMIT] });

    const row = await skillRow(pane, "User", "commit");
    const name = nameButtonOf(row, "commit");
    expect(name?.props?.dimColor).not.toBe(true);
    await press(pane, name);
    expect(world.events).toEqual(["insert:commit"]);
  });
});

function rowTexts(block: Block | undefined): string[] {
  return (block?.rows ?? []).map((row) => row.text);
}

function isDim(row: Line): boolean {
  return row.parts.every(
    (part) => part.props?.color === palette.muted || part.props?.dimColor === true,
  );
}

function isDimCount(part: Node): boolean {
  return /\d/.test(textOf(part)) && part.props?.color === palette.muted;
}

function boldColour(heading: Line): unknown {
  const label = heading.parts.find((part) => part.type === "Text" && isHeavy(part.props));
  return label?.props?.color;
}

async function lines(pane: Pane): Promise<Line[]> {
  return linesOf(await pane.drawn());
}

async function skillRow(pane: Pane, title: string, name: string): Promise<Line | undefined> {
  const row = rowOf(blocksOf(await lines(pane), HEADINGS)[title], name);
  expect(row, `a row for ${name}`).toBeDefined();
  return row;
}

async function press(pane: Pane, button: Node | undefined): Promise<void> {
  expect(button, "a button to press").toBeDefined();
  await pane.press({ key: keyOf(button), plugin: FIXTURE_PLUGIN });
}

function worldOf(on: On): DrawWorld {
  const world: DrawWorld = { events: [], view: viewWith(() => {}, {}) };
  on("ui.render", { component: "Pane", requestId: FIXTURE_ID }, ($, e) =>
    skillsTab($.ui.resolve(e), world.view),
  );
  return world;
}

function viewWith(note: (event: string) => void, options: DrawOptions): SkillsView {
  const { theme: _theme, ...view } = options;
  return {
    width: VIEW_WIDTH,
    isLightTheme: options.theme === "light",
    top: [],
    allUsed: [],
    statsOpen: false,
    skills: [],
    expanded: new Set(),
    ...view,
    toggle: (name) => note(`toggle:${name}`),
    insert: (name) => note(`insert:${name}`),
    toggleStats: () => note("stats"),
    ...{ clearUses: () => note("clear") },
  };
}

function drawSkills($: Engine, world: DrawWorld, options: DrawOptions): Promise<Pane> {
  notePaneTheme(options.theme ?? "dark");
  world.view = viewWith((event) => world.events.push(event), options);
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: FIXTURE_ID,
    props: {
      title: "Skills",
      isFocused: false,
      bodyColumns: COLUMNS,
      placement: "dock",
      scroll: { offset: 0, bodyRows: PANE_ROWS },
      view: {},
    },
    viewport: { columns: COLUMNS, rows: PANE_ROWS },
  });
}
