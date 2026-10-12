---
id: TASK-53
title: Fit diagram boxes around wide characters
status: Done
assignee: []
created_date: '2026-10-08 03:46'
updated_date: '2026-10-08 03:56'
labels: []
dependencies: []
type: bug
ordinal: 53000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A Mermaid diagram whose labels hold wide characters, such as Korean, Japanese or Chinese, draws each box too narrow. The renderer counts one cell per character, so the right border lands inside the label.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A box around a label with wide characters closes at the same column on every row
- [x] #2 No placeholder character shows in the drawn diagram
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Diagram labels with wide characters are padded before rendering so boxes fit their real display width.
<!-- SECTION:FINAL_SUMMARY:END -->
