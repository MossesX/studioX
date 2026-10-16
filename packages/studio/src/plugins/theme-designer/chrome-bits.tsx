/**
 * @file Shared pieces of the Toolbar and Nav menu tabs.
 *
 * Both tabs are the same surface twice — a list of registered candidates for
 * one shell slot, a "use in theme" that writes a chrome dial, and an editor
 * over the user-authored document — so the shared mechanics live once here
 * and each tab keeps only its own item vocabulary.
 */
"use client";

import * as React from "react";

import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, useResolvedStyle } from "@axf/core";

export const MONO = { fontFamily: "var(--axf-mono)", fontSize: 11 } as const;

/**
 * The chrome document's client API.
 *
 * It USED to be defined here. It moved to `src/chrome/useChromeDoc.ts` when the
 * branding page's drag-and-drop editor became a second writer of the same
 * document — one plugin importing another plugin's internals to save an asset
 * is how a shared thing ends up owned by whichever surface happened to need it
 * first. Re-exported so the designer's three tabs kept their import.
 */
export { useChromeDoc } from "../../chrome/useChromeDoc";

/**
 * Pick a drawing from the ACTIVE branding pack, previewing each candidate.
 *
 * The option list is the resolved glyph map — so it is always the drawings the
 * app can actually render, under the pack the settings page selected. Free
 * text is allowed (a glyph id from a pack not yet selected), and the preview
 * simply shows the missing-glyph placeholder in that case.
 */
export function GlyphSelect({
  value,
  onChange,
  categories,
  label
}: {
  value: string;
  onChange: (id: string) => void;
  /** Which glyph categories to offer. Empty/omitted = all. */
  categories?: readonly string[];
  label: string;
}) {
  const identity = useResolvedStyle();
  const options = React.useMemo(() => {
    const all = [...identity.glyphs.values()];
    const wanted = categories?.length
      ? all.filter((entry) => categories.includes(entry.category))
      : all;
    return wanted.map((entry) => entry.id).sort();
  }, [identity.glyphs, categories]);

  return (
    <Autocomplete
      size="small"
      freeSolo
      options={options}
      value={value}
      onChange={(_, v) => onChange(v ?? "")}
      onInputChange={(_, v, reason) => {
        if (reason === "input") onChange(v);
      }}
      renderOption={(props, option) => {
        const { key, ...rest } = props as { key?: React.Key } & React.HTMLAttributes<HTMLLIElement>;
        return (
          <Box component="li" key={key} {...rest} sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <Glyph id={option} size={16} />
            <Typography variant="caption" sx={MONO}>
              {option}
            </Typography>
          </Box>
        );
      }}
      renderInput={(params) => <TextField {...params} label={label} />}
    />
  );
}

/** One registered candidate: name it, mark it, offer the four moves. */
export function CandidateCard({
  id,
  title,
  description,
  custom,
  inTheme,
  registryDefault,
  editing,
  onUse,
  onEdit,
  onDuplicate,
  onDelete
}: {
  id: string;
  title: string;
  description: string;
  custom: boolean;
  /** The theme's chrome dial names this asset. */
  inTheme: boolean;
  /** What renders when the dial is empty. */
  registryDefault: boolean;
  editing: boolean;
  onUse: () => void;
  onEdit?: () => void;
  /** Omitted when the kind cannot copy this asset — a code-only dashboard
   *  wrapper has a `render` function and nothing a record could carry, so
   *  offering "Duplicate" there would promise a copy that cannot exist. */
  onDuplicate?: () => void;
  onDelete?: () => void;
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.25,
        display: "grid",
        gap: 0.75,
        borderColor: editing ? "primary.main" : "divider"
      }}
    >
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        <Chip size="small" variant="outlined" label={id} sx={{ ...MONO, height: 18 }} />
        <Chip
          size="small"
          variant="outlined"
          label={custom ? "custom" : "built-in"}
          sx={{ ...MONO, height: 18 }}
        />
        {inTheme ? (
          <Chip size="small" color="primary" label="in theme" sx={{ ...MONO, height: 18 }} />
        ) : registryDefault ? (
          <Chip size="small" variant="outlined" label="app default" sx={{ ...MONO, height: 18 }} />
        ) : null}
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {description}
      </Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Tooltip title="Make this the one the theme uses. Repaints the app immediately; Apply to app is what saves it.">
          <span>
            <Button size="small" variant={inTheme ? "outlined" : "contained"} disabled={inTheme} onClick={onUse}>
              {inTheme ? "In theme" : "Use in theme"}
            </Button>
          </span>
        </Tooltip>
        {onEdit ? (
          <Button size="small" variant="outlined" onClick={onEdit}>
            Edit
          </Button>
        ) : null}
        {onDuplicate ? (
          <Tooltip title={custom ? "Copy this asset under a new id." : "Built-ins are code — duplicate one into an editable copy."}>
            <Button size="small" onClick={onDuplicate}>
              Duplicate
            </Button>
          </Tooltip>
        ) : null}
        <Box sx={{ flex: 1 }} />
        {onDelete ? (
          <Button size="small" color="error" onClick={onDelete}>
            Delete
          </Button>
        ) : null}
      </Stack>
    </Paper>
  );
}

/** Reorder/remove strip every item row carries. */
export function RowMoves({
  onUp,
  onDown,
  onRemove
}: {
  onUp: (() => void) | null;
  onDown: (() => void) | null;
  onRemove: () => void;
}) {
  return (
    <Stack direction="row" spacing={0.5}>
      <Button size="small" sx={{ minWidth: 30, px: 0.5 }} disabled={!onUp} onClick={onUp ?? undefined}>
        ↑
      </Button>
      <Button size="small" sx={{ minWidth: 30, px: 0.5 }} disabled={!onDown} onClick={onDown ?? undefined}>
        ↓
      </Button>
      <Button size="small" color="error" sx={{ minWidth: 30, px: 0.5 }} onClick={onRemove}>
        ✕
      </Button>
    </Stack>
  );
}

/** Immutable move-in-array, shared by both editors. */
export function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** A unique item id within one asset — `label-2` style, stable enough to edit. */
export function freshItemId(prefix: string, taken: ReadonlySet<string>): string {
  let n = 1;
  while (taken.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}
