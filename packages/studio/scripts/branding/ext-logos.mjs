/**
 * @file 100 logos and 50 animated logos for the brand-extension — the lettered
 * half of the pack.
 *
 * ## Six names, twelve layouts, nine styles
 *
 * The staged pack's `logo` category is 52 drawings and every one of them is
 * MUTE: a signet, a core, a monogram, no words. Its lettering lives in
 * `wordmark` and `lockup`, which is the right split for a house style but
 * leaves nothing to hand somebody who asks for "the logo with the name on it".
 * These 150 fill that: each is a mark AND its name in one drawing.
 *
 * The six names are the owner's, spelled exactly and never blended:
 *
 *   GizmoX Integrated Framework · GizmoX · AmberX · AmberX AI Studio ·
 *   AmberX SDK · AmberX AI Studio SDK
 *
 * ## Why the geometry is computed rather than typed
 *
 * A lockup's viewBox has to fit its own text, and the text is a system font
 * resolved at paint time — there is no glyph outline here to measure. So `kit`
 * carries an advance-width table and every layout SIZES ITSELF from it, with a
 * 6% margin. Type a viewBox by hand instead and the first name longer than the
 * one you tested against gets its last letter clipped, silently, in whichever
 * slot the placement editor put it.
 *
 * ## Motion is applied to the layout, not baked into it
 *
 * A layout returns its parts — plate, mark, text lines, and where the mark's
 * centre ended up — and `applyMotion` animates those parts. That is what keeps
 * 50 animated logos from being 50 hand-animated drawings: the same wipe reads
 * correctly on a seal and on a pill because both told the truth about their own
 * geometry.
 */
import {
  MARKS, circle, circlePath, defs, esc, float, glow, gradient, orbitDot,
  pulse, rect, rectS, ring, round, shimmerSet, spin, stroke, sweepGradient, text,
  textBox, SANS, MONO, v
} from "./kit.mjs";

const A = () => v("accent");
const A2 = () => v("accent2");
const A3 = () => v("accent3");
const INK = () => v("ink");
const DIM = () => v("dim");
const EDGE = () => v("edge");
const PAGE = () => v("page");

/* --------------------------------------------------------------- the six names */

/**
 * `lead`/`tail` is the split a two-colour or two-tier treatment uses; `one` is
 * the whole name on one line; `lines` is the stacked form. `mono` is the two
 * letters a monogram tile can hold — never an abbreviation of the whole name,
 * because "GIF" and "AASS" are not things the owner's brand is called.
 */
export const BRANDS = {
  gif: {
    slug: "gizmox-integrated-framework",
    one: "GIZMOX INTEGRATED FRAMEWORK",
    lead: "GIZMOX",
    tail: "INTEGRATED FRAMEWORK",
    lines: ["GIZMOX", "INTEGRATED", "FRAMEWORK"],
    mono: "GX",
    dotted: "GIZMOX · INTEGRATED · FRAMEWORK",
    seal: { top: "GIZMOX", bottom: "INTEGRATED FRAMEWORK" },
    name: "GizmoX Integrated Framework"
  },
  gizmox: {
    slug: "gizmox",
    one: "GIZMOX",
    lead: "GIZMOX",
    tail: "",
    // No sub-name to colour, so `duo` splits the terminal X instead — the one
    // letter both house names share and the only place a second colour can go
    // without inventing a word the brand is not called.
    split: ["GIZMO", "X"],
    lines: ["GIZMOX"],
    mono: "GX",
    dotted: "G · I · Z · M · O · X",
    seal: { top: "GIZMOX", bottom: "" },
    name: "GizmoX"
  },
  amberx: {
    slug: "amberx",
    one: "AMBERX",
    lead: "AMBERX",
    tail: "",
    split: ["AMBER", "X"],
    lines: ["AMBERX"],
    mono: "AX",
    dotted: "A · M · B · E · R · X",
    seal: { top: "AMBERX", bottom: "" },
    name: "AmberX"
  },
  axs: {
    slug: "amberx-ai-studio",
    one: "AMBERX AI STUDIO",
    lead: "AMBERX",
    tail: "AI STUDIO",
    lines: ["AMBERX", "AI STUDIO"],
    mono: "AX",
    dotted: "AMBERX · AI · STUDIO",
    seal: { top: "AMBERX", bottom: "AI STUDIO" },
    name: "AmberX AI Studio"
  },
  axsdk: {
    slug: "amberx-sdk",
    one: "AMBERX SDK",
    lead: "AMBERX",
    tail: "SDK",
    lines: ["AMBERX", "SDK"],
    mono: "AX",
    dotted: "AMBERX · SDK",
    seal: { top: "AMBERX", bottom: "SDK" },
    name: "AmberX SDK"
  },
  axssdk: {
    slug: "amberx-ai-studio-sdk",
    one: "AMBERX AI STUDIO SDK",
    lead: "AMBERX",
    tail: "AI STUDIO SDK",
    lines: ["AMBERX", "AI STUDIO", "SDK"],
    mono: "AX",
    dotted: "AMBERX · AI STUDIO · SDK",
    seal: { top: "AMBERX", bottom: "AI STUDIO SDK" },
    name: "AmberX AI Studio SDK"
  }
};

/* ------------------------------------------------------------------- the styles */

/**
 * A style resolves to paint, not to shape — which is why the same layout can
 * wear all nine and still be the same lockup. `nsf()` mints the gradient and
 * filter ids so two styled copies on one page do not share a `<defs>`.
 */
function paint(style, nsf) {
  const bits = [];
  const base = {
    bits,
    weight: 800,
    lsMul: 1,
    primary: { color: A() },
    secondary: { color: DIM() },
    plate: null,
    markOpacity: null,
    duo: false
  };
  switch (style) {
    case "solid":
      return base;
    case "ink":
      return { ...base, primary: { color: INK() }, secondary: { color: A() } };
    case "duo":
      return { ...base, duo: true, primary: { color: A() }, secondary: { color: INK() } };
    case "gradient": {
      const [d, ref] = gradient(nsf());
      bits.push(d);
      return { ...base, primary: { color: ref }, secondary: { color: A2() } };
    }
    case "outline":
      return {
        ...base,
        primary: { color: "none", extra: ` stroke="${A()}" stroke-width="1.6" paint-order="stroke"` },
        secondary: { color: "none", extra: ` stroke="${DIM()}" stroke-width="1.1"` }
      };
    case "neon": {
      const [d, ref] = glow(nsf(), 3);
      bits.push(d);
      return { ...base, primary: { color: A(), extra: ` filter="${ref}"` }, secondary: { color: A3(), extra: ` filter="${ref}"` } };
    }
    case "line":
      return { ...base, weight: 400, lsMul: 1.6, primary: { color: INK() }, secondary: { color: DIM() } };
    case "inverse":
      return { ...base, plate: { fill: PAGE() }, primary: { color: INK() }, secondary: { color: A() } };
    case "glass":
      return {
        ...base,
        plate: { fill: PAGE(), opacity: "0.6", stroke: EDGE() },
        primary: { color: INK() },
        secondary: { color: A2() }
      };
    default:
      throw new Error(`ext-logos: unknown style "${style}"`);
  }
}

/** One line of brand text, honouring `duo`'s two-colour split. */
function nameLine(brand, p, { x, y, size, ls, weight, anchor = "middle" }) {
  const opts = { x, y, size, ls, weight: weight ?? p.weight, anchor, extra: p.primary.extra };
  if (p.duo && brand.tail) {
    return text(
      [
        { t: brand.lead, fill: p.primary.color },
        { t: brand.tail, fill: p.secondary.color, dx: round(size * 0.34) }
      ],
      { ...opts, color: p.primary.color }
    );
  }
  if (p.duo && brand.split) {
    return text(
      [
        { t: brand.split[0], fill: p.primary.color },
        { t: brand.split[1], fill: v("accent3") }
      ],
      { ...opts, color: p.primary.color }
    );
  }
  return text(brand.one, { ...opts, color: p.primary.color });
}

/** The size that lets a name of this length stay a logo rather than a banner. */
const fitSize = (s, big, mid, small) => (s.length > 20 ? small : s.length > 11 ? mid : big);

/* ------------------------------------------------------------------ the layouts */

/**
 * Every layout returns the same record. `markC` is the mark's centre in FINAL
 * coordinates and `markR` the radius a satellite should orbit at — the two
 * numbers `applyMotion` cannot recover from a markup string.
 */
const LAYOUTS = {
  /** Mark left, name right on one line. The default lockup. */
  hmark(brand, p, mark) {
    const size = fitSize(brand.one, 42, 34, 25);
    const ls = round(size * 0.13 * p.lsMul);
    const tw = textBox(brand.one, size, Number(ls), p.weight);
    const x0 = 118;
    const w = x0 + tw + 18;
    return {
      w, h: 100, shape: "wide", size: 64,
      mark: `<g transform="translate(6 0)">${mark}</g>`,
      markC: [56, 50], markR: 46,
      lines: [nameLine(brand, p, { x: x0 + tw / 2, y: 50, size, ls })]
    };
  },

  /** Mark left, name in two tiers right — the form a sub-name needs. */
  hstack(brand, p, mark) {
    const lead = 38;
    const tail = brand.tail.length > 12 ? 15 : 18;
    const lsA = round(lead * 0.1 * p.lsMul);
    const lsB = round(tail * 0.3 * p.lsMul);
    const tw = Math.max(
      textBox(brand.lead, lead, Number(lsA), p.weight),
      textBox(brand.tail, tail, Number(lsB), 600)
    );
    const x0 = 118;
    const w = x0 + tw + 18;
    return {
      w, h: 100, shape: "wide", size: 64,
      mark: `<g transform="translate(6 0)">${mark}</g>`,
      markC: [56, 50], markR: 46,
      lines: [
        text(brand.lead, { x: x0 + tw / 2, y: 40, size: lead, ls: lsA, weight: p.weight, color: p.primary.color, extra: p.primary.extra }),
        text(brand.tail, { x: x0 + tw / 2, y: 70, size: tail, ls: lsB, weight: 600, color: p.secondary.color, extra: p.secondary.extra })
      ]
    };
  },

  /** Mark above, name below, both centred. */
  vstack(brand, p, mark) {
    const size = fitSize(brand.one, 38, 30, 22);
    const ls = round(size * 0.13 * p.lsMul);
    const tw = textBox(brand.one, size, Number(ls), p.weight);
    const w = Math.max(tw + 40, 150);
    return {
      w, h: 168, shape: "tall", size: 96,
      mark: `<g transform="translate(${round((w - 100) / 2)} 6)">${mark}</g>`,
      markC: [w / 2, 56], markR: 46,
      lines: [nameLine(brand, p, { x: w / 2, y: 134, size, ls })]
    };
  },

  /** Mark, lead, hairline rule, tail — the formal vertical lockup. */
  vtier(brand, p, mark) {
    const lead = 34;
    const tail = brand.tail.length > 12 ? 15 : 18;
    const lsA = round(lead * 0.12 * p.lsMul);
    const lsB = round(tail * 0.32 * p.lsMul);
    const tw = Math.max(
      textBox(brand.lead, lead, Number(lsA), p.weight),
      textBox(brand.tail, tail, Number(lsB), 600)
    );
    const w = Math.max(tw + 48, 170);
    const cx = w / 2;
    return {
      w, h: 200, shape: "tall", size: 96,
      mark: `<g transform="translate(${round((w - 100) / 2)} 4)">${mark}</g>`,
      markC: [cx, 54], markR: 46,
      lines: [
        text(brand.lead, { x: cx, y: 132, size: lead, ls: lsA, weight: p.weight, color: p.primary.color, extra: p.primary.extra }),
        stroke(`M${round(cx - tw / 2)} 156H${round(cx + tw / 2)}`, { color: A(), width: 2.5, opacity: "0.7" }),
        text(brand.tail, { x: cx, y: 178, size: tail, ls: lsB, weight: 600, color: p.secondary.color, extra: p.secondary.extra })
      ]
    };
  },

  /** The lockup on its own card — a plate that survives any backdrop. */
  plate(brand, p, mark) {
    const size = fitSize(brand.one, 34, 28, 21);
    const ls = round(size * 0.13 * p.lsMul);
    const tw = textBox(brand.one, size, Number(ls), p.weight);
    const x0 = 104;
    const w = x0 + tw + 24;
    const pl = p.plate ?? { fill: PAGE() };
    return {
      w, h: 100, shape: "wide", size: 64,
      plate:
        rect(2, 2, w - 4, 96, 22, pl.fill, { opacity: pl.opacity }) +
        (pl.stroke ? rectS(2, 2, w - 4, 96, 22, pl.stroke, 2) : ""),
      mark: `<g transform="translate(16 18) scale(0.64)">${mark}</g>`,
      markC: [48, 50], markR: 36,
      lines: [nameLine(brand, p, { x: x0 + tw / 2, y: 50, size, ls })]
    };
  },

  /** Text in a pill, a status dot where a mark would go. Chrome-scale. */
  pill(brand, p) {
    const size = fitSize(brand.one, 34, 28, 21);
    const ls = round(size * 0.13 * p.lsMul);
    const tw = textBox(brand.one, size, Number(ls), p.weight);
    const w = tw + 96;
    return {
      w, h: 100, shape: "wide", size: 46,
      plate: rectS(4, 20, w - 8, 60, 30, p.plate?.stroke ?? A(), 4),
      mark: circle(38, 50, 11, A()),
      markC: [38, 50], markR: 22,
      lines: [nameLine(brand, p, { x: 60 + tw / 2, y: 50, size, ls })]
    };
  },

  /** Bracketed — the framework's own `[ ]` motif carrying the name. */
  bracket(brand, p) {
    const size = fitSize(brand.one, 38, 31, 23);
    const ls = round(size * 0.13 * p.lsMul);
    const tw = textBox(brand.one, size, Number(ls), p.weight);
    const w = tw + 116;
    return {
      w, h: 100, shape: "wide", size: 56,
      mark:
        stroke("M42 20H20v60h22", { color: A(), width: 7 }) +
        stroke(`M${w - 42} 20h22v60h-22`, { color: A(), width: 7 }),
      markC: [w / 2, 50], markR: 44,
      lines: [nameLine(brand, p, { x: w / 2, y: 50, size, ls })]
    };
  },

  /** Name over an accent rule, mark riding the rule's right end. */
  rule(brand, p, mark) {
    const size = fitSize(brand.one, 40, 33, 24);
    const ls = round(size * 0.14 * p.lsMul);
    const tw = textBox(brand.one, size, Number(ls), p.weight);
    const w = Math.max(tw + 40, 220);
    return {
      w, h: 132, shape: "wide", size: 64,
      mark: `<g transform="translate(${round(w - 68)} 70) scale(0.52)">${mark}</g>`,
      markC: [w - 42, 96], markR: 28,
      lines: [
        nameLine(brand, p, { x: w / 2, y: 44, size, ls }),
        stroke(`M20 84H${round(w - 76)}`, { color: A(), width: 5 })
      ]
    };
  },

  /** A seal: mark in the middle, name curved around it. */
  seal(brand, p, mark, nsf) {
    const R = 100;
    // Namespaced per ENTRY, not per brand: the static seal and the animated
    // seal of the same brand can land in one DOM, and two `<path id="seal-t">`
    // would send both `<textPath>`s at whichever the browser saw first.
    const topId = nsf();
    const botId = nsf();
    const topSize = brand.seal.top.length > 10 ? 17 : 21;
    const botSize = brand.seal.bottom.length > 14 ? 13 : 16;
    const arcs =
      `<path id="${topId}" fill="none" d="M22 100A78 78 0 0 1 178 100"/>` +
      `<path id="${botId}" fill="none" d="M26 100A74 74 0 0 0 174 100"/>`;
    const curved = (id, body, size, color, extra) =>
      `<text font-family="${SANS}" font-size="${size}" font-weight="700" letter-spacing="${round(size * 0.22)}" ` +
      `fill="${color}"${extra ?? ""}><textPath href="#${id}" startOffset="50%" text-anchor="middle">${esc(body)}</textPath></text>`;
    return {
      w: 2 * R, h: 2 * R, shape: "square", size: 96,
      plate: defs(arcs) + ring(R, R, 92, A(), 3, { opacity: "0.55" }) + ring(R, R, 62, DIM(), 1.5, { opacity: "0.5" }),
      mark: `<g transform="translate(${R - 44} ${R - 44}) scale(0.88)">${mark}</g>`,
      markC: [R, R], markR: 62,
      lines: [
        curved(topId, brand.seal.top, topSize, p.primary.color, p.primary.extra),
        brand.seal.bottom
          ? curved(botId, brand.seal.bottom, botSize, p.secondary.color, p.secondary.extra)
          : circle(R, R + 72, 4, A()) + circle(R - 16, R + 70, 3, DIM()) + circle(R + 16, R + 70, 3, DIM())
      ]
    };
  },

  /** A monogram tile with the name set beside it, two tiers when there is one. */
  tile(brand, p, _mark, _nsf) {
    const lead = 34;
    const lsA = round(lead * 0.11 * p.lsMul);
    const tailSize = 16;
    const lsB = round(tailSize * 0.3 * p.lsMul);
    const tw = Math.max(
      textBox(brand.lead, lead, Number(lsA), p.weight),
      brand.tail ? textBox(brand.tail, tailSize, Number(lsB), 600) : 0
    );
    const x0 = 112;
    const w = x0 + tw + 18;
    return {
      w, h: 100, shape: "wide", size: 64,
      mark: `<g transform="translate(4 0)">${MARKS.tile(brand.mono)}</g>`,
      markC: [54, 50], markR: 46,
      lines: brand.tail
        ? [
            text(brand.lead, { x: x0 + tw / 2, y: 40, size: lead, ls: lsA, weight: p.weight, color: p.primary.color, extra: p.primary.extra }),
            text(brand.tail, { x: x0 + tw / 2, y: 70, size: tailSize, ls: lsB, weight: 600, color: p.secondary.color, extra: p.secondary.extra })
          ]
        : [nameLine(brand, p, { x: x0 + tw / 2, y: 50, size: lead, ls: lsA })]
    };
  },

  /** One word per line against an accent bar — the editorial treatment. */
  words(brand, p) {
    const size = 40;
    const ls = round(size * 0.08 * p.lsMul);
    const lineH = 46;
    const tw = Math.max(...brand.lines.map((l) => textBox(l, size, Number(ls), p.weight)));
    const w = tw + 74;
    const h = brand.lines.length * lineH + 30;
    return {
      w, h, shape: brand.lines.length > 1 ? "tall" : "wide", size: 96,
      mark: rect(20, 18, 8, h - 36, 4, A()),
      markC: [24, h / 2], markR: 0,
      lines: brand.lines.map((l, i) =>
        text(l, {
          x: 46, y: 30 + i * lineH, size, ls, weight: p.weight, anchor: "start",
          color: i === 0 ? p.primary.color : p.secondary.color,
          extra: i === 0 ? p.primary.extra : p.secondary.extra
        })
      )
    };
  },

  /** Monospaced and dot-separated — the name as the terminal writes it. */
  mono(brand, p) {
    const size = 24;
    const ls = 2;
    const tw = textBox(brand.dotted, size * 1.08, ls, 600);
    const w = tw + 96;
    return {
      w, h: 90, shape: "wide", size: 46,
      mark: stroke("M22 32 34 45 22 58", { color: A(), width: 5 }) + stroke("M40 62h16", { color: A3(), width: 5 }),
      markC: [34, 45], markR: 24,
      lines: [
        text(brand.dotted, {
          x: 68 + tw / 2, y: 45, size, ls, weight: 600, family: MONO,
          color: p.primary.color, extra: p.primary.extra
        })
      ]
    };
  }
};

/* -------------------------------------------------------------------- motion */

/** Repaint a markup run through one paint server, leaving `none` alone. */
const repaint = (markup, ref) =>
  markup
    .replace(/fill="(?!none")[^"]*"/g, `fill="${ref}"`)
    .replace(/stroke="(?!none")[^"]*"/g, `stroke="${ref}"`);

/**
 * Animate a laid-out lockup. The plate never moves — a card that breathes is a
 * card that looks broken — so motion is applied to the mark and the lettering
 * only, and always to the part of the drawing the family is actually about.
 */
function applyMotion(motion, L, nsf) {
  const body = L.lines.join("");
  const [cx, cy] = L.markC;
  switch (motion) {
    case "spin":
      return { bits: [], inner: spin(L.mark, { dur: 9, cx, cy }) + body };
    case "pulse":
      return { bits: [], inner: pulse(L.mark, { dur: 2.8, lo: 0.93, hi: 1.06, cx, cy }) + body };
    case "orbit":
      return {
        bits: [],
        inner:
          L.mark + body +
          orbitDot(circlePath(cx, cy, L.markR), 5, A2(), { dur: 5 }) +
          orbitDot(circlePath(cx, cy, L.markR), 3.5, A3(), { dur: 5, begin: "-2.5s" })
      };
    case "float":
      return { bits: [], inner: float(L.mark + body, { dur: 4.4, amp: 3.5 }) };
    case "flicker": {
      const [f, ref] = glow(nsf(), 2.6);
      return {
        bits: [f],
        inner: L.mark + `<g filter="${ref}"><animate attributeName="opacity" values="1;0.45;1;0.7;1;0.3;1" keyTimes="0;0.08;0.16;0.3;0.46;0.62;1" dur="2.6s" repeatCount="indefinite"/>${body}</g>`
      };
    }
    case "sweep":
    case "shimmer": {
      if (motion === "shimmer" && L.lines.length > 1) {
        return { bits: [], inner: L.mark + shimmerSet(L.lines, { dur: 3 }) };
      }
      const dur = motion === "shimmer" ? 4.2 : 2.8;
      const [g, ref] = sweepGradient(nsf(), dur);
      return {
        bits: [g],
        inner:
          L.mark + body +
          `<g opacity="${motion === "shimmer" ? 0.45 : 0.6}" style="mix-blend-mode:screen">${repaint(body, ref)}</g>`
      };
    }
    case "draw": {
      const clip = nsf();
      return {
        bits: [
          `<clipPath id="${clip}"><rect x="0" y="0" width="0" height="${L.h}">` +
            `<animate attributeName="width" values="0;${L.w};${L.w};0" keyTimes="0;0.42;0.86;1" dur="4.2s" repeatCount="indefinite"/></rect></clipPath>`
        ],
        inner: `<g opacity="0.16">${L.mark}${body}</g><g clip-path="url(#${clip})">${L.mark}${body}</g>`
      };
    }
    default:
      throw new Error(`ext-logos: unknown motion "${motion}"`);
  }
}

/* ---------------------------------------------------------------- the tables */

/** `[layout, style, mark]` — mark is a key into `MARKS`, or null when unused. */
const STATIC_PLAN = {
  gif: [
    ["hmark", "solid", "cross"], ["hmark", "duo", "crossDuo"], ["hmark", "neon", "chip"],
    ["hstack", "ink", "hex"], ["hstack", "gradient", "quad"],
    ["vstack", "solid", "cross"], ["vtier", "duo", "prism"],
    ["plate", "inverse", "cross"], ["plate", "glass", "hex"],
    ["pill", "outline", null], ["bracket", "ink", null], ["rule", "solid", "hex"],
    ["seal", "solid", "cross"], ["tile", "duo", null], ["words", "gradient", null],
    ["mono", "line", null]
  ],
  gizmox: [
    ["hmark", "solid", "cross"], ["hmark", "gradient", "crossDuo"], ["hmark", "neon", "hex"],
    ["hmark", "line", "brackets"],
    ["vstack", "solid", "cross"], ["vstack", "duo", "quad"],
    ["plate", "inverse", "cross"], ["plate", "glass", "prism"],
    ["pill", "solid", null], ["pill", "outline", null], ["bracket", "gradient", null],
    ["rule", "ink", "cross"], ["seal", "duo", "hex"], ["tile", "solid", null],
    ["words", "outline", null], ["mono", "line", null]
  ],
  amberx: [
    ["hmark", "solid", "crossDuo"], ["hmark", "gradient", "orbit"], ["hmark", "neon", "aperture"],
    ["hmark", "outline", "layers"], ["hmark", "ink", "spark"],
    ["vstack", "solid", "crossDuo"], ["vstack", "gradient", "orbit"], ["vstack", "duo", "shield"],
    ["plate", "inverse", "crossDuo"], ["plate", "glass", "aperture"],
    ["pill", "solid", null], ["pill", "gradient", null], ["bracket", "ink", null],
    ["rule", "solid", "layers"], ["seal", "solid", "crossDuo"], ["tile", "duo", null],
    ["words", "gradient", null], ["mono", "line", null]
  ],
  axs: [
    ["hmark", "solid", "crossDuo"], ["hmark", "duo", "orbit"], ["hmark", "gradient", "aperture"],
    ["hstack", "ink", "layers"], ["hstack", "solid", "spark"], ["hstack", "gradient", "crossDuo"],
    ["hstack", "neon", "orbit"],
    ["vstack", "solid", "crossDuo"], ["vstack", "duo", "aperture"],
    ["vtier", "gradient", "layers"], ["vtier", "ink", "shield"],
    ["plate", "inverse", "crossDuo"], ["plate", "glass", "orbit"],
    ["pill", "outline", null], ["bracket", "solid", null], ["rule", "duo", "spark"],
    ["seal", "solid", "crossDuo"], ["tile", "duo", null], ["words", "gradient", null],
    ["mono", "line", null]
  ],
  axsdk: [
    ["hmark", "solid", "crossDuo"], ["hmark", "duo", "hexSolid"],
    ["hstack", "gradient", "orbit"], ["hstack", "ink", "chip"],
    ["vstack", "solid", "crossDuo"], ["vtier", "duo", "aperture"],
    ["plate", "inverse", "crossDuo"], ["plate", "glass", "chip"],
    ["pill", "solid", null], ["bracket", "outline", null], ["rule", "ink", "hex"],
    ["seal", "duo", "hexSolid"], ["tile", "solid", null], ["words", "gradient", null],
    ["mono", "line", null]
  ],
  axssdk: [
    ["hmark", "solid", "crossDuo"], ["hmark", "gradient", "layers"],
    ["hstack", "duo", "orbit"], ["hstack", "ink", "aperture"], ["hstack", "neon", "spark"],
    ["vstack", "solid", "crossDuo"], ["vtier", "gradient", "layers"], ["vtier", "duo", "chip"],
    ["plate", "inverse", "crossDuo"], ["plate", "glass", "prism"],
    ["pill", "outline", null], ["bracket", "ink", null], ["rule", "solid", "hex"],
    ["seal", "solid", "crossDuo"], ["words", "gradient", null]
  ]
};

/** `[layout, motion, style, mark]`. */
const ANIMATED_PLAN = {
  gif: [
    ["hmark", "sweep", "solid", "cross"], ["hmark", "spin", "duo", "hex"],
    ["hstack", "shimmer", "gradient", "quad"], ["vstack", "orbit", "solid", "cross"],
    ["plate", "pulse", "inverse", "cross"], ["rule", "draw", "ink", "hex"],
    ["seal", "spin", "solid", "cross"], ["words", "shimmer", "gradient", null]
  ],
  gizmox: [
    ["hmark", "sweep", "solid", "cross"], ["hmark", "spin", "gradient", "hex"],
    ["hmark", "flicker", "neon", "crossDuo"], ["vstack", "pulse", "solid", "cross"],
    ["plate", "float", "inverse", "cross"], ["pill", "shimmer", "solid", null],
    ["rule", "draw", "ink", "cross"], ["seal", "spin", "duo", "hex"],
    ["bracket", "flicker", "neon", null]
  ],
  amberx: [
    ["hmark", "sweep", "solid", "crossDuo"], ["hmark", "orbit", "gradient", "orbit"],
    ["hmark", "flicker", "neon", "aperture"], ["vstack", "pulse", "solid", "crossDuo"],
    ["plate", "float", "inverse", "crossDuo"], ["pill", "shimmer", "gradient", null],
    ["rule", "draw", "ink", "layers"], ["seal", "spin", "solid", "crossDuo"],
    ["tile", "pulse", "duo", null]
  ],
  axs: [
    ["hmark", "sweep", "solid", "crossDuo"], ["hstack", "orbit", "duo", "orbit"],
    ["hstack", "shimmer", "gradient", "layers"], ["vstack", "pulse", "solid", "crossDuo"],
    ["vtier", "draw", "ink", "aperture"], ["plate", "float", "inverse", "crossDuo"],
    ["pill", "sweep", "outline", null], ["seal", "spin", "solid", "crossDuo"],
    ["tile", "pulse", "duo", null]
  ],
  axsdk: [
    ["hmark", "sweep", "solid", "crossDuo"], ["hstack", "orbit", "gradient", "orbit"],
    ["vstack", "pulse", "solid", "crossDuo"], ["vtier", "shimmer", "duo", "chip"],
    ["plate", "float", "inverse", "crossDuo"], ["pill", "sweep", "solid", null],
    ["rule", "draw", "ink", "hex"], ["seal", "spin", "duo", "hexSolid"]
  ],
  axssdk: [
    ["hmark", "sweep", "solid", "crossDuo"], ["hstack", "shimmer", "gradient", "layers"],
    ["hstack", "orbit", "duo", "orbit"], ["vtier", "draw", "ink", "aperture"],
    ["plate", "float", "inverse", "crossDuo"], ["seal", "spin", "solid", "crossDuo"],
    ["words", "sweep", "gradient", null]
  ]
};

/* ------------------------------------------------------------------- assembly */

const LAYOUT_LABEL = {
  hmark: "horizontal", hstack: "horizontal tiered", vstack: "stacked", vtier: "stacked tiered",
  plate: "plate", pill: "pill", bracket: "bracketed", rule: "ruled", seal: "seal",
  tile: "monogram tile", words: "editorial", mono: "monospaced"
};

const nsFor = (id) => {
  let n = 0;
  return () => `gx2-${id}-${(n += 1)}`;
};

function layOut(brandKey, layout, style, markKey, id) {
  const brand = BRANDS[brandKey];
  if (!brand) throw new Error(`ext-logos: unknown brand "${brandKey}"`);
  if (markKey && !MARKS[markKey]) throw new Error(`ext-logos: unknown mark "${markKey}"`);
  if (!LAYOUTS[layout]) throw new Error(`ext-logos: unknown layout "${layout}"`);
  const nsf = nsFor(id);
  const p = paint(style, nsf);
  const mark = markKey ? MARKS[markKey]() : "";
  const L = LAYOUTS[layout](brand, p, mark, nsf);
  return { brand, nsf, p, L };
}

export const LOGOS = Object.entries(STATIC_PLAN).flatMap(([brandKey, rows]) =>
  rows.map(([layout, style, markKey]) => {
    const id = `logo-${BRANDS[brandKey].slug}-${layout}-${style}`;
    const { brand, p, L } = layOut(brandKey, layout, style, markKey, id);
    return {
      id,
      label: `${brand.name} logo · ${LAYOUT_LABEL[layout]} ${style}`,
      category: "logo",
      size: L.size,
      shape: L.shape,
      style,
      animated: false,
      motion: "none",
      tags: ["logo", "lettered", brand.slug, layout, style, "extension"],
      dir: "logos",
      w: L.w,
      h: L.h,
      inner: defs(...p.bits) + (L.plate ?? "") + L.mark + L.lines.join("")
    };
  })
);

export const ANIMATED_LOGOS = Object.entries(ANIMATED_PLAN).flatMap(([brandKey, rows]) =>
  rows.map(([layout, motion, style, markKey]) => {
    const id = `anim-logo-${BRANDS[brandKey].slug}-${layout}-${motion}`;
    const { brand, nsf, p, L } = layOut(brandKey, layout, style, markKey, id);
    const m = applyMotion(motion, L, nsf);
    return {
      id,
      label: `${brand.name} logo · ${LAYOUT_LABEL[layout]} ${motion}`,
      category: "animated-logo",
      size: L.size,
      shape: L.shape,
      style,
      animated: true,
      motion,
      tags: ["logo", "lettered", "animated", brand.slug, motion, "extension"],
      dir: "animated-logos",
      w: L.w,
      h: L.h,
      inner: defs(...p.bits, ...m.bits) + (L.plate ?? "") + m.inner
    };
  })
);

if (LOGOS.length !== 100) throw new Error(`ext-logos: expected 100 logos, have ${LOGOS.length}`);
if (ANIMATED_LOGOS.length !== 50) {
  throw new Error(`ext-logos: expected 50 animated logos, have ${ANIMATED_LOGOS.length}`);
}
