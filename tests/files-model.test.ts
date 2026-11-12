import { describe, expect, test } from "claude-code/testing";

import { filesModel, unfoldedRows } from "../hooks/files-model";
import type { FileTreeRow, FilesSource } from "../hooks/files-model";
import type { Activity, AgentEdit, AgentNode, GitChange } from "../types";

const HOME_DIR = "/Users/dev";
const REPO_ROOT = "/Users/dev/IT";
const NOTES_DIR = "/Users/dev/notes";
const MAIN_BRANCH = "main";
const MAIN_LABEL = "this session";
const MERGE_LABEL = "merge feature/x";
const AGENT_ID = "agent-1";
const AGENT_DESCRIPTION = "fix tests";
const MODEL = "claude-opus-5-5";
const EDITED = `${REPO_ROOT}/a.ts`;
const READ_ONLY = `${REPO_ROOT}/read.ts`;
const SRC_FILE = `${REPO_ROOT}/src/a.ts`;
const NESTED_FIRST = `${REPO_ROOT}/src/a/b/x.ts`;
const NESTED_SECOND = `${REPO_ROOT}/src/a/b/y.ts`;
const NOTE_FIRST = `${NOTES_DIR}/a.md`;
const NOTE_SECOND = `${NOTES_DIR}/b.md`;
const FIRST_ADDED = 3;
const FIRST_REMOVED = 1;
const SESSION_ADDED = 2;
const SESSION_REMOVED = 1;
const AGENT_ADDED = 4;
const AGENT_REMOVED = 0;
const MERGE_ADDED = 4;
const MERGE_REMOVED = 2;
const GIT_ADDED = 10;
const GIT_REMOVED = 4;
const NO_LINES = 0;
const NO_FILES = 0;
const BASE_HEAD = "aaaaaaa1";
const HEADER_NAME = "~/IT/";
const NOTES_HEADER = "~/notes/";
const CHAIN_NAME = "src/a/b/";
const SRC_NAME = "src/";
const NOTES_BODY = "notes.md";
const README_NAME = "README.md";
const A_NAME = "a.ts";
const B_NAME = "b.ts";
const X_NAME = "x.ts";
const Y_NAME = "y.ts";
const CHAIN_HEADER_ROWS = [HEADER_NAME, CHAIN_NAME, X_NAME, Y_NAME];
const FOLDED_FOLDER_KEY = "k/IT";
const SUBFOLDER_KEY = "k/IT/src";

describe("files tree", () => {
  test("F1 a file the session edited shows in the tree with its added and removed lines and counts as one file", () => {
    const model = filesModel(
      sourceOf({ activity: [activity(EDITED, FIRST_ADDED, FIRST_REMOVED, "Edit")] }),
    );

    expect(model.fileCount).toBe(1);
    expect(model.rows.find((row) => row.name === A_NAME)?.file).toEqual({
      added: FIRST_ADDED,
      removed: FIRST_REMOVED,
      isEdited: true,
    });
  });

  test("F2 a file the session only read is listed but adds no lines to the change totals", () => {
    const model = filesModel(
      sourceOf({ activity: [activity(READ_ONLY, NO_LINES, NO_LINES, "Read")] }),
    );

    expect(model.rows.map((row) => row.name)).toContain("read.ts");
    expect(model.totals).toEqual([]);
  });

  test("F3 change totals list each author with the lines it changed, biggest first", () => {
    const model = filesModel(
      sourceOf({
        activity: [activity(EDITED, SESSION_ADDED, SESSION_REMOVED, "Edit")],
        agentEdits: [agentEdit(SRC_FILE, AGENT_ADDED, AGENT_REMOVED, AGENT_ID)],
        agents: { [AGENT_ID]: agentNode(AGENT_ID, AGENT_DESCRIPTION) },
      }),
    );

    expect(model.totals.map((total) => total.label)).toEqual([AGENT_DESCRIPTION, MAIN_LABEL]);
  });

  test("F4 a file changed only by a merge is listed under the merge's label", () => {
    const model = filesModel(
      sourceOf({
        gitChanges: [gitChange(SRC_FILE, MERGE_ADDED, MERGE_REMOVED, MERGE_LABEL)],
      }),
    );

    expect(model.totals.map((total) => [total.label, total.added, total.removed])).toEqual([
      [MERGE_LABEL, MERGE_ADDED, MERGE_REMOVED],
    ]);
  });

  test("F5 a file both edited and merged shows the merge's line counts, not both summed", () => {
    const model = filesModel(
      sourceOf({
        activity: [activity(EDITED, SESSION_ADDED, SESSION_REMOVED, "Edit")],
        gitChanges: [gitChange(EDITED, GIT_ADDED, GIT_REMOVED, MERGE_LABEL)],
      }),
    );

    expect(model.rows.find((row) => row.name === A_NAME)?.file).toMatchObject({
      added: GIT_ADDED,
      removed: GIT_REMOVED,
    });
    expect(model.totals.map((total) => [total.label, total.added, total.removed])).toEqual([
      [MAIN_LABEL, GIT_ADDED, GIT_REMOVED],
    ]);
  });

  test("F6 a file the user removed from the view is left out of the tree and the count", () => {
    const model = filesModel(
      sourceOf({
        activity: [activity(EDITED, FIRST_ADDED, FIRST_REMOVED, "Edit")],
        gone: new Set([EDITED]),
      }),
    );

    expect(model.rows).toEqual([]);
    expect(model.fileCount).toBe(NO_FILES);
  });

  test("F7 a repo's files appear under its folder with its branch name", () => {
    const model = filesModel(
      sourceOf({
        activity: [activity(SRC_FILE, FIRST_ADDED, FIRST_REMOVED, "Edit")],
        branches: { [REPO_ROOT]: MAIN_BRANCH },
      }),
    );

    expect(model.rows[0]).toMatchObject({ name: HEADER_NAME, branch: MAIN_BRANCH });
  });

  test("F8 a folder chain with one child folder shows as one row", () => {
    const model = filesModel(
      sourceOf({
        activity: [
          activity(NESTED_FIRST, FIRST_ADDED, FIRST_REMOVED, "Edit"),
          activity(NESTED_SECOND, FIRST_ADDED, FIRST_REMOVED, "Edit"),
        ],
        branches: { [REPO_ROOT]: MAIN_BRANCH },
      }),
    );

    expect(model.rows.map((row) => row.name)).toEqual(CHAIN_HEADER_ROWS);
  });

  test("F9 files outside any repo are grouped under their shared folder", () => {
    const model = filesModel(
      sourceOf({
        activity: [
          activity(NOTE_FIRST, FIRST_ADDED, FIRST_REMOVED, "Edit"),
          activity(NOTE_SECOND, FIRST_ADDED, FIRST_REMOVED, "Edit"),
        ],
      }),
    );

    expect(model.rows[0]?.name).toBe(NOTES_HEADER);
  });

  test("A3 a file the session and a subagent both edited, then git recorded as +10 -4, shows the subagent alone with those lines", () => {
    const model = filesModel(
      sourceOf({
        activity: [activity(EDITED, SESSION_ADDED, SESSION_REMOVED, "Edit")],
        agentEdits: [agentEdit(EDITED, FIRST_ADDED, FIRST_REMOVED, AGENT_ID)],
        agents: { [AGENT_ID]: agentNode(AGENT_ID, AGENT_DESCRIPTION) },
        gitChanges: [gitChange(EDITED, GIT_ADDED, GIT_REMOVED, MERGE_LABEL)],
      }),
    );

    expect(model.totals.map((total) => [total.label, total.added, total.removed])).toEqual([
      [AGENT_DESCRIPTION, GIT_ADDED, GIT_REMOVED],
    ]);
  });

  test("A4 a file whose only edit failed is not listed and not counted", () => {
    const model = filesModel(
      sourceOf({
        activity: [{ ...activity(EDITED, NO_LINES, NO_LINES, "Edit"), isErrored: true }],
      }),
    );

    expect(model.rows).toEqual([]);
    expect(model.fileCount).toBe(NO_FILES);
    expect(model.totals).toEqual([]);
  });
});

describe("files filter", () => {
  test("T2-d folder totals count only the files the filter keeps", () => {
    const model = filesModel(
      sourceOf({
        filter: "DRAW",
        activity: [
          activity(`${REPO_ROOT}/src/draw.ts`, FIRST_ADDED, FIRST_REMOVED, "Edit"),
          activity(`${REPO_ROOT}/src/model.ts`, AGENT_ADDED, MERGE_REMOVED, "Edit"),
        ],
      }),
    );

    expect(model.fileCount).toBe(1);
    expect(model.totals.map((total) => [total.added, total.removed])).toEqual([
      [FIRST_ADDED, FIRST_REMOVED],
    ]);
  });
});

describe("unfolded rows", () => {
  test("U1 folding a folder hides everything under it and keeps the folder row", () => {
    const shown = unfoldedRows(nestedRows(), (row) => row.key === SUBFOLDER_KEY);

    expect(shown.map((row) => row.name)).toEqual([HEADER_NAME, SRC_NAME, README_NAME]);
  });

  test("U2 an unfolded folder shows all its rows", () => {
    const shown = unfoldedRows(nestedRows(), () => false);

    expect(shown.map((row) => row.name)).toEqual([HEADER_NAME, SRC_NAME, A_NAME, README_NAME]);
  });

  test("U3 folding a top folder hides nested folders too, and the next top-level row still shows", () => {
    const shown = unfoldedRows(
      [...nestedRows().slice(0, 3), fileRow(NOTES_BODY, 0, "k/notes.md")],
      (row) => row.key === FOLDED_FOLDER_KEY,
    );

    expect(shown.map((row) => row.name)).toEqual([HEADER_NAME, NOTES_BODY]);
  });

  test("U4 a file row cannot be folded, so the rows after it still show", () => {
    const shown = unfoldedRows(
      [fileRow(A_NAME, 0, "k/a.ts"), fileRow(B_NAME, 1, "k/a.ts/b.ts")],
      () => true,
    );

    expect(shown.map((row) => row.name)).toEqual([A_NAME, B_NAME]);
  });
});

function sourceOf(parts: Partial<FilesSource>): FilesSource {
  return {
    activity: [],
    agentEdits: [],
    gitChanges: [],
    agents: {},
    gone: new Set(),
    branches: {},
    home: HOME_DIR,
    filter: "",
    ...parts,
  };
}

function activity(target: string, added: number, removed: number, tool: string): Activity {
  return { id: target, tool, target, ms: 0, isErrored: false, added, removed };
}

function agentEdit(target: string, added: number, removed: number, agentId: string): AgentEdit {
  return { ...activity(target, added, removed, "Edit"), agentId };
}

function gitChange(target: string, added: number, removed: number, label: string): GitChange {
  return { target, added, removed, label, base: BASE_HEAD };
}

function agentNode(id: string, description: string): AgentNode {
  return {
    id,
    type: "general-purpose",
    description,
    background: false,
    model: MODEL,
    status: "done",
    startedAt: 0,
    ctxTokens: 0,
    running: [],
  };
}

function folderRow(name: string, depth: number, key: string): FileTreeRow {
  return { depth, isLast: false, name, key, total: { added: NO_LINES, removed: NO_LINES } };
}

function fileRow(name: string, depth: number, key: string): FileTreeRow {
  return {
    depth,
    isLast: false,
    name,
    key,
    file: { added: NO_LINES, removed: NO_LINES, isEdited: true },
  };
}

function nestedRows(): FileTreeRow[] {
  return [
    folderRow(HEADER_NAME, 0, FOLDED_FOLDER_KEY),
    folderRow(SRC_NAME, 1, SUBFOLDER_KEY),
    fileRow(A_NAME, 2, `${SUBFOLDER_KEY}/a.ts`),
    fileRow(README_NAME, 1, `${FOLDED_FOLDER_KEY}/README.md`),
  ];
}
