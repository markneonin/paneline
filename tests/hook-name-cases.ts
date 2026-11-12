export type NameCase = { id: string; shows: string; command: string; name: string };

const TMUX_CLI = '"${TMUX_CLAUDE_HOOK_TMUX_BIN:-tmux}"';
const TMUX_WRAPPER_BODY = [
  "LC_ALL=C",
  "export TMUX_CLAUDE_PID=${TMUX_CLAUDE_PID:-$PPID}",
  'tmux_fallback() { { print -rn -- "$tmux_p"; /bin/cat; } | /bin/sh -c "$1" >&3; exit $?; }',
  'zmodload zsh/system zsh/datetime zsh/files 2>/dev/null || exec /bin/sh -c "$1" >&3',
  "print -r -- '\\''{}'\\'' >&3",
].join("\n");

export function tmuxHookCommand(event: string): string {
  const inner = [
    'tmux_cli="${TMUX_CLAUDE_HOOK_TMUX_BIN:-${TMUX_BUNDLED_CLI_PATH:-}}"; if [ -z "$tmux_cli" ] || [ ! -x "$tmux_cli" ]; then tmux_cli="$(command -v tmux 2>/dev/null || true)"; fi; agent_pid="${TMUX_CLAUDE_PID:-${PPID:-}}"; ',
    'if [ -n "$TMUX_SURFACE_ID" ] && [ "$TMUX_CLAUDE_HOOKS_DISABLED" != "1" ] && [ -n "$tmux_cli" ]; then ',
    `if [ -n "\${TMUX_SOCKET_PATH:-}" ]; then TMUX_CLAUDE_PID="$agent_pid" "$tmux_cli" --socket "$TMUX_SOCKET_PATH" hooks enqueue claude ${event} 2>/dev/null || { cat >/dev/null; echo '{}'; }; `,
    `else TMUX_CLAUDE_PID="$agent_pid" "$tmux_cli" hooks enqueue claude ${event} 2>/dev/null || { cat >/dev/null; echo '{}'; }; fi; `,
    "else cat >/dev/null; echo '{}'; fi",
  ].join("");
  const quotedInner = inner.replaceAll("'", "'\\''");
  return `if [ -n "\${TMUX_CLAUDE_HOOK_SPOOL_DIR:-}" ] && [ -x /bin/zsh ]; then exec /bin/zsh -fc '${TMUX_WRAPPER_BODY}' tmux-hook '${quotedInner}' ${event} 3>&1 1>&2; else ${inner}; fi`;
}

const JQ_PIPE =
  'jq -r \'.tool_input.file_path // empty\' | { read -r f; [ -n "$f" ] && git -C "$(dirname "$f")" add -- "$f"; } >/dev/null 2>&1 || true';

export const NAME_CASES: NameCase[] = [
  {
    id: "N1",
    shows: "a script path with an argument shows the script",
    command: "~/.claude/observability/bin/obs-log ConfigChange",
    name: "obs-log",
  },
  {
    id: "N2",
    shows: "a script path with a subcommand shows the script and the subcommand",
    command: "~/.claude/bin/claude-settings push",
    name: "claude-settings push",
  },
  {
    id: "N3",
    shows: "a script path with a flag shows the script file",
    command: "/a/b/guard.js --x",
    name: "guard.js",
  },
  {
    id: "N4",
    shows: "an interpreter in front of a script path shows the script",
    command: "node /a/b/guard.js --x",
    name: "guard.js",
  },
  {
    id: "N5",
    shows: "an interpreter, a script and a subcommand show the script and the subcommand only",
    command: "python3 ~/.claude/hooks/summary-patch.py interval 300",
    name: "summary-patch.py interval",
  },
  {
    id: "N6",
    shows: "a variable folder in quotes in front of a script shows the script",
    command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/protect-files.sh',
    name: "protect-files.sh",
  },
  {
    id: "N7",
    shows: "a quoted path with a space shows the script and its word, no quote characters",
    command: '"/a/b c/run.sh" arg',
    name: "run.sh arg",
  },
  {
    id: "N8",
    shows:
      "a variable program with a default and the words hooks claude shows the program and the hook's own name",
    command: `${TMUX_CLI} hooks claude cron-create-guard`,
    name: "tmux cron-create-guard",
  },
  {
    id: "N9",
    shows: "a redirection and a fallback after the command are left out, the program stays",
    command: `${TMUX_CLI} hooks claude inbox-drain 2>/dev/null || echo '{}'`,
    name: "tmux inbox-drain",
  },
  {
    id: "N10",
    shows: "the real tmux Stop hook shows the script name and the event it was made for",
    command: tmuxHookCommand("stop"),
    name: "tmux-hook stop",
  },
  {
    id: "N11",
    shows: "a bash -c string shows the command inside it, after a cd",
    command: "bash -c 'cd \"$X\" && npm run lint'",
    name: "npm run lint",
  },
  {
    id: "N12",
    shows: "variable assignments in front of a script are left out",
    command: "FOO=1 BAR=2 ./scripts/check.sh",
    name: "check.sh",
  },
  {
    id: "N13",
    shows: "env with assignments in front of an interpreter shows the script",
    command: "env FOO=1 node hooks/guard.js",
    name: "guard.js",
  },
  {
    id: "N14",
    shows: "a jq pipe into a block shows the first real program, git",
    command: JQ_PIPE,
    name: "git",
  },
  {
    id: "N15",
    shows: "a command made only of plumbing keeps its own name",
    command: "echo done",
    name: "echo done",
  },
  {
    id: "N16",
    shows: "a package runner shows the runner and the tool",
    command: "npx prettier --write .",
    name: "npx prettier",
  },
  {
    id: "N17",
    shows: "exec of a shell on a script path shows the script",
    command: "exec /bin/zsh /p/tmux-hook.sh --x",
    name: "tmux-hook.sh",
  },
  {
    id: "N18",
    shows: "an if test around exec of a shell on a script shows the script and its subcommand",
    command: "if [ -x /p/tmux-hook.sh ]; then exec /bin/zsh /p/tmux-hook.sh run; fi",
    name: "tmux-hook.sh run",
  },
  {
    id: "N19",
    shows: "a command of spaces only is named command",
    command: "   ",
    name: "command",
  },
  {
    id: "N20",
    shows: "the real tmux feed hook tells itself from the Stop hook next to it",
    command: tmuxHookCommand("feed"),
    name: "tmux-hook feed",
  },
  {
    id: "N21",
    shows: "the real tmux session-start hook shows its event with the dashes kept",
    command: tmuxHookCommand("session-start"),
    name: "tmux-hook session-start",
  },
  {
    id: "N22",
    shows: "the real tmux pre-tool-use hook shows its event with the dashes kept",
    command: tmuxHookCommand("pre-tool-use"),
    name: "tmux-hook pre-tool-use",
  },
  {
    id: "N23",
    shows:
      "a variable program with a default and only the word hooks shows the program and the hook's own name",
    command: `${TMUX_CLI} hooks feed`,
    name: "tmux feed",
  },
  {
    id: "N24",
    shows:
      "a node -e command that requires a plugin script shows the script's file name, with no quote or bracket after it",
    command: `node -e "require(require('path').join(process.env.CLAUDE_PLUGIN_ROOT, 'hooks/ponytail-activate.js'))"`,
    name: "ponytail-activate.js",
  },
  {
    id: "N25",
    shows: "a node command with a double-quoted script shows the script's file name",
    command: `node "x.js"`,
    name: "x.js",
  },
  {
    id: "N26",
    shows: "a python3 command with a single-quoted script shows the script's file name",
    command: `python3 'x.py'`,
    name: "x.py",
  },
  {
    id: "N27",
    shows:
      "a node -e command that requires a relative script in double quotes shows the script's file name",
    command: `node -e 'require("./x.js")'`,
    name: "x.js",
  },
];
