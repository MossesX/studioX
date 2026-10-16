"use client";

/**
 * @file Renders `claude-workspace.panel` contributions — the point P5 absorbs
 * Agent Forge, the diff browser and the Build Manager plugin through.
 *
 * ── the empty state is load-bearing ─────────────────────────────────────────
 *
 * Two plugins contribute as of P5 (Agent Forge and the difference browser), so
 * the empty state is no longer the normal case — which makes it MORE useful,
 * not less. A column that simply disappears when empty would leave nobody able
 * to tell "no plugins are installed" from "the point is broken", and the second
 * is now the likelier of the two: it is what a boot that never ran
 * `studio.subsystem.ts` looks like, and what a peel of this module without its
 * closure looks like. So the empty state names the point id and says what
 * should be filling it.
 *
 * ── every panel is boundaried ───────────────────────────────────────────────
 *
 * Core's crash isolation exists because *"large modules will be built almost
 * entirely from plugins, so a plugin must not be able to crash its module"*
 * (`AXF_CAPABILITIES["render-crash-isolation"]`). A panel here is third-party
 * code rendering inside the workspace, which is the exact case those three
 * boundary tiers were built for — so each one gets its own `Boundary`, and a
 * panel that throws takes down its own pane and nothing else.
 *
 * ── and its own Suspense (P5) ───────────────────────────────────────────────
 *
 * Added when the first real panels arrived, because of a constraint on the
 * OTHER side of the seam: a `plugin.ts` may not import a `.tsx` (the closure
 * resolver reads it under plain Node with no JSX transform), so a panel's
 * `render()` returns a `React.lazy` element. A lazy element with no `Suspense`
 * above it throws the promise to the nearest one — which here would be outside
 * the module, and would blank the whole workspace while a side pane loaded.
 * Per panel, inside its own `Boundary`, so one slow panel neither blocks its
 * neighbours nor escapes its own boundary.
 */
import * as React from "react";

import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";
import Typography from "@mui/material/Typography";

import { Boundary, Glyph, token } from "@axf/core";

import { CLAUDE_PANEL_POINT, panelContributions } from "./points";

export default function PanelHost() {
  const panels = panelContributions();

  if (!panels.length) {
    return (
      <Box sx={{ p: 1.2 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 700, mb: 0.4 }}>Panels</Typography>
        <Typography sx={{ fontSize: 11.5, color: token("dim"), lineHeight: 1.6 }}>
          Nothing is contributing to <code>{CLAUDE_PANEL_POINT}</code>. Agent Forge and the
          difference browser should be — they reach this column through the registry rather than by
          being imported into this screen, so an empty column here means the host never registered
          them, not that they are missing.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflowY: "auto" }}>
      {panels.map((contribution) => (
        <Box
          key={`${contribution.from}:${contribution.payload.title}`}
          sx={{ borderBottom: `1px solid ${token("edge")}` }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.6,
              px: 1,
              py: 0.4,
              background: token("panel")
            }}
          >
            {contribution.payload.glyph && <Glyph id={contribution.payload.glyph} size={13} />}
            <Typography sx={{ fontSize: 11.5, fontWeight: 700 }}>
              {contribution.payload.title}
            </Typography>
            <Box sx={{ flex: 1 }} />
            {/* Naming the contributor is not decoration: when a panel misbehaves
                the first question is whose it is, and a boundary's own message
                only knows that a render threw. */}
            <Typography sx={{ fontSize: 10, color: token("dim") }}>{contribution.from}</Typography>
          </Box>
          <Box sx={{ p: 1 }}>
            <Boundary tier="contribution" source={contribution.from} compact>
              <React.Suspense fallback={<Skeleton variant="rounded" height={56} />}>
                {contribution.payload.render()}
              </React.Suspense>
            </Boundary>
          </Box>
        </Box>
      ))}
    </Box>
  );
}
