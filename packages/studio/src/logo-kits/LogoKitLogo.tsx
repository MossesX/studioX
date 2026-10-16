"use client";

/**
 * @file `LogoKitLogo` — the studio-owned renderer for a single logo-kit logo.
 *
 * Give it a resolved {@link LogoSpec} and it draws the brand mark with that
 * logo's motion. It is the only thing that knows how a motion becomes pixels,
 * which is why a kit can be pure data: the tutorial-player pattern, applied to
 * logos.
 *
 * A `css` motion's keyframe text (from the motion registry) is turned into a
 * scoped emotion keyframe; the accent is passed in as the `--lk-accent` custom
 * property so the motion text itself carries no colour.
 *
 * ## PORT NOTE (GizmoX → AmberX, 2026-08-15)
 *
 * Two things changed and both are load-bearing:
 *
 *  1. **The marks come from AmberX's branding contract**, through
 *     `src/modules/amberxvid/gizmox-kit.tsx` (`Glyph` ids `mark` / `spinner`),
 *     not GizmoX's `@/modules/buildmgr/GizmoXKit`. GizmoX is a build
 *     environment here, never a runtime dependency.
 *  2. **`brand-smil` motions get their `fallbackCss` applied.** AmberX's
 *     `GizmoXMarkAnimated` renders the same `spinner` glyph for both the "Snap"
 *     and "Glitch" variants, so a verbatim port would make `lk001-orbit` and
 *     `lk001-pulse` identical — see the long note in `./motions`. Wrapping the
 *     animated glyph in the motion's own fallback keyframe keeps them distinct
 *     until the pack grows real animated drawings, at which point deleting
 *     `fallbackCss` from the two motions is the whole revert.
 *
 * `accent` defaults to the branding kit's own accent rather than being
 * hardcoded, so the logo recolours with the theme like every other AmberX
 * surface.
 */

import * as React from "react";
import Box from "@mui/material/Box";
import { keyframes } from "@mui/system";
import { Glyph } from "@axf/core";

import { GizmoXMark, GizmoXMarkAnimated } from "../modules/amberxvid/gizmox-kit";
import { GX } from "../modules/amberxvid/kit/gx";
import { MOTIONS, drawingFor, type Motion } from "./motions";
import type { LogoSpec } from "./types";

export interface LogoKitLogoProps {
  logo: LogoSpec;
  size?: number;
  accent?: string;
  theme?: "dark" | "light";
}

export function LogoKitLogo({ logo, size = 130, accent = GX.accent, theme = "dark" }: LogoKitLogoProps) {
  const motion = MOTIONS[logo.motion] ?? MOTIONS.none;
  const { drawing, glyphId, css } = drawingFor(motion);

  /*
   * A `pack` motion IS a finished animated logo from the branding pack — the
   * movement lives in the drawing's own SMIL. Render it and add nothing: the
   * pack's drawings paint in `var(--gxb-*)` / `var(--axf-brand-*)`, so it still
   * recolours with the theme without the accent being forced over it.
   */
  if (drawing === "pack" && glyphId) {
    return <Glyph id={glyphId} size={size} />;
  }

  // `animated-mark` maps to the branding contract's `spinner` glyph in AmberX,
  // so it is reserved for a pack that ships a real per-variant animated drawing.
  // Today nothing selects it — see `drawingFor` for the bug that taught us why.
  if (drawing === "animated-mark") {
    return <GizmoXMarkAnimated size={size} accent={accent} theme={theme} variant={motion.variant ?? "Snap"} />;
  }

  const mark = <GizmoXMark size={size} accent={accent} theme={theme} glow={false} />;
  if (!css) return mark;

  return (
    <MotionWrap css={css} motion={motion} accent={accent}>
      {mark}
    </MotionWrap>
  );
}

/** Wraps `children` in the scoped keyframe animation a motion describes. Split
 *  out because both the `css` engine and the `brand-smil` fallback need it. */
function MotionWrap({
  css,
  motion,
  accent,
  children
}: {
  css: string;
  motion: Motion;
  accent: string;
  children: React.ReactNode;
}) {
  const kf = React.useMemo(() => keyframes`${css}`, [css]);
  return (
    <Box
      sx={{
        display: "inline-grid",
        placeItems: "center",
        transformOrigin: "center",
        "--lk-accent": accent,
        ...(motion.needs3d ? { perspective: "700px" } : {})
      }}
    >
      <Box
        sx={{
          display: "inline-grid",
          placeItems: "center",
          transformOrigin: "center",
          animation: `${kf} ${motion.durationMs}ms ${motion.easing} infinite`,
          ...(motion.needs3d ? { transformStyle: "preserve-3d" } : {})
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
