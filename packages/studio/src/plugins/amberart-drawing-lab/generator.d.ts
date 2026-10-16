/**
 * @file Types for `./generator.mjs` — the Drawing Lab shape engine.
 *
 * The `.mjs` beside this file is a **verbatim copy** of
 * `build/tools/drawing-lab/generator.mjs`, the standalone Drawing Lab served on
 * :4188. It is copied rather than rewritten for two reasons: it is 25 KB of
 * proven interlocking-tile geometry (Poisson sampling, shared-edge lobes,
 * contour insetting) that a hand-port would silently change, and the standalone
 * lab's own header requires it to stay runnable on its own while the drawing
 * module is designed.
 *
 * Copying two files that must agree is exactly the drift this project uses
 * tests to prevent, so `test/drawing-lab-parity.test.ts` fails the build the
 * moment the two stop being byte-identical. Fix drift by re-copying from
 * `build/tools/drawing-lab/`, which stays the source of truth.
 *
 * Only the surface the plugin actually calls is declared here.
 */

/** Every knob the generator understands. The panel drives these. */
export interface DrawingLabParams {
  /** Poisson spacing == piece scale, px. 60–460. */
  size: number;
  /** 0–100: lobe count + depth on each shared edge. */
  complexity: number;
  /** 0 = angular polygon, 100 = flowing curves. */
  smoothness: number;
  /** Degrees, 5–85: caps how steeply a contour turns off its chord. */
  maxAngle: number;
  /** px gap between pieces; 0 = interlocked. */
  spacing: number;
  /** Stroke width, 0–18. */
  thickness: number;
  /** 0–100. */
  strokeOpacity: number;
  /** 0–100. */
  fillOpacity: number;
  fillMode: "none" | "solid" | "palette";
  bg: string;
  stroke: string;
  fill: string;
  /** Palette hue range, degrees. */
  spread: number;
  /** Palette lightness variance. */
  lightVar: number;
  /** `"<w>x<h>"` — the page box the tiling is generated into. */
  page: string;
  seed: number;
}

export const DEFAULTS: DrawingLabParams;

/**
 * What `buildSvg` hands back. Note it is an OBJECT, not the markup — the
 * document is `.svg`, and the rest is the panel's stats readout.
 */
export interface DrawingLabResult {
  /** The complete SVG document. */
  svg: string;
  /** How many interlocking pieces were generated. */
  cells: number;
  /** How many shared edges those pieces were cut along. */
  edges: number;
  /** Page width/height actually used, in px. */
  W: number;
  H: number;
  /** Wall-clock generation time. NOT deterministic — never compare on it. */
  ms: number;
}

/**
 * Generate a tiling for these parameters. The `svg` field is pure and
 * deterministic for a given seed; `ms` is timing and varies per run.
 */
export function buildSvg(params?: Partial<DrawingLabParams>): DrawingLabResult;

/** Seeded PRNG — exported so callers can roll a reproducible seed. */
export function mulberry32(seed: number): () => number;
