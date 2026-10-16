/**
 * @file AmberX Vid GROUP ROOMS (P11) — the N-way video room: everybody in it
 * publishes a camera and a mic, and everybody subscribes to the people they can
 * see. The ROOM half only; the transport is the client/server media plane the
 * `axf-amberxvid-client-server` project shipped and this file does not touch it.
 *
 * ---------------------------------------------------------------------------
 * WHAT A GROUP ROOM IS, IN TERMS THAT ALREADY EXIST
 * ---------------------------------------------------------------------------
 * A record of kind `group` in the shared room store, which means it gets the
 * store's whole apparatus for free and on the same terms as calls and streams:
 * cross-process visibility, the per-room lock every mutation runs under, the
 * heartbeat sweeper that clears ghosts, and — the load-bearing one — the fact
 * that `/api/amberxvid/media` mints a participant token from THE RECORD'S SEAT
 * and refuses anybody the record does not seat. That is what makes the roster
 * server-attested (`MEDIA_CONTRACT.identity`): a client can claim nothing about
 * who it is, and the grid's name chips come from this record rather than from
 * anything that arrived alongside the media.
 *
 * Every seat is a PUBLISHER. `MediaRole` `host` and `participant` both carry
 * `canPublish` in `ROLE_RULES`, so a group room has no audience class — no
 * `viewer`, no `preview`. A member who has their camera off is still a
 * publisher whose video producer is PAUSED, which is a server-known fact every
 * other member reads from the media snapshot. "Watching without publishing" is
 * a stream, and streams already exist.
 *
 * The two roles differ in exactly one thing: the host owns the room's title and
 * can end it for everybody. They are not a broadcaster and their media is not
 * privileged.
 *
 * ---------------------------------------------------------------------------
 * THE HOST IS NOT THE ROOM (and this is the one place group rooms diverge)
 * ---------------------------------------------------------------------------
 * For a call the host is half the call; for a stream the broadcaster IS the
 * room, so both end when the host's seat goes stale. A group room does not: it
 * is the people in it, and ending a meeting because whoever opened it lost
 * their wifi would be a bug wearing a rule's clothes. `roomStore.sweepRecord`
 * therefore promotes the longest-standing survivor when a group room's host is
 * swept, and {@link leaveRoom} does the same when a host leaves deliberately.
 * The room ends when the LAST member leaves, or when a host (or an
 * administrator) ends it on purpose.
 *
 * ---------------------------------------------------------------------------
 * THE MEMBER CAP — one dial, not two
 * ---------------------------------------------------------------------------
 * `canJoinGroupRooms` decides whether a member may be in a room at all; it is
 * checked on BOTH doors (opening one and joining one), because opening a room
 * is joining the room you just opened.
 *
 * How many people the room holds is `maxGroupChatMembers` — the policy row that
 * already caps a group thread — resolved from the HOST when the room opens and
 * PINNED onto the record, exactly as `streamViewerLimit` is pinned for a
 * stream. Using the chat row rather than minting a second number is deliberate:
 * the room's roster IS its chat thread's membership (see below), so two dials
 * would be two dials that can disagree, and the disagreement's shape is a
 * member admitted to the room whose chat then refuses them — a member sitting
 * in a meeting unable to type in it, for a reason nothing on screen explains.
 * One number cannot do that.
 *
 * `CAPACITY.membersPerGroupRoom` is the machine ceiling underneath it, the way
 * `CAPACITY.viewersPerStream` sits under `streamViewerLimit`: the product cap
 * is a policy row an administrator moves, the machine cap is a promise about
 * what the media server will carry, and the smaller of the two is what bites.
 *
 * ---------------------------------------------------------------------------
 * THE CHAT THREAD — bound to the room, owned by the messages store
 * ---------------------------------------------------------------------------
 * The room's chat is a REAL P5 group thread in the accounts messages store, not
 * a ring buffer on the record: the messenger already has group threads, live
 * delivery, unread counts, the social guard and an offline queue, and a second
 * chat implementation in this module would have none of that and would need all
 * of it.
 *
 * The binding is one-directional and it is worth being precise about, because
 * the alternative is a distributed-transaction problem nobody needs:
 *
 *   - the ROOM RECORD owns the thread id (`GroupRoomData.threadId`);
 *   - the THREAD owns the messages, and knows nothing about rooms;
 *   - membership follows the roster — a joiner is invited to the thread, a
 *     leaver leaves it — through P5's own verbs, so the store's guards
 *     (`canInteract` pairwise, the member cap) apply unchanged;
 *   - the thread is created LAZILY, when the room first holds two people,
 *     because `createGroup` correctly refuses a group of one. A room with
 *     nobody in it yet but its opener has no chat, and that is honest: there is
 *     nobody to chat to.
 *
 * "Bound to the room's lifetime" then falls out of P5's own rule rather than
 * needing enforcement here: `leaveThread` deletes a group when its last member
 * leaves, so the last person out of the room takes the chat with them. Nothing
 * here deletes a thread — `deleteThread` is administrator-only by design, and a
 * room host is not an administrator.
 *
 * A thread operation that fails NEVER fails the room operation. Chat is text
 * and the room is media; a block between two members must not be able to keep
 * one of them out of a meeting they were invited to. Failures come back as the
 * `chat` field of the result so the rail can say what is wrong instead of the
 * room refusing to open.
 *
 * Server-only.
 */

import {
  createGroup,
  inviteToThread,
  leaveThread,
  renameThread,
} from "@axs/modules/accounts/lib/messages";
import { CAPACITY } from "./mediaContract";
import { assertCanJoinGroupRooms, groupChatMemberCap } from "./policy";
import {
  createRoom,
  listRooms,
  mutateRoom,
  newParticipant,
  norm,
  readRoom,
} from "./roomStore";
import type { GroupRoomData, RoomRecord, StoredParticipant } from "./roomStore";
import { ROOM_TITLE_MAX, type GroupRoomInfo, type RoomMember } from "./types";

/* ---------------------------------- results ------------------------------------ */

export type RoomResult<T> = { ok: true; value: T } | { ok: false; error: string; status: number };

const fail = (error: string, status: number): { ok: false; error: string; status: number } => ({
  ok: false,
  error,
  status,
});

/** A chat-side outcome that must never sink the room-side operation. `null`
 *  means nothing was attempted or nothing went wrong. */
export type ChatNote = string | null;

/* ---------------------------------- reading ------------------------------------ */

function groupRecord(roomId: string): RoomRecord | null {
  const rec = readRoom(roomId);
  return rec && rec.kind === "group" ? rec : null;
}

function liveRecord(roomId: string): RoomRecord | null {
  const rec = groupRecord(roomId);
  return rec && rec.state === "live" ? rec : null;
}

/** A stored seat as the wire describes it. `viewer`/`preview` cannot occur in a
 *  group room — a record carrying one is corrupt, and reading it as a
 *  participant is the harmless answer (they publish either way). */
function member(p: StoredParticipant): RoomMember {
  return {
    user: p.user,
    displayName: p.displayName,
    role: p.role === "host" ? "host" : "participant",
    joinedAt: p.joinedAt,
  };
}

/** The wire view of a room record. */
export function roomInfo(rec: RoomRecord): GroupRoomInfo {
  const data: GroupRoomData | null | undefined = rec.group;
  return {
    id: rec.id,
    title: data?.title ?? "Room",
    host: rec.host,
    hostDisplay: rec.hostDisplay,
    startedAt: rec.createdAt,
    // Oldest first, so the grid's first page is the people who have been in the
    // room longest rather than whoever the filesystem happened to return first.
    // Page membership must be STABLE — a tile that moves pages on every roster
    // read would tear down and rebuild its consumer for no reason at all.
    members: [...rec.participants].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt)).map(member),
    memberLimit: data?.memberLimit ?? null,
    threadId: data?.threadId ?? null,
  };
}

/** Every live group room, newest first — the rooms list and the SSE broadcast. */
export function listGroupRooms(): GroupRoomInfo[] {
  return listRooms("group")
    .filter((rec) => rec.state === "live")
    .map(roomInfo);
}

/** One room, or null. */
export function getGroupRoom(roomId: string): GroupRoomInfo | null {
  const rec = liveRecord(roomId);
  return rec ? roomInfo(rec) : null;
}

/** The live rooms this member currently holds a seat in. A member may be in
 *  more than one record at a time only transiently (a stale seat not yet
 *  swept); the client is in one room at a time. */
export function roomsFor(user: string): GroupRoomInfo[] {
  const u = norm(user);
  return listGroupRooms().filter((r) => r.members.some((m) => m.user === u));
}

/** Everybody who should hear about this room right now — the notify audience
 *  for signals and chat nudges. Display names, matching `roomAudience` in
 *  `./streams`, because `notifyUsers` normalizes its own input. */
export function roomAudience(roomId: string): string[] {
  const rec = groupRecord(roomId);
  return rec ? rec.participants.map((p) => p.displayName) : [];
}

/* --------------------------------- capacity ------------------------------------ */

/**
 * The cap that actually bites, as a number or null for uncapped: the smaller of
 * the room's pinned product cap and the media plane's machine ceiling.
 *
 * Both, not either. The policy row is what an administrator moves and what a
 * refusal should name; the contract number is what the media server will
 * actually carry, and a room admitted past it would fill up fine here and then
 * refuse its last members at the media door with `room-full` — a refusal from
 * the wrong layer, naming nothing an administrator can act on.
 */
function effectiveLimit(pinned: number | null | undefined): number {
  const product = pinned !== null && pinned !== undefined && pinned > 0 ? pinned : Infinity;
  return Math.min(product, CAPACITY.membersPerGroupRoom);
}

/* --------------------------------- lifecycle ----------------------------------- */

/**
 * Open a room. The opener is its host and its first seat — opening a room IS
 * joining it, which is why `canJoinGroupRooms` is the gate rather than a
 * separate "may open" row: a member who cannot be in a room has no use for one.
 *
 * Async for the policy cascade, exactly as `openStream` is. The cap is resolved
 * here, once, and pinned (see the header).
 */
export async function openRoom(host: string, titleRaw: unknown): Promise<RoomResult<GroupRoomInfo>> {
  const allowed = await assertCanJoinGroupRooms(host);
  if (!allowed.ok) return fail(allowed.error, allowed.status);

  const title = (typeof titleRaw === "string" ? titleRaw : "").trim().slice(0, ROOM_TITLE_MAX);
  const cap = await groupChatMemberCap(host);
  const rec = createRoom({
    kind: "group",
    host,
    participants: [newParticipant(host, "host")],
    group: {
      title: title || "Video room",
      memberLimit: cap > 0 ? cap : null,
      threadId: null,
    },
  });
  return { ok: true, value: roomInfo(rec) };
}

/**
 * Take a seat. Async for the same reason `openRoom` is — `canJoinGroupRooms` is
 * a cascade read — but the CAP check is synchronous and inside `mutateRoom`,
 * under the room's cross-process lock, because the whole point of a cap is that
 * two arrivals in the same millisecond on two app processes cannot both be the
 * last seat.
 *
 * Re-joining a room you are already in is a no-op that succeeds: a reloaded tab
 * rejoins, and refusing it would make a page refresh look like being thrown
 * out. It keeps the ORIGINAL seat rather than minting a fresh one, so the grid
 * page a member sits on does not jump on reload and their host succession
 * position is preserved.
 */
export async function joinRoom(user: string, roomId: string): Promise<RoomResult<GroupRoomInfo>> {
  const allowed = await assertCanJoinGroupRooms(user);
  if (!allowed.ok) return fail(allowed.error, allowed.status);
  if (!liveRecord(roomId)) return fail("no such live room", 404);

  const res = mutateRoom<RoomResult<GroupRoomInfo>>(roomId, (rec) => {
    if (rec.kind !== "group" || rec.state !== "live") return fail("no such live room", 404);
    const u = norm(user);
    if (rec.participants.some((p) => p.user === u)) return { ok: true, value: roomInfo(rec) };

    const limit = effectiveLimit(rec.group?.memberLimit);
    if (rec.participants.length >= limit) {
      return fail(
        `this room is full — it holds ${limit} member${limit === 1 ? "" : "s"} ` +
          `(AmberX Vid policy \`maxGroupChatMembers\`). Try again when somebody leaves.`,
        409,
      );
    }
    rec.participants.push(newParticipant(user, "participant"));
    return { ok: true, value: roomInfo(rec) };
  });
  return res ? res.value : fail("no such live room", 404);
}

/**
 * Give a seat back. The room survives every departure except the last one:
 *
 *   - a HOST leaving hands the chair to the longest-standing survivor, the same
 *     succession the sweeper applies (see the header);
 *   - the LAST member leaving ends the room, because an empty room is not a
 *     room — leaving it live would leave a joinable ghost in everyone's list.
 *
 * `ended` in the result is what tells the route to signal and re-broadcast.
 */
export function leaveRoom(user: string, roomId: string): RoomResult<{ info: GroupRoomInfo; ended: boolean }> {
  if (!groupRecord(roomId)) return fail("no such room", 404);

  const res = mutateRoom<RoomResult<{ info: GroupRoomInfo; ended: boolean }>>(roomId, (rec) => {
    if (rec.kind !== "group") return fail("no such room", 404);
    const u = norm(user);
    const before = rec.participants.length;
    rec.participants = rec.participants.filter((p) => p.user !== u);
    if (rec.participants.length === before && rec.state !== "live") {
      return fail("no such room", 404);
    }

    if (rec.participants.length === 0) {
      const info = roomInfo(rec);
      if (rec.state === "live") {
        rec.state = "ended";
        rec.endedAt = new Date().toISOString();
      }
      return { ok: true, value: { info, ended: true } };
    }
    if (rec.host === u) {
      const heir = [...rec.participants].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))[0];
      heir.role = "host";
      rec.host = heir.user;
      rec.hostDisplay = heir.displayName;
    }
    return { ok: true, value: { info: roomInfo(rec), ended: false } };
  });
  return res ? res.value : fail("no such room", 404);
}

/**
 * End a room for everybody — host or administrator. The administrator path is
 * the moderation lever, identical in shape to `closeStream`'s.
 *
 * Returns who was attached so the route can signal them; the record lingers
 * briefly so late signals get a 409 rather than a 404, then the store's sweeper
 * deletes it.
 */
export function endRoom(
  actor: string,
  roomId: string,
  isAdmin: boolean,
): RoomResult<{ info: GroupRoomInfo; attached: string[] }> {
  if (!liveRecord(roomId)) return fail("no such live room", 404);

  const res = mutateRoom<RoomResult<{ info: GroupRoomInfo; attached: string[] }>>(roomId, (rec) => {
    if (rec.kind !== "group" || rec.state !== "live") return fail("no such live room", 404);
    if (rec.host !== norm(actor) && !isAdmin) {
      return fail("only the host (or an administrator) can end a room", 403);
    }
    const info = roomInfo(rec);
    const attached = rec.participants.map((p) => p.displayName);
    rec.state = "ended";
    rec.endedAt = new Date().toISOString();
    rec.participants = [];
    return { ok: true, value: { info, attached } };
  });
  return res ? res.value : fail("no such live room", 404);
}

/** Rename a room — host only. The chat thread follows in the route, best
 *  effort: a room and its chat with different names is confusing, and a rename
 *  that half-failed is not worth refusing the rename over. */
export function renameRoom(actor: string, roomId: string, titleRaw: unknown): RoomResult<GroupRoomInfo> {
  if (!liveRecord(roomId)) return fail("no such live room", 404);
  const title = (typeof titleRaw === "string" ? titleRaw : "").trim().slice(0, ROOM_TITLE_MAX);
  if (!title) return fail("give the room a name", 400);

  const res = mutateRoom<RoomResult<GroupRoomInfo>>(roomId, (rec) => {
    if (rec.kind !== "group" || rec.state !== "live" || !rec.group) return fail("no such live room", 404);
    if (rec.host !== norm(actor)) return fail("only the host renames the room", 403);
    rec.group.title = title;
    return { ok: true, value: roomInfo(rec) };
  });
  return res ? res.value : fail("no such live room", 404);
}

/**
 * Drop this member from every group room they hold a seat in — the
 * last-connection-closed path, called from the presence registry beside
 * `detachEverywhere`. Returns what each departure changed so the caller can
 * signal the rooms that ended.
 */
export function leaveAllRooms(user: string): { info: GroupRoomInfo; ended: boolean }[] {
  const u = norm(user);
  const out: { info: GroupRoomInfo; ended: boolean }[] = [];
  for (const room of roomsFor(u)) {
    const res = leaveRoom(u, room.id);
    if (res.ok) out.push(res.value);
  }
  return out;
}

/* ------------------------------- the chat thread -------------------------------- */

/**
 * Make sure this room has a chat thread and that `user` is in it.
 *
 * Lazy on purpose (see the header): `createGroup` refuses a group of one, and
 * correctly — so the thread appears the moment the room holds a second person,
 * with everybody currently seated in it.
 *
 * NEVER throws and never fails a join: the return is a note for the rail, and
 * the room does not care what it says. A block between two members keeps them
 * out of one chat; it does not keep either of them out of a meeting.
 */
export async function ensureRoomThread(user: string, roomId: string): Promise<ChatNote> {
  const rec = liveRecord(roomId);
  if (!rec) return null;
  const existing = rec.group?.threadId ?? null;

  try {
    if (existing) {
      // Already bound — pull this member in. Idempotent in the store for
      // somebody already inside, so a rejoin costs one no-op write.
      const result = await inviteToThread(rec.hostDisplay, existing, user);
      return result.ok ? null : `chat: ${result.error}`;
    }

    const others = rec.participants.filter((p) => p.user !== norm(rec.host)).map((p) => p.displayName);
    if (others.length === 0) return null; // a group of one — nothing to open yet

    // Opened BY THE HOST, so the host owns the thread the way they own the
    // room, and `renameThread` (owner-only) tracks the room's title.
    const created = await createGroup(rec.hostDisplay, rec.group?.title ?? "Video room", others);
    if (!created.ok) return `chat: ${created.error}`;

    const threadId = created.thread.id;
    mutateRoom(roomId, (r) => {
      // Re-checked under the lock: two joiners racing here would both have
      // created a thread, and the second write would orphan the first. The
      // loser's thread is left alone rather than deleted — deleting is
      // administrator-only, and an empty thread nobody is in is harmless.
      if (r.kind === "group" && r.group && !r.group.threadId) r.group.threadId = threadId;
      return null;
    });
    return null;
  } catch (err) {
    return `chat: ${err instanceof Error ? err.message : "the messages store did not answer"}`;
  }
}

/**
 * Take this member out of the room's chat thread. P5's own rule finishes the
 * binding: a group whose last member leaves is DELETED by the store, so the
 * last person out of the room takes the chat with them — which is what "bound
 * to the room's lifetime" means here, achieved with no new machinery and no
 * administrator power.
 */
export async function leaveRoomThread(user: string, threadId: string | null): Promise<ChatNote> {
  if (!threadId) return null;
  try {
    const result = await leaveThread(user, threadId);
    return result.ok ? null : `chat: ${result.error}`;
  } catch (err) {
    return `chat: ${err instanceof Error ? err.message : "the messages store did not answer"}`;
  }
}

/** Keep the chat's name in step with the room's. Owner-only in the store, so
 *  this is called as the host; a failure is a note, never a refusal. */
export async function renameRoomThread(
  host: string,
  threadId: string | null,
  title: string,
): Promise<ChatNote> {
  if (!threadId) return null;
  try {
    const result = await renameThread(host, threadId, title);
    return result.ok ? null : `chat: ${result.error}`;
  } catch (err) {
    return `chat: ${err instanceof Error ? err.message : "the messages store did not answer"}`;
  }
}
