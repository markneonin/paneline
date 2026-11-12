import { describe, expect, test } from "claude-code/testing";

import * as panel from "../hooks/diff-panel";
import * as review from "../hooks/review-git";
import type { ReviewFile } from "../hooks/review-git";
import {
  APPLY_FAILURE,
  HEAD_SHA,
  INNER_DIR,
  MERGE_BASE_SHA,
  OLD_BASE_SHA,
  SUBMODULE_DIR,
  TOP,
  movedSubmoduleRepoOf,
  nestedRepoOf,
  nestedRepoWithoutMainOf,
  numbered,
  repoAt,
  repoOf,
  treeOf,
} from "./review-world";

type SessionFile = { target: string; base: string };

const BIG_HUNK_CHARS = 60_000;
const CHAR_LIMIT = 100_000;
const FILE_LINES = 20;
const FIRST_EDIT_LINE = 3;
const SECOND_EDIT_LINE = 18;
const OUTSIDE_FILE = "/elsewhere/x.ts";

describe("review model", () => {
  test("V1 this session lists only the files the session edited, with status and counts", async () => {
    const repo = repoOf();
    repo.trees.HEAD = treeOf({ "a.ts": "one\ntwo\n", "b.ts": "same\n", "c.ts": "same\n" });
    repo.work = treeOf({ "a.ts": "one\nTWO\nthree\n", "b.ts": "same\n", "c.ts": "other\n" });

    const result = await review.reviewFiles(repo.$, "session", [sessionFile("a.ts")]);

    expect(rowsOf(result)).toEqual(["modified a.ts +2 -1"]);
  });

  test("V2 this session does not list a file edited outside the repo", async () => {
    const repo = repoOf();
    repo.trees.HEAD = treeOf({ "a.ts": "one\n" });
    repo.work = treeOf({ "a.ts": "two\n" });

    const result = await review.reviewFiles(repo.$, "session", [
      sessionFile("a.ts"),
      { target: OUTSIDE_FILE, base: "HEAD" },
    ]);

    expect(rowsOf(result)).toEqual(["modified a.ts +1 -1"]);
  });

  test("V3 this session does not list a file put back to its original content", async () => {
    const repo = repoOf();
    repo.trees.HEAD = treeOf({ "a.ts": "one\n", "b.ts": "one\n" });
    repo.work = treeOf({ "a.ts": "one\n", "b.ts": "two\n" });

    const result = await review.reviewFiles(repo.$, "session", [
      sessionFile("a.ts"),
      sessionFile("b.ts"),
    ]);

    expect(rowsOf(result)).toEqual(["modified b.ts +1 -1"]);
  });

  test("V4 this session shows a file the session deleted as deleted", async () => {
    const repo = repoOf();
    repo.trees.HEAD = treeOf({ "gone.ts": "one\ntwo\n" });
    repo.work = treeOf({});

    const result = await review.reviewFiles(repo.$, "session", [sessionFile("gone.ts")]);

    expect(rowsOf(result)).toEqual(["deleted gone.ts +0 -2"]);
  });

  test("V5 this session diffs a file from the commit it had when the session first changed it", async () => {
    const repo = repoOf();
    repo.trees.HEAD = treeOf({ "a.ts": "one\ntwo\nthree\n" });
    repo.trees[OLD_BASE_SHA] = treeOf({ "a.ts": "one\n" });
    repo.work = treeOf({ "a.ts": "one\ntwo\nthree\n" });

    const result = await review.reviewFiles(repo.$, "session", [
      { target: `${TOP}/a.ts`, base: OLD_BASE_SHA },
    ]);

    expect(rowsOf(result)).toEqual(["modified a.ts +2 -0"]);
    expect(fileOf(result, "a.ts").base).toBe(OLD_BASE_SHA);
  });

  test("V6 uncommitted lists every changed file and every untracked file as added", async () => {
    const repo = repoOf();
    repo.trees.HEAD = treeOf({ "a.ts": "one\n", "b.ts": "same\n", "old.ts": "x\ny\n" });
    repo.work = treeOf({ "a.ts": "two\n", "b.ts": "same\n", "new.ts": "p\nq\nr\n" });
    repo.untracked.add("new.ts");

    const result = await review.reviewFiles(repo.$, "uncommitted", []);

    expect(rowsOf(result)).toEqual([
      "modified a.ts +1 -1",
      "added new.ts +3 -0",
      "deleted old.ts +0 -2",
    ]);
  });

  test("V7 uncommitted on a clean repo lists no files", async () => {
    const repo = repoOf();
    repo.trees.HEAD = treeOf({ "a.ts": "one\n" });
    repo.work = treeOf({ "a.ts": "one\n" });

    const result = await review.reviewFiles(repo.$, "uncommitted", []);

    expect(result).toEqual({ top: TOP, files: [] });
  });

  test("V8 versus main lists what differs from the merge point, committed or not, and skips what only main changed", async () => {
    const repo = repoOf({ mergeBases: { main: MERGE_BASE_SHA } });
    repo.trees.HEAD = treeOf({
      "kept.ts": "one\n",
      "committed.ts": "branch\n",
      "main-only.ts": "m1\n",
    });
    repo.trees[MERGE_BASE_SHA] = treeOf({
      "kept.ts": "one\n",
      "committed.ts": "base\n",
      "main-only.ts": "m1\n",
    });
    repo.work = treeOf({
      "kept.ts": "one\n",
      "committed.ts": "branch\n",
      "main-only.ts": "m1\n",
      "new.ts": "n\n",
    });
    repo.untracked.add("new.ts");

    const result = await review.reviewFiles(repo.$, "main", []);

    expect(rowsOf(result)).toEqual(["modified committed.ts +1 -1", "added new.ts +1 -0"]);
    expect(fileOf(result, "committed.ts").base).toBe(MERGE_BASE_SHA);
  });

  test("V9 versus main compares with the default branch of origin when there is one", async () => {
    const repo = repoOf({
      originHead: "trunk",
      mergeBases: { "origin/trunk": MERGE_BASE_SHA, main: HEAD_SHA },
    });
    repo.trees.HEAD = treeOf({ "a.ts": "two\n" });
    repo.trees[MERGE_BASE_SHA] = treeOf({ "a.ts": "one\n" });
    repo.work = treeOf({ "a.ts": "two\n" });

    const result = await review.reviewFiles(repo.$, "main", []);

    expect(rowsOf(result)).toEqual(["modified a.ts +1 -1"]);
  });

  test("V10 versus main falls back to the local main branch", async () => {
    const repo = repoOf({ mergeBases: { main: MERGE_BASE_SHA, master: HEAD_SHA } });
    repo.trees.HEAD = treeOf({ "a.ts": "two\n" });
    repo.trees[MERGE_BASE_SHA] = treeOf({ "a.ts": "one\n" });
    repo.work = treeOf({ "a.ts": "two\n" });

    const result = await review.reviewFiles(repo.$, "main", []);

    expect(rowsOf(result)).toEqual(["modified a.ts +1 -1"]);
  });

  test("V11 versus main falls back to master when the repo has no main", async () => {
    const repo = repoOf({ mergeBases: { master: MERGE_BASE_SHA } });
    repo.trees.HEAD = treeOf({ "a.ts": "two\n" });
    repo.trees[MERGE_BASE_SHA] = treeOf({ "a.ts": "one\n" });
    repo.work = treeOf({ "a.ts": "two\n" });

    const result = await review.reviewFiles(repo.$, "main", []);

    expect(rowsOf(result)).toEqual(["modified a.ts +1 -1"]);
  });

  test("V12 versus main with no main branch says there is no main branch", async () => {
    const repo = repoOf({ mergeBases: {} });

    const result = await review.reviewFiles(repo.$, "main", []);

    expect(result).toEqual({ reason: "no main branch" });
  });

  test("V13 outside a git repo the review says it is not a git repo", async () => {
    const repo = repoOf({ top: null });

    const result = await review.reviewFiles(repo.$, "uncommitted", []);

    expect(result).toEqual({ reason: "not a git repo" });
  });

  test("V14 a renamed file shows as the old file deleted and the new file added", async () => {
    const repo = repoOf();
    repo.trees.HEAD = treeOf({ "old.ts": "one\ntwo\n" });
    repo.work = treeOf({ "new.ts": "one\ntwo\n" });

    const result = await review.reviewFiles(repo.$, "uncommitted", []);

    expect(rowsOf(result)).toEqual(["added new.ts +2 -0", "deleted old.ts +0 -2"]);
  });

  test("V15 a binary file is listed as binary with no line counts", async () => {
    const repo = repoOf();
    repo.trees.HEAD = treeOf({ "logo.png": "old-bytes" });
    repo.work = treeOf({ "logo.png": "new-bytes" });
    repo.binary.add("logo.png");

    const result = await review.reviewFiles(repo.$, "uncommitted", []);

    const file = fileOf(result, "logo.png");
    expect([file.isBinary, file.added, file.removed]).toEqual([true, 0, 0]);
  });

  test("V16 a file diff shows each changed place as a hunk with its lines as git draws them", async () => {
    const repo = repoOf();
    repo.trees.HEAD = treeOf({ "a.txt": numbered(FILE_LINES) });
    repo.work = treeOf({
      "a.txt": numbered(FILE_LINES, {
        [FIRST_EDIT_LINE]: "changed 3",
        [SECOND_EDIT_LINE]: "changed 18",
      }),
    });
    const file = fileOf(await review.reviewFiles(repo.$, "uncommitted", []), "a.txt");

    const hunks = await review.fileDiff(repo.$, "uncommitted", file);

    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toEqual({
      oldStart: 1,
      oldLines: 6,
      newStart: 1,
      newLines: 6,
      lines: [" line 1", " line 2", "-line 3", "+changed 3", " line 4", " line 5", " line 6"],
    });
    expect(hunks[1]?.lines).toContain("+changed 18");
  });

  test("V17 a file diff keeps the no-newline-at-end-of-file line", async () => {
    const repo = repoOf();
    repo.trees.HEAD = treeOf({ "a.txt": "a\nb" });
    repo.work = treeOf({ "a.txt": "a\nB" });
    const file = fileOf(await review.reviewFiles(repo.$, "uncommitted", []), "a.txt");

    const hunks = await review.fileDiff(repo.$, "uncommitted", file);

    expect(hunks[0]?.lines).toEqual([
      " a",
      "-b",
      "\\ No newline at end of file",
      "+B",
      "\\ No newline at end of file",
    ]);
  });

  test("V18 an untracked file shows as added with its whole content", async () => {
    const repo = repoOf();
    repo.work = treeOf({ "new.ts": "p\nq\nr\n" });
    repo.untracked.add("new.ts");
    const file = fileOf(await review.reviewFiles(repo.$, "uncommitted", []), "new.ts");

    const hunks = await review.fileDiff(repo.$, "uncommitted", file);

    expect(hunks).toEqual([
      { oldStart: 0, oldLines: 0, newStart: 1, newLines: 3, lines: ["+p", "+q", "+r"] },
    ]);
  });

  test("V19 a diff over the size limit ends at a whole hunk, never in the middle of one", () => {
    const text = [bigHunk("one"), bigHunk("two")].join("\n");

    const kept = panel.wholeHunks(text);

    expect(kept).toBe(bigHunk("one"));
    expect(text.length).toBeGreaterThan(CHAR_LIMIT);
  });

  test("V20 reverting one hunk removes only that hunk from the file", async () => {
    const { repo, hunks, file } = await drawnTwoHunks();

    const error = await review.revertHunk(repo.$, TOP, file, hunks[1]!);

    expect(error).toBeNull();
    expect(repo.work.get("a.txt")).toBe(numbered(FILE_LINES, { [FIRST_EDIT_LINE]: "changed 3" }));
  });

  test("V21 reverting a hunk still works after lines were added above it since it was drawn", async () => {
    const { repo, hunks, file } = await drawnTwoHunks();
    repo.work.set("a.txt", `top 1\ntop 2\n${repo.work.get("a.txt")}`);

    const error = await review.revertHunk(repo.$, TOP, file, hunks[1]!);

    expect(error).toBeNull();
    expect(repo.work.get("a.txt")).toBe(
      `top 1\ntop 2\n${numbered(FILE_LINES, { [FIRST_EDIT_LINE]: "changed 3" })}`,
    );
  });

  test("V22 reverting a hunk that changed since it was drawn returns git's error and leaves the file as it is", async () => {
    const { repo, hunks, file } = await drawnTwoHunks();
    const edited = numbered(FILE_LINES, {
      [FIRST_EDIT_LINE]: "changed 3",
      [SECOND_EDIT_LINE]: "edited again",
    });
    repo.work.set("a.txt", edited);

    const error = await review.revertHunk(repo.$, TOP, file, hunks[1]!);

    expect(error).toContain(APPLY_FAILURE);
    expect(repo.work.get("a.txt")).toBe(edited);
  });

  test("V23 reverting a hunk at the end of a file without a final newline restores the old ending", async () => {
    const repo = repoOf();
    repo.trees.HEAD = treeOf({ "a.txt": "a\nb" });
    repo.work = treeOf({ "a.txt": "a\nB" });
    const file = fileOf(await review.reviewFiles(repo.$, "uncommitted", []), "a.txt");
    const [hunk] = await review.fileDiff(repo.$, "uncommitted", file);

    const error = await review.revertHunk(repo.$, TOP, file, hunk!);

    expect(error).toBeNull();
    expect(repo.work.get("a.txt")).toBe("a\nb");
  });

  test("V24 reverting an untracked new file deletes it", async () => {
    const repo = repoOf();
    repo.work = treeOf({ "new.ts": "p\n" });
    repo.untracked.add("new.ts");
    const file = fileOf(await review.reviewFiles(repo.$, "uncommitted", []), "new.ts");

    const error = await review.revertFile(repo.$, TOP, file);

    expect(error).toBeNull();
    expect(repo.work.has("new.ts")).toBe(false);
  });

  test("V25 reverting a new file that was already added to git deletes it", async () => {
    const repo = repoOf();
    repo.trees.HEAD = treeOf({});
    repo.work = treeOf({ "new.ts": "p\n" });
    const file = fileOf(await review.reviewFiles(repo.$, "uncommitted", []), "new.ts");

    const error = await review.revertFile(repo.$, TOP, file);

    expect(error).toBeNull();
    expect(repo.work.has("new.ts")).toBe(false);
  });

  test("V26 reverting a modified file restores its original content and drops it from the list", async () => {
    const repo = repoOf();
    repo.trees.HEAD = treeOf({ "a.ts": "one\n", "b.ts": "same\n" });
    repo.work = treeOf({ "a.ts": "two\nthree\n", "b.ts": "changed\n" });
    const file = fileOf(await review.reviewFiles(repo.$, "uncommitted", []), "a.ts");

    const error = await review.revertFile(repo.$, TOP, file);

    expect(error).toBeNull();
    expect(repo.work.get("a.ts")).toBe("one\n");
    expect(repo.work.get("b.ts")).toBe("changed\n");
    expect(rowsOf(await review.reviewFiles(repo.$, "uncommitted", []))).toEqual([
      "modified b.ts +1 -1",
    ]);
  });

  test("V27 reverting a deleted file brings it back", async () => {
    const repo = repoOf();
    repo.trees.HEAD = treeOf({ "gone.ts": "one\ntwo\n" });
    repo.work = treeOf({});
    const file = fileOf(await review.reviewFiles(repo.$, "uncommitted", []), "gone.ts");

    const error = await review.revertFile(repo.$, TOP, file);

    expect(error).toBeNull();
    expect(repo.work.get("gone.ts")).toBe("one\ntwo\n");
  });

  test("V28 reverting a file under versus main restores the merge point content, not the last commit", async () => {
    const repo = repoOf({ mergeBases: { main: MERGE_BASE_SHA } });
    repo.trees.HEAD = treeOf({ "a.ts": "branch\n" });
    repo.trees[MERGE_BASE_SHA] = treeOf({ "a.ts": "base\n" });
    repo.work = treeOf({ "a.ts": "branch\n" });
    const file = fileOf(await review.reviewFiles(repo.$, "main", []), "a.ts");

    const error = await review.revertFile(repo.$, TOP, file);

    expect(error).toBeNull();
    expect(repo.work.get("a.ts")).toBe("base\n");
  });
});

describe("review nested repos", () => {
  test("R1 the session scope lists a file changed inside a nested repo or submodule with its counts", async () => {
    const repo = nestedRepoOf();

    const result = await review.reviewFiles(repo.$, "session", [
      sessionFile("src/a.ts"),
      sessionFile(`${INNER_DIR}/n.txt`),
      sessionFile(`${SUBMODULE_DIR}/x.ts`),
    ]);

    expect(rowsOf(result)).toEqual([
      "modified inner/n.txt +2 -0",
      "modified src/a.ts +1 -0",
      "modified vendor/lib/x.ts +1 -0",
    ]);
  });

  test("R2 the uncommitted scope lists files changed inside a nested repo or submodule and no row for their folders", async () => {
    const repo = nestedRepoOf();

    const result = await review.reviewFiles(repo.$, "uncommitted", []);

    expect(rowsOf(result)).toEqual([
      "modified inner/n.txt +2 -0",
      "modified src/a.ts +1 -0",
      "modified vendor/lib/x.ts +1 -0",
    ]);
  });

  test("R3 a file changed inside a nested repo opens with its changed place as a hunk", async () => {
    const repo = nestedRepoOf();

    const hunks = await review.fileDiff(repo.$, "uncommitted", innerFile());

    expect(hunks).toEqual([
      {
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 3,
        lines: [" keep inner", "+inner one added", "+inner two added"],
      },
    ]);
  });

  test("R4 reverting a file changed inside a nested repo restores it in that repo and leaves the session repo as it was", async () => {
    const repo = nestedRepoOf();

    const error = await review.revertFile(repo.$, TOP, innerFile());

    expect(error).toBeNull();
    expect(repoAt(repo, INNER_DIR).work.get("n.txt")).toBe("keep inner\n");
    expect(repo.work.get("src/a.ts")).toBe("one\ntwo\n");
  });

  test("R5 reverting the hunk of a file changed inside a nested repo removes its added lines in that repo", async () => {
    const repo = nestedRepoOf();
    const hunk = {
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 3,
      lines: [" keep inner", "+inner one added", "+inner two added"],
    };

    const error = await review.revertHunk(repo.$, TOP, innerFile(), hunk);

    expect(error).toBeNull();
    expect(repoAt(repo, INNER_DIR).work.get("n.txt")).toBe("keep inner\n");
  });

  test("R6 a submodule whose commit moved but has no changes of its own stays listed as its folder row", async () => {
    const repo = movedSubmoduleRepoOf();

    const result = await review.reviewFiles(repo.$, "uncommitted", []);

    expect(rowsOf(result)).toEqual(["modified vendor/lib +1 -1"]);
  });

  test("R7 a submodule whose commit moved and that has a changed file lists that file and no row for its folder", async () => {
    const repo = movedSubmoduleRepoOf(treeOf({ "x.ts": "keep\ny\n" }));

    const result = await review.reviewFiles(repo.$, "uncommitted", []);

    expect(rowsOf(result)).toEqual(["modified vendor/lib/x.ts +1 -0"]);
  });

  test("R8 the main scope keeps a row for a nested repo that has no main branch", async () => {
    const repo = nestedRepoWithoutMainOf();

    const result = await review.reviewFiles(repo.$, "main", []);

    expect(rowsOf(result)).toEqual(["added inner/ +0 -0", "modified src/a.ts +1 -0"]);
  });
});

function innerFile(): ReviewFile {
  return {
    path: `${INNER_DIR}/n.txt`,
    status: "modified",
    isBinary: false,
    added: 2,
    removed: 0,
    base: "HEAD",
  };
}

async function drawnTwoHunks() {
  const repo = repoOf();
  repo.trees.HEAD = treeOf({ "a.txt": numbered(FILE_LINES) });
  repo.work = treeOf({
    "a.txt": numbered(FILE_LINES, {
      [FIRST_EDIT_LINE]: "changed 3",
      [SECOND_EDIT_LINE]: "changed 18",
    }),
  });
  const file = fileOf(await review.reviewFiles(repo.$, "uncommitted", []), "a.txt");
  const hunks = await review.fileDiff(repo.$, "uncommitted", file);
  return { repo, hunks, file };
}

function sessionFile(path: string): SessionFile {
  return { target: `${TOP}/${path}`, base: "HEAD" };
}

type Listed = Awaited<ReturnType<typeof review.reviewFiles>>;

function rowsOf(result: Listed): string[] {
  if ("reason" in result) throw new Error(`no listing: ${result.reason}`);
  return result.files
    .map((f) => `${f.status} ${f.path} +${f.added} -${f.removed}`)
    .sort((a, b) => a.split(" ")[1]!.localeCompare(b.split(" ")[1]!));
}

function fileOf(result: Listed, path: string) {
  if ("reason" in result) throw new Error(`no listing: ${result.reason}`);
  const file = result.files.find((f) => f.path === path);
  if (!file) throw new Error(`${path} is not listed`);
  return file;
}

function bigHunk(name: string): string {
  return `@@ -1 +1 @@\n-${name}\n+${"x".repeat(BIG_HUNK_CHARS)}`;
}
