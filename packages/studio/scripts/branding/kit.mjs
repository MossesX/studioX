/**
 * @file The drawing kit the brand-extension generators share.
 *
 * GizmoX's own `gen-branding-pack` did not come across in the port — only its
 * OUTPUT did, staged at `assets/import/branding/gizmox-brand/`. So this kit is
 * a deliberate re-statement of that generator's grammar, read back off the 453
 * SVGs it produced, and it holds to the same three rules:
 *
 *   1. **100 × 100 user space.** Square drawings use it directly; a wide or
 *      tall drawing extends the viewBox but keeps the same unit, which is what
 *      makes a 16px badge and a 340-wide lockup look like one system.
 *   2. **No colour literal ever reaches an attribute.** Every paint is
 *      `v(role)` → `var(--gxb-<role>, <hex>)`. The fallback hex is what keeps a
 *      file opened straight off disk looking right; the variable is what makes
 *      the pack recolour with the live theme and no SVG parsing.
 *   3. **Motion is SMIL, never script.** `<animate>`, `<animateTransform>`,
 *      `<animateMotion>` — inert until the browser paints, freezable by hiding
 *      the animation elements, and free to render.
 *
 * Ids for gradients, filters and clip paths are namespaced with the ENTRY id
 * (`gx2-<entry>-<n>`). Packs are inlined into one DOM, so a bare `id="glow"`
 * is a collision waiting for the second copy of the drawing on a page.
 */

/* --------------------------------------------------------------- the palette */

/** The staged pack's palette — the hex is only ever a `var()` fallback. */
export const PALETTE = {
  accent: "#ff7a1a",
  accent2: "#4f8ef7",
  accent3: "#b06df7",
  ink: "#f7f2ea",
  dim: "#9c9083",
  edge: "#2a2621",
  page: "#0f0d0b",
  ok: "#3fb27f",
  warn: "#f5a623",
  err: "#e5484d"
};

/** Canonical role order, so a derived `roles` array is stable across runs. */
export const ROLE_ORDER = Object.keys(PALETTE);

/** `v("accent")` → `var(--gxb-accent, #ff7a1a)`. The only way to spell a colour. */
export const v = (role) => {
  if (!(role in PALETTE)) throw new Error(`kit: unknown role "${role}"`);
  return `var(--gxb-${role}, ${PALETTE[role]})`;
};

/** Roles a finished drawing actually uses — derived, never asserted by hand. */
export const rolesUsed = (svg) => {
  const found = new Set();
  for (const m of svg.matchAll(/--gxb-([a-z0-9]+)/g)) found.add(m[1]);
  return ROLE_ORDER.filter((r) => found.has(r));
};

/* ------------------------------------------------------------------ geometry */

const attrs = (o) =>
  Object.entries(o)
    .filter(([, val]) => val !== undefined && val !== null && val !== "")
    .map(([k, val]) => ` ${k}="${val}"`)
    .join("");

/** A stroked path. 7 units, round caps and joins — the pack's default weight. */
export const stroke = (d, { color, width = 7, cap = "round", join = "round", opacity, dash, extra } = {}) =>
  `<path fill="none" stroke="${color}" stroke-width="${width}"` +
  attrs({ "stroke-linecap": cap, "stroke-linejoin": join, "stroke-dasharray": dash, opacity }) +
  ` d="${d}"${extra ?? ""}/>`;

export const fill = (d, color, o = {}) => `<path d="${d}" fill="${color}"${attrs(o)}/>`;

export const circle = (cx, cy, r, color, o = {}) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"${attrs(o)}/>`;

export const ring = (cx, cy, r, color, width = 7, o = {}) =>
  `<circle fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" cx="${cx}" cy="${cy}" r="${r}"${attrs(o)}/>`;

export const rect = (x, y, w, h, r, color, o = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${color}"${attrs(o)}/>`;

export const rectS = (x, y, w, h, r, color, width = 7, o = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round"${attrs(o)}/>`;

/** Regular polygon path, first vertex at 12 o'clock unless `rot` says otherwise. */
export const poly = (cx, cy, r, n, rot = -90) => {
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const a = ((rot + (360 / n) * i) * Math.PI) / 180;
    pts.push(`${round(cx + r * Math.cos(a))} ${round(cy + r * Math.sin(a))}`);
  }
  return `M${pts.join("L")}Z`;
};

export const hexPath = (cx = 50, cy = 50, r = 47) => poly(cx, cy, r, 6, -90);

/** Two decimals, no trailing zeros — keeps the emitted markup diff-stable. */
export const round = (n) => Number(n.toFixed(2)).toString();

/* --------------------------------------------------------------- the marks */

/**
 * The mark vocabulary the lockups draw from. Each returns inner markup in the
 * 100 × 100 space; `MARKS.cross` is GizmoX's house mark, copied in geometry
 * from `lockups/lockup-horizontal.svg` so a new lockup and an old one place the
 * same four arms at the same radius.
 */
export const MARKS = {
  cross: () =>
    [45, 135, 225, 315]
      .map((a) => rect(61, 44.5, 26, 11, 5.5, v("accent"), { transform: `rotate(${a} 50 50)` }))
      .join("") + rect(41.5, 41.5, 17, 17, 4, v("ink"), { transform: "rotate(45 50 50)" }),

  crossDuo: () =>
    [45, 225]
      .map((a) => rect(61, 44.5, 26, 11, 5.5, v("accent"), { transform: `rotate(${a} 50 50)` }))
      .join("") +
    [135, 315]
      .map((a) => rect(61, 44.5, 26, 11, 5.5, v("accent3"), { transform: `rotate(${a} 50 50)` }))
      .join("") +
    rect(41.5, 41.5, 17, 17, 4, v("ink"), { transform: "rotate(45 50 50)" }),

  hex: () =>
    stroke(hexPath(50, 50, 40), { color: v("accent"), width: 8, join: "round" }) +
    circle(50, 50, 12, v("accent2")),

  hexSolid: () => fill(hexPath(50, 50, 44), v("accent")) + circle(50, 50, 13, v("page")),

  aperture: () =>
    Array.from({ length: 6 }, (_, i) =>
      fill("M50 8 68 26 50 30Z", i % 2 ? v("accent3") : v("accent"), {
        transform: `rotate(${i * 60} 50 50)`
      })
    ).join("") + ring(50, 50, 22, v("ink"), 6, { opacity: "0.85" }),

  orbit: () =>
    ring(50, 50, 34, v("accent"), 7) +
    circle(50, 50, 12, v("accent3")) +
    circle(50, 16, 7, v("accent2")) +
    circle(79.4, 67, 6, v("accent2"), { opacity: "0.7" }) +
    circle(20.6, 67, 6, v("accent2"), { opacity: "0.4" }),

  prism: () =>
    fill("M50 10 88 76H12Z", v("accent")) +
    fill("M50 34 71 70H29Z", v("page")) +
    circle(50, 58, 8, v("accent2")),

  layers: () =>
    fill("M50 12 88 34 50 56 12 34Z", v("accent")) +
    fill("M50 44 88 66 50 88 12 66Z", v("accent3"), { opacity: "0.9" }) +
    fill("M50 28 70 40 50 52 30 40Z", v("ink"), { opacity: "0.9" }),

  brackets: () =>
    stroke("M34 18H18v64h16", { color: v("accent"), width: 8 }) +
    stroke("M66 18h16v64H66", { color: v("accent"), width: 8 }) +
    circle(50, 50, 11, v("accent2")),

  quad: () =>
    rect(14, 14, 32, 32, 8, v("accent")) +
    rect(54, 14, 32, 32, 8, v("accent2")) +
    rect(14, 54, 32, 32, 8, v("accent3")) +
    rectS(54, 54, 32, 32, 8, v("ink"), 6),

  spark: () =>
    fill("M50 6 60 40 94 50 60 60 50 94 40 60 6 50 40 40Z", v("accent")) +
    fill("M80 14 84 26 96 30 84 34 80 46 76 34 64 30 76 26Z", v("accent3")),

  chip: () =>
    rectS(24, 24, 52, 52, 10, v("accent"), 8) +
    rect(40, 40, 20, 20, 5, v("accent2")) +
    stroke("M34 14v10M50 14v10M66 14v10M34 76v10M50 76v10M66 76v10M14 34h10M14 50h10M14 66h10M76 34h10M76 50h10M76 66h10", {
      color: v("dim"),
      width: 5
    }),

  shield: () =>
    fill("M50 6 88 20v30c0 26-18 38-38 44C30 88 12 76 12 50V20Z", v("accent")) +
    fill("M50 22 72 30v20c0 15-10 22-22 26-12-4-22-11-22-26V30Z", v("page")) +
    stroke("M38 50l9 10 17-20", { color: v("ink"), width: 7 }),

  monogram: (text = "GX") =>
    rectS(10, 10, 80, 80, 20, v("accent"), 7) +
    `<text x="50" y="52" fill="${v("ink")}" font-family="'Cascadia Mono', 'Consolas', ui-monospace, monospace" ` +
    `font-size="34" font-weight="700" letter-spacing="1" text-anchor="middle" dominant-baseline="central">${text}</text>`,

  tile: (text = "AX") =>
    rect(8, 8, 84, 84, 22, v("accent")) +
    `<text x="50" y="52" fill="${v("page")}" font-family="'Segoe UI', 'Inter', system-ui, sans-serif" ` +
    `font-size="38" font-weight="800" letter-spacing="0" text-anchor="middle" dominant-baseline="central">${text}</text>`
};

/* -------------------------------------------------------------- type metrics */

export const SANS = "'Segoe UI', 'Inter', system-ui, sans-serif";
export const MONO = "'Cascadia Mono', 'Consolas', ui-monospace, monospace";

// Advance widths in em, measured off Segoe UI Semibold/Bold and rounded. Only
// an ESTIMATE — its job is to size a viewBox that never clips, which is why
// every consumer multiplies by SAFETY before allocating the box.
const EM = {
  A: 0.7, B: 0.68, C: 0.7, D: 0.72, E: 0.62, F: 0.6, G: 0.74, H: 0.74, I: 0.3,
  J: 0.52, K: 0.7, L: 0.58, M: 0.92, N: 0.74, O: 0.76, P: 0.65, Q: 0.76, R: 0.68,
  S: 0.66, T: 0.62, U: 0.72, V: 0.7, W: 0.95, X: 0.68, Y: 0.65, Z: 0.63,
  a: 0.56, b: 0.58, c: 0.52, d: 0.58, e: 0.56, f: 0.36, g: 0.58, h: 0.57, i: 0.26,
  j: 0.26, k: 0.53, l: 0.26, m: 0.86, n: 0.57, o: 0.58, p: 0.58, q: 0.58, r: 0.39,
  s: 0.5, t: 0.37, u: 0.57, v: 0.52, w: 0.78, x: 0.51, y: 0.52, z: 0.48,
  "0": 0.62, "1": 0.62, "2": 0.62, "3": 0.62, "4": 0.62, "5": 0.62, "6": 0.62,
  "7": 0.62, "8": 0.62, "9": 0.62,
  " ": 0.3, "·": 0.36, "/": 0.4, "-": 0.4, ".": 0.3
};

const SAFETY = 1.06;

/** Estimated advance of `s` at `size` with `ls` letter-spacing, in user units. */
export const textWidth = (s, size, ls = 0, weight = 800) => {
  let em = 0;
  for (const ch of s) em += EM[ch] ?? 0.66;
  const w = em * size + ls * Math.max(0, s.length - 1);
  return weight <= 500 ? w * 0.955 : w;
};

/** The width to ALLOCATE for `s` — the estimate plus the never-clip margin. */
export const textBox = (s, size, ls = 0, weight = 800) =>
  Math.ceil(textWidth(s, size, ls, weight) * SAFETY);

/**
 * A `<text>` run. `parts` is either a string or `[{ t, fill, dx }]`, which is
 * how a two-colour wordmark is drawn without guessing where the second word
 * starts: the tspans flow inside one centred run and the browser does the
 * arithmetic. Word gaps go through `dx`, never a literal space — leading and
 * trailing whitespace in SVG text collapses.
 */
export const text = (parts, { x, y, size, weight = 800, ls = 4, color, family = SANS, anchor = "middle", opacity, extra } = {}) => {
  const body =
    typeof parts === "string"
      ? esc(parts)
      : parts.map((p) => `<tspan${attrs({ fill: p.fill, dx: p.dx, opacity: p.opacity })}>${esc(p.t)}</tspan>`).join("");
  return (
    `<text x="${round(x)}" y="${round(y)}" fill="${color}" font-family="${family}" font-size="${size}" ` +
    `font-weight="${weight}" letter-spacing="${ls}" text-anchor="${anchor}" dominant-baseline="central"` +
    attrs({ opacity }) +
    `${extra ?? ""}>${body}</text>`
  );
};

export const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ---------------------------------------------------------------- paint kits */

/** A 45° two-stop gradient between two roles. Returns `[defs, ref]`. */
export const gradient = (id, from = "accent", to = "accent3") => [
  `<linearGradient id="${id}" x1="0.146" y1="0.146" x2="0.854" y2="0.854">` +
    `<stop offset="0%" stop-color="${v(from)}"/><stop offset="100%" stop-color="${v(to)}"/></linearGradient>`,
  `url(#${id})`
];

/** The travelling highlight the pack uses for `sweep` and `shimmer`. */
export const sweepGradient = (id, dur = 3, from = "accent", to = "accent2") => [
  `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0%" stop-color="${v(from)}" stop-opacity="0.05"/>` +
    `<stop offset="45%" stop-color="${v(from)}" stop-opacity="0.95"/>` +
    `<stop offset="55%" stop-color="${v(to)}" stop-opacity="0.95"/>` +
    `<stop offset="100%" stop-color="${v(from)}" stop-opacity="0.05"/>` +
    `<animateTransform attributeName="gradientTransform" type="translate" values="-1 0;1 0;-1 0" dur="${dur}s" repeatCount="indefinite"/>` +
    `</linearGradient>`,
  `url(#${id})`
];

/** The neon bloom — blur merged under the source, as the pack's neon styles do. */
export const glow = (id, sd = 3) => [
  `<filter id="${id}" x="-30%" y="-60%" width="160%" height="220%">` +
    `<feGaussianBlur stdDeviation="${sd}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
  `url(#${id})`
];

export const defs = (...bits) => {
  const body = bits.filter(Boolean).join("");
  return body ? `<defs>${body}</defs>` : "";
};

/* -------------------------------------------------------------------- motion */

/**
 * Rotation about a point. The pack writes `from`/`to` rather than `values` for
 * a plain spin, and this matches it so the two generations read alike.
 */
export const spin = (inner, { dur = 6, cx = 50, cy = 50, reverse = false } = {}) =>
  `<g><animateTransform attributeName="transform" attributeType="XML" type="rotate" ` +
  `from="${reverse ? 360 : 0} ${cx} ${cy}" to="${reverse ? 0 : 360} ${cx} ${cy}" dur="${dur}s" repeatCount="indefinite"/>${inner}</g>`;

/**
 * Scale about a point. SMIL scales about the origin, so the companion translate
 * is not decoration — without it a "pulse" is a drift towards the corner.
 */
export const pulse = (inner, { dur = 2.4, lo = 0.9, hi = 1.08, cx = 50, cy = 50 } = {}) => {
  const t = (s) => `${round(cx * (1 - s))},${round(cy * (1 - s))}`;
  return (
    `<g><animateTransform attributeName="transform" attributeType="XML" type="scale" values="${lo};${hi};${lo}" dur="${dur}s" repeatCount="indefinite" additive="sum"/>` +
    `<animateTransform attributeName="transform" attributeType="XML" type="translate" values="${t(lo)};${t(hi)};${t(lo)}" dur="${dur}s" repeatCount="indefinite" additive="sum"/>${inner}</g>`
  );
};

export const float = (inner, { dur = 4, amp = 5, axis = "y" } = {}) => {
  const val = (d) => (axis === "y" ? `0 ${d}` : `${d} 0`);
  return (
    `<g><animateTransform attributeName="transform" attributeType="XML" type="translate" ` +
    `values="${val(-amp)};${val(amp)};${val(-amp)}" dur="${dur}s" repeatCount="indefinite"/>${inner}</g>`
  );
};

export const flicker = (inner, { dur = 1.4 } = {}) =>
  `<g><animate attributeName="opacity" values="1;0.35;1;0.6;1;0.2;1" keyTimes="0;0.1;0.2;0.35;0.5;0.7;1" dur="${dur}s" repeatCount="indefinite"/>${inner}</g>`;

export const blink = (inner, { dur = 1.6, lo = 0.15 } = {}) =>
  `<g><animate attributeName="opacity" values="1;${lo};1" dur="${dur}s" repeatCount="indefinite"/>${inner}</g>`;

/** A ring that expands and fades — the "ping" every live indicator borrows. */
export const ping = (cx, cy, r0, r1, color, { dur = 2, width = 4 } = {}) =>
  `<circle cx="${cx}" cy="${cy}" r="${r0}" fill="none" stroke="${color}" stroke-width="${width}">` +
  `<animate attributeName="r" values="${r0};${r1}" dur="${dur}s" repeatCount="indefinite"/>` +
  `<animate attributeName="opacity" values="0.9;0" dur="${dur}s" repeatCount="indefinite"/></circle>`;

/** A satellite running a closed path — `animateMotion`, as `anim-logo-orbit-*`. */
export const orbitDot = (path, r, color, { dur = 5, begin } = {}) =>
  `<circle r="${r}" fill="${color}"><animateMotion dur="${dur}s" repeatCount="indefinite"${begin ? ` begin="${begin}"` : ""} path="${path}"/></circle>`;

export const circlePath = (cx, cy, r) =>
  `M${cx} ${round(cy - r)}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}`;

/**
 * Draw-on: the dim ghost of the whole shape with a bright dash chasing along
 * it. Two layers rather than one animated `stroke-dashoffset` on the real
 * stroke, because the ghost is what stops the drawing from being ABSENT for
 * most of its cycle in a UI that may only show it for a moment.
 */
export const drawOn = (paths, { dur = 3, len = 26, gap = 320, width = 7, color } = {}) =>
  paths.map((d) => stroke(d, { color, width, opacity: "0.22" })).join("") +
  `<g opacity="0.95" style="mix-blend-mode:screen">` +
  paths.map((d) => stroke(d, { color, width, dash: `${len} ${gap}` })).join("") +
  `<animate attributeName="stroke-dashoffset" values="${len + gap};0;${-(len + gap)}" dur="${dur}s" repeatCount="indefinite"/></g>`;

/** A `<animate>` on `d` — the only honest "morph", between same-command paths. */
export const morphPath = (values, color, { dur = 3, kind = "fill", width = 7 } = {}) =>
  (kind === "fill"
    ? `<path d="${values[0]}" fill="${color}">`
    : `<path d="${values[0]}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">`) +
  `<animate attributeName="d" values="${[...values, values[0]].join(";")}" dur="${dur}s" repeatCount="indefinite"/></path>`;

/** Staggered opacity across a set of pieces — the pack's `shimmer` in bar form. */
export const shimmerSet = (pieces, { dur = 2.4 } = {}) =>
  pieces
    .map((p, i) => {
      const begin = round((dur / pieces.length) * i);
      return `<g opacity="0.35"><animate attributeName="opacity" values="0.35;1;0.35" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/>${p}</g>`;
    })
    .join("");

/* ------------------------------------------------------------------ assembly */

/** Wrap inner markup as a finished document. `fill="none"` matches the pack. */
export const svgDoc = (inner, { w = 100, h = 100 } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" fill="none">${inner}</svg>`;

/** Per-entry id namespace for gradients/filters/clips. */
export const ns = (entryId) => {
  let n = 0;
  return () => `gx2-${entryId}-${(n += 1)}`;
};
