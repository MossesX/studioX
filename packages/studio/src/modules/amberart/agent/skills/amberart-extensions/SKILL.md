---
name: AmberArt — extension points
description: The points AmberArt publishes and what a contribution to each must carry. Use for "how do I add to this module" and for diagnosing a contribution that renders nothing.
---
# What plugs into AmberArt

A plugin contributes to one of these points; the module never imports the plugin. This is
also the closure rule the peel uses — a plugin is carried into this module's standalone
app exactly when it contributes to a point starting with `amberart.`.

## `amberart.tool` — AmberArt tool

A tool in AmberArt's rail. The contribution supplies an id, a title, a pack glyph and a `load` thunk that imports the panel; the panel is handed a ToolHost that can read the canvas size, place an SVG onto the active layer (undoably) and raise a message — and nothing else. A thunk rather than the component itself so the entry stays importable by plain Node, which the closure resolver requires.

- Kind: ui-surface · cardinality: many
- Payload must carry: `id`, `title`, `glyph`, `load`
- Ordering: priority

A contribution missing a required field is refused at registration and the pane renders
the boundary, not the payload — check the registry report before assuming the component
is at fault.
