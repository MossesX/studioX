"use client";

/**
 * @file **THE LIVE PREVIEW** — every kind drawn by the renderer that actually
 * draws it in the app, and nothing else drawn at all.
 *
 * P1's contract states the rule this file implements, and it is worth repeating
 * where the code is rather than only where the types are: *"The browser never
 * re-implements a renderer and never falls back to a screenshot: a preview that
 * is a picture of a logo cannot show that the logo animates, and a preview that
 * re-draws a toolbar is a second toolbar implementation that will disagree with
 * the first."*
 *
 * So each case below is a delegation, and the delegations are the whole file:
 *
 * | preview | drawn by | imported from |
 * |---|---|---|
 * | `logo-kit`   | `LogoKitLogo`, one per logo, motions running | `src/logo-kits/` |
 * | `landing`    | `LogoKitLogo` over `resolveLanding()`'s composed hero | `src/x-landing/` |
 * | `glyph-grid` | core's `Glyph`, plus core's own `checkCoverage()` report | `@axf/core` |
 * | `toolbar`    | core's `Toolbar`, by id, `arrangeable={false}` | `@axf/core` |
 * | `nav-menu`   | core's `NavMenuSurface`, by id | `@axf/core` |
 * | `dashboard`  | — nothing. An honest metadata card; see below | |
 *
 * ## The two props those renderers needed, and why they were already there
 *
 * `Toolbar` has carried `asset` (draw THIS bar by id) and `arrangeable={false}`
 * ("for a bar that is not chrome at all — a preview of a candidate asset inside
 * an editor") since it was written. This file is their first consumer, which is
 * the cheapest possible outcome: the preview is the real bar because there was
 * a supported way to ask for it.
 *
 * The nav menu had no twin — the component was internal and always drew the
 * surface's ACTIVE menu. Core 0.0.25 exports `NavMenuSurface` with the same
 * `asset` prop rather than this file drawing rows out of `items[]`, because a
 * hand-drawn menu here would be a second implementation of five layout dials
 * (`navPlacement` / `navStyle` / `navIndicator` / `navGlyph` / `navMotion`) and
 * would start disagreeing with the real one on the day a sixth was added.
 *
 * ## Where the honest metadata card is the right answer
 *
 * Two kinds get one, and neither is "we ran out of time":
 *
 *   - **`dashboard`** — its renderer is `render({ children, pathname })`, chrome
 *     drawn AROUND a hosted screen, and the one wrapper in the tree
 *     (`amberx-console`) mounts a live `<Toolbar surface="console.bar">` inside
 *     it. Mounting that in a card would put a second bar on the app's own
 *     console surface — a side effect, not a preview. The kind is read-only
 *     here anyway (P0: "arrangement rather than a graphical asset").
 *   - **a pack with no inline drawings** — a `logo-package` exported from
 *     GizmoX carries `payload.files`, paths into a filesystem AmberX does not
 *     have. There is nothing to draw, and drawing a grey square labelled
 *     "preview" would be a placeholder pretending to be an asset.
 *
 * A metadata card SAYS which of those it is. That is the difference between an
 * honest empty state and a fake tile.
 *
 * ## Every live render sits in a `Boundary`
 *
 * A preview mounts foreign code — a bar an editor saved, a drawing a pack
 * shipped — and the grid draws twenty of them at once. `Boundary` at the
 * `contribution` tier turns a throwing preview into a chip in its own frame
 * instead of an empty browser, which is the framework's own answer to exactly
 * this and is what `Slot` and `ModuleHost` already do.
 */

import * as React from "react";

import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Boundary, Glyph, NavMenuSurface, Toolbar, checkCoverage, token } from "@axf/core";
import type { ToolbarSurface } from "@axf/core";

import { logoKit, resolveLogo } from "../../logo-kits/catalog";
import { LogoKitLogo } from "../../logo-kits/LogoKitLogo";
import type { LogoSpec } from "../../logo-kits/types";
import { xLanding } from "../../x-landing/catalog";
import { loadOverrides, resolveLanding } from "../../x-landing/overrides";
import type { LandingOverridesDoc } from "../../x-landing/overrides";

import type { CatalogEntry } from "./catalog";

/** How much room the preview has. The two call sites, named. */
export type PreviewSize = "card" | "detail";

/** Frame heights. A card's is deliberately short — the facts below it are what
 *  a person scans; the drawing is what tells them which asset they are looking
 *  at. The detail pane's is where a drawing is actually studied. */
const FRAME_H: Record<PreviewSize, number> = { card: 96, detail: 168 };

/* ========================================================== shared chrome */

/**
 * The bordered field every preview is drawn on.
 *
 * `overflow: hidden` is doing real work: a bar declares its own height and a
 * menu its own `--axf-nav-w`, both from the live theme, and neither has any
 * idea it is being previewed. Clipping is the honest containment — SCALING the
 * render down would change what the reader is looking at, and a bar shrunk to
 * 60% is not the bar.
 */
function Frame({
  size,
  label,
  children
}: {
  size: PreviewSize;
  /** Corner caption. Says WHAT is being drawn, so a clipped render is legible. */
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      data-axf-preview
      sx={{
        position: "relative",
        height: FRAME_H[size],
        mb: 1,
        borderRadius: 1,
        border: `1px solid ${token("edge")}`,
        bgcolor: token("page"),
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}
    >
      {children}
      {label ? (
        <Typography
          sx={{
            position: "absolute",
            left: 5,
            bottom: 4,
            px: 0.6,
            borderRadius: 0.5,
            bgcolor: token("panel"),
            border: `1px solid ${token("edge")}`,
            fontFamily: "var(--axf-mono, monospace)",
            fontSize: 9.5,
            lineHeight: 1.6,
            color: token("dim"),
            pointerEvents: "none",
            maxWidth: "90%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {label}
        </Typography>
      ) : null}
    </Box>
  );
}

/**
 * What renders when there is genuinely nothing to draw — a statement of WHY,
 * never a placeholder tile.
 *
 * The distinction the step draws is the one this component exists to keep: a
 * grey rectangle labelled "preview" claims a drawing is coming; this claims
 * nothing and explains itself.
 */
function MetadataCard({ size, reason }: { size: PreviewSize; reason: string }) {
  return (
    <Box
      data-axf-preview="metadata"
      sx={{
        height: FRAME_H[size],
        mb: 1,
        px: 1.25,
        borderRadius: 1,
        border: `1px dashed ${token("edge")}`,
        bgcolor: "transparent",
        display: "flex",
        alignItems: "center"
      }}
    >
      <Typography sx={{ fontSize: 10.5, color: token("dim"), lineHeight: 1.5 }}>{reason}</Typography>
    </Box>
  );
}

/* =============================================================== logo kit */

/**
 * Every logo in the kit, each through the real `LogoKitLogo` with its motion
 * running. This is the whole reason `/login-landing/gallery` existed and it is
 * why that surface is retired in this step: two screens drawing the same kits
 * is two screens that can disagree about what a kit holds.
 */
function LogoKitPreview({ kitId, size }: { kitId: string; size: PreviewSize }) {
  const kit = logoKit(kitId);
  if (!kit) {
    return (
      <MetadataCard
        size={size}
        reason={`No source spec for “${kitId}” is in the catalog, so there is nothing to draw. The registry row is on disk; the kit is not in SOURCE_KITS.`}
      />
    );
  }

  // A card shows a handful at a glance; the detail pane shows the kit. Both
  // draw REAL logos — the card's remainder is stated as a count, never as
  // faded extra tiles that would imply drawings nobody rendered.
  const shown: LogoSpec[] = size === "card" ? kit.logos.slice(0, 5) : kit.logos;
  const rest = kit.logos.length - shown.length;
  const logoSize = size === "card" ? 38 : 62;

  return (
    <Frame size={size} label={`${kit.logos.length} logo(s) · LogoKitLogo`}>
      <Box
        sx={{
          height: "100%",
          width: "100%",
          overflowY: size === "detail" ? "auto" : "hidden",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "center",
          alignContent: "center",
          gap: size === "card" ? 1 : 1.5,
          p: 1,
          pb: 2.25
        }}
      >
        {shown.map((logo) => (
          <Tooltip key={logo.id} title={`${logo.name} · ${logo.motion} · ${logo.kind}`} enterDelay={400}>
            <Box sx={{ display: "flex", flexShrink: 0 }} data-axf-preview-logo={logo.id}>
              <LogoKitLogo logo={logo} size={logoSize} />
            </Box>
          </Tooltip>
        ))}
        {rest > 0 && (
          <Typography sx={{ fontSize: 10.5, color: token("dim"), alignSelf: "center" }}>
            +{rest} more
          </Typography>
        )}
      </Box>
    </Frame>
  );
}

/* ================================================================ landing */

/**
 * The override document, read ONCE for the whole screen.
 *
 * `loadOverrides()` is a kv fetch and every landing card wants the same answer,
 * so the promise is cached at module scope. `/login-landing` reads it the same
 * way and for the same reason the page states: the asset paints first because
 * it is always correct, and the customisation swaps in after because it may not
 * exist.
 */
let overridesPromise: Promise<LandingOverridesDoc> | null = null;

function useLandingOverrides(): LandingOverridesDoc | null {
  const [doc, setDoc] = React.useState<LandingOverridesDoc | null>(null);
  React.useEffect(() => {
    let alive = true;
    overridesPromise ??= loadOverrides();
    void overridesPromise.then((d) => {
      if (alive) setDoc(d);
    });
    return () => {
      alive = false;
    };
  }, []);
  return doc;
}

/**
 * A landing's composed HERO — the logo it names, resolved through
 * `resolveLanding` so an override is what shows, drawn by `LogoKitLogo`.
 *
 * Not the whole page: `LoginLandingScreen` is `position: fixed; inset: 0;
 * zIndex: 2000` by design ("it owns the whole window and the app chrome never
 * shows through"), so mounting it here would cover the browser rather than
 * appear in it. The route's own `?preview=1` is the full-page preview and the
 * detail pane links to it — one surface for the page, one for the hero, and
 * neither redrawing the other.
 */
function LandingPreview({ landingId, size }: { landingId: string; size: PreviewSize }) {
  const overrides = useLandingOverrides();
  const asset = xLanding(landingId);
  if (!asset) {
    return <MetadataCard size={size} reason={`No landing “${landingId}” is in the catalog.`} />;
  }

  const landing = resolveLanding(asset, overrides);
  const logo = resolveLogo(landing.assets.logo);

  if (!logo) {
    return (
      <MetadataCard
        size={size}
        reason={`This landing composes the logo “${landing.assets.logo}”, and nothing in any registered kit resolves it. That is a dangling reference, not a missing preview.`}
      />
    );
  }

  return (
    <Frame size={size} label={`hero · ${landing.assets.logo}`}>
      <LogoKitLogo logo={logo} size={size === "card" ? 66 : 120} />
      {size === "detail" && (
        <Typography
          sx={{ position: "absolute", right: 6, bottom: 4, fontSize: 10, color: token("dim") }}
        >
          <Link href={`${landing.route}?preview=1`} underline="hover" target="_blank" rel="noreferrer">
            open {landing.route} →
          </Link>
        </Typography>
      )}
    </Frame>
  );
}

/* ============================================================= glyph grid */

interface PackEntry {
  readonly id: string;
  readonly label?: string;
  readonly svg?: string;
  readonly file?: string;
}

/** `payload.entries`, defensively — `AssetCard.raw` is `unknown` by contract. */
function packEntries(raw: unknown): PackEntry[] {
  const payload = (raw as { payload?: { entries?: unknown } } | null)?.payload;
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  return entries.filter(
    (e): e is PackEntry => typeof e === "object" && e !== null && typeof (e as PackEntry).id === "string"
  );
}

/**
 * A pack's variants, drawn through core's `Glyph` — the same component every
 * surface in the app resolves an icon with, which is what makes the preview
 * recolour with the theme exactly as the real thing does.
 *
 * The completeness line comes from core's own `checkCoverage()`. P0 is explicit
 * that that report *"IS the browser's per-pack completeness card, already
 * computed — do not write a second one"*, including its most useful property:
 * a required drawing that cannot be MEASURED counts as a fault rather than a
 * pass, so an all-`file:` pack cannot report itself complete without one
 * drawing having been checked.
 */
function PackPreview({ entry, size }: { entry: CatalogEntry; size: PreviewSize }) {
  const entries = packEntries(entry.card.raw);

  if (entries.length === 0) {
    const files = (entry.card.raw as { payload?: { files?: unknown[] } } | null)?.payload?.files;
    return (
      <MetadataCard
        size={size}
        reason={
          Array.isArray(files) && files.length > 0
            ? `This pack ships ${files.length} FILE path(s) and no inline drawings. AmberX packs carry their SVG inline so they need no filesystem; a file-based pack (GizmoX's shape) loads, but there is nothing here to draw.`
            : "This pack declares no drawings, so there is nothing to draw. That is the pack's own content, not a missing preview."
        }
      />
    );
  }

  const shown = size === "card" ? entries.slice(0, 14) : entries;
  const rest = entries.length - shown.length;
  const coverage = checkCoverage(entry.card.id, entries);
  const glyphSize = size === "card" ? 17 : 22;

  return (
    <Frame
      size={size}
      label={
        coverage.complete
          ? `${entries.length} drawing(s) · contract complete`
          : `${entries.length} drawing(s) · ${coverage.missingRequired.length} required missing, ${coverage.uncheckable.length} unmeasurable`
      }
    >
      <Box
        sx={{
          height: "100%",
          width: "100%",
          overflowY: size === "detail" ? "auto" : "hidden",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          alignContent: "center",
          justifyContent: "center",
          gap: size === "card" ? 0.9 : 1.2,
          p: 1,
          pb: 2.25,
          color: token("ink")
        }}
      >
        {shown.map((e) => (
          <Tooltip key={e.id} title={`${e.label ?? e.id} · ${e.id}`} enterDelay={400}>
            <Box sx={{ display: "flex", flexShrink: 0 }} data-axf-preview-glyph={e.id}>
              <Glyph id={e.id} size={glyphSize} />
            </Box>
          </Tooltip>
        ))}
        {rest > 0 && (
          <Typography sx={{ fontSize: 10.5, color: token("dim"), alignSelf: "center" }}>
            +{rest} more
          </Typography>
        )}
      </Box>
    </Frame>
  );
}

/* ================================================================= chrome */

/** The bar itself. `arrangeable={false}` is the prop core wrote for this case. */
function ToolbarPreview({ entry, size }: { entry: CatalogEntry; size: PreviewSize }) {
  const surface = (entry.card.raw as { surface?: string } | null)?.surface;
  return (
    <Frame size={size} label={`core Toolbar · ${surface ?? "no surface"}`}>
      <Box sx={{ width: "100%", alignSelf: "flex-start", pointerEvents: "none" }}>
        {/*
         * `pointerEvents: "none"` rather than trusting the buttons to be inert.
         * They ARE inert — `onCommand` is optional and every item calls
         * `onCommand?.(...)` — but a preview that merely happens not to fire
         * anything is one prop away from firing something, and the reader is
         * looking at a bar, not using it.
         */}
        <Toolbar
          asset={entry.card.id}
          surface={surface as ToolbarSurface | undefined}
          arrangeable={false}
        />
      </Box>
    </Frame>
  );
}

/** The menu itself, through core 0.0.25's by-id nav renderer. */
function NavMenuPreview({ entry, size }: { entry: CatalogEntry; size: PreviewSize }) {
  return (
    <Frame size={size} label="core NavMenuSurface">
      <Box
        sx={{
          height: "100%",
          width: "100%",
          display: "flex",
          alignItems: "flex-start",
          overflow: "hidden",
          pointerEvents: "none"
        }}
      >
        {/*
         * `onNavigate` is supplied and does nothing. The default is
         * `window.location.assign(route)` — a preview that navigated the app
         * away when a link was clicked would be a booby trap, and clicks are
         * off above anyway.
         */}
        <NavMenuSurface asset={entry.card.id} onNavigate={() => undefined} />
      </Box>
    </Frame>
  );
}

/* ================================================================== entry */

export interface AssetPreviewProps {
  readonly entry: CatalogEntry;
  readonly size: PreviewSize;
}

/**
 * One asset, drawn. Dispatches on `AssetCard.preview` — the contract's own
 * field — so a kind added there arrives here as a compile error rather than as
 * a blank tile.
 */
export default function AssetPreview({ entry, size }: AssetPreviewProps) {
  const body = ((): React.ReactNode => {
    switch (entry.card.preview) {
      case "logo-kit":
        return <LogoKitPreview kitId={entry.card.id} size={size} />;
      case "landing":
        return <LandingPreview landingId={entry.card.id} size={size} />;
      case "glyph-grid":
        return <PackPreview entry={entry} size={size} />;
      case "toolbar":
        return <ToolbarPreview entry={entry} size={size} />;
      case "nav-menu":
        return <NavMenuPreview entry={entry} size={size} />;
      case "dashboard":
        return (
          <MetadataCard
            size={size}
            reason="A dashboard wrapper draws chrome AROUND a hosted screen — its renderer takes the screen as children, and the one in this tree mounts a live console toolbar. Drawing it here would put a second bar on the app's own console surface, which is a side effect rather than a preview."
          />
        );
      default: {
        // Exhaustive: `PreviewKind` is a closed union, so this branch is
        // unreachable today and becomes a typecheck failure the moment a kind
        // is added to the contract without a renderer here.
        const unreachable: never = entry.card.preview;
        return (
          <MetadataCard size={size} reason={`No renderer is wired for preview kind “${String(unreachable)}”.`} />
        );
      }
    }
  })();

  return (
    <Boundary tier="contribution" source={`preview:${entry.key}`} compact>
      {body}
    </Boundary>
  );
}
