"use client";

/**
 * @file Minimal local port of GizmoX's `@/modules/buildmgr/GizmoXKit` — ONLY
 * the three brand marks the AmberX Vid screens render. Not covered by
 * the port brief's import tables, so per that brief the missing piece is
 * ported minimally beside the screens.
 *
 * CONSOLIDATION NOTE (2026-08-13, P2): two subagents each wrote a shim for
 * this — `GizmoXKit.tsx` (the `accent` prop, `LogoTheme`) and this file (the
 * animated mark and the lockup). `GizmoXKit.tsx` is DELETED; this file carries
 * the superset. The kebab-case name is the survivor because every other helper
 * in this module is lowercase (`kit/gx.ts`, `lib/contract.ts`), and because on
 * Windows two names this close are a rename hazard.
 *
 * `Splash.tsx` is deliberately NOT an importer: it inlines its own copies of
 * all three shims (`GizmoXMark` / `GizmoXMarkAnimated` / `GizmoXLockup`) and
 * re-exports them, and `AmberXVidModule.tsx`, `ModuleLogin.tsx` and
 * `Toolbar.tsx` import them from there. Splash's copies ignore `accent` and
 * size the lockup at `mark × 4` rather than `× 2.9` — if the two are ever
 * unified, that difference is the thing to reconcile.
 *
 * PORT NOTE (GizmoX → AmberX, 2026-08-13): the originals rendered GizmoX
 * branding-pack assets (`mark-solid-32`, `wordmark-gx`, the animated
 * `anim-logo-*` SMIL logos) through `BrandGlyph` with per-call `roleVars()`
 * recolouring. Here they map to the AmberX branding contract ids through
 * `Glyph` from `@axf/core` — `mark`, `lockup`, `spinner`. Degradations,
 * accepted:
 *   - `accent` sets the wrapper's CSS `color` and tints the glow, so it
 *     reaches anything the drawing paints in `currentColor`; the pack's
 *     role-coloured strokes (`var(--axf-brand-*)`) still follow the theme
 *     engine and are NOT overridden. It defaults to `GX.accent`, so every
 *     existing call site renders exactly as before.
 *   - `theme` / `ring` are accepted and ignored (the pack mark carried its own
 *     core ring; the AmberX glyph has none to tint);
 *   - `GizmoXMarkAnimated`'s "Snap"/"Glitch" variants both render the one
 *     `spinner` asset;
 *   - `GizmoXLockup` renders the contract's single `lockup` drawing instead
 *     of composing mark + wordmark, and the `sub` caption line is dropped.
 */

import * as React from "react";
import { Glyph } from "@axf/core";
import { GX, gxa } from "./kit/gx";

export type LogoTheme = "dark" | "light";

/** Drop-shadow the GizmoX marks carried, over whatever accent is in play. */
function glowFor(size: number, accent: string, min: number, factor: number): React.CSSProperties {
  return { filter: `drop-shadow(0 0 ${Math.max(min, size * factor)}px ${gxa(accent, "59")})` };
}

export interface MarkProps {
  size?: number;
  accent?: string;
  theme?: LogoTheme;
  glow?: boolean;
  /** Kept for API compatibility — the pack mark carries its own core ring. */
  ring?: string;
}

/** Static mark — top bars, buttons, empty states, watermarks. */
export function GizmoXMark({ size = 96, accent = GX.accent, glow = true }: MarkProps) {
  return (
    <Glyph
      id="mark"
      size={size}
      style={{ color: accent, ...(glow ? glowFor(size, accent, 8, 0.12) : {}) }}
    />
  );
}

export interface MarkAnimatedProps {
  size?: number;
  accent?: string;
  theme?: LogoTheme;
  /** GizmoX had "Snap" (pulse) and "Glitch" (orbit); both map to `spinner`. */
  variant?: "Snap" | "Glitch";
  ring?: string;
}

/** Animated mark — loaders, idle heroes. */
export function GizmoXMarkAnimated({ size = 96, accent = GX.accent }: MarkAnimatedProps) {
  return (
    <Glyph id="spinner" size={size} style={{ color: accent, ...glowFor(size, accent, 10, 0.15) }} />
  );
}

export interface LockupProps {
  mark?: number;
  accent?: string;
  theme?: LogoTheme;
  sub?: boolean;
  ring?: string;
}

/** Mark + wordmark lockup — page headers. Sized by the GizmoX `mark` prop:
 *  the original lockup was ~2.9 mark-widths wide, so scale to match. */
export function GizmoXLockup({ mark = 56, accent = GX.accent }: LockupProps) {
  return <Glyph id="lockup" size={Math.round(mark * 2.9)} style={{ color: accent }} />;
}
