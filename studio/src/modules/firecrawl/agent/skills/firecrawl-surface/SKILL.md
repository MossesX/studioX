---
name: Firecrawl surface
description: The operations available on firecrawl surface in Firecrawl: New workflow, Add example workflow, Refresh from disk. Use when the user asks how to do one of these.
---
# Firecrawl surface

Anywhere on the screen, including empty space.

Right-clicking this area (`firecrawl.surface`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| New workflow | `firecrawl.new-workflow` | — |
| Add example workflow | `firecrawl.example` | — |
| Refresh from disk | `firecrawl.refresh` | — |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
