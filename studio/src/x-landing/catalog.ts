/**
 * @file The x_landing catalog — client-safe resolution of a landing by id or by
 * the route it serves. The page component reads its landing from here and, for
 * each referenced asset id, resolves the real asset (the logo) through that
 * asset's own catalog.
 */

import { defineXLanding } from "./define";
import { SOURCE_LANDINGS } from "./landings";
import type { XLanding } from "./types";

const LANDINGS: XLanding[] = SOURCE_LANDINGS.map(defineXLanding);

/*
 * At most ONE landing may be the front door. Two would make the gate's
 * destination depend on array order — a coin flip decided by an import, which is
 * the kind of thing that works for months and then reorders during a refactor.
 * Thrown at module load, so it is a build failure and never a runtime surprise.
 */
const LOGIN_LANDINGS = LANDINGS.filter((l) => l.role === "login");
if (LOGIN_LANDINGS.length > 1) {
  throw new Error(
    `x_landing: ${LOGIN_LANDINGS.length} landings claim role "login" ` +
      `(${LOGIN_LANDINGS.map((l) => l.id).join(", ")}) — exactly one may be the studio's front door`
  );
}

export function allXLandings(): XLanding[] {
  return LANDINGS;
}

export function xLanding(id: string): XLanding | null {
  return LANDINGS.find((l) => l.id === id) ?? null;
}

/** The landing served at a given route, or null. */
export function xLandingForRoute(route: string): XLanding | null {
  return LANDINGS.find((l) => l.route === route) ?? null;
}

/**
 * The route the session gate sends signed-out visitors to — the `login` landing
 * if one is declared, otherwise `null` so the caller falls back to the plain
 * `/login` screen.
 *
 * Returning null rather than a default is deliberate: the fallback belongs to
 * `proxy.ts`, which owns the lock-out risk, and a default invented here would
 * hide the absence of a front door instead of surfacing it.
 */
export function loginLandingRoute(): string | null {
  return LOGIN_LANDINGS[0]?.route ?? null;
}
