"use client";

/**
 * @file The Data panel's viewing formats — one dataset, four honest renders.
 *
 *   - **JsonTree** — collapsible tree over parsed JSON, keyed by path so a
 *     re-render keeps what you opened open.
 *   - **TableView** — MUI table when the JSON is (or wraps) an array of
 *     objects; says so plainly when it is not, instead of inventing columns.
 *   - **Markdown** — claude-workspace's safe block renderer, imported rather
 *     than re-derived: no `dangerouslySetInnerHTML` exists there and none
 *     arrives here.
 *   - **RawView** — the bytes, monospace, scrollable.
 *
 * All four take strings/parsed values, never datasets — the panel owns the
 * "which dataset, which format" decision, these own the pixels.
 */
import * as React from "react";

import Box from "@mui/material/Box";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

export const MONO = { fontFamily: token("mono"), fontVariantNumeric: "tabular-nums" } as const;

/* ── JSON tree ───────────────────────────────────────────────────────────── */

function isLeaf(v: unknown): boolean {
  return v === null || typeof v !== "object";
}

function leafLabel(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v.length > 300 ? `${v.slice(0, 300)}…` : v);
  return String(v);
}

function NodeRow({
  name,
  value,
  path,
  depth,
  open,
  toggle
}: {
  name: string;
  value: unknown;
  path: string;
  depth: number;
  open: ReadonlySet<string>;
  toggle: (path: string) => void;
}) {
  const leaf = isLeaf(value);
  const isOpen = open.has(path) || depth === 0;
  const entries: [string, unknown][] = leaf
    ? []
    : Array.isArray(value)
      ? value.map((v, i) => [String(i), v] as [string, unknown])
      : Object.entries(value as Record<string, unknown>);
  const badge = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`;
  return (
    <Box sx={{ ml: depth === 0 ? 0 : 2 }}>
      <Box
        onClick={leaf ? undefined : () => toggle(path)}
        sx={{
          display: "flex",
          gap: 0.75,
          alignItems: "baseline",
          cursor: leaf ? "default" : "pointer",
          py: 0.1,
          borderRadius: 0.5,
          "&:hover": leaf ? {} : { background: token("panel") }
        }}
      >
        <Typography component="span" sx={{ ...MONO, fontSize: 12, opacity: 0.55, width: 12 }}>
          {leaf ? "" : isOpen ? "▾" : "▸"}
        </Typography>
        <Typography component="span" sx={{ ...MONO, fontSize: 12, color: token("accent") }}>
          {name}
        </Typography>
        {leaf ? (
          <Typography component="span" sx={{ ...MONO, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {leafLabel(value)}
          </Typography>
        ) : (
          <Typography component="span" sx={{ ...MONO, fontSize: 12, opacity: 0.55 }}>
            {badge}
          </Typography>
        )}
      </Box>
      {!leaf && isOpen && (
        <Box sx={{ borderLeft: `1px solid ${token("edge")}`, ml: 0.6 }}>
          {entries.map(([key, child]) => (
            <NodeRow
              key={key}
              name={key}
              value={child}
              path={`${path}.${key}`}
              depth={depth + 1}
              open={open}
              toggle={toggle}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

export function JsonTree({ source }: { source: string }) {
  const [open, setOpen] = React.useState<ReadonlySet<string>>(() => new Set(["$"]));
  const parsed = React.useMemo<{ value?: unknown; error?: string }>(() => {
    try {
      return { value: JSON.parse(source) as unknown };
    } catch (err) {
      return { error: String(err) };
    }
  }, [source]);
  const toggle = React.useCallback((path: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);
  if (parsed.error) {
    return (
      <Typography sx={{ fontSize: 13, color: token("err"), p: 1 }}>
        Not valid JSON — {parsed.error}. The Raw view still shows it.
      </Typography>
    );
  }
  return (
    <Box sx={{ p: 1, overflow: "auto" }}>
      <NodeRow name="$" value={parsed.value} path="$" depth={0} open={open} toggle={toggle} />
    </Box>
  );
}

/* ── table ───────────────────────────────────────────────────────────────── */

function tabularRows(value: unknown): Record<string, unknown>[] | null {
  const isRowArray = (v: unknown): v is Record<string, unknown>[] =>
    Array.isArray(v) && v.length > 0 && v.every((r) => r != null && typeof r === "object" && !Array.isArray(r));
  if (isRowArray(value)) return value;
  if (value != null && typeof value === "object" && !Array.isArray(value)) {
    for (const field of Object.values(value)) if (isRowArray(field)) return field;
  }
  return null;
}

export function TableView({ source }: { source: string }) {
  const rows = React.useMemo(() => {
    try {
      return tabularRows(JSON.parse(source));
    } catch {
      return null;
    }
  }, [source]);
  if (!rows) {
    return (
      <Typography sx={{ fontSize: 13, opacity: 0.7, p: 2 }}>
        No tabular shape here — a table needs an array of objects. Try the JSON tree.
      </Typography>
    );
  }
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown): string => {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return s.length > 240 ? `${s.slice(0, 240)}…` : s;
  };
  return (
    <TableContainer sx={{ maxHeight: "100%" }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {columns.map((c) => (
              <TableCell key={c} sx={{ ...MONO, fontSize: 12, fontWeight: 700 }}>
                {c}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i} hover>
              {columns.map((c) => (
                <TableCell key={c} sx={{ fontSize: 12, verticalAlign: "top" }}>
                  {cell(row[c])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/* ── raw ─────────────────────────────────────────────────────────────────── */

export function RawView({ source }: { source: string }) {
  return (
    <Box
      component="pre"
      sx={{
        ...MONO,
        fontSize: 12,
        m: 0,
        p: 1.5,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        overflow: "auto",
        height: "100%"
      }}
    >
      {source}
    </Box>
  );
}
