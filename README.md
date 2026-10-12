# paneline

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Claude Code 2.1.289+](https://img.shields.io/badge/Claude%20Code-2.1.289%2B-orange.svg)

![paneline in a Claude Code session](docs/screenshots/hero.png)

paneline is a Claude Code mod (plugin) that adds a side pane with Activity, Files, Agents, Context, MCP, Skills and Spend tabs, a status line above the prompt, a restyled chat, terminal Mermaid diagrams, tables, code panels and diff panels. Colours follow your session `/color` and `/theme`.

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

### Agents tab

![Agents tab](docs/screenshots/agents.png)

### Context tab

![Context tab](docs/screenshots/context.png)

### MCP tab

![MCP tab](docs/screenshots/mcp.png)

### Skills tab

![Skills tab](docs/screenshots/skills.png)

### Spend tab

![Spend tab](docs/screenshots/spend.png)

## What it runs and reads

paneline works only on your machine. It sends nothing over the network and asks for no keys or tokens.

- **Programs it starts:** read-only `git` (`rev-parse`, `diff --numstat`, `log -g`) in the folders of the session and its subagents, for the branch names and the line counts in the Files tab and on agent cards; `grep` on the session transcript, to find the colour set with `/color`.
- **Files it reads:** `~/.claude.json` and the project `.mcp.json` for the MCP tab; `SKILL.md` and command files of your skills and `~/.claude/plugins/installed_plugins.json` for the Skills tab; the session transcript, only through the `grep` above.
- **Slash commands it runs:** `/mcp enable <server>` or `/mcp disable <server>`, only when you press that button in the MCP tab.
- **Events it watches:** tool calls, prompts, subagent starts and stops, `/color`, `/theme` and `/config` changes. It passes every event on unchanged and never answers a permission prompt.
- **What it stores:** its own state in Claude Code's plugin store on this machine.
- **Command it adds:** `/session` opens the pane again after you close it.
- `hooks/vendor/mermaid-text.js` is a build of [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid) (MIT) that draws Mermaid diagrams as text.

## Other ways to run

- In the fullscreen layout the pane docks beside the chat from 110 columns. In the main-screen layout (the default under tmux, or with `CLAUDE_CODE_NO_FLICKER=0`) it opens inline above the prompt at any width.
- The pane opens when a session starts, unless the `autoOpen` option is off. Run `/session` to open it again after you close it.
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

The plugin id is `paneline`. It has two options. `autoOpen` opens the pane when a session starts, clears, resumes or forks. It is on by default; turn it off to open the pane only with `/session`. `probe` writes render times to the debug log. It is off by default.

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
- `typecheck` and `lint` need the plugin type definitions in `.claude-plugin/types/`. Claude Code generates them on your machine and git ignores them, so a clean checkout or CI cannot run these two checks.
- `claude plugin test` has no coverage option, so there is no coverage report.
- The code has no comments. Names and tests have to explain it.

## License

[MIT](LICENSE) (c) 2026 Mark. The Mermaid renderer in `hooks/vendor/` is third-party code, see [THIRD_PARTY_NOTICES.md](hooks/vendor/THIRD_PARTY_NOTICES.md).
