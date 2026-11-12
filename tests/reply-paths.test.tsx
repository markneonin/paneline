import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, Mounted } from "claude-code/testing";

import { paneInk } from "../hooks/pane-ink";
import { screenRows } from "./band-screen";
import { childrenOf, collect, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import { feedSession } from "./session-feed";
import { shownTexts } from "./skills-tree";

type Pane = Mounted<"terminal", "Pane">;
type Reply = Mounted<"terminal", "AssistantMessage">;
type Outcome = { result: unknown; text?: string };
type World = { diffs: Map<string, string>; opened: string[]; outcomes: Map<string, Outcome> };

const FENCE = "```";
const CWD = "/work";
const HOME = "/h/u";
const WIDE = 100;
const NARROW = 24;
const LONG_PATH = "some/deeply/nested/folder/with/a/long/file-name.ts";
const LONG_TARGET = `/work/${LONG_PATH}`;
const DIFF_MARK = "+marker-line";
const NEAR_RIGHT_EDGE = WIDE - 10;
const HEBREW_LETTER = /\p{Script=Hebrew}/u;
const ACTIVITY_REPLY = [
  "Look at lib/bare.py first.",
  "",
  "## Heading `src/heading.ts`",
  "",
  "The code `src/code.ts`, `npm test` and [linked](./src/link.ts) or [site](https://x.dev).",
  "",
  "| file | note |",
  "| --- | --- |",
  "| `src/cell.ts` | changed |",
  "",
  `${FENCE}ts title="src/titled.ts"`,
  "const a = 1",
  FENCE,
].join("\n");

describe("file paths in a reply", () => {
  test("P1 pressing an inline-code path opens its diff in the Files tab", async ($, on) => {
    const world = await startedWorld($, on);
    world.diffs.set("/work/src/m.ts", diffOf("/work/src/m.ts"));
    const reply = await mountReply($, "I changed `/work/src/m.ts` today.");

    await pressPath(reply, /m\.ts/);

    const pane = await mountPane($);
    expect(await backRow(pane)).toBe("/work/src/m.ts");
    expect(await diffSource(pane)).toContain(DIFF_MARK);
    expect(world.opened).toContain("session");
  });

  test("P2 pressing a markdown link to a local path opens its diff", async ($, on) => {
    const world = await startedWorld($, on);
    world.diffs.set("/work/src/link.ts", diffOf("/work/src/link.ts"));
    const reply = await mountReply($, "See [the helper](src/link.ts) for details.");

    await pressPath(reply, /the helper/);

    const pane = await mountPane($);
    expect(await backRow(pane)).toBe("/work/src/link.ts");
    expect(await diffSource(pane)).toContain(DIFF_MARK);
  });

  test("P3 pressing the title of a code block opens its diff", async ($, on) => {
    const world = await startedWorld($, on);
    world.diffs.set("/work/src/titled.ts", diffOf("/work/src/titled.ts"));
    const reply = await mountReply($, `${FENCE}ts title="src/titled.ts"\nconst a = 1\n${FENCE}`);

    await pressPath(reply, /src\/titled\.ts/);

    const pane = await mountPane($);
    expect(await backRow(pane)).toBe("/work/src/titled.ts");
    expect(await diffSource(pane)).toContain(DIFF_MARK);
  });

  test("P4 pressing a bare path in prose opens its diff", async ($, on) => {
    const world = await startedWorld($, on);
    world.diffs.set("/work/lib/bare.py", diffOf("/work/lib/bare.py"));
    const reply = await mountReply($, "The bug is in lib/bare.py near the top.");

    await pressPath(reply, /lib\/bare\.py/);

    const pane = await mountPane($);
    expect(await backRow(pane)).toBe("/work/lib/bare.py");
    expect(await diffSource(pane)).toContain(DIFF_MARK);
  });

  test("P5 a path in a list item can be pressed", async ($, on) => {
    const world = await startedWorld($, on);
    world.diffs.set("/work/src/item.ts", diffOf("/work/src/item.ts"));
    const reply = await mountReply($, "- first\n- edit `src/item.ts` now\n- last");

    await pressPath(reply, /item\.ts/);

    const pane = await mountPane($);
    expect(await backRow(pane)).toBe("/work/src/item.ts");
    expect(await diffSource(pane)).toContain(DIFF_MARK);
  });

  test("P6 a path in a table cell can be pressed", async ($, on) => {
    const world = await startedWorld($, on);
    world.diffs.set("/work/src/cell.ts", diffOf("/work/src/cell.ts"));
    const reply = await mountReply(
      $,
      "| file | note |\n| --- | --- |\n| `src/cell.ts` | changed |",
    );

    await pressPath(reply, /cell\.ts/);

    const pane = await mountPane($);
    expect(await backRow(pane)).toBe("/work/src/cell.ts");
    expect(await diffSource(pane)).toContain(DIFF_MARK);
  });

  test("P7 a path in a heading and in a quote can be pressed", async ($, on) => {
    const world = await startedWorld($, on);
    world.diffs.set("/work/src/head.ts", diffOf("/work/src/head.ts"));
    world.diffs.set("/work/src/quote.ts", diffOf("/work/src/quote.ts"));
    const reply = await mountReply($, "## About `src/head.ts`\n\n> and `src/quote.ts`");

    const pane = await mountPane($);
    await pressPath(reply, /head\.ts/);
    const first = await backRow(pane);
    await pressPath(reply, /quote\.ts/);
    const second = await backRow(pane);

    expect(first).toBe("/work/src/head.ts");
    expect(second).toBe("/work/src/quote.ts");
  });

  test("P8 a relative path resolves against the session directory", async ($, on) => {
    const world = await startedWorld($, on);
    world.diffs.set("/work/README.md", diffOf("/work/README.md"));
    const reply = await mountReply($, "Read `README.md` first.");

    await pressPath(reply, /README\.md/);

    expect(await backRow(await mountPane($))).toBe("/work/README.md");
  });

  test("P9 a path starting with ~/ resolves against the home directory", async ($, on) => {
    const world = await startedWorld($, on);
    world.diffs.set(`${HOME}/notes/todo.md`, diffOf(`${HOME}/notes/todo.md`));
    const reply = await mountReply($, "Open `~/notes/todo.md` please.");

    await pressPath(reply, /todo\.md/);

    expect(await backRow(await mountPane($))).toBe("~/notes/todo.md");
  });

  test("P10 a :line suffix and an #L suffix are dropped from the opened path", async ($, on) => {
    const world = await startedWorld($, on);
    world.diffs.set("/work/hooks/a.ts", diffOf("/work/hooks/a.ts"));
    world.diffs.set("/work/hooks/b.ts", diffOf("/work/hooks/b.ts"));
    const reply = await mountReply($, "At `hooks/a.ts:42:7` and [b](hooks/b.ts#L10).");

    const pane = await mountPane($);
    await pressPath(reply, /a\.ts/);
    const first = await backRow(pane);
    await pressPath(reply, /^b$/);
    const second = await backRow(pane);

    expect(first).toBe("/work/hooks/a.ts");
    expect(second).toBe("/work/hooks/b.ts");
  });

  test("P11 a long path that wraps over several rows still opens its diff", async ($, on) => {
    const world = await startedWorld($, on);
    const target = "/work/some/deeply/nested/folder/with/a/long/file-name.ts";
    world.diffs.set(target, diffOf(target));
    const reply = await mountReply(
      $,
      `Look at \`some/deeply/nested/folder/with/a/long/file-name.ts\` ok.`,
      NARROW,
    );

    await pressPath(reply, /./);

    expect(await backRow(await mountPane($))).toBe(target);
  });

  test("P15 a path too long for the row starts beside the prose before it and every row of it opens the full path", async ($, on) => {
    const world = await startedWorld($, on);
    world.diffs.set(LONG_TARGET, diffOf(LONG_TARGET));
    const reply = await mountReply($, `Look at \`${LONG_PATH}\` ok.`, NARROW);
    const pane = await mountPane($);

    const rows = shownTexts(await reply.drawn());
    const buttons = await reply.findAll({ type: "Button" });
    const opened: (string | undefined)[] = [];
    for (const button of buttons) {
      await reply.press({ key: button.key ?? "" });
      await reply.redraw();
      opened.push(await backRow(pane));
    }

    expect(rows.find((row) => row.startsWith("Look at"))).toMatch(/^Look at \S/);
    expect(rows.join("")).toContain(LONG_PATH.replace(/\s/g, ""));
    expect(buttons.length).toBeGreaterThan(1);
    expect(opened).toEqual(buttons.map(() => LONG_TARGET));
  });

  test("P16 a long path in a quote and in a table cell opens the full path from every row", async ($, on) => {
    const world = await startedWorld($, on);
    world.diffs.set(LONG_TARGET, diffOf(LONG_TARGET));
    const pane = await mountPane($);

    for (const text of [`> see \`${LONG_PATH}\``, `| file |\n| --- |\n| \`${LONG_PATH}\` |`]) {
      const reply = await mountReply($, text, NARROW);
      const buttons = await reply.findAll({ type: "Button" });
      for (const button of buttons) {
        await reply.press({ key: button.key ?? "" });
        await reply.redraw();
        expect(await backRow(pane)).toBe(LONG_TARGET);
      }
      expect(buttons.length).toBeGreaterThan(0);
      await reply.unmount();
    }
  });

  test("P17 a path in a reply shown in the Activity tab is plain text in its colour, and Copy is the only button", async ($, on) => {
    const world = await startedWorld($, on);
    world.outcomes.set("p17", { result: ACTIVITY_REPLY, text: ACTIVITY_REPLY });
    await $.tool.call({ tool: "Agent", description: "look around", tool_use_id: "p17" } as never);
    const pane = await mountPane($);
    await pane.press({ key: "call-p17" });

    const tree = (await pane.drawn()) as unknown as Node;
    const detail = detailOf(tree);

    expect(collect(detail, "Button").filter(isNotBack).map(buttonLabel)).toEqual(["Copy"]);
    expect(colourOf(tree, "lib/bare.py")).toBe(paneInk().text);
    expect(colourOf(tree, "src/titled.ts")).toBe(paneInk().text);
    for (const word of ["src/heading.ts", "src/code.ts", "src/cell.ts"])
      expect(colourOf(tree, word)).toBe(colourOf(tree, "npm test"));
    expect(colourOf(tree, "linked")).toBe(colourOf(tree, "site"));
  });

  test("P12 a path with no changes opens the Files tab with No changes.", async ($, on) => {
    await startedWorld($, on);
    const reply = await mountReply($, "Check `src/untouched.ts` too.");

    await pressPath(reply, /untouched\.ts/);

    const pane = await mountPane($);
    expect(await backRow(pane)).toBe("/work/src/untouched.ts");
    expect(shownTexts(await pane.drawn()).some((text) => text.includes("No changes."))).toBe(true);
  });

  test("P13 a reply drawn again still opens the diff when a path is pressed", async ($, on) => {
    const world = await startedWorld($, on);
    world.diffs.set("/work/src/m.ts", diffOf("/work/src/m.ts"));
    const text = "I changed `src/m.ts` today.";
    const first = await mountReply($, text);
    await first.unmount();

    const again = await mountReply($, text);
    await pressPath(again, /m\.ts/);

    expect(await backRow(await mountPane($))).toBe("/work/src/m.ts");
  });

  test("P14 a reply that keeps growing under a path still opens that path", async ($, on) => {
    const world = await startedWorld($, on);
    world.diffs.set("/work/src/m.ts", diffOf("/work/src/m.ts"));
    const text = "I changed `src/m.ts` today.";
    const reply = await mountReply($, text);

    await reply.redraw({ text: `${text}\n\nMore words arrive.`, isFirstOfReply: true });
    await pressPath(reply, /m\.ts/);

    expect(await backRow(await mountPane($))).toBe("/work/src/m.ts");
  });
});

describe("file paths in right-to-left replies", () => {
  test("PH1 in a Hebrew paragraph pressing an inline-code path opens its diff in the Files tab and the row ends at the right edge", async ($, on) => {
    const world = await startedWorld($, on);
    world.diffs.set("/work/src/m.ts", diffOf("/work/src/m.ts"));
    const reply = await mountReply($, "שלום עולם `/work/src/m.ts` בית ספר מים");

    await pressPath(reply, /m\.ts/);

    const rows = hebrewRows(await reply.drawn(), WIDE);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.length).toBeGreaterThanOrEqual(NEAR_RIGHT_EDGE);
    const pane = await mountPane($);
    expect(await backRow(pane)).toBe("/work/src/m.ts");
    expect(await diffSource(pane)).toContain(DIFF_MARK);
    expect(world.opened).toContain("session");
  });

  test("PH2 in a Hebrew list item pressing an inline-code path opens its diff in the Files tab and the row ends at the right edge", async ($, on) => {
    const world = await startedWorld($, on);
    world.diffs.set("/work/src/m.ts", diffOf("/work/src/m.ts"));
    const reply = await mountReply($, "- שלום עולם `/work/src/m.ts` בית ספר מים");

    await pressPath(reply, /m\.ts/);

    const rows = hebrewRows(await reply.drawn(), WIDE);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.length).toBeGreaterThanOrEqual(NEAR_RIGHT_EDGE);
    const pane = await mountPane($);
    expect(await backRow(pane)).toBe("/work/src/m.ts");
    expect(await diffSource(pane)).toContain(DIFF_MARK);
    expect(world.opened).toContain("session");
  });

  test("PH3 in a Hebrew heading pressing an inline-code path opens its diff in the Files tab and the row ends at the right edge", async ($, on) => {
    const world = await startedWorld($, on);
    world.diffs.set("/work/src/m.ts", diffOf("/work/src/m.ts"));
    const reply = await mountReply($, "## שלום עולם `/work/src/m.ts` בית");

    await pressPath(reply, /m\.ts/);

    const rows = hebrewRows(await reply.drawn(), WIDE);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.length).toBeGreaterThanOrEqual(NEAR_RIGHT_EDGE);
    const pane = await mountPane($);
    expect(await backRow(pane)).toBe("/work/src/m.ts");
    expect(await diffSource(pane)).toContain(DIFF_MARK);
    expect(world.opened).toContain("session");
  });

  test("PH4 in a Hebrew quote pressing an inline-code path opens its diff in the Files tab and the row ends at the right edge", async ($, on) => {
    const world = await startedWorld($, on);
    world.diffs.set("/work/src/m.ts", diffOf("/work/src/m.ts"));
    const reply = await mountReply($, "> שלום עולם `/work/src/m.ts` בית ספר מים");

    await pressPath(reply, /m\.ts/);

    const rows = hebrewRows(await reply.drawn(), WIDE);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.length).toBeGreaterThanOrEqual(NEAR_RIGHT_EDGE);
    const pane = await mountPane($);
    expect(await backRow(pane)).toBe("/work/src/m.ts");
    expect(await diffSource(pane)).toContain(DIFF_MARK);
    expect(world.opened).toContain("session");
  });
});

describe("file names beyond the common extensions", () => {
  test("P19 inline code naming a Go, Rust, SQL, Makefile or Dockerfile file opens its diff", async ($, on) => {
    const world = await startedWorld($, on);
    const names = ["main.go", "src/lib.rs", "db/a.sql", "Makefile", "Dockerfile"];
    for (const name of names) world.diffs.set(`/work/${name}`, diffOf(`/work/${name}`));
    const reply = await mountReply($, names.map((name) => `Edit \`${name}\`.`).join("\n\n"));
    const pane = await mountPane($);

    const opened: (string | undefined)[] = [];
    for (const name of names) {
      await pressPath(reply, new RegExp(`^${name.replace(".", "\\.")}$`));
      opened.push(await backRow(pane));
    }

    expect(opened).toEqual(names.map((name) => `/work/${name}`));
  });

  test("P20 Node.js and Vue.js in prose stay plain text while a backticked README.md stays pressable", async ($, on) => {
    await startedWorld($, on);

    const reply = await mountReply($, "Node.js and Vue.js are fine, but open `README.md`.");

    const labels = (await reply.findAll({ type: "Button" })).map(buttonLabel);
    expect(labels).toEqual(["README.md"]);
    expect(shownTexts(await reply.drawn()).join("")).toContain("Node.js and Vue.js");
  });
});

describe("text that is not a file path", () => {
  test("N1 code like $.ui.open and e.requestId is not pressable", async ($, on) => {
    await startedWorld($, on);

    const reply = await mountReply($, "Call `$.ui.open` with `e.requestId` and `ls src`.");

    expect(await reply.findAll({ type: "Button" })).toHaveLength(0);
    expect(shownTexts(await reply.drawn()).join("")).toContain("$.ui.open");
  });

  test("N2 a web address is not pressable, in code or in prose", async ($, on) => {
    await startedWorld($, on);

    const reply = await mountReply(
      $,
      "Docs at https://example.com/docs/guide.md and `https://example.com/a/b.ts`.",
    );

    expect(await reply.findAll({ type: "Button" })).toHaveLength(0);
  });

  test("N3 a paragraph without a path has no buttons and keeps its words", async ($, on) => {
    await startedWorld($, on);

    const reply = await mountReply(
      $,
      "Plain words, **bold** and `code` with a [site](https://x.dev).",
    );

    expect(await reply.findAll({ type: "Button" })).toHaveLength(0);
    const shown = shownTexts(await reply.drawn()).join("");
    expect(shown).toContain("Plain words,");
    expect(shown).toContain("bold");
    expect(shown).toContain("site");
  });
});

async function startedWorld(_$: Engine, on: On): Promise<World> {
  const world: World = { diffs: new Map<string, string>(), opened: [], outcomes: new Map() };
  mock.clock(on, { now: 1_000 });
  mock.env(on, { HOME });
  on("state.get", (_$, e, next) =>
    e.key === "promptInfo"
      ? { value: { value: { model: "opus", effort: null, cwd: CWD }, version: 1 } }
      : next(e),
  );
  on("classic.SessionStart", () => ({}));
  on("ui.open", (_$, e) => {
    world.opened.push(e.id);
    return { value: { isPlaced: true } };
  });
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("session.cwd", () => ({ value: CWD }));
  const feed = feedSession(on);
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", () => ({ value: true }));
  on("fs.read", (_$, e) => {
    throw new Error(`no such file ${e.path}`);
  });
  on(
    "tool.call",
    (_$, e) =>
      feed.record(
        e,
        world.outcomes.get((e as unknown as { tool_use_id: string }).tool_use_id) ?? {
          result: "ok",
          text: "ok",
        },
      ) as never,
  );
  on("ui.copy", () => ({ value: { isCopied: true } }));
  on("ui.toast", () => ({ value: undefined }));
  on("process.run", (_$, e) => ({ value: gitAnswer(world, [...e.argv]) }) as never);
  return world;
}

function gitAnswer(world: World, argv: string[]) {
  const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: "" });
  const target = argv[argv.indexOf("--") + 1] ?? "";
  if (argv.includes("--abbrev-ref") && argv.includes("--show-toplevel"))
    return ok(`${CWD}\nabc\nmain`);
  if (argv.includes("--abbrev-ref")) return ok("main");
  if (argv.includes("--show-toplevel")) return ok(CWD);
  if (argv.includes("ls-files")) return ok(world.diffs.has(target) ? target : "");
  if (argv.includes("diff")) return ok(world.diffs.get(target) ?? "");
  return ok("");
}

function diffOf(file: string): string {
  return [
    `diff --git a${file} b${file}`,
    `--- a${file}`,
    `+++ b${file}`,
    "@@ -1,1 +1,1 @@",
    "-old-line",
    DIFF_MARK,
  ].join("\n");
}

function mountReply($: Engine, text: string, columns = WIDE): Promise<Reply> {
  return $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "AssistantMessage",
    props: { text, isFirstOfReply: true },
    viewport: { columns, rows: 24 },
  });
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
      bodyColumns: WIDE,
      placement: "dock",
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
    viewport: { columns: WIDE, rows: 40 },
  });
}

async function pressPath(reply: Reply, label: RegExp): Promise<void> {
  const button = await reply.find({ type: "Button", text: label });
  expect(button, `a path button matching ${label}`).toBeDefined();
  await reply.press({ key: button?.key ?? "" });
  await reply.redraw();
}

async function backRow(pane: Pane): Promise<string | undefined> {
  await pane.redraw();
  const row = shownTexts(await pane.drawn()).find((text) => text.startsWith("[ back ] "));
  return row?.slice("[ back ] ".length).replace(/ [+-]\d+ [+-]\d+$/, "");
}

function detailOf(tree: Node): Node {
  const root = collect(tree, "Box").find((box) =>
    childrenOf(box).some((row) => childrenOf(row).some((cell) => cell.props?.key === "back")),
  );
  if (root === undefined) throw new Error("the call detail is not drawn");
  return root;
}

function isNotBack(button: Node): boolean {
  return button.props?.key !== "back";
}

function buttonLabel(button: Node): string {
  return (button.props?.label as string | undefined) ?? textOf(button);
}

function colourOf(tree: Node, word: string): unknown {
  const [leaf] = collect(tree, "Text").filter(
    (node) => textOf(node).includes(word) && collect(node, "Text").length === 1,
  );
  if (leaf === undefined) throw new Error(`no text ${word} is drawn`);
  return leaf.props?.color;
}

async function diffSource(pane: Pane): Promise<string | undefined> {
  const [code] = collect(await pane.drawn(), "Code");
  const source = code?.props?.source;
  return typeof source === "string" ? source : undefined;
}

function hebrewRows(drawn: unknown, columns: number): string[] {
  return screenRows(drawn, columns)
    .map((row) => row.trimEnd())
    .filter((row) => HEBREW_LETTER.test(row));
}
