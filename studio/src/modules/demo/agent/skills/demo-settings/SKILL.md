---
name: Core Inspector — settings
description: Every setting Core Inspector persists: Show the capabilities card. Use when asked what a setting does, where it is, or what it defaults to.
---
# Core Inspector settings

Stored under the kv namespace `demo-settings`. The user reaches them through the
gear on the module header, or the "Module settings" row on any right-click.

| Setting | Key | Kind | Default | What it does |
| --- | --- | --- | --- | --- |
| Show the capabilities card | `showCapabilities` | switch | `true` | The core's full self-description — 20+ entries. Off keeps the inspector to the live registries. |

Quote the hint when the user asks what a row means — it is the text they can see beside
it, so an answer that agrees with it is an answer they can check.
