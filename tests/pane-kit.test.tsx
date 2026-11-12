import { describe, expect, test } from "claude-code/testing";
import type { ElementTable, On, RenderElement } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { palette } from "../hooks/palette";
import { paneInk } from "../hooks/pane-ink";
import {
  bar,
  button,
  gapRow,
  header,
  isLightTheme,
  labelButton,
  paneHeaderLook,
  paneRow,
  plural,
  sectionLook,
  statusDot,
} from "../hooks/pane-kit";
import { collect, findText, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";

type Pane = Mounted<"terminal", "Pane">;
type RowSpec = Parameters<typeof paneRow>[1];

const ROW_WIDTH = 24;
const PANE_ROWS = 4;
const HEADER_LABEL = "Files";
const HEADER_WIDTH = 20;
const HEADER_RULE = "─".repeat(HEADER_WIDTH - HEADER_LABEL.length - 1);
const NARROW_LABEL = "Session";
const NARROW_WIDTH = 4;
const METER_CELLS = 10;
const HALF_VALUE = 5;
const FULL_VALUE = 10;
const OVER_VALUE = 15;
const NO_MAXIMUM = 0;
const FILLED = "▰";
const EMPTY = "▱";
const HALF_METER = FILLED.repeat(HALF_VALUE) + EMPTY.repeat(METER_CELLS - HALF_VALUE);
const BUTTON_KEY = "open";
const BUTTON_LABEL = "Open";
const BUTTON_OPEN = "[ ";
const BUTTON_CLOSE = " ]";
const ACCENT = "red";
const GAP_KEY = "gap";
const GAP_GUIDES = "│ │ ";
const HOLLOW_GLYPH = "○";
const DOT_GLYPH = "●";
const DOT_LABEL = "Bash";
const NOUN = "agent";
const LIGHT_THEME = "light-ansi";
const DARK_THEME = "dark";

describe("pane row text", () => {
  test("K1 a wide label is cut to the cells it has, not to its characters", async ($, on) => {
    const texts = await rowTexts($, on, {
      label: { text: "数据库迁移工具名称", color: undefined },
      middle: { text: "", color: undefined },
      middleWrap: "truncate-end",
      width: ROW_WIDTH,
    });

    expect(texts).toContain("数据库…");
  });

  test("K2 wide emoji on the right are cut to the cells they fill, with an ellipsis", async ($, on) => {
    const texts = await rowTexts($, on, {
      middle: { text: "", color: undefined },
      middleWrap: "truncate-end",
      right: { text: "🔥🔥🔥🔥🔥", color: undefined },
      width: ROW_WIDTH,
    });

    expect(texts).toContain("🔥🔥…");
  });

  test("K3 ASCII text is cut at the same column with an ellipsis as before", async ($, on) => {
    const texts = await rowTexts($, on, {
      label: { text: "Bash command runner", color: undefined },
      middle: { text: "", color: undefined },
      middleWrap: "truncate-end",
      width: ROW_WIDTH,
    });

    expect(texts).toContain("Bash co…");
  });

  test("K4 wide text that fits its cells is drawn whole", async ($, on) => {
    const texts = await rowTexts($, on, {
      label: { text: "数据库", color: undefined },
      middle: { text: "", color: undefined },
      middleWrap: "truncate-end",
      right: { text: "🔥🔥", color: undefined },
      width: ROW_WIDTH,
    });

    expect(texts).toContain("数据库");
    expect(texts).toContain("🔥🔥");
  });

  test("K19 a status row shows its dot before its label", async ($, on) => {
    const texts = await rowTexts($, on, {
      dot: { text: DOT_GLYPH, color: palette.ok },
      label: { text: DOT_LABEL, color: undefined },
      middle: { text: "", color: undefined },
      middleWrap: "truncate-end",
      width: ROW_WIDTH,
    });

    expect(texts.indexOf(DOT_GLYPH)).toBeGreaterThanOrEqual(0);
    expect(texts.indexOf(DOT_LABEL)).toBeGreaterThan(texts.indexOf(DOT_GLYPH));
  });
});

describe("status dots", () => {
  test("K5 a finished agent's status dot is a check mark", () => {
    expect(statusDot("done").text).toBe("✓");
  });

  test("K6 a failed agent's status dot is a cross", () => {
    expect(statusDot("failed").text).toBe("✗");
  });

  test("K7 a running agent's status dot is a filled circle", () => {
    expect(statusDot("running").text).toBe(DOT_GLYPH);
  });

  test("K23 agent status dots are coloured by status: finished ok, failed failed, waiting alert", () => {
    expect(statusDot("done").color).toBe(paneInk().ok);
    expect(statusDot("failed").color).toBe(paneInk().failed);
    expect(statusDot("waiting").color).toBe(paneInk().alert);
  });

  test("K24 an idle agent's status dot is a hollow dim circle", () => {
    expect(statusDot("idle").text).toBe(HOLLOW_GLYPH);
    expect(statusDot("idle").color).toBe(paneInk().muted);
  });

  test("K25 a stopped agent's status dot is a hollow dim circle", () => {
    expect(statusDot("stopped").text).toBe(HOLLOW_GLYPH);
    expect(statusDot("stopped").color).toBe(paneInk().muted);
  });
});

describe("section headers", () => {
  test("K8 a header's rule fills the row after its label", async ($, on) => {
    const texts = await drawnTexts($, on, (ui) =>
      header(ui, HEADER_LABEL, sectionLook(null), HEADER_WIDTH),
    );

    expect(texts).toContain(`${HEADER_LABEL} ${HEADER_RULE}`);
  });

  test("K9 a header narrower than its label shows the label and no rule", async ($, on) => {
    const texts = await drawnTexts($, on, (ui) =>
      header(ui, NARROW_LABEL, sectionLook(null), NARROW_WIDTH),
    );

    expect(texts.find((text) => text.startsWith(NARROW_LABEL))).toBe(`${NARROW_LABEL} `);
  });

  test("K15 a header with a session accent is drawn in the accent colour", async ($, on) => {
    const pane = await paneWith($, on, (ui) =>
      header(ui, HEADER_LABEL, sectionLook(ACCENT), HEADER_WIDTH),
    );

    expect(labelColour(await drawnTree(pane), HEADER_LABEL)).toBe(ACCENT);
  });

  test("K16 a header with no session accent is drawn in the house section colour", async ($, on) => {
    const pane = await paneWith($, on, (ui) =>
      header(ui, HEADER_LABEL, sectionLook(null), HEADER_WIDTH),
    );

    expect(labelColour(await drawnTree(pane), HEADER_LABEL)).toBe(palette.section);
  });

  test("K17 the pane header is drawn in the pane's text colour with its rule in the pane's rule colour", async ($, on) => {
    const pane = await paneWith($, on, (ui) =>
      header(ui, HEADER_LABEL, paneHeaderLook(), HEADER_WIDTH),
    );
    const tree = await drawnTree(pane);
    const rule = collect(tree, "Text").find((node) => textOf(node) === ` ${HEADER_RULE}`);

    expect(labelColour(tree, HEADER_LABEL)).toBe(paneInk().text);
    expect(rule?.props?.color).toBe(paneInk().rule);
  });

  test("K22 a header with a session accent draws its rule in the accent colour", async ($, on) => {
    const pane = await paneWith($, on, (ui) =>
      header(ui, HEADER_LABEL, sectionLook(ACCENT), HEADER_WIDTH),
    );
    const rule = collect(await drawnTree(pane), "Text").find(
      (node) => textOf(node) === ` ${HEADER_RULE}`,
    );

    expect(rule?.props?.color).toBe(ACCENT);
  });

  test("K20 a count of one reads singular, zero or many read plural", () => {
    expect(plural(NOUN, 1)).toBe(NOUN);
    expect(plural(NOUN, 0)).toBe(`${NOUN}s`);
    expect(plural(NOUN, 2)).toBe(`${NOUN}s`);
  });

  test("K21 light theme names are recognised as light and dark is not", () => {
    expect(isLightTheme(LIGHT_THEME)).toBe(true);
    expect(isLightTheme(DARK_THEME)).toBe(false);
  });
});

describe("meters", () => {
  test("K10 a meter with half its cells filled shows five filled and five empty", async ($, on) => {
    const texts = await drawnTexts($, on, (ui) =>
      bar(ui, HALF_VALUE, FULL_VALUE, METER_CELLS, palette.ok),
    );

    expect(texts).toContain(HALF_METER);
  });

  test("K11 a meter whose value is past its maximum is drawn full", async ($, on) => {
    const texts = await drawnTexts($, on, (ui) =>
      bar(ui, OVER_VALUE, FULL_VALUE, METER_CELLS, palette.ok),
    );

    expect(texts).toContain(FILLED.repeat(METER_CELLS));
    expect(texts.some((text) => text.includes(EMPTY))).toBe(false);
  });

  test("K12 a meter with no maximum is drawn empty", async ($, on) => {
    const texts = await drawnTexts($, on, (ui) =>
      bar(ui, HALF_VALUE, NO_MAXIMUM, METER_CELLS, palette.ok),
    );

    expect(texts).toContain(EMPTY.repeat(METER_CELLS));
    expect(texts.some((text) => text.includes(FILLED))).toBe(false);
  });
});

describe("buttons", () => {
  test("K13 a bracketed button shows its label inside brackets", async ($, on) => {
    const pane = await paneWith($, on, (ui) =>
      button(ui, { key: BUTTON_KEY, label: BUTTON_LABEL, onPress: () => undefined }),
    );

    expect(await buttonLabels(pane)).toEqual([BUTTON_LABEL]);
    const texts = await textsOf(pane);
    expect(texts).toContain(BUTTON_OPEN);
    expect(texts).toContain(BUTTON_CLOSE);
  });

  test("K14 a label-only button shows its label without brackets", async ($, on) => {
    const pane = await paneWith($, on, (ui) =>
      labelButton(ui, { key: BUTTON_KEY, label: BUTTON_LABEL, onPress: () => undefined }),
    );

    expect(await buttonLabels(pane)).toEqual([BUTTON_LABEL]);
    expect(await textsOf(pane)).not.toContain(BUTTON_OPEN);
  });
});

describe("gap rows", () => {
  test("K18 a gap row draws its guide characters unchanged", async ($, on) => {
    const texts = await drawnTexts($, on, (ui) => gapRow(ui, GAP_KEY, GAP_GUIDES, palette.rule));

    expect(texts).toContain(GAP_GUIDES);
  });
});

async function rowTexts($: Engine, on: On, spec: RowSpec): Promise<string[]> {
  return drawnTexts($, on, (ui) => paneRow(ui, spec));
}

async function drawnTexts($: Engine, on: On, render: RenderFn): Promise<string[]> {
  return textsOf(await paneWith($, on, render));
}

async function textsOf(pane: Pane): Promise<string[]> {
  return collect(await drawnTree(pane), "Text").map(textOf);
}

type RenderFn = (ui: ElementTable) => RenderElement;

async function paneWith($: Engine, on: On, render: RenderFn): Promise<Pane> {
  on("ui.render", { component: "Pane" }, (engine, e) => render(engine.ui.resolve(e)));
  return mountPane($);
}

async function drawnTree(pane: Pane): Promise<Node> {
  return pane.drawn();
}

async function buttonLabels(pane: Pane): Promise<unknown[]> {
  return (await pane.findAll({ type: "Button" })).map((found) => found.props.label);
}

function labelColour(tree: Node, label: string): unknown {
  return findText(tree, label)?.props?.color;
}

function mountPane($: Engine): Promise<Pane> {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "Pane",
    props: {
      title: "Pane kit",
      isFocused: false,
      bodyColumns: ROW_WIDTH,
      placement: "dock",
      scroll: { offset: 0, bodyRows: PANE_ROWS },
      view: {},
    },
    viewport: { columns: ROW_WIDTH, rows: PANE_ROWS },
  });
}
