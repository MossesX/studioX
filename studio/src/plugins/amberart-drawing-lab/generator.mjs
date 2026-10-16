/**
 * Interlocking shape generator — pure, DOM-free, deterministic.
 *
 * Shared by the Drawing Lab UI (index.html), the headless renderer
 * (render.mjs) and the interlock verifier (verify.mjs), so the sliders and any
 * batch/export path run identical code. Intended to become the engine of the
 * future GizmoX drawing module.
 *
 * ── The no-overlap guarantee ───────────────────────────────────────────────
 * A Voronoi partition, where every boundary between two pieces is ONE curve,
 * built ONCE, in the shared-edge stage. Piece A emits its bezier segments
 * forward; piece B emits the very same segments backwards (control points
 * swapped). Neither piece can smooth, decimate or perturb a boundary on its
 * own, so at spacing 0 the pieces interlock exactly — no overlap, no gap.
 *
 * This is why smoothness and decimation live in buildEdges() and NOT in the
 * per-piece render: doing either per piece gives one boundary two different
 * shapes, which shows up as doubled/crossed lines.
 *
 * Lobe amplitude is additionally capped against the distance from the edge to
 * its two owning sites, so a deep knob can never punch through a non-adjacent
 * neighbour.
 */

export const DEFAULTS = {
  size: 218,        // poisson spacing == piece scale, px
  complexity: 55,   // 0-100, lobe count + depth on each shared edge
  smoothness: 60,   // 0 = angular polygon, 100 = flowing curves
  maxAngle: 70,     // deg, caps how steeply a contour turns off its chord
  spacing: 0,       // px gap between pieces; 0 = interlocked
  thickness: 2.6,
  strokeOpacity: 100,
  fillOpacity: 100,
  fillMode: "none", // none | solid | palette
  bg: "#F7F7F6",
  stroke: "#3F3F46",
  fill: "#FFFFFF",
  spread: 40,       // palette hue range, deg
  lightVar: 14,     // palette lightness variance
  page: "2480x3508",
  seed: 20260804,
};

// ---------- rng ---------------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// ---------- poisson disc sampling (Bridson) -----------------------------
function poisson(x0, y0, x1, y1, r, rand, k = 24) {
  const cell = r / Math.SQRT2;
  const gw = Math.ceil((x1 - x0) / cell), gh = Math.ceil((y1 - y0) / cell);
  const grid = new Int32Array(gw * gh).fill(-1);
  const pts = [], active = [];
  const add = (p) => {
    grid[Math.floor((p[1] - y0) / cell) * gw + Math.floor((p[0] - x0) / cell)] = pts.length;
    pts.push(p); active.push(pts.length - 1);
  };
  add([x0 + (x1 - x0) * rand(), y0 + (y1 - y0) * rand()]);
  while (active.length) {
    const ai = (rand() * active.length) | 0;
    const p = pts[active[ai]];
    let placed = false;
    for (let t = 0; t < k; t++) {
      const ang = rand() * Math.PI * 2, rad = r * (1 + rand());
      const qx = p[0] + Math.cos(ang) * rad, qy = p[1] + Math.sin(ang) * rad;
      if (qx < x0 || qx >= x1 || qy < y0 || qy >= y1) continue;
      const gx = ((qx - x0) / cell) | 0, gy = ((qy - y0) / cell) | 0;
      let ok = true;
      for (let dy = -2; dy <= 2 && ok; dy++) for (let dx = -2; dx <= 2 && ok; dx++) {
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const idx = grid[ny * gw + nx]; if (idx < 0) continue;
        const o = pts[idx];
        if ((o[0] - qx) ** 2 + (o[1] - qy) ** 2 < r * r) ok = false;
      }
      if (ok) { add([qx, qy]); placed = true; break; }
    }
    if (!placed) active.splice(ai, 1);
  }
  return pts;
}

// ---------- voronoi by half-plane clipping ------------------------------
function clipHalf(poly, a, b) {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const f = (p) => (p[0] - mx) * dx + (p[1] - my) * dy;
  const out = [];
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

// ---------- stage 1: geometry (seed / size / page) ----------------------
let GEOM = null, GEOM_KEY = "";
export function buildGeom(P) {
  const key = [P.seed, P.size, P.page].join("|");
  if (key === GEOM_KEY) return GEOM;
  const [W, H] = P.page.split("x").map(Number);
  const M = Math.max(180, P.size * 1.6);
  const X0 = -M, Y0 = -M, X1 = W + M, Y1 = H + M;
  const sites = poisson(X0, Y0, X1, Y1, P.size, mulberry32(P.seed));
  const rect = [[X0, Y0], [X1, Y0], [X1, Y1], [X0, Y1]];
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

  // snap vertices so neighbouring pieces agree on shared corners exactly
  const EPS = 1.2, G = 4, bucket = new Map(), verts = [];
  const canon = (p) => {
    const gx = Math.floor(p[0] / G), gy = Math.floor(p[1] / G);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const list = bucket.get(`${gx + dx},${gy + dy}`); if (!list) continue;
      for (const id of list) {
        const v = verts[id];
        if (Math.abs(v[0] - p[0]) < EPS && Math.abs(v[1] - p[1]) < EPS) return id;
      }
    }
    const id = verts.length; verts.push(p);
    const k2 = `${gx},${gy}`;
    if (!bucket.has(k2)) bucket.set(k2, []);
    bucket.get(k2).push(id);
    return id;
  };

  const cells = [], cellSite = [];
  for (let i = 0; i < polys.length; i++) {
    const poly = polys[i];
    if (poly.length < 3) continue;
    const ids = [];
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

// ---------- curve helpers -----------------------------------------------
/** Catmull-Rom over an OPEN polyline; endpoints pinned. tension 0 = straight. */
function crOpen(p, tension) {
  const n = p.length, segs = [];
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
function bezAt(s, t) {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [
    a * s.p0[0] + b * s.c1[0] + c * s.c2[0] + d * s.p1[0],
    a * s.p0[1] + b * s.c1[1] + c * s.c2[1] + d * s.p1[1],
  ];
}

// ---------- stage 2: shared edges (complexity / maxAngle / smoothness) ---
// Everything that shapes a boundary happens HERE, once per boundary.
let EDGES = null, EDGES_KEY = "";
export function buildEdges(P) {
  const g = buildGeom(P);
  const key = [GEOM_KEY, P.complexity, P.maxAngle, P.smoothness].join("|");
  if (key === EDGES_KEY) return EDGES;

  const c = P.complexity / 100;
  const knobChance = 0.15 + c * 0.80;
  const knobH      = 0.16 + c * 0.42;
  const bowF       = 0.04 + c * 0.13;
  const ripF       = 0.01 + c * 0.09;
  const sampleDiv  = 26 - c * 14;
  const maxSlope   = Math.tan(P.maxAngle * Math.PI / 180);
  const tension    = (P.smoothness / 100) * 0.28;
  const step       = P.smoothness >= 50 ? 1 : 1 + Math.round(((50 - P.smoothness) / 50) * 4);

  const onEdge = (v) =>
    Math.abs(v[0] - g.X0) < 1 || Math.abs(v[0] - g.X1) < 1 ||
    Math.abs(v[1] - g.Y0) < 1 || Math.abs(v[1] - g.Y1) < 1;

  // pass 1: which two pieces own each boundary (their sites cap the lobe depth)
  const owners = new Map();
  for (let ci = 0; ci < g.cells.length; ci++) {
    const ids = g.cells[ci];
    for (let i = 0; i < ids.length; i++) {
      const k = edgeKey(ids[i], ids[(i + 1) % ids.length]);
      const o = owners.get(k);
      if (o) o.push(g.cellSite[ci]); else owners.set(k, [g.cellSite[ci]]);
    }
  }

  function organicEdge(A, B, rand, straight, sites) {
    const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy);
    if (straight || L < 22) return crOpen([A, B], 0);
    const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const n = Math.max(10, Math.min(44, Math.round(L / sampleDiv)));

    // a lobe may never reach past the owning sites, or it could punch through
    // a piece that is not this boundary's neighbour
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

    // offsets normal to the chord, pinned to 0 at both shared endpoints
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
    // maximum-angle limiter: clamp contour slope relative to the chord
    const ds = L / n, lim = maxSlope * ds;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i <= n; i++)
        off[i] = Math.max(off[i - 1] - lim, Math.min(off[i - 1] + lim, off[i]));
      for (let i = n - 1; i >= 0; i--)
        off[i] = Math.max(off[i + 1] - lim, Math.min(off[i + 1] + lim, off[i]));
    }
    off[0] = 0; off[n] = 0;

    let pts = [A];
    for (let i = 1; i < n; i++) {
      const t = i / n;
      pts.push([A[0] + ux * L * t + nx * off[i], A[1] + uy * L * t + ny * off[i]]);
    }
    pts.push(B);

    // decimate HERE, on the shared boundary, never per piece
    if (step > 1 && pts.length > 3) {
      const dec = [pts[0]];
      for (let i = step; i < pts.length - 1; i += step) dec.push(pts[i]);
      dec.push(pts[pts.length - 1]);
      pts = dec;
    }
    return crOpen(pts, tension);
  }

  // pass 2: build each boundary exactly once
  const map = new Map();
  for (const [k, sites] of owners) {
    const [a, b] = k.split("|").map(Number);
    const A = g.verts[a], B = g.verts[b];
    map.set(k, organicEdge(A, B, mulberry32(hash32(k) ^ P.seed), onEdge(A) && onEdge(B), sites));
  }

  EDGES_KEY = key;
  EDGES = map;
  return EDGES;
}

// ---------- contour helpers ---------------------------------------------
export function signedArea(p) {
  let a = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const q = p[(i + 1) % n];
    a += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return a / 2;
}

/** Resample a closed contour to roughly uniform point spacing. */
function resample(pts, step) {
  const n = pts.length, out = [pts[0]];
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
      Math.hypot(out[out.length - 1][0] - out[0][0], out[out.length - 1][1] - out[0][1]) < step * 0.5)
    out.pop();
  return out;
}

function distSeg2(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  const cx = a[0] + dx * t - p[0], cy = a[1] + dy * t - p[1];
  return cx * cx + cy * cy;
}

/** Bucket a contour's segments so "how far is this point from the outline" is O(1). */
function segGrid(pts, cell) {
  const g = new Map(), n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const x0 = Math.floor(Math.min(a[0], b[0]) / cell), x1 = Math.floor(Math.max(a[0], b[0]) / cell);
    const y0 = Math.floor(Math.min(a[1], b[1]) / cell), y1 = Math.floor(Math.max(a[1], b[1]) / cell);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const k = x + "," + y;
      const arr = g.get(k);
      if (arr) arr.push(i); else g.set(k, [i]);
    }
  }
  return g;
}
function clearsBy(p, pts, grid, cell, minD) {
  const min2 = minD * minD;
  // Walk exactly the cells the minD disc touches. A fixed radius around the
  // point's own cell is both wrong (a segment minD away can sit two cells out,
  // and missing it lets a fold survive) and wasteful.
  const x0 = Math.floor((p[0] - minD) / cell), x1 = Math.floor((p[0] + minD) / cell);
  const y0 = Math.floor((p[1] - minD) / cell), y1 = Math.floor((p[1] + minD) / cell);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const list = grid.get(x + "," + y);
    if (!list) continue;
    for (const i of list) if (distSeg2(p, pts[i], pts[(i + 1) % pts.length]) < min2) return false;
  }
  return true;
}

const ccw3 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function segCross(a, b, c, d) {
  const d1 = ccw3(a, b, c), d2 = ccw3(a, b, d), d3 = ccw3(c, d, a), d4 = ccw3(c, d, b);
  if (!(((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)))) return null;
  const t = d3 / (d3 - d4);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Cut self-intersection loops out of a closed contour.
 *
 * Pruning folded points is not sufficient on its own: deleting a run of points
 * leaves a straight chord jumping across the gap, and that chord can slice
 * through the rest of the outline. At each crossing the contour splits into
 * two closed loops — keep the larger (the piece) and discard the smaller
 * (the scribble).
 */
/** First self-crossing, found via a segment grid so the common no-crossing
 *  case costs O(n) rather than an O(n^2) all-pairs sweep on every piece. */
function findCross(pts) {
  const n = pts.length;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const cell = Math.max(1e-6, (total / n) * 2);
  const grid = new Map();
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const x0 = Math.floor(Math.min(a[0], b[0]) / cell), x1 = Math.floor(Math.max(a[0], b[0]) / cell);
    const y0 = Math.floor(Math.min(a[1], b[1]) / cell), y1 = Math.floor(Math.max(a[1], b[1]) / cell);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const k = x + "," + y, arr = grid.get(k);
      if (arr) arr.push(i); else grid.set(k, [i]);
    }
  }
  for (const list of grid.values()) {
    for (let u = 0; u < list.length; u++) for (let v = u + 1; v < list.length; v++) {
      let i = list[u], j = list[v];
      if (i > j) { const t = i; i = j; j = t; }
      const gap = j - i;
      if (gap <= 1 || gap === n - 1) continue;          // adjacent, always touching
      const X = segCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n]);
      if (X) return { i, j, X };
    }
  }
  return null;
}

function removeLoops(pts, guard = 60) {
  for (let pass = 0; pass < guard; pass++) {
    if (pts.length < 4) return pts;
    const cut = findCross(pts);
    if (!cut) return pts;
    const { i, j, X } = cut;
    const A = [X, ...pts.slice(i + 1, j + 1)];
    const B = [X, ...pts.slice(j + 1), ...pts.slice(0, i + 1)];
    pts = Math.abs(signedArea(A)) >= Math.abs(signedArea(B)) ? A : B;
  }
  return pts;
}

/**
 * Inset a closed contour by d, preserving its shape.
 *
 * A plain miter offset is NOT enough here: a jigsaw knob leaves a sharp
 * concave corner, and the miter at a sharp concave corner runs away to
 * d/cos(half-angle) — a long spike that folds back over the contour and
 * renders as the crossed scribbles seen on 2026-08-04. So:
 *   1. resample to uniform spacing, so the offset is locally well-behaved,
 *   2. offset with a hard miter limit (no runaway spikes),
 *   3. drop every offset point that failed to get clear of the original
 *      outline — that is exactly the set of folded-back points,
 *   4. drop the piece if it collapsed, rather than emitting a knot.
 * Returns [] for a piece smaller than the gap it was asked to leave.
 */
export function inset(pts, d) {
  if (d <= 0) return pts;
  // Cap the point count: loop removal is O(n^2) per pass, and a small inset on
  // a large piece would otherwise produce a needlessly dense contour.
  let perim = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    perim += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const p = resample(pts, Math.max(2.5, d * 0.6, perim / 240));
  const n = p.length;
  if (n < 8) return [];

  const norms = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    const nx = b[1] - a[1], ny = a[0] - b[0];
    const l = Math.hypot(nx, ny) || 1;
    norms[i] = [nx / l, ny / l];
  }

  // Shrinking a shape is erosion by a disc: sharp corners get CUT OFF, they do
  // not extend. A miter joint does the opposite — it places the corner at
  // d/cos(half-angle), which at a sharp corner is a long spur that pokes across
  // the gap (the leftover artifacts of 2026-08-04). So miter only while it
  // stays near d, and bevel past that. A bevel can never exceed d, so no
  // corner treatment can ever produce a spur.
  const MITER = 1.1;
  const build = (sgn) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const n1 = norms[(i - 1 + n) % n], n2 = norms[i];
      let mx = n1[0] + n2[0], my = n1[1] + n2[1];
      const lm = Math.hypot(mx, my);
      if (lm < 1e-6) continue;                       // 180° cusp, no valid bisector
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
  if (Math.abs(signedArea(cand)) > a0) cand = build(-1);   // keep the shrinking direction

  // a folded point ends up on or past the original outline; a good one clears it
  const clear = d * 0.9;
  const cell = Math.max(1, clear);
  const grid = segGrid(p, cell);
  const kept = cand.filter((q) => clearsBy(q, p, grid, cell, clear));
  if (kept.length < 8) return [];

  const clean = removeLoops(kept);
  if (clean.length < 8) return [];
  if (Math.abs(signedArea(clean)) < a0 * 0.08) return [];  // collapsed: drop, don't knot
  return clean;
}

/**
 * Walk a piece's boundary as an ordered list of shared segments.
 * `fwd` pieces emit the stored segments; the other side emits the identical
 * segments reversed (control points swapped) — never a recomputed curve.
 */
export function cellSegments(cellIds, edges) {
  const out = [];
  for (let i = 0; i < cellIds.length; i++) {
    const a = cellIds[i], b = cellIds[(i + 1) % cellIds.length];
    const segs = edges.get(edgeKey(a, b));
    if (!segs) continue;
    if (a < b) for (const s of segs) out.push(s);
    else for (let k = segs.length - 1; k >= 0; k--) {
      const s = segs[k];
      out.push({ p0: s.p1, c1: s.c2, c2: s.c1, p1: s.p0 });
    }
  }
  return out;
}

const f2 = (p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;

export function segmentsToPath(segs) {
  if (!segs.length) return "";
  let d = `M${f2(segs[0].p0)}`;
  for (const s of segs) d += `C${f2(s.c1)} ${f2(s.c2)} ${f2(s.p1)}`;
  return d + "Z";
}

/** Flatten shared segments to a dense polyline (used by the spacing inset). */
export function segmentsToPoints(segs, per = 4) {
  const pts = [];
  for (const s of segs) for (let i = 0; i < per; i++) pts.push(bezAt(s, i / per));
  return pts;
}

export function pointsToPath(pts) {
  if (pts.length < 3) return "";
  let d = `M${f2(pts[0])}`;
  for (let i = 1; i < pts.length; i++) d += `L${f2(pts[i])}`;
  return d + "Z";
}

/**
 * A piece's final outline — the single place spacing is applied, so the
 * renderer and the verifier can never disagree about what was drawn.
 * `d` is the SVG path, `pts` the same outline as a polyline.
 */
export function pieceOutline(segs, P) {
  if (P.spacing > 0) {
    const pts = inset(segmentsToPoints(segs), P.spacing / 2);
    return { pts, d: pointsToPath(pts) };
  }
  return { pts: segmentsToPoints(segs), d: segmentsToPath(segs) };
}

/**
 * Every piece as `{ pts, src }` — the final outline, plus the interlocked
 * outline it came from. Verification needs both (an inset point must sit ~d
 * from its source, never further), and hit-testing will want `pts`.
 */
export function pieceContours(params = {}) {
  const P = { ...DEFAULTS, ...params };
  const g = buildGeom(P), edges = buildEdges(P), out = [];
  for (const ids of g.cells) {
    const segs = cellSegments(ids, edges);
    if (!segs.length) continue;
    const src = segmentsToPoints(segs);
    const { pts } = pieceOutline(segs, P);
    if (pts.length >= 3) out.push({ pts, src });
  }
  return out;
}

/** Distance from a point to a closed polyline. */
export function distToContour(p, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d2 = distSeg2(p, poly[i], poly[(i + 1) % poly.length]);
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

export function hexToHsl(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return { h: 0, s: 0, l: 50 };
  const r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

// ---------- stage 3: render ---------------------------------------------
// Pure assembly. It may reorder and reverse shared segments; it may never
// reshape one, or the two sides of a boundary stop matching.
export function buildSvg(params = {}) {
  const P = { ...DEFAULTS, ...params };
  const t0 = Date.now();
  const g = buildGeom(P);
  const edges = buildEdges(P);
  const rand = mulberry32(P.seed ^ 0x9e3779b9);
  const base = hexToHsl(P.fill);

  const body = [];
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

  return { svg, cells: g.cells.length, edges: edges.size, W: g.W, H: g.H, ms: Date.now() - t0 };
}
