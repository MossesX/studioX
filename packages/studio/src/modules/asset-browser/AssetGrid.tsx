"use client";

/**
 * @file The card grid — one card per graphical asset, reflowing to its pane.
 *
 * `repeat(auto-fill, minmax(260px, 1fr))`, so the column count follows the pane
 * rather than a breakpoint. The pane is user-draggable (`PaneLayout`), which
 * makes a viewport breakpoint the wrong measurement outright: a person can drag
 * this pane to 300px on a 2560px screen, and a `md` rule would still be laying
 * out four columns in it.
 *
 * Every card is `data-axf-area="asset-browser.asset"` and carries its
 * `<kind>:<id>` key, so the decl's rows resolve without this file knowing a
 * menu exists.
 *
 * The card face is a LIVE PREVIEW over the facts: `AssetPreview` draws the
 * asset through the renderer that draws it in the app (a kit's logos through
 * `LogoKitLogo` with their motions running, a bar through core's `Toolbar`),
 * and `summary.ts`'s facts sit underneath it. The two are complementary and
 * neither replaced the other — the drawing says which asset this is at a
 * glance, the facts say what it holds. A kind with nothing mountable to draw
 * gets a stated reason rather than a grey tile; see `AssetPreview`.
 */

import * as React from "react";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, token } from "@axf/core";

import AssetPreview from "./AssetPreview";
import type { CatalogEntry } from "./catalog";
import { factsFor } from "./summary";

/**
 * A kind's mark, from the branding contract's ids and nothing else.
 *
 * Every value here is in `REQUIRED_GLYPH_IDS`. An invented id renders NOTHING
 * and still passes `check:glyphs`, which only sees the literal — the
 * scanner-shaped hole `AdminFilesTab`'s `DIR_GLYPH` comment recorded. So a new
 * kind either reuses one of these or arrives with a real glyph and its
 * `REQUIRED_GLYPHS` entry in the same edit.
 */
const KIND_GLYPH: Readonly<Record<string, string>> = {
  logo_kit: "icon-palette",
  x_landing: "icon-globe",
  "branding-package": "icon-brush",
  "logo-package": "icon-sparkle",
  toolbar: "icon-layers",
  "nav-menu": "icon-grid",
  dashboard: "icon-expand"
};

/** The fallback is a contract id too — a missing mapping must still draw. */
const FALLBACK_GLYPH = "icon-folder";

export interface AssetGridProps {
  readonly entries: readonly CatalogEntry[];
  readonly selected: string | null;
  readonly onSelect: (key: string) => void;
  /** Shown instead of the grid when nothing matches — never fabricated rows. */
  readonly emptyMessage: string;
}

export default function AssetGrid({ entries, selected, onSelect, emptyMessage }: AssetGridProps) {
  if (entries.length === 0) {
    return (
      <Box
        data-axf-area="asset-browser.surface"
        sx={{
          height: "100%",
          display: "grid",
          placeItems: "center",
          p: 3,
          color: token("dim"),
          textAlign: "center"
        }}
      >
        <Typography sx={{ fontSize: 13, maxWidth: 420, lineHeight: 1.6 }}>{emptyMessage}</Typography>
      </Box>
    );
  }

  return (
    <Box
      data-axf-area="asset-browser.surface"
      sx={{
        height: "100%",
        overflowY: "auto",
        p: 1.5,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        gap: 1.5,
        alignContent: "start"
      }}
    >
      {entries.map((entry) => (
        <AssetCardTile
          key={entry.key}
          entry={entry}
          selected={entry.key === selected}
          onSelect={onSelect}
        />
      ))}
    </Box>
  );
}

function AssetCardTile({
  entry,
  selected,
  onSelect
}: {
  entry: CatalogEntry;
  selected: boolean;
  onSelect: (key: string) => void;
}) {
  const { card, kind, disk, enabled, notes } = entry;
  const facts = factsFor(card);
  const dangling = card.references.filter((r) => !r.resolved);

  return (
    <Card
      data-axf-area="asset-browser.asset"
      data-axf-asset={entry.key}
      data-axf-kind={card.kind}
      variant="outlined"
      sx={{
        bgcolor: token("panel"),
        borderColor: selected ? token("accent") : token("edge"),
        // A disabled asset still lists — it exists, it is just switched off in
        // the registry — but it reads as switched off rather than as missing.
        opacity: enabled ? 1 : 0.55,
        transition: "border-color 120ms"
      }}
    >
      <CardActionArea onClick={() => onSelect(entry.key)} sx={{ p: 1.5, alignItems: "stretch" }}>
        {/* The drawing, by the real renderer. First, because it is what makes a
            grid of twenty assets scannable at all. */}
        <AssetPreview entry={entry} size="card" />

        <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start", mb: 0.75 }}>
          <Box sx={{ mt: 0.25, color: token("accent"), flexShrink: 0 }}>
            <Glyph id={KIND_GLYPH[card.kind] ?? FALLBACK_GLYPH} size={18} />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              sx={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3, wordBreak: "break-word" }}
            >
              {card.name}
            </Typography>
            <Typography
              sx={{ fontSize: 11, color: token("dim"), fontFamily: "var(--axf-font-mono, monospace)" }}
            >
              {card.id}
              {card.version ? ` · ${card.version}` : ""}
            </Typography>
          </Box>
        </Stack>

        <Typography
          sx={{
            fontSize: 11.5,
            color: token("dim"),
            lineHeight: 1.45,
            mb: facts.length > 0 ? 1 : 0.5,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden"
          }}
        >
          {card.description}
        </Typography>

        {facts.length > 0 && (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              columnGap: 1,
              rowGap: 0.25,
              mb: 1,
              fontSize: 11
            }}
          >
            {facts.map((f) => (
              <React.Fragment key={f.label}>
                <Typography component="span" sx={{ fontSize: 11, color: token("dim") }}>
                  {f.label}
                </Typography>
                <Typography
                  component="span"
                  sx={{ fontSize: 11, wordBreak: "break-word", textAlign: "right" }}
                >
                  {f.value}
                </Typography>
              </React.Fragment>
            ))}
          </Box>
        )}

        <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5 }}>
          <Tooltip title={kind.blurb} enterDelay={500}>
            <Chip size="small" label={kind.display} sx={{ height: 19, fontSize: 10.5 }} />
          </Tooltip>

          {/* Where it actually lives — the three different meanings of
              "registered" P0 found. A card that implied a pack has an archive
              zip would be inventing a file. */}
          <Tooltip title={kind.registry} enterDelay={500}>
            <Chip
              size="small"
              variant="outlined"
              label={card.registration}
              sx={{ height: 19, fontSize: 10.5 }}
            />
          </Tooltip>

          {!enabled && (
            <Chip
              size="small"
              color="warning"
              variant="outlined"
              label="disabled"
              sx={{ height: 19, fontSize: 10.5 }}
            />
          )}

          {disk?.signature && (
            <Tooltip title={`Content signature — ${disk.signature}`} enterDelay={400}>
              <Chip
                size="small"
                color="success"
                variant="outlined"
                label="signed"
                sx={{ height: 19, fontSize: 10.5 }}
              />
            </Tooltip>
          )}

          {disk && disk.archive !== null && !disk.archivePresent && (
            <Tooltip title={`The registry names ${disk.archive} and it is not on disk`}>
              <Chip
                size="small"
                color="warning"
                variant="outlined"
                label="no zip"
                sx={{ height: 19, fontSize: 10.5 }}
              />
            </Tooltip>
          )}

          {dangling.length > 0 && (
            <Tooltip
              title={`Points at ${dangling.map((r) => r.id).join(", ")} — nothing resolves ${
                dangling.length === 1 ? "it" : "them"
              }`}
            >
              <Chip
                size="small"
                color="error"
                variant="outlined"
                label={`${dangling.length} dangling`}
                sx={{ height: 19, fontSize: 10.5 }}
              />
            </Tooltip>
          )}

          {notes.length > 0 && (
            <Tooltip title={notes.map((n) => n.message).join(" · ")}>
              <Chip
                size="small"
                color="error"
                variant="outlined"
                label={notes.length === 1 ? "1 problem" : `${notes.length} problems`}
                sx={{ height: 19, fontSize: 10.5 }}
              />
            </Tooltip>
          )}
        </Stack>
      </CardActionArea>
    </Card>
  );
}
