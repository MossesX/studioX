/**
 * @file AmberArt — declaration composed with its component.
 *
 * The declaration lives in `amberart.decl.ts`, data-only, so the registry, the
 * peel and the suite resolver can read it (including its declared extension
 * point) without loading React. This file is the ONLY place the declaration and
 * the screen meet, and `defineModule` validates the result.
 */
import { defineModule } from "@axf/core";

import AmberArtModule from "./AmberArtModule";
import { AMBERART_DECL } from "./amberart.decl";

export const AMBERART_MODULE = defineModule({
  ...AMBERART_DECL,
  component: AmberArtModule
});
