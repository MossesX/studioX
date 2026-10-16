"use client";

/**
 * @file The left rail — every graphical asset KIND, grouped by lifecycle.
 *
 * Grouped rather than flat because P0's headline finding is that "graphical
 * asset" reads like one category and is three, with three different ideas of
 * what "registered" and "edited" mean (`kinds.ts`). A flat list would say the
 * opposite of the thing the map exists to record, and the first person to build
 * a mutation surface off a flat rail would offer the same five buttons on all
 * seven kinds and be lying about five of them.
 *
 * Every row is `data-axf-area="asset-browser.kind"` and carries its kind id, so
 * the decl's rows resolve without this file knowing a menu exists.
 */

import * as React from "react";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import { GRAPHICAL_KINDS } from "../../asset-browser/kinds";
import type { AssetLifecycle } from "../../asset-browser/kinds";

/** The three lifecycles in rail order, with the heading each gets. */
const LIFECYCLES: readonly { id: AssetLifecycle; label: string; hint: string }[] = [
  {
    id: "generated-asset",
    label: "Generated assets",
    hint:
      "A schema, a manifest, an archive zip, an installed directory and a registry row. " +
      "Authored by the framework and signed — changed by editing the TypeScript source and " +
      "re-running the generator, never by writing the manifest."
  },
  {
    id: "code-pack",
    label: "Code packs",
    hint:
      "Registered into core's in-memory PackRegistry at boot from src/packs/. No registry " +
      "row, no schema, no zip — the contract is core's TypeScript. Selection is an app " +
      "setting made at /settings."
  },
  {
    id: "chrome-asset",
    label: "Chrome",
    hint:
      "Validated by core's define*() chokepoints. Shipped instances are code; user-built " +
      "ones live whole in the one chrome-assets kv document, revalidated on save AND on load."
  }
];

export interface KindRailProps {
  /** The kind filtered to, or null for every kind. */
  readonly value: string | null;
  readonly onChange: (kind: string | null) => void;
  /** Per kind, how many instances the catalog found. */
  readonly counts: ReadonlyMap<string, number>;
  /** Keep a kind listed when it has no instances. */
  readonly showEmpty: boolean;
  readonly total: number;
}

export default function KindRail({ value, onChange, counts, showEmpty, total }: KindRailProps) {
  return (
    <Box
      data-axf-area="asset-browser.surface"
      sx={{ height: "100%", overflowY: "auto", bgcolor: token("panel"), py: 0.5 }}
    >
      {/* A FLAT list. MUI's nested `<ul>`-inside-`<li>` recipe exists to make
          subheaders stick while their group scrolls; these are `disableSticky`,
          so the nesting would buy nothing and cost two hand-rolled elements —
          which is what `check:ui` said about it, correctly. */}
      <List dense disablePadding>
        <ListItemButton
          selected={value === null}
          onClick={() => onChange(null)}
          sx={{ borderRadius: 1, mx: 0.5 }}
        >
          <ListItemText
            primary="Every kind"
            slotProps={{ primary: { sx: { fontWeight: 600, fontSize: 13 } } }}
          />
          <Chip size="small" label={total} sx={{ height: 18, fontSize: 11 }} />
        </ListItemButton>

        {LIFECYCLES.map((life) => {
          const kinds = GRAPHICAL_KINDS.filter(
            (k) => k.lifecycle === life.id && (showEmpty || (counts.get(k.id) ?? 0) > 0)
          );
          // A lifecycle whose every kind is empty and hidden gets no heading —
          // a heading over nothing reads as a loading state.
          if (kinds.length === 0) return null;
          return (
            <React.Fragment key={life.id}>
              <Tooltip title={life.hint} placement="right" enterDelay={400}>
                <ListSubheader
                  disableSticky
                  sx={{
                    bgcolor: "transparent",
                    color: token("dim"),
                    fontSize: 10.5,
                    letterSpacing: "0.09em",
                    textTransform: "uppercase",
                    lineHeight: "26px",
                    cursor: "help"
                  }}
                >
                  {life.label}
                </ListSubheader>
              </Tooltip>
              {kinds.map((kind) => {
                const count = counts.get(kind.id) ?? 0;
                return (
                  <ListItemButton
                    key={kind.id}
                    data-axf-area="asset-browser.kind"
                    data-axf-kind={kind.id}
                    selected={value === kind.id}
                    onClick={() => onChange(kind.id)}
                    sx={{ borderRadius: 1, mx: 0.5, alignItems: "flex-start" }}
                  >
                    <ListItemText
                      primary={kind.display}
                      secondary={kind.blurb}
                      slotProps={{
                        primary: { sx: { fontSize: 13 } },
                        secondary: {
                          sx: {
                            fontSize: 11,
                            color: token("dim"),
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden"
                          }
                        }
                      }}
                    />
                    <Chip
                      size="small"
                      label={count}
                      /* An empty kind is not an error, and colouring it like one
                         would teach people to ignore the colour. It is dimmed
                         instead: "none of these exist yet". */
                      variant={count === 0 ? "outlined" : "filled"}
                      sx={{ height: 18, fontSize: 11, mt: 0.25, opacity: count === 0 ? 0.6 : 1 }}
                    />
                  </ListItemButton>
                );
              })}
            </React.Fragment>
          );
        })}
      </List>

      <Typography
        component="p"
        sx={{ px: 1.5, py: 1, fontSize: 10.5, color: token("dim"), lineHeight: 1.5 }}
      >
        Three lifecycles, three different meanings of “registered”. Hover a heading for which.
      </Typography>
    </Box>
  );
}
