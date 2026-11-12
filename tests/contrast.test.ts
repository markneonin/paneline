import { describe, expect, test } from "claude-code/testing";

import { deltaE2000 } from "./contrast";

const HUNDREDTHS = 100;

const hundredths = (value: number): number => Math.round(value * HUNDREDTHS) / HUNDREDTHS;

describe("colour distance helper", () => {
  test("CD1 deltaE2000 reproduces the reference distances", () => {
    expect(hundredths(deltaE2000([136, 136, 136], [153, 153, 153]))).toBe(5.74);
    expect(hundredths(deltaE2000([177, 185, 249], [130, 125, 189]))).toBe(17.83);
    expect(hundredths(deltaE2000([255, 0, 0], [0, 0, 255]))).toBe(52.88);
    expect(hundredths(deltaE2000([0, 0, 0], [255, 255, 255]))).toBe(100);
  });
});
