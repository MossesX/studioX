/**
 * @file The logo-kit catalog — client-safe resolution of a logo by its global
 * id (`lk001-orbit`).
 *
 * The source kits are framework-authored TS, so they are available at build
 * time on both server and client. The catalog runs each through the same
 * `defineLogoKit` validation the generator uses, then indexes every logo by its
 * global id. An asset that references a logo (an `x_landing`, say) resolves it
 * here without reading the installed files — the on-disk asset and this catalog
 * are two renderings of the same source, kept in lock-step by the conformance
 * test.
 */

import { defineLogoKit } from "./define";
import { SOURCE_KITS } from "./kits";
import type { LogoKit, LogoSpec } from "./types";

const KITS: LogoKit[] = SOURCE_KITS.map(defineLogoKit);

const BY_LOGO_ID = new Map<string, { kit: LogoKit; logo: LogoSpec }>();
for (const kit of KITS) {
  for (const logo of kit.logos) BY_LOGO_ID.set(logo.id, { kit, logo });
}

/** Every validated kit. */
export function allLogoKits(): LogoKit[] {
  return KITS;
}

/** One kit by id, or null. */
export function logoKit(id: string): LogoKit | null {
  return KITS.find((k) => k.id === id) ?? null;
}

/** Resolve a logo by its global id (`lk001-orbit`), or null if unknown. */
export function resolveLogo(id: string): LogoSpec | null {
  return BY_LOGO_ID.get(id)?.logo ?? null;
}

/** The kit a logo belongs to, or null. */
export function kitOfLogo(id: string): LogoKit | null {
  return BY_LOGO_ID.get(id)?.kit ?? null;
}
