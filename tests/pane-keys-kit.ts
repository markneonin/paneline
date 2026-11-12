import type { Engine, Mounted } from "claude-code/testing";

import { linesOf } from "./skills-tree";

const PANE_ROWS = 40;
const FAR_CONTENT_ROWS = 400;

export async function scrollListBy($: Engine, pane: Mounted<"terminal", "Pane">, by: number) {
  await $.ui.scroll({
    component: "Pane",
    requestId: "session",
    offset: 0,
    by,
    bodyRows: PANE_ROWS,
    contentRows: FAR_CONTENT_ROWS,
    origin: { kind: "person" },
  });
  await pane.redraw();
}

export async function rowsOf(pane: Mounted<"terminal", "Pane">): Promise<string[]> {
  return linesOf(await pane.drawn()).map((line) => line.text);
}
