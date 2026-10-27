import { describe, expect, mock, test } from "claude-code/testing";
import type {
  CommandInfo,
  On,
  PromptBox,
  PromptFillInput,
  SessionContextBreakdown,
} from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { palette } from "../hooks/palette";
import type { Node } from "./draw-tree";
import { showTabThroughArrows } from "./spend-world";
import {
  blocksOf,
  clearButtonOf,
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
type ListedSkill = { name: string; source: string; pluginName?: string };
type World = {
  breakdownCalls: number;
  skillFilesRead: string[];
  box: PromptBox;
  submitted: string[];
  forgetState: () => void;
  storedValue: (key: string) => unknown;
  changeCwd: (folder: string) => void;
};
type WorldOptions = {
  skills: ListedSkill[];
  files?: Record<string, string>;
  hasMemoryState?: boolean;
  commands?: CommandInfo[];
  isCommandListFailing?: boolean;
  storeSeed?: Record<string, unknown>;
  theme?: string;
  draft?: string;
  isFillRefused?: boolean;
};

const COLUMNS = 60;
const PANE_ROWS = 40;
const NOW = 200_000;
const SETTLE_TICKS = 5;
const HOME = "/h/u";
const CWD = "/work";
const PLUGIN_ROOT = "/p";
const HEADINGS = ["Top used", "User", "Project", "runpod", "Built-in"];
const MANY_SKILLS = 60;
const DRAFT = "fix the login bug";
const LONG_DESCRIPTION =
  "Use this skill whenever a release has to be planned, checked and announced to the team, including notes, tags, the changelog entry and the final sign-off from the owner of the product.";
const COMMIT_DESCRIPTION = "Commit the staged changes with a short message.";
const RUNPOD_DESCRIPTION = "Start here for any Runpod task.";
const BODY_LINE = "Body text that must not show.";
const FOLDED_DESCRIPTION =
  "Commit the staged changes with a short message, and push them when the owner asks. Use when work is ready to ship.";
const FOLDED_SKILL_FILE = `---
name: commit
description: >-
  Commit the staged changes with a short message, and
  push them when the owner asks. Use when work is
  ready to ship.
allowed-tools: Bash(git:*)
---

# commit

${BODY_LINE}
`;
const BUILTIN_DESCRIPTION = "Change Claude Code settings through settings.json.";
const COMMAND_DESCRIPTION = "Migrate this codebase to REST v2.";
const COMMAND_FILE = `---
description: ${COMMAND_DESCRIPTION}
argument-hint: [scope: all | rest | graphql] [path]
---

Invoke the runpod-migrate skill on this repository.
`;

const COMMIT: ListedSkill = { name: "commit", source: "userSettings" };
const DEPLOY_NOTES: ListedSkill = { name: "deploy-notes", source: "userSettings" };
const RUNPOD: ListedSkill = { name: "runpod:runpod", source: "plugin", pluginName: "runpod" };
const UPDATE_CONFIG: ListedSkill = { name: "update-config", source: "built-in" };
const BUILTIN_COMMAND: CommandInfo = {
  name: "update-config",
  description: BUILTIN_DESCRIPTION,
  source: "builtin",
};
const USED_SKILLS: ListedSkill[] = ["commit", "deploy-notes", "lint-fix", "docs", "review"].map(
  (name) => ({ name, source: "userSettings" }),
);
const FIVE_USES = { "deploy-notes": 3, commit: 2, "lint-fix": 1, docs: 1, review: 1 };

describe("skills tab library", () => {
  test("K1 the Skills tab opens and the User block shows a skill as one closed row without its description", async ($, on) => {
    worldOf(on, { skills: [COMMIT], files: userFile("commit", COMMIT_DESCRIPTION) });
    await startIn($, CWD);

    const pane = await paneOnTab($, "Skills");

    const shown = await lines(pane);
    expect(rowTexts((await blocks(pane)).User)).toEqual(["▸ commit"]);
    expect(
      shown.some((line) => line.text.includes(COMMIT_DESCRIPTION) || line.text.includes(BODY_LINE)),
    ).toBe(false);
  });

  test("K2 each skill is under its own block, blocks come in the order User, Project, plugin, Built-in", async ($, on) => {
    worldOf(on, {
      skills: [UPDATE_CONFIG, RUNPOD, DEPLOY_NOTES, COMMIT],
      files: { ...userFile("commit", "User one."), ...projectFile("deploy-notes", "Project one.") },
    });
    await startIn($, CWD);

    const pane = await paneOnTab($, "Skills");

    const shown = await lines(pane);
    const found = await blocks(pane);
    expect(headingOrder(shown, HEADINGS)).toEqual(["User", "Project", "runpod", "Built-in"]);
    expect(rowTexts(found.User)).toEqual(["▸ commit"]);
    expect(rowTexts(found.Project)).toEqual(["▸ deploy-notes"]);
    expect(rowTexts(found.runpod)).toEqual(["runpod:runpod"]);
    expect(rowTexts(found["Built-in"])).toEqual(["update-config"]);
  });

  test("K2b block headings carry the count as N skills, and 1 skill for a single one", async ($, on) => {
    worldOf(on, {
      skills: [RUNPOD, DEPLOY_NOTES, COMMIT],
      files: { ...userFile("commit", "User one."), ...userFile("deploy-notes", "Two.") },
    });
    await startIn($, CWD);

    const pane = await paneOnTab($, "Skills");

    const found = await blocks(pane);
    expect([found.User?.count, found.runpod?.count]).toEqual(["2 skills", "1 skill"]);
  });

  test("K3 a plugin skill sits in a block titled with the plugin, its name keeps the colon, and it is not under User", async ($, on) => {
    worldOf(on, { skills: [RUNPOD, COMMIT], files: userFile("commit", "User one.") });
    await startIn($, CWD);

    const pane = await paneOnTab($, "Skills");

    const found = await blocks(pane);
    expect(rowTexts(found.runpod)).toEqual(["runpod:runpod"]);
    expect(rowTexts(found.User)).toEqual(["▸ commit"]);
  });

  test("K7 a built-in skill with no SKILL.md is listed by name with no error text", async ($, on) => {
    worldOf(on, {
      skills: [UPDATE_CONFIG, COMMIT],
      files: userFile("commit", COMMIT_DESCRIPTION),
    });
    await startIn($, CWD);

    const pane = await paneOnTab($, "Skills");

    const found = await blocks(pane);
    expect(rowTexts(found["Built-in"])).toEqual(["update-config"]);
    expect(rowTexts(found.User)).toEqual(["▸ commit"]);
    expect((await lines(pane)).some((line) => /error|ENOENT/i.test(line.text))).toBe(false);
  });

  test("K8 with no skills the tab opens and draws no block heading", async ($, on) => {
    worldOf(on, { skills: [] });
    await startIn($, CWD);

    const pane = await paneOnTab($, "Skills");

    expect(headingOrder(await lines(pane), HEADINGS)).toEqual([]);
  });

  test("K9 with 60 skills all 60 are drawn once, one row each, the last one too", async ($, on) => {
    const names = Array.from(
      { length: MANY_SKILLS },
      (_, i) => `skill-${String(i + 1).padStart(2, "0")}`,
    );
    worldOf(on, {
      skills: names.map((name) => ({ name, source: "userSettings" })),
      files: Object.fromEntries(
        names.map((name) => [
          `${HOME}/.claude/skills/${name}/SKILL.md`,
          skillFile(name, `About ${name}.`),
        ]),
      ),
    });
    await startIn($, CWD);

    const pane = await paneOnTab($, "Skills");

    expect(rowTexts((await blocks(pane)).User)).toEqual(names.map((name) => `▸ ${name}`));
  });
});

describe("skills tab open and close", () => {
  test("K18 clicking the glyph opens the description under the skill and clicking it again closes it", async ($, on) => {
    worldOf(on, { skills: [COMMIT], files: userFile("commit", COMMIT_DESCRIPTION) });
    await startIn($, CWD);
    const pane = await paneOnTab($, "Skills");

    await pressGlyph(pane, "commit");
    const opened = (await blocks(pane)).User;
    await pressGlyph(pane, "commit");
    const closed = (await blocks(pane)).User;

    expect(skillRowTexts(opened)).toEqual(["▾ commit"]);
    expect(descriptionOf(opened, "commit")).toBe(COMMIT_DESCRIPTION);
    expect(rowTexts(closed)).toEqual(["▸ commit"]);
  });

  test("K3b a plugin skill shows its real description under its name when opened", async ($, on) => {
    worldOf(on, {
      skills: [RUNPOD],
      files: {
        ...pluginRegistryFile(),
        [`${PLUGIN_ROOT}/skills/runpod/SKILL.md`]: skillFile("runpod", RUNPOD_DESCRIPTION),
      },
    });
    await startIn($, CWD);
    const pane = await paneOnTab($, "Skills");

    await pressGlyph(pane, "runpod:runpod");

    expect(descriptionOf((await blocks(pane)).runpod, "runpod:runpod")).toBe(RUNPOD_DESCRIPTION);
  });

  test("K17 a plugin command with no skills folder shows its description from commands/<name>.md when opened", async ($, on) => {
    worldOf(on, {
      skills: [{ name: "runpod:migrate", source: "plugin", pluginName: "runpod" }],
      files: {
        ...pluginRegistryFile(),
        [`${PLUGIN_ROOT}/commands/migrate.md`]: COMMAND_FILE,
      },
    });
    await startIn($, CWD);
    const pane = await paneOnTab($, "Skills");

    await pressGlyph(pane, "runpod:migrate");

    expect(descriptionOf((await blocks(pane)).runpod, "runpod:migrate")).toBe(COMMAND_DESCRIPTION);
  });

  test("K5 a long description opens whole with no …, and closed it is one row again", async ($, on) => {
    worldOf(on, { skills: [COMMIT], files: userFile("commit", LONG_DESCRIPTION) });
    await startIn($, CWD);
    const pane = await paneOnTab($, "Skills");

    await pressGlyph(pane, "commit");
    const opened = (await blocks(pane)).User;
    const openedLines = await lines(pane);
    await pressGlyph(pane, "commit");
    const closed = (await blocks(pane)).User;

    expect(descriptionOf(opened, "commit")).toBe(LONG_DESCRIPTION);
    expect(openedLines.some((line) => line.text.includes("…"))).toBe(false);
    expect(rowTexts(closed)).toEqual(["▸ commit"]);
  });

  test("K6 a description wrapped in quotes shows without the quotes when opened", async ($, on) => {
    worldOf(on, { skills: [COMMIT], files: userFile("commit", `"${COMMIT_DESCRIPTION}"`) });
    await startIn($, CWD);
    const pane = await paneOnTab($, "Skills");

    await pressGlyph(pane, "commit");

    expect(descriptionOf((await blocks(pane)).User, "commit")).toBe(COMMIT_DESCRIPTION);
  });

  test("K16 a description written as a >- block scalar shows as one text, with no key lines or body", async ($, on) => {
    worldOf(on, {
      skills: [COMMIT],
      files: { [`${HOME}/.claude/skills/commit/SKILL.md`]: FOLDED_SKILL_FILE },
    });
    await startIn($, CWD);
    const pane = await paneOnTab($, "Skills");

    await pressGlyph(pane, "commit");

    const shown = await lines(pane);
    expect(descriptionOf((await blocks(pane)).User, "commit")).toBe(FOLDED_DESCRIPTION);
    expect(shown.some((line) => /allowed-tools|>-|Bash\(git|---/.test(line.text))).toBe(false);
    expect(shown.some((line) => line.text.includes(BODY_LINE))).toBe(false);
  });
});

describe("skills tab built-in descriptions", () => {
  test("K30 a built-in skill with no SKILL.md and a command list description shows as a closed ▸ row", async ($, on) => {
    worldOf(on, { skills: [UPDATE_CONFIG], commands: [BUILTIN_COMMAND] });
    await startIn($, CWD);

    const pane = await paneOnTab($, "Skills");

    expect(rowTexts((await blocks(pane))["Built-in"])).toEqual(["▸ update-config"]);
  });

  test("K30b clicking the glyph of that built-in skill opens the command list description under it", async ($, on) => {
    worldOf(on, { skills: [UPDATE_CONFIG], commands: [BUILTIN_COMMAND] });
    await startIn($, CWD);
    const pane = await paneOnTab($, "Skills");

    await pressGlyph(pane, "update-config");

    const opened = (await blocks(pane))["Built-in"];
    expect(skillRowTexts(opened)).toEqual(["▾ update-config"]);
    expect(descriptionOf(opened, "update-config")).toBe(BUILTIN_DESCRIPTION);
  });

  test("K31 a skill with a SKILL.md and a command list entry opens the SKILL.md description", async ($, on) => {
    worldOf(on, {
      skills: [COMMIT],
      files: userFile("commit", COMMIT_DESCRIPTION),
      commands: [{ name: "commit", description: BUILTIN_DESCRIPTION, source: "user" }],
    });
    await startIn($, CWD);
    const pane = await paneOnTab($, "Skills");

    await pressGlyph(pane, "commit");

    expect(descriptionOf((await blocks(pane)).User, "commit")).toBe(COMMIT_DESCRIPTION);
  });

  test("K32 a built-in skill the command list does not mention stays a bare row with no glyph", async ($, on) => {
    worldOf(on, {
      skills: [UPDATE_CONFIG],
      commands: [{ name: "compact", description: "Free up context.", source: "builtin" }],
    });
    await startIn($, CWD);

    const pane = await paneOnTab($, "Skills");

    expect(rowTexts((await blocks(pane))["Built-in"])).toEqual(["update-config"]);
  });

  test("K32b a built-in skill whose command list description is empty stays a bare row with no glyph", async ($, on) => {
    worldOf(on, {
      skills: [UPDATE_CONFIG],
      commands: [{ ...BUILTIN_COMMAND, description: "" }],
    });
    await startIn($, CWD);

    const pane = await paneOnTab($, "Skills");

    expect(rowTexts((await blocks(pane))["Built-in"])).toEqual(["update-config"]);
  });

  test("K33 when the command list cannot be read the tab still opens, with SKILL.md skills as before and no error text", async ($, on) => {
    worldOf(on, {
      skills: [UPDATE_CONFIG, COMMIT],
      files: userFile("commit", COMMIT_DESCRIPTION),
      isCommandListFailing: true,
    });
    await startIn($, CWD);

    const pane = await paneOnTab($, "Skills");

    const found = await blocks(pane);
    expect(rowTexts(found["Built-in"])).toEqual(["update-config"]);
    expect(rowTexts(found.User)).toEqual(["▸ commit"]);
    expect((await lines(pane)).some((line) => /error|down/i.test(line.text))).toBe(false);
  });

  test("K34 when the command list is empty the tab looks as it did before", async ($, on) => {
    worldOf(on, {
      skills: [UPDATE_CONFIG, COMMIT],
      files: userFile("commit", COMMIT_DESCRIPTION),
      commands: [],
    });
    await startIn($, CWD);

    const pane = await paneOnTab($, "Skills");

    const found = await blocks(pane);
    expect(rowTexts(found["Built-in"])).toEqual(["update-config"]);
    expect(rowTexts(found.User)).toEqual(["▸ commit"]);
  });
});

describe("skills tab name click", () => {
  test("K19 clicking a name puts /name in front of the typed draft, sends nothing and leaves the skill closed", async ($, on) => {
    const world = worldOf(on, {
      skills: [COMMIT],
      files: userFile("commit", COMMIT_DESCRIPTION),
      draft: DRAFT,
    });
    await startIn($, CWD);
    const pane = await paneOnTab($, "Skills");

    await pressName(pane, "commit");

    expect(world.box.text).toBe(`/commit ${DRAFT}`);
    expect(world.submitted).toEqual([]);
    expect(rowTexts((await blocks(pane)).User)).toEqual(["▸ commit"]);
  });

  test("K19b clicking a name with an empty input leaves /name and a space in it", async ($, on) => {
    const world = worldOf(on, { skills: [COMMIT], files: userFile("commit", COMMIT_DESCRIPTION) });
    await startIn($, CWD);
    const pane = await paneOnTab($, "Skills");

    await pressName(pane, "commit");

    expect(world.box.text).toBe("/commit ");
    expect(world.submitted).toEqual([]);
  });

  test("K29 clicking a name when the draft already starts with that /name and a space changes nothing", async ($, on) => {
    const typed = `/commit ${DRAFT}`;
    const world = worldOf(on, {
      skills: [COMMIT],
      files: userFile("commit", COMMIT_DESCRIPTION),
      draft: typed,
    });
    await startIn($, CWD);
    const pane = await paneOnTab($, "Skills");

    await pressName(pane, "commit");

    expect(world.box.text).toBe(typed);
    expect(world.submitted).toEqual([]);
    expect(rowTexts((await blocks(pane)).User)).toEqual(["▸ commit"]);
  });

  test("K28 clicking a name while the input cannot take text leaves the draft and the tab as they were", async ($, on) => {
    const world = worldOf(on, {
      skills: [COMMIT],
      files: userFile("commit", COMMIT_DESCRIPTION),
      draft: DRAFT,
      isFillRefused: true,
    });
    await startIn($, CWD);
    const pane = await paneOnTab($, "Skills");

    await pressName(pane, "commit");

    expect(world.box.text).toBe(DRAFT);
    expect(rowTexts((await blocks(pane)).User)).toEqual(["▸ commit"]);
    expect((await lines(pane)).some((line) => /error|refused|cannot/i.test(line.text))).toBe(false);
  });

  test("K26 opening and closing a skill and unfolding Top used leave the typed draft in the input", async ($, on) => {
    const world = worldOf(on, {
      skills: USED_SKILLS,
      files: userFile("commit", COMMIT_DESCRIPTION),
      draft: "wip",
    });
    await startIn($, CWD);
    await useSkills($, FIVE_USES);
    const pane = await paneOnTab($, "Skills");

    await pressGlyph(pane, "commit");
    await pressGlyph(pane, "commit");
    await pressStats(pane);

    expect(world.box.text).toBe("wip");
    expect(world.submitted).toEqual([]);
  });
});

describe("skills tab top used", () => {
  test("K10 the top block shows the three most used skills with counts in count order, ties by name, no fourth, and the unfold button", async ($, on) => {
    worldOf(on, { skills: USED_SKILLS });
    await startIn($, CWD);
    await useSkills($, FIVE_USES);

    const pane = await paneOnTab($, "Skills");

    const top = (await blocks(pane))["Top used"];
    expect(useRowsOf(top)).toEqual([
      ["deploy-notes", "3 uses"],
      ["commit", "2 uses"],
      ["docs", "1 use"],
    ]);
    expect(statsButtonOf(top)?.text).toBe("▸ all 5 used");
  });

  test("K21 the unfold button lists every used skill with its count and the fold button returns to three", async ($, on) => {
    worldOf(on, { skills: USED_SKILLS });
    await startIn($, CWD);
    await useSkills($, FIVE_USES);
    const pane = await paneOnTab($, "Skills");

    await pressStats(pane);
    const unfolded = (await blocks(pane))["Top used"];
    await pressStats(pane);
    const folded = (await blocks(pane))["Top used"];

    expect(useRowsOf(unfolded)).toEqual([
      ["deploy-notes", "3 uses"],
      ["commit", "2 uses"],
      ["docs", "1 use"],
      ["lint-fix", "1 use"],
      ["review", "1 use"],
    ]);
    expect(statsButtonOf(unfolded)?.text).toBe("▾ top 3");
    expect(useRowsOf(folded)).toHaveLength(3);
    expect(statsButtonOf(folded)?.text).toBe("▸ all 5 used");
  });

  test("K21b with three used skills or fewer all of them show and there is no unfold button", async ($, on) => {
    worldOf(on, { skills: USED_SKILLS });
    await startIn($, CWD);
    await useSkills($, { "deploy-notes": 3, commit: 2, docs: 1 });

    const pane = await paneOnTab($, "Skills");

    const top = (await blocks(pane))["Top used"];
    expect(useRowsOf(top)).toEqual([
      ["deploy-notes", "3 uses"],
      ["commit", "2 uses"],
      ["docs", "1 use"],
    ]);
    expect((await lines(pane)).some((line) => /all \d+ used|top 3/.test(line.text))).toBe(false);
  });

  test("K11 with no uses there is no Top used block", async ($, on) => {
    worldOf(on, { skills: USED_SKILLS });
    await startIn($, CWD);

    const pane = await paneOnTab($, "Skills");

    expect(headingOrder(await lines(pane), HEADINGS)).not.toContain("Top used");
  });

  test("K12 a skill used while the tab is open changes the top block after the next redraw", async ($, on) => {
    worldOf(on, { skills: USED_SKILLS });
    await startIn($, CWD);
    await useSkills($, { commit: 1 });
    const pane = await paneOnTab($, "Skills");
    const before = useRowsOf((await blocks(pane))["Top used"]);

    await useSkills($, { "deploy-notes": 2 });
    await settle(pane);

    expect(before).toEqual([["commit", "1 use"]]);
    expect(useRowsOf((await blocks(pane))["Top used"])).toEqual([
      ["deploy-notes", "2 uses"],
      ["commit", "1 use"],
    ]);
  });

  test("K13 after a new session in the same folder the top block still shows the skills used before", async ($, on) => {
    const world = worldOf(on, { skills: USED_SKILLS, hasMemoryState: true });
    await startIn($, CWD);
    await useSkills($, { "deploy-notes": 3, commit: 2 });
    const first = await paneOnTab($, "Skills");
    await first.unmount();

    world.forgetState();
    await startIn($, CWD);
    const second = await paneOnTab($, "Skills");

    expect(useRowsOf((await blocks(second))["Top used"])).toEqual([
      ["deploy-notes", "3 uses"],
      ["commit", "2 uses"],
    ]);
  });
});

describe("skills tab top used clear button", () => {
  test("K35 the Top used heading line ends with a muted clear button", async ($, on) => {
    worldOf(on, { skills: USED_SKILLS });
    await startIn($, CWD);
    await useSkills($, FIVE_USES);

    const pane = await paneOnTab($, "Skills");

    const top = (await blocks(pane))["Top used"];
    expect(top?.heading.text).toBe("Top used clear");
    expect(clearButtonOf(top)?.props?.dimColor).toBe(true);
  });

  test("K36 with no uses there is no clear button in the tab", async ($, on) => {
    worldOf(on, { skills: USED_SKILLS });
    await startIn($, CWD);

    const pane = await paneOnTab($, "Skills");

    const buttons = await pane.findAll({ type: "Button" });
    expect(buttons.filter((button) => button.props.label === "clear")).toEqual([]);
  });

  test("K37 one click on clear removes Top used and its unfold button and leaves the library as it was", async ($, on) => {
    worldOf(on, { skills: USED_SKILLS, files: userFile("commit", COMMIT_DESCRIPTION) });
    await startIn($, CWD);
    await useSkills($, FIVE_USES);
    const pane = await paneOnTab($, "Skills");
    const libraryBefore = await libraryOf(pane);

    await pressClear(pane);

    const shown = await lines(pane);
    expect(headingOrder(shown, HEADINGS)).toEqual(["User"]);
    expect(shown.some((line) => /all \d+ used|top 3|clear/.test(line.text))).toBe(false);
    expect(await libraryOf(pane)).toEqual(libraryBefore);
  });

  test("K38 after clear a new session in the same folder still shows no Top used", async ($, on) => {
    const world = worldOf(on, { skills: USED_SKILLS, hasMemoryState: true });
    await startIn($, CWD);
    await useSkills($, FIVE_USES);
    const first = await paneOnTab($, "Skills");
    await pressClear(first);
    await first.unmount();

    world.forgetState();
    await startIn($, CWD);
    const second = await paneOnTab($, "Skills");

    expect((await blocks(second))["Top used"]).toBeUndefined();
  });

  test("K39 clear in one folder leaves the counts of another folder", async ($, on) => {
    const world = worldOf(on, {
      skills: USED_SKILLS,
      hasMemoryState: true,
      storeSeed: { skillUses: { [CWD]: { commit: 5 }, "/other": { commit: 9, docs: 2 } } },
    });
    await startIn($, CWD);
    const here = await paneOnTab($, "Skills");
    await pressClear(here);
    await here.unmount();

    world.forgetState();
    await startIn($, "/other");
    const there = await paneOnTab($, "Skills");

    expect(useRowsOf((await blocks(there))["Top used"])).toEqual([
      ["commit", "9 uses"],
      ["docs", "2 uses"],
    ]);
  });

  test("K40 after clear the next use of a skill counts from one", async ($, on) => {
    worldOf(on, { skills: USED_SKILLS, storeSeed: { skillUses: { [CWD]: { commit: 5 } } } });
    await startIn($, CWD);
    const pane = await paneOnTab($, "Skills");
    await pressClear(pane);

    await useSkills($, { commit: 1 });
    await settle(pane);

    expect(useRowsOf((await blocks(pane))["Top used"])).toEqual([["commit", "1 use"]]);
  });
});

describe("skills tab counts per launch folder", () => {
  test("K14 every use is added under the launch folder in the skillUses store key", async ($, on) => {
    const world = worldOf(on, { skills: USED_SKILLS });
    await startIn($, CWD);

    await useSkills($, { commit: 2, "deploy-notes": 1 });

    expect(world.storedValue("skillUses")).toEqual({ [CWD]: { commit: 2, "deploy-notes": 1 } });
  });

  test("K14b a use adds to the counts an earlier session left and leaves other folders alone", async ($, on) => {
    const world = worldOf(on, {
      skills: USED_SKILLS,
      storeSeed: { skillUses: { [CWD]: { commit: 5, docs: 2 }, "/other": { commit: 9 } } },
    });
    await startIn($, CWD);

    await useSkills($, { commit: 1, review: 1 });

    expect(world.storedValue("skillUses")).toEqual({
      [CWD]: { commit: 6, docs: 2, review: 1 },
      "/other": { commit: 9 },
    });
  });

  test("K22 uses in one folder do not show in another folder and come back in the first", async ($, on) => {
    const world = worldOf(on, { skills: USED_SKILLS, hasMemoryState: true });
    await startIn($, "/work/a");
    await useSkills($, { commit: 2 });
    world.forgetState();
    await startIn($, "/work/b");
    const inB = await paneOnTab($, "Skills");
    const topInB = (await blocks(inB))["Top used"];
    await useSkills($, { docs: 1 });
    await settle(inB);
    const topInBAfterUse = (await blocks(inB))["Top used"];
    await inB.unmount();
    world.forgetState();
    await startIn($, "/work/a");
    const backInA = await paneOnTab($, "Skills");

    expect(topInB).toBeUndefined();
    expect(useRowsOf(topInBAfterUse)).toEqual([["docs", "1 use"]]);
    expect(useRowsOf((await blocks(backInA))["Top used"])).toEqual([["commit", "2 uses"]]);
  });

  test("K23 a cd during the session does not move the counts to the new folder", async ($, on) => {
    const world = worldOf(on, { skills: USED_SKILLS });
    await startIn($, CWD);
    await useSkills($, { commit: 1 });
    const pane = await paneOnTab($, "Skills");

    world.changeCwd(`${CWD}/sub`);
    await useSkills($, { commit: 1 });
    await settle(pane);

    expect(useRowsOf((await blocks(pane))["Top used"])).toEqual([["commit", "2 uses"]]);
    expect(world.storedValue("skillUses")).toEqual({ [CWD]: { commit: 2 } });
  });
});

describe("skills tab heading look", () => {
  test("K24 in the dark theme block headings are bold plain text colour, not periwinkle", async ($, on) => {
    worldOf(on, {
      skills: [COMMIT, RUNPOD, UPDATE_CONFIG],
      files: userFile("commit", COMMIT_DESCRIPTION),
      theme: "dark",
    });
    await startIn($, CWD);
    await useSkills($, { commit: 1 });

    const pane = await paneOnTab($, "Skills");

    expect(await headingColours(pane)).toEqual([
      palette.text,
      palette.text,
      palette.text,
      palette.text,
    ]);
  });

  test("K25 in the light theme block headings are bold plain text colour, not periwinkle", async ($, on) => {
    worldOf(on, {
      skills: [COMMIT, RUNPOD, UPDATE_CONFIG],
      files: userFile("commit", COMMIT_DESCRIPTION),
      theme: "light",
    });
    await startIn($, CWD);
    await useSkills($, { commit: 1 });

    const pane = await paneOnTab($, "Skills");

    expect(await headingColours(pane)).toEqual([
      palette.text,
      palette.text,
      palette.text,
      palette.text,
    ]);
  });
});

describe("skills tab cost", () => {
  test("K15 leaving the tab for Files stops reading skill files and asking for the usage breakdown", async ($, on) => {
    const world = worldOf(on, { skills: [COMMIT], files: userFile("commit", COMMIT_DESCRIPTION) });
    await startIn($, CWD);
    const pane = await paneOnTab($, "Skills");
    expect(headingOrder(await lines(pane), HEADINGS)).toEqual(["User"]);
    await showTabThroughArrows(pane, "Files");
    world.skillFilesRead.length = 0;
    const breakdownsBefore = world.breakdownCalls;

    await $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: ["context"] });
    await settle(pane);

    expect(world.skillFilesRead).toEqual([]);
    expect(world.breakdownCalls).toBe(breakdownsBefore);
  });
});

function rowTexts(block: Block | undefined): string[] {
  return (block?.rows ?? []).map((row) => row.text);
}

function descriptionOf(block: Block | undefined, name: string): string {
  return descriptionRowsOf(block, name)
    .map((row) => row.text)
    .join(" ");
}

function pluginRegistryFile(): Record<string, string> {
  return {
    [`${HOME}/.claude/plugins/installed_plugins.json`]: JSON.stringify({
      plugins: { "runpod@marketplace": [{ installPath: PLUGIN_ROOT }] },
    }),
  };
}

function skillFile(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${BODY_LINE}\n`;
}

function userFile(name: string, description: string): Record<string, string> {
  return { [`${HOME}/.claude/skills/${name}/SKILL.md`]: skillFile(name, description) };
}

function projectFile(name: string, description: string): Record<string, string> {
  return { [`${CWD}/.claude/skills/${name}/SKILL.md`]: skillFile(name, description) };
}

async function startIn($: Engine, folder: string): Promise<void> {
  await $.session.start({ cwd: folder, surface: "terminal", isInteractive: true });
}

async function useSkills($: Engine, counts: Record<string, number>): Promise<void> {
  for (const [skill, times] of Object.entries(counts)) {
    for (let use = 0; use < times; use++) await $.skill.prompt({ skill, text: `Run ${skill}.` });
  }
}

async function lines(pane: Pane): Promise<Line[]> {
  return linesOf(await pane.drawn());
}

async function blocks(pane: Pane): Promise<Record<string, Block>> {
  return blocksOf(await lines(pane), HEADINGS);
}

async function headingColours(pane: Pane): Promise<unknown[]> {
  return Object.values(await blocks(pane)).map(
    (block) =>
      block.heading.parts.find((part) => part.type === "Text" && isHeavy(part.props))?.props?.color,
  );
}

async function settle(pane: Pane): Promise<void> {
  for (let tick = 0; tick < SETTLE_TICKS; tick++) await pane.redraw();
}

function applyFill(box: PromptBox, fill: PromptFillInput): PromptBox {
  if (fill.mode === "append") {
    return { text: box.text + fill.text, cursor: box.text.length + fill.text.length };
  }
  if (fill.mode === "insert") {
    return {
      text: box.text.slice(0, box.cursor) + fill.text + box.text.slice(box.cursor),
      cursor: box.cursor + fill.text.length,
    };
  }
  return { text: fill.text, cursor: fill.text.length };
}

function worldOf(on: On, options: WorldOptions): World {
  const stored = new Map<string, unknown>(Object.entries(options.storeSeed ?? {}));
  const stateValues = new Map<string, { value: unknown; version: number }>();
  let folder = CWD;
  const draft = options.draft ?? "";
  const world: World = {
    breakdownCalls: 0,
    skillFilesRead: [],
    box: { text: draft, cursor: draft.length },
    submitted: [],
    forgetState: () => stateValues.clear(),
    storedValue: (key) => stored.get(key),
    changeCwd: (next) => {
      folder = next;
    },
  };
  const fileText = (path: string): string | undefined => options.files?.[path];
  mock.clock(on, { now: NOW });
  mock.env(on, { HOME });
  on("config.list", () => ({ value: [{ key: "theme", value: options.theme ?? "dark" }] }) as never);
  on("store.get", (_$, e) => ({ value: stored.get(e.key) }));
  on("store.set", (_$, e) => {
    stored.set(e.key, e.value);
    return { value: undefined };
  });
  on("store.delete", (_$, e) => {
    stored.delete(e.key);
    return { value: undefined };
  });
  on("store.keys", () => ({ value: [...stored.keys()] }));
  if (options.hasMemoryState === true) {
    on("state.get", (_$, e) => ({
      value: stateValues.get(e.key) ?? { value: undefined, version: 0 },
    }));
    on("state.set", (_$, e) => {
      const version = (stateValues.get(e.key)?.version ?? 0) + 1;
      stateValues.set(e.key, { value: e.value, version });
      return { value: { isSet: true, version } };
    });
  }
  if (options.isCommandListFailing === true) {
    on("command.list", () => {
      throw new Error("command list is down");
    });
  } else if (options.commands !== undefined) {
    on("command.list", () => ({ value: options.commands }) as never);
  }
  on("classic.SessionStart", () => ({}));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("command.register", () => ({ value: {} }) as never);
  on("agent.list", () => ({ value: [] }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("skill.prompt", (_$, e) => ({ text: e.text }));
  on("prompt.read", () => ({ value: { ...world.box } }));
  on("prompt.fill", (_$, e) => {
    if (options.isFillRefused === true) return { isFilled: false, refusal: "dialog" };
    world.box = applyFill(world.box, e);
    return { isFilled: true };
  });
  on("prompt.submit", (_$, e) => {
    world.submitted.push(e.text);
    return { text: e.text };
  });
  on("session.usage", (_$, e) => {
    if (e.breakdown !== undefined) world.breakdownCalls++;
    const breakdown = {
      categories: [],
      totalTokens: 0,
      rawMaxTokens: 200_000,
      gridRows: [],
      memoryFiles: [],
      agents: [],
      mcpTools: [],
      skills: {
        totalSkills: options.skills.length,
        includedSkills: options.skills.length,
        tokens: 0,
        skillFrontmatter: options.skills.map((skill) => ({ ...skill, tokens: 10 })),
      },
    } as unknown as SessionContextBreakdown;
    const context =
      e.breakdown === undefined ? { window: 200_000 } : { window: 200_000, breakdown };
    return { value: { startedAt: 0, context, rateLimits: [] } };
  });
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: folder }));
  on("fs.exists", (_$, e) => ({ value: fileText(e.path) !== undefined }));
  on("fs.read", (_$, e) => {
    world.skillFilesRead.push(e.path);
    const text = fileText(e.path);
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`);
    return { value: text };
  });
  on("ui.render", { component: "Pane" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine pane</Text>;
  });
  return world;
}

function mountPane($: Engine): Promise<Pane> {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    requestId: "session",
    props: {
      title: "Session",
      isFocused: false,
      bodyColumns: COLUMNS,
      placement: "dock",
      scroll: { offset: 0, bodyRows: PANE_ROWS },
      view: {},
    },
    viewport: { columns: COLUMNS, rows: PANE_ROWS },
  });
}

async function paneOnTab($: Engine, label: string): Promise<Pane> {
  const pane = await mountPane($);
  await showTabThroughArrows(pane, label);
  return pane;
}

async function skillRow(pane: Pane, name: string): Promise<Line | undefined> {
  const row = Object.values(await blocks(pane))
    .map((block) => rowOf(block, name))
    .find((found) => found !== undefined);
  expect(row, `a row for ${name}`).toBeDefined();
  return row;
}

async function pressNode(pane: Pane, button: Node | undefined): Promise<void> {
  expect(button, "a button to press").toBeDefined();
  await pane.press({ key: keyOf(button) });
  await settle(pane);
}

async function pressGlyph(pane: Pane, name: string): Promise<void> {
  await pressNode(pane, glyphButtonOf(await skillRow(pane, name)));
}

async function pressName(pane: Pane, name: string): Promise<void> {
  await pressNode(pane, nameButtonOf(await skillRow(pane, name), name));
}

async function libraryOf(pane: Pane): Promise<Record<string, string[]>> {
  const { "Top used": _top, ...library } = await blocks(pane);
  return Object.fromEntries(
    Object.entries(library).map(([title, block]) => [title, rowTexts(block)]),
  );
}

async function pressClear(pane: Pane): Promise<void> {
  const clear = clearButtonOf((await blocks(pane))["Top used"]);
  expect(clear, "a clear button on the Top used heading").toBeDefined();
  await pressNode(pane, clear);
}

async function pressStats(pane: Pane): Promise<void> {
  const row = statsButtonOf((await blocks(pane))["Top used"]);
  await pressNode(
    pane,
    row?.parts.find((part) => part.type === "Button"),
  );
}
