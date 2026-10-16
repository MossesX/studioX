---
name: AmberArt canvas
description: The operations available on amberart canvas in AmberArt: Undo, Redo, Export as PNG, Clear the active layer. Use when the user asks how to do one of these.
---
# AmberArt canvas

The painting surface itself.

Right-clicking this area (`amberart.canvas`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Undo | `amberart.undo` | — |
| Redo | `amberart.redo` | — |
| Export as PNG | `amberart.export` | — |
| Clear the active layer | `amberart.layer.clear` | destructive |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
