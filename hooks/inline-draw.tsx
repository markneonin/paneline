import type { ElementTable, RenderElement } from "claude-code";

import type { Inline, Run, RunStyle } from "./markdown";
import { runsOf } from "./markdown";
import type { ReplyLook } from "./reply-look";
import type { Styled } from "./text-width";
import { wrapRuns } from "./text-width";

export type OpenPath = (path: string) => void;
export type PathStyle = RunStyle & { path?: string };
export type PathRun = Styled<PathStyle>;
type Piece =
  { node: RenderElement | string; isButton: false } | { node: RenderElement; isButton: true };
type LineLook = { color?: string; weight?: "semibold"; wrap?: "truncate-end" };

const POSITION_SUFFIX = /(?::\d+){1,2}$|#L\d+(?:-L?\d+)?$/;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const PATH_SHAPE = /^[\w.~@+/-]+$/;
const FILE_EXTENSION = /\.([A-Za-z0-9]+)$/;
const KNOWN_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "md",
  "py",
  "sh",
  "yml",
  "yaml",
  "toml",
  "css",
  "html",
  "txt",
  "go",
  "rs",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "java",
  "kt",
  "swift",
  "rb",
  "php",
  "sql",
  "lua",
  "zsh",
  "bash",
  "vue",
  "svelte",
  "scss",
  "less",
  "xml",
  "ini",
  "cfg",
  "conf",
  "env",
  "lock",
  "gradle",
]);
const KNOWN_FILE_NAMES = new Set(["Makefile", "Dockerfile", "LICENSE"]);
const BARE_PATH =
  /(?<![\w./~@+:-])((?:(?:~|\.{1,2})?\/(?:[\w.@+-]+\/)*|(?:[\w.@+-]+\/)+)[\w.@+-]*\.[A-Za-z]\w*)(?::\d+){0,2}(?![\w/@+-])/g;

export function inlineElements(
  ui: ElementTable,
  runs: Run[],
  look: ReplyLook,
  baseColor: string | undefined,
  key: string,
): (RenderElement | string)[] {
  return runs.map((run, i) => runElement(ui, run, look, baseColor, `${key}.${i}`));
}

export function withStyle(inline: Inline[], change: Partial<RunStyle>): Run[] {
  return runsOf(inline).map((run) => ({ text: run.text, style: { ...run.style, ...change } }));
}

export function localPath(target: string): string | null {
  const path = target.replace(POSITION_SUFFIX, "");
  if (path === "" || path.startsWith("#") || URL_SCHEME.test(path) || /\s/.test(path)) return null;
  return path;
}

export function withPaths(runs: Run[], open: OpenPath | undefined): PathRun[] {
  return open === undefined ? runs : runs.flatMap(pathRunsOf);
}

export function hasPath(runs: PathRun[]): boolean {
  return runs.some((run) => run.style.path !== undefined);
}

export function inlinePieces(
  ui: ElementTable,
  runs: PathRun[],
  look: ReplyLook,
  baseColor: string | undefined,
  { key, open, weight }: { key: string; open: OpenPath | undefined; weight?: "semibold" },
): Piece[] {
  const { Button } = ui;
  return runs.map((run, i) => {
    const at = `${key}.${i}`;
    const { path } = run.style;
    if (path === undefined || open === undefined)
      return { node: runElement(ui, run, look, baseColor, at), isButton: false };
    return {
      node: (
        <Button key={at} plain onPress={() => open(path)}>
          {styledText(ui, run, look, baseColor, { key: undefined, weight })}
        </Button>
      ),
      isButton: true,
    };
  });
}

export function plainPiece(node: RenderElement | string): Piece {
  return { node, isButton: false };
}

export function lineOf(
  { Box, Text }: ElementTable,
  pieces: Piece[],
  key: string,
  line: LineLook,
): RenderElement {
  if (!pieces.some((piece) => piece.isButton))
    return (
      <Text key={key} {...line}>
        {pieces.map((piece) => piece.node)}
      </Text>
    );
  const parts: RenderElement[] = [];
  let pending: (RenderElement | string)[] = [];
  const flush = () => {
    if (pending.length === 0) return;
    parts.push(
      <Text key={`${key}.t${parts.length}`} {...line}>
        {pending}
      </Text>,
    );
    pending = [];
  };
  for (const piece of pieces) {
    if (!piece.isButton) {
      pending.push(piece.node);
      continue;
    }
    flush();
    parts.push(piece.node);
  }
  flush();
  return (
    <Box key={key} flexDirection="row">
      {parts}
    </Box>
  );
}

export type RowPress = () => void;

export function flowOf(
  ui: ElementTable,
  runs: Run[],
  look: ReplyLook,
  flow: {
    key: string;
    width: number;
    color: string | undefined;
    open: OpenPath | undefined;
    hang?: number;
    slashBreaks?: boolean;
    press?: RowPress;
  },
): RenderElement {
  const { key, width, color, open, hang, slashBreaks, press } = flow;
  const pathRuns = withPaths(runs, open);
  if (hang !== undefined) {
    return hangingFlow(ui, pathRuns, look, { key, width, color, open, hang, slashBreaks, press });
  }
  if (!slashBreaks && !hasPath(pathRuns) && !hasLineBreak(pathRuns))
    return lineOf(ui, inlinePieces(ui, pathRuns, look, color, flow), key, { color });
  const { Box } = ui;
  return (
    <Box key={key} flexDirection="column">
      {wrapRuns(pathRuns, width, {
        isLongWordContinuing: true,
        isBreakingAfterSlash: slashBreaks,
      }).map((row, i) =>
        lineOf(
          ui,
          inlinePieces(ui, row, look, color, { key: `${key}.${i}`, open }),
          `${key}.${i}`,
          {
            color,
          },
        ),
      )}
    </Box>
  );
}

function hangingFlow(
  ui: ElementTable,
  runs: PathRun[],
  look: ReplyLook,
  flow: {
    key: string;
    width: number;
    color: string | undefined;
    open: OpenPath | undefined;
    hang: number;
    slashBreaks: boolean | undefined;
    press: RowPress | undefined;
  },
): RenderElement {
  const { Box, Button } = ui;
  const { key, width, color, open, hang, slashBreaks, press } = flow;
  return (
    <Box key={key} flexDirection="column">
      {sourceLinesOf(runs).flatMap((line, i) =>
        wrapRuns(line, width - hang, hangingWrap(slashBreaks)).map((row, j) => {
          const rowKey = `${key}.${i}.${j}`;
          const indent: Piece[] = j === 0 ? [] : [plainPiece(" ".repeat(hang))];
          const line = lineOf(
            ui,
            [...indent, ...inlinePieces(ui, row, look, color, { key: rowKey, open })],
            rowKey,
            { color },
          );
          return press === undefined ? (
            line
          ) : (
            <Button
              key={`${rowKey}.press`}
              label={row.map((run) => run.text).join("")}
              plain
              dimColor={false}
              onPress={press}
            >
              {line}
            </Button>
          );
        }),
      )}
    </Box>
  );
}

function hangingWrap(slashBreaks: boolean | undefined): {
  isLongWordContinuing: true;
  isBreakingAfterSlash: boolean | undefined;
} {
  return { isLongWordContinuing: true, isBreakingAfterSlash: slashBreaks };
}

export function hangingRowCount(runs: Run[], width: number, hang: number): number {
  return sourceLinesOf(runs).reduce(
    (sum, line) => sum + wrapRuns(line, width - hang, hangingWrap(true)).length,
    0,
  );
}

function sourceLinesOf<T extends Run>(runs: T[]): T[][] {
  const lines: T[][] = [[]];
  for (const run of runs) {
    run.text.split("\n").forEach((text, i) => {
      if (i > 0) lines.push([]);
      if (text !== "") lines.at(-1)?.push({ ...run, text });
    });
  }
  return lines;
}

function hasLineBreak(runs: Run[]): boolean {
  return runs.some((run) => run.text.includes("\n"));
}

function pathRunsOf(run: Run): PathRun[] {
  const { style, text } = run;
  if (style.href !== undefined) return withPath(run, localPath(style.href));
  if (style.code) return withPath(run, codePath(text));
  return bareRunsOf(run);
}

function withPath(run: Run, path: string | null): PathRun[] {
  return [path === null ? run : { text: run.text, style: { ...run.style, path } }];
}

function codePath(text: string): string | null {
  const path = localPath(text);
  if (path === null || !PATH_SHAPE.test(path) || !/\w/.test(path)) return null;
  const extension = FILE_EXTENSION.exec(path)?.[1];
  const isKnownFile =
    (extension !== undefined && KNOWN_EXTENSIONS.has(extension)) || KNOWN_FILE_NAMES.has(path);
  return path.includes("/") || isKnownFile ? path : null;
}

function bareRunsOf(run: Run): PathRun[] {
  const pieces: PathRun[] = [];
  let end = 0;
  for (const match of run.text.matchAll(BARE_PATH)) {
    if (match.index > end)
      pieces.push({ text: run.text.slice(end, match.index), style: run.style });
    pieces.push({ text: match[0], style: { ...run.style, path: match[1] } });
    end = match.index + match[0].length;
  }
  if (pieces.length === 0) return [run];
  if (end < run.text.length) pieces.push({ text: run.text.slice(end), style: run.style });
  return pieces;
}

function runElement(
  ui: ElementTable,
  run: PathRun,
  look: ReplyLook,
  baseColor: string | undefined,
  key: string,
): RenderElement | string {
  const { style } = run;
  const { Link } = ui;
  if (isPlain(style)) return run.text;
  const drawn = styledText(ui, run, look, baseColor, {
    key: style.href === undefined ? key : undefined,
  });
  if (style.href === undefined) return drawn;
  return (
    <Link key={key} href={style.href}>
      {drawn}
    </Link>
  );
}

function styledText(
  { Text }: ElementTable,
  { text, style }: PathRun,
  look: ReplyLook,
  baseColor: string | undefined,
  { key, weight }: { key: string | undefined; weight?: "semibold" },
): RenderElement {
  return (
    <Text
      key={key}
      weight={style.strong ? "semibold" : weight}
      italic={style.emphasis}
      strikethrough={style.strike}
      underline={style.href !== undefined}
      color={colorOf(style, look, baseColor)}
    >
      {text}
    </Text>
  );
}

function colorOf(
  style: RunStyle,
  look: ReplyLook,
  baseColor: string | undefined,
): string | undefined {
  if (style.code) return look.code;
  if (style.href !== undefined) return look.link;
  if (style.strike) return look.muted;
  if (style.strong) return look.strong;
  return baseColor;
}

function isPlain(style: PathStyle): boolean {
  return (
    !style.strong && !style.emphasis && !style.strike && !style.code && style.href === undefined
  );
}
