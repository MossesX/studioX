---
name: Core Inspector — overview
description: What Core Inspector is, the route it lives at, and the surfaces it publishes. Use for any question about what this module is for or where to find it.
---
# Core Inspector

Shows what the core actually knows about itself: booted subsystems, registered modules, declared extension points, live contributions, theme tokens and the peel closure.

## Where it is

- Route: `/demo`
- Module id: `demo` — contributions target it as `module:demo`
- Glyph: `icon-eye`

## What it publishes

- `demo.badge` — A small badge rendered in the inspector header. Proves a ui-surface contribution reaches the screen through the host's slot rather than through a direct import.
- `demo.note` — A line of text contributed into the inspector body. Exists so a second point with different cardinality and payload is exercised, not just one.

## Surfaces

- Context areas: `demo.inspector`
- Settings: 1 row(s) under `demo-settings`
- Navigation: `demo-nav`
