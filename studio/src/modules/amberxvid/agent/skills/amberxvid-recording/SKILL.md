---
name: AmberX Vid — Library item
description: The operations available on library item in AmberX Vid: Play, Show on my profile, Rename…, Delete recording. Use when the user asks how to do one of these.
---
# Library item

A capture in the recordings library, in either view.

Right-clicking this area (`amberxvid.recording`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Play | `amberxvid.recording.play` | — |
| Show on my profile | `amberxvid.recording.show-in-profile` | — |
| Rename… | `amberxvid.recording.rename` | — |
| Delete recording | `amberxvid.recording.delete` | destructive |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
