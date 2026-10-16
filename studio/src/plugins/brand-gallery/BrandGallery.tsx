/**
 * @file Brand gallery — every registered pack, shown at a size you can judge.
 *
 * `StylePanes` in the demo module already listed the packs, but at 28px and
 * buried among a dozen unrelated cards. You cannot assess a mark at 28px, and
 * an identity you cannot assess is one nobody signs off. So this is a surface
 * whose only job is showing identity: marks large, lockups at real width, the
 * full glyph set, and the palette that drives all of it.
 *
 * Everything is live. Clicking a pack activates it, and every other surface in
 * the app follows immediately, because the packs publish through the same
 * `:root` variables the theme does. The comparison strip below is drawn from
 * each pack's own palette WITHOUT activating it, so four identities can be
 * compared side by side while one is in force.
 *
 * A click is also SAVED, and survives a reload — `packs.activate()` writes the
 * selection and the registry restores it before the first render. That is the
 * theme store's rule ("hot render, save instantly, no confirm step") applied to
 * the identity, and this surface is where it is visible: the strip below the
 * marks says whether the identity in force is yours or the app's default, and
 * offers the way back to the default when it is yours.
 *
 * ── MUI (2026-08-10, P3) ─────────────────────────────────────────────────────
 *
 * This file was written before MUI was in the tree at all and was the largest
 * entry in `check:ui`'s pre-MUI debt ledger — two hand-rolled controls and
 * twenty-five hand-painted containers. Cards are `Card` / `CardHeader` /
 * `CardContent`, rows are `Stack`, text is `Typography`, the zoom control is a
 * `ToggleButtonGroup` (which is what an exclusive three-way choice IS), and the
 * lists are `List` / `ListItemButton`.
 *
 * Two of those are behaviour rather than paint, and both were real defects:
 *
 *   - the pack cards and the standalone-pack rows were `<div onClick>`. They
 *     activate the app's identity and could not be reached from a keyboard at
 *     all. They are `CardActionArea` and `ListItemButton` now, so the most
 *     consequential control on the screen is focusable and operable;
 *   - the zoom buttons were three `<button>`s hand-painting their own selected
 *     state, so "which zoom is active" was a colour with no name. `selected` on
 *     a `ToggleButton` is a state MUI announces.
 *
 * **Why the swatches keep an explicit colour.** Every surface here paints from
 * `token()` — except the swatch fills and the pack-card previews, which paint
 * from the pack's OWN palette on purpose. Those show an identity that is not in
 * force, so drawing them from the live theme would make four packs look
 * identical, which is exactly what the comparison strip exists to disprove.
 * They are the one place a literal colour is the correct answer, and it comes
 * from the pack's data rather than from this file.
 *
 * ── SELECTION AND LIVE UI EDITING (2026-08-13) ───────────────────────────────
 *
 * Owner request, verbatim: *"allow selection of items lick clicking 1
 * highlights it and holding ctrl allows multiple selection. put a switch at top
 * of branding page that when on allows real time drag and drop editing of the
 * ui. if i drag a logo or banner and drop on logo or banner or icon it will hot
 * render it but not save. if changes are made but not saved display a note and
 * button to save edits. if the edit is made to a toolbar banner or nav menu
 * then save it as a new asset with a name user is prompted for and then change
 * the layout to render the new asset instead of old one"*.
 *
 * Three separate things, and it is worth naming which is which:
 *
 *   - **Selection** is this page's own state. Every drawing is a tile you can
 *     click to highlight and Ctrl/⌘-click to add to a set. It changes nothing
 *     about the app — it is how you hold a group of marks in view while judging
 *     them, which is what a gallery is for.
 *   - **The switch** arms the DROP ZONES, which are not on this page at all:
 *     they are on the real banner above it and the real nav menu beside it, put
 *     there by core's `GlyphDropZone`. That is the whole point — you drag a
 *     drawing out of the gallery and onto the running chrome, and the chrome
 *     repaints. Dropping is deliberately permissive: any drawing may be dropped
 *     on any slot, because "an icon in the banner" is a judgement call and not
 *     an error.
 *   - **Saving** derives a NEW toolbar / nav asset from the one you dropped on
 *     and repoints the theme's chrome dial at it — see `derive-assets.ts` for
 *     why a new asset rather than an edit in place.
 *
 * The pending edits live in core (`brand/edits.tsx`) rather than here, because
 * the renderers that have to honour them are core's. What lives here is the
 * gesture, the note, and the commit.
 */
"use client";

import * as React from "react";

import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import CardHeader from "@mui/material/CardHeader";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import {
  brandEdits,
  brandEditKey,
  checkCoverage,
  Glyph,
  packs,
  REQUIRED_GLYPHS,
  setGlyphDrag,
  theme as themeStore,
  token,
  useBrandEdits,
  useNavMenus,
  useResolvedStyle,
  useToolbars
} from "@axf/core";
import type {
  AnyPackage,
  BrandEdit,
  CoverageReport,
  NavMenuAsset,
  PackageKind,
  ResolvedStyle,
  ToolbarAsset
} from "@axf/core";

import { useChromeDoc } from "../../chrome/useChromeDoc";
import { CHROME_DIAL, deriveNav, deriveToolbar, groupBrandEdits, uniqueChromeId } from "./derive-assets";
import type { EditGroup } from "./derive-assets";
import {
  FIXED_SECTIONS,
  GALLERY_AREA,
  categorySectionId,
  galleryView,
  setPresentSections,
  syncGalleryView
} from "./sections";

/** The gallery's readout voice — mono, small, tight. An `sx` fragment rather
 *  than a `CSSProperties` object, so it composes with everything else here and
 *  reaches the theme the way an inline style cannot. */
const M = {
  fontFamily: token("mono"),
  fontSize: 11,
  lineHeight: 1.35
} as const;

const ROLES = ["accent", "accent2", "accent3", "ink", "dim", "edge", "page", "ok", "warn", "err"] as const;

/**
 * One section pane.
 *
 * `section` is what makes it collapsible and hideable: it names the row in
 * `galleryView` that owns this pane's two states. A card without one is a plain
 * card that is always open — nothing here requires every caller to opt in, and
 * the `LiveEditCard` used to be exactly that before it got an id.
 *
 * Collapsing folds the BODY and keeps the header, so the pane can be reopened
 * where it sits. Hiding removes the pane entirely and is the View menu's job —
 * a pane cannot hide itself, because the control to bring it back would go with
 * it.
 */
function GalleryCard({
  title,
  action,
  section,
  children
}: {
  title: string;
  action?: React.ReactNode;
  section?: string;
  children: React.ReactNode;
}) {
  const view = React.useSyncExternalStore(
    galleryView.subscribe,
    galleryView.getState,
    galleryView.getServerState
  );
  const collapsed = section ? view.collapsed.has(section) : false;

  return (
    <Card
      elevation={0}
      data-axf-gallery-section={section}
      sx={{
        border: `var(--axf-border) solid ${token("edge")}`,
        borderRadius: "var(--axf-radius)",
        background: token("panel"),
        backgroundImage: "none",
        overflow: "hidden"
      }}
    >
      <CardHeader
        title={title}
        action={
          <Stack direction="row" sx={{ alignItems: "center", gap: "4px" }}>
            {action}
            {section && (
              <Tooltip title={collapsed ? "Expand this pane" : "Collapse this pane"}>
                <IconButton
                  size="small"
                  aria-label={`${collapsed ? "Expand" : "Collapse"} ${title}`}
                  aria-expanded={!collapsed}
                  onClick={() => galleryView.toggleCollapsed(section)}
                  sx={{ padding: "2px", color: token("dim") }}
                >
                  <Glyph id={collapsed ? "icon-chevron-down" : "icon-chevron-up"} size={12} />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        }
        sx={{
          padding: "5px 10px",
          background: token("panel2"),
          borderBottom: collapsed ? "none" : `1px solid ${token("edge")}`,
          "& .MuiCardHeader-action": { margin: 0, alignSelf: "center" }
        }}
        slotProps={{
          title: {
            sx: {
              ...M,
              fontSize: 9.5,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: token("dim")
            }
          }
        }}
      />
      {/* Unmounted rather than hidden with CSS: a collapsed catalogue pane holds
          hundreds of live <Glyph> subscriptions, and paying for them behind
          `display: none` is the kind of cost that only shows up as a sluggish
          theme roll nobody can attribute. */}
      {!collapsed && (
        <CardContent sx={{ padding: "12px", "&:last-child": { paddingBottom: "12px" } }}>
          {children}
        </CardContent>
      )}
    </Card>
  );
}

/** Swatch row drawn from an explicit palette, so an inactive pack still shows. */
function Palette({ palette }: { palette: Record<string, string> }) {
  return (
    <Stack direction="row" sx={{ gap: "3px", flexWrap: "wrap" }}>
      {ROLES.map((role) => {
        const value = palette[role];
        if (!value) return null;
        return (
          <Tooltip key={role} title={`${role} · ${value}`}>
            <Box sx={{ textAlign: "center" }}>
              <Box
                sx={{
                  width: 34,
                  height: 22,
                  background: value,
                  border: `1px solid ${token("edge")}`,
                  borderRadius: "3px"
                }}
              />
              <Typography sx={{ ...M, fontSize: 8.5, color: token("dim"), marginTop: "2px" }}>
                {role}
              </Typography>
            </Box>
          </Tooltip>
        );
      })}
    </Stack>
  );
}

/** The one dot shape the gallery uses for a binary state, so "good" looks the
 *  same in the coverage card as it does in the standalone-pack list. */
function Dot({ colour }: { colour: string }) {
  return (
    <Box sx={{ width: 6, height: 6, borderRadius: "50%", background: colour, flexShrink: 0 }} />
  );
}

function CoverageRow({ report, label }: { report: CoverageReport; label: string }) {
  const bad = [
    ...report.missingRequired.map((id: string) => `missing ${id}`),
    ...report.wrongAspect.map(
      (w: { id: string; expected: number; actual: number }) =>
        `${w.id} is ${w.actual}:1, slot is ${w.expected}:1`
    ),
    // A required drawing that is supplied but cannot be measured is a fault
    // with a name, not a silent pass — see CoverageReport.uncheckable.
    ...report.uncheckable.map((id: string) => `${id} has no measurable svg`)
  ];
  return (
    <Stack direction="row" sx={{ gap: "8px", alignItems: "baseline", ...M, padding: "2px 0" }}>
      <Dot colour={report.complete ? token("ok") : token("err")} />
      <Typography sx={{ ...M, minWidth: 150 }}>{label}</Typography>
      <Typography sx={{ ...M, color: report.complete ? token("ok") : token("err"), fontSize: 10 }}>
        {report.complete ? "complete" : `${bad.length} fault${bad.length === 1 ? "" : "s"}`}
      </Typography>
      <Typography sx={{ ...M, color: token("dim"), fontSize: 10 }}>
        {bad.length ? bad.join(" · ") : ""}
        {report.missingOptional.length
          ? `${bad.length ? " · " : ""}optional absent: ${report.missingOptional.join(", ")}`
          : ""}
        {report.extra.length ? ` · ${report.extra.length} extra (nothing renders them)` : ""}
      </Typography>
    </Stack>
  );
}

/* ---------------------------------------------- selection and live editing */

/**
 * The gallery's selection and drag state, shared with the tiles.
 *
 * A context rather than props because a tile is rendered from four places on
 * this page (the identity row, the catalog, and both at two sizes), and
 * threading three arguments through each of them is how one of them ends up
 * with a stale copy of the selection.
 */
interface GalleryEdit {
  readonly editing: boolean;
  readonly selected: ReadonlySet<string>;
  /** `additive` is Ctrl/⌘ held: toggle within the set instead of replacing it. */
  readonly select: (id: string, additive: boolean) => void;
}

const GalleryEditCtx = React.createContext<GalleryEdit | null>(null);

/** Stable empty set — a fresh one per render would re-render every tile. */
const NO_SELECTION: ReadonlySet<string> = new Set<string>();

/**
 * One drawing, selectable and — once the switch is on — draggable.
 *
 * `ButtonBase` rather than a `<div onClick>` for the reason the pack cards were
 * converted for: this is a real control with a real state, so it has to be
 * reachable from a keyboard and it has to ANNOUNCE that state (`aria-pressed`).
 * A selection painted as a border and nothing else is a selection a screen
 * reader cannot see.
 *
 * A drag always carries the tile you GRABBED, even when several are selected.
 * Dropping four drawings onto one slot has no meaning, and the alternative —
 * silently using the first of the set — would make the gesture unpredictable.
 */
function SelectableGlyph({
  id,
  size,
  label,
  minWidth
}: {
  id: string;
  size: number | string;
  label: string;
  minWidth?: number;
}) {
  const ctx = React.useContext(GalleryEditCtx);
  const on = ctx?.selected.has(id) ?? false;
  const editing = ctx?.editing ?? false;
  return (
    <ButtonBase
      focusRipple
      draggable={editing}
      onDragStart={(event) => setGlyphDrag(event, id)}
      onClick={(event) => ctx?.select(id, event.ctrlKey || event.metaKey)}
      aria-pressed={on}
      title={editing ? `${id} — drag onto the banner or the nav menu` : id}
      data-axf-glyph-tile={id}
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: "3px",
        padding: "5px",
        minWidth,
        borderRadius: "var(--axf-radius-tight)",
        border: `1px solid ${on ? token("accent") : "transparent"}`,
        background: on ? token("panel2") : "transparent",
        cursor: editing ? "grab" : "pointer"
      }}
    >
      <Box
        sx={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 40 }}
      >
        <Glyph id={id} size={size} />
      </Box>
      <Typography
        sx={{ ...M, fontSize: 8.5, color: on ? token("accent") : token("dim") }}
      >
        {label}
      </Typography>
    </ButtonBase>
  );
}

/** One pending edit, said in full, with the way back out of it. */
function PendingRow({ edit }: { edit: BrandEdit }) {
  return (
    <Stack direction="row" sx={{ gap: "8px", alignItems: "center", ...M, fontSize: 10 }}>
      <Dot colour={token("warn")} />
      <Typography sx={{ ...M, fontSize: 10, minWidth: 210 }}>
        {edit.kind === "toolbar" ? "banner" : "nav menu"} · {edit.asset} · {edit.item}
      </Typography>
      <Typography sx={{ ...M, fontSize: 10, color: token("dim") }}>
        {edit.was ?? "(none)"} →
      </Typography>
      <Glyph id={edit.glyph} size={14} />
      <Typography sx={{ ...M, fontSize: 10, color: token("ink") }}>{edit.glyph}</Typography>
      <Box sx={{ flex: 1 }} />
      <Button
        size="small"
        onClick={() => brandEdits.revert(edit)}
        sx={{ ...M, fontSize: 9, minWidth: 0, padding: "0 5px", textTransform: "none" }}
      >
        revert
      </Button>
    </Stack>
  );
}

/**
 * The switch, the selection readout, and the unsaved-edits note.
 *
 * It owns the commit because it owns the two things a commit needs — the chrome
 * document and the registries — and because a save that fails has to say so
 * exactly where the Save button was.
 */
function LiveEditCard({
  selectedCount,
  onClearSelection
}: {
  selectedCount: number;
  onClearSelection: () => void;
}) {
  const { editing, edits } = useBrandEdits();
  const toolbarSnapshot = useToolbars();
  const navSnapshot = useNavMenus();
  const { doc, save, loaded } = useChromeDoc();

  const groups = React.useMemo(() => groupBrandEdits(edits), [edits]);
  const [names, setNames] = React.useState<Record<string, string> | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  /** The registered asset a group's edits were made against. */
  const sourceOf = React.useCallback(
    (group: EditGroup): ToolbarAsset | NavMenuAsset | null =>
      group.kind === "toolbar"
        ? (toolbarSnapshot.all.find((a) => a.id === group.assetId) ?? null)
        : (navSnapshot.all.find((a) => a.id === group.assetId) ?? null),
    [toolbarSnapshot.all, navSnapshot.all]
  );

  const openPrompt = () => {
    setProblem(null);
    setNames(
      Object.fromEntries(
        groups.map((group) => [group.key, `${sourceOf(group)?.title ?? group.assetId} (edited)`])
      )
    );
  };

  const commit = async () => {
    if (!names) return;
    setSaving(true);
    setProblem(null);
    try {
      // Every id in play, from BOTH sources: a clash with a built-in throws out
      // of the registry, and a clash with a stored custom asset would overwrite
      // a bar somebody saved. See `uniqueChromeId`.
      const taken = new Set<string>([
        ...toolbarSnapshot.all.map((a) => a.id),
        ...navSnapshot.all.map((a) => a.id),
        ...doc.toolbars.map((a) => a.id),
        ...doc.navs.map((a) => a.id)
      ]);
      let next = doc;
      const dials: [string, string][] = [];

      for (const group of groups) {
        const source = sourceOf(group);
        if (!source) {
          throw new Error(`“${group.assetId}” is no longer registered — its edits cannot be saved`);
        }
        const name = (names[group.key] ?? "").trim();
        if (!name) throw new Error("every edited asset needs a name");
        const id = uniqueChromeId(name, taken);
        taken.add(id);
        if (group.kind === "toolbar") {
          const derived = deriveToolbar(source as ToolbarAsset, name, id, group.edits);
          next = { ...next, toolbars: [...next.toolbars, derived] };
        } else {
          const derived = deriveNav(source as NavMenuAsset, name, id, group.edits);
          next = { ...next, navs: [...next.navs, derived] };
        }
        dials.push([CHROME_DIAL[group.kind], id]);
      }

      // `save` registers before it awaits the mirror, so the dial below can
      // name the new asset whatever the network does.
      const ok = await save(next);
      for (const [dial, id] of dials) themeStore.setValue(dial, id);
      // The overrides are baked into the asset now — leaving them applied would
      // mean the same substitution counted twice.
      brandEdits.clear();
      setNames(null);
      setProblem(
        ok
          ? null
          : "the new assets are registered and in force, but the server mirror failed — they will not survive a reload"
      );
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <GalleryCard
      section="live-edit"
      title="live edit · drag a drawing onto the app's own chrome"
      action={
        <FormControlLabel
          sx={{ margin: 0 }}
          control={
            <Switch
              size="small"
              checked={editing}
              onChange={(_, on) => brandEdits.setEditing(on)}
              slotProps={{ input: { "aria-label": "drag and drop UI editing" } }}
            />
          }
          label={
            <Typography sx={{ ...M, fontSize: 10, color: editing ? token("accent") : token("dim") }}>
              drag &amp; drop UI editing
            </Typography>
          }
        />
      }
    >
      <Stack sx={{ gap: "8px" }}>
        <Typography sx={{ ...M, fontSize: 10, color: token("dim"), lineHeight: 1.5 }}>
          Click a drawing to highlight it; hold Ctrl (⌘) to select more than one. With the switch
          on, every drawing here is draggable and the app&apos;s <strong>banner</strong> and{" "}
          <strong>nav menu</strong> become drop targets — drop a logo on the banner&apos;s mark, or
          an icon on a nav item, and it repaints at once. Nothing is written until you save.
        </Typography>

        {selectedCount > 0 && (
          <Stack direction="row" sx={{ gap: "8px", alignItems: "center" }}>
            <Typography sx={{ ...M, fontSize: 10, color: token("accent") }}>
              {selectedCount} selected
            </Typography>
            <Button
              size="small"
              onClick={onClearSelection}
              sx={{ ...M, fontSize: 9, minWidth: 0, padding: "0 6px", textTransform: "none" }}
            >
              clear
            </Button>
          </Stack>
        )}

        {problem && (
          <Alert severity="error" sx={{ ...M, fontSize: 10, py: 0 }}>
            {problem}
          </Alert>
        )}

        {edits.length > 0 && (
          <Alert
            severity="warning"
            sx={{ ...M, fontSize: 10 }}
            action={
              <Stack direction="row" sx={{ gap: "6px" }}>
                <Button size="small" onClick={() => brandEdits.clear()} sx={{ textTransform: "none" }}>
                  Discard
                </Button>
                <Tooltip
                  title={
                    loaded
                      ? "Save each edited bar or menu as a new asset and point the theme at it"
                      : "Waiting for the saved chrome assets to load — saving now would overwrite them"
                  }
                >
                  <span>
                    <Button
                      size="small"
                      variant="contained"
                      disabled={!loaded}
                      onClick={openPrompt}
                      sx={{ textTransform: "none" }}
                    >
                      Save edits
                    </Button>
                  </span>
                </Tooltip>
              </Stack>
            }
          >
            <AlertTitle sx={{ ...M, fontSize: 11, marginBottom: "4px" }}>
              {edits.length} unsaved edit{edits.length === 1 ? "" : "s"} — rendered, not saved
            </AlertTitle>
            <Stack sx={{ gap: "2px" }}>
              {edits.map((edit) => (
                <PendingRow key={brandEditKey(edit)} edit={edit} />
              ))}
            </Stack>
          </Alert>
        )}
      </Stack>

      <Dialog open={names !== null} onClose={() => !saving && setNames(null)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ ...M, fontSize: 13 }}>Name the new asset</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ ...M, fontSize: 10, marginBottom: "12px" }}>
            A bar you dropped on is not edited in place — the built-ins are code, and a custom one
            may be in use elsewhere. Each edited asset is saved as a NEW one under the name you give
            it, and the theme&apos;s chrome dial is repointed at it.
          </DialogContentText>
          <Stack sx={{ gap: "12px" }}>
            {names !== null &&
              groups.map((group) => (
                <TextField
                  key={group.key}
                  size="small"
                  fullWidth
                  autoFocus={group === groups[0]}
                  label={`${group.kind === "toolbar" ? "Banner" : "Nav menu"} derived from ${group.assetId}`}
                  helperText={`${group.edits.length} drawing${group.edits.length === 1 ? "" : "s"} replaced`}
                  value={names[group.key] ?? ""}
                  onChange={(event) =>
                    setNames({ ...names, [group.key]: event.target.value })
                  }
                />
              ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNames(null)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={() => void commit()} disabled={saving}>
            {saving ? "Saving…" : "Save and use"}
          </Button>
        </DialogActions>
      </Dialog>
    </GalleryCard>
  );
}

export default function BrandGallery() {
  const style = useResolvedStyle();
  const [catalog, setCatalog] = React.useState<AnyPackage[]>([]);
  const [zoom, setZoom] = React.useState(1);
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(NO_SELECTION);
  const { editing } = useBrandEdits();

  React.useEffect(() => setCatalog(packs.packs()), [style]);

  const select = React.useCallback((id: string, additive: boolean) => {
    setSelected((current) => {
      if (!additive) return current.size === 1 && current.has(id) ? current : new Set([id]);
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next.size ? next : NO_SELECTION;
    });
  }, []);

  const clearSelection = React.useCallback(() => setSelected(NO_SELECTION), []);

  // Escape clears, from anywhere on the page. A selection you cannot get out of
  // without hunting for a button is one people stop making.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(NO_SELECTION);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const editCtx = React.useMemo<GalleryEdit>(
    () => ({ editing, selected, select }),
    [editing, selected, select]
  );

  const brandings = catalog.filter((p) => p.type === "branding-package");
  const logos = catalog.filter((p) => p.type === "logo-package");

  // Glyphs grouped by category, so lockups are not mixed in with icons.
  const entries = [...style.glyphs.values()];
  const byCategory = entries.reduce<Record<string, typeof entries>>((acc, e) => {
    (acc[e.category] ??= []).push(e);
    return acc;
  }, {});

  const categories = Object.keys(byCategory).sort((a, b) => a.localeCompare(b));

  // Which panes this pack actually produces, in page order — what the View
  // submenu lists, and what its `when` predicates read.
  const presentIds = React.useMemo(
    () => [
      ...FIXED_SECTIONS.map((s) => s.id),
      ...categories.map((c) => categorySectionId(c))
    ],
    [categories.join(" ")]
  );

  // The submenu's rows are contributed once per runtime (the map is
  // append-only — see sections.ts); the PRESENT set is refreshed every time the
  // catalogue changes, which is what keeps a pack swap honest.
  React.useEffect(() => {
    setPresentSections(presentIds);
    syncGalleryView();
  }, [presentIds]);

  const view = React.useSyncExternalStore(
    galleryView.subscribe,
    galleryView.getState,
    galleryView.getServerState
  );
  const shown = React.useCallback((id: string) => !view.hidden.has(id), [view]);

  // No `overflow` on the root: NavShell's <main> is the one scroll container,
  // and a tall page scrolls THERE. An overflow of its own turns this grid into
  // a flex item whose automatic min-height is 0, so it silently shrinks to the
  // viewport instead of overflowing main — which is exactly how the gallery
  // shipped with everything below the fold unreachable.
  return (
      <GalleryEditCtx.Provider value={editCtx}>
      {/* The ctx area the View submenu lives in. Declared on
          `brand-gallery.decl.ts`; marked here, which is the half the
          conformance gate checks — and written as a LITERAL rather than as the
          `GALLERY_AREA` constant, because that gate reads markers statically
          off the source and reports a computed one as unreadable. The constant
          is still the single source for the contribute call in `sections.ts`;
          `test/ctx-conformance.test.ts` is what holds the two equal. */}
      <Stack data-axf-area="brand-gallery.surface" sx={{ padding: "14px", gap: "12px" }}>
        {/* Every pane hidden at once would leave a blank page with no way back
            except the menu — which is exactly where the way back is, but a
            reader who hid them one at a time deserves to be told. */}
        {presentIds.every((id) => !shown(id)) && (
          <Alert severity="info" variant="outlined" sx={{ ...M }}>
            Every pane is hidden. Right-click → View to bring them back.
          </Alert>
        )}

        {/* --------------------------------- the switch, the note, the commit */}
        {shown("live-edit") && (
          <LiveEditCard selectedCount={selected.size} onClearSelection={clearSelection} />
        )}

        {/* ------------------------------------------------ identity, large */}
        {shown("identity") && (
        <GalleryCard
          section="identity"
          title={`identity in force · ${style.brandingId ?? "none"}`}
          action={
            <ToggleButtonGroup
              exclusive
              size="small"
              value={zoom}
              onChange={(_, next: number | null) => next !== null && setZoom(next)}
              aria-label="glyph zoom"
              sx={{
                "& .MuiToggleButton-root": {
                  ...M,
                  padding: "1px 7px",
                  border: `1px solid ${token("edge")}`,
                  borderRadius: "3px",
                  color: token("dim"),
                  "&.Mui-selected": {
                    background: token("accent"),
                    borderColor: token("accent"),
                    color: token("page"),
                    "&:hover": { background: token("accent") }
                  }
                }
              }}
            >
              {[0.5, 1, 2].map((z) => (
                <ToggleButton key={z} value={z}>
                  {z}×
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          }
        >
          {/* Each figure is a tile: selectable, and draggable onto the chrome
              once the switch is on. `size` is the WIDTH and Glyph derives the
              height from the drawing's own viewBox — pinning both is what made
              every lockup render at 200px regardless of what was asked for. */}
          <Stack direction="row" sx={{ gap: "18px", alignItems: "flex-end", flexWrap: "wrap" }}>
            <SelectableGlyph id="mark" label="mark" size={96 * zoom} />
            <SelectableGlyph id="lockup" label="lockup" size={340 * zoom} />
            <SelectableGlyph id="wordmark" label="wordmark" size={190 * zoom} />
            <SelectableGlyph id="spinner" label="spinner" size={44 * zoom} />
          </Stack>

          <SelectionStrip style={style} />

          {/* Scale ladder — the test a mark actually has to pass. */}
          <Box sx={{ marginTop: "16px", paddingTop: "12px", borderTop: `1px solid ${token("edge")}` }}>
            <Typography sx={{ ...M, color: token("dim"), marginBottom: "6px" }}>
              scale ladder — favicon to header. A mark that dies at 16px is not finished.
            </Typography>
            <Stack direction="row" sx={{ gap: "18px", alignItems: "flex-end" }}>
              {[16, 24, 32, 48, 64, 96].map((s) => (
                <Box key={s} sx={{ textAlign: "center" }}>
                  <Glyph id="mark" size={s} />
                  <Typography sx={{ ...M, fontSize: 8.5, color: token("dim") }}>{s}</Typography>
                </Box>
              ))}
            </Stack>
          </Box>
        </GalleryCard>
        )}

        {/* ------------------------------------------------------- coverage */}
        {/* `checkCoverage` existed and was called by nothing, which meant no
            pack's completeness had ever actually been checked — the exact hole
            the contract was written to close. It reports rather than throws, so
            an in-progress identity still loads and still shows here. Coverage is
            a property of the IDENTITY IN FORCE (branding + logos merged) — the
            per-style-package rows died with the style-package kind. */}
        {shown("coverage") && (
        <GalleryCard section="coverage" title={`coverage · ${REQUIRED_GLYPHS.length} required drawings`}>
          <CoverageRow
            label="↳ in force"
            report={checkCoverage(style.brandingId ?? "none", [...style.glyphs.values()])}
          />
        </GalleryCard>
        )}

        {/* ------------------------------------------------ pack candidates */}
        {/* Selection itself moved to /settings (branding is a fixed app setting,
            2026-08-12). The gallery keeps a click-to-activate list because it is
            the surface the recolour probe drives, but the styled compare cards
            went with the style-package kind. */}
        {shown("packs") && (
        <GalleryCard
          section="packs"
          title={`packs · ${brandings.length} branding · ${logos.length} logo · select at /settings`}
        >
          <Box
            sx={{
              display: "grid",
              gap: "10px",
              gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))"
            }}
          >
            {brandings.map((p) => {
              const active = style.brandingId === p.id;
              const palette = (p.payload as { palette?: Record<string, string> }).palette ?? {};
              return (
                <Card
                  key={p.id}
                  elevation={0}
                  sx={{
                    border: `1px solid ${active ? token("accent") : token("edge")}`,
                    borderRadius: "var(--axf-radius-tight)",
                    background: token("panel"),
                    backgroundImage: "none"
                  }}
                >
                  <CardActionArea
                    // Addressable for the recolour probe, and for nothing else —
                    // it activates a pack through the surface's own control
                    // rather than by reaching into the registry.
                    data-axf-pack={p.id}
                    onClick={() => packs.activate(p.id)}
                    aria-pressed={active}
                    sx={{ padding: "10px" }}
                  >
                    <Stack
                      direction="row"
                      sx={{ alignItems: "baseline", gap: "6px", marginBottom: "8px" }}
                    >
                      <Typography sx={{ ...M, fontWeight: 700 }}>{p.name}</Typography>
                      {active && (
                        <Typography sx={{ ...M, fontSize: 9, color: token("accent") }}>
                          active
                        </Typography>
                      )}
                    </Stack>
                    <Palette palette={palette} />
                    <Typography
                      sx={{ ...M, fontSize: 9.5, color: token("dim"), marginTop: "7px", lineHeight: 1.4 }}
                    >
                      {p.description}
                    </Typography>
                  </CardActionArea>
                </Card>
              );
            })}
          </Box>
        </GalleryCard>
        )}

        {/* --------------------------------------------------- glyph catalog */}
        {categories
          .filter((category) => shown(categorySectionId(category)))
          .map((category) => (
            <GalleryCard
              key={category}
              section={categorySectionId(category)}
              title={`${category} · ${byCategory[category].length}`}
            >
              <Stack direction="row" sx={{ gap: "14px", flexWrap: "wrap", alignItems: "flex-end" }}>
                {byCategory[category]
                  .slice()
                  .sort((a, b) => a.id.localeCompare(b.id))
                  .map((g) => (
                    <SelectableGlyph
                      key={g.id}
                      id={g.id}
                      label={g.id.replace(/^icon-/, "")}
                      size={category === "icon" ? 30 : 150}
                      minWidth={54}
                    />
                  ))}
              </Stack>
            </GalleryCard>
          ))}

        {/* ------------------------------------------------- standalone packs */}
        {shown("standalone") && (
        <GalleryCard
          section="standalone"
          title={`standalone packs · ${brandings.length} branding · ${logos.length} logo`}
        >
          <List dense disablePadding sx={{ display: "grid", gap: "4px" }}>
            {[...brandings, ...logos].map((p) => {
              const active = style.brandingId === p.id || style.logoId === p.id;
              return (
                <ListItemButton
                  key={p.id}
                  selected={active}
                  onClick={() => packs.activate(p.id)}
                  sx={{
                    gap: "8px",
                    alignItems: "center",
                    padding: "3px 6px",
                    borderRadius: "3px",
                    ...M,
                    "&.Mui-selected": { background: token("panel2") }
                  }}
                >
                  <Dot colour={active ? token("ok") : token("edge")} />
                  <Typography sx={{ ...M, minWidth: 150 }}>{p.id}</Typography>
                  <Typography sx={{ ...M, color: token("dim"), fontSize: 10 }}>{p.type}</Typography>
                  <Box sx={{ flex: 1 }} />
                </ListItemButton>
              );
            })}
          </List>
        </GalleryCard>
        )}

        {/* --------------------------------------------- published variables */}
        {shown("variables") && (
        <GalleryCard
          section="variables"
          title={`published role variables · ${Object.keys(style.variables).length}`}
        >
          <Box
            sx={{
              display: "grid",
              gap: "2px",
              gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))"
            }}
          >
            {Object.entries(style.variables).map(([name, value]) => (
              <Stack key={name} direction="row" sx={{ gap: "6px", alignItems: "center", ...M }}>
                <Box
                  sx={{
                    width: 11,
                    height: 11,
                    borderRadius: "2px",
                    border: `1px solid ${token("edge")}`,
                    background: value,
                    flexShrink: 0
                  }}
                />
                <Typography sx={{ ...M, color: token("dim"), fontSize: 10 }}>{name}</Typography>
                <Box sx={{ flex: 1 }} />
                <Typography sx={{ ...M, color: token("ink"), fontSize: 10 }}>{value}</Typography>
              </Stack>
            ))}
          </Box>
        </GalleryCard>
        )}
    </Stack>
    </GalleryEditCtx.Provider>
  );
}

/** The two slots, in the order they resolve, with a name a person can read. */
const SLOT_LABELS: ReadonlyArray<readonly [PackageKind, string]> = [
  ["branding-package", "branding"],
  ["logo-package", "logos"]
];

/**
 * Saved vs. default, said out loud.
 *
 * The selection now outlives the tab, which is only trustworthy if the surface
 * admits which state it is in. "Saved" with a way back is a preference; a click
 * that quietly becomes permanent with no way to undo it is a trap — and one
 * with no way back would opt a slot out of the app's own look forever, since
 * the console wrapper only offers its style as a default now.
 */
function SelectionStrip({ style }: { style: ResolvedStyle }) {
  const chosen = new Set<PackageKind>(style.chosen);
  const inForce: Record<PackageKind, string | null> = {
    "branding-package": style.brandingId,
    "logo-package": style.logoId
  };
  return (
    <Stack
      direction="row"
      sx={{
        marginTop: "14px",
        paddingTop: "10px",
        borderTop: `1px solid ${token("edge")}`,
        gap: "14px",
        alignItems: "center",
        flexWrap: "wrap",
        ...M
      }}
    >
      <Typography sx={{ ...M, color: token("dim"), fontSize: 9.5, letterSpacing: "0.09em" }}>
        SELECTION
      </Typography>
      {SLOT_LABELS.map(([slot, label]) => {
        const saved = chosen.has(slot);
        return (
          <Stack key={slot} direction="row" sx={{ alignItems: "center", gap: "5px" }}>
            <Typography sx={{ ...M, color: token("dim"), fontSize: 10 }}>{label}</Typography>
            <Typography sx={{ ...M, color: token("ink"), fontSize: 10 }}>
              {inForce[slot] ?? "—"}
            </Typography>
            {/* Deliberately NOT `Chip`: at 8.5px this is a state annotation on a
                readout line, and Chip's smallest size is a 24px pill that would
                set the height of the whole strip. Same paint, `Typography`. */}
            <Typography
              sx={{
                ...M,
                fontSize: 8.5,
                padding: "0 5px",
                borderRadius: "8px",
                border: `1px solid ${saved ? token("accent") : token("edge")}`,
                color: saved ? token("accent") : token("dim")
              }}
            >
              {saved ? "saved" : "app default"}
            </Typography>
            {saved && (
              <Tooltip
                title={`forget the saved ${label} selection and follow the app default again`}
              >
                <Button
                  size="small"
                  data-axf-reset={slot}
                  onClick={() => packs.clearChoice(slot)}
                  sx={{
                    ...M,
                    minWidth: 0,
                    fontSize: 9,
                    lineHeight: 1.35,
                    padding: "0 5px",
                    border: `1px solid ${token("edge")}`,
                    borderRadius: "3px",
                    color: token("dim"),
                    textTransform: "none"
                  }}
                >
                  reset
                </Button>
              </Tooltip>
            )}
          </Stack>
        );
      })}
      {/* A saved id whose pack no longer exists. Named, because the alternative
          is an identity that silently reverted and nobody can say why. */}
      {style.unresolved.map((id) => (
        <Typography key={id} sx={{ ...M, color: token("err"), fontSize: 10 }}>
          saved “{id}” is not registered — that slot fell back
        </Typography>
      ))}
    </Stack>
  );
}

/* `Figure` lived here and was deleted on 2026-08-13: the identity row's four
   drawings became `SelectableGlyph` tiles like every other drawing on the page,
   and a second wrapper that could only be looked at — not selected, not dragged
   — would have made the largest marks on the screen the only ones you cannot
   pick up. */
