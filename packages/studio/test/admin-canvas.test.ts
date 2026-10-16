/**
 * @file The admin dashboard canvas's pure half — `@axs/modules/accounts/adminCanvas`.
 *
 * Two things are checked here, and only one of them is arithmetic.
 *
 * **The flip.** The phase this canvas was built for claims a card "flips between
 * wide and tall orientations when dragged into differently-shaped slots (the
 * engine's `decide()` answers orientation)". That is a claim about a chain —
 * slot shape → nearest edge → `orientationFor` — and every link is somebody
 * else's code. If the snap range were left at the engine's default, a slot
 * bigger than 96px in both directions would answer "no zone" and every card in
 * the middle of the canvas would silently render wide. That failure is invisible
 * on a wide monitor and total on a narrow one, so it is asserted rather than
 * looked at.
 *
 * **The overlap invariant.** After any accepted plan, no two cards share a cell
 * and nothing sits outside the columns. A blocked plan changes nothing at all —
 * a refusal that half-applied would be worse than the overlap it refused.
 */
import assert from "node:assert/strict";
import test from "node:test";

const {
  CANVAS_COLUMNS,
  CANVAS_MAX_ROWS,
  canvasCellMetrics,
  clampSlot,
  orientationOfSlot,
  overlaps,
  parseCanvasLayout,
  planMove,
  planResize
} = await import("@axs/modules/accounts/adminCanvas");

type Slot = { col: number; row: number; w: number; h: number };
type Layout = Record<string, Slot>;

/** No two rectangles may share a cell, and none may leave the canvas. */
function assertSound(layout: Layout, note: string): void {
  const entries = Object.entries(layout);
  for (const [id, slot] of entries) {
    assert.ok(slot.col >= 1 && slot.col + slot.w - 1 <= CANVAS_COLUMNS, `${note}: ${id} off-grid`);
    assert.ok(slot.row >= 1, `${note}: ${id} above the canvas`);
    assert.ok(slot.h <= CANVAS_MAX_ROWS, `${note}: ${id} taller than the ceiling`);
  }
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      assert.ok(
        !overlaps(entries[i][1], entries[j][1]),
        `${note}: ${entries[i][0]} overlaps ${entries[j][0]}`
      );
    }
  }
}

/* ================================== the flip ================================== */

// One cell 160px wide (incl. gap) and 144px tall — the real canvas's order of
// magnitude, and both well past the engine's 48px default snap range, which is
// exactly the case a default range would get wrong.
const CELL_W = 160;
const CELL_H = 144;

test("a wide slot runs horizontal — the nearest edges are the long ones", () => {
  assert.equal(orientationOfSlot({ col: 1, row: 1, w: 3, h: 1 }, CELL_W, CELL_H), "horizontal");
  assert.equal(orientationOfSlot({ col: 1, row: 1, w: 6, h: 2 }, CELL_W, CELL_H), "horizontal");
});

test("a tall slot runs vertical", () => {
  assert.equal(orientationOfSlot({ col: 1, row: 1, w: 1, h: 2 }, CELL_W, CELL_H), "vertical");
  assert.equal(orientationOfSlot({ col: 1, row: 1, w: 1, h: 4 }, CELL_W, CELL_H), "vertical");
});

test("a slot that is square in PIXELS ties, and the engine's tie order gives horizontal", () => {
  // 2 cells wide × 2 rows tall at these metrics is 320 × 288 — not square. A
  // genuinely square extent is what the tie rule is about, so it is built here
  // rather than assumed from the cell counts.
  assert.equal(orientationOfSlot({ col: 1, row: 1, w: 1, h: 1 }, 200, 200), "horizontal");
});

test("the flip follows MEASURED pixels, not the cell counts", () => {
  const slot = { col: 1, row: 1, w: 2, h: 1 };
  // Two cells wide, one row tall — "wide" by cell count.
  assert.equal(orientationOfSlot(slot, 40, 400), "vertical", "a narrow canvas makes it tall");
  assert.equal(orientationOfSlot(slot, 300, 100), "horizontal", "a wide canvas makes it wide");
});

test("an unmeasured canvas still answers — a card always has to render something", () => {
  assert.equal(orientationOfSlot({ col: 1, row: 1, w: 3, h: 1 }, 0, 0), "horizontal");
  assert.equal(orientationOfSlot({ col: 1, row: 1, w: 1, h: 3 }, 0, 0), "vertical");
});

/* ================================== clamping ================================== */

test("a slot is forced inside the columns, never off the left or the top", () => {
  assert.deepEqual(clampSlot({ col: 6, row: 1, w: 3, h: 2 }), {
    col: CANVAS_COLUMNS - 3 + 1,
    row: 1,
    w: 3,
    h: 2
  });
  assert.deepEqual(clampSlot({ col: -4, row: -9, w: 2, h: 1 }), { col: 1, row: 1, w: 2, h: 1 });
});

test("a card wider than the canvas is narrowed, not pushed off it", () => {
  const slot = clampSlot({ col: 1, row: 1, w: 99, h: 99 });
  assert.equal(slot.w, CANVAS_COLUMNS);
  assert.equal(slot.h, CANVAS_MAX_ROWS);
});

/* ================================ move / resize =============================== */

const base: Layout = {
  a: { col: 1, row: 1, w: 2, h: 2 },
  b: { col: 3, row: 1, w: 2, h: 2 },
  c: { col: 5, row: 1, w: 2, h: 2 }
};

test("a move into empty cells lands", () => {
  const plan = planMove("a", { col: 1, row: 3, w: 2, h: 2 }, base);
  assert.ok(plan.ok);
  assert.deepEqual(plan.layout.a, { col: 1, row: 3, w: 2, h: 2 });
  assert.equal(plan.swapped, null);
  assertSound(plan.layout, "move into empty");
});

test("a move onto ONE card of the same shape swaps the two", () => {
  const plan = planMove("a", { col: 3, row: 1, w: 2, h: 2 }, base);
  assert.ok(plan.ok);
  assert.equal(plan.swapped, "b");
  assert.deepEqual(plan.layout.a, { col: 3, row: 1, w: 2, h: 2 });
  assert.deepEqual(plan.layout.b, { col: 1, row: 1, w: 2, h: 2 });
  assertSound(plan.layout, "swap");
});

test("a move across TWO cards is blocked — nobody can predict which rearrangement it picked", () => {
  const layout: Layout = {
    a: { col: 1, row: 1, w: 2, h: 2 },
    b: { col: 3, row: 1, w: 1, h: 2 },
    c: { col: 4, row: 1, w: 1, h: 2 }
  };
  const plan = planMove("a", { col: 3, row: 1, w: 2, h: 2 }, layout);
  assert.equal(plan.ok, false);
});

/**
 * The bug this file was written to catch, found on its first run.
 *
 * `a` and `b` are both 2 wide and adjacent. Nudge `a` one column right and it
 * overlaps only `b`, so the swap fires — and the two halves of that swap then
 * want the same column as each other. The overlap check against the OTHER cards
 * cannot see it, because the collision is between the two cards being swapped.
 * With equal-shaped cards landing exactly on each other it never happens, which
 * is precisely why it survives review.
 */
test("a PARTIAL overlap does not swap — the two halves would land on each other", () => {
  const plan = planMove("a", { col: 2, row: 1, w: 2, h: 2 }, base);
  assert.equal(plan.ok, false);
});

test("a swap is refused when the vacated slot cannot hold the other card", () => {
  const layout: Layout = {
    small: { col: 1, row: 1, w: 1, h: 1 },
    big: { col: 2, row: 1, w: 4, h: 2 }
  };
  // Dropping the 1×1 into the 4×2 would put the big card back at col 1, still
  // covering the cell the small one just claimed. Refused by arithmetic.
  const plan = planMove("small", { col: 2, row: 1, w: 1, h: 1 }, layout);
  assert.equal(plan.ok, false);
});

test("a resize into free cells grows; a resize into a neighbour is blocked and moves nothing", () => {
  const grew = planResize("a", 2, 4, base);
  assert.ok(grew.ok);
  assert.deepEqual(grew.layout.a, { col: 1, row: 1, w: 2, h: 4 });
  assertSound(grew.layout, "resize down");

  const blocked = planResize("a", 3, 2, base);
  assert.equal(blocked.ok, false, "growing into b must be refused, never given way to");
});

test("a resize never shrinks a neighbour — an admin gauge must not resize on its own", () => {
  const before = JSON.parse(JSON.stringify(base)) as Layout;
  planResize("a", 4, 2, base);
  assert.deepEqual(base, before, "planning is pure — the input layout is untouched");
});

/* ================================ persisted shape ============================= */

test("junk on disk reads as 'nobody arranged this', never as a throw", () => {
  assert.deepEqual(parseCanvasLayout(null), {});
  assert.deepEqual(parseCanvasLayout("nope"), {});
  assert.deepEqual(parseCanvasLayout({ a: 7, b: null, c: { col: "x" } }), {});
  assert.deepEqual(parseCanvasLayout({ a: { col: 0, row: 1, w: 1, h: 1 } }), {}, "1-based only");
});

test("a stored slot is clamped on the way in, so a narrower build cannot inherit an off-grid card", () => {
  const layout = parseCanvasLayout({ a: { col: 99, row: 2, w: 2, h: 2 } });
  assertSound(layout, "parsed");
  assert.equal(layout.a.col + layout.a.w - 1, CANVAS_COLUMNS);
});

/* ================================== metrics =================================== */

test("cell metrics fold the gap in, so a pointer delta and a cell delta are one quantity", () => {
  const { cellW, cellH } = canvasCellMetrics(6 * 100 + 5 * 12, 6, 12, 132);
  assert.equal(cellW, 112, "100px of track plus one 12px gap");
  assert.equal(cellH, 144);
});

test("a canvas with no measured width does not produce NaN placements", () => {
  const { cellW } = canvasCellMetrics(0);
  assert.ok(Number.isFinite(cellW) && cellW >= 0);
});
