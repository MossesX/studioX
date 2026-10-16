---
name: Claude — extension points
description: The points Claude publishes and what a contribution to each must carry. Use for "how do I add to this module" and for diagnosing a contribution that renders nothing.
---
# What plugs into Claude

A plugin contributes to one of these points; the module never imports the plugin. This is
also the closure rule the peel uses — a plugin is carried into this module's standalone
app exactly when it contributes to a point starting with `claude-workspace.`.

## `claude-workspace.panel` — Workspace panel

A pane in the workspace's side column: a title, an optional glyph and a component the workspace mounts. The panel reads the open conversation from the module's own store rather than being handed props, so a contribution is a component and not a protocol.

- Kind: ui-surface · cardinality: many
- Payload must carry: `title`, `render`
- Ordering: priority

## `claude-workspace.composer-action` — Composer action

A button beside the composer: a label, an optional glyph, and a run() that may return text to insert at the caret. Returning text rather than writing to the composer is what keeps a contribution from needing a handle on the editor.

- Kind: command · cardinality: many
- Payload must carry: `id`, `label`, `run`
- Ordering: priority

A contribution missing a required field is refused at registration and the pane renders
the boundary, not the payload — check the registry report before assuming the component
is at fault.
