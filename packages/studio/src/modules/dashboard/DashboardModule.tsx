/**
 * @file The card screen — the dashboard module's UI, rendered inside whichever
 * dashboard WRAPPER is active.
 *
 * The wrapper/screen split (MASTER §4.0): this file is the SCREEN — the
 * free-placement grid, the cards, the Card Manager, the reset control. The
 * chrome around it is the active `dashboard` asset, resolved by
 * `<DashboardChrome>` at render time, so swapping wrappers changes chrome and
 * palette with no edit here and no remount of the grid.
 *
 * **4 columns · gap 12px · row unit 132px · free placement on** — the values
 * the pre-strip screen shipped with, held as the screen's OWN config.
 * Deliberately NOT theme dials: they are one screen's layout, not a property
 * of every surface (MASTER §4.2).
 *
 * All geometry — where a card lands, what a resize clips against, which
 * column card gives way — lives in `./grid`, the engine restored verbatim from
 * the pre-strip archive WITH its test suite. This file only turns pointer
 * deltas into cell deltas and paints the result.
 *
 * Layout persists under `axs:dashboard@1`. **localStorage is read only in the
 * mount effect** — the server render and first client paint show the seed
 * arrangement, then the stored one lands as a state update (the standing
 * hydration rule).
 *
 * ── MUI (2026-08-11, the rebuild) ──────────────────────────────────────────
 * The pre-strip screen was token()-era by decree (the replica exemption, since
 * cancelled). Restored on MUI per `no-hand-rolled-ui.md` rule 0: cards are
 * `Paper`, the Card Manager is a `Dialog` with `Switch`/`Select`/`Button`, the
 * header controls are `Button`. What stays bespoke is the GEOMETRY — the grid
 * tracks, the drag/resize grips and the pointer maths, the same exception
 * `panes/PaneLayout` holds, because MUI has no free-placement grid. Colours
 * still come from `token()` so a pack swap recolours the screen.
 *
 * ── Floatable cards (2026-08-15, P9) ───────────────────────────────────────
 * Every card is wrapped in `./FloatableCard`, which is inert until the per-user
 * `Floatable panes & toolbars` switch is on. **The content did not change** —
 * this is still the six cards it has always been, and nothing of the admin
 * dashboard's composition came near it. `./FloatableCard`'s docblock states
 * that boundary and why it is load-bearing.
 */
"use client";

import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";

import { Glyph, token, useModuleSettings, useTheme } from "@axf/core";

import { CARD_REGISTRY } from "./cards";
import FloatableCard from "./FloatableCard";
import {
  applyPlacements,
  cellMetrics,
  moveCard,
  resizeCard,
  resolvePlacements,
  SPAN
} from "./grid";
import type { Place, Placements } from "./grid";
import type { CardConfig, CardSize } from "./types";
import { SEED_CARDS } from "./useCardData";

/* ------------------------------------------------ the screen's own config */

/**
 * The grid's geometry is THEMED — `gridColumns` / `gridUnit` / `gridGap`, read
 * through `useTheme()` in the component below. These are the fallbacks used
 * when a dial is absent, and they are the shipped defaults.
 *
 * **Why one JS number rather than three `var()`s.** Columns are not only a CSS
 * value: `resolvePlacements`, `moveCard` and `resizeCard` all do integer
 * placement math against the column count, and the result becomes each card's
 * `gridColumn`/`gridRow`. If CSS read `var(--axf-grid-columns)` while the math
 * kept its own constant, the two would disagree the moment a roll changed it
 * and cards would be placed into columns the grid does not have. So the count
 * is read ONCE and drives both.
 *
 * **Why that is hydration-safe.** `useTheme()` returns the SERVER snapshot for
 * the server render and the hydrating client render alike, so both produce the
 * default-geometry markup and match by construction; the rolled value arrives
 * one commit later as an ordinary re-flow. That is the whole reason to go
 * through the hook instead of reading the store or `localStorage` here — doing
 * the latter is precisely what caused the app-wide hydration failure that
 * `theme/derived.ts` was written to end.
 */
const COLUMNS_FALLBACK = 4;
const GAP_FALLBACK = 12;
const ROW_UNIT_FALLBACK = 132;

/** A dial value that must be a usable positive number, or the fallback. */
const dialNum = (raw: unknown, fallback: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const STORAGE_KEY = "axs:dashboard@1";

/** Which edge of a card a pointer grabbed. `move` is the whole card. */
type Grip = "move" | "e" | "s" | "se";

/** A live pointer gesture. `cellW`/`cellH` are measured once at pointer-down —
 *  the grid cannot change size mid-drag, and re-measuring per move event would
 *  read a width the draft placement had already altered. */
interface Gesture {
  grip: Grip;
  id: string;
  x: number;
  y: number;
  from: Place;
  cellW: number;
  cellH: number;
}

const freshSeed = (): CardConfig[] => SEED_CARDS.map((c) => ({ ...c }));

/* -------------------------------------------------------------- the screen */

function CardScreen() {
  const [cards, setCards] = React.useState<CardConfig[]>(freshSeed);
  const [managerOpen, setManagerOpen] = React.useState(false);
  const hydrated = React.useRef(false);

  // The rolled grid geometry. One read, driving BOTH the CSS template and the
  // placement math — see the note on COLUMNS_FALLBACK for why they cannot be
  // allowed to diverge, and why this hook is the hydration-safe way to do it.
  const dials = useTheme().values;
  const COLUMNS = Math.round(dialNum(dials.gridColumns, COLUMNS_FALLBACK));
  const GAP_PX = dialNum(dials.gridGap, GAP_FALLBACK);
  const ROW_UNIT = dialNum(dials.gridUnit, ROW_UNIT_FALLBACK);

  // Hydrate the stored layout AFTER mount — never during render.
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const doc = JSON.parse(raw) as { v?: number; cards?: CardConfig[] };
        if (doc && doc.v === 1 && Array.isArray(doc.cards)) setCards(doc.cards);
      }
    } catch {
      // Unreadable layout: keep the seed. It is overwritten on the next edit.
    }
    hydrated.current = true;
  }, []);

  // Persist every change made after hydration (the hydration write-back is a
  // no-op re-save of what was just read).
  React.useEffect(() => {
    if (!hydrated.current) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, cards }));
    } catch {
      // Quota/private mode: the layout stays in memory for the session.
    }
  }, [cards]);

  // Merge registry with config — a registry card missing from the stored
  // config appears disabled at the end; a stored id no longer registered
  // drops out.
  const merged: CardConfig[] = React.useMemo(() => {
    const known = new Set(cards.map((c) => c.id));
    const out = cards.filter((c) => CARD_REGISTRY.some((r) => r.id === c.id));
    for (const r of CARD_REGISTRY) {
      if (!known.has(r.id)) out.push({ id: r.id, enabled: false, order: out.length, size: "md" });
    }
    return out.sort((a, b) => a.order - b.order);
  }, [cards]);

  const patchCard = (id: string, patch: Partial<CardConfig>) =>
    setCards(merged.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  /** The sm/md/lg picker moves the real width too, or it would silently do
   *  nothing to any card that has been resized by hand. */
  const setSize = (id: string, size: CardSize) =>
    patchCard(id, { size, w: Math.min(SPAN[size], COLUMNS) });

  const enabled = merged.filter((c) => c.enabled);

  /* ---------------------------------------------------------- free placement
     `places` is the committed arrangement; `draft` is the same map with the
     live gesture applied, painted while the mouse is down. Nothing persists
     until the pointer is released. */
  const gridRef = React.useRef<HTMLDivElement | null>(null);
  const [gesture, setGesture] = React.useState<Gesture | null>(null);
  const [draft, setDraft] = React.useState<Placements | null>(null);
  /** The draft, readable synchronously: `pointerup` must commit what the last
   *  `pointermove` computed, and the two can arrive in the same task. */
  const draftRef = React.useRef<Placements | null>(null);
  const putDraft = React.useCallback((next: Placements | null) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const places = React.useMemo(() => resolvePlacements(enabled, COLUMNS, true), [enabled]);
  const shown = draft ?? places;

  const startGesture = (grip: Grip, id: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // A grab that landed on a control inside the card belongs to the control.
    if (
      grip === "move" &&
      (e.target as HTMLElement).closest("button,a,input,select,textarea,[role='button']")
    ) {
      return;
    }
    const from = places[id];
    const width = gridRef.current?.getBoundingClientRect().width ?? 0;
    if (!from || width <= 0) return;
    e.preventDefault();
    e.stopPropagation();
    const { cellW, cellH } = cellMetrics(width, COLUMNS, GAP_PX, ROW_UNIT);
    setGesture({ grip, id, x: e.clientX, y: e.clientY, from, cellW, cellH });
    putDraft(places);
  };

  React.useEffect(() => {
    if (!gesture) return;
    const { grip, id, x, y, from, cellW, cellH } = gesture;

    const onMove = (e: PointerEvent) => {
      const dCol = Math.round((e.clientX - x) / cellW);
      const dRow = Math.round((e.clientY - y) / cellH);
      if (grip === "move") {
        const r = moveCard(id, from.col + dCol, from.row + dRow, places, COLUMNS);
        putDraft({ ...places, [id]: r.place, ...r.swapped });
        return;
      }
      const want: Place = {
        col: from.col,
        row: from.row,
        w: grip === "s" ? from.w : from.w + dCol,
        h: grip === "e" ? from.h : from.h + dRow
      };
      const r = resizeCard(id, want, places, COLUMNS);
      const next: Placements = { ...places, [id]: r.place };
      // A column card that gave way shortens live, under the mouse.
      for (const [k, h] of Object.entries(r.shrunk)) next[k] = { ...places[k], h };
      putDraft(next);
    };

    const finish = () => {
      const d = draftRef.current;
      if (d) setCards(applyPlacements(merged, d));
      putDraft(null);
      setGesture(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    // Held-down dragging over text would otherwise select the card bodies.
    const prevSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.body.style.userSelect = prevSelect;
    };
  }, [gesture, places, merged, putDraft]);

  /** One resize grip — invisible until the card is hovered (the CSS block
   *  below), so the chrome stays quiet. Bespoke geometry, like the grid. */
  const grip = (g: "e" | "s" | "se", id: string) => (
    <Box
      component="span"
      key={g}
      className="axs-card-grip"
      onPointerDown={startGesture(g, id)}
      sx={{
        position: "absolute",
        zIndex: 2,
        opacity: 0,
        transition: "opacity 120ms",
        background: token("accent"),
        borderRadius: "2px",
        ...(g === "e" ? { top: 8, bottom: 8, right: -1, width: 4, cursor: "ew-resize" } : null),
        ...(g === "s" ? { left: 8, right: 8, bottom: -1, height: 4, cursor: "ns-resize" } : null),
        ...(g === "se"
          ? { right: -1, bottom: -1, width: 12, height: 12, cursor: "nwse-resize" }
          : null)
      }}
    />
  );

  /**
   * Card Manager drag-to-reorder. Under free placement `order` alone decides
   * nothing on screen — so a reorder also drops the stored `col`/`row`,
   * letting every card re-flow into the new sequence. Widths and heights are
   * kept: asking for a different order is not asking to lose the sizes.
   */
  const reorder = (dragId: string, beforeId: string) => {
    const dragged = merged.find((c) => c.id === dragId);
    if (!dragged) return;
    const list = merged.filter((c) => c.id !== dragId);
    const idx = list.findIndex((c) => c.id === beforeId);
    list.splice(idx < 0 ? list.length : idx, 0, dragged);
    setCards(list.map((c, i) => ({ ...c, order: i, col: undefined, row: undefined })));
  };

  /** The ↺ control: back to the seed arrangement — geometry, sizes, order and
   *  visibility all as shipped. */
  const resetLayout = () => setCards(freshSeed());

  const dragIdRef = React.useRef<string | null>(null);

  // Module settings (core 0.0.20): the one dashboard row. Read live so the
  // shell dialog's switch restyles the titles without a reload.
  const uppercaseTitles = useModuleSettings("dashboard").uppercaseTitles !== false;

  return (
    <Box
      data-axf-area="dashboard.grid"
      sx={{ padding: "16px", display: "flex", flexDirection: "column", minHeight: "100%" }}
    >
      {/* Grip hover rules — the one thing sx on the grip itself cannot express. */}
      <style>{`
        .axs-card:hover .axs-card-grip { opacity: 0.55; }
        .axs-card[data-dragging="true"] .axs-card-grip { opacity: 0.55; }
        .axs-card:hover { border-color: color-mix(in srgb, var(--axf-accent) 40%, transparent); }
      `}</style>

      {/* Header row: title · spacer · reset · manage. */}
      <Stack direction="row" sx={{ alignItems: "center", marginBottom: "14px", gap: "8px" }}>
        <Typography sx={{ fontSize: 17, fontWeight: 800, letterSpacing: "0.02em" }}>
          Dashboard
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button variant="outlined" size="small" title="Reset layout" onClick={resetLayout}>
          ↺
        </Button>
        <Button variant="outlined" size="small" onClick={() => setManagerOpen(true)}>
          Manage cards
        </Button>
      </Stack>

      {/* The grid: positioned tracks, fixed row unit — one row = one drag step. */}
      <Box
        ref={gridRef}
        data-axs-dashboard-grid=""
        sx={{
          display: "grid",
          gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`,
          gridAutoRows: `${ROW_UNIT}px`,
          gap: `${GAP_PX}px`
        }}
      >
        {enabled.map((cfg) => {
          const meta = CARD_REGISTRY.find((r) => r.id === cfg.id);
          if (!meta) return null;
          const p = shown[cfg.id];
          const dragging = gesture?.id === cfg.id;
          // The placement, held once: it goes on the card, and — when the
          // per-user switch is on — on the wrapper that becomes the grid item
          // in its place. `./FloatableCard` records why.
          const place = {
            gridColumn: p ? `${p.col} / span ${p.w}` : undefined,
            gridRow: p ? `${p.row} / span ${p.h}` : undefined
          };
          return (
            <FloatableCard key={cfg.id} id={cfg.id} label={meta.title} place={place}>
            <Paper
              component="section"
              elevation={0}
              className="axs-card"
              data-axs-card={cfg.id}
              data-dragging={dragging || undefined}
              sx={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                ...place,
                // `flex` is inert on a grid item — which is the point: with the
                // switch off this line changes nothing at all, and with it on it
                // is what makes the card fill the wrapper `<Floatable>` puts
                // between it and the grid. (`minWidth: 0` would NOT be inert
                // here — it changes a grid item's shrink floor — so it lives on
                // the wrapper, where it only exists when the wrapper does.)
                flex: 1,
                padding: "12px",
                background: token("panel"),
                backgroundImage: "none",
                border: `1px solid ${dragging ? token("accent") : token("edge")}`,
                borderRadius: token("radius"),
                zIndex: dragging ? 3 : undefined,
                boxShadow: dragging ? token("shadow") : "none",
                transition: dragging ? "none" : "border-color 120ms, box-shadow 120ms"
              }}
            >
              {/* Drag by the header — icon · UPPERCASE title · spacer · grip. */}
              <Stack
                direction="row"
                onPointerDown={startGesture("move", cfg.id)}
                sx={{
                  alignItems: "center",
                  gap: "7px",
                  marginBottom: "8px",
                  flexShrink: 0,
                  cursor: dragging ? "grabbing" : "grab",
                  touchAction: "none"
                }}
              >
                <Glyph id={meta.glyph} size={15} />
                <Typography
                  component="span"
                  sx={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: uppercaseTitles ? "uppercase" : "none",
                    color: token("dim")
                  }}
                >
                  {meta.title}
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Typography
                  component="span"
                  aria-hidden
                  sx={{ color: token("dim"), opacity: 0.5, fontSize: 12, letterSpacing: "1px" }}
                >
                  ⋮⋮
                </Typography>
              </Stack>
              {/* The row unit bounds the card, so a tall body scrolls inside it
                  instead of pushing the grid. */}
              <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>{meta.render()}</Box>
              {(["e", "s", "se"] as const).map((g) => grip(g, cfg.id))}
            </Paper>
            </FloatableCard>
          );
        })}
        {enabled.length === 0 && (
          <Box
            sx={{
              gridColumn: "1 / -1",
              gridRow: "1 / span 2",
              display: "grid",
              placeItems: "center",
              border: `1px dashed ${token("edge")}`,
              borderRadius: token("radius"),
              color: token("dim"),
              fontSize: 13
            }}
          >
            All cards hidden — open the card manager.
          </Box>
        )}
      </Box>

      {/* ------------------------------------------------- the Card Manager */}
      <Dialog
        open={managerOpen}
        onClose={() => setManagerOpen(false)}
        aria-label="Card manager"
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontSize: 15, fontWeight: 700 }}>Card manager</DialogTitle>
        <DialogContent sx={{ padding: "8px", display: "grid", gap: "2px", alignContent: "start" }}>
          {merged.map((cfg) => {
            const meta = CARD_REGISTRY.find((r) => r.id === cfg.id);
            if (!meta) return null;
            return (
              <Stack
                key={cfg.id}
                direction="row"
                draggable
                onDragStart={() => {
                  dragIdRef.current = cfg.id;
                }}
                onDragEnd={() => {
                  dragIdRef.current = null;
                }}
                onDragOver={(e) => {
                  if (dragIdRef.current && dragIdRef.current !== cfg.id) e.preventDefault();
                }}
                onDrop={() => {
                  const dragId = dragIdRef.current;
                  dragIdRef.current = null;
                  if (dragId && dragId !== cfg.id) reorder(dragId, cfg.id);
                }}
                sx={{
                  alignItems: "center",
                  gap: "10px",
                  padding: "6px 8px",
                  borderRadius: "var(--axf-radius-tight)",
                  cursor: "grab"
                }}
              >
                <Typography
                  component="span"
                  aria-hidden
                  sx={{ color: token("dim"), opacity: 0.6, letterSpacing: "1px" }}
                >
                  ⋮⋮
                </Typography>
                <Glyph id={meta.glyph} size={16} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 13 }}>{meta.title}</Typography>
                  <Typography
                    sx={{
                      fontSize: 11,
                      color: token("dim"),
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis"
                    }}
                  >
                    {meta.description}
                  </Typography>
                </Box>
                <Select
                  value={cfg.size}
                  size="small"
                  onChange={(e) => setSize(cfg.id, e.target.value as CardSize)}
                  sx={{ fontSize: 12, minWidth: 64 }}
                >
                  <MenuItem value="sm">sm</MenuItem>
                  <MenuItem value="md">md</MenuItem>
                  <MenuItem value="lg">lg</MenuItem>
                </Select>
                <Switch
                  checked={cfg.enabled}
                  size="small"
                  slotProps={{
                    input: {
                      "aria-label": cfg.enabled
                        ? "Shown — toggle to hide"
                        : "Hidden — toggle to show"
                    }
                  }}
                  onChange={() => patchCard(cfg.id, { enabled: !cfg.enabled })}
                />
              </Stack>
            );
          })}
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" size="small" onClick={() => setManagerOpen(false)}>
            Done
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/**
 * The module component: the card screen, and ONLY the card screen.
 *
 * It used to mount `<DashboardChrome>` itself, which by 2026-08-12 meant the
 * wrapper rendered TWICE on `/` — `StudioShell` mounts it once for every route
 * (its docblock records the rehoming, and the reason: "chrome that every route
 * should have belongs to the shell, because a per-module mount is a mount a
 * module can forget"), and this file mounted it again inside that. The
 * duplication was invisible while the one registered wrapper drew almost
 * nothing; it stopped being invisible the moment a wrapper could carry bands,
 * a frame and a card treatment, because every one of them appeared twice with
 * the screen nested inside its own chrome.
 *
 * A module renders a screen. The wrapper is the shell's.
 */
export default function DashboardModule() {
  return <CardScreen />;
}
