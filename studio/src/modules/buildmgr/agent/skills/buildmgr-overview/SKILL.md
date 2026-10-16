---
name: Build Manager — overview
description: What Build Manager is, the route it lives at, and the surfaces it publishes. Use for any question about what this module is for or where to find it.
---
# Build Manager

Runs `.bmpx` build projects through the real builder: the plan outline, per-step models and costs, the model switches, and a live run driven by the NDJSON event stream.

## Where it is

- Route: `/buildmgr`
- Module id: `buildmgr` — contributions target it as `module:buildmgr`
- Glyph: `icon-play`

## What it publishes

- No extension points: nothing plugs into this module.

## Surfaces

- Context areas: none declared (the universal menu still covers every click)
- Settings: 1 row(s) under `buildmgr-settings`
- Navigation: none declared
