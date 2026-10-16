/**
 * @file Keep a SAVED nav menu's destinations current with the authored ones.
 *
 * ## The defect this exists to end
 *
 * The branding page's drag-and-drop glyph editor mints a new asset by copying
 * the source menu WHOLE — every link row included — and the theme's `navMenu`
 * dial is then pointed at the copy. The copy is what renders from that moment
 * on, and it is a snapshot: it froze the destinations as they stood the day it
 * was made.
 *
 * Measured 2026-08-13, on a fork made that same day: the live menu carried 16
 * rows while `studio-nav.ts` carried 19. `amberxvid` had been registered hours
 * earlier and `firecrawl` minutes earlier, both with rows dutifully added to the
 * authored menu — which had stopped being the menu anyone could see. Nothing was
 * broken in a way anything could notice: `check:nav` reads the authored SOURCE
 * files and was green, because the drift was in user data it does not read.
 *
 * The editor was only ever meant to change DRAWINGS. Copying the destinations
 * too is what turned a glyph edit into a permanent fork of what the app can
 * reach, and no amount of discipline in `studio-nav.ts` reaches a copy.
 *
 * ## What this does instead
 *
 * Before a saved menu is registered, any link the AUTHORED menus have and it
 * lacks is inserted — positioned after the same neighbour it follows in the
 * source, so it lands inside the right section rather than at the foot. The
 * fork keeps everything that makes it a fork: its replaced glyphs, its order,
 * its sections, its title. It gains only destinations, which are the one thing
 * it was never meant to own.
 *
 * A row is "missing" by ROUTE. Matching on id instead would re-add a row the
 * user deliberately relabelled, and matching on both would re-add one they
 * merely renamed.
 *
 * ## Why the authored menus are imported, not read from the registry
 *
 * This runs during the render phase, inside `<PacksSeed>`, on BOTH runtimes —
 * and `boot()` belongs to the client graph and resolves asynchronously, so the
 * nav registry is not reliably populated at this moment on either. A static
 * import is the same value in both renders and needs nothing to have booted,
 * which is exactly the property the hydration doctrine in core's `NavMenu.tsx`
 * demands: same input, same markup, no post-mount correction.
 */
import type { NavItem, NavMenuAsset } from "@axf/core";

/** A link row, narrowed — the only kind this file adds or compares. */
type NavLink = Extract<NavItem, { kind: "link" }>;

const isLink = (item: NavItem): item is NavLink => item.kind === "link";

/**
 * The saved menu with any authored destination it lacks inserted in place.
 *
 * Returns the SAME object when nothing is missing, so `seedChromeAssets`'s
 * signature guard keeps seeing an unchanged document and never re-notifies the
 * registries — a new object every render would invalidate the snapshot every
 * render, which `useSyncExternalStore` turns into an infinite loop.
 */
export function reconcileNav(saved: NavMenuAsset, authored: readonly NavMenuAsset[]): NavMenuAsset {
  const sources = authored.filter((menu) => menu.surface === saved.surface);
  if (sources.length === 0) return saved;

  const items = [...saved.items];
  const routes = new Set(items.filter(isLink).map((item) => item.route));
  const ids = new Set(items.map((item) => item.id));
  let added = 0;

  for (const source of sources) {
    const sourceItems = source.items;
    for (let i = 0; i < sourceItems.length; i++) {
      const row = sourceItems[i];
      if (!isLink(row) || routes.has(row.route)) continue;

      // An id collision would be refused by `defineNavMenu` and cost the whole
      // menu, so a clash yields a suffixed id rather than a dropped row: the
      // destination is the point, the id is bookkeeping.
      let id = row.id;
      for (let n = 2; ids.has(id); n++) id = `${row.id}-${n}`;

      // Anchor to the nearest PRECEDING link the fork already has, so the row
      // lands in the section it belongs to. Falling back to the end is correct
      // for a row the source itself opens with.
      let at = items.length;
      for (let back = i - 1; back >= 0; back--) {
        const before = sourceItems[back];
        if (!isLink(before)) continue;
        const found = items.findIndex((item) => isLink(item) && item.route === before.route);
        if (found >= 0) {
          at = found + 1;
          break;
        }
      }

      items.splice(at, 0, { ...row, id });
      routes.add(row.route);
      ids.add(id);
      added++;
    }
  }

  return added === 0 ? saved : { ...saved, items };
}
