/**
 * @file AmberArt's raster primitives — the pure half, ported verbatim.
 *
 * Every function here is maths over a canvas context: no React, no store, no
 * theme. They crossed from GizmoX unchanged (only the import of the constants
 * moved), because a flood fill and a fit-box are correct or they are not, and
 * this pair has been correct for a while.
 *
 * Keeping them out of the component is what makes them testable and what stops
 * the screen growing a second, subtly different `hexToRgba` the day someone
 * needs one in a panel.
 */

/** Canvas geometry. Fixed per document and echoed in any exported SVG viewBox. */
export const CANVAS_W = 1600;
export const CANVAS_H = 1000;

/**
 * One layer's pixels as they were before a stroke — a PIXEL undo entry.
 *
 * This is the exact shape history had before blend modes arrived, kept
 * byte-identical so every existing `pushUndo` call site is unchanged.
 */
export interface PixelSnapshot {
  kind: "pixels";
  layerId: string;
  data: ImageData;
}

/**
 * The layer STACK as it was before a structural op — the other undo entry.
 *
 * Merge down, flatten, duplicate, delete, rename, reorder and a blend/opacity
 * change all move layers around rather than pixels within one, and an
 * `ImageData` per layer cannot express any of them (a delete has no layer left
 * to put the pixels back into).
 *
 * `buffers` holds **references** to the live offscreen canvases, not copies:
 * a layer that is about to be REMOVED is not mutated on the way out, so the
 * reference is the pixels. Only an op that writes into a surviving buffer —
 * merge down's destination, flatten's base — clones, and it clones that one
 * buffer alone. Cloning the whole map would put ~6.4 MB per layer into every
 * rename, which is the memory decision the store's docblock is about.
 */
export interface StructureSnapshot {
  kind: "structure";
  layers: Layer[];
  buffers: Map<string, HTMLCanvasElement>;
}

/** An undo/redo entry. Tagged, because the two kinds restore differently. */
export type Snapshot = PixelSnapshot | StructureSnapshot;

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  /**
   * The canvas `globalCompositeOperation` this layer composites with —
   * `"source-over"` is Photoshop's Normal. See {@link BLEND_MODES}.
   */
  blend: string;
}

/** A blend mode: the canvas operation, and the name Photoshop calls it. */
export interface BlendMode {
  id: string;
  label: string;
}

/**
 * The blend modes AmberArt offers, in Photoshop's own order.
 *
 * Every one is a canvas `globalCompositeOperation` the browser already
 * implements to the same spec Photoshop's are defined by, so this is zero new
 * maths — `composite()` sets the op per layer and the compositor does the rest.
 * The ids are the canvas values; the labels are what the layer panel shows.
 */
export const BLEND_MODES: readonly BlendMode[] = [
  { id: "source-over", label: "Normal" },
  { id: "multiply", label: "Multiply" },
  { id: "screen", label: "Screen" },
  { id: "overlay", label: "Overlay" },
  { id: "darken", label: "Darken" },
  { id: "lighten", label: "Lighten" },
  { id: "color-dodge", label: "Color Dodge" },
  { id: "color-burn", label: "Color Burn" },
  { id: "hard-light", label: "Hard Light" },
  { id: "soft-light", label: "Soft Light" },
  { id: "difference", label: "Difference" },
  { id: "exclusion", label: "Exclusion" },
  { id: "hue", label: "Hue" },
  { id: "saturation", label: "Saturation" },
  { id: "color", label: "Color" },
  { id: "luminosity", label: "Luminosity" }
];

/** The default a new layer is created with — Photoshop's Normal. */
export const BLEND_NORMAL = "source-over";

/** What Photoshop calls a blend id, for the panel and the status line. */
export function blendLabel(id: string): string {
  return BLEND_MODES.find((b) => b.id === id)?.label ?? "Normal";
}

export interface Point {
  x: number;
  y: number;
}

/** The shape tools, drawn from a drag's start and end. */
export function drawShape(
  ctx: CanvasRenderingContext2D,
  tool: string,
  a: Point,
  b: Point
): void {
  ctx.beginPath();
  if (tool === "line") {
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  } else if (tool === "rect") {
    ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  } else if (tool === "ellipse") {
    ctx.ellipse(
      (a.x + b.x) / 2,
      (a.y + b.y) / 2,
      Math.abs(b.x - a.x) / 2,
      Math.abs(b.y - a.y) / 2,
      0,
      0,
      Math.PI * 2
    );
  }
  ctx.stroke();
}

/** `#ff7a1a` + alpha → the four bytes a pixel buffer wants. */
export function hexToRgba(hex: string, alpha: number): [number, number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 122, 26, Math.round(alpha * 255)];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, Math.round(alpha * 255)];
}

/**
 * Flood fill from a point, matching the colour under it.
 *
 * A scanline-free stack fill over one `ImageData`, with a `seen` bitmap so a
 * large region cannot revisit pixels and turn quadratic. The early return when
 * the target already equals the fill colour is not an optimisation — without
 * it the stack never drains, because every filled pixel still matches.
 */
export function floodFill(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  color: string,
  alpha: number
): void {
  const img = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
  const px = img.data;
  const start = (Math.floor(sy) * CANVAS_W + Math.floor(sx)) * 4;
  const target = [px[start], px[start + 1], px[start + 2], px[start + 3]];

  const rgba = hexToRgba(color, alpha);
  if (target.every((c, i) => c === rgba[i])) return;

  const stack = [Math.floor(sx), Math.floor(sy)];
  const seen = new Uint8Array(CANVAS_W * CANVAS_H);
  while (stack.length) {
    const y = stack.pop() as number;
    const x = stack.pop() as number;
    if (x < 0 || y < 0 || x >= CANVAS_W || y >= CANVAS_H) continue;
    const idx = y * CANVAS_W + x;
    if (seen[idx]) continue;
    const p = idx * 4;
    if (
      px[p] !== target[0] ||
      px[p + 1] !== target[1] ||
      px[p + 2] !== target[2] ||
      px[p + 3] !== target[3]
    ) {
      continue;
    }
    seen[idx] = 1;
    px[p] = rgba[0];
    px[p + 1] = rgba[1];
    px[p + 2] = rgba[2];
    px[p + 3] = rgba[3];
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  ctx.putImageData(img, 0, 0);
}

/** Decode a blob/data URL into an image, or reject with a readable message. */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("could not decode the drawing"));
    img.src = url;
  });
}

/** Fit a source box onto the canvas, covering or containing it. */
export function fitBox(
  sw: number,
  sh: number,
  mode: "cover" | "contain"
): { x: number; y: number; w: number; h: number } {
  const scale =
    mode === "cover" ? Math.max(CANVAS_W / sw, CANVAS_H / sh) : Math.min(CANVAS_W / sw, CANVAS_H / sh);
  const w = sw * scale;
  const h = sh * scale;
  return { x: (CANVAS_W - w) / 2, y: (CANVAS_H - h) / 2, w, h };
}
