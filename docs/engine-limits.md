# Engine limits

The plugin loader and the validator (`claude plugin validate .`) refuse some code that TypeScript accepts. Each limit below was checked against the validator or the engine types in `.claude-plugin/types/claude-code/index.d.ts`.

## Atoms are declared in each file that uses them

`read`, `update` and `memberOf` need a source the scan can read: a reference with string literals for plugin and key, or an `atom(...)` written in the same file. An atom exported from another file fails:

```
the state library's read takes a source the scan can read: ... written there or in a const of this file
```

So every file that touches a key declares its own `atom({ plugin: "paneline", key: "usage" } as const, initial)`. Repeat the line. The key and the type come from `types/index.d.ts`.

## `$` does not cross files

The validator follows `$` only into functions declared in the same file. This fails:

```
$ is passed to "f", imported from "./a": $ is followed only into a function declared in this same file
```

How the repo lives with it: a helper in another file takes plain values, not `$`. The hook in the file that owns `$` reads state, calls the helper, and writes the result. A `track*` function takes `on`, and the hooks inside it use the `$` the engine hands them.

## One unmatched hook per event

A second `on("<event>", hook)` without a matcher for the same event is refused: `on("session.measure") is registered twice without a matcher`. Give the extra hook a matcher:

- `on("session.measure", { changed: ["cost"] }, hook)` for one kind of change.
- `on("tool.call", { tool: "Bash" }, hook)` for one tool.
- `on("turn.step", { agentId: PRESENT_AGENT_ID }, hook)` for subagent events only. The pattern is in `hooks/agents-track.ts`. A regular expression sees an absent value as the text `undefined`, so the pattern has to reject that text.

A regular expression matcher does not fire for a field that is absent from the event. `{ agent_id: /^undefined$/ }` on `classic.PostToolUse` never matches a main-session tool use, so a hook for events without that field keeps a check inside the hook.

## `types/index.d.ts` must be self-contained

The file named by `types` in `plugin.json` may not use `import`, `export ... from`, `require` or `reference`. The validator says: `import reaches outside the file; the contract must be self-contained`. Write shapes inline, even when they repeat a type from `hooks/`. Keep both copies in step by hand. The `agents` state shape is the main example.

## Hot reload runs `session.start` again

When a file of the plugin changes while a session runs, the engine reloads the changed modules and fires `session.start` again for them. Hooks on `session.start` must be safe to run twice. Do not put one-time work there.

## The pane open floor

A session-start open has no person behind it, so the engine calls it unasked. It places an unasked open only at 144 columns or more. If `{plugin, id}` is in `pluginPanes.asked` in `~/.claude.json`, the floor drops to 110 columns.

Below the floor the pane waits undrawn: `$.ui.open` returns `{isPlaced:false}` and paneline draws nothing. Nothing fails, so the pane just does not appear.

- A person's close (✕, or Esc at an idle empty prompt) removes the entry. The list is global, so one close in any session removes it for every session on the machine.
- `/paneline`, or widening the window to 144 columns, places the pane. `/paneline` also writes the entry back.
- `[-]` on the band is the collapse button of the engine's AbovePrompt band, not a pane toggle.

## Other facts from the types

- Hooks modules run without DOM or Node. No `require`, no `import()`. Every imported file must be named `.ts`, `.tsx`, `.js`, `.mjs` or similar.
- Elements (`Box`, `Text`, `Button`) are not globals. Get them from `$.ui.resolve(e)`.
- Tests run under `claude plugin test .` in the same kind of environment: no file system, no network.

## Code wraps at the edge

The engine's `<Code wrap="wrap">` continues a long line under the gutter by breaking at the last cell, even inside a word or token. We cannot pre-wrap it ourselves: that would cost the follow-on highlighting, and `format: 'diff'` needs whole hunks. This waits for a word-wrap mode in the engine.
