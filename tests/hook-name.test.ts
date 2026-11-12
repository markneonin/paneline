import { describe, expect, test } from "claude-code/testing";
import { hookCommandName } from "../hooks/hook-name";
import { NAME_CASES } from "./hook-name-cases";

describe("the hook command name", () => {
  for (const { id, shows, command, name } of NAME_CASES) {
    test(`${id} ${shows}`, () => {
      expect(hookCommandName(command)).toBe(name);
    });
  }
});
