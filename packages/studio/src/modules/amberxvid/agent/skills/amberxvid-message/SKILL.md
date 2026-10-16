---
name: AmberX Vid — Message
description: The operations available on message in AmberX Vid: Reply, Copy text. Use when the user asks how to do one of these.
---
# Message

A chat bubble in a DM or a group thread.

Right-clicking this area (`amberxvid.message`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Reply | `amberxvid.message.reply` | — |
| Copy text | `amberxvid.message.copy` | — |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
