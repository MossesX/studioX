/**
 * @file AmberArt's filters — `axf-amberart-photoshop` P7.
 *
 * Pure maths, so it is driven straight from Node with no DOM: `filters.ts`
 * takes and returns a plain `{width, height, data}` buffer, which is what a
 * real `ImageData` is. The three properties the step names are the three that
 * catch the failures a filter actually has:
 *
 *   - **`invert` is an involution.** It is the one filter whose correctness is
 *     an exact identity rather than a judgement, so it is the canary for the
 *     whole per-pixel family: the moment somebody premultiplies these (which
 *     would look right on every opaque image), applying it twice stops
 *     returning the original and this goes red.
 *   - **`grayscale` of grey is identity.** The luma weights have to sum to 1.
 *     Weights that do not are the classic silent bug — the picture greys out
 *     correctly AND drifts a little darker or lighter every time, which nobody
 *     sees until they run it twice.
 *   - **`boxBlur` preserves total luminance.** A blur moves light around; it
 *     must not create or destroy it. Every plausible blur bug — a window that
 *     is off by one, zero-padding at the edges instead of clamping,
 *     intermediate rounding between the three passes — shows up as a change in
 *     the total, and nothing else does.
 *
 * The blur tile is built with a CONSTANT MARGIN wider than the filter's
 * support (three passes of radius `r` reach `3r`), because clamp-to-edge only
 * conserves the total when the border it replicates is flat. That is a
 * property of the test image, not a fudge: a blur on a picture whose content
 * runs off the edge genuinely does change the total, and asserting otherwise
 * would be asserting the wrong thing.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  BLUR_PASSES,
  DEFAULT_FILTER_PARAMS,
  FILTERS,
  LUMA_B,
  LUMA_G,
  LUMA_R,
  boxBlur,
  grayscale,
  invert,
  noise,
  pixelate,
  previewScale,
  runFilter
} from "../src/modules/amberart/filters";
import type { FilterId } from "../src/modules/amberart/filters";
import type { PixelBuffer } from "../src/modules/amberart/selection";

/** A buffer of the given size, filled by a per-pixel function. */
function make(
  width: number,
  height: number,
  at: (x: number, y: number) => readonly [number, number, number, number]
): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      const [r, g, b, a] = at(x, y);
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = a;
    }
  }
  return { width, height, data };
}

/** A deterministic colour field with varied alpha — the general-case input. */
const MOTTLED = make(16, 12, (x, y) => [
  (x * 17 + y * 7) % 256,
  (x * 5 + y * 29) % 256,
  (x * 41 + y * 3) % 256,
  (x + y) % 2 === 0 ? 255 : (x * 13) % 256
]);

/** Every channel equal — grey, at three levels, fully opaque and not. */
const GREYS = make(16, 12, (x, y) => {
  const v = [0, 64, 128, 200, 255][(x + y) % 5]!;
  return [v, v, v, y % 3 === 0 ? 128 : 255];
});

const luma = (r: number, g: number, b: number): number => LUMA_R * r + LUMA_G * g + LUMA_B * b;

function totalLuminance(img: PixelBuffer): number {
  let sum = 0;
  for (let i = 0; i < img.width * img.height; i++) {
    const p = i * 4;
    sum += luma(img.data[p]!, img.data[p + 1]!, img.data[p + 2]!);
  }
  return sum;
}

test("invert is an involution — twice is the identity, alpha included", () => {
  const once = invert(MOTTLED);
  const twice = invert(once);
  assert.deepEqual(twice.data, MOTTLED.data);
  /* And it genuinely did something in between, or the equality above is being
     satisfied by a filter that returns its input. */
  assert.notDeepEqual(once.data, MOTTLED.data);
});

test("invert leaves alpha alone", () => {
  const once = invert(MOTTLED);
  for (let i = 0; i < MOTTLED.width * MOTTLED.height; i++) {
    assert.equal(once.data[i * 4 + 3], MOTTLED.data[i * 4 + 3]);
  }
});

test("grayscale of a grey image is the identity", () => {
  const out = grayscale(GREYS);
  assert.deepEqual(out.data, GREYS.data);
});

test("grayscale is idempotent on a colour image — running it twice moves nothing", () => {
  /* The same claim from the other side: weights that do not sum to 1 pass the
     grey test only if they are also wrong in a way that happens to fix itself,
     and they fail this one on the second pass. */
  const once = grayscale(MOTTLED);
  const twice = grayscale(once);
  assert.deepEqual(twice.data, once.data);
});

test("boxBlur preserves total luminance within epsilon", () => {
  /* A bright square inside a flat field, with a margin wider than the filter's
     support so clamp-to-edge replicates a constant. 40×40, radius 3, three
     passes → support 9; the square sits 12 pixels in from every edge. */
  const size = 40;
  const radius = 3;
  const margin = 12;
  assert.ok(margin > BLUR_PASSES * radius, "the margin must exceed the blur's support");

  const tile = make(size, size, (x, y) => {
    const inside = x >= margin && x < size - margin && y >= margin && y < size - margin;
    const v = inside ? 220 : 60;
    return [v, v, v, 255];
  });

  const before = totalLuminance(tile);
  const after = totalLuminance(boxBlur(tile, { radius }));
  /* Epsilon is rounding and nothing else: the whole pipeline runs in Float32
     and rounds once, so no pixel can be more than half a level out. */
  const epsilon = 0.5 * size * size;
  assert.ok(
    Math.abs(after - before) <= epsilon,
    `blur moved ${Math.abs(after - before).toFixed(2)} of luminance, epsilon ${epsilon}`
  );
  /* And it blurred: the bright square's own corner has to have come down. */
  const corner = (margin * size + margin) * 4;
  assert.ok(boxBlur(tile, { radius }).data[corner]! < 220);
});

test("boxBlur below its minimum radius is a copy, not a mutation of the input", () => {
  const out = boxBlur(MOTTLED, { radius: 0 });
  assert.deepEqual(out.data, MOTTLED.data);
  out.data[0] = 1;
  assert.notEqual(MOTTLED.data[0], 1);
});

test("pixelate writes one average per block, and the block is exact", () => {
  /* Four 2×2 blocks of known values on an opaque tile: the average of a block
     is arithmetic anybody can check by hand, which is the point of asserting
     it rather than asserting "it looks blocky". */
  const tile = make(4, 4, (x, y) => {
    const v = y < 2 ? (x < 2 ? 0 : 100) : x < 2 ? 200 : 255;
    return [v, v, v, 255];
  });
  const out = pixelate(tile, { block: 2 });
  const at = (x: number, y: number): number => out.data[(y * 4 + x) * 4]!;
  for (const [x, y, expected] of [
    [0, 0, 0],
    [1, 1, 0],
    [3, 0, 100],
    [0, 3, 200],
    [3, 3, 255]
  ] as const) {
    assert.equal(at(x, y), expected, `block at ${x},${y}`);
  }
});

test("noise is deterministic, so the preview is what Apply lands", () => {
  const params = { amount: 40, monochrome: true };
  assert.deepEqual(noise(MOTTLED, params).data, noise(MOTTLED, params).data);
  /* A different seed must genuinely move it, or "deterministic" is being
     satisfied by a filter that adds nothing at all. */
  assert.notDeepEqual(noise(MOTTLED, params).data, noise(MOTTLED, { ...params, seed: 7 }).data);
});

test("no filter mutates its input, and every one keeps the buffer's shape", () => {
  for (const spec of FILTERS) {
    const before = new Uint8ClampedArray(MOTTLED.data);
    const out = runFilter(spec.id, MOTTLED, DEFAULT_FILTER_PARAMS);
    assert.deepEqual(MOTTLED.data, before, `${spec.id} wrote into its source`);
    assert.equal(out.width, MOTTLED.width, `${spec.id} changed the width`);
    assert.equal(out.height, MOTTLED.height, `${spec.id} changed the height`);
    assert.equal(out.data.length, MOTTLED.data.length, `${spec.id} changed the buffer length`);
  }
});

test("runFilter dispatches every declared filter, and the ids are unique", () => {
  const ids = FILTERS.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  /* A filter in the catalogue that `runFilter` did not implement would return
     the input untouched, and the panel would offer a control that does
     nothing. Every one has to change SOMETHING at its default parameters. */
  for (const id of ids) {
    const out = runFilter(id, MOTTLED, DEFAULT_FILTER_PARAMS);
    const moves = id === "brightness-contrast" || id === "hue-saturation" ? false : true;
    if (moves) assert.notDeepEqual(out.data, MOTTLED.data, `${id} did nothing at its defaults`);
  }
  /* The two exceptions are exceptions on purpose: an adjustment's defaults are
     "no adjustment", and a Brightness/Contrast that moved the picture the
     moment it was selected would be an edit nobody asked for. */
  for (const id of ["brightness-contrast", "hue-saturation"] as const) {
    assert.deepEqual(runFilter(id, MOTTLED, DEFAULT_FILTER_PARAMS).data, MOTTLED.data);
  }
});

test("previewScale halves only what needs it, and never the pixelate", () => {
  const at = (id: FilterId, patch: Partial<typeof DEFAULT_FILTER_PARAMS> = {}): number =>
    previewScale(id, { ...DEFAULT_FILTER_PARAMS, ...patch });
  assert.equal(at("blur", { radius: 2 }), 1);
  assert.equal(at("blur", { radius: 12 }), 0.5);
  assert.equal(at("sharpen", { amount: 60 }), 0.5);
  /* The one that must never be halved: a block is in canvas pixels, so a
     half-size run scaled back up would preview blocks at twice the size that
     lands — a preview that is wrong rather than slow. */
  assert.equal(at("pixelate", { block: 64 }), 1);
  assert.equal(at("invert"), 1);
});
