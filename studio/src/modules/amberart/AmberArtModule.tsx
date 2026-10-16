"use client";

/**
 * @file AmberArt — the framework's paint and art program, at `/amberart`.
 *
 * A layered raster canvas with brush, eraser, line, rect, ellipse, flood fill
 * and eyedropper, an undo/redo history and PNG export. Imported from GizmoX
 * 2026-08-12.
 *
 * ## What changed on the way, and why
 *
 *   - **The document is a STORE** (`store.ts`), not component state. The
 *     context-menu commands are plain functions and must be able to undo, add a
 *     layer and clear pixels; that is only possible against a singleton.
 *   - **The toolbar is not a toolbar ASSET.** GizmoX built the bar from a
 *     `toolbar` layout asset plus contributions. AmberX has no such asset kind
 *     for a tool rail, so the seven built-in tools are declared in this file
 *     and the CONTRIBUTED ones come through the declared point. When AmberX
 *     grows an editable rail asset, this list is what it replaces.
 *   - **Icons are pack glyphs.** `@mui/icons-material` is permanently excluded
 *     (`.claude/rules/no-hand-rolled-ui.md`); every icon here resolves through
 *     the branding pack, so the rail recolours with the theme.
 *   - **No PluginsDrawer, no ModuleSurface, no slot registry, no
 *     `useEffectiveValues`.** Those are GizmoX chrome. The layout is MUI
 *     `Stack`/`Paper`, and the sui is the minimal AmberX shape.
 *
 * ## The canvas is the documented exception
 *
 * `.claude/rules/no-hand-rolled-ui.md` requires MUI wherever an MUI component
 * exists. A painting surface is a `<canvas>` — MUI has no component that owns
 * one, and the exception is about the SURFACE, not about effort. Everything
 * around it (rail, layer list, sliders, panels) is MUI.
 */

import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
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

import { Glyph, token } from "@axf/core";

import { BLEND_MODES, CANVAS_H, CANVAS_W } from "./canvas";
import type { Point } from "./canvas";
import { polygonMask, rectMask, wandMask } from "./selection";
import type { MaskCombine } from "./selection";
import {
  FONT_STACKS,
  TEXT_LINE_HEIGHT,
  TEXT_SIZE_MAX,
  TEXT_SIZE_MIN,
  TEXT_STROKE_MAX,
  blockWidth,
  resolveStack,
  textLines
} from "./text";
import type { TextAlign, TextStyle } from "./text";
import { DEFAULT_FILTER_PARAMS, FILTERS, previewScale } from "./filters";
import type { FilterId, FilterParams } from "./filters";
import { TEXTURE_PATTERNS, textureTile } from "./textures";
import type { TextureKind } from "./textures";
import { BUILTIN_TOOLS, TOOLS_BY_KEY, isSelectionTool, toolTitle } from "./tools";
import { useContributedTools, type ToolHost } from "./host";
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP, amberArt, useAmberArt } from "./store";
import type { GradientColors, GradientType, TextDraft } from "./store";
import { useAmberArtSettings } from "./settings";

const MONO = { fontFamily: "var(--axf-mono)", fontVariantNumeric: "tabular-nums" } as const;

/** The transparency checkerboard, as a pure CSS background. */
const CHECKER = {
  backgroundImage:
    "linear-gradient(45deg, #ffffff10 25%, transparent 25%), linear-gradient(-45deg, #ffffff10 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ffffff10 75%), linear-gradient(-45deg, transparent 75%, #ffffff10 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px"
} as const;

/** Layer thumbnail geometry — 1600×1000 lands almost exactly on 48×30. */
const THUMB_W = 48;
const THUMB_H = 30;

/**
 * The fixed swatches — sixteen colours that between them reach anywhere.
 *
 * A palette, not a theme: these are colours somebody PAINTS with, so they are
 * literal hex rather than `token()` values. A swatch grid drawn from the theme
 * would restyle a person's palette when they rolled a new look, and the yellow
 * they were mixing towards would silently become a different yellow.
 *
 * Two rows of eight, and the order is the argument for the choice: the first
 * row is the neutral ramp from black to white plus the three colours a hand
 * reaches for first (the studio's own accent among them), the second is a hue
 * circle at roughly even spacing so any hue is one swatch and one nudge away.
 */
const PALETTE: readonly string[] = [
  "#000000",
  "#404040",
  "#808080",
  "#c0c0c0",
  "#ffffff",
  "#7f1d1d",
  "#ff0000",
  "#ff7a1a",
  "#ffd400",
  "#9acd32",
  "#00a000",
  "#00d1a0",
  "#00a3ff",
  "#2233cc",
  "#7b2fd6",
  "#ff4fa3"
];

/**
 * The brush-size range.
 *
 * Named because it now has two consumers that must agree: the rail's slider and
 * the `[` / `]` keys. A key that could step past the slider's end would leave a
 * value the slider cannot show and cannot bring back.
 */
const SIZE_MIN = 1;
const SIZE_MAX = 120;

/** One swatch's box, shared by the fixed grid and the recents row. */
const SWATCH_SX = {
  p: 0,
  width: "100%",
  aspectRatio: "1",
  minWidth: 0,
  borderRadius: "var(--axf-radius-tight)",
  border: `1px solid ${token("edge")}`
} as const;

/**
 * The scroll pane's ceiling once the canvas is bigger than the column.
 *
 * At fit there is no ceiling at all — the canvas is as tall as its aspect ratio
 * makes it and the PAGE scrolls, which is what AmberArt has always done and what
 * this phase had to leave alone. The moment magnification passes fit, though,
 * 8× would be a twelve-thousand-pixel-tall page with a scrollbar nowhere near
 * the thing it scrolls, so the pane takes the scrolling over.
 */
const ZOOMED_PANE_H = "72vh";

/**
 * A value that lags its source by at least `ms`.
 *
 * The layer thumbnails redraw off the stroke counter, and a fast brush can bump
 * that several times a second. Each redraw is a full 1600×1000 → 48×30 downscale
 * PER LAYER, which is exactly the kind of work the store's docblock keeps out of
 * the paint path — so the panel watches a deliberately slow clock instead.
 */
function useThrottled<T>(value: T, ms: number): T {
  const [shown, setShown] = React.useState(value);
  const at = React.useRef(0);

  React.useEffect(() => {
    const wait = Math.max(0, ms - (Date.now() - at.current));
    const timer = window.setTimeout(() => {
      at.current = Date.now();
      setShown(value);
    }, wait);
    return () => window.clearTimeout(timer);
  }, [value, ms]);

  return shown;
}

/**
 * One layer's pixels, small.
 *
 * It reads the offscreen buffer directly rather than being handed pixels: the
 * buffers are the store's and never enter React state, so a thumbnail is a
 * `drawImage` in an effect, keyed on a throttled tick.
 */
function LayerThumb({ layerId, tick }: { layerId: string; tick: string }) {
  const ref = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    const el = ref.current;
    const buf = amberArt.buffer(layerId);
    const ctx = el?.getContext("2d");
    if (!el || !buf || !ctx) return;
    ctx.clearRect(0, 0, THUMB_W, THUMB_H);
    ctx.drawImage(buf, 0, 0, THUMB_W, THUMB_H);
  }, [layerId, tick]);

  return (
    <Box
      component="canvas"
      ref={ref}
      width={THUMB_W}
      height={THUMB_H}
      aria-hidden
      sx={{
        width: THUMB_W,
        height: THUMB_H,
        flex: "0 0 auto",
        borderRadius: "var(--axf-radius-tight)",
        border: `1px solid ${token("edge")}`,
        ...CHECKER
      }}
    />
  );
}

/** The texture picker's thumbnail, and how much of a tile it shows. */
const SWATCH = 34;
const SWATCH_CROP = 128;

/**
 * One texture generator, small.
 *
 * A QUARTER of the tile rather than the whole of it: at 256 → 34 the checker's
 * squares land on four pixels and every pattern collapses into the same grey,
 * so the picker would offer eight identical buttons. Cropping to 128 keeps a
 * checker square at 8px and a halftone dot visible, which is the point of a
 * thumbnail — and the tile is periodic, so a crop is a fair sample of it rather
 * than a corner.
 *
 * The tile itself is memoised by `textures.ts`, so eight swatches cost eight
 * `drawImage` calls and the generators run once per session.
 */
function TextureSwatch({ kind }: { kind: TextureKind }) {
  const ref = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    const el = ref.current;
    const ctx = el?.getContext("2d");
    const tile = textureTile(kind);
    if (!el || !ctx || !tile) return;
    const crop = Math.min(SWATCH_CROP, tile.width);
    ctx.clearRect(0, 0, SWATCH, SWATCH);
    ctx.drawImage(tile, 0, 0, crop, crop, 0, 0, SWATCH, SWATCH);
  }, [kind]);

  return (
    <Box
      component="canvas"
      ref={ref}
      width={SWATCH}
      height={SWATCH}
      aria-hidden
      sx={{ width: SWATCH, height: SWATCH, display: "block", borderRadius: "var(--axf-radius-tight)", ...CHECKER }}
    />
  );
}

/**
 * The dashed frame's thickness, in CSS pixels and deliberately NOT scaled.
 *
 * Everything else about the overlay scales with the view so that what is on
 * screen is what will land — but the border is the thing a hand has to grab,
 * and a grab target that shrinks with the zoom is one that becomes unusable at
 * exactly the zoom level where precise positioning matters most.
 */
const TEXT_FRAME = 6;

/**
 * The live text box: a real DOM editor floating over the canvas.
 *
 * It is DOM rather than pixels on purpose. Text has a caret, a selection, an
 * IME and thirty years of editing keys behind it, and none of that is worth
 * re-implementing against a canvas — so the canvas is untouched until Commit
 * and Esc costs nothing.
 *
 * The price is that this component and {@link drawText} have to agree about
 * geometry, and the agreement is bought in three places rather than assumed:
 * the font string comes from `fontShorthand`'s inputs, the width comes from
 * the same `blockWidth` the commit measures with, and `scale` is derived from
 * the SAME `getBoundingClientRect()` the pointer handlers use, so the overlay
 * and the pointer cannot disagree about where a canvas pixel is.
 */
function TextOverlay({
  draft,
  style,
  scale
}: {
  draft: TextDraft;
  style: TextStyle;
  scale: number;
}) {
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  /** The pointer's offset inside the frame, for the length of one drag. */
  const grip = React.useRef<{ dx: number; dy: number } | null>(null);

  const lines = React.useMemo(() => textLines(draft.value), [draft.value]);
  const width = React.useMemo(() => blockWidth(lines, style), [lines, style]);
  const family = React.useMemo(() => resolveStack(style.family), [style.family]);

  /* Once per session — the id in the key remounts this for a new box, which is
     what makes a second click take the caret with it. Re-focusing on every
     render would fight the person's own click into the middle of a word. */
  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const onKey = (e: React.KeyboardEvent): void => {
    /* The canvas' own keydown listener is on `window` and would see Delete,
       the arrows and Escape from in here. It checks `textEditing` first for
       exactly this reason, and this stops the event on the way regardless —
       two guards, because the one that fails silently is the one that lets a
       backspace delete a selection instead of a character. */
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      amberArt.cancelText();
      return;
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      amberArt.commitText();
    }
  };

  /* Only a press on the FRAME itself starts a drag — a press that landed on
     the editor is a caret placement, and stealing it would make the box
     impossible to click into. */
  const onFrameDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget) return;
    const box = boxRef.current;
    if (!box) return;
    e.preventDefault();
    const r = box.getBoundingClientRect();
    grip.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    box.setPointerCapture(e.pointerId);
  };

  /* Written straight onto the element rather than into the store: a drag moves
     as often as a brush does, and re-rendering the screen per pointer move to
     shift a box six pixels is the mistake the store's docblock is about. The
     store hears about it once, on release. */
  const onFrameMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const g = grip.current;
    const box = boxRef.current;
    const parent = box?.offsetParent as HTMLElement | null;
    if (!g || !box || !parent) return;
    const r = parent.getBoundingClientRect();
    box.style.left = `${e.clientX - r.left - g.dx}px`;
    box.style.top = `${e.clientY - r.top - g.dy}px`;
  };

  const onFrameUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    const g = grip.current;
    const box = boxRef.current;
    grip.current = null;
    if (!g || !box) return;
    if (box.hasPointerCapture(e.pointerId)) box.releasePointerCapture(e.pointerId);
    const left = parseFloat(box.style.left || "0");
    const top = parseFloat(box.style.top || "0");
    amberArt.moveText({ x: (left + TEXT_FRAME) / scale, y: (top + TEXT_FRAME) / scale });
    /* The inline styles were the drag's own; clearing them hands the position
       back to the rule below, which is now reading the value just committed. */
    box.style.left = "";
    box.style.top = "";
  };

  return (
    <Box
      ref={boxRef}
      onPointerDown={onFrameDown}
      onPointerMove={onFrameMove}
      onPointerUp={onFrameUp}
      onPointerCancel={onFrameUp}
      sx={{
        position: "absolute",
        left: draft.at.x * scale - TEXT_FRAME,
        top: draft.at.y * scale - TEXT_FRAME,
        p: `${TEXT_FRAME}px`,
        border: `1px dashed ${token("accent")}`,
        borderRadius: "var(--axf-radius-tight)",
        cursor: "move",
        touchAction: "none",
        zIndex: 2
      }}
    >
      <InputBase
        multiline
        inputRef={inputRef}
        value={draft.value}
        onChange={(e) => amberArt.setTextValue(e.target.value)}
        onKeyDown={onKey}
        /* `wrap="off"` is load-bearing, not tidiness: the box is exactly as
           wide as its longest line, so a textarea left to soft-wrap would fold
           a line the instant a glyph measured a hair wider in the DOM than on
           the canvas — and the preview would be showing two lines where the
           commit writes one. */
        inputProps={{ wrap: "off", spellCheck: false, "aria-label": "Text to place on the canvas" }}
        sx={{
          display: "block",
          p: 0,
          /* A little slack so a sub-pixel disagreement between the measuring
             context and the browser's own layout cannot clip the last glyph,
             and a floor so an empty box is still something to aim at. */
          width: Math.max(width * scale, style.size * scale * 0.6) + 2,
          color: style.color,
          caretColor: token("accent"),
          "& .MuiInputBase-input": {
            p: 0,
            fontFamily: family,
            fontSize: style.size * scale,
            fontWeight: style.bold ? 700 : 400,
            fontStyle: style.italic ? "italic" : "normal",
            lineHeight: TEXT_LINE_HEIGHT,
            textAlign: style.align,
            whiteSpace: "pre",
            overflow: "hidden",
            ...(style.strokeWidth > 0
              ? {
                  /* Doubled and painted UNDER the fill, which is the same
                     arrangement `drawText` uses — a CSS text stroke straddles
                     the outline exactly as a canvas one does, so asking for
                     half of it to be hidden is what makes the two match. */
                  WebkitTextStrokeWidth: `${style.strokeWidth * 2 * scale}px`,
                  WebkitTextStrokeColor: style.strokeColor,
                  paintOrder: "stroke"
                }
              : null)
          }
        }}
      />
      <Stack
        direction="row"
        spacing={0.5}
        sx={{ position: "absolute", top: "100%", left: 0, mt: 0.5, zIndex: 3 }}
      >
        <Button size="small" variant="contained" onClick={() => amberArt.commitText()}>
          Commit
        </Button>
        <Button size="small" variant="outlined" onClick={() => amberArt.cancelText()}>
          Cancel
        </Button>
      </Stack>
    </Box>
  );
}

/**
 * How long a slider has to be still before the filter runs — P7's whole
 * interactivity budget.
 *
 * A `Slider` fires per pixel of travel, and the cheapest filter here is still a
 * pass over 1.6 million pixels. 120 ms is long enough that a drag across the
 * track runs the filter once or twice rather than sixty times, and short enough
 * that letting go feels immediate. The other half of the budget is
 * `previewScale`, which halves the resolution for the filters that need more
 * than one sweep.
 */
const PREVIEW_DEBOUNCE_MS = 120;

/**
 * Filters and adjustments — a folded header row until it is opened.
 *
 * It is a PANEL rather than a dialog because a preview you cannot see past is
 * not a preview: the panel sits beside the canvas, the canvas shows the
 * result, and nothing is written until Apply.
 *
 * The chosen filter and its parameters are component state; only `filtersOpen`
 * lives in the store, because `amberart.filters.open` is a context-menu row and
 * a command has no hooks. See {@link AmberArtState.filtersOpen}.
 */
function FiltersPanel({ open, hasSelection }: { open: boolean; hasSelection: boolean }) {
  const [id, setId] = React.useState<FilterId>("brightness-contrast");
  const [params, setParams] = React.useState<FilterParams>(DEFAULT_FILTER_PARAMS);
  const spec = FILTERS.find((f) => f.id === id) ?? FILTERS[0]!;

  /* The debounce, and the whole preview loop: any change to the filter or its
     parameters re-runs it against the session's untouched source. Closing the
     panel drops the preview through the store rather than here, so a Cancel and
     a fold end in the same state. */
  React.useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => amberArt.previewFilter(id, params), PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, id, params]);

  /* Leaving the screen with a preview standing would leave the layer looking
     filtered on the next visit, with nothing on screen offering to apply it. */
  React.useEffect(() => () => amberArt.cancelFilter(), []);

  const half = previewScale(id, params) < 1;

  return (
    <Paper variant="outlined" sx={{ p: 1, display: "grid", gap: open ? 0.7 : 0 }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
        <Typography sx={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: token("dim") }}>
          Filters
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          sx={{ fontSize: 10.5, minWidth: 0, py: 0 }}
          aria-expanded={open}
          onClick={() => amberArt.toggleFilters()}
        >
          {open ? "Close" : "Open"}
        </Button>
      </Stack>

      {open && (
        <>
          <Select
            size="small"
            value={id}
            aria-label="Filter"
            onChange={(e) => setId(e.target.value as FilterId)}
            sx={{ fontSize: 11.5, "& .MuiSelect-select": { py: 0.5 } }}
          >
            {FILTERS.map((f) => (
              <MenuItem key={f.id} value={f.id} dense sx={{ fontSize: 12 }}>
                {f.label}
              </MenuItem>
            ))}
          </Select>
          <Typography sx={{ fontSize: 10, color: token("dim"), lineHeight: 1.35 }}>{spec.hint}</Typography>

          {spec.controls.map((control) => {
            const value = params[control.key];
            if (control.kind === "switch") {
              return (
                <FormControlLabel
                  key={control.key}
                  sx={{ m: 0, gap: 0.5 }}
                  control={
                    <Switch
                      size="small"
                      checked={value === true}
                      onChange={(e) => setParams((p) => ({ ...p, [control.key]: e.target.checked }))}
                    />
                  }
                  label={<Typography sx={{ fontSize: 11 }}>{control.label}</Typography>}
                />
              );
            }
            return (
              <Box key={control.key} sx={{ display: "grid", gap: 0.2 }}>
                <Typography sx={{ fontSize: 10.5, color: token("dim") }}>
                  {control.label} · {typeof value === "number" ? value : 0}
                  {control.unit ?? ""}
                </Typography>
                <Slider
                  size="small"
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  value={typeof value === "number" ? value : 0}
                  aria-label={`${spec.label} — ${control.label}`}
                  onChange={(_, v) =>
                    setParams((p) => ({ ...p, [control.key]: Array.isArray(v) ? v[0]! : v }))
                  }
                />
              </Box>
            );
          })}

          <Stack direction="row" sx={{ gap: 0.6 }}>
            <Button
              size="small"
              variant="contained"
              sx={{ fontSize: 11, py: 0.2, flex: 1 }}
              onClick={() => amberArt.applyFilter(id, params)}
            >
              Apply
            </Button>
            <Button
              size="small"
              variant="outlined"
              sx={{ fontSize: 11, py: 0.2, flex: 1 }}
              onClick={() => amberArt.cancelFilter()}
            >
              Cancel
            </Button>
          </Stack>

          <Typography sx={{ fontSize: 10, color: token("dim"), lineHeight: 1.35 }}>
            The canvas shows the result live; the layer keeps its own pixels until Apply, and one Ctrl+Z
            takes it back.
            {hasSelection ? " With a selection, only the selected pixels change." : ""}
            {half ? " This one previews at half resolution — Apply always runs at full." : ""}
          </Typography>
        </>
      )}
    </Paper>
  );
}

export default function AmberArtModule() {
  const state = useAmberArt();
  const settings = useAmberArtSettings();
  const contributed = useContributedTools();
  const [panelTool, setPanelTool] = React.useState<string | null>(null);

  /* Layer-panel edit state. `renaming` holds the layer id whose name is being
     typed; `escaped` stops the blur that Esc causes from committing the draft
     the Esc just abandoned. */
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const escaped = React.useRef(false);

  /* What the thumbnails watch: strokes for painting, the history counters for
     undo/redo, the layer count for structural ops. Throttled, because a brush
     bumps `strokes` far faster than a 48×30 downscale per layer is worth. */
  const thumbTick = useThrottled(
    `${state.strokes}:${state.undoCount}:${state.redoCount}:${state.layers.length}`,
    400
  );

  /* The wand's tolerance is RAIL STATE, not a setting. It is a per-click
     decision, changed several times a minute while chasing an edge — the
     minimal-sui rule's test is "the surface cannot work properly without it",
     and a value that belongs next to the tool it drives fails that on the
     other side: putting it in a dialog would make it worse, not more
     configurable. */
  const [tolerance, setTolerance] = React.useState(24);

  /**
   * The ramp as CSS, so the rail shows what the drag is going to paint.
   *
   * A second expression of the same two colours, and deliberately a cheap one:
   * the honest preview is the canvas itself during the drag, and this only has
   * to answer "which end is which" before the drag starts. `#rrggbb` + `00` is
   * the eight-digit hex form of the same colour at zero alpha — the exact stop
   * the store builds for a fade to transparent.
   */
  const ramp = React.useMemo(() => {
    const from = state.color;
    const to = state.gradient.colors === "fg-bg" ? state.backgroundColor : `${state.color}00`;
    const [a, b] = state.gradient.reverse ? [to, from] : [from, to];
    return `linear-gradient(90deg, ${a}, ${b})`;
  }, [state.color, state.backgroundColor, state.gradient]);

  const texture = TEXTURE_PATTERNS.find((p) => p.id === state.texture.kind) ?? TEXTURE_PATTERNS[0]!;

  /**
   * CSS pixels per canvas pixel — the text overlay's whole coordinate story.
   *
   * The canvas is drawn at 1600×1000 and DISPLAYED at whatever width the
   * column gives it, so a DOM overlay anchored at a canvas point has to know
   * the ratio. It is read from the same `getBoundingClientRect()` that `at()`
   * uses, off a ResizeObserver rather than a resize listener — the column
   * changes width when the layer panel wraps or a pane is dragged, neither of
   * which is a window resize.
   */
  const [scale, setScale] = React.useState(1);

  /**
   * Whether Space is being held — the pan modifier.
   *
   * Both a ref and a state, deliberately. The pointer handlers need the answer
   * without re-subscribing (the ref), and the CURSOR has to change the moment
   * the key goes down, which is a render (the state). They are written together
   * in one place, by the two listeners below and nowhere else.
   */
  const [spacePan, setSpacePan] = React.useState(false);
  const spaceHeld = React.useRef(false);

  const viewRef = React.useRef<HTMLCanvasElement | null>(null);
  /** The scroll pane. Zoom changes what is inside it; pan changes its scroll. */
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  /** A pan drag: where it started, and where the pane was scrolled to then. */
  const panning = React.useRef<{ x: number; y: number; sx: number; sy: number } | null>(null);
  /**
   * The scroll correction a zoom owes, held until the new width exists.
   *
   * "Keep the point under the cursor still" cannot be done in the same tick as
   * the zoom: the width is a React-rendered CSS value, so at the moment
   * `setZoom` returns the pane is still the old size and any scroll written now
   * would be clamped against the old scroll range. The correction is parked here
   * and applied by the layout effect that runs once the width has actually
   * changed.
   */
  const anchor = React.useRef<{ x: number; y: number; sx: number; sy: number; k: number } | null>(null);
  const drawing = React.useRef(false);
  const last = React.useRef<Point | null>(null);
  const shapeStart = React.useRef<Point | null>(null);
  /* The selection drag in flight: how it will meet the existing mask (Shift
     adds, Alt subtracts) and, for the lasso, the freehand path so far. */
  const combine = React.useRef<MaskCombine>("replace");
  const lasso = React.useRef<Point[]>([]);

  /* The store owns the pixels; the component only lends it the visible canvas. */
  React.useLayoutEffect(() => {
    amberArt.attachView(viewRef.current);
    return () => amberArt.attachView(null);
  }, []);

  /* First run: one layer. In an effect, never during render. */
  React.useEffect(() => {
    amberArt.ensureFirstLayer();
  }, []);

  React.useEffect(() => {
    amberArt.setUndoDepth(settings.undoDepth);
  }, [settings.undoDepth]);

  React.useEffect(() => {
    const el = viewRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = (): void => {
      const r = el.getBoundingClientRect();
      if (r.width > 0) setScale(r.width / CANVAS_W);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ------------------------------------------------------- zoom and pan */

  /**
   * Zoom by a ratio, keeping the point under the cursor where it is.
   *
   * The ratio is taken from what the store ACTUALLY applied rather than from
   * what was asked for — see `setZoom`. At the ends of the range the two differ,
   * and a correction computed from the request would slide the picture sideways
   * on every wheel notch past 8×, which reads as drift rather than as a clamp.
   *
   * With no cursor position (the `+`/`−` chips) it holds the pane's centre,
   * which is the only point a keyboard or a toolbar can mean.
   *
   * Stable across renders on purpose: it touches nothing but refs and the store,
   * and the wheel listener below is attached once and closes over it.
   */
  const zoomAround = React.useCallback((factor: number, clientX?: number, clientY?: number): void => {
    const el = wrapRef.current;
    const before = amberArt.getState().zoom;
    const after = amberArt.zoomBy(factor);
    if (!el || after === before) return;
    const r = el.getBoundingClientRect();
    anchor.current = {
      x: clientX === undefined ? el.clientWidth / 2 : clientX - r.left,
      y: clientY === undefined ? el.clientHeight / 2 : clientY - r.top,
      sx: el.scrollLeft,
      sy: el.scrollTop,
      k: after / before
    };
  }, []);

  /* The other half of `zoomAround`: the pane is now its new size, so the point
     that was `x` from the pane's left edge is `(scroll + x) × k` into the
     content, and putting it back under the cursor is that minus `x`. Layout
     effect rather than an effect — the correction has to land before the browser
     paints, or the canvas visibly jumps and then slides back. */
  React.useLayoutEffect(() => {
    const el = wrapRef.current;
    const a = anchor.current;
    anchor.current = null;
    if (!el || !a) return;
    el.scrollLeft = (a.sx + a.x) * a.k - a.x;
    el.scrollTop = (a.sy + a.y) * a.k - a.y;
  }, [state.zoom]);

  /* Ctrl+wheel, attached natively rather than through `onWheel`: React registers
     its root wheel listener as PASSIVE, so a `preventDefault()` from a React
     handler is ignored and the browser zooms the whole page instead of the
     canvas. A plain wheel with no modifier is left alone — that is the pane's
     own scroll, which is how a person scrolls a zoomed canvas. */
  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (!e.deltaY) return;
      zoomAround(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAround]);

  /**
   * The whole keyboard, in ONE listener attached for the life of the screen.
   *
   * One rather than one per feature, because the guards are the hard part and
   * they must be asked once: every branch below is downstream of the same two
   * questions, so there is no route by which a shortcut can be reached without
   * them. Two listeners for shortcuts would be two chances to forget.
   *
   * The guards, in order and both load-bearing:
   *
   *   1. **`textEditing`** — while a text box is open the keyboard belongs to
   *      the person typing. Asked FIRST because it stays true when focus slips
   *      off the textarea onto the box's own Commit button, which is exactly
   *      when the target guard below stops helping.
   *   2. **The event's TARGET** — the layer panel's rename field, the font
   *      selects and the colour inputs are real form controls on this screen.
   *      `Delete` inside one must delete a character, `D` must type a `d`, and
   *      `Escape` must abandon the rename.
   *
   * Everything after them reads the store inside the handler rather than
   * closing over a render's values, which is what lets the listener be attached
   * once with an empty dependency array and never re-bound.
   */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (amberArt.getState().textEditing) return;

      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;

      /* Space is the pan modifier for as long as it is held, and it repeats —
         so the state write is guarded and the preventDefault is not, or holding
         it would scroll the page under the drag it is supposed to be driving.
         `e.code` rather than `e.key`, because the KEY is " " and a space is one
         of the two characters that make the letter map below ambiguous. */
      if (e.code === "Space" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (!spaceHeld.current) {
          spaceHeld.current = true;
          setSpacePan(true);
        }
        return;
      }

      const mod = e.ctrlKey || e.metaKey;
      /* Upper-cased so Shift is neither required nor refused, and only for
         single characters — `Delete`, `Escape` and the arrows keep their names. */
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;

      /* The modifier map, entirely separate from the letters: `D` alone is
         "default colours" and Ctrl+D is "deselect", so the two must not be able
         to fall through into each other. An unmapped modifier chord returns
         rather than continuing — Ctrl+S belongs to the browser, not to us. */
      if (mod) {
        if (key === "Z") {
          e.preventDefault();
          return void (e.shiftKey ? amberArt.redo() : amberArt.undo());
        }
        if (key === "Y") return void (e.preventDefault(), amberArt.redo());
        if (key === "A") return void (e.preventDefault(), amberArt.selectAll());
        if (key === "D") return void (e.preventDefault(), amberArt.clearSelection());
        if (key === "I" && e.shiftKey) return void (e.preventDefault(), amberArt.invertSelection());
        return;
      }

      /* A floating transform owns the arrows, Enter and Escape for as long as it
         is in the air. Anything else falls through — pressing `B` mid-session
         picks up the brush, and `setTool` commits the pixels on the way, which
         is Photoshop's behaviour and the store's documented contract. */
      if (amberArt.getState().floating) {
        const step = e.shiftKey ? 10 : 1;
        if (key === "ArrowLeft") return void (e.preventDefault(), amberArt.nudgeTransform(-step, 0));
        if (key === "ArrowRight") return void (e.preventDefault(), amberArt.nudgeTransform(step, 0));
        if (key === "ArrowUp") return void (e.preventDefault(), amberArt.nudgeTransform(0, -step));
        if (key === "ArrowDown") return void (e.preventDefault(), amberArt.nudgeTransform(0, step));
        if (key === "Enter") return void (e.preventDefault(), amberArt.commitTransform());
        if (key === "Escape") return void (e.preventDefault(), amberArt.cancelTransform());
      }

      if (key === "Delete" || key === "Backspace") {
        if (!amberArt.getState().hasSelection) return;
        e.preventDefault();
        amberArt.deleteSelection();
        return;
      }

      if (key === "X") return void (e.preventDefault(), amberArt.swapColors());
      if (key === "D") return void (e.preventDefault(), amberArt.resetColors());

      /* `[` and `]` step the brush PROPORTIONALLY, which is the difference
         between a shortcut somebody uses and one they give up on: a flat ±1
         takes eighty presses to cross the slider, and a flat ±10 cannot express
         a 3px brush at all. */
      if (key === "[" || key === "]") {
        e.preventDefault();
        const size = amberArt.getState().size;
        const step = size < 10 ? 1 : size < 40 ? 5 : 10;
        amberArt.setSize(Math.max(SIZE_MIN, Math.min(SIZE_MAX, size + (key === "]" ? step : -step))));
        return;
      }

      /* The tool letters, last, because they are the only branch that accepts an
         arbitrary character and would otherwise swallow the named keys above.
         A letter shared by several tools walks to the next one each press — see
         `TOOL_KEYS`. A tool that is not currently selected lands on the first of
         its group, which is what makes `G` reach the gradient from anywhere. */
      const group = TOOLS_BY_KEY[key];
      if (group?.length) {
        e.preventDefault();
        const next = group[(group.indexOf(amberArt.getState().toolId) + 1) % group.length]!;
        amberArt.setTool(next);
        setPanelTool(null);
      }
    };

    /* Space is released here and on blur — a window that loses focus mid-hold
       never sees the keyup and would come back with the pan modifier stuck on
       and no key left to press to clear it.
       A keyup does NOT end a pan already in flight: releasing the key before the
       button is a thing hands do, and Photoshop finishes the drag. `pointerup`
       is what ends it, and it is the only thing that does. */
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code !== "Space") return;
      spaceHeld.current = false;
      setSpacePan(false);
    };
    const onBlur = (): void => {
      spaceHeld.current = false;
      panning.current = null;
      setSpacePan(false);
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  /* Leaving the screen with pixels in the air puts them down rather than
     dropping them — the float is not on any layer, so an unmount that ignored
     it would lose them with no undo entry to say where they went. */
  React.useEffect(() => () => amberArt.commitTransform(), []);

  /* And typed words are put down on the way out for the same reason, by the
     same rule Photoshop applies when a type session loses its tool: content
     commits, an empty box is dropped. */
  React.useEffect(() => () => amberArt.settleText(), []);

  /* Leaving the screen with a selection would leave the ants' animation frame
     running against a canvas nobody is looking at. */
  React.useEffect(() => () => amberArt.clearSelection(), []);

  /* The status line clears itself — a message that never leaves stops being
     read as "what just happened" and becomes furniture. */
  React.useEffect(() => {
    if (!state.message) return;
    const timer = window.setTimeout(() => amberArt.say(""), 3200);
    return () => window.clearTimeout(timer);
  }, [state.message]);

  /* ------------------------------------------------------------ pointer */

  /** Pointer position in canvas pixels, whatever the element's display size. */
  const at = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * CANVAS_W,
      y: ((e.clientY - r.top) / r.height) * CANVAS_H
    };
  };

  /** Shift adds to the selection, Alt subtracts — Photoshop's own modifiers. */
  const combineFor = (e: React.PointerEvent<HTMLCanvasElement>): MaskCombine =>
    e.shiftKey ? "add" : e.altKey ? "subtract" : "replace";

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const { activeLayer, toolId, layers } = amberArt.getState();

    /* Space-pan comes before EVERYTHING, tool included, and it never touches
       `toolId`: the whole point of the modifier is that the brush is still the
       brush when the key comes up. `drawing` stays false, so the tool handlers
       below cannot see this drag at all. */
    if (spaceHeld.current) {
      const pane = wrapRef.current;
      if (!pane) return;
      e.preventDefault();
      panning.current = { x: e.clientX, y: e.clientY, sx: pane.scrollLeft, sy: pane.scrollTop };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    /* The zoom tool needs no layer and writes no pixels — before the active
       layer guard, because magnifying a document with every layer deleted is
       still a perfectly reasonable thing to want. */
    if (toolId === "zoom") {
      zoomAround(e.altKey ? 1 / ZOOM_STEP : ZOOM_STEP, e.clientX, e.clientY);
      return;
    }

    if (!activeLayer) return;
    const p = at(e);

    /* Move lifts on its FIRST drag and grabs a handle on every one after — the
       store owns both, because the geometry and the undo entry belong together
       and neither belongs in a component. */
    if (toolId === "move") {
      if (!amberArt.startTransformDrag(p)) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drawing.current = true;
      return;
    }

    /* Text takes no pointer capture and starts no stroke: the click only says
       WHERE, and everything after it happens in the DOM overlay until the
       commit rasterizes. Nothing is pushed onto the undo stack here — an
       abandoned box has to leave the history exactly as it found it. */
    if (toolId === "text") {
      amberArt.openText(p);
      return;
    }

    /* Selection tools come first and take no layer at all: they describe a
       REGION, so a hidden active layer is no obstacle and nothing is pushed
       onto the undo stack — a selection is not a document edit. */
    if (isSelectionTool(toolId)) {
      if (toolId === "wand") {
        const buf = amberArt.buffer(activeLayer);
        const mask = buf ? wandMask(buf, p.x, p.y, tolerance) : null;
        if (!mask) amberArt.say("Nothing to select there");
        else amberArt.addToSelection(mask, combineFor(e));
        return;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      drawing.current = true;
      shapeStart.current = p;
      combine.current = combineFor(e);
      lasso.current = toolId === "lasso" ? [p] : [];
      return;
    }

    const layer = layers.find((l) => l.id === activeLayer);
    if (!layer?.visible) {
      amberArt.say("The active layer is hidden");
      return;
    }
    const ctx = amberArt.context(activeLayer);
    if (!ctx) return;

    if (toolId === "picker") {
      /* Through the store, which suppresses the marching ants for the read —
         a dash under the pointer would otherwise be picked as #000 or #fff. */
      const hex = amberArt.pickAt(p);
      if (hex) {
        /* Through `pickColor`, so the eyedropper feeds the recents row — a pick
           is the most deliberate colour choice the module offers, and it is the
           one whose value cannot be typed back in from memory. */
        amberArt.pickColor(hex);
        amberArt.say(`Picked ${hex}`);
      } else {
        amberArt.say("Nothing to pick there");
      }
      return;
    }

    /* The gradient's drag DEFINES the ramp and writes nothing while it lasts,
       so no undo entry is pushed here — the release pushes the one entry that
       covers the whole gesture. Same reason the shape tools preview on the view
       and commit on pointer-up, one branch further down. */
    if (toolId === "gradient") {
      e.currentTarget.setPointerCapture(e.pointerId);
      drawing.current = true;
      shapeStart.current = p;
      amberArt.previewGradient(p, p);
      return;
    }

    /* Texture is a click, not a drag: the pattern's placement is the tile's own
       repeat, so a drag would have nothing to describe. The store pushes its
       own undo entry, which is why this returns before the one below. */
    if (toolId === "texture") {
      amberArt.fillTexture();
      return;
    }

    /* The clone stamp before the generic undo entry below, because both of its
       first two answers are "paint nothing": Alt-click only moves the source,
       and an unarmed stamp refuses. `beginStampStroke` is the ONE place that
       knows which — so the entry is pushed after it agrees, and a refusal cannot
       leave a Ctrl+Z that appears to do nothing. */
    if (toolId === "stamp") {
      if (e.altKey) {
        amberArt.setStampSource(p);
        return;
      }
      if (!amberArt.beginStampStroke(p)) return;
      amberArt.pushUndo(activeLayer);
      e.currentTarget.setPointerCapture(e.pointerId);
      drawing.current = true;
      last.current = p;
      shapeStart.current = p;
      amberArt.stampDab(ctx, p);
      amberArt.composite();
      return;
    }

    amberArt.pushUndo(activeLayer);
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = p;
    shapeStart.current = p;

    if (toolId === "fill") {
      amberArt.fillAt(ctx, p);
      drawing.current = false;
      amberArt.countStroke();
      amberArt.composite();
      return;
    }

    if (toolId === "brush" || toolId === "eraser") {
      amberArt.paintDab(ctx, p);
      amberArt.composite();
      return;
    }

    /* The smudge lays nothing down under the press — it has nothing to pull
       yet. The press only says where the first dab will sample FROM. */
    if (toolId === "smudge") {
      amberArt.beginSmudgeStroke(p);
    }
  };

  /** The dashed rubber band a selection drag shows before it commits. */
  const previewSelection = (draw: (view: CanvasRenderingContext2D) => void): void => {
    amberArt.setPreview((view) => {
      view.save();
      view.setLineDash([6, 4]);
      view.lineWidth = 1.5;
      view.globalAlpha = 1;
      view.strokeStyle = "#ffffff";
      draw(view);
      view.restore();
    });
    amberArt.composite();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    /* The pane is scrolled straight from the element, not through React: a pan
       moves as often as a brush does, and re-rendering the screen to shift a
       scroll offset is the mistake the store's docblock is about. Subtracted
       rather than added, because dragging the paper right means looking further
       LEFT — the grab cursor is a promise the maths has to keep. */
    const pan = panning.current;
    if (pan) {
      const pane = wrapRef.current;
      if (pane) {
        pane.scrollLeft = pan.sx - (e.clientX - pan.x);
        pane.scrollTop = pan.sy - (e.clientY - pan.y);
      }
      return;
    }

    if (!drawing.current) {
      /* Hovering a floating transform tells the hand what it is about to grab.
         Written straight onto the element rather than into React state: a hover
         moves as often as a drag does, and re-rendering the whole screen to
         change a cursor is the mistake the store's docblock is about. An empty
         string hands the choice back to the `sx` rule below.
         One resize cursor for all eight handles, on purpose — the directional
         ones name a screen axis, and a box turned 40° makes every one of them
         point at the wrong corner. */
      const hit = amberArt.getState().floating ? amberArt.transformHandleAt(at(e)) : null;
      e.currentTarget.style.cursor = hit === "rotate" ? "grab" : hit ? "nwse-resize" : "";
      return;
    }
    const { activeLayer, toolId, size, alpha, color } = amberArt.getState();
    if (!activeLayer) return;
    const p = at(e);

    if (toolId === "move") {
      /* Shift means two things at once, and both are what Photoshop means by
         it: constrain a corner drag's aspect, snap a rotation to 15°. */
      amberArt.dragTransform(p, { aspect: e.shiftKey });
      return;
    }

    if (toolId === "marquee") {
      const s = shapeStart.current;
      if (s) previewSelection((v) => v.strokeRect(s.x, s.y, p.x - s.x, p.y - s.y));
      return;
    }

    if (toolId === "lasso") {
      const path = lasso.current;
      /* Points are dropped unless the pointer actually travelled: a 1600-point
         path from one twitchy second costs the scanline fill for nothing. */
      const prev = path[path.length - 1];
      if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) >= 2) path.push(p);
      previewSelection((v) => {
        v.beginPath();
        v.moveTo(path[0]!.x, path[0]!.y);
        for (const q of path.slice(1)) v.lineTo(q.x, q.y);
        v.closePath();
        v.stroke();
      });
      return;
    }

    /* The ramp is previewed through the SAME clip the commit will use, so a
       drag over a selection shows the shape it is going to land in. */
    if (toolId === "gradient") {
      const from = shapeStart.current;
      if (from) amberArt.previewGradient(from, p);
      return;
    }

    const ctx = amberArt.context(activeLayer);
    if (!ctx) return;

    if (toolId === "brush" || toolId === "eraser") {
      amberArt.paintSegment(ctx, last.current ?? p, p);
      last.current = p;
      amberArt.composite();
      return;
    }

    /* The two pixel-borrowing brushes take the same shape as the pair above —
       segment in, composite out — because they are dab trains over the same
       path, differing only in where the dab's pixels come from. */
    if (toolId === "stamp") {
      amberArt.stampSegment(ctx, last.current ?? p, p);
      last.current = p;
      amberArt.composite();
      return;
    }

    if (toolId === "smudge") {
      amberArt.smudgeSegment(ctx, last.current ?? p, p);
      last.current = p;
      amberArt.composite();
      return;
    }

    /* Shape tools preview on the VIEW only; the layer is written on pointer up,
       so an abandoned drag leaves no pixels behind. */
    const s = shapeStart.current;
    if (!s) return;
    amberArt.setPreview((view) => {
      view.save();
      view.lineCap = "round";
      view.lineWidth = size;
      view.globalAlpha = alpha;
      view.strokeStyle = color;
      amberArt.shape(view, s, p);
      view.restore();
    });
    amberArt.composite();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    /* Ahead of the `drawing` guard, because a pan deliberately never set it —
       and the capture has to be released whichever way the drag ends. */
    if (panning.current) {
      panning.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      return;
    }
    if (!drawing.current) return;
    const { activeLayer, toolId } = amberArt.getState();
    const p = at(e);
    const s = shapeStart.current;
    const path = lasso.current;
    const mode = combine.current;
    drawing.current = false;
    shapeStart.current = null;
    last.current = null;
    lasso.current = [];
    amberArt.setPreview(null);
    /* Before the branches rather than in the tail: every dab-train stroke ends
       here whichever way it leaves, and a clone delta or a smudge origin that
       outlived its stroke would be read by the NEXT one against a different
       start point. */
    amberArt.endStroke();

    /* Releasing a transform drag ends the GRAB, never the session: the pixels
       stay in the air until Enter, a tool change or a click elsewhere commits
       them, which is what lets one lift be moved, scaled and then rotated. */
    if (toolId === "move") {
      amberArt.endTransformDrag();
      return;
    }

    /* A click with no drag is Photoshop's deselect. "No drag" is BOTH axes
       being still — `||` would refuse a deliberately thin marquee, which is a
       real thing to want (a 1px column, a horizon line). And a click that
       carried a modifier was aiming to add or subtract, so it leaves the
       existing selection alone rather than throwing it away. */
    const clicked = !s || (Math.abs(p.x - s.x) < 2 && Math.abs(p.y - s.y) < 2);

    if (toolId === "marquee") {
      if (clicked) {
        if (mode === "replace") amberArt.clearSelection();
      } else {
        amberArt.addToSelection(rectMask({ x: s!.x, y: s!.y, w: p.x - s!.x, h: p.y - s!.y }), mode);
      }
      return;
    }

    if (toolId === "lasso") {
      /* The path closes itself on release — `polygonMask` joins last to first,
         so a lasso never has to be brought back to where it started. */
      if (path.length < 3) {
        if (mode === "replace") amberArt.clearSelection();
      } else {
        amberArt.addToSelection(polygonMask(path), mode);
      }
      return;
    }

    /* A gradient needs a direction, and a click has none. Refusing rather than
       guessing one: a zero-length drag would fill the whole layer with the end
       colour, which looks exactly like the tool having gone wrong. */
    if (toolId === "gradient") {
      if (s && !clicked) {
        amberArt.commitGradient(s, p);
      } else {
        amberArt.say("Drag across the canvas to set the gradient's direction and length");
        amberArt.composite();
      }
      return;
    }

    if (["line", "rect", "ellipse"].includes(toolId) && s && activeLayer) {
      const ctx = amberArt.context(activeLayer);
      if (ctx) amberArt.paintShape(ctx, s, p);
    }
    amberArt.countStroke();
    amberArt.composite();
  };

  /* ------------------------------------------------- the extension point */

  const host: ToolHost = React.useMemo(
    () => ({
      size: { width: CANVAS_W, height: CANVAS_H },
      notify: (m: string) => amberArt.say(m),
      placeSvg: (svg, opts) => amberArt.placeSvg(svg, opts)
    }),
    []
  );

  const activePanel = contributed.find((t) => t.id === panelTool) ?? null;

  /** The true magnification, measured. See the header's zoom chips for why. */
  const zoomPct = Math.round(scale * 100);

  return (
    <Box
      data-axf-area="amberart.surface"
      sx={{ display: "flex", flexDirection: "column", gap: 1.2, p: 1.6, minHeight: "100%" }}
    >
      {/* ------------------------------------------------------------ header */}
      <Stack direction="row" spacing={1.2} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Glyph id="icon-brush" size={22} />
        <Typography sx={{ fontSize: 19, fontWeight: 700 }}>AmberArt</Typography>
        <Chip size="small" variant="outlined" label={`${state.layers.length} layers`} sx={{ height: 20 }} />
        <Chip size="small" variant="outlined" label={`${state.strokes} strokes`} sx={{ ...MONO, height: 20 }} />
        {state.hasSelection && (
          <Chip
            size="small"
            variant="outlined"
            label="selection"
            onDelete={() => amberArt.clearSelection()}
            sx={{ height: 20, color: token("accent"), borderColor: token("accent") }}
          />
        )}
        {contributed.length > 0 && (
          <Chip
            size="small"
            variant="outlined"
            label={`${contributed.length} tool plugin${contributed.length === 1 ? "" : "s"}`}
            sx={{ height: 20, color: token("accent") }}
          />
        )}
        {/* The zoom readout, and the two ways to move it that need no cursor.
            The percentage is MEASURED — `scale` is CSS pixels per canvas pixel,
            off the same rect the pointer maths use — rather than the store's
            zoom multiplied by a hundred: at fit, the store says 1 and the truth
            is whatever fraction of 1600 the column happens to be, and a readout
            that says 100% while the canvas is at 58% is worse than none. */}
        <Stack direction="row" spacing={0.2} sx={{ alignItems: "center" }}>
          <Tooltip title="Zoom out — Alt-click with the zoom tool, or Ctrl+wheel">
            <span>
              <IconButton
                size="small"
                aria-label="Zoom out"
                disabled={state.zoom <= ZOOM_MIN}
                onClick={() => zoomAround(1 / ZOOM_STEP)}
                sx={{ p: 0.3, fontSize: 13 }}
              >
                −
              </IconButton>
            </span>
          </Tooltip>
          <Chip
            size="small"
            variant="outlined"
            label={`${zoomPct}%`}
            sx={{ ...MONO, height: 20, minWidth: 54 }}
          />
          <Tooltip title="Zoom in — click with the zoom tool (Z), or Ctrl+wheel">
            <span>
              <IconButton
                size="small"
                aria-label="Zoom in"
                disabled={state.zoom >= ZOOM_MAX}
                onClick={() => zoomAround(ZOOM_STEP)}
                sx={{ p: 0.3, fontSize: 13 }}
              >
                +
              </IconButton>
            </span>
          </Tooltip>
          <Button
            size="small"
            sx={{ fontSize: 10.5, minWidth: 0, py: 0 }}
            disabled={state.zoom === 1}
            onClick={() => amberArt.fitZoom()}
          >
            Fit
          </Button>
        </Stack>
        <Box sx={{ flex: 1 }} />
        {/* The float's two exits, on screen for as long as it is in the air.
            The keys (Enter, Esc) are the fast path and the buttons are the
            discoverable one — a person who has just dragged pixels somewhere
            unexpected should not have to guess which key puts them down. */}
        {state.floating && (
          <>
            <Chip
              size="small"
              variant="outlined"
              label="floating"
              sx={{ height: 20, color: token("accent"), borderColor: token("accent") }}
            />
            <Button size="small" variant="contained" onClick={() => amberArt.commitTransform()}>
              Commit
            </Button>
            <Button size="small" variant="outlined" onClick={() => amberArt.cancelTransform()}>
              Cancel
            </Button>
          </>
        )}
        <Button size="small" variant="outlined" disabled={!state.undoCount} onClick={() => amberArt.undo()}>
          Undo{state.undoCount ? ` (${state.undoCount})` : ""}
        </Button>
        <Button size="small" variant="outlined" disabled={!state.redoCount} onClick={() => amberArt.redo()}>
          Redo{state.redoCount ? ` (${state.redoCount})` : ""}
        </Button>
        <Button size="small" variant="contained" onClick={() => amberArt.exportPng()}>
          Export PNG
        </Button>
        {/* The settings affordance moved to the SHELL (core 0.0.20): the gear
            on ModuleHost and the universal "Module settings" row open the one
            SettingsDialog. */}
      </Stack>

      <Box sx={{ display: "flex", gap: 1.2, alignItems: "stretch", flexWrap: { xs: "wrap", lg: "nowrap" } }}>
        {/* ------------------------------------------------------------ rail */}
        <Paper variant="outlined" sx={{ p: 1, display: "grid", gap: 1, alignContent: "start", minWidth: 132 }}>
          <Typography sx={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: token("dim") }}>
            Tools
          </Typography>
          <ToggleButtonGroup
            orientation="vertical"
            exclusive
            size="small"
            value={state.toolId}
            onChange={(_, v: string | null) => {
              if (!v) return;
              amberArt.setTool(v);
              // A built-in tool has no panel; clearing keeps the detail column
              // honest instead of leaving a plugin's panel open under a brush.
              if (BUILTIN_TOOLS.some((t) => t.id === v)) setPanelTool(null);
              else setPanelTool(v);
            }}
          >
            {/* The Tooltip carries the shortcut, built by `toolTitle` from the
                same map the keydown listener switches on — so a key that moves
                and a label that does not is not a shape this can take.
                Wrapping is safe inside a ToggleButtonGroup: the group hands
                `value`/`selected`/`onChange` down through context (MUI v9), not
                by cloning its direct children. */}
            {BUILTIN_TOOLS.map((tool) => (
              <Tooltip key={tool.id} title={toolTitle(tool.id, tool.title)} placement="right">
                <ToggleButton value={tool.id} sx={{ justifyContent: "flex-start", gap: 1, px: 1, py: 0.5 }}>
                  <Glyph id={tool.glyph} size={14} />
                  <Typography sx={{ fontSize: 11.5 }}>{tool.title}</Typography>
                </ToggleButton>
              </Tooltip>
            ))}
            {contributed.length > 0 && <Divider flexItem sx={{ my: 0.5 }} />}
            {contributed.map((tool) => (
              <ToggleButton
                key={tool.id}
                value={tool.id}
                title={`${tool.title} — from ${tool.from}`}
                sx={{ justifyContent: "flex-start", gap: 1, px: 1, py: 0.5 }}
              >
                <Glyph id={tool.glyph} size={14} />
                <Typography sx={{ fontSize: 11.5 }}>{tool.title}</Typography>
              </ToggleButton>
            ))}
          </ToggleButtonGroup>

          {/* The rail's option area — what the SELECTED tool needs, and only
              while it is selected. The wand's tolerance lives here rather than
              in the sui because it is a per-click decision; see `tolerance`. */}
          {state.toolId === "wand" && (
            <>
              <Divider />
              <Typography sx={{ fontSize: 10.5, color: token("dim") }}>Tolerance · {tolerance}</Typography>
              <Slider
                size="small"
                min={0}
                max={255}
                value={tolerance}
                aria-label="Magic wand tolerance"
                onChange={(_, v) => setTolerance(Array.isArray(v) ? v[0]! : v)}
              />
            </>
          )}
          {isSelectionTool(state.toolId) && (
            <Typography sx={{ fontSize: 10, color: token("dim"), lineHeight: 1.35 }}>
              Shift adds · Alt subtracts · Delete clears the selected pixels
            </Typography>
          )}
          {/* The stamp's whole contract in two lines, because an unarmed clone
              stamp is a tool that refuses every stroke and says why only after
              the person has already tried one. The chip is the state the
              sentence describes, so the answer is on screen before the attempt. */}
          {state.toolId === "stamp" && (
            <>
              <Divider />
              <Chip
                size="small"
                variant="outlined"
                label={state.stampSource ? "source set" : "no source"}
                sx={{
                  height: 19,
                  fontSize: 10,
                  ...(state.stampSource ? { color: token("accent"), borderColor: token("accent") } : null)
                }}
              />
              <Typography sx={{ fontSize: 10, color: token("dim"), lineHeight: 1.35 }}>
                Alt-click to set the source, then paint. The crosshair follows the brush at the same
                offset for the whole stroke, and the next stroke reads from the source again.
              </Typography>
            </>
          )}
          {state.toolId === "zoom" && (
            <Typography sx={{ fontSize: 10, color: token("dim"), lineHeight: 1.35 }}>
              Click to magnify around the pointer, Alt-click to pull back. Ctrl+wheel does the same
              from any tool, hold Space to pan, and Fit returns to the column width.
            </Typography>
          )}
          {state.toolId === "smudge" && (
            <Typography sx={{ fontSize: 10, color: token("dim"), lineHeight: 1.35 }}>
              Drag to pull the pixels already on the layer. Opacity is the strength; hardness is the
              edge of the pull.
            </Typography>
          )}
          {state.toolId === "move" && (
            <Typography sx={{ fontSize: 10, color: token("dim"), lineHeight: 1.35 }}>
              Drag lifts the selection — or the whole layer. Corners scale (Shift keeps the aspect),
              the grip above rotates (Shift snaps 15°), arrows nudge 1px (Shift 10). Enter commits,
              Esc cancels.
            </Typography>
          )}

          {/* The text options strip. Rail state, not settings: a font and a
              size are chosen per block, and a value changed between one word
              and the next does not belong behind a settings gear. It renders
              while the TOOL is active rather than while a box is open, so the
              next block can be set up before clicking. */}
          {state.toolId === "text" && (
            <>
              <Divider />
              <Typography sx={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: token("dim") }}>
                Text
              </Typography>
              <Select
                size="small"
                value={state.textStyle.family}
                aria-label="Font family"
                onChange={(e) => amberArt.setTextStyle({ family: e.target.value })}
                sx={{ fontSize: 11.5, "& .MuiSelect-select": { py: 0.5 } }}
              >
                {FONT_STACKS.map((font) => (
                  <MenuItem key={font.id} value={font.stack} dense sx={{ fontSize: 12, fontFamily: font.stack }}>
                    {font.label}
                  </MenuItem>
                ))}
              </Select>
              <TextField
                size="small"
                type="number"
                label="Size"
                value={state.textStyle.size}
                slotProps={{
                  htmlInput: { min: TEXT_SIZE_MIN, max: TEXT_SIZE_MAX, step: 1 },
                  inputLabel: { shrink: true }
                }}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) return;
                  amberArt.setTextStyle({
                    size: Math.min(TEXT_SIZE_MAX, Math.max(TEXT_SIZE_MIN, Math.round(n)))
                  });
                }}
                sx={{ "& .MuiInputBase-input": { fontSize: 12, py: 0.5 }, "& .MuiInputLabel-root": { fontSize: 11 } }}
              />
              <ToggleButtonGroup
                size="small"
                value={[state.textStyle.bold ? "bold" : "", state.textStyle.italic ? "italic" : ""].filter(Boolean)}
                onChange={(_, v: string[]) =>
                  amberArt.setTextStyle({ bold: v.includes("bold"), italic: v.includes("italic") })
                }
                sx={{ "& .MuiToggleButton-root": { flex: 1, py: 0.2 } }}
              >
                <ToggleButton value="bold" aria-label="Bold">
                  <Typography sx={{ fontSize: 12.5, fontWeight: 800 }}>B</Typography>
                </ToggleButton>
                <ToggleButton value="italic" aria-label="Italic">
                  <Typography sx={{ fontSize: 12.5, fontStyle: "italic", fontFamily: "serif" }}>I</Typography>
                </ToggleButton>
              </ToggleButtonGroup>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={state.textStyle.align}
                onChange={(_, v: TextAlign | null) => {
                  if (v) amberArt.setTextStyle({ align: v });
                }}
                sx={{ "& .MuiToggleButton-root": { flex: 1, py: 0.2 } }}
              >
                {/* No pack glyph draws an alignment mark, and inventing one
                    beside its consumer would paint a fixed colour that stops
                    following the theme — the exact miss the shared kit exists
                    to prevent. Three initials are honest and readable at 11px. */}
                <ToggleButton value="left" aria-label="Align left">
                  <Typography sx={{ fontSize: 11 }}>L</Typography>
                </ToggleButton>
                <ToggleButton value="center" aria-label="Align centre">
                  <Typography sx={{ fontSize: 11 }}>C</Typography>
                </ToggleButton>
                <ToggleButton value="right" aria-label="Align right">
                  <Typography sx={{ fontSize: 11 }}>R</Typography>
                </ToggleButton>
              </ToggleButtonGroup>
              <Typography sx={{ fontSize: 10.5, color: token("dim") }}>Fill</Typography>
              <Box
                component="input"
                type="color"
                aria-label="Text fill colour"
                value={state.textStyle.color}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  amberArt.setTextStyle({ color: e.target.value })
                }
                sx={{ width: "100%", height: 26, border: `1px solid ${token("edge")}`, background: "transparent", borderRadius: "var(--axf-radius-tight)", p: 0.3 }}
              />
              <Typography sx={{ fontSize: 10.5, color: token("dim") }}>
                Stroke · {state.textStyle.strokeWidth ? `${state.textStyle.strokeWidth}px` : "off"}
              </Typography>
              <Slider
                size="small"
                min={0}
                max={TEXT_STROKE_MAX}
                step={0.5}
                value={state.textStyle.strokeWidth}
                aria-label="Text stroke width"
                onChange={(_, v) => amberArt.setTextStyle({ strokeWidth: Array.isArray(v) ? v[0]! : v })}
              />
              {state.textStyle.strokeWidth > 0 && (
                <Box
                  component="input"
                  type="color"
                  aria-label="Text stroke colour"
                  value={state.textStyle.strokeColor}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    amberArt.setTextStyle({ strokeColor: e.target.value })
                  }
                  sx={{ width: "100%", height: 26, border: `1px solid ${token("edge")}`, background: "transparent", borderRadius: "var(--axf-radius-tight)", p: 0.3 }}
                />
              )}
              <Typography sx={{ fontSize: 10, color: token("dim"), lineHeight: 1.35 }}>
                Click the canvas to set a box · drag its border to move it · Ctrl+Enter commits, Esc cancels.
                Committed text is pixels, as in Photoshop.
              </Typography>
            </>
          )}

          {/* The gradient strip. Rail state for the same reason the text
              strip is: a direction and a pair of ends are chosen per fill. */}
          {state.toolId === "gradient" && (
            <>
              <Divider />
              <Typography sx={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: token("dim") }}>
                Gradient
              </Typography>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={state.gradient.type}
                onChange={(_, v: GradientType | null) => {
                  if (v) amberArt.setGradientOptions({ type: v });
                }}
                sx={{ "& .MuiToggleButton-root": { flex: 1, py: 0.2, fontSize: 10.5 } }}
              >
                <ToggleButton value="linear">Linear</ToggleButton>
                <ToggleButton value="radial">Radial</ToggleButton>
              </ToggleButtonGroup>
              <Select
                size="small"
                value={state.gradient.colors}
                aria-label="Gradient colours"
                onChange={(e) => amberArt.setGradientOptions({ colors: e.target.value as GradientColors })}
                sx={{ fontSize: 11.5, "& .MuiSelect-select": { py: 0.5 } }}
              >
                <MenuItem value="fg-bg" dense sx={{ fontSize: 12 }}>
                  Colour → background
                </MenuItem>
                <MenuItem value="fg-transparent" dense sx={{ fontSize: 12 }}>
                  Colour → transparent
                </MenuItem>
              </Select>
              {/* One background layer, over a flat page colour rather than over
                  the checkerboard: the checker is four layered gradients with
                  their own sizes and positions, and adding a fifth layer to that
                  list makes CSS cycle the size and position lists across all
                  five. The transparent end reads perfectly well against a solid
                  panel, and this way it cannot silently mis-tile. */}
              <Box
                aria-hidden
                sx={{
                  height: 14,
                  borderRadius: "var(--axf-radius-tight)",
                  border: `1px solid ${token("edge")}`,
                  backgroundColor: token("page"),
                  backgroundImage: ramp
                }}
              />
              <FormControlLabel
                sx={{ m: 0, gap: 0.5 }}
                control={
                  <Switch
                    size="small"
                    checked={state.gradient.reverse}
                    onChange={(e) => amberArt.setGradientOptions({ reverse: e.target.checked })}
                  />
                }
                label={<Typography sx={{ fontSize: 11 }}>Reverse</Typography>}
              />
              <Typography sx={{ fontSize: 10, color: token("dim"), lineHeight: 1.35 }}>
                Drag to set the direction and the length — release fills the layer, or the selection when
                there is one. The brush opacity above is the fill's.
              </Typography>
            </>
          )}

          {/* The texture strip. The picker's eight thumbnails are the eight
              generators drawn small — the same tiles the fill uses, so what is
              chosen is what lands. */}
          {state.toolId === "texture" && (
            <>
              <Divider />
              <Typography sx={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: token("dim") }}>
                Texture
              </Typography>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={state.texture.kind}
                onChange={(_, v: TextureKind | null) => {
                  if (v) amberArt.setTextureOptions({ kind: v });
                }}
                sx={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gap: 0.4,
                  "& .MuiToggleButtonGroup-grouped": {
                    m: 0,
                    p: 0.3,
                    minWidth: 0,
                    border: `1px solid ${token("edge")}`,
                    borderRadius: "var(--axf-radius-tight)"
                  }
                }}
              >
                {TEXTURE_PATTERNS.map((pattern) => (
                  <ToggleButton
                    key={pattern.id}
                    value={pattern.id}
                    title={`${pattern.label} — ${pattern.hint}`}
                    aria-label={pattern.label}
                  >
                    <TextureSwatch kind={pattern.id} />
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
              <Typography sx={{ fontSize: 10.5, color: token("dim") }}>{texture.label}</Typography>
              <Typography sx={{ fontSize: 10.5, color: token("dim") }}>Scale · {state.texture.scale}×</Typography>
              <Slider
                size="small"
                min={0.25}
                max={4}
                step={0.25}
                value={state.texture.scale}
                aria-label="Texture scale"
                onChange={(_, v) => amberArt.setTextureOptions({ scale: Array.isArray(v) ? v[0]! : v })}
              />
              <Typography sx={{ fontSize: 10.5, color: token("dim") }}>
                Strength · {Math.round(state.texture.intensity * 100)}%
              </Typography>
              <Slider
                size="small"
                min={0.05}
                max={1}
                step={0.05}
                value={state.texture.intensity}
                aria-label="Texture strength"
                onChange={(_, v) => amberArt.setTextureOptions({ intensity: Array.isArray(v) ? v[0]! : v })}
              />
              <FormControlLabel
                sx={{ m: 0, gap: 0.5 }}
                control={
                  <Switch
                    size="small"
                    checked={state.texture.tint}
                    onChange={(e) => amberArt.setTextureOptions({ tint: e.target.checked })}
                  />
                }
                label={<Typography sx={{ fontSize: 11 }}>Tint with the colour</Typography>}
              />
              <Typography sx={{ fontSize: 10, color: token("dim"), lineHeight: 1.35 }}>
                Click to fill the layer, or the selection when there is one. Right-click a layer for
                “Texturize layer”, which lays the pattern over the pixels it already has.
              </Typography>
            </>
          )}

          <Divider />
          <Typography sx={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: token("dim") }}>
            Colour
          </Typography>
          {/* The Photoshop pair. Each chip IS its colour input rather than a
              swatch that opens one: a `<input type="color">` already draws a
              filled rectangle and already owns the platform's colour dialog, so
              a button in front of a hidden input would be a second thing to
              keep in sync with the first for no behaviour at all.
              Overlapping, foreground in front, because the overlap is what says
              they are ONE control with two halves — two chips in a row read as
              two unrelated colours, which is the misreading the swap key makes
              expensive. */}
          <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
            <Box sx={{ position: "relative", width: 50, height: 42, flex: "0 0 auto" }}>
              <Box
                component="input"
                type="color"
                aria-label="Background colour"
                title="Background"
                value={state.backgroundColor}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  amberArt.setBackgroundColor(e.target.value)
                }
                /* Remembered on BLUR, not on change: the dialog reports every
                   colour the pointer crosses on its way to the one somebody
                   wanted, and a recents list fed from that is eight shades of
                   the journey. Leaving the control is the act of choosing. */
                onBlur={() => amberArt.rememberColor(amberArt.getState().backgroundColor)}
                sx={{
                  position: "absolute",
                  right: 0,
                  bottom: 0,
                  width: 30,
                  height: 26,
                  border: `1px solid ${token("edge")}`,
                  background: "transparent",
                  borderRadius: "var(--axf-radius-tight)",
                  p: 0.2
                }}
              />
              <Box
                component="input"
                type="color"
                aria-label="Foreground colour"
                title="Foreground — what every tool paints with"
                value={state.color}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => amberArt.setColor(e.target.value)}
                onBlur={() => amberArt.rememberColor(amberArt.getState().color)}
                sx={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: 30,
                  height: 26,
                  zIndex: 1,
                  border: `1px solid ${token("edge")}`,
                  background: "transparent",
                  borderRadius: "var(--axf-radius-tight)",
                  p: 0.2
                }}
              />
            </Box>
            <Stack sx={{ gap: 0.1 }}>
              <Tooltip title="Swap foreground and background (X)">
                <IconButton
                  size="small"
                  aria-label="Swap foreground and background"
                  onClick={() => amberArt.swapColors()}
                  sx={{ p: 0.2, fontSize: 12 }}
                >
                  ⇄
                </IconButton>
              </Tooltip>
              <Tooltip title="Default colours — black over white (D)">
                <IconButton
                  size="small"
                  aria-label="Default colours"
                  onClick={() => amberArt.resetColors()}
                  sx={{ p: 0.2, fontSize: 12 }}
                >
                  ◨
                </IconButton>
              </Tooltip>
            </Stack>
          </Stack>

          {/* Sixteen fixed swatches, and whatever has been picked lately. Both
              set the FOREGROUND — a background swatch grid would double the
              surface to serve the colour that is chosen an order of magnitude
              less often, and X reaches it in one key. */}
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 0.3 }}>
            {PALETTE.map((hex) => (
              <Tooltip key={hex} title={hex}>
                <IconButton
                  size="small"
                  aria-label={`Use ${hex}`}
                  onClick={() => amberArt.pickColor(hex)}
                  sx={{ ...SWATCH_SX, background: hex, "&:hover": { background: hex, opacity: 0.85 } }}
                />
              </Tooltip>
            ))}
          </Box>
          {state.recentColors.length > 0 && (
            <>
              <Typography sx={{ fontSize: 10.5, color: token("dim") }}>Recent</Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 0.3 }}>
                {state.recentColors.map((hex) => (
                  <Tooltip key={hex} title={hex}>
                    <IconButton
                      size="small"
                      aria-label={`Use ${hex}`}
                      onClick={() => amberArt.pickColor(hex)}
                      sx={{ ...SWATCH_SX, background: hex, "&:hover": { background: hex, opacity: 0.85 } }}
                    />
                  </Tooltip>
                ))}
              </Box>
            </>
          )}

          <Typography sx={{ fontSize: 10.5, color: token("dim") }}>Size · {state.size}px</Typography>
          <Slider
            size="small"
            min={SIZE_MIN}
            max={SIZE_MAX}
            value={state.size}
            aria-label="Brush size"
            onChange={(_, v) => amberArt.setSize(Array.isArray(v) ? v[0] : v)}
          />
          <Typography sx={{ fontSize: 10.5, color: token("dim") }}>
            Opacity · {Math.round(state.alpha * 100)}%
          </Typography>
          <Slider
            size="small"
            min={0.05}
            max={1}
            step={0.05}
            value={state.alpha}
            aria-label="Brush opacity"
            onChange={(_, v) => amberArt.setAlpha(Array.isArray(v) ? v[0] : v)}
          />
          {/* Under size and opacity, and shown for every tool rather than only
              for the brush: it is the tip's own property, so the eraser feathers
              by it and the smudge pulls with the edge it describes. */}
          <Typography sx={{ fontSize: 10.5, color: token("dim") }}>
            Hardness · {state.hardness}%
          </Typography>
          <Slider
            size="small"
            min={0}
            max={100}
            value={state.hardness}
            aria-label="Brush hardness"
            onChange={(_, v) => amberArt.setHardness(Array.isArray(v) ? v[0]! : v)}
          />
        </Paper>

        {/* ---------------------------------------------------------- canvas */}
        <Box sx={{ flex: 1, minWidth: 320, display: "grid", gap: 0.6 }}>
          <Paper
            variant="outlined"
            data-axf-area="amberart.canvas"
            sx={{ p: 0.8, minWidth: 0, background: token("panel") }}
          >
            {/* THE SCROLL PANE — the whole of zoom and pan, and the only thing
                either of them touches. The backing store stays 1600×1000 at
                every magnification; what changes is the canvas' CSS width, and
                `at()` normalises the pointer by the element's own rect, so not
                one line of pointer maths knows zoom exists.
                `safe center` rather than plain `center`: a centred flex item
                that is WIDER than its container overflows equally on both sides,
                and the left half of an 8× canvas becomes unreachable because
                scroll cannot reach negative offsets. `safe` drops the centring
                exactly when it would do that. */}
            <Box
              ref={wrapRef}
              sx={{
                overflow: "auto",
                overscrollBehavior: "contain",
                display: "flex",
                justifyContent: "safe center",
                alignItems: "safe center",
                maxHeight: state.zoom > 1 ? ZOOMED_PANE_H : "none"
              }}
            >
              {/* The overlay's containing block, sized by the canvas itself.
                  `display: block` on the canvas is what makes the two boxes
                  identical — an inline canvas sits on a text baseline and leaves
                  a few pixels of descender space underneath, which would put
                  every text box that many pixels out.
                  The width pair is the zoom: `zoom × 100%` of the pane, capped at
                  `CANVAS_W × zoom`, which is `zoom × min(column, 1600)`. At zoom
                  1 that is `100%` capped at 1600 — the exact rule this block
                  carried before magnification existed. */}
              <Box
                sx={{
                  position: "relative",
                  flex: "0 0 auto",
                  width: `${state.zoom * 100}%`,
                  maxWidth: CANVAS_W * state.zoom
                }}
              >
                <Box
                  component="canvas"
                  ref={viewRef}
                  width={CANVAS_W}
                  height={CANVAS_H}
                  aria-label="AmberArt canvas"
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerLeave={onPointerUp}
                  sx={{
                    display: "block",
                    width: "100%",
                    aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
                    touchAction: "none",
                    /* Space wins over every tool, because that is what the
                       modifier MEANS — the brush is still selected and the
                       cursor has to stop claiming it is about to paint. */
                    cursor: spacePan
                      ? "grab"
                      : state.toolId === "move"
                        ? "move"
                        : state.toolId === "text"
                          ? "text"
                          : state.toolId === "zoom"
                            ? "zoom-in"
                            : "crosshair",
                    borderRadius: "var(--axf-radius-tight)",
                    border: `1px solid ${token("edge")}`,
                    ...(settings.checkerboard ? CHECKER : { background: token("page") })
                  }}
                />
                {state.textDraft && (
                  <TextOverlay
                    key={state.textDraft.id}
                    draft={state.textDraft}
                    style={state.textStyle}
                    scale={scale}
                  />
                )}
              </Box>
            </Box>
          </Paper>
          <Typography sx={{ ...MONO, fontSize: 11, color: state.message ? token("accent") : token("dim") }}>
            {state.message ||
              `${CANVAS_W}×${CANVAS_H} · ${zoomPct}% · right-click the canvas or a layer for actions`}
          </Typography>
        </Box>

        {/* --------------------------------------------------- layers + panel */}
        <Box sx={{ display: "grid", gap: 1.2, alignContent: "start", minWidth: 260, width: { xs: "100%", lg: 320 } }}>
          <Paper variant="outlined" sx={{ p: 1, display: "grid", gap: 0.6 }}>
            <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
              <Typography sx={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: token("dim") }}>
                Layers
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Button size="small" sx={{ fontSize: 10.5, minWidth: 0, py: 0 }} onClick={() => amberArt.addLayer()}>
                Add
              </Button>
            </Stack>
            {[...state.layers].reverse().map((layer) => {
              const active = layer.id === state.activeLayer;
              return (
                <Box
                  key={layer.id}
                  data-axf-area="amberart.layer"
                  data-axf-layer={layer.id}
                  data-axf-layer-name={layer.name}
                  onClick={() => amberArt.setActiveLayer(layer.id)}
                  sx={{
                    display: "grid",
                    gap: 0.5,
                    px: 0.6,
                    py: 0.4,
                    cursor: "pointer",
                    borderRadius: "var(--axf-radius-tight)",
                    border: `1px solid ${active ? token("accent") : "transparent"}`,
                    background: active ? `color-mix(in srgb, ${token("accent")} 10%, transparent)` : "transparent"
                  }}
                >
                  <Stack direction="row" sx={{ alignItems: "center", gap: 0.6 }}>
                    <IconButton
                      size="small"
                      title={layer.visible ? "Hide" : "Show"}
                      aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        amberArt.patchLayer(layer.id, { visible: !layer.visible });
                      }}
                      sx={{ p: 0.25 }}
                    >
                      {/* One glyph, dimmed when hidden. The pack has no `eye-off`,
                          and inventing one HERE would paint a fixed colour that
                          stops following the theme — the exact failure the shared
                          kit exists to prevent. */}
                      <Glyph id="icon-eye" size={13} style={{ opacity: layer.visible ? 1 : 0.35 }} />
                    </IconButton>
                    <Box sx={{ opacity: layer.visible ? 1 : 0.4, display: "flex" }}>
                      <LayerThumb layerId={layer.id} tick={thumbTick} />
                    </Box>
                    {renaming === layer.id ? (
                      <TextField
                        size="small"
                        autoFocus
                        variant="standard"
                        value={draft}
                        aria-label={`Rename ${layer.name}`}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            amberArt.renameLayer(layer.id, draft);
                            setRenaming(null);
                          } else if (e.key === "Escape") {
                            escaped.current = true;
                            setRenaming(null);
                          }
                          e.stopPropagation();
                        }}
                        onBlur={() => {
                          /* Esc already unmounted this field; committing here
                             would apply the draft the Esc just abandoned. */
                          if (escaped.current) {
                            escaped.current = false;
                            return;
                          }
                          amberArt.renameLayer(layer.id, draft);
                          setRenaming(null);
                        }}
                        sx={{ flex: 1, "& .MuiInputBase-input": { fontSize: 12, py: 0.2 } }}
                      />
                    ) : (
                      <Typography
                        title="Double-click to rename"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          escaped.current = false;
                          setDraft(layer.name);
                          setRenaming(layer.id);
                        }}
                        sx={{ fontSize: 12, flex: 1, opacity: layer.visible ? 1 : 0.5 }}
                        noWrap
                      >
                        {layer.name}
                      </Typography>
                    )}
                    <Tooltip title="Bring forward">
                      <IconButton size="small" sx={{ p: 0.2, fontSize: 11 }} onClick={(e) => { e.stopPropagation(); amberArt.moveLayer(layer.id, 1); }}>
                        ↑
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Send back">
                      <IconButton size="small" sx={{ p: 0.2, fontSize: 11 }} onClick={(e) => { e.stopPropagation(); amberArt.moveLayer(layer.id, -1); }}>
                        ↓
                      </IconButton>
                    </Tooltip>
                  </Stack>

                  {/* The active layer alone carries its blend and opacity, the
                      way Photoshop's panel does: sixteen selects stacked down a
                      narrow column would bury the list the panel is FOR. */}
                  {active && (
                    <Stack
                      direction="row"
                      sx={{ alignItems: "center", gap: 0.6, pl: 0.2, pb: 0.2 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Select
                        size="small"
                        variant="standard"
                        value={layer.blend}
                        aria-label={`Blend mode for ${layer.name}`}
                        onChange={(e) => amberArt.setLayerBlend(layer.id, e.target.value)}
                        sx={{ flex: 1, fontSize: 11, "& .MuiSelect-select": { py: 0.2 } }}
                      >
                        {BLEND_MODES.map((mode) => (
                          <MenuItem key={mode.id} value={mode.id} dense sx={{ fontSize: 11.5 }}>
                            {mode.label}
                          </MenuItem>
                        ))}
                      </Select>
                      <Typography sx={{ ...MONO, fontSize: 10.5, color: token("dim"), width: 34, textAlign: "right" }}>
                        {Math.round(layer.opacity * 100)}%
                      </Typography>
                      <Slider
                        size="small"
                        min={0}
                        max={1}
                        step={0.01}
                        value={layer.opacity}
                        aria-label={`Opacity of ${layer.name}`}
                        onChange={(_, v) => amberArt.setLayerOpacity(layer.id, Array.isArray(v) ? v[0]! : v)}
                        onChangeCommitted={() => amberArt.commitLayerOpacity()}
                        sx={{ flex: 1, minWidth: 70 }}
                      />
                    </Stack>
                  )}
                </Box>
              );
            })}
          </Paper>

          {/* Below the layers, above the plugin panel: a filter is a layer-wide
              act, so it belongs beside the layer it will write to. */}
          <FiltersPanel open={state.filtersOpen} hasSelection={state.hasSelection} />

          {activePanel ? (
            <Paper variant="outlined" sx={{ p: 1, display: "grid", gap: 0.8 }}>
              <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
                <Glyph id={activePanel.glyph} size={15} />
                <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{activePanel.title}</Typography>
                <Box sx={{ flex: 1 }} />
                <Chip size="small" variant="outlined" label={activePanel.from} sx={{ ...MONO, height: 17, fontSize: 9.5 }} />
              </Stack>
              {activePanel.summary ? (
                <Typography sx={{ fontSize: 11, color: token("dim") }}>{activePanel.summary}</Typography>
              ) : null}
              <Divider />
              {/* The panel is loaded on first selection, not at boot — the
                  contribution carries a `load` thunk, so the point stays
                  data-only and Node can still import the plugin's entry. */}
              <React.Suspense
                fallback={
                  <Typography sx={{ fontSize: 11.5, color: token("dim") }}>Loading the tool…</Typography>
                }
              >
                <activePanel.Panel host={host} />
              </React.Suspense>
            </Paper>
          ) : contributed.length === 0 ? (
            <Paper variant="outlined" sx={{ p: 1.2 }}>
              <Typography sx={{ fontSize: 11.5, color: token("dim") }}>
                No tool plugins are contributing to <code>amberart.tool</code> yet. A plugin declares
                a contribution against the point; this module never imports one.
              </Typography>
            </Paper>
          ) : null}
        </Box>
      </Box>

    </Box>
  );
}
