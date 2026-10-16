/**
 * @file The "X Throb" logo kit (`lk001`) — the ten X-mark animations authored
 * for the login landing, as a framework input spec.
 *
 * This is the AUTHOR'S input; it is not the asset. The generator
 * (`scripts/gen-logo-kit.mjs`) runs it through `defineLogoKit`, signs it and
 * writes the real asset (manifest + zip + installed dir + registry entry). Each
 * logo names a motion from the motion registry — `defineLogoKit` rejects any
 * that are unknown, so the ten here are guaranteed renderable.
 *
 * PORTED from GizmoX `src/lib/logo-kits/kits/x-throb.ts` (2026-08-15). The ten
 * logos, their slugs, names and motions are unchanged, so `lk001-orbit` means
 * the same logo in both trees.
 */

import type { LogoKitInput } from "../types";

export const X_THROB: LogoKitInput = {
  id: "lk001",
  name: "X Throb",
  version: "0.1.0",
  description:
    "Ten animated treatments of the X mark — orbit, pulse, spin, rock, breathe, bob, heartbeat, coin-flip, glow throb and wobble.",
  logos: [
    { slug: "orbit", name: "Orbit", motion: "orbit", note: "Brand asset's Glitch variant — pieces orbit." },
    { slug: "pulse", name: "Pulse", motion: "pulse", note: "Brand asset's Snap variant — self-builds and pulses." },
    { slug: "spin", name: "Spin", motion: "spin" },
    { slug: "rock", name: "Rock", motion: "rock" },
    { slug: "breathe", name: "Breathe", motion: "breathe" },
    { slug: "bob", name: "Bob", motion: "bob" },
    { slug: "heartbeat", name: "Heartbeat", motion: "heartbeat" },
    { slug: "flip", name: "Coin flip", motion: "flip" },
    { slug: "glow", name: "Glow throb", motion: "glow" },
    { slug: "wobble", name: "Wobble", motion: "wobble" }
  ]
};
