"use client";

/**
 * @file Which tracked file the plugin is looking at — one value, one store.
 *
 * It exists because a composer action's `run()` takes NO arguments. That is the
 * point's own decision and a good one (`claude-workspace/points.ts`: returning
 * text rather than writing into the editor is what keeps a contribution from
 * needing a handle on it) — but it means an action that acts on "the file the
 * panel is showing" has to read that from somewhere both halves can see.
 *
 * A store rather than a prop, for the reason the panel point states about the
 * conversation record: *"a store a panel reads is a seam that widens without a
 * version bump"*. Same argument, same shape, this plugin's own state.
 */
import * as React from "react";

const DEFAULT_FILE = "PLANNING-STATE";

let selected = DEFAULT_FILE;
const listeners = new Set<() => void>();

export const diffSelection = {
  get: (): string => selected,
  set(file: string): void {
    if (file === selected) return;
    selected = file;
    for (const l of listeners) l();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
};

/** The selected file, as a hook. `useSyncExternalStore` rather than an effect:
 *  the composer action can change it, and a panel that only read on mount would
 *  disagree with the action that just ran. */
export function useDiffSelection(): string {
  return React.useSyncExternalStore(
    diffSelection.subscribe,
    () => selected,
    () => DEFAULT_FILE
  );
}
