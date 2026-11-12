import { memo } from "./memo";
import type { Accent } from "./pane-kit";
import { palette } from "./palette";
import { themeFills } from "./palette";
import type { Fills } from "./palette";
import { ENGINE_DEFAULT_GREY } from "./session-color";

export type ReplyLook = {
  accent: string;
  strong: string;
  text: string;
  prose: string | undefined;
  onBand: string | undefined;
  muted: string;
  rule: string;
  code: string;
  link: string;
  alert: Record<"note" | "tip" | "important" | "warning" | "caution", string>;
  hues: readonly string[];
  band: string;
  body: string;
  added: string;
  removed: string;
  addedBand: string;
  removedBand: string;
};

const LOOK_CACHE_LIMIT = 16;

const looks = memo<ReplyLook>(LOOK_CACHE_LIMIT);

export function replyLook(accent: Accent, fills: Fills = themeFills): ReplyLook {
  const resolved = accent ?? ENGINE_DEFAULT_GREY;
  return looks(`${resolved}|${fills.source}`, () => buildLook(resolved, fills));
}

export function resolvedAccent(accent: Accent, fills: Fills = themeFills): string {
  return replyLook(accent, fills).accent;
}

function buildLook(accent: string, fills: Fills): ReplyLook {
  const isDefault = accent === ENGINE_DEFAULT_GREY;
  return {
    accent: isDefault ? (fills.defaultAccent ?? ENGINE_DEFAULT_GREY) : accent,
    strong: isDefault ? palette.userText : accent,
    text: palette.text,
    prose: fills.prose,
    onBand: fills.onBand,
    muted: palette.muted,
    rule: palette.rule,
    code: fills.code,
    link: fills.identifier,
    alert: {
      note: fills.identifier,
      tip: fills.ok,
      important: fills.keyword,
      warning: fills.alert,
      caution: fills.failed,
    },
    hues: fills.hues,
    band: fills.userBand,
    body: fills.panel,
    added: fills.ok,
    removed: fills.failed,
    addedBand: fills.addedBand,
    removedBand: fills.removedBand,
  };
}
