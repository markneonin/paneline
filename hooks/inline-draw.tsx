import type { ElementTable, RenderElement } from "claude-code";

import type { Inline, Run, RunStyle } from "./markdown";
import { runsOf } from "./markdown";
import type { ReplyLook } from "./reply-look";

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

function runElement(
  { Link, Text }: ElementTable,
  { text, style }: Run,
  look: ReplyLook,
  baseColor: string | undefined,
  key: string,
): RenderElement | string {
  if (isPlain(style)) return text;
  const drawn = (
    <Text
      key={style.href === undefined ? key : undefined}
      weight={style.strong ? "semibold" : undefined}
      italic={style.emphasis}
      strikethrough={style.strike}
      underline={style.href !== undefined}
      color={colorOf(style, look, baseColor)}
    >
      {text}
    </Text>
  );
  if (style.href === undefined) return drawn;
  return (
    <Link key={key} href={style.href}>
      {drawn}
    </Link>
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

function isPlain(style: RunStyle): boolean {
  return (
    !style.strong && !style.emphasis && !style.strike && !style.code && style.href === undefined
  );
}
