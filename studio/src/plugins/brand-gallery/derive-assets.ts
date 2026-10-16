/**
 * @file Turning pending live edits into a SAVED asset.
 *
 * Owner request, 2026-08-13: *"if the edit is made to a toolbar banner or nav
 * menu then save it as a new asset with a name user is prompted for and then
 * change the layout to render the new asset instead of old one"*.
 *
 * Every clause of that is load-bearing:
 *
 *   - **a new asset**, never an edit in place. The bar you dropped on is very
 *     often a BUILT-IN, and a built-in is code (`src/toolbars/`) — there is
 *     nothing a save could write to. The designer's Toolbar tab already drew
 *     this line ("built-ins are duplicated to edit, never edited in place") and
 *     this is the same line, reached from a drag instead of a Duplicate button.
 *     It holds for a custom source too: the operator asked for a new asset, and
 *     silently mutating the one they dragged onto would destroy whatever else
 *     was using it.
 *   - **with a name the user is prompted for**, so the derived asset is
 *     findable in the designer's candidate list afterwards rather than being a
 *     `custom-banner-3` nobody can identify.
 *   - **change the layout to render the new asset**, which for these two kinds
 *     means the theme's `bannerBar` / `navMenu` chrome dials. That is why only
 *     those two surfaces offer drop zones at all — see the nullable `target` in
 *     core's `GlyphDropZone`.
 *
 * This module is pure: it derives records and answers questions about ids. The
 * order of the four side effects (write the document → register → repoint the
 * dial → clear the pending edits) is the gallery's, because only it can report
 * a failure to the operator.
 */
import { defineNavMenu, defineToolbar } from "@axf/core";
import type { BrandEdit, BrandEditKind, NavMenuAsset, ToolbarAsset } from "@axf/core";

import { chromeSlug } from "../../chrome/assets";

/** Every pending edit against ONE asset — what becomes one derived asset. */
export interface EditGroup {
  readonly key: string;
  readonly kind: BrandEditKind;
  /** The asset the edits were made against, i.e. what is derived FROM. */
  readonly assetId: string;
  readonly edits: readonly BrandEdit[];
}

/**
 * Group the pending edits by the asset they belong to.
 *
 * One group is one prompt and one derived asset. Two groups happen for a real
 * reason — a drop on the banner's logo and another on a nav icon are edits to
 * two different assets — and collapsing them into one name would produce a
 * toolbar and a menu sharing an id.
 *
 * Insertion-ordered, so the prompt lists the assets in the order they were
 * edited rather than in whatever order a Map happened to hash them into.
 */
export function groupBrandEdits(edits: readonly BrandEdit[]): EditGroup[] {
  const groups = new Map<string, BrandEdit[]>();
  for (const edit of edits) {
    const key = `${edit.kind}:${edit.asset}`;
    const list = groups.get(key);
    if (list) list.push(edit);
    else groups.set(key, [edit]);
  }
  return [...groups].map(([key, list]) => ({
    key,
    kind: list[0].kind,
    assetId: list[0].asset,
    edits: list
  }));
}

/**
 * A `custom-` id for a name, disambiguated against ids already in use.
 *
 * `taken` must be every id the registry knows AND every id in the stored
 * document, not just one of them: a collision with a built-in throws out of
 * `SurfaceRegistry.register`, and a collision with a stored custom asset would
 * silently overwrite somebody's saved bar.
 */
export function uniqueChromeId(name: string, taken: ReadonlySet<string>): string {
  const base = chromeSlug(name);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** How a derived asset describes itself in the designer's candidate list. */
function derivedDescription(sourceTitle: string, count: number): string {
  return `Derived from “${sourceTitle}” on the branding page — ${count} drawing${
    count === 1 ? "" : "s"
  } replaced by drag and drop.`;
}

/**
 * A copy of `source` with the edited items' glyphs replaced.
 *
 * Run back through `defineToolbar` rather than returned as a bare object: the
 * brand is compile-time only, and this record is about to be written to a file
 * a person can hand-edit. A derived bar that cannot pass the chokepoint is
 * refused here, with the reason, instead of being stored broken and dropped at
 * the next boot by `parseChromeAssetsDoc`.
 */
export function deriveToolbar(
  source: ToolbarAsset,
  name: string,
  id: string,
  edits: readonly BrandEdit[]
): ToolbarAsset {
  const byItem = new Map(edits.map((e) => [e.item, e.glyph]));
  const items = source.items.map((item) => {
    const glyph = byItem.get(item.id);
    if (!glyph) return item;
    switch (item.kind) {
      // The four item kinds that carry a drawing. Everything else is text or
      // arrangement, and a drop can never have landed on one.
      case "brand":
      case "action":
      case "menu":
      case "field":
        return { ...item, glyph };
      default:
        return item;
    }
  });
  return defineToolbar({
    ...source,
    id,
    title: name,
    description: derivedDescription(source.title, edits.length),
    items
  });
}

/** The same, for a nav menu. Only `link` items carry a glyph. */
export function deriveNav(
  source: NavMenuAsset,
  name: string,
  id: string,
  edits: readonly BrandEdit[]
): NavMenuAsset {
  const byItem = new Map(edits.map((e) => [e.item, e.glyph]));
  const items = source.items.map((item) => {
    const glyph = byItem.get(item.id);
    if (!glyph || item.kind !== "link") return item;
    return { ...item, glyph };
  });
  return defineNavMenu({
    ...source,
    id,
    title: name,
    description: derivedDescription(source.title, edits.length),
    items
  });
}

/** The theme dial that decides which asset of this kind the layout renders. */
export const CHROME_DIAL: Readonly<Record<BrandEditKind, string>> = {
  toolbar: "bannerBar",
  nav: "navMenu"
};
