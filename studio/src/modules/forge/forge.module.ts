/**
 * @file Composes the Forge's decl with its screen — the only place the two
 * halves meet, per the standing module pattern.
 *
 * The screen is `ForgeScreen`, the tabbed composition of the roster
 * inspector (`ForgeModule.tsx`) and the designer (`ForgeDesigner.tsx`) —
 * see the decl's 2026-08-13 merge note for why there are two halves.
 */
import { defineModule } from "@axf/core";

import { FORGE_DECL } from "./forge.decl";
import ForgeScreen from "./ForgeScreen";

export const FORGE_MODULE = defineModule({ ...FORGE_DECL, component: ForgeScreen });
