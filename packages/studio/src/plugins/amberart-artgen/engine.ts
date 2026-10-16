/**
 * @file The AmberArt seeded renderer — prompt (or directive) → SVG, no model.
 *
 * Pure string work: no DOM, no `node:` imports, no randomness source other than
 * the seed. That means the identical function runs in the API route, in a test,
 * and in the browser tool, and all three produce byte-identical art for the same
 * input — which is the property the whole "AI optional" design rests on.
 *
 * ## The pipeline
 *
 * ```
 * prompt ──fnv1a──> seed ──mulberry32──> rng
 *                                        │
 *   deriveDirective(prompt) ─────────────┤  (seeded mode: rng writes the directive)
 *   Claude / sliders ────────────────────┤  (ai-directed mode: they write it)
 *                                        ▼
 *                          buildParams(directive, seed) ──> render(params) ──> SVG
 * ```
 *
 * `buildParams` fills everything a directive does NOT mention (the three sine
 * frequencies and phases of the vector field, the exact element counts, the
 * jitter on the composition centre) from the same seeded rng — so a model that
 * only names a hue and a symmetry still gets a fully-formed, varied piece.
 *
 * ## Why a sanitizer is not needed here
 *
 * Everything this file emits is built from clamped NUMBERS through our own
 * template strings — no model text ever reaches the markup except the prompt in
 * the signature line, which is escaped. `ai-direct` mode is the one that hands
 * back model-authored markup, and it goes through `@/lib/svg/sanitize-svg`.
 */

import {
  ART_HEIGHT,
  ART_WIDTH,
  HARMONIES,
  HARMONY_NAMES,
  type ArtDirective,
  type ArtParams,
  type Harmony,
  type Hsl,
} from "../../modules/amberart/art-types";

const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ seeding */

/** FNV-1a — a prompt string collapses to one 32-bit seed. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, well-distributed; identical across engines. */
export function mulberry32(a: number): () => number {
  let s = a >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Coerce anything to a finite number in range, falling back when it is not one. */
function num(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
}

/* ---------------------------------------------------------------- directive */

/**
 * The no-AI producer: every field of the directive comes out of the prompt's
 * own hash, so the same words always yield the same piece and different words
 * yield an unrelated one.
 */
export function deriveDirective(prompt: string): ArtDirective {
  const rnd = mulberry32(fnv1a(prompt));
  const rr = (a: number, b: number): number => a + rnd() * (b - a);
  return {
    baseHue: Math.floor(rr(0, 360)),
    harmony: HARMONY_NAMES[Math.floor(rnd() * HARMONY_NAMES.length)],
    saturation: rr(62, 92),
    lightness: rr(48, 64),
    symmetry: Math.floor(rr(6, 17)),
    rings: Math.floor(rr(4, 8)),
    streamDensity: rr(0.45, 0.85),
    filamentDensity: rr(0.3, 0.8),
    markDensity: rr(0.4, 0.9),
    swirl: rr(0.5, 1.7),
    turbulence: rr(0.25, 0.85),
    grain: rr(0.35, 0.75),
    vignette: rr(0.5, 0.85),
  };
}

/**
 * Clamp an untrusted directive (a model answer, a slider payload, a saved file)
 * into the legal range, filling anything missing from `base`.
 *
 * This is the reason `ai-directed` mode needs no sanitizer: whatever the model
 * writes, what reaches the renderer is a set of in-range numbers.
 */
export function normalizeDirective(raw: unknown, base: ArtDirective): ArtDirective {
  const d = (raw ?? {}) as Record<string, unknown>;
  const harmony: Harmony = HARMONY_NAMES.includes(d.harmony as Harmony) ? (d.harmony as Harmony) : base.harmony;
  const note = typeof d.note === "string" ? d.note.slice(0, 240) : undefined;
  return {
    baseHue: Math.round(num(d.baseHue, 0, 359, base.baseHue)),
    harmony,
    saturation: num(d.saturation, 0, 100, base.saturation),
    lightness: num(d.lightness, 10, 90, base.lightness),
    symmetry: Math.round(num(d.symmetry, 3, 24, base.symmetry)),
    rings: Math.round(num(d.rings, 0, 9, base.rings)),
    streamDensity: num(d.streamDensity, 0, 1, base.streamDensity),
    filamentDensity: num(d.filamentDensity, 0, 1, base.filamentDensity),
    markDensity: num(d.markDensity, 0, 1, base.markDensity),
    swirl: num(d.swirl, 0, 2, base.swirl),
    turbulence: num(d.turbulence, 0, 1, base.turbulence),
    grain: num(d.grain, 0, 1, base.grain),
    vignette: num(d.vignette, 0, 1, base.vignette),
    ...(note ? { note } : {}),
  };
}

/* ------------------------------------------------------------------- params */

/** Expand a directive into the renderer's full parameter set. */
export function buildParams(directive: ArtDirective, prompt: string, seed?: number): ArtParams {
  const s = seed ?? fnv1a(prompt);
  const rnd = mulberry32(s ^ 0x9e3779b9);
  const rr = (a: number, b: number): number => a + rnd() * (b - a);

  const scheme = HARMONIES[directive.harmony];
  const palette: Hsl[] = scheme.map((off, i) => ({
    h: (directive.baseHue + off + 360) % 360,
    s: clamp(directive.saturation + rr(-12, 12), 0, 100),
    l: clamp(directive.lightness + rr(-14, 16) + (i === 0 ? 6 : 0), 28, 78),
  }));

  const ink: Hsl = { h: (directive.baseHue + Math.floor(rr(150, 211))) % 360, s: rr(35, 60), l: rr(5, 9) };
  const flare: Hsl = { h: (directive.baseHue + Math.floor(rr(-20, 21)) + 360) % 360, s: rr(20, 45), l: rr(88, 96) };

  // Turbulence widens the frequency band the field's sines are drawn from: low
  // turbulence gives long, calm, parallel currents; high gives knotted ones.
  const t = directive.turbulence;
  const fHi = 0.0012 + t * 0.0032;

  return {
    width: ART_WIDTH,
    height: ART_HEIGHT,
    seed: s,
    prompt,
    directive,
    palette,
    ink,
    flare,
    cx: ART_WIDTH * rr(0.4, 0.6),
    cy: ART_HEIGHT * rr(0.42, 0.58),
    field: {
      a1: rr(0.5, 1.5), f1: rr(0.0007, fHi), p1: rr(0, TAU),
      a2: rr(0.5, 1.5), f2: rr(0.0007, fHi), p2: rr(0, TAU),
      a3: rr(0.3, 1.1), f3: rr(0.0005, fHi * 0.8), p3: rr(0, TAU),
      swirl: directive.swirl,
      fall: rr(220, 620),
      drift: rr(-0.35, 0.35),
    },
    counts: {
      blobs: Math.round(rr(6, 10)),
      streamlines: Math.round(60 + directive.streamDensity * 520),
      filaments: Math.round(20 + directive.filamentDensity * 190),
      marks: Math.round(40 + directive.markDensity * 460),
    },
  };
}

/* ------------------------------------------------------------------ render */

const hsl = (c: Hsl, l: number = c.l, a = 1): string =>
  a >= 1
    ? `hsl(${c.h.toFixed(0)} ${c.s.toFixed(0)}% ${l.toFixed(0)}%)`
    : `hsl(${c.h.toFixed(0)} ${c.s.toFixed(0)}% ${l.toFixed(0)}% / ${a.toFixed(3)})`;

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Draw the piece. Deterministic for a given {@link ArtParams}: the rng is
 * re-seeded here, so calling `render` twice on the same params is byte-equal.
 */
export function render(p: ArtParams): string {
  const { width: W, height: H, cx, cy, palette, ink, flare, field: F, counts } = p;
  const d = p.directive;
  const rnd = mulberry32(p.seed);
  const rr = (a: number, b: number): number => a + rnd() * (b - a);
  const ri = (a: number, b: number): number => Math.floor(rr(a, b + 1));
  const chance = (q: number): boolean => rnd() < q;
  const pal = (): Hsl => palette[ri(0, palette.length - 1)];

  /** The vector field: three summed sines (cheap coherent noise) + centre swirl. */
  const angle = (x: number, y: number): number => {
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.hypot(dx, dy) + 1e-6;
    const tangent = Math.atan2(dy, dx) + Math.PI / 2;
    const base =
      F.a1 * Math.sin(F.f1 * x + F.p1) +
      F.a2 * Math.cos(F.f2 * y + F.p2) +
      F.a3 * Math.sin(F.f3 * (x * 0.7 + y * 0.7) + F.p3);
    const w = F.swirl * Math.exp(-dist / F.fall);
    return base * Math.PI * (1 - Math.min(0.7, w * 0.5)) + tangent * w + F.drift;
  };

  /** Walk a particle through the field, returning its path points. */
  const trace = (x: number, y: number, steps: number, step: number): string[] => {
    const pts: string[] = [];
    for (let i = 0; i < steps; i++) {
      if (x < -80 || x > W + 80 || y < -80 || y > H + 80) break;
      pts.push(`${x.toFixed(0)} ${y.toFixed(0)}`);
      const a = angle(x, y);
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
    }
    return pts;
  };

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" ` +
      `preserveAspectRatio="xMidYMid meet" role="img" aria-label="AmberArt generative drawing: ${esc(p.prompt)}">`
  );

  /* defs */
  out.push("<defs>");
  out.push(
    `<radialGradient id="aa-glow" cx="${((cx / W) * 100).toFixed(1)}%" cy="${((cy / H) * 100).toFixed(1)}%" r="72%">` +
      `<stop offset="0%" stop-color="${hsl(palette[0], palette[0].l + 8, 0.55)}"/>` +
      `<stop offset="45%" stop-color="${hsl(palette[2] ?? palette[0], 26, 0.35)}"/>` +
      `<stop offset="100%" stop-color="${hsl(ink)}"/></radialGradient>`
  );
  out.push(
    `<radialGradient id="aa-vig" cx="50%" cy="50%" r="78%">` +
      `<stop offset="55%" stop-color="#000" stop-opacity="0"/>` +
      `<stop offset="100%" stop-color="#000" stop-opacity="${(d.vignette * 0.85).toFixed(2)}"/></radialGradient>`
  );
  out.push(
    `<filter id="aa-soft" x="-40%" y="-40%" width="180%" height="180%">` +
      `<feGaussianBlur stdDeviation="${rr(48, 96).toFixed(0)}"/></filter>`
  );
  out.push(`<filter id="aa-bloom" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="6"/></filter>`);
  out.push(
    `<filter id="aa-grain" x="0" y="0" width="100%" height="100%">` +
      `<feTurbulence type="fractalNoise" baseFrequency="${rr(0.7, 1.1).toFixed(2)}" numOctaves="4" stitchTiles="stitch"/>` +
      `<feColorMatrix type="saturate" values="0"/></filter>`
  );
  out.push("</defs>");

  /* ground */
  out.push(`<rect width="${W}" height="${H}" fill="${hsl(ink)}"/>`);
  out.push(`<rect width="${W}" height="${H}" fill="url(#aa-glow)"/>`);

  /* soft colour masses */
  out.push('<g filter="url(#aa-soft)" style="mix-blend-mode:screen">');
  for (let i = 0; i < counts.blobs; i++) {
    const c = palette[i % palette.length];
    out.push(
      `<ellipse cx="${rr(-100, W + 100).toFixed(0)}" cy="${rr(-100, H + 100).toFixed(0)}" ` +
        `rx="${rr(120, 420).toFixed(0)}" ry="${rr(100, 360).toFixed(0)}" fill="${hsl(c, c.l, rr(0.1, 0.26))}"/>`
    );
  }
  out.push("</g>");

  /* streamlines — the body of the piece */
  out.push('<g fill="none" stroke-linecap="round" stroke-linejoin="round" style="mix-blend-mode:screen">');
  for (let i = 0; i < counts.streamlines; i++) {
    const ang = rr(0, TAU);
    const rad = Math.pow(rnd(), 0.55) * Math.max(W, H) * 0.62;
    let sx = cx + Math.cos(ang) * rad + rr(-60, 60);
    let sy = cy + Math.sin(ang) * rad + rr(-60, 60);
    if (chance(0.25)) {
      sx = rr(0, W);
      sy = rr(0, H);
    }
    const pts = trace(sx, sy, ri(45, 95), rr(6, 12));
    if (pts.length < 6) continue;
    const c = pal();
    out.push(
      `<path d="M${pts.join("L")}" stroke="${hsl(c, Math.min(84, c.l + rr(-10, 18)), rr(0.16, 0.46))}" ` +
        `stroke-width="${rr(0.7, 3.4).toFixed(1)}"/>`
    );
  }

  /* bright filaments, drawn after so they read as light */
  for (let i = 0; i < counts.filaments; i++) {
    const ang = rr(0, TAU);
    const rad = Math.pow(rnd(), 0.8) * Math.max(W, H) * 0.5;
    const pts = trace(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad, ri(30, 70), rr(7, 13));
    if (pts.length < 5) continue;
    const c = chance(0.3) ? flare : pal();
    out.push(
      `<path d="M${pts.join("L")}" stroke="${hsl(c, Math.min(92, c.l + 20), rr(0.35, 0.8))}" ` +
        `stroke-width="${rr(0.4, 1.1).toFixed(1)}"/>`
    );
  }
  out.push("</g>");

  /* mandala + orbits */
  if (d.rings > 0) {
    const K = d.symmetry;
    out.push('<g style="mix-blend-mode:screen" filter="url(#aa-bloom)">');
    for (let r = 0; r < d.rings; r++) {
      const tt = (r + 1) / d.rings;
      const r0 = 40 + tt * rr(90, 170) * r * 0.55 + r * 26;
      const r1 = r0 + rr(50, 150);
      const wd = rr(12, 46) * (0.6 + tt);
      const rm = (r0 + r1) / 2;
      const c = palette[(r + 1) % palette.length];
      const spin = rr(0, 360 / K);
      const filled = chance(0.4);
      const fill = filled ? hsl(c, c.l, rr(0.05, 0.14)) : "none";
      for (let i = 0; i < K; i++) {
        const deg = (360 / K) * i + spin;
        const path =
          `M${(cx + r0).toFixed(0)} ${cy.toFixed(0)}` +
          `Q${(cx + rm).toFixed(0)} ${(cy - wd).toFixed(0)} ${(cx + r1).toFixed(0)} ${cy.toFixed(0)}` +
          `Q${(cx + rm).toFixed(0)} ${(cy + wd).toFixed(0)} ${(cx + r0).toFixed(0)} ${cy.toFixed(0)}Z`;
        out.push(
          `<path d="${path}" transform="rotate(${deg.toFixed(2)} ${cx.toFixed(0)} ${cy.toFixed(0)})" fill="${fill}" ` +
            `stroke="${hsl(c, Math.min(88, c.l + 14), rr(0.3, 0.7))}" stroke-width="${rr(0.6, 2.2).toFixed(1)}"/>`
        );
      }
    }
    const orbits = ri(3, 7);
    for (let i = 0; i < orbits; i++) {
      const c = palette[i % palette.length];
      out.push(
        `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${rr(60, Math.min(W, H) * 0.52).toFixed(0)}" fill="none" ` +
          `stroke="${hsl(c, c.l + 12, rr(0.18, 0.5))}" stroke-width="${rr(0.5, 1.8).toFixed(1)}" ` +
          `stroke-dasharray="${rr(1, 14).toFixed(0)} ${rr(4, 26).toFixed(0)}"/>`
      );
    }
    out.push("</g>");
  }

  /* confetti, denser toward the centre */
  out.push('<g style="mix-blend-mode:screen">');
  for (let i = 0; i < counts.marks; i++) {
    const ang = rr(0, TAU);
    const rad = Math.pow(rnd(), 1.7) * Math.max(W, H) * 0.62;
    const x = cx + Math.cos(ang) * rad;
    const y = cy + Math.sin(ang) * rad;
    if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
    const c = chance(0.22) ? flare : pal();
    const o = rr(0.25, 0.85);
    const kind = rnd();
    if (kind < 0.5) {
      out.push(`<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${rr(0.6, 3.2).toFixed(1)}" fill="${hsl(c, c.l + 16, o)}"/>`);
    } else if (kind < 0.78) {
      const sz = rr(3, 11);
      out.push(
        `<path d="M${x.toFixed(0)} ${(y - sz).toFixed(0)}L${(x + sz).toFixed(0)} ${(y + sz * 0.7).toFixed(0)}` +
          `L${(x - sz).toFixed(0)} ${(y + sz * 0.7).toFixed(0)}Z" fill="none" stroke="${hsl(c, c.l + 14, o)}" ` +
          `stroke-width="${rr(0.5, 1.4).toFixed(1)}" transform="rotate(${rr(0, 360).toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)})"/>`
      );
    } else {
      out.push(
        `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${rr(4, 16).toFixed(0)}" fill="none" ` +
          `stroke="${hsl(c, c.l + 10, o * 0.7)}" stroke-width="${rr(0.4, 1.2).toFixed(1)}"/>`
      );
    }
  }
  out.push("</g>");

  /* overlays */
  if (d.grain > 0.02) {
    out.push(
      `<rect width="${W}" height="${H}" filter="url(#aa-grain)" opacity="${(d.grain * 0.16).toFixed(3)}" ` +
        `style="mix-blend-mode:overlay"/>`
    );
  }
  if (d.vignette > 0.02) out.push(`<rect width="${W}" height="${H}" fill="url(#aa-vig)"/>`);

  /* signature — the two values the whole piece can be rebuilt from */
  out.push(
    `<text x="${W - 24}" y="${H - 22}" text-anchor="end" font-family="ui-monospace, Menlo, Consolas, monospace" ` +
      `font-size="11" letter-spacing="1.2" fill="${hsl(flare, 82, 0.4)}">` +
      `${esc(p.prompt.slice(0, 72))} · 0x${p.seed.toString(16).toUpperCase()} · ${d.harmony} h${d.baseHue} k${d.symmetry}</text>`
  );

  out.push("</svg>");
  return out.join("\n");
}

/** Convenience: the whole no-AI path in one call. */
export function renderFromPrompt(prompt: string): { svg: string; params: ArtParams } {
  const params = buildParams(deriveDirective(prompt), prompt);
  return { svg: render(params), params };
}
