import { describe, expect, test } from "claude-code/testing";
import { wrapRuns } from "../hooks/text-width";

const WRAP = { isLongWordContinuing: true, isBreakingAfterSlash: true } as const;
const LONE_SLASH_AT_ROW_END = /(^|\s)\/$/;

function rowsOf(text: string, width: number): string[] {
  return wrapRuns([{ text, style: "plain" }], width, WRAP).map((row) =>
    row
      .map((piece) => piece.text)
      .join("")
      .trimEnd(),
  );
}

describe("text width", () => {
  test("F3 a path token wider than the row never leaves a lone slash at a row end, and still breaks after each folder slash", () => {
    const leadingSlashRows = rowsOf("xxxxxxxx /abcdef/ghijklmnopqrstu/z", 10);
    expect(leadingSlashRows.some((row) => LONE_SLASH_AT_ROW_END.test(row))).toBe(false);
    expect(rowsOf("aaaa/bbbb/cccc/dddd/eeee", 10)).toEqual(["aaaa/bbbb/", "cccc/dddd/", "eeee"]);
  });
});
