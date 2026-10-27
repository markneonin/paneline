import { atom, read, update } from "claude-code";
import type { EngineInterface, On } from "claude-code";

const themeAtom = atom({ plugin: "paneline", key: "theme" } as const, "dark");

const THEME_ROW = "theme";
const THEME_WRITE_READS = 40;

export function trackTheme(on: On): void {
  on("session.start", { isInteractive: true }, async ($, e, next) => {
    await storeTheme($, await currentTheme($));
    return next(e);
  });

  on("config.set", { key: THEME_ROW }, async ($, e, next) => {
    await storeTheme($, String(e.value));
    return next(e);
  });

  on("classic.ConfigChange", async ($, e, next) => {
    await storeTheme($, await currentTheme($));
    return next(e);
  });

  on("command.run", { command: THEME_ROW }, async ($, e, next) => {
    const before = await read($, themeAtom);
    const result = await next(e);
    await followPickedTheme($, before);
    return result;
  });
}

async function followPickedTheme($: EngineInterface, before: string): Promise<void> {
  for (let reads = 0; reads < THEME_WRITE_READS; reads++) {
    const theme = await currentTheme($);
    if (theme === before) continue;
    await storeTheme($, theme);
    return;
  }
}

async function currentTheme($: EngineInterface): Promise<string> {
  const rows = await $.config.list();
  return String(rows.find((row) => row.key === THEME_ROW)?.value ?? "dark");
}

async function storeTheme($: EngineInterface, theme: string): Promise<void> {
  if (theme === (await read($, themeAtom))) return;
  await update($, themeAtom, () => theme);
}
