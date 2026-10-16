---
name: AmberX Vid — Member
description: The operations available on member in AmberX Vid: View profile, Message, Video call, Invite to my room, Add buddy, Block. Use when the user asks how to do one of these.
---
# Member

A member chip, row or tile — the members list, Profiles, the messenger's buddies, a room participant.

Right-clicking this area (`amberxvid.member`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| View profile | `amberxvid.member.profile` | — |
| Message | `amberxvid.member.message` | — |
| Video call | `amberxvid.member.call` | enabled when `amberxvid.member.online` |
| Invite to my room | `amberxvid.member.invite` | — |
| Add buddy | `amberxvid.member.add-buddy` | — |
| Block | `amberxvid.member.block` | destructive |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
