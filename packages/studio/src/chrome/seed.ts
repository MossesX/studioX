/**
 * @file Register user-authored chrome assets into the live registries.
 *
 * Called from TWO places, for the two moments a custom asset must exist:
 *
 * - `<PacksSeed>` (render phase, both runtimes) — so a custom banner or menu
 *   the theme names is registered BEFORE `Toolbar` / `NavShell` resolve it,
 *   during SSR and hydration alike. Render-phase means this MUST be
 *   re-entrant and cheap: the signature guard below makes every call after
 *   the first a string compare, and — the part that actually matters — it
 *   never notifies the registries on an unchanged document, because an
 *   `upsert()` per render would invalidate the registry snapshot every render
 *   and `useSyncExternalStore` turns that into an infinite loop.
 *
 * - the designer's Toolbar / Nav tabs, after an edit — same call, new
 *   signature, so the running app hot-swaps to the edited asset the moment it
 *   is saved.
 */
import { dashboardFromSpec, dashboards, navs, toolbars } from "@axf/core";

import { CONSOLE_NAV } from "../nav/console-nav";
import { STUDIO_NAV } from "../nav/studio-nav";
import { parseChromeAssetsDoc } from "./assets";
import type { ChromeAssetsDoc } from "./assets";
import { reconcileNav } from "./reconcile";

/** The authored menus a saved fork's destinations are kept current with. A
 *  static list rather than a registry read — see `reconcile.ts` for why the
 *  registry cannot be trusted at this moment on either runtime. */
const AUTHORED_NAVS = [STUDIO_NAV, CONSOLE_NAV];

let seededSignature: string | null = null;
/** Ids this module registered last time, so an asset deleted from the
 *  document is removed from the registry rather than lingering as a ghost. */
let seededToolbarIds: string[] = [];
let seededNavIds: string[] = [];
let seededDashIds: string[] = [];

export function seedChromeAssets(doc: ChromeAssetsDoc | null): void {
  const signature = doc ? JSON.stringify(doc) : "";
  if (signature === seededSignature) return;
  seededSignature = signature;

  // Re-parse even when handed a typed doc: this is the runtime layer of the
  // chokepoint (a brand is erased, a prop crosses a serialisation boundary).
  const parsed = parseChromeAssetsDoc(doc);

  const nextToolbarIds = parsed.toolbars.map((t) => t.id);
  const nextNavIds = parsed.navs.map((n) => n.id);
  const nextDashIds = parsed.dashboards.map((d) => d.id);

  for (const id of seededToolbarIds) {
    if (!nextToolbarIds.includes(id)) toolbars.remove(id);
  }
  for (const id of seededNavIds) {
    if (!nextNavIds.includes(id)) navs.remove(id);
  }
  for (const id of seededDashIds) {
    if (!nextDashIds.includes(id)) dashboards.remove(id);
  }

  for (const bar of parsed.toolbars) {
    try {
      toolbars.upsert(bar as never);
    } catch (error) {
      if (typeof console !== "undefined") console.error("[axs] toolbar seed refused:", error);
    }
  }
  // Reconciled before registering: a saved menu is a snapshot of the
  // destinations as they stood when the glyph editor forked it, and every
  // module registered since is absent from it. `reconcile.ts` carries the
  // measurement that made this necessary.
  for (const menu of parsed.navs) {
    try {
      navs.upsert(reconcileNav(menu, AUTHORED_NAVS) as never);
    } catch (error) {
      if (typeof console !== "undefined") console.error("[axs] nav seed refused:", error);
    }
  }

  // Authored WRAPPERS. `dashboardFromSpec` runs the record back through
  // `defineDashboard`, so a stored wrapper meets the same chokepoint a
  // hand-written one does — and a refusal costs that one wrapper, never the
  // boot: the registry's own fallback then substitutes the default and says so.
  for (const spec of parsed.dashboards) {
    try {
      dashboards.upsert(dashboardFromSpec(spec));
    } catch (error) {
      if (typeof console !== "undefined") console.error("[axs] dashboard seed refused:", error);
    }
  }

  seededToolbarIds = nextToolbarIds;
  seededNavIds = nextNavIds;
  seededDashIds = nextDashIds;
}
