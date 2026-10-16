/**
 * @file The group-room grid's ARITHMETIC (P11) — how a roster becomes pages,
 * how a page becomes columns, and which simulcast layer a tile of that size
 * deserves.
 *
 * Pure, and in `lib/` rather than inside `RoomGrid.tsx`, for one reason: this
 * is the invariant that makes a room of hundreds possible, and an invariant
 * that cannot be tested is an invariant that is merely hoped for. The module's
 * test harness loads `.ts` and not `.tsx`, so logic that lives in a component
 * file is logic nothing can pin. `test/axv-group-rooms.test.ts` pins every
 * number below.
 *
 * The invariant these three functions serve, stated once (the long version is
 * in `RoomGrid.tsx`'s header):
 *
 *   **A page consumes only its visible participants' video, at the simulcast
 *   layer that fits the tile it will be drawn in.**
 *
 * `pageCountFor` bounds how many tiles can be visible; `columnsFor` decides how
 * big they are; `layerForColumns` turns that size into the layer to ask the
 * media server for. A change to any of them is a change to what one laptop is
 * asked to decode.
 */

import { ROOM_PAGE_TILES } from "./types";

/** 7×7 — the page is square because a square wastes the least of a 16:9 stage
 *  on letterboxing when the tiles are themselves 16:9. */
export const ROOM_GRID_MAX_COLUMNS = 7;

/**
 * Columns for a page holding `n` tiles: as square as it can be, never wider
 * than 7. Fewer people therefore means BIGGER tiles rather than a 7-wide strip
 * of postage stamps — which is also what makes the layer choice below track
 * something real.
 */
export function columnsFor(n: number): number {
  if (n <= 1) return 1;
  return Math.min(ROOM_GRID_MAX_COLUMNS, Math.ceil(Math.sqrt(n)));
}

/**
 * The simulcast spatial layer a tile of this column-count deserves, 0..2 — the
 * range the media route's `layers` action accepts.
 *
 * Three bands rather than a curve, because there are only three layers and a
 * band mapping to the same number as its neighbour is a band that does nothing.
 * The boundaries are where a tile crosses a real resolution: at 5+ columns a
 * tile on a laptop is ~200 px wide and the lowest layer (quarter scale) already
 * exceeds it; at 3–4 it is ~350 px and wants the middle; at 1–2 it is big
 * enough to show the top layer's detail.
 *
 * Monotonic on purpose, and pinned as such: more tiles must never cost more
 * bytes each.
 */
export function layerForColumns(columns: number): number {
  if (columns >= 5) return 0;
  if (columns >= 3) return 1;
  return 2;
}

/** How many pages a roster of `n` needs. Always at least one — an empty room
 *  still has a page, and that page says the room is empty. */
export function pageCountFor(n: number): number {
  return Math.max(1, Math.ceil(n / ROOM_PAGE_TILES));
}
