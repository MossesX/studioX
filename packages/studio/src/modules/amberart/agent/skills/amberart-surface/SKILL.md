---
name: AmberArt surface
description: The operations available on amberart surface in AmberArt: Add a layer, Export as PNG. Use when the user asks how to do one of these.
---
# AmberArt surface

Anywhere on the screen, including the rail and the panel column.

Right-clicking this area (`amberart.surface`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Add a layer | `amberart.layer.add` | — |
| Export as PNG | `amberart.export` | — |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
