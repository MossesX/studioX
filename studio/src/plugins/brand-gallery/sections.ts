/**
 * @file The gallery's sections as DATA, their two-state store, and the View
 * submenu built from them.
 *
 * ── two states, not one ──────────────────────────────────────────────────────
 *
 * Owner request, verbatim: *"make all secion panes collapsible also add a view
 * entry to the context menu with sub items for each catagory. green check marks
 * if shown next to the entry and closed eye icon if hidden."*
 *
 * That is two independent things and they are kept independent:
 *
 *   - **collapsed** — the pane is on the page with its body folded away. Its
 *     header stays, so you can see the section exists and unfold it in place.
 *     Toggled by the chevron on the pane's own header.
 *   - **hidden** — the pane is not on the page at all. Toggled from the View
 *     submenu, which is the only affordance that can bring it back — which is
 *     precisely why hiding lives in a menu and not on the pane. A control whose
 *     only effect is to remove the control is a trap.
 *
 * Both persist to `localStorage`. A gallery you arranged and then lost on
 * reload is one you arrange once and never again.
 *
 * ── why the rows are contributed ONCE, and presence is a predicate ───────────
 *
 * Six panes are fixed; the glyph catalogue contributes one pane per CATEGORY,
 * and `GlyphCategory` is open-ended in core (*"a pack may add its own"*). So the
 * row list cannot be a literal on a decl.
 *
 * It also cannot be rebuilt as the categories change: `MenuMap` is append-only
 * by design — `contribute` adds and refuses a duplicate id, and there is no
 * removal API, because a declaration that could be withdrawn is one the map
 * could not answer questions about afterwards. Re-contributing on a pack swap
 * would throw.
 *
 * So the rows are contributed exactly once, over the UNION of every category in
 * every REGISTERED pack (not merely the active one — packs all register during
 * boot, so the union is complete and stable for the session), and each row is
 * gated by a `when` predicate reading {@link setPresentSections}. A category
 * that is not in the active pack has no pane and therefore no row; activate
 * that pack and both appear. The one thing this cannot cover is a pack
 * registered AFTER the gallery first mounts, which nothing in the app does.
 *
 * Two notes on registering commands here rather than in a `*.commands.ts` file,
 * so it is not mistaken for dodging the conformance gate:
 *
 *   - the gate that matters still runs. `MenuMap.contribute` REFUSES an item
 *     naming an unregistered command or predicate, against the real registries,
 *     at the moment the rows are added — the same check `registerModuleMenus`
 *     is subject to, not a weaker one;
 *   - `test/ctx-conformance.test.ts` scans `*.commands.ts` files for a FIXED
 *     list of literals. This list is one command per live section, so a file the
 *     scanner half-understood would be worse than one it does not scan.
 */
"use client";

import { commands, menu, packs, predicates } from "@axf/core";
import type { GlyphEntry, MenuItem } from "@axf/core";

/** The area the gallery marks on its root, and the submenu's home. */
export const GALLERY_AREA = "brand-gallery.surface";

export interface GallerySection {
  /** Stable id — the storage key and the command's suffix. */
  readonly id: string;
  /** What the View submenu calls it. */
  readonly label: string;
}

/**
 * The panes that always exist, in the order they appear on the page. The glyph
 * catalogue's category panes are appended to these at render time.
 */
export const FIXED_SECTIONS: readonly GallerySection[] = [
  { id: "live-edit", label: "Live edit" },
  { id: "identity", label: "Identity in force" },
  { id: "coverage", label: "Coverage" },
  { id: "packs", label: "Packs" },
  { id: "standalone", label: "Standalone packs" },
  { id: "variables", label: "Published variables" }
];

/** A glyph category's pane id. Namespaced so a category called `packs` cannot
 *  collide with the fixed pane of that name. */
export const categorySectionId = (category: string): string => `category:${category}`;

const STORAGE_KEY = "axs:brand-gallery-view@1";

type Listener = () => void;

interface ViewState {
  /** Section ids explicitly HIDDEN. Absent ⇒ shown; shown is the default. */
  readonly hidden: ReadonlySet<string>;
  /** Section ids explicitly COLLAPSED. Absent ⇒ open. */
  readonly collapsed: ReadonlySet<string>;
}

const EMPTY: ViewState = { hidden: new Set(), collapsed: new Set() };

/**
 * A store rather than component state, for the standing reason: its writers
 * have no hooks. Every row in the View submenu fires a plain command function,
 * and a command cannot call `setState`.
 *
 * Both sets store the NON-DEFAULT state only. A section a pack adds tomorrow is
 * therefore shown and open without anything having to know it exists — the
 * alternative, storing a boolean per section, silently defaults new sections to
 * whatever the absent value happens to mean.
 */
class GalleryViewStore {
  #state: ViewState = EMPTY;
  #loaded = false;
  #listeners = new Set<Listener>();

  #ensureLoaded(): void {
    if (this.#loaded || typeof window === "undefined") return;
    this.#loaded = true;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const doc = JSON.parse(raw) as { v?: number; hidden?: string[]; collapsed?: string[] };
      if (doc?.v !== 1) return;
      this.#state = {
        hidden: new Set(Array.isArray(doc.hidden) ? doc.hidden : []),
        collapsed: new Set(Array.isArray(doc.collapsed) ? doc.collapsed : [])
      };
    } catch {
      // Unreadable doc: everything shown and open. Overwritten on the next edit.
    }
  }

  #commit(next: ViewState): void {
    this.#state = next;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ v: 1, hidden: [...next.hidden], collapsed: [...next.collapsed] })
      );
    } catch {
      // Quota or private mode: the change stands for the session.
    }
    for (const fn of this.#listeners) fn();
  }

  subscribe = (fn: Listener): (() => void) => {
    this.#ensureLoaded();
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getState = (): ViewState => {
    this.#ensureLoaded();
    return this.#state;
  };

  /** The server snapshot — everything shown and open, so hydration cannot tear. */
  getServerState = (): ViewState => EMPTY;

  isShown(id: string): boolean {
    return !this.getState().hidden.has(id);
  }

  isCollapsed(id: string): boolean {
    return this.getState().collapsed.has(id);
  }

  toggleShown(id: string): void {
    const hidden = new Set(this.getState().hidden);
    if (!hidden.delete(id)) hidden.add(id);
    this.#commit({ ...this.getState(), hidden });
  }

  toggleCollapsed(id: string): void {
    const collapsed = new Set(this.getState().collapsed);
    if (!collapsed.delete(id)) collapsed.add(id);
    this.#commit({ ...this.getState(), collapsed });
  }

  /** Bring everything back — the way out of a gallery you hid all of. */
  showAll(): void {
    this.#commit({ ...this.getState(), hidden: new Set() });
  }

  setAllCollapsed(collapsed: boolean, ids: readonly string[]): void {
    this.#commit({ ...this.getState(), collapsed: new Set(collapsed ? ids : []) });
  }
}

export const galleryView = new GalleryViewStore();

/* ── which panes are on the page right now ────────────────────────────────── */

let present: ReadonlySet<string> = new Set();

/**
 * What the gallery is currently rendering, by section id. Read by the `when`
 * predicates so the View submenu lists the panes this pack actually has.
 *
 * Plain module state rather than the store: nothing re-renders when it changes
 * (the menu reads it at click time, and the gallery already knows), so putting
 * it in the store would publish a notification with no subscriber.
 */
export function setPresentSections(ids: readonly string[]): void {
  present = new Set(ids);
}

/* ── the View submenu ─────────────────────────────────────────────────────── */

const commandId = (sectionId: string) => `brand.view.${sectionId}`;
const shownPredicate = (sectionId: string) => `brand.view.shown.${sectionId}`;
const presentPredicate = (sectionId: string) => `brand.view.present.${sectionId}`;

/** Every category any registered pack ships — the union, so the row list is
 *  stable across pack swaps. */
function knownCategories(): string[] {
  const found = new Set<string>();
  for (const pack of packs.packs()) {
    const entries = (pack.payload as { entries?: readonly GlyphEntry[] }).entries ?? [];
    for (const entry of entries) if (entry.category) found.add(entry.category);
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

let contributed = false;

/**
 * Register the View submenu's commands and predicates and contribute its rows.
 * Idempotent: the map is append-only, so this may only ever run once per
 * runtime, and the guard is the thing that makes a React remount safe.
 */
export function syncGalleryView(): void {
  if (contributed) return;
  contributed = true;

  const sections: GallerySection[] = [
    ...FIXED_SECTIONS,
    ...knownCategories().map((category) => ({
      id: categorySectionId(category),
      label: category
    }))
  ];

  for (const section of sections) {
    const cmd = commandId(section.id);
    if (!commands.has(cmd)) {
      commands.register({
        id: cmd,
        title: `Show or hide the ${section.label} pane`,
        run: () => galleryView.toggleShown(section.id)
      });
    }
    const shown = shownPredicate(section.id);
    if (!predicates.has(shown)) {
      predicates.register({
        id: shown,
        title: `The ${section.label} pane is shown`,
        test: () => galleryView.isShown(section.id) || "hidden"
      });
    }
    const here = presentPredicate(section.id);
    if (!predicates.has(here)) {
      predicates.register({
        id: here,
        title: `The ${section.label} pane exists in this pack`,
        test: () => present.has(section.id) || "not in this pack"
      });
    }
  }

  if (!commands.has("brand.view.showAll")) {
    commands.register({
      id: "brand.view.showAll",
      title: "Show every pane",
      run: () => galleryView.showAll()
    });
  }

  const rows: MenuItem[] = sections.map((section, index) => ({
    id: section.id,
    label: section.label,
    role: "toggle",
    command: commandId(section.id),
    checkedWhen: shownPredicate(section.id),
    // A row for a pane this pack does not have would be a switch with nothing
    // behind it. `when` rather than `enabledWhen`: "this pack has no badges" is
    // the surface's shape, not a temporary state a reason could explain.
    when: presentPredicate(section.id),
    // The whole reason core grew `marks` (`ctx/types.ts`): this list has two
    // POSITIVE states, and a blank column for "hidden" would read as no answer.
    marks: "visibility",
    order: (index + 1) * 10
  }));

  menu.contribute(GALLERY_AREA, [
    {
      id: "view",
      label: "View",
      icon: "icon-eye",
      role: "submenu",
      order: 10,
      items: [
        ...rows,
        { id: "sep", label: "", role: "separator", order: 900 },
        { id: "show-all", label: "Show every pane", command: "brand.view.showAll", order: 910 }
      ]
    }
  ]);
}
