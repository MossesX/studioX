"use client";

/**
 * @file The workspace's UI channel — the seam between plain functions and the
 * React tree.
 *
 * A context-menu command is a plain function registered by NAME (that is the
 * whole of the AmberX menu contract: *"no inline closures in a menu item,
 * ever"*). A plain function has no hooks, no refs and no way to mount a dialog,
 * scroll a scroller, or put text in a textarea. So the commands write here and
 * the components read here — the same shape as `expenses/ui.ts`, for the same
 * reason.
 *
 * ── why these are NONCES and not booleans ────────────────────────────────────
 *
 * "Scroll to the latest message" is an EVENT, not a state, and modelling an
 * event as a boolean produces the bug where doing the same thing twice in a row
 * only works the first time — the second `set(true)` is not a change, so no
 * subscriber fires. A monotonically increasing nonce is always a change, and a
 * component reacts by comparing it with the last one it acted on.
 *
 * `insert` is the exception and carries a payload, so it pairs the nonce with
 * the text. Same rule: inserting the same snippet twice must work twice.
 */
import * as React from "react";

export interface WorkspaceUiState {
  /** Bumped to ask the transcript to scroll to the end. */
  readonly jumpNonce: number;
  /** Bumped to open every tool card. */
  readonly expandNonce: number;
  /** Bumped to close every tool card. */
  readonly collapseNonce: number;
  /** Text for the composer to insert at its caret, with the nonce that carries
   *  it. `text` is meaningless without a changed nonce. */
  readonly insert: { readonly nonce: number; readonly text: string };
  /** Bumped to ask the composer to step back through its history. */
  readonly historyPrevNonce: number;
  /** Bumped to clear the composer's draft. */
  readonly clearDraftNonce: number;
  /** The conversation id whose rename dialog should be open, or null. */
  readonly renaming: string | null;
  /**
   * Whether the project manager is open.
   *
   * A BOOLEAN, and the one exception to the nonce rule above, because this is
   * genuinely a state rather than an event: the dialog is either mounted or it
   * is not, and asking to open an already-open dialog correctly does nothing.
   * The nonces above model things that must be repeatable; "open" is not one.
   */
  readonly projectsOpen: boolean;
  /** A transient message for the snackbar. */
  readonly toast: string | null;
}

const EMPTY: WorkspaceUiState = {
  jumpNonce: 0,
  expandNonce: 0,
  collapseNonce: 0,
  insert: { nonce: 0, text: "" },
  historyPrevNonce: 0,
  clearDraftNonce: 0,
  renaming: null,
  projectsOpen: false,
  toast: null
};

type Listener = () => void;

class WorkspaceUi {
  #state: WorkspaceUiState = EMPTY;
  #listeners = new Set<Listener>();

  subscribe = (fn: Listener): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getState = (): WorkspaceUiState => this.#state;
  getServerState = (): WorkspaceUiState => EMPTY;

  #set(patch: Partial<WorkspaceUiState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const fn of this.#listeners) fn();
  }

  jumpToLatest(): void {
    this.#set({ jumpNonce: this.#state.jumpNonce + 1 });
  }

  expandTools(): void {
    this.#set({ expandNonce: this.#state.expandNonce + 1 });
  }

  collapseTools(): void {
    this.#set({ collapseNonce: this.#state.collapseNonce + 1 });
  }

  insertIntoComposer(text: string): void {
    this.#set({ insert: { nonce: this.#state.insert.nonce + 1, text } });
  }

  historyPrev(): void {
    this.#set({ historyPrevNonce: this.#state.historyPrevNonce + 1 });
  }

  clearDraft(): void {
    this.#set({ clearDraftNonce: this.#state.clearDraftNonce + 1 });
  }

  rename(id: string | null): void {
    this.#set({ renaming: id });
  }

  projects(open: boolean): void {
    if (this.#state.projectsOpen !== open) this.#set({ projectsOpen: open });
  }

  say(toast: string): void {
    this.#set({ toast });
  }

  clearToast(): void {
    if (this.#state.toast !== null) this.#set({ toast: null });
  }
}

export const workspaceUi = new WorkspaceUi();

export function useWorkspaceUi(): WorkspaceUiState {
  return React.useSyncExternalStore(
    workspaceUi.subscribe,
    workspaceUi.getState,
    workspaceUi.getServerState
  );
}

/**
 * Run `effect` whenever `nonce` changes, skipping the initial value.
 *
 * Every nonce consumer needs exactly this, and hand-rolling it per call site is
 * how one of them ends up firing on mount — which would scroll the transcript
 * or clear a draft the moment the screen appears.
 */
export function useNonce(nonce: number, effect: () => void): void {
  const seen = React.useRef(nonce);
  const latest = React.useRef(effect);
  latest.current = effect;
  React.useEffect(() => {
    if (seen.current === nonce) return;
    seen.current = nonce;
    latest.current();
  }, [nonce]);
}

/** Copy to the clipboard and say so — the one place the toast text is decided,
 *  so twenty copy affordances cannot each phrase it differently. */
export async function copyAndSay(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    workspaceUi.say(`Copied ${what}`);
  } catch (err) {
    // A clipboard write fails on an insecure origin and when the document is
    // not focused. Saying so beats a button that silently does nothing.
    workspaceUi.say(`Could not copy ${what}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
