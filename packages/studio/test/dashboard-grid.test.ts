/**
 * @file The dashboard's free-placement grid engine — `@axs/modules/dashboard/grid`.
 *
 * These are the cases that are miserable to check by dragging cards around in a
 * browser and easy to get subtly wrong in code: a card whose stored rectangle no
 * longer fits the column count, a resize clipping against the wrong neighbour,
 * and above all the **column rule** — a horizontal resize is allowed to shorten a
 * tall neighbour from the bottom to take its cells, and is NOT allowed to do that
 * to a neighbour it cannot shorten without deleting.
 *
 * The invariant every case asserts, one way or another: after any operation no
 * two cards overlap, and nothing has been pushed off the grid.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { CardConfig } from "@axs/modules/dashboard/types";

const {
  CARD_DEFAULT_H,
  SPAN,
  applyPlacements,
  cellMetrics,
  isColumnCard,
  moveCard,
  resizeCard,
  resolvePlacements
} = await import("@axs/modules/dashboard/grid");

type Place = { col: number; row: number; w: number; h: number };

const card = (id: string, over: Partial<CardConfig> = {}): CardConfig => ({
  id,
  enabled: true,
  order: 0,
  size: "md",
  ...over
});

/** No two rectangles may share a cell — asserted after every operation. */
function assertNoOverlap(places: Record<string, Place>, what: string): void {
  const list = Object.entries(places);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const [ai, a] = list[i];
      const [bi, b] = list[j];
      const hit =
        a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h;
      assert.equal(hit, false, `${what}: ${ai} overlaps ${bi}`);
    }
  }
}

/* -------------------------------- placement ------------------------------- */

test("a card with no stored geometry flows exactly where the old grid put it", () => {
  const cards = [
    card("a", { order: 0, size: "md" }),
    card("b", { order: 1, size: "md" }),
    card("c", { order: 2, size: "sm" })
  ];
  const p = resolvePlacements(cards, 4);
  assert.deepEqual(p.a, { col: 1, row: 1, w: SPAN.md, h: CARD_DEFAULT_H });
  assert.deepEqual(p.b, { col: 3, row: 1, w: SPAN.md, h: CARD_DEFAULT_H });
  // Row 1 is full at 4 columns, so the third card starts the next row.
  assert.deepEqual(p.c, { col: 1, row: 3, w: 1, h: CARD_DEFAULT_H });
  assertNoOverlap(p, "flow");
});

test("honourSizes off only changes the fallback — a hand-set width survives it", () => {
  const cards = [card("a", { size: "lg" }), card("b", { size: "lg", col: 2, row: 1, w: 3, h: 1 })];
  const p = resolvePlacements(cards, 4, false);
  assert.equal(p.a.w, 1, "no explicit width: falls back to one column");
  assert.equal(p.b.w, 3, "explicitly resized: keeps its width");
});

test("flowed cards fill the holes around placed ones instead of colliding", () => {
  const cards = [
    card("placed", { col: 3, row: 1, w: 2, h: 4 }),
    card("flowed", { order: 1, size: "md" })
  ];
  const p = resolvePlacements(cards, 4);
  assert.deepEqual(p.flowed, { col: 1, row: 1, w: 2, h: CARD_DEFAULT_H });
  assertNoOverlap(p, "hole filling");
});

test("a rectangle that no longer fits the column count is clamped, never dropped", () => {
  const cards = [card("wide", { col: 3, row: 1, w: 3, h: 2 })];
  const p = resolvePlacements(cards, 4);
  assert.equal(p.wide.col + p.wide.w - 1 <= 4, true, "stays inside the grid");
  assert.ok(p.wide, "still placed");
});

/* --------------------------------- resizing -------------------------------- */

test("a tile blocks a widening resize — clipped one cell short, nothing moved", () => {
  const places: Record<string, Place> = {
    a: { col: 1, row: 1, w: 1, h: 1 },
    tile: { col: 3, row: 1, w: 2, h: 1 }
  };
  const r = resizeCard("a", { col: 1, row: 1, w: 4, h: 1 }, places, 4);
  assert.equal(r.place.w, 2, "stops at the tile's left edge");
  assert.deepEqual(r.shrunk, {}, "a tile is never reshaped by somebody else's drag");
  assertNoOverlap({ ...places, a: r.place }, "blocked resize");
});

test("a column card shrinks up so a widening resize can take its cells", () => {
  // `col` spans rows 1-4 in column 3; `a` is on row 2 and grows right into it.
  const places: Record<string, Place> = {
    a: { col: 1, row: 2, w: 2, h: 1 },
    col: { col: 3, row: 1, w: 1, h: 4 }
  };
  assert.equal(isColumnCard(places.col), true, "taller than wide, 2+ rows");
  const r = resizeCard("a", { col: 1, row: 2, w: 3, h: 1 }, places, 4);
  assert.equal(r.place.w, 3, "the resize took the column's cells");
  assert.equal(r.shrunk.col, 1, "the column's bottom rose to just above row 2");
  assertNoOverlap({ ...places, a: r.place, col: { ...places.col, h: r.shrunk.col } }, "shrink up");
});

test("a column starting on the dragged card's own row blocks instead of vanishing", () => {
  const places: Record<string, Place> = {
    a: { col: 1, row: 1, w: 2, h: 1 },
    col: { col: 3, row: 1, w: 1, h: 4 }
  };
  const r = resizeCard("a", { col: 1, row: 1, w: 4, h: 1 }, places, 4);
  assert.equal(r.place.w, 2, "clipped at the column instead");
  assert.equal(r.shrunk.col, undefined, "shortening it to zero rows would be a deletion");
  assertNoOverlap({ ...places, a: r.place }, "column on the same row");
});

test("a resize never leaves the grid, and never goes below one cell", () => {
  const places: Record<string, Place> = { a: { col: 3, row: 1, w: 2, h: 2 } };
  assert.equal(resizeCard("a", { col: 3, row: 1, w: 9, h: 2 }, places, 4).place.w, 2);
  const tiny = resizeCard("a", { col: 3, row: 1, w: -4, h: -9 }, places, 4).place;
  assert.deepEqual([tiny.w, tiny.h], [1, 1]);
});

test("growing downwards clips on the card below", () => {
  const places: Record<string, Place> = {
    a: { col: 1, row: 1, w: 2, h: 1 },
    b: { col: 1, row: 3, w: 2, h: 2 }
  };
  const r = resizeCard("a", { col: 1, row: 1, w: 2, h: 6 }, places, 4);
  assert.equal(r.place.h, 2, "stops one row above b");
  assertNoOverlap({ ...places, a: r.place }, "vertical clip");
});

/* ---------------------------------- moving --------------------------------- */

test("a drop auto-resizes to the free run instead of bouncing back", () => {
  const places: Record<string, Place> = {
    a: { col: 1, row: 1, w: 3, h: 1 },
    b: { col: 3, row: 3, w: 2, h: 1 }
  };
  // Dropping the 3-wide `a` at column 1 of row 3 leaves only two free cells.
  const r = moveCard("a", 1, 3, places, 4);
  assert.deepEqual(r.place, { col: 1, row: 3, w: 2, h: 1 });
  assert.deepEqual(r.swapped, {});
  assertNoOverlap({ ...places, a: r.place }, "shrink to fit");
});

test("dropping onto an occupied cell trades rectangles", () => {
  const places: Record<string, Place> = {
    a: { col: 1, row: 1, w: 2, h: 1 },
    b: { col: 3, row: 1, w: 2, h: 1 }
  };
  const r = moveCard("a", 3, 1, places, 4);
  assert.deepEqual(r.place, { col: 3, row: 1, w: 2, h: 1 });
  assert.deepEqual(r.swapped.b, { col: 1, row: 1, w: 2, h: 1 });
  assertNoOverlap({ a: r.place, ...r.swapped }, "swap");
});

test("a swap clips against bystanders, not just against its partner", () => {
  // `wide` is two cells across; `left` is one. Dropping `wide` onto `left` would
  // put it over columns 1-2 — and `mid` is sitting in column 2.
  const places: Record<string, Place> = {
    wide: { col: 3, row: 7, w: 2, h: 2 },
    left: { col: 1, row: 7, w: 1, h: 2 },
    mid: { col: 2, row: 7, w: 1, h: 2 }
  };
  const r = moveCard("wide", 1, 7, places, 4);
  assert.equal(r.place.w, 1, "clipped to the one free column, not laid over mid");
  assertNoOverlap({ ...places, wide: r.place, ...r.swapped }, "swap with a bystander");
});

test("a stored overlap is re-flowed instead of rendered on top of itself", () => {
  const cards = [
    card("first", { order: 0, col: 1, row: 1, w: 2, h: 2 }),
    card("clash", { order: 1, col: 2, row: 1, w: 1, h: 2 })
  ];
  const p = resolvePlacements(cards, 4);
  assert.deepEqual(p.first, { col: 1, row: 1, w: 2, h: 2 }, "the earlier card keeps its place");
  assert.equal(p.clash.w, 1, "the loser keeps its size");
  assertNoOverlap(p, "healed store");
});

test("a drop is clamped to the grid, not wrapped around it", () => {
  const places: Record<string, Place> = { a: { col: 1, row: 1, w: 2, h: 1 } };
  const r = moveCard("a", 9, -3, places, 4);
  assert.equal(r.place.col <= 4, true);
  assert.equal(r.place.row >= 1, true);
});

/* ------------------------------- persistence ------------------------------- */

test("committing a layout renumbers order in reading order", () => {
  const cards = [card("a"), card("b"), card("c")];
  const places: Record<string, Place> = {
    a: { col: 1, row: 3, w: 1, h: 1 },
    b: { col: 3, row: 1, w: 1, h: 1 },
    c: { col: 1, row: 1, w: 1, h: 1 }
  };
  const out = applyPlacements(cards, places);
  const order = Object.fromEntries(out.map((c) => [c.id, c.order]));
  assert.deepEqual(order, { c: 0, b: 1, a: 2 }, "top row left-to-right, then down");
  assert.deepEqual(
    out.find((c) => c.id === "a"),
    { id: "a", enabled: true, order: 2, size: "md", col: 1, row: 3, w: 1, h: 1 }
  );
});

test("a cell step includes the gap, so one drag step is one cell", () => {
  // 4 columns over 1000px with three 12px gaps: tracks are 241px, steps 253px.
  const { cellW, cellH } = cellMetrics(1000, 4, 12, 132);
  assert.equal(Math.round(cellW), 253);
  assert.equal(cellH, 144);
  assert.equal(cellMetrics(0, 4, 12, 132).cellW >= 1, true, "never zero — that would divide by 0");
});
