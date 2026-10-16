---
name: AmberArt layer
description: The operations available on amberart layer in AmberArt: Add a layer, Show / hide this layer, Bring forward, Send back, Clear this layer, Delete this layer. Use when the user asks how to do one of these.
---
# AmberArt layer

One row in the layer stack.

Right-clicking this area (`amberart.layer`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Add a layer | `amberart.layer.add` | — |
| Show / hide this layer | `amberart.layer.toggle` | — |
| Bring forward | `amberart.layer.raise` | — |
| Send back | `amberart.layer.lower` | — |
| Clear this layer | `amberart.layer.clear` | destructive |
| Delete this layer | `amberart.layer.remove` | destructive; enabled when `amberart.removable-layer` |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
