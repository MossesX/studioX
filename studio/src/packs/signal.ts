/**
 * @file **Signal** — a branding pack and a logo pack.
 *
 * (`SIGNAL_STYLE`, the style package that bundled and overrode these two, died
 * with the style-package kind on 2026-08-12 — packs are drawings now.)
 *
 * Lineage: the palette is GizmoX's shipped brand palette, unchanged. That makes
 * Signal the compatibility reference — a GizmoX pack and this one paint the same
 * colours, so anything that renders correctly under one renders correctly under
 * the other.
 */
import type { BrandingPackage, BrandPalette, LogoPackage } from "@axf/core";

import { buildIcons, buildSpinner, buildWatermark, buildWordmark, ref, svgDoc } from "./glyph-kit";
import type { Voice } from "./glyph-kit";

/** GizmoX's shipped palette, adopted verbatim — this pack is the compat anchor. */
const PALETTE: BrandPalette = {
  accent: "#ff7a1a",
  accent2: "#4f8ef7",
  accent3: "#b06df7",
  ink: "#f7f2ea",
  dim: "#9c9083",
  edge: "#2a2621",
  page: "#0f0d0b",
  ok: "#3fb27f",
  warn: "#f5a623",
  err: "#e5484d"
};

const VOICE: Voice = {
  stroke: 1.7,
  cap: "round",
  join: "round",
  corner: 3,
  fill: "line",
  primary: "accent",
  secondary: "ink"
};

/** Concentric broadcast arcs over a solid core — the "signal" idea, drawn. */
const MARK_BODY =
  `<circle cx="12" cy="12" r="2.6" fill="${ref(PALETTE, "accent")}"/>` +
  `<path d="M16.2 7.8 A6 6 0 0 1 16.2 16.2" fill="none" stroke="${ref(PALETTE, "accent")}" stroke-width="1.8" stroke-linecap="round"/>` +
  `<path d="M7.8 16.2 A6 6 0 0 1 7.8 7.8" fill="none" stroke="${ref(PALETTE, "accent")}" stroke-width="1.8" stroke-linecap="round"/>` +
  `<path d="M19 5 A9.9 9.9 0 0 1 19 19" fill="none" stroke="${ref(PALETTE, "accent2")}" stroke-width="1.5" stroke-linecap="round" opacity="0.85"/>` +
  `<path d="M5 19 A9.9 9.9 0 0 1 5 5" fill="none" stroke="${ref(PALETTE, "accent2")}" stroke-width="1.5" stroke-linecap="round" opacity="0.85"/>`;

export const SIGNAL_BRANDING: BrandingPackage = {
  id: "axf-signal-brand",
  name: "Signal Brand System",
  version: "0.1.0",
  type: "branding-package",
  description:
    "The compatibility reference pack: GizmoX's shipped palette and role vocabulary, drawn in a " +
    "light line voice. Broadcast arcs over a solid core.",
  author: "AmberX",
  tags: ["branding", "line", "compat"],
  payload: {
    schemaVersion: 1,
    generator: "glyph-kit",
    seed: "axf-signal",
    palette: PALETTE,
    placements: ["toolbar-mark", "nav-rail", "empty-state", "loading", "page-watermark"],
    entries: [
      {
        id: "mark",
        label: "Signal mark",
        category: "mark",
        size: 24,
        shape: "square",
        style: "line",
        tags: ["mark"],
        svg: svgDoc(MARK_BODY)
      },
      buildWatermark(MARK_BODY),
      buildSpinner(VOICE, PALETTE),
      ...buildIcons(VOICE, PALETTE)
    ]
  }
};

export const SIGNAL_LOGOS: LogoPackage = {
  id: "axf-signal-logos",
  name: "Signal Logo Pack",
  version: "0.1.0",
  type: "logo-package",
  description:
    "Wordmark and horizontal lockup for the Signal identity. Separate from the branding pack so " +
    "either can be swapped without the other.",
  author: "AmberX",
  tags: ["logo", "wordmark", "lockup"],
  payload: {
    source: "glyph-kit",
    document: "Signal",
    variants: ["wordmark", "lockup"],
    entries: [
      buildWordmark(VOICE, PALETTE, "AmberX", 5),
      {
        id: "lockup",
        label: "Signal horizontal lockup",
        category: "lockup",
        size: 200,
        shape: "wide",
        tags: ["lockup"],
        svg:
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 32" width="200" height="32" role="img" fill="none">` +
          `<g transform="translate(2 4) scale(1)">${MARK_BODY}</g>` +
          `<text x="34" y="22" font-family="var(--axf-sans, Inter, system-ui, sans-serif)" font-size="19" ` +
          `font-weight="600" fill="${ref(PALETTE, "ink")}">Amber<tspan fill="${ref(PALETTE, "accent")}">X</tspan>` +
          `<tspan font-size="11" fill="${ref(PALETTE, "dim")}" dx="6">STUDIO</tspan></text></svg>`
      }
    ]
  }
};
