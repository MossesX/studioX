/**
 * @file The theme designer — dials, roller, chrome pickers and the shelf.
 *
 * The AUTHORING half of the theme engine. Core ships the rolling half and
 * deliberately no designer (`theme/index.ts` states the split and names
 * `setValue()` as the seam), so this is a STUDIO plugin at its own route: core
 * owns the engine, the studio owns the surface.
 *
 * It is a surface over the engine and nothing else. No second store, no second
 * publisher, no second persistence key, no re-derivation of anything
 * `derived.ts` already computes. Every edit goes through `ThemeStore.setValue`,
 * which is what makes the app repaint around this page while you work.
 *
 * ## The 2026-08-12 shape — six tabs, one authority
 *
 * The tab STRIP itself became a registered toolbar asset on 2026-08-13 (owner:
 * *"convert these links to a toolbar asset with branded icons but larger"*) —
 * `toolbars/designer-tabs-bar.ts`, six actions drawn by the branding pack at
 * 22px. So the designer's own navigation is now made of the thing the designer
 * designs: it can be duplicated and rebuilt in the Toolbar tab below, and
 * right-clicking it opens the per-user bar settings every toolbar has.
 *
 *   - **Dials** — every dial in the spec, grouped by subsystem, rendered FROM
 *     the spec (`dialsBySubsystem()`), so a dial added to `spec.ts` appears
 *     here with no edit.
 *   - **Roller** — seeded rolls; rolling APPLIES (commits) — a roll restyles
 *     the whole app, that is what it is for.
 *   - **Toolbar / Nav menu / Dashboard** — build and edit chrome assets, and
 *     select the one this theme uses (the `bannerBar` / `navMenu` /
 *     `dashboard` chrome dials). The Dashboard tab is the widest of the three
 *     because a wrapper carries dials of its own AND a selection of the
 *     theme's; see its own docblock for the two switches that arrangement
 *     needs.
 *   - **Saved** — the shelf. A saved look is THE VALUES — every dial, chrome
 *     selection included.
 *
 * What is deliberately GONE: the Branding and Style-packs tabs. Style packages
 * do not exist any more, and the branding pack is a fixed APP SETTING chosen
 * at /settings — never rolled, never saved with a look, never overriding a
 * dial. The whole "pack wins / suppressed dials" apparatus went with it: the
 * theme is the only authority over every `--axf-*` value, so nothing on this
 * page can be outranked.
 *
 * ## Edit → Apply, and what each half means
 *
 * Turning a dial repaints the WHOLE app immediately (a palette can only be
 * judged on real chrome) but persists nothing: `ThemeStore.#persist()` refuses
 * while previewing, so localStorage and the theme cookie keep describing the
 * applied theme, and any full document load renders the applied theme. The
 * header's **Apply to app** commits — that is the save, and it survives
 * reloads because the cookie mirror is what the server paints from. Leaving
 * without applying restores the applied theme (`endPreview` on unmount).
 * Rolls, history steps and saved-look applies commit on their own, because
 * each of those IS choosing a theme (`test/designer-commits.test.ts` holds
 * this).
 */
"use client";

import * as React from "react";

import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import {
  DIALS,
  Glyph,
  Toolbar,
  defaultValues,
  dialsBySubsystem,
  theme as themeStore,
  useResolvedStyle,
  useTheme
} from "@axf/core";
import type { DialSubsystem, StyleInput, ThemeValues } from "@axf/core";

import { Cascade, PublishMeter } from "./Cascade";
import DialControl from "./DialControl";
import PreviewPanel from "./PreviewPanel";
import Roller from "./Roller";
import SurfacesTab from "./SurfacesTab";
import SavedThemes from "./SavedThemes";
import ToolbarTab from "./ToolbarTab";
import NavMenuTab from "./NavMenuTab";
import DashboardTab from "./DashboardTab";
import { DESIGNER_TAB_COMMAND, DESIGNER_TABS_SURFACE } from "../../toolbars/designer-tabs-bar";
import { attachShelfSync } from "./shelf-sync";
import { savedThemes } from "./saved-store";
import { usePublishDiff } from "./usePublishDiff";
import { resetAppearance } from "../../appearance-reset";

const MONO = { fontFamily: "var(--axf-mono)", fontSize: 11 } as const;

type DesignerTab = "dials" | "roller" | "toolbar" | "navmenu" | "dashboard" | "surfaces" | "saved";

/** Subsystem headings, from the spec's own grouping — never a hand-kept list. */
function subsystemLabel(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** Nothing suppresses a dial any more — see the file docblock. */
const NOTHING_SUPPRESSED: ReadonlySet<string> = new Set();

/* -------------------------------------------------------------- the surface */

export default function ThemeDesigner() {
  /* The live theme, read on every render. Never copied into state — the store
     reports its SERVER snapshot during the hydrating render by design, so a
     copy taken at mount is the shipped default pretending to be the theme. */
  const state = useTheme();
  const style = useResolvedStyle();
  const values = state.values;

  /* The pack layer AxfStyleRoot composes: the drawing-role variables only. It
     rides into previews so glyphs paint in the brand's colours there too. */
  const pack: StyleInput = React.useMemo(
    () => ({ variables: style.variables }),
    [style.variables]
  );

  /** The theme before hand edits: the rolled one, or the shipped default. */
  const base = React.useMemo<ThemeValues>(
    () => state.rolled?.values ?? defaultValues(),
    [state.rolled]
  );

  const diff = usePublishDiff(values, pack);

  const [lastDial, setLastDial] = React.useState<string | null>(null);
  const [compare, setCompare] = React.useState(false);
  const [tab, setTab] = React.useState<DesignerTab>("dials");

  /* The saved-look shelf mirrors to the server. Attached HERE, at the designer
     root, so it covers every tab. Idempotent; see `shelf-sync.ts`. */
  React.useEffect(() => attachShelfSync(savedThemes), []);

  /* Everything on this screen is a PREVIEW until applied: edits repaint the
     whole app and persist nothing until Apply commits them. The cleanup covers
     the one case no reload handles — a client-side unmount. */
  React.useEffect(() => {
    themeStore.beginPreview();
    return () => themeStore.endPreview();
  }, []);

  const setDial = React.useCallback((dialId: string, value: string | number) => {
    setLastDial(dialId);
    themeStore.setValue(dialId, value);
  }, []);

  const applyToApp = React.useCallback(() => {
    // Commit, then immediately preview again from the new applied theme — the
    // designer is still open, so the next dial turn must be a preview too.
    themeStore.commitPreview();
    themeStore.beginPreview();
  }, []);

  const discard = React.useCallback(() => {
    themeStore.endPreview();
    themeStore.beginPreview();
  }, []);

  /**
   * Back to the shipped default — theme AND dashboard layout, persisted.
   *
   * Not the same as Discard, and the difference is the whole point: Discard
   * returns to the APPLIED theme, which is exactly what you want back when the
   * applied theme is the problem. `resetAppearance` ends the preview, resets,
   * and lets the store persist, then a new preview begins so the designer keeps
   * behaving as a preview surface.
   */
  const resetAll = React.useCallback(() => {
    resetAppearance();
    themeStore.beginPreview();
    setLastDial(null);
  }, []);

  const groups = React.useMemo(() => dialsBySubsystem(), []);
  const subsystems = Object.keys(groups) as DialSubsystem[];
  const overrideCount = Object.keys(state.overrides).length;

  return (
    <Box sx={{ p: 2.5, display: "grid", gap: 2 }}>
      {/* ------------------------------------------------------------ header */}
      <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Glyph id="icon-brush" size={22} />
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          Theme designer
        </Typography>
        <Chip size="small" label={`${DIALS.length} dials`} sx={{ ...MONO, height: 20 }} />
        <Chip
          size="small"
          variant="outlined"
          label={state.seed ? `seed ${state.seed}` : "shipped default"}
          sx={{ ...MONO, height: 20 }}
        />
        {state.rolled ? (
          <Chip size="small" variant="outlined" label={state.rolled.name} sx={{ height: 20 }} />
        ) : null}
        <Chip
          size="small"
          color={overrideCount ? "primary" : "default"}
          variant={overrideCount ? "filled" : "outlined"}
          label={`${overrideCount} override${overrideCount === 1 ? "" : "s"}`}
          sx={{ ...MONO, height: 20 }}
        />
        <Box sx={{ flex: 1 }} />
        {tab === "dials" ? (
          <FormControlLabel
            control={<Switch size="small" checked={compare} onChange={(_, v) => setCompare(v)} />}
            label={<Typography variant="caption">Compare with base</Typography>}
          />
        ) : null}
        <Tooltip title="Drop every hand edit and return to the rolled theme.">
          <span>
            <Button
              size="small"
              variant="outlined"
              disabled={overrideCount === 0}
              onClick={() => {
                themeStore.clearOverrides();
                setLastDial(null);
              }}
            >
              Clear overrides
            </Button>
          </span>
        </Tooltip>
        <Tooltip title="Throw away the unsaved changes and go back to the applied theme.">
          <span>
            <Button size="small" variant="outlined" disabled={!state.previewing} onClick={discard}>
              Discard
            </Button>
          </span>
        </Tooltip>
        {/* The way back from a roll that made the app awkward to use — a nav
            rolled to `rail` draws icons with no labels, which reads as screens
            missing from the menu. The same action lives at /settings on purpose:
            that route is reachable whatever the nav is doing. */}
        <Tooltip title="Put the theme AND the dashboard layout back to what the app ships with, and save it. Saved looks, custom chrome assets and the branding pack are all kept.">
          <Button size="small" variant="outlined" color="warning" onClick={resetAll}>
            Reset
          </Button>
        </Tooltip>
        <Tooltip title="Make the theme on screen THE app theme — saved to this browser and to the theme cookie, so every page and every reload renders it.">
          <span>
            <Button size="small" variant="contained" disabled={!state.previewing} onClick={applyToApp}>
              Apply to app
            </Button>
          </span>
        </Tooltip>
      </Stack>

      {state.previewing ? (
        <Typography variant="caption" sx={{ color: "text.secondary", mt: -1.5 }}>
          Previewing — the whole app repaints as you edit, and nothing is saved until you click
          Apply to app. Leaving this screen restores the applied theme.
        </Typography>
      ) : null}

      {/* The six screens, as a registered toolbar ASSET rather than an MUI
          Tabs — owner, 2026-08-13. Its items' ids ARE the tab keys, so the
          state goes straight into `activeItem` and the command's tail comes
          straight back out; see `toolbars/designer-tabs-bar.ts` for why the
          commands are handled here instead of through the command registry.
          Right-click it for its own settings (icons bigger, words off, run it
          down the side) — every bar in the app has that now. */}
      <Toolbar
        surface={DESIGNER_TABS_SURFACE}
        activeItem={tab}
        onCommand={(command) => {
          if (!command.startsWith(DESIGNER_TAB_COMMAND)) return;
          setTab(command.slice(DESIGNER_TAB_COMMAND.length) as DesignerTab);
        }}
      />

      {tab === "roller" ? <Roller pack={pack} /> : null}
      {tab === "toolbar" ? <ToolbarTab /> : null}
      {tab === "navmenu" ? <NavMenuTab /> : null}
      {tab === "dashboard" ? <DashboardTab /> : null}
      {tab === "surfaces" ? <SurfacesTab /> : null}
      {tab === "saved" ? <SavedThemes /> : null}

      {/* ------------------------------------------------- dials | readouts */}
      {tab === "dials" ? (
      <Box
        sx={{
          display: "grid",
          gap: 2,
          alignItems: "start",
          gridTemplateColumns: { xs: "1fr", lg: "minmax(420px, 34%) 1fr" }
        }}
      >
        {/* Dials only. The readouts live in the other column DELIBERATELY: they
            grow when a dial is first touched, and anything above the controls
            that changes height moves the slider out from under the pointer
            mid-drag. Measured, not theorised. */}
        <Box sx={{ display: "grid", gap: 1.5 }}>
          {subsystems.map((subsystem) => (
            <Accordion key={subsystem} defaultExpanded disableGutters>
              <AccordionSummary expandIcon={<Glyph id="icon-chevron-down" size={14} />}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", width: "100%" }}>
                  <Typography variant="subtitle2">{subsystemLabel(subsystem)}</Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={groups[subsystem].length}
                    sx={{ ...MONO, height: 18 }}
                  />
                </Stack>
              </AccordionSummary>
              <AccordionDetails sx={{ display: "grid", gap: 0.5, pt: 0 }}>
                {groups[subsystem].map((dial) => (
                  <DialControl
                    key={dial.id}
                    dial={dial}
                    values={values}
                    onChange={setDial}
                    baseValue={base[dial.id] ?? dial.default}
                    overridden={dial.id in state.overrides}
                    packOverride={null}
                    recent={lastDial === dial.id}
                  />
                ))}
              </AccordionDetails>
            </Accordion>
          ))}
        </Box>

        <Box sx={{ display: "grid", gap: 1.5, position: { lg: "sticky" }, top: 12 }}>
          <PublishMeter diff={diff} />
          <Cascade
            dialId={lastDial}
            values={values}
            diff={diff}
            suppressed={NOTHING_SUPPRESSED}
            packOwner="the branding pack"
          />
          <PreviewPanel
            values={values}
            pack={pack}
            title="Edited — live"
            note="the theme in force, in its own scope"
          />
          {compare ? (
            <PreviewPanel
              values={base}
              pack={pack}
              compact
              title="Base — before hand edits"
              note={state.rolled ? `roll ${state.rolled.seed}` : "shipped default"}
            />
          ) : null}
        </Box>
      </Box>
      ) : null}
    </Box>
  );
}
