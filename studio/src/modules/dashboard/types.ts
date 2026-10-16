/**
 * @file Card config types for the dashboard card screen — the dashboard slice
 * of GizmoX's `src/lib/types.ts`, ported with the grid engine (MASTER §4.1).
 * GizmoX keeps these in one app-wide types barrel; studio has no such barrel,
 * and the card screen is the only consumer, so they live beside the engine.
 */

export type CardSize = "sm" | "md" | "lg";

export interface CardConfig {
  id: string;
  enabled: boolean;
  order: number;
  size: CardSize;
  /**
   * Free-placement geometry, in 1-based grid cells. All four are optional and
   * absent on every config written before the dashboard grid could be dragged
   * and resized by hand — a card without them is auto-flowed into the first run
   * of free cells that fits, exactly as the old order-driven grid placed it, and
   * gains a geometry the first time it is moved or resized.
   *
   * `w` falls back to the column span of {@link CardConfig.size} and `h` to
   * `CARD_DEFAULT_H` (`./grid`), so the sm/md/lg picker in the Card Manager
   * keeps working on cards that have never been dragged.
   */
  col?: number;
  row?: number;
  w?: number;
  h?: number;
}
