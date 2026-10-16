"use client";

/**
 * @file The Drawing Lab panel — the standalone lab (`:4188`) as an AmberArt tool.
 *
 * Mounted by AmberArt in its detail column when the toolbar item this plugin
 * contributes is selected. It reaches the canvas ONLY through the `ToolHost` it
 * is handed, which is the module-targeted plugin rule: never touch the core,
 * and touch the host only through its published bridge.
 *
 * ## Same engine, not a lookalike
 *
 * Every control below drives `buildSvg()` from `./generator.mjs`, which is a
 * **verbatim copy** of `build/tools/drawing-lab/generator.mjs` — the standalone
 * lab's own engine. So a given seed and parameter set draws the same tiling
 * here as it does on :4188, and `test/drawing-lab-parity.test.ts` fails the
 * build if the two copies ever diverge.
 *
 * `buildSvg` returns an OBJECT (`{ svg, cells, edges, W, H, ms }`), not markup —
 * the document is `.svg`. That tripped this build once already, which is why
 * the parity test asserts the shape rather than trusting it.
 *
 * ## Why the regenerate is debounced
 *
 * Generation itself is cheap (~15 ms at A4), but the result is up to ~460 KB of
 * markup and the browser has to PARSE that on every change. Dragging a slider
 * un-debounced repaints half a megabyte per tick. 150 ms is below the threshold
 * where a drag feels laggy and well above the parse cost.
 */

import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";

import { GX } from "../amberart-shared";
import { GxChip } from "../amberart-shared";
import type { ToolHost } from "../../modules/amberart/host";
import { DEFAULTS, buildSvg, type DrawingLabParams, type DrawingLabResult } from "./generator";

/** The sliders, in the standalone lab's own order, with its own ranges. */
const SLIDERS: { id: keyof DrawingLabParams; label: string; min: number; max: number; step: number }[] = [
  { id: "size", label: "Shape size", min: 60, max: 460, step: 2 },
  { id: "complexity", label: "Complexity", min: 0, max: 100, step: 1 },
  { id: "smoothness", label: "Smoothness", min: 0, max: 100, step: 1 },
  { id: "maxAngle", label: "Maximum angle", min: 5, max: 85, step: 1 },
  { id: "spacing", label: "Spacing", min: 0, max: 60, step: 1 },
  { id: "thickness", label: "Thickness", min: 0, max: 18, step: 0.2 },
  { id: "strokeOpacity", label: "Stroke opacity", min: 0, max: 100, step: 1 },
  { id: "fillOpacity", label: "Fill opacity", min: 0, max: 100, step: 1 },
  { id: "spread", label: "Palette spread", min: 0, max: 360, step: 1 },
  { id: "lightVar", label: "Palette light variance", min: 0, max: 60, step: 1 },
];

const COLOURS: { id: "bg" | "stroke" | "fill"; label: string }[] = [
  { id: "bg", label: "Background" },
  { id: "stroke", label: "Stroke" },
  { id: "fill", label: "Fill" },
];

/**
 * Page presets, inlined from the plugin's GizmoX sui.
 *
 * They were a setting there only because the sui existed to hold them; the
 * control is right here in the panel, which is where a page size belongs.
 */
const PAGE_PRESETS: readonly { value: string; label: string }[] = [
  { value: "a4-landscape", label: "A4 landscape" },
  { value: "a4-portrait", label: "A4 portrait" },
  { value: "letter-landscape", label: "Letter landscape" },
  { value: "letter-portrait", label: "Letter portrait" },
  { value: "square", label: "Square" },
  { value: "canvas", label: "Match the canvas" }
];

export default function DrawingLabPanel({ host }: { host: ToolHost }): React.JSX.Element {
  /* The generator's own defaults are the starting values — see the note in
     `plugins/amberart-shared.tsx` on why the sui settings did not come over. */
  const defaultPage = DEFAULTS.page;
  const defaultFill = DEFAULTS.fillMode as DrawingLabParams["fillMode"];
  /** Contain, so a generated page is never cropped by the canvas aspect. */
  const placeFit: "cover" | "contain" = "contain";

  // State holds only what the user has changed here.
  const [overrides, setOverrides] = React.useState<Partial<DrawingLabParams>>({});
  const params = React.useMemo<DrawingLabParams>(
    () => ({ ...DEFAULTS, page: defaultPage, fillMode: defaultFill, ...overrides }),
    [defaultPage, defaultFill, overrides]
  );

  const [result, setResult] = React.useState<DrawingLabResult | null>(null);
  const [busy, setBusy] = React.useState(false);

  const set = <K extends keyof DrawingLabParams>(k: K, value: DrawingLabParams[K]): void =>
    setOverrides((o) => ({ ...o, [k]: value }));

  /* Debounced regenerate — see the file header for why. Cleared on unmount. */
  React.useEffect(() => {
    setBusy(true);
    const t = setTimeout(() => {
      try {
        setResult(buildSvg(params));
      } finally {
        setBusy(false);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [params]);

  const reroll = (): void => set("seed", Math.floor(Math.random() * 2 ** 31));

  return (
    <Stack spacing={1.25}>
      <Typography sx={{ fontSize: 11, color: GX.dim }}>
        The same interlocking-tile engine as the standalone Drawing Lab, running here against the canvas.
      </Typography>

      {result && (
        <Box
          sx={{
            border: `1px solid ${GX.edge}`,
            borderRadius: 1,
            overflow: "hidden",
            opacity: busy ? 0.6 : 1,
            transition: "opacity .12s",
            "& svg": { display: "block", width: "100%", height: "auto" },
          }}
          // Safe by construction: this markup is built from clamped NUMBERS by
          // our own generator. No model text and no user text reaches it.
          dangerouslySetInnerHTML={{ __html: result.svg }}
        />
      )}

      <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        {result && <GxChip label={`${result.cells} pieces`} />}
        {result && <GxChip label={`${result.edges} edges`} kind="info" />}
        {result && <GxChip label={`${result.ms} ms`} />}
        {result && <GxChip label={`${result.W}×${result.H}`} />}
      </Stack>

      <Stack direction="row" spacing={1}>
        <Button
          size="small"
          variant="outlined"
          disabled={!result}
          onClick={() => result && void host.placeSvg(result.svg, { fit: placeFit })}
        >
          Place on canvas
        </Button>
        <Button
          size="small"
          disabled={!result}
          onClick={() => {
            if (!result) return;
            void navigator.clipboard.writeText(result.svg);
            host.notify("SVG copied");
          }}
        >
          Copy SVG
        </Button>
      </Stack>

      {/* seed */}
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <TextField
          size="small"
          type="number"
          label="Seed"
          value={params.seed}
          onChange={(e) => set("seed", Number(e.target.value) || 0)}
          sx={{ flex: 1 }}
        />
        <Button size="small" variant="outlined" onClick={reroll}>
          Re-roll ⟳
        </Button>
      </Stack>

      {/* the sliders */}
      {SLIDERS.map((s) => (
        <Stack key={s.id} direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography sx={{ fontSize: 11, color: GX.dim, width: 128 }}>{s.label}</Typography>
          <Slider
            size="small"
            min={s.min}
            max={s.max}
            step={s.step}
            value={Number(params[s.id])}
            onChange={(_, n) => set(s.id, n as never)}
            sx={{ flex: 1 }}
          />
          <Typography sx={{ fontSize: 11, width: 38, fontFamily: GX.mono, textAlign: "right" }}>
            {Number(params[s.id]).toFixed(s.step < 1 ? 1 : 0)}
          </Typography>
        </Stack>
      ))}

      {/* fill mode */}
      <ToggleButtonGroup
        exclusive
        size="small"
        fullWidth
        value={params.fillMode}
        onChange={(_, next) => next && set("fillMode", next as DrawingLabParams["fillMode"])}
      >
        <ToggleButton value="none">No fill</ToggleButton>
        <ToggleButton value="solid">Solid</ToggleButton>
        <ToggleButton value="palette">Palette</ToggleButton>
      </ToggleButtonGroup>

      {/* colours */}
      <Stack direction="row" spacing={1}>
        {COLOURS.map((c) => (
          <Stack key={c.id} spacing={0.25} sx={{ flex: 1 }}>
            <Typography sx={{ fontSize: 11, color: GX.dim }}>{c.label}</Typography>
            {/* `Box component="input"` rather than a raw one: `check:ui` is
                right that a bare <input> escapes the theme, and a colour well
                has no MUI component of its own — the browser owns the swatch
                widget. Going through Box puts it in the sx/theme system, which
                is what the rule is actually asking for. */}
            <Box
              component="input"
              type="color"
              aria-label={c.label}
              value={String(params[c.id])}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set(c.id, e.target.value)}
              sx={{
                width: "100%",
                height: 26,
                padding: 0,
                background: "none",
                border: `1px solid ${GX.edge}`,
                borderRadius: "var(--axf-radius-tight)",
                cursor: "pointer"
              }}
            />
          </Stack>
        ))}
      </Stack>

      {/* page */}
      <TextField
        select
        size="small"
        label="Page"
        value={params.page}
        onChange={(e) => set("page", e.target.value)}
      >
        {PAGE_PRESETS.map((p: { value: string; label: string }) => (
          <MenuItem key={p.value} value={p.value}>
            {p.label}
          </MenuItem>
        ))}
      </TextField>

      <Button size="small" onClick={() => setOverrides({})}>
        Reset to defaults
      </Button>
    </Stack>
  );
}
