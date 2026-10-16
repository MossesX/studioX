"use client";

/**
 * @file The ArtGen tool panel — AmberArt's generative-art surface.
 *
 * Mounted by AmberArt in its detail column when the toolbar item this plugin
 * contributes is selected. It reaches the canvas ONLY through the {@link ToolHost}
 * it is handed (`placeSvg`, `size`, `notify`) — the module-targeted plugin rule:
 * never touch the core, and touch the host only through its published bridge.
 *
 * ## One engine, and no network at all
 *
 * `./engine` is pure string work — no DOM, no `node:` imports — so the renderer
 * runs here in the browser. The whole seeded path, and every slider nudge, is
 * instant and offline.
 *
 * GizmoX's version also had `ai-directed` and `ai-direct`, which posted to
 * `/api/amberart/generate` and needed the claude CLI. AmberX's claude subsystem
 * was archived and deleted by axf-mui P0, so both are DROPPED here rather than
 * stubbed — and with them went the elapsed-time affordance they needed (
 * `ai-direct` measured 276 seconds in GizmoX, which is why it had one).
 */

import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";

import { GX } from "../amberart-shared";
import { GxChip } from "../amberart-shared";
import { buildParams, deriveDirective, fnv1a, normalizeDirective, render } from "./engine";
import { HARMONY_NAMES, type ArtDirective, type EngineMode } from "../../modules/amberart/art-types";
import type { ToolHost } from "../../modules/amberart/host";

const GALLERY_KEY = "gx:amberart-artgen:gallery";

interface Piece {
  prompt: string;
  mode: EngineMode;
  seed: string;
  svg: string;
}

/** The directive dials the panel exposes, with their legal ranges. */
const DIALS: { id: keyof ArtDirective; label: string; min: number; max: number; step: number }[] = [
  { id: "baseHue", label: "Hue", min: 0, max: 359, step: 1 },
  { id: "saturation", label: "Saturation", min: 0, max: 100, step: 1 },
  { id: "lightness", label: "Lightness", min: 10, max: 90, step: 1 },
  { id: "symmetry", label: "Symmetry", min: 3, max: 24, step: 1 },
  { id: "rings", label: "Rings", min: 0, max: 9, step: 1 },
  { id: "streamDensity", label: "Streams", min: 0, max: 1, step: 0.01 },
  { id: "filamentDensity", label: "Filaments", min: 0, max: 1, step: 0.01 },
  { id: "markDensity", label: "Marks", min: 0, max: 1, step: 0.01 },
  { id: "swirl", label: "Swirl", min: 0, max: 2, step: 0.01 },
  { id: "turbulence", label: "Turbulence", min: 0, max: 1, step: 0.01 },
  { id: "grain", label: "Grain", min: 0, max: 1, step: 0.01 },
  { id: "vignette", label: "Vignette", min: 0, max: 1, step: 0.01 },
];

export default function ArtGenPanel({ host }: { host: ToolHost }): React.JSX.Element {
  /*
   * SEEDED ONLY, in AmberX.
   *
   * GizmoX's ArtGen had three engines: seeded (this one — the prompt's FNV-1a
   * hash drives a mulberry32 PRNG, deterministic and instant), AI-directed
   * (Claude writes a directive) and AI-direct (Claude writes the SVG). The
   * claude subsystem was archived and deleted from AmberX by axf-mui P0, so
   * the two model engines have no backend here and are DROPPED rather than
   * stubbed — a button that 500s is worse than an absent one.
   *
   * The directive RENDERER is kept whole even so: it is shared with the seeded
   * path, so it costs nothing, and the day AmberX has a directive source it
   * plugs straight in.
   */
  const defaultMode: EngineMode = "seeded";
  const showSeed = true;
  const keep = 12;

  const [prompt, setPrompt] = React.useState("bioluminescent reef at midnight, cathedral of currents");
  const [modeOverride, setModeOverride] = React.useState<EngineMode | null>(null);
  const mode = modeOverride ?? defaultMode;

  const [directive, setDirective] = React.useState<ArtDirective | null>(null);
  const [svg, setSvg] = React.useState<string | null>(null);
  const [seed, setSeed] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [gallery, setGallery] = React.useState<Piece[]>([]);

  /* Gallery is read on mount, never during render (hydration). */
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(GALLERY_KEY);
      if (raw) setGallery(JSON.parse(raw) as Piece[]);
    } catch {
      /* a corrupt gallery is not worth failing the tool over */
    }
  }, []);

  const remember = React.useCallback(
    (piece: Piece) => {
      setGallery((g) => {
        const next = [piece, ...g].slice(0, Math.max(0, keep));
        try {
          window.localStorage.setItem(GALLERY_KEY, JSON.stringify(next));
        } catch {
          /* quota — keep the in-memory strip working anyway */
        }
        return next;
      });
    },
    [keep]
  );

  /** The whole no-AI path, rendered locally. */
  const renderLocal = React.useCallback((p: string, d?: ArtDirective) => {
    const s = fnv1a(p);
    const dir = d ?? deriveDirective(p);
    const out = render(buildParams(dir, p, s));
    setDirective(dir);
    setSvg(out);
    setSeed(`0x${s.toString(16).toUpperCase()}`);
    return { svg: out, seed: `0x${s.toString(16).toUpperCase()}` };
  }, []);

  const generate = async (): Promise<void> => {
    const p = prompt.trim();
    if (!p) {
      host.notify("Give it a prompt first");
      return;
    }
    setError(null);

    const out = renderLocal(p);
    remember({ prompt: p, mode, seed: out.seed, svg: out.svg });

  };

  /** Move one dial: re-derive from the current directive and re-render. */
  const nudge = (id: keyof ArtDirective, value: number): void => {
    const base = directive ?? deriveDirective(prompt);
    renderLocal(prompt.trim() || "untitled", normalizeDirective({ ...base, [id]: value }, base));
  };

  /** Every seeded piece has a directive, so the dials are always live. */
  const canDial = Boolean(directive);

  return (
    <Stack spacing={1.25}>
      <TextField
        label="Prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        size="small"
        multiline
        minRows={2}
        maxRows={4}
        fullWidth
      />

      <Typography sx={{ fontSize: 11, color: GX.dim }}>
        The prompt&apos;s own hash picks every parameter. Instant, offline, and the same words
        always give the same picture. (GizmoX also had two model-driven engines; AmberX has no
        claude subsystem, so they were dropped rather than left as buttons that fail.)
      </Typography>

      <Button variant="contained" onClick={() => void generate()} >
        Generate
      </Button>

      {error && (
        <Alert severity="error" sx={{ fontSize: 12 }}>
          {error}
        </Alert>
      )}

      {svg && (
        <>
          <Box
            sx={{
              border: `1px solid ${GX.edge}`,
              borderRadius: 1,
              overflow: "hidden",
              "& svg": { display: "block", width: "100%", height: "auto" },
            }}
            // Safe by construction: seeded/ai-directed markup is built from
            // clamped numbers by our own renderer, and ai-direct output has
            // passed `sanitizeSvg` server-side before it ever gets here.
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }}>
            {showSeed && seed && <GxChip label={seed} />}
            <GxChip label={mode} kind="info" />
            {directive?.note && (
              <Typography sx={{ fontSize: 11, color: GX.dim, flexBasis: "100%" }}>{directive.note}</Typography>
            )}
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="outlined" onClick={() => void host.placeSvg(svg, { fit: "cover" })}>
              Place on canvas
            </Button>
            <Button
              size="small"
              onClick={() => {
                void navigator.clipboard.writeText(svg);
                host.notify("SVG copied");
              }}
            >
              Copy SVG
            </Button>
          </Stack>
        </>
      )}

      {canDial && directive && (
        <Stack spacing={0.25}>
          <Typography sx={{ fontSize: 11, color: GX.dim, mt: 0.5 }}>
            Dials — these drive the same renderer the AI drives, and redraw instantly.
          </Typography>
          <TextField
            select
            size="small"
            label="Harmony"
            value={directive.harmony}
            onChange={(e) => {
              const base = directive;
              renderLocal(prompt.trim() || "untitled", normalizeDirective({ ...base, harmony: e.target.value }, base));
            }}
          >
            {HARMONY_NAMES.map((h) => (
              <MenuItem key={h} value={h}>
                {h}
              </MenuItem>
            ))}
          </TextField>
          {DIALS.map((d) => (
            <Stack key={d.id} direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Typography sx={{ fontSize: 11, color: GX.dim, width: 74 }}>{d.label}</Typography>
              <Slider
                size="small"
                min={d.min}
                max={d.max}
                step={d.step}
                value={Number(directive[d.id] ?? 0)}
                onChange={(_, n) => nudge(d.id, n as number)}
                sx={{ flex: 1 }}
              />
              <Typography sx={{ fontSize: 11, width: 38, fontFamily: GX.mono }}>
                {Number(directive[d.id] ?? 0).toFixed(d.step < 1 ? 2 : 0)}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}

      {gallery.length > 0 && (
        <Stack spacing={0.5}>
          <Typography sx={{ fontSize: 11, color: GX.dim }}>Gallery</Typography>
          <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
            {gallery.map((p, i) => (
              <Box
                key={`${p.seed}-${i}`}
                title={`${p.prompt} · ${p.mode}`}
                onClick={() => {
                  setSvg(p.svg);
                  setSeed(p.seed);
                  setPrompt(p.prompt);
                }}
                sx={{
                  width: 64,
                  height: 40,
                  border: `1px solid ${GX.edge}`,
                  borderRadius: 0.5,
                  overflow: "hidden",
                  cursor: "pointer",
                  "& svg": { width: "100%", height: "100%" },
                }}
                dangerouslySetInnerHTML={{ __html: p.svg }}
              />
            ))}
          </Box>
        </Stack>
      )}
    </Stack>
  );
}
