/**
 * @file AmberArt's text tool — the pure half.
 *
 * Text in AmberArt is **rasterized on commit**, permanently — Photoshop's
 * "rasterize type", except that there is no un-rasterized state to lose. A
 * persistent, re-editable text layer is refused scope by this project's plan
 * for a stated reason: AmberArt's layers are raster buffers, and a parallel
 * vector-object model would double the document format, the undo model and the
 * compositor for one tool.
 *
 * So the live half is a **DOM overlay** above the canvas (the screen owns it)
 * and this file is the maths both halves share:
 *
 *   - {@link fontShorthand} builds the ONE font string. The overlay's CSS and
 *     the `ctx.font` the commit uses are derived from the same call, because a
 *     preview that computes its own font is a preview that lies the first time
 *     somebody adds a weight.
 *   - {@link blockWidth} measures the same way for both, which is what makes
 *     centre and right alignment land where the box showed them.
 *   - {@link drawText} is the commit itself, taking a context so it can be
 *     driven straight onto a layer or through the selection's scratch canvas.
 *
 * ## `var(--axf-mono)` does not survive a canvas
 *
 * The font stacks below are CSS, and one of them is the app's own mono stack —
 * which is a custom property. `ctx.font` is parsed by the canvas, NOT by the
 * CSS cascade: a `var()` in it is not resolved, it is a parse error, and the
 * assignment is silently ignored so the text lands in whatever font the context
 * had before (10px sans-serif, on a fresh context). {@link resolveStack} reads
 * the property off the document root and substitutes it, and BOTH halves go
 * through it — the overlay could have used the raw `var()` and would then have
 * been the only place the font was right.
 */

import type { Point } from "./canvas";

export type TextAlign = "left" | "center" | "right";

/** Everything the text tool draws with. Tool state, not settings. */
export interface TextStyle {
  /** A CSS font stack, one of {@link FONT_STACKS}' `stack` values. */
  family: string;
  /** Size in CANVAS pixels — the overlay multiplies it by the view's scale. */
  size: number;
  bold: boolean;
  italic: boolean;
  align: TextAlign;
  /** The fill. Defaults to the brush colour when a session opens. */
  color: string;
  /** 0 means no stroke at all — not a hairline one. */
  strokeWidth: number;
  strokeColor: string;
}

export interface FontChoice {
  id: string;
  label: string;
  stack: string;
}

/**
 * The dozen faces on offer — every one of them already on the machine.
 *
 * No web font, no `@font-face`, no network. A font that has to load is a font
 * that is missing at the moment the overlay opens and different at the moment
 * the commit rasterizes, and the person's only evidence of the switch is that
 * their text came out the wrong width. Each entry ends in a generic family so
 * a machine without the head of the stack still lands somewhere sensible.
 */
export const FONT_STACKS: readonly FontChoice[] = [
  { id: "helvetica", label: "Arial / Helvetica", stack: "Arial, Helvetica, sans-serif" },
  { id: "verdana", label: "Verdana", stack: "Verdana, Geneva, sans-serif" },
  { id: "trebuchet", label: "Trebuchet MS", stack: "'Trebuchet MS', Tahoma, sans-serif" },
  { id: "georgia", label: "Georgia", stack: "Georgia, 'Times New Roman', serif" },
  { id: "times", label: "Times New Roman", stack: "'Times New Roman', Times, serif" },
  { id: "palatino", label: "Palatino", stack: "'Palatino Linotype', 'Book Antiqua', Palatino, serif" },
  { id: "garamond", label: "Garamond", stack: "Garamond, 'Times New Roman', serif" },
  { id: "courier", label: "Courier New", stack: "'Courier New', Courier, monospace" },
  { id: "impact", label: "Impact", stack: "Impact, 'Arial Black', sans-serif" },
  { id: "comic", label: "Comic Sans MS", stack: "'Comic Sans MS', 'Comic Sans', cursive" },
  { id: "system", label: "System UI", stack: "system-ui, sans-serif" },
  { id: "axf-mono", label: "AmberX mono", stack: "var(--axf-mono), 'Courier New', monospace" }
];

export const TEXT_SIZE_MIN = 8;
export const TEXT_SIZE_MAX = 300;
export const TEXT_STROKE_MAX = 10;

/**
 * The one line-height, shared by the overlay's CSS and the commit's maths.
 *
 * Not configurable: the overlay is a real text box and its leading is what
 * CSS gives it, so a leading knob would be a second number that has to agree
 * with a browser's line-box model to be worth anything.
 */
export const TEXT_LINE_HEIGHT = 1.25;

export const DEFAULT_TEXT_STYLE: TextStyle = {
  family: FONT_STACKS[0]!.stack,
  size: 64,
  bold: false,
  italic: false,
  align: "left",
  color: "#ff7a1a",
  strokeWidth: 0,
  strokeColor: "#000000"
};

const CSS_VAR = /var\(\s*(--[a-z0-9-]+)\s*(?:,([^)]*))?\)/gi;

/**
 * Turn a CSS font stack into one a canvas will accept.
 *
 * Substitutes any `var()` with the value the document root actually carries,
 * falling back to the `var()`'s own default and then to `monospace` — the only
 * stack here that uses a custom property is the mono one, so a fallback that
 * is not monospaced would be worse than a generic one. Off the DOM (a Node
 * test, a server render that never happens) the same substitution runs against
 * the literal fallbacks, so the string is always parseable.
 */
export function resolveStack(stack: string): string {
  if (!stack.includes("var(")) return stack;
  const root = typeof document === "undefined" ? null : getComputedStyle(document.documentElement);
  return stack.replace(CSS_VAR, (_m: string, name: string, fallback?: string) => {
    const live = root?.getPropertyValue(name).trim();
    return live || fallback?.trim() || "monospace";
  });
}

/**
 * The canvas/CSS font shorthand for a style, optionally scaled.
 *
 * `scale` is the view's canvas-px→CSS-px ratio: the overlay passes it so the
 * DOM text is the same visual size as the pixels that will land, and the
 * commit passes nothing because it draws in canvas space.
 */
export function fontShorthand(style: TextStyle, scale = 1): string {
  const bits: string[] = [];
  if (style.italic) bits.push("italic");
  if (style.bold) bits.push("bold");
  bits.push(`${Math.max(1, style.size * scale)}px`);
  bits.push(resolveStack(style.family));
  return bits.join(" ");
}

/** What the person typed, as lines. `\r\n` and a lone `\r` both count. */
export function textLines(value: string): string[] {
  return value.replace(/\r\n?/g, "\n").split("\n");
}

/**
 * A context that exists only to measure — created once, never drawn on.
 *
 * `undefined` means "not asked yet", `null` means "asked, and there is no DOM
 * here": the difference matters because a `null` is a perfectly good cached
 * answer and re-asking for it on every keystroke would create a canvas per
 * keystroke on the day someone drives this from Node.
 */
let measurer: CanvasRenderingContext2D | null | undefined;

function measureCtx(): CanvasRenderingContext2D | null {
  if (measurer !== undefined) return measurer;
  measurer = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  return measurer;
}

/**
 * The widest line, in canvas pixels — the block's width.
 *
 * It is what alignment is measured against on both sides: the overlay is this
 * wide, and {@link drawText} centres and right-aligns inside exactly this box.
 * Zero without a DOM, which is the honest answer rather than a guess.
 */
export function blockWidth(lines: readonly string[], style: TextStyle): number {
  const ctx = measureCtx();
  if (!ctx) return 0;
  ctx.font = fontShorthand(style);
  let widest = 0;
  for (const line of lines) widest = Math.max(widest, ctx.measureText(line).width);
  return widest;
}

/** The block's height in canvas pixels — every line, leading included. */
export function blockHeight(lines: readonly string[], style: TextStyle): number {
  return Math.max(1, lines.length) * style.size * TEXT_LINE_HEIGHT;
}

/**
 * Rasterize a block of text at `at`, in canvas pixels.
 *
 * `at` is the block's TOP-LEFT — the overlay's own corner — so what was on
 * screen and what lands are the same rectangle.
 *
 * Two details are what make the two agree rather than nearly agree:
 *
 *   - **Half-leading.** `textBaseline: "top"` puts the glyph tops at `y`,
 *     while a CSS line box of `line-height: 1.25` puts half the extra leading
 *     ABOVE the text. Without the `half` term below, every commit would land
 *     0.125em higher than the box showed it — a small, consistent, maddening
 *     lift that reads as "the text tool is a bit off".
 *   - **A doubled stroke, painted under the fill.** A canvas stroke straddles
 *     the outline, so half of it is inside the glyph and gets covered by the
 *     fill drawn on top. Asking for twice the width lands exactly the asked-for
 *     thickness OUTSIDE the letter, which is what a stroke of 3 looks like in
 *     Photoshop and what the overlay's `paint-order: stroke` shows.
 *
 * The context's alpha and composite are set explicitly rather than inherited:
 * this runs inside the selection's scratch canvas as often as not, and a
 * leftover `destination-out` there would erase a hole in the shape of the
 * words.
 */
export function drawText(
  ctx: CanvasRenderingContext2D,
  lines: readonly string[],
  at: Point,
  style: TextStyle,
  width = blockWidth(lines, style)
): void {
  const lineBox = style.size * TEXT_LINE_HEIGHT;
  const half = (lineBox - style.size) / 2;
  const x = style.align === "left" ? at.x : style.align === "right" ? at.x + width : at.x + width / 2;

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.font = fontShorthand(style);
  ctx.textBaseline = "top";
  ctx.textAlign = style.align;
  ctx.fillStyle = style.color;
  ctx.strokeStyle = style.strokeColor;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.miterLimit = 2;
  ctx.lineWidth = style.strokeWidth * 2;

  lines.forEach((line, i) => {
    const y = at.y + half + i * lineBox;
    if (style.strokeWidth > 0) ctx.strokeText(line, x, y);
    ctx.fillText(line, x, y);
  });

  ctx.restore();
}
