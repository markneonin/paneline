# paneline

A Claude Code plugin: a side pane with tabs, a status row above the input and a restyled chat. TypeScript and React hooks that the engine reloads while it runs.

## Task flow (Backlog.md)

Tasks live in `backlog/`. Every change has one task. Do not start work without one.

1. Find a matching task, or create one. Use the `backlog` CLI.
2. Move it to In Progress: `backlog task edit <id> -s "In Progress"`.
3. Work. Check each acceptance criterion when it is true: `--check-ac <n>`.
4. Run the gate, commit, then set Done: `backlog task edit <id> -s Done`, with a one-line final summary.

Never edit files in `backlog/` by hand. A new feature starts as a task whose acceptance criteria say what the user sees.

## Gate

- `npm run check` runs lint, format check, typecheck and tests.
- `claude plugin validate .` checks the manifest and the hooks the way the engine will load them.
- Both must pass before a commit. Husky runs lint-staged and typecheck on commit. Never use `--no-verify`.
- `.claude-plugin/types/` is not tracked. The engine writes it when it loads the plugin from a folder. If lint or typecheck fail on `claude-code` types, run `claude plugin validate .` once, then retry.

## Commits

One line, no body, no trailers: `<type>(<scope>): <short description>`, for example `feat(files): add reset button`. Split a change that does not fit one line.

## Code rules

- No comments. Rename or restructure instead. Allowed: lint pragmas, and a one-line link to an external bug or spec.
- Use `type`, not `interface`. ESLint runs strict type-checked rules with zero warnings.
- Name every number as a constant.
- Colours are engine theme keys from `hooks/palette.ts`. No hex, no colour names. ESLint fails a hex string in `hooks/`.
- No timers or polling. Sessions run in parallel, so refresh on events. The one exception is the Agents tab poll, which runs only while that tab is open.
- Fetches that can overlap go through `hooks/single-flight.ts`. A burst of measure events must not refetch MCP or Context data.
- Pane look follows Claude Code's own `/context` and `/mcp` screens. The accent colour follows the session `/color`.
- Do not add private paths, names or emails to any file.

## Engine limits

The plugin loader and validator are strict. Read `docs/engine-limits.md` before you split a file or add a hook. Short version: declare each atom in every file that uses it, never pass `$` to a function from another file, use matchers when one event has several hooks, keep `types/index.d.ts` free of imports.

## Tests

- One file per area in `tests/`, named `<area>.test.ts` or `.test.tsx`. Only `claude plugin test .` runs them.
- Test names start with a scenario id: `M1 the tab opens with a title`.
- Assert what is drawn and which state is written, not internals.
- Steps are in `.claude/skills/write-test/SKILL.md`.

## Module map (`hooks/`)

- `register.ts`: entry point. Calls the pane shell, each `track*` function, `registerTabs`, the `/paneline` command and `renderChat`.
- `tabs.ts`: the list of pane tabs. A new tab is one entry there plus one register call.
- `*-tab.tsx`: one file per pane tab. Exports the tab id and label and registers its render hook.
- `*-draw.tsx`, `pane-kit.tsx`, `tab-bar.tsx`, `tree-glyphs.ts`: pane bodies (pure functions) and shared pane rows.
- `session-pane.tsx`, `pane-tab.ts`, `shown-tab.ts`: the pane shell, the pane id and the shown-tab memory.
- `*-track.ts`, `prompt-info.tsx`, `breakdown.ts`: event hooks and data loaders that fill state. `git-run.ts` runs git for the trackers.
- `format.ts`, `paths.ts`, `tools.ts`, `servers.ts`: shared helpers for text, paths, tool calls and MCP servers.
- `chat-render.tsx`, `chat-draw.tsx`, `reply-*.ts(x)`, `markdown.ts`, `diagram*.ts(x)`, `table-draw.tsx`, `diff-panel.tsx`, `panel.tsx`: chat rendering.
- `palette.ts`, `session-color.ts`, `text-width.ts`, `memo.ts`, `single-flight.ts`, `probe.ts`: shared helpers.
- `vendor/`: third-party code, see `hooks/vendor/THIRD_PARTY_NOTICES.md`. Do not edit.
- `types/index.d.ts`: the plugin's own state contract. Add new state keys here.

## Where to read more

- `docs/architecture.md`: how events, state and drawing connect.
- `docs/engine-limits.md`: loader and validator limits.
- Skill `add-pane-tab`: read it before adding or changing a tab of the side pane.
- Skill `live-check`: run the plugin in a real session and read the screen.
- Skill `write-test`: write a test.
- `CONTRIBUTING.md`: the short version for people.
