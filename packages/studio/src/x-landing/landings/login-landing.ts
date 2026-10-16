/**
 * @file The login-landing x_landing (`xl001`) — the landing page, expressed as
 * a landing asset. Its background logo is not hardcoded: it names `lk001-orbit`
 * (the Orbit logo the owner chose from the X Throb kit), which `defineXLanding`
 * verifies resolves. The generator turns this into the real asset.
 *
 * PORTED from GizmoX `src/lib/x-landing/landings/login-landing.ts`
 * (2026-08-15). Same id, same route, same chosen logo — so the two trees
 * describe the same landing.
 */

import type { XLandingInput } from "../types";

export const LOGIN_LANDING: XLandingInput = {
  id: "xl001",
  name: "Login landing",
  version: "0.1.0",
  description:
    "The AmberX login landing — brand banner, a transparent sign-in card, and the pack's animated orbit logo in the background.",
  route: "/login-landing",
  // The studio's front door: `proxy.ts` sends signed-out visitors here rather
  // than to the bare /login screen (owner, 2026-08-15 — "everyone should see
  // the same login landing page"). /login still works and renders the same
  // sign-in card without this chrome.
  role: "login",
  assets: {
    // Switched from lk001-orbit (the mark, rotated in CSS) to the pack's own
    // authored orbit logo — blades around a diamond with a satellite on a real
    // motion path, animation carried in the drawing's own SMIL.
    logo: "lk002-orbit"
  },
  cardOpacity: 0.35
};
