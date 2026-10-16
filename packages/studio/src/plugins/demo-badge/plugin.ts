/**
 * @file A plugin contributing to the demo module's declared points.
 *
 * Deliberately trivial in what it renders and deliberately NOT trivial in what
 * it proves: the contribution names a point by id, carries a payload the point
 * validates, and reaches the screen without the demo module importing this file
 * at all. That indirection is the mechanism the whole peel model rests on —
 * if it works here it can be computed, and if it can be computed a module's
 * closure is knowable.
 *
 * Contributions are data. There is no React in this file, which is the point:
 * a `value`-kind contribution has no component, and a `ui-surface` one supplies
 * its payload rather than mounting itself.
 */
import type { Contribution } from "@axf/core";

export interface BadgePayload {
  readonly label: string;
  readonly tone: "accent" | "ok" | "warn";
}

export interface NotePayload {
  readonly text: string;
}

export const DEMO_BADGE_CONTRIBUTION: Contribution<BadgePayload> = {
  from: "demo-badge",
  point: "demo.badge",
  priority: 10,
  payload: { label: "plugin reached the screen", tone: "ok" }
};

export const DEMO_NOTE_CONTRIBUTION: Contribution<NotePayload> = {
  from: "demo-badge",
  point: "demo.note",
  priority: 10,
  payload: {
    text:
      "This line was contributed by the demo-badge plugin through the demo.note point. " +
      "The demo module never imports the plugin — the registry resolved it."
  }
};
