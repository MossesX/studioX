---
name: AmberX Vid — Stream
description: The operations available on stream in AmberX Vid: Join stream, Follow the host, Copy invite link, Record this broadcast, End stream. Use when the user asks how to do one of these.
---
# Stream

A live stream's card in the stream hub.

Right-clicking this area (`amberxvid.stream`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Join stream | `amberxvid.stream.join` | — |
| Follow the host | `amberxvid.stream.follow` | toggle; checked when `amberxvid.stream.following` |
| Copy invite link | `amberxvid.stream.copy-link` | — |
| Record this broadcast | `amberxvid.stream.record` | toggle; checked when `amberxvid.stream.recording` |
| End stream | `amberxvid.stream.end` | destructive |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
