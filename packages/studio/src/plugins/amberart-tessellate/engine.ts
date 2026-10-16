/**
 * @file The tessellation engine — pure, DOM-free, deterministic.
 *
 * ## Why the engine lives in the PLUGIN, not in `@/lib/amberart/*`
 *
 * ArtGen puts its renderer in `@/lib/amberart/*` because three consumers share
 * it (the module, the plugin and an API route). This engine has exactly one
 * consumer — this plugin's panel — and `src/lib/amberart/**` belongs to another
 * build stream (`.claude/rules/concurrent-builds.md`, one writer per path). A
 * plugin owning its own engine is the correct shape here: nothing outside this
 * directory needs it, and it keeps the plugin installable without touching a
 * path this session does not own. If the module ever needs to draw a
 * tessellation itself, THAT is the moment to lift this into `@/lib/amberart`.
 *
 * ## The no-overlap guarantee
 *
 * A Voronoi partition, where every boundary between two pieces is ONE curve,
 * built ONCE, in the shared-edge stage. Piece A emits its bezier segments
 * forward; piece B emits the very same segments backwards (control points
 * swapped). Neither piece may smooth, decimate or perturb a boundary on its
 * own, so at spacing 0 the pieces interlock exactly — no overlap, no gap.
 *
 * That is why smoothness and decimation live in {@link buildEdges} and NOT in
 * the per-piece render: doing either per piece gives one boundary two different
 * shapes, which draws as doubled/crossed lines. Anything added later that
 * reshapes a boundary (texture, taper, hand-drawn jitter) belongs in the
 * shared-edge stage too.
 *
 * Verified by `build/tools/drawing-lab/verify.mjs`, which measures the two
 * sides of every boundary against each other and checks every inset outline
 * for crossings and corner spurs.
 */

export type Pt = [number, number];

/** One cubic bezier of a shared boundary. Reversible without recomputation. */
export interface Seg {
  p0: Pt;
  c1: Pt;
  c2: Pt;
  p1: Pt;
}

export type FillMode = "none" | "solid" | "palette";

export interface TessellateParams {
  /** Poisson spacing == piece scale, px. */
  size: number;
  /** 0-100. Lobe count and depth on each shared edge. */
  complexity: number;
  /** 0 = angular polygon, 100 = flowing curves. */
  smoothness: number;
  /** Degrees. Caps how steeply a contour turns off its chord. */
  maxAngle: number;
  /** px gap between pieces. 0 = interlocked. */
  spacing: number;
  thickness: number;
  strokeOpacity: number;
  fillOpacity: number;
  fillMode: FillMode;
  bg: string;
  stroke: string;
  fill: string;
  /** Palette hue range, degrees. */
  spread: number;
  /** Palette lightness variance. */
  lightVar: number;
  seed: number;
  width: number;
  height: number;
}

export const DEFAULTS: TessellateParams = {
  size: 218,
  complexity: 55,
  smoothness: 60,
  maxAngle: 70,
  spacing: 0,
  thickness: 2.6,
  strokeOpacity: 100,
  fillOpacity: 100,
  fillMode: "none",
  bg: "#F7F7F6",
  stroke: "#3F3F46",
  fill: "#FFFFFF",
  spread: 40,
  lightVar: 14,
  seed: 20260804,
  width: 1920,
  height: 1080,
};

/* -------------------------------------------------------------------- rng */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const edgeKey = (a: number, b: number): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/* ------------------------------------ poisson disc sampling (Bridson 2007) */

function poisson(
  x0: number, y0: number, x1: number, y1: number,
  r: number, rand: () => number, k = 24
): Pt[] {
  const cell = r / Math.SQRT2;
  const gw = Math.ceil((x1 - x0) / cell);
  const gh = Math.ceil((y1 - y0) / cell);
  const grid = new Int32Array(gw * gh).fill(-1);
  const pts: Pt[] = [];
  const active: number[] = [];

  const add = (p: Pt): void => {
    const gx = Math.floor((p[0] - x0) / cell);
    const gy = Math.floor((p[1] - y0) / cell);
    grid[gy * gw + gx] = pts.length;
    pts.push(p);
    active.push(pts.length - 1);
  };
  add([x0 + (x1 - x0) * rand(), y0 + (y1 - y0) * rand()]);

  while (active.length) {
    const ai = Math.floor(rand() * active.length);
    const p = pts[active[ai]];
    let placed = false;
    for (let t = 0; t < k; t++) {
      const ang = rand() * Math.PI * 2;
      const rad = r * (1 + rand());
      const qx = p[0] + Math.cos(ang) * rad;
      const qy = p[1] + Math.sin(ang) * rad;
      if (qx < x0 || qx >= x1 || qy < y0 || qy >= y1) continue;
      const gx = Math.floor((qx - x0) / cell);
      const gy = Math.floor((qy - y0) / cell);
      let ok = true;
      for (let dy = -2; dy <= 2 && ok; dy++) {
        for (let dx = -2; dx <= 2 && ok; dx++) {
          const nx = gx + dx, ny = gy + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const idx = grid[ny * gw + nx];
          if (idx < 0) continue;
          const o = pts[idx];
          if ((o[0] - qx) ** 2 + (o[1] - qy) ** 2 < r * r) ok = false;
        }
      }
      if (ok) { add([qx, qy]); placed = true; break; }
    }
    if (!placed) active.splice(ai, 1);
  }
  return pts;
}

/* -------------------------------------- voronoi by half-plane clipping */

function clipHalf(poly: Pt[], a: Pt, b: Pt): Pt[] {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const f = (p: Pt): number => (p[0] - mx) * dx + (p[1] - my) * dy;
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const fp = f(p), fq = f(q);
    if (fp <= 0) out.push(p);
    if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) {
      const t = fp / (fp - fq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

interface Geom {
  W: number; H: number;
  X0: number; Y0: number; X1: number; Y1: number;
  verts: Pt[];
  cells: number[][];
  cellSite: Pt[];
}

let GEOM: Geom | null = null;
let GEOM_KEY = "";

/** Stage 1 — sites and the Voronoi partition. Depends on seed / size / page. */
export function buildGeom(P: TessellateParams): Geom {
  const key = [P.seed, P.size, P.width, P.height].join("|");
  if (key === GEOM_KEY && GEOM) return GEOM;

  const W = P.width, H = P.height;
  const M = Math.max(180, P.size * 1.6);
  const X0 = -M, Y0 = -M, X1 = W + M, Y1 = H + M;
  const sites = poisson(X0, Y0, X1, Y1, P.size, mulberry32(P.seed));
  const rect: Pt[] = [[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1]];
  const cull = (P.size * 6) ** 2;

  const polys = sites.map((s, i) => {
    let poly = rect;
    for (let j = 0; j < sites.length; j++) {
      if (i === j) continue;
      const o = sites[j];
      if ((o[0] - s[0]) ** 2 + (o[1] - s[1]) ** 2 > cull) continue;
      poly = clipHalf(poly, s, o);
      if (poly.length < 3) break;
    }
    return poly;
  });

  // Snap vertices so neighbouring pieces agree on a shared corner exactly.
  const EPS = 1.2, G = 4;
  const bucket = new Map<string, number[]>();
  const verts: Pt[] = [];
  const canon = (p: Pt): number => {
    const gx = Math.floor(p[0] / G), gy = Math.floor(p[1] / G);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = bucket.get(`${gx + dx},${gy + dy}`);
        if (!list) continue;
        for (const id of list) {
          const v = verts[id];
          if (Math.abs(v[0] - p[0]) < EPS && Math.abs(v[1] - p[1]) < EPS) return id;
        }
      }
    }
    const id = verts.length;
    verts.push(p);
    const k2 = `${gx},${gy}`;
    const arr = bucket.get(k2);
    if (arr) arr.push(id); else bucket.set(k2, [id]);
    return id;
  };

  const cells: number[][] = [];
  const cellSite: Pt[] = [];
  for (let i = 0; i < polys.length; i++) {
    const poly = polys[i];
    if (poly.length < 3) continue;
    const ids: number[] = [];
    for (const p of poly) {
      const id = canon(p);
      if (ids.length && ids[ids.length - 1] === id) continue;
      ids.push(id);
    }
    while (ids.length > 1 && ids[0] === ids[ids.length - 1]) ids.pop();
    if (ids.length >= 3) { cells.push(ids); cellSite.push(sites[i]); }
  }

  GEOM_KEY = key;
  GEOM = { W, H, X0, Y0, X1, Y1, verts, cells, cellSite };
  return GEOM;
}

/* --------------------------------------------------------- curve helpers */

/** Catmull-Rom over an OPEN polyline, endpoints pinned. tension 0 = straight. */
function crOpen(p: Pt[], tension: number): Seg[] {
  const n = p.length;
  const segs: Seg[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = i - 1 >= 0 ? p[i - 1] : p[0];
    const p1 = p[i], p2 = p[i + 1];
    const p3 = i + 2 < n ? p[i + 2] : p[n - 1];
    segs.push({
      p0: p1,
      c1: [p1[0] + (p2[0] - p0[0]) * tension, p1[1] + (p2[1] - p0[1]) * tension],
      c2: [p2[0] - (p3[0] - p1[0]) * tension, p2[1] - (p3[1] - p1[1]) * tension],
      p1: p2,
    });
  }
  return segs;
}

function bezAt(s: Seg, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [
    a * s.p0[0] + b * s.c1[0] + c * s.c2[0] + d * s.p1[0],
    a * s.p0[1] + b * s.c1[1] + c * s.c2[1] + d * s.p1[1],
  ];
}

/* ------------------------------ stage 2: the shared boundaries -------- */

let EDGES: Map<string, Seg[]> | null = null;
let EDGES_KEY = "";

/**
 * Build every boundary exactly once.
 *
 * Everything that SHAPES a boundary happens here — complexity, the max-angle
 * limiter, smoothing and decimation. A piece may later reverse these segments,
 * never reshape them.
 */
export function buildEdges(P: TessellateParams): Map<string, Seg[]> {
  const g = buildGeom(P);
  const key = [GEOM_KEY, P.complexity, P.maxAngle, P.smoothness].join("|");
  if (key === EDGES_KEY && EDGES) return EDGES;

  const c = P.complexity / 100;
  const knobChance = 0.15 + c * 0.8;
  const knobH = 0.16 + c * 0.42;
  const bowF = 0.04 + c * 0.13;
  const ripF = 0.01 + c * 0.09;
  const sampleDiv = 26 - c * 14;
  const maxSlope = Math.tan((P.maxAngle * Math.PI) / 180);
  const tension = (P.smoothness / 100) * 0.28;
  const step = P.smoothness >= 50 ? 1 : 1 + Math.round(((50 - P.smoothness) / 50) * 4);

  const onEdge = (v: Pt): boolean =>
    Math.abs(v[0] - g.X0) < 1 || Math.abs(v[0] - g.X1) < 1 ||
    Math.abs(v[1] - g.Y0) < 1 || Math.abs(v[1] - g.Y1) < 1;

  // Which two pieces own each boundary — their sites cap how deep a lobe may go.
  const owners = new Map<string, Pt[]>();
  for (let ci = 0; ci < g.cells.length; ci++) {
    const ids = g.cells[ci];
    for (let i = 0; i < ids.length; i++) {
      const k = edgeKey(ids[i], ids[(i + 1) % ids.length]);
      const o = owners.get(k);
      if (o) o.push(g.cellSite[ci]); else owners.set(k, [g.cellSite[ci]]);
    }
  }

  function organicEdge(A: Pt, B: Pt, rand: () => number, straight: boolean, sites: Pt[]): Seg[] {
    const dx = B[0] - A[0], dy = B[1] - A[1];
    const L = Math.hypot(dx, dy);
    if (straight || L < 22) return crOpen([A, B], 0);
    const ux = dx / L, uy = dy / L;
    const nx = -uy, ny = ux;
    const n = Math.max(10, Math.min(44, Math.round(L / sampleDiv)));

    // A lobe may never reach past the owning sites, or it punches through a
    // piece that is not this boundary's neighbour.
    let headroom = Infinity;
    for (const s of sites) {
      headroom = Math.min(headroom, Math.abs((s[0] - A[0]) * nx + (s[1] - A[1]) * ny));
    }
    const maxAmp = Number.isFinite(headroom) ? headroom * 0.62 : L;

    const bow = (rand() * 2 - 1) * Math.min(L * bowF, 30);
    const rip = (rand() * 2 - 1) * Math.min(L * ripF, 16);
    const phase = rand() < 0.5 ? 1 : -1;
    const knob = rand() < knobChance && L > 60;
    const kh = Math.min(L * knobH, 78) * (rand() < 0.5 ? -1 : 1);
    const kt = 0.36 + rand() * 0.28;
    const kw = 0.13 + rand() * 0.09;

    const off = new Float64Array(n + 1);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      let o = bow * Math.sin(Math.PI * t) + rip * phase * Math.sin(2 * Math.PI * t);
      if (knob) {
        const d = (t - kt) / kw;
        o += kh * Math.exp(-d * d * 2.2) * Math.sqrt(Math.sin(Math.PI * t));
      }
      off[i] = Math.max(-maxAmp, Math.min(maxAmp, o));
    }
    // Maximum-angle limiter: clamp the contour's slope relative to the chord.
    const ds = L / n, lim = maxSlope * ds;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i <= n; i++) off[i] = Math.max(off[i - 1] - lim, Math.min(off[i - 1] + lim, off[i]));
      for (let i = n - 1; i >= 0; i--) off[i] = Math.max(off[i + 1] - lim, Math.min(off[i + 1] + lim, off[i]));
    }
    off[0] = 0; off[n] = 0;

    let pts: Pt[] = [A];
    for (let i = 1; i < n; i++) {
      const t = i / n;
      pts.push([A[0] + ux * L * t + nx * off[i], A[1] + uy * L * t + ny * off[i]]);
    }
    pts.push(B);

    // Decimate HERE, on the shared boundary, never per piece.
    if (step > 1 && pts.length > 3) {
      const dec: Pt[] = [pts[0]];
      for (let i = step; i < pts.length - 1; i += step) dec.push(pts[i]);
      dec.push(pts[pts.length - 1]);
      pts = dec;
    }
    return crOpen(pts, tension);
  }

  const map = new Map<string, Seg[]>();
  for (const [k, sites] of owners) {
    const [a, b] = k.split("|").map(Number);
    const A = g.verts[a], B = g.verts[b];
    map.set(k, organicEdge(A, B, mulberry32(hash32(k) ^ P.seed), onEdge(A) && onEdge(B), sites));
  }

  EDGES_KEY = key;
  EDGES = map;
  return EDGES;
}

/* ------------------------------------------------------ contour helpers */

export function signedArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const q = p[(i + 1) % n];
    a += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return a / 2;
}

function resample(pts: Pt[], step: number): Pt[] {
  const n = pts.length;
  const out: Pt[] = [pts[0]];
  let prev = pts[0], acc = 0;
  for (let i = 1; i <= n; i++) {
    const cur = pts[i % n];
    let len = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    while (acc + len >= step) {
      const t = (step - acc) / len;
      prev = [prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t];
      out.push(prev);
      len = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
      acc = 0;
    }
    acc += len;
    prev = cur;
  }
  if (out.length > 2 &&
      Math.hypot(out[out.length - 1][0] - out[0][0], out[out.length - 1][1] - out[0][1]) < step * 0.5) {
    out.pop();
  }
  return out;
}

function distSeg2(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  const cx = a[0] + dx * t - p[0], cy = a[1] + dy * t - p[1];
  return cx * cx + cy * cy;
}

function segGrid(pts: Pt[], cell: number): Map<string, number[]> {
  const g = new Map<string, number[]>();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const x0 = Math.floor(Math.min(a[0], b[0]) / cell), x1 = Math.floor(Math.max(a[0], b[0]) / cell);
    const y0 = Math.floor(Math.min(a[1], b[1]) / cell), y1 = Math.floor(Math.max(a[1], b[1]) / cell);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const k = `${x},${y}`;
        const arr = g.get(k);
        if (arr) arr.push(i); else g.set(k, [i]);
      }
    }
  }
  return g;
}

function clearsBy(p: Pt, pts: Pt[], grid: Map<string, number[]>, cell: number, minD: number): boolean {
  const min2 = minD * minD;
  // Walk exactly the cells the minD disc touches. A fixed radius around the
  // point's own cell is both wrong (a segment minD away can sit two cells out)
  // and wasteful.
  const x0 = Math.floor((p[0] - minD) / cell), x1 = Math.floor((p[0] + minD) / cell);
  const y0 = Math.floor((p[1] - minD) / cell), y1 = Math.floor((p[1] + minD) / cell);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const list = grid.get(`${x},${y}`);
      if (!list) continue;
      for (const i of list) if (distSeg2(p, pts[i], pts[(i + 1) % pts.length]) < min2) return false;
    }
  }
  return true;
}

const ccw3 = (a: Pt, b: Pt, c: Pt): number =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function segCross(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const d1 = ccw3(a, b, c), d2 = ccw3(a, b, d), d3 = ccw3(c, d, a), d4 = ccw3(c, d, b);
  if (!(((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))) return null;
  const t = d3 / (d3 - d4);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** First self-crossing, via a segment grid so the common clean case is O(n). */
function findCross(pts: Pt[]): { i: number; j: number; X: Pt } | null {
  const n = pts.length;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const cell = Math.max(1e-6, (total / n) * 2);
  const grid = segGrid(pts, cell);
  for (const list of grid.values()) {
    for (let u = 0; u < list.length; u++) {
      for (let v = u + 1; v < list.length; v++) {
        let i = list[u], j = list[v];
        if (i > j) { const t = i; i = j; j = t; }
        const gap = j - i;
        if (gap <= 1 || gap === n - 1) continue;
        const X = segCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n]);
        if (X) return { i, j, X };
      }
    }
  }
  return null;
}

/**
 * Cut self-intersection loops out of a closed contour.
 *
 * Pruning folded points is not sufficient on its own: deleting a run of points
 * leaves a straight chord jumping the gap, and that chord can slice through the
 * rest of the outline. At each crossing the contour splits into two closed
 * loops — keep the larger (the piece), discard the smaller (the scribble).
 */
function removeLoops(pts: Pt[], guard = 60): Pt[] {
  for (let pass = 0; pass < guard; pass++) {
    if (pts.length < 4) return pts;
    const cut = findCross(pts);
    if (!cut) return pts;
    const { i, j, X } = cut;
    const A: Pt[] = [X, ...pts.slice(i + 1, j + 1)];
    const B: Pt[] = [X, ...pts.slice(j + 1), ...pts.slice(0, i + 1)];
    pts = Math.abs(signedArea(A)) >= Math.abs(signedArea(B)) ? A : B;
  }
  return pts;
}

/**
 * Inset a closed contour by d, preserving its shape.
 *
 * Shrinking a shape is erosion by a disc: sharp corners get CUT OFF, they do
 * not extend. A miter joint does the opposite — it places the corner at
 * d/cos(half-angle), which at the sharp corner left by a jigsaw knob is a long
 * spur poking across the gap. So miter only while it stays near d, bevel past
 * that, then prune folds and cut any remaining loops. Returns [] for a piece
 * smaller than the gap it was asked to leave — dropped, never emitted as a knot.
 */
export function inset(pts: Pt[], d: number): Pt[] {
  if (d <= 0) return pts;

  // Loop removal is O(n^2) per pass; cap the contour density.
  let perim = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    perim += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const p = resample(pts, Math.max(2.5, d * 0.6, perim / 240));
  const n = p.length;
  if (n < 8) return [];

  const norms: Pt[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    const nx = b[1] - a[1], ny = a[0] - b[0];
    const l = Math.hypot(nx, ny) || 1;
    norms[i] = [nx / l, ny / l];
  }

  const MITER = 1.1;
  const build = (sgn: number): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const n1 = norms[(i - 1 + n) % n], n2 = norms[i];
      let mx = n1[0] + n2[0], my = n1[1] + n2[1];
      const lm = Math.hypot(mx, my);
      if (lm < 1e-6) continue;                     // 180° cusp, no valid bisector
      mx /= lm; my /= lm;
      const cos = Math.max(1e-3, mx * n1[0] + my * n1[1]);
      if (1 / cos <= MITER) {
        const len = d / cos;
        out.push([p[i][0] + sgn * mx * len, p[i][1] + sgn * my * len]);
      } else {
        out.push([p[i][0] + sgn * n1[0] * d, p[i][1] + sgn * n1[1] * d]);
        out.push([p[i][0] + sgn * n2[0] * d, p[i][1] + sgn * n2[1] * d]);
      }
    }
    return out;
  };

  const a0 = Math.abs(signedArea(p));
  let cand = build(1);
  if (Math.abs(signedArea(cand)) > a0) cand = build(-1);   // keep the shrinking one

  const clear = d * 0.9;
  const cell = Math.max(1, clear);
  const grid = segGrid(p, cell);
  const kept = cand.filter((q) => clearsBy(q, p, grid, cell, clear));
  if (kept.length < 8) return [];

  const clean = removeLoops(kept);
  if (clean.length < 8) return [];
  if (Math.abs(signedArea(clean)) < a0 * 0.08) return [];  // collapsed: drop it
  return clean;
}

/**
 * Walk a piece's boundary as ordered shared segments. One side emits the stored
 * segments, the other emits the identical segments reversed (control points
 * swapped) — never a recomputed curve.
 */
export function cellSegments(cellIds: number[], edges: Map<string, Seg[]>): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i < cellIds.length; i++) {
    const a = cellIds[i], b = cellIds[(i + 1) % cellIds.length];
    const segs = edges.get(edgeKey(a, b));
    if (!segs) continue;
    if (a < b) {
      for (const s of segs) out.push(s);
    } else {
      for (let k = segs.length - 1; k >= 0; k--) {
        const s = segs[k];
        out.push({ p0: s.p1, c1: s.c2, c2: s.c1, p1: s.p0 });
      }
    }
  }
  return out;
}

const f2 = (p: Pt): string => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;

function segmentsToPath(segs: Seg[]): string {
  if (!segs.length) return "";
  let d = `M${f2(segs[0].p0)}`;
  for (const s of segs) d += `C${f2(s.c1)} ${f2(s.c2)} ${f2(s.p1)}`;
  return d + "Z";
}

function segmentsToPoints(segs: Seg[], per = 4): Pt[] {
  const pts: Pt[] = [];
  for (const s of segs) for (let i = 0; i < per; i++) pts.push(bezAt(s, i / per));
  return pts;
}

function pointsToPath(pts: Pt[]): string {
  if (pts.length < 3) return "";
  let d = `M${f2(pts[0])}`;
  for (let i = 1; i < pts.length; i++) d += `L${f2(pts[i])}`;
  return d + "Z";
}

/** The one place spacing is applied, so nothing can disagree about the outline. */
export function pieceOutline(segs: Seg[], P: TessellateParams): { pts: Pt[]; d: string } {
  if (P.spacing > 0) {
    const pts = inset(segmentsToPoints(segs), P.spacing / 2);
    return { pts, d: pointsToPath(pts) };
  }
  return { pts: segmentsToPoints(segs), d: segmentsToPath(segs) };
}

/** Every piece's final outline (verification, and future hit-testing). */
export function pieceContours(P: TessellateParams): { pts: Pt[]; src: Pt[] }[] {
  const g = buildGeom(P);
  const edges = buildEdges(P);
  const out: { pts: Pt[]; src: Pt[] }[] = [];
  for (const ids of g.cells) {
    const segs = cellSegments(ids, edges);
    if (!segs.length) continue;
    const src = segmentsToPoints(segs);
    const { pts } = pieceOutline(segs, P);
    if (pts.length >= 3) out.push({ pts, src });
  }
  return out;
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return { h: 0, s: 0, l: 50 };
  const r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

export interface TessellateResult {
  svg: string;
  pieces: number;
  boundaries: number;
  ms: number;
}

/**
 * Stage 3 — render. Pure assembly: it may reorder and reverse shared segments,
 * it may never reshape one.
 */
export function buildSvg(params: Partial<TessellateParams> = {}): TessellateResult {
  const P: TessellateParams = { ...DEFAULTS, ...params };
  const t0 = Date.now();
  const g = buildGeom(P);
  const edges = buildEdges(P);
  const rand = mulberry32(P.seed ^ 0x9e3779b9);
  const base = hexToHsl(P.fill);

  const body: string[] = [];
  for (let ci = 0; ci < g.cells.length; ci++) {
    const segs = cellSegments(g.cells[ci], edges);
    if (!segs.length) continue;
    const { d } = pieceOutline(segs, P);
    if (!d) continue;

    let fill = "none";
    if (P.fillMode === "solid") fill = P.fill;
    else if (P.fillMode === "palette") {
      const h = (base.h + (rand() - 0.5) * P.spread + 360) % 360;
      const l = Math.max(4, Math.min(96, base.l + (rand() - 0.5) * P.lightVar));
      fill = `hsl(${h.toFixed(1)} ${base.s.toFixed(1)}% ${l.toFixed(1)}%)`;
    }
    body.push(`<path id="p${ci}" fill="${fill}" d="${d}"/>`);
  }

  const svg =
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g.W} ${g.H}" width="${g.W}" height="${g.H}">
  <defs><clipPath id="page"><rect width="${g.W}" height="${g.H}"/></clipPath></defs>
  <rect width="${g.W}" height="${g.H}" fill="${P.bg}"/>
  <g clip-path="url(#page)" stroke="${P.stroke}" stroke-width="${P.thickness}"
     stroke-opacity="${(P.strokeOpacity / 100).toFixed(3)}" fill-opacity="${(P.fillOpacity / 100).toFixed(3)}"
     stroke-linejoin="round" stroke-linecap="round">
${body.map((s) => "    " + s).join("\n")}
  </g>
</svg>`;

  return { svg, pieces: body.length, boundaries: edges.size, ms: Date.now() - t0 };
}
