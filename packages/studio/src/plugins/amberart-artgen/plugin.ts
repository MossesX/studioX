/**
 * @file ArtGen, as a contribution to `amberart.tool`.
 *
 * The generative-art tool. In GizmoX it carried three engines; here it carries
 * ONE — the seeded engine, where the prompt's FNV-1a hash drives a mulberry32
 * PRNG through the same renderer, deterministic and instant with no model.
 *
 * The AI-directed and AI-direct engines are DROPPED, not stubbed: AmberX's
 * claude subsystem was archived and deleted by axf-mui P0, and a tool whose
 * button 500s is worse than a tool that does not offer it. `ArtGenPanel`'s own
 * docblock states the same, at the place someone would look first.
 */
import type { Contribution } from "@axf/core";

import type { AmberArtToolPayload } from "../../modules/amberart/host";

export const ARTGEN_CONTRIBUTION: Contribution<AmberArtToolPayload> = {
  from: "amberart-artgen",
  point: "amberart.tool",
  priority: 30,
  payload: {
    id: "artgen",
    title: "ArtGen",
    glyph: "icon-sparkle",
    summary:
      "Generative art from a prompt — hashed to a seed, expanded into a directive, drawn by the " +
      "renderer. Deterministic: the same prompt and dials give the same piece.",
    load: () => import("./ArtGenPanel")
  }
};
