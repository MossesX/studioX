"use client";

/**
 * @file The OPEN conversation — one store, because more than one surface reads
 * it and none of them owns it.
 *
 * The transcript, the composer, the header's cost readout, the library's
 * "currently open" mark and every `claude-workspace.panel` contribution all
 * read this. A `useState` in the module component would mean prop-drilling
 * through a pane tree and would put the stream's lifetime inside a component
 * that a layout change can unmount — which is exactly how a turn ends up
 * orphaned with its events going nowhere. Same reasoning as `taskman/store.ts`
 * and `expenses/tabs.ts`, and the same shape.
 *
 * ── the three things that are genuinely hard here ────────────────────────────
 *
 *  1. **A turn outlives the surface watching it.** Sending navigates nowhere,
 *     but opening another conversation, collapsing a pane or a hot reload all
 *     tear components down mid-stream. So the reader loop lives on the store,
 *     keyed by a generation counter: a stream from a superseded open is dropped
 *     on arrival rather than racing the current one into the same array.
 *  2. **A reload lands mid-answer.** `open()` therefore always attaches, and
 *     the service replays the live turn's buffer before following it. If a turn
 *     is running, the attach becomes a segment with `user: null` — the message
 *     that started it is already in the persisted history, because the service
 *     wrote it before the CLI ran.
 *  3. **Batching.** A fast turn emits hundreds of deltas a second, and one
 *     `setState` per delta is one React commit per delta. Events are buffered
 *     and flushed on a frame, which is the difference between a transcript that
 *     streams and a tab that stutters.
 */
import * as React from "react";

import type { ClaudeSessionEvent, ConversationRecord } from "../../claude/types";
import {
  attachStream,
  cancelTurn,
  getConversation,
  sendTurn,
  startConversation,
  type StartRequest
} from "./client";
import { buildTranscript, EMPTY_TRANSCRIPT } from "./transcript";
import type { TranscriptModel, TurnSegment } from "./transcript";

export interface SessionState {
  /** The open conversation's id, or null when nothing is open. */
  readonly id: string | null;
  readonly record: ConversationRecord | null;
  /** Persisted messages rendered as history — fixed at open. */
  readonly historyCount: number;
  readonly segments: readonly TurnSegment[];
  readonly loading: boolean;
  /** A failure of the WORKSPACE (could not open, could not send), distinct from
   *  a failure of the TURN, which is in the transcript model. */
  readonly error: string | null;
}

const EMPTY: SessionState = {
  id: null,
  record: null,
  historyCount: 0,
  segments: [],
  loading: false,
  error: null
};

type Listener = () => void;

/** Frame-batched, but never longer than this — a hidden tab gets no
 *  `requestAnimationFrame`, and a background conversation whose events silently
 *  stopped landing is the bug this ceiling exists to prevent. */
const FLUSH_MS = 60;

class SessionStore {
  #state: SessionState = EMPTY;
  #listeners = new Set<Listener>();
  /** Bumped on every open. A loop whose generation is stale exits. */
  #generation = 0;
  #pending: ClaudeSessionEvent[] = [];
  #flushHandle: number | null = null;
  #transcriptCache: { key: readonly TurnSegment[]; model: TranscriptModel } | null = null;

  subscribe = (fn: Listener): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  getState = (): SessionState => this.#state;
  /** The server sees an empty session: it has no conversation open and no
   *  fetches to make, so SSR and the first client frame agree. */
  getServerState = (): SessionState => EMPTY;

  #set(patch: Partial<SessionState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const fn of this.#listeners) fn();
  }

  /**
   * The transcript, memoised on the SEGMENT ARRAY's identity.
   *
   * The fold is a pure function of the segments and is not free — it walks
   * every event of every turn. Recomputing it on each of the many renders a
   * single flush triggers would make batching pointless, so the cache key is
   * the array reference, which changes exactly when a flush replaced it.
   */
  transcript(): TranscriptModel {
    const { record, segments, historyCount } = this.#state;
    if (!record) return EMPTY_TRANSCRIPT;
    if (this.#transcriptCache?.key === segments) return this.#transcriptCache.model;
    const model = buildTranscript(record.messages, historyCount, segments);
    this.#transcriptCache = { key: segments, model };
    return model;
  }

  /* --------------------------------- events -------------------------------- */

  #flush = (): void => {
    this.#flushHandle = null;
    if (!this.#pending.length) return;
    const batch = this.#pending;
    this.#pending = [];
    const segments = this.#state.segments;
    if (!segments.length) return;
    const last = segments[segments.length - 1]!;
    // A new array, not a push: the memo key above is the array's identity, and
    // mutating in place would make every flush invisible to it.
    this.#set({
      segments: [
        ...segments.slice(0, -1),
        { ...last, events: [...last.events, ...batch] }
      ]
    });
  };

  #enqueue(event: ClaudeSessionEvent): void {
    this.#pending.push(event);
    if (this.#flushHandle !== null) return;
    this.#flushHandle = window.setTimeout(this.#flush, FLUSH_MS);
  }

  /** Drain the buffer NOW — called at a turn's terminal so the last delta and
   *  the "done" state land in the same commit rather than a frame apart. */
  #flushNow(): void {
    if (this.#flushHandle !== null) {
      window.clearTimeout(this.#flushHandle);
      this.#flushHandle = null;
    }
    this.#flush();
  }

  async #consume(
    stream: AsyncGenerator<ClaudeSessionEvent, void, undefined>,
    generation: number
  ): Promise<void> {
    try {
      for await (const event of stream) {
        // The whole of guard 1 in the header: a stream from a superseded open
        // stops here rather than writing into the conversation that replaced it.
        if (generation !== this.#generation) return;
        this.#enqueue(event);
        if (event.type === "turn-done" || event.type === "turn-error" || event.type === "turn-cancelled") {
          this.#flushNow();
          // The record's cost, title and `cliSessionId` all moved server-side
          // during the turn. Refetched for the METADATA only — `historyCount`
          // deliberately does not move, or the turn just rendered live would be
          // rendered again from disk (see `transcript.ts`).
          void this.#refresh(generation);
        }
      }
    } catch (err) {
      if (generation !== this.#generation) return;
      this.#set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      if (generation === this.#generation) this.#flushNow();
    }
  }

  async #refresh(generation: number): Promise<void> {
    const id = this.#state.id;
    if (!id) return;
    try {
      const record = await getConversation(id);
      if (generation !== this.#generation) return;
      this.#set({ record });
    } catch {
      /* the transcript on screen is still right; a stale cost is not worth an error */
    }
  }

  /* --------------------------------- the verbs ------------------------------ */

  /** Open a conversation: load it, render its history, attach to whatever is
   *  running. Idempotent for the same id while it is already open. */
  async open(id: string): Promise<void> {
    if (this.#state.id === id && this.#state.record && !this.#state.error) return;
    const generation = ++this.#generation;
    this.#pending = [];
    this.#transcriptCache = null;
    this.#set({ id, record: null, historyCount: 0, segments: [], loading: true, error: null });
    try {
      const record = await getConversation(id);
      if (generation !== this.#generation) return;
      this.#set({
        record,
        historyCount: record.messages.length,
        // One segment from the start, so an attached turn's events have
        // somewhere to land without a special case in `#flush`.
        segments: [{ id: `attach-${generation}`, user: null, events: [] }],
        loading: false
      });
      const stream = await attachStream(id);
      if (generation !== this.#generation) return;
      void this.#consume(stream, generation);
    } catch (err) {
      if (generation !== this.#generation) return;
      this.#set({ loading: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Start a new conversation and open it. */
  async start(options: StartRequest): Promise<string> {
    const record = await startConversation(options);
    await this.open(record.id);
    return record.id;
  }

  /** Close whatever is open — the library's "nothing selected" state. */
  close(): void {
    this.#generation++;
    this.#pending = [];
    this.#transcriptCache = null;
    this.#state = EMPTY;
    for (const fn of this.#listeners) fn();
  }

  /**
   * Send one turn.
   *
   * The user message is appended LOCALLY, at the head of its own segment,
   * before the request goes out — so a slow round trip does not leave the
   * composer cleared and the transcript unchanged, which reads as a lost
   * message. The service persists the same text server-side; the two never
   * double because `historyCount` was fixed at open.
   */
  async send(text: string): Promise<void> {
    const id = this.#state.id;
    if (!id) throw new Error("no conversation is open");
    const generation = this.#generation;
    const segment: TurnSegment = {
      id: `turn-${generation}-${this.#state.segments.length}`,
      user: { text, at: new Date().toISOString() },
      events: []
    };
    this.#flushNow();
    this.#set({ segments: [...this.#state.segments, segment], error: null });
    try {
      const stream = await sendTurn(id, text);
      if (generation !== this.#generation) return;
      await this.#consume(stream, generation);
    } catch (err) {
      if (generation !== this.#generation) return;
      this.#set({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Kill the CLI child. A `false` answer means there was nothing running,
   *  which is not an error — the stop button may be pressed twice. */
  async stop(): Promise<boolean> {
    const id = this.#state.id;
    if (!id) return false;
    return cancelTurn(id);
  }

  /** Adopt a record the LIBRARY just changed (a rename, a pin), so the header
   *  does not keep showing the old title until the next turn. */
  adopt(record: ConversationRecord): void {
    if (this.#state.id !== record.id) return;
    this.#set({ record });
  }
}

export const session = new SessionStore();

export function useSession(): SessionState {
  return React.useSyncExternalStore(session.subscribe, session.getState, session.getServerState);
}

/** The folded transcript of whatever is open. Subscribes to the same store, so
 *  it re-reads exactly when a flush lands and the memo does the rest. */
export function useTranscript(): TranscriptModel {
  return React.useSyncExternalStore(
    session.subscribe,
    () => session.transcript(),
    () => EMPTY_TRANSCRIPT
  );
}
