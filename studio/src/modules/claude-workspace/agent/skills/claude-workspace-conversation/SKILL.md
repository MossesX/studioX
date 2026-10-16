---
name: Claude — Conversation
description: The operations available on conversation in Claude: Open, Pin / unpin, Rename…, Copy the conversation id, Delete conversation. Use when the user asks how to do one of these.
---
# Conversation

One conversation in the library.

Right-clicking this area (`claude-workspace.conversation`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Open | `claude-workspace.conversation.open` | — |
| Pin / unpin | `claude-workspace.conversation.pin` | — |
| Rename… | `claude-workspace.conversation.rename` | — |
| Copy the conversation id | `claude-workspace.conversation.copy-id` | — |
| Delete conversation | `claude-workspace.conversation.delete` | destructive |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
