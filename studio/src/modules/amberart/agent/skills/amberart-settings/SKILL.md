---
name: AmberArt — settings
description: Every setting AmberArt persists: Undo history depth, Checkerboard transparency. Use when asked what a setting does, where it is, or what it defaults to.
---
# AmberArt settings

Stored under the kv namespace `amberart-settings`. The user reaches them through the
gear on the module header, or the "Module settings" row on any right-click.

| Setting | Key | Kind | Default | What it does |
| --- | --- | --- | --- | --- |
| Undo history depth | `undoDepth` | number | `30` | How many undo snapshots to hold. Each is ~6.4 MB of pixels held live. |
| Checkerboard transparency | `checkerboard` | switch | `true` | Draw transparency as a checkerboard, so erased and background-painted regions differ. |

Quote the hint when the user asks what a row means — it is the text they can see beside
it, so an answer that agrees with it is an answer they can check.
