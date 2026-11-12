import { THEMES } from "./theme-rgb";

export type Rgb = readonly number[];
export type ThemeName = keyof typeof THEMES;

export const ANSI_FILLS: Record<string, readonly Rgb[]> = {
  "light-ansi": [
    [191, 191, 191],
    [229, 229, 229],
  ],
  "dark-ansi": [
    [102, 102, 102],
    [127, 127, 127],
  ],
};

const CUBE_START = 16;
const CUBE_SIDE = 6;
const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];
const GREY_START = 232;
const GREY_BASE = 8;
const GREY_STEP = 10;
const ANSI256 = /^ansi256\((\d+)\)$/;

const XTERM_PALETTE: Record<number, Rgb> = {
  1: [205, 0, 0],
  2: [0, 205, 0],
  3: [205, 205, 0],
  4: [0, 0, 238],
  5: [205, 0, 205],
  6: [0, 205, 205],
  12: [92, 92, 255],
  13: [255, 0, 255],
};

export function xtermRgbOfColour(colour: string): Rgb {
  const index = Number(ANSI256.exec(colour)?.[1]);
  return XTERM_PALETTE[index] ?? [0, 0, 0];
}

export function rgbOfColour(theme: ThemeName, colour: string): Rgb {
  const match = ANSI256.exec(colour);
  if (match === null) return (THEMES[theme] as Record<string, Rgb>)[colour] ?? [0, 0, 0];
  const index = Number(match[1]);
  if (index >= GREY_START) {
    const grey = GREY_BASE + GREY_STEP * (index - GREY_START);
    return [grey, grey, grey];
  }
  const cube = index - CUBE_START;
  const level = (step: number): number => CUBE_LEVELS[Math.floor(cube / step) % CUBE_SIDE] ?? 0;
  return [level(CUBE_SIDE ** 2), level(CUBE_SIDE), level(1)];
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

export function luminance(rgb: Rgb): number {
  const [r = 0, g = 0, b = 0] = rgb.map((channel) => {
    const unit = channel / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const D65 = [0.95047, 1, 1.08883] as const;
const LAB_EPSILON = 216 / 24389;
const LAB_KAPPA = 24389 / 27;

function labOf(rgb: Rgb): readonly [number, number, number] {
  const [r = 0, g = 0, b = 0] = rgb.map((channel) => {
    const unit = channel / 255;
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  const xyz = [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    0.0193339 * r + 0.119192 * g + 0.9503041 * b,
  ];
  const [fx = 0, fy = 0, fz = 0] = xyz.map((value, i) => {
    const ratio = value / (D65[i] ?? 1);
    return ratio > LAB_EPSILON ? Math.cbrt(ratio) : (LAB_KAPPA * ratio + 16) / 116;
  });
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const degrees = (radians: number): number => ((radians * 180) / Math.PI + 360) % 360;
const radians = (deg: number): number => (deg * Math.PI) / 180;

export function deltaE2000(a: Rgb, b: Rgb): number {
  const [l1, a1, b1] = labOf(a);
  const [l2, a2, b2] = labOf(b);
  const meanC = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(meanC ** 7 / (meanC ** 7 + 25 ** 7)));
  const ap1 = a1 * (1 + g);
  const ap2 = a2 * (1 + g);
  const c1 = Math.hypot(ap1, b1);
  const c2 = Math.hypot(ap2, b2);
  const h1 = c1 === 0 ? 0 : degrees(Math.atan2(b1, ap1));
  const h2 = c2 === 0 ? 0 : degrees(Math.atan2(b2, ap2));
  const dL = l2 - l1;
  const dC = c2 - c1;
  let dh = h2 - h1;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  const dH = c1 * c2 === 0 ? 0 : 2 * Math.sqrt(c1 * c2) * Math.sin(radians(dh / 2));
  const meanL = (l1 + l2) / 2;
  const meanCp = (c1 + c2) / 2;
  let meanH = h1 + h2;
  if (c1 * c2 !== 0) {
    if (Math.abs(h1 - h2) > 180) meanH += h1 + h2 < 360 ? 360 : -360;
    meanH /= 2;
  }
  const t =
    1 -
    0.17 * Math.cos(radians(meanH - 30)) +
    0.24 * Math.cos(radians(2 * meanH)) +
    0.32 * Math.cos(radians(3 * meanH + 6)) -
    0.2 * Math.cos(radians(4 * meanH - 63));
  const sl = 1 + (0.015 * (meanL - 50) ** 2) / Math.sqrt(20 + (meanL - 50) ** 2);
  const sc = 1 + 0.045 * meanCp;
  const sh = 1 + 0.015 * meanCp * t;
  const rc = 2 * Math.sqrt(meanCp ** 7 / (meanCp ** 7 + 25 ** 7));
  const rt = -Math.sin(radians(60 * Math.exp(-(((meanH - 275) / 25) ** 2)))) * rc;
  return Math.sqrt((dL / sl) ** 2 + (dC / sc) ** 2 + (dH / sh) ** 2 + rt * (dC / sc) * (dH / sh));
}
