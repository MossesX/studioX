/**
 * @file Generic data grid: resizable columns (drag header edges, persisted),
 * click-to-sort, expandable rows (per-row subgrid content), row drag & drop,
 * hover highlighting, and context-menu passthrough.
 *
 * PORT NOTE (GizmoX → AmberX, per the 2026-08-13 port record in PLANNING-STATE.md): the app-wide `@/lib/dnd`
 * protocol is inlined below (the module is the only consumer here, so the
 * protocol lives with its one table); the `--gxs-accent` chrome variable is
 * `GX.accent` from `./gx`; icon imports come from `./icons`; the persisted
 * column-width keys moved from `gizmox.cols.*` to `axs:amberxvid.cols.*`.
 */
"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import Checkbox from "@mui/material/Checkbox";
import { ExpandMore as ExpandMoreIcon } from "./icons";
import { ChevronRight as ChevronRightIcon } from "./icons";
import { ArrowUpward as ArrowUpwardIcon } from "./icons";
import { ArrowDownward as ArrowDownwardIcon } from "./icons";
import { VisibilityOff as VisibilityOffIcon } from "./icons";
import { ViewColumn as ViewColumnIcon } from "./icons";
import type { SxProps, Theme } from "@mui/material/styles";
import { GX, gxa } from "./gx";

/* ---------------- drag-and-drop protocol (inlined from GizmoX `@/lib/dnd`) ----
 * Payloads ride the native HTML5 DataTransfer under a custom MIME type; a
 * module-level mirror keeps the payload readable during `dragover`
 * (DataTransfer data is drop-only). */

export const DND_MIME = "application/x-axs-amberxvid";

export type DragKind =
  | "task-item"
  | "task-list"
  | "snippet"
  | "file"
  | "icon"
  | "tab"
  | "agent"
  | "card"
  | "code";

export interface DragPayload {
  kind: DragKind;
  /** Primary id (item id, file path, …). */
  id: string;
  /** Owning container id when relevant. */
  container?: string;
  /** Human label for drag previews / drops that create new content. */
  label?: string;
  /** Raw content for drops that accept text. */
  text?: string;
  /** Extra fields per kind. */
  meta?: Record<string, string>;
}

let current: DragPayload | null = null;

/** Attach a payload to a dragstart event (and the in-window mirror). */
function setDrag(e: React.DragEvent, payload: DragPayload): void {
  current = payload;
  e.dataTransfer.setData(DND_MIME, JSON.stringify(payload));
  if (payload.text) e.dataTransfer.setData("text/plain", payload.text);
  e.dataTransfer.effectAllowed = "copyMove";
}

/** Read the payload during dragover/drop. Falls back to the in-window mirror. */
function getDrag(e: React.DragEvent): DragPayload | null {
  const raw = e.dataTransfer.getData(DND_MIME);
  if (raw) {
    try {
      return JSON.parse(raw) as DragPayload;
    } catch {
      /* fall through */
    }
  }
  return current;
}

/** True when an in-flight drag carries one of the accepted kinds. */
function dragAccepts(e: React.DragEvent, kinds: DragKind[]): boolean {
  if (!e.dataTransfer.types.includes(DND_MIME)) return false;
  return current ? kinds.includes(current.kind) : true;
}

/** Clear the mirror on dragend so stale payloads never leak between drags. */
function clearDrag(): void {
  current = null;
}

/* --------------------------------- table ---------------------------------- */

export interface ColumnDef<T> {
  key: string;
  label: React.ReactNode;
  width: number;
  minWidth?: number;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  sortValue?: (row: T) => string | number;
  render: (row: T) => React.ReactNode;
}

export interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  storageKey?: string;
  dense?: boolean;
  emptyText?: string;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  onRowClick?: (row: T) => void;
  onRowDoubleClick?: (row: T) => void;
  onRowContextMenu?: (e: React.MouseEvent, row: T) => void;
  /**
   * Extra attributes for a row's `<tr>` — how a table joins the declared
   * context-menu map (P15).
   *
   * The engine harvests `data-axf-*` up the DOM from wherever the click landed,
   * so a table whose rows carry the area marker gets the same menu a card grid
   * of the same things gets. Without this the grid view of a surface would
   * silently right-click into its container's rows only, while the card view of
   * the SAME data offered the full set — which is exactly the inconsistent
   * coverage the declared map exists to end.
   */
  rowAttrs?: (row: T) => Record<string, string>;
  /** Return subgrid content to make a row expandable; null hides the chevron. */
  expandable?: (row: T) => React.ReactNode | null;
  /** Rows expanded by default (keys). */
  defaultExpanded?: string[];
  rowSx?: (row: T) => SxProps<Theme>;
  dragPayload?: (row: T) => DragPayload | null;
  acceptKinds?: DragKind[];
  /**
   * A row was dropped onto `target`.
   *
   * `where` describes the landing site in the CURRENT display order, which the
   * caller cannot compute: it has the unsorted array, this component has the
   * sorted one. `above` is the row immediately before the target — what an
   * "insert here" drop lands underneath — and is null when the target is the
   * first row.
   */
  onRowDrop?: (payload: DragPayload, target: T, where: { index: number; above: T | null }) => void;
  onBackgroundDrop?: (payload: DragPayload) => void;
  selectedKey?: string | null;
  /**
   * Highlighted rows, by key. Selection is *highlighting* — no checkbox column,
   * no gutter: click to select, ctrl/cmd-click to add or remove one, shift-click
   * to take the run between the anchor and the row clicked.
   *
   * The range is computed in display order, which is why it is computed here:
   * "everything between these two rows" means what is on screen, not what the
   * unsorted source array happens to hold.
   */
  selectedKeys?: string[];
  onSelectionChange?: (keys: string[]) => void;
  /** Fired whenever the sort changes, including to none. */
  onSortChange?: (sort: { key: string; dir: "asc" | "desc" } | null) => void;
}

export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  storageKey,
  dense,
  emptyText = "Nothing here yet",
  defaultSort,
  onRowClick,
  onRowDoubleClick,
  onRowContextMenu,
  rowAttrs,
  expandable,
  defaultExpanded,
  rowSx,
  dragPayload,
  acceptKinds,
  onRowDrop,
  onBackgroundDrop,
  selectedKey,
  selectedKeys,
  onSelectionChange,
  onSortChange
}: DataTableProps<T>) {
  const [widths, setWidths] = React.useState<Record<string, number>>({});
  const [sort, setSort] = React.useState<{ key: string; dir: "asc" | "desc" } | null>(
    defaultSort ?? null
  );
  const [expanded, setExpanded] = React.useState<Set<string>>(
    () => new Set(defaultExpanded ?? [])
  );
  const [dropRow, setDropRow] = React.useState<string | null>(null);
  const [hiddenCols, setHiddenCols] = React.useState<Set<string>>(new Set());
  const [headerMenu, setHeaderMenu] = React.useState<{ x: number; y: number; colKey: string } | null>(null);

  React.useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(`axs:amberxvid.cols.${storageKey}`);
      if (raw) setWidths(JSON.parse(raw));
      const hidden = localStorage.getItem(`axs:amberxvid.cols.${storageKey}.hidden`);
      if (hidden) setHiddenCols(new Set(JSON.parse(hidden)));
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  const colWidth = (c: ColumnDef<T>) => widths[c.key] ?? c.width;

  const persistHidden = (next: Set<string>) => {
    if (storageKey) {
      try {
        localStorage.setItem(`axs:amberxvid.cols.${storageKey}.hidden`, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
    }
  };

  const hideColumn = (colKey: string) => {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      next.add(colKey);
      persistHidden(next);
      return next;
    });
    setHeaderMenu(null);
  };

  const showColumn = (colKey: string) => {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      next.delete(colKey);
      persistHidden(next);
      return next;
    });
  };

  const showAllColumns = () => {
    setHiddenCols(() => {
      const next = new Set<string>();
      persistHidden(next);
      return next;
    });
    setHeaderMenu(null);
  };

  // Filter out hidden columns for rendering
  const visibleColumns = columns.filter((c) => !hiddenCols.has(c.key));

  const startResize = (e: React.PointerEvent, c: ColumnDef<T>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidth(c);
    const min = c.minWidth ?? 48;
    const move = (ev: PointerEvent) => {
      const w = Math.max(min, startW + (ev.clientX - startX));
      setWidths((prev) => ({ ...prev, [c.key]: w }));
    };
    const up = (ev: PointerEvent) => {
      const w = Math.max(min, startW + (ev.clientX - startX));
      setWidths((prev) => {
        const next = { ...prev, [c.key]: w };
        if (storageKey) {
          try {
            localStorage.setItem(`axs:amberxvid.cols.${storageKey}`, JSON.stringify(next));
          } catch {
            /* ignore */
          }
        }
        return next;
      });
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const sorted = React.useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return 0;
    });
  }, [rows, sort, columns]);

  const toggleSort = (c: ColumnDef<T>) => {
    if (!c.sortable) return;
    setSort((prev) => {
      const next =
        !prev || prev.key !== c.key
          ? ({ key: c.key, dir: "asc" } as const)
          : prev.dir === "asc"
            ? ({ key: c.key, dir: "desc" } as const)
            : null;
      // Reported, not just kept: a caller may only offer row reordering while
      // the table is in a particular order, and it cannot know the order from
      // the outside.
      onSortChange?.(next);
      return next;
    });
  };

  /* ------------------------------- selection -------------------------------- */

  /** Where a shift-click measures its run from — the last plain click. */
  const anchor = React.useRef<string | null>(null);
  const selected = React.useMemo(() => new Set(selectedKeys ?? []), [selectedKeys]);

  /**
   * One click, three meanings. The range case is why this lives here: `sorted`
   * is the display order, and "between these two rows" is a statement about
   * what the reader can see, not about the source array.
   */
  const selectRow = (key: string, e: React.MouseEvent) => {
    if (!onSelectionChange) return;
    const additive = e.ctrlKey || e.metaKey;
    if (e.shiftKey && anchor.current) {
      const order = sorted.map(rowKey);
      const from = order.indexOf(anchor.current);
      const to = order.indexOf(key);
      if (from >= 0 && to >= 0) {
        const run = order.slice(Math.min(from, to), Math.max(from, to) + 1);
        onSelectionChange(additive ? [...new Set([...(selectedKeys ?? []), ...run])] : run);
        return;
      }
    }
    anchor.current = key;
    if (additive) {
      const next = new Set(selectedKeys ?? []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      onSelectionChange([...next]);
      return;
    }
    // A plain click on the only selected row clears it, so there is a way back
    // to "nothing selected" that is not a keyboard shortcut nobody knows.
    onSelectionChange(selected.size === 1 && selected.has(key) ? [] : [key]);
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const cellPad = dense ? "3px 8px" : "6px 10px";
  const hasExpand = Boolean(expandable);
  const totalCols = visibleColumns.length + (hasExpand ? 1 : 0);

  return (
    <Box
      sx={{ overflow: "auto", flex: 1, minHeight: 0, position: "relative" }}
      onDragOver={(e) => {
        if (acceptKinds && dragAccepts(e, acceptKinds)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(e) => {
        if (!acceptKinds) return;
        const p = getDrag(e);
        if (p && acceptKinds.includes(p.kind) && onBackgroundDrop) {
          e.preventDefault();
          onBackgroundDrop(p);
        }
        clearDrag();
        setDropRow(null);
      }}
    >
      <Box
        component="table"
        sx={{
          width: "max-content",
          minWidth: "100%",
          borderCollapse: "collapse",
          tableLayout: "fixed",
          fontSize: 13
        }}
      >
        <Box component="colgroup">
          {hasExpand && <Box component="col" sx={{ width: 34 }} />}
          {visibleColumns.map((c) => (
            <Box component="col" key={c.key} sx={{ width: colWidth(c) }} />
          ))}
        </Box>
        <Box component="thead">
          <Box component="tr">
            {hasExpand && (
              <Box
                component="th"
                sx={{
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                  bgcolor: "background.paper",
                  borderBottom: "1px solid rgba(255,255,255,0.09)"
                }}
              />
            )}
            {visibleColumns.map((c) => (
              <Box
                component="th"
                key={c.key}
                onClick={() => toggleSort(c)}
                onContextMenu={(e: React.MouseEvent) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setHeaderMenu({ x: e.clientX, y: e.clientY, colKey: c.key });
                }}
                sx={{
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                  bgcolor: "background.paper",
                  textAlign: c.align ?? "left",
                  fontWeight: 600,
                  fontSize: 11.5,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "text.secondary",
                  padding: cellPad,
                  borderBottom: "1px solid rgba(255,255,255,0.09)",
                  cursor: c.sortable ? "pointer" : "default",
                  userSelect: "none",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  "&:hover": c.sortable ? { color: "primary.main" } : undefined
                }}
              >
                <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, maxWidth: "100%" }}>
                  <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                    {c.label}
                  </Box>
                  {sort?.key === c.key &&
                    (sort.dir === "asc" ? (
                      <ArrowUpwardIcon sx={{ fontSize: 12 }} />
                    ) : (
                      <ArrowDownwardIcon sx={{ fontSize: 12 }} />
                    ))}
                </Box>
                <Box
                  onPointerDown={(e) => startResize(e, c)}
                  onClick={(e) => e.stopPropagation()}
                  sx={{
                    position: "absolute",
                    right: -3,
                    top: 0,
                    bottom: 0,
                    width: 7,
                    cursor: "col-resize",
                    zIndex: 2,
                    "&:hover": { bgcolor: gxa(GX.accent, "66") }
                  }}
                />
              </Box>
            ))}
          </Box>
        </Box>
        <Box component="tbody">
          {sorted.length === 0 && (
            <Box component="tr">
              <Box component="td" colSpan={totalCols} sx={{ p: 3, textAlign: "center" }}>
                <Typography variant="body2" color="text.disabled">
                  {emptyText}
                </Typography>
              </Box>
            </Box>
          )}
          {sorted.map((row, rowIndex) => {
            const key = rowKey(row);
            const sub = expandable?.(row) ?? null;
            const isOpen = expanded.has(key);
            const extraSx = rowSx?.(row) ?? {};
            const isSelected = selected.has(key);
            return (
              <React.Fragment key={key}>
                <Box
                  component="tr"
                  draggable={Boolean(dragPayload)}
                  onDragStart={(e: React.DragEvent) => {
                    const p = dragPayload?.(row);
                    if (p) setDrag(e, p);
                    else e.preventDefault();
                  }}
                  onDragEnd={clearDrag}
                  onDragOver={(e: React.DragEvent) => {
                    if (acceptKinds && dragAccepts(e, acceptKinds) && onRowDrop) {
                      e.preventDefault();
                      e.stopPropagation();
                      setDropRow(key);
                    }
                  }}
                  onDragLeave={() => setDropRow((d) => (d === key ? null : d))}
                  onDrop={(e: React.DragEvent) => {
                    if (!acceptKinds || !onRowDrop) return;
                    const p = getDrag(e);
                    if (p && acceptKinds.includes(p.kind)) {
                      e.preventDefault();
                      e.stopPropagation();
                      onRowDrop(p, row, { index: rowIndex, above: rowIndex > 0 ? sorted[rowIndex - 1] : null });
                    }
                    clearDrag();
                    setDropRow(null);
                  }}
                  onClick={(e: React.MouseEvent) => {
                    selectRow(key, e);
                    onRowClick?.(row);
                  }}
                  onDoubleClick={() => onRowDoubleClick?.(row)}
                  onContextMenu={(e: React.MouseEvent) => onRowContextMenu?.(e, row)}
                  {...(rowAttrs?.(row) ?? {})}
                  sx={{
                    cursor: onRowClick || onRowDoubleClick || onSelectionChange ? "pointer" : "default",
                    bgcolor:
                      dropRow === key
                        ? gxa(GX.accent, "2E")
                        : isSelected
                          ? gxa(GX.accent, "33")
                          : selectedKey === key
                            ? gxa(GX.accent, "1A")
                            : "transparent",
                    // The drop target grows an accent line along its TOP edge,
                    // because a row lands ABOVE the row it is dropped on and a
                    // tint alone does not say which side.
                    ...(dropRow === key
                      ? { "& td": { borderTop: `2px solid ${GX.accent}` } }
                      : null),
                    transition: "background-color 90ms",
                    "&:hover": {
                      bgcolor: dropRow === key
                        ? gxa(GX.accent, "38")
                        : isSelected
                          ? gxa(GX.accent, "42")
                          : "rgba(255,255,255,0.055)",
                      "& td": { color: "text.primary" }
                    },
                    ...extraSx
                  }}
                >
                  {hasExpand && (
                    <Box
                      component="td"
                      sx={{ padding: "0 0 0 4px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}
                    >
                      {sub != null && (
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(key);
                          }}
                          sx={{ p: 0.25 }}
                        >
                          {isOpen ? (
                            <ExpandMoreIcon sx={{ fontSize: 17 }} />
                          ) : (
                            <ChevronRightIcon sx={{ fontSize: 17 }} />
                          )}
                        </IconButton>
                      )}
                    </Box>
                  )}
                  {visibleColumns.map((c) => (
                    <Box
                      component="td"
                      key={c.key}
                      sx={{
                        padding: cellPad,
                        textAlign: c.align ?? "left",
                        borderBottom: "1px solid rgba(255,255,255,0.05)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        verticalAlign: "middle"
                      }}
                    >
                      {c.render(row)}
                    </Box>
                  ))}
                </Box>
                {sub != null && isOpen && (
                  <Box component="tr">
                    <Box
                      component="td"
                      colSpan={totalCols}
                      sx={{
                        p: 0,
                        borderBottom: "1px solid rgba(255,255,255,0.06)",
                        bgcolor: "rgba(255,255,255,0.02)"
                      }}
                    >
                      <Box sx={{ pl: 4, pr: 1, py: 1 }}>{sub}</Box>
                    </Box>
                  </Box>
                )}
              </React.Fragment>
            );
          })}
        </Box>
      </Box>

      {/* Column header context menu — hide/show columns */}
      <Menu
        open={headerMenu !== null}
        onClose={() => setHeaderMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={headerMenu ? { left: headerMenu.x, top: headerMenu.y } : undefined}
      >
        {headerMenu && (
          <MenuItem onClick={() => hideColumn(headerMenu.colKey)} sx={{ fontSize: 13 }}>
            <ListItemIcon sx={{ minWidth: 30 }}>
              <VisibilityOffIcon sx={{ fontSize: 17 }} />
            </ListItemIcon>
            <ListItemText slotProps={{ primary: { sx: { fontSize: 13 } } }}>
              Hide “{String(columns.find((c) => c.key === headerMenu.colKey)?.label ?? headerMenu.colKey)}”
            </ListItemText>
          </MenuItem>
        )}
        <Divider />
        <Typography sx={{ px: 2, py: 0.5, fontSize: 10.5, letterSpacing: 1.2, color: "text.disabled", textTransform: "uppercase" }}>
          Columns
        </Typography>
        {columns.map((c) => {
          const isHidden = hiddenCols.has(c.key);
          return (
            <MenuItem
              key={c.key}
              onClick={() => (isHidden ? showColumn(c.key) : hideColumn(c.key))}
              sx={{ fontSize: 13, py: 0.25 }}
            >
              <ListItemIcon sx={{ minWidth: 30 }}>
                <Checkbox
                  edge="start"
                  checked={!isHidden}
                  size="small"
                  tabIndex={-1}
                  disableRipple
                  sx={{ p: 0.25 }}
                />
              </ListItemIcon>
              <ListItemText slotProps={{ primary: { sx: { fontSize: 13 } } }}>
                {String(c.label)}
              </ListItemText>
            </MenuItem>
          );
        })}
        {hiddenCols.size > 0 && (
          <>
            <Divider />
            <MenuItem onClick={showAllColumns} sx={{ fontSize: 13 }}>
              <ListItemIcon sx={{ minWidth: 30 }}>
                <ViewColumnIcon sx={{ fontSize: 17 }} />
              </ListItemIcon>
              <ListItemText slotProps={{ primary: { sx: { fontSize: 13 } } }}>
                Show all columns
              </ListItemText>
            </MenuItem>
          </>
        )}
      </Menu>
    </Box>
  );
}
