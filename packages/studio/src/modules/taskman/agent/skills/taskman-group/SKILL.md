---
name: Task Manager — Rail group
description: The operations available on rail group in Task Manager: New list in this group, Collapse / expand group, Rename group…, Delete group. Use when the user asks how to do one of these.
---
# Rail group

A collapsible band in the lists rail — Build Manager, Modules, ToDo, Project Notes, or one you added.

Right-clicking this area (`taskman.group`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| New list in this group | `taskman.group.new-list` | — |
| Collapse / expand group | `taskman.group.toggle` | — |
| Rename group… | `taskman.group.rename` | enabled when `taskman.group.editable` |
| Delete group | `taskman.group.delete` | enabled when `taskman.group.editable` |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
