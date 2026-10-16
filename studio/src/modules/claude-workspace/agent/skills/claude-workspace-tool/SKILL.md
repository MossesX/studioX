---
name: Claude — Tool call
description: The operations available on tool call in Claude: Copy the call's input, Copy the call's output, Copy the edit as a patch. Use when the user asks how to do one of these.
---
# Tool call

One tool call card, including a file-edit diff or a nested subagent run.

Right-clicking this area (`claude-workspace.tool`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Copy the call's input | `claude-workspace.tool.copy-input` | — |
| Copy the call's output | `claude-workspace.tool.copy-output` | — |
| Copy the edit as a patch | `claude-workspace.tool.copy-patch` | — |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
