import { describe, expect, test } from "claude-code/testing";
import { clipPathStart } from "../hooks/paths";
import { displayWidth } from "../hooks/text-width";

describe("path clip", () => {
  test("Z2 a path too long for its room keeps its trailing folders after an ellipsis and cuts at a slash", () => {
    expect(clipPathStart("/home/dev/demo-app-agents-detail/hooks/activity-calls.ts", 30)).toBe(
      "…/hooks/activity-calls.ts",
    );
  });

  test("Z2 a file name too long to fit alone keeps its own tail", () => {
    const clipped = clipPathStart("/work/a-file-name-that-is-very-long.ts", 12);
    expect(clipped.endsWith("long.ts")).toBe(true);
    expect(displayWidth(clipped)).toBeLessThanOrEqual(12);
  });
});
