/**
 * @file The DASHBOARD tab — the wrapper designer: build, roll, save, load and
 * apply dashboards.
 *
 * Owner request, 2026-08-12: *"make dashboard an asset… have a dashboard
 * designer that saves, loads, and applies dashboards. default matches theme
 * default but you can roll one with selected switches. make dials for every
 * available layout, display, and style option."*
 *
 * The moving parts, and who owns each — deliberately the same division the
 * Toolbar and Nav tabs already use, because this is the same surface a third
 * time and a third arrangement would be a third thing to learn:
 *
 *   - **candidates** — every registered wrapper: the built-ins (code, in
 *     `src/dashboards/`) plus the authored ones (data, in the chrome-assets
 *     document). A built-in offers no *Duplicate*: it is a `render` function,
 *     and there is nothing a record could copy out of it. *New dashboard* is
 *     the way in, and it starts from the theme default.
 *   - **selection** — the theme's `dashboard` dial. *Use in theme* is a dial
 *     edit like any other: the app repaints immediately and the header's
 *     *Apply to app* is what persists it, so a saved look carries its wrapper.
 *   - **the record** — `DashboardSpec`, saved into the same kv document the
 *     toolbars and menus live in, registered through the same `seedChromeAssets`
 *     the boot path uses.
 *
 * ## The two switches, which are the whole design
 *
 * Every dial — the wrapper's own and the theme's alike — carries a **roll**
 * switch. Off, it is greyed out, the roller ignores it and the wrapper falls
 * back to the dial's default. That is the mechanism behind "the default
 * matches the theme default": a wrapper with nothing switched on adds nothing.
 *
 * Theme dials carry a second, smaller **inherit** switch. A roll can produce a
 * whole palette; `inherit` decides which of it the THEME actually takes when
 * the dashboard is applied. Everything else stays inside the record. That is
 * what keeps the one-publisher rule intact: the wrapper never writes a
 * `--axf-*` variable, it asks the theme store to change a dial, once, visibly,
 * in the same override count every other edit lands in.
 *
 * ## No preview pane, on purpose
 *
 * The draft is registered live and selected in the theme while it is open, so
 * the REAL shell wraps this very screen as you turn a dial. That is a truer
 * preview than any thumbnail, and it is the reason `ToolbarTab` has no preview
 * pane either. Closing the editor puts the registry back the way it was.
 */
"use client";

import * as React from "react";

import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import {
  DASH_DIALS,
  Glyph,
  HARMONIES,
  dashDialsBySubsystem,
  dashName,
  dashboardFromSpec,
  dashboards,
  defaultDashValues,
  defineDashboardSpec,
  dialsBySubsystem,
  inheritedTheme,
  rollDash,
  rollTheme,
  seedFrom,
  theme as themeStore,
  useDashboards,
  useTheme
} from "@axf/core";
import type {
  DashSubsystem,
  DashboardSpec,
  Dial,
  DialSubsystem,
  Harmony,
  Mode,
  RollOptions
} from "@axf/core";

import { chromeSlug, CUSTOM_PREFIX } from "../../chrome/assets";
import { CandidateCard, useChromeDoc } from "./chrome-bits";
import DialControl from "./DialControl";
import { DashDialControl, DialRow, MONO } from "./dash-dials";

/** The harmony names, FROM the engine — never a hand-kept list. */
const HARMONY_IDS = Object.keys(HARMONIES) as Harmony[];

/**
 * The theme dials a dashboard may carry.
 *
 * Everything except the `chrome` subsystem, which is the three ASSET-id dials
 * (`bannerBar`, `navMenu`, `dashboard`). A wrapper carrying `dashboard` would
 * be a wrapper that can name a different wrapper on apply — a loop with no
 * reason to exist — and the other two are the Toolbar and Nav tabs' job.
 */
const THEME_GROUPS: [DialSubsystem, Dial[]][] = Object.entries(dialsBySubsystem())
  .filter(([subsystem]) => subsystem !== "chrome")
  .map(([subsystem, dials]) => [subsystem as DialSubsystem, dials]);

const DASH_GROUPS = dashDialsBySubsystem();
const DASH_SUBSYSTEMS = Object.keys(DASH_GROUPS) as DashSubsystem[];

/** The ids the roller understands, split by which engine rolls them. */
const DASH_IDS = new Set(DASH_DIALS.map((d) => d.id));

const heading = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

/** Immutable add/remove on the `active` / `inherit` id lists. */
function toggled(list: readonly string[], id: string, on: boolean): string[] {
  const set = new Set(list);
  if (on) set.add(id);
  else set.delete(id);
  return [...set];
}

/* ------------------------------------------------------------- the surface */

export default function DashboardTab() {
  const snapshot = useDashboards();
  const state = useTheme();
  const { doc, save, loaded } = useChromeDoc();

  /* The live theme, read through on every render. The dial rows show
     `draft.theme` layered over it, so a dial the dashboard says nothing about
     displays the value the theme currently has — which is exactly what an
     inactive dial resolves to. */
  const themeValues = state.values;
  const dialled = String(themeValues.dashboard ?? "").trim();

  const customIds = React.useMemo(
    () => new Set(doc.dashboards.map((d) => d.id)),
    [doc.dashboards]
  );
  /** `candidates()` sorts the registry default first — so this IS the default. */
  const registryDefault = snapshot.all[0]?.id ?? null;

  const [draft, setDraft] = React.useState<DashboardSpec | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [savedFlash, setSavedFlash] = React.useState(false);
  /** Dial ids the LAST roll actually produced — a readout, not state that
   *  changes behaviour. Cleared whenever a dial is turned by hand. */
  const [rolled, setRolled] = React.useState<ReadonlySet<string>>(new Set());

  /* --------------------------------------------------------- roll controls */

  const [seedText, setSeedText] = React.useState("");
  const [mode, setMode] = React.useState<Mode | "auto">("auto");
  const [harmony, setHarmony] = React.useState<Harmony | "auto">("auto");
  const [forceHue, setForceHue] = React.useState(false);
  const [hue, setHue] = React.useState(210);
  const counter = React.useRef(0);

  const options = React.useMemo<RollOptions>(() => {
    const out: RollOptions = {};
    if (mode !== "auto") (out as { mode?: Mode }).mode = mode;
    if (harmony !== "auto") (out as { harmony?: Harmony }).harmony = harmony;
    if (forceHue) (out as { hue?: number }).hue = hue;
    return out;
  }, [mode, harmony, forceHue, hue]);

  /*
   * The draft, registered LIVE.
   *
   * This is what makes the editor its own preview: the real shell resolves the
   * wrapper from the registry on every render, so upserting the draft repaints
   * the chrome around this screen as dials move. Nothing is persisted by it —
   * the registry is per-runtime memory, and `save` is what writes the document.
   */
  React.useEffect(() => {
    if (!draft) return;
    try {
      dashboards.upsert(dashboardFromSpec(draft));
    } catch {
      /* an invalid draft simply does not preview; `saveDraft` reports why */
    }
  }, [draft]);

  /** Put the registry back: the saved record, or nothing if it was never saved. */
  const closeDraft = React.useCallback(() => {
    if (draft) {
      const saved = doc.dashboards.find((d) => d.id === draft.id);
      if (saved) dashboards.upsert(dashboardFromSpec(saved));
      else {
        dashboards.remove(draft.id);
        // A dial still naming the dropped wrapper would silently fall back;
        // clearing it says so instead.
        if (dialled === draft.id) themeStore.setValue("dashboard", "");
      }
    }
    setDraft(null);
    setProblem(null);
    setRolled(new Set());
  }, [draft, doc.dashboards, dialled]);

  /* -------------------------------------------------------------- actions */

  /** Select a wrapper AND hand over whatever it says the theme should inherit. */
  const use = React.useCallback((spec: DashboardSpec | null, id: string) => {
    themeStore.setValue("dashboard", id);
    if (!spec) return;
    for (const [dialId, value] of Object.entries(inheritedTheme(spec))) {
      themeStore.setValue(dialId, value);
    }
  }, []);

  const freshId = React.useCallback(
    (base: string) => {
      let title = base;
      let id = chromeSlug(title);
      let n = 2;
      while (customIds.has(id)) {
        title = `${base} ${n}`;
        id = chromeSlug(title);
        n += 1;
      }
      return { id, title };
    },
    [customIds]
  );

  const create = React.useCallback(() => {
    const { id, title } = freshId("Dashboard");
    setDraft(
      defineDashboardSpec({
        id,
        title,
        description: "Matches the theme default — no dial active, so the wrapper adds nothing yet.",
        display: defaultDashValues(),
        theme: {},
        active: [],
        inherit: []
      })
    );
    setProblem(null);
    setRolled(new Set());
  }, [freshId]);

  const duplicate = React.useCallback(
    (spec: DashboardSpec) => {
      const { id, title } = freshId(`${spec.title.replace(/\s+\d+$/, "")} copy`);
      setDraft({ ...spec, id, title });
      setProblem(null);
    },
    [freshId]
  );

  const saveDraft = React.useCallback(async () => {
    if (!draft) return;
    try {
      const valid = defineDashboardSpec(draft);
      const rest = doc.dashboards.filter((d) => d.id !== valid.id);
      const ok = await save({ ...doc, dashboards: [...rest, valid] });
      setProblem(ok ? null : "saved locally, but the server mirror failed — it will not survive a reload");
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1600);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }, [draft, doc, save]);

  const remove = React.useCallback(
    async (id: string) => {
      await save({ ...doc, dashboards: doc.dashboards.filter((d) => d.id !== id) });
      dashboards.remove(id);
      if (dialled === id) themeStore.setValue("dashboard", "");
      if (draft?.id === id) setDraft(null);
    },
    [doc, save, dialled, draft]
  );

  /* ---------------------------------------------------------------- roll */

  const roll = React.useCallback(() => {
    if (!draft) return;
    const typed = seedText.trim();
    const seed = typed || seedFrom(`${Date.now()}:${counter.current++}`);

    // The DISPLAY half — the wrapper's own dials, from its own generator.
    const display = rollDash(seed, draft.active);

    // The THEME half — the engine's own roll, of which only the ACTIVE dials
    // are kept. Same seed, so one six-character string reproduces the whole
    // wrapper: chrome, palette and all.
    const themeRoll = rollTheme(seed, options);
    const theme: Record<string, string | number> = { ...draft.theme };
    for (const id of draft.active) {
      if (DASH_IDS.has(id)) continue;
      const value = themeRoll.values[id];
      if (value !== undefined) theme[id] = value;
    }

    setDraft({ ...draft, display, theme, seed, title: draft.title, description: draft.description });
    setRolled(new Set(draft.active));
  }, [draft, seedText, options]);

  /* -------------------------------------------------------------- editing */

  const setActive = React.useCallback((id: string, on: boolean) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            active: toggled(current.active, id, on),
            // Switching a dial off drops its inherit claim with it: a promise
            // to hand over a value nothing rolls is a promise about nothing.
            inherit: on ? current.inherit : toggled(current.inherit, id, false)
          }
        : current
    );
  }, []);

  const setInherit = React.useCallback((id: string, on: boolean) => {
    setDraft((current) => (current ? { ...current, inherit: toggled(current.inherit, id, on) } : current));
  }, []);

  const setDisplay = React.useCallback((id: string, value: string | number) => {
    setRolled(new Set());
    setDraft((current) =>
      current ? { ...current, display: { ...current.display, [id]: value } } : current
    );
  }, []);

  const setThemeDial = React.useCallback((id: string, value: string | number) => {
    setRolled(new Set());
    setDraft((current) => (current ? { ...current, theme: { ...current.theme, [id]: value } } : current));
  }, []);

  /** Every dial on, in one move — the "roll me a whole dashboard" gesture. */
  const setAll = React.useCallback(
    (which: "dash" | "theme", on: boolean) => {
      setDraft((current) => {
        if (!current) return current;
        const ids = which === "dash" ? [...DASH_IDS] : THEME_GROUPS.flatMap(([, d]) => d.map((x) => x.id));
        const active = new Set(current.active);
        for (const id of ids) {
          if (on) active.add(id);
          else active.delete(id);
        }
        const inherit = on ? current.inherit : current.inherit.filter((id) => !ids.includes(id));
        return { ...current, active: [...active], inherit };
      });
    },
    []
  );

  const activeSet = React.useMemo(() => new Set(draft?.active ?? []), [draft]);
  const inheritSet = React.useMemo(() => new Set(draft?.inherit ?? []), [draft]);
  const inheritCount = React.useMemo(
    () => (draft ? Object.keys(inheritedTheme(draft)).length : 0),
    [draft]
  );

  /* --------------------------------------------------------------- render */

  return (
    <Box
      sx={{
        display: "grid",
        gap: 2,
        alignItems: "start",
        gridTemplateColumns: { xs: "1fr", lg: "minmax(360px, 38%) 1fr" }
      }}
    >
      {/* -------------------------------------------------------- candidates */}
      <Stack spacing={1.5}>
        <Paper variant="outlined" sx={{ p: 1.5, display: "grid", gap: 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Glyph id="icon-layers" size={16} />
            <Typography variant="subtitle2">Dashboards</Typography>
            <Chip size="small" variant="outlined" label={snapshot.all.length} sx={{ ...MONO, height: 18 }} />
            <Box sx={{ flex: 1 }} />
            <Button size="small" variant="outlined" disabled={!dialled} onClick={() => themeStore.setValue("dashboard", "")}>
              Use app default
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            The theme decides which wrapper frames the screen. Picking one repaints the app now; the
            header&apos;s <strong>Apply to app</strong> saves it, and a saved look restores it.
          </Typography>
          <Divider />

          {snapshot.all.map((asset) => {
            const spec = doc.dashboards.find((d) => d.id === asset.id) ?? null;
            const saved = customIds.has(asset.id);
            // An unsaved draft is registered live (that is the preview), so it
            // appears here BEFORE it is in the document. It is authored either
            // way, and labelling it "built-in" because the file has not been
            // written yet reads as "this is code" about the thing being edited.
            const custom = saved || draft?.id === asset.id;
            return (
              <CandidateCard
                key={asset.id}
                id={asset.id}
                title={asset.title}
                description={asset.description}
                custom={custom}
                inTheme={dialled === asset.id}
                registryDefault={!dialled && registryDefault === asset.id}
                editing={draft?.id === asset.id}
                onUse={() => use(spec, asset.id)}
                onEdit={spec ? () => { setDraft(spec); setProblem(null); setRolled(new Set()); } : undefined}
                // A built-in is a `render` function — there is nothing a record
                // could copy out of it, so it offers no Duplicate at all rather
                // than one that quietly produces an unrelated wrapper.
                onDuplicate={spec ? () => duplicate(spec) : undefined}
                onDelete={saved ? () => void remove(asset.id) : undefined}
              />
            );
          })}

          <Button size="small" variant="contained" onClick={create} startIcon={<Glyph id="icon-sparkle" size={14} />}>
            New dashboard
          </Button>
          {!loaded ? (
            <Typography variant="caption" color="text.secondary">
              Loading saved dashboards…
            </Typography>
          ) : null}
        </Paper>

        {/* ----------------------------------------------------- the roller */}
        {draft ? (
          <Paper variant="outlined" sx={{ p: 1.5, display: "grid", gap: 1.5 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Glyph id="icon-sparkle" size={16} />
              <Typography variant="subtitle2">Roll this dashboard</Typography>
              <Box sx={{ flex: 1 }} />
              <Chip size="small" variant="outlined" label="model-free · deterministic" sx={{ ...MONO, height: 19 }} />
            </Stack>

            <Typography variant="caption" color="text.secondary">
              A roll touches <strong>only the dials you switched on</strong>. Everything greyed out
              keeps the theme&apos;s value, so a dashboard with nothing on is the theme default with
              a name. One seed rolls both halves — the wrapper&apos;s chrome and the theme dials it
              carries — so six characters reproduce the whole thing.
            </Typography>

            <TextField
              size="small"
              fullWidth
              label="Seed"
              placeholder="leave empty for a fresh seed"
              value={seedText}
              onChange={(e) => setSeedText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") roll();
              }}
              helperText={draft.seed ? `last roll: ${draft.seed} — ${dashName(draft.seed)}` : "never rolled"}
              slotProps={{ input: { sx: MONO } }}
            />

            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Typography variant="caption" sx={{ color: "text.secondary", minWidth: 44 }}>
                Mode
              </Typography>
              <ToggleButtonGroup
                size="small"
                exclusive
                fullWidth
                value={mode}
                onChange={(_, v: Mode | "auto" | null) => v && setMode(v)}
              >
                <ToggleButton value="auto">Auto</ToggleButton>
                <ToggleButton value="dark">Dark</ToggleButton>
                <ToggleButton value="light">Light</ToggleButton>
              </ToggleButtonGroup>
            </Stack>

            <FormControl size="small" fullWidth>
              <InputLabel id="axs-dash-harmony">Harmony</InputLabel>
              <Select
                labelId="axs-dash-harmony"
                label="Harmony"
                value={harmony}
                onChange={(e) => setHarmony(e.target.value as Harmony | "auto")}
              >
                <MenuItem value="auto">Auto — the seed decides</MenuItem>
                {HARMONY_IDS.map((id) => (
                  <MenuItem key={id} value={id}>
                    {id}
                    <Typography component="span" sx={{ ...MONO, ml: 1, color: "text.secondary" }}>
                      {HARMONIES[id].map((deg) => `${deg > 0 ? "+" : ""}${deg}°`).join(" ")}
                    </Typography>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Box>
              <FormControlLabel
                control={<Switch size="small" checked={forceHue} onChange={(_, v) => setForceHue(v)} />}
                label={<Typography variant="caption">Force base hue{forceHue ? ` — ${hue}°` : ""}</Typography>}
              />
              <Slider
                size="small"
                disabled={!forceHue}
                min={0}
                max={359}
                step={1}
                value={hue}
                onChange={(_, v) => setHue(v as number)}
                aria-label="Base hue"
              />
            </Box>

            <Tooltip title="Mode, harmony and hue only reach the theme dials you switched on — a roll cannot repaint dials the dashboard has no opinion about.">
              <Button variant="contained" onClick={roll} startIcon={<Glyph id="icon-reload" size={14} />}>
                Roll {activeSet.size} dial{activeSet.size === 1 ? "" : "s"}
              </Button>
            </Tooltip>
          </Paper>
        ) : null}
      </Stack>

      {/* ------------------------------------------------------------ editor */}
      <Paper variant="outlined" sx={{ p: 1.5, display: "grid", gap: 1.25 }}>
        {!draft ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            Nothing being edited. <strong>New dashboard</strong> starts from the theme default — every
            dial off, so the wrapper adds nothing until you switch one on. <strong>Edit</strong> opens
            a saved one. Built-in wrappers are code and cannot be copied into a record, which is why
            they offer no Duplicate.
          </Typography>
        ) : (
          <>
            <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <Typography variant="subtitle2">Editing</Typography>
              <Chip size="small" variant="outlined" label={draft.id} sx={{ ...MONO, height: 18 }} />
              <Chip
                size="small"
                color={activeSet.size ? "primary" : "default"}
                variant={activeSet.size ? "filled" : "outlined"}
                label={`${activeSet.size} active`}
                sx={{ ...MONO, height: 18 }}
              />
              <Tooltip title="Theme dials this dashboard hands over when it is applied. The rest stay inside the record.">
                <Chip
                  size="small"
                  variant="outlined"
                  label={`${inheritCount} inherited`}
                  sx={{ ...MONO, height: 18 }}
                />
              </Tooltip>
              <Box sx={{ flex: 1 }} />
              <Button size="small" onClick={closeDraft}>
                Close
              </Button>
              <Tooltip title="Make this the wrapper the theme uses, and hand over every inherited dial. Apply to app is what saves it.">
                <Button
                  size="small"
                  variant={dialled === draft.id ? "outlined" : "contained"}
                  onClick={() => use(draft, draft.id)}
                >
                  {dialled === draft.id ? "In theme" : "Use in theme"}
                </Button>
              </Tooltip>
              <Button size="small" variant="contained" onClick={() => void saveDraft()}>
                {savedFlash ? "Saved" : "Save dashboard"}
              </Button>
            </Stack>

            {problem ? <Alert severity="error" sx={{ py: 0 }}>{problem}</Alert> : null}

            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
              <TextField
                size="small"
                label="Title"
                sx={{ flex: 1, minWidth: 200 }}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
              <TextField
                size="small"
                label="Description"
                sx={{ flex: 2, minWidth: 240 }}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </Stack>

            <Alert severity="info" variant="outlined" icon={false} sx={{ py: 0.25 }}>
              <Typography variant="caption">
                This draft is registered live, so the shell around this screen IS the preview. Nothing
                is stored until <strong>Save dashboard</strong>; closing without saving puts the
                registry back.
              </Typography>
            </Alert>

            {/* ------------------------------------------- the wrapper's dials */}
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 0.5 }}>
              <Typography variant="subtitle2">Wrapper dials</Typography>
              <Chip size="small" variant="outlined" label={DASH_DIALS.length} sx={{ ...MONO, height: 18 }} />
              <Box sx={{ flex: 1 }} />
              <Button size="small" onClick={() => setAll("dash", true)}>
                All on
              </Button>
              <Button size="small" onClick={() => setAll("dash", false)}>
                All off
              </Button>
            </Stack>

            {DASH_SUBSYSTEMS.map((subsystem) => (
              <Accordion key={subsystem} defaultExpanded disableGutters>
                <AccordionSummary expandIcon={<Glyph id="icon-chevron-down" size={14} />}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Typography variant="subtitle2">{heading(subsystem)}</Typography>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`${DASH_GROUPS[subsystem].filter((d) => activeSet.has(d.id)).length}/${DASH_GROUPS[subsystem].length}`}
                      sx={{ ...MONO, height: 18 }}
                    />
                  </Stack>
                </AccordionSummary>
                <AccordionDetails sx={{ display: "grid", gap: 0.75, pt: 0 }}>
                  {DASH_GROUPS[subsystem].map((dial) => (
                    <DialRow
                      key={dial.id}
                      label={dial.label}
                      effect={dial.effect}
                      cssVar={dial.cssVar}
                      active={activeSet.has(dial.id)}
                      onActive={(on) => setActive(dial.id, on)}
                      // A wrapper dial has nothing to inherit INTO: it is the
                      // wrapper's own variable, not one of the theme's.
                      inherit={null}
                      rolled={rolled.has(dial.id)}
                    >
                      <DashDialControl dial={dial} values={draft.display} onChange={setDisplay} />
                    </DialRow>
                  ))}
                </AccordionDetails>
              </Accordion>
            ))}

            {/* ------------------------------------------- the theme's dials */}
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 1 }}>
              <Typography variant="subtitle2">Theme dials this dashboard carries</Typography>
              <Box sx={{ flex: 1 }} />
              <Button size="small" onClick={() => setAll("theme", true)}>
                All on
              </Button>
              <Button size="small" onClick={() => setAll("theme", false)}>
                All off
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Switch a dial on and the roll gives it a value. Switch <strong>INHERIT</strong> on and
              the theme takes that value when this dashboard is applied — that is the only way
              anything here reaches <code>--axf-*</code>, because the theme is the app&apos;s one
              publisher and a wrapper never writes over it.
            </Typography>

            {THEME_GROUPS.map(([subsystem, dials]) => (
              <Accordion key={subsystem} disableGutters>
                <AccordionSummary expandIcon={<Glyph id="icon-chevron-down" size={14} />}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Typography variant="subtitle2">{heading(subsystem)}</Typography>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`${dials.filter((d) => activeSet.has(d.id)).length}/${dials.length}`}
                      sx={{ ...MONO, height: 18 }}
                    />
                    {dials.some((d) => inheritSet.has(d.id) && activeSet.has(d.id)) ? (
                      <Chip size="small" color="primary" label="inherits" sx={{ ...MONO, height: 18 }} />
                    ) : null}
                  </Stack>
                </AccordionSummary>
                <AccordionDetails sx={{ display: "grid", gap: 0.75, pt: 0 }}>
                  {dials.map((dial) => (
                    <DialRow
                      key={dial.id}
                      label={dial.label}
                      effect={dial.effect}
                      cssVar={dial.cssVar}
                      active={activeSet.has(dial.id)}
                      onActive={(on) => setActive(dial.id, on)}
                      inherit={inheritSet.has(dial.id)}
                      onInherit={(on) => setInherit(dial.id, on)}
                      rolled={rolled.has(dial.id)}
                    >
                      {/* The theme's OWN control, unmodified — a second control
                          for the same dial is how two surfaces start disagreeing
                          about what a dial accepts. `values` layers the draft
                          over the live theme, so a dial the dashboard says
                          nothing about shows what it currently resolves to. */}
                      <DialControl
                        dial={dial}
                        values={{ ...themeValues, ...draft.theme }}
                        onChange={setThemeDial}
                        baseValue={themeValues[dial.id] ?? dial.default}
                        overridden={dial.id in draft.theme}
                        packOverride={null}
                        recent={false}
                      />
                    </DialRow>
                  ))}
                </AccordionDetails>
              </Accordion>
            ))}

            <Typography variant="caption" color="text.secondary">
              Saving validates through core&apos;s <code>defineDashboardSpec</code> — a bad id or an
              empty description is refused with the reason rather than stored broken. Authored
              wrappers persist on the server (ids start with <code>{CUSTOM_PREFIX}</code>) and
              register on boot, so the shell SSRs the wrapper the theme names.
            </Typography>
          </>
        )}
      </Paper>
    </Box>
  );
}
