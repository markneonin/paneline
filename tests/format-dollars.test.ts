import { describe, expect, test } from "claude-code/testing";

import * as format from "../hooks/format";

const ESTIMATES = [0, 0.004, 0.005, 0.0965, 12.5, 5475.47];
const ESTIMATE_TEXTS = ["$0.00", "<$0.01", "<$0.01", "~$0.10", "~$12.50", "~$5475.47"];

describe("dollars", () => {
  test("D1 a cost of exactly zero reads $0.00", () => {
    expect(format.dollars(0)).toBe("$0.00");
  });

  test("D2 a real cost of 0.4 cents reads <$0.01, not $0.00", () => {
    expect(format.dollars(0.004)).toBe("<$0.01");
  });

  test("D3 a real cost of 0.5 cents reads <$0.01, not $0.01", () => {
    expect(format.dollars(0.005)).toBe("<$0.01");
  });

  test("D4 a cost of exactly one cent reads $0.01", () => {
    expect(format.dollars(0.01)).toBe("$0.01");
  });

  test("D5 a cost of 1.234 reads $1.23", () => {
    expect(format.dollars(1.234)).toBe("$1.23");
  });

  test("D6 an estimate reads with a tilde and its dollars, except zero, which reads $0.00, and an estimate under one cent, which reads <$0.01, both with no tilde", () => {
    expect(ESTIMATES.map((usd) => format.aboutDollars(usd))).toEqual(ESTIMATE_TEXTS);
  });
});
