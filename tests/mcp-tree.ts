import { expect } from "claude-code/testing";
import type { Mounted } from "claude-code/testing";

import { palette } from "../hooks/palette";
import { textOf } from "./draw-tree";
import type { Node } from "./draw-tree";
import { keyOf, linesOf } from "./skills-tree";
import type { Line } from "./skills-tree";

type Pane = Mounted<"terminal", "Pane">;

export type ServerRow = { line: Line; glyph: string; name: string; tools: string; uses: string };

const SETTLE_TICKS = 5;
const SERVER_ROW =
  /^([▸▾])\s*([✔○])\s*(.+?)(?:\s+·\s*\d+ failed)?\s+(\d+ tools?)(?:\s+(?:[\d.]+k? tokens|deferred))?\s+(\d+ uses?)$/u;
export const ANY_SERVER_ROW = /^(?:[▸▾]\s*)?[✔○]/u;
const TOOL_ROW = /^(\S+) (\d+ uses?)$/u;
const SERVER_NAME =
  /^(?:[▸▾]\s*)?[✔○]\s*(.+?)(?:\s+·\s*\d+ failed\b.*|\s+\d+ tools?\b.*|\s+\d+ uses?\b.*|\s+queued.*)?$/u;
const FAILED_TEXT = /(\d+ failed)/u;
const USES_TEXT = /(\d+ uses?)$/u;
const TOKEN_TEXT = /([\d.]+k? tokens)/u;

export function serverEntriesOf(shown: Line[]): [string, string][] {
  return shown.flatMap((line) => {
    const name = SERVER_NAME.exec(line.text)?.[1];
    const mark = /[✔○]/u.exec(line.text)?.[0];
    return name === undefined || mark === undefined ? [] : [[mark, name]];
  });
}

export function summaryOf(
  shown: Line[],
  name: string,
): { glyph: string; tools: string; uses: string } {
  const { glyph, tools, uses } = rowOrFail(shown, name);
  return { glyph, tools, uses };
}

export function rowOrFail(shown: Line[], name: string): ServerRow {
  const row = serverRowOf(shown, name);
  expect(row, `a row like "▸ ✔ ${name} N tools · N uses"`).toBeDefined();
  return row as ServerRow;
}

export function serverRowOf(shown: Line[], name: string): ServerRow | undefined {
  return serverRowsOf(shown).find((row) => row.name === name);
}

export function serverRowsOf(shown: Line[]): ServerRow[] {
  return shown.flatMap((line) => {
    const match = SERVER_ROW.exec(line.text);
    if (match === null) return [];
    return [
      {
        line,
        glyph: match[1] ?? "",
        name: match[3] ?? "",
        tools: match[4] ?? "",
        uses: match[5] ?? "",
      },
    ];
  });
}

export function usesOf(shown: Line[], name: string): string {
  return rowOrFail(shown, name).uses;
}

export function bodyOf(shown: Line[], name: string): Line[] {
  const row = serverRowOf(shown, name);
  return row === undefined ? [] : bodyAfter(shown, row.line);
}

export function bodyAfter(shown: Line[], row: Line): Line[] {
  const rest = shown.slice(shown.indexOf(row) + 1);
  const end = rest.findIndex((line) => line.text === "" || ANY_SERVER_ROW.test(line.text));
  return end === -1 ? rest : rest.slice(0, end);
}

export function toolRowsOf(body: Line[]): { line: Line; name: string; uses: string }[] {
  return body.flatMap((line) => {
    const match = TOOL_ROW.exec(line.text);
    return match === null ? [] : [{ line, name: match[1] ?? "", uses: match[2] ?? "" }];
  });
}

export function partText(part: Node): string {
  return part.type === "Button" ? String(part.props?.label) : textOf(part);
}

export function isDim(part: Node): boolean {
  return part.props?.dimColor === true || part.props?.color === palette.muted;
}

export async function lines(pane: Pane): Promise<Line[]> {
  return linesOf(await pane.drawn());
}

export async function settle(pane: Pane): Promise<void> {
  for (let tick = 0; tick < SETTLE_TICKS; tick++) await pane.redraw();
}

export async function pressNode(pane: Pane, button: Node | undefined): Promise<void> {
  expect(button, "a button to press").toBeDefined();
  await pane.press({ key: keyOf(button) });
  await settle(pane);
}

export async function pressServer(pane: Pane, name: string): Promise<void> {
  const shown = await lines(pane);
  const row = serverRowOf(shown, name)?.line ?? hollowRowOf(shown, name);
  expect(row, `a row like "▸ ✔ ${name} N tools · N uses"`).toBeDefined();
  await pressNode(
    pane,
    row?.parts.find((part) => part.type === "Button" && partText(part).includes(name)),
  );
}

export async function pressAction(pane: Pane, server: string, action: string): Promise<void> {
  const shown = await lines(pane);
  const row = serverRowOf(shown, server)?.line ?? hollowRowOf(shown, server);
  expect(row, `a row for ${server}`).toBeDefined();
  const button = bodyAfter(shown, row as Line)
    .flatMap((line) => line.parts)
    .find((part) => part.type === "Button" && part.props?.label === action);
  await pressNode(pane, button);
}

export function hollowRowOf(shown: Line[], name: string): Line | undefined {
  return shown.find((line) => line.text.includes("○") && line.text.includes(name));
}

export function failedTextOf(line: Line): string | undefined {
  return FAILED_TEXT.exec(line.text)?.[1];
}

export function usesTextOf(line: Line): string | undefined {
  return USES_TEXT.exec(line.text)?.[1];
}

export function tokenTextOf(line: Line): string | undefined {
  return TOKEN_TEXT.exec(line.text)?.[1];
}

export function detailAfter(line: Line, name: string): string {
  return line.text.slice(line.text.indexOf(name) + name.length).trim();
}
