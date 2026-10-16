/**
 * @file The one shell mount for the whole app.
 *
 * Mounted by `app/layout.tsx`, so EVERY route — the index, the plugin routes,
 * the module routes, the sandbox — renders inside the same chrome: style root,
 * app crash boundary, banner toolbar, nav menu. This is what makes `:3200` a
 * full development server rather than a set of pages that each remember (or
 * forget) their own chrome — the navbar-missing-on-`/` bug was exactly that
 * forgetting.
 *
 * Two kinds of route are not app surfaces and do not get the chrome: every
 * `x_landing` asset's declared route (a landing owns the whole viewport and
 * draws its own banner — asked of the catalog, never listed here), and `/login`,
 * the
 * screen drawn in front of the app for somebody it has not identified yet. The
 * branch is here rather than in the route because the shell is what mounts the
 * chrome, so the shell is the only place that can decline to;
 * `./ChromelessShell` carries the full argument.
 *
 * Boot runs at module scope on both runtimes for the same reason it does in
 * `BootedHost`: the registry is per-runtime, and the shell reads it (nav menu,
 * banner candidates) before any effect could populate it.
 *
 * **MUI (2026-08-10, P3): this file renders no element of its own, and that is
 * the finding rather than an omission.** P3 rebuilt the shell chrome on MUI and
 * this component needed no edit, because every piece of chrome it composes is
 * somebody else's — `AppShell` mounts the style root, the MUI provider, the
 * banner and the nav; `ShellOverlays` owns the menu, palette and toast;
 * `DashboardChrome` owns the wrapper. A shell mount with nothing to convert is
 * what a delegation chain looks like when it is intact, and `check:ui` verifies
 * that chain at each link's source rather than trusting this file's shape.
 */
"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { AppShell, DashboardChrome } from "@axf/core";

import AssistantHost from "./AssistantHost";
import ChromelessShell from "./ChromelessShell";
import { boot } from "./boot";
import ChromeEditBar from "./modules/accounts/ChromeEditBar";
import { ChromeEditingBridge } from "./modules/accounts/lib/chromeEditing";
import { LOGIN_PATH } from "./modules/accounts/lib/publicPaths";
import { accountsStore } from "./modules/accounts/store";
import { loginLandingRoute, xLandingForRoute } from "./x-landing/catalog";
import ArchiveDialog from "./modules/taskman/ArchiveDialog";
import NewItemDialog from "./modules/taskman/NewItemDialog";
import BmpxSync from "./plugins/bmpx-taskman/BmpxSync";
import ModulesSync from "./plugins/modules-taskman/ModulesSync";
import { COMMAND_BAR_FILLS, ShellOverlays } from "./toolbars/CommandBarChrome";

// Module scope: once per bundle evaluation, before the first render.
void boot();

/*
 * The front door, handed to the accounts store at the same moment.
 *
 * `proxy.ts` already sends signed-out NAVIGATIONS to the `login`-role landing.
 * The other half of the same journey is a session that dies under a page that
 * is already open, and that bounce is the store's — so the shell, which is the
 * one thing that imports both the landing catalog and the store, tells it where
 * to go. The landing's own `route` field stays the single spelling: nothing
 * here, and nothing in the store, names `/login-landing`.
 *
 * Registered rather than imported by the store on purpose (see its
 * `#frontDoor`): if the landing is deleted, has its role removed, or the store
 * is peeled away from this shell, nothing registers and the bounce falls back
 * to `/login` — which has always worked and renders the same sign-in card.
 */
accountsStore.setFrontDoor(loginLandingRoute());

export default function StudioShell({ children }: { children: ReactNode }) {
  /**
   * The ONE route that does not get the chrome — see `./ChromelessShell` for
   * why the login screen is an exception to the every-route-renders-the-shell
   * directive rather than a hole in it.
   *
   * `usePathname` resolves during the server render as well as in the browser
   * (it reads the router context, not `window`), so the two agree and there is
   * no frame in which the banner and the nav appear over the login screen and
   * then vanish. Comparing against `LOGIN_PATH` rather than a literal keeps the
   * route spelled once, in the module the gate reads it from.
   */
  const pathname = usePathname();
  if (pathname === LOGIN_PATH) return <ChromelessShell>{children}</ChromelessShell>;

  /*
   * ...and every `x_landing` route, for the same reason rather than a second
   * exception. A landing page IS a full-viewport composition — it declares its
   * own banner and owns the window — so the studio's banner, nav and tab bar
   * rendering behind it is not a layout nuance, it is two chromes on one screen.
   * Asking the catalog instead of listing routes here means the next landing
   * asset is chromeless the day it is authored, with no edit to the shell: the
   * asset's `route` field is the single spelling.
   */
  if (xLandingForRoute(pathname)) return <ChromelessShell>{children}</ChromelessShell>;

  return (
    // The banner fills are the command bar's live content (clock, sync line,
    // dock chip); the overlays are what its commands summon (menu, palette,
    // toast). Both are position-neutral: fills land in the bar's own slots,
    // overlays render fixed, so mounting them here costs the layout nothing.
    <AppShell banner={COMMAND_BAR_FILLS}>
      <ShellOverlays />
      {/* The dock/float engine's host half (P8): installs the per-user kv
          adapter core's engine persists through, registers the
          `accounts.administrator` settings gate, and keeps core's two mode
          switches in step with this user's settings and role. Renders nothing,
          and does nothing at all while both switches are off — which is their
          default. Mounted here rather than by the accounts module because the
          chrome it governs is on every route, including the ones accounts is
          nowhere near. */}
      <ChromeEditingBridge />
      {/* The edit-mode strip, and the reset that works when a panel's own
          handle has been dragged somewhere awkward. Renders null unless a mode
          is on, and is mounted at the shell for the reason the bridge is: the
          chrome it explains is on every route. */}
      <ChromeEditBar />
      {/* Build Manager → Task Manager. Renders nothing, and does nothing at all
          unless a `taskman` module is registered — it checks the registry
          rather than assuming. Mounted at the shell so build steps tick off
          while you are watching the Build Manager, not only while the Task
          Manager happens to be on screen. */}
      <BmpxSync />
      {/* Installed modules → Task Manager (2026-08-14): one empty list per
          registered module under the rail's Modules group. Mounted beside its
          Build Manager sibling and inert for the same two reasons — no taskman,
          nothing to do; the setting off, nothing to do. It does not poll: the
          registry says when it changed. */}
      <ModulesSync />
      {/* The Task Manager's capture dialog (2026-08-13), mounted here for the
          reason its own docblock gives: `.newtask.` is typed in the CLAUDE
          workspace, which is a route that has nothing to do with the Task
          Manager. A dialog mounted by the module would not exist at the moment
          it is asked for. It renders null until the event fires, so the cost of
          having it everywhere is one listener. */}
      <NewItemDialog />
      {/* The archived-lists dialog (2026-08-14), mounted here for the same
          reason: a list can be deleted from a floating window on any route, and
          the way back has to exist wherever the way out does. Renders null
          until "Archived lists…" fires. */}
      <ArchiveDialog />
      {/* The Module Assistant's floating chat window (2026-08-13) — the shell
          mounts whatever contributed to `studio.assistant`, on every route,
          because "help with whatever is on screen" only works if the window
          exists wherever a screen does. Renders null until toggled. */}
      <AssistantHost />
      {/* The dashboard WRAPPER, mounted once for every route.
       *
       * It used to be mounted by the `dashboard` module, which the v0.3.0 P0
       * strip archived and deleted — leaving `dash-amberx-console` registered
       * with nothing to render it. Rehoming it here rather than into whichever
       * module lands next is the same correction the banner and the nav already
       * got on 2026-08-08: chrome that every route should have belongs to the
       * shell, because a per-module mount is a mount a module can forget.
       *
       * Position is load-bearing and matches `DashboardChrome`'s contract: it
       * sits INSIDE `AppShell` (so the banner and `NavShell` stay outside the
       * wrapper and no wrapper can drop them) and OUTSIDE the page content (so
       * the wrapper's chrome frames the screen). With no wrapper resolved it
       * renders its children untouched, so this is inert rather than risky
       * while the registry holds one wrapper. */}
      <DashboardChrome>{children}</DashboardChrome>
    </AppShell>
  );
}
