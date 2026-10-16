---
name: Firecrawl — Workflow step
description: The operations available on workflow step in Firecrawl: Move up, Move down, Duplicate step, Delete step. Use when the user asks how to do one of these.
---
# Workflow step

A step card in the builder.

Right-clicking this area (`firecrawl.step`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Move up | `firecrawl.step.move-up` | — |
| Move down | `firecrawl.step.move-down` | — |
| Duplicate step | `firecrawl.step.duplicate` | — |
| Delete step | `firecrawl.step.delete` | destructive |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
