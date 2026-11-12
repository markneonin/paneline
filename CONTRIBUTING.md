# Contributing

Thank you for helping. This page is short on purpose.

## Set up

1. Install Node.js and Claude Code.
2. `npm install`.
3. Start `claude --plugin-dir .` once. The engine then writes `.claude-plugin/types/`, which lint and typecheck need.

## Try your change

Start Claude Code with `claude --plugin-dir .` in a copy of this repo. Saving a file reloads the hooks.

## Before you open a pull request

- `npm run check` passes.
- `claude plugin validate .` passes.
- Commit messages are one line: `<type>(<scope>): <short description>`.
- Code has no comments. Rename or restructure instead.
- Work is tracked as tasks in `backlog/` with Backlog.md.

## AI coding agents

Read `AGENTS.md`. It holds the rules, the commands and the limits of the plugin engine. This page does not repeat them.
