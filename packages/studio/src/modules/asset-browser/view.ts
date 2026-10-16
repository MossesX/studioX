"use client";

/**
 * @file The browser's **view state** — which kind is filtered to, which card is
 * selected, and the reload nonce.
 *
 * A store rather than `useState` in the screen, for the reason `expenses/ui.ts`
 * gives: context-menu rows resolve to a command NAME and a command is a plain
 * function, so "Show only this kind" has to reach the screen without holding a
 * `setState` in a module-scope ref. One tiny store, four fields, and every
 * surface that cares subscribes.
 *
 * Not persisted, deliberately. A remembered filter is how a person opens a
 * manager, sees four cards where there were twenty, and concludes an asset has
 * vanished — see `asset-browser.decl.ts`'s refused-settings list.
 */

import * as React from "react";

type Listener = () => void;

export interface AssetBrowserView {
  /** A kind id from P0's closed list, or null for "every kind". */
  readonly kind: string | null;
  /** `<kind>:<id>` of the selected card, or null. */
  readonly selected: string | null;
  /** Free-text filter over id, name and description. */
  readonly query: string;
  /**
   * Bumped to re-read the server's disk report. A counter rather than a
   * boolean: two reloads in a row must both happen, and a boolean flipping
   * false→true→false can be observed as no change at all.
   */
  readonly nonce: number;
  /** A transient line the screen shows and then forgets. */
  readonly toast: string | null;
}

const INITIAL: AssetBrowserView = {
  kind: null,
  selected: null,
  query: "",
  nonce: 0,
  toast: null
};

/** `<kind>:<id>` — unique across the catalog, since ids are unique per kind. */
export function cardKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}

class ViewStore {
  #state: AssetBrowserView = INITIAL;
  #listeners = new Set<Listener>();

  subscribe = (fn: Listener): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getState = (): AssetBrowserView => this.#state;
  /** SSR sees the initial view — the screen renders the same on both sides. */
  getServerState = (): AssetBrowserView => INITIAL;

  #set(patch: Partial<AssetBrowserView>): void {
    const next = { ...this.#state, ...patch };
    // Bail on a no-op write: `useSyncExternalStore` re-renders on every
    // notification, and a rail click that changes nothing should cost nothing.
    // Every field is compared — adding one and forgetting it here makes that
    // field silently unwritable.
    if (
      next.kind === this.#state.kind &&
      next.selected === this.#state.selected &&
      next.query === this.#state.query &&
      next.nonce === this.#state.nonce &&
      next.toast === this.#state.toast
    ) {
      return;
    }
    this.#state = next;
    for (const fn of this.#listeners) fn();
  }

  /** Filter to one kind, or to everything with `null`. */
  focus(kind: string | null): void {
    this.#set({ kind });
  }

  select(key: string | null): void {
    this.#set({ selected: key });
  }

  search(query: string): void {
    this.#set({ query });
  }

  reload(): void {
    this.#set({ nonce: this.#state.nonce + 1 });
  }

  /**
   * Say something happened. The screen clears it on a timer.
   *
   * The same message twice in a row is forced through as a distinct state, or
   * the no-op guard above would swallow the second "Copied the asset id" and
   * the second copy would look like it failed.
   */
  say(message: string): void {
    if (this.#state.toast === message) this.#set({ toast: null });
    this.#set({ toast: message });
  }

  clearToast(): void {
    this.#set({ toast: null });
  }
}

export const assetBrowserView = new ViewStore();

export function useAssetBrowserView(): AssetBrowserView {
  return React.useSyncExternalStore(
    assetBrowserView.subscribe,
    assetBrowserView.getState,
    assetBrowserView.getServerState
  );
}
