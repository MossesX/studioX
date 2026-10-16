/**
 * @file AmberArt's move and free transform — the maths, pure.
 *
 * A transform SESSION is "some pixels are in the air": lifted out of a layer
 * into a floating buffer, carried around by an affine transform, and put back
 * down when it commits. The pixels and the buffer belong to the store; what
 * lives here is the geometry, and it is deliberately the whole of the geometry —
 * the store never does trigonometry and the screen never does any at all.
 *
 * That split exists for the same reason `selection.ts` has one: Node has no
 * `<canvas>`, so a matrix expressed against a context is a matrix nobody can
 * test, and a rotation that is a quarter-turn out or a corner drag that fails to
 * hold its anchor still presents as "the transform feels wrong" — a symptom
 * nobody reports precisely enough to find. `test/amberart-transform.test.ts`
 * drives every function below on numbers.
 *
 * ## The model
 *
 * A {@link Transform} carries the SOURCE box the pixels were lifted from
 * (`x/y/w/h`, canvas pixels, never changed for the life of the session) plus
 * what has been done to them since: `dx/dy` moves the box's CENTRE, `sx/sy`
 * scale about that centre and `rot` rotates about it. Keeping the source box
 * immutable is what makes every operation idempotent in the pointer: each drag
 * frame recomputes the answer from the pointer's current position rather than
 * accumulating deltas, so a dropped frame or a fast flick cannot drift.
 *
 * The buffer's own coordinates are LOCAL — `(0,0)` to `(w,h)` — so the matrix
 * below is exactly what `ctx.setTransform` wants before `drawImage(buffer,0,0)`,
 * and the same matrix does duty for the preview pass, the commit, the handle
 * positions and the hit tests. One matrix, four consumers, no chance of the
 * chrome disagreeing with the pixels.
 *
 * ## The anchor rule
 *
 * Dragging a corner scales, and the OPPOSITE corner must not move — that is the
 * one property a person actually feels. It is not free: changing `sx` about the
 * centre moves both corners. So {@link scaleFromHandle} computes the anchor's
 * canvas position first, derives the new scale from the pointer measured in the
 * box's own rotated frame, and then recomputes `dx/dy` so the anchor lands back
 * where it started. Because the anchor is recovered from the live transform each
 * frame and the invariant holds, the drag is self-correcting rather than
 * cumulative.
 */

import type { Point } from "./canvas";

/** A rectangle in canvas pixels — the region a session was lifted from. */
export interface TransformBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A floating buffer's placement: where it came from, and what has happened to it. */
export interface Transform {
  /** The source box, fixed for the life of the session. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** How far the box's centre has moved from where it was lifted. */
  readonly dx: number;
  readonly dy: number;
  /** Scale about the centre. Negative is a flip, which Photoshop allows. */
  readonly sx: number;
  readonly sy: number;
  /** Rotation about the centre, radians, clockwise (y is down). */
  readonly rot: number;
}

/** The eight square handles, named by compass point. */
export type ScaleHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** Everything a pointer can grab: a scale handle, or the rotation grip. */
export type HandleId = ScaleHandle | "rotate";

/** A 2D affine matrix in `ctx.setTransform` order. */
export interface Matrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

/**
 * The smallest scale a drag may reach.
 *
 * Not zero: a zero-scale matrix is singular, so {@link canvasToLocal} stops
 * having an answer and the box can never be dragged back out again. The sign is
 * kept, so dragging a corner THROUGH its anchor still flips.
 */
export const MIN_SCALE = 0.01;

/** Handle geometry, in canvas pixels. Drawn by the store's chrome pass. */
export const HANDLE_SIZE = 12;
/** How close a pointer must come to a handle to take it. */
export const HANDLE_HIT = 13;
/** How far above the top edge the rotation grip floats. */
export const GRIP_DISTANCE = 34;
/** The grip's drawn radius. */
export const GRIP_RADIUS = 7;
/** Shift-rotation snaps to this step — 15°, Photoshop's own. */
export const ROTATE_SNAP = Math.PI / 12;

export const SCALE_HANDLES: readonly ScaleHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Each handle's position in the source box, as a fraction of it. */
const UV: Record<ScaleHandle, readonly [number, number]> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5]
};

/**
 * The point a scale drag holds still — the handle's opposite number.
 *
 * An EDGE handle anchors to the opposite edge's midpoint rather than to a
 * corner, which is what keeps the other axis centred: dragging `n` must not
 * shift the box sideways.
 */
const ANCHOR_UV: Record<ScaleHandle, readonly [number, number]> = {
  nw: [1, 1],
  n: [0.5, 1],
  ne: [0, 1],
  e: [0, 0.5],
  se: [0, 0],
  s: [0.5, 0],
  sw: [1, 0],
  w: [1, 0.5]
};

const EPS = 1e-9;

/** A freshly lifted box: where it is, at rest. */
export function identityTransform(box: TransformBox): Transform {
  return { x: box.x, y: box.y, w: box.w, h: box.h, dx: 0, dy: 0, sx: 1, sy: 1, rot: 0 };
}

/** Where the box's centre sits now. */
export function transformCentre(t: Transform): Point {
  return { x: t.x + t.w / 2 + t.dx, y: t.y + t.h / 2 + t.dy };
}

/**
 * Local buffer coordinates → canvas coordinates.
 *
 * `translate(centre) · rotate · scale · translate(-w/2, -h/2)`, multiplied out.
 * Hand this straight to `ctx.setTransform` and `drawImage(buffer, 0, 0)` lands
 * the pixels exactly where the chrome says they are.
 */
export function transformMatrix(t: Transform): Matrix {
  const cos = Math.cos(t.rot);
  const sin = Math.sin(t.rot);
  const a = t.sx * cos;
  const b = t.sx * sin;
  const c = -t.sy * sin;
  const d = t.sy * cos;
  const centre = transformCentre(t);
  return {
    a,
    b,
    c,
    d,
    e: centre.x - (t.w / 2) * a - (t.h / 2) * c,
    f: centre.y - (t.w / 2) * b - (t.h / 2) * d
  };
}

/** A point of the buffer, in canvas pixels. */
export function localToCanvas(t: Transform, lx: number, ly: number): Point {
  const m = transformMatrix(t);
  return { x: m.a * lx + m.c * ly + m.e, y: m.b * lx + m.d * ly + m.f };
}

/**
 * A canvas point, back in the buffer's own coordinates.
 *
 * `null` when the matrix is singular — which {@link MIN_SCALE} exists to keep
 * from happening, but a caller that trusts an inverse without checking is one
 * `NaN` away from a box that can never be grabbed again.
 */
export function canvasToLocal(t: Transform, p: Point): Point | null {
  const m = transformMatrix(t);
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < EPS) return null;
  const px = p.x - m.e;
  const py = p.y - m.f;
  return { x: (px * m.d - py * m.c) / det, y: (py * m.a - px * m.b) / det };
}

/** The four corners, clockwise from the top-left of the SOURCE box. */
export function transformCorners(t: Transform): [Point, Point, Point, Point] {
  return [
    localToCanvas(t, 0, 0),
    localToCanvas(t, t.w, 0),
    localToCanvas(t, t.w, t.h),
    localToCanvas(t, 0, t.h)
  ];
}

/** The axis-aligned box the transformed pixels occupy. */
export function transformedBounds(t: Transform): TransformBox {
  const pts = transformCorners(t);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Where one square handle sits, in canvas pixels. */
export function handlePoint(t: Transform, id: ScaleHandle): Point {
  const [u, v] = UV[id];
  return localToCanvas(t, u * t.w, v * t.h);
}

/**
 * The rotation grip: a fixed distance beyond the top edge's midpoint.
 *
 * FIXED in canvas pixels rather than in local ones, and along the box's own
 * "up" direction: a grip expressed locally collapses into the box as the scale
 * shrinks, and the smaller the box is the more somebody wants to rotate it
 * rather than paint it.
 */
export function gripPoint(t: Transform, distance: number = GRIP_DISTANCE): Point {
  const top = localToCanvas(t, t.w / 2, 0);
  const m = transformMatrix(t);
  /* Local −y, in canvas space, normalised. A vertical flip takes it with it,
     so the grip stays on the side the top edge is actually showing. */
  const ux = -m.c;
  const uy = -m.d;
  const len = Math.hypot(ux, uy);
  if (len < EPS) return top;
  return { x: top.x + (ux / len) * distance, y: top.y + (uy / len) * distance };
}

/**
 * What a pointer is over — the grip first, then the eight handles.
 *
 * The grip wins ties because it sits outside the box where nothing else can be,
 * and because a corner handle that steals the grip's click is a rotation the
 * person cannot start at all.
 */
export function hitTestHandle(t: Transform, p: Point, radius: number = HANDLE_HIT): HandleId | null {
  const grip = gripPoint(t);
  if (Math.hypot(p.x - grip.x, p.y - grip.y) <= Math.max(radius, GRIP_RADIUS)) return "rotate";
  for (const id of SCALE_HANDLES) {
    const q = handlePoint(t, id);
    if (Math.hypot(p.x - q.x, p.y - q.y) <= radius) return id;
  }
  return null;
}

/** Is the pointer over the floating pixels themselves? */
export function containsPoint(t: Transform, p: Point): boolean {
  const l = canvasToLocal(t, p);
  if (!l) return false;
  return l.x >= 0 && l.y >= 0 && l.x <= t.w && l.y <= t.h;
}

/** Put the centre offset somewhere absolute — a body drag. */
export function movedTo(t: Transform, dx: number, dy: number): Transform {
  return { ...t, dx, dy };
}

/** Shift the centre offset — the arrow keys. */
export function nudged(t: Transform, ddx: number, ddy: number): Transform {
  return { ...t, dx: t.dx + ddx, dy: t.dy + ddy };
}

/** Keep the sign, never let the magnitude reach zero. See {@link MIN_SCALE}. */
function clampScale(s: number): number {
  if (!Number.isFinite(s) || s === 0) return MIN_SCALE;
  return Math.sign(s) * Math.max(Math.abs(s), MIN_SCALE);
}

/**
 * Scale from a handle drag, holding the opposite side still.
 *
 * The pointer is measured in the box's ROTATED frame — projected onto the local
 * x and y axes as they currently point — so a corner drag on a box turned 30°
 * follows the hand along the box's own diagonal rather than along the screen's.
 *
 * `aspect` (Shift) preserves the ratio the box has RIGHT NOW rather than the one
 * it was lifted with: a person who scaled freely and then held Shift means "keep
 * what I can see", not "go back to how it started".
 */
export function scaleFromHandle(
  t: Transform,
  handle: ScaleHandle,
  p: Point,
  aspect = false
): Transform {
  const [au, av] = ANCHOR_UV[handle];
  const [hu, hv] = UV[handle];
  const anchor = localToCanvas(t, au * t.w, av * t.h);

  const cos = Math.cos(t.rot);
  const sin = Math.sin(t.rot);
  const px = p.x - anchor.x;
  const py = p.y - anchor.y;
  /* The pointer's offset from the anchor, along the box's own axes. */
  const du = px * cos + py * sin;
  const dv = -px * sin + py * cos;

  /* How far the handle sits from its anchor in LOCAL pixels: the divisor that
     turns a distance into a scale. Zero on the axis an edge handle leaves
     alone, which is exactly the test for "do not touch this one". */
  const spanU = (hu - au) * t.w;
  const spanV = (hv - av) * t.h;

  let sx = t.sx;
  let sy = t.sy;
  const freeU = Math.abs(spanU) > EPS;
  const freeV = Math.abs(spanV) > EPS;
  if (freeU) sx = du / spanU;
  if (freeV) sy = dv / spanV;

  if (aspect && freeU && freeV) {
    const ratio = Math.abs(t.sx) > EPS ? Math.abs(t.sy) / Math.abs(t.sx) : 1;
    const reach = Math.max(Math.abs(sx), ratio > EPS ? Math.abs(sy) / ratio : 0);
    sx = (sx < 0 ? -1 : 1) * reach;
    sy = (sy < 0 ? -1 : 1) * reach * ratio;
  }

  sx = clampScale(sx);
  sy = clampScale(sy);

  /* Put the centre back where the anchor stays fixed: the anchor plus the
     (scaled, rotated) local offset from anchor to centre. */
  const lu = (0.5 - au) * t.w * sx;
  const lv = (0.5 - av) * t.h * sy;
  const cx = anchor.x + lu * cos - lv * sin;
  const cy = anchor.y + lu * sin + lv * cos;

  return { ...t, sx, sy, dx: cx - (t.x + t.w / 2), dy: cy - (t.y + t.h / 2) };
}

/**
 * Rotate so the grip points at the pointer.
 *
 * The grip's rest position is straight UP from the centre, so the pointer's
 * angle plus a quarter turn is the rotation — no grab offset is remembered,
 * which is what makes the grip snap to the hand on the first frame instead of
 * preserving whatever slack the click had.
 */
export function rotateToward(t: Transform, p: Point, snap = false): Transform {
  const c = transformCentre(t);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  if (Math.hypot(dx, dy) < EPS) return t;
  let rot = Math.atan2(dy, dx) + Math.PI / 2;
  if (snap) rot = Math.round(rot / ROTATE_SNAP) * ROTATE_SNAP;
  return { ...t, rot };
}

/**
 * The tight box around everything that is not fully transparent.
 *
 * What the move tool lifts when there is no selection: "the whole layer" would
 * be a 1600×1000 float whose handles are all off the edge of the visible canvas,
 * so a person could move the pixels but never scale or rotate them.
 *
 * A row-at-a-time walk over the alpha channel — one pass, once per lift.
 */
export function opaqueBounds(
  px: Uint8ClampedArray,
  width: number,
  height: number
): TransformBox | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (!px[(row + x) * 4 + 3]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
