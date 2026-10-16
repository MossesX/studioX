/**
 * @file The switch-gated dial row, and the control for a dashboard dial.
 *
 * The whole Dashboard tab is built out of one row shape, used twice:
 *
 *   · **a dashboard dial** — the wrapper's own layout/display/style options,
 *     from `DASH_DIALS`;
 *   · **a theme dial** — one of the engine's own, from `DIALS`, carried by the
 *     wrapper so a roll can hand it to the theme.
 *
 * Both rows carry the same two switches, and the difference between them is
 * the point of the whole surface:
 *
 *   1. **ROLL / active** (the big switch). Off, the dial takes no part: it
 *     greys out, the roller does not use it, and the wrapper resolves it to
 *     its DEFAULT — which is what makes "a fresh dashboard matches the theme
 *     default" true rather than aspirational. On, the dial has an opinion.
 *   2. **INHERIT** (the small switch, theme dials only). Off, a rolled value
 *     stays inside the dashboard record and the theme never sees it. On,
 *     applying the dashboard writes that dial into the theme. Greyed while the
 *     roll switch is off, because inheriting a dial nothing rolled is a
 *     promise about a value that does not exist.
 *
 * ## Why a dial that is switched off still SHOWS its value
 *
 * A greyed row keeps rendering what the record holds, not the default it
 * currently resolves to. Blanking it would make switching a dial off destroy
 * the roll that produced it — you would have to roll again to get it back, and
 * the switch would be a delete button wearing a toggle's clothes. Off means
 * "not in force", never "gone".
 *
 * There is no branch on a dial ID anywhere in this file, exactly as
 * `DialControl.tsx` has none: the spec carries the kind, the range, the
 * options, the unit and the effect line, so a dial added to either spec grows
 * a working row here with no edit.
 */
"use client";

import * as React from "react";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import type { DashDial, DashValues } from "@axf/core";

export const MONO = { fontFamily: "var(--axf-mono)", fontSize: 11 } as const;

/* ------------------------------------------------------------------- row */

export function DialRow({
  label,
  effect,
  cssVar,
  active,
  onActive,
  inherit,
  onInherit,
  rolled,
  children
}: {
  label: string;
  effect: string;
  cssVar: string;
  active: boolean;
  onActive: (next: boolean) => void;
  /** `null` when this dial has nothing to inherit into — a dashboard dial. */
  inherit: boolean | null;
  onInherit?: (next: boolean) => void;
  /** True when the last roll actually produced this value. Purely a readout. */
  rolled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Paper
      variant="outlined"
      data-dash-row={cssVar}
      data-dash-active={active ? "" : undefined}
      sx={{
        p: 1,
        display: "grid",
        gap: 0.5,
        borderColor: active ? "primary.main" : "divider",
        bgcolor: active ? "action.hover" : "transparent",
        // The lit edge is the whole read of this surface at a glance: which
        // dials are in force. Cheap, and it survives a theme roll because both
        // colours come from the MUI palette the bridge derives from the dials.
        boxShadow: active ? "inset 3px 0 0 var(--axf-accent)" : "inset 3px 0 0 transparent",
        transition: "border-color 160ms, background-color 160ms, box-shadow 160ms"
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Tooltip title={active ? "In force — the roller uses it and the wrapper applies it. Switch off to hand this dial back to the theme." : "Off — greyed out, not rolled, and the wrapper falls back to this dial's default."}>
          <Switch
            size="small"
            checked={active}
            onChange={(_, v) => onActive(v)}
            slotProps={{ input: { "aria-label": `${label} active` } }}
          />
        </Tooltip>
        <Tooltip title={effect} placement="top-start">
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, cursor: "help", color: active ? "text.primary" : "text.disabled" }}
          >
            {label}
          </Typography>
        </Tooltip>
        <Typography
          variant="caption"
          sx={{ ...MONO, fontSize: 10.5, color: "text.secondary", opacity: active ? 1 : 0.5 }}
        >
          {cssVar}
        </Typography>
        {rolled && active ? (
          <Chip size="small" variant="outlined" color="primary" label="rolled" sx={{ ...MONO, height: 17 }} />
        ) : null}
        <Box sx={{ flex: 1 }} />
        {inherit === null ? null : (
          <Tooltip
            title={
              !active
                ? "Switch the dial on first — a dial the roll never touched has nothing to hand over."
                : inherit
                  ? "The THEME takes this value when the dashboard is applied. Turn it off to keep the value inside the dashboard only."
                  : "Kept inside the dashboard. The theme is untouched by this dial."
            }
          >
            <Stack direction="row" spacing={0.25} sx={{ alignItems: "center" }}>
              <Typography
                variant="caption"
                sx={{
                  ...MONO,
                  fontSize: 9.5,
                  letterSpacing: "0.1em",
                  color: active && inherit ? "primary.main" : "text.disabled"
                }}
              >
                INHERIT
              </Typography>
              <Switch
                size="small"
                checked={active && inherit}
                disabled={!active}
                onChange={(_, v) => onInherit?.(v)}
                slotProps={{ input: { "aria-label": `${label} inherited by the theme` } }}
                sx={{ transform: "scale(.78)" }}
              />
            </Stack>
          </Tooltip>
        )}
      </Stack>

      {/* Greyed rather than unmounted: the value stays legible so switching a
          dial off never looks like it deleted the roll that produced it. */}
      <Box
        aria-disabled={!active}
        sx={{
          opacity: active ? 1 : 0.34,
          filter: active ? "none" : "grayscale(1)",
          pointerEvents: active ? "auto" : "none",
          transition: "opacity 160ms, filter 160ms"
        }}
      >
        {children}
      </Box>
    </Paper>
  );
}

/* ------------------------------------------------- the dashboard control */

/**
 * One dashboard dial, one control — chosen by `kind` and nothing else, the
 * same contract `DialControl.tsx` states for the theme's dials.
 */
export function DashDialControl({
  dial,
  values,
  onChange
}: {
  dial: DashDial;
  values: DashValues;
  onChange: (id: string, value: string | number) => void;
}) {
  if (dial.kind === "enum") {
    const value = String(values[dial.id] ?? dial.default);
    const known = dial.options.includes(value);
    return (
      <TextField
        select
        size="small"
        fullWidth
        value={known ? value : ""}
        onChange={(e) => onChange(dial.id, e.target.value)}
        error={!known}
        helperText={known ? undefined : `stored value "${value}" is not a declared option`}
        slotProps={{
          htmlInput: { "aria-label": dial.label, "data-dash-dial": dial.id }
        }}
        sx={{ "& .MuiSelect-select": { ...MONO, fontSize: 12.5 } }}
      >
        {dial.options.map((option) => (
          <MenuItem key={option} value={option} sx={{ ...MONO, fontSize: 12.5 }}>
            {option}
          </MenuItem>
        ))}
      </TextField>
    );
  }

  const raw = Number(values[dial.id]);
  const value = Number.isFinite(raw) ? raw : dial.default;
  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: "center", pr: 0.5 }}>
      <Slider
        size="small"
        value={value}
        min={dial.min}
        max={dial.max}
        step={dial.step}
        valueLabelDisplay="auto"
        onChange={(_, next) =>
          onChange(dial.id, Math.min(dial.max, Math.max(dial.min, Array.isArray(next) ? next[0] : next)))
        }
        aria-label={dial.label}
        data-dash-dial={dial.id}
        sx={{ flex: 1, minWidth: 80 }}
      />
      <TextField
        size="small"
        value={String(value)}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(n)) {
            onChange(dial.id, Math.min(dial.max, Math.max(dial.min, n)));
          }
        }}
        slotProps={{
          htmlInput: { inputMode: "decimal", "aria-label": `${dial.label} value` },
          input: dial.unit
            ? {
                endAdornment: (
                  <InputAdornment position="end" sx={{ "& p": { fontSize: 10.5 } }}>
                    {dial.unit === "em/100" ? "/100em" : dial.unit}
                  </InputAdornment>
                )
              }
            : undefined
        }}
        sx={{ width: 100, "& input": { ...MONO, fontSize: 12.5 } }}
      />
    </Stack>
  );
}
