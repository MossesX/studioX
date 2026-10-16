---
name: Firecrawl — settings
description: Every setting Firecrawl persists: Auto-save run results, Analysis input budget (characters), Default loop limit, Default data view. Use when asked what a setting does, where it is, or what it defaults to.
---
# Firecrawl settings

Stored under the kv namespace `firecrawl-settings`. The user reaches them through the
gear on the module header, or the "Module settings" row on any right-click.

| Setting | Key | Kind | Default | What it does |
| --- | --- | --- | --- | --- |
| Auto-save run results | `autosaveDatasets` | switch | `true` | Save every finished run's final output as a dataset automatically. |
| Analysis input budget (characters) | `analyzeBudget` | number | `24000` | How much scraped text an Analyze step feeds the model. Bigger reads more of each page; smaller is faster and cheaper. |
| Default loop limit | `loopLimit` | number | `10` | How many links a new Loop step follows before stopping. Each iteration costs scrapes and analysis. |
| Default data view | `defaultView` | select (auto \| json \| markdown \| table \| raw) | `auto` | The format the Data panel opens a dataset in. |

Quote the hint when the user asks what a row means — it is the text they can see beside
it, so an answer that agrees with it is an answer they can check.
