/**
 * @file AmberArt's selection engine — mask maths, pure.
 *
 * A selection is an **offscreen mask canvas**: opaque white where a pixel is
 * selected, fully transparent where it is not. That single choice is what makes
 * every consumer cheap — "white = selected" is what a human reads off the
 * canvas in a debugger, and the ALPHA it carries alongside is what the
 * compositor multiplies by, so no consumer ever has to convert one to the
 * other.
 *
 * The mask is held by the store and NEVER enters React state: at 1600×1000 it
 * is 6.4 MB, and a selection in a snapshot object would re-render the layer
 * panel on every pointer move of a marquee drag. The store's cheap half grows
 * exactly one field — `hasSelection` — and the bounds are a method call.
 *
 * ## Two layers, on purpose
 *
 * Everything below splits into a **pure data half** over {@link MaskData}
 * (`…Data` names, plain `Uint8Array` coverage, no DOM at all) and a thin
 * **canvas half** that wraps it. The maths is where the bugs live — a scanline
 * that misses the last row, a flood fill that revisits pixels — and Node has no
 * `<canvas>`, so the maths has to be reachable without one or it cannot be
 * tested. `test/amberart-selection.test.ts` drives the data half on an 8×8.
 *
 * ## The clipping recipe, and why this one
 *
 * {@link clipThrough} is the whole of "painting respects the selection". Three
 * recipes were considered:
 *
 *   1. **`ctx.clip()` with a path.** Canvas clipping is vector-only, and a
 *      selection is a raster mask. Turning one into a `Path2D` means running
 *      the contour tracer per stroke segment — far more work than a composite,
 *      and it throws away the mask's antialiased edges.
 *   2. **Per-pixel multiply in JS.** `getImageData` → multiply alpha →
 *      `putImageData` is a 6.4 MB round trip out of and back into the GPU,
 *      per pointer move. This is the recipe that makes a brush feel broken.
 *   3. **Draw to a scratch, `destination-in` the mask, blit.** ← chosen.
 *      Two composites and one blit, all GPU-side, and `destination-in`
 *      multiplies the scratch's alpha by the mask's — which is exactly the
 *      right answer for a lasso's antialiased edge, for free.
 *
 * The scratch is a single shared canvas rather than one per call, because
 * allocating 6.4 MB per pointer move is the same mistake as (2) wearing a
 * different hat. It is cleared to the mask's BOUNDS, not to the full canvas:
 * every previous call ended in a `destination-in`, so the scratch is already
 * transparent everywhere the mask is not, and the mask is inside its bounds by
 * definition.
 */

import { CANVAS_H, CANVAS_W } from "./canvas";
import type { Point } from "./canvas";

/** The tight box around a selection, in canvas pixels. */
export interface SelectionBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A mask as plain coverage — 0 outside the selection, 255 fully inside.
 *
 * One byte per pixel rather than the four an `ImageData` carries: the other
 * three are always either 255 (white) or irrelevant (transparent), and a
 * quarter of the memory is a quarter of the cache pressure in the flood fill.
 */
export interface MaskData {
  readonly width: number;
  readonly height: number;
  readonly a: Uint8Array;
}

/**
 * Anything shaped like an `ImageData`.
 *
 * Declared structurally so {@link maskedResult} can be driven from Node, where
 * the `ImageData` constructor does not exist. A real `ImageData` satisfies it.
 */
export interface PixelBuffer {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** How a new mask meets the one already on screen. */
export type MaskCombine = "replace" | "add" | "subtract";

/**
 * Coverage at or above this counts as selected where a binary answer is
 * needed — bounds, contours, the flood fill's edges, the fill tool's restore.
 * Compositing never thresholds; it multiplies, which is what keeps soft edges.
 */
export const SELECTED = 128;

/* ------------------------------------------------------------------ pure */

function emptyMask(width: number, height: number): MaskData {
  return { width, height, a: new Uint8Array(width * height) };
}

/**
 * The rectangle a drag described, as a mask.
 *
 * The rect is normalised first: a marquee dragged up and to the left has
 * negative width, and every caller would otherwise have to remember that.
 */
export function rectMaskData(
  rect: { x: number; y: number; w: number; h: number },
  width: number = CANVAS_W,
  height: number = CANVAS_H
): MaskData {
  const m = emptyMask(width, height);
  const x0 = Math.max(0, Math.round(Math.min(rect.x, rect.x + rect.w)));
  const y0 = Math.max(0, Math.round(Math.min(rect.y, rect.y + rect.h)));
  const x1 = Math.min(width, Math.round(Math.max(rect.x, rect.x + rect.w)));
  const y1 = Math.min(height, Math.round(Math.max(rect.y, rect.y + rect.h)));
  for (let y = y0; y < y1; y++) m.a.fill(255, y * width + x0, y * width + x1);
  return m;
}

/**
 * A closed polygon — the lasso's path — as a mask.
 *
 * Even-odd scanline fill sampled at each row's centre (`y + 0.5`), which is the
 * rule that makes a horizontal edge land on exactly one row rather than on two
 * or on none. The polygon closes itself; the lasso does not have to append its
 * first point.
 */
export function polygonMaskData(
  points: readonly Point[],
  width: number = CANVAS_W,
  height: number = CANVAS_H
): MaskData {
  const m = emptyMask(width, height);
  const n = points.length;
  if (n < 3) return m;

  const xs: number[] = [];
  for (let y = 0; y < height; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = points[i]!;
      const b = points[j]!;
      /* Half-open on y: a vertex shared by two edges is counted once, so a
         scanline through it does not flip parity twice and leave a hole. */
      if (a.y > cy === b.y > cy) continue;
      xs.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.round(xs[k]!));
      const x1 = Math.min(width, Math.round(xs[k + 1]!));
      if (x1 > x0) m.a.fill(255, y * width + x0, y * width + x1);
    }
  }
  return m;
}

/** Chebyshev distance over RGBA — the largest single-channel difference. */
function channelDistance(px: Uint8ClampedArray, p: number, target: readonly number[]): number {
  const dr = Math.abs(px[p]! - target[0]!);
  const dg = Math.abs(px[p + 1]! - target[1]!);
  const db = Math.abs(px[p + 2]! - target[2]!);
  const da = Math.abs(px[p + 3]! - target[3]!);
  return Math.max(dr, dg, db, da);
}

/**
 * The magic wand: everything reachable from a point within a colour tolerance.
 *
 * This is `floodFill`'s stack walk from `canvas.ts`, kept deliberately the same
 * shape — the same `seen` bitmap that stops a large region turning quadratic,
 * the same four-neighbour push order — with the exact-match test replaced by a
 * distance test. It writes coverage instead of pixels, and it does NOT need
 * `floodFill`'s "already the fill colour" early return: that guard exists
 * because a fill overwrites what it matches against, and a mask never touches
 * the pixels it is reading.
 *
 * `tolerance` is 0–255 on the widest channel difference: 0 selects only the
 * exact colour under the pointer, 255 selects the whole layer.
 */
export function wandMaskData(
  px: Uint8ClampedArray,
  width: number,
  height: number,
  sx: number,
  sy: number,
  tolerance: number
): MaskData {
  const m = emptyMask(width, height);
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  if (x0 < 0 || y0 < 0 || x0 >= width || y0 >= height) return m;

  const start = (y0 * width + x0) * 4;
  const target = [px[start]!, px[start + 1]!, px[start + 2]!, px[start + 3]!];
  const tol = Math.max(0, Math.min(255, tolerance));

  const stack = [x0, y0];
  const seen = new Uint8Array(width * height);
  while (stack.length) {
    const y = stack.pop() as number;
    const x = stack.pop() as number;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const idx = y * width + x;
    if (seen[idx]) continue;
    if (channelDistance(px, idx * 4, target) > tol) continue;
    seen[idx] = 1;
    m.a[idx] = 255;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  return m;
}

/** Everything that was not selected, and nothing that was. */
export function invertMaskData(m: MaskData): MaskData {
  const out = new Uint8Array(m.a.length);
  for (let i = 0; i < m.a.length; i++) out[i] = 255 - m.a[i]!;
  return { width: m.width, height: m.height, a: out };
}

/** The tight box around the coverage, or `null` if nothing is selected. */
export function maskBoundsFrom(m: MaskData): SelectionBounds | null {
  let minX = m.width;
  let minY = m.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < m.height; y++) {
    const row = y * m.width;
    for (let x = 0; x < m.width; x++) {
      if (m.a[row + x]! < SELECTED) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Keep `after` inside the mask and `before` everywhere else.
 *
 * The escape hatch for an operation that cannot be redirected to a scratch
 * because it READS the destination — the flood fill is the only one. It runs
 * unclipped over the real layer, and this puts the untouched pixels back.
 * A byte copy over the whole buffer, once per fill click; that is a different
 * budget from once per pointer move, which is why {@link clipThrough} exists
 * rather than this being the general recipe.
 */
export function maskedResult(before: PixelBuffer, after: PixelBuffer, m: MaskData): Uint8ClampedArray {
  const out = new Uint8ClampedArray(after.data);
  const n = Math.min(m.a.length, out.length >> 2);
  for (let i = 0; i < n; i++) {
    if (m.a[i]! >= SELECTED) continue;
    const p = i * 4;
    out[p] = before.data[p]!;
    out[p + 1] = before.data[p + 1]!;
    out[p + 2] = before.data[p + 2]!;
    out[p + 3] = before.data[p + 3]!;
  }
  return out;
}

/**
 * The selection's outline, as closed polylines on the pixel lattice.
 *
 * Marching squares in its practical form: every unit edge between a selected
 * pixel and an unselected neighbour is emitted with a consistent winding
 * (clockwise, y down), then the edges are chained head-to-tail into loops. The
 * alternative — stroking each boundary pixel as its own tiny subpath — was
 * rejected because `lineDashOffset` restarts per subpath, so a thousand 1px
 * subpaths render as a solid line and the ants never march.
 *
 * Collinear runs collapse, so a rectangular marquee comes back as four points
 * rather than four thousand.
 */
export function traceMaskContours(m: MaskData): Point[][] {
  const { width: w, height: h, a } = m;
  const inside = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && a[y * w + x]! >= SELECTED;

  /* Vertices live on the (w+1)×(h+1) corner lattice. */
  const key = (x: number, y: number): number => y * (w + 1) + x;
  const out = new Map<number, number[]>();
  const push = (ax: number, ay: number, bx: number, by: number): void => {
    const k = key(ax, ay);
    const list = out.get(k);
    if (list) list.push(key(bx, by));
    else out.set(k, [key(bx, by)]);
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) push(x, y, x + 1, y);
      if (!inside(x + 1, y)) push(x + 1, y, x + 1, y + 1);
      if (!inside(x, y + 1)) push(x + 1, y + 1, x, y + 1);
      if (!inside(x - 1, y)) push(x, y + 1, x, y);
    }
  }

  const loops: Point[][] = [];
  for (const start of [...out.keys()]) {
    for (;;) {
      const first = out.get(start);
      if (!first?.length) break;
      const pts: Point[] = [];
      let at = start;
      for (;;) {
        const nexts = out.get(at);
        const to = nexts?.pop();
        if (nexts && !nexts.length) out.delete(at);
        if (to === undefined) break;
        pts.push({ x: at % (w + 1), y: Math.floor(at / (w + 1)) });
        at = to;
        if (at === start) break;
      }
      if (pts.length >= 3) loops.push(simplify(pts));
    }
  }
  return loops;
}

/** Drop the middle of any three collinear points. */
function simplify(pts: Point[]): Point[] {
  const out: Point[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]!;
    const cur = pts[i]!;
    const next = pts[(i + 1) % n]!;
    if ((cur.x - prev.x) * (next.y - cur.y) === (cur.y - prev.y) * (next.x - cur.x)) continue;
    out.push(cur);
  }
  return out.length >= 3 ? out : pts;
}

/* ---------------------------------------------------------------- canvas */

function blank(width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

/** Coverage → a mask canvas: opaque white inside, transparent outside. */
export function maskFromData(m: MaskData): HTMLCanvasElement | null {
  const c = blank(m.width, m.height);
  const ctx = c?.getContext("2d");
  if (!c || !ctx) return null;
  const img = ctx.createImageData(m.width, m.height);
  for (let i = 0; i < m.a.length; i++) {
    const p = i * 4;
    img.data[p] = 255;
    img.data[p + 1] = 255;
    img.data[p + 2] = 255;
    img.data[p + 3] = m.a[i]!;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** A mask canvas → coverage. One `getImageData`, per gesture, never per frame. */
export function maskCoverage(mask: HTMLCanvasElement): MaskData {
  const ctx = mask.getContext("2d");
  const a = new Uint8Array(mask.width * mask.height);
  if (!ctx) return { width: mask.width, height: mask.height, a };
  const img = ctx.getImageData(0, 0, mask.width, mask.height);
  for (let i = 0; i < a.length; i++) a[i] = img.data[i * 4 + 3]!;
  return { width: mask.width, height: mask.height, a };
}

/** The marquee's rectangle, as a mask canvas. */
export function rectMask(rect: { x: number; y: number; w: number; h: number }): HTMLCanvasElement | null {
  return maskFromData(rectMaskData(rect));
}

/**
 * The lasso's freehand path, as a mask canvas.
 *
 * Drawn with `fill("evenodd")` rather than from {@link polygonMaskData}: the
 * canvas rasteriser antialiases the edge, and a hand-drawn boundary is exactly
 * where a hard 1px staircase shows. The scanline version stays for the tests
 * and for anything that needs the answer without a DOM.
 */
export function polygonMask(points: readonly Point[]): HTMLCanvasElement | null {
  const c = blank(CANVAS_W, CANVAS_H);
  const ctx = c?.getContext("2d");
  if (!c || !ctx || points.length < 3) return null;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i]!.x, points[i]!.y);
  ctx.closePath();
  ctx.fill("evenodd");
  return c;
}

/** The magic wand over one layer's pixels. */
export function wandMask(
  source: HTMLCanvasElement,
  x: number,
  y: number,
  tolerance: number
): HTMLCanvasElement | null {
  const ctx = source.getContext("2d");
  if (!ctx) return null;
  const img = ctx.getImageData(0, 0, source.width, source.height);
  return maskFromData(wandMaskData(img.data, source.width, source.height, x, y, tolerance));
}

/** Invert a mask canvas. */
export function invertMask(mask: HTMLCanvasElement): HTMLCanvasElement | null {
  return maskFromData(invertMaskData(maskCoverage(mask)));
}

/** The tight box around a mask canvas, or `null` if it selects nothing. */
export function maskBounds(mask: HTMLCanvasElement): SelectionBounds | null {
  return maskBoundsFrom(maskCoverage(mask));
}

/**
 * Fold a new mask into the existing one — Shift adds, Alt subtracts.
 *
 * `source-over` unions and `destination-out` differences, both of which the
 * compositor already does correctly for partial coverage, so a soft lasso edge
 * added to a hard marquee edge blends rather than stepping. Returns a NEW
 * canvas: the previous mask may still be referenced by a drag in progress.
 */
export function combineMask(
  base: HTMLCanvasElement | null,
  next: HTMLCanvasElement,
  mode: MaskCombine
): HTMLCanvasElement | null {
  if (!base || mode === "replace") return next;
  const c = blank(base.width, base.height);
  const ctx = c?.getContext("2d");
  if (!c || !ctx) return next;
  ctx.drawImage(base, 0, 0);
  ctx.globalCompositeOperation = mode === "add" ? "source-over" : "destination-out";
  ctx.drawImage(next, 0, 0);
  return c;
}

/** The shared scratch, and the guard that stops a nested call reusing it. */
let scratch: HTMLCanvasElement | null = null;
let scratchBusy = false;

/**
 * Run `draw` against `ctx`, clipped to `mask`.
 *
 * With no mask the drawing function is handed the real context and owns its own
 * compositing, exactly as it did before selections existed — so an unselected
 * document takes no extra work at all.
 *
 * With a mask, see the file header for the recipe. `opts.composite` is how the
 * clipped result meets the layer: `source-over` paints it on, `destination-out`
 * removes it (the eraser, whose draw must therefore paint OPAQUELY into the
 * scratch and let this argument do the erasing).
 */
export function clipThrough(
  ctx: CanvasRenderingContext2D,
  mask: HTMLCanvasElement | null,
  draw: (target: CanvasRenderingContext2D) => void,
  opts?: { composite?: GlobalCompositeOperation; bounds?: SelectionBounds | null }
): void {
  if (!mask) {
    draw(ctx);
    return;
  }

  if (scratch && (scratch.width !== mask.width || scratch.height !== mask.height)) scratch = null;
  const nested = scratchBusy;
  const canvas = nested ? blank(mask.width, mask.height) : (scratch ??= blank(mask.width, mask.height));
  const sctx = canvas?.getContext("2d");
  if (!canvas || !sctx) {
    draw(ctx);
    return;
  }
  if (!nested) scratchBusy = true;

  try {
    const b = opts?.bounds ?? { x: 0, y: 0, w: canvas.width, h: canvas.height };
    sctx.save();
    sctx.globalCompositeOperation = "source-over";
    sctx.globalAlpha = 1;
    sctx.clearRect(b.x, b.y, b.w, b.h);
    sctx.restore();

    sctx.save();
    draw(sctx);
    sctx.restore();

    sctx.save();
    sctx.globalCompositeOperation = "destination-in";
    sctx.globalAlpha = 1;
    sctx.drawImage(mask, 0, 0);
    sctx.restore();

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = opts?.composite ?? "source-over";
    ctx.drawImage(canvas, b.x, b.y, b.w, b.h, b.x, b.y, b.w, b.h);
    ctx.restore();
  } finally {
    if (!nested) scratchBusy = false;
  }
}

/**
 * The ants' path — every contour of the mask as one `Path2D`.
 *
 * Built once when the selection changes and cached by the store, because the
 * rAF ticker strokes it twelve times a second and tracing per frame would put
 * a full-canvas walk in the animation loop.
 */
export function maskOutlinePath(m: MaskData): Path2D | null {
  if (typeof Path2D === "undefined") return null;
  const path = new Path2D();
  for (const loop of traceMaskContours(m)) {
    path.moveTo(loop[0]!.x, loop[0]!.y);
    for (let i = 1; i < loop.length; i++) path.lineTo(loop[i]!.x, loop[i]!.y);
    path.closePath();
  }
  return path;
}
