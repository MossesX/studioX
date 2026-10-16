/**
 * @file Composes AmberX Vid's decl with its screen — the only place the two
 * halves meet, per the standing module pattern.
 */
import { defineModule } from "@axf/core";

import { AMBERXVID_DECL } from "./amberxvid.decl";
import AmberXVidModule from "./AmberXVidModule";

export const AMBERXVID_MODULE = defineModule({ ...AMBERXVID_DECL, component: AmberXVidModule });
