/**
 * @file The dashboard module's DECLARATION — data only, importable by plain Node.
 *
 * The closure resolver (scripts/lib/closure.mjs — the peel outward, the suite
 * inward) imports this under native type stripping, no JSX. The one hard rule:
 * **nothing but `import type`** — a runtime import breaks resolution for every
 * module at once.
 *
 * `/` is the landing: the active dashboard WRAPPER around the one card screen
 * (MASTER §4). Cards stay a plain registry (`./cards`), not an extension point
 * — promoting them is the peel-era step, deliberately not this one — so this
 * module declares no points yet.
 *
 * `dashboard.module.ts` composes this back into a real `Module` by adding the
 * component; the registry and the screen see no difference.
 */
import type { ModuleDecl } from "@axf/core";

export const DASHBOARD_DECL: ModuleDecl = {
  id: "dashboard",
  title: "Dashboard",
  summary:
    "The landing screen: six live cards (nav tiles, modules, theme, packs, clock) on a " +
    "free-placement grid, inside whichever dashboard wrapper is active.",
  route: "/",
  glyph: "icon-grid",
  // The declared context menus ride the decl exactly as the Core Inspector's
  // do: the screen marks `data-axf-area="dashboard.grid"` on its root and the
  // host registers the rows through `registerModuleMenus`.
  menus: {
    areas: [
      {
        id: "dashboard.grid",
        title: "Dashboard",
        description: "Anywhere on the card grid — the module's own right-click surface."
      }
    ],
    items: {
      "dashboard.grid": [
        {
          id: "copy-selection",
          label: "Copy from dashboard",
          command: "ctx.copy",
          order: 10
        }
      ]
    }
  },
  /**
   * Settings as decl data (core 0.0.20). One row, and it passes the ceiling's
   * test: the grid's card titles are drawn uppercase (the GizmoX default this
   * screen replicates), which reads as chrome to some eyes and as shouting to
   * others — and a title's case is not reachable any other way (the theme's
   * type dials govern size and family, deliberately not case).
   */
  settings: {
    ns: "dashboard-settings",
    rows: [
      {
        key: "uppercaseTitles",
        label: "Uppercase card titles",
        hint: "Draw card titles in caps, the GizmoX default this screen replicates.",
        kind: "switch",
        defaultValue: true
      }
    ]
  },
  points: []
};
