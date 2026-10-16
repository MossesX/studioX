/**
 * @file AmberArt's procedural textures — `axf-amberart-photoshop` P5.
 *
 * Two properties, and a texture that has neither is worthless in a different
 * way each time:
 *
 *   - **Deterministic.** A generator that answers differently on the second
 *     call gives a thumbnail that is not the fill it previews, and a fill that
 *     changes when a re-render happens to rebuild the tile. The failure is a
 *     picker whose buttons stop meaning anything.
 *   - **Tileable.** `createPattern(tile, "repeat")` butts the tile against
 *     itself, so a discontinuity at the edge becomes a grid of seams across the
 *     whole canvas. Nobody reports that as "the noise field is not periodic";
 *     they report it as "the texture looks like a grid", and only after
 *     shipping it.
 *
 * Both are checkable because `textures.ts` is a FIELD first and a canvas
 * second: `textureField` is `(x, y) → coverage`, pure arithmetic, and "it
 * tiles" is the statement `f(x, y) === f(x + tile, y)`. That is an exact
 * equality rather than a tolerance, and the file's header explains what makes
 * it exact — lattice coordinates computed as `x * cells / tile` and sine phases
 * wrapped before they are scaled. If either rule is broken later, the equality
 * below is where it shows up.
 *
 * Pure — no DOM, no store, no React. The canvas half (`textureTile`,
 * `tintTile`) is not reachable from Node and is deliberately not asserted here;
 * it is a `putImageData` of exactly the bytes this file does check.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TEXTURE_PARAMS,
  TEXTURE_PATTERNS,
  TEXTURE_TILE,
  textureField,
  textureSeed,
  textureTileData
} from "../src/modules/amberart/textures";
import type { TextureKind } from "../src/modules/amberart/textures";

const KINDS: readonly TextureKind[] = TEXTURE_PATTERNS.map((p) => p.id);

/** A spread of sample points that is not a multiple of any generator's pitch. */
const SAMPLES: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 1],
  [7, 3],
  [13, 91],
  [31, 32],
  [64, 65],
  [117, 200],
  [128, 128],
  [199, 41],
  [255, 255]
];

test("all eight generators are declared, once each", () => {
  assert.equal(KINDS.length, 8);
  assert.equal(new Set(KINDS).size, 8);
});

test("a generator is deterministic for a fixed seed", () => {
  /* Marble and halftone: the two that could not be more different in how they
     could go non-deterministic. Marble runs five octaves of value noise through
     a per-octave seed stream, so an fbm that consumed its PRNG in a
     render-order-dependent way would diverge here; halftone is pure lattice
     geometry, so it stands for the generators that have no noise in them at
     all and would only diverge if the params were being mutated. */
  for (const kind of ["marble", "halftone"] as const) {
    const a = textureTileData(kind, DEFAULT_TEXTURE_PARAMS, 1234);
    const b = textureTileData(kind, DEFAULT_TEXTURE_PARAMS, 1234);
    assert.equal(a.width, TEXTURE_TILE);
    assert.deepEqual(a.data, b.data, `${kind} is not deterministic`);
  }
});

test("the seed reaches the noise generators, and the geometric ones ignore it", () => {
  /* Determinism alone is satisfied by a generator that never reads its seed at
     all, so the equality above needs this beside it to mean anything. The split
     is a design statement rather than an accident: `grain`, `fibre`, `weave`
     and `marble` are built from hashed lattices and MUST move with the seed,
     while `halftone`, `stripes`, `checker` and `hatch` are pure geometry — a
     checker with a random element is a checker with a bug. */
  for (const kind of ["grain", "fibre", "weave", "marble"] as const) {
    const a = textureTileData(kind, DEFAULT_TEXTURE_PARAMS, 1234);
    const b = textureTileData(kind, DEFAULT_TEXTURE_PARAMS, 4321);
    assert.notDeepEqual(a.data, b.data, `${kind} ignores its seed`);
  }
  for (const kind of ["halftone", "stripes", "checker", "hatch"] as const) {
    const a = textureTileData(kind, DEFAULT_TEXTURE_PARAMS, 1234);
    const b = textureTileData(kind, DEFAULT_TEXTURE_PARAMS, 4321);
    assert.deepEqual(a.data, b.data, `${kind} has picked up a random element`);
  }
});

test("every generator's field is periodic on the tile — the tiles tile", () => {
  const tile = DEFAULT_TEXTURE_PARAMS.tile;
  for (const kind of KINDS) {
    const f = textureField(kind, DEFAULT_TEXTURE_PARAMS, textureSeed(kind));
    for (const [x, y] of SAMPLES) {
      assert.equal(f(x + tile, y), f(x, y), `${kind} does not wrap in x at ${x},${y}`);
      assert.equal(f(x, y + tile), f(x, y), `${kind} does not wrap in y at ${x},${y}`);
      assert.equal(f(x - tile, y - tile), f(x, y), `${kind} does not wrap backwards at ${x},${y}`);
    }
  }
});

test("the rasterised tile's edges meet its opposite edges", () => {
  /* The property the field test proves, restated in BYTES — because what
     `createPattern` butts together is the tile, not the field, and a
     rasteriser that sampled at pixel CENTRES (x + 0.5) would satisfy the field
     test and still leave a seam. Column 0 must be what column `tile` would
     have been, and the same down the rows. */
  const tile = DEFAULT_TEXTURE_PARAMS.tile;
  for (const kind of KINDS) {
    const data = textureTileData(kind, DEFAULT_TEXTURE_PARAMS, textureSeed(kind));
    const f = textureField(kind, DEFAULT_TEXTURE_PARAMS, textureSeed(kind));
    const alphaAt = (x: number, y: number): number => data.data[(y * data.width + x) * 4 + 3]!;
    const expected = (v: number): number => Math.round(255 * Math.max(0, Math.min(1, v)));

    for (let i = 0; i < data.width; i += 7) {
      assert.equal(alphaAt(0, i), expected(f(tile, i)), `${kind}: the left edge does not follow the right`);
      assert.equal(alphaAt(i, 0), expected(f(i, tile)), `${kind}: the top edge does not follow the bottom`);
    }
  }
});

test("the periodic patterns repeat at their own pitch, not just at the tile", () => {
  /* Checker and stripes promise more than tiling: they promise a PITCH, and a
     pitch that did not divide the tile would give a tile that wraps (the field
     test would pass) while the last cell before the seam was the wrong width.
     Both are eight periods across, so a row must equal the row one pitch down
     and a column the column one pitch across. Only these two are asserted: the
     weave, the halftone and the hatch carry a per-pixel grain term on purpose,
     which is periodic on the TILE and not on the pitch. */
  const tile = DEFAULT_TEXTURE_PARAMS.tile;
  const pitch = tile / 8;
  for (const kind of ["checker", "stripes"] as const) {
    const f = textureField(kind, DEFAULT_TEXTURE_PARAMS, textureSeed(kind));
    for (const [x, y] of SAMPLES) {
      assert.equal(f(x + pitch, y + pitch), f(x, y), `${kind} is not periodic at its pitch`);
    }
  }
});

test("density and contrast move every generator in the same direction", () => {
  /* The two knobs live in one place (`shape`) rather than inside the eight
     fields, so that they mean the same thing everywhere. This is that claim:
     more density is never less ink, whatever the pattern. */
  for (const kind of KINDS) {
    const lean = textureField(kind, { ...DEFAULT_TEXTURE_PARAMS, density: 0.15 }, textureSeed(kind));
    const heavy = textureField(kind, { ...DEFAULT_TEXTURE_PARAMS, density: 1 }, textureSeed(kind));
    let leanSum = 0;
    let heavySum = 0;
    for (const [x, y] of SAMPLES) {
      leanSum += lean(x, y);
      heavySum += heavy(x, y);
      assert.ok(lean(x, y) <= heavy(x, y) + 1e-9, `${kind}: more density gave less coverage`);
    }
    assert.ok(heavySum > leanSum, `${kind}: density does nothing at all`);
  }
});

test("coverage stays inside [0, 1], so the rasteriser cannot clamp a pattern flat", () => {
  for (const kind of KINDS) {
    const f = textureField(kind, DEFAULT_TEXTURE_PARAMS, textureSeed(kind));
    for (let y = 0; y < TEXTURE_TILE; y += 13) {
      for (let x = 0; x < TEXTURE_TILE; x += 11) {
        const v = f(x, y);
        assert.ok(Number.isFinite(v), `${kind} produced ${v} at ${x},${y}`);
        assert.ok(v >= 0 && v <= 1, `${kind} produced ${v} at ${x},${y}`);
      }
    }
  }
});
