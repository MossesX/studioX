---
name: Claude — Composer
description: The operations available on composer in Claude: Clear the draft, Previous message from history. Use when the user asks how to do one of these.
---
# Composer

The message editor at the foot of the transcript.

Right-clicking this area (`claude-workspace.composer`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Clear the draft | `claude-workspace.composer.clear` | — |
| Previous message from history | `claude-workspace.composer.history-prev` | — |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
