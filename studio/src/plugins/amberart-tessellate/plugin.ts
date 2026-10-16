/**
 * @file Tessellate, as a contribution to `amberart.tool`.
 *
 * Data plus a component reference — no `installTool()`, no import from the
 * module, no side effect at import time. AmberArt never imports this file; the
 * registry resolves it, which is the indirection the whole peel model rests on
 * (`modules/amberart/host.ts` states the argument, and core's `points.ts`
 * states why GizmoX's hand-rolled version could not be peeled).
 *
 * Deterministic by construction: every boundary between two pieces is ONE
 * shared curve, forward for one piece and reversed for the other, so the
 * tessellation interlocks with no overlaps or gaps. No model, no network.
 */
import type { Contribution } from "@axf/core";

import type { AmberArtToolPayload } from "../../modules/amberart/host";

export const TESSELLATE_CONTRIBUTION: Contribution<AmberArtToolPayload> = {
  from: "amberart-tessellate",
  point: "amberart.tool",
  priority: 10,
  payload: {
    id: "tessellate",
    title: "Tessellate",
    glyph: "icon-grid",
    summary:
      "A full-bleed Voronoi tessellation of interlocking organic pieces. Nine dials, seeded — " +
      "the same seed and dials draw the same picture every time.",
    load: () => import("./TessellatePanel")
  }
};
