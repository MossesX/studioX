---
name: Claude — settings
description: Every setting Claude persists: Show extended thinking, Expand tool calls by default, Enter sends the message. Use when asked what a setting does, where it is, or what it defaults to.
---
# Claude settings

Stored under the kv namespace `claude-workspace-settings`. The user reaches them through the
gear on the module header, or the "Module settings" row on any right-click.

| Setting | Key | Kind | Default | What it does |
| --- | --- | --- | --- | --- |
| Show extended thinking | `showThinking` | switch | `true` | Render the model's thinking blocks, folded. Off hides them entirely. |
| Expand tool calls by default | `autoExpandTools` | switch | `false` | Open each tool card as it arrives instead of on click. |
| Enter sends the message | `sendOnEnter` | switch | `true` | Off swaps the keys: Enter breaks the line and Ctrl+Enter sends. |

Quote the hint when the user asks what a row means — it is the text they can see beside
it, so an answer that agrees with it is an answer they can check.
