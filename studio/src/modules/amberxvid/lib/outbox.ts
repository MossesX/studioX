/**
 * @file The cross-process OUTBOX — a dumb pipe that carries events to whichever
 * app process is holding a user's socket.
 *
 * ---------------------------------------------------------------------------
 * THE HALF A SHARED STORE DOES NOT FIX
 * ---------------------------------------------------------------------------
 * Moving the registries into a shared store (`roomStore.ts`) makes every
 * process agree about STATE. It does nothing about DELIVERY, and delivery is
 * where the single-process ceiling was really nailed down: an SSE connection
 * is a live socket, it exists in exactly one process, and `notifyUsers` used
 * to fan out over the connections THIS process happens to hold. Two app
 * processes, and a call placed on A could not ring a user whose stream was
 * accepted by B — not because A did not know about the call (with the store, it
 * does) but because A cannot write to B's socket.
 *
 * So: any process may APPEND an event for a user; the process holding that
 * user's socket DRAINS it and writes it down the socket. `outbox/<user>/` is
 * the queue, one small JSON file per event, appended under `fsCore`'s lock and
 * deleted after delivery.
 *
 * ---------------------------------------------------------------------------
 * IT DEFINES NO SHAPES
 * ---------------------------------------------------------------------------
 * The event vocabulary is `CrossProcessEvent` in `mediaContract.ts` and this
 * file adds nothing to it — deliberately. A pipe that grows its own schema
 * becomes a second contract to keep in step with the first. The only shape here
 * is the ENVELOPE (sequence, timestamp, addressee), which is transport, not
 * vocabulary.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NO LONGER TRUE, AND THE TTL THAT PAYS FOR IT
 * ---------------------------------------------------------------------------
 * A push used to be a function call into a socket that was, by construction,
 * still open: it either happened immediately or the connection was already
 * gone. Nothing was ever queued, so nothing could ever be STALE. Now an event
 * is a file, and a file outlives the moment it was written — the process that
 * was supposed to drain it can be killed between the write and the read.
 *
 * `MEDIA_TIMING.outboxTtlMs` is the price of that: an event older than the TTL
 * is DELETED, never delivered. A ring that arrives forty-five seconds late is
 * worse than one that never arrives (real phones stop ringing when the caller
 * gives up), and every other kind is a nudge whose truth is re-read from the
 * store anyway, so a late one has nothing to add.
 *
 * ADDRESSING. A user can hold sockets on more than one process (two tabs, two
 * ports). The queue is per USER — that is the layout this phase specifies — so
 * the envelope carries a `holder`: the process the writer intends to deliver
 * it, taken from the presence roster. A drainer takes only files addressed to
 * itself, plus anything unaddressed. Without that, two processes draining the
 * same directory would each swallow half the events and each deliver to only
 * its own tabs.
 *
 * WIN32. `fs.watch` on Windows is best-effort — it can miss events under load
 * and it does not fire for every filesystem — so {@link watchOutbox} always
 * runs a `MEDIA_TIMING.outboxPollMs` poll underneath the watcher. The watcher
 * is the latency optimisation; the poll is the guarantee.
 *
 * Server-only.
 */

import fs from "node:fs";
import path from "node:path";

import { readJson, unlinkQuiet, withStoreLock, writeJsonAtomic } from "./fsCore";
import { MEDIA_TIMING } from "./mediaContract";
import type { CrossProcessEvent } from "./mediaContract";
import { outboxDir } from "./paths";

const norm = (u: string): string => u.trim().toLowerCase();

/** Filesystem-safe queue directory for a user (usernames are already tame,
 *  but a store path must never be able to escape its root). */
const userDir = (user: string): string => path.join(outboxDir(), norm(user).replace(/[^a-z0-9._-]+/g, "_"));

/** The envelope. `event` is the vocabulary; everything else is transport. */
export interface OutboxRecord {
  /** Lexicographically sortable, so file order IS delivery order. */
  seq: string;
  at: string;
  /** Normalized addressee. */
  to: string;
  /** The process this was written for, or null for "whoever holds them". */
  holder: string | null;
  event: CrossProcessEvent;
}

/** Monotonic within a process; the pid breaks ties between processes. */
let counter = 0;

/**
 * Append an event to a user's queue. Cheap and non-throwing: delivery across
 * processes must never be the reason a route fails.
 */
export function enqueue(to: string, holder: string | null, event: CrossProcessEvent): void {
  const key = norm(to);
  try {
    const dir = userDir(key);
    fs.mkdirSync(dir, { recursive: true });
    const seq = `${Date.now().toString().padStart(14, "0")}-${(counter++).toString().padStart(6, "0")}-${process.pid}`;
    const rec: OutboxRecord = { seq, at: new Date().toISOString(), to: key, holder, event };
    withStoreLock(`outbox-${key}`, () => writeJsonAtomic(path.join(dir, `${seq}.json`), rec));
  } catch {
    /* a queue write is best-effort — the store still holds the truth */
  }
}

/** Ensure a user's queue directory exists so `fs.watch` has something to watch. */
export function ensureQueue(user: string): string {
  const dir = userDir(user);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Deliver (and delete) every event in a user's queue that is addressed to
 * `holder`. Events past {@link MEDIA_TIMING.outboxTtlMs} are deleted WITHOUT
 * delivery — see the TTL paragraph in the header.
 *
 * Returns what it did, so the caller (and the proof) can see delivery rather
 * than infer it.
 */
export function drain(
  user: string,
  holder: string,
  deliver: (event: CrossProcessEvent) => void,
): { delivered: number; expired: number } {
  const dir = userDir(user);
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  } catch {
    return { delivered: 0, expired: 0 };
  }

  let delivered = 0;
  let expired = 0;
  const now = Date.now();

  for (const name of files) {
    const file = path.join(dir, name);
    const rec = readJson<OutboxRecord | null>(file, null);
    if (!rec || !rec.event) {
      // Half-written or foreign: a reader can arrive mid-rename. Leave it —
      // the next pass reads the finished file. Anything genuinely broken is
      // collected by the TTL branch below once it is old enough.
      const age = now - fileMtime(file);
      if (age > MEDIA_TIMING.outboxTtlMs) {
        unlinkQuiet(file);
        expired += 1;
      }
      continue;
    }
    if (rec.holder !== null && rec.holder !== holder) continue; // not ours to take

    if (now - Date.parse(rec.at) > MEDIA_TIMING.outboxTtlMs) {
      unlinkQuiet(file);
      expired += 1;
      continue;
    }

    // Delete FIRST, then deliver: a delivery that throws must not leave the
    // event to be re-delivered on every poll forever. At-most-once is the
    // right side of that trade for events whose truth is re-readable.
    unlinkQuiet(file);
    try {
      deliver(rec.event);
      delivered += 1;
    } catch {
      /* the socket died mid-write; the disposer will clean up */
    }
  }
  return { delivered, expired };
}

function fileMtime(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return Date.now();
  }
}

/**
 * Watch a user's queue and drain it. `fs.watch` for latency, a poll underneath
 * it for the guarantee (win32's watcher is best-effort). Returns a disposer;
 * it drains once immediately, so an event queued a moment before the socket
 * opened is not stranded.
 */
export function watchOutbox(
  user: string,
  holder: string,
  deliver: (event: CrossProcessEvent) => void,
): () => void {
  const dir = ensureQueue(user);
  let stopped = false;

  const pass = (): void => {
    if (stopped) return;
    try {
      drain(user, holder, deliver);
    } catch {
      /* never let a queue read kill the stream */
    }
  };

  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(dir, { persistent: false }, () => pass());
  } catch {
    watcher = null; // no watcher on this platform/filesystem — the poll carries it
  }
  const timer = setInterval(pass, MEDIA_TIMING.outboxPollMs);
  if (typeof timer.unref === "function") timer.unref();
  pass();

  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    try {
      watcher?.close();
    } catch {
      /* already closed */
    }
  };
}
