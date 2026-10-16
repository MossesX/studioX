/**
 * @file The Build Manager — declaration composed with its component.
 *
 * The declaration lives in `buildmgr.decl.ts`, data-only, so the registry, the
 * peel and any tooling can read what this module is without loading React. This
 * file is the ONE place the two halves meet, and `defineModule` validates the
 * result — the same shape `dashboard`, `demo` and `taskman` all take.
 */
import { defineModule } from "@axf/core";

import BuildmgrModule from "./BuildmgrModule";
import { BUILDMGR_DECL } from "./buildmgr.decl";

export const BUILDMGR_MODULE = defineModule({
  ...BUILDMGR_DECL,
  component: BuildmgrModule
});
