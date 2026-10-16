---
name: Firecrawl — Dataset
description: The operations available on dataset in Firecrawl: Open in Data view, Export as JSON, Export as Markdown, Export as CSV, Copy contents, Delete dataset. Use when the user asks how to do one of these.
---
# Dataset

A saved dataset row in the rail.

Right-clicking this area (`firecrawl.dataset`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Open in Data view | `firecrawl.dataset.view` | — |
| Export as JSON | `firecrawl.dataset.export-json` | — |
| Export as Markdown | `firecrawl.dataset.export-md` | — |
| Export as CSV | `firecrawl.dataset.export-csv` | — |
| Copy contents | `firecrawl.dataset.copy` | — |
| Delete dataset | `firecrawl.dataset.delete` | destructive |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
