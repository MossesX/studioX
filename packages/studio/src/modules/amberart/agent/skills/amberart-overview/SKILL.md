---
name: AmberArt — overview
description: What AmberArt is, the route it lives at, and the surfaces it publishes. Use for any question about what this module is for or where to find it.
---
# AmberArt

The framework's paint and art program: a layered raster canvas with brush, eraser, line, rect, ellipse, flood fill and eyedropper, undo/redo history and PNG export — and a real extension point, so generative tools arrive as plugins rather than as imports.

## Where it is

- Route: `/amberart`
- Module id: `amberart` — contributions target it as `module:amberart`
- Glyph: `icon-brush`

## What it publishes

- `amberart.tool` — A tool in AmberArt's rail. The contribution supplies an id, a title, a pack glyph and a `load` thunk that imports the panel; the panel is handed a ToolHost that can read the canvas size, place an SVG onto the active layer (undoably) and raise a message — and nothing else. A thunk rather than the component itself so the entry stays importable by plain Node, which the closure resolver requires.

## Surfaces

- Context areas: `amberart.canvas`, `amberart.layer`, `amberart.surface`
- Settings: 2 row(s) under `amberart-settings`
- Navigation: none declared
