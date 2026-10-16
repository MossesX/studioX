/**
 * @file `kitSignature` — the on-disk fingerprint of a logo kit (node-only).
 *
 * Split from `define.ts` so that file stays client-safe. The generator writes
 * this into the manifest; the conformance test recomputes it. A changed logo,
 * motion, name or id changes the signature; whitespace and key order do not.
 *
 * PORTED from GizmoX `src/lib/logo-kits/sign.ts` (2026-08-15), verbatim.
 */

import crypto from "node:crypto";

import type { LogoKit } from "./types";

export function kitSignature(kit: LogoKit): string {
  const canon = {
    id: kit.id,
    name: kit.name,
    version: kit.version,
    type: kit.type,
    description: kit.description,
    logos: kit.logos.map((l) => [l.id, l.slug, l.name, l.kind, l.motion, l.note ?? ""])
  };
  return "sha256:" + crypto.createHash("sha256").update(JSON.stringify(canon)).digest("hex");
}
