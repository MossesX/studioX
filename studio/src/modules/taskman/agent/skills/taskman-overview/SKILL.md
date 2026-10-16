---
name: Task Manager — overview
description: What Task Manager is, the route it lives at, and the surfaces it publishes. Use for any question about what this module is for or where to find it.
---
# Task Manager

Multi-list task, todo and note manager ported from GizmoX's taskflow: nested trees with progress counts, and floating per-list windows. The dashboard's tasks card reads its store.

## Where it is

- Route: `/taskman`
- Module id: `taskman` — contributions target it as `module:taskman`
- Glyph: `icon-layers`

## What it publishes

- `taskman.item-action` — An action offered on the selected task item. Payload: `label` (button text) and `command` (a core command-registry name fired on click).

## Surfaces

- Context areas: `taskman.item`, `taskman.list`, `taskman.surface`
- Settings: 4 row(s) under `taskman-settings`
- Navigation: none declared
