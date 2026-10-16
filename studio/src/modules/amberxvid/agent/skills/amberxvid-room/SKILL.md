---
name: AmberX Vid — Group room
description: The operations available on group room in AmberX Vid: Join room, Remove from room. Use when the user asks how to do one of these.
---
# Group room

A room's card in the list, or the live room's participant grid.

Right-clicking this area (`amberxvid.room`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Join room | `amberxvid.room.join` | — |
| Remove from room | `amberxvid.room.remove` | destructive |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
