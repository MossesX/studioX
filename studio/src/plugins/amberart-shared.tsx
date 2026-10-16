"use client";

/**
 * @file The small shims the three AmberArt tool panels needed on the way over.
 *
 * The panels came from GizmoX almost unchanged — they were already MUI — but
 * they leaned on three GizmoX-only things that AmberX deliberately does not
 * have. Rather than rewrite three 300-line panels, each import is answered
 * once, here:
 *
 *   - **`GX.*` tokens** → `token()`. GizmoX's kit exposed a colour object; the
 *     values are the same custom properties, so this is a rename, not a
 *     restyle. Every entry is a `var(--axf-*)` string, so it is resolved by CSS
 *     at paint time and follows the theme — which is the whole reason not to
 *     bake hexes here.
 *   - **`GxChip`** → an MUI `Chip` with the same dense proportions.
 *   - **`useEffectiveValues` + `num`/`str`/`bool`** → nothing. That was
 *     GizmoX's settings cascade (spec → sui → cui override). AmberX has no
 *     registry and no cascade (`amberx-bound-builds.md`: *"a plain surface
 *     reading and writing its own values"*), so each panel now starts from its
 *     engine's own DEFAULTS and the dials on screen ARE the settings. Nothing
 *     is lost: every one of those removed settings was only a starting value
 *     for a slider that is right there in the panel.
 */

import * as React from "react";

import Chip from "@mui/material/Chip";

import { token } from "@axf/core";

/**
 * The colour names the panels use, mapped onto the theme's own properties.
 *
 * Module scope is safe: `token()` returns a `var(--axf-…)` STRING, not a
 * resolved colour, so this is computed once and still repaints on every theme
 * change — the browser resolves it, not us.
 */
export const GX = {
  accent: token("accent"),
  accent2: token("accent2"),
  accent3: token("accent3"),
  bg: token("page"),
  page: token("page"),
  panel: token("panel"),
  panel2: token("panel2"),
  ink: token("ink"),
  dim: token("dim"),
  edge: token("edge"),
  ok: token("ok"),
  warn: token("warn"),
  err: token("err"),
  info: token("info"),
  mono: "var(--axf-mono)",
  sans: "var(--axf-sans)"
} as const;

/**
 * GizmoX's dense chip, as plain MUI.
 *
 * `kind` is the GizmoX prop name and `tone` the one this file would have
 * picked; both are accepted because the panels came over using `kind` and
 * renaming it across three files would be a diff with no reader-visible
 * benefit. `info` is in the vocabulary for the same reason — the panels use it.
 */
export function GxChip({
  label,
  tone,
  kind,
  title
}: {
  label: React.ReactNode;
  tone?: "accent" | "ok" | "warn" | "err" | "dim" | "info";
  /** GizmoX's spelling of `tone`. */
  kind?: "accent" | "ok" | "warn" | "err" | "dim" | "info";
  title?: string;
}) {
  const resolved = tone ?? kind;
  return (
    <Chip
      size="small"
      variant="outlined"
      label={label}
      title={title}
      sx={{
        height: 18,
        fontSize: 10.5,
        fontFamily: "var(--axf-mono)",
        color: resolved ? GX[resolved] : GX.dim
      }}
    />
  );
}
