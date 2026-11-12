import { headingLineOf } from "./clear-world";
import type { Line } from "./skills-tree";

const HEADINGS = ["Stuck", "Failed", "Permissions", "Tool mix", "Timeline"];

export function blockOf(shown: Line[], title: string): Line[] {
  const heading = headingLineOf(shown, title);
  if (heading === undefined) return [];
  const after = shown.slice(shown.indexOf(heading) + 1);
  const end = after.findIndex((line) =>
    HEADINGS.some((other) => headingLineOf([line], other) !== undefined),
  );
  return end === -1 ? after : after.slice(0, end);
}

export function textsIn(block: Line[]): string[] {
  return block.map((line) => line.text).filter((text) => text !== "");
}
