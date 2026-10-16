"use client";

/**
 * @file `amberart.tool` — the point's HOST side.
 *
 * ## What changed in the port, and why it is the whole point of the port
 *
 * GizmoX's version of this file owned a `Map` and exported `installTool()`,
 * which each plugin called at import time. That works, and core's `points.ts`
 * names it as the thing AmberX exists to fix:
 *
 * > *GizmoX grew its extension points ad hoc: `shell-docks`, `shell-overlays`,
 * > `xtool.tool`, `amberart.tool`, `feature-atlas.action` — each hand-rolled on
 * > its own. That survives while a human decides what plugs in where, and it
 * > cannot be peeled, because nothing in the system can answer "what are this
 * > module's plugins?"*
 *
 * So here the point is DECLARED as data on `amberart.decl.ts`, plugins publish
 * a `Contribution` the host registry validates, and this file only READS the
 * registry. No `installTool`, no module-owned map, and — the property that
 * matters — **AmberArt imports no plugin**. `registry.contributionsTo()` is the
 * only link, which is what makes "what plugs in here" a question a machine can
 * answer, and therefore what makes the closure computable.
 *
 * ## The ToolHost contract survives unchanged
 *
 * The narrow surface a tool may touch is GizmoX's, kept verbatim because it was
 * right: a tool can ask the canvas size, place an SVG, and raise a message. It
 * cannot reach the layer model, the undo stack or the module's state. A plugin
 * that wants more should make the case for a wider point, not be handed the
 * component.
 */

import * as React from "react";

import { registry } from "@axf/core";
import type { Contribution } from "@axf/core";

/** The point id, in one place — the decl, the plugins and this all cite it. */
export const AMBERART_TOOL_POINT = "amberart.tool";

/** The narrow surface a contributed tool may act on. */
export interface ToolHost {
  /** Canvas geometry, so a tool can generate art at the right aspect ratio. */
  size: { width: number; height: number };
  /**
   * Draw an SVG document onto the active layer, scaled to fit the canvas.
   * Goes through the module's normal stroke path, so it is undoable.
   */
  placeSvg: (svg: string, opts?: { fit?: "cover" | "contain" }) => Promise<void>;
  /** Raise a message through the module's own status line. */
  notify: (message: string) => void;
}

/**
 * What a plugin contributes. Every field here is named in the point's
 * `requires`, so a contribution missing one is refused BY NAME at registration
 * rather than rendering as a blank panel.
 */
export interface AmberArtToolPayload {
  /** Unique tool id — also the toolbar button's value. */
  readonly id: string;
  /** The button's label and tooltip. */
  readonly title: string;
  /** A branding-pack glyph id. Icons are never Material here. */
  readonly glyph: string;
  /** One line under the panel's heading. */
  readonly summary?: string;
  /**
   * How to LOAD the panel — a thunk, never the component itself.
   *
   * This is the shape that keeps a plugin's `plugin.ts` importable by plain
   * Node, which the closure resolver requires (`test/suite.test.ts` refuses an
   * entry it cannot import: *"failed to import under plain Node (is it
   * data-only?)"*). A field holding a component would drag a `.tsx` into that
   * import, and Node's type stripping does not transform JSX — so the plugin
   * would be unresolvable and the suite gate would go red.
   *
   * A thunk costs nothing and buys code-splitting: a tool's panel is fetched
   * the first time its tool is selected, not on boot.
   */
  readonly load: () => Promise<{ default: React.ComponentType<{ host: ToolHost }> }>;
}

export type AmberArtToolContribution = Contribution<AmberArtToolPayload>;

/** A contributed tool, flattened with the plugin that brought it. */
export interface ResolvedTool extends Omit<AmberArtToolPayload, "load"> {
  /** The contributing asset's id — shown so a panel is attributable. */
  readonly from: string;
  /** The panel, wrapped once. The host mounts it inside a `Suspense`. */
  readonly Panel: React.LazyExoticComponent<React.ComponentType<{ host: ToolHost }>>;
}

/**
 * Every tool contributed to the point, in the registry's order (priority, then
 * id — declared by the point, not decided here).
 *
 * A hook rather than a getter because contributions are registered during boot
 * and the screen may render first; `useSyncExternalStore` is overkill for a
 * list that only grows at boot, so this reads on every render and stays honest
 * under HMR.
 */
export function useContributedTools(): ResolvedTool[] {
  return React.useMemo(() => {
    const contributions = registry.contributionsTo<AmberArtToolPayload>(AMBERART_TOOL_POINT);
    return contributions.map(({ payload, from }) => {
      const { load, ...rest } = payload;
      return { ...rest, from, Panel: React.lazy(load) };
    });
    // Recomputed per mount. Contributions arrive at boot, before any route
    // renders; a tool registered later needs a remount, which is what a dev
    // reload does anyway.
  }, []);
}
