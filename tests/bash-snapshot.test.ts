import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

type Mark = { size: number; mtimeMs: number };
type Write = { key: string; value: unknown };
type StatusRun = { dir: string; timeoutMs: number | undefined };
type StatusMode = "ok" | "fails" | "slow";
type Effect = () => void | Promise<void>;
type Entry = {
  id: string;
  ms: number;
  isErrored: boolean;
  files?: { target: string; added: number; removed: number }[];
};
type EngineFile = { path: string; lines?: string[] };
type CallOptions = { background?: boolean; effect?: Effect; answer?: unknown };
type World = Awaited<ReturnType<typeof worldOf>>;

const WORK_DIR = "/Users/dev/IT";
const OTHER_DIR = "/Users/dev/other";
const NOT_REPO_DIR = "/Users/dev/scratch";
const SESSION_START = { cwd: WORK_DIR, surface: "terminal", isInteractive: true } as const;
const TRACKED = `${WORK_DIR}/src/a.ts`;
const SECOND_TRACKED = `${WORK_DIR}/src/b.ts`;
const THIRD_TRACKED = `${WORK_DIR}/src/c.ts`;
const NEW_FILE = `${WORK_DIR}/src/new.ts`;
const OTHER_NEW_FILE = `${OTHER_DIR}/f.txt`;
const SCRATCH_FILE = `${NOT_REPO_DIR}/f.txt`;
const ENGINE_FILES = [1, 2, 3, 4, 5, 6, 7].map((n) => `${WORK_DIR}/src/e${n}.ts`);
const FILE_SIZE = 10;
const REWRITTEN_SIZE = 25;
const START_TICK = 1000;
const STATUS_TIMEOUT_MS = 750;
const NOT_A_REPO = 128;
const FAILED_STATUS = 1;
const NO_EFFECT: Effect = () => undefined;
const HEAD = "aaaaaaa1";
const HASH = "0000000000000000000000000000000000000000";
const NO_FILES: string[] = [];
const BUILD_FAILURE = "exit status 2";
const DENIAL = "Blocked: not allowed";
const SNAPSHOT_MS = 400;
const COMMAND_MS = 70;
const TOOL_RESULT = { result: "ok", text: "ok" };
const ONE_ADDED_ONE_REMOVED = ["-a", "+b"];
const TWO_ADDED = ["+a", "+b"];
const FIRST_ENGINE_LINES = { added: 1, removed: 1 };
const SECOND_ENGINE_LINES = { added: 2, removed: 0 };
const NO_LINES = { added: 0, removed: 0 };
const FRESH_DIR = "/Users/dev/fresh";
const FRESH_FILE = `${FRESH_DIR}/a.txt`;
const LOOSE_DIR = "/Users/dev/loose";
const NESTED_FOLDER = `${WORK_DIR}/inner`;
const NESTED_FILE = `${NESTED_FOLDER}/n.txt`;
const NESTED_DIRTY_FILE = `${NESTED_FOLDER}/dirty.txt`;
const SUBMODULE_FOLDER = `${WORK_DIR}/vendor/lib`;
const SUBMODULE_FILE = `${SUBMODULE_FOLDER}/src/x.ts`;

describe("files written by Bash without an engine diff", () => {
  test("B1 a command that rewrites a tracked file lists that file", async ($, on) => {
    const world = await worldOf($, on);
    world.tracked(TRACKED);
    await $.session.start(SESSION_START);

    const entry = await bash($, world, "sed -i s/a/b/ src/a.ts", {
      effect: () => world.write(TRACKED),
    });

    expect(entry.files).toEqual([{ target: TRACKED, ...NO_LINES }]);
  });

  test("B2 a command that creates a new file lists the new file", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);

    const entry = await bash($, world, "echo x > src/new.ts", {
      effect: () => world.write(NEW_FILE),
    });

    expect(targetsOf(entry)).toEqual([NEW_FILE]);
  });

  test("B3 a command that deletes a tracked file lists the deleted file", async ($, on) => {
    const world = await worldOf($, on);
    world.tracked(TRACKED);
    await $.session.start(SESSION_START);

    const entry = await bash($, world, "rm src/a.ts", { effect: () => world.remove(TRACKED) });

    expect(targetsOf(entry)).toEqual([TRACKED]);
  });

  test("B4 rewriting an already modified file lists it but not another modified file left alone", async ($, on) => {
    const world = await worldOf($, on);
    world.modified(TRACKED);
    world.modified(SECOND_TRACKED);
    await $.session.start(SESSION_START);

    const entry = await bash($, world, "echo x >> src/a.ts", {
      effect: () => world.write(TRACKED, REWRITTEN_SIZE),
    });

    expect(targetsOf(entry)).toEqual([TRACKED]);
  });

  test("B5 cd into another repo then writing lists the file under that repo", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);

    const entry = await bash($, world, `cd ${OTHER_DIR} && echo x > f.txt`, {
      effect: () => world.write(OTHER_NEW_FILE),
    });

    expect(targetsOf(entry)).toEqual([OTHER_NEW_FILE]);
  });

  test("B6 rewriting one of three modified files then committing lists only the rewritten file", async ($, on) => {
    const world = await worldOf($, on);
    world.modified(TRACKED);
    world.modified(SECOND_TRACKED);
    world.modified(THIRD_TRACKED);
    await $.session.start(SESSION_START);

    const entry = await bash($, world, "echo x >> src/a.ts && git add -A && git commit -m x", {
      effect: () => {
        world.write(TRACKED, REWRITTEN_SIZE);
        world.commit();
      },
    });

    expect(targetsOf(entry)).toEqual([TRACKED]);
  });

  test("B7 a read-only command while a file is modified lists no files", async ($, on) => {
    const world = await worldOf($, on);
    world.modified(TRACKED);
    await $.session.start(SESSION_START);
    const control = await bash($, world, "echo x > src/new.ts", {
      effect: () => world.write(NEW_FILE),
    });
    expect(targetsOf(control)).toEqual([NEW_FILE]);

    const entry = await bash($, world, "ls src");

    expect(targetsOf(entry)).toEqual(NO_FILES);
  });

  test("B8 an engine list of 2 files and 4 changed files gives 4 files with the engine's line counts", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    const [first, second, third, fourth] = ENGINE_FILES;
    const answer = engineResult(
      [
        { path: first as string, lines: ONE_ADDED_ONE_REMOVED },
        { path: second as string, lines: TWO_ADDED },
      ],
      [first, second, third, fourth, first] as string[],
    );

    const entry = await bash($, world, "make fix", { answer });

    expect(entry.files).toEqual([
      { target: first, ...FIRST_ENGINE_LINES },
      { target: second, ...SECOND_ENGINE_LINES },
      { target: third, ...NO_LINES },
      { target: fourth, ...NO_LINES },
    ]);
  });

  test("B9 an engine list of 5 files and 7 changed files gives all 7", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    const shown = ENGINE_FILES.slice(0, 5).map((path) => ({ path, lines: TWO_ADDED }));

    const entry = await bash($, world, "make fix", { answer: engineResult(shown, ENGINE_FILES) });

    expect(targetsOf(entry)).toEqual(ENGINE_FILES);
  });

  test("B10 an engine field marked unavailable that still lists changed files gives those files", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    const changed = ENGINE_FILES.slice(0, 2);

    const entry = await bash($, world, "make fix", {
      answer: engineResult([], changed, { unavailable: true }),
    });

    expect(targetsOf(entry)).toEqual(changed);
  });

  test("B11 when the engine sends files, a file the command also wrote is not added and git status runs once", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    const [engineFile] = ENGINE_FILES;
    const before = world.statusRuns.length;

    const entry = await bash($, world, "make fix", {
      answer: engineResult(
        [{ path: engineFile as string, lines: TWO_ADDED }],
        [engineFile as string],
      ),
      effect: () => world.write(NEW_FILE),
    });

    expect(targetsOf(entry)).toEqual([engineFile]);
    expect(world.statusRuns.length - before).toBe(1);
  });

  test("B12 an engine field marked unavailable with no files falls back to the files the command wrote", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);

    const entry = await bash($, world, "echo x > src/new.ts", {
      answer: engineResult([], undefined, { unavailable: true }),
      effect: () => world.write(NEW_FILE),
    });

    expect(targetsOf(entry)).toEqual([NEW_FILE]);
  });

  test("B13 a working folder outside any repo runs no git status and lists no files", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    const control = await bash($, world, "echo x > src/new.ts", {
      effect: () => world.write(NEW_FILE),
    });
    expect(targetsOf(control)).toEqual([NEW_FILE]);
    world.setCwd(NOT_REPO_DIR);
    const before = world.statusRuns.length;

    const entry = await bash($, world, "echo x > f.txt", {
      effect: () => world.write(SCRATCH_FILE),
    });

    expect(targetsOf(entry)).toEqual(NO_FILES);
    expect(world.statusRuns.length - before).toBe(0);
  });

  test("B14 a background call runs no git status and lists no files", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    const control = await bash($, world, "echo x > src/new.ts", {
      effect: () => world.write(NEW_FILE),
    });
    expect(targetsOf(control)).toEqual([NEW_FILE]);
    const before = world.statusRuns.length;

    const entry = await bash($, world, "echo y > src/other.ts", {
      background: true,
      effect: () => world.write(TRACKED),
    });

    expect(targetsOf(entry)).toEqual(NO_FILES);
    expect(world.statusRuns.length - before).toBe(0);
  });

  test("B15 git checkout runs no git status and lists no files", async ($, on) => {
    const world = await worldOf($, on);
    world.tracked(TRACKED);
    await $.session.start(SESSION_START);
    const control = await bash($, world, "echo x > src/new.ts", {
      effect: () => world.write(NEW_FILE),
    });
    expect(targetsOf(control)).toEqual([NEW_FILE]);
    const before = world.statusRuns.length;

    const entry = await bash($, world, "git checkout main", { effect: () => world.write(TRACKED) });

    expect(targetsOf(entry)).toEqual(NO_FILES);
    expect(world.statusRuns.length - before).toBe(0);
  });

  test("B16 cd into a folder outside any repo lists no files and takes no status for that folder", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    const control = await bash($, world, "echo x > src/new.ts", {
      effect: () => world.write(NEW_FILE),
    });
    expect(targetsOf(control)).toEqual([NEW_FILE]);
    const before = world.statusRuns.length;

    const entry = await bash($, world, `cd ${NOT_REPO_DIR} && echo x > f.txt`, {
      effect: () => world.write(SCRATCH_FILE),
    });

    expect(targetsOf(entry)).toEqual(NO_FILES);
    const dirs = world.statusRuns.slice(before).map((run) => run.dir);
    expect(dirs.filter((dir) => dir.startsWith(NOT_REPO_DIR))).toEqual([]);
  });

  test("B17 a tool other than Bash runs no git status", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    const control = await bash($, world, "echo x > src/new.ts", {
      effect: () => world.write(NEW_FILE),
    });
    expect(targetsOf(control)).toEqual([NEW_FILE]);
    const before = world.statusRuns.length;

    await $.tool.call({
      tool: "Edit",
      file_path: TRACKED,
      old_string: "a",
      new_string: "b",
      tool_use_id: world.nextId(),
    } as never);

    expect(world.statusRuns.length - before).toBe(0);
  });

  test("B18 a git status that exits non-zero leaves the Bash call finished and not an error, with no files", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    const control = await bash($, world, "echo x > src/new.ts", {
      effect: () => world.write(NEW_FILE),
    });
    expect(targetsOf(control)).toEqual([NEW_FILE]);
    world.setMode("fails");

    const entry = await bash($, world, "echo y > src/other.ts", {
      effect: () => world.write(TRACKED),
    });

    expect(entry.isErrored).toBe(false);
    expect(targetsOf(entry)).toEqual(NO_FILES);
  });

  test("B19 a slow git status is cut at 750 ms and leaves the Bash call finished with no files", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    const control = await bash($, world, "echo x > src/new.ts", {
      effect: () => world.write(NEW_FILE),
    });
    expect(targetsOf(control)).toEqual([NEW_FILE]);
    world.setMode("slow");

    const entry = await bash($, world, "echo y > src/other.ts", {
      effect: () => world.write(TRACKED),
    });

    expect(entry.isErrored).toBe(false);
    expect(targetsOf(entry)).toEqual(NO_FILES);
  });
  test("B20 a failing command that wrote files before it failed lists no files", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    const control = await bash($, world, "echo x > src/new.ts", {
      effect: () => world.write(NEW_FILE),
    });
    expect(targetsOf(control)).toEqual([NEW_FILE]);

    const entry = await bash($, world, "make build", {
      answer: { isError: true, result: BUILD_FAILURE, text: BUILD_FAILURE },
      effect: () => world.write(TRACKED),
    });

    expect(entry.isErrored).toBe(true);
    expect(targetsOf(entry)).toEqual(NO_FILES);
  });

  test("B21 a denied command lists no files", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    const control = await bash($, world, "echo x > src/new.ts", {
      effect: () => world.write(NEW_FILE),
    });
    expect(targetsOf(control)).toEqual([NEW_FILE]);

    const entry = await bash($, world, "make clean", {
      answer: { deny: DENIAL },
      effect: () => world.write(TRACKED),
    });

    expect(entry.isErrored).toBe(true);
    expect(targetsOf(entry)).toEqual(NO_FILES);
  });
  test("B22 a Bash row's duration is the command's own time, without the time the snapshot took", async ($, on) => {
    const world = await worldOf($, on);
    await $.session.start(SESSION_START);
    world.setSnapshotCost(SNAPSHOT_MS);

    const entry = await bash($, world, "echo x > src/new.ts", {
      effect: async () => {
        world.write(NEW_FILE);
        await world.clock.advance(COMMAND_MS);
      },
    });

    expect(targetsOf(entry)).toEqual([NEW_FILE]);
    expect(entry.ms).toBe(COMMAND_MS);
  });

  test("B23 a repo made by git init mid-session lists the file written in it", async ($, on) => {
    const world = await worldOf($, on);
    world.setCwd(FRESH_DIR);
    await $.session.start({ ...SESSION_START, cwd: FRESH_DIR });
    await bash($, world, "git init", { effect: () => world.initRepo(FRESH_DIR) });

    const entry = await bash($, world, "echo hello > a.txt", {
      effect: () => world.write(FRESH_FILE),
    });

    expect(targetsOf(entry)).toEqual([FRESH_FILE]);
  });

  test("B24 a command run in a folder outside any repo takes no git status and at most one repo lookup", async ($, on) => {
    const world = await worldOf($, on);
    world.setCwd(LOOSE_DIR);
    await $.session.start({ ...SESSION_START, cwd: LOOSE_DIR });
    const statusBefore = world.statusRuns.length;
    const lookupsBefore = world.lookups.length;

    const first = await bash($, world, "echo one");
    const afterFirst = world.lookups.length;
    const second = await bash($, world, "echo two");
    const afterSecond = world.lookups.length;
    const third = await bash($, world, "echo three");
    const lookupsPerCall = [
      afterFirst - lookupsBefore,
      afterSecond - afterFirst,
      world.lookups.length - afterSecond,
    ];

    expect(Math.max(...lookupsPerCall)).toBeLessThanOrEqual(1);
    expect(world.statusRuns.length - statusBefore).toBe(0);
    expect([first, second, third].map(targetsOf)).toEqual([NO_FILES, NO_FILES, NO_FILES]);
  });

  test("B25 a command writing into a nested repo folder lists the file inside it by its absolute path", async ($, on) => {
    const world = await worldOf($, on);
    world.nestedRepo(NESTED_FOLDER);
    await $.session.start(SESSION_START);

    const entry = await bash($, world, "echo n > inner/n.txt", {
      effect: () => world.write(NESTED_FILE),
    });

    expect(targetsOf(entry)).toEqual([NESTED_FILE]);
  });

  test("B26 a command writing into a nested repo folder and a real file lists both files once", async ($, on) => {
    const world = await worldOf($, on);
    world.nestedRepo(NESTED_FOLDER);
    await $.session.start(SESSION_START);

    const entry = await bash($, world, "echo n > inner/n.txt && echo x > src/new.ts", {
      effect: () => {
        world.write(NESTED_FILE);
        world.write(NEW_FILE);
      },
    });

    expect(targetsOf(entry).sort()).toEqual([NESTED_FILE, NEW_FILE].sort());
  });

  test("B27 rewriting a tracked file inside a clean submodule lists that file once under the submodule folder", async ($, on) => {
    const world = await worldOf($, on);
    world.submodule(SUBMODULE_FOLDER);
    world.tracked(SUBMODULE_FILE);
    await $.session.start(SESSION_START);

    const entry = await bash($, world, "echo y > vendor/lib/src/x.ts", {
      effect: () => world.write(SUBMODULE_FILE),
    });

    expect(targetsOf(entry)).toEqual([SUBMODULE_FILE]);
  });

  test("B28 a nested repo whose git status fails before the command leaves the Bash row with no files, not its modified file", async ($, on) => {
    const world = await worldOf($, on);
    world.nestedRepo(NESTED_FOLDER);
    world.modified(NESTED_DIRTY_FILE);
    world.breakStatus(NESTED_FOLDER);
    await $.session.start(SESSION_START);

    const entry = await bash($, world, "echo x > src/new.ts", {
      effect: () => {
        world.repairStatus(NESTED_FOLDER);
        world.write(NEW_FILE);
      },
    });

    expect(targetsOf(entry)).toEqual(NO_FILES);
  });
});

async function bash(
  $: Engine,
  world: World,
  command: string,
  options: CallOptions = {},
): Promise<Entry> {
  const id = world.nextId();
  world.willRun(options.effect ?? NO_EFFECT, options.answer);
  await $.tool.call({
    tool: "Bash",
    command,
    tool_use_id: id,
    ...(options.background === true ? { run_in_background: true } : {}),
  } as never);
  const list = world.lastActivity();
  const entry = list.find((one) => one.id === id);
  if (entry === undefined) throw new Error(`no activity entry for ${id}`);
  return entry;
}

function targetsOf(entry: Entry): string[] {
  return (entry.files ?? []).map((file) => file.target);
}

function engineResult(
  files: EngineFile[],
  changedFiles?: string[],
  flags: { unavailable?: true } = {},
): unknown {
  return {
    result: {
      stdout: "",
      stderr: "",
      interrupted: false,
      bashEditDiff: {
        files: files.map((file) => ({
          filePath: file.path,
          hunks: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 1,
              lines: file.lines ?? ONE_ADDED_ONE_REMOVED,
            },
          ],
        })),
        moreFiles: 0,
        ...(changedFiles === undefined ? {} : { changedFiles }),
        ...flags,
      },
    },
    text: "ok",
  };
}

async function worldOf($: Engine, on: On) {
  const clock = mock.clock(on);
  mock.env(on, { HOME: "/Users/dev" });
  const writes: Write[] = [];
  const stored = new Map<string, unknown>();
  const statusRuns: StatusRun[] = [];
  const lookups: string[] = [];
  const nested: string[] = [];
  const submodules: string[] = [];
  const roots = [WORK_DIR, OTHER_DIR];
  const disk = new Map<string, Mark>();
  let committed = new Map<string, Mark>();
  let tick = START_TICK;
  let counter = 0;
  let mode: StatusMode = "ok";
  const broken = new Set<string>();
  let snapshotCost = 0;
  let cwd = WORK_DIR;
  let pending: { effect: Effect; answer: unknown } = { effect: NO_EFFECT, answer: undefined };

  const rootOf = (dir: string): string | undefined =>
    roots
      .filter((root) => dir === root || dir.startsWith(`${root}/`))
      .sort((a, b) => b.length - a.length)[0];

  const lineOf = (path: string, root: string): string | null => {
    const now = disk.get(path);
    const was = committed.get(path);
    const rel = path.slice(root.length + 1);
    if (now === undefined) return `1 .D N... 100644 100644 000000 ${HASH} ${HASH} ${rel}`;
    if (was === undefined) return `? ${rel}`;
    if (now.size === was.size && now.mtimeMs === was.mtimeMs) return null;
    return `1 .M N... 100644 100644 100644 ${HASH} ${HASH} ${rel}`;
  };

  const statusText = (root: string, ignoresSubmodules: boolean): string => {
    const paths = [...new Set([...disk.keys(), ...committed.keys()])].filter((path) =>
      path.startsWith(`${root}/`),
    );
    const folders = nested.filter((folder) => folder.startsWith(`${root}/`));
    const modules = submodules.filter((folder) => folder.startsWith(`${root}/`));
    const inside = (path: string, folder: string): boolean =>
      path === folder || path.startsWith(`${folder}/`);
    const movedModules = modules.filter((folder) =>
      paths.some((path) => inside(path, folder) && lineOf(path, root) !== null),
    );
    const lines = [
      ...folders.map((folder) => `? ${folder.slice(root.length + 1)}/`),
      ...(ignoresSubmodules
        ? []
        : movedModules.map(
            (folder) =>
              `1 .M S.M. 160000 160000 160000 ${HASH} ${HASH} ${folder.slice(root.length + 1)}`,
          )),
      ...paths
        .filter((path) => ![...folders, ...modules].some((folder) => inside(path, folder)))
        .flatMap((path) => {
          const line = lineOf(path, root);
          return line === null ? [] : [line];
        }),
    ];
    return lines.map((line) => `${line}\0`).join("");
  };

  const answerGit = (
    argv: readonly string[],
    init: { cwd?: string; timeoutMs?: number } | undefined,
  ): { exitCode: number; stdout: string; stderr: string } => {
    const dir = argv[1] === "-C" ? (argv[2] ?? cwd) : (init?.cwd ?? cwd);
    const root = rootOf(dir);
    const args = argv.slice(argv[1] === "-C" ? 3 : 1);
    const reply = (exitCode: number, stdout: string) => ({ exitCode, stdout, stderr: "" });
    if (args[0] === "rev-parse") lookups.push(dir);
    if (args[0] === "status") {
      statusRuns.push({ dir, timeoutMs: init?.timeoutMs });
      if (root === undefined) return reply(NOT_A_REPO, "");
      if (mode === "fails" || broken.has(root)) return reply(FAILED_STATUS, "");
      if (mode === "slow" && (init?.timeoutMs ?? Infinity) <= STATUS_TIMEOUT_MS) {
        throw new Error("timed out");
      }
      return reply(0, statusText(root, args.includes("--ignore-submodules=all")));
    }
    if (root === undefined) return reply(NOT_A_REPO, "");
    const joined = args.join(" ");
    if (joined === "rev-parse --show-toplevel") return reply(0, root);
    if (joined === "rev-parse --show-toplevel HEAD") return reply(0, `${root}\n${HEAD}`);
    return reply(0, "");
  };

  on("state.set", (_$, e, next) => {
    writes.push({ key: e.key, value: e.value });
    return next(e);
  });
  on("store.get", (_$, e) => ({ value: stored.get(e.key) }));
  on("store.set", (_$, e) => {
    stored.set(e.key, e.value);
    return { value: undefined };
  });
  on("session.cwd", () => ({ value: cwd }));
  on("session.repo", () => ({ value: null }));
  on("session.root", () => ({ value: cwd }));
  on("session.id", () => ({ value: "s1" }));
  on("store.keys", () => ({ value: [...stored.keys()] }));
  on("store.delete", (_$, e) => {
    stored.delete(e.key);
    return { value: undefined };
  });
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("classic.SessionStart", () => ({}));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("config.list", () => ({ value: [{ key: "theme", value: "dark" }] }) as never);
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("agent.list", () => ({ value: [] }));
  on("command.register", () => ({ value: {} }) as never);
  on("session.model", () => ({ value: "claude-opus-5-5" }));
  on("settings.read", () => ({ value: {} }));
  on("process.run", async (_$, e) => {
    const argv = e.argv;
    if (argv.includes("status")) await clock.advance(snapshotCost);
    const value =
      argv[0] === "git" ? answerGit(argv, e.init) : { exitCode: 0, stdout: "", stderr: "" };
    return { value } as never;
  });
  on("fs.stat", (_$, e) => {
    const mark = disk.get(e.path.replace(/\/$/, ""));
    if (mark === undefined) throw Object.assign(new Error(`ENOENT ${e.path}`), { code: "ENOENT" });
    return { value: { kind: "file", ...mark, isLink: false } } as never;
  });
  on("fs.exists", (_$, e) => ({ value: disk.has(e.path) }));
  on("tool.call", async () => {
    const { effect, answer } = pending;
    pending = { effect: NO_EFFECT, answer: undefined };
    await effect();
    return (answer ?? TOOL_RESULT) as never;
  });

  const mark = (size: number): Mark => ({ size, mtimeMs: ++tick });

  return {
    writes,
    statusRuns,
    lookups,
    disk,
    clock,
    initRepo: (dir: string) => {
      roots.push(dir);
    },
    nestedRepo: (folder: string) => {
      nested.push(folder);
      roots.push(folder);
      disk.set(folder, mark(FILE_SIZE));
    },
    submodule: (folder: string) => {
      submodules.push(folder);
      roots.push(folder);
    },
    setSnapshotCost: (ms: number) => {
      snapshotCost = ms;
    },
    setMode: (next: StatusMode) => {
      mode = next;
    },
    breakStatus: (folder: string) => {
      broken.add(folder);
    },
    repairStatus: (folder: string) => {
      broken.delete(folder);
    },
    setCwd: (dir: string) => {
      cwd = dir;
    },
    nextId: () => `call-${++counter}`,
    willRun: (effect: Effect, answer?: unknown) => {
      pending = { effect, answer };
    },
    tracked: (path: string) => {
      const clean = mark(FILE_SIZE);
      disk.set(path, clean);
      committed.set(path, clean);
    },
    modified: (path: string) => {
      committed.set(path, mark(FILE_SIZE));
      disk.set(path, mark(REWRITTEN_SIZE));
    },
    write: (path: string, size = FILE_SIZE) => {
      disk.set(path, mark(size));
    },
    remove: (path: string) => {
      disk.delete(path);
    },
    commit: () => {
      committed = new Map(disk);
    },
    lastActivity: (): Entry[] =>
      (writes.filter((write) => write.key === "activity").at(-1)?.value ?? []) as Entry[],
  };
}
