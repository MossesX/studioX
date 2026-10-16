---
name: Task Manager — Task list
description: The operations available on task list in Task Manager: New item in list, Open in floating window, Rename list…, Pin / unpin list, Delete list. Use when the user asks how to do one of these.
---
# Task list

A list: its rail row, its tree header, or its grid parent row.

Right-clicking this area (`taskman.list`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| New item in list | `taskman.list.new-item` | — |
| Open in floating window | `taskman.list.float` | — |
| Rename list… | `taskman.list.rename` | — |
| Pin / unpin list | `taskman.list.pin` | — |
| Delete list | `taskman.list.delete` | destructive |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
