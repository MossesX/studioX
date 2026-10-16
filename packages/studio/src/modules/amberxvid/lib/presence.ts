/**
 * @file AmberX Vid presence registry — who is online RIGHT NOW, and the push
 * channel live messages ride.
 *
 * Online is defined by connection, not polling: a member is online while at
 * least one of their SSE streams (`/api/amberxvid/presence`) is open.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NO LONGER TRUE (P3)
 * ---------------------------------------------------------------------------
 * This header used to say the registry "lives in process memory, pinned to
 * `globalThis` so dev-server HMR re-attaches instead of orphaning connections
 * (the polorec recorder pattern); `lastSeenAt` is the only part that persists".
 * Half of that survives and half of it was the single-process ceiling:
 *
 *  - **The SOCKETS are still per-process, and always will be.** A `push` is a
 *    live `ReadableStream` controller; it exists in one process's heap and
 *    cannot be serialised anywhere. The `globalThis` pin stays for exactly that
 *    reason, and it is not a registry of STATE — it is a handle on this
 *    process's own open file descriptors.
 *  - **The ROSTER is not.** Each process now publishes the connections it
 *    holds into the shared store (`presence/live/<processId>.json`), and "who
 *    is online" is the UNION across every live process — never one process's
 *    opinion. A member connected to process B is online for a client watching
 *    process A, which was simply false before.
 *  - **Delivery is not either.** `notifyUsers` used to be a fan-out over this
 *    process's own connections, so an event for a user whose socket lived
 *    somewhere else was silently dropped: a call placed on A could not ring a
 *    user held by B. It now delivers locally AND writes to that user's outbox
 *    for every OTHER process holding them (`outbox.ts`), which is the half a
 *    shared store does not fix by itself.
 *
 * The price of both is that presence state now OUTLIVES the process that
 * created it, where before it died honestly with the server. Two mechanisms
 * pay it, and neither is optional: a process record older than
 * `MEDIA_TIMING.participantTimeoutMs` is treated as dead and deleted (its
 * users go offline), and the heartbeat below refreshes the room-store seats of
 * every member this process holds, so `roomStore`'s sweeper can clear the
 * participants of a process that crashed. A queued event older than
 * `MEDIA_TIMING.outboxTtlMs` is dropped rather than delivered late.
 *
 * `lastSeenAt` still persists to `<root>/presence/<user>.json` when a member's
 * last connection on THIS process closes, so "last seen" survives a restart.
 *
 * Every roster flip broadcasts to every open stream (buddy lists flip live),
 * and `notifyUsers` is how the messages route hands a fresh message to both
 * participants' clients in the same request that stored it. Server-only.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { listAccounts } from "./accounts";
import { getCall } from "./calls";
import { MEDIA_TIMING } from "./mediaContract";
import type { CrossProcessEvent } from "./mediaContract";
import { enqueue, watchOutbox } from "./outbox";
import { presenceDir, presenceLiveDir } from "./paths";
import { sweepRooms, touchParticipants } from "./roomStore";
import { archiveClosure, detachEverywhere, endStreamsHostedBy, listStreams, streamingIdFor } from "./streams";
import { leaveAllRooms, listGroupRooms } from "./groupRooms";
import { readJson, unlinkQuiet, writeJsonAtomic } from "./fsCore";
import type { MessengerEvent, Presence } from "./types";

type Push = (event: MessengerEvent) => void;

interface Registry {
  /** username (lowercased) → the live pushes of every open stream. */
  conns: Map<string, Set<Push>>;
  /** username (lowercased) → its outbox drainer disposer. */
  drains: Map<string, () => void>;
  /** This process's identity in the shared store — stable across HMR. */
  processId: string;
  heartbeat: ReturnType<typeof setInterval> | null;
}

const REGISTRY_KEY = "__amberxvidPresence";

function registry(): Registry {
  const g = globalThis as unknown as Record<string, Registry | undefined>;
  if (!g[REGISTRY_KEY]) {
    g[REGISTRY_KEY] = {
      conns: new Map(),
      drains: new Map(),
      processId: `${process.pid}-${crypto.randomUUID().slice(0, 8)}`,
      heartbeat: null,
    };
  }
  return g[REGISTRY_KEY];
}

/** Who this process is in `presence/live/` — the outbox's delivery address. */
export const processId = (): string => registry().processId;

const norm = (u: string): string => u.trim().toLowerCase();
const lastSeenFile = (user: string): string => path.join(presenceDir(), `${norm(user)}.json`);

/* --------------------------------- last seen ----------------------------------- */

function readLastSeen(user: string): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(lastSeenFile(user), "utf8")) as { lastSeenAt?: string };
    return typeof raw.lastSeenAt === "string" ? raw.lastSeenAt : null;
  } catch {
    return null;
  }
}

async function writeLastSeen(user: string): Promise<void> {
  try {
    await fsp.mkdir(presenceDir(), { recursive: true });
    await fsp.writeFile(
      lastSeenFile(user),
      `${JSON.stringify({ username: norm(user), lastSeenAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    );
  } catch {
    /* last-seen is best-effort — presence must never fail on disk trouble */
  }
}

/* ------------------------- the cross-process roster ----------------------------- */

/** One live app process's published connections. */
interface ProcessPresence {
  version: 1;
  processId: string;
  pid: number;
  updatedAt: string;
  /** Normalized usernames whose sockets this process holds. */
  users: string[];
}

const processFile = (id: string): string => path.join(presenceLiveDir(), `${id}.json`);

/** Publish (or, when we hold nobody, withdraw) this process's record. */
function publishConnections(): void {
  const reg = registry();
  const users = [...reg.conns.keys()];
  try {
    if (users.length === 0) {
      unlinkQuiet(processFile(reg.processId));
      return;
    }
    fs.mkdirSync(presenceLiveDir(), { recursive: true });
    const rec: ProcessPresence = {
      version: 1,
      processId: reg.processId,
      pid: process.pid,
      updatedAt: new Date().toISOString(),
      users,
    };
    writeJsonAtomic(processFile(reg.processId), rec);
  } catch {
    /* a roster publish must never fail a connection */
  }
}

/**
 * Every process whose record is FRESH. A record older than the participant
 * timeout belongs to a process that died — it is deleted here, which is what
 * takes its members offline for everyone else.
 */
function liveProcesses(): ProcessPresence[] {
  let files: string[];
  try {
    files = fs.readdirSync(presenceLiveDir()).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: ProcessPresence[] = [];
  const now = Date.now();
  for (const f of files) {
    const file = path.join(presenceLiveDir(), f);
    const rec = readJson<ProcessPresence | null>(file, null);
    if (!rec || !Array.isArray(rec.users)) continue;
    if (now - Date.parse(rec.updatedAt) > MEDIA_TIMING.participantTimeoutMs) {
      // Its process is gone. Deleting the record is the ONLY thing that makes
      // its members offline, so this is correctness, not tidying.
      unlinkQuiet(file);
      continue;
    }
    out.push(rec);
  }
  return out;
}

/** The union: every user held by any live process, plus our own. */
function onlineUsers(): Set<string> {
  const users = new Set<string>(registry().conns.keys());
  for (const p of liveProcesses()) for (const u of p.users) users.add(u);
  return users;
}

/** The processes (other than this one) holding a user's sockets. */
function remoteHolders(user: string): string[] {
  const me = registry().processId;
  const key = norm(user);
  return liveProcesses()
    .filter((p) => p.processId !== me && p.users.includes(key))
    .map((p) => p.processId);
}

/* ---------------------------------- roster ------------------------------------- */

export function isOnline(user: string): boolean {
  const key = norm(user);
  if ((registry().conns.get(key)?.size ?? 0) > 0) return true;
  return liveProcesses().some((p) => p.users.includes(key));
}

/** The full roster: every entered member, online = has a live stream ANYWHERE. */
export async function presenceSnapshot(): Promise<Presence[]> {
  const accounts = await listAccounts();
  // One directory read for the whole roster — `isOnline` per row would re-read
  // `presence/live/` once per account.
  const online = onlineUsers();
  return accounts
    .filter((a) => a.disabled !== true && a.screenname !== null && !a.mustChangePassword)
    .map((a) => {
      const isUp = online.has(norm(a.username));
      return {
        username: a.username,
        online: isUp,
        lastSeenAt: isUp ? new Date().toISOString() : (readLastSeen(a.username) ?? a.lastLoginAt ?? a.updatedAt),
        // "Live" is derived here, from the shared room store, so every consumer
        // of the roster gets the same truth without asking a second question —
        // and now gets it even when the broadcast started on another process.
        streamingId: isUp ? streamingIdFor(a.username) : null,
      };
    });
}

/* -------------------------------- broadcasting ---------------------------------- */

/** Push to a user's sockets on THIS process only. */
function pushLocal(user: string, event: MessengerEvent): void {
  const pushes = registry().conns.get(norm(user));
  if (pushes) for (const push of pushes) push(event);
}

/**
 * How a client-facing event crosses a process boundary.
 *
 * Preference order, and it is the contract's: a NUDGE when the shared store
 * already holds the truth (the receiving process re-reads it and is therefore
 * never stale), a passthrough only for events nothing stores — the mesh's
 * relay frames, and the messenger's own message push, whose thread belongs to
 * a subsystem outside this project's scope fence.
 */
function crossFor(event: MessengerEvent, to: string): CrossProcessEvent {
  const at = new Date().toISOString();
  if (event.type === "call" && event.signal.kind === "invite") {
    return { kind: "ring", callId: event.signal.callId, from: event.signal.from, to: norm(to), at };
  }
  return { kind: "passthrough", to: norm(to), at, frame: event };
}

/** Queue an event for every OTHER process holding this user (two tabs on two
 *  ports are two holders, and both must see it). */
function crossDeliver(user: string, event: MessengerEvent, cross?: CrossProcessEvent): void {
  const key = norm(user);
  const holders = remoteHolders(key);
  if (holders.length === 0) return;
  const payload = cross ?? crossFor(event, key);
  for (const holder of holders) enqueue(key, holder, payload);
}

/**
 * Push an event to every open stream (roster flips) — on this process, and on
 * every other process holding a member's socket.
 *
 * `cross` overrides the derived envelope when the caller knows a better nudge
 * than the event alone can express (which user flipped, which room changed).
 */
export function broadcastAll(event: MessengerEvent, cross?: CrossProcessEvent): void {
  for (const pushes of registry().conns.values()) {
    for (const push of pushes) push(event);
  }
  const me = registry().processId;
  const mine = registry().conns;
  for (const proc of liveProcesses()) {
    if (proc.processId === me) continue;
    for (const user of proc.users) {
      if (mine.has(user)) continue; // already pushed down our own socket
      enqueue(user, proc.processId, cross ?? crossFor(event, user));
    }
  }
}

/**
 * Push an event to specific members' streams (live message delivery, call
 * signalling). Local sockets first, then the outbox for everyone else — the
 * two halves of "reach this member wherever they are".
 */
export function notifyUsers(users: string[], event: MessengerEvent, cross?: CrossProcessEvent): void {
  for (const user of users) {
    pushLocal(user, event);
    crossDeliver(user, event, cross);
  }
}

async function broadcastRoster(flip?: { user: string; online: boolean }): Promise<void> {
  const roster = await presenceSnapshot();
  broadcastAll(
    { type: "roster", roster },
    flip
      ? { kind: "presence-flip", user: norm(flip.user), online: flip.online, at: new Date().toISOString() }
      : undefined,
  );
}

/* ----------------------------- receiving from a peer ----------------------------- */

/**
 * Turn a queued {@link CrossProcessEvent} into what this process's sockets
 * expect. A nudge is re-read from the shared store here; that is the whole
 * reason nudges are preferred — the event says "look again", and looking again
 * cannot be stale.
 */
function deliverCross(user: string, event: CrossProcessEvent): void {
  switch (event.kind) {
    case "ring": {
      // Re-read the call rather than believing the queued copy: a ring whose
      // call was answered, rejected or swept while it sat in the queue must
      // not ring at all.
      const session = getCall(event.callId);
      if (!session || ["ended", "rejected", "failed"].includes(session.state)) return;
      pushLocal(user, {
        type: "call",
        signal: { kind: "invite", callId: session.id, from: session.from, to: session.to, at: session.createdAt },
      });
      break;
    }
    case "presence-flip":
      void presenceSnapshot().then((roster) => pushLocal(user, { type: "roster", roster }));
      break;
    case "room-updated":
      pushLocal(user, { type: "streams", streams: listStreams() });
      break;
    case "passthrough":
      // The one kind with no store behind it — hand the frame to the socket
      // exactly as the writing process built it. See the `passthrough` docblock
      // in mediaContract.ts for why it is typed `unknown` and why it shrinks.
      pushLocal(user, event.frame as MessengerEvent);
      break;
  }
}

/* --------------------------------- heartbeat ------------------------------------ */

/**
 * The tick that makes survival safe. It refreshes this process's published
 * record, refreshes the room-store seats of every member we hold, and sweeps.
 * A process that crashes simply stops ticking: within
 * `MEDIA_TIMING.participantTimeoutMs` its record is deleted by any other
 * process's read, and its members' seats are dropped by the store's sweeper.
 */
function tick(): void {
  const reg = registry();
  if (reg.conns.size === 0) return;
  publishConnections();
  touchParticipants([...reg.conns.keys()]);
  try {
    const swept = sweepRooms();
    if (swept.some((o) => o.dropped.length > 0 || o.ended)) {
      // Somebody's ghosts just cleared — everyone's stream list and roster are
      // now wrong on screen until we say so.
      broadcastAll({ type: "streams", streams: listStreams() });
      void broadcastRoster();
    }
  } catch {
    /* a sweep must never take the presence channel down */
  }
}

function startHeartbeat(): void {
  const reg = registry();
  if (reg.heartbeat) return;
  const timer = setInterval(tick, MEDIA_TIMING.heartbeatMs);
  if (typeof timer.unref === "function") timer.unref();
  reg.heartbeat = timer;
}

function stopHeartbeat(): void {
  const reg = registry();
  if (!reg.heartbeat) return;
  clearInterval(reg.heartbeat);
  reg.heartbeat = null;
}

/** Drive one heartbeat tick by hand — the proof harness and any future
 *  in-process test needs the sweep without waiting out the cadence. */
export function heartbeatNow(): void {
  tick();
}

/* -------------------------------- connections ----------------------------------- */

/**
 * Register a member's stream. When it is their FIRST open stream on this
 * process we publish it to the shared roster, start draining their outbox, and
 * the roster flips online for everyone (on every process); the returned
 * disposer un-registers, and the last stream closing flips them offline +
 * stamps `lastSeenAt`.
 */
export function connect(user: string, push: Push): () => void {
  const reg = registry();
  const key = norm(user);
  let pushes = reg.conns.get(key);
  const cameOnline = !pushes || pushes.size === 0;
  if (!pushes) {
    pushes = new Set();
    reg.conns.set(key, pushes);
  }
  pushes.add(push);
  if (cameOnline) {
    // Publish BEFORE broadcasting: the roster we are about to send must
    // include us, and other processes must be able to address their outbox
    // writes at us from this moment on.
    publishConnections();
    startHeartbeat();
    reg.drains.get(key)?.();
    reg.drains.set(
      key,
      watchOutbox(key, reg.processId, (event) => deliverCross(key, event)),
    );
    void broadcastRoster({ user: key, online: true });
  }

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const set = reg.conns.get(key);
    set?.delete(push);
    if (set && set.size === 0) {
      reg.conns.delete(key);
      reg.drains.get(key)?.();
      reg.drains.delete(key);
      publishConnections();
      if (reg.conns.size === 0) stopHeartbeat();
      void writeLastSeen(key);
      // A member whose LAST connection closed cannot be hosting or watching
      // anything any more — end their rooms, tell the viewers, drop their
      // viewer seats, and let everyone's badges catch up in one broadcast.
      //
      // NOTE this is still the right thing when they are connected on ANOTHER
      // process: `endStreamsHostedBy` reads the shared store, and a member who
      // is genuinely still online elsewhere is still in the roster union — so
      // the flip below reports what the union says, not what this process
      // wishes.
      const endedRooms = endStreamsHostedBy(key);
      for (const { info, attached, closure } of endedRooms) {
        notifyUsers(attached, { type: "stream-signal", signal: { kind: "ended", streamId: info.id, from: info.host } });
        // P12: a stream that ended because its host's wifi died still owes the
        // same history rows as one ended with the button — this is the path a
        // history written only in the route would silently skip, and it is the
        // one that happens most.
        void archiveClosure(closure);
      }
      // No host is signalled per departure any more (P7): the host holds no
      // per-viewer connection to close — the fresh `streams` broadcast is the
      // whole of what a departure changes on anyone's screen.
      const watchedChanged = detachEverywhere(key);
      if (endedRooms.length || watchedChanged.length) {
        broadcastAll({ type: "streams", streams: listStreams() });
      }
      // P11 — the same reasoning one kind over: a member with no connection
      // left cannot be sitting in a group room either, and their tile would
      // otherwise stay in everyone's grid until the heartbeat sweeper caught
      // it. The room survives their departure (the chair passes to the
      // longest-standing survivor); only the LAST member out ends it.
      const leftRooms = leaveAllRooms(key);
      for (const { info, ended } of leftRooms) {
        if (ended) continue; // nobody left in it to tell
        notifyUsers(
          info.members.map((m) => m.displayName),
          { type: "rooms", rooms: listGroupRooms() },
        );
      }
      if (leftRooms.length) broadcastAll({ type: "rooms", rooms: listGroupRooms() });
      void broadcastRoster({ user: key, online: isOnline(key) });
    }
  };
}
