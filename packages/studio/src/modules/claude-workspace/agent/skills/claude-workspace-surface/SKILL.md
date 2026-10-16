---
name: Claude workspace
description: The operations available on claude workspace in Claude: New conversation, Stop the running turn. Use when the user asks how to do one of these.
---
# Claude workspace

Anywhere on the workspace, including empty space.

Right-clicking this area (`claude-workspace.surface`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| New conversation | `claude-workspace.new` | — |
| Stop the running turn | `claude-workspace.stop` | destructive; enabled when `claude-workspace.streaming` |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
