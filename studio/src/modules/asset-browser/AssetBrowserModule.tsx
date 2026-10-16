"use client";

/**
 * @file The Asset Browser — the `/asset-browser` screen.
 *
 * Three regions in one `PaneLayout`: the kind rail, the card grid, the detail
 * pane. `PaneLayout` rather than a fixed three-column `Box` because the module
 * contract requires resizable panes on a multi-column screen, and because the
 * grid's `auto-fill` reflow is only honest if the pane it fills can actually
 * change width.
 *
 * ## What this file owns, because nothing smaller can
 *
 *   1. **The join.** `useCatalog` puts the four live registries and the disk
 *      report together; this screen decides what the filters leave visible.
 *   2. **Pruning the selection.** A reload can retire the selected id (an asset
 *      deleted underneath the screen), and a detail pane rendering a card that
 *      no longer exists is the stalest possible surface.
 *   3. **The toast**, which context-menu commands write to through `view.ts`
 *      because a plain function cannot mount React.
 *
 * Settings are read through `useAssetBrowserSettings`, so a change in the
 * shell's one dialog lands live. There is no gear here and no sui component —
 * the shell owns the one affordance.
 */

import * as React from "react";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, PaneLayout, definePanes, token } from "@axf/core";

import { KIND_BY_ID } from "../../asset-browser/kinds";
import AssetGrid from "./AssetGrid";
import DetailPane from "./DetailPane";
import KindRail from "./KindRail";
import { matches, useCatalog } from "./catalog";
import { useAssetBrowserSettings } from "./settings";
import { assetBrowserView, useAssetBrowserView } from "./view";

/**
 * Module scope, as the layout contract requires — a tree built in the render
 * body is a new object every pass and the latch never settles
 * (`AdminFilesTab`'s `TREE` carries the same note, and
 * `gizmox-layout-render-race` is the incident behind it).
 */
const TREE = definePanes({
  kind: "split",
  direction: "row",
  weights: [20, 48, 32],
  children: [
    { kind: "pane", id: "kinds", minSize: 180 },
    { kind: "pane", id: "grid", minSize: 280 },
    { kind: "pane", id: "detail", minSize: 260 }
  ]
});

/** How long a toast stays up. Long enough to read a path out of it. */
const TOAST_MS = 4000;

export default function AssetBrowserModule() {
  const view = useAssetBrowserView();
  const settings = useAssetBrowserSettings();
  const catalog = useCatalog(view.nonce);

  const visible = React.useMemo(
    () =>
      catalog.entries.filter(
        (e) => (view.kind === null || e.card.kind === view.kind) && matches(e, view.query)
      ),
    [catalog.entries, view.kind, view.query]
  );

  const selected = React.useMemo(
    () => catalog.entries.find((e) => e.key === view.selected) ?? null,
    [catalog.entries, view.selected]
  );

  // A selection the catalog no longer holds is dropped rather than left
  // pointing at nothing — after a reload that retired an asset, the pane would
  // otherwise keep showing a card that is gone.
  React.useEffect(() => {
    if (view.selected && !selected) assetBrowserView.select(null);
  }, [view.selected, selected]);

  React.useEffect(() => {
    if (!view.toast) return;
    const t = window.setTimeout(() => assetBrowserView.clearToast(), TOAST_MS);
    return () => window.clearTimeout(t);
  }, [view.toast]);

  const kind = view.kind ? KIND_BY_ID[view.kind] : null;

  return (
    <Box
      data-axf-area="asset-browser.surface"
      sx={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}
    >
      {/* ------------------------------------------------------------ header */}
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: "center",
          px: 1.5,
          py: 1,
          borderBottom: `1px solid ${token("edge")}`,
          flexWrap: "wrap",
          rowGap: 1
        }}
      >
        <Box sx={{ color: token("accent"), display: "flex" }}>
          <Glyph id="icon-folder" size={18} />
        </Box>
        <Typography sx={{ fontSize: 15, fontWeight: 700 }}>Asset Browser</Typography>
        <Chip
          size="small"
          label={
            visible.length === catalog.entries.length
              ? `${catalog.entries.length} assets`
              : `${visible.length} of ${catalog.entries.length}`
          }
          sx={{ height: 20, fontSize: 11 }}
        />
        {kind && (
          <Chip
            size="small"
            label={kind.display}
            onDelete={() => assetBrowserView.focus(null)}
            sx={{ height: 20, fontSize: 11 }}
          />
        )}
        {catalog.loading && <CircularProgress size={14} thickness={6} />}

        <Box sx={{ flex: 1 }} />

        <TextField
          size="small"
          value={view.query}
          onChange={(e) => assetBrowserView.search(e.target.value)}
          placeholder="Filter by id, name or description"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Glyph id="icon-search" size={13} />
                </InputAdornment>
              )
            }
          }}
          sx={{ width: 260, "& .MuiInputBase-input": { fontSize: 12.5 } }}
        />
        <Tooltip title="Re-read the catalog from disk">
          <IconButton size="small" onClick={() => assetBrowserView.reload()} aria-label="Reload the catalog">
            <Glyph id="icon-reload" size={15} />
          </IconButton>
        </Tooltip>
      </Stack>

      {/* -------------------------------------------------------- the report */}
      {catalog.diskError && (
        <Box sx={{ px: 1.5, py: 0.75, bgcolor: token("panel"), borderBottom: `1px solid ${token("edge")}` }}>
          {/*
           * Stated rather than swallowed. Without the disk half the registered
           * kinds still list — their SOURCE specs are client-side — but nothing
           * is known about zips, signatures or the enable switch, and a screen
           * that hid that would be quietly showing an incomplete catalog.
           */}
          <Typography sx={{ fontSize: 11.5, color: token("err") }}>
            The on-disk half of the catalog could not be read: {catalog.diskError}. Logo kits and
            landings are listed from their source specs; their registry rows, zips and signatures
            are unknown until this is fixed.
          </Typography>
        </Box>
      )}
      {!catalog.diskError && catalog.notes.length > 0 && (
        <Box sx={{ px: 1.5, py: 0.75, bgcolor: token("panel"), borderBottom: `1px solid ${token("edge")}` }}>
          <Typography sx={{ fontSize: 11.5, color: token("warn") }}>
            {catalog.notes.length === 1
              ? "1 problem found in the installed tree"
              : `${catalog.notes.length} problems found in the installed tree`}
            {" — "}
            {catalog.notes[0].message}
            {catalog.notes.length > 1 ? " (the rest are on the cards they belong to)" : ""}
          </Typography>
        </Box>
      )}

      {/* ------------------------------------------------------------ panes */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <PaneLayout
          tree={TREE}
          /* Persisted, so a person's column widths survive a reload — and,
             per PaneLayout's own header, a persisted layout is the one whose
             leaves can be floated at all. */
          storageKey="asset-browser-panes"
          renderPane={(paneId) => {
            if (paneId === "kinds") {
              return (
                <KindRail
                  value={view.kind}
                  onChange={(k) => assetBrowserView.focus(k)}
                  counts={catalog.counts}
                  showEmpty={settings.showEmptyKinds}
                  total={catalog.entries.length}
                />
              );
            }
            if (paneId === "grid") {
              return (
                <AssetGrid
                  entries={visible}
                  selected={view.selected}
                  onSelect={(key) => assetBrowserView.select(key)}
                  emptyMessage={emptyGridMessage(
                    catalog.loading,
                    catalog.entries.length,
                    view.query,
                    kind?.display ?? null
                  )}
                />
              );
            }
            return (
              <DetailPane
                entry={selected}
                showRaw={settings.showRawJson}
                emptyMessage="Pick an asset to see how it is authored — its source, its generator, its renderer and what may be changed."
              />
            );
          }}
        />
      </Box>

      <Snackbar
        open={view.toast !== null}
        message={view.toast ?? ""}
        onClose={() => assetBrowserView.clearToast()}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Box>
  );
}

/**
 * The empty state, and it says which of four different nothings this is.
 *
 * "No assets" covers a catalog still loading, a filter that matched none, a
 * kind with no instances and a genuinely empty tree — four situations with four
 * different next actions. Collapsing them into one sentence is how a person
 * concludes their assets are gone.
 */
function emptyGridMessage(
  loading: boolean,
  total: number,
  query: string,
  kindLabel: string | null
): string {
  if (loading && total === 0) return "Reading the catalog…";
  if (query.trim() && kindLabel) {
    return `No ${kindLabel.toLowerCase()} matches “${query.trim()}”. Clear the filter, or pick another kind.`;
  }
  if (query.trim()) return `Nothing matches “${query.trim()}”.`;
  if (kindLabel) {
    return `No ${kindLabel.toLowerCase()} exists yet. The kind is real and the rail lists it — there is simply no instance of it in this tree.`;
  }
  return "No graphical assets were found. If that is a surprise, the catalog route is the thing to check — the registry names where every installed asset should be.";
}
