/**
 * @file The dashboard card registry — six cards, every one backed by a live
 * source (see `useCardData`'s docblock for the set and why it shrank from the
 * pre-strip twelve).
 *
 * Cards stay a PLAIN registry — not contributions to an extension point.
 * Promoting them is the natural next step (it makes the peel closure computable
 * and lets a plugin add one) but it was not needed before the strip and is not
 * needed now.
 *
 * ── MUI (2026-08-11, the rebuild) ──────────────────────────────────────────
 * Chips are `Chip`, tiles and rows that navigate are `ButtonBase`/
 * `CardActionArea`-style surfaces, text is `Typography`. Colours still come
 * from `token()` so the cards recolour with a pack swap exactly like the
 * chrome. Glyphs are CONTRACT ids only (`REQUIRED_GLYPH_IDS`) — `check:glyphs`
 * scans this file like any other surface.
 */
"use client";

import * as React from "react";

import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { Glyph, token } from "@axf/core";

import { useCardData } from "./useCardData";

export interface CardMeta {
  id: string;
  title: string;
  /** Contract glyph id, drawn beside the title by the card header. */
  glyph: string;
  description: string;
  render: () => React.ReactElement;
}

/** Every nav click in this app is a document load, same as NavShell's rows. */
const go = (route: string) => window.location.assign(route);

/** The dim mono label voice the readout rows share. */
const label = {
  fontFamily: token("mono"),
  fontSize: 10.5,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: token("dim")
} as const;

/* ------------------------------------------------------------------ cards */

function WelcomeCard() {
  const data = useCardData("welcome");
  const chipBg: Record<string, string> = {
    accent: "color-mix(in srgb, var(--axf-accent) 14%, transparent)",
    ok: "color-mix(in srgb, var(--axf-ok) 14%, transparent)",
    violet: "rgba(167,139,250,0.14)"
  };
  return (
    <Box>
      <Typography sx={{ fontSize: 22, fontWeight: 800, lineHeight: 1.2 }}>
        {data.titleLead}
        <Box component="span" sx={{ color: token("accent") }}>
          {data.titleAccent}
        </Box>
      </Typography>
      <Typography sx={{ fontSize: 13, color: token("dim"), marginTop: "5px", lineHeight: 1.5 }}>
        {data.tagline}
      </Typography>
      <Stack direction="row" sx={{ gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
        {data.chips.map((chip) => (
          <Chip
            key={chip.id}
            label={chip.label}
            size="small"
            sx={{
              background: chipBg[chip.tone] ?? token("panel2"),
              color: token("ink"),
              fontSize: 11.5
            }}
          />
        ))}
      </Stack>
    </Box>
  );
}

/** Tiles are the studio nav's own link rows, so every tile navigates. */
function QuickLaunchCard() {
  const { tiles } = useCardData("quick-launch");
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "5px" }}>
      {tiles.map((tile) => (
        <ButtonBase
          key={tile.id}
          onClick={() => go(tile.route)}
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "4px",
            padding: "8px 2px",
            border: `1px solid ${token("edge")}`,
            borderRadius: "var(--axf-radius-tight)",
            color: token("ink"),
            "&:hover": { borderColor: token("accent") }
          }}
        >
          <Glyph id={tile.glyph} size={17} />
          <Typography
            component="span"
            sx={{
              fontSize: 9.5,
              color: token("dim"),
              maxWidth: "100%",
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis"
            }}
          >
            {tile.label}
          </Typography>
        </ButtonBase>
      ))}
    </Box>
  );
}

/** LIVE — the module registry, against the suite cap. */
function ModulesCard() {
  const { rows, cap } = useCardData("modules");
  return (
    <Stack sx={{ gap: "6px" }}>
      <Typography sx={{ ...label }}>
        {rows.length}/{cap} module slots
      </Typography>
      {rows.map((row) => (
        <ButtonBase
          key={row.id}
          onClick={() => go(row.route)}
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-start",
            gap: "8px",
            padding: "5px 8px",
            border: `1px solid ${token("edge")}`,
            borderRadius: "var(--axf-radius-tight)",
            color: token("ink"),
            "&:hover": { borderColor: token("accent") }
          }}
        >
          <Glyph id={row.glyph} size={14} />
          <Typography component="span" sx={{ fontSize: 12.5 }}>
            {row.title}
          </Typography>
          <Typography
            component="code"
            sx={{ marginLeft: "auto", fontFamily: token("mono"), fontSize: 11, color: token("dim") }}
          >
            {row.route}
          </Typography>
        </ButtonBase>
      ))}
      {rows.length === 0 && (
        <Typography sx={{ fontSize: 12, color: token("dim") }}>
          No module registered — the registry is empty.
        </Typography>
      )}
    </Stack>
  );
}

/** LIVE — the theme store, plus which pack (if any) is deciding the surface. */
function ThemeCard() {
  const { state, style } = useCardData("theme");
  const overrides = Object.keys(state.overrides).length;
  const rows: Array<[string, string]> = [
    ["seed", state.seed ?? "default"],
    ["mode", String(state.options.mode ?? "auto")],
    ["harmony", String(state.options.harmony ?? "auto")],
    ["overrides", String(overrides)],
    // The theme decides every --axf-* value since 2026-08-12; the pack is a
    // fixed app setting that only supplies drawings.
    ["banner", String(state.values.bannerBar ?? "") || "app default"],
    ["nav menu", String(state.values.navMenu ?? "") || "app default"]
  ];
  return (
    <ButtonBase
      onClick={() => go("/theme-designer")}
      sx={{ display: "block", width: "100%", textAlign: "left", borderRadius: "var(--axf-radius-tight)" }}
    >
      <Stack sx={{ gap: "4px" }}>
        {rows.map(([k, v]) => (
          <Stack key={k} direction="row" sx={{ alignItems: "baseline", gap: "8px" }}>
            <Typography component="span" sx={{ ...label, width: 76, flexShrink: 0 }}>
              {k}
            </Typography>
            <Typography
              component="span"
              sx={{
                fontFamily: token("mono"),
                fontSize: 12.5,
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis"
              }}
            >
              {v}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </ButtonBase>
  );
}

/** LIVE — the pack registry: counts by kind, and the active identity. */
function PacksCard() {
  const { style, counts } = useCardData("packs");
  const active: Array<[string, string | null]> = [
    ["branding", style.brandingId],
    ["logos", style.logoId]
  ];
  return (
    <ButtonBase
      onClick={() => go("/brand")}
      sx={{ display: "block", width: "100%", textAlign: "left", borderRadius: "var(--axf-radius-tight)" }}
    >
      <Typography sx={{ fontSize: 13 }}>
        {counts.branding} branding · {counts.logos} logo packs
      </Typography>
      <Stack sx={{ gap: "3px", marginTop: "6px" }}>
        {active.map(([k, v]) => (
          <Stack key={k} direction="row" sx={{ alignItems: "baseline", gap: "8px" }}>
            <Typography component="span" sx={{ ...label, width: 76, flexShrink: 0 }}>
              {k}
            </Typography>
            <Typography
              component="span"
              sx={{
                fontFamily: token("mono"),
                fontSize: 12,
                color: v ? token("ink") : token("dim"),
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis"
              }}
            >
              {v ?? "—"}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </ButtonBase>
  );
}

/** LIVE — real time, not seeded. */
function ClockCard() {
  const { now } = useCardData("clock");
  return (
    <Box sx={{ textAlign: "center" }}>
      <Typography sx={{ fontSize: 26, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
        {now ? now.toLocaleTimeString() : "—"}
      </Typography>
      <Typography sx={{ fontSize: 11.5, color: token("dim") }}>
        {now
          ? now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
          : ""}
      </Typography>
    </Box>
  );
}

/* --------------------------------------------------------------- registry */

export const CARD_REGISTRY: CardMeta[] = [
  {
    id: "welcome",
    title: "Welcome",
    glyph: "icon-sparkle",
    description: "The studio identity card",
    render: () => <WelcomeCard />
  },
  {
    id: "quick-launch",
    title: "Quick launch",
    glyph: "icon-grid",
    description: "Jump to any studio surface — tiles from the nav asset",
    render: () => <QuickLaunchCard />
  },
  {
    id: "modules",
    title: "Modules",
    glyph: "icon-layers",
    description: "Registered modules against the suite cap",
    render: () => <ModulesCard />
  },
  {
    id: "theme",
    title: "Theme",
    glyph: "icon-brush",
    description: "The theme in force — seed, options, overrides, pack",
    render: () => <ThemeCard />
  },
  {
    id: "packs",
    title: "Brand packs",
    glyph: "icon-palette",
    description: "Registered packs and the active identity",
    render: () => <PacksCard />
  },
  {
    id: "clock",
    title: "Clock",
    glyph: "icon-sync",
    description: "Time and date, live",
    render: () => <ClockCard />
  }
];
