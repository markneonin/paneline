# Architecture

How paneline is wired. This page describes roles, not line numbers.

## Entry point

`.claude-plugin/plugin.json` points to `types/index.d.ts` (state contract). `hooks/hooks.json` lists one module, `hooks/register.ts`. Its `register` function receives `on` and calls one function per area:

- `registerSessionPane`: the pane shell (tab bar, tab choice). It is registered first, so it runs before the tab hooks.
- `trackAgents`, `trackGit`, `trackPromptInfo`, `trackActivity`, `trackUsage`: record events into state.
- `registerTabs`: one register function per tab.
- `registerSessionCommand`: the `/session` command and opening the pane on session start, unless the `autoOpen` option is off.
- `renderChat`: draws chat messages, tool rows and the status row.
- `registerProbe`: only when the `probe` option is on.

Each of these calls `on("<event>", matcher?, hook)`. A hook receives `$` (the engine), the event `e` and `next`. It does its work, then returns `next(e)` so other plugins still run.

## Data flow

```
engine event -> tracker hook -> state atom -> ui.render hook -> draw function -> screen
```

1. Trackers listen to engine events: `tool.call`, `turn.complete`, `agent.spawn`, `session.measure`, `classic.SessionStart` and others. They compute small plain records.
2. Trackers write the records into atoms: `update($, atom, fn)`. State lives under `PluginState.paneline` in `types/index.d.ts`. Every key is declared there with its type.
3. A `ui.render` hook reads the atoms with `read($, atom)`, builds a view object and calls a draw function.
4. Draw functions are plain functions of `(ui, view)`. They return elements (`Box`, `Text`, `Button`). They hold no state, so tests can call them with fixed input.

Because atoms must be declared in each file that uses them, the same `atom({ plugin: "paneline", key })` line appears in several files. This is on purpose. See `docs/engine-limits.md`.

## Side pane

- `session-pane.tsx` is the shell. `registerSessionCommand` registers `/session` and opens a pane with id `session`. `registerSessionPane` handles `{ component: "Pane", requestId: "session" }`: it reads the `tab` atom, calls `noteShownTab`, sets `bodyColumns` and calls `next` with `requestId` `session:<tab>`. Then it wraps the result with the tab bar (`tab-bar.tsx`).
- Each tab lives in its own `<name>-tab.tsx`. It exports `<NAME>_TAB` (id and label) and `register<Name>Tab(on)`. That function registers a `ui.render` hook for `session:<id>`. The hook loads only the data of that tab and calls the pure body function in `<name>-draw.tsx`.
- `tabs.ts` is the only list of tabs: the `TABS` array (order on screen) and `registerTabs`. Activity, Files, Agents, Context, MCP, Skills and Spend are the current tabs. A new tab costs one entry in `TABS`, one register call, and its own files.
- `pane-tab.ts` has the pane id and `tabRequestId`. `shown-tab.ts` remembers which tab is shown and whether it was just opened. Tabs use it to start work on entry (Agents polling, a fresh Context breakdown).
- Tab data comes from different places. Activity and Files use trackers. Agents uses a tracker plus one poll that runs only while the Agents tab is shown. Context, MCP and Skills call `$.session.usage` through `breakdown.ts`, behind `single-flight.ts` and a short cache. Skills reads each `SKILL.md` description with `$.fs.read` and caches it until the tab is entered again; `skills-track.ts` counts `skill.prompt` uses in `$.store`, which keeps them between sessions. Spend keeps token sums in the `paneline.spend` atom: `activity-track.ts` (main turns, tool results), `agents-track.ts` (agent requests) and `spend-track.ts` (`/clear` and compaction) call the pure helpers in `spend-model.ts`. `usage-track.ts` keeps the context and rate-limit numbers for the status row.
- Pressing a tab button calls `switchTab`, which writes the `tab` atom. Writing it re-renders the pane.

## Chat renderers

`renderChat` registers `ui.render` hooks for engine components: `UserMessage`, `AssistantMessage`, `ToolGroup`, `ToolUse`, `ToolResult`, `TurnDuration` and `AbovePrompt`. A hook may return its own tree or return `next(e)` to keep the engine drawing.

- Assistant text goes through `markdown.ts` (parse to blocks), then the reply drawing code. Blocks are paragraphs, lists, code panels, tables, diagrams and diff panels, each in its own draw file.
- Tool rows show a short summary and the elapsed time. The Details button runs the `/session` command.
- `prompt.compose` adds one hint section so the model knows it may write mermaid diagrams.

## Status row

The row above the input is drawn in the `AbovePrompt` hook. It shows model, effort, path and usage meters. Its data comes from:

- `prompt-track.ts`: seeds model, effort and path, and reads the session colour from the transcript. `prompt-info.tsx` draws the chips.
- `session.measure` events: fill the usage atom (context percent and rate limits).

Width decides what is shown. When the row is too narrow, meters and path parts are dropped in a fixed order.

## Accent colour

The accent follows the session `/color`. It is read from the session transcript (`agent-color` entry), refreshed on session start, prompt submit and stop, and repainted on `command.run` for `color`. `session-color.ts` maps `/color <name>` to the engine theme key `<name>_FOR_SUBAGENTS_ONLY`. The default accent is `promptBorder`. Chip text is `clawd_background`.

All colours are theme keys, not hex values. The engine turns a key into a real colour when it paints. So `/theme` repaints every paneline colour at once, with no event and no reload, and no paneline code reads the theme. The Context tab draws its rows in the engine's own `category.color`.

## Where to look

- Add or change a tab: skill `add-pane-tab`, then `tabs.ts`.
- New state key: `types/index.d.ts`, then the file that writes it.
- Chat look: `chat-render.tsx`, then the `reply-*`, `panel`, `table-draw` and `diff-panel` files.
- Status row: `prompt-info.tsx` and `prompt-track.ts`.
- Test a change: skill `write-test`.
