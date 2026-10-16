"use client";

/**
 * @file AmberX Vid branded loading sequence — plays on EVERY load of the
 * module for a uniform-random 7–12 s (`LOADING_SEQUENCE`), before the module
 * login: animated GizmoX mark + lockup, an eased multi-segment progress bar
 * with shimmer and particle accents, and rotating status lines underneath.
 *
 * Honest-theater rule (explicit user directive): the status lines are
 * cosmetic staging — they rotate pseudo-randomly and never claim data work
 * the module didn't do. The account snapshot is genuinely fetched in parallel
 * by the entry orchestrator while this plays.
 *
 * Every animation scales with the module's `appearance.animationIntensity`
 * knob (off / subtle / full / maximum) and `prefers-reduced-motion` always
 * wins: reduced motion gets a static mark and a plain linear fill, nothing
 * moving beyond the bar itself.
 *
 * PORT NOTE (GizmoX → AmberX, per the 2026-08-13 port record in PLANNING-STATE.md): GizmoX's logo kit
 * (`GizmoXKit` — `GizmoXMark` / `GizmoXMarkAnimated` / `GizmoXLockup`) did
 * not port; the local shims below render the AmberX branding pack's `mark`,
 * `spinner` and `lockup` glyphs through `Glyph` from `@axf/core`, keeping the
 * call sites verbatim. `glow` / `ring` / `variant` / `sub` are accepted and
 * ignored — the pack recolours and animates itself from the theme roles.
 */

import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { Glyph } from "@axf/core";
import { GX, gxa } from "./kit/gx";
import { LOADING_SEQUENCE } from "./lib/contract";
import { AMBERXVID_ASSET_ID, useEffectiveValues } from "./settings";

/* ── the GizmoXKit shims (see the PORT NOTE in the docblock) ─────────────── */

export function GizmoXMark({ size = 96 }: { size?: number; glow?: boolean; ring?: string; accent?: string }) {
  return <Glyph id="mark" size={size} />;
}

export function GizmoXMarkAnimated({ size = 96 }: { size?: number; variant?: "Snap" | "Glitch"; accent?: string }) {
  return <Glyph id="spinner" size={size} />;
}

export function GizmoXLockup({ mark = 34 }: { mark?: number; sub?: boolean; accent?: string }) {
  // `Glyph` size is the WIDTH; the GizmoX prop was the mark HEIGHT inside the
  // lockup. ×4 approximates the old footprint — drift accepted per the 2026-08-13 port record in PLANNING-STATE.md.
  return <Glyph id="lockup" size={mark * 4} />;
}

export type AnimationIntensity = "off" | "subtle" | "full" | "maximum";

/** The module-wide intensity: the settings knob, floored by reduced-motion. */
export function useAnimationIntensity(): AnimationIntensity {
  const values = useEffectiveValues(AMBERXVID_ASSET_ID);
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const raw = String(values["appearance.animationIntensity"] ?? "full");
  if (reduced) return "off";
  return raw === "off" || raw === "subtle" || raw === "maximum" ? (raw as AnimationIntensity) : "full";
}

/** [time01, progress01] waypoints — the multi-segment fill's spine. */
type Waypoint = [number, number];

function makeWaypoints(): Waypoint[] {
  // 5 segments of uneven speed with a mid-sequence stall — the "working hard"
  // shape. Randomized a little per load so two loads never fill identically.
  const jitter = (v: number, by: number) => Math.min(0.98, Math.max(0.02, v + (Math.random() - 0.5) * by));
  return [
    [0, 0],
    [jitter(0.18, 0.06), jitter(0.31, 0.08)],
    [jitter(0.42, 0.06), jitter(0.52, 0.08)],
    [jitter(0.55, 0.04), jitter(0.57, 0.03)], // the stall
    [jitter(0.78, 0.05), jitter(0.86, 0.06)],
    [1, 1],
  ];
}

const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function progressAt(t01: number, points: Waypoint[]): number {
  if (t01 <= 0) return 0;
  if (t01 >= 1) return 1;
  for (let i = 1; i < points.length; i++) {
    const [t1, p1] = points[i];
    const [t0, p0] = points[i - 1];
    if (t01 <= t1) {
      const local = (t01 - t0) / Math.max(1e-6, t1 - t0);
      return p0 + (p1 - p0) * easeInOutCubic(local);
    }
  }
  return 1;
}

interface Particle {
  left: number; // %
  size: number; // px
  delay: number; // s
  duration: number; // s
}

const PARTICLE_COUNT: Record<AnimationIntensity, number> = { off: 0, subtle: 5, full: 14, maximum: 26 };

export default function Splash({ onDone }: { onDone: () => void }) {
  const intensity = useAnimationIntensity();

  // Duration, waypoints, line order and particles are all picked on mount
  // (never during render — this surface is SSR'd by the standalone host).
  const [plan, setPlan] = React.useState<{
    durationMs: number;
    points: Waypoint[];
    lineOrder: number[];
    particles: Particle[];
  } | null>(null);
  const [progress, setProgress] = React.useState(0);
  const [lineIx, setLineIx] = React.useState(0);

  React.useEffect(() => {
    const { min, max } = LOADING_SEQUENCE.durationS;
    const durationMs = (min + Math.random() * (max - min)) * 1000;
    const order = LOADING_SEQUENCE.lines.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const particles: Particle[] = Array.from({ length: PARTICLE_COUNT.maximum }, () => ({
      left: Math.random() * 100,
      size: 2 + Math.random() * 4,
      delay: Math.random() * 4,
      duration: 3 + Math.random() * 5,
    }));
    setPlan({ durationMs, points: makeWaypoints(), lineOrder: order, particles });
  }, []);

  // The clock — rAF progress through the eased segments, then onDone once.
  const doneRef = React.useRef(false);
  const onDoneRef = React.useRef(onDone);
  onDoneRef.current = onDone;
  React.useEffect(() => {
    if (!plan) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const t01 = (now - t0) / plan.durationMs;
      setProgress(progressAt(t01, plan.points));
      if (t01 >= 1) {
        if (!doneRef.current) {
          doneRef.current = true;
          onDoneRef.current();
        }
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [plan]);

  // Rotating status lines (≥200 ms interval, cleared on unmount).
  React.useEffect(() => {
    if (!plan) return;
    const id = setInterval(() => setLineIx((i) => i + 1), 1150);
    return () => clearInterval(id);
  }, [plan]);

  const line = plan
    ? LOADING_SEQUENCE.lines[plan.lineOrder[lineIx % plan.lineOrder.length]]
    : LOADING_SEQUENCE.lines[0];
  const pct = Math.round(progress * 100);
  const animated = intensity !== "off";
  const particles = plan ? plan.particles.slice(0, PARTICLE_COUNT[intensity]) : [];

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 3.5,
        bgcolor: GX.page,
        "@keyframes axvFloat": {
          "0%": { transform: "translateY(12px)", opacity: 0 },
          "20%": { opacity: 0.5 },
          "100%": { transform: "translateY(-72vh)", opacity: 0 },
        },
        "@keyframes axvShimmer": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(260%)" },
        },
        "@keyframes axvBreathe": {
          "0%, 100%": { opacity: 0.5 },
          "50%": { opacity: 1 },
        },
      }}
    >
      {/* Particle accents — pure decoration, count scaled by intensity. */}
      {animated &&
        particles.map((p, i) => (
          <Box
            key={i}
            sx={{
              position: "absolute",
              bottom: -8,
              left: `${p.left}%`,
              width: p.size,
              height: p.size,
              borderRadius: "50%",
              bgcolor: GX.accent,
              opacity: 0,
              pointerEvents: "none",
              animation: `axvFloat ${p.duration}s linear ${p.delay}s infinite`,
            }}
          />
        ))}

      {/* The branded lockup pair — animated mark unless motion is off. */}
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
        {animated ? (
          <GizmoXMarkAnimated size={intensity === "maximum" ? 148 : 120} variant="Snap" />
        ) : (
          <GizmoXMark size={120} glow={false} />
        )}
        <GizmoXLockup mark={34} sub={false} />
        <Typography
          sx={{
            fontFamily: GX.mono,
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: "0.55em",
            color: GX.ink,
            textTransform: "uppercase",
            pl: "0.55em", // optically recenter the tracked-out text
          }}
        >
          AmberX Vid
        </Typography>
        {/* P14 — the platform's identity, not the 2026-08-03 recorder's. The
            suite stopped being a recording tool with a messenger bolted on the
            day it moved onto the accounts module: it is a wall, a feed, albums,
            group chats, calls, rooms and broadcasts, and the recorder is now
            one surface of ten. A splash that still says "video recording suite"
            tells every member the wrong thing about what they just opened. */}
        <Typography sx={{ fontFamily: GX.mono, fontSize: 10, letterSpacing: "0.3em", color: GX.dim }}>
          SOCIAL VIDEO PLATFORM
        </Typography>
      </Box>

      {/* The eased multi-segment progress bar. */}
      <Box sx={{ width: "min(460px, 72vw)", display: "flex", flexDirection: "column", gap: 1.25 }}>
        <Box
          sx={{
            position: "relative",
            height: 8,
            borderRadius: 4,
            bgcolor: GX.panel2,
            border: `1px solid ${GX.edge}`,
            overflow: "hidden",
          }}
        >
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              width: `${progress * 100}%`,
              borderRadius: 4,
              background: `linear-gradient(90deg, ${gxa(GX.accent, "66")}, ${GX.accent})`,
              boxShadow: animated ? `0 0 12px ${gxa(GX.accent, "88")}` : "none",
            }}
          />
          {/* Segment ticks at the plan's waypoints. */}
          {plan?.points.slice(1, -1).map(([, p], i) => (
            <Box
              key={i}
              sx={{
                position: "absolute",
                left: `${p * 100}%`,
                top: 0,
                bottom: 0,
                width: "1px",
                bgcolor: GX.edge,
                opacity: 0.8,
              }}
            />
          ))}
          {/* Shimmer sweep — full/maximum only. */}
          {(intensity === "full" || intensity === "maximum") && (
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                width: "38%",
                background: `linear-gradient(90deg, transparent, ${gxa(GX.ink, "22")}, transparent)`,
                animation: "axvShimmer 1.6s ease-in-out infinite",
              }}
            />
          )}
        </Box>
        <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <Typography
            sx={{
              fontFamily: GX.mono,
              fontSize: 11,
              color: GX.dim,
              ...(animated ? { animation: "axvBreathe 2.3s ease-in-out infinite" } : {}),
            }}
          >
            {line}
          </Typography>
          <Typography sx={{ fontFamily: GX.mono, fontSize: 11, color: GX.accent, fontVariantNumeric: "tabular-nums" }}>
            {pct}%
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
