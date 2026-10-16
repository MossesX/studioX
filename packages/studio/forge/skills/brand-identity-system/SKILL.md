---
name: brand-identity-system
description: >
  Turn one mark into a coherent identity — palette construction with real contrast targets,
  type pairing, a spacing/clear-space system, and the usage rules and deliverable set a pack
  needs. Use when asked for brand colours, a palette, font pairing, a style guide, usage
  rules, clear space, or "make this logo into a brand/pack".
allowed-tools: Read, Write, Edit, Glob, Grep, WebSearch, WebFetch
---

# One mark → a system

An identity is four systems that agree with each other: **colour, type, space, and usage**. Do
them in that order; each one constrains the next.

## 1. Palette — build a ramp, not a mood board

Start from the mark's single accent, then derive. A palette is 3 required roles + 4 optional:

| Role | Count | Rule |
| --- | --- | --- |
| **accent** | 1 (2 max) | the brand colour. Must hold ≥ 4.5:1 against BOTH the darkest and lightest surface, or you ship two tuned variants (one for light UI, one for dark). |
| **surface** | 2–3 | page / panel / raised. Steps of 4–8% lightness, not 20% — a surface ramp should be felt, not seen. |
| **ink** | 2–3 | primary text, dim text, disabled. Primary ≥ 7:1 on page, dim ≥ 4.5:1, disabled ≥ 3:1. |
| edge | 1 | borders/dividers, 1.5–3:1 against its surface. Higher and it becomes a design element. |
| status | 4 | ok / warn / err / info, all ≥ 4.5:1 on page. Never reuse the accent as a status colour. |

Construction, concretely:

1. Fix the accent in **OKLCH terms** (hue + chroma + lightness) even if you ship hex — that is
   what lets you build tints/shades that stay the same colour. Steps of ±0.06 L for hover/press
   states, chroma held constant.
2. Build the neutral ramp **hue-shifted toward the accent** by 5–15% chroma, not pure grey.
   That is what makes a neutral feel like it belongs to the brand.
3. **Verify contrast, never assume it.** Compute the ratio for every ink-on-surface and
   accent-on-surface pair and put the numbers in the deliverable. "Looks fine" is not a
   contrast check. Targets: body text 4.5:1 (AA), large/display 3:1, UI borders 1.5:1+,
   focus rings 3:1 against both the control and its surround.
4. **One-ink test**: convert the whole palette to greyscale. Anything that collapses into its
   neighbour cannot carry meaning on its own — pair it with a shape or a label.
5. Cap it. **5–7 colours total**, plus statuses. A twelve-colour brand palette is an
   un-enforceable brand palette.

State every colour as hex **and** its role name. A palette without role names is decoration;
the roles are what a theme, a pack, or a developer actually consumes.

## 2. Type pairing — two faces, one voice

Two typefaces is the target: **display** (headings, wordmark support) and **text** (everything
else). A third is only for `mono`.

Pairing rules that actually predict success:

- **Contrast the skeleton, match the proportions.** A geometric sans display over a humanist
  sans text works because the skeletons differ; two humanist sans faces just look like a
  mistake. Match **x-height ratio within ~5%** and **cap-height within ~3%**, or the pair will
  never sit on a line together.
- **Match the era or commit to the clash.** Didone + grotesque is a decision; Didone + a 1996
  techno face is an accident.
- **Check the numerals**: the text face needs tabular figures for any UI with data. The display
  face needs decent lining figures or the wordmark will fight itself.
- **Weight availability beats beauty.** You need at least 400/600/700 in the text face. A
  gorgeous face with one weight cannot build hierarchy.
- **Wordmark ≠ text face.** The wordmark is drawn (see `logo-mark-design`); the text face just
  has to live beside it without imitating it.

**Type scale**: pick one ratio and derive everything. 1.200 (minor third) for dense UI, 1.250
(major third) for product, 1.333 (perfect fourth) for marketing. Base 16 px, 6 steps up, 2
down. Line height 1.5 for body, 1.15–1.25 for display, and **never** a fractional px size.

Ship: face names, real fallback stacks, the scale table (px + rem + line-height + weight +
letter-spacing), and which step each role uses.

## 3. Space — everything in one unit

- **Spacing unit = 8 px** (4 px allowed as a half step). Every gap, pad and inset is a multiple.
  No 13 px anything.
- **Clear space around the logo = 1 cap height of the wordmark** (or 25% of the mark's width for
  the mark alone) on all four sides. Express it in the mark's own units so it survives scaling —
  never in px.
- **Minimum sizes**: full lockup and mark-alone, each stated in px width and mm width. Derive
  them from where the thinnest feature hits 1.5 px / 0.3 mm.
- **Placement grid**: state the corner offsets for the three common placements (header,
  footer, watermark) as multiples of the spacing unit.

## 4. Usage rules — write the don'ts, they're the whole point

The dos are obvious; the identity survives on the don'ts. Write each as a single imperative
with the reason:

- Do not stretch, skew or rotate the mark — the stroke weight system dies immediately.
- Do not recolour outside the palette roles; the mark has an accent variant, a mono variant and
  a knockout variant, and that is the whole set.
- Do not place the full-colour mark on a background between 30% and 70% lightness — use
  knockout or mono there.
- Do not add effects: no drop shadow, no outer glow, no gradient the pack does not define.
- Do not re-typeset the wordmark. It is a drawing.
- Do not crop the mark or use a fragment of it as a pattern unless the pack ships that pattern.
- Do not put anything inside the clear space.

## 5. The deliverable set

A pack is not "the logo.svg". Minimum:

- **Mark**: full colour, mono black, mono white (knockout), each as SVG.
- **Wordmark**: same three.
- **Lockups**: horizontal + stacked, same three.
- **Raster ladder**: favicon 16/32/48 (+ `.ico`), app icon 512/1024, social avatar 800,
  social banner 1500×500, nav lockup 480×120.
- **Palette**: hex + role names + measured contrast table.
- **Type**: faces, fallbacks, scale table.
- **Rules**: clear space, minimum sizes, the don'ts.

Logo Studio composes most of that ladder for you — the real list of purposes/sizes is
`src/modules/logo-studio/pack-purposes.ts` (favicon master, app icon, nav lockup, letterhead,
business card, watermark, social avatar/banner…). Design against that list rather than an
invented one, and the pack export fills itself in.

## 6. Hand-off into GizmoX

When the identity becomes a real asset, the palette roles map onto the branding package's role
variables — `--gxb-accent`, `--gxb-page`, `--gxb-ink`, `--gxb-dim`, `--gxb-edge`, `--gxb-ok`,
`--gxb-warn`, `--gxb-err`. Naming your palette with those role names from the start is what lets
the pack recolour from the live theme instead of being repainted by hand. The mechanics live in
the `gizmox-brand-assets` skill; the naming decision is made here.
