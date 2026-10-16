/**
 * @file `x_landing` data model — a landing-page asset type.
 *
 * An **x_landing** is a landing page defined by ASSIGNING OTHER ASSETS to it by
 * their unique id — e.g. the background logo is not drawn inline, it is the
 * `lk001-orbit` logo from a logo kit, named here and resolved at render. That is
 * the whole idea of the type: a landing is a small composition of assets plus a
 * few of its own knobs, not a bespoke page.
 *
 * Types only (no node/DOM) so the page component can import it on the client.
 *
 * PORTED from GizmoX `src/lib/x-landing/types.ts` (2026-08-15); only the brand
 * string moves to AmberX's namespace.
 */

export const X_LANDING_TYPE = "x_landing" as const;
export const X_LANDING_DISPLAY_NAME = "x landing";

/** `xl001` … `xl999`. */
export const XL_ID_RE = /^xl\d{3}$/;

/** The assets a landing composes, each named by unique id. Extensible — a
 *  banner asset, a theme, a background pack could join `logo` here later. */
export interface XLandingAssets {
  /** A logo id from a logo kit, e.g. `lk001-orbit`. */
  logo: string;
}

/**
 * What a landing is FOR.
 *
 * `login` means this landing is the studio's front door: the session gate sends
 * unauthenticated visitors here instead of to the bare `/login` screen. It is
 * declared on the asset rather than hardcoded in `proxy.ts` so the route is
 * spelled once — and so a second landing cannot quietly become the gate, which
 * `defineXLanding` refuses outright.
 */
export type XLandingRole = "login" | "page";

export interface XLandingInput {
  id: string;
  name: string;
  version: string;
  description: string;
  /** The route this landing is served at, e.g. `/login-landing`. */
  route: string;
  /** Defaults to `page`. At most ONE landing may be `login`. */
  role?: XLandingRole;
  assets: XLandingAssets;
  /** Sign-in card opacity, 0 (invisible) … 1 (opaque). Default 0.35. */
  cardOpacity?: number;
}

export interface XLanding {
  readonly __brand: "axf.x_landing";
  id: string;
  name: string;
  version: string;
  type: typeof X_LANDING_TYPE;
  description: string;
  route: string;
  role: XLandingRole;
  assets: XLandingAssets;
  cardOpacity: number;
  authored_by: "framework";
}
