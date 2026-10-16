"use client";

/**
 * @file The Stickers panel — pick one, colour it, put it where you pointed.
 *
 * Mounted by AmberArt in its detail column when this plugin's toolbar item is
 * selected, and reaching the canvas only through the `ToolHost` it is handed:
 * `size`, `placeSvg`, `notify`, and nothing else.
 *
 * ## The placement pad is honest about what it cannot see
 *
 * A plugin panel has no view of the canvas — `ToolHost` gives geometry, not
 * pixels, and widening it so a sticker could preview against the artwork would
 * hand every future plugin a window onto the document. So the pad is a plain
 * rectangle at the canvas's aspect ratio with a dot in it, labelled as exactly
 * that. It shows WHERE, never WHAT is already there. A pad that pretended to
 * show the artwork and then didn't update would be worse than one that never
 * claimed to.
 *
 * ## Why the preview cannot drift from what gets placed
 *
 * Both are the same call. `composeCanvasSvg` builds the 1600×1000 document, the
 * preview renders that string and Place hands that string to the host — there
 * is no second code path that could round a number differently.
 */

import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";

import { GX, GxChip } from "../amberart-shared";
import type { ToolHost } from "../../modules/amberart/host";
import {
  DEFAULT_PLACEMENT,
  DEFAULT_STICKER_COLORS,
  DEFAULT_STICKER_ID,
  STICKERS,
  composeCanvasSvg,
  placedSize,
  stickerById,
  stickerDocument,
  type Placement,
  type StickerColors
} from "./art";

const COLOUR_FIELDS: { id: keyof StickerColors; label: string }[] = [
  { id: "primary", label: "Primary" },
  { id: "secondary", label: "Accent" },
  { id: "outline", label: "Outline" }
];

const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);

export default function StickersPanel({ host }: { host: ToolHost }): React.JSX.Element {
  const [id, setId] = React.useState<string>(DEFAULT_STICKER_ID);
  const [colors, setColors] = React.useState<StickerColors>(DEFAULT_STICKER_COLORS);
  const [place, setPlace] = React.useState<Placement>(DEFAULT_PLACEMENT);

  const sticker = React.useMemo(() => stickerById(id), [id]);

  /* The one document: previewed here, and handed to the host by Place. */
  const canvasSvg = React.useMemo(
    () => composeCanvasSvg(sticker, colors, place),
    [sticker, colors, place]
  );
  const size = placedSize(sticker, place.scale);

  /* Thumbnails are recomputed only when a colour changes — five drawings on
     every slider tick would be five string builds per frame for no gain. */
  const thumbs = React.useMemo(
    () => STICKERS.map((s) => ({ s, svg: stickerDocument(s, colors) })),
    [colors]
  );

  const setColor = (k: keyof StickerColors, v: string): void => setColors((c) => ({ ...c, [k]: v }));
  const setAt = <K extends keyof Placement>(k: K, v: number): void => setPlace((p) => ({ ...p, [k]: v }));

  /* ------------------------------------------------------- the pad ---- */

  /**
   * There is no MUI component for "drag a dot inside a box", so the geometry
   * is bespoke here exactly as `PaneLayout`'s splitter geometry is — the
   * chrome around it is still MUI, and the pad itself is a `Box`.
   */
  const padRef = React.useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = React.useState(false);

  const padAspect = host.size.width / host.size.height;

  const fromPointer = (e: React.PointerEvent<HTMLElement>): void => {
    const box = padRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return;
    setPlace((p) => ({
      ...p,
      x: Math.round(clamp(((e.clientX - box.left) / box.width) * 100, 0, 100)),
      y: Math.round(clamp(((e.clientY - box.top) / box.height) * 100, 0, 100))
    }));
  };

  return (
    <Stack spacing={1.25}>
      <Typography sx={{ fontSize: 11, color: GX.dim }}>
        Five drawings, three colours and a placement. Every sticker is geometry — it scales to the canvas
        without a single blurred edge.
      </Typography>

      {/* ---------------------------------------------------- the picker */}
      <ToggleButtonGroup
        exclusive
        size="small"
        value={sticker.id}
        onChange={(_, next) => typeof next === "string" && setId(next)}
        sx={{ flexWrap: "wrap", gap: 0.5, "& .MuiToggleButton-root": { border: `1px solid ${GX.edge}`, borderRadius: 1 } }}
      >
        {thumbs.map(({ s, svg }) => (
          <ToggleButton key={s.id} value={s.id} title={`${s.title} — ${s.note}`} sx={{ p: 0.5 }}>
            <Box
              sx={{ width: 46, height: 36, "& svg": { display: "block", width: "100%", height: "100%" } }}
              // Safe by construction: this markup is built by `art.ts` from our
              // own path data and three colour-input values, never from text.
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <Typography sx={{ fontSize: 11, color: GX.dim }}>
        <strong style={{ color: GX.ink }}>{sticker.title}</strong> — {sticker.note}
      </Typography>

      {/* --------------------------------------------------- the preview */}
      <Box
        sx={{
          border: `1px solid ${GX.edge}`,
          borderRadius: 1,
          overflow: "hidden",
          background: GX.panel2,
          "& svg": { display: "block", width: "100%", height: "auto" }
        }}
        dangerouslySetInnerHTML={{ __html: canvasSvg }}
      />

      <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <GxChip label={`${host.size.width}×${host.size.height} canvas`} />
        <GxChip label={`${size.width}×${size.height} px`} kind="info" />
        <GxChip label={`${place.x}% · ${place.y}%`} />
        {place.rotation !== 0 && <GxChip label={`${place.rotation}°`} kind="accent" />}
      </Stack>

      <Stack direction="row" spacing={1}>
        <Button
          size="small"
          variant="outlined"
          onClick={() => void host.placeSvg(canvasSvg, { fit: "contain" })}
        >
          Place on canvas
        </Button>
        <Button
          size="small"
          onClick={() => {
            /* The lockup alone, at its own size — the sticker people want to
               paste somewhere that is not this canvas. */
            void navigator.clipboard.writeText(stickerDocument(stickerById("gizmo-lockup"), colors));
            host.notify("GIZMO lockup SVG copied");
          }}
        >
          Copy SVG
        </Button>
      </Stack>

      {/* ------------------------------------------------- the placement */}
      <Typography sx={{ fontSize: 11, color: GX.dim }}>
        Drag the dot to place it. The pad is the canvas&rsquo;s shape, not its contents — a tool sees the
        canvas&rsquo;s size and nothing else.
      </Typography>
      <Box
        ref={padRef}
        onPointerDown={(e: React.PointerEvent<HTMLDivElement>) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
          fromPointer(e);
        }}
        onPointerMove={(e: React.PointerEvent<HTMLDivElement>) => {
          if (dragging) fromPointer(e);
        }}
        onPointerUp={(e: React.PointerEvent<HTMLDivElement>) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          setDragging(false);
        }}
        sx={{
          position: "relative",
          width: "100%",
          aspectRatio: `${padAspect}`,
          border: `1px solid ${GX.edge}`,
          borderRadius: 1,
          background: GX.panel2,
          cursor: dragging ? "grabbing" : "crosshair",
          touchAction: "none",
          /* Thirds, so "a bit left of centre" is a thing you can aim at. */
          backgroundImage:
            `linear-gradient(to right, transparent 33.33%, ${GX.edge} 33.33%, ${GX.edge} calc(33.33% + 1px), transparent calc(33.33% + 1px), transparent 66.66%, ${GX.edge} 66.66%, ${GX.edge} calc(66.66% + 1px), transparent calc(66.66% + 1px)),` +
            `linear-gradient(to bottom, transparent 33.33%, ${GX.edge} 33.33%, ${GX.edge} calc(33.33% + 1px), transparent calc(33.33% + 1px), transparent 66.66%, ${GX.edge} 66.66%, ${GX.edge} calc(66.66% + 1px), transparent calc(66.66% + 1px))`
        }}
      >
        {/* The footprint the sticker will occupy, to scale — the pad's one
            claim about the canvas, and one it can actually keep. */}
        <Box
          sx={{
            position: "absolute",
            left: `${place.x}%`,
            top: `${place.y}%`,
            width: `${(size.width / host.size.width) * 100}%`,
            height: `${(size.height / host.size.height) * 100}%`,
            transform: `translate(-50%, -50%) rotate(${place.rotation}deg)`,
            border: `1px dashed ${GX.accent}`,
            borderRadius: "2px",
            opacity: 0.75,
            pointerEvents: "none"
          }}
        />
        <Box
          sx={{
            position: "absolute",
            left: `${place.x}%`,
            top: `${place.y}%`,
            width: 12,
            height: 12,
            marginLeft: "-6px",
            marginTop: "-6px",
            borderRadius: "50%",
            background: GX.accent,
            border: `2px solid ${GX.page}`,
            pointerEvents: "none"
          }}
        />
      </Box>

      <Stack direction="row" spacing={1}>
        <TextField
          size="small"
          type="number"
          label="X %"
          value={place.x}
          onChange={(e) => setAt("x", clamp(Number(e.target.value) || 0, 0, 100))}
          sx={{ flex: 1 }}
        />
        <TextField
          size="small"
          type="number"
          label="Y %"
          value={place.y}
          onChange={(e) => setAt("y", clamp(Number(e.target.value) || 0, 0, 100))}
          sx={{ flex: 1 }}
        />
      </Stack>

      {/* ------------------------------------------------ size and angle */}
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography sx={{ fontSize: 11, color: GX.dim, width: 60 }}>Scale</Typography>
        <Slider
          size="small"
          min={5}
          max={100}
          step={1}
          value={place.scale}
          onChange={(_, n) => setAt("scale", n as number)}
          sx={{ flex: 1 }}
        />
        <Typography sx={{ fontSize: 11, width: 40, fontFamily: GX.mono, textAlign: "right" }}>
          {place.scale}%
        </Typography>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography sx={{ fontSize: 11, color: GX.dim, width: 60 }}>Rotation</Typography>
        <Slider
          size="small"
          min={-45}
          max={45}
          step={1}
          marks={[{ value: 0 }]}
          value={place.rotation}
          onChange={(_, n) => setAt("rotation", n as number)}
          sx={{ flex: 1 }}
        />
        <Typography sx={{ fontSize: 11, width: 40, fontFamily: GX.mono, textAlign: "right" }}>
          {place.rotation}°
        </Typography>
      </Stack>

      {/* ---------------------------------------------------- the colours */}
      <Stack direction="row" spacing={1}>
        {COLOUR_FIELDS.map((f) => (
          <Stack key={f.id} spacing={0.25} sx={{ flex: 1 }}>
            <Typography sx={{ fontSize: 11, color: GX.dim }}>{f.label}</Typography>
            {/* `Box component="input"` rather than a raw one, for the reason the
                Drawing Lab panel writes out: a colour well has no MUI component
                of its own (the browser owns the swatch widget), and going
                through Box keeps it inside the sx/theme system. */}
            <Box
              component="input"
              type="color"
              aria-label={f.label}
              value={colors[f.id]}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setColor(f.id, e.target.value)}
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

      <Button
        size="small"
        onClick={() => {
          setColors(DEFAULT_STICKER_COLORS);
          setPlace(DEFAULT_PLACEMENT);
        }}
      >
        Reset to defaults
      </Button>
    </Stack>
  );
}
