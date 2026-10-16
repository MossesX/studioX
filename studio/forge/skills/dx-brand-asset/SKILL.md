---
name: dx-brand-asset
description: >
  Add, edit or regenerate assets in the GizmoX branding package — icons, logos, animated
  logos, watermarks, marks, wordmarks, lockups, badges, patterns and spinners. Use when asked
  to "add an icon/logo/watermark to the brand pack", "make a new animated mark", "change the
  brand colours", "regenerate the branding package", or when a branding asset renders wrong.
---

# Working on the branding package

## The rule that governs everything here

**Nothing in `assets/installed/branding-package/` is hand-authored.** Every one of the 366
SVGs is composed by `scripts/gen-branding-pack.ts` from the glyph vocabulary in
`scripts/branding/glyphs.ts`. Editing a file on disk is therefore *pointless* — the next
regeneration overwrites it, and the catalogue keeps describing what the generator produced.

Edit the generator. Re-run it. That is the whole workflow.

## Adding a glyph (a new icon shape)

`scripts/branding/glyphs.ts` → the `GLYPHS` record. A glyph is a function taking
`GlyphColors` and returning inner SVG markup in a **100 × 100** user space:

```ts
bookmark: (c) =>
  fill("M26 10h48v80L50 70 26 90Z", P(c)) +
  stroke("M26 10h48v80L50 70 26 90Z", { color: S(c), width: 4 }),
```

Helpers available: `stroke` · `fill` · `circle` · `ring` · `rect` · `label` · `mark` ·
`plate` · `hexPath`. Stroke weight is 7 units by default, round caps and joins — matching
that is what keeps a 16px icon and a 512px watermark looking like the same system.

Adding a glyph automatically adds an `icon-<name>` entry. To also get an animated version,
add it to `ANIMATED_ICON_PLAN` in `scripts/gen-branding-pack.ts` with a motion family.

## Colour — never write a literal

Every colour is `v("<role>")`, which emits `var(--gxb-<role>, <hex>)`. Roles: `accent`
`accent2` `accent3` `ink` `dim` `edge` `page` `ok` `warn` `err`.

This is not a style preference. It is what makes the entire pack recolourable with no SVG
parsing and no rebuild — and the hex fallback is what makes a file opened straight off disk
still look right.

Since 2026-08-01 those roles are **published from the live theme**, so a literal does not just
resist the palette editor — it makes your asset the one thing on screen that ignores the user's
theme. `src/lib/brand/roles.ts` derives the bag; `GlobalThemeBridge` writes it to `:root` and
`settingsThemeStyle` to a per-surface wrapper. Two things follow for a new glyph:

- **Use `accent2`/`accent3` for secondary detail, not a second call to `accent`.** A colour
  theme turns that pair by the same hue angle it moved the accent, so a triad stays a triad.
- **Use `ink`/`dim`/`edge`/`page` for surfaces.** A full theme repaints those; a hardcoded
  near-white becomes invisible the moment somebody picks a light theme.

The entry's `roles` field is **derived** by scanning the produced SVG (`rolesUsed`), so it can
never claim a role the drawing does not use. Don't try to set it by hand.

## Motion

Animation is **SMIL inside the SVG** (`<animate>`, `<animateTransform>`, `<animateMotion>`),
never JavaScript. That is why a pack of 366 assets costs nothing to render and why the
"animated branding off" switch can freeze them by hiding the animation elements.

Families: `spin` `pulse` `orbit` `sweep` `draw` `float` `flicker` `morph` `shimmer`.
The `animate()` helper applies any of them to arbitrary inner markup.

## Category quotas

Twelve categories, and the generator **refuses to write** if any drops below 25 — that gate
exists because the pack's whole value is having a real option in every category, not one
token example plus eleven full shelves.

## Run it

```bash
node --import ./test/alias-hook.mjs scripts/gen-branding-pack.ts --dry
node --import ./test/alias-hook.mjs scripts/gen-branding-pack.ts
```

`--dry` validates the manifest against the `branding-package` schema, prints the per-category
counts and writes nothing. Always run it first.

The real run rewrites the install directory, `pack.json`, `manifest.json`, the archive zip and
the registry entry — then re-stats every file and re-reads the registry before reporting
success. Do not report it done on the strength of the log alone.

## Verify in the app

`/documentationx` → the Branding pane:

- **Tree** and **Grid** tabs should both show your new asset under its category;
- the **Palette** tab should repaint it when you change a role it uses;
- the **Placement** tab should offer it in every slot's dropdown.

## The traps

- **`<img src="…svg">` ignores the roles.** CSS custom properties do not cross into an
  external image. Inline the source — which is what `BrandAsset` does.
- **Sizes are nominal.** `size` is the ladder position, not a hard render size; the browser
  scales the same 100×100 drawing.
- **Ids are addresses.** A placement stores an entry id. Renaming an entry silently empties
  whatever chrome slot was pointed at it.
