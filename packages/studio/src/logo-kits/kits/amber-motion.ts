/**
 * @file The "Amber Motion" logo kit (`lk002`) — ten of the branding pack's own
 * animated logo drawings, as a framework input spec.
 *
 * The difference from `lk001` "X Throb" is worth stating plainly, because the
 * two kits look like the same idea and are not:
 *
 *   · **lk001** is ONE mark, animated ten ways. The drawing is the brand mark
 *     and the movement is CSS written in `../motions`. Every logo is the same
 *     shape doing something different.
 *   · **lk002** is TEN COMPLETE LOGOS. Each names a `pack` motion pointing at a
 *     real authored SVG in the branding pack (`anim-logo-orbit-free`, …) whose
 *     animation lives in its own SMIL. Nothing here writes movement; the artwork
 *     already moves.
 *
 * Authored 2026-08-15 on the owner's call to have both rather than choose, so
 * the two can be compared side by side in the gallery and the landing can point
 * at whichever wins.
 */

import type { LogoKitInput } from "../types";

export const AMBER_MOTION: LogoKitInput = {
  id: "lk002",
  name: "Amber Motion",
  version: "0.1.0",
  description:
    "Ten complete animated logos from the branding pack — orbit, orbit-hex, pulse, spin, float, shimmer, sweep, draw-on, morph and neon flicker. Each carries its own SMIL; nothing is animated in CSS.",
  logos: [
    { slug: "orbit", name: "Orbit", motion: "pack-orbit", note: "Blades around a diamond; a satellite tracks a circular path." },
    { slug: "orbit-hex", name: "Orbit hex", motion: "pack-orbit-hex" },
    { slug: "pulse", name: "Pulse", motion: "pack-pulse" },
    { slug: "spin", name: "Spin", motion: "pack-spin" },
    { slug: "float", name: "Float", motion: "pack-float" },
    { slug: "shimmer", name: "Shimmer", motion: "pack-shimmer" },
    { slug: "sweep", name: "Sweep", motion: "pack-sweep" },
    { slug: "draw", name: "Draw-on", motion: "pack-draw" },
    { slug: "morph", name: "Morph", motion: "pack-morph" },
    { slug: "flicker", name: "Neon flicker", motion: "pack-flicker" }
  ]
};
