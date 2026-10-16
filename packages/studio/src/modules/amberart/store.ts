"use client";

/**
 * @file The AmberArt document — layers, pixels and history, as a singleton.
 *
 * GizmoX kept all of this in component state. It is a store here for the same
 * reason the Task Manager's and the Expense Tracker's are: the context-menu
 * rows are plain functions in `amberart.commands.ts` with no hooks, and a
 * command that cannot reach the undo stack is a menu row that cannot undo.
 *
 * ## What lives where
 *
 * - **Layer metadata** (id, name, visible, opacity, blend) is React state — it
 *   is what the layer list renders, and it changes rarely.
 * - **Pixels** live in offscreen `<canvas>` buffers held in a `Map`, keyed by
 *   layer id, and are NEVER copied into React state. A 1600×1000 RGBA buffer is
 *   6.4 MB; putting one in a snapshot object would re-render the whole screen
 *   on every brush move.
 * - **History** is an array of tagged entries, capped, also outside React: a
 *   `pixels` entry is one layer's `ImageData` before a stroke, a `structure`
 *   entry is the layer stack before a merge/flatten/duplicate/delete/rename/
 *   reorder/blend change. `undoDepth` is the one number the settings expose,
 *   because the cap is a real memory decision: 30 snapshots is ~190 MB of
 *   pixels. A `structure` entry is nearly free by comparison — it holds buffer
 *   REFERENCES, and clones exactly the one buffer an op is about to overwrite.
 *
 * - **The selection** is an offscreen MASK canvas (`selection.ts`), on the same
 *   terms as the pixels and for the same reason — 6.4 MB of it. The cheap half
 *   grows exactly one boolean, `hasSelection`; the bounds and the mask itself
 *   are reached by method, so an add-to-selection drag that changes the shape
 *   but not the existence of a selection does not re-render the layer panel.
 *
 * - **A transform session** — the move tool's floating pixels — is a third
 *   offscreen buffer plus a {@link Transform} (`transform.ts`), and it obeys the
 *   same rule for the third time: a scale drag changes the transform sixty times
 *   a second, and state grows exactly one boolean, `floating`. Everything the
 *   screen needs to DO with it goes through a method here, so the component
 *   never holds a matrix and cannot hold a stale one.
 *
 * The subscribe/snapshot pair therefore reports the CHEAP half only (layers,
 * counters, tool state), and the canvas is repainted imperatively by
 * `composite()`. That split is the whole performance design of the module.
 */

import * as React from "react";

import {
  BLEND_NORMAL,
  CANVAS_H,
  CANVAS_W,
  blendLabel,
  drawShape,
  floodFill,
  fitBox,
  hexToRgba,
  loadImage
} from "./canvas";
import type { Layer, Point, Snapshot, StructureSnapshot } from "./canvas";
import {
  clipThrough,
  combineMask,
  invertMask,
  maskBoundsFrom,
  maskCoverage,
  maskOutlinePath,
  maskedResult,
  rectMask
} from "./selection";
import type { MaskCombine, MaskData, SelectionBounds } from "./selection";
import {
  GRIP_RADIUS,
  HANDLE_SIZE,
  SCALE_HANDLES,
  gripPoint,
  handlePoint,
  identityTransform,
  hitTestHandle,
  movedTo,
  nudged,
  opaqueBounds,
  rotateToward,
  scaleFromHandle,
  transformCorners,
  transformMatrix,
  transformedBounds
} from "./transform";
import type { HandleId, Transform } from "./transform";
import { filterLabel, previewScale, runFilter } from "./filters";
import type { FilterId, FilterParams } from "./filters";
import { DEFAULT_TEXT_STYLE, blockWidth, drawText, textLines } from "./text";
import type { TextStyle } from "./text";
import { textureTile, tintTile } from "./textures";
import type { TextureKind } from "./textures";

export type ToolId =
  | "brush"
  | "eraser"
  | "line"
  | "rect"
  | "ellipse"
  | "fill"
  | "picker"
  | "marquee"
  | "lasso"
  | "wand"
  | "move"
  | "text"
  | "gradient"
  | "texture"
  | "stamp"
  | "smudge";

/** Linear runs along the drag; radial spreads from where the drag began. */
export type GradientType = "linear" | "radial";

/**
 * Which two colours the ramp runs between.
 *
 * Photoshop's first two presets, and the only two that need no colour
 * management: the foreground is the rail's own swatch and the background is
 * {@link AmberArtStore.getBackgroundColor}. Anything richer is a gradient
 * EDITOR, which is its own surface and is not what this phase buys.
 */
export type GradientColors = "fg-bg" | "fg-transparent";

export interface GradientOptions {
  readonly type: GradientType;
  readonly colors: GradientColors;
  /** Swap the ends. Cheaper than dragging backwards, and Photoshop has it. */
  readonly reverse: boolean;
}

export interface TextureOptions {
  readonly kind: TextureKind;
  /** Tile magnification, 0.25–4. Applied with `ctx.scale` around the fill. */
  readonly scale: number;
  /** How strongly the pattern lands — the fill's `globalAlpha`. */
  readonly intensity: number;
  /** Multiply the tile by the foreground colour. */
  readonly tint: boolean;
}

/**
 * An open text box — where it sits and what has been typed into it.
 *
 * Unlike the mask and the float, this one IS in the cheap half: it is a point
 * and a string, the screen renders the string, and a keystroke has to reach the
 * DOM overlay anyway. What would be a defect is the rasterized PIXELS living
 * here, and they never do — {@link AmberArtStore.commitText} writes them
 * straight onto a layer buffer and drops the draft in the same breath.
 */
export interface TextDraft {
  /** The block's top-left, in canvas pixels. */
  readonly at: Point;
  /** What has been typed. Newlines are real lines. */
  readonly value: string;
  /**
   * A per-session counter.
   *
   * The screen keys the overlay on it, which is what makes "click somewhere
   * else with the text tool" a NEW box that takes focus rather than the old
   * one silently reused with a caret still sitting where it was.
   */
  readonly id: number;
}

/**
 * Pixels in the air: lifted out of a layer, not yet put back down.
 *
 * `buffer` is exactly the size of the region that was lifted, so the transform's
 * local space and the buffer's own pixels are the same thing — see
 * `transform.ts`. `mask` is the selection cropped to the same box, carried along
 * so the selection lands transformed WITH the pixels rather than staying behind
 * where they used to be.
 */
interface FloatSession {
  readonly layerId: string;
  readonly buffer: HTMLCanvasElement;
  readonly mask: HTMLCanvasElement | null;
  /** Whether the lift came from a selection — decides what commit re-selects. */
  readonly fromSelection: boolean;
  /**
   * The redo branch as it stood before the lift pushed its undo entry.
   *
   * Held so a CANCELLED session can put it back. Pushing history drops the redo
   * branch, which is right for anything that changes the document — but a
   * cancel changes nothing, and a person who undid three strokes, tried a move
   * and pressed Esc should still have their three redos.
   */
  readonly redo: readonly Snapshot[];
  t: Transform;
}

/** The pointer's grip on a floating session, for the length of one drag. */
interface TransformDrag {
  readonly mode: HandleId | "body";
  readonly from: Point;
  /** The session's centre offset when the drag began — body drags are relative. */
  readonly dx: number;
  readonly dy: number;
}

/** How long one dash step of the marching ants lasts. */
const ANTS_MS = 80;
/** The dash pattern, in canvas pixels. The light stroke is offset by half. */
const ANTS_DASH = 4;

/**
 * How far apart the dabs of a dab-train stroke sit, as a fraction of the size.
 *
 * A quarter of the brush width is the industry default (Photoshop's own spacing
 * starts at 25%), and it is a real trade rather than a taste: wider and a soft
 * stroke becomes a row of visible spots, tighter and a slow drag stacks dozens
 * of alpha dabs on the same pixels, which darkens the line where the hand
 * hesitated. Quarter-width is the widest spacing at which consecutive dabs still
 * overlap at their half-alpha radius.
 */
const DAB_SPACING = 4;

/**
 * How much of the sampled patch a single smudge dab lays down.
 *
 * The classic pull: each dab carries about six tenths of what it picked up, so
 * colour fades along the drag instead of being teleported. Multiplied by the
 * rail's opacity, which is what makes that slider the smudge's STRENGTH.
 */
const SMUDGE_PULL = 0.6;

/**
 * The zoom range, and what one press of `+` or one wheel notch is worth.
 *
 * A RATIO rather than an increment, because zoom is perceived multiplicatively:
 * a fixed +0.25 is a quarter of the picture at 1× and a thirty-second of it at
 * 8×, so the same key would feel coarse close in and useless far out. 1.25 is
 * about a dozen presses across the whole range, which is few enough to cross
 * quickly and fine enough to land on a value somebody meant.
 */
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 8;
export const ZOOM_STEP = 1.25;

/** How many recently used colours the swatch grid remembers. */
export const RECENT_COLORS = 8;

/** What `D` resets the pair to — Photoshop's own default, black over white. */
export const DEFAULT_FOREGROUND = "#000000";
export const DEFAULT_BACKGROUND = "#ffffff";

/** The clone-source crosshair's arms, past the circle, in canvas pixels. */
const MARKER_ARM = 5;
/** Bounds on the crosshair's circle, so it stays findable at any brush size. */
const MARKER_MIN = 6;
const MARKER_MAX = 40;

export interface AmberArtState {
  readonly layers: readonly Layer[];
  readonly activeLayer: string;
  readonly toolId: string;
  /** The FOREGROUND colour — what every tool paints with. */
  readonly color: string;
  /**
   * The background colour — the other half of Photoshop's pair.
   *
   * It is not a second brush: nothing paints with it directly. It is what a
   * "foreground → background" gradient ends on, what `X` swaps into the
   * foreground, and what `D` resets to white. Read everywhere through
   * {@link AmberArtStore.getBackgroundColor}, which is the method P5 wrote
   * against a constant precisely so this phase could make it real without a
   * single consumer changing — and none did.
   */
  readonly backgroundColor: string;
  /**
   * The last {@link RECENT_COLORS} colours deliberately chosen, newest first.
   *
   * Fed by {@link AmberArtStore.rememberColor} rather than by
   * {@link AmberArtStore.setColor}, and the distinction is the whole design: a
   * native colour input fires `input` on every pixel of a drag through its
   * gradient, so a recents list that watched the VALUE would fill with eight
   * indistinguishable shades of whatever was passed through on the way to the
   * colour somebody wanted. It watches the ACT of choosing instead — an
   * eyedropper pick, a swatch click, a colour dialog closing.
   */
  readonly recentColors: readonly string[];
  readonly size: number;
  readonly alpha: number;
  /**
   * How sharp the brush tip is, 0–100 — rail state beside `size` and `alpha`.
   *
   * 100 is the hard round tip AmberArt has always had, and it is deliberately
   * the default AND a fast path: at 100 the brush still runs the plain
   * `lineTo`/`stroke` code it ran before this existed, so nothing about the
   * common case got slower to buy the soft one. Below 100 the stroke becomes a
   * train of radial-gradient dabs whose opaque core ends at the hardness
   * fraction of the radius — see {@link AmberArtStore.paintSegment}.
   */
  readonly hardness: number;
  /**
   * How magnified the canvas is, {@link ZOOM_MIN}–{@link ZOOM_MAX}.
   *
   * **A multiplier on the FIT width, not on the document's pixels**, and `1` is
   * therefore "fit the column" — which is what AmberArt has always done and what
   * this phase had to preserve exactly. The screen spends it as
   * `width: ${zoom * 100}%` with a `maxWidth` of `CANVAS_W * zoom`, so the
   * displayed width is `zoom × min(column, 1600)`: continuous, monotonic, and
   * identical to the old markup at 1. A zoom expressed against 1600 instead
   * would make `1` mean 1600px, and "the default preserves fit" and "1 is 100%
   * of the document" cannot both be true of the same number.
   *
   * The percentage on screen is NOT this number. It is measured off the same
   * `getBoundingClientRect()` the pointer maths use, so it reports the true
   * scale (58% at fit in a 930px column) rather than a figure that is only
   * right when the column happens to be 1600 wide.
   *
   * In the cheap half although the canvas repaints for it, unlike the mask and
   * the float: it changes once per gesture, and the thing that has to change
   * with it is a CSS width — which is React's job, not `composite()`'s. The
   * backing store stays 1600×1000 at every zoom, so not one drawing call in
   * this file knows this field exists.
   */
  readonly zoom: number;
  readonly strokes: number;
  readonly undoCount: number;
  readonly redoCount: number;
  /**
   * Whether a selection exists — the ONLY thing the selection puts in state.
   *
   * The screen needs it to enable Deselect/Invert and to show the chip; the
   * mask, its coverage and its bounds are all reached by method, because a
   * marquee drag that adds to an existing selection changes all three and
   * must not re-render the layer panel per pointer move.
   */
  readonly hasSelection: boolean;
  /**
   * Whether pixels are currently in the air — the move tool's whole state.
   *
   * The transform itself (offset, scale, rotation) changes on every pointer
   * move of a drag and is NOT here for the same reason the mask is not: the
   * screen would re-render sixty times a second to draw a box the compositor is
   * already drawing. What the screen does with this boolean is show the commit
   * and cancel affordances, which change once per session.
   */
  readonly floating: boolean;
  /**
   * Whether a text overlay is open and taking keystrokes.
   *
   * **The predicate every keyboard map must check**, including P8's global one:
   * while this is true the canvas shortcuts belong to the person typing, not to
   * the canvas. It is deliberately a plain named boolean rather than
   * `textDraft !== null` — a guard should be able to ask the question without
   * knowing the shape of a draft, and the two are set together by the only two
   * methods that own either ({@link AmberArtStore.openText} and
   * {@link AmberArtStore.closeText}), so they cannot drift apart.
   */
  readonly textEditing: boolean;
  /** The open text box, or `null`. Non-null exactly when `textEditing`. */
  readonly textDraft: TextDraft | null;
  /**
   * What the text tool draws with — tool state, exactly like `color` and
   * `size` beside it, and rendered by the rail's options strip. Not a setting:
   * a font and a size are a per-block decision, and a dialog is the wrong place
   * for a value that changes between one word and the next.
   */
  readonly textStyle: TextStyle;
  /**
   * What the gradient tool ramps between, and how — rail state, exactly like
   * {@link AmberArtState.textStyle} and for the same reason: it is chosen per
   * fill, several times a minute, and the minimal-sui rule's test ("the
   * surface cannot work properly without it") fails on the other side for a
   * value that belongs beside the tool that reads it.
   *
   * In the STORE rather than in the screen, which is where the wand's tolerance
   * lives, because a gradient is committed by a store method that a
   * context-menu command must also be able to reach — and a command has no
   * hooks.
   */
  readonly gradient: GradientOptions;
  /**
   * Which pattern the texture tool lays down, and at what scale and strength.
   *
   * Here rather than in the screen for a harder reason than the gradient's:
   * `amberart.layer.texturize` is a menu row, its handler is a plain function
   * in `amberart.commands.ts`, and "the current pattern" has to be answerable
   * from outside React or that row cannot exist.
   */
  readonly texture: TextureOptions;
  /**
   * Where the clone stamp reads from, or `null` until an Alt-click sets it.
   *
   * In the cheap half although it is a point, unlike the mask and the float:
   * it changes once per Alt-click, not once per frame, and the rail has to be
   * able to say whether the tool is armed — a stamp that silently refuses every
   * stroke because nobody ever Alt-clicked is the whole tool's first-run
   * experience. The point that MOVES with the brush during a stroke is private
   * (`#stampAt`) for exactly the reason this one is not.
   */
  readonly stampSource: Point | null;
  /**
   * Whether the filters panel is unfolded.
   *
   * In the STORE rather than in the screen for one reason, and it is the same
   * reason `texture` is: `amberart.filters.open` is a context-menu row, its
   * handler is a plain function in `amberart.commands.ts`, and a command with
   * no hooks cannot set a component's `useState`. The panel's CHOSEN filter and
   * its parameters are not here — those change per slider tick, nothing outside
   * the panel asks about them, and putting them here would push a store
   * notification through every subscriber on every pixel of a drag.
   */
  readonly filtersOpen: boolean;
  /** The last thing that happened, shown in the status strip. */
  readonly message: string | null;
}

const INITIAL: AmberArtState = {
  layers: [],
  activeLayer: "",
  toolId: "brush",
  color: "#ff7a1a",
  backgroundColor: DEFAULT_BACKGROUND,
  recentColors: [],
  size: 12,
  alpha: 1,
  hardness: 100,
  zoom: 1,
  strokes: 0,
  undoCount: 0,
  redoCount: 0,
  hasSelection: false,
  floating: false,
  textEditing: false,
  textDraft: null,
  textStyle: DEFAULT_TEXT_STYLE,
  gradient: { type: "linear", colors: "fg-bg", reverse: false },
  texture: { kind: "grain", scale: 1, intensity: 0.6, tint: false },
  stampSource: null,
  filtersOpen: false,
  message: null
};

type Listener = () => void;

let layerSeq = 0;
const nextLayerId = (): string => `layer-${++layerSeq}`;

let textSeq = 0;

class AmberArtStore {
  #state: AmberArtState = INITIAL;
  #listeners = new Set<Listener>();
  /** Offscreen pixels per layer — never in `#state`, see the docblock. */
  #buffers = new Map<string, HTMLCanvasElement>();
  #undo: Snapshot[] = [];
  #redo: Snapshot[] = [];
  #undoDepth = 30;
  /** The on-screen canvas, handed over by the component on mount. */
  #view: HTMLCanvasElement | null = null;
  /**
   * The layer whose opacity slider is mid-drag.
   *
   * A slider fires per pixel of travel; without this, one drag would fill the
   * whole undo stack with near-identical entries and Ctrl+Z would crawl back
   * through them. The snapshot is taken on the first movement and the window
   * closes when the drag commits — or the moment anything else pushes history.
   */
  #opacityDrag: string | null = null;

  /* ------------------------------------------------------- the dab train */

  /**
   * The brush tip, pre-rendered once per (size, hardness, colour).
   *
   * The dab-train brushes place a tip every few pixels of travel, so anything
   * allocated per dab is allocated hundreds of times a second — a `CanvasGradient`
   * per dab is exactly the mistake the store's docblock is about, one level down
   * from the `ImageData` one. So the tip is drawn ONCE into this canvas and each
   * dab is a `drawImage`, which is the cheapest thing a 2D context does.
   *
   * ONE canvas, resized in place rather than replaced: three brushes read it
   * (soft brush, soft eraser, and the smudge, which uses it as its tip MASK), and
   * a per-stroke allocation would put
   * a garbage-collection pause in the middle of a drag.
   */
  #tip: HTMLCanvasElement | null = null;
  /** What `#tip` currently holds, so it is rebuilt only when it is wrong. */
  #tipKey = "";
  /**
   * Distance still to travel before the next dab lands.
   *
   * Carried ACROSS segments, which is the whole reason it is a field: a pointer
   * move is 1–3 pixels and a dab spacing is a quarter of the brush, so a
   * per-segment counter starting at zero would stamp one dab per pointer event
   * and a fast drag and a slow one would lay down wildly different amounts of
   * paint for the same gesture.
   */
  #dabPending = 0;

  /* ------------------------------------------------------- clone + smudge */

  /**
   * The active layer as it stood when the current clone stroke began.
   *
   * The clone stamp MUST read from this rather than from the layer, or it reads
   * back the paint it has just laid down: with the source above the pointer, a
   * downward drag would copy its own output one dab at a time and smear the
   * sampled pixels down the canvas forever. Held (not re-allocated per stroke)
   * for the reason `#tip` is.
   */
  #snapshot: HTMLCanvasElement | null = null;
  /**
   * Source minus stroke-origin, frozen when the stroke begins.
   *
   * Fixing it at stroke start is what makes the sample point travel WITH the
   * brush — paint at `p` and the pixels come from `p + delta` — so one Alt-click
   * clones a whole region rather than smearing one point across it. The next
   * stroke re-anchors on the same source, which is Photoshop's behaviour with
   * Aligned off and the honest default: the source marker is still sitting where
   * the person put it, so that is where the next stroke should read from.
   */
  #stampDelta: Point | null = null;
  /** Where the stamp is reading from RIGHT NOW — the marker follows this. */
  #stampAt: Point | null = null;
  /** The brush-sized patch a smudge dab picks up and puts down. Reused. */
  #patch: HTMLCanvasElement | null = null;
  /** The dab the smudge last landed on — what the next one samples. */
  #smudgeFrom: Point | null = null;

  /* ------------------------------------------------------------ selection */

  /** The mask: opaque white where selected. Never in `#state` — 6.4 MB. */
  #selection: HTMLCanvasElement | null = null;
  /** The mask's coverage, read once per selection change and reused. */
  #coverage: MaskData | null = null;
  /** The tight box, so a clipped draw only touches the pixels it can reach. */
  #bounds: SelectionBounds | null = null;
  /** The ants' outline, traced once per selection change and stroked per frame. */
  #ants: Path2D | null = null;
  #antsPhase = 0;
  #antsRaf: number | null = null;
  #antsAt = 0;
  /**
   * Suppress everything on the view that is CHROME rather than image.
   *
   * Set across {@link pickAt} (see its docblock) and across {@link exportPng},
   * which has exactly the same problem for exactly the same reason: the ants and
   * the transform box are painted onto the view, and the view is what
   * `toDataURL` reads. A PNG with a dashed rectangle baked into it is a file
   * nobody can use and a bug nobody notices until they open the export.
   */
  #chromeHidden = false;

  /* -------------------------------------------------------------- filters */

  /**
   * The active layer as it was when the filter session began.
   *
   * A filter session has a SOURCE, fixed for its life, exactly as Photoshop's
   * filter dialogs do: every slider move re-runs the filter against the
   * original pixels rather than against the last preview, or dragging the blur
   * radius from 4 to 8 would blur a blur. It is dropped by {@link #dropFilter}
   * the moment anything else writes to a layer, so it cannot go stale.
   */
  #filterSource: ImageData | null = null;
  /** Which layer {@link #filterSource} and {@link #filterView} belong to. */
  #filterLayer: string | null = null;
  /**
   * The filtered pixels, standing in for the layer's own during a preview.
   *
   * Substituted for the buffer inside `composite()`'s layer loop rather than
   * painted over the top through {@link setPreview}: that callback runs AFTER
   * the whole stack, so a preview of the bottom layer would appear above every
   * layer over it — the same lie the floating transform's docblock refuses, and
   * for a filter it would be permanent rather than momentary.
   */
  #filterView: HTMLCanvasElement | null = null;
  /** The half-size scratch a costly preview runs in. See `previewScale`. */
  #filterHalf: HTMLCanvasElement | null = null;

  /* ------------------------------------------------------------ transform */

  /** Pixels in the air — the move tool's session. Never in `#state`. */
  #float: FloatSession | null = null;
  /** The pointer's current grip on it, for the length of one drag. */
  #drag: TransformDrag | null = null;

  /**
   * The live drag preview — the shape tools' rubber band, the marquee's box.
   *
   * It is held rather than passed because the ants ticker repaints on its own
   * clock: a `composite()` from the animation frame would wipe a rubber band
   * that the pointer is not currently moving, and the band would vanish
   * whenever the hand held still mid-drag.
   */
  #preview: ((ctx: CanvasRenderingContext2D) => void) | null = null;

  subscribe = (fn: Listener): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getState = (): AmberArtState => this.#state;
  /** Constant, so the server render and the hydrating client render agree. */
  getServerState = (): AmberArtState => INITIAL;

  #set(patch: Partial<AmberArtState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const fn of this.#listeners) fn();
  }

  /** Say what just happened. The screen shows it and clears it on a timer. */
  say(message: string): void {
    this.#set({ message });
  }

  setUndoDepth(depth: number): void {
    this.#undoDepth = Math.max(1, depth);
  }

  /* ------------------------------------------------------------ buffers */

  /** The pixel buffer for a layer, created on demand. Browser-only. */
  buffer(id: string): HTMLCanvasElement | null {
    if (typeof document === "undefined") return null;
    let c = this.#buffers.get(id);
    if (!c) {
      c = document.createElement("canvas");
      c.width = CANVAS_W;
      c.height = CANVAS_H;
      this.#buffers.set(id, c);
    }
    return c;
  }

  context(id: string): CanvasRenderingContext2D | null {
    return this.buffer(id)?.getContext("2d") ?? null;
  }

  /** Hand the on-screen canvas over. Called once, from a layout effect. */
  attachView(view: HTMLCanvasElement | null): void {
    this.#view = view;
    if (view) this.composite();
  }

  get view(): HTMLCanvasElement | null {
    return this.#view;
  }

  /**
   * Redraw the visible canvas from the layer stack, bottom to top.
   *
   * `preview` is how the shape tools draw a rubber band without touching a
   * layer: the band is painted onto the VIEW after the composite and is gone
   * on the next repaint, so an abandoned drag leaves no pixels behind.
   *
   * Each layer composites through its own `blend` — the browser's compositor
   * implements the same separable and non-separable modes Photoshop's names
   * refer to, so this is the whole of the blend-mode feature. Both context
   * globals are reset before `preview` runs: a rubber band must never inherit
   * the last layer's blend, and a leaked `globalCompositeOperation` would make
   * the NEXT unrelated draw on the view wrong in a way that is very hard to
   * read back from the pixels.
   *
   * A floating transform is drawn INSIDE the layer loop, immediately after the
   * layer it was lifted from and with that layer's own alpha and blend. Drawing
   * it after the whole stack would be easier and would be a lie: pixels lifted
   * off the bottom layer would float over the top one, so a move that is about
   * to land underneath something would look like it is about to land on top of
   * it — and the person only finds out when they commit.
   *
   * The ants go on LAST, over the preview as well as over the layers: they
   * describe the region a stroke would land in, so a rubber band drawn on top
   * of them would be the one thing hiding the answer.
   */
  composite(preview?: (ctx: CanvasRenderingContext2D) => void): void {
    const ctx = this.#view?.getContext("2d");
    if (!ctx) return;
    const float = this.#float;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    for (const layer of this.#state.layers) {
      if (!layer.visible) continue;
      /* A live filter preview STANDS IN for the layer's own pixels, in the
         layer's own place in the stack and under its own alpha and blend — so
         what the panel shows is what Apply will produce, including how it sits
         under everything above it. The buffer itself is untouched. */
      const preview = this.#filterView !== null && this.#filterLayer === layer.id ? this.#filterView : null;
      const buf = preview ?? this.#buffers.get(layer.id);
      if (!buf) continue;
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blend as GlobalCompositeOperation;
      ctx.drawImage(buf, 0, 0);
      if (float?.layerId === layer.id) this.#drawFloat(ctx, float);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    (preview ?? this.#preview)?.(ctx);
    if (float) this.#drawTransformChrome(ctx, float);
    this.#drawAnts(ctx);
    this.#drawStampSource(ctx);
  }

  /**
   * Everything painted on the view that is NOT the image.
   *
   * The one predicate {@link pickAt} and {@link exportPng} both ask before
   * hiding it. Spelled once because the two used to ask different, slightly
   * wrong versions of the question — and the clone marker is the case that made
   * the difference matter: `exportPng` tested only for the ants, so a PNG saved
   * with the stamp selected would have had a crosshair baked into it, which is
   * the kind of defect somebody discovers in the finished file.
   */
  #hasChrome(): boolean {
    return this.#ants !== null || this.#float !== null || this.#markerPoint() !== null;
  }

  /**
   * Where the clone stamp is reading from, or `null` when the question does not
   * apply — no source set, or another tool selected.
   *
   * Falls back to the fixed source between strokes and reports the LIVE point
   * during one, which is what makes the marker slide alongside the brush and
   * show, before the pixels arrive, exactly what is about to be copied.
   */
  #markerPoint(): Point | null {
    if (this.#state.toolId !== "stamp") return null;
    return this.#stampAt ?? this.#state.stampSource;
  }

  /**
   * The clone source: a crosshair inside a circle the size of the brush.
   *
   * Black under white like the ants and the transform box, and for the same
   * reason — it has to be readable over both a white and a black document. The
   * circle is the brush's own footprint, so it answers "how much will one dab
   * take?" without a second affordance; it is clamped at both ends because a 1px
   * brush would draw a marker nobody can find and a 120px one would draw a
   * marker that hides the artwork it is pointing at.
   */
  #drawStampSource(ctx: CanvasRenderingContext2D): void {
    const p = this.#markerPoint();
    if (!p || this.#chromeHidden) return;
    const r = Math.max(MARKER_MIN, Math.min(MARKER_MAX, this.#state.size / 2));

    const mark = new Path2D();
    mark.moveTo(p.x - r - MARKER_ARM, p.y);
    mark.lineTo(p.x + r + MARKER_ARM, p.y);
    mark.moveTo(p.x, p.y - r - MARKER_ARM);
    mark.lineTo(p.x, p.y + r + MARKER_ARM);
    mark.moveTo(p.x + r, p.y);
    mark.arc(p.x, p.y, r, 0, Math.PI * 2);

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#000000";
    ctx.stroke(mark);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke(mark);
    ctx.restore();
  }

  /**
   * The floating buffer, at its current offset, scale and rotation.
   *
   * The same matrix the commit uses, so what is on screen during the drag and
   * what lands on the layer at the end are the same drawing call with a
   * different destination — the only way to be sure the preview is honest.
   */
  #drawFloat(ctx: CanvasRenderingContext2D, float: FloatSession): void {
    const m = transformMatrix(float.t);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.drawImage(float.buffer, 0, 0);
    /* `restore` puts the transform back too — it is part of the drawing state,
       and a leaked matrix would move every later draw on the view. */
    ctx.restore();
  }

  /**
   * The transform box: outline, eight handles and the rotation grip.
   *
   * Painted in the composite pass rather than as DOM over the canvas, because
   * the canvas is displayed at whatever width the column gives it and an
   * overlay would need the same rect maths `at()` does — twice, in two files,
   * agreeing. In canvas pixels there is nothing to agree about.
   *
   * Black under white, as the ants are, so the chrome is readable over both a
   * white and a black document.
   */
  #drawTransformChrome(ctx: CanvasRenderingContext2D, float: FloatSession): void {
    if (this.#chromeHidden) return;
    const t = float.t;
    const corners = transformCorners(t);
    const grip = gripPoint(t);
    const top = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    const outline = new Path2D();
    outline.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) outline.lineTo(corners[i]!.x, corners[i]!.y);
    outline.closePath();
    outline.moveTo(top.x, top.y);
    outline.lineTo(grip.x, grip.y);

    ctx.lineWidth = 3;
    ctx.strokeStyle = "#000000";
    ctx.stroke(outline);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke(outline);

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#000000";
    ctx.fillStyle = "#ffffff";
    const half = HANDLE_SIZE / 2;
    for (const id of SCALE_HANDLES) {
      const p = handlePoint(t, id);
      ctx.beginPath();
      ctx.rect(p.x - half, p.y - half, HANDLE_SIZE, HANDLE_SIZE);
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(grip.x, grip.y, GRIP_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** Hold (or drop) the rubber band the next repaint should carry. */
  setPreview(preview: ((ctx: CanvasRenderingContext2D) => void) | null): void {
    this.#preview = preview;
  }

  /**
   * Marching ants: the selection outline as two dashed strokes.
   *
   * Dark first, then light offset by half the dash, which is the trick that
   * makes the boundary readable over both a white and a black document — one
   * of the two is always in contrast. Both walk backwards along the path as
   * the phase advances, so the ants march INTO the selection.
   *
   * Suppressed while a transform is floating: the mask is still sitting where
   * the pixels WERE, and ants drawn around an empty hole while the pixels are
   * halfway across the canvas is the one piece of chrome that would actively
   * mislead. The transform box says where the selection is going, and the
   * commit re-traces the ants around where it landed.
   */
  #drawAnts(ctx: CanvasRenderingContext2D): void {
    const path = this.#ants;
    if (!path || this.#chromeHidden || this.#float) return;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.lineWidth = 1;
    ctx.setLineDash([ANTS_DASH, ANTS_DASH]);
    ctx.strokeStyle = "#000000";
    ctx.lineDashOffset = -this.#antsPhase;
    ctx.stroke(path);
    ctx.strokeStyle = "#ffffff";
    ctx.lineDashOffset = -this.#antsPhase + ANTS_DASH;
    ctx.stroke(path);
    ctx.restore();
  }

  /**
   * Advance the dash phase while — and only while — a selection exists.
   *
   * An animation frame loop that runs when there is nothing to animate is a
   * defect, not an inefficiency: it keeps the tab's compositor awake and it
   * repaints a 1600×1000 canvas twelve times a second forever. Started by
   * {@link setSelection}, stopped by {@link clearSelection}, and it stops
   * itself if the mask disappears underneath it.
   */
  #startAnts(): void {
    if (this.#antsRaf !== null) return;
    if (typeof requestAnimationFrame === "undefined") return;
    this.#antsAt = 0;
    const tick = (t: number): void => {
      if (!this.#selection) {
        this.#antsRaf = null;
        return;
      }
      if (!this.#antsAt || t - this.#antsAt >= ANTS_MS) {
        this.#antsAt = t;
        this.#antsPhase = (this.#antsPhase + 1) % (ANTS_DASH * 2);
        this.composite();
      }
      this.#antsRaf = requestAnimationFrame(tick);
    };
    this.#antsRaf = requestAnimationFrame(tick);
  }

  #stopAnts(): void {
    if (this.#antsRaf !== null && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(this.#antsRaf);
    }
    this.#antsRaf = null;
  }

  /* ------------------------------------------------------------ selection */

  /**
   * The colour of the composited image at a point — the eyedropper.
   *
   * It repaints the view with the ants suppressed before reading, and repaints
   * again after. The eyedropper has always sampled the VIEW rather than a
   * layer, which is right — it picks what a person can SEE, blend modes and
   * layer opacity included — and the ants are the one thing on the view that a
   * person can see and that is not the image. Clicking a boundary would
   * otherwise pick `#000000` or `#ffffff` depending on which dash was under the
   * pointer that frame, which is a bug that only shows up intermittently and
   * only on the exact pixels somebody is most likely to sample.
   *
   * Two composites per click; the tool fires once per click.
   */
  pickAt(p: Point): string | null {
    const ctx = this.#view?.getContext("2d");
    if (!ctx) return null;
    if (this.#hasChrome()) {
      this.#chromeHidden = true;
      this.composite();
    }
    const d = ctx.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data;
    if (this.#chromeHidden) {
      this.#chromeHidden = false;
      this.composite();
    }
    if (!d[3]) return null;
    return `#${[d[0]!, d[1]!, d[2]!].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  }

  /** The mask, for the code that clips through it. `null` = the whole canvas. */
  get selection(): HTMLCanvasElement | null {
    return this.#selection;
  }

  /** The selection's tight box, or `null`. Derived, so not in state. */
  selectionBounds(): SelectionBounds | null {
    return this.#bounds;
  }

  /**
   * Adopt a mask as THE selection.
   *
   * The coverage is read once here — one `getImageData` per gesture — and the
   * bounds and the ants' path are both derived from that single read rather
   * than from three separate walks over the mask. A mask that turns out to
   * select nothing (an empty marquee click, a subtract that removed the lot)
   * is not a selection and is dropped, which is what stops the ants animating
   * an invisible outline.
   */
  setSelection(mask: HTMLCanvasElement | null, note?: string): void {
    if (!mask) {
      this.clearSelection();
      return;
    }
    const coverage = maskCoverage(mask);
    const bounds = maskBoundsFrom(coverage);
    if (!bounds) {
      this.clearSelection();
      return;
    }
    this.#selection = mask;
    this.#coverage = coverage;
    this.#bounds = bounds;
    this.#ants = maskOutlinePath(coverage);
    this.#set({
      hasSelection: true,
      message: note ?? `Selected ${bounds.w}×${bounds.h}`
    });
    this.#startAnts();
    this.composite();
  }

  /** Fold a new mask into the current one — Shift adds, Alt subtracts. */
  addToSelection(mask: HTMLCanvasElement | null, mode: MaskCombine): void {
    if (!mask) return;
    /* Reselecting while pixels are in the air would leave the float carrying a
       mask nobody can see any more; put them down first. */
    this.#settle();
    this.setSelection(combineMask(this.#selection, mask, mode));
  }

  clearSelection(): void {
    this.#settle();
    this.#stopAnts();
    this.#selection = null;
    this.#coverage = null;
    this.#bounds = null;
    this.#ants = null;
    this.#antsPhase = 0;
    if (this.#state.hasSelection) this.#set({ hasSelection: false, message: "Deselected" });
    this.composite();
  }

  /** Everything. Photoshop's Ctrl+A. */
  selectAll(): void {
    this.#settle();
    this.setSelection(rectMask({ x: 0, y: 0, w: CANVAS_W, h: CANVAS_H }), "Selected the whole canvas");
  }

  /**
   * Everything that was not selected.
   *
   * With no selection this is a no-op rather than "select all": inverting
   * nothing is a question with no good answer, and silently selecting the whole
   * canvas is the answer that surprises somebody mid-edit.
   */
  invertSelection(): void {
    this.#settle();
    if (!this.#selection) {
      this.say("There is nothing selected to invert");
      return;
    }
    this.setSelection(invertMask(this.#selection), "Inverted the selection");
  }

  /**
   * Clear the selected pixels on the active layer — the Delete key.
   *
   * `destination-out` with the mask as the source removes exactly the mask's
   * coverage, soft edges included; no scratch and no clip needed, because the
   * mask IS the shape being erased.
   */
  deleteSelection(): void {
    this.#settle();
    const mask = this.#selection;
    const id = this.#state.activeLayer;
    if (!mask || !id) return;
    const ctx = this.context(id);
    if (!ctx) return;
    this.pushUndo(id);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(mask, 0, 0);
    ctx.restore();
    this.composite();
    this.countStroke();
    this.say("Cleared the selection");
  }

  /**
   * Draw onto a layer, clipped to the selection when there is one.
   *
   * The single door every painting tool goes through, so "does this respect the
   * selection?" has one answer rather than one per tool. `erase` flips the
   * composite the clipped result is laid down with — see `clipThrough`'s
   * docblock for why the eraser cannot simply draw `destination-out` into the
   * scratch (an empty scratch has nothing to erase).
   */
  clipDraw(
    ctx: CanvasRenderingContext2D,
    draw: (target: CanvasRenderingContext2D) => void,
    opts?: { erase?: boolean }
  ): void {
    clipThrough(ctx, this.#selection, draw, {
      composite: opts?.erase ? "destination-out" : "source-over",
      bounds: this.#bounds
    });
  }

  /* --------------------------------------------- move and free transform */

  /**
   * Put any floating pixels down before doing something else.
   *
   * The single guard behind every "what if there is a transform in flight?"
   * question — undo, deleting the active layer, merging, flattening, switching
   * tool or layer, exporting, a plugin placing an SVG. Committing is the right
   * answer to all of them rather than refusing or discarding: the person can
   * see the pixels, so they exist, and the undo entry pushed at LIFT time means
   * one Ctrl+Z still takes the whole session back.
   *
   * Called from the top of each of those, because a rule enforced by one helper
   * everyone must remember to call is a habit — but the alternative here (a
   * proxy over the store) is worse, so the calls are listed in this docblock
   * and `commitTransform` is a no-op when nothing is floating.
   */
  #settle(): void {
    if (this.#float) this.commitTransform();
  }

  /**
   * Lift pixels out of the active layer into a floating buffer.
   *
   * With a selection, the selected pixels; without one, everything on the layer
   * that is not transparent. The pixels are REMOVED from the layer as they are
   * lifted — that is what makes a move a move rather than a copy, and it is why
   * the undo entry goes on the stack first: everything from here to the commit
   * is one reversible act.
   */
  #lift(): boolean {
    const id = this.#state.activeLayer;
    const layer = this.#state.layers.find((l) => l.id === id);
    if (!layer) return false;
    if (!layer.visible) {
      this.say("The active layer is hidden");
      return false;
    }
    const src = this.buffer(id);
    const sctx = this.context(id);
    if (!src || !sctx || typeof document === "undefined") return false;

    const mask = this.#selection;
    const box = mask
      ? this.#bounds
      : opaqueBounds(sctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data, CANVAS_W, CANVAS_H);
    if (!box || box.w <= 0 || box.h <= 0) {
      this.say(mask ? "The selection is empty" : "There is nothing on this layer to move");
      return false;
    }

    const buffer = document.createElement("canvas");
    buffer.width = box.w;
    buffer.height = box.h;
    const bctx = buffer.getContext("2d");
    if (!bctx) return false;
    bctx.drawImage(src, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);

    /* Cropped to the SAME box as the pixels, so one transform carries both and
       the mask cannot drift out of register with what it is masking. */
    let cropped: HTMLCanvasElement | null = null;
    if (mask) {
      cropped = document.createElement("canvas");
      cropped.width = box.w;
      cropped.height = box.h;
      const mctx = cropped.getContext("2d");
      if (!mctx) return false;
      mctx.drawImage(mask, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
      /* The box is the mask's BOUNDS, not its shape — a lasso's corners are in
         the box and out of the selection, and they belong to the layer. */
      bctx.save();
      bctx.globalCompositeOperation = "destination-in";
      bctx.drawImage(cropped, 0, 0);
      bctx.restore();
    }

    /* Captured before `pushUndo` drops it — see `FloatSession.redo`. */
    const redo = [...this.#redo];
    this.pushUndo(id);

    sctx.save();
    sctx.globalAlpha = 1;
    if (mask) {
      sctx.globalCompositeOperation = "destination-out";
      sctx.drawImage(mask, 0, 0);
    } else {
      sctx.clearRect(box.x, box.y, box.w, box.h);
    }
    sctx.restore();

    this.#float = {
      layerId: id,
      buffer,
      mask: cropped,
      fromSelection: mask !== null,
      redo,
      t: identityTransform(box)
    };
    /* The ants stop marching for the length of the session — see `#drawAnts`.
       Stopping the ticker too keeps a 1600×1000 repaint off the clock while
       the only thing that can change the view is the pointer. */
    this.#stopAnts();
    this.#set({
      floating: true,
      message: mask ? "Lifted the selection — Enter commits, Esc cancels" : "Lifted the layer — Enter commits, Esc cancels"
    });
    this.composite();
    return true;
  }

  /**
   * Begin a pointer drag: lift on the first one, then grab whatever is under it.
   *
   * A fresh lift is always a BODY drag whatever the pointer is over, because the
   * handles did not exist when the person pressed the button — grabbing a
   * corner that appeared underneath the click would scale the pixels on a
   * gesture that was aimed at moving them.
   */
  startTransformDrag(p: Point): boolean {
    if (!this.#float) {
      if (!this.#lift()) return false;
      const t = this.#float!.t;
      this.#drag = { mode: "body", from: p, dx: t.dx, dy: t.dy };
      return true;
    }
    const t = this.#float.t;
    this.#drag = { mode: hitTestHandle(t, p) ?? "body", from: p, dx: t.dx, dy: t.dy };
    return true;
  }

  /** One frame of a drag. `aspect` is Shift: constrain the ratio, snap the angle. */
  dragTransform(p: Point, opts?: { aspect?: boolean }): void {
    const float = this.#float;
    const drag = this.#drag;
    if (!float || !drag) return;
    const shift = opts?.aspect === true;
    if (drag.mode === "body") {
      float.t = movedTo(float.t, drag.dx + (p.x - drag.from.x), drag.dy + (p.y - drag.from.y));
    } else if (drag.mode === "rotate") {
      float.t = rotateToward(float.t, p, shift);
    } else {
      float.t = scaleFromHandle(float.t, drag.mode, p, shift);
    }
    this.composite();
  }

  endTransformDrag(): void {
    this.#drag = null;
  }

  /** What the pointer is over, for the cursor. `null` when it is over nothing. */
  transformHandleAt(p: Point): HandleId | null {
    return this.#float ? hitTestHandle(this.#float.t, p) : null;
  }

  /** The arrow keys: 1px, or 10 with Shift. */
  nudgeTransform(ddx: number, ddy: number): void {
    const float = this.#float;
    if (!float) return;
    float.t = nudged(float.t, ddx, ddy);
    this.composite();
  }

  /**
   * Put the floating pixels down — Enter, a tool change, or anything in
   * {@link #settle}'s list.
   *
   * The session is dropped BEFORE the draw, so the `composite()` at the end
   * paints the layer's real pixels rather than the layer plus a float that is
   * now also on the layer. No undo entry is pushed: the one from the lift is
   * still on top of the stack and covers the whole session, which is what makes
   * a move, a scale and a rotation reverse as the single act they felt like.
   */
  commitTransform(): void {
    const float = this.#float;
    if (!float) return;
    this.#float = null;
    this.#drag = null;
    /* A commit writes pixels without pushing history (the lift's entry covers
       the session), so it misses `#push`'s drop and has to say so itself. */
    this.#dropFilter();

    const ctx = this.context(float.layerId);
    const t = float.t;
    /* A float can be lifted from a region with nothing in it (a selection over
       empty pixels), and a scale drag can take it to a hair's width. Both
       commit to nothing at all, which is correct — and `drawImage` through a
       degenerate matrix is what would throw. */
    const drawable = ctx !== null && t.w > 0 && t.h > 0;
    if (ctx && drawable) {
      const m = transformMatrix(t);
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
      ctx.drawImage(float.buffer, 0, 0);
      ctx.restore();
    }

    const box = transformedBounds(t);
    this.#set({
      floating: false,
      message: `Committed at ${Math.round(box.x)},${Math.round(box.y)} · ${Math.round(box.w)}×${Math.round(box.h)}`
    });

    /* The selection follows the pixels. `setSelection` re-reads the coverage and
       re-traces the ants once, here, rather than per frame of the drag. */
    if (float.fromSelection && float.mask && drawable) {
      this.setSelection(this.#transformedMask(float), "The selection moved with the pixels");
    }
    this.composite();
    this.countStroke();
  }

  /** The session's cropped mask, drawn back onto a full-canvas mask transformed. */
  #transformedMask(float: FloatSession): HTMLCanvasElement | null {
    if (!float.mask || typeof document === "undefined") return null;
    const next = document.createElement("canvas");
    next.width = CANVAS_W;
    next.height = CANVAS_H;
    const ctx = next.getContext("2d");
    if (!ctx) return null;
    const m = transformMatrix(float.t);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.drawImage(float.mask, 0, 0);
    return next;
  }

  /**
   * Throw the session away — Esc.
   *
   * The pixels come back from the undo entry the lift pushed, and that entry is
   * then POPPED: a cancelled transform must leave the history exactly as it
   * found it, or Ctrl+Z after an Esc undoes a stroke the person made before
   * they ever picked up the move tool.
   *
   * The entry is put back if it turns out not to be ours. Nothing else can push
   * during a session (everything that could goes through {@link #settle} first),
   * but losing somebody's history to a case that "cannot happen" is not a trade
   * worth making for two lines.
   */
  cancelTransform(): void {
    const float = this.#float;
    if (!float) return;
    this.#float = null;
    this.#drag = null;

    const entry = this.#undo.pop();
    if (entry) {
      if (entry.kind === "pixels" && entry.layerId === float.layerId) {
        this.context(entry.layerId)?.putImageData(entry.data, 0, 0);
        this.#redo = [...float.redo];
      } else {
        this.#undo.push(entry);
      }
    }

    this.#set({
      floating: false,
      undoCount: this.#undo.length,
      redoCount: this.#redo.length,
      message: "Transform cancelled"
    });
    if (this.#selection) this.#startAnts();
    this.composite();
  }

  /* --------------------------------------------------------------- text */

  /**
   * Open a text box at a point — the text tool's click.
   *
   * Anything already in the air goes down first: a floating transform through
   * {@link #settle}, and a previous box through {@link settleText}, which is
   * Photoshop's behaviour on the second click (the first block is set, not
   * abandoned). A hidden layer refuses HERE as well as at commit, because
   * finding out that the words had nowhere to land only after typing them is
   * the version of this that costs somebody a paragraph.
   */
  openText(at: Point): void {
    this.#settle();
    this.settleText();
    const layer = this.#state.layers.find((l) => l.id === this.#state.activeLayer);
    if (!layer) {
      this.say("No active layer");
      return;
    }
    if (!layer.visible) {
      this.say("The active layer is hidden");
      return;
    }
    this.#set({
      textEditing: true,
      textDraft: { at, value: "", id: ++textSeq },
      /* The colour follows the brush, which is what "the current colour" means
         on a rail where one swatch drives everything else. Only on OPEN: a
         person who has set a text colour and then reaches for the eyedropper
         mid-sentence has not asked for their heading to change. */
      textStyle: { ...this.#state.textStyle, color: this.#state.color },
      message: "Type — Ctrl+Enter commits, Esc cancels"
    });
  }

  /** One keystroke's worth. The overlay is the only caller. */
  setTextValue(value: string): void {
    const draft = this.#state.textDraft;
    if (!draft) return;
    this.#set({ textDraft: { ...draft, value } });
  }

  /** The box was dragged by its border. `at` is its new top-left, canvas space. */
  moveText(at: Point): void {
    const draft = this.#state.textDraft;
    if (!draft) return;
    this.#set({ textDraft: { ...draft, at } });
  }

  /** One or more knobs on the options strip. Applies live to an open box. */
  setTextStyle(patch: Partial<TextStyle>): void {
    this.#set({ textStyle: { ...this.#state.textStyle, ...patch } });
  }

  /** Drop the session, whatever is in it. Esc, and the Cancel button. */
  closeText(message: string | null): void {
    if (!this.#state.textEditing) return;
    this.#set({ textEditing: false, textDraft: null, ...(message ? { message } : null) });
  }

  cancelText(): void {
    this.closeText("Text cancelled");
  }

  /**
   * Rasterize the box onto the active layer — the commit.
   *
   * Through {@link clipDraw}, so text is clipped by a selection exactly as a
   * brush stroke is, for free and with the same antialiased edge. One
   * `pushUndo` covers the whole block however many lines it has, which is what
   * makes Ctrl+Z take back "the text" rather than the last line of it.
   *
   * Returns whether the pixels actually landed. A refusal leaves the box OPEN
   * with its content intact — the two ways to fail (nothing typed, the layer
   * hidden) are both recoverable, and closing the overlay would throw away the
   * only copy of what was typed.
   */
  commitText(): boolean {
    const draft = this.#state.textDraft;
    if (!draft) return false;
    if (!draft.value.trim()) {
      this.closeText("Nothing was typed");
      return false;
    }
    const id = this.#state.activeLayer;
    const layer = this.#state.layers.find((l) => l.id === id);
    if (!layer) {
      this.say("No active layer");
      return false;
    }
    if (!layer.visible) {
      this.say("The active layer is hidden — the text is still here");
      return false;
    }
    const ctx = this.context(id);
    if (!ctx) return false;

    const style = this.#state.textStyle;
    const lines = textLines(draft.value);
    /* Measured once and handed down, so the alignment the commit uses is the
       same number the overlay was drawn at rather than a second measurement
       that agrees with it most of the time. */
    const width = blockWidth(lines, style);

    this.pushUndo(id);
    this.clipDraw(ctx, (t) => drawText(t, lines, draft.at, style, width));
    this.#set({
      textEditing: false,
      textDraft: null,
      message: `Set ${lines.length} line${lines.length === 1 ? "" : "s"} of text`
    });
    this.composite();
    this.countStroke();
    return true;
  }

  /**
   * Put down whatever the text tool is holding — Photoshop's own rule.
   *
   * Switching tools with an EMPTY box throws it away; switching with content
   * in it commits. Public rather than private because the screen calls it on
   * unmount and a context-menu command will want it too; a no-op when no box
   * is open, so a caller never has to ask first.
   *
   * The last branch is the one worth reading: a commit can be refused (the
   * layer went hidden while the box was open), and a settle that left the
   * overlay up after the tool had already changed would be a text box floating
   * over a brush. It is dropped, and the message says so rather than the
   * pixels quietly not appearing.
   */
  settleText(): void {
    const draft = this.#state.textDraft;
    if (!draft) return;
    if (!draft.value.trim()) {
      this.closeText(null);
      return;
    }
    if (!this.commitText()) this.closeText("The text was dropped — its layer is hidden");
  }

  /* ------------------------------------------------------------- layers */

  /** One layer on first run. Idempotent, so a remount does not stack layers. */
  ensureFirstLayer(): void {
    if (this.#state.layers.length) return;
    const id = nextLayerId();
    this.buffer(id);
    this.#set({
      layers: [{ id, name: "Layer 1", visible: true, opacity: 1, blend: BLEND_NORMAL }],
      activeLayer: id
    });
  }

  addLayer(): string {
    const id = nextLayerId();
    this.pushStructure();
    this.buffer(id);
    const layers = [
      ...this.#state.layers,
      { id, name: `Layer ${this.#state.layers.length + 1}`, visible: true, opacity: 1, blend: BLEND_NORMAL }
    ];
    this.#set({ layers, activeLayer: id, message: "Layer added" });
    this.composite();
    return id;
  }

  removeLayer(id: string): void {
    /* Committing first is what stops a float outliving the layer it came from:
       the session holds a layer id, and `commitTransform` would otherwise
       conjure a fresh buffer for a layer nobody can see. Commit-then-delete is
       also the reversible order — the structure entry the delete pushes is
       taken AFTER the pixels have landed. */
    this.#settle();
    if (this.#state.layers.length <= 1) {
      this.say("The last layer cannot be removed");
      return;
    }
    /* Before the delete, and with the buffer still in the map — the snapshot's
       reference to it IS how the pixels come back. */
    this.pushStructure();
    this.#buffers.delete(id);
    const layers = this.#state.layers.filter((l) => l.id !== id);
    const activeLayer =
      id === this.#state.activeLayer ? (layers[layers.length - 1]?.id ?? "") : this.#state.activeLayer;
    this.#set({ layers, activeLayer, message: "Layer removed" });
    this.composite();
  }

  patchLayer(id: string, patch: Partial<Layer>): void {
    this.#set({ layers: this.#state.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
    this.composite();
  }

  moveLayer(id: string, dir: -1 | 1): void {
    const ls = [...this.#state.layers];
    const i = ls.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ls.length) return;
    this.pushStructure();
    [ls[i], ls[j]] = [ls[j], ls[i]];
    this.#set({ layers: ls });
    this.composite();
  }

  /* ------------------------------------------------- Photoshop-grade ops */

  /**
   * Copy a layer, pixels and all, directly above itself — Photoshop's
   * "Duplicate Layer". The copy carries the source's visibility, opacity and
   * blend, because a duplicate that composites differently from the thing it
   * duplicated is not a duplicate.
   */
  duplicateLayer(id: string): void {
    this.#settle();
    const src = this.#state.layers.find((l) => l.id === id);
    const srcBuf = this.buffer(id);
    if (!src || !srcBuf) return;

    /* Captured BEFORE the new buffer exists — `pushStructure` copies the map,
       so the layer that undo is meant to remove cannot be in the snapshot. */
    this.pushStructure();

    const copyId = nextLayerId();
    const ctx = this.buffer(copyId)?.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(srcBuf, 0, 0);

    const layers = [...this.#state.layers];
    layers.splice(layers.findIndex((l) => l.id === id) + 1, 0, {
      ...src,
      id: copyId,
      name: `${src.name} copy`
    });
    this.#set({ layers, activeLayer: copyId, message: `Duplicated ${src.name}` });
    this.composite();
  }

  /**
   * Draw a layer onto the one below it and remove it — "Merge Down".
   *
   * The merge is done with the UPPER layer's blend and opacity, so what the
   * merged pixels look like is what the composite looked like. This is the one
   * op that overwrites a surviving buffer, which is why it is also the one that
   * asks `pushStructure` to CLONE (the destination) rather than reference.
   */
  mergeDown(id: string): void {
    this.#settle();
    const i = this.#state.layers.findIndex((l) => l.id === id);
    if (i < 0) return;
    if (i === 0) {
      this.say("There is no layer below this one");
      return;
    }
    const upper = this.#state.layers[i]!;
    const lower = this.#state.layers[i - 1]!;
    const src = this.buffer(id);
    const dst = this.context(lower.id);
    if (!src || !dst) return;

    this.pushStructure([lower.id]);

    dst.save();
    dst.globalAlpha = upper.opacity;
    dst.globalCompositeOperation = upper.blend as GlobalCompositeOperation;
    dst.drawImage(src, 0, 0);
    dst.restore();

    this.#buffers.delete(id);
    const layers = this.#state.layers.filter((l) => l.id !== id);
    const activeLayer = this.#state.activeLayer === id ? lower.id : this.#state.activeLayer;
    this.#set({ layers, activeLayer, message: `Merged ${upper.name} into ${lower.name}` });
    this.composite();
  }

  /**
   * Composite every VISIBLE layer into the bottom one and drop the rest —
   * "Flatten Image".
   *
   * It renders through a scratch canvas rather than straight onto the base:
   * the base is itself part of the stack, with its own opacity and blend, so
   * drawing the stack on top of it would count it twice. Hidden layers are
   * discarded, exactly as Photoshop does it.
   */
  flatten(): void {
    this.#settle();
    const layers = this.#state.layers;
    if (layers.length <= 1) {
      this.say("There is only one layer to flatten");
      return;
    }
    const base = layers[0]!;
    const dst = this.context(base.id);
    if (!dst || typeof document === "undefined") return;

    this.pushStructure([base.id]);

    const scratch = document.createElement("canvas");
    scratch.width = CANVAS_W;
    scratch.height = CANVAS_H;
    const s = scratch.getContext("2d");
    if (!s) return;
    for (const layer of layers) {
      if (!layer.visible) continue;
      const buf = this.#buffers.get(layer.id);
      if (!buf) continue;
      s.globalAlpha = layer.opacity;
      s.globalCompositeOperation = layer.blend as GlobalCompositeOperation;
      s.drawImage(buf, 0, 0);
    }

    dst.save();
    dst.globalAlpha = 1;
    dst.globalCompositeOperation = "copy";
    dst.drawImage(scratch, 0, 0);
    dst.restore();

    for (const layer of layers) if (layer.id !== base.id) this.#buffers.delete(layer.id);
    this.#set({
      layers: [{ ...base, visible: true, opacity: 1, blend: BLEND_NORMAL }],
      activeLayer: base.id,
      message: `Flattened ${layers.length} layers`
    });
    this.composite();
  }

  renameLayer(id: string, name: string): void {
    const layer = this.#state.layers.find((l) => l.id === id);
    const next = name.trim();
    if (!layer || !next || next === layer.name) return;
    this.pushStructure();
    this.#set({
      layers: this.#state.layers.map((l) => (l.id === id ? { ...l, name: next } : l)),
      message: `Renamed to ${next}`
    });
  }

  setLayerBlend(id: string, blend: string): void {
    const layer = this.#state.layers.find((l) => l.id === id);
    if (!layer || layer.blend === blend) return;
    this.pushStructure();
    this.#set({
      layers: this.#state.layers.map((l) => (l.id === id ? { ...l, blend } : l)),
      message: `${layer.name} · ${blendLabel(blend)}`
    });
    this.composite();
  }

  /**
   * Per-layer opacity, live under a dragging slider.
   *
   * The `opacity` field has always been on the model and `composite()` has
   * always honoured it; what was missing was a setter that is undoable without
   * being undoable eighty times per drag. One snapshot is taken when a drag
   * starts on a layer, and {@link commitLayerOpacity} closes the window.
   */
  setLayerOpacity(id: string, opacity: number): void {
    const layer = this.#state.layers.find((l) => l.id === id);
    if (!layer) return;
    if (this.#opacityDrag !== id) {
      this.pushStructure();
      this.#opacityDrag = id;
    }
    this.#set({ layers: this.#state.layers.map((l) => (l.id === id ? { ...l, opacity } : l)) });
    this.composite();
  }

  /** The opacity drag ended — the next movement starts a new history entry. */
  commitLayerOpacity(): void {
    this.#opacityDrag = null;
  }

  /** Wipe a layer's pixels. Undoable, like every other destructive op. */
  clearLayer(id: string): void {
    this.#settle();
    const ctx = this.context(id);
    if (!ctx) return;
    this.pushUndo(id);
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    this.composite();
    this.say("Layer cleared");
  }

  setActiveLayer(id: string): void {
    /* Pixels in the air belong to the layer they were lifted from. Changing the
       active layer mid-session would leave the float looking like it belongs to
       the newly selected one, and it would land somewhere else.

       An open text box has the same problem for the same reason: it was opened
       against the layer the person was looking at, and a block typed over one
       layer's artwork should not land on another's because they clicked the
       panel on the way to the Commit button. */
    if (id !== this.#state.activeLayer) {
      this.#settle();
      this.settleText();
      /* And a filter preview belongs to the layer it was taken from: left
         standing, it would keep showing filtered pixels on a layer nobody is
         adjusting any more, and Apply would write them to the wrong one. */
      if (this.#dropFilter()) this.composite();
    }
    this.#set({ activeLayer: id });
  }

  /* ------------------------------------------------------------ history */

  /** Cap the stack, drop the redo branch, republish the counters. */
  #push(entry: Snapshot): void {
    /* Any history event ends an opacity drag's coalescing window — otherwise a
       stroke taken mid-drag would be folded into the drag's single entry. */
    this.#opacityDrag = null;
    /* And it ends any filter session, for a harder reason: the session's source
       is a snapshot of pixels that are about to change, so a preview that
       survived a brush stroke would be showing — and then applying — the layer
       as it was before the stroke. This is the chokepoint every destructive op
       already passes through, which is why the drop lives here rather than in a
       list of methods somebody has to remember to extend. */
    if (this.#dropFilter()) this.composite();
    this.#undo.push(entry);
    if (this.#undo.length > this.#undoDepth) this.#undo.shift();
    this.#redo = [];
    this.#set({ undoCount: this.#undo.length, redoCount: 0 });
  }

  /**
   * Snapshot ONE layer's pixels before they are written.
   *
   * Signature and meaning unchanged from before the union — every existing
   * caller (brush, fill, shapes, clear, `placeSvg`, contributed tools) still
   * says exactly this and gets exactly this.
   */
  pushUndo(layerId: string): void {
    const ctx = this.context(layerId);
    if (!ctx) return;
    this.#push({ kind: "pixels", layerId, data: ctx.getImageData(0, 0, CANVAS_W, CANVAS_H) });
  }

  /**
   * Snapshot the layer STACK before it is rearranged.
   *
   * `clone` names the buffers the caller is about to write INTO — merge down's
   * destination, flatten's base. Everything else is captured by reference,
   * which is both correct (a removed layer's buffer is never written again) and
   * the reason a rename costs bytes rather than megabytes.
   */
  pushStructure(clone: readonly string[] = []): void {
    this.#push(this.#captureStructure(clone));
  }

  #captureStructure(clone: readonly string[] = []): StructureSnapshot {
    const buffers = new Map(this.#buffers);
    for (const id of clone) {
      const buf = this.#buffers.get(id);
      if (!buf || typeof document === "undefined") continue;
      const copy = document.createElement("canvas");
      copy.width = CANVAS_W;
      copy.height = CANVAS_H;
      copy.getContext("2d")?.drawImage(buf, 0, 0);
      buffers.set(id, copy);
    }
    return { kind: "structure", layers: [...this.#state.layers], buffers };
  }

  /**
   * Put a captured stack back, and hand back the stack it replaced.
   *
   * The buffer map is REPLACED rather than mutated in place, which is what
   * makes the returned entry (the redo side) safe to hold by reference: the
   * canvases the two entries share are never written by this method.
   */
  #restoreStructure(entry: StructureSnapshot): StructureSnapshot {
    const current = this.#captureStructure();
    this.#buffers = new Map(entry.buffers);
    const layers = [...entry.layers];
    const activeLayer = layers.some((l) => l.id === this.#state.activeLayer)
      ? this.#state.activeLayer
      : (layers[layers.length - 1]?.id ?? "");
    this.#set({ layers, activeLayer });
    return current;
  }

  #step(from: Snapshot[], to: Snapshot[]): boolean {
    /* Undo and redo write pixels without going through `#push`, so the filter
       session is dropped here too. Its own `composite()` at the end publishes
       the result — no second repaint needed. */
    this.#dropFilter();
    while (from.length) {
      const entry = from.pop() as Snapshot;
      if (entry.kind === "structure") {
        to.push(this.#restoreStructure(entry));
      } else {
        /* A pixel entry whose layer is gone cannot apply, and `context()`
           would happily conjure a buffer for a layer nobody can see. Skip it
           and take the next one rather than paint into a ghost. */
        if (!this.#state.layers.some((l) => l.id === entry.layerId)) continue;
        const ctx = this.context(entry.layerId);
        if (!ctx) continue;
        to.push({
          kind: "pixels",
          layerId: entry.layerId,
          data: ctx.getImageData(0, 0, CANVAS_W, CANVAS_H)
        });
        ctx.putImageData(entry.data, 0, 0);
      }
      this.#set({ undoCount: this.#undo.length, redoCount: this.#redo.length });
      this.composite();
      return true;
    }
    return false;
  }

  /**
   * Undo, committing any floating transform first.
   *
   * Commit-then-undo rather than cancel: the two are indistinguishable in the
   * pixels (the session's own entry is what comes back either way) and only one
   * of them is honest about the redo. Cancelling would drop the entry, so
   * Ctrl+Z during a move would undo the stroke BEFORE the move and leave the
   * move itself unrecorded — the pixels would jump twice for one keypress.
   */
  undo(): void {
    this.#settle();
    if (!this.#step(this.#undo, this.#redo)) this.say("Nothing to undo");
    else this.say("Undone");
  }

  redo(): void {
    this.#settle();
    if (!this.#step(this.#redo, this.#undo)) this.say("Nothing to redo");
    else this.say("Redone");
  }

  /* -------------------------------------------------------------- tools */

  /**
   * Choose a tool — and put down anything the last one left in the air.
   *
   * The commit lives HERE rather than in the rail's click handler because the
   * rail is not the only way a tool changes: context-menu rows, and P8's
   * keyboard map, will all arrive through this method. A guarantee that only
   * holds for the affordance somebody remembered to wire is not a guarantee.
   */
  setTool(toolId: string): void {
    if (toolId !== this.#state.toolId) {
      this.#settle();
      this.settleText();
    }
    this.#set({ toolId });
  }

  setColor(color: string): void {
    this.#set({ color });
  }

  setBackgroundColor(backgroundColor: string): void {
    this.#set({ backgroundColor });
  }

  /**
   * Fold a colour into the recents list — the ACT of choosing one.
   *
   * See {@link AmberArtState.recentColors} for why this is separate from
   * {@link setColor}. Lower-cased before comparing, because a hex an eyedropper
   * builds and a hex a colour input reports differ in case for the same colour
   * and a case-sensitive dedupe would list it twice.
   */
  rememberColor(color: string): void {
    const hex = color.toLowerCase();
    const recentColors = [hex, ...this.#state.recentColors.filter((c) => c !== hex)].slice(0, RECENT_COLORS);
    this.#set({ recentColors });
  }

  /** Choose a foreground colour and remember it — the swatches and the picker. */
  pickColor(color: string): void {
    this.setColor(color);
    this.rememberColor(color);
  }

  /**
   * Swap the pair — `X`.
   *
   * Neither is remembered: a swap chooses nothing, it exchanges two colours that
   * were both already chosen, and pressing X twice would otherwise push the same
   * two entries to the front of the recents list and evict what was underneath.
   */
  swapColors(): void {
    this.#set({
      color: this.#state.backgroundColor,
      backgroundColor: this.#state.color,
      message: `Swapped · ${this.#state.backgroundColor} over ${this.#state.color}`
    });
  }

  /** Black over white — `D`. */
  resetColors(): void {
    this.#set({
      color: DEFAULT_FOREGROUND,
      backgroundColor: DEFAULT_BACKGROUND,
      message: "Default colours"
    });
  }

  setSize(size: number): void {
    this.#set({ size });
  }

  setAlpha(alpha: number): void {
    this.#set({ alpha });
  }

  setHardness(hardness: number): void {
    this.#set({ hardness: Math.max(0, Math.min(100, Math.round(hardness))) });
  }

  /* ---------------------------------------------------------------- zoom */

  /**
   * Set the magnification, clamped — and hand back what was actually applied.
   *
   * The RETURN is what makes zoom-around-the-pointer honest. The screen has to
   * adjust the wrapper's scroll by the ratio between the old and the new width,
   * and at either end of the range the requested zoom and the applied one differ
   * — so a caller that computed the ratio from what it ASKED for would scroll
   * the picture sideways on every wheel notch past 8×, which is exactly the kind
   * of drift nobody attributes to the clamp.
   *
   * A no-op change returns the current value without notifying: `setZoom` is
   * called from a wheel handler, and a store notification per notch at the top
   * of the range would re-render the whole screen to change nothing.
   */
  setZoom(zoom: number): number {
    const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom));
    if (!Number.isFinite(next) || next === this.#state.zoom) return this.#state.zoom;
    this.#set({ zoom: next });
    return next;
  }

  /** One press of `+` or `−`, or one wheel notch. Returns the applied value. */
  zoomBy(factor: number): number {
    return this.setZoom(this.#state.zoom * factor);
  }

  /** Back to fitting the column — the `Fit` chip. See {@link AmberArtState.zoom}. */
  fitZoom(): void {
    if (this.#state.zoom === 1) return;
    this.#set({ zoom: 1, message: "Fit to the column" });
  }

  /**
   * The colour a "foreground → background" ramp ends on.
   *
   * A method rather than a field so this phase could make it real — a background
   * swatch, a swap key, an X shortcut — without a single consumer changing. None
   * did: the gradient's two call sites and the rail's CSS preview all read it
   * through here, and the constant behind it became {@link AmberArtState.backgroundColor}
   * in one edit rather than in three places that had each decided white for
   * themselves.
   */
  getBackgroundColor(): string {
    return this.#state.backgroundColor;
  }

  setGradientOptions(patch: Partial<GradientOptions>): void {
    this.#set({ gradient: { ...this.#state.gradient, ...patch } });
  }

  setTextureOptions(patch: Partial<TextureOptions>): void {
    this.#set({ texture: { ...this.#state.texture, ...patch } });
  }

  countStroke(): void {
    this.#set({ strokes: this.#state.strokes + 1 });
  }

  /**
   * The brush/eraser/shape context settings, in one place.
   *
   * `erase` is passed rather than read off `toolId` because the eraser's
   * `destination-out` belongs to the LAYER write, not to the drawing: when a
   * selection redirects the draw into a scratch, the scratch must be painted
   * opaquely and `clipDraw` does the erasing on the way back out. Reading the
   * tool here would erase an empty scratch and change nothing on screen —
   * which is precisely how a clipped eraser looks broken.
   */
  applyStrokeStyle(ctx: CanvasRenderingContext2D, erase = this.#state.toolId === "eraser"): void {
    const { size, alpha, color } = this.#state;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = size;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalCompositeOperation = erase ? "destination-out" : "source-over";
  }

  /** Is the draw about to be redirected through a mask? */
  #clipped(): boolean {
    return this.#selection !== null;
  }

  /* ------------------------------------------------------- the dab train */

  /** How far apart this brush's dabs sit. At least a pixel, or nothing moves. */
  #spacing(): number {
    return Math.max(1, this.#state.size / DAB_SPACING);
  }

  /**
   * The brush tip, drawn once and reused — see {@link #tip}.
   *
   * At hardness 100 it is a flat disc, which is what makes the smudge (whose
   * tip mask this also is) hard-edged at the same setting the brush is. Below
   * that it is a radial ramp whose opaque core ends at the hardness fraction of
   * the radius and reaches zero alpha exactly at the rim — so 0 is a tip with no
   * core at all and 99 is a hairline of feather, and the slider is continuous
   * across its whole travel rather than doing nothing until it nears an end.
   *
   * The ramp runs between the SAME rgb at two alphas rather than to a neutral
   * transparent: interpolating to `rgba(0,0,0,0)` walks the hue towards black on
   * the way out and haloes every coloured dab with grey.
   */
  #brushTip(): HTMLCanvasElement | null {
    if (typeof document === "undefined") return null;
    const { size, hardness, color } = this.#state;
    const d = Math.max(1, Math.ceil(size));
    const key = `${d}:${hardness}:${color}`;
    const cached = this.#tip;
    if (cached && this.#tipKey === key) return cached;

    const c = (this.#tip ??= document.createElement("canvas"));
    if (c.width !== d) c.width = d;
    if (c.height !== d) c.height = d;
    const ctx = c.getContext("2d");
    if (!ctx) return null;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, d, d);

    const r = d / 2;
    const core = Math.max(0, Math.min(1, hardness / 100));
    if (core >= 1) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(r, r, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const [red, green, blue] = hexToRgba(color, 1);
      const ramp = ctx.createRadialGradient(r, r, r * core, r, r, r);
      ramp.addColorStop(0, `rgba(${red}, ${green}, ${blue}, 1)`);
      ramp.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
      ctx.fillStyle = ramp;
      ctx.fillRect(0, 0, d, d);
    }

    this.#tipKey = key;
    return c;
  }

  /**
   * Walk a segment at the brush's spacing, placing a dab at each step.
   *
   * The leftover distance is kept in {@link #dabPending} rather than reset per
   * segment — see that field for why. A zero-length move places nothing at all
   * and leaves the counter alone, so holding the pointer still does not stack
   * paint on one spot.
   */
  #walk(from: Point, to: Point, place: (x: number, y: number) => void): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const spacing = this.#spacing();
    const ux = dx / len;
    const uy = dy / len;
    let at = this.#dabPending;
    while (at <= len) {
      place(from.x + ux * at, from.y + uy * at);
      at += spacing;
    }
    this.#dabPending = at - len;
  }

  /** Begin a dab train — the next dab lands one full spacing along. */
  #beginTrain(): void {
    this.#dabPending = this.#spacing();
  }

  /** Lay the tip down centred on a point. */
  #stampTip(t: CanvasRenderingContext2D, tip: HTMLCanvasElement, x: number, y: number): void {
    const half = tip.width / 2;
    t.drawImage(tip, x - half, y - half);
  }

  /**
   * The round dab a brush or eraser lays down on pointer-down.
   *
   * Hardness 100 keeps the original `arc`/`fill` — the fast path stated in
   * {@link AmberArtState.hardness}, and the reason the tip canvas is never even
   * built for a hard brush.
   */
  paintDab(ctx: CanvasRenderingContext2D, p: Point): void {
    const erase = this.#state.toolId === "eraser";
    const size = this.#state.size;
    const direct = erase && !this.#clipped();
    const tip = this.#state.hardness < 100 ? this.#brushTip() : null;
    this.#beginTrain();
    this.clipDraw(
      ctx,
      (t) => {
        this.applyStrokeStyle(t, direct);
        if (tip) {
          this.#stampTip(t, tip, p.x, p.y);
          return;
        }
        t.beginPath();
        t.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
        t.fill();
      },
      { erase }
    );
  }

  /**
   * One segment of a freehand stroke.
   *
   * Two brushes in one method, chosen by hardness. The hard one is a single
   * `lineTo` with a round cap, which the rasteriser turns into a perfect capsule
   * for free; the soft one is the standard dab train, because a stroked line has
   * no way to express a feathered edge — `lineWidth` is uniform coverage by
   * definition, and every soft brush ever shipped is a tip stamped along a path.
   *
   * The tip is resolved OUTSIDE the draw closure on purpose: with a selection,
   * `clipDraw` may run the closure against a scratch, and building a canvas
   * inside another canvas' draw call is the kind of nesting that is fine today
   * and surprising later.
   */
  paintSegment(ctx: CanvasRenderingContext2D, from: Point, to: Point): void {
    const erase = this.#state.toolId === "eraser";
    const direct = erase && !this.#clipped();
    const tip = this.#state.hardness < 100 ? this.#brushTip() : null;
    this.clipDraw(
      ctx,
      (t) => {
        this.applyStrokeStyle(t, direct);
        if (tip) {
          this.#walk(from, to, (x, y) => this.#stampTip(t, tip, x, y));
          return;
        }
        t.beginPath();
        t.moveTo(from.x, from.y);
        t.lineTo(to.x, to.y);
        t.stroke();
      },
      { erase }
    );
  }

  /* -------------------------------------------------------- clone stamp */

  /** Alt-click: this is where the stamp reads from now. */
  setStampSource(p: Point): void {
    this.#stampAt = null;
    this.#set({
      stampSource: { x: Math.round(p.x), y: Math.round(p.y) },
      message: "Clone source set — paint to copy from it"
    });
    this.composite();
  }

  /**
   * Begin a clone stroke: snapshot the layer, freeze the offset.
   *
   * Returns `false` — having said why — when there is no source, which is the
   * refusal the pointer handler needs BEFORE it pushes an undo entry. A stroke
   * that pushes history and then paints nothing leaves a Ctrl+Z that appears to
   * do nothing, which reads as the undo stack being broken rather than the tool
   * being unarmed.
   */
  beginStampStroke(p: Point): boolean {
    const src = this.#state.stampSource;
    if (!src) {
      this.say("Alt-click sets the clone source");
      return false;
    }
    const buf = this.buffer(this.#state.activeLayer);
    if (!buf || typeof document === "undefined") return false;

    const snap = (this.#snapshot ??= document.createElement("canvas"));
    if (snap.width !== CANVAS_W) snap.width = CANVAS_W;
    if (snap.height !== CANVAS_H) snap.height = CANVAS_H;
    const sctx = snap.getContext("2d");
    if (!sctx) return false;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalAlpha = 1;
    /* `copy` rather than clear-then-draw: it replaces the whole surface in one
       operation, so a snapshot can never keep a corner of the previous stroke's
       layer in a region the new one does not cover. */
    sctx.globalCompositeOperation = "copy";
    sctx.drawImage(buf, 0, 0);

    this.#stampDelta = { x: src.x - p.x, y: src.y - p.y };
    this.#stampAt = { x: src.x, y: src.y };
    this.#beginTrain();
    return true;
  }

  /**
   * One clone dab: the snapshot, offset by the frozen delta, through a circle.
   *
   * The whole snapshot is handed to `drawImage` and the CLIP decides what lands
   * — which is both the shortest way to say it and the fastest, because the
   * rasteriser never touches a pixel outside the path.
   */
  #cloneDab(
    t: CanvasRenderingContext2D,
    x: number,
    y: number,
    snap: HTMLCanvasElement,
    delta: Point,
    r: number
  ): void {
    t.save();
    t.beginPath();
    t.arc(x, y, r, 0, Math.PI * 2);
    t.clip();
    /* Snapshot pixel (u,v) lands at (u - delta), so the pixel that lands at
       (x,y) is the one at (x + delta) — the source point, by construction. */
    t.drawImage(snap, -delta.x, -delta.y);
    t.restore();
  }

  /** The clone stamp's first dab, under the press. */
  stampDab(ctx: CanvasRenderingContext2D, p: Point): void {
    this.#stampRun(ctx, (t, snap, delta, r) => this.#cloneDab(t, p.x, p.y, snap, delta, r), p);
  }

  /** One segment of a clone drag, as a dab train. */
  stampSegment(ctx: CanvasRenderingContext2D, from: Point, to: Point): void {
    this.#stampRun(
      ctx,
      (t, snap, delta, r) => this.#walk(from, to, (x, y) => this.#cloneDab(t, x, y, snap, delta, r)),
      to
    );
  }

  /**
   * The shared body of both clone calls: one `clipDraw`, one set of context
   * globals, and the marker moved to wherever the run ended up reading.
   */
  #stampRun(
    ctx: CanvasRenderingContext2D,
    run: (t: CanvasRenderingContext2D, snap: HTMLCanvasElement, delta: Point, r: number) => void,
    at: Point
  ): void {
    const delta = this.#stampDelta;
    const snap = this.#snapshot;
    if (!delta || !snap) return;
    const r = Math.max(0.5, this.#state.size / 2);
    this.clipDraw(ctx, (t) => {
      t.globalAlpha = this.#state.alpha;
      t.globalCompositeOperation = "source-over";
      run(t, snap, delta, r);
    });
    this.#stampAt = { x: at.x + delta.x, y: at.y + delta.y };
  }

  /* ------------------------------------------------------------- smudge */

  /** Begin a smudge stroke — the first dab has nothing before it but itself. */
  beginSmudgeStroke(p: Point): void {
    this.#smudgeFrom = { x: p.x, y: p.y };
    this.#beginTrain();
  }

  /**
   * One segment of a smudge drag — the classic pull.
   *
   * Per dab: lift a brush-sized patch from the layer at the PREVIOUS dab, cut it
   * to the brush tip, and put it down at this one at {@link SMUDGE_PULL} of the
   * rail's opacity. Because each dab samples the layer as it is right now —
   * including what the dab before it just deposited — colour is carried forward
   * a fraction at a time and fades along the drag, which is what a finger
   * through wet paint does and what a fixed sample point could never do.
   *
   * The patch is cut with `destination-in` against the tip rather than with a
   * clip, which buys the hardness slider for free: a soft tip pulls with a soft
   * edge, a hard one leaves the round mark Photoshop's hard smudge leaves.
   */
  smudgeSegment(ctx: CanvasRenderingContext2D, from: Point, to: Point): void {
    const buf = this.buffer(this.#state.activeLayer);
    const tip = this.#brushTip();
    if (!buf || !tip) return;
    const d = tip.width;
    const patch = this.#patchCanvas(d);
    const pctx = patch?.getContext("2d");
    if (!patch || !pctx) return;

    const half = d / 2;
    const pull = SMUDGE_PULL * this.#state.alpha;

    this.clipDraw(ctx, (t) => {
      t.globalAlpha = pull;
      t.globalCompositeOperation = "source-over";
      this.#walk(from, to, (x, y) => {
        const prev = this.#smudgeFrom ?? { x, y };
        pctx.setTransform(1, 0, 0, 1, 0, 0);
        pctx.globalAlpha = 1;
        pctx.globalCompositeOperation = "copy";
        /* A source rectangle that hangs off the canvas is clipped by the
           platform rather than throwing, so a drag that leaves the document
           simply picks up less — no guard needed, and none that could be
           written would be more correct than the rasteriser's own. */
        pctx.drawImage(buf, prev.x - half, prev.y - half, d, d, 0, 0, d, d);
        pctx.globalCompositeOperation = "destination-in";
        pctx.drawImage(tip, 0, 0);
        t.drawImage(patch, x - half, y - half);
        this.#smudgeFrom = { x, y };
      });
    });
  }

  /** The smudge's scratch, sized to the brush and reused across every dab. */
  #patchCanvas(d: number): HTMLCanvasElement | null {
    if (typeof document === "undefined") return null;
    const c = (this.#patch ??= document.createElement("canvas"));
    if (c.width !== d) c.width = d;
    if (c.height !== d) c.height = d;
    return c;
  }

  /**
   * The pointer came up — drop whatever the stroke was carrying.
   *
   * The clone's delta goes with it, so a stroke that begins before this ran
   * cannot inherit an offset measured against a different origin. The marker
   * returns to the source it was Alt-clicked at, and the repaint that does so is
   * the caller's — every pointer-up path already ends in one.
   */
  endStroke(): void {
    this.#smudgeFrom = null;
    this.#stampDelta = null;
    this.#stampAt = null;
  }

  /** Commit a line/rect/ellipse drag onto the layer, clipped if need be. */
  paintShape(ctx: CanvasRenderingContext2D, a: Point, b: Point): void {
    const erase = this.#state.toolId === "eraser";
    const direct = erase && !this.#clipped();
    this.clipDraw(
      ctx,
      (t) => {
        this.applyStrokeStyle(t, direct);
        this.shape(t, a, b);
      },
      { erase }
    );
  }

  /**
   * Flood fill from a point, held inside the selection.
   *
   * The fill is the one tool that cannot be redirected to a scratch: it READS
   * the destination to decide what to fill, and a blank scratch has nothing to
   * match against. So it runs unclipped over the real layer and the pixels
   * outside the mask are put back — one buffer walk, once per click, which is
   * a different budget from once per pointer move.
   */
  fillAt(ctx: CanvasRenderingContext2D, p: Point): void {
    const { color, alpha } = this.#state;
    const mask = this.#coverage;
    if (!mask) {
      floodFill(ctx, p.x, p.y, color, alpha);
      return;
    }
    const before = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
    floodFill(ctx, p.x, p.y, color, alpha);
    const after = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
    after.data.set(maskedResult(before, after, mask));
    ctx.putImageData(after, 0, 0);
  }

  shape(ctx: CanvasRenderingContext2D, a: Point, b: Point): void {
    drawShape(ctx, this.#state.toolId, a, b);
  }

  /* ------------------------------------------------------------ gradient */

  /**
   * The ramp a drag from `a` to `b` describes.
   *
   * `createLinearGradient` / `createRadialGradient` do the geometry — there is
   * no hand maths here on purpose. A linear ramp runs along the vector and the
   * canvas extends the end colours past both ends, which is exactly Photoshop's
   * behaviour; a radial one starts at zero radius under the press and reaches
   * the release, so the drag's LENGTH is the spread either way.
   *
   * The transparent end is the foreground colour at zero alpha rather than a
   * neutral one: ramping to `rgba(0,0,0,0)` fades every colour through grey on
   * the way out, because the interpolation is premultiplied by nobody and the
   * hue travels. Same hue, falling alpha, is what a fade is meant to look like.
   */
  #gradientFor(ctx: CanvasRenderingContext2D, a: Point, b: Point): CanvasGradient | null {
    const { type, colors, reverse } = this.#state.gradient;
    const from = this.#state.color;
    const [r, g, bl] = hexToRgba(from, 1);
    const to = colors === "fg-bg" ? this.getBackgroundColor() : `rgba(${r}, ${g}, ${bl}, 0)`;

    const ramp =
      type === "linear"
        ? ctx.createLinearGradient(a.x, a.y, b.x, b.y)
        : ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)));
    if (!ramp) return null;
    ramp.addColorStop(0, reverse ? to : from);
    ramp.addColorStop(1, reverse ? from : to);
    return ramp;
  }

  /** Lay the ramp over the whole canvas — the selection is what narrows it. */
  #paintGradient(t: CanvasRenderingContext2D, a: Point, b: Point): void {
    const ramp = this.#gradientFor(t, a, b);
    if (!ramp) return;
    t.save();
    t.globalCompositeOperation = "source-over";
    t.globalAlpha = this.#state.alpha;
    t.fillStyle = ramp;
    t.fillRect(0, 0, CANVAS_W, CANVAS_H);
    t.restore();
  }

  /**
   * Show the ramp while the drag is still happening — nothing is committed.
   *
   * It goes through the same {@link clipThrough} the commit does, against the
   * same mask and bounds, so what is on screen mid-drag is the drawing call
   * that will land rather than a second approximation of it. The VIEW is the
   * destination, so an abandoned drag leaves no pixels behind: the next
   * `composite()` repaints from the layers.
   *
   * The vector itself is drawn over the ramp, black under white as the ants
   * are, because a radial gradient at low intensity is otherwise a drag with no
   * visible handle on it.
   */
  previewGradient(a: Point, b: Point): void {
    this.setPreview((view) => {
      clipThrough(view, this.#selection, (t) => this.#paintGradient(t, a, b), {
        bounds: this.#bounds
      });
      view.save();
      view.globalAlpha = 1;
      view.globalCompositeOperation = "source-over";
      view.lineCap = "round";
      view.beginPath();
      view.moveTo(a.x, a.y);
      view.lineTo(b.x, b.y);
      view.lineWidth = 3;
      view.strokeStyle = "#000000";
      view.stroke();
      view.lineWidth = 1;
      view.strokeStyle = "#ffffff";
      view.stroke();
      view.restore();
    });
    this.composite();
  }

  /**
   * Put the ramp down on the active layer — the release.
   *
   * `pushUndo` first and exactly once: nothing was written during the drag, so
   * one entry covers the whole gesture and one Ctrl+Z takes back "the
   * gradient" rather than the last frame of it.
   */
  commitGradient(a: Point, b: Point): void {
    this.#settle();
    const id = this.#state.activeLayer;
    const layer = this.#state.layers.find((l) => l.id === id);
    if (!layer) {
      this.say("No active layer");
      return;
    }
    if (!layer.visible) {
      this.say("The active layer is hidden");
      return;
    }
    const ctx = this.context(id);
    if (!ctx) return;

    this.pushUndo(id);
    this.clipDraw(ctx, (t) => this.#paintGradient(t, a, b));
    this.setPreview(null);
    this.composite();
    this.countStroke();
    const { type, colors } = this.#state.gradient;
    this.say(
      `Filled with a ${type} gradient${colors === "fg-transparent" ? " to transparent" : ""}${
        this.#selection ? ", inside the selection" : ""
      }`
    );
  }

  /* ------------------------------------------------------------- texture */

  /**
   * The chosen pattern as a repeating fill, tinted if the rail asks.
   *
   * The tile itself is memoised by `textures.ts`; the tint is not, because it
   * is one composite per click against a colour that changes whenever somebody
   * touches the swatch.
   */
  #texturePattern(t: CanvasRenderingContext2D): CanvasPattern | null {
    const { kind, tint } = this.#state.texture;
    const base = textureTile(kind);
    if (!base) return null;
    const tile = tint ? (tintTile(base, this.#state.color) ?? base) : base;
    return t.createPattern(tile, "repeat");
  }

  /**
   * Paint the pattern over the whole canvas at the chosen scale.
   *
   * The scale is applied with `ctx.scale` around the fill rather than to the
   * pattern's own matrix: `CanvasPattern.setTransform` wants a `DOMMatrix`,
   * which is one more platform object to be missing, and scaling the context
   * scales the pattern with it for free. The rect is divided by the same factor
   * so the fill still covers the document after the scale.
   */
  #paintTexture(t: CanvasRenderingContext2D, composite: GlobalCompositeOperation): void {
    const pattern = this.#texturePattern(t);
    if (!pattern) return;
    const { scale, intensity } = this.#state.texture;
    const s = Math.max(0.05, scale);
    t.save();
    t.globalCompositeOperation = composite;
    t.globalAlpha = Math.max(0, Math.min(1, intensity));
    t.imageSmoothingEnabled = true;
    t.fillStyle = pattern;
    t.scale(s, s);
    t.fillRect(0, 0, CANVAS_W / s, CANVAS_H / s);
    t.restore();
  }

  /** The active layer, if it exists and can be painted on. */
  #paintableLayer(id: string): Layer | null {
    const layer = this.#state.layers.find((l) => l.id === id);
    if (!layer) {
      this.say("No active layer");
      return null;
    }
    if (!layer.visible) {
      this.say("That layer is hidden");
      return null;
    }
    return layer;
  }

  /** The texture tool's click: fill the layer, or the selection if there is one. */
  fillTexture(): void {
    this.#settle();
    const id = this.#state.activeLayer;
    if (!this.#paintableLayer(id)) return;
    const ctx = this.context(id);
    if (!ctx) return;

    this.pushUndo(id);
    this.clipDraw(ctx, (t) => this.#paintTexture(t, "source-over"));
    this.composite();
    this.countStroke();
    this.say(`Filled with ${this.#state.texture.kind}${this.#selection ? ", inside the selection" : ""}`);
  }

  /**
   * Lay the pattern over what a layer already has — `amberart.layer.texturize`.
   *
   * `source-atop` is the whole row: the texture lands only where the layer has
   * pixels, so lettering becomes textured lettering and the transparency around
   * it stays transparent. That is the difference between a material and a
   * background, and it is one composite operation.
   *
   * The operation is set INSIDE the draw when there is no selection and passed
   * to `clipThrough` when there is — the eraser's `direct` split, for the same
   * reason: with a mask the draw goes into a scratch, and `source-atop` against
   * an empty scratch composites with nothing and lands nothing.
   */
  texturizeLayer(id: string): void {
    this.#settle();
    if (!this.#paintableLayer(id)) return;
    const ctx = this.context(id);
    if (!ctx) return;

    this.pushUndo(id);
    const masked = this.#selection !== null;
    clipThrough(ctx, this.#selection, (t) => this.#paintTexture(t, masked ? "source-over" : "source-atop"), {
      composite: "source-atop",
      bounds: this.#bounds
    });
    this.composite();
    this.countStroke();
    this.say(`Texturized with ${this.#state.texture.kind}`);
  }

  /* ------------------------------------------------- filters and adjustments */

  /**
   * Unfold the filters panel — `amberart.filters.open`, and the panel's own
   * header row.
   *
   * The panel is the only thing that knows which filter is chosen; this is the
   * one bit of it a command outside React has to be able to reach.
   */
  openFilters(): void {
    if (this.#state.filtersOpen) return;
    this.#set({ filtersOpen: true, message: "Filters — pick one, then Apply" });
  }

  /** Fold it away, dropping any preview with it. */
  closeFilters(): void {
    this.cancelFilter();
    if (this.#state.filtersOpen) this.#set({ filtersOpen: false });
  }

  toggleFilters(): void {
    if (this.#state.filtersOpen) this.closeFilters();
    else this.openFilters();
  }

  /**
   * Forget the session: its source, its preview, and the layer they belong to.
   *
   * Returns whether a preview was actually on screen, so the caller knows
   * whether a repaint is owed. It never composites itself — several call sites
   * are mid-operation and are about to composite anyway, and a repaint of a
   * half-written layer is a flicker nobody asked for.
   */
  #dropFilter(): boolean {
    const shown = this.#filterView !== null;
    this.#filterSource = null;
    this.#filterLayer = null;
    this.#filterView = null;
    return shown;
  }

  /**
   * The session's source pixels, read once and held.
   *
   * See {@link #filterSource} for why they are held rather than re-read: every
   * preview runs against the ORIGINAL, so a slider drag cannot compound.
   */
  #filterSourceFor(id: string): ImageData | null {
    if (this.#filterSource && this.#filterLayer === id) return this.#filterSource;
    const ctx = this.context(id);
    if (!ctx) return null;
    this.#filterLayer = id;
    this.#filterSource = ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
    return this.#filterSource;
  }

  /** An offscreen canvas at a given size, reused across previews. */
  #filterCanvas(which: "view" | "half", w: number, h: number): HTMLCanvasElement | null {
    if (typeof document === "undefined") return null;
    const held = which === "view" ? this.#filterView : this.#filterHalf;
    const c = held ?? document.createElement("canvas");
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    if (which === "view") this.#filterView = c;
    else this.#filterHalf = c;
    return c;
  }

  /**
   * Run a filter and show the result WITHOUT touching the layer.
   *
   * Called from the panel behind a ~120 ms debounce, so this is what a slider
   * drag costs. Two things make that affordable:
   *
   *   - the source is read once per session, not per preview; and
   *   - a filter whose cost is more than one sweep of the buffer runs on a
   *     HALF-RESOLUTION copy and is scaled back up ({@link previewScale}),
   *     which quarters the pixels. **Apply always runs at full resolution** —
   *     the half-size run exists to keep a drag live, never to decide what
   *     lands.
   *
   * With a selection, the preview is merged through the mask by exactly the
   * call {@link applyFilter} uses, so the two cannot disagree about the edge.
   */
  previewFilter(filter: FilterId, params: FilterParams): void {
    this.#settle();
    const id = this.#state.activeLayer;
    if (!this.#paintableLayer(id)) return;
    /* The source first, and only then the view canvas: assigning `#filterView`
       is what makes `composite()` start substituting it, so it must not be
       created on a path that then bails out with nothing drawn in it. */
    const source = this.#filterSourceFor(id);
    if (!source) return;
    const view = this.#filterCanvas("view", CANVAS_W, CANVAS_H);
    const vctx = view?.getContext("2d");
    if (!view || !vctx) return;

    const scale = previewScale(filter, params);
    const half = scale < 1 ? this.#filterCanvas("half", Math.round(CANVAS_W * scale), Math.round(CANVAS_H * scale)) : null;
    const hctx = half?.getContext("2d");
    /* The layer buffer, not the snapshot, is what the half-size copy is drawn
       from — they are the same pixels for the life of a session (nothing may
       write to the layer without `#dropFilter` ending it), and downscaling a
       canvas is one `drawImage` where downscaling an `ImageData` is a loop. */
    const buf = this.buffer(id);

    vctx.save();
    vctx.globalAlpha = 1;
    vctx.globalCompositeOperation = "source-over";
    vctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    if (half && hctx && buf) {
      hctx.clearRect(0, 0, half.width, half.height);
      hctx.drawImage(buf, 0, 0, half.width, half.height);
      const small = hctx.getImageData(0, 0, half.width, half.height);
      const result = runFilter(filter, small, params);
      small.data.set(result.data);
      hctx.putImageData(small, 0, 0);
      vctx.imageSmoothingEnabled = true;
      vctx.imageSmoothingQuality = "high";
      vctx.drawImage(half, 0, 0, half.width, half.height, 0, 0, CANVAS_W, CANVAS_H);
    } else {
      const result = runFilter(filter, source, params);
      const img = vctx.createImageData(CANVAS_W, CANVAS_H);
      img.data.set(result.data);
      vctx.putImageData(img, 0, 0);
    }
    vctx.restore();

    if (this.#coverage) {
      const shown = vctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
      shown.data.set(maskedResult(source, shown, this.#coverage));
      vctx.putImageData(shown, 0, 0);
    }

    this.composite();
  }

  /**
   * Write the filter into the layer, undoably — the panel's Apply.
   *
   * Always full resolution, whatever the preview ran at, and always from the
   * session's source rather than from the preview canvas: a half-size preview
   * upscaled would land soft, and reading the preview back would bake in the
   * scaling instead of the filter.
   *
   * The selection is honoured through {@link maskedResult} — the same escape
   * hatch the flood fill uses, and for the same reason. A filter READS the
   * whole buffer, so it cannot be redirected into `clipThrough`'s scratch: the
   * scratch is empty, and a blur of nothing is nothing.
   */
  applyFilter(filter: FilterId, params: FilterParams): void {
    this.#settle();
    const id = this.#state.activeLayer;
    if (!this.#paintableLayer(id)) return;
    const ctx = this.context(id);
    const source = this.#filterSourceFor(id);
    if (!ctx || !source) return;

    const result = runFilter(filter, source, params);
    const coverage = this.#coverage;
    /* `pushUndo` reads the layer as it stands — which is the source, because a
       preview never wrote to it — and its `#push` ends the session, so the
       source is taken above and held locally. */
    this.pushUndo(id);
    const img = ctx.createImageData(CANVAS_W, CANVAS_H);
    img.data.set(coverage ? maskedResult(source, result, coverage) : result.data);
    ctx.putImageData(img, 0, 0);

    this.#dropFilter();
    this.composite();
    this.countStroke();
    this.say(`${filterLabel(filter)} applied${coverage ? ", inside the selection" : ""}`);
  }

  /** Drop the preview and put the real pixels back on screen — Cancel. */
  cancelFilter(): void {
    if (!this.#dropFilter()) return;
    this.composite();
    this.say("Filter preview dropped");
  }

  /* ------------------------------------------------- the extension point */

  /**
   * Place an SVG document onto the active layer, undoably.
   *
   * This is the ONE mutation a contributed tool can perform, and it goes
   * through the same `pushUndo` a brush stroke does — a plugin's output must be
   * undoable or the undo stack is a lie.
   */
  async placeSvg(svg: string, opts?: { fit?: "cover" | "contain" }): Promise<void> {
    this.#settle();
    const layer = this.#state.activeLayer;
    if (!layer) {
      this.say("No active layer");
      return;
    }
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
      const img = await loadImage(url);
      this.pushUndo(layer);
      const ctx = this.context(layer);
      if (!ctx) return;
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      const box = fitBox(img.width || CANVAS_W, img.height || CANVAS_H, opts?.fit ?? "cover");
      ctx.drawImage(img, box.x, box.y, box.w, box.h);
      ctx.restore();
      this.composite();
      this.countStroke();
      this.say("Placed onto the canvas");
    } catch (e) {
      this.say(e instanceof Error ? e.message : "could not place that drawing");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /* ------------------------------------------------------------- export */

  /**
   * Save the composite as a PNG.
   *
   * The chrome comes off for the read and goes back on afterwards, exactly as
   * {@link pickAt} does it: the view carries the marching ants and the transform
   * box, and `toDataURL` reads the VIEW. An export with a dashed rectangle baked
   * into it is a file nobody can use, and the person only finds out later.
   */
  exportPng(): void {
    const view = this.#view;
    if (!view) return;
    this.#settle();
    if (this.#hasChrome()) {
      this.#chromeHidden = true;
      this.composite();
    }
    const url = view.toDataURL("image/png");
    if (this.#chromeHidden) {
      this.#chromeHidden = false;
      this.composite();
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = "amberart.png";
    a.click();
    this.say("Exported amberart.png");
  }
}

/** The process-wide AmberArt document. */
export const amberArt = new AmberArtStore();

export function useAmberArt(): AmberArtState {
  return React.useSyncExternalStore(amberArt.subscribe, amberArt.getState, amberArt.getServerState);
}
