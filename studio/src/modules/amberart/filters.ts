/**
 * @file AmberArt's filters and adjustments — pure maths over pixels.
 *
 * Every function here is `(pixels, params) → pixels`: no canvas, no store, no
 * React, and no mutation of the input. It sits beside `canvas.ts` and
 * `selection.ts` for the reason those two do — the maths is where the bugs
 * live, Node has no `<canvas>`, and a convolution that drops its last column is
 * only findable by a test that can call it without a DOM.
 *
 * The buffer type is {@link PixelBuffer} from `selection.ts` rather than a
 * second structural `ImageData` shape declared here: a real `ImageData`
 * satisfies it, `maskedResult` already speaks it, and the store hands the same
 * object to both halves. One concept, one name.
 *
 * ## Premultiplied where it matters, straight where it does not
 *
 * `getImageData` hands back STRAIGHT alpha — an erased pixel is
 * `(0, 0, 0, 0)`, and its RGB is not a colour, it is nothing. Any filter that
 * MIXES pixels together (blur, pixelate, sharpen) must premultiply first, or
 * that nothing gets averaged in as black and every soft edge grows a dark halo.
 * The per-pixel colour transforms (brightness, hue, invert, grayscale, sepia,
 * noise) never mix neighbours, so they run on straight RGB and leave alpha
 * exactly as they found it, which is what makes `invert` an involution.
 *
 * ## What is deliberately not here
 *
 * Adjustment LAYERS. `axf-amberart-photoshop`'s refusal list names them: a
 * one-shot adjustment writes pixels and is undone by the one undo entry the
 * store already knows how to push, while an adjustment layer is a second
 * document model. These are the one-shot kind, and the panel says so by having
 * an Apply button.
 */

import type { PixelBuffer } from "./selection";
import { mulberry32 } from "./textures";

/* ------------------------------------------------------------------ ranges */

/** The blur's radius bounds — 20 is where a 1600×1000 pass stops being free. */
export const BLUR_RADIUS_MIN = 1;
export const BLUR_RADIUS_MAX = 20;
/** Three box passes approximate a gaussian closely enough to stop counting. */
export const BLUR_PASSES = 3;
/** The pixelate block, in canvas pixels. */
export const PIXELATE_MIN = 2;
export const PIXELATE_MAX = 64;

/** Rec.709 luma — the weights `grayscale` uses, and what the tests measure. */
export const LUMA_R = 0.2126;
export const LUMA_G = 0.7152;
export const LUMA_B = 0.0722;

/**
 * The noise field's fixed seed.
 *
 * Fixed rather than drawn per call because the preview and the Apply are two
 * separate runs of the same filter, and a re-randomised field would mean the
 * grain that lands is not the grain that was approved. Deterministic output is
 * a correctness property here, not a nicety — the same rule `textures.ts`
 * states for its tiles.
 */
export const NOISE_SEED = 20260815;

/* ------------------------------------------------------------------- utils */

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const clampInt = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** An output buffer of the same size, zeroed. Never a view onto the input. */
function blank(width: number, height: number): PixelBuffer {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** A copy of the input — what every filter degenerates to at a no-op setting. */
function copyOf(src: PixelBuffer): PixelBuffer {
  const out = blank(src.width, src.height);
  out.data.set(src.data);
  return out;
}

/**
 * Straight RGBA → premultiplied float planes, interleaved.
 *
 * Alpha rides along unscaled (0–255) so the reverse trip needs no second
 * array, and because every mixing filter wants the alpha averaged too.
 */
function premultiply(src: PixelBuffer): Float32Array {
  const n = src.width * src.height;
  const f = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const a = src.data[p + 3]! / 255;
    f[p] = src.data[p]! * a;
    f[p + 1] = src.data[p + 1]! * a;
    f[p + 2] = src.data[p + 2]! * a;
    f[p + 3] = src.data[p + 3]!;
  }
  return f;
}

/** Premultiplied float planes → straight RGBA bytes, rounded once. */
function unpremultiply(f: Float32Array, width: number, height: number): PixelBuffer {
  const out = blank(width, height);
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const a = f[p + 3]!;
    const inv = a > 0 ? 255 / a : 0;
    out.data[p] = Math.round(f[p]! * inv);
    out.data[p + 1] = Math.round(f[p + 1]! * inv);
    out.data[p + 2] = Math.round(f[p + 2]! * inv);
    out.data[p + 3] = Math.round(a);
  }
  return out;
}

/* ---------------------------------------------------- per-pixel transforms */

export interface BrightnessContrastParams {
  /** −100 (black) … +100 (white), as an offset. */
  readonly brightness: number;
  /** −100 (flat grey) … +100 (hard), as a pivot around mid-grey. */
  readonly contrast: number;
}

/**
 * Brightness as an offset, contrast as a gain around 128.
 *
 * The contrast factor is the standard `(259(c + 255)) / (255(259 − c))` curve
 * on `c = contrast × 2.55`: it is the one that reaches a true hard-clip at
 * +100 and a true flat grey at −100, where a naive linear gain reaches neither
 * end and makes the last third of the slider do nothing.
 */
export function brightnessContrast(src: PixelBuffer, params: BrightnessContrastParams): PixelBuffer {
  const offset = clamp(params.brightness, -100, 100) * 2.55;
  const c = clamp(params.contrast, -100, 100) * 2.55;
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  const out = blank(src.width, src.height);
  const n = src.width * src.height;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    out.data[p] = factor * (src.data[p]! + offset - 128) + 128;
    out.data[p + 1] = factor * (src.data[p + 1]! + offset - 128) + 128;
    out.data[p + 2] = factor * (src.data[p + 2]! + offset - 128) + 128;
    out.data[p + 3] = src.data[p + 3]!;
  }
  return out;
}

/** RGB (0–1) → HSL, hue in degrees. Thirty lines of arithmetic, no library. */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

/** One channel of the HSL→RGB reconstruction. */
function hueChannel(p: number, q: number, t: number): number {
  let x = t;
  if (x < 0) x += 1;
  if (x > 1) x -= 1;
  if (x < 1 / 6) return p + (q - p) * 6 * x;
  if (x < 1 / 2) return q;
  if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
  return p;
}

/** HSL (hue in degrees) → RGB (0–1). The exact inverse of {@link rgbToHsl}. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const t = (((h % 360) + 360) % 360) / 360;
  return [hueChannel(p, q, t + 1 / 3), hueChannel(p, q, t), hueChannel(p, q, t - 1 / 3)];
}

export interface HueSaturationParams {
  /** −180 … +180 degrees around the colour wheel. */
  readonly hue: number;
  /** −100 (fully desaturated) … +100 (fully saturated). */
  readonly saturation: number;
}

/**
 * Rotate the hue and push the saturation, in HSL.
 *
 * Saturation moves TOWARDS an end rather than scaling linearly: positive
 * closes the gap to 1, negative closes the gap to 0. A plain multiply would
 * make +100 mean "twice as saturated", which is already fully saturated for
 * half the picture and does nothing to grey pixels — the two ends of the
 * slider have to mean fully-saturated and fully-grey or the control lies.
 */
export function hueSaturation(src: PixelBuffer, params: HueSaturationParams): PixelBuffer {
  const hue = clamp(params.hue, -180, 180);
  const sat = clamp(params.saturation, -100, 100) / 100;
  const out = blank(src.width, src.height);
  const n = src.width * src.height;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const [h, s, l] = rgbToHsl(src.data[p]! / 255, src.data[p + 1]! / 255, src.data[p + 2]! / 255);
    const s2 = sat >= 0 ? s + (1 - s) * sat : s * (1 + sat);
    const [r, g, b] = hslToRgb(h + hue, clamp(s2, 0, 1), l);
    out.data[p] = Math.round(r * 255);
    out.data[p + 1] = Math.round(g * 255);
    out.data[p + 2] = Math.round(b * 255);
    out.data[p + 3] = src.data[p + 3]!;
  }
  return out;
}

/**
 * Negate every channel. An involution — `invert(invert(x))` is `x`, exactly.
 *
 * Exactly, because it runs on straight RGB and never touches alpha: `255 − v`
 * on an integer channel is its own inverse with no rounding anywhere in it.
 * Premultiplying here would break that, which is the whole reason the file
 * splits the two families.
 */
export function invert(src: PixelBuffer): PixelBuffer {
  const out = blank(src.width, src.height);
  const n = src.width * src.height;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    out.data[p] = 255 - src.data[p]!;
    out.data[p + 1] = 255 - src.data[p + 1]!;
    out.data[p + 2] = 255 - src.data[p + 2]!;
    out.data[p + 3] = src.data[p + 3]!;
  }
  return out;
}

/** Rec.709 luma into all three channels — grey in, the same grey out. */
export function grayscale(src: PixelBuffer): PixelBuffer {
  const out = blank(src.width, src.height);
  const n = src.width * src.height;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const y = Math.round(LUMA_R * src.data[p]! + LUMA_G * src.data[p + 1]! + LUMA_B * src.data[p + 2]!);
    out.data[p] = y;
    out.data[p + 1] = y;
    out.data[p + 2] = y;
    out.data[p + 3] = src.data[p + 3]!;
  }
  return out;
}

/** The photographic sepia matrix, as everybody's is. Clamping is the point. */
export function sepia(src: PixelBuffer): PixelBuffer {
  const out = blank(src.width, src.height);
  const n = src.width * src.height;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const r = src.data[p]!;
    const g = src.data[p + 1]!;
    const b = src.data[p + 2]!;
    out.data[p] = 0.393 * r + 0.769 * g + 0.189 * b;
    out.data[p + 1] = 0.349 * r + 0.686 * g + 0.168 * b;
    out.data[p + 2] = 0.272 * r + 0.534 * g + 0.131 * b;
    out.data[p + 3] = src.data[p + 3]!;
  }
  return out;
}

export interface NoiseParams {
  /** 0–100: how far a pixel may move, as a percentage of full range. */
  readonly amount: number;
  /** One deviation for all three channels (film grain) or three (colour). */
  readonly monochrome: boolean;
  /** Defaults to {@link NOISE_SEED} — see its docblock for why it is fixed. */
  readonly seed?: number;
}

/**
 * Seeded uniform noise, walked in raster order.
 *
 * The PRNG is `textures.ts`'s `mulberry32` rather than a second one written
 * here: it is the house generator, it is already the thing the texture tiles
 * are deterministic through, and a module with two PRNGs has two definitions
 * of "the same seed gives the same result".
 */
export function noise(src: PixelBuffer, params: NoiseParams): PixelBuffer {
  const amount = (clamp(params.amount, 0, 100) / 100) * 255;
  const rand = mulberry32(params.seed ?? NOISE_SEED);
  const out = blank(src.width, src.height);
  const n = src.width * src.height;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    if (params.monochrome) {
      const d = (rand() * 2 - 1) * amount;
      out.data[p] = src.data[p]! + d;
      out.data[p + 1] = src.data[p + 1]! + d;
      out.data[p + 2] = src.data[p + 2]! + d;
    } else {
      out.data[p] = src.data[p]! + (rand() * 2 - 1) * amount;
      out.data[p + 1] = src.data[p + 1]! + (rand() * 2 - 1) * amount;
      out.data[p + 2] = src.data[p + 2]! + (rand() * 2 - 1) * amount;
    }
    out.data[p + 3] = src.data[p + 3]!;
  }
  return out;
}

/* -------------------------------------------------------- mixing filters */

export interface BlurParams {
  /** 1–20 canvas pixels. See {@link BLUR_PASSES} for what a pass costs. */
  readonly radius: number;
}

/**
 * One separable box pass along the rows, edges clamped.
 *
 * A sliding window, so the cost is one add and one subtract per pixel whatever
 * the radius is — which is why radius 20 is as interactive as radius 1 and why
 * the preview's half-resolution rule (see {@link previewScale}) keys off the
 * PASS COUNT rather than off the radius.
 *
 * Clamp-to-edge rather than wrap or zero: wrapping bleeds the right edge onto
 * the left, and zero-padding darkens every border by half a window — the
 * classic vignette that looks like a bug in the image rather than in the blur.
 */
function blurRows(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const win = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    for (let k = -r; k <= r; k++) {
      const p = (row + clampInt(k, 0, w - 1)) * 4;
      s0 += src[p]!;
      s1 += src[p + 1]!;
      s2 += src[p + 2]!;
      s3 += src[p + 3]!;
    }
    for (let x = 0; x < w; x++) {
      const p = (row + x) * 4;
      dst[p] = s0 / win;
      dst[p + 1] = s1 / win;
      dst[p + 2] = s2 / win;
      dst[p + 3] = s3 / win;
      const go = (row + clampInt(x - r, 0, w - 1)) * 4;
      const come = (row + clampInt(x + r + 1, 0, w - 1)) * 4;
      s0 += src[come]! - src[go]!;
      s1 += src[come + 1]! - src[go + 1]!;
      s2 += src[come + 2]! - src[go + 2]!;
      s3 += src[come + 3]! - src[go + 3]!;
    }
  }
}

/** The same pass down the columns. Together with {@link blurRows}, one blur. */
function blurCols(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const win = r * 2 + 1;
  for (let x = 0; x < w; x++) {
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let s3 = 0;
    for (let k = -r; k <= r; k++) {
      const p = (clampInt(k, 0, h - 1) * w + x) * 4;
      s0 += src[p]!;
      s1 += src[p + 1]!;
      s2 += src[p + 2]!;
      s3 += src[p + 3]!;
    }
    for (let y = 0; y < h; y++) {
      const p = (y * w + x) * 4;
      dst[p] = s0 / win;
      dst[p + 1] = s1 / win;
      dst[p + 2] = s2 / win;
      dst[p + 3] = s3 / win;
      const go = (clampInt(y - r, 0, h - 1) * w + x) * 4;
      const come = (clampInt(y + r + 1, 0, h - 1) * w + x) * 4;
      s0 += src[come]! - src[go]!;
      s1 += src[come + 1]! - src[go + 1]!;
      s2 += src[come + 2]! - src[go + 2]!;
      s3 += src[come + 3]! - src[go + 3]!;
    }
  }
}

/**
 * Three separable box passes — a gaussian-grade blur for six linear sweeps.
 *
 * Three box convolutions are the standard cheap gaussian: the first is a
 * rectangle, the second a triangle, the third a quadratic spline that is
 * already indistinguishable from a true gaussian at these radii. Six sweeps of
 * a 1600×1000 buffer in Float32, and the rounding to bytes happens ONCE at the
 * end rather than three times — intermediate rounding is what turns a
 * three-pass blur into visible banding on a gradient.
 */
export function boxBlur(src: PixelBuffer, params: BlurParams): PixelBuffer {
  const r = Math.round(clamp(params.radius, 0, BLUR_RADIUS_MAX));
  if (r < BLUR_RADIUS_MIN || src.width === 0 || src.height === 0) return copyOf(src);
  const w = src.width;
  const h = src.height;
  const a = premultiply(src);
  const b = new Float32Array(a.length);
  for (let pass = 0; pass < BLUR_PASSES; pass++) {
    blurRows(a, b, w, h, r);
    blurCols(b, a, w, h, r);
  }
  return unpremultiply(a, w, h);
}

export interface SharpenParams {
  /** 0–200%: how much of the high-pass difference to add back. */
  readonly amount: number;
}

/**
 * A 3×3 unsharp kernel: `centre × (1 + 4a)` minus its four neighbours × `a`.
 *
 * The cross rather than the full eight-neighbour kernel because the diagonals
 * are √2 further away and weighting them equally is what gives a sharpen its
 * blocky ringing. Alpha is deliberately NOT sharpened — the kernel runs on
 * premultiplied colour and the original alpha is copied through, so an
 * antialiased edge keeps its coverage instead of growing a hard fringe where
 * the high-pass overshot.
 */
export function sharpen(src: PixelBuffer, params: SharpenParams): PixelBuffer {
  const amount = clamp(params.amount, 0, 200) / 100;
  if (amount === 0) return copyOf(src);
  const w = src.width;
  const h = src.height;
  const f = premultiply(src);
  const out = new Float32Array(f.length);
  const centre = 1 + 4 * amount;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const up = (clampInt(y - 1, 0, h - 1) * w + x) * 4;
      const down = (clampInt(y + 1, 0, h - 1) * w + x) * 4;
      const left = (y * w + clampInt(x - 1, 0, w - 1)) * 4;
      const right = (y * w + clampInt(x + 1, 0, w - 1)) * 4;
      for (let c = 0; c < 3; c++) {
        out[p + c] =
          centre * f[p + c]! - amount * (f[up + c]! + f[down + c]! + f[left + c]! + f[right + c]!);
      }
      out[p + 3] = f[p + 3]!;
    }
  }
  return unpremultiply(out, w, h);
}

export interface PixelateParams {
  /** 2–64 canvas pixels on a side. */
  readonly block: number;
}

/**
 * Average each block and write the average back over it.
 *
 * Premultiplied, like the blur and for the same reason: a block half of which
 * is erased must average to the visible half's colour at half the alpha, not
 * to that colour mixed with black. The last block in a row or column is
 * partial and is averaged over the pixels it actually has, so the right and
 * bottom edges do not darken when the block size does not divide the canvas.
 */
export function pixelate(src: PixelBuffer, params: PixelateParams): PixelBuffer {
  const block = Math.round(clamp(params.block, PIXELATE_MIN, PIXELATE_MAX));
  const w = src.width;
  const h = src.height;
  if (block < 2 || w === 0 || h === 0) return copyOf(src);
  const f = premultiply(src);
  const out = new Float32Array(f.length);
  for (let by = 0; by < h; by += block) {
    const yEnd = Math.min(by + block, h);
    for (let bx = 0; bx < w; bx += block) {
      const xEnd = Math.min(bx + block, w);
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      let s3 = 0;
      for (let y = by; y < yEnd; y++) {
        for (let x = bx; x < xEnd; x++) {
          const p = (y * w + x) * 4;
          s0 += f[p]!;
          s1 += f[p + 1]!;
          s2 += f[p + 2]!;
          s3 += f[p + 3]!;
        }
      }
      const count = (yEnd - by) * (xEnd - bx);
      const m0 = s0 / count;
      const m1 = s1 / count;
      const m2 = s2 / count;
      const m3 = s3 / count;
      for (let y = by; y < yEnd; y++) {
        for (let x = bx; x < xEnd; x++) {
          const p = (y * w + x) * 4;
          out[p] = m0;
          out[p + 1] = m1;
          out[p + 2] = m2;
          out[p + 3] = m3;
        }
      }
    }
  }
  return unpremultiply(out, w, h);
}

/* --------------------------------------------------------- the catalogue */

export type FilterId =
  | "brightness-contrast"
  | "hue-saturation"
  | "invert"
  | "grayscale"
  | "sepia"
  | "blur"
  | "sharpen"
  | "noise"
  | "pixelate";

/**
 * Every knob any filter has, in one flat record.
 *
 * One record rather than a union per filter because the panel holds ONE
 * params object across a filter change: switching from Blur to Noise and back
 * must find the radius where it was left, and a discriminated union would
 * discard it on every switch. The keys are distinct on purpose — `amount` is
 * the sharpen's and `grain` is the noise's — so no two filters can disagree
 * about what a slider means.
 */
export interface FilterParams {
  readonly brightness: number;
  readonly contrast: number;
  readonly hue: number;
  readonly saturation: number;
  readonly radius: number;
  readonly amount: number;
  readonly grain: number;
  readonly monochrome: boolean;
  readonly block: number;
}

export const DEFAULT_FILTER_PARAMS: FilterParams = {
  brightness: 0,
  contrast: 0,
  hue: 0,
  saturation: 0,
  radius: 4,
  amount: 60,
  grain: 12,
  monochrome: true,
  block: 8
};

/** One slider, or one switch, in the panel. Rendered by mapping this list. */
export interface FilterControl {
  readonly key: keyof FilterParams;
  readonly label: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** How the value reads beside the label — `%`, `°`, `px`, or nothing. */
  readonly unit?: string;
  readonly kind?: "slider" | "switch";
}

export interface FilterSpec {
  readonly id: FilterId;
  readonly label: string;
  readonly hint: string;
  /** Empty for the three that have nothing to tune — they apply as they are. */
  readonly controls: readonly FilterControl[];
}

/**
 * The filters, in the order the panel lists them: adjustments first, then the
 * one-click conversions, then the ones that move pixels around.
 */
export const FILTERS: readonly FilterSpec[] = [
  {
    id: "brightness-contrast",
    label: "Brightness / Contrast",
    hint: "Lift or drop the exposure, and open or close the tonal range around mid-grey.",
    controls: [
      { key: "brightness", label: "Brightness", min: -100, max: 100, step: 1 },
      { key: "contrast", label: "Contrast", min: -100, max: 100, step: 1 }
    ]
  },
  {
    id: "hue-saturation",
    label: "Hue / Saturation",
    hint: "Rotate every colour around the wheel, and push it towards grey or towards full.",
    controls: [
      { key: "hue", label: "Hue", min: -180, max: 180, step: 1, unit: "°" },
      { key: "saturation", label: "Saturation", min: -100, max: 100, step: 1 }
    ]
  },
  { id: "invert", label: "Invert", hint: "Negate every channel. Applying it twice is a no-op.", controls: [] },
  { id: "grayscale", label: "Grayscale", hint: "Rec.709 luma into all three channels.", controls: [] },
  { id: "sepia", label: "Sepia", hint: "The photographic warm-tone matrix.", controls: [] },
  {
    id: "blur",
    label: "Blur",
    hint: "Three separable box passes — a gaussian-grade blur that stays interactive at radius 20.",
    controls: [{ key: "radius", label: "Radius", min: BLUR_RADIUS_MIN, max: BLUR_RADIUS_MAX, step: 1, unit: "px" }]
  },
  {
    id: "sharpen",
    label: "Sharpen",
    hint: "A 3×3 unsharp cross. Past about 120% it starts ringing, which is the point of the slider.",
    controls: [{ key: "amount", label: "Amount", min: 0, max: 200, step: 5, unit: "%" }]
  },
  {
    id: "noise",
    label: "Add noise",
    hint: "Seeded uniform grain — the same seed every run, so the preview is what lands.",
    controls: [
      { key: "grain", label: "Amount", min: 0, max: 100, step: 1, unit: "%" },
      { key: "monochrome", label: "Monochrome", kind: "switch" }
    ]
  },
  {
    id: "pixelate",
    label: "Pixelate",
    hint: "Average each block and write it back — the block is in canvas pixels, not screen ones.",
    controls: [{ key: "block", label: "Block", min: PIXELATE_MIN, max: PIXELATE_MAX, step: 1, unit: "px" }]
  }
];

/** What the panel and the status line call a filter. */
export function filterLabel(id: FilterId): string {
  return FILTERS.find((f) => f.id === id)?.label ?? id;
}

/** Run one filter by id. The single door the store and the tests both use. */
export function runFilter(id: FilterId, src: PixelBuffer, params: FilterParams): PixelBuffer {
  switch (id) {
    case "brightness-contrast":
      return brightnessContrast(src, params);
    case "hue-saturation":
      return hueSaturation(src, params);
    case "invert":
      return invert(src);
    case "grayscale":
      return grayscale(src);
    case "sepia":
      return sepia(src);
    case "blur":
      return boxBlur(src, params);
    case "sharpen":
      return sharpen(src, params);
    case "noise":
      return noise(src, { amount: params.grain, monochrome: params.monochrome });
    case "pixelate":
      return pixelate(src, params);
  }
}

/**
 * How much of the buffer a PREVIEW run should use — 1 for full, 0.5 for half.
 *
 * **Apply is always 1.** This exists only so a slider drag stays live, and it
 * is a per-filter rule rather than a per-radius one because of how the maths
 * actually costs: the box blur slides its window, so radius 20 is the same
 * arithmetic per pixel as radius 1 — what costs is the six full sweeps of a
 * 1.6-megapixel buffer, and halving the resolution quarters the pixels. The
 * radius still appears in the rule because a small radius finishes inside a
 * frame either way and a half-resolution preview of a 1px blur would be
 * showing a blur the Apply is not going to produce.
 *
 * `pixelate` is never halved, at any block size: a block is measured in canvas
 * pixels, so running it on a half-size copy and scaling back up would preview
 * blocks at twice the size that lands. A preview that is wrong is worse than a
 * preview that is slow.
 */
export function previewScale(id: FilterId, params: FilterParams): number {
  if (id === "blur" && params.radius > 4) return 0.5;
  if (id === "sharpen" && params.amount > 0) return 0.5;
  return 1;
}
