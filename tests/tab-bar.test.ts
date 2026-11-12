import { describe, expect, test } from "claude-code/testing";

import { fitTabs } from "../hooks/tab-bar";

const LABELS = ["Activity", "Files", "Agents", "Context"];
const ALL_WIDTH = 29;

describe("fitTabs", () => {
  test("T1 when every tab fits the window is all of them and there are no arrows", () => {
    expect(fitTabs(LABELS, 0, ALL_WIDTH)).toEqual({
      first: 0,
      last: 3,
      hasLeft: false,
      hasRight: false,
    });
    expect(fitTabs(LABELS, 3, 100)).toEqual({ first: 0, last: 3, hasLeft: false, hasRight: false });
  });

  test("T2 with the first tab active the right tabs are hidden and a right arrow shows", () => {
    expect(fitTabs(LABELS, 0, 20)).toEqual({ first: 0, last: 1, hasLeft: false, hasRight: true });
  });

  test("T3 with the last tab active the left tabs are hidden and a left arrow shows", () => {
    expect(fitTabs(LABELS, 3, 20)).toEqual({ first: 2, last: 3, hasLeft: true, hasRight: false });
  });

  test("T4 a middle tab shows the page that holds it, not a window centred on it", () => {
    expect(fitTabs(LABELS, 1, 17)).toEqual({ first: 0, last: 1, hasLeft: false, hasRight: true });
  });

  test("T6 a page with tabs on both sides shows both arrows", () => {
    expect(fitTabs(LABELS, 1, 12)).toEqual({ first: 1, last: 1, hasLeft: true, hasRight: true });
  });

  test("T5 the active tab stays visible even when nothing else fits", () => {
    expect(fitTabs(LABELS, 1, 3)).toEqual({ first: 1, last: 1, hasLeft: true, hasRight: true });
  });

  test("T7 a page never overflows because the count in an arrow takes room too", () => {
    expect(fitTabs(LABELS, 0, 16)).toEqual({ first: 0, last: 0, hasLeft: false, hasRight: true });
  });
});
