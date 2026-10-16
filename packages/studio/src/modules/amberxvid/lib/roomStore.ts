/**
 * @file The SHARED room store — one JSON file per room under `<root>/rooms/`,
 * read and written by every app process through `fsCore`'s lock.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NO LONGER TRUE
 * ---------------------------------------------------------------------------
 * `calls.ts` and `streams.ts` each used to say, in their own headers, that
 * their registry "lives in process memory pinned to `globalThis`" and that a
 * call or a live room "honestly dies with the server". That was a virtue while
 * it was true: nothing could outlive the process that owned it, so nothing
 * could be a ghost.
 *
 * It is not true any more, and the reason is the whole point of this phase: a
 * registry in one process's memory means the product can run exactly ONE app
 * process — the ceiling that sits underneath every other scaling question.
 * Rooms now live on disk, several processes read and write them, and a room
 * therefore SURVIVES the process that created it.
 *
 * That survival is a liability as well as a feature, and it has exactly one
 * antidote: {@link sweepRooms}. Every participant carries a `heartbeatAt` that
 * the process holding their socket refreshes every
 * `MEDIA_TIMING.heartbeatMs`; a participant whose heartbeat is older than
 * `MEDIA_TIMING.participantTimeoutMs` is dropped by whichever process next
 * looks at the room, and a room that loses its host ends. A crashed process
 * must not leave ghosts in rooms — the sweeper is CORRECTNESS, not
 * optimisation, and it is why "dies honestly with the server" could be given
 * up without the product getting less honest.
 *
 * ---------------------------------------------------------------------------
 * SHAPE
 * ---------------------------------------------------------------------------
 * One record covers both room kinds, because they differ in their payload and
 * their membership RULES, never in their lifecycle: a call is a room with two
 * seats and a {@link CallSession}; a stream is a room with a host seat, N
 * viewer/preview seats, a title and a chat ring. Participants — the part with
 * the heartbeat in it — are common, which is exactly what lets ONE sweeper
 * keep both kinds honest.
 *
 * The vocabulary is P1's (`mediaContract.ts`): `RoomId`, `ParticipantId`,
 * `MediaRole`, `MEDIA_TIMING`. Nothing here imports mediasoup — this is the
 * APP server's record of a room; the media server's router-per-room state
 * (`media-server/rooms.ts`) is its own, and the two meet in P4.
 *
 * Server-only.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { readJson, unlinkQuiet, withStoreLock, writeBytesAtomic, writeJsonAtomic } from "./fsCore";
import { MEDIA_TIMING } from "./mediaContract";
import type { MediaRole, ParticipantId, RoomId } from "./mediaContract";
import { roomsDir } from "./paths";
import type { CallSession, StreamChatMessage } from "./types";

/* --------------------------------- the record ---------------------------------- */

export type RoomKind = "call" | "stream" | "group";

/** One seat in one room. `heartbeatAt` is the liveness fact the sweeper reads. */
export interface StoredParticipant {
  id: ParticipantId;
  /** Normalized (lowercased, trimmed) — the key everything matches on. */
  user: string;
  /** As the caller supplied it — what the UI shows. */
  displayName: string;
  role: MediaRole;
  joinedAt: string;
  /** Refreshed by the process holding this member's socket. Stale ⇒ swept. */
  heartbeatAt: string;
}

/** A stream room's payload. Viewers are participants, not a second list. */
export interface StreamRoomData {
  title: string;
  /**
   * The host's blurb (P12), editable live like the title. Absent on records
   * written before the field existed, which reads as "no description" — the
   * same thing an empty string means, so no migration is owed.
   */
  description?: string;
  /** Ephemeral, capped ring buffer — still gone when the room ends. */
  chat: StreamChatMessage[];
  thumbnailAt: string | null;
  hasThumbnail: boolean;
  /**
   * The most simultaneous real viewers this room has held (P12).
   *
   * Counted while the room is LIVE because it is unrecoverable afterwards: the
   * record is swept minutes after the room ends, and no roster of who was here
   * at once is kept anywhere else. `./streamHistory` copies it out at close.
   */
  peakViewers?: number;
  /**
   * Every DISTINCT member who has watched (normalized), accumulated for the
   * same reason and never pruned when they leave — this is the "how many
   * people saw it" number, not the "who is here now" one, and the latter is
   * already `participants`.
   */
  watchers?: string[];
  /**
   * Members the HOST removed (P12), normalized. A removal has to stick, or it
   * is a click that ejects somebody for as long as it takes them to press
   * Join again — so the list lives on the record and {@link RoomRecord}'s join
   * path refuses anybody on it. It dies with the room, which is the right
   * scope: this is a removal from one broadcast, not a ban from the suite (the
   * moderation wing owns those).
   */
  removed?: string[];
  /**
   * The HOST's `streamViewerLimit` policy row, resolved when the stream opened
   * and PINNED here; `null` is uncapped (P3, `./policy`).
   *
   * Pinned rather than read per join for two reasons, and the second is the one
   * that matters: the join path stays synchronous and reads no policy document
   * on the module's hottest path, and a capacity a room was opened under cannot
   * change underneath the people already in it. An older record with no field
   * reads as `undefined`, which {@link StreamRoomData} consumers treat as
   * uncapped — the behaviour every stream had before this row existed.
   */
  viewerLimit?: number | null;
}

/**
 * A GROUP room's payload (P11) — the N-way video room. Everybody in it
 * publishes and everybody subscribes, so unlike a stream there is no viewer
 * class here: `MediaRole` `host` and `participant` are the only two seats, and
 * `ROLE_RULES` says both publish.
 */
export interface GroupRoomData {
  title: string;
  /**
   * The member cap this room was OPENED under, resolved from the host's policy
   * cascade and pinned — `null` is uncapped. Pinned for the two reasons
   * `StreamRoomData.viewerLimit` is pinned, and the second is again the one
   * that matters: {@link RoomRecord} joins stay synchronous, and a capacity a
   * room was opened under cannot change underneath the people already in it.
   */
  memberLimit?: number | null;
  /**
   * The accounts group thread this room chats in (P5's store), or null before
   * anybody has said anything. The room record OWNS the id; the thread owns the
   * messages. See `./groupRooms` for why the binding is one-directional.
   */
  threadId?: string | null;
}

export interface RoomRecord {
  version: 1;
  id: RoomId;
  kind: RoomKind;
  /** Normalized host username — a call's caller, a stream's broadcaster. */
  host: string;
  hostDisplay: string;
  state: "live" | "ended";
  createdAt: string;
  endedAt: string | null;
  updatedAt: string;
  participants: StoredParticipant[];
  /** Populated for `kind: "call"`, null otherwise. */
  call: CallSession | null;
  /** Populated for `kind: "stream"`, null otherwise. */
  stream: StreamRoomData | null;
  /** Populated for `kind: "group"` (P11), absent on older records. */
  group?: GroupRoomData | null;
}

export const norm = (u: string): string => u.trim().toLowerCase();

/* ---------------------------------- lifetimes ----------------------------------- */

/** An ended room lingers this long so late signals 409 rather than 404. */
const ENDED_LINGER_MS = 5 * 60 * 1000;
/** A live room untouched this long is abandoned garbage — delete the file. */
const ABANDONED_MS = 2 * 60 * 60 * 1000;

const ROOM_ID_RE = /^[a-f0-9-]{8,64}$/;

const roomFile = (id: RoomId): string => path.join(roomsDir(), `${id}.json`);
const posterFile = (id: RoomId): string => path.join(roomsDir(), `${id}.poster`);
const lockName = (id: RoomId): string => `room-${id}`;

/* ----------------------------------- reading ------------------------------------ */

function loadRaw(id: RoomId): RoomRecord | null {
  if (!ROOM_ID_RE.test(id)) return null;
  const rec = readJson<RoomRecord | null>(roomFile(id), null);
  if (!rec || rec.version !== 1 || !Array.isArray(rec.participants)) return null;
  return rec;
}

function roomIds(): RoomId[] {
  try {
    return fs
      .readdirSync(roomsDir())
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5));
  } catch {
    return []; // no rooms directory yet — no rooms
  }
}

/**
 * What one sweep pass did to one room. Returned rather than logged so the
 * caller (and the P3 proof) can SEE a ghost being cleared instead of trusting
 * that it was.
 */
export interface SweepOutcome {
  roomId: RoomId;
  kind: RoomKind;
  /** Normalized usernames whose seats went stale and were dropped. */
  dropped: string[];
  /** True when losing those seats ended the room (the host was one of them). */
  ended: boolean;
  /** True when the whole record was deleted (ended-and-lingered, or abandoned). */
  deleted: boolean;
}

/** Drop stale seats from `rec` in place. Pure — the caller persists. */
function sweepRecord(rec: RoomRecord, now: number): { dropped: string[]; ended: boolean } {
  const dropped: string[] = [];
  if (rec.state !== "live") return { dropped, ended: false };

  const alive: StoredParticipant[] = [];
  for (const p of rec.participants) {
    const age = now - Date.parse(p.heartbeatAt);
    if (Number.isFinite(age) && age > MEDIA_TIMING.participantTimeoutMs) dropped.push(p.user);
    else alive.push(p);
  }
  if (dropped.length === 0) return { dropped, ended: false };
  rec.participants = alive;

  // A GROUP room outlives its host (P11), and it is the one kind that does.
  // For a call the host IS half the call; for a stream the broadcaster IS the
  // room; but a group room is the PEOPLE in it, and ending a meeting because
  // whoever opened it lost their wifi is a bug wearing a rule's clothes. The
  // longest-standing survivor inherits the chair — deterministic, so two
  // processes sweeping the same record concurrently pick the same successor.
  const hostGone = dropped.includes(rec.host);
  if (hostGone && rec.kind === "group" && rec.participants.length > 0) {
    const heir = [...rec.participants].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))[0];
    heir.role = "host";
    rec.host = heir.user;
    rec.hostDisplay = heir.displayName;
    return { dropped, ended: false };
  }

  if (hostGone) {
    rec.state = "ended";
    rec.endedAt = new Date(now).toISOString();
    rec.participants = [];
    if (rec.call && !["ended", "rejected", "failed"].includes(rec.call.state)) {
      rec.call.state = "ended";
      rec.call.endedAt = rec.endedAt;
      rec.call.endReason = "timeout";
    }
  } else if (rec.kind === "call") {
    // A call is provably exactly two seats; losing either one ends it.
    rec.state = "ended";
    rec.endedAt = new Date(now).toISOString();
    rec.participants = [];
    if (rec.call && !["ended", "rejected", "failed"].includes(rec.call.state)) {
      rec.call.state = "ended";
      rec.call.endedAt = rec.endedAt;
      rec.call.endReason = "timeout";
    }
  }
  return { dropped, ended: rec.state === "ended" };
}

/**
 * Sweep every room: drop stale participants, end hostless rooms, delete
 * records that have lingered or been abandoned. Cheap (a handful of small
 * files) and therefore driven from every read as well as from the presence
 * heartbeat — a ghost clears at whichever comes first, on ANY process.
 */
export function sweepRooms(): SweepOutcome[] {
  const now = Date.now();
  const out: SweepOutcome[] = [];

  for (const id of roomIds()) {
    const peek = loadRaw(id);
    if (!peek) {
      // Unparseable or foreign file — leave it alone rather than delete data
      // this version does not understand.
      continue;
    }

    const endedLongAgo =
      peek.state === "ended" && now - Date.parse(peek.endedAt ?? peek.createdAt) > ENDED_LINGER_MS;
    const abandoned = peek.state === "live" && now - Date.parse(peek.updatedAt) > ABANDONED_MS;
    const staleSeat =
      peek.state === "live" &&
      peek.participants.some((p) => now - Date.parse(p.heartbeatAt) > MEDIA_TIMING.participantTimeoutMs);

    if (!endedLongAgo && !abandoned && !staleSeat) continue;

    withStoreLock(lockName(id), () => {
      const rec = loadRaw(id); // re-read under the lock — the peek may be stale
      if (!rec) return;
      const nowIso = new Date().toISOString();

      if (
        (rec.state === "ended" && Date.now() - Date.parse(rec.endedAt ?? rec.createdAt) > ENDED_LINGER_MS) ||
        (rec.state === "live" && Date.now() - Date.parse(rec.updatedAt) > ABANDONED_MS)
      ) {
        unlinkQuiet(roomFile(id));
        unlinkQuiet(posterFile(id));
        out.push({ roomId: id, kind: rec.kind, dropped: [], ended: rec.state === "ended", deleted: true });
        return;
      }

      const swept = sweepRecord(rec, Date.now());
      if (swept.dropped.length === 0) return;
      rec.updatedAt = nowIso;
      writeJsonAtomic(roomFile(id), rec);
      out.push({ roomId: id, kind: rec.kind, dropped: swept.dropped, ended: swept.ended, deleted: false });
    });
  }
  return out;
}

/** One room, swept — or null when it does not exist. */
export function readRoom(id: RoomId): RoomRecord | null {
  const rec = loadRaw(id);
  if (!rec) return null;
  if (rec.state === "live") {
    const now = Date.now();
    const stale = rec.participants.some(
      (p) => now - Date.parse(p.heartbeatAt) > MEDIA_TIMING.participantTimeoutMs,
    );
    if (stale) {
      sweepRooms();
      return loadRaw(id);
    }
  }
  return rec;
}

/** Every room of a kind, swept, newest first. */
export function listRooms(kind?: RoomKind): RoomRecord[] {
  sweepRooms();
  const out: RoomRecord[] = [];
  for (const id of roomIds()) {
    const rec = loadRaw(id);
    if (rec && (kind === undefined || rec.kind === kind)) out.push(rec);
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/* ----------------------------------- writing ------------------------------------ */

export function newParticipant(user: string, role: MediaRole): StoredParticipant {
  const at = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    user: norm(user),
    displayName: user,
    role,
    joinedAt: at,
    heartbeatAt: at,
  };
}

export interface CreateRoomInput {
  kind: RoomKind;
  host: string;
  participants: StoredParticipant[];
  call?: CallSession | null;
  stream?: StreamRoomData | null;
  group?: GroupRoomData | null;
  /** Supply the id when another record already names it (a CallSession's id). */
  id?: RoomId;
}

/** Mint a room. The id IS the file name, so it must match {@link ROOM_ID_RE}. */
export function createRoom(input: CreateRoomInput): RoomRecord {
  const at = new Date().toISOString();
  const rec: RoomRecord = {
    version: 1,
    id: input.id ?? crypto.randomUUID(),
    kind: input.kind,
    host: norm(input.host),
    hostDisplay: input.host,
    state: "live",
    createdAt: at,
    endedAt: null,
    updatedAt: at,
    participants: input.participants,
    call: input.call ?? null,
    stream: input.stream ?? null,
    group: input.group ?? null,
  };
  withStoreLock(lockName(rec.id), () => writeJsonAtomic(roomFile(rec.id), rec));
  return rec;
}

/**
 * Read-modify-write one room under its lock — the ONLY way a room changes.
 * `fn` mutates the record in place and returns whatever the caller needs; the
 * record is swept BEFORE `fn` sees it (so a mutation never lands on a ghost)
 * and persisted after. Null means there is no such room.
 *
 * A refusal (`fn` deciding the caller may not do this) still persists the
 * swept record, which is correct: the sweep is not the caller's to undo, and
 * the freshened `updatedAt` is what keeps the abandoned-room GC honest.
 */
export function mutateRoom<T>(id: RoomId, fn: (rec: RoomRecord) => T): { rec: RoomRecord; value: T } | null {
  return withStoreLock(lockName(id), () => {
    const rec = loadRaw(id);
    if (!rec) return null;
    sweepRecord(rec, Date.now());
    const value = fn(rec);
    rec.updatedAt = new Date().toISOString();
    writeJsonAtomic(roomFile(id), rec);
    return { rec, value };
  });
}

/**
 * Refresh the heartbeat of every seat these members hold, in every room. The
 * process holding a member's SSE socket calls this on its heartbeat tick — a
 * member with no live socket anywhere therefore goes stale and is swept, which
 * is precisely the ghost the store's survival would otherwise create.
 */
export function touchParticipants(users: string[]): void {
  if (users.length === 0) return;
  const keys = new Set(users.map(norm));
  const at = new Date().toISOString();
  for (const id of roomIds()) {
    const peek = loadRaw(id);
    if (!peek || peek.state !== "live") continue;
    if (!peek.participants.some((p) => keys.has(p.user))) continue;
    withStoreLock(lockName(id), () => {
      const rec = loadRaw(id);
      if (!rec || rec.state !== "live") return;
      let touched = false;
      for (const p of rec.participants) {
        if (keys.has(p.user)) {
          p.heartbeatAt = at;
          touched = true;
        }
      }
      if (!touched) return;
      rec.updatedAt = at;
      writeJsonAtomic(roomFile(id), rec);
    });
  }
}

/** Delete a room outright (with its poster) — the admin/moderation path. */
export function deleteRoom(id: RoomId): void {
  withStoreLock(lockName(id), () => {
    unlinkQuiet(roomFile(id));
    unlinkQuiet(posterFile(id));
  });
}

/* ---------------------------------- posters ------------------------------------- */

/** A stream's poster frame lives beside its record as bytes, never as base64
 *  inside the JSON — a 256 KB string in a file every process re-reads is a
 *  cost paid on every roster read for a thing only the `?thumb=` route wants. */
export function readPoster(id: RoomId): Buffer | null {
  try {
    return fs.readFileSync(posterFile(id));
  } catch {
    return null;
  }
}

export function writePoster(id: RoomId, bytes: Buffer): void {
  writeBytesAtomic(posterFile(id), bytes);
}
