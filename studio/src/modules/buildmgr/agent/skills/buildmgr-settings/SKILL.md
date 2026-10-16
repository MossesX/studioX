---
name: Build Manager — settings
description: Every setting Build Manager persists: Live-run poll interval (ms). Use when asked what a setting does, where it is, or what it defaults to.
---
# Build Manager settings

Stored under the kv namespace `buildmgr-settings`. The user reaches them through the
gear on the module header, or the "Module settings" row on any right-click.

| Setting | Key | Kind | Default | What it does |
| --- | --- | --- | --- | --- |
| Live-run poll interval (ms) | `pollMs` | number | `1200` | How often a live run's event stream is fetched. Lower is more live; higher is kinder to the machine. |

Quote the hint when the user asks what a row means — it is the text they can see beside
it, so an answer that agrees with it is an answer they can check.
