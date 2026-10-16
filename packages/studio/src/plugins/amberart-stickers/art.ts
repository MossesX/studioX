/**
 * @file The sticker library — five drawings as pure SVG-fragment builders.
 *
 * No React, no DOM, no imports: every export here is `(colours) => string`, so
 * the same function draws the picker's 44px thumbnail, the panel's live preview
 * and the 1600×1000 document that lands on the canvas. One drawing, three
 * consumers, and no way for the preview to disagree with what gets placed.
 *
 * ## Why a plain string and not JSX
 *
 * `ToolHost.placeSvg` takes an SVG *document* as text — the store turns it into
 * a Blob and draws the decoded image onto the active layer. Markup is therefore
 * the native currency here, and JSX would mean serialising a React tree back to
 * a string to hand it over. It would also drag this file into `.tsx`, and the
 * panel's `plugin.ts` sits one import away from the closure resolver, which
 * runs under plain Node.
 *
 * ## The house style
 *
 * Every filled shape carries its own `stroke` in the outline colour, and every
 * limb is drawn twice — a fat outline pass, then a thinner colour pass over it.
 * That is what produces the sticker's continuous dark edge without a filter, a
 * mask or a second render pass, and it survives rasterisation at any size
 * because it is geometry rather than an effect.
 *
 * ## Positioning, and why the host contract did not have to change
 *
 * `ToolHost` offers `placeSvg(svg, { fit })` and nothing else — no x, no y, no
 * rotation. {@link composeCanvasSvg} answers that by building a document the
 * exact size of the canvas backing store (1600×1000) with the sticker
 * transformed *inside* it. `fit: "contain"` on a document that already matches
 * the canvas is the identity, so the sticker lands precisely where the panel
 * put it. The narrow contract stays narrow.
 */

/** The canvas backing store, which {@link composeCanvasSvg} matches exactly. */
export const CANVAS_W = 1600;
/** @see CANVAS_W */
export const CANVAS_H = 1000;

/** The three colours every sticker is drawn from. */
export interface StickerColors {
  /** Body, letterforms — the colour the sticker reads as. */
  readonly primary: string;
  /** Bib, inner ears, nose, the wordmark's drop shadow. */
  readonly secondary: string;
  /** Every edge, and the eyes. Dark enough to hold at thumbnail size. */
  readonly outline: string;
}

/** GizmoX orange over a warm cream, on near-black. */
export const DEFAULT_STICKER_COLORS: StickerColors = {
  primary: "#FF8A2B",
  secondary: "#FFE3C4",
  outline: "#1B1206"
};

export type StickerId = "cat-sitting" | "cat-loaf" | "cat-stretching" | "gizmo-wordmark" | "gizmo-lockup";

/** One drawing, with the coordinate space its paths are written in. */
export interface Sticker {
  readonly id: StickerId;
  readonly title: string;
  /** One line, shown under the picker. */
  readonly note: string;
  readonly width: number;
  readonly height: number;
  /** Always `0 0 width height` — kept as a field so consumers never rebuild it. */
  readonly viewBox: string;
  /** The drawing, as an SVG `<g>` in the sticker's own coordinate space. */
  readonly draw: (c: StickerColors) => string;
}

/* ------------------------------------------------------------ primitives -- */

/** Round a number to a fixed places, without a trailing `.00`. */
const r = (n: number, places = 2): string => String(Number(n.toFixed(places)));

/**
 * A filled shape with the house edge on it.
 *
 * The stroke is on the *same* element as the fill, which is what keeps the edge
 * exactly on the silhouette. A separate outline element underneath would need
 * its own copy of the path, and the two drift the moment one is edited.
 */
const solid = (d: string, fill: string, outline: string, w = 5): string =>
  `<path d="${d}" fill="${fill}" stroke="${outline}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`;

/** A limb, tail or whisker: a fat outline pass, then the colour over it. */
const limb = (d: string, color: string, outline: string, w = 12): string =>
  `<path d="${d}" fill="none" stroke="${outline}" stroke-width="${w + 6}" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

/** A single stroked line — whiskers, mouths, closed eyes. */
const line = (d: string, color: string, w: number, opacity = 1): string =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"` +
  `${opacity === 1 ? "" : ` opacity="${opacity}"`}/>`;

/**
 * The face every cat wears, at the scale and centre it is asked for.
 *
 * Three cats sharing one face is the difference between a mascot and three
 * animals that happen to be the same colour — and it means an adjustment to the
 * expression lands on all three at once.
 */
function face(
  c: StickerColors,
  o: { cx: number; cy: number; k: number; eyes: "open" | "closed"; whiskers: "both" | "left" }
): string {
  const { cx, cy, k } = o;
  /** Sticker space → face space: the face is authored around (0,0) at k = 1. */
  const at = (x: number, y: number): string => `${r(cx + x * k)} ${r(cy + y * k)}`;
  const w = (n: number): number => n * k;

  const eyes =
    o.eyes === "open"
      ? `<ellipse cx="${r(cx - 20 * k)}" cy="${r(cy - 8 * k)}" rx="${r(w(8.5))}" ry="${r(w(10.5))}" fill="${c.outline}"/>` +
        `<ellipse cx="${r(cx + 20 * k)}" cy="${r(cy - 8 * k)}" rx="${r(w(8.5))}" ry="${r(w(10.5))}" fill="${c.outline}"/>` +
        `<circle cx="${r(cx - 17 * k)}" cy="${r(cy - 12.5 * k)}" r="${r(w(3.2))}" fill="${c.secondary}"/>` +
        `<circle cx="${r(cx + 23 * k)}" cy="${r(cy - 12.5 * k)}" r="${r(w(3.2))}" fill="${c.secondary}"/>`
      : /* The content squint. Two arcs, opening downward, and the whole
           character of the loaf and the stretch rests on them. */
        line(`M${at(-28, -8)} C${at(-24, -15)} ${at(-16, -15)} ${at(-12, -8)}`, c.outline, w(4.6)) +
        line(`M${at(12, -8)} C${at(16, -15)} ${at(24, -15)} ${at(28, -8)}`, c.outline, w(4.6));

  const whiskerSet =
    line(`M${at(-38, 2)} L${at(-72, -5)}`, c.outline, w(2.8), 0.85) +
    line(`M${at(-38, 9)} L${at(-74, 9)}`, c.outline, w(2.8), 0.85) +
    line(`M${at(-38, 16)} L${at(-71, 25)}`, c.outline, w(2.8), 0.85) +
    (o.whiskers === "both"
      ? line(`M${at(38, 2)} L${at(72, -5)}`, c.outline, w(2.8), 0.85) +
        line(`M${at(38, 9)} L${at(74, 9)}`, c.outline, w(2.8), 0.85) +
        line(`M${at(38, 16)} L${at(71, 25)}`, c.outline, w(2.8), 0.85)
      : "");

  return (
    /* Cheeks first — they are a blush behind the features, not a mask over. */
    `<circle cx="${r(cx - 32 * k)}" cy="${r(cy + 9 * k)}" r="${r(w(7))}" fill="${c.secondary}" opacity="0.45"/>` +
    `<circle cx="${r(cx + 32 * k)}" cy="${r(cy + 9 * k)}" r="${r(w(7))}" fill="${c.secondary}" opacity="0.45"/>` +
    whiskerSet +
    eyes +
    solid(
      `M${at(-7.5, 4)} L${at(7.5, 4)} C${at(7.5, 11)} ${at(4, 15.5)} ${at(0, 17.5)} C${at(-4, 15.5)} ${at(-7.5, 11)} ${at(-7.5, 4)} Z`,
      c.secondary,
      c.outline,
      w(2.6)
    ) +
    line(`M${at(0, 17.5)} C${at(0, 24)} ${at(-6, 26)} ${at(-9.5, 22.5)}`, c.outline, w(3.2)) +
    line(`M${at(0, 17.5)} C${at(0, 24)} ${at(6, 26)} ${at(9.5, 22.5)}`, c.outline, w(3.2))
  );
}

/* ------------------------------------------------------------- the cats -- */

/**
 * The sitting cat — the mascot pose, and the one the lockup is built on.
 *
 * Tail curling up the right side, bib down the chest, front paws set apart.
 * Everything above the shoulders is deliberately a little oversized: a head at
 * true feline proportion reads as a *cat*, and a head at 1.15× reads as a
 * *character*.
 */
const catSitting = (c: StickerColors): string =>
  "<g>" +
  /* Tail first — it passes behind the body. */
  limb("M144 200 C176 197 186 158 170 139 C161 129 145 135 148 149 C150 158 162 159 166 150", c.primary, c.outline, 16) +
  /* Ears behind the head, so only their tips show. */
  solid("M56 76 C53 42 58 28 69 29 C79 30 92 46 100 58 Z", c.primary, c.outline) +
  solid("M144 76 C147 42 142 28 131 29 C121 30 108 46 100 58 Z", c.primary, c.outline) +
  solid("M100 96 C131 96 150 140 150 184 C150 204 138 212 100 212 C62 212 50 204 50 184 C50 140 69 96 100 96 Z", c.primary, c.outline) +
  `<path d="M100 124 C115 124 124 148 124 175 C124 196 113 204 100 204 C87 204 76 196 76 175 C76 148 85 124 100 124 Z" fill="${c.secondary}" opacity="0.9"/>` +
  solid("M100 42 C132 42 154 62 154 90 C154 118 130 136 100 136 C70 136 46 118 46 90 C46 62 68 42 100 42 Z", c.primary, c.outline) +
  `<path d="M63 68 C61 46 64 38 70 39 C76 40 84 51 89 60 Z" fill="${c.secondary}"/>` +
  `<path d="M137 68 C139 46 136 38 130 39 C124 40 116 51 111 60 Z" fill="${c.secondary}"/>` +
  face(c, { cx: 100, cy: 96, k: 1, eyes: "open", whiskers: "both" }) +
  /* Paws last, over the body's lower edge. */
  solid("M59 204 C59 197 66 194 76 194 C86 194 93 197 93 204 C93 210 86 214 76 214 C66 214 59 210 59 204 Z", c.primary, c.outline, 4) +
  solid("M107 204 C107 197 114 194 124 194 C134 194 141 197 141 204 C141 210 134 214 124 214 C114 214 107 210 107 204 Z", c.primary, c.outline, 4) +
  line("M71 199 L71 208", c.outline, 2.4, 0.7) +
  line("M81 199 L81 208", c.outline, 2.4, 0.7) +
  line("M119 199 L119 208", c.outline, 2.4, 0.7) +
  line("M129 199 L129 208", c.outline, 2.4, 0.7) +
  "</g>";

/**
 * The loaf — a cat folded into a dome with every leg tucked underneath.
 *
 * The eyes are closed here and not in the sitting pose, which is the whole
 * point of having two: a loaf with open eyes is a cat about to get up.
 */
const catLoaf = (c: StickerColors): string =>
  "<g>" +
  solid("M78 62 C74 34 79 24 89 26 C98 28 108 42 114 52 Z", c.primary, c.outline) +
  solid("M162 62 C166 34 161 24 151 26 C142 28 132 42 126 52 Z", c.primary, c.outline) +
  solid(
    "M32 150 C32 96 68 64 120 64 C172 64 208 96 208 150 C208 156 204 158 197 158 L43 158 C36 158 32 156 32 150 Z",
    c.primary,
    c.outline
  ) +
  `<path d="M120 108 C146 108 166 128 168 150 C168 156 164 158 158 158 L82 158 C76 158 72 156 72 150 C74 128 94 108 120 108 Z" fill="${c.secondary}" opacity="0.85"/>` +
  solid("M120 44 C152 44 168 62 168 84 C168 108 148 124 120 124 C92 124 72 108 72 84 C72 62 88 44 120 44 Z", c.primary, c.outline) +
  `<path d="M84 56 C82 38 85 32 90 34 C95 36 101 46 105 53 Z" fill="${c.secondary}"/>` +
  `<path d="M156 56 C158 38 155 32 150 34 C145 36 139 46 135 53 Z" fill="${c.secondary}"/>` +
  face(c, { cx: 120, cy: 88, k: 0.9, eyes: "closed", whiskers: "both" }) +
  /* Tucked paws — just the toes showing past the loaf's front edge. */
  solid("M86 152 C86 146 93 143 102 143 C111 143 118 146 118 152 C118 157 111 160 102 160 C93 160 86 157 86 152 Z", c.primary, c.outline, 4) +
  solid("M124 152 C124 146 131 143 140 143 C149 143 156 146 156 152 C156 157 149 160 140 160 C131 160 124 157 124 152 Z", c.primary, c.outline, 4) +
  line("M97 147 L97 156", c.outline, 2.2, 0.7) +
  line("M107 147 L107 156", c.outline, 2.2, 0.7) +
  line("M135 147 L135 156", c.outline, 2.2, 0.7) +
  line("M145 147 L145 156", c.outline, 2.2, 0.7) +
  /* The tail comes round the front and rests along the floor. */
  limb("M204 138 C218 141 218 155 204 158 L164 158", c.primary, c.outline, 12) +
  "</g>";

/**
 * The stretch — the downward-dog: chest low, rump high, tail up with a curl.
 *
 * The limbs are stroked rather than filled. A round cap at 12px reads as a paw
 * and a rounded leg at every scale, and a filled leg outline would need four
 * more paths to say the same thing.
 */
const catStretching = (c: StickerColors): string =>
  /* Nudged in from the corner: the head sits at the far left of the pose and
     its outer whisker reaches x ≈ 0 unshifted, which the viewBox would crop. */
  '<g transform="translate(8 6)">' +
  /* Far side legs, then the tail — all behind the body. */
  limb("M94 128 L78 162", c.primary, c.outline, 11) +
  limb("M206 126 L212 160", c.primary, c.outline, 11) +
  limb("M246 56 C264 40 262 18 248 12 C239 8 232 16 236 25", c.primary, c.outline, 12) +
  /* The silhouette carries the whole pose: a low thin chest, a dip behind the
     shoulders, then a steep climb into a rump twice the chest's depth. A
     smooth top edge from shoulder to rump is what makes a stretching cat come
     out as a sausage, so the dip is load-bearing rather than decorative. */
  solid(
    "M78 124 C60 122 52 110 58 98 C70 82 96 76 118 74 C146 71 168 58 186 44 " +
      "C206 28 238 34 246 62 C254 90 240 116 216 126 C198 134 150 136 118 133 " +
      "C100 131 86 129 78 124 Z",
    c.primary,
    c.outline
  ) +
  /* The underside, and the stripes that make the arch readable. */
  `<path d="M86 120 C118 133 178 134 216 119 C216 131 200 137 150 138 C112 138 94 131 86 120 Z" fill="${c.secondary}" opacity="0.9"/>` +
  /* The haunch. Without it the rump is a smooth blob and the whole animal
     reads as a root vegetable — one curve is the difference. */
  solid("M214 129 C196 117 194 92 210 78 C226 66 245 75 247 95 C249 114 236 130 214 129 Z", c.primary, c.outline, 4) +
  line("M158 70 L163 86", c.secondary, 7, 0.55) +
  line("M182 58 L188 74", c.secondary, 7, 0.55) +
  line("M206 48 L212 64", c.secondary, 7, 0.55) +
  /* Near side legs, over the body — the front pair reaching further forward
     than the body ends, which is the half of "stretch" the arch cannot say. */
  limb("M76 124 L58 158", c.primary, c.outline, 11) +
  limb("M222 128 L230 162", c.primary, c.outline, 11) +
  solid("M42 88 C35 64 38 55 47 58 C55 61 61 72 64 81 Z", c.primary, c.outline, 4) +
  solid("M88 88 C95 66 92 56 84 58 C77 61 71 71 68 79 Z", c.primary, c.outline, 4) +
  solid("M66 77 C86 77 99 89 99 106 C99 123 85 135 66 135 C47 135 33 123 33 106 C33 89 46 77 66 77 Z", c.primary, c.outline) +
  `<path d="M47 83 C42 66 44 61 49 63 C53 65 57 72 59 78 Z" fill="${c.secondary}"/>` +
  `<path d="M83 83 C88 68 86 62 81 64 C77 66 74 72 72 77 Z" fill="${c.secondary}"/>` +
  face(c, { cx: 66, cy: 108, k: 0.86, eyes: "closed", whiskers: "left" }) +
  "</g>";

/* --------------------------------------------------------- the wordmark -- */

/**
 * GIZMO as five stroked letterforms.
 *
 * A rounded-stroke construction rather than filled outlines: five paths instead
 * of five two-contour shapes, correct by construction at any weight, and it is
 * a real display face rather than a system font pretending to be one — which
 * matters, because an `<svg>` rasterised through a Blob can only reach fonts the
 * machine happens to have.
 *
 * `cx` is the letter's optical centre, and the lockup's arch pivots on it.
 */
interface Letter {
  readonly key: string;
  readonly d: string;
  readonly cx: number;
}

/** Cap height 32→128, stroke 24, centres spaced for a 12px optical gap. */
const GIZMO_LETTERS: readonly Letter[] = [
  /* The G's aperture opens at the upper right and the bar returns past the
     centre — the two things that keep it from reading as a C or an O. */
  { key: "G", d: "M96 49 A44 48 0 1 0 106 80 L74 80", cx: 62 },
  { key: "I", d: "M146 32 L146 128", cx: 146 },
  { key: "Z", d: "M182 32 L260 32 L182 128 L260 128", cx: 221 },
  { key: "M", d: "M296 128 L296 32 L346 92 L396 32 L396 128", cx: 346 },
  { key: "O", d: "M476 32 A44 48 0 0 1 476 128 A44 48 0 0 1 476 32", cx: 476 }
];

/** The word's optical centre — the axis the arch is symmetric about. */
const WORD_CX = (GIZMO_LETTERS[0]!.cx + GIZMO_LETTERS[GIZMO_LETTERS.length - 1]!.cx) / 2;

const FACE_W = 24;
const EDGE_W = 34;
/** The drop shadow's offset. Under an edge 5px proud of the face, less than
    about 10 disappears entirely — this is the smallest offset that survives. */
const SHADOW = 12;

const letterPath = (l: Letter, color: string, w: number, transform: string): string =>
  `<path d="${l.d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"` +
  `${transform ? ` transform="${transform}"` : ""}/>`;

/**
 * The three passes, in the one order that works.
 *
 * Shadows for every letter, then edges for every letter, then faces — never
 * shadow/edge/face per letter, or a letter's edge cuts into its neighbour's
 * face wherever the arch brings two of them close.
 */
function gizmoWord(c: StickerColors, transform: (l: Letter) => string): string {
  const pass = (color: string, w: number, extra: string): string =>
    GIZMO_LETTERS.map((l) => letterPath(l, color, w, `${extra}${extra ? " " : ""}${transform(l)}`.trim())).join("");
  return (
    pass(c.secondary, FACE_W, `translate(${SHADOW} ${SHADOW})`) +
    pass(c.outline, EDGE_W, "") +
    pass(c.primary, FACE_W, "")
  );
}

const gizmoWordmark = (c: StickerColors): string => `<g transform="translate(6 0)">${gizmoWord(c, () => "")}</g>`;

/* ----------------------------------------------------------- the lockup -- */

/**
 * The arch, as a rotation about a pivot far below the baseline.
 *
 * Each letter is first slid to the word's centre and then swung out along a
 * circle of radius {@link ARCH_R}: swinging it *from where it already is* would
 * double every offset and fling the outer letters off the sticker. The letter
 * tilts with the arc for free, which is the half a translation-only arch gets
 * wrong.
 */
const ARCH_R = 620;
const ARCH_PIVOT_Y = 80 + ARCH_R;

const archTransform = (l: Letter): string => {
  const deg = ((l.cx - WORD_CX) / ARCH_R) * (180 / Math.PI);
  return `rotate(${r(deg)} ${r(WORD_CX)} ${ARCH_PIVOT_Y}) translate(${r(WORD_CX - l.cx)} 0)`;
};

/**
 * GIZMO arched above the sitting cat — the sticker this whole feature was
 * asked for, and the one thing on the picker that is not a component of
 * something else.
 */
const gizmoLockup = (c: StickerColors): string =>
  "<g>" +
  `<g transform="translate(13 4) scale(0.78)"><g transform="translate(6 0)">${gizmoWord(c, archTransform)}</g></g>` +
  `<g transform="translate(92 145) scale(1.25)">${catSitting(c)}</g>` +
  "</g>";

/* ------------------------------------------------------------ the shelf -- */

const sticker = (
  id: StickerId,
  title: string,
  note: string,
  width: number,
  height: number,
  draw: (c: StickerColors) => string
): Sticker => ({ id, title, note, width, height, viewBox: `0 0 ${width} ${height}`, draw });

/** Every sticker in the set, in picker order. */
export const STICKERS: readonly Sticker[] = [
  sticker("gizmo-lockup", "GIZMO lockup", "The wordmark arched over the cat — the whole mark.", 460, 440, gizmoLockup),
  sticker("cat-sitting", "Cat, sitting", "The mascot pose: tail up, bib down, paws set.", 200, 232, catSitting),
  sticker("cat-loaf", "Cat, loaf", "Every leg tucked under, eyes closed.", 240, 172, catLoaf),
  sticker("cat-stretching", "Cat, stretching", "Chest low, rump high, tail curled.", 290, 190, catStretching),
  sticker("gizmo-wordmark", "GIZMO wordmark", "Five rounded strokes with a coloured shadow.", 556, 168, gizmoWordmark)
];

/** The set's default, and the answer to an id nothing recognises. */
export const DEFAULT_STICKER_ID: StickerId = "gizmo-lockup";

/**
 * Look a sticker up by id, never returning `undefined`.
 *
 * A picker holding an id from a previous session is the realistic way this is
 * called with something unknown, and a panel that renders nothing is a worse
 * answer than a panel showing the lockup.
 */
export function stickerById(id: string): Sticker {
  return STICKERS.find((s) => s.id === id) ?? STICKERS.find((s) => s.id === DEFAULT_STICKER_ID)!;
}

/** A standalone SVG document of one sticker — thumbnails, and Copy SVG. */
export function stickerDocument(s: Sticker, c: StickerColors): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s.width}" height="${s.height}" viewBox="${s.viewBox}">` +
    `${s.draw(c)}</svg>`
  );
}

/** Where and how big, all four values as percentages or degrees. */
export interface Placement {
  /** Centre X, as a percentage of the canvas width. */
  readonly x: number;
  /** Centre Y, as a percentage of the canvas height. */
  readonly y: number;
  /** The sticker is fitted into a box this percentage of the canvas. */
  readonly scale: number;
  /** Degrees, clockwise, about the sticker's own centre. */
  readonly rotation: number;
}

export const DEFAULT_PLACEMENT: Placement = { x: 50, y: 50, scale: 45, rotation: 0 };

/**
 * The size the sticker will actually be, in canvas pixels.
 *
 * `scale` is a *contain* box rather than a width multiplier, so 100% means "as
 * large as it can be without leaving the canvas" for a tall sticker and a wide
 * one alike. A width-based scale would put the 556×168 wordmark off both edges
 * at the same number that fits the 460×440 lockup exactly.
 */
export function placedSize(s: Sticker, scale: number): { width: number; height: number } {
  const k = Math.min(((CANVAS_W * scale) / 100) / s.width, ((CANVAS_H * scale) / 100) / s.height);
  return { width: Math.round(s.width * k), height: Math.round(s.height * k) };
}

/**
 * The document handed to `host.placeSvg`.
 *
 * Canvas-sized and transparent, with the sticker transformed inside it, so
 * `fit: "contain"` is the identity and the placement survives the host's fit
 * maths untouched. See the file header.
 */
export function composeCanvasSvg(s: Sticker, c: StickerColors, p: Placement): string {
  const k = Math.min(((CANVAS_W * p.scale) / 100) / s.width, ((CANVAS_H * p.scale) / 100) / s.height);
  const transform =
    `translate(${r((CANVAS_W * p.x) / 100)} ${r((CANVAS_H * p.y) / 100)}) ` +
    `rotate(${r(p.rotation)}) scale(${r(k, 4)}) translate(${r(-s.width / 2)} ${r(-s.height / 2)})`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}" ` +
    `viewBox="0 0 ${CANVAS_W} ${CANVAS_H}"><g transform="${transform}">${s.draw(c)}</g></svg>`
  );
}
