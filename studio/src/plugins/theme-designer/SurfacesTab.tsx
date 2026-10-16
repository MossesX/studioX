"use client";

/**
 * @file The **Surfaces** tab — every UI in the studio that is not a module:
 * landing pages, plugin-owned screens and dialogs. Select one, see it live, and
 * edit the ones that have an authoring engine behind them.
 *
 * Owner request, 2026-08-15: *"create a tab in theme designer that lists all
 * dialogs and landing pages and any ui that is not a module. upon selecting it
 * loads it in a preview along with dials and methods to edit everything like
 * selecting a logo from a kit etc"*.
 *
 * ## The honest part, stated up front
 *
 * Only **landings** are really editable, and the tab says so on every other row
 * rather than drawing controls that do nothing. A plugin screen is built from
 * components and has no asset behind it; a dialog is drawn by its module. There
 * is no engine to edit either one through, and offering a disabled dial for
 * them would imply a capability that does not exist. What those rows get is a
 * live preview, an honest reason, and a pointer at the Dials tab — which does
 * govern how they look, because every colour they draw comes from the theme.
 *
 * ## Editing a landing without breaking its signature
 *
 * A landing is a framework-authored asset with a content signature. This tab
 * therefore writes to the **override document** (`x-landing/overrides.ts`), not
 * to the asset — the same split `chrome-assets.json` uses for user-built
 * toolbars. The asset stays byte-identical to what the generator produced,
 * `check:x-landing` stays green, and the override wins at render time.
 *
 * Making a choice PERMANENT — part of the asset, carried by its zip, surviving a
 * factory reset — is a one-line source edit plus a generator run, and the tab
 * prints the exact two steps rather than pretending the button did it. That is
 * the anti-hand-write contract working as designed, not a gap in this screen.
 *
 * ## Why the preview is an iframe
 *
 * A landing is a `position: fixed` full-viewport surface that renders its own
 * chrome, and `/login` renders `ChromelessShell`. Mounting either inside this
 * page would put a second fixed overlay over the designer and a second theme
 * root inside the first. The iframe gives each surface its own viewport and its
 * own document, which is the only way the preview shows what the page actually
 * is. It also means the preview exercises the REAL route, so what is on screen
 * is the thing itself rather than a reconstruction that can drift.
 */

import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph } from "@axf/core";

import { LogoKitLogo } from "../../logo-kits/LogoKitLogo";
import { allLogoKits } from "../../logo-kits/catalog";
import type { LogoSpec } from "../../logo-kits/types";
import { surfaceInventory, type Surface } from "../../surfaces/inventory";
import { allXLandings } from "../../x-landing/catalog";
import {
  EMPTY_OVERRIDES,
  isOverridden,
  loadOverrides,
  resolveLanding,
  saveOverrides,
  type LandingOverridesDoc
} from "../../x-landing/overrides";

/** Routes the studio serves, and which of them modules own. Read from the nav
 *  assets the app already publishes, so this tab adds no second route table. */
function useRouteFacts(): { live: string[]; moduleRoutes: string[] } {
  const [facts, setFacts] = React.useState<{ live: string[]; moduleRoutes: string[] }>({
    live: [],
    moduleRoutes: []
  });
  React.useEffect(() => {
    let alive = true;
    void fetch("/api/axf/surfaces")
      .then((r) => (r.ok ? r.json() : { live: [], moduleRoutes: [] }))
      .then((body: { live?: string[]; moduleRoutes?: string[] }) => {
        if (!alive) return;
        setFacts({ live: body.live ?? [], moduleRoutes: body.moduleRoutes ?? [] });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return facts;
}

export default function SurfacesTab() {
  const facts = useRouteFacts();
  const [doc, setDoc] = React.useState<LandingOverridesDoc>(EMPTY_OVERRIDES);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [nudge, setNudge] = React.useState(0);
  const [problem, setProblem] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    void loadOverrides().then((d) => alive && setDoc(d));
    return () => {
      alive = false;
    };
  }, []);

  const surfaces = React.useMemo(() => surfaceInventory(facts), [facts]);
  const current = surfaces.find((s) => s.id === selected) ?? surfaces[0] ?? null;

  const persist = React.useCallback(async (next: LandingOverridesDoc) => {
    setDoc(next);
    const ok = await saveOverrides(next);
    setProblem(ok ? null : "saved in this tab, but the server mirror failed — it will not survive a reload");
    // Force the iframe to re-fetch so the preview shows the change immediately.
    setNudge((n) => n + 1);
  }, []);

  return (
    <Stack direction={{ xs: "column", md: "row" }} sx={{ gap: 2, minHeight: 0, flex: 1 }}>
      {/* ---- the inventory ------------------------------------------------ */}
      <Box sx={{ width: { xs: "100%", md: 300 }, flexShrink: 0, overflowY: "auto" }}>
        <Typography sx={{ fontSize: 12, opacity: 0.7, mb: 0.5 }}>
          {surfaces.length} surface(s) that are not modules
        </Typography>
        <List dense disablePadding>
          {(["landing", "route", "dialog"] as const).map((kind) => {
            const rows = surfaces.filter((s) => s.kind === kind);
            if (rows.length === 0) return null;
            return (
              <Box key={kind}>
                <Typography
                  sx={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.12em", opacity: 0.55, mt: 1.2 }}
                >
                  {kind === "landing" ? "Landing pages" : kind === "route" ? "Plugin screens" : "Dialogs"}
                </Typography>
                {rows.map((s) => (
                  <ListItemButton
                    key={s.id}
                    selected={current?.id === s.id}
                    onClick={() => setSelected(s.id)}
                    sx={{ borderRadius: 1 }}
                  >
                    <ListItemText
                      primary={s.name}
                      secondary={s.route ?? "no route — opened by its module"}
                      slotProps={{
                        primary: { sx: { fontSize: 13 } },
                        secondary: { sx: { fontSize: 11, opacity: 0.6 } }
                      }}
                    />
                    {s.editable ? <Chip size="small" label="editable" sx={{ height: 18, fontSize: 10 }} /> : null}
                  </ListItemButton>
                ))}
              </Box>
            );
          })}
        </List>
      </Box>

      <Divider flexItem orientation="vertical" sx={{ display: { xs: "none", md: "block" } }} />

      {/* ---- preview + editor -------------------------------------------- */}
      <Stack sx={{ flex: 1, minWidth: 0, gap: 1.5 }}>
        {current ? (
          <>
            <Box>
              <Typography sx={{ fontSize: 16, fontWeight: 700 }}>{current.name}</Typography>
              <Typography sx={{ fontSize: 12, opacity: 0.7, mt: 0.3 }}>{current.summary}</Typography>
            </Box>

            <SurfacePreview surface={current} nudge={nudge} />

            {problem ? <Alert severity="warning">{problem}</Alert> : null}

            {current.kind === "landing" ? (
              <LandingEditor id={current.id} doc={doc} onChange={persist} />
            ) : (
              <Alert severity="info" sx={{ fontSize: 12 }}>
                {current.notEditableWhy}
              </Alert>
            )}
          </>
        ) : (
          <Typography sx={{ opacity: 0.6, fontSize: 13 }}>Loading the surface list…</Typography>
        )}
      </Stack>
    </Stack>
  );
}

/** The live surface, in its own viewport. See the file header for why an iframe. */
function SurfacePreview({ surface, nudge }: { surface: Surface; nudge: number }) {
  if (!surface.route) {
    return (
      <Box
        sx={{
          height: 300,
          display: "grid",
          placeItems: "center",
          border: "1px solid var(--axf-edge)",
          borderRadius: "var(--axf-radius)",
          bgcolor: "var(--axf-panel)"
        }}
      >
        <Stack sx={{ alignItems: "center", gap: 1, opacity: 0.65 }}>
          <Glyph id="icon-layers" size={26} />
          <Typography sx={{ fontSize: 12, maxWidth: 360, textAlign: "center" }}>
            A dialog has no address of its own, so there is nothing to load here. It is opened by its module, over
            whatever screen you are on.
          </Typography>
        </Stack>
      </Box>
    );
  }
  /*
   * A landing is previewed in its DESIGN state — the signed-out card — via
   * `?preview=1`. Without it the preview is worthless to the only people who
   * ever open it: everybody designing a login screen is signed in, so the real
   * screen finds their session and redirects the iframe to their role landing.
   * The pane showed the admin dashboard, which is the one thing the landing is
   * definitionally not. Only landings take the flag; a plugin screen has no
   * signed-out state to show.
   */
  const src = surface.kind === "landing" ? `${surface.route}?preview=1` : surface.route;

  return (
    <Box
      component="iframe"
      key={`${src}#${nudge}`}
      src={src}
      title={`${surface.name} preview`}
      sx={{
        width: "100%",
        height: 420,
        border: "1px solid var(--axf-edge)",
        borderRadius: "var(--axf-radius)",
        bgcolor: "var(--axf-page)"
      }}
    />
  );
}

/** The dials a landing actually has: which logo it composes, and how
 *  translucent its card is. */
function LandingEditor({
  id,
  doc,
  onChange
}: {
  id: string;
  doc: LandingOverridesDoc;
  onChange: (next: LandingOverridesDoc) => void;
}) {
  const asset = allXLandings().find((l) => l.id === id);
  if (!asset) return null;

  const shown = resolveLanding(asset, doc);
  const dirty = isOverridden(asset, doc);

  const set = (patch: { logo?: string; cardOpacity?: number }) =>
    onChange({ ...doc, byId: { ...doc.byId, [id]: { ...doc.byId[id], ...patch } } });

  const reset = () => {
    const { [id]: _dropped, ...rest } = doc.byId;
    onChange({ ...doc, byId: rest });
  };

  return (
    <Stack sx={{ gap: 2 }}>
      <Divider />

      {/* ---- logo, picked from any kit ------------------------------------ */}
      <Box>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1, mb: 0.8 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600 }}>Background logo</Typography>
          <Chip size="small" label={shown.assets.logo} sx={{ height: 18, fontSize: 10, fontFamily: "var(--axf-mono)" }} />
          {dirty ? (
            <Tooltip title="Reset this landing to its asset's own values">
              <IconButton size="small" onClick={reset}>
                <Glyph id="icon-sync" size={14} />
              </IconButton>
            </Tooltip>
          ) : null}
        </Stack>
        {allLogoKits().map((kit) => (
          <Box key={kit.id} sx={{ mb: 1.2 }}>
            <Typography sx={{ fontSize: 11, opacity: 0.6, mb: 0.5 }}>
              {kit.id} · {kit.name}
            </Typography>
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(78px, 1fr))", gap: 1 }}>
              {kit.logos.map((logo: LogoSpec) => {
                const active = shown.assets.logo === logo.id;
                return (
                  <Tooltip key={logo.id} title={`${logo.name} — ${logo.id}`}>
                    <Box
                      onClick={() => set({ logo: logo.id })}
                      sx={{
                        cursor: "pointer",
                        aspectRatio: "1 / 1",
                        display: "grid",
                        placeItems: "center",
                        borderRadius: 1,
                        border: `2px solid ${active ? "var(--axf-accent)" : "var(--axf-edge)"}`,
                        bgcolor: "var(--axf-page)",
                        transition: "border-color 120ms"
                      }}
                    >
                      <LogoKitLogo logo={logo} size={44} />
                    </Box>
                  </Tooltip>
                );
              })}
            </Box>
          </Box>
        ))}
      </Box>

      {/* ---- card opacity -------------------------------------------------- */}
      <Box>
        <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 0.3 }}>
          Sign-in card opacity — {shown.cardOpacity.toFixed(2)}
        </Typography>
        <Slider
          size="small"
          min={0}
          max={1}
          step={0.05}
          value={shown.cardOpacity}
          onChange={(_e, v) => set({ cardOpacity: Array.isArray(v) ? v[0] : v })}
        />
      </Box>

      {/* ---- how to make it permanent ------------------------------------- */}
      <Alert severity={dirty ? "warning" : "info"} sx={{ fontSize: 11.5 }}>
        {dirty ? (
          <>
            This landing is showing an <strong>override</strong>, not its asset. The asset `{id}` is untouched and its
            signature still verifies. To make this permanent — carried by the asset&apos;s zip and surviving a factory
            reset — set <code>logo: &quot;{shown.assets.logo}&quot;</code> in{" "}
            <code>src/x-landing/landings/login-landing.ts</code> and run{" "}
            <code>npm run gen:x-landing</code>, then reset here.
          </>
        ) : (
          <>
            Showing the asset&apos;s own values. Changes here are stored as a user override; the framework-authored
            asset is never edited, which is what keeps <code>check:x-landing</code> green.
          </>
        )}
      </Alert>
    </Stack>
  );
}
