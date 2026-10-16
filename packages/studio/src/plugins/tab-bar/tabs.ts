"use client";

/**
 * @file Open-surface tabs — the state behind the tab bar, ported from GizmoX's
 * `src/plugins/top-strip/tabs.ts`.
 *
 * ── what came across verbatim, and why ────────────────────────────────────────
 *
 * The BEHAVIOUR, which is the part that was right: a tab is opened by *arriving*
 * at a surface, not by a click handler on one particular button. Nothing calls
 * `openTab` except the bar's own pathname effect, so the nav rail, a command, a
 * hotkey, a deep link and a plain address-bar visit all produce the same tab —
 * there is no second navigation path that can quietly forget to register one.
 * That is the same argument core's context-menu engine is built on (a walk, not
 * forty handlers), applied to tabs.
 *
 * ── what did NOT come across ──────────────────────────────────────────────────
 *
 * GizmoX kept a hand-written `MODULES` list and a `ROUTE_ALIASES` map beside it,
 * plus an `EXTRA_SURFACES` array for the two rail entries that were not in
 * `MODULES`. All three exist because nothing in GizmoX could answer "what
 * surfaces are there" — the knowledge lived in a list somebody maintained.
 * AmberX can answer it: {@link tabbableSurfaces} reads the module REGISTRY, so a
 * module registered tomorrow is tabbable tomorrow, with its real title and its
 * declared glyph, and a tab's label cannot drift from the module it opens.
 *
 * The alias map goes with it. It existed for one pair of routes rendering one
 * module; identity here is the module id the registry resolved, so two routes
 * into one module are one tab by construction rather than by a lookup table.
 *
 * ── localStorage, not kv, and this is the one deliberate exception ────────────
 *
 * Module SETTINGS persist through the kv transport (`settings/store.ts` states
 * why localStorage was left behind). The open-tab LIST does not, because of how
 * the app navigates: `NavShell` and this bar both use `window.location.assign`,
 * so clicking a tab tears the page down. A kv write is a `fetch` that the
 * navigation cancels — the tab you just opened would be the one that failed to
 * save, intermittently, which is worse than not persisting at all. A synchronous
 * write that has already landed before the navigation starts is the requirement,
 * and localStorage is the only thing that meets it.
 *
 * The plugin's SETTINGS still go through kv like everyone else's. It is only
 * this list, and only for that reason.
 */

import { registry } from "@axf/core";
import * as React from "react";

/** One open surface. `id` is its identity in the list — arriving at the same
 *  surface twice re-uses its tab rather than stacking a second. */
export interface ModuleTab {
  readonly id: string;
  readonly label: string;
  readonly route: string;
  /** Contract glyph id (`icon-*`). Absent for surfaces that declare none. */
  readonly glyph?: string;
}

export const TABS_KEY = "axf.tabs.open";
export const TABS_EVENT = "axf:tabs-changed";

export const PINNED_KEY = "axf.tabs.pinned";
export const PINNED_EVENT = "axf:tabs-pinned-changed";

/** Every registered module, as a tab. Rail order is registry order (id-sorted),
 *  which is stable and is the same order every other surface lists them in. */
export function tabbableSurfaces(): ModuleTab[] {
  return registry.modules().map((m) => ({
    id: m.id,
    label: m.title,
    route: m.route,
    glyph: m.glyph
  }));
}

/** `theme-designer` → `Theme designer`. Sentence case, not Title Case: it sits
 *  beside real module titles, which are sentences. */
function labelForSegment(segment: string): string {
  const words = segment.replace(/[-_]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : segment;
}

/**
 * The tab a path belongs to, or null when the path names nothing openable.
 *
 * Two answers, in order:
 *
 *  1. **A registered module**, longest route first — so a future `/tools/x`
 *     module cannot be swallowed by a shorter prefix that happens to match.
 *  2. **A top-level plugin route** (`/settings`, `/docs`, `/theme-designer`),
 *     reduced to its first segment. These are real screens a person opens and
 *     wants back, and they belong to no module — GizmoX carried them in a
 *     hand-kept `EXTRA_SURFACES` array, which went stale the moment a route was
 *     added. Deriving them from the path cannot go stale, and reducing to the
 *     first segment is what stops a module's sub-pages spawning a tab each.
 *
 * `/` is neither: it redirects into whichever surface the app boots on, and a
 * tab for it would be a tab for "wherever you came in", which closes nothing.
 */
export function resolveTab(pathname: string): ModuleTab | null {
  let best: ModuleTab | null = null;
  for (const t of tabbableSurfaces()) {
    if (pathname === t.route || pathname.startsWith(`${t.route}/`)) {
      if (!best || t.route.length > best.route.length) best = t;
    }
  }
  if (best) return best;

  const segment = pathname.split("/").filter(Boolean)[0];
  if (!segment) return null;
  return {
    // Namespaced, so a route tab can never collide with a module id.
    id: `route:${segment}`,
    label: labelForSegment(segment),
    route: `/${segment}`
  };
}

function isTab(v: unknown): v is ModuleTab {
  const t = v as ModuleTab | null;
  return (
    !!t &&
    typeof t.id === "string" &&
    typeof t.label === "string" &&
    typeof t.route === "string" &&
    (t.glyph === undefined || typeof t.glyph === "string")
  );
}

/** Stored tabs, or an empty list on the server / a corrupt entry. */
export function loadTabs(): ModuleTab[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(TABS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isTab) : [];
  } catch {
    return [];
  }
}

/** Persist + broadcast in one step; returns what was stored so a caller can
 *  chain without a second read. */
export function saveTabs(tabs: ModuleTab[]): ModuleTab[] {
  if (typeof window === "undefined") return tabs;
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
  } catch {
    // A full or blocked store: the list stays live for this page. Losing the
    // tabs is not worth taking the shell down for.
  }
  window.dispatchEvent(new CustomEvent(TABS_EVENT, { detail: { tabs } }));
  return tabs;
}

/**
 * Add a tab, or refresh an existing one in place — a renamed module must not
 * spawn a duplicate beside its old title. Over `max`, the OLDEST is dropped and
 * the tab just opened is never the one evicted.
 */
export function openTab(tab: ModuleTab, max = 12): ModuleTab[] {
  const cur = loadTabs();
  if (cur.some((t) => t.id === tab.id)) {
    const merged = cur.map((t) => (t.id === tab.id ? { ...t, ...tab } : t));
    // This runs on every navigation, so an unchanged list writes nothing.
    if (JSON.stringify(merged) === JSON.stringify(cur)) return cur;
    return saveTabs(merged);
  }
  const next = [...cur, tab];
  const limit = Math.max(1, max);
  while (next.length > limit) next.shift();
  return saveTabs(next);
}

export function tabById(id: string): ModuleTab | null {
  return loadTabs().find((t) => t.id === id) ?? null;
}

/**
 * The tab that takes over when `id` is closed out of `order`: the one to its
 * right, else the one to its left, else null — nothing is left, and the caller
 * stays where it is.
 *
 * `order` is the DISPLAYED order, so "the next tab" is the one the reader
 * actually sees beside it, under `newestFirst` too.
 */
export function successorTab(order: readonly ModuleTab[], id: string): ModuleTab | null {
  const i = order.findIndex((t) => t.id === id);
  if (i < 0) return null;
  return order[i + 1] ?? order[i - 1] ?? null;
}

export function closeTab(id: string): ModuleTab[] {
  return saveTabs(loadTabs().filter((t) => t.id !== id));
}

export function closeOtherTabs(id: string): ModuleTab[] {
  return saveTabs(loadTabs().filter((t) => t.id === id));
}

export function closeAllTabs(): ModuleTab[] {
  return saveTabs([]);
}

/** Nudge a tab one slot left (-1) or right (+1) in STORED order. */
export function moveTab(id: string, delta: number): ModuleTab[] {
  const cur = loadTabs();
  const i = cur.findIndex((t) => t.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= cur.length) return cur;
  const next = [...cur];
  [next[i], next[j]] = [next[j], next[i]];
  return saveTabs(next);
}

/** Whether the bar was left pinned open. False on the server and on a corrupt
 *  entry, which is also the sane default — an unpinned bar only peeks. */
export function loadPinned(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(PINNED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Persist + broadcast the pin, same one-step shape as {@link saveTabs}. */
export function savePinned(pinned: boolean): boolean {
  if (typeof window === "undefined") return pinned;
  try {
    localStorage.setItem(PINNED_KEY, pinned ? "1" : "0");
  } catch {
    // See saveTabs.
  }
  window.dispatchEvent(new CustomEvent(PINNED_EVENT, { detail: { pinned } }));
  return pinned;
}

export function togglePinned(): boolean {
  return savePinned(!loadPinned());
}

/** Subscribe to one of this module's broadcasts plus the cross-tab `storage`
 *  event for the same key. Returns the unsubscriber. */
function listen(event: string, key: string, read: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (!e.key || e.key === key) read();
  };
  window.addEventListener(event, read);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(event, read);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * The pin as a drop-in replacement for `React.useState(false)` that happens to
 * be durable. Mount-read like {@link useModuleTabs}, so a stored `true` never
 * renders on the server and mismatches.
 */
export function useTabBarPinned(): [boolean, (next: boolean) => void] {
  const [pinned, setPinned] = React.useState(false);

  React.useEffect(() => {
    const read = () => setPinned(loadPinned());
    read();
    return listen(PINNED_EVENT, PINNED_KEY, read);
  }, []);

  // The write broadcasts, and the broadcast is what sets state — one path in,
  // so a menu row and a click on the band cannot disagree about the value.
  const set = React.useCallback((next: boolean) => {
    savePinned(next);
  }, []);

  return [pinned, set];
}

/** Live tab list — mount-read (never during render), same-tab broadcasts and
 *  cross-tab `storage` events. */
export function useModuleTabs(): ModuleTab[] {
  const [tabs, setTabs] = React.useState<ModuleTab[]>([]);
  React.useEffect(() => {
    const read = () => setTabs(loadTabs());
    read();
    return listen(TABS_EVENT, TABS_KEY, read);
  }, []);
  return tabs;
}
