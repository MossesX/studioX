/**
 * @file `dash-amberx-console` — the owner's Artifact as the DEFAULT dashboard
 * wrapper (MASTER §4.4, with the P7 amendment).
 *
 * The point of this wrapper is that it is the same KIND as the sandbox pair
 * was, with different data — if building it had needed a code change to the
 * dashboard kind, the kind was wrong and that would have been the finding.
 * (The sandbox pair and the GizmoX replica were deleted by the v0.3.0 P0
 * strip; this is the only registered wrapper now.)
 *
 * Who owns which piece of the artifact's chrome, as of 2026-08-12:
 *
 *   - **banner** — whichever toolbar asset the THEME's `bannerBar` dial names
 *     (`console-bar` is a registered candidate); mounted by `AppShell`,
 *     outside the wrapper, like every banner.
 *   - **rail** — whichever nav-menu asset the theme's `navMenu` dial names
 *     (`console-nav` is a candidate), placed by `NavShell` from the layout
 *     dials. A theme roll can relocate and redesign it, hot, with this
 *     wrapper's own chrome intact.
 *   - **look** — the THEME, alone. The artifact style package and the look
 *     binding that re-applied it died with the style-pack kind; a wrapper
 *     that re-asserted chrome or dials on activation was a second author
 *     fighting the theme designer.
 *   - **wrapper chrome** (this file's render): the artifact rail's
 *     non-navigation branding block (the INTEGRATED FRAMEWORK sub-label) as a
 *     slim band over the screen, and the `console-status` strip below it —
 *     the artifact's `#statusbar` line · clock · accent mode label, filled
 *     with live values, mounted on its own `console.status` surface.
 *
 * ── MUI (2026-08-10, P4) ─────────────────────────────────────────────────────
 *
 *   - `consoleChrome` is still a plain function, not a component, for the P8
 *     reconciliation reason below. MUI adds no hooks HERE: `Box`, `Stack` and
 *     `Typography` call `useTheme` inside themselves, where hooks are legal.
 *
 * Three hand-painted containers became MUI, which is the ledger entry this
 * phase owns (`scripts/check-ui.mjs`, `PRE_MUI_DEBT`):
 *
 *   - the INTEGRATED FRAMEWORK sub-band is a `Stack direction="row"` — it is a
 *     spaced horizontal row and nothing more, which is the one thing `Stack` is.
 *     It is deliberately NOT a `Paper`: `Paper` paints `background.paper`
 *     (`--axf-panel`), and this band sits ON the page with only a rule under
 *     it. A `Paper` here would put a panel-coloured stripe across the top of
 *     every screen, which is a look change wearing a component's name.
 *   - the screen container and the outer column are `Box`.
 *   - `StripClock`'s span is `Typography`.
 *
 * Geometry stays literal px (`3px 16px`, `gap: 8px`) rather than moving to
 * `theme.spacing`, matching what `core/toolbar/Toolbar.tsx` already does: this
 * band's arrangement belongs to the wrapper, and routing it through the `gap`
 * dial would make a theme roll resize chrome the roll was never asked to touch.
 * Colour, type and the rule DO follow the theme, exactly as before, through
 * `token()`.
 *
 * The `font: "inherit"` on each `Typography` is the `AppShell` idiom and it is
 * load-bearing: the MUI bridge writes `fontSize`/`fontFamily`/`letterSpacing`
 * onto `body1`, so a bare `Typography` inside the band would silently drop the
 * band's micro size and mono face. `font` is a shorthand, so it comes FIRST and
 * the specific overrides after it — reversed, the shorthand erases them.
 *
 * ### Editing this file needs a dev-server restart to be VISIBLE — read before
 * ### concluding an edit here "did nothing"
 *
 * Found the hard way at P4, and it cost most of the phase. A long-lived
 * `next dev` will keep server-rendering the OLD version of this wrapper no
 * matter how many times the file is saved, because:
 *
 *   1. the wrapper is registered ONCE, at module scope, into core's
 *      `dashboards` singleton, and `boot()`'s idempotence then skips
 *      re-registration — so the registry keeps holding the ORIGINAL object,
 *      with the original `render` closure, for the life of the process;
 *   2. HMR replaces this module and produces a NEW `DASH_AMBERX_CONSOLE`, which
 *      nothing ever puts in the registry;
 *   3. the client compiles the new code while the server serves the old, React
 *      reports an attribute mismatch and — as it warns — does NOT patch it up,
 *      so the DOM keeps the server's markup.
 *
 * Measured, not inferred: every other surface on the page (AppShell's column,
 * NavShell's `<main>`, the toolbars, the landing page's own `Stack`) rendered
 * fresh MUI classes server-side in the same response, and every route showed
 * the same stale wrapper. Touching this file, and separately invalidating
 * core's `dashboard/registry.ts`, both failed to clear it.
 *
 * This is dev-only — a fresh process registers whatever is on disk, so SSR and
 * the client agree in production. But it means **a screenshot taken against a
 * long-running dev server is not evidence that an edit here landed**. Check for
 * `MuiStack-root` on `[data-axs-console-subline]`, not for the look: the look
 * is unchanged by the MUI conversion, which is exactly what makes the stale
 * render so easy to mistake for a good one.
 */
"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { AXF_CORE_VERSION, defineDashboard, registry, token, Toolbar } from "@axf/core";
import type { DashboardCtx } from "@axf/core";

/* ------------------------------------------------------------ strip fills */

/** The strip's clock — 1s tick, cleared on unmount, empty until the first
 *  client tick so server and first client paint agree. */
function StripClock() {
  const [now, setNow] = React.useState<string | null>(null);
  React.useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (now === null) return null;
  // `component="span"`: this lands inside the status strip's slot, which is an
  // inline flex row, and Typography's default <p> would break it. `font` is a
  // shorthand and must precede `fontVariantNumeric`, or it erases it — the
  // clock would then jitter one pixel per second on a proportional face.
  return (
    <Typography component="span" sx={{ font: "inherit", fontVariantNumeric: "tabular-nums" }}>
      {now}
    </Typography>
  );
}

/** The artifact's readout line, with live values instead of the mock's.
 *
 *  Left as a fragment on purpose: it is TEXT, not a container. `Toolbar`
 *  already wraps every filled slot in a `Box` that owns the colour, the clip
 *  and the alignment, so wrapping it again here would add a second box to
 *  style and nothing to look at. */
function StripLine() {
  return (
    <>
      AmberX AI Studio · core {AXF_CORE_VERSION} · {registry.modules().length}/12 module slots
    </>
  );
}

/* ---------------------------------------------------------------- chrome */

/**
 * A plain function, DELIBERATELY not a component (P8): `DashboardChrome`
 * re-renders `dashboard.render(ctx)` on a swap, and React reconciles by
 * position and type — a `<ConsoleChrome/>` element type of this wrapper's own
 * would make every swap to another wrapper remount the whole subtree, screen
 * included. Rendered inline, a bound wrapper contributes to one keyed
 * host-element skeleton: the screen container is `<div key="screen">` with the
 * same style in every wrapper, so a swap morphs it in place and the screen's
 * state survives — the P8 gate. That property is kept deliberately even though
 * P0 left one wrapper registered: it is the contract the NEXT wrapper has to
 * meet, and it is cheaper to hold than to rediscover. Hooks stay legal by
 * living in the leaf components (`StripClock`, `StripLine`), never here.
 */
function consoleChrome(ctx: DashboardCtx) {
  return (
    // height 100%, not minHeight: the strip pins to the bottom of the module
    // viewport (the artifact's #statusbar posture) and the SCREEN scrolls
    // between the sub-band and the strip.
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* The artifact rail's branding block — NOT navigation, so it is wrapper
          chrome rather than a nav item (the P7 amendment), and NOT a brand
          item, because the banner already carries the lockup and repeating it
          is how an app ends up with three logos on one screen. */}
      <Stack
        key="strip"
        direction="row"
        data-axs-console-subline=""
        sx={{
          alignItems: "center",
          gap: "8px",
          padding: "3px 16px",
          flexShrink: 0,
          fontFamily: token("mono"),
          fontSize: "var(--axf-size-micro)",
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: token("dim"),
          borderBottom: `1px solid ${token("edge")}`
        }}
      >
        <Typography component="span" sx={{ font: "inherit", letterSpacing: "0.22em" }}>
          Integrated Framework
        </Typography>
        <Box component="span" sx={{ flex: 1 }} />
        <Typography component="span" sx={{ font: "inherit", letterSpacing: "0.12em" }}>
          {ctx.pathname || "/"}
        </Typography>
      </Stack>

      {/* The screen. The wrapper owns nothing inside it; it scrolls here. The
          key and style are the shared-skeleton contract every wrapper meets —
          restated for MUI: the skeleton element is now `<Box key="screen">`
          rather than `<div key="screen">`. React reconciles by element TYPE, and
          `Box` is one imported component identity shared by every wrapper, so
          the morph-in-place property is intact; what would break it is one
          wrapper keeping a raw div while another uses Box. The next wrapper
          uses Box. */}
      <Box
        key="screen"
        sx={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column" }}
      >
        {ctx.children}
      </Box>

      {/* The artifact's #statusbar, as the registered console-status asset on
          its own surface — readout line, clock, accent mode label. */}
      <Toolbar
        key="status"
        surface="console.status"
        fill={{
          line: <StripLine />,
          clock: <StripClock />,
          mode: "PRE-BUILD PREVIEW"
        }}
      />
    </Box>
  );
}

export const DASH_AMBERX_CONSOLE = defineDashboard({
  id: "dash-amberx-console",
  title: "AmberX console",
  description:
    "The owner's Artifact console: breadcrumb banner, labeled 212px nav rail, INTEGRATED " +
    "FRAMEWORK sub-band and a bottom status strip — the artifact style as its look.",
  render: (ctx) => consoleChrome(ctx)
});

/* ------------------------------------------------------------- activation */

/*
 * There is none, and that is the 2026-08-12 design. This wrapper used to bind
 * a "look" to its activation — activate the console bar and nav, apply the
 * artifact style package, set three layout dials. Every one of those writers
 * is gone with the thing it wrote to: style packages no longer exist, the
 * banner and menu are the THEME's `bannerBar` / `navMenu` dials, and the rail
 * geometry is whatever the applied theme says. A wrapper that re-asserted its
 * own chrome was a second author fighting the theme designer — the exact
 * "renders one way for a second, then changes" class the owner reported.
 */
