---
name: visual-review
description: Use before a paneline task that changes what the pane, status row or chat draws is called done: screenshot every state of the feature, then adversarial visual-reviewer rounds and fixes until a round finds nothing blocking.
---

# Visual review

Record dir: `backlog/work/task-<id>/` in the main checkout. Screenshots go to `shots/` there (git ignores it).

1. **States.** Write `visual-review.md` with the list of states to shoot: every tab, button and window the change adds or touches, each opened and clicked; empty state; long names; widths 60 and 120 columns; themes dark and light; `/color red`.
2. **Shoot.** Start a session as in skill `live-check` (own tmux socket, plugin from your worktree, session name `main`). Per state: drive it with `tmux -L <socket> send-keys` or `python3 .claude/skills/visual-review/click.py <socket> "<label>" [nth]`, wait for it to settle, then `python3 .claude/skills/visual-review/shot.py <socket> <record dir>/shots/r<round>-<state>`. That writes `.png`, `.txt` and `.ansi`. Crop nothing.
3. **Review.** Dispatch two fresh `visual-reviewer` agents in one message. Give each only the PNG paths and the ticket's user-visible acceptance criteria. Never the diff, your reasoning or the last round's verdict.
4. **Fix.** Every `blocking` finding with a quote is fixed in the part that draws it, then reshoot every state that part draws. A `nit` goes to the ticket notes, not into a fix. A finding you think is wrong goes to the owner.
5. **Repeat** 3-4 with new reviewers until one round has `blocking: 0` from both. After round 5 with blocking findings left, stop and give the owner the list with its PNGs.
6. **Record.** Append each round to `visual-review.md`: findings, what fixed them. Under the last round list the final PNG paths (relative, `shots/...`), and end the file with the line `verdict: clean`. A change that draws nothing different ends with `verdict: no-ui - <why>` instead.
7. **Report.** The done report to the owner names the final PNGs.
