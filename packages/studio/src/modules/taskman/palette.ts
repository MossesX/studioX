/**
 * @file Named accent palette for item colors, list dots and cross-outs —
 * GizmoX's `src/lib/colors.ts`, trimmed to what the task manager uses.
 *
 * These are ITEM colors, not theme tokens: an item painted "teal" stays teal
 * across a theme swap, exactly as it did in GizmoX. Chrome colors come from
 * `token()`; only the user's own color choices live here.
 */

export interface PaletteColor {
  key: string;
  label: string;
  main: string;
  soft: string;
}

export const PALETTE: PaletteColor[] = [
  { key: "orange", label: "Orange", main: "#FF7A1A", soft: "rgba(255,122,26,0.16)" },
  { key: "amber", label: "Amber", main: "#FFB020", soft: "rgba(255,176,32,0.16)" },
  { key: "lime", label: "Lime", main: "#9BE15D", soft: "rgba(155,225,93,0.16)" },
  { key: "green", label: "Green", main: "#34D399", soft: "rgba(52,211,153,0.16)" },
  { key: "teal", label: "Teal", main: "#2DD4BF", soft: "rgba(45,212,191,0.16)" },
  { key: "cyan", label: "Cyan", main: "#22D3EE", soft: "rgba(34,211,238,0.16)" },
  { key: "blue", label: "Blue", main: "#60A5FA", soft: "rgba(96,165,250,0.16)" },
  { key: "violet", label: "Violet", main: "#A78BFA", soft: "rgba(167,139,250,0.16)" },
  { key: "magenta", label: "Magenta", main: "#E879F9", soft: "rgba(232,121,249,0.16)" },
  { key: "pink", label: "Pink", main: "#FB7185", soft: "rgba(251,113,133,0.16)" },
  { key: "red", label: "Red", main: "#F87171", soft: "rgba(248,113,113,0.16)" },
  { key: "slate", label: "Slate", main: "#94A3B8", soft: "rgba(148,163,184,0.16)" }
];

const BY_KEY = new Map(PALETTE.map((c) => [c.key, c]));

/** Resolve a palette key to its colors; unknown keys fall back to orange. */
export function paletteColor(key: string): PaletteColor {
  return BY_KEY.get(key) ?? PALETTE[0];
}
