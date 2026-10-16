/**
 * @file The app's BUILT-IN chrome assets — bars, menus and the console wrapper
 * — registered synchronously, for both module graphs.
 *
 * ## The bug this exists for (measured 2026-08-15)
 *
 * Every bar and menu in the studio was registered in `studio.subsystem.ts`'s
 * `start()`, which runs through the ASYNC `boot()` — in the browser only. A
 * server render is synchronous and happens in a different module graph, so it
 * finished against EMPTY registries and each surface took its no-asset branch.
 * The SSR HTML for every page carried the red error card
 *
 *     no toolbar registered for surface "app.banner"
 *     no toolbar registered for surface "designer.tabs"
 *
 * with not one `data-axf-toolbar` attribute in the document, and no `<nav>` at
 * all — `NavShell` rendered straight past the menu to `<main>`. The browser
 * then hydrated against registries the boot HAD filled, so the same components
 * rendered `<header data-axf-toolbar="command-bar">` and
 * `<nav data-axf-nav="studio-nav">` where the server had put a bare `<div>` and
 * nothing, and React threw:
 *
 *     Hydration failed because the server rendered HTML didn't match the client
 *
 * — which discards the server tree and re-renders the whole app on the client.
 * Three costs, one cause: a visible red flash of "no toolbar registered" on
 * first paint, a nav that pops in after hydration, and every SSR'd tree below
 * the shell thrown away.
 *
 * This is *exactly* the failure `packs/default-identity.ts` was written for,
 * recurring on the next registry — as its docblock predicted in as many words:
 * **"this will recur for every registry the framework grows."** The remedy is
 * the same one, which is why this file mirrors that one deliberately rather
 * than inventing a second shape: state the built-ins in a plain module (no
 * `"use client"`, so both graphs may import it) and call it from the render
 * phase in `<PacksSeed>` as well as from `start()`.
 *
 * ## Why it must be idempotent, and notify nothing on a repeat
 *
 * `<PacksSeed>` calls this during RENDER, on every render, on both runtimes.
 * `SurfaceRegistry.register()` throws on a duplicate id and `activate()`
 * always invalidates the snapshot and notifies — and a registry notification
 * per render turns `useSyncExternalStore` into an infinite loop (the same trap
 * `chrome/seed.ts` guards with its signature compare). So registration is
 * guarded on the live snapshot, and the default is STATED ONCE per graph.
 *
 * The one-shot on the default is not caution, it is the two-tier distinction
 * `PackRegistry` already draws: the app stating its default must not undo a
 * later `activate()` (the banner roller cycles `app.banner` through these
 * candidates), so a re-render cannot snap the bar back to the command bar.
 */
import { dashboards, navs, toolbars } from "@axf/core";

import { DASH_AMBERX_CONSOLE } from "../dashboards/amberx-console";
import { CONSOLE_NAV } from "../nav/console-nav";
import { STUDIO_NAV } from "../nav/studio-nav";
import { PROJECT_STATE_BAR } from "../plugins/project-state/project-state-bar";
import { BANNERS } from "../toolbars/banners";
import { COMMAND_BAR } from "../toolbars/command-bar";
import { CONSOLE_BARS } from "../toolbars/console-bar";
import { DESIGNER_TABS_BAR } from "../toolbars/designer-tabs-bar";
import { TASKMAN_LISTS_BAR } from "../toolbars/taskman-lists-bar";

/**
 * Every built-in bar, in REGISTRATION order — which is the order a roller
 * cycles a surface's candidates in, so it is behaviour and not a list style.
 *
 *   · the three `banner-*` candidates, so `app.banner` has something to swap
 *     between and is never blank;
 *   · the command bar, which is the `app.banner` default (stated below);
 *   · the console's artifact banner and status strip;
 *   · the Task Manager lists rail, drawn INLINE by `InlineToolbars` — its
 *     surface id is only a compatibility statement;
 *   · the theme designer's own tab strip;
 *   · the /project-state bar, rendered by asset id.
 */
const BUILTIN_TOOLBARS = [
  ...BANNERS,
  COMMAND_BAR,
  ...CONSOLE_BARS,
  TASKMAN_LISTS_BAR,
  DESIGNER_TABS_BAR,
  PROJECT_STATE_BAR
];

/**
 * The navigation menus — items only. Placement, style, icon size, indicator and
 * motion are layout dials, so a rolled layout theme moves and redraws them with
 * no edit here. `studio-nav` is first and so becomes the `app.nav` fallback;
 * `console-nav` stays a selectable candidate.
 *
 * No look binding any more (2026-08-12): WHICH banner and WHICH menu render are
 * the theme's own `bannerBar` / `navMenu` chrome dials, read by `Toolbar` /
 * `NavShell` with the registry default as the floor. A wrapper that re-activated
 * its own chrome on boot was a second writer fighting the theme — the exact
 * class of bug the one-resolver rework exists to end.
 */
const BUILTIN_NAVS = [STUDIO_NAV, CONSOLE_NAV];

/**
 * The console wrapper, and after P0 the ONLY one. It registers first, so it is
 * the registry default and the fallback every stale stored id lands on, as well
 * as the boot chrome (MASTER §4.4: dash-amberx-console is THE DEFAULT).
 *
 * The sandbox pair and the GizmoX replica were the other two, and the strip took
 * all three. That genuinely costs coverage: with one wrapper registered, "the
 * resolver falls back to the default" and "a swap does not remount" are no
 * longer demonstrated by the running app. The resolver itself is still exercised
 * — `npm run check:dashboard` drives the real core registry through default /
 * exact / fallback / healing with synthetic wrappers, and watches each mutation
 * go red — so the MECHANISM is covered even while the app ships one wrapper. A
 * second real wrapper returns when there is a second real surface to wrap, not
 * before.
 */
const BUILTIN_DASHBOARDS = [DASH_AMBERX_CONSOLE];

/** Whether this module graph has already stated the app's banner default. */
let statedBannerDefault = false;

/**
 * Register the built-in bars, menus and wrapper, and state the app's banner
 * default. Safe to call repeatedly, and on a repeat it touches the registries —
 * and therefore their subscribers — not at all.
 */
export function seedBuiltinChrome(): void {
  const knownBars = new Set(toolbars.snapshot().all.map((bar) => bar.id));
  for (const bar of BUILTIN_TOOLBARS) {
    if (!knownBars.has(bar.id)) toolbars.register(bar);
  }

  const knownNavs = new Set(navs.snapshot().all.map((menu) => menu.id));
  for (const menu of BUILTIN_NAVS) {
    if (!knownNavs.has(menu.id)) navs.register(menu);
  }

  const knownDashboards = new Set(dashboards.snapshot().all.map((dash) => dash.id));
  for (const dash of BUILTIN_DASHBOARDS) {
    if (!knownDashboards.has(dash.id)) dashboards.register(dash);
  }

  // The command bar is the `app.banner` default, and the three banner-*
  // candidates registered before it are what a swap cycles through — so the
  // default cannot come from register()'s first-one-wins and has to be said.
  if (!statedBannerDefault) {
    statedBannerDefault = true;
    toolbars.activate(COMMAND_BAR.id);
  }
}
