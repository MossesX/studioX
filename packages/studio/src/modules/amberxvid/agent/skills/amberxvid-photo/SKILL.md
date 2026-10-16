---
name: AmberX Vid — Album item
description: The operations available on album item in AmberX Vid: Open, Share to a message, Caption…, Set as album cover, Delete photo. Use when the user asks how to do one of these.
---
# Album item

A photo in an album's justified grid.

Right-clicking this area (`amberxvid.photo`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Open | `amberxvid.photo.open` | — |
| Share to a message | `amberxvid.photo.share` | — |
| Caption… | `amberxvid.photo.caption` | — |
| Set as album cover | `amberxvid.photo.set-cover` | — |
| Delete photo | `amberxvid.photo.delete` | destructive |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
