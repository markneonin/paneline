import { clipEnd, clipStart, displayWidth } from "./text-width";

export function isInside(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

export function folderName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function relativePath(path: string, cwd: string): string {
  const root = trimmedRoot(cwd);
  return root !== "" && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

export function tildePath(path: string, home: string | undefined): string {
  const root = trimmedRoot(home ?? "");
  return root !== "" && isInside(path, root) ? `~${path.slice(root.length)}` : path;
}

export function groupLabel(path: string, home: string | undefined): string {
  const shown = tildePath(path, home);
  return shown.endsWith("/") ? shown : `${shown}/`;
}

export function shortLabels(paths: string[]): string[] {
  const parts = paths.map((path) =>
    trimmedRoot(path)
      .split("/")
      .filter((part) => part !== ""),
  );
  const depths = parts.map(() => 1);
  const labels = (): string[] => parts.map((folders, i) => folders.slice(-depths[i]!).join("/"));
  for (;;) {
    const current = labels();
    const unresolved = current.flatMap((label, i) =>
      current.indexOf(label) !== current.lastIndexOf(label) && depths[i]! < parts[i]!.length
        ? [i]
        : [],
    );
    if (unresolved.length === 0) return current;
    for (const i of unresolved) depths[i] = depths[i]! + 1;
  }
}

function trimmedRoot(path: string): string {
  return path.replace(/\/+$/, "");
}

export const MIN_LABEL_CELLS = 16;

export const MIN_BRANCH_CELLS = 4;

const WORD_EDGE = /[-_./ ]/;

export function middleCut(text: string, cells: number): string {
  if (displayWidth(text) <= cells) return text;
  const startKeep = Math.ceil((cells - 1) / 2);
  const start = wholeWordsStart(clipEnd(text, startKeep + 1).slice(0, -1));
  const endKeep = cells - 1 - displayWidth(start);
  return `${start}…${wholeWordsEnd(text, clipStart(text, endKeep + 1).slice(1))}`;
}

function wholeWordsStart(kept: string): string {
  const edge = [...kept].findLastIndex((char) => WORD_EDGE.test(char));
  return edge < 0 ? kept : kept.slice(0, edge + 1);
}

function wholeWordsEnd(text: string, kept: string): string {
  if (WORD_EDGE.test(text.charAt(text.length - kept.length - 1))) return kept;
  const edge = [...kept].slice(0, -1).findIndex((char) => WORD_EDGE.test(char));
  return edge < 0 ? kept : kept.slice(edge + 1);
}

export function fitPair(
  first: string,
  second: string,
  cells: number,
): { first: string; second: string } {
  const firstCells = displayWidth(first);
  const secondCells = displayWidth(second);
  if (firstCells + secondCells <= cells) return { first, second };
  const firstShare = Math.min(
    firstCells,
    Math.max(MIN_LABEL_CELLS, Math.floor(cells / 2), cells - secondCells),
  );
  if (cells - firstShare < MIN_BRANCH_CELLS) return { first: middleCut(first, cells), second: "" };
  const shownFirst = middleCut(first, firstShare);
  return { first: shownFirst, second: middleCut(second, cells - displayWidth(shownFirst)) };
}

export function clipPathStart(path: string, cells: number): string {
  if (displayWidth(path) <= cells) return path;
  const names = path.split("/").slice(1);
  const tails = names.map((name, i) => `/${names.slice(i).join("/")}`);
  const tail = tails.find((candidate) => displayWidth(candidate) < cells);
  return tail === undefined ? clipStart(path, cells) : `…${tail}`;
}

export function squeezedPath(head: string, rest: string, cells: number): string {
  const folders = rest.split("/");
  const name = folders.pop() ?? "";
  const minHeadCells = Math.min(displayWidth(head), MIN_LABEL_CELLS);
  for (let kept = folders.length; kept >= 0; kept--) {
    const middle =
      kept === folders.length ? folders : ["…", ...folders.slice(folders.length - kept)];
    const tail = [...middle, name].join("/");
    const headCells = cells - displayWidth(tail) - 1;
    if (headCells >= minHeadCells) return `${middleCut(head, headCells)}/${tail}`;
  }
  return clipStart([head, name].join("/"), cells);
}
