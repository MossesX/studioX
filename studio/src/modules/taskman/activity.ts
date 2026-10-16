/**
 * @file "Something is happening to this list right now" — the Task Manager's
 * own notion of live activity, and the channel anything else pushes it through.
 *
 * ── why this lives in the MODULE, not in the bmpx plugin ─────────────────────
 *
 * The glow is a Task Manager affordance: a list that is being worked on right
 * now looks different from one that is not, and an item currently being built
 * pulses. That is a fact about how this module DRAWS, so the module owns the
 * concept, the vocabulary and the store.
 *
 * What it deliberately does NOT own is any knowledge of `.bmpx`, builders,
 * phases or steps. A producer — today `src/plugins/bmpx-taskman` — decides what
 * is active and calls {@link taskActivity.set}. Any other source (a future
 * agent runner, a test watcher, a deploy) reports through the same two fields
 * with no edit here. The dependency runs plugin → module, which is the
 * direction the asset rules require; a module reaching into a plugin for its
 * own paint would be the inversion this file exists to avoid.
 *
 * Deliberately NOT persisted and deliberately not in the task store: activity
 * is live truth about a running process, not user data. It must never end up in
 * `axs:tasks@1`, where it would survive a reload and claim a build is running
 * when nothing is.
 */
"use client";

import * as React from "react";

export interface TaskActivity {
  /** Lists with something running against them. Steady glow. */
  readonly activeListIds: readonly string[];
  /**
   * The ONE item currently being produced. Pulsing glow.
   *
   * Single, not a set, on purpose: the builder runs one step at a time, and a
   * "currently building" badge on four rows at once would be a claim nothing
   * checked. A producer that genuinely has several reports the innermost.
   */
  readonly buildingItemId: string | null;
}

const IDLE: TaskActivity = { activeListIds: [], buildingItemId: null };

/** Cheap equality, so a poll that changes nothing does not re-render the tree. */
function same(a: TaskActivity, b: TaskActivity): boolean {
  return (
    a.buildingItemId === b.buildingItemId &&
    a.activeListIds.length === b.activeListIds.length &&
    a.activeListIds.every((id, i) => id === b.activeListIds[i])
  );
}

class ActivityStore {
  #state: TaskActivity = IDLE;
  #listeners = new Set<() => void>();

  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getState = (): TaskActivity => this.#state;

  /** Always idle on the server — nothing is building during an SSR render, and
   *  a glow in the server HTML would be a claim the client then has to undo. */
  getServerState = (): TaskActivity => IDLE;

  set(next: TaskActivity): void {
    if (same(this.#state, next)) return;
    this.#state = next;
    for (const fn of this.#listeners) fn();
  }

  /** Back to nothing running — what a producer calls when its poll goes quiet
   *  or its component unmounts. A glow nobody switched off is a lie. */
  clear(): void {
    this.set(IDLE);
  }
}

export const taskActivity = new ActivityStore();

export function useTaskActivity(): TaskActivity {
  return React.useSyncExternalStore(
    taskActivity.subscribe,
    taskActivity.getState,
    taskActivity.getServerState
  );
}

/**
 * The glow, as `sx` fragments, defined ONCE.
 *
 * Three surfaces draw it — the rail row, the tree's list header and the item
 * row — and three copies of a box-shadow is how they end up at three different
 * intensities. The keyframes are registered by the module's `GlobalStyles`
 * (`TaskmanModule`), because `sx` can express the animation shorthand but not
 * the `@keyframes` rule itself.
 */
export const ACTIVE_LIST_GLOW = {
  boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--axf-accent) 55%, transparent)",
  background: "color-mix(in srgb, var(--axf-accent) 8%, transparent)"
} as const;

export const BUILDING_ITEM_GLOW = {
  animation: "axs-tm-pulse 1.25s ease-in-out infinite",
  borderRadius: "4px"
} as const;

/** The keyframes both glows need. Injected by the module, once. */
export const GLOW_KEYFRAMES = {
  "@keyframes axs-tm-pulse": {
    "0%, 100%": {
      boxShadow: "0 0 0 0 color-mix(in srgb, var(--axf-accent) 55%, transparent)",
      background: "color-mix(in srgb, var(--axf-accent) 10%, transparent)"
    },
    "50%": {
      boxShadow: "0 0 10px 2px color-mix(in srgb, var(--axf-accent) 45%, transparent)",
      background: "color-mix(in srgb, var(--axf-accent) 22%, transparent)"
    }
  },
  /* Someone watching a long build should not be forced to watch it throb. */
  "@media (prefers-reduced-motion: reduce)": {
    "@keyframes axs-tm-pulse": {
      "0%, 100%": { background: "color-mix(in srgb, var(--axf-accent) 16%, transparent)" }
    }
  }
} as const;
