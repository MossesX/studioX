---
name: Forge
description: The operations available on forge in Forge: Copy from the Forge. Use when the user asks how to do one of these.
---
# Forge

Anywhere on the Forge screen — the module's own right-click surface.

Right-clicking this area (`forge.surface`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Copy from the Forge | `ctx.copy` | — |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
