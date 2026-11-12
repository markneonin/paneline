import { describe, expect, test } from "claude-code/testing";
import type { On, ToolCheckResult } from "claude-code";
import type { Engine } from "claude-code/testing";

const GUARD_ON = { options: { guard: true } };
const GUARD_OFF = { options: { guard: false } };
const WORK = "/work";
const REMOTE_TIP = "1234567890abcdef1234567890abcdef12345678";
const SHOWN_FILES = 10;
const MANY_FILES = 12;
const REFUSAL = "refused by another hook";
const FOOTER = "paneline guard: confirm to run";
const UNKNOWN_LOSS = "paneline guard: could not work out what would be lost. Confirm to run.";
const DROPPED_COMMITS = "bbb2222 second\naaa1111 first";
const LIST_TIMEOUT_MS = 5000;
const REMOTE_TIMEOUT_MS = 10000;

type Answer = { exitCode: number; stdout: string };
type Call = { argv: readonly string[]; cwd?: string; timeoutMs?: number };
type World = {
  calls: Call[];
  answers: Map<string, Answer>;
  verdicts: ToolCheckResult[];
  isCwdBroken: boolean;
};

let nextId = 0;

describe("guard hold", () => {
  test("G1 with the guard off a recursive delete is left as it was", GUARD_OFF, async ($, on) => {
    const world = worldOf(on);
    world.answers.set("find x -type f", found(["x/a"]));

    const verdict = await check($, world, "rm -rf x");

    expect(verdict.decision).not.toBe("ask");
    expect(world.calls).toEqual([]);
  });

  test("G2 rm -rf asks and lists the files it would remove", GUARD_ON, async ($, on) => {
    const world = worldOf(on);
    world.answers.set("find build -type f", found(["build/a.ts", "build/b.ts"]));

    const verdict = await check($, world, "rm -rf build");

    expect(verdict.decision).toBe("ask");
    expect(linesOf(verdict)).toEqual([
      "rm -rf build would remove 2 files:",
      "build/a.ts",
      "build/b.ts",
      FOOTER,
    ]);
    expect(world.calls[0]).toEqual({
      argv: ["find", "build", "-type", "f"],
      cwd: WORK,
      timeoutMs: LIST_TIMEOUT_MS,
    });
  });

  test("G3 past ten files the list stops and counts the rest", GUARD_ON, async ($, on) => {
    const world = worldOf(on);
    const files = Array.from({ length: MANY_FILES }, (_, index) => `big/f${index}`);
    world.answers.set("find big -type f", found(files));

    const verdict = await check($, world, "rm -rf big");

    expect(linesOf(verdict)).toEqual([
      `rm -rf big would remove ${MANY_FILES} files:`,
      ...files.slice(0, SHOWN_FILES),
      `+${MANY_FILES - SHOWN_FILES} more`,
      FOOTER,
    ]);
  });

  test("G4 rm -fr, rm -R and sudo rm -r ask as well", GUARD_ON, async ($, on) => {
    const world = worldOf(on);
    world.answers.set("find x -type f", found(["x/a"]));

    for (const command of ["rm -fr x", "rm -R x", "sudo rm -r x", "rm --recursive x"]) {
      expect((await check($, world, command)).decision).toBe("ask");
    }
  });

  test("G5 after cd the files are listed under the new directory", GUARD_ON, async ($, on) => {
    const world = worldOf(on);
    world.answers.set("find b -type f", found(["b/x"]));

    const verdict = await check($, world, "cd a && rm -rf b");

    expect(world.calls[0]?.cwd).toBe(`${WORK}/a`);
    expect(linesOf(verdict)).toContain("b/x");
  });

  test("G6 rm without -r and a recursive grep do not ask", GUARD_ON, async ($, on) => {
    const world = worldOf(on);

    expect((await check($, world, "rm file")).decision).not.toBe("ask");
    expect((await check($, world, "grep -r rm .")).decision).not.toBe("ask");
    expect((await check($, world, "echo 'rm -rf x'")).decision).not.toBe("ask");
    expect(world.calls).toEqual([]);
  });

  test("G7 a deny stays a deny", GUARD_ON, async ($, on) => {
    const world = worldOf(on);
    on("classic.PreToolUse", () => ({ deny: REFUSAL }));

    await check($, world, "rm -rf x");

    expect(world.verdicts).toEqual([]);
    expect(world.calls).toEqual([]);
  });

  test("G8 a glob lists the files under every match", GUARD_ON, async ($, on) => {
    const world = worldOf(on);
    world.answers.set("find dist -mindepth 1 -maxdepth 1 -name *", found(["dist/a", "dist/b"]));
    world.answers.set("find dist/a -type f", found(["dist/a/1.js"]));
    world.answers.set("find dist/b -type f", found(["dist/b/2.js"]));

    const verdict = await check($, world, "rm -rf dist/*");

    expect(linesOf(verdict)).toEqual([
      "rm -rf dist/* would remove 2 files:",
      "dist/a/1.js",
      "dist/b/2.js",
      FOOTER,
    ]);
  });

  test("G9 shell expansion, missing and slow targets say so", GUARD_ON, async ($, on) => {
    const world = worldOf(on);
    world.answers.set("find gone -type f", { exitCode: 1, stdout: "" });

    expect(linesOf(await check($, world, "rm -rf $HOME/x"))).toContain(
      "$HOME/x: uses shell expansion, files not listed",
    );
    expect(linesOf(await check($, world, "rm -rf gone"))).toContain("nothing to remove at gone");
    expect(linesOf(await check($, world, "rm -rf slow"))).toContain("could not list slow in time");
  });

  test("G10 force push variants ask and list the dropped commits", GUARD_ON, async ($, on) => {
    const world = worldOf(on);
    remoteHasTip(world);

    for (const command of [
      "git push --force",
      "git push -f origin main",
      "git push --force-with-lease",
      "git push --force-with-lease=main:abc origin main",
      "git push origin +main",
    ]) {
      const verdict = await check($, world, command);
      expect(verdict.decision).toBe("ask");
      expect(linesOf(verdict)).toEqual([
        "origin/main would drop 2 commits:",
        "bbb2222 second",
        "aaa1111 first",
        FOOTER,
      ]);
    }
  });

  test(
    "G11 a force push asks the remote with a timeout and never fetches",
    GUARD_ON,
    async ($, on) => {
      const world = worldOf(on);
      remoteHasTip(world);

      await check($, world, "git -C sub push -f");

      expect(world.calls.find((call) => call.argv.includes("ls-remote"))).toEqual({
        argv: ["git", "ls-remote", "origin", "refs/heads/main"],
        cwd: `${WORK}/sub`,
        timeoutMs: REMOTE_TIMEOUT_MS,
      });
      expect(world.calls.some((call) => call.argv.includes("fetch"))).toBe(false);
    },
  );

  test("G12 a plain git push does not ask", GUARD_ON, async ($, on) => {
    const world = worldOf(on);

    expect((await check($, world, "git push")).decision).not.toBe("ask");
    expect((await check($, world, "git push origin main")).decision).not.toBe("ask");
    expect(world.calls).toEqual([]);
  });

  test(
    "G13 a remote tip not fetched here says the dropped commits are unknown",
    GUARD_ON,
    async ($, on) => {
      const world = worldOf(on);
      remoteHasTip(world);
      world.answers.set(`git cat-file -e ${REMOTE_TIP}`, { exitCode: 1, stdout: "" });

      const verdict = await check($, world, "git push --force");

      expect(linesOf(verdict)).toEqual([
        "origin/main: remote tip 1234567 is not fetched here: the commits it would drop are unknown",
        FOOTER,
      ]);
    },
  );

  test("G14 a new remote branch drops nothing", GUARD_ON, async ($, on) => {
    const world = worldOf(on);
    remoteHasTip(world);
    world.answers.set("git ls-remote origin refs/heads/main", { exitCode: 0, stdout: "" });

    const verdict = await check($, world, "git push -f");

    expect(linesOf(verdict)).toEqual(["origin/main: new branch: nothing would be dropped", FOOTER]);
  });

  test("G15 a remote that cannot be read says so", GUARD_ON, async ($, on) => {
    const world = worldOf(on);
    remoteHasTip(world);
    world.answers.set("git ls-remote origin refs/heads/main", { exitCode: 128, stdout: "" });

    const verdict = await check($, world, "git push -f");

    expect(linesOf(verdict)).toEqual(["could not read origin/main", FOOTER]);
  });

  test("G16 a hook that fails on a risky command still asks", GUARD_ON, async ($, on) => {
    const world = worldOf(on);
    world.isCwdBroken = true;

    const verdict = await check($, world, "rm -rf x");

    expect(verdict).toMatchObject({ decision: "ask", reason: UNKNOWN_LOSS });
    expect((await check($, world, "ls")).decision).not.toBe("ask");
  });

  test("G17 shell keywords, braces and subshells before rm still ask", GUARD_ON, async ($, on) => {
    const world = worldOf(on);
    world.answers.set("find x -type f", found(["x/a"]));

    for (const command of [
      "if true; then rm -r x; fi",
      "for i in 1; do rm -r x; done",
      "if false; then true; else rm -r x; fi",
      "! rm -r x",
      "{ rm -r x; }",
      "(rm -r x)",
      "(cd a && true) ; rm -r x",
    ]) {
      expect((await check($, world, command)).decision).toBe("ask");
    }
  });

  test("G18 time, nice and exec prefixes and a path to rm still ask", GUARD_ON, async ($, on) => {
    const world = worldOf(on);
    world.answers.set("find x -type f", found(["x/a"]));

    for (const command of [
      "time rm -r x",
      "nice rm -r x",
      "nice -n 10 rm -r x",
      "exec rm -r x",
      "/bin/rm -r x",
      "sudo /usr/bin/rm -rf x",
    ]) {
      expect((await check($, world, command)).decision).toBe("ask");
    }
  });

  test(
    "G19 the string of bash -c, sh -c and zsh -c is read as a command",
    GUARD_ON,
    async ($, on) => {
      const world = worldOf(on);
      world.answers.set("find x -type f", found(["x/a"]));

      for (const command of [
        "bash -c 'rm -r x'",
        'sh -c "rm -r x"',
        "zsh -c 'cd /tmp && rm -r x'",
        "bash -lc 'rm -r x'",
      ]) {
        expect((await check($, world, command)).decision).toBe("ask");
      }
      expect((await check($, world, "bash -c 'ls x'")).decision).not.toBe("ask");
      expect((await check($, world, "bash script.sh")).decision).not.toBe("ask");
    },
  );

  test("G20 command substitutions and backticks are read as commands", GUARD_ON, async ($, on) => {
    const world = worldOf(on);
    world.answers.set("find x -type f", found(["x/a"]));

    for (const command of [
      "echo $(rm -r x)",
      "echo `rm -r x`",
      'echo "$(rm -r x)"',
      'echo "`rm -r x`"',
      "echo $(echo $(rm -r x))",
    ]) {
      expect((await check($, world, command)).decision).toBe("ask");
    }
    expect((await check($, world, "echo $(ls x) `date`")).decision).not.toBe("ask");
    expect((await check($, world, "echo '$(rm -r x)'")).decision).not.toBe("ask");
  });

  test("G21 cd works inside a subshell and ends with it", GUARD_ON, async ($, on) => {
    const world = worldOf(on);
    world.answers.set("find b -type f", found(["b/x"]));

    await check($, world, "(cd a && rm -r b)");
    await check($, world, "(cd a && true); rm -r b");
    await check($, world, "bash -c 'cd c && rm -r b'");

    expect(world.calls.map((call) => call.cwd)).toEqual([`${WORK}/a`, WORK, `${WORK}/c`]);
  });

  test("G22 redirections after the target are not targets", GUARD_ON, async ($, on) => {
    const world = worldOf(on);
    world.answers.set("find x -type f", found(["x/a"]));

    for (const command of [
      "rm -r x 2>/dev/null",
      "rm -r x >out.log",
      "rm -r x > out.log",
      "rm -r x >> out.log",
      "rm -r x 2> err.log",
      "rm -r x < in.txt",
      "rm -r x &> all.log",
      "rm -r x 2>&1",
    ]) {
      const verdict = await check($, world, command);
      expect(linesOf(verdict)).toEqual(["rm -r x would remove 1 file:", "x/a", FOOTER]);
    }
    expect(world.calls.every((call) => call.argv.join(" ") === "find x -type f")).toBe(true);
  });

  test("G23 the header echoes the flags the command used", GUARD_ON, async ($, on) => {
    const world = worldOf(on);
    world.answers.set("find x -type f", found(["x/a"]));

    for (const [command, header] of [
      ["rm -R x", "rm -R x"],
      ["rm -fr x", "rm -fr x"],
      ["rm -r -v x", "rm -r -v x"],
      ["rm --recursive x", "rm --recursive x"],
      ["sudo rm -rf x", "rm -rf x"],
    ] as const) {
      expect(linesOf(await check($, world, command))[0]).toBe(`${header} would remove 1 file:`);
    }
  });

  test("G24 a heredoc body that says rm -rf does not ask", GUARD_ON, async ($, on) => {
    const world = worldOf(on);

    const verdict = await check($, world, "cat > notes.md <<'EOF'\nclean up:\nrm -rf build\nEOF");

    expect(verdict.decision).not.toBe("ask");
    expect(world.calls).toEqual([]);
  });

  test("G25 a plain heredoc body that says rm -rf does not ask", GUARD_ON, async ($, on) => {
    const world = worldOf(on);

    const verdict = await check($, world, "cat > notes.md <<EOF\nclean up:\nrm -rf build\nEOF");

    expect(verdict.decision).not.toBe("ask");
    expect(world.calls).toEqual([]);
  });

  test(
    "G26 a double-quoted heredoc body that says rm -rf does not ask",
    GUARD_ON,
    async ($, on) => {
      const world = worldOf(on);

      const verdict = await check($, world, 'cat > notes.md <<"EOF"\nclean up:\nrm -rf build\nEOF');

      expect(verdict.decision).not.toBe("ask");
      expect(world.calls).toEqual([]);
    },
  );

  test(
    "G27 a dash heredoc with a tab-indented terminator does not ask",
    GUARD_ON,
    async ($, on) => {
      const world = worldOf(on);

      const verdict = await check(
        $,
        world,
        "cat > notes.md <<-EOF\nclean up:\n\trm -rf build\n\tEOF",
      );

      expect(verdict.decision).not.toBe("ask");
      expect(world.calls).toEqual([]);
    },
  );

  test(
    "G28 a commit message with rm -rf in a heredoc inside $() does not ask",
    GUARD_ON,
    async ($, on) => {
      const world = worldOf(on);

      const verdict = await check(
        $,
        world,
        "git commit -m \"$(cat <<'EOF'\nfix: x\n\nrm -rf is bad\nEOF\n)\"",
      );

      expect(verdict.decision).not.toBe("ask");
      expect(world.calls.some((call) => call.argv[0] === "find")).toBe(false);
    },
  );

  test(
    "G29 a dangerous command after the heredoc terminator still asks",
    GUARD_ON,
    async ($, on) => {
      const world = worldOf(on);
      world.answers.set("find build -type f", found(["build/a"]));

      const verdict = await check($, world, "cat <<EOF\nhi\nEOF\nrm -rf build");

      expect(linesOf(verdict)).toEqual(["rm -rf build would remove 1 file:", "build/a", FOOTER]);
    },
  );

  test("G34 a dangerous command on the heredoc header line still asks", GUARD_ON, async ($, on) => {
    const world = worldOf(on);
    world.answers.set("find build -type f", found(["build/a"]));

    const verdict = await check($, world, "cat <<EOF; rm -rf build\nhi\nEOF");

    expect(verdict.decision).toBe("ask");
    expect(linesOf(verdict)).toEqual(["rm -rf build would remove 1 file:", "build/a", FOOTER]);
  });

  test(
    "G30 a git push split by a backslash-newline asks with the one-line message",
    GUARD_ON,
    async ($, on) => {
      const world = worldOf(on);
      remoteHasTip(world);

      const verdict = await check($, world, "git push \\\n  --force");

      expect(verdict.decision).toBe("ask");
      expect(linesOf(verdict)).toEqual([
        "origin/main would drop 2 commits:",
        "bbb2222 second",
        "aaa1111 first",
        FOOTER,
      ]);
    },
  );

  test(
    "G31 an rm -rf split by a backslash-newline asks with the one-line message",
    GUARD_ON,
    async ($, on) => {
      const world = worldOf(on);
      world.answers.set("find build -type f", found(["build/a"]));

      const verdict = await check($, world, "rm -rf \\\n  build");

      expect(verdict.decision).toBe("ask");
      expect(linesOf(verdict)).toEqual(["rm -rf build would remove 1 file:", "build/a", FOOTER]);
    },
  );

  test("G32 sudo -u root rm -rf asks with the rm -rf message", GUARD_ON, async ($, on) => {
    const world = worldOf(on);
    world.answers.set("find x -type f", found(["x/a"]));

    const verdict = await check($, world, "sudo -u root rm -rf x");

    expect(verdict.decision).toBe("ask");
    expect(linesOf(verdict)).toEqual(["rm -rf x would remove 1 file:", "x/a", FOOTER]);
  });

  test("G33 sudo -E -H -- rm -rf asks with the rm -rf message", GUARD_ON, async ($, on) => {
    const world = worldOf(on);
    world.answers.set("find x -type f", found(["x/a"]));

    const verdict = await check($, world, "sudo -E -H -- rm -rf x");

    expect(verdict.decision).toBe("ask");
    expect(linesOf(verdict)).toEqual(["rm -rf x would remove 1 file:", "x/a", FOOTER]);
  });

  test(
    "G35 bash reading a heredoc body asks like the same rm -rf typed alone",
    GUARD_ON,
    async ($, on) => {
      const world = worldOf(on);
      world.answers.set("find build -type f", found(["build/a"]));

      const verdict = await check($, world, "bash <<'EOF'\nrm -rf build\nEOF");

      expect(verdict.decision).toBe("ask");
      expect(linesOf(verdict)).toEqual(["rm -rf build would remove 1 file:", "build/a", FOOTER]);
    },
  );

  test(
    "G36 sh -s reading a heredoc body asks like the same rm -rf typed alone",
    GUARD_ON,
    async ($, on) => {
      const world = worldOf(on);
      world.answers.set("find build -type f", found(["build/a"]));

      const verdict = await check($, world, "sh -s <<EOF\nrm -rf build\nEOF");

      expect(verdict.decision).toBe("ask");
      expect(linesOf(verdict)).toEqual(["rm -rf build would remove 1 file:", "build/a", FOOTER]);
    },
  );

  test(
    "G37 a heredoc piped into sh asks like the same rm -rf typed alone",
    GUARD_ON,
    async ($, on) => {
      const world = worldOf(on);
      world.answers.set("find build -type f", found(["build/a"]));

      const verdict = await check($, world, "cat <<EOF | sh\nrm -rf build\nEOF");

      expect(verdict.decision).toBe("ask");
      expect(linesOf(verdict)).toEqual(["rm -rf build would remove 1 file:", "build/a", FOOTER]);
    },
  );

  test("G38 a heredoc body sent over ssh asks", GUARD_ON, async ($, on) => {
    const world = worldOf(on);

    const verdict = await check($, world, "ssh host <<'EOF'\nrm -rf build\nEOF");

    expect(verdict.decision).toBe("ask");
  });

  test(
    "G39 an arithmetic shift does not hide the command on the next line",
    GUARD_ON,
    async ($, on) => {
      const world = worldOf(on);
      world.answers.set("find build -type f", found(["build/a"]));

      const verdict = await check($, world, "((x<<2))\nrm -rf build");

      expect(verdict.decision).toBe("ask");
      expect(linesOf(verdict)).toEqual(["rm -rf build would remove 1 file:", "build/a", FOOTER]);
    },
  );

  test(
    "G40 a << inside a comment does not hide the command on the next line",
    GUARD_ON,
    async ($, on) => {
      const world = worldOf(on);
      world.answers.set("find build -type f", found(["build/a"]));

      const verdict = await check($, world, "echo hi # <<EOF\nrm -rf build\nEOF");

      expect(verdict.decision).toBe("ask");
      expect(linesOf(verdict)).toEqual(["rm -rf build would remove 1 file:", "build/a", FOOTER]);
    },
  );
});

function worldOf(on: On): World {
  const world: World = { calls: [], answers: new Map(), verdicts: [], isCwdBroken: false };
  on("tool.check", async (_$, e, next) => {
    world.verdicts.push(await next(e));
    return { decision: "allow" };
  });
  on("tool.call", () => ({ result: "ran", text: "ran" }));
  on("session.cwd", () => {
    if (world.isCwdBroken) throw new Error("boom");
    return { value: WORK };
  });
  on("process.run", (_$, e) => {
    world.calls.push({ argv: e.argv, cwd: e.init?.cwd, timeoutMs: e.init?.timeoutMs });
    if (e.argv.includes("slow")) throw new Error("timed out");
    const answer = world.answers.get(e.argv.join(" ")) ?? { exitCode: 1, stdout: "" };
    return { value: { ...answer, stderr: "" } } as never;
  });
  return world;
}

function remoteHasTip(world: World): void {
  world.answers.set("git rev-parse --abbrev-ref --symbolic-full-name @{u}", {
    exitCode: 0,
    stdout: "origin/main\n",
  });
  world.answers.set("git ls-remote origin refs/heads/main", {
    exitCode: 0,
    stdout: `${REMOTE_TIP}\trefs/heads/main\n`,
  });
  world.answers.set(`git cat-file -e ${REMOTE_TIP}`, { exitCode: 0, stdout: "" });
  for (const local of ["HEAD", "main"]) {
    world.answers.set(`git rev-list --oneline ${local}..${REMOTE_TIP}`, {
      exitCode: 0,
      stdout: `${DROPPED_COMMITS}\n`,
    });
  }
}

function found(paths: string[]): Answer {
  return { exitCode: 0, stdout: `${paths.join("\n")}\n` };
}

async function check($: Engine, world: World, command: string): Promise<ToolCheckResult> {
  world.verdicts = [];
  await $.tool.call({ tool: "Bash", command, tool_use_id: `guard-${nextId++}` } as never);
  return world.verdicts[0] ?? { decision: "allow" };
}

function linesOf(verdict: ToolCheckResult): string[] {
  return (verdict.reason ?? "").split("\n");
}
