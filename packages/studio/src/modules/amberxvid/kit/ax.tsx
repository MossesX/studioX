"use client";

/** AmberX shared UI kit, ported from GizmoX's `modules/buildmgr/ax.tsx` for
 *  the amberxvid module. Every ported screen builds from these so the module
 *  reads as one app. Colours come from `./gx` (theme `var()`s); hex-alpha
 *  concats from the original are `gxa()` calls here — see `./gx`. */

import * as React from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { ExpandMore as ExpandMoreIcon } from "./icons";
import { ChevronRight as ChevronRightIcon } from "./icons";
import { GX, gxa } from "./gx";

/* ---------------- toast ----------------
 * Re-exported from `./Toast`, where the provider lives. Kept here so ported
 * `@/modules/buildmgr/ax` importers are unaffected. */
export { ToastProvider, useToast, useOptionalToast } from "./Toast";
export type { ToastFn } from "./Toast";

/* ---------------- location-aware context menu ----------------
 * PORT NOTE (accepted degradation, recorded in the 2026-08-13 port record in PLANNING-STATE.md): GizmoX's `useCtx`
 * rendered an imperative MUI Menu wired into the shell's dock/layout context
 * entries. AmberX context menus are declared data owned by the shell — a
 * module cannot imperatively open one — so the opener returned here is a
 * NO-OP and `ctxMenu` renders nothing. A right-click on a ported screen falls
 * through to the shell's default menu. Module-declared rows come later. The
 * `CtxItem` type stays intact because the screens still build item arrays. */
export type CtxItem =
  | "---"
  | { label: string; danger?: boolean; sub?: CtxItem[]; onClick?: () => void };

export function useCtx(): {
  openCtx: (e: React.MouseEvent, label: string, items: CtxItem[]) => void;
  ctxMenu: React.ReactNode;
} {
  const openCtx = React.useCallback(
    (_e: React.MouseEvent, _label: string, _items: CtxItem[]) => {
      /* no-op — see the port note above */
    },
    []
  );
  return { openCtx, ctxMenu: null };
}

/* ---------------- building blocks ---------------- */
/**
 * A titled panel. Opt into `collapsible` and it grows a chevron in its title bar
 * that folds the body away, leaving just the header. Pass a `storageKey` to
 * remember the collapsed state across reloads; `defaultCollapsed` sets the
 * first-run position. When collapsed the card drops to its header height even
 * inside a fixed-height flex/SplitPane cell, so a folded pane really shrinks.
 */
export function GxCard({
  title, meta, children, sx, onContextMenu,
  collapsible, storageKey, defaultCollapsed,
}: {
  title?: string; meta?: React.ReactNode; children: React.ReactNode;
  sx?: object; onContextMenu?: React.MouseEventHandler;
  collapsible?: boolean; storageKey?: string; defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = React.useState(Boolean(defaultCollapsed));

  // Restore the saved position on mount — never read localStorage during render.
  React.useEffect(() => {
    if (!collapsible || !storageKey) return;
    const raw = localStorage.getItem(`gx:card.collapsed.${storageKey}`);
    if (raw != null) setCollapsed(raw === "1");
  }, [collapsible, storageKey]);

  const toggle = React.useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      if (storageKey) {
        try { localStorage.setItem(`gx:card.collapsed.${storageKey}`, next ? "1" : "0"); } catch { /* ignore */ }
      }
      return next;
    });
  }, [storageKey]);

  const folded = collapsible && collapsed;

  return (
    <Paper elevation={0} onContextMenu={onContextMenu}
      sx={{
        p: 1.5, display: "flex", flexDirection: "column", gap: 1, minWidth: 0, minHeight: 0, ...sx,
        // A folded card shrinks to its header even when its cell forced a height.
        ...(folded ? { height: "auto", flex: "none", gap: 0 } : null),
      }}>
      {title && (
        <Box
          onClick={collapsible ? toggle : undefined}
          sx={{ display: "flex", alignItems: "center", gap: 1, cursor: collapsible ? "pointer" : "default", userSelect: "none" }}
        >
          {collapsible && (
            collapsed
              ? <ChevronRightIcon sx={{ fontSize: 16, color: GX.dim, ml: -0.4 }} />
              : <ExpandMoreIcon sx={{ fontSize: 16, color: GX.dim, ml: -0.4 }} />
          )}
          <Typography sx={{ fontFamily: GX.chrome, fontSize: 9.5, letterSpacing: 2.2, color: GX.dim, textTransform: GX.chromeUpper }}>
            {title}
          </Typography>
          <Box sx={{ flex: 1 }} />
          {typeof meta === "string" ? (
            <Typography sx={{ fontFamily: GX.chrome, fontSize: 9.5, color: GX.dim }}>{meta}</Typography>
          ) : meta}
        </Box>
      )}
      {!folded && children}
    </Paper>
  );
}

/** Semantic color lookup.
 *
 *  PORT NOTE: GizmoX defined these as getters because its `GX` was mutated in
 *  place on theme switch. Here every value is a stable `var(--axf-*)` string —
 *  the theme engine repaints the variable, not the object — so plain values
 *  are correct and spreading is safe. */
export const KIND_COLORS: Record<string, string> = {
  ok: GX.ok,
  warn: GX.warn,
  err: GX.err,
  info: GX.info,
  run: GX.accent,
  accent: GX.accent,
  dim: GX.dim,
};

export function GxChip({ label, kind = "dim", sx }: { label: React.ReactNode; kind?: string; sx?: object }) {
  const c = KIND_COLORS[kind] ?? GX.dim;
  return (
    <Chip
      label={label} size="small" variant="outlined"
      sx={{ color: c, borderColor: gxa(c, "59"), bgcolor: gxa(c, "1A"), fontWeight: 600, ...sx }}
    />
  );
}

export function StatTile({ value, label, sub, subKind = "dim" }: {
  value: string; label: string; sub?: string; subKind?: string;
}) {
  return (
    <Paper elevation={0} sx={{ p: 1.4, flex: 1, minWidth: 118 }}>
      <Typography sx={{ fontSize: 21, fontWeight: 700, lineHeight: 1.2 }}>{value}</Typography>
      <Typography sx={{ fontFamily: GX.chrome, fontSize: 8.5, letterSpacing: 1.8, color: GX.dim, textTransform: GX.chromeUpper, mt: 0.3 }}>
        {label}
      </Typography>
      {sub && (
        <Typography sx={{ fontFamily: GX.chrome, fontSize: 10, color: KIND_COLORS[subKind] ?? GX.dim, mt: 0.4 }}>
          {sub}
        </Typography>
      )}
    </Paper>
  );
}

export function MonoBlock({ children, sx }: { children: React.ReactNode; sx?: object }) {
  return (
    <Box component="pre" sx={{
      m: 0, p: 1.2, bgcolor: GX.page, border: `1px solid ${GX.edge}`, borderRadius: "8px",
      fontFamily: GX.mono, fontSize: 11.3, lineHeight: 1.6, overflow: "auto",
      whiteSpace: "pre-wrap", color: GX.ink, ...sx,
    }}>
      {children}
    </Box>
  );
}

export const fmtNum = (n: number) => n.toLocaleString("en-US");
export const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
export const fmtTok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${Math.round(n / 1e3)}k`);
