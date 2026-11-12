import { describe, expect, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { palette } from "../hooks/palette";
import { notePaneTheme, paneInk } from "../hooks/pane-ink";
import { skillsTab } from "../hooks/skills-draw";
import type { SkillEntry, SkillsView } from "../hooks/skills-draw";
import { colouredPieces, coloursOfText, screenRows } from "./band-screen";
import { childrenOf, collect, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import {
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
const VIEW_NOW = 1_800_000_000_000;
const PANE_ROWS = 40;
const FIXTURE_ID = "skills-draw";
const FIXTURE_PLUGIN = "test";
const DESCRIPTION_INDENT = 2;
const HEADINGS = ["Top used", "User", "Project", "runpod", "superpowers", "Built-in"];
const LONG_DESCRIPTION =
  "Use this skill whenever a release has to be planned, checked and announced to the team, including notes, tags and the final sign-off.";
const ONE_LINE = "Commit the staged changes.";
const THIS_PROJECT = "· this project";
const ALL_PROJECTS = "· all projects";
const LOOP_TOKENS = 115;
const SCOPE_COLUMNS = 60;
const WIDE_SCOPE_COLUMNS = 120;

const COMMIT: SkillEntry = { name: "commit", description: ONE_LINE, owner: "user", tokens: 0 };
const ALPHA: SkillEntry = { name: "alpha", description: ONE_LINE, owner: "user", tokens: 0 };
const DEPLOY: SkillEntry = {
  name: "deploy-notes",
  description: LONG_DESCRIPTION,
  owner: "project",
  tokens: 0,
};
const RELEASE: SkillEntry = {
  name: "release-notes",
  description: ONE_LINE,
  owner: "project",
  tokens: 0,
};
const RUNPOD: SkillEntry = {
  name: "runpod:runpod",
  description: LONG_DESCRIPTION,
  owner: "plugin",
  tokens: 0,
  plugin: "runpod",
};
const RUNPOD_FLASH: SkillEntry = {
  name: "runpod:flash",
  description: ONE_LINE,
  owner: "plugin",
  tokens: 0,
  plugin: "runpod",
};
const BRAINSTORM: SkillEntry = {
  name: "superpowers:brainstorming",
  description: ONE_LINE,
  owner: "plugin",
  tokens: 0,
  plugin: "superpowers",
};
const UPDATE_CONFIG: SkillEntry = {
  name: "update-config",
  description: ONE_LINE,
  owner: "built-in",
  tokens: 0,
};
const BARE: SkillEntry = { name: "bare-skill", description: "", owner: "user", tokens: 0 };
const FIVE_USED = [
  { name: "deploy-notes", uses: 5 },
  { name: "commit", uses: 2 },
  { name: "runpod:runpod", uses: 1 },
  { name: "docs", uses: 1 },
  { name: "review", uses: 1 },
];
const TOP_THREE = FIVE_USED.slice(0, 3);
const MANY_USES = 543;
const FEW_USES = 7;
const TWO_DIGIT_USES = 12;
const ONE_DIGIT_USES = 5;
const THREE_DAYS_MS = 3 * 86_400_000;
const TWO_HOURS_MS = 2 * 3_600_000;
const EVERY_OWNER = [COMMIT, DEPLOY, RUNPOD, UPDATE_CONFIG];
const COLUMN_GAP = 2;
const LARGE_TOKENS = 250;
const SMALL_TOKENS = 40;
const NO_TOKENS = 0;

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
    expect(skillRowTexts(blocks.runpod)).toEqual([
      "▸ runpod:flash 0 tokens",
      "▸ runpod:runpod 0 tokens",
    ]);
    expect(skillRowTexts(blocks.superpowers)).toEqual(["▸ superpowers:brainstorming 0 tokens"]);
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
    expect(skillRowTexts(blocks.User)).toEqual(["▸ alpha 0 tokens", "▸ commit 0 tokens"]);
    expect(skillRowTexts(blocks.runpod)).toEqual([
      "▸ runpod:flash 0 tokens",
      "▸ runpod:runpod 0 tokens",
    ]);
  });

  test("L4 closed skills with descriptions are exactly one row each and no description is on screen", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills($, world, { skills: [COMMIT, DEPLOY, RUNPOD] });

    const blocks = blocksOf(await lines(pane), HEADINGS);
    expect(rowTexts(blocks.User)).toEqual(["▸ commit 0 tokens"]);
    expect(rowTexts(blocks.Project)).toEqual(["▸ deploy-notes 0 tokens"]);
    expect(rowTexts(blocks.runpod)).toEqual(["▸ runpod:runpod 0 tokens"]);
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
    expect(skillRowTexts(project)).toEqual(["▾ deploy-notes 0 tokens", "▸ release-notes 0 tokens"]);
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
    expect(skillRowTexts(blocks.User)).toEqual(["▸ commit 0 tokens"]);
    expect(skillRowTexts(blocks.Project)).toEqual(["▸ deploy-notes 0 tokens"]);
    expect(skillRowTexts(blocks.runpod)).toEqual(["▸ runpod:runpod 0 tokens"]);
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

  test("L14 the tab starts with the filter row, one blank row and a heading, and one blank row sits before every other heading", async ($, on) => {
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
    expect(shown[0]?.text).toBe("f filter");
    expect(shown[1]?.text).toBe("");
    expect(headingIndexes[0]).toBe(2);
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

  test("T2-a pressing the f Button of the filter row asks to focus the field", async ($, on) => {
    const world = worldOf(on);
    const pane = await drawSkills($, world, { skills: [COMMIT] });

    const button = (await pane.findAll({ type: "Button" })).find(
      (found) => found.props.label === "filter",
    );
    await press(pane, button);

    expect(button?.props.hotkey).toBe("f");
    expect(world.events).toEqual(["focus"]);
  });

  test("L16 a skill with no description draws a closed toggle like the others, and its name still inserts", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills($, world, { skills: [BARE, COMMIT] });

    const user = blocksOf(await lines(pane), HEADINGS).User;
    const bare = rowOf(user, "bare-skill");
    expect(rowTexts(user)).toEqual(["▸ bare-skill 0 tokens", "▸ commit 0 tokens"]);
    expect(glyphButtonOf(bare)).toBeDefined();
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

  test("G1 owner rows with 543 and 7 uses line their uses words up, the count in text colour and uses and age muted", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills($, world, {
      skills: [COMMIT, ALPHA],
      usage: {
        commit: { usageCount: MANY_USES, lastUsedAt: VIEW_NOW - THREE_DAYS_MS },
        alpha: { usageCount: FEW_USES, lastUsedAt: VIEW_NOW - TWO_HOURS_MS },
      },
    });

    const drawn = await pane.drawn();
    const ink = paneInk();
    expect(textColoursOf(drawn, String(MANY_USES))).toEqual([ink.text]);
    expect(textColoursOf(drawn, String(FEW_USES))).toEqual([ink.text]);
    expect(textColoursOf(drawn, "uses", "includes")).toEqual([ink.muted, ink.muted]);
    expect(textColoursOf(drawn, "3d", "includes")).toEqual([ink.muted]);
    expect(usesWordOffsets(drawn)).toEqual([4, 4]);
  });

  test("G2 Top used rows with 12 and 5 uses pad the count so the uses words line up, the count in text colour and uses muted", async ($, on) => {
    const world = worldOf(on);
    const top = [
      { name: "deploy-notes", uses: TWO_DIGIT_USES },
      { name: "commit", uses: ONE_DIGIT_USES },
    ];

    const pane = await drawSkills($, world, { top, allUsed: top, skills: [COMMIT] });

    const drawn = await pane.drawn();
    const ink = paneInk();
    expect(textColoursOf(drawn, String(TWO_DIGIT_USES))).toEqual([ink.text]);
    expect(textColoursOf(drawn, String(ONE_DIGIT_USES))).toEqual([ink.text]);
    expect(textColoursOf(drawn, "uses", "includes")).toEqual([ink.muted, ink.muted]);
    expect(usesWordOffsets(drawn)).toEqual([3, 3]);
  });

  test("G11 owner rows with 543, 7 and 1 uses end their counts in the same cell, so use and uses start together and the ages line up", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills($, world, {
      skills: [COMMIT, ALPHA, BARE],
      usage: {
        commit: { usageCount: MANY_USES, lastUsedAt: VIEW_NOW - THREE_DAYS_MS },
        alpha: { usageCount: FEW_USES, lastUsedAt: VIEW_NOW - THREE_DAYS_MS },
        "bare-skill": { usageCount: 1, lastUsedAt: VIEW_NOW - THREE_DAYS_MS },
      },
    });

    const columns = useColumnsOf(await pane.drawn());
    expect(columns.map((column) => column.countEnd)).toEqual([
      columns[0]?.countEnd,
      columns[0]?.countEnd,
      columns[0]?.countEnd,
    ]);
    expect(columns.map((column) => column.age)).toEqual([
      columns[0]?.age,
      columns[0]?.age,
      columns[0]?.age,
    ]);
  });

  test("G12 Top used rows with 12 and 1 uses end their counts in the same cell, so use and uses start together", async ($, on) => {
    const world = worldOf(on);
    const top = [
      { name: "deploy-notes", uses: TWO_DIGIT_USES },
      { name: "commit", uses: 1 },
    ];

    const pane = await drawSkills($, world, { top, allUsed: top, skills: [COMMIT] });

    const columns = useColumnsOf(await pane.drawn());
    expect(columns.map((column) => column.countEnd)).toEqual([
      columns[0]?.countEnd,
      columns[0]?.countEnd,
    ]);
  });

  test("G13 a skill row shows its token count first on the right, the number in text colour and the word tokens muted", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills($, world, {
      skills: [{ ...COMMIT, tokens: LARGE_TOKENS }],
      usage: { commit: { usageCount: FEW_USES, lastUsedAt: VIEW_NOW - TWO_HOURS_MS } },
    });

    const drawn = await pane.drawn();
    const ink = paneInk();
    expect(textColoursOf(drawn, String(LARGE_TOKENS))).toEqual([ink.text]);
    expect(textColoursOf(drawn, "tokens")).toEqual([ink.muted]);
    expect(tokenBoxTextsOf(drawn).map((text) => /^\s*250 tokens/u.test(text))).toEqual([true]);
  });

  test("G14 skill rows with 250 and 40 tokens put the word tokens in the same column", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills($, world, {
      skills: [
        { ...COMMIT, tokens: LARGE_TOKENS },
        { ...ALPHA, tokens: SMALL_TOKENS },
      ],
      usage: {
        commit: { usageCount: FEW_USES, lastUsedAt: VIEW_NOW - TWO_HOURS_MS },
        alpha: { usageCount: FEW_USES, lastUsedAt: VIEW_NOW - TWO_HOURS_MS },
      },
    });

    const columns = tokenWordColumnsOf(await pane.drawn());
    expect(columns).toHaveLength(2);
    expect(new Set(columns).size).toBe(1);
  });

  test("G15 a skill with no tokens shows 0 tokens with both the number and the word muted", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills($, world, {
      skills: [{ ...COMMIT, tokens: NO_TOKENS }],
    });

    const drawn = await pane.drawn();
    const ink = paneInk();
    expect(textColoursOf(drawn, String(NO_TOKENS))).toEqual([ink.muted]);
    expect(textColoursOf(drawn, "tokens")).toEqual([ink.muted]);
  });

  test("F2 never used rows whose owners are User and runpod end their tokens figure in the same cell", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills($, world, {
      skills: [
        { ...BARE, tokens: LARGE_TOKENS },
        { ...RUNPOD_FLASH, tokens: SMALL_TOKENS },
      ],
      usage: {},
      neverOpen: true,
    });

    const rows = screenRows(await pane.drawn(), VIEW_WIDTH).map((row) => row.trimEnd());
    const figureEnds = ["bare-skill", "runpod:flash"].map((name) => {
      const row = rows.find((candidate) => candidate.includes(name));
      expect(row, `a never used row for ${name}`).toBeDefined();
      return (row ?? "").indexOf("tokens") + "tokens".length;
    });
    expect(figureEnds[0]).toBe(figureEnds[1]);
  });

  test("G16 a skill in the never used list shows its token count before its owner", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills($, world, {
      skills: [{ ...BARE, tokens: LARGE_TOKENS }],
      usage: {},
      neverOpen: true,
    });

    const rows = (await lines(pane)).map((line) => line.text);
    expect(rows.find((text) => text.startsWith("▸ bare-skill"))).toMatch(/250 tokens.*User/u);
  });

  test("G17 a skill used 565 times with 115 tokens keeps 2 empty cells between tokens and its uses count, and the tokens and uses words still line up with the other rows", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills($, world, {
      skills: [
        { ...COMMIT, name: "loop", tokens: 115 },
        { ...ALPHA, tokens: LARGE_TOKENS },
      ],
      usage: {
        loop: { usageCount: 565, lastUsedAt: VIEW_NOW - THREE_DAYS_MS },
        alpha: { usageCount: FEW_USES, lastUsedAt: VIEW_NOW - THREE_DAYS_MS },
      },
    });

    const rows = screenRows(await pane.drawn(), VIEW_WIDTH).map((row) => row.trimEnd());
    const figures = ["loop", "alpha"].map((name) => figureRowOf(rows, name, /(\d+) uses?\b/u));
    expect(figures.map((figure) => figure.gap >= COLUMN_GAP)).toEqual([true, true]);
    expect(new Set(figures.map((figure) => figure.tokensEnd)).size).toBe(1);
    expect(new Set(figures.map((figure) => figure.nextEnd)).size).toBe(1);
  });

  test("G18 in the never used list a skill keeps 2 empty cells between tokens and its owner", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills($, world, {
      skills: [
        { ...BARE, tokens: SMALL_TOKENS },
        { ...RUNPOD_FLASH, tokens: LARGE_TOKENS },
      ],
      usage: {},
      neverOpen: true,
    });

    const rows = screenRows(await pane.drawn(), VIEW_WIDTH).map((row) => row.trimEnd());
    const gaps = [
      figureRowOf(rows, "bare-skill", /(User)$/u).gap,
      figureRowOf(rows, "runpod:flash", /(runpod)$/u).gap,
    ];
    expect(gaps.map((gap) => gap >= COLUMN_GAP)).toEqual([true, true]);
  });
});

describe("skills scope words", () => {
  test("A1 at 60 columns with Top used shown, the Top used heading says this project and every owner heading that shows uses says all projects", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills(
      $,
      world,
      {
        width: SCOPE_COLUMNS,
        skills: [
          { ...COMMIT, name: "loop", tokens: LOOP_TOKENS },
          ALPHA,
          RELEASE,
          RUNPOD_FLASH,
          UPDATE_CONFIG,
          BARE,
        ],
        top: [
          { name: "loop", uses: MANY_USES },
          { name: "alpha", uses: FEW_USES },
        ],
        allUsed: [
          { name: "loop", uses: MANY_USES },
          { name: "alpha", uses: FEW_USES },
        ],
        usage: {
          loop: { usageCount: MANY_USES, lastUsedAt: VIEW_NOW - THREE_DAYS_MS },
          alpha: { usageCount: FEW_USES, lastUsedAt: VIEW_NOW - THREE_DAYS_MS },
          "release-notes": { usageCount: FEW_USES, lastUsedAt: VIEW_NOW - THREE_DAYS_MS },
          "runpod:flash": { usageCount: FEW_USES, lastUsedAt: VIEW_NOW - THREE_DAYS_MS },
          "update-config": { usageCount: FEW_USES, lastUsedAt: VIEW_NOW - THREE_DAYS_MS },
        },
      },
      SCOPE_COLUMNS,
    );

    const drawn = await pane.drawn();
    const scoped = scopedRowsOf(screenRows(drawn, SCOPE_COLUMNS).map((row) => row.trimEnd()));
    expect(scoped).toHaveLength(5);
    expect(scoped[0]).toMatch(/^Top used · this project\b/u);
    expect(scoped[1]).toMatch(/^User · all projects\b/u);
    expect(scoped[2]).toMatch(/^Project · all projects\b/u);
    expect(scoped[3]).toMatch(/^runpod · all projects\b/u);
    expect(scoped[4]).toMatch(/^Built-in · all projects\b/u);
    expect(coloursOfText(drawn, THIS_PROJECT)).toEqual([palette.muted]);
    expect(
      colouredPieces(drawn)
        .filter((piece) => piece.text.includes(ALL_PROJECTS))
        .map((piece) => piece.color),
    ).toEqual([palette.muted, palette.muted, palette.muted, palette.muted]);
  });

  test("A2 at 120 columns with no Top used, the User and the Project heading both say all projects and nothing says this project", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills(
      $,
      world,
      {
        width: WIDE_SCOPE_COLUMNS,
        skills: [{ ...COMMIT, name: "loop", tokens: LOOP_TOKENS }, ALPHA, RELEASE],
        top: [],
        usage: {
          loop: { usageCount: MANY_USES, lastUsedAt: VIEW_NOW - THREE_DAYS_MS },
          alpha: { usageCount: FEW_USES, lastUsedAt: VIEW_NOW - THREE_DAYS_MS },
          "release-notes": { usageCount: FEW_USES, lastUsedAt: VIEW_NOW - THREE_DAYS_MS },
        },
      },
      WIDE_SCOPE_COLUMNS,
    );

    const drawn = await pane.drawn();
    const rows = screenRows(drawn, WIDE_SCOPE_COLUMNS).map((row) => row.trimEnd());
    const scoped = scopedRowsOf(rows);
    expect(scoped).toHaveLength(2);
    expect(scoped[0]).toMatch(/^User · all projects\b/u);
    expect(scoped[1]).toMatch(/^Project · all projects\b/u);
    expect(rows.some((row) => row.includes(THIS_PROJECT))).toBe(false);
  });

  test("A3 with no Claude usage file, the Top used heading still says this project and no heading says all projects", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills(
      $,
      world,
      {
        width: SCOPE_COLUMNS,
        skills: [{ ...COMMIT, name: "loop", tokens: LOOP_TOKENS }, ALPHA],
        top: [{ name: "loop", uses: MANY_USES }],
        allUsed: [{ name: "loop", uses: MANY_USES }],
        usage: null,
      },
      SCOPE_COLUMNS,
    );

    const rows = screenRows(await pane.drawn(), SCOPE_COLUMNS).map((row) => row.trimEnd());
    const scoped = scopedRowsOf(rows);
    expect(scoped).toHaveLength(1);
    expect(scoped[0]).toMatch(/^Top used · this project\b/u);
    expect(rows.some((row) => row.includes(ALL_PROJECTS))).toBe(false);
  });
});

describe("skills top used columns", () => {
  test("Q3 a Top used row shows its skill's 115 tokens before its uses", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills(
      $,
      world,
      {
        width: SCOPE_COLUMNS,
        skills: [{ ...COMMIT, name: "loop", tokens: LOOP_TOKENS }],
        top: [{ name: "loop", uses: MANY_USES }],
        allUsed: [{ name: "loop", uses: MANY_USES }],
        usage: { loop: { usageCount: MANY_USES, lastUsedAt: VIEW_NOW - THREE_DAYS_MS } },
      },
      SCOPE_COLUMNS,
    );

    const rows = screenRows(await pane.drawn(), SCOPE_COLUMNS).map((row) => row.trimEnd());
    expect(topRowOf(rows, "loop")).toMatch(/^loop\s+115 tokens\s+543 uses$/u);
  });

  test("Q3b a Top used row and the owner row of the same skill put tokens and uses in the same columns", async ($, on) => {
    const world = worldOf(on);

    const pane = await drawSkills(
      $,
      world,
      {
        width: SCOPE_COLUMNS,
        skills: [{ ...COMMIT, name: "loop", tokens: LOOP_TOKENS }],
        top: [{ name: "loop", uses: MANY_USES }],
        allUsed: [{ name: "loop", uses: MANY_USES }],
        usage: { loop: { usageCount: MANY_USES, lastUsedAt: VIEW_NOW - THREE_DAYS_MS } },
      },
      SCOPE_COLUMNS,
    );

    const rows = screenRows(await pane.drawn(), SCOPE_COLUMNS).map((row) => row.trimEnd());
    const top = topRowOf(rows, "loop");
    const owner = rows.find((row) => row.startsWith("▸ loop")) ?? "";
    expect(owner, "the owner row of loop").not.toBe("");
    expect(top.indexOf("tokens")).toBe(owner.indexOf("tokens"));
    expect(top.indexOf(" uses")).toBe(owner.indexOf(" uses"));
  });
});

function tokenBoxTextsOf(tree: Node): string[] {
  return collect(tree, "Box")
    .filter((box) => box.props?.flexShrink === 0 && /\btokens\b/.test(textOf(box)))
    .map((box) => textOf(box));
}

function figureRowOf(
  rows: string[],
  name: string,
  next: RegExp,
): { gap: number; tokensEnd: number; nextEnd: number } {
  const row = rows.find((candidate) => candidate.includes(name)) ?? "";
  expect(row, `a row for ${name}`).not.toBe("");
  const tokensEnd = row.indexOf("tokens") + "tokens".length;
  const after = row.slice(tokensEnd);
  const following = next.exec(after);
  expect(following, `"${next.source}" after tokens in "${row}"`).not.toBeNull();
  const gap = after.length - after.trimStart().length;
  return { gap, tokensEnd, nextEnd: tokensEnd + gap + (following?.[1]?.length ?? 0) };
}

function tokenWordColumnsOf(tree: Node): number[] {
  return tokenBoxTextsOf(tree).map((text) => VIEW_WIDTH - text.length + text.indexOf("tokens"));
}

function useColumnsOf(tree: Node): { countEnd: number; age: number }[] {
  return collect(tree, "Box")
    .filter((box) => box.props?.flexShrink === 0 && /\buses?\b/.test(textOf(box)))
    .map((box) => ({
      countEnd: VIEW_WIDTH - textOf(box).length + textOf(box).search(/ uses?\b/),
      age: VIEW_WIDTH - textOf(box).length + textOf(box).indexOf("·"),
    }));
}

function textColoursOf(
  tree: Node,
  word: string,
  match: "equals" | "includes" = "equals",
): unknown[] {
  return collect(tree, "Text")
    .filter((text) => childrenOf(text).length === 0)
    .filter((text) =>
      match === "equals" ? textOf(text).trim() === word : textOf(text).includes(word),
    )
    .map((text) => text.props?.color);
}

function usesWordOffsets(tree: Node): number[] {
  return collect(tree, "Box")
    .filter((box) => box.props?.flexShrink === 0 && /\buses?\b/.test(textOf(box)))
    .map((box) => textOf(box).indexOf("uses"));
}

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
    filter: "",
    setFilter: () => {},
    focusFilter: () => note("focus"),
    usage: null,
    now: VIEW_NOW,
    neverOpen: false,
    offNames: new Set(),
    ...view,
    toggle: (name) => note(`toggle:${name}`),
    insert: (name) => note(`insert:${name}`),
    toggleStats: () => note("stats"),
    toggleNever: () => note("never"),
    setOff: (name, off) => note(`${off ? "off" : "on"}:${name}`),
    ...{ clearUses: () => note("clear") },
  };
}

function drawSkills(
  $: Engine,
  world: DrawWorld,
  options: DrawOptions,
  columns: number = COLUMNS,
): Promise<Pane> {
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
      bodyColumns: columns,
      placement: "dock",
      scroll: { offset: 0, bodyRows: PANE_ROWS },
      view: {},
    },
    viewport: { columns, rows: PANE_ROWS },
  });
}

function topRowOf(rows: string[], name: string): string {
  const row = rows.find((candidate) => new RegExp(`^${name}\\s`, "u").test(candidate));
  expect(row, `a Top used row for ${name}`).toBeDefined();
  return row ?? "";
}

function scopedRowsOf(rows: string[]): string[] {
  return rows.filter((row) => row.includes(THIS_PROJECT) || row.includes(ALL_PROJECTS));
}
