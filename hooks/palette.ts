type ThemeKey =
  | "text"
  | "inactive"
  | "subtle"
  | "permission"
  | "background"
  | "briefLabelYou"
  | "merged"
  | "success"
  | "error"
  | "warning"
  | "claude"
  | "planMode"
  | "userMessageBackground"
  | "composerSidebarBackground"
  | "diffAdded"
  | "diffRemoved";

export const palette = {
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
} as const satisfies Record<string, ThemeKey>;

export const categoryColors = [
  "permission",
  "success",
  "warning",
  "merged",
  "background",
  "error",
  "claude",
  "planMode",
] as const satisfies readonly ThemeKey[];

export type Fills = {
  source: string;
  userBand: string;
  panel: string;
  addedBand: string;
  removedBand: string;
  user: string;
  ok: string;
  failed: string;
  alert: string;
  keyword: string;
  identifier: string;
  code: string;
  hues: readonly string[];
  prose: string | undefined;
  onBand: string | undefined;
  defaultAccent?: string;
};

export const themeFills: Fills = {
  source: "theme",
  userBand: palette.userBand,
  panel: palette.panel,
  addedBand: palette.addedBand,
  removedBand: palette.removedBand,
  user: palette.user,
  ok: palette.ok,
  failed: palette.failed,
  alert: palette.alert,
  keyword: palette.keyword,
  identifier: palette.identifier,
  code: palette.button,
  hues: categoryColors,
  prose: palette.text,
  onBand: undefined,
};

const plainFills: Fills = { ...themeFills, source: "plain", prose: undefined };

const BAND_TEXT = "ansi256(0)";

const ansiFills: Fills = { ...plainFills, source: "ansi", onBand: BAND_TEXT };

const lightAnsiFills: Fills = {
  ...ansiFills,
  source: "light-ansi",
  defaultAccent: "clawd_background",
};

export function fillsFor(theme: string): Fills {
  if (theme === "light-ansi") return lightAnsiFills;
  if (theme.endsWith("-ansi")) return ansiFills;
  return theme.startsWith("light") ? plainFills : themeFills;
}
