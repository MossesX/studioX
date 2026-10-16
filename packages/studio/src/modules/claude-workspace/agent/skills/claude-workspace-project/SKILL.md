---
name: Claude — Project
description: The operations available on project in Claude: Start a conversation here, Show only this project's conversations, Copy the working directory. Use when the user asks how to do one of these.
---
# Project

One project — its bound working directory, instructions and knowledge files.

Right-clicking this area (`claude-workspace.project`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Start a conversation here | `claude-workspace.project.new-conversation` | — |
| Show only this project's conversations | `claude-workspace.project.filter` | — |
| Copy the working directory | `claude-workspace.project.copy-cwd` | — |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
