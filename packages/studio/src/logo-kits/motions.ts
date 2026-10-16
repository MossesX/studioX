/**
 * @file The logo-kit MOTION registry — the single, closed source of truth for
 * every animation a logo in a kit may use.
 *
 * A logo never invents its own animation: it names a motion id from this table,
 * and `defineLogoKit` rejects any id that is not here. That is what makes a kit
 * safe to render sight-unseen — there is no path by which a kit references an
 * animation the renderer does not know how to draw.
 *
 * Each motion declares how it is drawn:
 *   - `brand-smil` — the branding pack's own animated mark; the renderer uses
 *     `GizmoXMarkAnimated` with `variant`.
 *   - `css`        — the static mark wrapped in a CSS keyframe animation. The
 *     keyframe text lives here as `css`; the renderer turns it into a scoped
 *     emotion keyframe. Colour is referenced as `var(--lk-accent)` so the motion
 *     text stays theme-independent and the renderer supplies the accent.
 *   - `static`     — no animation at all (motion id `none`).
 *
 * ## PORT NOTE (GizmoX → AmberX, 2026-08-15) — read before touching `orbit`
 *
 * In GizmoX the two `brand-smil` motions were genuinely different drawings: the
 * branding pack shipped real SMIL logos and `GizmoXMarkAnimated` picked between
 * them with `variant: "Snap" | "Glitch"`. AmberX's branding contract has no such
 * pair — `src/modules/amberxvid/gizmox-kit.tsx` says so in its own header:
 * *"`GizmoXMarkAnimated`'s "Snap"/"Glitch" variants both render the one
 * `spinner` asset"*.
 *
 * Ported verbatim, that would make `lk001-orbit` and `lk001-pulse` pixel-identical
 * here — and `orbit` is the logo the owner chose for the login landing, so the
 * choice would have silently meant nothing. Rather than drop the engine (which
 * would throw away the seam a real animated pack plugs into later) each
 * `brand-smil` motion now also carries **`fallbackCss`**: the renderer applies it
 * over the animated glyph so the motions stay visually distinct TODAY, and the
 * day AmberX's pack grows real Snap/Glitch drawings the fallback is deleted and
 * nothing else changes.
 */

export type MotionEngine = "brand-smil" | "css" | "static" | "pack";

/** The easings a motion is allowed to use — a closed set, so a kit can never
 *  smuggle in an arbitrary timing function that a browser might reject. */
export const ALLOWED_EASINGS = ["linear", "ease", "ease-in", "ease-out", "ease-in-out"] as const;
export type Easing = (typeof ALLOWED_EASINGS)[number];

export interface Motion {
  id: string;
  label: string;
  note: string;
  engine: MotionEngine;
  /** The animated logo is animated (`css`/`brand-smil`) or static (`static`). */
  animated: boolean;
  /** brand-smil only. */
  variant?: "Snap" | "Glitch";
  /** css only — a keyframe body, may reference `var(--lk-accent)`. */
  css?: string;
  /**
   * brand-smil only, AmberX addition — the keyframe body applied OVER the
   * animated glyph while the branding contract cannot tell the variants apart.
   * See the port note above. Same rules as `css`.
   */
  fallbackCss?: string;
  /** css only — flip needs a 3D context; the renderer adds perspective. */
  needs3d?: boolean;
  /**
   * `pack` only — the branding-pack ENTRY ID whose drawing carries the motion
   * in its own SMIL (`anim-logo-orbit-free`, …). No CSS is applied over it: the
   * artwork already moves. The pack ships 728 entries and `Glyph` renders any
   * of them, so this needs no addition to the 5-id REQUIRED_GLYPHS contract —
   * that list is the minimum every pack must provide, not the whole vocabulary.
   */
  drawing?: string;
  durationMs: number;
  easing: Easing;
}

/** id → motion. The ONLY animations a logo kit may name. */
export const MOTIONS: Record<string, Motion> = {
  orbit: {
    id: "orbit",
    label: "Orbit",
    note: "The brand asset's Glitch variant — pieces orbit.",
    engine: "brand-smil",
    animated: true,
    variant: "Glitch",
    /*
     * A real orbit, not a slow spin: the mark travels a circular path while
     * counter-rotating, so it stays upright as it goes round. The first draft
     * here was `rotate(360deg)` — byte-identical to `spin`, which the
     * distinctness gate below caught. Two logos that differ only in duration
     * are one logo.
     */
    fallbackCss:
      "from{transform:rotate(0deg) translateX(5%) rotate(0deg)}to{transform:rotate(360deg) translateX(5%) rotate(-360deg)}",
    durationMs: 9000,
    easing: "linear"
  },
  pulse: {
    id: "pulse",
    label: "Pulse",
    note: "The brand asset's Snap variant — self-builds and pulses.",
    engine: "brand-smil",
    animated: true,
    variant: "Snap",
    fallbackCss: "0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(1.12);opacity:1}",
    durationMs: 2600,
    easing: "ease-in-out"
  },
  spin: {
    id: "spin",
    label: "Spin",
    note: "Continuous smooth rotation.",
    engine: "css",
    animated: true,
    css: "to { transform: rotate(360deg) }",
    durationMs: 8000,
    easing: "linear"
  },
  rock: {
    id: "rock",
    label: "Rock",
    note: "Rocks gently left and right, like a pendulum.",
    engine: "css",
    animated: true,
    css: "0%,100%{transform:rotate(-12deg)}50%{transform:rotate(12deg)}",
    durationMs: 4000,
    easing: "ease-in-out"
  },
  breathe: {
    id: "breathe",
    label: "Breathe",
    note: "Scales slowly in and out.",
    engine: "css",
    animated: true,
    css: "0%,100%{transform:scale(1)}50%{transform:scale(1.14)}",
    durationMs: 3600,
    easing: "ease-in-out"
  },
  bob: {
    id: "bob",
    label: "Bob",
    note: "Floats up and down.",
    engine: "css",
    animated: true,
    css: "0%,100%{transform:translateY(-9px)}50%{transform:translateY(9px)}",
    durationMs: 3000,
    easing: "ease-in-out"
  },
  heartbeat: {
    id: "heartbeat",
    label: "Heartbeat",
    note: "A quick double-thump, then rest.",
    engine: "css",
    animated: true,
    css: "0%{transform:scale(1)}14%{transform:scale(1.2)}28%{transform:scale(1)}42%{transform:scale(1.14)}70%{transform:scale(1)}100%{transform:scale(1)}",
    durationMs: 1800,
    easing: "ease-in-out"
  },
  flip: {
    id: "flip",
    label: "Coin flip",
    note: "Flips around its vertical axis in 3D.",
    engine: "css",
    animated: true,
    css: "to { transform: rotateY(360deg) }",
    needs3d: true,
    durationMs: 3600,
    easing: "ease-in-out"
  },
  glow: {
    id: "glow",
    label: "Glow throb",
    note: "Stays still but pulses a warm accent glow.",
    engine: "css",
    animated: true,
    css: "0%,100%{filter:drop-shadow(0 0 6px var(--lk-accent));transform:scale(1)}50%{filter:drop-shadow(0 0 26px var(--lk-accent));transform:scale(1.05)}",
    durationMs: 2800,
    easing: "ease-in-out"
  },
  wobble: {
    id: "wobble",
    label: "Wobble",
    note: "A playful little shake on a loop.",
    engine: "css",
    animated: true,
    css: "0%{transform:rotate(0) translateX(0)}20%{transform:rotate(7deg) translateX(4px)}40%{transform:rotate(-5deg) translateX(-4px)}60%{transform:rotate(4deg) translateX(3px)}80%{transform:rotate(-2deg) translateX(0)}100%{transform:rotate(0)}",
    durationMs: 3000,
    easing: "ease-in-out"
  },
  none: {
    id: "none",
    label: "Static",
    note: "No animation — the mark, held still.",
    engine: "static",
    animated: false,
    durationMs: 0,
    easing: "linear"
  },

  /* ---------------------------------------------------------------------------
   * PACK MOTIONS — the branding pack's own animated logo drawings.
   *
   * Unlike everything above, these are not the mark plus movement I wrote: each
   * one is a complete authored logo whose animation lives in its own SMIL
   * (`<animateMotion>`, `<animateTransform>`, `<animate>`). The renderer draws
   * the entry and gets out of the way — no keyframe, no wrapper.
   *
   * `durationMs`/`easing` are recorded as 0/linear on purpose: the drawing owns
   * its timing and nothing here may contradict it. They exist only because the
   * Motion shape is shared, and `drawingFor` never hands them to CSS.
   * ------------------------------------------------------------------------- */
  "pack-orbit": {
    id: "pack-orbit",
    label: "Orbit (pack)",
    note: "Four gradient blades around a centre diamond; a dot travels a circular path.",
    engine: "pack",
    animated: true,
    drawing: "anim-logo-orbit-free",
    durationMs: 0,
    easing: "linear"
  },
  "pack-orbit-hex": {
    id: "pack-orbit-hex",
    label: "Orbit hex (pack)",
    note: "The hex-shell logo with an orbiting satellite.",
    engine: "pack",
    animated: true,
    drawing: "anim-logo-orbit-hex",
    durationMs: 0,
    easing: "linear"
  },
  "pack-pulse": {
    id: "pack-pulse",
    label: "Pulse (pack)",
    note: "The free-form logo, pulsing.",
    engine: "pack",
    animated: true,
    drawing: "anim-logo-pulse-free",
    durationMs: 0,
    easing: "linear"
  },
  "pack-spin": {
    id: "pack-spin",
    label: "Spin (pack)",
    note: "The circle logo, rotating in its own SMIL.",
    engine: "pack",
    animated: true,
    drawing: "anim-logo-spin-circle",
    durationMs: 0,
    easing: "linear"
  },
  "pack-float": {
    id: "pack-float",
    label: "Float (pack)",
    note: "The free-form logo, drifting.",
    engine: "pack",
    animated: true,
    drawing: "anim-logo-float-free",
    durationMs: 0,
    easing: "linear"
  },
  "pack-shimmer": {
    id: "pack-shimmer",
    label: "Shimmer (pack)",
    note: "The hex logo with a travelling highlight.",
    engine: "pack",
    animated: true,
    drawing: "anim-logo-shimmer-hex",
    durationMs: 0,
    easing: "linear"
  },
  "pack-sweep": {
    id: "pack-sweep",
    label: "Sweep (pack)",
    note: "The wide logo with a sweeping wipe.",
    engine: "pack",
    animated: true,
    drawing: "anim-logo-sweep-wide",
    durationMs: 0,
    easing: "linear"
  },
  "pack-draw": {
    id: "pack-draw",
    label: "Draw-on (pack)",
    note: "The free-form logo drawing itself in, stroke by stroke.",
    engine: "pack",
    animated: true,
    drawing: "anim-logo-draw-free",
    durationMs: 0,
    easing: "linear"
  },
  "pack-morph": {
    id: "pack-morph",
    label: "Morph (pack)",
    note: "The circle logo morphing between forms.",
    engine: "pack",
    animated: true,
    drawing: "anim-logo-morph-circle",
    durationMs: 0,
    easing: "linear"
  },
  "pack-flicker": {
    id: "pack-flicker",
    label: "Neon flicker (pack)",
    note: "The neon treatment, flickering.",
    engine: "pack",
    animated: true,
    drawing: "anim-logo-flicker-neon",
    durationMs: 0,
    easing: "linear"
  }
};

export const MOTION_IDS = Object.keys(MOTIONS);

export const isMotionId = (id: string): boolean => Object.prototype.hasOwnProperty.call(MOTIONS, id);

/**
 * Which drawing a motion is painted on, and the keyframe body (if any) to run
 * over it.
 *
 * This lives here, as data, rather than inside `LogoKitLogo`'s JSX because that
 * is where it was got WRONG and no test could see it: `orbit` was routed to the
 * animated component, which AmberX's branding shim maps to the `spinner` glyph
 * — a loading ring with an orbiting dot — so the login landing drew a spinner
 * instead of the mark, and every gate stayed green because they all check data
 * and none of them checks the drawing.
 *
 * A logo kit is a set of treatments OF THE MARK. `"animated-mark"` is therefore
 * reserved for the case where the pack genuinely ships a per-variant animated
 * drawing; anything else paints `"mark"` and animates it in CSS.
 */
export type Drawing = "mark" | "animated-mark" | "pack";

export interface Resolved {
  drawing: Drawing;
  /** `pack` only — the entry id to hand to `Glyph`. */
  glyphId: string | null;
  /** The keyframe body to run over the drawing, or null if it moves itself. */
  css: string | null;
}

export function drawingFor(motion: Motion): Resolved {
  if (motion.engine === "pack") {
    // The drawing carries its own SMIL — never wrap it in a CSS animation too,
    // which is exactly how `orbit` first ended up spinning inside a spin.
    return { drawing: "pack", glyphId: motion.drawing ?? null, css: null };
  }
  if (motion.engine === "static") return { drawing: "mark", glyphId: null, css: null };
  if (motion.engine === "css") return { drawing: "mark", glyphId: null, css: motion.css ?? null };
  // brand-smil: a fallback means the pack cannot distinguish the variants, so
  // the motion is CSS over the static mark — never the spinner-mapped drawing.
  return motion.fallbackCss
    ? { drawing: "mark", glyphId: null, css: motion.fallbackCss }
    : { drawing: "animated-mark", glyphId: null, css: null };
}
