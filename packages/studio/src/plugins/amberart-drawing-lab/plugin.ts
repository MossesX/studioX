/**
 * @file Drawing Lab, as a contribution to `amberart.tool`.
 *
 * Ten sliders, three colours, a fill mode and a page preset over an
 * interlocking-tile generator (Poisson-sampled pieces, lobed shared edges,
 * contour insetting), with a live preview and one-click placement onto the
 * active layer.
 *
 * `generator.mjs` came across VERBATIM. In GizmoX the shipped copy was pinned
 * against the standalone lab at `build/tools/drawing-lab` by a parity test;
 * that lab stayed in GizmoX, so the pin here is a content hash against the
 * GizmoX source instead (`test/drawing-lab-parity.test.ts`) — the drift the
 * original test existed to catch is still caught.
 */
import type { Contribution } from "@axf/core";

import type { AmberArtToolPayload } from "../../modules/amberart/host";

export const DRAWING_LAB_CONTRIBUTION: Contribution<AmberArtToolPayload> = {
  from: "amberart-drawing-lab",
  point: "amberart.tool",
  priority: 20,
  payload: {
    id: "drawing-lab",
    title: "Drawing Lab",
    glyph: "icon-layers",
    summary:
      "An interlocking-tile generator: Poisson-sampled pieces with lobed shared edges and " +
      "contour insetting. Seeded and local — no model, no network.",
    load: () => import("./DrawingLabPanel")
  }
};
