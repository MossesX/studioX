/**
 * @file The Theme Manager — a settings section that edits the theme in force.
 *
 * Five things and no sixth. The owner's fence on this surface is explicit:
 * **roll button, gauges, token colour editor, click-to-locate, revert/save/load
 * on a toolbar. That is the whole surface.** Anything that looks like an
 * obvious addition — a preview pane, a history strip, a harmony picker, a
 * contrast report — belongs to the Theme Designer at `/theme-designer`, which
 * already has all four and is where design happens. This is the settings-page
 * half: turn the app's own colours, from the page you are already on.
 *
 * ## No preview, and that is the page's bargain rather than an omission
 *
 * `SettingsPage.tsx` states it: `/settings` previews nothing, so a selection
 * "applies and saves straight away". Every edit here goes through
 * `ThemeStore`'s ordinary path and is persisted by the store's own rule (hot
 * render, save instantly, no confirm step). The designer's `beginPreview()` /
 * `commitPreview()` pair is deliberately NOT used — a settings page with an
 * unsaved state is a settings page you can leave without meaning to.
 *
 * ## Why the toolbar's icons are pack drawings
 *
 * Every button resolves through `<Glyph>`, which draws the branding pack's SVG
 * painted in the brand role variables — and those roles are republished from
 * the live theme by the applier's brand bridge. So the toolbar of the surface
 * that edits the theme RECOLOURS with the theme it is editing, which a Material
 * icon (a shipped hex no theme can reach) cannot do. Every id used here is a
 * `REQUIRED_GLYPHS` contract id, so no pack goes incomplete and no glyph-kit
 * edit was needed: sparkle=roll, plus=save-as-new, folder=load, reload=revert,
 * picker=the eyedropper.
 *
 * ## Where the saved themes live
 *
 * On the per-user settings spine — `/api/axf/kv/saved-themes`, i.e.
 * `data/axf/kv/<user>/saved-themes.json`, resolved from the `axs_session`
 * cookie by `kvUser()`. Deliberately NOT the settings-profiles machinery in
 * `accounts/lib/states.ts`: a state snapshot carries the theme AND the layouts,
 * the pack selection and the per-module baselines, so saving a colour scheme
 * through it would silently capture and later restore six other things.
 *
 * It is also the SAME shelf the designer's Saved tab uses, rather than a second
 * namespace of its own. That is the one decision here that is not the literal
 * plan: two shelves of "my named themes" would mean a look saved on this page
 * is invisible on the designer's, and a user with two half-libraries and no way
 * to see either is a worse outcome than the coupling. `SavedThemeLibrary` is
 * pure and `attachShelfSync` is idempotent and module-scoped, so consuming it
 * from a second surface is what both were built for.
 */
"use client";

import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { DIALS, Glyph, seedFrom, theme as themeStore, useTheme } from "@axf/core";
import type { Dial, ThemeValues } from "@axf/core";

import { savedThemes } from "../theme-designer/saved-store";
import type { SavedTheme } from "../theme-designer/saved-store";
import { attachShelfSync } from "../theme-designer/shelf-sync";
import { DEFAULT_GAUGES, CONTRAST_RANGE, RADIUS_RANGE, gaugedRoll, gaugesFrom } from "./gauges";
import type { Gauges } from "./gauges";
import { buildTokenIndex, describeMatches, matchTokens, pageRgb } from "./locate";
import type { TokenEntry } from "./locate";

const MONO = { fontFamily: "var(--axf-mono)", fontSize: 11 } as const;
const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** How long a located row glows, and the clicked element stays outlined. */
const FLASH_MS = 1600;

/* --------------------------------------------------------------- the groups */

/**
 * The six groups the fence names. Membership is a PREDICATE over the spec, not
 * a hand-kept list of ids, and `geometry` is the catch-all — so a dial added to
 * `spec.ts` appears in this editor the day it lands instead of silently going
 * missing from every group.
 */
const SURFACES = new Set(["page", "panel", "panel2"]);
const INK = new Set(["ink", "dim"]);
const ACCENTS = new Set(["accent", "accent2", "accent3", "info", "ok", "warn", "err"]);
const LINES = new Set(["edge", "border"]);

const GROUPS: readonly { id: string; title: string; note: string; has: (d: Dial) => boolean }[] = [
  {
    id: "surfaces",
    title: "Surfaces",
    note: "The page and the two elevations everything sits on.",
    has: (d) => SURFACES.has(d.id)
  },
  {
    id: "ink",
    title: "Ink",
    note: "Body text and the secondary voice. The pair that decides legibility.",
    has: (d) => INK.has(d.id)
  },
  {
    id: "accents",
    title: "Accents",
    note: "The brand triad and the four status colours.",
    has: (d) => ACCENTS.has(d.id)
  },
  {
    id: "lines",
    title: "Lines",
    note: "Borders and dividers — the colour, and how thick they draw.",
    has: (d) => LINES.has(d.id)
  },
  {
    id: "typography",
    title: "Typography",
    note: "Faces, sizes, weight and tracking.",
    has: (d) => d.subsystem === "typography"
  },
  {
    id: "geometry",
    title: "Geometry and chrome",
    note: "Everything measured or structural: radius, spacing, motion, layout, the chrome assets.",
    // The catch-all, deliberately last — see the note above.
    has: () => true
  }
];

function groupedDials(): { group: (typeof GROUPS)[number]; dials: Dial[] }[] {
  const out = GROUPS.map((group) => ({ group, dials: [] as Dial[] }));
  for (const dial of DIALS) {
    const bucket = out.find((b) => b.group.has(dial));
    bucket?.dials.push(dial);
  }
  return out.filter((b) => b.dials.length > 0);
}

/* -------------------------------------------------------------- the toolbar */

function BarButton({
  glyph,
  label,
  hint,
  active,
  onClick
}: {
  glyph: string;
  label: string;
  hint: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip title={hint}>
      <Button
        size="small"
        variant={active ? "contained" : "outlined"}
        onClick={onClick}
        startIcon={<Glyph id={glyph} size={15} title={label} />}
        sx={{ textTransform: "none" }}
      >
        {label}
      </Button>
    </Tooltip>
  );
}

/* ---------------------------------------------------------------- the rows */

function Swatch({ dial, value }: { dial: Dial; value: string }) {
  if (dial.kind === "color" && HEX6.test(value)) {
    return (
      <Box
        aria-hidden
        sx={{
          width: 22,
          height: 22,
          flex: "0 0 auto",
          borderRadius: "var(--axf-radius)",
          border: "1px solid",
          borderColor: "divider",
          bgcolor: value
        }}
      />
    );
  }
  // A size, a face or an asset id has no colour to show, and its VALUE is the
  // only honest swatch for it.
  return (
    <Typography
      sx={{ ...MONO, width: 22, flex: "0 0 auto", color: "text.secondary", textAlign: "center" }}
    >
      ·
    </Typography>
  );
}

function TokenRow({
  dial,
  values,
  flash,
  onChange
}: {
  dial: Dial;
  values: ThemeValues;
  /** The flash nonce when this row is the located one, else null. */
  flash: number | null;
  onChange: (value: string | number) => void;
}) {
  const flashing = flash !== null;
  /* Two alternating animation names, chosen by the nonce's parity.
     A CSS animation only restarts when something about it CHANGES, so a second
     click on the same element re-set the same state and the row sat there
     already-animated, doing nothing — the click looked ignored. Alternating the
     name restarts it without remounting the row (which would tear down an open
     colour picker mid-edit). */
  const animation = flashing ? (flash % 2 === 0 ? "axfTmFlashA" : "axfTmFlashB") : "none";
  const keyframes = {
    "0%": { outlineColor: "var(--axf-accent)", backgroundColor: "var(--axf-panel2)" },
    "45%": { outlineColor: "transparent", backgroundColor: "transparent" },
    "70%": { outlineColor: "var(--axf-accent)", backgroundColor: "var(--axf-panel2)" },
    "100%": { outlineColor: "transparent", backgroundColor: "transparent" }
  } as const;
  const value = String(values[dial.id] ?? dial.default);
  // Keystrokes only, never the value — `DialControl.tsx` states why: a control
  // seeded into `useState` pins itself to whatever the first render showed.
  const [draft, setDraft] = React.useState<string | null>(null);

  const commitText = (next: string) => {
    setDraft(next);
    if (dial.kind === "number") {
      const n = Number(next);
      if (next.trim() !== "" && Number.isFinite(n)) onChange(n);
      return;
    }
    onChange(next);
  };

  return (
    <Stack
      direction="row"
      spacing={1.25}
      data-token-row={dial.id}
      // The token area (P10). Declared on `accounts.decl.ts` with the rest of
      // the suite's map; answered by `./theme-manager.commands.ts`, which lives
      // here because the index those rows read does. `data-token-row` stays as
      // it was — it is click-to-locate's scroll target, a different job that
      // happens to key on the same id.
      data-axf-area="accounts.token-row"
      data-axf-token={dial.id}
      sx={{
        alignItems: "center",
        px: 1,
        py: 0.5,
        borderRadius: "var(--axf-radius)",
        outline: "2px solid transparent",
        animation: flashing ? `${animation} ${FLASH_MS}ms ease-out 1` : "none",
        "@keyframes axfTmFlashA": keyframes,
        "@keyframes axfTmFlashB": keyframes,
        // A glow is a beacon for someone who can watch it move; for someone who
        // cannot, the same job is done by a highlight that simply stays put.
        "@media (prefers-reduced-motion: reduce)": {
          animation: "none",
          backgroundColor: flashing ? "var(--axf-panel2)" : "transparent"
        }
      }}
    >
      <Swatch dial={dial} value={value} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Tooltip title={dial.effect} placement="top-start">
          <Typography variant="body2" sx={{ fontWeight: 600, cursor: "help" }}>
            {dial.label}
          </Typography>
        </Tooltip>
        <Typography sx={{ ...MONO, fontSize: 10.5, color: "text.secondary" }}>
          {dial.cssVar}
        </Typography>
      </Box>
      {dial.kind === "color" ? (
        <TextField
          type="color"
          size="small"
          value={HEX6.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          slotProps={{ htmlInput: { "aria-label": `${dial.label} colour` } }}
          sx={{ width: 64, flex: "0 0 auto", "& input": { p: "2px", height: 26, cursor: "pointer" } }}
        />
      ) : dial.kind === "enum" ? (
        <TextField
          select
          size="small"
          value={dial.options.includes(value) ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          slotProps={{ htmlInput: { "aria-label": dial.label } }}
          sx={{ width: 190, flex: "0 0 auto", "& .MuiSelect-select": { ...MONO, fontSize: 12 } }}
        >
          {dial.options.map((option) => (
            <MenuItem key={option} value={option} sx={{ ...MONO, fontSize: 12 }}>
              {option}
            </MenuItem>
          ))}
        </TextField>
      ) : (
        <TextField
          size="small"
          value={draft ?? value}
          onChange={(e) => commitText(e.target.value)}
          onBlur={() => setDraft(null)}
          slotProps={{
            htmlInput: { spellCheck: false, "aria-label": `${dial.label} value` }
          }}
          sx={{ width: 190, flex: "0 0 auto", "& input": { ...MONO, fontSize: 12 } }}
        />
      )}
    </Stack>
  );
}

/* --------------------------------------------------------------- save/load */

/** The six roles that say what a saved look is, at a glance. */
const STRIP_ROLES = ["page", "panel", "accent", "accent2", "ink", "ok"] as const;

function SwatchStrip({ values }: { values: ThemeValues | undefined }) {
  if (!values) return null;
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
      {STRIP_ROLES.map((role) => {
        const value = String(values[role] ?? "");
        return (
          <Box
            key={role}
            title={`${role} ${value}`}
            sx={{
              width: 18,
              height: 18,
              borderRadius: "var(--axf-radius)",
              border: "1px solid",
              borderColor: "divider",
              bgcolor: HEX6.test(value) ? value : "transparent"
            }}
          />
        );
      })}
    </Stack>
  );
}

/* --------------------------------------------------------------- the section */

export default function ThemeManagerSection() {
  const state = useTheme();
  const sectionRef = React.useRef<HTMLDivElement | null>(null);

  /* The seed the gauges roll against. `state.seed` is null on the shipped
     default theme, and a gauge needs SOMETHING to roll — so one is minted the
     first time it is needed and then kept, rather than minted per gauge tick
     (which would reroll every non-colour dial on every pixel of a drag). */
  const mintedSeed = React.useRef<string | null>(null);
  const rollCount = React.useRef(0);
  const seedNow = (): string => {
    if (state.seed) return state.seed;
    mintedSeed.current ??= seedFrom(`theme-manager:${Date.now()}`);
    return mintedSeed.current;
  };

  const derivedGauges = React.useMemo(() => gaugesFrom(state.values), [state.values]);
  const [gaugeDraft, setGaugeDraft] = React.useState<Gauges | null>(null);
  const gauges = gaugeDraft ?? derivedGauges;

  /** Which row is glowing, and a nonce so the SAME row can glow twice. */
  const [flash, setFlash] = React.useState<{ dialId: string; nonce: number } | null>(null);
  const [pick, setPick] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [loadOpen, setLoadOpen] = React.useState(false);
  const [saveName, setSaveName] = React.useState("");

  const shelf = React.useSyncExternalStore(
    savedThemes.subscribe,
    savedThemes.list,
    savedThemes.serverList
  );

  /* The server mirror, so a look saved here outlives this browser profile. Safe
     to call from a second surface: it is idempotent and module-scoped. */
  React.useEffect(() => attachShelfSync(savedThemes), []);

  const groups = React.useMemo(() => groupedDials(), []);

  /* The value→token map, rebuilt whenever the tokens change — which is the
     whole correctness condition for click-to-locate. A stale index resolves a
     click against the PREVIOUS theme and names the wrong dial confidently. */
  const index: TokenEntry[] = React.useMemo(() => buildTokenIndex(state.values), [state.values]);

  /* ---------------------------------------------------------------- acting */

  const applyGauges = React.useCallback((next: Gauges, seed: string) => {
    const { options, overrides } = gaugedRoll(seed, next);
    // The engine's own apply path: the seed lands in history and every dial in
    // the spec is rolled, then the two gauges the roller cannot express are
    // written as ordinary overrides.
    themeStore.apply(seed, options);
    for (const [dial, value] of Object.entries(overrides)) themeStore.setValue(dial, value);
  }, []);

  const onGauge = (patch: Partial<Gauges>) => {
    const next = { ...gauges, ...patch };
    setGaugeDraft(next);
    applyGauges(next, seedNow());
  };

  const roll = () => {
    // A fresh seed on every press — the counter is what makes two presses in
    // the same millisecond different rolls rather than the same one twice.
    const seed = seedFrom(`theme-manager:${Date.now()}:${rollCount.current++}`);
    mintedSeed.current = seed;
    setGaugeDraft(null);
    applyGauges(gauges, seed);
    setStatus(`Rolled ${seed} — ${gauges.mode}, hue ${gauges.hue}°, contrast ${gauges.contrast}:1.`);
  };

  const revert = () => {
    // `reset()` puts seed, hand edits AND roll options back, so the values in
    // force become `defaultValues()` exactly.
    themeStore.reset();
    mintedSeed.current = null;
    setGaugeDraft(null);
    setStatus("Reverted to the theme the app ships with.");
  };

  const save = () => {
    const name = saveName.trim();
    if (!name) return;
    savedThemes.save(
      {
        name,
        values: state.values,
        seed: state.seed,
        options: state.options,
        overrides: state.overrides
      },
      Date.now()
    );
    setSaveOpen(false);
    setSaveName("");
    setStatus(`Saved "${name}" — it is on the shelf this page and the designer share.`);
  };

  /** The same restore `SavedThemes.tsx` performs: the photograph, dial by dial. */
  const applySaved = (entry: SavedTheme) => {
    if (entry.seed) themeStore.apply(entry.seed, entry.options);
    else themeStore.reset();
    for (const [dial, value] of Object.entries(entry.values ?? entry.overrides)) {
      themeStore.setValue(dial, value as string | number);
    }
    mintedSeed.current = entry.seed;
    setGaugeDraft(null);
    setLoadOpen(false);
    setStatus(`Applied "${entry.name}".`);
  };

  /* ------------------------------------------------------- click-to-locate */

  const locate = React.useCallback(
    (element: Element) => {
      const computed = window.getComputedStyle(element);
      const matches = matchTokens(
        {
          color: computed.color,
          backgroundColor: computed.backgroundColor,
          borderColor: computed.borderTopColor,
          fontFamily: computed.fontFamily,
          borderRadius: computed.borderTopLeftRadius
        },
        index,
        pageRgb(index)
      );

      setStatus(describeMatches(matches));
      // A click that resolves to nothing SAYS so — the sentence above is the
      // whole of the behaviour, and it is why this returns rather than falling
      // through to a scroll with no target.
      if (matches.length === 0) return;

      const target = matches[0].dialId;
      const row = sectionRef.current?.querySelector(`[data-token-row="${target}"]`);
      row?.scrollIntoView({ block: "center", behavior: "smooth" });
      setFlash((previous) => ({ dialId: target, nonce: (previous?.nonce ?? 0) + 1 }));

      // The clicked element is outlined for the same beat, so the two ends of
      // the answer are visible at once. Restored to whatever it had, never to
      // the empty string — an element with its own inline outline would lose it.
      const styled = element as HTMLElement;
      const previous = styled.style.outline;
      styled.style.outline = "2px dashed var(--axf-accent)";
      window.setTimeout(() => {
        styled.style.outline = previous;
      }, FLASH_MS);
    },
    [index]
  );

  React.useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flash]);

  React.useEffect(() => {
    if (!pick) return;
    const onClick = (event: MouseEvent) => {
      const inSection = sectionRef.current?.contains(event.target as Node);
      // Clicks INSIDE the section are the section's own controls. Intercepting
      // them would make the Pick button locate the Pick button, and would take
      // the colour inputs out of service the moment picking is armed.
      if (inSection) return;
      // Capture phase and a swallowed click: the point is to inspect what is on
      // screen, and letting the click through would navigate away from it.
      event.preventDefault();
      event.stopPropagation();
      const element = document.elementFromPoint(event.clientX, event.clientY);
      if (element) locate(element);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pick, locate]);

  /* ------------------------------------------------------------- rendering */

  return (
    <Paper
      ref={sectionRef}
      variant="outlined"
      // What *Locate on page* skips (P10). Every swatch and every control in
      // this section is painted with a token, so a reverse lookup that included
      // them would answer "the row you just right-clicked", every time. The
      // marker rather than the ref because the command runs outside React and
      // has no way to reach one.
      data-axf-theme-section=""
      sx={{ p: 2, display: "grid", gap: 1.5 }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Glyph id="icon-palette" size={18} />
        <Typography variant="subtitle2">Theme</Typography>
        <Chip
          size="small"
          variant="outlined"
          label={state.seed ?? "shipped default"}
          sx={{ ...MONO, height: 18 }}
        />
        <Box sx={{ flex: 1 }} />
        <BarButton
          glyph="icon-sparkle"
          label="Roll"
          hint="Generate a fresh palette over every token, honouring the gauges below. Applies immediately."
          onClick={roll}
        />
        <BarButton
          glyph="icon-plus"
          label="Save"
          hint="Save these values under a name, on your account."
          onClick={() => setSaveOpen(true)}
        />
        <BarButton
          glyph="icon-folder"
          label="Load"
          hint="Apply one of your saved themes."
          onClick={() => setLoadOpen(true)}
        />
        <BarButton
          glyph="icon-reload"
          label="Revert"
          hint="Back to the theme the app ships with — seed, hand edits and roll constraints."
          onClick={revert}
        />
        <BarButton
          glyph="icon-picker"
          label="Pick"
          hint="Click anything on the page to find the tokens that style it."
          active={pick}
          onClick={() => {
            setPick((on) => !on);
            setStatus(
              pick ? null : "Picking — click anything outside this card to locate its tokens."
            );
          }}
        />
      </Stack>

      <Typography variant="caption" color="text.secondary">
        The colours, faces and measurements the whole app draws from. Like the packs above, this
        page previews nothing: every change here applies and saves the moment it is made. Design
        work — the roller&apos;s constraints, saved-look history, the toolbar and nav-menu
        builders — lives in the <strong>Theme Designer</strong>.
      </Typography>

      <Divider />

      {/* ---------------------------------------------------------- gauges */}
      <Box sx={{ display: "grid", gap: 1 }}>
        <Typography sx={{ ...MONO, color: "text.secondary" }}>gauges</Typography>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <TextField
            select
            size="small"
            label="Light / dark"
            value={gauges.mode}
            onChange={(e) => onGauge({ mode: e.target.value === "light" ? "light" : "dark" })}
            sx={{ width: 150 }}
          >
            <MenuItem value="dark">dark</MenuItem>
            <MenuItem value="light">light</MenuItem>
          </TextField>

          <Box sx={{ width: 220 }}>
            <Typography variant="caption" color="text.secondary">
              Accent hue · {gauges.hue}°
            </Typography>
            <Slider
              size="small"
              min={0}
              max={359}
              step={1}
              value={gauges.hue}
              aria-label="accent hue"
              onChange={(_, v) => onGauge({ hue: Array.isArray(v) ? v[0] : v })}
              onChangeCommitted={() => setGaugeDraft(null)}
            />
          </Box>

          <Box sx={{ width: 220 }}>
            <Typography variant="caption" color="text.secondary">
              Contrast · {gauges.contrast.toFixed(1)}:1 ink on page
            </Typography>
            <Slider
              size="small"
              min={CONTRAST_RANGE.min}
              max={CONTRAST_RANGE.max}
              step={CONTRAST_RANGE.step}
              value={gauges.contrast}
              aria-label="contrast"
              onChange={(_, v) => onGauge({ contrast: Array.isArray(v) ? v[0] : v })}
              onChangeCommitted={() => setGaugeDraft(null)}
            />
          </Box>

          <Box sx={{ width: 200 }}>
            <Typography variant="caption" color="text.secondary">
              Corner radius · {gauges.radius}px
            </Typography>
            <Slider
              size="small"
              min={RADIUS_RANGE.min}
              max={RADIUS_RANGE.max}
              step={RADIUS_RANGE.step}
              value={gauges.radius}
              aria-label="corner radius"
              onChange={(_, v) => onGauge({ radius: Array.isArray(v) ? v[0] : v })}
              onChangeCommitted={() => setGaugeDraft(null)}
            />
          </Box>
        </Stack>
        <Typography variant="caption" color="text.secondary">
          The gauges constrain the roll rather than replacing it — a dark gauge keeps rolled
          surfaces dark, and contrast is a floor every colour is clamped up to, in the same
          proportions the spec declares (ink {DEFAULT_GAUGES.contrast}:1, the rest 3:1).
        </Typography>
      </Box>

      <Divider />

      {/* ----------------------------------------------------- token editor */}
      <Box sx={{ display: "grid", gap: 1.5 }}>
        {groups.map(({ group, dials }) => (
          <Box key={group.id} sx={{ display: "grid", gap: 0.25 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
              <Typography sx={{ ...MONO, color: "text.secondary" }}>{group.title}</Typography>
              <Typography variant="caption" color="text.secondary">
                {group.note}
              </Typography>
            </Stack>
            {dials.map((dial) => (
              <TokenRow
                key={dial.id}
                dial={dial}
                values={state.values}
                flash={flash?.dialId === dial.id ? flash.nonce : null}
                onChange={(value) => themeStore.setValue(dial.id, value)}
              />
            ))}
          </Box>
        ))}
      </Box>

      {/* ----------------------------------------------------------- footer */}
      <Divider />
      <Typography
        variant="caption"
        color={status ? "text.primary" : "text.secondary"}
        sx={{ minHeight: 18 }}
      >
        {status ?? "Turn Pick on and click anything on the page to find the tokens that style it."}
      </Typography>

      {/* ------------------------------------------------------ save dialog */}
      <Dialog open={saveOpen} onClose={() => setSaveOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Save this theme</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Name"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
            helperText="Saving under a name you already used replaces that entry."
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button size="small" color="inherit" onClick={() => setSaveOpen(false)}>
            Cancel
          </Button>
          <Button size="small" variant="contained" disabled={!saveName.trim()} onClick={save}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* ------------------------------------------------------ load dialog */}
      <Dialog open={loadOpen} onClose={() => setLoadOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Your saved themes</DialogTitle>
        <DialogContent dividers>
          {shelf.length === 0 ? (
            <Typography variant="caption" color="text.secondary">
              Nothing saved yet. Roll something you like and press Save.
            </Typography>
          ) : (
            <List dense disablePadding>
              {shelf.map((entry) => (
                <ListItemButton key={entry.id} onClick={() => applySaved(entry)}>
                  <Stack
                    direction="row"
                    spacing={1.5}
                    sx={{ alignItems: "center", width: "100%", py: 0.5 }}
                  >
                    <SwatchStrip values={entry.values} />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {entry.name}
                      </Typography>
                      <Typography sx={{ ...MONO, color: "text.secondary" }}>
                        {entry.seed ?? "no seed"}
                      </Typography>
                    </Box>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={entry.values ? "full theme" : `${Object.keys(entry.overrides).length} edits`}
                      sx={{ ...MONO, height: 18 }}
                    />
                  </Stack>
                </ListItemButton>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setLoadOpen(false)}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
