import { describe, expect, test } from "claude-code/testing";
import { spendTotalsOf } from "../hooks/store-sql";
import type { SpendTotals } from "../types";
import type { TranscriptRaw } from "../hooks/store-sql";

const NOW = new Date(2026, 9, 29, 12, 0, 0).getTime();
const HOME_CONTAINER = "-home-dev";
const MAIN_DIR = "-home-dev-demo-app";
const WORKTREE_DIR = "-home-dev-demo-app-spend-fix";
const MAIN_CWD = "/home/dev/demo-app";
const WORKTREE_CWD = "/home/dev/demo-app-spend-fix";
const PROJECT_NAME = "demo-app";
const OWN_SESSION = "mine";
const OTHER_SESSION = "theirs";
const TODAY = "2026-10-29";
const MAIN_USD = 3;
const WORKTREE_USD = 4;
const IS_OWN = 1;
const IS_NOT_OWN = 0;

type Slice = [dir: string, session: string, day: string, first: number, usd: number, own: number];
type SlicedRaw = TranscriptRaw & { slices: Slice[]; activeHours: number };
type ShownSlice = { project: string; session: string; isOwn: boolean };
type SlicedTotals = SpendTotals & { slices?: ShownSlice[] };

describe("store slices", () => {
  test("SDY4 two transcript dirs of one repo give slices with the same project name as the By project row", () => {
    const raw = rawOf([
      [MAIN_DIR, OWN_SESSION, TODAY, NOW, MAIN_USD, IS_OWN],
      [WORKTREE_DIR, OTHER_SESSION, TODAY, NOW, WORKTREE_USD, IS_NOT_OWN],
    ]);

    const totals: SlicedTotals = spendTotalsOf(raw, [HOME_CONTAINER], NOW);

    expect((totals.slices ?? []).map((slice) => slice.project)).toEqual([
      PROJECT_NAME,
      PROJECT_NAME,
    ]);
    expect((totals.projects ?? []).map((project) => project.name)).toEqual([PROJECT_NAME]);
  });

  test("SDY5 only the indexing session's slices are marked as this session", () => {
    const raw = rawOf([
      [MAIN_DIR, OWN_SESSION, TODAY, NOW, MAIN_USD, IS_OWN],
      [WORKTREE_DIR, OTHER_SESSION, TODAY, NOW, WORKTREE_USD, IS_NOT_OWN],
    ]);

    const totals: SlicedTotals = spendTotalsOf(raw, [HOME_CONTAINER], NOW);

    expect((totals.slices ?? []).map((slice) => [slice.session, slice.isOwn])).toEqual([
      [OWN_SESSION, true],
      [OTHER_SESSION, false],
    ]);
  });
});

function rawOf(slices: Slice[]): SlicedRaw {
  return {
    dirs: [
      [MAIN_DIR, MAIN_USD, MAIN_USD, MAIN_USD, 0, MAIN_USD],
      [WORKTREE_DIR, WORKTREE_USD, WORKTREE_USD, WORKTREE_USD, 0, 0],
    ],
    progress: null,
    isIndexed: true,
    cwds: [
      [MAIN_DIR, MAIN_CWD],
      [WORKTREE_DIR, WORKTREE_CWD],
    ],
    slices,
    activeHours: 1,
  };
}
