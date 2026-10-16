---
name: Firecrawl — Workflow
description: The operations available on workflow in Firecrawl: Run workflow, Duplicate, Export as JSON, Delete workflow. Use when the user asks how to do one of these.
---
# Workflow

A workflow row in the rail — the pipeline the pointer is over.

Right-clicking this area (`firecrawl.workflow`) composes these rows, plus every row the
areas around it contribute — the map walks outward through the DOM, so an item row
inside a surface offers both.

## Rows

| Row | Command | Notes |
| --- | --- | --- |
| Run workflow | `firecrawl.workflow.run` | — |
| Duplicate | `firecrawl.workflow.duplicate` | — |
| Export as JSON | `firecrawl.workflow.export` | — |
| Delete workflow | `firecrawl.workflow.delete` | destructive |

Name the row the user should click. The command id is what the row runs — say it only
when the user is writing code or a binding against it.
