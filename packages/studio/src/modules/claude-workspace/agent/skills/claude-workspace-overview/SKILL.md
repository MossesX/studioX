---
name: Claude — overview
description: What Claude is, the route it lives at, and the surfaces it publishes. Use for any question about what this module is for or where to find it.
---
# Claude

The workspace over the Claude subsystem: a streaming transcript with syntax-highlighted code, foldable thinking, expandable tool calls, nested subagent runs and file-edit diffs; a multiline composer with history and slash completion; and a searchable conversation library.

## Where it is

- Route: `/claude`
- Module id: `claude-workspace` — contributions target it as `module:claude-workspace`
- Glyph: `icon-chat`

## What it publishes

- `claude-workspace.panel` — A pane in the workspace's side column: a title, an optional glyph and a component the workspace mounts. The panel reads the open conversation from the module's own store rather than being handed props, so a contribution is a component and not a protocol.
- `claude-workspace.composer-action` — A button beside the composer: a label, an optional glyph, and a run() that may return text to insert at the caret. Returning text rather than writing to the composer is what keeps a contribution from needing a handle on the editor.

## Surfaces

- Context areas: `claude-workspace.surface`, `claude-workspace.transcript`, `claude-workspace.message`, `claude-workspace.tool`, `claude-workspace.composer`, `claude-workspace.library`, `claude-workspace.conversation`, `claude-workspace.projects`, `claude-workspace.project`
- Settings: 3 row(s) under `claude-workspace-settings`
- Navigation: none declared
