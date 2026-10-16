---
name: Task Manager — extension points
description: The points Task Manager publishes and what a contribution to each must carry. Use for "how do I add to this module" and for diagnosing a contribution that renders nothing.
---
# What plugs into Task Manager

A plugin contributes to one of these points; the module never imports the plugin. This is
also the closure rule the peel uses — a plugin is carried into this module's standalone
app exactly when it contributes to a point starting with `taskman.`.

## `taskman.item-action` — Item action

An action offered on the selected task item. Payload: `label` (button text) and `command` (a core command-registry name fired on click).

- Kind: command · cardinality: many
- Payload must carry: `label`, `command`
- Ordering: priority

A contribution missing a required field is refused at registration and the pane renders
the boundary, not the payload — check the registry report before assuming the component
is at fault.
