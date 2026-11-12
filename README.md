# paneline

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Claude Code 2.1.289+](https://img.shields.io/badge/Claude%20Code-2.1.289%2B-orange.svg)

![paneline in a Claude Code session](docs/screenshots/hero.png)

paneline is a Claude Code mod (plugin) that adds a side pane with Activity, Files, Agents, Plan, Context, MCP, Skills, Spend, Setup, Shells, History, Review and Sessions tabs, a status line above the prompt, a restyled chat, terminal Mermaid diagrams, tables, code panels and diff panels. Colours follow your session `/color` and `/theme`.

## Install

```
/plugin marketplace add markneonin/paneline
/plugin install paneline@paneline
```

Needs Claude Code 2.1.289+ and a terminal at least 110 columns wide.

Third-party marketplaces do not update by themselves. Turn on auto-update in `/plugin` > Marketplaces to get new versions.

## How it looks

### Status row

![Status row](docs/screenshots/statusrow.png)

### Green, purple and orange sessions

![Session colour green](docs/screenshots/color-green.png)
![Session colour purple](docs/screenshots/color-purple.png)
![Session colour orange](docs/screenshots/color-orange.png)

### Chat

![Chat layout](docs/screenshots/chat.png)

Each message and reply shows its time in muted text. Read and Bash results are drawn as titled panels.

### Tables, alerts and code panels

![Tables, alerts and a code panel](docs/screenshots/visuals.png)

### Mermaid diagram

![Mermaid diagram in the terminal](docs/screenshots/diagram.png)

### Edit diff panel

![Edit diff panel](docs/screenshots/diff.png)

### Write panel

![Write panel](docs/screenshots/write.png)

### Activity tab

![Activity tab](docs/screenshots/activity.png)

### Files tab

![Files tab](docs/screenshots/files.png)

The Remote block shows, for each branch, how many commits it is ahead of and behind its upstream, its pull request or merge request, the CI state and the unresolved review threads. Activity, Files and Skills have a filter field.

### Agents tab

![Agents tab](docs/screenshots/agents.png)

### Plan tab

![Plan tab](docs/screenshots/plan.png)

Claude's task list with a progress bar. Finished tasks fold away.

### Context tab

![Context tab](docs/screenshots/context.png)

The compact button compacts the session after you confirm.

### MCP tab

![MCP tab](docs/screenshots/mcp.png)

### Skills tab

![Skills tab](docs/screenshots/skills.png)

### Spend tab

![Spend tab](docs/screenshots/spend.png)

### Setup tab

![Setup tab](docs/screenshots/setup.png)

Instructions, permissions, hooks, plugins and unused skills of the session, with a count for each. Press a hook to read what it runs.

### Shells tab

![Shells tab](docs/screenshots/shells.png)

Background shells with their latest output and the ports they listen on. Press a running shell for a kill button that asks you to confirm.

### History tab

![History tab](docs/screenshots/history.png)

Every prompt of this session with its cost, tool count and time. The filter also searches past sessions; select one to resume it or copy its resume command.

### Review tab

![Review tab](docs/screenshots/review.png)

The diff of each changed file, for the session, the uncommitted changes or the main branch. Revert a file or a hunk, or click a diff line to comment: open comments go into your next prompt until they are resolved.

### Sessions tab

![Sessions tab](docs/screenshots/sessions.png)

The Claude Code sessions running on this machine, each with its state and age. Press one to see its last prompt, model and resume command.

## What it runs and reads

paneline opens no network connection of its own and asks for no keys or tokens. The Remote block runs `gh` or `glab`, which talk to GitHub or GitLab with your own login. With the `guard` option on, `git ls-remote` also contacts your git remote.

- **Programs it starts:** `git` in the folders of the session and its subagents, read-only (`rev-parse`, `status`, `diff`, `log -g`, `ls-files`, `cat-file`, `merge-base`, `symbolic-ref`, `rev-list --left-right --count`, `ls-remote --get-url`, `worktree list`), for branch names, line counts and the Files, Review and Remote views; `gh api graphql`, or `glab mr view` and `glab api`, for the pull request or merge request, the CI state and the open threads in the Remote block, after each reply, after a `git push`, `gh` or `glab` command and when you open the Files tab; the ripgrep inside the `claude` binary (plain `grep` if it is missing) on session transcripts for the Spend and History tabs and the colour set with `/color`; `find` and `stat` to list transcripts; `sqlite3` for its own store; `tail` on the output of background shells; `lsof` and `ps` for the ports they open and for running sessions.
- **Programs that change something, only when you press the button:** `git worktree remove` for a stale worktree in the Files tab, and `git restore`, `git rm`, `git clean` or `git apply -R` to revert a file or a hunk in the Review tab.
- **Files it reads:** the session transcripts in `~/.claude/projects` and the session list in `~/.claude/sessions`; `~/.claude.json`, the project `.mcp.json` and the `settings.json` files for the MCP, Setup and Skills tabs; the `CLAUDE.md` files the session loads; `SKILL.md` and command files of your skills, `~/.claude/paneline-prompts.md` and the project `.claude/paneline-prompts.md` for prompts in the Skills tab, and `~/.claude/plugins/installed_plugins.json`; the files you review in the Review tab.
- **Files it writes:** its store `state.db` in `plugins/paneline` of the Claude config folder; one small file per running session in `~/.claude/paneline/sessions`, removed when the session ends; your review comments in `paneline-review.json` in the git folder; `skillOverrides` in the project `.claude/settings.local.json`, only when you switch a skill on or off in the Skills tab.
- **Slash commands it runs:** `/mcp enable <server>` or `/mcp disable <server>` when you press that button in the MCP tab, and `/resume <session>` when you resume a past session in the History tab.
- **Tool it adds:** `mcp__paneline__resolve_review_comment`, which Claude calls to mark a review comment as resolved; this writes `paneline-review.json`.
- **Tools it calls:** `TaskStop`, only when you press "confirm kill" on a shell in the Shells tab. The compact button in the Context tab compacts the session only after you confirm.
- **Events it watches:** tool calls, prompts, subagent starts and stops, `/color`, `/theme` and `/config` changes. It passes every event on unchanged and never answers a permission prompt. With the `guard` option on, it also asks you to confirm a Bash command with a recursive delete or a force push, and runs `git ls-remote <remote> <branch>`, `git rev-list`, `git cat-file` and `find` to list what that command would lose.
- **What it stores:** its own state in the `state.db` file above and in Claude Code's plugin store on this machine.
- **Command it adds:** `/paneline` opens the pane again after you close it.
- `hooks/vendor/mermaid-text.js` is a build of [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid) (MIT) that draws Mermaid diagrams as text.

## Other ways to run

- In the fullscreen layout the pane docks beside the chat from 110 columns. In the main-screen layout (the default under tmux, or with `CLAUDE_CODE_NO_FLICKER=0`) it opens inline above the prompt at any width.
- The pane opens when a session starts, unless the `autoOpen` option is off. Run `/paneline` to open it again after you close it.
- Node.js, only if you want to run the checks (see Development).

To run from a clone instead, pass the folder with `--plugin-dir` for one session:

```sh
git clone https://github.com/markneonin/paneline
```

```sh
claude --plugin-dir /path/to/paneline
```

To load it every time, put these in your shell profile instead:

```sh
export CLAUDE_CODE_PLUGIN_DIRS=/path/to/paneline
```

The plugin id is `paneline`. It has three options. `autoOpen` opens the pane when a session starts, clears, resumes or forks. It is on by default; turn it off to open the pane only with `/paneline`. `probe` writes render times to the debug log. It is off by default. `guard` asks you to confirm before a recursive delete or a force push runs, and lists the files or commits it would lose. It is off by default.

## Development

```sh
npm install
npm run check
```

Scripts:

- `npm run lint`: ESLint with the strict type-checked typescript-eslint rules.
- `npm run format` and `npm run format:check`: Prettier, write or verify.
- `npm run typecheck`: `tsc -p .`.
- `npm test`: `claude plugin test .`.
- `npm run check`: all four.

`claude plugin validate .` checks the manifest.

Notes:

- The hooks are TypeScript in `hooks/`. Tests are in `tests/`.
- The pre-commit hook (husky and lint-staged) lints and format-checks staged files, then type-checks.
- `typecheck` and `lint` need the plugin type definitions in `.claude-plugin/types/`. Claude Code generates them on your machine and git ignores them. CI generates them and runs lint, typecheck and tests.
- `claude plugin test` has no coverage option, so there is no coverage report.
- The code has no comments. Names and tests have to explain it.

## License

[MIT](LICENSE) (c) 2026 Mark. The Mermaid renderer in `hooks/vendor/` is third-party code, see [THIRD_PARTY_NOTICES.md](hooks/vendor/THIRD_PARTY_NOTICES.md).
