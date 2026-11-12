import type { On } from "claude-code";

import type { SpendTotals } from "../../types";
import { worldOf, SUBSCRIPTION } from "../spend-world";
import type { World as SpendWorld } from "../spend-world";
import { diskOf } from "./transcript-disk";
import type { Disk } from "./transcript-disk";
import { transcriptSqlite } from "./transcript-sqlite";

export type DiskWorld = SpendWorld & { disk: Disk; totalsWritten: SpendTotals[] };

export const OWN_SESSION = "own-sess";
export const OWN_DIR = "-h-u-alpha";
export const WORK_CWD = "/h/u/alpha";

const COMMAND_OK = {
  exitCode: 0,
  isStdoutTruncated: false,
  isStderrTruncated: false,
  stderr: "",
};

export function diskWorldOf(on: On): DiskWorld {
  const disk = diskOf("/h/u/.claude");
  const { answer } = transcriptSqlite();
  on("process.run", { argv: /sqlite3/ }, (_$, e) => ({
    value: { ...COMMAND_OK, stdout: answer(e.init?.stdin ?? "") },
  }));
  on("process.run", { argv: /rev-parse/ }, () => ({ value: { ...COMMAND_OK, stdout: "" } }));
  on("process.spawn", async function* (_$, e) {
    return { value: yield* disk.run({ argv: e.argv }) };
  });
  on("ui.log", () => ({ value: undefined }));
  on("state.set", { key: "spendTotals" }, (_$, e, next) => {
    world.totalsWritten.push(structuredClone(e.value as SpendTotals));
    return next(e);
  });
  const base = worldOf(on, SUBSCRIPTION);
  base.session = OWN_SESSION;
  const world: DiskWorld = Object.assign(base, { disk, totalsWritten: [] });
  return world;
}
