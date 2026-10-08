import { atom, read, update } from "claude-code";
import type { EngineInterface, On } from "claude-code";

import { failureText } from "./command-failure";
import { PANE } from "./pane-tab";
import { accentOf } from "./session-color";
import { notePaneTheme, paneInk } from "./pane-ink";
import { noteShownTab } from "./shown-tab";
import { tabBar } from "./tab-bar";
import { TABS } from "./tabs";
import { isTerminal } from "./surface";

const BODY_PADDING = 1;

const sessionColorAtom = atom({ plugin: "paneline", key: "sessionColor" } as const, "default");
const tabAtom = atom({ plugin: "paneline", key: "tab" } as const, "activity");
const themeAtom = atom({ plugin: "paneline", key: "theme" } as const, "dark");

export function registerSessionPane(on: On): void {
  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e, next) => {
    if (!isTerminal(e)) return next(e);
    const [tab, theme, color] = await Promise.all([
      read($, tabAtom),
      read($, themeAtom),
      read($, sessionColorAtom),
    ]);
    noteShownTab(tab);
    notePaneTheme(theme);
    const accent = accentOf(color);
    const width = e.props.bodyColumns;
    const body = await next({ ...e, props: { ...e.props, bodyColumns: width - BODY_PADDING } });
    const ui = $.ui.resolve(e);
    const { Box } = ui;
    const { fill } = paneInk();
    return (
      <Box
        flexDirection="column"
        width={width}
        minHeight={fill === undefined ? undefined : e.props.scroll.bodyRows}
        backgroundColor={fill}
      >
        {tabBar(ui, TABS, tab, (id) => void update($, tabAtom, () => id), width, accent)}
        <Box flexDirection="column" paddingLeft={BODY_PADDING} width={width}>
          {body}
        </Box>
      </Box>
    );
  });
}

export function registerSessionCommand(on: On): void {
  on("session.start", { isInteractive: true }, async ($, e, next) => {
    await $.command.register({ name: "session", description: "Open the Session side pane" });
    void openPane($);
    return next(e);
  });

  on("classic.SessionStart", { source: ["clear", "resume", "fork"] }, async ($, e, next) => {
    void openPane($);
    return next(e);
  });

  on("command.run", { command: "session" }, async ($) => {
    try {
      await update($, tabAtom, () => TABS[0].id);
      await openPane($);
      return {};
    } catch (error) {
      const text = failureText(error);
      $.ui.log(text, { to: "debug" });
      return { text };
    }
  });
}

async function openPane($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: "Session", closeOnEscape: true });
}
