/**
 * @file `/api/amberxvid/media` — the client/server transport API (P4).
 * ADDITIVE: nothing is deleted in this phase. The mesh-era `calls` and
 * `streams` routes keep relaying exactly as before; every existing user is
 * untouched until P6/P7 move each client onto this surface and delete the
 * relay it replaced.
 *
 * `MEDIA_CONTRACT.signaling`, implemented: the app server AUTHORISES
 * (`memberUser` — the studio's `axs_session` plus the amberxvid grant, exactly
 * the calls-route idiom), authorises again against the
 * P3 room record, MINTS the P1 participant token, FORWARDS the request over
 * the media server's WS channel (`lib/mediaBridge`, speaking
 * `media-server/http.ts`'s protocol) and returns the answer. It never touches
 * media bytes — every byte through here is setup vocabulary.
 *
 * POST `{ action: "join", roomId }` → mint the token for the seat the ROOM
 *   RECORD holds for this member (the server-assigned role — a member with no
 *   seat is refused, so the media plane follows the record, never the other
 *   way round), join the media server, and return `{ mediaUrl, participantId,
 *   role, canPublish, routerRtpCapabilities, snapshot }`.
 * POST `{ action: "transport", participantId, direction }` → create the send
 *   or recv transport, returning its ICE/DTLS parameters.
 * POST `{ action: "connect", participantId, transportId, dtlsParameters }`
 *   → complete the transport's DTLS setup.
 * POST `{ action: "produce", participantId, transportId, kind,
 *   rtpParameters }` → the ONE upstream of that kind. Refused with
 *   `publish-denied` when the room record's CURRENT seat role may not publish
 *   (`ROLE_RULES`) — which is what stops a viewer broadcasting into a stream
 *   room. The media server enforces the same matrix from the token; this is
 *   the same rule at both doors, not two rules.
 * POST `{ action: "consume", participantId, transportId, producerId,
 *   rtpCapabilities }` → one downstream per producer, created PAUSED
 *   (the black-tile rule — see `RoomRegistry.consume`).
 * POST `{ action: "resume", participantId, consumerId }` → the client saying
 *   it has handled the consumer's parameters; the second half of `consume`.
 * POST `{ action: "layers", participantId, consumerId, spatialLayer }` → pick
 *   the simulcast spatial layer this consumer is fed (P7): the subscriber
 *   names what fits its display; a no-op on non-simulcast consumers.
 * POST `{ action: "pause", participantId, kind, paused }` → pause/resume the
 *   seat's OWN producer of that kind — server-known mute (P6): the server
 *   stops fanning the upstream and announces it, so every subscriber learns
 *   from the server, never from a data channel the peer might not send.
 * POST `{ action: "snapshot", participantId }` → the room's current truth
 *   (participants + producers), re-pulled on demand — how a client closes the
 *   gap between its join snapshot and the announcement stream.
 * POST `{ action: "record", participantId, on }` → start/stop the SERVER-side
 *   recording of this room (P10). Host only, checked against the room
 *   record's CURRENT host (the same both-doors posture as produce); the
 *   stream's title rides along from the record so the Library entry is named.
 *   Every seat sees `snapshot.recording` flip — the on-screen consent fact.
 * POST `{ action: "leave", participantId }` → vacate the seat.
 *
 * ANNOUNCEMENTS (P6): the media server pushes an id-less `room-updated` (with
 * a fresh snapshot) down each seat's WS channel whenever the room's shape
 * changes. `join` wires that push to the seat's user as a `room-media`
 * MessengerEvent via `notifyUsers` — it rides the presence SSE stream to
 * whichever process holds the user's socket, which is how a subscriber hears
 * a producer appear, pause or vanish without polling.
 *
 * After `join`, authorisation chains through the seat: `seatOf` only returns a
 * seat to the signed-in session that joined it, and that seat was minted
 * against the room record — so `participantId` in a body is a handle, never an
 * identity claim (`MEDIA_CONTRACT.identity`).
 *
 * Failure is the CLOSED `MediaFailure` vocabulary, as `{ ok: false, failure,
 * error }` with `MEDIA_FAILURE_STATUS`'s status — and a media server that is
 * down is the `server-unreachable` failure in bounded time, never a hang
 * (`lib/mediaBridge` time-boxes connect and every request).
 */

import { NextRequest, NextResponse } from "next/server";
import { memberUser } from "@axs/modules/amberxvid/lib/membership";
import {
  MEDIA_FAILURE_MEANING,
  MEDIA_FAILURE_USER_COPY,
  MEDIA_TIMING,
  ROLE_RULES,
} from "@axs/modules/amberxvid/lib/mediaContract";
import type { MediaFailure, MediaKind, MediaRoomSnapshot } from "@axs/modules/amberxvid/lib/mediaContract";
import { notifyUsers } from "@axs/modules/amberxvid/lib/presence";
import {
  MEDIA_FAILURE_STATUS,
  MediaPlaneError,
  joinSeat,
  leaveSeat,
  mediaServerUrl,
  seatOf,
} from "@axs/modules/amberxvid/lib/mediaBridge";
import type { BridgeSeat } from "@axs/modules/amberxvid/lib/mediaBridge";
import { norm, readRoom } from "@axs/modules/amberxvid/lib/roomStore";
import { mediaSecret, mintMediaToken } from "@axs/modules/amberxvid/media-server/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized(): NextResponse {
  return NextResponse.json({ ok: false, error: "sign in to AmberX Vid first" }, { status: 401 });
}

/** A refusal in the closed vocabulary: the failure IS the wire message, its
 *  user-facing copy comes from `MEDIA_FAILURE_MEANING` (P11's one source),
 *  and any finer detail stays in the server's own log. */
function refused(failure: MediaFailure): NextResponse {
  return NextResponse.json(
    { ok: false, failure, error: MEDIA_FAILURE_MEANING[failure] },
    { status: MEDIA_FAILURE_STATUS[failure] },
  );
}

const MEDIA_KINDS: readonly MediaKind[] = ["audio", "video", "screen"];

function isMediaKind(v: unknown): v is MediaKind {
  return typeof v === "string" && (MEDIA_KINDS as readonly string[]).includes(v);
}

/**
 * GET — the media server's /health, proxied (P11). Browsers never dial the
 * media server's HTTP port directly; the app server asks on their behalf,
 * time-boxed, and a media plane that is down is DATA here (`up: false` with
 * the honest sentence), never an error — the probe itself succeeded at its
 * job of finding out. This is what the join paths call first and what the
 * health indicators (Stream Hub, call window, admin status line) poll.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const me = await memberUser(req);
  if (!me) return unauthorized();

  const down = NextResponse.json(
    {
      ok: true,
      media: { up: false, failure: "server-unreachable", message: MEDIA_FAILURE_USER_COPY["server-unreachable"] },
    },
    { headers: { "Cache-Control": "no-store" } },
  );

  const url = mediaServerUrl();
  if (!url || !mediaSecret()) return down;

  try {
    const res = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(MEDIA_TIMING.healthProbeTimeoutMs),
      cache: "no-store",
    });
    const health = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || !health || health.ok !== true) return down;
    return NextResponse.json(
      { ok: true, media: { up: true, ...health } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return down;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const me = await memberUser(req);
  if (!me) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";

  try {
    if (action === "join") return await join(me, body);

    // Everything else rides a seat this session joined. An expired or foreign
    // participantId learns only that there is no such session.
    const seat = seatOf(me, body.participantId);
    if (!seat) {
      return NextResponse.json({ ok: false, error: "no such media session — join first" }, { status: 404 });
    }

    if (action === "transport") return await createTransport(seat, body);
    if (action === "connect") return await connectTransport(seat, body);
    if (action === "produce") return await produce(seat, body);
    if (action === "consume") return await consume(seat, body);
    if (action === "resume") return await resume(seat, body);
    if (action === "layers") return await layers(seat, body);
    if (action === "pause") return await pause(seat, body);
    if (action === "record") return await record(seat, body);
    if (action === "snapshot") return await snapshot(seat);
    if (action === "leave") {
      await leaveSeat(seat);
      return NextResponse.json({ ok: true, left: seat.participantId });
    }

    return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  } catch (err) {
    if (err instanceof MediaPlaneError) return refused(err.failure);
    throw err;
  }
}

/* ----------------------------------- actions ----------------------------------- */

async function join(me: string, body: Record<string, unknown>): Promise<NextResponse> {
  const roomId = typeof body.roomId === "string" ? body.roomId : "";
  if (!roomId) return NextResponse.json({ ok: false, error: "say which room" }, { status: 400 });

  // The P3 room record is the authority: the seat the calls/streams flow gave
  // this member is the seat the token is minted for. No record, no media.
  const rec = readRoom(roomId);
  if (!rec || rec.state !== "live") {
    return NextResponse.json({ ok: false, error: "no such live room" }, { status: 404 });
  }
  const roomSeat = rec.participants.find((p) => p.user === norm(me));
  if (!roomSeat) {
    return NextResponse.json(
      { ok: false, error: "you hold no seat in that room — join the call or stream first" },
      { status: 403 },
    );
  }

  const url = mediaServerUrl();
  const secret = mediaSecret();
  if (!url || !secret) return refused("server-unreachable");

  const token = mintMediaToken({ sub: me, room: roomId, role: roomSeat.role }, secret);
  const { seat, joined } = await joinSeat(url, token, me);

  // The announcement wire (P6): every room-updated push from the media server
  // becomes a `room-media` event for THIS seat's user. `notifyUsers` delivers
  // to their sockets on this process and rides the outbox to any other process
  // holding one — the client-facing half the P4 bridge deliberately left off.
  seat.channel.onPush = (msg) => {
    if (msg.type !== "room-updated") return;
    const snapshot = msg.snapshot;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return;
    notifyUsers([me], { type: "room-media", roomId, snapshot: snapshot as MediaRoomSnapshot });
  };

  return NextResponse.json({
    ok: true,
    mediaUrl: url,
    roomId,
    participantId: seat.participantId,
    role: seat.role,
    canPublish: seat.canPublish,
    // P22, 2026-08-15: FORWARDED, and it was not before. The media server
    // answers a host's join with whether it can actually record (ffmpeg
    // present, disk headroom) precisely so the toggle can be disabled with the
    // reason — and this route dropped both fields on the floor. `StreamHub`
    // read `joined.recordingAvailable` as `undefined` and latched `false`, so
    // "Record on server" was disabled for EVERY host on EVERY stream, blaming
    // a missing ffmpeg that was there. Every unit test passed: none of them
    // crossed this route, which is why it took a browser to see it.
    recordingAvailable: joined.recordingAvailable === true,
    recordingReason: typeof joined.recordingReason === "string" ? joined.recordingReason : null,
    routerRtpCapabilities: joined.routerRtpCapabilities,
    snapshot: joined.snapshot,
  });
}

async function createTransport(seat: BridgeSeat, body: Record<string, unknown>): Promise<NextResponse> {
  const direction = body.direction === "send" || body.direction === "recv" ? body.direction : null;
  if (!direction) {
    return NextResponse.json({ ok: false, error: "direction must be send or recv" }, { status: 400 });
  }
  const reply = await seat.channel.request({ type: "create-transport", direction });
  return NextResponse.json({
    ok: true,
    direction,
    transportId: reply.transportId,
    iceParameters: reply.iceParameters,
    iceCandidates: reply.iceCandidates,
    dtlsParameters: reply.dtlsParameters,
  });
}

async function connectTransport(seat: BridgeSeat, body: Record<string, unknown>): Promise<NextResponse> {
  const transportId = typeof body.transportId === "string" ? body.transportId : "";
  const dtls = body.dtlsParameters;
  if (!transportId || !dtls || typeof dtls !== "object" || Array.isArray(dtls)) {
    return NextResponse.json({ ok: false, error: "transportId and dtlsParameters required" }, { status: 400 });
  }
  await seat.channel.request({ type: "connect-transport", transportId, dtlsParameters: dtls });
  return NextResponse.json({ ok: true, transportId });
}

async function produce(seat: BridgeSeat, body: Record<string, unknown>): Promise<NextResponse> {
  const transportId = typeof body.transportId === "string" ? body.transportId : "";
  const rtp = body.rtpParameters;
  if (!isMediaKind(body.kind)) {
    return NextResponse.json({ ok: false, error: "kind must be audio, video or screen" }, { status: 400 });
  }
  if (!transportId || !rtp || typeof rtp !== "object" || Array.isArray(rtp)) {
    return NextResponse.json({ ok: false, error: "transportId and rtpParameters required" }, { status: 400 });
  }

  // Authorised against the room record's CURRENT seat, not the join-time role:
  // ROLE_RULES is one matrix, and the record is where a seat's role lives.
  const rec = readRoom(seat.roomId);
  const roomSeat = rec?.state === "live" ? rec.participants.find((p) => p.user === seat.user) : undefined;
  if (!roomSeat) {
    return NextResponse.json({ ok: false, error: "the room has ended" }, { status: 409 });
  }
  if (!ROLE_RULES[roomSeat.role].canPublish) return refused("publish-denied");

  const reply = await seat.channel.request({ type: "produce", transportId, kind: body.kind, rtpParameters: rtp });
  return NextResponse.json({ ok: true, producerId: reply.producerId, kind: body.kind });
}

async function consume(seat: BridgeSeat, body: Record<string, unknown>): Promise<NextResponse> {
  const transportId = typeof body.transportId === "string" ? body.transportId : "";
  const producerId = typeof body.producerId === "string" ? body.producerId : "";
  const caps = body.rtpCapabilities;
  if (!transportId || !producerId || !caps || typeof caps !== "object" || Array.isArray(caps)) {
    return NextResponse.json(
      { ok: false, error: "transportId, producerId and rtpCapabilities required" },
      { status: 400 },
    );
  }
  const reply = await seat.channel.request({ type: "consume", transportId, producerId, rtpCapabilities: caps });
  return NextResponse.json({
    ok: true,
    consumerId: reply.consumerId,
    producerId: reply.producerId,
    kind: reply.kind,
    mediaKind: reply.mediaKind,
    rtpParameters: reply.rtpParameters,
    paused: true,
  });
}

async function resume(seat: BridgeSeat, body: Record<string, unknown>): Promise<NextResponse> {
  const consumerId = typeof body.consumerId === "string" ? body.consumerId : "";
  if (!consumerId) return NextResponse.json({ ok: false, error: "consumerId required" }, { status: 400 });
  await seat.channel.request({ type: "resume-consumer", consumerId });
  return NextResponse.json({ ok: true, consumerId });
}

async function layers(seat: BridgeSeat, body: Record<string, unknown>): Promise<NextResponse> {
  const consumerId = typeof body.consumerId === "string" ? body.consumerId : "";
  const spatialLayer = Number(body.spatialLayer);
  if (!consumerId || !Number.isInteger(spatialLayer) || spatialLayer < 0 || spatialLayer > 2) {
    return NextResponse.json({ ok: false, error: "consumerId and spatialLayer 0..2 required" }, { status: 400 });
  }
  await seat.channel.request({ type: "prefer-layers", consumerId, spatialLayer });
  return NextResponse.json({ ok: true, consumerId, spatialLayer });
}

async function pause(seat: BridgeSeat, body: Record<string, unknown>): Promise<NextResponse> {
  if (!isMediaKind(body.kind)) {
    return NextResponse.json({ ok: false, error: "kind must be audio, video or screen" }, { status: 400 });
  }
  const paused = body.paused === true;
  await seat.channel.request({ type: "pause-producer", kind: body.kind, paused });
  return NextResponse.json({ ok: true, kind: body.kind, paused });
}

async function record(seat: BridgeSeat, body: Record<string, unknown>): Promise<NextResponse> {
  if (typeof body.on !== "boolean") {
    return NextResponse.json({ ok: false, error: "on must be true or false" }, { status: 400 });
  }
  // Authorised against the room record's CURRENT host, not the join-time role
  // — the produce posture verbatim: the record is where authority lives, and
  // the media server re-checks its own matrix from the seat.
  const rec = readRoom(seat.roomId);
  if (!rec || rec.state !== "live") {
    return NextResponse.json({ ok: false, error: "the room has ended" }, { status: 409 });
  }
  if (rec.host !== seat.user) return refused("recording-failed");

  if (body.on) {
    // The stream's title names the Library entry; the record is its source.
    await seat.channel.request({ type: "start-recording", title: rec.stream?.title ?? "" });
  } else {
    await seat.channel.request({ type: "stop-recording" });
  }
  return NextResponse.json({ ok: true, recording: body.on });
}

async function snapshot(seat: BridgeSeat): Promise<NextResponse> {
  const reply = await seat.channel.request({ type: "snapshot" });
  return NextResponse.json({ ok: true, snapshot: reply.snapshot });
}
