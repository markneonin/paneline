---
id: TASK-53
title: Open the model picker from the model and effort chips
status: Done
assignee: []
created_date: '2026-10-07 18:50'
updated_date: '2026-10-07 19:02'
labels: []
dependencies: []
ordinal: 53000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The model and effort chips in the prompt row are plain text. Clicking one should open the /model picker, where the model and its effort level can be changed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Clicking the model chip opens the /model picker
- [x] #2 Clicking the effort chip opens the /model picker
- [x] #3 The chips keep their background colour and the directory chip stays plain text
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The model and effort chips are buttons that run /model, which opens the picker with its effort arrows. The directory chip stays plain text.
<!-- SECTION:FINAL_SUMMARY:END -->
