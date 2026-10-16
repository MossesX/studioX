---
name: logo-mark-design
description: >
  Design a logo mark, monogram, wordmark or lockup as real SVG — grid construction, optical
  balance, stroke discipline and the favicon-to-billboard scale ladder. Use when asked to make
  or fix a logo, mark, monogram, wordmark, emblem, app icon or favicon, when a mark "looks off"
  or "disappears when small", or when a Logo Studio layer needs to be drawn or redrawn.
allowed-tools: Read, Write, Edit, Glob, Grep, WebSearch, WebFetch
---

# Drawing a mark that holds

A logo is not a picture, it's a **shape system under constraint**. Everything below is that
constraint set. Work it in order — grid, silhouette, weight, counters, scale ladder, checks.

## 1. Pick the construction grid before you draw a curve

Never draw free-hand and correct later; that is how a mark ends up with seven near-identical
radii and no rhythm.

| Grid | Box | Unit | Use it for |
| --- | --- | --- | --- |
| Icon grid | `viewBox="0 0 24 24"` | 1 | UI icons, favicon masters, toolbar glyphs |
| Mark grid | `viewBox="0 0 64 64"` | 4 | monograms, emblems, app-icon masters |
| Master grid | `viewBox="0 0 512 512"` | 32 | the primary mark, anything with detail |
| Lockup grid | `viewBox="0 0 W H"`, cap-height derived | cap/8 | mark + name together |

Rules on the grid:

- **Every coordinate lands on a unit or a half-unit.** `x="16"` or `x="14"`, never `x="15.37"`.
- **Reuse radii from a fixed set.** Pick three (e.g. `2 / 6 / 16` on a 64 grid) and use only
  those. Four unrelated radii read as sloppiness even when nobody can name why.
- **Keyline shapes**: a square, a circle and a horizontal rectangle of equal *optical* weight
  are not equal *measured* size. On a 64 grid: square 44, circle 48, portrait rect 40×48. Match
  area, not bounding box.
- **Live area / trim**: keep the drawing inside the central 80% of the box (a 64 grid gets a
  6-unit margin all round). That margin *is* the clear space when the mark is placed later.

## 2. Silhouette first, detail never

Draw the mark as a solid black silhouette on the grid and judge it there. If it does not read
as a distinct shape in solid black, no gradient, colour, shadow or inner detail will save it.
Only after the silhouette holds do you split it into strokes, counters and colour.

**Squint test**: blur it mentally (or actually — render at 16px and scale it back up). What
survives is the mark. What vanishes was decoration.

## 3. Stroke weight is one decision, not per-path

- **One weight per mark**, expressed in grid units: 2 on a 24 grid, 6 on a 64 grid, 44 on a 512
  grid (all ≈ 8.5% of the box). A deliberate secondary weight is allowed at exactly **half** or
  **double** the primary, nothing in between.
- Prefer **filled paths over `stroke`** for the final mark: strokes scale with `transform` in
  ways that surprise (and `vector-effect` is a patch, not a plan). Convert strokes to outlines
  for the deliverable; keep a stroked working copy if you need to iterate weight.
- If you must keep strokes: set them on the parent `<g>`, never per-path, and use
  `stroke-linejoin="round"` / `stroke-linecap="round"` consistently — mixed joins are the
  single most visible amateur tell.

## 4. Counters and optical balance

- **Counters (the holes) need at least the stroke weight**, and preferably 1.25×. A counter
  narrower than the stroke fills in with ink, with anti-aliasing, and at small size.
- **Optical centring beats mathematical centring.** A triangle centred on its bounding box
  looks low; nudge it up ~4% of the box. A circular mark in a square frame wants to be ~2%
  larger than the square's inscribed circle to feel the same size.
- **Overlaps punch, they don't stack.** Where two forms cross, either knock the overlap out
  (`fill-rule="evenodd"` on a merged path) or make it a deliberate third value. Two shapes
  simply layered at full opacity is a collage, not a mark.
- **Junction thinning**: where strokes meet at an acute angle, the ink pools. Trim 5–10% of the
  weight into the junction so it reads even.

## 5. The scale ladder — favicon to billboard

Every mark ships as a **family of simplifications**, not one file scaled up and down. Decide at
each rung what gets dropped.

| Rung | Size | What survives |
| --- | --- | --- |
| Favicon | 16 / 24 / 32 px | silhouette only. One shape, one counter, no inner detail, no gradient, no thin stroke. Draw this rung by hand. |
| UI / toolbar | 24 / 32 px | silhouette + one counter. `currentColor` so it themes. |
| Avatar / app icon | 512 / 1024 px | full mark, circular-safe (nothing important outside the inscribed circle). |
| Nav lockup | ~480 × 120 | mark + wordmark, cap-height aligned. |
| Print / card | 300 dpi, one ink | full mark as a **single-colour** composition; no tints below 20%. |
| Billboard | vector, viewed at distance | full mark; check it at 5% zoom — that is what 200 m looks like. |

**The favicon rung is a redraw, not an export.** If the 512 mark has three counters, the 16px
version has one. Say that out loud when you deliver, and offer the simplified file.

**Minimum sizes** go in the deliverable: state the smallest px width the full mark is allowed
(usually where the thinnest feature hits 1.5 px) and the smallest for the mark-only version.

## 6. Monogram / wordmark / lockup anatomy

- **Monogram**: 1–2 letters, treated as *shape*, not type. Redraw the letterforms on the grid;
  never just set a font and call it a monogram. Watch the two failure modes: an ambiguous pair
  (a mirrored letter reading as the wrong glyph) and a counter that closes at small size.
- **Wordmark**: start from a real typeface, then customise 2–3 letters maximum (the ligature,
  the terminal, one counter). Track it tighter than body text but never so tight that adjacent
  letters kiss. Optically letterspace — equal *area* between letters, not equal distance.
- **Lockup**: mark and name locked at a fixed relationship, expressed in **cap heights**.
  Horizontal: gap = 0.5 cap, mark height = 1.4 cap, baselines aligned optically. Stacked: gap =
  0.6 cap, name centred on the mark's optical centre. Clear space around the whole lockup = 1
  cap on all sides. Ship the lockup as its own file; never let a layout engine re-derive it.

## 7. SVG craft — what a deliverable looks like

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Ember monogram">
  <title>Ember monogram</title>
  <path d="M12 52V12h18a14 14 0 0 1 0 28H24l16 12H12z" fill="currentColor"/>
</svg>
```

- **`viewBox` always; `width`/`height` never** on a mark meant to be placed. The container
  sizes it.
- **`currentColor`** for a single-colour mark so it inherits; a named CSS variable with a hex
  fallback (`fill="var(--gxb-accent, #FF7A1A)"`) for a themed pack asset.
- **Merge paths** that share a fill. One path per colour is the target; a mark with 14 paths and
  one fill is editor cruft.
- **No editor metadata**: no `<metadata>`, no `sodipodi:*`, no `inkscape:*`, no `id="path1234"`,
  no `style="fill:#000"` where an attribute does. Round every coordinate to at most 2 decimals.
- **`<title>`** for accessibility, `role="img"` + `aria-label` when it stands alone.
- Nothing that gets rejected downstream: no `<script>`, no `javascript:`, no `on*=` handlers,
  no `<foreignObject>`.

## 8. Ship-check — run all seven before you say it's done

1. **Silhouette** — reads as one distinct shape in solid black.
2. **16 px** — render it; is it still the same idea?
3. **Mono** — works in one ink, black on white *and* white on black (invert it and look).
4. **Rotate 180°** — no accidental second reading (a shape that becomes a different letter or
   an unfortunate object).
5. **Counters** — none fill in at the minimum size.
6. **Grid** — every coordinate on a unit/half-unit; radii from the chosen set only.
7. **Placement** — drop it on the darkest and lightest background in the palette; contrast holds
   both ways.

## In Logo Studio specifically

- One `<svg>` per candidate, own `viewBox`, no absolute `width`/`height` — the layer's wrapper
  `<g>` owns position, scale and rotation (`src/modules/logo-studio/render.tsx`).
- Nothing positioned in page coordinates. A mark that assumes it sits at x=400 breaks the second
  it is dragged.
- Name the layer in human words ("Ember Monogram"), never `Layer 7`.
- A mark drawn for 512 and now living at 24 gets **offered a redraw** at the smaller rung — say
  which details you would drop.
- `src/modules/logo-studio/pack-purposes.ts` is the real list of output sizes the module
  composes (favicon master 512, app icon 1024, nav lockup 480×120, business card 1050×600…).
  Design the ladder against that list, not an invented one.
