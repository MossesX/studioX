/**
 * @file The task manager's module-owned store, persisted at `axs:tasks@1`
 * (MASTER §5).
 *
 * A tiny external store rather than component state because the lists have
 * more than one reader: the module screen, every floating list window, and
 * the dashboard's `tasks` card all render the same lists and must agree
 * live. `useSyncExternalStore` is the React-sanctioned way to share it.
 *
 * Persistence rules:
 * - Lists persist to localStorage on every mutation; the seed applies only
 *   when nothing is stored (or the stored doc is unreadable), so the user's
 *   edits — including deleting every seeded list — are never overwritten.
 * - Window geometry is session state and deliberately NOT persisted: a
 *   floating window is something you opened, not something you configured.
 *
 * ── the server snapshot is EMPTY, and that is the fix (owner, 2026-08-11) ────
 *
 * It used to be the SEED, with the reasoning that "both runtimes render the
 * same first frame and React reconciles to the stored lists in the post-mount
 * check". Both halves of that were true and the result was still wrong. The
 * owner reported it exactly: *"my browser renders what claudes browser renders
 * for 1 second … i deleted them and put new lists"*.
 *
 * The server cannot read `localStorage`, so any non-empty server snapshot is a
 * GUESS about this visitor's data — and the seed is the one guess guaranteed to
 * be wrong for everybody who has ever edited a list. Rendering it meant every
 * load painted four lists the reader had deleted, then replaced them. That is
 * the same class of defect as the theme flash this project already fixed once,
 * and `layout.tsx` states the principle for it: *"a guess is a visible flip when
 * it is wrong"*.
 *
 * So the server renders NOTHING, which is the only thing it honestly knows, and
 * the seed becomes what it always claimed to be — a first-run default, applied
 * on the client when there is genuinely nothing stored. `#ensureLoaded` still
 * runs on first SUBSCRIBE rather than in `getState`: React calls `getSnapshot`
 * during the hydration render, and loading there would return the stored lists
 * against server HTML that has none, which is the mismatch this arrangement
 * exists to avoid. Subscription happens in a layout effect, so the real lists
 * land before paint rather than a frame after it.
 */
import * as React from "react";

import { withBuiltinGroups } from "./groups";
import { SEED_LISTS } from "./seed";
import type { TaskGroup, TaskList, WindowState } from "./types";

export const TASKS_STORAGE_KEY = "axs:tasks@1";

/**
 * The document version this build WRITES. v2 added `groups` (2026-08-14).
 *
 * v1 is still read, and reads as "no stored groups" — which
 * {@link withBuiltinGroups} turns into the four built-ins. There is no
 * migration step and no rewrite-on-read: the first real mutation persists v2,
 * and until then an older build could still open the document. A migration that
 * ran on load would rewrite every reader's storage on a version they may not
 * have finished rolling out.
 */
export const TASKS_DOC_VERSION = 2;

/** What a persisted document may look like — either version. */
interface TasksDoc {
  v?: number;
  lists?: TaskList[];
  groups?: TaskGroup[];
}

/**
 * The window event a manual refresh dispatches.
 *
 * Declared HERE rather than in the plugin that listens for it, for the reason
 * `managed.ts` gives about the other direction: the module owns the refresh
 * gesture (its lists bar fires it), and a poll loop that wants to answer one
 * promptly listens for it. Neither has to import the other.
 */
export const TASKMAN_REFRESH_EVENT = "axs:taskman-refresh";

export interface TaskState {
  lists: TaskList[];
  /** The rail's collapsible bands. Persisted beside the lists — see `groups.ts`. */
  groups: TaskGroup[];
  windows: WindowState[];
  /**
   * The lists ticked with ctrl-click in the rail. SESSION state, like the
   * windows and for the same reason: a selection is something you are doing,
   * not something you configured, and an armed multi-list delete that survived
   * a reload is the loaded gun `taskman.delete-all.toggle-managed` already
   * refuses to be.
   *
   * It lives in the store rather than in `TaskmanModule`'s React state because
   * `taskman.list.delete` is a plain command over the store — a handler takes no
   * arguments by design — and a selection it could not read is a "delete
   * selected" row that silently deletes one.
   */
  selectedListIds: string[];
}

type Updater<T> = (prev: T) => T;

/** What the server knows about this visitor's lists: nothing. */
const SERVER_STATE: TaskState = { lists: [], groups: [], windows: [], selectedListIds: [] };

/** Read a document of either version. Returns null when it is not ours. */
function parseDoc(raw: string | null): { lists: TaskList[]; groups: TaskGroup[] } | null {
  if (!raw) return null;
  const doc = JSON.parse(raw) as TasksDoc;
  if (!doc || (doc.v !== 1 && doc.v !== 2) || !Array.isArray(doc.lists)) return null;
  // v1 carries no `groups`, which is exactly the "nothing stored" case
  // `withBuiltinGroups` answers with the four built-ins.
  return { lists: doc.lists, groups: withBuiltinGroups(doc.groups) };
}

class TaskStore {
  #state: TaskState = SERVER_STATE;
  #loaded = false;
  #listeners = new Set<() => void>();

  #ensureLoaded() {
    if (this.#loaded || typeof window === "undefined") return;
    this.#loaded = true;
    try {
      const doc = parseDoc(window.localStorage.getItem(TASKS_STORAGE_KEY));
      if (doc) {
        // Stored — including a deliberately EMPTY list set. Deleting every list
        // must survive a reload; re-seeding it would be the app overruling the
        // reader, which is what `lists: []` is here to prevent.
        this.#state = { ...this.#state, lists: doc.lists, groups: doc.groups };
        return;
      }
      // Nothing stored, or a doc we cannot read: the seed, applied here on the
      // client where it is a real first-run default rather than a server guess.
      this.#state = { ...this.#state, lists: SEED_LISTS, groups: withBuiltinGroups(undefined) };
    } catch {
      this.#state = { ...this.#state, lists: SEED_LISTS, groups: withBuiltinGroups(undefined) };
    }
  }

  #persist() {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        TASKS_STORAGE_KEY,
        JSON.stringify({ v: TASKS_DOC_VERSION, lists: this.#state.lists, groups: this.#state.groups })
      );
    } catch {
      // Quota/private-mode failures degrade to in-memory state, not a crash.
    }
  }

  #emit() {
    for (const fn of this.#listeners) fn();
  }

  subscribe = (fn: () => void): (() => void) => {
    // First subscriber pulls the persisted doc in; React re-checks the
    // snapshot right after subscribing, so no manual emit is needed here.
    this.#ensureLoaded();
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getState = (): TaskState => this.#state;

  getServerState = (): TaskState => SERVER_STATE;

  /**
   * Re-read the persisted document and publish it — what the lists bar's
   * Refresh does.
   *
   * The store is one copy of a document a SECOND TAB can also write, and
   * nothing pushes across tabs today. Re-reading is the honest way to catch up,
   * and it is deliberately not automatic: adopting another tab's document
   * mid-edit would discard what you were typing.
   *
   * A document that cannot be read leaves the lists ALONE. `#ensureLoaded`
   * falls back to the seed because it runs when there is nothing yet; here
   * there is something, and replacing a live screen with the seed because one
   * read failed would be the "system overruled me" failure this store's own
   * docblock is built around.
   */
  reload(): void {
    if (typeof window === "undefined") return;
    this.#loaded = true;
    try {
      const doc = parseDoc(window.localStorage.getItem(TASKS_STORAGE_KEY));
      if (!doc) return;
      this.#state = { ...this.#state, lists: doc.lists, groups: doc.groups };
      this.#emit();
    } catch {
      /* unreadable — keep what is on screen */
    }
  }

  setLists(update: Updater<TaskList[]>) {
    this.#ensureLoaded();
    const lists = update(this.#state.lists);
    if (lists === this.#state.lists) return;
    // A selection naming a list that just went is a selection that would delete
    // nothing and report a count — pruned here, once, rather than at every
    // reader. Same array identity when nothing was dropped, so this costs a
    // comparison on the common path.
    const selectedListIds = pruneSelection(this.#state.selectedListIds, lists);
    this.#state = { ...this.#state, lists, selectedListIds };
    this.#persist();
    this.#emit();
  }

  setGroups(update: Updater<TaskGroup[]>) {
    this.#ensureLoaded();
    const groups = update(this.#state.groups);
    if (groups === this.#state.groups) return;
    this.#state = { ...this.#state, groups };
    this.#persist();
    this.#emit();
  }

  setWindows(update: Updater<WindowState[]>) {
    const windows = update(this.#state.windows);
    if (windows === this.#state.windows) return;
    this.#state = { ...this.#state, windows };
    this.#emit();
  }

  /** Replace the rail's ctrl-click selection. Never persisted — see the field. */
  setSelection(update: Updater<string[]>) {
    const next = pruneSelection(update(this.#state.selectedListIds), this.#state.lists);
    if (next === this.#state.selectedListIds) return;
    this.#state = { ...this.#state, selectedListIds: next };
    this.#emit();
  }
}

/** Drop ids no list answers to, preserving identity when nothing was dropped. */
function pruneSelection(selected: readonly string[], lists: readonly TaskList[]): string[] {
  const live = new Set(lists.map((l) => l.id));
  const kept = selected.filter((id) => live.has(id));
  return kept.length === selected.length ? (selected as string[]) : kept;
}

/** One store per runtime — the module, its windows and the dashboard card all
 *  read this instance. */
export const taskStore = new TaskStore();

/** Live task state; safe under SSR (server renders the seed). */
export function useTaskState(): TaskState {
  return React.useSyncExternalStore(
    taskStore.subscribe,
    taskStore.getState,
    taskStore.getServerState
  );
}
