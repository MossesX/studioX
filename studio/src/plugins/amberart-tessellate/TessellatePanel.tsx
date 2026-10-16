"use client";

/**
 * @file The Tessellate tool's panel — AmberArt mounts this in its detail column
 * while the tool is selected.
 *
 * A module-targeted plugin never reaches the core, and this panel never reaches
 * AmberArt either: everything it does to the canvas goes through the `ToolHost`
 * it is handed (`size`, `placeSvg`, `notify`). It cannot see the layer model or
 * the undo stack, which is the rule for `target: module:<id>`.
 *
 * The engine's own DEFAULTS are the starting values — GizmoX fed them from this
 * plugin's sui through the settings cascade, which AmberX does not have and did
 * not need: every one of those settings was the starting position of a dial
 * that is on screen a few lines below. Dial state stays an OVERRIDE MAP so
 * "reset" is a matter of dropping the overrides rather than re-deriving them.
 */

import * as React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import MenuItem from "@mui/material/MenuItem";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { Glyph } from "@axf/core";

import { GX } from "../amberart-shared";
import type { ToolHost } from "../../modules/amberart/host";

import { DEFAULTS, buildSvg, type FillMode, type TessellateParams } from "./engine";

type DialId =
  | "size" | "complexity" | "smoothness" | "maxAngle"
  | "spacing" | "thickness" | "strokeOpacity" | "fillOpacity" | "spread";

interface Dial {
  id: DialId;
  label: string;
  min: number;
  max: number;
  step: number;
  hint?: string;
}

/** Ordered exactly as the drawing reads: structure, then line, then colour. */
const DIALS: Dial[] = [
  { id: "size", label: "Piece size", min: 60, max: 460, step: 1, hint: "Smaller = more pieces" },
  { id: "complexity", label: "Complexity", min: 0, max: 100, step: 1, hint: "Jigsaw lobes per edge" },
  { id: "smoothness", label: "Smoothness", min: 0, max: 100, step: 1, hint: "Angular → flowing" },
  { id: "maxAngle", label: "Maximum angle", min: 5, max: 85, step: 1, hint: "Caps how sharply a contour turns" },
  { id: "spacing", label: "Spacing", min: 0, max: 80, step: 1, hint: "0 interlocks; above 0 separates, contours still match" },
  { id: "thickness", label: "Thickness", min: 0.2, max: 14, step: 0.1 },
  { id: "strokeOpacity", label: "Stroke opacity", min: 0, max: 100, step: 1 },
  { id: "fillOpacity", label: "Fill opacity", min: 0, max: 100, step: 1 },
  { id: "spread", label: "Hue spread", min: 0, max: 360, step: 1, hint: "Palette fill only" },
];

/** A colour setting is "" when it means "inherit the theme". */
const colorOr = (value: string, fallback: string): string => (value.trim() ? value : fallback);

export default function TessellatePanel({ host }: { host: ToolHost }): React.JSX.Element {
  /*
   * These came from the plugin's own sui in GizmoX, through the settings
   * cascade. AmberX has no cascade, and none of them earned a setting on their
   * own terms: every one is the STARTING value of a dial that is on screen a
   * few lines below. So the engine's DEFAULTS are the starting values, and the
   * dials are the settings — see `plugins/amberart-shared.tsx`.
   */
  const fromSettings = React.useMemo<Record<DialId, number>>(
    () => ({
      size: DEFAULTS.size,
      complexity: DEFAULTS.complexity,
      smoothness: DEFAULTS.smoothness,
      maxAngle: DEFAULTS.maxAngle,
      spacing: DEFAULTS.spacing,
      spread: DEFAULTS.spread,
      thickness: DEFAULTS.thickness,
      strokeOpacity: DEFAULTS.strokeOpacity,
      fillOpacity: DEFAULTS.fillOpacity,
    }),
    []
  );

  const settingFillMode: FillMode = "palette";
  const settingFill = colorOr("", "#2F6FB0");
  const settingStroke = colorOr("", DEFAULTS.stroke);
  const settingBg = colorOr("", DEFAULTS.bg);
  /** The engine's own guard against a dial combination that would draw forever. */
  const maxPieces = 4000;

  const [dials, setDials] = React.useState<Partial<Record<DialId, number>>>({});
  const [fillMode, setFillMode] = React.useState<FillMode | null>(null);
  const [fill, setFill] = React.useState<string | null>(null);
  const [stroke, setStroke] = React.useState<string | null>(null);
  const [bg, setBg] = React.useState<string | null>(null);
  const [seed, setSeed] = React.useState(DEFAULTS.seed);

  const params = React.useMemo<TessellateParams>(
    () => ({
      ...DEFAULTS,
      ...fromSettings,
      ...dials,
      fillMode: fillMode ?? settingFillMode,
      fill: fill ?? settingFill,
      stroke: stroke ?? settingStroke,
      bg: bg ?? settingBg,
      seed,
      width: Math.max(64, Math.round(host.size.width)),
      height: Math.max(64, Math.round(host.size.height)),
    }),
    [fromSettings, dials, fillMode, fill, stroke, bg, seed,
     settingFillMode, settingFill, settingStroke, settingBg, host.size.width, host.size.height]
  );

  /**
   * A very small piece size on a large canvas generates tens of thousands of
   * pieces and locks the tab. Estimate BEFORE building, and say what size would
   * fit rather than just refusing.
   */
  const estimate = React.useMemo(() => {
    const m = Math.max(180, params.size * 1.6);
    const area = (params.width + 2 * m) * (params.height + 2 * m);
    return Math.round(area / (params.size * params.size * 0.9));
  }, [params.size, params.width, params.height]);

  const overBudget = estimate > maxPieces;

  // Deferred so dragging a slider stays responsive on a dense drawing.
  const deferred = React.useDeferredValue(params);
  const result = React.useMemo(
    () => (overBudget ? null : buildSvg(deferred)),
    [deferred, overBudget]
  );

  const dataUrl = React.useMemo(
    () => (result ? `data:image/svg+xml;utf8,${encodeURIComponent(result.svg)}` : null),
    [result]
  );

  const setDial = (id: DialId, value: number): void =>
    setDials((d) => ({ ...d, [id]: value }));

  const place = async (): Promise<void> => {
    if (!result) return;
    await host.placeSvg(result.svg, { fit: "cover" });
    host.notify(`Placed ${result.pieces} pieces on the canvas`);
  };

  const copy = async (): Promise<void> => {
    if (!result) return;
    await navigator.clipboard.writeText(result.svg);
    host.notify("SVG copied to the clipboard");
  };

  const reroll = (): void => {
    const next = Math.floor(Math.random() * 0xffffffff) >>> 0;
    setSeed(next);
    host.notify(`New layout — seed ${next}`);
  };

  const reset = (): void => {
    setDials({});
    setFillMode(null);
    setFill(null);
    setStroke(null);
    setBg(null);
    host.notify("Dials returned to their defaults");
  };

  return (
    <Stack spacing={1.25} sx={{ p: 1 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography sx={{ fontFamily: GX.mono, fontSize: 11, letterSpacing: 1, color: GX.dim, textTransform: "uppercase" }}>
          Tessellate
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: 11, color: GX.dim, fontVariantNumeric: "tabular-nums" }}>
          {result ? `${result.pieces} pieces · ${result.boundaries} edges · ${result.ms} ms` : `~${estimate} pieces`}
        </Typography>
      </Stack>

      {dataUrl && (
        <Box
          sx={{
            position: "relative",
            border: `1px solid ${GX.edge}`,
            borderRadius: 1,
            overflow: "hidden",
            bgcolor: params.bg,
          }}
        >
          {/* An <img> rather than inline markup: the document has its own
              clipPath id, and two inline copies would collide. */}
          <Box component="img" src={dataUrl} alt="Tessellation preview" sx={{ display: "block", width: "100%" }} />
        </Box>
      )}

      {overBudget && (
        <Alert severity="warning" sx={{ fontSize: 12 }}>
          {estimate.toLocaleString()} pieces would be generated, over the {maxPieces.toLocaleString()} limit in this
          tool&apos;s settings. Raise piece size to about {Math.ceil(
            Math.sqrt(((params.width + 700) * (params.height + 700)) / (maxPieces * 0.9))
          )} px, or raise the limit.
        </Alert>
      )}

      <Stack direction="row" spacing={0.75}>
        <Button size="small" variant="contained" startIcon={<Glyph id="icon-layers" size={13} />} disabled={!result} onClick={() => void place()}>
          Place
        </Button>
        <Button size="small" variant="outlined" startIcon={<Glyph id="icon-reload" size={13} />} onClick={reroll}>
          Re-roll
        </Button>
        <Button size="small" variant="outlined" startIcon={<Glyph id="icon-compare" size={13} />} disabled={!result} onClick={() => void copy()}>
          Copy
        </Button>
      </Stack>

      <Divider />

      {DIALS.map((d) => {
        const value = dials[d.id] ?? fromSettings[d.id];
        return (
          <Box key={d.id}>
            <Stack direction="row" sx={{ alignItems: "baseline" }}>
              <Typography sx={{ fontSize: 11, color: GX.ink }}>{d.label}</Typography>
              <Box sx={{ flex: 1 }} />
              <Typography sx={{ fontSize: 11, color: GX.dim, fontVariantNumeric: "tabular-nums" }}>
                {d.step < 1 ? value.toFixed(1) : Math.round(value)}
              </Typography>
            </Stack>
            <Slider
              size="small"
              min={d.min}
              max={d.max}
              step={d.step}
              value={value}
              onChange={(_, val) => setDial(d.id, Array.isArray(val) ? val[0] : val)}
            />
            {d.hint && <Typography sx={{ fontSize: 10, color: GX.dim, mt: -0.75 }}>{d.hint}</Typography>}
          </Box>
        );
      })}

      <TextField
        select
        size="small"
        label="Fill"
        value={fillMode ?? settingFillMode}
        onChange={(e) => setFillMode(e.target.value as FillMode)}
      >
        <MenuItem value="none">Outlines only</MenuItem>
        <MenuItem value="solid">One solid colour</MenuItem>
        <MenuItem value="palette">Palette — a colour per piece</MenuItem>
      </TextField>

      <Stack direction="row" spacing={0.75}>
        {([
          ["Fill", fill ?? settingFill, setFill],
          ["Line", stroke ?? settingStroke, setStroke],
          ["Back", bg ?? settingBg, setBg],
        ] as const).map(([label, value, set]) => (
          <Stack key={label} spacing={0.25} sx={{ flex: 1 }}>
            <Typography sx={{ fontSize: 10, color: GX.dim }}>{label}</Typography>
            <Box
              component="input"
              type="color"
              value={value}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => set(e.target.value)}
              sx={{ width: "100%", height: 26, p: 0, border: `1px solid ${GX.edge}`, borderRadius: 1, bgcolor: "transparent" }}
            />
          </Stack>
        ))}
      </Stack>

      <Button size="small" onClick={reset} sx={{ alignSelf: "flex-start", fontSize: 11, color: GX.dim }}>
        Reset to sui defaults
      </Button>
    </Stack>
  );
}
