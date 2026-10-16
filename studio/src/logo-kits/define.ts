/**
 * @file `defineLogoKit` — the ONE chokepoint every logo kit passes through.
 *
 * Per the enforcement doctrine in GizmoX's `.claude/rules/asset-types.md` ("How
 * a sui rule is enforced"): a kit is not trusted because someone was careful, it
 * is trusted because it could not have been made any other way. Three layers:
 *
 *   1. Compile time — `LogoKit` carries a `__brand` only this function writes,
 *      so a hand-authored object literal does not typecheck where a kit is
 *      required.
 *   2. Runtime — this function throws, naming the kit and the exact breach, on
 *      every constraint (id format, ≤40 logos, unique slugs, prefixed ids,
 *      known motion, static/animated agreement).
 *   3. On disk — `kitSignature` (see `./sign`) fingerprints the kit's content;
 *      the generator writes it into the manifest and the conformance test
 *      recomputes it, so a hand-edited installed kit is caught.
 *
 * Client-safe (no node imports): the login landing resolves logo ids on the
 * client through the catalog, which validates through this same function.
 *
 * PORTED from GizmoX `src/lib/logo-kits/define.ts` (2026-08-15), unchanged but
 * for the brand string.
 */

import {
  KIT_ID_RE,
  LOGO_SLUG_RE,
  LOGO_KIT_TYPE,
  MAX_LOGOS_PER_KIT,
  type LogoKit,
  type LogoKitInput,
  type LogoSpec
} from "./types";
import { MOTIONS, isMotionId } from "./motions";

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function fail(kitId: string, msg: string): never {
  throw new Error(`defineLogoKit(${kitId || "?"}): ${msg}`);
}

/** Validate an input kit and return the branded, resolved asset. */
export function defineLogoKit(input: LogoKitInput): LogoKit {
  const id = input.id;
  if (!KIT_ID_RE.test(id)) fail(id, `kit id must match ${KIT_ID_RE} (e.g. lk001), got "${id}"`);
  if (!input.name || input.name.length > 80) fail(id, "name is required and ≤ 80 chars");
  if (!SEMVER_RE.test(input.version)) fail(id, `version must be semver x.y.z, got "${input.version}"`);
  if (!input.description || input.description.length > 400) fail(id, "description is required and ≤ 400 chars");

  const logos = input.logos ?? [];
  if (logos.length < 1) fail(id, "a kit needs at least one logo");
  if (logos.length > MAX_LOGOS_PER_KIT) {
    fail(id, `a kit may hold at most ${MAX_LOGOS_PER_KIT} logos, got ${logos.length}`);
  }

  const seenSlug = new Set<string>();
  const resolved: LogoSpec[] = logos.map((l) => {
    if (!LOGO_SLUG_RE.test(l.slug)) fail(id, `logo slug "${l.slug}" must match ${LOGO_SLUG_RE}`);
    if (seenSlug.has(l.slug)) fail(id, `duplicate logo slug "${l.slug}" — slugs are unique within a kit`);
    seenSlug.add(l.slug);
    if (!l.name || l.name.length > 60) fail(id, `logo "${l.slug}": name is required and ≤ 60 chars`);
    if (!isMotionId(l.motion)) fail(id, `logo "${l.slug}": unknown motion "${l.motion}" — not in the motion registry`);
    if (l.note && l.note.length > 200) fail(id, `logo "${l.slug}": note ≤ 200 chars`);
    const motion = MOTIONS[l.motion];
    return {
      id: `${id}-${l.slug}`,
      slug: l.slug,
      name: l.name,
      kind: motion.animated ? "animated" : "static",
      motion: l.motion,
      ...(l.note ? { note: l.note } : {})
    };
  });

  return {
    __brand: "axf.logo_kit",
    id,
    name: input.name,
    version: input.version,
    type: LOGO_KIT_TYPE,
    description: input.description,
    authored_by: "framework",
    logos: resolved
  };
}
