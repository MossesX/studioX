/**
 * @file The brand gallery's context-menu DECLARATION — data only, importable
 * by plain Node (`import type` and nothing else).
 *
 * Shaped `{ id, route, menus }`, the three fields the conformance scanner reads
 * off a module decl. It is NOT a `ModuleDecl`: `/brand` is a review surface
 * rather than a registered asset, so it has no component, no points, and spends
 * none of the suite's twelve slots — the same arrangement `/settings` and
 * `/docs` use.
 *
 * ── the area is here; its ROWS are not ───────────────────────────────────────
 *
 * This declares only the AREA. The View submenu that lives in it is contributed
 * at runtime by `sections.ts`, because its rows are one per pane and the glyph
 * catalogue's panes come from the active pack's categories, which core leaves
 * open-ended. That file's docblock carries the full reasoning, including why the
 * append-only map means the rows are contributed exactly once.
 *
 * The split is the honest one: an AREA is a fixed fact about the screen — the
 * gallery marks `data-axf-area="brand-gallery.surface"` on its root — and a
 * fixed fact belongs in a decl. What varies with the pack in force does not.
 */
import type { ModuleMenusDecl } from "@axf/core";

export const BRAND_GALLERY_DECL: {
  readonly id: string;
  readonly route: string;
  readonly menus: ModuleMenusDecl;
} = {
  id: "brand-gallery",
  route: "/brand",
  menus: {
    areas: [
      {
        id: "brand-gallery.surface",
        title: "Brand gallery",
        description:
          "Anywhere on the gallery, including empty space. Carries the View submenu, which shows " +
          "and hides the page's panes."
      }
    ],
    // No authored rows: every row in this area is contributed at runtime from
    // the live section list. An empty map here is deliberate, not an omission.
    items: {}
  }
};
