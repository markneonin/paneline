import { atom, read, update } from "claude-code";
import type { On } from "claude-code";

import { countUse, storedUses } from "./store-queue";

const launchFolderAtom = atom({ plugin: "paneline", key: "launchFolder" } as const, "");
const skillUsesAtom = atom(
  { plugin: "paneline", key: "skillUses" } as const,
  {} as Record<string, number>,
);

export function trackSkills(on: On): void {
  on("session.start", { isInteractive: true }, async ($, e, next) => {
    const known = await read($, launchFolderAtom);
    const folder = known === "" ? e.cwd : known;
    await update($, launchFolderAtom, () => folder);
    const uses = await storedUses($, "skill", folder);
    await update($, skillUsesAtom, () => uses);
    return next(e);
  });

  on("skill.prompt", async ($, e, next) => {
    const prompt = await next(e);
    const folder = await read($, launchFolderAtom);
    if (folder === "") return prompt;
    countUse($, "skill", folder, e.skill);
    await update($, skillUsesAtom, (counts) => ({
      ...counts,
      [e.skill]: (counts[e.skill] ?? 0) + 1,
    }));
    return prompt;
  });
}
