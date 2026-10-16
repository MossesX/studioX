/**
 * @file The item editor's FIELDS — title, type, action, category, priority,
 * colour, due and notes — as one component, ported from GizmoX's `ItemFields`
 * (MASTER §5).
 *
 * Deliberately id-free and store-free, exactly as the original: it takes a
 * value and hands back a patch. That contract is what was ported, not the
 * widgets — and it is what lets the same fields edit a live `TaskItem` here
 * and, later, an unsaved draft on any other surface with no branching inside.
 *
 * ── MUI (2026-08-11) ────────────────────────────────────────────────────────
 * The pre-strip file carried a note that GizmoX renders these with MUI
 * `TextField`s and *"studio has no MUI"*. Studio has MUI now, so this is the
 * one file in the module where the rebuild is a straight return to the original
 * widgets: `TextField` (plain, `select`, `multiline`, and `type="datetime-local"`)
 * instead of the `.axs-tm-input` class the pre-strip version hand-rolled.
 *
 * The colour picker stays bespoke swatches — a row of twelve fixed paint chips
 * is a drawing, and MUI has no component for it that would not be a `Select`
 * pretending. They are `ButtonBase`, so they are still real, focusable buttons.
 */
"use client";

import * as React from "react";

import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import { PALETTE, paletteColor } from "./palette";
import { ACTION_OPTIONS, PRIORITY_LABELS, TYPE_ICONS, TYPE_OPTIONS } from "./taskOps";
import type { ItemAction, ItemType, Priority, TaskItem } from "./types";

/** The slice of an item these fields edit — satisfied by a `TaskItem` as-is. */
export interface ItemFieldsValue {
  title: string;
  type: ItemType;
  action: ItemAction;
  category: string;
  color: string;
  icon: string;
  priority: Priority;
  notes: string;
  due?: number;
  /** Only read, for the open/done chip; the chip is not a control here. */
  done?: boolean;
}

export interface ItemFieldsProps {
  value: ItemFieldsValue;
  onChange: (patch: Partial<TaskItem>) => void;
  /** Overline above the fields. The detail pane's "Item details" by default. */
  heading?: string;
  autoFocusTitle?: boolean;
  onSubmit?: () => void;
  notesRows?: number;
}

/**
 * `datetime-local` speaks LOCAL time, so a UTC ISO string reads back shifted by
 * the offset — the value the field shows has to be built from the local parts.
 * Kept verbatim from GizmoX, because the bug it avoids is timezone-shaped and
 * would reappear the moment someone "simplified" it to `toISOString().slice()`.
 */
function toLocalInput(ms: number | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

/** Shared `sx` for every field: dense, and small enough to fit the pane. */
const FIELD_SX = {
  "& .MuiInputBase-input": { fontSize: 13, padding: "6px 9px" },
  "& .MuiInputLabel-root": { fontSize: 12 },
  "& .MuiFormLabel-root": { color: token("dim") }
} as const;

export default function ItemFields({
  value,
  onChange,
  heading = "Item details",
  autoFocusTitle = false,
  onSubmit,
  notesRows = 5
}: ItemFieldsProps) {
  /** Retyping an item re-icons it, unless the icon was picked by hand. */
  const changeType = (type: ItemType) => {
    const patch: Partial<TaskItem> = { type };
    if (value.icon === (TYPE_ICONS[value.type] ?? "task")) patch.icon = TYPE_ICONS[type] ?? "task";
    onChange(patch);
  };

  const c = paletteColor(value.color);

  return (
    <Stack sx={{ gap: "11px", minWidth: 0 }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: "8px" }}>
        <Box
          component="span"
          aria-hidden
          sx={{ width: 11, height: 11, borderRadius: "3px", background: c.main, flexShrink: 0 }}
        />
        <Typography
          component="span"
          sx={{
            color: token("dim"),
            fontFamily: token("mono"),
            fontSize: 10.5,
            letterSpacing: "0.15em",
            textTransform: "uppercase"
          }}
        >
          {heading}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Chip
          label={value.done ? "done" : "open"}
          size="small"
          sx={{
            height: 17,
            color: value.done ? "#34D399" : "#FFB020",
            background: value.done ? "rgba(52,211,153,0.16)" : "rgba(255,176,32,0.16)",
            "& .MuiChip-label": { padding: "0 7px", fontSize: 10 }
          }}
        />
      </Stack>

      <TextField
        label="Title"
        size="small"
        autoFocus={autoFocusTitle}
        value={value.title}
        onChange={(e) => onChange({ title: e.target.value })}
        onFocus={autoFocusTitle ? (e) => e.target.select() : undefined}
        onKeyDown={
          onSubmit
            ? (e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onSubmit();
                }
              }
            : undefined
        }
        sx={FIELD_SX}
      />

      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "9px" }}>
        <TextField
          select
          label="Type"
          size="small"
          value={value.type}
          onChange={(e) => changeType(e.target.value as ItemType)}
          sx={FIELD_SX}
        >
          {TYPE_OPTIONS.map((t) => (
            <MenuItem key={t} value={t} sx={{ fontSize: 13 }}>
              {t}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Action"
          size="small"
          value={value.action}
          onChange={(e) => onChange({ action: e.target.value as ItemAction })}
          sx={FIELD_SX}
        >
          {ACTION_OPTIONS.map((a) => (
            <MenuItem key={a} value={a} sx={{ fontSize: 13 }}>
              {a}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Category"
          size="small"
          value={value.category}
          onChange={(e) => onChange({ category: e.target.value })}
          sx={FIELD_SX}
        />
        <TextField
          select
          label="Priority"
          size="small"
          value={String(value.priority)}
          onChange={(e) => onChange({ priority: Number(e.target.value) as Priority })}
          sx={FIELD_SX}
        >
          {PRIORITY_LABELS.map((p, i) => (
            <MenuItem key={p} value={String(i)} sx={{ fontSize: 13 }}>
              {p}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      <Stack sx={{ gap: "5px" }}>
        <Typography sx={{ color: token("dim"), fontSize: 10.5, letterSpacing: "0.06em" }}>
          Colour
        </Typography>
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: "6px" }}>
          {PALETTE.map((p) => (
            <ButtonBase
              key={p.key}
              title={p.label}
              aria-label={p.label}
              aria-pressed={value.color === p.key}
              onClick={() => onChange({ color: p.key })}
              sx={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: p.main,
                border: value.color === p.key ? `2px solid ${token("ink")}` : "2px solid transparent",
                boxShadow: value.color === p.key ? `0 0 0 2px ${p.soft}` : "none"
              }}
            />
          ))}
        </Stack>
      </Stack>

      <TextField
        label="Due"
        type="datetime-local"
        size="small"
        value={toLocalInput(value.due)}
        onChange={(e) =>
          onChange({ due: e.target.value ? new Date(e.target.value).getTime() : undefined })
        }
        slotProps={{ inputLabel: { shrink: true } }}
        sx={FIELD_SX}
      />

      <TextField
        label="Notes"
        size="small"
        multiline
        rows={notesRows}
        value={value.notes}
        onChange={(e) => onChange({ notes: e.target.value })}
        sx={{ ...FIELD_SX, "& .MuiInputBase-root": { fontSize: 13, padding: "8px 9px" } }}
      />
    </Stack>
  );
}
