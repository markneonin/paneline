---
id: TASK-54
title: Hide paneline in the desktop app
status: In Progress
assignee: []
created_date: '2026-10-08 08:12'
updated_date: '2026-10-08 08:12'
labels: []
dependencies: []
type: bug
ordinal: 54000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Desktop app renders the terminal-only restyling badly: links and replies become unreadable. Every render hook passes through on non-terminal surfaces.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On the desktop surface the side pane draws nothing from paneline
- [x] #2 On the desktop surface a reply with a code block is drawn by the engine, not by paneline
- [x] #3 Terminal rendering is unchanged
<!-- AC:END -->
