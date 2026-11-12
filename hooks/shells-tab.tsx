import { atom, read, update } from "claude-code";
import type { EngineInterface, On } from "claude-code";

import type { ListeningPort, Shell, ShellOpen } from "../types";
import { PANE } from "./pane-tab";
import { isShownTab, justEntered } from "./shown-tab";
import { POLL_MS } from "./agents-track";
import { shellsTab } from "./shells-draw";
import { endedShells, isStopped } from "./shells-track";
import { singleFlight } from "./single-flight";

export const SHELLS_TAB = { id: "shells", label: "Shells" };

const TAIL_READ_LINES = 8;
const ESCAPED_BYTE = /\\x([0-9a-f]{2})/gi;
const LISTEN_LINE = /^(\S+)\s+(\d+)\s.*:(\d+) \(LISTEN\)$/;

const shellsAtom = atom({ plugin: "paneline", key: "shells" } as const, [] as Shell[]);
const checkedAtAtom = atom({ plugin: "paneline", key: "shellsCheckedAt" } as const, 0);
const tailsAtom = atom(
  { plugin: "paneline", key: "shellsTails" } as const,
  {} as Record<string, string[]>,
);
const openAtom = atom({ plugin: "paneline", key: "shellOpen" } as const, null as ShellOpen | null);
const portsAtom = atom(
  { plugin: "paneline", key: "shellsPorts" } as const,
  null as ListeningPort[] | null,
);

const flight = singleFlight();

let refreshedKey: string | null = null;

let poller: { cancel: () => void } | undefined;

const tailedAfterEnd = new Set<string>();

export function registerShellsTab(on: On): void {
  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e, next) => {
    if (!isShownTab(SHELLS_TAB.id)) {
      stopPolling();
      return next(e);
    }
    const [shells, checkedAt, tails, open, ports, now] = await Promise.all([
      read($, shellsAtom),
      read($, checkedAtAtom),
      read($, tailsAtom),
      read($, openAtom),
      read($, portsAtom),
      $.clock.now(),
    ]);
    const key = [checkedAt, ...shells.map((shell) => `${shell.id}:${shell.status}`)].join(",");
    if (shells.some((shell) => shell.status === "running"))
      poller ??= $.clock.every(POLL_MS, () => void pollTails($));
    else stopPolling();
    if (justEntered(SHELLS_TAB.id)) refreshedKey = null;
    if (key !== refreshedKey)
      $.clock.after(
        0,
        () =>
          void flight("shells", () => {
            refreshedKey = key;
            return refresh($);
          }),
      );
    return shellsTab($.ui.resolve(e), {
      shells,
      tails,
      open,
      ports,
      now,
      width: e.props.bodyColumns,
      toggle: (id) =>
        void update($, openAtom, (current) =>
          current?.id === id ? null : { id, isConfirming: false },
        ),
      askKill: (id) => void update($, openAtom, () => ({ id, isConfirming: true })),
      confirmKill: (id) => void kill($, id),
    });
  });
}

function stopPolling(): void {
  poller?.cancel();
  poller = undefined;
}

async function pollTails($: EngineInterface): Promise<void> {
  const shells = await read($, shellsAtom);
  if (!isShownTab(SHELLS_TAB.id) || !shells.some((shell) => shell.status === "running")) {
    stopPolling();
    return;
  }
  await flight("tails", () => refreshTails($));
}

async function refresh($: EngineInterface): Promise<void> {
  await Promise.all([refreshTails($), refreshPorts($)]);
}

async function refreshTails($: EngineInterface): Promise<void> {
  const shells = await read($, shellsAtom);
  const unread = shells.filter(
    (shell) => shell.outputPath !== undefined && !tailedAfterEnd.has(shell.id),
  );
  const entries = await Promise.all(unread.map((shell) => tailOf($, shell)));
  unread
    .filter((shell) => shell.status !== "running")
    .forEach((shell) => tailedAfterEnd.add(shell.id));
  await update($, tailsAtom, (known) => ({ ...known, ...Object.fromEntries(entries) }));
}

async function tailOf(
  $: EngineInterface,
  { id, outputPath }: Shell,
): Promise<readonly [string, string[]]> {
  try {
    const { exitCode, stdout } = await $.process.run([
      "tail",
      "-n",
      String(TAIL_READ_LINES),
      "--",
      String(outputPath),
    ]);
    return [id, exitCode === 0 ? stdout.split("\n").filter((line) => line.trim() !== "") : []];
  } catch (error) {
    $.ui.log(`tail failed: ${String(error)}`, { to: "debug" });
    return [id, []];
  }
}

async function refreshPorts($: EngineInterface): Promise<void> {
  const ports = await listeningPorts($);
  await update($, portsAtom, () => ports);
}

async function listeningPorts($: EngineInterface): Promise<ListeningPort[] | null> {
  try {
    const [listed, tree] = await Promise.all([
      $.process.run(["lsof", "-nP", "+c", "0", "-iTCP", "-sTCP:LISTEN"]),
      $.process.run(["sh", "-c", "echo $PPID; ps -A -o pid=,ppid="]),
    ]);
    if (tree.exitCode !== 0 || (listed.exitCode !== 0 && listed.stdout.trim() === "")) return null;
    return ownPorts(portsOf(listed.stdout), tree.stdout);
  } catch (error) {
    $.ui.log(`ports failed: ${String(error)}`, { to: "debug" });
    return null;
  }
}

function ownPorts(ports: ListeningPort[], processTable: string): ListeningPort[] {
  const [rootLine = "", ...rows] = processTable.split("\n");
  const root = Number(rootLine.trim());
  const parents = new Map(
    rows.flatMap((row) => {
      const [pid, parent] = row.trim().split(/\s+/).map(Number);
      return pid === undefined || parent === undefined ? [] : [[pid, parent] as const];
    }),
  );
  return ports.filter((entry) => isBelow(parents, entry.pid, root));
}

function isBelow(parents: Map<number, number>, pid: number, root: number): boolean {
  const seen = new Set<number>();
  for (let at = parents.get(pid); at !== undefined && !seen.has(at); at = parents.get(at)) {
    if (at === root) return true;
    seen.add(at);
  }
  return false;
}

function portsOf(output: string): ListeningPort[] {
  const found = new Map<string, ListeningPort>();
  for (const line of output.split("\n")) {
    const [, command, pid, port] = LISTEN_LINE.exec(line.trim()) ?? [];
    if (command === undefined || pid === undefined || port === undefined) continue;
    found.set(`${port}:${pid}`, {
      port: Number(port),
      command: unescaped(command),
      pid: Number(pid),
    });
  }
  return [...found.values()].sort((a, b) => a.port - b.port);
}

function unescaped(command: string): string {
  return command.replace(ESCAPED_BYTE, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

async function kill($: EngineInterface, id: string): Promise<void> {
  await update($, openAtom, () => null);
  try {
    const ran = await $.tool.call({
      tool: "TaskStop",
      task_id: id,
      consent: `The user pressed "confirm kill" on shell ${id} in the Shells tab`,
    });
    if (!isStopped(ran)) return;
    const endedAt = await $.clock.now();
    await update($, shellsAtom, (shells) =>
      endedShells(shells, (shell) => shell.id === id, "killed", endedAt),
    );
  } catch (error) {
    $.ui.log(`kill failed: ${String(error)}`, { to: "debug" });
  }
}
