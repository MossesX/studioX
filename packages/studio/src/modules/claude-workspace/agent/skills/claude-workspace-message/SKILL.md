---
name: Claude — Message
description: The operations available on message in Claude: Copy this message, Copy its code blocks, Quote it into the composer. Use when the user asks how to do one of these.
---
# Message

One message — a question you asked or an answer that came back.

Right-clicking this area (`claude-workspace.message`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Copy this message | `claude-workspace.message.copy` | — |
| Copy its code blocks | `claude-workspace.message.copy-code` | — |
| Quote it into the composer | `claude-workspace.message.quote` | — |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
