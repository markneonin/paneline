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
import { screenRows } from "./band-screen";
import { collect, textOf } from "./draw-tree";
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
  diskText: (path: string) => string | undefined;
  releaseFull: () => void;
  toasts: () => string[];
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
  caret?: number;
  isFillRefused?: boolean;
  fullTokens?: number;
  fullTokensBySkill?: Record<string, number>;
  holdFull?: boolean;
  failFull?: boolean;
};

const COLUMNS = 60;
const PANE_ROWS = 40;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const NOW = 1_800_000_000_000;
const SETTLE_TICKS = 5;
const HOME = "/h/u";
const CWD = "/work";
const PLUGIN_ROOT = "/p";
const HEADINGS = ["Top used", "User", "Project", "runpod", "Built-in", "Off"];
const LOCAL_SETTINGS = ".claude/settings.local.json";
const CLAUDE_JSON = `${HOME}/.claude.json`;
const NEVER_USED = /^[▸▾] never used/;
const LOCAL_PATH = `${CWD}/${LOCAL_SETTINGS}`;
const LONG_SKILL_NAME = "a-skill-name-much-too-long-to-fit-beside-its-use-count-column";
const MANY_SKILLS = 60;
const QUICK_TOKENS = 10;
const THIS_PROJECT = "· this project";
const ALL_PROJECTS = "· all projects";
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
const RELEASE_NOTES: ListedSkill = { name: "release-notes", source: "projectSettings" };
const DOCS: ListedSkill = { name: "docs", source: "userSettings" };
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

const PROMPTS_TITLE = "Prompts";
const PROJECT_PROMPTS_TITLE = "Project prompts";
const PROMPT_TITLES = [PROMPTS_TITLE, PROJECT_PROMPTS_TITLE, ...HEADINGS];
const GLOBAL_PROMPTS_PATH = `${HOME}/.claude/paneline-prompts.md`;
const PROJECT_PROMPTS_PATH = `${CWD}/.claude/paneline-prompts.md`;
const REVIEW_LABEL = "Review";
const REVIEW_FIRST_LINE = "Review the diff.";
const REVIEW_PROMPT = `${REVIEW_FIRST_LINE}\n\nList the risks first.`;
const REVIEW_FILE = `## ${REVIEW_LABEL}\n${REVIEW_PROMPT}\n`;
const SHIP_LABEL = "Ship";
const SHIP_FILE = `## ${SHIP_LABEL}\nRun the release checklist.\n`;
const DRAFT_BEFORE = "fix the ";
const DRAFT_AFTER = " bug now";
const LONG_FIRST_LINE =
  "Review the diff against main, list every risk, name the files at fault, and say which test would catch each one before merge.";
const LONG_TAIL = "before merge.";
const SHIP_FIRST_LINE = "Run the release checklist.";
const LONG_LABEL = "Summarise every open pull request";
const LONG_LABEL_START = "Summarise";
const LONG_FIRST_LINE_SHORT = "Draft the summary for the team.";
const ELLIPSIS = "…";
const BLANK_CELLS_BEFORE_TEXT = 2;

describe("skills tab library", () => {
  test("K1 the Skills tab opens and the User block shows a skill as one closed row without its description", async ($, on) => {
    worldOf(on, { skills: [COMMIT], files: userFile("commit", COMMIT_DESCRIPTION) });
    await startIn($, CWD);

    const pane = await paneOnTab($, "Skills");

    const shown = await lines(pane);
    expect(rowTexts((await blocks(pane)).User)).toEqual(["▸ commit 10 tokens"]);
    expect(
      shown.some((line) => line.text.includes(COMMIT_DESCRIPTION) || line.text.includes(BODY_LINE)),
    ).toBe(false);
  });

  test("K41 the Skills tab shows each skill's token count from the session on its row", async ($, on) => {
    worldOf(on, { skills: [COMMIT], files: userFile("commit", COMMIT_DESCRIPTION) });
    await startIn($, CWD);

    const pane = await paneOnTab($, "Skills");

    expect(rowTexts((await blocks(pane)).User)).toEqual(["▸ commit 10 tokens"]);
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
    expect(rowTexts(found.User)).toEqual(["▸ commit 10 tokens"]);
    expect(rowTexts(found.Project)).toEqual(["▸ deploy-notes 10 tokens"]);
    expect(rowTexts(found.runpod)).toEqual(["▸ runpod:runpod 10 tokens"]);
    expect(rowTexts(found["Built-in"])).toEqual(["▸ update-config 10 tokens"]);
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
    expect(rowTexts(found.runpod)).toEqual(["▸ runpod:runpod 10 tokens"]);
    expect(rowTexts(found.User)).toEqual(["▸ commit 10 tokens"]);
  });

  test("K7 a built-in skill with no SKILL.md is listed by name with no error text", async ($, on) => {
    worldOf(on, {
      skills: [UPDATE_CONFIG, COMMIT],
      files: userFile("commit", COMMIT_DESCRIPTION),
    });
    await startIn($, CWD);

    const pane = await paneOnTab($, "Skills");

    const found = await blocks(pane);
    expect(rowTexts(found["Built-in"])).toEqual(["▸ update-config 10 tokens"]);
    expect(rowTexts(found.User)).toEqual(["▸ commit 10 tokens"]);
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

    expect(rowTexts((await blocks(pane)).User)).toEqual(names.map((name) => `▸ ${name} 10 tokens`));
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

    expect(skillRowTexts(opened)).toEqual(["▾ commit 10 tokens"]);
    expect(descriptionOf(opened, "commit")).toBe(COMMIT_DESCRIPTION);
    expect(rowTexts(closed)).toEqual(["▸ commit 10 tokens"]);
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
    expect(rowTexts(closed)).toEqual(["▸ commit 10 tokens"]);
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

    expect(rowTexts((await blocks(pane))["Built-in"])).toEqual(["▸ update-config 10 tokens"]);
  });

  test("K30b clicking the glyph of that built-in skill opens the command list description under it", async ($, on) => {
    worldOf(on, { skills: [UPDATE_CONFIG], commands: [BUILTIN_COMMAND] });
    await startIn($, CWD);
    const pane = await paneOnTab($, "Skills");

    await pressGlyph(pane, "update-config");

    const opened = (await blocks(pane))["Built-in"];
    expect(skillRowTexts(opened)).toEqual(["▾ update-config 10 tokens"]);
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

  test("K32 a built-in skill the command list does not mention shows as a closed toggle row", async ($, on) => {
    worldOf(on, {
      skills: [UPDATE_CONFIG],
      commands: [{ name: "compact", description: "Free up context.", source: "builtin" }],
    });
    await startIn($, CWD);

    const pane = await paneOnTab($, "Skills");

    expect(rowTexts((await blocks(pane))["Built-in"])).toEqual(["▸ update-config 10 tokens"]);
  });

  test("K32b a built-in skill whose command list description is empty shows as a closed toggle row", async ($, on) => {
    worldOf(on, {
      skills: [UPDATE_CONFIG],
      commands: [{ ...BUILTIN_COMMAND, description: "" }],
    });
    await startIn($, CWD);

    const pane = await paneOnTab($, "Skills");

    expect(rowTexts((await blocks(pane))["Built-in"])).toEqual(["▸ update-config 10 tokens"]);
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
    expect(rowTexts(found["Built-in"])).toEqual(["▸ update-config 10 tokens"]);
    expect(rowTexts(found.User)).toEqual(["▸ commit 10 tokens"]);
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
    expect(rowTexts(found["Built-in"])).toEqual(["▸ update-config 10 tokens"]);
    expect(rowTexts(found.User)).toEqual(["▸ commit 10 tokens"]);
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
    expect(rowTexts((await blocks(pane)).User)).toEqual(["▸ commit 10 tokens"]);
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
    expect(rowTexts((await blocks(pane)).User)).toEqual(["▸ commit 10 tokens"]);
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
    expect(rowTexts((await blocks(pane)).User)).toEqual(["▸ commit 10 tokens"]);
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

  test("Q3c a Top used row shows the same token figure as the owner row of that skill", async ($, on) => {
    worldOf(on, { skills: USED_SKILLS, fullTokens: 115 });
    await startIn($, CWD);
    await useSkills($, { commit: 2 });

    const pane = await paneOnTab($, "Skills");

    const texts = (await lines(pane)).map((line) => line.text);
    expect(texts).toContain("commit 115 tokens 2 uses");
    expect(texts).toContain("▸ commit 115 tokens");
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
  test("K35 the Top used heading line ends with a muted [ clear ] button", async ($, on) => {
    worldOf(on, { skills: USED_SKILLS });
    await startIn($, CWD);
    await useSkills($, FIVE_USES);

    const pane = await paneOnTab($, "Skills");

    const top = (await blocks(pane))["Top used"];
    expect(top?.heading.text).toBe("Top used · this project [ clear ]");
    expect(clearButtonOf(top)?.props?.dimColor).toBe(true);
  });

  test("K36 with no uses there is no clear button in the tab", async ($, on) => {
    worldOf(on, { skills: USED_SKILLS });
    await startIn($, CWD);

    const pane = await paneOnTab($, "Skills");

    const buttons = await pane.findAll({ type: "Button" });
    expect(
      buttons.filter((button) => /^\[?\s*clear\s*\]?$/.test(String(button.props.label))),
    ).toEqual([]);
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

describe("skills tab use counts", () => {
  test("S1 each skill row shows its uses and age, one use reads singular, and a plugin skill shows its count under its plugin:skill name", async ($, on) => {
    worldOf(on, {
      skills: [COMMIT, DOCS, RUNPOD],
      files: {
        ...userFile("commit", COMMIT_DESCRIPTION),
        ...pluginRegistryFile(),
        [`${PLUGIN_ROOT}/skills/runpod/SKILL.md`]: skillFile("runpod", RUNPOD_DESCRIPTION),
        ...claudeJsonFile({
          commit: { usageCount: 44, lastUsedAt: NOW - 3 * MS_PER_DAY },
          docs: { usageCount: 1, lastUsedAt: NOW - 2 * MS_PER_HOUR },
          "runpod:runpod": { usageCount: 7, lastUsedAt: NOW - 3 * MS_PER_DAY },
        }),
      },
    });
    await startIn($, CWD);

    const found = await blocks(await paneOnTab($, "Skills"));

    expect(rowTexts(found.User)).toEqual([
      "▸ commit 10 tokens 44 uses · 3d",
      "▸ docs 10 tokens 1 use · 2h",
    ]);
    expect(rowTexts(found.runpod)).toEqual(["▸ runpod:runpod 10 tokens 7 uses · 3d"]);
  });

  test("S2 skills with no recorded use or a count of 0 leave their owner blocks for one folded never used row that reads 3 skills", async ($, on) => {
    worldOf(on, {
      skills: [COMMIT, DEPLOY_NOTES, DOCS, RUNPOD],
      files: {
        ...pluginRegistryFile(),
        ...claudeJsonFile({
          commit: { usageCount: 44, lastUsedAt: NOW - 3 * MS_PER_DAY },
          docs: { usageCount: 0, lastUsedAt: NOW - MS_PER_DAY },
        }),
      },
    });
    await startIn($, CWD);

    const pane = await paneOnTab($, "Skills");

    const shown = await lines(pane);
    expect(headingOrder(shown, HEADINGS)).toEqual(["User"]);
    expect(rowTexts((await blocks(pane)).User)).toEqual(["▸ commit 10 tokens 44 uses · 3d"]);
    expect(neverUsedLines(shown)).toEqual(["▸ never used 3 skills"]);
  });

  test("S3 pressing the never used row shows the unused skills with their owners, and pressing it again folds them", async ($, on) => {
    worldOf(on, {
      skills: [COMMIT, DEPLOY_NOTES, DOCS, RUNPOD],
      files: {
        ...pluginRegistryFile(),
        ...claudeJsonFile({ commit: { usageCount: 44, lastUsedAt: NOW - 3 * MS_PER_DAY } }),
      },
    });
    await startIn($, CWD);
    const pane = await paneOnTab($, "Skills");

    await pressNeverUsed(pane);
    const opened = await lines(pane);
    await pressNeverUsed(pane);
    const folded = await lines(pane);

    expect(neverUsedLines(opened)).toEqual(["▾ never used 3 skills"]);
    expect(neverUsedRowTexts(opened).sort()).toEqual([
      "▸ deploy-notes 10 tokens User",
      "▸ docs 10 tokens User",
      "▸ runpod:runpod 10 tokens runpod",
    ]);
    expect(neverUsedLines(folded)).toEqual(["▸ never used 3 skills"]);
    expect(neverUsedRowTexts(folded)).toEqual([]);
  });

  test("S4 an owner block whose skills are all unused is not drawn", async ($, on) => {
    worldOf(on, {
      skills: [DEPLOY_NOTES, DOCS, UPDATE_CONFIG],
      commands: [BUILTIN_COMMAND],
      files: claudeJsonFile({
        "update-config": { usageCount: 3, lastUsedAt: NOW - 5 * MS_PER_HOUR },
      }),
    });
    await startIn($, CWD);

    const pane = await paneOnTab($, "Skills");

    const shown = await lines(pane);
    expect(headingOrder(shown, HEADINGS)).toEqual(["Built-in"]);
    expect(rowTexts((await blocks(pane))["Built-in"])).toEqual([
      "▸ update-config 10 tokens 3 uses · 5h",
    ]);
    expect(neverUsedLines(shown)).toEqual(["▸ never used 2 skills"]);
  });

  test("S5 without a ~/.claude.json the Skills tab looks as before, with no use counts and no never used row", async ($, on) => {
    worldOf(on, { skills: [COMMIT, DEPLOY_NOTES], files: userFile("commit", COMMIT_DESCRIPTION) });
    await startIn($, CWD);

    const pane = await paneOnTab($, "Skills");

    const shown = await lines(pane);
    expect(rowTexts((await blocks(pane)).User)).toEqual([
      "▸ commit 10 tokens",
      "▸ deploy-notes 10 tokens",
    ]);
    expect(shown.some((line) => /never used|\buses?\b/.test(line.text))).toBe(false);
  });

  test("S5b with a ~/.claude.json that is not JSON the Skills tab looks as before, with no use counts and no never used row", async ($, on) => {
    worldOf(on, {
      skills: [COMMIT, DEPLOY_NOTES],
      files: { ...userFile("commit", COMMIT_DESCRIPTION), [CLAUDE_JSON]: "{ not json" },
    });
    await startIn($, CWD);

    const pane = await paneOnTab($, "Skills");

    const shown = await lines(pane);
    expect(rowTexts((await blocks(pane)).User)).toEqual([
      "▸ commit 10 tokens",
      "▸ deploy-notes 10 tokens",
    ]);
    expect(shown.some((line) => /never used|\buses?\b/.test(line.text))).toBe(false);
  });

  test("S6 at 60 columns a skill name too long for its row is cut, and its use count stays whole on that row", async ($, on) => {
    worldOf(on, {
      skills: [{ name: LONG_SKILL_NAME, source: "userSettings" }],
      files: claudeJsonFile({
        [LONG_SKILL_NAME]: { usageCount: 44, lastUsedAt: NOW - 3 * MS_PER_DAY },
      }),
    });
    await startIn($, CWD);
    const pane = await paneOnTab($, "Skills");

    const boxes = collect(await pane.drawn(), "Box");
    const count = boxes.find(
      (box) => styleOf(box).flexShrink === 0 && textOf(box).startsWith("44 uses"),
    );
    const name = boxes.find(
      (box) =>
        styleOf(box).flexShrink === 1 &&
        styleOf(box).minWidth === 0 &&
        textOf(box).includes(LONG_SKILL_NAME),
    );
    expect(count && textOf(count), "a fixed column holding 44 uses · 3d").toBe("44 uses · 3d");
    expect(name, "a name column that gives way to the count").toBeDefined();
    expect(rowTexts((await blocks(pane)).User)).toHaveLength(1);
  });
});

describe("skills tab on and off toggle", () => {
  test("S7 turn off keeps the other keys of the settings file, and the skill moves under Off with turn on", async ($, on) => {
    const world = worldOf(on, {
      skills: [COMMIT, DEPLOY_NOTES],
      files: {
        ...userFile("commit", COMMIT_DESCRIPTION),
        ...localSettingsFile({ model: "opus", permissions: { allow: ["Bash(ls)"] } }),
      },
    });
    await startIn($, CWD);
    const pane = await paneOnTab($, "Skills");
    await pressGlyph(pane, "commit");

    await pressAction(pane, "turn off");

    expect(savedSettings(world)).toEqual({
      model: "opus",
      permissions: { allow: ["Bash(ls)"] },
      skillOverrides: { commit: "off" },
    });
    const found = await blocks(pane);
    expect(rowTexts(found.User)).toEqual(["▸ deploy-notes 10 tokens"]);
    expect(rowTexts(found.Off)).toEqual(["commit turn on"]);
  });

  test("S7b the turn off button of an open skill is dim and sits two cells under the skill name", async ($, on) => {
    worldOf(on, { skills: [COMMIT], files: userFile("commit", COMMIT_DESCRIPTION) });
    await startIn($, CWD);
    const pane = await paneOnTab($, "Skills");
    await pressGlyph(pane, "commit");

    const name = rowOf((await blocks(pane)).User, "commit");
    const action = await actionLine(pane, "turn off");
    const button = action?.parts.find(
      (part) => part.type === "Button" && labelOfNode(part) === "turn off",
    );

    expect(name).toBeDefined();
    expect(action, "a turn off action row").toBeDefined();
    expect(action?.indent).toBe((name?.indent ?? 0) + 2);
    expect(button?.props?.dimColor).toBe(true);
  });

  test("S8 turn on removes the override, drops skillOverrides once empty, and the Off block goes away", async ($, on) => {
    const world = worldOf(on, {
      skills: [COMMIT, DEPLOY_NOTES],
      files: {
        ...userFile("commit", COMMIT_DESCRIPTION),
        ...localSettingsFile({ model: "opus", skillOverrides: { commit: "off" } }),
      },
    });
    await startIn($, CWD);
    const pane = await paneOnTab($, "Skills");
    expect(rowTexts((await blocks(pane)).Off)).toEqual(["commit turn on"]);

    await pressAction(pane, "turn on");

    expect(savedSettings(world)).toEqual({ model: "opus" });
    const shown = await lines(pane);
    expect(headingOrder(shown, HEADINGS)).toEqual(["User"]);
    expect(rowTexts((await blocks(pane)).User)).toEqual([
      "▸ commit 10 tokens",
      "▸ deploy-notes 10 tokens",
    ]);
  });

  test("S9 turn off without a settings file creates one that holds only skillOverrides", async ($, on) => {
    const world = worldOf(on, { skills: [COMMIT], files: userFile("commit", COMMIT_DESCRIPTION) });
    await startIn($, CWD);
    const pane = await paneOnTab($, "Skills");
    await pressGlyph(pane, "commit");

    await pressAction(pane, "turn off");

    expect(savedSettings(world)).toEqual({ skillOverrides: { commit: "off" } });
  });

  test("S10a an open plugin skill shows no turn off or turn on row and the settings file is not written", async ($, on) => {
    const world = worldOf(on, {
      skills: [RUNPOD],
      files: {
        ...pluginRegistryFile(),
        [`${PLUGIN_ROOT}/skills/runpod/SKILL.md`]: skillFile("runpod", RUNPOD_DESCRIPTION),
      },
    });
    await startIn($, CWD);
    const pane = await paneOnTab($, "Skills");
    await pressGlyph(pane, "runpod:runpod");

    expect((await lines(pane)).some((line) => line.text.includes(RUNPOD_DESCRIPTION))).toBe(true);
    expect(await actionLine(pane, "turn off")).toBeUndefined();
    expect(await actionLine(pane, "turn on")).toBeUndefined();
    expect(world.diskText(LOCAL_PATH)).toBeUndefined();
  });

  test("S10b turn off on an open built-in skill writes its name as the override", async ($, on) => {
    const world = worldOf(on, { skills: [UPDATE_CONFIG], commands: [BUILTIN_COMMAND] });
    await startIn($, CWD);
    const pane = await paneOnTab($, "Skills");
    await pressGlyph(pane, "update-config");

    await pressAction(pane, "turn off");

    expect(savedSettings(world)).toEqual({ skillOverrides: { "update-config": "off" } });
  });

  test("S11 an off override for a skill the engine does not list shows under Off, and an on override shows nothing", async ($, on) => {
    worldOf(on, {
      skills: [COMMIT],
      files: {
        ...userFile("commit", COMMIT_DESCRIPTION),
        ...localSettingsFile({ skillOverrides: { ghost: "off", fine: "on" } }),
      },
    });
    await startIn($, CWD);

    const pane = await paneOnTab($, "Skills");

    const found = await blocks(pane);
    expect(rowTexts(found.Off)).toEqual(["ghost turn on"]);
    expect(found.Off?.count).toBe("1 skill");
    expect((await lines(pane)).some((line) => line.text.includes("fine"))).toBe(false);
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

describe("skills tab scope labels", () => {
  test("A1 the Top used heading says this project and every owner heading that shows uses says all projects", async ($, on) => {
    worldOf(on, {
      skills: [...USED_SKILLS, RELEASE_NOTES],
      files: {
        ...claudeJsonFile({
          commit: { usageCount: 2, lastUsedAt: NOW - 2 * MS_PER_HOUR },
          "release-notes": { usageCount: 3, lastUsedAt: NOW - 2 * MS_PER_HOUR },
        }),
        ...projectFile("release-notes", "Project one."),
      },
    });
    await startIn($, CWD);
    await useSkills($, { commit: 2 });
    const pane = await paneOnTab($, "Skills");

    const found = await blocks(pane);
    expect(found["Top used"]?.heading.text).toMatch(/^Top used · this project\b/u);
    expect(found.User?.heading.text).toMatch(/^User · all projects\b/u);
    expect(found.Project?.heading.text).toMatch(/^Project · all projects\b/u);
    const labelled = (await lines(pane)).filter(
      (line) => line.text.includes(THIS_PROJECT) || line.text.includes(ALL_PROJECTS),
    );
    expect(labelled).toHaveLength(3);
  });

  test("A3 with no Claude usage file the Top used heading still says this project and no line says all projects", async ($, on) => {
    worldOf(on, { skills: USED_SKILLS });
    await startIn($, CWD);
    await useSkills($, { commit: 2 });
    const pane = await paneOnTab($, "Skills");

    expect((await blocks(pane))["Top used"]?.heading.text).toMatch(/^Top used · this project\b/u);
    expect((await lines(pane)).some((line) => line.text.includes(ALL_PROJECTS))).toBe(false);
  });

  test("A4 clicking clear on Top used removes its heading and label and the first owner heading keeps all projects", async ($, on) => {
    worldOf(on, {
      skills: USED_SKILLS,
      files: claudeJsonFile({ commit: { usageCount: 2, lastUsedAt: NOW - 2 * MS_PER_HOUR } }),
    });
    await startIn($, CWD);
    await useSkills($, { commit: 2 });
    const pane = await paneOnTab($, "Skills");

    await pressClear(pane);

    const shown = await lines(pane);
    expect(headingOrder(shown, HEADINGS)).not.toContain("Top used");
    expect(shown.some((line) => line.text.includes(THIS_PROJECT))).toBe(false);
    expect((await blocks(pane)).User?.heading.text).toMatch(/^User · all projects\b/u);
  });
});

describe("skills tab token figures", () => {
  test("A5 each skill row shows the full context token count, 40 tokens, not the quick count of 10", async ($, on) => {
    worldOf(on, { skills: [COMMIT, DOCS], fullTokens: 40 });
    await startIn($, CWD);

    const found = await blocks(await paneOnTab($, "Skills"));

    expect(rowTexts(found.User)).toEqual(["▸ commit 40 tokens", "▸ docs 40 tokens"]);
  });

  test("A6 while the full context count is still being read each row shows its uses and no token figure, then the figure appears", async ($, on) => {
    const world = worldOf(on, {
      skills: [COMMIT],
      fullTokens: 40,
      holdFull: true,
      files: claudeJsonFile({ commit: { usageCount: 44, lastUsedAt: NOW - 3 * MS_PER_DAY } }),
    });
    await startIn($, CWD);
    const pane = await paneOnTab($, "Skills");

    expect(rowTexts((await blocks(pane)).User)).toEqual(["▸ commit 44 uses · 3d"]);

    world.releaseFull();
    await settle(pane);
    expect(rowTexts((await blocks(pane)).User)).toEqual(["▸ commit 40 tokens 44 uses · 3d"]);
  });

  test("A7 when the full context count cannot be read the skills stay listed with no token figure and a toast says so", async ($, on) => {
    const world = worldOf(on, {
      skills: [COMMIT],
      failFull: true,
      files: claudeJsonFile({ commit: { usageCount: 44, lastUsedAt: NOW - 3 * MS_PER_DAY } }),
    });
    await startIn($, CWD);

    const found = await blocks(await paneOnTab($, "Skills"));

    expect(rowTexts(found.User)).toEqual(["▸ commit 44 uses · 3d"]);
    expect(world.toasts().filter((text) => text.includes("Token counts failed"))).toHaveLength(1);
  });

  test("A8 with one skill listed its Skills row token figure is the same as the Context tab's skills total", async ($, on) => {
    worldOf(on, { skills: [COMMIT], fullTokens: 40 });
    await startIn($, CWD);
    const context = await paneOnTab($, "Context");
    const contextSkills = (await lines(context)).find((line) => /^└ 1 skills? · /u.test(line.text));
    await context.unmount();

    const found = await blocks(await paneOnTab($, "Skills"));

    expect(contextSkills?.text, "the skills line of the Context tab").toContain("40 tokens");
    expect(rowTexts(found.User)).toEqual(["▸ commit 40 tokens"]);
  });
});

describe("skills tab same-name skills", () => {
  test("Q1 a user skill and a project skill with the same name each show their own full context token count", async ($, on) => {
    worldOf(on, {
      skills: [
        { name: "foo", source: "userSettings" },
        { name: "foo", source: "projectSettings" },
      ],
      fullTokensBySkill: { "userSettings:foo": 100, "projectSettings:foo": 30 },
      files: userFile("foo", "Same name."),
    });
    await startIn($, CWD);

    const found = await blocks(await paneOnTab($, "Skills"));

    expect(rowTexts(found.User).sort()).toEqual(["▸ foo 100 tokens", "▸ foo 30 tokens"]);
  });
});

describe("skills tab prompts", () => {
  test("P1 a global prompts file shows a Prompts block above Top used, with the label and its first text line on one row", async ($, on) => {
    worldOf(on, {
      skills: [COMMIT],
      files: { ...userFile("commit", COMMIT_DESCRIPTION), ...promptsFile(REVIEW_FILE) },
    });
    await startIn($, CWD);
    await useSkills($, { commit: 1 });

    const pane = await paneOnTab($, "Skills");

    expect(await promptOrder(pane)).toEqual([PROMPTS_TITLE, "Top used", "User"]);
    const row = promptLineOf((await promptBlocks(pane))[PROMPTS_TITLE], REVIEW_LABEL);
    expect(row?.text).toContain(REVIEW_FIRST_LINE);
  });

  test("P2 a project prompts file adds a Project prompts block under Prompts, listing its prompts", async ($, on) => {
    worldOf(on, {
      skills: [COMMIT],
      files: {
        ...userFile("commit", COMMIT_DESCRIPTION),
        ...promptsFile(REVIEW_FILE),
        ...projectPromptsFile(SHIP_FILE),
      },
    });
    await startIn($, CWD);
    await useSkills($, { commit: 1 });

    const pane = await paneOnTab($, "Skills");

    expect(await promptOrder(pane)).toEqual([
      PROMPTS_TITLE,
      PROJECT_PROMPTS_TITLE,
      "Top used",
      "User",
    ]);
    const row = promptLineOf((await promptBlocks(pane))[PROJECT_PROMPTS_TITLE], SHIP_LABEL);
    expect(row?.text).toContain("Run the release checklist.");
  });

  test("P2b a global prompts file alone shows no Project prompts block", async ($, on) => {
    worldOf(on, {
      skills: [COMMIT],
      files: { ...userFile("commit", COMMIT_DESCRIPTION), ...promptsFile(REVIEW_FILE) },
    });
    await startIn($, CWD);
    await useSkills($, { commit: 1 });

    const pane = await paneOnTab($, "Skills");

    expect(await promptOrder(pane)).not.toContain(PROJECT_PROMPTS_TITLE);
  });

  test("P4 clicking a prompt with a draft and the caret inside it puts the whole prompt at the caret, keeps the draft and sends nothing", async ($, on) => {
    const world = worldOf(on, {
      skills: [COMMIT],
      files: { ...userFile("commit", COMMIT_DESCRIPTION), ...promptsFile(REVIEW_FILE) },
      draft: `${DRAFT_BEFORE}${DRAFT_AFTER}`,
      caret: DRAFT_BEFORE.length,
    });
    await startIn($, CWD);
    await useSkills($, { commit: 1 });
    const pane = await paneOnTab($, "Skills");

    await pressPrompt(pane, PROMPTS_TITLE, REVIEW_LABEL);

    expect(world.box.text).toBe(`${DRAFT_BEFORE}${REVIEW_PROMPT}${DRAFT_AFTER}`);
    expect(world.box.cursor).toBe(DRAFT_BEFORE.length + REVIEW_PROMPT.length);
    expect(world.submitted).toEqual([]);
  });

  test("P5 with no prompts file the Skills tab shows the same blocks as before, starting with Top used", async ($, on) => {
    worldOf(on, {
      skills: [COMMIT, UPDATE_CONFIG],
      files: userFile("commit", COMMIT_DESCRIPTION),
    });
    await startIn($, CWD);
    await useSkills($, { commit: 1 });

    const pane = await paneOnTab($, "Skills");

    expect(await promptOrder(pane)).toEqual(["Top used", "User", "Built-in"]);
  });

  test("P6 the title and intro above the first ## line never show on the tab", async ($, on) => {
    worldOf(on, {
      skills: [COMMIT],
      files: {
        ...userFile("commit", COMMIT_DESCRIPTION),
        ...promptsFile(`# Paneline prompts\nThis intro must not show.\n${REVIEW_FILE}`),
      },
    });
    await startIn($, CWD);
    await useSkills($, { commit: 1 });

    const pane = await paneOnTab($, "Skills");

    expect(promptLineOf((await promptBlocks(pane))[PROMPTS_TITLE], REVIEW_LABEL)).toBeDefined();
    const shown = (await lines(pane)).map((line) => line.text).join("\n");
    expect(shown).not.toContain("Paneline prompts");
    expect(shown).not.toContain("This intro must not show.");
  });

  test("P6b clicking a prompt inserts its text with the blank lines and spaces around it removed", async ($, on) => {
    const world = worldOf(on, {
      skills: [COMMIT],
      files: {
        ...userFile("commit", COMMIT_DESCRIPTION),
        ...promptsFile(`## ${REVIEW_LABEL}\n\n   ${REVIEW_FIRST_LINE}   \n\n`),
      },
    });
    await startIn($, CWD);
    await useSkills($, { commit: 1 });
    const pane = await paneOnTab($, "Skills");

    await pressPrompt(pane, PROMPTS_TITLE, REVIEW_LABEL);

    expect(world.box.text).toBe(REVIEW_FIRST_LINE);
  });

  test("P6c a prompts file with no ## line shows no Prompts block", async ($, on) => {
    worldOf(on, {
      skills: [COMMIT],
      files: {
        ...userFile("commit", COMMIT_DESCRIPTION),
        ...promptsFile("# Paneline prompts\nNo prompts yet.\n"),
      },
    });
    await startIn($, CWD);
    await useSkills($, { commit: 1 });

    const pane = await paneOnTab($, "Skills");

    expect((await promptBlocks(pane))[PROMPTS_TITLE]).toBeUndefined();
  });

  test("P8 a session started in the home folder shows the global prompts once and no Project prompts block", async ($, on) => {
    const world = worldOf(on, {
      skills: [COMMIT],
      files: { ...userFile("commit", COMMIT_DESCRIPTION), ...promptsFile(REVIEW_FILE) },
    });
    world.changeCwd(HOME);
    await startIn($, HOME);
    await useSkills($, { commit: 1 });

    const pane = await paneOnTab($, "Skills");

    const found = await promptBlocks(pane);
    expect(found[PROJECT_PROMPTS_TITLE]).toBeUndefined();
    expect(rowsLabelled(found, REVIEW_LABEL)).toBe(1);
  });

  test("P9 a prompts file edited while the tab is left shows its new prompts when the tab is entered again", async ($, on) => {
    const files = promptsFile(REVIEW_FILE);
    worldOf(on, { skills: [COMMIT], files });
    await startIn($, CWD);
    const pane = await paneOnTab($, "Skills");
    expect(promptLineOf((await promptBlocks(pane))[PROMPTS_TITLE], REVIEW_LABEL)).toBeDefined();

    files[GLOBAL_PROMPTS_PATH] = SHIP_FILE;
    await showTabThroughArrows(pane, "Files");
    await showTabThroughArrows(pane, "Skills");

    const found = await promptBlocks(pane);
    expect(promptLineOf(found[PROMPTS_TITLE], SHIP_LABEL)).toBeDefined();
    expect(promptLineOf(found[PROMPTS_TITLE], REVIEW_LABEL)).toBeUndefined();
  });

  test("P10 a prompt label in both files shows once under each block, with each file's own text", async ($, on) => {
    worldOf(on, {
      skills: [COMMIT],
      files: {
        ...userFile("commit", COMMIT_DESCRIPTION),
        ...promptsFile(`## ${REVIEW_LABEL}\nGlobal review text.\n`),
        ...projectPromptsFile(`## ${REVIEW_LABEL}\nProject review text.\n`),
      },
    });
    await startIn($, CWD);
    await useSkills($, { commit: 1 });

    const pane = await paneOnTab($, "Skills");

    const found = await promptBlocks(pane);
    expect(promptLineOf(found[PROMPTS_TITLE], REVIEW_LABEL)?.text).toContain("Global review text.");
    expect(promptLineOf(found[PROJECT_PROMPTS_TITLE], REVIEW_LABEL)?.text).toContain(
      "Project review text.",
    );
  });

  test("P11 prompts still show when there are no skills, and the no skills row sits under them", async ($, on) => {
    worldOf(on, { skills: [], files: promptsFile(REVIEW_FILE) });
    await startIn($, CWD);

    const pane = await paneOnTab($, "Skills");

    expect(promptLineOf((await promptBlocks(pane))[PROMPTS_TITLE], REVIEW_LABEL)).toBeDefined();
    const texts = (await lines(pane)).map((line) => line.text);
    expect(texts).toContain("no skills");
    expect(texts.indexOf("no skills")).toBeGreaterThan(texts.indexOf(PROMPTS_TITLE));
  });

  test("P12 one blank row separates the Prompts block from Top used, as between the other blocks", async ($, on) => {
    worldOf(on, {
      skills: [COMMIT],
      files: { ...userFile("commit", COMMIT_DESCRIPTION), ...promptsFile(REVIEW_FILE) },
    });
    await startIn($, CWD);
    await useSkills($, { commit: 1 });

    const pane = await paneOnTab($, "Skills");

    expect(promptLineOf((await promptBlocks(pane))[PROMPTS_TITLE], REVIEW_LABEL)).toBeDefined();
    const texts = (await lines(pane)).map((line) => line.text);
    const top = texts.findIndex((text) => text.startsWith("Top used"));
    expect(texts[top - 1]).toBe("");
    expect(texts[top - 2]).not.toBe("");
  });

  test("P13 the Prompts heading has the same colour and weight as the Top used heading", async ($, on) => {
    worldOf(on, {
      skills: [COMMIT],
      files: { ...userFile("commit", COMMIT_DESCRIPTION), ...promptsFile(REVIEW_FILE) },
    });
    await startIn($, CWD);
    await useSkills($, { commit: 1 });

    const pane = await paneOnTab($, "Skills");

    const found = await promptBlocks(pane);
    expect(found[PROMPTS_TITLE], "a Prompts heading").toBeDefined();
    expect(headingLookOf(found[PROMPTS_TITLE])).toEqual(headingLookOf(found["Top used"]));
    expect(headingLookOf(found[PROMPTS_TITLE]).isBold).toBe(true);
  });

  test("P14 a first text line wider than the tab is cut at the edge and stays on the prompt's one screen row", async ($, on) => {
    worldOf(on, {
      skills: [COMMIT],
      files: {
        ...userFile("commit", COMMIT_DESCRIPTION),
        ...promptsFile(`## ${REVIEW_LABEL}\n${LONG_FIRST_LINE}\n`),
      },
    });
    await startIn($, CWD);
    await useSkills($, { commit: 1 });

    const pane = await paneOnTab($, "Skills");

    const screen = screenRows(await pane.drawn(), COLUMNS).map((row) => row.trimEnd());
    const row = screen.find((text) => text.includes(REVIEW_LABEL));
    expect(row, `a screen row with ${REVIEW_LABEL}`).toBeDefined();
    expect(row?.length ?? 0).toBeLessThanOrEqual(COLUMNS);
    expect(screen.join("\n")).not.toContain(LONG_TAIL);
  });

  test("P15 prompt text starts in one column for every label, and a label too long for its column is cut with … and two blank cells before its text", async ($, on) => {
    worldOf(on, {
      skills: [COMMIT],
      files: {
        ...userFile("commit", COMMIT_DESCRIPTION),
        ...promptsFile(
          `## ${REVIEW_LABEL}\n${REVIEW_FIRST_LINE}\n## ${SHIP_LABEL}\n${SHIP_FIRST_LINE}\n## ${LONG_LABEL}\n${LONG_FIRST_LINE_SHORT}\n`,
        ),
      },
    });
    await startIn($, CWD);
    await useSkills($, { commit: 1 });

    const pane = await paneOnTab($, "Skills");

    const screen = screenRows(await pane.drawn(), COLUMNS).map((row) => row.trimEnd());
    const reviewRow = screen.find((row) => row.includes(REVIEW_FIRST_LINE));
    const shipRow = screen.find((row) => row.includes(SHIP_FIRST_LINE));
    const longRow = screen.find((row) => row.includes(LONG_LABEL_START));
    expect(reviewRow, "a screen row for Review").toBeDefined();
    expect(shipRow, "a screen row for Ship").toBeDefined();
    expect(longRow, "a screen row for the long label").toBeDefined();
    const columns = [
      reviewRow?.indexOf(REVIEW_FIRST_LINE),
      shipRow?.indexOf(SHIP_FIRST_LINE),
      longRow?.indexOf(LONG_FIRST_LINE_SHORT),
    ];
    expect(columns).toEqual([expect.any(Number), expect.any(Number), expect.any(Number)]);
    expect(new Set(columns).size).toBe(1);
    expect(longRow?.includes(LONG_LABEL)).toBe(false);
    const ellipsis = longRow?.indexOf(ELLIPSIS) ?? -1;
    expect(ellipsis).toBeGreaterThan(longRow?.indexOf(LONG_LABEL_START) ?? -1);
    const blankCells = (longRow?.indexOf(LONG_FIRST_LINE_SHORT) ?? 0) - ellipsis - 1;
    expect(blankCells).toBeGreaterThanOrEqual(BLANK_CELLS_BEFORE_TEXT);
  });
});

describe("skills tab filter", () => {
  test("T2-b typing REV keeps only skills whose name contains rev, and a description-only hit stays hidden", async ($, on) => {
    worldOf(on, {
      skills: [COMMIT, DEPLOY_NOTES, { name: "review", source: "userSettings" }],
      files: {
        ...userFile("commit", COMMIT_DESCRIPTION),
        ...userFile("deploy-notes", "Preview the notes before release."),
        ...userFile("review", "Check a pull request."),
      },
    });
    await startIn($, CWD);
    const pane = await paneOnTab($, "Skills");

    await pane.input({ key: "filter", text: "REV", kind: "change" });
    await settle(pane);

    expect(rowTexts((await blocks(pane)).User)).toEqual(["▸ review 10 tokens"]);
  });

  test("T2-e with no match the field and the Skills heading stay and no matching skills sits under the heading", async ($, on) => {
    worldOf(on, { skills: [COMMIT], files: userFile("commit", COMMIT_DESCRIPTION) });
    await startIn($, CWD);
    const pane = await paneOnTab($, "Skills");

    await pane.input({ key: "filter", text: "zzz-none", kind: "change" });
    await settle(pane);

    const texts = (await lines(pane)).map((line) => line.text);
    expect(texts.indexOf("no matching skills")).toBe(
      texts.findIndex((text) => text.startsWith("Skills")) + 1,
    );
    expect(texts.findIndex((text) => text.startsWith("Skills"))).toBeGreaterThan(-1);
    expect(await pane.find({ type: "Input", key: "filter" })).toBeDefined();
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

function promptsFile(text: string): Record<string, string> {
  return { [GLOBAL_PROMPTS_PATH]: text };
}

function projectPromptsFile(text: string): Record<string, string> {
  return { [PROJECT_PROMPTS_PATH]: text };
}

async function promptBlocks(pane: Pane): Promise<Record<string, Block>> {
  return blocksOf(await lines(pane), PROMPT_TITLES);
}

async function promptOrder(pane: Pane): Promise<string[]> {
  return headingOrder(await lines(pane), PROMPT_TITLES);
}

function promptLineOf(block: Block | undefined, label: string): Line | undefined {
  return block?.rows.find((line) => nameButtonOf(line, label) !== undefined);
}

function rowsLabelled(found: Record<string, Block>, label: string): number {
  return Object.values(found)
    .flatMap((block) => block.rows)
    .filter((line) => nameButtonOf(line, label) !== undefined).length;
}

async function pressPrompt(pane: Pane, title: string, label: string): Promise<void> {
  const line = promptLineOf((await promptBlocks(pane))[title], label);
  expect(line, `a ${label} prompt under ${title}`).toBeDefined();
  await pressNode(pane, nameButtonOf(line, label));
}

function headingLookOf(block: Block | undefined): { color: unknown; isBold: boolean } {
  const part = block?.heading.parts.find((node) => node.type === "Text" && isHeavy(node.props));
  return { color: part?.props?.color, isBold: isHeavy(part?.props) };
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
    box: { text: draft, cursor: options.caret ?? draft.length },
    submitted: [],
    forgetState: () => stateValues.clear(),
    storedValue: (key) => stored.get(key),
    changeCwd: (next) => {
      folder = next;
    },
    diskText: (path) => fileText(path),
    releaseFull: () => openFull(),
    toasts: () => [...toasts],
  };
  const written = new Map<string, string>();
  const toasts: string[] = [];
  let openFull: () => void = () => {};
  const fullGate: Promise<void> = options.holdFull
    ? new Promise<void>((resolve) => {
        openFull = resolve;
      })
    : Promise.resolve();
  const absolute = (path: string): string => (path.startsWith("/") ? path : `${folder}/${path}`);
  const fileText = (path: string): string | undefined => {
    const full = absolute(path);
    return written.get(full) ?? options.files?.[full];
  };
  const localSettings = (): Record<string, unknown> => {
    const text = fileText(LOCAL_SETTINGS);
    return text === undefined ? {} : (JSON.parse(text) as Record<string, unknown>);
  };
  const offNames = (): string[] => {
    const overrides = localSettings().skillOverrides as Record<string, string> | undefined;
    return Object.entries(overrides ?? {}).flatMap(([name, state]) =>
      state === "off" ? [name] : [],
    );
  };
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
  on("ui.toast", (_$, e) => {
    toasts.push(e.text);
    return { value: undefined };
  });
  on("session.usage", async (_$, e) => {
    if (e.breakdown !== undefined) world.breakdownCalls++;
    if (e.breakdown === "full") {
      if (options.failFull === true) throw new Error("usage is down");
      await fullGate;
    }
    const perSkill = e.breakdown === "full" ? (options.fullTokens ?? QUICK_TOKENS) : QUICK_TOKENS;
    const tokensOf = (skill: ListedSkill): number =>
      e.breakdown === "full"
        ? (options.fullTokensBySkill?.[`${skill.source}:${skill.name}`] ?? perSkill)
        : perSkill;
    const visible = options.skills.filter((skill) => !offNames().includes(skill.name));
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
        tokens: visible.reduce((sum, skill) => sum + tokensOf(skill), 0),
        skillFrontmatter: visible.map((skill) => ({ ...skill, tokens: tokensOf(skill) })),
      },
    } as unknown as SessionContextBreakdown;
    const context =
      e.breakdown === undefined ? { window: 200_000 } : { window: 200_000, breakdown };
    return { value: { startedAt: 0, context, rateLimits: [] } };
  });
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.model", () => ({ value: "opus" }));
  on("settings.read", (_$, e) => ({ value: e.source === "local" ? localSettings() : {} }));
  on("session.cwd", () => ({ value: folder }));
  on("fs.exists", (_$, e) => ({ value: fileText(e.path) !== undefined }));
  on("fs.read", (_$, e) => {
    world.skillFilesRead.push(e.path);
    const text = fileText(e.path);
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`);
    return { value: text };
  });
  on("fs.write", (_$, e) => {
    written.set(absolute(e.path), e.text);
    return { value: undefined };
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

function claudeJsonFile(
  skillUsage: Record<string, { usageCount?: number; lastUsedAt?: number }>,
): Record<string, string> {
  return { [CLAUDE_JSON]: JSON.stringify({ skillUsage }) };
}

function localSettingsFile(settings: Record<string, unknown>): Record<string, string> {
  return { [LOCAL_PATH]: JSON.stringify(settings, null, 2) };
}

function savedSettings(world: World): Record<string, unknown> {
  return JSON.parse(world.diskText(LOCAL_PATH) ?? "{}") as Record<string, unknown>;
}

function isHeadingLine(line: Line): boolean {
  return line.parts.some((part) => part.type === "Text" && isHeavy(part.props));
}

function neverUsedLines(shown: Line[]): string[] {
  return shown.filter((line) => NEVER_USED.test(line.text)).map((line) => line.text);
}

function neverUsedRowTexts(shown: Line[]): string[] {
  const start = shown.findIndex((line) => NEVER_USED.test(line.text));
  const rest = shown.slice(start + 1);
  const end = rest.findIndex(isHeadingLine);
  return rest
    .slice(0, end === -1 ? undefined : end)
    .map((line) => line.text)
    .filter((text) => text !== "");
}

async function pressNeverUsed(pane: Pane): Promise<void> {
  const row = (await lines(pane)).find((line) => NEVER_USED.test(line.text));
  await pressNode(
    pane,
    row?.parts.find((part) => part.type === "Button"),
  );
}

function styleOf(node: Node): Record<string, unknown> {
  return node.props ?? {};
}

function labelOfNode(node: Node): string {
  return typeof node.props?.label === "string" ? node.props.label : textOf(node);
}

async function actionLine(pane: Pane, label: string): Promise<Line | undefined> {
  return (await lines(pane)).find((line) =>
    line.parts.some((part) => part.type === "Button" && labelOfNode(part) === label),
  );
}

async function pressAction(pane: Pane, label: string): Promise<void> {
  const line = await actionLine(pane, label);
  expect(line, `a "${label}" button`).toBeDefined();
  await pressNode(
    pane,
    line?.parts.find((part) => part.type === "Button" && labelOfNode(part) === label),
  );
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
