---
name: AmberX Vid — History row
description: The operations available on history row in AmberX Vid: Call back, Open the conversation, Open the recording. Use when the user asks how to do one of these.
---
# History row

A call or room entry in the history surface.

Right-clicking this area (`amberxvid.history`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Call back | `amberxvid.history.call-back` | — |
| Open the conversation | `amberxvid.history.thread` | — |
| Open the recording | `amberxvid.history.recording` | — |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
