/**
 * @file AmberArt's selection maths — `axf-amberart-photoshop` P2.
 *
 * The selection engine is where the module's bugs would be invisible: a mask is
 * an offscreen canvas nobody ever looks at directly, so a scanline that misses
 * the last row, an inverted mask that keeps a stale byte, or a wand whose
 * tolerance is off by one channel all present as "the brush painted slightly
 * the wrong shape" — a symptom nobody reports precisely enough to find.
 *
 * That is the whole reason `selection.ts` splits into a pure data half over
 * {@link MaskData} and a canvas half that wraps it. Node has no `<canvas>`, so
 * anything expressed in terms of one is untestable here; everything below runs
 * against plain `Uint8Array` coverage on an 8×8, small enough that the expected
 * answer can be written out by hand and read.
 *
 * Pure — no DOM, no store, no React.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  SELECTED,
  invertMaskData,
  maskBoundsFrom,
  maskedResult,
  polygonMaskData,
  rectMaskData,
  traceMaskContours,
  wandMaskData
} from "../src/modules/amberart/selection";
import type { MaskData } from "../src/modules/amberart/selection";

const W = 8;
const H = 8;

/** The mask as eight rows of `#`/`.`, which is how a human checks one. */
const render = (m: MaskData): string[] => {
  const rows: string[] = [];
  for (let y = 0; y < m.height; y++) {
    let row = "";
    for (let x = 0; x < m.width; x++) row += m.a[y * m.width + x]! >= SELECTED ? "#" : ".";
    rows.push(row);
  }
  return rows;
};

const count = (m: MaskData): number => m.a.reduce((n, v) => n + (v >= SELECTED ? 1 : 0), 0);

/** An 8×8 RGBA buffer painted by a function of (x, y). */
function pixels(paint: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4;
      const [r, g, b, a] = paint(x, y);
      px[p] = r;
      px[p + 1] = g;
      px[p + 2] = b;
      px[p + 3] = a;
    }
  }
  return px;
}

/* ------------------------------------------------------------- rectangle */

test("rectMask covers exactly the dragged box, and its bounds report it", () => {
  const m = rectMaskData({ x: 2, y: 1, w: 3, h: 4 }, W, H);

  assert.deepEqual(render(m), [
    "........",
    "..###...",
    "..###...",
    "..###...",
    "..###...",
    "........",
    "........",
    "........"
  ]);
  assert.equal(count(m), 12);
  assert.deepEqual(maskBoundsFrom(m), { x: 2, y: 1, w: 3, h: 4 });
});

test("a marquee dragged up and to the left normalises rather than vanishing", () => {
  const backwards = rectMaskData({ x: 5, y: 5, w: -3, h: -4 }, W, H);
  const forwards = rectMaskData({ x: 2, y: 1, w: 3, h: 4 }, W, H);
  assert.deepEqual(render(backwards), render(forwards));
});

test("a rectangle is clipped to the canvas, never wrapped onto the next row", () => {
  const m = rectMaskData({ x: 6, y: 6, w: 40, h: 40 }, W, H);
  assert.deepEqual(maskBoundsFrom(m), { x: 6, y: 6, w: 2, h: 2 });
  assert.equal(count(m), 4);
});

test("an empty drag selects nothing, and nothing has no bounds", () => {
  const m = rectMaskData({ x: 3, y: 3, w: 0, h: 0 }, W, H);
  assert.equal(count(m), 0);
  assert.equal(maskBoundsFrom(m), null);
});

/* ---------------------------------------------------------------- invert */

test("invert selects the complement, exactly once", () => {
  const m = rectMaskData({ x: 2, y: 1, w: 3, h: 4 }, W, H);
  const inv = invertMaskData(m);

  assert.equal(count(inv), W * H - count(m));
  assert.deepEqual(render(inv), [
    "########",
    "##...###",
    "##...###",
    "##...###",
    "##...###",
    "########",
    "########",
    "########"
  ]);
  /* Inverting twice is the identity — the property that catches a 255/254
     off-by-one or an in-place write that mutated the source. */
  assert.deepEqual(render(invertMaskData(inv)), render(m));
  assert.deepEqual(render(m), render(rectMaskData({ x: 2, y: 1, w: 3, h: 4 }, W, H)));
});

/* ----------------------------------------------------------------- lasso */

test("a polygon fills its interior and closes itself", () => {
  /* A triangle the caller did NOT close — the lasso releases wherever the hand
     stops, and the mask has to join the last point back to the first. */
  const m = polygonMaskData(
    [
      { x: 1, y: 1 },
      { x: 7, y: 1 },
      { x: 1, y: 7 }
    ],
    W,
    H
  );
  const rows = render(m);

  assert.equal(rows[0], "........", "nothing above the top edge");
  assert.ok(count(m) > 12, `a 6×6 triangle should cover roughly 18 pixels, got ${count(m)}`);
  /* The hypotenuse runs top-right to bottom-left, so each row is shorter than
     the one above it. That ordering is the shape; a scanline bug breaks it. */
  const widths = rows.map((r) => (r.match(/#/g) ?? []).length).filter((n) => n > 0);
  for (let i = 1; i < widths.length; i++) {
    assert.ok(widths[i]! <= widths[i - 1]!, `row ${i} is wider than the one above: ${widths.join(",")}`);
  }
});

test("a degenerate lasso — two points — selects nothing rather than a line", () => {
  const m = polygonMaskData([{ x: 1, y: 1 }, { x: 6, y: 6 }], W, H);
  assert.equal(count(m), 0);
});

/* ------------------------------------------------------------ magic wand */

test("the wand with zero tolerance takes only the exact colour, and only what is connected", () => {
  /* Two separate red blocks and a red-ish one, on a black field:
       (1,1)-(2,2)  pure red      ← clicked
       (5,5)-(6,6)  pure red      ← same colour, NOT touching
       (1,5)        red + 20      ← touching nothing, within tolerance 20 */
  const px = pixels((x, y) => {
    if (x >= 1 && x <= 2 && y >= 1 && y <= 2) return [255, 0, 0, 255];
    if (x >= 5 && x <= 6 && y >= 5 && y <= 6) return [255, 0, 0, 255];
    return [0, 0, 0, 255];
  });

  const m = wandMaskData(px, W, H, 1, 1, 0);
  assert.equal(count(m), 4, "only the connected block, not the identical one across the canvas");
  assert.deepEqual(maskBoundsFrom(m), { x: 1, y: 1, w: 2, h: 2 });
});

test("tolerance widens the wand one channel-difference at a time", () => {
  /* A vertical ramp: each row is 10 greyscale steps lighter than the last, so
     a tolerance of N reaches exactly floor(N/10) rows either side of the one
     clicked. That makes the expected count arithmetic rather than a guess. */
  const px = pixels((_x, y) => [y * 10, y * 10, y * 10, 255]);

  assert.equal(count(wandMaskData(px, W, H, 0, 3, 0)), W, "tolerance 0 takes the clicked row only");
  assert.equal(count(wandMaskData(px, W, H, 0, 3, 9)), W, "9 is short of the next row's 10");
  assert.equal(count(wandMaskData(px, W, H, 0, 3, 10)), W * 3, "10 reaches one row either side");
  assert.equal(count(wandMaskData(px, W, H, 0, 3, 25)), W * 5, "25 reaches two rows either side");
  assert.equal(count(wandMaskData(px, W, H, 0, 3, 255)), W * H, "255 takes the whole layer");
});

test("the wand sees the alpha channel — transparent is a colour", () => {
  /* Erased pixels and black pixels have identical RGB in most buffers; if the
     distance ignored alpha, clicking the hole would select the whole canvas. */
  const px = pixels((x) => (x < 4 ? [0, 0, 0, 0] : [0, 0, 0, 255]));

  assert.equal(count(wandMaskData(px, W, H, 0, 0, 0)), W * H / 2);
  assert.equal(count(wandMaskData(px, W, H, 7, 0, 0)), W * H / 2);
  assert.equal(count(wandMaskData(px, W, H, 0, 0, 255)), W * H);
});

test("a wand click outside the canvas selects nothing instead of throwing", () => {
  const px = pixels(() => [255, 0, 0, 255]);
  assert.equal(count(wandMaskData(px, W, H, -1, 4, 255)), 0);
  assert.equal(count(wandMaskData(px, W, H, 4, 99, 255)), 0);
});

/* --------------------------------------------------------- masked result */

test("a fill's result is kept inside the mask and rolled back outside it", () => {
  const m = rectMaskData({ x: 0, y: 0, w: 4, h: H }, W, H);
  const before = { data: pixels(() => [0, 0, 0, 255]), width: W, height: H };
  const after = { data: pixels(() => [255, 122, 26, 255]), width: W, height: H };

  const out = maskedResult(before, after, m);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * 4;
      assert.equal(out[p], x < 4 ? 255 : 0, `pixel ${x},${y}`);
    }
  }
  /* The inputs are read, never written — the caller still holds `after` and
     puts the returned bytes back into it. */
  assert.equal(after.data[0], 255);
  assert.equal(before.data[0], 0);
});

/* -------------------------------------------------------------- contours */

test("a rectangle's outline traces as one loop of four corners", () => {
  const loops = traceMaskContours(rectMaskData({ x: 2, y: 1, w: 3, h: 4 }, W, H));

  assert.equal(loops.length, 1);
  /* Collinear points collapse — the ants need four corners, not fourteen edge
     midpoints, or the dash phase restarts often enough to look like a line. */
  assert.equal(loops[0]!.length, 4);
  const xs = loops[0]!.map((p) => p.x).sort((a, b) => a - b);
  const ys = loops[0]!.map((p) => p.y).sort((a, b) => a - b);
  assert.deepEqual(xs, [2, 2, 5, 5], "the right edge is at x+w on the corner lattice");
  assert.deepEqual(ys, [1, 1, 5, 5]);
});

test("two disjoint regions trace as two loops, and an empty mask as none", () => {
  const a = rectMaskData({ x: 0, y: 0, w: 2, h: 2 }, W, H);
  const b = rectMaskData({ x: 5, y: 5, w: 2, h: 2 }, W, H);
  const both: MaskData = { width: W, height: H, a: a.a.map((v, i) => Math.max(v, b.a[i]!)) };

  assert.equal(traceMaskContours(both).length, 2);
  assert.equal(traceMaskContours({ width: W, height: H, a: new Uint8Array(W * H) }).length, 0);
});

test("a hole inside a region traces its own loop", () => {
  /* Select-all then subtract a block — the shape the Invert command makes, and
     the case where a tracer that only follows outer boundaries loses the hole
     and draws ants around the whole canvas instead. */
  const outer = rectMaskData({ x: 0, y: 0, w: W, h: H }, W, H);
  const hole = rectMaskData({ x: 3, y: 3, w: 2, h: 2 }, W, H);
  const m: MaskData = { width: W, height: H, a: outer.a.map((v, i) => (hole.a[i] ? 0 : v)) };

  assert.equal(traceMaskContours(m).length, 2, "one loop for the canvas edge, one for the hole");
});
