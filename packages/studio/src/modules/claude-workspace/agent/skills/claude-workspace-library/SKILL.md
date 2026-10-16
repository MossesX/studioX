---
name: Claude — Conversation library
description: The operations available on conversation library in Claude: New conversation, Reload the library, Clear the search, Manage projects…, Show every conversation. Use when the user asks how to do one of these.
---
# Conversation library

The library pane itself, its search box, and its empty space.

Right-clicking this area (`claude-workspace.library`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| New conversation | `claude-workspace.new` | — |
| Reload the library | `claude-workspace.library.refresh` | — |
| Clear the search | `claude-workspace.library.clear-search` | — |
| Manage projects… | `claude-workspace.projects.manage` | — |
| Show every conversation | `claude-workspace.project.clear-filter` | enabled when `claude-workspace.project-filtered` |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
