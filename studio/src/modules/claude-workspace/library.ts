"use client";

/**
 * @file The conversation LIBRARY — `axf-claude` P3's second step, verbatim:
 * *"every conversation with title, timestamp, model, cost; full-text search
 * across message bodies; pin, rename, delete, export."*
 *
 * A store rather than component state for the same reason `session.ts` is one,
 * plus one of its own: the library and the open conversation must agree. A
 * rename typed in the library has to reach the transcript header, and a
 * conversation deleted while it is open has to close the transcript rather than
 * leave a screen pointed at a record that no longer exists. Those are two
 * stores talking, and they do it through explicit calls here — not through a
 * shared mutable object, which is how they would drift.
 *
 * ── search: server-side, debounced, and cancellable ──────────────────────────
 *
 * The bodies live on the server and the client holds only metas, so search is a
 * request. Three details that are the difference between a search box and a
 * stutter:
 *
 *   - **Debounced**, because the box searches as you type and each keystroke is
 *     a full scan of the corpus.
 *   - **Cancelled on supersede** via `AbortSignal`, so a slow response for
 *     "cla" cannot land after the fast one for "claude" and repaint the older
 *     answer. That is the classic race and it is invisible until the day the
 *     corpus is big.
 *   - **The query is echoed back** by the route and checked here before the
 *     hits are adopted. Abort is best-effort; the echo is the proof.
 */
import * as React from "react";

import { exportConversation, type ExportFormat } from "../../claude/export";
import type { ConversationMeta, ConversationRecord, SearchHit } from "../../claude/types";
import {
  deleteConversation,
  getConversation,
  listConversations,
  patchConversation,
  searchConversations
} from "./client";
import { session } from "./session";

export interface LibraryState {
  readonly conversations: readonly ConversationMeta[];
  readonly query: string;
  /** Null while no search is in effect — distinct from an empty array, which
   *  means "searched, found nothing". */
  readonly hits: readonly SearchHit[] | null;
  readonly loading: boolean;
  readonly searching: boolean;
  readonly error: string | null;
  /** True once the first list has landed, so the pane can tell "empty library"
   *  from "not loaded yet" — the two look identical and read very differently. */
  readonly ready: boolean;
}

const EMPTY: LibraryState = {
  conversations: [],
  query: "",
  hits: null,
  loading: false,
  searching: false,
  error: null,
  ready: false
};

/** Long enough that a typist does not fire a scan per character, short enough
 *  that the list feels live. */
export const SEARCH_DEBOUNCE_MS = 220;

type Listener = () => void;

/** Pinned first, then most recent activity — the one ordering, stated once.
 *  `search.ts` sorts hits by the same rule so a search result list and the list
 *  it replaces do not reorder under the reader. */
export function orderMetas(metas: readonly ConversationMeta[]): ConversationMeta[] {
  return [...metas].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt)
  );
}

class LibraryStore {
  #state: LibraryState = EMPTY;
  #listeners = new Set<Listener>();
  #searchTimer: number | null = null;
  #searchAbort: AbortController | null = null;

  subscribe = (fn: Listener): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getState = (): LibraryState => this.#state;
  getServerState = (): LibraryState => EMPTY;

  #set(patch: Partial<LibraryState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const fn of this.#listeners) fn();
  }

  /* --------------------------------- listing -------------------------------- */

  async refresh(): Promise<void> {
    this.#set({ loading: true, error: null });
    try {
      const conversations = orderMetas(await listConversations());
      this.#set({ conversations, loading: false, ready: true });
    } catch (err) {
      this.#set({
        loading: false,
        ready: true,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  /**
   * Fold a record's new state into the list without a round trip.
   *
   * Called after every mutation. Refetching the whole list instead would be
   * simpler and is what makes a library flicker: the row you just renamed
   * disappears and returns a moment later, and if the fetch fails the rename
   * silently looks undone despite having been persisted.
   */
  #adopt(record: ConversationRecord): void {
    const meta: ConversationMeta = {
      id: record.id,
      title: record.title,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      cliSessionId: record.cliSessionId,
      cwd: record.cwd,
      model: record.model,
      effort: record.effort,
      permissionMode: record.permissionMode,
      totalCostUsd: record.totalCostUsd,
      pinned: record.pinned === true,
      // Carried through, or a rename would drop the row out of its project's
      // filter until the next full refresh.
      projectId: record.projectId ?? null,
      messageCount: record.messages.length,
      preview: this.#state.conversations.find((c) => c.id === record.id)?.preview ?? ""
    };
    const conversations = orderMetas([
      ...this.#state.conversations.filter((c) => c.id !== record.id),
      meta
    ]);
    // A live search must reflect the change too, or a renamed row keeps its old
    // title until the query is cleared.
    const hits =
      this.#state.hits?.map((hit) => (hit.meta.id === record.id ? { ...hit, meta } : hit)) ?? null;
    this.#set({ conversations, hits });
    session.adopt(record);
  }

  /* --------------------------------- search --------------------------------- */

  setQuery(query: string): void {
    this.#set({ query });
    if (this.#searchTimer !== null) window.clearTimeout(this.#searchTimer);
    this.#searchAbort?.abort();
    this.#searchAbort = null;

    if (!query.trim()) {
      // A cleared box shows the library again — not an empty result set. The
      // route makes the same distinction for the same reason.
      this.#set({ hits: null, searching: false });
      return;
    }
    this.#set({ searching: true });
    this.#searchTimer = window.setTimeout(() => void this.#runSearch(query), SEARCH_DEBOUNCE_MS);
  }

  async #runSearch(query: string): Promise<void> {
    const abort = new AbortController();
    this.#searchAbort = abort;
    try {
      const hits = await searchConversations(query, abort.signal);
      // The echo check: abort is best-effort and a response already in flight
      // still resolves. Adopting it would repaint an older query's answer.
      if (this.#state.query !== query) return;
      this.#set({ hits, searching: false, error: null });
    } catch (err) {
      if (abort.signal.aborted || this.#state.query !== query) return;
      this.#set({ searching: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  /* ------------------------------- the verbs -------------------------------- */

  async rename(id: string, title: string): Promise<void> {
    this.#adopt(await patchConversation(id, { title }));
  }

  async setPinned(id: string, pinned: boolean): Promise<void> {
    this.#adopt(await patchConversation(id, { pinned }));
  }

  /**
   * Delete, and close the transcript if it was the open one.
   *
   * The close happens AFTER the server confirms, never optimistically: the
   * service refuses a delete while a turn is running, and closing first would
   * throw away a live answer to a request that is about to be refused.
   */
  async remove(id: string): Promise<boolean> {
    const deleted = await deleteConversation(id);
    if (!deleted) return false;
    this.#set({
      conversations: this.#state.conversations.filter((c) => c.id !== id),
      hits: this.#state.hits?.filter((hit) => hit.meta.id !== id) ?? null
    });
    if (session.getState().id === id) session.close();
    return true;
  }

  /**
   * Export a conversation as a download.
   *
   * The formatting is `claude/export.ts` — pure, isomorphic, and shared with
   * anything else that ever needs the same bytes. What lives here is only the
   * browser half: fetch the record (the list holds metas, not bodies), make an
   * object URL, click it, revoke it. Revoking matters — an un-revoked blob URL
   * pins the whole transcript in memory for the life of the document.
   */
  async export(id: string, format: ExportFormat): Promise<string> {
    const record = await getConversation(id);
    const file = exportConversation(record, format);
    const url = URL.createObjectURL(new Blob([file.text], { type: `${file.mediaType};charset=utf-8` }));
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.filename;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      // Deferred: revoking synchronously after `click()` races the browser's
      // own read of the URL in some engines, and the download arrives empty.
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
    return file.filename;
  }
}

export const library = new LibraryStore();

export function useLibrary(): LibraryState {
  return React.useSyncExternalStore(library.subscribe, library.getState, library.getServerState);
}

/** The rows a pane should draw: the search hits when searching, otherwise the
 *  whole list. One definition, so the pane and the commands cannot disagree
 *  about what "the current row set" is. */
export function visibleMetas(state: LibraryState): readonly ConversationMeta[] {
  return state.hits ? state.hits.map((hit) => hit.meta) : state.conversations;
}
