/**
 * @file The floating list windows — this module's signature (MASTER §5), and
 * the precedent GizmoX's framework-wide float-panes rule came from.
 *
 * Every `WindowState` in the store renders as a window over the module:
 * draggable by its title bar, resizable from the corner, z-ordered on click,
 * minimizable. Minimized windows collect as title bars stacked DOWN THE RIGHT
 * EDGE — never a horizontal bottom row, which collided with the shell's status
 * strip in GizmoX and lost the window identity after two or three.
 *
 * A window's body is the same `TaskTree` the page renders, over the same store
 * rows, so an item edited in a window and on the page can never disagree. That
 * is why the windows are worth having at all: two views of one list, live.
 *
 * Windows are opened from three places, all landing on the same store call:
 * the rail's ⧉ button, the item detail pane's "Float list", and the
 * `taskman.list.float` context-menu command. Geometry is session state and is
 * deliberately NOT persisted — a floating window is something you opened, not
 * something you configured.
 *
 * ── MUI (2026-08-11) ────────────────────────────────────────────────────────
 * Frames are `Paper`, bars are `Stack`, controls are `IconButton`/`ButtonBase`.
 * The DRAG and RESIZE maths stay bespoke, which is the same exception
 * `panes/PaneLayout` holds: a window's position during a drag is a measured
 * number, and MUI has no component that owns it.
 */
"use client";

import * as React from "react";

import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import { paletteColor } from "./palette";
import { useTaskmanSettings } from "./settings";
import TaskTree from "./TaskTree";
import type { TaskController } from "./useTaskController";
import type { WindowState } from "./types";

/** The smallest a window may be dragged to. Below this the tree is unreadable
 *  and the title bar's three buttons start overlapping the title. */
const MIN_W = 320;
const MIN_H = 220;

function WindowFrame({ win, ctrl }: { win: WindowState; ctrl: TaskController }) {
  /** The live gesture's geometry, painted while the pointer is down. Committed
   *  to the store on release — a store write per pointermove would re-render
   *  every other window and the page tree sixty times a second. */
  const [live, setLive] = React.useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const settings = useTaskmanSettings();
  const pos = live ?? { x: win.x, y: win.y, w: win.w, h: win.h };

  const list = ctrl.lists.find((l) => l.id === win.payload.listId);

  const startDrag = (e: React.PointerEvent) => {
    // A grab that landed on one of the title bar's buttons belongs to it.
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    ctrl.focusWindow(win.id);
    const sx = e.clientX;
    const sy = e.clientY;
    const { x, y, w, h } = { x: win.x, y: win.y, w: win.w, h: win.h };
    const move = (ev: PointerEvent) => {
      setLive({ x: Math.max(0, x + ev.clientX - sx), y: Math.max(0, y + ev.clientY - sy), w, h });
    };
    const up = (ev: PointerEvent) => {
      setLive(null);
      ctrl.patchWindow(win.id, {
        x: Math.max(0, x + ev.clientX - sx),
        y: Math.max(0, y + ev.clientY - sy)
      });
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    ctrl.focusWindow(win.id);
    const sx = e.clientX;
    const sy = e.clientY;
    const { x, y, w, h } = { x: win.x, y: win.y, w: win.w, h: win.h };
    const move = (ev: PointerEvent) => {
      setLive({
        x,
        y,
        w: Math.max(MIN_W, w + ev.clientX - sx),
        h: Math.max(MIN_H, h + ev.clientY - sy)
      });
    };
    const up = (ev: PointerEvent) => {
      setLive(null);
      ctrl.patchWindow(win.id, {
        w: Math.max(MIN_W, w + ev.clientX - sx),
        h: Math.max(MIN_H, h + ev.clientY - sy)
      });
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const lc = list ? paletteColor(list.color) : null;

  return (
    <Paper
      component="section"
      elevation={0}
      onPointerDown={() => ctrl.focusWindow(win.id)}
      aria-label={`Floating list window: ${win.title}`}
      sx={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width: pos.w,
        height: pos.h,
        zIndex: 1200 + win.z,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: token("panel"),
        backgroundImage: "none",
        border: `1px solid color-mix(in srgb, ${token("accent")} 25%, ${token("edge")})`,
        borderRadius: token("radius"),
        boxShadow: "0 18px 50px rgba(0, 0, 0, 0.55)"
      }}
    >
      <Stack
        direction="row"
        onPointerDown={startDrag}
        sx={{
          alignItems: "center",
          gap: "8px",
          padding: "4px 10px",
          cursor: "grab",
          userSelect: "none",
          touchAction: "none",
          background: `color-mix(in srgb, ${token("accent")} 8%, transparent)`,
          borderBottom: `1px solid ${token("edge")}`
        }}
      >
        {lc && (
          <Box
            component="span"
            aria-hidden
            sx={{ width: 9, height: 9, borderRadius: "50%", background: lc.main, flexShrink: 0 }}
          />
        )}
        <Typography
          component="span"
          sx={{
            fontSize: 12.5,
            fontWeight: 700,
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: token("ink")
          }}
        >
          {win.title}
        </Typography>
        <IconButton
          size="small"
          title="New item"
          aria-label="New item"
          disabled={!list}
          onClick={() => {
            if (!list) return;
            const id = ctrl.addItem({ listId: list.id, parentId: null, index: -1 });
            setSelectedId(id);
          }}
          sx={{ padding: "2px", fontSize: 14, color: token("dim") }}
        >
          +
        </IconButton>
        <IconButton
          size="small"
          title="Minimize"
          aria-label="Minimize"
          onClick={() => ctrl.patchWindow(win.id, { minimized: true })}
          sx={{ padding: "2px", fontSize: 14, color: token("dim") }}
        >
          –
        </IconButton>
        <IconButton
          size="small"
          title="Close"
          aria-label="Close"
          onClick={() => ctrl.closeWindow(win.id)}
          sx={{ padding: "2px", fontSize: 14, color: token("dim"), "&:hover": { color: token("err") } }}
        >
          ×
        </IconButton>
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {list ? (
          <TaskTree
            sections={[{ list, items: list.items }]}
            showListHeaders={false}
            selectedId={selectedId}
            /* Always dense in a window regardless of the setting: the window is
               the small view by definition, and the setting is about the page. */
            dense
            crossOutDone={settings.crossOutDone}
            onSelect={setSelectedId}
            onToggleDone={ctrl.toggleDone}
            onToggleCollapse={ctrl.toggleCollapse}
            onToggleListCollapse={() => undefined}
            onRename={ctrl.rename}
            onMove={ctrl.move}
            onAddChild={(item, listId) => ctrl.addItem({ listId, parentId: item.id, index: -1 })}
            onDelete={ctrl.remove}
          />
        ) : (
          <Typography sx={{ padding: "16px", color: token("dim"), fontSize: 12.5 }}>
            This list no longer exists.
          </Typography>
        )}
      </Box>

      {/* The resize corner. Bespoke geometry, like the drag above. */}
      <Box
        onPointerDown={startResize}
        aria-hidden
        sx={{
          position: "absolute",
          right: 0,
          bottom: 0,
          width: 16,
          height: 16,
          cursor: "nwse-resize",
          touchAction: "none"
        }}
      >
        <Box
          component="span"
          sx={{
            position: "absolute",
            right: 3,
            bottom: 3,
            width: 8,
            height: 8,
            borderRight: `2px solid ${token("dim")}`,
            borderBottom: `2px solid ${token("dim")}`
          }}
        />
      </Box>
    </Paper>
  );
}

export default function TaskWindows({ ctrl }: { ctrl: TaskController }) {
  const minimized = ctrl.windows.filter((w) => w.minimized);

  return (
    <>
      {ctrl.windows
        .filter((w) => !w.minimized)
        .map((w) => (
          <WindowFrame key={w.id} win={w} ctrl={ctrl} />
        ))}

      {minimized.length > 0 && (
        <Stack
          sx={{
            position: "fixed",
            right: 8,
            top: 96,
            zIndex: 1600,
            gap: "6px",
            width: 190
          }}
        >
          {minimized.map((w) => (
            <Paper
              key={w.id}
              elevation={0}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "4px 8px",
                background: token("panel"),
                backgroundImage: "none",
                border: `1px solid ${token("edge")}`,
                borderRadius: token("radius"),
                boxShadow: "0 6px 18px rgba(0, 0, 0, 0.4)"
              }}
            >
              <ButtonBase
                title="Restore"
                onClick={() => {
                  ctrl.patchWindow(w.id, { minimized: false });
                  ctrl.focusWindow(w.id);
                }}
                sx={{
                  flex: 1,
                  minWidth: 0,
                  justifyContent: "flex-start",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  display: "block",
                  textAlign: "left",
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: token("ink")
                }}
              >
                {w.title}
              </ButtonBase>
              <IconButton
                size="small"
                title="Close"
                aria-label="Close"
                onClick={() => ctrl.closeWindow(w.id)}
                sx={{ padding: "2px", fontSize: 14, color: token("dim"), "&:hover": { color: token("err") } }}
              >
                ×
              </IconButton>
            </Paper>
          ))}
        </Stack>
      )}
    </>
  );
}
