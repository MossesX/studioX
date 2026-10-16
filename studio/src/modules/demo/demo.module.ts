/**
 * @file The demo module — declaration composed with its component.
 *
 * The declaration itself lives in `demo.decl.ts`, data-only, so the registry,
 * the peel and any tooling can read "what points does this module publish?"
 * without loading React. This file is the composition point: it is the ONLY
 * place the declaration and the screen meet, and `defineModule` validates the
 * result exactly as it always did.
 *
 * This module exists to make the core VISIBLE while the core is being built.
 * It is a core inspector, not a toy app — every number on its screen comes from
 * the live kernel and registry, so a capability that is broken shows as broken
 * rather than as a passing document. It is also the peel's REFERENCE MODULE:
 * the peel test compiles it into a standalone app and asserts the demo-badge
 * plugin's contribution still renders there.
 */
import { defineModule } from "@axf/core";

import DemoModule from "./DemoModule";
import { DEMO_DECL } from "./demo.decl";

export const DEMO_MODULE = defineModule({
  ...DEMO_DECL,
  component: DemoModule
});
