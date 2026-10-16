/**
 * @file `/api/amberxvid/rooms` — GROUP VIDEO ROOMS (P11): lifecycle and seats.
 *
 * Room bookkeeping ONLY, exactly like `/api/amberxvid/streams` since P7. Media
 * rides `/api/amberxvid/media`, which mints each member's participant token
 * from THE SEAT THIS ROUTE WROTE — no seat here, no media there
 * (`MEDIA_CONTRACT.identity`). Nothing on this route touches SDP, a producer or
 * a consumer, and nothing should ever be added to it that does.
 *
 * GET
 *   - no query        → `{ rooms, mine }` — every live room plus the ones this
 *                       member holds a seat in (a reloaded tab rejoins from
 *                       `mine` rather than being thrown out of a live meeting).
 *   - `?room=<id>`    → `{ room }` — one room, or 404.
 *
 * POST `{ action }`
 *   `open   { title }`         open a room and take its host seat
 *   `join   { roomId }`        take a seat — this is what the media route mints
 *                              a participant token from
 *   `leave  { roomId }`        give the seat back; the last one out ends it
 *   `end    { roomId }`        host or administrator ends it for everybody
 *   `rename { roomId, title }` host only; the chat thread follows
 *   `ring   { roomId, to }`    P13 — "join my room": ring a member INTO the
 *                              room, through the same door a call invite uses
 *                              (`lib/ring`), so a blocked inviter cannot reach
 *                              the device and do-not-disturb is honoured
 *   `ring-answer { ringId, from, answer }`
 *                              the rung member closing their own ring —
 *                              accept / decline / timeout, which is what turns
 *                              an unanswered invite into a missed one
 *
 * Every mutation broadcasts the fresh room list to EVERY open SSE stream — one
 * event, and every rooms list, member count and "full" chip in the studio is
 * current. That broadcast is also how a host learns of a joiner: nothing
 * signals them directly, for the same reason nothing signals a stream host.
 *
 * THE CHAT THREAD IS BEST-EFFORT, ALWAYS. Every seat mutation also moves the
 * member in or out of the room's P5 group thread, and a thread failure comes
 * back as a `chat` note beside a successful room result — never as a refusal.
 * Chat is text and the room is media: a block between two members must not be
 * able to keep one of them out of a meeting. See `lib/groupRooms`'s header.
 */

import { NextRequest, NextResponse } from "next/server";
import { memberUser } from "@axs/modules/amberxvid/lib/membership";
import { findAccount } from "@axs/modules/amberxvid/lib/accounts";
import { broadcastAll, notifyUsers } from "@axs/modules/amberxvid/lib/presence";
import {
  endRoom,
  ensureRoomThread,
  getGroupRoom,
  joinRoom,
  leaveRoom,
  leaveRoomThread,
  listGroupRooms,
  openRoom,
  renameRoom,
  renameRoomThread,
  roomAudience,
  roomsFor,
} from "@axs/modules/amberxvid/lib/groupRooms";
import type { ChatNote } from "@axs/modules/amberxvid/lib/groupRooms";
import { openRing, ringVisibility } from "@axs/modules/amberxvid/lib/ring";
import {
  recordRoomRingAnswered,
  recordRoomRingPlaced,
} from "@axs/modules/amberxvid/lib/callHistory";
import { isOnline } from "@axs/modules/amberxvid/lib/presence";
import type { RingAnswer, RoomRing, RoomSignal } from "@axs/modules/amberxvid/lib/types";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized(): NextResponse {
  return NextResponse.json({ ok: false, error: "sign in to AmberX Vid first" }, { status: 401 });
}

function err(error: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error }, { status });
}

/** Push the fresh room list to everyone — the event behind every rooms list,
 *  member count and roster chip in the studio. */
function broadcastRooms(): void {
  broadcastAll({ type: "rooms", rooms: listGroupRooms() });
}

/** A room answer plus whatever the chat side had to say about it. `chat` is
 *  omitted when there is nothing to report, so a clean call carries no field
 *  and the client has nothing to render. */
function roomJson(body: Record<string, unknown>, chat: ChatNote): NextResponse {
  return NextResponse.json({ ok: true, ...body, ...(chat ? { chat } : {}) });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const me = await memberUser(req);
  if (!me) return unauthorized();

  const roomId = (req.nextUrl.searchParams.get("room") ?? "").trim();
  if (roomId) {
    const room = getGroupRoom(roomId);
    if (!room) return err("no such live room", 404);
    return NextResponse.json({ ok: true, room });
  }

  return NextResponse.json({ ok: true, rooms: listGroupRooms(), mine: roomsFor(me) });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const me = await memberUser(req);
  if (!me) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return err("body must be JSON", 400);
  }
  const action = typeof body.action === "string" ? body.action : "";
  const roomId = typeof body.roomId === "string" ? body.roomId : "";

  switch (action) {
    case "open": {
      const result = await openRoom(me, body.title);
      if (!result.ok) return err(result.error, result.status);
      broadcastRooms();
      // No thread yet, and that is correct: a room of one is not a group, and
      // P5's store refuses one. The first joiner opens the chat.
      return NextResponse.json({ ok: true, room: result.value });
    }

    case "join": {
      const result = await joinRoom(me, roomId);
      if (!result.ok) return err(result.error, result.status);
      // The seat exists BEFORE the chat is touched: the seat is what the media
      // route needs, so a slow messages store delays the rail, never the room.
      const chat = await ensureRoomThread(me, roomId);
      broadcastRooms();
      const room = getGroupRoom(roomId) ?? result.value;
      return roomJson({ room }, chat);
    }

    case "leave": {
      const before = getGroupRoom(roomId);
      const result = leaveRoom(me, roomId);
      if (!result.ok) return err(result.error, result.status);
      const chat = await leaveRoomThread(me, before?.threadId ?? null);
      if (result.value.ended) {
        // Nobody is left to tell, but the list everyone else is looking at
        // still has the room on it.
        broadcastRooms();
      } else {
        notifyUsers(roomAudience(roomId), { type: "rooms", rooms: listGroupRooms() });
        broadcastRooms();
      }
      return roomJson({ room: result.value.info, ended: result.value.ended }, chat);
    }

    /**
     * P15 — the host takes somebody OUT of the room.
     *
     * The counterpart of `ring`, and modelled on it deliberately: `ring` says
     * "a member who holds a seat may bring somebody", and this says "the member
     * who OPENED the room may send somebody away". Host only, and that is
     * stricter than `ring` on purpose — bringing a person in is reversible by
     * anyone in the room, and putting one out is not something a fellow guest
     * should be able to do.
     *
     * It is `leaveRoom` on their behalf, not a new kind of departure: the seat
     * accounting, the chat leave, the `ended` case when the room empties and
     * the notifications are all the ones a voluntary leave already goes
     * through. Inventing a second removal path would be a second place for the
     * seat count and the thread to disagree.
     *
     * The removed member is told through the room signal their own client
     * already listens for — nobody is dropped silently.
     */
    case "remove": {
      const target = typeof body.user === "string" ? body.user.trim() : "";
      if (!target) return err("say who to remove", 400);
      if (target.toLowerCase() === me.toLowerCase()) return err("that's you — leave instead", 400);
      const before = getGroupRoom(roomId);
      if (!before) return err("no such live room", 404);
      if (before.host.toLowerCase() !== me.toLowerCase()) {
        return err("only the room's host may remove somebody", 403);
      }
      const result = leaveRoom(target, roomId);
      if (!result.ok) return err(result.error, result.status);
      const chat = await leaveRoomThread(target, before.threadId ?? null);
      const removed: RoomSignal = { kind: "removed", roomId, from: me, to: target };
      notifyUsers([target, ...roomAudience(roomId)], { type: "room-signal", signal: removed });
      broadcastRooms();
      return roomJson({ room: result.value.info, ended: result.value.ended }, chat);
    }

    case "end": {
      const account = await findAccount(me);
      const result = endRoom(me, roomId, account?.role === "administrator");
      if (!result.ok) return err(result.error, result.status);
      const ended: RoomSignal = { kind: "ended", roomId, from: me };
      notifyUsers(result.value.attached, { type: "room-signal", signal: ended });
      broadcastRooms();
      return NextResponse.json({ ok: true, room: result.value.info });
    }

    case "rename": {
      const result = renameRoom(me, roomId, body.title);
      if (!result.ok) return err(result.error, result.status);
      const chat = await renameRoomThread(me, result.value.threadId, result.value.title);
      broadcastRooms();
      return roomJson({ room: result.value }, chat);
    }

    /**
     * P13 — "join my room" rings like a call.
     *
     * The inviter must already HOLD A SEAT in the room. That is the whole
     * authorisation model here and it is deliberately not a new one: a member
     * who is in the room may bring somebody, a member who is not cannot ring
     * strangers into a meeting they are not part of, and "in the room" is a
     * fact the room record already knows.
     */
    case "ring": {
      const to = typeof body.to === "string" ? body.to.trim() : "";
      if (!to) return err("say who to ring", 400);
      if (to.toLowerCase() === me.toLowerCase()) return err("that's you", 400);

      const room = getGroupRoom(roomId);
      if (!room) return err("no such live room", 404);
      if (!roomsFor(me).some((r) => r.id === roomId)) {
        return err("join the room before inviting anyone into it", 403);
      }

      const callee = await findAccount(to);
      // Byte-identical to the calls route's refusal for an account it cannot
      // find — and therefore to the BLOCKED_COVER the ring door returns. A
      // prober must not be able to tell the two apart here either.
      if (!callee || callee.disabled === true || callee.screenname === null) {
        return err("no such member", 404);
      }

      // THE COVER STORY, before anything that leaks past it — "they're offline"
      // and "they're already in the room" both say something about a member a
      // blocked inviter must not learn. `ringVisibility` is the side-effect-free
      // half; the full door (with do-not-disturb and its bookkeeping) runs
      // below, once the cheap refusals are out of the way.
      const visible = await ringVisibility({ from: me, to: callee.username, toDisplay: callee.screenname });
      if (!visible.ok) return err(visible.error, visible.status);

      if (!isOnline(callee.username)) {
        return err("they're offline — a room invite rings, so it needs them online", 409);
      }
      if (roomsFor(callee.username).some((r) => r.id === roomId)) {
        return err("they're already in the room", 409);
      }

      const inviter = await findAccount(me);
      const fromDisplay = inviter?.screenname ?? me;
      const gate = await openRing({
        from: me,
        to: callee.username,
        fromDisplay,
        toDisplay: callee.screenname,
        kind: "room",
        roomId,
        roomTitle: room.title,
      });
      if (!gate.ok) {
        return NextResponse.json(
          { ok: false, error: gate.error, unavailable: gate.unavailable === true },
          { status: gate.status },
        );
      }

      const ring: RoomRing = {
        ringId: crypto.randomUUID(),
        roomId,
        title: room.title,
        from: me.toLowerCase(),
        fromDisplay,
        at: new Date().toISOString(),
      };
      // History first, ring second — same ordering rule as the calls route: a
      // ring with no row is a call nobody can account for afterwards.
      recordRoomRingPlaced({
        ringId: ring.ringId,
        roomId,
        roomTitle: room.title,
        from: me,
        fromDisplay,
        to: callee.username,
        toDisplay: callee.screenname,
        at: ring.at,
      });
      notifyUsers([callee.username], { type: "room-ring", ring });
      return NextResponse.json({ ok: true, ring });
    }

    /**
     * The rung member closing their own ring. Only they can: the row this
     * writes is theirs, and `from` names whose placed row closes with it.
     *
     * There is no signal back to the inviter, on purpose. An accept announces
     * itself — the accepter appears in the room list a beat later, which every
     * seat is already watching — and a decline is not something a room invite
     * owes anybody a notification about.
     */
    case "ring-answer": {
      const ringId = typeof body.ringId === "string" ? body.ringId : "";
      const from = typeof body.from === "string" ? body.from.trim() : "";
      const answer = typeof body.answer === "string" ? body.answer : "";
      if (!ringId || !from) return err("which ring?", 400);
      if (answer !== "accept" && answer !== "decline" && answer !== "timeout") {
        return err(`unknown ring answer ${JSON.stringify(answer)}`, 400);
      }
      await recordRoomRingAnswered({
        ringId,
        from,
        to: me,
        answer: answer as RingAnswer,
        at: new Date().toISOString(),
      });
      return NextResponse.json({ ok: true });
    }

    default:
      return err("unknown action", 400);
  }
}
