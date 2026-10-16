---
name: AmberX Vid
description: The operations available on amberx vid in AmberX Vid: New group room…, Go live…, New wall post…, Camera & microphone…, Copy from AmberX Vid. Use when the user asks how to do one of these.
---
# AmberX Vid

Anywhere on the suite — the module's own right-click surface.

Right-clicking this area (`amberxvid.surface`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| New group room… | `amberxvid.surface.new-room` | — |
| Go live… | `amberxvid.surface.go-live` | — |
| New wall post… | `amberxvid.surface.new-post` | — |
| Camera & microphone… | `amberxvid.surface.settings` | — |
| Copy from AmberX Vid | `ctx.copy` | — |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
