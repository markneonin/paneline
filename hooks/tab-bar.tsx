import type { ElementTable, RenderElement } from "claude-code";

import { paneInk } from "./pane-ink";
import { ENGINE_DEFAULT_GREY } from "./session-color";

export type TabEntry = { id: string; label: string };

export const TAB_BAR_ROWS = 2;

const ACTIVE_TAB_TEXT = "clawd_background";
const TAB_GAP = 1;

type TabWindow = { first: number; last: number; hasLeft: boolean; hasRight: boolean };

const NO_TABS_WINDOW: TabWindow = { first: 0, last: -1, hasLeft: false, hasRight: false };

const LEFT_ARROW_INDENT = 1;
const arrowCells = (hidden: number): number =>
  hidden === 0 ? 0 : 1 + String(hidden).length + TAB_GAP;
const leftArrowCells = (hidden: number): number =>
  hidden === 0 ? 0 : LEFT_ARROW_INDENT + arrowCells(hidden);

export function tabPages(labels: string[], width: number): TabWindow[] {
  const cost = (first: number, last: number): number =>
    labels.slice(first, last + 1).reduce((sum, label) => sum + label.length, 0) +
    (last - first) * TAB_GAP +
    leftArrowCells(first) +
    arrowCells(labels.length - 1 - last);
  const pages: TabWindow[] = [];
  let first = 0;
  while (first < labels.length) {
    let last = first;
    while (last + 1 < labels.length && cost(first, last + 1) <= width) last++;
    pages.push({ first, last, hasLeft: first > 0, hasRight: last < labels.length - 1 });
    first = last + 1;
  }
  return pages;
}

export function fitTabs(labels: string[], active: number, width: number): TabWindow {
  const pages = tabPages(labels, width);
  return pages.find(({ last }) => active <= last) ?? NO_TABS_WINDOW;
}

export function tabBar(
  { Box, Button, Text }: ElementTable,
  tabs: TabEntry[],
  active: string,
  showTab: (tab: string) => void,
  width: number,
  accent: string,
): RenderElement {
  const labels = tabs.map(({ label }) => ` ${label} `);
  const activeIndex = tabs.findIndex(({ id }) => id === active);
  const pages = tabPages(labels, width);
  const view = fitTabs(labels, activeIndex, width);
  const viewIndex = pages.findIndex(({ first }) => first === view.first);
  const isDefaultAccent = accent === ENGINE_DEFAULT_GREY;
  const activeFill = isDefaultAccent ? paneInk().tabFill : accent;
  const activeText = isDefaultAccent ? paneInk().tabText : ACTIVE_TAB_TEXT;
  const arrow = (key: string, text: string, offset: number): RenderElement => (
    <Button
      key={key}
      label={text}
      plain
      dimColor
      onPress={() => {
        const target = tabs[pages[viewIndex + offset]?.first ?? -1];
        if (target) showTab(target.id);
      }}
    />
  );
  return (
    <Box flexDirection="column" width={width}>
      <Box
        flexDirection="row"
        columnGap={TAB_GAP}
        paddingLeft={view.hasLeft ? LEFT_ARROW_INDENT : 0}
        width={width}
        height={1}
        overflow="hidden"
      >
        {view.hasLeft ? arrow("tab-left", `‹${view.first}`, -1) : null}
        {tabs.slice(view.first, view.last + 1).map(({ id, label }) => {
          const key = `tab-${id}`;
          if (id === active) {
            return (
              <Box key={key} flexDirection="row" flexShrink={0}>
                <Text color={activeText} backgroundColor={activeFill} wrap="truncate-end">
                  {" "}
                </Text>
                <Text
                  weight="semibold"
                  color={activeText}
                  backgroundColor={activeFill}
                  wrap="truncate-end"
                >
                  {label}
                </Text>
                <Text color={activeText} backgroundColor={activeFill} wrap="truncate-end">
                  {" "}
                </Text>
              </Box>
            );
          }
          return (
            <Box key={key} flexDirection="row" flexShrink={0}>
              <Text color={paneInk().muted} wrap="truncate-end">
                {" "}
              </Text>
              <Button label={label} plain dimColor onPress={() => showTab(id)} />
              <Text color={paneInk().muted} wrap="truncate-end">
                {" "}
              </Text>
            </Box>
          );
        })}
        {view.hasRight ? arrow("tab-right", `${tabs.length - 1 - view.last}›`, 1) : null}
      </Box>
      <Box height={1} />
    </Box>
  );
}
