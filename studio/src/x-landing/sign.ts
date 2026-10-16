/**
 * @file `landingSignature` — the on-disk fingerprint of an x_landing (node-only).
 * Split from `define.ts` so that stays client-safe.
 *
 * PORTED from GizmoX `src/lib/x-landing/sign.ts` (2026-08-15), verbatim.
 */

import crypto from "node:crypto";

import type { XLanding } from "./types";

export function landingSignature(l: XLanding): string {
  const canon = {
    id: l.id,
    name: l.name,
    version: l.version,
    type: l.type,
    description: l.description,
    route: l.route,
    role: l.role,
    assets: l.assets,
    cardOpacity: l.cardOpacity
  };
  return "sha256:" + crypto.createHash("sha256").update(JSON.stringify(canon)).digest("hex");
}
