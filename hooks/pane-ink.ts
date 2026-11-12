import { palette } from "./palette";
import { ENGINE_DEFAULT_GREY } from "./session-color";
import type { ToolKind } from "./tools";

export type PaneInk = {
  fill: string | undefined;
  tabFill: string;
  tabText: string;
  text: string | undefined;
  rule: string;
  meterEmpty: string;
  section: string;
  muted: string;
  tool: string | undefined;
  ok: string;
  failed: string;
  alert: string;
  mix: Record<ToolKind, string>;
  hues: readonly string[];
  isRecoloured: boolean;
};

const themeInk: PaneInk = {
  fill: undefined,
  tabFill: ENGINE_DEFAULT_GREY,
  tabText: "clawd_background",
  text: palette.text,
  rule: palette.rule,
  meterEmpty: palette.meterEmpty,
  section: palette.section,
  muted: palette.muted,
  tool: palette.tool,
  ok: palette.ok,
  failed: palette.failed,
  alert: palette.alert,
  mix: {
    Read: palette.tool,
    Edit: palette.ok,
    Bash: palette.alert,
    Search: palette.keyword,
    Web: palette.button,
    Agent: palette.user,
    Other: palette.muted,
  },
  hues: [palette.tool, palette.ok, palette.alert, palette.keyword, palette.button, palette.user],
  isRecoloured: false,
};

const lightHues = [
  "ansi256(19)",
  "ansi256(22)",
  "ansi256(130)",
  "ansi256(100)",
  "ansi256(30)",
  "ansi256(134)",
  "ansi256(161)",
  "ansi256(25)",
];

const lightInk: PaneInk = {
  fill: undefined,
  tabFill: ENGINE_DEFAULT_GREY,
  tabText: "clawd_background",
  text: palette.text,
  rule: palette.rule,
  meterEmpty: "ansi256(244)",
  section: palette.section,
  muted: palette.muted,
  tool: palette.text,
  ok: "ansi256(22)",
  failed: "ansi256(124)",
  alert: "ansi256(94)",
  mix: {
    Read: "ansi256(19)",
    Edit: "ansi256(22)",
    Bash: "ansi256(130)",
    Search: "ansi256(97)",
    Web: "ansi256(30)",
    Agent: "ansi256(89)",
    Other: palette.muted,
  },
  hues: lightHues,
  isRecoloured: true,
};

const lightAnsiHues = [
  "ansi256(17)",
  "ansi256(22)",
  "ansi256(94)",
  "ansi256(93)",
  "ansi256(23)",
  "ansi256(52)",
  "ansi256(125)",
  "ansi256(25)",
];

const lightAnsiInk: PaneInk = {
  fill: undefined,
  tabFill: "clawd_background",
  tabText: "promptBorder",
  text: palette.text,
  rule: palette.rule,
  meterEmpty: palette.meterEmpty,
  section: palette.section,
  muted: palette.text,
  tool: palette.text,
  ok: "ansi256(22)",
  failed: "ansi256(88)",
  alert: "ansi256(94)",
  mix: {
    Read: "ansi256(19)",
    Edit: "ansi256(22)",
    Bash: "ansi256(94)",
    Search: "ansi256(126)",
    Web: "ansi256(23)",
    Agent: "ansi256(52)",
    Other: palette.text,
  },
  hues: lightAnsiHues,
  isRecoloured: true,
};

const darkAnsiHues = [
  "ansi256(17)",
  "ansi256(49)",
  "ansi256(51)",
  "ansi256(82)",
  "ansi256(193)",
  "ansi256(195)",
  "ansi256(225)",
  "ansi256(226)",
];

const darkAnsiInk: PaneInk = {
  fill: undefined,
  tabFill: ENGINE_DEFAULT_GREY,
  tabText: "clawd_background",
  text: palette.text,
  rule: palette.rule,
  meterEmpty: palette.meterEmpty,
  section: palette.section,
  muted: "ansi256(251)",
  tool: palette.text,
  ok: "ansi256(157)",
  failed: "ansi256(224)",
  alert: "ansi256(227)",
  mix: {
    Read: "ansi256(159)",
    Edit: "ansi256(157)",
    Bash: "ansi256(226)",
    Search: "ansi256(224)",
    Web: "ansi256(118)",
    Agent: "ansi256(225)",
    Other: palette.text,
  },
  hues: darkAnsiHues,
  isRecoloured: true,
};

const TERMINAL_RED = "ansi256(1)";
const TERMINAL_GREEN = "ansi256(2)";
const TERMINAL_YELLOW = "ansi256(3)";
const TERMINAL_BLUE = "ansi256(4)";
const TERMINAL_MAGENTA = "ansi256(5)";
const TERMINAL_CYAN = "ansi256(6)";
const TERMINAL_GREY = "ansi256(8)";
const TERMINAL_BRIGHT_BLUE = "ansi256(12)";
const TERMINAL_BRIGHT_MAGENTA = "ansi256(13)";

const autoInk: PaneInk = {
  fill: undefined,
  tabFill: ENGINE_DEFAULT_GREY,
  tabText: "clawd_background",
  text: undefined,
  rule: TERMINAL_GREY,
  meterEmpty: TERMINAL_GREY,
  section: TERMINAL_BLUE,
  muted: TERMINAL_GREY,
  tool: undefined,
  ok: TERMINAL_GREEN,
  failed: TERMINAL_RED,
  alert: TERMINAL_YELLOW,
  mix: {
    Read: TERMINAL_BLUE,
    Edit: TERMINAL_GREEN,
    Bash: TERMINAL_YELLOW,
    Search: TERMINAL_MAGENTA,
    Web: TERMINAL_CYAN,
    Agent: TERMINAL_RED,
    Other: TERMINAL_GREY,
  },
  hues: [
    TERMINAL_BLUE,
    TERMINAL_GREEN,
    TERMINAL_YELLOW,
    TERMINAL_MAGENTA,
    TERMINAL_CYAN,
    TERMINAL_RED,
    TERMINAL_BRIGHT_BLUE,
    TERMINAL_BRIGHT_MAGENTA,
  ],
  isRecoloured: true,
};

let current = themeInk;

export function inkFor(theme: string): PaneInk {
  if (theme === "auto") return autoInk;
  if (theme === "light-ansi") return lightAnsiInk;
  if (theme === "dark-ansi") return darkAnsiInk;
  if (theme.startsWith("light")) return lightInk;
  return themeInk;
}

export function notePaneTheme(theme: string): void {
  current = inkFor(theme);
}

export function paneInk(): PaneInk {
  return current;
}
