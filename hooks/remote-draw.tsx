import type { ElementTable, RenderElement } from "claude-code";

import type { RemoteCi, RemoteRepo, RemoteReview } from "../types";
import { paneInk } from "./pane-ink";
import { header, paneHeaderLook, plural } from "./pane-kit";
import type { Part } from "./pane-kit";
import { folderName, shortLabels } from "./paths";
import { clipEnd, clipStart, displayWidth } from "./text-width";

type Ui = ElementTable;
const ROW_GAPS = 3;
const NAME_GAP = 1;
const COUNTS_SYMBOL_CELLS = 3;
const MIN_BRANCH_CELLS = 4;

type TrackedRepo = RemoteRepo & { ahead: number; behind: number };

type Columns = {
  name: number | null;
  branch: number;
  counts: number;
  aheadDigits: number;
  behindDigits: number;
};

export function remoteBlock(
  ui: Ui,
  remote: Record<string, RemoteRepo>,
  width: number,
): RenderElement | null {
  const { Box } = ui;
  const entries = Object.entries(remote).filter((entry): entry is [string, TrackedRepo] =>
    isTracked(entry[1]),
  );
  if (entries.length === 0) return null;
  const names =
    entries.length > 1
      ? shortLabels(entries.map(([root]) => root)).map((label) => `${label}/`)
      : null;
  const columns = columnsOf(
    entries.map(([, repo]) => repo),
    names,
    width,
  );
  return (
    <Box flexDirection="column">
      {header(ui, "Remote", paneHeaderLook(), width)}
      {entries.map(([root, repo], i) =>
        remoteRow(ui, { root, repo, name: names?.[i] ?? null }, columns, width),
      )}
      <Box height={1} />
    </Box>
  );
}

function isTracked(repo: RemoteRepo): repo is TrackedRepo {
  return repo.ahead !== null && repo.behind !== null;
}

function countsText(repo: TrackedRepo, aheadDigits: number, behindDigits: number): string {
  return `↑${String(repo.ahead).padStart(aheadDigits)} ↓${String(repo.behind).padStart(behindDigits)}`;
}

function digitsOf(counts: number[]): number {
  return Math.max(...counts.map((count) => String(count).length));
}

function reviewCells(repo: RemoteRepo): number {
  return displayWidth(
    reviewParts(repo)
      .map((part) => part.text)
      .join(""),
  );
}

function tailCells(names: string[]): number {
  return Math.max(0, ...names.map((name) => 1 + displayWidth(`${folderName(name.slice(0, -1))}/`)));
}

function columnsOf(repos: TrackedRepo[], names: string[] | null, width: number): Columns {
  const aheadDigits = digitsOf(repos.map((repo) => repo.ahead));
  const behindDigits = digitsOf(repos.map((repo) => repo.behind));
  const counts = COUNTS_SYMBOL_CELLS + aheadDigits + behindDigits;
  const review = Math.max(...repos.map(reviewCells));
  const longestBranch = Math.max(...repos.map((repo) => displayWidth(repo.branch)));
  const longestName = Math.max(0, ...(names ?? []).map(displayWidth));
  const nameGap = names === null ? 0 : NAME_GAP;
  const fixed = counts + review + ROW_GAPS + nameGap;
  const branch = Math.max(
    MIN_BRANCH_CELLS,
    Math.min(longestBranch, width - fixed - Math.min(longestName, tailCells(names ?? []))),
  );
  const nameRoom = Math.max(0, width - branch - fixed);
  return {
    counts,
    aheadDigits,
    behindDigits,
    branch,
    name: names === null ? null : Math.min(longestName, nameRoom),
  };
}

type RowSource = { root: string; repo: TrackedRepo; name: string | null };

function remoteRow(
  ui: Ui,
  { root, repo, name }: RowSource,
  columns: Columns,
  width: number,
): RenderElement {
  const { Box, Text } = ui;
  return (
    <Box key={root} flexDirection="row" width={width} height={1}>
      {name === null || columns.name === null ? null : (
        <Box flexShrink={0} width={columns.name + NAME_GAP}>
          <Text dimColor wrap="truncate-end">
            {`${clipStart(name, columns.name).padEnd(columns.name)} `}
          </Text>
        </Box>
      )}
      <Box flexDirection="row" flexGrow={1} columnGap={1}>
        <Box flexShrink={0} width={columns.branch}>
          <Text color={paneInk().text} wrap="truncate-end">
            {clipEnd(repo.branch, columns.branch)}
          </Text>
        </Box>
        <Box flexShrink={0} width={columns.counts}>
          <Text color={paneInk().muted} wrap="truncate-end">
            {countsText(repo, columns.aheadDigits, columns.behindDigits)}
          </Text>
        </Box>
        <Box flexGrow={1} />
        <Box flexShrink={0}>
          <Text wrap="truncate-end">
            {reviewParts(repo).map((part) => (
              <Text key={part.text} color={part.color} wrap="truncate-end">
                {part.text}
              </Text>
            ))}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

function reviewParts(repo: RemoteRepo): Part[] {
  if (repo.review === undefined) return [];
  if (repo.review === null) return [noReviewPart()];
  return [
    { text: reviewLabel(repo.review), color: paneInk().text },
    ...ciParts(repo.review.ci),
    ...threadParts(repo.review.threads),
  ];
}

function noReviewPart(): Part {
  return { text: "no PR/MR", color: paneInk().muted };
}

function reviewLabel(review: RemoteReview): string {
  return review.kind === "PR" ? `PR #${review.number}` : `MR !${review.number}`;
}

function ciParts(ci: RemoteCi): Part[] {
  if (ci === "none") return [];
  return [
    { text: " · CI ", color: paneInk().muted },
    { text: ci, color: ciColor(ci) },
  ];
}

function ciColor(ci: Exclude<RemoteCi, "none">): string {
  const ink = paneInk();
  const colors = { pass: ink.ok, fail: ink.failed, pending: ink.alert };
  return colors[ci];
}

function threadParts(threads: number): Part[] {
  if (threads === 0) return [];
  return [{ text: ` · ${threads} ${plural("thread", threads)}`, color: paneInk().muted }];
}
