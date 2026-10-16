/**
 * @file AmberArt's procedural textures — eight tileable patterns, generated.
 *
 * Nothing here downloads, imports or decodes an asset. Every pattern is a
 * function of position, evaluated on a small tile and repeated by
 * `ctx.createPattern(tile, "repeat")` — which is the plan's binding note on the
 * subject ("procedural and local — no downloads, no assets, no network") and is
 * also the only shape that survives the module having no backend.
 *
 * ## Two layers, on purpose — the same split `selection.ts` makes
 *
 * Everything below is a **scalar FIELD** first: `(x, y) → coverage in [0, 1]`,
 * defined over the whole plane and periodic on a `tile × tile` torus. The
 * canvas half rasterises a field into a tile and paints it. That order is not
 * decoration:
 *
 *   - Node has no `<canvas>`, so a generator expressed as drawing calls is a
 *     generator that cannot be tested. A field is plain arithmetic, and
 *     `test/amberart-textures.test.ts` drives it directly.
 *   - "It tiles" becomes a statement with a truth value: `f(x, y)` must equal
 *     `f(x + tile, y)` and `f(x, y + tile)`, EXACTLY. A pattern drawn with
 *     strokes can only be eyeballed for seams; a torus function either is one
 *     or is not, and the test asks.
 *
 * ## What makes the equality exact rather than nearly exact
 *
 * Two rules, and both are load-bearing:
 *
 *   1. **Lattice coordinates are computed as `x * cells / tile`, never as
 *      `x / cellSize`.** `tile` is a power of two and `x` and `cells` are
 *      integers, so the multiply and the divide are both exact and advancing
 *      `x` by `tile` advances the lattice coordinate by exactly `cells` — an
 *      integer, so the fractional part is bit-identical. Written the other way
 *      round (`x / 6.4`) the divisor is not representable and the seam lands a
 *      last-bit apart, which is invisible in a tile and visible in a test.
 *   2. **Anything fed to `Math.sin` is wrapped to [0, 1) FIRST.** `sin(u·2π)`
 *      and `sin((u + 3)·2π)` are the same number in mathematics and different
 *      floats in a machine. The marble veins wrap their phase before scaling,
 *      so the seam is exact rather than 1e-16 out.
 *
 * ## Determinism
 *
 * A mulberry32-style mixer, seeded per call. Lattice values come from a
 * coordinate HASH rather than from a stream, so a cell's value does not depend
 * on the order the rasteriser happened to visit it in — which is what lets the
 * field be sampled at an arbitrary point (a test, a thumbnail, a fill at 4×) and
 * still be the same pattern. The stream form is used where a genuinely
 * sequential draw is wanted: the marble's per-octave seeds.
 */

/** The eight generators, by id. */
export type TextureKind =
  | "grain"
  | "fibre"
  | "weave"
  | "halftone"
  | "stripes"
  | "checker"
  | "hatch"
  | "marble";

export interface TexturePattern {
  readonly id: TextureKind;
  readonly label: string;
  readonly hint: string;
}

/** What the rail's picker renders, in the order it renders them. */
export const TEXTURE_PATTERNS: readonly TexturePattern[] = [
  { id: "grain", label: "Noise grain", hint: "Film grain — per-pixel speckle over a soft field." },
  { id: "fibre", label: "Paper fibre", hint: "Stretched fibres, as in a sheet of laid paper." },
  { id: "weave", label: "Canvas weave", hint: "Warp over weft — an artist's canvas, thread by thread." },
  { id: "halftone", label: "Halftone dots", hint: "A print screen: offset rows of dots." },
  { id: "stripes", label: "Diagonal stripes", hint: "Even 45° bands." },
  { id: "checker", label: "Checker", hint: "Hard squares, alternating." },
  { id: "hatch", label: "Cross-hatch", hint: "Two crossing sets of fine ruled lines." },
  { id: "marble", label: "Marble", hint: "Veins bent by fbm turbulence — value noise, five octaves." }
];

/**
 * The tile's edge, in pixels.
 *
 * A power of two because every exactness argument in the header rests on it,
 * and 256 rather than 128 because the marble's lowest octave is four cells
 * across: at 128 its features are 32px and the pattern reads as noise rather
 * than as stone.
 */
export const TEXTURE_TILE = 256;

export interface TextureParams {
  /** Tile edge in pixels. A power of two — see the header. */
  readonly tile: number;
  /** How much of the tile the ink covers. 0.5 is the pattern as designed. */
  readonly density: number;
  /** 0 leaves the field alone; 1 pushes it towards its own extremes. */
  readonly contrast: number;
}

export const DEFAULT_TEXTURE_PARAMS: TextureParams = {
  tile: TEXTURE_TILE,
  density: 0.5,
  contrast: 0.5
};

/** Coverage rasterised: RGBA, `tile` square. The pure half's output. */
export interface TileData {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/**
 * How dark the ink goes where coverage is full.
 *
 * The tile carries BOTH a grey and an alpha: alpha says where the pattern is,
 * the grey says how dark it is there. Pure black would have been simpler and
 * would have broken the tint — `multiply` against black is black whatever the
 * foreground colour is, so a tinted fill would have come out the same shade of
 * nothing for every colour on the rail.
 */
const INK_DEPTH = 0.82;

const BASE_SEED = 20260815;

/* ------------------------------------------------------------------- pure */

/** The house PRNG — one 32-bit state, one multiply-xor step per draw. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable seed per generator, so a thumbnail is the tile it previews. */
export function textureSeed(kind: TextureKind): number {
  let h = BASE_SEED >>> 0;
  for (let i = 0; i < kind.length; i++) {
    h ^= kind.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Mulberry32's mixing step over a coordinate pair — a lattice's value. */
function hash2(x: number, y: number, seed: number): number {
  let a = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + (seed | 0)) | 0;
  a = Math.imul(a ^ (a >>> 13), 1274126177);
  a ^= a >>> 16;
  return (a >>> 0) / 4294967296;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Hermite ease — the standard smoothstep, on an already-normalised input. */
const smooth = (t: number): number => t * t * (3 - 2 * t);
/** The fractional part, for negatives too. */
const frac = (v: number): number => v - Math.floor(v);
const wrapInt = (n: number, m: number): number => ((n % m) + m) % m;

/**
 * Bilinear value noise on a wrapped lattice.
 *
 * `cellsX`/`cellsY` are how many lattice cells span the tile — separate so a
 * pattern can be stretched (the paper fibre is three cells wide and forty
 * tall, which is what makes a fibre a fibre rather than a blob). Any positive
 * integer works; it does not have to divide the tile, because periodicity comes
 * from the lattice index wrapping, not from the cell size.
 */
function valueNoise(
  x: number,
  y: number,
  cellsX: number,
  cellsY: number,
  tile: number,
  seed: number
): number {
  const u = (x * cellsX) / tile;
  const v = (y * cellsY) / tile;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fx = smooth(u - i);
  const fy = smooth(v - j);
  const i0 = wrapInt(i, cellsX);
  const j0 = wrapInt(j, cellsY);
  const i1 = wrapInt(i + 1, cellsX);
  const j1 = wrapInt(j + 1, cellsY);
  const top = lerp(hash2(i0, j0, seed), hash2(i1, j0, seed), fx);
  const bottom = lerp(hash2(i0, j1, seed), hash2(i1, j1, seed), fx);
  return lerp(top, bottom, fy);
}

/** Octaves of {@link valueNoise}, each twice the frequency and half the weight. */
function fbm(
  x: number,
  y: number,
  cellsX: number,
  cellsY: number,
  octaves: number,
  tile: number,
  seed: number
): number {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let cx = cellsX;
  let cy = cellsY;
  const rand = mulberry32(seed);
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x, y, cx, cy, tile, (rand() * 0xffffffff) | 0);
    norm += amp;
    amp *= 0.5;
    cx *= 2;
    cy *= 2;
  }
  return sum / norm;
}

/** fbm over `|2n − 1|` — the ridged form marble veins are bent by. */
function turbulence(
  x: number,
  y: number,
  cells: number,
  octaves: number,
  tile: number,
  seed: number
): number {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let c = cells;
  const rand = mulberry32(seed);
  for (let o = 0; o < octaves; o++) {
    sum += amp * Math.abs(2 * valueNoise(x, y, c, c, tile, (rand() * 0xffffffff) | 0) - 1);
    norm += amp;
    amp *= 0.5;
    c *= 2;
  }
  return sum / norm;
}

/**
 * A soft band centred in a 0–1 period.
 *
 * `width` is how much of the period the ink covers and `edge` is how far the
 * falloff runs beyond it, both as fractions of the period — so a stripe's
 * softness scales with its pitch instead of being a pixel count that goes hard
 * at 4× and mushy at 0.25×.
 */
function band(f: number, width: number, edge: number): number {
  const outer = width / 2 + edge;
  return smooth(clamp01((outer - Math.abs(f - 0.5)) / Math.max(1e-6, edge)));
}

type Field = (x: number, y: number) => number;

/**
 * The eight generators.
 *
 * Each returns a field over the torus of side `params.tile`. Every lattice
 * count and every pitch below is derived FROM the tile (`tile / 8`, `tile / 16`)
 * rather than written as a pixel constant, which is what keeps the periods
 * dividing the tile at any size.
 */
const FIELDS: Record<TextureKind, (params: TextureParams, seed: number) => Field> = {
  /** Film grain: per-pixel hash over a soft two-pixel field, so it has body. */
  grain: (p, seed) => {
    const t = p.tile;
    return (x, y) => {
      const speck = hash2(wrapInt(Math.floor(x), t), wrapInt(Math.floor(y), t), seed);
      const soft = valueNoise(x, y, t / 4, t / 4, t, seed ^ 0x51ed270b);
      return clamp01(0.62 * speck + 0.38 * soft);
    };
  },

  /**
   * Laid paper: long fibres, a weaker cross set, and a fleck of dust.
   *
   * The anisotropy is the whole pattern, and it comes from the two cell counts
   * rather than from scaling `x` — scaling the coordinate would have moved the
   * seam off the tile, which is the trap the header's rule 1 is about.
   */
  fibre: (p, seed) => {
    const t = p.tile;
    return (x, y) => {
      const long = fbm(x, y, 3, 40, 3, t, seed);
      const cross = fbm(x, y, 40, 3, 2, t, seed ^ 0x9e3779b9);
      const fleck = hash2(wrapInt(Math.floor(x), t), wrapInt(Math.floor(y), t), seed ^ 0x1b873593);
      return clamp01(0.58 * long + 0.30 * cross + 0.12 * fleck);
    };
  },

  /**
   * Canvas: sixteen threads each way, warp and weft alternating over and under.
   *
   * The over/under is the cell's parity, and the shading across a thread is a
   * half sine — bright along the crown, dark in the trough between threads,
   * which is what makes it read as woven rather than as a grid.
   */
  weave: (p, seed) => {
    const t = p.tile;
    const pitch = t / 16;
    const crown = (f: number): number => 0.32 + 0.68 * Math.sin(Math.PI * f);
    return (x, y) => {
      const i = Math.floor(x / pitch);
      const j = Math.floor(y / pitch);
      const warpOnTop = ((i + j) & 1) === 0;
      const thread = warpOnTop ? crown(x / pitch - i) * 0.95 : crown(y / pitch - j) * 0.78;
      const tooth = hash2(wrapInt(Math.floor(x), t), wrapInt(Math.floor(y), t), seed) * 0.14;
      return clamp01(thread * 0.88 + tooth);
    };
  },

  /**
   * A print screen: eight dots across, every other row offset by half a pitch.
   *
   * Only the dot of the cell the point falls in is measured. That is enough
   * rather than a shortcut: the offset rows put a neighbouring centre at least
   * half a pitch away vertically, which is further than the dot's radius plus
   * its falloff can reach, so the nearest centre is always this cell's.
   */
  halftone: (p, seed) => {
    const t = p.tile;
    const pitch = t / 8;
    const radius = pitch * 0.34;
    const edge = pitch * 0.07;
    return (x, y) => {
      const j = Math.floor(y / pitch);
      const shift = (j & 1) === 1 ? pitch / 2 : 0;
      const i = Math.floor((x - shift) / pitch);
      const cx = (i + 0.5) * pitch + shift;
      const cy = (j + 0.5) * pitch;
      const d = Math.hypot(x - cx, y - cy);
      return smooth(clamp01((radius + edge - d) / Math.max(1e-6, edge)));
    };
  },

  /** Even 45° bands — eight of them across the tile. */
  stripes: (p) => {
    const t = p.tile;
    const pitch = t / 8;
    return (x, y) => band(frac((x + y) / pitch), 0.46, 0.10);
  },

  /** Hard squares. No softening: a checker with a soft edge is a blur. */
  checker: (p) => {
    const t = p.tile;
    const cell = t / 8;
    return (x, y) => (((Math.floor(x / cell) + Math.floor(y / cell)) & 1) === 0 ? 1 : 0);
  },

  /** Two ruled sets crossing at right angles, with the crossings a shade darker. */
  hatch: (p) => {
    const t = p.tile;
    const pitch = t / 16;
    return (x, y) => {
      const a = band(frac((x + y) / pitch), 0.16, 0.10);
      const b = band(frac((x - y) / pitch), 0.16, 0.10);
      return clamp01(Math.max(a, b) * 0.9 + a * b * 0.28);
    };
  },

  /**
   * Marble: a sine of position, its phase bent by five octaves of turbulence.
   *
   * `KX`/`KY` are integers so the veins close on themselves across the tile,
   * and the phase is wrapped to [0, 1) BEFORE it is scaled by 2π — see the
   * header's rule 2, which this generator is the reason for.
   */
  marble: (p, seed) => {
    const t = p.tile;
    const KX = 3;
    const KY = 1;
    const BEND = 2.6;
    return (x, y) => {
      const phase = frac((x * KX + y * KY) / t);
      const turb = turbulence(x, y, 4, 5, t, seed ^ 0x27d4eb2f);
      return clamp01(0.5 + 0.5 * Math.sin(phase * Math.PI * 2 + turb * BEND));
    };
  }
};

/**
 * Density and contrast, applied to every generator the same way.
 *
 * Density scales coverage (0.5 is the pattern as its generator drew it) and
 * contrast leans it towards its own extremes. Both live here rather than inside
 * the eight fields so that "the same knob does the same thing to every pattern"
 * is true by construction instead of eight times by hand.
 */
function shape(v: number, density: number, contrast: number): number {
  const biased = clamp01(v * (0.5 + clamp01(density)));
  const k = clamp01(contrast);
  return clamp01(biased + k * (smooth(biased) - biased));
}

/**
 * A generator as a field: `(x, y) → coverage`, periodic on the tile.
 *
 * The unit the tests drive and the unit the rasteriser consumes — there is no
 * third path, so a tile and a test can never be looking at different patterns.
 */
export function textureField(
  kind: TextureKind,
  params: TextureParams = DEFAULT_TEXTURE_PARAMS,
  seed: number = textureSeed(kind)
): Field {
  const base = FIELDS[kind](params, seed | 0);
  const { density, contrast } = params;
  return (x, y) => shape(base(x, y), density, contrast);
}

/**
 * Rasterise a generator into RGBA — the pure half's tile.
 *
 * Grey and alpha both carry the field, for the reason {@link INK_DEPTH}
 * records: alpha is where the pattern is, the grey is how dark it is there, and
 * the tint has something other than black to multiply.
 */
export function textureTileData(
  kind: TextureKind,
  params: TextureParams = DEFAULT_TEXTURE_PARAMS,
  seed: number = textureSeed(kind)
): TileData {
  const size = Math.max(8, Math.round(params.tile));
  const field = textureField(kind, params, seed);
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = clamp01(field(x, y));
      const p = (y * size + x) * 4;
      const grey = Math.round(255 * (1 - INK_DEPTH * v));
      data[p] = grey;
      data[p + 1] = grey;
      data[p + 2] = grey;
      data[p + 3] = Math.round(255 * v);
    }
  }
  return { width: size, height: size, data };
}

/* ----------------------------------------------------------------- canvas */

function blank(width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

/**
 * Tiles already built, by generator and parameters.
 *
 * A 256² tile is a quarter of a megapixel of arithmetic — trivial once, and
 * absurd on every pointer click and every one of eight thumbnails per render.
 * Keyed by everything that changes the pixels, so a cache hit is the same tile
 * rather than nearly it.
 */
const tiles = new Map<string, HTMLCanvasElement>();

const tileKey = (kind: TextureKind, p: TextureParams, seed: number): string =>
  `${kind}|${p.tile}|${p.density}|${p.contrast}|${seed}`;

/** A generator as a canvas, ready for `createPattern`. Memoised. Browser-only. */
export function textureTile(
  kind: TextureKind,
  params: TextureParams = DEFAULT_TEXTURE_PARAMS,
  seed: number = textureSeed(kind)
): HTMLCanvasElement | null {
  const key = tileKey(kind, params, seed);
  const hit = tiles.get(key);
  if (hit) return hit;

  const data = textureTileData(kind, params, seed);
  const c = blank(data.width, data.height);
  const ctx = c?.getContext("2d");
  if (!c || !ctx) return null;
  const img = ctx.createImageData(data.width, data.height);
  img.data.set(data.data);
  ctx.putImageData(img, 0, 0);
  tiles.set(key, c);
  return c;
}

/**
 * The tile multiplied by a colour — the rail's tint toggle.
 *
 * Genuinely `multiply`, not a recolour: the grey structure survives, so a
 * tinted weave still has its dark troughs instead of flattening to one flat
 * shade of the foreground. The `destination-in` afterwards puts the tile's own
 * alpha back, which the opaque fill has just overwritten everywhere.
 *
 * Not memoised: it is one 256² composite per fill click, and caching it would
 * mean keying on a colour that changes every time somebody touches the swatch.
 */
export function tintTile(tile: HTMLCanvasElement, color: string): HTMLCanvasElement | null {
  const c = blank(tile.width, tile.height);
  const ctx = c?.getContext("2d");
  if (!c || !ctx) return null;
  ctx.drawImage(tile, 0, 0);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(tile, 0, 0);
  return c;
}
