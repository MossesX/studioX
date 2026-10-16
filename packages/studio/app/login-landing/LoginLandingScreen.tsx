"use client";

/**
 * @file The /login-landing screen — a full-viewport front door with a brand
 * banner across the top and the animated mark drifting in the background behind
 * a centered sign-in card.
 *
 * Rendered as a fixed overlay (`position: fixed; inset: 0`), so it owns the
 * whole window and the app chrome never shows through.
 *
 * ## This is the REAL front door (owner, 2026-08-15)
 *
 * It was a visual mock with a fake form until the owner asked that everyone see
 * the same login landing page. It now hosts the studio's actual sign-in by
 * rendering `LoginScreen` — the accounts module's own — rather than
 * re-implementing it. That is the whole design decision, and it is worth saying
 * why: `LoginScreen` already owns the `?next=` return trip and its open-redirect
 * sanitiser, the forced change-password step, the administrator-vs-user role
 * landing, and opening the assistant on arrival. A second sign-in form would
 * have to re-derive every one of those and would drift from the first the day
 * either changed. This file supplies the CHROME; the card is the real one.
 *
 * `/login` keeps working exactly as before and renders the same screen without
 * this chrome. That is deliberate belt-and-braces: `publicPaths.ts` warns that
 * getting the login route wrong is "a lock-out with no way back in", so the
 * route that has always worked stays working while the front door moves.
 *
 * The card is made translucent WITHOUT editing the accounts module — that is
 * another build's surface — by re-declaring `--axf-panel` for the subtree. It
 * takes two elements: one to capture the theme's value into `--lk-panel`, one
 * to redefine `--axf-panel` from it. Doing both on a single element is a custom
 * property cycle and computes to nothing.
 *
 * All colour comes from the theme tokens (`GX.*`, which are `var(--axf-*)`
 * references), so the page recolours with the active theme. The card is
 * translucent with a blur so the animated mark glows through it rather than
 * being hidden behind an opaque panel.
 *
 * ## PORT NOTES (GizmoX → AmberX, 2026-08-15)
 *
 *  - **Alpha colours go through `gxa()`.** GizmoX's `GX` tokens were literal
 *    hex, so it wrote `` `${GX.panel}CC` ``. AmberX's are `var(--axf-panel)`
 *    and that concatenation produces `var(--axf-panel)CC`, which is not a
 *    colour — the card and banner would have rendered with no background at
 *    all. `gxa(token, "CC")` is the house replacement (see `kit/gx.ts`).
 *  - **The lock icon is dropped, not substituted.** GizmoX drew it from
 *    `@/components/brand/mui`; `@mui/icons-material` is permanently excluded in
 *    AmberX and icons resolve through the branding pack, whose contract has only
 *    `mark` / `lockup` / `wordmark` / `spinner` / `watermark`. Adding a lock
 *    glyph is a branding-pack change, not a landing-page change, so the caption
 *    keeps its words and loses its icon until that glyph exists.
 *  - **This page IS the `xl001` asset.** Nothing visual is hardcoded that the
 *    asset declares: the background logo is whatever `xl001.assets.logo` names
 *    (today `lk002-orbit`, chosen in the designer) and the card's translucency is its `cardOpacity`.
 */

import * as React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import LoginCard from "../../src/modules/accounts/LoginCard";
import LoginScreen from "../../src/modules/accounts/LoginScreen";
import { LogoKitLogo } from "../../src/logo-kits/LogoKitLogo";
import { resolveLogo } from "../../src/logo-kits/catalog";
import { xLandingForRoute } from "../../src/x-landing/catalog";
import { loadOverrides, resolveLanding, type LandingOverridesDoc } from "../../src/x-landing/overrides";
import { GizmoXLockup } from "../../src/modules/amberxvid/gizmox-kit";
import { GX, gxa } from "../../src/modules/amberxvid/kit/gx";

/** 0.35 → "59": a 0-1 opacity as the two-hex-digit alpha byte `gxa` takes. */
const alphaHex = (o: number): string =>
  Math.round(Math.min(1, Math.max(0, o)) * 255)
    .toString(16)
    .padStart(2, "0");

// This page IS the `xl001` x_landing asset. Everything visual it composes from
// other assets is named there by id and resolved here — the background logo is
// not hardcoded, it is whatever the asset points at (currently lk001-orbit).
const ASSET = xLandingForRoute("/login-landing");

export default function LoginLandingScreen({ preview = false }: { preview?: boolean }) {
  /*
   * The theme designer's Surfaces tab can override the composed logo and the
   * card's translucency WITHOUT touching the framework-authored asset (see
   * `x-landing/overrides.ts` for why that split exists). This page has to read
   * the override or the editor would be a lie: a control that writes a stored
   * document and changes nothing a visitor can see.
   *
   * The asset paints first — it is the server render — and an override swaps in
   * after. That ordering is deliberate: the asset is the value that is always
   * correct, the customisation is the one that may not exist.
   */
  const [overrides, setOverrides] = React.useState<LandingOverridesDoc | null>(null);
  React.useEffect(() => {
    let alive = true;
    void loadOverrides().then((d) => alive && setOverrides(d));
    return () => {
      alive = false;
    };
  }, []);

  const landing = ASSET ? resolveLanding(ASSET, overrides) : null;
  const bgLogo = landing ? resolveLogo(landing.assets.logo) : null;
  const cardAlpha = alphaHex(landing?.cardOpacity ?? 0.35);

  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        bgcolor: GX.page
      }}
    >
      {/* ---- animated logo, drifting in the background -------------------- */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          top: "52%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          opacity: 0.16,
          pointerEvents: "none",
          zIndex: 0
        }}
      >
        {bgLogo && <LogoKitLogo logo={bgLogo} size={760} />}
      </Box>
      {/* a soft accent glow pooled behind the card, so the centre reads warm */}
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
          background: `radial-gradient(60% 55% at 50% 55%, ${gxa(GX.accent, "1A")} 0%, transparent 70%)`
        }}
      />

      {/* ---- banner ------------------------------------------------------- */}
      <Box
        component="header"
        sx={{
          position: "relative",
          zIndex: 2,
          flexShrink: 0,
          height: 66,
          px: { xs: 2, sm: 4 },
          display: "flex",
          alignItems: "center",
          gap: 2,
          borderBottom: `1px solid ${GX.edge}`,
          bgcolor: gxa(GX.panel, "CC"),
          backdropFilter: "blur(8px)"
        }}
      >
        <GizmoXLockup mark={30} />
        <Box sx={{ flex: 1 }} />
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.8, color: GX.dim }}>
          <Typography
            sx={{ fontFamily: GX.mono, fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase" }}
          >
            Secure sign-in
          </Typography>
        </Box>
      </Box>

      {/* ---- the REAL sign-in card, in the landing's clothes -------------- */}
      {/* Outer: captures the theme's panel colour into a variable of our own,
          so the inner element can redefine --axf-panel from it without the
          custom-property cycle a single element would create. */}
      <Box
        sx={{
          position: "relative",
          zIndex: 1,
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          p: 2,
          "--lk-panel": GX.panel
        }}
      >
        {/* Inner: the accounts card inherits these, so it comes out translucent
            and glowing at exactly the opacity the xl001 asset declares — with no
            edit to the accounts module, which another build owns. */}
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            "--axf-panel": gxa("var(--lk-panel)", cardAlpha),
            "& [data-axf-area='accounts.surface'] > *": {
              backdropFilter: "blur(10px)",
              boxShadow: `0 24px 60px -24px ${gxa(GX.accent, "40")}`,
              borderRadius: 3
            }
          }}
        >
          {/*
           * `preview` renders the DESIGN state: the signed-out card, with none
           * of `LoginScreen`'s navigation. See `./page.tsx` for why it exists —
           * to a signed-in viewer the real screen redirects to their role
           * landing, so the designer's preview showed the admin dashboard
           * instead of the screen being designed.
           *
           * It renders `LoginCard` directly rather than `LoginScreen` because
           * the split is already exactly this: the card is the surface, the
           * screen is the card plus where-to-go-next. Preview wants the first
           * and must not run the second.
           *
           * Inert on purpose. A preview is for looking at, and leaving it live
           * would put a working sign-in form inside a designer pane — where a
           * stray click would fire a real auth attempt, or navigate the pane.
           */}
          {preview ? (
            <Box
              aria-hidden
              sx={{ flex: 1, minHeight: 0, display: "flex", pointerEvents: "none", userSelect: "none" }}
            >
              <LoginCard me={null} />
            </Box>
          ) : (
            <LoginScreen />
          )}
        </Box>

        <Typography
          sx={{ fontFamily: GX.mono, fontSize: 10, color: GX.dim, textAlign: "center", pb: 1, flexShrink: 0 }}
        >
          amberxai.com · AmberX AI Studio
        </Typography>
      </Box>
    </Box>
  );
}
