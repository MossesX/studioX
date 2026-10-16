---
name: AmberX Vid — Wall post
description: The operations available on wall post in AmberX Vid: Like / unlike, Comment…, Copy post text, Edit post, Delete post, Report to moderators. Use when the user asks how to do one of these.
---
# Wall post

A post on a wall or in the merged feed.

Right-clicking this area (`amberxvid.post`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Like / unlike | `amberxvid.post.react` | — |
| Comment… | `amberxvid.post.comment` | — |
| Copy post text | `amberxvid.post.copy-link` | — |
| Edit post | `amberxvid.post.edit` | — |
| Delete post | `amberxvid.post.delete` | destructive |
| Report to moderators | `amberxvid.post.report` | — |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
