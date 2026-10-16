---
name: Task Manager surface
description: The operations available on task manager surface in Task Manager: New list, Refresh lists, …including the build project lists, Delete all lists. Use when the user asks how to do one of these.
---
# Task Manager surface

Anywhere on the screen, including empty space below the rows.

Right-clicking this area (`taskman.surface`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| New list | `taskman.new-list` | — |
| Refresh lists | `taskman.lists.refresh` | — |
| …including the build project lists | `taskman.delete-all.toggle-managed` | toggle; checked when `taskman.delete-all.managedArmed` |
| Delete all lists | `taskman.delete-all` | destructive; enabled when `taskman.hasLists` |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
