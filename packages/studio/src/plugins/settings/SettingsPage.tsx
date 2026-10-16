/**
 * @file `/settings` — the app's settings: the identity packs, and the bar that
 * draws the app banner.
 *
 * Owner directive, 2026-08-12, verbatim spirit: *"branding is just that — its
 * not negotiable, its global and does not change. it's a setting, not
 * something rollable."* So the pack picker lives HERE, in app settings, and
 * nowhere near the theme designer: a theme cannot name a pack, a roll cannot
 * change one, and a saved look neither records nor restores one.
 *
 * Selection goes through `PackRegistry.activate()` — the user tier, persisted
 * to localStorage the moment it is made and mirrored into the `axf_packs`
 * cookie, which is what lets the SERVER render the chosen identity on the next
 * load (no glyph swap after hydration). Hot render, save instantly, no confirm
 * step: the theme store's own rules, applied to the identity.
 *
 * ── VIEWING, AND THE RIGHT-CLICK (2026-08-13) ────────────────────────────────
 *
 * Owner: *"settings let me view logo and branding packs and apply banner by
 * right clicking and selecting apply to app"*. Three things followed:
 *
 *   1. **A pack card opens.** The sample strip was nine drawings out of a
 *      hundred and change — enough to recognise a pack, nowhere near enough to
 *      judge one. Every card now expands to the pack's whole sheet, grouped by
 *      category, at sizes a mark can actually be read at. That is the same
 *      argument `/brand` was built on; the difference is that this is the
 *      screen where the choice is made, and a choice made from a thumbnail is
 *      a choice made blind.
 *   2. **The banner is a setting here too.** Which bar draws the banner is the
 *      theme's `bannerBar` dial, and the designer's Toolbar tab is where bars
 *      are BUILT — but picking one is the same kind of act as picking a pack,
 *      and it belongs beside it. `/settings` never previews, so `setValue`
 *      paints and persists in one call: no Apply button, same bargain as the
 *      packs above.
 *   3. **Right-click applies.** `settings.decl.ts` declares three areas and
 *      `settings.commands.ts` the behaviour behind their rows, so *Apply to
 *      app* is a menu row in the same vocabulary as every other right-click in
 *      the app. Left-click still applies as well — a menu is added to a
 *      surface, it does not take an existing control away.
 *
 * ── A PICKER CANNOT DRAW THROUGH THE ACTIVE PACK (2026-08-15) ────────────────
 *
 * Owner: *"none of the logos or banners render in settings"* — every card for a
 * pack that was NOT in force came out as a wall of red dashed placeholders,
 * with a handful of icons rendering where the two packs happened to share an id.
 *
 * The cause was one call, repeated: the cards drew with `<Glyph id>`, and
 * `<Glyph>` resolves through `useResolvedStyle().glyphs` — the ACTIVE branding
 * and logo packs, and nothing else. A candidate's drawings are by definition
 * absent from that map, so the screen whose entire job is "see it before you
 * choose it" showed the one thing you already had. `<PackGlyph entry>` renders
 * the entry the card is holding, which is the only source a picker can use.
 *
 * Colour followed the same logic. Drawings paint in `--gxb-*` / `--axf-brand-*`,
 * which resolve where they are mounted, so every candidate previewed in the
 * palette already in force and cards that differ only by palette looked
 * identical. Each card now scopes its own pack's `paletteVariables()` — see
 * `paletteScope`, and note it publishes brand roles only, never a theme dial.
 *
 * Otherwise still deliberately MINIMAL, per the standing sui rule (a setting
 * earns its place only when the surface cannot work without it). Candidates
 * named and refused:
 *
 *   - a "reset to default" row — clicking the default pack IS that;
 *   - per-slot clear buttons — an app with no branding pack renders dashed
 *     placeholders everywhere, which is a broken state, not a preference. (The
 *     right-click's *Follow the app default* is not that button: it hands the
 *     slot back to what the app ships with, which is never nothing.)
 *   - anything themed — every theme knob is the designer's, at
 *     /theme-designer, where the dials live.
 */
"use client";

import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ButtonBase from "@mui/material/ButtonBase";

import {
  Glyph,
  PackGlyph,
  packs,
  paletteVariables,
  registry,
  settingsUi,
  theme as themeStore,
  useAppliedThemeValues,
  useResolvedStyle,
  useToolbars
} from "@axf/core";
import type {
  AnyPackage,
  BrandingPackage,
  GlyphEntry,
  LogoPackage,
  ToolbarAsset,
  ToolbarItem
} from "@axf/core";

import { resetAppearance, type ResetReport } from "../../appearance-reset";
import type { StudioSettingsSectionPayload } from "../../studio.points";

const MONO = { fontFamily: "var(--axf-mono)", fontSize: 11 } as const;

/** Drawings that are the identity itself, rather than its icon set. */
const LOGO_CATEGORIES = ["logo", "mark", "lockup", "wordmark"];

/** The one hint line that says how the menu is reached, said the same way on
 *  every section — a right-click nobody is told about is a feature nobody has. */
function MenuHint({ what }: { what: string }) {
  return (
    <Typography variant="caption" color="text.secondary">
      Click a {what} to apply it, or right-click for <strong>Apply to app</strong> and the rest of
      its menu.
    </Typography>
  );
}

/** A few of the pack's own drawings, as the honest preview. */
function SampleStrip({ entries }: { entries: readonly GlyphEntry[] }) {
  const samples = React.useMemo(() => {
    const logos = entries.filter((e) => LOGO_CATEGORIES.includes(e.category));
    const icons = entries.filter((e) => e.category === "icon");
    return [...logos.slice(0, 3), ...icons.slice(0, 6)];
  }, [entries]);
  if (samples.length === 0) return null;
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", flexWrap: "wrap" }}>
      {samples.map((entry) => (
        <PackGlyph key={entry.id} entry={entry} size={entry.category === "icon" ? 18 : 64} />
      ))}
    </Stack>
  );
}

/**
 * The whole pack, at a size you can judge — the "view" half of the owner's
 * request.
 *
 * Grouped by the pack's own categories rather than a fixed list: `GlyphCategory`
 * is open-ended by design ("a pack may add its own"), so a hard-coded set of
 * headings would silently hide a category the day a pack invents one.
 *
 * Drawn with `<PackGlyph entry>`, never `<Glyph id>` — the sheet's whole subject
 * is a pack that may not be the one in force. See the file docblock.
 */
function DrawingSheet({ entries }: { entries: readonly GlyphEntry[] }) {
  const groups = React.useMemo(() => {
    const by = new Map<string, GlyphEntry[]>();
    for (const entry of entries) {
      const list = by.get(entry.category) ?? [];
      list.push(entry);
      by.set(entry.category, list);
    }
    return [...by.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, list]) => ({
        category,
        list: [...list].sort((a, b) => a.id.localeCompare(b.id))
      }));
  }, [entries]);

  if (groups.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary">
        This pack carries no inline drawings — its entries point at files, which this screen cannot
        render.
      </Typography>
    );
  }

  return (
    <Stack spacing={1.5}>
      {groups.map(({ category, list }) => (
        <Box key={category} sx={{ display: "grid", gap: 0.75 }}>
          <Typography variant="caption" sx={{ ...MONO, color: "text.secondary" }}>
            {category} · {list.length}
          </Typography>
          <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap", alignItems: "flex-end" }}>
            {list.map((entry) => (
              <Box key={entry.id} sx={{ textAlign: "center", minWidth: 56, maxWidth: 200 }}>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: category === "icon" ? 34 : 64
                  }}
                >
                  <PackGlyph entry={entry} size={category === "icon" ? 26 : 150} />
                </Box>
                <Typography
                  variant="caption"
                  sx={{ ...MONO, fontSize: 9, color: "text.secondary", display: "block" }}
                >
                  {entry.id.replace(/^icon-/, "")}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}

function entriesOf(pack: AnyPackage): readonly GlyphEntry[] {
  return pack.type === "branding-package"
    ? (pack as BrandingPackage).payload.entries
    : ((pack as LogoPackage).payload.entries ?? []);
}

/**
 * The pack's OWN role variables, scoped to its card.
 *
 * A drawing paints in `var(--gxb-*)` / `var(--axf-brand-*)`, and those resolve
 * from wherever it is mounted — so without this, every candidate previews in
 * the palette of the pack already in force, and three cards that differ only by
 * palette look identical. `PackRegistry` publishes exactly these variables and
 * nothing in the `--axf-*` theme vocabulary, so scoping them here recolours the
 * drawings and touches no surface, text or dial around them.
 *
 * A logo pack carries no palette of its own (it is drawings for whatever
 * identity is in force), so its card inherits — which is the truth about it.
 */
function paletteScope(pack: AnyPackage): Record<string, string> | undefined {
  return pack.type === "branding-package"
    ? paletteVariables((pack as BrandingPackage).payload.palette)
    : undefined;
}

function PackCard({
  pack,
  active,
  onPick
}: {
  pack: AnyPackage;
  active: boolean;
  onPick: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const entries = entriesOf(pack);

  return (
    // The area marker and the pack's identity ride on the OUTER surface, so a
    // right-click anywhere in the card — including inside the opened sheet —
    // resolves to this pack. `settings.commands.ts` reads both.
    <Paper
      variant="outlined"
      data-axf-area="settings.pack"
      data-axf-pack={pack.id}
      data-axf-pack-kind={pack.type}
      sx={{
        display: "grid",
        gap: 1,
        p: 1.5,
        borderColor: active ? "primary.main" : "divider",
        borderWidth: active ? 2 : 1,
        // The pack's own brand roles, so a candidate previews in ITS colours
        // rather than the ones already in force. See `paletteScope`.
        ...paletteScope(pack)
      }}
    >
      {/* A ButtonBase around the summary rather than around the whole card: the
          expander below is a Button, and a button inside a button is invalid
          markup that browsers resolve by dropping one of them. */}
      <ButtonBase
        onClick={onPick}
        sx={{ display: "block", textAlign: "left", borderRadius: "var(--axf-radius)", width: "100%" }}
      >
        <Stack spacing={1} sx={{ width: "100%" }}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {pack.name}
            </Typography>
            <Chip size="small" variant="outlined" label={pack.id} sx={{ ...MONO, height: 18 }} />
            <Chip
              size="small"
              variant="outlined"
              label={`${entries.length} drawings`}
              sx={{ ...MONO, height: 18 }}
            />
            <Box sx={{ flex: 1 }} />
            {active ? <Chip size="small" color="primary" label="in force" sx={{ height: 20 }} /> : null}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {pack.description}
          </Typography>
          <SampleStrip entries={entries} />
        </Stack>
      </ButtonBase>

      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Button size="small" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide the drawings" : `View all ${entries.length} drawings`}
        </Button>
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ pt: 1, borderTop: "1px solid", borderColor: "divider" }}>
          <DrawingSheet entries={entries} />
        </Box>
      </Collapse>
    </Paper>
  );
}

/* ------------------------------------------------------------------ banners */

/** One line describing what a bar item puts on screen, for the opened card. */
function itemDetail(item: ToolbarItem): string {
  switch (item.kind) {
    case "brand":
      return item.glyph ?? "the pack's lockup";
    case "label":
      return item.text;
    case "action":
      return item.label ?? item.title;
    case "menu":
      return item.label;
    case "field":
      return item.placeholder;
    case "slot":
      return `filled by the shell · ${item.id}`;
    default:
      return item.id;
  }
}

function BannerCard({
  asset,
  inForce,
  appDefault,
  brandGlyph,
  onPick
}: {
  asset: ToolbarAsset;
  inForce: boolean;
  appDefault: boolean;
  brandGlyph: string | null;
  onPick: () => void;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <Paper
      variant="outlined"
      data-axf-area="settings.banner"
      data-axf-banner={asset.id}
      sx={{
        display: "grid",
        gap: 1,
        p: 1.5,
        borderColor: inForce ? "primary.main" : "divider",
        borderWidth: inForce ? 2 : 1
      }}
    >
      <ButtonBase
        onClick={onPick}
        sx={{ display: "block", textAlign: "left", borderRadius: "var(--axf-radius)", width: "100%" }}
      >
        <Stack spacing={1} sx={{ width: "100%" }}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {asset.title}
            </Typography>
            <Chip size="small" variant="outlined" label={asset.id} sx={{ ...MONO, height: 18 }} />
            <Chip
              size="small"
              variant="outlined"
              label={`${asset.items.length} items`}
              sx={{ ...MONO, height: 18 }}
            />
            <Box sx={{ flex: 1 }} />
            {inForce ? (
              <Chip size="small" color="primary" label="in force" sx={{ height: 20 }} />
            ) : appDefault ? (
              <Chip size="small" variant="outlined" label="app default" sx={{ ...MONO, height: 20 }} />
            ) : null}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {asset.description}
          </Typography>
          {/* The brand the bar would draw, at the width it declares — the one
              part of a banner that is worth showing rather than listing, and the
              part a pack change actually moves. */}
          {brandGlyph ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Glyph id={brandGlyph} size={132} />
            </Stack>
          ) : null}
        </Stack>
      </ButtonBase>

      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Button size="small" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide the items" : "View the items"}
        </Button>
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Stack spacing={0.5} sx={{ pt: 1, borderTop: "1px solid", borderColor: "divider" }}>
          {asset.items.map((item) => (
            <Stack key={item.id} direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Chip size="small" variant="outlined" label={item.kind} sx={{ ...MONO, height: 18, minWidth: 62 }} />
              <Typography variant="caption" sx={{ ...MONO, color: "text.secondary" }}>
                {itemDetail(item)}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </Collapse>
    </Paper>
  );
}

/**
 * The banner section.
 *
 * The candidates are every registered `app.banner` toolbar — the built-ins in
 * `src/toolbars/` and anything authored in the designer's Toolbar tab, since
 * both live in the same registry. Selecting one writes the theme's `bannerBar`
 * dial, which is what the shell's `<Toolbar surface="app.banner">` reads; an
 * empty dial means "whatever the registry has active", i.e. the app default.
 */
function BannerSection() {
  const snapshot = useToolbars();
  const values = useAppliedThemeValues();
  const style = useResolvedStyle();

  const dialled = String(values.bannerBar ?? "").trim();
  const candidates = React.useMemo(
    () => snapshot.all.filter((t) => t.surface === "app.banner"),
    [snapshot.all]
  );
  const registryDefault = snapshot.active.get("app.banner")?.id ?? null;

  /** What a bar's brand item would actually draw under the identity in force —
   *  the same fallback chain the real banner uses, so a bar asking for a
   *  drawing this pack does not carry previews the mark rather than a dashed
   *  placeholder. */
  const brandGlyphFor = (asset: ToolbarAsset): string | null => {
    const brand = asset.items.find((item) => item.kind === "brand");
    if (!brand) return null;
    for (const id of [brand.glyph, "lockup", "wordmark", "mark"]) {
      if (id && style.glyphs.has(id)) return id;
    }
    return null;
  };

  if (candidates.length === 0) return null;

  return (
    <Paper variant="outlined" sx={{ p: 2, display: "grid", gap: 1.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="subtitle2">Banner</Typography>
        <Chip size="small" variant="outlined" label={candidates.length} sx={{ ...MONO, height: 18 }} />
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          variant="outlined"
          disabled={!dialled}
          onClick={() => themeStore.setValue("bannerBar", "")}
        >
          Use app default
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        The bar that draws the app banner. Unlike the packs it IS a theme dial (`bannerBar`), so a
        saved look carries its own bar and restores it — selecting here applies and saves straight
        away, because this page previews nothing. Bars are built and edited in the{" "}
        <strong>Theme Designer</strong>; this is where one is put in force.
      </Typography>
      <MenuHint what="banner" />
      <Divider />
      <Stack spacing={1}>
        {candidates.map((asset) => (
          <BannerCard
            key={asset.id}
            asset={asset}
            inForce={dialled === asset.id}
            appDefault={!dialled && registryDefault === asset.id}
            brandGlyph={brandGlyphFor(asset)}
            onPick={() => themeStore.setValue("bannerBar", asset.id)}
          />
        ))}
      </Stack>
    </Paper>
  );
}

/**
 * The SDK's settings sections — whatever contributed to
 * `studio.settings-section`.
 *
 * This is the CONSUMER half of the hook the tab bar was the first to use, and it
 * lives here because a "future SDK settings interface" that nothing can be
 * plugged into today is a promise rather than a seam. A section names a settings
 * OWNER; the rows come from that owner's declared settings and are drawn by the
 * one shell-mounted `SettingsDialog`. So this list stays four lines long however
 * many plugins arrive, and no plugin has to edit this page to be configurable
 * from it.
 *
 * Two gates, the same pair `ShellStrips` documents: the registry fills during an
 * ASYNC boot (so this subscribes rather than reading once), and it renders
 * nothing until mounted (so the server frame and the first client frame agree).
 *
 * ## Two kinds of section, and the rule between them (2026-08-15)
 *
 * A section either names a settings OWNER — the common case, drawn as a row
 * with a button that opens the one shell-mounted dialog — or supplies its own
 * `render`, which `studio.points.ts` documents as the exception for a surface
 * whose controls are not rows at all (the Theme Manager). A rendering section
 * is drawn as its own card, ABOVE the roster, because a card inside the
 * "Plugins" list would read as a plugin's settings rather than as a section of
 * this page.
 *
 * A section that supplies neither says so on screen. It is a contribution
 * violation the registry cannot catch (the point's `requires` is a
 * field-presence check and this contract is one-of-two), so the consumer is
 * where it has to become visible — and a visible sentence beats an empty row
 * nobody can explain.
 */
function useSettingsSections() {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const version = React.useSyncExternalStore(registry.subscribe, registry.version, () => 0);
  const sections = React.useMemo(
    () => registry.contributionsTo<StudioSettingsSectionPayload>("studio.settings-section"),
    [version]
  );

  return mounted ? sections : [];
}

/** The sections that draw themselves — each its own card, in priority order. */
function RenderedSettingsSections() {
  const sections = useSettingsSections().filter((c) => typeof c.payload.render === "function");
  if (sections.length === 0) return null;
  return (
    <>
      {sections.map((c) => (
        <React.Fragment key={`${c.from}:${c.payload.id}`}>
          {/* Suspense because the payload's render is a `React.lazy` component:
              a plugin entry may not statically import a `.tsx` (the closure
              resolver reads it under plain Node), so every rendering section
              arrives lazily by construction. */}
          <React.Suspense fallback={null}>{c.payload.render?.()}</React.Suspense>
        </React.Fragment>
      ))}
    </>
  );
}

function SdkSettingsSections() {
  const sections = useSettingsSections().filter((c) => typeof c.payload.render !== "function");

  if (sections.length === 0) return null;

  return (
    <Paper variant="outlined" sx={{ p: 2, display: "grid", gap: 1.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="subtitle2">Plugins</Typography>
        <Chip size="small" variant="outlined" label={sections.length} sx={{ ...MONO, height: 18 }} />
      </Stack>
      <Typography variant="caption" color="text.secondary">
        Sections contributed to <code>studio.settings-section</code>. Each opens the same dialog its
        own surface does — one dialog, one store, so a value changed here is the value that surface
        already had.
      </Typography>
      <Divider />
      <Stack spacing={1}>
        {sections.map((c) => (
          <Stack
            key={`${c.from}:${c.payload.id}`}
            direction="row"
            spacing={1.5}
            sx={{ alignItems: "center" }}
          >
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {c.payload.title}
                </Typography>
                <Chip
                  size="small"
                  variant="outlined"
                  label={c.payload.ownerId ?? "no owner"}
                  color={c.payload.ownerId ? "default" : "error"}
                  sx={{ ...MONO, height: 18 }}
                />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {c.payload.summary}
              </Typography>
              {c.payload.ownerId ? null : (
                <Typography variant="caption" color="error" sx={{ display: "block" }}>
                  This section names no settings owner and draws nothing — one of the two is
                  required.
                </Typography>
              )}
            </Box>
            <Button
              size="small"
              variant="outlined"
              disabled={!c.payload.ownerId}
              onClick={() => c.payload.ownerId && settingsUi.open(c.payload.ownerId)}
            >
              Settings
            </Button>
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}

export default function SettingsPage() {
  const resolved = useResolvedStyle();

  const branding = React.useMemo(() => packs.packs("branding-package"), []);
  const logos = React.useMemo(() => packs.packs("logo-package"), []);

  return (
    <Box data-axf-area="settings.surface" sx={{ p: 2.5, display: "grid", gap: 2, maxWidth: 1080 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
        <Glyph id="icon-gear" size={22} />
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          Settings
        </Typography>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, display: "grid", gap: 1.5 }}>
        <Typography variant="subtitle2">Branding pack</Typography>
        <Typography variant="caption" color="text.secondary">
          The pack that supplies every logo and icon the app draws. It is GLOBAL and FIXED — it
          never changes with a theme, a roll cannot touch it, and a saved look does not carry it.
          Selecting applies and saves immediately; drawings recolour their surfaces from the live
          theme, so the brand stays legible under any roll.
        </Typography>
        <MenuHint what="pack" />
        <Stack spacing={1}>
          {branding.map((pack) => (
            <PackCard
              key={pack.id}
              pack={pack}
              active={resolved.brandingId === pack.id}
              onPick={() => packs.activate(pack.id)}
            />
          ))}
        </Stack>
      </Paper>

      {logos.length > 0 ? (
        <Paper variant="outlined" sx={{ p: 2, display: "grid", gap: 1.5 }}>
          <Typography variant="subtitle2">Logo pack</Typography>
          <Typography variant="caption" color="text.secondary">
            Extra marks layered over the branding pack — a logo pack&apos;s drawing wins when both
            carry the same id. Same rules: global, fixed, saved on click.
          </Typography>
          <MenuHint what="pack" />
          <Stack spacing={1}>
            {logos.map((pack) => (
              <PackCard
                key={pack.id}
                pack={pack}
                active={resolved.logoId === pack.id}
                onPick={() => packs.activate(pack.id)}
              />
            ))}
          </Stack>
        </Paper>
      ) : null}

      <BannerSection />

      {/* Sections that draw their own controls — the Theme Manager today. Above
          the plugin roster because the theme is what the two cards above are
          about; below the identity because branding is the fixed setting a theme
          may never touch. */}
      <RenderedSettingsSections />

      <SdkSettingsSections />

      {resolved.unresolved.length > 0 ? (
        <Paper variant="outlined" sx={{ p: 1.5 }}>
          <Typography variant="caption" color="error">
            Stored selection names packs nothing registered: {resolved.unresolved.join(", ")} — the
            app default is standing in.
          </Typography>
        </Paper>
      ) : null}

      <ResetAppearanceCard />
    </Box>
  );
}

/**
 * The way back from a theme that made the app hard to use.
 *
 * It lives HERE rather than only in the designer for one reason, and it is the
 * reason it exists at all: a rolled `navStyle: "rail"` or a `navPlacement` on
 * another edge can hide the labels the designer's own nav row is found by. A
 * reset reachable only from the screen you can no longer find is not a reset.
 * `/settings` is reachable by URL whatever the nav is doing, and this card
 * says so.
 */
function ResetAppearanceCard() {
  const [report, setReport] = React.useState<ResetReport | null>(null);

  return (
    <Paper variant="outlined" sx={{ p: 2, display: "grid", gap: 1.5 }}>
      <Typography variant="subtitle2">Reset appearance</Typography>
      <Typography variant="caption" color="text.secondary">
        Puts the theme and the layouts back to what the app ships with: the roll seed, every dial
        edit, the roller&apos;s constraints, the banner and nav-menu selections, and the
        dashboard&apos;s card placement. <strong>Your saved looks, your custom toolbars and nav
        menus, and the branding pack above are all kept</strong> — this undoes the appearance in
        force, not the work you authored.
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Use it if a roll has left the app awkward — a nav rolled to <code>rail</code> draws icons
        with no labels, which reads as screens missing from the menu.
      </Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Button
          size="small"
          variant="outlined"
          color="warning"
          onClick={() => setReport(resetAppearance())}
        >
          Reset theme and layouts
        </Button>
        {report ? (
          <Button size="small" variant="contained" onClick={() => window.location.reload()}>
            Reload to finish
          </Button>
        ) : null}
      </Stack>
      {report ? (
        <Alert severity="success" sx={{ py: 0 }}>
          Reset: {report.cleared.join(" · ")}. Reload so every surface agrees.
        </Alert>
      ) : null}
    </Paper>
  );
}
