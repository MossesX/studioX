---
name: Task Manager — settings
description: Every setting Task Manager persists: Dense rows, Cross out completed items, Confirm destructive deletes, Auto-add build project lists. Use when asked what a setting does, where it is, or what it defaults to.
---
# Task Manager settings

Stored under the kv namespace `taskman-settings`. The user reaches them through the
gear on the module header, or the "Module settings" row on any right-click.

| Setting | Key | Kind | Default | What it does |
| --- | --- | --- | --- | --- |
| Dense rows | `dense` | switch | `false` | Tighter row height in the tree. Floating windows are always dense. |
| Cross out completed items | `crossOutDone` | switch | `true` | Draw a coloured line through a done item's title. |
| Confirm destructive deletes | `confirmDelete` | switch | `true` | Ask before deleting an item with sub-items, or a list with contents. |
| Auto-add build project lists | `autoBuildLists` | switch | `true` | The Build Manager keeps a list per .bmpx project, refreshed every few seconds. Deleting all lists with build projects included switches this off — this is the way back. |

Quote the hint when the user asks what a row means — it is the text they can see beside
it, so an answer that agrees with it is an answer they can check.
