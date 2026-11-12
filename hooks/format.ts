export const MS_PER_SECOND = 1000;

const SECONDS_PER_MINUTE = 60;
const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const TOKENS_PER_K = 1000;
const CENT_USD = 0.01;
const CENTS_PER_USD = 100;
const UNDER_CENT_TEXT = `<$${CENT_USD.toFixed(2)}`;
const ESTIMATE_MARK = "~";
const CONTROL_CHARACTERS = /\p{Cc}/gu;
const LINE_BREAK = /\r?\n|\r/;

export function singleLine(text: string): string {
  const [first = ""] = text.split(LINE_BREAK);
  return first.replace(/\t/g, " ").replace(CONTROL_CHARACTERS, "");
}

export function formatSeconds(seconds: number): string {
  if (seconds < SECONDS_PER_MINUTE) return `${seconds}s`;
  return `${Math.floor(seconds / SECONDS_PER_MINUTE)}m ${String(seconds % SECONDS_PER_MINUTE).padStart(2, "0")}s`;
}

export function formatAge(ms: number): string {
  const minutes = Math.floor(ms / MS_PER_MINUTE);
  if (minutes < MINUTES_PER_HOUR) return `${minutes}m`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) return `${hours}h`;
  return `${Math.floor(hours / HOURS_PER_DAY)}d`;
}

export function formatDuration(ms: number): string {
  if (ms < MS_PER_SECOND) return `${Math.round(ms)}ms`;
  return formatSeconds(Math.round(ms / MS_PER_SECOND));
}

export function formatTokens(tokens: number): string {
  if (tokens < TOKENS_PER_K) return String(tokens);
  return `${(tokens / TOKENS_PER_K).toFixed(1).replace(/\.0$/, "")}k`;
}

export function shortModel(model: string): string {
  const [name = "", ...version] = model
    .replace(/^claude-/, "")
    .replace(/-\d{8}$/, "")
    .split("-");
  return version.length > 0 ? `${name} ${version.join(".")}` : name;
}

function isUnderCent(usd: number): boolean {
  return usd > 0 && usd < CENT_USD;
}

export function centsOf(usd: number): number {
  if (isUnderCent(usd)) return 0;
  return Math.round(Number(usd.toFixed(2)) * CENTS_PER_USD);
}

export function dollars(usd: number): string {
  if (isUnderCent(usd)) return UNDER_CENT_TEXT;
  return `$${(centsOf(usd) / CENTS_PER_USD).toFixed(2)}`;
}

export function aboutDollars(usd: number): string {
  if (usd === 0) return dollars(usd);
  if (isUnderCent(usd)) return UNDER_CENT_TEXT;
  return `${ESTIMATE_MARK}${dollars(usd)}`;
}

export function clockOf(at: number): string {
  const time = new Date(at);
  const pad = (part: number): string => String(part).padStart(2, "0");
  return `${pad(time.getHours())}:${pad(time.getMinutes())}`;
}
