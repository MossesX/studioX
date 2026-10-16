---
name: Core Inspector — extension points
description: The points Core Inspector publishes and what a contribution to each must carry. Use for "how do I add to this module" and for diagnosing a contribution that renders nothing.
---
# What plugs into Core Inspector

A plugin contributes to one of these points; the module never imports the plugin. This is
also the closure rule the peel uses — a plugin is carried into this module's standalone
app exactly when it contributes to a point starting with `demo.`.

## `demo.badge` — Header badge

A small badge rendered in the inspector header. Proves a ui-surface contribution reaches the screen through the host's slot rather than through a direct import.

- Kind: ui-surface · cardinality: many
- Payload must carry: `label`, `tone`
- Ordering: priority

## `demo.note` — Inspector note

A line of text contributed into the inspector body. Exists so a second point with different cardinality and payload is exercised, not just one.

- Kind: value · cardinality: many
- Payload must carry: `text`
- Ordering: priority

A contribution missing a required field is refused at registration and the pane renders
the boundary, not the payload — check the registry report before assuming the component
is at fault.
