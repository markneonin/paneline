---
id: TASK-53
title: Let users turn off opening the pane on session start
status: Done
assignee: []
created_date: '2026-10-08 05:06'
updated_date: '2026-10-08 05:25'
labels: []
dependencies: []
ordinal: 53000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Session pane opens on every session start, clear, resume and fork. Users who keep it closed have to press Esc each time.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 With autoOpen off in /config, starting a session does not open the pane
- [x] #2 With autoOpen off, /clear, resume and fork do not open the pane
- [x] #3 With autoOpen off, /session still opens the pane
- [x] #4 With autoOpen unset or on, the pane opens as before
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the autoOpen option; off stops the pane opening on start, clear, resume and fork, and /session still opens it
<!-- SECTION:FINAL_SUMMARY:END -->
