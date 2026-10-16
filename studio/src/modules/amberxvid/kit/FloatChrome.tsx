/**
 * @file Shared chrome for floating windows, ported from GizmoX's
 * `components/core/FloatChrome.tsx` for the amberxvid module (its AdminWindow
 * uses both pieces):
 *
 * - `FloatStatusBar` — a thin footer strip inside the frame stating that the
 *   window is floatable. A floating window otherwise looks like a panel; the
 *   strip is what tells the user it can be dragged, resized and minimized.
 * - `MinimizedDock` — minimized windows collect as **title bars stacked
 *   vertically down the right edge** (not chips laid out across the bottom),
 *   so a stack of them reads like the windows they came from and never fights
 *   the shell's bottom status bar for room. When the owner passes `onReorder`
 *   the rows become drag-to-reorder; without it they are click-to-restore
 *   only.
 *
 * Both are presentational; the owning layer keeps the window state.
 *
 * PORT NOTE: icons come from `./kit/icons`; the `--gxs-accent` chrome
 * variable is `GX.accent` from `./gx`; the user-facing hint text says AmberX
 * instead of GizmoX. No store dependencies existed to strip.
 */
"use client";

import * as React from "react";
import ReactDOM from "react-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { Close as CloseIcon } from "./icons";
import { OpenInFull as OpenInFullIcon } from "./icons";
import { OpenWith as OpenWithIcon } from "./icons";
import { DragIndicator as DragIndicatorIcon } from "./icons";
import { GX } from "./gx";

/** The one sentence every floating window shows. Single source so no layer
 *  can ever word it differently. */
export const FLOAT_HINT = "Floatable window — drag the title bar to move, the corner to resize";
/** Right-hand half of the strip: the framework-wide promise. */
export const FLOAT_HINT_SCOPE = "floating windows work throughout AmberX";

/** Accent tint used by the shell layer; a launcher may pass its white mount. */
const ACCENT = GX.accent;

export type FloatTone = "accent" | "mount";

function toneColors(tone: FloatTone) {
  return tone === "mount"
    ? {
        bg: "rgba(255,255,255,0.06)",
        border: "rgba(255,255,255,0.30)",
        icon: "rgba(255,255,255,0.75)"
      }
    : {
        bg: `color-mix(in srgb, ${ACCENT} 7%, transparent)`,
        border: `color-mix(in srgb, ${ACCENT} 22%, transparent)`,
        icon: ACCENT
      };
}

/**
 * Footer strip for a floating window frame. `size` (when given) renders a live
 * `w × h` readout on the right, which doubles as feedback while resizing.
 */
export function FloatStatusBar({
  tone = "accent",
  size,
  note
}: {
  tone?: FloatTone;
  size?: { w: number; h: number };
  /** Extra left-hand note, e.g. "3 unsaved changes". */
  note?: string;
}) {
  const c = toneColors(tone);
  return (
    <Box
      data-zone="float.statusbar"
      sx={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        pl: 1,
        // Clears the corner resize handle every frame parks over this strip.
        pr: 2.4,
        py: 0.25,
        minHeight: 20,
        borderTop: `1px solid ${c.border}`,
        bgcolor: c.bg,
        userSelect: "none"
      }}
    >
      <OpenWithIcon sx={{ fontSize: 11, color: c.icon, flexShrink: 0 }} />
      <Typography noWrap sx={{ fontSize: 10.5, color: "text.secondary", minWidth: 0 }}>
        {FLOAT_HINT}
      </Typography>
      {note && (
        <Typography noWrap sx={{ fontSize: 10.5, color: "text.disabled", minWidth: 0 }}>
          · {note}
        </Typography>
      )}
      <Box sx={{ flex: 1, minWidth: 8 }} />
      <Typography
        noWrap
        sx={{ fontSize: 10.5, color: "text.disabled", display: { xs: "none", sm: "block" } }}
      >
        {FLOAT_HINT_SCOPE}
      </Typography>
      {size && (
        <Typography
          noWrap
          sx={{
            fontSize: 10.5,
            color: "text.disabled",
            fontVariantNumeric: "tabular-nums",
            fontFamily: "monospace"
          }}
        >
          {Math.round(size.w)}×{Math.round(size.h)}
        </Typography>
      )}
    </Box>
  );
}

export interface MinimizedItem {
  id: string;
  title: string;
  /** Optional dim suffix (route, list kind, …). */
  detail?: string;
}

/** Where the stack starts, and how wide it is. */
const DOCK_TOP = 64;
const DOCK_WIDTH = 208;
const DOCK_ID = "axs-float-minimized";

/**
 * The one right-edge column every layer's minimized windows portal into.
 *
 * Two layers can be alive at once. Two independently positioned `fixed`
 * stacks would sit on top of each other, so all of them share a single
 * container and their rows simply stack in mount order.
 */
function dockContainer(): HTMLElement {
  const existing = document.getElementById(DOCK_ID);
  if (existing) return existing;
  const el = document.createElement("div");
  el.id = DOCK_ID;
  el.setAttribute("data-zone", "float.minimized.stack");
  Object.assign(el.style, {
    position: "fixed",
    right: "8px",
    top: `${DOCK_TOP}px`,
    zIndex: "1400",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    width: `${DOCK_WIDTH}px`,
    maxHeight: `calc(100vh - ${DOCK_TOP + 46}px)`,
    overflowY: "auto",
    overflowX: "hidden"
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  return el;
}

/** Move `dragId` to sit immediately before `targetId` (or to the end when
 *  `targetId` is null), returning the new id order. Pure — the caller decides
 *  what to do with it. */
function reorderIds(ids: string[], dragId: string, targetId: string | null): string[] {
  if (dragId === targetId) return ids;
  const without = ids.filter((id) => id !== dragId);
  if (targetId == null) return [...without, dragId];
  const at = without.indexOf(targetId);
  if (at < 0) return ids;
  without.splice(at, 0, dragId);
  return without;
}

/**
 * Minimized windows, as title bars stacked vertically down the right edge.
 * Each row is the window's own title bar shape — click restores, × closes.
 * The column scrolls rather than growing past the viewport.
 *
 * When `onReorder` is supplied the rows are drag-to-reorder: a left-edge grip
 * makes each row draggable, and dropping onto another row drops the dragged
 * window into that slot (an accent insertion line marks where it will land).
 * Owners that don't pass `onReorder` get the original click-only behaviour.
 */
export function MinimizedDock({
  items,
  tone = "accent",
  onRestore,
  onClose,
  onReorder
}: {
  items: MinimizedItem[];
  tone?: FloatTone;
  onRestore: (id: string) => void;
  onClose: (id: string) => void;
  /** Persist a new order of window ids. Presence turns on drag-to-reorder. */
  onReorder?: (orderedIds: string[]) => void;
}) {
  // Portal target is DOM, so it can only be resolved after mount (and never
  // during SSR).
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    setHost(dockContainer());
  }, []);

  // Id being dragged and the id it currently hovers over (drop-before target;
  // null means "drop at the end") — both live only for the duration of a drag,
  // so plain component state is enough.
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);
  const draggable = !!onReorder;

  // Refs the window-level pointer listeners read, so they never capture a stale
  // items array / callback, and so the click that follows a drag knows to
  // restore nothing.
  const rowRefs = React.useRef<Map<string, HTMLElement>>(new Map());
  const itemsRef = React.useRef(items);
  itemsRef.current = items;
  const onReorderRef = React.useRef(onReorder);
  onReorderRef.current = onReorder;
  const draggedRef = React.useRef(false);

  // Which row the pointer sits above → the drag would land before it. Past the
  // last row's midpoint returns null (drop at the end of the stack).
  const overAt = (clientY: number): string | null => {
    for (const it of itemsRef.current) {
      const el = rowRefs.current.get(it.id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return it.id;
    }
    return null;
  };

  // Pointer-drag reorder — the same idiom every other draggable surface in the
  // kit uses (SplitPane's divider). Native HTML5 DnD was flaky here: a small
  // drag fell through to the row's click and restored the window mid-reorder.
  // A press only becomes a drag past a 4px threshold, so a plain click still
  // restores.
  const startDrag = (id: string) => (e: React.PointerEvent) => {
    if (!onReorder || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let active = false;
    let over: string | null = null;
    draggedRef.current = false;

    const move = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
        active = true;
        draggedRef.current = true;
        setDragId(id);
      }
      over = overAt(ev.clientY);
      setOverId(over);
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (active && onReorderRef.current) {
        const order = itemsRef.current.map((i) => i.id);
        const next = reorderIds(order, id, over);
        if (next.some((x, i) => x !== order[i])) onReorderRef.current(next);
      }
      setDragId(null);
      setOverId(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const c = toneColors(tone);
  if (items.length === 0 || !host) return null;

  return ReactDOM.createPortal(
    <Box
      data-zone="float.minimized"
      sx={{ display: "flex", flexDirection: "column", gap: 0.4 }}
    >
      {items.map((it) => (
        <Box
          key={it.id}
          ref={
            draggable
              ? (el: HTMLElement | null) => {
                  if (el) rowRefs.current.set(it.id, el);
                  else rowRefs.current.delete(it.id);
                }
              : undefined
          }
          onPointerDown={draggable ? startDrag(it.id) : undefined}
          onClick={() => {
            // A press that turned into a drag ends in a click too — swallow it
            // once so a reorder never also restores the window.
            if (draggedRef.current) {
              draggedRef.current = false;
              return;
            }
            onRestore(it.id);
          }}
          title={
            draggable
              ? `${it.title} — minimized. Click to restore, drag the grip to reorder.`
              : `${it.title} — minimized. Click to restore.`
          }
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.6,
            px: 0.9,
            py: 0.35,
            cursor: draggable ? (dragId === it.id ? "grabbing" : "grab") : "pointer",
            // Pointer-drag needs the browser to hand us the moves rather than
            // scroll/select the row out from under the gesture.
            ...(draggable && { touchAction: "none", userSelect: "none" }),
            borderRadius: 1,
            border: `1px solid ${c.border}`,
            borderLeft: `3px solid ${c.icon}`,
            bgcolor: "rgba(14,14,19,0.92)",
            boxShadow: "0 6px 18px rgba(0,0,0,0.45)",
            opacity: dragId === it.id ? 0.4 : 1,
            // Insertion line: the dragged row will land above the hovered row.
            borderTop:
              draggable && overId === it.id && dragId !== it.id
                ? `2px solid ${c.icon}`
                : "2px solid transparent",
            "&:hover": { bgcolor: c.bg }
          }}
        >
          {draggable && (
            <DragIndicatorIcon
              sx={{ fontSize: 13, color: "text.disabled", flexShrink: 0, cursor: "grab" }}
            />
          )}
          <OpenInFullIcon sx={{ fontSize: 12, color: c.icon, flexShrink: 0 }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography noWrap sx={{ fontSize: 11.5, fontWeight: 700 }}>
              {it.title}
            </Typography>
            {it.detail && (
              <Typography
                noWrap
                sx={{ fontSize: 9.5, color: "text.disabled", fontFamily: "monospace" }}
              >
                {it.detail}
              </Typography>
            )}
          </Box>
          <Tooltip title="Close window">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onClose(it.id);
              }}
              sx={{ p: 0.2, "&:hover": { color: "error.light" } }}
            >
              <CloseIcon sx={{ fontSize: 13 }} />
            </IconButton>
          </Tooltip>
        </Box>
      ))}
    </Box>,
    host
  );
}
