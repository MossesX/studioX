---
name: dx-topic
description: >
  Add or repair a DocumentationX topic — an authored page in the framework's documentation
  browser, with its examples, external sources and cross-references. Use when asked to
  "document <thing> in DocumentationX", "add a topic/page/section to the docs browser",
  "write docs for <framework feature>", or when a DocumentationX page is wrong, thin or
  missing. Not for md/mdx files under documentation/ (those are picked up by the disk scan
  automatically) and not for theme tokens (those are derived from the spec).
---

# Adding a DocumentationX topic

## Decide first: does this belong here at all?

DocumentationX's model has five sources and **only one of them is authored**:

| If the thing is… | It comes from | Do you write it? |
| --- | --- | --- |
| a theme token | `spec.generated.ts` via `src/lib/documentationx/tokens.ts` | **No** — edit the spec, run `npm run schemas:theme` |
| a ui / screen / dialog | the launcher census + nav rail via `uis.ts` | **No** — add a `LauncherEntry` or a `MODULES` row |
| a setting | the registered `SettingsSource` | **No** — add the `SettingDef` to that asset's `settings.ts` |
| an md/mdx file on disk | the live scan at `/api/documentationx/files` | **No** — just write the file |
| a framework *concept* | `src/lib/documentationx/corpus.ts` | **Yes** — that is this skill |

Writing a topic for something derivable is how a documentation system starts lying. If the
answer above is "No", do that instead and stop.

## The shape

Every topic answers the same four questions in the same order, because a reference whose
entries are shaped differently is a reference nobody can skim:

1. **What it is** — the definition, plus the distinction people confuse it with.
2. **When you reach for it** — and when you should reach for something else.
3. **How you actually do it** — concrete, with the real API.
4. **The trap** — the thing people get wrong. This is the part worth reading.

## The node

Add a `DxNode` to `TOPIC_NODES` in `src/lib/documentationx/corpus.ts`:

```ts
{
  id: "topic:<slug>",              // "section:" style ids use kind "section"
  kind: "topic",                    // or "section" for a child page
  title: "…",
  blurb: "One sentence. Shows in results, tooltips and grid rows.",
  path: "framework/<area>/<slug>",  // slash path — this is what builds the tree
  tags: ["…"],                      // searchable; keep them lowercase
  target: { route: "/<live-route>", anchor: "<optional doxel anchor>" },
  related: ["topic:…", "token:…"],  // backlinks are derived from this
  externals: ext("react", "web"),   // curated upstream docs, from EXTERNALS
  body: [ /* markdown lines */ ].join("\n"),
  examples: [ /* DxExample[] */ ]
}
```

### `runnable` is a promise, not a wish

Mark an example `runnable: true` **only** if the sandbox can genuinely execute it. Anything
importing `@/lib/...` cannot — the module graph is not in the sandbox. Those are
`runnable: false` and the run icon is not offered. A run button that always errors is worse
than no button.

Runnable in the sandbox: `js` `jsx` `ts` `tsx` `html` `css` `json` `yaml` `toml` `python`
(Pyodide, lazy-loaded). **`bash` is never executed** — shown for copying only.

### Externals are not decoration

`EXTERNALS` in the same file is curated *off-framework* help — React, TypeScript, Next, MUI,
MDN, JSON Schema, Python, MDX, WCAG. Each entry carries a `why` explaining what it is doing
there. Add to an existing bucket rather than inventing a near-duplicate one.

## Verify

```bash
npm run typecheck
```

Then load `/documentationx` and confirm three things, because "it compiled" is not evidence:

1. the node appears in the catalogue tree under its `path`;
2. `kind:topic <your title>` finds it in the search pane;
3. every example with `runnable: true` actually runs and prints something.

## The traps in this task

- **`path` builds the tree.** A path with no shared prefix produces a lonely top-level row.
  Look at what is already under `framework/` before inventing a new root.
- **`related` is one-directional.** Backlinks are derived, so linking A→B makes B show "linked
  from A" for free. You do not add the reverse by hand.
- **Ids are addresses.** `/documentationx?open=<id>` is a deep link people will save. Renaming
  an id breaks it silently.
