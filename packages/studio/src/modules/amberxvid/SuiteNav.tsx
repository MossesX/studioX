"use client";

/**
 * @file **The suite's navigation, drawn from the declaration** (P14 of
 * `axf-amberxvid-social`, 2026-08-15).
 *
 * `amberxvid.decl.ts` declares `AMBERXVID_NAV` — the platform's surfaces as
 * data, carried by the peel and registered on `app.nav` by a peeled app's boot.
 * This file is the other half of that sentence: the two places the suite draws
 * navigation for itself both read THOSE items, so the declaration is not a
 * parallel description of the screen — it is the screen's only list.
 *
 * ## Why this replaced two hand-written lists
 *
 * Before P14 the shell carried a row of `<Button>`s (nine surfaces, hand-typed,
 * with per-button badge `sx`) and a `SuiteEntry[]` for the suite map (ten
 * surfaces, hand-typed, with notes). They had already drifted in three ways:
 * the map offered "Video chat" where the bar offered "Calls", Rooms was on the
 * bar and absent from the map, and the map's phase labels named phases that had
 * shipped. Two lists of one thing is one list plus a bug waiting for a reader.
 *
 * ## What lives here and what deliberately does not
 *
 * The declaration owns **what is navigable** — id, label, glyph, order,
 * grouping. This file owns only what a *declaration cannot carry*:
 *
 *  - **{@link SurfaceBadge}** — the live number beside a surface. It comes from
 *    the shell's engines (unread mail, open streams, missed calls), which exist
 *    only at runtime, so the bar takes them as a prop rather than inventing a
 *    second poll of its own.
 *  - **{@link SURFACE_NOTES}** — the one-line description the suite map prints.
 *    `NavItem` has no description field and should not grow one for us: a nav
 *    menu asset is chrome shared with every other host, and a note that only
 *    the suite map reads belongs to the suite map.
 *
 * Both are keyed by nav item id and both degrade to nothing, so a link added to
 * the declaration appears in the bar and the map immediately — with no badge
 * and no note until somebody writes them, rather than not appearing at all.
 *
 * ## Icons
 *
 * Glyph ids come off the declared items and render through `Glyph` from
 * `@axf/core` — the branding pack's own drawings, painted in the pack's role
 * variables, so the whole bar recolours with the theme. No Material import, no
 * inline SVG; see `.claude/rules/no-hand-rolled-ui.md`.
 */

import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { Glyph } from "@axf/core";
import type { NavItem } from "@axf/core";

import { AMBERXVID_NAV } from "./amberxvid.decl";
import { GX, gxa } from "./kit/gx";

/* --------------------------------- contracts --------------------------------- */

/** A declared link, narrowed — the only item kind either surface renders. */
export type NavLink = Extract<NavItem, { kind: "link" }>;

/** Every declared link, in declaration order. */
export const NAV_LINKS: readonly NavLink[] = AMBERXVID_NAV.items.filter(
  (i): i is NavLink => i.kind === "link"
);

/** The declared sections, each with the links that follow it. */
export const NAV_SECTIONS: readonly { label: string; links: readonly NavLink[] }[] = (() => {
  const out: { label: string; links: NavLink[] }[] = [];
  for (const item of AMBERXVID_NAV.items) {
    if (item.kind === "section") out.push({ label: item.label, links: [] });
    else if (item.kind === "link") {
      if (out.length === 0) out.push({ label: "", links: [] });
      out[out.length - 1].links.push(item);
    }
  }
  return out;
})();

/** Every declared link id — what `?view=` is validated against. */
export const NAV_IDS: readonly string[] = NAV_LINKS.map((l) => l.id);

/**
 * A live count beside a surface, and how loudly it reads.
 *
 * `tone` is the semantic kind (`KIND_COLORS`), not a colour: the badge has to
 * mean something. `err` is for things that happened while nobody was looking
 * (missed calls) or that are happening right now (a room on air); `accent` is
 * for something waiting on the member; `info` is merely informative.
 */
export interface SurfaceBadge {
  count: number;
  tone: "accent" | "err" | "info" | "warn";
  /** Overrides the tooltip — otherwise the label plus the count. */
  title?: string;
}

/** One line per surface for the suite map. Missing is fine — see the docblock. */
export const SURFACE_NOTES: Record<string, string> = {
  recorder: "Browser capture on the stage, or the tray service in the background",
  library: "Every recording you own — grid or list, full playback, notes",
  feed: "Your wall merged with your buddies', twenty at a time",
  profile: "Your accounts profile with the wall, albums and media rails beside it",
  albums: "Justified-rows albums, keyboard lightbox, per-album visibility",
  profiles: "The member directory — profiles, avatars and portraits",
  messenger: "Buddies, DMs and group chats on the accounts store",
  rooms: "N-way video rooms, the paginated 49-tile grid and its chat rail",
  streams: "Member broadcasting with room chat, hover previews and ratings",
  calls: "Calls and rooms you have been in, with do-not-disturb"
};

/* -------------------------------- the surface bar ------------------------------ */

export interface SuiteNavProps {
  /** The surface on screen — a declared link id. */
  active: string;
  /** Navigate. The shell decides what a surface id means (stage or drawer). */
  onOpen: (id: string) => void;
  /** Live counts by link id; absent or zero draws no badge. */
  badges?: Record<string, SurfaceBadge | undefined>;
  /** Extra controls pinned to the end of the bar (refresh, role chips). */
  trailing?: React.ReactNode;
}

/**
 * The suite's surface bar — one row, every declared link, in order.
 *
 * Sections are rendered as thin separators rather than headings: the bar is
 * horizontal and a heading in a wrapping row reads as another button. The
 * grouping still carries, which is the part that was worth declaring.
 */
export function SuiteNav({ active, onOpen, badges = {}, trailing }: SuiteNavProps) {
  return (
    <Box
      data-el-id="amberxvid:nav"
      sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0, flexWrap: "wrap", rowGap: 0.5 }}
    >
      {AMBERXVID_NAV.items.map((item) => {
        if (item.kind === "section") return null;
        if (item.kind === "divider") {
          return (
            <Box
              key={item.id}
              aria-hidden
              sx={{ width: "1px", alignSelf: "stretch", my: 0.5, bgcolor: GX.edge, flexShrink: 0 }}
            />
          );
        }
        const badge = badges[item.id];
        const on = active === item.id;
        const tone = badge && badge.count > 0 ? KIND[badge.tone] : null;
        return (
          <Tooltip
            key={item.id}
            title={badge && badge.count > 0 ? (badge.title ?? `${item.label} · ${badge.count}`) : item.label}
            disableInteractive
            placement="bottom"
          >
            <Button
              size="small"
              variant={on ? "contained" : "outlined"}
              onClick={() => onOpen(item.id)}
              data-el-id={`amberxvid:nav:${item.id}`}
              startIcon={<Glyph id={item.glyph} size={15} />}
              sx={{
                py: 0.25,
                fontSize: 11.5,
                // The badge tint applies to the RESTING button only: a
                // contained (active) button already owns the accent, and
                // tinting its border there just muddies which one is open.
                ...(tone && !on ? { color: tone, borderColor: gxa(tone, "66") } : null)
              }}
            >
              {item.label}
              {badge && badge.count > 0 ? ` · ${badge.count}` : ""}
            </Button>
          </Tooltip>
        );
      })}
      {trailing ? (
        <>
          <Box sx={{ flex: 1, minWidth: 8 }} />
          {trailing}
        </>
      ) : null}
    </Box>
  );
}

/* --------------------------------- the suite map ------------------------------- */

export interface SuiteMapProps {
  active: string;
  onOpen: (id: string) => void;
  badges?: Record<string, SurfaceBadge | undefined>;
  /** Rows the viewer may not open — an admin-only surface for a member. */
  hidden?: readonly string[];
}

/**
 * The suite map — the same declared list, grouped by its declared sections and
 * carrying each surface's one-line note.
 *
 * It is not a duplicate of the bar so much as the bar's index: the bar answers
 * "where am I", this answers "what is here", which is the question somebody has
 * on their first day and never again.
 */
export function SuiteMap({ active, onOpen, badges = {}, hidden = [] }: SuiteMapProps) {
  const skip = new Set(hidden);
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
      {NAV_SECTIONS.map((section) => {
        const links = section.links.filter((l) => !skip.has(l.id));
        if (links.length === 0) return null;
        return (
          <Box key={section.label} sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
            {section.label && (
              <Typography
                sx={{
                  fontFamily: GX.chrome,
                  fontSize: 9,
                  letterSpacing: 1.6,
                  textTransform: GX.chromeUpper,
                  color: GX.dim,
                  mt: 0.5
                }}
              >
                {section.label}
              </Typography>
            )}
            {links.map((link) => {
              const badge = badges[link.id];
              const on = active === link.id;
              const tone = badge && badge.count > 0 ? KIND[badge.tone] : null;
              return (
                <Box
                  key={link.id}
                  component="button"
                  data-el-id={`amberxvid:suite:${link.id}`}
                  onClick={() => onOpen(link.id)}
                  sx={{
                    all: "unset",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    p: 0.75,
                    borderRadius: 1,
                    color: GX.ink,
                    bgcolor: on ? gxa(GX.accent, "14") : "transparent",
                    "&:hover": { bgcolor: gxa(GX.accent, "0d") }
                  }}
                >
                  <Glyph id={link.glyph} size={16} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.2 }}>
                      {link.label}
                    </Typography>
                    {SURFACE_NOTES[link.id] && (
                      <Typography sx={{ fontSize: 10, color: GX.dim, lineHeight: 1.35 }}>
                        {SURFACE_NOTES[link.id]}
                      </Typography>
                    )}
                  </Box>
                  <Box sx={{ flex: 1 }} />
                  {badge && badge.count > 0 && (
                    <Box
                      component="span"
                      sx={{
                        minWidth: 18,
                        px: 0.5,
                        borderRadius: 9,
                        textAlign: "center",
                        fontFamily: GX.mono,
                        fontSize: 10,
                        fontWeight: 700,
                        color: tone ?? GX.dim,
                        border: `1px solid ${gxa(tone ?? GX.dim, "66")}`,
                        bgcolor: gxa(tone ?? GX.dim, "1A"),
                        flexShrink: 0
                      }}
                    >
                      {badge.count}
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
        );
      })}
    </Box>
  );
}

/* ---------------------------------- internals ---------------------------------- */

/** Badge tone → the module kit's semantic colour. */
const KIND: Record<SurfaceBadge["tone"], string> = {
  accent: GX.accent,
  err: GX.err,
  info: GX.info,
  warn: GX.warn
};
