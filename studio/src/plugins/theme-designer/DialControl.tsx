/**
 * @file One dial, one control — chosen by the dial's `kind` and nothing else.
 *
 * The whole of this file's contract is the switch below: `color` → a colour
 * control, `number` → a Slider carrying the dial's own min/max/step, `enum` → a
 * Select of its declared options, `text` → a text field offering its candidate
 * values. **There is no branch on a dial id anywhere in this component**, which
 * is the property that makes a dial added to `spec.ts` appear here with no edit:
 * the spec already carries the type, the range, the options, the unit, the
 * label, the effect line and the CSS variable, so a control can be drawn from it
 * without knowing what the dial means.
 *
 * A switch on ids would look like a small convenience and would be the exact
 * failure `spec.ts`'s own docblock names — "the SDK designer renders a control
 * per dial, so it cannot drift out of sync with what the engine actually
 * supports". A designer that has to be edited per dial drifts on the first one
 * somebody forgets.
 *
 * ## Local state is for keystrokes, never for values
 *
 * The displayed value is read from `values` on every render — never copied into
 * `useState` at mount. GizmoX's settings hooks hand back SPEC DEFAULTS on render
 * one and the real value only after hydration, so a control seeded from the
 * first render pins itself to the default and silently publishes it back; the
 * same class of bug forced its 181-token theme-editor grid to learn "rehydrate
 * or it breaks". `useTheme()` has the identical shape here by design (it reads
 * through `ThemeStore.serverState()` during hydration), so the rule is the same.
 *
 * The one thing held locally is an in-flight EDIT: `#ff7` on the way to
 * `#ff7a1a`, or `1` on the way to `12`. Those are keystrokes, not values — they
 * are discarded on blur and never committed, because committing them would
 * publish a colour nobody chose.
 */
"use client";

import * as React from "react";

import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { contrast, dependentsOf, Glyph } from "@axf/core";
import type { ColorDial, Dial, EnumDial, NumberDial, TextDial, ThemeValues } from "@axf/core";

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export interface DialControlProps {
  readonly dial: Dial;
  /** The live theme. Read through on every render; never snapshotted. */
  readonly values: ThemeValues;
  readonly onChange: (dialId: string, value: string | number) => void;
  /** The value before hand edits — the rolled theme's, or the shipped default. */
  readonly baseValue: string | number;
  /** True when an override is layered over the base value. */
  readonly overridden: boolean;
  /** Set when the ACTIVE PACK, not the theme, decides this dial's variable. */
  readonly packOverride: string | null;
  /** Highlighted when this was the dial the last publication came from. */
  readonly recent: boolean;
}

/* ------------------------------------------------------------ per-kind bits */

function ColorControl({
  dial,
  values,
  onChange
}: {
  dial: ColorDial;
  values: ThemeValues;
  onChange: (v: string) => void;
}) {
  const value = String(values[dial.id] ?? dial.default);
  const [draft, setDraft] = React.useState<string | null>(null);

  const commit = (next: string) => {
    setDraft(next);
    if (HEX6.test(next)) onChange(next.toLowerCase());
  };

  /* The legibility contract, measured against the dial it is declared against —
     the same comparison `auditTheme` makes, shown at the control that causes it
     rather than only in a report after the fact. */
  const against = dial.contrastAgainst ? String(values[dial.contrastAgainst] ?? "") : "";
  const ratio =
    dial.minContrast && HEX6.test(value) && HEX6.test(against) ? contrast(value, against) : null;

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      <TextField
        type="color"
        size="small"
        value={HEX6.test(value) ? value : "#000000"}
        onChange={(e) => commit(e.target.value)}
        slotProps={{ htmlInput: { "aria-label": `${dial.label} colour` } }}
        sx={{ width: 54, "& input": { p: "2px", height: 28, cursor: "pointer" } }}
      />
      <TextField
        size="small"
        value={draft ?? value}
        onChange={(e) => commit(e.target.value)}
        onBlur={() => setDraft(null)}
        error={draft !== null && !HEX6.test(draft)}
        slotProps={{
          htmlInput: { spellCheck: false, "aria-label": `${dial.label} hex`, "data-dial": dial.id }
        }}
        sx={{ width: 116, "& input": { fontFamily: "var(--axf-mono)", fontSize: 12.5 } }}
      />
      {ratio !== null && dial.minContrast ? (
        <Tooltip
          title={`${dial.id} on ${dial.contrastAgainst} — the generator CLAMPS this to ${dial.minContrast}:1; a hand edit is not clamped.`}
        >
          <Chip
            size="small"
            variant={ratio + 0.005 < dial.minContrast ? "filled" : "outlined"}
            color={ratio + 0.005 < dial.minContrast ? "error" : "default"}
            label={`${ratio.toFixed(2)}:1`}
            sx={{ fontFamily: "var(--axf-mono)", fontSize: 11 }}
          />
        </Tooltip>
      ) : null}
    </Stack>
  );
}

function NumberControl({
  dial,
  values,
  onChange
}: {
  dial: NumberDial;
  values: ThemeValues;
  onChange: (v: number) => void;
}) {
  const raw = Number(values[dial.id]);
  const value = Number.isFinite(raw) ? raw : dial.default;
  const [draft, setDraft] = React.useState<string | null>(null);

  const commit = (next: number) => {
    if (!Number.isFinite(next)) return;
    onChange(Math.min(dial.max, Math.max(dial.min, next)));
  };

  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: "center", pr: 0.5 }}>
      <Slider
        size="small"
        value={value}
        min={dial.min}
        max={dial.max}
        step={dial.step}
        marks={false}
        valueLabelDisplay="auto"
        onChange={(_, next) => commit(Array.isArray(next) ? next[0] : next)}
        aria-label={dial.label}
        // The probe drives THIS element, so it is addressable by dial id rather
        // than by position — a positional selector silently measures a
        // different dial the day one is added to the spec.
        data-dial={dial.id}
        data-dial-kind="number"
        sx={{ flex: 1, minWidth: 90 }}
      />
      <TextField
        size="small"
        value={draft ?? String(value)}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(n)) commit(n);
        }}
        onBlur={() => setDraft(null)}
        slotProps={{
          htmlInput: { inputMode: "decimal", "aria-label": `${dial.label} value` },
          input: dial.unit
            ? {
                endAdornment: (
                  <InputAdornment position="end" sx={{ "& p": { fontSize: 10.5 } }}>
                    {dial.unit === "em/100" ? "/100em" : dial.unit}
                  </InputAdornment>
                )
              }
            : undefined
        }}
        sx={{ width: 108, "& input": { fontFamily: "var(--axf-mono)", fontSize: 12.5 } }}
      />
    </Stack>
  );
}

function EnumControl({
  dial,
  values,
  onChange
}: {
  dial: EnumDial;
  values: ThemeValues;
  onChange: (v: string) => void;
}) {
  const value = String(values[dial.id] ?? dial.default);
  const known = dial.options.includes(value);
  return (
    <TextField
      select
      size="small"
      fullWidth
      value={known ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      // A value outside the declared options is a real state (a hand-edited
      // persisted theme, or an option removed from the spec). Saying so beats
      // rendering an empty Select that looks like a bug in the control.
      helperText={known ? undefined : `stored value "${value}" is not a declared option`}
      error={!known}
      slotProps={{
        htmlInput: { "aria-label": dial.label, "data-dial": dial.id, "data-dial-kind": "enum" }
      }}
      sx={{ "& .MuiSelect-select": { fontFamily: "var(--axf-mono)", fontSize: 12.5 } }}
    >
      {dial.options.map((option) => (
        <MenuItem key={option} value={option} sx={{ fontFamily: "var(--axf-mono)", fontSize: 12.5 }}>
          {option}
        </MenuItem>
      ))}
    </TextField>
  );
}

function TextControl({
  dial,
  values,
  onChange
}: {
  dial: TextDial;
  values: ThemeValues;
  onChange: (v: string) => void;
}) {
  const value = String(values[dial.id] ?? dial.default);
  return (
    <Autocomplete
      freeSolo
      size="small"
      disableClearable
      options={[...dial.options]}
      value={value}
      // Free text is the point (a font stack the spec never listed is still a
      // valid font stack), so both channels commit: picking an option and
      // typing one. The candidates are the roller's, offered rather than
      // enforced.
      onChange={(_, next) => onChange(typeof next === "string" ? next : value)}
      onInputChange={(_, next, reason) => {
        if (reason === "input") onChange(next);
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          slotProps={{
            ...params.slotProps,
            htmlInput: {
              ...params.slotProps.htmlInput,
              spellCheck: false,
              "aria-label": dial.label,
              "data-dial": dial.id,
              "data-dial-kind": "text"
            }
          }}
        />
      )}
      sx={{ "& input": { fontFamily: "var(--axf-mono)", fontSize: 12 } }}
    />
  );
}

/* ------------------------------------------------------------- the control */

export default function DialControl({
  dial,
  values,
  onChange,
  baseValue,
  overridden,
  packOverride,
  recent
}: DialControlProps) {
  const set = React.useCallback(
    (value: string | number) => onChange(dial.id, value),
    [dial.id, onChange]
  );

  /* The cascade, stated on every dial rather than only on the one just moved:
     `dependentsOf` is the dependency list `derived.ts` already declares, so a
     dial that drives eleven tokens says so before it is touched. */
  const dependents = React.useMemo(() => dependentsOf(dial.id), [dial.id]);

  let control: React.ReactNode;
  switch (dial.kind) {
    case "color":
      control = <ColorControl dial={dial} values={values} onChange={set} />;
      break;
    case "number":
      control = <NumberControl dial={dial} values={values} onChange={set} />;
      break;
    case "enum":
      control = <EnumControl dial={dial} values={values} onChange={set} />;
      break;
    case "text":
      control = <TextControl dial={dial} values={values} onChange={set} />;
      break;
    default: {
      // Unreachable while `Dial` is a closed union — and deliberately loud if a
      // sixth kind is added to the spec, because the alternative is a dial that
      // renders as nothing and reads as "the engine dropped it".
      const missing: never = dial;
      control = (
        <Typography variant="caption" color="error">
          no control for dial kind {String((missing as Dial).kind)}
        </Typography>
      );
    }
  }

  return (
    <Box
      data-dial-row={dial.id}
      sx={{
        py: 1,
        px: 1.25,
        borderRadius: 1,
        borderLeft: 2,
        borderColor: recent ? "primary.main" : "transparent",
        bgcolor: recent ? "action.hover" : "transparent",
        transition: "background-color 160ms, border-color 160ms"
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", mb: 0.5 }}>
        <Tooltip title={dial.effect} placement="top-start">
          <Typography variant="body2" sx={{ fontWeight: 600, cursor: "help" }}>
            {dial.label}
          </Typography>
        </Tooltip>
        <Typography
          variant="caption"
          sx={{ fontFamily: "var(--axf-mono)", color: "text.secondary", fontSize: 10.5 }}
        >
          {dial.cssVar}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {dependents.length > 0 ? (
          <Tooltip
            title={
              <Box component="span" sx={{ fontFamily: "var(--axf-mono)", fontSize: 11 }}>
                {dependents.map((d) => d.cssVar).join(", ")}
              </Box>
            }
          >
            <Chip size="small" variant="outlined" label={`→ ${dependents.length}`} sx={{ height: 18, fontSize: 10 }} />
          </Tooltip>
        ) : null}
        {packOverride ? (
          <Tooltip
            title={`The active pack "${packOverride}" publishes ${dial.cssVar}, so it wins over this dial in the app and in the preview (resolve.ts states the precedence). Turning it here changes the theme's value, not what renders.`}
          >
            <Chip size="small" color="warning" variant="outlined" label="pack wins" sx={{ height: 18, fontSize: 10 }} />
          </Tooltip>
        ) : null}
        {overridden ? (
          <Tooltip title={`Overridden — the base value is ${String(baseValue)}. Click to restore it.`}>
            <IconButton
              size="small"
              aria-label={`reset ${dial.label} to its base value`}
              onClick={() => set(baseValue)}
              sx={{ width: 20, height: 20 }}
            >
              {/* A pack drawing, not a glyph character and not a Material icon:
                  the pack's SVGs are painted in the brand role variables, so
                  this recolours with the theme it is used to edit. */}
              <Glyph id="icon-reload" size={12} title="reset to base value" />
            </IconButton>
          </Tooltip>
        ) : null}
      </Stack>
      {control}
    </Box>
  );
}
