---
name: dx-layout-system
description: >
  Add, regenerate or debug a DocumentationX layout system — one of the 40 `dx-layout-*`
  layout-theme assets the toolbar roller cycles through. Use when asked to "add a layout
  system", "regenerate the layouts", "make a new dock arrangement", or when a rolled layout
  is invalid, looks identical to another, or drops a pane.
---

# Working on the 40 layout systems

## What a layout system actually is

A `layout-theme` asset: a layout **tree** over DocumentationX's ten declared slots, plus a
value for every one of the 175 theme-spec fields. Not a stylesheet, not a CSS file — a
schema-validated payload rolled by a seeded generator.

**The seed is the layout.** `dx-layout-atrium` is `rollTheme({ seed: "dx-atrium", chaos: 0.10 })`
against the DocumentationX registry. Delete the asset, re-run the generator, get the identical
bytes back. That property is why there is no hand-authored layout anywhere in this framework.

## Adding one

`scripts/gen-dx-layouts.ts` → the `SYSTEMS` table:

```ts
{ slug: "atrium", label: "Atrium", chaos: 0.10,
  blurb: "Wide central document with a calm catalogue rail" },
```

- `slug` becomes the asset id `dx-layout-<slug>` and the seed `dx-<slug>`.
- `chaos` is the generator's deviation knob, 0–1. The shipped ladder runs 0.10 (orthodox) to
  0.92 (wild) — keep new entries inside a band that is not already crowded, or you get a
  visually redundant asset.
- `blurb` goes into the manifest description and the roller's toast.

Then:

```bash
node --import ./test/alias-hook.mjs scripts/gen-dx-layouts.ts --dry
node --import ./test/alias-hook.mjs scripts/gen-dx-layouts.ts
```

`--dry` rolls everything, validates every manifest against the layout-theme schema, reports
how many are **structurally distinct**, and writes nothing. It refuses outright if fewer than
half the systems have distinct trees — forty assets are only worth having if they differ.

The real run scaffolds, validates, zips, registers and then re-stats manifest + zip + registry
entry for all forty before printing success.

## Changing what the generator has to work with

The tree can only place slots the registry declares. That is
`src/lib/theme-engine/pilots/documentationx.ts` — ten slots, each with a data `shape`,
`capabilities`, minimum size, `priority`, `collapse` mode and `affinity`.

Adding a slot there changes **every** rolled layout. Bump the registry `version` when you do,
because a payload snapshots the slot id list it was placed against (`payload.slots`), which is
what makes the change visible instead of silent.

## Debugging a bad roll

| Symptom | Cause | Where |
| --- | --- | --- |
| Ajv rejects `/payload/tree` | a container exceeded a schema cap (split ≤ 8 children) | `generate.ts` → `splitNode` nests the overflow |
| A pane never appears | its slot has `collapse: "hide"` and low `priority` | raise the priority or change the collapse mode in the pilot |
| Two systems look identical | their chaos values are adjacent and the seeds landed close | move one seed's chaos to a less crowded band |
| A renderer setting does nothing | the slot's `capabilities` cannot express it | `eligibleRenderers` guards it — the theme value is inert, not broken |
| Content got buried | it would need `collapse: "never"` | only `content` has it, deliberately |

## What the module does with it

`src/lib/documentationx/layouts.ts`:

- `fetchLayouts()` → `/api/full-themes?asset=documentationx` (this asset's own + universal).
- `dockFor(layout)` → `dockFromLayout(payload.tree)`: `slot` → a one-tab group, `split` stays a
  split, `tabs`/`stack`/`grid` all become one multi-tab group. That last collapse is
  deliberate — once panes are user-draggable, a rolled stack and a rolled tab strip are the
  same thing to the user.
- `varsFor(layout)` → `fullThemeTokens(payload.values)`, which emits **both** `--gxt-*` and
  `--gxs-*`. Emitting only the first would theme the engine's preview and nothing else.
- `rollLayout()` never returns the current one — a roller that can no-op reads as broken.

## Verify

`/documentationx` → press **Roll layout**. Confirm the status strip's `LAYOUT` field changes,
the dock rebuilds, and `--gxt-accent` on the root element moves. Three presses, three
different arrangements, or the ladder needs spreading out.
