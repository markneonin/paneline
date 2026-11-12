import { describe, expect, test } from "claude-code/testing";
import type { Engine } from "claude-code/testing";

import { categoryColors, palette } from "../hooks/palette";
import { accentOf, chipColors } from "../hooks/session-color";
import { childrenOf, collect } from "./draw-tree";
import type { Node } from "./draw-tree";

const FENCE = "```";
const REPLY_COLUMNS = 100;
const SUBAGENT_COLOR_NAMES = [
  "red",
  "blue",
  "green",
  "yellow",
  "purple",
  "orange",
  "pink",
  "cyan",
] as const;
const CATEGORY_KEYS = [
  "permission",
  "success",
  "warning",
  "merged",
  "background",
  "error",
  "claude",
  "planMode",
];
const BOX_LABELS = [
  "alpha",
  "bravo",
  "charlie",
  "delta",
  "echo",
  "foxtrot",
  "golf",
  "hotel",
  "india",
];
const ENGINE_THEME_KEYS = [
  "autoAccept",
  "autoAcceptShimmer",
  "skill",
  "bashBorder",
  "claude",
  "claudeShimmer",
  "claudeBlue_FOR_SYSTEM_SPINNER",
  "claudeBlueShimmer_FOR_SYSTEM_SPINNER",
  "permission",
  "permissionShimmer",
  "planMode",
  "ide",
  "promptBorder",
  "promptBorderShimmer",
  "text",
  "inverseText",
  "inactive",
  "inactiveShimmer",
  "subtle",
  "suggestion",
  "remember",
  "background",
  "success",
  "error",
  "warning",
  "merged",
  "warningShimmer",
  "diffAdded",
  "diffRemoved",
  "diffAddedDimmed",
  "diffRemovedDimmed",
  "diffAddedWord",
  "diffRemovedWord",
  "red_FOR_SUBAGENTS_ONLY",
  "blue_FOR_SUBAGENTS_ONLY",
  "green_FOR_SUBAGENTS_ONLY",
  "yellow_FOR_SUBAGENTS_ONLY",
  "purple_FOR_SUBAGENTS_ONLY",
  "orange_FOR_SUBAGENTS_ONLY",
  "pink_FOR_SUBAGENTS_ONLY",
  "cyan_FOR_SUBAGENTS_ONLY",
  "professionalBlue",
  "chromeYellow",
  "clawd_body",
  "clawd_background",
  "userMessageBackground",
  "userMessageBackgroundHover",
  "composerSidebarBackground",
  "selectionBg",
  "bashMessageBackgroundColor",
  "memoryBackgroundColor",
  "rate_limit_fill",
  "rate_limit_empty",
  "fastMode",
  "fastModeShimmer",
  "effortUltra",
  "briefLabelYou",
  "briefLabelClaude",
  "rainbow_red",
  "rainbow_orange",
  "rainbow_yellow",
  "rainbow_green",
  "rainbow_blue",
  "rainbow_indigo",
  "rainbow_violet",
  "rainbow_red_shimmer",
  "rainbow_orange_shimmer",
  "rainbow_yellow_shimmer",
  "rainbow_green_shimmer",
  "rainbow_blue_shimmer",
  "rainbow_indigo_shimmer",
  "rainbow_violet_shimmer",
];

describe("every colour is a theme key", () => {
  test("TH1 every palette colour is a name the engine resolves per theme", () => {
    const outsideTheme = Object.entries(palette).filter(([, colour]) => !isThemeKey(colour));

    expect(outsideTheme).toEqual([]);
  });

  test("TH1c each palette entry draws with the theme key the plan maps it to", () => {
    expect(palette).toEqual({
      text: "text",
      userText: "text",
      muted: "inactive",
      rule: "subtle",
      meterEmpty: "subtle",
      section: "permission",
      tool: "permission",
      button: "background",
      identifier: "briefLabelYou",
      keyword: "merged",
      ok: "success",
      failed: "error",
      alert: "warning",
      user: "claude",
      userBand: "userMessageBackground",
      panel: "composerSidebarBackground",
      addedBand: "diffAdded",
      removedBand: "diffRemoved",
    });
  });

  test("TH1b every category hue is a name the engine resolves per theme", () => {
    const outsideTheme = categoryColors.filter((colour) => !isThemeKey(colour));

    expect(outsideTheme).toEqual([]);
  });
});

describe("session colour", () => {
  test("TH2 each /color name gives the accent the engine uses for that name", () => {
    const accents = Object.fromEntries(SUBAGENT_COLOR_NAMES.map((name) => [name, accentOf(name)]));

    expect(accents).toEqual(
      Object.fromEntries(SUBAGENT_COLOR_NAMES.map((name) => [name, subagentKeyOf(name)])),
    );
  });

  test("TH3 with no colour set the accent is the prompt border and the chips are plain text with no background", () => {
    expect(accentOf("default")).toBe("promptBorder");
    expect(chipColors("default").text).toBe("promptBorder");
    expect(chipColors("default").background).toBeUndefined();
  });

  test("TH4 under each /color name the chips are that colour with the accent text", () => {
    const chips = Object.fromEntries(SUBAGENT_COLOR_NAMES.map((name) => [name, chipColors(name)]));

    expect(chips).toEqual(
      Object.fromEntries(
        SUBAGENT_COLOR_NAMES.map((name) => [
          name,
          { background: subagentKeyOf(name), text: "clawd_background" },
        ]),
      ),
    );
  });
});

describe("reply visuals", () => {
  test("TH8 a code block has a user-message band over a sidebar-coloured body", async ($, on) => {
    on("ui.copy", () => ({ value: { isCopied: true } }));

    const tree = (await (
      await mountReply($, `${FENCE}ts title="a.ts"\nconst a = 1\n${FENCE}`)
    ).drawn()) as Node;

    const [band, body] = childrenOf(codePanelOf(tree));
    expect(band?.props?.backgroundColor).toBe("userMessageBackground");
    expect(body?.props?.backgroundColor).toBe("composerSidebarBackground");
  });

  test("TH9 diagram boxes take the 8 category colours in order", async ($) => {
    const reply = await mountReply($, flowchartOf(BOX_LABELS.slice(0, 8)));

    expect(await boxColorsOf(reply, BOX_LABELS.slice(0, 8))).toEqual(CATEGORY_KEYS);
  });

  test("TH9b the ninth diagram box takes the colour of the first", async ($) => {
    const reply = await mountReply($, flowchartOf(BOX_LABELS));

    expect((await boxColorsOf(reply, BOX_LABELS))[8]).toBe("permission");
  });
});

function isThemeKey(colour: string): boolean {
  return ENGINE_THEME_KEYS.includes(colour);
}

function subagentKeyOf(name: string): string {
  return `${name}_FOR_SUBAGENTS_ONLY`;
}

function mountReply($: Engine, text: string) {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "AssistantMessage",
    props: { text, isFirstOfReply: true },
    viewport: { columns: REPLY_COLUMNS, rows: 24 },
  });
}

function flowchartOf(labels: string[]): string {
  const nodes = labels.map((label, i) => `N${i}[${label}]`).join(" --> ");
  return [`${FENCE}mermaid`, "flowchart TD", `  ${nodes}`, FENCE].join("\n");
}

function codePanelOf(tree: Node): Node {
  const panel = collect(tree, "Box").find((box) => {
    const [band, body] = childrenOf(box);
    return (
      childrenOf(box).length === 2 &&
      collect(band!, "Button").filter((button) => button.props?.label === "Copy").length === 1 &&
      collect(body!, "Code").length === 1
    );
  });
  if (panel === undefined) throw new Error("no code panel in the reply");
  return panel;
}

async function boxColorsOf(
  reply: Awaited<ReturnType<typeof mountReply>>,
  labels: string[],
): Promise<unknown[]> {
  const words = await reply.findAll({ type: "Text" });
  return labels.map(
    (label) =>
      words.find(
        (word) => word.text === label && word.children.every((child) => typeof child === "string"),
      )?.props.color,
  );
}
