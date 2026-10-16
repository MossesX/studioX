/**
 * @file **The non-module surface inventory** — every UI in the studio that is
 * not a module, as data.
 *
 * The studio's twelve module slots are well-catalogued: the registry knows them,
 * `check:suite` counts them, the nav links them. Everything ELSE — the landing
 * pages, the plugin screens, the chromeless gate, the dialogs — has never had a
 * list, which is why the designer had no way to offer them. This is that list.
 *
 * ## Where each kind comes from, and why none of it is hand-typed
 *
 *   · **landing** — the `x_landing` catalog. These are real ASSETS with ids,
 *     versions and signatures, and they are the only kind here that is fully
 *     editable, because they are the only kind with an authoring engine behind
 *     them.
 *   · **route** — the plugin-owned and chromeless routes, derived by SUBTRACTING
 *     the registered modules' routes from the live route list. Derived rather
 *     than listed, because a hand-kept list of "the non-module screens" is
 *     exactly the thing that silently goes stale — the same rot the `.newx.`
 *     prompt's surface bullet had, and the reason `check:nav` exists at all.
 *   · **dialog** — declared. A dialog is not addressable by URL and cannot be
 *     discovered from the route table, so these carry the component that opens
 *     them and are the one kind that needs a line adding when a new one ships.
 *     That is stated plainly rather than hidden: see `DIALOGS` below.
 *
 * Client-safe and free of node imports, so the designer tab can hold it.
 */

import { allXLandings } from "../x-landing/catalog";

export type SurfaceKind = "landing" | "route" | "dialog";

export interface Surface {
  /** Stable id — an asset id for landings, the route for routes, a slug for dialogs. */
  id: string;
  kind: SurfaceKind;
  name: string;
  /** Where it can be previewed, or null when it has no address of its own. */
  route: string | null;
  summary: string;
  /** True when this surface has an authoring engine and can really be edited. */
  editable: boolean;
  /** Why it cannot be edited, when it cannot — shown instead of dead controls. */
  notEditableWhy?: string;
}

/**
 * Routes owned by a MODULE. Subtracted from the live route list to leave the
 * non-module surfaces.
 *
 * Passed IN rather than imported, so this module stays client-safe and the
 * caller uses whatever module registry it already has — the designer reads the
 * live one, a test can pass a fixture.
 */
export interface RouteFacts {
  /** Every live page route, e.g. from the nav assets or the app directory. */
  live: readonly string[];
  /** The routes registered modules own. */
  moduleRoutes: readonly string[];
}

/**
 * Dialogs, declared.
 *
 * A dialog has no route, so nothing can discover it; adding one here is a real
 * maintenance duty and pretending otherwise would produce a list that lies. Kept
 * deliberately short: only dialogs that are a SURFACE in their own right — a
 * thing with its own layout and chrome — not every confirm box.
 */
const DIALOGS: readonly Surface[] = [
  {
    id: "dialog.new-task-item",
    kind: "dialog",
    name: "New task item",
    route: null,
    summary:
      "The capture dialog the `.newtask.` trigger opens, pre-filled with the captured text. Opened by the Task Manager module and by the app's Claude composer.",
    editable: false,
    notEditableWhy: "A dialog is drawn by its module and has no asset behind it — nothing here can author it."
  },
  {
    id: "dialog.claude-projects",
    kind: "dialog",
    name: "Claude projects manager",
    route: null,
    summary:
      "The Claude workspace's project manager: bound working directory, instructions, knowledge files and default model/effort/permission.",
    editable: false,
    notEditableWhy: "A dialog is drawn by its module and has no asset behind it — nothing here can author it."
  }
];

/** Human names for the non-module routes, so the list reads as screens rather
 *  than as paths. A route with no entry falls back to its own path. */
const ROUTE_NAMES: Record<string, string> = {
  "/login": "Sign in (chromeless gate)",
  "/brand": "Brand gallery",
  "/settings": "Settings",
  "/plugins": "Plugin Manager",
  "/docs": "Documentation",
  "/diff": "Diff browser",
  "/project-state": "Project state",
  "/theme-designer": "Theme designer",
  "/status": "Boot status",
  "/mui-probe": "MUI probe",
  "/sandbox/panes": "Pane probe"
  // `/login-landing/gallery` was here until 2026-08-16. The route is deleted —
  // the asset browser's live previews supersede it — and a name for a route
  // that does not exist is a row this list would draw for nothing.
};

/**
 * Every non-module surface, newest concept first: landings (editable), then the
 * routes plugins own, then the declared dialogs.
 */
export function surfaceInventory(facts: RouteFacts): Surface[] {
  const landings: Surface[] = allXLandings().map((l) => ({
    id: l.id,
    kind: "landing",
    name: l.name,
    route: l.route,
    summary:
      `${l.description} Composed from asset ids: logo ${l.assets.logo}.` +
      (l.role === "login" ? " This is the studio's front door — the session gate redirects here." : ""),
    editable: true
  }));

  const landingRoutes = new Set(landings.map((l) => l.route));
  const modules = new Set(facts.moduleRoutes);

  const routes: Surface[] = facts.live
    .filter((r) => !modules.has(r) && !landingRoutes.has(r) && r !== "/")
    .sort()
    .map((r) => ({
      id: r,
      kind: "route" as const,
      name: ROUTE_NAMES[r] ?? r,
      route: r,
      summary: `A plugin-owned screen at ${r}. It holds no module slot.`,
      editable: false,
      notEditableWhy:
        "A plugin screen is built from components, not from an asset — there is no authoring engine to edit it through. " +
        "Its colours come from the theme, so the Dials tab already governs how it looks."
    }));

  return [...landings, ...routes, ...DIALOGS];
}
