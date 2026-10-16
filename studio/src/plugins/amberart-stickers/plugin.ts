/**
 * @file Stickers, as a contribution to `amberart.tool`.
 *
 * Five drawings — three cats, the GIZMO wordmark and the lockup that puts one
 * over the other — with three colours, a scale, a rotation and a placement pad.
 *
 * DATA ONLY, and the rule is not stylistic: the closure resolver imports this
 * file under plain Node to answer "what plugs into AmberArt?", so a static
 * `.tsx` import or a component in the payload would make the plugin
 * unresolvable and `npm run suite` would refuse to write the closure. Hence the
 * `load` thunk — which also means the panel's code is fetched the first time
 * the tool is selected rather than on boot.
 */
import type { Contribution } from "@axf/core";

import type { AmberArtToolPayload } from "../../modules/amberart/host";

export const STICKERS_CONTRIBUTION: Contribution<AmberArtToolPayload> = {
  from: "amberart-stickers",
  point: "amberart.tool",
  priority: 40,
  payload: {
    id: "stickers",
    title: "Stickers",
    glyph: "icon-sticker",
    summary:
      "The GIZMO cat and friends as pure geometry: pick one, recolour it, drag it where you want it " +
      "and place it at any size without a blurred edge.",
    load: () => import("./StickersPanel")
  }
};
