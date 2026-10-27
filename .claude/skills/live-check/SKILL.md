---
name: live-check
description: Use to see a paneline change working in a real Claude Code session, and to read the colours the screen shows.
---

# Live check

Run the plugin from your worktree in a real session inside a private tmux server. Unit tests do not show layout or colour. This does.

Rules:

- Always use your own tmux socket, `tmux -L <name>`. Never the default socket. Never `tmux kill-server` without `-L <name>`.
- Load the plugin from the worktree you edit, and from nowhere else. An installed plugin with the same name loads first and warns, so do not rely on one.
- Do not use `bypassPermissions`.

Steps:

1. Pick a socket name, for example `pl-check`.
2. Make an isolated config dir outside the repo, so `/theme` does not write your own `~/.claude/settings.json`:
   ```
   S=<scratch dir>; mkdir -p $S/config $S/work
   echo '{"hasCompletedOnboarding":true,"lastOnboardingVersion":"2.1.289","projects":{"'$S/work'":{"hasTrustDialogAccepted":true}}}' > $S/config/.claude.json
   echo '{"theme":"dark"}' > $S/config/settings.json
   ```
   This dir is not logged in. Log in there, or set `ANTHROPIC_API_KEY`, before you expect replies.
3. Write a tmux config for truecolor, then start a wide session so the pane has room:
   ```
   printf 'set -g default-terminal tmux-256color\nset -as terminal-features ",*:RGB"\n' > $S/tmux.conf
   tmux -L pl-check -f $S/tmux.conf new-session -d -s main -x 180 -y 50 -c $S/work \
     "CLAUDE_CODE_PLUGIN_DIRS=<worktree> CLAUDE_CODE_TMUX_TRUECOLOR=1 COLORTERM=truecolor CLAUDE_CONFIG_DIR=$S/config CLAUDE_CODE_NO_FLICKER=1 claude --plugin-dir <worktree>"
   ```
   Your shell may set `CLAUDE_CODE_PLUGIN_DIRS` to the main checkout. The value above overrides it with the worktree. Without the tmux config and `CLAUDE_CODE_TMUX_TRUECOLOR=1`, captures show only `38;5;N` codes.
4. Wait a few seconds, then read the screen:
   - Text: `tmux -L pl-check capture-pane -p -t main`
   - With colours: `tmux -L pl-check capture-pane -e -p -t main`. Colours show as escape codes, for example `38;2;R;G;B` for a truecolor foreground. The values depend on the theme.
5. Drive it with `tmux -L pl-check send-keys -t main "/paneline" Enter`. Send a prompt to produce tool calls and replies. Tabs are clickable buttons: attach to the session in a real terminal with `tmux -L pl-check attach` and click.
6. Switch the theme: send `/theme` and Enter to open the picker, move with the arrows (Auto, Dark, Light, Dark colorblind, Light colorblind, Dark ANSI, Light ANSI), then Enter. Capture again. Every paneline colour must change with the theme and nothing needs a reload. In an ANSI theme, a truecolor code (`38;2` or `48;2`) on screen means a hardcoded colour leaked.
7. Saving a file in the worktree reloads the hooks in the running session. Edit, wait, capture again.
8. Headless alternative for checks that need no screen: `claude -p --setting-sources project --plugin-dir <worktree> "<prompt>"`.
9. When done, stop only your server: `tmux -L pl-check kill-server`.

Look at: widths of 60 and 120 columns, long names, empty state, the accent colour after `/color red`, the colours in each theme, and that nothing flickers or grows while idle.
