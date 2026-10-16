---
name: Forge — settings
description: Every setting Forge persists: Confirm deletes. Use when asked what a setting does, where it is, or what it defaults to.
---
# Forge settings

Stored under the kv namespace `forge-settings`. The user reaches them through the
gear on the module header, or the "Module settings" row on any right-click.

| Setting | Key | Kind | Default | What it does |
| --- | --- | --- | --- | --- |
| Confirm deletes | `confirmDelete` | switch | `true` | Ask before deleting an agent, skill, tool or MCP server entry. Nothing here has an undo. |

Quote the hint when the user asks what a row means — it is the text they can see beside
it, so an answer that agrees with it is an answer they can check.
