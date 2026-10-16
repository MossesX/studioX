/**
 * @file Task grid view — GizmoX's `TaskGrid` (MASTER §5): sortable columns,
 * rows expandable into their children, checkbox check-off with coloured
 * cross-out, and drag & drop (dropping ON a row nests into it, dropping on
 * empty space appends to the list). In "all lists" scope each list gets a group
 * header row carrying its progress bar, exactly as GizmoX does.
 *
 * ── why this is a real MUI Table now ────────────────────────────────────────
 *
 * Both earlier versions of this file hand-rolled their table, and each had the
 * same reason at the time: GizmoX builds it on a shared `DataTable`, and the
 * pre-strip port said *"studio has no such component and inventing one as a
 * side effect of porting a module would be a framework decision taken in the
 * wrong place"*. That was right then. It is wrong now — `no-hand-rolled-ui.md`
 * rule 0 says that where an MUI component exists it is used, and `check:ui`
 * lists `<table>` → `Table / TableHead / TableBody / TableRow / TableCell` by
 * name. So the grid is an MUI table, sorted through `TableSortLabel`.
 *
 * ── one table, not a table per depth ────────────────────────────────────────
 *
 * The pre-strip version rendered a NESTED grid per expanded row, each with its
 * own header and its own track list offset by `paddingLeft`. The consequence
 * was that a child row's columns did not line up with its parent's — the one
 * thing a grid exists to do. Here the tree is FLATTENED into one table
 * according to what is expanded, and depth is expressed as indentation in the
 * title cell alone. Every column lines up at every depth, and there is one
 * header rather than one per subtree.
 *
 * Sorting applies to SIBLINGS at every level (`sortSiblings` recurses), so the
 * tree survives being sorted instead of collapsing into a flat list. Sorting a
 * copy is deliberate: sorting the store's array in place would mutate the
 * source of truth every other surface renders from.
 *
 * ── expansion is local, and starts closed ───────────────────────────────────
 *
 * Deliberately NOT the store's `item.collapsed`, which the tree owns. The grid
 * is the flat, sortable view — it opens showing top-level rows, and expanding
 * one here does not reorganise the tree behind it. Two views, two reading
 * positions, one set of data.
 *
 * Area markers ride on the rows exactly as they do in `TaskTree`, so the same
 * declared context menus resolve here with no extra wiring.
 */
"use client";

import * as React from "react";

import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import { ACTIVE_LIST_GLOW, BUILDING_ITEM_GLOW, useTaskActivity } from "./activity";
import { paletteColor } from "./palette";
import { countItems, PRIORITY_LABELS, type DropTarget } from "./taskOps";
import type { TaskItem, TaskList } from "./types";

/** The in-flight drag. Module scope, not state: it never renders by itself. */
let currentDrag: { id: string; listId: string } | null = null;

type SortKey = "title" | "type" | "action" | "category" | "priority" | "sub";

interface Column {
  key: SortKey | null;
  label: string;
  width?: number;
  align?: "center";
}

/** The nine columns, declared once — the head and every row read this, so a
 *  column added here cannot line up in one place and not the other. */
const COLUMNS: readonly Column[] = [
  { key: null, label: "", width: 30 },
  { key: null, label: "", width: 38 },
  { key: "title", label: "Title" },
  { key: "type", label: "Type", width: 92 },
  { key: "action", label: "Action", width: 96 },
  { key: "category", label: "Category", width: 110 },
  { key: "priority", label: "Pri", width: 60, align: "center" },
  { key: "sub", label: "Sub", width: 60, align: "center" },
  { key: null, label: "Colour", width: 62, align: "center" }
];

export interface TaskGridProps {
  sections: { list: TaskList; items: TaskItem[] }[];
  showListHeaders: boolean;
  selectedId: string | null;
  crossOut?: boolean;
  onSelect: (id: string) => void;
  onToggleDone: (id: string) => void;
  onMove: (itemId: string, target: DropTarget) => void;
  onAddChild: (item: TaskItem, listId: string) => void;
  onDelete: (id: string) => void;
  onToggleListCollapse: (listId: string) => void;
  onOpenListWindow: (listId: string) => void;
}

type Sort = { key: SortKey; dir: 1 | -1 } | null;

/** One flattened row: what to draw and how deep it sits. */
interface Row {
  item: TaskItem;
  listId: string;
  depth: number;
}

function sortValue(it: TaskItem, key: SortKey): string | number {
  switch (key) {
    case "title":
      return it.title.toLowerCase();
    case "type":
      return it.type;
    case "action":
      return it.action;
    case "category":
      return it.category;
    case "priority":
      return it.priority;
    case "sub":
      return countItems(it.children).total;
  }
}

/** Sort a sibling set, and every sibling set beneath it. A copy at each level:
 *  the arrays belong to the store. */
function sortSiblings(items: readonly TaskItem[], sort: Sort): TaskItem[] {
  if (!sort) return items as TaskItem[];
  const sorted = [...items].sort((a, b) => {
    const av = sortValue(a, sort.key);
    const bv = sortValue(b, sort.key);
    if (av === bv) return 0;
    return (av < bv ? -1 : 1) * sort.dir;
  });
  return sorted.map((it) =>
    it.children.length ? { ...it, children: sortSiblings(it.children, sort) } : it
  );
}

/** Depth-first walk, descending only into expanded rows. */
function flatten(
  items: readonly TaskItem[],
  listId: string,
  depth: number,
  expanded: ReadonlySet<string>,
  out: Row[]
): Row[] {
  for (const item of items) {
    out.push({ item, listId, depth });
    if (item.children.length && expanded.has(item.id)) {
      flatten(item.children, listId, depth + 1, expanded, out);
    }
  }
  return out;
}

/** The lowercase pill, matching the tree's. */
function TagChip({ label, main, soft }: { label: string; main?: string; soft?: string }) {
  return (
    <Chip
      label={label}
      size="small"
      sx={{
        height: 17,
        maxWidth: "100%",
        borderRadius: "999px",
        textTransform: "lowercase",
        color: main ?? token("dim"),
        background: soft ?? "color-mix(in srgb, currentColor 12%, transparent)",
        "& .MuiChip-label": { padding: "0 7px", fontSize: 10, letterSpacing: "0.02em" }
      }}
    />
  );
}

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

/** Shared cell padding — dense, and set in one place. */
const CELL_SX = { padding: "2px 6px", borderBottom: "none", fontSize: 13 } as const;

export default function TaskGrid(props: TaskGridProps) {
  const [sort, setSort] = React.useState<Sort>(null);
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(() => new Set());
  const [dropId, setDropId] = React.useState<string | null>(null);
  const crossOut = props.crossOut !== false;
  /* Both views honour the build glow — a step that is building looks the same
     whichever way you happen to be reading the list. */
  const activity = useTaskActivity();

  /** Click cycles ascending → descending → unsorted. The third state matters:
   *  without it there is no way back to the authored order, which is the order
   *  the tree shows and the one drag & drop actually edits. */
  const toggleSort = (key: SortKey) =>
    setSort((s) => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));

  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const itemRow = (row: Row) => {
    const { item, listId, depth } = row;
    const c = paletteColor(item.color);
    const kids = countItems(item.children);
    const hasKids = item.children.length > 0;
    const isOpen = expanded.has(item.id);
    const isSelected = props.selectedId === item.id;

    return (
      <TableRow
        key={item.id}
        className="axs-tm-row"
        data-axf-area="taskman.item"
        data-axf-item={item.id}
        data-axf-list={listId}
        draggable
        onDragStart={(e) => {
          currentDrag = { id: item.id, listId };
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragEnd={() => {
          currentDrag = null;
          setDropId(null);
        }}
        onDragOver={(e) => {
          if (!currentDrag || currentDrag.id === item.id) return;
          e.preventDefault();
          e.stopPropagation();
          setDropId(item.id);
        }}
        onDragLeave={() => setDropId((d) => (d === item.id ? null : d))}
        onDrop={(e) => {
          const p = currentDrag;
          currentDrag = null;
          setDropId(null);
          if (!p) return;
          e.preventDefault();
          e.stopPropagation();
          // Dropping ON a grid row nests into it — the grid has no
          // before/after zones, because its rows are a table, not an outline.
          props.onMove(p.id, { listId, parentId: item.id, index: -1 });
        }}
        onClick={() => props.onSelect(item.id)}
        sx={{
          cursor: "pointer",
          borderLeft: `2px solid ${isSelected ? token("accent") : "transparent"}`,
          background:
            dropId === item.id
              ? c.soft
              : isSelected
                ? `color-mix(in srgb, ${token("accent")} 10%, transparent)`
                : undefined,
          ...(activity.buildingItemId === item.id ? BUILDING_ITEM_GLOW : null)
        }}
      >
        <TableCell sx={{ ...CELL_SX, width: 30 }}>
          <IconButton
            size="small"
            aria-label={isOpen ? "Collapse" : "Expand"}
            onClick={(e) => {
              e.stopPropagation();
              toggle(item.id);
            }}
            sx={{
              padding: "2px",
              color: token("dim"),
              visibility: hasKids ? "visible" : "hidden"
            }}
          >
            <Box
              component="span"
              aria-hidden
              sx={{
                display: "inline-block",
                fontSize: 13,
                lineHeight: 1,
                transition: "transform 90ms",
                transform: isOpen ? "rotate(90deg)" : "none"
              }}
            >
              ›
            </Box>
          </IconButton>
        </TableCell>

        <TableCell sx={{ ...CELL_SX, width: 38, textAlign: "center" }}>
          <Checkbox
            checked={item.done}
            size="small"
            slotProps={{
              input: { "aria-label": item.done ? "Mark not done" : "Mark done" }
            }}
            onClick={(e) => e.stopPropagation()}
            onChange={() => props.onToggleDone(item.id)}
            sx={{ padding: "2px", color: c.main, "&.Mui-checked": { color: c.main } }}
          />
        </TableCell>

        <TableCell sx={{ ...CELL_SX, minWidth: 0 }}>
          {/* Depth lives here and nowhere else — that is what keeps every other
              column aligned across the whole table. */}
          <Stack
            direction="row"
            sx={{ alignItems: "center", gap: "6px", minWidth: 0, paddingLeft: `${depth * 16}px` }}
          >
            <Dot color={c.main} dim={item.done} />
            <Typography
              component="span"
              sx={{
                fontSize: 13,
                minWidth: 0,
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
            <Stack
              direction="row"
              className="axs-tm-rowtools"
              sx={{ alignItems: "center", gap: "2px", marginLeft: "auto" }}
            >
              <IconButton
                size="small"
                title="Add sub-item"
                aria-label="Add sub-item"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onAddChild(item, listId);
                  // Expand, or the child lands somewhere the reader cannot see.
                  setExpanded((s) => new Set(s).add(item.id));
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
                sx={{
                  padding: "2px",
                  fontSize: 14,
                  color: token("dim"),
                  "&:hover": { color: token("err") }
                }}
              >
                ×
              </IconButton>
            </Stack>
          </Stack>
        </TableCell>

        <TableCell sx={{ ...CELL_SX, width: 92 }}>
          <TagChip label={item.type} main={c.main} soft={c.soft} />
        </TableCell>
        <TableCell sx={{ ...CELL_SX, width: 96 }}>
          {item.action !== "none" && <TagChip label={item.action} />}
        </TableCell>
        <TableCell sx={{ ...CELL_SX, width: 110, minWidth: 0 }}>
          {item.category && <TagChip label={item.category} />}
        </TableCell>
        <TableCell
          sx={{
            ...CELL_SX,
            width: 60,
            textAlign: "center",
            fontSize: 11,
            fontWeight: 800,
            color:
              item.priority === 3
                ? token("err")
                : item.priority === 2
                  ? token("warn")
                  : token("dim")
          }}
        >
          {item.priority === 0 ? "" : PRIORITY_LABELS[item.priority]}
        </TableCell>
        <TableCell
          sx={{
            ...CELL_SX,
            width: 60,
            textAlign: "center",
            color: token("dim"),
            fontSize: 11,
            fontFamily: token("mono")
          }}
        >
          {kids.total === 0 ? "" : `${kids.done}/${kids.total}`}
        </TableCell>
        <TableCell sx={{ ...CELL_SX, width: 62 }}>
          <Stack direction="row" sx={{ justifyContent: "center" }}>
            <Dot color={c.main} size={10} />
          </Stack>
        </TableCell>
      </TableRow>
    );
  };

  /** A list's group header — one full-width cell, because a list and an item
   *  do not share a column vocabulary and pretending they do is what made the
   *  pre-strip version render two different track lists. */
  const listRow = (list: TaskList, items: TaskItem[]) => {
    const c = paletteColor(list.color);
    const counts = countItems(items);
    const pct = counts.total === 0 ? 0 : Math.round((counts.done / counts.total) * 100);
    const open = !list.collapsed;
    return (
      <TableRow
        key={`list-${list.id}`}
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
          cursor: "pointer",
          ...(activity.activeListIds.includes(list.id) ? ACTIVE_LIST_GLOW : null)
        }}
      >
        <TableCell
          colSpan={COLUMNS.length}
          sx={{ padding: "3px 6px", borderBottom: `1px solid ${token("edge")}` }}
        >
          <Stack direction="row" sx={{ alignItems: "center", gap: "8px", minWidth: 0 }}>
            <IconButton
              size="small"
              aria-label={open ? "Collapse list" : "Expand list"}
              onClick={(e) => {
                e.stopPropagation();
                props.onToggleListCollapse(list.id);
              }}
              sx={{ padding: "2px", color: token("dim") }}
            >
              <Box
                component="span"
                aria-hidden
                sx={{
                  display: "inline-block",
                  fontSize: 13,
                  lineHeight: 1,
                  transition: "transform 90ms",
                  transform: open ? "rotate(90deg)" : "none"
                }}
              >
                ›
              </Box>
            </IconButton>
            <Dot color={c.main} size={9} />
            <Typography
              component="span"
              sx={{
                fontSize: 13,
                fontWeight: 700,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              }}
            >
              {list.name}
            </Typography>
            <TagChip label={list.kind} main={c.main} soft={c.soft} />
            <Stack direction="row" className="axs-tm-rowtools" sx={{ alignItems: "center" }}>
              <IconButton
                size="small"
                title="Open as floating window"
                aria-label="Open as floating window"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onOpenListWindow(list.id);
                }}
                sx={{ padding: "2px", fontSize: 13, color: token("dim") }}
              >
                ⧉
              </IconButton>
            </Stack>
            <Box sx={{ flex: 1, minWidth: 60, maxWidth: 220 }}>
              <LinearProgress
                variant="determinate"
                value={pct}
                aria-label={`${list.name} progress`}
                sx={{
                  height: 6,
                  borderRadius: "3px",
                  background: "color-mix(in srgb, currentColor 12%, transparent)",
                  "& .MuiLinearProgress-bar": { background: c.main }
                }}
              />
            </Box>
            <Typography
              component="span"
              sx={{ color: token("dim"), fontSize: 11, fontFamily: token("mono") }}
            >
              {counts.done}/{counts.total}
            </Typography>
          </Stack>
        </TableCell>
      </TableRow>
    );
  };

  /* The rows, in draw order: a group header per list when the scope is "all",
     then that list's flattened, sorted, expanded-only items. */
  const body: React.ReactNode[] = [];
  for (const { list, items } of props.sections) {
    if (props.showListHeaders) {
      body.push(listRow(list, items));
      if (list.collapsed) continue;
    }
    const rows = flatten(sortSiblings(items, sort), list.id, props.showListHeaders ? 1 : 0, expanded, []);
    for (const row of rows) body.push(itemRow(row));
    if (rows.length === 0) {
      body.push(
        <TableRow key={`empty-${list.id}`}>
          <TableCell colSpan={COLUMNS.length} sx={{ ...CELL_SX, color: token("dim"), fontSize: 11.5 }}>
            No items — drop something here
          </TableCell>
        </TableRow>
      );
    }
  }

  return (
    <Box
      sx={{ flex: 1, minHeight: 0, overflow: "auto" }}
      onDragOver={(e) => {
        if (currentDrag) e.preventDefault();
      }}
      onDrop={(e) => {
        // Background drop: append to the first visible list's root, the same
        // rule the tree uses.
        const p = currentDrag;
        currentDrag = null;
        setDropId(null);
        if (!p || props.sections.length === 0) return;
        e.preventDefault();
        props.onMove(p.id, { listId: props.sections[0].list.id, parentId: null, index: -1 });
      }}
    >
      <Table size="small" stickyHeader sx={{ tableLayout: "fixed" }}>
        <TableHead>
          <TableRow>
            {COLUMNS.map((col, i) => (
              <TableCell
                key={col.label || `spacer-${i}`}
                sortDirection={sort?.key === col.key ? (sort.dir === 1 ? "asc" : "desc") : false}
                sx={{
                  width: col.width,
                  padding: "2px 6px",
                  background: token("panel"),
                  borderBottom: `1px solid ${token("edge")}`,
                  textAlign: col.align,
                  fontFamily: token("mono"),
                  fontSize: 10,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: token("dim"),
                  whiteSpace: "nowrap"
                }}
              >
                {col.key ? (
                  <TableSortLabel
                    active={sort?.key === col.key}
                    direction={sort?.key === col.key && sort.dir === -1 ? "desc" : "asc"}
                    onClick={() => toggleSort(col.key as SortKey)}
                    sx={{
                      color: "inherit",
                      "&.Mui-active": { color: token("accent") },
                      "&.Mui-active .MuiTableSortLabel-icon": { color: token("accent") }
                    }}
                  >
                    {col.label}
                  </TableSortLabel>
                ) : (
                  col.label
                )}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>{body}</TableBody>
      </Table>
    </Box>
  );
}
