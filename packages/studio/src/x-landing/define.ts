/**
 * @file `defineXLanding` — the chokepoint for landing-page assets.
 *
 * Same three-layer contract as `defineLogoKit`: a branded type nothing else can
 * produce, runtime validation that throws, and a content signature (in `./sign`)
 * the generator writes and the conformance test recomputes.
 *
 * The one thing special to this type: a landing is defined by REFERENCES to
 * other assets, so `defineXLanding` checks each reference actually RESOLVES.
 * A landing that names a logo id no kit provides is rejected here — a dangling
 * reference is exactly the "renders wrong" failure the asset system exists to
 * make impossible. Client-safe (resolution goes through the logo-kit catalog,
 * which is itself client-safe).
 *
 * PORTED from GizmoX `src/lib/x-landing/define.ts` (2026-08-15); the `@/lib/…`
 * import becomes a relative one, because AmberX has no `@/*` alias on purpose.
 */

import { resolveLogo } from "../logo-kits/catalog";
import { XL_ID_RE, X_LANDING_TYPE, type XLanding, type XLandingInput } from "./types";

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function fail(id: string, msg: string): never {
  throw new Error(`defineXLanding(${id || "?"}): ${msg}`);
}

export function defineXLanding(input: XLandingInput): XLanding {
  const id = input.id;
  if (!XL_ID_RE.test(id)) fail(id, `id must match ${XL_ID_RE} (e.g. xl001), got "${id}"`);
  if (!input.name || input.name.length > 80) fail(id, "name is required and ≤ 80 chars");
  if (!SEMVER_RE.test(input.version)) fail(id, `version must be semver x.y.z, got "${input.version}"`);
  if (!input.description || input.description.length > 400) fail(id, "description is required and ≤ 400 chars");
  if (!input.route || !input.route.startsWith("/")) fail(id, `route must start with "/", got "${input.route}"`);

  const logoId = input.assets?.logo;
  if (!logoId) fail(id, "assets.logo is required (a logo id from a logo kit)");
  if (!resolveLogo(logoId)) fail(id, `assets.logo "${logoId}" does not resolve to any logo in any kit`);

  const cardOpacity = input.cardOpacity ?? 0.35;
  if (typeof cardOpacity !== "number" || cardOpacity < 0 || cardOpacity > 1) {
    fail(id, `cardOpacity must be between 0 and 1, got ${cardOpacity}`);
  }

  const role = input.role ?? "page";
  if (role !== "login" && role !== "page") fail(id, `role must be "login" or "page", got "${role}"`);

  return {
    __brand: "axf.x_landing",
    id,
    name: input.name,
    version: input.version,
    type: X_LANDING_TYPE,
    description: input.description,
    route: input.route,
    role,
    assets: { logo: logoId },
    cardOpacity,
    authored_by: "framework"
  };
}
