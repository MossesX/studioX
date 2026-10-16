/**
 * @file `usePublishDiff` — what turning one dial actually costs the publisher.
 *
 * `publish.ts:applyVariables` exists because the original publisher rewrote
 * every variable on every change: each `setProperty` is cheap, but the browser
 * cannot tell "one colour moved" from "the entire design system was replaced"
 * and invalidates accordingly. `changeCount()` exists, in that same file, "for a
 * designer surface, and for proving the diff works rather than assuming it".
 * This is that designer surface, so this is where the claim gets measured.
 *
 * **It recomputes the publisher's inputs rather than intercepting its output**,
 * and the distinction matters. It calls the same `resolveVariables(values,
 * style)` that `AxfStyleRoot` calls, with the same two arguments, and diffs
 * consecutive results with the same `changeCount`. So the numbers on screen are
 * the numbers the root publisher is writing at the same moment — but they are a
 * PARALLEL derivation, not a tap on the real DOM writes, and a reader deserves
 * to know which they are looking at.
 *
 * The unspoofable version is `scripts/publish-diff-probe.mjs`, which wraps
 * `CSSStyleDeclaration.prototype.setProperty` on the live document and counts
 * what the publisher genuinely wrote while a slider is dragged. This hook is the
 * live readout; that probe is the gate. Both exist because a readout computed by
 * the surface it is vouching for can only ever be corroborating evidence.
 */
"use client";

import * as React from "react";
import { changeCount, resolveVariables } from "@axf/core";
import type { StyleInput, ThemeValues } from "@axf/core";

export interface PublishDiff {
  /** How many custom properties the theme publishes in total. */
  readonly total: number;
  readonly written: number;
  readonly removed: number;
  readonly unchanged: number;
  /** The properties that actually moved, in publication order. */
  readonly writtenNames: readonly string[];
  readonly removedNames: readonly string[];
  /** The values this diff was measured FROM — what the cascade compares against. */
  readonly previousValues: ThemeValues;
  /** Monotonic, so a repeat of the same edit still reads as a fresh measurement. */
  readonly at: number;
}

/**
 * Diff the resolved variable set against the previous one, every time it moves.
 *
 * No value is snapshotted into state: `values` arrives from the store on every
 * render and the only thing held across renders is the PREVIOUS resolved set,
 * which is what a diff is. The measurement lands in state (it has to — it is
 * produced after the render that caused it) and is keyed by a counter rather
 * than by content, so dragging a slider back to where it started still reports.
 */
export function usePublishDiff(
  values: ThemeValues,
  style: StyleInput | null
): PublishDiff | null {
  const vars = React.useMemo(() => resolveVariables(values, style), [values, style]);

  const previous = React.useRef<{ vars: Record<string, string>; values: ThemeValues } | null>(null);
  const [diff, setDiff] = React.useState<PublishDiff | null>(null);
  const counter = React.useRef(0);

  React.useEffect(() => {
    const before = previous.current;
    previous.current = { vars, values };
    // First render has nothing to diff against — reporting "42 written" for the
    // initial publication would be true and useless, and it is exactly the
    // number this surface exists to distinguish an edit from.
    if (!before) return;
    if (before.vars === vars) return;

    const counts = changeCount(vars, before.vars);
    setDiff({
      total: Object.keys(vars).length,
      written: counts.written,
      removed: counts.removed,
      unchanged: counts.unchanged,
      writtenNames: Object.keys(vars).filter((name) => before.vars[name] !== vars[name]),
      removedNames: Object.keys(before.vars).filter((name) => !(name in vars)),
      previousValues: before.values,
      at: ++counter.current
    });
  }, [vars, values]);

  return diff;
}
