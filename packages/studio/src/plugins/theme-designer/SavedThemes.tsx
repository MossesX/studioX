/**
 * @file Saved themes — the shelf. Dials are for when you know what you want,
 * the roller is for finding it, and this is for keeping what you found.
 *
 * ## Why a save step exists on a surface whose rule is "no save step"
 *
 * `ThemeStore`'s stated rule is hot render, saved instantly, no confirm — and
 * that rule is about the theme IN FORCE, which still behaves exactly that way.
 * What this adds is a shelf beside it: a save is a *copy* taken off the live
 * theme under a name.
 *
 * ## What "apply" puts back, since 2026-08-12
 *
 * The VALUES — every dial, including the `bannerBar`/`navMenu` chrome dials,
 * so a look restores its own bar and menu with no separate machinery. No pack
 * application: branding is a fixed app setting a look must not touch.
 *
 * Applying COMMITS (persists to localStorage + the theme cookie) and then
 * re-arms the designer's preview, exactly like applying a roll — choosing a
 * saved look and choosing a roll are the same act.
 */
"use client";

import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { theme as themeStore, useTheme } from "@axf/core";

import { savedThemes, slugOf } from "./saved-store";
import type { SavedTheme } from "./saved-store";

const MONO = { fontFamily: "var(--axf-mono)", fontSize: 11 } as const;

function stamp(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SavedThemes() {
  const state = useTheme();

  /* The shelf, through the store's own snapshot pair. `serverList` is the
     empty array for the same reason `ThemeStore.serverState` is the default
     theme: the server cannot read localStorage, and a list rendered full on
     the client and empty on the server is a hydration mismatch. */
  const saved = React.useSyncExternalStore(
    savedThemes.subscribe,
    savedThemes.list,
    savedThemes.serverList
  );

  const [name, setName] = React.useState("");
  const overrideCount = Object.keys(state.overrides).length;

  const saveCurrent = React.useCallback(() => {
    const entry = savedThemes.save(
      {
        name,
        // The photograph. Every dial as it is showing right now — chrome
        // selection included, since bannerBar/navMenu are dials — so applying
        // this record reproduces the screen instead of re-deriving it.
        values: state.values,
        seed: state.seed,
        options: state.options,
        overrides: state.overrides
      },
      Date.now()
    );
    setName("");
    return entry;
  }, [name, state]);

  /** Put a whole look back: seed for provenance, then every value verbatim. */
  const applySaved = React.useCallback((entry: SavedTheme) => {
    if (entry.seed) themeStore.apply(entry.seed, entry.options);
    else {
      themeStore.reset();
      themeStore.setOptions(entry.options);
    }
    const values = entry.values ?? entry.overrides;
    for (const [dial, value] of Object.entries(values)) {
      themeStore.setValue(dial, value as string | number);
    }
    /*
     * THIS is what "applied" means: the values above ran as preview edits and
     * wrote nothing durable; committing puts the record into localStorage AND
     * the theme cookie — which is what the server reads on the next load.
     * Without this line, Apply would repaint the app and be gone on the first
     * nav click. Re-armed immediately: the designer is still open, so the next
     * dial turn must be a preview again.
     */
    themeStore.commitPreview();
    themeStore.beginPreview();
  }, []);

  /* Through the library's OWN slug function, so "does this replace something"
     is answered the same way the save itself will answer it. */
  const existing = name.trim().length > 0 && saved.some((s) => s.id === slugOf(name));

  return (
    <Box sx={{ display: "grid", gap: 2, alignItems: "start", gridTemplateColumns: { xs: "1fr", lg: "minmax(360px, 38%) 1fr" } }}>
      {/* ------------------------------------------------------------- save */}
      <Stack spacing={1.5}>
        <Paper variant="outlined" sx={{ p: 1.5, display: "grid", gap: 1.25 }}>
          <Typography variant="subtitle2">Save the theme in force</Typography>
          <Typography variant="caption" color="text.secondary">
            A copy of every dial as it shows right now — colours, layout, type, and the banner and
            nav menu the design uses. Branding is NOT part of a look: the pack is a global app
            setting, chosen on the Settings page.
          </Typography>
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              fullWidth
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) saveCurrent();
              }}
              helperText={existing ? "A save of this name exists — this replaces it." : " "}
            />
            <Box>
              <Button
                size="small"
                variant="contained"
                disabled={!name.trim()}
                onClick={() => saveCurrent()}
              >
                Save
              </Button>
            </Box>
          </Stack>
          <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap" }}>
            <Chip size="small" variant="outlined" sx={{ ...MONO, height: 20 }}
              label={state.seed ? `seed ${state.seed}` : "shipped default"} />
            <Chip size="small" variant="outlined" sx={{ ...MONO, height: 20 }}
              label={`${overrideCount} override${overrideCount === 1 ? "" : "s"}`} />
            <Chip size="small" variant="outlined" sx={{ ...MONO, height: 20 }}
              label={`banner ${String(state.values.bannerBar ?? "") || "app default"}`} />
            <Chip size="small" variant="outlined" sx={{ ...MONO, height: 20 }}
              label={`nav ${String(state.values.navMenu ?? "") || "app default"}`} />
          </Stack>
        </Paper>
      </Stack>

      {/* ----------------------------------------------------------- the shelf */}
      <Paper variant="outlined" sx={{ p: 1.5, display: "grid", gap: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="subtitle2">Saved</Typography>
          <Chip size="small" variant="outlined" label={saved.length} sx={{ ...MONO, height: 18 }} />
        </Stack>
        <Divider />
        {saved.length === 0 ? (
          <Typography variant="caption" color="text.secondary" sx={{ py: 2 }}>
            Nothing saved yet. Roll or tune a theme you want to keep, name it on the left, and it
            appears here.
          </Typography>
        ) : (
          saved.map((entry) => (
            <Paper key={entry.id} variant="outlined" sx={{ p: 1.25, display: "grid", gap: 0.75 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {entry.name}
                </Typography>
                <Box sx={{ flex: 1 }} />
                <Typography variant="caption" color="text.secondary" sx={MONO}>
                  {stamp(entry.savedAt)}
                </Typography>
              </Stack>
              <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap" }}>
                <Chip size="small" variant="outlined" sx={{ ...MONO, height: 18 }}
                  label={entry.seed ? `seed ${entry.seed}` : "shipped default"} />
                <Chip size="small" variant="outlined" sx={{ ...MONO, height: 18 }}
                  label={entry.values ? "full photograph" : `${Object.keys(entry.overrides).length} edits`} />
              </Stack>
              <Stack direction="row" spacing={1}>
                <Tooltip title="Put this look back — every dial, banner and nav menu included — applied to the whole app and saved. The dials stay editable afterwards.">
                  <span>
                    <Button size="small" variant="contained" onClick={() => applySaved(entry)}>
                      Apply to app
                    </Button>
                  </span>
                </Tooltip>
                <Box sx={{ flex: 1 }} />
                <Tooltip title="Delete this save. The theme in force is not touched.">
                  <Button size="small" color="error" onClick={() => savedThemes.remove(entry.id)}>
                    Delete
                  </Button>
                </Tooltip>
              </Stack>
            </Paper>
          ))
        )}
      </Paper>
    </Box>
  );
}
