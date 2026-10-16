/**
 * @file AmberX Vid live-stream rooms — the server half of member broadcasting.
 *
 * A stream is one member (the host) publishing ONE upstream to the media
 * server (P7 — the mediasoup SFU fans it to every watcher; the host's uplink
 * is constant regardless of audience size). This file is the ROOM side of
 * that: records of kind `stream` in the shared room store (`roomStore.ts`),
 * so every app process sees the same rooms and a room outlives the process
 * that opened it. Who holds a seat here is what the media route mints
 * participant tokens from — the record is the authority the media plane
 * follows, never the other way round.
 *
 * WHAT IS NO LONGER TRUE (P7). This file used to end with a strict
 * sdp/ice signal whitelist (`sanitizeStreamSignal`) relaying offers, answers
 * and candidates host ⇄ each viewer — the per-viewer mesh's wiring. That
 * relay is DELETED with the mesh: media setup is mediasoup vocabulary over
 * `/api/amberxvid/media`, and SDP never transits the app server for a stream
 * again (`MEDIA_CONTRACT.signaling`). What remains is room bookkeeping:
 * lifecycle, seats, chat, posters.
 *
 * A room becoming a ghost — a stream nobody is broadcasting, still listed,
 * still joinable — is handled by the store's sweeper: every seat carries a
 * heartbeat refreshed by the process holding that member's socket, and a room
 * whose HOST goes stale (`MEDIA_TIMING.participantTimeoutMs`) is ended by
 * whichever process next looks at it. The group chat is a capped ring buffer
 * that dies with the record (decision 2026-08-04).
 *
 * The differences from a call, and why a stream is still its own shape on top
 * of the shared record:
 *   - membership is 1 host + N viewers (a call is provably exactly two);
 *   - media is one-way (host → viewer), so there is no accept/ring ceremony —
 *     joining a public room needs no consent from the host;
 *   - viewers come in two kinds: real watchers, and hidden 15 s hover
 *     PREVIEWS (a thumbnail playing live under the pointer). Previews get
 *     media but stay out of the viewer list and the chat, and their seat is
 *     LEASED (`MEDIA_TIMING.previewLeaseMs`): the server drops it on expiry —
 *     under the mesh the 15 s clock was a client honour system.
 *
 * Server-only.
 */

import crypto from "node:crypto";
import { MEDIA_TIMING } from "./mediaContract";
import { assertCanHostStreams, assertStreamViewerRoom, hostStreamViewerLimit } from "./policy";
import {
  createRoom,
  listRooms,
  mutateRoom,
  newParticipant,
  norm,
  readPoster,
  readRoom,
  writePoster,
} from "./roomStore";
import type { RoomRecord, StoredParticipant } from "./roomStore";
import { recordStreamEnded, recordWatch } from "./streamHistory";
import type { WatchSummary } from "./streamHistory";
import {
  STREAM_CHAT_KEEP,
  STREAM_CHAT_MAX,
  STREAM_DESCRIPTION_MAX,
  STREAM_TITLE_MAX,
  type StreamChatMessage,
  type StreamInfo,
} from "./types";

/* --------------------------------- the store ----------------------------------- */

/** The hover-preview seat lease (P7) — one number, owned by the contract. The
 *  media bridge's keepalive enforces the same lease on the media seat, so an
 *  expired preview loses its record seat AND its consumers together. Measured
 *  from `joinedAt`, not the heartbeat: a preview is time-boxed by design, so
 *  an ALIVE preview still expires. */
const PREVIEW_LEASE_MS = MEDIA_TIMING.previewLeaseMs;

/** Poster frames are small jpegs; anything bigger is not a poster. */
export const THUMBNAIL_MAX_BYTES = 262_144;

const isViewer = (p: StoredParticipant): boolean => p.role === "viewer" || p.role === "preview";

/** Drop expired hover previews from a record in place. Returns true if it
 *  changed, so a read can decide whether it needs to persist. */
function dropStalePreviews(rec: RoomRecord): boolean {
  const now = Date.now();
  const keep = rec.participants.filter(
    (p) => p.role !== "preview" || now - Date.parse(p.joinedAt) <= PREVIEW_LEASE_MS,
  );
  if (keep.length === rec.participants.length) return false;
  rec.participants = keep;
  return true;
}

/** Every live stream room, previews swept, newest first. */
function liveRooms(): RoomRecord[] {
  const out: RoomRecord[] = [];
  for (const rec of listRooms("stream")) {
    if (rec.state !== "live") continue;
    const needsSweep = rec.participants.some(
      (p) => p.role === "preview" && Date.now() - Date.parse(p.joinedAt) > PREVIEW_LEASE_MS,
    );
    if (needsSweep) {
      const swept = mutateRoom(rec.id, (r) => {
        dropStalePreviews(r);
        return true;
      });
      if (swept) {
        out.push(swept.rec);
        continue;
      }
    }
    out.push(rec);
  }
  return out;
}

function streamRoom(streamId: string): RoomRecord | null {
  const rec = readRoom(streamId);
  return rec && rec.kind === "stream" && rec.stream !== null ? rec : null;
}

function liveRoom(streamId: string): RoomRecord | null {
  const rec = streamRoom(streamId);
  return rec && rec.state === "live" ? rec : null;
}

/* ---------------------------------- reading ------------------------------------ */

/** The wire view of a room. Takes the stored record now that the room IS the
 *  record — there is no second in-memory shape to convert from. */
export function streamInfo(rec: RoomRecord): StreamInfo {
  const watchers: string[] = [];
  let previews = 0;
  for (const p of rec.participants) {
    if (p.role === "preview") previews += 1;
    else if (p.role === "viewer") watchers.push(p.displayName);
  }
  return {
    id: rec.id,
    host: rec.hostDisplay,
    title: rec.stream?.title ?? "Live stream",
    description: rec.stream?.description ?? "",
    startedAt: rec.createdAt,
    viewers: watchers,
    previews,
    // Never below what is on screen right now: an older record has no stored
    // peak, and a peak that reads lower than the live count would be visibly
    // wrong on the one surface that shows both.
    peakViewers: Math.max(rec.stream?.peakViewers ?? 0, watchers.length),
    hasThumbnail: rec.stream?.hasThumbnail === true,
    thumbnailAt: rec.stream?.thumbnailAt ?? null,
  };
}

/**
 * What a finished room hands to `./streamHistory` — assembled from the RECORD
 * while it still exists, because the sweeper deletes it minutes later and
 * `peakViewers` / the distinct-watcher set exist nowhere else (P12).
 */
export interface StreamClosure {
  streamId: string;
  host: string;
  /** As the host typed it — what a watcher's history row shows. */
  hostDisplay: string;
  title: string;
  description: string;
  startedAt: string;
  endedAt: string;
  peakViewers: number;
  /** Every distinct member who watched at any point, normalized. */
  watchers: string[];
  /** The seats still attached at close — one watch-history row each. */
  attachedSeats: { user: string; displayName: string; joinedAt: string }[];
}

/** Read a closure off a record whose seats are still present. Call BEFORE
 *  clearing `participants`. */
function closureOf(rec: RoomRecord, endedAt: string): StreamClosure {
  const attachedSeats = rec.participants
    .filter((p) => p.role === "viewer")
    .map((p) => ({ user: p.user, displayName: p.displayName, joinedAt: p.joinedAt }));
  const live = attachedSeats.map((p) => p.user);
  const watchers = [...new Set([...(rec.stream?.watchers ?? []), ...live])];
  return {
    streamId: rec.id,
    host: rec.host,
    hostDisplay: rec.hostDisplay,
    title: rec.stream?.title ?? "Live stream",
    description: rec.stream?.description ?? "",
    startedAt: rec.createdAt,
    endedAt,
    peakViewers: Math.max(rec.stream?.peakViewers ?? 0, live.length),
    watchers,
    attachedSeats,
  };
}

/** Every live room, newest first — the streams tab and the SSE broadcast. */
export function listStreams(): StreamInfo[] {
  return liveRooms().map(streamInfo);
}

/** The live stream this member is HOSTING, if any — feeds `Presence.streamingId`. */
export function streamingIdFor(user: string): string | null {
  const u = norm(user);
  for (const rec of liveRooms()) {
    if (rec.host === u) return rec.id;
  }
  return null;
}

/** The live room a member is currently WATCHING (non-preview), if any. */
export function watchingStreamFor(user: string): StreamInfo | null {
  const u = norm(user);
  for (const rec of liveRooms()) {
    if (rec.participants.some((p) => p.user === u && p.role === "viewer")) return streamInfo(rec);
  }
  return null;
}

export function getChat(streamId: string): StreamChatMessage[] {
  return streamRoom(streamId)?.stream?.chat.slice() ?? [];
}

export function getThumbnail(streamId: string): Buffer | null {
  const rec = streamRoom(streamId);
  return rec && rec.stream?.hasThumbnail ? readPoster(streamId) : null;
}

/* --------------------------------- lifecycle ------------------------------------ */

export type StreamResult<T> = { ok: true; value: T } | { ok: false; error: string; status: number };

const fail = (error: string, status: number): { ok: false; error: string; status: number } => ({
  ok: false,
  error,
  status,
});

/**
 * Go live. One live room per host — going live twice is a client bug.
 *
 * **Async since P3**, and the reason is the policy cascade: `canHostStreams`
 * decides whether this member may broadcast at all, and `streamViewerLimit`
 * decides how many people may watch. Both are the HOST's rows, both are read
 * here, and the second is pinned onto the record so that {@link joinStream}
 * stays synchronous (see `StreamRoomData.viewerLimit`).
 *
 * The check is in the STORE rather than the route on purpose. A guard on the
 * route is a guard the next route forgets; this is the one door into a stream
 * record, so a stream that exists is a stream whose host was allowed one.
 */
export async function openStream(
  host: string,
  titleRaw: unknown,
  descriptionRaw?: unknown,
): Promise<StreamResult<StreamInfo>> {
  const allowed = await assertCanHostStreams(host);
  if (!allowed.ok) return fail(allowed.error, allowed.status);
  if (streamingIdFor(host)) return fail("you're already live — end that stream first", 409);
  const title = (typeof titleRaw === "string" ? titleRaw : "").trim().slice(0, STREAM_TITLE_MAX);
  const description = (typeof descriptionRaw === "string" ? descriptionRaw : "")
    .trim()
    .slice(0, STREAM_DESCRIPTION_MAX);
  const rec = createRoom({
    kind: "stream",
    host,
    participants: [newParticipant(host, "host")],
    stream: {
      title: title || "Live stream",
      description,
      chat: [],
      thumbnailAt: null,
      hasThumbnail: false,
      peakViewers: 0,
      watchers: [],
      removed: [],
      viewerLimit: await hostStreamViewerLimit(host),
    },
  });
  return { ok: true, value: streamInfo(rec) };
}

/**
 * Retitle and/or re-describe a LIVE stream — host only (P12).
 *
 * Both fields are optional and only what is supplied is written, which is what
 * makes "edit the title" and "edit the description" two independent saves
 * against one door rather than two doors that can each clobber the other's
 * field.
 */
export function describeStream(
  actor: string,
  streamId: string,
  patch: { title?: unknown; description?: unknown },
): StreamResult<StreamInfo> {
  if (!liveRoom(streamId)) return fail("no such live stream", 404);

  const res = mutateRoom<StreamResult<StreamInfo>>(streamId, (rec) => {
    if (rec.kind !== "stream" || rec.state !== "live" || !rec.stream) return fail("no such live stream", 404);
    if (rec.host !== norm(actor)) return fail("only the host edits the stream", 403);
    if (typeof patch.title === "string") {
      const title = patch.title.trim().slice(0, STREAM_TITLE_MAX);
      if (!title) return fail("give the stream a title", 400);
      rec.stream.title = title;
    }
    if (typeof patch.description === "string") {
      rec.stream.description = patch.description.trim().slice(0, STREAM_DESCRIPTION_MAX);
    }
    return { ok: true, value: streamInfo(rec) };
  });
  return res ? res.value : fail("no such live stream", 404);
}

/**
 * Remove a viewer from a live room — host or administrator (P12).
 *
 * TWO halves, and only together do they mean anything:
 *
 *  1. the SEAT goes, and with it the removed member's media. Nothing here
 *     touches the media plane, and that is the design rather than an omission:
 *     `mediaBridge`'s keepalive re-reads this record every
 *     `MEDIA_TIMING.heartbeatMs` and VACATES any media seat the record no
 *     longer holds, closing their transports and consumers at the source. The
 *     record is the authority (`MEDIA_CONTRACT.identity`); a second eviction
 *     path into the media server would be a second authority to keep in step;
 *  2. the removal is REMEMBERED on the record, so {@link joinStream} refuses
 *     them. Without this, "remove" ejects somebody for exactly as long as it
 *     takes them to click Join again.
 *
 * Scope is the room, deliberately: this is not a suite ban (the moderation wing
 * owns those) and it dies when the record does.
 */
export function removeViewer(
  actor: string,
  streamId: string,
  target: string,
  isAdmin = false,
): StreamResult<{ info: StreamInfo; removed: string }> {
  if (!liveRoom(streamId)) return fail("no such live stream", 404);
  const t = norm(target);
  if (!t) return fail("no such member", 404);

  const res = mutateRoom<
    StreamResult<{ info: StreamInfo; removed: string; watched: WatchSummary | null }>
  >(streamId, (rec) => {
    if (rec.kind !== "stream" || rec.state !== "live" || !rec.stream) return fail("no such live stream", 404);
    if (rec.host !== norm(actor) && !isAdmin) {
      return fail("only the host (or an administrator) can remove a viewer", 403);
    }
    if (t === rec.host) return fail("the host cannot be removed from their own stream", 400);
    const seat = rec.participants.find((p) => p.user === t && p.role !== "host");
    rec.participants = rec.participants.filter((p) => p.user !== t || p.role === "host");
    rec.stream.removed = [...new Set([...(rec.stream.removed ?? []), t])];
    return {
      ok: true,
      value: {
        info: streamInfo(rec),
        removed: seat?.displayName ?? target,
        // A removed viewer still watched what they watched — the third of the
        // four ways out, written here with the other three.
        watched:
          seat && seat.role === "viewer"
            ? {
                streamId: rec.id,
                title: rec.stream.title,
                host: rec.host,
                hostDisplay: rec.hostDisplay,
                joinedAt: seat.joinedAt,
                leftAt: new Date().toISOString(),
              }
            : null,
      },
    };
  });
  if (!res) return fail("no such live stream", 404);
  if (!res.value.ok) return res.value;
  if (res.value.value.watched) writeWatchRow(t, res.value.value.watched);
  return { ok: true, value: { info: res.value.value.info, removed: res.value.value.removed } };
}

/**
 * End a room — host or administrator (the admin path is the moderation
 * lever). Returns the usernames that were attached so the route can signal
 * them; the room lingers briefly for late-signal 409s, then the store's
 * sweeper deletes the record.
 */
export function closeStream(
  actor: string,
  streamId: string,
  isAdmin: boolean,
): StreamResult<{ info: StreamInfo; attached: string[]; closure: StreamClosure }> {
  if (!liveRoom(streamId)) return fail("no such live stream", 404);

  const res = mutateRoom<StreamResult<{ info: StreamInfo; attached: string[]; closure: StreamClosure }>>(
    streamId,
    (rec) => {
      if (rec.kind !== "stream" || rec.state !== "live") return fail("no such live stream", 404);
      if (rec.host !== norm(actor) && !isAdmin) {
        return fail("only the host (or an administrator) can end a stream", 403);
      }
      const attached = rec.participants.filter(isViewer).map((p) => p.displayName);
      rec.endedAt = new Date().toISOString();
      // Read the closure BEFORE the seats are cleared — history is written from
      // this, and after the next two lines the record no longer knows who was
      // in the room (P12).
      const closure = closureOf(rec, rec.endedAt);
      rec.state = "ended";
      rec.participants = [];
      return { ok: true, value: { info: streamInfo(rec), attached, closure } };
    },
  );
  return res ? res.value : fail("no such live stream", 404);
}

/**
 * Attach to a room. `preview` = the hidden 15 s hover player: it gets media
 * like any viewer but never appears in the list and cannot chat. Re-joining
 * upgrades a preview to a real watch (hover → clicked in) in place.
 *
 * **The host's `streamViewerLimit` bites here** (P3), against the limit pinned
 * on the record at open — so this stays synchronous and reads no policy
 * document per arrival. Three things the count deliberately does:
 *
 *   - it counts REAL viewers, not previews. A preview is a 15 s hover thumbnail
 *     on a server-enforced lease; counting them would let a wall of thumbnails
 *     lock out the people actually trying to watch;
 *   - it runs INSIDE `mutateRoom`, under the room's cross-process lock, because
 *     the whole point of a cap is that two arrivals in the same millisecond at
 *     two app processes cannot both be the last seat;
 *   - it is skipped when this member already holds a seat, so a preview
 *     upgrading to a real watch is never refused for a seat it already occupies.
 */
export function joinStream(user: string, streamId: string, preview: boolean): StreamResult<StreamInfo> {
  if (!liveRoom(streamId)) return fail("no such live stream", 404);

  const res = mutateRoom<StreamResult<StreamInfo>>(streamId, (rec) => {
    if (rec.kind !== "stream" || rec.state !== "live") return fail("no such live stream", 404);
    if (rec.host === norm(user)) return fail("that's your own stream", 400);
    // P12: a removal has to stick, and it has to stick for the hover preview
    // too — a removed member who can still watch a live thumbnail of the room
    // has not been removed from anything that matters.
    if ((rec.stream?.removed ?? []).includes(norm(user))) {
      return fail("the host removed you from this stream", 403);
    }
    dropStalePreviews(rec);
    const held = rec.participants.some((p) => p.user === norm(user));
    if (!preview && !held) {
      const watching = rec.participants.filter((p) => p.role === "viewer").length;
      const room = assertStreamViewerRoom(rec.stream?.viewerLimit ?? null, watching);
      if (!room.ok) return fail(room.error, room.status);
    }
    rec.participants = rec.participants.filter((p) => p.user !== norm(user));
    rec.participants.push(newParticipant(user, preview ? "preview" : "viewer"));
    // The two history numbers, counted live because nothing can recover them
    // afterwards (see `StreamRoomData.peakViewers`). Previews count for
    // neither: a 15 s hover is not a viewer and never was.
    if (!preview && rec.stream) {
      const watching = rec.participants.filter((p) => p.role === "viewer").length;
      rec.stream.peakViewers = Math.max(rec.stream.peakViewers ?? 0, watching);
      if (!(rec.stream.watchers ?? []).includes(norm(user))) {
        rec.stream.watchers = [...(rec.stream.watchers ?? []), norm(user)];
      }
    }
    return { ok: true, value: streamInfo(rec) };
  });
  return res ? res.value : fail("no such live stream", 404);
}

/**
 * Give a seat back, and write the leaver's watch-history row (P12).
 *
 * **The row is written HERE, not in the route**, and that is the whole of the
 * rule: there are four ways out of a stream — leaving, being removed, the room
 * ending, and the last connection dropping — and every one of them goes through
 * this file. A history written in the route would cover the button and miss the
 * other three, which is the shape a hole takes. So all four write in the store
 * layer, and the route just calls the verb.
 *
 * A hover PREVIEW leaving earns nothing: a 15 s hover is not a visit.
 */
export function leaveStream(user: string, streamId: string): StreamResult<StreamInfo> {
  if (!streamRoom(streamId)) return fail("no such stream", 404);

  const res = mutateRoom<StreamResult<{ info: StreamInfo; watched: WatchSummary | null }>>(
    streamId,
    (rec) => {
      if (rec.kind !== "stream") return fail("no such stream", 404);
      const seat = rec.participants.find((p) => p.user === norm(user) && p.role === "viewer");
      rec.participants = rec.participants.filter((p) => p.user !== norm(user) || p.role === "host");
      return {
        ok: true,
        value: {
          info: streamInfo(rec),
          watched: seat
            ? {
                streamId: rec.id,
                title: rec.stream?.title ?? "Live stream",
                host: rec.host,
                hostDisplay: rec.hostDisplay,
                joinedAt: seat.joinedAt,
                leftAt: new Date().toISOString(),
              }
            : null,
        },
      };
    },
  );
  if (!res) return fail("no such stream", 404);
  if (!res.value.ok) return res.value;
  if (res.value.value.watched) writeWatchRow(user, res.value.value.watched);
  return { ok: true, value: res.value.value.info };
}

/** Write one watch row, never throwing: a history row is a record of a visit
 *  and is not worth failing the departure it records. */
function writeWatchRow(user: string, summary: WatchSummary): void {
  try {
    recordWatch(user, summary);
  } catch {
    /* the room is what matters; the row is the note about it */
  }
}

/**
 * Detach a member from every room they are attached to (presence dropped).
 * Returns the ids of rooms that actually changed.
 *
 * A real VIEWER seat lost this way still earns its watch-history row (P12).
 * That is the case a history written only on the Leave button would miss — and
 * it is the common one: most people close the tab. A hover PREVIEW earns
 * nothing, here as everywhere.
 */
export function detachEverywhere(user: string): string[] {
  const u = norm(user);
  const changed: string[] = [];
  for (const rec of liveRooms()) {
    if (!rec.participants.some((p) => p.user === u && isViewer(p))) continue;
    const res = mutateRoom<{ changed: boolean; watched: WatchSummary | null }>(rec.id, (r) => {
      const before = r.participants.length;
      const seat = r.participants.find((p) => p.user === u && p.role === "viewer");
      r.participants = r.participants.filter((p) => p.user !== u || p.role === "host");
      return {
        changed: r.participants.length !== before,
        watched: seat
          ? {
              streamId: r.id,
              title: r.stream?.title ?? "Live stream",
              host: r.host,
              hostDisplay: r.hostDisplay,
              joinedAt: seat.joinedAt,
              leftAt: new Date().toISOString(),
            }
          : null,
      };
    });
    if (!res?.value.changed) continue;
    changed.push(rec.id);
    if (res.value.watched) writeWatchRow(u, res.value.watched);
  }
  return changed;
}

/** End every live room a member hosts (their last connection closed).
 *  Returns what `closeStream` would have, per room. */
export function endStreamsHostedBy(
  user: string,
): { info: StreamInfo; attached: string[]; closure: StreamClosure }[] {
  const u = norm(user);
  const out: { info: StreamInfo; attached: string[]; closure: StreamClosure }[] = [];
  for (const rec of liveRooms()) {
    if (rec.host !== u) continue;
    const res = mutateRoom<{ info: StreamInfo; attached: string[]; closure: StreamClosure } | null>(
      rec.id,
      (r) => {
        if (r.state !== "live") return null;
        const attached = r.participants.filter(isViewer).map((p) => p.displayName);
        r.endedAt = new Date().toISOString();
        const closure = closureOf(r, r.endedAt);
        r.state = "ended";
        r.participants = [];
        return { info: streamInfo(r), attached, closure };
      },
    );
    if (res?.value) out.push(res.value);
  }
  return out;
}

/**
 * Write everything a closed room owes to history — the host's row and one row
 * per watcher (P12).
 *
 * It lives here rather than in the route because there are THREE ways a stream
 * ends — the host closing it, an administrator closing it, and the presence
 * registry ending the rooms of a member whose last socket dropped — and a
 * history write that only two of them perform is a history with holes in it in
 * exactly the case nobody tests (the one where somebody's wifi died).
 *
 * Never throws: a history store that cannot be written must not be able to
 * fail a room's close.
 */
export async function archiveClosure(closure: StreamClosure): Promise<void> {
  try {
    await recordStreamEnded({
      streamId: closure.streamId,
      host: closure.host,
      title: closure.title,
      description: closure.description,
      startedAt: closure.startedAt,
      endedAt: closure.endedAt,
      peakViewers: closure.peakViewers,
      watchers: closure.watchers,
    });
  } catch {
    /* history is a record of the room, never a condition of ending it */
  }
  for (const seat of closure.attachedSeats) {
    try {
      recordWatch(seat.user, {
        streamId: closure.streamId,
        title: closure.title,
        host: closure.host,
        hostDisplay: closure.hostDisplay,
        joinedAt: seat.joinedAt,
        leftAt: closure.endedAt,
      });
    } catch {
      /* one watcher's row failing must not cost the others theirs */
    }
  }
}

/* ------------------------------------ chat -------------------------------------- */

/**
 * Post to a room's group chat. Host and real watchers only — a hover preview
 * is an eavesdropper by design and does not get a voice. The backlog is a
 * ring buffer: ephemeral, capped, gone when the room's record is swept away.
 */
export function postChat(user: string, streamId: string, textRaw: unknown): StreamResult<StreamChatMessage> {
  if (!liveRoom(streamId)) return fail("no such live stream", 404);
  const text = (typeof textRaw === "string" ? textRaw : "").trim();

  const res = mutateRoom<StreamResult<StreamChatMessage>>(streamId, (rec) => {
    if (rec.kind !== "stream" || rec.state !== "live" || !rec.stream) return fail("no such live stream", 404);
    const u = norm(user);
    const isHost = rec.host === u;
    const seat = rec.participants.find((p) => p.user === u);
    if (!isHost && (!seat || seat.role === "preview")) return fail("join the stream to chat", 403);
    if (!text) return fail("say something", 400);
    if (text.length > STREAM_CHAT_MAX) return fail(`messages cap at ${STREAM_CHAT_MAX} characters`, 400);
    const message: StreamChatMessage = {
      id: crypto.randomUUID(),
      streamId,
      from: user,
      text,
      sentAt: new Date().toISOString(),
    };
    rec.stream.chat.push(message);
    if (rec.stream.chat.length > STREAM_CHAT_KEEP) {
      rec.stream.chat.splice(0, rec.stream.chat.length - STREAM_CHAT_KEEP);
    }
    return { ok: true, value: message };
  });
  return res ? res.value : fail("no such live stream", 404);
}

/** Everyone who should see a room's chat/roster events right now. */
export function roomAudience(streamId: string): string[] {
  const rec = streamRoom(streamId);
  if (!rec) return [];
  return [rec.hostDisplay, ...rec.participants.filter((p) => p.role === "viewer").map((p) => p.displayName)];
}

/* --------------------------------- thumbnails ----------------------------------- */

/** Store the host's poster frame (a small jpeg data URL, decoded upstream).
 *  The BYTES go beside the record rather than inside it — see
 *  `roomStore.writePoster`. */
export function setThumbnail(actor: string, streamId: string, bytes: Buffer): StreamResult<StreamInfo> {
  if (!liveRoom(streamId)) return fail("no such live stream", 404);
  if (bytes.length === 0 || bytes.length > THUMBNAIL_MAX_BYTES) {
    return fail(`poster must be 1..${THUMBNAIL_MAX_BYTES} bytes`, 400);
  }

  const res = mutateRoom<StreamResult<StreamInfo>>(streamId, (rec) => {
    if (rec.kind !== "stream" || rec.state !== "live" || !rec.stream) return fail("no such live stream", 404);
    if (rec.host !== norm(actor)) return fail("only the host posts the poster", 403);
    writePoster(streamId, bytes);
    rec.stream.hasThumbnail = true;
    rec.stream.thumbnailAt = new Date().toISOString();
    return { ok: true, value: streamInfo(rec) };
  });
  return res ? res.value : fail("no such live stream", 404);
}

/* The sdp/ice signal whitelist that used to end this file died with the mesh
 * (P7) — see the header. Nothing relays client-built signals any more; the
 * one remaining stream signal (`ended`) is minted server-side by the route. */
