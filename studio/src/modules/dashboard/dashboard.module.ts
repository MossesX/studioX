/**
 * @file The dashboard module — declaration composed with its component.
 *
 * The declaration lives in `dashboard.decl.ts`, data-only, so the registry,
 * the peel and the suite resolver can read it without loading React. This
 * file is the ONLY place the declaration and the screen meet, and
 * `defineModule` validates the result exactly as it always did.
 *
 * The route mounts through `BootedHost`, because the registry is per-runtime
 * and a client host that boots only on the server finds an empty registry.
 */
import { defineModule } from "@axf/core";

import DashboardModule from "./DashboardModule";
import { DASHBOARD_DECL } from "./dashboard.decl";

export const DASHBOARD_MODULE = defineModule({
  ...DASHBOARD_DECL,
  component: DashboardModule
});
