/**
 * @file Resizable two-pane splitter. Drag the divider to resize; sizes persist
 * per `storageKey`. Double-click the divider to reset. Nest SplitPanes to build
 * arbitrary column/pane layouts.
 *
 * PORT NOTE (GizmoX → AmberX, per the 2026-08-13 port record in PLANNING-STATE.md): two GizmoX dependencies did not
 * come along —
 *
 * - The appearance-document store (`@/lib/appearance/store`): pane sizes lived
 *   in one map inside GizmoX's single appearance document. Here they persist
 *   in one localStorage JSON map under `axs:amberxvid-split@1`, which keeps
 *   the "one map, not a key sweep" property without importing a store that
 *   does not exist in this app.
 * - Floatable panes (`@/components/core/FloatablePanes` + the owning asset's
 *   `chrome.floatPanes` switch): the setting cascade that drove the switch is
 *   gone (see the 2026-08-13 port record in PLANNING-STATE.md), so panes never float and children render
 *   directly. `firstTitle`/`secondTitle` stay in the props so ported call
 *   sites (Profiles.tsx passes both) compile unchanged; they are simply
 *   unused. Accepted degradation.
 */
"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import { GX, gxa } from "./gx";

const SPLIT_STORE = "axs:amberxvid-split@1";

/** Read one pane size from the persisted map. */
function paneSize(key: string): number | undefined {
  try {
    const raw = localStorage.getItem(SPLIT_STORE);
    if (!raw) return undefined;
    const map = JSON.parse(raw) as Record<string, number>;
    return typeof map[key] === "number" ? map[key] : undefined;
  } catch {
    return undefined;
  }
}

/** Write one pane size into the persisted map. */
function setPaneSize(key: string, v: number): void {
  try {
    const raw = localStorage.getItem(SPLIT_STORE);
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    map[key] = v;
    localStorage.setItem(SPLIT_STORE, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export interface SplitPaneProps {
  direction?: "row" | "column";
  /** Initial size (px) of the sized pane (`primary`). */
  initial: number;
  min?: number;
  max?: number;
  /** Persist the dragged size under this key. */
  storageKey?: string;
  first: React.ReactNode;
  second: React.ReactNode;
  /** Which pane keeps a fixed px size; the other flexes. Default "first". */
  primary?: "first" | "second";
  /** Hide the sized pane entirely (splitter collapses). */
  collapsed?: boolean;
  style?: React.CSSProperties;
  /** Title-bar text of the floatable-pane chrome in GizmoX. Kept for API
   *  compatibility; unused here (panes do not float — see the port note). */
  firstTitle?: string;
  secondTitle?: string;
}

export default function SplitPane({
  direction = "row",
  initial,
  min = 120,
  max = 900,
  storageKey,
  first,
  second,
  primary = "first",
  collapsed = false,
  style,
  firstTitle: _firstTitle,
  secondTitle: _secondTitle
}: SplitPaneProps) {
  const [size, setSize] = React.useState(initial);
  const [dragging, setDragging] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  /** Set once this pane's size stops being "whatever the parent proposed" —
   *  a restored size or a drag. See the `initial` sync below. */
  const touched = React.useRef(false);
  const horizontal = direction === "row";
  const sizeSecond = primary === "second";

  React.useEffect(() => {
    if (!storageKey) return;
    const v = paneSize(storageKey);
    if (v !== undefined && Number.isFinite(v)) {
      touched.current = true;
      setSize(Math.min(max, Math.max(min, v)));
    }
  }, [storageKey, min, max]);

  /**
   * Adopt a corrected `initial` while the pane is still showing the size its
   * parent proposed.
   *
   * A parent that has to measure itself before it can prorate its children
   * renders once with a zero extent, so every split it builds falls back to
   * its minimum and hands that down as `initial`. Without this the pane would
   * latch that first guess forever: mounting `useState(initial)` reads the
   * prop exactly once.
   *
   * Guarded by `touched` so it can never fight a real size: a drag or a
   * restored size wins over anything the parent proposes afterwards.
   */
  React.useEffect(() => {
    if (touched.current) return;
    setSize(Math.min(max, Math.max(min, initial)));
  }, [initial, min, max]);

  const persist = React.useCallback(
    (v: number) => {
      if (storageKey) setPaneSize(storageKey, v);
    },
    [storageKey]
  );

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const start = horizontal ? e.clientX : e.clientY;
    const startSize = size;
    const sign = sizeSecond ? -1 : 1;
    // From here the size is the user's, not the parent's proposal.
    touched.current = true;
    setDragging(true);
    const move = (ev: PointerEvent) => {
      const delta = ((horizontal ? ev.clientX : ev.clientY) - start) * sign;
      const next = Math.min(max, Math.max(min, startSize + delta));
      setSize(next);
    };
    const up = (ev: PointerEvent) => {
      const delta = ((horizontal ? ev.clientX : ev.clientY) - start) * sign;
      persist(Math.min(max, Math.max(min, startSize + delta)));
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <Box
      ref={containerRef}
      sx={{
        display: "flex",
        flexDirection: direction,
        width: "100%",
        height: "100%",
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden"
      }}
      style={style}
    >
      {(!collapsed || sizeSecond) && (
        <Box
          sx={{
            flex: sizeSecond ? 1 : `0 0 ${size}px`,
            minWidth: 0,
            minHeight: 0,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column"
          }}
        >
          {first}
        </Box>
      )}
      {!collapsed && (
        <Box
          onPointerDown={onPointerDown}
          onDoubleClick={() => {
            // Back to what the parent proposes — including tracking it again if
            // the parent later revises it.
            touched.current = false;
            setSize(initial);
            persist(initial);
          }}
          sx={{
            flex: "0 0 6px",
            cursor: horizontal ? "col-resize" : "row-resize",
            position: "relative",
            zIndex: 2,
            touchAction: "none",
            bgcolor: dragging ? gxa(GX.accent, "59") : "transparent",
            transition: "background-color 120ms",
            "&:hover": { bgcolor: gxa(GX.accent, "40") },
            "&::after": {
              content: '""',
              position: "absolute",
              inset: horizontal ? "0 2px" : "2px 0",
              borderRadius: 2,
              bgcolor: "rgba(255,255,255,0.06)"
            }
          }}
        />
      )}
      {(!collapsed || !sizeSecond) && (
        <Box
          sx={{
            flex: sizeSecond ? `0 0 ${size}px` : 1,
            minWidth: 0,
            minHeight: 0,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column"
          }}
        >
          {second}
        </Box>
      )}
    </Box>
  );
}
