---
name: Claude — Transcript
description: The operations available on transcript in Claude: Copy the whole transcript, Expand every tool call, Collapse every tool call, Jump to the latest message. Use when the user asks how to do one of these.
---
# Transcript

The conversation transcript as a whole.

Right-clicking this area (`claude-workspace.transcript`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Copy the whole transcript | `claude-workspace.transcript.copy` | enabled when `claude-workspace.open` |
| Expand every tool call | `claude-workspace.transcript.expand-tools` | — |
| Collapse every tool call | `claude-workspace.transcript.collapse-tools` | — |
| Jump to the latest message | `claude-workspace.transcript.jump-latest` | — |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
