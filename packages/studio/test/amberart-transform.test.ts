/**
 * @file AmberArt's transform maths — `axf-amberart-photoshop` P3.
 *
 * Free transform is geometry nobody can check by looking. A rotation a quarter
 * turn out is obvious; a corner drag whose anchor creeps two pixels per frame,
 * a Shift-constrained scale that preserves the wrong ratio, or a hit test that
 * misses the handles once the box is turned all present the same way — "the
 * transform feels wrong" — and none of them is reproducible from a bug report.
 *
 * So `transform.ts` holds no canvas, no store and no React, and everything below
 * runs on numbers. The properties tested are the ones a person actually feels:
 *
 *   - the matrix and its inverse agree (a box you can grab is a box you can drop);
 *   - a corner drag holds the OPPOSITE corner still, which is the whole of what
 *     "scale from a handle" means;
 *   - Shift preserves the ratio the box has now, not the one it was lifted with;
 *   - an edge handle leaves the other axis completely alone;
 *   - the grip points at the pointer, and snaps to 15° with Shift.
 *
 * Pure — no DOM, no store, no React.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  GRIP_DISTANCE,
  MIN_SCALE,
  ROTATE_SNAP,
  SCALE_HANDLES,
  canvasToLocal,
  containsPoint,
  gripPoint,
  handlePoint,
  hitTestHandle,
  identityTransform,
  localToCanvas,
  movedTo,
  nudged,
  opaqueBounds,
  rotateToward,
  scaleFromHandle,
  transformCentre,
  transformCorners,
  transformMatrix,
  transformedBounds
} from "../src/modules/amberart/transform";
import type { Transform } from "../src/modules/amberart/transform";

const BOX = { x: 100, y: 50, w: 200, h: 100 };
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;

const close = (actual: number, expected: number, what: string, eps = 1e-6): void => {
  assert.ok(near(actual, expected, eps), `${what}: expected ${expected}, got ${actual}`);
};

const closePoint = (
  actual: { x: number; y: number },
  expected: { x: number; y: number },
  what: string,
  eps = 1e-6
): void => {
  close(actual.x, expected.x, `${what}.x`, eps);
  close(actual.y, expected.y, `${what}.y`, eps);
};

/* --------------------------------------------------------------- identity */

test("a freshly lifted box sits exactly where it was lifted from", () => {
  const t = identityTransform(BOX);

  closePoint(localToCanvas(t, 0, 0), { x: 100, y: 50 }, "top-left");
  closePoint(localToCanvas(t, BOX.w, BOX.h), { x: 300, y: 150 }, "bottom-right");
  closePoint(transformCentre(t), { x: 200, y: 100 }, "centre");
  assert.deepEqual(transformedBounds(t), BOX);

  /* The identity matrix, or the first `drawImage` of every session is wrong.
     Component by component rather than `deepEqual`, because `-sy * sin(0)` is
     negative zero and `Object.is(-0, 0)` is false — a difference no canvas has
     ever been able to tell apart. */
  const m = transformMatrix(t);
  close(m.a, 1, "a");
  close(m.b, 0, "b");
  close(m.c, 0, "c");
  close(m.d, 1, "d");
  close(m.e, 100, "e");
  close(m.f, 50, "f");
});

test("the matrix and its inverse agree, rotated and scaled and moved", () => {
  const t: Transform = { ...identityTransform(BOX), dx: 40, dy: -25, sx: 1.7, sy: 0.6, rot: 0.9 };

  for (const [lx, ly] of [
    [0, 0],
    [BOX.w, 0],
    [BOX.w, BOX.h],
    [37, 91]
  ] as const) {
    const back = canvasToLocal(t, localToCanvas(t, lx, ly));
    assert.ok(back, "a non-degenerate transform must be invertible");
    closePoint(back, { x: lx, y: ly }, `round trip of ${lx},${ly}`, 1e-9);
  }
});

test("a quarter turn puts the box's local +x pointing straight down", () => {
  const t: Transform = { ...identityTransform(BOX), rot: Math.PI / 2 };
  const centre = transformCentre(t);
  const [tl, tr] = transformCorners(t);

  /* Rotating 90° clockwise about the centre: the top edge ends up on the right,
     so the top-left corner lands where the top-right of a portrait box would. */
  closePoint(tl, { x: centre.x + BOX.h / 2, y: centre.y - BOX.w / 2 }, "top-left", 1e-9);
  closePoint(tr, { x: centre.x + BOX.h / 2, y: centre.y + BOX.w / 2 }, "top-right", 1e-9);

  const bounds = transformedBounds(t);
  close(bounds.w, BOX.h, "a turned box is as wide as it was tall", 1e-9);
  close(bounds.h, BOX.w, "and as tall as it was wide", 1e-9);
});

/* ------------------------------------------------------------------- move */

test("moving and nudging shift the pixels and nothing else", () => {
  const t = identityTransform(BOX);
  const moved = movedTo(t, 30, -12);

  closePoint(localToCanvas(moved, 0, 0), { x: 130, y: 38 }, "moved top-left");
  assert.equal(moved.sx, 1);
  assert.equal(moved.rot, 0);
  assert.equal(moved.x, BOX.x, "the SOURCE box never moves — it is where the pixels came from");

  /* Ten arrow presses and one Shift-press must land in the same place, or the
     nudge is accumulating something it should not be. */
  let stepped = t;
  for (let i = 0; i < 10; i++) stepped = nudged(stepped, 1, 0);
  assert.deepEqual(stepped, nudged(t, 10, 0));
});

/* ------------------------------------------------------------------ scale */

test("dragging a corner scales, and holds the opposite corner still", () => {
  const t = identityTransform(BOX);
  const before = handlePoint(t, "nw");

  /* Drag `se` to twice its distance from `nw`. */
  const next = scaleFromHandle(t, "se", { x: 500, y: 250 });

  close(next.sx, 2, "sx");
  close(next.sy, 2, "sy");
  closePoint(handlePoint(next, "nw"), before, "the anchored corner");
  closePoint(handlePoint(next, "se"), { x: 500, y: 250 }, "the dragged corner follows the pointer");
});

test("every handle holds its own anchor still, on a rotated and scaled box", () => {
  const t: Transform = { ...identityTransform(BOX), dx: -18, dy: 44, sx: 1.4, sy: 0.8, rot: 0.6 };
  const opposite = {
    nw: "se",
    n: "s",
    ne: "sw",
    e: "w",
    se: "nw",
    s: "n",
    sw: "ne",
    w: "e"
  } as const;

  for (const handle of SCALE_HANDLES) {
    const anchorBefore = handlePoint(t, opposite[handle]);
    const dragged = scaleFromHandle(t, handle, { x: 640, y: 320 });
    closePoint(handlePoint(dragged, opposite[handle]), anchorBefore, `${handle} anchor`, 1e-6);
    /* Rotation is a property of the box, not of the drag. */
    close(dragged.rot, t.rot, `${handle} rotation`);
  }
});

test("an edge handle scales one axis and leaves the other untouched", () => {
  const t = identityTransform(BOX);

  const east = scaleFromHandle(t, "e", { x: 500, y: 999 });
  close(east.sx, 2, "e scales x");
  close(east.sy, 1, "e leaves y alone — even though the pointer moved a long way down");

  const north = scaleFromHandle(t, "n", { x: -999, y: 100 });
  close(north.sx, 1, "n leaves x alone");
  close(north.sy, 0.5, "n scales y");
});

test("Shift constrains a corner drag to the ratio the box has right now", () => {
  const t = identityTransform(BOX);
  /* The pointer describes sx=2, sy=0.5; constrained, the larger reach wins and
     the ratio stays 1:1 — the box's current one. */
  const free = scaleFromHandle(t, "se", { x: 500, y: 100 });
  close(free.sx, 2, "unconstrained sx");
  close(free.sy, 0.5, "unconstrained sy");

  const locked = scaleFromHandle(t, "se", { x: 500, y: 100 }, true);
  close(locked.sx, 2, "constrained sx takes the larger reach");
  close(locked.sy, 2, "constrained sy follows it");

  /* "The ratio it has now", not "the ratio it was lifted with": a box already
     squashed to half height keeps being half height under Shift. */
  const squashed: Transform = { ...t, sx: 1, sy: 0.5 };
  const held = scaleFromHandle(squashed, "se", { x: 500, y: 100 }, true);
  close(held.sy / held.sx, 0.5, "the live ratio survives");
});

test("dragging a corner through its anchor flips rather than collapsing", () => {
  const t = identityTransform(BOX);
  const flipped = scaleFromHandle(t, "se", { x: 100 - 200, y: 50 - 100 });

  close(flipped.sx, -1, "sx flips");
  close(flipped.sy, -1, "sy flips");
  closePoint(handlePoint(flipped, "nw"), { x: 100, y: 50 }, "the anchor still holds");
});

test("a scale can never reach zero, in either direction", () => {
  const t = identityTransform(BOX);
  const anchor = handlePoint(t, "nw");

  const pinched = scaleFromHandle(t, "se", anchor);
  assert.ok(Math.abs(pinched.sx) >= MIN_SCALE, `sx collapsed to ${pinched.sx}`);
  assert.ok(Math.abs(pinched.sy) >= MIN_SCALE, `sy collapsed to ${pinched.sy}`);
  /* Still invertible, which is the point of the clamp: a box with a singular
     matrix can be drawn but never grabbed again. */
  assert.ok(canvasToLocal(pinched, { x: 120, y: 60 }), "a pinched box is still invertible");
});

/* --------------------------------------------------------------- rotation */

test("the grip follows the pointer's angle about the centre", () => {
  const t = identityTransform(BOX);
  const c = transformCentre(t);

  close(rotateToward(t, { x: c.x, y: c.y - 100 }).rot, 0, "straight up is at rest");
  close(rotateToward(t, { x: c.x + 100, y: c.y }).rot, Math.PI / 2, "to the right is a quarter turn");
  close(rotateToward(t, { x: c.x, y: c.y + 100 }).rot, Math.PI, "below is a half turn");

  /* Scale and position are the drag's business, not the rotation's. */
  const turned = rotateToward({ ...t, sx: 1.5, dx: 20 }, { x: c.x + 100, y: c.y });
  close(turned.sx, 1.5, "scale survives a rotation");
  close(turned.dx, 20, "so does the offset");
});

test("Shift snaps the rotation to 15 degrees", () => {
  const t = identityTransform(BOX);
  const c = transformCentre(t);
  /* 20° from rest — nearer 15 than 30. */
  const angle = -Math.PI / 2 + (20 * Math.PI) / 180;
  const p = { x: c.x + Math.cos(angle) * 90, y: c.y + Math.sin(angle) * 90 };

  close(rotateToward(t, p).rot, (20 * Math.PI) / 180, "free rotation is exact");
  close(rotateToward(t, p, true).rot, ROTATE_SNAP, "snapped rotation lands on 15°");
});

test("a pointer sitting on the centre leaves the rotation alone", () => {
  const t: Transform = { ...identityTransform(BOX), rot: 0.7 };
  assert.deepEqual(rotateToward(t, transformCentre(t)), t);
});

/* ------------------------------------------------------------- hit tests */

test("the handles and the grip are findable, and the middle of the box is not", () => {
  const t = identityTransform(BOX);

  for (const handle of SCALE_HANDLES) {
    assert.equal(hitTestHandle(t, handlePoint(t, handle)), handle, `${handle} under the pointer`);
  }
  assert.equal(hitTestHandle(t, gripPoint(t)), "rotate");
  assert.equal(hitTestHandle(t, transformCentre(t)), null, "the body is not a handle");

  /* The grip floats a fixed distance beyond the top edge, whatever the scale —
     a grip expressed in local pixels would disappear inside a shrunken box. */
  const tiny: Transform = { ...t, sx: 0.05, sy: 0.05 };
  const top = localToCanvas(tiny, tiny.w / 2, 0);
  const grip = gripPoint(tiny);
  close(Math.hypot(grip.x - top.x, grip.y - top.y), GRIP_DISTANCE, "grip distance");
});

test("the grip wins a tie with a handle, because nothing else can be out there", () => {
  /* A box scaled small enough that the grip overlaps the top-left handle's
     radius. The grip must still be reachable, or it cannot be rotated at all. */
  const t: Transform = { ...identityTransform({ x: 0, y: 0, w: 8, h: 8 }), sx: 0.5, sy: 0.5 };
  assert.equal(hitTestHandle(t, gripPoint(t)), "rotate");
});

test("containsPoint follows the box when it turns", () => {
  const t: Transform = { ...identityTransform(BOX), rot: Math.PI / 4 };
  const c = transformCentre(t);

  assert.equal(containsPoint(t, c), true, "the centre is always inside");
  /* A corner of the UNROTATED box is outside the rotated one — the case a
     bounding-box test would get wrong, and the reason this is a real inverse. */
  assert.equal(containsPoint(t, { x: BOX.x + 2, y: BOX.y + 2 }), false);
  assert.equal(containsPoint(t, { x: c.x, y: c.y - 400 }), false, "far above is outside");
});

/* ------------------------------------------------------- opaque bounds */

test("the tight box around the pixels is what a bare move lifts", () => {
  const w = 8;
  const h = 8;
  const px = new Uint8ClampedArray(w * h * 4);
  const set = (x: number, y: number, a: number): void => {
    px[(y * w + x) * 4 + 3] = a;
  };
  set(2, 1, 255);
  set(5, 4, 255);
  /* A barely-visible pixel is still a pixel: alpha 1 counts, or a soft brush
     edge would be cropped off the float and left behind on the layer. */
  set(6, 6, 1);

  assert.deepEqual(opaqueBounds(px, w, h), { x: 2, y: 1, w: 5, h: 6 });
});

test("an empty layer has no bounds, so the move tool has nothing to lift", () => {
  assert.equal(opaqueBounds(new Uint8ClampedArray(8 * 8 * 4), 8, 8), null);
});

test("a single pixel is a 1×1 box, not a zero-sized one", () => {
  const px = new Uint8ClampedArray(4 * 4 * 4);
  px[(2 * 4 + 3) * 4 + 3] = 255;
  assert.deepEqual(opaqueBounds(px, 4, 4), { x: 3, y: 2, w: 1, h: 1 });
});
