/**
 * @file Task tree view — GizmoX's `TaskTree` (MASTER §5): collapse chevrons,
 * circle check-off with coloured cross-out, inline rename (double-click),
 * per-subtree progress counts, type/action/category chips, and drag & drop
 * (reorder, reparent, cross-list).
 *
 * ── the two markers that matter ──────────────────────────────────────────────
 *
 * Every row marks itself `data-axf-area="taskman.item"` plus `data-axf-item` /
 * `data-axf-list`, and every list header marks `data-axf-area="taskman.list"`.
 * That is the WHOLE of this file's involvement with context menus: nothing here
 * handles a `contextmenu` event, builds a menu or knows what is on one. The
 * engine walks up from the click collecting area ids, composes the rows the
 * module DECLARED (`taskman.decl.ts`), and hands the harvested `data-axf-*`
 * attributes to the command handlers through `MenuContext.data`.
 *
 * That is the fix for the failure this whole package exists for: GizmoX's menus
 * were not bad, their COVERAGE was inconsistent, because forty modules each
 * hand-wrote `useCtx` and a habit has holes. A marker cannot have a hole — the
 * conformance gate scans for it in both directions.
 *
 * ── MUI (2026-08-11) ────────────────────────────────────────────────────────
 *
 * The pre-strip original was token()-era and painted everything with inline
 * styles. Rebuilt per `no-hand-rolled-ui.md` rule 0: rows and headers are
 * `Box`/`Stack`, the row tools are `IconButton`, the rename field is a
 * `TextField`, the chips are `Chip`. What stays bespoke is the drag-zone
 * geometry (a drop lands before / after / INTO a row depending on where in its
 * height the pointer is) and the two inline SVGs, which are drawings rather
 * than controls — the same exception `Glyph` holds.
 *
 * Colours still come from `token()` and the item `PALETTE`, so a theme swap
 * recolours the chrome while a user's own item colours stay put.
 */
"use client";

import * as React from "react";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import { ACTIVE_LIST_GLOW, BUILDING_ITEM_GLOW, useTaskActivity } from "./activity";
import { paletteColor } from "./palette";
import { countItems, type DropTarget } from "./taskOps";
import type { TaskItem, TaskList } from "./types";

/** The in-flight drag. Module scope, not state: it never renders by itself, and
 *  every payload originates in this same runtime. */
let currentDrag: { id: string; listId: string } | null = null;

type Zone = "before" | "after" | "into";

export interface TaskTreeProps {
  sections: { list: TaskList; items: TaskItem[] }[];
  showListHeaders: boolean;
  selectedId: string | null;
  /** Tight row height. The page passes the setting; windows force it on. */
  dense?: boolean;
  /** Draw the coloured strike-through on completed titles. */
  crossOutDone?: boolean;
  onSelect: (id: string) => void;
  onToggleDone: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onToggleListCollapse: (listId: string) => void;
  onRename: (id: string, title: string) => void;
  onMove: (itemId: string, target: DropTarget) => void;
  onAddChild: (item: TaskItem, listId: string) => void;
  onDelete: (id: string) => void;
}

interface RowCtx {
  listId: string;
  parentId: string | null;
  index: number;
}

/** A drawing, not a control — inline SVG for the same reason `Glyph` is. */
function CheckCircle({ done, color }: { done: boolean; color: string }) {
  return (
    <svg width={17} height={17} viewBox="0 0 24 24" aria-hidden>
      <circle
        cx="12"
        cy="12"
        r="9"
        fill={done ? color : "none"}
        stroke={done ? color : token("dim")}
        strokeWidth="2"
      />
      {done && (
        <path
          d="M8 12.4l2.6 2.6L16 9.6"
          fill="none"
          stroke={token("page")}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      aria-hidden
      style={{ transition: "transform 90ms", transform: open ? "rotate(90deg)" : "none" }}
    >
      <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/** A palette dot. One component, so nine call sites cannot drift on its size. */
function Dot({ color, size = 8, dim }: { color: string; size?: number; dim?: boolean }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        opacity: dim ? 0.5 : 1,
        flexShrink: 0
      }}
    />
  );
}

/** The lowercase pill the tree uses for type / action / category / kind. */
function TagChip({ label, main, soft }: { label: string; main?: string; soft?: string }) {
  return (
    <Chip
      label={label}
      size="small"
      sx={{
        height: 17,
        borderRadius: "999px",
        textTransform: "lowercase",
        color: main ?? token("dim"),
        background: soft ?? "color-mix(in srgb, currentColor 12%, transparent)",
        "& .MuiChip-label": { padding: "0 7px", fontSize: 10, letterSpacing: "0.02em" }
      }}
    />
  );
}

export default function TaskTree(props: TaskTreeProps) {
  const [drop, setDrop] = React.useState<{ id: string; zone: Zone } | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);
  const crossOut = props.crossOutDone ?? true;
  /* Live build state. Idle on the server and on the first client frame, so a
     glow never appears in the SSR HTML for the client to have to take away. */
  const activity = useTaskActivity();

  /** Which third of the row the pointer is in. Bespoke geometry: a drop that
   *  reparents and a drop that reorders are different operations, and the only
   *  honest way to choose between them is where in the row you released. */
  const zoneFor = (e: React.DragEvent): Zone => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    if (y < rect.height * 0.28) return "before";
    if (y > rect.height * 0.72) return "after";
    return "into";
  };

  const handleDrop = (e: React.DragEvent, item: TaskItem, ctx: RowCtx, zone: Zone) => {
    const p = currentDrag;
    currentDrag = null;
    setDrop(null);
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    const target: DropTarget =
      zone === "into"
        ? { listId: ctx.listId, parentId: item.id, index: -1 }
        : {
            listId: ctx.listId,
            parentId: ctx.parentId,
            index: zone === "before" ? ctx.index : ctx.index + 1
          };
    props.onMove(p.id, target);
  };

  const renderItem = (item: TaskItem, ctx: RowCtx, depth: number): React.ReactNode => {
    const c = paletteColor(item.color);
    const hasKids = item.children.length > 0;
    const isSelected = props.selectedId === item.id;
    const dz = drop?.id === item.id ? drop.zone : null;
    const isEditing = editing === item.id;
    const kidCounts = hasKids ? countItems(item.children) : null;
    /** This exact row is the step a live builder is producing right now. */
    const isBuilding = activity.buildingItemId === item.id;

    return (
      <React.Fragment key={item.id}>
        <Stack
          direction="row"
          className="axs-tm-row"
          /* The area walk turns these three markers into the row's context
             menu; the handlers read the ids back out of `MenuContext.data`. */
          data-axf-area="taskman.item"
          data-axf-item={item.id}
          data-axf-list={ctx.listId}
          draggable={!isEditing}
          onDragStart={(e) => {
            currentDrag = { id: item.id, listId: ctx.listId };
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => {
            currentDrag = null;
            setDrop(null);
          }}
          onDragOver={(e) => {
            if (!currentDrag || currentDrag.id === item.id) return;
            e.preventDefault();
            e.stopPropagation();
            const z = zoneFor(e);
            setDrop((d) => (d?.id === item.id && d.zone === z ? d : { id: item.id, zone: z }));
          }}
          onDragLeave={() => setDrop((d) => (d?.id === item.id ? null : d))}
          onDrop={(e) => handleDrop(e, item, ctx, zoneFor(e))}
          onClick={() => props.onSelect(item.id)}
          sx={{
            alignItems: "center",
            gap: "6px",
            position: "relative",
            cursor: "pointer",
            paddingLeft: `${8 + depth * 18}px`,
            paddingRight: "8px",
            paddingTop: props.dense ? "1px" : "3px",
            paddingBottom: props.dense ? "1px" : "3px",
            borderLeft: `2px solid ${isSelected ? token("accent") : "transparent"}`,
            borderTop: dz === "before" ? `2px solid ${c.main}` : "2px solid transparent",
            borderBottom: dz === "after" ? `2px solid ${c.main}` : "2px solid transparent",
            background:
              dz === "into"
                ? c.soft
                : isSelected
                  ? `color-mix(in srgb, ${token("accent")} 10%, transparent)`
                  : undefined,
            transition: "background-color 90ms, border-color 90ms",
            // Last, so the pulse wins over the selection tint on the one row
            // that is actually being built.
            ...(isBuilding ? BUILDING_ITEM_GLOW : null)
          }}
        >
          <IconButton
            size="small"
            aria-label={item.collapsed ? "Expand" : "Collapse"}
            onClick={(e) => {
              e.stopPropagation();
              props.onToggleCollapse(item.id);
            }}
            sx={{
              padding: "2px",
              color: token("dim"),
              visibility: hasKids ? "visible" : "hidden"
            }}
          >
            <Chevron open={!item.collapsed} />
          </IconButton>

          <IconButton
            size="small"
            aria-label={item.done ? "Mark not done" : "Mark done"}
            onClick={(e) => {
              e.stopPropagation();
              props.onToggleDone(item.id);
            }}
            sx={{ padding: "2px" }}
          >
            <CheckCircle done={item.done} color={c.main} />
          </IconButton>

          <Dot color={c.main} dim={item.done} />

          {isEditing ? (
            <TextField
              autoFocus
              size="small"
              variant="outlined"
              defaultValue={item.title}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  props.onRename(item.id, (e.target as HTMLInputElement).value);
                  setEditing(null);
                }
                if (e.key === "Escape") setEditing(null);
              }}
              onBlur={(e) => {
                props.onRename(item.id, e.target.value);
                setEditing(null);
              }}
              sx={{
                flex: 1,
                minWidth: 0,
                "& .MuiInputBase-input": { fontSize: 13, padding: "1px 6px" }
              }}
            />
          ) : (
            <Typography
              component="span"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditing(item.id);
              }}
              sx={{
                flex: 1,
                minWidth: 0,
                fontSize: 13,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: item.done ? token("dim") : token("ink"),
                textDecoration: item.done && crossOut ? "line-through" : "none",
                textDecorationColor: c.main,
                textDecorationThickness: "2px"
              }}
            >
              {item.title}
            </Typography>
          )}

          {item.priority > 0 && (
            <Typography
              component="span"
              sx={{
                fontSize: 10,
                fontWeight: 800,
                color:
                  item.priority === 3
                    ? token("err")
                    : item.priority === 2
                      ? token("warn")
                      : token("dim")
              }}
            >
              {"!".repeat(item.priority)}
            </Typography>
          )}
          {item.type !== "task" && <TagChip label={item.type} main={c.main} soft={c.soft} />}
          {item.action !== "none" && <TagChip label={item.action} />}
          {item.category && <TagChip label={item.category} />}
          {kidCounts && (
            <Typography
              component="span"
              sx={{ color: token("dim"), fontSize: 10.5, fontFamily: token("mono") }}
            >
              {kidCounts.done}/{kidCounts.total}
            </Typography>
          )}

          {/* The same two operations the item context menu carries, as buttons.
              A menu row is not discoverable on its own — someone has to know to
              right-click — so the two most-used ones are also visible on hover. */}
          <Stack direction="row" className="axs-tm-rowtools" sx={{ alignItems: "center", gap: "2px" }}>
            <IconButton
              size="small"
              title="Add sub-item"
              aria-label="Add sub-item"
              onClick={(e) => {
                e.stopPropagation();
                props.onAddChild(item, ctx.listId);
              }}
              sx={{ padding: "2px", fontSize: 14, color: token("dim") }}
            >
              +
            </IconButton>
            <IconButton
              size="small"
              title="Delete item"
              aria-label="Delete item"
              onClick={(e) => {
                e.stopPropagation();
                props.onDelete(item.id);
              }}
              sx={{ padding: "2px", fontSize: 14, color: token("dim"), "&:hover": { color: token("err") } }}
            >
              ×
            </IconButton>
          </Stack>
        </Stack>
        {hasKids && !item.collapsed && (
          <Box>
            {item.children.map((child, i) =>
              renderItem(child, { listId: ctx.listId, parentId: item.id, index: i }, depth + 1)
            )}
          </Box>
        )}
      </React.Fragment>
    );
  };

  return (
    <Box
      sx={{ flex: 1, minHeight: 0, overflow: "auto", padding: "4px 0" }}
      onDragOver={(e) => {
        if (currentDrag) e.preventDefault();
      }}
      onDrop={(e) => {
        // Background drop: append to the first visible list's root.
        const p = currentDrag;
        currentDrag = null;
        setDrop(null);
        if (!p || props.sections.length === 0) return;
        e.preventDefault();
        props.onMove(p.id, { listId: props.sections[0].list.id, parentId: null, index: -1 });
      }}
    >
      {props.sections.map(({ list, items }) => {
        const lc = paletteColor(list.color);
        const counts = countItems(items);
        return (
          <Box key={list.id} sx={{ marginBottom: "4px" }}>
            {props.showListHeaders && (
              <Stack
                direction="row"
                className="axs-tm-listheader"
                data-axf-area="taskman.list"
                data-axf-list={list.id}
                onClick={() => props.onToggleListCollapse(list.id)}
                onDragOver={(e) => {
                  if (currentDrag) {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                }}
                onDrop={(e) => {
                  const p = currentDrag;
                  currentDrag = null;
                  if (!p) return;
                  e.preventDefault();
                  e.stopPropagation();
                  props.onMove(p.id, { listId: list.id, parentId: null, index: -1 });
                }}
                sx={{
                  alignItems: "center",
                  gap: "7px",
                  padding: "4px 8px",
                  margin: "0 4px",
                  cursor: "pointer",
                  borderRadius: "4px",
                  color: token("ink"),
                  // Steady glow: a build is running against this list.
                  ...(activity.activeListIds.includes(list.id) ? ACTIVE_LIST_GLOW : null)
                }}
              >
                <Box component="span" sx={{ color: token("dim"), display: "inline-flex" }}>
                  <Chevron open={!list.collapsed} />
                </Box>
                <Dot color={lc.main} size={9} />
                <Typography
                  component="span"
                  sx={{ fontWeight: 700, fontSize: 13, letterSpacing: "0.02em" }}
                >
                  {list.name}
                </Typography>
                <TagChip label={list.kind} main={lc.main} soft={lc.soft} />
                <Box sx={{ flex: 1 }} />
                <Typography
                  component="span"
                  sx={{ color: token("dim"), fontSize: 11, fontFamily: token("mono") }}
                >
                  {counts.done}/{counts.total}
                </Typography>
              </Stack>
            )}
            {!(props.showListHeaders && list.collapsed) && (
              <Box>
                {items.map((item, i) =>
                  renderItem(
                    item,
                    { listId: list.id, parentId: null, index: i },
                    props.showListHeaders ? 1 : 0
                  )
                )}
                {items.length === 0 && (
                  <Typography
                    sx={{
                      padding: `4px 0 4px ${props.showListHeaders ? 40 : 16}px`,
                      color: token("dim"),
                      fontSize: 11.5
                    }}
                  >
                    Empty — add an item or drop one here
                  </Typography>
                )}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
