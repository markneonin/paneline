import { describe, expect, test } from "claude-code/testing";
import { targetOf } from "../hooks/tools";

describe("the label of a call row", () => {
  test("TG1 a call that names several things is labelled by the first present of file, notebook, command, pattern, url, query, description", () => {
    expect(targetOf({ file_path: "f", notebook_path: "n" })).toBe("f");
    expect(targetOf({ notebook_path: "n", command: "c" })).toBe("n");
    expect(targetOf({ command: "c", pattern: "p" })).toBe("c");
    expect(targetOf({ pattern: "p", url: "u" })).toBe("p");
    expect(targetOf({ url: "u", query: "q" })).toBe("u");
    expect(targetOf({ query: "q", description: "d" })).toBe("q");
    expect(targetOf({ description: "d" })).toBe("d");
  });

  test("TG2 a call whose first field is an empty string is labelled by the next field", () => {
    expect(targetOf({ file_path: "", command: "ls" })).toBe("ls");
  });

  test("TG3 a call whose first field starts with a blank line is labelled by the next field", () => {
    expect(targetOf({ command: "\nls", description: "list files" })).toBe("list files");
  });

  test("TG4 a call with none of the known fields has an empty label", () => {
    expect(targetOf({ timeout: 5, other: "x" })).toBe("");
  });

  test("TG5 a number in a known field is skipped and the next text field labels the row", () => {
    expect(targetOf({ file_path: 5, command: "ls" })).toBe("ls");
  });

  test("TG6 a call whose command has several lines is labelled by its first line", () => {
    expect(targetOf({ command: "echo a\nsecond line" })).toBe("echo a");
  });

  test("TG7 a Skill call is labelled by its skill name", () => {
    expect(targetOf({ skill: "loop" })).toBe("loop");
  });
});
