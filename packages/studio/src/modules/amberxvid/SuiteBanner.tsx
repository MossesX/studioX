"use client";

/**
 * @file The AmberX Vid banner — the whole of the chrome around the suite, for
 * every viewer (P8, 2026-08-04; re-faced for the platform in P14, 2026-08-15).
 *
 * ## What P14 changed, and why each was wrong before
 *
 *  - **The brand is the pack's `lockup` drawing**, not a hand-typed wordmark.
 *    The bar used to set "GizmoX Media Suite" in `<Typography>` with the X
 *    coloured by hand — a logo drawn in JSX, which is the exact thing
 *    `.claude/rules/no-hand-rolled-ui.md` exists to stop, and which no theme or
 *    brand pack could ever restyle. `lockup` is a required contract glyph
 *    (`REQUIRED_GLYPHS`), painted in the pack's role variables, so it recolours
 *    with the theme like every other drawing.
 *  - **The identity is an account CHIP** — the accounts avatar beside the
 *    screenname — rather than a bare line of text next to an anonymous icon
 *    button. Since P1 there is one identity system, so the bar shows the
 *    accounts face, and clicking it opens the accounts surface (the member's
 *    own profile page, with the wall and albums on it).
 *  - **The settings gear is back**, and it opens the ONE shell-owned
 *    `SettingsDialog` through `settingsUi.open()`. The 2026-08-13 note below
 *    removed GizmoX's `ShellSuiButton` on the grounds that "the shell supplies
 *    the gear" — true when the banner was drawn by `AppShell` above the module,
 *    and false since the module started rendering its own banner as its top
 *    row. The suite's chrome covers the shell's, so the affordance has to be in
 *    the chrome that is on top. It is still the shell's dialog; nothing here is
 *    a second settings surface.
 *  - **Sign-out is the accounts sign-out** and the only session control in the
 *    suite. The module's own header carried a duplicate "Close profile" button
 *    into P13; P14 deleted it — no module-local session UI survived P1, and
 *    none returns here.
 *
 * It replaces `MemberBrandBar`, which only ever covered *members*: an
 * administrator still got the workbench — the nav rail, the search palette, the
 * plugin docks, the tab strip. After the P7 split that distinction has nothing
 * left to stand on. An `axv_session` is not a GizmoX identity for anybody, so
 * drawing an administrator a rail to modules their session cannot open was a
 * lie the chrome told twice a day. Now both doors into the suite
 * (`AppShell` for `/amberxvid`, `StandaloneHost` for `/amberx_vid`) return
 * early and render THIS, and nothing else.
 *
 * What it carries, left to right:
 *   - one brand block: the chosen signet, then the product name and descriptor;
 *   - a live clock;
 *   - the suite's version (`./lib/version`);
 *   - the signed-in identity;
 *   - account · sign out, in branding-pack icons.
 *
 * ## The brand block (reworked 2026-08-04)
 *
 * This bar used to lead with a 227px-wide `lockup-amberx-vid-horizontal` — the
 * suite's own wordmark stretched larger than anything else on screen, with the
 * GizmoX mark reduced to a bullet beside it. Worse, the two glyphs were the
 * SAME drawing: `icon-amberx-vid` is the house starburst with a ring and a play
 * triangle added, so at 36px and 20px the bar read as one orange logo printed
 * twice.
 *
 * It is now a single lockup naming a single product:
 *
 *   ◈ GizmoX Media Suite
 *     FRAMEWORK · AI STUDIO SDK
 *
 * Three things that fixes, all of which had been wrong at once: there is one
 * mark, not two; the name is the product rather than whichever module the
 * viewer happens to be inside; and the band is 52px instead of 84px, because a
 * chrome bar naming one thing does not need the height of a masthead.
 *
 * PORT NOTES (GizmoX → AmberX, per the 2026-08-13 port record in PLANNING-STATE.md):
 *   - GizmoX's eight `logo-signet-*` drawings did not port — AmberX's pack has
 *     no signet family, so the pack's `mark` renders whatever `banner.signet`
 *     says. The setting and `BANNER_SIGNETS` are kept so the read API and the
 *     banner test contract survive; the choice is a no-op until the branding
 *     pack grows signet drawings.
 *   - Colours come through `brandRoleRef` from `@axf/core` (AmberX publishes
 *     the same `--gxb-*` role names), falling back to the theme tokens.
 *   - The settings gear (`ShellSuiButton`) is gone — the shell supplies the
 *     gear + dialog.
 *
 * ## Where the hooks come from
 *
 * - **Account** is the module's, published UP through `./lib/banner`:
 *   the banner renders above the module and cannot know whose profile to open
 *   or which stage view shows it. Until a shell is mounted — the splash, the
 *   suite's login flow — the icon is absent rather than dead. It opens the
 *   member's profile IN the suite, never `/account`, which is a GizmoX page for
 *   a GizmoX account this viewer does not hold since the split.
 * - **Sign out** is `signOutAmberXVid` from the viewer module — the call both
 *   chromes already made before this bar existed, kept there so the suite has
 *   one sign-out and not one per surface.
 */

import * as React from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { brandRoleRef, Glyph, settingsUi } from "@axf/core";
import AvatarView from "./Avatar";
import { GX, gxa } from "./kit/gx";
import { AMBERXVID_ASSET_ID, bool, str, useEffectiveValues } from "./settings";
import { AMBERXVID_VERSION_LABEL } from "./lib/version";
import { useAmberXVidBannerHooks } from "./lib/banner";
import { creditsWorthShowing, useAmberXVidCredits } from "./lib/creditsClient";
import { signOutAmberXVid, useAmberXVidViewer } from "./lib/viewer";

/* --------------------------------- geometry --------------------------------- */

/**
 * The three heights `banner.height` offers, and everything that scales with
 * one. Published as data rather than branched in the JSX so the settings'
 * options and the bar on screen cannot disagree, and so a banner test
 * can assert the two lists are the same list.
 */
export const BANNER_HEIGHTS = {
  compact: 44,
  standard: 52,
  tall: 64,
} as const;

export type BannerHeight = keyof typeof BANNER_HEIGHTS;

/**
 * How the brand block is set at each height. Typography is stepped rather than
 * multiplied off the height: a straight `height * k` keeps the RATIOS but not
 * the legibility — the 8px descriptor a compact bar needs is not 0.66 of the
 * 12px a tall one wants, and letter-spacing does not scale linearly at all.
 * Three considered sets, chosen per height, is what makes the compact bar look
 * deliberate instead of squashed.
 */
const BRAND_SCALE: Record<BannerHeight, {
  mark: number;
  /** The `lockup` drawing's rendered WIDTH — it is a 6.25:1 asset. */
  lockup: number;
  descriptor: number;
  descriptorTrack: number;
}> = {
  compact: { mark: 23, lockup: 132, descriptor: 7.5, descriptorTrack: 1.7 },
  standard: { mark: 27, lockup: 156, descriptor: 8.5, descriptorTrack: 2.1 },
  tall: { mark: 34, lockup: 196, descriptor: 10, descriptorTrack: 2.5 },
};

/**
 * What the product IS, under the brand. One string, so the wording is not
 * scattered through the JSX — and it says PLATFORM now (P14) rather than
 * "Framework · AI Studio SDK", which described the SDK this thing is built on
 * instead of the thing on screen.
 */
const HOUSE_DESCRIPTOR = "AmberX Vid · Social video platform";

/**
 * The eight signets GizmoX's branding package shipped (`logo-signet-*`),
 * offered as a live choice in the settings. Kept as the contract for
 * `banner.signet` even though AmberX's pack has no signet drawings yet — every
 * value currently renders the pack `mark` (see the PORT NOTE in the docblock).
 */
export const BANNER_SIGNETS = [
  "hex",
  "monogram",
  "layers",
  "orbit",
  "prism",
  "aperture",
  "brackets",
  "quad",
] as const;

const DEFAULT_SIGNET = "hex";

/** Fallback height — what a surface reserves before the settings resolve. */
export const AMBERXVID_BANNER_HEIGHT = BANNER_HEIGHTS.standard;

const isHeight = (v: string): v is BannerHeight => v in BANNER_HEIGHTS;

/* ---------------------------------- clock ----------------------------------- */

/**
 * The wall clock, ticking once a second. Deliberately empty until the first
 * effect run: reading the time during render is a hydration mismatch by
 * construction (the server's second is never the client's), and the bar simply
 * has no clock in it for one frame.
 */
function useClock(enabled: boolean, hour12: boolean, seconds: boolean): string {
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => {
    if (!enabled) {
      setNow(null);
      return;
    }
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, [enabled]);
  if (!now) return "";
  return now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : null),
    hour12,
  });
}

/* -------------------------------- the banner -------------------------------- */

export interface SuiteBannerProps {
  /**
   * Optional identity override for a host that already knows the name — the
   * viewer store answers for both doors, so this is only ever a nicety.
   */
  user?: string | null;
  /** Run after a sign-out lands, when the host has its own unwinding to do. */
  onSignedOut?: () => void;
}

export default function SuiteBanner({ user = null, onSignedOut }: SuiteBannerProps) {
  const values = useEffectiveValues(AMBERXVID_ASSET_ID);
  const viewer = useAmberXVidViewer(true);
  const hooks = useAmberXVidBannerHooks(true);
  const [signingOut, setSigningOut] = React.useState(false);

  /* P18 — the credit balance. Fetched only once somebody is signed in: the bar
   * is drawn above the login card too, and asking the meter on behalf of nobody
   * is a guaranteed 401 on every visit to the sign-in screen. */
  const credits = useAmberXVidCredits(Boolean(viewer.username));
  const showCredits = creditsWorthShowing(credits);

  // One sign-out (`signOutAmberXVid`): P1 made it a STUDIO sign-out — it drops
  // `axs_session` and
  // forgets the cached viewer, and it deliberately leaves any GizmoX session
  // alone — clicking this must not sign the operator out of their workbench in
  // another tab. The module is TOLD it happened so it can unwind its own state;
  // a host with none falls back to a refresh.
  const signOut = React.useCallback(() => {
    if (signingOut) return;
    setSigningOut(true);
    void signOutAmberXVid().finally(() => {
      setSigningOut(false);
      hooks?.onSignedOut();
      onSignedOut?.();
    });
  }, [signingOut, hooks, onSignedOut]);

  const heightKey = str(values, "banner.height", "standard");
  const height = BANNER_HEIGHTS[isHeight(heightKey) ? heightKey : "standard"];
  const surface = str(values, "banner.surface", "solid");
  const tint = str(values, "banner.tint", "");
  const logos = str(values, "banner.logos", "both");
  const identityMode = str(values, "banner.identity", "screenname");
  const showVersion = bool(values, "banner.version", true);

  const clock = useClock(
    bool(values, "banner.clock", true),
    str(values, "banner.clockFormat", "24h") === "12h",
    bool(values, "banner.clockSeconds", false),
  );

  // Brand roles first, theme tokens as the fallback — AmberX publishes the
  // same `--gxb-*` names GizmoX's pack painted with.
  const ink = brandRoleRef("ink", GX.ink);
  const dim = brandRoleRef("dim", GX.dim);
  const edge = brandRoleRef("edge", GX.edge);
  const accent = brandRoleRef("accent", GX.accent);
  const page = brandRoleRef("page", GX.page);

  // `banner.tint` is a free colour whose empty value means "inherit the theme"
  // (the framework-wide contract for the `color` setting type), so an untinted
  // banner is the brand's own page colour and follows every theme change.
  const base = tint || page;
  const background =
    surface === "translucent"
      ? `color-mix(in srgb, ${base} 74%, transparent)`
      : surface === "wash"
        ? `linear-gradient(100deg, ${base} 55%, color-mix(in srgb, ${accent} 26%, ${base}) 100%)`
        : base;

  const who =
    identityMode === "hidden"
      ? null
      : identityMode === "username"
        ? viewer.username ?? user
        : identityMode === "both"
          ? [viewer.screenname, viewer.username ?? user].filter(Boolean).join(" · ") || null
          : viewer.screenname ?? viewer.username ?? user;

  const scale = BRAND_SCALE[isHeight(heightKey) ? heightKey : "standard"];
  /*
   * `banner.logos` now picks between two DRAWINGS rather than between a drawing
   * and hand-set type:
   *
   *   mark    → the square identity alone (narrow windows)
   *   lockup  → the horizontal lockup alone
   *   both    → the lockup, because the lockup IS the mark plus the name
   *
   * "both" collapsing onto the lockup is deliberate and is the bug this file's
   * own 2026-08-04 note describes: drawing `mark` beside `lockup` puts the same
   * artwork on the bar twice, at two sizes, which is what "one orange logo
   * printed twice" meant the first time. There is no third arrangement to
   * offer, so the value maps to the one that is right.
   */
  const showMark = logos === "mark";
  const showType = logos !== "mark";

  const signetKey = str(values, "banner.signet", DEFAULT_SIGNET);
  const signet = (BANNER_SIGNETS as readonly string[]).includes(signetKey) ? signetKey : DEFAULT_SIGNET;
  // PORT NOTE: no signet drawings in the AmberX pack (yet) — every signet
  // choice renders the house mark. `signet` stays validated so the drawing
  // swap is one line when the family lands.
  void signet;

  return (
    <Box
      data-el-id="amberxvid:banner"
      data-zone="amberxvid.banner"
      sx={{
        flexShrink: 0,
        height,
        display: "flex",
        alignItems: "center",
        gap: 1.25,
        px: 2,
        background,
        borderBottom: `1px solid ${edge}`,
        // A hairline of the accent under the band, so it reads as chrome rather
        // than as an empty region of the page.
        boxShadow: `inset 0 -1px 0 color-mix(in srgb, ${accent} 30%, transparent)`,
        color: ink,
      }}
    >
      {/* ── one brand block: the pack's own drawings, then what this is ────
          `banner.logos` picks which half of the lockup is drawn — "mark" is the
          square identity alone (narrow windows), "lockup" is the horizontal
          asset alone, "both" is the mark beside it. Both ids are REQUIRED
          contract glyphs, so neither can be missing from a valid pack. */}
      {showMark && (
        <Box
          data-el-id="amberxvid:banner:mark"
          sx={{ display: "inline-flex", flexShrink: 0 }}
          title={HOUSE_DESCRIPTOR}
        >
          <Glyph id="mark" size={scale.mark} title={HOUSE_DESCRIPTOR} />
        </Box>
      )}

      {showType && (
        <Box
          data-el-id="amberxvid:banner:logo"
          sx={{ display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0 }}
        >
          <Box sx={{ display: "inline-flex", flexShrink: 0 }} data-el-id="amberxvid:banner:lockup">
            <Glyph id="lockup" size={scale.lockup} title={HOUSE_DESCRIPTOR} />
          </Box>
          <Typography
            noWrap
            data-el-id="amberxvid:banner:house-descriptor"
            sx={{
              fontFamily: GX.mono,
              fontSize: scale.descriptor,
              fontWeight: 600,
              lineHeight: 1.3,
              letterSpacing: scale.descriptorTrack,
              textTransform: "uppercase",
              color: dim,
            }}
          >
            {HOUSE_DESCRIPTOR}
          </Typography>
        </Box>
      )}

      <Box sx={{ flex: 1, minWidth: 0 }} />

      {clock && (
        <Typography
          data-el-id="amberxvid:banner:clock"
          sx={{
            fontFamily: GX.mono,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 0.6,
            fontVariantNumeric: "tabular-nums",
            color: ink,
            flexShrink: 0,
          }}
        >
          {clock}
        </Typography>
      )}

      {showVersion && (
        <Typography
          data-el-id="amberxvid:banner:version"
          sx={{
            fontFamily: GX.mono,
            fontSize: 10.5,
            letterSpacing: 0.8,
            color: dim,
            border: `1px solid ${edge}`,
            borderRadius: 999,
            px: 0.9,
            py: 0.15,
            flexShrink: 0,
          }}
        >
          {AMBERXVID_VERSION_LABEL}
        </Typography>
      )}

      {/* ── the credit chip ────────────────────────────────────────────────
          Present only when there is something true to say: metering is on, or
          the member holds a balance an administrator granted ahead of it. A
          chip reading "0 credits" beside a system that charges nothing is
          chrome for a feature that is not running, and it is exactly how a
          member ends up asking why their credits do not work.

          It reads and does not act. There is no buy button in the CHROME:
          spending money is not a thing to put one click from every screen in
          the suite, and the honest state today is that no processor is
          configured at all (`lib/credits.ts`). The number, its tooltip and the
          settings stage are the whole affordance. */}
      {showCredits && credits.statement && (
        <Tooltip
          title={
            credits.status?.enabled
              ? `${credits.statement.balance} AI credit${credits.statement.balance === 1 ? "" : "s"} — spent by metered features`
              : `${credits.statement.balance} AI credit${credits.statement.balance === 1 ? "" : "s"} — metering is off in this studio, so nothing is charging them yet`
          }
          disableInteractive
          placement="bottom-end"
        >
          <Box
            data-el-id="amberxvid:banner:credits"
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.6,
              flexShrink: 0,
              px: 0.9,
              py: 0.2,
              borderRadius: 999,
              border: `1px solid ${gxa(accent, "40")}`,
              // A balance of zero under live metering is the state that stops
              // the member's next turn, so it is coloured as a warning rather
              // than left to read like any other number.
              color:
                credits.status?.enabled && credits.statement.balance <= 0
                  ? brandRoleRef("warn", GX.warn)
                  : ink,
              opacity: credits.status?.enabled ? 1 : 0.65,
            }}
          >
            <Glyph id="icon-bolt" size={12} />
            <Typography
              sx={{
                fontFamily: GX.mono,
                fontSize: 11.5,
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
                color: "inherit",
              }}
            >
              {credits.statement.balance}
            </Typography>
          </Box>
        </Tooltip>
      )}

      {/* ── the account chip: the accounts face and the accounts name ───────
          One control, not an avatar plus a label plus a button. It opens the
          ACCOUNTS SURFACE — the member's own profile page inside the suite,
          which since P1 is the accounts profile with the wall on it, not a
          module-local identity screen. The chip is a button only while the
          module has published somewhere for it to go: before the shell mounts
          (splash, login, an accounts-service error) it draws the identity and
          does nothing, which is honest rather than dead. */}
      {who && (
        <Tooltip
          title={hooks ? "My profile" : "Signed in"}
          disableInteractive
          placement="bottom-end"
        >
          <Box
            component={hooks ? "button" : "div"}
            onClick={hooks ? hooks.onAccount : undefined}
            aria-label={hooks ? `My profile — ${who}` : undefined}
            data-el-id="amberxvid:banner:account"
            sx={{
              all: "unset",
              cursor: hooks ? "pointer" : "default",
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              flexShrink: 0,
              maxWidth: 240,
              pl: 0.4,
              pr: 1,
              py: 0.3,
              borderRadius: 999,
              border: `1px solid ${gxa(accent, "40")}`,
              bgcolor: gxa(accent, "14"),
              color: ink,
              ...(hooks ? { "&:hover": { borderColor: accent, bgcolor: gxa(accent, "26") } } : null),
            }}
          >
            <AvatarView
              spec={viewer.avatar}
              name={viewer.screenname ?? viewer.username ?? String(who)}
              size={height >= BANNER_HEIGHTS.tall ? 26 : 22}
            />
            <Typography
              noWrap
              data-el-id="amberxvid:banner:identity"
              sx={{ fontSize: 12.5, fontWeight: 600, color: "inherit", minWidth: 0 }}
            >
              {who}
            </Typography>
          </Box>
        </Tooltip>
      )}

      {/* The settings gear — the ONE shell-owned `SettingsDialog`, opened for
          this module. It is here rather than left to `ModuleHost`'s gear
          because the suite's banner is drawn OVER the shell's chrome (see the
          docblock); this is the same dialog, reached from the bar that is
          actually on top. */}
      <Tooltip title="AmberX Vid settings" disableInteractive placement="bottom-end">
        <IconButton
          size="small"
          onClick={() => settingsUi.open(AMBERXVID_ASSET_ID)}
          aria-label="AmberX Vid settings"
          data-el-id="amberxvid:banner:settings"
          sx={{ color: "inherit", "&:hover": { color: accent } }}
        >
          <Glyph id="icon-gear" size={18} />
        </IconButton>
      </Tooltip>

      {/* Shown to whoever the accounts service says is signed in — the module
          does not have to be mounted for this to be the honest answer, and a
          viewer who is NOT signed in is looking at the login card, which is the
          way out already. This is the accounts sign-out and the ONLY session
          control in the suite (P14 deleted the module header's duplicate); it
          ends the studio session, which is why it says so. */}
      {viewer.suiteOnly && (
        <Tooltip
          title="Sign out — ends your AmberX session everywhere"
          disableInteractive
          placement="bottom-end"
        >
          {/* Tooltip needs a wrapper it can hang listeners on, because a
              DISABLED IconButton fires no mouse events. Box rather than a bare
              <span> so the wrapper is the theme's too. */}
          <Box component="span" sx={{ display: "inline-flex" }}>
            <IconButton
              size="small"
              onClick={signOut}
              disabled={signingOut}
              aria-label="Sign out"
              data-el-id="amberxvid:banner:sign-out"
              sx={{ color: "inherit", "&:hover": { color: brandRoleRef("err", GX.err) } }}
            >
              {/* icon-power → icon-bolt, per the kit/icons mapping precedent */}
              <Glyph id="icon-bolt" size={18} />
            </IconButton>
          </Box>
        </Tooltip>
      )}
    </Box>
  );
}
