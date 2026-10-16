/**
 * @file The pane-geometry probe surface — the fixed tree
 * `scripts/geometry-probe.mjs` measures.
 *
 * The tree has deliberately UNEQUAL weights, and that is the whole design: a
 * renderer that latches at minimums instead of honouring fractions cannot fake
 * a 68/32 split. GizmoX's LayoutRenderer prorated weights against an unmeasured
 * (zero) extent and latched every split at its minimum, and it looked
 * deliberate on screen — the only thing that catches it is a number.
 *
 * On `/sandbox/panes` drags latch per-user through the kv route; with `?fresh`
 * there is no `storageKey`, so the probe asserts first paint against the
 * DECLARED weights with no latch in the way.
 *
 * Restored in P2 (2026-08-10) from the v0.3.0 P0 archive, as
 * `plugins/pane-probe/` rather than under the deleted `plugins/sandbox/`: the
 * sandbox panel was stripped on purpose and is not coming back, but the pane
 * renderer's verification surface is TOOLING, and P2 rebuilt `PaneLayout` on
 * MUI with an explicit requirement to report measured sizes rather than say it
 * looks right. The route path is unchanged so `geometry-probe.mjs` needs no
 * edit — a probe whose fixture moves is a probe that gets run with the wrong
 * argument.
 */
"use client";

import Box from "@mui/material/Box";

import { PaneLayout, definePanes, token } from "@axf/core";

const TREE = definePanes({
  kind: "split",
  direction: "column",
  weights: [5, 1],
  children: [
    {
      kind: "split",
      direction: "row",
      weights: [68, 32],
      children: [
        { kind: "pane", id: "transcript", minSize: 240 },
        {
          kind: "split",
          direction: "column",
          weights: [1, 1],
          children: [
            { kind: "pane", id: "tools", minSize: 96 },
            { kind: "pane", id: "library", minSize: 96 }
          ]
        }
      ]
    },
    { kind: "pane", id: "composer", minSize: 72 }
  ]
});

function Cell({ id }: { id: string }) {
  return (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: `1px solid ${token("edge")}`,
        background: token("panel"),
        color: token("dim"),
        fontFamily: token("mono"),
        fontSize: 12,
        letterSpacing: "1px",
        textTransform: "uppercase"
      }}
    >
      {id}
    </Box>
  );
}

export default function PaneProbe({ fresh }: { fresh: boolean }) {
  return (
    // The shell's documented viewport-app opt-out (core NavMenu.tsx): `flex: 1`
    // + `minHeight: 0` INLINE bound this page to <main>, so the panes scroll
    // themselves rather than the document.
    //
    // Those two stay on `style` and the rest moves to `sx`, and the split is
    // not cosmetic. The rule being opted out of is `[data-axf-main] > * {
    // flex-shrink: 0 }`, written as an UNLAYERED <style> block precisely so it
    // outranks anything in `@layer mui` — which is every class `sx` generates.
    // An inline declaration is the one form that still wins, and `flex: 1`
    // expands to `1 1 0%`, so it is the shrink half that does the work here.
    <Box
      sx={{ display: "flex", flexDirection: "column", padding: "8px" }}
      style={{ flex: 1, minHeight: 0 }}
    >
      <PaneLayout
        tree={TREE}
        storageKey={fresh ? undefined : "sandbox-panes"}
        renderPane={(id) => <Cell id={id} />}
      />
    </Box>
  );
}
