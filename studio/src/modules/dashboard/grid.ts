/**
 * @file The dashboard's **free-placement grid engine** — every rule about where
 * a card sits, what a drag or a resize is allowed to do to it, and what happens
 * when one card's edge runs into another.
 *
 * Kept out of `DashboardModule.tsx` on purpose: this is pure geometry over plain
 * objects with no React in it, so the interesting cases (a resize pushing into a
 * column card, a drop that has to shrink to fit, a config with no geometry at
 * all) are exercised by `test/dashboard-grid.test.ts` rather than by dragging
 * things around by hand and hoping.
 *
 * ## The model
 *
 * The grid is `columns` tracks wide and unbounded downwards. A card occupies a
 * rectangle of whole cells — `{ col, row, w, h }`, 1-based, `col + w - 1` never
 * past `columns`. Placement is **explicit**: cards are positioned, not flowed,
 * which is what lets the grid have holes in it. A row that does not fill up
 * stays part-empty instead of stretching the last card, and two cards side by
 * side sit exactly one gap apart because they are in adjacent tracks.
 *
 * ## Cards that have never been placed
 *
 * A `CardConfig` written before any of this existed has no geometry. Those are
 * **auto-flowed** in `order`: each one takes the first run of free cells wide
 * enough for it, scanning left to right then down — which lands them exactly
 * where the old `grid-auto-flow` grid put them. Explicitly placed cards are laid
 * down first, so a flowed card fills a hole rather than colliding with a card
 * the user has already positioned.
 */

import type { CardConfig, CardSize } from "./types";

/** Column span each sm/md/lg size means — the fallback width for a card that
 *  has never been resized by hand. */
export const SPAN: Record<CardSize, number> = { sm: 1, md: 2, lg: 3 };

/** Rows a card occupies before anybody resizes it. */
export const CARD_DEFAULT_H = 2;

/** A card's rectangle on the grid, in 1-based whole cells. */
export interface Place {
  col: number;
  row: number;
  w: number;
  h: number;
}

/** Every card's resolved rectangle, keyed by card id. */
export type Placements = Record<string, Place>;

/**
 * A **column-type card** is one tall enough to read as a column rather than as a
 * tile: it spans more rows than it does columns, and at least two rows. This is
 * the shape the horizontal-resize rule below is allowed to shorten.
 */
export function isColumnCard(p: Place): boolean {
  return p.h >= 2 && p.h > p.w;
}

const overlaps = (a: Place, b: Place): boolean =>
  a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h;

/** The cards other than `id`, as `[id, Place]` pairs. */
const others = (places: Placements, id: string): [string, Place][] =>
  Object.entries(places).filter(([k]) => k !== id);

/* -------------------------------- placement ------------------------------- */

/** Clamp a width so the card cannot hang off the right edge of the grid. */
const fitW = (col: number, w: number, columns: number): number =>
  Math.max(1, Math.min(w, columns - col + 1));

/**
 * Shrink `rect` in place — width first, then height, never below one cell —
 * until it clears every obstacle.
 *
 * Callers must anchor `rect` on a cell that is already free, which every caller
 * here does; a 1x1 on a free cell always clears, so this terminates rather than
 * bottoming out on an overlap it cannot fix.
 */
function shrinkToFit(rect: Place, obstacles: Place[]): Place {
  const out = { ...rect };
  const hits = () => obstacles.some((o) => overlaps(out, o));
  while (out.w > 1 && hits()) out.w--;
  while (out.h > 1 && hits()) out.h--;
  return out;
}

/**
 * The first run of `w` free cells at or after row 1, scanning each row left to
 * right. Falls back to a fresh row below everything when the width cannot fit
 * beside what is already down (which only happens for `w === columns`).
 */
function firstFree(taken: Place[], w: number, h: number, columns: number): Place {
  const probe = (col: number, row: number): boolean =>
    taken.every((t) => !overlaps({ col, row, w, h }, t));
  const lastRow = taken.reduce((m, t) => Math.max(m, t.row + t.h - 1), 0);
  for (let row = 1; row <= lastRow + 1; row++) {
    for (let col = 1; col + w - 1 <= columns; col++) if (probe(col, row)) return { col, row, w, h };
  }
  return { col: 1, row: lastRow + 1, w, h };
}

/**
 * Resolve every enabled card to a rectangle.
 *
 * @param cards - The enabled cards, in the order they should flow.
 * @param columns - Grid track count (`dashboard.columns`).
 * @param honourSizes - `dashboard.wideCards`. Off, a card with no explicit `w`
 *   falls back to one column instead of its sm/md/lg span. A card that HAS been
 *   resized keeps its width either way — the setting is about the fallback, not
 *   about overruling something the user dragged.
 */
export function resolvePlacements(
  cards: CardConfig[],
  columns: number,
  honourSizes = true
): Placements {
  const out: Placements = {};
  const taken: Place[] = [];

  const fallbackW = (c: CardConfig) => fitW(1, honourSizes ? SPAN[c.size] : 1, columns);

  // Explicitly placed cards first, so a flowed card fills the gaps around them
  // rather than the other way round. A stored rectangle that no longer fits (the
  // column count was lowered) is nudged left and clamped instead of dropped.
  //
  // A stored rectangle that overlaps one already laid down is **re-flowed**, not
  // painted on top: two cards in the same cells is not a layout anybody can have
  // asked for, and a grid that renders a bad store forever is a grid you cannot
  // drag your way out of. Later-ordered cards give way, so the outcome is stable.
  for (const c of cards) {
    if (c.col === undefined || c.row === undefined) continue;
    const w = fitW(1, c.w ?? fallbackW(c), columns);
    const col = Math.max(1, Math.min(c.col, columns - w + 1));
    const place: Place = { col, row: Math.max(1, c.row), w, h: Math.max(1, c.h ?? CARD_DEFAULT_H) };
    if (taken.some((t) => overlaps(place, t))) continue;
    out[c.id] = place;
    taken.push(place);
  }

  for (const c of cards) {
    if (out[c.id]) continue;
    // A card being flowed because its stored rectangle collided still keeps the
    // size it was given — only its position is being decided here.
    const place = firstFree(taken, fitW(1, c.w ?? fallbackW(c), columns), c.h ?? CARD_DEFAULT_H, columns);
    out[c.id] = place;
    taken.push(place);
  }
  return out;
}

/* --------------------------------- resizing -------------------------------- */

/** What a resize produced: the dragged card's new rectangle, plus any column
 *  cards the drag shortened to get out of its way. */
export interface ResizeResult {
  place: Place;
  /** Column cards whose `h` was reduced by this drag, keyed by id. */
  shrunk: Record<string, number>;
}

/**
 * Resize `id` to `want` cells, resolving whatever it runs into.
 *
 * Two different things can happen when the new rectangle overlaps another card,
 * and which one depends on the neighbour's shape:
 *
 * - **A column-type card shortens.** Its bottom edge rises to just above the
 *   band being dragged (`h = draggedRow - itsRow`), so the cells beside the
 *   resizing card come free and the resize takes them. This is the "shrink up"
 *   rule: the column keeps its width and its top, and gives up rows from the
 *   bottom. It cannot apply when the column starts on the same row as the
 *   dragged card or below it — there are no rows above the collision to keep, and
 *   shortening it to nothing would be a deletion, not a resize.
 * - **Anything else blocks.** The rectangle is clipped to stop one cell short of
 *   the neighbour. Nothing is pushed, nothing is reordered: a resize only ever
 *   changes the card being dragged and the columns it shortens, so releasing the
 *   mouse commits exactly the arrangement that was on screen.
 *
 * Blocking is resolved by shrinking `w` first and `h` second, and the clip is
 * recomputed until it is stable, because clipping the width can free the card
 * that was forcing a height clip and vice versa.
 */
export function resizeCard(
  id: string,
  want: Place,
  places: Placements,
  columns: number
): ResizeResult {
  const shrunk: Record<string, number> = {};
  let w = fitW(want.col, Math.max(1, want.w), columns);
  let h = Math.max(1, want.h);

  // Up to one pass per neighbour: every pass either shortens a column, clips an
  // edge, or finds nothing left to resolve and stops.
  const rest = others(places, id);
  for (let guard = 0; guard <= rest.length; guard++) {
    const rect: Place = { col: want.col, row: want.row, w, h };
    const hit = rest.find(([k, p]) => overlaps(rect, shrunk[k] ? { ...p, h: shrunk[k] } : p));
    if (!hit) break;
    const [otherId, other] = hit;
    const live = shrunk[otherId] ? { ...other, h: shrunk[otherId] } : other;

    if (isColumnCard(live) && live.row < rect.row) {
      shrunk[otherId] = rect.row - live.row;
      continue;
    }
    // Clip the edge that is actually crossing this neighbour. Widening into a
    // card to the side clips `w`; growing down into one clips `h`.
    if (live.col >= rect.col + 1 && live.col < rect.col + w) w = live.col - rect.col;
    else if (live.row >= rect.row + 1 && live.row < rect.row + h) h = live.row - rect.row;
    else {
      // The neighbour starts at or before our own origin, so there is no edge to
      // clip back to — the drag simply cannot have these cells.
      w = Math.max(1, w - 1);
      if (w === 1) h = Math.max(1, live.row > rect.row ? live.row - rect.row : h - 1);
    }
    w = Math.max(1, w);
    h = Math.max(1, h);
  }

  return { place: { col: want.col, row: want.row, w, h }, shrunk };
}

/* --------------------------------- moving ---------------------------------- */

/** What a drop produced: where the card landed, and the card it traded places
 *  with (when the target cell was already occupied). */
export interface MoveResult {
  place: Place;
  /** The displaced card's new rectangle, keyed by id — empty when the card
   *  landed on free cells. */
  swapped: Record<string, Place>;
}

/**
 * Drop `id` with its top-left cell at `col`/`row`.
 *
 * The card **auto-resizes to fit** rather than refusing the drop: its width is
 * clipped to the free run of cells starting at the target, so dragging a
 * three-wide card into a two-wide hole leaves a two-wide card there instead of
 * bouncing back. Height is left alone — vertical room is unbounded, so there is
 * nothing to fit into.
 *
 * If the target cell itself is occupied there is no run to shrink into, and the
 * two cards **trade rectangles**: the one under the pointer moves to where the
 * dragged card came from. A swap keeps the grid as tight as it was — the
 * alternative, pushing the occupant down, would reflow rows the user never
 * touched.
 */
export function moveCard(
  id: string,
  col: number,
  row: number,
  places: Placements,
  columns: number
): MoveResult {
  const self = places[id];
  if (!self) return { place: { col, row, w: 1, h: 1 }, swapped: {} };
  const c = Math.max(1, Math.min(col, columns));
  const r = Math.max(1, row);
  const rest = others(places, id);

  // Occupied anchor cell → trade places with whatever is under the pointer.
  const under = rest.find(([, p]) => overlaps({ col: c, row: r, w: 1, h: 1 }, p));
  if (under) {
    const [otherId, other] = under;
    // Both halves of the trade are clipped against the cards that are NOT part
    // of it. Swapping the two rectangles blind is what let a two-wide card land
    // on its partner's column plus a third card's — the partner's cell being
    // free says nothing about the cells beside it.
    const bystanders = rest.filter(([k]) => k !== otherId).map(([, p]) => p);
    const place = shrinkToFit(
      { col: other.col, row: other.row, w: fitW(other.col, self.w, columns), h: self.h },
      bystanders
    );
    const moved = shrinkToFit(
      { col: self.col, row: self.row, w: fitW(self.col, other.w, columns), h: other.h },
      [...bystanders, place]
    );
    return { place, swapped: { [otherId]: moved } };
  }

  // Free anchor → keep as much of the card as the run of free cells allows.
  return {
    place: shrinkToFit(
      { col: c, row: r, w: fitW(c, self.w, columns), h: self.h },
      rest.map(([, p]) => p)
    ),
    swapped: {}
  };
}

/* ------------------------------- persistence ------------------------------- */

/**
 * Fold resolved rectangles back into the stored configs, and renumber `order`
 * reading-order (top row first, then left to right) so the Card Manager's list
 * and drag-to-reorder still describe what is on screen.
 */
export function applyPlacements(cards: CardConfig[], places: Placements): CardConfig[] {
  const placed = cards.map((c) => {
    const p = places[c.id];
    return p ? { ...c, col: p.col, row: p.row, w: p.w, h: p.h } : c;
  });
  const rank = (c: CardConfig) =>
    c.row === undefined || c.col === undefined ? Number.MAX_SAFE_INTEGER : c.row * 1000 + c.col;
  const ordered = [...placed].sort((a, b) => rank(a) - rank(b));
  const orderOf = new Map(ordered.map((c, i) => [c.id, i]));
  return placed.map((c) => ({ ...c, order: orderOf.get(c.id) ?? c.order }));
}

/** Pixels per grid cell, derived from the measured grid width. The horizontal
 *  step includes the gap, so `Math.round(dx / cellW)` is a cell delta. */
export function cellMetrics(
  gridWidth: number,
  columns: number,
  gapPx: number,
  rowUnit: number
): { cellW: number; cellH: number } {
  const cellW = (gridWidth - gapPx * (columns - 1)) / columns + gapPx;
  return { cellW: Math.max(1, cellW), cellH: Math.max(1, rowUnit + gapPx) };
}
