/**
 * @file AmberX Vid colour tokens — the `GX` object the ported screens read.
 *
 * PORT NOTE (GizmoX → AmberX, 2026-08-13, per the 2026-08-13 port record in PLANNING-STATE.md): GizmoX's Build
 * Manager kept `GX` as a mutable object of **6-digit hex strings**, swapped in
 * place by `applyVariant` and consumed by string concatenation
 * (`` `${GX.accent}1A` ``). Here every colour is a live theme variable —
 * `token("accent")` → `var(--axf-accent)` — so the object never mutates (the
 * engine repaints the variables instead) and hex-alpha concatenation is
 * impossible. The mechanical transform in every ported file is
 * `` `${GX.x}NN` `` → `gxa(GX.x, "NN")`, which builds the translucent colour
 * with `color-mix()` instead.
 *
 * Key mapping (GizmoX token → AmberX token), judgment calls flagged:
 *   accent→accent, accent2→accent2, accent3→accent3, accent4→accent2 (no
 *   fourth accent here), page→page, bg→page (the hybrid default variant had
 *   page === bg), panel→panel, panel2→panel2, ink→ink, dim→dim, edge→edge,
 *   ok→ok, warn→warn, err→err, info→info, mono→mono, sans→sans.
 * The non-colour chrome knobs (`chrome`, `chromeUpper`, `chromeSpacing`,
 * `size`, `paperBorder`, `rainbow`) keep the GizmoX "hybrid" (DEFAULT_VARIANT)
 * values as constants — variants did not port.
 */

import { token } from "@axf/core";

/** Shape of the token set the ported screens read. Values are CSS colour
 *  strings (theme `var()`s), except the chrome knobs noted below. */
export interface GxTokens {
  accent: string;
  accent2: string;
  accent3: string;
  accent4: string;
  page: string;
  bg: string;
  panel: string;
  panel2: string;
  ink: string;
  dim: string;
  edge: string;
  ok: string;
  warn: string;
  err: string;
  info: string;
  rainbow: string[];
  mono: string;
  sans: string;
  /** Font used for chrome labels/chips/table heads (mono, as in GizmoX's
   *  hybrid variant). */
  chrome: string;
  /** Uppercase + letterspacing on section labels. */
  chromeUpper: "uppercase" | "none";
  chromeSpacing: number;
  /** Base body font size. */
  size: number;
  /** Whether every Paper gets a visible outline. */
  paperBorder: boolean;
}

/** Live token object every ported component reads from. Unlike GizmoX's this
 *  is immutable — the values are `var(--axf-*)` references and the theme
 *  engine repaints the variables themselves. */
export const GX: GxTokens = {
  accent: token("accent"),
  accent2: token("accent2"),
  accent3: token("accent3"),
  accent4: token("accent2"),
  page: token("page"),
  bg: token("page"),
  panel: token("panel"),
  panel2: token("panel2"),
  ink: token("ink"),
  dim: token("dim"),
  edge: token("edge"),
  ok: token("ok"),
  warn: token("warn"),
  err: token("err"),
  info: token("info"),
  rainbow: [token("accent"), token("warn"), token("ok"), token("info"), token("err")],
  mono: token("mono"),
  sans: token("sans"),
  chrome: token("mono"),
  chromeUpper: "uppercase",
  chromeSpacing: 1.5,
  size: 14,
  paperBorder: true
};

/**
 * Translucent colour from a token + a hex alpha byte — the replacement for
 * GizmoX's `` `${GX.x}NN` `` string concatenation, which cannot work on a
 * `var()` value. `gxa(GX.accent, "1A")` ≈ a 10%-opaque accent.
 */
export function gxa(colour: string, alphaByte: string): string {
  const pct = Math.round((parseInt(alphaByte, 16) / 255) * 100);
  return `color-mix(in srgb, ${colour} ${pct}%, transparent)`;
}
