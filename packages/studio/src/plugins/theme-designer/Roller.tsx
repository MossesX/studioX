/**
 * @file The roller — a seed in, a whole theme out, and the audit told honestly.
 *
 * The other half of the authoring surface. The dial editor is for when you know
 * what you want; the roller is for finding it. Both drive the SAME engine: this
 * file computes nothing about a theme itself — `rollTheme` makes them,
 * `auditTheme` judges them, `seedFrom` derives seeds, `ThemeStore` applies and
 * remembers them, and `ThemeScope` shows them. A roller that generated, judged
 * or persisted anything of its own would be a second engine with a first
 * engine's name on it.
 *
 * ## 1. Determinism is the whole product
 *
 * `generate.ts` is model-free and deterministic: the same seed produces the same
 * theme, on any machine, forever. That is what makes a theme shareable as six
 * characters instead of a blob, and reproducible in a bug report. A roller that
 * hides the seed throws that away — you find a theme you like and cannot say
 * what it was. So the seed that produced what is on screen is always displayed,
 * always copyable, and the claim is CHECKED on screen rather than asserted: the
 * "deterministic" chip re-rolls the seed and compares the result to the theme
 * being previewed. If those ever disagree, the chip goes red and says so.
 *
 * Seeds are taken two ways, and the difference is explicit rather than guessed:
 *
 *   · **Use as seed** — the text IS the seed. A seed someone sent you must
 *     round-trip to their theme exactly, so this is the default. Guessing
 *     between the two modes by inspecting the string was the alternative, and
 *     it would need this file to keep a copy of `seedFrom`'s private alphabet —
 *     a copy that goes stale silently the day the alphabet changes.
 *   · **Derive** — `seedFrom(text)` turns any phrase or number into a canonical
 *     six-character seed. Numeric input is passed as a `number`, which is the
 *     signature the engine advertises; `seedFrom` stringifies internally, so
 *     `42` and `"42"` are the same seed by construction rather than by luck.
 *
 * ## 2. The audit is the engine's opinion, never a second one
 *
 * `auditTheme()` already decides what a bad contrast is, using each colour
 * dial's own `contrastAgainst` / `minContrast` and its own epsilon. This surface
 * shows what it returns and adds no verdict of its own — the achieved ratios are
 * displayed as the neutral data they are (`RolledTheme.contrast`, computed by
 * the generator), and the pass/fail call belongs solely to the warnings list. A
 * UI that re-derived "is this ratio acceptable" would eventually disagree with
 * the engine by a rounding epsilon, and a checker that disagrees with the
 * authority it reports on is worse than no checker.
 *
 * A warned roll is still applicable, deliberately. This is a designer, not a
 * gate: the generator CLAMPS rather than re-rolls (rejecting failures biases the
 * palette space), so a warning here means a clamp regressed — information the
 * person needs, not a decision to take away from them.
 *
 * ## 3. One store, one key, one boot path
 *
 * History, seeds, options and persistence are all `ThemeStore`'s, already
 * solved: it saves instantly with no confirm step, keeps seeds rather than
 * resolved themes (six characters that regenerate exactly), and shares one
 * storage key with the pre-paint boot script so a reload paints the right theme
 * before React exists. Nothing here writes storage. The only state this file
 * owns is what has been rolled but not yet applied and which entry is being
 * previewed — session-scoped by nature, and deliberately not persisted, because
 * a second persistence key is how two sources of truth start.
 */
"use client";

import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import FormControl from "@mui/material/FormControl";
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
import FormControlLabel from "@mui/material/FormControlLabel";

import {
  DIALS,
  Glyph,
  HARMONIES,
  auditTheme,
  rollTheme,
  seedFrom,
  theme as themeStore,
  useTheme
} from "@axf/core";
import type {
  ColorDial,
  Harmony,
  Mode,
  RollOptions,
  RolledTheme,
  StyleInput
} from "@axf/core";

import PreviewPanel from "./PreviewPanel";

const MONO = { fontFamily: "var(--axf-mono)", fontSize: 11 } as const;

/** Rolls kept from this session. Applied ones live in the store's own history. */
const SESSION_LIMIT = 24;

/** The harmony names, FROM the engine — never a hand-kept list (see HARMONIES). */
const HARMONY_IDS = Object.keys(HARMONIES) as Harmony[];

/** Every colour dial, for swatches — from the spec, so a new one appears free. */
const COLOR_DIALS = DIALS.filter((d): d is ColorDial => d.kind === "color");

/** The dials `auditTheme` actually checks — its own criteria, read not guessed. */
const AUDITED_DIALS = COLOR_DIALS.filter((d) => d.contrastAgainst && d.minContrast);

/* ------------------------------------------------------------------ helpers */

interface RollEntry {
  readonly rolled: RolledTheme;
  /**
   * The options this roll was made under. Carried per entry because applying it
   * has to reproduce what was PREVIEWED: `ThemeStore` keeps one options object,
   * so applying a seed rolled with `{mode:'light'}` while the store holds
   * `{mode:'dark'}` would silently hand back a different theme than the one on
   * screen — the exact class of bug `rollTheme`'s "draw always, override the
   * value never the draw" comment exists to have ended inside the generator.
   */
  readonly options: RollOptions;
  /** `auditTheme`'s verdict on this roll. Not recomputed anywhere else. */
  readonly warnings: readonly string[];
  readonly origin: "session" | "history";
}

function entryOf(seed: string, options: RollOptions, origin: RollEntry["origin"]): RollEntry {
  const rolled = rollTheme(seed, options);
  return { rolled, options, warnings: auditTheme(rolled), origin };
}

/** Same three fields `RollOptions` has — used only to mark "this one is applied". */
function sameOptions(a: RollOptions, b: RollOptions): boolean {
  return a.mode === b.mode && a.harmony === b.harmony && a.hue === b.hue;
}

function optionSummary(options: RollOptions): string {
  const parts: string[] = [];
  if (options.mode) parts.push(options.mode);
  if (options.harmony) parts.push(options.harmony);
  if (options.hue !== undefined) parts.push(`hue ${options.hue}°`);
  return parts.length ? parts.join(" · ") : "seed decides";
}

/** The palette of a roll, straight from its values. */
function Swatches({ rolled, size = 14 }: { rolled: RolledTheme; size?: number }) {
  return (
    <Stack direction="row" spacing={0.25} sx={{ alignItems: "center" }}>
      {COLOR_DIALS.map((dial) => (
        <Tooltip key={dial.id} title={`${dial.id} ${String(rolled.values[dial.id])}`}>
          <Box
            sx={{
              width: size,
              height: size,
              borderRadius: "3px",
              bgcolor: String(rolled.values[dial.id]),
              border: "1px solid",
              borderColor: "divider",
              flexShrink: 0
            }}
          />
        </Tooltip>
      ))}
    </Stack>
  );
}

/* --------------------------------------------------------------- the surface */

export default function Roller({ pack }: { pack: StyleInput | null }) {
  /* Read through the store on every render. Nothing here is snapshotted into
     state at mount: the store reports its SERVER snapshot during the hydrating
     render by design, so a copy taken then is the shipped default pretending to
     be the person's theme. */
  const state = useTheme();

  /* ------------------------------------------------------------- controls */

  const [seedText, setSeedText] = React.useState("");
  const [seedMode, setSeedMode] = React.useState<"verbatim" | "derive">("verbatim");
  const [mode, setMode] = React.useState<Mode | "auto">("auto");
  const [harmony, setHarmony] = React.useState<Harmony | "auto">("auto");
  const [forceHue, setForceHue] = React.useState(false);
  const [hue, setHue] = React.useState(210);

  /** What the controls currently mean, in the engine's own option shape. */
  const options = React.useMemo<RollOptions>(() => {
    const out: RollOptions = {};
    if (mode !== "auto") (out as { mode?: Mode }).mode = mode;
    if (harmony !== "auto") (out as { harmony?: Harmony }).harmony = harmony;
    if (forceHue) (out as { hue?: number }).hue = hue;
    return out;
  }, [mode, harmony, forceHue, hue]);

  /** The seed the Roll button will use, shown before it is used. */
  const pendingSeed = React.useMemo(() => {
    const text = seedText.trim();
    if (!text) return null; // a fresh one is derived at click time
    if (seedMode === "verbatim") return text;
    // `seedFrom(input: string | number)` — a numeric field is handed over as a
    // number, which is the advertised signature. It stringifies internally, so
    // 42 and "42" are the same seed by construction.
    return /^-?\d+$/.test(text) ? seedFrom(Number(text)) : seedFrom(text);
  }, [seedText, seedMode]);

  /* ------------------------------------------------------------ the rolls */

  const [session, setSession] = React.useState<readonly RollEntry[]>([]);
  const [selectedSeed, setSelectedSeed] = React.useState<string | null>(null);
  const counter = React.useRef(0);

  /**
   * The store's own history, regenerated from its seeds.
   *
   * Regenerated with the store's CURRENT options because that is exactly what
   * `ThemeStore.state()` does when it resolves the active seed — a history entry
   * shown under different options than the store would use is a history entry
   * that lies about what clicking it produces.
   */
  const history = React.useMemo<readonly RollEntry[]>(() => {
    // DEDUPED, newest occurrence first. The store's history legitimately holds
    // a seed twice (apply → step back → apply something else re-appends), and
    // rendering both meant two children keyed `history:<seed>` — React's
    // duplicate-key error, observed live on 2026-08-12. One row per seed is
    // also the honest list: the row REPRESENTS the seed, not the visit.
    const seen = new Set<string>();
    const out: RollEntry[] = [];
    for (const seed of [...state.history].reverse()) {
      if (seen.has(seed)) continue;
      seen.add(seed);
      out.push(entryOf(seed, state.options, "history"));
    }
    return out;
  }, [state.history, state.options]);

  const roll = React.useCallback(() => {
    // No seed typed: derive a fresh one exactly as `ThemeStore.roll()` does.
    const seed =
      pendingSeed ?? seedFrom(`${Date.now()}:${counter.current++}:${session.length}`);
    const entry = entryOf(seed, options, "session");
    setSession((prev) => [entry, ...prev.filter((e) => e.rolled.seed !== seed)].slice(0, SESSION_LIMIT));
    setSelectedSeed(seed);

    /*
     * A roll changes the APP, not just the panel next to the button.
     *
     * This used to only push a candidate into the session list and select it
     * for preview — "roll to find, apply to keep" — and the owner reported it
     * twice as the same complaint: *"roll is only changing the preview pane not
     * the app"*. It is also what `ThemeStore`'s own first rule says should
     * happen: selecting a theme applies it immediately, there is no preview
     * mode and no apply button.
     *
     * Nothing is lost by committing here. Every roll stays in the session list
     * with its own Apply, and `back()`/`forward()` still walk the store's
     * history, so any roll passed over is one click away.
     */
    themeStore.apply(seed, options);
    themeStore.commitPreview();
    themeStore.beginPreview();
  }, [pendingSeed, options, session.length]);

  /**
   * What is being previewed.
   *
   * Derived at render rather than initialised into state, for the hydration
   * reason above: seeding `selectedSeed` from `state.seed` at mount would
   * capture the server snapshot's `null` and then never follow the real theme
   * arriving one commit later.
   */
  const selected = React.useMemo<RollEntry | null>(() => {
    const pool = [...session, ...history];
    if (selectedSeed) {
      const found = pool.find((e) => e.rolled.seed === selectedSeed);
      if (found) return found;
      // A seed typed and rolled, then applied — still previewable by regenerating.
      return entryOf(selectedSeed, options, "session");
    }
    if (session.length) return session[0];
    if (state.seed) return entryOf(state.seed, state.options, "history");
    return null;
  }, [selectedSeed, session, history, options, state.seed, state.options]);

  /**
   * The determinism claim, checked rather than asserted.
   *
   * Re-rolls the selected seed under the same options and compares against the
   * theme actually being previewed. This is the engine's central promise — a
   * theme that cannot be reproduced from its seed is a random theme with a
   * label — so it is verified on screen, every roll, instead of trusted.
   */
  const deterministic = React.useMemo(() => {
    if (!selected) return null;
    const again = rollTheme(selected.rolled.seed, selected.options);
    return (
      JSON.stringify(again.values) === JSON.stringify(selected.rolled.values) &&
      again.mode === selected.rolled.mode &&
      again.harmony === selected.rolled.harmony
    );
  }, [selected]);

  const [copied, setCopied] = React.useState(false);
  const copySeed = React.useCallback(async (seed: string) => {
    try {
      await navigator.clipboard.writeText(seed);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked (insecure origin, denied permission) — the seed is on
         screen and selectable, which is why this is not worth an error state */
    }
  }, []);

  const applied = (entry: RollEntry) =>
    state.seed === entry.rolled.seed && sameOptions(state.options, entry.options);

  const apply = React.useCallback((entry: RollEntry) => {
    // The ONE store, the ONE key, its own instant save. Options go with the
    // seed so what was previewed is what lands.
    themeStore.apply(entry.rolled.seed, entry.options);
    /*
     * Applying a roll is an APPLIED act, not a preview edit.
     *
     * This line was missing when the designer's preview landed on 2026-08-12,
     * and the symptom was precise: the roll repainted the app while the designer
     * was open, then every nav click — a full document load — restored the
     * theme from storage, which the preview had deliberately not written. The
     * owner saw it as *"2 different themes some dark some light"*, because a
     * roll is the one action that routinely flips the whole palette, so the
     * designer showed dark and every other page showed the light theme still on
     * disk. Reported as "the roll only shows in the preview".
     *
     * `SavedThemes.applySaved` already committed for exactly this reason and
     * this path was simply not wired to match. Choosing a roll and choosing a
     * saved look are the same act.
     *
     * Re-armed immediately, as everywhere else: the designer is still open, so
     * the next dial turn must be a preview again.
     */
    themeStore.commitPreview();
    themeStore.beginPreview();
    setSelectedSeed(entry.rolled.seed);
  }, []);

  /*
   * History is the same act as applying a roll — it REPLACES the theme in force
   * with one that was in force before — so it commits too. Stepping back and
   * then navigating used to land on a third theme: neither what the roller was
   * showing nor what the person stepped back to, but whatever was last written.
   */
  const step = React.useCallback((go: () => boolean) => {
    if (!go()) return;
    themeStore.commitPreview();
    themeStore.beginPreview();
  }, []);

  /* --------------------------------------------------------------- render */

  return (
    <Box
      sx={{
        display: "grid",
        gap: 2,
        alignItems: "start",
        gridTemplateColumns: { xs: "1fr", lg: "minmax(420px, 38%) 1fr" }
      }}
    >
      {/* ------------------------------------------------------ left: controls */}
      <Box sx={{ display: "grid", gap: 1.5 }}>
        <Paper variant="outlined" sx={{ p: 1.5, display: "grid", gap: 1.5 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Glyph id="icon-sparkle" size={16} />
            <Typography variant="subtitle2">Roll a theme</Typography>
            <Box sx={{ flex: 1 }} />
            <Chip
              size="small"
              variant="outlined"
              label="model-free · deterministic"
              sx={{ ...MONO, height: 19 }}
            />
          </Stack>

          <TextField
            size="small"
            fullWidth
            label="Seed or phrase"
            placeholder="leave empty for a fresh seed"
            value={seedText}
            onChange={(e) => setSeedText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") roll();
            }}
            helperText={
              pendingSeed
                ? seedMode === "verbatim"
                  ? `rolls seed "${pendingSeed}" — exactly as given, so a shared seed round-trips`
                  : `seedFrom() → "${pendingSeed}"`
                : "empty — a fresh seed is derived per roll"
            }
            slotProps={{ input: { sx: MONO } }}
          />

          <ToggleButtonGroup
            size="small"
            exclusive
            fullWidth
            value={seedMode}
            onChange={(_, v: "verbatim" | "derive" | null) => v && setSeedMode(v)}
          >
            <ToggleButton value="verbatim">Use as seed</ToggleButton>
            <ToggleButton value="derive">Derive (seedFrom)</ToggleButton>
          </ToggleButtonGroup>

          <Divider />

          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Typography variant="caption" sx={{ color: "text.secondary", minWidth: 56 }}>
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
            <InputLabel id="axs-harmony-label">Harmony</InputLabel>
            <Select
              labelId="axs-harmony-label"
              label="Harmony"
              value={harmony}
              onChange={(e) => setHarmony(e.target.value as Harmony | "auto")}
            >
              <MenuItem value="auto">Auto — the seed decides</MenuItem>
              {/* From HARMONIES itself, rotations and all: a fifth rule added to
                  generate.ts appears here with no edit to this file. */}
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
              control={
                <Switch size="small" checked={forceHue} onChange={(_, v) => setForceHue(v)} />
              }
              label={
                <Typography variant="caption">
                  Force base hue{forceHue ? ` — ${hue}°` : ""}
                </Typography>
              }
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

          <Button variant="contained" onClick={roll} startIcon={<Glyph id="icon-reload" size={14} />}>
            Roll
          </Button>
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            A roll is computed and previewed, not applied. Nothing changes the theme in force until
            you apply it — which is what `ThemeScope` is for.
          </Typography>
        </Paper>

        {/* ------------------------------------------------------- the audit */}
        {selected ? (
          <Paper variant="outlined" sx={{ p: 1.5, display: "grid", gap: 1 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Glyph id="icon-eye" size={15} />
              <Typography variant="subtitle2">Audit</Typography>
              <Box sx={{ flex: 1 }} />
              <Chip
                size="small"
                variant="outlined"
                label={`${AUDITED_DIALS.length} contrast pairs`}
                sx={{ ...MONO, height: 19 }}
              />
            </Stack>

            {selected.warnings.length ? (
              <Alert severity="warning" sx={{ py: 0.25 }}>
                <Stack spacing={0.25}>
                  {selected.warnings.map((w) => (
                    <Typography key={w} variant="caption" sx={MONO}>
                      {w}
                    </Typography>
                  ))}
                </Stack>
              </Alert>
            ) : (
              <Alert severity="success" sx={{ py: 0 }}>
                <Typography variant="caption">
                  `auditTheme()` returned no warnings for this roll.
                </Typography>
              </Alert>
            )}

            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              The verdict above is `auditTheme()`&apos;s, unedited — this surface holds no contrast
              rules of its own. The generator CLAMPS rather than re-rolls, so a warning means a clamp
              regressed and is worth reporting. A warned roll can still be applied: this is a
              designer, not a gate.
            </Typography>

            {/* The generator's OWN achieved ratios, shown as data. Deliberately
                uncoloured: deciding pass/fail here would be a second opinion,
                and a second opinion that disagrees by an epsilon is worse than
                none. The warnings list above is the only verdict. */}
            <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: "wrap" }}>
              {AUDITED_DIALS.map((dial) => {
                const ratio = selected.rolled.contrast[dial.id];
                if (ratio === undefined) return null;
                return (
                  <Tooltip
                    key={dial.id}
                    title={`${dial.id} on ${dial.contrastAgainst} — the spec asks for ${dial.minContrast}:1`}
                  >
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`${dial.id} ${ratio.toFixed(2)}:1`}
                      sx={{ ...MONO, height: 19 }}
                    />
                  </Tooltip>
                );
              })}
            </Stack>
          </Paper>
        ) : null}
      </Box>

      {/* -------------------------------------------------- right: the preview */}
      <Box sx={{ display: "grid", gap: 1.5 }}>
        {selected ? (
          <>
            <Paper variant="outlined" sx={{ p: 1.5, display: "grid", gap: 1 }}>
              <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
                <Typography variant="subtitle2">{selected.rolled.name}</Typography>
                <Chip size="small" label={selected.rolled.seed} sx={{ ...MONO, height: 20 }} />
                <Tooltip title="Copy the seed. Six characters that regenerate this exact theme anywhere — that is the point of a seeded engine.">
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => copySeed(selected.rolled.seed)}
                  >
                    {copied ? "Copied" : "Copy seed"}
                  </Button>
                </Tooltip>
                <Chip
                  size="small"
                  variant="outlined"
                  label={`${selected.rolled.mode} · ${selected.rolled.harmony}`}
                  sx={{ ...MONO, height: 20 }}
                />
                <Tooltip
                  title={
                    deterministic
                      ? "Re-rolled this seed under the same options and compared every value — identical. The engine's central promise, checked rather than assumed."
                      : "Re-rolling this seed produced a DIFFERENT theme. The generator is no longer deterministic and a shared seed no longer reproduces."
                  }
                >
                  <Chip
                    size="small"
                    color={deterministic ? "success" : "error"}
                    label={deterministic ? "deterministic ✓" : "NOT deterministic"}
                    sx={{ ...MONO, height: 20 }}
                  />
                </Tooltip>
                <Box sx={{ flex: 1 }} />
                <Button
                  size="small"
                  variant="contained"
                  disabled={applied(selected)}
                  onClick={() => apply(selected)}
                >
                  {applied(selected) ? "Applied" : "Apply"}
                </Button>
              </Stack>

              <Swatches rolled={selected.rolled} size={16} />

              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                Rolled with: {optionSummary(selected.options)}. Forced options are part of what
                reproduces this theme — a seed alone reproduces it only when the seed decided
                everything. Applying carries them across, so what is previewed is what lands.
              </Typography>
            </Paper>

            <PreviewPanel
              values={selected.rolled.values}
              pack={pack}
              title={applied(selected) ? "Roll — applied" : "Roll — preview"}
              note={`seed ${selected.rolled.seed}, in its own scope`}
            />
          </>
        ) : (
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Typography variant="body2" color="text.secondary">
              Nothing rolled yet. Roll one — it is previewed here beside the theme in force, and
              nothing is applied until you say so.
            </Typography>
          </Paper>
        )}

        {/* ------------------------------------------------------- history */}
        <Paper variant="outlined" sx={{ p: 1.5, display: "grid", gap: 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Glyph id="icon-history" size={15} />
            <Typography variant="subtitle2">Rolls</Typography>
            <Box sx={{ flex: 1 }} />
            <Tooltip title="Step back through the store's own applied history.">
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={state.historyIndex <= 0}
                  onClick={() => step(themeStore.back)}
                >
                  Back
                </Button>
              </span>
            </Tooltip>
            <Tooltip title="Step forward through the store's own applied history.">
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={state.historyIndex >= state.history.length - 1}
                  onClick={() => step(themeStore.forward)}
                >
                  Forward
                </Button>
              </span>
            </Tooltip>
          </Stack>

          <RollList
            title="This session — rolled, not yet applied"
            empty="Nothing rolled in this session yet."
            entries={session}
            selectedSeed={selected?.rolled.seed ?? null}
            isApplied={applied}
            onPreview={(e) => setSelectedSeed(e.rolled.seed)}
            onApply={apply}
          />

          <RollList
            title="Applied history — the store's own, persisted with the theme"
            empty="No theme has been applied yet; the shipped default is in force."
            entries={history}
            selectedSeed={selected?.rolled.seed ?? null}
            isApplied={applied}
            onPreview={(e) => setSelectedSeed(e.rolled.seed)}
            onApply={apply}
          />

          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            History is `ThemeStore`&apos;s, stored as SEEDS and regenerated on demand — six
            characters that reproduce a whole theme, which is why keeping them costs nothing. This
            surface adds no storage of its own: a second persistence key is how two sources of truth
            start.
          </Typography>
        </Paper>
      </Box>
    </Box>
  );
}

/* ------------------------------------------------------------- the roll list */

function RollList({
  title,
  empty,
  entries,
  selectedSeed,
  isApplied,
  onPreview,
  onApply
}: {
  title: string;
  empty: string;
  entries: readonly RollEntry[];
  selectedSeed: string | null;
  isApplied: (entry: RollEntry) => boolean;
  onPreview: (entry: RollEntry) => void;
  onApply: (entry: RollEntry) => void;
}) {
  return (
    <Box sx={{ display: "grid", gap: 0.5 }}>
      <Typography variant="caption" sx={{ color: "text.secondary", fontSize: 10, letterSpacing: "0.08em" }}>
        {title.toUpperCase()}
      </Typography>
      {entries.length === 0 ? (
        <Typography variant="caption" color="text.secondary">
          {empty}
        </Typography>
      ) : (
        <Stack spacing={0.5} sx={{ maxHeight: 240, overflow: "auto" }}>
          {entries.map((entry) => {
            const selected = entry.rolled.seed === selectedSeed;
            return (
              <Paper
                key={`${entry.origin}:${entry.rolled.seed}`}
                variant="outlined"
                sx={{
                  p: 0.75,
                  borderColor: selected ? "primary.main" : "divider",
                  bgcolor: selected ? "action.selected" : "transparent"
                }}
              >
                <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
                  <Chip size="small" label={entry.rolled.seed} sx={{ ...MONO, height: 19 }} />
                  <Typography variant="caption" sx={{ minWidth: 120 }}>
                    {entry.rolled.name}
                  </Typography>
                  <Swatches rolled={entry.rolled} />
                  {entry.warnings.length ? (
                    <Tooltip title={entry.warnings.join("\n")}>
                      <Chip
                        size="small"
                        color="warning"
                        label={`${entry.warnings.length} audit warning${entry.warnings.length === 1 ? "" : "s"}`}
                        sx={{ ...MONO, height: 19 }}
                      />
                    </Tooltip>
                  ) : null}
                  <Box sx={{ flex: 1 }} />
                  <Button size="small" onClick={() => onPreview(entry)}>
                    Preview
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={isApplied(entry)}
                    onClick={() => onApply(entry)}
                  >
                    {isApplied(entry) ? "Applied" : "Apply"}
                  </Button>
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
