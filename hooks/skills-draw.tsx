import type { ElementTable, RenderElement } from "claude-code";

import { formatAge, formatTokens } from "./format";
import {
  button,
  filterRow,
  header,
  labelButton,
  matchesFilter,
  paneHeaderLook,
  plural,
} from "./pane-kit";
import { paneInk } from "./pane-ink";
import type { SkillUsage } from "./skill-usage";
import { clipEnd, displayWidth } from "./text-width";
import type { UseEntry } from "./use-counts";

type Ui = ElementTable;

export type SkillOwner = "user" | "project" | "plugin" | "built-in";

export type SkillEntry = {
  name: string;
  description: string;
  owner: SkillOwner;
  source?: string;
  plugin?: string;
  tokens?: number;
};

export type SkillsView = {
  width: number;
  isLightTheme: boolean;
  top: readonly UseEntry[];
  allUsed: readonly UseEntry[];
  statsOpen: boolean;
  toggleStats: () => void;
  clearUses: () => void;
  skills: readonly SkillEntry[];
  expanded: ReadonlySet<string>;
  toggle: (name: string) => void;
  insert: (name: string) => void;
  filter: string;
  setFilter: (text: string) => void;
  focusFilter: () => void;
  usage: SkillUsage | null;
  now: number;
  neverOpen: boolean;
  toggleNever: () => void;
  offNames: ReadonlySet<string>;
  setOff: (name: string, off: boolean) => void;
};

export type PromptEntry = { label: string; text: string };

export type PromptBlockView = { title: string; prompts: readonly PromptEntry[] };

export type PromptsView = {
  width: number;
  blocks: readonly PromptBlockView[];
  fill: (text: string) => void;
};

type Block = { title: string; skills: readonly SkillEntry[] };

type ShownSkills = SkillsView & { tokenCells: number };

const PROMPT_LABEL_SHARE = 3;
const PROMPT_GAP_CELLS = 2;
const STATS_EXTRA_GAP_CELLS = 1;
const OPEN_GLYPH = "▾";
const USES_WORD_WIDTH = " uses".length;
const TOP_SCOPE = "· this project";
const OWNER_SCOPE = "· all projects";
const TOKEN_UNIT = " tokens";
const FOLDED_GLYPH = "▸";
const DESCRIPTION_INDENT_CELLS = 2;
const NEVER_USED_LABEL = "never used";
const OFF_TITLE = "Off";
const TURN_OFF_LABEL = "turn off";
const TURN_ON_LABEL = "turn on";
const TOP_TITLE = "Top used";
const CLEAR_LABEL = "clear";
const CLEAR_BUTTON_CELLS = `[ ${CLEAR_LABEL} ]`.length;
const OWNER_TITLES: Record<SkillOwner, string> = {
  user: "User",
  project: "Project",
  plugin: "Plugins",
  "built-in": "Built-in",
};

export function skillsTab(ui: Ui, view: SkillsView): RenderElement {
  const { Box } = ui;
  const skills = view.skills.filter((skill) => matchesFilter(view.filter, skill.name));
  const allUsed = view.allUsed.filter((entry) => matchesFilter(view.filter, entry.name));
  const shown: ShownSkills = {
    ...view,
    skills,
    allUsed,
    top: allUsed.slice(0, view.top.length),
    tokenCells: tokenCellsOf(skills),
  };
  const listedNames = new Set(view.skills.map((skill) => skill.name));
  const offOnly = [...view.offNames]
    .filter((name) => !listedNames.has(name) && matchesFilter(view.filter, name))
    .sort(byName);
  const { used, never } = splitByUse(skills, view.usage);
  const ownerScope = view.usage === null ? "" : OWNER_SCOPE;
  const sections = [
    ...(shown.top.length === 0 || skills.length === 0 ? [] : [topSection(ui, shown)]),
    ...blocksOf(used).map((block) => ownerSection(ui, block, shown, ownerScope)),
    ...(never.length === 0 ? [] : [neverSection(ui, never, shown)]),
    ...(offOnly.length === 0 ? [] : [offSection(ui, offOnly, shown)]),
  ];
  return (
    <Box flexDirection="column" width={view.width}>
      {filterRow(ui, {
        value: view.filter,
        onInput: view.setFilter,
        onFocus: view.focusFilter,
      })}
      <Box height={1} />
      {sections.length === 0 ? emptyRows(ui, view) : null}
      {sections.flatMap((section, index) => [
        ...(index > 0 ? [<Box key={`gap-${index}`} height={1} />] : []),
        section,
      ])}
    </Box>
  );
}

function tokenCellsOf(skills: readonly SkillEntry[]): number {
  return Math.max(
    0,
    ...skills.flatMap((skill) =>
      skill.tokens === undefined ? [] : [formatTokens(skill.tokens).length],
    ),
  );
}

function emptyRows(ui: Ui, view: SkillsView): RenderElement {
  const { Box, Text } = ui;
  if (view.skills.length === 0 && view.offNames.size === 0) {
    return (
      <Text color={paneInk().muted} wrap="truncate-end">
        no skills
      </Text>
    );
  }
  return (
    <Box flexDirection="column">
      {header(ui, "Skills", paneHeaderLook(), view.width)}
      <Text color={paneInk().muted} wrap="truncate-end">
        no matching skills
      </Text>
    </Box>
  );
}

export function promptedTab(ui: Ui, prompts: PromptsView, tab: RenderElement): RenderElement {
  if (prompts.blocks.length === 0) return tab;
  const { Box } = ui;
  const nameCells = promptNameCells(prompts);
  return (
    <Box flexDirection="column" width={prompts.width}>
      {prompts.blocks.flatMap((block, index) => [
        ...(index > 0 ? [<Box key={`gap-${index}`} height={1} />] : []),
        promptSection(ui, block, prompts, nameCells),
      ])}
      <Box height={1} />
      {tab}
    </Box>
  );
}

function promptNameCells(prompts: PromptsView): number {
  const labels = prompts.blocks.flatMap((block) => block.prompts.map((prompt) => prompt.label));
  const longest = Math.max(0, ...labels.map(displayWidth));
  return Math.min(longest, Math.floor(prompts.width / PROMPT_LABEL_SHARE));
}

function promptSection(
  ui: Ui,
  block: PromptBlockView,
  prompts: PromptsView,
  nameCells: number,
): RenderElement {
  const { Box, Text } = ui;
  return (
    <Box key={`prompts-${block.title}`} flexDirection="column" width={prompts.width}>
      {header(ui, block.title, paneHeaderLook(), prompts.width)}
      {block.prompts.map((prompt, index) => (
        <Box
          key={`${block.title}-${index}-row`}
          flexDirection="row"
          width={prompts.width}
          height={1}
          columnGap={PROMPT_GAP_CELLS}
        >
          <Box width={nameCells} flexShrink={0}>
            {labelButton(ui, {
              key: `${block.title}-${index}`,
              label: clipEnd(prompt.label, nameCells),
              onPress: () => prompts.fill(prompt.text),
            })}
          </Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text color={paneInk().muted} wrap="truncate-end">
              {firstLine(prompt.text)}
            </Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function firstLine(text: string): string {
  const [first = ""] = text.split("\n");
  return first;
}

function byName(left: string, right: string): number {
  return left.localeCompare(right);
}

function splitByUse(
  skills: readonly SkillEntry[],
  usage: SkillUsage | null,
): { used: SkillEntry[]; never: SkillEntry[] } {
  if (usage === null) return { used: [...skills], never: [] };
  const isUsed = (skill: SkillEntry): boolean => (usage[skill.name]?.usageCount ?? 0) > 0;
  return { used: skills.filter(isUsed), never: skills.filter((skill) => !isUsed(skill)) };
}

function blocksOf(skills: readonly SkillEntry[]): Block[] {
  const plugins = [
    ...new Set(skills.flatMap((skill) => (skill.owner === "plugin" ? [pluginOf(skill)] : []))),
  ].sort(byName);
  const blocks: Block[] = [
    { title: OWNER_TITLES.user, skills: ownedBy(skills, "user") },
    { title: OWNER_TITLES.project, skills: ownedBy(skills, "project") },
    ...plugins.map((plugin) => ({
      title: plugin,
      skills: ownedBy(skills, "plugin").filter((skill) => pluginOf(skill) === plugin),
    })),
    { title: OWNER_TITLES["built-in"], skills: ownedBy(skills, "built-in") },
  ];
  return blocks.filter((block) => block.skills.length > 0);
}

function ownedBy(skills: readonly SkillEntry[], owner: SkillOwner): SkillEntry[] {
  return skills
    .filter((skill) => skill.owner === owner)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function pluginOf(skill: SkillEntry): string {
  return skill.plugin ?? OWNER_TITLES.plugin;
}

function topSection(ui: Ui, view: ShownSkills): RenderElement {
  const { Box, Button } = ui;
  const entries = view.statsOpen ? view.allUsed : view.top;
  const label = view.statsOpen
    ? `${OPEN_GLYPH} top ${view.top.length}`
    : `${FOLDED_GLYPH} all ${view.allUsed.length} used`;
  return (
    <Box key="top" flexDirection="column" width={view.width}>
      <Box flexDirection="row" width={view.width} height={1} columnGap={1}>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          {header(ui, TOP_TITLE, paneHeaderLook(), view.width - CLEAR_BUTTON_CELLS - 1, TOP_SCOPE)}
        </Box>
        {button(ui, { key: "top-clear", label: CLEAR_LABEL, onPress: view.clearUses })}
      </Box>
      {entries.map((entry) => useRow(ui, entry, view, topCountWidth(entries)))}
      {view.allUsed.length > view.top.length ? (
        <Button key="top-stats" label={label} plain dimColor onPress={view.toggleStats} />
      ) : null}
    </Box>
  );
}

function topCountWidth(entries: readonly UseEntry[]): number {
  return Math.max(...entries.map((entry) => String(entry.uses).length));
}

function useRow(ui: Ui, entry: UseEntry, view: ShownSkills, countWidth: number): RenderElement {
  const { Box, Text } = ui;
  const skill = view.skills.find(({ name }) => name === entry.name);
  return (
    <Box key={`top-${entry.name}`} flexDirection="row" width={view.width} height={1} columnGap={1}>
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        <Text color={paneInk().text} wrap="truncate-end">
          {entry.name}
        </Text>
      </Box>
      {rightBox(ui, `top-${entry.name}-tokens`, tokenParts(skill?.tokens, view.tokenCells))}
      {rightBox(
        ui,
        `top-${entry.name}-uses`,
        topUsesParts(entry, view, countWidth),
        STATS_EXTRA_GAP_CELLS,
      )}
    </Box>
  );
}

function topUsesParts(entry: UseEntry, view: SkillsView, countWidth: number): RightPart[] {
  if (view.usage !== null) return usesParts(entry.uses, undefined, view.usage, view.now);
  const ink = paneInk();
  return [
    { text: String(entry.uses).padStart(countWidth), color: ink.text },
    { text: usesWord(entry.uses), color: ink.muted },
  ];
}

function ownerSection(ui: Ui, block: Block, view: ShownSkills, stamp: string): RenderElement {
  return sectionOf(
    ui,
    { key: `block-${block.title}`, title: block.title, count: block.skills.length, stamp },
    block.skills.flatMap((skill) =>
      skillRows(ui, skill, view, { indent: 0, right: usageParts(skill, view) }),
    ),
    view.width,
  );
}

function sectionOf(
  ui: Ui,
  { key, title, count, stamp = "" }: { key: string; title: string; count: number; stamp?: string },
  rows: RenderElement[],
  width: number,
): RenderElement {
  const { Box, Text } = ui;
  const countText = `${count} ${plural("skill", count)}`;
  return (
    <Box key={key} flexDirection="column" width={width}>
      <Box flexDirection="row" width={width} height={1} columnGap={1}>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          {header(ui, title, paneHeaderLook(), width - countText.length - 1, stamp)}
        </Box>
        <Box flexShrink={0}>
          <Text color={paneInk().muted} wrap="truncate-end">
            {countText}
          </Text>
        </Box>
      </Box>
      {rows}
    </Box>
  );
}

function usageParts(skill: SkillEntry, view: SkillsView): RightPart[] {
  const entry = view.usage?.[skill.name];
  if (view.usage === null || entry === undefined) return [];
  return usesParts(entry.usageCount ?? 0, entry.lastUsedAt, view.usage, view.now);
}

function usesParts(
  uses: number,
  lastUsedAt: number | undefined,
  usage: SkillUsage,
  now: number,
): RightPart[] {
  const columns = usageColumns(usage, now);
  const ink = paneInk();
  const countPart = { text: String(uses).padStart(columns.countWidth), color: ink.text };
  const wordPart = { text: usesWord(uses), color: ink.muted };
  if (lastUsedAt === undefined) {
    return [countPart, wordPart, { text: " ".repeat(3 + columns.ageWidth), color: ink.muted }];
  }
  const age = formatAge(Math.max(0, now - lastUsedAt)).padStart(columns.ageWidth);
  return [countPart, wordPart, { text: ` · ${age}`, color: ink.muted }];
}

function usageColumns(usage: SkillUsage, now: number): { countWidth: number; ageWidth: number } {
  const entries = Object.values(usage);
  return {
    countWidth: Math.max(...entries.map((entry) => String(entry.usageCount ?? 0).length)),
    ageWidth: Math.max(
      ...entries.map((entry) =>
        entry.lastUsedAt === undefined ? 0 : formatAge(Math.max(0, now - entry.lastUsedAt)).length,
      ),
    ),
  };
}

function tokenParts(tokens: number | undefined, tokenCells: number): RightPart[] {
  const ink = paneInk();
  if (tokens === undefined) {
    return [{ text: " ".repeat(tokenCells + TOKEN_UNIT.length), color: ink.muted }];
  }
  return [
    {
      text: formatTokens(tokens).padStart(tokenCells),
      color: tokens === 0 ? ink.muted : ink.text,
    },
    { text: TOKEN_UNIT, color: ink.muted },
  ];
}

function rightBox(
  { Box, Text }: Ui,
  key: string,
  parts: readonly RightPart[],
  marginLeft = 0,
): RenderElement {
  return (
    <Box key={key} flexShrink={0} flexDirection="row" marginLeft={marginLeft}>
      {parts.map(({ text, color }, index) => (
        <Text key={`${key}-${index}`} color={color} wrap="truncate-end">
          {text}
        </Text>
      ))}
    </Box>
  );
}

function usesWord(uses: number): string {
  return ` ${plural("use", uses)}`.padEnd(USES_WORD_WIDTH);
}

function ownerLabel(skill: SkillEntry): string {
  return skill.owner === "plugin" ? pluginOf(skill) : OWNER_TITLES[skill.owner];
}

function neverSection(ui: Ui, never: readonly SkillEntry[], view: ShownSkills): RenderElement {
  const { Box, Button, Text } = ui;
  const count = `${never.length} ${plural("skill", never.length)}`;
  const label = `${view.neverOpen ? OPEN_GLYPH : FOLDED_GLYPH} ${NEVER_USED_LABEL}`;
  const ownerCells = Math.max(0, ...never.map((skill) => displayWidth(ownerLabel(skill))));
  const rows = view.neverOpen
    ? [...never]
        .sort((left, right) => left.name.localeCompare(right.name))
        .flatMap((skill) =>
          skillRows(ui, skill, view, {
            indent: DESCRIPTION_INDENT_CELLS,
            right: [{ text: ownerLabel(skill).padEnd(ownerCells), color: paneInk().muted }],
          }),
        )
    : [];
  return (
    <Box key="never-used" flexDirection="column" width={view.width}>
      <Box flexDirection="row" width={view.width} height={1} columnGap={1}>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Button key="never-toggle" label={label} plain dimColor onPress={view.toggleNever} />
        </Box>
        <Box flexShrink={0}>
          <Text color={paneInk().muted} wrap="truncate-end">
            {count}
          </Text>
        </Box>
      </Box>
      {rows}
    </Box>
  );
}

function offSection(ui: Ui, names: readonly string[], view: SkillsView): RenderElement {
  const { Box, Button, Text } = ui;
  return sectionOf(
    ui,
    { key: "off", title: OFF_TITLE, count: names.length },
    names.map((name) => (
      <Box key={`off-${name}`} flexDirection="row" width={view.width} height={1} columnGap={1}>
        <Box flexGrow={1} flexShrink={1} minWidth={0} marginLeft={DESCRIPTION_INDENT_CELLS}>
          <Text color={paneInk().muted} wrap="truncate-end">
            {name}
          </Text>
        </Box>
        <Box flexShrink={0}>
          <Button
            key={`off-${name}-on`}
            label={TURN_ON_LABEL}
            plain
            dimColor
            onPress={() => view.setOff(name, false)}
          />
        </Box>
      </Box>
    )),
    view.width,
  );
}

type RightPart = { text: string; color: string | undefined };

type RowLook = { indent: number; right: readonly RightPart[] };

function skillRows(ui: Ui, skill: SkillEntry, view: ShownSkills, look: RowLook): RenderElement[] {
  const { Box, Button, Text } = ui;
  const isOpen = view.expanded.has(skill.name);
  const rows: RenderElement[] = [
    <Box
      key={`${skill.name}-row`}
      flexDirection="row"
      marginLeft={look.indent}
      width={view.width - look.indent}
      height={1}
      columnGap={1}
    >
      <Button
        key={`${skill.name}-toggle`}
        label={isOpen ? OPEN_GLYPH : FOLDED_GLYPH}
        plain
        dimColor
        onPress={() => view.toggle(skill.name)}
      />
      <Box flexGrow={1} flexShrink={1} minWidth={0}>
        {labelButton(ui, {
          key: skill.name,
          label: skill.name,
          onPress: () => view.insert(skill.name),
        })}
      </Box>
      {rightBox(ui, `${skill.name}-tokens`, tokenParts(skill.tokens, view.tokenCells))}
      {look.right.length === 0
        ? null
        : rightBox(ui, `${skill.name}-uses`, look.right, STATS_EXTRA_GAP_CELLS)}
    </Box>,
  ];
  if (!isOpen) return rows;
  const detailIndent = look.indent + DESCRIPTION_INDENT_CELLS;
  if (skill.description !== "") {
    rows.push(
      <Box
        key={`${skill.name}-description`}
        marginLeft={detailIndent}
        width={view.width - detailIndent}
      >
        <Text color={paneInk().muted} wrap="wrap">
          {skill.description}
        </Text>
      </Box>,
    );
  }
  if (skill.owner === "plugin") return rows;
  const isOff = view.offNames.has(skill.name);
  rows.push(
    <Box key={`${skill.name}-actions`} marginLeft={detailIndent} height={1}>
      <Button
        key={`${skill.name}-switch`}
        label={isOff ? TURN_ON_LABEL : TURN_OFF_LABEL}
        plain
        dimColor
        onPress={() => view.setOff(skill.name, !isOff)}
      />
    </Box>,
  );
  return rows;
}
