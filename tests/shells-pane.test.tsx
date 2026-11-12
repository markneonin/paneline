import { describe, expect, mock, test } from "claude-code/testing";
import type { On } from "claude-code";
import type { Engine, MockClock } from "claude-code/testing";

import { formatDuration } from "../hooks/format";
import { paneInk } from "../hooks/pane-ink";
import { screenRows } from "./band-screen";
import { COLUMNS, paneOnTab, settle, showTab, texts } from "./clear-world";
import { collect, textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import type { Pane } from "./clear-world";

type Shell = { id: string; command: string; output?: string[] };
type TaskStopCall = { tool: string; task_id: string; consent?: string };
type Lsof = { exitCode: number; stdout: string } | "throws";
type World = {
  clock: MockClock;
  outputs: Map<string, string[]>;
  lsof: Lsof;
  lsofRuns: number;
  lsofArgv: string[][];
  psRuns: number;
  psArgv: string[][];
  tailRuns: number;
  parents: Map<number, number>;
  psFails: boolean;
  tailLines: number[];
  stops: TaskStopCall[];
  refuseStop: boolean;
  hasOutputPath: Set<string>;
};

const LABEL = "Shells";
const PORTS_HEADING = "Ports opened in this session";
const NOW = 200_000;
const FLUSH_MS = 1_000;
const RUN_MS = 65_000;
const NARROW_COLUMNS = 60;
const LSOF_HEADER = "COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME";
const SERVER = { id: "task-1", command: "npm run dev", output: ["compiled", "ready on :3000"] };
const THIRD = { id: "task-3", command: "vite build --watch", output: ["building"] };
const NODE_LISTENER = "node     4242 mark   23u  IPv4 0x1 0t0 TCP *:3000 (LISTEN)";
const PYTHON_LISTENER = "python3.14 5151 mark    4u  IPv4 0x3 0t0 TCP *:8765 (LISTEN)";
const HTTP_SHELL = { id: "task-1", command: "python3 -m http.server 8765" };
const WATCHER = { id: "task-2", command: "tsc --watch", output: ["watching"] };
const KILL = "kill";
const CONFIRM_KILL = "confirm kill";
const OUTPUT_SUFFIX = ".output";
const ROOT_PID = 1000;
const AGENTS_POLL_MS = 1_000;
const POLLS = 3;
const GUTTER_FREE_COLUMNS = 100;
const LSOF_ARGV = ["lsof", "-nP", "+c", "0", "-iTCP", "-sTCP:LISTEN"];
const PS_ARGV = ["sh", "-c", "echo $PPID; ps -A -o pid=,ppid="];
const SHOWN_OUTPUT_LINES = 5;
const TAIL_READ_LINES = 8;
const KILLED_END = "[killed]";
const KILLED_GLYPH = "■";
const TICK_LINES = Array.from({ length: 8 }, (_, index) => `tick ${index + 1}`);
const LONG_OUTPUT = Array.from({ length: 8 }, (_, index) => `line ${index + 1}`);
const FAILED_EXIT = "[exited with code 2]";
const DONE_EXIT = "[exited with code 0]";
const RUNTIME_TEXT = "5s";
const PANE_PAD_CELLS = 1;
const MARK_CELLS = 2;
const NAME_GAP_CELLS = 2;
const FITTING_COMMAND = "x".repeat(
  COLUMNS - PANE_PAD_CELLS - MARK_CELLS - NAME_GAP_CELLS - RUNTIME_TEXT.length,
);
const RUNNING_MARK = "●";
const CUT_SPACES = 120;
const TICK_COMMAND = `tick $i;${" ".repeat(CUT_SPACES)}done`;
const TIME_END = /\d+s$/;
const SUMMARY_RUNNING = "1 running";
const SUMMARY_ENDED = "2 ended";
const SUMMARY_ONE_ENDED = "1 ended";
const FINISHED_AFTER_MS = 15_000;
const ABSORBED_AFTER_MS = 60_000;
const TURN_END_MS = 90_000;
const IDLE_TURN_END_MS = 30_000;
const FAILED_AFTER_MS = 45_000;
const WIDE_COLUMNS = 120;
const HANDLER_SHELL = {
  id: "task-1",
  command: 'python3 -c "import http.server as h; h.test(HandlerClass=Handler, port=8790)"',
};
const HANDLER_LISTENER = "python3.14 5151 mark    4u  IPv4 0x3 0t0 TCP *:8790 (LISTEN)";
const BIND_SHELL = {
  id: "task-1",
  command: "uv run python3 -m http.server 8790 --bind 127.0.0.1 --directory /tmp/site",
};
const BIND_LISTENER = HANDLER_LISTENER;
const WIDE_SHELL = {
  id: "task-1",
  command: `node server.js ${"--option-value ".repeat(12)}done`,
};
const LONG_WORD = `abcdefghij${"k".repeat(80)}`;
const HANDLER_CUT_ROW = /^ ● python3 -c "import http\.server as h;…\s+:8790 \d+s$/;
const BIND_CUT_ROW = /^ ● uv run python3 -m http\.server 8790 --bind…\s+:8790 \d+s$/;
const WIDE_CUT_ROW = /^ ● node server\.js( --option-value)+…\s+\d+s$/;

describe("shells tab", () => {
  test("S1 the tab opens with its title and says there are no background shells", async ($, on) => {
    worldOf(on);

    const pane = await paneOnTab($, LABEL);

    const shown = await texts(pane);
    expect(shown).toContain("Shells");
    expect(shown).toContain("no background shells");
  });

  test("S2 a background run shows its command, how long it runs and the last lines of its output", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, SERVER);
    await world.clock.advance(RUN_MS);

    const pane = await openShells($, world);

    const shown = await texts(pane);
    expect(shown.some((text) => text.includes(SERVER.command))).toBe(true);
    expect(shown.some((text) => text.includes(formatDuration(RUN_MS + FLUSH_MS)))).toBe(true);
    expect(shown).toContain("compiled");
    expect(shown).toContain("ready on :3000");
    expect(shown).not.toContain("no background shells");
  });

  test("S2b at 60 columns a long command is cut and its row stays on one line", async ($, on) => {
    const world = worldOf(on);
    const command = `npm run dev -- ${"--flag ".repeat(30)}`;
    await startShell($, world, { id: "task-1", command, output: [] });

    const pane = await openShells($, world, NARROW_COLUMNS);

    const row = (await texts(pane)).find((text) => text.includes("npm run dev"));
    expect(row).toBeDefined();
    expect(row?.length).toBeLessThanOrEqual(NARROW_COLUMNS);
  });

  test("S2d a shell with eight output lines shows only the last five and asks for six", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, { id: "task-1", command: SERVER.command, output: LONG_OUTPUT });

    const pane = await openShells($, world);

    const shown = await texts(pane);
    expect(shown.filter((text) => /^line \d$/.test(text))).toEqual(
      LONG_OUTPUT.slice(-SHOWN_OUTPUT_LINES),
    );
    expect(new Set(world.tailLines)).toEqual(new Set([TAIL_READ_LINES]));
  });

  test("S2c a turn end shows the output the shell wrote meanwhile", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, SERVER);
    const pane = await openShells($, world);
    world.outputs.set(SERVER.id, ["compiled", "ready on :3000", "GET /health 200"]);

    await endTurn($, world, [SERVER.id]);
    await settle(pane);

    expect(await texts(pane)).toContain("GET /health 200");
  });

  test("S3 pressing the shell's name shows kill and one press of kill asks for confirm kill without stopping it", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, SERVER);
    const pane = await openShells($, world);
    expect(await buttonLabels(pane)).not.toContain(KILL);

    await pressShellRow(pane, world, SERVER.command);
    expect(await buttonLabels(pane)).toContain(KILL);
    await pressButton(pane, world, KILL);

    expect(await buttonLabels(pane)).toContain(CONFIRM_KILL);
    expect(await buttonLabels(pane)).not.toContain(KILL);
    expect(world.stops).toEqual([]);
  });

  test("S3b confirm kill stops exactly that shell by its id", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, SERVER);
    await startShell($, world, WATCHER);
    const pane = await openShells($, world);

    await pressShellRow(pane, world, SERVER.command);
    await pressButton(pane, world, KILL);
    await pressButton(pane, world, CONFIRM_KILL);

    expect(world.stops.map((call) => [call.tool, call.task_id])).toEqual([["TaskStop", SERVER.id]]);
    expect(typeof world.stops[0]?.consent).toBe("string");
  });

  test("S3c after confirm kill the row says killed and no kill button is left", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, SERVER);
    const pane = await openShells($, world);

    await pressShellRow(pane, world, SERVER.command);
    await pressButton(pane, world, KILL);
    await pressButton(pane, world, CONFIRM_KILL);

    const row = (await texts(pane)).find((text) => text.includes(SERVER.command));
    expect(row).toContain("killed");
    expect(await buttonLabels(pane)).not.toContain(KILL);
    expect(await buttonLabels(pane)).not.toContain(CONFIRM_KILL);
  });

  test("S3d when the stop is refused the shell still shows running", async ($, on) => {
    const world = worldOf(on);
    world.refuseStop = true;
    await startShell($, world, SERVER);
    const pane = await openShells($, world);

    await pressShellRow(pane, world, SERVER.command);
    await pressButton(pane, world, KILL);
    await pressButton(pane, world, CONFIRM_KILL);

    const row = (await texts(pane)).find((text) => text.includes(SERVER.command));
    expect(row).toBeDefined();
    expect(row).not.toContain("killed");
  });

  test("S4 a turn end that no longer lists a shell marks it done and moves it under the running ones", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, SERVER);
    await startShell($, world, WATCHER);
    const pane = await openShells($, world);

    await endTurn($, world, [WATCHER.id]);
    await settle(pane);

    const shown = await texts(pane);
    const server = shown.findIndex((text) => text.includes(SERVER.command));
    const watcher = shown.findIndex((text) => text.includes(WATCHER.command));
    expect(server).toBeGreaterThanOrEqual(0);
    expect(shown[server]).toContain("done");
    expect(shown[watcher]).not.toContain("done");
    expect(watcher).toBeGreaterThanOrEqual(0);
    expect(watcher).toBeLessThan(server);
  });

  test("S4b a turn end that still lists the shell leaves it running", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, SERVER);
    const pane = await openShells($, world);

    await endTurn($, world, [SERVER.id]);
    await settle(pane);

    const row = (await texts(pane)).find((text) => text.includes(SERVER.command));
    expect(row).toBeDefined();
    expect(row).not.toContain("done");
    expect(row).not.toContain("killed");
  });

  test("S4c a turn end that reports no background list leaves the shell running", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, SERVER);
    const pane = await openShells($, world);

    await $.classic.Stop({ stop_hook_active: false });
    await settle(pane);

    const row = (await texts(pane)).find((text) => text.includes(SERVER.command));
    expect(row).toBeDefined();
    expect(row).not.toContain("done");
  });

  test("S5 a shell whose output file is unknown says no output file", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, SERVER, false);

    const pane = await openShells($, world);

    expect(await texts(pane)).toContain("no output file");
  });
});

describe("shells tab listening ports", () => {
  test("S9 the ports section is headed Ports opened in this session and the old heading is nowhere on the tab", async ($, on) => {
    const world = worldOf(on);
    world.lsof = {
      exitCode: 0,
      stdout: `${LSOF_HEADER}\nnode     4242 mark   23u  IPv4 0x1 0t0 TCP *:3000 (LISTEN)`,
    };

    const pane = await openShells($, world);

    const shown = await texts(pane);
    expect(shown).toContain(PORTS_HEADING);
    expect(shown.some((text) => text.includes("Listening ports"))).toBe(false);
  });

  test("P1 one port listening on IPv4 and IPv6 is one row with port, command and pid", async ($, on) => {
    const world = worldOf(on);
    world.lsof = {
      exitCode: 0,
      stdout: [
        LSOF_HEADER,
        "node     4242 mark   23u  IPv4 0x1 0t0 TCP *:3000 (LISTEN)",
        "node     4242 mark   24u  IPv6 0x2 0t0 TCP *:3000 (LISTEN)",
        "python3  5151 mark    4u  IPv4 0x3 0t0 TCP 127.0.0.1:8000 (LISTEN)",
      ].join("\n"),
    };

    const pane = await openShells($, world);

    const shown = await texts(pane);
    expect(shown).toContain(PORTS_HEADING);
    const rows = shown.filter((text) => text.includes(":3000"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/:3000\s+node\s+pid 4242/);
    expect(shown.filter((text) => /:8000\s+python3\s+pid 5151/.test(text))).toHaveLength(1);
    expect(shown.findIndex((text) => text.includes(":3000"))).toBeLessThan(
      shown.findIndex((text) => text.includes(":8000")),
    );
  });

  test("F26a a port held by a running shell shows :port on that shell's row at 60 columns and no port row of its own", async ($, on) => {
    const world = worldOf(on);
    world.lsof = { exitCode: 0, stdout: `${LSOF_HEADER}\n${PYTHON_LISTENER}` };
    await startShell($, world, HTTP_SHELL);

    const pane = await openShells($, world, NARROW_COLUMNS);

    const rows = await screenAt(pane, NARROW_COLUMNS);
    expect(rowOf(rows, HTTP_SHELL.command)).toMatch(/ :8765\s+\d+s$/);
    expect(rows.some((row) => row.includes("pid 5151"))).toBe(false);
  });

  test("F26b a port no shell holds keeps its port, process and pid row, and the shell-held port is not in the Ports block", async ($, on) => {
    const world = worldOf(on);
    world.lsof = { exitCode: 0, stdout: `${LSOF_HEADER}\n${PYTHON_LISTENER}\n${NODE_LISTENER}` };
    await startShell($, world, HTTP_SHELL);

    const pane = await openShells($, world, NARROW_COLUMNS);

    const rows = await screenAt(pane, NARROW_COLUMNS);
    expect(rows.some((row) => /^:3000\s+node\s+pid 4242$/.test(row.trim()))).toBe(true);
    expect(rows.some((row) => row.includes("pid 5151"))).toBe(false);
    expect(rows.some((row) => row.includes(PORTS_HEADING))).toBe(true);
  });

  test("F26c the summary counts every port, shell-held or not", async ($, on) => {
    const world = worldOf(on);
    world.lsof = { exitCode: 0, stdout: `${LSOF_HEADER}\n${PYTHON_LISTENER}\n${NODE_LISTENER}` };
    await startShell($, world, HTTP_SHELL);

    const pane = await openShells($, world, NARROW_COLUMNS);

    expect(await texts(pane)).toContain("1 running · 2 ports");
  });

  test("F26d when every port is held by a running shell the Ports block is not drawn and the summary still counts the port", async ($, on) => {
    const world = worldOf(on);
    world.lsof = { exitCode: 0, stdout: `${LSOF_HEADER}\n${PYTHON_LISTENER}` };
    await startShell($, world, HTTP_SHELL);

    const pane = await openShells($, world, NARROW_COLUMNS);

    const shown = await texts(pane);
    expect(shown).not.toContain(PORTS_HEADING);
    expect(shown).not.toContain("no listening ports");
    expect(shown).toContain("1 running · 1 port");
  });

  test("P2 a turn end while the tab is shown shows the new port and a plain redraw does not read ports again", async ($, on) => {
    const world = worldOf(on);
    world.lsof = {
      exitCode: 0,
      stdout: `${LSOF_HEADER}\nnode     4242 mark   23u  IPv4 0x1 0t0 TCP *:3000 (LISTEN)`,
    };
    const pane = await openShells($, world);
    expect((await texts(pane)).some((text) => text.includes(":9229"))).toBe(false);
    world.lsof = {
      exitCode: 0,
      stdout: `${LSOF_HEADER}\nnode     4242 mark   23u  IPv4 0x1 0t0 TCP *:3000 (LISTEN)\nnode     4300 mark   25u  IPv4 0x4 0t0 TCP 127.0.0.1:9229 (LISTEN)`,
    };

    await endTurn($, world, []);
    await settle(pane);

    expect((await texts(pane)).some((text) => /:9229\s+node\s+pid 4300/.test(text))).toBe(true);
    const readsAfterTurn = world.lsofRuns;
    await world.clock.advance(FLUSH_MS * 30);
    await settle(pane);
    expect(world.lsofRuns).toBe(readsAfterTurn);
  });

  test("P4 only ports of this session's own processes show: a child of a child does, the session itself and an unrelated process do not", async ($, on) => {
    const world = worldOf(on);
    world.lsof = {
      exitCode: 0,
      stdout: [
        LSOF_HEADER,
        "claude   1000 mark   10u  IPv4 0x1 0t0 TCP *:7000 (LISTEN)",
        "node     4242 mark   23u  IPv4 0x2 0t0 TCP *:3000 (LISTEN)",
        "esbuild  4300 mark   24u  IPv4 0x3 0t0 TCP *:3001 (LISTEN)",
        "postgres 9999 pgsql   5u  IPv4 0x4 0t0 TCP *:5432 (LISTEN)",
      ].join("\n"),
    };

    const pane = await openShells($, world);

    const shown = await texts(pane);
    expect(shown.some((text) => /:3000\s+node\s+pid 4242/.test(text))).toBe(true);
    expect(shown.some((text) => /:3001\s+esbuild\s+pid 4300/.test(text))).toBe(true);
    expect(shown.some((text) => text.includes(":7000"))).toBe(false);
    expect(shown.some((text) => text.includes(":5432"))).toBe(false);
    expect(world.lsofArgv[0]).toEqual(LSOF_ARGV);
    expect(world.psArgv[0]).toEqual(PS_ARGV);
  });

  test("P4b when the process list cannot be read the section says ports unavailable", async ($, on) => {
    const world = worldOf(on);
    world.lsof = {
      exitCode: 0,
      stdout: `${LSOF_HEADER}\nnode     4242 mark   23u  IPv4 0x1 0t0 TCP *:3000 (LISTEN)`,
    };
    world.psFails = true;

    const pane = await openShells($, world);

    const shown = await texts(pane);
    expect(shown).toContain("ports unavailable");
    expect(shown.some((text) => text.includes(":3000"))).toBe(false);
  });

  test("P4c a long process name is shown whole when the row has room", async ($, on) => {
    const world = worldOf(on);
    const name = "very-long-process-name";
    world.lsof = {
      exitCode: 0,
      stdout: `${LSOF_HEADER}\n${name} 4400 mark   23u  IPv4 0x1 0t0 TCP *:4400 (LISTEN)`,
    };

    const pane = await openShells($, world);

    expect(
      (await texts(pane)).some((text) => /:4400\s+very-long-process-name\s+pid 4400/.test(text)),
    ).toBe(true);
  });

  test("P5 port rows line up: process names start in one column and the pid column ends in one column", async ($, on) => {
    const world = worldOf(on);
    world.lsof = {
      exitCode: 0,
      stdout: [
        LSOF_HEADER,
        "nginx    4500 mark    6u  IPv4 0x1 0t0 TCP *:80 (LISTEN)",
        "node     4242 mark   23u  IPv4 0x2 0t0 TCP *:3000 (LISTEN)",
      ].join("\n"),
    };

    const pane = await openShells($, world);

    const rows = await screen(pane);
    const nginx = rows.find((row) => row.includes("nginx")) ?? "";
    const node = rows.find((row) => row.includes("pid 4242")) ?? "";
    expect(nginx.indexOf("nginx")).toBe(node.indexOf("node"));
    expect(nginx.trimEnd().length).toBe(node.trimEnd().length);
    expect(nginx.trimEnd().endsWith("pid 4500")).toBe(true);
  });

  test("P3 when lsof fails the section says ports unavailable", async ($, on) => {
    const world = worldOf(on);
    world.lsof = { exitCode: 1, stdout: "" };

    const pane = await openShells($, world);

    const shown = await texts(pane);
    expect(shown).toContain(PORTS_HEADING);
    expect(shown).toContain("ports unavailable");
  });

  test("P3b when lsof cannot be run the section says ports unavailable", async ($, on) => {
    const world = worldOf(on);
    world.lsof = "throws";

    const pane = await openShells($, world);

    expect(await texts(pane)).toContain("ports unavailable");
  });
});

describe("shells tab live tails and layout", () => {
  test("V1 while a shell runs and the tab is shown, new output appears after a poll and ports are not read again", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, SERVER);
    const pane = await openShells($, world);
    const portReads = world.lsofRuns;
    const processReads = world.psRuns;
    world.outputs.set(SERVER.id, [...SERVER.output, "GET /health 200"]);

    await world.clock.advance(AGENTS_POLL_MS);
    await settle(pane);

    expect(await texts(pane)).toContain("GET /health 200");
    expect(world.lsofRuns).toBe(portReads);
    expect(world.psRuns).toBe(processReads);
  });

  test("V1b the runtime of a running shell grows with the poll", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, SERVER);
    const pane = await openShells($, world);

    await world.clock.advance(RUN_MS);
    await settle(pane);

    const row = (await texts(pane)).find((text) => text.includes(SERVER.command));
    expect(row).toContain(formatDuration(RUN_MS + FLUSH_MS));
  });

  test("V1c with another tab shown the tails are not read", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, SERVER);
    const pane = await openShells($, world);
    await showTab(pane, "Activity");
    const reads = world.tailRuns;

    await world.clock.advance(AGENTS_POLL_MS * POLLS);
    await settle(pane);

    expect(world.tailRuns).toBe(reads);
  });

  test("V1d when no shell runs the tails are not read on a timer", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, SERVER);
    const pane = await openShells($, world);
    await endTurn($, world, []);
    await settle(pane);
    const reads = world.tailRuns;

    await world.clock.advance(AGENTS_POLL_MS * POLLS);
    await settle(pane);

    expect(world.tailRuns).toBe(reads);
  });

  test("V4 the status word and runtime end in one right column across a running, a done and a killed row", async ($, on) => {
    const world = worldOf(on);
    const pane = await threeStates($, world);

    const rows = await screen(pane);
    const running = rows.find((row) => row.includes(SERVER.command)) ?? "";
    const done = rows.find((row) => row.includes(WATCHER.command)) ?? "";
    const killed = rows.find((row) => row.includes(THIRD.command)) ?? "";
    expect(done.trimEnd()).toMatch(/done\s+\S+$/);
    expect(killed.trimEnd()).toMatch(/killed\s+\S+$/);
    expect(running.trimEnd()).toMatch(/\S+$/);
    expect(done.trimEnd().length).toBe(running.trimEnd().length);
    expect(killed.trimEnd().length).toBe(running.trimEnd().length);
    expect(running).not.toContain("…");
  });

  test("V4b a killed shell's mark is muted, not the failed colour", async ($, on) => {
    const world = worldOf(on);
    const pane = await threeStates($, world);

    const mark = await markOf(pane, THIRD.command);

    expect(mark?.props?.color).toBe(paneInk().muted);
  });

  test("V5 running shells come first in start order, then ended ones with the latest ended first", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, SERVER);
    await startShell($, world, WATCHER);
    await startShell($, world, THIRD);
    const pane = await openShells($, world);
    await endTurn($, world, [THIRD.id, WATCHER.id]);
    await world.clock.advance(FLUSH_MS);
    await endTurn($, world, [THIRD.id]);
    await settle(pane);

    const shown = await texts(pane);
    const order = [THIRD, WATCHER, SERVER].map((shell) =>
      shown.findIndex((text) => text.includes(shell.command)),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((left, right) => left - right));
  });

  test("V5b two running shells keep the order they started in", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, SERVER);
    await startShell($, world, WATCHER);

    const pane = await openShells($, world);

    const shown = await texts(pane);
    expect(shown.findIndex((text) => text.includes(SERVER.command))).toBeLessThan(
      shown.findIndex((text) => text.includes(WATCHER.command)),
    );
  });

  test("V6 a summary row under the heading counts running and ended shells and ports", async ($, on) => {
    const world = worldOf(on);
    world.lsof = { exitCode: 0, stdout: `${LSOF_HEADER}\n${NODE_LISTENER}` };
    const pane = await threeStates($, world);

    const shown = await texts(pane);

    expect(shown).toContain("1 running · 2 ended · 1 port");
    expect(shown.indexOf("1 running · 2 ended · 1 port")).toBe(shown.indexOf("Shells") + 1);
  });

  test("V6b a zero count is left out and several ports are plural", async ($, on) => {
    const world = worldOf(on);
    world.lsof = {
      exitCode: 0,
      stdout: `${LSOF_HEADER}\n${NODE_LISTENER}\nesbuild  4300 mark   24u  IPv4 0x3 0t0 TCP *:3001 (LISTEN)`,
    };
    await startShell($, world, SERVER);

    const pane = await openShells($, world);

    expect(await texts(pane)).toContain("1 running · 2 ports");
  });

  test("V6c with no shells at all there is no summary row, only no background shells", async ($, on) => {
    const world = worldOf(on);

    const pane = await openShells($, world);

    const shown = await texts(pane);
    expect(shown).toContain("no background shells");
    expect(shown.some((text) => /\d+ (running|ended)/.test(text))).toBe(false);
  });
});

describe("shells tab status colours", () => {
  test("A9 a failed shell's word is in the failed colour and its command in plain text colour", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, { ...SERVER, output: ["building", FAILED_EXIT] });
    const pane = await openShells($, world);
    await endTurn($, world, []);
    await settle(pane);

    const leaves = await rowLeaves(pane, SERVER.command);

    expect(leafStartingWith(leaves, "failed")?.props?.color).toBe(paneInk().failed);
    expect(leafNamed(leaves, SERVER.command)?.props?.color).toBe(paneInk().text);
  });

  test("A10 a done shell's word is in the ok colour, its command in plain text colour and its run time in muted colour", async ($, on) => {
    const world = worldOf(on);
    const pane = await threeStates($, world);

    const leaves = await rowLeaves(pane, WATCHER.command);

    expect(leafStartingWith(leaves, "done")?.props?.color).toBe(paneInk().ok);
    expect(leafNamed(leaves, WATCHER.command)?.props?.color).toBe(paneInk().text);
    expect(leafEndingInTime(leaves)?.props?.color).toBe(paneInk().muted);
  });

  test("A11 a killed shell's word and run time are in muted colour and its command stays in plain text colour", async ($, on) => {
    const world = worldOf(on);
    const pane = await threeStates($, world);

    const leaves = await rowLeaves(pane, THIRD.command);

    expect(leafStartingWith(leaves, "killed")?.props?.color).toBe(paneInk().muted);
    expect(leafNamed(leaves, THIRD.command)?.props?.color).toBe(paneInk().text);
    expect(leafEndingInTime(leaves)?.props?.color).toBe(paneInk().muted);
  });

  test("A12 a running shell's command stays in plain text colour", async ($, on) => {
    const world = worldOf(on);
    const pane = await threeStates($, world);

    const leaves = await rowLeaves(pane, SERVER.command);

    expect(leafNamed(leaves, SERVER.command)?.props?.color).toBe(paneInk().text);
  });

  test("A13 with one running and two ended shells, the running count is bold text and the ended part is muted", async ($, on) => {
    const world = worldOf(on);
    const pane = await threeStates($, world);

    const leaves = await screenLeaves(pane);

    const running = leafNamed(leaves, SUMMARY_RUNNING);
    expect(running?.props?.weight).toBe("semibold");
    expect(running?.props?.color).toBe(paneInk().text);
    const ended = leafHolding(leaves, SUMMARY_ENDED);
    expect(ended?.props?.color).toBe(paneInk().muted);
    expect(ended?.props?.weight).not.toBe("semibold");
  });

  test("A14 with only ended shells the summary has no bold text", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, WATCHER);
    const pane = await openShells($, world);
    await endTurn($, world, []);
    await settle(pane);

    const ended = leafNamed(await screenLeaves(pane), SUMMARY_ONE_ENDED);

    expect(ended?.props?.color).toBe(paneInk().muted);
    expect(ended?.props?.weight).not.toBe("semibold");
  });
});

describe("shells tab round 2 fixes", () => {
  test("R1 a shell whose last output line says it exited with code 2 shows failed with a red cross", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, { ...SERVER, output: ["building", FAILED_EXIT] });
    const pane = await openShells($, world);
    await endTurn($, world, []);
    await settle(pane);

    const row = (await texts(pane)).find((text) => text.includes(SERVER.command));
    expect(row).toContain("failed");
    expect(row).not.toContain("done");
    expect(await glyphOf(pane, SERVER.command)).toBe("✗");
    expect((await markOf(pane, SERVER.command))?.props?.color).toBe(paneInk().failed);
  });

  test("R1b a shell whose last output line says it exited with code 0 shows done and never failed", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, { ...SERVER, output: ["building", DONE_EXIT] });
    const pane = await openShells($, world);
    await endTurn($, world, []);
    await settle(pane);

    const row = (await texts(pane)).find((text) => text.includes(SERVER.command));
    expect(row).toContain("done");
    expect(row).not.toContain("failed");
  });

  test("R2 a killed shell's mark is a neutral glyph in the muted colour, not a cross", async ($, on) => {
    const world = worldOf(on);
    const pane = await threeStates($, world);

    expect(await glyphOf(pane, THIRD.command)).not.toBe("✗");
    expect(await glyphOf(pane, THIRD.command)).toMatch(/\S/);
    expect((await markOf(pane, THIRD.command))?.props?.color).toBe(paneInk().muted);
  });

  test("R3 an output line that starts with spaces is drawn at the same indent as the other output lines", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, { ...SERVER, output: ["compiled", "    ready on :3000"] });
    const pane = await openShells($, world);

    const rows = await screen(pane);
    const plain = rows.find((row) => row.includes("compiled")) ?? "";
    const indented = rows.find((row) => row.includes("ready on :3000")) ?? "";
    expect(plain).toContain("compiled");
    expect(indented).toContain("ready on :3000");
    expect(indented.indexOf("ready on :3000")).toBe(plain.indexOf("compiled"));
  });

  test("R4 a running command that fits beside its runtime is shown whole while a killed shell is listed", async ($, on) => {
    const world = worldOf(on);
    const pane = await threeStates($, world, { ...SERVER, command: FITTING_COMMAND });

    const row = (await screen(pane)).find((line) => line.includes(RUNNING_MARK)) ?? "";
    expect(row.trimEnd()).toMatch(new RegExp(`${FITTING_COMMAND}\\s+${RUNTIME_TEXT}$`));
  });

  test("R4b a running command too long to fit is cut with the ellipsis right after its last visible character", async ($, on) => {
    const world = worldOf(on);
    const pane = await threeStates($, world, { ...SERVER, command: TICK_COMMAND });

    const row = (await screen(pane)).find((line) => line.includes("tick $i;")) ?? "";
    expect(row.trimEnd()).toMatch(new RegExp(`tick \\$i;…\\s+${RUNTIME_TEXT}$`));
  });
});

describe("shells tab round 3 fixes", () => {
  test("K1 a killed shell shows its last five output lines and no kill end marker", async ($, on) => {
    const world = worldOf(on);
    const ticker = { id: THIRD.id, command: THIRD.command, output: TICK_LINES };
    await startShell($, world, ticker);
    const pane = await openShells($, world);
    await pressShellRow(pane, world, THIRD.command);
    await pressButton(pane, world, KILL);
    world.outputs.set(THIRD.id, [...TICK_LINES, KILLED_END]);
    await pressButton(pane, world, CONFIRM_KILL);
    await settle(pane);

    const shown = await texts(pane);
    expect(shown.filter((text) => /^tick \d$/.test(text))).toEqual(
      TICK_LINES.slice(-SHOWN_OUTPUT_LINES),
    );
    expect(shown.some((text) => text.includes(KILLED_END))).toBe(false);
  });

  test("K1c a killed shell whose file has a blank line before the marker still shows five real output lines", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, { id: THIRD.id, command: THIRD.command, output: TICK_LINES });
    const pane = await openShells($, world);
    await pressShellRow(pane, world, THIRD.command);
    await pressButton(pane, world, KILL);
    world.outputs.set(THIRD.id, [...TICK_LINES, "", KILLED_END]);
    await pressButton(pane, world, CONFIRM_KILL);
    await settle(pane);

    const shown = await texts(pane);
    expect(shown.filter((text) => /^tick \d$/.test(text))).toEqual(
      TICK_LINES.slice(-SHOWN_OUTPUT_LINES),
    );
  });

  test("K1d a failed shell whose file has a blank line before the exit marker still shows five real output lines", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, { ...SERVER, output: [...LONG_OUTPUT, "", FAILED_EXIT] });
    const pane = await openShells($, world);
    await endTurn($, world, []);
    await settle(pane);

    const shown = await texts(pane);
    expect(shown.filter((text) => /^line \d$/.test(text))).toEqual(
      LONG_OUTPUT.slice(-SHOWN_OUTPUT_LINES),
    );
    expect(shown.find((text) => text.includes(SERVER.command))).toContain("failed");
  });

  test("K1b a failed shell does not draw its exit marker and its row still says failed", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, { ...SERVER, output: ["building", FAILED_EXIT] });
    const pane = await openShells($, world);
    await endTurn($, world, []);
    await settle(pane);

    const shown = await texts(pane);
    expect(shown.some((text) => text.includes(FAILED_EXIT))).toBe(false);
    expect(shown.find((text) => text.includes(SERVER.command))).toContain("failed");
  });

  test("K2 a killed shell's mark is a small square in the muted colour", async ($, on) => {
    const world = worldOf(on);
    const pane = await threeStates($, world);

    expect(await glyphOf(pane, THIRD.command)).toBe(KILLED_GLYPH);
    expect((await markOf(pane, THIRD.command))?.props?.color).toBe(paneInk().muted);
  });
});

describe("shells tab task notifications", () => {
  test("N1 a finished background shell stops counting as running mid-turn and keeps its time, while the other shell keeps running", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, SERVER);
    await startShell($, world, WATCHER);
    await world.clock.advance(FINISHED_AFTER_MS);
    await notifyFinished($, SERVER, "completed", `${SERVER.id}-queued`);
    await world.clock.advance(ABSORBED_AFTER_MS - FINISHED_AFTER_MS);
    await notifyFinished($, SERVER, "completed", `${SERVER.id}-absorbed`);
    const pane = await openShells($, world);

    const midTurn = await texts(pane);
    expect(midTurn.some((text) => text.includes(SUMMARY_RUNNING))).toBe(true);
    expect(rowOf(midTurn, SERVER.command)).toContain(formatDuration(FINISHED_AFTER_MS));
    expect(await glyphOf(pane, WATCHER.command)).toBe(RUNNING_MARK);

    await world.clock.advance(TURN_END_MS - ABSORBED_AFTER_MS - FLUSH_MS);
    await endTurn($, world, [WATCHER.id]);
    await settle(pane);

    expect(rowOf(await texts(pane), SERVER.command)).toContain(formatDuration(FINISHED_AFTER_MS));
  });

  test("N2 a shell still alive at the turn end stops running when its failure notification arrives after the turn, with its time running to the notification", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, WATCHER);
    await world.clock.advance(IDLE_TURN_END_MS);
    await endTurn($, world, [WATCHER.id]);
    await world.clock.advance(FAILED_AFTER_MS - IDLE_TURN_END_MS - FLUSH_MS);
    await notifyFinished($, WATCHER, "failed", `${WATCHER.id}-queued`);
    const pane = await openShells($, world);

    const shown = await texts(pane);
    expect(shown.some((text) => text.includes(SUMMARY_RUNNING))).toBe(false);
    expect(rowOf(shown, WATCHER.command)).toContain(formatDuration(FAILED_AFTER_MS));
  });
});

async function rowLeaves(pane: Pane, command: string): Promise<Node[]> {
  const rows = collect(await pane.drawn(), "Box").filter(
    (box) => box.props?.height === 1 && textOf(box).includes(command),
  );
  return leavesIn(rows.at(-1));
}

async function screenLeaves(pane: Pane): Promise<Node[]> {
  return leavesIn(await pane.drawn());
}

describe("shells tab round 5 fixes", () => {
  test("E1a when nothing listens the tab draws no Ports heading and no no-listening-ports row", async ($, on) => {
    const world = worldOf(on);
    world.lsof = { exitCode: 0, stdout: "" };
    await startShell($, world, SERVER);

    const pane = await openShells($, world, NARROW_COLUMNS);

    const shown = await texts(pane);
    expect(shown).not.toContain(PORTS_HEADING);
    expect(shown).not.toContain("no listening ports");
    expect(shown).toContain("1 running");
  });

  test("E1b with no shell and no listening port the tab shows only no background shells", async ($, on) => {
    const world = worldOf(on);
    world.lsof = { exitCode: 0, stdout: "" };

    const pane = await openShells($, world, NARROW_COLUMNS);

    const shown = await texts(pane);
    expect(shown).toContain("no background shells");
    expect(shown).not.toContain(PORTS_HEADING);
    expect(shown).not.toContain("no listening ports");
  });

  test("E1c an ended shell with no listening port leaves no Ports heading and no no-listening-ports row", async ($, on) => {
    const world = worldOf(on);
    world.lsof = { exitCode: 0, stdout: "" };
    await startShell($, world, SERVER);
    const pane = await openShells($, world, NARROW_COLUMNS);
    await endTurn($, world, []);
    await settle(pane);

    const shown = await texts(pane);
    expect(shown).toContain("1 ended");
    expect(shown).not.toContain(PORTS_HEADING);
    expect(shown).not.toContain("no listening ports");
  });

  test("E2a a long command at 60 columns is cut after its last whole word and the :port and time stay whole", async ($, on) => {
    const world = worldOf(on);
    world.lsof = { exitCode: 0, stdout: `${LSOF_HEADER}\n${HANDLER_LISTENER}` };
    await startShell($, world, HANDLER_SHELL);

    const pane = await openShells($, world, NARROW_COLUMNS);

    const rows = await screenAt(pane, NARROW_COLUMNS);
    expect(rowOf(rows, "python3 -c")).toMatch(HANDLER_CUT_ROW);
  });

  test("E2b a long server command is cut after a whole flag value, never inside 127.0.0.1", async ($, on) => {
    const world = worldOf(on);
    world.lsof = { exitCode: 0, stdout: `${LSOF_HEADER}\n${BIND_LISTENER}` };
    await startShell($, world, BIND_SHELL);

    const pane = await openShells($, world, NARROW_COLUMNS);

    const rows = await screenAt(pane, NARROW_COLUMNS);
    expect(rowOf(rows, "python3 -m")).toMatch(BIND_CUT_ROW);
  });

  test("E2c a long command at 120 columns is cut after a whole word too", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, WIDE_SHELL);

    const pane = await openShells($, world, WIDE_COLUMNS);

    const rows = await screenAt(pane, WIDE_COLUMNS);
    expect(rowOf(rows, "node server.js")).toMatch(WIDE_CUT_ROW);
  });

  test("E2d a single first word longer than the space is still cut inside it", async ($, on) => {
    const world = worldOf(on);
    await startShell($, world, { id: "task-1", command: LONG_WORD, output: [] });

    const pane = await openShells($, world, NARROW_COLUMNS);

    const rows = await screenAt(pane, NARROW_COLUMNS);
    expect(rowOf(rows, "abcdefghij")).toMatch(/^ ● abcdefghijk+…\s+\d+s$/);
  });
});

function leavesIn(node: Node | undefined): Node[] {
  if (node === undefined) return [];
  return collect(node, "Text").filter((text) => collect(text, "Text").length === 1);
}

function leafStartingWith(leaves: Node[], word: string): Node | undefined {
  return leaves.find((leaf) => textOf(leaf).trimStart().startsWith(word));
}

function leafNamed(leaves: Node[], text: string): Node | undefined {
  return leaves.find((leaf) => textOf(leaf).trim() === text);
}

function leafHolding(leaves: Node[], text: string): Node | undefined {
  return leaves.find((leaf) => textOf(leaf).includes(text));
}

function leafEndingInTime(leaves: Node[]): Node | undefined {
  return leaves.find((leaf) => TIME_END.test(textOf(leaf).trim()));
}

async function threeStates($: Engine, world: World, running: Shell = SERVER): Promise<Pane> {
  await startShell($, world, running);
  await startShell($, world, WATCHER);
  await startShell($, world, THIRD);
  const pane = await openShells($, world);
  await endTurn($, world, [running.id, THIRD.id]);
  await pressShellRow(pane, world, THIRD.command);
  await pressButton(pane, world, KILL);
  await pressButton(pane, world, CONFIRM_KILL);
  return pane;
}

async function markOf(pane: Pane, command: string) {
  const rows = collect(await pane.drawn(), "Box").filter(
    (box) => box.props?.height === 1 && textOf(box).includes(command),
  );
  const row = rows.at(-1);
  return row === undefined ? undefined : collect(row, "Text")[0];
}

async function glyphOf(pane: Pane, command: string): Promise<string> {
  const mark = await markOf(pane, command);
  return mark === undefined ? "" : textOf(mark).trim();
}

async function screenAt(pane: Pane, columns: number): Promise<string[]> {
  return screenRows(await pane.drawn(), columns).map((row) => row.trimEnd());
}

async function screen(pane: Pane): Promise<string[]> {
  return screenRows(await pane.drawn(), GUTTER_FREE_COLUMNS);
}

async function openShells($: Engine, world: World, columns?: number): Promise<Pane> {
  const pane = await paneOnTab($, LABEL, columns === undefined ? {} : { columns });
  await world.clock.advance(FLUSH_MS);
  await settle(pane);
  return pane;
}

async function startShell(
  $: Engine,
  world: World,
  shell: Shell,
  isPathKnown = true,
): Promise<void> {
  world.outputs.set(shell.id, shell.output ?? []);
  if (isPathKnown) world.hasOutputPath.add(shell.id);
  await ($.tool.call as (e: object) => Promise<unknown>)({
    tool: "Bash",
    command: shell.command,
    run_in_background: true,
    tool_use_id: `use-${shell.id}`,
  });
}

async function endTurn($: Engine, world: World, runningIds: string[]): Promise<void> {
  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: runningIds.map((id) => ({
      id,
      type: "shell",
      status: "running",
      description: id,
    })),
  });
  await world.clock.advance(FLUSH_MS);
}

async function notifyFinished(
  $: Engine,
  shell: Shell,
  status: "completed" | "failed",
  uuid: string,
): Promise<void> {
  const outcome = status === "completed" ? "completed (exit code 0)" : "failed with exit code 144";
  const text = [
    "<task-notification>",
    `<task-id>${shell.id}</task-id>`,
    `<tool-use-id>toolu_${shell.id}</tool-use-id>`,
    `<output-file>${outputPathOf(shell.id)}</output-file>`,
    `<status>${status}</status>`,
    `<summary>Background command "${shell.command}" ${outcome}</summary>`,
    "</task-notification>",
  ].join("");
  await $.session.append({
    message: { type: "user", role: "user", content: [{ type: "text", text }] },
    door: "queue",
    origin: { kind: "engine" },
    uuid,
  });
}

function rowOf(shown: string[], command: string): string | undefined {
  return shown.find((text) => text.includes(command));
}

async function buttonLabels(pane: Pane): Promise<string[]> {
  const buttons = await pane.findAll({ type: "Button" });
  return buttons.map((button) => String(button.props.label));
}

async function pressButton(pane: Pane, world: World, label: string): Promise<void> {
  await pressMatching(pane, world, label, (shown) => shown === label);
}

async function pressShellRow(pane: Pane, world: World, command: string): Promise<void> {
  await pressMatching(pane, world, command, (shown) => shown.includes(command));
}

async function pressMatching(
  pane: Pane,
  world: World,
  what: string,
  isMatch: (label: string) => boolean,
): Promise<void> {
  const buttons = await pane.findAll({ type: "Button" });
  const target = buttons.find((button) => isMatch(String(button.props.label)));
  expect(target, `a button labelled ${what}`).toBeDefined();
  await pane.press({ key: target?.key ?? "" });
  await world.clock.advance(FLUSH_MS);
  await settle(pane);
}

function outputPathOf(id: string): string {
  return `/private/tmp/claude-502/proj/session-one/tasks/${id}.output`;
}

function idOfPath(path: string): string {
  const file = path.split("/").at(-1) ?? "";
  return file.slice(0, file.length - OUTPUT_SUFFIX.length);
}

function worldOf(on: On): World {
  const world: World = {
    clock: mock.clock(on, { now: NOW }),
    outputs: new Map(),
    lsof: { exitCode: 0, stdout: "" },
    lsofRuns: 0,
    lsofArgv: [],
    psRuns: 0,
    psArgv: [],
    tailRuns: 0,
    parents: new Map([
      [1000, 1],
      [4242, 1000],
      [4300, 4242],
      [4400, 1000],
      [4500, 1000],
      [5151, 1000],
      [9999, 1],
    ]),
    psFails: false,
    tailLines: [],
    stops: [],
    refuseStop: false,
    hasOutputPath: new Set(),
  };
  mock.env(on, { HOME: "/h/u" });
  const kept = new Map<string, unknown>();
  on("store.get", (_$, e) => ({ value: kept.get(e.key) }));
  on("store.set", (_$, e) => {
    kept.set(e.key, JSON.parse(JSON.stringify(e.value)));
    return { value: undefined };
  });
  on("session.id", () => ({ value: "session-one" }));
  on("classic.SessionStart", () => ({}));
  on("classic.Stop", () => ({}));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.usage", () => ({
    value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] },
  }));
  on("session.model", () => ({ value: "opus" }));
  on("settings.read", () => ({ value: {} }));
  on("session.cwd", () => ({ value: "/work" }));
  on("agent.list", () => ({ value: [] }));
  on("fs.exists", () => ({ value: true }));
  on("tool.call", (_$, e) => {
    const call = e as unknown as TaskStopCall & {
      tool_use_id: string;
      run_in_background?: boolean;
    };
    if (call.tool === "TaskStop") {
      world.stops.push({ tool: call.tool, task_id: call.task_id, consent: call.consent });
      if (world.refuseStop) return { isError: true, result: "refused", text: "refused" } as never;
      return {
        result: { message: "stopped", task_id: call.task_id, task_type: "shell" },
        text: "stopped",
      };
    }
    if (call.tool === "Bash" && call.run_in_background === true) {
      const id = call.tool_use_id.replace(/^use-/, "");
      const text = world.hasOutputPath.has(id)
        ? `Command running in background with ID: ${id}. Output is being written to: ${outputPathOf(id)}`
        : `Command running in background with ID: ${id}.`;
      return {
        result: { stdout: "", stderr: "", interrupted: false, backgroundTaskId: id },
        text,
      };
    }
    return { result: "ok", text: "ok" };
  });
  on("process.run", (_$, e) => {
    const argv = e.argv;
    if (argv[0] === "tail") {
      const wanted = Number(argv[argv.indexOf("-n") + 1]);
      world.tailLines.push(wanted);
      world.tailRuns += 1;
      const stdout = (world.outputs.get(idOfPath(String(argv.at(-1)))) ?? [])
        .slice(-wanted)
        .join("\n");
      return { value: { exitCode: 0, stdout, stderr: "" } } as never;
    }
    if (argv[0] === "sh") {
      world.psRuns += 1;
      world.psArgv.push([...argv]);
      if (world.psFails)
        return { value: { exitCode: 1, stdout: "", stderr: "ps failed" } } as never;
      const pairs = [...world.parents].map(([pid, parent]) => ` ${pid} ${parent}`);
      return {
        value: { exitCode: 0, stdout: [String(ROOT_PID), ...pairs].join("\n"), stderr: "" },
      } as never;
    }
    if (argv[0] === "lsof") {
      world.lsofRuns += 1;
      world.lsofArgv.push([...argv]);
      if (world.lsof === "throws") throw new Error("lsof: not found");
      return { value: { ...world.lsof, stderr: "" } } as never;
    }
    return { value: { exitCode: 0, stdout: "", stderr: "" } } as never;
  });
  return world;
}
