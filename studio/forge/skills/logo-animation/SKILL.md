---
name: logo-animation
description: >
  Animate a logo in SVG with SMIL or CSS keyframes so the motion survives export, drag/resize
  and rasterisation to GIF/WebM. Use when asked for an animated logo/mark, a reveal, a loop, a
  draw-on effect, a spinner, or when an animated SVG plays in the browser but exports static or
  stops moving when the layer is moved.
allowed-tools: Read, Write, Edit, Glob, Grep, WebSearch, WebFetch
---

# Motion that survives

Animated marks fail in four predictable ways: the motion is on the wrong element, the timing is
not deterministic, the trigger doesn't exist outside a browser, or the markup gets stripped by a
sanitiser. Everything here exists to avoid one of those four.

## 1. The allowed vocabulary

Two engines, both legal, different strengths:

**SMIL** — declarative, self-contained, seekable, and rasterisable frame-by-frame:

| Element | Animates | Use for |
| --- | --- | --- |
| `<animate>` | one attribute | opacity, `stroke-dashoffset`, `r`, `fill-opacity`, `d` (same node count only) |
| `<animateTransform>` | `transform` | rotate, scale, translate — `additive="sum"` to stack |
| `<animateMotion>` | position along a path | orbiting elements, a dot tracing the mark |
| `<set>` | one attribute, no interpolation | discrete state flips at a time |

**CSS keyframes** — inside a `<style>` element *in the SVG*, never in an external sheet:

```svg
<style>
  @keyframes gx-breathe { 0%,100% { opacity: .85 } 50% { opacity: 1 } }
  .gx-core { animation: gx-breathe 2.4s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) { .gx-core { animation: none } }
</style>
```

Use CSS for easing-heavy loops and staggered delays; use SMIL for anything that must be
**scrubbed or rasterised** (see §5 — `setCurrentTime()` drives SMIL and does not drive CSS).
When in doubt, SMIL.

## 2. Hard rules

1. **Motion lives INSIDE the drawing, never on the root.** In Logo Studio the layer's wrapper
   `<g>` owns position, scale and rotation (`src/modules/logo-studio/render.tsx`). An
   `animateTransform` on the root `<svg>` or on that wrapper fights the drag/resize transform
   and one of the two loses. Animate an inner `<g class="gx-anim">` instead — then the mark keeps
   playing *while* it is dragged, resized and rotated, which is the requirement.
2. **No trigger that needs an event.** `begin="click"`, `begin="mouseover"`, `:hover` rules and
   `begin="someId.end"` chains do not fire in a rasteriser, in an `<img src="data:…">` preview,
   or in most exports. Use `begin="0s"` (or a fixed offset) and `repeatCount="indefinite"`.
   Hover polish is fine as an *extra* on top of a self-starting base animation, never as the
   only motion.
3. **Deterministic timing.** A fixed `dur`, an integer-friendly total, and a loop that closes:
   the last keyframe value must equal the first, or every repeat jumps. State the total duration
   in ms — the document's playback state (`durationMs`, `loop`, `speed`) is derived from it.
4. **Never emit what the sanitiser rejects.** `<script>`, `javascript:` URLs, `on*=` handlers
   and `<foreignObject>` are refused on import (`src/modules/logo-studio/import.ts`) and in chat
   mining (`ai.ts`). The four animation elements and an inline `<style>` are allowed. Animation
   is never a reason to reach for script — there is no effect below that needs it.
5. **Honour reduced motion.** Add the `prefers-reduced-motion` media query for CSS motion, and
   for SMIL keep the still frame legible on its own (see §6) so a paused mark is still a mark.
6. **Give every animated node a class, not an id chain.** `class="gx-anim-core"` is
   re-parentable; `begin="core.begin+0.2s"` breaks the moment the tree is serialised differently.

## 3. The pattern library

**Draw-on (stroke reveal)** — the workhorse for monograms and wordmarks:

```svg
<path class="gx-draw" d="M12 52V12h18" fill="none" stroke="currentColor" stroke-width="6"
      stroke-linecap="round" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100">
  <animate attributeName="stroke-dashoffset" from="100" to="0" dur="0.9s"
           begin="0s" fill="freeze" calcMode="spline" keySplines="0.2 0 0.1 1" keyTimes="0;1"/>
</path>
```

`pathLength="100"` normalises the dash maths so the same numbers work on any path length.
`fill="freeze"` is what leaves the mark drawn at the end instead of snapping back.

**Reveal (fade + scale from the optical centre)**:

```svg
<g class="gx-reveal" opacity="0" transform-origin="32 32">
  <animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="0s" fill="freeze"/>
  <animateTransform attributeName="transform" type="scale" from="0.88" to="1" dur="0.6s"
                    begin="0s" fill="freeze" calcMode="spline" keySplines="0.2 0 0 1" keyTimes="0;1"/>
  <!-- mark paths here -->
</g>
```

Scale from `transform-origin` at the mark's optical centre, not `0 0`, or it flies in from the
corner. To stack two transforms on one node use `additive="sum"` on the second.

**Loop / breathe** — subtle, infinite, closes on itself:

```svg
<animateTransform attributeName="transform" type="scale" values="1;1.03;1" dur="3s"
                  begin="0s" repeatCount="indefinite" additive="sum"
                  calcMode="spline" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" keyTimes="0;0.5;1"/>
```

**Rotate / spin** — always around the real centre:

```svg
<animateTransform attributeName="transform" type="rotate" values="0 32 32;360 32 32"
                  dur="1.6s" begin="0s" repeatCount="indefinite"/>
```

**Orbit (`animateMotion`)** — a dot tracing a path in the mark:

```svg
<circle r="3" fill="var(--gxb-accent, #FF7A1A)">
  <animateMotion dur="4s" begin="0s" repeatCount="indefinite" rotate="auto">
    <mpath href="#gx-orbit"/>
  </animateMotion>
</circle>
```

Keep the referenced path in a `<defs>` with `id="gx-orbit"` and `fill="none"`.

**Colour shift** — animate `fill`/`stop-color` with `values`, and keep every stop inside the
palette. A hue sweep through colours the brand does not own is off-system.

**Stagger** — offset `begin` by 60–120 ms per element (`begin="0.12s"`, `0.24s`, …). Fixed
offsets, not event chains.

## 4. Timing that reads as designed

- Reveal / draw-on: **400–900 ms** total. Longer feels broken.
- Loop cycle: **2–4 s**. Under 1 s reads as a glitch, over 6 s as a stall.
- Stagger step: 60–120 ms.
- Easing: `calcMode="spline"` with `keySplines="0.2 0 0 1"` (ease-out, entrances) or
  `"0.4 0 0.6 1"` (ease-in-out, loops). Linear is correct only for continuous rotation.
- One idea per animation. A mark that draws *and* spins *and* pulses is three animations wearing
  a trench coat.

## 5. Export and rasterisation — what makes motion survive

- **Animated SVG export** just needs the animation elements preserved on serialise. Check the
  document serializer keeps them (`src/modules/logo-studio/svg-serialize.ts`) and that per-layer
  motion is not re-parented — a wrapper inserted *between* an `<animate>` and its target
  attribute silently kills it.
- **Still capture picks a frame**: `svgEl.pauseAnimations()` then
  `svgEl.setCurrentTime(seconds)` before drawing to canvas. That only works for **SMIL** — CSS
  keyframes ignore the SMIL clock, so a CSS-animated mark rasterises at whatever frame the
  compositor was on. **If a mark has to export as GIF/WebM, animate it with SMIL.**
- **Frame maths**: `frames = round(durationMs / 1000 × fps)`. 12 fps for a GIF (256-colour LZW,
  keep it small), 24–30 fps for WebM. Step `setCurrentTime(i / fps)`, draw, encode, repeat.
- **Loop cleanly for the encoder**: the final frame must not duplicate the first, or the loop
  stutters. Encode `frames` frames covering `[0, duration)`, exclusive of the end.
- **Pick a poster frame** deliberately — the moment the mark is fully formed (usually the end of
  a reveal, mid-cycle of a loop). That frame is the PNG/ICO/favicon, so it has to be the *best*
  frame, not frame 0.
- **Playback transport** (play/pause/scrub/loop/speed) drives SMIL through `pauseAnimations()`,
  `unpauseAnimations()`, `setCurrentTime()`, and CSS through `animation-play-state`. Design so
  both paths land somewhere sane; a mark that is invisible at t=0 looks broken when paused at 0.

## 6. Ship-check

1. Paused at t=0, and paused at the poster frame: **both still read as the logo**.
2. Drag / resize / rotate the layer while it plays — motion continues, does not reset, does not
   fight the transform.
3. Loop runs three cycles with no visible jump.
4. Total duration and loop flag stated in ms.
5. No `<script>`, `javascript:`, `on*=`, `<foreignObject>`; no event-based `begin`.
6. Reduced-motion path exists (CSS query, or the still frame is legible).
7. Rasterise two frames and eyeball them — if they are identical, the clock is not being driven
   and the export will be static.
