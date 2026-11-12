import { atom, read, update } from "claude-code";
import type { EngineInterface } from "claude-code";

import { palette } from "./palette";
import { isShownTab } from "./shown-tab";

export const PANE = "session";
export const PANE_OPEN = {
  id: PANE,
  title: "Session",
  closeOnEscape: true,
  backgroundColor: palette.panel,
} as const;

const bodyOffsetAtom = atom({ plugin: "paneline", key: "bodyOffset" } as const, 0);
const listOffsetsAtom = atom(
  { plugin: "paneline", key: "listOffsets" } as const,
  {} as Record<string, number>,
);

export async function enterDetail($: EngineInterface, tab: string): Promise<void> {
  const [saved, offset] = await Promise.all([read($, listOffsetsAtom), read($, bodyOffsetAtom)]);
  if (!(tab in saved))
    await update($, listOffsetsAtom, (current) => ({
      ...current,
      [tab]: isShownTab(tab) ? offset : 0,
    }));
  await update($, bodyOffsetAtom, () => 0);
}

export async function leaveDetail($: EngineInterface, tab: string): Promise<void> {
  const saved = await read($, listOffsetsAtom);
  await update($, bodyOffsetAtom, () => saved[tab] ?? 0);
  await forgetDetail($, tab);
}

export async function forgetDetail($: EngineInterface, tab: string): Promise<void> {
  await update($, listOffsetsAtom, ({ [tab]: _left, ...rest }) => rest);
}

export async function keepPane($: EngineInterface): Promise<{ value: undefined }> {
  await $.ui.open({ ...PANE_OPEN, focus: true }).catch(() => undefined);
  return { value: undefined };
}
