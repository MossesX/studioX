/**
 * @file Messenger theme engine — the 20 preinstalled `MESSENGER_THEMES`
 * (`./contract`, verbatim from the capture) plus the
 * brand-derived background every theme carries.
 *
 * The backgrounds are GENERATED, never authored images: each one tiles the
 * exact GizmoX mark geometry from the branding package (`mark-solid-32` —
 * four rounded bars rotated 45/135/225/315° around a center diamond) in the
 * theme's own palette, baked to a data-URI SVG. Baking is deliberate: a CSS
 * background image can never resolve the live `--gxb-*` role variables (the
 * known `<img>` gotcha), so the pattern derives its colors from the theme it
 * belongs to at build time instead.
 *
 * Pure TS, no React, no node imports — client surfaces and tests import it
 * alike, and the same theme id styles identically everywhere.
 */

import { MESSENGER_THEMES, type MessengerTheme } from "./contract";

export { MESSENGER_THEMES };
export type { MessengerTheme };

/** The theme every profile starts on. */
export const DEFAULT_THEME_ID: string = MESSENGER_THEMES[0].id;

/** Resolve a stored theme id — junk falls back to the default, never crashes. */
export function themeById(id: string | undefined | null): MessengerTheme {
  return MESSENGER_THEMES.find((t) => t.id === id) ?? MESSENGER_THEMES[0];
}

/* ------------------------------ brand pattern --------------------------------- */

/**
 * The GizmoX mark, exactly as the branding package draws it (`mark-solid-32`):
 * four rounded accent bars at 45/135/225/315° around an ink center diamond —
 * re-emitted here with the theme's colors baked in place of the `--gxb-*`
 * roles a data URI cannot resolve.
 */
function markGroup(x: number, y: number, scale: number, accent: string, core: string, opacity: number): string {
  const bar = (deg: number) =>
    `<rect x="62" y="44.5" width="30" height="11" rx="5.5" fill="${accent}" transform="rotate(${deg} 50 50)"/>`;
  return (
    `<g transform="translate(${x} ${y}) scale(${scale})" opacity="${opacity}">` +
    bar(45) + bar(135) + bar(225) + bar(315) +
    `<rect x="41.5" y="41.5" width="17" height="17" rx="4" fill="${core}" transform="rotate(45 50 50)"/>` +
    `</g>`
  );
}

/**
 * A theme's tiled brand background as a CSS `background-image` value — two
 * marks per tile on a half-offset so the lattice reads diagonal, faint by
 * design (chat text always wins). The `gizmox-brand` theme is the loud one:
 * its capture note says "watermarked with the brand pattern background", so
 * it tiles denser and brighter than the rest.
 */
export function themeBackgroundCss(theme: MessengerTheme): string {
  const loud = theme.id === "gizmox-brand";
  const tile = loud ? 96 : 132;
  const scale = (loud ? 0.42 : 0.3) * (tile / 100);
  const opacity = loud ? 0.09 : 0.05;
  const inset = (tile - 100 * scale) / 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile}" viewBox="0 0 ${tile} ${tile}">` +
    markGroup(inset, inset, scale, theme.accent, theme.text, opacity) +
    markGroup(inset + tile / 2, inset + tile / 2, scale, theme.accent, theme.text, opacity * 0.7) +
    markGroup(inset - tile / 2, inset + tile / 2, scale, theme.accent, theme.text, opacity * 0.7) +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/* ------------------------------- type helpers ---------------------------------- */

/** Message font size in px for the settings' three steps. */
export function themeFontPx(fontSize: "small" | "medium" | "large"): number {
  return fontSize === "small" ? 12 : fontSize === "large" ? 15 : 13.5;
}
